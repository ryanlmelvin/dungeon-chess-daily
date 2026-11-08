// SPDX-License-Identifier: GPL-3.0-only
// Offline measurement: what a recruit steered like a Manual player would
// change, against today's Auto recruit. Read-only: it never writes
// src/editions.js or src/fallbacks.js.
//
// Part `cert` (certification). For a sample of real dates per (tier, piece),
// its modifiers represented (half plain, a quarter each ice and collapse, as
// scripts/measure-monsters.mjs samples them), it searches every candidate
// layout generation may try (ATTEMPTS) with the calibrated knobs, the tier's
// monsters and the production budget, twice: on Auto, exactly as generation
// certifies today, and steered (src/fairness.js RECRUIT_MODES 'steer': every
// floor's recruit may join and each action may carry an order, so it may take
// targets and the king). It replays generateDaily's choice (chooseCandidate,
// the adopted no-freebie rule from Tricky on) for each and reports the
// fallback share, and how often the first candidate certifies. It also
// searches each floor alone from its start with a steered recruit
// (findFloorRoute, QUICK_BUDGET transitions) to see whether a Manual player
// could clear it in under three moves (a freebie floor the Auto certificate
// never sees), and for steered certificates whether an Auto player is still
// covered: the same layout has an Auto route, or the steered route still wins
// with its orders left out.
//
// Part `floors` (recruit matching). On the first --floor-samples dates of
// each (tier, piece), first candidate only, every floor from its start (full
// lives, as if the floors before were cleared) with its recruit swapped for
// each piece in turn (same square), and once removed: the certificate search
// on that floor alone (--floor-budget transitions) on Auto (the recruit may
// join on every floor) and steered, and the human-like bot (src/human-bot.js,
// HUMAN_RUNS seeded runs, the same seeds for every swap) on Auto and with the
// steering policy of src/recruit-policy.js. It reports, per player piece
// and recruit piece, how much the recruit helps against none; the bot's floor
// success by tier and piece with the drawn recruit; and for a pawn recruit
// whether walls block its file (it can never promote by walking) and whether
// that matters.
//
// Part `placement` (on request). Two placement rules generation could add,
// priced on the same floors: the waiting recruit never attacks a target as
// the floor starts (so a Manual player can't take one on the turn it joins),
// and a pawn recruit waits only where its file is open to the far rank. Each
// moves the recruit to the first square generation could have drawn that
// keeps the rule, and plays the floor both ways.
//
//   node scripts/measure-recruits.mjs [--samples 24] [--floor-samples 12] [--start 2026-11-05]
//     [--jobs N] [--tiers a,b] [--pieces a,b] [--parts cert,floors,placement] [--floor-budget 6000] [--json file]
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getRawDaily } from '../src/edition.js';
import { ATTEMPTS, SEARCH_BUDGET, candidateFor, chooseCandidate, searchCandidate } from '../src/generation.js';
import { DIFFICULTY_TIERS, TIER_IDS, knobsFor, tierForDate, HUMAN_MOVE_CAP } from '../src/difficulty.js';
import { PIECES, PLAYABLE_PIECES } from '../src/pieces.js';
import { createGame, act, scoredMoves, recruitChoice, legalMoves } from '../src/rules.js';
import { hash } from '../src/random.js';
import { findFloorRoute, verifyWinningRoute } from '../src/fairness.js';
import { playFloor, runSeed, autoRecruit, HUMAN_RUNS } from '../src/human-bot.js';
import { steerRecruit } from '../src/recruit-policy.js';

// Budget of the per-floor search that looks for a steered clear in under three moves.
const QUICK_BUDGET = 3000;
const RECRUITS = ['none', ...PIECES];

/**
 * The start of `floor` on `candidate`'s layout, with every life: the floors
 * before it cleared at once, which leaves this floor exactly as a route
 * arriving there finds it (its layout is the seed's, and its monsters count
 * this floor's moves) except for lives and the run's move count.
 */
function floorStart(candidate, floor) {
  let state = createGame(candidate);
  while (state.floor < floor) {
    const cleared = structuredClone(state);
    cleared.enemies = []; cleared.exit = { ...cleared.exit, open: true };
    cleared.objective = { ...cleared.objective, complete: true, moves: 0 };
    state = act(cleared, { type: 'descend' });
  }
  return state;
}

const stripOrders = (actions) => actions.map(({ recruit, ...action }) => action);
const walkable = (state, x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 && state.map[y][x] !== '#';

// A pawn recruit on `tile`: is its file open to the far rank (it can promote by
// walking), and could it get there at all if a monster stood to be taken
// wherever it wanted to step diagonally?
function pawnLane(state, tile) {
  let open = true;
  for (let y = tile.y - 1; y >= 0; y--) if (!walkable(state, tile.x, y)) { open = false; break; }
  const seen = new Set([`${tile.x},${tile.y}`]);
  const queue = [{ x: tile.x, y: tile.y, moved: false }];
  let reachable = tile.y === 0;
  for (let index = 0; index < queue.length && !reachable; index++) {
    const { x, y, moved } = queue[index];
    const steps = [];
    if (walkable(state, x, y - 1)) {
      steps.push([x, y - 1]);
      if (!moved && y === 6 && walkable(state, x, y - 2)) steps.push([x, y - 2]);
    }
    for (const dx of [-1, 1]) if (walkable(state, x + dx, y - 1)) steps.push([x + dx, y - 1]);
    for (const [nx, ny] of steps) {
      if (ny === 0) { reachable = true; break; }
      if (!seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); queue.push({ x: nx, y: ny, moved: true }); }
    }
  }
  return { open, reachable };
}

