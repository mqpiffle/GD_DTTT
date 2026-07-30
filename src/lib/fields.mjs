// Shared field-name logic: grouping raw DBR fields into families, deciding what's
// technical noise, and turning a field into a human keyword.
//
// Used by scripts/reconcile-labels.mjs and scripts/build-keywords.mjs so the two
// can't drift apart.

// Mirrors StatManager.BodyDamageTypes from iagd. Order matters: longer names must
// be tried before their substrings, or "SlowFire" matches as "Fire".
export const BODY_DAMAGE_TYPES = [
  'SlowPoison', 'SlowPhysical', 'SlowBleeding', 'SlowLife', 'SlowFire', 'SlowCold',
  'SlowLightning', 'PercentCurrentLife', 'TotalDamage', 'Bleeding', 'Elemental',
  'Lightning', 'Physical', 'Poison', 'Aether', 'Chaos', 'Pierce', 'Fire', 'Cold',
  'Life',
];

// Grim Dawn's display names for damage types differ from the field names --
// SlowFire is "Burn", Poison is "Acid", Life is "Vitality". Mirrors
// StatManager.DamageTypeTranslation via iagd's tag table.
export const DAMAGE_TYPE_NAMES = {
  // The cold DoT is "Frostburn" in game, not "Frost" -- Frost is the direct cold damage.
  SlowPhysical: 'Internal Trauma', SlowFire: 'Burn', SlowCold: 'Frostburn',
  SlowLightning: 'Electrocute', SlowPoison: 'Poison', SlowLife: 'Vitality Decay',
  SlowBleeding: 'Bleeding', Poison: 'Acid', Life: 'Vitality', TotalDamage: 'Total',
  PercentCurrentLife: 'Life Reduction', Physical: 'Physical', Fire: 'Fire',
  Cold: 'Cold', Lightning: 'Lightning', Chaos: 'Chaos', Bleeding: 'Bleeding',
  Elemental: 'Elemental', Pierce: 'Pierce', Aether: 'Aether',
};

// Suffixes that distinguish members of one family, longest first.
//
// `Duration` is deliberately NOT stripped. It used to be, via DurationMin/
// DurationModifier, which collapsed "18 Burn Damage over 3s" and "+50% Burn Duration"
// into one family and one chip labelled "Burn Duration" -- so a player looking for burn
// DAMAGE found a duration tag, and nobody could ask for duration on its own. Leaving
// Duration in the family name splits them, because Min/Max/Modifier still strip:
//   offensiveSlowFireMin              -> offensiveSlowFire          ("Burn Damage")
//   offensiveSlowFireDurationModifier -> offensiveSlowFireDuration  ("Burn Duration")
const SUFFIXES = ['Modifier', 'Chance', 'Min', 'Max'];

export function familyOf(field) {
  for (const suf of SUFFIXES) {
    if (field.endsWith(suf) && field.length > suf.length) return field.slice(0, -suf.length);
  }
  return field;
}

