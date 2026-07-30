// The "wanted" list, with per-keyword weights.
//
// Every caller used to pass `['character:fireDamage', ...]` and every keyword counted
// the same. Weights let a build say what it's actually about: a 3-dot Fire Damage
// should pull three times as hard as a 1-dot Movement Speed.
//
// Both shapes are accepted so nothing had to change all at once:
//     ['a', 'b']                        -> every weight DEFAULT_WEIGHT
//     [{ id: 'a', weight: 3 }, 'b']     -> mixed is fine too
//
// Weights are 1-3 to match the dot control. Keeping them small integers matters: the
// objective sums them against celestial power bonuses (POWER_PRESSURE), so a runaway
// weight scale would quietly drown that out.

export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 3;
export const DEFAULT_WEIGHT = 2;

export const clampWeight = w =>
  Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, Math.round(Number(w) || DEFAULT_WEIGHT)));

/** @returns Map of keyword id -> weight */
export function weightMap(wanted) {
  const m = new Map();
  for (const w of wanted ?? []) {
    if (typeof w === 'string') m.set(w, DEFAULT_WEIGHT);
    else if (w && w.id) m.set(w.id, clampWeight(w.weight));
  }
  return m;
}

/** @returns plain array of keyword ids, order preserved */
export const idsOf = wanted =>
  (wanted ?? []).map(w => (typeof w === 'string' ? w : w?.id)).filter(Boolean);

/**
 * Separate the two kinds of tag.
 *
 * A keyword tag is something to maximise: count its stars across the tree and weight
 * them. A celestial power tag is a TARGET -- one named proc on one star of one
 * constellation. There is nothing to maximise, so it can't go through the same
 * objective; it becomes a floor on that constellation instead.
 *
 * @returns { keywords, targets } where targets is
 *   [{ chip, cons, star, min, weight }] sorted heaviest first, so that if the
 *   requested powers cannot all fit, the lightest are the ones given up.
 */
export function splitWanted(wanted, db) {
  const weights = weightMap(wanted);
  const keywords = [];
  const targets = [];
  for (const [id, weight] of weights) {
    const p = db?.powers?.get(id);
    if (p) targets.push({ chip: id, cons: p.cons, star: p.star, min: p.min, weight });
    else keywords.push({ id, weight });
  }
  targets.sort((a, b) => b.weight - a.weight);
  return { keywords, targets };
}
