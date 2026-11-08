// SPDX-License-Identifier: GPL-3.0-only
// The capped human gap: the measure the tiers' bands use (src/difficulty.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_TIERS, TIER_IDS, GAP_RUN_CAP, GAP_FLOOR_WEIGHTS, HUMAN_MOVE_CAP, cappedGap, humanGap, knobsFor, tierForDate, bandDistance } from '../src/difficulty.js';
import { getRawDaily } from '../src/edition.js';
import { ATTEMPTS, candidateFor, chooseCandidate, generateDaily, searchCandidates } from '../src/generation.js';
import { humanPar } from '../src/human-bot.js';
import { humanSummary } from '../src/par.js';

const won = (moves) => ({ won: true, moves, livesLost: 0 });
const lost = (moves = 12) => ({ won: false, moves, livesLost: 2 });

test('each run counts its moves past the route, from 0 up to the cap, and a failed run counts the cap', () => {
  assert.equal(GAP_RUN_CAP, 10);
  assert.deepEqual([...GAP_FLOOR_WEIGHTS], [1, 1, 1], 'every floor counts the same');
  const certified = [5, 6, 8];
  // Floor 1: 2 and 4 moves past the route. Floor 2: beating the route counts 0,
  // a very slow win no more than the cap. Floor 3: a win on the route and a failure.
  const gap = cappedGap({ results: [[won(7), won(9)], [won(4), won(30)], [won(8), lost()]], certified });
  assert.equal(gap, (2 + 4) / 2 + (0 + 10) / 2 + (0 + 10) / 2);
  assert.equal(cappedGap({ results: [[won(5)], [won(6)], [won(8)]], certified }), 0, 'the bot as quick as the search');
  assert.equal(cappedGap({ results: [[lost()], [lost(40)], [lost(3)]], certified }), 3 * GAP_RUN_CAP, 'every run failed: the most a day measures');
  assert.equal(cappedGap({ results: [[won(6), won(5), won(5)], [won(6)], [won(8)]], certified }), 0.3, 'rounded to tenths');
});

test('one hopeless floor can\'t swamp the capped gap the way it swamps the raw gap', () => {
  const certified = [5, 5, 6];
  const early = [[won(6), won(7), won(6), won(8), won(6)], [won(5), won(6), won(7), won(6), won(5)]];
  const hopeless = { results: [...early, Array.from({ length: 5 }, () => lost(HUMAN_MOVE_CAP))], certified };
  const fine = { results: [...early, [won(7), won(6), won(8), won(7), won(6)]], certified };
  // Raw, the failed king floor costs the whole 40-move cap less the route: 34 moves.
  assert.ok(humanGap(hopeless).total - humanGap(fine).total > 30);
  // Capped, at most the cap, at the king floor's weight.
  const extra = cappedGap(hopeless) - cappedGap(fine);
  assert.ok(extra > 0 && extra <= GAP_RUN_CAP * GAP_FLOOR_WEIGHTS[2], `${extra}`);
  // A failure on an early floor costs as much as the slowest win there, and no more.
  const failedEarly = { results: [[lost(), ...early[0].slice(1)], early[1], fine.results[2]], certified };
  const slowEarly = { results: [[won(5 + 25), ...early[0].slice(1)], early[1], fine.results[2]], certified };
  assert.equal(cappedGap(failedEarly), cappedGap(slowEarly));
});

test('the tier bands rise in equal steps inside the range the capped gap can take', () => {
  const most = GAP_RUN_CAP * GAP_FLOOR_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const width = DIFFICULTY_TIERS[TIER_IDS[0]].band[1] - DIFFICULTY_TIERS[TIER_IDS[0]].band[0];
  let previous = -Infinity;
  for (const tier of TIER_IDS) {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    assert.ok(low >= 0 && high <= most && low > previous, tier);
    assert.equal(high - low, width, `${tier}: every band is as wide`);
    previous = low;
  }
});

test('generation measures every solved candidate with the human-like bot, as par does, and keeps the first in the band', () => {
  // Past the stored editions, so generation searches. A Tough pawn day whose
  // first candidate's gap lies above the band and whose second lies in it.
  const date = '2031-03-06', base = getRawDaily(date), tier = tierForDate(date), settings = knobsFor(tier, base.playerPiece);
  const found = searchCandidates(base, tier, settings);
  assert.ok(found.some((entry) => entry.status === 'solved'), 'a solved candidate to measure');
  for (const [attempt, entry] of found.entries()) {
    if (entry.status !== 'solved') { assert.equal(entry.gap, undefined); continue; }
    const human = humanPar({ ...candidateFor(base, tier, settings, attempt), generation: { certificate: { actions: entry.actions } } });
    assert.deepEqual(entry.human, human, `candidate ${attempt}: the bot's runs on its route`);
    assert.deepEqual(human.certified, entry.metrics.floorMoves);
    assert.equal(entry.gap, cappedGap(human));
  }
  const chosen = chooseCandidate(found, tier, settings.minThreatenedDecisions);
  // Search stops at the first candidate kept inside the band, else tries them all.
  const inBand = chosen >= 0 && bandDistance(found[chosen].gap, tier) === 0;
  assert.equal(found.length, inBand ? chosen + 1 : ATTEMPTS);
  assert.ok(chosen >= 0, 'a candidate is kept');
  const daily = generateDaily(date, { fallback: false });
  assert.equal(daily.generation.attempt, chosen);
  // The edition's par, as the game works it out (src/par.js, past the stored
  // window), comes from the very runs its band was judged on: the gap uses
  // whatever recruit policy par plays with, never a hard-coded one.
  const shown = humanSummary(daily);
  assert.deepEqual(shown.par, found[chosen].human.par);
  assert.deepEqual(shown.runs, found[chosen].human.runs);
});
