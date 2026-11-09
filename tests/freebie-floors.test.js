// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, rankFloors, generateDaily, searchCandidate, GENERATOR_VERSION } from '../src/generation.js';
import { DIFFICULTY_TIERS, knobsFor, tierForDate, freebieFloor, floorMinimums } from '../src/difficulty.js';
import { act, createGame, scoredMoves } from '../src/rules.js';
import { encodeRoute } from '../src/route-code.js';

test('Tricky and harder tiers want every floor to take at least three moves', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DIFFICULTY_TIERS).map(([tier, entry]) => [tier, entry.minFloorMoves])),
    { gentle: 0, fair: 0, tricky: 3, tough: 3, fiendish: 3 });
  for (const tier of ['tricky', 'tough', 'fiendish']) {
    assert.equal(freebieFloor({ floorMoves: [2, 9, 9] }, tier), true, tier);
    assert.equal(freebieFloor({ floorMoves: [9, 9, 1] }, tier), true, tier);
    assert.equal(freebieFloor({ floorMoves: [3, 9, 3] }, tier), false, tier);
  }
  for (const tier of ['gentle', 'fair', 'standard']) assert.equal(freebieFloor({ floorMoves: [1, 2, 3] }, tier), false, tier);
  assert.equal(freebieFloor({}, 'fiendish'), false, 'no floor moves recorded, nothing to judge');
});

test('tooling can compare other freebie rules: every floor, or floor by floor', () => {
  assert.deepEqual(floorMinimums(4), [4, 4, 4]);
  assert.deepEqual(floorMinimums([4]), [4, 0, 0]);
  assert.deepEqual(floorMinimums(0), [0, 0, 0]);
  assert.deepEqual(floorMinimums(undefined), [0, 0, 0]);
  // Every floor at least four moves.
  assert.equal(freebieFloor({ floorMoves: [9, 3, 9] }, 'tough', 4), true);
  // Floor 1 at least four moves; the later floors may be quick.
  assert.equal(freebieFloor({ floorMoves: [3, 9, 9] }, 'tough', [4, 0, 0]), true);
  assert.equal(freebieFloor({ floorMoves: [4, 1, 2] }, 'tough', [4, 0, 0]), false);
  // A rule passed in replaces the tier's, on any tier.
  assert.equal(freebieFloor({ floorMoves: [1, 1, 1] }, 'tough', 0), false);
  assert.equal(freebieFloor({ floorMoves: [3, 9, 9] }, 'gentle', 4), true);
});

test('a freebie floor is never assembled into a Tricky-or-harder day; the candidate’s other floors still are', () => {
  // Each floor 1 a gap point at 10 runs; only the floor moves differ.
  const found = (floorMoves) => ({ points: [10, 10, 10], runs: 10, metrics: { threatenedDecisions: 9, floorMoves }, floors: floorMoves.map((moves) => ({ turns: moves, lives: 0 })) });
  const days = (list, tier, rule) => rankFloors(list, 3, tier, rule).map((entry) => entry.floors);
  // Floor 1 of the first candidate cleared in two moves: floor 1 comes from the second, the rest from either.
  assert.ok(days([found([2, 8, 8]), found([5, 8, 8])], 'tough').every((floors) => floors[0] === 1));
  assert.deepEqual(days([found([2, 8, 8]), found([5, 8, 8])], 'tough')[0], [1, 0, 0]);
  // Both quick on floor 1: no day, the fallback bank.
  assert.deepEqual(days([found([2, 8, 8]), found([2, 8, 8])], 'tough'), []);
  // Up to sixteen candidates, each floor from any of them that took long enough there.
  assert.deepEqual(days([found([2, 8, 8]), null, found([8, 8, 1]), found([8, 2, 8])], 'tough')[0], [2, 0, 0]);
  assert.equal(days([found([3, 8, 8])], 'tough').length, 1, 'three moves is no freebie');
  assert.equal(days([found([2, 8, 8])], 'fair').length, 1, 'Fair keeps quick floors');
  assert.equal(days([found([2, 8, 8])], 'tough', 0).length, 1, 'tooling may compare without the rule');
  assert.equal(days([found([3, 8, 8])], 'tough', [4, 0, 0]).length, 0, 'or with another one');
});

// A real first candidate, past the stored editions, whose route clears a floor
// in under three moves on a Tricky-or-harder weekday.
function freebieCandidate() {
  for (let day = 0; day < 40; day++) {
    const date = new Date(Date.UTC(2031, 2, 1 + day)).toISOString().slice(0, 10);
    const tier = tierForDate(date);
    if (!DIFFICULTY_TIERS[tier].minFloorMoves) continue;
    const base = getRawDaily(date), knobs = knobsFor(tier, base.playerPiece);
    const found = searchCandidate(candidateFor(base, tier, knobs, 0));
    if (found.metrics && found.metrics.threatenedDecisions >= knobs.minThreatenedDecisions && freebieFloor(found.metrics, tier)) return { date, tier, knobs, found };
  }
  return null;
}

test('a route with a freebie floor never certifies a Tricky-or-harder day, searched or stored', (t) => {
  const freebie = freebieCandidate();
  if (!freebie) { t.skip('no freebie first candidate among the scanned dates'); return; }
  const { date, tier, knobs, found } = freebie;
  // Floor moves are the route's par: moves until each floor's challenge was complete.
  let state = createGame(candidateFor(getRawDaily(date), tier, knobs, 0));
  for (const action of found.actions) state = act(state, action);
  assert.deepEqual(found.metrics.floorMoves, state.records.map(scoredMoves));
  assert.equal(generateDaily(date, { maxAttempts: 1, fallback: false }), null, `${date}: the first candidate alone is rejected`);
  // Remembered on a device, the same route is distrusted and the date searched again.
  const store = new Map([[`dchess-edition:v${GENERATOR_VERSION}:${date}`, JSON.stringify({ tier, attempt: [0, 0, 0], route: encodeRoute(found.actions) })]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  try {
    const daily = generateDaily(date, { fallback: false });
    const quick = found.metrics.floorMoves.findIndex((moves) => moves < DIFFICULTY_TIERS[tier].minFloorMoves);
    assert.ok(daily === null || (daily.generation.attempt[quick] !== 0 && !freebieFloor(daily.generation.certificate.metrics, tier)), date);
  } finally { delete globalThis.localStorage; }
});
