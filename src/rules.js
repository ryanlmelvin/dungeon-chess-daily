// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { PIECES, PIECE_COUNTS, PIECE_LIVES } from './pieces.js';
import { hash, hashMore, random } from './random.js';
import { getRawDaily, shopStock } from './edition.js';
import { setupFloorModifier, iceSlide, collapseTick, extraPopulation, reinforcementOptions, validModifierState } from './modifiers.js';
import { breakTactics, scoreTactics, tacticGold, validTactics, TACTIC_KINDS, TACTIC_EVENTS } from './tactics.js';
import { chooseMonsterMove, safeToStrike, safeCloseIn, screenStep } from './monster-ai.js';
import { caveInTick, cavedIn, validCaveIn, CAVE_IN_EVENTS } from './cave-in.js';
import { openPromotionFiles } from './difficulty.js';
export { PIECES, PLAYABLE_PIECES, PIECE_COUNTS, PIECE_LIVES } from './pieces.js';
export const RULES_VERSION = 10;
const ORTHOGONAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
export const POWERUPS = Object.freeze([
  { id: 'shield', name: 'Bone ward', cost: 3, max: 3, description: 'Block one capture. Stacks up to three.' },
  // Found in rooms only: sold in the shop, a stack of frozen moves won the last floor before any monster moved.
  { id: 'freeze', name: 'Frost hourglass', cost: 2, max: 6, sold: false, description: 'Freeze every monster for three moves.' },
  { id: 'magnet', name: 'Coin magnet', cost: 4, max: 1, description: 'Collect coins within two tiles after every move.' },
  // Shop-only tools, used when you choose. None ever lies in a room.
  { id: 'pin', name: 'Pin', cost: 4, max: 1, description: 'Hold one monster still for three moves. Floor 2 only.' },
  { id: 'leap', name: 'Borrowed move', cost: 3, max: 1, description: 'Once, move like a knight (or like a queen if you’re a knight).' },
  { id: 'takeback', name: 'Take-back', cost: 4, max: 1, description: 'Undo one move, even one that cost a life.' },
]);
/** How long a pin holds, in monster turns. */
export const PIN_MOVES = 3;
/** The piece a Borrowed move moves like: a knight, or a queen for a knight. */
export const borrowedPiece = (state) => (state.player.piece === 'knight' ? 'queen' : 'knight');
const pinned = (foe) => foe.pinned > 0;
// A monster that lunged and missed is off-balance until the player's next move
// ends (enemyTurn): like a pinned one, it can't capture at all.
const offBalance = (foe) => foe.offBalance === true;
/** The state a Take-back returns to, or null when there is nothing to take back. */
export function takebackTarget(state) {
  return state?.status === 'playing' && state.undo?.powers?.takeback > 0 ? state.undo : null;
}
/** One life beyond the piece's army count, at most one per shop visit. */
export const EXTRA_LIFE = Object.freeze({ id: 'life', name: 'Extra life', cost: 10, description: 'One more life for this run. Limit 1.' });
/**
 * A pin works only before the last floor, whose target is the king. Earlier
 * floors never target the king, so a king there is a decoy, and a pin holds it
 * like any other monster: refusing it would point it out.
 */
export const pinUsable = (state) => state.floor < state.targets.length - 1;
/** What the between-floor shop offers, in display order. */
export const SHOP_ITEMS = Object.freeze(['shield', 'pin', 'leap', 'takeback', 'magnet'].map((id) => POWERUPS.find((power) => power.id === id)).concat(EXTRA_LIFE));
/** The ids the shop after `floor` offers today (src/edition.js). */
export function shopOffers(state, floor = state.floor) {
  return floor >= 2 ? [] : shopStock(state.date, floor);
}
// Older saves may hold hourglasses bought before they left the shop.
const purchaseCost = (id) => (id === EXTRA_LIFE.id ? EXTRA_LIFE : POWERUPS.find((power) => power.id === id))?.cost;
const livesBought = (purchases) => purchases.filter((id) => id === EXTRA_LIFE.id).length;
export const COMPANIONS = Object.freeze([
  { id: 'companion-pawn', piece: 'pawn', name: 'Pawn', cost: 2 },
  { id: 'companion-knight', piece: 'knight', name: 'Knight', cost: 4 },
  { id: 'companion-bishop', piece: 'bishop', name: 'Bishop', cost: 4 },
  { id: 'companion-rook', piece: 'rook', name: 'Rook', cost: 5 },
  { id: 'companion-queen', piece: 'queen', name: 'Queen', cost: 8 },
  { id: 'companion-king', piece: 'king', name: 'King', cost: 3 },
]);
function same(a, b) { return a.x === b.x && a.y === b.y; }
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function inside(x, y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 8 && y < 8; }
export function walkable(state, x, y) { return inside(x, y) && state.map?.[y]?.[x] !== '#'; }
// Hot in the certification search: a plain loop, no closure per call.
export function enemyAt(state, x, y) {
  const { enemies } = state;
  for (let i = 0; i < enemies.length; i++) if (enemies[i].x === x && enemies[i].y === y) return enemies[i];
  return undefined;
}

// Shared, never mutated: a queen's rays and a king's steps.
const EIGHT_WAYS = Object.freeze([...ORTHOGONAL, ...DIAGONAL]);
function rays(piece) {
  if (piece === 'rook') return ORTHOGONAL;
  if (piece === 'bishop') return DIAGONAL;
  if (piece === 'queen') return EIGHT_WAYS;
  return null;
}

function movesFor(state, unit, enemy = false, attacksOnly = false) {
  const moves = [];
  // The squares monsters stand on, as two 32-square bit masks, so an empty
  // square skips enemyAt's scan.
  let low = 0, high = 0;
  for (const foe of state.enemies) {
    if (!inside(foe.x, foe.y)) continue;
    const bit = foe.y * 8 + foe.x;
    if (bit < 32) low |= 1 << bit; else high |= 1 << (bit - 32);
  }
  const monsterOn = (x, y) => {
    if (!inside(x, y)) return enemyAt(state, x, y);
    const bit = y * 8 + x;
    return ((bit < 32 ? low >>> bit : high >>> (bit - 32)) & 1) ? enemyAt(state, x, y) : undefined;
  };
  const occupant = (x, y) => {
    if (enemy && state.companion && state.companion.x === x && state.companion.y === y) return 'friend';
    if (unit === state.companion && state.player.x === x && state.player.y === y) return 'friend';
    const foe = monsterOn(x, y);
    if (foe && foe !== unit) return enemy ? 'friend' : 'opponent';
    if (enemy && state.player.x === x && state.player.y === y && state.player.hp) return 'opponent';
    return null;
  };
  const push = (x, y, requireCapture = false) => {
    if (!walkable(state, x, y)) return false;
    const occupied = occupant(x, y);
    if (occupied === 'friend') return false;
    if (!requireCapture || occupied === 'opponent' || attacksOnly) moves.push({ x, y, capture: occupied === 'opponent' });
    return occupied === null;
  };
  if (unit.piece === 'pawn') {
    const forward = enemy ? 1 : -1;
    if (!attacksOnly && walkable(state, unit.x, unit.y + forward) && !occupant(unit.x, unit.y + forward)) {
      push(unit.x, unit.y + forward);
      if (!unit.moved && unit.y === (enemy ? 1 : 6) && !occupant(unit.x, unit.y + 2 * forward)) push(unit.x, unit.y + 2 * forward);
    }
    for (const dx of [-1, 1]) push(unit.x + dx, unit.y + forward, true);
  } else if (rays(unit.piece)) {
    for (const [dx, dy] of rays(unit.piece)) {
      for (let step = 1; step < 8; step++) if (!push(unit.x + dx * step, unit.y + dy * step)) break;
    }
  } else {
    for (const [dx, dy] of unit.piece === 'knight' ? KNIGHT : EIGHT_WAYS) push(unit.x + dx, unit.y + dy);
  }
  return moves;
}

// movesFor's occupant, standalone: 'friend', 'opponent' or null.
function occupantFor(state, unit, enemy, x, y) {
  const { companion, player } = state;
  if (enemy && companion && companion.x === x && companion.y === y) return 'friend';
  if (unit === companion && player.x === x && player.y === y) return 'friend';
  const foe = enemyAt(state, x, y);
  if (foe && foe !== unit) return enemy ? 'friend' : 'opponent';
  if (enemy && player.x === x && player.y === y && player.hp) return 'opponent';
  return null;
}

/**
 * Would movesFor(state, unit, enemy) list a capture on (x, y), with the unit
 * moving like `piece`? The same verdict without building the move list: the
 * monster AI asks it of every square it weighs.
 */
function capturesAt(state, unit, enemy, x, y, piece = unit.piece) {
  // The geometry first: it's the cheapest test and usually decides.
  const dx = x - unit.x, dy = y - unit.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const lines = rays(piece);
  if (piece === 'pawn' ? !(ax === 1 && dy === (enemy ? 1 : -1))
    : !lines ? !(piece === 'knight' ? ax + ay === 3 && ax > 0 && ay > 0 : Math.max(ax, ay) === 1)
    : !(((dx === 0) !== (dy === 0) && lines !== DIAGONAL) || (ax === ay && ax > 0 && lines !== ORTHOGONAL))) return false;
  if (!walkable(state, x, y) || occupantFor(state, unit, enemy, x, y) !== 'opponent') return false;
  if (piece === 'pawn' || !lines) return true;
  // A line piece: every square between must be open.
  const n = Math.max(ax, ay);
  if (n > 7) return false;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (let k = 1; k < n; k++) {
    const cx = unit.x + sx * k, cy = unit.y + sy * k;
    if (!walkable(state, cx, cy) || occupantFor(state, unit, enemy, cx, cy) !== null) return false;
  }
  return true;
}
// Would monster `foe` capture the player from where it stands?
function strikesPlayer(state, foe) {
  return capturesAt(state, foe, true, state.player.x, state.player.y);
}

/**
 * The squares movesFor(state, unit, true, true) lists for a monster, as a set
 * (`has`) with their `count`, without building the list: the monster AI asks
 * it of every step it weighs.
 */
class Reach {
  constructor(low, high, count) { this.low = low; this.high = high; this.count = count; }
  has(square) {
    if (!inside(square.x, square.y)) return false;
    const bit = square.y * 8 + square.x;
    return Boolean((bit < 32 ? this.low >>> bit : this.high >>> (bit - 32)) & 1);
  }
}
const PAWN_STRIKES = Object.freeze([[-1, 1], [1, 1]]);
function attackReach(state, unit) {
  const ux = unit.x, uy = unit.y;
  // Off the grid (never in play) nothing is inside the board: movesFor lists nothing.
  if (!Number.isInteger(ux) || !Number.isInteger(uy)) return new Reach(0, 0, 0);
  const { map, companion, player } = state;
  // The squares monsters stand on, so an empty square skips enemyAt's scan.
  let monstersLow = 0, monstersHigh = 0;
  for (const foe of state.enemies) {
    if (!inside(foe.x, foe.y)) continue;
    const bit = foe.y * 8 + foe.x;
    if (bit < 32) monstersLow |= 1 << bit; else monstersHigh |= 1 << (bit - 32);
  }
  const lines = rays(unit.piece);
  const directions = unit.piece === 'pawn' ? PAWN_STRIKES : lines ?? (unit.piece === 'knight' ? KNIGHT : EIGHT_WAYS);
  const longest = lines ? 7 : 1;
  let low = 0, high = 0, count = 0;
  for (const [dx, dy] of directions) {
    for (let step = 1; step <= longest; step++) {
      // movesFor's push with attacksOnly: an unwalkable square or a friend ends the line unlisted.
      const x = ux + dx * step, y = uy + dy * step;
      if (x < 0 || y < 0 || x > 7 || y > 7 || map?.[y]?.[x] === '#') break;
      const bit = y * 8 + x;
      // movesFor's occupant for a monster.
      if (companion && companion.x === x && companion.y === y) break;
      if (unit === companion && player.x === x && player.y === y) break;
      if ((bit < 32 ? monstersLow >>> bit : monstersHigh >>> (bit - 32)) & 1) {
        const foe = enemyAt(state, x, y);
        if (foe && foe !== unit) break;
      }
      if (bit < 32) low |= 1 << bit; else high |= 1 << (bit - 32);
      count++;
      // The player (with lives) is listed as a capture and ends the line.
      if (player.x === x && player.y === y && player.hp) break;
    }
  }
  return new Reach(low, high, count);
}

/**
 * The player's legal chess destinations. A pawn captures only diagonally. A king may not step into close range.
 * On ice days a move that will skid carries its resting square as `slide`. None
 * once the room has caved in: the rubble carried the player to the stairs (src/cave-in.js).
 */
export function legalMoves(state) {
  const moves = chessMoves(state);
  if (state?.modifier !== 'ice') return moves;
  return moves.map((move) => { const slide = iceSlide(state, move); return slide ? { ...move, slide } : move; });
}
function chessMoves(state) {
  if (!state || state.status !== 'playing' || cavedIn(state)) return [];
  const moves = movesFor(state, state.player);
  // A held Borrowed move adds the borrowed piece's squares as optional moves;
  // `borrowed` names that piece so the board can ghost it there.
  if (state.powers?.leap > 0) {
    const piece = borrowedPiece(state);
    for (const move of movesFor(state, { ...state.player, piece })) {
      if (!moves.some((own) => same(own, move))) moves.push({ ...move, borrowed: piece });
    }
  }
  const passed = enPassantVictim(state, state.enPassant);
  if (passed) moves.push({ x: passed.x, y: 2, capture: true, enPassant: true });
  const legal = state.player.piece === 'king' ? moves.filter((move) => !closeAttacker(state, move)) : moves;
  const castle = castling(state);
  if (!castle) return legal;
  // A rook castles by clicking its king, a square it could otherwise walk onto.
  return [...legal.filter((move) => !same(move, castle.click)), { x: castle.click.x, y: castle.click.y, capture: false, castle: true }];
}

// Castling: your king with a rook recruit, or your rook with a king recruit,
// on one row with exactly two walkable, monster-free squares between them
// (items may lie there). The king moves two squares toward the rook, which
// lands on the square the king crossed. Earlier moves never matter. As in
// chess, a king you play may not castle out of, through or into close range.
// A king offers its landing square; a rook offers its king's square.
function castling(state) {
  const ally = state.companion;
  if (!ally || state.status !== 'playing') return null;
  const pair = `${state.player.piece}+${ally.piece}`;
  if (pair !== 'king+rook' && pair !== 'rook+king') return null;
  if (ally.y !== state.player.y || Math.abs(ally.x - state.player.x) !== 3) return null;
  const playerKing = state.player.piece === 'king';
  const king = playerKing ? state.player : ally;
  const rook = playerKing ? ally : state.player;
  const step = Math.sign(rook.x - king.x);
  const y = king.y;
  const crossed = { x: king.x + step, y };
  const landing = { x: king.x + 2 * step, y };
  if (![crossed, landing].every((tile) => walkable(state, tile.x, tile.y) && !enemyAt(state, tile.x, tile.y))) return null;
  if (playerKing && [state.player, crossed, landing].some((tile) => closeAttacker(state, tile))) return null;
  const kingMove = { from: { x: king.x, y }, to: landing };
  const rookMove = { from: { x: rook.x, y }, to: crossed };
  return {
    click: playerKing ? landing : { x: ally.x, y },
    king: kingMove, rook: rookMove,
    player: playerKing ? kingMove : rookMove, companion: playerKing ? rookMove : kingMove,
  };
}

// En passant, player side: a monster pawn that just double-stepped beside the
// player's pawn on rank 3 may be taken on the square it skipped, for one move.
function enPassantVictim(state, ep) {
  if (!ep || state.player.piece !== 'pawn' || state.player.y !== 3 || Math.abs(state.player.x - ep.x) !== 1) return null;
  const foe = state.enemies.find((entry) => entry.id === ep.id && entry.piece === 'pawn' && entry.x === ep.x && entry.y === 3);
  return foe && walkable(state, ep.x, 2) && !enemyAt(state, ep.x, 2) ? foe : null;
}

