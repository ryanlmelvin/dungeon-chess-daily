// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import { drawSprite, SPRITE_SIZE, STONE_SIZE, paintStone, spritePalette, piecePalette, COMPANION_PALETTE } from './sprites.js';

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
  // A complete matching target group reveals the stairwell exactly as play draws it
  // (renderer.js): a faint glow over a dark well on the exit's red stone, with four white steps.
  arrow(ctx, 196, 64, 254, 64, MINT, 12);
  const size = STONE_SIZE * 4;
  const left = 284;
  const top = 16;
  const stone = document.createElement('canvas');
  stone.width = stone.height = STONE_SIZE;
  paintStone(stone.getContext('2d'), true, 0);
  ctx.drawImage(stone, left, top, size, size);
  const mark = (cx, cy, width, height, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(left + (0.5 + cx - width / 2) * size), Math.round(top + (0.5 + cy - height / 2) * size), Math.round(width * size), Math.round(height * size));
  };
  mark(0, 0, 0.76, 0.84, '#0d0910');
  mark(0, 0, 0.9, 0.9, 'rgba(195, 239, 220, 0.2)');
  for (let i = 0; i < 4; i++) mark(0, -0.25 + i * 0.16, 0.25 + i * 0.1, 0.055, '#eee8e1');
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

/** Static examples deliberately do not reveal the daily edition's disguises. */
export function drawGuideArt(root = document) {
  for (const canvas of root.querySelectorAll('canvas[data-guide-art]')) {
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const kind = canvas.dataset.guideArt;
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
