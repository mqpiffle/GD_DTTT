// Tests for the UI script itself.
//
// It imports `src/app.mjs` directly. Until 1 Aug the page's logic lived in an inline
// <script> and this file had to read the HTML, regex the block out, rewrite every
// relative import to an absolute file URL, append an export list and load the result
// from a data: URL. All of that is gone; the only thing that survives from it is the
// requirement to stub the browser globals BEFORE the import, since app.mjs runs on
// load and reaches for document, localStorage, fetch and window as it goes.
//
// It asserts what the markup SAYS, not how it looks -- there is no layout engine
// here. That still covers the failure that matters: the views disagreeing with each
// other, or with the plan they claim to describe.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.join(import.meta.dirname, '..');

// The stylesheet, for the handful of assertions that are about CSS rather than markup.
// It moved out of ui-mockup.html's inline <style> into app.css on 1 Aug; these tests
// used to read the HTML file and got it for free.
//
// They exist despite the "don't test presentation" convention because each pins a rule
// whose failure is INVISIBLE rather than obvious: a bullet that renders as nothing, two
// marker columns that resolve to different widths, a strike-through inside a 10px pill.
const css = fs.readFileSync(path.join(srcDir, 'app.css'), 'utf8');
// Listeners are captured, not discarded, so tests can go through the real click
// handler. Testing the exported functions alone leaves the wiring untested -- and
// the wiring is exactly where a cascade gets reverted to a plain toggle.
const listeners = [];
const winListeners = [];

// Scroll panels are recreated on every innerHTML swap, exactly as the browser does.
// A persistent stub would carry scrollTop across the swap by itself and hide the very
// bug the preservation code exists to fix.
const makeBox = () => ({ scrollTop: 0, style: {}, getBoundingClientRect: () => ({ top: 300 }) });

/** A tooltip stub with just enough DOM to be positioned: classes, content, and a size. */
const makeTip = () => {
  const cls = new Set();
  return {
    innerHTML: '', style: {}, attrs: {},
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
    },
    get shown() { return cls.has('on'); },
    setAttribute(k, v) { this.attrs[k] = v; },
    // Fixed 200x120 so the flip and clamp arithmetic has something real to work against.
    getBoundingClientRect: () => ({ width: 200, height: 120, top: 0, left: 0 }),
  };
};
let boxes = {};

const app = {
  _html: '', scrollTop: 0,
  get innerHTML() { return this._html; },
  set innerHTML(v) { this._html = v; boxes = {}; },
  querySelector(sel) {
    // The tooltip needs more than a scroll box: content, classes and a measurable size,
    // since showTip() positions against its own rendered width.
    if (sel === '.tip') {
      if (!this._html.includes('class="tip"')) return null;
      return (boxes[sel] ??= makeTip());
    }
    // The rename field, when the bar is showing one. Value is settable by a test the
    // way a person would type into it.
    if (sel === '[data-cname]') {
      if (!this._html.includes('data-cname=')) return null;
      return (boxes[sel] ??= { value: /data-cname="1" value="([^"]*)"/.exec(this._html)?.[1] ?? '',
                               focus() {}, select() {} });
    }
    if (sel !== '.scroll' && sel !== '.dscroll') return null;
    if (!this._html.includes(`class="${sel.slice(1)}"`)) return null;
    return (boxes[sel] ??= makeBox());
  },
  contains: () => true,
  // paintDrop() sweeps rows to move the insertion marker. There is no layout here and
  // the marker is presentation, so an empty sweep is the honest stub -- what matters
  // is that the handler runs to completion and the ORDER changes.
  querySelectorAll: () => [],
  addEventListener: (type, fn) => listeners.push([type, fn]),
};
globalThis.window = {
  innerHeight: 900,
  addEventListener: (type, fn) => winListeners.push([type, fn]),
};

// Selector -> the dataset key it would match. Enough of closest() for this handler.
const SEL = {
  '[data-score]': 'score', '[data-plain]': 'plain', '[data-reset]': 'reset',
  '[data-setw]': 'setw', '[data-star]': 'star', '[data-step]': 'step',
  '[data-undo]': 'undo', '[data-add]': 'add',
  '[data-lock]': 'lock', '[data-dialog]': 'dialog', '[data-clearorder]': 'clearorder',
  '[data-rm]': 'rm', '[data-resetprogress]': 'resetprogress',
  '[data-cnew]': 'cnew', '[data-cdup]': 'cdup', '[data-crename]': 'crename',
  '[data-cdel]': 'cdel', '[data-cswitch]': 'cswitch',
  '[data-ctl]': 'ctl', '[data-ctlin]': 'ctlin',
  '[data-collapse]': 'collapse', '[data-difficulty]': 'difficulty',
  '[data-compare]': 'compare', '[data-adopt]': 'adopt',
};

/** Fire a `change` on an element carrying `dataset`, as a <select> does. */
function change(dataset) {
  const el = { dataset, value: dataset.value, closest: sel => (dataset[SEL[sel]] != null ? el : null) };
  for (const [type, fn] of listeners) if (type === 'change') fn({ target: el });
}

/** Fire a click as if on an element carrying `dataset`. */
function click(dataset) {
  const el = { dataset, closest: sel => (matches(sel) ? el : null) };
  const matches = sel => (sel === 'button' ? dataset.button != null : dataset[SEL[sel]] != null);
  for (const [type, fn] of listeners) if (type === 'click') fn({ target: el });
}

/**
 * Hover a row carrying `dataset`, at the given screen rectangle.
 * `rect` decides whether the tooltip has room on the right, so it drives the flip.
 */
function hover(dataset, rect = { left: 100, right: 300, top: 200, height: 20 }) {
  const el = {
    dataset,
    closest: sel => (sel === '[data-fx]' && dataset.fx != null ? el : null),
    getBoundingClientRect: () => rect,
  };
  for (const [type, fn] of listeners) if (type === 'mouseover') fn({ target: el });
  return boxes['.tip'];
}
const leaveApp = () => {
  for (const [type, fn] of listeners) if (type === 'mouseleave') fn({});
};

/**
 * Drag row `from` onto row `to`, through the page's own dragstart/dragover/drop
 * listeners.
 *
 * Going through the handlers rather than calling moveInOrder() directly is what keeps
 * the WIRING tested: with the helper calling the functions itself, replacing the drop
 * handler's re-schedule with a full re-solve passed every test.
 */
function dragRow(from, to) {
  const row = i => {
    const el = { dataset: { drag: String(i) }, closest: sel => (sel === '[data-drag]' ? el : null) };
    return el;
  };
  const ev = target => ({ target, preventDefault() {}, dataTransfer: null });
  const fireOn = (type, target) => {
    for (const [t, fn] of listeners) if (t === type) fn(ev(target));
  };
  fireOn('dragstart', row(from));
  fireOn('dragover', row(to));
  fireOn('drop', row(to));
  fireOn('dragend', row(to));
}

/** Fire a window event, e.g. a keydown or a resize. */
function fire(type, ev = {}) {
  for (const [t, fn] of winListeners) if (t === type) fn({ preventDefault() {}, ...ev });
}
globalThis.document = { getElementById: () => app };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
// Serves the real files by name. It used to ignore the URL and hand back ui-index.json
// whatever was asked for, which meant classes.json silently arrived as the wrong file --
// harmless only because characterLabel() degrades. Once import started reading the
// keyword and item indexes that stub would have quietly disabled the analysis and left
// the tests passing.
globalThis.fetch = async (url) => {
  const file = path.join(srcDir, '..', String(url).replace(/^\.\.\//, ''));
  if (!fs.existsSync(file)) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

// Imported like any other module, now that the page's logic lives in a file. Until
// 1 Aug this had to read ui-mockup.html, regex the inline <script> out of it, rewrite
// every relative import to an absolute file URL because a data: URL has no directory,
// append an export list, and load the result from base64. All of that existed solely
// because the code was inside an HTML tag.
//
// The import must come AFTER the globals above are stubbed: app.mjs runs on import,
// and it reaches for document, localStorage, fetch and window as it goes.
const ui = await import('../app.mjs');

const chipIdx = (label, ns = 'character') =>
  ui.chips.findIndex(c => c.label === label && c.ns === ns);

// `keep` opts out of the progress reset, for the tests that are ABOUT progress
// surviving a rebuild -- for those, clearing it would make the assertion pass on an
// empty set and prove nothing.
function plan(labels, mode, { keep = false } = {}) {
  ui.state.sel = ui.state.sel.map(() => null);
  // Reset the weights too. A test that set them and moved on used to change every
  // fixture that ran after it -- the re-order tests failed only when the whole file ran,
  // and passed in isolation, which is a miserable thing to debug.
  ui.state.weights = ui.state.weights.map(() => 2);
  labels.forEach(([l, ns], i) => { ui.state.sel[i] = chipIdx(l, ns); });
  ui.state.mode = mode;
  // Module state is shared across tests, and a manual order left behind by one would
  // silently re-order every fixture after it -- the same trap the weights reset fixed.
  ui.state.order = null;
  // Third instance of the same trap, and this one changed the VIEW rather than the
  // plan: ticks left behind by an earlier test made hasComparison() true, so the
  // comparison rendered and a later test found no tickable stars at all.
  if (!keep) { ui.state.done.clear(); ui.state.compare = null; }
  // Fourth instance of the leak, and the subtlest: withStore() puts localStorage back but
  // NOT the in-memory document, so a test that marked its character as imported left that
  // mark on every fixture after it -- and an imported character always has a comparison,
  // so the next test looking for a tickable path found a diff instead.
  const c = ui.activeChar?.();
  if (c && !keep) delete c.source;
  // Fifth instance. Adopt now engages the lock, so a test that adopted left every fixture
  // after it read-only -- and a locked fixture hides half the header and swallows clicks,
  // which reads as a bug in whatever the next test was actually about.
  if (!keep) ui.state.locked = false;
  ui.build();
  return ui.state.plan;
}

/**
 * The star control's inner HTML for a given weight class.
 *
 * Anchored on the END of the row rather than on whatever element happens to follow.
 * These regexes used to key off the remove button sitting immediately after the stars,
 * which broke the moment the row was reordered to put the remove button beside the name
 * -- a layout change failing a test about glyphs. The stars are spans themselves, so a
 * non-greedy match to the first `</span>` stops inside the control; matching to the
 * row's closing `</div>` and taking everything up to the last `</span>` is what works
 * regardless of sibling order.
 */
function starControl(weightClass) {
  const row = new RegExp(`<span class="dots pick ${weightClass}">([\\s\\S]*?)</div>`).exec(app.innerHTML);
  if (!row) return null;
  const end = row[1].lastIndexOf('</span>');
  return end < 0 ? null : row[1].slice(0, end);
}

const countRows = h => (h.match(/<div class="prow/g) ?? []).length;
const countCards = h => (h.match(/<div class="card[ "]/g) ?? []).length;

test('the plain view lists every step the cards do', () => {
  for (const mode of [0, 1, 2]) {
    const p = plan([['Cold Damage'], ['Health']], mode);
    assert.ok(p, `no plan (mode ${mode})`);

    ui.state.plain = false; ui.render();
    const cards = countCards(app.innerHTML);
    ui.state.plain = true; ui.render();
    const rows = countRows(app.innerHTML);

    assert.equal(rows, p.schedule.path.length,
      `plain view showed ${rows} rows for a ${p.schedule.path.length}-step path (mode ${mode})`);
    assert.equal(rows, cards,
      `plain view and cards disagree: ${rows} vs ${cards} (mode ${mode})`);
  }
});

test('the plain view marks exactly the steps that carry a wanted tag', () => {
  const p = plan([['Cold Damage'], ['Movement Speed']], 2);
  ui.state.plain = true; ui.render();

  // What the markup claims.
  const marked = (app.innerHTML.match(/<div class="prow[^"]*\bphit\b/g) ?? []).length;

  // What the plan actually contains. Refunds are Crossroads and carry nothing.
  const want = ui.state.sel.filter(i => i != null).map(i => ui.chips[i].id);
  const truth = p.schedule.path.filter(s => s.kind !== 'refund').filter(s => {
    const hits = p.solution.length && s.id;
    return hits && want.some(k => (db(s.id)?.hits?.[k] ?? 0) > 0);
  }).length;

  assert.equal(marked, truth,
    `${marked} rows marked as carrying a tag, but ${truth} steps actually do`);
  assert.ok(truth > 0, 'this fixture should hit something');

  function db(id) {
    // The UI's db isn't exported; read the same source it was built from.
    const idx = JSON.parse(fs.readFileSync(path.join(srcDir, '../ui-index.json'), 'utf8'));
    return idx.constellations.find(c => c.id === id) && { hits: idx.constellations.find(c => c.id === id).k };
  }
});

test('the plain view reports where the first tagged pick lands', () => {
  // This is the number the ordering bug hid: with the payoff 11 steps down, nobody
  // counts. If the summary and the rows ever disagree the readout is worse than
  // useless, so pin them together.
  plan([['Cold Damage']], 2);
  ui.state.plain = true; ui.render();
  const h = app.innerHTML;

  const stated = /first tagged pick at #(\d+)/.exec(h);
  assert.ok(stated, `summary did not state a position: ${/class="total"[^>]*>([^<]*)/.exec(h)?.[1]}`);

  // Position among non-refund steps, counted off the rendered rows.
  const rows = [...h.matchAll(/<div class="(prow[^"]*)"/g)].map(m => m[1]);
  const takes = rows.filter(c => !c.includes('pref'));
  const at = takes.findIndex(c => c.includes('phit')) + 1;
  assert.equal(+stated[1], at, 'summary and rows disagree about the first tagged pick');
  assert.ok(at > 0 && at <= 6, `first tagged pick at #${at}`);
});

test('switching views leaves the plan and the ticks alone', () => {
  // The toggle must be pure presentation -- re-solving on a view change would throw
  // away progress, and the whole point is to check the CURRENT path.
  const p = plan([['Fire Damage'], ['Armor']], 1);
  const before = p.solution.map(e => `${e.id}:${e.starsTaken}`).join('|');
  ui.state.done = new Set(['a:1', 'b:2']);

  // Through the button, not by setting state -- otherwise a handler that clears
  // progress on the way past goes unnoticed.
  ui.state.plain = false; ui.render();
  for (let i = 0; i < 4; i++) click({ plain: '1' });

  assert.equal(ui.state.plan.solution.map(e => `${e.id}:${e.starsTaken}`).join('|'), before,
    'toggling the view changed the plan');
  assert.deepEqual([...ui.state.done].sort(), ['a:1', 'b:2'], 'toggling the view lost progress');
});

// --- ticking off progress ---------------------------------------------------
// Both views write to one set of `constellation:star` keys, which is the only reason
// progress can't drift between them. These tests pin that shared contract rather
// than each view's rendering, because a second source of truth is the failure mode.

const keysOf = h => [...h.matchAll(/data-keys="([^"]+)"/g)].map(m => m[1]);

test('Overview and Detail tick the same keys for the same steps', () => {
  plan([['Cold Damage'], ['Armor']], 2);

  ui.state.plain = false; ui.render();
  const detail = keysOf(app.innerHTML);
  ui.state.plain = true; ui.render();
  const overview = keysOf(app.innerHTML);

  assert.deepEqual(overview, detail,
    'the two views offer different star keys, so ticking in one would not show in the other');
  assert.ok(overview.length > 0, 'no tickable steps at all');
});

test('a tick made in Overview shows as complete in Detail', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = true; ui.render();

  // Tick the second step exactly as the click handler would.
  const target = keysOf(app.innerHTML)[1].split(',');
  for (const k of target) ui.state.done.add(k);

  ui.render();
  assert.equal((app.innerHTML.match(/class="pck on"/g) ?? []).length, 1,
    'Overview did not mark the step it was told about');

  ui.state.plain = false; ui.render();
  assert.equal((app.innerHTML.match(/class="card done/g) ?? []).length, 1,
    'Detail did not see a tick made in Overview');

  ui.state.plain = true; ui.render();
  assert.equal((app.innerHTML.match(/class="pck on"/g) ?? []).length, 1,
    'the tick did not survive a round trip through Detail');
});

test('a part-bought constellation reads as part-bought, not untouched', () => {
  // Detail ticks single stars, so this state is reachable and must not look the same
  // as nothing at all.
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = true; ui.render();

  const stars = keysOf(app.innerHTML)[1].split(',');
  assert.ok(stars.length > 1, 'need a multi-star step for this test');
  ui.state.done.add(stars[0]);
  ui.render();

  assert.equal((app.innerHTML.match(/class="pck part"/g) ?? []).length, 1,
    'one star ticked did not produce an indeterminate box');
  assert.equal((app.innerHTML.match(/class="pck on"/g) ?? []).length, 0,
    'one star ticked marked the whole constellation bought');

  for (const k of stars) ui.state.done.add(k);
  ui.render();
  assert.equal((app.innerHTML.match(/class="pck part"/g) ?? []).length, 0,
    'still indeterminate after every star was ticked');
});

// --- the effect tooltip -----------------------------------------------------------

test('every star row carries its effects as data', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();
  const rows = (app.innerHTML.match(/data-star="/g) ?? []).length;
  // Scoped to star rows: card titles and CP badges carry data-fx too now, so counting
  // every occurrence in the document compares different things.
  const withFx = (app.innerHTML.match(/class="star[^"]*" data-fx="/g) ?? []).length;
  assert.ok(rows > 10, 'expected a decent number of star rows');
  assert.equal(withFx, rows, `${withFx} of ${rows} star rows carry effects`);
  // The native title is gone -- two tooltips for one row would be worse than either.
  assert.doesNotMatch(app.innerHTML, /<div class="star[^>]*\stitle=/,
    'a native title is still on the star rows');
  assert.match(app.innerHTML, /class="tip"/, 'no tooltip element rendered');
});

test('the card title carries the constellation total, the CP badge carries the proc', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();
  const h = app.innerHTML;

  const title = [...h.matchAll(/class="nm" data-fx="([\s\S]*?)" data-fxhead="([^"]*)"/g)]
    .find(m => m[2].startsWith('Tsunami'));
  assert.ok(title, 'no aggregate tooltip on the Tsunami card title');
  assert.match(title[2], /Tsunami — \d+ of \d+ stars/, 'the head should say how many stars');
  // +15% on star 1 and +24% on star 4 must arrive summed, not as two lines.
  const lines = title[1].split('\n').map(l => l.split('␟').pop());
  assert.ok(lines.includes('+39% Cold Damage'),
    `expected a summed cold line, got: ${lines.join(' | ')}`);
  assert.ok(!lines.some(l => /Skill Recharge|Fumble/.test(l)),
    'proc numbers leaked into the constellation total');

  const badge = [...h.matchAll(/class="cp" data-fx="([\s\S]*?)" data-fxhead="([^"]*)"/g)]
    .find(m => m[2] === 'Tsunami');
  assert.ok(badge, 'no proc tooltip on the CP badge');
  const proc = badge[1].split('\n').map(l => l.split('␟').pop());
  assert.ok(proc.some(l => /Skill Recharge/.test(l)), `no proc numbers: ${proc.join(' | ')}`);
});

test('a bonus serving one of your tags is flagged with that tag\'s weight', () => {
  // The tooltip pills those lines in the tag's colour, which needs the weight to travel
  // with the line. Cold Damage at three stars, Defensive Ability at one.
  ui.state.sel = ui.state.sel.map(() => null);
  ui.state.sel[0] = chipIdx('Cold Damage');
  ui.state.sel[1] = chipIdx('Defensive Ability');
  ui.state.weights[0] = 3;
  ui.state.weights[1] = 1;
  ui.state.mode = 2; ui.build(); ui.state.plain = false; ui.render();

  const rows = [...app.innerHTML.matchAll(/class="star[^"]*" data-fx="([\s\S]*?)" data-star/g)];
  const flagged = rows.flatMap(r => r[1].split('\n'))
    .map(l => l.split('␟'))
    .filter(([w]) => Number(w) > 0);
  assert.ok(flagged.length > 0, 'no bonus was flagged as serving a tag');

  for (const [w, text] of flagged) {
    if (/Cold Damage|Frostburn/.test(text)) {
      assert.equal(w, '3', `cold line carried weight ${w}, expected the tag's 3: ${text}`);
    } else if (/Defensive Ability/.test(text)) {
      assert.equal(w, '1', `defensive line carried weight ${w}, expected 1: ${text}`);
    }
  }
  // A stat nobody asked for stays unflagged.
  const spirit = rows.flatMap(r => r[1].split('\n')).find(l => /Spirit/.test(l));
  if (spirit) assert.match(spirit, /^0␟/, 'an untagged bonus should carry weight 0');
});

test('hovering a star fills the tooltip with its effects', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();

  const tip = hover({ fx: '+15% Cold Damage\n+15% Lightning Damage' });
  assert.ok(tip, 'no tooltip element found');
  assert.ok(tip.shown, 'tooltip was not shown');
  assert.match(tip.innerHTML, /\+15% Cold Damage/);
  assert.match(tip.innerHTML, /\+15% Lightning Damage/);
  assert.equal(tip.attrs['aria-hidden'], 'false');

  // A power star leads with the power's name.
  const withHead = hover({ fx: '28 Physical Damage', fxhead: "Targo's Hammer" });
  assert.match(withHead.innerHTML, /<b>Targo&#39;s Hammer<\/b>|<b>Targo's Hammer<\/b>/,
    `head missing: ${withHead.innerHTML}`);
});

test('the tooltip marks a tagged bonus with that tag\'s coloured star', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();

  // "weight␟text" per line: 3 means a three-star tag, 0 means nobody asked for it.
  const tip = hover({ fx: '3␟+39% Cold Damage\n0␟+15 Spirit' });
  // The class is what the CSS hangs the star bullet and its colour on.
  assert.match(tip.innerHTML, /class="hit w3"[^>]*>\+39% Cold Damage/,
    `tagged line not marked: ${tip.innerHTML}`);
  assert.match(tip.innerHTML, /<span>\+15 Spirit/, 'untagged line should be plain');
  assert.doesNotMatch(tip.innerHTML, /␟/, 'the separator leaked into the display');

  // Each weight gets its own class so the colours match the weight control.
  for (const w of [1, 2, 3]) {
    const t = hover({ fx: `${w}␟+10% Armor` });
    assert.match(t.innerHTML, new RegExp(`class="hit w${w}"`), `weight ${w} lost its class`);
  }

  // And the stylesheet turns those classes into a coloured star bullet. Checking the
  // class alone would pass with no visible difference at all -- which is exactly how the
  // missing ti-star-filled glyph slipped through earlier.
  // Match the CONTENT, not the whole declaration block -- the rule also carries sizing
  // and baseline tweaks, and pinning the exact block makes any restyle a test failure.
  assert.match(css, /\.tip span\.hit::before\{[^}]*content:'\\2605'/,
    'tagged rows should be bulleted with a star');
  assert.match(css, /\.tip span::before\{[^}]*content:'·'/,
    'untagged rows should keep a plain bullet');
  // Alignment is the point of the marker column, and the first version of this test
  // only checked that A width existed. The actual bug was that the two widths RESOLVED
  // differently: `width` in `em` is relative to the pseudo-element's own font-size, so
  // a 1.5em box at font-size 1.5em is 2.25em while the same box at 1em is 1.5em. So
  // assert the column is sized in absolute units and that the star rule never
  // redeclares the geometry.
  const marker = /\.tip span::before\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(marker, /width:\d+px/, 'the marker column must be sized in px, not em');
  assert.match(marker, /text-align:center/, 'markers must be centred in that column');
  assert.match(marker, /position:absolute/, 'markers sit out of flow so glyph size cannot move the text');

  const starRule = /\.tip span\.hit::before\{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const prop of ['width', 'left', 'position', 'text-align']) {
    assert.doesNotMatch(starRule, new RegExp(`${prop}:`),
      `the star rule redeclares ${prop}; the two markers will drift apart`);
  }
  // The parent's text inset must match the column, or the text starts inside it.
  const rowRule = /\.tip span\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const col = /width:(\d+)px/.exec(marker)?.[1];
  assert.match(rowRule, new RegExp(`padding-left:${col}px`),
    `row padding should match the ${col}px marker column`);
  for (const w of [1, 2, 3]) {
    assert.match(css, new RegExp(`\\.tip span\\.hit\\.w${w}::before\\{color:`),
      `weight ${w} has no bullet colour`);
  }
});

test('the tooltip flips left rather than running off the screen', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();
  window.innerWidth = 1000;

  // Room on the right: sits just past the row.
  let tip = hover({ fx: 'a' }, { left: 100, right: 300, top: 200, height: 20 });
  assert.equal(tip.style.left, '310px', 'should sit 10px right of the row');

  // No room: 900 + 10 + 200 would overflow 1000, so flip to the left of the row.
  tip = hover({ fx: 'a' }, { left: 700, right: 900, top: 200, height: 20 });
  assert.equal(tip.style.left, '490px', 'should flip to the left of the row');
});

test('the tooltip stays inside the viewport vertically', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();
  window.innerHeight = 600;
  window.innerWidth = 1400;

  // Centring on a row near the top would put it above the fold; clamp to the padding.
  let tip = hover({ fx: 'a' }, { left: 100, right: 300, top: 5, height: 20 });
  assert.equal(tip.style.top, '10px', 'should clamp to the top padding');

  // And near the bottom: 600 - 120 - 10.
  tip = hover({ fx: 'a' }, { left: 100, right: 300, top: 580, height: 20 });
  assert.equal(tip.style.top, '470px', 'should clamp to the bottom padding');
  window.innerHeight = 900;
});

