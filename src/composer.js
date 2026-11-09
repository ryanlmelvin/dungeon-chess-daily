// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Phase 0 of docs/puzzle-first-plan.md: a prototype composer that builds each
// floor around a planted solution instead of searching a random room. It is
// tooling and a dev-only preview (src/main.js ?composed=), never part of a
// published edition: production generation (src/generation.js) is unchanged.
//
// Every floor is a small room shaped by its motif, for a knight or bishop
// player, under today's rules (every monster moves every turn):
//
// - Bait: targets wind up at you from walled perches; step aside, a lunge
//   lands on the square you left, off-balance, and you take it there.
// - Squeeze: targets pace a two-square pocket (one legal step each turn);
//   one square of yours covers the squares they must step onto.
// - Fork: one square of yours hits two walled-in targets at once.
// - Net (king floor): the king paces a two-square pocket; one check covers
//   both squares, so it can't step out, and you take it.
//
// Monsters are deterministic (seeded ties), so a floor is a one-player puzzle:
// an exact search over the player's moves (shortestWins) finds its true
// shortest wins. A motif instance is kept only when its shortest win takes
// 3 or 4 moves and uses the planted idea; that line is the floor's
// certificate, and the whole day is proved once more by verifyWinningRoute.
// Other decoys sit walled in, away from the line, so they never join in;
// coins, the powerup and the recruit lie off the line. Failures reroll the
// instance (and the dressing) from their own seeded streams, then try the
// next motif, then a plain walk to walled-in targets, which always composes.
import { createGame, act, legalMoves, paperSuspects, PIECES, PIECE_COUNTS } from './rules.js';
import { getRawDaily } from './edition.js';
import { tierForDate } from './difficulty.js';
import { verifyWinningRoute, routeTransition, positionKey, findFloorRoute } from './fairness.js';
import { distanceTable, UNREACHABLE } from './move-tables.js';
import { hash, random } from './random.js';
import { playFloor, runSeed, HUMAN_RUNS } from './human-bot.js';

export const COMPOSER_VERSION = 1;
/** A planted line takes this many player moves, waits included. */
export const LINE_MOVES = Object.freeze({ min: 3, max: 4 });
/** Motif instances tried per motif, and dressings per instance, before moving on. */
export const MOTIF_ATTEMPTS = 40;
export const DRESS_ATTEMPTS = 6;
/**
 * Motif levels (docs/puzzle-first-idea.md, "Motif library"): how quiet the
 * key move is. With no weekly ramp, every day climbs the same way: floor 1 at
 * level 2, floor 2 at level 3 and the king floor's net at 3 or 4.
 */
export const MOTIF_LEVELS = Object.freeze({ walk: 1, bait: 2, fork: 2, squeeze: 3, net: 3 });
/**
 * Each floor's motifs in order of preference. Floor 2 falls back to a level-2
 * motif only where no level-3 one fits the matchup (a knight against knights,
 * a bishop against bishops or a queen); the walk always composes.
 */
export const FLOOR_MOTIFS = Object.freeze([['bait', 'fork'], ['squeeze', 'bait', 'fork'], ['net']]);
/**
 * One monster ruleset for every composed day, a placeholder while the plan's
 * open question (one ruleset or five tiers) is settled: Fair, where every
 * monster just avoids squares you could take it on. Measured as the single
 * ruleset, Fair kept the most bait instances and the walk fallback stayed
 * short; squeeze, fork and net floors play alike on every tier.
 */
export const COMPOSED_TIER = 'fair';

const START = Object.freeze({ x: 4, y: 6 });
const EXIT = Object.freeze({ x: 4, y: 0 });
const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
const ORTHOGONAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const AROUND = [...ORTHOGONAL, ...DIAGONAL];
const RAYS = { rook: ORTHOGONAL, bishop: DIAGONAL, queen: AROUND };
const inside = (tile) => tile.x >= 0 && tile.y >= 0 && tile.x < 8 && tile.y < 8;
const at = (x, y) => ({ x, y });
const same = (a, b) => a.x === b.x && a.y === b.y;
const index = (tile) => tile.y * 8 + tile.x;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const shuffle = (list, rng) => list.map((item) => ({ item, order: rng() })).sort((a, b) => a.order - b.order).map(({ item }) => item);

