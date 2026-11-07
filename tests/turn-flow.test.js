// SPDX-License-Identifier: GPL-3.0-only
// Turn flow: the final floor's king keeps out of a held Borrowed move's reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

const wait = { type: 'wait' };
function dailyFor(piece) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece) return daily;
  }
  throw Error(`No ${piece} edition found`);
}
function scenario({ piece = 'rook', color = 'white', at = [4, 6], hp = 3, floor = 0 } = {}) {
  const state = createGame({ ...dailyFor(piece === 'king' ? 'rook' : piece), playerColor: color });
  Object.assign(state, { floor, map: Array(8).fill('........'), props: [], items: [], enemies: [], companion: null, awaitingPlayer: false });
  state.objective = { piece: 'king', complete: false };
  state.exit = { x: 4, y: 0, open: false };
  state.powers = { shield: 0, freeze: 0, magnet: 0, pin: 0, leap: 0, takeback: 0 };
  Object.assign(state.player, { piece, x: at[0], y: at[1], hp, maxHp: hp });
  return state;
}
// A monster; `lane` (with its last square the target) winds it up.
function monster(id, piece, x, y, lane = null) {
  return { id, piece, role: piece, species: 'bat', palette: 'violet', name: 'Violet bat', x, y, moved: true,
    phase: lane ? 'aim' : 'ready', target: lane ? { ...lane.at(-1) } : null, intent: lane ? lane.map((tile) => ({ ...tile })) : [] };
}
const foe = (state, id) => state.enemies.find((entry) => entry.id === id);

// 2. The royal king respects a held Borrowed move.

test('the final floor’s king stays out of a held Borrowed knight jump', () => {
  const held = scenario({ floor: 2 }); held.powers.leap = 1;
  held.enemies = [monster('king', 'king', 7, 7)];
  const next = act(held, wait);
  const king = foe(next, 'king');
  assert.notDeepEqual([king.x, king.y], [6, 7], 'a knight’s jump from the rook');
  assert.ok(!legalMoves(next).some((tile) => tile.capture && tile.x === king.x && tile.y === king.y));
  // Without the Borrowed move that square is safe, and the king takes it.
  const plain = scenario({ floor: 2 });
  plain.enemies = [monster('king', 'king', 7, 7)];
  const free = foe(act(plain, wait), 'king');
  assert.deepEqual([free.x, free.y], [6, 7]);
});

test('the final floor’s king stays off a knight’s borrowed queen lines', () => {
  const state = scenario({ piece: 'knight', floor: 2 }); state.powers.leap = 1;
  state.enemies = [monster('king', 'king', 4, 4)];
  const next = act(state, wait);
  const king = foe(next, 'king');
  assert.ok(!legalMoves(next).some((tile) => tile.capture && tile.x === king.x && tile.y === king.y));
});
