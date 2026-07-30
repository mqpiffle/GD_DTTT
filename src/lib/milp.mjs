// The devotion problem as a mixed-integer program.
//
// Greedy (select.mjs) is fast and always legal but has no idea what it's leaving on
// the table. This states the problem exactly so a real solver can answer it.
//
// VARIABLES
//   y[c,j] in {0,1}   star j of constellation c is taken
//   z[c]   in {0,1}   constellation c is COMPLETE (all its stars taken)
//
// OBJECTIVE  maximise  sum over stars of value(c,j) * y[c,j]
//   value = how many of your chosen keywords that star carries, plus a bonus on the
//   power star weighted by the three-way switch (power.mjs).
//
// CONSTRAINTS
//   1. budget      sum of all y  <=  55
//   2. precedence  y[c,j] <= y[c,parent(j)]
//        A star needs its parent. devotionLinks is a single-parent tree, verified.
//   3. completion  z[c] <= y[c,j]  for every star j
//        z can only be 1 when every star is taken. It appears nowhere with a positive
//        objective coefficient, so the solver only raises it to unlock requirements.
//   4. affinity    required[c,a] * y[c,root] <= sum over k != c of granted[k,a] * z[k]
//        Taking ANY star of c means taking its root (by precedence), and the game
//        checks the requirement at that moment. A constellation cannot satisfy its own
//        requirement, hence k != c.
//
// WHAT THIS DELIBERATELY DOES NOT MODEL
//   Crossroads refunds. In game you can buy a Crossroads to cross an affinity
//   threshold and refund it once the constellations behind it stand on their own, so
//   a transient Crossroads is effectively free. Modelling that needs the time
//   dimension -- which star you bought when -- and this formulation is a static set.
//   Here a Crossroads costs its point for good, which makes the model CONSERVATIVE:
//   it may spend 1-3 points that schedulePath() would have got back. Solve, then run
//   the result through schedulePath() to recover the refunds.

import { powerWeightFor, POWER_PRESSURE } from './power.mjs';
import { weightMap } from './wanted.mjs';



/** Value of a single star: weighted keyword hits, plus the power bonus. */
function starValue(c, starIndex, weights, mode) {
  const carried = c.perStar?.[starIndex] ?? [];
  let v = 0;
  for (const k of carried) v += weights.get(k) ?? 0;
  if (c.power && starIndex + 1 === c.powerStar) {
    const [chance, cooldown, cap] = c.power;
    v += powerWeightFor({ chance }, cooldown, cap, mode) * POWER_PRESSURE;
  }
  return v;
}

const yName = (ci, j) => `y_${ci}_${j}`;
const zName = ci => `z_${ci}`;

/**
 * @param db      as built by select.mjs buildDb()
 * @param wanted  array of chip ids
 * @param opts    { cap = 55, mode = 1 }
 * @returns { vars, objective, constraints, meta }
 */
export function buildModel(db, wanted, opts = {}) {
  const cap = opts.cap ?? db.maxPoints ?? 55;
  const mode = opts.mode ?? 1;
  const weights = weightMap(wanted);

  const cons = Object.values(db.constellations);
  const index = new Map(cons.map((c, i) => [c.id, i]));

  const objective = [];      // [{ name, coef }]
  const constraints = [];    // [{ name, terms: [{name, coef}], op, rhs }]
  const vars = [];

  // y variables + objective
  for (const [ci, c] of cons.entries()) {
    for (let j = 0; j < c.starCount; j++) {
      const name = yName(ci, j);
      vars.push(name);
      const v = starValue(c, j, weights, mode);
      if (v > 0) objective.push({ name, coef: +v.toFixed(6) });
    }
    vars.push(zName(ci));
  }

  // 1. budget
  constraints.push({
    name: 'budget',
    terms: cons.flatMap((c, ci) =>
      Array.from({ length: c.starCount }, (_, j) => ({ name: yName(ci, j), coef: 1 }))),
    op: '<=', rhs: cap,
  });

  // 2. precedence -- star j needs its parent
  for (const [ci, c] of cons.entries()) {
    const parents = c.starParents ?? [];
    for (let j = 0; j < c.starCount; j++) {
      const p = parents[j];
      if (p == null || p < 1) continue;              // root star
      constraints.push({
        name: `prec_${ci}_${j}`,
        terms: [{ name: yName(ci, j), coef: 1 }, { name: yName(ci, p - 1), coef: -1 }],
        op: '<=', rhs: 0,
      });
    }
  }

  // 3. completion
  for (const [ci, c] of cons.entries()) {
    for (let j = 0; j < c.starCount; j++) {
      constraints.push({
        name: `comp_${ci}_${j}`,
        terms: [{ name: zName(ci), coef: 1 }, { name: yName(ci, j), coef: -1 }],
        op: '<=', rhs: 0,
      });
    }
  }

  // 4. affinity requirements
  for (const [ci, c] of cons.entries()) {
    for (const [a, need] of Object.entries(c.required ?? {})) {
      if (!need) continue;
      const terms = [{ name: yName(ci, 0), coef: need }];
      for (const [ki, k] of cons.entries()) {
        if (ki === ci) continue;
        const g = k.granted?.[a] ?? 0;
        if (g) terms.push({ name: zName(ki), coef: -g });
      }
      constraints.push({ name: `aff_${ci}_${a}`, terms, op: '<=', rhs: 0 });
    }
  }

  return {
    vars, objective, constraints,
    meta: { cap, mode, constellations: cons.map(c => c.id), index },
  };
}

