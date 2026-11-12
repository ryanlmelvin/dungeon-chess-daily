// SPDX-License-Identifier: GPL-3.0-only
// Tight floors, before and after (src/tight.js; composeDay's `tight` option):
// every date in the range is composed with the option off (as the stored
// editions were) and on, and each floor is measured the same way both times.
//
// Exactly, by a search over every line of play within par (src/tight.js
// parRoom, on the day's twin without hint powerups), two ways:
//   - clean: certificate steps, never captured but on a pawn's day, as
//     scripts/measure-par-slack.mjs counts, so its figures compare with that
//     script's: first actions, those that keep the line and keep par, and
//     floors with a par win off the idea, by the composer's own narrow test
//     (usesIdea) and by the faithful one (playsIdea);
//   - as played: a line may absorb captures (each costs a move), as a
//     player's may; first actions captured at once don't count.
// By the human-like bot (--runs seeded runs a floor): runs at par or better,
// runs that fail or pass par + 4, and runs at par off the idea (faithful).
// Then how each floor came out (form, fallbacks, line lengths, compose time),
// and a day-by-day table of --table days from --start. Read-only.
//   node scripts/measure-tight.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--jobs N] [--runs N]
//     [--modes off,on] [--budget steps] [--table days] [--json path] [--from path]
// --jobs splits the dates over that many processes; --from reads rows a
// previous run wrote with --json instead of measuring (other modes are still
// measured), so the unchanging "off" side is computed once.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeDay, actionsFrom, usesIdea } from '../src/composer.js';
import { parRoom, playsIdea, TIGHT } from '../src/tight.js';
import { getRawDaily } from '../src/edition.js';
import { certifiedFloors, playFloor, runSeed, HUMAN_RUNS } from '../src/human-bot.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-11'), end = arg('end', '2027-01-10'), runs = Number(arg('runs', HUMAN_RUNS));
const jobs = Number(arg('jobs', 1)), budget = Number(arg('budget', 600_000)), tableDays = Number(arg('table', 15));
const modes = arg('modes', 'off,on').split(',');
const shard = arg('shard', null)?.split('/').map(Number) ?? null;
const square = (tile) => `${'abcdefgh'[tile.x]}${8 - tile.y}`;
const spell = (line) => line.map((action) => (action.type === 'move' ? square(action) : action.type)).join(' ');

function measureDay(date, mode) {
  const raw = getRawDaily(date), builts = [];
  let composed;
  const began = performance.now();
  try { composed = composeDay(date, { tight: mode === 'on', trace: (event) => { if (event.stage === 'kept') builts[event.floor] = event.built; } }); } catch (error) { return [{ date, mode, failed: error.message }]; }
  const dayMs = performance.now() - began;
  const { daily, floors } = composed;
  const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
  const plain = certifiedFloors(twin), played = certifiedFloors(daily);
  return floors.map((floor, f) => {
    const built = builts[f], length = floor.line.length, par = length + 1;
    const faithful = (states, line) => playsIdea(built, states, line, usesIdea);
    // The narrow test is tallied on the side of the clean search, whose verdict is the faithful one.
    let narrowOff = 0;
    const both = (states, line) => { let narrow = false; try { narrow = usesIdea(built, states, line); } catch { narrow = false; } if (!narrow) narrowOff++; return faithful(states, line); };
    const clean = parRoom(plain.starts[f], length, { actionsFrom, idea: both, hits: false, budget });
    const hit = parRoom(plain.starts[f], length, { actionsFrom, idea: faithful, budget });
    const outcomes = Array.from({ length: runs }, (_, run) => {
      const result = playFloor(played.starts[f], { seed: runSeed(daily, f, run), frames: true, cap: par + 5 });
      let idea = null;
      if (result.won) { try { idea = faithful(result.frames, result.actions); } catch { idea = false; } }
      return { won: result.won, moves: result.moves, idea };
    });
    return {
      date, mode, piece: raw.playerPiece, modifier: daily.modifier, floor: f, target: raw.targets[f], motif: floor.motif, form: floor.form ?? null, mate: floor.mate ?? null,
      hint: floor.hint ?? null, planted: length, par, start: square(floor.room.start ?? { x: 4, y: 6 }), route: spell(floor.line), ms: floor.ms, dayMs,
      cut: clean.cut || hit.cut, firsts: clean.firsts, keepLine: clean.keepLine, keepPar: clean.keepPar, wins: clean.wins, off: clean.off, offLine: clean.offLine, narrowOff,
      example: clean.example ? spell(clean.example) : null,
      hitFirsts: hit.firsts, hitKeepPar: hit.keepPar, hitWins: hit.wins, hitOff: hit.off, hitExample: hit.example ? spell(hit.example) : null, fewest: hit.fewest,
      moves: floor.line.filter((action) => action.type === 'move').length,
      runs: outcomes.length, botPar: outcomes.filter((run) => run.won && run.moves <= par).length, botLine: outcomes.filter((run) => run.won && run.moves <= length).length,
      botMiss: outcomes.filter((run) => !run.won || run.moves > par + 4).length, botPlain: outcomes.filter((run) => run.won && run.moves <= par && !run.idea).length,
    };
  });
}

