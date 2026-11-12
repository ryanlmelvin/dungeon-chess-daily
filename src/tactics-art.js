// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Animated explainers for the tactic rewards (tactics.js): a knight fork and a
// three-capture combo, drawn on a 5x5 board crop like the other guide art. The
// off-balance punish (a missed lunge, rules.js) and the cave-in countdown
// (cave-in.js) are drawn the same way.
import { drawSprite, SPRITE_SIZE, spritePalette, COMPANION_PALETTE } from './sprites.js';

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
function frame(canvas, draw, [dx, dy] = [0, 0]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(canvas.width / 200, canvas.height / 200);
  ctx.translate(dx, dy);
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
// A small four-point sparkle, outlined so it reads on any tile.
function sparkle(ctx, x, y, size) {
  ctx.fillStyle = '#100f14';
  ctx.fillRect(x - 2, y - size - 1, 4, size * 2 + 2);
  ctx.fillRect(x - size - 1, y - 2, size * 2 + 2, 4);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x - 1, y - size, 2, size * 2);
  ctx.fillRect(x - size, y - 1, size * 2, 2);
  ctx.fillStyle = '#fff3c4';
  ctx.fillRect(x - 1, y - 1, 2, 2);
}
/** Stars circling above a dizzy monster's head, `time` ms into their spin. */
function dizzy(ctx, x, y, time) {
  for (let i = 0; i < 3; i++) {
    const angle = time / 170 + i * Math.PI * 2 / 3;
    sparkle(ctx, Math.round(x + Math.cos(angle) * 16), Math.round(y - 25 + Math.sin(angle) * 5), Math.sin(angle) < 0 ? 4 : 5);
  }
}

/**
 * One frame of the off-balance explainer, looping every 5.6 s: a monster winds
 * up on your rook, the rook sidesteps, the monster lunges into the empty square
 * and wobbles with stars over its head, and the rook captures it.
 */
export function drawOffBalanceDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = ((time % 5600) + 5600) % 5600;
  frame(canvas, (ctx) => {
    // Monster (2,0) aims down at the rook (2,3); the rook steps to (0,3).
    const windUp = beat(t, 300, 700) * (1 - beat(t, 2100, 2400));
    const sidestep = beat(t, 1500, 2000);
    const lunge = beat(t, 2100, 2450);
    const landed = t >= 2450;
    const take = beat(t, 3900, 4400);
    const reset = beat(t, 5300, 5600);
    const pulse = 0.75 + 0.25 * Math.sin(t / 120);
    if (windUp > 0) {
      ctx.save();
      ctx.globalAlpha = windUp * 0.45 * pulse;
      ctx.fillStyle = RED;
      for (const y of [1, 2, 3]) ctx.fillRect(80 + 2, y * 40 + 2, 36, 36);
      ctx.restore();
      line(ctx, center(2), center(0) + 14, center(2), center(3), RED, windUp * pulse);
    }
    // Your chance: a mint line from the rook to the dizzy monster.
    line(ctx, center(0) + 16, center(3), center(2) - 16, center(3), MINT, beat(t, 3000, 3300) * (1 - take));
    ctx.globalAlpha = (1 - reset) * (1 - beat(t, 4400, 4600));
    const monsterY = lerp(center(0), center(3), lunge);
    if (landed) {
      ctx.save();
      ctx.translate(center(2), center(3) + 16);
      ctx.rotate(Math.sin(t / 110) * 0.22 * (1 - take));
      sprite(ctx, 'bat', 0, -16, monsterPalette);
      ctx.restore();
      if (take < 1) dizzy(ctx, center(2), center(3), t);
    } else sprite(ctx, 'bat', center(2), monsterY, monsterPalette);
    ctx.globalAlpha = 1 - reset;
    burst(ctx, center(2), center(3), beat(t, 4400, 4900), GOLD);
    const rookX = take ? lerp(center(0), center(2), take) : lerp(center(2), center(0), sidestep);
    sprite(ctx, 'piece-rook', rookX, center(3), playerPalette);
    label(ctx, 'OFF-BALANCE!', 100, 182, GOLD, beat(t, 2500, 2700) * (1 - beat(t, 4400, 4600)), 26);
    ctx.globalAlpha = 1;
  });
}
/** A still for reduced motion and the guide: the dizzy monster, open to capture. */
export const OFF_BALANCE_STILL = 3400;

