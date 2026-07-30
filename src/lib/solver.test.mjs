import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb } from './select.mjs';
import { solveBest, blockedPowers } from './solver.mjs';
import { bestSubtrees, starValuer } from './stars.mjs';
import { schedulePath } from './schedule.mjs';

const index = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../ui-index.json'), 'utf8'),
);
const db = buildDb(index);
const chipId = (label, ns = 'character') =>
  index.chips.find(x => x.label === label && x.ns === ns).id;
const byId = new Map(index.chips.map(c => [c.id, c]));

test('tree knapsack respects parent-before-child', () => {
  for (const c of Object.values(db.constellations)) {
    const table = bestSubtrees(c, starValuer(c, [], 0));
    for (let k = 1; k <= c.starCount; k++) {
      const pick = table[k];
      if (!pick) continue;
      assert.equal(pick.stars.length, k, `${c.name} k=${k} returned ${pick.stars.length} stars`);
      const owned = new Set(pick.stars);
      for (const s of pick.stars) {
        const parent = c.starParents?.[s - 1];
        if (parent) assert.ok(owned.has(parent),
          `${c.name} k=${k} took star ${s} without parent ${parent}`);
      }
    }
  }
});

test('tree knapsack finds subtrees a prefix would miss', () => {
  // Akeron's Scorpion hangs its power (star 5) off star 3, so the best four stars
  // are {1,2,3,5} -- the prefix {1,2,3,4} misses the power entirely.
  const c = Object.values(db.constellations).find(x => x.name.startsWith('Akeron'));
  const value = j0 => (j0 + 1 === c.powerStar ? 10 : 1);
  const table = bestSubtrees(c, value);
  assert.deepEqual(table[4].stars.sort((a, b) => a - b), [1, 2, 3, 5],
    'should reach the power by skipping star 4');
});

test('solver is never worse than its greedy seed', () => {
  const ids = index.chips.map(c => c.id);
  for (let i = 0; i < 12; i++) {
    const picks = [ids[i % ids.length], ids[(i + 17) % ids.length], ids[(i + 41) % ids.length]];
    const r = solveBest(db, picks, { mode: 1, timeBudgetMs: 800 });
    assert.ok(r.schedule, `no schedule for ${picks}`);
    assert.ok(r.value >= r.seedValue - 1e-9,
      `solver returned ${r.value}, worse than greedy seed ${r.seedValue}`);
  }
});

test('solver output is always playable', () => {
  const combos = [
    [chipId('Cold Damage'), chipId('Pierce Damage'), chipId('Casting Speed')],
    [chipId('Health'), chipId('Armor'), chipId('Physical Resistance')],
    [chipId('Total Damage', 'pet'), chipId('Crit Damage', 'pet')],
    [chipId('Fire Retaliation')],
  ];
  for (const picks of combos) {
    for (const mode of [0, 1, 2]) {
      const r = solveBest(db, picks, { mode, timeBudgetMs: 800 });
      assert.ok(r.schedule, `no schedule (mode ${mode})`);
      assert.ok(r.schedule.totalPoints <= 55,
        `spent ${r.schedule.totalPoints} (mode ${mode})`);
      for (const s of r.schedule.path) {
        assert.ok(s.runningPoints <= 55,
          `running total hit ${s.runningPoints} at ${s.name} (mode ${mode})`);
      }
    }
  }
});

test('never returns the same constellation twice', () => {
  // addWithEnablers used to append its target without checking whether that
  // constellation had already been pulled in as an ENABLER for an earlier target,
  // which double-counted its points AND its value -- 75 of 120 solutions were
  // affected, and it quietly flattened the difference between scoring modes.
  const ids = index.chips.map(c => c.id);
  for (let i = 0; i < 20; i++) {
    const picks = [ids[(i * 13) % ids.length], ids[(i * 13 + 29) % ids.length], ids[(i * 13 + 58) % ids.length]];
    for (const mode of [0, 1, 2]) {
      const r = solveBest(db, picks, { mode, timeBudgetMs: 600 });
      if (!r.schedule) continue;
      const ids2 = r.solution.map(e => e.id);
      assert.equal(new Set(ids2).size, ids2.length,
        `duplicate constellation (mode ${mode}): ${ids2.filter((x, j) => ids2.indexOf(x) !== j)
          .map(x => db.constellations[x].name).join(', ')}`);
    }
  }
});

