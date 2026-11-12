// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, canChoosePiece, createGame, createPracticeGame, getDaily, isOfficialRun, legalMoves, PIECES, unreachablePickups, validateSave } from '../src/game.js';
import { createGame as createRawGame, CHEST_GOLD } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { DIFFICULTY_TIERS, TIER_IDS } from '../src/difficulty.js';
import { monsterSmarts } from '../src/monster-ai.js';
import { CAVE_IN_MOVES, caveInMoves } from '../src/cave-in.js';
import { distanceTable, UNREACHABLE } from '../src/move-tables.js';
import { room as composedRoom, withRooms } from './fixtures/rooms.js';

const dates = ['2026-11-05', '2026-11-07', '2026-11-08', '2026-11-10', '2026-11-11', '2026-11-13'];
const move = (x, y) => ({ type: 'move', x, y });
const roundTrip = (value) => JSON.parse(JSON.stringify(value));
const layout = (state) => ({
  map: state.map, props: state.props, items: state.items, objective: state.objective,
  enemies: state.enemies.map(({ phase, target, intent, ...enemy }) => enemy),
});
// What a practice room always keeps from the official one: its monsters and challenge.
const kept = (state) => ({ objective: state.objective, enemies: layout(state).enemies });
const walls = (state) => state.map.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '#' ? [`${x},${y}`] : [])));
const pickups = (state) => state.items.map(({ x, y, ...item }) => JSON.stringify(item)).sort();
// The chest is the daily's own second goal: a practice room is the official one without it.
const isChest = (item) => item.type === 'chest';
const chestless = (state) => ({ ...state, items: state.items.filter((item) => !isChest(item)) });

// Complete the room in a fixture so layout/validation tests exercise real
// descent without trying to solve an intentionally uncertified variant.
function nextFloor(previous) {
  const state = structuredClone(previous);
  // Only optional residents pay gold; the challenge pieces pay nothing.
  const optional = state.enemies.filter((foe) => foe.role !== state.objective.piece).length;
  state.captures += state.enemies.length; state.gold += optional; state.paidCaptures += optional;
  state.enemies = []; state.objective.complete = true; state.exit.open = true;
  state.turns++;
  return act(state, { type: 'descend' });
}

// Walled in on every side, the piece has no move at all: the try ends (rules.js trapped).
function exhaust(previous) {
  const state = structuredClone(previous);
  state.player.x = 4; state.player.y = 6;
  state.map = Array(8).fill('........'); state.map[5] = '...###..'; state.map[6] = '...#.#..'; state.map[7] = '...###..';
  state.props = []; state.items = []; state.enemies = [];
  state.powers = { shield: 0, freeze: 0, magnet: 0 };
  return act(state, { type: 'wait' });
}

test('all twelve choices keep every official room across all floors, fitted to the piece, and validate only as practice', () => {
  for (const date of dates) {
    const daily = getDaily(date);
    const floors = [createGame(daily)];
    floors.push(nextFloor(floors[0])); floors.push(nextFloor(floors[1]));
    for (const piece of PIECES) for (const color of ['white', 'black']) {
      let practice = createPracticeGame(daily, { piece, color });
      for (let floor = 0; floor < 3; floor++) {
        const label = `${date}: ${color} ${piece}, floor ${floor}`;
        assert.ok(!practice.items.some(isChest), `${label}: no chest in practice`);
        // The day's own piece, and a pawn, play the official room as it is, but for its chest.
        if (piece === daily.playerPiece || piece === 'pawn') assert.deepEqual(layout(practice), layout(chestless(floors[floor])), label);
        else {
          // Another piece keeps its monsters and pickups and may lose walls. The rooms are
          // built around the day's piece, so it may find some out of reach, but it is never
          // boxed in at its start: some square it reaches lies two or more steps away.
          assert.deepEqual(kept(practice), kept(floors[floor]), label);
          assert.ok(walls(practice).every((wall) => walls(floors[floor]).includes(wall)), `${label}: practice only clears walls`);
          assert.deepEqual(pickups(practice), pickups(chestless(floors[floor])), label);
          const table = distanceTable(practice.map, piece), from = practice.player.y * 8 + practice.player.x;
          assert.ok(Array.from({ length: 64 }, (_, to) => to).some((to) => table[from * 64 + to] !== UNREACHABLE
            && Math.max(Math.abs((to % 8) - practice.player.x), Math.abs(Math.floor(to / 8) - practice.player.y)) > 1), `${label}: boxed in`);
        }
        assert.equal(practice.startingPiece, piece); assert.equal(practice.playerColor, color);
        assert.equal(practice.hits, 0);
        assert.equal(practice.layoutPiece, daily.playerPiece); assert.equal(practice.practice, true);
        assert.equal(validateSave(roundTrip(practice), date, { practice: true }), true);
        assert.equal(validateSave(practice, date), false, 'practice must not enter the official save slot');
        if (floor < 2) practice = nextFloor(practice);
      }
      const won = nextFloor(practice);
      assert.equal(won.status, 'won'); assert.equal(validateSave(won, date, { practice: true }), true);
    }
  }
});

