// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { PIECES, PIECE_COUNTS, PIECE_LIVES } from './pieces.js';
import { hash, random } from './random.js';
import { getRawDaily } from './edition.js';
export { PIECES, PIECE_COUNTS, PIECE_LIVES } from './pieces.js';
export const RULES_VERSION = 5;
const ORTHOGONAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
export const POWERUPS = Object.freeze([
  { id: 'shield', name: 'Bone ward', cost: 3, max: 3, description: 'Block one capture. Stacks up to three.' },
  { id: 'freeze', name: 'Frost hourglass', cost: 2, max: 6, description: 'Freeze every monster for three moves.' },
  { id: 'magnet', name: 'Coin magnet', cost: 4, max: 1, description: 'Collect coins within two tiles after every move.' },
]);
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
export function enemyAt(state, x, y) { return state.enemies.find((foe) => foe.x === x && foe.y === y); }

function rays(piece) {
  if (piece === 'rook') return ORTHOGONAL;
  if (piece === 'bishop') return DIAGONAL;
  if (piece === 'queen') return [...ORTHOGONAL, ...DIAGONAL];
  return null;
}

function movesFor(state, unit, enemy = false, attacksOnly = false) {
  const moves = [];
  const occupant = (x, y) => {
    if (enemy && state.companion && state.companion.x === x && state.companion.y === y) return 'friend';
    if (unit === state.companion && state.player.x === x && state.player.y === y) return 'friend';
    const foe = enemyAt(state, x, y);
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
    for (const [dx, dy] of unit.piece === 'knight' ? KNIGHT : [...ORTHOGONAL, ...DIAGONAL]) push(unit.x + dx, unit.y + dy);
  }
  return moves;
}

/** The player's legal chess destinations. A pawn captures only diagonally. A king may not step into close range. */
export function legalMoves(state) {
  if (!state || state.status !== 'playing') return [];
  const moves = movesFor(state, state.player);
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
  return state.enemies.find((foe) => foe.piece === 'pawn' && foe.y === 4 && Math.abs(foe.x - square.x) === 1) ?? null;
}

/**
 * The first monster that would capture the player at once on `square`: one
 * adjacent to it, or a knight. Distant sliders still give a turn of warning.
 * Evaluated on a copy with the player on `square` and any monster there taken.
 */
export function closeAttacker(state, square) {
  if (state.powers?.freeze > 0) return null;
  // A companion sharing the player's square never shields it.
  const companion = state.companion && !same(state.companion, square) ? state.companion : null;
  const board = { ...state, companion, player: { ...state.player, x: square.x, y: square.y }, enemies: state.enemies.filter((foe) => !same(foe, square)) };
  return board.enemies.find((foe) => (foe.piece === 'knight' || Math.max(Math.abs(foe.x - square.x), Math.abs(foe.y - square.y)) === 1)
    && movesFor(board, foe, true, true).some((move) => move.capture && same(move, square))) ?? null;
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
  if (!movesFor(state, foe, true, true).some((move) => move.capture && same(move, state.player))) return false;
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
    state.message = `${foe.name} reached the far rank. Its stride has changed.`;
  }
}

function moveMonster(state, foe) {
  const candidates = movesFor(state, foe, true).filter((move) => !move.capture && preservesPawnLane(state, move));
  if (!candidates.length) return;
  const tie = (move) => hash(`${state.dungeonSeed ?? state.seed}:${state.floor}:${state.turns}:${foe.id}:${move.x},${move.y}`) / 4294967296;
  candidates.sort((a, b) => {
    const score = (move) => distance(move, state.player) + distance(move, foe) * 0.35 + tie(move) * 0.7;
    return score(a) - score(b);
  });
  const from = { x: foe.x, y: foe.y };
  foe.x = candidates[0].x; foe.y = candidates[0].y; foe.moved = true;
  state.events.push({ type: 'enemy-move', id: foe.id, from, x: foe.x, y: foe.y });
  noteDoubleStep(state, foe, from);
  promoteMonster(state, foe);
  aimAtPlayer(state, foe);
}

// A pawn's double step opens an en passant window on the square it skipped.
function noteDoubleStep(state, foe, from) {
  if (foe.piece === 'pawn' && from.y === 1 && foe.y === 3) state.enPassant = { id: foe.id, x: foe.x, y: 2 };
}