test('the tooltip hides when it should', () => {
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();

  const tip = hover({ fx: '+15% Cold Damage' });
  assert.ok(tip.shown);

  // Moving onto something with no effects.
  hover({});
  assert.equal(tip.shown, false, 'should hide over a row with no effects');

  hover({ fx: '+15% Cold Damage' });
  assert.ok(tip.shown);
  leaveApp();
  assert.equal(tip.shown, false, 'should hide when the pointer leaves the app');

  // A click re-renders; a tooltip describing a row that no longer exists is worse than
  // none at all.
  hover({ fx: '+15% Cold Damage' });
  assert.ok(tip.shown);
  click({ plain: '1' });
  assert.equal(tip.shown, false, 'should hide on click');
  ui.state.plain = false; ui.render();
});

test('a bought star is marked by a check, not a strike-through', () => {
  // A strike-through inside a 10px rounded pill is invisible. The check has to be
  // in the line and must NOT be dimmed with the rest of it, or the one element
  // saying "done" ends up the faintest thing on the row.
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = false; ui.render();

  const stars = [...app.innerHTML.matchAll(/data-star="([^"]+)"/g)].map(m => m[1]);
  assert.ok(stars.length > 2, 'expected star rows to tick');
  assert.equal((app.innerHTML.match(/sck/g) ?? []).length, 0, 'checks before anything was ticked');

  ui.state.done.add(stars[1]);
  ui.render();
  const row = /<div class="star sdone"[\s\S]*?<\/div>/.exec(app.innerHTML)?.[0];
  assert.ok(row, 'ticking a star did not mark its row');
  assert.match(row, /class="ti ti-check sck"/, 'no check on a bought star');
  // Scoped to star rules: a strike-through elsewhere is fine and blocked power chips
  // legitimately use one. What must not come back is a strike on a bought star's pills.
  const starRules = css.split('\n').filter(l => /^\.s(tar|ck)/.test(l.trim())).join('\n');
  assert.doesNotMatch(starRules, /line-through/,
    'strike-through is back on the star rows');
});

test('exactly one star is marked next, and it is the earliest unbought one', () => {
  // "Next" is a property of the whole path, not of a constellation. Resolved per
  // card, every constellation would mark its own first star and several rows would
  // claim to be next at once.
  // Attribute-order agnostic: a `title` was added between class and data-star, and a
  // positional regex silently returned undefined rather than failing loudly.
  const nextOf = h => /<div class="star[^"]*\bsnext\b[^"]*"[^>]*?data-star="([^"]+)"/.exec(h)?.[1];
  const marks = h => (h.match(/\bsnext\b/g) ?? []).length;

  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = false; ui.render();

  const all = [...app.innerHTML.matchAll(/data-star="([^"]+)"/g)].map(m => m[1]);
  assert.ok(all.length > 8, 'expected a path with plenty of stars');
  assert.equal(marks(app.innerHTML), 1, 'more than one star claimed to be next');
  assert.equal(nextOf(app.innerHTML), all[0], 'the first star of the path should be next');

  // Ticking the marked star advances it, every time.
  for (let i = 0; i < 5; i++) {
    const k = nextOf(app.innerHTML);
    ui.state.done.add(k);
    ui.render();
    assert.equal(marks(app.innerHTML), 1, 'lost the marker after ticking');
    assert.notEqual(nextOf(app.innerHTML), k, `marker stuck on ${k}`);
  }

  // Ticking out of order must not skip what you left behind.
  ui.state.done = new Set([all[3], all[7]]);
  ui.render();
  assert.equal(nextOf(app.innerHTML), all[0],
    'marker skipped ahead instead of pointing at the earliest unbought star');

  ui.state.done = new Set(all);
  ui.render();
  assert.equal(marks(app.innerHTML), 0, 'still marking a next star with nothing left to buy');
});

// --- you cannot own a star without its parent --------------------------------
// Devotion trees are strictly parent-before-child, so a bare toggle can record a
// build the game cannot produce. 58 of 109 constellations branch, which is why this
// is NOT "the row above" -- Amatok's parents are [-,1,2,2,4,2,6], so star 7 needs
// 1, 2 and 6 and nothing else.

const planIds = () => ui.state.plan.solution.map(e => e.id);

function illegal() {
  const bad = [];
  for (const cid of planIds()) {
    const c = ui.db.constellations[cid];
    for (const k of ui.state.done) {
      if (!k.startsWith(cid + ':')) continue;
      const s = +k.slice(k.lastIndexOf(':') + 1);
      const p = c.starParents?.[s - 1];
      if (p && !ui.state.done.has(`${cid}:${p}`)) bad.push(`${c.name} star ${s} without ${p}`);
    }
  }
  return bad;
}

/** Ticked star numbers for one constellation. Other constellations get pulled in by
 *  the affinity rule, so assertions about tree shape have to be scoped. */
const starsOf = cid => [...ui.state.done]
  .filter(k => k.slice(0, k.lastIndexOf(':')) === cid)
  .map(k => +k.slice(k.lastIndexOf(':') + 1))
  .sort((a, b) => a - b);

const amatokId = () => {
  const id = planIds().find(i => ui.db.constellations[i].name.startsWith('Amatok'));
  assert.ok(id, 'fixture no longer contains Amatok; pick another branching constellation');
  assert.deepEqual(ui.db.constellations[id].starParents, [null, 1, 2, 2, 4, 2, 6],
    'Amatok changed shape; these tests encode its branching');
  return id;
};

test('buying a star buys its ancestors, and only its ancestors', () => {
  plan([['Cold Damage']], 2);
  const amatok = amatokId();

  ui.state.done = new Set();
  ui.toggleStar(`${amatok}:7`);
  assert.deepEqual(starsOf(amatok), [1, 2, 6, 7],
    'star 7 should pull in 6, 2 and 1 -- and NOT 3, 4, 5, which are siblings, not ancestors');
  assert.deepEqual(illegal(), []);
});

test('un-buying a star un-buys everything hanging off it', () => {
  plan([['Cold Damage']], 2);
  const amatok = amatokId();
  ui.state.done = new Set();
  ui.toggleSteps(ui.plannedStars(amatok).map(s => `${amatok}:${s}`));   // legal state first

  ui.toggleStar(`${amatok}:2`);   // 3, 4, 6 hang off 2; 5 off 4; 7 off 6
  assert.deepEqual(starsOf(amatok), [1], 'clearing star 2 should clear its whole subtree');
});

test('no sequence of clicks can produce a build the game cannot', () => {
  // The property that matters, checked the only way worth checking it: at random.
  plan([['Cold Damage'], ['Armor']], 2);
  ui.state.done = new Set();
  const all = planIds().flatMap(id => ui.plannedStars(id).map(s => `${id}:${s}`));
  assert.ok(all.length > 20, 'expected a decent-sized path');

  let seed = 7;
  for (let i = 0; i < 500; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    ui.toggleStar(all[seed % all.length]);
    const bad = illegal();
    assert.deepEqual(bad, [], `click ${i} left an impossible build: ${bad[0]}`);
  }
  assert.ok(ui.state.done.size > 0, '500 clicks and nothing is ticked; the walk did nothing');
});

test('clicking a star in the page cascades, not just calling toggleStar', () => {
  // The handler is where a cascade quietly becomes a plain toggle again. Exercising
  // toggleStar() alone would not notice, so this goes through the listener the page
  // actually registers.
  plan([['Cold Damage']], 2);
  const amatok = amatokId();
  ui.state.done = new Set();

  click({ star: `${amatok}:7` });

  assert.deepEqual(starsOf(amatok), [1, 2, 6, 7],
    'a click on star 7 did not pull in its ancestors');
});

test('clicking the Overview tick box marks the whole constellation', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = true; ui.render();

  const keys = [...app.innerHTML.matchAll(/data-keys="([^"]+)"/g)].map(m => m[1]);
  const target = keys[1].split(',');

  click({ step: 'x', keys: keys[1] });
  assert.ok(target.every(k => ui.state.done.has(k)),
    'the tick box did not mark every star of its constellation');

  click({ step: 'x', keys: keys[1] });
  assert.ok(target.every(k => !ui.state.done.has(k)),
    'clicking a full tick box again did not clear it');
  assert.deepEqual(illegal(), []);
});

test('clicking the view button switches views without re-solving', () => {
  const p = plan([['Cold Damage']], 2);
  const before = p.solution.map(e => `${e.id}:${e.starsTaken}`).join('|');
  ui.state.plain = false; ui.render();

  click({ plain: '1' });
  assert.equal(ui.state.plain, true, 'the button did not switch the view');
  assert.ok(app.innerHTML.includes('class="plain"'), 'Overview did not render');
  assert.equal(ui.state.plan.solution.map(e => `${e.id}:${e.starsTaken}`).join('|'), before,
    'switching views re-solved and changed the plan');

  click({ plain: '1' });
  assert.equal(ui.state.plain, false, 'the button did not switch back');
});

// --- you cannot reach a constellation you have no affinity for ----------------

const AFFS = ['ascendant', 'chaos', 'eldritch', 'order', 'primordial'];

/** Constellations with any star ticked whose affinity requirement isn't actually met. */
function unreachable() {
  const complete = [...ui.completedSet()];
  const bad = [];
  const touched = new Set([...ui.state.done].map(k => k.slice(0, k.lastIndexOf(':'))));
  for (const cid of touched) {
    const held = Object.fromEntries(AFFS.map(a => [a, 0]));
    for (const other of complete) {
      if (other === cid) continue;
      for (const [a, v] of Object.entries(ui.db.constellations[other]?.granted ?? {})) {
        held[a] += v;
      }
    }
    const req = ui.db.constellations[cid]?.required ?? {};
    if (!Object.entries(req).every(([a, v]) => held[a] >= v)) {
      bad.push(`${ui.db.constellations[cid].name} needs ${JSON.stringify(req)}, holds ${
        JSON.stringify(held)}`);
    }
  }
  return bad;
}

test('completing a constellation pulls in the affinity it needs, and no filler', () => {
  // Amatok needs primordial 6 / eldritch 4. Tsunami and Raven supply that; Harpy sits
  // between them in the path and contributes only ascendant, so it must be left alone.
  // Ticking "everything earlier in the path" would be the easy implementation and the
  // wrong one.
  plan([['Cold Damage']], 2);
  const amatok = amatokId();
  ui.state.done = new Set();

  ui.toggleSteps(ui.plannedStars(amatok).map(s => `${amatok}:${s}`));

  // Assert the PROPERTY, not the cast list. Which constellation supplies the eldritch
  // is a scoring decision -- it was Raven, and became Bat when power weighting changed
  // to tiers; both grant 5 eldritch and either is correct. What must hold is that
  // everything dragged in contributes to what Amatok actually needs.
  const need = ui.db.constellations[amatok].required ?? {};
  const wanted = Object.keys(need).filter(a => need[a] > 0);
  assert.ok(wanted.length >= 2, 'fixture should need more than one affinity');

  const pulled = [...ui.completedSet()].filter(id => id !== amatok);
  assert.ok(pulled.length > 0, 'nothing was pulled in at all');
  for (const id of pulled) {
    const grants = ui.db.constellations[id].granted ?? {};
    assert.ok(wanted.some(a => (grants[a] ?? 0) > 0),
      `${ui.db.constellations[id].name} was pulled in but grants none of `
      + `${wanted.join('/')} -- it is filler`);
  }
  // And every affinity it needed is actually covered by what came along.
  for (const a of wanted) {
    const total = pulled.reduce(
      (n, id) => n + (ui.db.constellations[id].granted?.[a] ?? 0), 0);
    assert.ok(total >= need[a], `only ${total} ${a} pulled in, needed ${need[a]}`);
  }
  assert.deepEqual(unreachable(), []);
  assert.deepEqual(illegal(), []);
});

test('clearing a constellation clears whatever depended on its affinity', () => {
  plan([['Cold Damage']], 2);
  const amatok = amatokId();
  ui.state.done = new Set();
  ui.toggleSteps(ui.plannedStars(amatok).map(s => `${amatok}:${s}`));

  // Tsunami supplies the primordial Amatok stands on. Take it away.
  const tsunami = [...ui.completedSet()]
    .find(id => ui.db.constellations[id].name.startsWith('Tsunami'));
  ui.toggleSteps(ui.plannedStars(tsunami).map(s => `${tsunami}:${s}`));

  assert.deepEqual(starsOf(amatok), [],
    'Amatok survived losing the affinity it was standing on');
  assert.deepEqual(unreachable(), []);
});

test('no sequence of clicks can produce an unreachable constellation', () => {
  plan([['Cold Damage'], ['Armor']], 2);
  ui.state.done = new Set();
  const all = planIds().flatMap(id => ui.plannedStars(id).map(s => `${id}:${s}`));

  let seed = 31;
  for (let i = 0; i < 400; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    // Mix single stars and whole constellations, the two ways a user can act.
    if (seed % 3 === 0) {
      const cid = planIds()[(seed >>> 8) % planIds().length];
      ui.toggleSteps(ui.plannedStars(cid).map(s => `${cid}:${s}`));
    } else {
      ui.toggleStar(all[seed % all.length]);
    }
    const u = unreachable();
    assert.deepEqual(u, [], `click ${i} left an unreachable constellation: ${u[0]}`);
    const bad = illegal();
    assert.deepEqual(bad, [], `click ${i} left a broken star tree: ${bad[0]}`);
  }
  assert.ok(ui.state.done.size > 0, '400 clicks and nothing is ticked');
});

