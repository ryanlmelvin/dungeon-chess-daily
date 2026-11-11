// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The composer (docs/puzzle-first-idea.md): it builds each floor around a
// planted solution instead of searching a random room. Every published
// edition is composed by it at build time (scripts/build-editions.mjs, stored
// in src/editions.js); the player's app never carries it, and the dev server
// composes a date afresh with ?composed=YYYY-MM-DD (src/composed-preview.js).
//
// Every floor is a small room shaped by its motif, for a knight, bishop, rook
// or queen player starting on one of a few home-rank squares (START_SETS),
// under the rules (every monster moves every turn):
//
// - Bait: targets wind up at you from walled perches; step aside, a lunge
//   lands on the square you left, off-balance, and you take it there.
// - Squeeze: targets pace a two-square pocket (one legal step each turn);
//   one square of yours covers the squares they must step onto.
// - Fork: one square of yours hits two walled-in targets at once.
// - Net (king floor): the king paces a two-square pocket; one check covers
//   both squares, so it can't step out: checkmate. A knight checks from one
//   square; a bishop, rook or queen along the pocket's own line.
//
// A pawn player's line is mostly timing (PAWN_MATES): quiet moves bring the
// pawn where each target steps or marches into a diagonal, or up to the last
// rank, where the new queen finishes the floor or mates.
//
// A day keeps its modifier. On Ice days each room lays its own ice around the
// planted line: where the line's key move runs along a line, it aims one
// square short, on ice, and skids onto the key square; the other tiles lie
// off the line (iceVariants). On Breach days a monster comes in at the door
// every ten moves, long after a planted line of 3 or 4 has opened the stairs.
//
// Monsters are deterministic (seeded ties), so a floor is a one-player puzzle:
// an exact search over the player's moves (shortestWins) finds its true
// shortest wins. A motif instance is kept only when its shortest win takes
// 3 or 4 moves and uses the planted idea; that line is the floor's
// certificate, and the whole day is proved once more (src/generation.js
// proveComposed), as every edition is again when it loads.
// Other decoys sit walled in, away from the line, so they never join in;
// coins, the powerup and the recruit lie off the line. Failures reroll the
// instance (and the dressing) from their own seeded streams, then try the
// next motif, then a plain walk to walled-in targets, which always composes.
import { createGame, act, legalMoves, closeAttacker, floorScoredMoves, matchedDecoy, PIECES, PIECE_COUNTS, POWERUPS } from './rules.js';
import { getRawDaily } from './edition.js';
import { DAILY_TIER } from './difficulty.js';
import { routeTransition, positionKey, findFloorRoute } from './fairness.js';
import { composedSeeds, proveComposed, GENERATOR_VERSION } from './generation.js';
import { distanceTable, UNREACHABLE } from './move-tables.js';
import { hash, random } from './random.js';
import { playFloor, runSeed, HUMAN_RUNS } from './human-bot.js';
import { ICE_TILES } from './modifiers.js';

export { COMPOSER_VERSION, composedSeeds } from './generation.js';
/** The player pieces the composer builds days for, whatever their targets: every daily piece. */
export const COMPOSED_PIECES = Object.freeze(['knight', 'bishop', 'rook', 'queen', 'pawn']);
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
export const MOTIF_LEVELS = Object.freeze({ walk: 1, bait: 2, fork: 2, squeeze: 3, net: 3, tempo: 3, crown: 3 });
/**
 * Each floor's motifs in order of preference. Floor 2 falls back to a level-2
 * motif only where no level-3 one fits the matchup (a knight against knights,
 * a bishop against bishops or a queen); floor 1 to the squeeze only where no
 * bait fits (a queen against a queen, which the bait square would let you
 * take at once); the walk always composes.
 */
export const FLOOR_MOTIFS = Object.freeze([['bait', 'squeeze'], ['squeeze', 'bait'], ['net']]);
/**
 * The monsters every composed day plays: the daily's one ruleset, Fair
 * (src/difficulty.js DAILY_TIER). Measured as the single ruleset, Fair kept
 * the most bait instances and the walk fallback stayed short; squeeze, fork
 * and net floors play alike on every tier.
 */
export const COMPOSED_TIER = DAILY_TIER;
/**
 * How each floor's spare decoys (those not in the planted trick) behave:
 * 'held' stand still and harmless for as many moves as the planted line
 * (par − 1, par being the line plus one), then wake and hunt, like
 * reinforcements on a timer; 'roam' hunt from the first move. Floor 1 is a
 * clean puzzle on a clock, then the day turns up the pressure.
 */
export const FLOOR_DECOYS = Object.freeze(['held', 'roam', 'roam']);
/**
 * A decoy pawn starts at least this many of its moves from crowning. It
 * marches down a rank a move (two from rank 7), so it starts on rank 6 or
 * higher: none has crowned by the time a planted line of 3 or 4 moves clears
 * the floor (and the monsters move once more), so a pawn waiting out a box
 * after the clear meets no fresh queen; and none stands on rank 1, where it
 * would already have crowned. Target pawns are barricaded instead.
 */
export const DECOY_PAWN_CROWN = 5;
/**
 * A pawn guarding a bait target may stand one rank lower, where no decoy of
 * another species can guard it (bait): it crowns no sooner than the monsters'
 * fourth move. Bait is never a pawn player's motif.
 */
export const GUARD_PAWN_CROWN = 4;
// A monster pawn's moves from `tile` to its last rank (row 7), its double step included.
const crownMoves = (tile) => 7 - tile.y - (tile.y === 1 ? 1 : 0);
// May a decoy of `role` start on `tile`? A pawn only `crown` moves or more from crowning.
const decoyStart = (role, tile, crown = DECOY_PAWN_CROWN) => role !== 'pawn' || crownMoves(tile) >= crown;
/**
 * Where a composed floor may start the player: any square of `wide`, drawn
 * afresh for each motif instance from the floor's seed, so the same pocket or
 * bait comes with a different way in from day to day. COMPOSED_STARTS names
 * the set every edition uses; 'e2' (where random rooms start) is for
 * comparisons in the preview.
 */
