// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Moving terrain: the one answer to "is this square solid right now?".
//
// A room's walls never change (state.map, '#'). Two room modifiers add squares
// that do: a pit, where a cracked tile fell away (src/cracks.js), and a shut
// gate (src/gates.js). Both block exactly as a wall does: no piece stands
// there, a rook's, bishop's or queen's line stops there, and a knight jumps
// it. Everything that decides play asks one question, solid(), so the rules
// (src/rules.js walkable), the monsters, the exact search, the bot and the
// save check all see the same board.
//
// The squares terrain shuts right now travel in the game state as
// `state.shut`: two 32-bit masks (squares 0–31 and 32–63, a square being
// y * 8 + x), absent on a day without moving terrain, so a plain day's state
// and its saves keep their shape. Each modifier keeps its own record beside it
// (state.cracks and state.pits, or state.gates) and calls shutNow() whenever
// that record changes; the save check works the masks out again and compares.
//
// This module imports nothing, so every other one may use it.

const onBoard = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 8 && y < 8;

/** Is (x, y) a square of floor, shut or not: on the board and no wall? */
export function floorAt(state, x, y) {
  return onBoard(x, y) && state.map?.[y]?.[x] !== '#';
}

/** Does terrain shut (x, y) right now: a pit or a shut gate? Never true of a wall or of plain floor. */
export function shutAt(state, x, y) {
  const shut = state.shut;
  if (!shut || !onBoard(x, y)) return false;
  const bit = y * 8 + x;
  return Boolean((bit < 32 ? shut[0] >>> bit : shut[1] >>> (bit - 32)) & 1);
}

/** Is (x, y) solid right now: off the board, a wall, a pit or a shut gate? */
export function solid(state, x, y) {
  return !floorAt(state, x, y) || shutAt(state, x, y);
}

/** The two masks of a list of squares. */
export function maskOf(tiles) {
  let low = 0, high = 0;
  for (const { x, y } of tiles) {
    const bit = y * 8 + x;
    if (bit < 32) low |= 1 << bit; else high |= 1 << (bit - 32);
  }
  return [low, high];
}

/** The squares the state's own records shut right now: its pits and its shut gates. */
export function shutSquares(state) {
  return [...(state.pits ?? []), ...(state.gates ?? []).filter((gate) => gate.shut)];
}

/** Bring `state.shut` in step with the state's pits and gates (call after either changes). */
export function shutNow(state) {
  state.shut = maskOf(shutSquares(state));
}

/** Does the state carry moving terrain at all? */
export const hasTerrain = (state) => state?.shut !== undefined;

/**
 * The board with only what never comes back: its walls and its pits, every
 * gate open. For questions about what could ever happen (can a pickup be
 * reached, is the floor hopeless, is a piece cornered for good), which a gate
 * that opens again in two moves must not decide. The state itself when it has
 * no gates.
 */
export function settled(state) {
  if (!state?.gates?.length) return state;
  return { ...state, shut: maskOf(state.pits ?? []) };
}

/**
 * The room's map as it stands, for move tables (src/move-tables.js) and
 * anyone who plans over walls: its rows with a '#' on every square terrain
 * shuts right now. The state's own map when nothing is shut.
 */
export function terrainMap(state) {
  const shut = state.shut;
  if (!shut || (!shut[0] && !shut[1])) return state.map;
  return state.map.map((row, y) => {
    let out = '';
    for (let x = 0; x < 8; x++) out += shutAt(state, x, y) ? '#' : row[x];
    return out;
  });
}

/** Does anyone stand on `tile`: the player, the recruit at their side or a monster? */
export function occupied(state, tile) {
  const { player, companion, enemies } = state;
  if (player.x === tile.x && player.y === tile.y) return true;
  if (companion && companion.x === tile.x && companion.y === tile.y) return true;
  for (let i = 0; i < enemies.length; i++) if (enemies[i].x === tile.x && enemies[i].y === tile.y) return true;
  return false;
}

/** A lane's squares up to the first one terrain has shut since it was drawn (a wound-up path a gate closed on). */
export function openLane(state, tiles) {
  if (!state.shut) return tiles;
  const cut = tiles.findIndex((tile) => shutAt(state, tile.x, tile.y));
  return cut < 0 ? tiles : tiles.slice(0, cut);
}
