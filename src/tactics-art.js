// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Animated explainers for the tactic rewards (tactics.js): a knight fork and a
// three-capture combo, drawn on a 5x5 board crop like the other guide art.
import { drawSprite, SPRITE_SIZE, spritePalette } from './sprites.js';

const MINT = '#a5e2cc';
const RED = '#ed8b9c';
const GOLD = '#e6c17a';
const FLAME = '#ff9a4a';
const TILE = ['#302a38', '#443747'];
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const beat = (time, from, to) => clamp01((time - from) / (to - from));
const center = (v) => v * 40 + 20;
const lerp = (a, b, p) => a + (b - a) * ease(p);

function sprite(ctx, id, x, y, palette = {}) {
  drawSprite(ctx, id, Math.round(x - SPRITE_SIZE), Math.round(y - SPRITE_SIZE), 2, palette);
}
function board(ctx) {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { ctx.fillStyle = TILE[(x + y) % 2]; ctx.fillRect(x * 40, y * 40, 40, 40); }
}
function ring(ctx, x, y, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x * 40 + 3, y * 40 + 3, 34, 34);
  ctx.restore();
}
function line(ctx, x1, y1, x2, y2, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}
function burst(ctx, x, y, t, color) {
  if (t <= 0 || t >= 1) return;
  ctx.save();
  ctx.globalAlpha = 1 - t;
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
  ctx.globalAlpha = alpha;
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
function frame(canvas, draw) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 200, canvas.height / 200);
  board(ctx);
  draw(ctx);
  ctx.restore();
}

/**
 * One frame of the fork explainer, looping every 4 s: a knight hops to a
 * square that attacks two monsters at once, both light up, and on the next
 * move the knight takes one of them for bonus gold.
 */
export function drawForkDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = ((time % 4000) + 4000) % 4000;
  frame(canvas, (ctx) => {
    // Knight (1,4) -> (2,2); it attacks (0,1) and (4,1), then takes (0,1).
    const hop = beat(t, 300, 900);
    const spot = beat(t, 900, 1200) * (1 - beat(t, 2300, 2500));
    const take = beat(t, 2300, 2900);
    const reset = beat(t, 3700, 4000);
    ctx.globalAlpha = 1 - reset;
    for (const [x, y] of [[0, 1], [4, 1]]) {
      line(ctx, center(2), center(2), center(x), center(y), GOLD, spot * 0.9);
      ring(ctx, x, y, GOLD, spot * (0.7 + 0.3 * Math.sin(t / 90)));
    }
    ctx.globalAlpha = (1 - reset) * (1 - beat(t, 2800, 3000));
    sprite(ctx, 'bat', center(0), center(1), monsterPalette);
    ctx.globalAlpha = 1 - reset;
    sprite(ctx, 'bat', center(4), center(1), monsterPalette);
    burst(ctx, center(0), center(1), beat(t, 2850, 3400), GOLD);
    const fromX = take ? center(2) : center(1), fromY = take ? center(2) : center(4);
    const toX = take ? center(0) : center(2), toY = take ? center(1) : center(2);
    const p = take || hop;
    sprite(ctx, 'piece-knight', lerp(fromX, toX, p), lerp(fromY, toY, p) - Math.sin(Math.PI * p) * 22, playerPalette);
    label(ctx, 'FORK!', 100, 140, GOLD, spot, 30);
    label(ctx, '+2 gold', center(0) + 26, center(1) + 30, GOLD, beat(t, 2900, 3100) * (1 - reset), 20);
    ctx.globalAlpha = 1;
  });
}
/** A still for reduced motion and the guide: both forked monsters lit. */
export const FORK_STILL = 1600;

/**
 * One frame of the combo explainer, looping every 4.4 s: a rook captures on
 * three moves in a row; the counter climbs and the third capture pays.
 */
export function drawComboDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('moss') } = {}) {
  const t = ((time % 4400) + 4400) % 4400;
  frame(canvas, (ctx) => {
    // Rook (0,4) -> (0,2) -> (3,2) -> (3,0), capturing each time.
    const stops = [[0, 4], [0, 2], [3, 2], [3, 0]];
    const legs = [[300, 800], [1200, 1700], [2100, 2600]];
    const reset = beat(t, 4100, 4400);
    ctx.globalAlpha = 1 - reset;
    let at = [center(0), center(4)];
    let count = 0;
    legs.forEach(([from, to], index) => {
      const p = beat(t, from, to);
      const [ax, ay] = stops[index], [bx, by] = stops[index + 1];
      if (p > 0) at = [lerp(center(ax), center(bx), p), lerp(center(ay), center(by), p)];
      if (p >= 1) count = index + 1;
    });
    stops.slice(1).forEach(([x, y], index) => {
      if (count > index) return;
      sprite(ctx, 'bat', center(x), center(y), monsterPalette);
    });
    stops.slice(1).forEach(([x, y], index) => burst(ctx, center(x), center(y), beat(t, legs[index][1], legs[index][1] + 500), index === 2 ? FLAME : RED));
    sprite(ctx, 'piece-rook', at[0], at[1], playerPalette);
    // The counter: a flame that grows with each capture in a row.
    if (count) {
      const hot = count >= 3;
      label(ctx, `🔥 ×${count}`, 160, 172, hot ? FLAME : MINT, 1, hot ? 30 : 24);
    }
    label(ctx, 'COMBO! +1 gold', 100, 120, FLAME, beat(t, 2600, 2800) * (1 - reset), 24);
    ctx.globalAlpha = 1;
  });
}
/** A still for reduced motion and the guide: the third capture's payoff. */
export const COMBO_STILL = 3000;

/** Congratulation copy for the first fork and combo, shown with the art above. */
export const TACTIC_COPY = Object.freeze({
  fork: {
    title: 'You won a fork!',
    text: 'Your piece attacked two monsters at once, so they could not both escape. You took one on your very next move for +2 bonus gold. This is called a ‘fork!’',
    art: 'Animated board: a knight hops to a square that attacks two monsters at once, then captures one of them.',
    draw: drawForkDemo, still: FORK_STILL,
  },
  combo: {
    title: 'Combo!',
    text: 'You captured on three moves in a row. Every capture you keep chaining from here pays +1 bonus gold. Waiting or a move without a capture ends the combo.',
    art: 'Animated board: a rook captures three monsters on three moves in a row while a flame counter climbs to three.',
    draw: drawComboDemo, still: COMBO_STILL,
  },
});
