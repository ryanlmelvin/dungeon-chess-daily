// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Wall-aware move tables for one room, like a chess engine's attack tables:
// where the player's piece can go in one move from every square, and the
// fewest moves from any square to any other over the room's walls. Monsters
// come and go, so they never block here: the tables answer "how far is that
// square for this piece in this room?", not "is the line open right now?".
// Squares are numbered y * 8 + x. src/human-bot.js uses them to approach its
// targets; a solver can use them in place of coordinate distances.

const ORTHOGONAL = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const KNIGHT = [[-2, -1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1]];
const RAYS = { rook: ORTHOGONAL, bishop: DIAGONAL, queen: [...ORTHOGONAL, ...DIAGONAL] };
/** distanceTable() value for a square the piece can never land on. */
export const UNREACHABLE = 255;

const open = (map, x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 && map[y][x] !== '#';
const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, build());
  }
  return cache.get(key);
}

/**
 * One-move destinations from every square: 64 arrays of square numbers, for
 * `piece` in a room whose walls are the '#' squares of `map` (8 strings).
 * Sliders stop at walls and knights jump them. A pawn moves like the player's:
 * straight up the board, two squares from row 6. Its diagonal steps need a
 * monster to take, so they are left to distanceTable().
 */
export function stepTable(map, piece) {
  return cached(`steps:${piece}:${map.join('')}`, () => {
    const table = [];
    for (let from = 0; from < 64; from++) {
      const x = from % 8, y = (from - x) / 8, steps = [];
      if (!open(map, x, y)) { table.push(steps); continue; }
      if (piece === 'pawn') {
        if (open(map, x, y - 1)) {
          steps.push(from - 8);
          if (y === 6 && open(map, x, y - 2)) steps.push(from - 16);
        }
      } else if (RAYS[piece]) {
        for (const [dx, dy] of RAYS[piece]) {
          for (let step = 1; open(map, x + dx * step, y + dy * step); step++) steps.push((y + dy * step) * 8 + x + dx * step);
        }
      } else {
        for (const [dx, dy] of piece === 'knight' ? KNIGHT : [...ORTHOGONAL, ...DIAGONAL]) if (open(map, x + dx, y + dy)) steps.push((y + dy) * 8 + x + dx);
      }
      table.push(steps);
    }
    return table;
  });
}

/**
 * Fewest moves for the player's `piece` on square `from` to land on square
 * `to`, as table[from * 64 + to] (UNREACHABLE if it never can), over walls
 * only. For a pawn, landing means taking a monster there: it advances
 * straight, takes diagonally, and on row 0 becomes a queen for the rest of
 * the floor, so a target behind it is a promotion away.
 */
export function distanceTable(map, piece) {
  return cached(`distance:${piece}:${map.join('')}`, () => {
    const table = new Uint8Array(64 * 64).fill(UNREACHABLE);
    if (piece !== 'pawn') {
      const steps = stepTable(map, piece);
      for (let from = 0; from < 64; from++) bfs(table, from, [from], steps);
      return table;
    }
    // A pawn's walk: straight steps, then queen steps once it reaches row 0.
    const pawnSteps = stepTable(map, 'pawn'), queenSteps = stepTable(map, 'queen');
    const pawnSeen = new Uint8Array(64), queenSeen = new Uint8Array(64);
    for (let from = 0; from < 64; from++) {
      const x0 = from % 8, y0 = (from - x0) / 8;
      if (!open(map, x0, y0)) continue;
      pawnSeen.fill(UNREACHABLE); queenSeen.fill(UNREACHABLE);
      const queue = [[from, 0]];
      if (y0 === 0) queenSeen[from] = 0; else pawnSeen[from] = 0;
      if (y0 === 0) queue[0][1] = 1;
      for (let index = 0; index < queue.length; index++) {
        const [square, queen] = queue[index];
        const depth = queen ? queenSeen[square] : pawnSeen[square];
        const x = square % 8, y = (square - x) / 8;
        const land = (to) => { if (depth + 1 < table[from * 64 + to]) table[from * 64 + to] = depth + 1; };
        if (queen) {
          for (const to of queenSteps[square]) {
            land(to);
            if (queenSeen[to] === UNREACHABLE) { queenSeen[to] = depth + 1; queue.push([to, 1]); }
          }
          continue;
        }
        // Taking diagonally ends the walk on the target's square.
        for (const dx of [-1, 1]) if (open(map, x + dx, y - 1)) land(square - 8 + dx);
        for (const to of pawnSteps[square]) {
          const promoted = to < 8;
          const seen = promoted ? queenSeen : pawnSeen;
          if (seen[to] === UNREACHABLE) { seen[to] = depth + 1; queue.push([to, promoted ? 1 : 0]); }
        }
      }
      table[from * 64 + from] = 0;
    }
    return table;
  });
}

function bfs(table, from, start, steps) {
  const row = from * 64;
  for (const square of start) table[row + square] = 0;
  const queue = [...start];
  for (let index = 0; index < queue.length; index++) {
    const square = queue[index], depth = table[row + square];
    for (const to of steps[square]) {
      if (table[row + to] !== UNREACHABLE) continue;
      table[row + to] = depth + 1;
      queue.push(to);
    }
  }
}
