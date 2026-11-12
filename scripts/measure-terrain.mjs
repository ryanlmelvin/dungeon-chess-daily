// SPDX-License-Identifier: GPL-3.0-only
// Measure the two moving-terrain modifiers (src/terrain.js): a crumbling
// floor (src/cracks.js) and gates (src/gates.js). Neither is drawn for any
// date yet, so every date in the range is composed twice: with the modifier
// forced on (as the dev preview's &modifier= composes it) and as a plain day,
// its twin. Floor by floor the report gives:
//   - how the floor met its terrain (src/composer.js "Terrain floors"):
//     composed around it ('idea': the terrain matters to the line, and why),
//     with it laid off the line ('off'), or with none; by idea and by piece;
//   - the planted line: its length, how many of its moves are waits;
//   - exactly (src/tight.js parRoom, certificate steps: never captured but on
//     a pawn's day), the first actions the floor allows and how many keep the
//     line's length and how many keep par, beside the plain twin's (a Tandem
//     floor is left out: its line needs the recruit steered);
//   - the human-like bot (src/human-bot.js, --runs seeded runs a floor): runs
//     at par or better, runs past par + 4 or failed, beside the plain twin's;
//   - strandings: bot runs that ended with no legal move (the floor starts
//     over), and, of every legal move in every position those runs passed
//     through, how many would strand the player at once;
//   - compose time a day, beside the plain twin's.
// Read-only.
//   node scripts/measure-terrain.mjs --modifier cracks|gates [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--runs N]
//     [--jobs N] [--json path] [--no-treasure] [--no-partner] [--no-tight]
// --jobs splits the dates over that many processes. Days compose in the
// release configuration (scripts/compose-options.mjs).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeOptions, optionsLabel } from './compose-options.mjs';
import { composeDay, actionsFrom, usesIdea } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { act, legalMoves } from '../src/rules.js';
import { parRoom } from '../src/tight.js';
import { certifiedFloors, playFloor, runSeed, HUMAN_RUNS } from '../src/human-bot.js';
import { MODIFIERS } from '../src/modifiers.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-13'), end = arg('end', '2027-01-12'), runs = Number(arg('runs', HUMAN_RUNS));
const modifier = arg('modifier', 'cracks'), jobs = Number(arg('jobs', 1));
const shard = arg('shard', null)?.split('/').map(Number) ?? null;
const options = composeOptions();
const square = (tile) => `${'abcdefgh'[tile.x]}${8 - tile.y}`;
const spell = (line) => line.map((action) => `${action.type === 'move' ? square(action) : action.type}${action.recruit === undefined ? '' : `+${action.recruit === 'hold' ? 'hold' : square(action.recruit)}`}`).join(' ');
const stranded = (state) => state.events.some((event) => event.type === 'restart');

// One composed day's floors, measured: exact first actions, the bot's runs, strandings.
function floorsOf(date, forced) {
  const raw = getRawDaily(date), builts = [], stages = [{}, {}, {}];
  const began = performance.now();
  const composed = composeDay(date, { ...options, daily: { ...raw, modifier: forced }, trace: (event) => {
    if (event.floor === undefined) return;
    if (event.stage === 'kept') builts[event.floor] = event.built;
    stages[event.floor][event.stage] = (stages[event.floor][event.stage] ?? 0) + 1;
  } });
  const ms = performance.now() - began;
  const { daily, floors } = composed;
  const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
  const searched = certifiedFloors(twin), played = certifiedFloors(daily);
  return floors.map((floor, f) => {
    const built = builts[f], length = floor.line.length, par = length + 1, partner = daily.generation.partner === f;
    const exact = partner ? null : parRoom(searched.starts[f], length, { actionsFrom, hits: false, idea: (states, line) => usesIdea(built, states, line) });
    let moves = 0, strandMoves = 0, positions = 0;
    const outcomes = Array.from({ length: runs }, (_, run) => {
      const result = playFloor(played.starts[f], { seed: runSeed(daily, f, run), frames: true, cap: par + 5 });
      // Every legal move of every position the run passed through: would it strand the player at once?
      for (const frame of result.frames.slice(0, -1)) {
        positions++;
        for (const move of legalMoves(frame)) { moves++; if (stranded(act(frame, { type: 'move', x: move.x, y: move.y }))) strandMoves++; }
      }
      return { won: result.won, moves: result.moves, stranded: result.frames.some(stranded) };
    });
    return {
      date, piece: raw.playerPiece, own: raw.modifier, modifier: forced, floor: f, target: raw.targets[f], motif: floor.motif, form: floor.form ?? null, terrain: floor.terrain ?? null, why: floor.why ?? null, rounds: floor.rounds ?? null,
      partner, hint: floor.hint ?? null, planted: length, waits: floor.line.filter((action) => action.type === 'wait').length, route: `${square(floor.room.start ?? { x: 4, y: 6 })}: ${spell(floor.line)}`,
      chest: Boolean(floor.treasure), ms: floor.ms, dayMs: ms, stages: stages[f], dropped: composed.dropped,
      cut: exact ? exact.cut : null, firsts: exact?.firsts ?? null, keepLine: exact?.keepLine ?? null, keepPar: exact?.keepPar ?? null, offIdea: exact?.off ?? null, wins: exact?.wins ?? null,
      runs, botPar: outcomes.filter((run) => run.won && run.moves <= par).length, botLine: outcomes.filter((run) => run.won && run.moves <= length).length,
      botPast: outcomes.filter((run) => !run.won).length, botStranded: outcomes.filter((run) => run.stranded).length, legal: moves, strandMoves, positions,
    };
  });
}

