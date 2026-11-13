// SPDX-License-Identifier: GPL-3.0-only
// How much room each composed floor leaves around its planted idea
// (src/composer.js): is there an idea to find, or does plain play make par?
// Every date in the range is composed afresh (as the stored editions were),
// and each floor is measured two ways.
//
// Exactly, by a search over every line of play (the composer's own moves and
// steps: actionsFrom, src/fairness.js routeTransition, on the day's twin
// without hint powerups, so no power, no floor 1–2 recruit, and never
// captured but on a pawn's day):
//   - first moves: of the first actions the floor allows (waiting included),
//     how many still leave a win within the planted line's length, and how
//     many within par (the line plus one);
//   - lines: of every win within par (at most --lines a floor, shared evenly
//     among the first actions), how many do not use the planted idea, by the
//     composer's own test (usesIdea).
// By the human-like bot (src/human-bot.js playFloor, --runs seeded runs from
// the floor's start as played, steering its recruit as a player would):
// how often a run makes par, and how often it does so without the idea.
// The bot knows no ideas, so that is plain sensible play.
// A floor whose search passes --budget steps is left out of the exact
// figures (counted as "search cut short"). Read-only.
//   node scripts/measure-par-slack.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--runs N] [--pieces knight,bishop,…]
//     [--jobs N] [--budget steps] [--lines N] [--json path] [--examples N]
//     [--no-treasure] [--no-partner] [--no-tight] [--wait] [--lure] [--ideas] [--every] [--no-ceiling]
//     [--modifier none|ice|cracks|gates]
// --jobs splits the dates over that many processes. --modifier composes every
// day under that modifier instead of its own (none: as a plain day; cracks and
// gates, the two in preview, lay each floor's terrain: the report then adds how
// each floor met it, and the bot's runs past par + 4).
// Days compose in the release configuration, as the stored editions do;
// --no-treasure, --no-partner and --no-tight each turn one of its options off
// (scripts/compose-options.mjs), and --wait, --lure or --ideas add the ideas
// in preview (with --every, on every day they fit). A partner floor's search steers the recruit,
// as its line does (searchPartner): a first action is still a move or wait of
// yours, kept when some order of the recruit keeps it.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeOptions, optionsLabel } from './compose-options.mjs';
import { composeDay, actionsFrom, partnerActions, usesIdea, COMPOSED_PIECES } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { routeTransition, positionKey } from '../src/fairness.js';
import { certifiedFloors, playFloor, runSeed, HUMAN_RUNS } from '../src/human-bot.js';
import { distanceTable } from '../src/move-tables.js';

const DAY = 86_400_000;
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const start = arg('start', '2026-11-01'), end = arg('end', '2028-11-08'), runs = Number(arg('runs', HUMAN_RUNS));
const pieces = arg('pieces', COMPOSED_PIECES.join(',')).split(',');
const jobs = Number(arg('jobs', 1)), budget = Number(arg('budget', 600_000)), most = Number(arg('lines', 3000)), examples = Number(arg('examples', 6));
const shard = arg('shard', null)?.split('/').map(Number) ?? null;
const options = composeOptions();
const forced = arg('modifier', null);
/** A steered search tries each move with several orders, so a partner floor gets this many times --budget. */
const PARTNER_BUDGET = 10;
const square = (tile) => `${'abcdefgh'[tile.x]}${8 - tile.y}`;
// A recruit's order follows its move: "e3+c5" (to c5), "e3+hold".
const spell = (line) => line.map((action) => `${action.type === 'move' ? square(action) : action.type}${action.recruit === undefined ? '' : `+${action.recruit === 'hold' ? 'hold' : square(action.recruit)}`}`).join(' ');

