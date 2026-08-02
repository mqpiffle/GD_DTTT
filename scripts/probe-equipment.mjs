// Probe: what does the equipment tail of block 3 look like?
//
// Block 3 is currently skipped whole. Its tail (after the sacks) holds the EQUIPPED
// items, which is where resistances come from. The layout of an item record is not
// documented anywhere we trust, so rather than assume one, this DUMPS the token stream
// and lets the shape show itself.
//
// The trick that makes exploration possible: a Reader's whole state is `pos` plus a
// 32-bit `key` (the table is fixed once seeded). So it can be snapshotted and restored,
// which means we can PEEK -- try reading a string, and if it decodes as garbage, rewind
// and read an int instead. Without that, one wrong guess desynchronises the rest of the
// file and there is no way back.
//
// Usage: node scripts/probe-equipment.mjs <path-to-player.gdc> [tokens]

import { readFileSync } from 'node:fs';
import { __test } from '../src/lib/gdc.mjs';

const { Reader, readSummary, openBlock, skipNested } = __test;

const path = process.argv[2];
const limit = Number(process.argv[3] ?? 60);
if (!path) {
  console.error('usage: node scripts/probe-equipment.mjs <path-to-player.gdc> [tokens]');
  process.exit(1);
}

const r = new Reader(readFileSync(path));
const summary = readSummary(r);
console.log(`${summary.name} — level ${summary.level}, ${summary.classId}`);

const inv = openBlock(r);
if (inv.id !== 3) throw new Error(`expected the inventory block, found ${inv.id}`);
const version = r.int();
const allGood = r.bool();
const sacks = r.int();
r.int(); r.int();                    // focused, selected
for (let i = 0; i < sacks; i++) skipNested(r);

const tailStart = r.pos;
const tailEnd = inv.start + inv.len;
console.log(`\ninventory v${version}, allGood=${allGood}, ${sacks} sacks`);
console.log(`equipment tail: ${tailEnd - tailStart} bytes at ${tailStart}..${tailEnd}\n`);

const save = () => ({ pos: r.pos, key: r.key });
const load = s => { r.pos = s.pos; r.key = s.key; };

/** Does this decode as a plausible DBR path or tag rather than noise? */
const looksLikeText = s => s.length > 0 && /^[\x20-\x7e]+$/.test(s);

/**
 * Read one token, preferring a string when the bytes support it.
 *
 * A length that is small and followed by printable ASCII is overwhelmingly a string:
 * DBR paths are long and start "records/". Anything else is reported as an int, which
 * is what the numeric fields (seeds, counts, flags) will show up as.
 */
function token() {
  const before = save();
  try {
    const len = r.uint();
    if (len === 0) return { kind: 'str', value: '', bytes: 4 };
    if (len <= 200 && r.remaining >= len) {
      load(before);
      const s = r.string();
      if (looksLikeText(s)) return { kind: 'str', value: s, bytes: 4 + s.length };
    }
  } catch { /* fall through to int */ }
  load(before);
  const v = r.int();
  return { kind: 'int', value: v, bytes: 4 };
}

// Mode B: dump the token stream from a given offset, to read off the field layout.
if (process.env.FROM) {
  const skip = Number(process.env.FROM);
  for (let i = 0; i < skip; i++) r.byte();
  let n = 0;
  while (r.pos < tailEnd && n < limit) {
    const at = r.pos - tailStart;
    const t = token();
    const shown = t.kind === 'str'
      ? (t.value === '' ? '""' : `"${t.value.replace('records/items/', '')}"`)
      : t.value;
    console.log(`${String(n).padStart(3)}  @${String(at).padStart(5)}  ${t.kind.padEnd(3)}  ${shown}`);
    n++;
  }
  process.exit(0);
}

// Scan EVERY byte offset in the tail, trying to decode a string at each.
//
// This is the brute-force answer to "the layout is not what I assumed". The key advances
// deterministically from the raw bytes, so walking a byte at a time keeps it correct at
// every offset, and a snapshot lets each offset be tried without committing to it. A DBR
// path is long and unmistakable, so a real one cannot be a coincidence.
const hits = [];
while (r.pos < tailEnd) {
  const at = r.pos - tailStart;
  const before = save();
  try {
    const s = r.string();
    if (s.length >= 8 && looksLikeText(s) && s.includes('/')) hits.push({ at, s });
  } catch { /* not a string here */ }
  load(before);
  r.byte();
}

console.log(`${hits.length} decodable paths in the tail\n`);
for (const h of hits.slice(0, limit)) {
  console.log(`@${String(h.at).padStart(5)}  "${h.s}"`);
}
if (hits.length > limit) console.log(`... and ${hits.length - limit} more`);
