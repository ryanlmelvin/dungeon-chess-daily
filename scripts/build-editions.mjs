// SPDX-License-Identifier: GPL-3.0-only
// Build-time composition: compose every edition from launch through two years
// past today (UTC) with src/composer.js and ship each day's rooms and planted
// lines (src/editions.js), so opening a day only decodes and replays them.
// Dates past the range borrow a stored day (src/generation.js borrowedDaily).
// The run is incremental: entries that still prove are kept, and only missing
// or stale dates are composed, so every build (npm run build) rolls the
// window forward cheaply. After a change to the rules or the composer, --full
// composes every date again.
//   node scripts/build-editions.mjs [--end YYYY-MM-DD] [--jobs N] [--full]
//   node scripts/build-editions.mjs --verify   replay every stored edition
//   node scripts/build-editions.mjs --audit    compose every stored date again and compare
import { writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FIRST_EDITION_DATE, getRawDaily } from '../src/edition.js';
import { composedDaily, proveComposed } from '../src/generation.js';
import { composeDay } from '../src/composer.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';
import { encodeRooms, decodeRooms } from '../src/room-code.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; };
const jobs = (count) => Math.max(1, Math.min(count, Number(arg('jobs', Math.max(1, availableParallelism() - 1)))));

// A date's composed edition as stored: its rooms and its planted lines.
function composeDate(date) {
  const began = performance.now();
  const { daily, floors } = composeDay(date);
  return {
    date, rooms: encodeRooms(daily.composed), route: encodeRoute(daily.generation.certificate.actions),
    lines: floors.map((floor) => floor.line.length), motifs: floors.map((floor) => floor.motif), ms: Math.round(performance.now() - began),
  };
}

// Why a stored entry can't be shipped as it is, or null: it must decode, and its lines must prove
// the day with every position along them a valid save.
function staleReason(date, entry) {
  if (!entry) return 'missing';
  if (typeof entry.rooms !== 'string' || typeof entry.route !== 'string') return 'malformed entry';
  try {
    const daily = composedDaily(getRawDaily(date), decodeRooms(entry.rooms), decodeRoute(entry.route));
    const proof = proveComposed(daily, daily.generation.certificate.actions, { saves: true });
    return proof.valid ? null : proof.reason;
  } catch (error) { return error.message; }
}
// Where a stored entry differs from what the composer composes now, or null.
function auditDate(date, entry) {
  const reason = staleReason(date, entry);
  if (reason) return reason;
  const now = composeDate(date);
  return now.rooms === entry.rooms && now.route === entry.route ? null : 'the composer now composes another day';
}
const datesBetween = (start, end) => {
  const dates = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
};

// Run `work` over `dates` in worker threads, one message back per date.
function inWorkers(work, dates, onResult) {
  const count = jobs(dates.length);
  return Promise.all(Array.from({ length: count }, (_, job) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { work, dates: dates.filter((_, index) => index % count === job) } });
    worker.on('message', onResult);
    worker.on('error', reject);
    worker.on('exit', (code) => (code ? reject(new Error(`Worker exited with ${code}`)) : resolve()));
  })));
}

async function check(work, label) {
  const { EDITIONS, EDITIONS_RANGE } = await import('../src/editions.js');
  if (!EDITIONS_RANGE) throw new Error('src/editions.js is empty. Run node scripts/build-editions.mjs.');
  const dates = datesBetween(EDITIONS_RANGE.start, EDITIONS_RANGE.end);
  const problems = [];
  await inWorkers(work, dates, ({ date, reason }) => { if (reason) problems.push(`${date}: ${reason}`); });
  if (problems.length) throw new Error(`${problems.sort()[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}. Run node scripts/build-editions.mjs${work === 'audit' ? ' --full' : ''}.`);
  console.log(`${label} ${dates.length} stored editions (${EDITIONS_RANGE.start} to ${EDITIONS_RANGE.end}).`);
}

if (!isMainThread) {
  const { EDITIONS } = await import('../src/editions.js');
  for (const date of workerData.dates) {
    if (workerData.work === 'compose') parentPort.postMessage(composeDate(date));
    else if (workerData.work === 'audit') parentPort.postMessage({ date, reason: auditDate(date, EDITIONS[date]) });
    else parentPort.postMessage({ date, reason: staleReason(date, EDITIONS[date]) });
  }
} else if (process.argv.includes('--verify')) {
  await check('verify', 'Replayed');
} else if (process.argv.includes('--audit')) {
  await check('audit', 'Composed again, and matched,');
} else {
  const today = new Date().toISOString().slice(0, 10);
  const start = FIRST_EDITION_DATE, end = arg('end', new Date(Date.parse(today) + 730 * DAY).toISOString().slice(0, 10));
  const dates = datesBetween(start, end);
  const { EDITIONS: existing } = process.argv.includes('--full') ? { EDITIONS: {} } : await import('../src/editions.js');
  const results = new Map();
  for (const date of dates) if (!staleReason(date, existing[date])) results.set(date, { date, ...existing[date], kept: true });
  const todo = dates.filter((date) => !results.has(date));
  console.log(`Keeping ${results.size} stored editions; composing ${todo.length} (${start} to ${end}).`);
  const began = performance.now();
  if (todo.length) await inWorkers('compose', todo, (entry) => {
    results.set(entry.date, entry);
    if (results.size % 50 === 0) console.log(`Composed ${results.size}/${dates.length} editions (${Math.round((performance.now() - began) / 1000)} s).`);
  });
  const rows = dates.map((date) => results.get(date));
  const table = Object.fromEntries(rows.map(({ date, rooms, route }) => [date, { rooms, route }]));
  const source = '// SPDX-License-Identifier: GPL-3.0-only\n'
    + '// Generated by scripts/build-editions.mjs; verify with --verify after changing the rules or the composer.\n'
    + '// Each edition\'s composed rooms (src/room-code.js) and its planted lines as one route (src/route-code.js):\n'
    + '// the day\'s certificate for the engine and the Dungeon Bot\'s run, never a player-facing hint.\n'
    + '// Par is each floor\'s line plus one (src/par.js).\n'
    + `export const EDITIONS_RANGE = ${JSON.stringify({ start, end })};\n`
    + `export const EDITIONS = ${JSON.stringify(table)};\n`;
  await writeFile(new URL('../src/editions.js', import.meta.url), source);
  const fresh = rows.filter((row) => !row.kept);
  if (!fresh.length) { console.log(`Wrote ${rows.length} editions; none needed composing.`); process.exit(0); }
  const sorted = (values) => [...values].sort((a, b) => a - b);
  const pct = (values, p) => values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))];
  const ms = sorted(fresh.map((row) => row.ms));
  const lines = fresh.flatMap((row) => row.lines);
  const motifs = {};
  for (const motif of fresh.flatMap((row) => row.motifs)) motifs[motif] = (motifs[motif] ?? 0) + 1;
  console.log(`Wrote ${rows.length} editions (${fresh.length} newly composed in ${Math.round((performance.now() - began) / 1000)} s: lines of 3 / 4 moves ${lines.filter((n) => n === 3).length} / ${lines.filter((n) => n === 4).length}${lines.some((n) => n < 3 || n > 4) ? `, others ${lines.filter((n) => n < 3 || n > 4).length}` : ''}; motifs ${Object.entries(motifs).sort().map(([motif, n]) => `${motif} ${n}`).join(', ')}; compose time median ${pct(ms, 0.5)} ms, p90 ${pct(ms, 0.9)} ms, max ${pct(ms, 1)} ms).`);
}
