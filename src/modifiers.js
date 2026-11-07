// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Room modifiers: one per edition, seeded by its date, applying to all three
// floors. The modifier is part of the game state (state.modifier, absent on
// plain days), so the fairness solver and verifier play under it too.
//
// - dark: the renderer shows only squares near the player and around monsters
//   that are winding up. The rules are unchanged.
// - ice: some floor tiles are ice. The player's slider (rook, bishop, queen, or
//   a pawn moving straight) ending a non-capturing move on ice slides one more
//   square the same way if that square is open and empty. Monsters and
//   recruits are sure-footed: only the player's piece slides.
// - collapse: every few player moves on a floor one more monster (a decoy
//   role, never a pawn) walks in at the door square, up to a cap per floor.
//
// This module imports nothing from rules.js, so edition.js can use it too.
import { hash, random } from './random.js';

export const MODIFIERS = Object.freeze({
  none: Object.freeze({ id: 'none', emoji: '', name: 'Plain', headline: '', explain: '', changesRules: false }),
  // Dark changes only what is drawn, so it shares plain days' fallback dungeons.
  dark: Object.freeze({
    id: 'dark', emoji: '🌑', name: 'Dark', changesRules: false,
    headline: 'Lamps fail below: crawlers see two squares, and only a monster’s wind-up lights the gloom',
    explain: 'Dark: you see only squares within 2 of your piece. A monster winding up lights itself and its path. The rules don’t change.',
  }),
  ice: Object.freeze({
    id: 'ice', emoji: '🧊', name: 'Ice', changesRules: true,
    headline: 'Cold snap glazes the dungeon: long moves that end on ice skid one square further',
    explain: 'Ice: a rook, bishop or queen, or a pawn moving straight, that ends a move on ice skids one more square if it’s open. Captures stop you. Monsters never slide.',
  }),
  collapse: Object.freeze({
    id: 'collapse', emoji: '🪨', name: 'Collapse', changesRules: true,
    headline: 'Ceiling cracks above the crypt: fresh monsters stumble through the door every ten moves',
    explain: 'Collapse: every 10 moves on a floor, a new monster walks in at the door, or waits there until it’s free. At most 3 per floor, none once the stairs open. They aren’t targets, but they pay when taken.',
  }),
});
// Uniform over these, so about one day in four stays plain.
const DRAW = ['none', 'dark', 'ice', 'collapse'];
export const ICE_TILES = 8;
export const COLLAPSE_EVERY = 10;
export const COLLAPSE_CAP = 3;

