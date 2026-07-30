// Dependency-free solver: seeded local search over constellation sets.
//
// Greedy adds constellations best-first and never reconsiders, so it gets stuck the
// moment an early cheap pick crowds out a better combination. This starts from the
// greedy answer and keeps trying small edits -- add, drop, resize, swap -- taking any
// that improves the objective while staying legal.
//
// schedulePath() is the legality oracle throughout: it knows about Crossroads
// bootstrapping and refunds, so "does this still schedule inside 55 points?" is a
// stronger test than reasoning about affinity here.
//
// Not proven optimal, unlike the MILP in milp.mjs -- but it needs no solver
// installed, and it is tested. Use build-milp.mjs + glpsol/HiGHS when you want the
// certificate.

import { selectConstellations, priorityFor, trySchedule, addWithEnablers } from './select.mjs';
import { bestSubtrees, starValuer } from './stars.mjs';
import { powerWeightFor, POWER_PRESSURE } from './power.mjs';
import { splitWanted } from './wanted.mjs';


function powerBonusFor(c, mode) {
  if (!c.power) return 0;
  const [chance, cooldown, cap] = c.power;
  return powerWeightFor({ chance }, cooldown, cap, mode) * POWER_PRESSURE;
}

/**
 * Per constellation, the best connected subtree for every star count.
 *
 * `mustStars` maps a constellation to a star that has to be included because a
 * celestial power on it was targeted directly.
 */
function subtreeTables(db, wanted, mode, mustStars = new Map()) {
  const tables = new Map();
  for (const c of Object.values(db.constellations)) {
    tables.set(c.id, bestSubtrees(c,
      starValuer(c, wanted, powerBonusFor(c, mode), mustStars.get(c.id) ?? 0)));
  }
  return tables;
}

const valueOf = (solution, tables) =>
  solution.reduce((s, e) => s + (tables.get(e.id)?.[e.starsTaken]?.value ?? 0), 0);

// Ordering matters as much as the set does -- this is a path you follow in game, and
// a schedule that front-loads affinity feeders makes you play 14 points of nothing
// before the first constellation you asked for. Scheduling WITHOUT a priority here
// was silently discarding all of that: local search would find a better set, call
// this, and overwrite the ordered greedy schedule with an unordered one.
// trySchedule() falls back to an unprioritised run if the ordered one can't be
// scheduled, so this never costs a legal path.
function tryPath(solution, db, cap, priority, schedOpts) {
  return trySchedule(solution, db, cap, priority, schedOpts);
}

/**
 * Which of `candidates` could NOT be added to the current selection.
 *
 * Enough powers eventually can't share 55 points, and a picker that lets you choose one
 * only to have it silently dropped is worse than one that greys it out. This asks the
 * real question -- "would this end up in `unmet`?" -- rather than approximating it.
 *
 * Measured at ~250ms for all 62 powers, so it is NOT cheap enough to run inside a
 * solve; the UI defers it and re-renders when it lands. Worth knowing before you tune
 * it: nothing at all is blocked until FOUR powers are chosen, at which point five
 * become unreachable. It matters only near the tag limit.
 */
export function blockedPowers(db, wanted, candidates, opts = {}) {
  const cap = opts.cap ?? db.maxPoints ?? 55;
  const mode = opts.mode ?? 1;
  const { targets } = splitWanted(wanted, db);
  const blocked = new Set();
  for (const id of candidates) {
    const p = db.powers?.get(id);
    if (!p || targets.some(t => t.chip === id)) continue;
    // Appended last, so an existing choice is never given up to make room for a
    // hypothetical one.
    const trial = [...targets, { chip: id, cons: p.cons, star: p.star, min: p.min, weight: 1 }];
    const { unmet } = resolveTargets(db, trial, cap, wanted, mode);
    if (unmet.some(u => u.chip === id)) blocked.add(id);
  }
  return blocked;
}

