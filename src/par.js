// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Par. Each floor's par is the move count of the certified route (the Dungeon
// Bot) on that floor. Only the number is ever shown, never the route. The
// certificate is for the official piece and color, so a practice run with any
// other piece or color has no par.
import { botRun } from './bot.js';

const cache = new Map();
/** The certified route's moves per floor, or null when the edition has no replayable certificate. */
export function floorPars(daily) {
  const id = `${daily?.date}:${daily?.seed}:${daily?.difficulty}:${daily?.generation?.certificate?.actions?.length}`;
  if (!cache.has(id)) {
    const floors = botRun(daily)?.floors ?? null;
    if (cache.size >= 16) cache.delete(cache.keys().next().value);
    cache.set(id, floors && floors.every((par) => Number.isInteger(par) && par > 0) ? floors : null);
  }
  return cache.get(id);
}

/** Pars for this run: only the official piece and color have one. */
export function runPars(state, daily) {
  if (!state || !daily || state.startingPiece !== daily.playerPiece || state.playerColor !== daily.playerColor) return null;
  return floorPars(daily);
}

/** Par for the floor the run is on, or null. */
export function parFor(state, daily) {
  return runPars(state, daily)?.[state.floor] ?? null;
}
