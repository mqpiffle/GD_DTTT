export const AFFINITIES = ['ascendant', 'chaos', 'eldritch', 'order', 'primordial'];

const zero = () => Object.fromEntries(AFFINITIES.map(a => [a, 0]));
const add = (h, g, sign = 1) => {
  const out = { ...h };
  for (const [a, v] of Object.entries(g ?? {})) out[a] = (out[a] ?? 0) + sign * v;
  return out;
};
const satisfies = (held, req) =>
  Object.entries(req ?? {}).every(([a, v]) => (held[a] ?? 0) >= v);
const sumGrants = (entries, db) =>
  entries.reduce((h, e) => add(h, db.constellations[e.id].granted), zero());

const isComplete = (e, db) => e.starsTaken >= db.constellations[e.id].starCount;

// Which Crossroads to buy when nothing is currently reachable.
//
// Counting how many constellations it unblocks is necessary but not sufficient:
// it has no idea which ones you care about, so it will happily open the chain that
// unblocks three fillers over the one holding the power you built around. Weighting
// the unblocked set by priority fixes that without losing the feasibility guarantee,
// because `unblocked` still dominates the score.
/**
 * Which Crossroads to buy when something IS reachable but the thing you actually
 * want is one affinity point away.
 *
 * The loop below only reached for a Crossroads when nothing at all was reachable,
 * which meant it drained every currently-open filler first. Ask for Cold Damage
 * alone and you got Raven, Fox, Scholar's Light and Hawk -- 14 points carrying zero
 * cold stars between them -- before Tsunami, which needed nothing but primordial 1.
 * The priority sort was working perfectly and sorting the wrong pool.
 *
 * So: look one Crossroads ahead. If a point would open something that outranks
 * everything currently reachable, spend it. It is one point and release() refunds it
 * once the constellations behind it stand on their own.
 *
 * Returns null when no Crossroads improves on `bestNow`, which includes the case
 * where the best reachable pick is already the best there is.
 */
function lookahead(remaining, held, db, owned, priority, bestNow, room) {
  let best = null, bestVal = bestNow, bestOpened = 0;
  for (const cr of Object.values(db.constellations)) {
    if (!cr.crossroads || owned.has(cr.id)) continue;
    if (cr.starCount > room) continue;           // can't afford the probe
    const after = add(held, cr.granted);
    let val = -Infinity, opened = 0;
    for (const r of remaining) {
      const req = db.constellations[r.id].required;
      if (satisfies(held, req) || !satisfies(after, req)) continue;
      opened++;
      val = Math.max(val, priority(db.constellations[r.id]));
    }
    if (!opened) continue;
    // Strictly better, so a tie leaves the existing order alone. Count breaks ties
    // between Crossroads that open equally attractive things.
    if (val > bestVal || (val === bestVal && best && opened > bestOpened)) {
      best = cr; bestVal = val; bestOpened = opened;
    }
  }
  return best;
}

