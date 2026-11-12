// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Composed rooms for engine tests. Every game is built from three composed
// rooms (src/rules.js createGame): editions carry the composer's, and a test
// lays its own from a map, enemies and items. Floors a test leaves out are
// open and empty, so a test may also set up its board by hand.
import { getRawDaily } from '../../src/edition.js';

/** An open map with walls on the given [x, y] squares. */
export function openMap(walls = []) {
  const wall = new Set(walls.map(([x, y]) => `${x},${y}`));
  return Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (wall.has(`${x},${y}`) ? '#' : '.')).join(''));
}

/**
 * One composed room: its `map` (eight rows of '.' and '#') or `walls` on an
 * open one; `enemies`, each { x, y, cast } (0 the floor's target species, 1
 * and 2 its decoy species) or { x, y, species }, with `held` moves asleep;
 * `items` (coins, powerups, a recruit); the player's `start` (e2 by default)
 * and, on an Ice day, its own `ice`; on a day with moving terrain, its own
 * `cracks` (cracked tiles) or `gates` ({ x, y, phase }).
 */
export function room({ map, walls = [], enemies = [], items = [], start, ice, cracks, gates } = {}) {
  return { map: map ? [...map] : openMap(walls), enemies, items, ...(start && { start }), ...(ice && { ice }), ...(cracks && { cracks }), ...(gates && { gates }) };
}

/** A daily (or a date's raw daily) with these rooms, floor by floor; a floor left out is open and empty. */
export function withRooms(daily, ...rooms) {
  const raw = typeof daily === 'string' ? getRawDaily(daily) : daily;
  return { ...raw, composed: [0, 1, 2].map((floor) => rooms[floor] ?? room()) };
}
