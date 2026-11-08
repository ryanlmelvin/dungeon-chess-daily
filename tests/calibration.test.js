// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_TIERS, TIER_IDS, WEEKDAY_TIERS, RECIPE, MIN_DECOYS, MAX_DECOYS, tierForDate, tierLabel, knobsFor, difficultyScore, bandDistance } from '../src/difficulty.js';
import { CALIBRATION, CALIBRATION_REPORT } from '../src/calibration.js';
import { FALLBACKS } from '../src/fallbacks.js';
import { PLAYABLE_PIECES } from '../src/pieces.js';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, chooseCandidate, generateDaily, getDaily } from '../src/generation.js';
import { createGame as createCandidate, paperSuspects } from '../src/rules.js';
import { createGame, validateSave, act } from '../src/game.js';

// 2026-11-09 is a Monday.
const WEEK = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];

test('the tier rises from Monday to the weekend, by UTC weekday', () => {
  const ranks = WEEK.map((date) => DIFFICULTY_TIERS[tierForDate(date)].rank);
  assert.deepEqual(WEEK.map(tierForDate), ['gentle', 'fair', 'tricky', 'tough', 'tough', 'fiendish', 'fiendish']);
  for (let index = 1; index < ranks.length; index++) assert.ok(ranks[index] >= ranks[index - 1], WEEK[index]);
  assert.equal(ranks[0], 1, 'Monday is the easiest');
  assert.equal(ranks[5], TIER_IDS.length, 'Saturday is the hardest');
  assert.equal(ranks[6], TIER_IDS.length, 'Sunday is the hardest');
  assert.equal(new Set(WEEKDAY_TIERS).size, TIER_IDS.length, 'every tier appears in the week');
  assert.equal(tierLabel('2026-11-12'), 'Difficulty: Tough');
  // The edition date is UTC: late Sunday evening in New York is already Monday.
  assert.equal(getRawDaily(new Date('2026-11-08T20:00:00-05:00')).date, '2026-11-09');
});

test('tier bands are contiguous and increasing', () => {
  let previous = DIFFICULTY_TIERS.gentle.band[0];
  for (const tier of TIER_IDS) {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    assert.equal(low, previous, tier);
    assert.ok(high > low, tier);
    previous = high;
  }
  assert.ok(Number.isFinite(previous));
  assert.equal(bandDistance(DIFFICULTY_TIERS.tricky.band[0], 'tricky'), 0);
  assert.equal(bandDistance(DIFFICULTY_TIERS.tricky.band[1], 'tricky'), 0);
  assert.equal(bandDistance(DIFFICULTY_TIERS.tricky.band[1] + 1, 'tricky'), 1);
  assert.equal(bandDistance(DIFFICULTY_TIERS.tricky.band[0] - 2, 'tricky'), 2);
});

test('the difficulty score grows with every kind of pressure', () => {
  const base = { turns: 20, threatenedDecisions: 5, narrowEscapes: 1, livesLost: 0, unsafeAlternatives: 10, legalAlternatives: 100 };
  const score = difficultyScore(base, 'pawn');
  for (const [key, value] of Object.entries({ threatenedDecisions: 8, narrowEscapes: 3, livesLost: 2, unsafeAlternatives: 30 })) {
    assert.ok(difficultyScore({ ...base, [key]: value }, 'pawn') > score, key);
  }
  assert.equal(difficultyScore({ ...base, legalAlternatives: 0, unsafeAlternatives: 0 }, 'pawn') <= score, true);
  assert.ok(Number.isFinite(score));
  // The same pressure is harder with fewer lives to spare.
  const unharmed = { ...base, livesLost: 0 };
  assert.ok(difficultyScore(unharmed, 'queen') > difficultyScore(unharmed, 'rook'));
  assert.ok(difficultyScore(unharmed, 'rook') > difficultyScore(unharmed, 'pawn'));
});

test('every tier and piece shares the room recipe and turns only the residents dial, never down', () => {
  for (const piece of PLAYABLE_PIECES) {
    let previous = null;
    for (const tier of TIER_IDS) {
      const row = CALIBRATION[tier]?.[piece];
      assert.ok(row, `${tier}/${piece} is calibrated`);
      assert.deepEqual(Object.keys(row).sort(), ['decoys', 'guards'], `${tier}/${piece} holds only the residents dial`);
      const knobs = knobsFor(tier, piece);
      for (const [knob, value] of Object.entries(RECIPE)) assert.equal(knobs[knob], value, `${tier}/${piece} takes ${knob} from the recipe`);
      // At least one decoy: a floor of targets alone has one suspect in the paper, no silver and no royal guard.
      assert.ok(Number.isInteger(knobs.decoys) && knobs.decoys >= MIN_DECOYS && knobs.decoys <= MAX_DECOYS, `${tier}/${piece} keeps at least one decoy`);
      assert.ok(Number.isInteger(knobs.guards) && knobs.guards >= 0 && knobs.guards <= knobs.decoys);
      if (previous) assert.ok(knobs.decoys >= previous.decoys && knobs.guards >= previous.guards, `${piece}: the dial never turns down into ${tier}`);
      previous = knobs;
      assert.ok(CALIBRATION_REPORT.tiers?.[tier]?.[piece], `${tier}/${piece} has measurements`);
      const entry = FALLBACKS[`${tier}:${piece}:white`];
      assert.ok(entry, `${tier}/${piece} has a fallback`);
      assert.deepEqual(entry.knobs, { obstacleBase: knobs.obstacleBase, decoys: knobs.decoys, scatter: knobs.scatter, guards: knobs.guards, screens: knobs.screens });
    }
  }
  assert.throws(() => knobsFor('standard', 'rook'), RangeError);
});

