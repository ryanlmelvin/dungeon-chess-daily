// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Room modifiers: one per edition, seeded by its date, applying to all three
// floors. The modifier is part of the game state (state.modifier, absent on
// plain days), so the fairness solver and verifier play under it too.
//
// - ice: some floor tiles are ice. The player's slider (rook, bishop, queen, or
//   a pawn moving straight) ending a non-capturing move on ice slides one more
//   square the same way if that square is open and empty. Monsters and
//   recruits are sure-footed: only the player's piece slides.
// - cracks (Crumbling floor, src/cracks.js): a cracked tile falls away when the
//   piece standing on it steps off, and the pit it leaves blocks like a wall.
// - gates (src/gates.js): gate squares shut one move and open the next; shut,
//   a gate blocks like a wall.
//   Both are moving terrain, one seam for the whole engine (src/terrain.js),
//   and a room lays its own tiles or gates (src/composer.js "Terrain floors").
//
// Retired: Dark (it hid the board, which took the planning out of a day) and
// Breach (a monster in at the door every ten moves, which never came on a
// floor of three or four moves). Dark's days became plain; Breach's are the
// two terrain modifiers' (modifierFor).
//
// This module imports nothing from rules.js, so edition.js can use it too.
import { hash, random } from './random.js';
import { setupCracks, validCracks } from './cracks.js';
import { setupGates, validGates } from './gates.js';
import { maskOf, shutSquares } from './terrain.js';

// The floor's own seed (src/rules.js floorSeed, which this module can't import).
const roomSeed = (state) => state.floorSeeds?.[state.floor] ?? state.seed;

export const MODIFIERS = Object.freeze({
  none: Object.freeze({ id: 'none', emoji: '', name: 'Plain', headline: '', explain: '', changesRules: false }),
  ice: Object.freeze({
    id: 'ice', emoji: '🧊', name: 'Ice', changesRules: true,
    headline: 'Cold snap glazes the dungeon: long moves that end on ice skid one square further',
    explain: 'Ice: a rook, bishop or queen, or a pawn moving straight, that ends a move on ice skids one more square if it’s open. Captures stop you. Monsters never slide.',
  }),
  cracks: Object.freeze({
    id: 'cracks', emoji: '🕳️', name: 'Crumbling floor', changesRules: true,
    headline: 'Masons condemn the flagstones: a cracked tile falls away behind whoever steps off it',
    explain: 'Crumbling floor: a cracked tile falls away when the piece standing on it steps off, yours or a monster’s. The pit it leaves blocks like a wall; knights jump it.',
  }),
  gates: Object.freeze({
    id: 'gates', emoji: '⛓️', name: 'Gates', changesRules: true,
    headline: 'Gatekeeper keeps strict time: every gate shuts one move and opens the next',
    explain: 'Gates: shut, a gate blocks like a wall; open, it is floor. Every gate changes after every move, once every piece has moved: shut now, open next. A gate never shuts on a piece.',
  }),
});
/** The modifiers that are moving terrain (src/terrain.js): a room lays its own tiles or gates for them. */
export const TERRAIN_MODIFIERS = Object.freeze(['cracks', 'gates']);
// Uniform over these, so about half the days stay plain. The second slot was
// Dark; its days became plain, so every other date keeps its draw and its
// dungeon. The fourth was Breach; its days are moving terrain (terrainFor).
const DRAW = ['none', 'none', 'ice', 'terrain'];
export const ICE_TILES = 8;

// A terrain day's modifier. A bishop's day is gates: cracked tiles seldom
// matter to a bishop's floors (39% of them composed around the tiles, against
// 89% around gates; docs/generation.md). Any other piece's day is one or the
// other, evenly, by the date.
function terrainFor(date, piece) {
  if (piece === 'bishop') return 'gates';
  return random(hash(`terrain:${date}`))() < 0.5 ? 'cracks' : 'gates';
}

/**
 * The modifier id of `date`, a day whose piece is `piece` (src/edition.js
 * draws both). Its own hash stream, so no other daily draw moves.
 */
