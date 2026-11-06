// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { getDaily } from './generation.js';
import { createGame as createCandidate, validateSave as validateCandidateSave } from './rules.js';

export { getDaily, DIFFICULTY_PROFILES, GENERATOR_VERSION } from './generation.js';
export { act, legalMoves, dangerTiles, unreachablePickups, walkable, enemyAt, getShareText, PIECES, PIECE_COUNTS, PIECE_LIVES, POWERUPS, COMPANIONS, RULES_VERSION } from './rules.js';

/** Only canonical certified editions enter the public game. */
export function createGame(daily = getDaily()) {
  return createCandidate(getDaily(daily.date, { difficulty: daily.difficulty }));
}

export function validateSave(value, date, { difficulty = 'standard' } = {}) {
  try {
    return validateCandidateSave(value, date, getDaily(date, { difficulty }));
  } catch { return false; }
}
