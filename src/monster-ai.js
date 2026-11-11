// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
//
// Role habits for a monster's ordinary (non-attacking) step, so a watcher can
// guess a hidden role from how it moves. Every habit is a soft preference
// added to the original approach score (Manhattan distance to the player, a
// little travel cost, and the seeded hash tie-break), so choices stay
// deterministic and monsters stay beatable rather than perfect:
//
// - Knights hover a knight's distance from the player, preferring squares
//   that attack the player (they wind up from there) or cover the player's
//   destinations (fork threats), and avoid squares the player can capture.
// - Rooks, bishops and queens prefer open lines that cut off the player's
//   destinations over simply closing distance.
// - Pawns advance in a chain, preferring a square another monster pawn guards.
// - Any role the player threatens, unguarded, retreats behind a defender.
//
// Monsters grow smarter with the tier (src/difficulty.js): every daily plays
// Fair, and practice may choose any. Each tier keeps the ones before it;
// unknown or legacy tiers play like Gentle:
//
// - Gentle: the habits above. Brave monsters, good for learning.
// - Fair: every role avoids squares where it can be taken (exposed): squares
//   the player can capture, with a held Borrowed move too, unless taking it
//   there would be an instant hit on the player (guarded); and squares the
//   recruit can capture, guarded or not, since nothing punishes a recruit.
// - Tricky: a rook, bishop, queen or decoy king closes in and winds up only
//   from a square where it isn't exposed. Lines are two-way, so a wind-up
//   from an exposed square would just hand it over; instead it repositions
//   with its habits. The wind-up warning itself never changes.
// - Tough: guards (every monster but the targets) screen the targets the way
//   royal guards screen the king: one blocks a line into a target the player
//   could take before doing anything else, and their steps keep lines into
//   the targets shut. Non-pawn targets prefer guarded squares.
// - Fiendish: non-pawn targets never step where they are exposed while they
//   have another step (cf. the royal king), and guards bait: they wind up
//   from guarded squares on purpose.
//
// Pawns keep their chains and only advance, so pawn floors stay catchable.
// Monsters can't pass: a cornered one must still step into reach, which keeps
// waiting a way to squeeze them. The king floor keeps its royal rules
// (rules.js) on every tier; these smarts apply to floors 1 and 2.
//
// Attacks, wind-ups, closeIn, the pawn-lane rule, royal-floor rules, en
// passant and promotion all stay in rules.js; this module only ranks the legal
// non-capturing steps it is given and says when a wind-up, closing in or a
// screening block is wise. Evaluations move the monster hypothetically and
// always restore it.
import { DIFFICULTY_TIERS } from './difficulty.js';

export const HABITS = Object.freeze({
  knightRange: 3, // Manhattan distance of a knight's jump
  knightAttack: 2.5, // landing where it already attacks the player
  knightCover: 0.6, // per player destination it covers (fork setup)
  knightCoverCap: 2,
  knightExposed: 3, // landing where it can be taken (only a strike plus a fork outweighs it)
  sliderApproach: 0.6, // weight of plain distance for line pieces
  sliderCover: 0.6, // per player destination cut off
  sliderCoverCap: 3,
  sliderOpen: 0.08, // per square of open line from the new square
  sliderOpenCap: 1,
  pawnChain: 2, // a square another monster pawn guards
  retreat: 4, // a guarded square when threatened and unguarded
  // Fair and up, every role but knights (they keep knightExposed): landing
  // where it is exposed. Twice the knights' weight, because a slider's plain
  // approach (0.6 a square) could otherwise pull it in from across the room.
  exposed: 6,
  huddle: 2, // Tough and up: a non-pawn target landing on a guarded square
  screen: 2, // Tough and up: a guard landing between the player and a target
  unscreen: 8, // Tough and up: per target a guard's step leaves exposed (more than its own safety)
  bait: 2.5, // Fiendish: a guard landing on a guarded square from which it strikes
});

const RANK = (tier) => DIFFICULTY_TIERS[tier].rank;
const FAIR = RANK('fair'), TRICKY = RANK('tricky'), TOUGH = RANK('tough'), FIENDISH = RANK('fiendish');
const LINE_PIECES = new Set(['rook', 'bishop', 'queen']);
// Pieces whose wind-up waits for a safe square (Tricky and up). Kings on
// floors 1 and 2 are always decoys; the royal king keeps its own rules.
const STRIKERS = new Set([...LINE_PIECES, 'king']);
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function at(unit, square, evaluate) {
  const { x, y } = unit;
  unit.x = square.x; unit.y = square.y;
  try { return evaluate(); } finally { unit.x = x; unit.y = y; }
}

