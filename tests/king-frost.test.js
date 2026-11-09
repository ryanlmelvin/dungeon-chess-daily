// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, closeAttacker, createGame, frozen } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
// An empty room on `floor` with the player's rook in the corner; floor 3 (index 2) is the king floor.
function room(floor) {
  const state = createGame(getRawDaily('2026-11-13'));
  Object.assign(state, { floor, map: Array(8).fill('........'), props: [], items: [], enemies: [], companion: null, awaitingPlayer: false });
  state.objective = { piece: floor === 2 ? 'king' : 'pawn', complete: false };
  state.exit = { x: 4, y: 0, open: false };
  Object.assign(state.player, { piece: 'rook', x: 0, y: 7 });
  return state;
}
const monster = (id, piece, x, y) => ({ id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: true, phase: 'ready', target: null, intent: [] });
const find = (state, id) => state.enemies.find((foe) => foe.id === id);

test('frost freezes the king floor’s guards, but the king keeps moving', () => {
  const state = room(2); state.powers.freeze = 3;
  state.enemies = [monster('king', 'king', 4, 1), monster('guard', 'knight', 6, 1)];
  const next = act(state, wait);
  assert.equal(next.powers.freeze, 2, 'the frost still wears down');
  assert.deepEqual([find(next, 'guard').x, find(next, 'guard').y, find(next, 'guard').phase], [6, 1, 'ready'], 'the guard stays frozen');
  assert.notDeepEqual([find(next, 'king').x, find(next, 'king').y], [4, 1], 'the king takes its turn');
  assert.ok(next.events.some((event) => event.type === 'enemy-move' && event.id === 'king'));
  assert.equal(frozen(next, find(next, 'king')), false);
  assert.equal(frozen(next, find(next, 'guard')), true);
});

test('off the king floor, frost holds a king like any other monster', () => {
  const state = room(1); state.powers.freeze = 3;
  state.enemies = [monster('king', 'king', 4, 1)];
  const next = act(state, wait);
  assert.deepEqual([next.enemies[0].x, next.enemies[0].y], [4, 1]);
  assert.equal(frozen(next, next.enemies[0]), true);
  assert.equal(frozen({ ...next, powers: { ...next.powers, freeze: 0 } }, next.enemies[0]), false, 'nothing is frozen without frost');
});

test('while its guards are frozen, the king still captures up close', () => {
  const state = room(2); state.powers.freeze = 3;
  // Both strike (0, 5) up close: the knight by its jump, the king from beside it.
  state.enemies = [monster('guard', 'knight', 2, 4), monster('king', 'king', 1, 4)];
  assert.equal(closeAttacker(state, { x: 0, y: 5 })?.id, 'king');
  const next = act(state, move(0, 5));
  assert.ok(next.events.some((event) => event.type === 'close-capture' && event.id === 'king'));
  assert.equal(next.hits, 1);
  // Off the king floor the same pair is frozen whole.
  const decoys = room(1); decoys.powers.freeze = 3; decoys.enemies = structuredClone(state.enemies);
  assert.equal(closeAttacker(decoys, { x: 0, y: 5 }), null);
});

test('an hourglass picked up on the king floor says the king keeps moving', () => {
  const lines = (state) => [...(state.notes ?? []), state.message];
  const king = room(2);
  king.enemies = [monster('king', 'king', 7, 0)];
  king.items = [{ x: 0, y: 5, type: 'powerup', power: 'freeze' }];
  const picked = act(king, move(0, 5));
  assert.equal(picked.powers.freeze, 2);
  assert.ok(lines(picked).some((line) => line === 'Frost hourglass acquired: the guards freeze, but the king keeps moving.'), lines(picked).join(' | '));
  const earlier = room(1);
  earlier.enemies = [monster('king', 'king', 7, 0)];
  earlier.items = [{ x: 0, y: 5, type: 'powerup', power: 'freeze' }];
  assert.ok(lines(act(earlier, move(0, 5))).includes('Frost hourglass acquired.'));
});
