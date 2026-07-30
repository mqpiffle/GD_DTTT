// Which stars to take inside one constellation.
//
// A partial take was represented as a COUNT, which silently assumes you buy stars
// 1..k in index order. That's fine for a straight chain, but 58 of 109 constellations
// branch -- Lotus hangs stars 2, 3 and 4 all off star 1 -- so "three stars" is a
// choice of which three, not a prefix. Taking the prefix can miss the good ones
// entirely: Akeron's Scorpion puts its power on star 5, whose parent is star 3, so
// the best four stars are {1,2,3,5} and the prefix {1,2,3,4} misses the power.
//
// This is a tree knapsack: for each k, the best connected subtree of size k that
// contains the root.

import { weightMap } from './wanted.mjs';

/** Adjacency from the 1-based parent array. */
function childrenOf(parents, n) {
  const kids = Array.from({ length: n + 1 }, () => []);
  for (let j = 1; j <= n; j++) {
    const p = parents?.[j - 1];
    if (p) kids[p].push(j);
  }
  return kids;
}

/**
 * @param c      constellation from buildDb()
 * @param value  (starIndex0Based) => number
 * @returns array where [k] = { value, stars } for the best k-star subtree,
 *          stars being 1-based indices. Index 0 is the empty take.
 */
export function bestSubtrees(c, value) {
  const n = c.starCount;
  const parents = c.starParents ?? [];
  const kids = childrenOf(parents, n);

  // roots are stars with no parent -- normally exactly one
  const roots = [];
  for (let j = 1; j <= n; j++) if (!parents[j - 1]) roots.push(j);

  // f(v)[k] = best value of a size-k subtree of v's subtree that INCLUDES v
  const solveNode = (v) => {
    let table = [null, { value: value(v - 1), stars: [v] }];
    for (const ch of kids[v]) {
      const sub = solveNode(ch);
      const merged = table.slice();
      for (let take = 1; take < table.length; take++) {
        if (!table[take]) continue;
        for (let add = 1; add < sub.length; add++) {
          if (!sub[add]) continue;
          const k = take + add;
          const val = table[take].value + sub[add].value;
          if (!merged[k] || val > merged[k].value) {
            merged[k] = { value: val, stars: [...table[take].stars, ...sub[add].stars] };
          }
        }
      }
      table = merged;
    }
    return table;
  };

  // Combine the roots (virtually always one).
  let best = [{ value: 0, stars: [] }];
  for (const r of roots) {
    const sub = solveNode(r);
    const merged = best.slice();
    for (let take = 0; take < best.length; take++) {
      if (!best[take]) continue;
      for (let add = 1; add < sub.length; add++) {
        if (!sub[add]) continue;
        const k = take + add;
        const val = best[take].value + sub[add].value;
        if (!merged[k] || val > merged[k].value) {
          merged[k] = { value: val, stars: [...best[take].stars, ...sub[add].stars] };
        }
      }
    }
    best = merged;
  }

  for (let k = 0; k <= n; k++) if (!best[k]) best[k] = null;
  best.length = n + 1;
  return best;
}

/**
 * Value function: weighted keyword hits on a star, plus the power bonus.
 *
 * `mustStar` (1-based) is for a directly targeted celestial power. The knapsack picks
 * the best connected subtree of each size, so making that one star overwhelmingly
 * valuable guarantees every size that CAN reach it does -- the tree does the rest,
 * since reaching a star means taking the chain to it. Without this, asking for a power
 * could return a subtree of the right size that skips the very star you asked for.
 */
export function starValuer(c, wanted, powerBonus = 0, mustStar = 0) {
  const weights = weightMap(wanted);
  return (j0) => {
    let v = 0;
    for (const k of c.perStar?.[j0] ?? []) v += weights.get(k) ?? 0;
    if (powerBonus && c.powerStar && j0 + 1 === c.powerStar) v += powerBonus;
    if (mustStar && j0 + 1 === mustStar) v += MUST_HAVE;
    return v;
  };
}

// Large enough to dominate any sum of keyword weights and power bonuses, small enough
// to stay exact in floating point when several are added together.
export const MUST_HAVE = 1e6;

/** Stars are bought parent-before-child; ascending index is always legal. */
export const purchaseOrder = stars => [...stars].sort((a, b) => a - b);
