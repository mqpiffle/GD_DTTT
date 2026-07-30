import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb } from './select.mjs';
import { buildModel, toLP, parseLP, solutionFromVars } from './milp.mjs';

const index = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../ui-index.json'), 'utf8'),
);
const db = buildDb(index);
const chipId = (label, ns = 'character') =>
  index.chips.find(x => x.label === label && x.ns === ns).id;

// --- brute force, straight from the game rules -------------------------------
// Deliberately written without reference to the MILP: pick a star count per
// constellation, check the rules directly. If the two agree on the optimum, the
// formulation encodes the rules correctly.
function bruteForce(sub, wanted, cap, mode) {
  const cons = Object.values(sub.constellations);
  // Mirror the model's weighting: a star is worth the sum of the weights of the
  // wanted keywords it carries, not a bare count.
  const w = new Map(wanted.map(x => (typeof x === 'string' ? [x, 2] : [x.id, x.weight])));
  const starVal = (c, j) =>
    (c.perStar?.[j] ?? []).reduce((n, k) => n + (w.get(k) ?? 0), 0);

  let bestVal = -1, bestPick = null;
  const pick = new Array(cons.length).fill(0);

  const evaluate = () => {
    const points = pick.reduce((s, k) => s + k, 0);
    if (points > cap) return;
    // affinity from COMPLETE constellations only
    const held = {};
    cons.forEach((c, i) => {
      if (pick[i] !== c.starCount) return;
      for (const [a, v] of Object.entries(c.granted ?? {})) held[a] = (held[a] ?? 0) + v;
    });
    // a constellation you bought into must have had its requirement met by OTHERS
    for (const [i, c] of cons.entries()) {
      if (!pick[i]) continue;
      for (const [a, need] of Object.entries(c.required ?? {})) {
        let from = 0;
        cons.forEach((k, ki) => {
          if (ki === i || pick[ki] !== k.starCount) return;
          from += k.granted?.[a] ?? 0;
        });
        if (from < need) return;
      }
    }
    let val = 0;
    cons.forEach((c, i) => { for (let j = 0; j < pick[i]; j++) val += starVal(c, j); });
    if (val > bestVal) { bestVal = val; bestPick = [...pick]; }
  };

  const recurse = (i) => {
    if (i === cons.length) { evaluate(); return; }
    for (let k = 0; k <= cons[i].starCount; k++) { pick[i] = k; recurse(i + 1); }
    pick[i] = 0;
  };
  recurse(0);
  return { value: bestVal, pick: bestPick, cons };
}

// Evaluate a candidate under the MILP's own constraint set.
function feasibleUnderModel(model, values) {
  for (const c of model.constraints) {
    const lhs = c.terms.reduce((s, t) => s + t.coef * (values[t.name] ?? 0), 0);
    if (c.op === '<=' && lhs > c.rhs + 1e-9) return false;
  }
  return true;
}
const objectiveOf = (model, values) =>
  model.objective.reduce((s, t) => s + t.coef * (values[t.name] ?? 0), 0);

function subsetDb(ids) {
  const constellations = {};
  for (const id of ids) constellations[id] = db.constellations[id];
  return { maxPoints: db.maxPoints, constellations };
}

test('LP output is well formed', () => {
  const model = buildModel(db, [chipId('Cold Damage')], { mode: 1 });
  const lp = toLP(model);
  // LP comments start with a backslash. Only the marker matters to a solver, not the
  // wording -- matching the whole title made a rename look like a malformed file.
  assert.match(lp, /^\\ \S/, 'first line should be an LP comment');
  assert.match(lp, /^\\ GD_DTTT/);
  assert.ok(lp.includes('Maximize'));
  assert.ok(lp.includes('Subject To'));
  assert.ok(lp.includes('Binaries'));
  assert.ok(lp.trimEnd().endsWith('End'));
  // every variable referenced in a constraint must be declared binary
  const declared = new Set(model.vars);
  for (const c of model.constraints) {
    for (const t of c.terms) assert.ok(declared.has(t.name), `${t.name} not declared`);
  }
});

