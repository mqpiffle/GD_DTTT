// Read a Grim Dawn character save (`player.gdc`).
//
// Ported from Item Assistant for Grim Dawn (MIT) -- `Parser/Stash/GDCryptoDataBuffer.cs`
// for the cipher and `Parser/Character/*.cs` for the block layout. See THIRD-PARTY.md.
//
// WHAT MAKES THIS FIDDLY: the file is a stream cipher whose key mutates with every value
// read, so nothing can be skipped or seeked to. Reaching a field means parsing every
// byte before it, in order, correctly. That is why this arrives in stages rather than
// as one reader: the header and bio come early and give the point budget, while the
// devotions a character has actually bought sit behind the whole inventory, the stash
// and five list blocks.
//
// The cipher: a 32-bit key read from the first four bytes XORed with 0x55555555, plus a
// 256-entry table derived from it. Every value read XORs against the current key, and
// the key then advances by XORing in the table entry for each byte just consumed. So
// reading is destructive, and reading the WRONG WIDTH silently desynchronises everything
// after it rather than failing where the mistake was.

const XOR_KEY = 0x55555555;
const TABLE_SIZE = 256;
const PRIME = 39916801;

/** `GDCX` as a little-endian uint32: the file's magic number. */
const MAGIC = 0x58434447;

class Reader {
  constructor(bytes) {
    this.data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.pos = 0;
    this.key = 0;
    this.table = new Uint32Array(TABLE_SIZE);
  }

  get remaining() { return this.data.length - this.pos; }

  /** Raw little-endian uint32, no decryption and no key change. */
  rawUint() {
    if (this.remaining < 4) throw new Error('unexpected end of file');
    const d = this.data;
    const v = (d[this.pos] | (d[this.pos + 1] << 8) | (d[this.pos + 2] << 16)
      | (d[this.pos + 3] << 24)) >>> 0;
    this.pos += 4;
    return v;
  }

  /**
   * The key advances by XORing in the table entry for each byte CONSUMED -- the
   * still-encrypted bytes, not the decrypted ones. Getting that backwards produces a
   * reader that works for exactly one field.
   */
  advance(bytes) {
    for (const b of bytes) this.key = (this.key ^ this.table[b]) >>> 0;
  }

