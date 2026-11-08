// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Par. Each floor's par is how many moves the human-like bot (src/human-bot.js)
// usually needs there, steering its recruit as on Manual recruit control: the
// median of its seeded runs from the floor's standard start, or the certified
// route's moves plus 25% when every run failed. The build stores it with each
// edition (src/editions.js); a date past
// that window works it out once on the device and remembers it. Only the
// number is ever shown, never a route. Pars are for the official piece and
// color, so a practice run with any other piece or color has no par.
import { EDITIONS } from './editions.js';
import { encodeRoute } from './route-code.js';
import { RULES_VERSION } from './rules.js';
import { tierForDate } from './difficulty.js';
import { humanPar, HUMAN_BOT_VERSION, HUMAN_RUNS } from './human-bot.js';

/** A stored summary: three positive pars, and per floor the run shown (null where the bot failed). */
export function validSummary(value) {
  return Array.isArray(value?.par) && value.par.length === 3 && value.par.every((par) => Number.isInteger(par) && par > 0)
    && Array.isArray(value.runs) && value.runs.length === 3
    && value.runs.every((run) => run === null || (Number.isInteger(run) && run >= 0 && run < HUMAN_RUNS));
}

const routeOf = (daily) => encodeRoute(daily.generation.certificate.actions);
// The build's entry, when it was made for this very certificate.
function storedSummary(daily) {
  const entry = EDITIONS[daily.date], generation = daily.generation;
  if (!entry || entry.tier !== daily.difficulty || !validSummary(entry)) return null;
  const same = entry.attempt === 'fallback' ? generation.source === 'fallback'
    : generation.source === 'generated' && entry.attempt === generation.attempt && entry.route === routeOf(daily);
  return same ? { par: entry.par, runs: entry.runs } : null;
}

// Past the build's window the device works par out once per edition and
// keeps it next to the remembered certificate. Storage is optional.
const deviceKey = (date) => `dchess-par:v${RULES_VERSION}.${HUMAN_BOT_VERSION}:${date}`;
function rememberedSummary(daily) {
  try {
    const entry = JSON.parse(globalThis.localStorage?.getItem(deviceKey(daily.date)) ?? 'null');
    return entry?.tier === daily.difficulty && entry.route === routeOf(daily) && validSummary(entry) ? { par: entry.par, runs: entry.runs } : null;
  } catch { return null; }
}
function rememberSummary(daily, summary) {
  if (EDITIONS[daily.date] || daily.difficulty !== tierForDate(daily.date)) return;
  try { globalThis.localStorage?.setItem(deviceKey(daily.date), JSON.stringify({ tier: daily.difficulty, route: routeOf(daily), ...summary })); } catch { /* storage is optional */ }
}

const cache = new Map();
/**
 * The human-like bot's summary for a certified edition: `par` per floor and
 * `runs`, the run the result card replays per floor (null where every run
 * failed). Null without a replayable certificate.
 */
export function humanSummary(daily) {
  const actions = daily?.generation?.certificate?.actions;
  if (!Array.isArray(actions) || !actions.length) return null;
  const id = `${daily.date}:${daily.seed}:${daily.difficulty}:${encodeRoute(actions)}`;
  if (!cache.has(id)) {
    let summary = storedSummary(daily) ?? rememberedSummary(daily);
    if (!summary) {
      const computed = humanPar(daily);
      summary = computed && { par: computed.par, runs: computed.runs };
      if (summary) rememberSummary(daily, summary);
    }
    if (cache.size >= 16) cache.delete(cache.keys().next().value);
    cache.set(id, summary);
  }
  const summary = cache.get(id);
  return summary && { par: [...summary.par], runs: [...summary.runs] };
}

/** Par per floor, or null when the edition has no replayable certificate. */
export function floorPars(daily) {
  return humanSummary(daily)?.par ?? null;
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
