// Turning an imported character into a starting set of target tags.
//
// This is the composition layer. `strengths.mjs` says what a character is built for,
// `controls.mjs` says what a weak resistance is worth, and this decides how five slots
// get shared between them.
//
// THE RULE: strengths take the slots they EARN, weak resistances fill whatever is left.
//
// Neither half gets a fixed allocation, because a fixed one is wrong for most characters.
// Measured against three real ones:
//
//   Farker (34)       3 strengths, and real holes -- vitality 33, chaos 38
//   Sparkles (80)     2 strengths, three dire resistances
//   Chphthzhmh (100)  5 strengths, every resistance overcapped
//
// A rule like "three strengths and two resistances" would pad Sparkles with a stray affix
// and deny Chphthzhmh the fifth damage type he has actually got. Letting each side ask for
// what it can justify gives all three the right answer.
//
// WHAT THIS DOES NOT DO. It proposes; it never overrules. Everything it places lands in
// the picker as an ordinary tag you can reweight, delete or replace -- the same contract
// the presets already have. Nothing here is a decision the player cannot undo.

import { MAX_TAGS, RESISTS, resistWeightOf } from './controls.mjs';
import { resistPenalty } from './gdc.mjs';

/** A strength is worth the highest weight the picker offers: it is what the build IS. */
const STRENGTH_WEIGHT = 3;

/**
 * Below this level, analysing a character is not worth doing unasked.
 *
 * Not a technical limit -- everything works fine on a level 10. It is that the answer is
 * not useful yet. Gear turns over every few levels, skills are half-invested, resistances
 * are whatever happened to drop, and there are too few devotion points to fix any of it
 * even if the reading were right. Proposing five confident tags off that is proposing
 * noise, and the player has no way to tell it from signal.
 *
 * Approximate on purpose, and OVERRIDABLE: `force` runs the analysis anyway. Someone who
 * asks for it should get it.
 */
export const ANALYSIS_LEVEL = 25;

/**
 * Fire, cold and lightning all raise the same chip, so they are one entry that takes its
 * value from the WEAKEST of the three -- raising elemental resistance raises all three
 * together, and the worst one is what decides whether it is worth points.
 */
function worstPerTag(resists) {
  const worst = new Map();
  for (const r of RESISTS) {
    const v = Number(resists?.[r.key]);
    if (!Number.isFinite(v)) continue;
    if (!worst.has(r.tag) || v < worst.get(r.tag).value) {
      worst.set(r.tag, { value: v, label: r.label });
    }
  }
  return worst;
}

/**
 * Build a starting tag set for a character.
 *
 * @param opts.strengths  from `strengths()` -- [{ chip, value, share }], strongest first
 * @param opts.attribute  from `attributeFocus()`, or null when the points are spread
 * @param opts.resists    the ten sheet numbers by key, or a subset; missing ones are
 *                        simply unknown rather than assumed to be zero
 * @param opts.max        slots available
 * @returns { tags, dropped, reasons }
 *
 * `dropped` names what did not fit and `reasons` says why each tag is there, because a
 * proposal the player cannot interrogate is one they have to take on trust.
 */
export function proposeTags({
  strengths = [], attribute = null, resists = null, max = MAX_TAGS,
  level = null, force = false, difficulty = 'normal',
} = {}) {
  const tags = [];
  const reasons = new Map();
  const seen = new Set();
  const dropped = [];

  // Too early to say anything useful. Declining is the honest answer, and it comes with
  // its reason so the player can overrule it rather than wonder why nothing happened.
  if (!force && level != null && level < ANALYSIS_LEVEL) {
    return {
      tags: [], dropped: [], reasons,
      tooEarly: `At level ${level} a character's gear, skills and resistances are still `
        + `turning over every few levels, and there are too few devotion points to fix `
        + `much anyway. Analysis gets useful around level ${ANALYSIS_LEVEL}.`,
    };
  }

  const push = (tag, weight, why) => {
    if (seen.has(tag)) return false;
    if (tags.length >= max) { dropped.push(tag); return false; }
    seen.add(tag);
    tags.push({ tag, weight });
    reasons.set(tag, why);
    return true;
  };

  // A COMMITTED ATTRIBUTE GOES FIRST, ahead of every damage type, and the ordering is the
  // argument rather than a tie-break.
  //
  // Gear is chosen from what dropped. A helmet worn for its resistances brings its damage
  // modifiers along whether or not they were wanted, so a gear reading is always partly a
  // report on the loot table. Attribute points are not like that: there is no source for
  // them but the player, and a character who put all 26 into Spirit has said something no
  // amount of percentage-summing can contradict.
  //
  // It only speaks when LOPSIDED -- see attributeFocus(). Most characters spread their
  // points to meet gear requirements and get nothing from this, which is correct: meeting
  // a requirement is not a build statement.
  if (attribute) {
    push(attribute.chip, STRENGTH_WEIGHT,
      attribute.share >= 0.999
        ? `every attribute point you have spent (${attribute.points})`
        : `${Math.round(attribute.share * 100)}% of your attribute points `
          + `(${attribute.points} of them)`);
  }

  // Then strengths. They are already cut at the threshold, so everything here has
  // earned its place -- there is no second-guessing to do.
  // BOTH NUMBERS, because they are the two halves of the claim: the percentage is how
  // much, the item count is why it counts as deliberate rather than as one lucky roll.
  // Reporting only the sum would hide the test the stat actually had to pass.
  for (const s of strengths) {
    push(s.chip, STRENGTH_WEIGHT, s.items
      ? `${Math.round(s.value)}% across ${s.items} items and skills`
      : `${Math.round(s.value)}% on your gear`);
  }

  // Then the holes, WEAKEST FIRST so the scarce remaining slots go where it hurts most.
  // A resistance at or above target scores 0 and is not proposed at all, which is what
  // stops a well-defended character being handed busywork.
  //
  // WEIGHTED AGAINST THE DIFFICULTY BEING PLANNED FOR, not the one the numbers came from.
  // A resistance that is comfortable on Veteran is not comfortable on Ultimate, and the
  // mechanism is already in the game: the difficulty penalty. 80 fire reads 55 on Elite
  // and 30 on Ultimate, so weighting the PENALISED number makes the thresholds harshen on
  // their own rather than needing a second scale invented for them.
  //
  // This is what stops the tool telling someone about to step up a difficulty that they
  // are fine. Walking into Elite or Ultimate on resistances that were adequate one tier
  // down is a quick death, and it is the single most common way a working build stops
  // working.
  //
  // Note the penalty is STAGGERED, not flat -- see resistPenalty(). Acid and pierce take
  // it at Elite; vitality, aether, chaos and bleeding not until Ultimate.
  const worst = [...worstPerTag(resists).entries()]
    .map(([tag, { value, label }]) => {
      const field = tag.replace(/^character:/, '');
      const effective = value + resistPenalty(field, difficulty);
      return { tag, value, effective, label, weight: resistWeightOf(effective) };
    })
    .filter(x => x.weight > 0)
    .sort((a, b) => a.effective - b.effective);

  for (const w of worst) {
    // Say both numbers when they differ, or "Fire at 30" looks wrong against a sheet
    // that plainly reads 80.
    const why = w.effective === w.value
      ? `${w.label} at ${Math.round(w.value)}`
      : `${w.label} at ${Math.round(w.value)}, which is ${Math.round(w.effective)} on `
        + `${difficulty}`;
    push(w.tag, w.weight, why);
  }

  return { tags, dropped, reasons };
}
