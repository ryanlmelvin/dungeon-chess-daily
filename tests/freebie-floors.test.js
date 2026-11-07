// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, chooseCandidate, generateDaily, searchCandidate, GENERATOR_VERSION } from '../src/generation.js';
import { DIFFICULTY_TIERS, knobsFor, tierForDate, freebieFloor } from '../src/difficulty.js';
import { act, createGame, scoredMoves } from '../src/rules.js';
import { encodeRoute } from '../src/route-code.js';

test('Tricky and harder tiers want every floor to take at least four moves', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DIFFICULTY_TIERS).map(([tier, entry]) => [tier, entry.minFloorMoves])),
    { gentle: 0, fair: 0, tricky: 4, tough: 4, fiendish: 4 });
  for (const tier of ['tricky', 'tough', 'fiendish']) {
    assert.equal(freebieFloor({ floorMoves: [3, 9, 9] }, tier), true, tier);
    assert.equal(freebieFloor({ floorMoves: [9, 9, 2] }, tier), true, tier);
    assert.equal(freebieFloor({ floorMoves: [4, 9, 4] }, tier), false, tier);
  }
  for (const tier of ['gentle', 'fair', 'standard']) assert.equal(freebieFloor({ floorMoves: [1, 2, 3] }, tier), false, tier);
  assert.equal(freebieFloor({}, 'fiendish'), false, 'no floor moves recorded, nothing to judge');
});

test('a freebie candidate is skipped for the next one, then the fallback bank', () => {
  const [low] = DIFFICULTY_TIERS.tough.band;
  const found = (floorMoves) => ({ score: low, metrics: { threatenedDecisions: 9, floorMoves } });
  assert.equal(chooseCandidate([found([3, 8, 8]), found([5, 8, 8])], 'tough', 0), 1);
  assert.equal(chooseCandidate([found([3, 8, 8]), found([8, 2, 8])], 'tough', 0), -1);
  assert.equal(chooseCandidate([found([3, 8, 8])], 'fair', 0), 0, 'Fair keeps quick floors');
  assert.equal(chooseCandidate([found([3, 8, 8])], 'tough', 0, 0), 0, 'tooling may compare without the rule');
});

// A real first candidate, past the stored editions, whose route clears a floor
// in under four moves on a Tricky-or-harder weekday.
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
  const store = new Map([[`dchess-edition:v${GENERATOR_VERSION}:${date}`, JSON.stringify({ tier, attempt: 0, route: encodeRoute(found.actions) })]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  try {
    const daily = generateDaily(date, { fallback: false });
    assert.ok(daily === null || (daily.generation.attempt === 1 && !freebieFloor(daily.generation.certificate.metrics, tier)), date);
  } finally { delete globalThis.localStorage; }
});