test('scoring modes produce genuinely different builds', () => {
  const sig = r => r.solution.map(e => `${e.id}:${e.starsTaken}`).sort().join('|');
  const picks = [chipId('Fire Damage'), chipId('Burn Duration'), chipId('Offensive Ability')];
  const a = solveBest(db, picks, { mode: 0, timeBudgetMs: 800 });
  const c = solveBest(db, picks, { mode: 2, timeBudgetMs: 800 });
  assert.notEqual(sig(a), sig(c),
    'passives-only and max-rank returned identical builds; the switch does nothing');
});

test('weights shift the build toward the heavier tag', () => {
  const fire = chipId('Fire Damage');
  const move = chipId('Movement Speed');
  const starsFor = (r, k) =>
    r.solution.reduce((n, e) => n + (db.constellations[e.id].hits[k] ?? 0), 0);

  const fireHeavy = solveBest(db, [{ id: fire, weight: 3 }, { id: move, weight: 1 }],
    { mode: 1, timeBudgetMs: 900 });
  const moveHeavy = solveBest(db, [{ id: fire, weight: 1 }, { id: move, weight: 3 }],
    { mode: 1, timeBudgetMs: 900 });

  assert.ok(starsFor(fireHeavy, fire) > starsFor(moveHeavy, fire),
    'weighting fire up should buy more fire stars');
  assert.ok(starsFor(moveHeavy, move) > starsFor(fireHeavy, move),
    'weighting movement up should buy more movement stars');
});

test('raising a single tag changes the build', () => {
  // `covered` used to count DISTINCT keywords hit, unweighted, and it sorts ahead of
  // value -- so a constellation hitting three 1-weight tags outranked one hitting a
  // single 3-weight tag, and lifting one tag from 1 to 3 produced a byte-identical
  // build. The weights were real in the objective and invisible in the result.
  const picks = [chipId('Fire Damage'), chipId('Health'), chipId('Movement Speed')];
  const sig = r => r.solution.map(e => `${e.id}:${e.starsTaken}`).sort().join('|');
  const flat = solveBest(db, picks.map(id => ({ id, weight: 1 })),
    { mode: 1, timeBudgetMs: 700 });

  for (let i = 0; i < picks.length; i++) {
    const bumped = solveBest(db, picks.map((id, j) => ({ id, weight: j === i ? 3 : 1 })),
      { mode: 1, timeBudgetMs: 700 });
    assert.notEqual(sig(bumped), sig(flat),
      `raising tag ${i} to weight 3 left the build unchanged`);
  }
});

test('a plain array of ids still works, at the default weight', () => {
  // Every caller used to pass bare ids; that shape has to keep working or the MILP
  // scripts and older saved states break.
  const picks = [chipId('Cold Damage'), chipId('Armor')];
  const bare = solveBest(db, picks, { mode: 1, timeBudgetMs: 900 });
  const explicit = solveBest(db, picks.map(id => ({ id, weight: 2 })),
    { mode: 1, timeBudgetMs: 900 });
  const sig = r => r.solution.map(e => `${e.id}:${e.starsTaken}`).sort().join('|');
  assert.ok(bare.schedule, 'bare id array produced no schedule');
  assert.equal(sig(bare), sig(explicit), 'default weight should equal an explicit 2');
});

test('weighting never produces an illegal path', () => {
  const picks = [chipId('Fire Damage'), chipId('Health'), chipId('Armor')];
  for (const w of [[1, 1, 1], [3, 1, 1], [1, 3, 1], [3, 3, 3]]) {
    const r = solveBest(db, picks.map((id, i) => ({ id, weight: w[i] })),
      { mode: 1, timeBudgetMs: 900 });
    assert.ok(r.schedule, `weights ${w} produced no schedule`);
    assert.ok(r.schedule.totalPoints <= 55, `weights ${w} spent ${r.schedule.totalPoints}`);
    for (const st of r.schedule.path) {
      assert.ok(st.runningPoints <= 55, `weights ${w}: running total ${st.runningPoints}`);
    }
  }
});

test('stored ceilings are not beaten by real builds', () => {
  // The ceiling is what Coverage measures its bars against, so a real build exceeding
  // one means the panel is lying about what's achievable. Computing ceilings WITH each
  // mode's power bonus broke this badly: a single-keyword objective at max rank chased
  // procs instead of the keyword, so Acid Resistance stored 1 where builds got 5.
  // Ceilings are now solved with powers off, which is a genuine physical bound.
  const byId = new Map(index.chips.map(c => [c.id, c]));
  const ids = index.chips.map(c => c.id);
  const breaches = [];
  for (let i = 0; i < 24; i++) {
    const pick = [];
    for (let j = 0; j < 5; j++) {
      const id = ids[(i * 11 + j * 23) % ids.length];
      if (!pick.some(p => p.id === id)) pick.push({ id, weight: (j % 3) + 1 });
    }
    for (const mode of [0, 1, 2]) {
      const r = solveBest(db, pick, { mode, timeBudgetMs: 300 });
      if (!r.schedule) continue;
      for (const p of pick) {
        const got = r.solution.reduce(
          (n, e) => n + (db.constellations[e.id].hits[p.id] ?? 0), 0);
        const ceiling = byId.get(p.id).ceiling;
        // Allow 1 -- local search is not exact and can undershoot a solo solve. The UI
        // clamps with max(ceiling, achieved), so this is a drift alarm, not a crash.
        if (got > ceiling + 1) {
          breaches.push(`${byId.get(p.id).label} mode ${mode}: ${got} vs ceiling ${ceiling}`);
        }
      }
    }
  }
  assert.deepEqual(breaches, [], 'ceilings are meaningfully below achievable');
});

