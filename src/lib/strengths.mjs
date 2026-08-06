// What a character is BUILT FOR, read off the gear they are wearing.
//
// The question this answers is not "what did you mean to build" -- a save cannot know
// that -- but "what is this character actually for", which the gear states plainly.
//
// WHY GEAR AND NOT SKILLS. The obvious signal is the character's skills, and it is the
// wrong one: an item converting physical damage to fire makes a skill's declared damage
// type simply false, which is what sank an earlier attempt at this. Gear does not have
// that problem, and the reason is worth stating because it is not obvious. Conversions
// happen upstream of gearing choices. Nobody stacks +110% Lightning Damage unless
// lightning is what they end up dealing, so the percentages on the gear already describe
// the post-conversion reality. The signal that looked blocked was never affected.
//
import { BODY_DAMAGE_TYPES } from './fields.mjs';

// Measured across three real characters:
//
//   Farker (34)       Cold +184%  Frostburn +104%  Elemental +55% | cliff | Pierce +30%
//   Sparkles (80)     Lightning +1072%  Electrocute +844% | cliff | Cold +104%
//   Chphthzhmh (100)  Lightning +255%  Electrocute +255%  Physical +232%  Trauma +232%

/**
 * A strength has to be worth this fraction of the biggest one to count.
 *
 * A FRACTION, NOT A FIXED COUNT, and that is the whole point. "Take the top five" fills
 * empty slots with noise: Sparkles' Cold at 104% against a Lightning of 1072% is a stray
 * affix on a piece worn for something else, and the solver would dutifully spend points
 * chasing it. At this threshold she gets two and Farker gets three, which is what those
 * characters actually are.
 *
 * It earns its keep only on lopsided builds. Chphthzhmh's spread is flat -- 255, 255,
 * 232, 232, 190 -- so everything clears the bar and he gets five. That is not a failure:
 * every one of his resistances is overcapped, so he has nothing to shore up and five
 * damage tags is the honest answer.
 *
 * Same shape as the resistance equaliser ignoring anything at or above its target. A
 * control is allowed to come back with two.
 */
export const STRENGTH_THRESHOLD = 0.25;

/**
 * Only PERCENTAGE modifiers count towards a strength.
 *
 * A flat `offensiveLightningMin` of +8 is a rounding error on an endgame weapon and says
 * nothing about intent. `offensiveLightningModifier` of +110% is a deliberate choice and
 * says everything. Mixing them would let a pile of small flat rolls outvote the stat the
 * character is built around.
 */
const MODIFIER = /Modifier$/;

/**
 * ONLY DAMAGE TYPES ARE RANKED, and this is the conclusion of four measured attempts
 * rather than a simplification.
 *
 * The first version summed every percentage modifier and put Movement Speed +35% in the
 * same sort as Physical Damage +92%. Those are not the same kind of number: +35% movement
 * speed is enormous for that stat, +35% damage is modest. Two other metrics were tried
 * against real characters and each had its own bias:
 *
 *   sum of every modifier   biased by SCALE      -- speed percentages dwarf damage ones
 *   count of items          biased by COMMONNESS -- armour rolls movement speed by default,
 *                                                  so it led on a character not built for it
 *   count / base rate       measures UNUSUAL, not INTENTIONAL
 *
 * The third is the instructive failure. A player deliberately building for casting speed
 * scored exactly 1.0x -- statistically unremarkable -- because a stat can be both common
 * and wanted. No count-based metric can separate those.
 *
 * Restricting to damage types fixes it, and the reason is that percentages were never the
 * problem: MIXING KINDS was. Within damage types the numbers are commensurable, so summing
 * is sound.
 *
 * Everything else a player deliberately pursues -- casting speed, attack speed, armour,
 * attributes -- is what the PRESETS exist for. Those are intent, and intent is the thing
 * only the player can supply.
 *
 * Note the category is not enough: `Offense` also holds offensive ability, attack speed
 * and crit damage, none of which are damage types. The test is the field name.
 */
const DAMAGE_TYPE = /^offensive([A-Za-z]+)Modifier$/;

/** The game's damage types, shared with the keyword pipeline so the two cannot drift. */
const DEFAULT_DAMAGE_TYPES = new Set(BODY_DAMAGE_TYPES);

/**
 * Fields that end in Modifier but are not a strength.
 *
 * `Chance` and `Duration` variants modify when or how long something applies rather than
 * how much of it there is, so they do not belong in a ranking of what a build is for.
 */
