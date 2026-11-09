// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// A bot that plays like a careful person, for par. The certificate search
// (src/fairness.js) proves a day can be won, but its route leans on things no
// player sees, so par comes from this bot instead (src/par.js), and the gap
// between the two says how hard a day is to figure out (src/difficulty.js).
//
// It knows what a player knows: the board, the items, the red wind-up lanes,
// the floor's target role and which species is the target (as if the
// newspaper clue were solved), and the role of a species once one of them has
// been captured. It never reads a hidden role and never simulates the
// monsters' replies. A monster whose role it doesn't know counts as dangerous
// up close: the squares next to it and a knight's jump from it are unsafe.
// It weighs its own moves on the board as it stands: can it take a target
// next move, will it have a safe square to go to, how far is the target.
//
// Habits, in order: take a target when that's safe; never end a move in a
// red lane or where a monster could take it at once; close in on the nearest
// target by the safest short way (squares no monster strikes up close, or the
// wall-aware move tables of src/move-tables.js when there is none); pick up
// the recruit when it's about on the way; take a decoy when that costs
// nothing; otherwise wait, since monsters often walk into range. It steers
// its recruit as a player on Manual recruit control (the default) would
// (src/recruit-policy.js), so par assumes a steered recruit. No shopping, and
// it never goes out of its way for a powerup: it steps on one only when it
// stands on its pawn's file ahead, the pawn's one way forward.
//
// Each floor is played from its standard start, the position the certified
// route reaches there, so one floor's par never depends on another's.
import { createGame, act, legalMoves, floorScoredMoves, scoredMoves } from './rules.js';
import { distanceTable, UNREACHABLE } from './move-tables.js';
import { HUMAN_MOVE_CAP } from './difficulty.js';
import { hash, random } from './random.js';
import { steerRecruit } from './recruit-policy.js';

/** Bump when the bot's play or its runs change, so remembered pars are recomputed. */
export const HUMAN_BOT_VERSION = 3;
/**
 * Seeded runs per floor; par is the median of the ones that succeed. Forty,
 * not five: a five-run reading of the capped human gap a day is aimed with
 * (src/generation.js) scattered by 1.2 to 2.2 on the same edition, nearly a
 * whole day's step; forty runs cut that to about a third (docs/generation.md).
 */
export const HUMAN_RUNS = 40;
// A run that hasn't completed its floor in HUMAN_MOVE_CAP moves gives up. It
// lives in difficulty.js, beside humanGap, so that difficulty.js imports no
// game module: the monsters (src/monster-ai.js) read its tiers as they load.
export { HUMAN_MOVE_CAP };
/** Par on a floor every run failed: the certified route's moves plus 25%, rounded up. */
export const failedFloorPar = (certified) => Math.ceil(certified * 1.25);