function measure() {
  const rows = [];
  let n = 0;
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (shard && n++ % shard[1] !== shard[0]) continue;
    for (const forced of [modifier, 'none']) {
      try { rows.push(...floorsOf(date, forced)); } catch (error) { rows.push({ date, modifier: forced, failed: error.message }); }
    }
  }
  return rows;
}

const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN; };
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

function report(rows) {
  const name = MODIFIERS[modifier]?.name ?? modifier;
  const failed = rows.filter((row) => row.failed), ok = rows.filter((row) => !row.failed);
  const forced = ok.filter((row) => row.modifier === modifier), plain = ok.filter((row) => row.modifier === 'none');
  const twinOf = new Map(plain.map((row) => [`${row.date}:${row.floor}`, row]));
  const twins = (group) => group.map((row) => twinOf.get(`${row.date}:${row.floor}`)).filter(Boolean);
  console.log(`${name} (${modifier}) forced on, ${new Set(forced.map((row) => row.date)).size} days (${start} to ${end}) in ${optionsLabel(options)}: ${forced.length} floors, ${runs} bot runs a floor, each beside the same date composed as a plain day.`);
  if (failed.length) console.log(`Failed to compose: ${failed.map((row) => `${row.date} (${row.modifier}: ${row.failed})`).join('; ')}`);
  const dropped = forced.filter((row) => row.floor === 0 && row.dropped?.length);
  if (dropped.length) console.log(`Days that gave an option up: ${dropped.map((row) => `${row.date} (${row.dropped.join(', ')})`).join('; ')}`);

  const levels = ['idea', 'off', 'none'];
  const count = (group, level) => group.filter((row) => row.terrain === level).length;
  const by = (group, pick) => [...new Set(group.map(pick))].sort().map((value) => [value, group.filter((row) => pick(row) === value)]);
  const composition = (title, groups) => {
    console.log(`\n${title}:\n\n| Group | Floors | Around the terrain | Off the line | No terrain | Line of 3 / 4 / other | Lines with a wait | Hinted |\n|---|---|---|---|---|---|---|---|`);
    for (const [label, group] of groups) if (group.length) {
      console.log(`| ${label} | ${group.length} | ${count(group, 'idea')} (${percent(count(group, 'idea'), group.length)}) | ${count(group, 'off')} | ${count(group, 'none')} | ${group.filter((row) => row.planted === 3).length} / ${group.filter((row) => row.planted === 4).length} / ${group.filter((row) => row.planted !== 3 && row.planted !== 4).length} | ${group.filter((row) => row.waits > 0).length} | ${group.filter((row) => row.hint).length} |`);
    }
  };
  composition('How floors met their terrain, by floor', [...by(forced, (row) => `Floor ${row.floor + 1}`), ['all', forced], ['the same floors as plain days', plain.map((row) => ({ ...row, terrain: null }))]]);
  composition('By idea (the floor\'s motif as composed)', by(forced, (row) => `${row.motif}${row.form ? ` (${row.form})` : ''}`));
  composition('By piece', by(forced, (row) => row.piece));
  composition('By piece and idea, floors composed around the terrain or not', by(forced, (row) => `${row.piece} · ${row.motif}`));
  const around = forced.filter((row) => row.terrain === 'idea');
  console.log(`\nWhy the terrain matters on the ${around.length} floors composed around it (the same room without it): the line fails there ${around.filter((row) => row.why === 'line').length}, something wins sooner there ${around.filter((row) => row.why === 'shorter').length}, a win as short there is ruled out here ${around.filter((row) => row.why === 'other').length}${around.some((row) => !row.why) ? `, changed by the hint laid afterwards ${around.filter((row) => !row.why).length}` : ''}.`);
  const fell = forced.filter((row) => row.terrain !== 'idea');
  console.log(`\nFloors that fell back (${fell.length}): ${by(fell, (row) => (row.partner ? 'a Tandem (never composed around terrain)' : row.form ? `a tight ${row.motif} (${row.form})` : row.motif)).map(([label, group]) => `${label} ${group.length}`).join(', ') || 'none'}.`);

  const play = (title, groups) => {
    console.log(`\n${title}:\n\n| Group | Floors | First actions | …keep the line | …keep par | Bot runs at par or better | …under par | Bot runs past par + 4 or failed | Bot runs stranded | Legal moves that strand at once |\n|---|---|---|---|---|---|---|---|---|---|`);
    for (const [label, all] of groups) if (all.length) {
      const exact = all.filter((row) => row.firsts !== null && !row.cut), botRuns = sum(all, (row) => row.runs);
      console.log(`| ${label} | ${all.length} | ${mean(exact.map((row) => row.firsts)).toFixed(1)} | ${mean(exact.map((row) => row.keepLine)).toFixed(2)} (${percent(sum(exact, (row) => row.keepLine), sum(exact, (row) => row.firsts))}) | ${mean(exact.map((row) => row.keepPar)).toFixed(2)} (${percent(sum(exact, (row) => row.keepPar), sum(exact, (row) => row.firsts))}) | ${percent(sum(all, (row) => row.botPar), botRuns)} | ${percent(sum(all, (row) => row.botLine), botRuns)} | ${percent(sum(all, (row) => row.botPast), botRuns)} | ${percent(sum(all, (row) => row.botStranded), botRuns)} | ${sum(all, (row) => row.strandMoves)} of ${sum(all, (row) => row.legal)} (${percent(sum(all, (row) => row.strandMoves), sum(all, (row) => row.legal))}) |`);
    }
  };
  const pairs = (label, group) => [[`${label}: ${name}`, group], [`${label}: plain twins`, twins(group)]];
  play('Play, each group beside the same floors composed as plain days', [
    ...pairs('All floors', forced),
    ...levels.flatMap((level) => pairs(`Terrain ${level}`, forced.filter((row) => row.terrain === level))),
    ...[0, 1, 2].flatMap((f) => pairs(`Floor ${f + 1}`, forced.filter((row) => row.floor === f))),
  ]);
  play('Play by piece (floors composed around the terrain only)', by(forced.filter((row) => row.terrain === 'idea'), (row) => row.piece).flatMap(([piece, group]) => pairs(piece, group)));
  play('Play by idea (floors composed around the terrain only)', by(forced.filter((row) => row.terrain === 'idea'), (row) => row.motif).flatMap(([motif, group]) => pairs(motif, group)));
  // Floor by floor: is the terrain floor easier or harder for the bot than its plain twin?
  const idea = forced.filter((row) => row.terrain === 'idea' && twinOf.has(`${row.date}:${row.floor}`));
  const versus = (pick) => { const diff = idea.map((row) => pick(row) - pick(twinOf.get(`${row.date}:${row.floor}`))); return `${diff.filter((d) => d > 0).length} higher, ${diff.filter((d) => d === 0).length} equal, ${diff.filter((d) => d < 0).length} lower`; };
  console.log(`\nFloor by floor against its plain twin (${idea.length} floors composed around the terrain): bot runs at par ${versus((row) => row.botPar)}; bot runs past par + 4 or failed ${versus((row) => row.botPast)}; first actions that keep par ${versus((row) => row.keepPar ?? 0)}; line length ${versus((row) => row.planted)}.`);

  const days = (group) => by(group, (row) => row.date).map(([, floors]) => floors[0].dayMs);
  const time = (group) => { const all = days(group); return `median ${seconds(median(all))}, mean ${seconds(mean(all))}, slowest ${seconds(Math.max(...all))}`; };
  console.log(`\nCompose time a day: ${name} ${time(forced)}; plain ${time(plain)}.`);
  console.log(`By piece (${name}; mean): ${by(forced, (row) => row.piece).map(([piece, group]) => `${piece} ${seconds(mean(days(group)))}`).join(', ')}.`);
  const round2 = forced.filter((row) => row.rounds > 1).length;
  if (round2) console.log(`Floors that composed around the terrain only on a later round: ${round2}.`);
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
    rows = parts.flat().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.modifier < b.modifier ? -1 : a.modifier > b.modifier ? 1 : (a.floor ?? 0) - (b.floor ?? 0))));
  } else rows = measure();
  const json = arg('json', null);
  if (json) writeFileSync(json, JSON.stringify(rows));
  report(rows);
}