// En passant, monster side: the player's pawn double-stepping to `square`
// passes (x, 5), which a monster pawn beside the landing square attacks.
function enPassantStriker(state, square) {
  if (state.powers?.freeze > 0 || square.y !== 4) return null;
  return state.enemies.find((foe) => !pinned(foe) && !offBalance(foe) && foe.piece === 'pawn' && foe.y === 4 && Math.abs(foe.x - square.x) === 1) ?? null;
}

/**
 * The first monster that would capture the player at once on `square`: one
 * adjacent to it, or a knight. Distant sliders still give a turn of warning.
 * Pinned and off-balance monsters never capture.
 * Judged as if the player stood on `square`, with any monster there taken.
 */
export function closeAttacker(state, square) {
  if (state.powers?.freeze > 0) return null;
  // Exactly what movesFor would say with the player moved onto `square` (any
  // monster there taken, a companion sharing it not shielding it): a capture
  // needs a walkable square and a player with lives, and a monster one step
  // away (or a knight's jump) can't be blocked, so the step's geometry decides.
  // The hottest check in the certification search: no board copy, no move lists.
  if (!state.player.hp || !walkable(state, square.x, square.y)) return null;
  for (const foe of state.enemies) {
    if ((foe.x === square.x && foe.y === square.y) || pinned(foe) || offBalance(foe)) continue;
    const dx = square.x - foe.x, dy = square.y - foe.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (foe.piece === 'knight') {
      if (ax + ay === 3 && ax && ay) return foe;
      continue;
    }
    if (Math.max(ax, ay) !== 1) continue;
    if (foe.piece === 'rook' ? ax + ay === 1
      : foe.piece === 'bishop' ? ax === 1 && ay === 1
      // A monster pawn captures one square diagonally forward, down the board.
      : foe.piece === 'pawn' ? ax === 1 && dy === 1
      : true) return foe;
  }
  return null;
}

/**
 * Static pickup accessibility using the real movement rules and walls. Enemies
 * are excluded here: combat feasibility is checked separately by route replay.
 * Pawn states retain first-move eligibility and become queens on the far rank.
 * Reachability permits revisits; a Hamiltonian (knight's) tour is unnecessary.
 */
export function unreachablePickups(state) {
  const board = { ...state, enemies: [], companion: null };
  const queue = [{ ...state.player }];
  const key = (unit) => `${unit.x},${unit.y}:${unit.piece}:${unit.moved ? 1 : 0}`;
  const visited = new Set([key(queue[0])]);
  const squares = new Set([`${state.player.x},${state.player.y}`]);
  for (let index = 0; index < queue.length; index++) {
    for (const tile of movesFor(board, queue[index])) {
      const unit = { ...queue[index], x: tile.x, y: tile.y, moved: true };
      if (unit.piece === 'pawn' && unit.y === 0) unit.piece = 'queen';
      const id = key(unit);
      squares.add(`${unit.x},${unit.y}`);
      if (!visited.has(id)) { visited.add(id); queue.push(unit); }
    }
  }
  return state.items.filter((item) => !squares.has(`${item.x},${item.y}`));
}

/**
 * True only when this floor's challenge provably can never be completed, though
 * the player may still have moves (so trapped() never fires). Read-only: act()
 * never consults it. The proof is square-disjointness on fixed walls: every
 * square a remaining target could ever stand on (its own moves with every other
 * unit gone, which only removes blockers; promotion; en passant displacement)
 * is one the player's piece could never land on (its own moves likewise, pawn
 * diagonals always allowed, promotion, a pawn's re-entry after losing a life,
 * one held Borrowed move at any point). Monsters never move onto the player's
 * square and a recruit on Auto can never take a target, so only the player's
 * own landing captures one. With Manual recruit control (`manualRecruit`) the
 * recruit may take targets, so every square it could land on counts as well.
 * A held Take-back's position must be hopeless too.
 * Any doubt returns false: a false alarm is far worse than a missed one.
 */
export function hopelessFloor(state, { manualRecruit = false } = {}) {
  if (!hopelessPosition(state, manualRecruit)) return false;
  const undo = takebackTarget(state);
  return !undo || hopelessPosition(undo, manualRecruit);
}
const squareKey = (x, y) => `${x},${y}`;
function hopelessPosition(state, manualRecruit = false) {
  if (state?.status !== 'playing' || !state.objective || state.objective.complete || state.exit?.open
    || !Array.isArray(state.map) || !Array.isArray(state.enemies) || !state.player) return false;
  const targets = state.enemies.filter((foe) => (foe.role ?? foe.piece) === state.objective.piece);
  if (!targets.length) return false;
  // Shop tools never lie in rooms; if one ever did, picking it up could change everything.
  if ((state.items ?? []).some((item) => item.type === 'powerup' && item.power !== 'shield' && item.power !== 'freeze' && item.power !== 'magnet')) return false;
  const pawnPlayer = state.player.piece === 'pawn' || state.startingPiece === 'pawn';
  const landing = playerLandingSquares(state);
  if (manualRecruit) for (const square of recruitLandingSquares(state, landing)) landing.add(square);
  return targets.every((foe) => [...targetSquares(state, foe, pawnPlayer)].every((square) => !landing.has(square)));
}
// Every square a recruit under Manual control could ever land on: the one at the
// player's side from where it stands, or a waiting one from its square once the
// player could step there. Fixed walls only, as for the player's piece; a pawn
// may always take diagonally, and promotes on the far rank. A bishop recruit on
// your bishop's colour hops to the other one (pairHop), so it may reach any open
// square of that colour as well, and a held Borrowed move could put your bishop
// on its colour later and make it hop the other way.
function recruitLandingSquares(state, playerLanding) {
  const recruit = state.companion ?? (state.items ?? []).find((item) => item.type === 'companion' && playerLanding.has(squareKey(item.x, item.y)));
  if (!recruit) return [];
  const board = { ...state, enemies: [], companion: null };
  const start = { x: recruit.x, y: recruit.y, piece: recruit.piece === 'pawn' && recruit.y === 0 ? 'queen' : recruit.piece, moved: Boolean(recruit.moved) };
  const key = (unit) => `${unit.x},${unit.y}:${unit.piece}:${unit.moved ? 1 : 0}`;
  const queue = [start];
  const visited = new Set([key(start)]);
  const squares = new Set();
  for (let index = 0; index < queue.length; index++) {
    const unit = queue[index];
    squares.add(squareKey(unit.x, unit.y));
    const steps = movesFor(board, unit).map((tile) => ({ x: tile.x, y: tile.y }));
    if (unit.piece === 'pawn') for (const dx of [-1, 1]) if (walkable(state, unit.x + dx, unit.y - 1)) steps.push({ x: unit.x + dx, y: unit.y - 1 });
    for (const tile of steps) {
      const moved = { ...unit, x: tile.x, y: tile.y, moved: true };
      if (moved.piece === 'pawn' && moved.y === 0) moved.piece = 'queen';
      if (!visited.has(key(moved))) { visited.add(key(moved)); queue.push(moved); }
    }
  }
  if (state.player.piece === 'bishop' && recruit.piece === 'bishop') {
    const own = (recruit.x + recruit.y) % 2, paired = own === (state.player.x + state.player.y) % 2, leap = state.powers?.leap > 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (walkable(state, x, y) && ((paired || leap) && (x + y) % 2 !== own || (paired && leap))) squares.add(squareKey(x, y));
    }
  }
  return squares;
}
// Every square a monster could ever occupy, and (for a pawn player) the squares
// from which the player could take it en passant.
function targetSquares(state, foe, pawnPlayer) {
  const board = { ...state, enemies: [], companion: null, player: { ...state.player, x: -9, y: -9, hp: 0 } };
  const start = { x: foe.x, y: foe.y, piece: foe.piece, moved: Boolean(foe.moved) };
  const key = (unit) => `${unit.x},${unit.y}:${unit.piece}:${unit.moved ? 1 : 0}`;
  const queue = [start];
  const visited = new Set([key(start)]);
  const squares = new Set();
  for (let index = 0; index < queue.length; index++) {
    const unit = queue[index];
    squares.add(squareKey(unit.x, unit.y));
    const next = movesFor(board, unit, true).map((tile) => ({ x: tile.x, y: tile.y }));
    if (unit.piece === 'pawn' && pawnPlayer) {
      // Taken en passant from the square it skipped; displaced diagonally when it takes yours that way.
      if (unit.y === 3) squares.add(squareKey(unit.x, 2));
      if (unit.y === 4) for (const dx of [-1, 1]) if (walkable(state, unit.x + dx, 5)) next.push({ x: unit.x + dx, y: 5 });
    }
    for (const tile of next) {
      const moved = { ...unit, x: tile.x, y: tile.y, moved: true };
      if (moved.piece === 'pawn' && moved.y === 7) moved.piece = 'queen';
      if (!visited.has(key(moved))) { visited.add(key(moved)); queue.push(moved); }
    }
  }
  return squares;
}
function playerLandingSquares(state) {
  const board = { ...state, enemies: [], companion: null };
  const start = { x: state.player.x, y: state.player.y, piece: state.player.piece, moved: Boolean(state.player.moved), leap: state.powers?.leap > 0 ? 1 : 0 };
  const key = (unit) => `${unit.x},${unit.y}:${unit.piece}:${unit.moved ? 1 : 0}:${unit.leap}`;
  const queue = [start];
  const visited = new Set([key(start)]);
  const squares = new Set();
  const enqueue = (unit) => { if (!visited.has(key(unit))) { visited.add(key(unit)); queue.push(unit); } };
  for (let index = 0; index < queue.length; index++) {
    const unit = queue[index];
    squares.add(squareKey(unit.x, unit.y));
    const steps = movesFor(board, unit).map((tile) => ({ x: tile.x, y: tile.y, leap: unit.leap }));
    // A pawn captures (en passant too) diagonally forward; assume something is always there to take.
    if (unit.piece === 'pawn') for (const dx of [-1, 1]) if (walkable(state, unit.x + dx, unit.y - 1)) steps.push({ x: unit.x + dx, y: unit.y - 1, leap: unit.leap });
    if (unit.leap) {
      const piece = unit.piece === 'knight' ? 'queen' : 'knight';
      for (const tile of movesFor(board, { ...unit, piece })) steps.push({ x: tile.x, y: tile.y, leap: 0 });
    }
    for (const tile of steps) {
      const moved = { ...unit, x: tile.x, y: tile.y, moved: true, leap: tile.leap };
      if (moved.piece === 'pawn' && moved.y === 0) moved.piece = 'queen';
      enqueue(moved);
    }
    // A promoted pawn that loses a life starts over as a pawn on (nearly) any open square.
    if (state.startingPiece === 'pawn' && unit.piece === 'queen') {
      for (let y = 1; y <= 6; y++) for (let x = 0; x < 8; x++) if (walkable(state, x, y)) enqueue({ x, y, piece: 'pawn', moved: false, leap: unit.leap });
    }
  }
  return squares;
}

/** Entire committed attack lanes; jump/step captures warn on their destination. */
export function dangerTiles(state) {
  const cells = new Map();
  for (const foe of state.enemies) if (foe.phase === 'aim') for (const tile of foe.intent) cells.set(`${tile.x},${tile.y}`, { ...tile });
  return [...cells.values()];
}

function attackPath(state, foe, target) {
  if (!rays(foe.piece)) return [{ x: target.x, y: target.y }];
  const dx = Math.sign(target.x - foe.x);
  const dy = Math.sign(target.y - foe.y);
  const path = [];
  for (let step = 1; step < 8; step++) {
    const x = foe.x + dx * step, y = foe.y + dy * step;
    if (!walkable(state, x, y) || enemyAt(state, x, y) || (state.companion && state.companion.x === x && state.companion.y === y)) break;
    path.push({ x, y });
  }
  return path;
}

function aimAtPlayer(state, foe) {
  if (!strikesPlayer(state, foe)) return false;
  foe.phase = 'aim';
  foe.target = { x: state.player.x, y: state.player.y };
  foe.intent = attackPath(state, foe, state.player);
  return true;
}

function preservesPawnLane(state, move) {
  // A legal AI choice keeps a pawn's only forward file open. No special
  // player moves are added, and pawns still capture diagonally only.
  if (state.player.piece !== 'pawn') return true;
  return move.x !== state.player.x;
}

function promoteMonster(state, foe) {
  if (foe.piece === 'pawn' && foe.y === 7) {
    foe.piece = 'queen'; foe.promoted = true;
    state.events.push({ type: 'enemy-promotion', x: foe.x, y: foe.y });
    state.message = `${foe.name} reached the last rank and promoted to a queen.`;
  }
}

function moveMonster(state, foe) {
  const candidates = movesFor(state, foe, true).filter((move) => !move.capture && preservesPawnLane(state, move));
  if (!candidates.length) return;
  // Each role steps with its own habits (src/monster-ai.js).
  const step = chooseMonsterMove(state, foe, candidates, monsterEngine(state, foe));
  const from = { x: foe.x, y: foe.y };
  foe.x = step.x; foe.y = step.y; foe.moved = true;
  state.events.push({ type: 'enemy-move', id: foe.id, from, x: foe.x, y: foe.y });
  noteDoubleStep(state, foe, from);
  promoteMonster(state, foe);
  windUp(state, foe);
}

// The rules.js internals src/monster-ai.js consults for one monster.
function monsterEngine(state, foe) {
  // The clock and the monster stay put while it weighs its steps, so the
  // tie-break's prefix is hashed once per decision (it ends in ':', so the
  // hash continues exactly as over the whole text).
  let prefix = null;
  const tie = (move) => (hashMore(prefix ??= hashMore(2166136261, tiePrefix(state, foe)), `${move.x},${move.y}`) >>> 0) / 4294967296;
  return { movesFor, capturesAt, strikesPlayer, attackReach, closeAttacker, borrowedPiece, tie, steps: () => monsterMoves(state, foe) };
}

// Off the king floor, a monster that can strike the player winds up, except
// that from Tricky on a rook, bishop, queen or decoy king waits for a square
// where the player can't take it, or a guarded one (src/monster-ai.js).
function windUp(state, foe) {
  return strikesPlayer(state, foe)
    && safeToStrike(state, foe, monsterEngine(state, foe)) && aimAtPlayer(state, foe);
}

// From Tough on, a guard first blocks a line into a target the player could take.
function screenTarget(state, foe) {
  const block = screenStep(state, foe, monsterEngine(state, foe));
  if (!block) return false;
  relocate(state, foe, block);
  windUp(state, foe);
  return true;
}

// A pawn's double step opens an en passant window on the square it skipped.
function noteDoubleStep(state, foe, from) {
  if (foe.piece === 'pawn' && from.y === 1 && foe.y === 3) state.enPassant = { id: foe.id, x: foe.x, y: 2 };
}

