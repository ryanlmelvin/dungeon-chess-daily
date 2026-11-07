// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { getDaily } from './generation.js';
import { createGame as createCandidate, validateSave as validateCandidateSave } from './rules.js';
import { PIECES, PLAYABLE_PIECES } from './pieces.js';

export { getDaily, DIFFICULTY_TIERS, GENERATOR_VERSION } from './generation.js';
export { PLAYABLE_PIECES };
export { act, resetFloor, retryLostRun, hopelessFloor, legalMoves, dangerTiles, unreachablePickups, walkable, enemyAt, getShareText, scoredMoves, floorScoredMoves, coinlessFloor, PIECES, PIECE_COUNTS, PIECE_LIVES, POWERUPS, SHOP_ITEMS, EXTRA_LIFE, PIN_MOVES, borrowedPiece, takebackTarget, shopOffers, COMPANIONS, RULES_VERSION } from './rules.js';
// Manual recruit control: the recruit's squares for the order a move or wait may carry.
export { recruitChoice } from './rules.js';

/** Only canonical certified editions enter the public game. */
export function createGame(daily = getDaily()) {
  return createCandidate(getDaily(daily.date, { difficulty: daily.difficulty }));
}

/** Replay the official layout without certifying the chosen piece or color. */
export function createPracticeGame(daily = getDaily(), { piece = daily.playerPiece, color = daily.playerColor } = {}) {
  if (!PIECES.includes(piece) || !['white', 'black'].includes(color)) throw new RangeError('Unknown practice piece or color.');
  const official = getDaily(daily.date, { difficulty: daily.difficulty });
  return createCandidate({ ...official, playerPiece: piece, playerColor: color, practice: true, layoutPiece: official.playerPiece });
}

export function canChoosePiece(state) {
  return !!state && (['won', 'lost'].includes(state.status) || state.practice === true || state.replayUnlocked === true || state.events?.some((event) => event.type === 'restart') === true);
}

export function isOfficialPiece(state, daily = getDaily(state?.date)) {
  return !!state && state.startingPiece === daily.playerPiece && state.playerColor === daily.playerColor;
}

export function validateSave(value, date, { difficulty, practice = false } = {}) {
  try {
    const daily = getDaily(date, { difficulty });
    if (value?.practice === true) {
      if (!practice || !PIECES.includes(value.startingPiece) || !['white', 'black'].includes(value.playerColor) || value.layoutPiece !== daily.playerPiece) return false;
      return validateCandidateSave(value, date, { ...daily, playerPiece: value.startingPiece, playerColor: value.playerColor, practice: true, layoutPiece: daily.playerPiece });
    }
    return validateCandidateSave(value, date, daily);
  } catch { return false; }
}
