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
import { readCharacterSummary, readCharacter, RESIST_PENALTY, __test } from './gdc.mjs';

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

  /**
   * Open a block, reserving its length field.
   *
   * The length cannot be known until the payload is written, and it is encrypted with
   * the key as it stands right here -- so the key is captured and the four bytes are
   * patched in `endBlock`. Building the payload with a separate writer does not work:
   * writing the block id advances the key, so a payload encrypted beforehand decrypts
   * to noise. That mistake produced a fixture that failed where the real save passed.
   */
  beginBlock(id) {
    this.int(id);
    const keyAtLen = this.key;          // written with advance:false, so the key holds
    const lenPos = this.out.length;
    this.int(0, { advance: false });    // placeholder
    return { lenPos, keyAtLen, start: this.out.length };
  }

  endBlock(h) {
    const len = this.out.length - h.start;
    const raw = ((len >>> 0) ^ h.keyAtLen) >>> 0;
    this.out[h.lenPos] = raw & 0xff;
    this.out[h.lenPos + 1] = (raw >>> 8) & 0xff;
    this.out[h.lenPos + 2] = (raw >>> 16) & 0xff;
    this.out[h.lenPos + 3] = (raw >>> 24) & 0xff;
    this.int(0, { advance: false });    // end marker
    return this;
  }

  bytes() { return Uint8Array.from(this.out); }
}

/** A save whose header and bio are valid, with everything after them omitted. */
function buildSave(over = {}) {
  const o = {
    name: 'Tangie', sex: 1, classId: 'tagCharacterClass01', level: 42, hardcore: false,
    fileVersion: 2, saveVersion: 8, infoVersion: 5, money: 12345,
    difficultyByte: 2,                               // ultimate, Veteran flag clear
    devotionPoints: 7, totalDevotion: 23,
    ...over,
  };
  const w = new Writer();
  w.int(MAGIC).int(o.fileVersion);
  w.wstring(o.name).byte(o.sex).string(o.classId).int(o.level).bool(o.hardcore);
  if (o.fileVersion >= 2) w.byte(7);               // the byte version 2 added
  w.int(0, { advance: false }).int(o.saveVersion);
  for (let i = 0; i < 16; i++) w.byte(i);          // uid

  // Block 1's FRONT is now parsed -- difficulty, and money as the field that proves the
  // offsets. Everything after money is still skipped by declared length, so the trailing
  // junk here is deliberate: the reader must not care what is in it.
  const info = w.beginBlock(1);
  w.int(o.infoVersion).bool(true).bool(true).byte(o.difficultyByte).byte(3).uint(o.money)
   .byte(1).int(2).byte(1).byte(0).byte(0).string('tex.tex');
  w.endBlock(info);

  const bio = w.beginBlock(2);
  w.int(8);                                        // bio version
  w.int(o.level).int(1000000).int(4).int(12);
  w.int(o.devotionPoints).int(o.totalDevotion);
  w.float(700.5).float(400.25).float(300).float(9999.5).float(1234.5);
  w.endBlock(bio);
  return w.bytes();
}

test('splits the difficulty byte into a tier and the Veteran flag', () => {
  // Veteran is a flag ON normal rather than a tier, so 0x10 must read as normal with the
  // flag set -- not as some fourth difficulty. Farker's save reads exactly 16.
  const vet = readCharacterSummary(buildSave({ difficultyByte: 0x10 }));
  assert.equal(vet.difficulty.tier, 'normal');
  assert.equal(vet.difficulty.veteran, true);

  // The flag must not leak into the tier when a higher difficulty carries it.
  const eliteVet = readCharacterSummary(buildSave({ difficultyByte: 0x11 }));
  assert.equal(eliteVet.difficulty.tier, 'elite');
  assert.equal(eliteVet.difficulty.veteran, true);

  const plain = readCharacterSummary(buildSave({ difficultyByte: 2 }));
  assert.equal(plain.difficulty.tier, 'ultimate');
  assert.equal(plain.difficulty.veteran, false);
});

