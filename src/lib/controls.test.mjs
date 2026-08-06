// Tests for the controls: turning intent plus facts into target tags.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTROLS, RESISTS, applyControls, controlById, MAX_TAGS, EXCLUDED_RESIST,
  resistWeightOf } from './controls.mjs';

const index = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../ui-index.json'), 'utf8'));
const chipById = new Map(index.chips.map(c => [c.id, c]));

test('every tag a control can emit is a real, pickable chip', () => {
  // A control emitting an id the picker does not have would silently produce a build
  // missing the thing you asked for. Proc-only chips are worse than missing: they exist
  // but cannot be targeted, so the solver would ignore them without saying why.
  const inputs = Object.fromEntries(RESISTS.map(r => [r.key, 0]));   // force every branch
  for (const c of CONTROLS) {
    const out = c.suggest({ inputs }) ?? [];
    assert.ok(out.length > 0, `${c.id} suggested nothing`);
    for (const { tag, weight } of out) {
      const chip = chipById.get(tag);
      assert.ok(chip, `${c.id} emits "${tag}", which is not a chip in ui-index.json`);
      assert.notEqual(chip.browsable, false,
        `${c.id} emits ${chip.label}, which is proc-only and cannot be targeted`);
      assert.ok(weight >= 1 && weight <= 3, `${c.id} emits weight ${weight} for ${chip.label}`);
    }
  }
});




test('controls stack, and a shared tag keeps the higher weight', () => {
  // Wanting something for two reasons does not mean wanting it twice as much. It means
  // at least as much as the more emphatic reason.
  const a = { id: 'a', suggest: () => [{ tag: 'character:characterLife', weight: 1 }] };
  const b = { id: 'b', suggest: () => [{ tag: 'character:characterLife', weight: 3 }] };
  CONTROLS.push(a, b);
  try {
    const { tags } = applyControls(['a', 'b']);
    assert.equal(tags.length, 1, 'a shared tag was counted twice');
    assert.equal(tags[0].weight, 3, 'the shared tag lost the higher weight');
  } finally { CONTROLS.splice(CONTROLS.indexOf(a), 2); }
});

test('stacking past the tag limit keeps the earlier control and reports the rest', () => {
  // Silently dropping half of what was asked for is the failure worth avoiding: the
  // caller has to be able to say what did not fit.
  const { tags, dropped } = applyControls(['meta-offense', 'turtle', 'attributes']);
  assert.equal(tags.length, MAX_TAGS, `expected ${MAX_TAGS} tags, got ${tags.length}`);
  assert.ok(dropped.length > 0, 'nine tags into five slots should drop something');

  // Meta offense went first, so all of it survives.
  const kept = new Set(tags.map(t => t.tag));
  for (const { tag } of controlById('meta-offense').suggest({})) {
    assert.ok(kept.has(tag), 'the first control lost a tag to a later one');
  }
});

test('a control asked for nothing still returns nothing rather than guessing', () => {
  // The equaliser with no numbers must not invent them. An empty result is honest; a
  // default of zero would claim every resistance is dire.
  const { tags } = applyControls(['resist-equalizer'], {});
  assert.equal(tags.length, 0, 'the equaliser produced tags without being given any numbers');
});

test('every control declares what it needs', () => {
  for (const c of CONTROLS) {
    assert.ok(c.id && c.label && c.blurb, `${c.id} is missing its description`);
    assert.ok(Array.isArray(c.inputs), `${c.id} does not declare its inputs`);
    for (const i of c.inputs) assert.ok(i.key && i.label, `${c.id} has an unlabelled input`);
  }
});

// The equaliser's behaviours -- weakest resistance first, fire/cold/lightning collapsing
// to one tag, capped ones ignored, physical never proposed -- were tested here while it
// was a control. It is gone (a control that asks nine questions to tell you something it
// could work out is worse than none), and every one of those is now covered against
// proposeTags() in propose.test.mjs, which is where the logic actually runs.
//
// RESISTS and resistWeightOf are still exported and still the single source of "what
// counts as dire"; only the control that asked for the numbers has been removed.
test('the resistance vocabulary survives the control that used it', () => {
  assert.equal(RESISTS.length, 9, 'nine resistances, physical excluded');
  assert.ok(RESISTS.every(r => r.tag.startsWith('character:')));
  assert.ok(!RESISTS.some(r => r.tag === EXCLUDED_RESIST), 'physical stays out');
  // The thresholds themselves, which propose.mjs imports rather than copying.
  assert.equal(resistWeightOf(80), 0, 'capped wants nothing');
  assert.equal(resistWeightOf(30), 3, 'dire');
  assert.equal(resistWeightOf(50), 2);
  assert.equal(resistWeightOf(70), 1);
});

test('no preset asks the player for numbers any more', () => {
  // The equaliser was the only one that did. If a future control grows inputs, the UI
  // that rendered them is gone -- so this fails rather than the boxes silently vanishing.
  for (const c of CONTROLS) {
    assert.deepEqual(c.inputs, [], `${c.id} asks for input but nothing renders it`);
  }
});

// --- thresholds scale with level ---------------------------------------------------

test('the resistance thresholds are ENDGAME thresholds, scaled by level', () => {
  // 45/60/75 describe a level 100. Applied to a levelling character they call normal
  // progress an emergency: a level 35 on 32 aether is fine, because gear turns over every
  // few levels and Normal hits nothing hard enough to care.
  assert.equal(resistWeightOf(32, 35), 0, 'a level 35 on 32 resistance is not in trouble');
  assert.equal(resistWeightOf(32, 100), 3, 'a level 100 on 32 resistance is dying');

  // At Farker's level the line falls where a player would put it -- single digits, or
  // under twenty at a push.
  assert.equal(resistWeightOf(9, 35), 3, 'single digits are dire at any level');
  assert.equal(resistWeightOf(15, 35), 3);
  assert.equal(resistWeightOf(27, 35), 0, 'and the high twenties are fine at 35');
});

test('no level means no scaling', () => {
  // A hand-built character has not told us one, and guessing low would quietly stop
  // proposing resistances at all -- a control that silently does nothing.
  assert.equal(resistWeightOf(32), 3);
  assert.equal(resistWeightOf(32, null), 3);
});

test('the scale is clamped, so an impossible level cannot invert it', () => {
  assert.equal(resistWeightOf(80, 500), 0, 'a level past endgame should not raise the bar');
  assert.equal(resistWeightOf(0, 1), 3, 'zero resistance is dire even at level 1');
  assert.equal(resistWeightOf(0, -5), 3, 'a negative level should not flip the comparison');
});

test('scaling preserves the ordering of the three bands', () => {
  // Whatever the level, worse is never weighted lower than better. Getting the scale on
  // the wrong side of the comparison would silently reverse the whole judgement.
  for (const level of [25, 40, 60, 80, 100]) {
    let prev = 3;
    for (let v = 0; v <= 90; v++) {
      const w = resistWeightOf(v, level);
      assert.ok(w <= prev, `at level ${level}, ${v} resistance scored above ${v - 1}`);
      prev = w;
    }
  }
});
