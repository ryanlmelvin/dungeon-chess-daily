// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame } from '../src/rules.js';
import { getDaily } from '../src/generation.js';

const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
const STRAIGHT = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const SLANT = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
// Each monster's opening moves on an empty board; lines count only their first square.
function opening({ x, y, piece }) {
  const deltas = { pawn: y === 1 ? [[0, 1], [0, 2]] : [[0, 1]], knight: KNIGHT, rook: STRAIGHT, bishop: SLANT }[piece] ?? [...STRAIGHT, ...SLANT];
  return deltas.map(([dx, dy]) => [x + dx, y + dy]).filter(([tx, ty]) => tx >= 0 && ty >= 0 && tx < 8 && ty < 8);
}

test('no wall stands on a monster opening move on any floor (Ice crab, 2026-11-06)', () => {
  for (const difficulty of ['gentle', 'standard', 'expert']) for (let offset = 1; offset <= 20; offset++) {
    const date = new Date(Date.UTC(2026, 10, 5 + offset)).toISOString().slice(0, 10);
    const daily = getDaily(date, { difficulty });
    let state = createGame(daily);
    const check = () => {
      for (const foe of state.enemies) for (const [x, y] of opening(foe)) {
        assert.notEqual(state.map[y][x], '#', `${difficulty} ${date} floor ${state.floor}: wall at ${x},${y} blocks ${foe.name} (${foe.piece}) at ${foe.x},${foe.y}`);
      }
    };
    check();
    for (const action of daily.generation.certificate.actions) {
      state = act(state, action);
      if (action.type === 'descend' && state.status === 'playing') check();
    }
  }
});

// Saved 2026-11-05 runs are validated against regenerated rooms, so its layouts are frozen.
const LAUNCH_MAPS = {"gentle": [[".......#", "........", "........", "........", "........", "......#.", "#.....#.", ".......#"], ["........", "#.......", ".......#", "........", "........", "......#.", "#.....#.", "..#....."], ["........", "#......#", "........", "#.......", "#.......", "#.......", ".#.....#", "........"]], "standard": [[".......#", "........", "........", "........", "........", "..#...#.", "#.....#.", "#......#"], ["........", "#.......", ".......#", ".......#", "........", "......##", "#.....#.", "..#....."], ["........", "#......#", "........", "#.......", "#......#", "#.......", ".#....##", "........"]], "expert": [[".......#", "........", "........", "..#.....", ".#......", "..#...#.", "#.....#.", "#......#"], ["........", "#.......", "..#....#", ".......#", "........", "......##", "#.....##", "..#....."], ["........", "#......#", "........", "#.......", "#......#", "#.......", ".#....##", "#.#....."]]};

// Gentle's launch edition now certifies only through a fallback dungeon under the
// royal king-floor rules, so only the launch seed's own profiles keep these maps.
test('the launch edition keeps its published room layouts where it still uses the launch seed', () => {
  for (const [difficulty, maps] of Object.entries(LAUNCH_MAPS)) {
    if (difficulty === 'gentle') continue;
    const daily = getDaily('2026-11-05', { difficulty });
    let state = createGame(daily);
    const seen = [state.map];
    for (const action of daily.generation.certificate.actions) {
      state = act(state, action);
      if (action.type === 'descend' && state.status === 'playing') seen.push(state.map);
    }
    assert.deepEqual(seen, maps, difficulty);
  }
});
