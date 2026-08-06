// Emits skills-index.json -- the stats each skill grants AT EACH RANK, so an imported
// save can be read for what its skill points were spent on.
//
// WHY THIS EXISTS. Gear says what a character is equipped for; it cannot say what they
// are BUILT for, because gear is chosen from what dropped. Skill points are not: like
// attribute points, there is no source for them but the player. Measured on a real save,
// the difference is not cosmetic -- Pierce reads 30% on gear (below the threshold, so
// invisible) and 100% once skills are counted, while Elemental falls out of the top four.
// A ranking that ignores skills is ranking half the character.
//
// It is also the last unwired source for resistances, which is the piece the tool still
// owes: gear is read, devotion grants need index data, and skills need this.
//
// PER-RANK ARRAYS ARE THE WHOLE POINT, and the reason this cannot reuse build-items.mjs.
// An item states one value; a skill states one per rank, semicolon-separated:
//
//   offensiveDamageMultModifier,3.0;5.0;7.0;9.0;11.0; ... ;30.0,
//
// build-items.mjs takes `.split(';')[0]` defensively, which for a skill would report rank
// one and silently undercount every invested skill in the game. So the array is kept
// whole and indexed by rank at read time.
//
// WHAT IS KEPT. Only fields belonging to a browsable chip, the same filter the item build
// and the picker apply -- a field mapped differently here than in the picker would propose
// a tag that does not exist. Records where every value is zero are not written: a skill
// template declares hundreds of fields and sets a handful, and the zeros are roughly
// ninety per cent of the bytes.
//
// STILL NOT MODELLED: effective rank. Gear grants +N to skills (`augmentSkillLevel`), and
// a skill at invested rank 12 with +4 from gear is really rank 16. This indexes every
// rank, so the data to do it is here; the reader currently asks for the invested rank
// only, and therefore UNDERCOUNTS. That is the honest direction of the error, and it is
// recorded rather than hidden.
//
// Usage: node scripts/build-skills.mjs <folder containing records/skills>
//        ONLY=skills/playerclass04 node scripts/build-skills.mjs <folder>
//        FRESH=1 node scripts/build-skills.mjs <folder>
//        LIMIT=2000 SKIP=4000 node scripts/build-skills.mjs <folder>
//
// 14,000 records over 300 MB is more than one sitting on a slow filesystem, so a run can
// cover part of the tree and be resumed -- the same merge behaviour build-items.mjs has,
// for the same reason.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? path.join(import.meta.dirname, '../..');
const skillsDir = path.join(ROOT, 'records/skills');

if (!fs.existsSync(skillsDir)) {
  console.error(`no records/skills under ${ROOT}`);
  console.error('usage: node scripts/build-skills.mjs <folder containing records/skills>');
  process.exit(1);
}

const dir = import.meta.dirname;
const kw = JSON.parse(fs.readFileSync(path.join(dir, '../keywords.json'), 'utf8'));

/**
 * DBR field -> chip id, for browsable chips only.
 *
 * CHARACTER ONLY. Pet chips share field names with character ones, and on a skill the
 * distinction is not recoverable from the field: a pet bonus lives in a separate record
 * the skill points at, which nothing here follows. Indexing pet namespaces would let a
 * shared name be read as a pet stat, which is the bug that once reported a two-hander's
 * physical damage as a pet bonus.
 */
const fieldToChip = new Map();
for (const chip of kw.character) {
  if (!chip.browsable) continue;
  for (const f of chip.fields ?? []) fieldToChip.set(f, `character:${chip.id}`);
}
console.log(`${fieldToChip.size} fields map to a browsable character chip`);

/**
 * Trees a player's own skill list can never name, so indexing them is pure weight.
 *
 * `nonplayerskills*` is 4,581 records of monster and summon abilities -- a third of the
 * tree. A save's skill block lists what the CHARACTER has invested in, and that is drawn
 * from the mastery trees and from item-granted skills; nothing in it points here.
 *
 * `devotion` is deliberately NOT excluded even though the planner has its own devotion
 * data, because that data is per-star display text and this is per-star STATS -- which is
 * exactly what the unfinished resistance derivation needs from the devotion side.
 */
const SKIP_TREE = /^nonplayerskills/;

/** Every .dbr under a directory, depth-first. */
function* walk(root, depth = 0) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (depth === 0 && e.isDirectory() && SKIP_TREE.test(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (e.name.endsWith('.dbr')) yield p;
  }
}

