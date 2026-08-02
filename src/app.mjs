// The whole app. Extracted verbatim from ui-mockup.html's inline <script> on 1 Aug --
// no behaviour changed in the move, which is what the test suite was for.
//
// Why it moved: the logic had grown to ~1950 lines living inside an HTML file whose
// actual markup is 1.7 KB. Everything it imports from ./lib is already a clean,
// DOM-free, tested module; this was the one part still trapped in a <script> tag. The
// test harness had to regex the block out of the HTML, rewrite its relative imports and
// load it from a data: URL purely because of that, and now imports it like anything
// else.
//
// The exports at the bottom exist for the tests. They are the surface those tests
// drive, kept explicit rather than reaching into the module.

import { renderLine, aggregate } from './lib/effects.mjs';
import { buildDb, priorityFor } from './lib/select.mjs';
import { solveBest, blockedPowers } from './lib/solver.mjs';
import { schedulePath } from './lib/schedule.mjs';
import { DEFAULT_WEIGHT, MAX_WEIGHT, clampWeight } from './lib/wanted.mjs';

const MAX = 5;
// [button label, tooltip]. The label is short enough to read as a tile; the
// explanation lives in the tooltip, so it can be a full sentence instead of the
// clipped fragment that fit under a button.
const MODES = [
  ['Passives', 'Celestial powers ignored entirely — constellations are worth only their'
    + ' passive stats and the affinity they grant'],
  ['Balanced', 'Celestial powers valued at the rank you actually buy them at, which is'
    + ' rank 1 for most of a levelling build'],
  ['CP Max', 'Celestial powers valued at their own maximum rank — favours going deep on'
    + ' a few powers over spreading across many'],
];
// The mode that scores powers at their cap, and therefore the one whose proc tooltips
// must show cap numbers. Named rather than written as `2` at the point of use, because
// the indices are load-bearing elsewhere (saved states, LEVEL_MODE) and a bare 2 in a
// display path reads like a magic number rather than a reference to this table.
const MAX_RANK_MODE = 2;

// How hard a dragged position pulls, against the ordinary keyword/power priority.
// Same 1e6 the bought-first boost used: a manual order is an instruction, not a hint,
// so it has to dominate rather than merely compete. The scheduler still refuses to
// emit an illegal path, which is what turns "I want this first" into "as early as the
// game allows" without any splice-then-repair logic here.
const ORDER_PRESSURE = 1e6;
const app = document.getElementById('app');

// `no-cache` means "revalidate", not "don't cache": the browser still stores the file
// and still sends If-None-Match, so an unchanged index costs a 304 with no body. What
// it stops is the browser serving a stale copy from memory without asking, which is
// what made "re-run build-ui-index.mjs and hard-refresh" a standing instruction --
// you would rebuild the index and the page would keep showing the previous one.
const raw = await fetch('../ui-index.json', { cache: 'no-cache' }).then(r => r.json());
const chips = raw.chips;
const db = buildDb(raw);

const state = {
  // Sized from MAX, not a literal -- a three-slot array silently caps you at three
  // picks no matter what MAX says, because sel.indexOf(null) can't find a fourth.
  sel: Array(MAX).fill(null), tab: 'character', mode: 1,
  weights: Array(MAX).fill(DEFAULT_WEIGHT),   // how much each slot's tag matters, 1-3
  open: new Set(['character|Offense']),
  plan: null, error: null, builtMode: null, solving: false,
  done: new Set(),        // stars ticked off in game, keyed constellation:star
  plain: false,           // Overview: the whole path as one scannable column
  // The manual order: constellation ids in the sequence you dragged them into, or
  // null for "whatever the solver chose". An INPUT, like tags and weights -- it is
  // something you decided, so it is saved and it outlives a reload. It does not
  // outlive a change to the constellation SET, though: see dropOrder().
  order: null,
  // The order as it was before the last drag, so an arrangement that turns out not to
  // fit in 55 points can be put back. Not persisted -- it describes one drag, not the
  // build.
  //
  // There was also a retry here that honoured just the constellation you dragged when
  // the whole arrangement wouldn't schedule. It was removed as dead code: measured
  // over 124 drags across two fixtures and both scoring modes, it never once rescued
  // an order the full arrangement couldn't take -- when a drop doesn't fit, ranking
  // that one constellation alone doesn't fit either. Worth re-testing before adding
  // anything like it back.
  orderPrev: null,
  // 'failed' when a stored order could not be applied to the build that came back.
  //
  // A DRAG can no longer produce this: infeasible positions are refused during the
  // drag, before you let go. It survives for the one case that can't be caught that
  // way -- a saved order restored on load, against a build re-solved from scratch.
  // solveBest() is time-budgeted, so the same tags can return a slightly different
  // set, and an order over constellations that are no longer all there may not
  // schedule. Surfaced in the Order button's tooltip rather than as a banner, because
  // it is rare and the button has already flipped back to saying "Order".
  orderNote: null,
  // --- the lock ---------------------------------------------------------------
  // Optional, off by default, and app-wide: a safety rail so a build can't be
  // dismantled by haphazard clicking while you're following it in game. Locked, the
  // only live controls are the two ends of your progress -- tick the next star,
  // un-tick the last one you bought -- and everything that shapes the build goes
  // read-only.
  //
  // Confining un-ticks to the frontier is what makes this cheap: it isn't a policy
  // laid over toggleStar(), it removes the destructive case entirely. The last bought
  // star has no bought descendants (they would be later in the path) and nothing
  // bought earlier stands on affinity it granted (that affinity arrived last), so
  // BOTH cascades in toggleStar() are provably no-ops at the frontier. Hence no undo
  // to offer and no confirmation to write for the common case.
  locked: false,
  // Dismissal for the "you're locked" dialog. Suppresses the DIALOG, never the rule --
  // once set, an out-of-frontier click simply does nothing.
  lockWarnSeen: false,
  // Transient, never persisted: 'unlock' (confirm leaving the lock) or 'frontier'
  // (you clicked a star the lock doesn't cover).
  dialog: null,
  // Power chips that can no longer fit alongside what's already chosen. Computed after
  // the solve rather than inside it -- the sweep costs ~250ms, which would be felt on
  // every keystroke for something that only starts blocking at four powers.
  blocked: new Set(),
  // Constellations with nowhere legal to go: every position either leaves them where
  // they are or costs more than 55 points. They are not draggable at all, because
  // offering a drag that can only ever be refused is the same mistake as offering a
  // power chip that can't fit -- see `blocked` above, which exists for exactly that.
  //
  // Swept off the critical path like `blocked` is: the check is one schedulePath() per
  // candidate position per row, so it is quadratic in the path length. It early-exits
  // on the first position that works, which most rows reach immediately, but the worst
  // case is ~160ms on an 18-step path and that is not something to spend inside a
  // render.
  immovable: new Set(),
};
let renderedTab = state.tab;

// --- undo --------------------------------------------------------------------
// One click can now do a lot: ticking a late constellation completes everything its
// affinity depends on, so a misclick is destructive in a way a single toggle never
// was. Undo covers exactly the thing those clicks mutate -- `state.done`.
//
// Depth is 60 because it costs nothing to be generous: a snapshot is at most 55
// short strings, so the whole stack is well under 100 KB, far below anything worth
// bounding for memory. 60 is "more steps than you'll take before noticing a
// mistake", which is the number that actually matters.
//
// In memory only, and cleared whenever a new plan is built: a snapshot from a
// different tag set refers to constellations that are no longer on screen, and
// restoring it would look like a bug.
const HISTORY_MAX = 60;
let history = [];

const pushHistory = () => {
  history.push(new Set(state.done));
  if (history.length > HISTORY_MAX) history.shift();
};
const clearHistory = () => { history = []; };

/**
 * Forget the manual order.
 *
 * Called whenever the constellation SET can change -- a tag, a weight, a scoring
 * mode. The order is a sequence over one particular set of constellations, and a
 * different solve is a different set: constellations you ranked may be gone, and ones
 * you never had an opinion about arrive with no rank at all. Those unranked arrivals
 * are the real reason this can't just be filtered and kept -- they would sort behind
 * everything ranked, which is exactly the "14 points of nothing before your first
 * wanted constellation" failure the path ordering was built to fix.
 *
 * It DOES survive a reload, ticking, and switching between Overview and Detail --
 * none of those change the set.
 */
function dropOrder() {
  state.order = null;
  state.orderPrev = null;
  state.orderNote = null;
}

function undo() {
  const prev = history.pop();
  if (!prev) return false;
  state.done = prev;
  return true;
}

/** Clear every tick without touching tags/weights/plan -- start this build's progress
 * over. Pushes onto the same history stack as a star click, so the (no-longer-shown)
 * undo() still recovers it via Ctrl+Z if this turns out to be a misclick. */
function resetProgress() {
  if (!state.done.size) return false;
  pushHistory();
  state.done = new Set();
  return true;
}