// Royal guard (final floor): the king avoids lines the player or companion
// covers, and its guards screen it. A recruit on Auto never captures the king, but
// like a chess rook it still controls squares and herds it toward the player. Evaluations move a unit
// hypothetically and always restore it.
function chebyshev(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function hypothetically(unit, square, evaluate) {
  const { x, y } = unit;
  unit.x = square.x; unit.y = square.y;
  try { return evaluate(); } finally { unit.x = x; unit.y = y; }
}
// The player's reach counts a held Borrowed move, which can take the king too.
function kingThreatened(state, king) {
  const hits = (unit, piece) => capturesAt(state, unit, false, king.x, king.y, piece);
  const borrowed = () => state.powers?.leap > 0 && hits(state.player, borrowedPiece(state));
  return (state.player.hp > 0 && (hits(state.player) || borrowed())) || Boolean(state.companion && hits(state.companion));
}
function monsterMoves(state, foe) {
  return movesFor(state, foe, true).filter((move) => !move.capture && preservesPawnLane(state, move));
}
function relocate(state, foe, move) {
  const from = { x: foe.x, y: foe.y };
  foe.x = move.x; foe.y = move.y; foe.moved = true;
  state.events.push({ type: 'enemy-move', id: foe.id, from, x: foe.x, y: foe.y });
  noteDoubleStep(state, foe, from);
  promoteMonster(state, foe);
}
// A monster's seeded tie-break between equally good steps, in [0, 1). It counts
// moves on this floor, not in the whole run, so a floor plays the same however
// long the earlier ones took, par included. (Hashing only the board left more
// monsters pacing between two squares for good while the player waited.)
// Classic monsters (comparisons only) count the whole run, as all once did.
function monsterTie(state, foe, move) {
  return hash(`${tiePrefix(state, foe)}${move.x},${move.y}`) / 4294967296;
}
function tiePrefix(state, foe) {
  const clock = state.classicMonsters === true ? state.turns : state.turns - state.floorStart.turns;
  return `${floorSeed(state)}:${state.floor}:${clock}:${foe.id}:`;
}
function safeKingMoves(state, king) {
  return monsterMoves(state, king).filter((move) => !hypothetically(king, move, () => kingThreatened(state, king)));
}
function moveKing(state, king) {
  const best = safeKingMoves(state, king).map((move) => hypothetically(king, move, () => {
    const strikes = strikesPlayer(state, king);
    const company = state.enemies.filter((o) => o !== king && chebyshev(o, move) <= 1).length;
    return {
      move,
      score: (strikes ? -4 : 0) - company - 0.5 * safeKingMoves(state, king).length
        + 0.8 * Math.abs(chebyshev(move, state.player) - 3) + 0.1 * monsterTie(state, king, move),
    };
  })).sort((a, b) => a.score - b.score)[0];
  if (!best) return false;
  relocate(state, king, best.move);
  aimAtPlayer(state, king);
  return true;
}
function royalStepOk(state, foe, king, step) {
  if (foe === king) return !hypothetically(king, step, () => kingThreatened(state, king));
  return kingThreatened(state, king) || !hypothetically(foe, step, () => kingThreatened(state, king));
}
function royalKingTurn(state, king) {
  if (kingThreatened(state, king)) {
    if (!moveKing(state, king)) aimAtPlayer(state, king);
  } else if (!aimAtPlayer(state, king)) moveKing(state, king);
}
function royalGuardTurn(state, foe, king) {
  const threatened = kingThreatened(state, king);
  const candidates = monsterMoves(state, foe);
  const keepsKing = (move) => !hypothetically(foe, move, () => kingThreatened(state, king));
  if (threatened) {
    // Each step's distance and tie-break once, compared exactly as before.
    const block = candidates.filter(keepsKing).map((move) => ({ move, near: distance(move, foe), tie: monsterTie(state, foe, move) }))
      .sort((a, b) => a.near + a.tie * 0.1 - b.near - b.tie * 0.1)[0]?.move;
    if (block) { relocate(state, foe, block); aimAtPlayer(state, foe); return; }
  }
  if (aimAtPlayer(state, foe)) return;
  const pool = threatened ? candidates : candidates.filter(keepsKing);
  const between = (m) => {
    const dx = king.x - state.player.x, dy = king.y - state.player.y;
    if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return false;
    const mx = m.x - state.player.x, my = m.y - state.player.y;
    const n = Math.max(Math.abs(dx), Math.abs(dy)), k = Math.max(Math.abs(mx), Math.abs(my));
    return k > 0 && k < n && mx * n === dx * k && my * n === dy * k;
  };
  const score = (m) => 0.6 * distance(m, state.player) + 0.4 * distance(m, king) + 0.35 * distance(m, foe)
    + 0.7 * monsterTie(state, foe, m) - (between(m) ? 2 : 0);
  const pick = pool.map((move) => ({ move, score: score(move) })).sort((a, b) => a.score - b.score)[0]?.move;
  if (!pick) return;
  relocate(state, foe, pick);
  aimAtPlayer(state, foe);
}

function returnToPawn(state) {
  state.player.piece = 'pawn';
  state.player.moved = false;
  // A queen may be on the far rank when hit. Start the replacement pawn near
  // the entrance, skipping occupied squares and positions with no pawn move.
  // Pawn editions reserve the central files, so a live room has room to reenter.
  for (let y = 6; y >= 1; y--) for (const x of [4, 3, 5, 2, 6, 1, 7, 0]) {
    if (!walkable(state, x, y) || enemyAt(state, x, y) || (state.companion && state.companion.x === x && state.companion.y === y)) continue;
    const candidate = { ...state.player, x, y };
    if (!movesFor(state, candidate).length) continue;
    state.player.x = x; state.player.y = y;
    return;
  }
}

// One capture of the player: a shield absorbs it, otherwise a life is lost.
// Returns 'shield', 'captured' or 'restart' (the last life ended the run).
// Events name the attacker (`by`, its square and name) so the board can show
// which monster struck, even after a restart clears the room.
function capturePlayer(state, foe, close = false, enPassant = false) {
  const attacker = { by: foe.id, from: { x: foe.x, y: foe.y }, name: foe.name, ...(enPassant && { enPassant: true }) };
  const how = enPassant ? 'captured you en passant as you passed it' : close ? 'was guarding that square and captured you at once' : 'captured you along its red path';
  if (state.powers.shield > 0) {
    state.powers.shield--; foe.phase = 'ready'; foe.intent = []; foe.target = null;
    state.events.push({ type: 'shield', x: state.player.x, y: state.player.y, ...attacker });
    state.message = `${foe.name} ${how}, but your bone ward blocked it.`;
    return 'shield';
  }
  state.player.hp--;
  const captured = { type: 'player-captured', x: state.player.x, y: state.player.y, amount: 1, ...attacker, close };
  if (state.player.hp === 0) {
    restartRun(state, [captured], `${foe.name} ${enPassant ? 'captured you en passant' : how}. Out of lives. Back to the start of today’s dungeon.`);
    return 'restart';
  }
  // Clear the committed attack so
  // the monster must give another full turn of warning before a hit.
  foe.phase = 'ready'; foe.intent = []; foe.target = null;
  const demoted = state.startingPiece === 'pawn' && state.player.piece === 'queen';
  if (demoted) returnToPawn(state);
  state.events.push(captured);
  state.message = `${foe.name} ${how}. ${demoted ? 'Back to a pawn. ' : ''}${state.player.hp} ${state.player.hp === 1 ? 'life' : 'lives'} left.`;
  return 'captured';
}

// A distant rook, bishop or queen with the player in its line steps one square
// closer along it before aiming, so a line it can already strike is pressed.
// From Tricky on it only steps where the player can't take it (src/monster-ai.js).
function closeIn(state, foe) {
  if (!['rook', 'bishop', 'queen'].includes(foe.piece) || chebyshev(foe, state.player) <= 1) return;
  if (!strikesPlayer(state, foe)) return;
  const step = attackPath(state, foe, state.player)[0];
  if (step && preservesPawnLane(state, step) && monsterMoves(state, foe).some((move) => same(move, step))
    && safeCloseIn(state, foe, step, monsterEngine(state, foe))) relocate(state, foe, step);
}

// `hit`: the player was already captured this turn (at close range). At most
// one hit a turn, so no monster captures again: a strike that would land holds,
// still wound up, and everything else moves and winds up as usual.
function enemyTurn(state, hit = false) {
  state.events.push({ type: 'enemy-phase', x: state.player.x, y: state.player.y });
  // A pinned monster sits out this turn; the pin wears off after PIN_MOVES of them.
  const held = new Set(state.enemies.filter(pinned));
  for (const foe of held) if (!--foe.pinned) { delete foe.pinned; state.events.push({ type: 'unpin', id: foe.id, x: foe.x, y: foe.y }); }
  if (state.powers.freeze > 0) { state.powers.freeze--; return; }
  const royal = royalRules(state) ? state.enemies.find((foe) => foe.role === 'king') : null;
  const order = royal ? [royal, ...state.enemies.filter((foe) => foe !== royal)] : state.enemies;
  const missed = [];
  for (const foe of order) {
    if (held.has(foe)) continue;
    if (foe.phase === 'aim') {
      const capture = foe.intent.some((tile) => same(tile, state.player))
        && strikesPlayer(state, foe);
      if (capture && hit) continue;
      // A shield keeps the phase going; a lost life ends it.
      if (capture && capturePlayer(state, foe) === 'shield') continue;
      if (capture) { announceMisses(state, missed); return; }
      // The square a pawn just stepped up from is behind it, off its way forward,
      // so a lunge may land there though it's on the pawn's file.
      const behindPawn = (move) => state.player.piece === 'pawn' && move.x === state.player.x && move.y > state.player.y;
      const destination = movesFor(state, foe, true).find((move) => same(move, foe.target) && !move.capture && (preservesPawnLane(state, move) || behindPawn(move)));
      if (destination && royal && !royalStepOk(state, foe, royal, destination)) { /* stay put */ }
      else if (destination) relocate(state, foe, destination);
      // The lunge missed: it spent its turn and is off-balance until the player's next move ends.
      foe.phase = 'ready'; foe.intent = []; foe.target = null; foe.offBalance = true;
      missed.push(foe);
      state.events.push({ type: 'miss', id: foe.id, x: foe.x, y: foe.y });
    } else if (royal && foe === royal) {
      royalKingTurn(state, foe);
    } else if (royal && state.enemies.includes(royal)) {
      royalGuardTurn(state, foe, royal);
    } else if (!screenTarget(state, foe)) {
      closeIn(state, foe);
      if (!windUp(state, foe)) moveMonster(state, foe);
    }
  }
  announceMisses(state, missed);
}

// One line for the phase's missed lunges, after its other news; none once a
// lost run has cleared the room.
function announceMisses(state, missed) {
  const shown = missed.filter((foe) => state.enemies.includes(foe));
  if (!shown.length) return;
  settle(state);
  state.message = shown.length === 1 ? `${shown[0].name} lunged and missed — it’s off-balance!` : `${shown.length} monsters lunged and missed — they’re off-balance!`;
}

// The player's move (or wait) is over: off-balance monsters find their feet.
function regainBalance(state) {
  for (const foe of state.enemies) delete foe.offBalance;
}

// The squares (index y * 8 + x) a piece can reach from `from` over this
// floor's walls: a flood fill with movesFor's rules on an empty board (never
// a pawn): sliders run until a wall, knights and kings step once.
function reachableFrom(state, piece, from) {
  const visited = new Uint8Array(64);
  const queue = [from.x + from.y * 8];
  visited[queue[0]] = 1;
  const directions = rays(piece) ?? (piece === 'knight' ? KNIGHT : [...ORTHOGONAL, ...DIAGONAL]);
  const range = rays(piece) ? 7 : 1;
  for (let i = 0; i < queue.length; i++) {
    const qx = queue[i] % 8, qy = (queue[i] - qx) / 8;
    for (const [dx, dy] of directions) {
      for (let step = 1; step <= range; step++) {
        const x = qx + dx * step, y = qy + dy * step;
        if (!walkable(state, x, y)) break;
        if (!visited[y * 8 + x]) { visited[y * 8 + x] = 1; queue.push(y * 8 + x); }
      }
    }
  }
  return visited;
}

function connectedBoard(state) {
  const layoutPiece = state.layoutPiece ?? state.startingPiece;
  const piece = layoutPiece === 'pawn' ? 'queen' : layoutPiece;
  const visited = reachableFrom(state, piece, { x: 4, y: 6 });
  // Bishops need every open square of their own color; other pieces need all.
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (walkable(state, x, y) && (piece !== 'bishop' || (x + y) % 2 === 0) && !visited[y * 8 + x]) return false;
  }
  return true;
}

// Practice with another piece plays the official room, whose walls, recruit
// and power-up square suit the day's piece: a practice bishop couldn't reach
// the power-up on more than half its floors or the recruit on four in five,
// and now and then a practice knight had every jump from its start walled
// off. So, on its own random stream, leaving monsters and the other walls
// where the official room has them: a practice piece with no move from its
// start has the walls on its first moves cleared; the waiting recruit stands
// on one of its first moves, as it does for the day's piece (a pawn recruit
// on a file open to the far rank); a coin or power-up it can't reach moves to
// a square it can, two or more steps away (the room's middle rows when it
// can). Pawns only advance, so their rooms are left as they are.
function fitPracticeRoom(state, layoutPiece) {
  const piece = state.startingPiece;
  if (!state.practice || piece === layoutPiece || piece === 'pawn') return;
  let reach = reachableFrom(state, piece, state.player);
  if (reach.every((seen, index) => !seen || index === state.player.x + state.player.y * 8)) {
    const steps = rays(piece) ?? (piece === 'knight' ? KNIGHT : [...ORTHOGONAL, ...DIAGONAL]);
    for (const [dx, dy] of steps) {
      const x = state.player.x + dx, y = state.player.y + dy;
      if (!inside(x, y) || walkable(state, x, y)) continue;
      state.map[y] = state.map[y].slice(0, x) + '.' + state.map[y].slice(x + 1);
      state.props = state.props.filter((prop) => prop.x !== x || prop.y !== y);
    }
    reach = reachableFrom(state, piece, state.player);
  }
  const reached = (tile) => reach[tile.y * 8 + tile.x] === 1;
  const rng = random(hash(`${floorSeed(state)}:practice-pickups:${state.floor}`));
  const recruit = state.items.find((item) => item.type === 'companion');
  if (recruit) {
    const fits = (tile) => !same(tile, state.exit) && !enemyAt(state, tile.x, tile.y) && !state.items.some((other) => other !== recruit && same(other, tile))
      && (recruit.piece !== 'pawn' || openFile(state, tile));
    const first = movesFor(state, { ...state.player, piece }).filter(fits);
    if (!first.some((tile) => same(tile, recruit))) {
      const anywhere = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (reached({ x, y }) && !same({ x, y }, state.player) && fits({ x, y })) anywhere.push({ x, y });
      const pool = first.length ? first : anywhere;
      const tile = pool[Math.floor(rng() * pool.length)];
      if (tile) Object.assign(recruit, { x: tile.x, y: tile.y });
    }
  }
  for (const item of state.items) {
    if ((item.type !== 'coin' && item.type !== 'powerup') || reached(item)) continue;
    const free = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const tile = { x, y };
      if (!reached(tile) || Math.max(Math.abs(x - state.player.x), Math.abs(y - state.player.y)) <= 1 || same(tile, state.exit)
        || enemyAt(state, x, y) || state.items.some((other) => same(other, tile))) continue;
      free.push(tile);
    }
    const middle = free.filter((tile) => tile.y >= 3 && tile.y <= 5);
    const pool = middle.length ? middle : free;
    const tile = pool[Math.floor(rng() * pool.length)];
    if (tile) Object.assign(item, tile);
  }
}

// Walls never land on a monster's opening moves, so none spawns boxed in (a
// corner knight walled off, a pawn facing a pillar). Knights and kings keep
// every destination clear; pawns their one- and two-step advance; rooks,
// bishops and queens the first square of each line.
// The 2026-11-05 launch dungeon predates this rule and keeps its published
// layout so its saved runs still validate. Keyed by seed, not date, so a
// fallback layout plays the same on any date it is certified for.
const LEGACY_LAYOUT_SEEDS = new Set([1830689584]);
// A pawn floor draws its eight pawns from the four back rows instead of one
// fixed V, so pawn floors stop looking alike from day to day. Its own random
// stream leaves the room's other draws (mirror, powerup, walls) in sequence.
// The pawns stay off the player's file and the decoys' squares, at least
// three on each side of that file and at most three on one row.
// The first two editions (2026-11-05 and 2026-11-06) keep the fixed V so
// their saved runs still validate; 2026-11-06's seed is also the white-pawn
// fallback, which keeps its certificate.
const FIXED_PAWN_FORMATION_SEEDS = new Set([1830689584, 1881022441]);

/**
 * The seed behind one floor: its room, residents, pickups, recruit, room
 * modifier and the monsters' tie-breaks all draw from it, on streams of their
 * own. A day assembled from the floors of several candidate layouts
 * (src/generation.js) gives each floor its own (`floorSeeds`); otherwise every
 * floor shares the dungeon's seed. Nothing else about a floor depends on the
 * floors before it except lives, so a floor plays the same with any seeds
 * before it.
 */
