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

/** A strength is worth the highest weight the picker offers: it is what the build IS. */
const STRENGTH_WEIGHT = 3;

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
 * @param opts.resists    the ten sheet numbers by key, or a subset; missing ones are
 *                        simply unknown rather than assumed to be zero
 * @param opts.max        slots available
 * @returns { tags, dropped, reasons }
 *
 * `dropped` names what did not fit and `reasons` says why each tag is there, because a
 * proposal the player cannot interrogate is one they have to take on trust.
 */
export function proposeTags({ strengths = [], resists = null, max = MAX_TAGS } = {}) {
  const tags = [];
  const reasons = new Map();
  const seen = new Set();
  const dropped = [];

  const push = (tag, weight, why) => {
    if (seen.has(tag)) return false;
    if (tags.length >= max) { dropped.push(tag); return false; }
    seen.add(tag);
    tags.push({ tag, weight });
    reasons.set(tag, why);
    return true;
  };

  // Strengths first. They are already cut at the threshold, so everything here has
  // earned its place -- there is no second-guessing to do.
  for (const s of strengths) {
    push(s.chip, STRENGTH_WEIGHT, `${Math.round(s.value)}% on your gear`);
  }

  // Then the holes, WEAKEST FIRST so the scarce remaining slots go where it hurts most.
  // A resistance at or above target scores 0 and is not proposed at all, which is what
  // stops a well-defended character being handed busywork.
  const worst = [...worstPerTag(resists).entries()]
    .map(([tag, { value, label }]) => ({ tag, value, label, weight: resistWeightOf(value) }))
    .filter(x => x.weight > 0)
    .sort((a, b) => a.value - b.value);

  for (const w of worst) {
    push(w.tag, w.weight, `${w.label} at ${Math.round(w.value)}`);
  }

  return { tags, dropped, reasons };
}