/**
 * Work out which of the requested powers can actually be had together.
 *
 * Each target is a floor on one constellation, and floors compete for the same 55
 * points -- plus each constellation's own affinity requirement, which may drag in
 * others. Five expensive powers will not fit.
 *
 * Added heaviest-weight first, keeping the set schedulable at every step, so when
 * something has to give it's what you said mattered least. Whatever doesn't fit is
 * returned in `unmet` rather than quietly dropped: "these two don't go together" is
 * the answer, and hiding it would look like the solver ignoring you.
 */
function resolveTargets(db, targets, cap, wanted, mode) {
  const forced = [];
  const unmet = [];
  let seed = [];
  if (!targets.length) return { forced, unmet, seed };

  const priority = priorityFor(wanted, mode);
  const schedOpts = { interleavePartials: true };
  for (const t of targets) {
    const c = db.constellations[t.cons];
    if (!c) { unmet.push(t); continue; }

    // Already in the seed as somebody else's enabler -- just raise it to the stars this
    // power needs rather than adding a second entry for the same constellation.
    const existing = seed.find(e => e.id === t.cons);
    if (existing) {
      const trial = seed.map(e =>
        e.id === t.cons ? { ...e, starsTaken: Math.max(e.starsTaken, t.min) } : e);
      if (trySchedule(trial, db, cap, priority, schedOpts)) { seed = trial; forced.push(t); }
      else unmet.push(t);
      continue;
    }

    // Affliction wants eldritch 4 / ascendant 4 / chaos 3, and a Crossroads grants one
    // point of one affinity -- so a target usually cannot stand alone. It needs the same
    // enabler treatment a keyword target gets, or every deep power looks impossible.
    const grown = addWithEnablers(seed, c, db, cap, 8, priority, schedOpts, t.min);
    if (!grown) { unmet.push(t); continue; }
    seed = grown.solution;
    forced.push(t);
  }
  return { forced, unmet, seed };
}

/**
 * @param opts { cap, mode, maxPasses, timeBudgetMs }
 * @returns { solution, schedule, value, passes, improvedFromGreedy }
 */
