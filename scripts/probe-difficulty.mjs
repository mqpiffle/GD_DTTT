// Probe: is the character's difficulty readable out of block 1?
//
// Block 1 (character info) is currently skipped whole -- "nothing in it is wanted, and
// its layout has already changed once". Difficulty is wanted now, as a DEFAULT that the
// player can then override.
//
// The block is skipped by its declared length, so parsing part of it is safe: get what
// is needed off the front, then run to the end marker as before. A future layout change
// past the fields we read costs nothing.
//
// Usage: node scripts/probe-difficulty.mjs <path-to-player.gdc>

import { readFileSync } from 'node:fs';
import { __test } from '../src/lib/gdc.mjs';

const { Reader, openBlock } = __test;

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/probe-difficulty.mjs <path-to-player.gdc>');
  process.exit(1);
}

const r = new Reader(readFileSync(path));

// The header, inlined rather than reused, because readSummary() runs straight past
// block 1 and this needs to stop inside it.
r.begin();
r.int();                             // magic
const fileVersion = r.int();
const name = r.wstring();
r.byte();                            // sex
const classId = r.string();
const level = r.int();
const hardcore = r.bool();
if (fileVersion >= 2) r.byte();
r.int({ advance: false });           // the zero marker
const version = r.int();
r.skipUid();

const info = openBlock(r);
if (info.id !== 1) throw new Error(`expected the character-info block, found ${info.id}`);

console.log(`${name} — level ${level}, ${classId}, hardcore=${hardcore}`);
console.log(`file v${fileVersion}, save v${version}, info block v? (${info.len} bytes)\n`);

// Dump the front of the block as bytes AND as ints, since a difficulty flag is a byte
// and the surrounding fields are not. Reading both interpretations of the same run is
// impossible, so this reads bytes -- an int shows up as four of them, which is legible
// enough for a field this small.
const save = () => ({ pos: r.pos, key: r.key });
const load = s => { r.pos = s.pos; r.key = s.key; };

const before = save();
const infoVersion = r.int();
console.log(`info block version: ${infoVersion}`);

const bytes = [];
for (let i = 0; i < 24 && r.pos < info.start + info.len; i++) bytes.push(r.byte());
console.log(`next 24 bytes: ${bytes.join(' ')}`);

load(before);
r.int();
const ints = [];
for (let i = 0; i < 6 && r.pos < info.start + info.len; i++) ints.push(r.int());
console.log(`same run as ints: ${ints.join(' ')}`);

console.log('\nGrim Dawn difficulties are Normal=0, Elite=1, Ultimate=2, with Veteran a');
console.log('separate flag on Normal rather than a tier of its own -- and no resistance');
console.log('penalty, so Normal and Veteran share a 0 penalty.');
console.log('Farker is on Veteran, so difficulty should read 0 and a veteran flag 1.');
