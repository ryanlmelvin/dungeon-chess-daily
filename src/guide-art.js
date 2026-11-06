// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import { drawSprite, SPRITE_SIZE, spritePalette, piecePalette, COMPANION_PALETTE } from './sprites.js';

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

function movement(ctx, piece) {
  board(ctx, 5, 5, 40);
  const center = { x: 2, y: 2 };
  if (piece === 'pawn') {
    destination(ctx, 2, 1);
    // The top dot is available only for an unobstructed opening double step.
    destination(ctx, 2, 0);
    arrow(ctx, 100, 86, 100, 67, MINT, 7);
    capture(ctx, 1, 1);
    capture(ctx, 3, 1);
    arrow(ctx, 87, 87, 76, 76, RED, 7);
    arrow(ctx, 113, 87, 124, 76, RED, 7);
  } else if (piece === 'knight') {
    for (const [dx, dy] of [[-2,-1],[-1,-2],[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1]]) {
      destination(ctx, center.x + dx, center.y + dy);
    }
    sprite(ctx, 'prop-crate', 100, 60);
  } else if (piece === 'king') {
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
      if (x !== 2 || y !== 2) destination(ctx, x, y);
    }
  } else {
    const directions = [];
    if (piece !== 'bishop') directions.push([0,-1],[-1,0],[1,0],[0,1]);
    if (piece !== 'rook') directions.push([-1,-1],[1,-1],[-1,1],[1,1]);
    for (const [dx, dy] of directions) {
      for (let step = 1; step <= 2; step++) {
        const x = center.x + dx * step;
        const y = center.y + dy * step;
        if (piece === 'rook' && x === 3 && y === 2) break;
        destination(ctx, x, y);
      }
    }
    if (piece === 'rook') sprite(ctx, 'prop-crate', 140, 100);
  }
  sprite(ctx, `piece-${piece}`, 100, 100);
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
  // A complete matching target group reveals the same stair silhouette as play.
  arrow(ctx, 196, 64, 254, 64, MINT, 12);
  ctx.fillStyle = '#2f514b';
  ctx.fillRect(284, 18, 96, 92);
  ctx.fillStyle = INK;
  ctx.fillRect(294, 28, 76, 72);
  ctx.fillStyle = MINT;
  for (let step = 0; step < 4; step++) {
    const width = 26 + step * 12;
    ctx.fillRect(332 - width / 2, 39 + step * 14, width, 5);
  }
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