test('the path reaches a wanted constellation early', () => {
  // solveBest() used to schedule with no priority, so every time local search
  // accepted an improvement it overwrote the ordered greedy schedule with an
  // unordered one. Cold Damage alone put Raven, Fox, Scholar's Light and Hawk --
  // 14 points carrying zero cold stars between them -- ahead of Tsunami, which
  // needed nothing but a primordial Crossroads. Worst case across a sweep was the
  // 11th constellation before you touched anything you asked for.
  //
  // Bound is deliberately loose: the point is that the payoff is near the front,
  // not that it is always first. Something legitimately unreachable early (a deep
  // constellation behind two full affinity chains) should not fail this.
  // KEYWORD chips only. A targeted celestial power is often a deep constellation whose
  // affinity requires six enabler constellations first -- Ultos needs Eel, Scarab,
  // Crane, Hound, Lizard and Lion before it is legal at all. That position is set by the
  // game's affinity rules, not by ordering quality, so mixing power chips into this
  // sweep measures the wrong thing. Power ordering has its own test below.
  // Judged on the DISTRIBUTION, not the worst case. A single threshold is a bad guard
  // here: the failure this exists to catch -- ordering being discarded again -- would
  // push every build late at once, while a legitimately awkward tag combination can
  // sit in the tail without anything being wrong. The old bound of 6 was really just
  // describing whichever fixture happened to be worst that week, and it broke when
  // power weighting changed for reasons that had nothing to do with ordering.
  //
  // Current shape: 110 of 120 land at position 1, mean 1.28, two outliers at 8 where
  // the only holders of a sparse keyword sit behind an affinity chain.
  const ids = index.chips.filter(c => c.kind !== 'power').map(c => c.id);
  const positions = [];
  for (let i = 0; i < 20; i++) {
    const pick = [];
    for (let j = 0; j < 3; j++) {
      const id = ids[(i * 7 + j * 31) % ids.length];
      if (!pick.some(p => p.id === id)) pick.push({ id, weight: (j % 3) + 1 });
    }
    for (const mode of [0, 1, 2]) {
      const r = solveBest(db, pick, { mode, timeBudgetMs: 250 });
      if (!r.schedule) continue;
      const takes = r.schedule.path.filter(s => s.kind === 'take');
      const at = takes.findIndex(s =>
        pick.some(p => (db.constellations[s.id].hits?.[p.id] ?? 0) > 0));
      if (at >= 0) positions.push(at + 1);
    }
  }
  assert.ok(positions.length > 40, `only ${positions.length} solves produced a path`);
  const sorted = [...positions].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
  const early = positions.filter(p => p <= 3).length / positions.length;

  assert.equal(median, 1, `median position is ${median}; ordering has drifted`);
  assert.ok(mean <= 2, `mean position is ${mean.toFixed(2)}, expected about 1.3`);
  assert.ok(early >= 0.85,
    `only ${(early * 100).toFixed(0)}% of builds reach a wanted constellation in the `
    + 'first three picks, expected 85% or more');
});

test('ordering the path costs no devotion points', () => {
  // Priority is applied as the first sort key in schedulePath(), and reordering can
  // change how many Crossroads bootstraps are needed. It must not make the build
  // more expensive -- if it ever does, the fallback to an unprioritised run in
  // trySchedule() has stopped doing its job.
  const picks = [chipId('Cold Damage'), chipId('Health'), chipId('Movement Speed')];
  for (const mode of [0, 1, 2]) {
    const r = solveBest(db, picks, { mode, timeBudgetMs: 600 });
    assert.ok(r.schedule, `no schedule (mode ${mode})`);
    const bare = schedulePath(r.solution, db, 55);
    assert.ok(r.schedule.totalPoints <= bare.totalPoints,
      `prioritised order spent ${r.schedule.totalPoints} vs ${bare.totalPoints} unordered`);
  }
});