/**
 * One frame of the recruit explainer, looping every 5.6 s: a monster's line
 * passes straight through a recruit waiting in its green ring; your rook
 * steps onto it, it turns solid and joins you, then moves after you and
 * blocks the monster's line.
 */
export function drawRecruitDemo(canvas, time, { playerPalette = {}, monsterPalette = spritePalette('violet') } = {}) {
  const t = ((time % 5600) + 5600) % 5600;
  frame(canvas, (ctx) => {
    // Monster (4,2) eyes the row; the rook (0,2) slides to the recruit (2,2),
    // which then steps to (3,2) between the monster and the rook.
    const slide = beat(t, 1600, 2200);
    const join = beat(t, 2200, 2500);
    const step = beat(t, 3300, 3800);
    const reset = beat(t, 5300, 5600);
    const fade = 1 - reset;
    const rookX = lerp(center(0), center(2), slide);
    const recruitX = lerp(center(2) + (slide >= 1 ? 9 : 0), center(3), step);
    const recruitY = center(2) + (slide >= 1 ? 7 : 0) * (1 - step);
    // The monster's line: through the waiting recruit to the rook, then cut short by the ally.
    const before = 1 - beat(t, 1400, 1600);
    const after = beat(t, 3800, 4000);
    const pulse = 0.65 + 0.35 * Math.sin(t / 120);
    line(ctx, center(4), center(2), center(0), center(2), RED, before * pulse * fade);
    line(ctx, center(4), center(2), center(3) + 12, center(2), RED, after * pulse * fade);
    ctx.globalAlpha = fade;
    sprite(ctx, 'bat', center(4), center(2), monsterPalette);
    // The ring and + stay until the recruit has joined.
    const waiting = (1 - join) * fade;
    if (waiting > 0) {
      ctx.save();
      ctx.globalAlpha = waiting;
      ctx.fillStyle = MINT;
      ctx.fillRect(center(2) + 9, center(2) + 12, 9, 3);
      ctx.fillRect(center(2) + 12, center(2) + 9, 3, 9);
      ctx.restore();
      ring(ctx, 2, 2, MINT, waiting * 0.8);
    }
    // The waiting recruit, then the same piece as your ally once you stand on it.
    ctx.globalAlpha = (1 - join) * fade;
    sprite(ctx, 'piece-queen', center(2), center(2) - 4, COMPANION_PALETTE);
    ctx.globalAlpha = join * fade;
    if (join > 0) sprite(ctx, 'piece-queen', recruitX, recruitY, COMPANION_PALETTE);
    ctx.globalAlpha = fade;
    sprite(ctx, 'piece-rook', rookX, center(2), playerPalette);
    burst(ctx, center(2), center(2), beat(t, 2200, 2800), MINT);
    burst(ctx, center(3) + 12, center(2), beat(t, 3800, 4300), MINT);
    label(ctx, 'NOT AN ALLY YET', 100, 150, RED, beat(t, 200, 500) * before, 22);
    label(ctx, 'JOINED!', 100, 150, MINT, beat(t, 2300, 2500) * (1 - beat(t, 3200, 3400)), 26);
    label(ctx, 'BLOCKS THE LINE', 100, 150, MINT, after * fade, 22);
    ctx.globalAlpha = 1;
  });
}
/** A still for reduced motion: the joined recruit blocking the monster's line. */
export const RECRUIT_STILL = 4600;