// Royal guard (final floor): the king avoids lines the player or companion can
// capture along, and its guards screen it. Evaluations move a unit
// hypothetically and always restore it.
function chebyshev(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function hypothetically(unit, square, evaluate) {
  const { x, y } = unit;
  unit.x = square.x; unit.y = square.y;
  try { return evaluate(); } finally { unit.x = x; unit.y = y; }
}
function kingThreatened(state, king) {
  const hits = (unit) => movesFor(state, unit).some((move) => move.capture && same(move, king));
  return (state.player.hp > 0 && hits(state.player)) || Boolean(state.companion && hits(state.companion));
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
function monsterTie(state, foe, move) {
  return hash(`${state.dungeonSeed ?? state.seed}:${state.floor}:${state.turns}:${foe.id}:${move.x},${move.y}`) / 4294967296;
}
function safeKingMoves(state, king) {
  return monsterMoves(state, king).filter((move) => !hypothetically(king, move, () => kingThreatened(state, king)));
}
function moveKing(state, king) {
  const best = safeKingMoves(state, king).map((move) => hypothetically(king, move, () => {
    const strikes = movesFor(state, king, true, true).some((m) => m.capture && same(m, state.player));
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
    const block = candidates.filter(keepsKing)
      .sort((a, b) => distance(a, foe) + monsterTie(state, foe, a) * 0.1 - distance(b, foe) - monsterTie(state, foe, b) * 0.1)[0];
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
  const pick = pool.sort((a, b) => score(a) - score(b))[0];
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
// Returns 'shield', 'damage' or 'restart' (the last life ended the run).
// Events name the attacker (`by`, its square and name) so the board can show
// which monster struck, even after a restart clears the room.
function hitPlayer(state, foe, close = false, enPassant = false) {
  const attacker = { by: foe.id, from: { x: foe.x, y: foe.y }, name: foe.name, ...(enPassant && { enPassant: true }) };
  const how = enPassant ? 'captured you en passant as you passed it' : close ? 'was guarding that square and struck at once' : 'struck along its red path';
  if (state.powers.shield > 0) {
    state.powers.shield--; foe.phase = 'ready'; foe.intent = []; foe.target = null;
    state.events.push({ type: 'shield', x: state.player.x, y: state.player.y, ...attacker });
    state.message = `${foe.name} ${how}, but your bone ward blocked it.`;
    return 'shield';
  }
  state.player.hp--;
  const damage = { type: 'damage', x: state.player.x, y: state.player.y, amount: 1, ...attacker, close };
  if (state.player.hp === 0) {
    restartRun(state, [damage], `${foe.name} ${enPassant ? 'captured you en passant' : how}. Out of lives. Back to the start of today’s dungeon.`);
    return 'restart';
  }
  // Clear the committed attack so
  // the monster must give another full turn of warning before a hit.
  foe.phase = 'ready'; foe.intent = []; foe.target = null;
  const demoted = state.startingPiece === 'pawn' && state.player.piece === 'queen';
  if (demoted) returnToPawn(state);
  state.events.push(damage);
  state.message = `${foe.name} ${how}. ${demoted ? 'Back to a pawn. ' : ''}${state.player.hp} ${state.player.hp === 1 ? 'life' : 'lives'} left.`;
  return 'damage';
}

// A distant rook, bishop or queen with the player in its line steps one square
// closer along it before aiming, so a line it can already strike is pressed.
function closeIn(state, foe) {
  if (!['rook', 'bishop', 'queen'].includes(foe.piece) || chebyshev(foe, state.player) <= 1) return;
  if (!movesFor(state, foe, true, true).some((move) => move.capture && same(move, state.player))) return;
  const step = attackPath(state, foe, state.player)[0];
  if (step && preservesPawnLane(state, step) && monsterMoves(state, foe).some((move) => same(move, step))) relocate(state, foe, step);
}

function enemyTurn(state) {
  state.events.push({ type: 'enemy-phase', x: state.player.x, y: state.player.y });
  if (state.powers.freeze > 0) { state.powers.freeze--; return; }
  const royal = royalRules(state) ? state.enemies.find((foe) => foe.role === 'king') : null;
  const order = royal ? [royal, ...state.enemies.filter((foe) => foe !== royal)] : state.enemies;
  for (const foe of order) {
    if (foe.phase === 'aim') {
      const capture = foe.intent.some((tile) => same(tile, state.player))
        && movesFor(state, foe, true, true).some((move) => move.capture && same(move, state.player));
      // A shield keeps the phase going; a lost life ends it.
      if (capture && hitPlayer(state, foe) === 'shield') continue;
      if (capture) return;
      const destination = movesFor(state, foe, true).find((move) => same(move, foe.target) && !move.capture && preservesPawnLane(state, move));
      if (destination && royal && !royalStepOk(state, foe, royal, destination)) { /* stay put */ }
      else if (destination) relocate(state, foe, destination);
      foe.phase = 'ready'; foe.intent = []; foe.target = null;
      state.events.push({ type: 'miss', x: foe.x, y: foe.y });
    } else if (royal && foe === royal) {
      royalKingTurn(state, foe);
    } else if (royal && state.enemies.includes(royal)) {
      royalGuardTurn(state, foe, royal);
    } else {
      closeIn(state, foe);
      if (!aimAtPlayer(state, foe)) moveMonster(state, foe);
    }
  }
}

function connectedBoard(state) {
  const layoutPiece = state.layoutPiece ?? state.startingPiece;
  const piece = layoutPiece === 'pawn' ? 'queen' : layoutPiece;
  const visited = new Set(['4,6']);
  const queue = [{ x: 4, y: 6 }];
  const board = { ...state, enemies: [] };
  for (let i = 0; i < queue.length; i++) {
    for (const tile of movesFor(board, { ...queue[i], piece })) {
      const key = `${tile.x},${tile.y}`;
      if (!visited.has(key)) { visited.add(key); queue.push(tile); }
    }
  }
  // Bishops need every open square of their own color; other pieces need all.
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (walkable(state, x, y) && (piece !== 'bishop' || (x + y) % 2 === 0) && !visited.has(`${x},${y}`)) return false;
  }
  return true;
}

// Walls never land on a monster's opening moves, so none spawns boxed in (a
// corner knight walled off, a pawn facing a pillar). Knights and kings keep
// every destination clear; pawns their one- and two-step advance; rooks,
// bishops and queens the first square of each line.
// The 2026-11-05 launch dungeon predates this rule and keeps its published
// layout so its saved runs still validate. Keyed by seed, not date, so a
// fallback layout plays the same on any date it is certified for.
const LEGACY_LAYOUT_SEEDS = new Set([1830689584]);
// The king floor plays by royal rules: a smarter king and guards (enemyTurn)
// and a stronger recruit (setFloor) that may help certify the room (fairness.js).
export function royalRules(state) { return state.floor === 2; }
const KING_FLOOR_RECRUITS = ['rook', 'queen', 'king'];
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
  return floor === state.targets.length - 1 && !LEGACY_LAYOUT_SEEDS.has(state.dungeonSeed ?? state.seed);
}

// One draw either way, so the rest of the room's random layout is unchanged.
function powerRoll(roll, coinless) {
  return coinless ? ['shield', 'freeze'][Math.floor(roll * 2)] : ['shield', 'freeze', 'magnet'][Math.floor(roll * 3)];
}

function setFloor(state, legacyRecruit = false) {
  const layoutPiece = state.layoutPiece ?? state.startingPiece;
  const rng = random(hash(`${state.dungeonSeed ?? state.seed}:room:${state.floor}`));
  state.awaitingPlayer = false; state.companion = null; state.enPassant = null;
  state.map = Array(8).fill('........');
  // Promotion lasts only for the room it happened in; each floor starts with the original piece.
  state.player.piece = state.startingPiece;
  state.player.x = 4; state.player.y = 6; state.player.moved = false;
  state.exit = { x: 4, y: 0, open: false };
  state.objective = { piece: state.targets[state.floor], complete: false };
  state.floorStart = { turns: state.turns, captures: state.captures, treasure: state.treasure };
  const target = state.species[state.floor];
  const residents = [...Array(PIECE_COUNTS[target.piece]).fill(target), state.species[3 + state.floor * 2], state.species[4 + state.floor * 2]];
  const mirror = rng() < 0.5;
  const targetTiles = target.piece === 'pawn'
    ? [[3, 3], [5, 3], [2, 2], [6, 2], [1, 1], [7, 1], [0, 2], [6, 0]]
    : layoutPiece === 'pawn' ? [[3, 2], [5, 1]] : [[4, 2], [2, 2]];
  const coordinates = [...targetTiles.slice(0, PIECE_COUNTS[target.piece]), [0, 0], [7, 0]];
  state.enemies = coordinates.map(([initialX, y], index) => {
    const creature = residents[index];
    // Keep pawn editions' starting file free; a bishop target shares its color.
    let x = mirror && initialX ? 8 - initialX : initialX;
    return { id: `f${state.floor}-${index}`, species: creature.id, palette: creature.palette, name: creature.name,
      piece: creature.piece, role: creature.piece, x, y, moved: false, phase: 'ready', intent: [], target: null };
  });
  const powerTile = LEGACY_LAYOUT_SEEDS.has(state.dungeonSeed ?? state.seed)
    ? (layoutPiece === 'bishop' ? [3, 5] : layoutPiece === 'knight' ? [3, 4] : [4, 5])
    : distantPowerTile(state, layoutPiece, rng);
  state.items = [
    { x: 4, y: 4, type: 'coin' }, { x: 2, y: 4, type: 'coin' }, { x: 6, y: 4, type: 'coin' },
    { x: powerTile[0], y: powerTile[1], type: 'powerup', power: target.piece === 'pawn' ? 'freeze' : powerRoll(rng(), coinlessFloor(state)) },
  ];
  state.props = [];
  const reserved = [...state.enemies, ...state.items, state.player, state.exit];
  if (!LEGACY_LAYOUT_SEEDS.has(state.dungeonSeed ?? state.seed)) reserved.push(...state.enemies.flatMap(openingSquares));
  const candidates = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if ((layoutPiece === 'bishop' && target.piece === 'pawn' && (x + y) % 2 === 0) || reserved.some((entry) => entry.x === x && entry.y === y) || (layoutPiece === 'pawn' && x >= 3 && x <= 5) || (Math.abs(x - 4) <= 1 && y >= 5)) continue;
    candidates.push({ x, y, order: rng() });
  }
  candidates.sort((a, b) => a.order - b.order);
  for (const tile of candidates) {
    const previous = state.map[tile.y];
    state.map[tile.y] = previous.slice(0, tile.x) + '#' + previous.slice(tile.x + 1);
    if (!connectedBoard(state)) { state.map[tile.y] = previous; continue; }
    state.props.push({ x: tile.x, y: tile.y, type: ['pillar', 'crate', 'barrel', 'rock'][Math.floor(rng() * 4)] });
    if (state.props.length === (state.obstacleBase ?? 7) + state.floor) break;
  }
  if (!state.legacyTurnOrder) {
    // Add the recruit after the layout is fixed; older editions keep their map.
    // Its own random stream leaves walls, monsters and coins untouched.
    const recruitRng = random(hash(`${state.dungeonSeed ?? state.seed}:companion:${state.floor}`));
    // Under royal rules the recruit is a rook, queen or king: a second attacker
    // strong enough to corner a dodging king, even beside a pawn or a bishop.
    // Floors 1 and 2 always recruit a king. The piece is still drawn from the
    // old pool so the tile draw stays put; saves from before keep that piece.
    const pool = royalRules(state) ? KING_FLOOR_RECRUITS : PIECES;
    const drawn = pool[Math.floor(recruitRng() * pool.length)];
    const piece = royalRules(state) || legacyRecruit ? drawn : 'king';
    const clear = (tile) => walkable(state,tile.x,tile.y) && !enemyAt(state,tile.x,tile.y) && !same(tile,state.player) && !same(tile,state.exit) && !state.items.some((item)=>same(item,tile));
    let tiles = movesFor(state,{...state.player,piece:layoutPiece}).filter(clear);
    if (!tiles.length) {
      tiles = [];
      for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(clear({x,y}) && (layoutPiece !== 'bishop' || (x+y)%2===0) && (layoutPiece !== 'pawn' || (x===4 && y<6))) tiles.push({x,y});
    }
    const tile = tiles[Math.floor(recruitRng()*tiles.length)];
    if (tile) state.items.push({type:'companion',piece,x:tile.x,y:tile.y});
  }
  // Drop the coins only once walls and the recruit are placed, so the room keeps its layout.
  if (coinlessFloor(state)) state.items = state.items.filter((item) => item.type !== 'coin');
  const order = (state.companionOrders ?? []).find((entry) => entry.floor === state.floor);
  if (order) {
    state.items = state.items.filter((item) => item.type !== 'companion');
    state.companion = { piece: order.piece, basePiece: order.piece, x: state.player.x, y: state.player.y, moved: false, sharing: true };
    state.events.push({ type: 'companion-recruit', piece: order.piece, x: state.player.x, y: state.player.y });
  }
  if (state.playerColor === 'white') for (const foe of state.enemies) aimAtPlayer(state, foe);
}

const NO_MOVES = 'No legal moves. Back to the start of today’s dungeon.';

// Waiting answers a board where monsters block every move, so only terrain can
// truly trap the player: no move even with every monster gone.
function trapped(state) {
  return state.status === 'playing' && !state.exit.open && legalMoves(state).length === 0
    && movesFor({ ...state, enemies: [] }, state.player).length === 0;
}

// Running out of lives or out of moves ends the try: back to floor 1, with one more try on the share card.
function restartRun(state, events, message) {
  const fresh = createGame({ ...state, playerPiece: state.startingPiece, replayUnlocked: true });
  // Count today's attempts; saves from before this counter only know a restart happened.
  const tries = (state.tries ?? (state.replayUnlocked ? 2 : 1)) + 1;
  Object.assign(state, fresh);
  state.tries = tries;
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
    schema: RULES_VERSION, rulesVersion: RULES_VERSION, dungeonSeed: daily.dungeonSeed ?? daily.seed, obstacleBase: daily.obstacleBase ?? 7, difficulty: daily.difficulty ?? 'standard', playerColor: daily.playerColor, legacyTurnOrder: false, awaitingPlayer: false, enPassant: null, date: daily.date, seed: daily.seed, edition: daily.edition, theme: structuredClone(daily.theme), species: structuredClone(daily.species), targets: [...daily.targets],
    startingPiece: daily.playerPiece, floor: 0, player: { x: 4, y: 6, piece: daily.playerPiece, hp: PIECE_LIVES[daily.playerPiece], maxHp: PIECE_LIVES[daily.playerPiece], moved: false },
    turns: 0, status: 'playing', captures: 0, paidCaptures: 0, treasure: 0, gold: 0, purchases: [], companionOrders: [], feats: [], powers: { shield: 0, freeze: 0, magnet: 0 }, records: [], events: [],
    message: `Capture all enemy ${daily.targets[0]}s. The newspaper holds a clue.`,
  };
  if (daily.practice === true) { state.practice = true; state.layoutPiece = daily.layoutPiece; }
  if (daily.replayUnlocked === true) state.replayUnlocked = true;
  setFloor(state);
  markFloorStart(state);
  return state;
}

// Keep the floor exactly as it began, so the player may voluntarily start it over.
function markFloorStart(state) {
  // Attempt counters belong to the live run, so a restart never rewinds them.
  const { floorSnapshot, replayUnlocked, tries, ...start } = state;
  state.floorSnapshot = structuredClone(start);
}

/** Return to the start of the current floor: same lives, gold and powers as on arrival, no penalty. */
export function resetFloor(previous) {
  const snapshot = previous?.floorSnapshot;
  if (!snapshot || previous.status !== 'playing') return previous;
  const state = structuredClone(snapshot);
  state.floorSnapshot = structuredClone(snapshot);
  if (previous.replayUnlocked === true) state.replayUnlocked = true;
  if (previous.tries !== undefined) state.tries = previous.tries;
  state.message = `Floor ${state.floor + 1} reset. ${snapshot.message}`;
  return state;
}

function finishFloor(state) {
  const captures = state.captures - state.floorStart.captures;
  const treasure = state.treasure - state.floorStart.treasure;
  state.records.push({ floor: state.floor, turns: state.turns - state.floorStart.turns, captures, treasure, hp: state.player.hp, grade: treasure === 3 ? 'gold' : captures > PIECE_COUNTS[state.objective.piece] ? 'silver' : 'bronze' });
  if (state.floor === 2) {
    state.status = 'won'; state.message = 'Your dispatch made the morning edition.';
    state.events.push({ type: 'win', x: state.player.x, y: state.player.y });
  } else {
    // A frozen room's leftover moves stay behind; only hourglasses bought in the
    // between-floor shop (the only purchases possible since the floor began) come along.
    const bought = state.purchases.slice(state.floorSnapshot?.purchases?.length ?? 0).filter((id) => id === 'freeze').length;
    state.powers.freeze = Math.min(state.powers.freeze, bought * 3);
    state.floor++; setFloor(state);
    state.message = `Capture all enemy ${state.objective.piece}s. New faces, new clues.`;
    state.events.push({ type: 'descend', x: state.player.x, y: state.player.y });
    markFloorStart(state);
  }
}

// Each floor's challenge pieces are mandatory, so only the optional residents pay out.
function bonusResidents(state, floor) {
  return [state.species[3 + floor * 2], state.species[4 + floor * 2]].filter((species) => species?.piece !== state.targets[floor]).length;
}
function bonusCaptures(state) {
  const earlier = state.records.slice(0, state.floor).reduce((sum, record) => sum + record.captures - (PIECE_COUNTS[state.targets[record.floor]] + 2 - bonusResidents(state, record.floor)), 0);
  const remaining = state.enemies.filter((foe) => (foe.role ?? foe.piece) !== state.targets[state.floor]).length;
  return earlier + bonusResidents(state, state.floor) - remaining;
}

function spentGold(state) {
  const orders = state.companionOrders ?? [];
  return orders.reduce((sum, entry) => sum + COMPANIONS.find((recruit) => recruit.piece === entry.piece).cost, 0)
    + state.purchases.reduce((sum, id) => sum + POWERUPS.find((power) => power.id === id).cost, 0);
}

function captureEnemy(state, captured, companion = false) {
  state.enemies = state.enemies.filter((foe) => foe.id !== captured.id);
  state.captures++;
  if ((captured.role ?? captured.piece) !== state.objective.piece) { state.gold++; state.paidCaptures++; }
  state.events.push({ type: companion ? 'companion-capture' : 'capture', id: captured.id, x: captured.x, y: captured.y });
  if ((captured.role ?? captured.piece) === state.objective.piece) {
    state.objective.complete = !state.enemies.some((foe) => (foe.role ?? foe.piece) === state.objective.piece);
    state.exit.open = state.objective.complete;
    state.message = state.exit.open ? 'Challenge complete. Tap the stairs to leave.' : `${captured.name} captured. Keep hunting.`;
  } else state.message = `${captured.name} captured. +1 gold.`;
}

function companionTurn(state) {
  const unit = state.companion;
  if (!unit) return;
  unit.sharing = same(unit,state.player);
  state.events.push({type:'companion-phase',x:unit.x,y:unit.y});
  // A pawn recruited on the far rank promotes before choosing its first move.
  if (unit.piece==='pawn' && unit.y===0) {
    unit.piece='queen';
    state.events.push({type:'companion-promotion',x:unit.x,y:unit.y});
  }
  if (!state.enemies.length) return;
  const candidates = movesFor(state,unit);
  const nearest = (move) => Math.min(...state.enemies.map((foe)=>distance(move,foe)));
  const tie = (move) => hash(`${state.dungeonSeed ?? state.seed}:companion:${state.floor}:${state.turns}:${move.x},${move.y}`);
  candidates.sort((a,b) => Number(b.capture)-Number(a.capture) || nearest(a)-nearest(b) || distance(b,unit)-distance(a,unit) || tie(a)-tie(b));
  const destination = candidates[0];
  if (!destination) return;
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
  state.powers[id] = Math.min(power.max, state.powers[id] + (id === 'freeze' ? 3 : 1));
  state.events.push({ type: 'powerup', power: id, x: state.player.x, y: state.player.y });
  state.message = `${power.name} acquired.`;
}

function nextState(previous) {
  const state = structuredClone(previous);
  state.companionOrders ??= [];
  // Saves from before special moves were tracked start an empty list.
  state.feats ??= [];
  // Saves from before optional-only capture gold were paid for every capture; keep what they banked.
  state.paidCaptures ??= state.gold - state.treasure + spentGold(state);
  // Older saves only recorded exhaustion in the last action's events.
  if (state.events.some((event) => event.type === 'restart')) state.replayUnlocked = true;
  return state;
}

export function act(previous, action) {
  if (!previous || previous.status !== 'playing' || !action) return previous;
  if (action.type === 'descend') {
    if (!previous.exit.open || !previous.objective.complete) return previous;
    const state = nextState(previous); state.events = []; state.awaitingPlayer = false; finishFloor(state); return state;
  }
  if (action.type === 'buy') {
    // The shop opens only between floors: after a room is cleared, before its stairs.
    if (previous.floor >= 2 || !previous.exit.open || !previous.objective.complete) return previous;
    // Companions are no longer sold; older saves keep the orders they already placed.
    if (COMPANIONS.some((entry) => entry.id === action.id)) return previous;
    const power = POWERUPS.find((entry) => entry.id === action.id);
    if (!power || previous.gold < power.cost || previous.powers[power.id] >= power.max || (power.id === 'magnet' && coinlessFloor(previous, previous.floor + 1))) return previous;
    const state = nextState(previous); state.events = []; state.gold -= power.cost; state.purchases.push(power.id); grantPower(state, power.id); return state;
  }
  if (action.type === 'wait') {
    // Waiting spends a move without moving: monsters act, the companion acts,
    // and nothing is resolved on the player's square (no close-range capture).
    const state = nextState(previous);
    state.events = [{ type: 'wait', x: state.player.x, y: state.player.y }]; state.message = '';
    if (state.playerColor === 'black' && !state.awaitingPlayer) {
      enemyTurn(state);
      if (state.events.some((event) => event.type === 'restart')) return state;
    }
    // Waiting is the player's move, so it spends any en passant window.
    state.awaitingPlayer = false; state.turns++; state.enPassant = null;
    companionTurn(state);
    if (state.playerColor === 'white') enemyTurn(state);
    if (trapped(state)) restartRun(state, [], NO_MOVES);
    return state;
  }
  if (action.type !== 'move' || !legalMoves(previous).some((move) => move.x === action.x && move.y === action.y)) return previous;
  const state = nextState(previous);
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
    const closeBefore = threat(castleBefore ? castleBefore.player.to : action);
    enemyTurn(state);
    // Losing the last life starts a fresh run; the old click has no meaning there.
    if (state.events.some((event) => event.type === 'restart')) return state;
    state.awaitingPlayer = true;
    const relocated = !same(origin, state.player) || origin.piece !== state.player.piece;
    // A destination the enemy phase newly put in close range also earns a fresh choice.
    const castleAfter = castleFor(state);
    const ambushed = !closeBefore && threat(castleAfter ? castleAfter.player.to : action);
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
  }
  // Castling is decided on the board the move is played on (after black's prelude).
  const castle = castleFor(state);
  state.awaitingPlayer = false; state.turns++;
  // The en passant window lasts exactly this move: take it now or lose it.
  const passed = action.y === 2 && state.enPassant?.x === action.x ? enPassantVictim(state, state.enPassant) : null;
  state.enPassant = null;
  // White resolves this move before monsters; black has already resolved them.
  const captured = castle ? null : passed ?? enemyAt(state, action.x, action.y);
  if (captured) captureEnemy(state,captured);
  if (passed) {
    state.events.push({ type: 'en-passant', id: passed.id, x: passed.x, y: passed.y, to: { x: action.x, y: action.y } });
    state.feats.push({ floor: state.floor, kind: 'en-passant' });
    if (!state.exit.open) state.message = `En passant! You captured ${passed.name} as it passed.`;
  }
  const to = castle ? castle.player.to : action;
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
  if (state.player.piece === 'pawn' && state.player.y === 0) {
    state.player.piece = 'queen';
    state.events.push({ type: 'promotion', x: to.x, y: to.y });
    if (!state.exit.open) state.message = 'Promoted to queen for the rest of this room.';
  }
  const recruit = state.items.find((item) => item.type === 'companion' && same(item,state.player));
  if (recruit && !state.companion) {
    state.items = state.items.filter((item)=>item!==recruit);
    state.companion = {piece:recruit.piece,basePiece:recruit.piece,x:recruit.x,y:recruit.y,moved:false,sharing:true};
    state.events.push({type:'companion-recruit',piece:recruit.piece,x:recruit.x,y:recruit.y});
    state.message = `A ${recruit.piece} joins you for this floor.`;
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
  // turn. At most one hit per move, so white's enemy phase is then skipped.
  // A double step can instead be taken en passant by a pawn beside it.
  const guard = closeAttacker(state, state.player);
  const close = guard ?? (doubleStep ? enPassantStriker(state, state.player) : null);
  if (close) {
    const passing = !guard;
    const event = { type: 'close-capture', id: close.id, x: close.x, y: close.y, ...(passing && { enPassant: true }) };
    state.events.push(event);
    if (hitPlayer(state, close, true, passing) === 'restart') { state.events.unshift(event); return state; }
  }
  if (!castle) companionTurn(state);
  if (state.playerColor === 'white' && !close) enemyTurn(state);
  if (trapped(state)) restartRun(state, [], NO_MOVES);
  return state;
}

// A spoiler-free result on one line: a 💀 for each earlier try that ran out of
// lives, then each floor reached as ❤️ (no lives lost) or a 💔 per life lost,
// each followed by 🇫🇷 for every en passant and 🏰 for every castle the player
// made on that floor, in order, then 🏆 for escaping, 🔒 for older saves that ended trapped without moves, or ⏳ while still playing,
// and last the day's starting piece.
const FEAT_EMOJI = { 'en-passant': '\u{1F1EB}\u{1F1F7}', castle: '🏰' };
export function getShareText(state, url = 'https://ryanlmelvin.github.io/dungeon-chess-daily/') {
  // Saves from before the tries counter only know that a restart happened.
  const earlier = (state.tries ?? (state.replayUnlocked && !state.practice ? 2 : 1)) - 1;
  // The day's starting piece in its color. The text-presentation selector keeps
  // the black pawn from switching to its gray emoji form beside the others.
  const glyphs = { white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' }, black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' } };
  let line = '💀'.repeat(earlier);
  for (let floor = 0; floor <= Math.min(state.floor, 2); floor++) {
    const record = state.records.find((entry) => entry.floor === floor);
    const before = floor === 0 ? state.player.maxHp : state.records[floor - 1]?.hp;
    const after = record ? record.hp : state.player.hp;
    const lost = Number.isInteger(before) && Number.isInteger(after) ? Math.max(0, before - after) : 0;
    line += lost ? '💔'.repeat(lost) : '❤️';
    for (const feat of state.feats ?? []) if (feat.floor === floor) line += FEAT_EMOJI[feat.kind] ?? '';
  }
  line += state.status === 'won' ? '🏆' : state.status === 'lost' ? '🔒' : '⏳';
  line += `${glyphs[state.playerColor]?.[state.startingPiece] ?? ''}\uFE0E`;
  return `Dungeon Chess Daily #${state.edition}\n${line}\n${url}`;
}

export function validateSave(value, date, daily = getRawDaily(date)) {
  try {
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!value || value.schema !== RULES_VERSION || value.rulesVersion !== RULES_VERSION || value.date !== date || !['playing', 'won', 'lost'].includes(value.status)) return false;
    if (value.replayUnlocked !== undefined && typeof value.replayUnlocked !== 'boolean') return false;
    if (value.tries !== undefined && !integer(value.tries, 2, Number.MAX_SAFE_INTEGER)) return false;
    if (daily.practice === true) {
      if (value.practice !== true || value.layoutPiece !== daily.layoutPiece || !PIECES.includes(value.layoutPiece)) return false;
    } else if (value.practice !== undefined || value.layoutPiece !== undefined) return false;
    if (value.legacyTurnOrder !== false || value.playerColor !== daily.playerColor || typeof value.awaitingPlayer !== 'boolean') return false;
    if (value.awaitingPlayer && (value.playerColor !== 'black' || value.status !== 'playing')) return false;
    if (value.dungeonSeed !== (daily.dungeonSeed ?? daily.seed) || value.obstacleBase !== (daily.obstacleBase ?? 7) || value.difficulty !== (daily.difficulty ?? 'standard')) return false;
    if (value.seed !== daily.seed || value.edition !== daily.edition || value.startingPiece !== daily.playerPiece || !equal(value.species, daily.species) || !equal(value.targets, daily.targets) || !equal(value.theme, daily.theme)) return false;
    const population = (floor) => PIECE_COUNTS[daily.targets[floor]] + 2;
    const totalPopulation = [0, 1, 2].reduce((sum, floor) => sum + population(floor), 0);
    if (!integer(value.floor, 0, 2) || !integer(value.turns, 0, Number.MAX_SAFE_INTEGER) || !integer(value.captures, 0, totalPopulation) || !integer(value.treasure, 0, 9) || !integer(value.gold, 0, totalPopulation + 9)) return false;
    if (!value.player || !walkable(value, value.player.x, value.player.y) || value.player.maxHp !== PIECE_LIVES[value.startingPiece] || !integer(value.player.hp, 1, value.player.maxHp) || typeof value.player.moved !== 'boolean') return false;
    if (value.player.piece !== value.startingPiece && !(value.startingPiece === 'pawn' && value.player.piece === 'queen')) return false;
    if (value.status === 'playing' && value.player.hp < 1) return false;
    if (value.status === 'won' && (value.player.hp < 1 || value.floor !== 2 || !value.objective.complete)) return false;
    if (!value.powers || !POWERUPS.every((power) => integer(value.powers[power.id], 0, power.max))) return false;
    if (!Array.isArray(value.purchases) || value.purchases.length > Math.floor((totalPopulation + 9) / 2) || !value.purchases.every((id) => POWERUPS.some((power) => power.id === id))) return false;
    // Schema-5 saves made before companion reservations have no ledger yet.
    const orders = value.companionOrders === undefined ? [] : value.companionOrders;
    if (!Array.isArray(orders) || orders.length > 2 || !orders.every((entry, index) => entry && Object.keys(entry).length === 2 && integer(entry.floor, 1, 2) && entry.floor <= value.floor + 1 && COMPANIONS.some((recruit) => recruit.piece === entry.piece) && (!index || orders[index - 1].floor < entry.floor))) return false;
    const companionCost = orders.reduce((sum, entry) => sum + COMPANIONS.find((recruit) => recruit.piece === entry.piece).cost, 0);
    const spent = companionCost + value.purchases.reduce((sum, id) => sum + POWERUPS.find((power) => power.id === id).cost, 0);
    if (!Array.isArray(value.records) || !Array.isArray(value.enemies) || !Array.isArray(value.species)) return false;
    // Gold comes from coins and optional captures. Runs through the 2026-11-06 edition began
    // under the old rule that paid every capture, so they may hold up to one gold per capture.
    const paid = value.paidCaptures === undefined ? value.gold - value.treasure + spent : value.paidCaptures;
    const bonus = bonusCaptures(value);
    if (!integer(paid, bonus, value.date <= '2026-11-06' ? value.captures : bonus) || value.gold !== value.treasure + paid - spent) return false;
    // Special moves the player made: absent in older saves.
    if (value.feats !== undefined && !(Array.isArray(value.feats) && value.feats.length <= 30 && value.feats.every((feat) => feat && typeof feat === 'object'
      && equal(Object.keys(feat).sort(), ['floor', 'kind']) && integer(feat.floor, 0, value.floor) && ['en-passant', 'castle'].includes(feat.kind)))) return false;
    const template = createGame({...daily,legacyTurnOrder:value.legacyTurnOrder}); template.floor = value.floor; template.companionOrders = orders;
    // Floors 1 and 2 recruit a king. Runs saved before that may hold the old
    // recruit, drawn from every piece, on the board or at their side.
    const legacyRecruit = value.floor < 2 && ((value.companion && value.companion.basePiece !== 'king')
      || (Array.isArray(value.items) && value.items.some((item) => item?.type === 'companion' && item.piece !== 'king')));
    // Layout depends only on the edition and original piece, never on promotion.
    setFloor(template, legacyRecruit);
    if (!equal(value.map, template.map) || !equal(value.props, template.props) || value.exit?.x !== 4 || value.exit?.y !== 0 || typeof value.exit.open !== 'boolean') return false;
    if (!value.objective || value.objective.piece !== daily.targets[value.floor] || value.objective.complete !== value.exit.open) return false;
    if (!Array.isArray(value.enemies) || value.enemies.length > population(value.floor) || !Array.isArray(value.items) || value.items.length > template.items.length || !Array.isArray(value.records) || !Array.isArray(value.events) || value.events.length > 56) return false;
    if (!value.enemies.every((foe) => {
      const original = template.enemies.find((entry) => entry.id === foe.id);
      if (!original || foe.species !== original.species || foe.palette !== original.palette || foe.name !== original.name || foe.role !== original.role) return false;
      if (foe.piece !== original.piece && !(original.piece === 'pawn' && foe.piece === 'queen' && foe.promoted === true)) return false;
      if (!walkable(value, foe.x, foe.y) || typeof foe.moved !== 'boolean' || (same(foe, value.player) && value.player.hp !== 0)) return false;
      if (!['ready', 'aim'].includes(foe.phase) || !Array.isArray(foe.intent) || foe.intent.length > 7 || !foe.intent.every((tile) => walkable(value, tile.x, tile.y))) return false;
      return foe.phase === 'aim' ? foe.intent.length > 0 && inside(foe.target?.x, foe.target?.y) : foe.intent.length === 0 && foe.target === null;
    })) return false;
    if (new Set(value.enemies.map((foe) => foe.id)).size !== value.enemies.length || new Set(value.enemies.map((foe) => `${foe.x},${foe.y}`)).size !== value.enemies.length) return false;
    const capturedTarget = !value.enemies.some((foe) => foe.role === value.objective.piece);
    if (value.objective.complete !== capturedTarget) return false;
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
    if (!value.records.every((record, index) => record.floor === index && integer(record.turns, 1, value.turns) && integer(record.captures, PIECE_COUNTS[daily.targets[index]], population(index)) && integer(record.treasure, 0, 3) && (record.hp === undefined || (integer(record.hp, 1, value.player.maxHp) && record.hp <= (value.records[index - 1]?.hp ?? value.player.maxHp) && (value.status === 'won' || index < value.records.length - 1 || value.player.hp <= record.hp))) && record.grade === (record.treasure === 3 ? 'gold' : record.captures > PIECE_COUNTS[daily.targets[index]] ? 'silver' : 'bronze'))) return false;
    if (!value.floorStart || !integer(value.floorStart.turns, 0, value.turns) || !integer(value.floorStart.captures, 0, value.captures) || !integer(value.floorStart.treasure, 0, value.treasure)) return false;
    const previous = value.records.slice(0, value.floor);
    for (const key of ['turns', 'captures', 'treasure']) if (previous.reduce((sum, record) => sum + record[key], 0) !== value.floorStart[key]) return false;
    if (value.captures !== value.floorStart.captures + population(value.floor) - value.enemies.length || value.treasure !== value.floorStart.treasure + template.items.filter((item) => item.type === 'coin').length - value.items.filter((item) => item.type === 'coin').length) return false;
    // Saves from before floor resets have no snapshot; a present one must be this floor's start.
    if (value.floorSnapshot !== undefined) {
      const start = value.floorSnapshot;
      if (!start || start.floorSnapshot !== undefined || start.replayUnlocked !== undefined || start.tries !== undefined || start.status !== 'playing' || start.floor !== value.floor || start.turns !== value.floorStart.turns || !equal(start.records, value.records.slice(0, value.floor)) || !validateSave(start, date, daily)) return false;
    }
    if (value.status === 'won' && ['turns', 'captures', 'treasure'].some((key) => value.records.reduce((sum, record) => sum + record[key], 0) !== value[key])) return false;
    // Saves from before en passant have no window; a present one names a pawn that just double-stepped.
    const ep = value.enPassant;
    if (ep !== undefined && ep !== null && !(typeof ep === 'object' && equal(Object.keys(ep).sort(), ['id', 'x', 'y']) && ep.y === 2 && integer(ep.x, 0, 7)
      && value.enemies.some((foe) => foe.id === ep.id && foe.piece === 'pawn' && foe.x === ep.x && foe.y === 3))) return false;
    if (typeof value.message !== 'string' || value.message.length > 1000 || !value.events.every((event) => ['move', 'capture', 'damage', 'pickup', 'powerup', 'shield', 'descend', 'win', 'promotion', 'enemy-promotion', 'enemy-phase', 'enemy-move', 'companion-order', 'companion-recruit', 'companion-phase', 'companion-move', 'companion-capture', 'companion-promotion', 'miss', 'restart', 'close-capture', 'wait', 'en-passant', 'castle'].includes(event.type) && inside(event.x, event.y) && (event.type !== 'enemy-move' || (template.enemies.some((foe) => foe.id === event.id) && inside(event.from?.x, event.from?.y))))) return false;
    return true;
  } catch { return false; }
}

