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