// --- tree gutter --------------------------------------------------------------

test('the tree gutter matches the parent data', () => {
  plan([['Cold Damage']], 2);
  const amatok = amatokId();
  const c = ui.db.constellations[amatok];
  const idxs = ui.starIdxs(c, 7, ui.state.plan.solution.find(e => e.id === amatok)?.stars);
  const g = ui.treeGutter(c, idxs);

  // parents [-,1,2,2,4,2,6]: 2 is 1's only child; 3, 4, 6 hang off 2 with 6 last;
  // 5 hangs off 4; 7 off 6. The rule under all of it: a vertical bar means that
  // ancestor's branch continues below this row.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => g.get(n)),
    ['', '└─', ' ├─', ' ├─', ' │└─', ' └─', '  └─']);
});

test('gutter depth never exceeds the tree depth, for every constellation', () => {
  // Drawn for all 109, not just the ones a fixture happens to include.
  for (const c of Object.values(ui.db.constellations)) {
    const idxs = Array.from({ length: c.starCount }, (_, i) => i);
    const g = ui.treeGutter(c, idxs);
    for (let n = 1; n <= c.starCount; n++) {
      let depth = 0;
      for (let a = c.starParents?.[n - 1]; a; a = c.starParents?.[a - 1]) depth++;
      const drawn = g.get(n) ?? '';
      // One character per level, plus the two-character connector on non-roots.
      assert.equal(drawn.length, depth === 0 ? 0 : depth + 1,
        `${c.name} star ${n} at depth ${depth} drew "${drawn}"`);
    }
  }
});

test('the next star is always one you could actually buy', () => {
  // Falls out of ordering -- the first unbought star in ascending order has every
  // lower index bought, and a parent always has a lower index than its child. Pinned
  // because it is the reason clicking the marker never needs to cascade.
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = false;

  for (let i = 0; i < 12; i++) {
    ui.render();
    const m = /<div class="star[^"]*\bsnext\b[^"]*"[^>]*?data-star="([^"]+)"/.exec(app.innerHTML);
    if (!m) break;
    const key = m[1];
    const cid = key.slice(0, key.lastIndexOf(':'));
    const s = +key.slice(key.lastIndexOf(':') + 1);
    const p = ui.db.constellations[cid].starParents?.[s - 1];
    assert.ok(!p || ui.state.done.has(`${cid}:${p}`),
      `marker pointed at ${cid} star ${s}, whose parent ${p} is not bought`);
    ui.toggleStar(key);
  }
});

test('refunds are not tickable', () => {
  // A refund is the scheduler taking a Crossroads point back; there is nothing to buy.
  plan([['Cold Damage']], 2);
  ui.state.plain = true; ui.render();
  const h = app.innerHTML;
  const refunds = (h.match(/<div class="prow[^"]*\bpref\b/g) ?? []).length;
  assert.ok(refunds > 0, 'this fixture should contain refunds');
  const ghosts = (h.match(/class="pck ghost"/g) ?? []).length;
  assert.equal(ghosts, refunds + 1, 'every refund row plus the header should have an inert cell');
});

// --- undo ---------------------------------------------------------------------
// One click can complete half a build now, so a misclick has to be recoverable.

test('undo restores the progress from before the last click', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = true; ui.render();

  const keys = [...app.innerHTML.matchAll(/data-keys="([^"]+)"/g)].map(m => m[1]);
  click({ step: 'a', keys: keys[1] });
  const after = [...ui.state.done].sort();
  assert.ok(after.length > 0, 'the click did nothing to undo');

  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), [], 'undo did not restore the empty state');

  // And it is a stack, not a single slot.
  click({ step: 'a', keys: keys[1] });
  click({ step: 'b', keys: keys[3] });
  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), after, 'undo went back too far');
});

test('undo recovers from an accidental late pick', () => {
  // The reason it exists: ticking a late constellation completes everything its
  // affinity depends on, which is a lot of state to lose to one misclick.
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  const amatok = amatokId();

  click({ star: `${amatok}:1` });
  const intended = [...ui.state.done].sort();

  const yugol = planIds().find(id => ui.db.constellations[id].name.startsWith('Yugol'));
  click({ step: 'x', keys: ui.plannedStars(yugol).map(s => `${yugol}:${s}`).join(',') });
  assert.ok(ui.state.done.size > intended.length + 3, 'the misclick should have cascaded');

  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), intended, 'undo did not fully reverse the cascade');
});

test('undo is bounded and stops cleanly when exhausted', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = false; ui.render();
  const stars = [...app.innerHTML.matchAll(/data-star="([^"]+)"/g)].map(m => m[1]);

  for (let i = 0; i < 200; i++) click({ star: stars[i % stars.length] });
  for (let i = 0; i < 400; i++) click({ undo: '1' });   // more undos than history

  assert.ok(true, 'undoing past the end did not throw');
  assert.equal(ui.history.length, 0, 'the stack should be drained once there is nothing left to undo');
  const stateBefore = [...ui.state.done].sort();
  click({ undo: '1' });   // one more, for good measure -- must be a true no-op
  assert.deepEqual([...ui.state.done].sort(), stateBefore, 'undoing past empty changed the state');
});

test('Ctrl+Z and Cmd+Z undo', () => {
  plan([['Cold Damage']], 2);
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    ui.state.done = new Set();
    ui.state.plain = false; ui.render();
    const star = /data-star="([^"]+)"/.exec(app.innerHTML)[1];
    click({ star });
    assert.ok(ui.state.done.size > 0);
    fire('keydown', { key: 'z', ...mod });
    assert.equal(ui.state.done.size, 0, `${Object.keys(mod)[0]}+Z did not undo`);
  }
  // Shift+Ctrl+Z is redo in most apps; it must not undo here.
  ui.state.plain = false; ui.render();
  const star = /data-star="([^"]+)"/.exec(app.innerHTML)[1];
  click({ star });
  const size = ui.state.done.size;
  fire('keydown', { key: 'z', ctrlKey: true, shiftKey: true });
  assert.equal(ui.state.done.size, size, 'Shift+Ctrl+Z should not undo');
});

test('a rebuild clears the undo trail but keeps your ticks', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = false; ui.render();
  click({ star: /data-star="([^"]+)"/.exec(app.innerHTML)[1] });
  const ticks = [...ui.state.done].sort();

  plan([['Cold Damage']], 1, { keep: true });   // same tags, different mode -> new path
  assert.deepEqual([...ui.state.done].sort(), ticks,
    'a rebuild lost progress; ticks are keyed constellation:star and should survive');
  assert.equal(ui.history.length, 0, 'a rebuild should clear the undo trail');
  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), ticks,
    'undo should not offer to restore a build that is no longer on screen');
});

// --- panel sizing ---------------------------------------------------------------

test('both long panels are capped to the viewport', () => {
  // Unfolding a keyword category used to grow the page and carry the chosen tags off
  // screen; the devotions list grows with the build. Measured, not a fixed vh.
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();

  for (const sel of ['.scroll', '.dscroll']) {
    const box = app.querySelector(sel);
    assert.ok(box, `${sel} is not in the markup`);
    // top 300, viewport 900, 16px breathing room.
    assert.equal(box.style.maxHeight, '584px', `${sel} was not sized to the viewport`);
  }

  window.innerHeight = 600;
  fire('resize');
  assert.equal(app.querySelector('.dscroll').style.maxHeight, '284px',
    'did not re-fit on resize');

  window.innerHeight = 400;   // 400 - 300 - 16 = 84, below the floor
  fire('resize');
  assert.equal(app.querySelector('.dscroll').style.maxHeight, '200px',
    'floor should keep a usable panel on a short window');
  window.innerHeight = 900;
});

test('scroll position survives a re-render', () => {
  // innerHTML replaces the scroller, so scrollTop resets to 0 -- ticking a star
  // halfway down the path would jump the list back to the top on every click.
  plan([['Cold Damage']], 2);
  ui.state.plain = false; ui.render();

  app.querySelector('.dscroll').scrollTop = 420;
  ui.render();
  assert.equal(app.querySelector('.dscroll').scrollTop, 420,
    'the devotions list jumped back to the top');
});

test('an unbought tick box is empty, not a dim check', () => {
  // It used to render the check glyph unconditionally and rely on colour alone to say
  // whether it was bought. On screen that read as "everything is ticked" while the
  // summary underneath said "0 of 15 bought" -- the two halves of the same panel
  // contradicting each other. Count the glyphs INSIDE the list only; the picker has its
  // own ti-check on selected chips and ti-minus on the target pills.
  plan([['Cold Damage'], ['Armor']], 1);
  ui.state.done = new Set();
  ui.state.plain = true; ui.render();

  const listOnly = () => {
    const h = app.innerHTML;
    return h.slice(h.indexOf('class="plain"'), h.indexOf('class="total"'));
  };
  const count = (s, re) => (s.match(re) ?? []).length;

  let list = listOnly();
  // Real tick boxes only. Refund rows render `<span class="pck ghost">` with no glyph
  // inside, so counting every .pck would never match the glyph count.
  const boxes = count(list, /<button class="pck/g);
  assert.ok(boxes > 0, 'no tick boxes rendered at all');
  assert.equal(count(list, /ti-check/g), 0, 'a check is showing with nothing bought');
  assert.equal(count(list, /ti-minus/g), 0, 'a dash is showing with nothing bought');
  assert.equal(count(list, /<i class=""><\/i>/g), boxes, 'boxes should all be empty');

  // And the glyph count has to agree with the summary once something IS bought.
  const keys = [...app.innerHTML.matchAll(/data-keys="([^"]+)"/g)].map(m => m[1]);
  ui.toggleSteps(keys[1].split(','));
  ui.render();
  list = listOnly();
  const stated = /(\d+) of \d+ bought/.exec(app.innerHTML);
  assert.ok(stated, 'no bought summary');
  assert.equal(count(list, /ti-check/g), Number(stated[1]),
    `list shows ${count(list, /ti-check/g)} checks but the summary says ${stated[1]} bought`);
});




// --- celestial powers in the UI ---------------------------------------------------

const powerIdx = label => {
  const i = ui.chips.findIndex(c => c.kind === 'power' && c.label === label);
  assert.ok(i >= 0, `no power chip "${label}"`);
  return i;
};

function planWith(entries, mode = 1) {
  ui.state.sel = ui.state.sel.map(() => null);
  entries.forEach(([i, w], slot) => { ui.state.sel[slot] = i; ui.state.weights[slot] = w; });
  ui.state.mode = mode;
  ui.state.order = null;
  ui.state.done = new Set();
  ui.build();
  return ui.state.plan;
}

test('clicking a star sets that weight directly', () => {
  // Replaced a cycle-upward control. Cycling needed two clicks to go from 3 to 2 and
  // wrapped at the top, so the move this asserts -- 3 straight down to 1 in one click --
  // was the one it could not do.
  const idx = ui.chips.findIndex(c => c.label === 'Cold Damage' && c.ns === 'character');
  ui.state.sel = ui.state.sel.map(() => null);
  ui.state.sel[0] = idx;
  ui.state.weights[0] = 3;
  ui.state.mode = 1; ui.build(); ui.render();

  assert.match(app.innerHTML, /class="dots pick w3"/, 'should start at three stars');

  click({ setw: '0:1' });
  assert.equal(ui.state.weights[0], 1, 'clicking the first star should set weight 1');
  ui.render();
  assert.match(app.innerHTML, /class="dots pick w1"/, 'colour class should follow the weight');

  click({ setw: '0:3' });
  assert.equal(ui.state.weights[0], 3, 'clicking the third star should set weight 3');
  ui.render();
  // The bug that started this: at weight 3 every star is filled, and if the filled
  // glyph renders as nothing the tag shows no stars at all.
  const pill = starControl('w3');
  assert.ok(pill, 'no star control at weight 3');
  assert.equal((pill.match(/★/g) ?? []).length, 3,
    'a three-star tag must show three visible stars');

  // Out of range and empty slots must not corrupt state.
  click({ setw: '0:9' });
  assert.equal(ui.state.weights[0], 3, 'an out-of-range level should clamp, not apply');
  const before = [...ui.state.weights];
  click({ setw: '4:2' });
  assert.deepEqual([...ui.state.weights], before, 'an empty slot should be ignored');
});

test('every star in the picker is its own click target', () => {
  // One button per star, not one for the row -- otherwise "click the star you mean"
  // silently degrades back to a single toggle.
  const idx = ui.chips.findIndex(c => c.label === 'Armor' && c.ns === 'character');
  ui.state.sel = ui.state.sel.map(() => null);
  ui.state.sel[0] = idx;
  ui.state.weights[0] = 2;
  ui.state.mode = 1; ui.build(); ui.render();

  const pill = starControl('w2');
  assert.ok(pill, 'no interactive star control rendered');
  const targets = (pill.match(/data-setw="0:\d"/g) ?? []);
  assert.equal(targets.length, 3, `expected 3 star targets, got ${targets.length}`);
  assert.deepEqual(targets, ['data-setw="0:1"', 'data-setw="0:2"', 'data-setw="0:3"']);
  // Assert the GLYPH, not a class name. The first version of this checked for
  // `ti-star-filled`, which is absent from the Tabler webfont build the page loads --
  // so the markup was "right" and every filled star rendered as nothing. A test that
  // only reads class names cannot see that; counting the actual characters can.
  assert.equal((pill.match(/★/g) ?? []).length, 2, 'two filled stars at weight 2');
  assert.equal((pill.match(/☆/g) ?? []).length, 1, 'one empty star at weight 2');
  assert.doesNotMatch(pill, /ti-star/,
    'back on the icon font, whose filled star does not exist in this build');
  // The colour rules target `span.on`; putting `on` anywhere else silently kills them.
  assert.equal((pill.match(/<span class="on">/g) ?? []).length, 2,
    'the on class must sit on the span the CSS targets');
});

test('a power pill shows a fixed target, not a weight control', () => {
  // Measured: a power tag's weight produces a byte-identical build at 1 dot and 3.
  // A control that does nothing is worse than no control.
  planWith([[powerIdx("Targo's Hammer"), 1]]);
  ui.render();
  const h = app.innerHTML;
  assert.match(h, /class="tgt"/, 'no target marker on the power pill');
  const slot = /<div class="slot full pow">[\s\S]*?<\/div>/.exec(h);
  assert.ok(slot, 'the power pill did not get its own styling');
  assert.doesNotMatch(slot[0], /data-setw/,
    'a power pill still offers a weight control');
});

test('a power tag does not silence the under-served warning', () => {
  // A power row has no star count, so summing `stars` across all rows went NaN, `|| 1`
  // turned that into 1, and every keyword's share of the stars became enormous -- the
  // amber flag could never fire again once a power was picked. Silent, and it made the
  // whole Coverage panel less honest.
  // Fixture found by sweeping every keyword pair for one that actually goes amber --
  // asserting "same before and after" is worthless if neither case was amber to begin
  // with, which is how this test first passed against the bug.
  const heavy = ui.chips.findIndex(c => c.label === 'Offensive Ability' && c.ns === 'character');
  const light = ui.chips.findIndex(c => c.label === 'Freeze Resistance' && c.ns === 'character');
  assert.ok(heavy >= 0 && light >= 0);

  planWith([[heavy, 3], [light, 1]]);
  ui.render();
  assert.match(app.innerHTML, /class="covrow under"/,
    'fixture no longer produces an under-served row; find another pair');

  planWith([[heavy, 3], [light, 1], [powerIdx("Targo's Hammer"), 2]]);
  ui.render();
  assert.match(app.innerHTML, /class="covrow under"/,
    'adding a power tag silenced the under-served warning on keyword rows');
});

test('a starved tag says it is obtainable, not that it does not exist', () => {
  // Surfacing an awkward tag combination is part of what the tool is for -- someone can
  // chase a tag that quietly starves the rest of the build. But "none" read as "the tree
  // doesn't have this", which was never true: measured over 30 five-tag builds, every
  // tag that landed on zero had a ceiling between 3 and 18. So the row shows 0/10 and a
  // note says which tag outbid it.
  const names = ['Cold Damage', 'Pierce Damage', 'Frostburn Damage', 'Frostburn Duration',
                 'Casting Speed'];
  planWith(names.map(n => [ui.chips.findIndex(
    c => c.label === n && c.ns === 'character' && c.kind !== 'power'), 2]), 1);
  ui.render();
  const h = app.innerHTML;

  // The 1 Aug layout dropped the separate .crowd note below the panel -- the
  // explanation now lives in the row's own tooltip, and a warning icon flags the row
  // without needing to be read.
  const zero = /<div class="covrow[^"]*\bzero\b[^"]*" title="([^"]*)"[^>]*>([\s\S]*?)<\/div>/.exec(h);
  assert.ok(zero, 'expected a starved tag in this fixture');
  const [, title, body] = zero;
  assert.doesNotMatch(body, /none/, 'a starved tag still says "none"');
  assert.match(body, /0\/\d+/, 'a starved row should show 0 of its ceiling');
  assert.match(body, /ti-alert-triangle/, 'a starved row should carry the warning icon');
  assert.match(title, /is obtainable/, 'the tooltip should say it IS obtainable');
  assert.match(title, /your other tags used the points/,
    'the tooltip should name the cause');
});

test('coverage carries no warning icon when the tags work together', () => {
  // It has to be rare enough to mean something. A coherent pair should show nothing.
  const pair = ['Cold Damage', 'Frostburn Damage'].map(n => [ui.chips.findIndex(
    c => c.label === n && c.ns === 'character' && c.kind !== 'power'), 2]);
  planWith(pair, 1);
  ui.render();
  assert.doesNotMatch(app.innerHTML, /ti-alert-triangle/,
    'warned about a starved tag on a build where every tag was served');
  assert.doesNotMatch(app.innerHTML, /class="covrow[^"]*\bzero\b/,
    'fixture should have no starved tag');
});