const groups = new Map();
for (const [i, c] of chips.entries()) {
  const key = `${c.ns}|${c.cat}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(i);
}

const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const aff = o => Object.entries(o).map(([k, v]) => `${v} ${k.slice(0, 3)}`).join(' · ') || '—';
const picked = () => state.sel.filter(x => x != null);

// --- persistence -------------------------------------------------------------
// Only INPUTS are stored (tags, mode, ticked stars), never the computed path. A
// saved path would go stale the moment the game data changes or the solver is
// touched; re-solving on load costs ~300ms and can't disagree with the current
// build. Ticks are keyed constellation:star, which stays valid regardless.
const STORE = 'gd-devotion-planner:v1';

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      v: 1,
      tags: state.sel.map(i => (i == null ? null : chips[i]?.id ?? null)),
      weights: [...state.weights],
      mode: state.mode,
      // The dragged order, as ids. Stored rather than the re-scheduled path, for the
      // same reason nothing else computed is stored: the path is re-derived on load,
      // so it can never disagree with the current data or solver.
      order: state.order,
      tab: state.tab,
      open: [...state.open],
      done: [...state.done],
      plain: state.plain,
      // The lock is an input like any other -- reloading mid-run should not quietly
      // hand back the controls it was put up to freeze. lockWarnSeen is a preference
      // and outlives any one build; state.dialog is transient and never stored.
      locked: state.locked,
      lockWarnSeen: state.lockWarnSeen,
    }));
  } catch { /* private mode or quota; running without persistence is fine */ }
}

function load() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return false; }
  if (!saved || saved.v !== 1) return false;

  // Chip ids can disappear if the keyword list changes between versions, so map
  // back by id and drop anything that no longer exists rather than crashing.
  state.sel = (saved.tags ?? Array(MAX).fill(null))
    .map(id => (id == null ? null : chips.findIndex(c => c.id === id)))
    .map(i => (i == null || i < 0 ? null : i));
  while (state.sel.length < MAX) state.sel.push(null);
  state.sel.length = MAX;

  state.weights = Array.from({ length: MAX },
    (_, i) => clampWeight(saved.weights?.[i] ?? DEFAULT_WEIGHT));
  if (Number.isInteger(saved.mode) && saved.mode >= 0 && saved.mode < MODES.length) {
    state.mode = saved.mode;
  }
  if (saved.tab === 'character' || saved.tab === 'pet') state.tab = saved.tab;
  if (Array.isArray(saved.open)) state.open = new Set(saved.open);
  if (Array.isArray(saved.done)) state.done = new Set(saved.done);
  state.plain = saved.plain === true;
  // Ids, not indices -- a constellation's position in the path is exactly the thing
  // this is trying to change, so an index would be meaningless by the time it is read.
  state.order = Array.isArray(saved.order) && saved.order.length ? saved.order.slice() : null;
  state.locked = saved.locked === true;
  state.lockWarnSeen = saved.lockWarnSeen === true;
  return picked().length > 0;
}

function reset() {
  state.sel = Array(MAX).fill(null);
  state.weights = Array(MAX).fill(DEFAULT_WEIGHT);
  state.plan = null;
  state.error = null;
  state.builtMode = null;
  state.done = new Set();
  state.order = null;
  state.mode = Math.min(state.mode, MODES.length - 1);
  // Undo restores progress only, so undoing a reset would bring back the ticks
  // without the tags -- a state you never had. Reset has its own deliberate button.
  clearHistory();
  try { localStorage.removeItem(STORE); } catch { /* nothing to clear */ }
  render();
}

// Power tags are pinned to the top weight. Not because it changes the build -- it
// provably doesn't -- but because the weight is the tie-break for which power is given
// up when several can't fit, and leaving it at whatever the slot happened to hold made
// that arbitrary. With all powers equal, resolveTargets' stable sort keeps selection
// order, so the rule is simply "the one you picked first wins".
const wantedList = () => state.sel
  .map((sel, slot) => (sel == null ? null : {
    id: chips[sel].id,
    weight: chips[sel].kind === 'power' ? MAX_WEIGHT : state.weights[slot],
  }))
  .filter(Boolean);

// A solve is synchronous, so a long one freezes the page rather than merely delaying
// it. 350ms of local search scores identically to 1500ms (measured), so the budget is
// capped there: the tail stops at ~350ms instead of ~470ms and nothing is lost. The
// debounce stops a five-tag selection from solving five times on the way.
const SOLVE_BUDGET_MS = 350;
const DEBOUNCE_MS = 180;
let solveTimer = null;

function scheduleBuild() {
  clearTimeout(solveTimer);
  if (!wantedList().length) {
    state.plan = null; state.error = null; state.solving = false;
    render();
    return;
  }
  state.solving = true;
  render();
  solveTimer = setTimeout(() => {
    // rAF then a task: rAF fires BEFORE paint, so scheduling the solve inside it
    // would still block the very frame meant to show "solving".
    requestAnimationFrame(() => setTimeout(build, 0));
  }, DEBOUNCE_MS);
}

function build() {
  const picks = wantedList();
  state.solving = false;
  if (!picks.length) { render(); return; }

  // Progress is keyed constellation:star, not by position in the path, so ticks
  // survive a rebuild -- switching scoring mode reorders things, but a star you
  // already bought in game is still bought.
  state.builtMode = state.mode;

  const { solution, schedule } = solveBest(db, picks, { mode: state.mode, timeBudgetMs: SOLVE_BUDGET_MS });
  if (!schedule) {
    state.plan = null;
    state.error = 'No legal path reaches those tags.';
    render();
    return;
  }

  // Record the mode this plan was solved under. Coverage reads ceilings from HERE,
  // not from state.mode: clicking a tab re-renders before the new plan exists, and
  // pairing the old star counts with the new mode's ceilings made the numbers jump
  // twice -- 6/12 to 6/8 and back -- which reads as a glitch.
  // solverSchedule is kept alongside so a drag -- and clearing a drag -- can
  // re-schedule without re-solving. That is not just a saving: solveBest() runs local
  // search against a TIME budget, so re-solving the same tags can return a different
  // set, and "dragging never changes the set" would then be true only by luck.
  state.plan = { schedule: orderedSchedule(solution, schedule), solution,
                 solverSchedule: schedule, mode: state.mode, proven: false };
  state.error = null;
  // A new path means the old snapshots describe a build that is no longer on screen.
  // Restoring one would tick constellations you can't see. Ticks themselves survive a
  // rebuild -- they are keyed constellation:star -- but the undo trail does not.
  clearHistory();
  render();
  scheduleBlockedSweep();
  scheduleMovableSweep();
  askForProof();
}

// --- proving the build optimal, in the background ----------------------------
// Local search is what you see first, always, because it is instant. It is also
// measurably not optimal: certified against glpk on eight tag combinations it came in
// between 3.8% and 34.2% below the proven best, and giving it 8s instead of 350ms
// changed nothing, so it is stuck rather than rushed.
//
// So the proof runs in a worker and replaces the plan when it lands. Nothing waits for
// it. If Workers are unavailable, if the file fails to load, or if glpk.js is not
// installed, `worker` stays null and the app is exactly what it was.
let proofWorker;
let proofSeq = 0;

/** Inputs the proof was asked about, so a late reply to an old question is dropped. */
const proofKey = () => JSON.stringify([wantedList(), state.mode, db.maxPoints ?? 55]);

// Absence of the "optimal" marker has to be diagnosable, and on screen it cannot be:
// it means "still working", "could not prove it", "worker never started" and "you
// changed your mind" all at once, and only the third is a fault. So each says which it
// is in the console. Nothing user-facing -- someone who doesn't open devtools is
// unaffected, and someone reporting "I never see optimal" can now say why.
const proofLog = (...a) => { try { console.info('[proof]', ...a); } catch { /* no console */ } };

function getProofWorker() {
  if (proofWorker !== undefined) return proofWorker;
  proofWorker = null;
  if (typeof Worker === 'undefined') {
    proofLog('no Worker in this environment; builds will not be proven');
    return proofWorker;
  }
  try {
    const w = new Worker(new URL('./solve-worker.mjs', import.meta.url), { type: 'module' });
    w.addEventListener('message', onProof);
    // A worker that dies takes the proof with it, not the app.
    w.addEventListener('error', (err) => {
      proofWorker = null;
      proofLog('worker failed to start or crashed; builds will not be proven.',
        'This is the one case that is a fault rather than an answer:', err?.message ?? err);
    });
    proofWorker = w;
    proofLog('worker started');
  } catch (err) {
    proofWorker = null;
    proofLog('could not create the worker; builds will not be proven:', err?.message ?? err);
  }
  return proofWorker;
}

function askForProof() {
  const w = getProofWorker();
  if (!w || !state.plan) return;
  const wanted = wantedList();
  if (!wanted.length) return;
  proofSeq += 1;
  pendingProof = { id: proofSeq, key: proofKey() };
  w.postMessage({ id: proofSeq, wanted, mode: state.mode, cap: db.maxPoints ?? 55 });
}

let pendingProof = null;

function onProof(e) {
  const { id, optimal, solution, reason, glpk } = e.data ?? {};
  // Three ways a reply is worthless: it answers a question we have moved on from, it
  // answers the current question but the inputs changed and changed back to something
  // that re-solved meanwhile, or it could not prove anything.
  if (!pendingProof || id !== pendingProof.id) return;
  if (proofKey() !== pendingProof.key) { proofLog('answer discarded: the tags moved on'); return; }
  pendingProof = null;
  if (!optimal || !solution?.length || !state.plan) {
    proofLog('not proven for these tags:', reason ?? 'no reason given',
      '| glpk:', glpk ?? 'unknown',
      '\n  The build shown is local search: correct and legal, but possibly not the best.');
    return;
  }

  // Re-schedule here rather than trusting a path built elsewhere: only this side knows
  // whether a manual drag order is in force, and applying it is the same work either way.
  let schedule;
  try {
    schedule = schedulePath(solution, db, db.maxPoints ?? 55,
      { priority: priorityFor(wantedList(), state.mode) });
  } catch {
    proofLog('proved a better set, but it cannot be ordered inside 55 points; keeping the current build');
    return;
  }

  proofLog('proven optimal; swapping the build in');
  state.plan = { schedule: orderedSchedule(solution, schedule), solution,
                 solverSchedule: schedule, mode: state.plan.mode, proven: true };
  render();
  scheduleMovableSweep();
}

// How well each requested tag is actually served by the built path. At five tags a
// build can quietly serve three of them well and ignore two, and nothing else on
// screen would say which -- the path lists constellations, not what you asked for.
/**
 * How MUCH of a tag this build actually grants, summed over the stars it takes.
 *
 * Star counts alone say a constellation giving +2% Cold Damage is worth the same as one
 * giving +40%, which is the complaint this answers. It is deliberately NOT folded into
 * the bar: a bar is a proportion and a proportion needs one unit, and **33 of the 81
 * tags carry both `+{v}%` and flat `{v}` lines** -- Offensive Ability, Defensive
 * Ability, Physique, Vitality Damage, Bleeding, Poison and the rest. Adding those
 * together produces a number that means nothing, and picking a "dominant" unit throws
 * away part of a third of the picker. So the bar keeps counting stars, where the
 * ceiling is well-defined and precomputed, and the magnitude is stated beside it in
 * whatever units the tag actually uses.
 *
 * Ranges keep both ends: summing the low ends of "26-37 Cold Damage" across four stars
 * understates the build by a third.
 *
 * @returns { pct, lo, hi } -- any of them null when the tag has no lines of that shape.
 */
function magnitudeOf(chipId) {
  if (!state.plan) return { pct: null, lo: null, hi: null };
  let pct = null, lo = null, hi = null;
  for (const e of state.plan.solution) {
    const c = db.constellations[e.id];
    if (!c?.starEffects) continue;
    for (const i of starIdxs(c, e.starsTaken, e.stars)) {
      for (const line of c.starEffects[i] ?? []) {
        const [tmpl, v, v2, chip] = line;
        if (chip !== chipId || !v) continue;
        if (/\{v\}%/.test(tmpl)) pct = (pct ?? 0) + v;
        else { lo = (lo ?? 0) + v; hi = (hi ?? 0) + (v2 || v); }
      }
    }
  }
  const tidy1 = n => (n == null ? null : (Number.isInteger(n) ? n : Math.round(n * 10) / 10));
  return { pct: tidy1(pct), lo: tidy1(lo), hi: tidy1(hi) };
}

/** Magnitude as the short string the row shows: "+39% · 104-148", or '' for nothing. */
function magnitudeText(m) {
  const parts = [];
  if (m.pct) parts.push(`+${m.pct}%`);
  if (m.lo) parts.push(m.hi && m.hi !== m.lo ? `${m.lo}-${m.hi}` : `+${m.lo}`);
  return parts.join(' \u00b7 ');
}

function coverageHtml() {
  if (!state.plan) return '';
  const picks = wantedList();
  if (!picks.length) return '';

  const counts = picks.map(({ id, weight }) => {
    const chip = chips.find(c => c.id === id);
    // A celestial power is binary -- you secured it or you didn't -- so got/ceiling and
    // a proportional bar say nothing. It gets its own row shape.
    if (chip?.kind === 'power') {
      const e = state.plan.solution.find(x => x.id === chip.cons);
      return {
        label: chip.label, weight, power: true,
        cons: consName(chip.cons),
        got: Boolean(e && (e.stars ?? []).includes(chip.star)),
        cost: e ? e.starsTaken : chip.min,
        size: chip.size,
      };
    }
    return {
      label: chip?.label ?? id,
      pet: chip?.ns === 'pet',
      weight,
      // A single physical ceiling, powers off -- see build-ui-index.mjs. The array
      // form is an older index; tolerate it so a stale ui-index.json still renders.
      ceiling: Array.isArray(chip?.ceiling)
        ? Math.max(...chip.ceiling)
        : (chip?.ceiling ?? 0),
      // Every star in the tree carrying this keyword, ignoring the 55-point cap.
      // Only shown where it exceeds the ceiling, which is the case for 61 of 81
      // browsable keywords.
      total: chip?.stars ?? 0,
      stars: state.plan.solution.reduce(
        (n, e) => n + (db.constellations[e.id]?.hits?.[id] ?? 0), 0),
      mag: magnitudeOf(id),
    };
  });

  // The bar is measured against each keyword's CEILING -- the most you could get if it
  // were your only target and you spent all 55 points on it -- not against the
  // best-served tag. That distinction is the whole point: Physical Damage is on 37 stars
  // spread over 17 constellations that cost 95 points between them, so 23 stars is
  // everything a 55-point build can reach. Scaling against other tags made a maxed-out
  // keyword look neglected, and no amount of extra weight could ever "fix" it.
  // Keyword rows only. A power row has no star count and no weight that means anything,
  // and including them broke this silently: `c.stars` is undefined on a power, so the
  // sum went NaN, `|| 1` turned that into 1, and every keyword's share of the stars
  // became enormous -- so the amber under-served flag could never fire again the moment
  // you picked a power.
  const kwRows = counts.filter(c => !c.power);
  const totalStars = kwRows.reduce((n, c) => n + c.stars, 0) || 1;
  const totalWeight = kwRows.reduce((n, c) => n + c.weight, 0) || 1;

  // Coverage is the readout most likely to be misread -- a short bar looks like the
  // solver ignoring you, when nine times in ten it is the tree not having the stars.
  // The explanation is long enough that it belongs behind an icon rather than in the
  // margin, so the panel stays scannable for people who already know.
  const covInfo = proseTip('How coverage works',
    'Each row is one of your target tags. The bar is how many stars in this build carry'
    + ' that tag, measured against its CEILING — the most you could get if it were your'
    + ' only tag and you spent all 55 points chasing it.',
    'Measuring against the ceiling rather than against your best-served tag is the whole'
    + ' point. For example, Physical Damage sits on 37 stars, but they are spread over 17'
    + ' constellations costing 95 points between them — so 23 stars is everything a'
    + ' 55-point build can reach, and a bar at 23 is full. Scaled against other tags it'
    + ' looked neglected instead, and no amount of extra weight could ever fix that.',
    'Green means you have taken everything available within 55 points. Amber means the'
    + ' tag got well under the share of stars its weight asked for AND there was room to'
    + ' do better — so it is worth re-weighting. A tag on zero is never impossible:'
    + ' across 30 measured builds every zero had a ceiling of 3–18 stars, so it always'
    + ' means your other tags spent the points first.',
    'A dimmed number in brackets is how many stars in the whole tree carry that tag,'
    + ' where that is more than 55 points can reach. It is context, not a target: 4/23'
    + ' [37] means the tree has 37, a build like yours can reach 23 of them, and you'
    + ' have 4. Green at 23 is still full marks.',
    'Stars count occurrences, not magnitude — a +2% bonus counts the same as a +40% one.'
    + ' Celestial powers get a tick instead of a bar: they are secured outright or'
    + ' reported as not fitting, so there is no partial to measure.');

  return `<p class="lbl" style="margin-top:16px">Coverage <i class="ti ti-info-circle covi"${
    covInfo}></i></p><div class="cov${
    state.solving ? ' stale' : ''}">${
    counts.map(c => {
      if (c.power) {
        const note = c.got
          ? `${c.label} secured -- ${c.cost} of ${c.cons}'s ${c.size} stars`
          : `${c.label} could not be fitted alongside your other picks`;
        return `<div class="covrow pow${c.got ? ' maxed' : ' zero'}" title="${esc(note)}">
        <span class="cn w${c.weight}">${esc(c.label)} <span class="cpc">CP</span></span>
        <span class="cb pow">${c.got
          ? `<span class="powcons">${esc(c.cons)} ${c.cost}/${c.size}</span>`
          : '<span class="powcons">no room</span>'}</span>
        <span class="cmax">${c.got ? 'got' : ''}</span>
        <span class="cv">${c.got ? '<i class="ti ti-check"></i>' : '&mdash;'}</span>
      </div>`;
      }
      const ceiling = Math.max(c.ceiling || 0, c.stars);
      const pct = ceiling ? c.stars / ceiling : 0;
      const maxed = c.stars > 0 && c.stars >= ceiling;
      // Only call something under-served if there was actually room to do better.
      const under = c.stars > 0 && !maxed
        && (c.stars / totalStars) < (c.weight / totalWeight) * 0.6;
      const cls = c.stars ? (maxed ? ' maxed' : under ? ' under' : '') : ' zero';
      // "none" was the wrong word and it hid the useful fact. Measured over 30 five-tag
      // builds, every tag that landed on zero had a ceiling between 3 and 18 -- not one
      // was genuinely unobtainable. So a zero always means "your other tags took the
      // points", never "the tree doesn't have this", and showing 0/10 says so.
      const capped = c.total > ceiling
        ? ` The tree has ${c.total} in total; the rest sit behind constellations a`
          + ' 55-point build cannot also afford.'
        : '';
      const magText = magnitudeText(c.mag);
      // Stated in the tooltip too, spelled out. The row has room for "+39%"; it does
      // not have room to say what that is a sum of.
      const magNote = magText
        ? ` This build grants ${magText} of it across those stars.`
        : '';
      const wnote = `Weight ${c.weight} of ${MAX_WEIGHT}. `;
      const note = wnote + (maxed
        ? `everything the tree offers within 55 points.${capped}`
        : c.stars === 0
          ? `${c.label} is obtainable -- up to ${ceiling} stars if it were your only tag`
            + ' -- but your other tags used the points. Drop or de-emphasise one to make'
            + ' room, or accept that this combination pulls in different directions.'
          : `${c.stars} of a possible ${ceiling} · you asked for ${
              Math.round(100 * c.weight / totalWeight)}% of the emphasis.${capped}`)
        + magNote;
      return `<div class="covrow${cls}" title="${esc(note)}">
      <span class="cn w${c.weight}">${esc(c.label)}${
        // What the build actually GRANTS, next to how many stars carry it. A star count
        // cannot distinguish +2% from +40%; this is the number that can. It sits in the
        // name column because that is the only flexible one -- everything to the right
        // of it is fixed width, and the bars stop lining up the moment that changes.
        magText ? ` <span class="cmag">${esc(magText)}</span>` : ''}${
        c.pet ? ' <span style="color:var(--ink-13)">pet</span>' : ''}${
        // A zero is worth flagging outright, not just implied by a dim row and a
        // red count -- the icon says "look closer" and the row's own tooltip (built
        // above as `note`) carries the full explanation of why.
        c.stars === 0 ? ' <i class="ti ti-alert-triangle warn"></i>' : ''}</span>
      <span class="cb"><i style="width:${Math.round(100 * pct)}%"></i></span>
      <span class="cmax">${maxed ? 'max' : ''}</span>
      <span class="cv">${c.stars}/${ceiling}${
        c.total > ceiling ? `<span class="ct">[${c.total}]</span>` : ''}</span>
    </div>`;
    }).join('')
  }</div>`;
}

// Built on every render (not cached into state.out) so ticking a step off can
// restyle it without recomputing the plan.
function pathHtml() {
  if (state.error) return `<p style="color:var(--ink-14);font-size:var(--fs-sm)">${esc(state.error)}</p>`;
  if (!state.plan) return '<p style="color:var(--ink-14);font-size:var(--fs-sm);margin:2px 0">Pick up to five tags, then build.</p>';
  const { schedule, solution } = state.plan;
  const takenStars = new Map(solution.map(e => [e.id, e.starsTaken]));
  const starsFor = new Map(solution.map(e => [e.id, e.stars]));

  // Work out completion for every step first, so "the one you're on" can be found
  // before anything is rendered -- it's the first real step still outstanding.
  //
  // The next STAR is the same idea one level down: the first star in the whole path
  // you haven't bought. It has to be resolved across every step before any row is
  // built, or each constellation would only be able to point at its own first star
  // and several would claim to be next at once. It comes from frontier() so that the
  // highlight and the lock cannot disagree about which star is next. prevKey is only
  // meaningful while locked -- unlocked, every star is clickable and marking one end
  // would just be decoration.
  const { next: nextKey, prev } = frontier();
  const prevKey = state.locked ? prev : null;

  let step = 0;
  const rows = schedule.path.map(p => {
    const c = db.constellations[p.id];
    const refund = p.kind === 'refund';
    const num = refund ? '\u21a9' : String(++step).padStart(2, '0');
    const stars = refund ? { html: '', keys: [] }
      : starList(c, p.points, starsFor.get(p.id), nextKey, prevKey);
    const complete = !refund && stars.keys.length > 0 && stars.keys.every(k => state.done.has(k));
    return { p, c, refund, num, step, stars, complete };
  });
  const currentIdx = rows.findIndex(r => !r.refund && !r.complete);

  if (state.plain) return plainHtml(rows, schedule);

  // Emit runs of constellation cards as grids, with slim rows breaking them apart.
  const out = [];
  let bucket = [];
  const flush = () => {
    if (bucket.length) { out.push('<div class="cards">' + bucket.join('') + '</div>'); bucket = []; }
  };

  rows.forEach((row, idx) => {
    const { p, c, refund, num, step, stars, complete } = row;
    const current = idx === currentIdx;

    // The ledger goes in the gap you are actually looking at: after the last card you
    // finished, before the one you are on. Skipped when idx is 0 (nothing finished, so
    // it would read all zeros) and when currentIdx is -1 (everything finished, and the
    // totals line below already says it).
    if (current && idx > 0) { flush(); out.push(ledgerHtml(rows[idx - 1].p)); }

    bucket.push(cardHtml(row, current, takenStars));
  });
  flush();

  return out.join('')
    + `<div class="total">${schedule.totalPoints} of 55 points · ${
        schedule.path.length && solution.filter(e => db.constellations[e.id]?.hasPower
          && e.starsTaken >= db.constellations[e.id].starCount).length
      } celestial power${solution.filter(e => db.constellations[e.id]?.hasPower
          && e.starsTaken >= db.constellations[e.id].starCount).length === 1 ? '' : 's'
      } · ${esc(aff(schedule.finalAffinity))}</div>`;
}

/**
 * Overview: the whole path as one scannable column.
 *
 * Detail is for following along in game, one step at a time. This is for seeing the
 * SHAPE of a build before committing to it -- where the points go, how long before
 * the first pick that serves what you asked for, how much of the path is affinity
 * plumbing. It started as a debugging aid and turned out to be the more useful view
 * for deciding whether a build is worth playing.
 *
 * Hence the two things it shows that Detail doesn't: a filled dot on every step
 * carrying one of your tags, and how many. A run of empty dots down the top means
 * you are paying for affinity before you get anything you came for.
 */
function plainHtml(rows, schedule) {
  const want = picked().map(i => chips[i].id);
  const hitsOf = c => want.reduce((n, k) => n + (c.hits?.[k] ?? 0), 0);
  const firstHit = rows.findIndex(r => !r.refund && hitsOf(r.c) > 0);

  // The step you're on: first thing not yet ticked off, same rule as Detail.
  const currentIdx = rows.findIndex(r => !r.refund && !r.complete);

  // Position within the REFUND-FREE sequence, which is what currentOrder() indexes.
  // Counting rows instead would drift by one for every Crossroads in the path, and a
  // drag would land somewhere near where you aimed rather than where you aimed.
  let dragIndex = 0;

  const body = rows.map((r, idx) => {
    const { p, c, refund, num, step, stars, complete } = r;
    const hits = refund ? 0 : hitsOf(c);
    const partial = !refund && p.points < c.starCount;
    const cls = 'prow' + (refund ? ' pref' : '') + (hits ? ' phit' : '')
      + (idx === firstHit ? ' pfirst' : '')
      + (complete ? ' pdone' : '') + (idx === currentIdx ? ' pcur' : '');

    // Detail ticks single stars, so a constellation can be half bought. Without a
    // third state that row is indistinguishable from an untouched one, and the two
    // views quietly disagree about where you are.
    const doneCount = stars.keys.filter(k => state.done.has(k)).length;
    const part = doneCount > 0 && !complete;

    // Same data-step/data-keys contract the cards use, so the existing handler ticks
    // the whole constellation and both views read one set of keys. Overview and
    // Detail can't drift apart because there is nothing to keep in sync.
    // This box buys or clears a WHOLE constellation, which is a bulk edit however you
    // look at it, so the lock disables it outright rather than trying to find a
    // frontier reading of "tick all seven of these". Locked, Detail is where you tick:
    // it is the star-at-a-time view, which is what the lock is shaped around.
    // Disabled rather than hidden -- the three states still say where you are, and
    // Overview's job of showing you the shape of the run is untouched.
    const tick = refund || !stars.keys.length ? '<span class="pck ghost"></span>'
      : `<button class="pck${complete ? ' on' : part ? ' part' : ''}"${state.locked ? ' disabled' : ''}
           data-step="${esc(`${p.id}:${step}`)}"
           data-keys="${esc(stars.keys.join(','))}"
           aria-pressed="${complete}"
           aria-label="${complete ? 'Clear' : 'Mark'} ${esc(p.name)} as bought"
           title="${state.locked
             ? `Locked -- switch to Detail to tick stars one at a time`
             : `${complete ? `Bought -- click to clear` : part
             ? `${doneCount} of ${stars.keys.length} stars bought -- click to finish`
             : `Mark all ${stars.keys.length} stars bought`} -- ${esc(p.name)}`}"
         ><i class="${complete ? 'ti ti-check' : part ? 'ti ti-minus' : ''}"></i></button>`;

    // Rows are draggable in Overview and only in Overview: it is already a single
    // column of equal-height rows, which is the shape a reorder wants. Detail lays
    // cards out in a multi-column grid of varying heights, where "between which two"
    // has no honest answer.
    //
    // Refund rows are not draggable. A refund is a Crossroads the scheduler inserts
    // and removes on its own as the order changes, so it isn't yours to place -- and
    // dragIndex counts only the rows that are, so the indices match currentOrder().
    // Frozen while locked, like everything else that changes the build.
    // Fixed in place: nowhere it could go is both schedulable and different from
    // where it already is. It keeps its data-drag index -- it is still a valid thing to
    // drop something else onto -- but it cannot be picked up.
    const fixed = !refund && state.immovable.has(p.id);
    const canDrag = !refund && !state.locked && !fixed;
    const dragAttrs = canDrag
      ? ` draggable="true" data-drag="${dragIndex++}"`
      : (refund ? '' : ` data-drag="${dragIndex++}"`);
    const fixedTip = fixed && !state.locked
      ? ' title="Fixed here -- every other position either changes nothing or costs more than 55 points"'
      : '';

    return `<div class="${cls}${canDrag ? ' pdrag' : ''}${fixed ? ' pfixed' : ''}"${dragAttrs}${fixedTip}>
      <span class="pn">${refund ? '↩' : num}</span>
      ${tick}
      <span class="pd">${hits ? '●' : '○'}</span>
      <span class="pnm">${esc(p.name)}${c.hasPower && !refund ? ' <span class="cp">CP</span>' : ''}${
        partial ? `<span class="ppart">${p.points}/${c.starCount}</span>` : ''}</span>
      <span class="ph">${hits || ''}</span>
      <span class="pp">${refund ? p.points : '+' + p.points}</span>
      <span class="pr">${p.runningPoints}</span>
    </div>`;
  }).join('');

  // How long before the build gives you something you asked for. Stated outright
  // because nobody counts rows -- which is how the ordering bug survived a session.
  const takes = rows.filter(r => !r.refund);
  const at = takes.findIndex(r => hitsOf(r.c) > 0) + 1;
  const bought = rows.filter(r => !r.refund && r.complete).length;
  const total = rows.filter(r => !r.refund).length;

  return `<div class="plain"><div class="phead">
      <span class="pn">#</span><span class="pck ghost"></span><span class="pd"></span>
      <span class="pnm">constellation</span>
      <span class="ph">tags</span><span class="pp">pts</span><span class="pr">run</span>
    </div>${body}</div>
    <div class="total"><div><b>${bought} of ${total} bought</b> · ${
      schedule.totalPoints} of 55 points · ${
      at ? `first tagged pick at #${at}` : 'nothing carries your tags'
    }</div><span class="orbs">${
      affOrbs(Object.entries(schedule.finalAffinity), (a, v) => textTip(
        `${v} ${capAff(a)} affinity total`))
    }</span></div>`;
}

/**
 * What you hold at a point in the path: points spent, and affinity accrued.
 *
 * Both come off the preceding path entry rather than being recounted here -- the
 * scheduler is the only thing that knows about Crossroads refunds, and a second count
 * in the UI would be a second chance to get them wrong.
 */
function ledgerHtml(prev) {
  // Unfiltered: heldAfter always carries all five, and a fixed row is easier to read
  // across steps than one that grows.
  const held = Object.entries(prev.heldAfter ?? {});
  return `<div class="ledger"><span class="orbs">${
    `<span class="orb pts"${textTip(
      `${prev.runningPoints} of 55 devotion points spent`)}>${prev.runningPoints}</span>`
  }${
    affOrbs(held, (a, v) => textTip(v
      ? `${v} ${capAff(a)} affinity held`
      : `No ${capAff(a)} affinity yet`))
  }</span></div>`;
}

// One step as a card.
function cardHtml({ p, c, refund, num, step, stars, complete }, current, takenStars) {
  const key = `${p.id}:${step}`;
  const partial = !refund && takenStars.get(p.id) != null
    && takenStars.get(p.id) < c.starCount;
  // A partial take grants NO affinity -- the bonus only lands when a constellation is
  // complete -- so don't print the affinity it would have given.
  const detail = refund
    ? `refunds ${Math.abs(p.points)} point${Math.abs(p.points) === 1 ? '' : 's'}`
    : partial
      ? `${p.points} of ${c.starCount} stars`
      : `${p.points} star${p.points === 1 ? '' : 's'}`;
  const grants = Object.entries(c.granted ?? {}).filter(([, v]) => v);
  // Right-justified on the title line. What a card GRANTS is a property of the
  // constellation, so it belongs beside its name; what you HOLD is a property of where
  // you are in the path, and now lives in the ledger between cards instead.
  const affRow = refund ? '' : `<span class="orbs">${
    partial || !grants.length
      ? `<span class="orb none"${textTip(
          partial ? 'Affinity is granted only when the constellation is complete'
                  : 'This constellation grants no affinity')}>\u2013</span>`
      : affOrbs(grants, (a, v) =>
          textTip(`+${v} ${capAff(a)} affinity on completion`))
  }</span>`;
  const cls = 'card' + (refund ? ' refund' : '')
    + (complete ? ' done' : '') + (current ? ' current' : '');
  const attrs = refund ? ''
    : ` data-step="${esc(key)}" data-keys="${esc(stars.keys.join(','))}"`;
  // Everything this card actually gives you, summed. Only the stars you are TAKING --
  // 40 of the 62 power targets are partial, so a whole-constellation total would
  // overstate what a 3-of-7 take hands you.
  const takenIdx = refund ? [] : (stars.keys ?? []).map(k => +k.slice(k.lastIndexOf(':') + 1));
  const totals = aggregate(
    takenIdx.flatMap(n => (c.starEffects?.[n - 1] ?? []).map(unpackLine)));
  const titleTip = refund ? '' : tipData(
    `${p.name} — ${takenIdx.length} of ${c.starCount} stars`,
    totals.map(l => [l.tmpl, l.v, l.v2 ?? 0, l.chip ?? 0]));
  // The CP badge gets the power's own tooltip, separate from the passives.
  const powerTip = c.powerStar ? tipData(
    c.starNames?.[c.powerStar - 1] || c.name, c.powerEffects?.[c.powerStar - 1],
    { proc: true }) : '';

  return `<div class="${cls}"${attrs}>
      <div class="step">
        <span class="num">${complete ? '<i class="ti ti-check" style="color:var(--accent-success)"></i>' : num}</span>
        <span class="body"><span class="nmrow"><span class="nm"${titleTip}>${esc(p.name)}</span>${
          c.hasPower && !refund ? `<span class="cp"${powerTip}>CP</span>` : ''}<span class="n">${
          esc(detail)}</span>${affRow}</span></span>
      </div>${stars.html && !complete ? `<div class="stars">${stars.html}</div>` : ''}
    </div>`;
}

// Stars in the order you click them. devotionLinks always points at a lower index,
// so index order is already a legal purchase order -- no topological sort needed.
// Each line shows the keywords that star gives you; the ones you asked for are
// highlighted, the rest are dimmed context.
/**
 * Which stars a step covers, in purchase order.
 *
 * Split out from starList() because the "next star to buy" is a property of the whole
 * PATH, not of one constellation -- it has to be known before any row is rendered.
 * One function owns the answer so the two callers can't drift.
 */
function starIdxs(c, taken, chosenStars) {
  if (!c.perStar) return [];
  // Which stars, not just how many -- 58 of 109 constellations branch, so the best
  // k stars are often not stars 1..k.
  return chosenStars?.length
    ? [...chosenStars].sort((a, b) => a - b).map(n => n - 1)
    : Array.from({ length: Math.min(taken, c.perStar.length) }, (_, i) => i);
}

const starKeysFor = (c, taken, chosenStars) =>
  starIdxs(c, taken, chosenStars).map(i => `${c.id}:${i + 1}`);

/**
 * Every star of the current plan, in the order you would buy them. Refund steps carry
 * no stars of their own, so they drop out.
 *
 * One ordered list is the single source of truth for both ends of your progress, and
 * for the "you are here" highlight. Deriving them separately is how two of them end up
 * disagreeing about where you are.
 */
function pathStarKeys() {
  if (!state.plan) return [];
  const { schedule, solution } = state.plan;
  const starsFor = new Map(solution.map(e => [e.id, e.stars]));
  return schedule.path
    .filter(p => p.kind !== 'refund')
    .flatMap(p => starKeysFor(db.constellations[p.id], p.points, starsFor.get(p.id)));
}

/**
 * The two ends of your progress: the next star to buy and the last one you bought.
 * These are the only stars the lock leaves clickable.
 *
 * Both are defined off path ORDER, not off a contiguous run, which is what makes them
 * survive progress with holes in it -- and holes are ordinary, since ticking while
 * unlocked is unconstrained and people do tick ahead.
 *
 *   next = the first UNBOUGHT star. Always legally purchasable even with a hole
 *          before it: everything earlier is bought, and a parent always has a lower
 *          index than its child, so its parent is among them.
 *   prev = the last BOUGHT star. Always a clean single removal: nothing bought sits
 *          after it, so toggleStar()'s subtree clear and repairAffinity() have
 *          nothing to take with them.
 *
 * With a hole the two sit far apart -- next points into the gap while prev is at the
 * far end of your run. That is the intended reading: fill the gap before going on.
 */
function frontier() {
  const keys = pathStarKeys();
  let next = null, prev = null;
  for (const k of keys) {
    if (state.done.has(k)) prev = k;
    else if (next == null) next = k;
  }
  return { next, prev };
}

/**
 * Box-drawing gutter showing which star hangs off which.
 *
 * Safe to draw as a flat list because purchase order IS depth-first order in all 109
 * constellations (measured, not assumed -- parents always have a lower index and no
 * constellation interleaves two branches). So the rows need no reordering and the
 * numbers stay in the order you click them.
 *
 * One character per level: the deepest star in the game sits at depth 6, and at two
 * characters that would have eaten 80px of a card barely 280px wide.
 */
function treeGutter(c, shownIdxs) {
  const shown = new Set(shownIdxs.map(i => i + 1));
  const parentOf = n => c.starParents?.[n - 1] ?? null;
  const lastChild = new Map();
  for (const n of shown) {
    const p = parentOf(n);
    if (p != null && shown.has(p)) lastChild.set(p, Math.max(lastChild.get(p) ?? 0, n));
  }
  const isLast = n => {
    const p = parentOf(n);
    return p == null || !shown.has(p) || lastChild.get(p) === n;
  };

  const out = new Map();
  for (const n of shown) {
    const chain = [];
    for (let a = parentOf(n); a != null && shown.has(a); a = parentOf(a)) chain.unshift(a);
    if (!chain.length) { out.set(n, ''); continue; }
    // Ancestors above the parent: a vertical rule only where that branch continues
    // below this row.
    let g = '';
    for (let k = 1; k < chain.length; k++) g += isLast(chain[k]) ? ' ' : '│';
    out.set(n, g + (isLast(n) ? '└─' : '├─'));
  }
  return out;
}

function starList(c, taken, chosenStars, nextKey, prevKey) {
  if (!c.perStar) return { html: '', keys: [] };
  const want = new Set(picked().map(i => chips[i].id));
  const idxs = starIdxs(c, taken, chosenStars);
  const gutter = treeGutter(c, idxs);
  const rows = [];
  for (const i of idxs) {
    const mine = c.perStar[i].filter(k => want.has(k)).map(k => chipLabel(k));
    const other = c.perStar[i].filter(k => !want.has(k)).length;
    const isPower = i + 1 === c.powerStar;
    // Power stars always show their name -- that name IS the celestial power, so it
    // carries the aquamarine pill. Ordinary stars only bother when the name differs
    // from the constellation's, which is most of the time just a repeat.
    const starName = c.starNames?.[i];
    const label = isPower
      ? `<span class="cpname">${esc(starName || c.name)}</span>`
      : (starName && starName !== c.name ? `<span class="nm2">${esc(starName)}</span>` : '');
    const sk = `${c.id}:${i + 1}`;
    // What this star actually gives. The pills say WHICH of your tags a star serves;
    // this says by how much -- "+15% Cold Damage" rather than "Cold Damage".
    //
    // Carried as data rather than a `title`: the native tooltip waits ~half a second,
    // ignores styling, and can't be read while you scan down a list. The lines are
    // newline-joined, which survives an attribute and comes back intact via dataset.
    // A power star's own numbers ARE the proc, so show those; every other star shows
    // its passives.
    const tipAttrs = isPower
      ? tipData(starName || c.name, c.powerEffects?.[i], { proc: true })
      : tipData('', c.starEffects?.[i]);
    // While locked, every star except the two ends of your progress is inert. It has
    // to LOOK inert: once the dialog has been hushed, an unmarked dead click is
    // indistinguishable from a bug. Marked on the row rather than by disabling
    // anything, because the row is a div carrying the tooltip -- you can still read
    // what a star gives while locked, you just can't buy it out of turn.
    const inert = state.locked && sk !== nextKey && sk !== prevKey;
    rows.push(`<div class="star${state.done.has(sk) ? ' sdone' : ''}${
      sk === nextKey ? ' snext' : ''}${sk === prevKey ? ' sprev' : ''}${
      inert ? ' slocked' : ''}"${tipAttrs} data-star="${esc(sk)}">
      <span class="sn">${i + 1}</span>
      <span class="stree">${gutter.get(i + 1) ?? ''}</span>
      <span class="stxt">${label}${mine.map(m => `<span class="tg">${esc(m)}</span>`).join('')}${
        other ? `<span class="tg other">+${other}</span>` : ''}${
        state.done.has(sk) ? '<i class="ti ti-check sck" aria-label="bought"></i>' : ''}</span>
    </div>`);
  }
  return { html: rows.join(''), keys: idxs.map(i => `${c.id}:${i + 1}`) };
}

const chipLabel = id => (chips.find(c => c.id === id)?.label ?? id);

// --- effect tooltips ---------------------------------------------------------
// Index lines are packed as [template, value, value2, chipId]; unpack before use.
//
// A PROC line may carry two more entries -- [.., vMax, v2Max] -- the same statement at
// the power's own level cap. Only present where the numbers actually differ, which is
// 236 of 413 proc lines. Passive lines never have them: a passive has no ranks.
const unpackLine = ([tmpl, v, v2, chip]) => ({ tmpl, v, v2: v2 || null, chip: chip || null });

/**
 * A proc line at the rank the current scoring mode implies.
 *
 * `CP Max` (mode 2) says the build is being scored as though every power were at its
 * cap, so showing rank-1 numbers next to that made the tooltip contradict the mode
 * selected two inches away. `Passives` and `Balanced` both show rank 1 -- the tool does
 * not model putting devotion points into a power, so rank 1 is what you get by
 * acquiring it.
 *
 * Reads `state.plan.mode`, not `state.mode`, for the reason Coverage does: clicking a
 * tab re-renders before the new plan exists, and a panel must describe the state it is
 * rendering rather than the one you just asked for.
 */
function unpackProc(line) {
  const l = unpackLine(line);
  const atMax = (state.plan?.mode ?? state.mode) === MAX_RANK_MODE;
  if (!atMax || line.length < 6) return l;
  return { ...l, v: line[4], v2: line[5] || null };
}

/** chip id -> the weight the user gave it, for colouring a bonus they asked for. */
function wantedWeights() {
  const m = new Map();
  state.sel.forEach((sel, slot) => {
    if (sel != null) m.set(chips[sel].id, state.weights[slot]);
  });
  return m;
}

/**
 * Build a tooltip payload: a heading plus lines, each flagged with the weight of the
 * tag it serves so the tooltip can pill it in that tag's colour.
 *
 * Encoded into one attribute because a tooltip is summoned from a `data-` attribute and
 * arrays don't survive that. `␟` (unit separator) is used between fields since it
 * cannot occur in a stat string.
 */
function tipData(head, packed, { proc = false } = {}) {
  const weights = wantedWeights();
  const lines = (packed ?? []).map(proc ? unpackProc : unpackLine).map((l) => {
    const w = l.chip ? weights.get(l.chip) : null;
    return `${w ?? 0}␟${renderLine(l)}`;
  });
  if (!lines.length) return '';
  return ` data-fx="${esc(lines.join('\n'))}"${head ? ` data-fxhead="${esc(head)}"` : ''}`;
}
/**
 * A tooltip whose lines are already plain text.
 *
 * tipData() exists for STAT lines, which arrive packed and have to be run through
 * renderLine(). Orbs carry prose. Same wire format either way -- "weight␟text",
 * weight 0 -- so showTip() needs no special case, and an orb tip can never drift out of
 * step with a stat tip.
 *
 * No headline. A stat tooltip needs one because its lines are a LIST belonging to
 * something named elsewhere; an orb tooltip is a single sentence that already names its
 * own subject, so a heading above it just says the same word twice.
 */
const textTip = (...lines) =>
  ` data-fx="${esc(lines.filter(Boolean).map(l => `0\u241F${l}`).join('\n'))}"`;
/** textTip, but the lines are paragraphs: they wrap, and they lose their bullets. */
const proseTip = (head, ...paras) =>
  textTip(...paras) + ` data-fxhead="${esc(head)}"` + ' data-fxprose="1"';
const capAff = a => a.charAt(0).toUpperCase() + a.slice(1);
/**
 * Affinity orbs for a list of [affinity, amount].
 *
 * `plus` signs the number ON THE ORB ITSELF. Card rows no longer pass it (2 Aug) --
 * a 22px circle had no room to spare for a glyph that doesn't change the number's
 * meaning, and it's still a delta either way (the tooltip's own text says so: "+3
 * X affinity on completion"). The ledger never passed it either, since its orbs are
 * a TOTAL, where a plus would misread as a gain.
 */
const affOrbs = (entries, tip, plus) => entries
  .map(([a, v]) => `<span class="orb af-${esc(a)}${v ? '' : ' zero'}"${tip(a, v)}>${
    plus && v > 0 ? '+' : ''}${v}</span>`)
  .join('');
const consName = id => (db.constellations[id]?.name ?? id);
const powerChipFor = id => chips.find(c => c.kind === 'power' && c.id === id);

/** Stars this plan buys for a constellation, 1-based. Mirrors what the rows render. */
function plannedStars(cid) {
  const c = db.constellations[cid];
  if (!state.plan || !c) return [];
  const entry = state.plan.solution.find(e => e.id === cid);
  const step = state.plan.schedule.path.find(p => p.id === cid && p.kind !== 'refund');
  if (!step) return [];
  return starIdxs(c, step.points, entry?.stars).map(i => i + 1);
}

// --- affinity legality -------------------------------------------------------
// You cannot buy ANY star of a constellation until your affinity meets its
// requirement, and affinity only arrives when a constellation is COMPLETE. So
// ticking things off has a second rule beyond the parent-child one: a constellation
// you couldn't have reached yet must not be tickable.
//
// Crossroads that have been ticked keep counting even though the schedule refunds
// them later. That matches how you actually play -- at the moment you buy the
// constellation behind it, the bootstrap is still paid for.

const AFFS = ['ascendant', 'chaos', 'eldritch', 'order', 'primordial'];
const meets = (held, req) =>
  Object.entries(req ?? {}).every(([a, v]) => (held[a] ?? 0) >= v);
const deficit = (req, held) => Object.fromEntries(
  Object.entries(req ?? {}).map(([a, v]) => [a, Math.max(0, v - (held[a] ?? 0))]));

/** Constellations whose planned stars are all ticked. */
function completedSet() {
  const out = new Set();
  if (!state.plan) return out;
  for (const p of state.plan.schedule.path) {
    if (p.kind === 'refund' || out.has(p.id)) continue;
    const keys = plannedStars(p.id).map(s => `${p.id}:${s}`);
    if (keys.length && keys.every(k => state.done.has(k))) out.add(p.id);
  }
  return out;
}

function affinityFrom(ids) {
  const held = Object.fromEntries(AFFS.map(a => [a, 0]));
  for (const id of ids) {
    for (const [a, v] of Object.entries(db.constellations[id]?.granted ?? {})) {
      held[a] = (held[a] ?? 0) + v;
    }
  }
  return held;
}

const markComplete = cid => {
  for (const s of plannedStars(cid)) state.done.add(`${cid}:${s}`);
};
const markUntouched = cid => {
  for (const s of plannedStars(cid)) state.done.delete(`${cid}:${s}`);
};

/**
 * Complete whatever earlier constellations this one needs, and nothing more.
 *
 * Walking the path and ticking everything up to here would over-claim: Amatok needs
 * primordial 6 and eldritch 4, which Tsunami and Raven supply -- Harpy sits between
 * them in the path and contributes nothing to it. So only steps that actually reduce
 * the deficit are taken, and each is made legal in its own right first.
 */
function ensureAffinity(cid, seen = new Set()) {
  const c = db.constellations[cid];
  if (!state.plan || !c || seen.has(cid)) return;
  seen.add(cid);
  const req = c.required;
  if (!req || !Object.keys(req).length) return;

  const path = state.plan.schedule.path;
  const here = path.findIndex(p => p.id === cid && p.kind !== 'refund');
  const done = completedSet();
  done.delete(cid);
  if (meets(affinityFrom(done), req)) return;

  for (let i = 0; i < (here < 0 ? path.length : here); i++) {
    const p = path[i];
    if (p.kind === 'refund' || p.id === cid || done.has(p.id)) continue;
    const need = deficit(req, affinityFrom(done));
    const grants = db.constellations[p.id]?.granted ?? {};
    if (!Object.entries(grants).some(([a, v]) => v > 0 && (need[a] ?? 0) > 0)) continue;
    ensureAffinity(p.id, seen);          // the enabler has to be reachable too
    markComplete(p.id);
    done.add(p.id);
    if (meets(affinityFrom(done), req)) return;
  }
}

/**
 * Drop anything the ticked set can no longer support.
 *
 * Un-ticking a constellation can strip the affinity that let a later one be bought,
 * so this runs to a fixpoint -- one removal can cascade into several. Partial takes
 * count: the requirement gates buying the FIRST star, not completing the set.
 */
function repairAffinity() {
  for (let guard = 0; guard < 30; guard++) {
    const done = completedSet();
    const touched = new Set([...state.done].map(k => k.slice(0, k.lastIndexOf(':'))));
    let changed = false;
    for (const id of touched) {
      const others = new Set(done);
      others.delete(id);
      if (!meets(affinityFrom(others), db.constellations[id]?.required)) {
        markUntouched(id);
        changed = true;
      }
    }
    if (!changed) return;
  }
}

/**
 * Has progress run ahead of the suggested order?
 *
 * True when something bought sits after something unbought. This is NOT a mistake --
 * rushing a particular celestial power is a perfectly good way to play, and the
 * affinity cascade supports it. It does mean the numbering and the RUN column describe
 * a different playthrough from yours: buy Hyrian first and you've spent 20 points, not
 * the 48 its row claims. So it's worth offering to re-order, not worth warning about.
 */
/**
 * Work out which power chips no longer fit, off the critical path.
 *
 * Skipped entirely unless a power is already chosen and there's a slot free to add
 * another -- there is nothing to grey out otherwise, and the sweep is the most
 * expensive thing in the app.
 */
let blockedTimer = null;
function scheduleBlockedSweep() {
  clearTimeout(blockedTimer);
  const powerChips = chips.filter(c => c.kind === 'power');
  const chosenPowers = picked().filter(i => chips[i].kind === 'power').length;
  if (!chosenPowers || picked().length >= MAX) {
    if (state.blocked.size) { state.blocked = new Set(); render(); }
    return;
  }
  blockedTimer = setTimeout(() => {
    const found = blockedPowers(db, wantedList(), powerChips.map(c => c.id),
      { mode: state.plan?.mode ?? state.mode });
    // Only re-render when the answer actually changed; this lands after the user has
    // already been looking at the result for a while.
    const same = found.size === state.blocked.size
      && [...found].every(id => state.blocked.has(id));
    if (!same) { state.blocked = found; render(); }
  }, 260);
}

let movableTimer = null;

/**
 * Which rows have nowhere to go? One landing sweep per row, early-exiting as soon as a
 * position is found that both schedules and actually moves it.
 */
function immovableSet() {
  const base = currentOrder();
  const out = new Set();
  if (!state.plan) return out;
  const saved = state.order;
  const solution = state.plan.solution;
  try {
    for (let from = 0; from < base.length; from++) {
      let movable = false;
      for (let to = 0; to < base.length && !movable; to++) {
        if (to === from) continue;
        const ids = [...base];
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        state.order = ids;
        const sched = applyOrder(solution);
        if (!sched) continue;
        const landed = sched.path.filter(p => p.kind !== 'refund').map(p => p.id).indexOf(moved);
        if (landed !== from) movable = true;
      }
      if (!movable) out.add(base[from]);
    }
  } finally {
    state.order = saved;
  }
  return out;
}

/** Run the sweep off the critical path, and only where it can be seen. */
function scheduleMovableSweep() {
  clearTimeout(movableTimer);
  // Only Overview can drag, so only Overview needs the answer. This is what keeps the
  // cost off anyone who never opens it.
  if (!state.plain || !state.plan || state.locked) {
    if (state.immovable.size) { state.immovable = new Set(); render(); }
    return;
  }
  movableTimer = setTimeout(() => {
    const found = immovableSet();
    const same = found.size === state.immovable.size
      && [...found].every(id => state.immovable.has(id));
    if (!same) { state.immovable = found; render(); }
  }, 120);
}

/**
 * Re-schedule a solved set into the order you dragged it into.
 *
 * Nothing is re-solved. The SET is the answer to your tags, and changing it would be
 * a different build; only the order moves. That is exactly what `schedulePath()`'s
 * priority hook is for -- rank the constellations you placed, and the scheduler puts
 * each one as early as the affinity rules allow, recomputing Crossroads bootstraps and
 * refunds around the new order.
 *
 * This is also the whole of "an illegal drop auto-resolves by cascading". There is no
 * splice-then-repair step, because the scheduler cannot emit an illegal path: ask for
 * a constellation before the affinity that unlocks it and the enablers come forward
 * with it. Dropping something where the game will not allow it lands it as early as
 * the game does allow, which is the honest answer to the request.
 *
 * Returns null when there is nothing to apply, so callers fall back to the solver's
 * own schedule.
 */
function scheduleWithRanks(solution, ids) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  if (!solution.some(e => rank.has(e.id))) return null;
  // Unranked constellations keep the ordinary priority and therefore sort behind
  // anything ranked -- ORDER_PRESSURE is far larger than any keyword score.
  const base = priorityFor(wantedList(), state.mode);
  const n = ids.length;
  const priority = c => (c && rank.has(c.id) ? (n - rank.get(c.id)) * ORDER_PRESSURE : 0) + base(c);
  try {
    return schedulePath(solution, db, db.maxPoints ?? 55,
      { priority, interleavePartials: true });
  } catch {
    // Almost always "budget exceeded": pulling something forward can force a
    // Crossroads bootstrap that nothing later releases, and a plan that fits in 55
    // points in one order does not fit in another.
    return null;
  }
}

/**
 * The schedule to show: the manual order where it can be honoured, the solver's
 * otherwise. Also the place the "it didn't fit" cases are resolved, so build() and a
 * drop can't disagree about what happens when an order is impossible.
 */
function orderedSchedule(solution, solverSchedule) {
  let ordered = applyOrder(solution);
  if (!ordered && state.order) {
    // Not reachable even for the one constellation dragged. Put the order back the way
    // it was rather than leaving a stored order the path doesn't reflect, and say so:
    // a drag that silently does nothing reads as a broken control.
    state.order = state.orderPrev ?? null;
    state.orderNote = 'failed';
    ordered = applyOrder(solution);
  }
  return ordered ?? solverSchedule;
}

/** Re-schedule the plan in place, without re-solving. */
function reorderNow() {
  if (!state.plan) return;
  state.plan = { ...state.plan,
    schedule: orderedSchedule(state.plan.solution, state.plan.solverSchedule) };
}

function applyOrder(solution) {
  if (!state.order?.length || !solution?.length) return null;
  return scheduleWithRanks(solution, state.order);
}

/**
 * The order the path is currently in, as constellation ids -- the starting point for
 * a drag. Refund steps are Crossroads the scheduler inserts and removes on its own,
 * so they are not yours to place and never enter the order.
 */
function currentOrder() {
  if (!state.plan) return [];
  return state.plan.schedule.path.filter(p => p.kind !== 'refund').map(p => p.id);
}

/**
 * Where would the row at `from` end up if dropped at each position in turn?
 *
 * Returns an array parallel to the path: the resulting index, or null where that
 * arrangement cannot be scheduled within the cap. Pure -- it restores state.order
 * before returning, so it can be called mid-drag without disturbing anything.
 */
function landingsFor(from) {
  const base = currentOrder();
  if (!state.plan || from < 0 || from >= base.length) return null;
  const saved = state.order;
  const solution = state.plan.solution;
  const out = [];
  try {
    for (let to = 0; to < base.length; to++) {
      const ids = [...base];
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      state.order = ids;
      const sched = applyOrder(solution);
      out.push(sched
        ? sched.path.filter(p => p.kind !== 'refund').map(p => p.id).indexOf(moved)
        : null);
    }
  } finally {
    state.order = saved;
  }
  return out;
}

/**
 * Move the constellation at `from` to `to` within the current order, and rebuild.
 *
 * Positions are indices into the refund-free path, which is what the Overview rows
 * show. The result is what you ASKED for; what you get is whatever the scheduler can
 * legally make of it.
 */
function moveInOrder(from, to) {
  const ids = currentOrder();
  if (!ids.length) return false;
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return false;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  state.orderPrev = state.order;   // to restore if this arrangement turns out not to fit
  state.order = ids;
  state.orderNote = null;
  return true;
}

/** Tick or clear a whole constellation, keeping both rules satisfied. */
function toggleSteps(keys) {
  if (!keys.length) return;
  const cid = keys[0].slice(0, keys[0].lastIndexOf(':'));
  if (keys.every(k => state.done.has(k))) {
    for (const k of keys) state.done.delete(k);
    repairAffinity();
  } else {
    ensureAffinity(cid);
    for (const k of keys) state.done.add(k);
  }
}

/**
 * Tick a single star, keeping the ticked set to something the game could produce.
 *
 * You cannot buy a star without its parent -- devotion trees are strictly
 * parent-before-child -- so a bare toggle can record a build that doesn't exist.
 * Rather than reject the click and explain why, the click means what the player
 * means by it: buying a star buys the chain that leads to it, and un-buying one
 * un-buys everything hanging off it. Illegal states become unreachable instead of
 * merely discouraged.
 *
 * Note this is the rule WITHIN a constellation, which has no exceptions. It
 * deliberately does not force the whole path: taking three stars here, going
 * elsewhere and coming back is legal play, and you may already own things out of
 * the order this plan happens to suggest.
 */
function toggleStar(key) {
  const cut = key.lastIndexOf(':');
  const cid = key.slice(0, cut), n = +key.slice(cut + 1);
  const c = db.constellations[cid];
  if (!c || !n) return;
  const taken = new Set(plannedStars(cid));
  const parentOf = i => c.starParents?.[i - 1] ?? null;

  if (state.done.has(key)) {
    for (const s of taken) {
      for (let a = s; a; a = parentOf(a)) {
        if (a === n) { state.done.delete(`${cid}:${s}`); break; }
      }
    }
    state.done.delete(key);
    // Dropping a star can un-complete this constellation, which strips the affinity
    // whatever came after it was relying on.
    repairAffinity();
  } else {
    ensureAffinity(cid);
    for (let a = n; a; a = parentOf(a)) {
      if (taken.has(a)) state.done.add(`${cid}:${a}`);
    }
  }
}

function render() {
  // render() replaces the whole subtree, which destroys the scroller and resets
  // scrollTop to 0 -- so picking a tag halfway down the list threw you back to the
  // top. Carry the offset across the swap. Tab changes deliberately reset it,
  // since that's a different list.
  const prevScroll = app.querySelector('.scroll');
  const keepScroll = prevScroll && renderedTab === state.tab ? prevScroll.scrollTop : 0;
  // Same problem as the tag list: innerHTML destroys the scroller and drops you back
  // to the top. Ticking a star halfway down the path re-renders, so without this the
  // list jumps on every click.
  const prevPath = app.querySelector('.dscroll');
  const keepPath = prevPath ? prevPath.scrollTop : 0;

  // Five empty pills read like a form to fill in. Show what's chosen plus a single
  // prompt for the next, and put the count in the label so the ceiling stays clear.
  const chosenCount = picked().length;
  // Reset lives in the section header, matching the Detail/Overview button in the
  // Devotions header: both are "this whole section" actions, and having one of them
  // inline at the bottom of its list made it look like it applied to the last row.
  // The build status ("13 constellations · 55/55") sits centered in the header now,
  // in the space between the count and Reset all, rather than its own row below the
  // slots -- one fewer row saves vertical space the same way the inline scoring row
  // did.
  let h = `<div class="col"><div class="selpane${state.locked ? ' locked' : ''}"><p class="lbl" style="display:flex;align-items:center;gap:8px">
    <span>Target tags <span style="color:var(--ink-13)">${chosenCount}/${MAX}</span></span>
    <span class="status">${state.solving
      ? '<span class="pulse"></span>solving'
      : state.plan
        ? `${state.plan.solution.length} constellations · ${state.plan.schedule.totalPoints}/55${
            // Only ever shown when a background proof came back and confirmed it.
            // Absence means "not proven", never "worse" -- most builds are never
            // asked about, and silence is the honest default.
            state.plan.proven ? ' <span class="proven" title="Proven optimal: no legal 55-point build scores higher for these tags">optimal</span>' : ''}`
        : chosenCount ? '' : 'pick a tag to begin'}</span>
    <button class="rb" data-reset="1"${state.locked || !(chosenCount || state.plan) ? ' disabled' : ''}
      title="${state.locked ? 'Locked' : 'Reset all'}" aria-label="Reset all"><i class="ti ti-minus"></i></button></p>`;
  for (let i = 0; i < MAX; i++) {
    const s = state.sel[i];
    if (s == null) continue;
    const isPower = chips[s].kind === 'power';
    // Weights are a priority between things that COMPETE for stars. A celestial power
    // isn't in that competition -- it's a hard target, secured or reported as unmet, and
    // measurably identical at one dot and three. Showing a control that does nothing is
    // worse than showing none, so a power gets a fixed target marker instead.
    const control = isPower
      ? `<span class="tgt" title="Celestial powers are targets, not priorities -- you either secure it or it's reported as not fitting"><i class="ti ti-crosshair"></i>target</span>`
      // Each star is its own target: click the second star to mean two, rather than
      // clicking repeatedly to walk up and wrapping round at the top. Setting a value
      // directly is one click from anywhere to anywhere.
      : `<span class="dots pick w${state.weights[i]}">${
         Array.from({ length: MAX_WEIGHT }, (_, d) => {
           const level = d + 1;
           const on = level <= state.weights[i];
           // Unicode stars, not the icon font: `ti-star-filled` renders nothing in the
           // Tabler webfont build we load, so every FILLED star was invisible and a
           // three-star tag showed no stars at all.
           return `<button class="star" data-setw="${i}:${level}"${state.locked ? ' disabled' : ''}
             aria-label="Set priority to ${level} of ${MAX_WEIGHT}"
             aria-pressed="${state.weights[i] === level}"
             title="${state.locked ? 'Locked' : `${['low', 'medium', 'high'][d] ?? level} priority`}"
             ><span class="${on ? 'on' : ''}">${on ? '\u2605' : '\u2606'}</span></button>`;
         }).join('')
       }</span>`;
    h += `<div class="slot full${isPower ? ' pow' : ''}">
       <span>${esc(chips[s].label)}${chips[s].ns === 'pet' ? ' <span style="font-size:var(--fs-base);opacity:.6">pet</span>' : ''}${
         isPower ? ' <span class="cpc">CP</span>' : ''}</span>
       ${control}
       <button class="rb" data-rm="${i}"${state.locked ? ' disabled' : ''}
         aria-label="Remove ${esc(chips[s].label)}"><i class="ti ti-minus"></i></button></div>`;
  }
  if (chosenCount < MAX) {
    h += `<div class="slot empty"><span>${chosenCount ? 'Add another' : 'Pick a tag below'}</span>
      <span class="rb"><i class="ti ti-plus"></i></span></div>`;
  }
  // Selection widgets live in the LEFT pane, the plan display in the RIGHT. Power
  // scoring and Coverage sit here (moved from the right column, 31 Jul): scoring is a
  // setting on the build you're assembling, and Coverage is feedback on the tags
  // above it -- both describe your picks, not the resulting path, so they belong
  // beside Target tags rather than beside the read-only Devotions list. Tag library
  // stays last in this column: it's the browse/add widget, not a readout, so it reads
  // as "more tags below" rather than the first thing you see.
  // One info icon carries all three descriptions now, rather than a title on each
  // button -- those native tooltips were easy to miss (hover one button at a time,
  // no indication there was anything to read) and duplicated whatever this single
  // tooltip says anyway. Custom keeps its own title below: it's dynamic per-session
  // state (which mode it came from), not a fixed description this icon can carry.
  const scoreInfo = proseTip('Power scoring',
    'How much the build should chase celestial power procs versus plain passive stats'
    + ' and the affinity they grant.',
    ...MODES.map(([label, sub]) => `${label} — ${sub}.`));
  h += `<p class="lbl" style="margin-top:18px">Power scoring <i class="ti ti-info-circle covi"${
    scoreInfo}></i></p>`;
  // Three tiles, and only three. The fourth -- Custom -- was where a re-ordered path
  // used to live, which put a saved ordering in a strip labelled Power scoring where
  // it was never a scoring mode. Dragging replaced it: the order is now an input of
  // its own, shown in the Devotions header where the path it reorders is.
  h += `<div class="scoregroup" role="group" aria-label="Power scoring">${
    MODES.map(([label], i) =>
      `<button class="scoreopt${state.mode === i ? ' on' : ''}" data-score="${i}"${
        state.locked ? ' disabled' : ''}
        aria-pressed="${state.mode === i}">${esc(label)}</button>`).join('')
  }</div>`;
  h += coverageHtml();

  // groups is a Map -- iterable, but with no reduce of its own. The count is per TAB,
  // so switching to Pet shows how much smaller that library is rather than leaving you
  // to scroll and find out.
  let tabCount = 0;
  for (const [k, ids] of groups) if (k.startsWith(state.tab + '|')) tabCount += ids.length;
  h += `<p class="lbl" style="margin-top:18px">Tag library <span style="color:var(--ink-13)">${
    tabCount}</span></p>`;
  h += `<div style="display:flex;gap:6px;margin:0 0 8px">
    <button class="tab${state.tab === 'character' ? ' on' : ''}" data-tab="character">Character</button>
    <button class="tab${state.tab === 'pet' ? ' on' : ''}" data-tab="pet">Pet</button></div><div class="scroll">`;
  for (const [key, ids] of groups) {
    if (!key.startsWith(state.tab + '|')) continue;
    const name = key.split('|')[1], open = state.open.has(key);
    h += `<div class="cat"><button class="cath" data-cat="${esc(key)}">
      <span>${esc(name)} <span class="n">${ids.length}</span></span>
      <i class="ti ti-chevron-${open ? 'down' : 'right'}"></i></button>`;
    if (open) {
      h += '<div style="padding:0 0 8px">' + ids.map(i => {
        const c = chips[i];
        const used = state.sel.includes(i);
        const blocked = !used && state.blocked.has(c.id);
        const cls = 'chip' + (used ? ' used' : blocked ? ' blocked' : '');
        // A power's cost in stars is the useful thing to know before picking it: 40 of
        // the 62 are reachable without finishing their constellation.
        const title = c.kind === 'power'
          ? (blocked
            ? `${c.label} can't fit alongside the powers you've already chosen`
            : `${c.label} -- ${c.min} of ${consName(c.cons)}'s ${c.size} stars`)
          : c.label;
        // Browsing the library stays open while locked -- only ADDING is frozen. You
        // can still read what a chip would have cost you without unlocking.
        return `<button class="${cls}" data-add="${i}"${used || blocked || state.locked ? ' disabled' : ''}
          title="${esc(state.locked ? `${c.label} -- locked` : title)}" aria-label="Add ${esc(c.label)}">
          ${esc(c.label)}<span class="rb"><i class="ti ti-${
            used ? 'check' : blocked ? 'ban' : 'plus'}"></i></span></button>`;
      }).join('') + '</div>';
    }
    h += '</div>';
  }
  // Closes .scroll and the left (selection) pane, opens the right (display) pane.
  // The pane split stays 50/50 -- .col's grid-template-columns is unchanged -- even
  // though the left pane now carries more.
  h += '</div></div><div class="dispane">';
  h += `<p class="lbl" style="display:flex;justify-content:space-between;align-items:center">
    <span>Devotions</span>
    <span style="display:flex;gap:6px">
    <button class="plainbtn orderbtn${state.order ? ' on' : ''}" data-clearorder="1"${
      state.order ? '' : ' disabled'}
      title="${state.orderNote === 'failed'
        ? 'Your saved order does not fit this build and was dropped -- the constellations it arranged are not all here any more'
        : state.order
        ? 'Your own order. Click to go back to the one the solver chose'
        : state.plain
          ? 'Drag a row to move it. The path re-plans around it, pulling in whatever it needs first'
          : 'Switch to Overview to drag steps into your own order'}"
      aria-label="${state.order ? 'Clear your custom order' : 'Custom order'}"><i
      class="ti ti-arrows-sort"></i> ${state.order ? 'Custom order' : 'Order'}</button>
    <button class="plainbtn iconbtn lockbtn${state.locked ? ' on' : ''}" data-lock="1"
      aria-pressed="${state.locked}"
      aria-label="${state.locked ? 'Unlock the build' : 'Lock the build'}"
      title="${state.locked
        ? 'Locked -- tick the next star or un-tick the last one. Click to unlock and change the build'
        : 'Lock the build: everything goes read-only except ticking off the next star'}"><i
      class="ti ti-lock${state.locked ? '' : '-open'}"></i></button>
    <button class="plainbtn iconbtn" data-resetprogress="1"${state.locked || !state.done.size ? ' disabled' : ''}
      aria-label="Clear progress"
      title="${state.locked ? 'Locked' : state.done.size
        ? `Clear all progress (${state.done.size} star${state.done.size === 1 ? '' : 's'} bought) -- tags and plan stay`
        : 'No progress to clear'}"><i class="ti ti-refresh"></i></button>
    <button class="plainbtn${state.plain ? ' on' : ''}" data-plain="1"
      title="${state.plain
        ? 'Back to one card per step, with the stars to click'
        : 'The whole path in one column -- every pick in order, at a glance'}">${
      state.plain ? 'Detail' : 'Overview'}</button></span></p>`;
  h += `<div class="dwrap"><div class="dscroll">` + pathHtml() + '</div>';
  // Both lock dialogs share the modal shell. They sit over the devotions list
  // rather than the whole app because that is what they are about -- which stars you
  // may click -- and it keeps the left column readable while you answer.
  if (state.dialog === 'unlock') {
    const n = state.done.size;
    h += `<div class="modal"><div class="mbox">
      <p class="mtitle">Unlock the build?</p>
      <p class="mtext">Tags, weights, power scoring and Reset all become editable
        again${n ? `, and any change re-solves the path. Your ${n} ticked star${
        n === 1 ? '' : 's'} survive that` : ''}.</p>
      <div class="mopts">
        <button class="mbtn go" data-dialog="unlock">
          <b>Unlock</b>
          <span>Go back to changing the build</span>
        </button>
        <button class="mbtn" data-dialog="cancel">
          <b>Stay locked</b>
          <span>Carry on ticking off the path</span>
        </button>
      </div>
    </div></div>`;
  } else if (state.dialog === 'frontier') {
    h += `<div class="modal"><div class="mbox">
      <p class="mtitle">That one's locked</p>
      <p class="mtext">While locked you can tick the next star or un-tick the last one
        you bought &mdash; that's it. Unlock to go further back, or to change the
        build.</p>
      <div class="mopts">
        <button class="mbtn go" data-dialog="cancel">
          <b>Got it</b>
          <span>Carry on</span>
        </button>
        <button class="mbtn" data-dialog="hush">
          <b>Got it, stop telling me</b>
          <span>Clicks outside those two stars will just do nothing</span>
        </button>
      </div>
    </div></div>`;
  }
  // The tooltip lives inside the rendered tree, so a re-render disposes of it cleanly
  // and there is nothing to leak. It is position:fixed, so being nested doesn't matter.
  h += '</div></div></div><div class="tip" role="tooltip" aria-hidden="true"></div>';
  app.innerHTML = h;
  save();

  // Size before restoring scroll: setting scrollTop on an unsized box clamps to 0.
  fitPanels();
  const nextScroll = app.querySelector('.scroll');
  if (nextScroll) nextScroll.scrollTop = keepScroll;
  const nextPath = app.querySelector('.dscroll');
  if (nextPath) nextPath.scrollTop = keepPath;
  renderedTab = state.tab;
}

