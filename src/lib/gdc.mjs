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
 *
 * ONLY SAFE FOR A FLAT BLOCK. This is the rule that cost the most to find, so it is
 * worth stating plainly: a block-length field and an end marker are read WITHOUT
 * advancing the key. Skipping a block byte by byte therefore advances the key over
 * bytes the game excluded from the key stream -- eight of them for every nested block
 * inside.
 *
 * Blocks 1 (character info) and 2 (bio) are flat, so this works. Block 3 (inventory)
 * holds three nested sacks, and skipping it flat over-advanced the key by 24 bytes,
 * which desynchronised the entire rest of the file. Confirmed by parsing the sacks as
 * blocks instead: block 3 then lands on its end marker exactly.
 *
 * So a container has to be walked, not skipped. What it does NOT need is any
 * understanding of its contents -- each nested block is itself skipped by length. The
 * inventory needs only version, allGood, numSacks, focused, selected, then three nested
 * blocks, then a flat run of equipment.
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
  return readSummary(r);
}

/**
 * The header and bio, from a reader positioned at the very start.
 *
 * Split out so `readCharacter` can carry on from where this stops. The reader's
 * position and key ARE the parse state -- there is no seeking back -- so anything that
 * reads further has to continue from the same reader rather than start a new one.
 */
function readSummary(r) {
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


/** Open a block: returns its id, declared length, and where the payload starts. */
function openBlock(r) {
  const id = r.int();
  const len = r.int({ advance: false });
  if (len < 0 || r.pos + len > r.data.length) {
    throw new Error(`block ${id} claims ${len} bytes, which runs past the end of the file`);
  }
  return { id, len, start: r.pos };
}

/** Run to a block's declared end and consume its marker. */
function closeBlock(r, b) {
  while (r.pos < b.start + b.len) r.byte();
  if (r.int({ advance: false }) !== 0) {
    throw new Error(`block ${b.id} did not end where its length said`);
  }
}

/** A nested block whose contents are of no interest. */
function skipNested(r) {
  closeBlock(r, openBlock(r));
}

/**
 * Walk from the bio to the skill list, which is where devotions live.
 *
 * Every block between here and there is skipped, but two of them are CONTAINERS and
 * cannot be skipped flat -- see skipBlock() for why nested blocks break a byte-by-byte
 * skip. Both need only their own header fields read; their nested blocks are then
 * skipped by length, so no item is ever parsed.
 *
 *   3  inventory  version, allGood, numSacks, focused, selected, then N sack blocks,
 *                 then a flat equipment tail
 *   4  stash      version, numTabs, then N tab blocks
 *   5  respawn    flat        6  teleport   flat
 *   7  markers    flat       17  shrines    flat
 *   8  SKILLS     what we came for
 */
function walkToSkills(r) {
  const inv = openBlock(r);
  if (inv.id !== 3) throw new Error(`expected the inventory block, found ${inv.id}`);
  r.int();                       // version
  r.bool();                      // allGood
  const sacks = r.int();
  r.int(); r.int();              // focused, selected
  for (let i = 0; i < sacks; i++) skipNested(r);
  closeBlock(r, inv);            // the equipment tail is flat

  const stash = openBlock(r);
  if (stash.id !== 4) throw new Error(`expected the stash block, found ${stash.id}`);
  r.int();                       // version
  const tabs = r.int();
  for (let i = 0; i < tabs; i++) skipNested(r);
  closeBlock(r, stash);

  // Four flat lists. Their ids are checked rather than assumed, because arriving at the
  // wrong block is the symptom of a desynchronised key and it should say so here rather
  // than produce nonsense skills.
  for (const expect of [5, 6, 7, 17]) {
    const b = openBlock(r);
    if (b.id !== expect) throw new Error(`expected block ${expect}, found ${b.id}`);
    closeBlock(r, b);
  }

  const skills = openBlock(r);
  if (skills.id !== 8) throw new Error(`expected the skill block, found ${skills.id}`);
  return skills;
}

/**
 * Every skill the character has a record for, devotions included.
 *
 * A skill is: name (a DBR path), level, enabled, then a fixed 15-byte tail and two
 * strings. iagd's tail is 14 bytes; Fangs of Asterkarn added one. Found by reading a
 * name, then scanning forward a byte at a time for the offset at which the NEXT value
 * decodes as a string beginning "records/" -- 23 bytes, of which 8 are the two empty
 * strings, leaving 15.
 *
 * `level` is what matters: a devotion star is 1 when bought and 0 when not, and the
 * levels of the devotion entries sum to the points spent.
 */
function readSkills(r, block) {
  const version = r.int();
  if (version !== 8) throw new Error(`unsupported skill-block version ${version}`);
  const count = r.int();
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = r.string();
    const level = r.int();
    const enabled = r.byte() === 1;
    for (let k = 0; k < 15; k++) r.byte();
    r.string();                  // autocast skill
    r.string();                  // autocast controller
    out.push({ name, level, enabled });
  }
  // The block runs on past the skills -- iagd has a commented-out item-skill section
  // there. Nothing needs it, and stopping short is fine because the caller does not
  // read anything after.
  return out;
}

const DEVOTION_PREFIX = 'records/skills/devotion/';

/**
 * A character's summary plus the devotion stars they have actually bought.
 *
 * The stars come back as DBR paths, which is deliberate: `devotions.raw.json` stores
 * exactly the same string as each star's `ref`, so matching a save onto the planner's
 * stars is a lookup rather than a matching problem.
 *
 * VERIFIED against a real save. Farker, level 28, has 12 devotion records of which 9
 * are at level 1, summing to the 9 points the game reports as spent. Reconstructing
 * affinity from the completed constellations gives 1 ascendant and 6 primordial, which
 * is exactly what the devotion screen shows.
 */
export function readCharacter(bytes) {
  const r = new Reader(bytes);
  const summary = readSummary(r);
  const block = walkToSkills(r);
  const skills = readSkills(r, block);
  const devotions = skills
    .filter(s => s.name.startsWith(DEVOTION_PREFIX) && s.level > 0)
    .map(s => s.name);
  return { ...summary, devotions, skills };
}

export const __test = { Reader, MAGIC, XOR_KEY, PRIME, skipBlock, walkToSkills, readSkills };