test('Coverage gives a power a tick, not a bar', () => {
  planWith([[powerIdx('Fetid Pool'), 2], [ui.chips.findIndex(
    c => c.label === 'Armor' && c.ns === 'character'), 2]]);
  ui.render();
  const rows = [...app.innerHTML.matchAll(/<div class="covrow([^"]*)"[^>]*>([\s\S]*?)<\/div>/g)];
  const pow = rows.find(r => r[2].includes('Fetid Pool'));
  const kw = rows.find(r => r[2].includes('Armor'));
  assert.ok(pow && kw, 'expected both a power row and a keyword row');
  assert.match(pow[1], /pow/, 'the power row is not marked as one');
  assert.match(pow[2], /ti-check/, 'a secured power should show a tick');
  assert.match(pow[2], /Affliction/, 'the power row should name its constellation');
  assert.doesNotMatch(pow[2], /style="width:/, 'a power should not get a proportional bar');
  assert.match(kw[2], /style="width:/, 'a keyword row should still get its bar');
});

test('a targeted power is secured in every scoring mode, including passives only', () => {
  // The modes and power targeting are orthogonal on purpose: "Passives only" means
  // don't chase procs you didn't ask for, and naming one is asking.
  const id = powerIdx("Targo's Hammer");
  const chip = ui.chips[id];
  for (const mode of [0, 1, 2]) {
    planWith([[id, 2]], mode);
    const e = ui.state.plan.solution.find(x => x.id === chip.cons);
    assert.ok(e && (e.stars ?? []).includes(chip.star),
      `Targo's Hammer was not secured in mode ${mode}`);
  }
});

test('the plain view survives an empty and a five-tag state', () => {
  ui.state.sel = ui.state.sel.map(() => null);
  ui.state.plan = null;
  ui.state.plain = true;
  ui.render();
  assert.ok(app.innerHTML.length > 0, 'empty state rendered nothing');

  // Summon Limit left the picker as proc-only (`petLimit` is the summon's own cap, set
  // by the proc's rank, not a player stat).
  plan([['Total Damage', 'pet'], ['Crit Damage', 'pet'], ['Health'], ['Armor'],
        ['Movement Speed']], 0);
  ui.render();
  assert.ok(countRows(app.innerHTML) > 0, 'five-tag build rendered no rows');
});

// --- affinity orbs and the running ledger ------------------------------------

test('the ledger sits between the last finished card and the current one', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.state.plain = false; ui.render();
  // Nothing finished: no ledger, because it would read as all zeros.
  assert.doesNotMatch(app.innerHTML, /class="ledger"/,
    'a ledger appeared before anything was bought');

  // Buy out the first constellation.
  const first = /data-keys="([^"]+)"/.exec(app.innerHTML)?.[1]?.split(',') ?? [];
  assert.ok(first.length, 'no star keys on the first card');
  first.forEach(k => ui.state.done.add(k));
  ui.render();

  const h = app.innerHTML;
  assert.match(h, /class="ledger"/, 'no ledger once a constellation was finished');
  // Position: after the done card, before the current one.
  const iLedger = h.indexOf('class="ledger"');
  const iDone = h.indexOf('class="card done');
  const iCurrent = h.indexOf('class="card current');
  assert.ok(iDone >= 0 && iCurrent >= 0, 'expected both a done and a current card');
  assert.ok(iDone < iLedger && iLedger < iCurrent,
    'the ledger is not in the gap between what is finished and what is next');
});

