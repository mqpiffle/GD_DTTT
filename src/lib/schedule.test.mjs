import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedulePath } from './schedule.mjs';
import { fixture as db } from './fixture.mjs';

// run with:  node --test
const sol = (...ids) => ids.map(id => ({ id, starsTaken: db.constellations[id].starCount }));

// Replays the path step by step and asserts every purchase was legal at the time.
function assertLegal(res) {
  let held = Object.create(null);
  for (const step of res.path) {
    const c = db.constellations[step.id];
    if (step.kind === 'refund') {
      for (const [a, v] of Object.entries(c.granted)) held[a] = (held[a] ?? 0) - v;
      continue;
    }
    for (const [a, v] of Object.entries(c.required ?? {}))
      assert.ok((held[a] ?? 0) >= v,
        `${step.id} needed ${a} ${v} but held ${held[a] ?? 0}`);
    for (const [a, v] of Object.entries(c.granted ?? {})) held[a] = (held[a] ?? 0) + v;
  }
  const peak = Math.max(...res.path.map(p => p.runningPoints));
  assert.ok(peak <= db.maxPoints, `peak spend ${peak} over cap`);
}

test('bootstraps with a crossroads and refunds it when the set becomes self-supporting', () => {
  const res = schedulePath(sol('solael', 'abomination'), db);
  assertLegal(res);
  const xr = res.path.find(p => p.id === 'xr_chaos' && p.kind === 'bootstrap');
  assert.ok(xr, 'should have bought a chaos crossroads');
  assert.equal(xr.refunded, true, 'crossroads should end up refunded');
  assert.equal(res.totalPoints, 9, '4 + 5, crossroads refunded');
});

test('keeps the crossroads when a later constellation still needs it', () => {
  const res = schedulePath(sol('solael', 'abomination', 'ulzuin'), db);
  assertLegal(res);
  const xr = res.path.find(p => p.id === 'xr_chaos' && p.kind === 'bootstrap');
  assert.notEqual(xr.refunded, true, 'ulzuin needs chaos 10, crossroads must stay');
  assert.equal(res.totalPoints, 15, '1 + 4 + 5 + 5');
  assert.equal(res.finalAffinity.chaos, 10);
});

test('handles two independent affinity chains', () => {
  const res = schedulePath(sol('falcon', 'eel', 'widow'), db);
  assertLegal(res);
  assert.equal(res.path.filter(p => p.kind === 'take').at(-1).id, 'widow',
    'widow depends on both, so goes last');
});

test('schedules partial constellations last', () => {
  const s = [...sol('solael'), { id: 'abomination', starsTaken: 2 }];
  const res = schedulePath(s, db);
  assertLegal(res);
  assert.equal(res.path.filter(p => p.kind === 'take').at(-1).id, 'abomination');
});

// --- interleaved partials -------------------------------------------------------
// Partials are appended last by default. `interleavePartials` lets them be ordered by
// priority instead, which the UI needs when re-ordering a path around what someone has
// already bought: a half-finished constellation you own has to be able to come first.
//
// Note assertLegal() above CANNOT police this -- it adds `granted` for every non-refund
// step, so it agrees with a bug that lets partials grant affinity. Hence the stricter
// replay here, which is the only thing standing between us and a plan that looks legal
// and isn't.

/** Replay knowing which entries are partial; partials must contribute nothing. */
function assertNoPartialAffinity(res, solution) {
  const taken = new Map(solution.map(e => [e.id, e.starsTaken]));
  let held = Object.create(null);
  for (const step of res.path) {
    const c = db.constellations[step.id];
    const sign = step.kind === 'refund' ? -1 : 1;
    const complete = !taken.has(step.id) || taken.get(step.id) >= c.starCount;
    if (sign > 0) {
      for (const [a, v] of Object.entries(c.required ?? {})) {
        assert.ok((held[a] ?? 0) >= v,
          `${step.id} needed ${a} ${v} but held ${held[a] ?? 0}`);
      }
    }
    if (complete) {
      for (const [a, v] of Object.entries(c.granted ?? {})) {
        held[a] = (held[a] ?? 0) + sign * v;
      }
    }
    for (const [a, v] of Object.entries(step.heldAfter ?? {})) {
      assert.equal(v, held[a] ?? 0,
        `after ${step.id} the scheduler held ${a} ${v}, but only ${held[a] ?? 0} was earned`);
    }
  }
}

test('interleaving lets priority pull a partial forward', () => {
  // Falcon and a 2-star Solael are independent -- each needs only its own Crossroads --
  // so nothing but the ordering rule decides which comes first.
  const s = [...sol('falcon'), { id: 'solael', starsTaken: 2 }];
  const firstTake = r => r.path.filter(p => p.kind === 'take')[0].id;

  // Worth knowing: the default cannot schedule this at all. Partials in the tail get
  // no Crossroads bootstrap of their own, so a partial whose affinity nothing else
  // supplies is simply unreachable. Interleaving fixes that as a side effect, because
  // the main loop's lookahead considers partials too.
  assert.throws(() => schedulePath(s, db), /partial solael requirement unmet/);

  const res = schedulePath(s, db, db.maxPoints,
    { priority: c => (c?.id === 'solael' ? 100 : 0), interleavePartials: true });
  assertLegal(res);
  assertNoPartialAffinity(res, s);
  assert.equal(firstTake(res), 'solael',
    'a prioritised partial should be able to go first');
});

test('an interleaved partial grants no affinity', () => {
  // Abomination grants chaos 4 -- but only when complete. Ulzuin needs chaos 10, and
  // xr_chaos + Solael give exactly 6. So this set is genuinely unreachable, and the
  // right answer is to say so. If a 2-star Abomination were allowed to contribute, it
  // would schedule happily and hand back a plan the game cannot produce.
  const s = [...sol('solael', 'ulzuin'), { id: 'abomination', starsTaken: 2 }];
  assert.throws(
    () => schedulePath(s, db, db.maxPoints,
      { priority: c => (c?.id === 'abomination' ? 100 : 0), interleavePartials: true }),
    /unreachable/,
    'a partial take was allowed to grant the affinity that unblocked Ulzuin');
});

test('reports unreachable solutions loudly', () => {
  assert.throws(() => schedulePath(sol('ulzuin'), db), /unreachable/);
});

test('respects a reduced point cap', () => {
  assert.throws(() => schedulePath(sol('solael', 'abomination', 'ulzuin'), db, 8),
    /budget exceeded/);
});
