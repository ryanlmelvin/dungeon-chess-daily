// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { getRawDaily, buildTheme } from './edition.js';
import { createGame, RULES_VERSION } from './rules.js';
import { hash } from './random.js';
import { findWinningRoute, verifyWinningRoute } from './fairness.js';
import { FALLBACKS } from './fallbacks.js';
import { DIFFICULTY_TIERS, tierForDate, knobsFor, difficultyScore, bandDistance } from './difficulty.js';
export { DIFFICULTY_TIERS, tierForDate } from './difficulty.js';
import { MODIFIERS } from './modifiers.js';
import { EDITIONS } from './editions.js';
import { decodeRoute, encodeRoute } from './route-code.js';

export const GENERATOR_VERSION = RULES_VERSION;
// These describe witnessed tactical pressure, not a lower bound on optimal play.
// The public edition's tier comes from its UTC weekday, the same for everyone;
// there is deliberately no player-specific adaptive seed.
const cache = new Map();
export const ATTEMPTS = 2;
export const SEARCH_BUDGET = 12_000;

/** Layout seed of a date's numbered candidate; the same for every tier. */
export const candidateSeed = (base, attempt) => (attempt === 0 ? base.seed : hash(`${GENERATOR_VERSION}:${base.seed}:${attempt}`));

/** The uncertified edition a tier's knobs build for a raw daily. */
export function candidateFor(base, tier, knobs, attempt = 0) {
  return {
    ...base, difficulty: tier, dungeonSeed: candidateSeed(base, attempt),
    obstacleBase: knobs.obstacleBase, decoys: knobs.decoys, scatter: knobs.scatter, guards: knobs.guards,
  };
}

/**
 * Bounded search plus independent replay. `status` is 'solved' (with actions,
 * metrics and score), 'unknown' (the budget ran out) or 'invalid' (a route the
 * replay rejected); `explored` counts the search's simulated transitions.
 */
export function searchCandidate(candidate) {
  const result = findWinningRoute(createGame(candidate), { maxExpansions: SEARCH_BUDGET });
  if (result.status !== 'solved') return { status: 'unknown', explored: result.explored };
  const proof = verifyWinningRoute(createGame(candidate), result.actions);
  if (!proof.valid) return { status: 'invalid', explored: result.explored };
  return { status: 'solved', explored: result.explored, actions: result.actions, metrics: proof.metrics, score: difficultyScore(proof.metrics, candidate.playerPiece) };
}

/**
 * Which candidate generateDaily keeps: `found` lists each attempt's
 * searchCandidate() result (or null) in order; only solved ones count. The first one inside the
 * tier's band wins; otherwise the one closest to it (the earlier on a tie).
 * Candidates with too few threatened decisions never count. -1 means fallback.
 * Calibration (scripts/calibrate-difficulty.mjs) replays this same choice.
 */
export function chooseCandidate(found, tier, minThreatenedDecisions) {
  let best = -1, bestDistance = Infinity;
  for (const [index, entry] of found.entries()) {
    if (!entry?.metrics || entry.metrics.threatenedDecisions < minThreatenedDecisions) continue;
    const distance = bandDistance(entry.score, tier);
    if (distance < bestDistance) { best = index; bestDistance = distance; }
    if (distance === 0) break;
  }
  return best;
}

function certify(daily, actions, source, attempt, knobs) {
  const proof = verifyWinningRoute(createGame(daily), actions);
  if (!proof.valid || proof.metrics.threatenedDecisions < knobs.minThreatenedDecisions) return null;
  return {
    ...daily,
    generation: {
      version: GENERATOR_VERSION, source, attempt,
      certificate: { actions: structuredClone(actions), metrics: proof.metrics, score: difficultyScore(proof.metrics, daily.playerPiece) },
    },
  };
}

/**
 * Generate and certify every edition before returning any playable dungeon.
 * `difficulty` is a tier id (src/difficulty.js); omitted, it is the date's
 * weekday tier. `knobs` overrides the calibrated knobs (tooling only), and
 * `fallback: false` returns null instead of using the fallback bank.
 */
