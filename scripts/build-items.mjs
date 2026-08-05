// Emits items-index.json -- the stats carried by every item a character could be
// wearing, so an imported save can be read for what the character is actually built for.
//
// WHY A SEPARATE FILE FROM ui-index.json. That one is fetched on every page view, and
// most sessions never import a save. This is fetched only when one is, so nobody pays for
// a feature they do not use.
//
// WHAT IS KEPT, AND WHY IT IS NOT AGGREGATED. Only fields belonging to a BROWSABLE chip
// survive -- the same filter build-keywords.mjs applies, which drops proc-only stats and
// anything unlabelled. But the raw field names are kept rather than summed per chip,
// because flat and percentage values mean completely different things here:
//
//   offensiveLightningMin       +8 lightning damage   -- a small flat addition
//   offensiveLightningModifier  +110% lightning       -- what the build is FOR
//
// Summing those into one "lightning" number would destroy the distinction the whole
// strength signal rests on. Aggregating is the reader's job, once it knows which question
// it is asking.
//
// COVERAGE. A full run walks records/items and records/storyelements, which is every
// directory an equipped record can come from. Deliberately included and easy to forget:
// lootaffixes/prefixunique and suffixunique (rare and monster-infrequent affixes),
// faction (augments), upgraded (mythical versions), awakened, transmutes and materia.
// Directories that hold nothing a player can equip -- enemygear, lootchests, loottables,
// loreobjects, misc -- fall out on their own, since a record with no chip-mapped stat is
// not written.
//
// STILL NOT MODELLED: lootsets. Set bonuses fire on item count rather than sitting on an
// item, so they need their own pass. No character tested so far wears a set.
//
// Usage: node scripts/build-items.mjs <folder containing records/items>
//        ONLY=items/gearweapons node scripts/build-items.mjs <folder>   (one directory)
//        FRESH=1 node scripts/build-items.mjs <folder>                  (rebuild)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? path.join(import.meta.dirname, '../..');
const itemsDir = path.join(ROOT, 'records/items');
const extraDirs = ['records/storyelements'];   // quest rewards live outside records/items

if (!fs.existsSync(itemsDir)) {
  console.error(`no records/items under ${ROOT}`);
  console.error('usage: node scripts/build-items.mjs <folder containing records/items>');
  process.exit(1);
}

const dir = import.meta.dirname;
const kw = JSON.parse(fs.readFileSync(path.join(dir, '../keywords.json'), 'utf8'));

/**
 * DBR field -> chip id, for browsable chips only.
 *
 * A chip already lists the fields that belong to it, so this is a reuse rather than a
 * second derivation -- which matters, because a field mapped differently here than in the
 * picker would propose a tag that does not exist.
 */
const fieldToChip = new Map();
for (const ns of ['character', 'pet']) {
  for (const chip of kw[ns]) {
    if (!chip.browsable) continue;
    for (const f of chip.fields ?? []) fieldToChip.set(f, `${ns}:${chip.id}`);
  }
}
console.log(`${fieldToChip.size} fields map to a browsable chip`);

/** Every .dbr under a directory, depth-first. */
function* walk(root) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.dbr')) yield p;
  }
}

/** The roll half-width for an item that declares none. See DERIVED-STATS-PROBE.md. */
const DEFAULT_JITTER = 20;

// MERGING. 26,000 files over a slow filesystem is more than one sitting, so a run can
// cover part of the tree and be resumed: ONLY=<subpath> scans one directory and folds the
// result into whatever is already there. A full rebuild is FRESH=1.
const outPath = path.join(dir, '../items-index.json');
const ONLY = process.env.ONLY ?? '';
const prior = (!process.env.FRESH && fs.existsSync(outPath))
  ? JSON.parse(fs.readFileSync(outPath, 'utf8'))
  : { fields: [], items: {} };

const fieldNames = [...(prior.fields ?? [])];
const fieldIndex = new Map(fieldNames.map((f, i) => [f, i]));
const idxOf = (f) => {
  if (!fieldIndex.has(f)) { fieldIndex.set(f, fieldNames.length); fieldNames.push(f); }
  return fieldIndex.get(f);
};

const items = { ...(prior.items ?? {}) };
let scanned = 0, kept = 0;

// Reading ~26,000 small files is I/O bound and takes a while, so it says where it is.
// LIMIT exists for checking correctness on a subset without waiting for the whole run.
const LIMIT = Number(process.env.LIMIT ?? 0);
// SKIP lets one oversized directory be covered in two runs.
const SKIP = Number(process.env.SKIP ?? 0);
let seen = 0;
const started = Date.now();

const roots = ONLY
  ? [path.join(ROOT, 'records', ONLY)]
  : [itemsDir, ...extraDirs.map(d => path.join(ROOT, d))];
for (const base of roots) {
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base)) {
    if (SKIP && ++seen <= SKIP) continue;
    if (LIMIT && scanned >= LIMIT) break;
    scanned++;
    if (scanned % 4000 === 0) {
      console.log(`  ${scanned} scanned, ${kept} kept  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    const text = fs.readFileSync(file, 'latin1');
    const stats = [];
    let jitter = null;
    let isComponent = false;

    for (const line of text.split('\n')) {
      const i = line.indexOf(',');
      if (i < 0) continue;
      const key = line.slice(0, i);

      if (key === 'lootRandomizerJitter') {
        jitter = Number(String(line.slice(i + 1)).split(',')[0]) || 0;
        continue;
      }
      if (key === 'Class') { isComponent = line.includes('ItemRelic'); continue; }

      if (!fieldToChip.has(key)) continue;
      // Per-rank arrays exist on skills, not items; take the first value defensively.
      const v = Number(String(line.slice(i + 1)).split(',')[0].split(';')[0]);
      if (!Number.isFinite(v) || v === 0) continue;
      stats.push(idxOf(key), v);
    }

    if (!stats.length) continue;
    kept++;
    // Keys are the bulk of the payload, so the shared prefix goes once.
    const rec = path.relative(ROOT, file).replace(/\\/g, '/').replace(/^records\//, '');
    items[rec] = {
      s: stats,
      // Components are FIXED; everything else rolls. Affixes declare their jitter, base
      // and quest items declare none and get 20%. Measured -- see DERIVED-STATS-PROBE.md.
      j: isComponent ? 0 : (jitter ?? DEFAULT_JITTER),
    };
  }
}

const out = { prefix: 'records/', fields: fieldNames, items };
fs.writeFileSync(outPath, `${JSON.stringify(out)}\n`);

const size = fs.statSync(outPath).size;
console.log(`scanned ${scanned} records this run, kept ${kept}; ${Object.keys(items).length} in the index`);
console.log(`${fieldNames.length} distinct fields used`);
console.log(`items-index.json: ${(size / 1024).toFixed(1)} KB`);
