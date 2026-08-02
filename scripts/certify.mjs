// Is the local search leaving anything on the table?
//
// Runs both solvers on the same tags and scores BOTH answers with the MILP's objective,
// which the two agree on exactly (checked: all 559 stars, zero disagreement). Local
// search is what the app uses; the MILP proves optimality but needs glpk.js.
//
//   npm i glpk.js          # optional; without it this reports the fallback and stops
//   node scripts/certify.mjs
//   node scripts/certify.mjs "Cold Damage" "Health"      # one combo of your choosing
//
// Two traps this harness fell into first time, both worth not repeating:
//
//   1. It scored solutions by assuming a partial take means "the first k stars". The
//      MILP returns WHICH stars, and 58 of 109 constellations branch, so that scored a
//      different build from the one the solver chose. It now refuses to guess.
//   2. glpk.js failed to load and the failure was invisible -- solve.mjs catches
//      everything and falls back -- so the first run compared local search against
//      itself and reported a 0% gap.
import fs from 'node:fs';
import { buildDb } from '../src/lib/select.mjs';
import { solveBest } from '../src/lib/solver.mjs';
import { solve } from '../src/lib/solve.mjs';
import { buildModel } from '../src/lib/milp.mjs';

const dir = new URL('../', import.meta.url).pathname;
const index = JSON.parse(fs.readFileSync(dir + 'ui-index.json', 'utf8'));
const db = buildDb(index);

// The solvers want keyword IDs; humans want labels. Map one to the other so a combo
// can be written the way it reads in the picker.
const byLabel = new Map();
for (const c of index.chips ?? []) byLabel.set(`${c.ns ?? 'character'}:${c.label}`.toLowerCase(), c.id);
const id = label => {
  const k = byLabel.get(`character:${label}`.toLowerCase()) ?? byLabel.get(`pet:${label}`.toLowerCase());
  if (!k) throw new Error(`no chip labelled "${label}"`);
  return k;
};

/** The MILP's objective, evaluated on any solution. */
function objectiveOf(solution, wanted, mode) {
  const model = buildModel(db, wanted, { mode });
  const coef = new Map(model.objective.map(t => [t.name, t.coef]));
  const idx = new Map(Object.values(db.constellations).map((c, i) => [c.id, i]));
  let total = 0;
  for (const e of solution) {
    const ci = idx.get(e.id);
    // Refuse to guess. Assuming a prefix when the picks are missing scores a DIFFERENT
    // build from the one the solver returned, which is exactly how this harness first
    // reported a 4-28% gap that was measuring nothing.
    if (!Array.isArray(e.stars)) throw new Error(`${e.id}: solution carries no star picks`);
    for (const s of e.stars) total += coef.get(`y_${ci}_${s - 1}`) ?? 0;
  }
  return total;
}

const COMBOS = process.argv.slice(2).length
  ? [process.argv.slice(2)]
  : [
    ['Cold Damage', 'Health'],
    ['Chaos Damage', 'Shield Damage Blocked'],
    ['Fire Damage', 'Offensive Ability'],
    ['Physical Damage', 'Armor'],
    ['Lightning Damage', 'Defensive Ability'],
    ['Acid Damage', 'Poison Damage'],
    ['Vitality Damage', 'Health', 'Armor'],
    ['Pierce Damage', 'Attack Speed', 'Crit Damage'],
  ];

const MODE = 1;
console.log('tags'.padEnd(46), 'local'.padStart(9), 'milp'.padStart(9), 'gap'.padStart(8), '  status');
for (const tags of COMBOS) {
  const t0 = Date.now();
  const want = tags.map(id);
  const local = solveBest(db, want, { mode: MODE, timeBudgetMs: 350 });
  const tLocal = Date.now() - t0;
  const t1 = Date.now();
  let res;
  try { res = await solve(db, want, { mode: MODE }); }
  catch (e) { console.log(tags.join(' + ').padEnd(46), 'MILP threw:', e.message); continue; }
  const tMilp = Date.now() - t1;

  const vLocal = objectiveOf(local.solution, want, MODE);
  const vMilp = objectiveOf(res.solution, want, MODE);
  const gap = vMilp === 0 ? 0 : (vMilp - vLocal) / vMilp * 100;
  console.log(
    tags.join(' + ').padEnd(46),
    vLocal.toFixed(1).padStart(9),
    vMilp.toFixed(1).padStart(9),
    (gap >= 0 ? '+' : '') + gap.toFixed(2) + '%',
    ` ${res.optimal ? 'proven' : res.reason} | ${tLocal}ms vs ${tMilp}ms`);
}
