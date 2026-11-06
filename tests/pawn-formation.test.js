// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

const FIXED_V = [[3, 3], [5, 3], [2, 2], [6, 2], [1, 1], [7, 1], [0, 2], [6, 0]];
const pawnSquares = (state) => state.enemies
  .filter((foe) => foe.species === state.species[state.floor].id)
  .map((foe) => `${foe.x},${foe.y}`).sort();

test('pawn floors draw varied formations that keep the rules of the old V (from 2026-11-07)', () => {
  const seen = new Set();
  let count = 0;
  for (let offset = 2; offset < 367; offset++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + offset)).toISOString().slice(0, 10));
    if (daily.species[0].piece !== 'pawn') continue;
    const state = createGame(daily);
    const squares = pawnSquares(state);
    const label = `${daily.date}: ${squares.join(' ')}`;
    assert.equal(squares.length, 8, label);
    const tiles = squares.map((key) => key.split(',').map(Number));
    assert.ok(tiles.every(([x, y]) => x !== 4 && y <= 3), `${label}: off the player's file, in the back four rows`);
    assert.ok(tiles.filter(([x]) => x < 4).length >= 3 && tiles.filter(([x]) => x > 4).length >= 3, `${label}: both sides`);
    for (let y = 0; y < 4; y++) assert.ok(tiles.filter(([, row]) => row === y).length <= 3, `${label}: row ${y}`);
    const occupied = state.enemies.map((foe) => `${foe.x},${foe.y}`);
    assert.equal(new Set(occupied).size, occupied.length, `${label}: no shared squares`);
    assert.ok(tiles.every(([x, y]) => state.map[y][x] !== '#'), `${label}: no pawn on a wall`);
    seen.add(squares.join(' '));
    count++;
  }
  assert.ok(count > 30);
  assert.ok(seen.size >= count - 1, `${seen.size} distinct formations over ${count} pawn floors`);
});

test('the first two editions keep their fixed pawn V', () => {
  for (const date of ['2026-11-05', '2026-11-06']) {
    const state = createGame(getRawDaily(date));
    const squares = pawnSquares(state);
    const plain = FIXED_V.map(([x, y]) => `${x},${y}`).sort();
    const mirrored = FIXED_V.map(([x, y]) => `${x ? 8 - x : x},${y}`).sort();
    assert.ok([plain.join(), mirrored.join()].includes(squares.join()), `${date}: ${squares.join(' ')}`);
  }
});