/** The exact figures of one floor from `begin`, for the motif instance `built` and its planted line of `length` moves. */
function searchFloor(begin, built, length) {
  const par = length + 1, memo = new Map();
  let steps = 0, cut = false;
  const step = (state, action) => { steps++; return routeTransition(state, action); };
  // Can the floor still be won within `left` scored moves?
  const canWin = (state, left) => {
    if (left <= 0 || cut) return false;
    const key = `${left}|${positionKey(state)}`;
    if (memo.has(key)) return memo.get(key);
    if (steps > budget) { cut = true; return false; }
    let won = false;
    for (const action of actionsFrom(state)) {
      const next = step(state, action);
      if (!next) continue;
      const cost = 1 + next.hits - state.hits;
      if (cost <= left && (next.exit.open || canWin(next, left - cost))) { won = true; break; }
    }
    if (!cut) memo.set(key, won);
    return won;
  };
  const firsts = [];
  for (const action of actionsFrom(begin)) {
    const next = step(begin, action);
    if (!next) continue;
    const cost = 1 + next.hits - begin.hits;
    const within = (total) => cost <= total && (next.exit.open || canWin(next, total - cost));
    const keepsPar = within(par);
    firsts.push({ action, next, cost, par: keepsPar, line: keepsPar && within(length) });
  }
  // Every win within par, each first action given the same share of the cap.
  const share = Math.max(1, Math.ceil(most / Math.max(1, firsts.filter((first) => first.par).length)));
  const tally = { lines: 0, plain: 0, lineLong: 0, plainLong: 0, capped: false, example: null };
  for (const first of firsts.filter((entry) => entry.par)) {
    let found = 0;
    const win = (line, states, cost) => {
      found++; tally.lines++;
      const longer = cost > length;
      if (longer) tally.lineLong++;
      let idea = false;
      try { idea = usesIdea(built, states, line); } catch { idea = false; }
      if (!idea) { tally.plain++; if (longer) tally.plainLong++; if (!tally.example || line.length < tally.example.length) tally.example = line; }
    };
    const walk = (state, left, line, states, spent) => {
      for (const action of actionsFrom(state)) {
        if (found >= share) { tally.capped = true; return; }
        const next = step(state, action);
        if (!next) continue;
        const cost = 1 + next.hits - state.hits;
        if (cost > left) continue;
        if (next.exit.open) win([...line, action], [...states, next], spent + cost);
        else if (canWin(next, left - cost)) walk(next, left - cost, [...line, action], [...states, next], spent + cost);
      }
    };
    if (first.next.exit.open) win([first.action], [begin, first.next], first.cost);
    else walk(first.next, par - first.cost, [first.action], [begin, first.next], first.cost);
  }
  return {
    cut, steps, firsts: firsts.length, keepLine: firsts.filter((first) => first.line).length, keepPar: firsts.filter((first) => first.par).length,
    ...tally, example: tally.example ? spell(tally.example) : null,
  };
}

/**
 * searchFloor for a partner floor, whose line the recruit plays a part in:
 * each move or wait is tried with the recruit's orders (partnerActions), each
 * step a certificate step with the recruit steered. Every order would be
 * twenty times the search, so the recruit's quiet moves are tried only to
 * squares from which it could still take a target in the moves left, over the
 * room's walls (and it may always hold, or take); on the last move only an
 * order that takes a target. That is exact while the targets stand still, as
 * a tandem's twins do, but for a quiet move that would only block a decoy. A
 * first action is a move or wait of yours: it keeps the line or par when one
 * of its orders does (the orders that keep the line are found first; where
 * none does, the first found to keep par settles it). The wins within par are
 * counted under the orders so found.
 */
