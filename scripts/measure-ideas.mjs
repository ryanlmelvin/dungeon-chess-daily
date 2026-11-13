// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Coverage of the drawn ideas (src/composer.js DRAWN_IDEAS: 'wait',
// the Standstill, and 'lure', the Lure), which the stored editions have on
// the days that draw them: over a
// range of dates, the days each idea fits, the days it draws (one in
// IDEA_EVERY of those, by the date) and the days it composes on, which floor
// it takes and what stood there in the stored edition, its lines, and the mix
// of ideas per floor before and after. Each idea is composed on its own, on
// every day it fits, twice: under the three tight tests (src/tight.js), and
// without the bot's ceiling (`ceiling: false`), to show what that test costs.
// Then the days as a player would meet them: both ideas on, each on the days
// it draws. Read-only.
//   node scripts/measure-ideas.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--jobs N] [--json path] [--list N]
// --jobs splits the dates over that many processes; --list prints that many
// composed floors of each idea (date, piece, floor, line, the preview's query).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeDay, composedSeeds, ideaFloors, ideaDay, DRAWN_IDEAS, IDEA_EVERY } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { EDITIONS } from '../src/editions.js';
import { decodeMotifs } from '../src/motif-code.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-13'), end = arg('end', '2027-01-12'), jobs = Number(arg('jobs', 1)), list = Number(arg('list', 8));
const shard = arg('shard', null)?.split('/').map(Number) ?? null;
const square = (tile) => `${'abcdefgh'[tile.x]}${8 - tile.y}`;
const spell = (line) => line.map((action) => (action.type === 'move' ? square(action) : action.type)).join(' ');

// One idea on one day: where it landed (or null) composed with `options`, and how long the day took.
function tried(date, options, idea) {
  const began = performance.now();
  try {
    const { daily, floors, dropped } = composeDay(date, options);
    const floor = floors.findIndex((entry) => entry.motif === idea);
    return { floor: floor < 0 ? null : floor, line: floor < 0 ? null : spell(floors[floor].line), start: floor < 0 ? null : square(floors[floor].room.start ?? { x: 4, y: 6 }), chest: floor < 0 ? null : Boolean(floors[floor].treasure),
      ms: floor < 0 ? null : floors[floor].ms, dayMs: performance.now() - began, motifs: daily.generation.motifs, dropped };
  } catch (error) { return { floor: null, failed: error.message, dayMs: performance.now() - began }; }
}

function measure() {
  const rows = [];
  let n = 0;
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10), raw = getRawDaily(date);
    if (shard && n++ % shard[1] !== shard[0]) continue;
    const base = { ...raw, floorSeeds: composedSeeds(date) };
    const stored = EDITIONS[date] ? decodeMotifs(EDITIONS[date].motifs) : null;
    const row = { date, piece: raw.playerPiece, targets: raw.targets.slice(0, 2), stored, partner: EDITIONS[date]?.partner ?? null, ideas: {} };
    for (const idea of DRAWN_IDEAS) {
      const fits = ideaFloors(base, idea);
      row.ideas[idea] = { fits, drawn: ideaDay(base, idea) };
      if (!fits.length) continue;
      // The idea alone, on every day it fits (the other drawn idea off).
      const alone = { ...Object.fromEntries(DRAWN_IDEAS.map((name) => [name, false])), [idea]: 'every' };
      row.ideas[idea].full = tried(date, alone, idea);
      row.ideas[idea].open = tried(date, { ...alone, ceiling: false }, idea);
    }
    // As a player would meet the day: both ideas, each on the days it draws.
    if (DRAWN_IDEAS.some((idea) => row.ideas[idea].drawn)) {
      const began = performance.now();
      const { daily, floors } = composeDay(date, Object.fromEntries(DRAWN_IDEAS.map((idea) => [idea, true])));
      row.met = { motifs: daily.generation.motifs, lines: floors.map((floor) => spell(floor.line)), dayMs: performance.now() - began };
    }
    rows.push(row);
  }
  return rows;
}

const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const tally = (values) => [...new Set(values)].sort().map((value) => `${value} ${values.filter((other) => other === value).length}`).join(', ') || 'none';