/**
 * Cap both long panels at whatever room is left below them, so each scrolls inside
 * itself instead of growing the page.
 *
 * Both need it for the same reason: what's above them changes height. In the left
 * pane, unfolding a keyword category or the coverage panel growing a row per tag
 * pushes .scroll down; in the right pane the Devotions header is the only thing
 * above .dscroll, but the window can still be short. Measured rather than given a
 * fixed `vh`, because no constant is right for every tag count.
 *
 * Floor of 200px so a short window still shows something scrollable, not a sliver.
 */
function fitPanels() {
  if (typeof window === 'undefined') return;
  for (const sel of ['.scroll', '.dscroll']) {
    const box = app.querySelector(sel);
    if (!box || !box.getBoundingClientRect) continue;
    const top = box.getBoundingClientRect().top;
    box.style.maxHeight = Math.max(200, window.innerHeight - top - 16) + 'px';
  }
}

/**
 * Effect tooltip.
 *
 * Delegated from `app`, which survives every re-render, so nothing needs re-binding
 * when the path is rebuilt. Everything is guarded because the same code runs under the
 * test harness, where querySelector only knows about the two scroll panels.
 *
 * Positioned against the ROW rather than the pointer: it stays put while you read it
 * instead of sliding around, and a row is a stable rectangle to flip against.
 */