export function floorSeed(state, floor = state.floor) {
  return state.floorSeeds?.[floor] ?? state.dungeonSeed ?? state.seed;
}
const validFloorSeeds = (seeds) => Array.isArray(seeds) && seeds.length === 3 && seeds.every((seed) => Number.isInteger(seed) && seed >= 0);

/**
 * Barricades on a floor where monster pawns live (its targets or a decoy
 * species): walls on the rank where they would promote (row 7, the player's
 * side), all but the day's open squares (`openFiles`, src/difficulty.js
 * openPromotionFiles of its date, or of a fallback's template date): every other square when half stay open, else the open
 * ones drawn, both from the floor's own stream. A pawn on a barricaded file
 * stops a square short, so promotion is rare rather than impossible. They come
 * on top of the room's walls. The launch edition keeps its published layout.
 */
function promotionBarricades(state, residents) {
  if (LEGACY_LAYOUT_SEEDS.has(floorSeed(state)) || !residents.some((creature) => creature.piece === 'pawn')) return [];
  const rng = random(hash(`${floorSeed(state)}:barricades:${state.floor}`));
  const files = [0, 1, 2, 3, 4, 5, 6, 7], open = state.openFiles ?? openPromotionFiles(state.date);
  // A bishop takes only on its own colour, so a pawn stopped a square short must
  // stop on it: on a bishop day the barricades stand on every other square, the
  // ones off the bishop's colour (which it never uses), whatever the weekday.
  // Six of eight left pawns stranded on the other colour, and only 21% of a
  // bishop's eight-pawn candidates could be certified (79% with none).
  if ((state.layoutPiece ?? state.startingPiece) === 'bishop') {
    const colour = (state.player.x + state.player.y) % 2;
    return files.filter((x) => (x + 6) % 2 === colour).map((x) => ({ x, y: 7 }));
  }
  if (open === 4) {
    const parity = Math.floor(rng() * 2);
    return files.filter((x) => x % 2 === parity).map((x) => ({ x, y: 7 }));
  }
  const kept = new Set();
  while (kept.size < open) kept.add(Math.floor(rng() * 8));
  return files.filter((x) => !kept.has(x)).map((x) => ({ x, y: 7 }));
}

function pawnFormation(state) {
  const rng = random(hash(`${floorSeed(state)}:pawns:${state.floor}`));
  const squares = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    // (1, 0) too: a mirrored room moves the (7, 0) decoy there.
    if (x === 4 || (y === 0 && (x <= 1 || x === 7))) continue;
    squares.push({ x, y, order: rng() });
  }
  squares.sort((a, b) => a.order - b.order);
  const chosen = [];
  const count = (test) => chosen.filter(test).length;
  for (const tile of squares) {
    if (chosen.length === 8) break;
    const side = tile.x < 4;
    // Leave room for three on the other side of the file.
    if (count((entry) => entry.x < 4 === side) >= 5) continue;
    if (count((entry) => entry.y === tile.y) >= 3) continue;
    chosen.push(tile);
  }
  return chosen.map(({ x, y }) => [x, y]);
}
// The king floor plays by royal rules: a smarter king and guards (enemyTurn)
// and a recruit (setFloor) that may help certify the room (fairness.js).
export function royalRules(state) { return state.floor === 2; }
// The king floor always recruits a king. Of rook, queen and king, the king
// recruit helped every piece most (or as much) and almost never cleared the
// floor in one or two steered moves, as a queen or rook could by taking the
// king from across the room; a rook player can castle with it.
const KING_FLOOR_RECRUITS = ['king'];
// A pawn recruit that can't wait on an open file is another piece (setFloor).
const PAWNLESS = PIECES.filter((piece) => piece !== 'pawn');
// Is the file ahead of `tile` free of walls all the way to the far rank, so a
// pawn there can walk up and promote? Monsters move, so only walls count, as
// for the player's own promotion file.
function openFile(state, tile) {
  for (let y = tile.y - 1; y >= 0; y--) if (!walkable(state, tile.x, y)) return false;
  return true;
}
function openingSquares(foe) {
  const deltas = foe.piece === 'pawn' ? [[0, 1], ...(foe.y === 1 ? [[0, 2]] : [])]
    : foe.piece === 'knight' ? KNIGHT
    : foe.piece === 'rook' ? ORTHOGONAL : foe.piece === 'bishop' ? DIAGONAL : [...ORTHOGONAL, ...DIAGONAL];
  return deltas.map(([dx, dy]) => ({ x: foe.x + dx, y: foe.y + dy })).filter((tile) => inside(tile.x, tile.y));
}

// A powerup is a prize, not a gift: it never lies on or beside the start
// square, so it always costs a detour to collect. Earlier editions keep their
// published layouts so saved runs validate (see LEGACY_LAYOUT_SEEDS).
function distantPowerTile(state, layoutPiece, rng) {
  const taken = [...state.enemies, state.exit, { x: 4, y: 4 }, { x: 2, y: 4 }, { x: 6, y: 4 }];
  const options = [];
  for (let y = 1; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (Math.max(Math.abs(x - state.player.x), Math.abs(y - state.player.y)) <= 1) continue;
    if (layoutPiece === 'bishop' && (x + y) % 2 !== (state.player.x + state.player.y) % 2) continue;
    if (taken.some((entry) => entry.x === x && entry.y === y)) continue;
    // A pawn only walks its own file; other pieces get the room's middle band (rows 3-5).
    if (layoutPiece === 'pawn' ? x !== state.player.x || y < 2 : y < 3 || y > 5) continue;
    options.push([x, y]);
  }
  return options[Math.floor(rng() * options.length)];
}

// Gold buys from the shop between floors and nothing else, so the last floor
// holds no coins and no coin magnet: nothing would remain to spend them on.
// The launch edition keeps its published layout (see LEGACY_LAYOUT_SEEDS).
export function coinlessFloor(state, floor = state.floor) {
  return floor === state.targets.length - 1 && !LEGACY_LAYOUT_SEEDS.has(floorSeed(state, floor));
}

// One draw either way, so the rest of the room's random layout is unchanged.
function powerRoll(roll, coinless) {
  return coinless ? ['shield', 'freeze'][Math.floor(roll * 2)] : ['shield', 'freeze', 'magnet'][Math.floor(roll * 3)];
}

// A floor's optional residents: its two decoy species, alternating, `decoys` of
// them (a difficulty knob, 0-4; default 2), never more of one role than a chess
// army holds.
export function floorDecoys(state, floor = state.floor) {
  const pair = [state.species[3 + floor * 2], state.species[4 + floor * 2]];
  const wanted = state.decoys ?? 2;
  if (wanted === 2) return pair;
  const chosen = [];
  for (let index = 0; chosen.length < wanted && index < 8; index++) {
    const species = pair[index % 2];
    if (chosen.filter((entry) => entry.piece === species.piece).length < PIECE_COUNTS[species.piece]) chosen.push(species);
  }
  return chosen;
}

// Difficulty knobs (src/difficulty.js, src/calibration.js); 0 keeps the plain layout.
// Decoys past the usual two start on a free square in the back three rows.
// `scatter` draws non-pawn targets in the back four rows, off every line the
// player's piece covers from its start square. `guards` moves up to that many
// decoys beside a target, where they would strike a player who takes it.
// Both draw from their own streams, so the room's other draws stay in sequence.
function applyLayoutPressure(state, layoutPiece, targetPiece) {
  const seed = floorSeed(state);
  const count = PIECE_COUNTS[targetPiece];
  const targets = state.enemies.slice(0, count), decoys = state.enemies.slice(count);
  const taken = (x, y, unit) => state.enemies.some((foe) => foe !== unit && foe.x === x && foe.y === y) || (x === 4 && y === 0);
  const shuffled = (rng, test) => {
    const tiles = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (test(x, y)) tiles.push({ x, y, order: rng() });
    return tiles.sort((a, b) => a.order - b.order);
  };
  if (decoys.length > 2) {
    const rng = random(hash(`${seed}:decoys:${state.floor}`));
    for (const foe of decoys.slice(2)) {
      foe.x = -1; foe.y = -1;
      const [tile] = shuffled(rng, (x, y) => y < 3 && x !== 4 && !taken(x, y, foe));
      foe.x = tile.x; foe.y = tile.y;
    }
  }
  if (state.scatter && targetPiece !== 'pawn' && layoutPiece !== 'pawn') {
    const rng = random(hash(`${seed}:scatter:${state.floor}`));
    const empty = { ...state, map: Array(8).fill('........'), enemies: [], companion: null };
    const opening = movesFor(empty, { x: 4, y: 6, piece: layoutPiece });
    for (const foe of targets) {
      const [tile] = shuffled(rng, (x, y) => y < 4 && !taken(x, y, foe)
        && (layoutPiece !== 'bishop' || (x + y) % 2 === 0) && !opening.some((move) => move.x === x && move.y === y));
      if (tile) { foe.x = tile.x; foe.y = tile.y; }
    }
  }
  if (state.guards > 0) {
    const rng = random(hash(`${seed}:guards:${state.floor}`));
    for (const foe of decoys.slice(0, state.guards)) {
      const guards = (x, y) => targets.some((victim) => {
        if (foe.piece !== 'knight' && Math.max(Math.abs(victim.x - x), Math.abs(victim.y - y)) !== 1) return false;
        const board = { ...state, map: Array(8).fill('........'), enemies: [], companion: null, player: { x: victim.x, y: victim.y, hp: 1 } };
        return movesFor(board, { ...foe, x, y }, true, true).some((move) => move.x === victim.x && move.y === victim.y);
      });
      // The back four rows only (row 4 holds the coins), never on a pawn's file:
      // the guard waits by its target, it doesn't ambush the start.
      const [tile] = shuffled(rng, (x, y) => y <= 3 && !taken(x, y, foe) && !(layoutPiece === 'pawn' && x === 4) && guards(x, y));
      if (tile) { foe.x = tile.x; foe.y = tile.y; }
    }
  }
}

// How much of the open lines into the floor's targets a wall on `tile` would
// cut: for each target and each of the eight directions, a wall on that ray
// hides every square beyond it (up to the next wall or monster) from the target.
function screenReach(state) {
  const targets = state.enemies.filter((foe) => foe.piece === state.objective.piece);
  return (tile) => {
    let hidden = 0;
    for (const foe of targets) {
      const dx = Math.sign(tile.x - foe.x), dy = Math.sign(tile.y - foe.y);
      const along = dx === 0 || dy === 0 || Math.abs(tile.x - foe.x) === Math.abs(tile.y - foe.y);
      if (!along || (dx === 0 && dy === 0)) continue;
      let x = foe.x + dx, y = foe.y + dy, blocked = false;
      for (; !(x === tile.x && y === tile.y); x += dx, y += dy) if (!walkable(state, x, y) || enemyAt(state, x, y)) { blocked = true; break; }
      if (blocked) continue;
      for (x += dx, y += dy; inside(x, y) && walkable(state, x, y) && !enemyAt(state, x, y); x += dx, y += dy) hidden++;
    }
    return hidden;
  };
}

function setFloor(state, kingRecruit = false) {
  const layoutPiece = state.layoutPiece ?? state.startingPiece;
  const rng = random(hash(`${floorSeed(state)}:room:${state.floor}`));
  state.awaitingPlayer = false; state.companion = null; state.enPassant = null;
  breakTactics(state);
  // A new floor's ceiling holds; the stairs banked any gold at risk (src/cave-in.js).
  delete state.caveIn;
  state.map = Array(8).fill('........');
  // Promotion lasts only for the room it happened in; each floor starts with the original piece.
  state.player.piece = state.startingPiece;
  state.player.x = 4; state.player.y = 6; state.player.moved = false;
  state.exit = { x: 4, y: 0, open: false };
  state.objective = { piece: state.targets[state.floor], complete: false };
  state.floorStart = { turns: state.turns, captures: state.captures, treasure: state.treasure };
  delete state.restartedMoves;
  // Hints and unmaskings belong to one floor: its species never live on another.
  delete state.hints; delete state.unmasked;
  const target = state.species[state.floor];
  const residents = [...Array(PIECE_COUNTS[target.piece]).fill(target), ...floorDecoys(state)];
  const mirror = rng() < 0.5;
  const formation = target.piece === 'pawn' && !FIXED_PAWN_FORMATION_SEEDS.has(floorSeed(state))
    ? pawnFormation(state) : null;
  const targetTiles = formation ?? (target.piece === 'pawn'
    ? [[3, 3], [5, 3], [2, 2], [6, 2], [1, 1], [7, 1], [0, 2], [6, 0]]
    : layoutPiece === 'pawn' ? [[3, 2], [5, 1]] : [[4, 2], [2, 2]]);
  // Decoys past the usual two are placed by applyLayoutPressure.
  const coordinates = [...targetTiles.slice(0, PIECE_COUNTS[target.piece]), [0, 0], [7, 0], [0, 0], [0, 0]].slice(0, residents.length);
  state.enemies = coordinates.map(([initialX, y], index) => {
    const creature = residents[index];
    // Keep pawn editions' starting file free; a bishop target shares its color.
    // A drawn pawn formation is already random, so only fixed tiles mirror.
    let x = mirror && initialX && !(formation && index < formation.length) ? 8 - initialX : initialX;
    return { id: `f${state.floor}-${index}`, species: creature.id, palette: creature.palette, name: creature.name,
      piece: creature.piece, role: creature.piece, x, y, moved: false, phase: 'ready', intent: [], target: null };
  });
  applyLayoutPressure(state, layoutPiece, target.piece);
  const powerTile = LEGACY_LAYOUT_SEEDS.has(floorSeed(state))
    ? (layoutPiece === 'bishop' ? [3, 5] : layoutPiece === 'knight' ? [3, 4] : [4, 5])
    : distantPowerTile(state, layoutPiece, rng);
  state.items = [
    { x: 4, y: 4, type: 'coin' }, { x: 2, y: 4, type: 'coin' }, { x: 6, y: 4, type: 'coin' },
    { x: powerTile[0], y: powerTile[1], type: 'powerup', power: target.piece === 'pawn' ? 'freeze' : powerRoll(rng(), coinlessFloor(state)) },
  ];
  state.props = [];
  const reserved = [...state.enemies, ...state.items, state.player, state.exit];
  if (!LEGACY_LAYOUT_SEEDS.has(floorSeed(state))) reserved.push(...state.enemies.flatMap(openingSquares));
  // Barricades go down before the room's own walls and add to them.
  for (const tile of promotionBarricades(state, residents)) {
    const previous = state.map[tile.y];
    state.map[tile.y] = previous.slice(0, tile.x) + '#' + previous.slice(tile.x + 1);
    if (!connectedBoard(state)) { state.map[tile.y] = previous; continue; }
    state.props.push({ x: tile.x, y: tile.y, type: 'crate' });
  }
  const barricaded = state.props.length;
  const candidates = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if ((layoutPiece === 'bishop' && target.piece === 'pawn' && (x + y) % 2 === 0) || reserved.some((entry) => entry.x === x && entry.y === y) || (layoutPiece === 'pawn' && x >= 3 && x <= 5) || (Math.abs(x - 4) <= 1 && y >= 5)) continue;
    // A barricaded floor's open promotion squares stay open: rare, not impossible.
    if (state.map[y][x] === '#' || (barricaded && y === 7)) continue;
    candidates.push({ x, y, order: rng() });
  }
  candidates.sort((a, b) => a.order - b.order);
  // Screens go down first: walls on the squares that cut the longest open lines
  // into this floor's targets. They count toward the room's walls.
  if (state.screens > 0) {
    const reach = screenReach(state);
    const screens = candidates.filter((tile) => reach(tile) > 0).sort((a, b) => reach(b) - reach(a) || a.order - b.order).slice(0, state.screens);
    candidates.splice(0, candidates.length, ...screens, ...candidates.filter((tile) => !screens.includes(tile)));
  }
  for (const tile of candidates) {
    const previous = state.map[tile.y];
    state.map[tile.y] = previous.slice(0, tile.x) + '#' + previous.slice(tile.x + 1);
    if (!connectedBoard(state)) { state.map[tile.y] = previous; continue; }
    state.props.push({ x: tile.x, y: tile.y, type: ['pillar', 'crate', 'barrel', 'rock'][Math.floor(rng() * 4)] });
    if (state.props.length === (state.obstacleBase ?? 7) + state.floor + barricaded) break;
  }
  if (!state.legacyTurnOrder) {
    // Add the recruit after the layout is fixed; older editions keep their map.
    // Its own random stream leaves walls, monsters and coins untouched.
    const recruitRng = random(hash(`${floorSeed(state)}:companion:${state.floor}`));
    // Under royal rules the recruit is a king (KING_FLOOR_RECRUITS): a second
    // attacker that helps corner a dodging king beside any piece.
    // Floors 1 and 2 recruit any piece. Runs saved while they always recruited
    // a king keep that king; the tile draw is the same either way.
    const pool = royalRules(state) ? KING_FLOOR_RECRUITS : PIECES;
    const drawn = pool[Math.floor(recruitRng() * pool.length)];
    let piece = !royalRules(state) && kingRecruit ? 'king' : drawn;
    const clear = (tile) => walkable(state,tile.x,tile.y) && !enemyAt(state,tile.x,tile.y) && !same(tile,state.player) && !same(tile,state.exit) && !state.items.some((item)=>same(item,tile));
    let tiles = movesFor(state,{...state.player,piece:layoutPiece}).filter(clear);
    if (!tiles.length) {
      tiles = [];
      for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(clear({x,y}) && (layoutPiece !== 'bishop' || (x+y)%2===0) && (layoutPiece !== 'pawn' || (x===4 && y<6))) tiles.push({x,y});
    }
    let tile = tiles[Math.floor(recruitRng()*tiles.length)];
    // A pawn recruit waits only where its file is open to the far rank, so it
    // can walk up and promote. Drawn on a walled file, it moves to one of the
    // same squares whose file is open, or, with none, it is another piece on
    // the square drawn. Either takes one more draw from its own stream, so
    // nothing else in the room moves.
    if (piece === 'pawn' && tile && !openFile(state, tile)) {
      const lanes = tiles.filter((entry) => openFile(state, entry));
      const roll = recruitRng();
      if (lanes.length) tile = lanes[Math.floor(roll * lanes.length)];
      else piece = PAWNLESS[Math.floor(roll * PAWNLESS.length)];
    }
    if (tile) state.items.push({type:'companion',piece,x:tile.x,y:tile.y});
  }
  // Drop the coins only once walls and the recruit are placed, so the room keeps its layout.
  if (coinlessFloor(state)) state.items = state.items.filter((item) => item.type !== 'coin');
  fitPracticeRoom(state, layoutPiece);
  // The day's modifier (ice tiles, reinforcement count) once the room is fixed.
  setupFloorModifier(state);
  const order = (state.companionOrders ?? []).find((entry) => entry.floor === state.floor);
  if (order) {
    state.items = state.items.filter((item) => item.type !== 'companion');
    state.companion = { piece: order.piece, basePiece: order.piece, x: state.player.x, y: state.player.y, moved: false, sharing: true };
    state.events.push({ type: 'companion-recruit', piece: order.piece, x: state.player.x, y: state.player.y });
  }
  if (state.playerColor === 'white') for (const foe of state.enemies) (royalRules(state) ? aimAtPlayer : windUp)(state, foe);
}