// Fields that are engine internals -- geometry, animation, fx, physics, weapon-type
// usability flags. Never surfaced to a user as a keyword.
export const TECHNICAL = new Set([
  // weapon-type usability flags
  'Axe', 'Axe2h', 'Dagger', 'Mace', 'Mace2h', 'Offhand', 'Ranged1h', 'Ranged2h',
  'Scepter', 'Shield', 'Spear2h', 'Sword', 'Sword2h',
  // fx / camera / geometry
  'cameraShakeAmplitude', 'cameraShakeDurationSecs', 'dropHeight', 'dropRadius',
  'dropVariation', 'fxPakAlternate', 'fxPakExtents', 'fxPakRandAngle',
  'fxPakRandOffsetX', 'fxPakRandOffsetY', 'fxPakSpawnDistance', 'expansionTime',
  'launchAboveTarget', 'instantCast', 'pointBlank', 'ragDollAmplification',
  'refreshTime', 'spawnObjectsTimeToLive', 'useTargetDir', 'waveDepth', 'waveDistance',
  'waveEndWidth', 'waveStartWidth', 'waveTime', 'sparkGap', 'sparkMaxNumber',
  // projectile internals
  'projectileDamageRange1Max', 'projectileDamageRange1Scale', 'projectileDamageRange2Max',
  'projectileDamageRange2Min', 'projectileDamageRange2Scale', 'projectileDamageRange3Max',
  'projectileDamageRange3Min', 'projectileDamageRange3Scale',
  'projectileFragmentsLaunchNumberMax', 'projectileFragmentsLaunchNumberMin',
  'projectileLaunchNumber', 'projectileLaunchRotation', 'projectilePeriod',
  'projectileUsesAllDamage', 'numProjectiles',
  'actorRadius', 'maxTransparency', 'notificationRadius', 'outlineThickness',
  'physicsFriction', 'physicsMass', 'physicsRestitution', 'projectileDistance',
  'projectileFlightAnimationSpeed', 'projectileLaunchAnimationSpeed', 'projectileVelocity',
  'scale', 'shadowBias', 'castsShadows', 'inflightGroundFxDropTime',
  'projectileHitTTLMax', 'projectileHitTTLMin', 'projectileMissTTLMax', 'projectileMissTTLMin',
  'collidesWithProjectiles', 'projectileDuration', 'projectileFollow', 'projectileOrbitRate',
  'projectileStartDistance', 'disableCollision', 'explodeOnMiss', 'projectileHoverDuration',
  'projectileTravelDistance', 'targetInterval',
  // skill bookkeeping
  'skillExperienceLevels', 'skillMaxLevel', 'skillProjectileMaximumNumber',
  'skillProjectileTargetGroundOnly', 'skillTargetInterval', 'skillUltimateLevel',
  'petPadding', 'debufSkill', 'skillManaPercent', 'skillActiveLifeCost',
  // 0/1 "does this skill count as X" retaliation flags, not player-facing
  'aetherDamageQualifier', 'chaosDamageQualifier', 'elementalDamageQualifier',
  'lifeDamageQualifier', 'poisonDamageQualifier',
]);

export const isTechnical = f => TECHNICAL.has(f);

// Strip iagd's format placeholders and leading sign/percent to leave a bare noun
// phrase suitable for a keyword chip: "+{0}% Physique" -> "Physique".
export function keywordFromTemplate(tpl) {
  return tpl
    .replace(/\{\d+\}/g, '')
    .replace(/[+\-]?\s*%/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s+\-:]+|[\s:,.]+$/g, '')
    .trim();
}

// Compose a keyword for the damage/resistance families that iagd builds at runtime
// rather than storing. Returns null if `field` isn't one of them.
export function damageKeyword(field) {
  for (const t of BODY_DAMAGE_TYPES) {
    const name = DAMAGE_TYPE_NAMES[t] ?? t;
    if (field === `defensive${t}` || field === `defensive${t}Resistance`) return `${name} Resistance`;
    if (field === `defensive${t}MaxResist`) return `Maximum ${name} Resistance`;
    for (const suf of ['Min', 'Max', 'Modifier']) {
      if (field === `offensive${t}${suf}`) return `${name} Damage`;
      if (field === `retaliation${t}${suf}`) return `${name} Retaliation`;
    }
    for (const suf of ['DurationMin', 'DurationModifier']) {
      if (field === `offensive${t}${suf}`) return `${name} Duration`;
    }
  }
  return null;
}