/**
 * CPLEX LP format -- readable by glpsol, CBC and HiGHS.
 *
 * Terms are wrapped across lines. The budget constraint alone is 559 terms, about
 * 6,700 characters, and several LP readers cap line length (the format's own
 * convention is 255). Wrapping is safe: in LP format a constraint continues until
 * its relational operator, so breaking between terms changes nothing.
 */
const WRAP = 8;   // terms per line

export function toLP(model) {
  const term = t => `${t.coef >= 0 ? '+' : '-'} ${Math.abs(t.coef)} ${t.name}`;
  const wrap = (terms, indent = '     ') => {
    const lines = [];
    for (let i = 0; i < terms.length; i += WRAP) {
      lines.push((i ? indent : '') + terms.slice(i, i + WRAP).map(term).join(' '));
    }
    return lines;
  };

  const out = [];
  out.push('\\ GD_DTTT -- Grim Dawn Devotion Theory-craft and Tracker Tool');
  out.push(`\\ budget ${model.meta.cap} points, power mode ${model.meta.mode}`);
  out.push('Maximize');
  if (model.objective.length) {
    const lines = wrap(model.objective);
    out.push(' obj: ' + lines[0]);
    for (const l of lines.slice(1)) out.push(l);
  } else {
    out.push(' obj: 0');
  }
  out.push('Subject To');
  for (const c of model.constraints) {
    const lines = wrap(c.terms);
    out.push(` ${c.name}: ${lines[0]}`);
    for (const l of lines.slice(1)) out.push(l);
    out[out.length - 1] += ` ${c.op} ${c.rhs}`;
  }
  out.push('Binaries');
  for (let i = 0; i < model.vars.length; i += 10) {
    out.push(' ' + model.vars.slice(i, i + 10).join(' '));
  }
  out.push('End');
  return out.join('\n');
}

/**
 * Minimal LP reader, used only to prove toLP() emits what buildModel() meant.
 * Not a general parser -- it understands exactly the subset we write.
 */
export function parseLP(text) {
  const objective = [];
  const constraints = [];
  const vars = [];
  let section = null, pending = null;

  const flush = () => { if (pending) { constraints.push(pending); pending = null; } };
  const readTerms = (s) => {
    const terms = [];
    const re = /([+-])\s*([\d.]+)\s+([A-Za-z_][\w]*)/g;
    let m;
    while ((m = re.exec(s))) {
      terms.push({ name: m[3], coef: (m[1] === '-' ? -1 : 1) * Number(m[2]) });
    }
    return terms;
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\\.*$/, '').trim();
    if (!line) continue;
    if (/^Maximize$/i.test(line)) { section = 'obj'; continue; }
    if (/^Subject To$/i.test(line)) { flush(); section = 'st'; continue; }
    if (/^Binaries$/i.test(line)) { flush(); section = 'bin'; continue; }
    if (/^End$/i.test(line)) { flush(); break; }

    if (section === 'obj') {
      objective.push(...readTerms(line.replace(/^obj:/, '')));
    } else if (section === 'st') {
      const named = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
      if (named) { flush(); pending = { name: named[1], terms: [], op: null, rhs: null }; }
      const body = named ? named[2] : line;
      const rel = body.match(/(<=|>=|=)\s*(-?[\d.]+)\s*$/);
      if (pending) {
        pending.terms.push(...readTerms(rel ? body.slice(0, rel.index) : body));
        if (rel) { pending.op = rel[1]; pending.rhs = Number(rel[2]); flush(); }
      }
    } else if (section === 'bin') {
      vars.push(...line.split(/\s+/).filter(Boolean));
    }
  }
  return { objective, constraints, vars };
}

/** Turn a solver's variable assignment back into [{id, starsTaken}]. */
export function solutionFromVars(model, values) {
  const byC = new Map();
  for (const [name, v] of Object.entries(values)) {
    if (v < 0.5 || !name.startsWith('y_')) continue;
    const [, ci] = name.split('_');
    byC.set(+ci, (byC.get(+ci) ?? 0) + 1);
  }
  return [...byC.entries()]
    .map(([ci, starsTaken]) => ({ id: model.meta.constellations[ci], starsTaken }))
    .filter(e => e.starsTaken > 0);
}
