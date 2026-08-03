// Turning a parsed save into a character this app can hold.
//
// The reading is `gdc.mjs`'s job; this is the translation layer, and it is separate for
// one reason: the interesting part is a mapping over data, and keeping it out of the DOM
// means it can be tested without one.
//
// The join is by DBR record path. A save names the devotion stars a character has bought
// as `records/skills/devotion/tier1_01a.dbr`, and `ui-index.json` carries the same stems
// per constellation in `sr`. That makes import a lookup rather than a matching problem --
// no name comparison, no heuristics, and nothing that can drift as display names change.

/** Shared by all 559 devotion records; stored once in the index rather than per star. */
export const REF_PREFIX = 'records/skills/devotion/';

/** `records/skills/devotion/tier1_01a.dbr` -> `tier1_01a.dbr` */
export const refStem = ref =>
  (ref?.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : ref) ?? null;

/**
 * stem -> `constellationId:starIndex`, the key `state.done` uses.
 *
 * Star indexes are 1-BASED here because that is what the tick keys use everywhere else;
 * `sr` is a plain array, so the off-by-one is the obvious mistake and it would silently
 * shift every imported tick to the star before it.
 */
export function starKeyByRef(constellations) {
  const map = new Map();
  for (const c of constellations ?? []) {
    (c.sr ?? []).forEach((stem, i) => { if (stem) map.set(stem, `${c.id}:${i + 1}`); });
  }
  return map;
}

/**
 * Match a save's bought devotions onto the planner's stars.
 *
 * @returns { keys, unmatched } -- `unmatched` names any record the index does not know,
 *          which should be empty and is reported rather than swallowed. A star that fails
 *          to map is progress silently lost, and the symptom would be a character that
 *          looks like it has bought less than it has.
 */
export function mapDevotions(refs, constellations) {
  const byRef = starKeyByRef(constellations);
  const keys = [];
  const unmatched = [];
  for (const ref of refs ?? []) {
    const key = byRef.get(refStem(ref));
    if (key) keys.push(key); else unmatched.push(ref);
  }
  return { keys, unmatched };
}

/**
 * How much of what was imported the current plan actually shows.
 *
 * Ticks are stored per constellation and star, independent of any plan, but the Detail
 * and Overview panels only render constellations the CURRENT plan contains. So a
 * character whose real devotions differ from the tags you happen to have set will import
 * correctly and appear to have lost stars.
 *
 * Nothing is dropped -- the ticks are all there and reappear if the plan changes to
 * include them. But "you have 52 stars and this plan shows 30 of them" is a fact the
 * player needs told, and it is the first thing they would otherwise report as a bug.
 */
export function offPlan(keys, planStarKeys) {
  const inPlan = new Set(planStarKeys ?? []);
  return (keys ?? []).filter(k => !inPlan.has(k));
}

/**
 * A display name for a character read from a save.
 *
 * `classId` is a TAG (`tagSkillClassName0607`), not a name. classes.json resolves it;
 * where it cannot, the character's own name is still worth having, so this degrades to
 * the bare name rather than refusing.
 */
export function characterLabel({ name, level, classId }, classes = {}) {
  const cls = classes?.[classId];
  const bits = [name];
  if (level) bits.push(`lvl ${level}`);
  if (cls) bits.push(cls);
  return bits.length > 1 ? `${bits[0]} (${bits.slice(1).join(' ')})` : String(bits[0] ?? '');
}
