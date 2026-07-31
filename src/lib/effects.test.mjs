import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { effectLines, renderLine, aggregate } from './effects.mjs';

// effectLines() returns { tmpl, v, v2, fields } so the numbers stay summable;
// render() is what a reader would see.
const render = stats => effectLines(stats, LABELS).map(renderLine);

const dir = path.join(import.meta.dirname, '../..');
const LABELS = {
  ...JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(dir, 'labels.extra.json'), 'utf8')),
};
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'devotions.raw.json'), 'utf8'));
const cons = name => raw.find(c => c.name === name);

test('a template label is substituted, not concatenated', () => {
  // labels.json holds three different things and treating them alike is how this
  // rendered "20 +{0} Defensive Ability". 310 entries are format strings carrying the
  // wording, the sign and the position of the number.
  assert.equal(LABELS.characterDefensiveAbility, '+{0} Defensive Ability');
  assert.deepEqual(render({ characterDefensiveAbility: 20 }), ['+20 Defensive Ability']);
  // A placeholder mid-string works the same way.
  assert.equal(LABELS.defensiveBlockModifier, 'Increases Shield Block Chance by {0}%');
  assert.deepEqual(render({ defensiveBlockModifier: 5 }), ['Increases Shield Block Chance by 5%']);
  // Nothing should ever reach the screen with a placeholder still in it.
  for (const c of raw) {
    for (const s of c.stars) {
      for (const line of render(s.stats)) {
        assert.doesNotMatch(line, /\{\d\}|\{v2?\}/, `unsubstituted placeholder: ${line}`);
      }
    }
  }
});

test('damage fields with no label at all still get a name', () => {
  // ~66 fields have no literal string; iagd composes them at runtime from the damage
  // type table, and damageKeyword() reproduces that.
  assert.equal(LABELS.offensiveColdModifier, undefined, 'fixture assumes this is unlabelled');
  assert.deepEqual(render({ offensiveColdModifier: 15 }), ['+15% Cold Damage']);
});

test('Min and Max are one statement, whatever order they appear in', () => {
  // Tsunami's power star lists offensiveColdMax BEFORE offensiveColdMin. A linear pass
  // rendered that as "37 Cold Damage" followed by "26-37 Cold Damage".
  const t = cons('Tsunami');
  const power = t.stars.find(s => s.proc);
  const keys = Object.keys(power.stats);
  assert.ok(keys.indexOf('offensiveColdMax') < keys.indexOf('offensiveColdMin'),
    'fixture no longer has Max before Min; find another');

  const lines = render(power.stats);
  const cold = lines.filter(l => /Cold Damage/.test(l));
  assert.deepEqual(cold, ['26-37 Cold Damage'], 'should be one merged range, not two lines');
});

test('a damage-over-time folds its duration into the same line', () => {
  assert.deepEqual(
    render({ offensiveSlowColdMin: 25, offensiveSlowColdDurationMin: 2 }),
    ['25 Frostburn Damage over 2 seconds']);
});

test('damage and duration modifiers are separate statements', () => {
  // Owl grants +50% damage AND +50% duration on every DoT -- two real bonuses that look
  // like a duplicate until you check.
  const owl = cons('Owl');
  const star = owl.stars.find(s => s.stats.offensiveSlowFireDurationModifier);
  assert.ok(star.stats.offensiveSlowFireModifier, 'fixture should have both');
  const lines = render(star.stats);
  assert.ok(lines.includes('+50% Burn Damage'), `no burn damage line: ${lines.join(' | ')}`);
  assert.ok(lines.includes('+50% Burn Duration'), `no burn duration line: ${lines.join(' | ')}`);
});

test('engine internals never surface', () => {
  const lines = render({ cameraShakeAmplitude: 3, projectileLaunchNumber: 2, characterLife: 40 });
  assert.deepEqual(lines, ['+40 Health']);
});