  advanceUint(v) {
    this.advance([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  }

  /** Read the seed and build the table. Must be the first thing read. */
  begin() {
    let key = (this.rawUint() ^ XOR_KEY) >>> 0;
    this.key = key;
    for (let i = 0; i < TABLE_SIZE; i++) {
      key = ((key >>> 1) | (key << 31)) >>> 0;
      key = Math.imul(key, PRIME) >>> 0;
      this.table[i] = key;
    }
  }

  uint({ advance = true } = {}) {
    const raw = this.rawUint();
    const v = (raw ^ this.key) >>> 0;
    if (advance) this.advanceUint(raw);
    return v;
  }

  int({ advance = true } = {}) { return this.uint({ advance }) | 0; }

  byte() {
    if (this.remaining < 1) throw new Error('unexpected end of file');
    const raw = this.data[this.pos++];
    const v = (raw ^ this.key) & 0xff;
    this.advance([raw]);
    return v;
  }

  bool() { return this.byte() === 1; }

  float() {
    const v = this.uint();
    const buf = new ArrayBuffer(4);
    new Uint32Array(buf)[0] = v;
    return new Float32Array(buf)[0];
  }

  /**
   * A length-prefixed byte string.
   *
   * Note the key advance is interleaved with decryption here rather than done after:
   * each byte is decrypted against the CURRENT key and then advances it, so a batch
   * advance at the end would decrypt every byte after the first with a stale key.
   */
  string() {
    const len = this.uint();
    if (!len) return '';
    if (this.remaining < len) throw new Error('unexpected end of file reading a string');
    let out = '';
    for (let i = 0; i < len; i++) {
      const raw = this.data[this.pos++];
      out += String.fromCharCode((raw ^ this.key) & 0xff);
      this.key = (this.key ^ this.table[raw]) >>> 0;
    }
    return out;
  }

  /** UTF-16-ish: the game writes two bytes per character. */
  wstring() {
    const len = this.uint();
    if (!len) return '';
    let out = '';
    for (let i = 0; i < len; i++) {
      const lo = this.byte();
      const hi = this.byte();
      out += String.fromCharCode(lo | (hi << 8));
    }
    return out;
  }

  /**
   * Block headers carry their own length, which is read WITHOUT advancing the key.
   * That is not an optimisation: the length field is excluded from the key stream, so
   * advancing on it desynchronises the rest of the file.
   */
  blockStart(expected) {
    const version = this.int();
    const length = this.int({ advance: false });
    if (version !== expected) {
      throw new Error(`expected block ${expected}, found ${version}`);
    }
    return length;
  }

  blockEnd() {
    if (this.int({ advance: false }) !== 0) throw new Error('block did not end where expected');
  }

  skipUid() { for (let i = 0; i < 16; i++) this.byte(); }
}

/**
 * Skip a block whose contents we do not need to understand.
 *
 * This is the single most useful thing the format gives us. A block header carries its
 * own byte length, measured from just after the length field to the end marker --
 * verified against a real save on blocks 1 and 2, where the count lands exactly.
 *
 * So a block whose layout has changed between game versions costs nothing as long as we
 * do not want anything inside it. Character info is version 5 in a Fangs of Asterkarn
 * save against the 3 or 4 iagd knows about, and it is skipped here rather than parsed,
 * which means that change cannot break anything.
 *
 * The bytes must still be READ one at a time: the key advances per byte, so seeking past
 * them would desynchronise everything after.
 */
function skipBlock(r, len) {
  const end = r.pos + len;
  if (end > r.data.length) throw new Error('block length runs past the end of the file');
  while (r.pos < end) r.byte();
}

/**
 * Read the parts of a save that come before the inventory.
 *
 * That boundary is not arbitrary: everything here is cheap and sits in the first few
 * hundred bytes, while anything later means parsing the whole inventory and stash to
 * reach it. What this yields is enough to plan against -- who the character is, and how
 * many devotion points they actually have.
 *
 * VERSIONS. Checked against a real Fangs of Asterkarn save, which is where the numbers
 * below come from; iagd's parser predates it and expects the older ones:
 *
 *   file version   2   (iagd: 1)  -- and version 2 adds a byte after `hardcore`
 *   save version   8   (iagd: 6 or 7)
 *   info block     5   (iagd: 3 or 4)  -- skipped by length, so its layout is moot
 *   bio block      8   unchanged, and the reason this works at all
 *
 * The older values are still accepted. Nothing here needs them, but rejecting a save
 * this code could read would be a gratuitous way to fail.
 *
 * VERIFIED against that save with the game open beside it: name, level, unspent
 * attribute points, unspent skill points, money, and both devotion numbers all match
 * what the character sheet shows.
 *
 * The attributes need a word, because they look wrong. They are BASE values -- Farker
 * reads 82/98/146 where the sheet says 387/434/305, because the sheet adds mastery
 * bars, gear and devotion on top. The base numbers check out through the game's own
 * arithmetic instead: attributes start at 50 and each point adds 8, so 4 + 6 + 12
 * points are spent, and with 5 unspent that is 27 -- exactly what a level 28 character
 * has earned. Health and energy are base figures for the same reason.
 *
 * @returns { name, sex, classId, level, hardcore, bio: {...} }
 */
export function readCharacterSummary(bytes) {
  const r = new Reader(bytes);
  r.begin();

  if (r.int() !== MAGIC) throw new Error('not a Grim Dawn character file');
  const fileVersion = r.int();
  if (fileVersion !== 1 && fileVersion !== 2) {
    throw new Error(`unsupported file version ${fileVersion}`);
  }

  // --- header ---
  const name = r.wstring();
  const sex = r.byte();
  const classId = r.string();
  const level = r.int();
  const hardcore = r.bool();
  // One byte that version 1 did not have. Found by walking forward a byte at a time
  // from `hardcore` looking for the zero marker: at +1 it appears, and the save version
  // behind it reads as 8. Its meaning is unknown and unneeded.
  if (fileVersion >= 2) r.byte();

  // A zero read WITHOUT advancing the key, then the save version.
  if (r.int({ advance: false }) !== 0) throw new Error('unexpected data after the header');
  const version = r.int();
  if (version < 6 || version > 8) throw new Error(`unsupported save version ${version}`);

  r.skipUid();

  // --- character info (block 1): skipped whole ---
  // Nothing in it is wanted, and its layout has already changed once.
  const infoBlock = r.int();
  if (infoBlock !== 1) throw new Error(`expected the character-info block, found ${infoBlock}`);
  skipBlock(r, r.int({ advance: false }));
  r.blockEnd();

  // --- bio (block 2) ---
  const bioBlock = r.int();
  if (bioBlock !== 2) throw new Error(`expected the bio block, found ${bioBlock}`);
  const bioLen = r.int({ advance: false });
  const bioStart = r.pos;
  const bioVersion = r.int();
  if (bioVersion !== 8) throw new Error(`unsupported bio version ${bioVersion}`);
  const bio = {
    level: r.int(),
    experience: r.int(),
    // "Modifier points" in the file, attribute points in the game.
    attributePoints: r.int(),
    skillPoints: r.int(),
    // The two that matter for planning: what is UNSPENT, and what has been earned in
    // total. Earned is the budget to plan against; unspent is how much of that plan you
    // could act on right now.
    devotionPoints: r.int(),
    totalDevotion: r.int(),
    physique: r.float(),
    cunning: r.float(),
    spirit: r.float(),
    health: r.float(),
    energy: r.float(),
  };
  // The block declares its own size, so a field added or removed in a future version
  // shows up here as a mismatch rather than as plausible nonsense further downstream.
  if (r.pos - bioStart !== bioLen) {
    throw new Error(`bio block is ${bioLen} bytes but ${r.pos - bioStart} were read`);
  }
  r.blockEnd();

  return { name, sex, classId, level, hardcore, fileVersion, version, bio, at: r.pos };
}

export const __test = { Reader, MAGIC, XOR_KEY, PRIME, skipBlock };