function showTip(row) {
  const tip = app.querySelector?.('.tip');
  if (!tip || !row?.getBoundingClientRect || typeof window === 'undefined') return;
  const lines = (row.dataset.fx || '').split('\n').filter(Boolean);
  if (!lines.length) return hideTip();

  const head = row.dataset.fxhead;
  // add/remove rather than toggle: the test harness's classList stub implements the
  // three methods the page actually uses, and a fourth would fail there and nowhere else.
  if (row.dataset.fxprose != null) tip.classList.add('prose');
  else tip.classList.remove('prose');
  // Each line arrives as "weight␟text". A non-zero weight means this bonus serves a tag
  // you asked for, so it gets a pill in that tag's colour -- the same red/amber/green
  // the stars use, so the two readouts agree without a legend.
  tip.innerHTML = (head ? `<b>${esc(head)}</b>` : '')
    + lines.map((l) => {
      const cut = l.indexOf('␟');
      const w = cut < 0 ? 0 : Number(l.slice(0, cut)) || 0;
      const text = cut < 0 ? l : l.slice(cut + 1);
      return w > 0
        ? `<span class="hit w${w}">${esc(text)}</span>`
        : `<span>${esc(text)}</span>`;
    }).join('');
  tip.setAttribute('aria-hidden', 'false');
  tip.classList.add('on');

  // Measure after filling, or the first hover positions against a zero-size box.
  const r = row.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const pad = 10;
  // Prefer the right of the row; flip left when that would overflow.
  let x = r.right + pad;
  if (x + t.width > window.innerWidth - pad) x = Math.max(pad, r.left - t.width - pad);
  // Vertically centre on the row, then clamp inside the viewport.
  let y = r.top + r.height / 2 - t.height / 2;
  y = Math.max(pad, Math.min(y, window.innerHeight - t.height - pad));
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}

