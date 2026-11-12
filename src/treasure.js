// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Treasure: an optional chest off each composed floor's planted line, as a
// second, harder goal on the same room. Par stays the planted line plus one;
// the chest asks for a win within par that also lands on its square before
// the door opens. Taking it earns the floor's treasure mark, at any score
// (src/rules.js treasureMark).
//
// The composer calls placeTreasure once a floor's room, line and hint are
// settled (composeDay's `treasure` option). Monsters are deterministic, so
// every win within par can be counted exactly (parWins). A square qualifies
// when at least one of them lands on it before the move that completes the
// challenge, and it passes two checks:
//   - it costs the spare move: no win that scores the planted line's length
//     takes a chest there (a capture counted as the move it costs), so the
//     choice is always "under par, or even with treasure";
//   - plain sensible play doesn't stumble on it: the human-like bot, which
//     knows nothing of chests, takes it and still makes par in at most
//     TREASURE_BOT.share of its runs.
// Of the squares that pass, the one the fewest par wins pass through is kept,
// ties broken by a seeded stream of its own. Nothing else in the room
// changes: monsters and the recruit ignore a chest as they do a coin, so the
// planted line and every check made on the room still hold (composeDay proves
// the day again with its chests in).
import { act, floorScoredMoves, chestTaken } from './rules.js';
import { routeTransition, positionKey } from './fairness.js';
import { hash, random } from './random.js';
import { playFloor, HUMAN_RUNS } from './human-bot.js';

/** Search steps a floor's count of par wins may take; past it the floor gets no chest. */
export const TREASURE_BUDGET = 400_000;
/**
 * The accident check: of the human-like bot's `runs` seeded runs of a floor,
 * at most `share` may take the chest and still make par. One batch of runs
 * covers every square, since the bot's play doesn't depend on a chest.
 */
export const TREASURE_BOT = Object.freeze({ runs: HUMAN_RUNS, share: 1 / 10 });

const EXIT = Object.freeze({ x: 4, y: 0 });
const HOME = Object.freeze({ x: 4, y: 6 });
const index = (tile) => tile.y * 8 + tile.x;
const chestAt = (square) => ({ x: square % 8, y: square >> 3, type: 'chest' });
const isTarget = (state, foe) => (foe.role ?? foe.piece) === state.objective.piece;
const takesChest = (state) => state.events.some((event) => event.type === 'pickup' && event.chest);

// A step of play as a person may make it: any action that keeps the run on
// its floor. A capture of the player is allowed (it costs a move).
function played(state, action) {
  const next = act(state, action);
  return next === state || next.status !== 'playing' || next.floor !== state.floor || next.events.some((event) => event.type === 'restart') ? null : next;
}

/**
 * Every win within `par` scored moves from `start` (a floor's start, on the
 * room without its hint powerups, as the planted line is searched), counted
 * exactly: `wins`; `through[square]` (y * 8 + x), how many of them land on
 * that square before the move that completes the challenge; and
 * `last[square]`, how many end on a move that would still take a chest there
 * (a mate, or a floor the recruit's reply clears, lands with the door shut;
 * the rules themselves are asked). Each step is a certificate step
 * (src/fairness.js routeTransition: no power used, no floor 1–2 recruit, as
 * `actionsFrom` leaves them out) and is never captured, a pawn's included: a
 * chest line is a clean line, as a planted one is. With `hits` a line may
 * absorb captures as a player's may, each costing a scored move.
 * `line(square)` returns one win that lands on `square` before its last move,
 * or null. `cut` when the search passed `budget` steps (the counts are then
 * incomplete).
 */
