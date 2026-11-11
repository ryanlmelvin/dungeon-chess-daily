// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Pictures for the deduction loop: the hint cards (the target's mugshot, the
// danger map) and the guide's unmasking example.
import { drawSprite, spritePalette, piecePalette, SPRITE_SIZE, SPRITES, PALETTE, haloed, PIECE_HALO, DANGER_HATCH } from './sprites.js';

const WALL = '#302a36';
const MARK = '#4a4150';
const TILE = ['#302a38', '#443747'];
const MINT = '#a5e2cc';
const GOLD = '#e6c17a';

/** A suspect against a lineup wall with height marks, `scale` pixels per sprite pixel. */
function drawMugshot(ctx, creature, scale = 2) {
  if (!ctx) return;
  const size = SPRITE_SIZE * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = MARK;
  for (let y = 3 * scale; y < size; y += 4 * scale) ctx.fillRect(0, y, size, Math.max(1, scale >> 1));
  drawSprite(ctx, creature.id, 0, 0, scale, spritePalette(creature.palette));
}

/** The "Identify the target" hint card: the target species, full size. */
export function drawTargetCard(canvas, creature) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMugshot(ctx, creature, Math.floor(Math.min(canvas.width, canvas.height) / SPRITE_SIZE));
}

// The board's danger-map hatch on one cell (renderer.js draws the same pattern).
function hatch(ctx, x, y, cell) {
  const pixel = cell / 16;
  for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) {
    ctx.fillStyle = (u + v) % DANGER_HATCH.period < DANGER_HATCH.band ? DANGER_HATCH.light : DANGER_HATCH.dark;
    ctx.fillRect(x + u * pixel, y + v * pixel, pixel, pixel);
  }
}

/** The danger-map hint card: a monster's close range hatched on a small board. */
export function drawDangerCard(canvas, { playerPalette = {} } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 200, canvas.height / 200);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    ctx.fillStyle = TILE[(x + y) % 2];
    ctx.fillRect(x * 40, y * 40, 40, 40);
    if (Math.max(Math.abs(x - 2), Math.abs(y - 2)) === 1) hatch(ctx, x * 40, y * 40, 40);
  }
  drawSprite(ctx, 'bat', 80, 80, 2, spritePalette('violet'));
  drawSprite(ctx, 'piece-rook', 0, 160, 2, playerPalette);
  ctx.restore();
}

// A black piece as the board draws it: dark, with a pale halo (sprites.js haloed).
function blackPiece(ctx, piece, x, y, scale) {
  const palette = { ...PALETTE, ...piecePalette('black'), k: PIECE_HALO };
  haloed(SPRITES[`piece-${piece}`]).forEach((row, v) => [...row].forEach((key, u) => {
    if (!palette[key]) return;
    ctx.fillStyle = palette[key];
    ctx.fillRect(x + u * scale, y + v * scale, scale, scale);
  }));
}

/** The guide's example: a captured monster's rook pops out, and its look-alikes wear a rook badge. */
export function drawUnmaskExample(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 400, canvas.height / 100);
  for (let x = 0; x < 10; x++) { ctx.fillStyle = TILE[x % 2]; ctx.fillRect(x * 40, 56, 40, 40); }
  const gremlin = spritePalette('moss');
  // Captured: the true piece rises out of its square in a gold flash.
  ctx.globalAlpha = 0.35;
  drawSprite(ctx, 'dragon', 40, 52, 2, gremlin);
  ctx.globalAlpha = 1;
  blackPiece(ctx, 'rook', 40, 6, 2);
  ctx.fillStyle = GOLD;
  for (const [x, y, w, h] of [[32, 18, 6, 2], [82, 18, 6, 2], [59, 0, 2, 5], [36, 40, 5, 2], [79, 40, 5, 2]]) ctx.fillRect(x, y, w, h);
  // From then on, every look-alike wears the piece as a badge.
  ctx.strokeStyle = MINT; ctx.fillStyle = MINT; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(116, 66); ctx.lineTo(156, 66); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(164, 66); ctx.lineTo(154, 60); ctx.lineTo(154, 72); ctx.closePath(); ctx.fill();
  for (const x of [200, 280]) {
    drawSprite(ctx, 'dragon', x, 52, 2, gremlin);
    blackPiece(ctx, 'rook', x - 4, 36, 1);
  }
  ctx.restore();
}
