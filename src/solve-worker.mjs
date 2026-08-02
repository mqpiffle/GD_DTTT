// Proves builds optimal, off the main thread.
//
// The page never waits for this. `build()` solves with local search and renders
// immediately, exactly as before; this runs afterwards and replaces the plan only if
// it finds something better. Everything here is therefore optional by construction --
// if the worker fails to start, or glpk.js will not load inside it, the app behaves
// precisely as it did before this file existed.
//
// Why it has to be off the main thread at all: local search is capped at 350ms because
// it runs synchronously, and a synchronous solve does not delay a frame, it freezes the
// page. Measured over twelve random tag combinations the MILP takes 186ms at best, 502ms
// median, and 3.6s at worst -- unremarkable in the background, unacceptable in front of
// someone dragging a weight star.
//
// It answers one question at a time and always answers the LATEST one. Requests carry a
// monotonic id; stale replies are dropped by the caller rather than here, because only
// the caller knows whether its inputs have moved on.

import { buildDb } from './lib/select.mjs';
import { solve } from './lib/solve.mjs';

let dbPromise;

// The worker fetches the index itself rather than being handed it. Cloning a 228 KB
// structure through postMessage on every request would cost more than some of the
// solves, and the browser serves the second request from cache anyway.
function getDb() {
  dbPromise ??= fetch('../ui-index.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(buildDb);
  return dbPromise;
}

self.addEventListener('message', async (e) => {
  const { id, wanted, mode, cap } = e.data ?? {};
  try {
    const db = await getDb();
    const r = await solve(db, wanted, { mode, cap });
    // Only a PROVEN optimum is worth sending. solve() falls back to local search when
    // glpk is missing or when the optimal set cannot be scheduled inside the cap, and
    // the caller already has a local-search answer -- posting a second one would just
    // make the path jump for no gain.
    if (!r.optimal || !r.solution?.length) {
      self.postMessage({ id, optimal: false, reason: r.reason ?? 'not proven' });
      return;
    }
    // The solution travels; the schedule does not. The caller re-schedules, because it
    // is the only side that knows about a manual drag order, and re-deriving is cheaper
    // than cloning a path and then having to redo it anyway.
    self.postMessage({ id, optimal: true, solution: r.solution });
  } catch (err) {
    self.postMessage({ id, optimal: false, reason: String(err?.message ?? err) });
  }
});
