// Fingerprints devotions.raw.json against the v1.3.0.0 (Fangs of Asterkarn) Devotion
// changelog. Cheapest way to tell whether the extract is stale after a game patch.
//
// Source: https://forums.crateentertainment.com/t/grim-dawn-version-v1-3-0-0/155979
//
// The patch notes quote CONSTELLATION TOTALS, so expected values are compared against
// the sum across that constellation's stars (including nested grant + pet records).
//
// Usage: node scripts/check-version.mjs
import fs from 'node:fs';
import path from 'node:path';

const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../devotions.raw.json'), 'utf8'));

// [constellation prefix, field, expected total, namespace, note]
// The changelog lists player and pet values as separate lines ("reduced % Crit
// damage to 5% AND reduced % Crit damage for pets to 5%"), so the namespace matters
// -- summing across both turns Hawk's two 5%s into a bogus 10%.
const CHECKS = [
  ["Alladrah's Phoenix", 'offensiveCritDamageModifier', 8, 'character', 'reduced % Crit damage to 8%'],
  ['Berserker', 'offensiveCritDamageModifier', 8, 'character', 'increased % Crit damage to 8%'],
  ['Harpy', 'offensiveCritDamageModifier', 5, 'character', 'reduced % Crit damage to 5%'],
  ['Hawk', 'offensiveCritDamageModifier', 5, 'character', 'reduced % Crit damage to 5%'],
  ['Hawk', 'offensiveCritDamageModifier', 5, 'pet', 'reduced % Crit damage for pets to 5%'],
  ["Oklaine's Lantern", 'characterOffensiveAbility', 50, 'character', 'increased Offensive Ability to 50'],
  ["Oklaine's Lantern", 'characterDefensiveAbility', 40, 'character', 'increased Defensive Ability to 40'],
  ["Oklaine's Lantern", 'offensiveCritDamageModifier', 0, 'character', 'REMOVED % Crit damage'],
  ['Affliction', 'retaliationPoisonModifier', 80, 'character', 'added 80% Acid Retaliation'],
  ['Shieldmaiden', 'retaliationTotalDamageModifier', 40, 'character', 'reduced % All Retaliation to 40%'],
  ['Shieldmaiden', 'retaliationPhysicalModifier', 40, 'character', 'added 40% Physical Retaliation'],
  ['Kraken', 'retaliationTotalDamageModifier', 180, 'character', 'reduced % All Retaliation to 180%'],
  ['Obelisk of Menhir', 'damageAbsorptionPercent', 10, 'character', 'Stone Form: added % Damage Absorption (max rank)'],
  ['Dying God', 'offensiveCritDamageModifier', 6, 'pet', 'reduced % Crit damage for pets to 6%'],
];

// Sum a field across a constellation, within one namespace.
// Per-level arrays contribute their max rank.
function total(constellation, field, namespace) {
  let sum = 0;
  for (const s of constellation.stars) {
    const bags = namespace === 'pet'
      ? [s.petBonus?.stats]
      : [s.stats, s.grants?.stats];
    for (const bag of bags) {
      if (!bag) continue;
      const v = bag[field];
      if (v === undefined) continue;
      sum += Array.isArray(v) ? v[v.length - 1] : v;
    }
  }
  return sum;
}

let pass = 0, fail = 0;
for (const [name, field, expected, namespace, note] of CHECKS) {
  const c = data.find(x => x.name && x.name.startsWith(name));
  if (!c) { console.log(`?? MISSING CONSTELLATION  ${name}`); fail++; continue; }
  const got = total(c, field, namespace);
  const ok = Math.abs(got - expected) < 0.01;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  [${namespace}] ${name} / ${field}: expected ${expected}, got ${got}   (${note})`);
}

console.log();
console.log(`${pass}/${CHECKS.length} match v1.3.0.0.`);
if (fail) {
  console.log('Mismatch -- the extract is probably from a different game version.');
  process.exitCode = 1;
} else {
  console.log('devotions.raw.json is Fangs of Asterkarn era data.');
}