test('the ledger reports the scheduler\'s own points and affinity', () => {
  // Recounting in the UI would be a second chance to get Crossroads refunds wrong,
  // so the ledger must echo the path entry rather than derive anything.
  const p = plan([['Cold Damage'], ['Health']], 2);
  ui.state.plain = false; ui.state.done = new Set();
  ui.render();
  const keys = [...app.innerHTML.matchAll(/data-keys="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 2, 'need a few cards to finish');
  keys.slice(0, 2).forEach(s => s.split(',').forEach(k => ui.state.done.add(k)));
  ui.render();

  const ledger = /<div class="ledger">[\s\S]*?<\/div>/.exec(app.innerHTML)?.[0];
  assert.ok(ledger, 'no ledger after finishing two constellations');

  // The card before the first unfinished one is the authority.
  //
  // Match `card` followed by a space or a quote: the grid WRAPPER is `<div class="cards">`
  // and a looser split counts it as a card, which slides every index by one and had this
  // test comparing the ledger against the wrong path entry.
  const path = p.schedule.path;
  const classes = [...app.innerHTML.matchAll(/<div class="card([ "][^"]*)/g)].map(m => m[1]);
  assert.equal(classes.length, path.length, 'cards and path steps are out of step');
  const idx = classes.findIndex(c => c.includes('current'));
  assert.ok(idx > 0, 'no current card, or it is first');
  const prev = path[idx - 1];

  assert.match(ledger, new RegExp(`class="orb pts"[^>]*>${prev.runningPoints}<`),
    `ledger points disagree with the schedule (expected ${prev.runningPoints})`);
  // All five, always, zeros included -- a row that grows as you complete constellations
  // moves the affinity you are watching to a different place on every step.
  for (const [a, v] of Object.entries(prev.heldAfter ?? {})) {
    assert.match(ledger, new RegExp(`class="orb af-${a}( zero)?"[^>]*>${v}<`),
      `ledger disagrees with the schedule on ${a} (expected ${v})`);
  }
});


// --- the lock ----------------------------------------------------------------
// The lock's promise is that while it is on, one click can never do more than one
// star. Everything below is arithmetic or state, per the convention: how it LOOKS
// locked is something to check in the browser.

/** Fresh fixture, unlocked, nothing ticked, dialog cleared. */
function lockFixture(labels = [['Cold Damage'], ['Health']], mode = 1) {
  ui.state.locked = false;
  ui.state.lockWarnSeen = false;
  ui.state.dialog = null;
  const p = plan(labels, mode);
  ui.state.done = new Set();
  return p;
}

/** Tick the first n stars of the path directly, as if walked from the top. */
function tickPrefix(n) {
  const keys = ui.pathStarKeys();
  ui.state.done = new Set(keys.slice(0, n));
  return keys;
}

test('the frontier is the first unbought star and the last bought one', () => {
  lockFixture();
  const keys = tickPrefix(6);

  const { next, prev } = ui.frontier();
  assert.equal(prev, keys[5], 'prev should be the last star bought');
  assert.equal(next, keys[6], 'next should be the first star not bought');
});

test('the frontier survives a hole in your progress', () => {
  // Holes are ordinary: ticking while UNLOCKED is unconstrained and people tick
  // ahead, which is the whole reason the rush-offer flow existed. next has to point
  // into the gap and prev at the far end of the run, or locking after a session of
  // free ticking would strand you.
  lockFixture();
  const keys = tickPrefix(6);
  ui.state.done.delete(keys[2]);

  const { next, prev } = ui.frontier();
  assert.equal(next, keys[2], 'next should point into the gap, not past it');
  assert.equal(prev, keys[5], 'prev should still be the furthest star bought');
});

test('un-ticking at the frontier removes exactly one star', () => {
  // The point of the whole design. toggleStar() clears the subtree on the way out and
  // repairAffinity() then drops anything standing on affinity that just left, so an
  // un-tick low in the path is destructive. At the frontier both are provably no-ops.
  lockFixture();
  const keys = tickPrefix(14);
  const { prev } = ui.frontier();

  ui.state.locked = true;
  const before = ui.state.done.size;
  click({ star: prev });

  assert.equal(ui.state.done.size, before - 1,
    'un-ticking the last bought star took something else with it');
  assert.ok(!ui.state.done.has(prev), 'the star clicked is still bought');
});

test('the danger is real in this fixture, and the frontier is exempt from it', () => {
  // Without this, the test above passes just as well against a fixture where nothing
  // could have cascaded anyway -- which is how a safety property gets a green tick
  // while protecting nothing. So: sweep every bought star, un-tick it UNLOCKED, and
  // count how many take others with them. Several must, and prev must not be one.
  lockFixture();
  const keys = tickPrefix(14);
  const full = new Set(keys.slice(0, 14));
  const { prev } = ui.frontier();

  const cascades = [];
  for (const k of full) {
    ui.state.done = new Set(full);
    click({ star: k });
    if (ui.state.done.size < full.size - 1) cascades.push(k);
  }
  ui.state.done = new Set(full);

  assert.ok(cascades.length > 0,
    'no star in this fixture cascades, so it cannot demonstrate anything about the lock');
  assert.ok(!cascades.includes(prev),
    'the last bought star cascaded, which is the thing the frontier rule assumes cannot happen');
});

test('ticking at the frontier adds exactly one star', () => {
  lockFixture();
  tickPrefix(6);
  const { next } = ui.frontier();

  ui.state.locked = true;
  const before = ui.state.done.size;
  click({ star: next });

  assert.equal(ui.state.done.size, before + 1, 'ticking the next star did more than one thing');
  assert.ok(ui.state.done.has(next), 'the next star was not bought');
});

test('locked, a star still ticks when its card is a data-step ancestor', () => {
  // The star rows are nested INSIDE the card in Detail, and the card carries
  // data-step -- so a real click on a star matches BOTH selectors through closest().
  // The first version of the lock swept data-step generically, before the star branch
  // got a look, and silently froze the one thing the lock is supposed to allow.
  //
  // Every other test here fires a dataset carrying one key at a time, which no real
  // element does. Passing both is what models the nesting.
  lockFixture();
  tickPrefix(6);
  const { next } = ui.frontier();
  ui.state.locked = true;
  const before = ui.state.done.size;

  click({ star: next, step: 'whatever', keys: 'a,b,c' });

  assert.ok(ui.state.done.has(next), 'a star inside a card could not be ticked while locked');
  assert.equal(ui.state.done.size, before + 1, 'the card ticked too, not just the star');
});

test('locked, a whole-constellation tick is still refused', () => {
  // The other half of the same precedence: the card's own checkbox, with no star
  // under the pointer, must stay frozen. Fixing the bug above by dropping the block
  // altogether would pass the test above and fail this one.
  lockFixture();
  tickPrefix(6);
  ui.state.locked = true;
  ui.state.lockWarnSeen = true;
  const before = [...ui.state.done].sort();

  click({ step: 'whatever', keys: ui.pathStarKeys().slice(10, 15).join(',') });

  assert.deepEqual([...ui.state.done].sort(), before,
    'a whole constellation was ticked while locked');
});

test('locked, a star off the frontier does nothing at all', () => {
  lockFixture();
  const keys = tickPrefix(10);
  ui.state.locked = true;
  ui.state.lockWarnSeen = true;      // hushed: the click should be a pure no-op
  const before = [...ui.state.done].sort();

  click({ star: keys[0] });          // bought, but not prev
  click({ star: keys[3] });          // bought, but not prev
  click({ star: keys[20] });         // unbought, but not next

  assert.deepEqual([...ui.state.done].sort(), before, 'an off-frontier click changed progress');
  assert.equal(ui.state.dialog, null, 'hushed, but the dialog came up anyway');
});

test('an off-frontier click explains itself until you say stop', () => {
  lockFixture();
  const keys = tickPrefix(10);
  ui.state.locked = true;

  click({ star: keys[0] });
  assert.equal(ui.state.dialog, 'frontier', 'no explanation offered for a dead click');

  click({ dialog: 'hush' });
  assert.equal(ui.state.dialog, null, 'the dialog did not close');
  assert.equal(ui.state.lockWarnSeen, true, 'the preference did not stick');

  click({ star: keys[0] });
  assert.equal(ui.state.dialog, null, 'the dialog came back after being dismissed for good');
});

test('locked, the build controls are inert even if a click reaches them', () => {
  // The markup disables these too, so a real browser never fires the click. This is
  // the second line: a disabled attribute that gets dropped from one control during a
  // refactor should not silently re-open the build.
  lockFixture();
  tickPrefix(4);
  ui.state.locked = true;
  ui.state.lockWarnSeen = true;

  const tags = ui.state.sel.join(',');
  const weights = ui.state.weights.join(',');
  const done = [...ui.state.done].sort();
  const mode = ui.state.mode;

  click({ setw: '0:3' });
  click({ rm: '0' });
  click({ score: '2' });
  click({ resetprogress: '1' });
  click({ reset: '1' });
  click({ add: String(chipIdx('Fire Damage')), button: 1 });
  click({ step: 'x', keys: ui.pathStarKeys().slice(0, 3).join(',') });

  assert.equal(ui.state.sel.join(','), tags, 'a tag changed while locked');
  assert.equal(ui.state.weights.join(','), weights, 'a weight changed while locked');
  assert.equal(ui.state.mode, mode, 'the scoring mode changed while locked');
  assert.deepEqual([...ui.state.done].sort(), done, 'progress changed while locked');
});

test('undo is frozen by the lock', () => {
  // Undo restores a whole snapshot of state.done, so one keystroke can reach far past
  // the frontier -- exactly what the lock is for.
  lockFixture();
  tickPrefix(4);
  const { next } = ui.frontier();
  click({ star: next });             // unlocked: pushes a snapshot

  ui.state.locked = true;
  ui.state.lockWarnSeen = true;
  const done = [...ui.state.done].sort();

  fire('keydown', { ctrlKey: true, key: 'z' });
  click({ undo: '1' });

  assert.deepEqual([...ui.state.done].sort(), done, 'undo reached past the lock');
});

test('unlocking asks first', () => {
  lockFixture();
  ui.state.locked = true;

  click({ lock: '1' });
  assert.equal(ui.state.locked, true, 'one click took the lock off without asking');
  assert.equal(ui.state.dialog, 'unlock', 'no confirmation offered');

  click({ dialog: 'cancel' });
  assert.equal(ui.state.locked, true, 'cancelling the dialog unlocked anyway');
  assert.equal(ui.state.dialog, null, 'the dialog stayed up');

  click({ lock: '1' });
  click({ dialog: 'unlock' });
  assert.equal(ui.state.locked, false, 'confirming did not unlock');
});

test('locking is immediate -- only the way out is guarded', () => {
  lockFixture();
  click({ lock: '1' });
  assert.equal(ui.state.locked, true, 'putting the guard up should not need confirming');
  assert.equal(ui.state.dialog, null, 'locking raised a dialog');
});

test('the lock and its dismissal survive a reload', () => {
  // Reloading mid-run must not quietly hand back the controls the lock was put up to
  // freeze -- and being asked to re-dismiss the same dialog every session would make
  // "don't show this again" a lie.
  const store = new Map();
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  try {
    lockFixture();
    tickPrefix(5);
    ui.state.locked = true;
    ui.state.lockWarnSeen = true;
    ui.save();

    ui.state.locked = false;
    ui.state.lockWarnSeen = false;
    ui.load();

    assert.equal(ui.state.locked, true, 'the lock came off over a reload');
    assert.equal(ui.state.lockWarnSeen, true, '"don\'t show this again" did not survive');
  } finally {
    globalThis.localStorage = real;
    ui.state.locked = false;
    ui.state.lockWarnSeen = false;
  }
});


// --- dragging a constellation into your own order ----------------------------
// A drag is a REQUEST. What comes back is whatever the scheduler can legally make of
// it: dropping something where the game will not allow it lands it as early as the
// game does allow, with its enablers pulled forward. Where even that will not fit in
// 55 points, the drag is undone and said so -- never silently ignored.

const orderOf = (plan = ui.state.plan) => plan.schedule.path
  .filter(p => p.kind !== 'refund').map(p => p.id);

/** Fresh plan with no manual order and nothing ticked. */
function orderFixture(labels = [['Cold Damage'], ['Health']], mode = 1) {
  ui.state.locked = false;
  ui.state.order = null;
  ui.state.orderNote = null;
  const p = plan(labels, mode);
  ui.state.done = new Set();
  return p;
}

/**
 * Back to the solver's order without re-solving.
 *
 * Tests that compare across a rebuild are unreliable: solveBest() runs local search
 * against a time budget, so the same tags can return a slightly different set.
 * Anything measuring one drag against another has to hold the solution fixed.
 */
function resetOrder() {
  ui.state.order = null;
  ui.state.orderPrev = null;
  ui.state.orderNote = null;
  ui.reorderNow();
}

/** Drag through the page's own handlers, and report whether the path actually moved. */
function drag(from, to) {
  const before = orderOf();
  dragRow(from, to);
  return orderOf().join() !== before.join();
}

/** Every constellation's affinity requirement met by those COMPLETED before it. */
function assertLegal(schedule, msg = '') {
  const held = {};
  for (const step of schedule.path) {
    const c = ui.db.constellations[step.id];
    for (const [a, n] of Object.entries(c.required ?? {})) {
      assert.ok((held[a] ?? 0) >= n,
        `${msg}${c.name} scheduled with ${held[a] ?? 0} ${a}, needing ${n}`);
    }
    const grant = step.kind === 'refund' ? -1 : (step.points >= c.starCount ? 1 : 0);
    for (const [a, n] of Object.entries(c.granted ?? {})) held[a] = (held[a] ?? 0) + n * grant;
  }
}

test('dragging a constellation earlier moves it earlier', () => {
  orderFixture();
  const before = orderOf();
  assert.ok(before.length >= 4, 'fixture too short to reorder meaningfully');

  const from = before.length - 1;
  const moved = before[from];
  assert.ok(drag(from, 0), 'the drag was rejected outright');

  const after = orderOf();
  assert.ok(after.indexOf(moved) < from,
    `${moved} did not move earlier (was ${from}, now ${after.indexOf(moved)})`);
});

test('a drag re-schedules and never re-solves', () => {
  // Two reasons this matters. The set is the answer to your TAGS, and a drag is not a
  // change to your tags. And solveBest() runs local search against a time budget, so
  // re-solving the same tags can legitimately return a different set -- meaning a
  // drag that re-solved would change the build every so often, unreproducibly.
  const p = orderFixture();
  const solutionBefore = p.solution;
  const setBefore = [...orderOf()].sort();
  const pointsBefore = p.schedule.totalPoints;

  drag(orderOf().length - 1, 0);

  assert.equal(ui.state.plan.solution, solutionBefore,
    'the solution object was replaced, so something re-solved');
  assert.deepEqual([...orderOf()].sort(), setBefore, 'the dragged plan has a different set');
  assert.equal(ui.state.plan.schedule.totalPoints, pointsBefore,
    'reordering changed the point cost');
});

test('every legal drag produces a playable path', () => {
  // Sweep, rather than trusting one hand-picked case: drag each constellation to the
  // front in turn and check what comes back is something the game would allow.
  orderFixture([['Chaos Damage'], ['Shield Damage Blocked']], 0);
  const before = orderOf();
  let honoured = 0, refused = 0;

  for (let i = 1; i < before.length; i++) {
    orderFixture([['Chaos Damage'], ['Shield Damage Blocked']], 0);
    drag(i, 0);
    assertLegal(ui.state.plan.schedule, `dragging ${before[i]} to the front: `);
    if (orderOf().join() === before.join()) refused++;
    else honoured++;
  }

  assert.ok(honoured > 0, 'no drag in this fixture was honoured at all');
  // Not asserted to be zero: some arrangements genuinely cost more than 55 points.
  assert.ok(refused < before.length - 1, 'every single drag was refused');
});

test('an impossible position lands as early as the rules allow, not where asked', () => {
  // The "auto-resolve by cascading" answer. Something with an affinity requirement
  // cannot be first, because what grants that affinity has to come first -- so it
  // should move, but not to the front, and never be refused outright.
  orderFixture([['Chaos Damage'], ['Shield Damage Blocked']], 0);
  const before = orderOf();
  const idx = before.findIndex((id, i) =>
    i > 1 && Object.keys(ui.db.constellations[id].required ?? {}).length > 0);
  assert.ok(idx > 1, 'fixture has nothing with an affinity requirement to drag');
  const deep = before[idx];

  drag(idx, 0);
  const after = orderOf();
  assert.ok(after.indexOf(deep) < idx, 'it did not move at all');
  assert.ok(after.indexOf(deep) > 0,
    'it was placed first, which its affinity requirement should have made impossible');
  assertLegal(ui.state.plan.schedule);
});

test('the enablers come forward with what you dragged', () => {
  // Not enough that the dragged constellation ends up legal -- the things it needed
  // have to have MOVED to make that so, and nothing else should have been dragged in
  // front of it for the ride.
  orderFixture([['Chaos Damage'], ['Shield Damage Blocked']], 0);
  const before = orderOf();
  const idx = before.findIndex((id, i) =>
    i > 2 && Object.keys(ui.db.constellations[id].required ?? {}).length > 0);
  const deep = before[idx];

  assert.ok(drag(idx, 0), 'this fixture refused the drag; pick another');
  const after = orderOf();

  const aheadBefore = before.slice(0, idx);
  const aheadAfter = after.slice(0, after.indexOf(deep));
  assert.ok(aheadAfter.length < aheadBefore.length,
    'nothing was displaced; the drag achieved nothing');

  // Crossroads are exempt, and finding that out is the point of this test: the
  // scheduler is free to insert a bootstrap Crossroads that was NOT in the path
  // before, because buying one is how an affinity threshold gets crossed early. It is
  // an enabler like any other, refunded later once the constellations behind it stand
  // on their own. Everything else ahead of the dragged constellation must be
  // something that was already ahead of it -- nothing else gets a free ride forward.
  const carried = aheadAfter.filter(id => !ui.db.constellations[id].crossroads);
  assert.ok(carried.every(id => aheadBefore.includes(id)),
    'a non-Crossroads that was not ahead of it before was pulled in front of it');
});


test('clearing the order goes back to the solver\'s own path', () => {
  orderFixture();
  const solver = orderOf();

  drag(solver.length - 1, 0);
  assert.notDeepEqual(orderOf(), solver, 'the drag did nothing, so this proves nothing');

  click({ clearorder: '1' });
  assert.equal(ui.state.order, null, 'the order was not cleared');
  assert.deepEqual(orderOf(), solver, 'clearing did not restore the solver order');
  assert.equal(ui.state.plan.schedule, ui.state.plan.solverSchedule,
    'clearing rebuilt a schedule instead of restoring the one already computed');
});

test('the manual order survives a reload', () => {
  const store = new Map();
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  try {
    orderFixture();
    drag(orderOf().length - 1, 0);
    const want = [...ui.state.order];
    ui.save();

    ui.state.order = null;
    ui.load();
    assert.deepEqual(ui.state.order, want, 'the dragged order did not survive a reload');
  } finally {
    globalThis.localStorage = real;
    ui.state.order = null;
  }
});

test('changing a tag or the scoring mode drops the order', () => {
  // It is a sequence over one particular set of constellations. A different solve is a
  // different set, and constellations you never ranked would sort behind everything
  // you did -- the "points of nothing before your first wanted pick" failure the path
  // ordering exists to prevent.
  orderFixture();
  drag(orderOf().length - 1, 0);
  assert.ok(ui.state.order, 'no order to drop');

  click({ score: '2' });
  assert.equal(ui.state.order, null, 'the order survived a scoring-mode change');

  drag(orderOf().length - 1, 0);
  assert.ok(ui.state.order, 'no order to drop');

  click({ add: String(chipIdx('Fire Damage')), button: 1 });
  assert.equal(ui.state.order, null, 'the order survived a tag change');
});

test('ticking does not disturb the order', () => {
  // Progress and order are independent: following the path must not silently rewrite
  // it, which is exactly what the old rush-offer did.
  orderFixture();
  drag(orderOf().length - 1, 0);
  const want = [...ui.state.order];
  const path = orderOf();

  const keys = ui.pathStarKeys();
  click({ star: keys[0] });
  click({ star: keys[1] });

  assert.deepEqual(ui.state.order, want, 'ticking changed the manual order');
  assert.deepEqual(orderOf(), path, 'ticking re-ordered the path');
});

test('refund steps are not draggable and do not shift the indices', () => {
  // Crossroads are inserted and refunded by the scheduler, so they are not yours to
  // place. data-drag counts only the rows that are; counting every row instead would
  // drift by one per Crossroads, and a drag would land near where you aimed.
  orderFixture();
  ui.state.plain = true;
  ui.render();

  const rows = [...app.innerHTML.matchAll(/<div class="(prow[^"]*)"([^>]*)>/g)];
  const refunds = rows.filter(m => m[1].includes('pref'));
  assert.ok(refunds.length > 0, 'fixture has no Crossroads refund to test against');
  for (const m of refunds) {
    assert.ok(!m[2].includes('data-drag'), 'a refund row was given a drag index');
    assert.ok(!m[2].includes('draggable'), 'a refund row was made draggable');
  }

  const idxs = [...app.innerHTML.matchAll(/data-drag="(\d+)"/g)].map(m => +m[1]);
  assert.deepEqual(idxs, idxs.map((_, i) => i), 'drag indices are not a dense 0..n-1 run');
  assert.equal(idxs.length, orderOf().length,
    'drag indices and the refund-free path are different lengths');
  ui.state.plain = false;
});

test('locked, rows are not draggable', () => {
  orderFixture();
  ui.state.plain = true;
  ui.state.locked = true;
  ui.render();
  assert.doesNotMatch(app.innerHTML, /draggable="true"/, 'rows stayed draggable while locked');
  ui.state.locked = false;
  ui.state.plain = false;
});



// --- where a drop actually lands ---------------------------------------------
// A drop position and its result are mostly not the same thing, which is why the
// insertion bar is placed by landingsFor() rather than under the cursor.

test('landings are what dropping there really does', () => {
  // Ground the precompute against the real thing: for every position, what
  // landingsFor() promised must be exactly what a drag through the handlers produces.
  //
  // Every iteration resets the ORDER rather than rebuilding. Calling orderFixture()
  // in the loop re-solves, and solveBest() is time-budgeted -- so the promise and the
  // drop would be measured against different solutions, and this test failed on a
  // single position for exactly that reason.
  orderFixture();
  const base = orderOf();
  const from = base.length - 1;
  const promised = ui.landingsFor(from);
  assert.equal(promised.length, base.length, 'landings and the path are different lengths');

  for (let to = 0; to < base.length; to++) {
    resetOrder();
    dragRow(from, to);
    const got = orderOf().indexOf(base[from]);
    if (promised[to] == null) {
      assert.deepEqual(orderOf(), base,
        `position ${to} was promised to be impossible but the drop changed the path`);
    } else {
      assert.equal(got, promised[to],
        `position ${to}: landings said ${promised[to]}, dropping gave ${got}`);
    }
  }
});

test('several positions land in the same place, which is why the bar snaps', () => {
  // The measurement this design came from: dropping at 0 and at 1 are usually the same
  // request. If this ever stops being true the snapping is pointless complexity.
  orderFixture();
  const landings = ui.landingsFor(orderOf().length - 1);
  const real = landings.filter(l => l != null);
  assert.ok(new Set(real).size < real.length,
    'every position landed somewhere different; a cursor-following bar would be fine');
});

test('a drop that cannot be scheduled changes nothing', () => {
  // Sweep for a genuinely impossible position rather than assuming one exists.
  let found = null;
  outer:
  for (const labels of [[['Chaos Damage'], ['Shield Damage Blocked']],
                        [['Physical Damage'], ['Armor']]]) {
    orderFixture(labels, 0);
    const base = orderOf();
    for (let from = 0; from < base.length; from++) {
      const l = ui.landingsFor(from);
      const to = l.findIndex(x => x == null);
      if (to >= 0) { found = { labels, from, to, base }; break outer; }
    }
  }
  assert.ok(found, 'no impossible position in any fixture; this test proves nothing');

  // Re-measure against THIS build rather than trusting the index found above: the
  // sweep rebuilt, and a rebuild can return a different set.
  orderFixture(found.labels, 0);
  const before = orderOf();
  const again = ui.landingsFor(found.from);
  const to = again.findIndex(x => x == null);
  if (to < 0) return;   // this build has no impossible position for that row
  dragRow(found.from, to);
  assert.deepEqual(orderOf(), before, 'an impossible drop still moved the path');
  assert.equal(ui.state.order, null, 'an impossible drop stored an order');
});

test('a drop that would not move anything changes nothing', () => {
  // The nine-positions-all-land-at-7 case. Releasing there must be a no-op rather than
  // storing a manual order identical to the solver's.
  orderFixture();
  const base = orderOf();
  const from = Math.floor(base.length / 2);
  const l = ui.landingsFor(from);
  const to = l.findIndex((x, i) => x === from && i !== from);
  if (to < 0) return;    // fixture has no dead position; nothing to assert

  dragRow(from, to);
  assert.deepEqual(orderOf(), base, 'a drop that lands where it started still changed the path');
  assert.equal(ui.state.order, null, 'a no-op drop stored an order');
});

test('a constellation with nowhere to go is not draggable', () => {
  orderFixture([['Chaos Damage'], ['Shield Damage Blocked']], 0);
  const fixed = ui.immovableSet();
  if (!fixed.size) return;   // nothing stuck in this fixture; the sweep found that out

  // Every one of them really is stuck -- the sweep and landingsFor() must agree.
  const base = orderOf();
  for (const id of fixed) {
    const from = base.indexOf(id);
    const l = ui.landingsFor(from);
    assert.ok(l.every((x, to) => x == null || x === from || to === from),
      `${id} was called immovable but position ${l.findIndex((x, to) => x != null && x !== from && to !== from)} moves it`);
  }

  ui.state.immovable = fixed;
  ui.state.plain = true;
  ui.render();
  for (const id of fixed) {
    const row = new RegExp(`<div class="prow[^"]*pfixed[^"]*"([^>]*)>`).exec(app.innerHTML);
    assert.ok(row, 'no row was marked fixed');
    assert.ok(!row[1].includes('draggable'), 'a fixed row was still draggable');
  }
  ui.state.plain = false;
  ui.state.immovable = new Set();
});

test('a fixed row is still a drop target', () => {
  // It cannot be picked up, but something else must still be droppable onto it, or
  // whole regions of the list become unreachable.
  orderFixture();
  ui.state.immovable = new Set(orderOf().slice(0, 2));
  ui.state.plain = true;
  ui.render();

  const idxs = [...app.innerHTML.matchAll(/data-drag="(\d+)"/g)].map(m => +m[1]);
  assert.deepEqual(idxs, idxs.map((_, i) => i),
    'marking rows fixed punched a hole in the drag indices');

  ui.state.plain = false;
  ui.state.immovable = new Set();
});

// --- proc numbers follow the scoring mode ------------------------------------

test('a proc tooltip shows cap numbers in CP Max and rank-1 numbers otherwise', () => {
  // The bug: proc stats are per-level arrays and the display took [0] whatever the
  // mode, so "CP Max" scored powers at their cap while showing rank-1 numbers beside
  // it. 236 of 413 proc lines differ, so this was most of them.
  //
  // Driven through render() rather than by calling the unpacker, so the wiring from
  // mode to tooltip is what's under test.
  const idx = JSON.parse(fs.readFileSync(path.join(srcDir, '../ui-index.json'), 'utf8'));
  const withBoth = idx.constellations.find(c => (c.fxp ?? [])
    .some(star => (star ?? []).some(line => line.length >= 6)));
  assert.ok(withBoth, 'no constellation ships a differing max-rank proc line');
  const line = withBoth.fxp.flat().find(l => l.length >= 6);
  const [tmpl, v, , , vMax] = line;
  assert.notEqual(v, vMax, 'picked a line whose two ranks are identical');

  // Render the whole tree in each mode and read the tooltips out of the markup.
  const seen = {};
  for (const mode of [1, 2]) {
    plan([['Cold Damage'], ['Health']], mode);
    ui.state.done = new Set();
    ui.state.plain = false;
    ui.render();
    seen[mode] = app.innerHTML;
  }
  const numFor = (html, n) => html.includes(tmpl.replace('{v}', String(n)));

  // At least one of the two must appear in each -- the fixture has to actually contain
  // a power, or this asserts nothing.
  const anyProc = /data-fxhead=/.test(seen[1]);
  assert.ok(anyProc, 'this fixture rendered no proc tooltips at all');

  // Whatever line we picked, mode 2 must never render the rank-1 number where the
  // max-rank one exists, and vice versa.
  for (const [mode, html] of Object.entries(seen)) {
    const wantRank1 = mode === '1';
    if (numFor(html, wantRank1 ? vMax : v) && !numFor(html, wantRank1 ? v : vMax)) {
      assert.fail(`mode ${mode} rendered the ${wantRank1 ? 'max-rank' : 'rank-1'} number`);
    }
  }
});

test('every proc line ships a max-rank pair only when it differs', () => {
  // The packing contract. A line carrying a redundant pair costs bytes for nothing; a
  // line missing one where the ranks differ silently shows rank 1 in CP Max, which is
  // the bug this all exists to fix.
  const idx = JSON.parse(fs.readFileSync(path.join(srcDir, '../ui-index.json'), 'utf8'));
  let paired = 0, plain = 0;
  for (const c of idx.constellations) {
    for (const star of c.fxp ?? []) {
      for (const l of star ?? []) {
        assert.ok(l.length === 4 || l.length === 6, `proc line has ${l.length} entries`);
        if (l.length === 6) {
          paired++;
          assert.ok(l[4] !== l[1] || l[5] !== l[2],
            `${l[0]} carries a max-rank pair identical to its rank-1 values`);
        } else plain++;
      }
    }
  }
  assert.ok(paired > 0, 'no proc line ships max-rank values at all');
  assert.ok(plain > 0, 'every proc line ships a pair, so the "only when it differs" rule is not working');
});

test('passive lines never carry a rank pair', () => {
  // A passive has no ranks. If one ever grows a pair, something has routed proc stats
  // into the constellation total -- the mistake that put Tsunami's Skill Recharge into
  // its passives once already.
  const idx = JSON.parse(fs.readFileSync(path.join(srcDir, '../ui-index.json'), 'utf8'));
  for (const c of idx.constellations) {
    for (const star of c.fx ?? []) {
      for (const l of star ?? []) {
        assert.equal(l.length, 4, `passive line "${l[0]}" on ${c.n} carries rank values`);
      }
    }
  }
});

// --- coverage magnitude ------------------------------------------------------
// The bar counts stars; the magnitude says what those stars are worth. Kept separate
// because a bar is a proportion and 33 of 81 tags mix percent with flat lines, so
// there is no single unit to be a proportion OF.

test('coverage magnitude equals the sum over the stars actually taken', () => {
  // Derived independently here -- from the plan and the index -- rather than by
  // calling magnitudeOf(), so the two have to agree about which stars are in the build.
  plan([['Cold Damage'], ['Health']], 1);
  ui.state.done = new Set();
  ui.render();

  const id = ui.chips[ui.state.sel[0]].id;
  let pct = 0, lo = 0;
  for (const e of ui.state.plan.solution) {
    const c = ui.db.constellations[e.id];
    if (!c?.starEffects) continue;
    for (const i of ui.starIdxs(c, e.starsTaken, e.stars)) {
      for (const [tmpl, v, , chip] of c.starEffects[i] ?? []) {
        if (chip !== id || !v) continue;
        if (/\{v\}%/.test(tmpl)) pct += v; else lo += v;
      }
    }
  }
  assert.ok(pct > 0 || lo > 0, 'this fixture grants nothing for its first tag');

  const row = /<div class="covrow[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(app.innerHTML);
  assert.ok(row, 'no coverage rows rendered');
  const shown = /<span class="cmag">([^<]*)<\/span>/.exec(app.innerHTML)?.[1];
  assert.ok(shown, 'no magnitude rendered on any row');
  if (pct) {
    assert.ok(shown.includes(`+${Math.round(pct * 10) / 10}%`),
      `row shows "${shown}" but the plan grants +${pct}%`);
  }
});

test('magnitude is absent when a tag got nothing, and present when it got something', () => {
  // A starved tag must not render "+0%" -- zero is already said by the 0/n count and
  // the warning icon, and a magnitude of zero reads like a measurement rather than an
  // absence.
  plan([['Cold Damage']], 1);
  ui.state.done = new Set();
  ui.render();
  const rows = [...app.innerHTML.matchAll(/<div class="covrow([^"]*)"[^>]*>([\s\S]*?)<\/div>/g)];
  for (const [, cls, body] of rows) {
    if (cls.includes('pow')) continue;
    const zero = cls.includes('zero');
    const hasMag = /class="cmag"/.test(body);
    if (zero) assert.ok(!hasMag, 'a starved tag rendered a magnitude');
  }
});

test('a range keeps both ends rather than summing its low values', () => {
  // "26-37 Cold Damage" over four stars is not "104 Cold Damage" -- summing low ends
  // understates the build by a third, which is exactly the quiet wrongness a magnitude
  // readout exists to remove.
  //
  // Sweep for a fixture whose build actually contains ranged lines for its own tag,
  // rather than asserting one exists. The first version of this test matched a string
  // it had just constructed itself and would have passed against any implementation.
  let found = null;
  for (const label of ['Cold Damage', 'Fire Damage', 'Lightning Damage', 'Acid Damage',
                       'Vitality Damage', 'Physical Damage']) {
    plan([[label]], 1);
    ui.state.done = new Set();
    const id = ui.chips[ui.state.sel[0]].id;
    let lo = 0, hi = 0;
    for (const e of ui.state.plan.solution) {
      const c = ui.db.constellations[e.id];
      if (!c?.starEffects) continue;
      for (const i2 of ui.starIdxs(c, e.starsTaken, e.stars)) {
        for (const [tmpl, v, v2, chip] of c.starEffects[i2] ?? []) {
          if (chip !== id || !v || /\{v\}%/.test(tmpl)) continue;
          lo += v; hi += (v2 || v);
        }
      }
    }
    if (hi > lo) { found = { label, lo, hi }; break; }
  }
  assert.ok(found, 'no damage fixture produced a ranged magnitude; nothing to test');

  ui.render();
  const shown = /<span class="cmag">([^<]*)<\/span>/.exec(app.innerHTML)?.[1] ?? '';
  const tidy = n => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);
  assert.ok(shown.includes(`${tidy(found.lo)}-${tidy(found.hi)}`),
    `${found.label}: expected the range ${tidy(found.lo)}-${tidy(found.hi)}, row shows "${shown}"`);
});

// --- proving a build in the background ---------------------------------------
// The proof is strictly additive. Everything below pins that: with no Worker (which is
// the case under node, and in any browser where the file fails to load) the app must
// behave exactly as it did before the worker existed.

test('with no Worker available the app solves and renders as before', () => {
  assert.equal(typeof globalThis.Worker, 'undefined',
    'this test is meaningless if a Worker exists; it is asserting the fallback path');

  const p = plan([['Cold Damage'], ['Health']], 1);
  assert.ok(p, 'no plan produced without a worker');
  assert.ok(p.solution.length > 0, 'empty solution');
  assert.ok(p.schedule.totalPoints > 0 && p.schedule.totalPoints <= 55,
    `implausible point total ${p.schedule.totalPoints}`);

  ui.render();
  assert.match(app.innerHTML, /constellations/, 'status line missing');
});

test('an unproven build says nothing about optimality', () => {
  // Silence has to mean "nobody asked", not "it is worse". Most builds are never
  // proven -- no glpk installed, no worker, or the proof is still running -- so a badge
  // that appeared by default would be a claim the tool cannot support.
  plan([['Cold Damage'], ['Health']], 1);
  ui.render();
  assert.doesNotMatch(app.innerHTML, /class="proven"/,
    'an unproven build claimed to be optimal');
  assert.ok(!ui.state.plan.proven, 'plan flagged proven without a proof');
});

test('a proven plan renders the marker in the totals line of BOTH views', () => {
  // Simulates what onProof() installs, so the render path is covered even though the
  // worker itself cannot run here. Both views, because the summary was split across a
  // header and a totals line until they were folded together, and a marker that only
  // appeared in one of them would be the same split in a smaller form.
  const p = plan([['Cold Damage'], ['Health']], 1);
  ui.state.plan = { ...p, proven: true };

  for (const plain of [false, true]) {
    ui.state.plain = plain;
    ui.render();
    const total = /<div class="total">([\s\S]*?)<\/div>/.exec(app.innerHTML)?.[1] ?? '';
    assert.match(total, /class="proven"[^>]*>optimal</,
      `no optimal marker in the ${plain ? 'Overview' : 'Detail'} totals line`);
  }

  // Detail's totals line is the one that gained the constellation count, since
  // Overview already states it as "N of M bought".
  ui.state.plain = false;
  ui.render();
  assert.match(app.innerHTML, new RegExp(`${p.solution.length} constellations`),
    'Detail lost the constellation count');
  ui.state.plan = p;
});

test('the summary is in one place, not two', () => {
  // It used to sit in a header AND a totals line, saying overlapping things. The header
  // version wrapped onto three lines once it carried the proven marker too.
  plan([['Cold Damage'], ['Health']], 1);
  ui.render();
  assert.doesNotMatch(app.innerHTML, /class="status"/,
    'the header status came back; the summary is split across two places again');
});

test('a stale proof reply triggers a fresh request rather than silence', () => {
  // The worker answers one request at a time, so clicking through the scoring modes
  // queues solves and every reply lands stale. Discarding them is right; leaving it
  // there meant the mode you settled on was never proven and nothing said why.
  //
  // No Worker here, so drive onProof() through the message path the worker would use.
  plan([['Cold Damage'], ['Health']], 1);
  const sent = [];
  const fakeWorker = {
    postMessage: m => sent.push(m),
    addEventListener() {},
  };
  ui.__setProofWorker(fakeWorker);
  try {
    ui.askForProof();
    assert.equal(sent.length, 1, 'no proof requested for the current build');
    const first = sent[0];

    // Answer the OLD question after the inputs have moved on.
    ui.state.mode = 2;
    ui.onProof({ data: { id: first.id, optimal: true, solution: [] } });

    assert.equal(sent.length, 2, 'a stale reply did not trigger a fresh request');
    assert.equal(sent[1].mode, 2, 'the re-ask used the old inputs');
    assert.notEqual(sent[1].id, first.id, 're-ask reused the stale request id');
  } finally {
    ui.__setProofWorker(undefined);
  }
});

// --- many characters ---------------------------------------------------------
// A character owns its tags, weights, mode, drag order, progress and lock. Everything
// else -- which library tab, which categories are open, cards or column, "stop telling
// me about the lock" -- belongs to the person and is shared by all of them.

/** localStorage backed by a Map, so a test can see and seed what was written. */
function withStore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  return {
    store,
    // The CURRENT store key. Bumped with the document version, since a helper left
    // pointing at the old one reads null and every assertion built on it goes strange.
    read: () => JSON.parse(store.get('gd-devotion-planner:v3') ?? 'null'),
    restore: () => { globalThis.localStorage = real; },
  };
}

test('a v1 save migrates into one character, and v1 is left alone', () => {
  // The thing being migrated is the only copy of someone's progress, so the old key
  // stays put as a free undo if this is ever wrong.
  const v1 = JSON.stringify({
    v: 1,
    tags: [ui.chips[chipIdx('Cold Damage')].id, null, null, null, null],
    weights: [3, 2, 2, 2, 2],
    mode: 2, order: null, tab: 'pet', open: ['character|Offense'],
    done: ['constellation1:1'], plain: true, locked: true, lockWarnSeen: true,
  });
  const s = withStore({ 'gd-devotion-planner:v1': v1 });
  try {
    ui.load();
    const chars = ui.charList();
    assert.equal(chars.length, 1, 'migration should produce exactly one character');
    assert.equal(ui.state.mode, 2, 'scoring mode lost in migration');
    assert.deepEqual([...ui.state.done], ['constellation1:1'], 'progress lost in migration');
    assert.equal(ui.state.locked, true, 'lock state lost in migration');
    // Preferences went to the shared side, not into the character.
    assert.equal(ui.state.tab, 'pet', 'library tab lost in migration');
    assert.equal(ui.state.plain, true, 'view preference lost in migration');
    assert.equal(ui.state.lockWarnSeen, true, 'lock dismissal lost in migration');

    ui.save();
    assert.equal(s.store.get('gd-devotion-planner:v1'), v1, 'the v1 key was modified or deleted');
    const d = s.read();
    assert.equal(d.v, 3, 'a v1 document migrates straight to the current version');
    assert.ok(d.prefs.lockWarnSeen, 'preferences should live outside any character');
    assert.equal(d.chars[d.active].lockWarnSeen, undefined,
      'a preference leaked into the character');
  } finally { s.restore(); }
});

test('each character keeps its own tags, progress and lock', () => {
  const s = withStore();
  try {
    ui.load();
    const first = ui.charList()[0].id;
    plan([['Cold Damage']], 1);
    ui.state.done = new Set(ui.pathStarKeys().slice(0, 3));
    ui.state.locked = true;
    const coldDone = [...ui.state.done].sort();

    const second = ui.addChar({});
    assert.notEqual(second, first, 'a new character reused the old id');
    assert.equal(ui.state.done.size, 0, 'a new character inherited progress');
    assert.equal(ui.state.locked, false, 'a new character arrived locked');
    assert.equal(picked(), 0, 'a new character inherited tags');

    plan([['Fire Damage']], 0);
    assert.ok(ui.switchChar(first), 'could not switch back');
    assert.deepEqual([...ui.state.done].sort(), coldDone, 'progress did not come back');
    assert.equal(ui.state.locked, true, 'lock state did not come back');
    assert.equal(ui.state.mode, 1, 'scoring mode did not come back');
    assert.equal(ui.chips[ui.state.sel[0]].label, 'Cold Damage', 'tags did not come back');
  } finally { s.restore(); }

  function picked() { return ui.state.sel.filter(x => x != null).length; }
});

test('duplicating copies everything, including ticks and the lock', () => {
  // If you have bought those stars in game they are just as true of the copy.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.state.done = new Set(ui.pathStarKeys().slice(0, 4));
    ui.state.locked = true;
    const before = [...ui.state.done].sort();
    const src = ui.activeChar();

    ui.addChar({ from: ui.charList().find(c => c.name === src.name).id });
    assert.deepEqual([...ui.state.done].sort(), before, 'a duplicate lost its progress');
    assert.equal(ui.state.locked, true, 'a duplicate arrived unlocked');
    assert.match(ui.activeChar().name, / copy$/, 'a duplicate did not get a distinct name');
  } finally { s.restore(); }
});

test('the name follows the tags until you set one', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage'], ['Health']], 1);
    ui.save();
    assert.equal(ui.activeChar().name, 'Cold Damage + Health', 'auto-name did not follow the tags');

    ui.renameChar(ui.charList()[0].id, 'Fire Sorc');
    plan([['Fire Damage']], 1);
    ui.save();
    assert.equal(ui.activeChar().name, 'Fire Sorc', 'a chosen name was overwritten by auto-naming');

    // Clearing the name hands it back to auto-naming rather than leaving it blank.
    ui.renameChar(ui.charList()[0].id, '   ');
    ui.save();
    assert.equal(ui.activeChar().name, 'Fire Damage', 'an emptied name did not return to auto');
  } finally { s.restore(); }
});