function hideTip() {
  const tip = app.querySelector?.('.tip');
  if (!tip) return;
  tip.classList.remove('on');
  tip.setAttribute('aria-hidden', 'true');
}

app.addEventListener('mouseover', (e) => {
  const row = e.target?.closest?.('[data-fx]');
  if (row && app.contains(row)) showTip(row); else hideTip();
});
app.addEventListener('mouseleave', hideTip);
// Re-rendering mid-hover leaves a tooltip describing a row that no longer exists.
app.addEventListener('click', hideTip);

if (typeof window !== 'undefined') {
  window.addEventListener('resize', fitPanels);
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('keydown', e => {
    // Undo is frozen by the lock along with its button. It restores a whole snapshot
    // of state.done, so it can reach past the frontier in one keystroke -- the exact
    // move the lock exists to prevent. It is also no longer needed: locked ticking
    // can't cascade, so there is nothing to recover from.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (state.locked) return;
      if (undo()) { e.preventDefault(); render(); }
    }
  });
}

// Controls the lock freezes. Each is also rendered `disabled` while locked, so a
// disabled button never fires a click and this list is the second line of defence
// rather than the first. It is genuinely load-bearing for [data-undo], which has a
// keyboard route with no button to disable.
//
// [data-step] is deliberately NOT here. In Detail the star rows are nested INSIDE the
// card, and the card carries data-step -- so closest('[data-step]') matches on a star
// click too, and sweeping it here swallowed every tick the lock was supposed to allow.
// The handler already resolves that precedence by checking [data-star] first; the
// whole-constellation tick is frozen inside its own branch, below, where that order
// still holds.
//
// Not frozen, and deliberately: [data-plain] (Overview/Detail is pure presentation
// and re-renders without re-solving), [data-tab] and [data-cat] (browsing the tag
// library changes nothing). Freezing those would protect nothing and would take
// away the second view exactly when you are following the path and want it.
const LOCKED_OUT = ['data-reset', 'data-rm', 'data-setw', 'data-add', 'data-score',
  'data-resetprogress', 'data-undo', 'data-clearorder'];