function measure(wanted) {
  const rows = [];
  let n = 0;
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (shard && n++ % shard[1] !== shard[0]) continue;
    for (const mode of wanted) rows.push(...measureDay(date, mode));
  }
  return rows;
}

const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
const ideaOf = (row) => `${row.motif}${row.form ? ` (${row.form})` : row.mate ? ` (${row.mate})` : ''}`;

function report(all) {
  const failed = all.filter((row) => row.failed);
  if (failed.length) console.log(`Failed to compose: ${failed.map((row) => `${row.date} (${row.mode})`).join(', ')}`);
  const header = '| Group | Floors | Lines of 3 / 4 / more | First actions | …keep the line | …keep par | Floors where at most half keep par | Floors with a par win off the idea (narrow test) | …(faithful test) | …as played, captures allowed | Bot runs at par | Bot runs past par + 4 | Bot runs at par off the idea | Compose ms a floor (mean, max) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const line = (name, group) => {
    const ok = group.filter((row) => !row.cut), botRuns = sum(group, (row) => row.runs);
    return `| ${name} | ${group.length}${group.length - ok.length ? ` (${group.length - ok.length} cut)` : ''} | ${group.filter((row) => row.planted === 3).length} / ${group.filter((row) => row.planted === 4).length} / ${group.filter((row) => row.planted > 4).length} | ${mean(ok.map((row) => row.firsts)).toFixed(1)} | ${percent(sum(ok, (row) => row.keepLine), sum(ok, (row) => row.firsts))} | ${percent(sum(ok, (row) => row.keepPar), sum(ok, (row) => row.firsts))} | ${percent(ok.filter((row) => row.keepPar * 2 <= row.firsts).length, ok.length)} | ${percent(ok.filter((row) => row.narrowOff > 0).length, ok.length)} | ${percent(ok.filter((row) => row.off > 0).length, ok.length)} | ${percent(ok.filter((row) => row.hitOff > 0).length, ok.length)} | ${percent(sum(group, (row) => row.botPar), botRuns)} | ${percent(sum(group, (row) => row.botMiss), botRuns)} | ${percent(sum(group, (row) => row.botPlain), botRuns)} | ${Math.round(mean(group.map((row) => row.ms)))}, ${Math.round(Math.max(...group.map((row) => row.ms)))} |`;
  };
  for (const mode of modes) {
    const floors = all.filter((row) => !row.failed && row.mode === mode);
    if (!floors.length) continue;
    const days = new Set(floors.map((row) => row.date)).size;
    const dayTimes = [...new Map(floors.map((row) => [row.date, row.dayMs])).values()];
    console.log(`\n## Option ${mode}: ${days} days (${start} to ${end}), ${floors.length} floors, ${runs} bot runs a floor. Compose time a day: mean ${(mean(dayTimes) / 1000).toFixed(2)} s, slowest ${(Math.max(...dayTimes) / 1000).toFixed(1)} s.`);
    const by = (pick, rows = floors) => [...new Set(rows.map(pick))].sort().map((value) => [value, rows.filter((row) => pick(row) === value)]);
    console.log(`\n${header}`);
    for (const [name, group] of [...by((row) => `Floor ${row.floor + 1}`), ...by((row) => `Floor ${row.floor + 1} · ${ideaOf(row)}`), ...by((row) => (row.piece === 'pawn' ? `pawn player · ${ideaOf(row)}` : `other pieces · ${ideaOf(row)}`))]) console.log(line(name, group));
    // What a tight day's floor 2 came out as, by matchup.
    if (mode === 'on') {
      console.log('\nFloor 2 by matchup (pieces other than the pawn): what composed.\n');
      const second = floors.filter((row) => row.floor === 1 && row.piece !== 'pawn');
      for (const [name, group] of by((row) => `${row.piece} v ${row.target}`, second)) console.log(`- ${name}: ${by(ideaOf, group).map(([idea, rows]) => `${idea} ${rows.length}`).join(', ')}`);
    }
    const nets = floors.filter((row) => row.floor === 2 && row.piece === 'pawn');
    if (nets.length) console.log(`\nA pawn's king floor: ${by((row) => row.mate ?? row.motif, nets).map(([mate, rows]) => `${mate} ${rows.length} (${percent(rows.length, nets.length)})`).join(', ')}; lines of ${[3, 4, 5].map((n) => `${n}: ${nets.filter((row) => row.planted === n).length}`).join(', ')}; a par win with fewer pawn moves than the line on ${percent(nets.filter((row) => !row.cut && row.fewest < row.moves).length, nets.filter((row) => !row.cut).length)}.`);
  }
  if (modes.includes('off') && modes.includes('on') && tableDays > 0) {
    console.log(`\n## Day by day, ${tableDays} days from ${start} (each floor: idea, planted line; first actions that keep par / all; bot runs at par of ${runs})\n`);
    console.log('| Date | Piece | Floor | Before | After | Change |\n|---|---|---|---|---|---|');
    const cell = (row) => `${ideaOf(row)}: ${row.route}; ${row.keepPar}/${row.firsts}; bot ${row.botPar}`;
    for (let n = 0, time = Date.parse(start); n < tableDays; n++, time += DAY) {
      const date = new Date(time).toISOString().slice(0, 10);
      for (const f of [0, 1, 2]) {
        const before = all.find((row) => row.date === date && row.mode === 'off' && row.floor === f), after = all.find((row) => row.date === date && row.mode === 'on' && row.floor === f);
        if (!before || !after) continue;
        const same = before.route === after.route && before.motif === after.motif && before.start === after.start;
        // Easier: the bot makes par clearly more often (a quarter of its runs), or more first actions keep par and the bot does no worse.
        const easier = !same && (after.botPar - before.botPar > runs / 4 || (after.keepPar / after.firsts > before.keepPar / before.firsts + 0.2 && after.botPar >= before.botPar));
        console.log(`| ${f ? '' : date} | ${f ? '' : before.piece} | ${f + 1} v ${before.target} | ${cell(before)} | ${same ? 'same' : cell(after)} | ${same ? '' : easier ? 'EASIER?' : after.botPar < before.botPar ? 'harder' : 'changed'} |`);
      }
    }
  }
  if (modes.includes('off') && modes.includes('on')) {
    // Floors that got easier with the option on, over the whole range.
    const eased = [];
    for (const after of all.filter((row) => !row.failed && row.mode === 'on')) {
      const before = all.find((row) => row.date === after.date && row.mode === 'off' && row.floor === after.floor);
      if (!before || (before.route === after.route && before.motif === after.motif && before.start === after.start)) continue;
      if (after.botPar - before.botPar > runs / 4) eased.push(`${after.date} floor ${after.floor + 1} (${ideaOf(before)} bot ${before.botPar} → ${ideaOf(after)} bot ${after.botPar})`);
    }
    console.log(`\nFloors whose bot par rate rose by more than a quarter of its runs with the option on: ${eased.length ? eased.join('; ') : 'none'}.`);
  }
  console.log(`\nThresholds (src/tight.js TIGHT): at most ${TIGHT.firstShare} of first actions keep par; search budget ${TIGHT.budget} steps.`);
}

