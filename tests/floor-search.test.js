// SPDX-License-Identifier: GPL-3.0-only
// The floor search (src/fairness.js findFloorRoute, the composer's walk) and
// the position identity the composer's exact search keys on: it takes the
// stairs right after each clear, keys positions on the floor's own clock,
// and ranks them by wall-aware move distances.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { createGame } from '../src/rules.js';
import { findFloorRoute, positionKey, targetDistance } from '../src/fairness.js';
import { distanceTable } from '../src/move-tables.js';

const descend = { type: 'descend' };

test('a cleared floor’s only action is its stairs: the search takes them without spending budget', () => {
  // A floor-3 position with its king already taken: the route is the stairs alone.
  const state = createGame(getRawDaily('2026-11-09'));
  state.floor = 2; state.enemies = []; state.objective = { piece: state.targets[2], complete: true, moves: 1 }; state.exit.open = true;
  state.records = [{ floor: 0, turns: 1 }, { floor: 1, turns: 1 }];
  const found = findFloorRoute(state, { maxExpansions: 0 });
  assert.deepEqual({ status: found.status, actions: found.actions, explored: found.explored }, { status: 'solved', actions: [descend], explored: 0 });
  assert.equal(found.state.status, 'won');
});

test('search identity keeps the floor’s own clock and drops the run’s, gold and coins', () => {
  const state = createGame(getRawDaily('2026-11-09'));
  const key = positionKey(state);
  const later = structuredClone(state);
  // The same floor position, reached after a longer run with more gold and fewer coins on the floor.
  later.turns += 9; later.floorStart.turns += 9; later.gold += 4; later.treasure += 1;
  later.items = later.items.filter((item, index) => item.type !== 'coin' || index > 0);
  assert.ok(later.items.length < state.items.length);
  assert.equal(positionKey(later), key);
  // Moves made on this floor do count: monster tie-breaks and Collapse arrivals hash them.
  const waited = structuredClone(state); waited.turns += 1;
  assert.notEqual(positionKey(waited), key);
  assert.equal(positionKey(waited, false), positionKey(state, false), 'the rollout’s revisit heuristic ignores time');
  // So do off-balance and pinned monsters, and the powerup still lying there.
  const unbalanced = structuredClone(state); unbalanced.enemies[0].offBalance = true;
  const pinned = structuredClone(state); pinned.enemies[0].pinned = 2;
  const taken = structuredClone(state); taken.items = taken.items.filter((item) => item.type !== 'powerup');
  for (const other of [unbalanced, pinned, taken]) assert.notEqual(positionKey(other), key);
  // Classic comparison monsters hash the whole run's moves, so for them the run's clock stays.
  const classic = structuredClone(state); classic.classicMonsters = true;
  const classicLater = structuredClone(classic); classicLater.turns += 9; classicLater.floorStart.turns += 9;
  assert.notEqual(positionKey(classicLater), positionKey(classic));
});

test('the search ranks positions by wall-aware move distances, not coordinates', () => {
  const state = createGame(getRawDaily('2026-11-09'));
  state.map = Array(8).fill('........');
  state.player = { ...state.player, piece: 'rook', x: 4, y: 6 };
  const target = { x: 4, y: 2 };
  assert.equal(targetDistance(state, target), 1, 'an open file: one move');
  // A wall between them: around it takes three moves, though they share a file.
  state.map[4] = '....#...';
  assert.equal(targetDistance(state, target), 3);
  assert.equal(targetDistance(state, target), distanceTable(state.map, 'rook')[(6 * 8 + 4) * 64 + 2 * 8 + 4]);
  // A knight jumps the wall; a bishop never lands on the other colour.
  state.player.piece = 'knight';
  assert.equal(targetDistance(state, target), 2);
  state.player.piece = 'bishop';
  assert.equal(targetDistance(state, { x: 4, y: 3 }), 10, 'the other colour counts as far away');
  assert.equal(targetDistance(state, { x: 2, y: 4 }), 1);
  // A pawn takes diagonally, and a target straight ahead is a promotion away.
  state.player.piece = 'pawn'; state.map[4] = '........';
  assert.equal(targetDistance(state, { x: 3, y: 5 }), 1);
  assert.ok(targetDistance(state, target) > 4);
});
