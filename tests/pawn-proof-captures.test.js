// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { spendableHits, routeTransition, safeTransition } from '../src/fairness.js';
import { withRooms } from './fixtures/rooms.js';

function dailyFor(piece) {
  const start = Date.parse('2026-11-05T00:00:00Z');
  for (let i = 0; i < 400; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const daily = getRawDaily(date);
    if (daily.playerPiece === piece && daily.playerColor === 'white') return daily;
  }
  throw new Error(`no white ${piece} day found`);
}

// The player starts at (4,6) and moves to (4,5) (a one-square step every piece
// can make); an aimed bat far away on row 5 has that square in its lane.
// `hits`: the captures the run has taken so far.
function position(piece, hits) {
  const state = createGame(withRooms(dailyFor(piece)));
  state.map = Array(8).fill('........');
  state.items = [];
  state.props = [];
  state.companion = null;
  state.companions = [];
  state.objective = { piece: 'king', complete: false };
  for (const key of Object.keys(state.powers)) state.powers[key] = 0;
  state.player.x = 4;
  state.player.y = 6;
  state.hits = hits;
  state.enemies = [{
    id: 'bat-1', piece: 'rook', role: 'rook', species: 'bat', palette: 'ice', name: 'Ice bat',
    x: 0, y: 5, moved: false, phase: 'aim', target: { x: 4, y: 5 },
    intent: [{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
  }];
  return state;
}
const move = { type: 'move', x: 4, y: 5 };
const captured = (state) => act(state, move).events.some((event) => event.type === 'player-captured');

test('spendableHits is 4 for pawn and 0 for every other piece', () => {
  for (const piece of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']) {
    const state = { startingPiece: piece };
    assert.equal(spendableHits(state), piece === 'pawn' ? 4 : 0, piece);
  }
});

test('pawn day never captured yet: routeTransition accepts a capture, strict transition does not', () => {
  const state = position('pawn', 0);
  assert.ok(captured(state), 'setup must produce a capture');
  const next = routeTransition(state, move);
  assert.ok(next);
  assert.equal(next.hits, 1);
  assert.equal(safeTransition(state, move), null);
});

test('pawn day at its allowance: routeTransition rejects another capture', () => {
  const state = position('pawn', 4);
  assert.ok(captured(state), 'setup must produce a capture');
  assert.equal(routeTransition(state, move), null);
});

test('rook day: routeTransition rejects a capture', () => {
  const state = position('rook', 0);
  assert.ok(captured(state), 'setup must produce a capture');
  assert.equal(routeTransition(state, move), null);
});