const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
const ORTHOGONAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const SLIDES = { rook: true, bishop: true, queen: true };
const same = (a, b) => a.x === b.x && a.y === b.y;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const knightJump = (a, b) => KNIGHT.some(([dx, dy]) => a.x + dx === b.x && a.y + dy === b.y);
const index = (square) => square.y * 8 + square.x;
const open = (view, x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 && view.map[y][x] !== '#';

/**
 * What a player can see: everything the bot decides from. Monsters carry the
 * piece they move as only when a player could know it: the target species'
 * role, a species unmasked by a capture (`known`, species → role), or a
 * crowned (promoted) pawn's queen. Red lanes are the wind-ups on the board.
 * `powerups` are the relics the bot keeps off, which is all of them but one
 * standing on its pawn's file ahead (pawnPath).
 */
export function observe(state, known = new Map()) {
  const targetSpecies = state.species[state.floor]?.id;
  const recruit = state.items.find((item) => item.type === 'companion');
  return {
    map: state.map, floor: state.floor, objective: state.objective.piece, exitOpen: state.exit.open,
    player: { x: state.player.x, y: state.player.y, piece: state.player.piece, hp: state.player.hp },
    companion: state.companion ? { x: state.companion.x, y: state.companion.y, piece: state.companion.piece } : null,
    recruit: recruit ? { x: recruit.x, y: recruit.y, piece: recruit.piece } : null,
    powerups: state.items.filter((item) => item.type === 'powerup' && !pawnPath(state.player, item)).map(({ x, y }) => ({ x, y })),
    monsters: state.enemies.map((foe) => ({
      id: foe.id, species: foe.species, x: foe.x, y: foe.y, target: foe.species === targetSpecies,
      piece: foe.promoted ? 'queen' : foe.species === targetSpecies ? state.objective.piece : known.get(foe.species) ?? null,
      lane: foe.phase === 'aim' ? foe.intent.map(({ x, y }) => ({ x, y })) : null,
    })),
  };
}

// Is `item` on a pawn's way forward: on its own file, ahead of it? A pawn only
// moves up its file (or takes diagonally), so a relic there blocks it. A
// person walks onto it, and so does the bot, though it never goes out of its
// way for a powerup otherwise (stepping onto one applies it, as for anyone).
// On pawn days the room's relic lies on the pawn's starting file, rows 2-3.
function pawnPath(player, item) {
  return player.piece === 'pawn' && item.x === player.x && item.y < player.y;
}

// Would a monster moving as `piece` on `foe`'s square take a player standing
// on `square` at once? Only neighbors and knights strike without a wind-up,
// each by its own moves; a pawn beside a pawn's double step takes it en passant.
function strikesUpClose(piece, foe, square, doubleStep) {
  const dx = square.x - foe.x, dy = square.y - foe.y;
  if (piece === 'knight') return knightJump(foe, square);
  if (chebyshev(foe, square) !== 1) return false;
  if (piece === 'pawn') return dx !== 0 && (dy === 1 || (doubleStep && dy === 0));
  if (piece === 'rook') return dx === 0 || dy === 0;
  if (piece === 'bishop') return dx !== 0 && dy !== 0;
  return true;
}
const ROLES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
/** A certain hit, on the risk() scale. */
export const SURE_HIT = 6;

/**
 * How risky ending a move on `square` looks, with the monsters in `gone`
 * (ids) taken: SURE_HIT for a red lane through it or a known monster that
 * would strike there at once, and for each monster of unknown role the same
 * scaled by the share of its possible roles that would (any role but the
 * floor's target, whose members are all the target species), at most
 * SURE_HIT (a move costs at most one life). 0 is safe. `doubleStep` marks a
 * pawn's double step (en passant); `lanes: false` leaves out the red lanes,
 * which move with the monsters.
 */
export function risk(view, square, gone = [], { doubleStep = false, lanes = true } = {}) {
  let total = 0;
  for (const foe of view.monsters) {
    if (gone.length && gone.includes(foe.id)) continue;
    if (lanes && foe.lane?.some((tile) => same(tile, square))) return SURE_HIT;
    const dx = Math.abs(foe.x - square.x), dy = Math.abs(foe.y - square.y);
    if (dx > 2 || dy > 2 || (Math.max(dx, dy) !== 1 && dx + dy !== 3)) continue;
    if (foe.piece) { if (strikesUpClose(foe.piece, foe, square, doubleStep)) return SURE_HIT; continue; }
    let roles = 0, strikes = 0;
    for (const role of ROLES) {
      if (role === view.objective) continue;
      roles++;
      if (strikesUpClose(role, foe, square, doubleStep)) strikes++;
    }
    total += SURE_HIT * strikes / roles;
  }
  return Math.min(SURE_HIT, total);
}

const monsterAt = (view, x, y, gone) => view.monsters.find((foe) => foe.x === x && foe.y === y && !gone.includes(foe.id));

// Is the line from `from` to `to` free of monsters for a slider (walls are
// already in the move table)?
function lineOpen(view, piece, from, to, gone) {
  if (!SLIDES[piece]) return true;
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  for (let x = from.x + dx, y = from.y + dy; x !== to.x || y !== to.y; x += dx, y += dy) {
    if (monsterAt(view, x, y, gone)) return false;
  }
  return true;
}

// Where the player's `piece` could move from `from` on the board as it stands
// (walls and monsters, the ones in `gone` taken), never onto a relic: the
// bot's own look one move further ahead.
function movesFrom(view, piece, from, gone) {
  const moves = [];
  const add = (x, y) => { if (!view.powerups.some((item) => item.x === x && item.y === y)) moves.push({ x, y }); };
  if (piece === 'pawn') {
    if (open(view, from.x, from.y - 1) && !monsterAt(view, from.x, from.y - 1, gone)) {
      add(from.x, from.y - 1);
      if (from.y === 6 && open(view, from.x, from.y - 2) && !monsterAt(view, from.x, from.y - 2, gone)) add(from.x, from.y - 2);
    }
    for (const dx of [-1, 1]) if (monsterAt(view, from.x + dx, from.y - 1, gone)) add(from.x + dx, from.y - 1);
  } else if (SLIDES[piece]) {
    for (const [dx, dy] of piece === 'rook' ? ORTHOGONAL : piece === 'bishop' ? DIAGONAL : [...ORTHOGONAL, ...DIAGONAL]) {
      for (let x = from.x + dx, y = from.y + dy; open(view, x, y); x += dx, y += dy) {
        add(x, y);
        if (monsterAt(view, x, y, gone)) break;
      }
    }
  } else {
    for (const [dx, dy] of piece === 'knight' ? KNIGHT : [...ORTHOGONAL, ...DIAGONAL]) if (open(view, from.x + dx, from.y + dy)) add(from.x + dx, from.y + dy);
  }
  return moves;
}

/**
 * How cornered a square looks: 2 when the bot could not step from it to any
 * square no monster strikes up close, 1 with just one such square, else 0.
 */
function cornered(view, piece, from, gone) {
  let escapes = 0;
  for (const move of movesFrom(view, piece, from, gone)) {
    const victim = monsterAt(view, move.x, move.y, gone);
    if (!risk(view, move, victim ? [...gone, victim.id] : gone, { lanes: false }) && ++escapes > 1) return 0;
  }
  return 2 - escapes;
}

// The bot never steps on a relic, so to a pawn (which lands on every square of
// its file) a relic is a wall.
function tableFor(view, piece) {
  if (piece !== 'pawn' || !view.powerups.length) return distanceTable(view.map, piece);
  const map = view.map.map((row, y) => [...row].map((cell, x) => (view.powerups.some((item) => item.x === x && item.y === y) ? '#' : cell)).join(''));
  return distanceTable(map, piece);
}

// Moves for a pawn on `from` to reach row 0 straight up its file, or
// UNREACHABLE when a wall or relic is in the way.
function promotionDistance(view, from) {
  for (let y = from.y - 1; y >= 0; y--) {
    if (!open(view, from.x, y) || view.powerups.some((item) => item.x === from.x && item.y === y)) return UNREACHABLE;
  }
  return from.y === 6 ? 5 : from.y;
}

// Squares a rook, bishop, queen, knight or king could move to from `square`
// (an index) on the board as it stands: lines stop at walls and at the first
// monster, whose square is included. These pieces move both ways alike, so
// these are also the squares it could have come from.
function neighbors(view, piece, square, occupied) {
  const x0 = square % 8, y0 = (square - x0) / 8, found = [];
  if (SLIDES[piece]) {
    for (const [dx, dy] of piece === 'rook' ? ORTHOGONAL : piece === 'bishop' ? DIAGONAL : [...ORTHOGONAL, ...DIAGONAL]) {
      for (let x = x0 + dx, y = y0 + dy; open(view, x, y); x += dx, y += dy) {
        found.push(y * 8 + x);
        if (occupied.has(y * 8 + x)) break;
      }
    }
  } else {
    for (const [dx, dy] of piece === 'knight' ? KNIGHT : [...ORTHOGONAL, ...DIAGONAL]) if (open(view, x0 + dx, y0 + dy)) found.push((y0 + dy) * 8 + x0 + dx);
  }
  return found;
}

/**
 * The safe way to a target, as a person plans one: for every square, the
 * fewest moves for `piece` from there to take a target (two more if a monster
 * guards it), stepping only on empty squares no monster strikes up close as
 * the board stands, with the monsters in `gone` taken. Infinity where there's
 * no such way. Not for a pawn, which only moves up the board.
 */
export function safeRoutes(view, piece, gone = []) {
  const monsters = view.monsters.filter((foe) => !gone.includes(foe.id));
  const occupied = new Set(monsters.map(index));
  const ground = { ...view, monsters };
  const dist = new Array(64).fill(Infinity), buckets = [];
  const reach = (square, moves) => { if (moves < dist[square]) { dist[square] = moves; (buckets[moves] ??= []).push(square); } };
  for (const target of monsters) {
    if (target.target) for (const square of neighbors(ground, piece, index(target), occupied)) reach(square, 1 + (risk(ground, target, [target.id], { lanes: false }) ? 2 : 0));
  }
  for (let moves = 1; moves < buckets.length; moves++) {
    for (const square of buckets[moves] ?? []) {
      const x = square % 8, y = (square - x) / 8;
      if (dist[square] !== moves || occupied.has(square) || view.powerups.some((item) => item.x === x && item.y === y) || risk(ground, { x, y }, [], { lanes: false })) continue;
      for (const before of neighbors(ground, piece, square, occupied)) reach(before, moves + 1);
    }
  }
  return dist;
}

/**
 * Moves until the bot could take a target, standing on `from` as `piece`,
 * with the monsters in `gone` taken. A rook, bishop, queen, knight or king
 * takes its safe route (safeRoutes; pass `routes` to reuse one) when there is
 * one. Otherwise, and for a pawn, it's the move table's wall-aware distance,
 * one more when a monster blocks the last line, two more for a guarded target
 * (taking it now would be unsafe), and three more for having no safe way. A
 * target the piece can never land on (a bishop's other color) counts by its
 * nearest open neighbor, plus two: it has to step there first. A pawn goes
 * after a king only once promoted (a pawn can't catch a dodging king). 0 once
 * no target is left.
 */
export function approach(view, from, piece, gone = [], routes = null) {
  if (!view.monsters.some((foe) => foe.target && !gone.includes(foe.id))) return 0;
  if (piece !== 'pawn') {
    const safe = (routes ?? safeRoutes(view, piece, gone))[index(from)];
    if (safe !== Infinity) return safe;
  }
  return tableApproach(view, from, piece, gone) + (piece === 'pawn' ? 0 : 3);
}

function tableApproach(view, from, piece, gone) {
  const table = tableFor(view, piece);
  const row = index(from) * 64;
  let best = Infinity;
  for (const target of view.monsters) {
    if (!target.target || gone.includes(target.id)) continue;
    let moves = table[row + index(target)];
    if (target.piece === 'king' && piece === 'pawn') {
      const promote = promotionDistance(view, from);
      moves = promote === UNREACHABLE ? 20 : promote + Math.min(4, distanceTable(view.map, 'queen')[from.x * 64 + index(target)]);
    } else if (moves === UNREACHABLE) {
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const x = target.x + dx, y = target.y + dy;
        if (open(view, x, y) && table[row + y * 8 + x] !== UNREACHABLE) moves = Math.min(moves, table[row + y * 8 + x] + 2);
      }
      if (moves === UNREACHABLE) moves = 20;
    } else {
      if (moves === 1 && !lineOpen(view, piece, from, target, gone)) moves = 2;
      if (risk(view, target, [...gone, target.id], { lanes: false })) moves += 2;
    }
    best = Math.min(best, moves);
  }
  return best === Infinity ? 0 : best;
}

