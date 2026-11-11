// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { room, withRooms } from './fixtures/rooms.js';

const wait = { type: 'wait' };
function dailyFor(piece, color) {
  // Every daily is white; black engine tests borrow a white day, as practice does.
  if (color === 'black') return { ...dailyFor(piece, 'white'), playerColor: 'black' };
  // Kings are no longer a daily piece; engine tests borrow a rook day.
  if (piece === 'king') return { ...dailyFor('rook', color), playerPiece: 'king' };
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece && daily.playerColor === color) return daily;
  }
  throw Error(`No ${color} ${piece} edition found`);
}
function scenario(piece = 'rook', color = 'white', x = 4, y = 6) {
  const state = createGame(withRooms(dailyFor(piece, color)));
  Object.assign(state.player, { x, y });
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.enemies = [];
  state.objective = { piece: 'king', complete: false }; state.companion = null;
  state.powers = { shield: 0, freeze: 0, magnet: 0 }; state.awaitingPlayer = false;
  return state;
}
function monster(id, piece, x, y) {
  return { id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: true, phase: 'ready', intent: [], target: null };
}

test('white waiting spends a move: monsters act and the player stays put', () => {
  const state = scenario();
  state.enemies = [monster('k', 'king', 0, 0)];
  const next = act(state, wait);
  assert.equal(next.turns, state.turns + 1);
  assert.deepEqual([next.player.x, next.player.y], [4, 6]);
  assert.equal(next.events[0].type, 'wait');
  assert.ok(next.events.some((event) => event.type === 'enemy-move'));
});

test('a monster that walks next to a waiting player only aims, so the player strikes first', () => {
  const state = scenario('rook');
  state.enemies = [monster('k', 'king', 4, 4)];
  const next = act(state, wait);
  const king = next.enemies[0];
  assert.equal(next.hits, state.hits);
  assert.equal(king.phase, 'aim');
  assert.ok(legalMoves(next).some((tile) => tile.x === king.x && tile.y === king.y && tile.capture));
});

test('black waiting runs the enemy phase once and ends the turn', () => {
  const state = scenario('rook', 'black');
  state.enemies = [monster('k', 'king', 0, 0)];
  const next = act(state, wait);
  assert.equal(next.events.filter((event) => event.type === 'enemy-phase').length, 1);
  assert.equal(next.awaitingPlayer, false);
  assert.equal(next.turns, state.turns + 1);
  // After a re-prompt the enemies already moved; waiting then skips their phase.
  const pending = { ...structuredClone(state), awaitingPlayer: true };
  const after = act(pending, wait);
  assert.equal(after.events.filter((event) => event.type === 'enemy-phase').length, 0);
  assert.equal(after.awaitingPlayer, false);
});

test('a king boxed in by monsters can wait instead of restarting', () => {
  const state = scenario('king', 'white', 4, 6);
  state.enemies = [monster('q', 'queen', 4, 4)];
  state.map = ['........', '........', '........', '........', '........', '........', '...#.#..', '...###..'];
  assert.equal(legalMoves(state).length, 0);
  const next = act(state, wait);
  assert.ok(!next.events.some((event) => event.type === 'restart'));
});

test('only terrain that leaves no move at all still restarts the run', () => {
  const state = scenario('pawn', 'white', 4, 6);
  state.map = ['........', '........', '........', '........', '........', '....#...', '........', '........'];
  const next = act(state, wait);
  assert.ok(next.events.some((event) => event.type === 'restart'));
});

test('waiting keeps the save valid', () => {
  // A room whose target waits in the far corner.
  const daily = withRooms(dailyFor('rook', 'white'), room({ enemies: [{ x: 0, y: 0, cast: 0 }] }));
  const next = act(createGame(daily), wait);
  assert.equal(validateSave(next, daily.date, daily), true);
});
