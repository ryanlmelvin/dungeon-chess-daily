// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Animated diagrams for the journal's lesson pages (src/journal.js), one per
// idea a floor is composed around (src/composer.js): the squeeze, the mating
// net, and a pawn's tempo and crown lines. Drawn on a 5x5 board crop like the
// other explainers (src/tactics-art.js), whose off-balance demo is the bait
// page's. Each takes (canvas, time in ms) and loops; its *_STILL time is a
// frame that reads on its own, for reduced motion.
import { drawSprite, SPRITE_SIZE, spritePalette, piecePalette, CROWN, CROWN_PALETTE, PALETTE } from './sprites.js';

const MINT = '#a5e2cc';
const RED = '#ed8b9c';
const GOLD = '#e6c17a';
const TILE = ['#302a38', '#443747'];
const LOOP = 5600;
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const beat = (time, from, to) => clamp01((time - from) / (to - from));
const center = (v) => v * 40 + 20;
const lerp = (a, b, p) => a + (b - a) * ease(p);
const loop = (time) => ((time % LOOP) + LOOP) % LOOP;

function sprite(ctx, id, x, y, palette = {}) {
  drawSprite(ctx, id, Math.round(x - SPRITE_SIZE), Math.round(y - SPRITE_SIZE), 2, palette);
}
function board(ctx) {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { ctx.fillStyle = TILE[(x + y) % 2]; ctx.fillRect(x * 40, y * 40, 40, 40); }
}
// A walled square: darker stone under a rock.
function wall(ctx, x, y) {
  ctx.fillStyle = '#1c1921';
  ctx.fillRect(x * 40, y * 40, 40, 40);
  sprite(ctx, 'prop-rock', center(x), center(y));
}
function ring(ctx, x, y, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x * 40 + 3, y * 40 + 3, 34, 34);
  ctx.restore();
}
function tint(ctx, x, y, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * 40 + 2, y * 40 + 2, 36, 36);
  ctx.restore();
}
function line(ctx, x1, y1, x2, y2, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}
function burst(ctx, x, y, t, color) {
  if (t <= 0 || t >= 1) return;
  ctx.save();
  ctx.globalAlpha *= 1 - t;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * (8 + 10 * t), y + Math.sin(angle) * (8 + 10 * t));
    ctx.lineTo(x + Math.cos(angle) * (14 + 16 * t), y + Math.sin(angle) * (14 + 16 * t));
    ctx.stroke();
  }
  ctx.restore();
}
function label(ctx, text, x, y, color, alpha, size = 22) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${size}px 'VT323', 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#100f14';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
// The small gold crown a promoted pawn wears on the board (src/sprites.js CROWN).
function crown(ctx, x, y, scale) {
  if (scale <= 0) return;
  const colors = { ...PALETTE, ...CROWN_PALETTE };
  const size = 2 * scale, left = x - CROWN[0].length * size / 2, top = y - CROWN.length * size;
  CROWN.forEach((row, r) => [...row].forEach((pixel, c) => {
    if (!colors[pixel]) return;
    ctx.fillStyle = colors[pixel];
    ctx.fillRect(Math.round(left + c * size), Math.round(top + r * size), Math.ceil(size), Math.ceil(size));
  }));
}
// One frame: the board, then `draw`, fading out over the loop's last 300 ms.
// `top` slides the board down under a strip of the back wall, for headroom over the last row.
function frame(canvas, t, draw, top = 0) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 200, canvas.height / 200);
  if (top) { ctx.fillStyle = '#1c1921'; ctx.fillRect(0, 0, 200, top); ctx.translate(0, top); }
  board(ctx);
  ctx.globalAlpha = 1 - beat(t, LOOP - 300, LOOP);
  draw(ctx);
  ctx.restore();
}
// Draw with the frame's fade times `alpha`.
function faded(ctx, alpha, draw) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  draw();
  ctx.restore();
}

/**
 * Squeeze: a monster walled into two squares must step every turn. Your
 * knight lands where it covers the only square the monster can step to; the
 * monster has to step there, and the knight takes it.
 */
