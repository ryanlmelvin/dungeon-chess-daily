// SPDX-License-Identifier: GPL-3.0-only
// The capped human gap: the measure each day's target uses (src/difficulty.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_TIERS, TIER_IDS, WEEKDAY_TARGETS, GAP_RUN_CAP, GAP_FLOOR_WEIGHTS, HUMAN_MOVE_CAP, cappedGap, floorGapPoints, humanGap, knobsFor, tierForDate, targetForDate } from '../src/difficulty.js';
import { getRawDaily } from '../src/edition.js';
import { ATTEMPTS, candidateFor, rankFloors, generateDaily, searchCandidates } from '../src/generation.js';
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

test('the day targets and the tier bands lie inside the range the capped gap can take', () => {
  const most = GAP_RUN_CAP * GAP_FLOOR_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  assert.ok(WEEKDAY_TARGETS.every((target) => target > 0 && target < most));
  let previous = -Infinity;
  for (const tier of TIER_IDS) {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    assert.ok(low >= 0 && high <= most && low > previous && high > low, tier);
    previous = low;
  }
});

test('floor points add up to the capped gap', () => {
  const certified = [5, 6, 8];
  const human = { results: [[won(7), won(9)], [won(4), won(30)], [won(8), lost()]], certified };
  assert.deepEqual(floorGapPoints(human), [2 + 4, 0 + 10, 0 + 10]);
  assert.equal(cappedGap(human), (2 + 4) / 2 + 10 / 2 + 10 / 2);
});

test('generation measures every solved candidate with the human-like bot, as par does, and assembles the day nearest its target', () => {
  // Past the stored editions, so generation searches: a Thursday (Tough) knight day.
  const date = '2031-03-13', base = getRawDaily(date), tier = tierForDate(date), settings = knobsFor(tier, base.playerPiece);
  const target = targetForDate(date);
  assert.equal(target, 7);
  const found = searchCandidates(base, tier, settings);
  assert.ok(found.some((entry) => entry.status === 'solved'), 'a solved candidate to measure');
  for (const [attempt, entry] of found.entries()) {
    if (entry.status !== 'solved') { assert.equal(entry.gap, undefined); continue; }
    const human = humanPar({ ...candidateFor(base, tier, settings, attempt), generation: { certificate: { actions: entry.actions } } });
    assert.deepEqual(entry.human, human, `candidate ${attempt}: the bot's runs on its route`);
    assert.deepEqual(human.certified, entry.metrics.floorMoves);
    assert.equal(entry.gap, cappedGap(human));
    assert.deepEqual(entry.points, floorGapPoints(human));
  }
  // Search stops at the first candidate that lets an assembly land on the target, else tries them all.
  const stop = found.findIndex((_, count) => rankFloors(found.slice(0, count + 1), target, tier)[0]?.within);
  assert.equal(found.length, stop >= 0 ? stop + 1 : ATTEMPTS);
  const [best] = rankFloors(found, target, tier);
  const daily = generateDaily(date, { fallback: false });
  assert.deepEqual(daily.generation.attempt, best.floors);
  // Each floor plays as it did in its own candidate: the day's runs, par and gap are its floors'.
  const human = humanPar(daily);
  best.floors.forEach((attempt, floor) => {
    assert.deepEqual(human.results[floor], found[attempt].human.results[floor], `floor ${floor + 1}`);
    assert.equal(human.par[floor], found[attempt].human.par[floor]);
  });
  const points = floorGapPoints(human).reduce((sum, value) => sum + value, 0);
  assert.equal(points, best.floors.reduce((sum, attempt, floor) => sum + found[attempt].points[floor], 0), 'the gap the day was aimed with');
  // The edition's par, as the game works it out (src/par.js, past the stored
  // window), comes from the very runs its floors were judged on: the gap uses
  // whatever recruit policy par plays with, never a hard-coded one.
  const shown = humanSummary(daily);
  assert.deepEqual(shown.par, human.par);
  assert.deepEqual(shown.runs, human.runs);
});
