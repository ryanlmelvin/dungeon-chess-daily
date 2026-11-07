// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, legalMoves, validateSave } from '../src/rules.js';
import { generateDaily, getDaily, fallbackKey } from '../src/generation.js';
import { TIER_IDS } from '../src/difficulty.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { FALLBACKS } from '../src/fallbacks.js';
import {
  MODIFIERS, ICE_TILES, COLLAPSE_EVERY, COLLAPSE_CAP,
  modifierFor, iceSlide,
} from '../src/modifiers.js';

const day = (offset, start = '2026-11-06') => new Date(Date.parse(start) + offset * 86_400_000).toISOString().slice(0, 10);
// The first date (from the modifier launch) that draws each modifier.
const firstDate = (modifier, piece) => {
  for (let offset = 0; offset < 400; offset++) {
    const date = day(offset, '2026-11-07');
    const raw = getRawDaily(date);
    if (raw.modifier === modifier && (!piece || raw.playerPiece === piece)) return date;
  }
  throw new Error(`No ${modifier} day found.`);
};

// An open, empty room for one rule at a time.
function room(modifier, piece = 'rook', x = 4, y = 6) {
  const state = createGame({ ...getRawDaily(firstDate('none')), modifier });
  state.startingPiece = piece;
  Object.assign(state.player, { piece, x, y, moved: false });
  state.map = Array(8).fill('........');
  state.enemies = []; state.items = []; state.props = []; state.companion = null;
  state.ice = [];
  return state;
}
const foe = (id, piece, x, y) => ({ id, species: 'bat', palette: 'ice', name: 'Ice bat', piece, role: piece, x, y, moved: true, phase: 'ready', intent: [], target: null });
const wall = (state, x, y) => { state.map[y] = state.map[y].slice(0, x) + '#' + state.map[y].slice(x + 1); };
const strip = (state) => {
  const { modifier, floorSnapshot, ...rest } = state;
  return floorSnapshot ? { ...rest, floorSnapshot: strip(floorSnapshot) } : rest;
};

test('the modifier is a pure function of the date, about one plain day in two', () => {
  const counts = { none: 0, ice: 0, collapse: 0 };
  for (let offset = 0; offset < 365; offset++) {
    const date = day(offset, '2026-11-07');
    const modifier = modifierFor(date);
    assert.equal(modifierFor(date), modifier);
    assert.equal(getRawDaily(date).modifier, modifier);
    counts[modifier]++;
  }
  for (const id of ['ice', 'collapse']) assert.ok(counts[id] > 60 && counts[id] < 125, `${id}: ${counts[id]}`);
  assert.ok(counts.none > 145 && counts.none < 220, `none: ${counts.none}`);
  // The draw has its own stream: the rest of the edition is what it was.
  const raw = getRawDaily('2026-12-01');
  assert.equal(raw.seed, getRawDaily('2026-12-01').seed);
  // Plain days carry no modifier field at all.
  assert.equal('modifier' in createGame(getRawDaily(firstDate('none'))), false);
  assert.equal(createGame(getRawDaily(firstDate('ice'))).modifier, 'ice');
});

test('ice tiles avoid walls, monsters, pickups, the start and the exit, and are fixed per floor', () => {
  const daily = getRawDaily(firstDate('ice'));
  const state = createGame(daily);
  assert.equal(state.ice.length, ICE_TILES);
  for (const tile of state.ice) {
    assert.notEqual(state.map[tile.y][tile.x], '#');
    assert.ok(!state.enemies.some((entry) => entry.x === tile.x && entry.y === tile.y));
    assert.ok(!state.items.some((entry) => entry.x === tile.x && entry.y === tile.y));
    assert.ok(!(tile.x === 4 && tile.y === 6) && !(tile.x === 4 && tile.y === 0));
  }
  assert.deepEqual(createGame(daily).ice, state.ice);
  // Ice draws on its own stream: the room is otherwise the plain room.
  const plain = createGame({ ...daily, modifier: 'none' });
  assert.deepEqual(plain.map, state.map);
  assert.deepEqual(plain.enemies, state.enemies);
  assert.deepEqual(plain.items, state.items);
  assert.equal(plain.ice, undefined);
});