/** No recruit order: the recruit moves on its own, as on Auto (for measurement). */
export const autoRecruit = () => undefined;
/**
 * The bot's recruit policy unless told otherwise: it steers the recruit like
 * a Manual player (src/recruit-policy.js). Par, the result card's run and the
 * human gap all come from it.
 */
export const defaultRecruit = steerRecruit;

/**
 * A run's habits, drawn once from its seed: how many waits in a row before it
 * tries a move that doesn't gain ground, and whether it bothers with the
 * recruit (always on the last floor, whose recruit is a king).
 */
function styleFor(rng, floor) {
  const patience = 1 + Math.floor(rng() * 3);
  return { patience, recruit: rng() < 0.8 || floor === 2 };
}

/**
 * The bot's next action on `view` (from observe()), choosing among the
 * engine's legal moves. `memory` holds its streak of waits and the squares
 * it has stood on this floor.
 */
export function decide(view, legal, memory, rng, style) {
  if (view.exitOpen) return { type: 'descend' };
  const here = view.player;
  const options = [];
  const plans = new Map();
  const routes = (piece, gone) => {
    if (piece === 'pawn') return null;
    const key = `${piece}:${gone.join()}`;
    if (!plans.has(key)) plans.set(key, safeRoutes(view, piece, gone));
    return plans.get(key);
  };
  for (const move of legal) {
    const landing = move.slide ?? { x: move.x, y: move.y };
    // Relics activate on contact, and the bot plays without powerups. It
    // leaves castling (rare here, and its landing isn't the square clicked) alone.
    if (move.castle || view.powerups.some((item) => same(item, landing))) continue;
    const victim = view.monsters.find((foe) => foe.x === move.x && foe.y === (move.enPassant ? move.y + 1 : move.y));
    const gone = victim ? [victim.id] : [];
    const piece = here.piece === 'pawn' && landing.y === 0 ? 'queen' : here.piece;
    const doubleStep = here.piece === 'pawn' && here.y === 6 && landing.y === 4;
    const risky = risk(view, landing, gone, { doubleStep });
    // Cost: moves to the next target, plus a little for a square with no way out.
    const cost = approach(view, landing, piece, gone, routes(piece, gone)) + (risky ? 0 : cornered(view, piece, landing, gone));
    options.push({
      move, victim, recruit: Boolean(view.recruit && same(view.recruit, landing)), risk: risky, cost,
      visits: memory.visits.get(index(landing)) ?? 0, noise: rng(),
    });
  }
  // Waiting resolves nothing on the player's square: only red lanes threaten it.
  const lane = view.monsters.some((foe) => foe.lane?.some((tile) => same(tile, here)));
  const stay = { risk: lane ? SURE_HIT : 0, cost: approach(view, here, here.piece, [], routes(here.piece, [])) + (lane ? 0 : cornered(view, here.piece, here, [])) };
  const safe = options.filter((option) => !option.risk);
  // Ties go to fresh squares and captures (a decoy taken unmasks its species), then to the seed.
  const rank = (option) => option.cost + 0.3 * option.visits - (option.victim ? 0.5 : 0) + 0.2 * option.noise;
  const best = (list, value = rank) => list.reduce((top, option) => (!top || value(option) < value(top) ? option : top), null);
  const go = (option) => { memory.waits = 0; return { type: 'move', x: option.move.x, y: option.move.y }; };

  // A safe capture of a target, the one that leaves the next target nearest.
  const take = best(safe.filter((option) => option.victim?.target), (option) => option.cost + 0.2 * option.noise);
  if (take) return go(take);
  const closest = best(safe);
  const lead = Math.min(stay.cost, closest?.cost ?? Infinity);
  // The recruit, when it costs at most a move.
  const recruit = style.recruit && safe.find((option) => option.recruit && option.cost <= lead + 1);
  if (recruit) return go(recruit);
  // Gain ground, or take a decoy that costs none.
  if (closest && (stay.risk || closest.cost < stay.cost || (closest.victim && closest.cost <= stay.cost))) return go(closest);
  if (!stay.risk && memory.waits < style.patience) { memory.waits++; return { type: 'wait' }; }
  // Out of patience: a sideways move that keeps the target about as close.
  const sideways = best(safe.filter((option) => option.cost <= stay.cost + 1));
  if (sideways) return go(sideways);
  if (!stay.risk) { memory.waits++; return { type: 'wait' }; }
  // Nothing is safe and staying is a sure hit: the least risky step (an
  // unknown neighbor only might strike), even one as risky as staying.
  const least = best(options, (option) => option.risk * 3 + rank(option));
  return least && least.risk <= stay.risk ? go(least) : { type: 'wait' };
}