// The room taking shape: walls, monsters (cast 0 is the floor's target
// species, 1 and 2 its decoy species), items, and squares that must stay open.
class Plan {
  constructor() { this.walls = new Set(); this.units = []; this.items = []; this.kept = new Set(); }
  isWall(tile) { return !inside(tile) || this.walls.has(index(tile)); }
  unitAt(tile) { return this.units.find((unit) => same(unit, tile)); }
  free(tile) {
    return !this.isWall(tile) && !this.unitAt(tile) && !this.items.some((item) => same(item, tile))
      && !this.kept.has(index(tile)) && !same(tile, START) && !same(tile, EXIT);
  }
  keep(...tiles) { for (const tile of tiles) if (inside(tile)) this.kept.add(index(tile)); }
  /** A wall on `tile` unless it must stay open; true when `tile` is blocked afterwards. */
  wall(tile) {
    if (this.isWall(tile)) return true;
    if (!this.free(tile)) return false;
    this.walls.add(index(tile));
    return true;
  }
  place(cast, role, tile) { this.units.push({ x: tile.x, y: tile.y, cast, role }); }
  clone() {
    const copy = new Plan();
    copy.walls = new Set(this.walls); copy.units = this.units.map((unit) => ({ ...unit }));
    copy.items = this.items.map((item) => ({ ...item })); copy.kept = new Set(this.kept);
    return copy;
  }
  map() {
    return Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (this.walls.has(y * 8 + x) ? '#' : '.')).join(''));
  }
  room() {
    return { map: this.map(), enemies: this.units.map(({ x, y, cast }) => ({ x, y, cast })), items: this.items.map((item) => ({ ...item })) };
  }
}

// The first square of each way a monster of `role` can step from `tile`.
function firstSteps(role, tile) {
  const deltas = role === 'pawn' ? [[0, 1]] : role === 'knight' ? KNIGHT : role === 'king' ? AROUND : RAYS[role];
  return deltas.map(([dx, dy]) => at(tile.x + dx, tile.y + dy)).filter(inside);
}
// Wall a monster in, so it can step only onto `open` squares (or squares other
// monsters stand on). False when a needed wall would close a kept square.
function box(plan, role, tile, open = []) {
  for (const step of firstSteps(role, tile)) {
    if (open.some((square) => same(square, step)) || plan.unitAt(step)) continue;
    if (!plan.wall(step)) return false;
  }
  return true;
}
// Would a monster of `role` on `from` take a player who ends a move on `to` at
// once (src/rules.js closeAttacker)?
function covers(role, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, ax = Math.abs(dx), ay = Math.abs(dy);
  if (role === 'knight') return ax + ay === 3 && ax > 0 && ay > 0;
  if (Math.max(ax, ay) !== 1) return false;
  if (role === 'rook') return ax + ay === 1;
  if (role === 'bishop') return ax === 1 && ay === 1;
  if (role === 'pawn') return ax === 1 && dy === 1;
  return true;
}
// Squares `piece` reaches from `from` over the plan's walls; a line stops at
// the first monster (its square included).
function reach(plan, piece, from) {
  const out = [];
  if (!RAYS[piece]) {
    for (const [dx, dy] of piece === 'knight' ? KNIGHT : AROUND) {
      const tile = at(from.x + dx, from.y + dy);
      if (!plan.isWall(tile)) out.push(tile);
    }
    return out;
  }
  for (const [dx, dy] of RAYS[piece]) {
    for (let k = 1; k < 8; k++) {
      const tile = at(from.x + dx * k, from.y + dy * k);
      if (plan.isWall(tile)) break;
      out.push(tile);
      if (plan.unitAt(tile)) break;
    }
  }
  return out;
}
// The squares strictly between two squares on one line (none for a jump).
function between(a, b) {
  const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y), n = chebyshev(a, b), out = [];
  if (!(a.x === b.x || a.y === b.y || Math.abs(a.x - b.x) === Math.abs(a.y - b.y))) return out;
  for (let k = 1; k < n; k++) out.push(at(a.x + dx * k, a.y + dy * k));
  return out;
}
const empty = new Plan();
const reachable = (piece, from, plan = empty) => reach(plan, piece, from);

