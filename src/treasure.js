// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Treasure (a dev preview; no stored edition has one): an optional chest off
// each composed floor's planted line, as a second, harder goal on the same
// room. Par stays the planted line plus one; the chest asks for a win within
// par that also lands on its square before the door opens. Taking it that way
// earns the floor's treasure mark (src/rules.js treasureMark).
//
// The composer calls placeTreasure once a floor's room, line and hint are
// settled (composeDay's `treasure` option, off unless asked for). Monsters are
// deterministic, so every win within par can be counted exactly (parWins): a
// square qualifies when at least one of them lands on it before the move that
// completes the challenge, and of the qualifying squares the one the fewest
// such wins pass through is kept, ties broken by a seeded stream of its own.
// Nothing else in the room changes: monsters and the recruit ignore a chest
// as they do a coin, so the planted line and every check made on the room
// still hold (composeDay proves the day again with its chests in).
import { act, floorScoredMoves, chestTaken } from './rules.js';
import { routeTransition, positionKey } from './fairness.js';
import { hash, random } from './random.js';

/** Search steps a floor's count of par wins may take; past it the floor gets no chest. */
export const TREASURE_BUDGET = 400_000;

const EXIT = Object.freeze({ x: 4, y: 0 });
const HOME = Object.freeze({ x: 4, y: 6 });
const index = (tile) => tile.y * 8 + tile.x;
const isTarget = (state, foe) => (foe.role ?? foe.piece) === state.objective.piece;

/**
 * Every win within `par` scored moves from `start` (a floor's start, on the
 * room without its hint powerups, as the planted line is searched), counted
 * exactly: `wins`, and `through[square]` (y * 8 + x), how many of them land
 * on that square before the move that completes the challenge. Each step is a
 * certificate step (src/fairness.js routeTransition: no power used, no
 * floor 1–2 recruit, as `actionsFrom` leaves them out) and is never captured,
 * a pawn's included: a chest line is a clean line, as a planted one is.
 * `line(square)` returns one such win through `square`, or null. `cut` when
 * the search passed `budget` steps (the counts are then incomplete).
 */
export function parWins(start, par, { actionsFrom, budget = TREASURE_BUDGET } = {}) {
  const memo = new Map();
  const royal = start.floor === 2;
  let steps = 0, cut = false, limit = budget;
  // The moves a floor still needs at least: one per target left (the recruit never takes one on a route).
  const needs = (state) => (royal ? 1 : state.enemies.reduce((count, foe) => count + (isTarget(state, foe) ? 1 : 0), 0));
  // Each way on from `state`: its action, the position after it and where the move landed (-1 for a wait).
  const ways = (state, left) => {
    const out = [];
    // With as many moves left as targets, every move must take one (a pawn may also take in passing, so it tries them all).
    const mustTake = !royal && state.player.piece !== 'pawn' && needs(state) === left;
    for (const action of actionsFrom(state)) {
      if (mustTake && !(action.type === 'move' && state.enemies.some((foe) => foe.x === action.x && foe.y === action.y && isTarget(state, foe)))) continue;
      if (steps++ > limit) { cut = true; break; }
      const next = routeTransition(state, action);
      if (!next || next.hits > state.hits) continue;
      const moved = action.type === 'move' ? next.events.find((event) => event.type === 'move') : null;
      out.push({ action, next, landed: moved ? index(moved) : -1 });
    }
    return out;
  };
  const NONE = Object.freeze({ wins: 0, through: null });
  const solve = (state, left) => {
    if (cut || needs(state) > left) return NONE;
    const key = `${left}|${positionKey(state)}`;
    const known = memo.get(key);
    if (known) return known;
    let wins = 0, through = null;
    for (const { next, landed } of ways(state, left)) {
      if (next.exit.open) { wins++; continue; }
      const after = solve(next, left - 1);
      if (!after.wins) continue;
      wins += after.wins;
      through ??= new Array(64).fill(0);
      for (let square = 0; square < 64; square++) through[square] += square === landed ? after.wins : after.through?.[square] ?? 0;
    }
    const result = wins ? { wins, through } : NONE;
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
      const way = ways(state, left).find(({ next, landed }) => {
        if (next.exit.open) return taken;
        const after = solve(next, left - 1);
        return taken || landed === square ? after.wins > 0 : (after.through?.[square] ?? 0) > 0;
      });
      if (!way || cut) return null;
      actions.push(way.action);
      taken ||= way.landed === square;
      state = way.next; left--;
    }
    return actions;
  };
  return { wins: all.wins, through: all.through ?? new Array(64).fill(0), line, cut, steps };
}

// The squares a room's chest may not lie on: walls, the start, the exit, a monster's or an
// item's square, ice (as no pickup lies on ice), and every square the planted line moves to
// or comes to rest on (`states`, its positions).
function taken(room, line, states) {
  const squares = new Set([room.start ?? HOME, EXIT, ...room.enemies, ...room.items, ...(room.ice ?? []),
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
 * { room, treasure } to lay over it, `room` the floor's room with one item
 * { x, y, type: 'chest' } more and `treasure` what the search found: the
 * chest's square, `line` (a win within par that takes it, never shown to the
 * player), `through` (how many par wins pass through its square), `wins`
 * (every par win), `squares` (how many qualified) and `steps`. A floor with no
 * qualifying square, or whose search was cut short, comes back as
 * { treasure: null } and keeps its room. `seed` is the floor's; `start(room)`
 * gives the floor's starting position with `room` there (the composer's
 * floorStart) and `actionsFrom` a route's actions (the composer's).
 */
export function placeTreasure(composed, { seed, start, actionsFrom, budget = TREASURE_BUDGET }) {
  const { room, line } = composed, par = line.length + 1;
  // The search runs on the room without its hint powerup, as the day's proof does (a route collects no powerup).
  const plain = { ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) };
  const begin = start(plain);
  const states = positions(begin, line);
  if (!states) return { treasure: null };
  const found = parWins(begin, par, { actionsFrom, budget });
  if (found.cut) return { treasure: null };
  const blocked = taken(room, line, states);
  const rng = random(hash(`${seed}:treasure`));
  // Fewest par wins through it first; a seeded draw of the chest's own settles ties.
  const squares = Array.from({ length: 64 }, (_, square) => ({ square, through: found.through[square], order: rng() }))
    .filter(({ square, through }) => through > 0 && !blocked.has(square)).sort((a, b) => a.through - b.through || a.order - b.order);
  for (const { square, through } of squares) {
    const chest = { x: square % 8, y: square >> 3, type: 'chest' };
    const proof = found.line(square);
    const dressed = { ...room, items: [...room.items.map((item) => ({ ...item })), chest] };
    // As played, hint collected: the proving line takes the chest within par.
    if (!proof || !takesTreasure(start(dressed), proof, par)) continue;
    return { room: dressed, treasure: { x: chest.x, y: chest.y, line: proof, through, wins: found.wins, squares: squares.length, steps: found.steps } };
  }
  return { treasure: null };
}
