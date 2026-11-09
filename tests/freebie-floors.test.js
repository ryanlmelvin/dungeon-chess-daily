// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, rankFloors, generateDaily, searchCandidate, GENERATOR_VERSION } from '../src/generation.js';
import { DIFFICULTY_TIERS, knobsFor, tierForDate, freebieFloor, floorMinimums } from '../src/difficulty.js';
import { act, createGame, scoredMoves } from '../src/rules.js';
import { encodeRoute } from '../src/route-code.js';

test('no tier rules out quick floors any more: the freebie rule stays a tool for comparing rules', () => {
  // A floor the route clears in two moves that a person needs several to find is
  // a clever short floor, what the week now climbs with (src/difficulty.js MAX_FLOOR_PAR).
  assert.deepEqual(Object.fromEntries(Object.entries(DIFFICULTY_TIERS).map(([tier, entry]) => [tier, entry.minFloorMoves])),
    { gentle: 0, fair: 0, tricky: 0, tough: 0, fiendish: 0 });
  for (const tier of ['gentle', 'fair', 'tricky', 'tough', 'fiendish', 'standard']) assert.equal(freebieFloor({ floorMoves: [1, 2, 3] }, tier), false, tier);
  // Given a rule, it still finds a quick floor.
  assert.equal(freebieFloor({ floorMoves: [2, 9, 9] }, 'tough', 3), true);
  assert.equal(freebieFloor({ floorMoves: [9, 9, 1] }, 'tough', 3), true);
  assert.equal(freebieFloor({ floorMoves: [3, 9, 3] }, 'tough', 3), false);
  assert.equal(freebieFloor({}, 'fiendish', 3), false, 'no floor moves recorded, nothing to judge');
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

test('under a freebie rule a quick floor is never assembled, but the candidate’s other floors still are', () => {
  // Each floor 1 a gap point at 10 runs; only the floor moves differ.
  const found = (floorMoves) => ({ points: [10, 10, 10], runs: 10, pars: [5, 5, 5], metrics: { threatenedDecisions: 9, floorMoves }, floors: floorMoves.map((moves) => ({ turns: moves, lives: 0 })) });
  const days = (list, rule) => rankFloors(list, 3, 'tough', rule).map((entry) => entry.floors);
  // By default quick floors are assembled like any other.
  assert.deepEqual(days([found([2, 8, 8]), found([5, 8, 8])])[0], [0, 0, 0]);
  // Under the old rule (3 moves), floor 1 of the first candidate is out: floor 1 comes from the second.
  assert.ok(days([found([2, 8, 8]), found([5, 8, 8])], 3).every((floors) => floors[0] === 1));
  assert.deepEqual(days([found([2, 8, 8]), found([5, 8, 8])], 3)[0], [1, 0, 0]);
  assert.deepEqual(days([found([2, 8, 8]), found([2, 8, 8])], 3), [], 'both quick on floor 1: no day');
  assert.deepEqual(days([found([2, 8, 8]), null, found([8, 8, 1]), found([8, 2, 8])], 3)[0], [2, 0, 0]);
  assert.equal(days([found([3, 8, 8])], 3).length, 1, 'three moves is no freebie');
  assert.equal(days([found([3, 8, 8])], [4, 0, 0]).length, 0, 'or another rule');
});

// A real first candidate, past the stored editions, whose route clears a floor in under three moves.
function quickCandidate() {
  for (let day = 0; day < 40; day++) {
    const date = new Date(Date.UTC(2031, 2, 1 + day)).toISOString().slice(0, 10);
    const tier = tierForDate(date);
    const base = getRawDaily(date), knobs = knobsFor(tier, base.playerPiece);
    const found = searchCandidate(candidateFor(base, tier, knobs, 0));
    if (found.metrics && found.metrics.threatenedDecisions >= knobs.minThreatenedDecisions && freebieFloor(found.metrics, tier, 3)) return { date, tier, knobs, found };
  }
  return null;
}

test('a route with a quick floor certifies on any tier, searched or stored', (t) => {
  const quick = quickCandidate();
  if (!quick) { t.skip('no quick first candidate among the scanned dates'); return; }
  const { date, tier, knobs, found } = quick;
  // Floor moves are the route's par: moves until each floor's challenge was complete.
  let state = createGame(candidateFor(getRawDaily(date), tier, knobs, 0));
  for (const action of found.actions) state = act(state, action);
  assert.deepEqual(found.metrics.floorMoves, state.records.map(scoredMoves));
  const daily = generateDaily(date, { maxAttempts: 1, fallback: false });
  assert.deepEqual(daily.generation.attempt, [0, 0, 0], `${date}: the first candidate alone makes the day`);
  // Remembered on a device, the same route replays.
  const store = new Map([[`dchess-edition:v${GENERATOR_VERSION}:${date}`, JSON.stringify({ tier, attempt: [0, 0, 0], route: encodeRoute(found.actions) })]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  try {
    const remembered = generateDaily(date, { fallback: false });
    assert.deepEqual([remembered.generation.attempt, remembered.generation.certificate.actions], [[0, 0, 0], found.actions]);
  } finally { delete globalThis.localStorage; }
});