// What the recruit did over a floor's frames; `joinCapture`: it took a target
// on the very turn it joined.
function recruitStats(frames) {
  const stats = { joined: false, targetCaptures: 0, captures: 0, promoted: false, hops: 0, cleared: false, joinCapture: false };
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1], after = frames[index];
    let last = null, joins = false;
    for (const event of after.events) {
      if (event.type === 'companion-recruit') { stats.joined = true; joins = true; }
      if (event.type === 'companion-promotion') stats.promoted = true;
      if (event.type === 'bishop-pair') stats.hops++;
      const target = (event.type === 'capture' || event.type === 'companion-capture')
        && before.enemies.find((foe) => foe.id === event.id)?.role === before.objective.piece;
      if (event.type === 'companion-capture') { stats.captures++; if (target) { stats.targetCaptures++; if (joins) stats.joinCapture = true; } }
      if (target) last = event.type;
    }
    if (!before.exit.open && after.exit.open && after.floor === before.floor && last === 'companion-capture') stats.cleared = true;
  }
  return stats;
}

// Could the waiting recruit take a target on the turn you join it with your
// first move? It moves before the monsters do, so that is every target it
// attacks from its square as the floor starts: a check generation could make.
function joinLine(start) {
  const item = start.items.find((entry) => entry.type === 'companion');
  const choice = item && recruitChoice(start, { type: 'move', x: item.x, y: item.y });
  if (!choice) return false;
  return choice.moves.some((tile) => tile.capture && choice.board.enemies.some((foe) => foe.x === tile.x && foe.y === tile.y && foe.role === choice.board.objective.piece));
}
function replayFrames(start, actions) {
  const frames = [start];
  for (const action of actions) frames.push(act(frames.at(-1), action));
  return frames;
}

function certTask({ date, tier, attempt }) {
  const base = getRawDaily(date);
  const candidate = candidateFor(base, tier, knobsFor(tier, base.playerPiece), attempt);
  const row = {};
  for (const recruit of ['auto', 'steer']) {
    const began = performance.now();
    const result = searchCandidate(candidate, SEARCH_BUDGET, { recruit });
    const entry = { status: result.status, explored: result.explored, ms: Math.round(performance.now() - began) };
    if (result.metrics) {
      const { threatenedDecisions, floorMoves, turns, livesLost } = result.metrics;
      entry.metrics = { threatenedDecisions, floorMoves, turns, livesLost };
      entry.score = result.score;
      // The capped human gap the tiers' bands judge (chooseCandidate treats a candidate without one as unmeasured).
      entry.gap = result.gap;
      if (recruit === 'steer') {
        entry.recruit = result.metrics.recruit;
        // Would the same moves still win with the recruit left to Auto (every floor's recruit may join)?
        entry.followable = verifyWinningRoute(createGame(candidate), stripOrders(result.actions), { recruit: 'auto', everyRecruit: true }).valid;
      }
    }
    row[recruit] = entry;
  }
  // Each floor alone, steered: a clear in under three moves is a freebie for a
  // Manual player. Did that clear take a target as the recruit joined, and
  // could the waiting recruit take one at the start?
  row.quick = []; row.quickJoin = []; row.line = [];
  for (let floor = 0; floor < 3; floor++) {
    const start = floorStart(candidate, floor);
    const found = findFloorRoute(start, { maxExpansions: QUICK_BUDGET, recruit: 'steer' });
    row.quick.push(found.status === 'solved' ? scoredMoves(found.state.records[floor]) : null);
    row.quickJoin.push(found.status === 'solved' && recruitStats(replayFrames(start, found.actions)).joinCapture);
    row.line.push(joinLine(start));
  }
  return row;
}

function floorTask({ date, tier, floor, recruit, budget }) {
  const base = getRawDaily(date);
  const candidate = candidateFor(base, tier, knobsFor(tier, base.playerPiece), 0);
  const original = floorStart(candidate, floor);
  const item = original.items.find((entry) => entry.type === 'companion');
  if (!item) return { skipped: true };
  const start = structuredClone(original);
  const own = start.items.find((entry) => entry.type === 'companion');
  if (recruit === 'none') start.items = start.items.filter((entry) => entry !== own);
  else own.piece = recruit;
  const row = { natural: item.piece, lane: pawnLane(original, item), line: recruit !== 'none' && joinLine(start), solver: {}, human: {} };
  for (const mode of recruit === 'none' ? ['auto'] : ['auto', 'steer']) {
    const began = performance.now();
    const found = findFloorRoute(start, { maxExpansions: budget, recruit: mode, everyRecruit: true });
    const entry = { solved: found.status === 'solved', explored: found.explored, ms: Math.round(performance.now() - began) };
    if (entry.solved) {
      entry.moves = scoredMoves(found.state.records[floor]);
      entry.recruit = recruitStats(replayFrames(start, found.actions));
    }
    row.solver[mode] = entry;
  }
  for (const [mode, policy] of recruit === 'none' ? [['auto', autoRecruit]] : [['auto', autoRecruit], ['steer', steerRecruit]]) {
    row.human[mode] = Array.from({ length: HUMAN_RUNS }, (_, run) => {
      const result = playFloor(start, { seed: runSeed(candidate, floor, run), recruit: policy, frames: true });
      return { won: result.won, moves: result.moves, livesLost: result.livesLost, ...recruitStats(result.frames) };
    });
  }
  return row;
}

