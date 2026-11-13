// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Animated diagrams for the journal's lesson pages (src/journal.js), one per
// idea a floor is composed around (src/composer.js): the squeeze, the tandem,
// the mating net, a pawn's tempo and crown lines, and the two ideas in
// preview, the Standstill and the Lure. Drawn on a 5x5 board
// crop like the other explainers (src/tactics-art.js), whose off-balance demo
// is the bait page's. Each takes (canvas, time in ms) and loops; its *_STILL
// time is a frame that reads on its own, for reduced motion.
import { drawSprite, SPRITE_SIZE, spritePalette, piecePalette, CROWN, CROWN_PALETTE, PALETTE, COMPANION_PALETTE } from './sprites.js';

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
 * Tandem: two targets stand walled in side by side, each guarding the other's
 * square, so whichever you take, the other takes you. A recruit can't be
 * taken: your knight recruit takes the first, and your bishop takes the
 * other, no longer guarded.
 */
export function drawTandemDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // The twins (1,0) and (2,0); the recruit knight (2,2) takes (1,0), then your bishop (4,2) takes (2,0) up its diagonal.
    for (const [x, y] of [[0, 0], [3, 0], [1, 1], [2, 1]]) wall(ctx, x, y);
    const send = beat(t, 1500, 2100);
    const aim = beat(t, 2550, 2850) * (1 - beat(t, 3500, 3700));
    const take = beat(t, 3500, 4100);
    const pulse = 0.7 + 0.3 * Math.sin(t / 110);
    // While both stand, each guards the other.
    const guard = beat(t, 200, 500) * (1 - beat(t, 1900, 2100)) * pulse;
    ring(ctx, 1, 0, RED, guard);
    ring(ctx, 2, 0, RED, guard);
    line(ctx, center(4), center(2), center(2), center(0), GOLD, aim * 0.9);
    ring(ctx, 2, 0, GOLD, aim * pulse);
    faded(ctx, 1 - beat(t, 2000, 2150), () => sprite(ctx, 'bat', center(1), center(0), monsterPalette));
    faded(ctx, 1 - beat(t, 4000, 4150), () => sprite(ctx, 'bat', center(2), center(0), monsterPalette));
    burst(ctx, center(1), center(0), beat(t, 2100, 2600), MINT);
    burst(ctx, center(2), center(0), beat(t, 4100, 4600), GOLD);
    sprite(ctx, 'piece-knight', lerp(center(2), center(1), send), lerp(center(2), center(0), send) - Math.sin(Math.PI * send) * 22, COMPANION_PALETTE);
    sprite(ctx, 'piece-bishop', lerp(center(4), center(2), take), lerp(center(2), center(0), take), playerPalette);
    label(ctx, 'EACH GUARDS THE OTHER', 100, 182, RED, beat(t, 300, 500) * (1 - beat(t, 1300, 1450)), 20);
    label(ctx, 'RECRUIT FIRST', 100, 182, MINT, beat(t, 1500, 1650) * (1 - beat(t, 2400, 2550)), 24);
    label(ctx, 'NOW TAKE THE OTHER', 100, 182, GOLD, beat(t, 2550, 2700) * (1 - beat(t, 3500, 3650)), 22);
    label(ctx, 'TANDEM!', 100, 182, GOLD, beat(t, 4100, 4300), 28);
  });
}
/** The recruit has taken one; your bishop eyes the other, no longer guarded. */
export const TANDEM_STILL = 3100;

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

/**
 * Standstill (a drawn idea, src/composer.js): a monster walled into two
 * squares steps out of reach just as your knight lands beside its pocket. The
 * knight stays where it is for a turn; the monster has to step back, and the
 * knight takes it.
 */
export function drawStandstillDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // The pocket (2,0)-(2,1); knight (3,4) -> (1,3), which covers (2,1), as the monster steps up to (2,0).
    for (const [x, y] of [[1, 0], [3, 0], [1, 1], [3, 1], [2, 2]]) wall(ctx, x, y);
    const hop = beat(t, 300, 900);
    const away = beat(t, 900, 1300);
    const cover = beat(t, 1300, 1600) * (1 - beat(t, 3300, 3500));
    const back = beat(t, 2600, 3000);
    const take = beat(t, 3300, 3800);
    // It balks before it steps back: it has nowhere else to go.
    const balk = t > 2100 && t < 2600 ? Math.round(Math.sin(t / 45) * 2) : 0;
    line(ctx, center(1), center(3), center(2), center(1), GOLD, cover * 0.9);
    ring(ctx, 2, 1, GOLD, cover * (0.7 + 0.3 * Math.sin(t / 110)));
    faded(ctx, 1 - beat(t, 3700, 3850), () => sprite(ctx, 'bat', center(2) + balk, lerp(lerp(center(1), center(0), away), center(1), back), monsterPalette));
    burst(ctx, center(2), center(1), beat(t, 3800, 4300), GOLD);
    const from = take ? [1, 3] : [3, 4], to = take ? [2, 1] : [1, 3], p = take || hop;
    sprite(ctx, 'piece-knight', lerp(center(from[0]), center(to[0]), p), lerp(center(from[1]), center(to[1]), p) - Math.sin(Math.PI * p) * 22, playerPalette);
    label(ctx, 'WAIT', center(1) + 46, center(3), MINT, beat(t, 1500, 1650) * (1 - beat(t, 3150, 3300)), 24);
    label(ctx, 'IT STEPPED AWAY', 100, 182, RED, beat(t, 1300, 1450) * (1 - beat(t, 2300, 2450)), 22);
    label(ctx, 'IT MUST STEP BACK', 100, 182, GOLD, beat(t, 2450, 2600) * (1 - beat(t, 3600, 3750)), 22);
    label(ctx, 'STANDSTILL!', 100, 182, GOLD, beat(t, 3800, 4000), 28);
  });
}
/** The knight has waited; the monster is back on the covered square. */
export const STANDSTILL_STILL = 3150;

