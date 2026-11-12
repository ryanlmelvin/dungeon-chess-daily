// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Original pixel art for moving terrain (src/terrain.js), drawn by
// src/renderer.js: a crumbling floor's cracked tile and the pit it leaves
// (src/cracks.js), and a gate in each of its four looks (src/gates.js).
// Every piece of it is a 16×16 grid of palette keys, like src/sprites.js.

// A cracked tile: a branching fracture across the flagstone, dark with a pale
// chipped edge so it reads on the red stones and the grey alike.
export const CRACK_ART = Object.freeze([
  '................',
  '......k.........',
  '......kl...k....',
  '.......k..kl....',
  '.......k.k......',
  '..k....kkk......',
  '...kk..kk.......',
  '....lkkkl.......',
  '.......kk.......',
  '.......k.k......',
  '......kl..kk....',
  '.....kk.....k...',
  '....lk......kl..',
  '....k.........k.',
  '...k............',
  '................',
]);
export const CRACK_PALETTE = Object.freeze({ k: '#0d090d', l: '#e2d2bf' });

// A pit: a broken stone lip, the far wall catching a little light, and
// darkness below with rubble at the bottom.
export const PIT_ART = Object.freeze([
  'eeeeeeeeeeeeeeee',
  'eewwwwwwwwwwwwee',
  'ewwwwwwwwwwwwwwe',
  'ewwvwwwvvwwwvwwe',
  'evvvvvvvvvvvvvve',
  'ebvvbbvbbbvbbvbe',
  'ebbbbbbbbbbbbbbe',
  'ebbbbbbbbbbbbbbe',
  'ebbbbbbbbbbbbbbe',
  'ebbbbbbbbbbbbbbe',
  'ebbbbbbbbbbbbbbe',
  'ebbbbbbbbbbbbbbe',
  'ebbbbbbrbbbbbbbe',
  'ebbrbbbbbbbrrbbe',
  'eebbbbbbbbbbbbee',
  'eeeeeeeeeeeeeeee',
]);
export const PIT_PALETTE = Object.freeze({ e: '#5b4a55', w: '#3a2e3a', v: '#231a25', b: '#060406', r: '#1c151e' });

/** A gate's colours: iron bars, and the bone-bright number of moves until it changes. */
export const GATE_PALETTE = Object.freeze({ k: '#17131b', s: '#4d5661', i: '#93a0ae', h: '#d5dee6', n: '#fff6dc' });
/** The numbers a gate can wear (src/gates.js gateLooks `left`), five texels by seven, in strokes two texels thick: read at a glance on a phone. */
export const GATE_DIGITS = Object.freeze({
  1: ['..nn.', '.nnn.', '..nn.', '..nn.', '..nn.', '..nn.', '.nnnn'],
  2: ['.nnn.', 'nn.nn', '...nn', '..nn.', '.nn..', 'nn...', 'nnnnn'],
  3: ['nnnn.', '...nn', '...nn', '.nnn.', '...nn', '...nn', 'nnnn.'],
});

// Each bar is two texels wide.
const BARS = [1, 5, 9, 13];
const blank = () => Array.from({ length: 16 }, () => Array(16).fill('.'));
// The gate's number on a dark plate whose top-left texel is (left, top): the moves until it changes.
function number(grid, left, top, count) {
  const digit = GATE_DIGITS[count] ?? GATE_DIGITS[3];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) grid[top + y][left + x] = 'k';
  digit.forEach((row, y) => [...row].forEach((cell, x) => { if (cell === 'n') grid[top + 1 + y][left + 1 + x] = 'n'; }));
}

/**
 * A gate's art by its look: shut, a portcullis standing on its square (drawn
 * upright, like a pillar); open, the slot its bars have sunk into (drawn flat
 * on the floor). `left` is the number it wears, the moves until it changes: a
 * plate hung in the middle of the bars when shut, in the near corner of the
 * square when open, where it shows beside a piece standing in the gate.
 */
export function gateArt(shut, left) {
  const grid = blank();
  if (shut) {
    for (let x = 0; x < 16; x++) { grid[1][x] = 'k'; grid[2][x] = x === 0 || x === 15 ? 'k' : 'h'; grid[3][x] = 'k'; }
    for (const x of BARS) for (let y = 4; y <= 15; y++) { grid[y][x] = y === 15 ? 'h' : 'i'; grid[y][x + 1] = 's'; }
    for (const y of [7, 12]) for (let x = 0; x < 16; x++) { grid[y][x] = 'i'; grid[y + 1][x] = grid[y + 1][x] === '.' ? 'k' : grid[y + 1][x]; }
    number(grid, 5, 5, left);
  } else {
    // The sockets the bars dropped into, between two low posts.
    for (let x = 0; x < 16; x++) { grid[7][x] = 'k'; grid[8][x] = 'k'; }
    for (const x of BARS) { grid[7][x] = 'i'; grid[7][x + 1] = 's'; }
    for (const x of [0, 1, 14, 15]) for (let y = 5; y <= 10; y++) grid[y][x] = y === 5 ? 'h' : x === 0 || x === 15 ? 'i' : 's';
    number(grid, 9, 7, left);
  }
  return grid.map((row) => row.join(''));
}
