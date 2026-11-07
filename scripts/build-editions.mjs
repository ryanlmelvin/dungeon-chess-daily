// SPDX-License-Identifier: GPL-3.0-only
// Build-time certification: certify every edition from launch through two
// years past today (UTC) and ship the results (src/editions.js), so opening a
// day replays a stored route instead of searching. Dates past the range still
// search at runtime. The run is incremental: entries that still replay are
// kept and only missing or stale dates are searched, so every build (npm run
// build) rolls the window forward cheaply. After a rules or calibration change
// every entry goes stale and the whole range is recertified.
//   node scripts/build-editions.mjs [--end YYYY-MM-DD] [--jobs N] [--full] [--verify]
import { writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FIRST_EDITION_DATE, getRawDaily } from '../src/edition.js';
import { generateDaily, candidateFor } from '../src/generation.js';
import { createGame } from '../src/rules.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { knobsFor, tierForDate } from '../src/difficulty.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; };

function certifyDate(date) {
  const began = performance.now();
  const daily = generateDaily(date, { precomputed: false });
  const { source, attempt, certificate } = daily.generation;
  return {
    date, tier: daily.difficulty, attempt: source === 'fallback' ? 'fallback' : attempt,
    route: source === 'fallback' ? '' : encodeRoute(certificate.actions),
    moves: certificate.metrics.turns, score: certificate.score, ms: Math.round(performance.now() - began),
  };
}

// Why a stored entry no longer matches what generation would certify, or null.
function staleReason(date, entry) {
  if (!entry) return 'missing';
  const base = getRawDaily(date);
  if (entry.tier !== tierForDate(date)) return 'stale tier';
  if (entry.attempt === 'fallback') return null;
  const knobs = knobsFor(entry.tier, base.playerPiece);
  const proof = verifyWinningRoute(createGame(candidateFor(base, entry.tier, knobs, entry.attempt)), decodeRoute(entry.route));
  if (!proof.valid) return proof.reason;
  return proof.metrics.threatenedDecisions < knobs.minThreatenedDecisions ? 'too few threatened decisions' : null;
}
const datesBetween = (start, end) => {
  const dates = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
};

if (!isMainThread) {
  for (const date of workerData.dates) parentPort.postMessage(certifyDate(date));
} else if (process.argv.includes('--verify')) {
  const { EDITIONS, EDITIONS_RANGE } = await import('../src/editions.js');
  if (!EDITIONS_RANGE) throw new Error('src/editions.js is empty. Run node scripts/build-editions.mjs.');
  const dates = datesBetween(EDITIONS_RANGE.start, EDITIONS_RANGE.end);
  for (const date of dates) {
    const reason = staleReason(date, EDITIONS[date]);
    if (reason) throw new Error(`${date}: ${reason}. Run node scripts/build-editions.mjs.`);
  }
  console.log(`Replayed ${dates.length} precomputed editions (${EDITIONS_RANGE.start} to ${EDITIONS_RANGE.end}).`);
} else {
  const today = new Date().toISOString().slice(0, 10);
  const start = FIRST_EDITION_DATE, end = arg('end', new Date(Date.parse(today) + 730 * DAY).toISOString().slice(0, 10));
  const dates = datesBetween(start, end);
  const { EDITIONS: existing } = process.argv.includes('--full') ? { EDITIONS: {} } : await import('../src/editions.js');
  const results = new Map();
  for (const date of dates) if (!staleReason(date, existing[date])) results.set(date, { date, ...existing[date], kept: true });
  const todo = dates.filter((date) => !results.has(date));
  console.log(`Keeping ${results.size} certified editions; certifying ${todo.length} (${start} to ${end}).`);
  const jobs = Math.max(1, Math.min(todo.length, Number(arg('jobs', Math.max(1, availableParallelism() - 1)))));
  const began = performance.now();
  if (todo.length) await Promise.all(Array.from({ length: jobs }, (_, job) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { dates: todo.filter((_, index) => index % jobs === job) } });
    worker.on('message', (entry) => {
      results.set(entry.date, entry);
      if (results.size % 50 === 0) console.log(`Certified ${results.size}/${dates.length} editions (${Math.round((performance.now() - began) / 1000)} s).`);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => (code ? reject(new Error(`Worker exited with ${code}`)) : resolve()));
  })));
  const rows = dates.map((date) => results.get(date));
  const table = Object.fromEntries(rows.map(({ date, tier, attempt, route }) => [date, { tier, attempt, route }]));
  const source = '// SPDX-License-Identifier: GPL-3.0-only\n'
    + '// Generated by scripts/build-editions.mjs; verify with --verify after changing rules or calibration.\n'
    + '// Routes are certificates for the engine, never player-facing hints.\n'
    + `export const EDITIONS_RANGE = ${JSON.stringify({ start, end })};\n`
    + `export const EDITIONS = ${JSON.stringify(table)};\n`;
  await writeFile(new URL('../src/editions.js', import.meta.url), source);
  const fresh = rows.filter((row) => !row.kept);
  const sorted = (key) => fresh.map((row) => row[key]).sort((a, b) => a - b);
  const pct = (values, p) => values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))];
  const moves = sorted('moves'), ms = sorted('ms');
  if (!fresh.length) { console.log(`Wrote ${rows.length} editions; none needed certifying.`); process.exit(0); }
  console.log(`Wrote ${rows.length} editions (${fresh.length} newly certified: ${fresh.filter((row) => row.attempt === 'fallback').length} fallbacks; moves median ${pct(moves, 0.5)}, p90 ${pct(moves, 0.9)}, max ${pct(moves, 1)}; search time median ${pct(ms, 0.5)} ms, p90 ${pct(ms, 0.9)} ms, max ${pct(ms, 1)} ms).`);
}
