// SPDX-License-Identifier: GPL-3.0-only
// Measure the human-like bot (src/human-bot.js) over the precomputed editions:
// by tier and piece, how often its runs clear each floor, its par against the
// certified route's moves per floor (medians), the raw and capped human gap
// (src/difficulty.js humanGap and cappedGap, the tiers' measure; means) and the
// certificate's difficultyScore (mean) beside them. The
// bot steers its recruit, as par assumes; --auto leaves the recruit on Auto.
// Prints Markdown tables. Read-only: it never writes src/editions.js.
//   node scripts/measure-human-par.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--jobs N] [--auto]
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { EDITIONS_RANGE } from '../src/editions.js';
import { generateDaily } from '../src/generation.js';
import { humanPar, autoRecruit } from '../src/human-bot.js';
import { humanGap, cappedGap, DIFFICULTY_TIERS } from '../src/difficulty.js';
import { PLAYABLE_PIECES, PIECE_LIVES } from '../src/pieces.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; };

function measure(date, auto) {
  const began = performance.now();
  const daily = generateDaily(date);
  const human = auto ? humanPar(daily, { recruit: autoRecruit }) : humanPar(daily);
  return {
    date, tier: daily.difficulty, piece: daily.playerPiece, score: daily.generation.certificate.score,
    certified: human.certified, par: human.par, failed: human.runs.map((run) => run === null),
    won: human.results.map((runs) => runs.filter((run) => run.won).length), runs: human.results[0].length,
    lives: human.results.map((runs) => runs.filter((run) => run.won && run.livesLost > 0).length),
    // The result card shows the bot when every floor has a run and, as one run, it would have survived (humanRun).
    shown: human.runs.every((run) => run !== null)
      && human.runs.reduce((sum, run, floor) => sum + human.results[floor][run].livesLost, 0) < PIECE_LIVES[daily.playerPiece],
    gap: humanGap(human).total, capped: cappedGap(human), ms: performance.now() - began,
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
  const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const summarize = (group) => {
    const floors = [0, 1, 2];
    return [
      group.length,
      floors.map((floor) => percent(sum(group.map((row) => row.won[floor])), sum(group.map((row) => row.runs)))).join(' / '),
      floors.map((floor) => group.filter((row) => row.failed[floor]).length).join(' / '),
      floors.map((floor) => median(group.map((row) => row.par[floor]))).join(' / '),
      floors.map((floor) => median(group.map((row) => row.certified[floor]))).join(' / '),
      `${median(group.map((row) => sum(row.par)))} / ${median(group.map((row) => sum(row.certified)))}`,
      mean(group.map((row) => row.gap)),
      mean(group.map((row) => row.capped)),
      mean(group.map((row) => row.score)),
    ];
  };
  const header = '| Tier | Piece | Days | Runs won F1 / F2 / F3 | Floors failed | Par F1 / F2 / F3 | Certified F1 / F2 / F3 | Total par / certified | Human gap | Capped gap | Score |\n|---|---|---|---|---|---|---|---|---|---|---|';
  const line = (tier, piece, group) => `| ${tier} | ${piece} | ${summarize(group).join(' | ')} |`;
  console.log(`Human-like bot over ${rows.length} editions (${start} to ${end}); medians of par and moves, means of the gaps and score.\n`);
  console.log(header);
  for (const tier of Object.keys(DIFFICULTY_TIERS)) {
    for (const piece of PLAYABLE_PIECES) {
      const group = rows.filter((row) => row.tier === tier && row.piece === piece);
      if (group.length) console.log(line(DIFFICULTY_TIERS[tier].name, piece, group));
    }
  }
  console.log('\nBy tier:\n');
  console.log(header);
  for (const tier of Object.keys(DIFFICULTY_TIERS)) console.log(line(DIFFICULTY_TIERS[tier].name, 'all', rows.filter((row) => row.tier === tier)));
  console.log(line('all', 'all', rows));
  console.log('\nBy piece:\n');
  console.log(header);
  for (const piece of PLAYABLE_PIECES) console.log(line('all', piece, rows.filter((row) => row.piece === piece)));
  const lives = sum(rows.map((row) => sum(row.lives))), wins = sum(rows.map((row) => sum(row.won)));
  console.log(`\n${percent(rows.filter((row) => !row.failed.some(Boolean)).length, rows.length)} of editions had a human-like run clear every floor; the result card shows the human-like bot on ${percent(rows.filter((row) => row.shown).length, rows.length)} (the rest lost too many lives in all). ${percent(lives, wins)} of winning floor runs lost a life. Bot time: median ${median(rows.map((row) => row.ms)).toFixed(0)} ms per edition, ${((performance.now() - began) / 1000).toFixed(1)} s in all on ${jobs} threads.`);
}
