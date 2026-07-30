// Greedy constellation selection: pick a set of constellations that covers the
// chosen keywords within the devotion point cap.
//
// THIS IS A STAND-IN FOR THE MILP (guide 4.2). Greedy gives a decent, always-legal
// answer; it does not give the optimal one. The interface is the part that matters:
// it returns `[{ id, starsTaken }]`, exactly what schedulePath() consumes, so the
// solver can be swapped in behind it without touching the scheduler or the UI.

import { schedulePath } from './schedule.mjs';
import { powerWeightFor, POWER_PRESSURE } from './power.mjs';
import { weightMap, idsOf } from './wanted.mjs';

const AFF = ['ascendant', 'chaos', 'eldritch', 'order', 'primordial'];
const sumVals = o => Object.values(o ?? {}).reduce((s, v) => s + v, 0);

// How much a constellation contributes to the chosen keywords.
// hits[id] = number of that constellation's stars carrying keyword id, scaled by how
// much the user said that keyword matters.
function score(c, weights) {
  let hit = 0, covered = 0;
  for (const [k, w] of weights) {
    const n = c.hits?.[k] ?? 0;
    // `covered` is the tie-break that runs BEFORE value, so it has to respect weights
    // too. Counting distinct keywords instead made a constellation hitting three
    // 1-weight tags outrank one hitting a single 3-weight tag -- which meant raising a
    // single tag from 1 to 3 changed nothing at all.
    if (n > 0) { hit += n * w; covered += w; }
  }
  return { hit, covered };
}

// Celestial powers are the payoff -- a constellation's proc is usually worth more
// than the passive stats on the way to it, and you want it early while levelling,
// not as the last thing you click.
//
// `mode` is the three-way switch: 0 = score powers at rank 1, 1 = midpoint, 2 = max
// rank. powerWeightFor() clamps against each power's OWN cap (10/15/20/25) and
// applies the frequency rule: chance/recharge when there is a recharge, chance alone
// for the 14 powers without one.

function powerBonus(c, mode) {
  if (!c?.power) return 0;
  const [chance, cooldown, cap] = c.power;
  return powerWeightFor({ chance }, cooldown, cap, mode) * POWER_PRESSURE;
}

/**
 * Ordering pressure: what should the scheduler reach for first.
 *
 * Exported because every caller of schedulePath() needs it. solver.mjs used to
 * schedule without one, so the moment local search accepted any improvement it
 * replaced the ordered greedy schedule with an unordered one -- the ordering code
 * here was real, tested, and thrown away before it reached the screen.
 */
export function priorityFor(wanted, mode) {
  const weights = wanted instanceof Map ? wanted : weightMap(wanted);
  return (c) => {
    if (!c) return 0;
    return score(c, weights).hit + powerBonus(c, mode);
  };
}

/**
 * @param db      { maxPoints, constellations: { id: {id,name,starCount,required,granted,crossroads,hits} } }
 * @param wanted  array of keyword ids
 * @param cap     devotion points available (55 in game)
 */
