// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Par and stars. Each floor's par is the move count of the certified route
// (the Dungeon Bot) on that floor. Only the number is ever shown, never the
// route. The certificate is for the official piece and color, so a practice run
// with any other piece or color has no par and earns no stars.
import { botRun } from './bot.js';

export const MAX_STARS = 3;
/** Moves over par that still earn two stars. */
export const STAR_SLACK = 5;

/** ⭐⭐⭐ at or under par, ⭐⭐ within par + 5, ⭐ otherwise; null without a par. */
export function starsFor(turns, par) {
  if (!Number.isInteger(turns) || !Number.isInteger(par) || par < 1) return null;
  return turns <= par ? 3 : turns <= par + STAR_SLACK ? 2 : 1;
}

export const starText = (stars) => '⭐'.repeat(stars);

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

/**
 * Award stars to cleared floors that have none yet, in place. The engine stores
 * the floor-start snapshot's copy of earlier records too, so it gets the same
 * stars and a floor reset or save validation still matches. Returns the floor
 * records that were just scored.
 */
export function awardStars(state, pars) {
  if (!Array.isArray(pars) || !Array.isArray(state?.records)) return [];
  const scored = [];
  for (const record of state.records) {
    if (record.stars !== undefined) continue;
    const stars = starsFor(record.turns, pars[record.floor]);
    if (stars === null) continue;
    record.stars = stars;
    const copy = state.floorSnapshot?.records?.find((entry) => entry.floor === record.floor);
    if (copy) copy.stars = stars;
    scored.push(record);
  }
  return scored;
}

/** Total stars once every floor has been scored, otherwise null. */
export function totalStars(records) {
  if (!Array.isArray(records) || records.length !== 3 || !records.every((record) => Number.isInteger(record?.stars))) return null;
  return records.reduce((sum, record) => sum + record.stars, 0);
}
