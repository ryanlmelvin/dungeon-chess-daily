// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { getRawDaily, buildTheme } from './edition.js';
import { createGame, RULES_VERSION } from './rules.js';
import { hash } from './random.js';
import { findWinningRoute, verifyWinningRoute } from './fairness.js';
import { FALLBACKS } from './fallbacks.js';
import { DIFFICULTY_PROFILES } from './difficulty.js';
import { MODIFIERS } from './modifiers.js';
export { DIFFICULTY_PROFILES } from './difficulty.js';

export const GENERATOR_VERSION = RULES_VERSION;
// These describe witnessed tactical pressure, not a lower bound on optimal play.
// Keep the public edition on one profile for everyone. Other profiles are for
// design tools/tests; there is deliberately no player-specific adaptive seed.
const cache = new Map();
const ATTEMPTS = 2;
const SEARCH_BUDGET = 12_000;

function certify(daily, actions, source, attempt) {
  const proof = verifyWinningRoute(createGame(daily), actions);
  const profile = DIFFICULTY_PROFILES[daily.difficulty];
  if (!proof.valid || proof.metrics.threatenedDecisions < profile.minThreatenedDecisions) return null;
  return {
    ...daily,
    generation: {
      version: GENERATOR_VERSION, source, attempt,
      certificate: { actions: structuredClone(actions), metrics: proof.metrics },
    },
  };
}

/** Generate and certify every edition before returning any playable dungeon. */
export function generateDaily(date = new Date(), { difficulty = 'standard', maxAttempts = ATTEMPTS } = {}) {
  if (!Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) throw new RangeError('Unknown difficulty profile.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > ATTEMPTS) throw new RangeError('Invalid candidate budget.');
  const base = getRawDaily(date);
  const profile = DIFFICULTY_PROFILES[difficulty];
  const candidate = { ...base, difficulty, obstacleBase: profile.obstacleBase };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    candidate.dungeonSeed = attempt === 0 ? base.seed : hash(`${GENERATOR_VERSION}:${base.seed}:${difficulty}:${attempt}`);
    const result = findWinningRoute(createGame(candidate), { maxExpansions: SEARCH_BUDGET });
    if (result.status !== 'solved') continue;
    const accepted = certify(candidate, result.actions, 'generated', attempt);
    if (accepted) return accepted;
  }
  // Bounded search may miss a solution. Fall back to a tested complete dungeon,
  // retaining this date's piece/color and cosmetic variety. Never accept an
  // uncertified layout, even if a future rule change invalidates the fallback.
  // Each room modifier has its own bank; plain days keep the original keys.
  const fallback = FALLBACKS[fallbackKey(difficulty, base.playerPiece, base.playerColor, base.modifier)];
  if (!fallback) throw new Error('No certified fallback for this edition.');
  const template = getRawDaily(fallback.date);
  const species = base.species.map((entry, index) => ({ ...entry, piece: template.species[index].piece }));
  const certified = certify({
    ...candidate, dungeonSeed: fallback.dungeonSeed, targets: [...template.targets],
    species, theme: buildTheme(species),
  }, fallback.actions, 'fallback', maxAttempts);
  if (!certified) throw new Error('Dungeon certification failed. No unverified dungeon was released.');
  return certified;
}

/** Bank key: modifiers that change play (ice, collapse) have their own certificates. */
export function fallbackKey(difficulty, piece, color, modifier = 'none') {
  return `${difficulty}:${piece}:${color}${MODIFIERS[modifier]?.changesRules ? `:${modifier}` : ''}`;
}

export function getDaily(date = new Date(), { difficulty = 'standard' } = {}) {
  const key = `${getRawDaily(date).date}:${difficulty}`;
  if (!cache.has(key)) {
    const daily = generateDaily(date, { difficulty });
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, daily);
  }
  // A caller cannot poison future daily generation by mutating its result.
  return structuredClone(cache.get(key));
}