export function parWins(start, par, { actionsFrom, budget = TREASURE_BUDGET, hits = false } = {}) {
  const memo = new Map();
  const royal = start.floor === 2;
  let steps = 0, cut = false, limit = budget;
  // The moves a floor still needs at least: one per target left (the recruit never takes one on a route).
  const needs = (state) => (royal ? 1 : state.enemies.reduce((count, foe) => count + (isTarget(state, foe) ? 1 : 0), 0));
  // Each way on from `state`: its action, the position after it, what it costs and where the move landed (-1 for a wait).
  const ways = (state, left) => {
    const out = [];
    // With as many moves left as targets, every move must take one (a pawn may also take in passing, so it tries them all).
    const mustTake = !royal && state.player.piece !== 'pawn' && needs(state) === left;
    for (const action of actionsFrom(state)) {
      if (mustTake && !(action.type === 'move' && state.enemies.some((foe) => foe.x === action.x && foe.y === action.y && isTarget(state, foe)))) continue;
      if (steps++ > limit) { cut = true; break; }
      const next = hits ? played(state, action) : routeTransition(state, action);
      if (!next) continue;
      const cost = 1 + next.hits - state.hits;
      if (cost > (hits ? left : 1)) continue;
      const moved = action.type === 'move' ? next.events.find((event) => event.type === 'move') : null;
      out.push({ action, next, cost, landed: moved ? index(moved) : -1 });
    }
    return out;
  };
  // Would a chest on the square a winning move comes to rest on be taken by that move?
  const takenAtLast = (state, action, square) => {
    const next = act({ ...state, items: [...state.items, chestAt(square)] }, action);
    return next !== state && takesChest(next);
  };
  const NONE = Object.freeze({ wins: 0, through: null, last: null });
  const solve = (state, left) => {
    if (cut || needs(state) > left) return NONE;
    const key = `${left}|${positionKey(state)}`;
    const known = memo.get(key);
    if (known) return known;
    let wins = 0, through = null, last = null;
    for (const { action, next, cost, landed } of ways(state, left)) {
      if (next.exit.open) {
        wins++;
        if (landed >= 0 && takenAtLast(state, action, landed)) { last ??= new Array(64).fill(0); last[landed]++; }
        continue;
      }
      const after = solve(next, left - cost);
      if (!after.wins) continue;
      wins += after.wins;
      through ??= new Array(64).fill(0);
      for (let square = 0; square < 64; square++) through[square] += square === landed ? after.wins : after.through?.[square] ?? 0;
      if (after.last) {
        last ??= new Array(64).fill(0);
        // A chest taken on this move is gone by the last one.
        for (let square = 0; square < 64; square++) if (square !== landed) last[square] += after.last[square];
      }
    }
    const result = wins ? { wins, through, last } : NONE;
    if (!cut) memo.set(key, result);
    return result;
  };
  const all = solve(start, par);
  // Reading a line back out retraces counted steps, so it spends no budget.
  limit = Infinity;
  // One win through `square`: at each step the first way on that still has one.
  const line = (square) => {
    const actions = [];
    let state = start, left = par, taken = false;
    while (!state.exit.open) {
      const way = ways(state, left).find(({ next, landed, cost }) => {
        if (next.exit.open) return taken;
        const after = solve(next, left - cost);
        return taken || landed === square ? after.wins > 0 : (after.through?.[square] ?? 0) > 0;
      });
      if (!way || cut) return null;
      actions.push(way.action);
      taken ||= way.landed === square;
      state = way.next; left -= way.cost;
    }
    return actions;
  };
  return { wins: all.wins, through: all.through ?? new Array(64).fill(0), last: all.last ?? new Array(64).fill(0), line, cut, steps };
}

/**
 * How often plain sensible play earns each square's mark: `marks[square]`,
 * how many of the human-like bot's seeded runs from `start` take a chest
 * there and still make `par`. `start` is the floor's start as played, a chest
 * laid on every square asked about: the bot sees no chest (src/human-bot.js
 * observe) and a chest moves no monster, so one batch of runs answers for
 * them all, each pickup as the rules made it. `seedOf(run)` is each run's seed.
 */
export function botMarks(start, par, seedOf, runs = TREASURE_BOT.runs) {
  const marks = new Array(64).fill(0);
  for (let run = 0; run < runs; run++) {
    const result = playFloor(start, { seed: seedOf(run), cap: par + 1, frames: true });
    if (!result.won || result.moves > par) continue;
    for (const frame of result.frames.slice(1)) for (const event of frame.events) if (event.type === 'pickup' && event.chest) marks[index(event)]++;
  }
  return marks;
}

// The squares a room's chest may not lie on: walls, the start, the exit, a monster's or an
// item's square, ice (as no pickup lies on ice), a cracked tile or a gate, and every square the planted line moves to
// or comes to rest on (`states`, its positions).
function taken(room, line, states) {
  const squares = new Set([room.start ?? HOME, EXIT, ...room.enemies, ...room.items, ...(room.ice ?? []), ...(room.cracks ?? []), ...(room.gates ?? []),
    ...line.filter((action) => action.type === 'move'), ...states.map((state) => state.player)].map(index));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (room.map[y][x] === '#') squares.add(y * 8 + x);
  return squares;
}

// The planted line's positions from `start`, or null if it doesn't play.
function positions(start, line) {
  const states = [start];
  for (const action of line) {
    const next = routeTransition(states.at(-1), action);
    if (!next) return null;
    states.push(next);
  }
  return states;
}