if (shard) {
  process.stdout.write(JSON.stringify(measure(modes)));
} else {
  const from = arg('from', null);
  const cached = from ? JSON.parse(readFileSync(from, 'utf8')).filter((row) => row.date >= start && row.date <= end) : [];
  const have = new Set(cached.map((row) => row.mode));
  const wanted = modes.filter((mode) => !have.has(mode));
  let rows = cached.filter((row) => modes.includes(row.mode));
  if (wanted.length) {
    if (jobs > 1) {
      const self = fileURLToPath(import.meta.url);
      const passed = process.argv.slice(2).filter((value, at, list) => !['--jobs', '--json', '--from', '--modes'].includes(value) && !['--jobs', '--json', '--from', '--modes'].includes(list[at - 1]));
      const parts = await Promise.all(Array.from({ length: jobs }, (_, job) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [self, ...passed, '--modes', wanted.join(','), '--shard', `${job}/${jobs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
        let text = '';
        child.stdout.on('data', (chunk) => { text += chunk; });
        child.on('close', (code) => (code === 0 ? resolve(JSON.parse(text)) : reject(new Error(`Shard ${job} exited with ${code}.`))));
      })));
      rows = [...rows, ...parts.flat()];
    } else rows = [...rows, ...measure(wanted)];
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.mode < b.mode ? 1 : a.mode > b.mode ? -1 : (a.floor ?? 0) - (b.floor ?? 0)));
  const json = arg('json', null);
  if (json) writeFileSync(json, JSON.stringify(rows));
  report(rows);
}