// The motifs. Each builds a plan for one floor from its context (the player's
// piece, the target role and its copies, the guards it may use) or returns
// null, and says what its planted idea is: `key` (the first move) and, for a
// squeeze, the `landing` squares the targets must step onto.
const MOTIFS = {
  bait(context) {
    const { piece, target, count, rng } = context;
    const plan = new Plan();
    // Two targets wind up at the start square; a lone queen at the square the
    // first move reaches, so the line still takes three moves.
    const bait = count === 2 ? START : shuffle(reachable(piece, START).filter((tile) => tile.y >= 2 && tile.y <= 5), rng)[0];
    if (!bait) return null;
    plan.keep(START, bait);
    const perches = [];
    if (target === 'knight') {
      for (const [dx, dy] of KNIGHT) perches.push({ tile: at(bait.x + dx, bait.y + dy), lane: [], dir: `${dx},${dy}`, toward: bait });
    } else {
      for (const [dx, dy] of RAYS[target]) {
        for (let k = 2; k < 8; k++) {
          const tile = at(bait.x + dx * k, bait.y + dy * k);
          if (!inside(tile)) break;
          perches.push({ tile, lane: between(bait, tile), dir: `${dx},${dy}`, toward: at(tile.x - dx, tile.y - dy) });
        }
      }
    }
    const chosen = [];
    for (const perch of shuffle(perches, rng)) {
      if (chosen.length === count) break;
      const { tile } = perch;
      if (!inside(tile) || same(tile, START) || same(tile, EXIT) || tile.y > 5 || chebyshev(tile, START) < 2) continue;
      if (count === 1 && (covers(target, tile, START) || reachable(target, tile).some((square) => same(square, START)))) continue;
      if (chosen.some((other) => other.dir === perch.dir || chebyshev(other.tile, tile) < 2
        || other.lane.some((square) => same(square, tile)) || perch.lane.some((square) => same(square, other.tile)))) continue;
      chosen.push(perch);
    }
    if (chosen.length < count) return null;
    for (const perch of chosen) plan.keep(...perch.lane);
    for (const perch of chosen) plan.place(0, target, perch.tile);
    for (const perch of chosen) if (!box(plan, target, perch.tile, perch.toward ? [perch.toward] : [])) return null;
    // A lone queen must not see the start square, or it winds up there first.
    if (count === 1) for (const square of between(START, chosen[0].tile)) plan.wall(square);
    // Guards (copies of the paper's other suspect) where a target could be
    // taken straight away, and now and then elsewhere for variety.
    for (const perch of chosen) {
      const direct = reachable(piece, START, plan).some((square) => same(square, perch.tile));
      if (!direct && rng() < 0.5) continue;
      const guard = context.guards.shift();
      if (!guard) { if (direct) return null; continue; }
      const spots = shuffle(firstSteps('king', perch.tile).concat(KNIGHT.map(([dx, dy]) => at(perch.tile.x + dx, perch.tile.y + dy))).filter(inside), rng);
      const spot = spots.find((tile) => plan.free(tile) && covers(guard.role, tile, perch.tile) && !covers(guard.role, tile, bait)
        && !covers(guard.role, tile, START) && box(plan.clone(), guard.role, tile));
      if (!spot) { context.guards.unshift(guard); if (direct) return null; continue; }
      plan.place(guard.cast, guard.role, spot);
      box(plan, guard.role, spot);
    }
    return { plan, motif: 'bait' };
  },

  squeeze(context) {
    const { piece, target, count, rng } = context;
    // A pocketed target must not see the player's squares, so only roles whose
    // lines differ from the player's (and no knight against a knight).
    if (!(piece === 'knight' ? ['rook', 'bishop', 'queen'] : ['rook', 'knight']).includes(target)) return null;
    const plan = new Plan();
    // Two targets: the key square is the first move. A lone queen: the second.
    const first = reachable(piece, START);
    const keys = count === 2 ? first : [...new Set(first.flatMap((tile) => reachable(piece, tile)).map(index))].map((n) => at(n % 8, n >> 3))
      .filter((tile) => !first.some((square) => same(square, tile)) && !same(tile, START));
    const key = shuffle(keys.filter((tile) => tile.y >= 1 && tile.y <= 5), rng)[0];
    if (!key) return null;
    plan.keep(START, key);
    const fromStart = reachable(piece, START);
    const landings = shuffle(reachable(piece, key).filter((tile) => tile.y <= 5 && !same(tile, START) && !fromStart.some((square) => same(square, tile))), rng);
    const pockets = [];
    for (const landing of landings) {
      if (pockets.length === count) break;
      if (pockets.some((pocket) => chebyshev(pocket.landing, landing) < 3)) continue;
      const step = shuffle(firstSteps(target === 'queen' ? 'king' : target, landing), rng).find((tile) => tile.y <= 5
        && !same(tile, START) && !same(tile, key) && !same(tile, EXIT) && !covers(target, tile, key)
        && !reachable(piece, key).some((square) => same(square, tile)) && !fromStart.some((square) => same(square, tile))
        && !pockets.some((pocket) => chebyshev(pocket.landing, tile) < 2 || chebyshev(pocket.home, tile) < 2));
      if (step) pockets.push({ landing, home: step });
    }
    if (pockets.length < count) return null;
    for (const pocket of pockets) plan.keep(pocket.landing, ...between(key, pocket.landing));
    // On the key square after an odd move, a target must be home (it steps to
    // the landing square in that phase); after an even move, on the landing.
    for (const pocket of pockets) plan.place(0, target, count === 2 ? pocket.home : pocket.landing);
    for (const pocket of pockets) {
      if (!box(plan, target, pocket.home, [pocket.landing])) return null;
      plan.kept.delete(index(pocket.landing));
      if (!box(plan, target, pocket.landing, [pocket.home])) return null;
      plan.keep(pocket.landing);
    }
    return { plan, motif: 'squeeze', key, landing: pockets.map((pocket) => pocket.landing) };
  },

  fork(context) {
    const { piece, target, count, rng } = context;
    if (count !== 2 || !(piece === 'knight' ? ['rook', 'bishop'] : ['rook', 'knight']).includes(target)) return null;
    const plan = new Plan();
    const key = shuffle(reachable(piece, START).filter((tile) => tile.y >= 1 && tile.y <= 5), rng)[0];
    if (!key) return null;
    plan.keep(START, key);
    const fromStart = reachable(piece, START);
    const spots = [];
    for (const tile of shuffle(reachable(piece, key), rng)) {
      if (spots.length === 2) break;
      if (tile.y > 5 || same(tile, START) || same(tile, EXIT) || fromStart.some((square) => same(square, tile)) || covers(target, tile, key)) continue;
      if (spots.some((other) => chebyshev(other, tile) < 2)) continue;
      spots.push(tile);
    }
    if (spots.length < 2) return null;
    for (const tile of spots) plan.keep(...between(key, tile));
    for (const tile of spots) plan.place(0, target, tile);
    for (const tile of spots) if (!box(plan, target, tile)) return null;
    return { plan, motif: 'fork', key };
  },

  net(context) {
    const { piece, rng } = context;
    const options = [];
    for (let y = 0; y <= 2; y++) for (let x = 0; x < 8; x++) {
      const home = at(x, y);
      for (const [dx, dy] of DIAGONAL) {
        const other = at(x + dx, y + dy);
        if (!inside(other) || other.y > 2 || same(home, EXIT) || same(other, EXIT)) continue;
        if (piece === 'knight') {
          // One knight square attacks both squares of the pocket.
          for (const [kx, ky] of KNIGHT) {
            const check = at(x + kx, y + ky);
            if (inside(check) && KNIGHT.some(([ax, ay]) => check.x - other.x === ax && check.y - other.y === ay)
              && chebyshev(check, home) > 1 && chebyshev(check, other) > 1) options.push({ home, other, check, line: [] });
          }
        } else if ((x + y) % 2 === (START.x + START.y) % 2) {
          // A check along the pocket's diagonal covers both squares; the square
          // beyond `other` must be the board's edge.
          const beyond = at(other.x + dx, other.y + dy);
          if (inside(beyond)) continue;
          for (let k = 2; k < 8; k++) {
            const check = at(x - dx * k, y - dy * k);
            if (!inside(check)) break;
            // A wall just past the check square ends the diagonal there.
            options.push({ home, other, check, line: between(check, home), cap: at(check.x - dx, check.y - dy) });
          }
        }
      }
    }
    for (const pick of shuffle(options, rng).slice(0, 48)) {
      const plan = new Plan();
      plan.keep(START, pick.check, ...pick.line);
      // A bishop's king starts deep in its pocket: two turns from the exit along the line.
      plan.place(0, 'king', piece === 'bishop' ? pick.other : pick.home);
      plan.keep(pick.home, pick.other);
      if (!box(plan, 'king', pick.home, [pick.other, ...pick.line])) continue;
      if (!box(plan, 'king', pick.other, [pick.home])) continue;
      if (pick.cap && inside(pick.cap) && !plan.wall(pick.cap)) continue;
      // Checkmate wins at once on composed king floors (src/rules.js), so every
      // check square must be three or more moves from the start (the king
      // floor's fallback lets that go).
      const checks = piece === 'knight' ? [pick.check] : [...pick.line.filter((tile) => chebyshev(tile, pick.home) >= 2), pick.check];
      const far = () => { const table = distanceTable(plan.map(), piece); return checks.every((square) => table[index(START) * 64 + index(square)] >= LINE_MOVES.min); };
      // A bishop reaches most of its colour in two moves: walls two squares out
      // on the start's diagonals cut its long lines.
      if (!context.relaxed && !far() && piece === 'bishop') for (const choke of shuffle([at(2, 4), at(6, 4), at(1, 3), at(7, 3)], rng)) { plan.wall(choke); if (far()) break; }
      if (!context.relaxed && !far()) continue;
      return { plan, motif: 'net', key: pick.check };
    }
    return null;
  },

  // The fallback: targets two moves out in an open room, no planted idea.
  walk(context) {
    const { piece, target, count, rng } = context;
    const plan = new Plan();
    plan.keep(START);
    const table = distanceTable(Array(8).fill('........'), piece);
    const moves = (a, b) => table[index(a) * 64 + index(b)];
    const spots = shuffle(Array.from({ length: 40 }, (_, n) => at(n % 8, n >> 3)), rng)
      .filter((tile) => !same(tile, EXIT) && moves(START, tile) === 2 && !covers(target, tile, START));
    for (const tile of spots) {
      if (plan.units.length === count) break;
      if (plan.units.some((unit) => chebyshev(unit, tile) < 2) || !plan.free(tile)) continue;
      plan.place(0, target, tile);
    }
    return plan.units.length === count ? { plan, motif: 'walk' } : null;
  },
};