export function drawSqueezeDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // The pocket (2,0)-(2,1); knight (3,4) -> (1,3), which covers (2,1), -> (2,1).
    for (const [x, y] of [[1, 0], [3, 0], [1, 1], [3, 1], [2, 2]]) wall(ctx, x, y);
    const hop = beat(t, 300, 900);
    const cover = beat(t, 900, 1200) * (1 - beat(t, 3000, 3200));
    const step = beat(t, 1900, 2300);
    const take = beat(t, 3000, 3500);
    // It balks before it steps: it has nowhere else to go.
    const balk = t > 1300 && t < 1900 ? Math.round(Math.sin(t / 45) * 2) : 0;
    line(ctx, center(1), center(3), center(2), center(1), GOLD, cover * 0.9);
    ring(ctx, 2, 1, GOLD, cover * (0.7 + 0.3 * Math.sin(t / 110)));
    faded(ctx, 1 - beat(t, 3400, 3550), () => sprite(ctx, 'bat', center(2) + balk, lerp(center(0), center(1), step), monsterPalette));
    burst(ctx, center(2), center(1), beat(t, 3500, 4000), GOLD);
    const from = take ? [1, 3] : [3, 4], to = take ? [2, 1] : [1, 3], p = take || hop;
    sprite(ctx, 'piece-knight', lerp(center(from[0]), center(to[0]), p), lerp(center(from[1]), center(to[1]), p) - Math.sin(Math.PI * p) * 22, playerPalette);
    label(ctx, 'COVER ITS ONLY STEP', 100, 182, GOLD, beat(t, 1000, 1200) * (1 - beat(t, 2200, 2350)), 22);
    label(ctx, 'IT MUST MOVE', 100, 182, RED, beat(t, 2350, 2500) * (1 - beat(t, 3300, 3450)), 24);
    label(ctx, 'SQUEEZED!', 100, 182, GOLD, beat(t, 3500, 3700), 28);
  });
}
/** The monster has stepped onto the covered square. */
export const SQUEEZE_STILL = 2700;

/**
 * Mating net: the king has a dead end of two squares. Your rook checks along
 * that line, so both squares are covered: checkmate, and the king topples.
 */
export function drawNetDemo(canvas, time, { playerPalette = {}, kingPalette = piecePalette('black') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // The king's dead end (4,0)-(4,1); rook (0,3) -> (4,3), checking up the column.
    for (const [x, y] of [[3, 0], [3, 1], [3, 2]]) wall(ctx, x, y);
    const slide = beat(t, 300, 1000);
    const check = beat(t, 1000, 1300);
    const mate = beat(t, 3300, 3900);
    const pulse = 0.7 + 0.3 * Math.sin(t / 110);
    for (const y of [0, 2]) tint(ctx, 4, y, GOLD, check * 0.28 * pulse);
    line(ctx, center(4), center(3) - 16, center(4), center(0), GOLD, check * 0.9);
    ring(ctx, 4, 1, RED, check * pulse * (1 - mate));
    // The mated king topples where it stands.
    faded(ctx, 1 - beat(t, 4500, 4800), () => {
      ctx.save();
      ctx.translate(center(4), center(1) + 16);
      ctx.rotate(-ease(mate) * Math.PI / 2);
      sprite(ctx, 'piece-king', 0, -16, kingPalette);
      ctx.restore();
    });
    burst(ctx, center(4), center(1), beat(t, 3700, 4300), GOLD);
    sprite(ctx, 'piece-rook', lerp(center(0), center(4), slide), center(3), playerPalette);
    label(ctx, 'CHECK', 100, 182, RED, beat(t, 1100, 1250) * (1 - beat(t, 2000, 2150)), 26);
    label(ctx, 'NO SAFE SQUARE', 100, 182, GOLD, beat(t, 2150, 2300) * (1 - beat(t, 3300, 3450)), 24);
    label(ctx, 'CHECKMATE!', 100, 182, GOLD, beat(t, 3500, 3700), 30);
  });
}
/** The rook's check covers every square the king could step to. */
export const NET_STILL = 2700;

/**
 * Tempo: a pawn takes only on its diagonals. It steps up, then waits, and the
 * target walks into a diagonal: the pawn strikes first.
 */
