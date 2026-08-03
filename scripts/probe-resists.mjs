// Probe: can a character's resistances be derived from their save?
//
// The claim being tested is narrow and falsifiable. Resistances are the one derived stat
// that looks tractable: purely additive flat percentages, no conversions, no weapon
// scaling, no modifier ordering. Everything equipped contributes and the contributions
// just add up.
//
// The one source of error is that affix values are ROLLED. But an affix DBR does not
// store a range -- it stores a single value plus `lootRandomizerJitter`, a percentage.
// So the stored value is the CENTRE and the jitter is the half-width, which means the
// sum of many affixes has a bounded error that partly cancels.
//
// This computes both: the central estimate, and the width of the band it could be in.
// Then you compare to the real character sheet. If the sheet's number falls inside the
// band, the approach works. If it does not, the approach is dead and we found out in a
// session rather than a release.
//
// HOW ITEMS ARE FOUND. Not by parsing the item layout -- that has four more fields than
// iagd's and is not yet pinned down. Instead every byte offset in the equipment tail is
// tried as a string, and anything decoding as a DBR path is collected. Since resistances
// are additive, the SET of equipped records is all this needs; which item a prefix
// belongs to does not change the sum. That is a heuristic, and it is good enough to
// answer "is this worth building properly" but not good enough to ship.
//
// Usage: node scripts/probe-resists.mjs <path-to-player.gdc> <path-to-records-parent>

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCharacter, RESIST_PENALTY, __test } from '../src/lib/gdc.mjs';

const { Reader, readSummary, openBlock, skipNested } = __test;

/**
 * Resistances granted by the devotion stars the character has BOUGHT.
 *
 * Left out of the first pass, and it was the largest error in the model by a wide margin
 * -- Sparkles came out 25 to 58 points low on five resistances at once. Farker hid it
 * completely: nine points, almost all Crossroads, contributing near zero. So the earlier
 * "10 of 10 inside the band" was really "10 of 10 on a character where the missing term
 * happened to be nothing".
 *
 * A devotion planner forgetting to count devotions is embarrassing, but this is the most
 * tractable term in the whole model. Devotion grants are FIXED -- no jitter, nothing
 * rolled -- `devotions.raw.json` carries every stat field, and readCharacter() already
 * returns exactly which stars are owned, keyed by the same DBR path the extract uses.
 */
function devotionResists(bought, rawPath) {
  if (!existsSync(rawPath)) return { totals: {}, stars: [], missing: 'no devotions.raw.json' };
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const byRef = new Map();
  for (const con of raw) for (const st of con.stars) byRef.set(st.ref, { con, st });

  const totals = {};
  const stars = [];
  let unmatched = 0;
  for (const ref of bought) {
    const hit = byRef.get(ref);
    if (!hit) { unmatched++; continue; }
    const parts = [];
    for (const [label, field] of RESISTS) {
      let v = Number(hit.st.stats?.[field] ?? 0);
      if (field === 'defensiveFire' || field === 'defensiveCold' || field === 'defensiveLightning') {
        v += Number(hit.st.stats?.[ELEMENTAL] ?? 0);
      }
      if (!v) continue;
      totals[field] = (totals[field] ?? 0) + v;
      parts.push(`${label} +${v}`);
    }
    if (parts.length) stars.push({ name: `${hit.con.name} ${hit.st.index ?? ''}`.trim(), parts });
  }
  return { totals, stars, unmatched };
}

const savePath = process.argv[2];
const dataRoot = process.argv[3];
const override = process.argv[4]?.toLowerCase();
if (!savePath || !dataRoot) {
  console.error('usage: node scripts/probe-resists.mjs <player.gdc> <records-parent> [difficulty]');
  console.error('       difficulty: normal | elite | ultimate   (default: read from the save)');
  process.exit(1);
}

/** The ten the character sheet shows, with the DBR field that feeds each. */
const RESISTS = [
  ['Fire', 'defensiveFire'],
  ['Cold', 'defensiveCold'],
  ['Lightning', 'defensiveLightning'],
  ['Poison/Acid', 'defensivePoison'],
  ['Pierce', 'defensivePierce'],
  ['Bleeding', 'defensiveBleeding'],
  ['Vitality', 'defensiveLife'],
  ['Aether', 'defensiveAether'],
  ['Chaos', 'defensiveChaos'],
  ['Physical', 'defensivePhysical'],
];

/** Raises fire, cold and lightning together. */
const ELEMENTAL = 'defensiveElementalResistance';

