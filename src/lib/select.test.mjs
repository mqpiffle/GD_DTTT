import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectConstellations, buildDb, priorityFor } from './select.mjs';
import { solveBest } from './solver.mjs';
import { tierOf, powerWeightFor } from './power.mjs';

const index = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../ui-index.json'), 'utf8'),
);
const db = buildDb(index);
const chipId = (label, ns = 'character') => {
  const c = index.chips.find(x => x.label === label && x.ns === ns);
  assert.ok(c, `no chip "${label}" in ${ns}`);
  return c.id;
};

// Two kinds of chip now. A keyword scores by counting stars across the tree, so it must
// have holders in `k`. A celestial power names one star of one constellation and carries
// no `k` at all -- it's a target, and its integrity check is a different one.
const keywordChips = index.chips.filter(c => c.kind !== 'power');
const powerChips = index.chips.filter(c => c.kind === 'power');

test('every browsable keyword chip maps to at least one constellation', () => {
  const dead = keywordChips.filter(ch => !index.constellations.some(c => c.k[ch.id]));
  assert.deepEqual(dead.map(d => `${d.label}[${d.ns}]`), [],
    'chips with no holder are unselectable dead ends');
});

test('every power chip points at a real star of a real constellation', () => {
  assert.ok(powerChips.length > 0, 'no power chips in the index at all');
  for (const p of powerChips) {
    const c = index.constellations.find(x => x.id === p.cons);
    assert.ok(c, `${p.label} names a constellation that does not exist`);
    assert.ok(p.star >= 1 && p.star <= c.s,
      `${p.label} points at star ${p.star} of a ${c.s}-star constellation`);
    assert.equal(p.star, c.pi, `${p.label} is not on ${c.n}'s power star`);
    // `min` is the chain from the root to the power star -- the cheapest way in.
    let depth = 0;
    for (let a = p.star; a; a = c.sp[a - 1]) depth++;
    assert.equal(p.min, depth, `${p.label} claims min ${p.min} but the chain is ${depth}`);
    assert.ok(p.min <= c.s, `${p.label} needs more stars than the constellation has`);
  }
});

test('every keyword chip alone produces a legal schedule', () => {
  for (const c of keywordChips) {
    const { schedule } = selectConstellations(db, [c.id]);
    assert.ok(schedule, `${c.label}[${c.ns}] produced no schedule`);
    assert.ok(schedule.totalPoints <= 55, `${c.label} spent ${schedule.totalPoints}`);
  }
});

test('every power alone is obtainable, and its star is actually taken', () => {
  // The strongest thing to check about a target: not just that something schedules, but
  // that the star carrying the power you named is in the result. A subtree of the right
  // size that skips it would be a silent failure.
  //
  // MODE 0 MATTERS HERE. In Rank 1 and Max rank the proc-scoring bonus lands on the
  // power star anyway, so it gets included by accident and the real mechanism goes
  // untested. Passives only sets that bonus to zero: Akeron's Scorpion then has two
  // size-4 subtrees of equal value, {1,2,3,4} and {1,2,3,5}, and only the explicit
  // must-take marker picks the one with the power on it. Tested with mode 0 first for
  // exactly that reason.
  for (const mode of [0, 1, 2]) {
    for (const p of powerChips) {
      const r = solveBest(db, [p.id], { mode, timeBudgetMs: 40 });
      assert.ok(r.schedule, `${p.label} produced no schedule (mode ${mode})`);
      assert.ok(r.schedule.totalPoints <= 55,
        `${p.label} spent ${r.schedule.totalPoints} (mode ${mode})`);
      assert.deepEqual((r.unmet ?? []).map(t => t.chip), [],
        `${p.label} was reported unobtainable on its own (mode ${mode})`);
      const e = r.solution.find(x => x.id === p.cons);
      assert.ok(e, `${p.label}: ${p.cons} is not in the solution (mode ${mode})`);
      assert.ok((e.stars ?? []).includes(p.star),
        `${p.label} (mode ${mode}): took stars [${e.stars}] of ${p.cons}, missing star ${p.star}`);
    }
  }
});