export function selectConstellations(db, wanted, opts = {}) {
  const cap = opts.cap ?? db.maxPoints ?? 55;
  const mode = opts.mode ?? 1;
  const weights = weightMap(wanted);
  const priority = opts.priority ?? priorityFor(weights, mode);
  // A targeted power is often a PARTIAL take -- 40 of the 62 are reachable without
  // finishing the constellation. Partials appended to the tail get no Crossroads
  // bootstrap of their own, so "3 stars of Affliction" is unschedulable by default.
  // Interleaving is what makes a partial target reachable at all.
  const schedOpts = (opts.forced ?? []).length ? { interleavePartials: true } : {};
  const all = Object.values(db.constellations).filter(c => !c.crossroads);

  // Coverage first (hitting all three chosen keywords beats piling into one), then
  // value density. A celestial power counts toward that value, so a constellation
  // carrying one outranks an equally statted one without.
  const value = c => score(c, weights).hit + powerBonus(c, mode) / 2;
  const ranked = all
    .map(c => ({ c, ...score(c, weights) }))
    .filter(r => r.hit > 0)
    .sort((a, b) =>
      b.covered - a.covered
      || value(b.c) / b.c.starCount - value(a.c) / a.c.starCount
      || sumVals(b.c.granted) - sumVals(a.c.granted));

  // Add greedily, keeping the set schedulable at every step. The scheduler is the
  // arbiter of legality: it knows about Crossroads bootstrapping and refunds, so
  // "does this still schedule?" is a stronger and simpler test than trying to
  // reason about affinity feasibility here.
  const chosen = [];
  let best = null;

  // Directly targeted celestial powers start the solution, along with whatever enabler
  // constellations they needed -- resolveTargets() worked that out and checked it
  // schedules, so this is a replay rather than a fresh attempt.
  if ((opts.seedSolution ?? []).length) {
    const res = trySchedule(opts.seedSolution, db, cap, priority, schedOpts);
    if (res) { chosen.push(...opts.seedSolution.map(e => ({ ...e }))); best = res; }
  }

  for (const { c } of ranked) {
    // Already present -- typically because it was pulled in as an ENABLER for an
    // earlier target. Adding it again duplicates the entry, double-counting both its
    // points and its value.
    if (chosen.some(e => e.id === c.id)) continue;
    const grown = addWithEnablers(chosen, c, db, cap, 8, priority, schedOpts);
    if (!grown) continue;
    chosen.length = 0;
    chosen.push(...grown.solution);
    best = grown.schedule;
  }

  // Passives-only: drop dead tail stars before spending leftovers, so the points
  // trimming frees can be put somewhere useful rather than left on the table.
  // Targeted constellations are exempt -- trimming one would cut off the very power
  // that was asked for.
  if (best && mode === 0 && !(opts.forced ?? []).length) {
    const trimmed = trimToPassives(chosen, db, cap, idsOf(wanted), priority, schedOpts);
    if (trimmed) { chosen.length = 0; chosen.push(...trimmed.solution); best = trimmed.schedule; }
  }

  // Spend any leftover points on a partial take of the best unchosen constellation
  // whose requirement is already met. Partials grant no affinity, so they can never
  // unblock anything and are always safe to append.
  if (best) {
    const spent = best.totalPoints;
    const left = cap - spent;
    if (left > 0) {
      const taken = new Set(chosen.map(e => e.id));
      for (const { c } of ranked) {
        if (taken.has(c.id) || c.starCount <= 1) continue;
        const partial = Math.min(left, c.starCount - 1);
        if (partial < 1) continue;
        const trial = [...chosen, { id: c.id, starsTaken: partial }];
        const res = trySchedule(trial, db, cap, priority, schedOpts);
        if (res) { chosen.push({ id: c.id, starsTaken: partial }); best = res; break; }
      }
    }
  }

  return { solution: chosen, schedule: best };
}

/**
 * Cut constellations short of their celestial power where doing so is free.
 *
 * The catch is that affinity is only granted when a constellation is COMPLETE, so
 * truncating forfeits it. That's fine for a leaf purchase you took purely for stats,
 * and fatal for one that's holding up the rest of the tree -- so each trim is
 * accepted only if the whole solution still schedules afterwards.
 *
 * Only DEAD TAIL stars are dropped -- everything after the last star that carries a
 * keyword you asked for. Trimming to the shortest prefix that merely *covers* each
 * keyword is far too eager: Tsunami carries Cold Damage on stars 1, 4 and 5, and
 * cutting to star 1 throws away two thirds of the cold damage to save four points.
 *
 * Note this rarely drops a power star outright, and shouldn't. "Passives only" means
 * the proc doesn't drive the choice, not that a star is worthless because it happens
 * to carry a proc -- power stars usually carry real stats too.
 */
function trimToPassives(chosen, db, cap, wanted, priority, schedOpts = {}) {
  const want = new Set(wanted);
  let current = chosen.map(e => ({ ...e }));
  let schedule = trySchedule(current, db, cap, priority, schedOpts);
  if (!schedule) return null;
  let changed = false;

  // Biggest constellations first: trimming those frees the most points.
  const order = [...current].sort((a, b) =>
    db.constellations[b.id].starCount - db.constellations[a.id].starCount);

  for (const entry of order) {
    const c = db.constellations[entry.id];
    if (!c.perStar || entry.starsTaken < c.starCount) continue;

    // Last star that earns its point.
    let keep = 0;
    for (let i = 0; i < c.perStar.length; i++) {
      if (c.perStar[i].some(k => want.has(k))) keep = i + 1;
    }
    if (!keep || keep >= c.starCount) continue;   // nothing to cut

    const trial = current.map(e =>
      e.id === entry.id ? { ...e, starsTaken: keep } : e);
    const res = trySchedule(trial, db, cap, priority, schedOpts);
    if (!res) continue;                        // affinity was load-bearing; leave it whole
    current = trial;
    schedule = res;
    changed = true;
  }

  return changed ? { solution: current, schedule } : null;
}

