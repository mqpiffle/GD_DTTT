// Solve the devotion MILP, then hand the result to the scheduler for ordering.
//
// glpk.js is an optional dependency. If it's installed we solve exactly; if not we
// fall back to solver.mjs, a dependency-free local search that beats greedy by ~10%
// and is never worse. Either way the result is
// the same [{id, starsTaken}] shape, and either way it goes through schedulePath()
// afterwards -- the solver decides WHAT to take, the scheduler decides in what order
// and where Crossroads get bootstrapped and refunded.
//
//   npm i glpk.js
//
// Or solve offline with any MILP solver:
//   node scripts/build-milp.mjs "Cold Damage" "Pierce Damage" > devotion.lp
//   glpsol --lp devotion.lp -o devotion.sol
//   highs devotion.lp

import { buildModel, solutionFromVars } from './milp.mjs';
import { solveBest } from './solver.mjs';
import { priorityFor, trySchedule } from './select.mjs';

let glpkPromise;
async function loadGlpk() {
  if (glpkPromise === undefined) {
    glpkPromise = import('glpk.js')
      .then(m => (typeof m.default === 'function' ? m.default() : m.default ?? m))
      .catch(() => null);
  }
  return glpkPromise;
}

export async function solverAvailable() {
  return Boolean(await loadGlpk());
}

/**
 * @returns { solution, schedule, optimal, reason }
 *   optimal=true only when the MILP solved to proven optimality.
 */
export async function solve(db, wanted, opts = {}) {
  const cap = opts.cap ?? db.maxPoints ?? 55;
  const mode = opts.mode ?? 1;
  const glpk = opts.glpk ?? await loadGlpk();

  if (!glpk) {
    const local = solveBest(db, wanted, { cap, mode, timeBudgetMs: opts.timeBudgetMs });
    return { ...local, optimal: false, reason: 'local search (no glpk.js installed)' };
  }

  const model = buildModel(db, wanted, { cap, mode });
  const lp = {
    name: 'devotion',
    objective: {
      direction: glpk.GLP_MAX,
      name: 'value',
      vars: model.objective.map(t => ({ name: t.name, coef: t.coef })),
    },
    subjectTo: model.constraints.map(c => ({
      name: c.name,
      vars: c.terms.map(t => ({ name: t.name, coef: t.coef })),
      bnds: { type: glpk.GLP_UP, ub: c.rhs, lb: -Infinity },
    })),
    binaries: model.vars,
  };

  const res = await glpk.solve(lp, {
    msglev: glpk.GLP_MSG_OFF,
    presol: true,
    tmlim: opts.timeLimitSeconds ?? 20,
  });

  const status = res?.result?.status;
  const values = res?.result?.vars ?? {};
  const proven = status === glpk.GLP_OPT;
  if (!values || !Object.keys(values).length) {
    const local = solveBest(db, wanted, { cap, mode, timeBudgetMs: opts.timeBudgetMs });
    return { ...local, optimal: false, reason: 'solver returned nothing; used local search' };
  }

  const solution = solutionFromVars(model, values);

  // The MILP is a static set and knows nothing about Crossroads refunds, so it can
  // hand back a set the scheduler can't order within the cap. Fall back rather than
  // show an unplayable path.
  // The MILP picks the set; it says nothing about order, so the same priority the
  // local search uses is applied here too. Otherwise an exact solve would come back
  // ordered worse than an inexact one.
  const schedule = trySchedule(solution, db, cap, priorityFor(wanted, mode));
  if (schedule) {
    return {
      solution, schedule,
      optimal: proven,
      reason: proven ? 'solved to optimality' : `solver status ${status}`,
    };
  }
  const local = solveBest(db, wanted, { cap, mode, timeBudgetMs: opts.timeBudgetMs });
  return { ...local, optimal: false, reason: 'MILP set unschedulable; used local search' };
}