test('deleting the last character leaves an empty one, never zero', () => {
  // With no characters the app has nowhere to put your tags.
  const s = withStore();
  try {
    ui.load();
    const only = ui.charList()[0].id;
    ui.deleteChar(only);
    assert.equal(ui.charList().length, 1, 'deleting the only character left none');
    assert.notEqual(ui.charList()[0].id, only, 'the deleted character is still there');
    assert.equal(ui.state.sel.filter(x => x != null).length, 0, 'the replacement is not empty');
  } finally { s.restore(); }
});

test('deleting the active character activates another and loads it', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    const keep = ui.charList()[0].id;
    const doomed = ui.addChar({});
    plan([['Fire Damage']], 0);

    ui.deleteChar(doomed);
    assert.equal(ui.charList().length, 1, 'the deleted character survived');
    assert.equal(ui.activeChar().name, 'Cold Damage', 'did not activate the remaining character');
    assert.equal(ui.chips[ui.state.sel[0]].label, 'Cold Damage', 'live state was not reloaded');
    assert.ok(keep, 'kept id');
  } finally { s.restore(); }
});

test('resetting a character leaves the others alone', () => {
  // A regression net rather than a fix: reset() used to removeItem() the stored key,
  // and that was already harmless because the render() it ends with saves the whole
  // document straight back. This pins the invariant so it stays harmless if either
  // half of that changes.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.addChar({});
    plan([['Fire Damage']], 1);
    assert.equal(ui.charList().length, 2, 'setup failed');

    click({ reset: '1' });
    assert.equal(ui.charList().length, 2, 'resetting a character deleted the others');
    assert.ok(s.read(), 'resetting wiped the whole store');
    assert.equal(ui.state.sel.filter(x => x != null).length, 0, 'reset did not clear the tags');
  } finally { s.restore(); }
});

test('switching characters clears the undo trail', () => {
  // It is a stack of tick snapshots belonging to the character you just left.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    const keys = ui.pathStarKeys();
    click({ star: keys[0] });
    click({ star: keys[1] });
    assert.ok(ui.history.length > 0, 'no undo history to clear');

    ui.addChar({});
    assert.equal(ui.history.length, 0, 'undo history followed you to another character');
  } finally { s.restore(); }
});

test('the CP badge is lit only where the build reaches the power star', () => {
  // Having a power and TAKING it are different: 40 of the 62 sit short of the end, so
  // a partial take can stop before the power star. The badge used to say only "there is
  // a power here", which reads as a promise the build has not made.
  //
  // Derived independently from the plan rather than trusting the markup's own class.
  const s = withStore();
  try {
    ui.load();
    const p = plan([['Chaos Damage'], ['Shield Damage Blocked']], 0);
    ui.state.done = new Set();

    // Both views, from the same builder, so they cannot disagree about whether a power
    // is actually being taken.
    for (const plain of [true, false]) {
      ui.state.plain = plain;
      ui.render();
      const view = plain ? 'Overview' : 'Detail';
      let lit = 0, dim = 0, checked = 0;
      for (const e of p.solution) {
        const c = ui.db.constellations[e.id];
        if (!c.hasPower || !c.powerStar) continue;
        checked++;
        const takesPower = (e.stars ?? []).includes(c.powerStar);
        // Find the badge that follows this constellation's name, whichever view it is.
        // `>Name` without a closing bracket: the badge follows the name after a
        // space, so `>Name<` matched only the rows that have no badge at all.
        const at = app.innerHTML.indexOf(`>${c.name}`);
        assert.ok(at >= 0, `${view}: no row for ${c.name}`);
        const after = app.innerHTML.slice(at, at + 400);
        const badge = /<span class="cp( off)?"/.exec(after);
        assert.ok(badge, `${view}: no CP badge on ${c.name}`);
        const isDim = badge[1] === ' off';
        assert.equal(isDim, !takesPower,
          `${view}/${c.name}: badge ${isDim ? 'dimmed' : 'lit'} but the build ${takesPower ? 'does' : 'does not'} take its power star`);
        takesPower ? lit++ : dim++;
      }
      assert.ok(checked > 0, `${view}: fixture has no constellation with a power`);
      assert.ok(lit > 0, `${view}: no power taken, so a lit badge is untested`);
      assert.ok(dim > 0, `${view}: no power skipped, so a dimmed badge is untested`);
    }
    ui.state.plain = false;
  } finally { s.restore(); }
});

test('both CP badges carry the power tooltip, and only that tooltip', () => {
  // Dimmed does not mean silent: what the power does is exactly the thing that decides
  // whether to spend the extra points reaching it. But it must not ALSO carry a native
  // `title` -- that fires on the same hover as the styled tooltip, so the browser box
  // landed on top of the effect list you had just opened.
  const s = withStore();
  try {
    ui.load();
    plan([['Chaos Damage'], ['Shield Damage Blocked']], 0);
    ui.state.done = new Set();
    ui.state.plain = true;
    ui.render();

    const badges = [...app.innerHTML.matchAll(/<span class="cp( off)?"([^>]*)>CP<\/span>/g)];
    assert.ok(badges.length > 1, 'not enough CP badges to test');
    for (const b of badges) {
      assert.match(b[2], /data-fx="/,
        `a ${b[1] ? 'dimmed' : 'lit'} CP badge has no tooltip`);
      assert.doesNotMatch(b[2], /\stitle="/,
        `a ${b[1] ? 'dimmed' : 'lit'} CP badge carries a native title that will cover the styled one`);
    }
    assert.ok(badges.some(b => b[1]), 'no dimmed badge in this fixture; the title check is untested');
    ui.state.plain = false;
  } finally { s.restore(); }
});

test('only the unreached power carries the "not scheduled" note', () => {
  // The note rides on the tooltip's heading line rather than becoming another bullet:
  // it describes the power itself, not one of the effects listed beneath it.
  const s = withStore();
  try {
    ui.load();
    const p = plan([['Chaos Damage'], ['Shield Damage Blocked']], 0);
    ui.state.done = new Set();

    for (const plain of [true, false]) {
      ui.state.plain = plain;
      ui.render();
      const view = plain ? 'Overview' : 'Detail';
      for (const e of p.solution) {
        const c = ui.db.constellations[e.id];
        if (!c.hasPower || !c.powerStar) continue;
        const at = app.innerHTML.indexOf(`>${c.name}`);
        const badge = /<span class="cp( off)?"([^>]*)>/.exec(app.innerHTML.slice(at, at + 400));
        assert.ok(badge, `${view}: no CP badge on ${c.name}`);
        const takesPower = (e.stars ?? []).includes(c.powerStar);
        const hasNote = /data-fxnote="Not scheduled to pick"/.test(badge[2]);
        assert.equal(hasNote, !takesPower,
          `${view}/${c.name}: note ${hasNote ? 'present' : 'absent'} but the power ${takesPower ? 'is' : 'is not'} taken`);
      }
    }
    ui.state.plain = false;
  } finally { s.restore(); }
});

// --- the global bar ----------------------------------------------------------

test('the bar lists every character and marks the active one', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.addChar({});
    plan([['Fire Damage']], 1);
    ui.render();

    // Scoped to the character switcher. Counting every <option> on the page picked up
    // the difficulty selector too, which is a different question entirely.
    const picker = app.innerHTML.slice(app.innerHTML.indexOf('class="cpick"'));
    const justPicker = picker.slice(0, picker.indexOf('</select>'));
    const opts = [...justPicker.matchAll(/<option value="([^"]+)"( selected)?>([^<]*)</g)];
    assert.equal(opts.length, 2, 'the switcher does not list both characters');
    const sel = opts.filter(o => o[2]);
    assert.equal(sel.length, 1, 'exactly one option should be selected');
    assert.equal(sel[0][1], ui.charList().find(c => c.name === 'Fire Damage').id,
      'the selected option is not the active character');
  } finally { s.restore(); }
});

test('choosing another character in the switcher loads it', () => {
  // Through the change handler, not switchChar() directly: a <select> announces itself
  // with `change`, and the wiring is the part worth testing.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    const cold = ui.charList()[0].id;
    ui.addChar({});
    plan([['Fire Damage']], 1);
    ui.render();

    change({ cswitch: '1', value: cold });
    assert.equal(ui.chips[ui.state.sel[0]].label, 'Cold Damage', 'switching did not load the character');
  } finally { s.restore(); }
});

test('the new and duplicate buttons do different things', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.state.done = new Set(ui.pathStarKeys().slice(0, 3));

    click({ cdup: '1' });
    assert.equal(ui.state.done.size, 3, 'duplicate did not carry the progress across');
    assert.equal(ui.chips[ui.state.sel[0]].label, 'Cold Damage', 'duplicate did not carry the tags');

    click({ cnew: '1' });
    assert.equal(ui.state.done.size, 0, 'a new character arrived with progress');
    assert.equal(ui.state.sel.filter(x => x != null).length, 0, 'a new character arrived with tags');
    assert.equal(ui.charList().length, 3, 'expected three characters by now');
  } finally { s.restore(); }
});

test('rename swaps the switcher for a field, and commits on the second click', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.render();
    assert.match(app.innerHTML, /data-cswitch/, 'no switcher to begin with');

    click({ crename: '1' });
    assert.match(app.innerHTML, /data-cname/, 'rename did not open a field');
    assert.doesNotMatch(app.innerHTML, /data-cswitch/, 'the switcher is still there while renaming');

    app.querySelector('[data-cname]').value = 'Fire Sorc';
    click({ crename: '1' });
    assert.equal(ui.activeChar().name, 'Fire Sorc', 'the rename did not commit');
    assert.match(app.innerHTML, /data-cswitch/, 'the switcher did not come back');
  } finally { s.restore(); }
});

test('Escape abandons a rename, Enter commits it', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.render();
    const before = ui.activeChar().name;

    click({ crename: '1' });
    app.querySelector('[data-cname]').value = 'Discarded';
    fire('keydown', { key: 'Escape' });
    assert.equal(ui.activeChar().name, before, 'Escape committed the rename anyway');
    assert.match(app.innerHTML, /data-cswitch/, 'Escape left the field open');

    click({ crename: '1' });
    app.querySelector('[data-cname]').value = 'Kept';
    fire('keydown', { key: 'Enter' });
    assert.equal(ui.activeChar().name, 'Kept', 'Enter did not commit the rename');
  } finally { s.restore(); }
});

test('deleting asks first, and only then deletes', () => {
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.addChar({});
    plan([['Fire Damage']], 1);
    ui.render();

    click({ cdel: '1' });
    assert.equal(ui.charList().length, 2, 'the delete button deleted without asking');
    assert.match(app.innerHTML, /data-dialog="delchar"/, 'no confirmation offered');

    click({ dialog: 'cancel' });
    assert.equal(ui.charList().length, 2, 'cancelling deleted it anyway');

    click({ cdel: '1' });
    click({ dialog: 'delchar' });
    assert.equal(ui.charList().length, 1, 'confirming did not delete');
    assert.equal(ui.activeChar().name, 'Cold Damage', 'did not fall back to the remaining character');
  } finally { s.restore(); }
});

test('the only character cannot be deleted', () => {
  // Deleting it would leave nowhere to put your tags, and the replacement-on-empty rule
  // makes the button a no-op that looks like it did something.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    ui.render();
    assert.match(app.innerHTML, /data-cdel="1" disabled/, 'delete is offered for the only character');

    click({ cdel: '1' });
    assert.equal(ui.state.dialog, null, 'it asked anyway');
    assert.equal(ui.charList().length, 1);
  } finally { s.restore(); }
});

