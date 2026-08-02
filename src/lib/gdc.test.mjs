// Tests for the .gdc reader.
//
// WHAT THESE CAN AND CANNOT PROVE. They build a file with a writer that is the inverse
// of the reader, then read it back. That proves the reader is self-consistent: that the
// key advances in the right places, that a length-prefixed string does not desynchronise
// the stream, that the fields are read in the order the code claims. It does NOT prove
// the format matches what Grim Dawn actually writes -- a reader and writer that are
// wrong in the same direction round-trip perfectly. Only a real save can settle that,
// which is why one is being asked for separately.
//
// The reason self-consistency is worth testing at all: the cipher's key mutates on every
// read, so a field read at the wrong width does not fail where the mistake is. It
// silently corrupts everything after it, and the first visible symptom is a nonsense
// value hundreds of bytes downstream.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readCharacterSummary, __test } from './gdc.mjs';

const { MAGIC, XOR_KEY, PRIME } = __test;

/** The reader's inverse, used only to build fixtures. */
class Writer {
  constructor(seed = 0x1234abcd) {
    this.out = [];
    this.key = seed >>> 0;
    this.table = new Uint32Array(256);
    let k = seed >>> 0;
    this.pushRaw((seed ^ XOR_KEY) >>> 0);
    for (let i = 0; i < 256; i++) {
      k = ((k >>> 1) | (k << 31)) >>> 0;
      k = Math.imul(k, PRIME) >>> 0;
      this.table[i] = k;
    }
  }

  pushRaw(v) {
    this.out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }

  advance(bytes) { for (const b of bytes) this.key = (this.key ^ this.table[b]) >>> 0; }

  uint(v, { advance = true } = {}) {
    const raw = ((v >>> 0) ^ this.key) >>> 0;
    this.pushRaw(raw);
    if (advance) this.advance([raw & 0xff, (raw >>> 8) & 0xff, (raw >>> 16) & 0xff, (raw >>> 24) & 0xff]);
    return this;
  }

  int(v, opts) { return this.uint(v >>> 0, opts); }

  byte(v) {
    const raw = (v ^ this.key) & 0xff;
    this.out.push(raw);
    this.advance([raw]);
    return this;
  }

  bool(v) { return this.byte(v ? 1 : 0); }

  float(v) {
    const buf = new ArrayBuffer(4);
    new Float32Array(buf)[0] = v;
    return this.uint(new Uint32Array(buf)[0]);
  }

  string(s) {
    this.uint(s.length);
    for (const ch of s) {
      const raw = (ch.charCodeAt(0) ^ this.key) & 0xff;
      this.out.push(raw);
      this.key = (this.key ^ this.table[raw]) >>> 0;
    }
    return this;
  }

  wstring(s) {
    this.uint(s.length);
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      this.byte(c & 0xff);
      this.byte((c >>> 8) & 0xff);
    }
    return this;
  }

  bytes() { return Uint8Array.from(this.out); }
}

/** A save whose header and bio are valid, with everything after them omitted. */
function buildSave(over = {}) {
  const o = {
    name: 'Tangie', sex: 1, classId: 'tagCharacterClass01', level: 42, hardcore: false,
    saveVersion: 7, infoVersion: 4, money: 12345,
    devotionPoints: 7, totalDevotion: 23,
    ...over,
  };
  const w = new Writer();
  w.int(MAGIC).int(1);
  w.wstring(o.name).byte(o.sex).string(o.classId).int(o.level).bool(o.hardcore);
  w.int(0, { advance: false }).int(o.saveVersion);
  for (let i = 0; i < 16; i++) w.byte(i);          // uid

  w.int(1).int(0, { advance: false });             // block 1 start: version, length
  w.int(o.infoVersion);
  w.bool(true).bool(true).byte(2).byte(3);
  w.uint(o.money);
  if (o.infoVersion === 4) { w.byte(1); w.int(99); }
  w.byte(1).int(2).byte(1).byte(0).byte(0).string('tex.tex');
  w.int(0, { advance: false });                    // block end

  w.int(2).int(0, { advance: false });             // block 2 start
  w.int(8);                                        // bio version
  w.int(o.level).int(1000000).int(4).int(12);
  w.int(o.devotionPoints).int(o.totalDevotion);
  w.float(700.5).float(400.25).float(300).float(9999.5).float(1234.5);
  w.int(0, { advance: false });                    // block end
  return w.bytes();
}

