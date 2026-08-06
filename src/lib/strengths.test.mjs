// Tests for reading what a character is built for off their gear.
//
// The failures here are quiet ones: a strength ranked from the wrong kind of field, a
// pet chip proposed to a character with no pets, an item silently contributing nothing.
// None of them throw, and all of them produce a plausible-looking tag list.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tallyGear, tallySkills, mergeTallies, strengths, chipMapper, attributeFocus,
  STRENGTH_THRESHOLD } from './strengths.mjs';

/** A minimal index in the shape build-items.mjs emits. */
function idx(items, fields) {
  const f = fields ?? ['offensiveColdModifier', 'offensiveFireModifier',
    'offensiveColdMin', 'offensiveColdModifierChance', 'defensiveFire'];
  const byName = new Map(f.map((n, i) => [n, i]));
  const out = {};
  for (const [rec, stats] of Object.entries(items)) {
    const s = [];
    for (const [k, v] of Object.entries(stats.s ?? stats)) s.push(byName.get(k), v);
    out[rec] = { s, j: stats.j ?? 0 };
  }
  return { prefix: 'records/', fields: f, items: out };
}

test('only DAMAGE TYPES are ranked', () => {
  // The reason is SCALE, and it is the only reason. Median rolls across the 14,008
  // indexed items: cold 50%, physical 42%, elemental 40% -- against casting speed 8% and
  // attack speed 8%. Sorting those together puts +35% movement speed above +30% physical
  // damage, which is nonsense in both directions. Within damage types a sum means
  // something.
  //
  // This comment used to give a second reason -- that armour rolls movement speed by
  // default -- and it was false. Movement speed is on 1.9% of items, almost all boots.
  // See the note on DAMAGE_TYPE in strengths.mjs.
  const index = idx({
    'items/a.dbr': { offensiveColdModifier: 100, characterRunSpeedModifier: 5000 },
  }, ['offensiveColdModifier', 'characterRunSpeedModifier']);
  const { totals } = tallyGear(['records/items/a.dbr'], index);
  const out = strengths(totals, f => `character:${f.replace('Modifier', '')}`);
  assert.equal(out.length, 1, 'movement speed is not a damage type');
  assert.equal(out[0].chip, 'character:offensiveCold');
});

test('an offensive stat that is not a damage TYPE does not rank', () => {
  // The category is not enough to decide this: `Offense` also holds offensive ability,
  // attack speed and crit damage. Nor is the `offensive` prefix enough --
  // `offensiveCritDamageModifier` looks exactly like a damage type and is not one, which
  // is why the type has to be checked against the game's own list.
  //
  // The first version of this test used characterOffensiveAbilityModifier, which does
  // not start with `offensive` at all -- so it never reached the filter and passed with
  // the filter DELETED. Caught by mutation.
  const index = idx({
    'items/a.dbr': { offensiveCritDamageModifier: 900, offensiveFireModifier: 10 },
  }, ['offensiveCritDamageModifier', 'offensiveFireModifier']);
  const { totals } = tallyGear(['records/items/a.dbr'], index);
  const out = strengths(totals, f => `character:${f.replace('Modifier', '')}`);
  assert.equal(out.length, 1, 'crit damage is not a damage type');
  assert.equal(out[0].chip, 'character:offensiveFire');
});

test('only PERCENTAGE modifiers count as a strength', () => {
  // A flat +8 cold on a weapon is a rounding error and says nothing about intent; a
  // +110% modifier is a deliberate choice and says everything. Letting flat rolls into
  // the ranking would let a pile of small ones outvote the stat a build is made of.
  const index = idx({
    'items/a.dbr': { offensiveColdMin: 500 },        // huge, flat, meaningless
    'items/b.dbr': { offensiveFireModifier: 40 },
  });
  const { totals } = tallyGear(['records/items/a.dbr', 'records/items/b.dbr'], index);
  const out = strengths(totals, f => `character:${f.replace('Modifier', '')}`);
  assert.equal(out.length, 1, 'the flat field should not rank');
  assert.equal(out[0].chip, 'character:offensiveFire');
});

