// SPDX-License-Identifier: GPL-3.0-only
// Offline measurement: what the tiered monster smarts (src/monster-ai.js) and
// the no-freebie-floor rule (DIFFICULTY_TIERS minFloorMoves) cost generation.
//
// For a sample of real dates per (tier, piece), its modifiers represented
// (half plain, a quarter each ice and collapse), it searches both candidate
// layouts under the current calibrated knobs twice:
// - old: classic monsters (`classicMonsters`: Gentle habits on every tier,
//   tie-breaks hashed on the whole run's moves) and no minimum floor moves,
//   which is how editions were certified before tiered smarts;
// - new: the tier's monsters and the tier's minimum floor moves.
// It replays generateDaily's choice (chooseCandidate) and reports, per tier
// and piece: how often each candidate certifies, how often the day falls back
// to the bank, par per floor (moves the certified route took until each
// floor's challenge was complete) and the difficulty score. Fallback days have
// no par here: the bank holds one fixed template per tier, piece and modifier.
// The knobs were calibrated for the old monsters; recalibrating eases the
// layouts until scores land in the bands again, which moves these numbers.
//
// --attempts N (more than generation's two) also searches the new monsters'
// third and later candidates and adds the fallback share with N candidates,
// to price that alternative. The table's other columns stay at two.
//
//   node scripts/measure-monsters.mjs [--samples 16] [--start 2026-11-05]
//     [--jobs N] [--tiers gentle,fair] [--pieces rook,queen] [--attempts 2] [--json file]
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getRawDaily } from '../src/edition.js';
import { ATTEMPTS, candidateFor, chooseCandidate, searchCandidate } from '../src/generation.js';
import { TIER_IDS, knobsFor, tierForDate, bandDistance, freebieFloor } from '../src/difficulty.js';
import { PLAYABLE_PIECES } from '../src/pieces.js';

const KEPT_METRICS = ['turns', 'threatenedDecisions', 'narrowEscapes', 'livesLost', 'unsafeAlternatives', 'legalAlternatives', 'floorMoves'];
const AIS = ['old', 'new'];