/** Should the lock swallow this click? Raises the dialog unless it's been dismissed. */
function lockSwallows(e) {
  if (!state.locked) return false;
  const hit = LOCKED_OUT.find(a => {
    const el = e.target.closest(`[${a}]`);
    return el && app.contains(el);
  });
  if (!hit) return false;
  if (!state.lockWarnSeen) { state.dialog = 'frontier'; render(); }
  return true;
}

// --- dragging a constellation to a new position ------------------------------
// HTML5 drag-and-drop rather than pointer events: the layout is a 900px desktop one,
// and this buys the drag image, the cursor and the escape-to-cancel behaviour from the
// browser instead of reimplementing them. Revisit if the app ever wants touch.
//
// dragFrom is module state rather than dataTransfer, because dragover needs to know
// the source to decide whether a drop is a no-op, and dataTransfer.getData() is
// deliberately unreadable during dragover in most browsers.
let dragFrom = null;
let dragOver = null;
// Where each drop position would actually LAND the dragged row, computed once when
// the drag starts: landings[to] is the resulting index, or null if that arrangement
// cannot be scheduled inside the point cap.
//
// Worth precomputing rather than resolving after the fact, because a drop position and
// its result mostly are not the same thing. Measured over three rows of an 18-step
// path: dropping at 0 or at 1 gives an identical result, nine consecutive positions in
// one fixture all leave the row exactly where it was, and in another every position
// but one exceeds 55 points. A bar that follows the cursor is confidently wrong in all
// three cases.
//
// It costs 5-13ms for a whole path -- one schedulePath() per position at ~0.5ms -- so
// it happens on dragstart, not per dragover.
let landings = null;

