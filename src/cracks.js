// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Crumbling floor (a room modifier, src/modifiers.js 'cracks'): some tiles of
// each room are cracked. A cracked tile holds whoever stands on it and falls
// away the moment that piece steps off: yours, your recruit's or a monster's.
// What is left is a pit, and a pit is terrain (src/terrain.js): nobody stands
// there, lines stop there, knights jump it. It never comes back on that floor;
// restarting the floor mends every tile.
//
// The details, decided once:
// - Only a piece that stood on the tile breaks it. A rook, bishop or queen
//   sliding across, and a knight jumping over, leave it whole.
// - Taking a piece on a cracked tile puts the taker there: the tile holds
//   until the taker leaves. A captured player stays where they stand, so
//   nothing falls (a promoted pawn sent back to a pawn does leave its tile).
// - While two share a tile (you and the recruit you just joined) it holds
//   until the second one leaves.
// - A lunge at the square you left finds a pit there if that tile was
//   cracked: the monster stays where it is, off-balance all the same.
// - A monster with no step left simply stays put, as one boxed in by walls
//   always has.
// - A room lays its own cracked tiles (`room.cracks`, src/composer.js lays
//   them around its planted line); one that lays none has none. No tile is
//   cracked under a pickup or a waiting recruit, so nothing is ever lost down
//   a pit.
//
// The state keeps `cracks` (the tiles still cracked) and `pits` (those that
// fell, in the order they fell); src/terrain.js keeps the board in step.
import { shutNow, occupied } from './terrain.js';

/** Cracked tiles a composed room lays, about. */
export const CRACK_TILES = 8;

const same = (a, b) => a.x === b.x && a.y === b.y;
const byRow = (a, b) => a.y - b.y || a.x - b.x;

/** A floor begins: its room's cracked tiles, none under a pickup, and no pit yet. */
export function setupCracks(state, room) {
  state.cracks = (room?.cracks ?? []).filter((tile) => !state.items.some((item) => same(item, tile)))
    .map(({ x, y }) => ({ x, y })).sort(byRow);
  state.pits = [];
  shutNow(state);
}

/** Is `tile` cracked and still standing? */
export function cracked(state, tile) { return Boolean(state.cracks?.some((entry) => same(entry, tile))); }

/**
 * A piece has just stepped off (x, y): if the tile there is cracked and nobody
 * else still stands on it, it falls away and leaves a pit. `by` says whose
 * step it was ('player', 'companion' or a monster's id), for the board's
 * timing. Returns whether it fell.
 */
export function stepOff(state, x, y, by) {
  const cracks = state.cracks;
  if (!cracks?.length) return false;
  const at = cracks.findIndex((tile) => tile.x === x && tile.y === y);
  if (at < 0 || occupied(state, { x, y })) return false;
  cracks.splice(at, 1);
  state.pits.push({ x, y });
  shutNow(state);
  state.events.push({ type: 'crumble', x, y, by });
  return true;
}

/**
 * The save check: the tiles still cracked and the pits are together exactly
 * the floor's cracked tiles as its room laid them (`template`, the floor
 * freshly set up), and nobody stands in a pit.
 */
export function validCracks(value, template) {
  const { cracks, pits } = value;
  if (!Array.isArray(cracks) || !Array.isArray(pits)) return false;
  const plain = (tile) => tile && Object.keys(tile).length === 2 && Number.isInteger(tile.x) && Number.isInteger(tile.y);
  if (![...cracks, ...pits].every(plain)) return false;
  if (JSON.stringify([...cracks].sort(byRow)) !== JSON.stringify(cracks)) return false;
  if (JSON.stringify([...cracks, ...pits].sort(byRow)) !== JSON.stringify(template.cracks)) return false;
  return !pits.some((pit) => occupied(value, pit));
}