// Three stars circling over an off-balance monster's head.
function stars(ctx, x, y, t) {
  for (let i = 0; i < 3; i++) {
    const angle = t / 170 + i * Math.PI * 2 / 3;
    ctx.fillStyle = GOLD;
    ctx.fillRect(Math.round(x + Math.cos(angle) * 14) - 2, Math.round(y - 24 + Math.sin(angle) * 4) - 2, 4, 4);
  }
}
/**
 * Lure (a drawn idea, src/composer.js): a decoy stands beside the
 * target, guarding it, wound up at your knight from the next square. The
 * knight jumps aside to where it attacks the target; the guard lunges onto
 * the empty square, off-balance and off its post, and the knight takes the
 * target it guarded.
 */
export function drawLureDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet'), guardPalette = spritePalette('moss') } = {}) {
  const t = loop(time);
  frame(canvas, t, (ctx) => {
    // Knight (1,3); the guard (1,2) above it, the target (2,2) beside the guard. The knight jumps to (3,4), then takes (2,2).
    for (const [x, y] of [[2, 1], [3, 2], [2, 3]]) wall(ctx, x, y);
    const aside = beat(t, 1300, 1900);
    const lunge = beat(t, 1950, 2300);
    const landed = t >= 2300;
    const take = beat(t, 3400, 3900);
    const pulse = 0.7 + 0.3 * Math.sin(t / 110);
    // Its wind-up on your square, and the square it guards beside it.
    const windUp = beat(t, 200, 500) * (1 - beat(t, 1950, 2150));
    tint(ctx, 1, 3, RED, windUp * 0.4 * pulse);
    line(ctx, center(1) + 14, center(2), center(2) - 14, center(2), RED, windUp * 0.9);
    ring(ctx, 2, 2, RED, windUp * pulse);
    // The target, free for a move: your line to it.
    const free = beat(t, 2400, 2700) * (1 - beat(t, 3400, 3600));
    line(ctx, center(3), center(4), center(2), center(2), GOLD, free * 0.9);
    ring(ctx, 2, 2, GOLD, free * pulse);
    faded(ctx, 1 - beat(t, 3800, 3950), () => sprite(ctx, 'bat', center(2), center(2), monsterPalette));
    burst(ctx, center(2), center(2), beat(t, 3900, 4400), GOLD);
    if (landed) {
      ctx.save();
      ctx.translate(center(1), center(3) + 16);
      ctx.rotate(Math.sin(t / 110) * 0.22);
      sprite(ctx, 'slime', 0, -16, guardPalette);
      ctx.restore();
      stars(ctx, center(1), center(3), t);
    } else sprite(ctx, 'slime', center(1), lerp(center(2), center(3), lunge), guardPalette);
    const from = take ? [3, 4] : [1, 3], to = take ? [2, 2] : [3, 4], p = take || aside;
    sprite(ctx, 'piece-knight', lerp(center(from[0]), center(to[0]), p), lerp(center(from[1]), center(to[1]), p) - Math.sin(Math.PI * p) * 22, playerPalette);
    label(ctx, 'IT GUARDS THE TARGET', 100, 14, RED, beat(t, 300, 500) * (1 - beat(t, 1300, 1450)), 20);
    label(ctx, 'JUMP ASIDE', 100, 14, MINT, beat(t, 1450, 1600) * (1 - beat(t, 2300, 2450)), 24);
    label(ctx, 'OFF ITS POST', 100, 14, GOLD, beat(t, 2450, 2600) * (1 - beat(t, 3700, 3850)), 24);
    label(ctx, 'LURED!', 100, 14, GOLD, beat(t, 3900, 4100), 28);
  });
}
/** The guard has lunged onto the knight's old square and wobbles; the target stands free. */
export const LURE_STILL = 3000;

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