test('LP text round-trips back to the same model', () => {
  // No solver in this environment, so the LP is verified by reading it back and
  // comparing against what buildModel() meant. Catches wrapping and sign errors.
  const model = buildModel(db, [chipId('Cold Damage'), chipId('Armor')], { mode: 2 });
  const back = parseLP(toLP(model));

  assert.deepEqual(back.vars, model.vars, 'binary declarations differ');
  assert.equal(back.objective.length, model.objective.length, 'objective term count differs');
  for (const [i, t] of model.objective.entries()) {
    assert.equal(back.objective[i].name, t.name);
    assert.ok(Math.abs(back.objective[i].coef - t.coef) < 1e-6,
      `objective coef for ${t.name}: ${back.objective[i].coef} vs ${t.coef}`);
  }
  assert.equal(back.constraints.length, model.constraints.length, 'constraint count differs');
  for (const [i, c] of model.constraints.entries()) {
    const b = back.constraints[i];
    assert.equal(b.name, c.name);
    assert.equal(b.op, c.op, `${c.name} operator`);
    assert.equal(b.rhs, c.rhs, `${c.name} rhs`);
    assert.equal(b.terms.length, c.terms.length, `${c.name} term count`);
    for (const [j, t] of c.terms.entries()) {
      assert.equal(b.terms[j].name, t.name, `${c.name} term ${j} name`);
      assert.ok(Math.abs(b.terms[j].coef - t.coef) < 1e-6, `${c.name} term ${j} coef`);
    }
  }
});

test('no LP line exceeds the conventional 255 character limit', () => {
  const lp = toLP(buildModel(db, [chipId('Cold Damage')], { mode: 1 }));
  const long = lp.split('\n').filter(l => l.length > 255);
  assert.deepEqual(long.map(l => l.slice(0, 40) + '…'), [],
    'long lines break stricter LP readers');
});

test('formulation matches the game rules on a reduced instance', () => {
  // Small enough to enumerate: a handful of cheap constellations plus two Crossroads.
  const ids = Object.values(db.constellations)
    .filter(c => c.starCount <= 4)
    .slice(0, 7)
    .map(c => c.id);
  const sub = subsetDb(ids);
  // Deliberately uneven weights -- equal ones would pass even if weighting were
  // ignored entirely.
  const wanted = [
    { id: chipId('Physique'), weight: 3 },
    { id: chipId('Health'), weight: 1 },
  ];
  const cap = 9;

  const brute = bruteForce(sub, wanted, cap, 1);
  assert.ok(brute.pick, 'brute force found nothing');

  // Encode the brute-force optimum as MILP variables and check the model agrees.
  const model = buildModel(sub, wanted, { cap, mode: 0 });   // mode 0 = no power bonus
  const values = {};
  for (const v of model.vars) values[v] = 0;
  brute.cons.forEach((c, ci) => {
    const ci2 = model.meta.constellations.indexOf(c.id);
    for (let j = 0; j < brute.pick[ci]; j++) values[`y_${ci2}_${j}`] = 1;
    if (brute.pick[ci] === c.starCount) values[`z_${ci2}`] = 1;
  });

  assert.ok(feasibleUnderModel(model, values),
    'game-legal optimum was rejected by the MILP constraints');
  assert.equal(Math.round(objectiveOf(model, values) * 1e6) / 1e6, brute.value,
    'MILP objective disagrees with the game-rules value');
});

test('MILP rejects assignments the game rules forbid', () => {
  const ids = Object.values(db.constellations).filter(c => c.starCount <= 4).slice(0, 7).map(c => c.id);
  const sub = subsetDb(ids);
  const model = buildModel(sub, [chipId('Physique')], { cap: 9, mode: 0 });
  const cons = model.meta.constellations;

  // Taking a non-root star without its parent must be infeasible.
  const skipParent = {};
  for (const v of model.vars) skipParent[v] = 0;
  const multi = cons.findIndex(id => sub.constellations[id].starCount > 1);
  skipParent[`y_${multi}_1`] = 1;                      // second star, no root
  assert.equal(feasibleUnderModel(model, skipParent), false,
    'precedence constraint did not bite');

  // Claiming completion without owning every star must be infeasible.
  const fakeComplete = {};
  for (const v of model.vars) fakeComplete[v] = 0;
  fakeComplete[`y_${multi}_0`] = 1;
  fakeComplete[`z_${multi}`] = 1;
  assert.equal(feasibleUnderModel(model, fakeComplete), false,
    'completion constraint did not bite');
});

test('a constellation cannot satisfy its own affinity requirement', () => {
  const model = buildModel(db, [chipId('Cold Damage')], { mode: 1 });
  for (const c of model.constraints) {
    if (!c.name.startsWith('aff_')) continue;
    const ci = c.name.split('_')[1];
    assert.equal(c.terms.some(t => t.name === `z_${ci}`), false,
      `${c.name} lets a constellation unlock itself`);
  }
});

test('solutionFromVars round-trips to scheduler input', () => {
  const model = buildModel(db, [chipId('Cold Damage')], { mode: 1 });
  const values = {};
  const ci = model.meta.constellations.indexOf(
    Object.values(db.constellations).find(c => c.starCount === 5).id);
  values[`y_${ci}_0`] = 1;
  values[`y_${ci}_1`] = 1;
  const sol = solutionFromVars(model, values);
  assert.equal(sol.length, 1);
  assert.equal(sol[0].starsTaken, 2);
  assert.ok(db.constellations[sol[0].id], 'id should resolve back to a constellation');
});