/**
 * One seeded run's player for the floor that `start` begins: `choose(state)`
 * picks its next action, and `saw(previous, next)` tells it what that action
 * led to (a capture unmasks the taken monster's species). `recruit` is the
 * recruit policy: given the state, the chosen action and the view, it may
 * return an order to add to the action; undefined leaves the recruit to move
 * on its own that turn. It steers by default (defaultRecruit); autoRecruit
 * leaves the recruit on Auto.
 */
export function humanPlayer(start, { seed, recruit = defaultRecruit } = {}) {
  const rng = random(seed >>> 0);
  const style = styleFor(rng, start.floor);
  const memory = { waits: 0, visits: new Map([[index(start.player), 1]]) };
  const known = new Map();
  return {
    choose(state) {
      const view = observe(state, known);
      const choice = decide(view, legalMoves(state), memory, rng, style);
      const order = recruit(state, choice, view);
      return order === undefined ? choice : { ...choice, recruit: order };
    },
    saw(previous, next) {
      for (const event of next.events) {
        if (event.type !== 'capture' && event.type !== 'companion-capture') continue;
        const foe = previous.enemies.find((entry) => entry.id === event.id);
        if (foe) known.set(foe.species, foe.role ?? foe.piece);
      }
      memory.visits.set(index(next.player), (memory.visits.get(index(next.player)) ?? 0) + 1);
    },
  };
}

