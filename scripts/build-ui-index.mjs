// Emits ui-index.json -- a compact index the UI can ship without loading the full
// 390KB devotions.raw.json. Browsable keywords plus, per constellation, how many of
// its stars carry each keyword.
//
// Usage: node scripts/build-ui-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PET_SIDE_FIELDS } from '../src/lib/fields.mjs';
import { buildDb } from '../src/lib/select.mjs';
import { solveBest } from '../src/lib/solver.mjs';

const dir = import.meta.dirname;
const kw = JSON.parse(fs.readFileSync(path.join(dir, '../keywords.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(dir, '../devotions.raw.json'), 'utf8'));

// chip id -> chip, for browsable chips only
const chips = [];
for (const ns of ['character', 'pet']) {
  for (const c of kw[ns]) if (c.browsable) chips.push({ id: `${ns}:${c.id}`, label: c.keyword, ns, cat: c.category, stars: c.starCount });
}

/**
 * Celestial powers as their own kind of chip.
 *
 * Every other chip is a stat keyword and scores by counting stars across the tree.
 * A power is a single named thing on one star of one constellation, so it is a target,
 * not a score -- `kind: 'power'` is what the solver and the Coverage panel branch on.
 *
 * Players know these by the power's name, not the constellation's, and 58 of the 62
 * differ: Targo's Hammer is on Anvil, Twin Fangs on Bat. Searching for "Targo" found
 * nothing before this.
 *
 * `min` is the cheapest way in: the number of stars on the path from the root to the
 * power star. It is NOT the constellation's size -- 40 of the 62 powers can be had
 * without finishing the constellation, and Fetid Pool is 3 of Affliction's 7. Those
 * partial takes grant no affinity, which is a fair trade when you only want the proc.
 */
const powerChips = [];
for (const c of data) {
  const power = c.stars.filter(s => s.proc).sort((a, b) => b.maxLevel - a.maxLevel)[0];
  if (!power) continue;
  const idx = c.stars.indexOf(power) + 1;
  let min = 0;
  for (let a = idx; a; a = c.stars[a - 1]?.prereq ?? 0) min++;
  powerChips.push({
    id: `power:${c.id}`,
    label: power.name ?? c.name,
    ns: 'character',
    cat: 'Celestial Powers',
    kind: 'power',
    cons: c.id,
    star: idx,
    min,
    size: c.starCount,
    stars: 1,        // a power is one thing; `stars` exists so the picker can count
  });
}
powerChips.sort((a, b) => a.label.localeCompare(b.label));
chips.push(...powerChips);

// field -> chip id, per namespace
const fieldToChip = new Map();
for (const ns of ['character', 'pet']) {
  for (const c of kw[ns]) {
    if (!c.browsable) continue;
    for (const f of c.fields) fieldToChip.set(`${ns}:${f}`, `${ns}:${c.id}`);
  }
}

const constellations = [];
for (const c of data) {
  const hits = {};
  // Per-star chip coverage, so the selector can work out the smallest prefix of a
  // constellation that still carries the keywords you asked for. Stars are listed in
  // devotionLinks order, which is the order you buy them.
  const perStar = [];
  for (const s of c.stars) {
    const seen = new Set();
    const mark = (ns, field) => {
      // petLimit/petBurstSpawn sit in star.stats but belong to the pet namespace,
      // so look them up there regardless of where they were found.
      const space = PET_SIDE_FIELDS.has(field) ? 'pet' : ns;
      const id = fieldToChip.get(`${space}:${field}`);
      if (id) seen.add(id);
    };
    for (const f of Object.keys(s.stats)) mark('character', f);
    if (s.grants && s.grants.kind !== 'pet') for (const f of Object.keys(s.grants.stats)) mark('character', f);
    if (s.petBonus) for (const f of Object.keys(s.petBonus.stats)) mark('pet', f);
    for (const id of seen) hits[id] = (hits[id] ?? 0) + 1;
    perStar.push([...seen]);
  }
  // A constellation has at most one celestial power; take the highest-capped star
  // carrying a proc.
  const power = c.stars
    .filter(s => s.proc)
    .sort((a, b) => b.maxLevel - a.maxLevel)[0] ?? null;

  // All five Crossroads share the display name "Crossroads", which is useless in a
  // path you're following in game -- you need to know which one to click. Append the
  // affinity it grants.
  const name = c.crossroads
    ? `Crossroads (${Object.keys(c.granted)[0] ?? '?'})`
    : c.name;

  constellations.push({
    id: c.id,
    n: name,
    s: c.starCount,
    r: c.required,
    g: c.granted,
    cr: c.crossroads ? 1 : 0,
    p: power ? 1 : 0,                       // has a celestial power
    // The power's own numbers, so the UI can score it without loading the full
    // devotions.raw.json: [chance, recharge seconds, level cap].
    pw: power ? [power.proc.chance ?? 0, power.cooldown ?? 0, power.maxLevel ?? 1] : null,
    // 1-based index of the star holding the power (last star in 53 of 62 cases,
    // mid-constellation in the other 9), so a passives-only build knows where to stop.
    pi: power ? c.stars.indexOf(power) + 1 : 0,
    k: hits,
    ks: perStar,
    // Star names in purchase order. devotionLinks always points at a lower index
    // (verified: 0 stars have a prereq after them), so index order is already a legal
    // purchase order and needs no topological sort. Most stars just repeat the
    // constellation name; the power star is the one that differs.
    sn: c.stars.map(s => s.name ?? null),
    // 1-based parent star index per star (null for the root). Single-parent tree.
    sp: c.stars.map(s => s.prereq ?? null),
  });
}

// --- per-keyword ceiling ---------------------------------------------------
// The most stars of a keyword you could physically obtain: that keyword as the sole
// objective, all 55 points, POWERS OFF. Without it the Coverage panel can't tell "the
// solver skimped" from "this is all there is" -- Skill Radius appears once in each of
// 15 constellations costing 98 points between them, so ~5 stars is everything.
//
// Powers off matters. Computing it per scoring mode (with that mode's power bonus)
// measured the wrong thing: at max rank the power bonus dominates a single-keyword
// objective, so the solve chased procs instead of the keyword and returned ceilings
// BELOW what real builds achieve -- Acid Resistance said 1 where a real build got 5.
// 12 breaches in 900 checks. With powers off it's a genuine physical bound and the
// same number serves every mode; a mode showing 4/12 is then telling you something
// true, that powers are eating points this keyword could have had.
//
// NOT A PROOF. It comes from the same local search as everything else, so it can
// undershoot: Elemental Damage solos to 17 but one multi-tag build reached 19 (1 case
// in 1200). Best-of-several-attempts drives that down, and the UI clamps with
// max(ceiling, achieved) so an undershoot can never render as 19/17.
const out = { chips, constellations };
{
  const db = buildDb(out);
  for (const chip of chips) {
    // A power has no ceiling to measure against -- you either secure it or you don't,
    // and the solver treats it as a hard target rather than something to maximise.
    if (chip.kind === 'power') { chip.ceiling = 1; continue; }
    let best = 0;
    for (const weight of [1, 3]) {
      for (const timeBudgetMs of [600, 1200]) {
        const r = solveBest(db, [{ id: chip.id, weight }], { mode: 0, timeBudgetMs });
        if (!r.schedule) continue;
        best = Math.max(best, r.solution.reduce(
          (n, e) => n + (db.constellations[e.id]?.hits?.[chip.id] ?? 0), 0));
      }
    }
    chip.ceiling = best;
  }
}

const outPath = path.join(dir, '../ui-index.json');
fs.writeFileSync(outPath, JSON.stringify(out));
const keywordChips = chips.filter(c => c.kind !== 'power');
const capped = keywordChips.filter(c => c.ceiling < c.stars).length;
console.log('keyword chips:', keywordChips.length,
  `(${capped} cannot be fully maxed within the 55 point cap)`);
console.log('celestial power chips:', powerChips.length,
  `(${powerChips.filter(c => c.min < c.size).length} reachable without finishing the constellation)`);
console.log('constellations:', constellations.length);
console.log('size:', (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