test('a practice room fits its piece without changing or certifying the official room', () => {
  const daily = getDaily('2026-11-05');
  const before = structuredClone(daily);
  const practice = createPracticeGame(daily, { piece: 'knight', color: 'black' });
  // The official pawn room's recruit waits far off; practice brings it to one of the knight's first moves.
  assert.deepEqual(unreachablePickups(practice), []);
  const recruit = practice.items.find((item) => item.type === 'companion');
  assert.ok(legalMoves(practice).some((move) => move.x === recruit.x && move.y === recruit.y), 'the recruit waits one move away');
  // A practice bishop boxed into three squares on a knight's room (2026-11-08) gets the walls on its lines cleared.
  const boxed = createPracticeGame(getDaily('2026-11-08'), { piece: 'bishop' });
  const official = createGame(getDaily('2026-11-08'));
  assert.deepEqual(walls(official).filter((wall) => !walls(boxed).includes(wall)), ['4,5', '6,5']);
  assert.ok(legalMoves(boxed).length > 2);
  assert.deepEqual(getDaily(daily.date), before);
  assert.deepEqual(daily, before);
  for (const options of [{ piece: 'dragon' }, { color: 'red' }, { piece: null }, { color: null }]) {
    assert.throws(() => createPracticeGame(daily, options), RangeError);
  }
});

test('a practice piece walled in at its start gets the walls on its first moves cleared', () => {
  // The room where this was found, laid as a composed room: 2027-01-04's floor 1
  // as a Gentle rook day once played it, where every jump from a knight's start is a wall.
  const official = withRooms({ ...getRawDaily('2027-01-04'), difficulty: 'gentle' }, composedRoom({
    map: ['........', '#...#...', '......#.', '........', '...#.#..', '..#...#.', '........', '#.#...#.'],
    enemies: [{ x: 7, y: 2, cast: 0 }, { x: 2, y: 1, cast: 0 }, { x: 7, y: 3, cast: 1 }, { x: 2, y: 2, cast: 2 }],
    items: [{ x: 4, y: 4, type: 'coin' }, { x: 2, y: 4, type: 'coin' }, { x: 6, y: 4, type: 'coin' }, { x: 1, y: 5, type: 'powerup', power: 'freeze' }, { type: 'companion', piece: 'bishop', x: 0, y: 6 }],
  }));
  const room = createRawGame(official);
  const jumps = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]]
    .map(([dx, dy]) => [room.player.x + dx, room.player.y + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < 8 && y < 8);
  assert.ok(jumps.every(([x, y]) => room.map[y][x] === '#'), 'the official room walls off every jump');
  const practice = createRawGame({ ...official, playerPiece: 'knight', practice: true, layoutPiece: official.playerPiece });
  assert.equal(legalMoves(practice).length, jumps.length);
  assert.deepEqual(walls(practice), walls(room).filter((wall) => !jumps.some(([x, y]) => wall === `${x},${y}`)), 'only the jumps were cleared');
  assert.ok(practice.props.every((prop) => practice.map[prop.y][prop.x] === '#'));
  assert.deepEqual(unreachablePickups(practice), []);
});

test('practice choices control movement and the selected color controls who acts first', () => {
  const daily = getDaily('2026-11-05');
  for (const color of ['white', 'black']) {
    const state = createPracticeGame(daily, { piece: 'knight', color });
    state.map = Array(8).fill('........'); state.enemies = []; state.items = [];
    assert.ok(legalMoves(state).some((tile) => tile.x === 2 && tile.y === 5));
    assert.ok(!legalMoves(state).some((tile) => tile.x === 4 && tile.y === 5));
    const next = act(state, move(2, 5));
    const phases = next.events.filter((event) => ['move', 'enemy-phase'].includes(event.type)).map((event) => event.type);
    assert.deepEqual(phases, color === 'white' ? ['move', 'enemy-phase'] : ['enemy-phase', 'move']);
    assert.equal(next.player.piece, 'knight');
  }
});