/**
 * The roll half-width for an item that declares none, as a percentage.
 *
 * Read off a real tooltip rather than assumed: a stored 15 displays as [12-18].
 * Where the game gets this constant is not known -- it is in no field of the record.
 */
const DEFAULT_JITTER = 20;

/**
 * Difficulty is READ from the save as a default and OVERRIDABLE by the player.
 *
 * Reading it matters because being wrong puts every resistance out by 25 or 50, which
 * dwarfs the ~2 point error in deriving them from gear and does it silently.
 *
 * Overriding it matters because a character moves freely between difficulties once it
 * has unlocked them, so the stored value is only wherever they last stood -- not a
 * property of the build. And the useful question is often about somewhere they have not
 * been: "will Elite kill me", asked from Veteran, is a question no save can answer.
 *
 * So: default to the fact, let the player ask the counterfactual.
 */

// ---------------------------------------------------------------- read the save

const r = new Reader(readFileSync(savePath));
const summary = readSummary(r);

// The devotion stars this character owns, read by the same code path the app will use.
const character = readCharacter(readFileSync(savePath));
const dev = devotionResists(
  character.devotions,
  join(import.meta.dirname, '../devotions.raw.json'),
);

const inv = openBlock(r);
if (inv.id !== 3) throw new Error(`expected the inventory block, found ${inv.id}`);
r.int(); r.bool();
const sacks = r.int();
r.int(); r.int();
for (let i = 0; i < sacks; i++) skipNested(r);

const tailEnd = inv.start + inv.len;
const save = () => ({ pos: r.pos, key: r.key });
const load = s => { r.pos = s.pos; r.key = s.key; };

const records = [];
while (r.pos < tailEnd) {
  const before = save();
  try {
    const s = r.string();
    if (s.length >= 8 && /^[\x20-\x7e]+$/.test(s) && s.startsWith('records/')) records.push(s);
  } catch { /* not a string here */ }
  load(before);
  r.byte();
}

// ---------------------------------------------------------------- read the DBRs

/** A DBR is `field,value,` lines. Only the first value matters for a flat stat. */
function readDbr(rec) {
  const p = join(dataRoot, rec);
  if (!existsSync(p)) return null;
  const out = {};
  for (const line of readFileSync(p, 'latin1').split('\n')) {
    const i = line.indexOf(',');
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/,\s*$/, '');
  }
  return out;
}

const num = v => {
  const n = Number(String(v ?? '').split(';')[0]);
  return Number.isFinite(n) ? n : 0;
};

const total = Object.fromEntries(RESISTS.map(([, f]) => [f, 0]));
const jitterSq = Object.fromEntries(RESISTS.map(([, f]) => [f, 0]));
const contributors = [];
let missing = 0;

for (const rec of records) {
  const dbr = readDbr(rec);
  if (!dbr) { missing++; continue; }
  // Where a stat's ROLL RANGE comes from, corrected after reading a real tooltip.
  //
  // Affixes declare `lootRandomizerJitter`. Base and quest items declare nothing, and
  // were originally treated as fixed -- which was wrong. Farker's Slith Primal Ring
  // stores defensiveLife 15 and the game shows "13% Vitality Resistance [12-18]": it
  // rolls, the DBR value is the CENTRE of the range, and the half-width is 20%.
  //
  // Components (materia) really are fixed, which the arithmetic confirms rather than
  // assumes: the ring rolled 13 and the sheet reads 23, so the inscription contributed
  // exactly its stored 10.
  const declared = num(dbr.lootRandomizerJitter);
  const isComponent = rec.includes('/materia/');
  const jitter = (declared || (isComponent ? 0 : DEFAULT_JITTER)) / 100;
  const parts = [];

  for (const [label, field] of RESISTS) {
    let v = num(dbr[field]);
    // Elemental resistance raises fire, cold and lightning together.
    if (field === 'defensiveFire' || field === 'defensiveCold' || field === 'defensiveLightning') {
      v += num(dbr[ELEMENTAL]);
    }
    if (!v) continue;
    total[field] += v;
    // Independent errors add in quadrature, not linearly -- that is the whole reason a
    // sum of rolled affixes is tighter than any one of them.
    jitterSq[field] += (v * jitter) ** 2;
    parts.push(`${label} +${v}`);
  }
  if (parts.length) contributors.push({ rec, jitter: jitter * 100, parts });
}

// ---------------------------------------------------------------- report

console.log(`${summary.name} — level ${summary.level}`);
console.log(`${records.length} equipped records, ${missing} not found in the extract\n`);