const NO_MOVES = 'No legal moves. Back to the start of today’s dungeon.';

// Waiting answers a board where monsters block every move, so only terrain can
// truly trap the player: no move even with every monster gone.
function trapped(state) {
  return state.status === 'playing' && !state.exit.open && legalMoves(state).length === 0
    && movesFor({ ...state, enemies: [] }, state.player).length === 0;
}

// Running out of lives or out of moves ends the try: back to floor 1, with one more try on the share card.
// The certification search (src/fairness.js) throws away every transition
// that ends the run, so while it runs a run-ending capture only marks the
// restart instead of building a fresh dungeon (a seventh of its time before).
let markRestartsOnly = false;
/** Run `search` with restarts only marked; the search discards them anyway. */
export function whileSearching(search) {
  const was = markRestartsOnly;
  markRestartsOnly = true;
  try { return search(); } finally { markRestartsOnly = was; }
}

function restartRun(state, events, message) {
  if (markRestartsOnly) {
    state.events = [...events, { type: 'restart', x: state.player.x, y: state.player.y }];
    state.message = message;
    return state;
  }
  const fresh = createGame({ ...state, playerPiece: state.startingPiece, replayUnlocked: true });
  // Count today's attempts; saves from before this counter only know a restart happened.
  const tries = (state.tries ?? (state.replayUnlocked ? 2 : 1)) + 1;
  Object.assign(state, fresh);
  // A fresh run has no cave-in and has dropped no gold (fields the fresh state lacks).
  delete state.caveIn; delete state.dropped;
  // A held Take-back keeps its `undo`: it can take back the move that ended the run.
  state.tries = tries;
  // A new try starts every floor's move count afresh, paid hints and unmaskings too.
  delete state.restartedMoves; delete state.hints; delete state.unmasked;
  state.events = [...events, { type: 'restart', x: state.player.x, y: state.player.y }];
  state.message = message;
  return state;
}

/** Saves from before trapped runs restarted themselves end 'lost'; retrying one counts as another try. */
export function retryLostRun(previous) {
  if (previous?.status !== 'lost') return previous;
  return restartRun(nextState(previous), [], NO_MOVES);
}

export function createGame(daily = getRawDaily()) {
  const state = {
    schema: RULES_VERSION, rulesVersion: RULES_VERSION, dungeonSeed: daily.dungeonSeed ?? daily.seed, obstacleBase: daily.obstacleBase ?? 7, decoys: daily.decoys ?? 2, scatter: daily.scatter ?? 0, guards: daily.guards ?? 0, screens: daily.screens ?? 0, difficulty: daily.difficulty ?? 'standard', playerColor: daily.playerColor, legacyTurnOrder: false, awaitingPlayer: false, enPassant: null, date: daily.date, seed: daily.seed, edition: daily.edition, theme: structuredClone(daily.theme), species: structuredClone(daily.species), targets: [...daily.targets],
    startingPiece: daily.playerPiece, floor: 0, player: { x: 4, y: 6, piece: daily.playerPiece, hp: PIECE_LIVES[daily.playerPiece], maxHp: PIECE_LIVES[daily.playerPiece], moved: false },
    turns: 0, status: 'playing', captures: 0, paidCaptures: 0, treasure: 0, gold: 0, purchases: [], companionOrders: [], feats: [], powers: { shield: 0, freeze: 0, magnet: 0, pin: 0, leap: 0, takeback: 0 }, records: [], events: [],
    message: `${captureGoal(daily.targets[0])}. The newspaper holds a clue.`,
  };
  if (daily.practice === true) { state.practice = true; state.layoutPiece = daily.layoutPiece; }
  // An assembled day's floors each come from their own candidate layout (floorSeed).
  if (validFloorSeeds(daily.floorSeeds)) state.floorSeeds = [...daily.floorSeeds];
  // Barricades leave the edition's open promotion squares; a fallback keeps its template's.
  state.openFiles = Number.isInteger(daily.openFiles) ? daily.openFiles : openPromotionFiles(daily.date);
  // Plain days carry no modifier field, so their saves keep their shape.
  if (daily.modifier && daily.modifier !== 'none') state.modifier = daily.modifier;
  if (daily.replayUnlocked === true) state.replayUnlocked = true;
  // Old-versus-new comparisons only: Gentle habits on every tier and turn-hashed tie-breaks (src/monster-ai.js).
  if (daily.classicMonsters === true) state.classicMonsters = true;
  setFloor(state);
  markFloorStart(state);
  return state;
}

// Keep the floor exactly as it began, so the player may voluntarily start it over.
function markFloorStart(state) {
  // Attempt counters belong to the live run, so a restart never rewinds them.
  const { floorSnapshot, replayUnlocked, tries, restartedMoves, hints, unmasked, ...start } = state;
  state.floorSnapshot = structuredClone(start);
}

/**
 * Return to the start of the current floor: same lives, gold and powers as on
 * arrival. The moves already spent on the floor keep counting toward its score
 * (`restartedMoves`), so a restart can't wipe a floor's count back to zero.
 * Paid hints stay paid (and shown), and unmasked species stay unmasked.
 */
export function resetFloor(previous) {
  const snapshot = previous?.floorSnapshot;
  if (!snapshot || previous.status !== 'playing') return previous;
  const state = structuredClone(snapshot);
  state.floorSnapshot = structuredClone(snapshot);
  if (previous.replayUnlocked === true) state.replayUnlocked = true;
  if (previous.tries !== undefined) state.tries = previous.tries;
  const spent = floorScoredMoves(previous) - hintMoves(previous);
  if (spent) state.restartedMoves = spent;
  keepKnowledge(state, previous);
  state.message = `Floor ${state.floor + 1} reset. ${snapshot.message}`;
  return state;
}

// What the player learned on this floor outlives a floor restart or a Take-back:
// the hints they paid for and the species they unmasked.
function keepKnowledge(state, previous) {
  if (previous.hints?.length) state.hints = [...previous.hints];
  const unmasked = [...new Set([...(state.unmasked ?? []), ...(previous.unmasked ?? [])])];
  if (unmasked.length) state.unmasked = unmasked;
}

function finishFloor(state) {
  const captures = state.captures - state.floorStart.captures;
  const treasure = state.treasure - state.floorStart.treasure;
  // A life bought in this floor's shop is in `hp` but wasn't lost or kept on the floor.
  const lives = livesBought(state.purchases.slice(state.floorSnapshot?.purchases?.length ?? 0));
  const turns = state.turns - state.floorStart.turns;
  state.records.push({ floor: state.floor, turns, scored: state.objective.moves ?? turns, ...(state.restartedMoves && { restartedMoves: state.restartedMoves }), captures, treasure, hp: state.player.hp, ...(lives && { lives }), grade: treasure === 3 ? 'gold' : captures > PIECE_COUNTS[state.objective.piece] ? 'silver' : 'bronze' });
  // Paid hints are penalty moves on the floor's score (scoredMoves).
  if (state.hints?.length) state.records.at(-1).hints = [...state.hints];
  if (state.floor === 2) {
    state.status = 'won'; state.message = 'Your dispatch made the morning edition.';
    state.events.push({ type: 'win', x: state.player.x, y: state.player.y });
  } else {
    // A frozen room's leftover moves stay behind; only hourglasses bought in the
    // between-floor shop (the only purchases possible since the floor began) come along.
    const bought = state.purchases.slice(state.floorSnapshot?.purchases?.length ?? 0).filter((id) => id === 'freeze').length;
    state.powers.freeze = Math.min(state.powers.freeze, bought * 3);
    state.floor++; setFloor(state);
    state.message = `${captureGoal(state.objective.piece)}. New faces, new clues.`;
    state.events.push({ type: 'descend', x: state.player.x, y: state.player.y });
    markFloorStart(state);
  }
}

// Each floor's challenge pieces are mandatory, so only the optional residents pay out.
function bonusResidents(state, floor) {
  return floorDecoys(state, floor).filter((species) => species?.piece !== state.targets[floor]).length;
}
function bonusCaptures(state) {
  const earlier = state.records.slice(0, state.floor).reduce((sum, record) => sum + record.captures - (PIECE_COUNTS[state.targets[record.floor]] + floorDecoys(state, record.floor).length - bonusResidents(state, record.floor)), 0);
  const remaining = state.enemies.filter((foe) => (foe.role ?? foe.piece) !== state.targets[state.floor]).length;
  // Collapse reinforcements are decoys too: each one that entered pays when taken.
  return earlier + bonusResidents(state, state.floor) + (state.reinforcements ?? 0) - remaining;
}

function spentGold(state) {
  const orders = state.companionOrders ?? [];
  return orders.reduce((sum, entry) => sum + COMPANIONS.find((recruit) => recruit.piece === entry.piece).cost, 0)
    + state.purchases.reduce((sum, id) => sum + purchaseCost(id), 0);
}

function captureEnemy(state, captured, companion = false) {
  state.enemies = state.enemies.filter((foe) => foe.id !== captured.id);
  state.captures++;
  if ((captured.role ?? captured.piece) !== state.objective.piece) { state.gold++; state.paidCaptures++; }
  state.events.push({ type: companion ? 'companion-capture' : 'capture', id: captured.id, x: captured.x, y: captured.y });
  const unmasked = unmask(state, captured);
  if ((captured.role ?? captured.piece) === state.objective.piece) {
    state.objective.complete = !state.enemies.some((foe) => (foe.role ?? foe.piece) === state.objective.piece);
    state.exit.open = state.objective.complete;
    // The scored move count stops here: gathering gold afterwards is free.
    if (state.objective.complete) state.objective.moves = state.turns - state.floorStart.turns;
    const moves = floorScoredMoves(state);
    // The ✓ echoes the paused move counter; the UI adds par where the run has one.
    // A recruit already at your side hunts on its own from here (huntsAlone).
    if (state.exit.open) { state.message = unmasked; settle(state); }
    state.message = state.exit.open ? `You completed the challenge ✓ in ${moves} ${moves === 1 ? 'move' : 'moves'}. Your score is locked in: ${state.floor < 2 ? 'explore for gold or take the stairs' : 'take the stairs to finish'}.${state.floor < 2 && state.companion ? ' Your recruit will automatically watch your back while you explore.' : ''}` : `${unmasked} Keep hunting.`;
  } else state.message = `${unmasked} +1 gold.`;
}

// Every capture unmasks the monster's true role. A species keeps one role all
// edition, so from now on its look-alikes wear that piece as a badge (the
// renderer reads state.unmasked). Returns the log line, e.g. "Moss gremlin
// unmasked — a rook!".
function unmask(state, captured) {
  const role = captured.role ?? captured.piece;
  state.events.push({ type: 'unmask', id: captured.id, species: captured.species, role, x: captured.x, y: captured.y });
  if (captured.species && !(state.unmasked ?? []).includes(captured.species)) state.unmasked = [...(state.unmasked ?? []), captured.species];
  const who = captured.promoted ? `a crowned ${role}` : role === 'king' ? 'the king' : `a ${role}`;
  return `${captured.name} unmasked — ${who}!`;
}