/**
 * How smart the day's monsters are: its tier's rank, Gentle 1 to Fiendish 5.
 * An unknown or legacy tier plays like Gentle, and so do classic monsters
 * (`state.classicMonsters`, set only for old-versus-new comparisons).
 */
export function monsterSmarts(state) {
  const tier = String(state?.difficulty);
  return state?.classicMonsters === true || !Object.hasOwn(DIFFICULTY_TIERS, tier) ? 1 : RANK(tier);
}

const isTarget = (state, foe) => (foe.role ?? foe.piece) === state.objective?.piece;
const targetsBesides = (state, foe) => state.enemies.filter((other) => other !== foe && isTarget(state, other));

/**
 * For the board as it stands (move a monster first to ask about its new
 * square): is a monster on `square` exposed? The player can capture there,
 * with a held Borrowed move too, and the square is not guarded (taking it
 * would not be an instant hit); or the recruit can capture there.
 */
function exposureOf(state, engine, guarded = (square) => Boolean(engine.closeAttacker(state, square))) {
  const { capturesAt, borrowedPiece } = engine;
  const { player, companion } = state;
  const borrowed = state.powers?.leap > 0 ? borrowedPiece(state) : null;
  // Asked square by square (capturesAt), never building the full capture lists.
  const takes = (unit, square, piece) => capturesAt(state, unit, false, square.x, square.y, piece);
  return (square) => Boolean(companion && takes(companion, square))
    || ((takes(player, square) || (borrowed !== null && takes(player, square, borrowed))) && !guarded(square));
}

const exposedCount = (targets, exposed) => targets.filter(exposed).length;

// Strictly between the player and a target, on a line the player's piece
// slides along (the royal guards' screening square, cf. royalGuardTurn).
function screens(state, square, targets) {
  const { player } = state;
  const straight = player.piece === 'rook' || player.piece === 'queen';
  const diagonal = player.piece === 'bishop' || player.piece === 'queen';
  return targets.some((target) => {
    const dx = target.x - player.x, dy = target.y - player.y;
    if (!((straight && (!dx || !dy)) || (diagonal && Math.abs(dx) === Math.abs(dy)))) return false;
    const mx = square.x - player.x, my = square.y - player.y;
    const n = Math.max(Math.abs(dx), Math.abs(dy)), k = Math.max(Math.abs(mx), Math.abs(my));
    return k > 0 && k < n && mx * n === dx * k && my * n === dy * k;
  });
}

/**
 * Tricky and up: may `foe` wind up from where it stands? A rook, bishop,
 * queen or decoy king waits for a square where it isn't exposed; every other
 * role, and every role on easier tiers, may.
 */
export function safeToStrike(state, foe, engine) {
  return monsterSmarts(state) < TRICKY || !STRIKERS.has(foe.piece) || !exposureOf(state, engine)(foe);
}

/**
 * Tricky and up: may `foe` close in to `step`? Only onto a square where it
 * isn't exposed and, Tough and up for a guard, only if no target is left
 * exposed that wasn't already.
 */
export function safeCloseIn(state, foe, step, engine) {
  const smarts = monsterSmarts(state);
  if (smarts < TRICKY) return true;
  const targets = smarts >= TOUGH && !isTarget(state, foe) ? targetsBesides(state, foe) : [];
  const before = targets.length ? exposedCount(targets, exposureOf(state, engine)) : 0;
  return at(foe, step, () => {
    const exposed = exposureOf(state, engine);
    return !exposed(step) && exposedCount(targets, exposed) <= before;
  });
}

/**
 * Tough and up: the step a guard takes first to block a line into a target
 * the player (or the recruit) could take now, as royal guards shield their
 * king; null when there is nothing to block or no step blocks. The step that
 * leaves the fewest targets exposed wins, then one where the guard itself
 * isn't exposed, then the nearest.
 */
export function screenStep(state, foe, engine) {
  if (monsterSmarts(state) < TOUGH || isTarget(state, foe)) return null;
  const targets = targetsBesides(state, foe);
  if (!targets.length) return null;
  const open = exposedCount(targets, exposureOf(state, engine));
  if (!open) return null;
  const origin = { x: foe.x, y: foe.y };
  let best = null;
  for (const move of engine.steps()) {
    const value = at(foe, move, () => {
      const exposed = exposureOf(state, engine);
      const left = exposedCount(targets, exposed);
      return left < open ? 10 * left + (exposed(move) ? 5 : 0) + distance(move, origin) + 0.1 * engine.tie(move) : Infinity;
    });
    if (value < (best?.value ?? Infinity)) best = { move, value };
  }
  return best?.move ?? null;
}

