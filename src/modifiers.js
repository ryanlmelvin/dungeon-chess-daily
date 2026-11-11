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
// - collapse: every few player moves on a floor one more monster (a decoy
//   role, never a pawn, and only while that role has room under a chess
//   army's counts) walks in at the door square, up to a cap per floor. If
//   someone stands there it comes in on the nearest empty square instead: an
//   arrival never waits.
//
// This module imports nothing from rules.js, so edition.js can use it too.
import { hash, random } from './random.js';
import { PIECE_COUNTS } from './pieces.js';

// The floor's own seed (src/rules.js floorSeed, which this module can't import).
const roomSeed = (state) => state.floorSeeds?.[state.floor] ?? state.seed;

export const MODIFIERS = Object.freeze({
  none: Object.freeze({ id: 'none', emoji: '', name: 'Plain', headline: '', explain: '', changesRules: false }),
  ice: Object.freeze({
    id: 'ice', emoji: '🧊', name: 'Ice', changesRules: true,
    headline: 'Cold snap glazes the dungeon: long moves that end on ice skid one square further',
    explain: 'Ice: a rook, bishop or queen, or a pawn moving straight, that ends a move on ice skids one more square if it’s open. Captures stop you. Monsters never slide.',
  }),
  // Shown as Breach: the cracking ceiling belongs to the cave-in (src/cave-in.js).
  collapse: Object.freeze({
    id: 'collapse', emoji: '🧱', name: 'Breach', changesRules: true,
    headline: 'A crypt wall gives way: fresh monsters stumble through the door every ten moves',
    explain: 'Breach: every 10 moves on a floor, a new monster walks in at the door. If someone is standing there, it squeezes in on the nearest empty square instead. At most 3 per floor, none once the stairs open. They aren’t targets, but they pay when taken.',
  }),
});
// Uniform over these, so about half the days stay plain. The second slot was
// Dark (retired: it hid the board, which took the planning out of a day); its
// days became plain, so every other date keeps its draw and its dungeon.
const DRAW = ['none', 'none', 'ice', 'collapse'];
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
  if (state.modifier === 'collapse') { state.reinforcements = 0; state.reinforcementsSkipped = 0; }
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

/** Moves on this floor so far, and how many reinforcements are due by now. */
export function collapseDue(state) {
  const moves = state.turns - (state.floorStart?.turns ?? 0);
  return Math.min(COLLAPSE_CAP, Math.floor(moves / COLLAPSE_EVERY));
}

/**
 * Who the floor's n-th reinforcement may be, most preferred first: its two
 * decoy species, alternating, never a pawn (a pawn at the door could never
 * leave a pawn player's promotion file) or the target. Each is built as the
 * monster that would enter, so save validation can recognise any of them.
 */
export function reinforcementOptions(state, n) {
  const decoys = [state.species[3 + state.floor * 2], state.species[4 + state.floor * 2]]
    .filter((creature) => creature && creature.piece !== 'pawn' && creature.piece !== state.targets[state.floor]);
  const first = n % Math.max(1, decoys.length);
  return [...decoys.slice(first), ...decoys.slice(0, first)].map((creature) => ({
    id: `f${state.floor}-r${n}`, species: creature.id, palette: creature.palette, name: creature.name,
    piece: creature.piece, role: creature.piece, x: state.exit.x, y: state.exit.y, moved: false, phase: 'ready', intent: [], target: null,
  }));
}

// Living monsters already holding this role. Only pawns promote, so a promoted
// pawn counts against both the pawns and the queens: the board never shows a
// second queen from the door either.
function onBoard(state, piece) { return state.enemies.filter((foe) => foe.piece === piece || foe.role === piece).length; }

/**
 * The floor's n-th reinforcement, before it enters: the first option whose role
 * still has room under a chess army's counts (one king, one queen, two of each
 * other piece; the same limit the generator keeps), or null if none has room.
 */
export function reinforcement(state, n) {
  return reinforcementOptions(state, n).find((foe) => onBoard(state, foe.piece) < PIECE_COUNTS[foe.piece]) ?? null;
}

/**
 * Where the floor's n-th reinforcement comes in: the door square, or, when the
 * player, the recruit or a monster stands there, the nearest square (in king
 * steps from the door square) that is open and holds none of them, a tie
 * settled by the day's seed. Null only on a board with no such square left.
 * On a composed day (src/composer.js, the dev preview) no monster ever stands
 * on a pawn player's file, so an arrival comes in off it, the door square too.
 */