function searchPartner(begin, built, length) {
  const par = length + 1, memo = new Map(), limit = budget * PARTNER_BUDGET, steered = { recruit: 'steer' };
  let steps = 0, cut = false;
  const step = (state, action) => { steps++; return routeTransition(state, action, steered); };
  const posts = (left) => (tile, board) => {
    const table = distanceTable(board.map, board.companion.piece);
    return board.enemies.some((foe) => foe.role === board.objective.piece && table[(tile.y * 8 + tile.x) * 64 + foe.y * 8 + foe.x] <= left - 1);
  };
  const tries = (state, left) => partnerActions(state, left === 1, posts(left));
  const canWin = (state, left) => {
    if (left <= 0 || cut) return false;
    const key = `${left}|${positionKey(state)}`;
    if (memo.has(key)) return memo.get(key);
    if (steps > limit) { cut = true; return false; }
    let won = false;
    for (const action of tries(state, left)) {
      const next = step(state, action);
      if (!next) continue;
      const cost = 1 + next.hits - state.hits;
      if (cost <= left && (next.exit.open || canWin(next, left - cost))) { won = true; break; }
    }
    if (!cut) memo.set(key, won);
    return won;
  };
  const groups = new Map();
  for (const action of tries(begin, par)) {
    const own = `${action.type}:${action.x ?? ''}:${action.y ?? ''}`;
    groups.set(own, [...(groups.get(own) ?? []), action]);
  }
  const firsts = [...groups.values()].map((actions) => {
    const tried = actions.map((action) => ({ action, next: step(begin, action) })).filter((entry) => entry.next).map((entry) => ({ ...entry, cost: 1 + entry.next.hits - begin.hits }));
    const within = (entry, total) => entry.cost <= total && (entry.next.exit.open || canWin(entry.next, total - entry.cost));
    const line = tried.filter((entry) => within(entry, length));
    const kept = line.length ? line : [tried.find((entry) => within(entry, par))].filter(Boolean);
    return { line: line.length > 0, par: kept.length > 0, kept };
  });
  const starts = firsts.flatMap((first) => first.kept);
  const share = Math.max(1, Math.ceil(most / Math.max(1, starts.length)));
  const tally = { lines: 0, plain: 0, lineLong: 0, plainLong: 0, capped: false, example: null };
  for (const first of starts) {
    let found = 0;
    const win = (line, states, cost) => {
      found++; tally.lines++;
      const longer = cost > length;
      if (longer) tally.lineLong++;
      let idea = false;
      try { idea = usesIdea(built, states, line); } catch { idea = false; }
      if (!idea) { tally.plain++; if (longer) tally.plainLong++; if (!tally.example || line.length < tally.example.length) tally.example = line; }
    };
    const walk = (state, left, line, states, spent) => {
      for (const action of tries(state, left)) {
        if (found >= share) { tally.capped = true; return; }
        const next = step(state, action);
        if (!next) continue;
        const cost = 1 + next.hits - state.hits;
        if (cost > left) continue;
        if (next.exit.open) win([...line, action], [...states, next], spent + cost);
        else if (canWin(next, left - cost)) walk(next, left - cost, [...line, action], [...states, next], spent + cost);
      }
    };
    if (first.next.exit.open) win([first.action], [begin, first.next], first.cost);
    else walk(first.next, par - first.cost, [first.action], [begin, first.next], first.cost);
  }
  return {
    cut, steps, firsts: firsts.length, keepLine: firsts.filter((first) => first.line).length, keepPar: firsts.filter((first) => first.par).length,
    ...tally, example: tally.example ? spell(tally.example) : null,
  };
}

function measure() {
  const rows = [];
  let n = 0;
  for (let time = Date.parse(start); time <= Date.parse(end); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10), raw = getRawDaily(date);
    if (!pieces.includes(raw.playerPiece)) continue;
    if (shard && n++ % shard[1] !== shard[0]) continue;
    const builts = [];
    let composed;
    try { composed = composeDay(date, { ...options, ...(forced && { daily: { ...raw, modifier: forced } }), trace: (event) => { if (event.stage === 'kept') builts[event.floor] = event.built; } }); } catch (error) { rows.push({ date, failed: error.message }); continue; }
    const { daily, floors } = composed;
    // The search runs on the twin without hint powerups (src/generation.js proveComposed), the bot on the day as played.
    const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
    const plain = certifiedFloors(twin), played = certifiedFloors(daily);
    floors.forEach((floor, f) => {
      const built = builts[f], length = floor.line.length, par = length + 1;
      // A partner floor's line, and a mate floor's, carries the recruit's orders: searched with it steered.
      const exact = daily.generation.partner === f || daily.generation.motifs[f] === 'mate' ? searchPartner(plain.starts[f], built, length) : searchFloor(plain.starts[f], built, length);
      const outcomes = Array.from({ length: runs }, (_, run) => {
        const result = playFloor(played.starts[f], { seed: runSeed(daily, f, run), frames: true, cap: par + 5 });
        let idea = null;
        if (result.won) { try { idea = usesIdea(built, result.frames, result.actions); } catch { idea = false; } }
        return { won: result.won, moves: result.moves, idea };
      });
      rows.push({
        date, piece: raw.playerPiece, modifier: daily.modifier, floor: f, target: raw.targets[f], motif: floor.motif, hint: floor.hint ?? null, planted: length, par,
        start: square(floor.room.start ?? { x: 4, y: 6 }), route: spell(floor.line), ...exact,
        runs: outcomes.length, botPar: outcomes.filter((run) => run.won && run.moves <= par).length, botLine: outcomes.filter((run) => run.won && run.moves <= length).length,
        botPlain: outcomes.filter((run) => run.won && run.moves <= par && !run.idea).length,
        // A run stops at par + 5 (its cap), so one that hasn't won failed or passed par + 4.
        botPast: outcomes.filter((run) => !run.won).length, terrain: floor.terrain ?? null,
      });
    });
  }
  return rows;
}

