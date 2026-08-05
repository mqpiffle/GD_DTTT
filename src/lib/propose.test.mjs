// Tests for composing an imported character into a starting tag set.
//
// The failures here are all of one kind: a proposal that looks reasonable and is not.
// Nothing throws, so every one of these has to be asserted deliberately.

import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeTags } from './propose.mjs';
import { MAX_TAGS } from './controls.mjs';

const S = (chip, value) => ({ chip, value, share: 1 });

/** Every resistance comfortably capped, so nothing is proposed from the defensive side. */
const CAPPED = {
  fire: 80, cold: 80, lightning: 80, acid: 80, pierce: 80,
  bleeding: 80, vitality: 80, aether: 80, chaos: 80,
};

test('strengths take the slots they earn and resistances fill the rest', () => {
  // The rule the whole module exists for. A fixed split -- say three and two -- would be
  // wrong for most characters: it would pad a two-strength build with a stray affix and
  // deny a five-strength one the damage type it has actually got.
  const { tags, reasons } = proposeTags({
    strengths: [S('character:offensiveCold', 184), S('character:offensiveSlowCold', 104)],
    resists: { ...CAPPED, vitality: 33, chaos: 38 },
  });
  assert.deepEqual(tags.map(t => t.tag), [
    'character:offensiveCold',
    'character:offensiveSlowCold',
    'character:defensiveLife',      // vitality 33, the weakest hole
    'character:defensiveChaos',     // chaos 38
  ]);
  // Two strengths, two holes, and a slot left empty rather than filled with noise.
  assert.ok(tags.length < MAX_TAGS, 'an empty slot beats a padded one');
  assert.match(reasons.get('character:offensiveCold'), /184% on your gear/);
  assert.match(reasons.get('character:defensiveLife'), /Vitality at 33/);
});

test('a character with no holes gets all five slots for strengths', () => {
  // Every resistance overcapped is a real case -- an endgame character has nothing to
  // shore up, and five damage tags is the honest answer rather than a failure.
  const { tags } = proposeTags({
    strengths: [S('a', 255), S('b', 255), S('c', 232), S('d', 232), S('e', 190),
      S('f', 100)],
    resists: CAPPED,
  });
  assert.equal(tags.length, MAX_TAGS);
  assert.deepEqual(tags.map(t => t.tag), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(tags.every(t => t.weight === 3), 'a strength is what the build IS');
});

test('the WEAKEST resistances get the scarce slots', () => {
  // Order matters when there is only room for some of them: points should go where it
  // hurts most, not wherever the sheet happens to list first.
  const { tags, dropped } = proposeTags({
    strengths: [S('character:offensiveFire', 300)],
    resists: { ...CAPPED, aether: 20, chaos: 70, vitality: 40, pierce: 55 },
  });
  assert.deepEqual(tags.slice(1).map(t => t.tag), [
    'character:defensiveAether',   // 20, dire
    'character:defensiveLife',     // 40, dire
    'character:defensivePierce',   // 55
    'character:defensiveChaos',    // 70, nearly there -- last in
  ]);
  assert.deepEqual(dropped, [], 'all four fitted');
  assert.equal(tags[1].weight, 3, 'aether at 20 is dire');
  assert.equal(tags[4].weight, 1, 'chaos at 70 is nearly there');
});

test('a capped resistance is never proposed', () => {
  // What stops a well-defended character being handed busywork. Anything at or above
  // target is worth no devotion points, so it does not appear at all.
  const { tags } = proposeTags({ strengths: [], resists: CAPPED });
  assert.deepEqual(tags, []);
});

test('an unknown resistance is unknown, not zero', () => {
  // A blank box means "I have not told you", and 0 means "this is zero". Treating the
  // first as the second would invent a dire hole out of a field the player skipped, and
  // it would look entirely plausible.
  const { tags } = proposeTags({ strengths: [], resists: { aether: 30 } });
  assert.equal(tags.length, 1, 'only the resistance actually supplied');
  assert.equal(tags[0].tag, 'character:defensiveAether');
});

test('fire, cold and lightning collapse to one tag, driven by the weakest', () => {
  // They share the only chip the tree offers, so proposing three would spend three slots
  // on one thing -- and the worst of them is what decides whether it is worth points.
  const { tags } = proposeTags({
    strengths: [],
    resists: { ...CAPPED, fire: 70, cold: 20, lightning: 65 },
  });
  assert.equal(tags.length, 1);
  assert.equal(tags[0].tag, 'character:defensiveElementalResistance');
  assert.equal(tags[0].weight, 3, 'cold at 20 should drive it, not fire at 70');
});

test('physical is never proposed, however low', () => {
  // The devotion tree offers 58% of physical in total at a median of 4 per star, against
  // 150-250% at a median of 15 for everything else. It is not a stat devotions can move,
  // so flagging it proposes a fix that does not exist.
  const { tags } = proposeTags({ strengths: [], resists: { ...CAPPED, physical: 0 } });
  assert.deepEqual(tags, []);
});

test('overflow is REPORTED, not silently discarded', () => {
  // Someone whose build wants more than five things should be told, not left to notice
  // that two of them are missing.
  const { tags, dropped } = proposeTags({
    strengths: [S('a', 5), S('b', 4), S('c', 3), S('d', 2), S('e', 1)],
    resists: { ...CAPPED, aether: 10, chaos: 10 },
  });
  assert.equal(tags.length, MAX_TAGS);
  assert.equal(dropped.length, 2, 'both crowded-out resistances should be named');
});

test('a strength and a resistance naming the same chip take one slot', () => {
  // Contrived but real: nothing stops a chip being both. Counting it twice would waste a
  // slot and imply the tool wants it more than it does.
  const { tags } = proposeTags({
    strengths: [S('character:defensiveAether', 200)],
    resists: { ...CAPPED, aether: 10 },
  });
  assert.equal(tags.length, 1);
  assert.equal(tags[0].weight, 3, 'the strength claimed it first');
});

test('nothing in, nothing out', () => {
  const { tags, dropped } = proposeTags({});
  assert.deepEqual(tags, []);
  assert.deepEqual(dropped, []);
});