export function drawTempoDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // Pawn (2,4) -> (2,3), then a wait; the monster walks (1,0) -> (1,1) -> (1,2); the pawn takes it there.
    const step = beat(t, 300, 700);
    const walk1 = beat(t, 700, 1100), walk2 = beat(t, 2000, 2400);
    const marks = beat(t, 1100, 1400) * (1 - beat(t, 3300, 3500));
    const inReach = beat(t, 2400, 2550);
    const take = beat(t, 3300, 3800);
    // The pawn's two diagonals, and the one the target walks into.
    ring(ctx, 3, 2, MINT, marks * 0.55);
    ring(ctx, 1, 2, inReach ? GOLD : MINT, marks * (inReach ? 0.7 + 0.3 * Math.sin(t / 110) : 0.55));
    line(ctx, center(2), center(3), center(1), center(2), GOLD, inReach * marks * 0.9);
    faded(ctx, 1 - beat(t, 3700, 3850), () => sprite(ctx, 'bat', center(1), lerp(lerp(center(0), center(1), walk1), center(2), walk2), monsterPalette));
    burst(ctx, center(1), center(2), beat(t, 3800, 4300), GOLD);
    sprite(ctx, 'piece-pawn', lerp(center(2), center(1), take), take ? lerp(center(3), center(2), take) : lerp(center(4), center(3), step), playerPalette);
    label(ctx, 'WAIT', center(2) + 44, center(3), MINT, beat(t, 1500, 1650) * (1 - beat(t, 2400, 2550)), 24);
    label(ctx, 'IT WALKS IN', 100, 182, GOLD, beat(t, 2500, 2650) * (1 - beat(t, 3300, 3450)), 24);
    label(ctx, 'RIGHT ON TIME!', 100, 182, GOLD, beat(t, 3800, 4000), 26);
  });
}
/** The target has walked into the waiting pawn's diagonal. */
export const TEMPO_STILL = 2900;

/**
 * Crown: the pawn walks to the last row and becomes a queen, crown and all;
 * the new queen takes the target the pawn could never reach.
 */
export function drawCrownDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // Pawn (2,2) -> (2,1) -> (2,0), where it crowns; the queen takes (4,2) along the diagonal.
    for (const [x, y] of [[4, 1], [3, 3], [4, 3]]) wall(ctx, x, y);
    const step1 = beat(t, 300, 700), step2 = beat(t, 1000, 1400);
    const crowned = beat(t, 1400, 1700);
    const aim = beat(t, 2300, 2600) * (1 - beat(t, 2900, 3100));
    const take = beat(t, 2900, 3500);
    line(ctx, center(2), center(0), center(4), center(2), GOLD, aim * 0.9);
    ring(ctx, 4, 2, GOLD, aim * (0.7 + 0.3 * Math.sin(t / 110)));
    faded(ctx, 1 - beat(t, 3400, 3550), () => sprite(ctx, 'bat', center(4), center(2), monsterPalette));
    burst(ctx, center(2), center(0), beat(t, 1400, 1900), GOLD);
    burst(ctx, center(4), center(2), beat(t, 3500, 4000), GOLD);
    const x = lerp(center(2), center(4), take);
    const y = crowned ? lerp(center(0), center(2), take) : lerp(lerp(center(2), center(1), step1), center(0), step2);
    sprite(ctx, crowned ? 'piece-queen' : 'piece-pawn', x, y, playerPalette);
    // The crown pops on, a little too big at first.
    if (crowned) crown(ctx, x, y - 12, 1 + 0.3 * Math.sin(Math.PI * crowned));
    label(ctx, 'A QUEEN!', 100, 172, GOLD, beat(t, 1500, 1650) * (1 - beat(t, 3400, 3550)), 26);
    label(ctx, 'CROWNED!', 100, 172, GOLD, beat(t, 3600, 3800), 28);
  }, 10);
}
/** The new queen, crowned on the last row, eyes the target. */
export const CROWN_STILL = 2750;

// A closed book, 16x16: the journal's mark on its cue and its menu button.
const BOOK = Object.freeze([
  '................',
  '..xxxxxxxxxxx...',
  '.xrrrrrrrrrrrx..',
  '.xrhhhhhhhhhrxx.',
  '.xrrrrrrrrrrrxpx',
  '.xrryyyyyyyrrxpx',
  '.xrryrrrrryrrxpx',
  '.xrryrrrrryrrxpx',
  '.xrryyyyyyyrrxpx',
  '.xrrrrrrrrrrrxpx',
  '.xrrrrrrrrrrrxpx',
  '.xrhhhhhhhhhrxpx',
  '.xrrrrrrrrrrrxpx',
  '.xxxxxxxxxxxxxpx',
  '..xpppppppppppx.',
  '...xxxxxxxxxxx..',
]);
const BOOK_PALETTE = Object.freeze({ x: '#17131d', r: '#8a3743', h: '#b2444e', y: '#e6c17a', p: '#e4dfcf' });
export const BOOK_SIZE = BOOK.length;

/** Draw the journal's book mark at an integer `scale`. */
export function drawBook(ctx, x = 0, y = 0, scale = 1) {
  BOOK.forEach((row, r) => [...row].forEach((pixel, c) => {
    if (!BOOK_PALETTE[pixel]) return;
    ctx.fillStyle = BOOK_PALETTE[pixel];
    ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
  }));
}