export function modifierFor(date, piece) {
  const drawn = DRAW[Math.floor(random(hash(`modifier:${date}`))() * DRAW.length)];
  return drawn === 'terrain' ? terrainFor(date, piece) : drawn;
}

export function modifierOf(state) { return MODIFIERS[state?.modifier] ?? MODIFIERS.none; }

function same(a, b) { return a.x === b.x && a.y === b.y; }
function inside(x, y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 8 && y < 8; }
function open(state, x, y) { return inside(x, y) && state.map?.[y]?.[x] !== '#'; }
function occupied(state, tile) {
  return state.enemies.some((foe) => same(foe, tile)) || Boolean(state.companion && same(state.companion, tile))
    || same(state.player, tile);
}

/**
 * Per-floor setup, called once a room's walls, monsters and pickups are fixed.
 * Ice uses its own random stream, so the room's layout is unchanged.
 */
export function setupFloorModifier(state) {
  // Moving terrain: the room's own cracked tiles or gates (a room that lays none has none).
  if (state.modifier === 'cracks') setupCracks(state, state.composed?.[state.floor]);
  if (state.modifier === 'gates') setupGates(state, state.composed?.[state.floor]);
  if (state.modifier !== 'ice') return;
  const rng = random(hash(`${roomSeed(state)}:ice:${state.floor}`));
  const candidates = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const tile = { x, y };
    // Never under a wall, a monster, a pickup, the start square or the exit square.
    if (!open(state, x, y) || same(tile, { x: 4, y: 6 }) || same(tile, state.exit)
      || state.enemies.some((foe) => same(foe, tile)) || state.items.some((item) => same(item, tile))) continue;
    candidates.push({ x, y, order: rng() });
  }
  candidates.sort((a, b) => a.order - b.order);
  state.ice = candidates.slice(0, ICE_TILES).map(({ x, y }) => ({ x, y })).sort((a, b) => a.y - b.y || a.x - b.x);
}

export function onIce(state, tile) { return Boolean(state.ice?.some((entry) => same(entry, tile))); }

/**
 * Where the player's move to `move` comes to rest after ice, or null if it
 * stops where clicked. Captures, castling, knights and kings never slide.
 */
export function iceSlide(state, move) {
  if (state?.modifier !== 'ice' || move.castle || move.enPassant || !onIce(state, move)) return null;
  const unit = state.player;
  const dx = move.x - unit.x, dy = move.y - unit.y;
  const slider = ['rook', 'bishop', 'queen'].includes(unit.piece) || (unit.piece === 'pawn' && dx === 0);
  if (!slider || (!dx && !dy) || state.enemies.some((foe) => same(foe, move))) return null;
  const next = { x: move.x + Math.sign(dx), y: move.y + Math.sign(dy) };
  if (!open(state, next.x, next.y) || occupied(state, next)) return null;
  return next;
}

/** Checks the modifier's own save fields against a freshly set-up template floor. */
export function validModifierState(value, template) {
  if (JSON.stringify(value.ice) !== JSON.stringify(template.ice)) return false;
  return validTerrain(value, template);
}

// Moving terrain's own save fields: a day without it carries none of them, and a day with
// it carries its record and the squares that record shuts right now (src/terrain.js).
function validTerrain(value, template) {
  const fields = { cracks: ['cracks', 'pits', 'shut'], gates: ['gates', 'gateTurns', 'shut'] }[value.modifier] ?? [];
  if (['cracks', 'pits', 'gates', 'gateTurns', 'shut'].some((field) => (value[field] !== undefined) !== fields.includes(field))) return false;
  if (!fields.length) return true;
  if (!(value.modifier === 'cracks' ? validCracks(value, template) : validGates(value, template))) return false;
  return JSON.stringify(value.shut) === JSON.stringify(maskOf(shutSquares(value)));
}

/** Short in-game label, e.g. "🧊 Ice". */
export function modifierStatus(state) {
  const modifier = modifierOf(state);
  return modifier.id === 'none' ? '' : `${modifier.emoji} ${modifier.name}`;
}