// --- Categories -------------------------------------------------------------
// Groups for the foldable sections in the keyword picker. Derived from the field
// name, so new fields from a future patch land somewhere sensible automatically
// rather than silently vanishing from the UI.
// Order matters -- first match wins.
const CATEGORY_RULES = [
  ['Summons', /^(petLimit|petBurstSpawn)$/],
  ['Attributes', /^character(Strength|Dexterity|Intelligence|Constitution)/],
  ['Requirement Reduction', /ReqReduction$/],
  // The bare `defensiveFire` form (no suffix) is the commonest resistance field,
  // so match the damage-type list explicitly rather than relying on a suffix.
  ['Resistances', new RegExp(`^defensive(${BODY_DAMAGE_TYPES.join('|')}|Elemental|Convert|PercentCurrentLife)(Resistance|MaxResist)?$`)],
  ['Resistances', /^defensive.*(Resistance|MaxResist)$/],
  ['Damage over Time', /^offensiveSlow(Poison|Physical|Bleeding|Life|Fire|Cold|Lightning)/],
  ['Crowd Control', /^(offensive(Stun|Freeze|Petrify|Knockdown|Confusion|Fumble|ProjectileFumble|Taunt)|retaliationFear)/],
  ['Debuffs', /^offensive(Slow|.*ResistanceReduction|TotalDamageReduction|PhysicalReductionPercent)/],
  ['Retaliation', /^retaliation/],
  ['Leech & Sustain', /^(offensiveLifeLeech|offensiveSlowManaLeach|characterLifeRegen|characterManaRegen|characterHealIncrease|skillLife)/],
  ['Defense', /^(defensiveProtection|defensiveBlock|defensiveAbsorption|damageAbsorption|characterDefensiveAbility|characterDodge|characterDeflect|defensivePercentReflection|defensiveDisruption|characterLife|defensiveStun|defensiveFreeze|defensivePetrify|defensiveTrap|defensiveTotalSpeed|defensiveSlow|defensive.*Duration)/],
  ['Offense', /^(offensive|characterOffensiveAbility|characterAttackSpeed|characterSpellCastSpeed|weaponDamagePct|conversionPercentage|racialBonus)/],
  ['Utility', /^(character|skill|projectile|spark|contagion|dispel)/],
];

export function categoryOf(field) {
  for (const [name, re] of CATEGORY_RULES) if (re.test(field)) return name;
  return 'Other';
}