test('a cornered run unlocks selection durably and preserves the chosen piece, color and layout', () => {
  const daily = getDaily('2026-11-05');
  assert.equal(canChoosePiece(createGame(daily)), false);
  const officialReset = exhaust(createGame(daily));
  assert.ok(officialReset.events.some((event) => event.type === 'restart'));
  assert.equal(officialReset.replayUnlocked, true); assert.equal(canChoosePiece(officialReset), true);
  assert.equal(validateSave(roundTrip(officialReset), daily.date), true);
  const moved = act(officialReset, { type: 'move', ...legalMoves(officialReset)[0] });
  assert.equal(moved.replayUnlocked, true); assert.equal(canChoosePiece(roundTrip(moved)), true);
  assert.equal(validateSave(moved, daily.date), true);

  for (const color of ['white', 'black']) {
    const practice = createPracticeGame(daily, { piece: 'queen', color });
    const reset = exhaust(practice);
    assert.equal(reset.startingPiece, 'queen'); assert.equal(reset.player.piece, 'queen');
    assert.equal(reset.playerColor, color); assert.equal(reset.hits, 0);
    assert.equal(reset.practice, true); assert.equal(reset.replayUnlocked, true);
    assert.deepEqual(layout(reset), layout(practice));
    assert.equal(reset.turns, 0); assert.equal(reset.gold, 0); assert.equal(reset.floor, 0);
    assert.equal(validateSave(roundTrip(reset), daily.date, { practice: true }), true);
    const repeated = exhaust(reset);
    assert.equal(repeated.replayUnlocked, true); assert.deepEqual(layout(repeated), layout(practice));
  }
});

test('legacy exhaustion events become durable before the next action clears them', () => {
  const daily = getDaily('2026-11-05');
  const legacy = exhaust(createGame(daily)); delete legacy.replayUnlocked;
  assert.equal(validateSave(legacy, daily.date), true); assert.equal(canChoosePiece(legacy), true);
  const next = act(legacy, { type: 'move', ...legalMoves(legacy)[0] });
  assert.equal(next.replayUnlocked, true); assert.equal(canChoosePiece(next), true);
  assert.equal(legacy.replayUnlocked, undefined, 'normalization must not mutate the prior save');
});

test('sharing eligibility follows the starting piece and color, including official pawn promotion', () => {
  const daily = getDaily('2026-11-05');
  const official = createGame(daily);
  assert.equal(isOfficialRun(official, daily), true);
  official.player.piece = 'queen';
  assert.equal(isOfficialRun(official, daily), true);
  for (const piece of PIECES) for (const color of ['white', 'black']) {
    const practice = createPracticeGame(daily, { piece, color });
    assert.equal(isOfficialRun(practice, daily), piece === daily.playerPiece && color === daily.playerColor);
    assert.equal(canChoosePiece(practice), true);
  }
  assert.equal(isOfficialRun(null, daily), false);
  assert.equal(canChoosePiece(null), false);
  for (const status of ['won', 'lost']) assert.equal(canChoosePiece({ ...official, status }), true);
  assert.equal(canChoosePiece(createGame(getDaily('2026-11-06'))), false);
});

test('save validation rejects forged practice metadata while accepting older official-piece practice saves', () => {
  const daily = getDaily('2026-11-05');
  const official = createGame(daily);
  assert.equal(validateSave(roundTrip(official), daily.date, { practice: true }), true);
  for (const mutate of [
    (state) => { state.practice = false; }, (state) => { state.practice = 'true'; },
    (state) => { state.layoutPiece = 'king'; }, (state) => { state.replayUnlocked = 1; },
  ]) {
    const forged = structuredClone(official); mutate(forged);
    assert.equal(validateSave(forged, daily.date), false);
    assert.equal(validateSave(forged, daily.date, { practice: true }), false);
  }
  const practice = createPracticeGame(daily, { piece: 'queen', color: 'black' });
  for (const mutate of [
    (state) => { delete state.practice; }, (state) => { delete state.layoutPiece; },
    (state) => { state.layoutPiece = 'queen'; }, (state) => { state.startingPiece = 'dragon'; },
    (state) => { state.playerColor = 'red'; }, (state) => { state.floorSeeds[0]++; },
  ]) {
    const forged = structuredClone(practice); mutate(forged);
    assert.equal(validateSave(forged, daily.date, { practice: true }), false);
  }
});

test('every monster ruleset keeps the official rooms on every floor and changes only the monsters', () => {
  for (const date of dates) {
    const daily = getDaily(date);
    const floors = [createGame(daily)];
    floors.push(nextFloor(floors[0])); floors.push(nextFloor(floors[1]));
    for (const difficulty of TIER_IDS) {
      let practice = createPracticeGame(daily, { difficulty });
      for (let floor = 0; floor < 3; floor++) {
        const label = `${date}: ${difficulty} monsters, floor ${floor}`;
        assert.deepEqual(layout(practice), layout(chestless(floors[floor])), label);
        // The ruleset sets how smart the monsters are and, as on its weekday, the cave-in countdown.
        assert.equal(practice.difficulty, difficulty, label);
        assert.equal(monsterSmarts(practice), DIFFICULTY_TIERS[difficulty].rank, label);
        assert.equal(caveInMoves(practice), CAVE_IN_MOVES[difficulty], label);
        assert.equal(isOfficialRun(practice, daily), difficulty === daily.difficulty, label);
        assert.equal(validateSave(roundTrip(practice), date, { practice: true }), true, label);
        assert.equal(validateSave(practice, date), false, 'practice must not enter the official save slot');
        if (floor < 2) practice = nextFloor(practice);
      }
    }
  }
});