/** Does `line` win the floor from `start` as played, never captured, within `par`, its chest taken? */
export function takesTreasure(start, line, par) {
  let state = start;
  for (const action of line) {
    const next = act(state, action);
    if (next === state || next.hits > state.hits || next.events.some((event) => event.type === 'restart')) return false;
    state = next;
  }
  return state.exit.open && floorScoredMoves(state) <= par && chestTaken(state);
}

/**
 * A composed floor (src/composer.js composeFloor's result) with its chest:
 * { room, treasure, treasureChecks } to lay over it, `room` the floor's room
 * with one item { x, y, type: 'chest' } more and `treasure` what the search
 * found: the chest's square, `line` (a win within par that takes it, never
 * shown to the player), `through` (how many par wins pass through its
 * square), `wins` (every par win), `marks` (the bot's runs that take it and
 * make par) and `steps`. A floor with no chest comes back as
 * { treasure: null, treasureMiss, treasureChecks } and keeps its room;
 * `treasureMiss` says why: 'none' (no square qualifies), 'spare' (a win of
 * the line's length takes every one that does), 'bot' (the bot stumbles on
 * the rest), 'cut' (a search passed its budget), 'proof' (no square's line
 * took the chest as played) or 'line' (the planted line doesn't play).
 * `treasureChecks` counts the squares left after each step, for measuring:
 * `squares` (qualifying), `spare` (of those, costing the spare move), `calm`
 * (of those, not the bot's by accident), and `unchecked`, the square the
 * first rule alone would lay a chest on (y * 8 + x), or null.
 * `seed` is the floor's; `start(room)` gives the floor's starting position
 * with `room` there (the composer's floorStart), `played(room)` the same as a
 * player arrives (with what earlier floors' hints carried in), `botSeed(run)`
 * the seed of each of the bot's runs, and `actionsFrom` a route's actions
 * (the composer's).
 */
export function placeTreasure(composed, { seed, start, actionsFrom, played: arrive = start, botSeed = (run) => hash(`${seed}:treasure:bot:${run}`), budget = TREASURE_BUDGET }) {
  const { room, line } = composed, par = line.length + 1;
  const checks = { squares: 0, spare: 0, calm: 0, unchecked: null };
  const none = (treasureMiss) => ({ treasure: null, treasureMiss, treasureChecks: checks });
  // The search runs on the room without its hint powerup, as the day's proof does (a route collects no powerup).
  const plain = { ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) };
  const begin = start(plain);
  const states = positions(begin, line);
  if (!states) return none('line');
  const found = parWins(begin, par, { actionsFrom, budget });
  if (found.cut) return none('cut');
  const blocked = taken(room, line, states);
  const rng = random(hash(`${seed}:treasure`));
  // Fewest par wins through it first; a seeded draw of the chest's own settles ties.
  const squares = Array.from({ length: 64 }, (_, square) => ({ square, through: found.through[square], order: rng() }))
    .filter(({ square, through }) => through > 0 && !blocked.has(square)).sort((a, b) => a.through - b.through || a.order - b.order);
  checks.squares = squares.length;
  if (!squares.length) return none('none');
  const laid = (list) => ({ ...room, items: [...room.items.map((item) => ({ ...item })), ...list.map(({ square }) => chestAt(square))] });
  // The first of `list` whose line takes the chest within par as played, hint collected.
  const proved = (list) => {
    for (const entry of list) {
      const proof = found.line(entry.square);
      if (proof && takesTreasure(start(laid([entry])), proof, par)) return { ...entry, proof };
    }
    return null;
  };
  checks.unchecked = proved(squares)?.square ?? null;
  // The spare move: no win that scores the planted line's length takes a chest there, on its way or as it wins.
  const quick = parWins(begin, par - 1, { actionsFrom, budget, hits: true });
  if (quick.cut) return none('cut');
  const spare = squares.filter(({ square }) => quick.through[square] + quick.last[square] === 0);
  checks.spare = spare.length;
  if (!spare.length) return none('spare');
  // By accident: the bot's runs on the room as played, a chest on every square still in question.
  const marks = botMarks(arrive(laid(spare)), par, botSeed);
  const calm = spare.filter(({ square }) => marks[square] <= TREASURE_BOT.share * TREASURE_BOT.runs);
  checks.calm = calm.length;
  if (!calm.length) return none('bot');
  const kept = proved(calm);
  if (!kept) return none('proof');
  const chest = chestAt(kept.square);
  return {
    room: laid([kept]), treasureChecks: checks,
    treasure: { x: chest.x, y: chest.y, line: kept.proof, through: kept.through, wins: found.wins, squares: squares.length, marks: marks[kept.square], steps: found.steps + quick.steps },
  };
}