test('Chance and Duration modifiers are not strengths', () => {
  // They change when or how long something applies, not how much of it there is.
  const index = idx({ 'items/a.dbr': { offensiveColdModifierChance: 90 } });
  const { totals } = tallyGear(['records/items/a.dbr'], index);
  assert.deepEqual(strengths(totals, f => `character:${f}`), []);
});

test('the threshold is a FRACTION of the leader, not a fixed count', () => {
  // The whole reason it exists: "take the top five" fills empty slots with noise. A
  // stray affix at a tenth of the leading stat is on a piece worn for something else,
  // and the solver would spend real points chasing it.
  const index = idx({
    'items/big.dbr': { offensiveColdModifier: 1000 },
    'items/small.dbr': { offensiveFireModifier: 100 },     // 10% of the leader
  });
  const { totals } = tallyGear(['records/items/big.dbr', 'records/items/small.dbr'], index);
  const out = strengths(totals, f => `character:${f.replace('Modifier', '')}`);
  assert.equal(out.length, 1, 'a stat at a tenth of the leader is noise');
  assert.equal(out[0].share, 1);

  // And a genuinely balanced pair both survive.
  const even = idx({
    'items/x.dbr': { offensiveColdModifier: 100 },
    'items/y.dbr': { offensiveFireModifier: 90 },
  });
  const t2 = tallyGear(['records/items/x.dbr', 'records/items/y.dbr'], even).totals;
  assert.equal(strengths(t2, f => `character:${f.replace('Modifier', '')}`).length, 2);
});

test('a character with nothing equipped has no strengths', () => {
  assert.deepEqual(strengths(new Map(), f => f), []);
  assert.deepEqual(strengths(null, f => f), []);
  const { totals, missing } = tallyGear([], idx({}));
  assert.equal(totals.size, 0);
  assert.deepEqual(missing, []);
});

test('a record the index does not know contributes nothing, quietly', () => {
  // Absence is by design, not loss: a plain medal whose only stat is bonus experience
  // carries no chip-mapped field and is simply not in the index.
  const index = idx({ 'items/known.dbr': { offensiveColdModifier: 50 } });
  const { totals } = tallyGear(['records/items/known.dbr', 'records/items/never.dbr'], index);
  assert.equal(totals.get('offensiveColdModifier'), 50);
});

test('CHARACTER wins over pet for a shared field name', () => {
  // Not a tie-break, a correctness rule. The namespaces share field names, but a pet
  // bonus lives in a separate record the item points at, which nothing here reads -- so
  // a field found ON an item is a character stat by construction.
  //
  // Getting it backwards reported a physical two-hander's biggest stat as a PET bonus,
  // which would propose a pet tag to a character with no pets.
  const keywords = {
    character: [{ id: 'offensivePhysical', browsable: true,
      fields: ['offensivePhysicalModifier'] }],
    pet: [{ id: 'offensivePhysical', browsable: true,
      fields: ['offensivePhysicalModifier'] }],
  };
  assert.equal(chipMapper(keywords)('offensivePhysicalModifier'), 'character:offensivePhysical');
});

test('an unbrowsable chip is never proposed', () => {
  // Proc-only stats describe what a celestial power does, not what the player has, and
  // cannot be picked in the tag library at all -- so proposing one would place a tag
  // that does not exist.
  const keywords = { character: [
    { id: 'real', browsable: true, fields: ['offensiveColdModifier'] },
    { id: 'procOnly', browsable: false, fields: ['offensiveFireModifier'] },
  ] };
  const chipOf = chipMapper(keywords);
  assert.equal(chipOf('offensiveColdModifier'), 'character:real');
  assert.equal(chipOf('offensiveFireModifier'), null);
});

// --- against the real character and the real index ---------------------------------

