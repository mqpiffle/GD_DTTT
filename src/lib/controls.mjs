// Controls: ways of turning a character into target tags.
//
// The idea is that the tool should not decide what you want. A character supplies facts
// -- what it is, what it lacks -- and a CONTROL supplies intent. Tags fall out of the
// pair. "All out damage" and "shore up my resistances" are different answers from the
// same character, and only you know which you meant.
//
// A control is a pure function returning weighted tags, which then land in the picker
// where you can argue with them. It proposes; it never replaces what you chose.
//
// NO CONTROL ASKS FOR ANYTHING ANY MORE, and the history is worth keeping because the
// reasoning that led here was wrong twice.
//
// The first version of this file said deriving resistances would mean reimplementing the
// game's RNG, because affix values are rolled per item from a seed. That is false: a
// record stores a single value plus a jitter percentage, so the stored value IS the
// expected roll. The RNG is needed for one item's exact number, never for a sum.
//
// So the equaliser asked nine questions it did not need to ask, and it is gone. What it
// taught -- the sheet's own resistance order, the elemental collapse, the 45/60/75
// thresholds -- is below and still used. See DERIVED-STATS-PROBE.md on the derive-stats
// branch for the measurements.

/** The picker's limit, and therefore the budget every control shares. */
export const MAX_TAGS = 5;

/**
 * Resistance soft cap.
 *
 * 80% is the hard maximum, but the practical target players aim for is 75-80 before
 * overcapping for reductions. A resistance at or above this is not worth devotion
 * points, so it is not proposed at all.
 */
const RESIST_TARGET = 75;

/**
 * The game's resistance readout, in the order the character sheet shows it, mapped to
 * the tag that would raise it.
 *
 * Fire, cold and lightning all map to ELEMENTAL RESISTANCE, because that is the only
 * chip the devotion tree offers -- there is no separate Fire Resistance tag. That has a
 * consequence worth knowing: the three are treated as one, and the weakest of them
 * drives the weighting, since elemental resistance raises all three together.
 *
 * PHYSICAL IS NOT HERE, and its absence is deliberate -- see below.
 */
export const RESISTS = [
  { key: 'fire', label: 'Fire', tag: 'character:defensiveElementalResistance' },
  { key: 'cold', label: 'Cold', tag: 'character:defensiveElementalResistance' },
  { key: 'lightning', label: 'Lightning', tag: 'character:defensiveElementalResistance' },
  { key: 'acid', label: 'Poison/Acid', tag: 'character:defensivePoison' },
  { key: 'pierce', label: 'Pierce', tag: 'character:defensivePierce' },
  { key: 'bleeding', label: 'Bleeding', tag: 'character:defensiveBleeding' },
  { key: 'vitality', label: 'Vitality', tag: 'character:defensiveLife' },
  { key: 'aether', label: 'Aether', tag: 'character:defensiveAether' },
  { key: 'chaos', label: 'Chaos', tag: 'character:defensiveChaos' },
];

/**
 * PHYSICAL RESISTANCE IS EXCLUDED, and the reason is measured rather than a matter of
 * taste.
 *
 * It is not that the thresholds below are miscalibrated for it. It is that physical is
 * not a stat this tree can move:
 *
 *   physical    16 stars    58% available in the whole tree    median 4 per star
 *   vitality    18 stars   254%                                median 15
 *   elemental   17 stars   223%                                median 15
 *   acid        10 stars   147%                                median 15
 *
 * Plenty of stars grant it, in useless amounts. A real build might scrape 8-12% out of
 * devotions. So flagging a low physical resistance would propose a fix that does not
 * exist -- and it flagged DIRE on all three characters tested, including one at 0, which
 * is entirely normal at level 34.
 *
 * It is also the one resistance exempt from difficulty penalties, so it does not behave
 * like the others in any respect.
 *
 * Where it actually belongs is with armour and defensive ability in the TURTLE control --
 * a defensive stat you nudge rather than a hole you plug -- and its real source is gear,
 * shields especially. It remains pickable by hand like any other chip; what stops is this
 * code asserting something it cannot know.
 */
export const EXCLUDED_RESIST = 'character:defensivePhysical';

/**
 * How badly a resistance wants attention: 3 is dire, 0 is fine.
 *
 * Exported so the import proposal uses this judgement rather than a second copy of these
 * thresholds. Two versions of "what counts as dire" would drift, and
 * the drift would be invisible -- both would keep producing plausible numbers.
 */
export const resistWeightOf = value => resistWeight(value);