const percent = (part, whole) => (whole ? `${Math.round((1000 * part) / whole) / 10}%` : '–');
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

function report(rows) {
  const failed = rows.filter((row) => row.failed), floors = rows.filter((row) => !row.failed);
  console.log(`Room around the planted idea: ${new Set(floors.map((row) => row.date)).size} days (${start} to ${end}; ${pieces.join(', ')}) in ${optionsLabel(options)}${forced ? `, every day composed under the modifier ${forced}` : ''}, ${floors.length} floors, ${runs} bot runs a floor.`);
  if (failed.length) console.log(`${failed.length} days failed to compose: ${failed.map((row) => row.date).join(', ')}`);
  const header = '| Group | Floors | Search cut short | First actions | …keep the line | …keep par | One first action keeps the line | One keeps par | Floors with a par win off the idea | …at the line\'s own length | Par wins off the idea (mean share) | Bot runs at par or better | …under par | Bot runs at par off the idea | Floors the bot pars off the idea in half its runs |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const line = (name, all) => {
    const group = all.filter((row) => !row.cut);
    const botRuns = sum(all, (row) => row.runs);
    return `| ${name} | ${all.length} | ${all.length - group.length} | ${mean(group.map((row) => row.firsts)).toFixed(1)} | ${mean(group.map((row) => row.keepLine)).toFixed(1)} (${percent(sum(group, (row) => row.keepLine), sum(group, (row) => row.firsts))}) | ${mean(group.map((row) => row.keepPar)).toFixed(1)} (${percent(sum(group, (row) => row.keepPar), sum(group, (row) => row.firsts))}) | ${percent(group.filter((row) => row.keepLine === 1).length, group.length)} | ${percent(group.filter((row) => row.keepPar === 1).length, group.length)} | ${percent(group.filter((row) => row.plain > 0).length, group.length)} | ${percent(group.filter((row) => row.plain - row.plainLong > 0).length, group.length)} | ${percent(mean(group.filter((row) => row.lines).map((row) => row.plain / row.lines)) * 1000, 1000)} | ${percent(sum(all, (row) => row.botPar), botRuns)} | ${percent(sum(all, (row) => row.botLine), botRuns)} | ${percent(sum(all, (row) => row.botPlain), botRuns)} | ${percent(all.filter((row) => row.botPlain * 2 >= row.runs).length, all.length)} |`;
  };
  const table = (title, groups) => {
    console.log(`\n${title}:\n\n${header}`);
    for (const [name, group] of groups) if (group.length) console.log(line(name, group));
  };
  const by = (pick) => [...new Set(floors.map(pick))].sort().map((value) => [value, floors.filter((row) => pick(row) === value)]);
  table('By floor', [...by((row) => `Floor ${row.floor + 1}`), ['all', floors]]);
  table('By motif', by((row) => row.motif));
  table('By piece', by((row) => row.piece));
  table('By motif and piece', by((row) => `${row.motif} · ${row.piece}`));
  if (floors.some((row) => row.terrain)) {
    table('By how the floor met its terrain (src/composer.js "Terrain floors": composed around it, laid off the line, or none)', by((row) => `terrain ${row.terrain}`));
    console.log(`\nBot runs past par + 4 or failed: ${by((row) => `terrain ${row.terrain}`).map(([name, group]) => `${name} ${percent(sum(group, (row) => row.botPast), sum(group, (row) => row.runs))}`).join(', ')}; all ${percent(sum(floors, (row) => row.botPast), sum(floors, (row) => row.runs))}.`);
  }
  const loose = floors.filter((row) => !row.cut && row.plain > 0).sort((a, b) => b.botPlain / b.runs - a.botPlain / a.runs).slice(0, examples);
  if (loose.length) {
    console.log('\nFloors the bot most often pars off the idea (date, floor, piece, motif; planted line; a par win off the idea; bot runs at par off the idea):\n');
    for (const row of loose) console.log(`- ${row.date} floor ${row.floor + 1}, ${row.piece}, ${row.motif}: from ${row.start} planted "${row.route}"; off the idea "${row.example}"; ${row.botPlain}/${row.runs}`);
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
