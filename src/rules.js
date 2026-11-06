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

/** The player's legal chess destinations. A pawn captures only diagonally. */
export function legalMoves(state) {
  if (!state || state.status !== 'playing' || state.turns >= state.maxTurns) return [];
  return movesFor(state, state.player);
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
  promoteMonster(state, foe);
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

function enemyTurn(state) {
  state.events.push({ type: 'enemy-phase', x: state.player.x, y: state.player.y });
  if (state.powers.freeze > 0) { state.powers.freeze--; return; }
  for (const foe of state.enemies) {
    if (foe.phase === 'aim') {
      const capture = foe.intent.some((tile) => same(tile, state.player))
        && movesFor(state, foe, true, true).some((move) => move.capture && same(move, state.player));
      if (capture && state.powers.shield > 0) {
        state.powers.shield--; foe.phase = 'ready'; foe.intent = []; foe.target = null;
        state.events.push({ type: 'shield', x: state.player.x, y: state.player.y });
        state.message = 'Your bone ward shattered and blocked the capture.';
        continue;
      }
      if (capture) {
        state.player.hp--;
        const damage = { type: 'damage', x: state.player.x, y: state.player.y, amount: 1 };
        if (state.player.hp === 0) {
          const fresh = createGame({ ...state, playerPiece: state.startingPiece });
          Object.assign(state, fresh);
          state.events = [damage, { type: 'restart', x: state.player.x, y: state.player.y }];
          state.message = 'Out of lives. Back to the start of today’s dungeon.';
        } else {
          // Clear the committed attack so
          // the monster must give another full turn of warning before a hit.
          foe.phase = 'ready'; foe.intent = []; foe.target = null;
          const demoted = state.startingPiece === 'pawn' && state.player.piece === 'queen';
          if (demoted) returnToPawn(state);
          state.events.push(damage);
          state.message = `${foe.name} took a life. ${demoted ? 'Back to a pawn. ' : ''}${state.player.hp} ${state.player.hp === 1 ? 'life' : 'lives'} left.`;
        }
        return;
      }
      const destination = movesFor(state, foe, true).find((move) => same(move, foe.target) && !move.capture && preservesPawnLane(state, move));
      if (destination) {
        const from = { x: foe.x, y: foe.y };
        foe.x = destination.x; foe.y = destination.y; foe.moved = true;
        state.events.push({ type: 'enemy-move', id: foe.id, from, x: foe.x, y: foe.y });
        promoteMonster(state, foe);
      }
      foe.phase = 'ready'; foe.intent = []; foe.target = null;
      state.events.push({ type: 'miss', x: foe.x, y: foe.y });
    } else if (!aimAtPlayer(state, foe)) {
      moveMonster(state, foe);
    }
  }
}

function connectedBoard(state) {
  const piece = state.startingPiece === 'pawn' ? 'queen' : state.startingPiece;
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

function setFloor(state) {
  const rng = random(hash(`${state.dungeonSeed ?? state.seed}:room:${state.floor}`));
  state.awaitingPlayer = false; state.companion = null;
  state.map = Array(8).fill('........');
  state.player.x = 4; state.player.y = 6; state.player.moved = false;
  state.exit = { x: 4, y: 0, open: false };
  state.objective = { piece: state.targets[state.floor], complete: false };
  state.floorStart = { turns: state.turns, captures: state.captures, treasure: state.treasure };
  const target = state.species[state.floor];
  const residents = [...Array(PIECE_COUNTS[target.piece]).fill(target), state.species[3 + state.floor * 2], state.species[4 + state.floor * 2]];
  const mirror = rng() < 0.5;
  const targetTiles = target.piece === 'pawn'
    ? [[3, 3], [5, 3], [2, 2], [6, 2], [1, 1], [7, 1], [0, 2], [6, 0]]
    : state.startingPiece === 'pawn' ? [[3, 2], [5, 1]] : [[4, 2], [2, 2]];
  const coordinates = [...targetTiles.slice(0, PIECE_COUNTS[target.piece]), [0, 0], [7, 0]];
  state.enemies = coordinates.map(([initialX, y], index) => {
    const creature = residents[index];
    // Keep pawn editions' starting file free; a bishop target shares its color.
    let x = mirror && initialX ? 8 - initialX : initialX;
    return { id: `f${state.floor}-${index}`, species: creature.id, palette: creature.palette, name: creature.name,
      piece: creature.piece, role: creature.piece, x, y, moved: false, phase: 'ready', intent: [], target: null };
  });
  const powerTile = state.startingPiece === 'bishop' ? [3, 5] : state.startingPiece === 'knight' ? [3, 4] : [4, 5];
  state.items = [
    { x: 4, y: 4, type: 'coin' }, { x: 2, y: 4, type: 'coin' }, { x: 6, y: 4, type: 'coin' },
    { x: powerTile[0], y: powerTile[1], type: 'powerup', power: target.piece === 'pawn' ? 'freeze' : ['shield', 'freeze', 'magnet'][Math.floor(rng() * 3)] },
  ];
  state.props = [];
  const reserved = [...state.enemies, ...state.items, state.player, state.exit];
  const candidates = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if ((state.startingPiece === 'bishop' && target.piece === 'pawn' && (x + y) % 2 === 0) || reserved.some((entry) => entry.x === x && entry.y === y) || (state.startingPiece === 'pawn' && x >= 3 && x <= 5) || (Math.abs(x - 4) <= 1 && y >= 5)) continue;
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
    const recruitRng = random(hash(`${state.dungeonSeed ?? state.seed}:companion:${state.floor}`));
    const piece = PIECES[Math.floor(recruitRng() * PIECES.length)];
    const clear = (tile) => walkable(state,tile.x,tile.y) && !enemyAt(state,tile.x,tile.y) && !same(tile,state.player) && !same(tile,state.exit) && !state.items.some((item)=>same(item,tile));
    let tiles = movesFor(state,{...state.player,piece:state.startingPiece}).filter(clear);
    if (!tiles.length) {
      tiles = [];
      for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(clear({x,y}) && (state.startingPiece !== 'bishop' || (x+y)%2===0) && (state.startingPiece !== 'pawn' || (x===4 && y<6))) tiles.push({x,y});
    }
    const tile = tiles[Math.floor(recruitRng()*tiles.length)];
    if (tile) state.items.push({type:'companion',piece,x:tile.x,y:tile.y});
  }
  const order = (state.companionOrders ?? []).find((entry) => entry.floor === state.floor);
  if (order) {
    state.items = state.items.filter((item) => item.type !== 'companion');
    state.companion = { piece: order.piece, basePiece: order.piece, x: state.player.x, y: state.player.y, moved: false, sharing: true };
    state.events.push({ type: 'companion-recruit', piece: order.piece, x: state.player.x, y: state.player.y });
  }
  if (state.playerColor === 'white') for (const foe of state.enemies) aimAtPlayer(state, foe);
}

export function createGame(daily = getRawDaily()) {
  const state = {
    schema: RULES_VERSION, rulesVersion: RULES_VERSION, dungeonSeed: daily.dungeonSeed ?? daily.seed, obstacleBase: daily.obstacleBase ?? 7, difficulty: daily.difficulty ?? 'standard', playerColor: daily.playerColor, legacyTurnOrder: false, awaitingPlayer: false, date: daily.date, seed: daily.seed, edition: daily.edition, theme: structuredClone(daily.theme), species: structuredClone(daily.species), targets: [...daily.targets],
    startingPiece: daily.playerPiece, floor: 0, player: { x: 4, y: 6, piece: daily.playerPiece, hp: PIECE_LIVES[daily.playerPiece], maxHp: PIECE_LIVES[daily.playerPiece], moved: false },
    turns: 0, maxTurns: 60, status: 'playing', captures: 0, treasure: 0, gold: 0, purchases: [], companionOrders: [], powers: { shield: 0, freeze: 0, magnet: 0 }, records: [], events: [],
    message: `Capture all enemy ${daily.targets[0]}s. The newspaper holds a clue.`,
  };
  setFloor(state);
  return state;
}

function finishFloor(state) {
  const captures = state.captures - state.floorStart.captures;
  const treasure = state.treasure - state.floorStart.treasure;
  state.records.push({ floor: state.floor, turns: state.turns - state.floorStart.turns, captures, treasure, grade: treasure === 3 ? 'gold' : captures > PIECE_COUNTS[state.objective.piece] ? 'silver' : 'bronze' });
  if (state.floor === 2) {
    state.status = 'won'; state.message = 'Your dispatch made the morning edition.';
    state.events.push({ type: 'win', x: state.player.x, y: state.player.y });
  } else {
    state.floor++; setFloor(state);
    state.message = `Capture all enemy ${state.objective.piece}s. New faces, new clues.`;
    state.events.push({ type: 'descend', x: state.player.x, y: state.player.y });
    if (state.turns >= state.maxTurns) { state.status = 'lost'; state.message = 'The presses have rolled. You missed the deadline.'; }
  }
}

function captureEnemy(state, captured, companion = false) {
  state.enemies = state.enemies.filter((foe) => foe.id !== captured.id);
  state.captures++; state.gold++;
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

export function act(previous, action) {
  if (!previous || previous.status !== 'playing' || !action) return previous;
  if (action.type === 'descend') {
    if (!previous.exit.open || !previous.objective.complete) return previous;
    const state = structuredClone(previous); state.companionOrders ??= []; state.events = []; state.awaitingPlayer = false; finishFloor(state); return state;
  }
  if (action.type === 'buy') {
    const recruit = COMPANIONS.find((entry) => entry.id === action.id);
    if (recruit) {
      const orders = previous.companionOrders ?? [];
      if (!Array.isArray(orders) || previous.floor >= 2 || previous.turns >= previous.maxTurns || previous.gold < recruit.cost || orders.some((entry) => entry.floor === previous.floor + 1)) return previous;
      const state = structuredClone(previous); state.companionOrders ??= [];
      state.gold -= recruit.cost; state.companionOrders.push({ floor: state.floor + 1, piece: recruit.piece });
      state.events = [{ type: 'companion-order', piece: recruit.piece, x: state.player.x, y: state.player.y }];
      state.message = `${recruit.name} reserved for floor ${state.floor + 2}.`;
      return state;
    }
    const power = POWERUPS.find((entry) => entry.id === action.id);
    if (!power || previous.gold < power.cost || previous.powers[power.id] >= power.max || previous.turns >= previous.maxTurns) return previous;
    const state = structuredClone(previous); state.companionOrders ??= []; state.events = []; state.gold -= power.cost; state.purchases.push(power.id); grantPower(state, power.id); return state;
  }
  if (action.type !== 'move' || !legalMoves(previous).some((move) => move.x === action.x && move.y === action.y)) return previous;
  const state = structuredClone(previous); state.companionOrders ??= [];
  state.events = []; state.message = '';
  if (state.playerColor === 'black' && !state.awaitingPlayer) {
    const origin = { x: state.player.x, y: state.player.y, piece: state.player.piece };
    enemyTurn(state);
    // Losing the last life starts a fresh run; the old click has no meaning there.
    if (state.events.some((event) => event.type === 'restart')) return state;
    state.awaitingPlayer = true;
    const relocated = !same(origin, state.player) || origin.piece !== state.player.piece;
    if (relocated || !legalMoves(state).some((move) => move.x === action.x && move.y === action.y)) {
      if (!state.exit.open && legalMoves(state).length === 0) {
        state.awaitingPlayer = false; state.status = 'lost'; state.message = 'No legal moves. The dungeon has the last word.';
      } else state.message = `${state.message ? `${state.message} ` : ''}${relocated ? 'Choose a move for your replacement pawn.' : 'The board changed. Choose another move.'}`;
      return state;
    }
  }
  state.awaitingPlayer = false; state.turns++;
  // White resolves this move before monsters; black has already resolved them.
  const captured = enemyAt(state, action.x, action.y);
  if (captured) captureEnemy(state,captured);
  state.player.x = action.x; state.player.y = action.y; state.player.moved = true;
  state.events.push({ type: 'move', x: action.x, y: action.y });
  if (state.player.piece === 'pawn' && state.player.y === 0) {
    state.player.piece = 'queen';
    state.events.push({ type: 'promotion', x: action.x, y: action.y });
    if (!state.exit.open) state.message = 'Promoted to queen. Your new moves carry into the next room.';
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
  companionTurn(state);
  if (state.playerColor === 'white') enemyTurn(state);
  // The last move may solve the final floor; extraction does not spend a turn.
  if (state.status === 'playing' && state.turns >= state.maxTurns && !(state.floor === 2 && state.exit.open)) {
    state.status = 'lost'; state.message = 'The presses have rolled. You missed the deadline.';
  } else if (state.status === 'playing' && !state.exit.open && legalMoves(state).length === 0) {
    state.status = 'lost'; state.message = 'No legal moves. The dungeon has the last word.';
  }
  return state;
}

export function getShareText(state, url = 'https://ryanlmelvin.github.io/dungeon-chess-daily/') {
  const stamps = Array.from({ length: 3 }, (_, floor) => {
    const record = state.records.find((entry) => entry.floor === floor);
    return record ? ({ gold: '🟨', silver: '⬜', bronze: '🟫' })[record.grade] : state.status === 'lost' && state.floor === floor ? '💀' : '⬛';
  }).join('');
  return `Dungeon Chess Daily\n${state.date} · ${state.status === 'won' ? 'Filed' : state.status === 'lost' ? (state.player.hp ? 'Deadline missed' : 'Captured') : 'On assignment'}\n${stamps}\n${state.turns}/${state.maxTurns} moves · ${state.captures} ⚔️ · ${state.treasure} 🪙\n${url}`;
}

export function validateSave(value, date, daily = getRawDaily(date)) {
  try {
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!value || value.schema !== RULES_VERSION || value.rulesVersion !== RULES_VERSION || value.date !== date || !['playing', 'won', 'lost'].includes(value.status)) return false;
    if (value.legacyTurnOrder !== false || value.playerColor !== daily.playerColor || typeof value.awaitingPlayer !== 'boolean') return false;
    if (value.awaitingPlayer && (value.playerColor !== 'black' || value.status !== 'playing' || value.turns >= value.maxTurns)) return false;
    if (value.dungeonSeed !== (daily.dungeonSeed ?? daily.seed) || value.obstacleBase !== (daily.obstacleBase ?? 7) || value.difficulty !== (daily.difficulty ?? 'standard')) return false;
    if (value.seed !== daily.seed || value.edition !== daily.edition || value.startingPiece !== daily.playerPiece || !equal(value.species, daily.species) || !equal(value.targets, daily.targets) || !equal(value.theme, daily.theme)) return false;
    const population = (floor) => PIECE_COUNTS[daily.targets[floor]] + 2;
    const totalPopulation = [0, 1, 2].reduce((sum, floor) => sum + population(floor), 0);
    if (!integer(value.floor, 0, 2) || !integer(value.turns, 0, 60) || value.maxTurns !== 60 || !integer(value.captures, 0, totalPopulation) || !integer(value.treasure, 0, 9) || !integer(value.gold, 0, totalPopulation + 9)) return false;
    if (!value.player || !walkable(value, value.player.x, value.player.y) || value.player.maxHp !== PIECE_LIVES[value.startingPiece] || !integer(value.player.hp, 1, value.player.maxHp) || typeof value.player.moved !== 'boolean') return false;
    if (value.player.piece !== value.startingPiece && !(value.startingPiece === 'pawn' && value.player.piece === 'queen')) return false;
    if (value.status === 'playing' && (value.player.hp < 1 || (value.turns === 60 && !(value.floor === 2 && value.exit.open)))) return false;
    if (value.status === 'won' && (value.player.hp < 1 || value.floor !== 2 || !value.objective.complete)) return false;
    if (!value.powers || !POWERUPS.every((power) => integer(value.powers[power.id], 0, power.max))) return false;
    if (!Array.isArray(value.purchases) || value.purchases.length > Math.floor((totalPopulation + 9) / 2) || !value.purchases.every((id) => POWERUPS.some((power) => power.id === id))) return false;
    // Schema-5 saves made before companion reservations have no ledger yet.
    const orders = value.companionOrders === undefined ? [] : value.companionOrders;
    if (!Array.isArray(orders) || orders.length > 2 || !orders.every((entry, index) => entry && Object.keys(entry).length === 2 && integer(entry.floor, 1, 2) && entry.floor <= value.floor + 1 && COMPANIONS.some((recruit) => recruit.piece === entry.piece) && (!index || orders[index - 1].floor < entry.floor))) return false;
    const companionCost = orders.reduce((sum, entry) => sum + COMPANIONS.find((recruit) => recruit.piece === entry.piece).cost, 0);
    if (value.gold !== value.treasure + value.captures - companionCost - value.purchases.reduce((sum, id) => sum + POWERUPS.find((power) => power.id === id).cost, 0)) return false;
    const template = createGame({...daily,legacyTurnOrder:value.legacyTurnOrder}); template.floor = value.floor; template.companionOrders = orders;
    // Layout depends only on the edition and original piece, never on promotion.
    setFloor(template);
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
    } else if (deliveredOrder || (recruit && !value.items.some((item)=>item.type==='companion'))) return false;
    if (value.records.length !== (value.status === 'won' ? 3 : value.floor)) return false;
    if (!value.records.every((record, index) => record.floor === index && integer(record.turns, 1, 60) && integer(record.captures, PIECE_COUNTS[daily.targets[index]], population(index)) && integer(record.treasure, 0, 3) && record.grade === (record.treasure === 3 ? 'gold' : record.captures > PIECE_COUNTS[daily.targets[index]] ? 'silver' : 'bronze'))) return false;
    if (!value.floorStart || !integer(value.floorStart.turns, 0, value.turns) || !integer(value.floorStart.captures, 0, value.captures) || !integer(value.floorStart.treasure, 0, value.treasure)) return false;
    const previous = value.records.slice(0, value.floor);
    for (const key of ['turns', 'captures', 'treasure']) if (previous.reduce((sum, record) => sum + record[key], 0) !== value.floorStart[key]) return false;
    if (value.captures !== value.floorStart.captures + population(value.floor) - value.enemies.length || value.treasure !== value.floorStart.treasure + 3 - value.items.filter((item) => item.type === 'coin').length) return false;
    if (value.status === 'won' && ['turns', 'captures', 'treasure'].some((key) => value.records.reduce((sum, record) => sum + record[key], 0) !== value[key])) return false;
    if (typeof value.message !== 'string' || value.message.length > 1000 || !value.events.every((event) => ['move', 'capture', 'damage', 'pickup', 'powerup', 'shield', 'descend', 'win', 'promotion', 'enemy-promotion', 'enemy-phase', 'enemy-move', 'companion-order', 'companion-recruit', 'companion-phase', 'companion-move', 'companion-capture', 'companion-promotion', 'miss', 'restart'].includes(event.type) && inside(event.x, event.y) && (event.type !== 'enemy-move' || (template.enemies.some((foe) => foe.id === event.id) && inside(event.from?.x, event.from?.y))))) return false;
    return true;
  } catch { return false; }
}

