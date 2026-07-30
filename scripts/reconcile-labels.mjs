// Reconciles the 270 distinct non-zero devotion star stat fields (devotions.raw.json)
// against labels.json (ported from iagd's EnglishLanguage.cs) and reports what's
// covered vs. what still needs a hand-written label.
//
// Usage: node scripts/reconcile-labels.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const labels = JSON.parse(fs.readFileSync(path.join(dir, '../labels.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(dir, '../devotions.raw.json'), 'utf8'));

// Include stats from nested buff/projectile grants -- that's where the celestial
// powers actually live. Pet grants are excluded on purpose: their `petOwnStats`
// are the pet's own resistances, not player bonuses.
const fields = new Set();
for (const c of raw) for (const s of c.stars) {
  for (const k of Object.keys(s.stats)) fields.add(k);
  if (s.grants && s.grants.kind !== 'pet') for (const k of Object.keys(s.grants.stats)) fields.add(k);
}

// --- Group raw fields into "families": same stat, different Min/Max/Chance/etc. shape ---
const SUFFIXES = ['DurationModifier', 'DurationMin', 'DurationMax', 'Modifier', 'Chance', 'Min', 'Max'];
function familyOf(field) {
  for (const suf of SUFFIXES) {
    if (field.endsWith(suf) && field.length > suf.length) return field.slice(0, -suf.length);
  }
  return field;
}

const families = new Map(); // familyName -> [raw fields]
for (const f of fields) {
  const fam = familyOf(f);
  if (!families.has(fam)) families.set(fam, []);
  families.get(fam).push(f);
}

// Fields that are technical/geometry/internal, not user-facing stats a devotion
// planner would ever surface as a "keyword". Excluded before counting families.
const TECHNICAL = new Set([
  'Axe', 'Axe2h', 'Dagger', 'Mace', 'Mace2h', 'Offhand', 'Ranged1h', 'Ranged2h',
  'Scepter', 'Shield', 'Spear2h', 'Sword', 'Sword2h', // weapon-type-usable flags
  'cameraShakeAmplitude', 'cameraShakeDurationSecs',
  'dropHeight', 'dropRadius', 'dropVariation',
  'fxPakAlternate', 'fxPakExtents', 'fxPakRandAngle', 'fxPakRandOffsetX', 'fxPakRandOffsetY', 'fxPakSpawnDistance',
  'expansionTime', 'launchAboveTarget', 'instantCast', 'pointBlank', 'ragDollAmplification',
  'refreshTime', 'spawnObjectsTimeToLive', 'useTargetDir',
  'waveDepth', 'waveDistance', 'waveEndWidth', 'waveStartWidth', 'waveTime',
  'sparkGap', 'sparkMaxNumber',
  'projectileDamageRange1Max', 'projectileDamageRange1Scale', 'projectileDamageRange2Max',
  'projectileDamageRange2Min', 'projectileDamageRange2Scale', 'projectileDamageRange3Max',
  'projectileDamageRange3Min', 'projectileDamageRange3Scale', 'projectileFragmentsLaunchNumberMax',
  'projectileFragmentsLaunchNumberMin', 'projectileLaunchNumber', 'projectileLaunchRotation',
  'projectilePeriod', 'projectileUsesAllDamage',
  'skillExperienceLevels', 'skillMaxLevel', 'skillProjectileMaximumNumber',
  'skillProjectileTargetGroundOnly', 'skillTargetInterval', 'skillUltimateLevel',
  'petPadding', 'numProjectiles',
  // projectile physics/render fields, pulled in once we started following
  // skillProjectileName one level down
  'actorRadius', 'maxTransparency', 'notificationRadius', 'outlineThickness',
  'physicsFriction', 'physicsMass', 'physicsRestitution', 'projectileDistance',
  'projectileFlightAnimationSpeed', 'projectileLaunchAnimationSpeed', 'projectileVelocity',
  'scale', 'shadowBias', 'castsShadows', 'inflightGroundFxDropTime',
  'projectileHitTTLMax', 'projectileHitTTLMin', 'projectileMissTTLMax', 'projectileMissTTLMin',
  'collidesWithProjectiles', 'projectileDuration', 'projectileFollow', 'projectileOrbitRate',
  'projectileStartDistance', 'disableCollision', 'explodeOnMiss', 'projectileHoverDuration',
  'projectileTravelDistance', 'targetInterval',
  'debufSkill', 'skillManaPercent', 'skillActiveLifeCost',
  'aetherDamageQualifier', 'chaosDamageQualifier', 'elementalDamageQualifier',
  'lifeDamageQualifier', 'poisonDamageQualifier', // these are 0/1 "does this skill count as X for retaliation" flags, not player-facing
]);