// The squares generation could have drawn for this floor's recruit (setFloor):
// one move from the start for the floor's piece, never a monster's, an item's,
// a coin's (the king floor drops its coins later), the door's, or ice (it
// comes later too, and you would skid past the recruit), in an order seeded
// by the date and floor.
function recruitTiles(start, date) {
  const coins = [[4, 4], [2, 4], [6, 4]];
  return legalMoves(start).filter((tile) => !tile.capture && !tile.castle && !tile.borrowed && !(tile.x === start.exit.x && tile.y === start.exit.y)
    && !coins.some(([x, y]) => tile.x === x && tile.y === y) && !(start.ice ?? []).some((ice) => ice.x === tile.x && ice.y === tile.y)
    && !start.items.some((item) => item.type !== 'companion' && item.x === tile.x && item.y === tile.y))
    .map(({ x, y }) => ({ x, y, order: hash(`placement:${date}:${start.floor}:${x},${y}`) })).sort((a, b) => a.order - b.order);
}
function withRecruit(start, change) {
  const state = structuredClone(start);
  Object.assign(state.items.find((entry) => entry.type === 'companion'), change);
  return state;
}

// Two placement rules generation could add, priced on one floor: the waiting
// recruit never attacks a target as the floor starts (no capture on the turn
// it joins), and a pawn recruit waits only where its file is open to the far
// rank. Each moves the recruit to the first square generation could have
// drawn that keeps the rule, and plays the floor both ways.
function placeTask({ date, tier, floor, budget }) {
  const base = getRawDaily(date);
  const candidate = candidateFor(base, tier, knobsFor(tier, base.playerPiece), 0);
  const start = floorStart(candidate, floor);
  const item = start.items.find((entry) => entry.type === 'companion');
  if (!item) return { skipped: true };
  const tiles = recruitTiles(start, date);
  const play = (state, policies, solve = true) => {
    const found = solve ? findFloorRoute(state, { maxExpansions: budget, recruit: 'steer' }) : { status: 'skipped' };
    const out = { line: joinLine(state), solved: found.status === 'solved', moves: found.status === 'solved' ? scoredMoves(found.state.records[floor]) : null };
    for (const [mode, policy] of policies) {
      out[mode] = Array.from({ length: HUMAN_RUNS }, (_, run) => {
        const result = playFloor(state, { seed: runSeed(candidate, floor, run), recruit: policy });
        return { won: result.won, moves: result.moves };
      });
    }
    return out;
  };
  const both = [['auto', autoRecruit], ['steer', steerRecruit]];
  const row = { natural: item.piece, tiles: tiles.length, original: play(start, both) };
  if (row.original.line) {
    const tile = tiles.find((entry) => !joinLine(withRecruit(start, { x: entry.x, y: entry.y })));
    row.noLine = tile ? play(withRecruit(start, { x: tile.x, y: tile.y }), both) : null;
  }
  if (floor < 2) {
    const none = structuredClone(start);
    none.items = none.items.filter((entry) => entry.type !== 'companion');
    const lane = pawnLane(start, item);
    // The bot alone here: the pawn rule is about what a player gets from it.
    row.pawn = { lane, none: play(none, [['auto', autoRecruit]], false).auto, here: play(withRecruit(start, { piece: 'pawn' }), [['steer', steerRecruit]], false) };
    if (!lane.open) {
      const tile = tiles.find((entry) => pawnLane(start, entry).open);
      row.pawn.open = tile ? play(withRecruit(start, { piece: 'pawn', x: tile.x, y: tile.y }), [['steer', steerRecruit]], false) : null;
    }
  }
  return row;
}

// Static checks on one candidate layout, every floor (no search): its recruit
// as drawn and its square, for each piece whether a recruit there would take
// a target on the turn it joins, and a pawn recruit's file.
function staticTask({ date, tier, attempt }) {
  const base = getRawDaily(date);
  const candidate = candidateFor(base, tier, knobsFor(tier, base.playerPiece), attempt);
  return {
    floors: [0, 1, 2].map((floor) => {
      const start = floorStart(candidate, floor);
      const item = start.items.find((entry) => entry.type === 'companion');
      if (!item) return null;
      return { natural: item.piece, lane: pawnLane(start, item), lines: Object.fromEntries(PIECES.map((piece) => [piece, joinLine(withRecruit(start, { piece }))])) };
    }),
  };
}

