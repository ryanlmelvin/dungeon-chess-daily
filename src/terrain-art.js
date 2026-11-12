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

/** A gate's colours: iron bars, and the arrow that says it changes after this move (mint: it opens; amber: it shuts). */
export const GATE_PALETTE = Object.freeze({ k: '#17131b', s: '#4d5661', i: '#93a0ae', h: '#d5dee6', m: '#8af4d5', a: '#ffb057' });
/** A small rising arrow, for the near edge of an open gate that is about to shut. */
export const GATE_RISE = Object.freeze(['..a..', '.aaa.', 'aa.aa']);

// Each bar is two texels wide.
const BARS = [1, 5, 9, 13];
const blank = () => Array.from({ length: 16 }, () => Array(16).fill('.'));
// A dark plate with a chevron on it: pointing down where the bars are about to
// drop (the gate opens), up where they are about to rise (it shuts).
function arrow(grid, key, down) {
  for (let y = 4; y <= 11; y++) for (let x = 3; x <= 12; x++) grid[y][x] = 'k';
  const rows = ['mm....mm', 'mmm..mmm', '.mmmmmm.', '..mmmm..', '...mm...'];
  (down ? rows : [...rows].reverse()).forEach((row, n) => [...row].forEach((cell, x) => { if (cell === 'm') grid[5 + n + (down ? 0 : 1)][4 + x] = key; }));
}

/**
 * A gate's art by its look: shut, a portcullis standing on its square (drawn
 * upright, like a pillar); open, the slot its bars have sunk into (drawn flat
 * on the floor). `turning`: it changes after this move, so it wears its arrow.
 */
export function gateArt(shut, turning) {
  const grid = blank();
  if (shut) {
    for (let x = 0; x < 16; x++) { grid[1][x] = 'k'; grid[2][x] = x === 0 || x === 15 ? 'k' : 'h'; grid[3][x] = 'k'; }
    for (const x of BARS) for (let y = 4; y <= 15; y++) { grid[y][x] = y === 15 ? 'h' : 'i'; grid[y][x + 1] = 's'; }
    for (const y of [7, 12]) for (let x = 0; x < 16; x++) { grid[y][x] = 'i'; grid[y + 1][x] = grid[y + 1][x] === '.' ? 'k' : grid[y + 1][x]; }
    if (turning) arrow(grid, 'm', true);
  } else {
    // The sockets the bars dropped into, between two low posts.
    for (let x = 0; x < 16; x++) { grid[7][x] = 'k'; grid[8][x] = 'k'; }
    for (const x of BARS) { grid[7][x] = 'i'; grid[7][x + 1] = 's'; }
    for (const x of [0, 1, 14, 15]) for (let y = 5; y <= 10; y++) grid[y][x] = y === 5 ? 'h' : x === 0 || x === 15 ? 'i' : 's';
    if (turning) arrow(grid, 'a', false);
  }
  return grid.map((row) => row.join(''));
}