const NOT_A_STRENGTH = /(Chance|Duration)/;

/**
 * Build the field -> chip lookup an item tally needs, from keywords.json.
 *
 * CHARACTER WINS OVER PET, and this is not a tie-break -- it is a correctness rule. The
 * two namespaces share field names: `offensivePhysicalModifier` names both a character
 * chip and a pet one. But a pet bonus does not sit on the item, it sits in a separate
 * record the item points at, which nothing here reads. So every field found ON an item is
 * a character stat by construction.
 *
 * Getting this backwards is not a subtle failure. Iterating character then pet and
 * letting the later write win reported a physical-damage two-hander's biggest stat as a
 * PET bonus, which would have proposed a pet tag to a character with no pets.
 */
export function chipMapper(keywords) {
  const map = new Map();
  for (const chip of keywords?.character ?? []) {
    if (!chip.browsable) continue;
    for (const f of chip.fields ?? []) map.set(f, `character:${chip.id}`);
  }
  return field => map.get(field) ?? null;
}

/**
 * Sum every stat an equipped character carries, by DBR field.
 *
 * @param records  DBR paths from `equippedRecords()`
 * @param index    a parsed items-index.json
 * @returns { totals, jitter, sources, missing }
 *
 * `missing` names records the index does not know, which is reported rather than
 * swallowed -- an item silently contributing nothing is the failure mode that looks like
 * a working feature.
 *
 * `sources` is field -> the set of records granting it. HOW MANY ITEMS carry a stat is a
 * different question from how much they carry, and the two disagree in the case that
 * matters: one enormous roll looks identical to a stat the whole build is assembled
 * around. Sets rather than counts because a chip can be fed by several fields, and the
 * same item granting two of them must not count twice.
 */
export function tallyGear(records, index) {
  const totals = new Map();
  const jitter = new Map();
  const sources = new Map();
  const missing = [];
  const prefix = index?.prefix ?? 'records/';
  const fields = index?.fields ?? [];

  for (const rec of records ?? []) {
    const key = rec.startsWith(prefix) ? rec.slice(prefix.length) : rec;
    const entry = index?.items?.[key];
    // A record with no chip-mapped stat is absent by design, not lost -- a plain medal
    // whose only stat is bonus experience, say. Only report what we cannot account for.
    if (!entry) { if (!index?.items) missing.push(rec); continue; }
    const s = entry.s ?? [];
    for (let i = 0; i < s.length; i += 2) {
      const field = fields[s[i]];
      if (!field) continue;
      totals.set(field, (totals.get(field) ?? 0) + s[i + 1]);
      // Only a POSITIVE contribution counts as a source. A negative roll is the item
      // arguing against the stat, and counting it as evidence for it would be perverse.
      if (s[i + 1] > 0) {
        if (!sources.has(field)) sources.set(field, new Set());
        sources.get(field).add(key);
      }
      // Errors on independent rolls add in quadrature, so the band on a sum is much
      // tighter than on any one item.
      const half = (s[i + 1] * (entry.j ?? 0)) / 100;
      jitter.set(field, (jitter.get(field) ?? 0) + half * half);
    }
  }
  return { totals, jitter, sources, missing };
}

/**
 * Sum every stat a character's SKILLS grant, at the rank each is invested to.
 *
 * WHY THIS IS NOT OPTIONAL. Gear is chosen from what dropped; skill points are not. They
 * are, with attribute points, the only thing in a save the player wrote themselves -- and
 * on a real character they change the answer rather than decorating it. Measured: Pierce
 * reads 30% on gear, below the threshold and therefore invisible, and 100% once skills
 * are counted. Elemental falls out of the top four. Ranking on gear alone ranks half the
 * character.
 *
 * RANKS ARE CLAMPED, NOT INTERPOLATED. A skill's values are listed per rank; a level past
 * the end of the list takes the last one. That happens for real -- gear grants +N to
 * skills, so an invested rank 12 can be played at 16 -- and the last value is the honest
 * reading of a list that has run out.
 *
 * A single value with no rank list is a constant: it applies whatever the rank.
 *
 * @param skills  from `readCharacter()` -- [{ name, level }], names as record paths
 * @param index   a parsed skills-index.json
 * @returns { totals, sources, missing } in the same shape `tallyGear()` returns, so the
 *          two can be merged without either knowing about the other.
 */