function bestUnblocker(remaining, held, db, owned, priority = () => 0) {
  let best = null, bestScore = 0;
  for (const cr of Object.values(db.constellations)) {
    if (!cr.crossroads || owned.has(cr.id)) continue;
    const after = add(held, cr.granted);
    const opened = remaining.filter(r => {
      const req = db.constellations[r.id].required;
      return !satisfies(held, req) && satisfies(after, req);
    });
    const unblocked = opened.length;
    const wanted = opened.reduce((s, r) => s + priority(db.constellations[r.id]), 0);
    const progress = remaining.reduce((n, r) =>
      n + Object.entries(db.constellations[r.id].required ?? {}).reduce(
        (m, [a, v]) => m + Math.min(cr.granted[a] ?? 0, Math.max(0, v - (held[a] ?? 0))), 0), 0);
    const score = unblocked * 1000 + wanted * 10 + progress;
    if (score > bestScore) { best = cr; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

/**
 * @param opts.priority  (constellation) => number, higher is taken sooner.
 *   Ordering is otherwise feasibility-greedy: grab the biggest affinity granters
 *   first so later requirements unlock. That is correct but joyless -- it buries
 *   the constellation you actually wanted behind cheap affinity feeders. Priority
 *   is applied as the FIRST sort key, with the affinity heuristic kept as the
 *   tiebreak, so the payoff arrives as early as the tree legally allows.
 *   Reordering is safe for point totals (the same set is taken either way) but can
 *   change how many Crossroads bootstraps are needed, so callers should fall back
 *   to an unprioritised run if this one throws.
 */
export function schedulePath(solution, db, cap = db.maxPoints ?? 55, opts = {}) {
  const priority = opts.priority ?? (() => 0);
  const complete = solution.filter(e => isComplete(e, db));
  const partial = solution.filter(e => !isComplete(e, db));

  // Partials grant no affinity, so they can never unblock anything, and by default
  // they are appended last -- they are the leftovers of a plan, bought with whatever
  // points remain. That is wrong when re-ordering around what someone has ALREADY
  // bought: a half-finished constellation you own has to be able to come first, and
  // no priority could move it while it sat in the tail.
  //
  // Opt-in rather than the new default. Scheduling partials earlier ties points up
  // earlier, which can turn a feasible plan infeasible, and every existing caller
  // wants the leftovers-last behaviour.
  const interleave = opts.interleavePartials === true;

  let held = zero();
  let spent = 0;
  const path = [];
  const owned = new Set();
  const temps = [];
  const placed = [];
  let remaining = interleave ? [...solution] : [...complete];

  const record = (id, points, kind) => {
    spent += points;
    path.push({ id, name: db.constellations[id].name, points, kind,
                runningPoints: spent, heldAfter: { ...held } });
  };

  // A temp is releasable if every constellation already placed stays valid,
  // and the projected final affinity still satisfies the whole solution.
  const releasable = (t) => {
    const after = add(held, db.constellations[t].granted, -1);
    if (!placed.every(id => satisfies(after, db.constellations[id].required))) return false;
    // Only complete takes will ever grant affinity, so only they may be projected.
    const projected = add(after, sumGrants(remaining.filter(e => isComplete(e, db)), db));
    return solution.every(e => satisfies(projected, db.constellations[e.id].required));
  };

  const release = () => {
    for (const t of [...temps]) {
      if (!releasable(t)) continue;
      const c = db.constellations[t];
      held = add(held, c.granted, -1);
      owned.delete(t);
      temps.splice(temps.indexOf(t), 1);
      const origin = path.find(p => p.id === t && p.kind === 'bootstrap' && !p.refunded);
      if (origin) origin.refunded = true;
      record(t, -c.starCount, 'refund');
    }
  };

  // Hold temporaries until a purchase would breach the cap, then release what we can.
  const afford = (points, id) => {
    if (spent + points <= cap) return;
    release();
    if (spent + points > cap)
      throw new Error(`budget exceeded at ${id}: ${spent + points} > ${cap}`);
  };

  let guard = 0;
  while (remaining.length) {
    if (++guard > 500) throw new Error('scheduler failed to converge');
    const candidates = remaining.filter(e =>
      satisfies(held, db.constellations[e.id].required));

    candidates.sort((a, b) => {
      const ca = db.constellations[a.id], cb = db.constellations[b.id];
      const g = o => Object.values(o.granted ?? {}).reduce((s, v) => s + v, 0);
      return priority(cb) - priority(ca) || g(cb) - g(ca) || ca.starCount - cb.starCount;
    });

    const buyCrossroads = (cr) => {
      afford(cr.starCount, cr.id);
      held = add(held, cr.granted);
      owned.add(cr.id);
      temps.push(cr.id);
      record(cr.id, cr.starCount, 'bootstrap');
    };

    // Is the payoff one Crossroads away? `bestNow` is -Infinity when nothing is
    // reachable, so this also serves the feasibility case -- and serves it better,
    // because it opens the branch you asked for rather than the widest branch.
    const bestNow = candidates.length
      ? priority(db.constellations[candidates[0].id]) : -Infinity;
    const ahead = lookahead(remaining, held, db, owned, priority, bestNow, cap - spent);
    if (ahead) { buyCrossroads(ahead); continue; }

    if (!candidates.length) {
      // Nothing reachable and no Crossroads looked better -- fall back to the
      // feasibility heuristic, which maximises doors opened rather than value.
      const cr = bestUnblocker(remaining, held, db, owned, priority);
      if (!cr) throw new Error('unreachable: no crossroads unblocks the solution');
      buyCrossroads(cr);
      continue;
    }

    const pick = candidates[0];
    afford(pick.starsTaken, pick.id);
    // A partial take grants nothing -- the affinity only lands on completion.
    held = add(held, isComplete(pick, db) ? db.constellations[pick.id].granted : null);
    owned.add(pick.id);
    placed.push(pick.id);
    record(pick.id, pick.starsTaken, 'take');
    remaining = remaining.filter(r => r.id !== pick.id);
  }

  // Partials grant no affinity so they can never unblock anything - but they
  // still have requirements of their own. Skipped when interleaving, since they were
  // already scheduled in the loop above.
  for (const e of (interleave ? [] : partial)) {
    if (!satisfies(held, db.constellations[e.id].required))
      throw new Error(`unreachable: partial ${e.id} requirement unmet`);
    afford(e.starsTaken, e.id);
    placed.push(e.id);
    record(e.id, e.starsTaken, 'take');
  }

  release();
  return { path, totalPoints: spent, finalAffinity: held };
}