// A recruit on Auto never captures the challenge piece: that capture is the player's.
function recruitMayTake(state, foe) { return !foe || (foe.role ?? foe.piece) !== state.objective.piece; }
export function challengeName(state) {
  const piece = state.objective.piece;
  return PIECE_COUNTS[piece] > 1 ? `${piece}s` : `the ${piece}`;
}
// "Capture all enemy bishops", but "Capture the enemy king" for a lone target.
export function captureGoal(piece) {
  return PIECE_COUNTS[piece] > 1 ? `Capture all enemy ${piece}s` : `Capture the enemy ${piece}`;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const distinct = (cast) => cast.filter((species, index) => cast.findIndex((entry) => entry.id === species.id) === index);
/**
 * Who can stand on `floor`: its target species, its decoys and, on a collapse
 * day, the decoy species its reinforcements come from, by name. Saves may
 * unmask any of them (validateSave).
 */
export function floorLineup(state, floor = state.floor) {
  const arrivals = state.modifier === 'collapse'
    ? reinforcementOptions({ ...state, floor, exit: { x: 4, y: 0 } }, 0).map((foe) => state.species.find((entry) => entry.id === foe.species))
    : [];
  return distinct([state.species[floor], ...floorDecoys(state, floor), ...arrivals]).sort(byName);
}

/**
 * The newspaper's two suspects for `floor`: its target and one other species
 * that can appear there, picked from the date on the paper's own hash stream
 * (never gameplay's). A decoy standing in the room from the start comes before
 * a collapse arrival, which would leave the target the only suspect in sight.
 * A floor with no other species shows its target alone. Ordered by name, so
 * the target comes first only by alphabet.
 */
export function paperSuspects(state, floor = state.floor) {
  const target = state.species[floor];
  const others = (cast) => distinct(cast).filter((species) => species.id !== target.id);
  const residents = others(floorDecoys(state, floor));
  const pool = residents.length ? residents : others(floorLineup(state, floor));
  if (!pool.length) return [target];
  return [target, pool[hash(`paper-suspects:${state.date}:${floor}`) % pool.length]].sort(byName);
}

/**
 * Hints, per floor. The first (how the target's role moves) is free and lives
 * in the UI. The paid ones, in order: 'suspects' ("Identify the target"; saves
 * keep that id) rings the target species and names it; 'danger' hatches the
 * squares where ending a move is captured at once (closeRangeSquares). Each
 * adds one move to the floor's score.
 */
export const PAID_HINTS = Object.freeze(['suspects', 'danger']);
const hintMoves = (value) => (Array.isArray(value?.hints) ? value.hints.length : 0);
const validHints = (hints) => Array.isArray(hints) && hints.length > 0 && new Set(hints).size === hints.length && hints.every((hint) => PAID_HINTS.includes(hint));
/** The floor's target species: its role is the objective's. */
export function targetSpecies(state) { return state.species[state.floor]; }
/** The paid hint on offer, or null once the floor's challenge is complete or nothing is left to buy. */
export function nextHint(state) {
  if (state?.status !== 'playing' || !state.objective || state.objective.complete) return null;
  const bought = state.hints ?? [];
  // A target already unmasked wears its badge, so identifying the target would add nothing.
  if (!bought.includes('suspects') && !(state.unmasked ?? []).includes(targetSpecies(state)?.id)) return 'suspects';
  return bought.includes('danger') ? null : 'danger';
}
/**
 * The hint cards unlocked on this floor, in the order they were unlocked: the
 * free card ('moves', how the target's role moves) first, then each paid hint
 * as bought. The hint dialog pages through them; paging changes nothing.
 */
export function hintCards(state) {
  return ['moves', ...(state?.hints ?? [])];
}
/** The target, identified: "the Ember cats are the enemy bishops, ringed on the board." */
export function targetLine(state) {
  const species = targetSpecies(state);
  const many = PIECE_COUNTS[state.objective.piece] > 1;
  const who = many ? `${species.palette[0].toUpperCase() + species.palette.slice(1)} ${species.plural.toLowerCase()}` : species.name;
  return `the ${who} ${many ? 'are' : 'is'} the enemy ${state.objective.piece}${many ? 's' : ''}, ringed on the board.`;
}
/** The danger map: every square where ending a move now is captured at once, by the monsters' true roles. */
export function closeRangeSquares(state) {
  const squares = [];
  if (state?.status !== 'playing') return squares;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (walkable(state, x, y) && !same({ x, y }, state.player) && closeAttacker(state, { x, y })) squares.push({ x, y });
  }
  return squares;
}

// Manual recruit control: a move or wait may carry the recruit's order for that
// turn, a square it can move to ({x, y}) or 'hold'. An ordered recruit may
// capture any monster, the challenge piece included. With no order (Auto, and
// every certified route) its own AI moves it, as below.
const RECRUIT_PROBE = Symbol('recruit probe');
const validOrder = (order) => order === 'hold' || (order !== null && typeof order === 'object' && inside(order.x, order.y));
const squareOrder = (order) => order !== undefined && order !== 'hold' && order !== RECRUIT_PROBE;
// Once a floor's challenge is complete the recruit hunts on its own for the
// rest of that room, as on Auto, so it keeps winning gold while you collect
// coins: no order step, and an order a move or wait still carries is ignored.
// On the last floor that means the move that takes the king goes straight to
// the stairs, with no order to give first.
const huntsAlone = (state) => state.exit.open;
// Thrown by companionTurn for recruitChoice: the turn stops as the recruit's phase begins.
class RecruitPhase {
  constructor(board, phase, moves, hop) { this.board = board; this.phase = phase; this.moves = moves; this.hop = hop; }
}

/**
 * Where the recruit could move this turn if the player plays `action` (a move
 * or a wait, without an order), for Manual recruit control. Null when the turn
 * has no recruit phase: no recruit yet, castling (that was its move), a black
 * move the monsters' first move sends back for a new choice, a run-ending
 * capture, or a cleared floor (huntsAlone). Otherwise `board` is the
 * position as its phase begins (after your move, a close-range hit and, as
 * black, the monsters' first move; `board.events[phase]` is its
 * 'companion-phase'), and `moves` its legal squares, captures of any monster
 * included, except on the move it joins you, when it can't capture (see
 * companionTurn). On the bishop pair's turn `hop` is true: `moves` are then the
 * squares of the other colour it may hop to, and it may not hold unless there
 * are none. Changes nothing.
 */
export function recruitChoice(previous, action) {
  if (action?.type !== 'move' && action?.type !== 'wait') return null;
  try {
    play(previous, { ...action, recruit: RECRUIT_PROBE });
  } catch (stop) {
    if (stop instanceof RecruitPhase) return { board: stop.board, phase: stop.phase, moves: stop.moves, ...(stop.hop && { hop: true }) };
    throw stop;
  }
  return null;
}

// The bishop pair. A bishop never leaves its square colour, and a recruit waits
// one move from your start, so a bishop recruit joining your bishop shares your
// colour and could only ever reach squares you already cover. Instead, its move
// that turn hops it onto the other colour: two bishops on opposite colours
// cover every square between them. It hops to a side square of its own (up,
// down, left or right, always the other colour) that is open and holds no
// monster; with all four blocked, to any such square of the other colour. Your
// bishop is on your colour, so it is never offered, and the hop never captures.
// The rule is the position, not the turn: a bishop recruit standing on your
// bishop's colour always hops. That is the turn it joins, and again only if a
// Borrowed (knight) move later puts your bishop on its colour. The door square
// needs no exception: an arrival never waits there (src/modifiers.js).
// Returns the squares, `blocked` when no side square was free, or null when
// the bishop pair doesn't apply.
function pairHop(state, unit) {
  const colour = (tile) => (tile.x + tile.y) % 2;
  if (state.player.piece !== 'bishop' || unit.piece !== 'bishop' || colour(unit) !== colour(state.player)) return null;
  const free = (tile) => walkable(state, tile.x, tile.y) && !enemyAt(state, tile.x, tile.y);
  const sides = ORTHOGONAL.map(([dx, dy]) => ({ x: unit.x + dx, y: unit.y + dy })).filter(free);
  if (sides.length) return { squares: sides, blocked: false };
  const squares = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (colour({ x, y }) !== colour(unit) && free({ x, y })) squares.push({ x, y });
  return { squares, blocked: true };
}
// Auto's hop: the side square whose diagonals reach the most squares from
// there, or with all four blocked the nearest square in king steps; a tie goes
// by the day's seed.
function autoHop(state, unit, { squares, blocked }) {
  const rank = blocked ? (tile) => chebyshev(tile, unit) : (tile) => -hypothetically(unit, tile, () => movesFor(state, unit).length);
  const tie = (tile) => hash(`${floorSeed(state)}:bishop-pair:${state.floor}:${tile.x},${tile.y}`);
  return squares.map((tile) => ({ tile, rank: rank(tile), tie: tie(tile) })).sort((a, b) => a.rank - b.rank || a.tie - b.tie)[0].tile;
}
function hopToOtherColour(state, unit, square) {
  state.events.push({ type: 'bishop-pair', from: { x: unit.x, y: unit.y }, x: square.x, y: square.y });
  moveCompanion(state, unit, square);
  state.feats.push({ floor: state.floor, kind: 'bishop-pair' });
  state.message = 'Holy duo! Your recruit hopped to the other colour, so your two bishops cover every square.';
}

// The recruit's move, once per turn after the player's. Returns false for an
// order it can't carry out, which makes the whole action no action.
// `joined`: the recruit joined with this very move. Then it can't capture,
// on Manual or Auto: monsters never steer clear of a waiting recruit's lines,
// so it would otherwise take whatever walked into them the moment you joined
// it. Holding, a quiet move or the bishop pair's hop are left, and castling
// can't come up (the recruit wasn't beside you when you moved).
function companionTurn(state, order, joined = false) {
  const unit = state.companion;
  if (!unit) return !squareOrder(order);
  unit.sharing = same(unit,state.player);
  const phase = state.events.length;
  state.events.push({type:'companion-phase',x:unit.x,y:unit.y});
  // A pawn recruited on the far rank promotes before choosing its first move.
  if (unit.piece==='pawn' && unit.y===0) {
    unit.piece='queen';
    state.events.push({type:'companion-promotion',x:unit.x,y:unit.y});
  }
  const hop = pairHop(state, unit);
  const legal = () => movesFor(state,unit).filter((move) => !joined || !move.capture);
  if (order === RECRUIT_PROBE) {
    const moves = hop ? hop.squares.map(({x,y}) => ({x,y,capture:false})) : legal().map(({x,y,capture}) => ({x,y,capture}));
    throw new RecruitPhase(state, phase, moves, Boolean(hop));
  }
  // The bishop pair's hop is its move this turn: it may only stay put (or be
  // left to Auto) on a board with nowhere to hop.
  if (hop) {
    if (!hop.squares.length) return !squareOrder(order);
    const square = order === undefined ? autoHop(state, unit, hop) : order === 'hold' ? null : hop.squares.find((tile) => same(tile, order));
    if (square) hopToOtherColour(state, unit, square);
    return Boolean(square);
  }
  if (order === 'hold') return true;
  if (order !== undefined) {
    const ordered = legal().find((move) => same(move,order));
    if (ordered) moveCompanion(state,unit,ordered);
    return Boolean(ordered);
  }
  if (!state.enemies.length) return true;
  const candidates = legal().filter((move) => !move.capture || recruitMayTake(state, enemyAt(state,move.x,move.y)));
  const nearest = (move) => Math.min(...state.enemies.map((foe)=>distance(move,foe)));
  // Like the monsters' (monsterTie), its tie-break counts this floor's moves, not
  // the run's, so a floor plays the same however long the earlier ones took. A
  // king recruit, with its many equal steps, leans on it often.
  const clock = state.classicMonsters === true ? state.turns : state.turns - (state.floorStart?.turns ?? 0);
  const tie = (move) => hash(`${floorSeed(state)}:companion:${state.floor}:${clock}:${move.x},${move.y}`);
  // Each candidate's keys once, compared exactly as before.
  const ranked = candidates.map((move) => ({ move, capture: Number(move.capture), nearest: nearest(move), away: distance(move,unit), tie: tie(move) }));
  ranked.sort((a,b) => b.capture-a.capture || a.nearest-b.nearest || b.away-a.away || a.tie-b.tie);
  const destination = ranked[0]?.move;
  if (destination) moveCompanion(state,unit,destination);
  return true;
}

function moveCompanion(state, unit, destination) {
  const from = {x:unit.x,y:unit.y};
  const captured = enemyAt(state,destination.x,destination.y);
  unit.x=destination.x; unit.y=destination.y; unit.moved=true; unit.sharing=false;
  state.events.push({type:'companion-move',piece:unit.piece,from,x:unit.x,y:unit.y});
  if (captured) captureEnemy(state,captured,true);
  if (unit.piece==='pawn' && unit.y===0) {
    unit.piece='queen';
    state.events.push({type:'companion-promotion',x:unit.x,y:unit.y});
  }
}

function grantPower(state, id) {
  const power = POWERUPS.find((entry) => entry.id === id);
  state.powers[id] = Math.min(power.max, (state.powers[id] ?? 0) + (id === 'freeze' ? 3 : 1));
  state.events.push({ type: 'powerup', power: id, x: state.player.x, y: state.player.y });
  state.message = `${power.name} acquired.`;
}

// structuredClone's result for plain JSON-like data, faster: objects and arrays
// are copied key by key, shared references stay shared (`seen`), and anything
// else that is not a primitive falls back to structuredClone.
function deepCopy(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  const known = seen.get(value);
  if (known) return known;
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value) && proto === Array.prototype) {
    const copy = new Array(value.length);
    seen.set(value, copy);
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return replaceCopy(value, seen);
      copy[i] = deepCopy(value[i], seen);
    }
    return copy;
  }
  if (proto !== Object.prototype && proto !== null) return replaceCopy(value, seen);
  const copy = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = deepCopy(value[key], seen);
  return copy;
}
function replaceCopy(value, seen) {
  const copy = structuredClone(value);
  seen.set(value, copy);
  return copy;
}
// Fields act() never changes in place: the floor snapshot (replaced whole by
// markFloorStart, copied by resetFloor), the day's theme and species, and the
// room's props (replaced whole when a floor is set up). The next state shares
// them instead of deep-copying them on every move.
const SHARED_FIELDS = new Set(['floorSnapshot', 'theme', 'species', 'props']);
function nextState(previous) {
  const seen = new Map();
  // Same key order as a whole-state copy, so saves serialize identically.
  const state = {};
  for (const key of Object.keys(previous)) {
    // Left out rather than deleted after (a delete slows every later read of
    // the state): the last action's notes, and `leaping`, from saves made when
    // a Borrowed move had to be armed first.
    if (key === 'notes' || key === 'leaping') continue;
    // Every caller starts its own events, so the last action's are never copied.
    state[key] = SHARED_FIELDS.has(key) ? previous[key] : key === 'events' ? [] : deepCopy(previous[key], seen);
  }
  state.companionOrders ??= [];
  // Saves from before special moves were tracked start an empty list.
  state.feats ??= [];
  // Saves from before the shop tools have no count for them.
  for (const power of POWERUPS) state.powers[power.id] ??= 0;
  // Saves from before optional-only capture gold were paid for every capture; keep what they banked.
  state.paidCaptures ??= state.gold - state.treasure + spentGold(state) - tacticGold(state.feats);
  // Older saves only recorded exhaustion in the last action's events.
  if (previous.events.some((event) => event.type === 'restart')) state.replayUnlocked = true;
  return state;
}

// A held Take-back keeps the position before each move or wait, one deep.
function remember(state, previous) {
  if (!(previous.powers.takeback > 0)) { delete state.undo; return; }
  const { undo, notes, ...before } = previous;
  state.undo = structuredClone(before);
}

// Each phase of a move (the player's, the recruit's, the monsters', the ceiling's)
// may say something. A later phase no longer erases an earlier one: settle() files
// the earlier line in state.notes, oldest first, and state.message stays the last.
function settle(state) {
  if (!state.message) return;
  (state.notes ??= []).push(state.message);
  state.message = '';
}

export function act(previous, action) {
  // A recruit order is a square or 'hold' (see companionTurn); anything else is no action.
  if (action?.recruit !== undefined && !validOrder(action.recruit)) return previous;
  const state = play(previous, action);
  if (state !== previous && state.notes) {
    state.message ||= state.notes.pop();
    if (!state.notes.length) delete state.notes;
  }
  return state;
}