export function tallySkills(skills, index) {
  const totals = new Map();
  const sources = new Map();
  const missing = [];
  const prefix = index?.prefix ?? 'records/';
  const fields = index?.fields ?? [];

  for (const sk of skills ?? []) {
    if (!(sk?.level > 0)) continue;
    const key = sk.name?.startsWith(prefix) ? sk.name.slice(prefix.length) : sk.name;
    const entry = index?.skills?.[key];
    // Most unmatched records are skills that genuinely grant the character nothing --
    // the default attacks, a shapeshift whose stats apply only while transformed, a
    // modifier that alters another skill rather than you. Reported, never guessed at.
    if (!entry) { missing.push(sk.name); continue; }

    const s = entry.s ?? [];
    for (let i = 0; i < s.length;) {
      const field = fields[s[i]];
      const n = s[i + 1];
      if (!Number.isInteger(n) || n < 1) break;   // malformed; stop rather than misread
      const at = i + 2 + Math.min(sk.level, n) - 1;
      const value = s[at];
      i += 2 + n;
      if (!field || !value) continue;
      totals.set(field, (totals.get(field) ?? 0) + value);
      // A SKILL IS A SOURCE, like an item. Points spent on it are a vote for the stat,
      // and a more deliberate one than a roll that happened to land on a helmet.
      if (value > 0) {
        if (!sources.has(field)) sources.set(field, new Set());
        sources.get(field).add(key);
      }
    }
  }
  return { totals, sources, missing };
}

/**
 * Merge two tallies into one, so the ranking sees the whole character.
 *
 * Totals add. Sources UNION -- they are sets of record keys and the two tallies draw from
 * different trees, so nothing can collide. Written once here rather than at the call site
 * because merging sources by adding their sizes is the obvious wrong thing, and it would
 * be invisible: the counts would just come out a little high.
 */
export function mergeTallies(...tallies) {
  const totals = new Map();
  const sources = new Map();
  for (const t of tallies) {
    for (const [f, v] of t?.totals ?? []) totals.set(f, (totals.get(f) ?? 0) + v);
    for (const [f, set] of t?.sources ?? []) {
      if (!sources.has(f)) sources.set(f, new Set());
      for (const k of set) sources.get(f).add(k);
    }
  }
  return { totals, sources };
}

/**
 * How many separate sources a stat must appear on to be taken seriously.
 *
 * OCCURRENCES QUALIFY, PERCENTAGES RANK, and the split is because the two numbers answer
 * different questions. A sum says how much; a count says how deliberate. One item with a
 * huge roll and a stat the whole kit is assembled around look identical in a sum, and
 * only the count tells them apart -- a build is a pattern across slots, and a pattern
 * needs more than one point to exist.
 *
 * Why not rank by the count as well: with twelve slots the counts run 1 to 3, and at that
 * range a fractional threshold cuts nothing. Measured on Farker, ranking by count kept ALL
 * NINE damage types, because a one-item stat is 0.33x of a three-item leader. The
 * percentages have the dynamic range; the counts have the meaning. Use each for what it
 * is good at.
 *
 * SET DELIBERATELY LOW. Two is "more than once", which is the whole claim being made. Any
 * higher and it stops being a sanity check and starts being an opinion about how many
 * slots a real build devotes to a stat -- and on a character wearing three set pieces and
 * a relic, that opinion would be wrong.
 */
export const MIN_SOURCES = 2;

/**
 * Rank what the character is built for, as chips.
 *
 * @param totals   from `tallyGear()`
 * @param chipOf   field -> chip id (from the same mapping the picker uses)
 * @param opts.sources    from `tallyGear()` -- field -> set of records granting it.
 *                        Omit it and every stat qualifies, which is the old behaviour
 *                        and is what the pure-unit tests want.
 * @param opts.threshold  fraction of the leader a strength must reach
 * @returns [{ chip, value, share, items }] strongest first, already cut
 */
