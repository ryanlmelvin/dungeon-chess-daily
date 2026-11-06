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
// Attacks, wind-ups, closeIn, the pawn-lane rule, royal-floor rules, en
// passant and promotion all stay in rules.js; this module only ranks the legal
// non-capturing steps it is given. Evaluations move the monster
// hypothetically and always restore it.

export const HABITS = Object.freeze({
  knightRange: 3, // Manhattan distance of a knight's jump
  knightAttack: 2.5, // landing where it already attacks the player
  knightCover: 0.6, // per player destination it covers (fork setup)
  knightCoverCap: 2,
  knightExposed: 3, // landing where the player can capture it (only a strike plus a fork outweighs it)
  sliderApproach: 0.6, // weight of plain distance for line pieces
  sliderCover: 0.6, // per player destination cut off
  sliderCoverCap: 3,
  sliderOpen: 0.08, // per square of open line from the new square
  sliderOpenCap: 1,
  pawnChain: 2, // a square another monster pawn guards
  retreat: 4, // a guarded square when threatened and unguarded
});

const LINE_PIECES = new Set(['rook', 'bishop', 'queen']);
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function at(unit, square, evaluate) {
  const { x, y } = unit;
  unit.x = square.x; unit.y = square.y;
  try { return evaluate(); } finally { unit.x = x; unit.y = y; }
}

/**
 * Pick one of `candidates` (legal, non-capturing steps already filtered by
 * rules.js) for `foe`. `engine` supplies rules.js internals: movesFor,
 * closeAttacker and the seeded tie-break `tie(move)` in [0, 1).
 */
export function chooseMonsterMove(state, foe, candidates, engine) {
  if (candidates.length < 2) return candidates[0];
  const { movesFor, closeAttacker, tie } = engine;
  const player = state.player;
  const playerTakes = (square) => movesFor(state, player).some((move) => move.capture && same(move, square));
  // A square is guarded when taking a monster there would be an instant hit.
  const guarded = (square) => Boolean(closeAttacker(state, square));
  const role = foe.piece;
  const origin = { x: foe.x, y: foe.y };
  // The player's destinations before this monster moves (its escape squares).
  const destinations = role === 'knight' || LINE_PIECES.has(role)
    ? movesFor(state, player).filter((move) => !move.capture)
    : [];
  const threatened = playerTakes(foe) && !guarded(foe);

  const score = (move) => at(foe, move, () => {
    let value = 0.35 * distance(move, origin) + 0.7 * tie(move);
    if (role === 'knight') {
      const reach = movesFor(state, foe, true, true);
      const covered = destinations.filter((square) => reach.some((tile) => same(tile, square))).length;
      value += Math.abs(distance(move, player) - HABITS.knightRange)
        - (reach.some((tile) => same(tile, player)) ? HABITS.knightAttack : 0)
        - HABITS.knightCover * Math.min(HABITS.knightCoverCap, covered)
        + (playerTakes(move) ? HABITS.knightExposed : 0);
    } else if (LINE_PIECES.has(role)) {
      const reach = movesFor(state, foe, true, true);
      const covered = destinations.filter((square) => !same(square, move) && reach.some((tile) => same(tile, square))).length;
      value += HABITS.sliderApproach * distance(move, player)
        - HABITS.sliderCover * Math.min(HABITS.sliderCoverCap, covered)
        - Math.min(HABITS.sliderOpenCap, HABITS.sliderOpen * reach.length);
    } else {
      value += distance(move, player);
      if (role === 'pawn' && state.enemies.some((other) => other !== foe && other.piece === 'pawn'
        && other.y === move.y - 1 && Math.abs(other.x - move.x) === 1)) value -= HABITS.pawnChain;
    }
    if (threatened && guarded(move)) value -= HABITS.retreat;
    return value;
  });
  const ranked = candidates.map((move) => ({ move, value: score(move) }));
  ranked.sort((a, b) => a.value - b.value);
  return ranked[0].move;
}
