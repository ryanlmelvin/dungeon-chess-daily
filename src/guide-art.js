// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import { drawSprite, SPRITE_SIZE, STONE_SIZE, paintStone, spritePalette, piecePalette, COMPANION_PALETTE } from './sprites.js';
import { drawForkDemo, FORK_STILL, drawComboDemo, COMBO_STILL, drawOffBalanceDemo, OFF_BALANCE_STILL, drawBishopPairDemo, BISHOP_PAIR_STILL } from './tactics-art.js';

const INK = '#17131d';
const MINT = '#a5e2cc';
const RED = '#ed8b9c';
const TILE = ['#302a38', '#443747'];

function sprite(ctx, id, x, y, scale = 2, palette = {}) {
  drawSprite(ctx, id, Math.round(x - SPRITE_SIZE * scale / 2), Math.round(y - SPRITE_SIZE * scale / 2), scale, palette);
}

function arrow(ctx, x1, y1, x2, y2, color = MINT, size = 8) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function board(ctx, columns, rows, cell, top = 0) {
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    ctx.fillStyle = TILE[(x + y) % 2];
    ctx.fillRect(x * cell, top + y * cell, cell, cell);
  }
}

function destination(ctx, x, y) {
  ctx.fillStyle = MINT;
  ctx.beginPath();
  ctx.arc(x * 40 + 20, y * 40 + 20, 5, 0, Math.PI * 2);
  ctx.fill();
}

function capture(ctx, x, y) {
  ctx.strokeStyle = RED;
  ctx.lineWidth = 3;
  ctx.strokeRect(x * 40 + 3, y * 40 + 3, 34, 34);
  sprite(ctx, 'skull', x * 40 + 20, y * 40 + 20, 2, spritePalette('rose'));
}

// Destination squares on the 5x5 demo board, centered on (2, 2).
function moveTargets(piece, enemy = false) {
  if (piece === 'pawn') {
    const f = enemy ? 1 : -1;
    return { moves: [[2, 2 + f], [2, 2 + 2 * f]], captures: [[1, 2 + f], [3, 2 + f]] };
  }
  if (piece === 'knight') return { moves: [[0,1],[1,0],[3,0],[4,1],[4,3],[3,4],[1,4],[0,3]], captures: [] };
  if (piece === 'king') {
    const moves = [];
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) if (x !== 2 || y !== 2) moves.push([x, y]);
    return { moves, captures: [] };
  }
  const directions = [];
  if (piece !== 'bishop') directions.push([0,-1],[-1,0],[1,0],[0,1]);
  if (piece !== 'rook') directions.push([-1,-1],[1,-1],[-1,1],[1,1]);
  const moves = [];
  for (const [dx, dy] of directions) {
    for (let step = 1; step <= 2; step++) {
      const x = 2 + dx * step;
      const y = 2 + dy * step;
      if (piece === 'rook' && x === 3 && y === 2) break;
      moves.push([x, y]);
    }
  }
  return { moves, captures: [] };
}

function movement(ctx, piece, { enemy = false, at = null, palette = {}, focus = null } = {}) {
  board(ctx, 5, 5, 40);
  const { moves, captures } = moveTargets(piece, enemy);
  if (focus) {
    ctx.strokeStyle = MINT;
    ctx.lineWidth = 2;
    ctx.strokeRect(focus[0] * 40 + 2, focus[1] * 40 + 2, 36, 36);
  }
  // A pawn's far dot is available only for an unobstructed opening double step.
  for (const [x, y] of moves) destination(ctx, x, y);
  for (const [x, y] of captures) capture(ctx, x, y);
  if (piece === 'pawn') {
    const f = enemy ? 1 : -1;
    arrow(ctx, 100, 100 + 14 * f, 100, 100 + 33 * f, MINT, 7);
    arrow(ctx, 87, 100 + 13 * f, 76, 100 + 24 * f, RED, 7);
    arrow(ctx, 113, 100 + 13 * f, 124, 100 + 24 * f, RED, 7);
  } else if (piece === 'knight') {
    sprite(ctx, 'prop-crate', 100, 60);
  } else if (piece === 'rook') {
    sprite(ctx, 'prop-crate', 140, 100);
  }
  sprite(ctx, `piece-${piece}`, at ? at[0] : 100, at ? at[1] : 100, 2, palette);
}

const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/**
 * One frame of an animated move demo: the piece repeatedly travels from the
 * center to each destination in turn and back. Knights arc to show the jump.
 */
