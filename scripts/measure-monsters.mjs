// SPDX-License-Identifier: GPL-3.0-only
// Offline measurement: what the no-freebie-floor rule (DIFFICULTY_TIERS
// minFloorMoves) costs generation, rule by rule, and with --classic what the
// tiered monster smarts (src/monster-ai.js) cost.
//
// For a sample of real dates per (tier, piece), its modifiers represented
// (half plain, a quarter each ice and collapse), it searches every candidate
// layout generation may try (ATTEMPTS, or --attempts N) under the current
// calibrated knobs, with the tier's monsters and the production search
// (src/fairness.js). It then replays generateDaily's choice (chooseCandidate)
// under each freebie rule below and reports, per rule, the share of days that
// fall back to the bank, by tier and by tier and piece; the adopted rule is
// the headline. Tricky and up take the rule; Gentle and Fair have none under
// every rule. It also reports how often each candidate certifies, par per
// floor (the certified route's moves until each floor's challenge was
// complete), the capped human gap and the difficulty score under the adopted
// rule, the fallback share with only the first two candidates, and search
// time (with the human-like bot's runs). Fallback days
// have no par here: the bank holds one fixed template per tier, piece and
// modifier. The knobs are calibrated for an earlier search and rules;
// recalibrating eases or tightens the layouts, which moves these numbers.
//
// --classic also searches the classic monsters (`classicMonsters`: Gentle
// habits on every tier, tie-breaks hashed on the whole run's moves) and adds
// their fallback share with no freebie rule, to price the smarts themselves.
//
//   node scripts/measure-monsters.mjs [--samples 16] [--start 2026-11-05]
//     [--jobs N] [--tiers gentle,fair] [--pieces rook,queen] [--attempts 4] [--classic] [--json file]
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getRawDaily } from '../src/edition.js';
import { ATTEMPTS, candidateFor, chooseCandidate, searchCandidate } from '../src/generation.js';
import { DIFFICULTY_TIERS, TIER_IDS, knobsFor, tierForDate, bandDistance, floorMinimums } from '../src/difficulty.js';
import { PLAYABLE_PIECES } from '../src/pieces.js';

const KEPT_METRICS = ['turns', 'threatenedDecisions', 'narrowEscapes', 'livesLost', 'unsafeAlternatives', 'legalAlternatives', 'floorMoves'];
// Freebie rules to compare (src/difficulty.js floorMinimums): every floor, or floors 1 to 3 each.
const ADOPTED = DIFFICULTY_TIERS.tricky.minFloorMoves;
const describe = (rule) => {
  const minimums = floorMinimums(rule);
  if (minimums.every((moves) => !moves)) return 'off';
  if (minimums.every((moves) => moves === minimums[0])) return `every floor ≥${minimums[0]}`;
  return minimums.map((moves, floor) => (moves ? `floor ${floor + 1} ≥${moves}` : null)).filter(Boolean).join(', ');
};
const RULES = [ADOPTED, 4, 3, [4, 0, 0], 0]
  .filter((rule, index, all) => all.findIndex((other) => describe(other) === describe(rule)) === index)
  .map((rule, index) => ({ rule, name: `${describe(rule)}${index === 0 ? ' (adopted)' : ''}` }));
// A rule applies to the tiers that have one today (Tricky and up).
const ruleFor = (tier, rule) => (floorMinimums(DIFFICULTY_TIERS[tier].minFloorMoves).some(Boolean) ? rule : 0);