export function solveBest(db, wanted, opts = {}) {
  const cap = opts.cap ?? db.maxPoints ?? 55;
  const mode = opts.mode ?? 1;
  const timeBudgetMs = opts.timeBudgetMs ?? 2000;
  const maxPasses = opts.maxPasses ?? 12;
  const started = Date.now();

  // Directly targeted celestial powers. These are floors, not scores: the constellation
  // must be in the solution with at least enough stars to reach the power star, and no
  // local-search move may drop it or shrink it below that.
  const { targets } = splitWanted(wanted, db);
  const { forced, unmet, seed: targetSeed } = resolveTargets(db, targets, cap, wanted, mode);
  const schedOpts = forced.length ? { interleavePartials: true } : {};
  const mustStars = new Map(forced.map(t => [t.cons, t.star]));
  const floors = new Map(forced.map(t => [t.cons, t.min]));

  const tables = subtreeTables(db, wanted, mode, mustStars);

  // A power you named outright is the point of the build, so it should arrive early in
  // the path rather than wherever the keyword scoring happens to put it. Power chips
  // contribute nothing to `hits`, so without this a targeted constellation looks like
  // filler to the ordering pass.
  const basePriority = priorityFor(wanted, mode);
  const priority = c => (c && floors.has(c.id) ? 1e5 : 0) + basePriority(c);

  const seed = selectConstellations(db, wanted,
    { cap, mode, forced, mustStars, priority, seedSolution: targetSeed });
  if (!seed.schedule) return { ...seed, value: 0, passes: 0, improvedFromGreedy: false, unmet };
  if (new Set(seed.solution.map(e => e.id)).size !== seed.solution.length) {
    throw new Error('greedy seed contains duplicate constellations');
  }

  // If a target somehow isn't in the seed, its floor would reject every move local
  // search could make -- freezing the search AND hiding the miss behind a build that
  // looks fine. Say so instead, and stop enforcing a floor nothing can satisfy.
  for (const t of forced) {
    const e = seed.solution.find(x => x.id === t.cons);
    if (!e || e.starsTaken < t.min) { floors.delete(t.cons); unmet.push(t); }
  }

  let best = seed.solution.map(e => ({ ...e }));
  let bestSchedule = seed.schedule;
  let bestValue = valueOf(best, tables);
  const seedValue = bestValue;

  // Candidates worth bringing in: anything carrying a wanted keyword, plus anything
  // with a power when powers are being scored.
  const pool = Object.values(db.constellations).filter(c => {
    if (c.crossroads) return false;
    const t = tables.get(c.id);
    return t?.[c.starCount]?.value > 0;
  }).sort((a, b) =>
    (tables.get(b.id)[b.starCount].value / b.starCount)
    - (tables.get(a.id)[a.starCount].value / a.starCount));

  const accept = (solution) => {
    // A duplicated constellation would be counted twice by both the budget and the
    // objective, so reject outright rather than trusting every move to be careful.
    if (new Set(solution.map(e => e.id)).size !== solution.length) return false;
    // A targeted power is a promise. Belt and braces with the MUST_HAVE bonus on the
    // power star: measured, either mechanism alone holds the power in place, so this is
    // deliberate redundancy rather than a load-bearing check. The bonus is the one that
    // picks WHICH stars (see stars.mjs); this only guarantees how many.
    for (const [cons, min] of floors) {
      const e = solution.find(x => x.id === cons);
      if (!e || e.starsTaken < min) return false;
    }
    const v = valueOf(solution, tables);
    if (v <= bestValue + 1e-9) return false;
    const sched = tryPath(solution, db, cap, priority, schedOpts);
    if (!sched) return false;
    best = solution.map(e => ({ ...e }));
    bestSchedule = sched;
    bestValue = v;
    return true;
  };

  let passes = 0;
  for (; passes < maxPasses; passes++) {
    if (Date.now() - started > timeBudgetMs) break;
    let improved = false;

    // 1. resize -- more or fewer stars of something already taken
    for (const e of [...best]) {
      const c = db.constellations[e.id];
      for (let k = 1; k <= c.starCount; k++) {
        if (k === e.starsTaken) continue;
        const trial = best.map(x => (x.id === e.id ? { ...x, starsTaken: k } : x));
        if (accept(trial)) { improved = true; break; }
      }
    }

    // 2. drop -- shed something that isn't paying for itself
    for (const e of [...best]) {
      const trial = best.filter(x => x.id !== e.id);
      if (!trial.length) continue;
      if (accept(trial)) { improved = true; break; }
    }

    // 3. add -- bring in a newcomer at its best affordable size
    const held = new Set(best.map(e => e.id));
    for (const c of pool) {
      if (held.has(c.id)) continue;
      if (Date.now() - started > timeBudgetMs) break;
      const t = tables.get(c.id);
      for (let k = c.starCount; k >= 1; k--) {
        if (!t[k]) continue;
        if (accept([...best, { id: c.id, starsTaken: k }])) { improved = true; break; }
      }
      if (improved) break;
    }

    // 4. swap -- trade the weakest holding for a newcomer
    if (!improved) {
      const ranked = [...best].sort((a, b) =>
        (tables.get(a.id)?.[a.starsTaken]?.value ?? 0) - (tables.get(b.id)?.[b.starsTaken]?.value ?? 0));
      outer:
      for (const weak of ranked.slice(0, 4)) {
        for (const c of pool.slice(0, 40)) {
          if (held.has(c.id)) continue;
          if (Date.now() - started > timeBudgetMs) break outer;
          const t = tables.get(c.id);
          for (let k = c.starCount; k >= 1; k--) {
            if (!t[k]) continue;
            const trial = best.filter(x => x.id !== weak.id).concat({ id: c.id, starsTaken: k });
            if (accept(trial)) { improved = true; break outer; }
          }
        }
      }
    }

    if (!improved) break;
  }

  // Attach the actual star picks, so the UI can show which stars rather than
  // assuming a prefix.
  const solution = best.map(e => ({
    ...e,
    stars: tables.get(e.id)?.[e.starsTaken]?.stars ?? null,
  }));

  return {
    solution,
    schedule: bestSchedule,
    value: bestValue,
    passes,
    improvedFromGreedy: bestValue > seedValue + 1e-9,
    seedValue,
    // Powers that were asked for and could not be fitted alongside the others.
    unmet,
  };
}