// Chip labels, keyed by FAMILY. Stripping placeholders out of a sentence-shaped
// format string leaves fragments ("chance to", "of Attack Damage converted to
// Health") that read badly as a chip, so the worst offenders get a short noun
// phrase. The full format string is still used for displaying actual values.
export const KEYWORD_OVERRIDES = {
  offensiveStun: 'Stun',
  offensiveFreeze: 'Freeze',
  offensivePetrify: 'Petrify',
  offensiveConfusion: 'Confuse',
  offensiveKnockdown: 'Knockdown',
  offensiveFumble: 'Fumble',
  offensiveProjectileFumble: 'Impaired Aim',
  offensiveTaunt: 'Taunt',
  retaliationFear: 'Fear',
  offensiveLifeLeech: 'Life Steal',
  offensiveSlowManaLeach: 'Energy Leech',
  characterManaRegen: 'Energy Regeneration',
  characterLifeRegen: 'Health Regeneration',
  characterHealIncreasePercent: 'Healing Effects',
  characterEnergyAbsorptionPercent: 'Energy Absorption',
  characterDodgePercent: 'Melee Dodge',
  characterDeflectProjectile: 'Projectile Deflect',
  defensiveAbsorption: 'Armor Absorption',
  defensiveBlock: 'Shield Block Chance',
  defensiveDisruption: 'Skill Disruption Protection',
  defensivePercentReflectionResistance: 'Reflect Reduction',
  defensivePercentCurrentLife: 'Life Reduction Resistance',
  projectilePiercing: 'Pass Through Enemies',
  racialBonusPercentDamage: 'Damage to Creature Type',
  retaliationDamagePct: 'Weapon Retaliation',
  dispelDamageOverTime: 'Cleanse DoT',
  spark: 'Chain Targets',
  offensiveLightningModifier: 'Chance of Lightning Damage',
  skillCooldownTime: 'Skill Recharge',
  skillActiveDuration: 'Skill Duration',
  skillTargetRadius: 'Skill Radius',
  skillTargetNumber: 'Target Cap',
  skillManaCostReduction: 'Energy Cost',
  // debuff families: the value and its duration are one concept to a user
  offensiveSlowAttackSpeed: "Reduce Enemy Attack Speed",
  offensiveSlowRunSpeed: 'Slow Enemies',
  offensiveSlowTotalSpeed: 'Slow Enemy Total Speed',
  offensiveSlowOffensiveAbility: "Reduce Enemy Offensive Ability",
  offensiveSlowDefensiveAbility: "Reduce Enemy Defensive Ability",
  offensiveTotalDamageReductionPercent: "Reduce Enemy Damage",
  offensiveTotalResistanceReductionAbsolute: 'Resistance Reduction (flat)',
  offensiveElementalResistanceReductionAbsolute: 'Elemental Resist Reduction (flat)',
  offensiveElementalResistanceReductionPercent: 'Elemental Resist Reduction (%)',
  offensivePhysicalReductionPercent: 'Physical Resist Reduction',
  // incoming-DoT duration resistances
  defensiveBleedingDuration: 'Bleeding Duration Resist',
  defensiveColdDuration: 'Frost Duration Resist',
  defensiveFireDuration: 'Burn Duration Resist',
  defensiveLifeDuration: 'Vitality Decay Duration Resist',
  defensiveLightningDuration: 'Electrocute Duration Resist',
  defensivePhysicalDuration: 'Trauma Duration Resist',
  defensivePoisonDuration: 'Poison Duration Resist',
  defensiveSlowLifeLeachDuration: 'Life Leech Duration Resist',
  defensiveSlowLifeLeach: 'Life Leech Resistance',
  defensiveSlowManaLeach: 'Energy Leech Resistance',
  defensiveStun: 'Stun Resistance',
  defensiveFreeze: 'Freeze Resistance',
  defensivePetrify: 'Petrify Resistance',
  defensiveTrap: 'Entrapment Resistance',
  // contagion (Pestilence)
  contagionInterval: 'Contagion Interval',
  contagionLimit: 'Contagion Targets',
  contagionMaxSpread: 'Contagion Spread',
  contagionRadius: 'Contagion Radius',
  // requirement reductions
  characterArmorStrengthReqReduction: 'Armor Physique Req.',
  characterShieldStrengthReqReduction: 'Shield Physique Req.',
  characterMeleeStrengthReqReduction: 'Melee Physique Req.',
  characterMeleeDexterityReqReduction: 'Melee Cunning Req.',
  characterHuntingDexterityReqReduction: 'Ranged Cunning Req.',
  characterWeaponIntelligenceReqReduction: 'Weapon Spirit Req.',
  characterJewelryIntelligenceReqReduction: 'Jewelry Spirit Req.',
};