const outPath = path.join(dir, '../skills-index.json');
const ONLY = process.env.ONLY ?? '';
const prior = (!process.env.FRESH && fs.existsSync(outPath))
  ? JSON.parse(fs.readFileSync(outPath, 'utf8'))
  : { fields: [], skills: {} };

const fieldNames = [...(prior.fields ?? [])];
const fieldIndex = new Map(fieldNames.map((f, i) => [f, i]));
const idxOf = (f) => {
  if (!fieldIndex.has(f)) { fieldIndex.set(f, fieldNames.length); fieldNames.push(f); }
  return fieldIndex.get(f);
};

const skills = { ...(prior.skills ?? {}) };
let scanned = 0, kept = 0, maxRanks = 0, followed = 0;

/**
 * A TOGGLED BUFF KEEPS ITS STATS SOMEWHERE ELSE, and missing this would have made the
 * whole index quietly wrong in the place it matters most.
 *
 * A skill like Amatok's Pact or Veil of Shadows declares no stats at all. It is
 * `Class,Skill_BuffRadiusToggled` with one pointer:
 *
 *   buffSkillName,records/skills/playerclass10/amatokpact1_buff.dbr,
 *
 * and every number the aura grants lives in that record. Auras are where a build keeps
 * its passive damage, its resistances and -- the thing this whole line of work started
 * from -- its casting speed. Indexing only the named record would have reported those
 * skills as granting nothing, and reported it in a file full of plausible numbers.
 *
 * The buff is folded into the parent rather than left to the reader, because a save's
 * skill list names the SKILL and never the buff. Following it here means the join stays
 * a straight lookup.
 *
 * ONE HOP, and cycles are refused. `petSkillName` is deliberately not followed: those
 * stats belong to a pet, and this index is character-only.
 */
function statsOf(file, depth = 0, seenFiles = new Set()) {
  if (depth > 2 || seenFiles.has(file)) return [];
  seenFiles.add(file);
  const text = fs.readFileSync(file, 'latin1');
  const stats = [];
  let buff = null;

  for (const line of text.split('\n')) {
    const i = line.indexOf(',');
    if (i < 0) continue;
    const key = line.slice(0, i);

    if (key === 'buffSkillName') {
      const p = String(line.slice(i + 1)).split(',')[0].trim();
      if (p) buff = path.join(ROOT, p);
      continue;
    }
    if (!fieldToChip.has(key)) continue;

    const raw = String(line.slice(i + 1)).split(',')[0];
    const vals = raw.split(';').map(Number);
    // A field whose ranks are ALL zero is the template declaring it, not the skill
    // granting it. Those are most of the file.
    if (!vals.length || vals.some(v => !Number.isFinite(v)) || vals.every(v => v === 0)) continue;
    // One decimal is plenty -- these are percentages and flat bonuses, and full float
    // precision would roughly double the file for digits nobody reads.
    const rounded = vals.map(v => Math.round(v * 10) / 10);
    maxRanks = Math.max(maxRanks, rounded.length);
    stats.push(idxOf(key), rounded.length, ...rounded);
  }

  if (buff && fs.existsSync(buff)) {
    if (depth === 0) followed++;
    stats.push(...statsOf(buff, depth + 1, seenFiles));
  }
  return stats;
}

const LIMIT = Number(process.env.LIMIT ?? 0);
const SKIP = Number(process.env.SKIP ?? 0);
let seen = 0;
const started = Date.now();

const roots = ONLY ? [path.join(ROOT, 'records', ONLY)] : [skillsDir];
for (const base of roots) {
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base)) {
    if (SKIP && ++seen <= SKIP) continue;
    if (LIMIT && scanned >= LIMIT) break;
    scanned++;
    if (scanned % 2000 === 0) {
      console.log(`  ${scanned} scanned, ${kept} kept  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    const stats = statsOf(file);

    if (!stats.length) continue;
    kept++;
    // Keys are the bulk of the payload, so the shared prefix goes once. Save files name
    // skills by exactly this path, so the key is the join and must not be reshaped.
    const rec = path.relative(ROOT, file).replace(/\\/g, '/').replace(/^records\//, '');
    skills[rec] = { s: stats };
  }
}

const out = { prefix: 'records/', fields: fieldNames, skills };
fs.writeFileSync(outPath, `${JSON.stringify(out)}\n`);

const size = fs.statSync(outPath).size;
console.log(`scanned ${scanned} records this run, kept ${kept}; ${Object.keys(skills).length} in the index`);
console.log(`${fieldNames.length} distinct fields used, longest rank list ${maxRanks}`);
console.log(`${followed} records had their toggled buff folded in`);
console.log(`skills-index.json: ${(size / 1024).toFixed(1)} KB`);