/**
 * Play one floor from `start` (a state at the start of a floor) with one
 * seeded run. Returns whether it completed the floor's challenge (`won`)
 * within `cap` moves without losing its last life, its scored moves there
 * (or those it played before failing), the lives it lost, its actions, and,
 * with `frames`, every position. `recruit` is the recruit policy (humanPlayer).
 */
export function playFloor(start, { seed, recruit = defaultRecruit, cap = HUMAN_MOVE_CAP, frames: keep = false } = {}) {
  const player = humanPlayer(start, { seed, recruit });
  const floor = start.floor, hp = start.player.hp, actions = [], frames = keep ? [start] : null;
  let state = start;
  const result = (won, moves = floorScoredMoves(state), livesLost = hp - state.player.hp) => ({ won, moves, livesLost, actions, frames, state });
  while (state.status === 'playing' && state.floor === floor && !state.exit.open && floorScoredMoves(state) < cap) {
    const action = player.choose(state);
    const next = act(state, action);
    if (next === state) return result(false);
    actions.push(action);
    frames?.push(next);
    // The last life lost starts the whole dungeon over: the run failed here.
    if (next.events.some((event) => event.type === 'restart')) return result(false, floorScoredMoves(state) + 1, hp);
    player.saw(state, next);
    state = next;
  }
  return result(state.status === 'playing' && state.floor === floor && state.exit.open);
}

