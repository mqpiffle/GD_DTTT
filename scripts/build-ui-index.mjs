// Emits ui-index.json -- a compact index the UI can ship without loading the full
// 390KB devotions.raw.json. Browsable keywords plus, per constellation, how many of
// its stars carry each keyword.
//
// Usage: node scripts/build-ui-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PET_SIDE_FIELDS } from '../src/lib/fields.mjs';
import { effectLines } from '../src/lib/effects.mjs';
import { buildDb } from '../src/lib/select.mjs';
import { solveBest } from '../src/lib/solver.mjs';

const dir = import.meta.dirname;
const kw = JSON.parse(fs.readFileSync(path.join(dir, '../keywords.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(dir, '../devotions.raw.json'), 'utf8'));
// labels.json is regenerated from iagd; labels.extra.json is our own corrections and
// wins where both define a field.
const LABELS = {
  ...JSON.parse(fs.readFileSync(path.join(dir, '../labels.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(dir, '../labels.extra.json'), 'utf8')),
};

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

/**
 * Compact a line for the index, and resolve which keyword chip it belongs to.
 *
 * The chip is what lets the UI put a bonus you asked for in a coloured pill. A line can
 * come from several fields (Min + Max are one statement), but they share a family and
 * therefore a chip, so the first match is enough.
 *
 * Shape: [template, value, value2 | 0, chipId | 0]. Zeros rather than nulls because
 * JSON writes them shorter and the UI treats both as absent.
 */
function packLines(lines) {
  return (lines ?? []).map((l) => {
    // Damage fields before duration fields. A damage-over-time merges two of them into
    // one statement -- "25 Frostburn Damage over 2 seconds" -- and taking whichever came
    // first tagged it as Frostburn DURATION, so it never highlighted for someone who had
    // asked for Frostburn Damage. The subject of the line is the damage.
    const fields = [...(l.fields ?? [])]
      .sort((a, b) => (/Duration/.test(a) ? 1 : 0) - (/Duration/.test(b) ? 1 : 0));
    let chip = 0;
    for (const f of fields) {
      const space = l.pet || PET_SIDE_FIELDS.has(f) ? 'pet' : 'character';
      const id = fieldToChip.get(`${space}:${f}`);
      if (id) { chip = id; break; }
    }
    return [l.tmpl, l.v ?? 0, l.v2 ?? 0, chip];
  });
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
    // What each star gives, as [template, value, value2, chipId] -- see effects.mjs for
    // why the number is kept out of the string. Composed here so the page needs neither
    // labels.json nor the damage-template logic.
    //
    // PASSIVES ONLY. A proc's numbers are a different statement -- they fire on a
    // trigger rather than applying to your sheet -- so summing them into a
    // constellation total would be wrong. They go in `fxp`.
    //
    // A POWER STAR'S OWN `stats` ARE THE PROC. Only 31 of the 62 powers define
    // themselves through `grants`; the other 25 sit inline on the star, which is why
    // Tsunami's "0.7 Seconds Skill Recharge" turned up in its passive total. This is the
    // same rule that makes a keyword proc-only when every one of its stars has a proc.
    fx: c.stars.map(s => packLines([
      ...(s.proc ? [] : effectLines(s.stats, LABELS)),
      // Marked in the TEXT, not just routed to the pet namespace. 40 of the 43 pet
      // fields reuse a player stat's name, so Shepherd's Crook star 1 rendered its
      // character Health and its pet Health as two identical "+19% Health" lines.
      ...effectLines(s.petBonus?.stats, LABELS)
        .map(l => ({ ...l, tmpl: `${l.tmpl} (pets)`, pet: true })),
    ])),
    // What the celestial power does: its own stats plus whatever skill it grants.
    // Empty on every star but the power star.
    // Proc lines carry TWO sets of numbers: at rank 1, and at the power's own cap.
    //
    // A proc's stats are per-level arrays and the display took `[0]` regardless of the
    // scoring mode, so "CP Max" showed rank-1 numbers -- and that is not an edge case:
    // 236 of the 413 proc lines differ between the two. Measured before choosing how to
    // ship it: appending the max-rank pair only where it differs costs 1.3 KB raw and
    // 0.5 KB gzipped on a 227 KB / 24.5 KB index, so shipping the full per-rank arrays
    // was never worth considering.
    fxp: c.stars.map((s) => {
      const at = rank => (s.proc ? [
        ...effectLines(s.stats, LABELS, { rank }),
        ...(s.grants && s.grants.kind !== 'pet' ? effectLines(s.grants.stats, LABELS, { rank }) : []),
      ] : []);
      const lo = packLines(at('first'));
      const hi = packLines(at('last'));
      // Same input in the same order, so the two pack to matching lines -- but a guard
      // costs nothing and a silently mismatched pair would show one line's rank-1 value
      // beside another's maximum.
      return lo.map((l, i) => {
        const h = hi[i];
        if (!h || h[0] !== l[0]) return l;
        return (h[1] === l[1] && h[2] === l[2]) ? l : [...l, h[1], h[2]];
      });
    }),
  });
}

// --- per-keyword ceiling ---------------------------------------------------
// The most stars of a keyword you could physically obtain: that keyword as the sole
// objective, all 55 points, POWERS OFF. Without it the Coverage panel can't tell "the
// solver skimped" from "this is all there is" -- Physical Damage is on 37 stars spread
// over 17 constellations costing 95 points between them, so 23 is everything reachable.
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