export function drawMoveDemo(canvas, piece, time, { enemy = false, palette = {} } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { moves, captures } = moveTargets(piece, enemy);
  const targets = [...moves, ...captures];
  const cycle = 1800;
  const index = Math.floor(time / cycle) % targets.length;
  const phase = (time % cycle) / cycle;
  // Hold, travel out, hold on the destination, travel back.
  const t = phase < 0.15 ? 0 : phase < 0.45 ? ease((phase - 0.15) / 0.3) : phase < 0.8 ? 1 : 1 - ease((phase - 0.8) / 0.2);
  const [tx, ty] = targets[index];
  const x = 100 + (tx * 40 + 20 - 100) * t;
  const lift = piece === 'knight' ? Math.sin(Math.PI * t) * 26 : 0;
  const y = 100 + (ty * 40 + 20 - 100) * t - lift;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 200, canvas.height / 200);
  movement(ctx, piece, { enemy, at: [x, y], palette, focus: [tx, ty] });
  ctx.restore();
}

function goal(ctx) {
  ctx.fillStyle = TILE[0];
  ctx.fillRect(18, 24, 154, 80);
  sprite(ctx, 'bat', 59, 64, 3, spritePalette('violet'));
  sprite(ctx, 'bat', 131, 64, 3, spritePalette('violet'));
  ctx.strokeStyle = RED;
  ctx.lineWidth = 3;
  for (const x of [59, 131]) {
    ctx.beginPath();
    ctx.moveTo(x - 23, 41); ctx.lineTo(x + 23, 87);
    ctx.moveTo(x + 23, 41); ctx.lineTo(x - 23, 87);
    ctx.stroke();
  }
  // A complete matching target group opens the exit door exactly as play draws
  // it (renderer.js): a doorway in the back wall, behind the top-center square,
  // open onto a glowing well with four white steps. Units are board squares.
  arrow(ctx, 196, 64, 254, 64, MINT, 12);
  const size = 64;
  const centerX = 334;
  const top = 8;
  const mark = (cx, cz, width, length, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(centerX + (cx - width / 2) * size), Math.round(top + (cz + 1.3 - length / 2) * size), Math.round(width * size), Math.round(length * size));
  };
  const doorZ = -0.95;
  mark(0, doorZ, 1.04, 0.62, '#141017');
  for (const side of [-0.5, 0.5]) mark(side, doorZ, 0.1, 0.62, '#56404a');
  mark(0, doorZ - 0.3, 1.1, 0.08, '#56404a');
  mark(0, -0.57, 1.3, 0.08, '#56404a');
  mark(0, doorZ, 0.84, 0.5, '#0d0910');
  mark(0, doorZ, 0.96, 0.6, 'rgba(195, 239, 220, 0.2)');
  for (let i = 0; i < 4; i++) mark(0, doorZ + 0.18 - i * 0.12, 0.6 - i * 0.1, 0.05, '#eee8e1');
  // The exit square itself stays an ordinary floor stone.
  const stone = document.createElement('canvas');
  stone.width = stone.height = STONE_SIZE;
  paintStone(stone.getContext('2d'), true, 0);
  ctx.drawImage(stone, Math.round(centerX - 0.4875 * size), Math.round(top + (1.3 - 0.4875) * size), Math.round(0.975 * size), Math.round(0.975 * size));
}

function danger(ctx) {
  board(ctx, 5, 1, 80, 10);
  ctx.fillStyle = '#903e5166';
  ctx.fillRect(80, 10, 320, 80);
  ctx.strokeStyle = RED;
  ctx.lineWidth = 3;
  ctx.strokeRect(82, 12, 316, 76);
  arrow(ctx, 70, 50, 316, 50, RED, 12);
  sprite(ctx, 'golem', 40, 50, 3, spritePalette('rose'));
  sprite(ctx, 'piece-rook', 360, 50, 3);
  // Shape as well as color marks the danger lane.
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.moveTo(200, 19);
  ctx.lineTo(188, 39);
  ctx.lineTo(212, 39);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(199, 25, 2, 7);
  ctx.fillRect(199, 34, 2, 2);
}

// Guide canvases that can play their explainer animation.
const ANIMATED = {
  'en-passant-player': (canvas, time) => drawEnPassantDemo(canvas, time ?? EN_PASSANT_STILL, { mode: 'player', enemyPalette: piecePalette('black') }),
  'en-passant-enemy': (canvas, time) => drawEnPassantDemo(canvas, time ?? EN_PASSANT_STILL, { mode: 'enemy', enemyPalette: piecePalette('black') }),
  castle: (canvas, time) => drawCastleDemo(canvas, time ?? CASTLE_STILL),
  'bishop-pair': (canvas, time) => drawBishopPairDemo(canvas, time ?? BISHOP_PAIR_STILL),
  fork: (canvas, time) => drawForkDemo(canvas, time ?? FORK_STILL),
  combo: (canvas, time) => drawComboDemo(canvas, time ?? COMBO_STILL),
  'off-balance': (canvas, time) => drawOffBalanceDemo(canvas, time ?? OFF_BALANCE_STILL),
};

