// Tests for the actual-vs-suggested diff.
//
// The whole point of this module is that it answers "what would switching cost me". Every
// failure below is a wrong ANSWER to that question rather than a crash -- a cost that
// looks plausible and is not is worse than no number at all, because it will be acted on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { diffPaths, summarise } from './diff.mjs';

/** A scheduled path, in the shape schedulePath() produces. */
const p = (...steps) => steps.map(([id, points, kind]) => ({ id, points, kind }));

test('a constellation in both sides is KEPT and costs nothing', () => {
  const d = diffPaths(p(['owl', 5], ['vulture', 5]), p(['owl', 5], ['vulture', 5]));
  assert.equal(d.keep, 2);
  assert.equal(d.buy, 0);
  assert.equal(d.lose, 0);
  assert.equal(d.net, 0);
  assert.match(summarise(d), /already matches/);
});

test('what is only suggested is BOUGHT, what is only owned is GIVEN UP', () => {
  const d = diffPaths(p(['owl', 5], ['wraith', 3]), p(['owl', 5], ['tsunami', 6]));
  const by = new Map(d.rows.map(r => [r.id, r.status]));
  assert.equal(by.get('owl'), 'keep');
  assert.equal(by.get('tsunami'), 'buy');
  assert.equal(by.get('wraith'), 'lose');
  assert.equal(d.cost, 6, 'tsunami costs 6');
  assert.equal(d.refund, 3, 'wraith gives 3 back');
  assert.equal(d.net, 3);
});

test('the NET is what the player has to find, not the gross', () => {
  // "Spend 24, get 6 back" makes them do the arithmetic. 18 does not.
  const d = diffPaths(p(['old', 6]), p(['new', 24]));
  assert.equal(d.cost, 24);
  assert.equal(d.refund, 6);
  assert.equal(d.net, 18);
  assert.match(summarise(d), /18 points/);
  assert.doesNotMatch(summarise(d), /24/, 'the gross should not be the headline');
});

test('a kept constellation taken DEEPER still costs the difference', () => {
  // The common case is a switch that mostly reshapes what you already own. Counting only
  // whole constellations would report that as free, which is the most misleading answer
  // this module could give.
  const d = diffPaths(p(['owl', 3]), p(['owl', 7]));
  assert.equal(d.keep, 1);
  assert.equal(d.buy, 0);
  assert.equal(d.rows[0].deeper, 4);
  assert.equal(d.net, 4, 'four more stars in Owl is four more points');
  assert.doesNotMatch(summarise(d), /already matches/);
});

test('and taken SHALLOWER gives points back', () => {
  const d = diffPaths(p(['owl', 7]), p(['owl', 3]));
  assert.equal(d.rows[0].deeper, -4);
  assert.equal(d.refund, 4);
  assert.equal(d.net, -4);
  assert.match(summarise(d), /4 points freed up/);
});

test('refunded Crossroads are NOT part of what you own', () => {
  // THIS TEST USED TO CONTRADICT ITS OWN NAME. It asserted that a bought-and-refunded
  // Crossroads was still owned, which is what the code did and is not what the name says.
  // The name was right: a stepping stone you have already been given back is not part of
  // the build, and counting it made the suggested column read 57 stars for a character
  // whose maximum is 55 -- it was summing what the path SPENDS, not what it ends holding.
  const withRefund = p(['crossroads', 1, 'bootstrap'], ['owl', 5], ['crossroads', -1, 'refund']);
  const d = diffPaths(withRefund, p(['owl', 5]));

  assert.equal(d.lose, 0, 'there is nothing to give up -- the Crossroads was handed back');
  assert.equal(d.rows.find(r => r.id === 'crossroads'), undefined,
    'a constellation that nets to nothing should not be a row at all');
  assert.equal(d.rows.reduce((n, r) => n + r.actualPoints, 0), 5,
    'the total must be the END STATE, not the gross spend');
  assert.equal(d.net, 0, 'the two builds are identical, so switching costs nothing');
});

test('a path that buys and refunds is compared on where it ENDS', () => {
  // The real shape from a level 100: two Crossroads bought as bootstraps and refunded
  // once what they unlocked was paid for. Gross spend 57, final holding 55.
  const suggested = p(['crossroads1', 1, 'bootstrap'], ['owl', 5],
    ['crossroads2', 1, 'bootstrap'], ['vulture', 5],
    ['crossroads1', -1, 'refund'], ['crossroads2', -1, 'refund']);
  const d = diffPaths([], suggested);
  assert.equal(d.rows.reduce((n, r) => n + r.suggestedPoints, 0), 10,
    'the suggested total counted stepping stones the path gives back');
  assert.equal(d.buy, 2, 'only the two real constellations are bought');
});

test('an empty side means everything on the other is new, or all of it goes', () => {
  const fresh = diffPaths([], p(['owl', 5], ['vulture', 5]));
  assert.equal(fresh.buy, 2);
  assert.equal(fresh.keep, 0);
  assert.equal(fresh.net, 10);

  const abandon = diffPaths(p(['owl', 5]), []);
  assert.equal(abandon.lose, 1);
  assert.equal(abandon.net, -5, 'giving everything up frees the points');
});

test('nothing on either side says so rather than pretending', () => {
  const d = diffPaths([], []);
  assert.deepEqual(d.rows, []);
  assert.equal(summarise(d), 'Nothing to compare.');
  assert.equal(summarise(null), 'Nothing to compare.');
});

test('rows follow the SUGGESTED order, with the abandoned appended', () => {
  // The suggested path is the one that would be walked, so it sets the order the eye
  // reads. Anything only in `actual` has no place in it by definition.
  const d = diffPaths(
    p(['gone', 4], ['owl', 5]),
    p(['owl', 5], ['tsunami', 6], ['amatok', 7]),
  );
  assert.deepEqual(d.rows.map(r => r.id), ['owl', 'tsunami', 'amatok', 'gone']);
});

test('the same constellation appearing twice in a path is summed', () => {
  // The scheduler can revisit one -- a partial take early and the rest later. Two rows
  // for one constellation would double-count it in the summary.
  const d = diffPaths(p(['owl', 3], ['owl', 2]), p(['owl', 5]));
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].actualPoints, 5);
  assert.equal(d.net, 0);
});

test('SWITCHING and COMPLETING are told apart', () => {
  // The most misleading thing this line could say is calling both "to switch". A finished
  // character adopting a suggestion is doing a respec, decided now. A levelling character
  // has most of the path still ahead, and the same number is the rest of the game rather
  // than a cost.
  //
  // Measured on a real level 34: 45 "points to switch" against the 1 point he had spare.
  const d = diffPaths(p(['old', 5]), p(['old', 5], ['new', 20]));
  assert.equal(d.net, 20);

  // Someone who can afford it is being asked to decide.
  assert.match(summarise(d, { available: 30 }), /20 points to switch, and you have 30/);

  // Someone who cannot is being told how far they can get.
  assert.match(summarise(d, { available: 3 }), /20 points, of which you can spend 3 now/);
  assert.doesNotMatch(summarise(d, { available: 3 }), /to switch/,
    'calling it a switch when they cannot switch is the bug');

  // And with nothing known, it says the neutral thing rather than guessing.
  assert.match(summarise(d), /20 points$/);
});

test('a build that frees points says so regardless of what is available', () => {
  const d = diffPaths(p(['big', 10]), p(['small', 4]));
  assert.match(summarise(d, { available: 0 }), /6 points freed up/);
});
