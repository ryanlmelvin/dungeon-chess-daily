// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { getDaily } from './generation.js';
import { createGame as createCandidate, validateSave as validateCandidateSave } from './rules.js';
import { PIECES, PLAYABLE_PIECES } from './pieces.js';
import { TIER_IDS } from './difficulty.js';

export { getDaily, GENERATOR_VERSION } from './generation.js';
export { DIFFICULTY_TIERS, TIER_IDS, DAILY_TIER } from './difficulty.js';
export { PLAYABLE_PIECES };
export { act, resetFloor, retryLostRun, hopelessFloor, legalMoves, dangerTiles, unreachablePickups, walkable, enemyAt, getShareText, scoredMoves, floorScoredMoves, coinlessFloor, frozen, PIECES, PIECE_COUNTS, POWERUPS, SHOP_ITEMS, PIN_MOVES, borrowedPiece, takebackTarget, shopOffers, RULES_VERSION } from './rules.js';
// Manual recruit control: the recruit's squares for the order a move or wait may carry.
export { recruitChoice } from './rules.js';

/** Only canonical certified editions enter the public game. */
export function createGame(daily = getDaily()) {
  return createCandidate(getDaily(daily.date));
}

/**
 * Replay the official rooms without certifying the chosen piece, color or
 * monsters. `difficulty` is the monsters' ruleset, any tier (src/difficulty.js;
 * the day's own, Fair, unless chosen): it sets how smart they are and the
 * cave-in countdown, never the rooms.
 */
export function createPracticeGame(daily = getDaily(), { piece = daily.playerPiece, color = daily.playerColor, difficulty = daily.difficulty } = {}) {
  if (!PIECES.includes(piece) || !['white', 'black'].includes(color) || !TIER_IDS.includes(difficulty)) throw new RangeError('Unknown practice piece, color or monsters.');
  const official = getDaily(daily.date);
  return createCandidate({ ...official, playerPiece: piece, playerColor: color, difficulty, practice: true, layoutPiece: official.playerPiece });
}

export function canChoosePiece(state) {
  return !!state && (['won', 'lost'].includes(state.status) || state.practice === true || state.replayUnlocked === true || state.events?.some((event) => event.type === 'restart' && event.scope !== 'floor') === true);
}

/** The day's own piece, color and monsters: the only run with a par and a share card. */
export function isOfficialRun(state, daily = getDaily(state?.date)) {
  return !!state && state.startingPiece === daily.playerPiece && state.playerColor === daily.playerColor && state.difficulty === daily.difficulty;
}

export function validateSave(value, date, { practice = false } = {}) {
  try {
    const daily = getDaily(date);
    if (value?.practice === true) {
      if (!practice || !PIECES.includes(value.startingPiece) || !['white', 'black'].includes(value.playerColor) || value.layoutPiece !== daily.playerPiece || !TIER_IDS.includes(value.difficulty)) return false;
      return validateCandidateSave(value, date, { ...daily, playerPiece: value.startingPiece, playerColor: value.playerColor, difficulty: value.difficulty, practice: true, layoutPiece: daily.playerPiece });
    }
    return validateCandidateSave(value, date, daily);
  } catch { return false; }
}
