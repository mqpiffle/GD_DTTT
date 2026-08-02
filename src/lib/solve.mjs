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

// Finding glpk.js is fiddlier than it looks, for two separate reasons.
//
// 1. BARE SPECIFIERS ARE NODE-ONLY. `import('glpk.js')` resolves through node_modules
//    under Node and throws in a browser, which has no idea what the name means without
//    an import map or a bundler. This is why the first browser attempt never proved
//    anything: the import failed, solve() fell back, and the fallback is silent by
//    design. The relative paths below are what a browser can actually resolve, served
//    straight out of node_modules by any static server.
//
// 2. THE PACKAGE SHIPS TWO BUILDS. The default entry runs the solver in a Web Worker
//    of its own, spun up from a Blob URL. The `./node` subpath is the same solver
//    without that, loading its wasm relative to import.meta.url. Under Node the first
//    throws `Worker is not defined`; inside our own worker the second is preferable
//    anyway, since we are already off the main thread and nesting buys nothing.
//
// Everything is tried in turn and the first one that yields a working instance wins, so
// this stays correct if a future version reshuffles its entry points.
const GLPK_NODE = ['glpk.js/node', 'glpk.js'];
const GLPK_URL = [
  '../../node_modules/glpk.js/dist/glpk.js',
  '../../node_modules/glpk.js/dist/index.js',
];
const GLPK_ENTRIES = typeof Worker === 'undefined'
  ? [...GLPK_NODE, ...GLPK_URL]
  : [...GLPK_URL, ...GLPK_NODE];

let glpkPromise;
/** Which entry point actually worked, or why none did. Read by the worker's logging. */
export let glpkEntry = 'not attempted';
async function loadGlpk() {
  if (glpkPromise === undefined) {
    glpkPromise = (async () => {
      const tried = [];
      for (const entry of GLPK_ENTRIES) {
        try {
          const m = await import(/* @vite-ignore */ entry);
          const g = typeof m.default === 'function' ? await m.default() : m.default ?? m;
          if (g && g.GLP_MAX !== undefined) { glpkEntry = entry; return g; }
          tried.push(`${entry}: loaded but has no GLP_MAX`);
        } catch (err) {
          tried.push(`${entry}: ${err?.message ?? err}`);
        }
      }
      glpkEntry = `none (${tried.join(' | ')})`;
      return null;
    })();
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
