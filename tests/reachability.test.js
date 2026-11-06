// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, unreachablePickups } from '../src/rules.js';
import { generateDaily } from '../src/generation.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { FALLBACKS } from '../src/fallbacks.js';

function scenario(piece, x = 4, y = 6) {
  const state = createGame(getRawDaily('2026-11-05'));
  state.startingPiece = piece;
  Object.assign(state.player, { piece, x, y, moved: false });
  state.map = Array(8).fill('........');
  state.enemies = []; state.items = []; state.props = []; state.companion = null;
  return state;
}
function mapWithOpenSquares(squares) {
  const rows = Array.from({ length: 8 }, () => Array(8).fill('#'));
  for (const [x, y] of squares) rows[y][x] = '.';
  return rows.map((row) => row.join(''));
}

// This is terrain reachability with the actual chess movement graph. Combat
// survivability is checked independently by replaying the full winning route.
test('all fallback floors have reachable stationary pickups for every piece, side and difficulty', () => {
  let floors = 0;
  assert.equal(Object.keys(FALLBACKS).length, 36);
  for (const [identity, fallback] of Object.entries(FALLBACKS)) {
    const [difficulty, piece, color] = identity.split(':');
    const daily = generateDaily(fallback.date, { difficulty, maxAttempts: 0 });
    assert.equal(daily.playerPiece, piece);
    assert.equal(daily.playerColor, color);
    let state = createGame(daily);
    const visitedFloors = new Set();
    const checkFloor = () => {
      assert.deepEqual(unreachablePickups(state), [], `${identity}, floor ${state.floor}`);
      assert.ok(state.items.some((item) => item.type === 'coin'));
      assert.ok(state.items.some((item) => item.type === 'powerup'));
      assert.ok(state.items.some((item) => item.type === 'companion'));
      visitedFloors.add(state.floor); floors++;
    };
    checkFloor();
    for (const action of daily.generation.certificate.actions) {
      const next = act(state, action);
      const changedFloor = next.floor !== state.floor;
      state = next;
      if (changedFloor) checkFloor();
    }
    assert.equal(state.status, 'won');
    assert.deepEqual([...visitedFloors], [0, 1, 2]);
  }
  assert.equal(floors, 108);
});

test('a bishop cannot reach coins, relics or recruits on the opposite square color', () => {
  const state = scenario('bishop');
  state.items = [
    { type: 'coin', x: 4, y: 5 },
    { type: 'powerup', power: 'shield', x: 2, y: 5 },
    { type: 'companion', piece: 'rook', x: 6, y: 5 },
    { type: 'coin', x: 2, y: 4 },
  ];
  const original = structuredClone(state);
  assert.deepEqual(unreachablePickups(state), state.items.slice(0, 3));
  assert.deepEqual(state, original, 'checking reachability cannot change the dungeon');
});

test('matching a bishop square color is insufficient when walls isolate that square', () => {
  const state = scenario('bishop');
  state.map = mapWithOpenSquares([[4, 6], [2, 4]]);
  state.items = [{ type: 'coin', x: 2, y: 4 }];
  assert.equal((state.player.x + state.player.y) % 2, (state.items[0].x + state.items[0].y) % 2);
  assert.deepEqual(unreachablePickups(state), state.items);
});

test('an orthogonally connected corridor can still disconnect the knight movement graph', () => {
  const state = scenario('knight', 0, 6);
  state.map = mapWithOpenSquares(Array.from({ length: 8 }, (_, x) => [x, 6]));
  state.items = [{ type: 'coin', x: 7, y: 6 }];
  assert.equal(state.map[6], '........', 'ordinary walking has a clear path to the pickup');
  assert.deepEqual(unreachablePickups(state), state.items);
});

test('all 64 squares of an empty board are reachable by a knight', () => {
  const state = scenario('knight');
  state.items = Array.from({ length: 64 }, (_, index) => ({ type: 'coin', x: index % 8, y: Math.floor(index / 8) }));
  assert.deepEqual(unreachablePickups(state), []);
});

test('knight pickups may require revisiting a square; a tour through distinct squares is unnecessary', () => {
  const center = [3, 3], leaves = [[1, 2], [2, 1], [5, 2]];
  const state = scenario('knight', ...center);
  state.map = mapWithOpenSquares([center, ...leaves]);
  state.items = leaves.map(([x, y]) => ({ type: 'coin', x, y }));
  // The three leaves are mutually nonadjacent: visiting all three requires
  // returning to the center, so this graph has no Hamiltonian path or tour.
  for (let a = 0; a < leaves.length; a++) for (let b = a + 1; b < leaves.length; b++) {
    const dx = Math.abs(leaves[a][0] - leaves[b][0]), dy = Math.abs(leaves[a][1] - leaves[b][1]);
    assert.ok(!((dx === 1 && dy === 2) || (dx === 2 && dy === 1)));
  }
  assert.deepEqual(unreachablePickups(state), []);
});

test('a pawn can reach a pickup behind it by promoting and returning as a queen', () => {
  const state = scenario('pawn');
  state.items = [{ type: 'companion', piece: 'knight', x: 4, y: 7 }, { type: 'coin', x: 0, y: 7 }];
  assert.deepEqual(unreachablePickups(state), []);
  assert.equal(state.player.piece, 'pawn', 'the analysis must not promote the live player');
});

test('a blocked pawn cannot assume promotion or capture an empty diagonal pickup square', () => {
  const state = scenario('pawn');
  state.map[5] = '....#...';
  state.items = [{ type: 'coin', x: 3, y: 5 }, { type: 'companion', piece: 'rook', x: 4, y: 7 }];
  assert.deepEqual(unreachablePickups(state), state.items);
});

test('certification rejects an unreachable pickup even when the unchanged route still wins', () => {
  const fallback = FALLBACKS['standard:bishop:white'];
  const daily = generateDaily(fallback.date, { maxAttempts: 0 });
  const initial = createGame(daily);
  const actions = daily.generation.certificate.actions;
  assert.equal(verifyWinningRoute(initial, actions).valid, true);
  let impossible;
  for (let y = 0; y < 8 && !impossible; y++) for (let x = 0; x < 8; x++) {
    if ((x + y) % 2 === 1 && initial.map[y][x] !== '#' && !initial.items.some((item) => item.x === x && item.y === y)) {
      impossible = { type: 'coin', x, y }; break;
    }
  }
  assert.ok(impossible);
  initial.items.push(impossible);
  let state = initial;
  for (const action of actions) state = act(state, action);
  assert.equal(state.status, 'won', 'the added stationary coin does not obstruct the existing solution');
  const proof = verifyWinningRoute(initial, actions);
  assert.equal(proof.valid, false, 'winning the dungeon does not excuse an unreachable pickup');
});
