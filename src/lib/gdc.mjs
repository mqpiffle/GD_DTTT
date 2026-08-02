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
 * Read the parts of a save that come before the inventory.
 *
 * That boundary is not arbitrary: everything here is cheap and sits in the first few
 * hundred bytes, while anything later means parsing the whole inventory and stash to
 * reach it. What this yields is enough to plan against -- who the character is, and how
 * many devotion points they actually have.
 *
 * @returns { name, sex, classId, level, hardcore, bio: {...} }
 */
export function readCharacterSummary(bytes) {
  const r = new Reader(bytes);
  r.begin();

  if (r.int() !== MAGIC) throw new Error('not a Grim Dawn character file');
  const fileVersion = r.int();
  if (fileVersion !== 1) throw new Error(`unsupported file version ${fileVersion}`);

  // --- header ---
  const name = r.wstring();
  const sex = r.byte();
  const classId = r.string();
  const level = r.int();
  const hardcore = r.bool();

  // A zero read WITHOUT advancing the key, then the save version.
  if (r.int({ advance: false }) !== 0) throw new Error('unexpected data after the header');
  const version = r.int();
  if (version !== 6 && version !== 7) throw new Error(`unsupported save version ${version}`);

  r.skipUid();

  // --- character info (block 1) ---
  r.blockStart(1);
  const infoVersion = r.int();
  if (infoVersion !== 3 && infoVersion !== 4) {
    throw new Error(`unsupported character-info version ${infoVersion}`);
  }
  r.bool();            // isInMainQuest
  r.bool();            // hasBeenInGame
  r.byte();            // difficulty
  r.byte();            // greatest campaign difficulty
  const money = r.uint();
  if (infoVersion === 4) {
    r.byte();          // greatest crucible difficulty
    r.int();           // tributes
  }
  r.byte();            // compass state
  r.int();             // loot mode
  r.byte();            // skill window help
  r.byte();            // alternate config
  r.byte();            // alternate config enabled
  r.string();          // texture
  r.blockEnd();

  // --- bio (block 2) ---
  r.blockStart(2);
  const bioVersion = r.int();
  if (bioVersion !== 8) throw new Error(`unsupported bio version ${bioVersion}`);
  const bio = {
    level: r.int(),
    experience: r.int(),
    modifierPoints: r.int(),
    skillPoints: r.int(),
    // The two that matter for planning: what is UNSPENT, and what has been earned in
    // total. Earned is the budget to plan against; unspent is how much of that plan you
    // could act on right now.
    devotionPoints: r.int(),
    totalDevotion: r.int(),
    strength: r.float(),
    agility: r.float(),
    intelligence: r.float(),
    health: r.float(),
    energy: r.float(),
  };
  r.blockEnd();

  return { name, sex, classId, level, hardcore, money, bio, at: r.pos };
}

export const __test = { Reader, MAGIC, XOR_KEY, PRIME };