test('practice rooms hold no chest: the official run keeps its own, and a practice save can\'t claim one', () => {
  // The first stored day whose floor 1 holds a chest.
  const day = Array.from({ length: 90 }, (_, n) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10)).find((date) => getDaily(date).composed[0].items.some(isChest));
  assert.ok(day, 'a day with a chest on floor 1');
  const daily = getDaily(day);
  const official = createGame(daily);
  assert.equal(official.items.filter(isChest).length, 1, 'the official run has its chest');
  const otherPiece = PIECES.find((piece) => piece !== daily.playerPiece && piece !== 'pawn');
  const otherTier = TIER_IDS.find((tier) => tier !== daily.difficulty);
  // Even the day's own piece, colour and monsters: practice is no second try at the mark.
  for (const options of [{}, { color: 'black' }, { piece: otherPiece }, { piece: 'pawn' }, { difficulty: otherTier }]) {
    const label = `${day}: ${JSON.stringify(options)}`;
    const practice = createPracticeGame(daily, options);
    assert.ok(!practice.items.some(isChest), label);
    assert.deepEqual(practice.composed, daily.composed, `${label}: the day's rooms travel with the save as they are`);
    assert.equal(validateSave(roundTrip(practice), day, { practice: true }), true, label);
    const claimed = structuredClone(practice); claimed.feats.push({ floor: 0, kind: 'chest' }); claimed.gold += CHEST_GOLD;
    assert.equal(validateSave(claimed, day, { practice: true }), false, `${label}: a chest feat`);
    const laid = structuredClone(practice); laid.items.push(official.items.find(isChest));
    assert.equal(validateSave(laid, day, { practice: true }), false, `${label}: a chest laid back in`);
    // Every later floor is chestless too.
    let state = practice;
    for (let floor = 1; floor < 3; floor++) { state = nextFloor(state); assert.ok(!state.items.some(isChest), `${label}, floor ${floor}`); }
  }
});

test('a practice run on the day\'s monsters plays exactly as the official run, and other rulesets\' monsters move their own way', () => {
  const where = (state) => JSON.stringify(state.enemies.map(({ id, x, y }) => [id, x, y]));
  const wait = (state) => act(state, { type: 'wait' });
  let parted = 0;
  for (const date of dates) {
    const daily = getDaily(date);
    assert.equal(createPracticeGame(daily).difficulty, daily.difficulty, 'practice starts on the day\'s own monsters');
    let official = createGame(daily), same = createPracticeGame(daily);
    let runs = TIER_IDS.map((difficulty) => createPracticeGame(daily, { difficulty }));
    for (let turn = 0; turn < 4; turn++) {
      official = wait(official); same = wait(same); runs = runs.map(wait);
      assert.equal(where(same), where(official), `${date}, wait ${turn + 1}`);
    }
    if (new Set(runs.map(where)).size > 1) parted++;
  }
  assert.ok(parted >= dates.length / 2, `the rulesets' monsters parted ways on ${parted} of ${dates.length} days`);
});

test('a practice run keeps its monsters through a restart and a reload, and forged or unknown rulesets are refused', () => {
  const daily = getDaily('2026-11-05');
  const other = TIER_IDS.find((tier) => tier !== daily.difficulty);
  const practice = createPracticeGame(daily, { piece: 'queen', color: 'black', difficulty: other });
  const reset = exhaust(practice);
  assert.equal(reset.difficulty, other); assert.equal(reset.replayUnlocked, true);
  assert.deepEqual(layout(reset), layout(practice));
  assert.equal(validateSave(roundTrip(reset), daily.date, { practice: true }), true);
  for (const difficulty of ['standard', 'nightmare', ['fair'], null, undefined]) {
    const forged = structuredClone(practice); forged.difficulty = difficulty;
    assert.equal(validateSave(roundTrip(forged), daily.date, { practice: true }), false, JSON.stringify(difficulty));
  }
  // The official slot only ever holds the day's own monsters.
  const official = createGame(daily); official.difficulty = other;
  assert.equal(validateSave(roundTrip(official), daily.date), false);
  for (const difficulty of ['nightmare', 'standard', null]) assert.throws(() => createPracticeGame(daily, { difficulty }), RangeError);
});
