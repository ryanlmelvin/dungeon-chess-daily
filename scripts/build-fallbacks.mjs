// SPDX-License-Identifier: GPL-3.0-only
// Offline authoring only: ship these certificates so runtime generation always
// has a checked alternative when its bounded search returns unknown.
// One fallback per (difficulty tier, piece, color, rules-changing modifier),
// built with that tier's calibrated knobs (src/calibration.js), so re-run this
// after recalibrating or changing rules.
import { writeFile } from 'node:fs/promises';
import { getRawDaily } from '../src/edition.js';
import { createGame } from '../src/rules.js';
import { findWinningRoute, verifyWinningRoute } from '../src/fairness.js';
import { PLAYABLE_PIECES as PIECES } from '../src/pieces.js';
import { TIER_IDS, knobsFor, difficultyScore, bandDistance, freebieFloor } from '../src/difficulty.js';
import { candidateFor, generateDaily, fallbackKey } from '../src/generation.js';
import { MODIFIERS } from '../src/modifiers.js';

// Every daily is white (src/edition.js), so only white needs a fallback.
const colors = ['white'];
// Plain play, plus each room modifier that changes the rules. A template date
// must carry a modifier with the same bank key.
const modifiers = Object.values(MODIFIERS).filter((entry) => entry.id === 'none' || entry.changesRules).map((entry) => entry.id);
const bankModifier = (modifier) => (MODIFIERS[modifier]?.changesRules ? modifier : 'none');
const LAYOUT_KNOBS = ['obstacleBase', 'decoys', 'scatter', 'guards', 'screens'];
const layoutOf = (knobs) => Object.fromEntries(LAYOUT_KNOBS.map((name) => [name, knobs[name]]));
const stateFor = (entry, tier, knobs) => createGame({ ...candidateFor(getRawDaily(entry.date), tier, knobs), dungeonSeed: entry.dungeonSeed });
const wanted = TIER_IDS.flatMap((tier) => PIECES.flatMap((piece) => colors.flatMap((color) => modifiers.map((modifier) => ({ tier, piece, color, modifier, key: fallbackKey(tier, piece, color, modifier) })))));

if (process.argv.includes('--verify')) {
  const { FALLBACKS } = await import('../src/fallbacks.js');
  let checked = 0;
  for (const { tier, piece, color, modifier, key } of wanted) {
    const entry = FALLBACKS[key];
    if (!entry) throw new Error(`Missing ${key} certificate. Run node scripts/build-fallbacks.mjs.`);
    const knobs = knobsFor(tier, piece);
    if (JSON.stringify(entry.knobs) !== JSON.stringify(layoutOf(knobs))) {
      throw new Error(`Stale ${key} certificate: built for ${JSON.stringify(entry.knobs)}, calibrated ${JSON.stringify(layoutOf(knobs))}. Run node scripts/build-fallbacks.mjs.`);
    }
    if (bankModifier(getRawDaily(entry.date).modifier) !== modifier) throw new Error(`${key}: template date has the wrong modifier.`);
    const state = stateFor(entry, tier, knobs);
    const proof = verifyWinningRoute(state, entry.actions);
    if (state.startingPiece !== piece || state.playerColor !== color || !proof.valid
      || proof.metrics.threatenedDecisions < knobs.minThreatenedDecisions || freebieFloor(proof.metrics, tier)) {
      throw new Error(`Invalid ${key} certificate: ${proof.reason ?? (freebieFloor(proof.metrics, tier) ? 'a floor cleared under the tier’s minimum moves' : 'profile mismatch')}`);
    }
    // The runtime path: forcing the fallback rebuilds and replays the same dungeon.
    const daily = generateDaily(entry.date, { difficulty: tier, maxAttempts: 0 });
    if (daily.generation.source !== 'fallback' || daily.playerPiece !== piece) throw new Error(`${key}: runtime fallback mismatch.`);
    checked++;
  }
  console.log(`Replayed ${checked} fallback certificates: all win without powerups or purchases, losing no lives (pawns at most 4).`);
} else {
  const budget = Number(process.env.FALLBACK_BUDGET ?? 100_000);
  const bank = {}, best = {}, tries = {};
  // Prefer a certificate whose score lies in the tier's band; settle for the
  // closest after 12 certified tries. Skip the first two editions: their seeds
  // keep legacy layouts (LEGACY_LAYOUT_SEEDS, FIXED_PAWN_FORMATION_SEEDS).
  let maxExplored = 0;
  for (let offset = 2; offset < 3660 && Object.keys(bank).length < wanted.length; offset++) {
    const raw = getRawDaily(new Date(Date.UTC(2026, 10, 5 + offset)));
    for (const { tier, piece, color, modifier, key } of wanted) {
      if (bank[key] || raw.playerPiece !== piece || raw.playerColor !== color || bankModifier(raw.modifier) !== modifier) continue;
      const knobs = knobsFor(tier, piece);
      const entry = { date: raw.date, dungeonSeed: raw.seed, knobs: layoutOf(knobs) };
      const state = stateFor(entry, tier, knobs);
      const found = findWinningRoute(state, { maxExpansions: budget, beamWidth: 48 });
      if (found.status !== 'solved') continue;
      const proof = verifyWinningRoute(state, found.actions);
      // Tricky and up, no floor may be a freebie (DIFFICULTY_TIERS minFloorMoves).
      if (!proof.valid || proof.metrics.threatenedDecisions < knobs.minThreatenedDecisions || freebieFloor(proof.metrics, tier)) continue;
      maxExplored = Math.max(maxExplored, found.explored);
      entry.score = difficultyScore(proof.metrics, piece);
      entry.actions = found.actions;
      const distance = bandDistance(entry.score, tier);
      if (!best[key] || distance < best[key].distance) best[key] = { entry, distance, proof, explored: found.explored };
      tries[key] = (tries[key] ?? 0) + 1;
      if (distance === 0 || tries[key] >= 12) {
        bank[key] = best[key].entry;
        const { metrics } = best[key].proof;
        console.log(`${key}: ${bank[key].date}, score ${bank[key].score}${best[key].distance ? ` (${Math.round(best[key].distance * 10) / 10} off band)` : ''}, ${metrics.turns} moves, ${best[key].explored} expansions, ${metrics.threatenedDecisions} threatened decisions (${wanted.length - Object.keys(bank).length} remaining)`);
      }
    }
  }
  for (const { key } of wanted) if (!bank[key] && best[key]) bank[key] = best[key].entry;
  const missing = wanted.filter(({ key }) => !bank[key]);
  if (missing.length) throw new Error(`Could not certify ${missing.length} fallback configurations: ${missing.map(({ key }) => key).join(', ')}.`);
  const ordered = Object.fromEntries(wanted.map(({ key }) => [key, bank[key]]));
  const source = '// SPDX-License-Identifier: GPL-3.0-only\n'
    + '// Generated by scripts/build-fallbacks.mjs; verify with --verify after changing rules or calibration.\n'
    + '// Routes are certificates for the engine, never player-facing hints.\n'
    + `export const FALLBACKS = ${JSON.stringify(ordered, null, 2)};\n`;
  await writeFile(new URL('../src/fallbacks.js', import.meta.url), source);
  console.log(`Wrote ${Object.keys(ordered).length} independently replayed fallback certificates (most expansions used: ${maxExplored}).`);
}