test('the lock does not stop you changing character', () => {
  // The lock protects a build's contents. A locked character you could not leave would
  // be a trap rather than a safety rail.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 1);
    const cold = ui.charList()[0].id;
    ui.addChar({});
    plan([['Fire Damage']], 1);
    ui.state.locked = true;
    ui.state.lockWarnSeen = true;
    ui.render();

    change({ cswitch: '1', value: cold });
    assert.equal(ui.chips[ui.state.sel[0]].label, 'Cold Damage', 'the lock blocked switching character');
    assert.equal(ui.state.locked, false, 'the unlocked character arrived locked');

    // And the click-driven actions too, which switching alone does not cover: the
    // switcher goes through `change`, so a lock guard in the click handler would be
    // invisible to the assertion above. Creating or duplicating a character does not
    // modify the locked one, so neither has any business being frozen.
    change({ cswitch: '1', value: ui.charList().find(c => c.name === 'Fire Damage').id });
    ui.state.locked = true;
    const before = ui.charList().length;
    click({ cnew: '1' });
    assert.equal(ui.charList().length, before + 1, 'the lock blocked creating a character');

    ui.state.locked = true;
    click({ cdup: '1' });
    assert.equal(ui.charList().length, before + 2, 'the lock blocked duplicating a character');

    ui.state.locked = true;
    click({ crename: '1' });
    assert.equal(ui.state.renaming, true, 'the lock blocked renaming');
    click({ crename: '1' });
  } finally { s.restore(); }
});

// --- controls ----------------------------------------------------------------
// A control proposes tags; the picker still owns them. These pin the bridge between
// the two, not the controls' own arithmetic -- that lives in controls.test.mjs.

test('switching a control on fills the picker with its tags', () => {
  const s = withStore();
  try {
    ui.load();
    click({ ctl: 'meta-offense' });
    const picked = ui.state.sel.filter(x => x != null).map(i => ui.chips[i].label);
    // Casting speed sits here beside attack speed because a build wants one or the
    // other and nothing can tell which -- it is common on gear AND deliberately
    // stacked by casters, so no automatic measure separates those. That is precisely
    // what a preset is for.
    assert.deepEqual(picked,
      ['Offensive Ability', 'Attack Speed', 'Casting Speed', 'Crit Damage'],
      'meta offense did not land in the picker');
    assert.equal(ui.state.weights[0], 3, 'the control\'s weight was not applied');
  } finally { s.restore(); }
});

test('a control\'s tags are ordinary tags you can still edit', () => {
  // The whole design: a control proposes, it does not take the picker away. If these
  // stop behaving like hand-picked tags, the "playground not checklist" line is broken.
  const s = withStore();
  try {
    ui.load();
    click({ ctl: 'turtle' });
    click({ setw: '0:1' });
    assert.equal(ui.state.weights[0], 1, 'could not change a weight a control set');
    // `button: 1` because the remove handler reaches its target through
    // closest('button'), which the harness only matches when the dataset says so.
    click({ rm: '1', button: 1 });
    assert.equal(ui.state.sel[1], null, 'could not remove a tag a control chose');
  } finally { s.restore(); }
});

test('switching a control off leaves your tags alone', () => {
  // Turning a control off should not throw away a selection you may have edited by
  // hand. Clearing would be the destructive reading of an undo.
  const s = withStore();
  try {
    ui.load();
    click({ ctl: 'meta-offense' });
    const before = ui.state.sel.filter(x => x != null).length;
    click({ ctl: 'meta-offense' });
    assert.equal(ui.state.controls.length, 0, 'the control stayed on');
    assert.equal(ui.state.sel.filter(x => x != null).length, before,
      'switching a control off cleared the tags it had proposed');
  } finally { s.restore(); }
});

test('a preset choice belongs to the character, not the app', () => {
  // What you are aiming this character at is a fact about THIS character. Carrying it to
  // another would be worse than losing it: it would look deliberate.
  const s = withStore();
  try {
    ui.load();
    click({ ctl: 'turtle' });
    const first = ui.charList()[0].id;

    ui.addChar({});
    assert.equal(ui.state.controls.length, 0, 'a new character inherited a preset');

    ui.switchChar(first);
    assert.deepEqual(ui.state.controls, ['turtle'], 'the preset did not come back');
  } finally { s.restore(); }
});


// --- importing a character from a save ---------------------------------------------
//
// The lib tests cover the ref mapping. These cover the wiring, which is where the
// quiet failures are: an import that creates no character, overwrites the one you were
// on, or ticks stars onto the wrong character entirely.

const SAVE = path.join(import.meta.dirname, '../../../player.gdc');
const haveSave = fs.existsSync(SAVE);

test('importing a save lands BESIDE the current character, never over it',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  const s = withStore();
  try {
    ui.load();
    const before = ui.charList().length;
    const originalId = ui.activeChar().id ?? ui.charList()[0].id;
    // Something worth losing on the character we are leaving.
    ui.state.done = new Set(['constellation01:1']);
    ui.save();

    const r = ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    assert.ok(!r.error, `import failed: ${r.error}`);
    assert.equal(ui.charList().length, before + 1, 'import should ADD a character');
    assert.notEqual(ui.activeChar().id, originalId, 'import should switch to the new one');

    // The imported ticks are the save's, not the previous character's.
    assert.equal(ui.state.done.size, r.stars, 'ticked stars do not match what was imported');
    assert.ok(r.stars > 0, 'a real save should yield some devotion stars');

    // And the character we came from still has its own progress.
    ui.switchChar(originalId);
    assert.deepEqual([...ui.state.done], ['constellation01:1'],
      'importing trampled the previous character');
  } finally { s.restore(); }
});

test('an imported character carries the game\'s own name, not an auto-name',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  const s = withStore();
  try {
    ui.load();
    ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    const cur = ui.activeChar();
    // `named` must be set, or the next tag change hands the name back to auto-naming
    // and the character silently stops being called what the game calls it.
    assert.ok(cur.named, 'imported name must be sticky');
    assert.ok(cur.name && cur.name !== 'New character', `unexpected name ${cur.name}`);
    assert.doesNotMatch(cur.name, /^\s*$/, 'imported name is blank');
  } finally { s.restore(); }
});

test('the stars ticked agree with the points the bio says are spent',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  // The two numbers come from completely separate code hundreds of bytes apart in the
  // file, so agreement is real evidence the join is right rather than plausible.
  const s = withStore();
  try {
    ui.load();
    const r = ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    assert.equal(r.unmatched.length, 0, `unmatched records: ${r.unmatched.slice(0, 3)}`);
    assert.equal(r.stars, r.spent,
      `${r.stars} stars ticked but the bio says ${r.spent} points spent`);
  } finally { s.restore(); }
});

test('a file that is not a save is refused with a message, not an exception', () => {
  const s = withStore();
  try {
    ui.load();
    const before = ui.charList().length;
    const r = ui.importSave(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.ok(r.error, 'garbage should be reported as an error');
    assert.equal(ui.charList().length, before, 'a failed import must not leave a character');
  } finally { s.restore(); }
});

test('a new character starts on the DEFAULT scoring mode, not Passives', () => {
  // The bug this pins: `state.mode` initialised to 1 (Balanced) while `blankChar()` set
  // 0, and since applyChar() runs on load the character's value always won. Every
  // character silently started on Passives -- powers ignored entirely -- which is the
  // least useful of the three and not what the initial state claimed.
  //
  // Asserting the VALUE rather than a named constant on purpose: the whole failure was
  // two literals drifting apart, and a test that reads the same constant as the code
  // would have agreed with the bug.
  const s = withStore();
  try {
    ui.load();
    assert.equal(ui.state.mode, 1, 'a fresh character should start on Balanced');

    const id = ui.addChar({});
    assert.equal(ui.state.mode, 1, 'a character added later should too');
    assert.equal(ui.activeChar().mode, 1, 'and it should be stored on the character');

    // A v1 document with no mode recorded lands on the same default. Anyone migrating
    // saw Balanced, because state.mode was 1 and there was nothing to override it.
    const s2 = withStore({ 'gd-devotion-planner:v1': JSON.stringify({ tags: [], done: [] }) });
    try {
      ui.load();
      assert.equal(ui.state.mode, 1, 'a migrated v1 doc with no mode should default to Balanced');
    } finally { s2.restore(); }
  } finally { s.restore(); }
});

test('an explicitly saved scoring mode survives, including Passives', () => {
  // The default must not trample a real choice. Someone who picked Passives and reloads
  // must still be on Passives -- otherwise fixing the default breaks saved builds.
  const s = withStore();
  try {
    ui.load();
    ui.state.mode = 0;
    ui.save();
    ui.load();
    assert.equal(ui.state.mode, 0, 'a deliberately chosen Passives was overwritten');
  } finally { s.restore(); }
});

/**
 * A save whose bio block claims an older version, to exercise the outdated path.
 *
 * Only the first two blocks are needed: the reader refuses at the bio and never reaches
 * the inventory, which is the whole point -- it stops before it can misread anything.
 */
function oldFormatSave() {
  const XOR = 0x55555555, PRIME = 39916801, MAGIC = 0x58434447;
  const out = []; let key = 0x1234abcd >>> 0;
  const table = new Uint32Array(256);
  out.push(...[0, 8, 16, 24].map(sh => (((0x1234abcd ^ XOR) >>> 0) >>> sh) & 0xff));
  let k = 0x1234abcd >>> 0;
  for (let i = 0; i < 256; i++) { k = ((k >>> 1) | (k << 31)) >>> 0; k = Math.imul(k, PRIME) >>> 0; table[i] = k; }
  const adv = bs => { for (const b of bs) key = (key ^ table[b]) >>> 0; };
  const u = (v, advance = true) => { const raw = ((v >>> 0) ^ key) >>> 0;
    const bs = [0, 8, 16, 24].map(sh => (raw >>> sh) & 0xff); out.push(...bs);
    if (advance) adv(bs); };
  const by = v => { const raw = (v ^ key) & 0xff; out.push(raw); adv([raw]); };
  const st = t => { u(t.length); for (const c of t) { const raw = (c.charCodeAt(0) ^ key) & 0xff;
    out.push(raw); key = (key ^ table[raw]) >>> 0; } };
  const ws = t => { u(t.length); for (const c of t) { by(c.charCodeAt(0) & 0xff); by((c.charCodeAt(0) >>> 8) & 0xff); } };
  const open = id => { u(id); const keyAtLen = key; const at = out.length; u(0, false);
    return { at, keyAtLen, start: out.length }; };
  const close = h => { const len = out.length - h.start; const raw = ((len >>> 0) ^ h.keyAtLen) >>> 0;
    for (let i = 0; i < 4; i++) out[h.at + i] = (raw >>> (i * 8)) & 0xff; u(0, false); };

  u(MAGIC); u(2); ws('Oldie'); by(1); st('tagCharacterClass01'); u(30); by(0); by(7);
  u(0, false); u(8);
  for (let i = 0; i < 16; i++) by(i);
  const info = open(1); u(5); by(1); by(1); by(0); by(0); u(999); close(info);
  const bio = open(2); u(6); u(30); u(1000); u(0); u(0); u(5); u(12);
  for (let i = 0; i < 5; i++) u(0);
  close(bio);
  return Uint8Array.from(out);
}

test('an outdated save reaches the UI as advice, not as a parse failure', () => {
  // The player meets this, not the library. The remedy is confirmed -- load the
  // character once in Grim Dawn and save -- so the note must carry it rather than
  // reporting a version number, and it must not be dressed up as "could not read",
  // which buries the useful half.
  const s = withStore();
  try {
    ui.load();
    const before = ui.charList().length;

    // A real save whose bio block claims an older version. Built here rather than
    // mocked, so it exercises the actual reader.
    const old = oldFormatSave();
    const r = ui.importSave(old);

    assert.ok(r.error, 'an old-format save should be refused');
    assert.equal(r.outdated, true, 'the UI needs to distinguish this from corruption');
    assert.match(r.error, /Load it once in Grim Dawn and save/);
    assert.equal(ui.charList().length, before, 'a refused import must leave no character');
  } finally { s.restore(); }
});

test('re-importing the same save UPDATES the character rather than duplicating it',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  // This is what makes re-import the tracking action: play, re-import, and the ticks are
  // whatever the game says. Creating a second character each time would make it useless.
  const s = withStore();
  try {
    ui.load();
    const before = ui.charList().length;
    const bytes = new Uint8Array(fs.readFileSync(SAVE));

    const first = ui.importSave(bytes);
    assert.ok(!first.error);
    assert.equal(first.reimported, false, 'the first import creates');
    assert.equal(ui.charList().length, before + 1);

    const again = ui.importSave(bytes);
    assert.equal(again.reimported, true, 'the second updates');
    assert.equal(ui.charList().length, before + 1, 're-import must not duplicate');
    assert.equal(again.id, first.id, 'and must land on the same character');
  } finally { s.restore(); }
});

test('re-import matches on the SAVE name, not the editable one',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  // The app allows renaming and the game does not. Matching on the display name would
  // mean the first rename orphans a character from its save, and the next import
  // silently creates a duplicate instead of updating it.
  const s = withStore();
  try {
    ui.load();
    const bytes = new Uint8Array(fs.readFileSync(SAVE));
    const first = ui.importSave(bytes);
    const before = ui.charList().length;

    ui.renameChar(first.id, 'Farker (cold build)');
    const again = ui.importSave(bytes);

    assert.equal(again.reimported, true, 'a renamed character is still the same save');
    assert.equal(ui.charList().length, before, 'renaming must not cause a duplicate');
    assert.equal(again.id, first.id);
  } finally { s.restore(); }
});

test('a v2 document migrates to v3 with its progress intact', () => {
  // `done` changed MEANING -- progress against a plan becomes the actual build -- but not
  // shape, and every v2 tick was a star really bought. So carrying the set across is
  // correct rather than lossy.
  const v2 = JSON.stringify({
    v: 2, active: 'c1', order: ['c1'],
    chars: { c1: {
      name: 'Old', named: true,
      tags: Array(5).fill(null), weights: [2, 2, 2, 2, 2], mode: 2,
      order: null, done: ['constellation01:1', 'constellation01:2'], locked: true,
    } },
    prefs: { tab: 'pet', open: [], plain: true, lockWarnSeen: true },
  });
  const s = withStore({ 'gd-devotion-planner:v2': v2 });
  try {
    ui.load();
    assert.deepEqual([...ui.state.done].sort(), ['constellation01:1', 'constellation01:2']);
    assert.equal(ui.state.mode, 2, 'a deliberately chosen mode survives');
    assert.equal(ui.state.locked, true);
    assert.equal(ui.activeChar().name, 'Old');
    // Not imported, so it has no save behind it -- and guessing one from the display
    // name would let a later rename orphan it.
    assert.equal(ui.activeChar().source, null);
  } finally { s.restore(); }
});

test('the v2 key is LEFT IN PLACE as an undo', () => {
  // Same reasoning as v1: a few hundred bytes against being able to recover if this
  // reinterpretation turns out wrong, when the thing reinterpreted is the only record of
  // someone's progress.
  const v2 = JSON.stringify({
    v: 2, active: 'c1', order: ['c1'],
    chars: { c1: { name: 'Old', named: true, tags: Array(5).fill(null),
      weights: [2, 2, 2, 2, 2], mode: 1, order: null, done: ['x:1'], locked: false } },
    prefs: {},
  });
  const s = withStore({ 'gd-devotion-planner:v2': v2 });
  try {
    ui.load();
    ui.save();
    assert.ok(globalThis.localStorage.getItem('gd-devotion-planner:v2'),
      'the v2 payload must survive the migration');
    assert.ok(globalThis.localStorage.getItem('gd-devotion-planner:v3'));
  } finally { s.restore(); }
});

test('presets live in the tag picker, one at a time', () => {
  // They moved out of their own column: a preset exists to produce tags, and the picker
  // is where tags come from. Folding them back also returns the width that made three
  // columns cramped.
  const s = withStore();
  try {
    ui.load();
    ui.render();
    assert.match(app.innerHTML, /data-tab="presets"/, 'the third tab should exist');
    // The equaliser asked nine questions to tell you something it could work out. Gone.
    assert.doesNotMatch(app.innerHTML, /data-ctlin/);

    // `button: 1` because the tab handler reaches its target through closest('button'),
    // which the harness only matches when the dataset says so.
    click({ tab: 'presets', button: 1 });
    ui.render();
    assert.match(app.innerHTML, /data-ctl="meta-offense"/, 'presets render in the tab');
    assert.doesNotMatch(app.innerHTML, /data-add=/, 'chips belong to the other tabs');
  } finally { s.restore(); }
});

test('choosing a preset replaces the last one rather than stacking', () => {
  // A UI simplification, NOT a limit of the model: applyControls() still combines any
  // number and merges on the higher weight, and that code is kept because stacking
  // "shore up resistances" with "push what I have" was the common case.
  const s = withStore();
  try {
    ui.load();
    click({ ctl: 'meta-offense' });
    assert.deepEqual(ui.state.controls, ['meta-offense']);
    click({ ctl: 'turtle' });
    assert.deepEqual(ui.state.controls, ['turtle'], 'the second should replace the first');
    click({ ctl: 'turtle' });
    assert.deepEqual(ui.state.controls, [], 'clicking the active one turns it off');
  } finally { s.restore(); }
});

test('collapse-all folds every open category, and hides when there is nothing to fold', () => {
  const s = withStore();
  try {
    ui.load();
    ui.render();
    assert.match(app.innerHTML, /data-collapse/, 'should offer to collapse what is open');

    click({ collapse: '1', button: 1 });
    ui.render();
    assert.equal([...ui.state.open].filter(k => k.startsWith('character|')).length, 0,
      'every open category should have folded');
    // A control that does nothing is worse than one that is absent.
    assert.doesNotMatch(app.innerHTML, /data-collapse/);
  } finally { s.restore(); }
});

test('an imported character shows its level and class; a hand-built one shows neither', () => {
  // Level and class are facts a save gave us rather than anything typed, so they sit
  // beside the name as information. A character with no save behind it has none to show,
  // and inventing them would be worse than the gap.
  const s = withStore();
  try {
    ui.load();
    ui.render();
    assert.doesNotMatch(app.innerHTML, /class="cmeta"/,
      'a hand-built character has no level or class to show');

    const id = ui.charList()[0].id;
    ui.activeChar().source = 'Farker';
    ui.activeChar().level = 34;
    ui.activeChar().classId = 'tagSkillClassName0410';
    ui.render();
    assert.match(app.innerHTML, /class="cmeta"/);
    assert.match(app.innerHTML, /34/, 'the level should be shown');
  } finally { s.restore(); }
});

test('the difficulty being planned for is per character', () => {
  // Which difficulty you are aiming at is part of planning THIS build -- it changes the
  // advice, since a resistance that is fine on Veteran is dire on Elite -- so it cannot
  // be a preference shared across every character.
  const s = withStore();
  try {
    ui.load();
    ui.render();
    assert.match(app.innerHTML, /data-difficulty/, 'the selector should be in the bar');

    const first = ui.charList()[0].id;
    change({ difficulty: '1', value: 'ultimate' });
    assert.equal(ui.activeChar().difficulty, 'ultimate');

    ui.addChar({});
    assert.notEqual(ui.activeChar().difficulty, 'ultimate',
      'a new character inherited a difficulty');

    ui.switchChar(first);
    assert.equal(ui.activeChar().difficulty, 'ultimate', 'it did not come back');
  } finally { s.restore(); }
});