const dragIndexOf = el => {
  const row = el?.closest?.('[data-drag]');
  return row && app.contains(row) ? +row.dataset.drag : null;
};

/** Paint the insertion point without re-rendering: a drag is 60fps, render is not. */
function paintDrop() {
  for (const el of app.querySelectorAll?.('.prow') ?? []) {
    el.classList.remove('dropbefore', 'dropafter', 'dragging');
  }
  if (dragFrom == null) return;
  const rows = app.querySelectorAll?.('[data-drag]') ?? [];
  const land = dropTarget();
  for (const el of rows) {
    const i = +el.dataset.drag;
    if (i === dragFrom) el.classList.add('dragging');
    if (dragOver == null) continue;
    // The bar marks where the row will ACTUALLY end up, not where the cursor is. It
    // therefore stops moving while you drag across positions that resolve to the same
    // place -- which is the honest reading of those positions, not a stuck control.
    if (land.at != null && i === land.at && i !== dragFrom) {
      el.classList.add(i < dragFrom ? 'dropbefore' : 'dropafter');
    }
    // Nothing fits: mark the row under the cursor in red instead, since there is no
    // landing position to mark.
    if (land.at == null && i === dragOver) {
      el.classList.add('dropbad', i < dragFrom ? 'dropbefore' : 'dropafter');
    }
  }
}

