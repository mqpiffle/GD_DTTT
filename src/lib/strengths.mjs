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
 * @returns { totals, jitter, missing } -- `missing` names records the index does not
 *          know, which is reported rather than swallowed. An item silently contributing
 *          nothing is the failure mode that looks like a working feature.
 */
export function tallyGear(records, index) {
  const totals = new Map();
  const jitter = new Map();
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
      // Errors on independent rolls add in quadrature, so the band on a sum is much
      // tighter than on any one item.
      const half = (s[i + 1] * (entry.j ?? 0)) / 100;
      jitter.set(field, (jitter.get(field) ?? 0) + half * half);
    }
  }
  return { totals, jitter, missing };
}

/**
 * Rank what the character is built for, as chips.
 *
 * @param totals   from `tallyGear()`
 * @param chipOf   field -> chip id (from the same mapping the picker uses)
 * @param opts.threshold  fraction of the leader a strength must reach
 * @returns [{ chip, value, share }] strongest first, already cut at the threshold
 */
export function strengths(totals, chipOf, {
  threshold = STRENGTH_THRESHOLD,
  damageTypes = DEFAULT_DAMAGE_TYPES,
} = {}) {
  const byChip = new Map();
  for (const [field, value] of totals ?? []) {
    if (!MODIFIER.test(field) || NOT_A_STRENGTH.test(field)) continue;
    const m = DAMAGE_TYPE.exec(field);
    if (!m || !damageTypes.has(m[1])) continue;
    const chip = chipOf?.(field);
    if (!chip) continue;
    byChip.set(chip, (byChip.get(chip) ?? 0) + value);
  }
  const ranked = [...byChip.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];

  const lead = ranked[0][1];
  return ranked
    .map(([chip, value]) => ({ chip, value, share: value / lead }))
    .filter(s => s.share >= threshold);
}