const SAVE = path.join(import.meta.dirname, '../../../player.gdc');
const INDEX = path.join(import.meta.dirname, '../../items-index.json');
const haveBoth = fs.existsSync(SAVE) && fs.existsSync(INDEX);

test('a real character resolves entirely against the shipped index',
  { skip: !haveBoth && 'needs player.gdc and items-index.json' }, async () => {
  const { readEquipment, equippedRecords } = await import('./gdc.mjs');
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const keywords = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../keywords.json'), 'utf8'));

  const eq = readEquipment(fs.readFileSync(SAVE));
  const { totals } = tallyGear(equippedRecords(eq), index);
  assert.ok(totals.size > 0, 'a real character should carry some stats');

  const out = strengths(totals, chipMapper(keywords));
  assert.ok(out.length > 0, 'and should be built for something');
  // Every proposal must be a chip the picker actually offers, or it places nothing.
  const ui = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../ui-index.json'), 'utf8'));
  const ids = new Set(ui.chips.map(c => c.id));
  for (const s of out) assert.ok(ids.has(s.chip), `${s.chip} is not a browsable chip`);
  // Ranked strongest first, and nothing below the bar survived.
  for (let i = 1; i < out.length; i++) assert.ok(out[i].value <= out[i - 1].value);
  assert.ok(out.every(s => s.share >= STRENGTH_THRESHOLD));
});

// --- attribute allocation ---------------------------------------------------------
//
// The signal that was missing, and the reason it matters: it is the only thing in a save
// that no drop can contaminate. A character wearing 23% casting speed may or may not be a
// caster; a character who spent all 26 of their points on Spirit has said so outright.

const bio = (physique, cunning, spirit) => ({
  // Attributes start at 50 and each point adds 8.
  physique: 50 + physique * 8, cunning: 50 + cunning * 8, spirit: 50 + spirit * 8,
});

test('all points in one attribute is read as a commitment', () => {
  const f = attributeFocus(bio(0, 0, 26));   // Farker, level 34
  assert.equal(f?.chip, 'character:characterIntelligence', 'Spirit was not recognised');
  assert.equal(f.points, 26, 'the point count is what makes the reason worth reading');
  assert.equal(f.share, 1);
});

test('a spread allocation says nothing', () => {
  // Someone meeting gear requirements, which is not a build statement. Proposing devotion
  // points chase attributes off the back of this would be inventing intent.
  assert.equal(attributeFocus(bio(12, 10, 11)), null,
    'an even spread was read as a decision');
  assert.equal(attributeFocus(bio(14, 9, 7)), null,
    '47% is a lean, not a commitment');
});

test('the threshold is a share, not a lead', () => {
  // 70% of the points, so a commitment even though the rest went elsewhere.
  assert.equal(attributeFocus(bio(21, 5, 4))?.chip, 'character:characterStrength');
  // 69% -- one point the other way, and it is a lean again.
  assert.equal(attributeFocus(bio(20, 5, 5)), null);
});

test('too few points is a sample size, not a decision', () => {
  // Everything a level 6 character has is in one attribute, trivially. Reading that as a
  // commitment would analyse noise and sound confident doing it.
  assert.equal(attributeFocus(bio(0, 0, 5)), null, 'five points is not a build');
  assert.equal(attributeFocus(bio(0, 0, 10))?.points, 10, 'ten is where it starts');
});

test('a character who has spent nothing is not a Physique build', () => {
  // All three tie at zero, so the sort picks one. The minimum is what stops that
  // becoming a confident proposal off an empty allocation.
  assert.equal(attributeFocus(bio(0, 0, 0)), null);
  assert.equal(attributeFocus(null), null, 'a missing bio should not throw');
});

