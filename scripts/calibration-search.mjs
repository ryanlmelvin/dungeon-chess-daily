// SPDX-License-Identifier: GPL-3.0-only
// Helpers for scripts/calibrate-difficulty.mjs's data file: the human-like
// bot's runs kept per search and the capped human gap they give, the
// behaviour fingerprint, and the check that refuses data measured under other
// rules.
import { cappedGap, DEFAULT_KNOBS } from '../src/difficulty.js';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, searchCandidate } from '../src/generation.js';
import { hash } from '../src/random.js';

/**
 * Version of the calibration data file (scripts/calibrate-difficulty.mjs --data). 2:
 * every solved search keeps the human-like bot's runs (`human`), searched
 * with the per-floor search and ATTEMPTS candidates. Files without it, or made
 * under other rules, another bot or another candidate count, are refused.
 */
export const DATA_VERSION = 2;

/**
 * The (date, tier)s whose plain-layout first candidate fingerprints the
 * behaviour behind a data file: a knight, a bishop and a pawn day under
 * Gentle and Tough monsters, each with a king-floor recruit.
 */
export const FINGERPRINT_DAYS = Object.freeze([['2031-03-03', 'gentle'], ['2031-03-07', 'tough'], ['2031-03-10', 'tough']]);

/**
 * A hash of what the search and the human-like bot do on FINGERPRINT_DAYS
 * (status, transitions, route and every bot run), through searchCandidate,
 * so with the bot's default recruit policy, whatever src/human-bot.js makes
 * it. A change to the rules, monsters, search or bot that changes any of
 * them, the recruit policy par plays with included, changes the
 * fingerprint, with or without a version bump. About half a second.
 */
export function behaviourFingerprint() {
  const seen = FINGERPRINT_DAYS.map(([date, tier]) => {
    const found = searchCandidate(candidateFor(getRawDaily(date), tier, DEFAULT_KNOBS, 0));
    return [found.status, found.explored, found.actions ?? null, found.human?.results.map((runs) => runs.map((run) => [run.won, run.moves, run.livesLost])) ?? null];
  });
  return hash(JSON.stringify(seen)).toString(16).padStart(8, '0');
}

/** The header fields a data file must carry for these rules (dataProblem checks them). */
export const dataStamp = ({ rules, bot, attempts, fingerprint }) => ({ dataVersion: DATA_VERSION, rulesVersion: rules, humanBotVersion: bot, attempts, behaviour: fingerprint });

/**
 * Why a data file (its parsed JSON) can't be reused under these rules, or
 * null when it can. `expected` is dataStamp()'s input.
 */
export function dataProblem(file, expected) {
  const stamp = dataStamp(expected);
  if (file?.dataVersion !== DATA_VERSION) return 'it was measured before the tiers used the capped human gap (no human-like bot runs)';
  for (const [key, value] of Object.entries(stamp)) {
    if (file[key] === value) continue;
    if (key === 'behaviour') return `the rules, search or human-like bot (its recruit policy included) play differently now (behaviour ${file[key]}, now ${value})`;
    return `it was measured with ${key} ${file[key]}, not ${value}`;
  }
  return null;
}

/** A search's bot runs, compact for the data file: per floor, each run's moves when it won, else null. */
export function compactRuns(human) {
  return human ? human.results.map((runs) => runs.map((run) => (run.won ? run.moves : null))) : null;
}

/** The capped human gap of a stored search: its compactRuns() and its route's moves per floor. Null without both. */
export function storedGap(entry) {
  if (!Array.isArray(entry?.human) || !Array.isArray(entry.metrics?.floorMoves)) return null;
  const results = entry.human.map((runs) => runs.map((moves) => ({ won: moves !== null, moves: moves ?? 0 })));
  return cappedGap({ results, certified: entry.metrics.floorMoves });
}
