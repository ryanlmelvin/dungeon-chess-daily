// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame } from '../src/rules.js';
import { withRooms } from './fixtures/rooms.js';

// Tiny white rooms on floor 1 (no royal rules). The player waits, so every
// monster takes one ordinary step. Each habit is checked on several turn
// numbers, because the seeded tie-break hashes the turn.
const unit = (id, piece, x, y, moved = true) => ({ id, species: 'bat', palette: 'ice', name: id, piece, role: piece, x, y, moved, phase: 'ready', intent: [], target: null });
function room([piece, px, py], enemies) {
  const s = createGame(withRooms('2026-11-10'));
  Object.assign(s, { playerColor: 'white', awaitingPlayer: false, floor: 0, map: Array(8).fill('........'), items: [], companion: null, enemies });
  s.objective = { piece: 'king', complete: false };
  s.exit = { x: 4, y: 0, open: false };
  s.powers = { shield: 0, freeze: 0, magnet: 0 };
  Object.assign(s.player, { piece, x: px, y: py });
  return s;
}
const TURNS = [0, 1, 2, 3, 4, 5, 6, 7];
function afterWait(make, turns) {
  const s = make();
  s.turns = turns;
  const next = act(s, { type: 'wait' });
  return Object.fromEntries(next.enemies.map((foe) => [foe.id, foe]));
}

test('a knight jumps to a square that attacks the player and winds up', () => {
  // From (2,3) it could also close in to (0,4); (1,5) attacks the bishop at (0,7).
  for (const turns of TURNS) {
    const { knight } = afterWait(() => room(['bishop', 0, 7], [unit('knight', 'knight', 2, 3)]), turns);
    assert.deepEqual([knight.x, knight.y, knight.phase], [1, 5, 'aim'], `turn ${turns}`);
  }
});

test('a knight never lands where the player can capture it, and hovers to cover escape squares', () => {
  // The plain approach step (0,5) sits on the rook's file.
  for (const turns of TURNS) {
    const { knight } = afterWait(() => room(['rook', 0, 7], [unit('knight', 'knight', 2, 4)]), turns);
    assert.ok(knight.x !== 0 && knight.y !== 7, `turn ${turns}: ${knight.x},${knight.y} is on the rook's lines`);
    // Both choices it keeps cover a rank-7 square the rook could step to.
    assert.ok([[1, 6], [3, 6]].some(([x, y]) => knight.x === x && knight.y === y), `turn ${turns}: ${knight.x},${knight.y}`);
  }
});

test('a rook cuts off the player instead of lining up for a check', () => {
  // The greedy step would be (0,7) on the king's rank; (0,6) seals rank 6.
  for (const turns of TURNS) {
    const { rook } = afterWait(() => room(['king', 4, 7], [unit('rook', 'rook', 0, 0)]), turns);
    assert.deepEqual([rook.x, rook.y], [0, 6], `turn ${turns}`);
    assert.equal(rook.phase, 'ready');
  }
});

test('a queen cuts off escape squares with an open line', () => {
  for (const turns of TURNS) {
    const { queen } = afterWait(() => room(['king', 4, 7], [unit('queen', 'queen', 1, 0)]), turns);
    assert.deepEqual([queen.x, queen.y], [1, 6], `turn ${turns}`);
  }
});

test('a pawn advances into its chain instead of double-stepping alone', () => {
  // (3,1) guards (4,2); the double step to (4,3) would leave it unguarded.
  for (const turns of TURNS) {
    const { lead } = afterWait(() => room(['bishop', 0, 7], [unit('lead', 'pawn', 4, 1, false), unit('base', 'pawn', 3, 1, false)]), turns);
    assert.deepEqual([lead.x, lead.y], [4, 2], `turn ${turns}`);
  }
});

test('a threatened, unguarded monster retreats behind a defender', () => {
  // The rook on (0,7) attacks the king on (0,3). The knight on (3,4) guards
  // (1,3); the plain approach would be (0,4), still on the rook's file.
  for (const turns of TURNS) {
    const { king } = afterWait(() => room(['rook', 0, 7], [unit('king', 'king', 0, 3), unit('knight', 'knight', 3, 4)]), turns);
    assert.deepEqual([king.x, king.y], [1, 3], `turn ${turns}`);
  }
  // A bishop on the rook's file tucks in beside a pawn that guards (1,2).
  for (const turns of TURNS) {
    const { bishop } = afterWait(() => room(['rook', 0, 7], [unit('bishop', 'bishop', 0, 3), unit('pawn', 'pawn', 2, 1)]), turns);
    assert.deepEqual([bishop.x, bishop.y], [1, 2], `turn ${turns}`);
  }
});

test('an unthreatened king still simply approaches', () => {
  for (const turns of TURNS) {
    const { king } = afterWait(() => room(['bishop', 7, 7], [unit('king', 'king', 0, 3), unit('knight', 'knight', 3, 4)]), turns);
    assert.deepEqual([king.x, king.y], [1, 4], `turn ${turns}`);
  }
});

test('habits are deterministic and never move a monster off its legal steps', () => {
  const make = () => room(['queen', 3, 6], [unit('n', 'knight', 1, 1), unit('r', 'rook', 6, 0), unit('b', 'bishop', 2, 0), unit('p', 'pawn', 5, 1, false)]);
  for (const turns of TURNS) {
    const a = afterWait(make, turns), b = afterWait(make, turns);
    assert.deepEqual(a, b);
    for (const foe of Object.values(a)) assert.ok(foe.x >= 0 && foe.x < 8 && foe.y >= 0 && foe.y < 8);
    assert.equal(a.p.x, 5, 'a pawn stays on its file');
  }
});