/**
 * The certified route's standard floor starts: the position at the start of
 * each floor as the certificate reaches it, its scored moves per floor, and
 * the frames of the whole route. Null without a replayable certificate.
 */
export function certifiedFloors(daily) {
  const actions = daily?.generation?.certificate?.actions;
  if (!Array.isArray(actions) || !actions.length) return null;
  let state = createGame(daily);
  const starts = [state], frames = [state];
  for (const action of actions) {
    const next = act(state, action);
    if (next === state) return null;
    if (next.floor !== state.floor && next.status === 'playing') starts.push(next);
    frames.push(next);
    state = next;
  }
  if (state.status !== 'won' || starts.length !== 3) return null;
  return { starts, frames, floors: state.records.map(scoredMoves) };
}

/**
 * The seed of a run: the date, the floor's own seed (src/rules.js floorSeed),
 * the floor and the run number, never the move count. So a floor's runs are the
 * same in any day assembled with it.
 */
export const runSeed = (daily, floor, run) => hash(`human:${daily.date}:${daily.floorSeeds?.[floor] ?? daily.dungeonSeed ?? daily.seed}:${floor}:${run}`);

/**
 * Par for a certified edition from `runs` seeded runs per floor, each from the
 * floor's standard start, steering the recruit (`recruit`, defaultRecruit):
 * par assumes Manual recruit control. A floor's par is the lower median of the scored
 * moves of its successful runs, and `runs[floor]` names a run with exactly
 * that count (medianRun; the one the result card replays). A floor no run
 * completes gets failedFloorPar() of the certified route's moves and a null
 * run. `certified` holds the route's own moves per floor; `results` every
 * run's outcome (for measurement). Null without a replayable certificate.
 */
