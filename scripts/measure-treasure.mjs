// SPDX-License-Identifier: GPL-3.0-only
// Measure treasure (src/treasure.js, a dev preview): every date in the range
// is composed with composeDay's `treasure` option, and the report says
//   - how many floors get a chest, by floor and by piece, and why the rest
//     get none (no square qualifies, or the search passed its budget);
//   - how demanding each chest is: the par wins that pass through its square
//     (the composer keeps the square with the fewest), of all the floor's par
//     wins, and how many squares qualified;
//   - the "by accident" rate: the human-like bot's seeded runs from each
//     chest floor's start as played (src/human-bot.js playFloor, as
//     scripts/measure-composer.mjs runs it). The bot knows nothing of chests
//     and its play doesn't change with one in the room, so a run that takes
//     the chest and still makes par earned the mark by plain sensible play;
//   - the compose time the chests add per day.
// --days also lists each day: its piece and each floor's chest. Read-only.
//   node scripts/measure-treasure.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--runs N] [--jobs N] [--days] [--json path]
// --jobs splits the dates over that many processes.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeDay } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { certifiedFloors, playFloor, runSeed, HUMAN_RUNS } from '../src/human-bot.js';
import { chestTaken } from '../src/rules.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-11'), end = arg('end', '2027-01-10'), runs = Number(arg('runs', HUMAN_RUNS));
const jobs = Number(arg('jobs', 1)), listDays = process.argv.includes('--days');
const shard = arg('shard', null)?.split('/').map(Number) ?? null;
const square = (tile) => `${'abcdefgh'[tile.x]}${8 - tile.y}`;
const spell = (line) => line.map((action) => (action.type === 'move' ? square(action) : action.type)).join(' ');

function measure() {
  const rows = [];
  let n = 0;
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10), raw = getRawDaily(date);
    if (shard && n++ % shard[1] !== shard[0]) continue;
    let composed;
    try { composed = composeDay(date, { treasure: true }); } catch (error) { rows.push({ date, failed: error.message }); continue; }
    const { daily, floors } = composed;
    const played = certifiedFloors(daily);
    floors.forEach((floor, f) => {
      const par = floor.line.length + 1, chest = floor.treasure;
      // The bot's runs from the floor's start as played, on chest floors only: took the chest, made par, both.
      const bot = { runs: 0, took: 0, par: 0, mark: 0 };
      if (chest) for (let run = 0; run < runs; run++) {
        const result = playFloor(played.starts[f], { seed: runSeed(daily, f, run), cap: par + 5 });
        const took = chestTaken(result.state, f), made = result.won && result.moves <= par;
        bot.runs++; if (took) bot.took++; if (made) bot.par++; if (took && made) bot.mark++;
      }
      rows.push({
        date, piece: raw.playerPiece, modifier: daily.modifier, floor: f, motif: floor.motif, planted: floor.line.length, par, route: spell(floor.line),
        start: square(floor.room.start ?? { x: 4, y: 6 }), ms: floor.ms, treasureMs: floor.treasureMs, miss: floor.treasureMiss ?? null,
        chest: chest ? { square: square(chest), line: spell(chest.line), moves: chest.line.length, through: chest.through, wins: chest.wins, squares: chest.squares, steps: chest.steps } : null, bot,
      });
    });
  }
  return rows;
}

const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN; };
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