/** One frame of every animated guide canvas under `root`, `time` ms into its loop. */
export function animateGuideArt(root, time) {
  for (const canvas of root.querySelectorAll('canvas[data-guide-art]')) ANIMATED[canvas.dataset.guideArt]?.(canvas, time);
}

/** Static examples deliberately do not reveal the daily edition's disguises. */
export function drawGuideArt(root = document) {
  for (const canvas of root.querySelectorAll('canvas[data-guide-art]')) {
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const kind = canvas.dataset.guideArt;
    // Animated explainers start on a still frame that reads on its own.
    if (ANIMATED[kind]) { ANIMATED[kind](canvas); continue; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (kind.startsWith('move-')) {
      ctx.scale(canvas.width / 200, canvas.height / 200);
      movement(ctx, kind.slice(5));
    } else if (kind === 'goal' || kind === 'danger') {
      ctx.scale(canvas.width / 400, canvas.height / (kind === 'goal' ? 128 : 100));
      (kind === 'goal' ? goal : danger)(ctx);
    } else {
      const scale = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / SPRITE_SIZE));
      const companion = kind === 'companion';
      sprite(ctx, companion ? 'piece-knight' : kind === 'black-pawn' ? 'piece-pawn' : kind, canvas.width / 2, canvas.height / 2, scale,
        companion ? COMPANION_PALETTE : kind === 'black-pawn' ? piecePalette('black') : kind === 'power-freeze' ? spritePalette('ice') : {});
      if (companion) {
        ctx.fillStyle = '#d5fff1';
        ctx.fillRect(canvas.width - 12, 3, 3, 11);
        ctx.fillRect(canvas.width - 16, 7, 11, 3);
      }
    }
    ctx.restore();
  }
}

const GOLD = '#e6c17a';
const DANGER_FILL = '#903e5166';
const center = (v) => v * 40 + 20;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Progress of a beat that runs from `from` to `to` milliseconds into the loop.
const beat = (time, from, to) => clamp01((time - from) / (to - from));

function burst(ctx, x, y, t, color) {
  if (t <= 0 || t >= 1) return;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const inner = 8 + 10 * t;
    const outer = 14 + 16 * t;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function ghost(ctx, x, y, alpha, palette, color) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.4;
  sprite(ctx, 'piece-pawn', center(x), center(y), 2, palette);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x * 40 + 3, y * 40 + 3, 34, 34);
  ctx.restore();
}

/**
 * One frame of the en passant explainer on a 4x4 board crop, looping every
 * 3.5 s. Your pawn always moves up the board and the enemy pawn moves down.
 * mode 'player': the enemy pawn double-steps past your pawn, then your pawn
 * captures it by moving diagonally into the square it skipped.
 * mode 'enemy': your pawn double-steps past an enemy pawn, which captures you
 * by striking the square you skipped.
 */