test('a slider ending on ice skids one more square, shown in the move preview', () => {
  const state = room('ice', 'rook');
  state.ice = [{ x: 4, y: 3 }];
  const move = legalMoves(state).find((tile) => tile.x === 4 && tile.y === 3);
  assert.deepEqual(move.slide, { x: 4, y: 2 });
  // Moves that do not end on ice carry no slide.
  assert.equal(legalMoves(state).find((tile) => tile.x === 4 && tile.y === 4).slide, undefined);
  const next = act(state, { type: 'move', x: 4, y: 3 });
  assert.deepEqual([next.player.x, next.player.y], [4, 2]);
  assert.ok(next.events.some((event) => event.type === 'slide' && event.from.x === 4 && event.from.y === 3));
  // Only one extra square, even onto more ice.
  state.ice = [{ x: 4, y: 3 }, { x: 4, y: 2 }];
  assert.deepEqual(iceSlide(state, { x: 4, y: 3 }), { x: 4, y: 2 });
  assert.deepEqual([act(state, { type: 'move', x: 4, y: 3 }).player.y], [2]);
  // Bishops and queens slide along their diagonal.
  const bishop = room('ice', 'bishop');
  bishop.ice = [{ x: 2, y: 4 }];
  assert.deepEqual(iceSlide(bishop, { x: 2, y: 4 }), { x: 1, y: 3 });
  const queen = room('ice', 'queen');
  queen.ice = [{ x: 6, y: 4 }];
  assert.deepEqual(act(queen, { type: 'move', x: 6, y: 4 }).player, { ...queen.player, x: 7, y: 3, moved: true });
});

test('ice never slides into walls, monsters or off the board, and captures, knights and kings stop', () => {
  const state = room('ice', 'rook');
  state.ice = [{ x: 4, y: 3 }, { x: 4, y: 0 }];
  wall(state, 4, 2);
  assert.equal(iceSlide(state, { x: 4, y: 3 }), null);
  state.map = Array(8).fill('........');
  state.enemies = [foe('m', 'knight', 4, 2)];
  assert.equal(iceSlide(state, { x: 4, y: 3 }), null);
  const next = act(state, { type: 'move', x: 4, y: 3 });
  assert.equal(next.enemies.some((entry) => entry.id === 'm'), true, 'sliding never captures');
  // The board's edge stops a slide.
  state.enemies = [];
  assert.equal(iceSlide(state, { x: 4, y: 0 }), null);
  // A capture ending on ice stops on the captured square.
  state.enemies = [foe('m', 'knight', 4, 3)];
  assert.equal(iceSlide(state, { x: 4, y: 3 }), null);
  assert.equal(legalMoves(state).find((tile) => tile.x === 4 && tile.y === 3).slide, undefined);
  for (const piece of ['knight', 'king']) {
    const walker = room('ice', piece);
    walker.ice = [{ x: 3, y: 4 }, { x: 4, y: 5 }];
    assert.equal(legalMoves(walker).some((tile) => tile.slide), false, piece);
  }
});

test('a pawn moving straight slides on ice and may promote, but a diagonal capture stops', () => {
  const state = room('ice', 'pawn', 4, 2);
  state.player.moved = true;
  state.ice = [{ x: 4, y: 1 }, { x: 3, y: 1 }];
  state.enemies = [foe('m', 'knight', 3, 1)];
  const next = act(state, { type: 'move', x: 4, y: 1 });
  assert.deepEqual([next.player.x, next.player.y, next.player.piece], [4, 0, 'queen']);
  const capture = act(state, { type: 'move', x: 3, y: 1 });
  assert.deepEqual([capture.player.x, capture.player.y], [3, 1]);
  // A double step that ends on ice skids a third square.
  const opening = room('ice', 'pawn');
  opening.ice = [{ x: 4, y: 4 }];
  assert.deepEqual(legalMoves(opening).find((tile) => tile.y === 4).slide, { x: 4, y: 3 });
});

test('monsters are sure-footed: ice never changes how they move', () => {
  const date = firstDate('ice', 'knight');
  const daily = getRawDaily(date);
  let iced = createGame(daily);
  let plain = createGame({ ...daily, modifier: 'none' });
  for (let turn = 0; turn < 8 && iced.status === 'playing'; turn++) {
    iced = act(iced, { type: 'wait' });
    plain = act(plain, { type: 'wait' });
    assert.deepEqual(iced.enemies, plain.enemies, `turn ${turn}`);
  }
});

test('collapse sends a decoy in at the door every ten moves on a floor, up to the cap', () => {
  const date = firstDate('collapse');
  let state = createGame(getRawDaily(date));
  assert.equal(state.reinforcements, 0);
  // Keep the residents still and the player safe while counting moves.
  state.powers.freeze = 1000;
  const count = state.enemies.length;
  for (let turn = 1; turn < COLLAPSE_EVERY; turn++) state = act(state, { type: 'wait' });
  assert.equal(state.enemies.length, count);
  state = act(state, { type: 'wait' });
  assert.equal(state.reinforcements, 1);
  const arrival = state.enemies.at(-1);
  assert.equal(arrival.id, 'f0-r0');
  assert.deepEqual([arrival.x, arrival.y], [state.exit.x, state.exit.y]);
  assert.notEqual(arrival.role, state.objective.piece);
  assert.notEqual(arrival.piece, 'pawn');
  const decoys = [state.species[3], state.species[4]].map((creature) => creature.id);
  assert.ok(decoys.includes(arrival.species));
  assert.ok(state.events.some((event) => event.type === 'reinforcement' && event.id === 'f0-r0'));
  // A blocked door holds the next arrival until it is free.
  for (let turn = 0; turn < COLLAPSE_EVERY; turn++) state = act(state, { type: 'wait' });
  assert.equal(state.reinforcements, 1, 'the first arrival still stands in the doorway');
  state.enemies = state.enemies.filter((entry) => entry.id !== 'f0-r0');
  state = act(state, { type: 'wait' });
  assert.equal(state.reinforcements, 2);
  for (let turn = 0; turn < COLLAPSE_EVERY * 6; turn++) {
    state.enemies = state.enemies.filter((entry) => !entry.id.includes('-r'));
    state = act(state, { type: 'wait' });
  }
  assert.equal(state.reinforcements, COLLAPSE_CAP);
});