function dot(ctx, x, y, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(center(x), center(y), 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/**
 * One frame of the bishop pair explainer, looping every 5.6 s: your bishop
 * steps onto a bishop recruit waiting on its own colour, and only that colour
 * lights up: half the board. The recruit hops one square sideways onto the
 * other colour, and the other half lights up too.
 */
export function drawBishopPairDemo(canvas, time, { playerPalette = {} } = {}) {
  const t = ((time % 5600) + 5600) % 5600;
  frame(canvas, (ctx) => {
    // Your bishop (0,4) -> (2,2), onto the recruit; the recruit hops (2,2) -> (3,2).
    const slide = beat(t, 300, 900);
    const join = beat(t, 900, 1100);
    const half = beat(t, 1200, 1600);
    const hop = beat(t, 2300, 2800);
    const whole = beat(t, 2800, 3200);
    const fade = 1 - beat(t, 5300, 5600);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const yours = (x + y) % 2 === 0;
      dot(ctx, x, y, yours ? GOLD : MINT, (yours ? half : whole) * fade);
    }
    ctx.globalAlpha = fade;
    // The ring and + until your bishop arrives, as on the board.
    if (join < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - join) * fade;
      ctx.fillStyle = MINT;
      ctx.fillRect(center(2) + 9, center(2) + 12, 9, 3);
      ctx.fillRect(center(2) + 12, center(2) + 9, 3, 9);
      ctx.restore();
      ring(ctx, 2, 2, MINT, (1 - join) * 0.8 * fade);
    }
    const shared = join > 0 ? 1 - hop : 0;
    sprite(ctx, 'piece-bishop', lerp(center(2), center(3), hop) + 9 * shared, center(2) + 7 * shared - Math.sin(Math.PI * hop) * 24, COMPANION_PALETTE);
    sprite(ctx, 'piece-bishop', lerp(center(0), center(2), slide), lerp(center(4), center(2), slide), playerPalette);
    burst(ctx, center(2), center(2), beat(t, 900, 1400), MINT);
    burst(ctx, center(3), center(2), beat(t, 2800, 3300), MINT);
    label(ctx, 'HALF THE BOARD', 100, 176, GOLD, half * (1 - beat(t, 2200, 2400)) * fade, 22);
    label(ctx, 'HOLY DUO!', 100, 176, MINT, beat(t, 2800, 3000) * fade, 28);
    ctx.globalAlpha = 1;
  });
}
/** A still for reduced motion and the guide: the recruit on the other colour, every square lit. */
export const BISHOP_PAIR_STILL = 4200;