function report(rows) {
  const failed = rows.filter((row) => row.failed), floors = rows.filter((row) => !row.failed);
  const dates = [...new Set(floors.map((row) => row.date))];
  console.log(`Treasure: ${dates.length} days (${start} to ${end}), ${floors.length} floors, ${runs} bot runs a chest floor.`);
  if (failed.length) console.log(`${failed.length} days failed to compose: ${failed.map((row) => row.date).join(', ')}`);
  const header = '| Group | Floors | With a chest | No square qualifies | Search cut short | Par wins through the chest (median / mean) | …of the floor\'s par wins (median) | One par win only | Qualifying squares (median) | Chest line at the planted length | Bot takes the chest | Bot makes par | Bot takes it and makes par | Chests the bot marks in half its runs | Chests it never marks |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const line = (name, all) => {
    const group = all.filter((row) => row.chest), botRuns = sum(group, (row) => row.bot.runs);
    return `| ${name} | ${all.length} | ${group.length} (${percent(group.length, all.length)}) | ${all.filter((row) => row.miss === 'none').length} | ${all.filter((row) => row.miss === 'cut').length} | ${median(group.map((row) => row.chest.through))} / ${mean(group.map((row) => row.chest.through)).toFixed(1)} | ${median(group.map((row) => row.chest.wins))} | ${percent(group.filter((row) => row.chest.through === 1).length, group.length)} | ${median(group.map((row) => row.chest.squares))} | ${percent(group.filter((row) => row.chest.moves <= row.planted).length, group.length)} | ${percent(sum(group, (row) => row.bot.took), botRuns)} | ${percent(sum(group, (row) => row.bot.par), botRuns)} | ${percent(sum(group, (row) => row.bot.mark), botRuns)} | ${group.filter((row) => row.bot.mark * 2 >= row.bot.runs).length} | ${percent(group.filter((row) => row.bot.mark === 0).length, group.length)} |`;
  };
  const table = (title, groups) => {
    console.log(`\n${title}:\n\n${header}`);
    for (const [name, group] of groups) if (group.length) console.log(line(name, group));
  };
  const by = (pick) => [...new Set(floors.map(pick))].sort().map((value) => [value, floors.filter((row) => pick(row) === value)]);
  table('By floor', [...by((row) => `Floor ${row.floor + 1}`), ['all', floors]]);
  table('By piece', by((row) => row.piece));
  table('By piece and floor', by((row) => `${row.piece} · floor ${row.floor + 1}`));
  table('By motif', by((row) => row.motif));
  const other = floors.filter((row) => row.miss && row.miss !== 'none' && row.miss !== 'cut');
  if (other.length) console.log(`\nFloors with no chest for another reason: ${other.map((row) => `${row.date} floor ${row.floor + 1} (${row.miss})`).join(', ')}`);
  // Time: what placing the chests adds to composing a day.
  const perDay = dates.map((date) => { const day = floors.filter((row) => row.date === date); return { date, compose: sum(day, (row) => row.ms), added: sum(day, (row) => row.treasureMs) }; });
  const slowest = [...perDay].sort((a, b) => b.added - a.added)[0];
  console.log(`\nCompose time per day: ${mean(perDay.map((day) => day.compose)).toFixed(0)} ms mean (${median(perDay.map((day) => day.compose)).toFixed(0)} median) without chests; the chests add ${mean(perDay.map((day) => day.added)).toFixed(0)} ms mean, ${median(perDay.map((day) => day.added)).toFixed(0)} median, ${slowest.added.toFixed(0)} at most (${slowest.date}). Search steps a chest floor: ${median(floors.filter((row) => row.chest).map((row) => row.chest.steps))} median, ${Math.max(0, ...floors.filter((row) => row.chest).map((row) => row.chest.steps))} at most.`);
  const free = floors.filter((row) => row.chest && row.bot.mark * 2 >= row.bot.runs);
  if (free.length) console.log(`\nChests the bot marks in half its runs or more: ${free.map((row) => `${row.date} floor ${row.floor + 1} (${row.piece}, ${row.bot.mark}/${row.bot.runs})`).join(', ')}`);
  if (listDays) {
    console.log('\nDays (piece, modifier; each floor: start, planted line, par | chest, its line, par wins through it of all, the bot\'s marks):\n');
    for (const date of dates) {
      const day = floors.filter((row) => row.date === date);
      console.log(`- ${date} ${new Date(`${date}T12:00:00Z`).toUTCString().slice(0, 3)}, ${day[0].piece}, ${day[0].modifier}`);
      for (const row of day) console.log(`    F${row.floor + 1} ${row.motif}: ${row.start} "${row.route}" par ${row.par} | ${row.chest ? `chest ${row.chest.square} via "${row.chest.line}", ${row.chest.through}/${row.chest.wins} wins, bot ${row.bot.mark}/${row.bot.runs} (takes it ${row.bot.took}, par ${row.bot.par})` : `no chest (${row.miss})`}`);
    }
  }
}

if (shard) {
  process.stdout.write(JSON.stringify(measure()));
} else {
  let rows;
  if (jobs > 1) {
    const self = fileURLToPath(import.meta.url);
    const passed = process.argv.slice(2).filter((value, at, all) => !['--jobs', '--json'].includes(value) && !['--jobs', '--json'].includes(all[at - 1]));
    const parts = await Promise.all(Array.from({ length: jobs }, (_, job) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [self, ...passed, '--shard', `${job}/${jobs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
      let text = '';
      child.stdout.on('data', (chunk) => { text += chunk; });
      child.on('close', (code) => (code === 0 ? resolve(JSON.parse(text)) : reject(new Error(`Shard ${job} exited with ${code}.`))));
    })));
    rows = parts.flat().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.floor ?? 0) - (b.floor ?? 0)));
  } else rows = measure();
  const json = arg('json', null);
  if (json) writeFileSync(json, JSON.stringify(rows));
  report(rows);
}