test('base attributes, not the sheet', { skip: !haveBoth && 'needs player.gdc' }, async () => {
  // The bio stores BASE values -- Farker reads 50/50/258 where the sheet says
  // 387/434/305, because the sheet adds mastery bars, gear and devotion. Reading the
  // sheet's numbers would put the gear contamination straight back into the one signal
  // that does not have any.
  const { readCharacter } = await import('./gdc.mjs');
  const ch = readCharacter(new Uint8Array(fs.readFileSync(SAVE)));
  const f = attributeFocus(ch.bio);
  assert.equal(f?.chip, 'character:characterIntelligence', 'Farker is a Spirit build');
  // Points earned is level - 1, so spent plus unspent must come to exactly that.
  assert.equal(f.points + ch.bio.attributePoints, ch.level - 1,
    'the allocation does not add up, so the 50/8 arithmetic is wrong');
});

// --- occurrences qualify, percentages rank ----------------------------------------
//
// Measured on Farker before this existed: ranking by ITEM COUNT kept all nine damage
// types, because with twelve slots the counts run 1-3 and a one-item stat is 0.33x of a
// three-item leader -- a fractional threshold cuts nothing at that range. Ranking by
// PERCENTAGE alone cannot tell one enormous roll from a stat the kit is built around.
// Each number is used for the thing it is good at.

/** Two fields on the cold chip, so the same item feeding both can be tested. */
const COLD2 = ['offensiveColdModifier', 'offensiveColdMin', 'offensiveFireModifier',
  'offensivePierceModifier'];
const cold = f => (f.startsWith('offensiveCold') ? 'character:offensiveCold'
  : f.startsWith('offensiveFire') ? 'character:offensiveFire'
  : f.startsWith('offensivePierce') ? 'character:offensivePierce' : null);

test('one item is a roll, not a build, however big it is', () => {
  const index = idx({
    'items/weapon.dbr': { offensiveFireModifier: 500 },      // enormous, one slot
    'items/a.dbr': { offensiveColdModifier: 20 },
    'items/b.dbr': { offensiveColdModifier: 20 },
  }, COLD2);
  const { totals, sources } = tallyGear(
    ['records/items/weapon.dbr', 'records/items/a.dbr', 'records/items/b.dbr'], index);

  const s = strengths(totals, cold, { sources });
  assert.deepEqual(s.map(x => x.chip), ['character:offensiveCold'],
    'a 500% single-item roll outvoted a stat spread across two slots');
  assert.equal(s[0].items, 2, 'the item count should be reported, not just used');
});

test('the leader is the biggest QUALIFYING stat', () => {
  // Otherwise the disqualified freak roll still sets the bar, and everything real is
  // measured against a number that was thrown out -- quietly cutting the whole list.
  const index = idx({
    'items/weapon.dbr': { offensiveFireModifier: 500 },
    'items/a.dbr': { offensiveColdModifier: 50 },
    'items/b.dbr': { offensiveColdModifier: 50 },
    'items/c.dbr': { offensivePierceModifier: 30 },
    'items/d.dbr': { offensivePierceModifier: 30 },
  }, COLD2);
  const { totals, sources } = tallyGear(
    ['a', 'b', 'c', 'd', 'weapon'].map(n => `records/items/${n}.dbr`), index);

  const s = strengths(totals, cold, { sources });
  // Pierce is 60 of Cold's 100 -- 0.6, comfortably in. Measured against the discarded
  // 500 it would be 0.12 and would vanish.
  assert.deepEqual(s.map(x => x.chip),
    ['character:offensiveCold', 'character:offensivePierce']);
});

test('one item feeding two fields of a chip is still one item', () => {
  // Or a single piece qualifies a stat by itself, which is exactly what this prevents.
  //
  // Both fields have to be ones that SURVIVE the damage-type filter, or the second is
  // dropped before the union runs and the test proves nothing. The first version of this
  // used `offensiveColdMin`, which is not a Modifier -- it passed while keying the set by
  // record AND field, the very bug it was written to catch.
  const merged = () => 'character:offensiveCold';
  const index = idx({
    'items/a.dbr': { offensiveColdModifier: 40, offensiveFireModifier: 30 },
  }, COLD2);
  const { totals, sources } = tallyGear(['records/items/a.dbr'], index);
  assert.equal(sources.size, 2, 'the fixture should have two fields on the one item');
  assert.deepEqual(strengths(totals, merged, { sources }), [],
    'one item counted twice because it granted two fields of the same chip');
});