export function drawEnPassantDemo(canvas, time, { playerPalette = {}, enemyPalette = {}, mode = 'player' } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const t = ((time % 3500) + 3500) % 3500;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 160, canvas.height / 160);
  board(ctx, 4, 4, 40);
  const lerp = (a, b, p) => a + (b - a) * ease(p);
  if (mode === 'enemy') {
    // Enemy waits at (2,1); your pawn jumps (1,3) -> (1,1), skipping (1,2).
    const jump = beat(t, 400, 1100);
    const mark = beat(t, 1100, 1400) * (1 - beat(t, 3000, 3300));
    const strike = beat(t, 1700, 2200);
    const flash = beat(t, 2200, 2900);
    if (mark > 0) {
      ctx.save();
      ctx.globalAlpha = mark;
      ctx.fillStyle = DANGER_FILL;
      ctx.fillRect(40, 80, 40, 40);
      ctx.restore();
    }
    ghost(ctx, 1, 2, mark * (1 - strike), playerPalette, RED);
    if (mark > 0 && strike < 1) {
      ctx.save();
      ctx.globalAlpha = mark * (1 - strike);
      arrow(ctx, 88, 68, 68, 88, RED, 7);
      ctx.restore();
    }
    const hit = strike >= 1 && flash < 1;
    if (hit) {
      ctx.save();
      ctx.globalAlpha = 1 - flash;
      ctx.fillStyle = RED;
      ctx.fillRect(40, 40, 40, 40);
      ctx.restore();
    }
    // Your pawn is caught where it landed and fades out.
    ctx.save();
    ctx.globalAlpha = 1 - beat(t, 2300, 2900);
    sprite(ctx, 'piece-pawn', center(1), lerp(center(3), center(1), jump), 2, playerPalette);
    ctx.restore();
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, flash * 2) * (1 - beat(t, 3200, 3500));
      sprite(ctx, 'skull', center(1), center(1), 2, spritePalette('rose'));
      ctx.restore();
    }
    burst(ctx, center(1), center(1), beat(t, 2200, 2800), RED);
    // The enemy lunges into the skipped square.
    sprite(ctx, 'piece-pawn', lerp(center(2), center(1), strike), lerp(center(1), center(2), strike), 2, enemyPalette);
  } else {
    // Your pawn waits at (1,2); the enemy jumps (2,0) -> (2,2), skipping (2,1).
    const jump = beat(t, 400, 1100);
    const mark = beat(t, 1100, 1400);
    const move = beat(t, 1700, 2300);
    const gone = beat(t, 2300, 2700);
    ghost(ctx, 2, 1, mark * (1 - move), enemyPalette, MINT);
    if (mark > 0 && move < 1) {
      ctx.save();
      ctx.globalAlpha = mark * (1 - move);
      arrow(ctx, 72, 92, 92, 72, MINT, 7);
      ctx.restore();
    }
    if (gone < 1) {
      ctx.save();
      if (move >= 1) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 1 - gone;
        ctx.strokeRect(83, 83, 34, 34);
      }
      ctx.globalAlpha = 1 - gone;
      sprite(ctx, 'piece-pawn', center(2), lerp(center(0), center(2), jump), 2, enemyPalette);
      ctx.restore();
    }
    burst(ctx, center(2), center(2), gone, GOLD);
    sprite(ctx, 'piece-pawn', lerp(center(1), center(2), move), lerp(center(2), center(1), move), 2, playerPalette);
  }
  ctx.restore();
}

/** A representative still for prefers-reduced-motion: the skipped square marked. */
export const EN_PASSANT_STILL = 1500;

// The recruit's look in the guide: mint pieces on a mint ring, like the board.
function recruitRing(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = MINT;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 14, 5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * One frame of the castling explainer on a 6x3 board crop, looping every
 * 3.5 s: your king and your recruit rook (or your rook and recruit king) stand
 * two squares apart; the king slides two squares toward the rook, and the rook
 * hops over to land on the square the king crossed. The crop keeps its shape
 * on any canvas, centered.
 */
export function drawCastleDemo(canvas, time, { playerPalette = {}, player = 'king' } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const t = ((time % 3500) + 3500) % 3500;
  const scale = Math.min(canvas.width / 240, canvas.height / 120);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate((canvas.width - 240 * scale) / 2, (canvas.height - 120 * scale) / 2);
  ctx.scale(scale, scale);
  board(ctx, 6, 3, 40);
  // King (1,1) -> (3,1); rook (4,1) -> (2,1).
  const plan = beat(t, 300, 700) * (1 - beat(t, 1100, 1400));
  const slide = beat(t, 1100, 1800);
  const hop = beat(t, 1800, 2500);
  const reset = beat(t, 3200, 3500);
  if (plan > 0) {
    ctx.save();
    ctx.globalAlpha = plan;
    ctx.fillStyle = MINT;
    for (const x of [2, 3]) { ctx.beginPath(); ctx.arc(center(x), center(1), 5, 0, Math.PI * 2); ctx.fill(); }
    arrow(ctx, center(1) + 10, center(1) - 22, center(3) - 4, center(1) - 22, MINT, 7);
    arrow(ctx, center(4) - 10, center(1) + 22, center(2) + 4, center(1) + 22, GOLD, 7);
    ctx.restore();
  }
  // Fade out at the end of the loop so the pieces return to the start unseen.
  ctx.globalAlpha = 1 - reset;
  const kingX = center(1) + (center(3) - center(1)) * ease(slide);
  const rookX = center(4) + (center(2) - center(4)) * ease(hop);
  const rookY = center(1) - Math.sin(Math.PI * hop) * 30;
  const pieces = [
    { id: 'piece-king', x: kingX, y: center(1), mine: player === 'king' },
    { id: 'piece-rook', x: rookX, y: rookY, mine: player !== 'king' },
  ];
  for (const piece of pieces) {
    if (!piece.mine) recruitRing(ctx, piece.x, center(1));
    sprite(ctx, piece.id, piece.x, piece.y, 2, piece.mine ? playerPalette : COMPANION_PALETTE);
  }
  burst(ctx, center(2), center(1), beat(t, 2500, 3000), GOLD);
  ctx.restore();
}

/** A representative still for prefers-reduced-motion and the guide: both moves marked. */
export const CASTLE_STILL = 900;