test('the resistance penalty is what makes difficulty worth reading', () => {
  // Being wrong here costs 25 or 50 points on every resistance, which dwarfs the ~2
  // point error in deriving them from gear, and does it silently.
  assert.equal(RESIST_PENALTY.normal, 0);
  assert.equal(RESIST_PENALTY.elite, -25);
  assert.equal(RESIST_PENALTY.ultimate, -50);
  // Veteran is NOT a penalty tier: tougher enemies, same resistances.
  const vet = readCharacterSummary(buildSave({ difficultyByte: 0x10 }));
  assert.equal(RESIST_PENALTY[vet.difficulty.tier], 0);
});

test('reads a character header and bio', () => {
  const c = readCharacterSummary(buildSave());
  assert.equal(c.name, 'Tangie');
  assert.equal(c.classId, 'tagCharacterClass01');
  assert.equal(c.level, 42);
  assert.equal(c.hardcore, false);
  // Money is what proves the character-info offsets are right. Difficulty alone is a
  // small number that could be almost anything; money is checkable against the game.
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

test('the character-info block is skipped whole, whatever version it claims', () => {
  // Its layout has already changed once -- a Fangs of Asterkarn save says version 5,
  // where iagd knows 3 and 4 -- so the reader skips it by its declared length and never
  // looks inside. Any version must therefore reach the bio unharmed.
  for (const infoVersion of [3, 4, 5, 99]) {
    const c = readCharacterSummary(buildSave({ infoVersion, totalDevotion: 55 }));
    assert.equal(c.bio.totalDevotion, 55, `info version ${infoVersion} desynchronised the bio`);
  }
});

test('both file versions parse, including the byte version 2 added', () => {
  for (const fileVersion of [1, 2]) {
    const c = readCharacterSummary(buildSave({ fileVersion, level: 31 }));
    assert.equal(c.level, 31, `file version ${fileVersion} desynchronised the header`);
    assert.equal(c.bio.totalDevotion, 23, `file version ${fileVersion} desynchronised the bio`);
  }
});

test('every known save version parses', () => {
  for (const saveVersion of [6, 7, 8]) {
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
  assert.throws(() => readCharacterSummary(buildSave({ fileVersion: 3 })), /unsupported file version 3/);
});

// --- against a real save ------------------------------------------------------
// Everything above proves the reader is self-consistent. This is the only test that
// can show the format is right, and it runs only where a save happens to be sitting.
// Skipped rather than failed when absent: the file is someone's character and has no
// business in the repository.

import fs from 'node:fs';
import path from 'node:path';

const REAL = path.join(import.meta.dirname, '../../../player.gdc');

test('a real save reads with plausible values', { skip: !fs.existsSync(REAL) && 'no player.gdc alongside the repo' }, () => {
  const c = readCharacterSummary(fs.readFileSync(REAL));

  assert.ok(c.name.length > 0 && c.name.length < 40, `implausible name ${JSON.stringify(c.name)}`);
  assert.match(c.classId, /^tag/, `class id does not look like a tag: ${c.classId}`);
  assert.ok(c.level >= 1 && c.level <= 100, `level ${c.level} is outside 1-100`);
  assert.equal(c.level, c.bio.level, 'the header and the bio disagree about the level');

  // The devotion cap is 55 and points are earned from shrines, so anything outside
  // this is a desynchronised read rather than an unusual character.
  assert.ok(c.bio.totalDevotion >= 0 && c.bio.totalDevotion <= 55,
    `${c.bio.totalDevotion} devotion points earned is outside 0-55`);
  assert.ok(c.bio.devotionPoints >= 0 && c.bio.devotionPoints <= c.bio.totalDevotion,
    `${c.bio.devotionPoints} unspent of ${c.bio.totalDevotion} earned is impossible`);

  // Attributes are BASE values, not what the character sheet shows: the sheet adds
  // mastery bars, gear and devotion on top. Farker reads 82/98/146 against a displayed
  // 387/434/305, and that is correct rather than broken.
  //
  // What makes them checkable anyway is the game's own arithmetic. Every attribute
  // starts at 50 and each point spent adds exactly 8, so (value - 50) / 8 must be a
  // whole number -- and the total spent, plus the unspent points, must equal what a
  // character of this level has earned: one per level from 2 onward.
  //
  // Nothing in the parser knows about that relationship, so it is a genuinely
  // independent check. On Farker it closes exactly: 4 + 6 + 12 spent, 5 unspent, 27
  // earned at level 28.
  let spent = 0;
  for (const [k, v] of Object.entries({ physique: c.bio.physique, cunning: c.bio.cunning, spirit: c.bio.spirit })) {
    assert.ok(v >= 50 && v < 10000, `${k} of ${v} is outside a plausible range`);
    const points = (v - 50) / 8;
    assert.ok(Number.isInteger(points),
      `${k} of ${v} is not 50 plus a whole number of 8-point steps, so it is not a base attribute`);
    spent += points;
  }
  const earned = spent + c.bio.attributePoints;
  assert.ok(earned >= c.level - 1 && earned <= c.level + 12,
    `${spent} attribute points spent and ${c.bio.attributePoints} unspent is ${earned}, `
    + `which a level ${c.level} character could not have earned`);

  assert.ok(c.bio.health > 0 && c.bio.energy > 0, 'health and energy should be positive');
});

test('a real save yields the devotions the character has bought', { skip: !fs.existsSync(REAL) && 'no player.gdc alongside the repo' }, () => {
  const c = readCharacter(fs.readFileSync(REAL));

  assert.ok(c.skills.length > 0, 'no skills parsed at all');
  assert.ok(c.skills.every(s => s.name.startsWith('records/')),
    'a skill name is not a record path, so the skill records are misaligned');

  // The count is checkable against the bio, which is parsed hundreds of bytes earlier
  // and by completely separate code. A devotion star is level 1 when bought, so the
  // number bought must equal the points the bio says are spent.
  const spent = c.bio.totalDevotion - c.bio.devotionPoints;
  assert.equal(c.devotions.length, spent,
    `${c.devotions.length} devotion stars bought but the bio says ${spent} points are spent`);
  assert.ok(c.devotions.every(d => d.startsWith('records/skills/devotion/')));
});

test('the devotions map onto the planner\'s own stars', { skip: !fs.existsSync(REAL) && 'no player.gdc alongside the repo' }, () => {
  // The whole reason the stars come back as DBR paths: devotions.raw.json stores the
  // same string as each star's `ref`, so this is a lookup rather than a matching
  // problem. If that ever stops being true, import breaks here rather than silently
  // importing nothing.
  const rawPath = path.join(import.meta.dirname, '../../devotions.raw.json');
  if (!fs.existsSync(rawPath)) return;   // raw extract is gitignored; skip where absent
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const byRef = new Map();
  for (const con of raw) for (const st of con.stars) byRef.set(st.ref, { con, st });

  const c = readCharacter(fs.readFileSync(REAL));
  for (const d of c.devotions) {
    assert.ok(byRef.has(d), `no star in devotions.raw.json matches ${d}`);
  }

  // And the strongest check available: rebuild the character's AFFINITY from the stars
  // and compare it with the game. Affinity lands only on a completed constellation, so
  // this exercises the star-to-constellation mapping, the completion rule and the grant
  // table at once -- none of which the parser knows anything about.
  //
  // Keyed by constellation ID, not name: the five Crossroads all display as
  // "Crossroads", and keying by name silently merges them. That cost an ascendant point
  // and looked like a parse error.
  const taken = new Map();
  for (const d of c.devotions) {
    const { con } = byRef.get(d);
    taken.set(con.id, (taken.get(con.id) ?? 0) + 1);
  }
  const held = {};
  for (const [id, n] of taken) {
    const con = raw.find(x => x.id === id);
    if (n < con.starCount) continue;      // partial takes grant nothing
    for (const [k, v] of Object.entries(con.granted ?? {})) held[k] = (held[k] ?? 0) + v;
  }
  const total = Object.values(held).reduce((a, b) => a + b, 0);
  assert.ok(total > 0, 'no affinity reconstructed; the completion rule is not firing');
  assert.ok(total <= c.bio.totalDevotion,
    `${total} affinity from ${c.bio.totalDevotion} points earned is impossible`);
});
