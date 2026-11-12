// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Press-and-hold inspection: one unmasked monster's squares, alone on the
// board. It tells the player nothing new: it reads only the role the monster's
// badge already shows (rules.js unmask), the board as it stands and the
// monster's own wind-up. A masked monster yields nothing, the paid danger map
// (every monster's true reach) stays a hint, and nothing here changes a game
// or a save.
import { closeAttacker, monsterSquares } from './rules.js';

/** How long the marks stay after a finger lifts, so the hand doesn't hide them. */
export const HOLD_LINGER_MS = 2500;

const same = (a, b) => a.x === b.x && a.y === b.y;
const among = (squares, square) => squares.some((entry) => same(entry, square));
const square = ({ x, y }) => ({ x, y });

/** Is this monster's role known: its species unmasked on this floor, so it wears its piece as a badge? */
export function isUnmasked(state, foe) {
  return Boolean(foe?.species) && (state?.unmasked ?? []).includes(foe.species);
}

/**
 * What inspecting monster `id` shows, or null for a masked monster (or none).
 * Four kinds of square, by its piece and the engine's own blocking rules:
 * - `coming`: "this attack is coming": its wound-up path, which lands next
 *   turn (the squares the board already draws red for it), or none.
 * - `atOnce`: "it can capture you at once": squares where ending a move gets
 *   the player captured by this monster with no warning (closeAttacker, asked
 *   of it alone): beside it where its piece attacks, or a knight's jump away,
 *   a monster it guards there included. None while it is pinned, frozen or
 *   off-balance. Never the square the player stands on: waiting is safe there.
 * - `moves`: the other squares it can move to.
 * - `captures`: the other squares it can capture on but not simply move to:
 *   the player's own square when it has a line on it, a monster it guards from
 *   afar (take that one and it winds up at you), and a pawn's diagonals.
 * `moves` and `captures` leave out the `atOnce` and `coming` squares, which say more.
 */
export function inspectMonster(state, id) {
  const foe = state?.enemies?.find((entry) => entry.id === id);
  if (!foe || !isUnmasked(state, foe)) return null;
  const coming = foe.phase === 'aim' ? (foe.intent ?? []).map(square) : [];
  const alone = { ...state, enemies: [foe] };
  const atOnce = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const here = { x, y };
    if (!same(here, foe) && !same(here, state.player) && closeAttacker(alone, here)) atOnce.push(here);
  }
  const said = (entry) => among(atOnce, entry) || among(coming, entry);
  const steps = monsterSquares(state, foe).filter((move) => !move.capture);
  // A monster it guards: were the player to take that one, would this one attack the square?
  const guarded = state.enemies.filter((other) => other !== foe && among(
    monsterSquares({ ...state, player: { ...state.player, x: other.x, y: other.y }, enemies: state.enemies.filter((entry) => entry !== other) }, foe, true), other));
  const captures = [];
  for (const entry of [...monsterSquares(state, foe, true), ...guarded]) {
    if (!among(steps, entry) && !said(entry) && !among(captures, entry)) captures.push(square(entry));
  }
  return { id: foe.id, x: foe.x, y: foe.y, piece: foe.piece, coming, atOnce, moves: steps.filter((move) => !said(move)).map(square), captures };
}

/** The same for the monster standing on a square, if any. */
export function inspectAt(state, tile) {
  const foe = tile && state?.enemies?.find((entry) => same(entry, tile));
  return foe ? inspectMonster(state, foe.id) : null;
}

/**
 * The gesture's bookkeeping, between the board (src/renderer.js) and the page
 * (src/main.js). `board()` is the position on show while it can be inspected,
 * or null (the bot's replay, choosing a pin, a room that is over); `show(marks)`
 * lays the marks on the board (null lifts them) and `shown()` is what lies
 * there now, since any new paint lifts them too. `onShow` hears each showing.
 */
export function createInspector({ board, show, shown, onShow }) {
  let marks = null;
  let how = null;
  let timer = null;
  const up = () => marks !== null && shown() === marks;
  const put = (next, by = null) => {
    clearTimeout(timer);
    marks = next; how = next ? by : null;
    show(next);
    if (next) onShow?.(next);
  };
  const monsterOn = (game, tile) => (game && tile ? game.enemies.some((foe) => same(foe, tile)) : false);
  return {
    /**
     * A press held on a square. True when the hold is taken, and so is never a
     * tap: on any monster. Only an unmasked one shows anything; a masked one
     * does nothing at all. Elsewhere the press stays the tap it always was.
     */
    hold(tile) {
      const game = board();
      if (!monsterOn(game, tile)) return false;
      const next = inspectAt(game, tile);
      if (next) put(next, 'hold');
      else if (up()) put(null);
      return true;
    },
    /** The held press let go: a mouse lifts the marks at once, a finger or pen a little later. */
    release(pointer) {
      if (!up() || how !== 'hold') return;
      if (pointer === 'mouse') put(null);
      else timer = setTimeout(() => { if (up()) put(null); }, HOLD_LINGER_MS);
    },
    /** A mouse resting on a square (null: it left). True while its marks are up. */
    hover(tile) {
      const next = tile ? inspectAt(board(), tile) : null;
      if (next) put(next, 'hover');
      else if (up() && how === 'hover') put(null);
      return Boolean(next);
    },
    /** The keyboard: the cursor's square, one key to show and the same key to lift. */
    key(cursor) {
      if (up()) { put(null); return false; }
      const next = cursor ? inspectAt(board(), cursor) : null;
      if (next) put(next, 'key');
      return Boolean(next);
    },
  };
}