test('a negative roll is not evidence for the stat', () => {
  const index = idx({
    'items/a.dbr': { offensiveColdModifier: 60 },
    'items/cursed.dbr': { offensiveColdModifier: -10 },
  }, COLD2);
  const { totals, sources } = tallyGear(
    ['records/items/a.dbr', 'records/items/cursed.dbr'], index);
  assert.deepEqual(strengths(totals, cold, { sources }), [],
    'an item arguing AGAINST the stat was counted as a second source for it');
});

test('without sources every stat qualifies, as before', () => {
  // The gate is opt-in. Callers with no per-item data get the old behaviour rather than
  // an empty list, which would be a silent and total failure.
  const index = idx({ 'items/a.dbr': { offensiveColdModifier: 60 } }, COLD2);
  const { totals } = tallyGear(['records/items/a.dbr'], index);
  assert.equal(strengths(totals, cold).length, 1);
  assert.equal(strengths(totals, cold)[0].items, null, 'no sources means no count to report');
});

test('a real character: the single-item stat drops out',
  { skip: !haveBoth && 'needs player.gdc and items-index.json' }, async () => {
  const { readEquipment, equippedRecords } = await import('./gdc.mjs');
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const keywords = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../keywords.json'), 'utf8'));
  const { totals, sources } = tallyGear(
    equippedRecords(readEquipment(fs.readFileSync(SAVE))), index);

  const withGate = strengths(totals, chipMapper(keywords), { sources });
  assert.ok(withGate.length, 'a real character should have some strengths');
  // The invariant, rather than "the gate excluded something": whether any single-item
  // stat happens to be in the top few is a property of whatever save is sitting here,
  // and asserting on it makes the test fail when the save is replaced. The synthetic
  // fixtures above prove the exclusion; this proves it holds on real data.
  for (const s of withGate) {
    assert.ok(s.items >= 2, `${s.chip} qualified on ${s.items} item(s)`);
  }
  // And every stat the gate let through must be one a plain tally also found -- the gate
  // removes, it never invents.
  const plain = new Set(strengths(totals, chipMapper(keywords)).map(s => s.chip));
  for (const s of withGate) assert.ok(plain.has(s.chip), `${s.chip} appeared from nowhere`);
  // Ranking is still by percentage, so the list stays in descending value order.
  for (let i = 1; i < withGate.length; i++) {
    assert.ok(withGate[i - 1].value >= withGate[i].value,
      'the list is not ordered by percentage, so occurrences leaked into the ranking');
  }
});

// --- skills ----------------------------------------------------------------------
//
// The half the ranking was missing. Gear is chosen from what dropped; skill points are
// not. Measured on a real save the difference is not decorative: Pierce reads 30% on gear
// -- under the threshold, so invisible -- and 100% once skills count, while Elemental
// falls out of the top four entirely.

/** A skills index in the shape build-skills.mjs emits: [fieldIdx, rankCount, ...values]. */
function sidx(records, fields = ['offensiveColdModifier', 'offensiveFireModifier']) {
  const byName = new Map(fields.map((n, i) => [n, i]));
  const skills = {};
  for (const [rec, stats] of Object.entries(records)) {
    const s = [];
    for (const [k, vals] of Object.entries(stats)) {
      const a = [].concat(vals);
      s.push(byName.get(k), a.length, ...a);
    }
    skills[rec] = { s };
  }
  return { prefix: 'records/', fields, skills };
}

test('a skill contributes the value at the rank it is invested to', () => {
  const index = sidx({ 'skills/a.dbr': { offensiveColdModifier: [10, 20, 30, 40] } });
  const at = lvl => tallySkills([{ name: 'records/skills/a.dbr', level: lvl }], index)
    .totals.get('offensiveColdModifier');
  assert.equal(at(1), 10, 'rank 1 should read the first value, not the last');
  assert.equal(at(3), 30);
  assert.equal(at(4), 40);
});