/** Which motifs fit a player piece and a floor's target role (the king floor always nets). */
export function motifsFor(piece, target, floor) {
  if (floor === 2) return ['net'];
  return FLOOR_MOTIFS[floor].filter((motif) => motif !== 'net');
}

// The position at the start of `floor` with `room` there: earlier floors are
// stand-ins whose one target the player takes at once. Nothing but lives
// carries from floor to floor, and a planted line loses none, so a floor plays
// the same here as in its day.
const FIRST_TAKE = { knight: at(3, 4), bishop: at(2, 4) };
const standIn = (piece) => ({ map: Array(8).fill('........'), enemies: [{ ...FIRST_TAKE[piece], cast: 0 }], items: [] });
function floorStart(base, floor, room) {
  let state = createGame({ ...base, composed: [0, 1, 2].map((f) => (f === floor ? room : standIn(base.playerPiece))) });
  for (let f = 0; f < floor; f++) {
    state = act(state, { type: 'move', ...FIRST_TAKE[base.playerPiece] });
    state = act(state, { type: 'descend' });
  }
  if (state.floor !== floor || state.status !== 'playing') throw new Error('Stand-in floors did not clear.');
  return state;
}

// A route's actions from `state`: waiting, and every legal move that picks up
// nothing a certificate may not (powerups, and recruits before the king floor).
function actionsFrom(state) {
  const actions = [{ type: 'wait' }];
  for (const move of legalMoves(state)) {
    const item = state.items.find((entry) => entry.x === move.x && entry.y === move.y);
    if (item && (item.type === 'powerup' || (item.type === 'companion' && state.floor !== 2))) continue;
    actions.push({ type: 'move', x: move.x, y: move.y });
  }
  return actions;
}

