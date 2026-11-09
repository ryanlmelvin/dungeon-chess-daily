// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_TIERS, TIER_IDS, WEEKDAY_TIERS, WEEKDAY_TARGETS, TARGET_STEP, DEFAULT_KNOBS, MIN_DECOYS, tierForDate, targetForDate, tierLabel, knobsFor, difficultyScore, bandDistance } from '../src/difficulty.js';
import { CALIBRATION, CALIBRATION_REPORT } from '../src/calibration.js';
import { FALLBACKS } from '../src/fallbacks.js';
import { PLAYABLE_PIECES } from '../src/pieces.js';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, rankFloors, generateDaily, getDaily, TARGET_TOLERANCE } from '../src/generation.js';
import { createGame as createCandidate } from '../src/rules.js';
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

test('every day from Monday to Saturday aims a step harder than the day before; Sunday matches Saturday', () => {
  const targets = WEEK.map((date) => targetForDate(date));
  assert.deepEqual(targets, [3.75, 5.75, 7.75, 9.75, 11.75, 13.75, 13.75]);
  for (let index = 1; index < 6; index++) assert.equal(targets[index] - targets[index - 1], TARGET_STEP, WEEK[index]);
  assert.equal(targets[6], targets[5], 'Sunday is as hard as Saturday');
  assert.deepEqual(WEEK.map((date) => WEEKDAY_TARGETS[new Date(`${date}T12:00:00Z`).getUTCDay()]), targets);
  // Each tier's targets are its weekdays' (Tough has Thursday's and Friday's), and its band holds them at half a step.
  assert.deepEqual([...DIFFICULTY_TIERS.tough.targets], [9.75, 11.75]);
  assert.equal(DIFFICULTY_TIERS.tough.target, 10.75);
  for (const tier of TIER_IDS) {
    const { targets: own, band } = DIFFICULTY_TIERS[tier];
    assert.deepEqual(band, [own[0] - TARGET_STEP / 2, own.at(-1) + TARGET_STEP / 2], tier);
  }
  // Played under another tier (tooling), a date aims at that tier's mean target.
  assert.equal(targetForDate('2026-11-09', 'fiendish'), 13.75);
  assert.equal(targetForDate('2026-11-12', 'tough'), 9.75);
  assert.equal(targetForDate('2026-11-09', 'tough'), 10.75);
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

test('the calibration table covers every tier and piece with valid knobs, and the fallback bank matches it', () => {
  for (const tier of TIER_IDS) for (const piece of PLAYABLE_PIECES) {
    const row = CALIBRATION[tier]?.[piece];
    assert.ok(row, `${tier}/${piece} is calibrated`);
    // screens appears only where calibration chose some.
    assert.deepEqual(Object.keys(row).filter((knob) => knob !== 'screens').sort(), Object.keys(DEFAULT_KNOBS).filter((knob) => knob !== 'screens').sort(), `${tier}/${piece} names every knob`);
    assert.ok([0, 1, 3].includes(knobsFor(tier, piece).screens));
    const knobs = knobsFor(tier, piece);
    assert.ok(Number.isInteger(knobs.obstacleBase) && knobs.obstacleBase >= 0 && knobs.obstacleBase <= 16);
    // Never a floor of targets alone: at least one decoy, even where an older fit chose none.
    assert.ok(Number.isInteger(knobs.decoys) && knobs.decoys >= MIN_DECOYS && knobs.decoys <= 4);
    assert.equal(knobs.decoys, Math.max(MIN_DECOYS, row.decoys));
    assert.ok([0, 1].includes(knobs.scatter));
    assert.ok(Number.isInteger(knobs.guards) && knobs.guards >= 0 && knobs.guards <= knobs.decoys);
    assert.ok(Number.isInteger(knobs.minThreatenedDecisions) && knobs.minThreatenedDecisions >= 0);
    assert.ok(CALIBRATION_REPORT.tiers?.[tier]?.[piece], `${tier}/${piece} has measurements`);
    const entry = FALLBACKS[`${tier}:${piece}:white`];
    assert.ok(entry, `${tier}/${piece} has a fallback`);
    assert.deepEqual(entry.knobs, { obstacleBase: knobs.obstacleBase, decoys: knobs.decoys, scatter: knobs.scatter, guards: knobs.guards, screens: knobs.screens });
  }
  assert.throws(() => knobsFor('standard', 'rook'), RangeError);
});

// A searched candidate as rankFloors sees it: each floor's capped-gap points over `runs` runs, its route's
// moves until each floor's clear, and the moves and lives each floor's part of the route spent.
const candidateOf = (points, { runs = 10, floorMoves = [8, 8, 8], turns = [8, 8, 8], lives = [0, 0, 0] } = {}) => ({
  points, runs, metrics: { threatenedDecisions: 9, floorMoves }, floors: [0, 1, 2].map((floor) => ({ turns: turns[floor], lives: lives[floor] })),
});

test('a day is assembled from the floors of its candidates so that their gaps add up to its target', () => {
  // Gaps of 1 a floor and 4 a floor: two of the first and one of the second make 6.
  const easy = candidateOf([10, 10, 10]), hard = candidateOf([40, 40, 40]);
  const [best] = rankFloors([easy, hard], 6, 'tricky');
  assert.deepEqual(best, { floors: [0, 0, 1], gap: 6, distance: 0, within: true }, 'ties keep the earlier candidates, floor by floor');
  // Nothing reaches the target: the closest, outside the tolerance.
  assert.deepEqual(rankFloors([easy, hard], 20, 'tricky')[0], { floors: [1, 1, 1], gap: 12, distance: 8, within: false });
  // Every combination is ranked; unsolved or unmeasured candidates give no floors.
  assert.equal(rankFloors([easy, null, hard, { status: 'unknown' }, { ...easy, points: null }], 6, 'tricky').length, 8);
  assert.deepEqual(rankFloors([], 6, 'tricky'), []);
  assert.deepEqual(rankFloors([null], 6, 'tricky'), [], 'nothing to assemble: the fallback bank');
});

test('among days on target the most even wins, and the tolerance is exact', () => {
  // Both land on 6: one with a 5-move floor, one at 2 a floor. The even one wins although it comes later.
  const lopsided = candidateOf([5, 5, 50]), even = candidateOf([20, 20, 20]);
  assert.deepEqual(rankFloors([lopsided, even], 6, 'fair')[0].floors, [1, 1, 1]);
  // Off target, closeness comes before evenness: 6.4 is nearer 6.7 than 6 is.
  assert.deepEqual(rankFloors([candidateOf([5, 5, 54]), even], 6.7, 'fair')[0].floors, [0, 0, 0]);
  // Gaps add up in whole-number points: within TARGET_TOLERANCE is within, a point more is not.
  assert.equal(TARGET_TOLERANCE, 0.1);
  assert.equal(rankFloors([candidateOf([80, 80, 84], { runs: 40 })], 6, 'fair')[0].within, true);
  assert.equal(rankFloors([candidateOf([80, 80, 85], { runs: 40 })], 6, 'fair')[0].within, false);
  // Candidates measured with another number of runs can't be added to the first one's.
  assert.equal(rankFloors([candidateOf([10, 10, 10]), candidateOf([40, 40, 40], { runs: 20 })], 6, 'fair').length, 1);
});

test('an assembled route stays within the move cap and a pawn’s allowance of lives', () => {
  const long = candidateOf([30, 30, 30], { turns: [20, 20, 20] }), short = candidateOf([0, 0, 0], { turns: [5, 5, 5] });
  // Three 20-move floors would run past 50 moves; two of them fit.
  const ranked = rankFloors([long, short], 9, 'fair');
  assert.ok(ranked.every(({ floors }) => floors.filter((attempt) => attempt === 0).length < 3));
  assert.deepEqual(ranked[0].floors, [0, 0, 1]);
  // A pawn route may lose 4 lives in all.
  const costly = candidateOf([30, 30, 30], { lives: [3, 3, 0] }), safe = candidateOf([0, 0, 0]);
  assert.ok(rankFloors([costly, safe], 9, 'fair').every(({ floors }) => !(floors[0] === 0 && floors[1] === 0)));
  assert.deepEqual(rankFloors([costly, safe], 9, 'fair', 0, { lives: 6 })[0].floors, [0, 0, 0]);
  // Tooling that measures whole candidates can keep each day to one candidate.
  assert.ok(rankFloors([long, short, costly], 6, 'fair', 0, { wholeDays: true }).every(({ floors }) => floors[0] === floors[1] && floors[1] === floors[2]));
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
  // Nor can the floors' seeds: each floor's layout comes from its own.
  assert.equal(createGame(daily).floorSeeds.length, 3);
  assert.equal(validateSave({ ...createGame(daily), floorSeeds: daily.floorSeeds.map((seed, floor) => (floor ? seed : seed + 1)) }, date), false, 'floor seeds cannot be edited');
  const { floorSeeds, ...unseeded } = createGame(daily);
  assert.ok(floorSeeds);
  assert.equal(validateSave(unseeded, date), false, 'nor dropped');
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