/**
 * Pick one of `candidates` (legal, non-capturing steps already filtered by
 * rules.js) for `foe`. `engine` supplies rules.js internals: movesFor, its
 * single-question forms capturesAt, strikesPlayer and attackReach,
 * closeAttacker, borrowedPiece and the seeded tie-break `tie(move)` in [0, 1).
 */
export function chooseMonsterMove(state, foe, candidates, engine) {
  const smarts = monsterSmarts(state);
  const target = isTarget(state, foe);
  // Fiendish: a non-pawn target with a safe step never takes an exposed one.
  if (smarts >= FIENDISH && target && foe.piece !== 'pawn' && candidates.length > 1) {
    const safe = candidates.filter((move) => at(foe, move, () => !exposureOf(state, engine)(move)));
    if (safe.length) candidates = safe;
  }
  if (candidates.length < 2) return candidates[0];
  const { movesFor, capturesAt, attackReach, closeAttacker, tie } = engine;
  const player = state.player;
  const playerTakes = (square) => capturesAt(state, player, false, square.x, square.y);
  // A square is guarded when taking a monster there would be an instant hit.
  const guarded = (square) => Boolean(closeAttacker(state, square));
  const role = foe.piece;
  const origin = { x: foe.x, y: foe.y };
  // The player's destinations before this monster moves (its escape squares).
  const destinations = role === 'knight' || LINE_PIECES.has(role)
    ? movesFor(state, player).filter((move) => !move.capture)
    : [];
  const threatened = playerTakes(foe) && !guarded(foe);
  // Tough and up, a guard screens the targets: which lie exposed before it moves.
  const screened = smarts >= TOUGH && !target ? targetsBesides(state, foe) : [];
  const openBefore = screened.length ? exposedCount(screened, exposureOf(state, engine)) : 0;

  const score = (move) => at(foe, move, () => {
    // Whether the step itself is guarded, asked once however many habits ask.
    let guard;
    const guardedHere = () => (guard ??= guarded(move));
    let value = 0.35 * distance(move, origin) + 0.7 * tie(move);
    if (role === 'knight') {
      const reach = attackReach(state, foe);
      const covered = destinations.filter((square) => reach.has(square)).length;
      value += Math.abs(distance(move, player) - HABITS.knightRange)
        - (reach.has(player) ? HABITS.knightAttack : 0)
        - HABITS.knightCover * Math.min(HABITS.knightCoverCap, covered)
        // From Fair on, the exposure below replaces the knights' own penalty.
        + (smarts < FAIR && playerTakes(move) ? HABITS.knightExposed : 0);
    } else if (LINE_PIECES.has(role)) {
      const reach = attackReach(state, foe);
      const covered = destinations.filter((square) => !same(square, move) && reach.has(square)).length;
      value += HABITS.sliderApproach * distance(move, player)
        - HABITS.sliderCover * Math.min(HABITS.sliderCoverCap, covered)
        - Math.min(HABITS.sliderOpenCap, HABITS.sliderOpen * reach.count);
    } else {
      value += distance(move, player);
      if (role === 'pawn' && state.enemies.some((other) => other !== foe && other.piece === 'pawn'
        && other.y === move.y - 1 && Math.abs(other.x - move.x) === 1)) value -= HABITS.pawnChain;
    }
    if (threatened && guardedHere()) value -= HABITS.retreat;
    if (smarts < FAIR) return value;
    const exposed = exposureOf(state, engine, (square) => (same(square, move) ? guardedHere() : guarded(square)));
    if (exposed(move)) value += role === 'knight' ? HABITS.knightExposed : HABITS.exposed;
    if (smarts >= TOUGH && target && role !== 'pawn' && guardedHere()) value -= HABITS.huddle;
    if (screened.length) {
      value += HABITS.unscreen * Math.max(0, exposedCount(screened, exposed) - openBefore)
        - (screens(state, move, screened) ? HABITS.screen : 0);
    }
    if (smarts >= FIENDISH && !target && role !== 'pawn' && guardedHere()
      && engine.strikesPlayer(state, foe)) value -= HABITS.bait;
    return value;
  });
  const ranked = candidates.map((move) => ({ move, value: score(move) }));
  ranked.sort((a, b) => a.value - b.value);
  return ranked[0].move;
}
