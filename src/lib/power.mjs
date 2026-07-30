// Scoring for celestial powers.
//
// How often a power fires:
//   has a recharge  -> chance / recharge   (at most once per cooldown)
//   chance only     -> chance              (fires on every qualifying hit)
//
// 49 of the 63 powers have a recharge; the other 14 report skillCooldownTime 0 in
// both the parent and the buff record (Assassin's Mark, Wendigo's Mark, Turtle
// Shell, Ghoulish Hunger...). They aren't uncapped in game -- GD gates them some
// other way that isn't in the DBR -- but for ranking purposes their chance IS their
// frequency.

/** Raw firing frequency. Units differ between the branches; see scale note below. */
export function procFrequency(proc, cooldown) {
  const chance = proc?.chance ?? 0;
  if (!chance) return 0;
  return cooldown > 0 ? chance / cooldown : chance;
}

// The three-way switch, in terms of who is asking:
//
//   IGNORE - the character min/maxer. They are not chasing celestial powers at all;
//            a power is a by-product of buying affinity to get deeper into the tree.
//            What they want is the passive stats on the early and middle stars, so
//            powers get no weight whatsoever.
//   RANK1  - powers count, but only at the rank you get them on purchase.
//   MAX    - powers count at full investment.
//
// Caps vary per power (10/15/20/25), so MAX has to clamp against that power's own
// cap rather than a fixed 25 -- scoring Hungering Void (cap 15) at rank 25 would
// invent numbers the game never produces.
export const LEVEL_MODE = { IGNORE: 0, RANK1: 1, MAX: 2 };

export function levelFor(maxLevel, mode = LEVEL_MODE.RANK1) {
  const cap = Math.max(1, maxLevel || 1);
  if (mode === LEVEL_MODE.MAX) return cap;
  return 1;                    // IGNORE scores 0 anyway; RANK1 is rank 1
}

// --- Tier ---------------------------------------------------------------------
//
// Constellations come in three tiers, and the LEVEL CAP identifies them exactly --
// measured across all 62 powers, no exceptions:
//
//   cap 25 -> tier 1   requires 1 affinity,      grants ~4.9 back   (14 powers)
//   cap 20 -> tier 2   requires 8-15 affinity,   grants ~3.0 back   (27 powers)
//   cap 15 -> tier 3   requires 22+ affinity,    grants NOTHING     (21 powers, one at 10)
//
// That matches the tier definition on the wiki, derived independently from the DBRs.
export const TIER_BY_CAP = { 25: 1, 20: 2, 15: 3, 10: 3 };
export const tierOf = maxLevel => TIER_BY_CAP[maxLevel] ?? 3;

/**
 * WHY TIER, AND NOT chance/recharge.
 *
 * The old model scored `chance / recharge`, log-compressed. Measured across all 62
 * powers by tier, it was not merely imprecise -- it was BACKWARDS:
 *
 *                       tier 1   tier 2   tier 3
 *   old score (rank 1)    1.00     0.76     0.81
 *   old score (max)       1.00     0.74     0.76
 *   points to actually own 5.0     13.8     26.5      (1 : 2.76 : 5.30)
 *
 * So the solver believed a tier-1 power was the best deal available while it cost a
 * fifth of a tier-3. Tier 1 has near-zero cooldowns (0.9s average against 5.9s), so
 * dividing by recharge handed it an enormous frequency and the deepest powers in the
 * game ranked last.
 *
 * Nothing else countable in the extraction tracks tier either. Proc chance goes
 * 41.6% / 37.4% / 47.9% -- tier 2 is the LOWEST. Effect-line count goes 1.00 : 0.76 :
 * 0.78, the same inverted shape. What actually scales with tier is the MAGNITUDE of
 * each effect per rank, and magnitudes are exactly what the extraction doesn't carry
 * yet (see FUTURE-PLANS, "Showing actual stat values").
 *
 * So tier is used as the balance proxy, on the assumption that Crate balanced the
 * powers within a tier against each other. That assumption is the honest part of this
 * model; the rest is arithmetic.
 *
 * WHY NOT 1 : 2 : 3, AND WHY NOT 1 : 2.76 : 5.30.
 *
 * Cost-proportional over-credits the deep powers. The points spent reaching a tier-3
 * power are not overhead -- they buy passive stats at an equal or better rate than a
 * tier-1 acquisition does (2.57 / 3.24 / 3.56 stat lines per point), and the solver
 * already scores those stats separately through keyword hits. Crediting the power
 * with the full 5.3x would count the same points twice.
 *
 * Flat is also wrong: a tier-3 constellation returns NO affinity, so its power has to
 * justify the whole trip on its own, where a tier-1 pays you 4.9 affinity for the
 * privilege of taking it.
 *
 * The truth is between the two, so these are the geometric mean of flat and
 * cost-proportional. They are deliberately a tunable table, not a formula: the
 * assumption underneath is a judgement about game balance, and it should be easy to
 * argue with.
 */
export const TIER_WEIGHT = { 1: 1.00, 2: 1.66, 3: 2.30 };

/**
 * How hard a power pulls, relative to one weighted keyword hit.
 *
 * Lives here so `select.mjs` and `solver.mjs` can't drift apart -- they held separate
 * copies of this number.
 *
 * 7.7, not the previous 12, because the change to tier weighting was about the RATIO
 * between tiers, not about making powers matter more. Averaged over all 62 powers the
 * new weights come out 1.56x the old ones (0.255 against 0.163 at rank 1; 0.751
 * against 0.483 at max), so leaving the pressure at 12 quietly made every power 1.5x
 * more attractive against keyword coverage. It showed: deep constellations started
 * outranking shallow keyword carriers, and a build for three sparse keywords went
 * eight steps before it touched one. 12 / 1.56 keeps overall pressure where it was.
 */
export const POWER_PRESSURE = 7.7;

// Rank scales a power's NUMBERS, not how often it fires -- chance and recharge are
// the same at rank 1 as at rank 25. So a rank-1 power keeps all of its utility
// (it still procs, still shreds resistance, still triggers) and only a fraction of
// its magnitude. Scoring rank 1 as 1/25 of max therefore understates it badly, and
// made "Rank 1" indistinguishable from "Passives only". This keeps a fixed share for
// simply having the proc, and scales the rest with rank.
//
// It also means the caps do real work at rank 1: a tier-1 power sits at 1 of 25 while
// a tier-3 sits at 1 of 15, so the deeper power is proportionally closer to its
// ceiling when you first buy it.
const BASE_SHARE = 0.3;

/**
 * Comparable weight for a power, in [0, ~1].
 *
 * `proc` and `cooldown` are still accepted so every call site keeps working, but they
 * are deliberately unused -- see above for the measurements that retired them.
 */
export function powerWeightFor(proc, cooldown, maxLevel, mode = LEVEL_MODE.RANK1) {
  if (mode === LEVEL_MODE.IGNORE) return 0;
  const cap = Math.max(1, maxLevel || 1);
  const rankFraction = levelFor(cap, mode) / cap;
  const scale = BASE_SHARE + (1 - BASE_SHARE) * rankFraction;
  const top = Math.max(...Object.values(TIER_WEIGHT));
  return (TIER_WEIGHT[tierOf(cap)] / top) * scale;
}
