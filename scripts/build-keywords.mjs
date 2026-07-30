// Builds keywords.json -- the list the user picks 1-3 chips from -- split into two
// namespaces.
//
// The split is forced by the data, not by taste: 40 of the 43 pet-bonus fields
// reuse the exact same DBR name as a player stat. `offensiveTotalDamageModifier`
// on a star means "+X% of your damage"; inside that star's petBonus record it means
// "+X% of your PETS' damage". One flat list would silently merge them.
//
// Usage: node scripts/build-keywords.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  familyOf, isTechnical, keywordFor, categoryOf,
  MERGE_GROUPS, MERGED_CATEGORY, BROWSE_MIN_STARS,
} from '../src/lib/fields.mjs';

const dir = import.meta.dirname;
const labels = JSON.parse(fs.readFileSync(path.join(dir, '../labels.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(dir, '../devotions.raw.json'), 'utf8'));

// namespace -> family -> { fields, stars, constellations }
const ns = { character: new Map(), pet: new Map() };

function add(space, field, constellationId, starKey, onPowerStar) {
  if (isTechnical(field)) return;
  const fam = familyOf(field);
  const m = ns[space];
  if (!m.has(fam)) {
    m.set(fam, {
      family: fam, fields: new Set(), stars: new Set(), constellations: new Set(),
      // Stars carrying this family that are NOT the constellation's power star.
      passiveStars: new Set(),
    });
  }
  const e = m.get(fam);
  e.fields.add(field);
  e.stars.add(starKey);
  e.constellations.add(constellationId);
  if (!onPowerStar) e.passiveStars.add(starKey);
}

for (const c of data) {
  for (const s of c.stars) {
    const key = `${c.id}#${s.index}`;
    // A stat on a power star describes the PROC, not the player. `skillActiveDuration`
    // is the clearest case: 33 stars, every one a power star, and it means "how long
    // the proc lasts" -- nothing a character can scale.
    const onPower = Boolean(s.proc);
    for (const f of Object.keys(s.stats)) add('character', f, c.id, key, onPower);
    // buff/projectile grants are still the player's own stats
    if (s.grants && s.grants.kind !== 'pet') {
      for (const f of Object.keys(s.grants.stats)) add('character', f, c.id, key, onPower);
    }
    // bonuses granted TO your pets
    if (s.petBonus) {
      for (const f of Object.keys(s.petBonus.stats)) add('pet', f, c.id, key, onPower);
    }
  }
}

// petLimit / petBurstSpawn sit on the star itself and read as character stats, but
// they are only meaningful to a pet build -- move them across.
const PET_SIDE = new Set(['petLimit', 'petBurstSpawn']);
for (const fam of [...ns.character.keys()]) {
  if (PET_SIDE.has(fam)) {
    const e = ns.character.get(fam);
    ns.character.delete(fam);
    const existing = ns.pet.get(fam);
    if (existing) {
      e.fields.forEach(x => existing.fields.add(x));
      e.stars.forEach(x => existing.stars.add(x));
      e.constellations.forEach(x => existing.constellations.add(x));
    } else ns.pet.set(fam, e);
  }
}

function finish(map, space) {
  // 1. resolve each raw family to a keyword
  const base = [];
  for (const e of map.values()) {
    let keyword = null;
    for (const f of [...e.fields].sort()) {
      keyword = keywordFor(f, labels, e.family);
      if (keyword) break;
    }
    base.push({
      family: e.family, keyword, category: categoryOf(e.family),
      fields: [...e.fields].sort(), stars: e.stars, constellations: e.constellations,
      passiveStars: e.passiveStars,
    });
  }

  // 2. fold merged families into one chip, keeping members individually searchable
  const chips = new Map();
  for (const b of base) {
    const mergedName = MERGE_GROUPS[b.family] ?? null;
    const id = mergedName ?? b.family;
    if (!chips.has(id)) {
      chips.set(id, {
        id,
        keyword: mergedName ?? b.keyword,
        merged: Boolean(mergedName),
        namespace: space,
        category: mergedName ? (MERGED_CATEGORY[mergedName] ?? b.category) : b.category,
        members: [], fields: new Set(), stars: new Set(), constellations: new Set(),
        passiveStars: new Set(),
      });
    }
    const c = chips.get(id);
    c.members.push({ family: b.family, keyword: b.keyword, fields: b.fields });
    b.fields.forEach(f => c.fields.add(f));
    b.stars.forEach(s => c.stars.add(s));
    b.constellations.forEach(x => c.constellations.add(x));
    b.passiveStars.forEach(x => c.passiveStars.add(x));
  }

  // 3. finalise
  const out = [...chips.values()].map(c => ({
    id: c.id,
    keyword: c.keyword,
    namespace: c.namespace,
    category: c.category,
    merged: c.merged,
    // Everything a typed query should match against, including the names of
    // families folded into this chip.
    searchTerms: [...new Set([c.keyword, ...c.members.map(m => m.keyword)].filter(Boolean))],
    members: c.merged ? c.members.map(m => ({ family: m.family, keyword: m.keyword })) : undefined,
    fields: [...c.fields].sort(),
    starCount: c.stars.size,
    constellationCount: c.constellations.size,
    // How many of those stars are ordinary stars rather than power stars.
    passiveStarCount: c.passiveStars.size,
    // A keyword that appears ONLY on power stars describes the proc, not the player --
    // "Skill Duration" is how long a proc lasts, "Weapon Damage" is the proc dealing
    // weapon damage. Nothing a character scales, so it must not be targetable. Kept in
    // the index (still searchable, still counted) but out of the picker.
    procOnly: c.stars.size > 0 && c.passiveStars.size === 0,
    // Merged chips are always worth browsing; a bare family needs some prevalence.
    browsable: (c.stars.size > 0 && c.passiveStars.size === 0)
      ? false
      : (c.merged || c.stars.size >= (BROWSE_MIN_STARS[space] ?? 5)),
  }));

  out.sort((a, b) => b.starCount - a.starCount || a.keyword.localeCompare(b.keyword));
  return out;
}

const result = {
  character: finish(ns.character, 'character'),
  pet: finish(ns.pet, 'pet'),
};

const outPath = path.join(dir, '../keywords.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));

for (const ns of ['character', 'pet']) {
  const a = result[ns];
  const browse = a.filter(x => x.browsable);
  const merged = a.filter(x => x.merged);
  console.log(
    `${ns.padEnd(10)} ${String(a.length).padStart(3)} chips | browsable ${String(browse.length).padStart(3)}`
    + ` | search-only ${String(a.length - browse.length).padStart(3)} | merged ${merged.length}`
    + ` | unnamed ${a.filter(x => !x.keyword).length}`,
  );
}
console.log('written to', outPath);
console.log();
for (const ns of ['character', 'pet']) {
  console.log(`--- ${ns}: browsable chips by category ---`);
  const by = {};
  for (const k of result[ns].filter(x => x.browsable)) (by[k.category] ??= []).push(k);
  for (const [cat, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${cat} (${list.length}): ${list.map(k => k.keyword + (k.merged ? '*' : '')).join(', ')}`);
  }
  console.log();
}
console.log('* = merged chip');