const squareOf = (name) => Object.freeze({ x: 'abcdefgh'.indexOf(name[0]), y: 8 - Number(name[1]) });
export const START_SETS = Object.freeze({
  e2: Object.freeze(['e2'].map(squareOf)),
  wide: Object.freeze(['b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'd1', 'e1'].map(squareOf)),
});
export const COMPOSED_STARTS = 'wide';
/**
 * How many pawns make a floor's target: two. A chess army's eight is far too
 * many for a planted line of 3 or 4 moves, and the count rule (one decoy
 * species has as many copies as the target) allows at most two, the most
 * any other piece has. The user chose two over one after playing both
 * (2026-11-10): longer, more forced lines, under more pressure.
 */
export const PAWN_TARGETS = 2;
/**
 * Pawn players. Floors 1 and 2 mix two motifs (the user's choice after
 * playing both, 2026-11-10). Most are 'tempo': the pawn starts on its second
 * rank, and one or two quiet moves (a wait, a step or the double step) time
 * its diagonal takes as each target steps, or marches, into one (two pawns
 * may end in en passant). A tempo line that opens with a wait leaves no
 * square to hint at, and its floor (about a quarter) is 'crown' instead: the
 * pawn starts on its sixth or seventh rank, promotes within the line, and the
 * new queen takes what is left. Crown lines are the more obvious, so they
 * stay the fewer. The king floor mixes three mates too (the user's choice):
 * - 'king': no promotion: the recruit king mates, the pawn's moves closing
 *   the net (never a line of waiting); tried first, it builds on about half
 *   the days;
 * - 'both': the pawn promotes and mates with the recruit king's help (the
 *   recruit guards the queen beside the king, or covers its way out);
 * - 'queen': the pawn walks up, promotes and mates as a queen, needing no help.
 * Where 'king' doesn't build, each day's seed orders the other two (pawnMates).
 * Whichever is planted, the pawn's file is open to the last rank, so it can
 * always promote (the user's rule).
 */
export const PAWN_MATES = Object.freeze(['king', 'both', 'queen']);
// The order a pawn day's king floor tries its mates in: 'king', then the other two as its seed says.
const pawnMates = (seed) => ['king', ...(hash(`${seed}:mates`) % 2 ? ['both', 'queen'] : ['queen', 'both'])];
/** A start set by name, or a list of square names ('c2,d2,e2'). */
export function startSquares(starts = COMPOSED_STARTS) {
  if (Array.isArray(starts)) return starts;
  if (Object.hasOwn(START_SETS, starts)) return START_SETS[starts];
  const squares = String(starts).split(',').filter((name) => /^[a-h][1-8]$/.test(name)).map(squareOf);
  if (!squares.length) throw new Error(`Unknown start set ${starts}.`);
  return squares;
}

/** A room with no start of its own starts the player on e2. */
const HOME = Object.freeze({ x: 4, y: 6 });
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
  constructor(start = HOME) { this.start = start; this.walls = new Set(); this.units = []; this.items = []; this.kept = new Set(); }
  isWall(tile) { return !inside(tile) || this.walls.has(index(tile)); }
  unitAt(tile) { return this.units.find((unit) => same(unit, tile)); }
  free(tile) {
    return !this.isWall(tile) && !this.unitAt(tile) && !this.items.some((item) => same(item, tile))
      && !this.kept.has(index(tile)) && !same(tile, this.start) && !same(tile, EXIT);
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
    const copy = new Plan(this.start);
    copy.walls = new Set(this.walls); copy.units = this.units.map((unit) => ({ ...unit }));
    copy.items = this.items.map((item) => ({ ...item })); copy.kept = new Set(this.kept);
    return copy;
  }
  map() {
    return Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (this.walls.has(y * 8 + x) ? '#' : '.')).join(''));
  }
  // The room as src/rules.js reads it; `start` only where the player doesn't start on e2.
  room() {
    return { map: this.map(), enemies: this.units.map(({ x, y, cast, held }) => ({ x, y, cast, ...(held && { held }) })), items: this.items.map((item) => ({ ...item })),
      ...(!same(this.start, HOME) && { start: { ...this.start } }) };
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
// the first monster (its square included), unless `units` is false.
function reach(plan, piece, from, units = true) {
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
      if (units && plan.unitAt(tile)) break;
    }
  }
  return out;
}
// Fewest moves for `piece` between any of `sources` and every square, over the
// plan's walls with monsters ignored (as src/move-tables.js). A bishop's moves
// run both ways, so it is also each square's distance to `sources`.
function routeDistances(plan, piece, sources) {
  const dist = new Array(64).fill(UNREACHABLE), queue = [];
  for (const tile of sources) if (!plan.isWall(tile) && dist[index(tile)] === UNREACHABLE) { dist[index(tile)] = 0; queue.push(tile); }
  for (let head = 0; head < queue.length; head++) {
    for (const tile of reach(plan, piece, queue[head], false)) {
      if (dist[index(tile)] !== UNREACHABLE) continue;
      dist[index(tile)] = dist[index(queue[head])] + 1;
      queue.push(tile);
    }
  }
  return dist;
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
const SQUARES = Object.freeze(Array.from({ length: 64 }, (_, n) => at(n % 8, n >> 3)));

/** Attempts a slider's king floor gives the day's pocket before trying the next. */
export const NET_TRIES = 20;
/** Walls a slider net's funnel may add, at most: a rook or queen reaches more of the board in two moves. */
export const FUNNEL_WALLS = Object.freeze({ bishop: 6, rook: 8, queen: 10 });
/** Planted routes a slider net tries per pocket before giving it up (a bishop has few enough to try them all). */
export const NET_ROUTES = Object.freeze({ bishop: Infinity, rook: 24, queen: 24 });
/**
 * A slider net's funnel: walls that make the squares the piece mates from
 * (`mates`) a trip of three moves or more, and `most` at most, so no mate
 * comes sooner than a planted line. A bishop reaches most of its colour in
 * two moves, a rook or queen nearly every square, so each wall is the one
 * that lengthens the trip most, or else cuts the most short routes (counted
 * by the first-move squares they start from), ties broken by `rng`; none
 * stands beside the start or on a square the plan keeps open. The distances
 * ignore monsters: the exact search has the last word.
 */
function funnel(plan, piece, mates, rng, most = LINE_MOVES.max) {
  const { start } = plan;
  const measure = () => {
    const dist = routeDistances(plan, piece, mates), near = dist[index(start)];
    return { near, routes: reach(plan, piece, start, false).filter((tile) => dist[index(tile)] === near - 1).length };
  };
  const score = ({ near, routes }) => (near > most ? -1000 : 10 * Math.min(near, LINE_MOVES.min) - (near < LINE_MOVES.min ? routes : 0));
  let now = measure();
  for (let walls = 0; ; walls++) {
    if (now.near >= LINE_MOVES.min && now.near <= most) return true;
    if (walls === FUNNEL_WALLS[piece]) return false;
    let best = null;
    for (const tile of shuffle(SQUARES, rng)) {
      if (chebyshev(tile, start) < 2 || !plan.free(tile)) continue;
      plan.walls.add(index(tile));
      const after = measure();
      plan.walls.delete(index(tile));
      if (!best || score(after) > score(best.after)) best = { tile, after };
    }
    if (!best || score(best.after) <= score(now)) return false;
    plan.walls.add(index(best.tile));
    now = best.after;
  }
}

/**
 * The targets a squeeze can pocket, for each player piece. At home a target
 * must not see the key square, or it winds up there instead of stepping out
 * onto the landing. Where the player covers the landing along a line the
 * target moves on too (a rook against a rook, a queen against anything but a
 * knight), the landing sits beside the key, which the box leaves open, and
 * the pocket points away from the key (alongLine, beyond); the target steps
 * out beside you and is taken before it can strike. No knight against a
 * knight, no bishop against a bishop or queen, and no rook against a queen
 * (none of 757 such pockets held: a queen leaves through the key square).
 */
const SQUEEZES = Object.freeze({ knight: ['rook', 'bishop', 'queen'], bishop: ['rook', 'knight'], rook: ['bishop', 'knight', 'rook'], queen: ['knight', 'bishop', 'rook', 'queen'] });
// Could a monster of `role` on `from` move along the line to `to` (open or not)?
function alongLine(role, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (role === 'knight') return Math.abs(dx * dy) === 2;
  if (role === 'king' || role === 'pawn') return false;
  const straight = dx === 0 || dy === 0, diagonal = Math.abs(dx) === Math.abs(dy);
  return (straight && role !== 'bishop') || (diagonal && role !== 'rook');
}
// Does `tile` lie on the ray from `from` through its neighbour `through`, past it?
function beyond(from, through, tile) {
  const dx = through.x - from.x, dy = through.y - from.y;
  for (let k = 1; k < 8; k++) if (same(at(through.x + dx * k, through.y + dy * k), tile)) return true;
  return false;
}

// The motifs. Each builds a plan for one floor from its context (the player's
// piece, the target role and its copies, the guards it may use) or returns
// null, and says what its planted idea is: `key` (the first move) and, for a
// squeeze, the `landing` squares the targets must step onto.
const MOTIFS = {
  bait(context) {
    if (context.target === 'pawn') return pawnBait(context);
    const { piece, target, count, rng, start } = context;
    const plan = new Plan(start);
    // Two targets wind up at the start square; a lone queen at the square the
    // first move reaches, so the line still takes three moves.
    const bait = count === 2 ? start : shuffle(reachable(piece, start).filter((tile) => tile.y >= 2 && tile.y <= 5), rng)[0];
    if (!bait) return null;
    plan.keep(start, bait);
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
      // Perches may share the start's rank (a rook winds up along it), never sit behind it.
      if (!inside(tile) || same(tile, start) || same(tile, EXIT) || tile.y > 6 || chebyshev(tile, start) < 2) continue;
      if (count === 1 && (covers(target, tile, start) || reachable(target, tile).some((square) => same(square, start)))) continue;
      if (chosen.some((other) => other.dir === perch.dir || chebyshev(other.tile, tile) < 2
        || other.lane.some((square) => same(square, tile)) || perch.lane.some((square) => same(square, other.tile)))) continue;
      chosen.push(perch);
    }
    if (chosen.length < count) return null;
    for (const perch of chosen) plan.keep(...perch.lane);
    for (const perch of chosen) plan.place(0, target, perch.tile);
    for (const perch of chosen) if (!box(plan, target, perch.tile, perch.toward ? [perch.toward] : [])) return null;
    // A lone queen must not see the start square, or it winds up there first.
    if (count === 1) for (const square of between(start, chosen[0].tile)) plan.wall(square);
    // Guards (copies of the matched decoy species) where a target could be
    // taken straight away, and now and then elsewhere for variety.
    for (const perch of chosen) {
      const direct = reachable(piece, start, plan).some((square) => same(square, perch.tile));
      if (!direct && rng() < 0.5) continue;
      const guard = context.guards.shift();
      if (!guard) { if (direct) return null; continue; }
      const spots = shuffle(firstSteps('king', perch.tile).concat(KNIGHT.map(([dx, dy]) => at(perch.tile.x + dx, perch.tile.y + dy))).filter(inside), rng);
      const fits = (role, crown) => spots.find((tile) => plan.free(tile) && covers(role, tile, perch.tile) && !covers(role, tile, bait)
        && !covers(role, tile, start) && decoyStart(role, tile, crown));
      let spot = fits(guard.role), standIn = null;
      // A pawn guard with no square far enough from crowning (DECOY_PAWN_CROWN) gives way to
      // the next guard of another species (which decoy guards a target changes no count),
      // else to one more of the other decoy species, whose count the count rule leaves
      // free; with neither, it may stand a rank lower (GUARD_PAWN_CROWN).
      if (!spot && guard.role === 'pawn') {
        const n = context.guards.findIndex((other) => other.role !== 'pawn' && fits(other.role));
        if (n >= 0) [standIn] = context.guards.splice(n, 1);
        else if (context.unnamed && context.unnamed.role !== 'pawn' && fits(context.unnamed.role)) standIn = { ...context.unnamed };
        spot = standIn ? fits(standIn.role) : fits(guard.role, GUARD_PAWN_CROWN);
      }
      if (!spot) { context.guards.unshift(guard); if (direct) return null; continue; }
      if (standIn) context.guards.unshift(guard);
      const placed = standIn ?? guard;
      plan.place(placed.cast, placed.role, spot);
    }
    return { plan, motif: 'bait' };
  },

  squeeze(context) {
    if (context.target === 'pawn') return pawnSqueeze(context);
    const { piece, target, count, rng, start } = context;
    if (!SQUEEZES[piece].includes(target)) return null;
    const plan = new Plan(start);
    // Two targets: the key square is the first move. A lone queen: the second.
    const first = reachable(piece, start);
    const keys = count === 2 ? first : [...new Set(first.flatMap((tile) => reachable(piece, tile)).map(index))].map((n) => at(n % 8, n >> 3))
      .filter((tile) => !first.some((square) => same(square, tile)) && !same(tile, start));
    const key = shuffle(keys.filter((tile) => tile.y >= 1 && tile.y <= 5), rng)[0];
    if (!key) return null;
    plan.keep(start, key);
    const fromStart = reachable(piece, start);
    const landings = shuffle(reachable(piece, key).filter((tile) => tile.y <= 5 && !same(tile, start) && !fromStart.some((square) => same(square, tile))
      && (!alongLine(target, tile, key) || chebyshev(tile, key) === 1)), rng);
    const pockets = [];
    for (const landing of landings) {
      if (pockets.length === count) break;
      if (pockets.some((pocket) => chebyshev(pocket.landing, landing) < 3)) continue;
      const step = shuffle(firstSteps(target === 'queen' ? 'king' : target, landing), rng).find((tile) => tile.y <= 5
        && !same(tile, start) && !same(tile, key) && !same(tile, EXIT) && !covers(target, tile, key)
        && !reachable(piece, key).some((square) => same(square, tile)) && !fromStart.some((square) => same(square, tile))
        && !(alongLine(target, landing, key) && beyond(tile, landing, key))
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
      if (!box(plan, target, pocket.landing, [pocket.home, ...(alongLine(target, pocket.landing, key) ? [key] : [])])) return null;
      plan.keep(pocket.landing);
    }
    return { plan, motif: 'squeeze', key, landing: pockets.map((pocket) => pocket.landing) };
  },

  fork(context) {
    const { piece, target, count, rng, start } = context;
    if (count !== 2 || !(piece === 'knight' ? ['rook', 'bishop'] : ['rook', 'knight']).includes(target)) return null;
    const plan = new Plan(start);
    const key = shuffle(reachable(piece, start).filter((tile) => tile.y >= 1 && tile.y <= 5), rng)[0];
    if (!key) return null;
    plan.keep(start, key);
    const fromStart = reachable(piece, start);
    const spots = [];
    for (const tile of shuffle(reachable(piece, key), rng)) {
      if (spots.length === 2) break;
      if (tile.y > 5 || same(tile, start) || same(tile, EXIT) || fromStart.some((square) => same(square, tile)) || covers(target, tile, key)) continue;
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
    if (context.piece === 'pawn') return pawnNet(context);
    const { piece, rng, start } = context;
    const slider = Boolean(RAYS[piece]);
    const options = [];
    for (let y = 0; y <= 2; y++) for (let x = 0; x < 8; x++) {
      const home = at(x, y);
      // A knight's pocket is diagonal; a slider's runs along one of its own lines.
      for (const [dx, dy] of slider ? RAYS[piece] : DIAGONAL) {
        const other = at(x + dx, y + dy);
        if (!inside(other) || other.y > 2 || same(home, EXIT) || same(other, EXIT)) continue;
        if (piece === 'knight') {
          // One knight square attacks both squares of the pocket.
          for (const [kx, ky] of KNIGHT) {
            const check = at(x + kx, y + ky);
            if (inside(check) && KNIGHT.some(([ax, ay]) => check.x - other.x === ax && check.y - other.y === ay)
              && chebyshev(check, home) > 1 && chebyshev(check, other) > 1) options.push({ home, other, check, line: [] });
          }
        } else if (piece !== 'bishop' || (x + y) % 2 === (start.x + start.y) % 2) {
          // A check along the pocket's line covers both squares. The far end
          // (`other`) meets the board's edge or a wall. The check comes from
          // any square of the line on the open side, down to the mouth next
          // to `home`, which mates once the king has paced back to `other`
          // (beside the king, the checker would be taken). A wall just past
          // the check square ends the line there. Walls box the pocket in, so
          // no other line reaches it.
          for (let k = 1; k < 8; k++) {
            const check = at(x - dx * k, y - dy * k);
            if (!inside(check) || same(check, start) || same(check, EXIT)) break;
            options.push({ home, other, check, line: between(check, home), cap: at(check.x - dx, check.y - dy) });
          }
        }
      }
    }
    for (const pick of slider ? pocketOrder(options, context) : shuffle(options, rng).slice(0, 48)) {
      const plan = new Plan(start);
      plan.keep(start, pick.check, ...pick.line);
      // A slider's king starts deep in its pocket: two turns from the exit along the line.
      plan.place(0, 'king', slider ? pick.other : pick.home);
      plan.keep(pick.home, pick.other);
      // The pocket's mouth (next to `home`, toward the check) stays open.
      const mouth = slider && chebyshev(pick.check, pick.home) === 1 ? [pick.check] : [];
      if (!box(plan, 'king', pick.home, [pick.other, ...pick.line, ...mouth])) continue;
      if (!box(plan, 'king', pick.other, [pick.home])) continue;
      if (pick.cap && inside(pick.cap) && !plan.wall(pick.cap)) continue;
      // Checkmate wins at once on composed king floors (src/rules.js), so every
      // check square must be three or more moves from the start (the king
      // floor's fallback lets that go).
      if (slider && !context.relaxed) {
        // The slider's way in is planted: a three-move route to a mating
        // square, picked at random, stays open while the funnel walls every
        // faster one, so a pocket needs a different path from day to day. A
        // mate from the mouth alone lands while the pacing king is back at
        // the far end, after an even number of its moves: on the third move.
        const mates = [pick.check, ...pick.line];
        for (const route of shuffle(slideRoutes(plan, piece, mates), rng).slice(0, NET_ROUTES[piece])) {
          const trial = plan.clone();
          trial.keep(...route.passed);
          if (funnel(trial, piece, mates, rng, mouth.length ? LINE_MOVES.min : LINE_MOVES.max) && recruitSquares(trial, piece, trial.units[0]).length) {
            return { plan: trial, motif: 'net', key: pick.check, route: route.moves };
          }
        }
        continue;
      }
      if (!slider) {
        const far = () => { const table = distanceTable(plan.map(), piece); return table[index(start) * 64 + index(pick.check)] >= LINE_MOVES.min; };
        if (!context.relaxed && !far()) continue;
      }
      // (A pocket that leaves the recruit no square fails its dressing; see dress.)
      return { plan, motif: 'net', key: pick.check };
    }
    return null;
  },

  // A pawn player's floors 1 and 2 (see PAWN_MATES' note).
  tempo: (context) => pawnLine(context, 'tempo'),
  crown: (context) => pawnLine(context, 'crown'),

  // The fallback: targets two moves out in an open room, no planted idea.
  walk(context) {
    const { piece, target, count, rng, start } = context;
    const plan = new Plan(start);
    plan.keep(start);
    const table = distanceTable(Array(8).fill('........'), piece);
    const moves = (a, b) => table[index(a) * 64 + index(b)];
    const spots = shuffle(Array.from({ length: 40 }, (_, n) => at(n % 8, n >> 3)), rng)
      .filter((tile) => !same(tile, EXIT) && moves(start, tile) === 2 && !covers(target, tile, start));
    for (const tile of spots) {
      if (plan.units.length === count) break;
      if (plan.units.some((unit) => chebyshev(unit, tile) < 2) || !plan.free(tile)) continue;
      plan.place(0, target, tile);
    }
    return plan.units.length === count ? { plan, motif: 'walk' } : null;
  },
};

// Pawn targets march one square down their file every turn and never leave
// it: a missed lunge stays put and a capture doesn't move them, so their one
// choice is a diagonal strike at you. A wall on the promotion rank under a
// target pawn's file stops it a square short, so a composed floor's pawns
// never crown (random rooms wall most of that rank instead; src/rules.js
// promotionBarricades). On a bishop floor the stop square must be on the
// bishop's colour, or a pawn stopped there could never be taken, so where
// the second rank's square is off it the wall stands there instead.
function barricade(plan, piece, file) {
  const offColour = piece === 'bishop' && (file + 6) % 2 !== (plan.start.x + plan.start.y) % 2;
  return plan.wall(at(file, offColour ? 6 : 7));
}

// Pawn targets: bait. A pawn strikes only the two squares diagonally ahead of
// it, so the two pawns wind up at the start square from just above it. Step
// aside: they lunge, miss and stand off-balance, unable to take back, and you
// take them. A pawn your first move could take spoils it (a bishop or queen
// beside them): a guard on its square would punish the planted capture too.
function pawnBait(context) {
  const { piece, rng, start } = context;
  const plan = new Plan(start);
  plan.keep(start);
  // Never on the second rank of their march (a pawn there may step two).
  const perches = shuffle([-1, 1].map((dx) => at(start.x + dx, start.y - 1)), rng).filter((tile) => inside(tile) && tile.y !== 1 && plan.free(tile));
  if (perches.length < PAWN_TARGETS || perches.some((tile) => reachable(piece, start).some((square) => same(square, tile)))) return null;
  for (const tile of perches) {
    plan.place(0, 'pawn', tile);
    if (!barricade(plan, piece, tile.x)) return null;
  }
  return { plan, motif: 'bait', pawns: true };
}

// Pawn targets: squeeze. The key square, your first move, covers the squares
// the pawns must march onto next (their landings), and a pawn can't decline
// its step: each starts just above its landing.
function pawnSqueeze(context) {
  const { piece, rng, start } = context;
  const plan = new Plan(start);
  const first = reachable(piece, start);
  const key = shuffle(first.filter((tile) => tile.y >= 1 && tile.y <= 5), rng)[0];
  if (!key) return null;
  plan.keep(start, key);
  const fromKey = reachable(piece, key);
  const landings = shuffle(fromKey.filter((tile) => tile.y <= 5 && tile.y >= 1 && tile.y !== 2 && !same(tile, start) && !first.some((square) => same(square, tile))), rng);
  const pockets = [];
  for (const landing of landings) {
    if (pockets.length === PAWN_TARGETS) break;
    if (pockets.some((pocket) => pocket.landing.x === landing.x || chebyshev(pocket.landing, landing) < 2)) continue;
    const home = at(landing.x, landing.y - 1);
    if ([home, landing].some((tile) => same(tile, start) || same(tile, key) || !plan.free(tile))) continue;
    // At home the pawn must not strike the key (it would wind up rather than step), nor stand where you could take it at once.
    if (covers('pawn', home, key) || fromKey.some((square) => same(square, home)) || first.some((square) => same(square, home))) continue;
    pockets.push({ landing, home });
  }
  if (pockets.length < PAWN_TARGETS) return null;
  for (const pocket of pockets) plan.keep(pocket.home, pocket.landing, ...between(key, pocket.landing));
  for (const pocket of pockets) {
    plan.place(0, 'pawn', pocket.home);
    if (!barricade(plan, piece, pocket.landing.x)) return null;
  }
  return { plan, motif: 'squeeze', key, landing: pockets.map((pocket) => pocket.landing) };
}

// Pawn players. A pawn moves only up its file and takes only diagonally, and
// no monster ever steps onto its file (src/rules.js preservesPawnLane), so a
// pawn's planted line is mostly timing: quiet moves bring it where each
// target steps, or marches, into a diagonal just as it gets there.

/** Draws a pawn motif makes per attempt before giving up: each is cheap, and most fail at the board's edge. */
export const PAWN_TRIES = 24;
/** Extra decoys a pawn's floor may add to box its pockets where its own run out (pawnLine). */
export const PAWN_BOX_EXTRAS = 2;
/**
 * The board rows a pawn player starts on (6 is its second rank), by motif and
 * by the king floor's mate. A promoting king floor starts on the sixth or
 * fifth rank, and the queen mates on the move after promotion (a mate on it
 * is a walk up the file).
 */
const PAWN_ROWS = Object.freeze({ tempo: [6], crown: [2, 1], queen: [3, 2], both: [3, 2], king: [6, 5, 4] });
// A pawn's start squares: the start set's files on each of `rows`.
function pawnStarts(squares, rows) {
  const files = [...new Set(squares.map((tile) => tile.x))].sort((a, b) => a - b);
  return rows.flatMap((y) => files.map((x) => at(x, y)));
}
/**
 * A planted pawn line's shape, by motif and target count, one letter a move:
 * 'Q' a quiet pawn move (a wait, a step, or the double step from its second
 * rank), 'T' a diagonal take, 'E' a take en passant, 'Z' a step onto the last
 * rank (promotion) and 'X' the new queen's take.
 */
const PAWN_WORDS = Object.freeze({
  tempo: { 1: ['QQT', 'QQQT'], 2: ['QTT', 'QQTT', 'QTQT', 'QTE'] },
  crown: { 1: ['QZX', 'QQZX'], 2: ['ZXX', 'QZXX', 'QTX'] },
});

// The pawn's planted path from `start` for `word` (PAWN_WORDS): one step per
// letter, { action, to (the square after), passes (squares crossed), take,
// en (en passant), piece (after the move) }. Null when the word doesn't fit:
// off the board, a 'Z' short of the last rank, a pawn move after promotion.
function pawnPath(start, word, rng) {
  const steps = [];
  let square = start, piece = 'pawn', moved = false, lane = null;
  for (const letter of word) {
    if ((letter === 'X') !== (piece === 'queen')) return null;
    let to = square, passes = [], take = false, en = false;
    if (letter === 'Q') {
      const choices = ['wait', 'step', ...(!moved && square.y === 6 ? ['double'] : [])];
      const choice = choices[Math.floor(rng() * choices.length)];
      if (choice !== 'wait') to = at(square.x, square.y - (choice === 'double' ? 2 : 1));
      if (choice === 'double') passes = [at(square.x, square.y - 1)];
    } else if (letter === 'Z') {
      to = at(square.x, square.y - 1);
      if (to.y !== 0) return null;
    } else if (letter === 'T') {
      lane = square.x;
      to = at(square.x + (rng() < 0.5 ? -1 : 1), square.y - 1);
      take = true;
    } else if (letter === 'E') {
      // The target pawn on the file just left, held there by your pawn's lane,
      // double-steps beside you once you take: you land on the square it skipped.
      if (lane === null || square.y !== 3) return null;
      to = at(lane, 2);
      take = en = true;
    } else {
      const [dx, dy] = AROUND[Math.floor(rng() * AROUND.length)], k = 1 + Math.floor(rng() * 4);
      to = at(square.x + dx * k, square.y + dy * k);
      passes = between(square, to);
      take = true;
    }
    if (!inside(to)) return null;
    if (!same(to, square)) moved = true;
    if (piece === 'pawn' && to.y === 0) piece = 'queen';
    steps.push({ action: same(to, square) ? { type: 'wait' } : { type: 'move', x: to.x, y: to.y }, to, passes, take, en, piece });
    square = to;
  }
  return steps;
}

// Wall a target in on `tile` (as box), but leave kept squares (your path, the
// pockets) open: a slider's ray is walled just past them instead. Monsters
// never step onto your pawn's file, which often closes what stays open; the
// exact search has the last word. On a square your pawn may need to climb
// to promote (`climb`), a held decoy (`boxer`) stands in for the wall: it
// wakes once the line is played and must then step off your file. False
// when no decoy is left for such a square.
function pawnBox(plan, role, tile, open, climb = null, boxer = null) {
  for (const step of firstSteps(role, tile)) {
    if (open.some((square) => same(square, step))) continue;
    const dx = step.x - tile.x, dy = step.y - tile.y;
    let square = step;
    while (inside(square) && (plan.kept.has(index(square)) || plan.unitAt(square) || same(square, plan.start))) {
      // A sleeping decoy blocks the ray as a wall would.
      if (!RAYS[role] || plan.unitAt(square)?.held) { square = null; break; }
      square = at(square.x + dx, square.y + dy);
    }
    if (!square || !inside(square)) continue;
    if (climb?.has(index(square))) { if (!boxer(square)) return false; } else plan.wall(square);
  }
  return true;
}

/**
 * Floors 1 and 2 for a pawn player ('tempo' or 'crown'): a planted path
 * (pawnPath), then each target placed to be on its take square just in time.
 * A target pawn marches one square down its file each turn, except while your
 * pawn stands on that file; it never starts on its second rank, where it
 * could step two. Any other target paces a two-square pocket, one step each
 * turn (none onto your pawn's file), and starts on the square that brings it
 * onto its take square after the move before the take. No target starts on
 * your square or where it would take you there at once. The hint's square
 * comes from the line kept (pawnKey). Missing the line, your pawn can still
 * walk up and promote (the user's rule): no wall stands on its file above
 * the start, nor above a take it makes before the last (`climb`); a held
 * decoy from the floor's own (or one more of the other decoy species) boxes a
 * pocket there instead, and steps off the file once it wakes.
 */
function pawnLine(context, kind) {
  // Each try draws a fresh path and pockets; most fail on the board's edge at once.
  for (let tries = 0; tries < PAWN_TRIES; tries++) {
    const built = pawnLineOnce(context, kind);
    if (built) return built;
  }
  return null;
}
function pawnLineOnce(context, kind) {
  const { target, count, rng, start } = context;
  const words = PAWN_WORDS[kind][count].filter((word) => target === 'pawn' || !word.includes('E'));
  const steps = pawnPath(start, words[Math.floor(rng() * words.length)], rng);
  if (!steps || steps.filter((step) => step.take).length !== count || steps[0].take) return null;
  const plan = new Plan(start);
  plan.keep(start, ...steps.flatMap((step) => [step.to, ...step.passes]));
  // Your pawn's file after each move (none once it has promoted): monsters never step there.
  const lanes = steps.map((step) => (step.piece === 'pawn' ? step.to.x : null));
  const takes = steps.map((step, n) => ({ ...step, move: n + 1 })).filter((step) => step.take);
  // The squares your pawn may need to climb to promote: its file above the start, and above each take before the last.
  const climb = new Set();
  const up = (from) => { for (let y = from.y - 1; y >= 0; y--) climb.add(index(at(from.x, y))); };
  up(start);
  for (const take of takes.slice(0, -1)) if (take.piece === 'pawn') up(take.to);
  // Box decoys come from the floor's own, never a pawn (it could never leave your file),
  // then up to PAWN_BOX_EXTRAS more of the other decoy species, whose count the
  // count rule leaves free.
  const pool = [...context.guards], boxes = [];
  let extras = context.unnamed && context.unnamed.role !== 'pawn' ? PAWN_BOX_EXTRAS : 0;
  const boxer = (square) => {
    if (same(square, EXIT)) return true;
    if (!plan.free(square)) return false;
    let n = pool.findIndex((guard) => guard.role !== 'pawn');
    if (n < 0 && extras > 0) { extras--; pool.push({ ...context.unnamed }); n = pool.length - 1; }
    if (n < 0) return false;
    const [guard] = pool.splice(n, 1);
    plan.place(guard.cast, guard.role, square);
    plan.units.at(-1).held = steps.length;
    boxes.push(square);
    return true;
  };
  const pockets = [];
  for (const take of takes) {
    const { to, move } = take;
    if (target === 'pawn') {
      // The march, square by square, from home down to the take square (en passant: two at once, once let go).
      let home;
      if (take.en) home = at(to.x, 1);
      else {
        let y = to.y;
        for (let t = move - 1; t >= 1; t--) if (lanes[t - 1] !== to.x) y--;
        home = at(to.x, y);
      }
      if (home.y < 0 || (home.y === 1 && !take.en) || plan.isWall(home) || plan.unitAt(home) || same(home, start) || covers('pawn', home, start)) return null;
      const march = Array.from({ length: (take.en ? to.y + 1 : to.y) - home.y + 1 }, (_, n) => at(to.x, home.y + n));
      plan.keep(...march);
      plan.place(0, 'pawn', home);
      pockets.push({ role: 'pawn', file: to.x });
      continue;
    }
    // A pocket {take square, other}; the target's steps alternate, but never onto your pawn's file.
    const options = shuffle(firstSteps(target === 'queen' ? 'king' : target, to), rng).filter((tile) => !plan.kept.has(index(tile)) && !plan.unitAt(tile)
      && !same(tile, EXIT) && !climb.has(index(tile)) && !pockets.some((pocket) => pocket.home && chebyshev(pocket.home, tile) < 2));
    let placed = null;
    for (const other of options) {
      for (const first of [to, other]) {
        // Never on your start square (a take square may be, once you have left it), nor striking it.
        if (same(first, start) || covers(target, first, start)) continue;
        let now = first;
        for (let t = 1; t < move; t++) {
          const next = same(now, to) ? other : to;
          if (lanes[t - 1] !== next.x) now = next;
        }
        if (same(now, to)) { placed = { other, first }; break; }
      }
      if (placed) break;
    }
    if (!placed) return null;
    plan.keep(to, placed.other);
    plan.place(0, target, placed.first);
    pockets.push({ role: target, home: placed.other, landing: to });
  }
  for (const pocket of pockets) {
    if (pocket.role === 'pawn') { if (!barricade(plan, 'pawn', pocket.file)) return null; continue; }
    if (!pawnBox(plan, pocket.role, pocket.landing, [pocket.home], climb, boxer) || !pawnBox(plan, pocket.role, pocket.home, [pocket.landing], climb, boxer)) return null;
  }
  context.guards = pool;
  return { plan, motif: kind, pawnLine: true, landing: takes.map((take) => take.to), route: steps.map((step) => step.action), climb, boxes };
}

/**
 * The king floor for a pawn player, by `mate` (PAWN_MATES). The recruit king
 * waits one step up the pawn's file, so the line collects it at once, and the
 * file stays open to the last rank: off the planted line, the pawn can always
 * walk up and promote. For 'queen' and 'both' the pawn does promote; the king
 * paces a two-square pocket along a queen line from the mating square, one
 * queen move from the promotion square (on it too, for the relaxed
 * fallback). 'queen' keeps the queen off the king's squares; 'both' lets it
 * mate beside them, where only the recruit's guard keeps the king from
 * taking it. For 'king' the recruit checks the king from the pocket's one
 * open neighbour while your pawn's diagonal covers its way out; the line is
 * found, not planted, and your pawn's moves must matter (usesIdea). The
 * exact search, and the mate's kind (mateKind), decide.
 */
function pawnNet(context) {
  for (let tries = 0; tries < PAWN_TRIES; tries++) {
    const built = pawnNetOnce(context);
    if (built) return built;
  }
  return null;
}
function pawnNetOnce(context) {
  const { rng, start, mate, relaxed } = context;
  const plan = new Plan(start);
  const recruit = at(start.x, start.y - 1);
  if (!inside(recruit)) return null;
  // Your pawn's file up to the last rank stays open (no walls, no monster starting there).
  const path = Array.from({ length: start.y }, (_, n) => at(start.x, start.y - 1 - n));
  plan.keep(start, ...path);
  // The king starts on `other`, never beside your start square.
  const pocketAt = (home, other, open) => {
    if (![home, other].every((tile) => inside(tile) && plan.free(tile) && tile.x !== start.x) || covers('king', other, start)) return false;
    plan.keep(home, other);
    plan.place(0, 'king', other);
    pawnBox(plan, 'king', home, [other, ...open]);
    pawnBox(plan, 'king', other, [home]);
    return true;
  };
  if (mate === 'king') {
    // The king paces `home` and `other`; the recruit checks it on `home` from
    // `post`, the one open square beside the pocket, out of reach of `other`,
    // which only your pawn's diagonal covers, from `cover` up its file.
    const side = rng() < 0.5 ? -1 : 1;
    const other = at(start.x + side, Math.floor(rng() * 2)), cover = at(start.x, other.y + 1);
    const [dx, dy] = AROUND[Math.floor(rng() * AROUND.length)];
    const home = at(other.x + dx, other.y + dy);
    const posts = AROUND.map(([px, py]) => at(home.x + px, home.y + py)).filter((tile) => inside(tile) && chebyshev(tile, other) > 1 && !same(tile, cover));
    const post = posts[Math.floor(rng() * posts.length)];
    if (!post || home.y > 2 || cover.y >= recruit.y || !inside(home) || home.x === start.x || chebyshev(post, recruit) > LINE_MOVES.max) return null;
    plan.keep(post);
    if (!pocketAt(home, other, [post])) return null;
    plan.items.push({ x: recruit.x, y: recruit.y, type: 'companion', piece: 'king' });
    return { plan, motif: 'net', mate, key: null, relaxed };
  }
  // The pawn promotes on its file's last square.
  const promotion = path.at(-1);
  // The queen mates on the move after promotion; the relaxed fallback may also mate on it.
  const after = start.y + 1 <= LINE_MOVES.max + Number(Boolean(relaxed)) && (!relaxed || rng() < 0.5);
  if (!after && start.y < LINE_MOVES.min) return null;
  let check = promotion;
  if (after) {
    const [dx, dy] = AROUND[Math.floor(rng() * AROUND.length)], k = 1 + Math.floor(rng() * 6);
    check = at(promotion.x + dx * k, promotion.y + dy * k);
    if (!inside(check) || same(check, promotion)) return null;
    plan.keep(check, ...between(promotion, check));
  }
  const [dx, dy] = AROUND[Math.floor(rng() * AROUND.length)];
  const k = (mate === 'both' ? 1 : 2) + Math.floor(rng() * 4);
  const home = at(check.x + dx * k, check.y + dy * k), other = at(home.x + dx, home.y + dy);
  if (home.y > 3 || other.y > 3) return null;
  const line = between(check, home);
  plan.keep(...line);
  if (!pocketAt(home, other, [...line, ...(k === 1 ? [check] : [])])) return null;
  const cap = at(other.x + dx, other.y + dy);
  if (inside(cap)) plan.wall(cap);
  plan.items.push({ x: recruit.x, y: recruit.y, type: 'companion', piece: 'king' });
  const route = [...path, ...(after ? [check] : [])].map((tile) => ({ type: 'move', x: tile.x, y: tile.y }));
  return { plan, motif: 'net', mate, key: check, route, relaxed };
}

/**
 * Who mates on a pawn player's king floor, from the line's positions:
 * 'king' without promotion (the recruit king, or your pawn under its guard),
 * 'queen' when the promoted queen's last move mates with no recruit beside
 * it, 'both' when that same move mates only with the recruit's help.
 */
function mateKind(states, line) {
  const before = states.at(-2), after = states.at(-1);
  if (after.player.piece !== 'queen') return 'king';
  if (!before.companion) return 'queen';
  const alone = act({ ...before, companion: null }, line.at(-1));
  return alone.exit.open && alone.hits === before.hits ? 'queen' : 'both';
}

// The squares a pawn on `start` can walk to without taking anything, over the
// walls of `map`, as src/rules.js unreachablePickups counts them: up its file,
// and once on the last rank, anywhere a queen reaches.
function pawnPickups(map, start) {
  const room = new Plan(start);
  map.forEach((row, y) => [...row].forEach((cell, x) => { if (cell === '#') room.walls.add(y * 8 + x); }));
  const squares = new Set([index(start)]);
  for (let y = start.y - 1; y >= 0 && !room.isWall(at(start.x, y)); y--) {
    squares.add(index(at(start.x, y)));
    if (y === 0) routeDistances(room, 'queen', [at(start.x, 0)]).forEach((moves, n) => { if (moves !== UNREACHABLE) squares.add(n); });
  }
  return squares;
}
// A pawn line's hint square: its first quiet move's before the first take
// (where it comes to rest), else the first take's where a pickup there can be
// reached, else none.
function pawnKey(states, line) {
  const first = line.findIndex((action, n) => states[n + 1].events.some((event) => event.type === 'capture'));
  const quiet = pawnQuiet(states, line);
  if (quiet >= 0) return { x: states[quiet + 1].player.x, y: states[quiet + 1].player.y };
  const take = line[first];
  return take && pawnPickups(states[0].map, states[0].player).has(index(take)) ? { x: take.x, y: take.y } : null;
}
// A pawn line's first quiet move before its first take (pawnKey's), or -1.
function pawnQuiet(states, line) {
  const first = line.findIndex((action, n) => states[n + 1].events.some((event) => event.type === 'capture'));
  return line.slice(0, first).findIndex((action) => action.type === 'move');
}

// A slider's three-move routes from the start to any of `mates` over the
// plan's walls (monsters ignored), landing on no mate before the last move:
// { moves, passed }, `passed` every square the route lands on or crosses.
function slideRoutes(plan, piece, mates) {
  const { start } = plan, routes = [], mate = (tile) => mates.some((square) => same(square, tile));
  for (const first of reach(plan, piece, start, false)) {
    if (mate(first)) continue;
    for (const second of reach(plan, piece, first, false)) {
      if (same(second, start) || mate(second)) continue;
      for (const last of reach(plan, piece, second, false).filter(mate)) {
        routes.push({ moves: [first, second, last], passed: [first, second, last, ...between(start, first), ...between(first, second), ...between(second, last)] });
      }
    }
  }
  return routes;
}

// Where the king floor's recruit may wait: one move from the start, too far
// from the royal king `king` to step beside it within the line.
const recruitSquares = (plan, piece, king) => reach(plan, piece, plan.start).filter((square) => plan.free(square) && chebyshev(square, king) > LINE_MOVES.max + 1);

// The order a slider's net tries its options in. Each day ranks the pockets
// from its own seed: an attempt takes the first one it can build (some never
// can, beside the exit), its checks shuffled, and the day keeps that pocket
// for NET_TRIES attempts before the next in its ranking. So every pocket
// that can be built gets an even share of days, rather than the one that is
// easiest to dress crowding out the rest.
function pocketOrder(options, { seed, attempt, rng }) {
  const pockets = new Map();
  for (const pick of options) {
    const name = `${index(pick.home)}:${index(pick.other)}`;
    pockets.set(name, [...(pockets.get(name) ?? []), pick]);
  }
  const names = shuffle([...pockets.keys()].sort(), random(hash(`${seed}:net-pockets`)));
  const turn = Math.floor(attempt / NET_TRIES) % names.length;
  return [...names.slice(turn), ...names.slice(0, turn)].flatMap((name) => shuffle(pockets.get(name), rng));
}

/**
 * Which motifs fit a player piece and a floor's target role. The king floor
 * always nets. A pawn's floors are tempo lines, but one that opens with a
 * wait (no square to hint at) gives way to a crown line (composeFloor).
 */
export function motifsFor(piece, target, floor) {
  if (floor === 2) return ['net'];
  if (piece === 'pawn') return ['tempo', 'crown'];
  return FLOOR_MOTIFS[floor].filter((motif) => motif !== 'net');
}

// The position at the start of `floor` with `room` there: earlier floors are
// stand-ins whose one target the player takes at once. Nothing that changes
// play carries from floor to floor (a capture only scores), so a floor plays
// the same here as in its day.
const FIRST_TAKE = { knight: at(3, 4), bishop: at(2, 4), rook: at(4, 4), queen: at(2, 4), pawn: at(3, 5) };
const standIn = (piece) => ({ map: Array(8).fill('........'), enemies: [{ ...FIRST_TAKE[piece], cast: 0 }], items: [] });
// `carried`: powers the earlier floors' hints hand on (a bone ward lasts the
// whole run), for the checks that play as a person would.
function floorStart(base, floor, room, carried = null) {
  // On an Ice day a room laid no ice yet has none: the motif, its search and the dressing come first (iceVariants).
  const laid = base.modifier === 'ice' && !room.ice ? { ...room, ice: [] } : room;
  let state = createGame({ ...base, composed: [0, 1, 2].map((f) => (f === floor ? laid : standIn(base.playerPiece))) });
  for (let f = 0; f < floor; f++) {
    state = act(state, { type: 'move', ...FIRST_TAKE[base.playerPiece] });
    state = act(state, { type: 'descend' });
  }
  if (state.floor !== floor || state.status !== 'playing') throw new Error('Stand-in floors did not clear.');
  for (const [power, count] of Object.entries(carried ?? {})) state.powers[power] = Math.min(POWERUPS.find((entry) => entry.id === power).max, state.powers[power] + count);
  return state;
}

// A route's actions from `state`: waiting, and every legal move that picks up
// nothing a certificate may not (powerups, and recruits before the king floor).
function actionsFrom(state) {
  const actions = [{ type: 'wait' }];
  for (const move of legalMoves(state)) {
    const item = state.items.find((entry) => entry.x === move.x && entry.y === move.y);
    if (item && ((item.type === 'powerup' && !item.hint) || (item.type === 'companion' && state.floor !== 2))) continue;
    actions.push({ type: 'move', x: move.x, y: move.y });
  }
  return actions;
}

/**
 * The floor's shortest wins from `start`, by iterative deepening over the
 * player's moves and waits, up to `maxDepth` moves: { depth, lines } (at most
 * `cap` lines, all `depth` moves long, each ending with the floor's challenge
 * complete), or null when nothing wins in time. Each step is a certificate
 * step (src/fairness.js routeTransition): no power used, and never captured
 * but on a pawn's day, whose route may be; there each capture costs a move,
 * so `depth` counts scored moves and a captured line has fewer actions.
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
        const cost = 1 + next.hits - state.hits;
        if (cost > left) continue;
        if (next.exit.open) { lines.push([...path, action]); won = true; } else if (left > cost && search(next, left - cost, [...path, action])) won = true;
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
  // Never captured: a pawn's route may be, but a planted line never is.
  const found = findFloorRoute(start, { maxExpansions: 4000, maxHits: 0 });
  if (found.status !== 'solved') return null;
  const line = found.actions.slice(0, -1);
  return { depth: line.length, lines: [line] };
}

/**
 * The lowest score of a win within `depth` moves that may be captured, as a
 * player in a hurry might play it (taking a guarded target and absorbing the
 * hit): its scored moves, each capture one more (src/rules.js floorScoredMoves).
 * Lines that end the run, or pick up a powerup or recruit, don't count.
 * Infinity when nothing wins in time.
 */
export function hastyScore(start, depth, from = floorScoredMoves(start)) {
  if (depth <= 0) return Infinity;
  let best = Infinity;
  for (const action of actionsFrom(start)) {
    const next = act(start, action);
    if (next === start || next.status !== 'playing' || next.events.some((event) => event.type === 'restart') || next.floor !== start.floor) continue;
    if (next.exit.open) best = Math.min(best, floorScoredMoves(next) - from);
    else best = Math.min(best, hastyScore(next, depth - 1, from));
  }
  return best;
}

// The planted idea's key square: the sidestep a lunge punishes (bait), the
// square covering the landing squares (squeeze) or the mating square (net).
// A move's square is where it comes to rest (on ice, past the square aimed at).
function ideaSquare(built, states, line) {
  if (built.pawnLine) return pawnKey(states, line);
  if (built.motif === 'squeeze' || built.motif === 'net') return built.key;
  if (built.motif !== 'bait') return null;
  const n = sidestep(built, states, line);
  return n >= 0 ? { x: states[n + 1].player.x, y: states[n + 1].player.y } : null;
}
// The bait's sidestep: the line's move after which a lunge lands on the square
// you left (a pawn's misses where it stands), or -1.
function sidestep(built, states, line) {
  return line.findIndex((action, at) => action.type === 'move' && at + 1 < line.length
    && states[at + 1].events.some((event) => event.type === 'miss' && (built.pawns ? isTarget(states[at], event.id) : same(event, states[at].player))));
}
// Does `line` win from `start`, as played (pickups included), never captured?
function winsAsPlayed(start, line) {
  let state = start;
  for (const action of line) {
    const next = act(state, action);
    if (next === state || next.hits > state.hits || next.events.some((event) => event.type === 'restart')) return false;
    state = next;
  }
  return state.exit.open;
}
/**
 * A hint marks the trick's key square, so the trick is findable without
 * every hint being a coin. Floor 1: a coin, or a held decoy standing there,
 * which the key move takes while it sleeps. Floor 2: a coin or a coin magnet
 * (a magnet carried out of floor 1 would sweep up floor 2's hint coin; out of
 * floor 2 it meets only the coinless king floor). The king floor has no hint:
 * its net is found unaided. A coin never changes
 * play; any other hint is kept only if the line still wins with nothing
 * shorter, and the hasty check and bot guard pass. Returns { room, kind }.
 */
function hinted(built, best, line, base, floor, rng, carried) {
  // The king floor's net goes unhinted.
  const square = floor === 2 ? null : ideaSquare(built, best.states, line);
  if (!square) return { room: best.room, kind: null };
  const kinds = shuffle(floor === 0 ? ['coin', 'held'] : ['coin', 'magnet'], rng);
  for (const kind of kinds) {
    const room = structuredClone(best.room);
    if (kind === 'coin') {
      const coin = room.items.find((item) => item.type === 'coin');
      if (coin) Object.assign(coin, { x: square.x, y: square.y, hint: true });
      else room.items.push({ x: square.x, y: square.y, type: 'coin', hint: true });
      return { room, kind };
    }
    if (kind === 'held') {
      // A sleeping decoy boxing a pawn's pocket stays where it is, and a decoy pawn
      // moves no nearer crowning than it may start (DECOY_PAWN_CROWN).
      const roles = [base.species[floor], base.species[3 + floor * 2], base.species[4 + floor * 2]].map((species) => species.piece);
      const sleeper = room.enemies.find((foe) => foe.held && !built.boxes?.some((tile) => same(tile, foe)) && decoyStart(roles[foe.cast], square));
      // It stands there alone: never on a monster already there.
      if (!sleeper || room.enemies.some((foe) => foe !== sleeper && same(foe, square))) continue;
      Object.assign(sleeper, { x: square.x, y: square.y });
    } else room.items.push({ x: square.x, y: square.y, type: 'powerup', power: kind, hint: true });
    const start = floorStart(base, floor, room, carried);
    if (winsAsPlayed(start, line) && (kind !== 'held' || !shortestWins(start, line.length - 1))
      && hastyScore(start, BOT_GUARD.short) > BOT_GUARD.short && botGuard(start, base, floor, line.length + 1).ok) return { room, kind };
  }
  return { room: best.room, kind: null };
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
  // The verdict is settled at the first short run or the miss that tips the share, so the runs stop there.
  // A run past par + 4 is a miss however it ends, so it stops there too.
  for (let run = 0; run < BOT_GUARD.runs && short === 0 && missed <= BOT_GUARD.missShare * BOT_GUARD.runs; run++) {
    const result = playFloor(start, { seed: runSeed(base, floor, run), cap: par + BOT_GUARD.slack + 1 });
    if (result.won && result.moves <= BOT_GUARD.short) short++;
    if (!result.won || result.moves > par + BOT_GUARD.slack) missed++;
  }
  return { ok: short === 0 && missed <= BOT_GUARD.missShare * BOT_GUARD.runs, short, missed };
}

// The positions of a line (playLine) if the player is never captured along it
// and the floor's challenge completes on its last move, as a certificate's, else null.
const clean = (states) => (states && states.every((state, n) => state.hits === states[0].hits && (n === states.length - 1 || !state.exit.open)) ? states : null);
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
  if (built.pawnLine) {
    // A quiet first move, and every target taken on a planted take square.
    return !states[1].events.some((event) => event.type === 'capture') && line.every((action, n) => action.type !== 'move'
      || !states[n + 1].events.some((event) => event.type === 'capture' && isTarget(states[n], event.id)) || built.landing.some((tile) => same(tile, action)));
  }
  if (built.mate) {
    // The mate this net plants (any, relaxed), on a move of yours, never one waited out.
    if (line.at(-1).type !== 'move' || line.filter((action) => action.type === 'wait').length > 1 || !(built.relaxed || mateKind(states, line) === built.mate)) return false;
    // Where the recruit king helps, your own moves must matter too: standing still once it
    // joins ('king'), or once you promote ('both'), the recruit alone can't mate as soon.
    const still = built.mate === 'king' ? 1 : states.findIndex((state) => state.player.piece === 'queen');
    if (built.relaxed || built.mate === 'queen' || still >= line.length) return true;
    const lazy = playLine(states[0], line.map((action, n) => (n < still ? action : { type: 'wait' })));
    return !lazy?.some((state) => state.exit.open);
  }
  if (built.motif === 'bait' && built.pawns) {
    // A target pawn strikes at the square the player just left, misses, and a target is taken next.
    return line.some((action, n) => n + 1 < line.length && action.type === 'move'
      && states[n + 1].events.some((event) => event.type === 'miss' && isTarget(states[n], event.id))
      && line[n + 1].type === 'move' && states[n + 1].enemies.some((foe) => same(foe, line[n + 1]) && isTarget(states[n + 1], foe.id)));
  }
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

/**
 * Ice days (src/modifiers.js): each composed room lays its ICE_TILES ice
 * tiles around its planted line instead of the day's seeded draw. Where the
 * line's move onto its key square (keyMove) runs two squares or more along a
 * line, the line aims one square short, on ice, and skids onto the key
 * square: 'lock' ices the key square too, so a move aimed straight at it
 * skids past it (where the square beyond is open and empty then), and only
 * the skid stops there; 'skid' ices only the square before it. Every other
 * tile ('off', and the rest of those two) lies off the line: on no square it
 * moves to or comes to rest on, and never on a wall, under a monster or a
 * pickup, on the start or on the exit (as the seeded draw). Ice can't make a
 * slider's line shorter: a skid only ends where the slider could have moved
 * straight away, so ice just takes stops from it. A pawn's skid goes a square
 * further than its step, so its variants are tried with tiles anywhere off
 * the line, then off the files it walks. The variants to judge, best first:
 * { kind, room, line }.
 */
function iceVariants(room, line, states, built, rng) {
  const start = room.start ?? HOME;
  const taken = new Set([...room.enemies, ...room.items, start, EXIT].map(index));
  const usable = (tile) => inside(tile) && room.map[tile.y][tile.x] !== '#' && !taken.has(index(tile));
  // The squares the line moves to or comes to rest on.
  const onLine = new Set([...line.filter((action) => action.type === 'move'), ...states.map((state) => state.player)].map(index));
  const off = shuffle(SQUARES.filter((tile) => usable(tile) && !onLine.has(index(tile))), rng);
  const files = new Set(states.filter((state) => state.player.piece === 'pawn').map((state) => state.player.x));
  const pools = files.size ? [off, off.filter((tile) => !files.has(tile.x))] : [off];
  const variants = [];
  const add = (kind, tiles, trial) => {
    for (const pool of pools) {
      const ice = [...tiles, ...pool.filter((tile) => !tiles.some((other) => same(other, tile)))].slice(0, ICE_TILES)
        .map(({ x, y }) => ({ x, y })).sort((a, b) => a.y - b.y || a.x - b.x);
      // Off its files from the start, a pawn's second pool would only repeat the first.
      if (variants.at(-1)?.kind === kind && JSON.stringify(variants.at(-1).room.ice) === JSON.stringify(ice)) continue;
      variants.push({ kind, line: trial, room: { ...room, ice } });
    }
  };
  const n = keyMove(built, states, line);
  const skid = n >= 0 ? skidOnto(states, line, n, (tile) => usable(tile) && !onLine.has(index(tile))) : { miss: 'key' };
  // Why no skid fits, for the trace: no key move, a capture, a knight's or king's move, one square, the square short of it taken.
  variants.miss = skid.miss ?? null;
  if (!skid.miss) {
    const aimed = line.map((action, at) => (at === n ? { type: 'move', x: skid.aim.x, y: skid.aim.y } : action));
    if (skid.lock && usable(skid.key)) add('lock', [skid.aim, skid.key], aimed);
    add('skid', [skid.aim], aimed);
  }
  add('off', [], line);
  return variants;
}
// The line's move onto its planted idea's key square, or -1: the squeeze's
// key square, the bait's sidestep, a net's mate (its last move) or a pawn
// line's first quiet move before its first take (its hint square).
function keyMove(built, states, line) {
  if (built.pawnLine) return pawnQuiet(states, line);
  if (built.motif === 'net') return line.at(-1).type === 'move' ? line.length - 1 : -1;
  if (built.motif === 'squeeze') return line.findIndex((action, n) => action.type === 'move' && same(states[n + 1].player, built.key));
  if (built.motif === 'bait') return sidestep(built, states, line);
  return -1;
}
// A skid onto where the line's move `n` comes to rest: a slider, or a pawn
// moving straight, that runs there two squares or more and takes nothing can
// aim one square short instead (`aim`, which must suit `fits`) and skid on.
// `lock` when the square beyond is open and empty as the move is made, so ice
// on the key square too would carry a move aimed at it past it. Where no skid
// fits, { miss } says why.
function skidOnto(states, line, n, fits) {
  const before = states[n], after = states[n + 1];
  // A move onto a monster takes it, which never skids (checkmate's capture of the king comes after the move).
  if (line[n].type !== 'move' || before.enemies.some((foe) => same(foe, line[n]))) return { miss: 'capture' };
  const from = before.player, to = after.player;
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  if (!(RAYS[from.piece] || (from.piece === 'pawn' && dx === 0))) return { miss: 'piece' };
  if (chebyshev(from, to) < 2) return { miss: 'short' };
  const aim = at(to.x - dx, to.y - dy), beyond = at(to.x + dx, to.y + dy);
  if (!fits(aim)) return { miss: 'aim' };
  const lock = inside(beyond) && before.map[beyond.y][beyond.x] !== '#' && !before.enemies.some((foe) => same(foe, beyond))
    && !(before.companion && same(before.companion, beyond));
  return { aim, key: at(to.x, to.y), lock };
}

// Turns of the line on which a decoy presses the player: a wind-up lane on
// the player's square, or a decoy guarding a square the player could move to.
function pressure(states) {
  let turns = 0;
  for (const state of states.slice(0, -1)) {
    const lane = state.enemies.some((foe) => foe.phase === 'aim' && foe.intent.some((tile) => same(tile, state.player)));
    const guarded = legalMoves(state).some((move) => { const foe = closeAttacker(state, move); return foe && foe.role !== state.objective.piece; });
    if (lane || guarded) turns++;
  }
  return turns;
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

// Every piece moves every turn, so decoys roam free: each starts two to four
// of its own moves from the planted line, close enough to press in while it
// plays out, never beside the start. Then the coins, the powerup and the
// recruit go off the line, on squares the player can reach.
function dress(plan, context, line, base, floor, rng) {
  const { start } = plan;
  const lineSquares = [start, ...line.filter((action) => action.type === 'move')];
  plan.keep(...lineSquares);
  const far = (tile, gap) => lineSquares.every((square) => chebyshev(square, tile) >= gap) && plan.units.every((unit) => chebyshev(unit, tile) >= 2);
  const squares = Array.from({ length: 64 }, (_, n) => at(n % 8, n >> 3));
  // Held decoys may wait closer (one to three moves out): they wake right on top of a slow solver.
  const held = FLOOR_DECOYS[floor] === 'held';
  const [near, away] = held ? [1, 3] : [2, 4];
  for (const decoy of context.quiet) {
    const moves = distanceTable(plan.map(), decoy.role === 'pawn' ? 'king' : decoy.role);
    const reach = (tile) => Math.min(...lineSquares.map((square) => moves[index(tile) * 64 + index(square)]));
    const spots = shuffle(squares, rng).filter((tile) => plan.free(tile) && chebyshev(tile, start) >= 2 && !covers(decoy.role, tile, start)
      && plan.units.every((unit) => chebyshev(unit, tile) >= 2) && !(decoy.role === 'pawn' && context.climb?.has(index(tile))) && decoyStart(decoy.role, tile));
    const spot = spots.find((tile) => reach(tile) >= near && reach(tile) <= away) ?? spots[0];
    if (!spot) return null;
    plan.place(decoy.cast, decoy.role, spot);
    if (held) plan.units.at(-1).held = line.length;
  }
  const table = distanceTable(plan.map(), context.piece);
  const moves = (tile) => table[index(start) * 64 + index(tile)];
  // A pawn picks things up only where it can walk without taking anything.
  const walk = context.piece === 'pawn' ? pawnPickups(plan.map(), start) : null;
  const safe = (tile) => plan.free(tile) && moves(tile) !== UNREACHABLE && !plan.units.some((unit) => covers(unit.role, unit, tile)) && (!walk || walk.has(index(tile)));
  const open = shuffle(Array.from({ length: 64 }, (_, n) => at(n % 8, n >> 3)), rng).filter(safe);
  const coinless = floor === 2;
  const coins = coinless ? [] : open.filter((tile) => far(tile, 1)).slice(0, 3);
  for (const tile of coins) plan.items.push({ x: tile.x, y: tile.y, type: 'coin' });
  // Floors 1 and 2 keep coins off the line as red herrings; the king floor has no hint and no items but its recruit.
  if (floor === 2 && context.piece === 'pawn') {
    // A pawn's net placed its recruit already, one step up its file (pawnNet).
  } else if (floor === 2) {
    // The king floor's recruit, a king, waits one move from the start, as always,
    // too far from the royal king to step beside it within the line. Every king
    // floor has one: a dressing whose decoys took its squares is tried again.
    const king = plan.units.find((unit) => unit.role === 'king' && unit.cast === 0);
    const tile = shuffle(reach(plan, context.piece, start), rng).find((square) => recruitSquares(plan, context.piece, king).some((spot) => same(spot, square)));
    if (!tile) return null;
    plan.items.push({ x: tile.x, y: tile.y, type: 'companion', piece: 'king' });
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
// (copies of the matched decoy species, as many as the target has) and the
// rest, which wait walled in. On the king floor every decoy waits.
function castFor(base, floor) {
  const target = base.targets[floor];
  const count = target === 'pawn' ? PAWN_TARGETS : PIECE_COUNTS[target];
  const species = [base.species[floor], base.species[3 + floor * 2], base.species[4 + floor * 2]];
  const suspect = matchedDecoy(base, floor) ?? species[1];
  const suspectCast = species[1].id === suspect.id ? 1 : 2;
  const otherCast = 3 - suspectCast;
  const copies = Math.min(count, PIECE_COUNTS[species[suspectCast].piece]);
  const suspects = Array.from({ length: copies }, () => ({ cast: suspectCast, role: species[suspectCast].piece }));
  const other = { cast: otherCast, role: species[otherCast].piece };
  // The other decoy species (`other`), whose count the count rule leaves free.
  return { target, count, suspects, other, unnamed: other, matched: copies === count };
}

/**
 * Compose one floor of `base` (a raw daily with its tier, its modifier and
 * floorSeeds). Returns { room, line, motif, depth, firstMoves, forced, tried,
 * kept, ms }: `tried` and `kept` count motif instances built and accepted per
 * motif (`replayed` those whose planted idea won within the line's length).
 * On an Ice day `ice` says how the room's ice meets the line (iceVariants).
 */
export function composeFloor(base, floor, { trace, carried = null, starts = startSquares() } = {}) {
  const began = performance.now();
  const piece = base.playerPiece;
  const icy = base.modifier === 'ice';
  const cast = castFor(base, floor);
  const seed = base.floorSeeds[floor];
  const stats = {};
  // A pawn's king floor nets each of its mates in turn ('net:king', …; PAWN_MATES).
  const preferred = piece === 'pawn' && floor === 2 ? pawnMates(seed).map((mate) => `net:${mate}`) : motifsFor(piece, cast.target, floor);
  // A pawn's unhinted tempo floor, kept until a crown floor takes its place.
  let spare = null;
  for (const motif of [...preferred, 'walk']) {
    if (motif === 'walk' && spare) return { ...spare, ms: performance.now() - began };
    const [name, mate = null] = motif.split(':');
    const tally = (stats[motif] ??= { built: 0, replayed: 0, kept: 0 });
    const attempts = motif === 'walk' ? MOTIF_ATTEMPTS * 4 : MOTIF_ATTEMPTS;
    // A pawn's fallback is no open walk but its own motif, relaxed: a tempo line, or on
    // the king floor any mate after promotion, either up to a move longer.
    const pawnFallback = piece === 'pawn' && motif === 'walk';
    // Checks the open walk skips (the hasty check, a shorter win).
    const loose = motif === 'walk' && !pawnFallback;
    // A pawn starts on the start set's files, on its motif's rows (the king floor's, by its mate).
    const pool = piece === 'pawn' ? pawnStarts(starts, PAWN_ROWS[floor === 2 ? (pawnFallback ? 'queen' : mate) : pawnFallback ? 'tempo' : motif]) : starts;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const rng = random(hash(`${seed}:${motif}:${attempt}`));
      // The instance's start, from a stream of its own (with one start, the rest draws as before).
      const square = pool.length === 1 ? pool[0] : pool[Math.floor(random(hash(`${seed}:${motif}:${attempt}:start`))() * pool.length)];
      const context = { piece, target: cast.target, count: cast.count, rng, seed, attempt, start: square, guards: [...cast.suspects, cast.other], mate: pawnFallback ? 'queen' : mate,
        unnamed: cast.unnamed };
      const built = pawnFallback ? (floor === 2 ? pawnNet({ ...context, relaxed: true }) : pawnLine(context, 'tempo'))
        : motif === 'walk' && floor === 2 ? MOTIFS.net({ ...context, relaxed: true }) : MOTIFS[name](context);
      if (!built) { trace?.({ motif, attempt, stage: 'build' }); continue; }
      tally.built++;
      // Decoys the motif didn't use as guards wait walled in.
      context.quiet = context.guards;
      // A pawn decoy never waits where a pawn may need to climb to promote (it could never leave that file).
      if (built.climb) context.climb = built.climb;
      const start = floorStart(base, floor, built.plan.room());
      const found = pawnFallback ? shortestWins(start, LINE_MOVES.max + 1) : motif === 'walk' ? (floor === 2 ? shortestWins(start, 6) : walkRoute(start)) : shortestWins(start, LINE_MOVES.max);
      const shortest = loose ? 2 : LINE_MOVES.min;
      if (!found || found.depth < shortest) { trace?.({ motif, attempt, stage: 'search', depth: found?.depth ?? null, room: built.plan.room() }); continue; }
      // A planted route (a net's, a pawn's) is the line whenever the search finds it among the shortest.
      const follows = (line) => Boolean(built.route) && line.length === built.route.length
        && line.every((action, n) => action.type === (built.route[n].type ?? 'move') && (action.type !== 'move' || same(action, built.route[n])));
      // Lines with every move scored and none a capture (a pawn's search counts captured lines too).
      const candidates = found.lines.filter((line) => line.length === found.depth).map((line) => ({ line, states: playLine(start, line) }))
        .filter(({ line, states }) => states && usesIdea(built, states, line));
      const planted = candidates.find(({ line }) => follows(line)) ?? candidates[0];
      if (!planted) { trace?.({ motif, attempt, stage: 'idea', depth: found.depth, lines: found.lines, room: built.plan.room() }); continue; }
      tally.replayed++;
      // The dressed room's checks, for `line` and its positions `states` from `dressed`: the line
      // wins and (a pawn's) uses the idea, nothing wins sooner or in a hasty two (the exact
      // checks), and the bot guard passes. { hasty } when the room passes, else null. Without
      // `exact` only the line and the guard are checked, `hasty` taken as known.
      const judge = (room, dressed, line, states, wins, { exact = true, guarded = true, hasty: known = Infinity } = {}) => {
        // The search runs unpowered; the hasty check and bot guard start with what earlier hints carried in.
        const real = carried ? floorStart(base, floor, room, carried) : dressed;
        const hasty = !exact ? known : !states?.at(-1).exit.open || loose ? Infinity : hastyScore(real, BOT_GUARD.short);
        // A pawn's idea (its takes, its mate's kind) is checked again on the dressed room.
        const idea = exact && (built.pawnLine || built.mate) && states?.at(-1).exit.open && !usesIdea(built, states, line);
        const why = !states?.at(-1).exit.open ? 'line' : idea ? 'idea' : loose || !exact ? null : shortestWins(dressed, wins.depth - 1) ? 'shorter' : hasty <= BOT_GUARD.short ? 'hasty' : null;
        if (why) { trace?.({ motif, attempt, stage: `redress:${why}`, room, line }); return null; }
        if (!guarded) return { hasty };
        // The open walk is no puzzle, so the bot guard doesn't judge it (or run); a pawn's
        // fallback is still a puzzle, judged until its last tries.
        const judged = motif !== 'walk' || (pawnFallback && attempt < attempts - MOTIF_ATTEMPTS);
        const guard = judged ? botGuard(real, base, floor, line.length + 1) : { ok: true };
        if (!guard.ok) { tally.guarded = (tally.guarded ?? 0) + 1; trace?.({ motif, attempt, stage: 'bot', ...guard, room }); return null; }
        return { hasty };
      };
      let best = null;
      for (let dressing = 0; dressing < DRESS_ATTEMPTS && !(best?.pressure >= 2); dressing++) {
        const plan = dress(built.plan.clone(), context, planted.line, base, floor, random(hash(`${seed}:${motif}:${attempt}:dress:${dressing}`)));
        if (!plan) { trace?.({ motif, attempt, stage: 'dress' }); continue; }
        const room = plan.room();
        const dressed = floorStart(base, floor, room);
        // The line as dressed, never captured (a pawn's route may be, but not a planted line).
        let { line } = planted, wins = found, states = clean(playLine(dressed, line));
        // A pawn's line may change with the dressing: where decoys spoil it, the dressed
        // room's own shortest win stands in, if it still uses the idea.
        if (piece === 'pawn' && !(states && usesIdea(built, states, line))) {
          const again = shortestWins(dressed, found.depth);
          const fit = again?.depth >= shortest ? again.lines.filter((other) => other.length === again.depth).map((other) => ({ other, after: clean(playLine(dressed, other)) }))
            .find(({ other, after }) => after && usesIdea(built, after, other)) : null;
          if (fit) { line = fit.other; states = fit.after; wins = again; }
        }
        // On an Ice day a dressing that passes the exact checks without ice gets its ice laid
        // around the line, each way of laying it (iceVariants, best first) judged in turn, the
        // first to pass kept. A slider's ice only takes stops away, so its exact checks still
        // hold and only the line and the bot guard are judged again; a pawn's skid can open a
        // shortcut, so a pawn's are judged in full.
        const plain = icy && states?.at(-1).exit.open ? judge(room, dressed, line, states, wins, { guarded: false }) : null;
        if (icy && states?.at(-1).exit.open && !plain) continue;
        const trials = plain ? iceVariants(room, line, states, built, random(hash(`${seed}:${motif}:${attempt}:dress:${dressing}:ice`))) : [{ room, line, dressed, states }];
        if (trials.miss !== undefined) trace?.({ motif, attempt, stage: 'ice', offered: trials.map((trial) => trial.kind), miss: trials.miss });
        for (const trial of trials) {
          const start = trial.dressed ?? floorStart(base, floor, trial.room);
          const after = trial.states ?? clean(playLine(start, trial.line));
          const passed = judge(trial.room, start, trial.line, after, wins, plain ? { exact: piece === 'pawn', hasty: plain.hasty } : {});
          if (!passed) continue;
          const felt = pressure(after);
          if (!best || felt > best.pressure) best = { room: trial.room, states: after, hasty: passed.hasty, pressure: felt, line: trial.line, wins, ...(trial.kind && { ice: trial.kind }) };
          break;
        }
      }
      if (best) {
        tally.kept++;
        const { line, wins } = best;
        const { room, kind } = hinted(built, best, line, base, floor, random(hash(`${seed}:${motif}:${attempt}:hint`)), carried);
        const composed = {
          room, hint: kind, line, motif: name, depth: wins.depth, firstMoves: new Set(wins.lines.map((other) => JSON.stringify(other[0]))).size,
          ...(piece === 'pawn' && floor === 2 && { mate: mateKind(best.states, line) }),
          lines: wins.lines.length, forced: forcedShare(best.states), pressure: best.pressure, matched: cast.matched, lifeTrade: best.hasty < line.length,
          ...(best.ice && { ice: best.ice }), stats, ms: performance.now() - began,
        };
        // A pawn's tempo line with nothing to hint at (it opens with a wait) gives way to a crown line, if one composes.
        if (piece === 'pawn' && motif === 'tempo' && !kind) { spare = composed; break; }
        return composed;
      }
    }
  }
  throw new Error(`No floor composed for ${base.date} floor ${floor + 1}.`);
}

/**
 * A composed day for a canonical date: the raw daily with the Fair monsters
 * and its modifier, a composed room per floor and the planted lines as its
 * certificate, proved by src/generation.js proveComposed. `floors` describes
 * each floor. `tier` composes under other monsters, and `daily` overrides the
 * raw daily (tooling: synthetic casts, or another modifier); `starts` the
 * start set (startSquares).
 */
export function composeDay(date, { tier, daily: raw = getRawDaily(date), starts } = {}) {
  const squares = startSquares(starts);
  const base = { ...raw, difficulty: tier ?? COMPOSED_TIER, modifier: raw.modifier ?? 'none', floorSeeds: composedSeeds(raw.date) };
  delete base.generation;
  // Floors compose in order: a hint's powerup lasts the run, so each floor's checks see what came before.
  const floors = [], carried = {};
  for (const floor of [0, 1, 2]) {
    floors.push(composeFloor(base, floor, { carried: Object.keys(carried).length ? { ...carried } : null, starts: squares }));
    const prize = floors.at(-1).room.items.find((item) => item.hint && item.type === 'powerup');
    if (prize) carried[prize.power] = (carried[prize.power] ?? 0) + 1;
  }
  const actions = floors.flatMap((floor) => [...floor.line, { type: 'descend' }]);
  const daily = { ...base, composed: floors.map((floor) => floor.room) };
  // Proved as every edition is when it loads (on its twin without hint powerups, then as played),
  // every position along the way a valid save.
  const proof = proveComposed(daily, actions, { saves: true });
  if (!proof.valid) throw new Error(`Composed day ${raw.date} failed its proof: ${proof.reason}`);
  daily.generation = { version: GENERATOR_VERSION, source: 'composed', motifs: floors.map((floor) => floor.motif), certificate: { actions, metrics: proof.metrics } };
  return { daily, floors };
}
