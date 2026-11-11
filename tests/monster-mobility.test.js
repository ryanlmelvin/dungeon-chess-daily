// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame } from '../src/rules.js';
import { randomRoomDaily } from './fixtures/random-room.js';

const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
const STRAIGHT = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const SLANT = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
// Each monster's opening moves on an empty board; lines count only their first square.
function opening({ x, y, piece }) {
  const deltas = { pawn: y === 1 ? [[0, 1], [0, 2]] : [[0, 1]], knight: KNIGHT, rook: STRAIGHT, bishop: SLANT }[piece] ?? [...STRAIGHT, ...SLANT];
  return deltas.map(([dx, dy]) => [x + dx, y + dy]).filter(([tx, ty]) => tx >= 0 && ty >= 0 && tx < 8 && ty < 8);
}

// Random rooms (tests/fixtures/random-room.js) keep every monster's opening
// moves open. Composed rooms wall their decoys and pockets in on purpose.
test('no wall stands on a monster opening move on any floor of a random room (Ice crab, 2026-11-06)', () => {
  for (let offset = 1; offset <= 20; offset++) {
    const date = new Date(Date.UTC(2026, 10, 5 + offset)).toISOString().slice(0, 10);
    const tier = ['gentle', 'fair', 'tricky', 'tough', 'fiendish'][offset % 5];
    const daily = randomRoomDaily(date, { tier });
    const difficulty = daily.difficulty;
    let state = createGame(daily);
    const check = () => {
      for (const foe of state.enemies) for (const [x, y] of opening(foe)) {
        assert.notEqual(state.map[y][x], '#', `${difficulty} ${date} floor ${state.floor}: wall at ${x},${y} blocks ${foe.name} (${foe.piece}) at ${foe.x},${foe.y}`);
      }
    };
    check();
    // Each floor as it begins, the one before cleared in place.
    for (let floor = 1; floor < 3; floor++) {
      const cleared = structuredClone(state);
      cleared.enemies = cleared.enemies.filter((foe) => foe.role !== cleared.objective.piece);
      cleared.objective.complete = true; cleared.exit.open = true;
      state = act(cleared, { type: 'descend' });
      check();
    }
  }
});