export function humanPar(daily, { runs = HUMAN_RUNS, recruit = defaultRecruit } = {}) {
  const certified = certifiedFloors(daily);
  if (!certified) return null;
  const par = [], shown = [], results = [];
  for (let floor = 0; floor < 3; floor++) {
    const outcomes = Array.from({ length: runs }, (_, run) => {
      const { won, moves, livesLost } = playFloor(certified.starts[floor], { seed: runSeed(daily, floor, run), recruit });
      return { won, moves, livesLost };
    });
    results.push(outcomes);
    const { par: value, run } = medianRun(outcomes, certified.floors[floor]);
    par.push(value); shown.push(run);
  }
  return { par, runs: shown, certified: certified.floors, results };
}

/**
 * A floor's par and shown run from its runs' outcomes (see humanPar): of the
 * runs with exactly par's moves, the one that lost the fewest lives, then the first.
 */
export function medianRun(outcomes, certified) {
  const moves = outcomes.filter((outcome) => outcome.won).map((outcome) => outcome.moves).sort((a, b) => a - b);
  if (!moves.length) return { par: failedFloorPar(certified), run: null };
  const par = moves[Math.floor((moves.length - 1) / 2)];
  let run = -1;
  outcomes.forEach((outcome, index) => {
    if (outcome.won && outcome.moves === par && (run < 0 || outcome.livesLost < outcomes[run].livesLost)) run = index;
  });
  return { par, run };
}

/**
 * The human-like bot's whole dungeon for the result card: on each floor the
 * run `runs[floor]` played from that floor's standard start, stitched into
 * one list of frames (each floor opens on its standard start; the last frame
 * takes the stairs out). Same shape as botRun(), plus `livesLost`. Null if
 * any floor has no run, a run doesn't complete its floor, or the three lost
 * as many lives as the piece has (as one run it would not have survived).
 * Each run is played again from its seed with the same recruit policy as
 * humanPar, which is deterministic, so its recruit orders come out the same
 * and nothing but the run numbers needs storing.
 */
export function humanRun(daily, runs, { recruit = defaultRecruit } = {}) {
  if (!Array.isArray(runs) || runs.length !== 3 || !runs.every((run) => Number.isInteger(run) && run >= 0)) return null;
  const certified = certifiedFloors(daily);
  if (!certified) return null;
  const frames = [], floors = [];
  let livesLost = 0, turns = 0;
  for (let floor = 0; floor < 3; floor++) {
    const result = playFloor(certified.starts[floor], { seed: runSeed(daily, floor, runs[floor]), recruit, frames: true });
    if (!result.won) return null;
    frames.push(...result.frames);
    floors.push(result.moves); livesLost += result.livesLost; turns += result.actions.length;
  }
  const out = act(frames.at(-1), { type: 'descend' });
  if (out.status !== 'won' || livesLost >= certified.starts[0].player.hp) return null;
  frames.push(out);
  return { frames, turns, moves: floors.reduce((sum, moves) => sum + moves, 0), floors, livesLost };
}