// --- celestial powers as targets ------------------------------------------------
// A power tag is not a keyword. It names one star of one constellation, so it is a
// hard target with a floor, not something to maximise. 40 of the 62 are reachable
// without finishing their constellation, which is the point of targeting one.

const powerChips = index.chips.filter(c => c.kind === 'power');
const powerId = label => {
  const c = powerChips.find(x => x.label === label);
  assert.ok(c, `no power named "${label}"`);
  return c.id;
};
const gotPower = (r, chipId) => {
  const p = db.powers.get(chipId);
  const e = r.solution.find(x => x.id === p.cons);
  return Boolean(e && (e.stars ?? []).includes(p.star));
};

test('a targeted power is taken at its cheapest, not by finishing the constellation', () => {
  // Fetid Pool sits on star 3 of Affliction's 7. Taking all 7 would waste 4 points on
  // a build that only asked for the proc.
  const id = powerId('Fetid Pool');
  const chip = powerChips.find(c => c.id === id);
  assert.equal(chip.min, 3);
  assert.equal(chip.size, 7);

  const r = solveBest(db, [id], { mode: 1, timeBudgetMs: 300 });
  assert.ok(gotPower(r, id), 'did not secure Fetid Pool');
  const e = r.solution.find(x => x.id === chip.cons);
  assert.ok(e.starsTaken < chip.size,
    `took all ${chip.size} stars when ${chip.min} reach the power`);
});

test('a power survives competing keyword tags', () => {
  // The objective would happily spend everything on keyword coverage. A named power is
  // a promise, so accept() enforces a floor rather than pricing it in.
  const id = powerId("Targo's Hammer");
  for (const mode of [0, 1, 2]) {
    const r = solveBest(db, [id, chipId('Cold Damage'), chipId('Health'),
                             chipId('Armor'), chipId('Movement Speed')],
      { mode, timeBudgetMs: 500 });
    assert.ok(r.schedule, `no schedule (mode ${mode})`);
    assert.ok(gotPower(r, id), `Targo's Hammer was traded away for keywords (mode ${mode})`);
  }
});

test('a power needing deep affinity still resolves, via enablers', () => {
  // Affliction wants eldritch 4 / ascendant 4 / chaos 3 and a Crossroads grants one
  // point of one affinity, so this target cannot stand alone -- it needs the same
  // enabler treatment a keyword target gets. Checking it alone was how this broke.
  const id = powerId('Fetid Pool');
  const r = solveBest(db, [id], { mode: 1, timeBudgetMs: 300 });
  assert.ok(r.schedule, 'no schedule for a power behind three affinity requirements');
  assert.deepEqual((r.unmet ?? []).map(t => t.chip), [],
    'reported unobtainable when enablers would have solved it');
});

test('several powers at once are all delivered, or reported as unmet', () => {
  const ids = ['Twin Fangs', 'Fetid Pool', 'Scorpion Sting', "Targo's Hammer",
               "Hyrian's Glare"].map(powerId);
  const r = solveBest(db, ids, { mode: 1, timeBudgetMs: 700 });
  assert.ok(r.schedule, 'five powers produced no schedule at all');
  assert.ok(r.schedule.totalPoints <= 55, `spent ${r.schedule.totalPoints}`);
  // Every requested power is either secured or named in unmet. Silence is the failure.
  const unmet = new Set((r.unmet ?? []).map(t => t.chip));
  for (const id of ids) {
    assert.ok(gotPower(r, id) || unmet.has(id),
      `${db.powers.get(id).label} was neither secured nor reported as unmet`);
  }
});