if (!isMainThread) {
  parentPort.on('message', ({ id, date, tier, attempt, ai }) => {
    const base = getRawDaily(date);
    const candidate = { ...candidateFor(base, tier, knobsFor(tier, base.playerPiece), attempt), ...(ai === 'old' && { classicMonsters: true }) };
    const began = performance.now();
    const result = searchCandidate(candidate);
    const metrics = result.metrics ? Object.fromEntries(KEPT_METRICS.map((name) => [name, result.metrics[name]])) : null;
    parentPort.postMessage({ id, status: result.status, explored: result.explored, ms: Math.round(performance.now() - began), metrics, score: result.score ?? null });
  });
} else {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
  const samples = Number(option('samples', '16'));
  const start = option('start', '2026-11-05');
  const jobs = Number(option('jobs', String(Math.max(1, availableParallelism() - 1))));
  const tiers = option('tiers', TIER_IDS.join(',')).split(',');
  const pieces = option('pieces', PLAYABLE_PIECES.join(',')).split(',');
  const attempts = Number(option('attempts', String(ATTEMPTS)));
  if (!Number.isInteger(samples) || samples < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(jobs) || jobs < 1
    || tiers.some((tier) => !TIER_IDS.includes(tier)) || pieces.some((piece) => !PLAYABLE_PIECES.includes(piece))
    || !Number.isInteger(attempts) || attempts < ATTEMPTS || attempts > 8) {
    throw new Error('Usage: node scripts/measure-monsters.mjs [--samples N] [--start YYYY-MM-DD] [--jobs N] [--tiers a,b] [--pieces a,b] [--attempts 2..8] [--json file]');
  }

  // Dates per (tier, piece): the weekday sets the tier, so walk forward from
  // --start and fill a quota per modifier, then top up with whatever comes.
  const quota = { none: Math.ceil(samples / 2), ice: Math.floor(samples / 4) };
  quota.collapse = samples - quota.none - quota.ice;
  const cells = new Map(tiers.flatMap((tier) => pieces.map((piece) => [`${tier}:${piece}`, { tier, piece, dates: [], spare: [] }])));
  for (let time = Date.parse(start), scanned = 0; scanned < 3660 && [...cells.values()].some((cell) => cell.dates.length < samples); time += 86_400_000, scanned++) {
    const raw = getRawDaily(new Date(time));
    const cell = cells.get(`${tierForDate(raw.date)}:${raw.playerPiece}`);
    if (!cell || cell.dates.length >= samples) continue;
    const modifier = raw.modifier ?? 'none';
    if (cell.dates.filter((entry) => entry.modifier === modifier).length < (quota[modifier] ?? 0)) cell.dates.push({ date: raw.date, modifier });
    else cell.spare.push({ date: raw.date, modifier });
  }
  for (const cell of cells.values()) while (cell.dates.length < samples && cell.spare.length) cell.dates.push(cell.spare.shift());

  const tasks = [];
  for (const cell of cells.values()) for (const { date } of cell.dates) for (const ai of AIS) for (let attempt = 0; attempt < (ai === 'new' ? attempts : ATTEMPTS); attempt++) {
    tasks.push({ id: tasks.length, date, tier: cell.tier, attempt, ai });
  }
  console.log(`Searching ${tasks.length} candidate layouts (${cells.size} tier/piece cells × ${samples} dates, ${ATTEMPTS} candidates each for old monsters and ${attempts} for new) on ${jobs} workers…`);
  const results = new Array(tasks.length);
  const began = Date.now();
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url));
    const feed = () => {
      if (next >= tasks.length) { worker.terminate(); resolve(); return; }
      worker.postMessage(tasks[next++]);
    };
    worker.on('message', (result) => {
      results[result.id] = result;
      if (++done % 200 === 0 || done === tasks.length) console.log(`  ${done}/${tasks.length} (${Math.round((Date.now() - began) / 1000)} s)`);
      feed();
    });
    worker.on('error', reject);
    feed();
  })));

  // generateDaily's choice for one date under one AI: the first candidate in
  // the band, else the closest acceptable one, else the fallback bank (-1).
  // Old monsters also mean the old rules: no minimum floor moves.
  const found = {};
  for (const task of tasks) ((found[`${task.date}:${task.ai}`] ??= [])[task.attempt] = results[task.id]);
  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const summarize = (entries) => {
    // entries: [{ tier, piece, date }]
    const out = {};
    for (const ai of AIS) {
      const row = { days: 0, certified: [0, 0], solved: [0, 0], freebies: [0, 0], fallbacks: 0, fallbacksNoRule: 0, fallbacksMore: 0, inBand: 0, floors: [[], [], []], totals: [], scores: [], shortFloors: 0, ms: 0 };
      for (const { tier, piece, date } of entries) {
        const knobs = knobsFor(tier, piece);
        const minFloorMoves = ai === 'old' ? 0 : undefined;
        const searched = found[`${date}:${ai}`], pair = searched.slice(0, ATTEMPTS);
        row.days++;
        row.ms += searched.reduce((sum, entry) => sum + entry.ms, 0);
        for (const [attempt, entry] of pair.entries()) {
          if (entry.status === 'solved') row.solved[attempt]++;
          if (chooseCandidate([entry], tier, knobs.minThreatenedDecisions, minFloorMoves) === 0) row.certified[attempt]++;
          else if (entry.metrics && ai === 'new' && freebieFloor(entry.metrics, tier)) row.freebies[attempt]++;
        }
        // What-ifs for the new monsters: without the freebie rule, and with more candidates.
        if (chooseCandidate(pair, tier, knobs.minThreatenedDecisions, 0) < 0) row.fallbacksNoRule++;
        if (chooseCandidate(searched, tier, knobs.minThreatenedDecisions, minFloorMoves) < 0) row.fallbacksMore++;
        const chosen = chooseCandidate(pair, tier, knobs.minThreatenedDecisions, minFloorMoves);
        if (chosen < 0) { row.fallbacks++; continue; }
        const { metrics, score } = pair[chosen];
        if (bandDistance(score, tier) === 0) row.inBand++;
        metrics.floorMoves.forEach((moves, floor) => row.floors[floor].push(moves));
        row.totals.push(metrics.floorMoves.reduce((sum, moves) => sum + moves, 0));
        row.shortFloors += metrics.floorMoves.filter((moves) => moves < 4).length;
        row.scores.push(score);
      }
      out[ai] = row;
    }
    return out;
  };

  const pct = (count, total) => (total ? `${Math.round((100 * count) / total)}%` : '–');
  const num = (value, digits = 1) => (value === null ? '–' : `${Math.round(value * 10 ** digits) / 10 ** digits}`);
  const pars = (row) => row.floors.map((values) => num(median(values), 1)).join('/');
  const columns = (summary) => {
    const { old, new: fresh } = summary;
    const generated = (row) => row.days - row.fallbacks;
    return [
      `${old.days}`,
      `${pct(old.certified[0], old.days)} → ${pct(fresh.certified[0], fresh.days)}`,
      `${pct(old.certified[1], old.days)} → ${pct(fresh.certified[1], fresh.days)}`,
      `${pct(old.fallbacks, old.days)} → ${pct(fresh.fallbacks, fresh.days)}`,
      pct(fresh.fallbacksNoRule, fresh.days),
      ...(attempts > ATTEMPTS ? [pct(fresh.fallbacksMore, fresh.days)] : []),
      `${pars(old)} → ${pars(fresh)}`,
      `${num(median(old.totals), 1)} → ${num(median(fresh.totals), 1)}`,
      `${pct(old.shortFloors, 3 * generated(old))} → ${pct(fresh.shortFloors, 3 * generated(fresh))}`,
      `${num(mean(old.scores))} → ${num(mean(fresh.scores))}`,
      `${pct(old.inBand, old.days)} → ${pct(fresh.inBand, fresh.days)}`,
      `${fresh.freebies[0] + fresh.freebies[1]}`,
    ];
  };
  const header = ['n', 'cand. 1 certifies', 'cand. 2 certifies', 'fallback', 'new fallback, no freebie rule',
    ...(attempts > ATTEMPTS ? [`new fallback, ${attempts} candidates`] : []),
    'median par F1/F2/F3', 'median total par', 'floors under 4 moves', 'mean score', 'in band', 'freebie rejects'];
  const table = (label, rows) => {
    const lines = [`| ${label} | ${header.join(' | ')} |`, `|${' --- |'.repeat(header.length + 1)}`];
    for (const [name, summary] of rows) lines.push(`| ${name} | ${columns(summary).join(' | ')} |`);
    return lines.join('\n');
  };

  const entriesOf = (filter) => [...cells.values()].filter(filter).flatMap((cell) => cell.dates.map(({ date }) => ({ tier: cell.tier, piece: cell.piece, date })));
  const byTier = tiers.map((tier) => [tier, summarize(entriesOf((cell) => cell.tier === tier))]);
  const all = summarize(entriesOf(() => true));
  console.log(`\nOld → new monsters, ${samples} dates per tier and piece from ${start} (each cell: ${quota.none} plain, ${quota.ice} ice, ${quota.collapse} collapse where available).`);
  console.log('Certifies: the candidate\'s route was found within the budget and passes the tier\'s rules (threatened decisions; new: no floor under its minimum moves).');
  console.log('Par and score cover generated days only; fallback days replay a bank template.');
  console.log(`What-ifs (new monsters only): the fallback share without the freebie-floor rule${attempts > ATTEMPTS ? `, and with ${attempts} candidates per date instead of ${ATTEMPTS}` : ''}.\n`);
  console.log(table('Tier', [...byTier, ['all', all]]));
  console.log('');
  console.log(table('Tier · piece', [...cells.values()].map((cell) => [`${cell.tier} · ${cell.piece}`, summarize(entriesOf((other) => other === cell))])));
  const perSearch = (ai) => Math.round(all[ai].ms / tasks.filter((task) => task.ai === ai).length);
  console.log(`\nMean search time: old monsters ${perSearch('old')} ms, new ${perSearch('new')} ms; wall ${Math.round((Date.now() - began) / 1000)} s.`);

  const jsonPath = option('json');
  if (jsonPath) {
    const rows = tasks.map((task) => ({ ...task, ...results[task.id], id: undefined }));
    await writeFile(jsonPath, JSON.stringify({ generated: new Date().toISOString(), start, samples, cells: [...cells.values()].map(({ tier, piece, dates }) => ({ tier, piece, dates })), rows }, null, 1));
    console.log(`Wrote ${rows.length} searches to ${jsonPath}.`);
  }
}