if (!isMainThread) {
  parentPort.on('message', ({ id, date, tier, attempt, ai }) => {
    const base = getRawDaily(date);
    const candidate = { ...candidateFor(base, tier, knobsFor(tier, base.playerPiece), attempt), ...(ai === 'classic' && { classicMonsters: true }) };
    const began = performance.now();
    const result = searchCandidate(candidate);
    const metrics = result.metrics ? Object.fromEntries(KEPT_METRICS.map((name) => [name, result.metrics[name]])) : null;
    // chooseCandidate picks by the capped human gap (searchCandidate runs the bot).
    parentPort.postMessage({ id, status: result.status, explored: result.explored, ms: Math.round(performance.now() - began), metrics, score: result.score ?? null, gap: result.gap ?? null });
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
  const classic = args.includes('--classic');
  if (!Number.isInteger(samples) || samples < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(jobs) || jobs < 1
    || tiers.some((tier) => !TIER_IDS.includes(tier)) || pieces.some((piece) => !PLAYABLE_PIECES.includes(piece))
    || !Number.isInteger(attempts) || attempts < 1 || attempts > 8) {
    throw new Error('Usage: node scripts/measure-monsters.mjs [--samples N] [--start YYYY-MM-DD] [--jobs N] [--tiers a,b] [--pieces a,b] [--attempts 1..8] [--classic] [--json file]');
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

  const ais = classic ? ['tier', 'classic'] : ['tier'];
  const tasks = [];
  for (const cell of cells.values()) for (const { date } of cell.dates) for (const ai of ais) for (let attempt = 0; attempt < attempts; attempt++) {
    tasks.push({ id: tasks.length, date, tier: cell.tier, attempt, ai });
  }
  console.log(`Searching ${tasks.length} candidate layouts (${cells.size} tier/piece cells × ${samples} dates × ${attempts} candidates${classic ? ', tier and classic monsters' : ''}) on ${jobs} workers…`);
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

  // generateDaily's choice for one date under a rule: the first candidate in
  // the band, else the closest acceptable one, else the fallback bank (-1).
  // Searching every candidate and choosing among all of them is the same
  // choice generateDaily makes when it stops at the first in-band one.
  const found = {};
  for (const task of tasks) ((found[`${task.date}:${task.ai}`] ??= [])[task.attempt] = results[task.id]);
  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const summarize = (entries) => {
    const row = { days: 0, certified: Array(attempts).fill(0), fallbacks: RULES.map(() => 0), fallbacksTwo: 0, classic: 0, inBand: 0, floors: [[], [], []], totals: [], scores: [], gaps: [], ms: 0, searches: 0 };
    for (const { tier, piece, date } of entries) {
      const knobs = knobsFor(tier, piece);
      const searched = found[`${date}:tier`];
      row.days++;
      row.ms += searched.reduce((sum, entry) => sum + entry.ms, 0); row.searches += searched.length;
      for (const [attempt, entry] of searched.entries()) if (chooseCandidate([entry], tier, knobs.minThreatenedDecisions, ruleFor(tier, RULES[0].rule)) === 0) row.certified[attempt]++;
      RULES.forEach(({ rule }, index) => { if (chooseCandidate(searched, tier, knobs.minThreatenedDecisions, ruleFor(tier, rule)) < 0) row.fallbacks[index]++; });
      if (chooseCandidate(searched.slice(0, 2), tier, knobs.minThreatenedDecisions, ruleFor(tier, RULES[0].rule)) < 0) row.fallbacksTwo++;
      if (classic && chooseCandidate(found[`${date}:classic`], tier, knobs.minThreatenedDecisions, 0) < 0) row.classic++;
      const chosen = chooseCandidate(searched, tier, knobs.minThreatenedDecisions, ruleFor(tier, RULES[0].rule));
      if (chosen < 0) continue;
      const { metrics, score, gap } = searched[chosen];
      if (bandDistance(gap, tier) === 0) row.inBand++;
      metrics.floorMoves.forEach((moves, floor) => row.floors[floor].push(moves));
      row.totals.push(metrics.floorMoves.reduce((sum, moves) => sum + moves, 0));
      row.scores.push(score); row.gaps.push(gap);
    }
    return row;
  };

  const pct = (count, total) => (total ? `${Math.round((100 * count) / total)}%` : '–');
  const num = (value, digits = 1) => (value === null ? '–' : `${Math.round(value * 10 ** digits) / 10 ** digits}`);
  const pars = (row) => row.floors.map((values) => num(median(values), 1)).join('/');
  const ruleColumns = (row) => row.fallbacks.map((count) => pct(count, row.days));
  const table = (label, header, rows) => [`| ${label} | ${header.join(' | ')} |`, `|${' --- |'.repeat(header.length + 1)}`,
    ...rows.map(([name, cells]) => `| ${name} | ${cells.join(' | ')} |`)].join('\n');
  const entriesOf = (filter) => [...cells.values()].filter(filter).flatMap((cell) => cell.dates.map(({ date }) => ({ tier: cell.tier, piece: cell.piece, date })));
  const ruled = tiers.filter((tier) => ruleFor(tier, 1));
  const groups = [...tiers.map((tier) => [DIFFICULTY_TIERS[tier].name, summarize(entriesOf((cell) => cell.tier === tier))]),
    ...(ruled.length > 1 ? [[`${ruled.map((tier) => DIFFICULTY_TIERS[tier].name).join(' + ')}`, summarize(entriesOf((cell) => ruled.includes(cell.tier)))]] : []),
    ['All', summarize(entriesOf(() => true))]];

  console.log(`\nFallback share with ${attempts} candidates, ${samples} dates per tier and piece from ${start} (each cell: ${quota.none} plain, ${quota.ice} ice, ${quota.collapse} collapse where available).`);
  console.log(`Rules apply on ${ruled.map((tier) => DIFFICULTY_TIERS[tier].name).join(', ') || 'no tier'}; Gentle and Fair have none under every rule.\n`);
  // Headline: one row per rule, the adopted one first.
  console.log(table('Rule', groups.map(([name]) => name), RULES.map(({ name }, index) => [name, groups.map(([, row]) => pct(row.fallbacks[index], row.days))])));
  console.log(`| ${RULES[0].name}, first 2 candidates only | ${groups.map(([, row]) => pct(row.fallbacksTwo, row.days)).join(' | ')} |`);
  if (classic) console.log(`| classic monsters, off | ${groups.map(([, row]) => pct(row.classic, row.days)).join(' | ')} |`);
  console.log('');
  const detail = ['n', ...RULES.map(({ name }) => `fallback, ${name}`), ...Array.from({ length: attempts }, (_, attempt) => `cand. ${attempt + 1} certifies`),
    'median par F1/F2/F3', 'median total par', 'mean gap', 'mean score', 'in band', 'ms per search'];
  const detailCells = (row) => [`${row.days}`, ...ruleColumns(row), ...row.certified.map((count) => pct(count, row.days)),
    pars(row), num(median(row.totals), 1), num(mean(row.gaps)), num(mean(row.scores)), pct(row.inBand, row.days), `${Math.round(row.ms / Math.max(1, row.searches))}`];
  console.log(`Par, capped human gap (the band's measure), score and band under ${RULES[0].name}; certifies: alone, under that rule and the threat minimum.\n`);
  console.log(table('Tier', detail, groups.map(([name, row]) => [name, detailCells(row)])));
  console.log('');
  console.log(table('Tier · piece', detail, [...cells.values()].map((cell) => [`${DIFFICULTY_TIERS[cell.tier].name} · ${cell.piece}`, detailCells(summarize(entriesOf((other) => other === cell)))])));
  console.log(`\nWall ${Math.round((Date.now() - began) / 1000)} s on ${jobs} workers.`);

  const jsonPath = option('json');
  if (jsonPath) {
    const rows = tasks.map((task) => ({ ...task, ...results[task.id], id: undefined }));
    await writeFile(jsonPath, JSON.stringify({ generated: new Date().toISOString(), start, samples, attempts, rules: RULES, cells: [...cells.values()].map(({ tier, piece, dates }) => ({ tier, piece, dates })), rows }, null, 1));
    console.log(`Wrote ${rows.length} searches to ${jsonPath}.`);
  }
}
