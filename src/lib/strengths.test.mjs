// Tests for reading what a character is built for off their gear.
//
// The failures here are quiet ones: a strength ranked from the wrong kind of field, a
// pet chip proposed to a character with no pets, an item silently contributing nothing.
// None of them throw, and all of them produce a plausible-looking tag list.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tallyGear, strengths, chipMapper, STRENGTH_THRESHOLD } from './strengths.mjs';

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