function resistWeight(value) {
  if (value >= RESIST_TARGET) return 0;
  if (value < 45) return 3;
  if (value < 60) return 2;
  return 1;
}

const t = (tag, weight) => ({ tag, weight });

/**
 * THE RESISTANCE EQUALISER IS GONE, and its absence is the point.
 *
 * It asked for nine numbers off the character sheet. Once resistances are read from a
 * save there is nothing to ask -- a control that puts nine questions to you in order to
 * tell you something it could have worked out is worse than no control at all. A
 * hand-built character simply picks the resistance tags directly.
 *
 * What it taught survives and is still used by propose.mjs: `RESISTS` (the sheet's own
 * order, with fire, cold and lightning collapsed onto the single chip the tree offers)
 * and `resistWeightOf` (the 45/60/75 thresholds). Deleting those and writing a second
 * copy elsewhere would let two versions of "what counts as dire" drift apart, and the
 * drift would be invisible because both would keep producing plausible numbers.
 *
 * PRESETS STILL STACK HERE. `applyControls()` combines any number of them, merging on
 * the higher weight. Only the UI shows one at a time, and that is a simplification we
 * agreed to rather than a limit of the model -- combining "shore up my resistances" with
 * "push what I already have" was the common case, and the code for it is kept.
 */
export const CONTROLS = [
  {
    id: 'meta-offense',
    label: 'Meta offense',
    blurb: 'The numbers that make every attack better rather than any one of them: '
      + 'landing hits, landing them often, and hurting when they crit.',
    inputs: [],
    // CASTING SPEED BELONGS HERE, and it is the reason this control matters more than it
    // looks. A character's damage types can be read off their gear; how they deliver that
    // damage cannot. Casting speed is common on gear AND deliberately stacked by casters,
    // and no automatic measure separates those two -- one real character pursuing it
    // scored exactly average against every other item in the game. Intent is the thing
    // only the player can supply, which is what a preset is for.
    //
    // Attack speed and casting speed both appear because a build wants one or the other,
    // never both, and nothing here knows which. Whichever is useless costs one tag slot
    // that the picker will happily let you drop.
    suggest: () => [
      t('character:characterOffensiveAbility', 3),
      t('character:characterAttackSpeed', 2),
      t('character:characterSpellCastSpeed', 2),
      t('character:offensiveCritDamage', 2),
    ],
  },

  {
    id: 'turtle',
    label: 'Turtle mode',
    blurb: 'Do not die. Avoidance first, then the health to survive what lands.',
    inputs: [],
    suggest: () => [
      t('character:characterDefensiveAbility', 3),
      t('character:defensiveProtection', 2),
      t('character:characterLife', 2),
    ],
  },

  {
    id: 'attributes',
    label: 'Attributes first',
    blurb: 'Raw Physique, Cunning and Spirit. Useful when gear requirements are the '
      + 'thing blocking you rather than damage or survival.',
    inputs: [],
    suggest: () => [
      t('character:characterStrength', 2),
      t('character:characterDexterity', 2),
      t('character:characterIntelligence', 2),
    ],
  },

];

export const controlById = id => CONTROLS.find(c => c.id === id) ?? null;

/**
 * Combine the chosen controls into a tag list that fits the picker.
 *
 * Controls STACK rather than replacing one another, because the build most people want
 * is a combination: shore up two resistances AND push the damage they already have.
 * Order is the priority -- the first control's tags are placed first and, at the limit,
 * survive.
 *
 * A tag claimed by two controls keeps the HIGHER weight rather than being counted twice.
 * Wanting a thing for two reasons does not mean wanting it twice as much; it means at
 * least as much as the more emphatic reason.
 *
 * @returns { tags, dropped } -- `dropped` names what did not fit, so the caller can say
 *          so rather than silently ignoring half of what was asked for.
 */
export function applyControls(ids, ctx = {}) {
  const chosen = (ids ?? []).map(controlById).filter(Boolean);
  const byTag = new Map();
  const order = [];
  for (const c of chosen) {
    for (const { tag, weight } of c.suggest(ctx) ?? []) {
      if (!byTag.has(tag)) { byTag.set(tag, weight); order.push(tag); }
      else byTag.set(tag, Math.max(byTag.get(tag), weight));
    }
  }
  const tags = order.slice(0, MAX_TAGS).map(tag => ({ tag, weight: byTag.get(tag) }));
  const dropped = order.slice(MAX_TAGS);
  return { tags, dropped };
}