test('collapse stops once the stairs open and other modifiers never reinforce', () => {
  let state = createGame(getRawDaily(firstDate('collapse')));
  state.powers.freeze = 1000;
  state.exit.open = true; state.objective.complete = true;
  for (let turn = 0; turn < COLLAPSE_EVERY * 2; turn++) state = act(state, { type: 'wait' });
  assert.equal(state.reinforcements, 0);
  for (const modifier of ['none', 'ice']) {
    let other = createGame({ ...getRawDaily(firstDate('collapse')), modifier });
    other.powers.freeze = 1000;
    for (let turn = 0; turn < COLLAPSE_EVERY * 2; turn++) other = act(other, { type: 'wait' });
    assert.equal(other.reinforcements, undefined, modifier);
    assert.ok(!other.enemies.some((entry) => entry.id.includes('-r')), modifier);
  }
});

test('collapse saves validate through a certified route, and bad counts are rejected', () => {
  let checked = false;
  for (let offset = 0; offset < 120 && !checked; offset++) {
    const date = day(offset, '2026-11-07');
    if (getRawDaily(date).modifier !== 'collapse') continue;
    const daily = getDaily(date);
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) {
      state = act(state, action);
      assert.equal(validateSave(state, date, daily), true, `${date}: ${JSON.stringify(action)}`);
      if (state.reinforcements > 0 && state.status === 'playing') {
        checked = true;
        assert.equal(validateSave({ ...state, reinforcements: state.reinforcements + COLLAPSE_CAP }, date, daily), false);
        assert.equal(validateSave({ ...state, reinforcements: undefined }, date, daily), false);
      }
    }
  }
  assert.ok(checked, 'some certified collapse route meets a reinforcement');
});

test('saves must match the day’s modifier and its ice', () => {
  const date = firstDate('ice');
  const daily = getDaily(date);
  const state = createGame(daily);
  assert.equal(validateSave(state, date, daily), true);
  assert.equal(validateSave(strip(state), date, daily), false);
  assert.equal(validateSave({ ...state, modifier: 'dark' }, date, daily), false);
  assert.equal(validateSave({ ...state, ice: state.ice.slice(1) }, date, daily), false);
  const plainDate = firstDate('none');
  const plain = createGame(getDaily(plainDate));
  assert.equal(validateSave(plain, plainDate, getDaily(plainDate)), true);
  assert.equal(validateSave({ ...plain, modifier: 'ice' }, plainDate, getDaily(plainDate)), false);
});

test('dark is retired: its draws are plain days, and dark saves no longer load', () => {
  assert.equal(MODIFIERS.dark, undefined);
  for (let offset = 0; offset < 365; offset++) assert.notEqual(modifierFor(day(offset)), 'dark');
  const date = firstDate('none');
  const daily = getDaily(date);
  assert.equal(validateSave({ ...createGame(daily), modifier: 'dark' }, date, daily), false);
});

test('every modifier certifies: generated and forced-fallback editions replay under it', () => {
  for (const modifier of Object.keys(MODIFIERS)) {
    const date = firstDate(modifier);
    const daily = getDaily(date);
    assert.equal(daily.modifier, modifier);
    const initial = createGame(daily);
    assert.equal(initial.modifier, modifier === 'none' ? undefined : modifier);
    const proof = verifyWinningRoute(initial, daily.generation.certificate.actions);
    assert.equal(proof.valid, true, `${modifier}: ${proof.reason}`);
    // The same route need not survive another modifier; the fallback is keyed to it.
    const forced = generateDaily(date, { maxAttempts: 0 });
    assert.equal(forced.generation.source, 'fallback');
    assert.equal(forced.modifier, modifier);
    assert.ok(FALLBACKS[fallbackKey(forced.difficulty, forced.playerPiece, forced.playerColor, modifier)]);
    assert.equal(verifyWinningRoute(createGame(forced), forced.generation.certificate.actions).valid, true, modifier);
  }
});

test('the fallback bank covers every piece and difficulty under each rule-changing modifier', () => {
  for (const modifier of ['ice', 'collapse']) {
    for (const difficulty of TIER_IDS) {
      for (const piece of ['pawn', 'knight', 'bishop', 'rook', 'queen']) {
        const entry = FALLBACKS[fallbackKey(difficulty, piece, 'white', modifier)];
        assert.ok(entry, `${difficulty}:${piece}:${modifier}`);
      }
    }
  }
});