test('a targeted power is taken the moment it becomes legal', () => {
  // The precise ordering claim for a target. It can't come first when its affinity isn't
  // met -- Ultos needs six enabler constellations before it is buyable at all -- and
  // buying other useful things while that affinity accumulates is correct, not wasteful.
  // So neither "it comes first" nor "nothing droppable precedes it" is the right test.
  //
  // What must hold is that it is taken at the FIRST step where the game would allow it.
  // Anything later means the ordering pass let it drift behind filler.
  const AFFS = ['ascendant', 'chaos', 'eldritch', 'order', 'primordial'];
  const satisfies = (held, req) =>
    Object.entries(req ?? {}).every(([a, v]) => (held[a] ?? 0) >= v);

  // The fixture needs BOTH mode 0 and competing keyword tags, or the mechanism under
  // test isn't exercised:
  //   - in Rank 1 / Max rank the proc-scoring bonus already ranks a power constellation
  //     highly, so the target's ordering boost is redundant;
  //   - with a power tag alone there is nothing else worth buying, so the target wins by
  //     default.
  // With three strong keywords in Passives only, removing the boost pushes Twin Fangs
  // from take 1 to take 5 and Elemental Storm from 6 to 9. That is what this catches.
  const rivals = [chipId('Health'), chipId('Armor'), chipId('Offensive Ability')];
  for (const [mode, label] of [0, 1].flatMap(m =>
    ['Hand of Ultos', "Targo's Hammer", 'Fetid Pool', 'Twin Fangs', 'Elemental Storm']
      .map(l => [m, l]))) {
    const id = powerId(label);
    const p = db.powers.get(id);
    const r = solveBest(db, [id, ...rivals], { mode, timeBudgetMs: 500 });
    assert.ok(r.schedule, `${label}: no schedule (mode ${mode})`);

    const taken = new Map(r.solution.map(e => [e.id, e.starsTaken]));
    const req = db.constellations[p.cons].required ?? {};
    const held = Object.fromEntries(AFFS.map(a => [a, 0]));
    let legal = false;
    let reached = false;
    const strayTakes = [];

    for (const step of r.schedule.path) {
      if (step.id === p.cons && step.kind !== 'refund') { reached = true; break; }
      // Once it is legal, any further TAKE of something else is the ordering pass
      // letting the target drift. Bootstraps and refunds in between are the scheduler's
      // own bookkeeping and don't count.
      if (legal && step.kind === 'take') strayTakes.push(db.constellations[step.id].name);

      // Replay affinity exactly as the scheduler does: complete takes and bootstraps
      // grant, refunds take back, partial takes grant nothing.
      const c = db.constellations[step.id];
      const complete = !taken.has(step.id) || taken.get(step.id) >= c.starCount;
      const sign = step.kind === 'refund' ? -1 : 1;
      if (complete) {
        for (const [a, v] of Object.entries(c.granted ?? {})) held[a] += sign * v;
      }
      if (satisfies(held, req)) legal = true;
    }
    assert.ok(reached, `${label}: its constellation never appears as a take`);
    assert.deepEqual(strayTakes, [],
      `${label} (mode ${mode}) became legal, then ${strayTakes.length} other `
      + `constellation(s) were bought before it: ${strayTakes.join(', ')}`);
  }
});

test('blockedPowers only blocks what really cannot fit', () => {
  // The sweep behind the greyed-out chips. It must agree with the solver, or the picker
  // will forbid something obtainable -- which reads as a bug -- or allow something that
  // gets silently dropped, which reads worse.
  const chosen = ['Twin Fangs', 'Fetid Pool', 'Scorpion Sting', "Targo's Hammer"].map(powerId);
  const others = powerChips.map(c => c.id).filter(id => !chosen.includes(id));
  const blocked = blockedPowers(db, chosen, others, { mode: 1 });

  // Spot-check both answers against a real solve rather than trusting the sweep.
  let checked = 0;
  for (const id of others) {
    if (checked >= 12) break;
    const r = solveBest(db, [...chosen, id], { mode: 1, timeBudgetMs: 40 });
    const reallyGot = Boolean(r.schedule) && gotPower(r, id);
    assert.equal(blocked.has(id), !reallyGot,
      `${db.powers.get(id).label}: sweep said ${
        blocked.has(id) ? 'blocked' : 'available'} but a solve ${
        reallyGot ? 'got it' : 'did not'}`);
    checked++;
  }
  assert.ok(checked > 0, 'checked nothing');
});

test('nothing is blocked until enough powers are chosen', () => {
  // Measured: conflicts first appear at four. Pinned because it is the thing that makes
  // the sweep worth deferring rather than running on every keystroke.
  const all = powerChips.map(c => c.id);
  const one = [powerId("Hyrian's Glare")];
  assert.equal(blockedPowers(db, one, all.filter(i => !one.includes(i)), { mode: 1 }).size, 0,
    'a single power should block nothing');
});

test('reported star picks match the star counts the scheduler was given', () => {
  const picks = [chipId('Cold Damage'), chipId('Pierce Damage')];
  const r = solveBest(db, picks, { mode: 1, timeBudgetMs: 800 });
  for (const e of r.solution) {
    if (!e.stars) continue;
    assert.equal(e.stars.length, e.starsTaken,
      `${db.constellations[e.id].name}: ${e.stars.length} stars listed but ${e.starsTaken} paid for`);
    const owned = new Set(e.stars);
    for (const s of e.stars) {
      const parent = db.constellations[e.id].starParents?.[s - 1];
      if (parent) assert.ok(owned.has(parent), 'listed an orphan star');
    }
  }
});