// Dates past the build's precomputed window search once per device, then the
// certified result is remembered in browser storage and replayed like a
// precomputed entry. Storage may be missing or blocked; that only costs speed.
const deviceKey = (date) => `dchess-edition:v${GENERATOR_VERSION}:${date}`;
function rememberedEdition(date) {
  try {
    const entry = JSON.parse(globalThis.localStorage?.getItem(deviceKey(date)) ?? 'null');
    const attemptOk = entry?.attempt === 'fallback' || (Number.isInteger(entry?.attempt) && entry.attempt >= 0 && entry.attempt < ATTEMPTS);
    return attemptOk && typeof entry.tier === 'string' && typeof entry.route === 'string' && entry.route.length <= 200 ? entry : undefined;
  } catch { return undefined; }
}
function rememberEdition(daily) {
  const { source, attempt, certificate } = daily.generation;
  const entry = { tier: daily.difficulty, attempt: source === 'fallback' ? 'fallback' : attempt, route: source === 'fallback' ? '' : encodeRoute(certificate.actions) };
  try { globalThis.localStorage?.setItem(deviceKey(daily.date), JSON.stringify(entry)); } catch { /* storage is optional */ }
}

export function generateDaily(date = new Date(), { difficulty, maxAttempts = ATTEMPTS, knobs, fallback = true, precomputed = true } = {}) {
  const base = getRawDaily(date);
  const tier = difficulty ?? tierForDate(base.date);
  if (!Object.hasOwn(DIFFICULTY_TIERS, tier)) throw new RangeError('Unknown difficulty tier.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > ATTEMPTS) throw new RangeError('Invalid candidate budget.');
  const settings = { ...knobsFor(tier, base.playerPiece), ...knobs };
  // Build-time certified editions (src/editions.js, scripts/build-editions.mjs)
  // replay a stored route instead of searching. It is the same result the
  // search below would reach; a stale entry is ignored and the search runs.
  const official = precomputed && !knobs && maxAttempts === ATTEMPTS;
  const stored = official ? EDITIONS[base.date] ?? rememberedEdition(base.date) : undefined;
  let searches = maxAttempts;
  if (stored && stored.tier === tier) {
    if (stored.attempt === 'fallback') searches = 0;
    else {
      const accepted = certify(candidateFor(base, tier, settings, stored.attempt), decodeRoute(stored.route), 'generated', stored.attempt, settings);
      if (accepted) return accepted;
    }
  }
  // Try the first layout; only when its witnessed route scores outside the
  // tier's band, also try the second. Both use the same fixed budgets, so the
  // choice stays a pure function of the date.
  const found = [];
  for (let attempt = 0; attempt < searches; attempt++) {
    found.push(searchCandidate(candidateFor(base, tier, settings, attempt)));
    if (chooseCandidate(found, tier, settings.minThreatenedDecisions) === attempt
      && bandDistance(found[attempt].score, tier) === 0) break;
  }
  const chosen = chooseCandidate(found, tier, settings.minThreatenedDecisions);
  if (chosen >= 0) {
    const accepted = certify(candidateFor(base, tier, settings, chosen), found[chosen].actions, 'generated', chosen, settings);
    if (accepted && official && !EDITIONS[base.date]) rememberEdition(accepted);
    if (accepted) return accepted;
  }
  if (!fallback) return null;
  // Bounded search may miss a solution. Fall back to a tested complete dungeon,
  // retaining this date's piece/color and cosmetic variety. Never accept an
  // uncertified layout, even if a future rule change invalidates the fallback.
  // Each rules-changing room modifier has its own bank; plain and dark days share one.
  const entry = FALLBACKS[fallbackKey(tier, base.playerPiece, base.playerColor, base.modifier)];
  if (!entry) throw new Error('No certified fallback for this edition.');
  const template = getRawDaily(entry.date);
  const species = base.species.map((creature, index) => ({ ...creature, piece: template.species[index].piece }));
  const certified = certify({
    ...candidateFor(base, tier, settings), dungeonSeed: entry.dungeonSeed, targets: [...template.targets],
    species, theme: buildTheme(species),
  }, entry.actions, 'fallback', maxAttempts, settings);
  if (!certified) throw new Error('Dungeon certification failed. No unverified dungeon was released.');
  if (official && !EDITIONS[base.date]) rememberEdition(certified);
  return certified;
}

/** Bank key: modifiers that change play (ice, collapse) have their own certificates. */
export function fallbackKey(tier, piece, color, modifier = 'none') {
  return `${tier}:${piece}:${color}${MODIFIERS[modifier]?.changesRules ? `:${modifier}` : ''}`;
}

export function getDaily(date = new Date(), { difficulty } = {}) {
  const raw = getRawDaily(date);
  const tier = difficulty ?? tierForDate(raw.date);
  const key = `${raw.date}:${tier}`;
  if (!cache.has(key)) {
    const daily = generateDaily(raw.date, { difficulty: tier });
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, daily);
  }
  // A caller cannot poison future daily generation by mutating its result.
  return structuredClone(cache.get(key));
}
