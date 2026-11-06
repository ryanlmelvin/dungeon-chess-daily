// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame } from '../src/game.js';
import { getDaily } from '../src/generation.js';
import { getRawDaily } from '../src/edition.js';
import { hash } from '../src/random.js';

const unit = (id, piece, x, y, role = piece) => ({ id, species: 'bat', palette: 'ice', name: id, piece, role, x, y, moved: true, phase: 'ready', intent: [], target: null });
function room(floor, player, enemies, map = Array(8).fill('........'), date = '2026-11-10') {
  const s = createGame(getRawDaily(date));
  Object.assign(s, { playerColor: 'white', awaitingPlayer: false, floor, map, items: [], companion: null, enemies });
  s.objective = { piece: 'king', complete: false };
  s.exit = { x: 4, y: 0, open: false };
  s.powers = { shield: 0, freeze: 0, magnet: 0 };
  Object.assign(s.player, { piece: 'rook', x: player[0], y: player[1] });
  return s;
}
const rookAttacks = (s, x, y) => s.player.x === x || s.player.y === y;

test('a threatened king steps off the rook lines', () => {
  const king = unit('king', 'king', 4, 3, 'king');
  const after = act(room(2, [0, 6], [king]), { type: 'move', x: 0, y: 3 });
  const k = after.enemies.find((e) => e.id === 'king');
  assert.ok(k);
  assert.ok(!rookAttacks(after, k.x, k.y));
});

test('a guard interposes when the boxed king cannot flee', () => {
  const map = Array(8).fill('........'); map[0] = '.#......'; map[1] = '.#......';
  const s = room(2, [3, 5], [unit('king', 'king', 0, 0, 'king'), unit('guard', 'bishop', 1, 2)], map);
  const after = act(s, { type: 'move', x: 0, y: 5 });
  const guard = after.enemies.find((e) => e.id === 'guard');
  assert.equal(guard.x, 0);
  assert.ok(guard.y >= 1 && guard.y <= 4);
  assert.ok(after.enemies.some((e) => e.id === 'king'));
});

test('a screening guard stays on the line', () => {
  const map = Array(8).fill('........'); map[0] = '.#......'; map[1] = '.#......';
  const s = room(2, [3, 5], [unit('king', 'king', 0, 0, 'king'), unit('screen', 'knight', 0, 1)], map);
  const after = act(s, { type: 'move', x: 0, y: 5 });
  const screen = after.enemies.find((e) => e.id === 'screen');
  assert.deepEqual([screen.x, screen.y], [0, 1]);
});

test('an unthreatened king that can safely threaten the player aims', () => {
  const map = Array(8).fill('........'); map[2] = '......##';
  const after = act(room(2, [6, 6], [unit('king', 'king', 7, 3, 'king')], map), { type: 'move', x: 6, y: 5 });
  const k = after.enemies[0];
  assert.deepEqual([k.x, k.y], [7, 4]);
  assert.equal(k.phase, 'aim');
});

// The pre-royal monster step: approach the player, tie-broken by the turn hash.
function originalKingStep(s, player) {
  const seed = s.dungeonSeed ?? s.seed, turn = s.turns + 1, foe = s.enemies[0];
  const d = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const squares = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) squares.push({ x: foe.x + dx, y: foe.y + dy });
  const score = (m) => d(m, player) + 0.35 * d(m, foe) + 0.7 * hash(`${seed}:${s.floor}:${turn}:king:${m.x},${m.y}`) / 4294967296;
  const expected = squares.sort((a, b) => score(a) - score(b))[0];
  return [expected.x, expected.y];
}

test('floor 1 monsters still use the original movement formula', () => {
  const s = room(1, [0, 6], [unit('king', 'king', 4, 2, 'king')]);
  const expected = originalKingStep(s, { x: 0, y: 5 });
  const after = act(s, { type: 'move', x: 0, y: 5 });
  assert.deepEqual([after.enemies[0].x, after.enemies[0].y], expected);
});

// Replays the certified route to the king floor and returns its recruit.
function kingFloorRecruit(date) {
  const daily = getDaily(date);
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) { if (state.floor === 2) break; state = act(state, action); }
  assert.equal(state.floor, 2);
  return { recruit: state.items.find((item) => item.type === 'companion') ?? state.companion };
}

test('every edition offers a rook, queen or king recruit on the king floor', () => {
  for (const date of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-12', '2026-11-20']) {
    const { recruit } = kingFloorRecruit(date);
    assert.ok(['rook', 'queen', 'king'].includes(recruit.piece ?? recruit.basePiece), `${date}: ${JSON.stringify(recruit)}`);
  }
});