test('every star in the game renders without junk', () => {
  // The whole tree, not a fixture: no empty strings, no stray "undefined" or "NaN", no
  // leftover field names, and every line contains a digit -- a stat with no number in it
  // means a value was dropped somewhere.
  let total = 0;
  for (const c of raw) {
    for (const [i, s] of c.stars.entries()) {
      for (const line of render(s.stats)) {
        total++;
        const where = `${c.name} star ${i + 1}: "${line}"`;
        assert.ok(line.trim().length > 0, `empty line, ${where}`);
        assert.doesNotMatch(line, /undefined|NaN|null/, where);
        assert.doesNotMatch(line, /[a-z][A-Z]/, `looks like a raw field name, ${where}`);
        assert.match(line, /\d/, `no number in it, ${where}`);
      }
    }
  }
  assert.ok(total > 1000, `only ${total} lines rendered across the whole tree`);
});

test('the index carries an effect list for every star', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'ui-index.json'), 'utf8'));
  for (const c of idx.constellations) {
    assert.ok(Array.isArray(c.fx), `${c.n} has no fx array`);
    assert.equal(c.fx.length, c.s,
      `${c.n} has ${c.fx.length} effect lists for ${c.s} stars`);
  }
  // And it is actually populated -- an array of empty arrays would pass the shape check.
  // A power star's own numbers are the PROC, so they live in fxp and its fx is empty by
  // design; count either.
  let filled = 0, stars = 0;
  for (const c of idx.constellations) {
    for (let i = 0; i < c.s; i++) {
      stars++;
      if (c.fx[i].length || c.fxp[i].length) filled++;
    }
  }
  assert.ok(filled / stars > 0.9,
    `only ${filled} of ${stars} stars have any effects listed`);
});

test('a proc lives in fxp and never in the passive totals', () => {
  // 25 of the 62 powers define themselves inline on the star rather than through a
  // granted skill, so "a proc is whatever is in `grants`" was wrong -- Tsunami's
  // "0.7 Seconds Skill Recharge" was being summed into its passive total.
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'ui-index.json'), 'utf8'));
  const t = idx.constellations.find(c => c.n === 'Tsunami');
  assert.ok(t.pi, 'Tsunami should have a power star');

  assert.deepEqual(t.fx[t.pi - 1], [], 'the power star should contribute no passives');
  assert.ok(t.fxp[t.pi - 1].length > 3, 'the proc should be described in fxp');

  const proc = t.fxp[t.pi - 1].map(l => renderLine({ tmpl: l[0], v: l[1], v2: l[2] || null }));
  assert.ok(proc.some(l => /Skill Recharge/.test(l)), `no recharge in ${proc.join(' | ')}`);

  const passives = aggregate(t.fx.flat()
    .map(([tmpl, v, v2]) => ({ tmpl, v, v2: v2 || null, fields: [] })))
    .map(renderLine);
  assert.ok(!passives.some(l => /Skill Recharge|Fumble/.test(l)),
    `proc numbers leaked into the passive total: ${passives.join(' | ')}`);
  // And the aggregate really adds up: +15% on star 1 plus +24% on star 4.
  assert.ok(passives.includes('+39% Cold Damage'),
    `expected the summed cold line, got ${passives.join(' | ')}`);
});

test('every star has a chip id wherever one applies', () => {
  // The chip is what lets a tooltip pill a bonus you asked for. A line with no chip is
  // fine (not every stat is browsable) but the common ones must resolve.
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'ui-index.json'), 'utf8'));
  const all = idx.constellations.flatMap(c => c.fx.flat());
  const withChip = all.filter(l => l[3]).length;
  assert.ok(withChip / all.length > 0.7,
    `only ${withChip} of ${all.length} passive lines resolve to a keyword chip`);
  // Every chip id referenced must actually exist, or the pill colour lookup silently
  // fails and the bonus never highlights.
  const known = new Set(idx.chips.map(c => c.id));
  for (const l of all) {
    if (l[3]) assert.ok(known.has(l[3]), `unknown chip id on an effect line: ${l[3]}`);
  }
});