export function arrivalSquare(state, n) {
  const door = { x: state.exit.x, y: state.exit.y };
  const lane = state.composed && state.player.piece === 'pawn' ? state.player.x : null;
  if (open(state, door.x, door.y) && !occupied(state, door) && door.x !== lane) return door;
  let best = null;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (!open(state, x, y) || occupied(state, { x, y }) || x === lane) continue;
    const steps = Math.max(Math.abs(x - door.x), Math.abs(y - door.y));
    const tie = hash(`${roomSeed(state)}:arrival:${state.floor}:${n}:${x},${y}`);
    if (!best || steps < best.steps || (steps === best.steps && tie < best.tie)) best = { x, y, steps, tie };
  }
  return best && { x: best.x, y: best.y };
}

/**
 * End of a player's turn: a due reinforcement enters at once, at the door
 * square or the nearest empty one (arrivalSquare); it never waits. It doesn't
 * strike as it lands: like any monster that comes into range, it only winds up
 * on its next turn. If every role it could take is full then (or, on a packed
 * board, no square is empty), it is called off instead: it still counts toward
 * the floor's cap, and the next one keeps its own time.
 */
export function collapseTick(state) {
  if (state.modifier !== 'collapse' || state.status !== 'playing' || state.exit.open) return;
  const spawned = state.reinforcements ?? 0, skipped = state.reinforcementsSkipped ?? 0;
  if (spawned + skipped >= collapseDue(state)) return;
  const foe = reinforcement(state, spawned);
  const square = foe && arrivalSquare(state, spawned);
  if (!square) {
    state.reinforcementsSkipped = skipped + 1;
    state.message = `${state.message ? `${state.message} ` : ''}The door rattles, but nothing comes through.`;
    return;
  }
  // Beside the door: someone stands on its square, or (a composed day) it lies on a pawn player's file.
  const aside = !same(square, state.exit), blocked = aside && (!open(state, state.exit.x, state.exit.y) || occupied(state, state.exit));
  foe.x = square.x; foe.y = square.y;
  state.enemies.push(foe);
  state.reinforcements = spawned + 1;
  state.events.push({ type: 'reinforcement', id: foe.id, x: foe.x, y: foe.y });
  state.message = `${state.message ? `${state.message} ` : ''}${blocked ? `The door is blocked, so ${foe.name} squeezes in nearby.` : aside ? `${foe.name} stumbles in beside the door.` : `${foe.name} stumbles in through the door.`}`;
}

/** Extra monsters a floor may hold under this modifier (for save bounds). */
export function extraPopulation(modifier) { return modifier === 'collapse' ? COLLAPSE_CAP : 0; }

/** Checks the modifier's own save fields against a freshly set-up template floor. */
export function validModifierState(value, template) {
  if (JSON.stringify(value.ice) !== JSON.stringify(template.ice)) return false;
  if (value.modifier !== 'collapse') return value.reinforcements === undefined && value.reinforcementsSkipped === undefined;
  // Saves from before called-off arrivals have no skip count.
  const count = value.reinforcements, skipped = value.reinforcementsSkipped ?? 0;
  return Number.isInteger(count) && count >= 0 && Number.isInteger(skipped) && skipped >= 0 && count + skipped <= collapseDue(value);
}

/** Short in-game label, e.g. "🧊 Ice" or "🧱 Next arrival in 4". */
export function modifierStatus(state) {
  const modifier = modifierOf(state);
  if (modifier.id === 'none') return '';
  if (modifier.id !== 'collapse' || state.exit?.open) return `${modifier.emoji} ${modifier.name}`;
  const spawned = state.reinforcements ?? 0, slots = spawned + (state.reinforcementsSkipped ?? 0);
  if (slots >= COLLAPSE_CAP) return `${modifier.emoji} Door quiet`;
  // Every role the next arrival could take is full right now: promise nothing.
  if (!reinforcement(state, spawned)) return `${modifier.emoji} Door quiet for now`;
  const moves = state.turns - (state.floorStart?.turns ?? 0);
  // Arrivals never wait at the door any more. One already due (a save from when
  // they did) comes in at the end of your next move.
  return `${modifier.emoji} Next arrival in ${Math.max(1, COLLAPSE_EVERY * (slots + 1) - moves)}`;
}