// Families a user thinks of as ONE concept, collapsed into a single chip. Without
// this the picker shows seven near-identical "Physique Req. for Shields"-style
// chips, each on 1-2 stars -- individually useless as filters. Merged families stay
// individually searchable; this only controls what's browsable.
export const MERGE_GROUPS = {
  characterArmorStrengthReqReduction: 'Requirement Reduction',
  characterShieldStrengthReqReduction: 'Requirement Reduction',
  characterMeleeStrengthReqReduction: 'Requirement Reduction',
  characterMeleeDexterityReqReduction: 'Requirement Reduction',
  characterHuntingDexterityReqReduction: 'Requirement Reduction',
  characterWeaponIntelligenceReqReduction: 'Requirement Reduction',
  characterJewelryIntelligenceReqReduction: 'Requirement Reduction',

  contagionInterval: 'Contagion', contagionLimit: 'Contagion',
  contagionMaxSpread: 'Contagion', contagionRadius: 'Contagion',

  defensiveBleedingDuration: 'DoT Duration Resistance',
  defensiveColdDuration: 'DoT Duration Resistance',
  defensiveFireDuration: 'DoT Duration Resistance',
  defensiveLifeDuration: 'DoT Duration Resistance',
  defensiveLightningDuration: 'DoT Duration Resistance',
  defensivePhysicalDuration: 'DoT Duration Resistance',
  defensivePoisonDuration: 'DoT Duration Resistance',
  defensiveSlowLifeLeachDuration: 'DoT Duration Resistance',

  offensiveTotalResistanceReductionAbsolute: 'Resistance Reduction',
  offensiveElementalResistanceReductionAbsolute: 'Resistance Reduction',
  offensiveElementalResistanceReductionPercent: 'Resistance Reduction',
  offensivePhysicalReductionPercent: 'Resistance Reduction',

  offensiveSlowAttackSpeed: 'Enemy Debuffs',
  offensiveSlowOffensiveAbility: 'Enemy Debuffs',
  offensiveSlowDefensiveAbility: 'Enemy Debuffs',
  offensiveTotalDamageReductionPercent: 'Enemy Debuffs',
  offensiveSlowRunSpeed: 'Enemy Debuffs',
  offensiveSlowTotalSpeed: 'Enemy Debuffs',

  offensiveStun: 'Crowd Control', offensiveFreeze: 'Crowd Control',
  offensivePetrify: 'Crowd Control', offensiveConfusion: 'Crowd Control',
  offensiveKnockdown: 'Crowd Control', offensiveFumble: 'Crowd Control',
  offensiveProjectileFumble: 'Crowd Control', retaliationFear: 'Crowd Control',
  offensiveTaunt: 'Crowd Control',

  // Flat and percentage variants of one concept. Left separate these render as two
  // chips with identical visible names, which is just confusing.
  damageAbsorption: 'Damage Absorption', damageAbsorptionPercent: 'Damage Absorption',
  skillLifeBonus: 'Health Restored', skillLifePercent: 'Health Restored',
};

// Category for a merged chip, which has no single underlying family.
export const MERGED_CATEGORY = {
  'Requirement Reduction': 'Requirement Reduction',
  Contagion: 'Utility',
  'DoT Duration Resistance': 'Resistances',
  'Resistance Reduction': 'Debuffs',
  'Enemy Debuffs': 'Debuffs',
  'Crowd Control': 'Crowd Control',
  'Damage Absorption': 'Defense',
  'Health Restored': 'Leech & Sustain',
};

// These live on the star itself (so they read as character stats) but only mean
// anything to a pet build, so they belong in the pet namespace. Shared between
// build-keywords.mjs and build-ui-index.mjs -- when only one of them applied the
// move, "Summon Limit" became a chip that matched no constellation at all.
export const PET_SIDE_FIELDS = new Set(['petLimit', 'petBurstSpawn']);

// A keyword on a handful of stars is a poor thing to browse -- picking it barely
// constrains the solver -- but should still match if typed.
// Per namespace, because the pools differ by ~6x: 559 stars carry character stats
// but only 96 carry pet bonuses, where the commonest keyword tops out at 31. A flat
// threshold would hide most of the pet list.
export const BROWSE_MIN_STARS = { character: 5, pet: 3 };

// "to Maximum Fire Resistance" -> "Maximum Fire Resistance"
const tidy = k => k.replace(/^to\s+/i, '').trim();

// Best available human keyword for a field, or null if we have nothing.
// Order: family override -> explicit label -> composed damage keyword -> null.
export function keywordFor(field, labels, family = familyOf(field)) {
  if (KEYWORD_OVERRIDES[family]) return KEYWORD_OVERRIDES[family];
  if (labels[field] !== undefined) {
    const k = keywordFromTemplate(labels[field]);
    if (k) return tidy(k);
  }
  const d = damageKeyword(field);
  return d ? tidy(d) : null;
}
