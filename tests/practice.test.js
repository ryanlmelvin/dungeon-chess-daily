// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, canChoosePiece, createGame, createPracticeGame, getDaily, isOfficialPiece, legalMoves, PIECES, PIECE_LIVES, unreachablePickups, validateSave } from '../src/game.js';

const dates = ['2026-11-05', '2026-11-07', '2026-11-08', '2026-11-10', '2026-11-12', '2026-11-13'];
const move = (x, y) => ({ type: 'move', x, y });
const roundTrip = (value) => JSON.parse(JSON.stringify(value));
const layout = (state) => ({
  map: state.map, props: state.props, items: state.items, objective: state.objective,
  enemies: state.enemies.map(({ phase, target, intent, ...enemy }) => enemy),
});

// Complete the room in a fixture so layout/validation tests exercise real
// descent without trying to solve an intentionally uncertified variant.
function nextFloor(previous) {
  const state = structuredClone(previous);
  state.captures += state.enemies.length; state.gold += state.enemies.length;
  state.enemies = []; state.objective.complete = true; state.exit.open = true;
  state.turns++;
  return act(state, { type: 'descend' });
}

function exhaust(previous) {
  const state = structuredClone(previous);
  state.player.hp = 1; state.player.x = 4; state.player.y = 6;
  state.map = Array(8).fill('........'); state.props = []; state.items = [];
  state.powers = { shield: 0, freeze: 0, magnet: 0 };
  state.enemies = [{ id: 'attacker', piece: 'rook', role: 'rook', species: 'bat', name: 'Bat', x: 4, y: 0, moved: true,
    phase: 'aim', target: { x: 4, y: 6 }, intent: Array.from({ length: 7 }, (_, index) => ({ x: 4, y: index + 1 })) }];
  return act(state, move(4, 5));
}

test('all twelve choices keep every official layout across all floors and validate only as practice', () => {
  for (const date of dates) {
    const daily = getDaily(date);
    const floors = [createGame(daily)];
    floors.push(nextFloor(floors[0])); floors.push(nextFloor(floors[1]));
    for (const piece of PIECES) for (const color of ['white', 'black']) {
      let practice = createPracticeGame(daily, { piece, color });
      for (let floor = 0; floor < 3; floor++) {
        assert.deepEqual(layout(practice), layout(floors[floor]), `${date}: ${color} ${piece}, floor ${floor}`);
        assert.equal(practice.startingPiece, piece); assert.equal(practice.playerColor, color);
        assert.equal(practice.player.maxHp, PIECE_LIVES[piece]); assert.equal(practice.player.hp, PIECE_LIVES[piece]);
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

test('alternate construction accepts unreachable pickups without changing or certifying the official layout', () => {
  const daily = getDaily('2026-11-05');
  const before = structuredClone(daily);
  const practice = createPracticeGame(daily, { piece: 'bishop', color: 'black' });
  assert.ok(unreachablePickups(practice).length > 0);
  assert.deepEqual(getDaily(daily.date), before);
  assert.deepEqual(daily, before);
  for (const options of [{ piece: 'dragon' }, { color: 'red' }, { piece: null }, { color: null }]) {
    assert.throws(() => createPracticeGame(daily, options), RangeError);
  }
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

test('life exhaustion unlocks selection durably and preserves the chosen piece, color and layout', () => {
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
    assert.equal(reset.playerColor, color); assert.equal(reset.player.hp, 1);
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
  assert.equal(isOfficialPiece(official, daily), true);
  official.player.piece = 'queen';
  assert.equal(isOfficialPiece(official, daily), true);
  for (const piece of PIECES) for (const color of ['white', 'black']) {
    const practice = createPracticeGame(daily, { piece, color });
    assert.equal(isOfficialPiece(practice, daily), piece === daily.playerPiece && color === daily.playerColor);
    assert.equal(canChoosePiece(practice), true);
  }
  assert.equal(isOfficialPiece(null, daily), false);
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
    (state) => { state.playerColor = 'red'; }, (state) => { state.dungeonSeed++; },
  ]) {
    const forged = structuredClone(practice); mutate(forged);
    assert.equal(validateSave(forged, daily.date, { practice: true }), false);
  }
});