export function strengths(totals, chipOf, {
  sources = null,
  minSources = MIN_SOURCES,
  threshold = STRENGTH_THRESHOLD,
  damageTypes = DEFAULT_DAMAGE_TYPES,
} = {}) {
  const byChip = new Map();
  // Records per CHIP, unioned across every field feeding it. An item granting two fields
  // of the same chip is one item, not two -- counting it twice would let a single piece
  // qualify a stat on its own, which is the exact thing this is here to stop.
  const chipSources = new Map();
  for (const [field, value] of totals ?? []) {
    if (!MODIFIER.test(field) || NOT_A_STRENGTH.test(field)) continue;
    const m = DAMAGE_TYPE.exec(field);
    if (!m || !damageTypes.has(m[1])) continue;
    const chip = chipOf?.(field);
    if (!chip) continue;
    byChip.set(chip, (byChip.get(chip) ?? 0) + value);
    if (sources) {
      if (!chipSources.has(chip)) chipSources.set(chip, new Set());
      for (const rec of sources.get(field) ?? []) chipSources.get(chip).add(rec);
    }
  }

  const itemsFor = chip => (sources ? (chipSources.get(chip)?.size ?? 0) : null);
  const ranked = [...byChip.entries()]
    .filter(([chip, v]) => v > 0 && (!sources || itemsFor(chip) >= minSources))
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];

  // The leader is the biggest QUALIFYING stat, not the biggest overall. Measuring the
  // share against something that was itself disqualified would let a single freak roll
  // set the bar and quietly cut everything below it.
  const lead = ranked[0][1];
  return ranked
    .map(([chip, value]) => ({ chip, value, share: value / lead, items: itemsFor(chip) }))
    .filter(s => s.share >= threshold);
}

// --- attribute allocation ---------------------------------------------------------
//
// ATTRIBUTE POINTS ARE THE ONLY PURE STATEMENT OF INTENT IN A SAVE, and reading gear
// while ignoring them had this exactly backwards.
//
// Every other signal is contaminated by what dropped. Gear is chosen from what you found;
// a helmet worn for its resistances brings its casting speed along whether you wanted it
// or not. Farker's gear grants 23% casting speed and 15% attack speed -- both small, both
// incidental, and neither says which the character is for. His attribute allocation is
// 0 Physique, 0 Cunning, 26 Spirit. Nothing dropped that. Every one of those points was
// spent on purpose, and they are unanimous.
//
// So this is not another opinion to average in with the gear. It is the one number in the
// file that the player wrote themselves.

/** Attributes start at 50 and each point spent adds 8. Verified: Farker's 26 + 7 unspent
 *  is 33, and a level 34 character has earned exactly level - 1. */
const ATTR_BASE = 50;
const ATTR_PER_POINT = 8;

/**
 * The share one attribute must hold to count as a decision.
 *
 * A LOPSIDED allocation is a build statement; a spread one is someone meeting a gear
 * requirement. 12/10/11 means "I needed to wear the helmet", and proposing devotion
 * points chase attributes off the back of that would be inventing intent that is not
 * there. Farker's 0/0/26 is 100% and says its piece loudly.
 */
export const ATTRIBUTE_FOCUS = 0.7;

/**
 * Too few points to mean anything, however they are split.
 *
 * The first few levels have almost nothing to allocate, so an early character trivially
 * reads as 100% focused on whichever attribute they touched first. That is not a
 * decision, it is a sample size.
 */
const ATTRIBUTE_MINIMUM = 10;

const ATTRIBUTE_CHIP = {
  physique: 'character:characterStrength',
  cunning: 'character:characterDexterity',
  spirit: 'character:characterIntelligence',
};

/**
 * Which attribute a character has committed to, if any.
 *
 * @param bio  from `readCharacter()` -- base physique/cunning/spirit, before mastery,
 *             gear and devotion are added on. The BASE values are the point: the sheet's
 *             numbers include everything the character is wearing, which would put the
 *             contamination straight back in.
 * @returns `{ chip, points, share, label }` or null. Null is the common answer and the
 *          right one: most characters spread their points.
 */
export function attributeFocus(bio) {
  const spent = {
    physique: Math.round(((bio?.physique ?? ATTR_BASE) - ATTR_BASE) / ATTR_PER_POINT),
    cunning: Math.round(((bio?.cunning ?? ATTR_BASE) - ATTR_BASE) / ATTR_PER_POINT),
    spirit: Math.round(((bio?.spirit ?? ATTR_BASE) - ATTR_BASE) / ATTR_PER_POINT),
  };
  const total = spent.physique + spent.cunning + spent.spirit;
  if (!(total >= ATTRIBUTE_MINIMUM)) return null;

  const [key, points] = Object.entries(spent).sort((a, b) => b[1] - a[1])[0];
  const share = points / total;
  if (share < ATTRIBUTE_FOCUS) return null;
  return { chip: ATTRIBUTE_CHIP[key], points, share, label: key };
}