function report(rows) {
  console.log(`Drawn ideas over ${rows.length} days (${start} to ${end}); an idea draws one in ${IDEA_EVERY} of the days it fits.`);
  for (const idea of DRAWN_IDEAS) {
    const fit = rows.filter((row) => row.ideas[idea].fits.length);
    console.log(`\n## ${idea}: fits ${fit.length} days (${percent(fit.length, rows.length)}); by piece: ${tally(fit.map((row) => row.piece))}; by matchup: ${tally(fit.map((row) => `${row.piece} v ${row.targets[0]}`))}; draws ${fit.filter((row) => row.ideas[idea].drawn).length}.`);
    for (const [mode, name] of [['full', 'Under the three tight tests'], ['open', 'Without the bot\'s ceiling']]) {
      const got = fit.filter((row) => row.ideas[idea][mode]?.floor !== null && row.ideas[idea][mode]?.floor !== undefined);
      const took = (row) => row.ideas[idea][mode];
      console.log(`- ${name}: composes on ${got.length} of ${fit.length} days it fits (${percent(got.length, fit.length)}), ${got.filter((row) => row.ideas[idea].drawn).length} of them days it draws; floor 1: ${got.filter((row) => took(row).floor === 0).length}, floor 2: ${got.filter((row) => took(row).floor === 1).length}; by piece: ${tally(got.map((row) => row.piece))}; by matchup: ${tally(got.map((row) => `${row.piece} v ${row.targets[took(row).floor]}`))}; lines of ${tally(got.map((row) => took(row).line.split(' ').length))}; with a chest: ${got.filter((row) => took(row).chest).length}; in place of the stored: ${tally(got.map((row) => row.stored?.[took(row).floor] ?? '?'))}; the floor's compose time: mean ${Math.round(mean(got.map((row) => took(row).ms)))} ms, slowest ${Math.round(Math.max(0, ...got.map((row) => took(row).ms)))} ms; a day where it fits but doesn't compose: mean ${Math.round(mean(fit.filter((row) => !got.includes(row)).map((row) => took(row).dayMs)))} ms.`);
      const failed = fit.filter((row) => took(row)?.failed || took(row)?.dropped?.length);
      if (failed.length) console.log(`  Days that failed or gave an option up: ${failed.map((row) => `${row.date} (${took(row).failed ?? took(row).dropped.join('+')})`).join(', ')}`);
    }
    const shown = fit.filter((row) => row.ideas[idea].full?.floor !== null && row.ideas[idea].full?.floor !== undefined).slice(0, list);
    if (shown.length) console.log(`- Composed under all three tests (date, piece, floor and target, start, line, the preview's query):\n${shown.map((row) => { const took = row.ideas[idea].full; return `  - ${row.date}, ${row.piece}, floor ${took.floor + 1} v ${row.targets[took.floor]}, from ${took.start}: ${took.line}; ?composed=${row.date}&${idea}=${row.ideas[idea].drawn ? '1' : 'all'}`; }).join('\n')}`);
  }
  // The mix of ideas per floor, as stored and as a player would meet the days with both ideas on.
  const stored = rows.filter((row) => row.stored);
  const mix = (pick) => [0, 1].map((floor) => `floor ${floor + 1}: ${tally(stored.map((row) => pick(row)[floor]))}`).join('; ');
  const met = stored.filter((row) => row.met);
  console.log(`\n## The mix of ideas on floors 1 and 2, ${stored.length} stored days\n- As stored: ${mix((row) => row.stored)}.\n- With both ideas on, each on the days it draws: ${mix((row) => row.met?.motifs ?? row.stored)}.`);
  const changed = met.filter((row) => row.met.motifs.some((motif, floor) => motif !== row.stored[floor]));
  console.log(`- ${met.length} days draw an idea; ${changed.length} of them change: ${changed.map((row) => `${row.date} (${row.piece}: ${row.met.motifs.map((motif, floor) => (motif === row.stored[floor] ? null : `floor ${floor + 1} ${row.stored[floor]} → ${motif}`)).filter(Boolean).join(', ')})`).join('; ') || 'none'}.`);
  console.log(`- Compose time of a day that draws an idea: mean ${(mean(met.map((row) => row.met.dayMs)) / 1000).toFixed(2)} s, slowest ${(Math.max(0, ...met.map((row) => row.met.dayMs)) / 1000).toFixed(1)} s.`);
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
    rows = parts.flat().sort((a, b) => (a.date < b.date ? -1 : 1));
  } else rows = measure();
  const json = arg('json', null);
  if (json) writeFileSync(json, JSON.stringify(rows));
  report(rows);
}