test('reads a character header and bio', () => {
  const c = readCharacterSummary(buildSave());
  assert.equal(c.name, 'Tangie');
  assert.equal(c.classId, 'tagCharacterClass01');
  assert.equal(c.level, 42);
  assert.equal(c.hardcore, false);
  assert.equal(c.money, 12345);
  assert.equal(c.bio.level, 42);
  assert.equal(c.bio.devotionPoints, 7);
  assert.equal(c.bio.totalDevotion, 23);
  assert.equal(Math.round(c.bio.health), 10000);
});

test('the two devotion numbers are distinct and both survive', () => {
  // They mean different things and are adjacent in the file, so a one-field slip swaps
  // them silently. Earned is the budget to plan against; unspent is what you can act on
  // now. A reader that returned the same number for both would look plausible.
  const c = readCharacterSummary(buildSave({ devotionPoints: 3, totalDevotion: 41 }));
  assert.equal(c.bio.devotionPoints, 3);
  assert.equal(c.bio.totalDevotion, 41);
});

test('a name of any length keeps the stream in sync', () => {
  // Strings are length-prefixed and decrypted byte by byte, each advancing the key. A
  // batch advance would work for an empty name and drift for every other one, so the
  // failure would appear as a wrong LEVEL rather than a wrong name.
  for (const name of ['', 'A', 'Bob', 'Aurelia the Twice-Burned', 'x'.repeat(60)]) {
    const c = readCharacterSummary(buildSave({ name, level: 77 }));
    assert.equal(c.name, name, `name "${name}" did not round-trip`);
    assert.equal(c.level, 77, `a ${name.length}-character name desynchronised the stream`);
    assert.equal(c.bio.totalDevotion, 23, `a ${name.length}-character name corrupted the bio`);
  }
});

test('both character-info versions parse', () => {
  // Version 4 carries two extra fields. Reading them when they are absent, or skipping
  // them when they are present, shifts everything after by five bytes.
  for (const infoVersion of [3, 4]) {
    const c = readCharacterSummary(buildSave({ infoVersion, totalDevotion: 55 }));
    assert.equal(c.bio.totalDevotion, 55, `info version ${infoVersion} desynchronised the bio`);
  }
});

test('both save versions parse', () => {
  for (const saveVersion of [6, 7]) {
    const c = readCharacterSummary(buildSave({ saveVersion, level: 12 }));
    assert.equal(c.level, 12);
  }
});

test('a file that is not a save is rejected at the magic number', () => {
  // Rejecting loudly matters more here than usual: the cipher turns any four bytes into
  // a plausible-looking integer, so without this check a JPEG parses as a character
  // with a nonsensical level rather than failing.
  const junk = new Uint8Array(200);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 7) & 0xff;
  assert.throws(() => readCharacterSummary(junk), /not a Grim Dawn character file/);
});

test('a truncated file fails rather than returning half a character', () => {
  const full = buildSave();
  assert.throws(() => readCharacterSummary(full.slice(0, 40)), /unexpected end of file|not a Grim Dawn/);
});

test('an unsupported version is named in the error', () => {
  assert.throws(() => readCharacterSummary(buildSave({ saveVersion: 9 })), /unsupported save version 9/);
  assert.throws(() => readCharacterSummary(buildSave({ infoVersion: 2 })),
    /unsupported character-info version 2/);
});