// --- Damage-type name table, mirroring StatManager.DamageTypeTranslation ---
function damageTypeTranslation(d) {
  const base = d.replace(/Modifier/g, '');
  if (labels[base]) return labels[base];
  return base.replace(/Base/g, '');
}
// Must mirror StatManager.BodyDamageTypes exactly — it includes the Slow* (damage
// over time) variants, which are a large share of devotion stats. Omitting them
// badly understates coverage.
const KNOWN_DAMAGE_TYPES = [
  'SlowPoison', 'SlowPhysical', 'SlowBleeding', 'Bleeding', 'SlowLife', 'SlowFire',
  'SlowCold', 'SlowLightning', 'Poison', 'Chaos', 'Fire', 'Aether', 'Cold',
  'Lightning', 'Elemental', 'Pierce', 'Physical', 'Life', 'TotalDamage',
  'PercentCurrentLife',
];

function isCovered(field) {
  // 1. Direct hit - exact field name is a key in labels.json (the "Simply Header/Body
  //    Stats" section of EnglishLanguage.cs, or a resistance family we generated).
  if (labels[field] !== undefined) return { covered: true, how: 'direct' };

  // 2. Footer/skill-modifier templates, literally keyed as customtag_xpac_modif_<field>.
  const footerKey = `customtag_xpac_modif_${field}`;
  if (labels[footerKey] !== undefined) return { covered: true, how: 'customtag_xpac_modif_' + field };

  // 3. offensive/defensive/retaliation + <known damage type> + Min/Max/Modifier/Chance:
  //    StatManager builds these from generic customtag_damage_* / defensive<Type> /
  //    retaliation templates plus DamageTypeTranslation(type) - not a literal field lookup.
  for (const pre of ['offensive', 'defensive', 'retaliation']) {
    for (const type of KNOWN_DAMAGE_TYPES) {
      for (const suf of ['Min', 'Max', 'Modifier', 'Chance', 'DurationMin', 'DurationMax', 'DurationModifier']) {
        if (field === pre + type + suf) {
          return { covered: true, how: `generic ${pre} template (${damageTypeTranslation(type)})` };
        }
      }
    }
  }

  return { covered: false };
}

const reviewFamilies = [];
let coveredFamilyCount = 0;
let totalFamilyCount = 0;

for (const [fam, members] of [...families.entries()].sort()) {
  if (members.every(f => TECHNICAL.has(f))) continue; // whole family is technical, skip entirely
  totalFamilyCount++;
  const results = members.map(f => ({ field: f, ...isCovered(f) }));
  const covered = results.some(r => r.covered);
  if (covered) {
    coveredFamilyCount++;
  } else {
    reviewFamilies.push({ family: fam, fields: members });
  }
}

console.log('raw distinct fields:', fields.size);
console.log('technical/internal fields excluded:', [...fields].filter(f => TECHNICAL.has(f)).length);
console.log('field families (post-exclusion):', totalFamilyCount);
console.log('families covered by a label:', coveredFamilyCount);
console.log('families needing a hand-written label:', reviewFamilies.length);

const reviewPath = path.join(dir, '../label-review.json');
fs.writeFileSync(reviewPath, JSON.stringify(reviewFamilies, null, 1));
console.log('review list written to', reviewPath);
