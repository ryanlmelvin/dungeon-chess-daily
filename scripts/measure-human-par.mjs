// SPDX-License-Identifier: GPL-3.0-only
// Probe the stored editions with the human-like bot (src/human-bot.js): by
// piece and floor, how often its runs clear the floor, how often they miss
// par + 4 (par being the planted line plus one, src/par.js; a failed run
// misses), its median moves against par, and the raw human gap (the bot's
// mean moves over the planted line's; humanGap). The bot steers its recruit
// as a Manual player would; --auto leaves the recruit on Auto. Prints
// Markdown tables. Read-only: it never writes src/editions.js.
//   node scripts/measure-human-par.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--jobs N] [--auto]
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { EDITIONS_RANGE } from '../src/editions.js';
import { getDaily } from '../src/generation.js';
import { humanPar, humanGap, autoRecruit } from '../src/human-bot.js';
import { floorPars } from '../src/par.js';
import { PLAYABLE_PIECES } from '../src/pieces.js';

const DAY = 86_400_000;
const SLACK = 4;
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; };

function measure(date, auto) {
  const began = performance.now();
  const daily = getDaily(date);
  const human = auto ? humanPar(daily, { recruit: autoRecruit }) : humanPar(daily);
  const par = floorPars(daily);
  return {
    date, piece: daily.playerPiece, modifier: daily.modifier ?? 'none', par, botPar: human.par, runs: human.results[0].length,
    won: human.results.map((runs) => runs.filter((run) => run.won).length),
    missed: human.results.map((runs, floor) => runs.filter((run) => !run.won || run.moves > par[floor] + SLACK).length),
    gap: humanGap(human).floors, ms: performance.now() - began,
  };
}

if (!isMainThread) {
  for (const date of workerData.dates) parentPort.postMessage(measure(date, workerData.auto));
} else {
  const start = arg('start', EDITIONS_RANGE.start), end = arg('end', EDITIONS_RANGE.end);
  const dates = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) dates.push(new Date(time).toISOString().slice(0, 10));
  const jobs = Math.max(1, Math.min(dates.length, Number(arg('jobs', Math.max(1, availableParallelism() - 1)))));
  const rows = [];
  const began = performance.now();
  await Promise.all(Array.from({ length: jobs }, (_, job) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { dates: dates.filter((_, index) => index % jobs === job), auto: process.argv.includes('--auto') } });
    worker.on('message', (row) => rows.push(row));
    worker.on('error', reject);
    worker.on('exit', (code) => (code ? reject(new Error(`Worker exited with ${code}`)) : resolve()));
  })));
  const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : '–'; };
  const mean = (values) => (values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '–');
  const percent = (part, whole) => (whole ? `${(100 * part / whole).toFixed(1)}%` : '–');
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const floors = [0, 1, 2];
  const summarize = (group) => [
    group.length,
    floors.map((floor) => percent(sum(group.map((row) => row.won[floor])), sum(group.map((row) => row.runs)))).join(' / '),
    floors.map((floor) => percent(sum(group.map((row) => row.missed[floor])), sum(group.map((row) => row.runs)))).join(' / '),
    floors.map((floor) => median(group.map((row) => row.par[floor]))).join(' / '),
    floors.map((floor) => median(group.map((row) => row.botPar[floor]))).join(' / '),
    floors.map((floor) => mean(group.map((row) => row.gap[floor]))).join(' / '),
  ];
  const header = `| Piece | Days | Runs won F1 / F2 / F3 | Runs past par + ${SLACK} | Par | Bot's median moves | Human gap (means) |\n|---|---|---|---|---|---|---|`;
  const line = (label, group) => `| ${label} | ${summarize(group).join(' | ')} |`;
  console.log(`Human-like bot over ${rows.length} editions (${start} to ${end}), ${rows[0]?.runs ?? 0} runs a floor${process.argv.includes('--auto') ? ', recruit on Auto' : ''}; medians of par and moves.\n`);
  console.log(header);
  for (const piece of PLAYABLE_PIECES) {
    const group = rows.filter((row) => row.piece === piece);
    if (group.length) console.log(line(piece, group));
  }
  console.log(line('all', rows));
  console.log('\nBy modifier:\n');
  console.log(header.replace('Piece', 'Modifier'));
  for (const modifier of ['none', 'ice', 'cracks', 'gates']) {
    const group = rows.filter((row) => row.modifier === modifier);
    if (group.length) console.log(line(modifier, group));
  }
  console.log(`\nBot time: median ${median(rows.map((row) => row.ms)).toFixed(0)} ms per edition, ${((performance.now() - began) / 1000).toFixed(1)} s in all on ${jobs} threads.`);
}