test('a rank past the end of the list takes the last value', () => {
  // Real, not defensive: gear grants +N to skills, so an invested rank 4 can be played
  // at 8. The last value is the honest reading of a list that has run out; throwing or
  // returning zero would silently delete the biggest skills on a well-geared character.
  const index = sidx({ 'skills/a.dbr': { offensiveColdModifier: [10, 20, 30] } });
  assert.equal(
    tallySkills([{ name: 'records/skills/a.dbr', level: 9 }], index)
      .totals.get('offensiveColdModifier'), 30);
});

test('a single value with no rank list is a constant', () => {
  const index = sidx({ 'skills/a.dbr': { offensiveColdModifier: 25 } });
  for (const level of [1, 5, 40]) {
    assert.equal(
      tallySkills([{ name: 'records/skills/a.dbr', level }], index)
        .totals.get('offensiveColdModifier'), 25, `rank ${level} changed a constant`);
  }
});

test('an uninvested skill contributes nothing', () => {
  const index = sidx({ 'skills/a.dbr': { offensiveColdModifier: [10, 20] } });
  const t = tallySkills([{ name: 'records/skills/a.dbr', level: 0 }], index);
  assert.equal(t.totals.size, 0, 'a skill with no points in it was counted');
  assert.equal(t.missing.length, 0, 'and it is not missing, it is simply not taken');
});

test('two fields on one skill are read independently', () => {
  // The flat [idx, n, ...values] encoding is walked by length, so a wrong stride would
  // read the second field's values as the first field's ranks -- and produce numbers
  // that look entirely plausible.
  const index = sidx({
    'skills/a.dbr': { offensiveColdModifier: [10, 20, 30], offensiveFireModifier: [5, 6] },
  });
  const t = tallySkills([{ name: 'records/skills/a.dbr', level: 2 }], index);
  assert.equal(t.totals.get('offensiveColdModifier'), 20);
  assert.equal(t.totals.get('offensiveFireModifier'), 6);
});

test('a skill is a source, like an item', () => {
  const index = sidx({
    'skills/a.dbr': { offensiveColdModifier: [10] },
    'skills/b.dbr': { offensiveColdModifier: [10] },
  });
  const t = tallySkills([
    { name: 'records/skills/a.dbr', level: 1 },
    { name: 'records/skills/b.dbr', level: 1 },
  ], index);
  assert.equal(t.sources.get('offensiveColdModifier').size, 2,
    'points spent on a skill are a vote for the stat, and a more deliberate one than a roll');
});

test('a skill the index does not know is reported, not guessed at', () => {
  const t = tallySkills([{ name: 'records/skills/nope.dbr', level: 3 }],
    sidx({ 'skills/a.dbr': { offensiveColdModifier: [1] } }));
  assert.deepEqual(t.missing, ['records/skills/nope.dbr']);
  assert.equal(t.totals.size, 0);
});

test('merging adds totals and UNIONS sources', () => {
  // Adding the source COUNTS instead would be the obvious wrong thing and an invisible
  // one: the numbers would just come out a little high.
  const a = { totals: new Map([['x', 10]]), sources: new Map([['x', new Set(['i1', 'i2'])]]) };
  const b = { totals: new Map([['x', 5]]), sources: new Map([['x', new Set(['i2', 's1'])]]) };
  const m = mergeTallies(a, b);
  assert.equal(m.totals.get('x'), 15);
  assert.deepEqual([...m.sources.get('x')].sort(), ['i1', 'i2', 's1'],
    'a record counted in both tallies should still be one source');
});

