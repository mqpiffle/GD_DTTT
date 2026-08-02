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
import { __test } from '../src/lib/gdc.mjs';

const { Reader, readSummary, openBlock, skipNested } = __test;

const savePath = process.argv[2];
const dataRoot = process.argv[3];
if (!savePath || !dataRoot) {
  console.error('usage: node scripts/probe-resists.mjs <player.gdc> <folder-containing-records>');
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

// ---------------------------------------------------------------- read the save

const r = new Reader(readFileSync(savePath));
const summary = readSummary(r);

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
  const jitter = num(dbr.lootRandomizerJitter) / 100;
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

console.log('\n--- derived resistances ---');
console.log('  stat           central   band          sheet says');
for (const [label, field] of RESISTS) {
  const v = total[field];
  const band = Math.sqrt(jitterSq[field]);
  const lo = Math.round(v - band);
  const hi = Math.round(v + band);
  console.log(`  ${label.padEnd(13)}  ${String(Math.round(v)).padStart(5)}   `
    + `${band ? `${lo}..${hi}`.padEnd(12) : 'exact'.padEnd(12)}  ?`);
}
console.log('\nCompare the last column against the character sheet. Note the sheet also');
console.log('includes any difficulty penalty (Veteran 0, Elite -25, Ultimate -50) and');
console.log('anything granted by skills, neither of which is counted above.');
