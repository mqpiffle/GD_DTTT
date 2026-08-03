// Tests for turning a parsed save into a character.
//
// The real save is read by gdc.test.mjs; these cover the translation, which is where the
// quiet failures live. A mis-joined ref does not throw -- it produces a character that
// looks like it has bought fewer stars than it has, and there is nothing on screen to
// say so.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REF_PREFIX, refStem, starKeyByRef, mapDevotions, offPlan, characterLabel }
  from './import.mjs';

const CONS = [
  { id: 'constellation01', sr: ['tier1_01a.dbr', 'tier1_01b.dbr', 'tier1_01c.dbr'] },
  { id: 'constellation12', sr: ['tier2_04a.dbr', 'tier2_04b.dbr'] },
];

test('a ref maps to a 1-BASED star key', () => {
  // The tick keys are 1-based everywhere else in the app, and `sr` is a plain array, so
  // the off-by-one is the obvious mistake. It would not throw -- every imported tick
  // would silently land on the star before the right one.
  const map = starKeyByRef(CONS);
  assert.equal(map.get('tier1_01a.dbr'), 'constellation01:1');
  assert.equal(map.get('tier1_01c.dbr'), 'constellation01:3');
  assert.equal(map.get('tier2_04b.dbr'), 'constellation12:2');
});

test('the shared prefix is stripped, and a bare stem still works', () => {
  assert.equal(refStem(`${REF_PREFIX}tier1_01a.dbr`), 'tier1_01a.dbr');
  // Tolerant of an already-stripped value rather than returning null, so a caller that
  // hands over either form gets the same answer.
  assert.equal(refStem('tier1_01a.dbr'), 'tier1_01a.dbr');
  assert.equal(refStem(null), null);
});

test('an unmatched record is REPORTED, never dropped', () => {
  // The failure this exists to prevent: a star that does not map is progress lost, and
  // the character just looks like it bought less than it did. Silence is the bug.
  const { keys, unmatched } = mapDevotions([
    `${REF_PREFIX}tier1_01a.dbr`,
    `${REF_PREFIX}tier9_99z.dbr`,     // not in the index
    `${REF_PREFIX}tier2_04a.dbr`,
  ], CONS);
  assert.deepEqual(keys, ['constellation01:1', 'constellation12:1']);
  assert.equal(unmatched.length, 1);
  assert.match(unmatched[0], /tier9_99z/);
});

test('empty input is honest rather than convenient', () => {
  const { keys, unmatched } = mapDevotions([], CONS);
  assert.deepEqual(keys, []);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(mapDevotions(null, null).keys, []);
});

test('stars outside the current plan are counted, not lost', () => {
  // Ticks are stored per constellation and star, independent of any plan, but the panels
  // only draw constellations the CURRENT plan contains. Importing a character whose real
  // devotions differ from your tags is normal, and the stars are all still there -- but
  // "you have 52 and this plan shows 30" has to be said or it reads as data loss.
  const keys = ['constellation01:1', 'constellation01:2', 'constellation12:1'];
  const missing = offPlan(keys, ['constellation01:1', 'constellation01:2']);
  assert.deepEqual(missing, ['constellation12:1']);
  assert.deepEqual(offPlan(keys, keys), [], 'nothing off-plan when the plan covers it');
  assert.deepEqual(offPlan([], ['a']), []);
});

test('a class tag resolves to a name, and degrades without one', () => {
  const classes = { tagSkillClassName0607: 'Vindicator' };
  assert.equal(
    characterLabel({ name: 'Sparkles', level: 80, classId: 'tagSkillClassName0607' }, classes),
    'Sparkles (lvl 80 Vindicator)');
  // An unknown tag must not print the raw tag at someone.
  assert.equal(
    characterLabel({ name: 'Sparkles', level: 80, classId: 'tagSkillClassName9999' }, classes),
    'Sparkles (lvl 80)');
  assert.equal(characterLabel({ name: 'Nub' }, classes), 'Nub');
});

// --- against the real index -------------------------------------------------------
// ui-index.json is committed, so this always runs. It is the check that the build script
// and this reader agree about `sr` -- the two could drift silently otherwise, and the
// symptom would be an import that maps nothing.

const indexPath = path.join(import.meta.dirname, '../../ui-index.json');

test('every star in the shipped index has a unique, resolvable ref', () => {
  const ix = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const map = starKeyByRef(ix.constellations);
  const total = ix.constellations.reduce((n, c) => n + (c.sr?.length ?? 0), 0);
  assert.equal(total, 559, 'the tree has 559 stars');
  assert.equal(map.size, 559, 'a duplicate stem would silently merge two stars');
  // Every constellation must carry as many refs as it has stars, or the array indexes
  // stop lining up with the star numbers.
  for (const c of ix.constellations) {
    assert.equal(c.sr?.length, c.s, `${c.id} has ${c.s} stars but ${c.sr?.length} refs`);
  }
});