test('skills change the answer on a real character',
  { skip: !haveBoth && 'needs player.gdc and items-index.json' }, async () => {
  const SKILLS = path.join(import.meta.dirname, '../../skills-index.json');
  if (!fs.existsSync(SKILLS)) return;
  const { readCharacter, readEquipment, equippedRecords } = await import('./gdc.mjs');
  const bytes = new Uint8Array(fs.readFileSync(SAVE));
  const chipOf = chipMapper(JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '../../keywords.json'), 'utf8')));

  const gear = tallyGear(equippedRecords(readEquipment(bytes)),
    JSON.parse(fs.readFileSync(INDEX, 'utf8')));
  const skl = tallySkills(readCharacter(bytes).skills,
    JSON.parse(fs.readFileSync(SKILLS, 'utf8')));
  assert.ok(skl.totals.size > 0, 'the skill index resolved nothing for a real character');

  const both = mergeTallies(gear, skl);
  const names = t => strengths(t.totals, chipOf, { sources: t.sources }).map(s => s.chip);
  assert.notDeepEqual(names(both), names(gear),
    'counting skills changed nothing, so they are not reaching the ranking');
  // Every combined total is at least the gear total: skills add, they never subtract a
  // stat out of existence.
  for (const [chip, v] of strengths(both.totals, chipOf, { sources: both.sources })
    .map(s => [s.chip, s.value])) {
    const g = strengths(gear.totals, chipOf).find(s => s.chip === chip);
    if (g) assert.ok(v >= g.value, `${chip} shrank when skills were added`);
  }
});

test('the reason damage types are ranked alone is SCALE, and the numbers say so',
  { skip: !haveBoth && 'needs items-index.json' }, () => {
  // A regression test on a CLAIM rather than on behaviour, because the claim is what
  // went wrong. The comment on DAMAGE_TYPE once justified the restriction by saying
  // armour rolls movement speed by default. It does not, and nobody checked -- the index
  // that disproves it was sitting in this repository the whole time.
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const total = Object.keys(index.items).length;

  const carrying = (field) => {
    const j = index.fields.indexOf(field);
    if (j < 0) return 0;
    let n = 0;
    for (const e of Object.values(index.items)) {
      const s = e.s ?? [];
      for (let i = 0; i < s.length; i += 2) if (s[i] === j && s[i + 1] > 0) { n++; break; }
    }
    return n;
  };
  const medianRoll = (field) => {
    const j = index.fields.indexOf(field);
    const vals = [];
    for (const e of Object.values(index.items)) {
      const s = e.s ?? [];
      for (let i = 0; i < s.length; i += 2) if (s[i] === j && s[i + 1] > 0) vals.push(s[i + 1]);
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor((vals.length - 1) / 2)];
  };

  // THE FALSE CLAIM. Movement speed is a boots stat, not a default.
  const runShare = carrying('characterRunSpeedModifier') / total;
  assert.ok(runShare < 0.05,
    `movement speed is on ${(runShare * 100).toFixed(1)}% of items, so "armour rolls it `
    + 'by default" is false -- do not put that reasoning back');

  // And commonness cannot be what separates casting speed from a damage type: they are
  // about equally common.
  const cast = carrying('characterSpellCastSpeedModifier') / total;
  const cold = carrying('offensiveColdModifier') / total;
  assert.ok(Math.abs(cast - cold) < 0.05,
    'casting speed and cold damage are about equally common, so commonness is not the reason');

  // THE REASON THAT SURVIVES. Damage types roll on one scale; speeds on another.
  const damage = ['offensiveColdModifier', 'offensivePhysicalModifier',
    'offensiveElementalModifier'].map(medianRoll);
  const speed = ['characterSpellCastSpeedModifier', 'characterAttackSpeedModifier']
    .map(medianRoll);
  for (const d of damage) {
    for (const s of speed) {
      assert.ok(d > s * 3,
        `a damage median of ${d} against a speed median of ${s} is not a wide enough gap `
        + 'to justify keeping them in separate rankings');
    }
  }
  // Whereas damage types agree with each other, which is what makes summing them sound.
  assert.ok(Math.max(...damage) < Math.min(...damage) * 2,
    'damage type medians are further apart than assumed; the commensurability claim needs '
    + 're-measuring');
});