// The open stairs: gold steps going down, lit at the top.
function stairsTile(ctx, x, y) {
  ctx.fillStyle = '#100f14';
  ctx.fillRect(x * 40 + 2, y * 40 + 2, 36, 36);
  ['#d9b45a', '#b0955f', '#8c7650', '#6b5a3e'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * 40 + 6 + i * 3, y * 40 + 6 + i * 8, 28 - i * 6, 5);
  });
}
function coin(ctx, x, y, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = '#100f14';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(center(x), center(y), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
// The ceiling's shakes: [start ms, length ms, strength in px], one as it
// cracks and one after each move, harder as the count runs down.
const SHAKES = [[200, 350, 2], [1300, 350, 3], [2400, 450, 5]];

/**
 * One frame of the cave-in explainer, looping every 6 s: the ceiling cracks
 * and the board shakes; your rook grabs two coins (gold at risk) while the
 * count drops from 3 to 1 and every shake is harder, then it reaches the
 * stairs and banks the gold.
 */
export function drawCaveInDemo(canvas, time, { playerPalette = {} } = {}) {
  const t = ((time % 6000) + 6000) % 6000;
  const shake = SHAKES.find(([from, length]) => t >= from && t < from + length);
  const strength = shake ? shake[2] * (1 - (t - shake[0]) / shake[1]) : 0;
  const offset = [Math.round(Math.sin(t / 13) * strength), Math.round(Math.cos(t / 17) * strength / 2)];
  frame(canvas, (ctx) => {
    // Rook (0,4) -> (0,2) -> (2,2) -> the stairs on (2,0), a coin on each stop.
    const legs = [[900, 1300], [2000, 2400], [3300, 3700]];
    const stops = [[0, 4], [0, 2], [2, 2], [2, 0]];
    const reset = beat(t, 5700, 6000);
    const fade = 1 - reset;
    ctx.globalAlpha = fade;
    stairsTile(ctx, 2, 0);
    coin(ctx, 0, 2, fade * (t < 1300 ? 1 : 0));
    coin(ctx, 2, 2, fade * (t < 2400 ? 1 : 0));
    let at = [center(0), center(4)];
    legs.forEach(([from, to], index) => {
      const p = beat(t, from, to);
      const [ax, ay] = stops[index], [bx, by] = stops[index + 1];
      if (p > 0) at = [lerp(center(ax), center(bx), p), lerp(center(ay), center(by), p)];
    });
    // The rook goes down the stairs.
    ctx.globalAlpha = fade * (1 - beat(t, 3700, 3950));
    sprite(ctx, 'piece-rook', at[0], at[1], playerPalette);
    ctx.globalAlpha = fade;
    burst(ctx, center(2), center(0), beat(t, 3700, 4200), GOLD);
    // Dust shaken loose from the ceiling.
    if (shake) {
      const p = (t - shake[0]) / shake[1];
      ctx.save();
      ctx.globalAlpha = fade * (1 - p);
      ctx.fillStyle = '#b3a58f';
      for (let i = 0; i < shake[2] * 3; i++) ctx.fillRect((i * 53 + shake[0]) % 196, p * (120 + (i % 4) * 25) - 6, 3, 3);
      ctx.restore();
    }
    label(ctx, '+1 AT RISK', center(0) + 34, center(2) - 26, FLAME, beat(t, 1300, 1450) * (1 - beat(t, 1900, 2100)), 20);
    label(ctx, '+1 AT RISK', center(2) + 30, center(2) - 26, FLAME, beat(t, 2400, 2550) * (1 - beat(t, 3000, 3200)), 20);
    const count = t < 1300 ? 3 : t < 2400 ? 2 : 1;
    const counting = beat(t, 200, 400) * (1 - beat(t, 3700, 3800));
    const pulse = count === 1 ? 0.7 + 0.3 * Math.sin(t / 90) : 1;
    label(ctx, count === 1 ? 'TAKE THE STAIRS!' : `CAVING IN ${count}`, 100, 182, FLAME, counting * pulse, count === 1 ? 26 : 24);
    label(ctx, 'GOLD BANKED!', 100, 182, GOLD, beat(t, 3800, 4000) * fade, 28);
    ctx.globalAlpha = 1;
  }, offset);
}
/** A still for reduced motion and the guide: two coins grabbed, one move left. */
export const CAVE_IN_STILL = 3000;

/** The bishop pair's explainer, from its line's What? button, in the same dialog as the tactics. */
export const BISHOP_PAIR_COPY = Object.freeze({
  title: 'Holy duo!',
  text: 'A bishop stays on one square colour all game, so a bishop recruit on your colour could only reach squares you already can. So the turn it joins your bishop, its move is a hop to a side square on the other colour. Now your two bishops stand on opposite colours, and together they cover every square. Chess players call this the ‘bishop pair!’',
  art: 'Animated board: your bishop steps onto a waiting bishop recruit and the squares of its colour light up, half the board. The recruit hops one square sideways onto the other colour, and the rest of the board lights up too.',
  draw: drawBishopPairDemo, still: BISHOP_PAIR_STILL,
});

/** A waiting recruit's explainer, from its line's What? button, in the same dialog as the tactics. */
export const RECRUIT_COPY = Object.freeze({
  title: 'A recruit is waiting',
  text: 'The piece in a green ring with a + is this floor’s recruit. It is not on your side yet, and monster lines pass right through it. Step onto its square to recruit it: it becomes your ally, and from then on it blocks monster lines. After each of your moves you steer it (tap a square marked green, or tap it to stay put), and anything it captures counts, even a target. It can’t capture on the turn it joins. Once the floor is cleared, it hunts on its own.',
  art: 'Animated board: a monster’s line passes through a waiting recruit; a rook steps onto it, the recruit joins, then steps between the monster and the rook to block the line.',
  draw: drawRecruitDemo, still: RECRUIT_STILL,
});

/** Congratulation copy for the first fork and combo, and the off-balance explainer, shown with the art above. */
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
  // Opened from the "What?" button on a missed lunge's message.
  'off-balance': {
    title: 'Off-balance!',
    text: 'You stepped off a monster’s red path, so its lunge missed. Now it’s off-balance until your next move ends: stars circle its head, and it can’t capture you at all, even up close. Bait a lunge, sidestep, then strike!',
    art: 'Animated board: a monster’s red path points at your rook; the rook steps aside, the monster lunges into the empty square and wobbles with stars over its head, and the rook captures it.',
    draw: drawOffBalanceDemo, still: OFF_BALANCE_STILL,
  },
  // The first cracked ceiling on this device, and the "What?" button on its message.
  'cave-in': {
    title: 'The ceiling is cracking!',
    text: 'Opening the door cracks the ceiling, and the stairs button counts the moves until it caves in. Waits count too. Gold you grab from now on is at risk: take the stairs in time to keep it. If the ceiling caves in first, you drop that gold and the rubble carries you down to the shop.',
    art: 'Animated board: the ceiling cracks and the board shakes. A rook grabs two coins while the count drops from 3 to 1 and the shaking grows, then it reaches the stairs and banks the gold.',
    draw: drawCaveInDemo, still: CAVE_IN_STILL,
  },
});
