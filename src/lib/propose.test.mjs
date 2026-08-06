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

test('a character below the analysis level is DECLINED, with a reason', () => {
  // Not a technical limit -- it all works on a level 10. The answer is just not useful:
  // gear turns over every few levels, resistances are whatever dropped, and there are
  // too few devotion points to fix any of it. Five confident tags off that is noise the
  // player cannot distinguish from signal.
  const r = proposeTags({
    level: 12,
    strengths: [S('character:offensiveCold', 200)],
    resists: { ...CAPPED, vitality: 10 },
  });
  assert.deepEqual(r.tags, [], 'nothing should be proposed');
  assert.match(r.tooEarly, /level 12/);
  assert.match(r.tooEarly, /around level 25/);
});

test('and runs anyway when asked', () => {
  // Someone who asks for it should get it. Declining is a default, not a rule.
  const r = proposeTags({
    level: 12, force: true,
    strengths: [S('character:offensiveCold', 200)],
    resists: CAPPED,
  });
  assert.equal(r.tags.length, 1);
  assert.equal(r.tooEarly, undefined);
});

test('an unknown level does not block analysis', () => {
  // A character typed in by hand has no level. Refusing to help them would be worse than
  // the noise the gate exists to prevent.
  const r = proposeTags({ strengths: [S('a', 1)], resists: CAPPED });
  assert.equal(r.tags.length, 1);
});

/**
 * Overcapped far enough to survive any penalty, so a difficulty test isolates the one
 * resistance under examination.
 *
 * 200 is not absurd: an endgame character genuinely carries numbers like this, and the
 * reason is exactly what these tests are about -- you need 80 AFTER the penalty, so
 * planning for Ultimate means 130 on the sheet.
 */
const OVERCAPPED = Object.fromEntries(Object.keys(CAPPED).map(k => [k, 200]));

test('resistances are weighted against the difficulty being PLANNED FOR', () => {
  // The mechanism is the game's own penalty rather than a second scale invented for it:
  // 80 fire reads 55 on Elite and 30 on Ultimate, so weighting the penalised number
  // harshens the thresholds by itself.
  //
  // This is what stops the tool telling someone about to step up that they are fine.
  const resists = { ...OVERCAPPED, fire: 80, cold: 80, lightning: 80 };

  // Comfortable where they are.
  assert.deepEqual(proposeTags({ resists, difficulty: 'normal' }).tags, []);

  // The same character stepping into Ultimate: 80 becomes 30, which is dire.
  const ult = proposeTags({ resists, difficulty: 'ultimate' });
  assert.equal(ult.tags.length, 1);
  assert.equal(ult.tags[0].tag, 'character:defensiveElementalResistance');
  assert.equal(ult.tags[0].weight, 3, 'elemental at an effective 30 is dire');
  assert.match(ult.reasons.get('character:defensiveElementalResistance'),
    /at 80, which is 30 on ultimate/);
});

test('the difficulty penalty is STAGGERED, so the two rows differ', () => {
  // Acid and pierce take theirs at Elite; vitality, aether, chaos and bleeding not until
  // Ultimate. Treating it as one flat number would flag four resistances that are
  // genuinely fine, on exactly the stats players neglect.
  const resists = { ...OVERCAPPED, acid: 80, vitality: 80 };

  const elite = proposeTags({ resists, difficulty: 'elite' });
  assert.deepEqual(elite.tags.map(t => t.tag), ['character:defensivePoison'],
    'only acid is penalised at Elite; vitality is untouched until Ultimate');

  const ultimate = proposeTags({ resists, difficulty: 'ultimate' });
  assert.deepEqual(ultimate.tags.map(t => t.tag).sort(),
    ['character:defensiveLife', 'character:defensivePoison'].sort(),
    'both rows are penalised at Ultimate');
  // And acid, one tier deeper, is worse off than vitality.
  const byTag = new Map(ultimate.tags.map(t => [t.tag, t.weight]));
  assert.ok(byTag.get('character:defensivePoison') > byTag.get('character:defensiveLife'));
});

test('an 80-across-the-board character is NOT fine for Ultimate', () => {
  // The finding that surprised me writing these: everything at 80 is comfortable on
  // Veteran and in real trouble on Ultimate, where it reads 30 on the top row and 55 on
  // the bottom. That is not the model over-reacting -- it is why endgame builds overcap
  // to 130 and beyond.
  const flagged = proposeTags({ resists: CAPPED, difficulty: 'ultimate' });
  assert.ok(flagged.tags.length > 0, 'an 80-everywhere character has work to do');
  assert.deepEqual(proposeTags({ resists: CAPPED, difficulty: 'normal' }).tags, [],
    'and none of it matters where they are now');
});