/**
 * The floor's shortest wins from `start`, by iterative deepening over the
 * player's moves and waits, up to `maxDepth` moves: { depth, lines } (at most
 * `cap` lines, all `depth` moves long, each ending with the floor's challenge
 * complete), or null when nothing wins in time. Each step is a certificate
 * step (src/fairness.js routeTransition): no life lost, no power used.
 */
export function shortestWins(start, maxDepth, cap = 64) {
  for (let depth = 1; depth <= maxDepth; depth++) {
    const lines = [], dead = new Set();
    const search = (state, left, path) => {
      const key = `${left}|${positionKey(state)}`;
      if (dead.has(key)) return false;
      let won = false;
      for (const action of actionsFrom(state)) {
        if (lines.length >= cap) return true;
        const next = routeTransition(state, action);
        if (!next) continue;
        if (next.exit.open) { lines.push([...path, action]); won = true; } else if (left > 1 && search(next, left - 1, [...path, action])) won = true;
      }
      if (!won) dead.add(key);
      return won;
    };
    search(start, depth, []);
    if (lines.length) return { depth, lines };
  }
  return null;
}

// The walk's line: the certificate search's route (src/fairness.js), stairs dropped.
function walkRoute(start) {
  const found = findFloorRoute(start, { maxExpansions: 4000 });
  if (found.status !== 'solved') return null;
  const line = found.actions.slice(0, -1);
  return { depth: line.length, lines: [line] };
}