function play(previous, action) {
  if (!previous || previous.status !== 'playing' || !action) return previous;
  if (action.type === 'descend') {
    if (!previous.exit.open || !previous.objective.complete) return previous;
    const state = nextState(previous); state.events = []; state.awaitingPlayer = false;
    // A Take-back can't cross the stairs.
    delete state.undo;
    finishFloor(state);
    if (state.status === 'playing' && !pinUsable(state) && state.powers.pin) {
      state.powers.pin = 0;
      state.message += ' Your unused pin stays behind: pins only work on floor 2.';
    }
    return state;
  }
  if (action.type === 'buy') {
    // The shop opens only between floors: after a room is cleared, before its stairs.
    if (previous.floor >= 2 || !previous.exit.open || !previous.objective.complete) return previous;
    // Companions are no longer sold; older saves keep the orders they already placed.
    if (COMPANIONS.some((entry) => entry.id === action.id)) return previous;
    // Only today's four offers are for sale.
    if (!shopOffers(previous).includes(action.id)) return previous;
    if (action.id === EXTRA_LIFE.id) {
      const thisVisit = previous.purchases.slice(previous.floorSnapshot?.purchases?.length ?? 0);
      if (previous.gold < EXTRA_LIFE.cost || livesBought(thisVisit)) return previous;
      const state = nextState(previous); delete state.undo; state.events = []; state.gold -= EXTRA_LIFE.cost; state.purchases.push(EXTRA_LIFE.id);
      state.player.hp++; state.player.maxHp++;
      state.events.push({ type: 'powerup', power: EXTRA_LIFE.id, x: state.player.x, y: state.player.y });
      state.message = `Extra life bought. ${state.player.hp} lives.`;
      return state;
    }
    const power = POWERUPS.find((entry) => entry.id === action.id);
    if (!power || power.sold === false || (previous.powers[power.id] ?? 0) >= power.max || previous.gold < power.cost || previous.powers[power.id] >= power.max || (power.id === 'magnet' && coinlessFloor(previous, previous.floor + 1))) return previous;
    const state = nextState(previous); delete state.undo; state.events = []; state.gold -= power.cost; state.purchases.push(power.id); grantPower(state, power.id); return state;
  }
  if (action.type === 'takeback') {
    const target = takebackTarget(previous);
    if (!target) return previous;
    // Everything the move changed comes back, a lost life or a lost run included.
    const state = structuredClone(target);
    delete state.notes; delete state.undo;
    state.powers.takeback--;
    // It takes back the move, not a hint paid for since or a monster seen unmasked.
    if (state.floor === previous.floor && state.tries === previous.tries) keepKnowledge(state, previous);
    state.events = [{ type: 'takeback', x: state.player.x, y: state.player.y }];
    state.message = 'You took back your last move.';
    return state;
  }
  // A caved-in room is over: what's left is the shop, the stairs down and a Take-back.
  if (cavedIn(previous) && (action.type === 'wait' || action.type === 'pin')) return previous;
  if (action.type === 'pin') {
    const foe = previous.enemies.find((entry) => entry.id === action.id);
    if (!(previous.powers.pin > 0) || !pinUsable(previous) || !foe || pinned(foe)) return previous;
    // Pinning is free: it spends the tool, not a move.
    const state = nextState(previous);
    const target = state.enemies.find((entry) => entry.id === action.id);
    target.pinned = PIN_MOVES; target.phase = 'ready'; target.intent = []; target.target = null;
    state.powers.pin--;
    state.events = [{ type: 'pin', id: target.id, x: target.x, y: target.y }];
    state.message = `${target.name} is pinned for ${PIN_MOVES} moves.`;
    return state;
  }
  if (action.type === 'hint') {
    // A paid hint is a penalty stroke: one move on this floor's score, no turn passes.
    const hint = nextHint(previous);
    if (!hint || action.hint !== hint) return previous;
    const state = nextState(previous);
    state.hints = [...(state.hints ?? []), hint];
    state.events = [{ type: 'hint', hint, x: state.player.x, y: state.player.y }];
    state.message = hint === 'suspects' ? `Target identified (+1 move): ${targetLine(state)}` : 'Danger map (+1 move): hatched squares get you captured at once if you end a move there.';
    return state;
  }
  if (action.type === 'wait') {
    // Waiting spends a move without moving: monsters act, the companion acts,
    // and nothing is resolved on the player's square (no close-range capture).
    const state = nextState(previous); remember(state, previous);
    state.events = [{ type: 'wait', x: state.player.x, y: state.player.y }]; state.message = '';
    if (state.playerColor === 'black' && !state.awaitingPlayer) {
      enemyTurn(state);
      if (state.events.some((event) => event.type === 'restart')) return state;
      settle(state);
    }
    // Waiting is the player's move, so it spends any en passant window.
    state.awaitingPlayer = false; state.turns++; state.enPassant = null; breakTactics(state); regainBalance(state);
    if (!companionTurn(state, huntsAlone(state) ? undefined : action.recruit)) return previous;
    settle(state);
    if (state.playerColor === 'white') { enemyTurn(state); settle(state); }
    collapseTick(state); settle(state);
    caveInTick(state, previous); settle(state);
    if (trapped(state)) restartRun(state, [], NO_MOVES);
    return state;
  }
  if (action.type !== 'move' || !legalMoves(previous).some((move) => move.x === action.x && move.y === action.y)) return previous;
  const state = nextState(previous); remember(state, previous);
  state.events = []; state.message = '';
  // A pawn's double step is also exposed to en passant on the square it passes.
  const doubleStep = state.player.piece === 'pawn' && state.player.y === 6 && action.y === 4;
  const threat = (square) => closeAttacker(state, square) ?? (doubleStep ? enPassantStriker(state, square) : null);
  const castleFor = (board) => {
    const castle = castling(board);
    return castle && same(castle.click, action) ? castle : null;
  };
  if (state.playerColor === 'black' && !state.awaitingPlayer) {
    const origin = { x: state.player.x, y: state.player.y, piece: state.player.piece };
    const castleBefore = castleFor(state);
    // A castling rook lands beside its king, not on the square clicked.
    const closeBefore = threat(castleBefore ? castleBefore.player.to : iceSlide(state, action) ?? action);
    enemyTurn(state);
    // Losing the last life starts a fresh run; the old click has no meaning there.
    if (state.events.some((event) => event.type === 'restart')) return state;
    state.awaitingPlayer = true;
    const relocated = !same(origin, state.player) || origin.piece !== state.player.piece;
    // A destination the enemy phase newly put in close range also earns a fresh choice.
    const castleAfter = castleFor(state);
    const ambushed = !closeBefore && threat(castleAfter ? castleAfter.player.to : iceSlide(state, action) ?? action);
    // A freshly opened en passant capture is a new option worth a fresh choice too.
    const opening = legalMoves(state).some((move) => move.enPassant);
    // So is a click whose meaning changed: a castle that is no longer possible
    // (or newly is), even if the square is still an ordinary move.
    const reinterpreted = Boolean(castleBefore) !== Boolean(castleAfter);
    if (relocated || ambushed || opening || reinterpreted || !legalMoves(state).some((move) => move.x === action.x && move.y === action.y)) {
      if (trapped(state)) return restartRun(state, [], NO_MOVES);
      state.message = `${state.message ? `${state.message} ` : ''}${relocated ? 'Choose a move for your replacement pawn.' : legalMoves(state).length ? 'The board changed. Choose another move.' : 'The board changed. Wait for an opening.'}`;
      return state;
    }
    settle(state);
  }
  // Castling is decided on the board the move is played on (after black's prelude).
  const castle = castleFor(state);
  // Spend the Borrowed move only when the square needed it.
  if (state.powers.leap > 0 && !chessMoves({ ...state, powers: { ...state.powers, leap: 0 } }).some((move) => same(move, action))) {
    state.powers.leap--;
    state.events.push({ type: 'leap', x: action.x, y: action.y });
  }
  state.awaitingPlayer = false; state.turns++;
  // A fork set up by the previous move pays off only on this one.
  const pendingFork = state.fork;
  // The en passant window lasts exactly this move: take it now or lose it.
  const passed = action.y === 2 && state.enPassant?.x === action.x ? enPassantVictim(state, state.enPassant) : null;
  state.enPassant = null;
  // White resolves this move before monsters; black has already resolved them.
  const captured = castle ? null : passed ?? enemyAt(state, action.x, action.y);
  if (captured) captureEnemy(state,captured);
  if (passed) {
    state.events.push({ type: 'en-passant', id: passed.id, x: passed.x, y: passed.y, to: { x: action.x, y: action.y } });
    state.feats.push({ floor: state.floor, kind: 'en-passant' });
    // "En passant! Ice bat unmasked — a pawn! +1 gold."
    if (!state.exit.open) state.message = `En passant! ${state.message}`;
  }
  // On ice a non-capturing slide skids one more square (src/modifiers.js).
  const slide = castle || captured ? null : iceSlide(state, action);
  const to = castle ? castle.player.to : slide ?? action;
  if (castle) {
    // King and rook move together; this is the recruit's move too.
    const ally = state.companion;
    const from = { x: ally.x, y: ally.y };
    ally.x = castle.companion.to.x; ally.y = castle.companion.to.y; ally.moved = true; ally.sharing = false;
    state.events.push({ type: 'castle', x: to.x, y: to.y, king: castle.king, rook: castle.rook });
    state.events.push({ type: 'companion-move', piece: ally.piece, from, x: ally.x, y: ally.y });
    state.feats.push({ floor: state.floor, kind: 'castle' });
    state.message = 'Castled! King and rook switched sides in one move.';
  }
  state.player.x = to.x; state.player.y = to.y; state.player.moved = true;
  state.events.push({ type: 'move', x: to.x, y: to.y });
  if (slide) {
    state.events.push({ type: 'slide', from: { x: action.x, y: action.y }, x: to.x, y: to.y });
    if (!state.message) state.message = 'You skid across the ice.';
  }
  if (state.player.piece === 'pawn' && state.player.y === 0) {
    state.player.piece = 'queen';
    state.events.push({ type: 'promotion', x: to.x, y: to.y });
    // A capture on the far rank keeps its unmasking line.
    if (!state.exit.open) { settle(state); state.message = 'Promoted to queen for the rest of this floor.'; }
  }
  const recruit = state.items.find((item) => item.type === 'companion' && same(item,state.player));
  // A recruit captures nothing on the turn it joins (companionTurn).
  const joined = Boolean(recruit && !state.companion);
  if (joined) {
    state.items = state.items.filter((item)=>item!==recruit);
    state.companion = {piece:recruit.piece,basePiece:recruit.piece,x:recruit.x,y:recruit.y,moved:false,sharing:true};
    state.events.push({type:'companion-recruit',piece:recruit.piece,x:recruit.x,y:recruit.y});
    // An action with a recruit order is played under Manual recruit control.
    // On a cleared floor it takes no orders either way (huntsAlone). A
    // monster you took on the recruit's square keeps its line (maybe the clear).
    settle(state);
    state.message = huntsAlone(state) ? `A ${recruit.piece} joins you and hunts on its own for the rest of this room.`
      : action.recruit === undefined
      ? `A ${recruit.piece} joins you this floor. It can capture from your next move on, but never ${challengeName(state)}.`
      : `A ${recruit.piece} joins you this floor. You move it after each of your moves. It can capture from your next move on, even ${challengeName(state)}.`;
  }
  // Pick up the relic before applying the magnet, so it works immediately.
  const relic = state.items.find((item) => item.type === 'powerup' && same(item, state.player));
  if (relic) { state.items = state.items.filter((item) => item !== relic); grantPower(state, relic.power); }
  const coins = state.items.filter((item) => item.type === 'coin' && (same(item, state.player) || (state.powers.magnet && distance(item, state.player) <= 2)));
  for (const coin of coins) {
    state.items = state.items.filter((item) => item !== coin); state.treasure++; state.gold++;
    state.events.push({ type: 'pickup', x: coin.x, y: coin.y });
  }
  // Ending a move in close range of a monster is captured at once: no warning
  // turn. At most one hit per move, so white's enemy phase then captures no one.
  // A double step can instead be taken en passant by a pawn beside it.
  const guard = closeAttacker(state, state.player);
  const close = guard ?? (doubleStep ? enPassantStriker(state, state.player) : null);
  if (close) {
    settle(state);
    const passing = !guard;
    const event = { type: 'close-capture', id: close.id, x: close.x, y: close.y, ...(passing && { enPassant: true }) };
    state.events.push(event);
    const hit = capturePlayer(state, close, true, passing);
    if (hit === 'restart') { state.events.unshift(event); return state; }
    // As in chess, an en passant capture lands on the square the pawn skipped.
    const skipped = { x: state.player.x, y: state.player.y + 1 };
    if (passing && hit === 'captured' && walkable(state, skipped.x, skipped.y) && !enemyAt(state, skipped.x, skipped.y)) relocate(state, close, skipped);
  }
  regainBalance(state);
  scoreTactics(state, { captured, pending: pendingFork, hit: Boolean(close), attacks: () => legalMoves(state) });
  settle(state);
  // Castling was the recruit's move, so an order to move it again is no action.
  // A cleared floor ignores orders: the recruit hunts on its own there.
  const order = huntsAlone(state) ? undefined : action.recruit;
  if (castle ? squareOrder(order) : !companionTurn(state, order, joined)) return previous;
  if (!castle) settle(state);
  if (state.playerColor === 'white') { enemyTurn(state, Boolean(close)); settle(state); }
  collapseTick(state); settle(state);
  caveInTick(state, previous); settle(state);
  if (trapped(state)) restartRun(state, [], NO_MOVES);
  return state;
}

// A spoiler-free result card, golf-style:
//   Dungeon Chess Daily · Nov 7 ♝
//   🟥 +2  ⬛ E 🔱  👑 −12 🔱
//   https://ryanlmelvin.github.io/dungeon-chess-daily/
// The title names the edition's UTC date (with the year only when it isn't the
// current one) and the run's starting piece. Then each floor reached, two spaces
// apart: its marker, its moves against par (src/par.js; E for even, · without a
// par), then 🇫🇷🏰🔱 once each if that floor took en passant, castled or won a
// fork. Every floor starts with its marker, so the line reads cleanly at any score.
const FLOOR_MARKERS = ['🟥', '⬛', '👑'];
const FEAT_MARKS = [['en-passant', '\u{1F1EB}\u{1F1F7}'], ['castle', '🏰'], ['fork', '🔱']];
// The black glyph whatever the run's color. Of the six, only ♟ also has an emoji
// form (since Emoji 11.0), which some phones draw by default; U+FE0E asks for its
// text form so it matches the other five, which have no emoji form to opt out of.
const PIECE_MARKS = { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟\uFE0E' };
/**
 * Moves that count toward a floor's score: those until the challenge was
 * complete, plus those spent on the floor before any Restart this floor, plus
 * one per paid hint. Older records count every move.
 */
export function scoredMoves(record) {
  const moves = record?.scored ?? record?.turns;
  return Number.isInteger(moves) ? moves + (record.restartedMoves ?? 0) + hintMoves(record) : moves;
}

/** Scored moves on the floor in progress, restarts and paid hints included: still counting until the challenge is complete. */
export function floorScoredMoves(state) { return (state.objective?.moves ?? state.turns - state.floorStart.turns) + (state.restartedMoves ?? 0) + hintMoves(state); }

/** The edition's full date, e.g. "Sat, Nov 7, 2026" (UTC, like the edition itself), as the archive and dialogs name it. */
export function shareDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** The share card's date, e.g. "Nov 7", or "Nov 7, 2026" for an edition from a year other than `now`'s (both UTC). */
function cardDate(date, now) {
  const day = new Date(`${date}T12:00:00Z`);
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day.getUTCFullYear() !== now.getUTCFullYear() && { year: 'numeric' }), timeZone: 'UTC' });
}

export function getShareText(state, pars = null, { url = 'https://ryanlmelvin.github.io/dungeon-chess-daily/', now = new Date() } = {}) {
  const floors = [];
  for (let floor = 0; floor <= Math.min(state.floor, 2); floor++) {
    const record = state.records.find((entry) => entry.floor === floor);
    const diff = Number.isInteger(scoredMoves(record)) && Number.isInteger(pars?.[floor]) ? scoredMoves(record) - pars[floor] : null;
    const score = diff === null ? '·' : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `\u2212${-diff}`;
    const feats = FEAT_MARKS.filter(([kind]) => (state.feats ?? []).some((feat) => feat.kind === kind && feat.floor === floor)).map(([, mark]) => mark).join('');
    floors.push([FLOOR_MARKERS[floor], score, feats].filter(Boolean).join(' '));
  }
  return [`Dungeon Chess Daily · ${cardDate(state.date, now)} ${PIECE_MARKS[state.startingPiece]}`, floors.join('  '), url].filter(Boolean).join('\n');
}

