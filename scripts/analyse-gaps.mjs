// Answers: are the hand-labelled "gap" keywords worth their own chip?
//
// NOTE ON METHOD. The first version of this script tested whether some other
// keyword's star set was a superset of this one's, and called that REDUNDANT.
// That was useless: any keyword appearing on 1-2 stars is trivially a subset of
// dozens of larger sets by coincidence, which is how we got "Petrify is redundant
// because every star that has it also has Meter Radius". Set containment carries
// no signal at these sizes.
//
// What actually decides it is prevalence plus semantics:
//   PROMOTE - common enough to filter usefully on its own.
//   MERGE   - a variant of a concept the user thinks of as one thing. Seven
//             separate "Physique Req. for Shields"-style chips are noise; one
//             "Requirement Reduction" chip is a real filter.
//   SEARCH  - too rare to be a browsable chip, but should still match if typed.
//
// Usage: node scripts/analyse-gaps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { familyOf } from '../src/lib/fields.mjs';

const dir = import.meta.dirname;
const kw = JSON.parse(fs.readFileSync(path.join(dir, '../keywords.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(dir, '../labels.extra.json'), 'utf8'));

// The gaps are exactly the families we had to hand-write a label for.
const handWritten = new Set(
  Object.keys(extra).filter(k => !k.startsWith('_')).map(familyOf),
);

// Families a user thinks of as one concept -> the chip that should represent them.
// Only genuine semantic parents; nothing inferred from set overlap.
const MERGE_INTO = {
  // seven near-identical "reduce the stat requirement for <gear type>" fields
  characterArmorStrengthReqReduction: 'Requirement Reduction',
  characterShieldStrengthReqReduction: 'Requirement Reduction',
  characterMeleeStrengthReqReduction: 'Requirement Reduction',
  characterMeleeDexterityReqReduction: 'Requirement Reduction',
  characterHuntingDexterityReqReduction: 'Requirement Reduction',
  characterWeaponIntelligenceReqReduction: 'Requirement Reduction',
  characterJewelryIntelligenceReqReduction: 'Requirement Reduction',
  // Pestilence's contagion mechanic, split across four tuning knobs
  contagionInterval: 'Contagion', contagionLimit: 'Contagion',
  contagionMaxSpread: 'Contagion', contagionRadius: 'Contagion',
  // resistance to the DURATION of an incoming DoT -- one user concept
  defensiveBleedingDuration: 'DoT Duration Resistance',
  defensiveColdDuration: 'DoT Duration Resistance',
  defensiveFireDuration: 'DoT Duration Resistance',
  defensiveLifeDuration: 'DoT Duration Resistance',
  defensiveLightningDuration: 'DoT Duration Resistance',
  defensivePhysicalDuration: 'DoT Duration Resistance',
  defensivePoisonDuration: 'DoT Duration Resistance',
  defensiveSlowLifeLeachDuration: 'DoT Duration Resistance',
  // shredding enemy resistances -- mechanically distinct, one intent
  offensiveTotalResistanceReductionAbsolute: 'Resistance Reduction',
  offensiveElementalResistanceReductionAbsolute: 'Resistance Reduction',
  offensiveElementalResistanceReductionPercent: 'Resistance Reduction',
  offensivePhysicalReductionPercent: 'Resistance Reduction',
  // reducing enemy stats
  offensiveSlowAttackSpeed: 'Enemy Debuffs',
  offensiveSlowOffensiveAbility: 'Enemy Debuffs',
  offensiveSlowDefensiveAbility: 'Enemy Debuffs',
  offensiveTotalDamageReductionPercent: 'Enemy Debuffs',
  offensiveSlowRunSpeed: 'Enemy Debuffs',
  offensiveSlowTotalSpeed: 'Enemy Debuffs',
  // hard CC
  offensiveStun: 'Crowd Control', offensiveFreeze: 'Crowd Control',
  offensivePetrify: 'Crowd Control', offensiveConfusion: 'Crowd Control',
  offensiveKnockdown: 'Crowd Control', offensiveFumble: 'Crowd Control',
  offensiveProjectileFumble: 'Crowd Control', retaliationFear: 'Crowd Control',
  offensiveTaunt: 'Crowd Control',
};

const PROMOTE_AT = 5;   // stars

const rows = [];
for (const ns of ['character', 'pet']) {
  for (const k of kw[ns]) {
    if (!handWritten.has(k.family)) continue;
    const merge = MERGE_INTO[k.family] ?? null;
    const verdict = merge ? 'MERGE' : (k.starCount >= PROMOTE_AT ? 'PROMOTE' : 'SEARCH');
    rows.push({
      ns, family: k.family, keyword: k.keyword, category: k.category,
      stars: k.starCount, constellations: k.constellationCount, verdict, mergeInto: merge,
    });
  }
}

const order = { PROMOTE: 0, MERGE: 1, SEARCH: 2 };
rows.sort((a, b) => order[a.verdict] - order[b.verdict]
  || (a.mergeInto ?? '').localeCompare(b.mergeInto ?? '')
  || b.stars - a.stars);

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('VERDICT', 9)} ${pad('STARS', 6)} ${pad('CONST', 6)} ${pad('KEYWORD', 34)} NOTE`);
console.log('-'.repeat(100));
for (const r of rows) {
  const note = r.verdict === 'MERGE' ? `-> "${r.mergeInto}"`
    : r.verdict === 'SEARCH' ? `${r.category}, too rare to browse`
    : r.category;
  console.log(`${pad(r.verdict, 9)} ${pad(r.stars, 6)} ${pad(r.constellations, 6)} ${pad((r.ns === 'pet' ? '[pet] ' : '') + r.keyword, 34)} ${note}`);
}

const n = v => rows.filter(r => r.verdict === v).length;
const mergedChips = new Set(rows.filter(r => r.mergeInto).map(r => r.mergeInto));
console.log();
console.log(`${rows.length} gap keywords -> PROMOTE ${n('PROMOTE')} | MERGE ${n('MERGE')} into ${mergedChips.size} chips | SEARCH ${n('SEARCH')}`);
console.log(`net effect on the chip list: ${rows.length} -> ${n('PROMOTE') + mergedChips.size} browsable chips`);
console.log(`merged chips: ${[...mergedChips].join(', ')}`);

fs.writeFileSync(path.join(dir, '../gap-analysis.json'), JSON.stringify(rows, null, 1));