/**
 * The lowest score of a win within `depth` moves that may lose lives, as a
 * player in a hurry might play it (taking a guarded target and absorbing the
 * hit), each lost life counting one move (agreed: a lost life is a stroke).
 * Lines that end the run, or pick up a powerup or recruit, don't count.
 * Infinity when nothing wins in time.
 */
export function hastyScore(start, depth, lives = start.player.hp) {
  if (depth <= 0) return Infinity;
  let best = Infinity;
  for (const action of actionsFrom(start)) {
    const next = act(start, action);
    if (next === start || next.status !== 'playing' || next.events.some((event) => event.type === 'restart') || next.floor !== start.floor) continue;
    const lost = lives - next.player.hp;
    if (next.exit.open) best = Math.min(best, 1 + lost);
    else best = Math.min(best, 1 + hastyScore(next, depth - 1, lives));
  }
  return best;
}

/**
 * The bot guard (docs/puzzle-first-idea.md, "Check, don't calibrate"): the
 * human-like bot's seeded runs from the floor's start. A floor fails when a run
 * wins in 2 moves or fewer (an accidental shortcut) or when more than a third
 * of runs fail or take more than par + 4 moves (a fragile or unclear puzzle),
 * par being the planted line plus one.
 */
export const BOT_GUARD = Object.freeze({ runs: HUMAN_RUNS, short: 2, slack: 4, missShare: 1 / 3 });
export function botGuard(start, base, floor, par) {
  let short = 0, missed = 0;
  for (let run = 0; run < BOT_GUARD.runs; run++) {
    const result = playFloor(start, { seed: runSeed(base, floor, run) });
    if (result.won && result.moves + result.livesLost <= BOT_GUARD.short) short++;
    if (!result.won || result.moves > par + BOT_GUARD.slack) missed++;
  }
  return { ok: short === 0 && missed <= BOT_GUARD.missShare * BOT_GUARD.runs, short, missed };
}

// Each position along `line` from `start`, or null if a step fails.
function playLine(start, line) {
  const states = [start];
  for (const action of line) {
    const next = routeTransition(states.at(-1), action);
    if (!next) return null;
    states.push(next);
  }
  return states;
}
const isTarget = (state, id) => (state.enemies.find((foe) => foe.id === id)?.role ?? null) === state.objective.piece;

// Does a winning line use the planted idea?
function usesIdea(built, states, line) {
  const first = line[0];
  const onKey = first.type === 'move' && built.key && same(first, built.key);
  if (built.motif === 'bait') {
    // A target lunges onto the square the player just left and is taken there next.
    return line.some((action, n) => {
      if (n + 1 >= line.length || action.type !== 'move') return false;
      const left = states[n].player, after = states[n + 1];
      return after.events.some((event) => event.type === 'miss' && event.x === left.x && event.y === left.y && isTarget(states[n], event.id))
        && line[n + 1].type === 'move' && same(line[n + 1], left);
    });
  }
  if (built.motif === 'squeeze') {
    const keyAt = line.findIndex((action) => action.type === 'move' && same(action, built.key));
    return keyAt >= 0 && line.slice(keyAt + 1).some((action) => action.type === 'move' && built.landing.some((tile) => same(tile, action)));
  }
  if (built.motif === 'fork') {
    const after = states[1];
    return onKey && legalMoves(after).filter((move) => move.capture && after.enemies.some((foe) => same(foe, move) && foe.role === after.objective.piece)).length >= 2;
  }
  return true;
}

// Share of monster turns along a line in which the monster had at most one
// step, or was committed to a wind-up (both are forced replies).
function forcedShare(states) {
  let forced = 0, total = 0;
  for (const state of states.slice(1, -1)) {
    const walls = { isWall: (tile) => !inside(tile) || state.map[tile.y][tile.x] === '#' };
    for (const foe of state.enemies) {
      total++;
      if (foe.phase === 'aim') { forced++; continue; }
      const steps = firstSteps(foe.piece, foe).filter((tile) => !walls.isWall(tile) && !state.enemies.some((other) => same(other, tile)) && !same(tile, state.player));
      if (steps.length <= 1) forced++;
    }
  }
  return total ? forced / total : 1;
}