// Try the prioritised ordering first; fall back to the plain feasibility-greedy one
// if it can't be scheduled. Reordering can change how many Crossroads bootstraps are
// needed, so a prioritised run may fail where the default succeeds -- never lose a
// legal path just because we wanted a nicer order.
export function trySchedule(solution, db, cap, priority, schedOpts = {}) {
  if (priority) {
    try { return schedulePath(solution, db, cap, { ...schedOpts, priority }); }
    catch { /* fall through */ }
  }
  try {
    return schedulePath(solution, db, cap, schedOpts);
  } catch {
    return null;   // over budget or unreachable -- caller just skips this candidate
  }
}

// Affinity a set of full takes permanently grants. Partials grant nothing.
function heldFrom(solution, db) {
  const held = Object.fromEntries(AFF.map(a => [a, 0]));
  for (const e of solution) {
    const c = db.constellations[e.id];
    if (e.starsTaken < c.starCount) continue;
    for (const [a, v] of Object.entries(c.granted ?? {})) held[a] = (held[a] ?? 0) + v;
  }
  return held;
}

const deficit = (req, held) => Object.fromEntries(
  Object.entries(req ?? {}).map(([a, v]) => [a, Math.max(0, v - (held[a] ?? 0))]),
);

/**
 * Try to add `target`, pulling in "enabler" constellations if its affinity
 * requirement isn't met yet.
 *
 * Without this the picker can only ever build from constellations that carry a
 * wanted keyword, so anything deep in the tree is unreachable -- a Crossroads grants
 * one affinity point, and Solael's Witchblade wants eldritch 6 / chaos 4. Since the
 * deep constellations are exactly the ones holding celestial powers, that was the
 * difference between a usable path and "no schedule".
 */
export function addWithEnablers(chosen, target, db, cap, maxEnablers = 8, priority = null,
                                schedOpts = {}, take = null) {
  if (chosen.some(e => e.id === target.id)) return null;   // never duplicate an entry
  // `take` lets a caller ask for a partial: a targeted celestial power only needs the
  // stars that reach it, and 40 of the 62 sit short of the constellation's end.
  const starsTaken = take ?? target.starCount;
  let solution = [...chosen, { id: target.id, starsTaken }];
  let res = trySchedule(solution, db, cap, priority, schedOpts);
  if (res) return { solution, schedule: res };

  const taken = new Set(chosen.map(e => e.id));
  const pool = Object.values(db.constellations)
    .filter(c => !c.crossroads && !taken.has(c.id) && c.id !== target.id && sumVals(c.granted) > 0);

  const working = [...chosen];
  for (let i = 0; i < maxEnablers; i++) {
    const held = heldFrom(working, db);
    const need = deficit(target.required, held);
    if (!sumVals(need)) break;                 // requirement already met; failure is budget, not affinity

    // Best affinity progress per point, only counting affinity we actually lack.
    let bestEnabler = null, bestVal = 0;
    for (const c of pool) {
      if (working.some(e => e.id === c.id)) continue;
      const gain = Object.entries(c.granted ?? {})
        .reduce((s, [a, v]) => s + Math.min(v, need[a] ?? 0), 0);
      if (!gain) continue;
      const val = gain / c.starCount;
      if (val > bestVal) { bestVal = val; bestEnabler = c; }
    }
    if (!bestEnabler) break;

    const grown = [...working, { id: bestEnabler.id, starsTaken: bestEnabler.starCount }];
    if (!trySchedule(grown, db, cap, priority, schedOpts)) break;   // enabler unreachable or unaffordable
    working.push({ id: bestEnabler.id, starsTaken: bestEnabler.starCount });

    solution = [...working, { id: target.id, starsTaken }];
    res = trySchedule(solution, db, cap, priority, schedOpts);
    if (res) return { solution, schedule: res };
  }

  return null;
}

/** Build the scheduler's db shape from the compact UI index. */
export function buildDb(index, maxPoints = 55) {
  // Celestial power chips are targets, not scores, so the db carries them separately
  // from `hits`. Keyed by chip id: 'power:<constellation>' -> where the power lives.
  const powers = new Map();
  for (const c of index.chips ?? []) {
    if (c.kind === 'power') {
      powers.set(c.id, { cons: c.cons, star: c.star, min: c.min, label: c.label });
    }
  }
  const constellations = {};
  for (const c of index.constellations) {
    constellations[c.id] = {
      id: c.id, name: c.n, starCount: c.s,
      required: c.r, granted: c.g, crossroads: !!c.cr,
      hasPower: !!c.p,
      power: c.pw ?? null,       // [chance, recharge, levelCap]
      powerStar: c.pi ?? 0,      // 1-based index of the power star, 0 if none
      hits: c.k,
      perStar: c.ks ?? null,     // chip ids carried by each star, in purchase order
      starNames: c.sn ?? null,
      starParents: c.sp ?? null,
    };
  }
  return { maxPoints, constellations, powers };
}