if (!isMainThread) {
  parentPort.on('message', (task) => {
    const began = performance.now();
    const result = task.kind === 'cert' ? certTask(task) : task.kind === 'place' ? placeTask(task) : task.kind === 'static' ? staticTask(task) : floorTask(task);
    parentPort.postMessage({ id: task.id, ms: Math.round(performance.now() - began), ...result });
  });
} else {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
  const samples = Number(option('samples', '24'));
  const floorSamples = Number(option('floor-samples', '12'));
  const start = option('start', '2026-11-05');
  const jobs = Number(option('jobs', String(Math.max(1, availableParallelism() - 1))));
  const tiers = option('tiers', TIER_IDS.join(',')).split(',');
  const pieces = option('pieces', PLAYABLE_PIECES.join(',')).split(',');
  const parts = option('parts', 'cert,floors').split(',');
  const floorBudget = Number(option('floor-budget', '6000'));
  if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(floorSamples) || floorSamples < 0 || floorSamples > samples
    || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(jobs) || jobs < 1 || !Number.isInteger(floorBudget) || floorBudget < 1
    || tiers.some((tier) => !TIER_IDS.includes(tier)) || pieces.some((piece) => !PLAYABLE_PIECES.includes(piece))
    || parts.some((part) => !['cert', 'floors', 'placement', 'static'].includes(part))) {
    throw new Error('Usage: node scripts/measure-recruits.mjs [--samples N] [--floor-samples N] [--start YYYY-MM-DD] [--jobs N] [--tiers a,b] [--pieces a,b] [--parts cert,floors,placement,static] [--floor-budget N] [--json file]');
  }

  // Dates per (tier, piece), as scripts/measure-monsters.mjs picks them.
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
  // The floor study takes its dates from each cell's, with the same modifier quota.
  const floorQuota = { none: Math.ceil(floorSamples / 2), ice: Math.floor(floorSamples / 4) };
  floorQuota.collapse = floorSamples - floorQuota.none - floorQuota.ice;
  for (const cell of cells.values()) {
    cell.floorDates = [];
    for (const entry of cell.dates) if (cell.floorDates.filter((other) => other.modifier === entry.modifier).length < (floorQuota[entry.modifier] ?? 0)) cell.floorDates.push(entry);
    for (const entry of cell.dates) if (cell.floorDates.length < floorSamples && !cell.floorDates.includes(entry)) cell.floorDates.push(entry);
  }

  const tasks = [];
  if (parts.includes('floors')) {
    for (const cell of cells.values()) for (const { date } of cell.floorDates) for (let floor = 0; floor < 3; floor++) for (const recruit of RECRUITS) {
      tasks.push({ id: tasks.length, kind: 'floor', tier: cell.tier, piece: cell.piece, date, floor, recruit, budget: floorBudget });
    }
  }
  if (parts.includes('placement')) {
    for (const cell of cells.values()) for (const { date } of cell.floorDates) for (let floor = 0; floor < 3; floor++) {
      tasks.push({ id: tasks.length, kind: 'place', tier: cell.tier, piece: cell.piece, date, floor, budget: floorBudget });
    }
  }
  if (parts.includes('static')) {
    for (const cell of cells.values()) for (const { date } of cell.dates) for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      tasks.push({ id: tasks.length, kind: 'static', tier: cell.tier, piece: cell.piece, date, attempt });
    }
  }
  if (parts.includes('cert')) {
    for (const cell of cells.values()) for (const { date, modifier } of cell.dates) for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      tasks.push({ id: tasks.length, kind: 'cert', tier: cell.tier, piece: cell.piece, date, modifier, attempt });
    }
  }
  console.log(`Running ${tasks.length} tasks (${cells.size} tier/piece cells; ${parts.join(', ')}) on ${jobs} workers…`);
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
      if (++done % 500 === 0 || done === tasks.length) console.log(`  ${done}/${tasks.length} (${Math.round((Date.now() - began) / 1000)} s)`);
      feed();
    });
    worker.on('error', reject);
    feed();
  })));

  const pct = (count, total) => (total ? `${Math.round((100 * count) / total)}%` : '–');
  const num = (value, digits = 1) => (value === null || Number.isNaN(value) ? '–' : `${Math.round(value * 10 ** digits) / 10 ** digits}`);
  const signed = (value, digits = 1) => (value === null || Number.isNaN(value) ? '–' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${num(Math.abs(value), digits)}`);
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const table = (header, rows) => [`| ${header.join(' | ')} |`, `|${' --- |'.repeat(header.length)}`, ...rows.map((cells) => `| ${cells.join(' | ')} |`)].join('\n');
  const ruled = (tier) => DIFFICULTY_TIERS[tier].minFloorMoves > 0;
  const tierName = (tier) => DIFFICULTY_TIERS[tier].name;
  const groups = (by) => [...tiers.map((tier) => [tierName(tier), (row) => by(row) === tier]),
    ...(tiers.filter(ruled).length > 1 ? [[tiers.filter(ruled).map(tierName).join('–'), (row) => ruled(by(row))]] : []), ['All', () => true]];

  if (parts.includes('cert')) {
    // One entry per date: its candidates' Auto and steered searches.
    const days = new Map();
    tasks.forEach((task, index) => {
      if (task.kind !== 'cert') return;
      const day = days.get(task.date) ?? { tier: task.tier, piece: task.piece, date: task.date, modifier: task.modifier, rows: [] };
      day.rows[task.attempt] = results[index];
      days.set(task.date, day);
    });
    const freebie = (moves) => moves !== null && moves < 3;
    for (const day of days.values()) {
      const { minThreatenedDecisions } = knobsFor(day.tier, day.piece);
      const auto = day.rows.map((row) => row.auto), steer = day.rows.map((row) => row.steer);
      day.autoChosen = chooseCandidate(auto, day.tier, minThreatenedDecisions);
      day.steerChosen = chooseCandidate(steer, day.tier, minThreatenedDecisions);
      day.steerNoRule = chooseCandidate(steer, day.tier, minThreatenedDecisions, 0);
      day.autoNoRule = chooseCandidate(auto, day.tier, minThreatenedDecisions, 0);
      // Auto certification that also rejects a layout a steered recruit clears in under three moves (Tricky and up).
      day.closedChosen = ruled(day.tier) ? chooseCandidate(auto.map((entry, index) => (day.rows[index].quick.some(freebie) ? null : entry)), day.tier, minThreatenedDecisions) : day.autoChosen;
      const chosen = day.autoChosen >= 0 ? day.rows[day.autoChosen] : null;
      day.manualFreebie = chosen ? chosen.quick.map(freebie) : null;
      const steered = day.steerChosen >= 0 ? day.rows[day.steerChosen] : null;
      day.steerRisk = steered ? {
        autoRoute: steered.auto.status === 'solved', followable: steered.steer.followable === true,
        targetCaptures: steered.steer.recruit?.targetCaptures ?? 0, clears: steered.steer.recruit?.clears ?? 0,
      } : null;
    }
    const all = [...days.values()];
    const certRow = (list) => {
      const accepted = list.filter((day) => day.autoChosen >= 0);
      const steered = list.filter((day) => day.steerChosen >= 0);
      const exposed = accepted.filter((day) => day.manualFreebie.some(Boolean));
      const kingFloor = accepted.filter((day) => day.manualFreebie[2]);
      const candidates = list.flatMap((day) => day.rows);
      const ms = (mode) => mean(candidates.map((row) => row[mode].ms));
      return [
        `${list.length}`,
        `${pct(list.filter((day) => day.rows[0].auto.status === 'solved').length, list.length)} / ${pct(list.filter((day) => day.rows[0].steer.status === 'solved').length, list.length)}`,
        `${pct(candidates.filter((row) => row.auto.status === 'solved').length, candidates.length)} / ${pct(candidates.filter((row) => row.steer.status === 'solved').length, candidates.length)}`,
        pct(list.length - accepted.length, list.length), pct(list.length - steered.length, list.length),
        `${pct(list.filter((day) => day.autoNoRule < 0).length, list.length)} / ${pct(list.filter((day) => day.steerNoRule < 0).length, list.length)}`,
        `${pct(exposed.length, accepted.length)} (${pct(kingFloor.length, accepted.length)})`,
        pct(list.filter((day) => day.closedChosen < 0).length, list.length),
        pct(steered.filter((day) => day.steerRisk.targetCaptures > 0).length, steered.length),
        pct(steered.filter((day) => !day.steerRisk.autoRoute && !day.steerRisk.followable).length, steered.length),
        `${Math.round(ms('auto'))} / ${Math.round(ms('steer'))}`,
      ];
    };
    const certHeader = ['Group', 'Days', 'Cand. 1 solved, Auto / steered', 'Any cand. solved, Auto / steered', 'Fallback, Auto', 'Fallback, steered',
      'Fallback without the freebie rule, Auto / steered', 'Auto days a steered recruit clears a floor in <3 (king floor)', 'Fallback, Auto + no steered freebie',
      'Steered days whose route takes a target with the recruit', 'Steered days with no Auto route', 'ms per search, Auto / steered'];
    console.log(`\n## Certification, Auto against steered (${samples} dates per tier and piece from ${start}, ${ATTEMPTS} candidates, adopted rules)\n`);
    console.log(table(certHeader, groups((day) => day.tier).map(([name, test]) => [name, ...certRow(all.filter(test))])));
    console.log('');
    console.log(table(['Piece', ...certHeader.slice(1)], pieces.map((piece) => [piece, ...certRow(all.filter((day) => day.piece === piece))])));
    console.log('');
    console.log(table(['Tier · piece', ...certHeader.slice(1)], [...cells.values()].map((cell) => [`${tierName(cell.tier)} · ${cell.piece}`, ...certRow(all.filter((day) => day.tier === cell.tier && day.piece === cell.piece))])));
    // Which floors a steered recruit makes quick, over every searched candidate.
    const quickRow = (list) => {
      const rows = list.flatMap((day) => day.rows);
      const floors = rows.flatMap((row) => [0, 1, 2].map((floor) => ({ quick: freebie(row.quick[floor]), join: row.quickJoin[floor], line: row.line[floor] })));
      const quick = floors.filter((entry) => entry.quick);
      return [0, 1, 2].map((floor) => pct(rows.filter((row) => freebie(row.quick[floor])).length, rows.length)).concat(
        [0, 1, 2].map((floor) => pct(rows.filter((row) => row.quick[floor] === 1).length, rows.length)),
        [0, 1, 2].map((floor) => pct(rows.filter((row) => row.line[floor]).length, rows.length)),
        [pct(quick.filter((entry) => entry.join).length, quick.length), pct(quick.filter((entry) => !entry.line).length, quick.length)]);
    };
    console.log(`\nShare of searched layouts where a steered recruit clears a floor (searched alone, ${QUICK_BUDGET} transitions) in under three moves, and in one; where the waiting recruit already attacks a target as the floor starts (it takes it on the turn it joins); and of the quick floors, how many took a target as the recruit joined, and how many had no such line at the start:\n`);
    console.log(table(['Group', '<3 F1', '<3 F2', '<3 F3', '1 move F1', '1 move F2', '1 move F3', 'line F1', 'line F2', 'line F3', 'quick: recruit takes a target as it joins', 'quick: no line at the start'], [
      ...groups((day) => day.tier).map(([name, test]) => [name, ...quickRow(all.filter(test))]),
      ...pieces.map((piece) => [piece, ...quickRow(all.filter((day) => day.piece === piece))])]));
  }

  if (parts.includes('floors')) {
    const floors = tasks.flatMap((task, index) => (task.kind === 'floor' && !results[index].skipped ? [{ ...task, ...results[index] }] : []));
    // Every (date, floor) with its recruit swaps.
    const spots = new Map();
    for (const row of floors) {
      const key = `${row.date}:${row.floor}`;
      const spot = spots.get(key) ?? { date: row.date, tier: row.tier, piece: row.piece, floor: row.floor, swaps: {} };
      spot.swaps[row.recruit] = row;
      spot.natural = row.natural; spot.lane = row.lane;
      spots.set(key, spot);
    }
    const complete = [...spots.values()].filter((spot) => RECRUITS.every((recruit) => spot.swaps[recruit]));
    const runsOf = (row, mode) => row.human[mode] ?? [];
    const expected = (runs) => mean(runs.map((run) => (run.won ? run.moves : HUMAN_MOVE_CAP)));
    // One recruit swap against none over a list of spots.
    const help = (list, recruit) => {
      const n = list.length;
      const solved = (mode, swap = recruit) => list.filter((spot) => spot.swaps[swap].solver[mode]?.solved).length;
      const paired = (mode) => list.filter((spot) => spot.swaps[recruit].solver[mode]?.solved && spot.swaps.none.solver.auto.solved)
        .map((spot) => spot.swaps[recruit].solver[mode].moves - spot.swaps.none.solver.auto.moves);
      const wins = (mode, swap = recruit) => list.flatMap((spot) => runsOf(spot.swaps[swap], mode)).filter((run) => run.won).length;
      const runs = n * HUMAN_RUNS;
      const exp = (mode, swap = recruit) => mean(list.map((spot) => expected(runsOf(spot.swaps[swap], mode))));
      const none = exp('auto', 'none');
      return {
        n, solverNone: solved('auto', 'none') / n, solverAuto: solved('auto') / n, solverSteer: solved('steer') / n,
        movesAuto: mean(paired('auto')), movesSteer: mean(paired('steer')),
        humanNone: wins('auto', 'none') / runs, humanAuto: wins('auto') / runs, humanSteer: wins('steer') / runs,
        expAuto: n ? exp('auto') - none : null, expSteer: n ? exp('steer') - none : null, expNone: none,
        quick: list.filter((spot) => (spot.swaps[recruit].solver.steer?.moves ?? 99) < 3).length / n,
        line: list.filter((spot) => spot.swaps[recruit].line).length / n,
        joined: list.flatMap((spot) => runsOf(spot.swaps[recruit], 'steer')).filter((run) => run.joined).length / runs,
        recruitClears: list.flatMap((spot) => runsOf(spot.swaps[recruit], 'steer')).filter((run) => run.cleared).length / runs,
        promoted: list.flatMap((spot) => runsOf(spot.swaps[recruit], 'steer')).filter((run) => run.promoted).length / runs,
      };
    };
    const percent = (value) => (Number.isFinite(value) ? `${Math.round(100 * value)}%` : '–');
    // A hint for reading the table: a recruit that costs the bot (runs won down
    // 5 points, or a move more on average), or that adds next to nothing.
    const flag = (entry) => {
      const gain = Math.max(entry.humanSteer - entry.humanNone, entry.solverSteer - entry.solverNone);
      const loss = Math.min(entry.humanAuto - entry.humanNone, entry.humanSteer - entry.humanNone);
      if (loss <= -0.05 || entry.expSteer >= 1) return 'harmful';
      if (gain < 0.03 && entry.expSteer > -1) return 'null';
      return '';
    };
    const matchRows = (list, recruits) => pieces.flatMap((piece) => recruits(piece).map((recruit) => {
      const entry = help(list.filter((spot) => spot.piece === piece), recruit);
      return [piece, recruit, `${entry.n}`,
        `${percent(entry.solverNone)} / ${percent(entry.solverAuto)} / ${percent(entry.solverSteer)}`,
        `${signed(entry.movesAuto)} / ${signed(entry.movesSteer)}`, percent(entry.quick), percent(entry.line),
        `${percent(entry.humanNone)} / ${percent(entry.humanAuto)} / ${percent(entry.humanSteer)}`,
        `${num(entry.expNone)} → ${signed(entry.expAuto)} / ${signed(entry.expSteer)}`, percent(entry.joined), percent(entry.recruitClears), flag(entry)];
    }));
    const matchHeader = ['Player', 'Recruit', 'Floors', 'Solver solved: none / Auto / steered', 'Solver moves vs none: Auto / steered',
      'Steered clear in <3', 'Takes a target as it joins', 'Bot runs won: none / Auto / steered', 'Bot expected moves: none → Auto / steered',
      'Steered runs that recruit', 'Steered runs the recruit clears', 'Flag'];
    console.log(`\n## Recruit matching (${floorSamples} dates per tier and piece, first candidate; floor search ${floorBudget} transitions; bot ${HUMAN_RUNS} runs, a failed run counts ${HUMAN_MOVE_CAP} moves)\n`);
    console.log('Floors 1 and 2 (any recruit today):\n');
    console.log(table(matchHeader, matchRows(complete.filter((spot) => spot.floor < 2), () => PIECES)));
    console.log('\nKing floor (always a king today; the rest are what-ifs):\n');
    console.log(table(matchHeader, matchRows(complete.filter((spot) => spot.floor === 2), () => PIECES)));

    // The bot's floor success with the recruit as drawn: no recruit, Auto, steered.
    const drawn = (spot) => spot.swaps[spot.natural];
    const botRow = (list) => [0, 1, 2].map((floor) => {
      const here = list.filter((spot) => spot.floor === floor);
      const won = (mode, pick) => here.flatMap((spot) => runsOf(pick(spot), mode)).filter((run) => run.won).length;
      const runs = here.length * HUMAN_RUNS;
      return `${pct(won('auto', (spot) => spot.swaps.none), runs)} / ${pct(won('auto', drawn), runs)} / ${pct(won('steer', drawn), runs)}`;
    }).concat([0, 1, 2].map((floor) => {
      const here = list.filter((spot) => spot.floor === floor);
      return `${num(mean(here.map((spot) => expected(runsOf(drawn(spot), 'auto')))))} / ${num(mean(here.map((spot) => expected(runsOf(drawn(spot), 'steer')))))}`;
    }));
    const botHeader = ['Group', 'Dates', 'F1 runs won: none / Auto / steered', 'F2', 'F3', 'F1 expected moves: Auto / steered', 'F2', 'F3'];
    console.log('\n## The human-like bot with the drawn recruit: none, Auto, steered\n');
    const dates = (list) => `${new Set(list.map((spot) => spot.date)).size}`;
    console.log(table(botHeader, [
      ...groups((spot) => spot.tier).map(([name, test]) => { const list = complete.filter(test); return [name, dates(list), ...botRow(list)]; }),
      ...pieces.map((piece) => { const list = complete.filter((spot) => spot.piece === piece); return [piece, dates(list), ...botRow(list)]; }),
    ]));
    console.log('');
    console.log(table(['Tier · piece', ...botHeader.slice(1)], [...cells.values()].map((cell) => {
      const list = complete.filter((spot) => spot.tier === cell.tier && spot.piece === cell.piece);
      return [`${tierName(cell.tier)} · ${cell.piece}`, dates(list), ...botRow(list)];
    })));

    // Pawn recruits: walled files, and whether it matters.
    console.log('\n## Pawn recruits: can they promote?\n');
    const laneRow = (list) => [`${list.length}`, pct(list.filter((spot) => !spot.lane.open).length, list.length), pct(list.filter((spot) => !spot.lane.reachable).length, list.length)];
    console.log(table(['Player · floors', 'Recruit squares', 'File walled before the far rank', 'Far rank unreachable even taking diagonally'], [
      ...pieces.flatMap((piece) => [['1–2', (spot) => spot.floor < 2], ['3', (spot) => spot.floor === 2]].map(([label, test]) => [`${piece} · ${label}`, ...laneRow(complete.filter((spot) => spot.piece === piece && test(spot)))])),
      ['all · 1–2', ...laneRow(complete.filter((spot) => spot.floor < 2))]]));
    const pawnHelp = (list) => {
      const entry = help(list, 'pawn');
      return [`${entry.n}`, `${percent(entry.solverNone)} / ${percent(entry.solverSteer)}`, `${percent(entry.humanNone)} / ${percent(entry.humanAuto)} / ${percent(entry.humanSteer)}`,
        `${signed(entry.expAuto)} / ${signed(entry.expSteer)}`, percent(entry.promoted), percent(entry.recruitClears)];
    };
    const early = complete.filter((spot) => spot.floor < 2);
    console.log('');
    console.log(table(['A pawn recruit on floors 1–2 whose file is', 'Floors', 'Solver solved: none / steered', 'Bot runs won: none / Auto / steered', 'Bot expected moves vs none: Auto / steered', 'Steered runs it promotes', 'Steered runs it clears the floor'], [
      ['open to the far rank', ...pawnHelp(early.filter((spot) => spot.lane.open))],
      ['walled', ...pawnHelp(early.filter((spot) => !spot.lane.open))]]));
  }
  if (parts.includes('static')) {
    const layouts = tasks.flatMap((task, index) => (task.kind === 'static' ? results[index].floors.map((entry, floor) => entry && { ...entry, floor, piece: task.piece, tier: task.tier }).filter(Boolean) : []));
    console.log(`\n## Static checks on every searched candidate (${samples} dates per tier and piece × ${ATTEMPTS} candidates)\n`);
    console.log('Share of recruit squares where a recruit of each piece would take a target on the turn it joins (it attacks one as the floor starts), with the recruit as drawn last; and where a pawn recruit there would find its file walled, or the far rank out of reach even taking diagonally:\n');
    const staticRow = (list) => [`${list.length}`, ...PIECES.map((piece) => pct(list.filter((entry) => entry.lines[piece]).length, list.length)),
      pct(list.filter((entry) => entry.lines[entry.natural]).length, list.length), pct(list.filter((entry) => !entry.lane.open).length, list.length), pct(list.filter((entry) => !entry.lane.reachable).length, list.length)];
    console.log(table(['Player · floors', 'Squares', ...PIECES.map((piece) => `line: ${piece}`), 'line: as drawn', 'pawn file walled', 'pawn far rank unreachable'], [
      ...pieces.flatMap((piece) => [['1', (entry) => entry.floor === 0], ['2', (entry) => entry.floor === 1], ['3', (entry) => entry.floor === 2]]
        .map(([label, test]) => [`${piece} · ${label}`, ...staticRow(layouts.filter((entry) => entry.piece === piece && test(entry)))])),
      ['all · 1–2', ...staticRow(layouts.filter((entry) => entry.floor < 2))], ['all · 3', ...staticRow(layouts.filter((entry) => entry.floor === 2))]]));
  }
  if (parts.includes('placement')) {
    const placed = tasks.flatMap((task, index) => (task.kind === 'place' && !results[index].skipped ? [{ ...task, ...results[index] }] : []));
    const won = (runs) => runs.filter((run) => run.won).length;
    const expected = (runs) => mean(runs.map((run) => (run.won ? run.moves : HUMAN_MOVE_CAP)));
    const quick = (entry) => entry.solved && entry.moves < 3;
    console.log(`\n## Placement what-ifs (${floorSamples} dates per tier and piece, first candidate; the recruit moved to the first square generation could have drawn that keeps the rule)\n`);
    const lineRow = (label, list) => {
      const lined = list.filter((row) => row.original.line), moved = lined.filter((row) => row.noLine);
      const runs = (pick, mode) => moved.flatMap((row) => pick(row)[mode]);
      return [label, `${list.length}`, pct(lined.length, list.length), pct(moved.length, lined.length),
        `${pct(moved.filter((row) => quick(row.original)).length, moved.length)} → ${pct(moved.filter((row) => quick(row.noLine)).length, moved.length)}`,
        `${pct(won(runs((row) => row.original, 'auto')), runs((row) => row.original, 'auto').length)} → ${pct(won(runs((row) => row.noLine, 'auto')), runs((row) => row.noLine, 'auto').length)}`,
        `${pct(won(runs((row) => row.original, 'steer')), runs((row) => row.original, 'steer').length)} → ${pct(won(runs((row) => row.noLine, 'steer')), runs((row) => row.noLine, 'steer').length)}`,
        `${num(mean(moved.map((row) => expected(row.original.steer))))} → ${num(mean(moved.map((row) => expected(row.noLine.steer))))}`];
    };
    console.log('No waiting recruit attacks a target as the floor starts (so none is taken on the turn it joins):\n');
    console.log(table(['Floors', 'n', 'Recruit attacks a target at the start', 'A square without that line exists', 'Steered clear in <3: as drawn → moved', 'Bot runs won, Auto: as drawn → moved', 'Bot runs won, steered: as drawn → moved', 'Bot expected moves, steered'], [
      lineRow('F1', placed.filter((row) => row.floor === 0)), lineRow('F2', placed.filter((row) => row.floor === 1)), lineRow('F3 (king)', placed.filter((row) => row.floor === 2)),
      ...pieces.map((piece) => lineRow(`all · ${piece}`, placed.filter((row) => row.piece === piece)))]));
    const pawnRows = placed.filter((row) => row.pawn);
    const walled = pawnRows.filter((row) => !row.pawn.lane.open), fixed = walled.filter((row) => row.pawn.open);
    const steerRuns = (list, pick) => list.flatMap((row) => pick(row)?.steer ?? []);
    const noneRuns = (list) => list.flatMap((row) => row.pawn.none);
    console.log('\nA pawn recruit only where its file is open to the far rank (floors 1–2, every floor given a pawn recruit):\n');
    console.log(table(['Pawn recruit', 'Floors', 'Bot runs won: none / pawn steered', 'Bot expected moves: none / pawn steered'], [
      ['file open as drawn', `${pawnRows.length - walled.length}`, `${pct(won(noneRuns(pawnRows.filter((row) => row.pawn.lane.open))), noneRuns(pawnRows.filter((row) => row.pawn.lane.open)).length)} / ${pct(won(steerRuns(pawnRows.filter((row) => row.pawn.lane.open), (row) => row.pawn.here)), steerRuns(pawnRows.filter((row) => row.pawn.lane.open), (row) => row.pawn.here).length)}`,
        `${num(mean(pawnRows.filter((row) => row.pawn.lane.open).map((row) => expected(row.pawn.none))))} / ${num(mean(pawnRows.filter((row) => row.pawn.lane.open).map((row) => expected(row.pawn.here.steer))))}`],
      ['walled as drawn', `${walled.length}`, `${pct(won(noneRuns(walled)), noneRuns(walled).length)} / ${pct(won(steerRuns(walled, (row) => row.pawn.here)), steerRuns(walled, (row) => row.pawn.here).length)}`,
        `${num(mean(walled.map((row) => expected(row.pawn.none))))} / ${num(mean(walled.map((row) => expected(row.pawn.here.steer))))}`],
      [`walled, moved to an open file (${pct(fixed.length, walled.length)} could be)`, `${fixed.length}`, `${pct(won(noneRuns(fixed)), noneRuns(fixed).length)} / ${pct(won(steerRuns(fixed, (row) => row.pawn.here)), steerRuns(fixed, (row) => row.pawn.here).length)} → ${pct(won(steerRuns(fixed, (row) => row.pawn.open)), steerRuns(fixed, (row) => row.pawn.open).length)}`,
        `${num(mean(fixed.map((row) => expected(row.pawn.none))))} / ${num(mean(fixed.map((row) => expected(row.pawn.here.steer))))} → ${num(mean(fixed.map((row) => expected(row.pawn.open.steer))))}`],
    ]));
  }
  console.log(`\nWall ${Math.round((Date.now() - began) / 1000)} s on ${jobs} workers.`);
  const jsonPath = option('json');
  if (jsonPath) {
    await writeFile(jsonPath, JSON.stringify({ generated: new Date().toISOString(), start, samples, floorSamples, floorBudget, quickBudget: QUICK_BUDGET,
      cells: [...cells.values()].map(({ tier, piece, dates, floorDates }) => ({ tier, piece, dates, floorDates })),
      rows: tasks.map((task, index) => ({ ...task, ...results[index], id: undefined })) }));
    console.log(`Wrote ${tasks.length} rows to ${jsonPath}.`);
  }
}