test('never exceeds the 55 point cap across many combinations', () => {
  // Deterministic distinct triples by stepping three coprime offsets, rather than
  // retrying until distinct -- a retry loop with a formula that can repeat an index
  // spins forever.
  const ids = index.chips.map(c => c.id);
  const n = ids.length;
  for (let i = 0; i < 60; i++) {
    const pick = [ids[i % n], ids[(i + 17) % n], ids[(i + 41) % n]];
    assert.equal(new Set(pick).size, 3, 'triple should be distinct');
    const { schedule } = selectConstellations(db, pick);
    assert.ok(schedule, `no schedule for ${pick}`);
    assert.ok(schedule.totalPoints <= 55, `${pick} spent ${schedule.totalPoints}`);
  }
});

test('running point total never exceeds the cap mid-path', () => {
  // The end total being legal isn't enough -- you play the path in order, so an
  // intermediate step going over 55 would be unplayable even if refunds fix it later.
  const { schedule } = selectConstellations(db, [
    chipId('Fire Damage'), chipId('Burn Duration'), chipId('Offensive Ability'),
  ]);
  for (const step of schedule.path) {
    assert.ok(step.runningPoints <= 55,
      `${step.name} pushed running total to ${step.runningPoints}`);
  }
});

test('reaches constellations behind deep affinity requirements', () => {
  // Fire Retaliation exists on exactly two constellations, both deep: Messenger of War
  // (primordial 7 / ascendant 3) and Alladrah's Phoenix (eldritch 6 / primordial 6 /
  // order 3). A Crossroads grants 1 affinity, so this is only reachable if the selector
  // pulls in enabler constellations that grant affinity without carrying the keyword.
  //
  // Was Contagion until Contagion turned out to be proc-only and left the picker.
  const { solution, schedule } = selectConstellations(db, [chipId('Fire Retaliation')]);
  assert.ok(schedule, 'Fire Retaliation unreachable');
  const names = solution.map(e => db.constellations[e.id].name);
  assert.ok(
    names.some(n => n.startsWith('Messenger of War') || n.startsWith("Alladrah's Phoenix")),
    `expected a Fire Retaliation holder, got ${names.join(', ')}`,
  );
});

test('crossroads used as bootstraps are named by affinity', () => {
  const { schedule } = selectConstellations(db, [chipId('Fire Retaliation')]);
  const boots = schedule.path.filter(p => p.kind === 'bootstrap');
  assert.ok(boots.length > 0, 'expected at least one crossroads bootstrap');
  for (const b of boots) {
    assert.match(b.name, /^Crossroads \((ascendant|chaos|eldritch|order|primordial)\)$/,
      `crossroads step must say which one to click, got "${b.name}"`);
  }
});

