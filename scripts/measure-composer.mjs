// SPDX-License-Identifier: GPL-3.0-only
// Measure the phase-0 composer (src/composer.js) over every knight and bishop
// date whose first two floors have non-pawn targets: per motif, how often a
// built instance's planted idea wins within the line's length (replay
// acceptance), time per floor, and the human-like bot's runs from each floor's
// start (src/human-bot.js playFloor, 40 seeded runs, steering its recruit as
// par assumes). Par is the planted line plus one. A run misses when it fails
// or takes more than par + 4 moves; a stalled move neither takes a target nor
// brings the nearest one closer (wall-aware move tables). A king floor's shape
// is the royal king's square and the square the planted line mates from.
// Read-only.
//   node scripts/measure-composer.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--runs N] [--json path]
import { writeFileSync } from 'node:fs';
import { composeDay, MOTIF_LEVELS } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { tierForDate, DIFFICULTY_TIERS } from '../src/difficulty.js';
import { certifiedFloors, playFloor, runSeed, medianRun, HUMAN_RUNS } from '../src/human-bot.js';
import { targetDistance } from '../src/fairness.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-01'), end = arg('end', '2028-11-08'), runs = Number(arg('runs', HUMAN_RUNS));
// One monster ruleset for every day (--tier gentle … fiendish); omitted, the composer's own choice.
const tier = arg('tier', undefined);

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
  try { composed = composeDay(date, { tier }); } catch (error) { rows.push({ date, failed: error.message }); continue; }
  const { daily, floors } = composed;
  const certified = certifiedFloors(daily);
  floors.forEach((floor, f) => {
    const par = floor.line.length + 1;
    const outcomes = Array.from({ length: runs }, (_, run) => {
      const result = playFloor(certified.starts[f], { seed: runSeed(daily, f, run), frames: true });
      return { won: result.won, moves: result.moves, hits: result.hits, stalled: stalled(result.frames) };
    });
    // Par two ways (an open question): the planted line plus one, or the bot's median (src/human-bot.js medianRun, as production).
    const botPar = medianRun(outcomes, floor.line.length).par;
    const square = (tile) => `${'abcdefgh'[tile.x]}${8 - tile.y}`;
    const king = f === 2 ? floor.room.enemies.find((foe) => foe.cast === 0) : null;
    const mate = floor.line.findLast((action) => action.type === 'move');
    rows.push({
      date, tier: daily.difficulty, piece: raw.playerPiece, floor: f, target: raw.targets[f], motif: floor.motif, level: MOTIF_LEVELS[floor.motif], planted: floor.line.length, botPar,
      firstMoves: floor.firstMoves, forced: floor.forced, pressure: floor.pressure ?? 0, hint: floor.hint ?? null, decoys: floor.room.enemies.filter((foe) => foe.cast !== 0).length, matched: floor.matched, ms: floor.ms, stats: floor.stats, par, outcomes,
      walls: floor.room.map.join('').split('#').length - 1, shape: king && mate ? `king ${square(king)}, mate ${square(mate)}` : null,
    });
  });
}

const floorsOf = rows.filter((row) => !row.failed);
const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : NaN);
const median = (values) => { const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN; };
function summarize(group) {
  const all = group.flatMap((row) => row.outcomes);
  const won = all.filter((run) => run.won);
  return {
    floors: group.length,
    planted: `${percent(group.filter((row) => row.planted === 3).length, group.length)} / ${percent(group.filter((row) => row.planted === 4).length, group.length)}`,
    unique: percent(group.filter((row) => row.firstMoves === 1).length, group.length),
    walls: mean(group.map((row) => row.walls)).toFixed(1),
    miss: `${percent(all.filter((run) => !run.won || run.moves > run.par + 4).length, all.length)} / ${percent(all.filter((run) => !run.won || run.moves > run.botPar + 4).length, all.length)}`,
    pars: `${mean(group.map((row) => row.par)).toFixed(1)} / ${mean(group.map((row) => row.botPar)).toFixed(1)}`,
    pressure: `${mean(group.map((row) => row.pressure)).toFixed(1)} (${percent(group.filter((row) => row.pressure > 0).length, group.length)})`,
    past: percent(all.filter((run) => !run.won || run.moves > run.planted).length, all.length),
    short: `${percent(won.filter((run) => run.moves - run.hits <= 2).length, all.length)} / ${percent(won.filter((run) => run.moves <= 2).length, all.length)}`,
    stalled: mean(all.map((run) => run.stalled)).toFixed(2),
    hits: mean(all.map((run) => run.hits)).toFixed(2),
    botMedian: median(group.map((row) => median(row.outcomes.filter((run) => run.won).map((run) => run.moves)))),
    ms: `${mean(group.map((row) => row.ms)).toFixed(1)} / ${median(group.map((row) => row.ms)).toFixed(1)}`,
  };
}
for (const row of floorsOf) for (const run of row.outcomes) { run.par = row.par; run.botPar = row.botPar; run.planted = row.planted; }