// --- the comparison view --------------------------------------------------------
//
// The comparison is a VIEW beside Overview and Detail, not a mode that replaces them,
// and these tests exist because the first version got that wrong in a way no test
// caught: it swapped the path out whenever your build and the plan disagreed, which
// took away the stars you tick as you buy them. Change a tag mid-playthrough and the
// thing you used every session was simply gone.
//
// So the two halves are tested apart. Whether there IS a comparison is about the data;
// whether you are LOOKING at one is about you, and you can always leave.

/** Tick some stars, then add one from a constellation the plan does not contain. */
function withOffPlanBuild() {
  plan([['Cold Damage']], 2);
  const planned = new Set(ui.state.plan.schedule.path.map(p => p.id));
  const outsider = Object.keys(ui.db.constellations).find(id => !planned.has(id));
  assert.ok(outsider, 'every constellation is in the plan, so nothing can be off-plan');
  ui.state.done.add(`${outsider}:1`);
  ui.render();
  return outsider;
}

test('owning something the plan does not offers the comparison', () => {
  withOffPlanBuild();
  assert.match(app.innerHTML, /data-compare/, 'no way to reach the comparison');
  assert.match(app.innerHTML, /class="cmp"/, 'an off-plan build should open on the diff');
});

test('following the plan is not offered a comparison', () => {
  plan([['Cold Damage']], 2);
  // Tick the first step, which is by definition part of the plan.
  ui.state.plain = false; ui.render();
  click({ star: /data-star="([^"]+)"/.exec(app.innerHTML)[1] });

  assert.doesNotMatch(app.innerHTML, /data-compare/,
    'a Compare button that shows two identical columns is a button that lies');
  assert.doesNotMatch(app.innerHTML, /class="cmp"/,
    'following your own plan is not a decision to be shown a diff about');
});

test('leaving the comparison puts the tickable path back', () => {
  withOffPlanBuild();
  assert.equal(keysOf(app.innerHTML).length, 0, 'the comparison has no stars to tick');

  click({ compare: '1' });
  assert.doesNotMatch(app.innerHTML, /class="cmp"/, 'Compare did not turn off');
  assert.ok(keysOf(app.innerHTML).length > 0,
    'leaving the comparison left no stars to tick, so the view is still a trap');
});

test('asking for Overview or Detail leaves the comparison', () => {
  withOffPlanBuild();
  click({ plain: '1' });
  assert.doesNotMatch(app.innerHTML, /class="cmp"/,
    'clicking a path view and staying in the comparison makes the button look broken');
});

test('leaving the comparison sticks across a re-solve', () => {
  withOffPlanBuild();
  click({ compare: '1' });
  const done = new Set(ui.state.done);
  plan([['Cold Damage'], ['Armor']], 2, { keep: true });

  // The disagreement is still there -- it is the answer that has to survive.
  assert.deepEqual(ui.state.done, done, 'the fixture lost its ticks');
  assert.doesNotMatch(app.innerHTML, /class="cmp"/,
    'the comparison sprang back open after being dismissed');
  assert.match(app.innerHTML, /data-compare/, 'but it should still be reachable');
});

test('Adopt makes the suggestion the build and clears the ticks', () => {
  withOffPlanBuild();
  assert.ok(ui.state.done.size > 0, 'nothing to clear');

  click({ adopt: '1' });
  assert.equal(ui.state.done.size, 0,
    'ticks recorded progress against the build being replaced and must not carry over');
  assert.doesNotMatch(app.innerHTML, /class="cmp"/,
    'with nothing left to disagree about the comparison should be gone');
});

test('Adopt is undoable', () => {
  withOffPlanBuild();
  const before = [...ui.state.done].sort();

  click({ adopt: '1' });
  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), before,
    'Adopt threw away a build with no way back');
});

test('switching character asks the comparison question again', () => {
  const s = withStore();
  try {
    ui.load();
    const first = ui.charList()[0].id;
    withOffPlanBuild();
    click({ compare: '1' });   // no thanks, for THIS character
    ui.save();

    // NOT through plan(): the helper resets the flag, so building a fixture on the
    // second character would clear the dismissal before the switch and the test would
    // pass without ever exercising the switch. It passed that way once.
    ui.addChar({});
    assert.ok(ui.switchChar(first), 'could not switch back');
    ui.build();

    // Coming back is a fresh look at a build you have not seen since. Carrying the
    // dismissal across would hide the diff on a character you never dismissed it for --
    // and after a re-import, on a build that is not even the one you dismissed.
    assert.match(app.innerHTML, /class="cmp"/,
      'the comparison stayed dismissed for a character switched away from and back');
  } finally { s.restore(); }
});

// --- import fills the picker ------------------------------------------------------
//
// These are the tests that were missing, and their absence hid a bug that looked like
// two: import set ticks and nothing else, so a freshly imported character had no tags,
// therefore no plan, therefore nothing to compare its build against. The diff visible
// for a moment after import was the PREVIOUS character's plan still on screen, and the
// first re-solve took it away with no way back.
//
// So the thing to assert is not "a comparison appeared" -- that passed while broken --
// but that the picker has tags of its own and they survive touching another control.

test('importing fills the picker from what the gear is built for',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  const s = withStore();
  try {
    ui.load();
    const r = ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    assert.ok(!r.error, `import failed: ${r.error}`);

    assert.ok(ui.state.sel.filter(x => x != null).length > 0,
      'import left the picker empty, so there is nothing to plan and nothing to compare');
    // Every proposed tag says what put it there. A proposal you cannot interrogate is
    // one you have to take on trust.
    for (const i of ui.state.sel.filter(x => x != null)) {
      assert.ok(ui.state.tagReasons?.get(ui.chips[i].id),
        `${ui.chips[i].label} was proposed with no reason attached`);
    }
    assert.ok(ui.state.plan, 'tags but no plan -- import did not re-solve');
  } finally { s.restore(); }
});

test('the imported diff survives changing the power scoring',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  // The reported bug. Whether there is a comparison is a fact about the build, so it
  // must not depend on which controls have been touched since.
  const s = withStore();
  try {
    ui.load();
    ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    ui.render();
    const had = /class="cmp"/.test(app.innerHTML);

    click({ score: String(ui.state.mode === 0 ? 1 : 0) });
    ui.build();       // the handler defers this; do it now rather than wait on a timer
    ui.render();

    assert.equal(/class="cmp"/.test(app.innerHTML), had,
      'changing the scoring mode lost the comparison');
    if (had) {
      assert.match(app.innerHTML, /data-compare/,
        'and left no way to get it back');
    }
  } finally { s.restore(); }
});

test('re-import updates the facts but never overwrites tags you chose',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  const s = withStore();
  try {
    ui.load();
    const bytes = new Uint8Array(fs.readFileSync(SAVE));
    ui.importSave(bytes);

    // Edit the proposal, the way anyone would.
    ui.state.sel = ui.state.sel.map(() => null);
    ui.state.sel[0] = chipIdx('Armor');
    ui.save();

    const r = ui.importSave(bytes);
    assert.ok(r.reimported, 'the second import made a new character instead of updating');
    assert.deepEqual(ui.state.sel.filter(x => x != null), [chipIdx('Armor')],
      're-import replaced tags the player had edited; it reports facts, not intent');
  } finally { s.restore(); }
});

test('each proposed tag carries its reason on the pill',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  const s = withStore();
  try {
    ui.load();
    ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    ui.render();

    const whys = [...app.innerHTML.matchAll(/class="ti ti-info-circle why" title="([^"]+)"/g)];
    assert.equal(whys.length, ui.state.sel.filter(x => x != null).length,
      'a proposed tag with no reason is one the player has to take on trust');
    for (const [, why] of whys) {
      // Gear percentages, a resistance reading, or an attribute allocation -- each of
      // the three signals states its own evidence, and all of them carry a number.
      assert.match(why, /gear|items and skills|attribute point|at \d/,
        `"${why}" does not say what put the tag there`);
      assert.match(why, /\d/, `"${why}" asserts rather than shows`);
    }

    // Tags picked by hand explain nothing, because there is nothing to explain.
    ui.state.tagReasons = null;
    ui.render();
    assert.doesNotMatch(app.innerHTML, /ti-info-circle why/,
      'a hand-picked tag was given an explanation it never had');
  } finally { s.restore(); }
});

test('taking a constellation further than the plan does is a comparison', () => {
  // THE CASE THAT WAS MISSED. The first rule only asked about whole constellations, so
  // once tags are derived from your own gear -- and the suggestion therefore lands on the
  // constellations you already chose -- it came back false and the comparison vanished
  // exactly where it was wanted. What is left to decide then is depth.
  plan([['Cold Damage']], 2);
  const partial = ui.state.plan.schedule.path
    .find(p => p.kind !== 'refund' && p.points < ui.db.constellations[p.id].starCount);
  assert.ok(partial, 'no constellation is taken partially, so depth cannot differ');

  // Own every star of it -- the same constellation, further in than the plan goes.
  for (let s = 1; s <= ui.db.constellations[partial.id].starCount; s++) {
    ui.state.done.add(`${partial.id}:${s}`);
  }
  ui.render();
  assert.match(app.innerHTML, /class="cmp"/,
    'owning more of a constellation than the plan takes is something to decide about');
});

test('an imported build has a comparison even when the plan covers all of it', () => {
  // THE PREFIX CASE, which is the whole difference between the two rules and the reason
  // this is built synthetically rather than off the save. Measured on the real save,
  // scoring mode 0 produced a plan that was a superset of the character's build -- so
  // the diff-only rule hid the view -- while modes 1 and 2 dropped two constellations
  // and showed it. A view that appears and disappears as you adjust an unrelated control
  // is worse than either state. Whichever save happens to sit beside the repo cannot be
  // relied on to reproduce that, so the shape is constructed here.
  const s = withStore();
  try {
    ui.load();
    plan([['Cold Damage']], 2);
    // A strict PREFIX of the plan: everything owned is planned, nothing is given up.
    ui.state.done = new Set(ui.pathStarKeys().slice(0, 3));
    ui.render();
    assert.doesNotMatch(app.innerHTML, /class="cmp"/,
      'a hand-built character part-way through its own plan has nothing to decide');

    // The same build, but it came out of the game rather than out of ticking this plan.
    ui.activeChar().source = 'Farker';
    ui.state.compare = null;
    ui.render();
    assert.match(app.innerHTML, /class="cmp"/,
      'an imported build should be comparable even when the plan endorses all of it');
  } finally { s.restore(); }
});

test('Adopt ends the comparison, and ticking does not bring it back',
  { skip: !haveSave && 'no player.gdc alongside the repo' }, () => {
  // Adopting IS the decision the comparison was asking for. Without this an imported
  // character -- which always has one -- would be handed a diff again the moment they
  // ticked their first star, instead of the path they just chose to follow.
  const s = withStore();
  try {
    ui.load();
    ui.importSave(new Uint8Array(fs.readFileSync(SAVE)));
    ui.render();
    click({ adopt: '1' });
    assert.doesNotMatch(app.innerHTML, /class="cmp"/, 'Adopt left the comparison up');

    ui.state.plain = false; ui.render();
    const star = /data-star="([^"]+)"/.exec(app.innerHTML);
    assert.ok(star, 'Adopt left no tickable path, which is the thing it exists to give');
    click({ star: star[1] });
    assert.doesNotMatch(app.innerHTML, /class="cmp"/,
      'ticking a star after adopting put the diff back');
    // Still reachable on purpose -- leaving is an answer, not a one-way door.
    assert.match(app.innerHTML, /data-compare/);
  } finally { s.restore(); }
});

// --- the devotions header ---------------------------------------------------------
//
// Icons only, and only when they do something. The row used to mix two word-buttons with
// two icons and render the dead ones greyed out, which made a five-button strip out of
// what is usually two or three live controls. A disabled button is an offer you cannot
// accept: it takes the same space and the same attention as a real one, to tell you no.

/** The devotions heading row, which is the one with data-plain in it. */
const headerRow = () =>
  /<p class="lbl" style="display:flex;justify-content:space-between[\s\S]*?<\/p>/
    .exec(app.innerHTML)?.[0] ?? '';

test('the devotions header carries no button labels, only icons', () => {
  plan([['Cold Damage']], 2);
  const row = headerRow();
  assert.ok(row, 'the header row should render');
  // Every button in it must contain an icon and no text of its own.
  for (const btn of row.match(/<button[\s\S]*?<\/button>/g) ?? []) {
    assert.match(btn, /class="ti ti-/, `a header button has no icon: ${btn.slice(0, 60)}`);
    const text = btn.replace(/<[^>]*>/g, '').trim();
    assert.equal(text, '', `a header button still carries the label "${text}"`);
  }
  // And each one says what it is, for the pointer and for a screen reader.
  for (const btn of row.match(/<button[\s\S]*?>/g) ?? []) {
    assert.match(btn, /title="/, 'a header button has no tooltip');
    assert.match(btn, /aria-label="/, 'a header button has no accessible name');
  }
});

test('no header button is ever rendered disabled', () => {
  plan([['Cold Damage']], 2);
  for (const setup of [
    () => {},
    () => { ui.state.locked = true; },
    () => { ui.state.locked = false; ui.state.done = new Set(); },
  ]) {
    setup(); ui.render();
    assert.doesNotMatch(headerRow(), /disabled/,
      'a disabled header button should be absent, not greyed');
  }
  ui.state.locked = false;
});

test('Clear progress appears only when there is progress to clear', () => {
  plan([['Cold Damage']], 2);
  ui.state.done = new Set();
  ui.render();
  assert.doesNotMatch(headerRow(), /data-resetprogress/, 'nothing to clear, so no button');

  ui.state.done = new Set(ui.pathStarKeys().slice(0, 2));
  ui.render();
  assert.match(headerRow(), /data-resetprogress/, 'progress exists but no way to clear it');

  // Locked, it is not an action you can take, so it is not shown.
  ui.state.locked = true; ui.render();
  assert.doesNotMatch(headerRow(), /data-resetprogress/, 'locked, so it is not actionable');
  ui.state.locked = false;
});

test('the lock lives over the things it freezes, not beside the path', () => {
  // It spent its life in the Devotions header on the right, which was always the wrong
  // side: what it makes read-only is tags, weights, scoring and Reset -- every one of them
  // in the LEFT pane -- and the scrim it draws when engaged falls over that column. The
  // button was sitting apart from the only visible sign of its own effect.
  plan([['Cold Damage']], 2);
  assert.doesNotMatch(headerRow(), /data-lock/, 'the lock should not be in the path header');

  const left = /<p class="lbl"[^>]*>[\s\S]*?Target tags[\s\S]*?<\/p>/.exec(app.innerHTML)?.[0];
  assert.ok(left, 'the Target tags header should render');
  assert.match(left, /data-lock/, 'the lock belongs with what it locks');

  // And it renders OUTSIDE the pane it dims. A control that fades along with everything
  // it disabled is the one control that must not.
  const paneAt = app.innerHTML.indexOf('class="selpane');
  const lockAt = app.innerHTML.indexOf('data-lock');
  assert.ok(lockAt < paneAt,
    'the lock is inside the scrimmed pane, so engaging it dims the way back out');
});

test('Clear order appears only when there is a custom order', () => {
  plan([['Cold Damage'], ['Armor']], 2);
  assert.doesNotMatch(headerRow(), /data-clearorder/,
    'with no custom order there is nothing to clear');

  ui.state.order = ui.currentOrder();
  ui.reorderNow();
  ui.render();
  assert.match(headerRow(), /data-clearorder/, 'a custom order should be clearable');
  ui.state.order = null;
});

test('Adopt is a checkmark and keeps its outline', () => {
  // It is the one consequential action on screen -- it replaces the plan and clears your
  // ticks -- so it should not look like the view toggles beside it.
  withOffPlanBuild();
  const btn = /<button[^>]*data-adopt[\s\S]*?<\/button>/.exec(app.innerHTML)?.[0];
  assert.ok(btn, 'Adopt should render in the comparison');
  assert.match(btn, /ti-check/, 'Adopt should be a checkmark');
  assert.match(btn, /class="[^"]*\badopt\b/, 'Adopt should keep its own class for the outline');
  assert.match(css, /\.adopt\{[^}]*border:/, 'the .adopt rule should still draw a border');
});

test('adopting IS locking, and one Ctrl+Z reverses both', () => {
  // They were two buttons pressed one after the other in every case that mattered, and
  // the gap between them was pure hazard: adopting clears your ticks and hands you a
  // fresh path to walk, which IS the locked workflow, so anyone who adopted and did not
  // think to lock was one stray click from wrecking what they had just committed to.
  withOffPlanBuild();
  const before = [...ui.state.done].sort();
  assert.equal(ui.state.locked, false, 'the fixture should start unlocked');

  click({ adopt: '1' });
  assert.equal(ui.state.done.size, 0, 'adopting should clear the ticks');
  assert.equal(ui.state.locked, true, 'adopting should lock the build it just chose');

  // The button PROMISES Ctrl+Z reverses it. Undo used to be frozen by the lock, which
  // made the promise false in the one case anybody would test.
  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), before, 'undo did not bring the build back');
  assert.equal(ui.state.locked, false, 'undo restored the ticks but left the lock on');
});

test('adopting works while already locked', () => {
  // Exactly when you want it: you lock a build to follow it, play, re-import -- which the
  // lock allows, because that reports facts rather than changing intent -- and find the
  // suggestion has moved. It used to refuse SILENTLY: a live-looking button that took the
  // click and did nothing.
  withOffPlanBuild();
  ui.state.locked = true;
  ui.render();
  assert.match(app.innerHTML, /data-adopt/, 'Adopt should still be offered while locked');

  click({ adopt: '1' });
  assert.equal(ui.state.done.size, 0, 'the lock swallowed a deliberate, labelled action');
  assert.equal(ui.state.locked, true, 'and it should still be locked afterwards');
  ui.state.locked = false;
});

test('undo restores the lock as it was, not merely off', () => {
  // The snapshot carries the lock, so undoing cannot leave it stuck either way.
  plan([['Cold Damage']], 2);
  ui.state.locked = true;
  ui.state.plain = false; ui.render();
  click({ star: /data-star="([^"]+)"/.exec(app.innerHTML)[1] });
  click({ undo: '1' });
  assert.equal(ui.state.locked, true,
    'undoing a tick made while locked should leave the build locked');
  ui.state.locked = false;
});

test('the lock still freezes undo for everything except the adopt itself', () => {
  // The exception has to be narrow. Undo restores a whole snapshot, so one keystroke can
  // reach far past the frontier -- which is the thing the lock exists to stop. Only the
  // adopt that ENGAGED the lock is reachable through it, and only while it is on top.
  withOffPlanBuild();
  click({ adopt: '1' });               // adopts, locks, and is undoable
  assert.equal(ui.state.locked, true);

  // Tick a star while locked. That snapshot is an ordinary one and must stay frozen,
  // even though an adopt is sitting underneath it in the stack.
  ui.state.plain = false; ui.render();
  const star = /data-star="([^"]+)"/.exec(app.innerHTML)?.[1];
  assert.ok(star, 'the adopted plan should be tickable');
  ui.state.lockWarnSeen = true;
  click({ star });
  const afterTick = [...ui.state.done].sort();

  click({ undo: '1' });
  assert.deepEqual([...ui.state.done].sort(), afterTick,
    'undo reached past the lock for a tick made while locked');

  ui.state.locked = false;
});
