// Turn a star's raw DBR stats into the lines a player would read.
//
// Lines are kept as a TEMPLATE plus its numbers rather than a finished string, because
// the same data has to serve two jobs: showing one star, and showing the sum over a
// whole constellation. "+15% Cold Damage" on star 1 and "+24%" on star 4 must aggregate
// to "+39% Cold Damage", which you cannot do by joining strings. Keeping `{v}` in the
// template also means the page never needs labels.json -- the wording is already baked
// in, only the number moves.
//
// Three different things live in `labels.json`, and treating them alike produces
// nonsense like "20 +{0} Defensive Ability":
//
//   1. TEMPLATES  -- 310 of them, e.g. "+{0} Defensive Ability", "{0}% Elemental
//      Resistance", "Increases Shield Block Chance by {0}%". These already carry the
//      wording, the sign and the position of the number. Substitute; never concatenate.
//   2. PLAIN NAMES -- a label with no placeholder. Needs a sign and a unit adding.
//   3. NO LABEL AT ALL -- the ~66 damage fields iagd composes at runtime from
//      `customtag_damage_*` plus the damage-type table. `damageKeyword()` in fields.mjs
//      already reproduces that, so they resolve to names like "Cold Damage".
//
// Everything in cases 2 and 3 is grouped by family before rendering, because Min and
// Max are one statement and object key order is NOT reliable -- Tsunami's power star
// lists `offensiveColdMax` before `offensiveColdMin`, which a linear pass renders as
// "37 Cold Damage" followed by "26-37 Cold Damage".

import { damageKeyword, isTechnical } from './fields.mjs';

const SUFFIX = /(DurationModifier|DurationMin|DurationMax|Modifier|Min|Max)$/;

/** Per-level arrays take their first entry: the value at the rank you buy it. */
const num = (v) => {
  const x = Array.isArray(v) ? v[0] : v;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return Number.isInteger(x) ? x : Math.round(x * 10) / 10;
};

const tidy = n => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);

/**
 * @returns array of { tmpl, v, v2, fields }
 *   tmpl   display string with `{v}` (and `{v2}` for a range) where numbers go
 *   v, v2  the numbers, kept separate so they can be summed across stars
 *   fields the DBR fields the line came from, so a caller can map it to a keyword chip
 */
export function effectLines(stats, labels = {}) {
  const out = [];
  const groups = new Map();

  for (const [field, rawValue] of Object.entries(stats ?? {})) {
    if (isTechnical(field)) continue;
    const v = num(rawValue);
    if (v == null || v === 0) continue;

    const label = labels[field];
    if (label && /\{\d\}/.test(label)) {
      // A handful of templates want values this field doesn't carry -- "Knock down
      // target for {0}-{1} Seconds" needs its sibling Max, "+{0}% Less Damage From {3}"
      // needs a creature-type name we never extracted. Five occurrences in the whole
      // tree, so skip them rather than build sibling-pairing machinery: a missing line
      // is better than one reading "+10% Less Damage From {v}".
      if (new Set(label.match(/\{\d\}/g)).size > 1) continue;
      // Normalise iagd's {0} to our own placeholder; the number stays separate.
      out.push({ tmpl: label.replace(/\{\d\}/g, '{v}'), v, v2: null, fields: [field] });
      continue;
    }

    const name = label ?? damageKeyword(field);
    if (!name) continue;

    const m = SUFFIX.exec(field);
    const base = m ? field.slice(0, -m[1].length) : field;
    const role = m ? m[1] : 'flat';
    // Fields are tracked per ROLE, not per group. "+50% Frostburn Damage" and "+50%
    // Frostburn Duration" share a base, so one shared list made both lines claim both
    // fields -- and whichever chip won, one of them was mislabelled.
    if (!groups.has(base)) groups.set(base, { fields: [], durFields: [] });
    const g = groups.get(base);
    const isDur = role.startsWith('Duration');
    (isDur ? g.durFields : g.fields).push(field);

    if (role === 'DurationModifier') { g.durPct = v; g.durName = name; }
    else if (role === 'DurationMin' || role === 'DurationMax') { g.dur = v; g.durName = name; }
    else {
      g.name = name;
      if (role === 'Modifier') g.pct = v;
      else if (role === 'Min') g.lo = v;
      else if (role === 'Max') g.hi = v;
      else g.flat = v;
    }
  }

  for (const g of groups.values()) {
    if (g.pct != null) out.push({ tmpl: `+{v}% ${g.name}`, v: g.pct, v2: null, fields: g.fields });
    const lo = g.lo ?? g.flat;
    if (lo != null) {
      // A duration is a property of the effect, not a quantity to add up, so it stays
      // literal in the template while the damage number remains summable. The line's
      // SUBJECT is the damage, so the damage fields lead -- that is what decides which
      // keyword chip highlights it.
      const tail = g.dur != null ? ` over ${g.dur} seconds` : '';
      const range = (g.hi != null && g.hi !== lo);
      out.push({
        tmpl: range ? `{v}-{v2} ${g.name}${tail}` : `{v} ${g.name}${tail}`,
        v: lo, v2: range ? g.hi : null, fields: [...g.fields, ...g.durFields],
      });
    } else if (g.dur != null) {
      out.push({ tmpl: `{v} seconds ${g.durName ?? g.name}`, v: g.dur, v2: null, fields: g.durFields });
    }
    if (g.durPct != null) {
      out.push({ tmpl: `+{v}% ${g.durName ?? g.name}`, v: g.durPct, v2: null, fields: g.durFields });
    }
  }
  return out;
}

/** Fill a line's numbers in. */
export const renderLine = ({ tmpl, v, v2 }) =>
  String(tmpl)
    .replaceAll('{v2}', String(tidy(v2 ?? 0)))
    // replaceAll, because a template may name the same value twice.
    .replaceAll('{v}', String(tidy(v ?? 0)));

/**
 * Sum lines that say the same thing.
 *
 * Grouped by template, so "+{v}% Cold Damage" from two different stars becomes one
 * line. Anything whose wording differs stays separate, which is the honest outcome --
 * "+15% Cold Damage" and "26-37 Cold Damage" are not the same statement.
 */
export function aggregate(lines) {
  const by = new Map();
  for (const l of lines) {
    const k = l.tmpl;
    if (!by.has(k)) by.set(k, { ...l, v: 0, v2: l.v2 == null ? null : 0, fields: [] });
    const g = by.get(k);
    g.v += l.v ?? 0;
    if (g.v2 != null) g.v2 += l.v2 ?? 0;
    for (const f of l.fields ?? []) if (!g.fields.includes(f)) g.fields.push(f);
  }
  return [...by.values()].map(g => ({ ...g, v: tidy(g.v), v2: g.v2 == null ? null : tidy(g.v2) }));
}
