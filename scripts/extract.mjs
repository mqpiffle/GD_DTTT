import fs from 'node:fs';
import path from 'node:path';

// Point at the folder containing records/ and text/text_en/ from the
// ArchiveTool -database extraction.
const ROOT = process.argv[2] ?? path.join(import.meta.dirname, '../..');
const rec = p => path.join(ROOT, p.replace(/\\/g, '/'));

// DBR files are "key,value," per line, written by Windows tools (CRLF).
export function parseDbr(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const i = line.indexOf(',');
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/,$/, '');
  }
  return out;
}

// --- Display text -----------------------------------------------------------
// FileDescription is a DEVELOPER label and is wrong for 27 of 109 constellations
// ("Sandclaw" is really Nighttalon, "Pestilence" is Affliction). Always resolve
// the *DisplayTag / skillDisplayName field against text_en instead.
function loadTags() {
  const dir = rec('text/text_en');
  const tags = {};
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return tags; }
  for (const f of files) {
    if (!f.endsWith('.txt')) continue;
    let text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) tags[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return tags;
}
const TAGS = loadTags();
const tag = t => (t && TAGS[t] !== undefined ? TAGS[t] : null);

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Star records are full template dumps: ~700 fields, nearly all 0. Keep only real values.
const SKIP = /^(templateName|Class|FileDescription|.*Bitmap.*|.*bitmap.*|.*Tag$|skillDisplayName|.*XOR|.*Global)$/;
function stats(dbr) {
  const out = {};
  for (const [k, v] of Object.entries(dbr)) {
    if (SKIP.test(k)) continue;
    if (v.includes(';')) {
      const parts = v.split(';');
      if (!parts.every(x => /^-?\d+(\.\d+)?$/.test(x))) continue;
      const arr = parts.map(num);
      if (arr.every(n => n === 0)) continue;
      out[k] = arr;                       // per-level values (celestial powers)
    } else {
      if (!/^-?\d+(\.\d+)?$/.test(v)) continue;
      const n = num(v);
      if (n === 0) continue;
      out[k] = n;
    }
  }
  return out;
}

// skillMaxLevel lies (reads 1 even on 25-level powers). Real cap is the XP table
// length -- but for buff-backed powers that table lives in the CHILD record, which
// is why those 11 stars used to report maxLevel 1.
const levelsOf = dbr => (dbr?.skillExperienceLevels ? dbr.skillExperienceLevels.split(';').length : 0);

// --- Nested effect records --------------------------------------------------
// 31 of 559 stars are shells whose real stats live one level down. Nesting never
// goes deeper than one level (verified), so no recursion needed.
//   buffSkillName       (11) -- parent is near-empty; name AND stats are in the child.
//                              Includes Hungering Void and Assassin's Mark.
//   skillProjectileName (20) -- parent keeps its own stats; child adds the projectile's.
//   spawnObjects        (7)  -- a PER-LEVEL list of pet records (one per skill level),
//                              not a set of different pets. Take the last = max level.
const PLAYER_SHAPED = /^(offensive|defensive|retaliation|character|skill|pet|racial|weapon|conversion)/;

// --- Pet bonuses ------------------------------------------------------------
// 96 of 559 stars carry a `petBonusName` pointing at a record of bonuses granted
// to YOUR PETS ("+60% Total Damage to all pets"). Critically these reuse the exact
// same field names as player stats -- `offensiveTotalDamageModifier` means one
// thing in `stats` and a completely different thing here -- so they must stay in
// their own namespace or a "total damage" keyword search would conflate the two.
function readPetBonus(db) {
  if (!db?.petBonusName) return null;
  const sub = parseDbr(rec(db.petBonusName));
  if (!sub) return null;
  const s = stats(sub);
  if (!Object.keys(s).length) return null;
  return { ref: db.petBonusName, stats: s };
}

function readGrant(db) {
  if (db.buffSkillName) {
    const sub = parseDbr(rec(db.buffSkillName));
    if (!sub) return null;
    return {
      kind: 'buff', ref: db.buffSkillName,
      displayTag: sub.skillDisplayName ?? null,
      name: tag(sub.skillDisplayName),
      maxLevel: levelsOf(sub) || 1,
      cooldown: num(sub.skillCooldownTime),
      duration: num(sub.skillActiveDuration),
      stats: stats(sub),
    };
  }
  if (db.skillProjectileName) {
    const sub = parseDbr(rec(db.skillProjectileName));
    if (!sub) return null;
    return {
      kind: 'projectile', ref: db.skillProjectileName,
      displayTag: sub.skillDisplayName ?? null,
      name: tag(sub.skillDisplayName),
      maxLevel: levelsOf(sub) || 1,
      cooldown: num(sub.skillCooldownTime),
      duration: num(sub.skillActiveDuration),
      stats: stats(sub),
    };
  }
  if (db.spawnObjects) {
    const list = db.spawnObjects.split(';').filter(Boolean);
    const sub = parseDbr(rec(list[list.length - 1]));
    if (!sub) return null;
    // These point at Pet / PetPlayerScaling CREATURE templates, not skill records --
    // ~800 fields of animation speeds, equip chances and sound weights. Worse, their
    // defensive* values are the PET's own resistances, so merging them into the
    // player-facing objective would make a "fire resistance" search surface Revenant
    // because the skeleton happens to resist fire. So: `stats` is deliberately empty
    // and the pet's own numbers are quarantined under `petOwnStats`, which the
    // objective must ignore unless it is explicitly scoring a pet build.
    const own = {};
    for (const [k, v] of Object.entries(stats(sub))) {
      if (PLAYER_SHAPED.test(k)) own[k] = v;
    }
    return {
      kind: 'pet', ref: list[list.length - 1], levelCount: list.length,
      template: sub.templateName ?? null,
      displayTag: null, name: null,       // creature records carry no skillDisplayName
      maxLevel: levelsOf(sub) || list.length,
      cooldown: num(sub.skillCooldownTime),
      duration: num(sub.skillActiveDuration),
      stats: {},
      petOwnStats: own,
    };
  }
  return null;
}

