// What switching from the build you have to the one being suggested would cost.
//
// Two paths side by side invite eyeballing: you can see both and still not know what
// changing means. So this reduces them to the three facts that make it a decision --
// what you KEEP, what you would BUY, what you would GIVE UP -- and the point cost of
// doing it.
//
// WHY CONSTELLATIONS AND NOT STARS. The unit of a devotion decision is the
// constellation: you commit to one, walk into it, and its affinity is what unlocks the
// next. A star-level diff would report "you keep 4 of Owl's 5 stars" as though that were
// a decision, when the real question is whether you are in Owl at all. Where the two
// paths take the same constellation to DIFFERENT depths, that is worth saying, and it is
// carried on the row rather than split into its own category.

/**
 * Constellation id -> points committed AT THE END, from a scheduled path.
 *
 * REFUNDS ARE APPLIED, NOT SKIPPED, and the difference showed up on screen as a
 * suggestion of 57 stars for a character whose maximum is 55.
 *
 * A Crossroads is often bought as a stepping stone and refunded once the constellation it
 * unlocked is paid for. Skipping the refund step left the Crossroads in the total, so the
 * column summed what the path SPENDS rather than what it ends up holding. Those are
 * different numbers, and only one of them can be compared against a build.
 *
 * The comparison is about STATES -- these constellations, this many stars -- so anything
 * that nets to nothing was never really taken and is not a row. A refund step carries
 * negative points, so applying it is simply addition.
 */
function pointsById(path) {
  const out = new Map();
  for (const p of path ?? []) {
    out.set(p.id, (out.get(p.id) ?? 0) + (p.points ?? 0));
  }
  // Bought and given back is not owned. Dropping the entry rather than leaving a zero
  // keeps it out of the rows entirely, which is what it deserves: showing "Crossroads 0"
  // beside a build would be reporting a decision nobody made.
  for (const [id, pts] of out) if (pts <= 0) out.delete(id);
  return out;
}

/**
 * Compare what a character owns against what is being suggested.
 *
 * @param actual     scheduled path entries for the build they have
 * @param suggested  scheduled path entries for the proposal
 * @returns {
 *   rows,      one per constellation in either path, in suggested order then leftovers
 *   keep, buy, lose,   counts
 *   cost,      points that must be SPENT to get there
 *   refund,    points that come back from what is given up
 *   net,       cost - refund: the honest bottom line
 * }
 *
 * A row is `{ id, status, actualPoints, suggestedPoints, deeper }` where status is
 * `keep`, `buy` or `lose`, and `deeper` is set when both sides take the constellation
 * but to different depths.
 */
export function diffPaths(actual, suggested) {
  const have = pointsById(actual);
  const want = pointsById(suggested);

  const rows = [];
  const seen = new Set();

  // Suggested order first, because that is the path being proposed and the order it
  // would be walked in. Anything only in `actual` is appended -- it has no place in the
  // new path by definition, so there is nowhere else it could sit.
  for (const [id, pts] of want) {
    seen.add(id);
    const mine = have.get(id);
    rows.push(mine == null
      ? { id, status: 'buy', actualPoints: 0, suggestedPoints: pts, deeper: 0 }
      : { id, status: 'keep', actualPoints: mine, suggestedPoints: pts, deeper: pts - mine });
  }
  for (const [id, pts] of have) {
    if (seen.has(id)) continue;
    rows.push({ id, status: 'lose', actualPoints: pts, suggestedPoints: 0, deeper: 0 });
  }

  let cost = 0;
  let refund = 0;
  for (const r of rows) {
    if (r.status === 'buy') cost += r.suggestedPoints;
    else if (r.status === 'lose') refund += r.actualPoints;
    // A kept constellation taken DEEPER still costs the difference, and one taken
    // shallower gives points back. Ignoring that would under-report the cost of a switch
    // that mostly reshapes what you already own -- which is the common case.
    else if (r.deeper > 0) cost += r.deeper;
    else if (r.deeper < 0) refund += -r.deeper;
  }

  const count = s => rows.filter(r => r.status === s).length;
  return {
    rows,
    keep: count('keep'),
    buy: count('buy'),
    lose: count('lose'),
    cost,
    refund,
    net: cost - refund,
  };
}

/**
 * A one-line summary of what switching means.
 *
 * Written here rather than in the renderer because the phrasing IS the design: "18 points
 * to switch" is what turns two columns into a decision, and it should not drift into
 * whatever a template happens to say.
 */
export function summarise(d, { available = null } = {}) {
  if (!d || !d.rows.length) return 'Nothing to compare.';
  if (!d.buy && !d.lose && !d.rows.some(r => r.deeper)) {
    return 'Your build already matches the suggestion.';
  }
  const bits = [];
  if (d.keep) bits.push(`keeping ${d.keep}`);
  if (d.buy) bits.push(`buying ${d.buy}`);
  if (d.lose) bits.push(`giving up ${d.lose}`);

  // SWITCHING AND COMPLETING ARE DIFFERENT THINGS, and calling both "to switch" is the
  // most misleading thing this line could say.
  //
  // A finished character has all their points spent, so adopting a suggestion means
  // refunding and rebuying -- a real respec, decided now. A levelling character has most
  // of the path still ahead of them, and the same number is not a cost at all, it is the
  // rest of the game. Measured on a real level 34: 45 "points to switch" against the 1
  // point he actually had spare.
  //
  // `available` is what they can spend TODAY -- earned minus already committed. Without
  // it this cannot tell the two apart, so it says the neutral thing.
  const net = d.net;
  if (net === 0) return `${bits.join(' · ')} · no change in points`;
  if (net < 0) return `${bits.join(' · ')} · ${-net} points freed up`;

  if (available == null) return `${bits.join(' · ')} · ${net} points`;
  if (net <= available) return `${bits.join(' · ')} · ${net} points to switch, and you have ${available}`;
  return `${bits.join(' · ')} · ${net} points, of which you can spend ${available} now`;
}
