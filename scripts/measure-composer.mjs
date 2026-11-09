// SPDX-License-Identifier: GPL-3.0-only
// Measure the phase-0 composer (src/composer.js) over every knight and bishop
// date whose first two floors have non-pawn targets: per motif, how often a
// built instance's planted idea wins within the line's length (replay
// acceptance), time per floor, and the human-like bot's runs from each floor's
// start (src/human-bot.js playFloor, 40 seeded runs, steering its recruit as
// par assumes). Par is the planted line plus one. A run misses when it fails
// or takes more than par + 4 moves; a stalled move neither takes a target nor
// brings the nearest one closer (wall-aware move tables). Read-only.
//   node scripts/measure-composer.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--runs N] [--json path]
import { writeFileSync } from 'node:fs';
import { composeDay } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { tierForDate, DIFFICULTY_TIERS } from '../src/difficulty.js';
import { certifiedFloors, playFloor, runSeed, HUMAN_RUNS } from '../src/human-bot.js';
import { targetDistance } from '../src/fairness.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-01'), end = arg('end', '2028-11-08'), runs = Number(arg('runs', HUMAN_RUNS));

// Moves of a run that neither took a target nor brought the nearest target closer.
function stalled(frames) {
  let count = 0;
  const nearest = (state) => {
    const targets = state.enemies.filter((foe) => foe.role === state.objective.piece);
    return targets.length ? Math.min(...targets.map((foe) => targetDistance(state, foe))) : 0;
  };
  for (let n = 1; n < frames.length; n++) {
    const before = frames[n - 1], after = frames[n];
    const took = after.events.some((event) => event.type === 'capture' && before.enemies.find((foe) => foe.id === event.id)?.role === before.objective.piece);
    if (!took && !(nearest(after) < nearest(before))) count++;
  }
  return count;
}

const rows = [];
const began = performance.now();
for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) {
  const date = new Date(time).toISOString().slice(0, 10), raw = getRawDaily(date);
  if (!['knight', 'bishop'].includes(raw.playerPiece) || raw.targets.slice(0, 2).some((role) => role === 'pawn')) continue;
  let composed;
  try { composed = composeDay(date); } catch (error) { rows.push({ date, failed: error.message }); continue; }
  const { daily, floors } = composed;
  const certified = certifiedFloors(daily);
  floors.forEach((floor, f) => {
    const par = floor.line.length + 1;
    const outcomes = Array.from({ length: runs }, (_, run) => {
      const result = playFloor(certified.starts[f], { seed: runSeed(daily, f, run), frames: true });
      return { won: result.won, moves: result.moves, lives: result.livesLost, stalled: stalled(result.frames) };
    });
    rows.push({
      date, tier: tierForDate(date), piece: raw.playerPiece, floor: f, target: raw.targets[f], motif: floor.motif, planted: floor.line.length,
      firstMoves: floor.firstMoves, forced: floor.forced, matched: floor.matched, ms: floor.ms, stats: floor.stats, par, outcomes,
    });
  });
}

const floorsOf = rows.filter((row) => !row.failed);
const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : NaN);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN; };
function summarize(group) {
  const all = group.flatMap((row) => row.outcomes);
  const won = all.filter((run) => run.won);
  return {
    floors: group.length,
    planted: `${percent(group.filter((row) => row.planted === 3).length, group.length)} / ${percent(group.filter((row) => row.planted === 4).length, group.length)}`,
    unique: percent(group.filter((row) => row.firstMoves === 1).length, group.length),
    miss: percent(all.filter((run) => !run.won || run.moves > run.par + 4).length, all.length),
    short: percent(won.filter((run) => run.moves <= 2).length, all.length),
    stalled: mean(all.map((run) => run.stalled)).toFixed(2),
    lives: mean(all.map((run) => run.lives)).toFixed(2),
    botMedian: median(group.map((row) => median(row.outcomes.filter((run) => run.won).map((run) => run.moves)))),
    ms: `${mean(group.map((row) => row.ms)).toFixed(1)} / ${median(group.map((row) => row.ms)).toFixed(1)}`,
  };
}
for (const row of floorsOf) for (const run of row.outcomes) run.par = row.par;

const motifs = [...new Set(floorsOf.map((row) => row.motif))];
const tries = {};
for (const row of floorsOf) for (const [motif, tally] of Object.entries(row.stats)) {
  const entry = (tries[motif] ??= { built: 0, replayed: 0, kept: 0 });
  entry.built += tally.built; entry.replayed += tally.replayed; entry.kept += tally.kept;
}
const days = new Set(rows.map((row) => row.date));
console.log(`Composer over ${days.size} knight and bishop days (${start} to ${end}); ${rows.filter((row) => row.failed).length} failed; ${runs} bot runs a floor; ${((performance.now() - began) / 1000).toFixed(1)} s.\n`);
console.log('| Motif | Instances built | Planted idea wins (replay acceptance) | Kept after dressing |\n|---|---|---|---|');
for (const [motif, tally] of Object.entries(tries)) console.log(`| ${motif} | ${tally.built} | ${percent(tally.replayed, tally.built)} | ${percent(tally.kept, tally.built)} |`);
const header = '| Group | Floors | Line 3 / 4 moves | Unique first move | Runs missing par+4 | Runs won in ≤2 | Stalled moves / run | Lives lost / run | Bot median moves | ms per floor (mean / median) |\n|---|---|---|---|---|---|---|---|---|---|';
const line = (name, group) => { const s = summarize(group); return `| ${name} | ${s.floors} | ${s.planted} | ${s.unique} | ${s.miss} | ${s.short} | ${s.stalled} | ${s.lives} | ${s.botMedian} | ${s.ms} |`; };
console.log(`\nBy motif:\n\n${header}`);
for (const motif of motifs) console.log(line(motif, floorsOf.filter((row) => row.motif === motif)));
console.log(line('all', floorsOf));
console.log(`\nBy motif and piece:\n\n${header}`);
for (const motif of motifs) for (const piece of ['knight', 'bishop']) {
  const group = floorsOf.filter((row) => row.motif === motif && row.piece === piece);
  if (group.length) console.log(line(`${motif} · ${piece}`, group));
}
console.log(`\nBy tier:\n\n${header}`);
for (const tier of Object.keys(DIFFICULTY_TIERS)) {
  const group = floorsOf.filter((row) => row.tier === tier);
  if (group.length) console.log(line(DIFFICULTY_TIERS[tier].name, group));
}
console.log(`\nCount rule (the paper's other suspect has the target's copies): met on ${percent(floorsOf.filter((row) => row.matched).length, floorsOf.length)} of floors.`);
const failed = rows.filter((row) => row.failed);
if (failed.length) console.log(`Failed: ${failed.map((row) => `${row.date} (${row.failed})`).join('; ')}`);
const json = arg('json', null);
if (json) writeFileSync(json, JSON.stringify(rows));