/** Where the current cursor position would land, and whether it can be scheduled. */
function dropTarget() {
  if (dragFrom == null || dragOver == null) return { at: null, ok: false };
  const at = landings?.[dragOver] ?? null;
  return { at, ok: at != null && at !== dragFrom };
}

app.addEventListener('dragstart', e => {
  const i = dragIndexOf(e.target);
  if (i == null || state.locked) return;
  dragFrom = i;
  dragOver = null;
  landings = landingsFor(i);
  // Firefox refuses to start a drag unless something is set.
  try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch { /* not fatal */ }
  paintDrop();
});

app.addEventListener('dragover', e => {
  if (dragFrom == null) return;
  const i = dragIndexOf(e.target);
  if (i == null) return;
  // Without preventDefault the browser treats the row as an invalid drop target and
  // the drop event never fires at all.
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch { /* not fatal */ }
  if (i !== dragOver) { dragOver = i; paintDrop(); }
});

app.addEventListener('drop', e => {
  if (dragFrom == null) return;
  e.preventDefault();
  const to = dragIndexOf(e.target) ?? dragOver;
  const from = dragFrom;
  // A drop the scheduler can't take is simply cancelled. The bar was already red, so
  // it has been refused before you let go rather than explained afterwards -- which is
  // why there is no longer a note to write.
  const landed = to == null ? null : landings?.[to] ?? null;
  dragFrom = dragOver = null;
  landings = null;
  if (to == null || to === from || landed == null || landed === from) { paintDrop(); return; }
  if (moveInOrder(from, to)) {
    // Re-schedule, do NOT re-solve. The set is the answer to your tags and a drag is
    // not a change to your tags -- and solveBest() is time-budgeted, so re-solving
    // could quietly hand back a different set of constellations.
    reorderNow();
    render();
    scheduleMovableSweep();   // a new order means new answers about what can move
  } else {
    paintDrop();
  }
});

// Covers dropping outside the list and pressing Escape, both of which fire dragend
// and neither of which fires drop.
app.addEventListener('dragend', () => {
  dragFrom = dragOver = null;
  landings = null;
  paintDrop();
});

app.addEventListener('click', e => {
  // The lock's own controls have to keep working while locked, so they are checked
  // before anything is swallowed.
  const lk = e.target.closest('[data-lock]');
  if (lk && app.contains(lk)) {
    // Locking is immediate; unlocking asks. The asymmetry is the point -- putting the
    // guard up should be frictionless, taking it down is the thing you might be doing
    // by accident.
    if (state.locked) state.dialog = 'unlock';
    else { state.locked = true; state.dialog = null; }
    render();
    scheduleMovableSweep();   // locked, nothing drags, so the answer is dropped
    return;
  }
  const dg = e.target.closest('[data-dialog]');
  if (dg && app.contains(dg)) {
    const act = dg.dataset.dialog;
    if (act === 'unlock') state.locked = false;
    // "Don't show this again" is answered by which button you press, rather than by a
    // checkbox that then needs a separate confirm. Same decision, one click, and no
    // way to tick the box and then cancel -- which would have left it ambiguous
    // whether the preference was meant to stick.
    if (act === 'hush') state.lockWarnSeen = true;
    state.dialog = null;
    render();
    return;
  }

  const co = e.target.closest('[data-clearorder]');
  if (co && app.contains(co)) {
    if (!state.order) return;
    dropOrder();
    reorderNow();     // back to the solver's own schedule; still no re-solve
    render();
    scheduleMovableSweep();
    return;
  }

  if (lockSwallows(e)) return;

  // Scope every lookup INSIDE the app root. `closest('[data-mode]')` used to walk
  // all the way up to the host's <html data-mode="dark">, match it, and swallow
  // every click in the widget. Hence data-score, plus the app.contains guard.
  const m = e.target.closest('[data-score]');
  if (m && app.contains(m)) {
    const next = +m.dataset.score;
    // Clicking the mode already selected isn't a change -- without this it still
    // re-solved and, via build(), cleared the undo trail for nothing.
    if (state.mode === next) return;
    state.mode = next;
    // A different scoring mode is a different set of constellations, so a manual
    // order over the old set no longer describes anything. Same reason a tag change
    // drops it.
    dropOrder();
    // Rebuild straight away. Deferring this to the Build button was meant to protect
    // in-progress ticks, but ticks are keyed constellation:star and survive a rebuild,
    // so the only thing deferral achieved was a tab that appeared to do nothing.
    scheduleBuild();
    return;
  }

  // Pure view switch -- no re-solve, so it can't disturb the plan or the ticks.
  const pl = e.target.closest('[data-plain]');
  if (pl && app.contains(pl)) {
    state.plain = !state.plain;
    render();
    // Only Overview drags, so the sweep is paid for on the way in rather than kept
    // warm for someone who never opens it.
    scheduleMovableSweep();
    return;
  }

  // A star click must win over the card click that would otherwise bubble to it.
  const rs = e.target.closest('[data-reset]');
  if (rs && app.contains(rs)) { reset(); return; }

  // Click the star you mean. This replaced a cycle-upward control, which needed two
  // clicks to go from 3 to 2 and wrapped round at the top -- fine for a toggle, poor
  // for a value. Setting directly is one click from anywhere to anywhere.
  const sw = e.target.closest('[data-setw]');
  if (sw && app.contains(sw)) {
    const [slot, level] = sw.dataset.setw.split(':').map(Number);
    if (!Number.isInteger(slot) || state.sel[slot] == null) return;
    const next = clampWeight(level);
    // Clicking the star that's already lit is a no-op click, not a change -- without
    // this it still dropped any Custom order and kicked off a full re-solve for a
    // weight that didn't move.
    if (state.weights[slot] === next) return;
    state.weights[slot] = next;
    dropOrder(); scheduleBuild();
    return;
  }

  const un = e.target.closest('[data-undo]');
  if (un && app.contains(un)) { if (undo()) render(); return; }

  const rp = e.target.closest('[data-resetprogress]');
  if (rp && app.contains(rp)) { if (resetProgress()) render(); return; }

  const star = e.target.closest('[data-star]');
  if (star && app.contains(star)) {
    const key = star.dataset.star;
    if (state.locked) {
      // Exactly two stars are live: tick the next one, un-tick the last one bought.
      // Comparing against both ends rather than asking "is it bought?" is what keeps
      // this a single rule -- an unbought star that isn't next and a bought star that
      // isn't prev are the same mistake and get the same answer.
      const { next, prev } = frontier();
      if (key !== next && key !== prev) {
        if (!state.lockWarnSeen) { state.dialog = 'frontier'; render(); }
        return;
      }
    }
    pushHistory();
    toggleStar(key);
    render();
    return;
  }

  // Clicking the card header ticks or clears the whole constellation at once.
  //
  // Reached only after [data-star] has had its turn, which matters: a star sits inside
  // the card, so both match and the star must win. That ordering is why the lock's
  // block on this lives here rather than in LOCKED_OUT.
  const st = e.target.closest('[data-step]');
  if (st && app.contains(st)) {
    if (state.locked) {
      // No frontier reading of "tick all seven of these", so it is simply refused.
      if (!state.lockWarnSeen) { state.dialog = 'frontier'; render(); }
      return;
    }
    pushHistory();
    toggleSteps((st.dataset.keys || '').split(',').filter(Boolean));
    render();
    return;
  }
  const t = e.target.closest('button');
  if (!t || !app.contains(t)) return;
  if (t.dataset.add != null) {
    const i = +t.dataset.add;
    if (state.sel.includes(i)) return;
    const slot = state.sel.indexOf(null);
    if (slot < 0) return;
    // A custom order is a re-ordering of one particular set of constellations. Change
    // the tags and that set changes, so the saved order no longer refers to anything.
    state.sel[slot] = i; state.weights[slot] = DEFAULT_WEIGHT;
    dropOrder(); scheduleBuild();
  } else if (t.dataset.rm != null) {
    state.sel[+t.dataset.rm] = null; dropOrder(); scheduleBuild();
  } else if (t.dataset.tab) {
    // Clicking the tab already showing isn't a change -- without this it still
    // rebuilt the whole panel's innerHTML for an identical result.
    if (t.dataset.tab === state.tab) return;
    state.tab = t.dataset.tab; render();
  } else if (t.dataset.cat) {
    state.open.has(t.dataset.cat) ? state.open.delete(t.dataset.cat) : state.open.add(t.dataset.cat);
    render();
  }
});

if (load()) scheduleBuild(); else render();

// --- test surface ------------------------------------------------------------
// Exported for `lib/ui.test.mjs`, which drives the page from node. Kept as one
// explicit list rather than exporting at each declaration, so the surface the tests
// depend on is visible in a single place -- and so it is obvious when a test starts
// leaning on something new.
//
// Nothing else imports this module, so the exports cost nothing at runtime.
export {
  state, chips, db, history,
  build, render, save, load,
  toggleStar, toggleSteps, plannedStars, completedSet,
  treeGutter, starIdxs,
  frontier, pathStarKeys,
  applyOrder, currentOrder, moveInOrder, reorderNow, landingsFor, immovableSet,
};