// --- Proc trigger -----------------------------------------------------------
// templateAutoCast encodes trigger AND chance in its filename, e.g.
// "cast_@enemyonattack_20%.dbr" -> trigger @enemyonattack at 20%.
// The trigger key matches a "cast_@..." entry in labels.json for display text.
// NOTE: for buff-backed stars the field sits on the CHILD record, not the parent --
// Assassin's Mark reads as a non-proc if you only look at the shell.
function readProc(db) {
  if (!db?.templateAutoCast) return null;
  const base = path.basename(db.templateAutoCast, '.dbr');       // cast_@enemyonattack_20%
  const m = base.match(/^(cast_@[^_]+(?:_[a-z0-9]*health)?)_(\d+)%$/i);
  if (!m) return { raw: base, trigger: null, chance: null };
  return { raw: base, trigger: m[1], chance: num(m[2]) };
}

// --- Walk the constellations ------------------------------------------------
const constellations = [];
const dir = rec('records/ui/skills/devotion/constellations');
const files = fs.readdirSync(dir).filter(f => /^constellation\d+\.dbr$/i.test(f)).sort();

for (const f of files) {
  const c = parseDbr(path.join(dir, f));
  if (!c || !c.devotionButton1) continue;

  const affinity = (prefix) => {
    const o = {};
    for (let i = 1; i <= 3; i++) {
      const name = c[`${prefix}Name${i}`], val = num(c[`${prefix}${i}`]);
      if (name && val > 0) o[name.toLowerCase()] = val;
    }
    return o;
  };

  const stars = [];
  for (let i = 1; c[`devotionButton${i}`]; i++) {
    const ui = parseDbr(rec(c[`devotionButton${i}`]));
    const skill = ui?.skillName ? parseDbr(rec(ui.skillName)) : null;
    const grants = skill ? readGrant(skill) : null;
    const grantDbr = grants ? parseDbr(rec(grants.ref)) : null;
    const proc = readProc(skill) ?? readProc(grantDbr);
    const displayTag = skill?.skillDisplayName ?? grants?.displayTag ?? null;

    stars.push({
      index: i,
      ref: ui?.skillName ?? null,
      displayTag,
      name: tag(displayTag),
      // devotionLinks is always a single integer parent (keys run 2..8, star 1
      // never has one), so the intra-constellation graph is a tree, not a DAG.
      prereq: c[`devotionLinks${i}`] ? num(c[`devotionLinks${i}`]) : null,
      maxLevel: Math.max(levelsOf(skill), grants?.maxLevel ?? 0, 1),
      cooldown: num(skill?.skillCooldownTime) || grants?.cooldown || 0,
      template: skill?.templateName ?? null,
      stats: skill ? stats(skill) : {},
      petBonus: skill ? readPetBonus(skill) : null,
      grants,
      proc,
    });
  }

  const required = affinity('affinityRequired');
  const granted = affinity('affinityGiven');

  constellations.push({
    id: f.replace(/\.dbr$/i, ''),
    devName: c.FileDescription ?? null,        // dev label; NOT for display
    displayTag: c.constellationDisplayTag ?? null,
    name: tag(c.constellationDisplayTag) ?? c.FileDescription ?? null,
    starCount: stars.length,
    required,
    granted,
    // The 5 Crossroads: one star, no requirement, grants a single affinity point.
    // The scheduler needs to know these so it can buy one to unblock a requirement
    // and refund it later. Detected structurally rather than by name.
    crossroads: stars.length === 1
      && !Object.keys(required).length
      && Object.values(granted).reduce((s, v) => s + v, 0) === 1,
    stars,
  });
}

// --- Report -----------------------------------------------------------------
const allStars = constellations.flatMap(c => c.stars);
const allFields = new Set();
for (const s of allStars) {
  for (const k of Object.keys(s.stats)) allFields.add(k);
  if (s.grants) for (const k of Object.keys(s.grants.stats)) allFields.add(k);
}

const byKind = k => allStars.filter(s => s.grants?.kind === k).length;
const renamed = constellations.filter(c => c.devName !== c.name).length;

console.log('constellations:', constellations.length);
console.log('stars:', allStars.length);
console.log('distinct non-zero stat fields:', allFields.size);
console.log('affinity names:', [...new Set(constellations.flatMap(c => [...Object.keys(c.required), ...Object.keys(c.granted)]))]);
console.log('maxLevel values seen:', [...new Set(allStars.map(s => s.maxLevel))].sort((a, b) => a - b));
console.log('nested grants: buff', byKind('buff'), '| projectile', byKind('projectile'), '| pet', byKind('pet'));
console.log('stars with a proc trigger:', allStars.filter(s => s.proc).length);
const petStars = allStars.filter(s => s.petBonus);
const petFields = new Set(petStars.flatMap(s => Object.keys(s.petBonus.stats)));
console.log('stars granting pet bonuses:', petStars.length, '| distinct pet-bonus fields:', petFields.size);
console.log('constellations whose display name differs from FileDescription:', renamed);
const noName = allStars.filter(s => !s.name).length;
console.log('stars with an unresolved display name:', noName);
const empty = allStars.filter(s => !Object.keys(s.stats).length && !s.grants).length;
console.log('stars with no stats at all:', empty);

fs.writeFileSync(path.join(import.meta.dirname, '../devotions.raw.json'), JSON.stringify(constellations, null, 1));