const motifs = [...new Set(floorsOf.map((row) => row.motif))];
const tries = {};
for (const row of floorsOf) for (const [motif, tally] of Object.entries(row.stats)) {
  const entry = (tries[motif] ??= { built: 0, replayed: 0, kept: 0 });
  entry.built += tally.built; entry.replayed += tally.replayed; entry.kept += tally.kept;
}
const days = new Set(rows.map((row) => row.date));
const dayMs = [...days].map((date) => floorsOf.filter((row) => row.date === date).reduce((sum, row) => sum + row.ms, 0)).filter((ms) => ms > 0);
console.log(`Composer over ${days.size} knight and bishop days (${start} to ${end}); ${rows.filter((row) => row.failed).length} failed; ${runs} bot runs a floor; ${((performance.now() - began) / 1000).toFixed(1)} s.`);
console.log(`Time to compose a day: mean ${mean(dayMs).toFixed(0)} ms, median ${median(dayMs).toFixed(0)} ms, slowest ${Math.max(...dayMs).toFixed(0)} ms.\n`);
console.log('| Motif | Instances built | Planted idea wins (replay acceptance) | Kept after dressing |\n|---|---|---|---|');
for (const [motif, tally] of Object.entries(tries)) console.log(`| ${motif} | ${tally.built} | ${percent(tally.replayed, tally.built)} | ${percent(tally.kept, tally.built)} |`);
const header = '| Group | Floors | Line 3 / 4 moves | Unique first move | Walls | Mean par (line+1 / bot median) | Runs missing par+4 (line+1 / bot median) | Runs won in ≤2 (moves / moves + captures) | Stalled moves / run | Captures / run | Pressured turns on the line (floors with any) | Runs past the line length | ms per floor (mean / median) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';
const line = (name, group) => { const s = summarize(group); return `| ${name} | ${s.floors} | ${s.planted} | ${s.unique} | ${s.walls} | ${s.pars} | ${s.miss} | ${s.short} | ${s.stalled} | ${s.hits} | ${s.pressure} | ${s.past} | ${s.ms} |`; };
console.log(`\nBy motif:\n\n${header}`);
for (const motif of motifs) console.log(line(motif, floorsOf.filter((row) => row.motif === motif)));
console.log(line('all', floorsOf));
console.log(`\nBy motif and piece:\n\n${header}`);
for (const motif of motifs) for (const piece of ['knight', 'bishop']) {
  const group = floorsOf.filter((row) => row.motif === motif && row.piece === piece);
  if (group.length) console.log(line(`${motif} · ${piece}`, group));
}
console.log(`\nBy floor (level: floor 1 at 2, floor 2 at 3, the net at 3–4):\n\n${header}`);
for (const f of [0, 1, 2]) {
  const group = floorsOf.filter((row) => row.floor === f);
  const levels = [...new Set(group.map((row) => row.level))].sort().map((level) => `L${level} ${percent(group.filter((row) => row.level === level).length, group.length)}`).join(', ');
  console.log(line(`floor ${f + 1} (${levels})`, group));
}
console.log(`\nBy tier:\n\n${header}`);
for (const tier of Object.keys(DIFFICULTY_TIERS)) {
  const group = floorsOf.filter((row) => row.tier === tier);
  if (group.length) console.log(line(DIFFICULTY_TIERS[tier].name, group));
}
for (const piece of ['knight', 'bishop']) {
  const kings = floorsOf.filter((row) => row.floor === 2 && row.piece === piece && row.shape);
  if (!kings.length) continue;
  const shapes = {};
  for (const row of kings) shapes[row.shape] = (shapes[row.shape] ?? 0) + 1;
  const ranked = Object.entries(shapes).sort((a, b) => b[1] - a[1]);
  const squares = new Set(kings.map((row) => row.shape.split(',')[0]));
  console.log(`\n${piece[0].toUpperCase()}${piece.slice(1)} king floors: ${ranked.length} shapes over ${squares.size} king squares; the commonest takes ${percent(ranked[0][1], kings.length)}. ${ranked.map(([shape, n]) => `${shape}: ${n}`).join('; ')}.`);
}
const hints = {};
for (const row of floorsOf) { const key = `floor ${row.floor + 1}: ${row.hint ?? 'none'}`; hints[key] = (hints[key] ?? 0) + 1; }
console.log(`\nHint on the key square: ${Object.entries(hints).sort().map(([key, n]) => `${key} ${n}`).join(', ')}.`);
console.log(`\nCount rule (the paper's other suspect has the target's copies): met on ${percent(floorsOf.filter((row) => row.matched).length, floorsOf.length)} of floors.`);
const failed = rows.filter((row) => row.failed);
if (failed.length) console.log(`Failed: ${failed.map((row) => `${row.date} (${row.failed})`).join('; ')}`);
const json = arg('json', null);
if (json) writeFileSync(json, JSON.stringify(rows));
