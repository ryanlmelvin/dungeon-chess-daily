// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 5);
export const PIECES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const ORTHOGONAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
const SPECIES = [
  ['bat', 'Bat', 'Bats'], ['rat', 'Rat', 'Rats'], ['slime', 'Slime', 'Slimes'],
  ['spider', 'Spider', 'Spiders'], ['ghost', 'Ghost', 'Ghosts'], ['mushroom', 'Mushroom', 'Mushrooms'],
  ['skull', 'Skull', 'Skulls'], ['snake', 'Snake', 'Snakes'], ['beetle', 'Beetle', 'Beetles'],
  ['gargoyle', 'Gargoyle', 'Gargoyles'], ['imp', 'Imp', 'Imps'], ['mimic', 'Mimic', 'Mimics'],
  ['eye', 'Floating eye', 'Floating eyes'], ['worm', 'Worm', 'Worms'], ['moth', 'Moth', 'Moths'],
  ['crab', 'Crab', 'Crabs'], ['wraith', 'Wraith', 'Wraiths'], ['golem', 'Golem', 'Golems'],
];
const HEADLINES = {
  pawn: (name) => `${name} march on. Trouble at their flanks.`,
  rook: (name) => `${name} demand straighter streets`,
  knight: (name) => `${name} take an L-shaped shortcut`,
  bishop: (name) => `${name} insist on a diagonal commute`,
  queen: (name) => `Queenly ${name.toLowerCase()} occupy the dungeon`,
  king: (name) => `${name} take things one step at a time`,
};
const HINTS = {
  pawn: 'Witnesses report a steady march south, with trouble on the two forward corners. Reaching the far rank seems to go to their heads.',
  rook: 'They travel as far as they please along straight aisles. Corners are strictly out of the question.',
  knight: 'Two paces one way, one pace sideways. They have been seen vaulting clean over the other residents.',
  bishop: 'Always cutting diagonally across the floor, they seem oddly attached to just one color of tile.',
  queen: 'Straight aisles or diagonal shortcuts: nothing slows these ambitious residents except another body in the way.',
  king: 'In any direction, but only one tile at a time. A surprisingly modest commute for such self-important residents.',
};

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
function random(seed) {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDaily(date = new Date()) {
  const value = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(date).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new TypeError('Invalid daily date.');
  const seed = hash(value);
  const rng = random(seed);
  const playerPiece = PIECES[Math.floor(rng() * PIECES.length)];
  const pool = [...SPECIES];
  const species = Array.from({ length: 3 }, () => {
    const [id, name, plural] = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    return { id, name, plural, piece: PIECES[Math.floor(rng() * PIECES.length)] };
  });
  return {
    date: value, edition: Math.floor((Date.parse(value) - EPOCH) / DAY) + 1, seed, playerPiece, species,
    theme: {
      name: 'The Midnight Board', headline: HEADLINES[species[0].piece](species[0].plural),
      deck: HINTS[species[0].piece], boss: species[2].name, accent: '#b75652',
      stories: species.slice(1).map((creature) => ({ title: HEADLINES[creature.piece](creature.plural), body: HINTS[creature.piece], species: creature.id })),
    },
  };
}

function same(a, b) { return a.x === b.x && a.y === b.y; }
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function inside(x, y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 8 && y < 8; }
export function walkable(_state, x, y) { return inside(x, y); }
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
    const foe = enemyAt(state, x, y);
    if (foe && foe !== unit) return enemy ? 'friend' : 'opponent';
    if (enemy && state.player.x === x && state.player.y === y && state.player.hp) return 'opponent';
    return null;
  };
  const push = (x, y, requireCapture = false) => {
    if (!inside(x, y)) return false;
    const occupied = occupant(x, y);
    if (occupied === 'friend') return false;
    if (!requireCapture || occupied === 'opponent' || attacksOnly) moves.push({ x, y, capture: occupied === 'opponent' });
    return occupied === null;
  };
  if (unit.piece === 'pawn') {
    const forward = enemy ? 1 : -1;
    if (!attacksOnly && inside(unit.x, unit.y + forward) && !occupant(unit.x, unit.y + forward)) {
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
  if (!state || state.status !== 'playing') return [];
  return movesFor(state, state.player);
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
    if (!inside(x, y) || enemyAt(state, x, y)) break;
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
  const tie = (move) => hash(`${state.seed}:${state.floor}:${state.turns}:${foe.id}:${move.x},${move.y}`) / 4294967296;
  candidates.sort((a, b) => {
    const score = (move) => distance(move, state.player) + distance(move, foe) * 0.35 + tie(move) * 0.7;
    return score(a) - score(b);
  });
  foe.x = candidates[0].x; foe.y = candidates[0].y; foe.moved = true;
  promoteMonster(state, foe);
  aimAtPlayer(state, foe);
}

function enemyTurn(state) {
  for (const foe of state.enemies) {
    if (foe.phase === 'aim') {
      const capture = foe.intent.some((tile) => same(tile, state.player))
        && movesFor(state, foe, true, true).some((move) => move.capture && same(move, state.player));
      if (capture) {
        foe.x = state.player.x; foe.y = state.player.y; foe.moved = true;
        promoteMonster(state, foe);
        state.player.hp = 0; state.status = 'lost';
        state.events.push({ type: 'damage', x: foe.x, y: foe.y, amount: 1 });
        state.message = `${foe.name} caught your piece.`;
        return;
      }
      const destination = movesFor(state, foe, true).find((move) => same(move, foe.target) && !move.capture && preservesPawnLane(state, move));
      if (destination) { foe.x = destination.x; foe.y = destination.y; foe.moved = true; promoteMonster(state, foe); }
      foe.phase = 'ready'; foe.intent = []; foe.target = null;
      state.events.push({ type: 'miss', x: foe.x, y: foe.y });
    } else if (!aimAtPlayer(state, foe)) {
      moveMonster(state, foe);
    }
  }
}

function setFloor(state) {
  state.map = Array(8).fill('........');
  state.player.x = 4; state.player.y = 6; state.player.moved = false;
  state.exit = { x: 4, y: 0, open: false };
  state.floorStart = { turns: state.turns, captures: state.captures, treasure: state.treasure };
  const species = state.species[state.floor];
  const mirror = (state.seed >>> (state.floor + 2)) % 2 === 0;
  const coordinates = state.player.piece === 'pawn'
    ? [[mirror ? 3 : 5, 2], [mirror ? 6 : 1, 3], [mirror ? 1 : 6, 1]]
    : [[4, 2], [mirror ? 6 : 1, 3], [mirror ? 1 : 6, 1]];
  if (state.player.piece === 'bishop' && species.piece === 'bishop') {
    for (const point of coordinates) if ((point[0] + point[1]) % 2 !== 0) point[0] += point[0] < 7 ? 1 : -1;
  }
  state.enemies = coordinates.slice(0, state.floor === 2 ? 3 : 2).map(([x, y], index) => ({
    id: `f${state.floor}-${index}`, species: species.id, name: species.name, piece: species.piece,
    x, y, moved: false, phase: 'ready', intent: [], target: null,
  }));
  state.items = [{ x: 4, y: 4, type: 'coin' }, { x: state.player.piece === 'pawn' ? 4 : 6, y: 2, type: 'coin' }];
  for (const foe of state.enemies) aimAtPlayer(state, foe);
}

export function createGame(daily = getDaily()) {
  const state = {
    schema: 2, date: daily.date, seed: daily.seed, edition: daily.edition, theme: structuredClone(daily.theme), species: structuredClone(daily.species),
    startingPiece: daily.playerPiece, floor: 0, player: { x: 4, y: 6, piece: daily.playerPiece, hp: 1, maxHp: 1, moved: false },
    turns: 0, maxTurns: 60, status: 'playing', captures: 0, treasure: 0, records: [], events: [],
    message: 'Capture one monster to unlock the stairs. Glowing paths warn of the next attack.',
  };
  setFloor(state);
  return state;
}

function finishFloor(state) {
  const captures = state.captures - state.floorStart.captures;
  const treasure = state.treasure - state.floorStart.treasure;
  state.records.push({ floor: state.floor, turns: state.turns - state.floorStart.turns, captures, treasure, grade: treasure === 2 ? 'gold' : captures > 1 ? 'silver' : 'bronze' });
  if (state.floor === 2) {
    state.status = 'won'; state.message = 'Your dispatch made the morning edition.';
    state.events.push({ type: 'win', x: state.player.x, y: state.player.y });
  } else {
    state.floor++; setFloor(state);
    state.message = 'Another room. These residents move differently.';
    state.events.push({ type: 'descend', x: state.player.x, y: state.player.y });
  }
}

export function act(previous, action) {
  if (!previous || previous.status !== 'playing' || action?.type !== 'move') return previous;
  if (!legalMoves(previous).some((move) => move.x === action.x && move.y === action.y)) return previous;
  const state = structuredClone(previous);
  state.events = []; state.turns++; state.message = '';
  // The player's entire move and capture happen before any monster responds.
  const captured = enemyAt(state, action.x, action.y);
  if (captured) {
    state.enemies = state.enemies.filter((foe) => foe.id !== captured.id);
    state.captures++; state.exit.open = true;
    state.events.push({ type: 'capture', x: action.x, y: action.y });
    state.message = `${captured.name} captured. The stairs are open.`;
  }
  state.player.x = action.x; state.player.y = action.y; state.player.moved = true;
  state.events.push({ type: 'move', x: action.x, y: action.y });
  if (state.player.piece === 'pawn' && state.player.y === 0) {
    state.player.piece = 'queen';
    state.events.push({ type: 'promotion', x: action.x, y: action.y });
    state.message = 'Promoted to queen. Your new moves carry into the next room.';
  }
  const item = state.items.find((entry) => same(entry, state.player));
  if (item) {
    state.items = state.items.filter((entry) => entry !== item); state.treasure++;
    state.events.push({ type: 'pickup', x: action.x, y: action.y });
  }
  enemyTurn(state);
  if (state.status === 'playing' && state.exit.open && same(state.player, state.exit)) finishFloor(state);
  if (state.status === 'playing' && state.turns >= state.maxTurns) {
    state.status = 'lost'; state.message = 'The presses have rolled. You missed the deadline.';
  } else if (state.status === 'playing' && legalMoves(state).length === 0) {
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

export function validateSave(value, date) {
  try {
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    if (!value || value.schema !== 2 || value.date !== date || !['playing', 'won', 'lost'].includes(value.status)) return false;
    const daily = getDaily(date);
    if (value.seed !== daily.seed || value.edition !== daily.edition || value.startingPiece !== daily.playerPiece || JSON.stringify(value.species) !== JSON.stringify(daily.species)) return false;
    if (!integer(value.floor, 0, 2) || !integer(value.turns, 0, 60) || value.maxTurns !== 60 || !integer(value.captures, 0, 7) || !integer(value.treasure, 0, 6)) return false;
    if (!value.player || !inside(value.player.x, value.player.y) || value.player.maxHp !== 1 || ![0, 1].includes(value.player.hp) || typeof value.player.moved !== 'boolean') return false;
    if (value.player.piece !== value.startingPiece && !(value.startingPiece === 'pawn' && value.player.piece === 'queen')) return false;
    if (value.status === 'playing' && (value.player.hp !== 1 || value.turns === 60)) return false;
    if (value.status === 'won' && (value.player.hp !== 1 || value.floor !== 2)) return false;
    if (JSON.stringify(value.map) !== JSON.stringify(Array(8).fill('........')) || value.exit?.x !== 4 || value.exit?.y !== 0 || value.exit.open !== (value.captures > value.floorStart?.captures)) return false;
    if (!value.theme || typeof value.theme.headline !== 'string' || value.theme.headline.length > 1000 || !Array.isArray(value.theme.stories) || value.theme.stories.length !== 2) return false;
    if (!Array.isArray(value.enemies) || value.enemies.length > (value.floor === 2 ? 3 : 2) || !Array.isArray(value.items) || value.items.length > 2 || !Array.isArray(value.records) || !Array.isArray(value.events) || value.events.length > 16) return false;
    const species = value.species[value.floor];
    if (!value.enemies.every((foe) => {
      const validPiece = foe.piece === species.piece || (species.piece === 'pawn' && foe.piece === 'queen' && foe.promoted === true);
      if (!new RegExp(`^f${value.floor}-[0-${value.floor === 2 ? 2 : 1}]$`).test(foe.id) || foe.species !== species.id || foe.name !== species.name || !validPiece || !inside(foe.x, foe.y) || typeof foe.moved !== 'boolean') return false;
      if (same(foe, value.player) && value.player.hp !== 0) return false;
      if (!['ready', 'aim'].includes(foe.phase) || !Array.isArray(foe.intent) || foe.intent.length > 7 || !foe.intent.every((tile) => inside(tile.x, tile.y))) return false;
      return foe.phase === 'aim' ? foe.intent.length > 0 && inside(foe.target?.x, foe.target?.y) : foe.intent.length === 0 && foe.target === null;
    })) return false;
    if (new Set(value.enemies.map((foe) => foe.id)).size !== value.enemies.length || new Set(value.enemies.map((foe) => `${foe.x},${foe.y}`)).size !== value.enemies.length) return false;
    if (!value.items.every((item) => item.type === 'coin' && ((item.x === 4 && item.y === 4) || ([4, 6].includes(item.x) && item.y === 2))) || new Set(value.items.map((item) => `${item.x},${item.y}`)).size !== value.items.length) return false;
    if (value.records.length !== (value.status === 'won' ? 3 : value.floor)) return false;
    if (!value.records.every((record, index) => record.floor === index && integer(record.turns, 1, 60) && integer(record.captures, 1, index === 2 ? 3 : 2) && integer(record.treasure, 0, 2) && record.grade === (record.treasure === 2 ? 'gold' : record.captures > 1 ? 'silver' : 'bronze'))) return false;
    if (!value.floorStart || !integer(value.floorStart.turns, 0, value.turns) || !integer(value.floorStart.captures, 0, value.captures) || !integer(value.floorStart.treasure, 0, value.treasure)) return false;
    const previous = value.records.slice(0, value.floor);
    for (const key of ['turns', 'captures', 'treasure']) if (previous.reduce((sum, record) => sum + record[key], 0) !== value.floorStart[key]) return false;
    if (value.captures !== value.floorStart.captures + (value.floor === 2 ? 3 : 2) - value.enemies.length || value.treasure !== value.floorStart.treasure + 2 - value.items.length) return false;
    if (value.status === 'won' && (!same(value.player, value.exit) || ['turns', 'captures', 'treasure'].some((key) => value.records.reduce((sum, record) => sum + record[key], 0) !== value[key]))) return false;
    if (typeof value.message !== 'string' || value.message.length > 1000 || !value.events.every((event) => ['move', 'capture', 'damage', 'pickup', 'descend', 'win', 'promotion', 'enemy-promotion', 'miss'].includes(event.type) && inside(event.x, event.y))) return false;
    return true;
  } catch { return false; }
}