console.log('--- what contributes ---');
for (const c of contributors) {
  console.log(`  ${c.rec.replace('records/items/', '').padEnd(56)} ${c.parts.join(', ')}`
    + (c.jitter ? `  (±${c.jitter}%)` : '  (fixed)'));
}

/**
 * Character-sheet readings, keyed by name, in sheet order.
 *
 * Ground truth is per character AND per difficulty: a sheet read on Veteran says nothing
 * about the same character on Elite, because the penalty is already baked into what the
 * panel displays. Keyed by name so a save swapped underneath does not get silently
 * compared against the wrong character, which is exactly the mistake available here.
 */
const SHEETS = {
  Farker: [45, 55, 39, 75, 56, 28, 23, 32, 10, 0],
  Sparkles: [80, 80, 80, 4, 30, 71, 33, 80, 80, 6],
};

/**
 * The panel clamps at 80, so a reading of 80 means "80 or more" and can only ever
 * confirm a lower bound. Treating it as an exact figure would score an overcapped
 * character as a miss when the model is right.
 */
const DISPLAY_CAP = 80;
const sheetRow = SHEETS[summary.name];
const SHEET = sheetRow
  ? Object.fromEntries(RESISTS.map(([, f], i) => [f, sheetRow[i]]))
  : null;

/** What a control actually does with a resistance: bucket it. Only threshold crossings matter. */
const weight = v => (v >= 75 ? 0 : v < 45 ? 3 : v < 60 ? 2 : 1);

const fromSave = summary.difficulty.tier;
const difficulty = override ?? fromSave;
const penalty = RESIST_PENALTY[difficulty];
if (penalty === undefined) {
  console.error(`unknown difficulty "${difficulty}" -- expected normal, elite or ultimate`);
  process.exit(1);
}

const source = override && override !== fromSave
  ? `chosen; the save says ${fromSave}${summary.difficulty.veteran ? ' (Veteran)' : ''}`
  : `from the save${summary.difficulty.veteran ? ', Veteran' : ''}`;
console.log(`\n--- from ${character.devotions.length} devotion stars ---`);
if (dev.missing) console.log(`  (${dev.missing})`);
for (const st of dev.stars) console.log(`  ${st.name.padEnd(34)} ${st.parts.join(', ')}`);
if (dev.unmatched) console.log(`  ${dev.unmatched} stars not found in the extract`);

console.log(`\n--- derived, planning for ${difficulty} (${source}; `
  + `${penalty || 'no'} penalty) ---`);
// A sheet reading is only ground truth at the difficulty it was READ on, because the
// penalty is already baked into what the panel displays. Comparing against a projected
// column would report the penalty as error -- a 50-point "miss" that is the model
// working correctly, and exactly the kind of number that gets quoted later without its
// caveat.
const comparable = SHEET && !override;

console.log(`  stat           central  band      ${comparable ? '  sheet  in band  advice' : ''}`);
let inBand = 0, agree = 0, absErr = 0;
for (const [label, field] of RESISTS) {
  const v = total[field] + (dev.totals[field] ?? 0) + penalty;
  const band = Math.sqrt(jitterSq[field]);
  const lo = v - band, hi = v + band;
  let tail = '';
  if (comparable) {
    const real = SHEET[field];
    const ok = real >= Math.floor(lo) && real <= Math.ceil(hi);
    const same = weight(v) === weight(real);
    if (ok) inBand++;
    if (same) agree++;
    absErr += Math.abs(v - real);
    tail = `${String(real).padStart(7)}  ${(ok ? 'yes' : 'NO').padEnd(7)}  `
      + `${weight(v)}/${weight(real)}${same ? '' : '  <-- DIFFERS'}`;
  }
  console.log(`  ${label.padEnd(13)} ${String(Math.round(v)).padStart(6)}  `
    + `${(band ? `${Math.round(lo)}..${Math.round(hi)}` : 'exact').padEnd(10)}${tail}`);
}

if (comparable) {
  console.log(`\n${inBand}/10 inside the band, mean absolute error `
    + `${(absErr / RESISTS.length).toFixed(1)} points`);
  console.log(`advice agrees on ${agree}/10`);
} else if (!SHEET) {
  console.log(`\nNo sheet reading on file for ${summary.name}, so nothing to check this`);
  console.log('against. Add one to SHEETS, read at the difficulty the save reports.');
} else {
  console.log('\nNo comparison: the difficulty was overridden, so the column above is a');
  console.log('projection rather than something the sheet can confirm.');
}
