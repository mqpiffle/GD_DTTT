// Ports StatTranslator/EnglishLanguage.cs (MIT, marius00/iagd) into labels.json,
// keyed by DBR field name exactly as Grim Dawn writes it, plus the resistance
// families EnglishLanguage.cs builds programmatically in its constructor.
//
// Usage: node scripts/port-labels.mjs <path-to-iagd-clone>
import fs from 'node:fs';
import path from 'node:path';

const IAGD = process.argv[2];
if (!IAGD) { console.error('usage: node port-labels.mjs <path-to-iagd-clone>'); process.exit(1); }
const srcPath = path.join(IAGD, 'StatTranslator/EnglishLanguage.cs');
const src = fs.readFileSync(srcPath, 'utf8');

// Pull just the _stats dictionary initializer body (between its `{` and the matching `}`).
const markerIdx = src.indexOf('new Dictionary<string, string> {');
const braceIdx = src.indexOf('{', markerIdx + 'new Dictionary<string, string> '.length);
let depth = 0, i = braceIdx, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const body = src.slice(braceIdx + 1, end);

// Entries look like {"key", "value"} or { "key", "value" }, values may contain
// escaped quotes (\") but no C# string concatenation, so a straightforward
// regex over quoted pairs is safe.
const pairRe = /\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
const raw = {};
let m;
while ((m = pairRe.exec(body))) {
  const key = m[1].replace(/\\"/g, '"');
  const val = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  if (!(key in raw)) raw[key] = val; // SetTagIfMissing semantics: first entry wins
}

// --- Programmatic resistance families (EnglishLanguage constructor) ---
const BodyDamageTypes = [
  'SlowPoison', 'SlowPhysical', 'SlowBleeding', 'Bleeding', 'SlowLife', 'SlowFire',
  'SlowCold', 'SlowLightning', 'Poison', 'Chaos', 'Fire', 'Aether', 'Bleeding',
  'Cold', 'Lightning', 'Elemental', 'Pierce', 'Physical', 'Life', 'TotalDamage',
  'PercentCurrentLife',
];

function damageTypeTranslation(d, tags) {
  const base = d.replace(/Modifier/g, '');
  const localized = tags[base];
  if (localized) return localized;
  return base.replace(/Base/g, '');
}

const resistance = raw['Resistance'] ?? 'Resistance';
const toMaxResistance = raw['ResistanceMaxResist'] ?? '';
for (const damageType of new Set(BodyDamageTypes)) {
  const r = damageTypeTranslation(damageType, raw);
  const k1 = `defensive${damageType}`, k2 = `defensive${damageType}Resistance`, k3 = `defensive${damageType}MaxResist`;
  if (!(k1 in raw)) raw[k1] = `{0}% ${r} ${resistance}`;
  if (!(k2 in raw)) raw[k2] = `{0}% ${r} ${resistance}`;
  if (!(k3 in raw)) raw[k3] = `{0}% ${toMaxResistance}${r} ${resistance}`;
}

// --- Hand-written additions ---
// iagd is an ITEM tool, so devotion-only fields are legitimately missing from it.
// labels.extra.json holds our own entries and wins over the port.
let extraCount = 0;
const extraPath = path.join(import.meta.dirname, '../labels.extra.json');
if (fs.existsSync(extraPath)) {
  const extra = JSON.parse(fs.readFileSync(extraPath, 'utf8'));
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith('_')) continue;         // _comment and friends
    raw[k] = v;
    extraCount++;
  }
}

const outPath = path.join(import.meta.dirname, '../labels.json');
fs.writeFileSync(outPath, JSON.stringify(raw, Object.keys(raw).sort(), 1));
console.log('entries ported from iagd:', Object.keys(raw).length - extraCount);
console.log('hand-written entries merged:', extraCount);
console.log('total:', Object.keys(raw).length);
console.log('written to', outPath);