// Wall in the remaining decoys well away from the line, then lay the coins,
// the powerup and the recruit off it, on squares the player can reach.
function dress(plan, context, line, base, floor, rng) {
  const lineSquares = [START, ...line.filter((action) => action.type === 'move')];
  plan.keep(...lineSquares);
  const far = (tile, gap) => lineSquares.every((square) => chebyshev(square, tile) >= gap) && plan.units.every((unit) => chebyshev(unit, tile) >= 2);
  for (const decoy of context.quiet) {
    const spots = shuffle(Array.from({ length: 64 }, (_, n) => at(n % 8, n >> 3)), rng).filter((tile) => plan.free(tile) && far(tile, 3));
    const costed = spots.map((tile) => {
      const trial = plan.clone();
      trial.place(decoy.cast, decoy.role, tile);
      return box(trial, decoy.role, tile) ? { trial, walls: trial.walls.size - plan.walls.size } : null;
    }).filter(Boolean).sort((a, b) => a.walls - b.walls);
    if (!costed.length) return null;
    Object.assign(plan, costed[0].trial);
  }
  const table = distanceTable(plan.map(), context.piece);
  const moves = (tile) => table[index(START) * 64 + index(tile)];
  const safe = (tile) => plan.free(tile) && moves(tile) !== UNREACHABLE && !plan.units.some((unit) => covers(unit.role, unit, tile));
  const open = shuffle(Array.from({ length: 64 }, (_, n) => at(n % 8, n >> 3)), rng).filter(safe);
  const coinless = floor === 2;
  const coins = coinless ? [] : open.filter((tile) => far(tile, 1)).slice(0, 3);
  for (const tile of coins) plan.items.push({ x: tile.x, y: tile.y, type: 'coin' });
  const power = open.find((tile) => plan.free(tile) && far(tile, 2) && chebyshev(tile, START) > 1);
  if (power) plan.items.push({ x: power.x, y: power.y, type: 'powerup', power: (coinless ? ['shield', 'freeze'] : ['shield', 'freeze', 'magnet'])[Math.floor(rng() * (coinless ? 2 : 3))] });
  if (floor === 2) {
    // The king floor's recruit, a king, waits one move from the start, as always,
    // too far from the royal king to step beside it within the line.
    const king = plan.units.find((unit) => unit.role === 'king' && unit.cast === 0);
    const tile = shuffle(reach(plan, context.piece, START), rng).find((square) => plan.free(square) && chebyshev(square, king) > LINE_MOVES.max + 1);
    if (tile) plan.items.push({ x: tile.x, y: tile.y, type: 'companion', piece: 'king' });
  } else {
    // Floors 1 and 2 recruit any piece, three or more moves away, so it can't
    // take part within the line.
    const piece = PIECES[hash(`${base.date}:composer-recruit:${floor}`) % PIECES.length];
    const tile = open.find((square) => plan.free(square) && moves(square) >= 3 && far(square, 3));
    if (tile) plan.items.push({ x: tile.x, y: tile.y, type: 'companion', piece });
  }
  return plan;
}

// The floor's cast: its target role and copies, the guards the motif may use
// (copies of the paper's other suspect, as many as the target has) and the
// rest, which wait walled in. On the king floor every decoy waits.
function castFor(base, floor) {
  const target = base.targets[floor];
  const count = PIECE_COUNTS[target];
  const species = [base.species[floor], base.species[3 + floor * 2], base.species[4 + floor * 2]];
  const suspect = paperSuspects(base, floor).find((entry) => entry.id !== species[0].id) ?? species[1];
  const suspectCast = species[1].id === suspect.id ? 1 : 2;
  const otherCast = 3 - suspectCast;
  const copies = Math.min(count, PIECE_COUNTS[species[suspectCast].piece]);
  const suspects = Array.from({ length: copies }, () => ({ cast: suspectCast, role: species[suspectCast].piece }));
  const other = { cast: otherCast, role: species[otherCast].piece };
  return { target, count, suspects, other, matched: copies === count };
}

/**
 * Compose one floor of `base` (a raw daily with its tier, no modifier and
 * floorSeeds). Returns { room, line, motif, depth, firstMoves, forced, tried,
 * kept, ms }: `tried` and `kept` count motif instances built and accepted per
 * motif (`replayed` those whose planted idea won within the line's length).
 */
