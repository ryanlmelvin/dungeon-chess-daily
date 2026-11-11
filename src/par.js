// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Par. Each floor is built around a short planted line (src/composer.js), the
// day's certificate, and its par is that line's moves plus one (decided
// 2026-11-10): E means you found the idea, under par the exact line or a
// clever use of a powerup or recruit, over par that you searched for it. Only
// the number is ever shown, never the line (until the Dungeon Bot replays it
// after a win). Pars are for the official piece, color and monsters, so a
// practice run with any other choice has none.
import { isOfficialRun } from './game.js';

/** Par per floor: each floor's planted line plus one, or null without a three-floor certificate. */
export function floorPars(daily) {
  const actions = daily?.generation?.certificate?.actions;
  if (!Array.isArray(actions)) return null;
  const pars = [];
  let moves = 0;
  for (const action of actions) {
    if (action?.type !== 'descend') { moves++; continue; }
    pars.push(moves + 1);
    moves = 0;
  }
  return pars.length === 3 && moves === 0 ? pars : null;
}

/** Pars for this run: only the official piece, color and monsters have one. */
export function runPars(state, daily) {
  if (!daily || !isOfficialRun(state, daily)) return null;
  return floorPars(daily);
}

/** Par for the floor the run is on, or null. */
export function parFor(state, daily) {
  return runPars(state, daily)?.[state.floor] ?? null;
}