export function validateSave(value, date, daily = getRawDaily(date)) {
  try {
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!value || value.schema !== RULES_VERSION || value.rulesVersion !== RULES_VERSION || value.date !== date || !['playing', 'won', 'lost'].includes(value.status)) return false;
    if (value.replayUnlocked !== undefined && typeof value.replayUnlocked !== 'boolean') return false;
    if (value.tries !== undefined && !integer(value.tries, 2, Number.MAX_SAFE_INTEGER)) return false;
    // Saves from before restarts kept counting have none: no earlier moves on this floor.
    if (value.restartedMoves !== undefined && !integer(value.restartedMoves, 1, Number.MAX_SAFE_INTEGER)) return false;
    if (daily.practice === true) {
      if (value.practice !== true || value.layoutPiece !== daily.layoutPiece || !PIECES.includes(value.layoutPiece)) return false;
    } else if (value.practice !== undefined || value.layoutPiece !== undefined) return false;
    if (value.legacyTurnOrder !== false || value.playerColor !== daily.playerColor || typeof value.awaitingPlayer !== 'boolean') return false;
    if (value.awaitingPlayer && (value.playerColor !== 'black' || value.status !== 'playing')) return false;
    if ((value.modifier ?? 'none') !== (daily.modifier ?? 'none')) return false;
    if (value.dungeonSeed !== (daily.dungeonSeed ?? daily.seed) || value.obstacleBase !== (daily.obstacleBase ?? 7) || value.difficulty !== (daily.difficulty ?? 'standard')) return false;
    if (!equal(value.floorSeeds ?? null, validFloorSeeds(daily.floorSeeds) ? daily.floorSeeds : null)) return false;
    if (value.openFiles !== (Number.isInteger(daily.openFiles) ? daily.openFiles : openPromotionFiles(daily.date))) return false;
    if ((value.decoys ?? 2) !== (daily.decoys ?? 2) || (value.scatter ?? 0) !== (daily.scatter ?? 0) || (value.guards ?? 0) !== (daily.guards ?? 0) || (value.screens ?? 0) !== (daily.screens ?? 0)) return false;
    // Not `edition`: the number moved when the archive began at 2026-11-01, and seed and date pin the day.
    if (value.seed !== daily.seed || value.startingPiece !== daily.playerPiece || !equal(value.species, daily.species) || !equal(value.targets, daily.targets) || !equal(value.theme, daily.theme)) return false;
    // Collapse days may add reinforcements to a floor (up to a cap).
    const population = (floor) => PIECE_COUNTS[daily.targets[floor]] + floorDecoys(daily, floor).length + extraPopulation(value.modifier);
    const reinforced = value.reinforcements ?? 0;
    const totalPopulation = [0, 1, 2].reduce((sum, floor) => sum + population(floor), 0);
    // Each capture may also pay a fork and a combo bonus (tactics.js).
    const maxGold = totalPopulation + 9 + totalPopulation * (TACTIC_KINDS.length + 1);
    if (!integer(value.floor, 0, 2) || !integer(value.turns, 0, Number.MAX_SAFE_INTEGER) || !integer(value.captures, 0, totalPopulation) || !integer(value.treasure, 0, 9) || !integer(value.gold, 0, maxGold)) return false;
    if (!value.player || !walkable(value, value.player.x, value.player.y) || !Array.isArray(value.purchases) || value.player.maxHp !== PIECE_LIVES[value.startingPiece] + livesBought(value.purchases) || !integer(value.player.hp, 1, value.player.maxHp) || typeof value.player.moved !== 'boolean') return false;
    if (value.player.piece !== value.startingPiece && !(value.startingPiece === 'pawn' && value.player.piece === 'queen')) return false;
    if (value.status === 'playing' && value.player.hp < 1) return false;
    if (value.status === 'won' && (value.player.hp < 1 || value.floor !== 2 || !value.objective.complete)) return false;
    if (!value.powers || !POWERUPS.every((power) => integer(value.powers[power.id] ?? 0, 0, power.max))) return false;
    // A Take-back's saved position must itself be a valid save, one deep.
    if (value.undo !== undefined && !(value.undo && typeof value.undo === 'object' && value.undo.undo === undefined && validateSave(value.undo, date, daily))) return false;
    if (!Array.isArray(value.purchases) || value.purchases.length > Math.floor(maxGold / 2) || !value.purchases.every((id) => purchaseCost(id) !== undefined)) return false;
    // Schema-5 saves made before companion reservations have no ledger yet.
    const orders = value.companionOrders === undefined ? [] : value.companionOrders;
    if (!Array.isArray(orders) || orders.length > 2 || !orders.every((entry, index) => entry && Object.keys(entry).length === 2 && integer(entry.floor, 1, 2) && entry.floor <= value.floor + 1 && COMPANIONS.some((recruit) => recruit.piece === entry.piece) && (!index || orders[index - 1].floor < entry.floor))) return false;
    const companionCost = orders.reduce((sum, entry) => sum + COMPANIONS.find((recruit) => recruit.piece === entry.piece).cost, 0);
    const spent = companionCost + value.purchases.reduce((sum, id) => sum + purchaseCost(id), 0);
    if (!Array.isArray(value.records) || !Array.isArray(value.enemies) || !Array.isArray(value.species)) return false;
    // Gold comes from coins and optional captures. Runs of the 2026-11-05 and 11-06 editions began
    // under the old rule that paid every capture, so they may hold up to one gold per capture.
    const paid = value.paidCaptures === undefined ? value.gold - value.treasure + spent - tacticGold(value.feats) : value.paidCaptures;
    const bonus = bonusCaptures(value);
    // Gold dropped in cave-ins (src/cave-in.js) leaves the ledger too.
    if (!integer(paid, bonus, value.date >= '2026-11-05' && value.date <= '2026-11-06' ? value.captures : bonus) || value.gold !== value.treasure + paid + tacticGold(value.feats) - spent - (value.dropped ?? 0)) return false;
    // Special moves the player made: absent in older saves.
    // Forks and combos are bounded by captures (validTactics), the rest by 30.
    if (value.feats !== undefined && !(Array.isArray(value.feats) && value.feats.filter((feat) => !TACTIC_KINDS.includes(feat?.kind)).length <= 30 && value.feats.every((feat) => feat && typeof feat === 'object'
      && equal(Object.keys(feat).sort(), ['floor', 'kind']) && integer(feat.floor, 0, value.floor) && ['en-passant', 'castle', 'bishop-pair', ...TACTIC_KINDS].includes(feat.kind)))) return false;
    const template = createGame({...daily,legacyTurnOrder:value.legacyTurnOrder}); template.floor = value.floor; template.companionOrders = orders;
    // Floors 1 and 2 recruit any piece. Runs saved while they always recruited
    // a king may hold that king, on the board or at their side.
    const kingRecruit = value.floor < 2 && ((value.companion && value.companion.basePiece === 'king')
      || (Array.isArray(value.items) && value.items.some((item) => item?.type === 'companion' && item.piece === 'king')));
    // Layout depends only on the edition and original piece, never on promotion.
    setFloor(template, kingRecruit);
    if (!validModifierState(value, template)) return false;
    if (!equal(value.map, template.map) || !equal(value.props, template.props) || value.exit?.x !== 4 || value.exit?.y !== 0 || typeof value.exit.open !== 'boolean') return false;
    if (!value.objective || value.objective.piece !== daily.targets[value.floor] || value.objective.complete !== value.exit.open) return false;
    // Paid hints and unmasked species (src/rules.js nextHint, unmask): absent in older saves and on a fresh floor.
    if (value.hints !== undefined && !validHints(value.hints)) return false;
    if (value.unmasked !== undefined) {
      const lineup = floorLineup(daily, value.floor).map((species) => species.id);
      if (!(Array.isArray(value.unmasked) && value.unmasked.length > 0 && new Set(value.unmasked).size === value.unmasked.length && value.unmasked.every((id) => lineup.includes(id)))) return false;
    }
    if (!Array.isArray(value.enemies) || value.enemies.length > population(value.floor) || !Array.isArray(value.items) || value.items.length > template.items.length || !Array.isArray(value.records) || !Array.isArray(value.events) || value.events.length > 56) return false;
    if (!value.enemies.every((foe) => {
      const original = template.enemies.find((entry) => entry.id === foe.id)
        ?? Array.from({ length: reinforced }, (_, n) => reinforcementOptions(value, n)).flat().find((entry) => entry.id === foe.id && entry.species === foe.species);
      if (!original || foe.species !== original.species || foe.palette !== original.palette || foe.name !== original.name || foe.role !== original.role) return false;
      // A reinforcement only enters while its role has room under a chess army's counts.
      if (original !== template.enemies.find((entry) => entry.id === foe.id) && value.enemies.filter((entry) => entry.role === foe.role).length > PIECE_COUNTS[foe.role]) return false;
      if (foe.piece !== original.piece && !(original.piece === 'pawn' && foe.piece === 'queen' && foe.promoted === true)) return false;
      if (!walkable(value, foe.x, foe.y) || typeof foe.moved !== 'boolean' || (same(foe, value.player) && value.player.hp !== 0)) return false;
      if (foe.pinned !== undefined && !(integer(foe.pinned, 1, PIN_MOVES) && foe.phase === 'ready')) return false;
      // Saves from before missed lunges unbalanced a monster have no flag; a missed lunge resets its wind-up.
      if (foe.offBalance !== undefined && !(foe.offBalance === true && foe.phase === 'ready')) return false;
      if (!['ready', 'aim'].includes(foe.phase) || !Array.isArray(foe.intent) || foe.intent.length > 7 || !foe.intent.every((tile) => walkable(value, tile.x, tile.y))) return false;
      return foe.phase === 'aim' ? foe.intent.length > 0 && inside(foe.target?.x, foe.target?.y) : foe.intent.length === 0 && foe.target === null;
    })) return false;
    if (new Set(value.enemies.map((foe) => foe.id)).size !== value.enemies.length || new Set(value.enemies.map((foe) => `${foe.x},${foe.y}`)).size !== value.enemies.length) return false;
    const capturedTarget = !value.enemies.some((foe) => foe.role === value.objective.piece);
    if (value.objective.complete !== capturedTarget) return false;
    // Saves from before scored moves have no count; a present one belongs to a complete challenge.
    if (value.objective.moves !== undefined && !(value.objective.complete && integer(value.objective.moves, 1, value.turns - value.floorStart.turns))) return false;
    if (!value.items.every((item) => template.items.some((original) => equal(original, item))) || new Set(value.items.map((item) => `${item.x},${item.y}`)).size !== value.items.length) return false;
    const recruit = template.items.find((item)=>item.type==='companion');
    const deliveredOrder = orders.find((entry) => entry.floor === value.floor);
    const companionPiece = deliveredOrder?.piece ?? recruit?.piece;
    if (value.companion !== null) {
      const ally=value.companion;
      if (!ally || !companionPiece || ally.basePiece !== companionPiece || (ally.piece !== ally.basePiece && !(ally.basePiece==='pawn' && ally.piece==='queen')) || !walkable(value,ally.x,ally.y) || typeof ally.moved !== 'boolean' || typeof ally.sharing !== 'boolean') return false;
      if (ally.sharing !== same(ally,value.player) || value.enemies.some((foe)=>same(foe,ally)) || value.items.some((item)=>item.type==='companion')) return false;
    // Runs saved while floors 1 and 2 held no recruit never had one to pick up.
    } else if (deliveredOrder || (recruit && value.floor === 2 && !value.items.some((item)=>item.type==='companion'))) return false;
    if (value.records.length !== (value.status === 'won' ? 3 : value.floor)) return false;
    if (!value.records.every((record, index) => record.floor === index && integer(record.turns, 1, value.turns) && (record.scored === undefined || integer(record.scored, 1, record.turns)) && (record.restartedMoves === undefined || integer(record.restartedMoves, 1, Number.MAX_SAFE_INTEGER)) && integer(record.captures, PIECE_COUNTS[daily.targets[index]], population(index)) && integer(record.treasure, 0, 3) && (record.lives === undefined || record.lives === 1) && (record.hp === undefined || (integer(record.hp, 1, value.player.maxHp) && record.hp - (record.lives ?? 0) <= (value.records[index - 1]?.hp ?? PIECE_LIVES[value.startingPiece]) && (value.status === 'won' || index < value.records.length - 1 || value.player.hp <= record.hp))) && record.grade === (record.treasure === 3 ? 'gold' : record.captures > PIECE_COUNTS[daily.targets[index]] ? 'silver' : 'bronze'))) return false;
    // Saves from before par stars were removed may still carry them on floor records.
    if (!value.records.every((record) => record.stars === undefined || integer(record.stars, 1, 3))) return false;
    if (!value.records.every((record) => record.hints === undefined || validHints(record.hints))) return false;
    if (!value.floorStart || !integer(value.floorStart.turns, 0, value.turns) || !integer(value.floorStart.captures, 0, value.captures) || !integer(value.floorStart.treasure, 0, value.treasure)) return false;
    if (!validTactics(value, [...template.enemies.map((foe) => foe.id), ...Array.from({ length: value.reinforcements ?? 0 }, (_, n) => `f${value.floor}-r${n}`)])) return false;
    const previous = value.records.slice(0, value.floor);
    for (const key of ['turns', 'captures', 'treasure']) if (previous.reduce((sum, record) => sum + record[key], 0) !== value.floorStart[key]) return false;
    const coinsLeft = value.items.filter((item) => item.type === 'coin').length;
    if (!validCaveIn(value)) return false;
    // Coins a cave-in buried were never collected.
    if (value.captures !== value.floorStart.captures + population(value.floor) - extraPopulation(value.modifier) + reinforced - value.enemies.length || value.treasure !== value.floorStart.treasure + template.items.filter((item) => item.type === 'coin').length - coinsLeft - (value.caveIn?.buried ?? 0)) return false;
    // Saves from before floor resets have no snapshot; a present one must be this floor's start.
    if (value.floorSnapshot !== undefined) {
      const start = value.floorSnapshot;
      if (!start || start.floorSnapshot !== undefined || start.replayUnlocked !== undefined || start.tries !== undefined || start.restartedMoves !== undefined || start.status !== 'playing' || start.floor !== value.floor || start.turns !== value.floorStart.turns || !equal(start.records, value.records.slice(0, value.floor)) || !validateSave(start, date, daily)) return false;
      if (start.hints !== undefined || start.unmasked !== undefined) return false;
    }
    if (value.status === 'won' && (value.restartedMoves ?? 0) !== (value.records[2]?.restartedMoves ?? 0)) return false;
    if (value.status === 'won' && !equal(value.hints, value.records[2]?.hints)) return false;
    if (value.status === 'won' && ['turns', 'captures', 'treasure'].some((key) => value.records.reduce((sum, record) => sum + record[key], 0) !== value[key])) return false;
    // Saves from before en passant have no window; a present one names a pawn that just double-stepped.
    const ep = value.enPassant;
    if (ep !== undefined && ep !== null && !(typeof ep === 'object' && equal(Object.keys(ep).sort(), ['id', 'x', 'y']) && ep.y === 2 && integer(ep.x, 0, 7)
      && value.enemies.some((foe) => foe.id === ep.id && foe.piece === 'pawn' && foe.x === ep.x && foe.y === 3))) return false;
    if (value.notes !== undefined && !(Array.isArray(value.notes) && value.notes.length > 0 && value.notes.length <= 8 && value.notes.every((note) => typeof note === 'string' && note && note.length <= 1000))) return false;
    if (typeof value.message !== 'string' || value.message.length > 1000 || !value.events.every((event) => ['move', 'capture', 'player-captured', 'damage', 'pickup', 'powerup', 'shield', 'descend', 'win', 'promotion', 'enemy-promotion', 'enemy-phase', 'enemy-move', 'companion-order', 'companion-recruit', 'companion-phase', 'companion-move', 'companion-capture', 'companion-promotion', 'miss', 'restart', 'close-capture', 'wait', 'en-passant', 'castle', 'bishop-pair', 'slide', 'reinforcement', 'pin', 'unpin', 'leap', 'takeback', 'unmask', 'hint', ...TACTIC_EVENTS, ...CAVE_IN_EVENTS].includes(event.type) && inside(event.x, event.y) && (event.type !== 'enemy-move' || ((template.enemies.some((foe) => foe.id === event.id) || Array.from({ length: reinforced }, (_, n) => `f${value.floor}-r${n}`).includes(event.id)) && inside(event.from?.x, event.from?.y))))) return false;
    return true;
  } catch { return false; }
}