test('a celestial power lifts a constellation up the order', () => {
  // Ordering priority is `keyword hits + power bonus`, so a power has to be able to
  // break a tie against a constellation that serves the same number of keywords.
  //
  // This used to assert Tsunami specifically came within the first three steps. That
  // was really testing the OLD power scoring: chance/recharge rated tier 1 highest, and
  // Tsunami is tier 1. Under tier weighting Harpy outranks it honestly -- 4 wanted stars
  // against Tsunami's 3 -- so naming Tsunami now tests a coincidence rather than the
  // rule. Compare like with like instead.
  const picks = [chipId('Cold Damage'), chipId('Pierce Damage'), chipId('Casting Speed')];
  const priority = priorityFor(picks, 1);
  const hits = c => picks.reduce((n, k) => n + (c.hits?.[k] ?? 0), 0);

  const all = Object.values(db.constellations).filter(c => !c.crossroads && hits(c) > 0);
  let compared = 0;
  for (const a of all) {
    for (const b of all) {
      if (a.id === b.id || hits(a) !== hits(b)) continue;
      if (a.hasPower && !b.hasPower) {
        assert.ok(priority(a) > priority(b),
          `${a.name} has a power and ${b.name} does not, both serve ${hits(a)} wanted `
          + `stars, yet priority is ${priority(a).toFixed(2)} vs ${priority(b).toFixed(2)}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 0, 'found no like-for-like pair to compare');
});

test('the level cap identifies the tier, for every power', () => {
  // The whole tier model rests on this. Caps are 25 / 20 / 15 and they line up exactly
  // with the affinity bands the wiki describes -- tier 1 needs 1 affinity and gives
  // ~4.9 back, tier 2 needs 8-15 and gives ~3, tier 3 needs 22+ and gives NOTHING.
  // Derived from the DBRs independently and cross-checked; if a patch ever breaks the
  // correspondence, the weights are being applied to the wrong constellations.
  const sum = o => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
  const bands = { 1: [], 2: [], 3: [] };
  for (const p of powerChips) {
    const c = index.constellations.find(x => x.id === p.cons);
    const tier = tierOf(c.pw[2]);
    bands[tier].push({ req: sum(c.r), grant: sum(c.g) });
  }
  assert.deepEqual(Object.entries(bands).map(([, v]) => v.length), [14, 27, 21],
    'tier populations changed; re-derive the bands before trusting the weights');

  for (const b of bands[1]) assert.equal(b.req, 1, 'tier 1 should need exactly 1 affinity');
  for (const b of bands[2]) {
    assert.ok(b.req >= 8 && b.req <= 15, `tier 2 needs ${b.req}, expected 8-15`);
  }
  for (const b of bands[3]) {
    assert.ok(b.req >= 22, `tier 3 needs ${b.req}, expected 22 or more`);
    assert.equal(b.grant, 0, 'tier 3 constellations grant no affinity');
  }
});

test('power weight rises with tier, in every scoring mode', () => {
  // The bug this replaced: chance/recharge scored tier 1 highest because tier 1 has
  // near-zero cooldowns, so the deepest powers in the game ranked LAST -- 1.00 / 0.76 /
  // 0.81 at rank 1 while costing 1 / 2.76 / 5.30 times as much to obtain.
  for (const mode of [1, 2]) {
    const w = t => powerWeightFor({ chance: 50 }, 3, { 1: 25, 2: 20, 3: 15 }[t], mode);
    assert.ok(w(2) > w(1), `tier 2 should outweigh tier 1 in mode ${mode}`);
    assert.ok(w(3) > w(2), `tier 3 should outweigh tier 2 in mode ${mode}`);
  }
  // Passives-only still ignores powers entirely -- that is what the mode means.
  assert.equal(powerWeightFor({ chance: 50 }, 3, 15, 0), 0);
});

test('power weight ignores proc chance and cooldown', () => {
  // Deliberate. They were measured against tier and track it either weakly or
  // backwards, and the thing that does scale -- effect magnitude per rank -- is not in
  // the extraction. Pinned so nobody reintroduces them without redoing that work.
  const a = powerWeightFor({ chance: 100 }, 0.5, 20, 2);
  const b = powerWeightFor({ chance: 15 }, 30, 20, 2);
  assert.equal(a, b,
    'two tier-2 powers with wildly different chance and cooldown scored differently');
});

test('a deeper power outranks a shallower one, all else equal', () => {
  // The tier model's core claim. Two constellations serving the same keywords should be
  // ordered by how deep their power is, because that is the only thing in the data that
  // tracks how hard the designers made it to reach.
  const picks = [chipId('Cold Damage')];
  const priority = priorityFor(picks, 1);
  const hits = c => picks.reduce((n, k) => n + (c.hits?.[k] ?? 0), 0);
  const withPower = Object.values(db.constellations)
    .filter(c => !c.crossroads && c.hasPower && c.power);

  let compared = 0;
  for (const a of withPower) {
    for (const b of withPower) {
      if (a.id === b.id || hits(a) !== hits(b)) continue;
      const ta = tierOf(a.power[2]);
      const tb = tierOf(b.power[2]);
      if (ta <= tb) continue;
      assert.ok(priority(a) > priority(b),
        `${a.name} (tier ${ta}) should outrank ${b.name} (tier ${tb}) at equal keyword `
        + `coverage, got ${priority(a).toFixed(2)} vs ${priority(b).toFixed(2)}`);
      compared++;
    }
  }
  assert.ok(compared > 0, 'found no equal-coverage pair at different tiers');
});

test('power weighting never produces an illegal path', () => {
  const picks = [chipId('Cold Damage'), chipId('Pierce Damage'), chipId('Casting Speed')];
  for (const m of [0, 1, 2]) {
    const { schedule } = selectConstellations(db, picks, { mode: m });
    assert.ok(schedule, `mode ${m} produced no schedule`);
    assert.ok(schedule.totalPoints <= 55, `mode ${m} spent ${schedule.totalPoints}`);
    for (const s of schedule.path) {
      assert.ok(s.runningPoints <= 55,
        `mode ${m}: running total hit ${s.runningPoints} at ${s.name}`);
    }
  }
});

test('passives-only mode truncates before powers, other modes complete them', () => {
  const picks = [chipId('Health'), chipId('Armor'), chipId('Physical Resistance')];
  const completedPowers = m => {
    const { solution } = selectConstellations(db, picks, { mode: m });
    return solution.filter(e =>
      e.starsTaken >= db.constellations[e.id].starCount
      && db.constellations[e.id].hasPower).length;
  };
  assert.ok(completedPowers(0) < completedPowers(2),
    'passives-only should complete fewer power constellations than max rank');
});

test('truncation never keeps a constellation whose affinity is load-bearing', () => {
  // A truncated constellation grants no affinity, so if anything downstream needed
  // it the whole path would be unreachable. Trimming is only accepted when the
  // solution still schedules, so this is really a guard against that check regressing.
  for (const picks of [
    [chipId('Health'), chipId('Armor'), chipId('Physical Resistance')],
    [chipId('Cold Damage'), chipId('Pierce Damage'), chipId('Casting Speed')],
    [chipId('Fire Retaliation')],
  ]) {
    const { schedule } = selectConstellations(db, picks, { mode: 0 });
    assert.ok(schedule, 'passives-only produced no schedule');
    assert.ok(schedule.totalPoints <= 55);
  }
});

test('truncation keeps stars that still carry a wanted keyword', () => {
  // Tsunami carries Cold Damage on stars 1, 4 and 5. Trimming to the shortest prefix
  // that merely covers the keyword would cut it to star 1 and bin two thirds of the
  // cold damage to save four points.
  const picks = [chipId('Cold Damage'), chipId('Pierce Damage'), chipId('Casting Speed')];
  const { solution } = selectConstellations(db, picks, { mode: 0 });
  const tsunami = solution.find(e => db.constellations[e.id].name === 'Tsunami');
  if (tsunami) {
    const c = db.constellations[tsunami.id];
    const lastWanted = c.perStar.reduce((acc, star, i) =>
      star.some(k => picks.includes(k)) ? i + 1 : acc, 0);
    assert.ok(tsunami.starsTaken >= lastWanted,
      `Tsunami cut to ${tsunami.starsTaken}, dropping a star that carries a wanted keyword`);
  }
});

test('pet keywords select pet-bonus constellations', () => {
  // Was Summon Limit, which left the picker as proc-only: `petLimit` is on the power
  // star of summon constellations and means how many of THAT summon the proc gives you
  // (Revenant 3 to 6 by rank, Bysmiel's Bonds 1), not a player-wide cap. The celestial
  // power chips now cover that intent better than the keyword ever did.
  const id = chipId('Crit Damage', 'pet');
  const { solution, schedule } = selectConstellations(db, [id]);
  assert.ok(schedule);
  assert.ok(solution.some(e => db.constellations[e.id].hits[id] > 0),
    'no selected constellation actually grants the pet keyword');
});

test('no browsable keyword is proc-only', () => {
  // A stat that appears ONLY on power stars describes the proc, not the player: "Skill
  // Duration" is how long a proc lasts, "Weapon Damage" is the proc dealing weapon
  // damage, `petLimit` is the summon's own cap. None of it scales to a character, so
  // none of it should be targetable. Computed from the data rather than a hand list, so
  // a future patch that adds a proc-only stat can't quietly put it back in the picker.
  const kw = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../keywords.json'), 'utf8'));
  const offenders = [];
  for (const ns of ['character', 'pet']) {
    for (const c of kw[ns]) {
      if (c.browsable && c.procOnly) offenders.push(`${c.keyword}[${ns}]`);
    }
  }
  assert.deepEqual(offenders, [], 'proc-only keywords are showing in the picker');

  // And the index must agree: nothing proc-only should have reached ui-index.json.
  const shown = new Set(keywordChips.map(c => `${c.label}|${c.ns}`));
  const leaked = [];
  for (const ns of ['character', 'pet']) {
    for (const c of kw[ns]) {
      if (c.procOnly && shown.has(`${c.keyword}|${ns}`)) leaked.push(`${c.keyword}[${ns}]`);
    }
  }
  assert.deepEqual(leaked, [], 'proc-only keywords leaked into the UI index');
});

test('Skill Duration is proc-only and Burn Duration is not', () => {
  // The distinction the whole rule rests on, pinned with the two examples that look
  // alike and are not: `skillActiveDuration` is the proc's own lifetime (33 stars, every
  // one a power star), while `offensiveSlowFireDurationModifier` is +% duration on YOUR
  // burn DoTs and sits on ordinary stars -- Owl, Ulzuin's Torch, Alladrah's Phoenix.
  const kw = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../keywords.json'), 'utf8'));
  const find = n => kw.character.find(c => c.keyword === n);

  const skill = find('Skill Duration');
  assert.ok(skill, 'Skill Duration keyword has gone missing');
  assert.equal(skill.procOnly, true, 'Skill Duration should be proc-only');
  assert.equal(skill.passiveStarCount, 0);
  assert.equal(skill.browsable, false);

  const burn = find('Burn Duration');
  assert.ok(burn, 'Burn Duration keyword has gone missing');
  assert.equal(burn.procOnly, false, 'Burn Duration is a real player stat');
  assert.ok(burn.passiveStarCount > 0, 'Burn Duration should sit on ordinary stars');
  assert.equal(burn.browsable, true);

  // And the split actually happened: damage and duration are separate chips.
  const dmg = find('Burn Damage');
  assert.ok(dmg, 'Burn Damage chip does not exist; the duration split did not happen');
  assert.notEqual(dmg.id, burn.id, 'damage and duration collapsed into one family again');
  assert.ok(!dmg.fields.some(f => /Duration/.test(f)),
    `Burn Damage still holds duration fields: ${dmg.fields.join(', ')}`);
  assert.ok(burn.fields.every(f => /Duration/.test(f)),
    `Burn Duration holds non-duration fields: ${burn.fields.join(', ')}`);
});

test('the cold DoT is called Frostburn, as in game', () => {
  const kw = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../keywords.json'), 'utf8'));
  const names = kw.character.map(c => c.keyword);
  assert.ok(names.includes('Frostburn Damage'), 'no Frostburn Damage chip');
  assert.ok(names.includes('Frostburn Duration'), 'no Frostburn Duration chip');
  // "Frost" alone would be the direct cold damage, which is a different stat.
  assert.ok(!names.includes('Frost Damage'),
    'the cold DoT is still labelled Frost rather than Frostburn');
});
