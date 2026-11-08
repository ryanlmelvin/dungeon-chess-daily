// SPDX-License-Identifier: GPL-3.0-only
// Helpers for scripts/calibrate-difficulty.mjs. For the data file: the
// human-like bot's runs kept per search and the capped human gap they give,
// the behaviour fingerprint, and the check that refuses data measured under
// other rules. For --fast: a least-squares surrogate of the gap on the knobs,
// monotone-dominance pruning, and a paired test for sequential stopping. None
// of the --fast helpers touches generation or the fit: they only decide which
// settings get full-budget searches.
import { cappedGap, DEFAULT_KNOBS } from '../src/difficulty.js';
import { getRawDaily } from '../src/edition.js';
import { candidateFor, searchCandidate } from '../src/generation.js';
import { hash } from '../src/random.js';

/**
 * Version of the calibration data files (--data, the --fast shortlist). 2:
 * every solved search keeps the human-like bot's runs (`human`), searched
 * with the per-floor search and four candidates. Files without it, or made
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

/** Knobs that make a layout harder (difficulty mostly rises with each). */
export const MONOTONE_KNOBS = ['obstacleBase', 'decoys', 'guards', 'screens'];

/** Feature vector: intercept, knobs, and pairwise products of the knobs. */
export function features(setting) {
  const base = [setting.obstacleBase, setting.decoys, setting.scatter ?? 0, setting.guards, setting.screens ?? 0];
  const out = [1, ...base];
  for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) out.push(base[i] * base[j]);
  return out;
}

/**
 * Ridge least squares of `y` on features(setting). Returns { predict, residualSd }.
 * The small ridge keeps constant columns (a pawn's scatter, an absent screens
 * knob) from making the system singular.
 */
export function fitSurrogate(points, ridge = 1e-3) {
  const X = points.map((point) => features(point.setting));
  const p = X[0]?.length ?? features({ obstacleBase: 0, decoys: 0, guards: 0 }).length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j && i > 0 ? ridge * Math.max(1, points.length) : 0)));
  const b = Array(p).fill(0);
  X.forEach((row, n) => {
    for (let i = 0; i < p; i++) { b[i] += row[i] * points[n].y; for (let j = 0; j < p; j++) A[i][j] += row[i] * row[j]; }
  });
  const w = solve(A, b);
  const predict = (setting) => features(setting).reduce((sum, value, i) => sum + value * w[i], 0);
  const residuals = points.map((point) => point.y - predict(point.setting));
  const dof = Math.max(1, points.length - p);
  const residualSd = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / dof);
  return { predict, residualSd, weights: w };
}

function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) { M[c][c] = 1e-12; }
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** a ≥ b on every monotone knob, with the same scatter (scatter is not monotone). */
export function dominates(a, b) {
  return (a.scatter ?? 0) === (b.scatter ?? 0) && MONOTONE_KNOBS.every((knob) => (a[knob] ?? 0) >= (b[knob] ?? 0));
}

/**
 * Settings that cannot win any tier under approximate monotonicity: s is at
 * least as hard as some t whose mean already sits over `ceiling`, or at most as
 * hard as some t whose mean sits under `floor`. Callers pass bounds a margin
 * beyond the hardest and easiest bands, because monotonicity is only rough.
 * entries: [{ id, setting, mean|null }]. Returns a Set of pruned ids.
 */
export function dominatedOut(entries, floor, ceiling) {
  const pruned = new Set();
  const measured = entries.filter((entry) => entry.mean !== null);
  for (const s of entries) {
    for (const t of measured) {
      if (t.id === s.id) continue;
      if ((t.mean > ceiling && dominates(s.setting, t.setting)) || (t.mean < floor && dominates(t.setting, s.setting))) { pruned.add(s.id); break; }
    }
  }
  return pruned;
}

/**
 * Paired comparison on common dates: is `costs` clearly worse than `best`?
 * Both are arrays over the same dates. True when the mean difference exceeds
 * z standard errors (and minDates have been seen).
 */
export function clearlyWorse(costs, best, { z = 2.5, minDates = 4 } = {}) {
  const n = Math.min(costs.length, best.length);
  if (n < minDates) return false;
  const d = Array.from({ length: n }, (_, i) => costs[i] - best[i]);
  const mean = d.reduce((sum, x) => sum + x, 0) / n;
  const sd = Math.sqrt(d.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  // A floor on the error keeps identical columns from looking infinitely sure.
  return mean - z * Math.max(sd / Math.sqrt(n), 0.05) > 0;
}