test('a public week: two suspects on every floor, and no floor falls to the first move', () => {
  for (const date of WEEK) {
    const daily = getDaily(date);
    for (const floor of [0, 1, 2]) assert.equal(paperSuspects(daily, floor).length, 2, `${date} floor ${floor + 1} has a decoy to suspect`);
    // Scattered targets start off the piece's opening lines (src/difficulty.js RECIPE).
    const { floorMoves } = daily.generation.certificate.metrics;
    assert.ok(floorMoves.every((moves) => moves >= 2), `${date}: floors took ${floorMoves.join('/')} moves`);
  }
});

test('generateDaily keeps the first candidate whose capped human gap is in the band, else the closest', () => {
  const [low, high] = DIFFICULTY_TIERS.tricky.band;
  const found = (gap, threatenedDecisions = 9, score = 12) => ({ gap, score, metrics: { threatenedDecisions } });
  assert.equal(chooseCandidate([found(low), found(low + 0.1)], 'tricky', 0), 0);
  assert.equal(chooseCandidate([found(low - 5), found(low)], 'tricky', 0), 1);
  assert.equal(chooseCandidate([found(low - 5), found(high + 1)], 'tricky', 0), 1);
  assert.equal(chooseCandidate([found(low - 1), found(high + 1)], 'tricky', 0), 0, 'ties keep the earlier');
  assert.equal(chooseCandidate([null, found(low, 1)], 'tricky', 2), -1, 'too few threatened decisions');
  assert.equal(chooseCandidate([], 'tricky', 0), -1);
  // The difficulty score is kept for reference only: it never picks.
  assert.equal(chooseCandidate([found(high + 4, 9, (low + high) / 2), found(high, 9, 99)], 'tricky', 0), 1);
  // A solved candidate without a measured gap can't be judged against the band.
  assert.equal(chooseCandidate([{ score: 12, metrics: { threatenedDecisions: 9 } }, found(low)], 'tricky', 0), 1);
  assert.equal(chooseCandidate([{ ...found(low), gap: null }], 'tricky', 0), -1);
});

test('the public edition takes its tier from the weekday and its knobs from the table, deterministically', () => {
  for (const date of ['2026-11-09', '2026-11-12', '2026-11-15']) {
    const daily = getDaily(date);
    const tier = tierForDate(date);
    const knobs = knobsFor(tier, daily.playerPiece);
    assert.equal(daily.difficulty, tier);
    for (const knob of ['obstacleBase', 'decoys', 'scatter', 'guards', 'screens']) assert.equal(daily[knob], knobs[knob], `${date} ${knob}`);
    assert.ok(daily.generation.certificate.metrics.threatenedDecisions >= knobs.minThreatenedDecisions);
    assert.equal(daily.generation.certificate.score, difficultyScore(daily.generation.certificate.metrics, daily.playerPiece));
    assert.deepEqual(generateDaily(date), daily, `${date} regenerates identically`);
    assert.deepEqual(getDaily(date, { difficulty: tier }), daily);
  }
});

test('saves bind to the edition tier and stay valid along the certified route', () => {
  const date = '2026-11-14';
  const daily = getDaily(date);
  let state = createGame(daily);
  assert.equal(state.difficulty, 'fiendish');
  assert.equal(validateSave(state, date), true);
  for (const action of daily.generation.certificate.actions.slice(0, 6)) {
    state = act(state, action);
    assert.equal(validateSave(state, date), true, JSON.stringify(action));
  }
  const other = createGame(getDaily(date, { difficulty: 'gentle' }));
  assert.equal(validateSave(other, date), false, 'another tier is not the public edition');
  assert.equal(validateSave(other, date, { difficulty: 'gentle' }), true);
  const tampered = { ...createGame(daily), guards: (daily.guards + 1) % 3 };
  assert.equal(validateSave(tampered, date), false, 'knobs cannot be edited');
});

test('screens wall off the longest open lines into the targets without adding walls', () => {
  const base = getRawDaily('2026-11-10');
  const room = (screens) => createCandidate(candidateFor(base, 'tough', { obstacleBase: 10, decoys: 2, scatter: 0, guards: 1, screens }));
  const plain = room(0), screened = room(3);
  assert.equal(screened.props.length, plain.props.length);
  assert.deepEqual(screened.enemies, plain.enemies);
  // Squares a target can see along open lines: screens leave fewer.
  const sight = (state) => state.enemies.filter((foe) => foe.piece === state.objective.piece).reduce((sum, foe) => {
    let seen = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (let x = foe.x + dx, y = foe.y + dy; x >= 0 && y >= 0 && x < 8 && y < 8 && state.map[y][x] !== '#' && !state.enemies.some((other) => other.x === x && other.y === y); x += dx, y += dy) seen++;
    }
    return sum + seen;
  }, 0);
  assert.ok(sight(screened) < sight(plain), `${sight(screened)} < ${sight(plain)}`);
  assert.deepEqual(room(3).map, screened.map);
});