/** The date's modifier id. Its own hash stream, so no other daily draw moves. */
export function modifierFor(date) {
  return DRAW[Math.floor(random(hash(`modifier:${date}`))() * DRAW.length)];
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
  if (state.modifier === 'collapse') state.reinforcements = 0;
  if (state.modifier !== 'ice') return;
  const rng = random(hash(`${state.dungeonSeed ?? state.seed}:ice:${state.floor}`));
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

/** Moves on this floor so far, and how many reinforcements are due by now. */
export function collapseDue(state) {
  const moves = state.turns - (state.floorStart?.turns ?? 0);
  return Math.min(COLLAPSE_CAP, Math.floor(moves / COLLAPSE_EVERY));
}

/** The floor's n-th reinforcement, before it enters: a copy of a decoy species. */
export function reinforcement(state, n) {
  const decoys = [state.species[3 + state.floor * 2], state.species[4 + state.floor * 2]]
    // A pawn at the door could never leave a pawn player's promotion file.
    .filter((creature) => creature && creature.piece !== 'pawn' && creature.piece !== state.targets[state.floor]);
  const creature = decoys[n % decoys.length];
  if (!creature) return null;
  return {
    id: `f${state.floor}-r${n}`, species: creature.id, palette: creature.palette, name: creature.name,
    piece: creature.piece, role: creature.piece, x: state.exit.x, y: state.exit.y, moved: false, phase: 'ready', intent: [], target: null,
  };
}

/** End of a player's turn: a due reinforcement enters if the door square is free. */
export function collapseTick(state) {
  if (state.modifier !== 'collapse' || state.status !== 'playing' || state.exit.open) return;
  const spawned = state.reinforcements ?? 0;
  if (spawned >= collapseDue(state) || occupied(state, state.exit)) return;
  const foe = reinforcement(state, spawned);
  if (!foe) return;
  state.enemies.push(foe);
  state.reinforcements = spawned + 1;
  state.events.push({ type: 'reinforcement', id: foe.id, x: foe.x, y: foe.y });
  state.message = `${state.message ? `${state.message} ` : ''}The ceiling groans: ${foe.name} stumbles in through the door.`;
}

/** Extra monsters a floor may hold under this modifier (for save bounds). */
export function extraPopulation(modifier) { return modifier === 'collapse' ? COLLAPSE_CAP : 0; }

/** Checks the modifier's own save fields against a freshly set-up template floor. */
export function validModifierState(value, template) {
  if (JSON.stringify(value.ice) !== JSON.stringify(template.ice)) return false;
  if (value.modifier !== 'collapse') return value.reinforcements === undefined;
  const count = value.reinforcements;
  return Number.isInteger(count) && count >= 0 && count <= collapseDue(value);
}

/** Short in-game label, e.g. "🧊 Ice" or "🪨 Next arrival in 4". */
export function modifierStatus(state) {
  const modifier = modifierOf(state);
  if (modifier.id === 'none') return '';
  if (modifier.id !== 'collapse' || state.exit?.open) return `${modifier.emoji} ${modifier.name}`;
  const spawned = state.reinforcements ?? 0;
  if (spawned >= COLLAPSE_CAP) return `${modifier.emoji} Door quiet`;
  const moves = state.turns - (state.floorStart?.turns ?? 0);
  const due = collapseDue(state);
  if (due > spawned) return `${modifier.emoji} Arrival waiting at the door`;
  return `${modifier.emoji} Next arrival in ${COLLAPSE_EVERY * (spawned + 1) - moves}`;
}

// ---- Dark: rendering only ----

export const DARK_SIGHT = 2;

/** Squares the player can see in the dark, as "x,y" keys. Every square otherwise. */
export function visibleSquares(state) {
  const seen = new Set();
  if (state?.modifier !== 'dark') {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(`${x},${y}`);
    return seen;
  }
  const light = (center, radius) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (inside(center.x + dx, center.y + dy)) seen.add(`${center.x + dx},${center.y + dy}`);
    }
  };
  light(state.player, DARK_SIGHT);
  // A monster winding up lights itself, its surroundings and its whole attack path.
  for (const foe of state.enemies) if (foe.phase === 'aim') {
    light(foe, 1);
    for (const tile of foe.intent ?? []) seen.add(`${tile.x},${tile.y}`);
  }
  return seen;
}

/**
 * Remembered monsters in the dark: id -> where it was last seen. Monsters in
 * sight update their entry; a captured monster, or one whose remembered square
 * is now in sight and empty, is forgotten. Returns a new Map.
 */
export function updateSightings(memory, state, visible = visibleSquares(state)) {
  const next = new Map();
  for (const [id, ghost] of memory) {
    const foe = state.enemies.find((entry) => entry.id === id);
    if (!foe || visible.has(`${ghost.x},${ghost.y}`)) continue;
    next.set(id, ghost);
  }
  for (const foe of state.enemies) {
    if (visible.has(`${foe.x},${foe.y}`)) next.set(foe.id, { x: foe.x, y: foe.y, species: foe.species, palette: foe.palette });
  }
  return next;
}

/** Ghosts to draw: remembered monsters not currently in sight. */
export function ghostsFrom(memory, state, visible = visibleSquares(state)) {
  return [...memory.entries()]
    .filter(([id]) => { const foe = state.enemies.find((entry) => entry.id === id); return !foe || !visible.has(`${foe.x},${foe.y}`); })
    .map(([id, ghost]) => ({ id, ...ghost }));
}