export function composeFloor(base, floor, { trace } = {}) {
  const began = performance.now();
  const piece = base.playerPiece;
  const cast = castFor(base, floor);
  const seed = base.floorSeeds[floor];
  const stats = {};
  const preferred = motifsFor(piece, cast.target, floor);
  for (const motif of [...preferred, 'walk']) {
    const tally = (stats[motif] ??= { built: 0, replayed: 0, kept: 0 });
    const attempts = motif === 'walk' ? MOTIF_ATTEMPTS * 4 : MOTIF_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const rng = random(hash(`${seed}:${motif}:${attempt}`));
      const context = { piece, target: cast.target, count: cast.count, rng, guards: [...cast.suspects, cast.other] };
      const built = motif === 'walk' && floor === 2 ? MOTIFS.net({ ...context, relaxed: true }) : MOTIFS[motif](context);
      if (!built) { trace?.({ motif, attempt, stage: 'build' }); continue; }
      tally.built++;
      // Decoys the motif didn't use as guards wait walled in.
      context.quiet = context.guards;
      const start = floorStart(base, floor, built.plan.room());
      const found = motif === 'walk' ? (floor === 2 ? shortestWins(start, 6) : walkRoute(start)) : shortestWins(start, LINE_MOVES.max);
      const shortest = motif === 'walk' ? 2 : LINE_MOVES.min;
      if (!found || found.depth < shortest) { trace?.({ motif, attempt, stage: 'search', depth: found?.depth ?? null, room: built.plan.room() }); continue; }
      const planted = found.lines.map((line) => ({ line, states: playLine(start, line) })).find(({ line, states }) => states && usesIdea(built, states, line));
      if (!planted) { trace?.({ motif, attempt, stage: 'idea', depth: found.depth, lines: found.lines, room: built.plan.room() }); continue; }
      tally.replayed++;
      for (let dressing = 0; dressing < DRESS_ATTEMPTS; dressing++) {
        const plan = dress(built.plan.clone(), context, planted.line, base, floor, random(hash(`${seed}:${motif}:${attempt}:dress:${dressing}`)));
        if (!plan) { trace?.({ motif, attempt, stage: 'dress' }); continue; }
        const room = plan.room();
        const dressed = floorStart(base, floor, room);
        const states = playLine(dressed, planted.line);
        const hasty = hastyScore(dressed, BOT_GUARD.short);
        const why = !states?.at(-1).exit.open ? 'line' : motif === 'walk' ? null : shortestWins(dressed, found.depth - 1) ? 'shorter' : hasty <= BOT_GUARD.short ? 'hasty' : null;
        if (why) { trace?.({ motif, attempt, stage: `redress:${why}`, room, line: planted.line }); continue; }
        const guard = botGuard(dressed, base, floor, planted.line.length + 1);
        if (!guard.ok && motif !== 'walk') { tally.guarded = (tally.guarded ?? 0) + 1; trace?.({ motif, attempt, stage: 'bot', ...guard, room }); break; }
        tally.kept++;
        return {
          room, line: planted.line, motif, depth: found.depth, firstMoves: new Set(found.lines.map((line) => JSON.stringify(line[0]))).size,
          lines: found.lines.length, forced: forcedShare(states), matched: cast.matched, lifeTrade: hasty < planted.line.length, stats, ms: performance.now() - began,
        };
      }
    }
  }
  throw new Error(`No floor composed for ${base.date} floor ${floor + 1}.`);
}

/** The composed day's seeds: one per floor, its own stream. */
export const composedSeeds = (date) => [0, 1, 2].map((floor) => hash(`composer:${COMPOSER_VERSION}:${date}:${floor}`));

/**
 * A composed day for a canonical date: the raw daily with the date's tier, no
 * modifier, a composed room per floor and the planted lines as its
 * certificate, proved by verifyWinningRoute. `floors` describes each floor.
 * `daily` overrides the raw daily (tooling: synthetic casts).
 */
export function composeDay(date, { tier, daily: raw = getRawDaily(date) } = {}) {
  const base = { ...raw, difficulty: tier ?? COMPOSED_TIER ?? tierForDate(raw.date), modifier: 'none', floorSeeds: composedSeeds(raw.date) };
  delete base.generation;
  const floors = [0, 1, 2].map((floor) => composeFloor(base, floor));
  const actions = floors.flatMap((floor) => [...floor.line, { type: 'descend' }]);
  const daily = { ...base, composed: floors.map((floor) => floor.room) };
  const proof = verifyWinningRoute(createGame(daily), actions);
  if (!proof.valid) throw new Error(`Composed day ${raw.date} failed its proof: ${proof.reason}`);
  daily.generation = { version: COMPOSER_VERSION, source: 'composed', motifs: floors.map((floor) => floor.motif), certificate: { actions, metrics: proof.metrics } };
  return { daily, floors };
}
