// SPDX-License-Identifier: GPL-3.0-only
// Reproducible content audit; wall-clock measurements never affect generation.
import assert from 'node:assert/strict';
import { getDaily, DIFFICULTY_PROFILES } from '../src/generation.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { getRawDaily } from '../src/edition.js';

const [start = '2026-11-05', countText = '365', difficulty = 'standard'] = process.argv.slice(2);
const count = Number(countText);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
  || new Date(start).toISOString().slice(0, 10) !== start
  || !Number.isInteger(count) || count < 1 || count > 10_000
  || !Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) {
  throw new Error('Usage: node scripts/audit-dungeons.mjs [YYYY-MM-DD] [1..10000 days] [gentle|standard|expert]');
}
const summary = { start, days: count, difficulty, generated: 0, fallback: 0, brokenFallback: 0, longestRoute: 0, promotedRoutes: 0, pieces: {}, colors: {}, fallbacksBy: {}, livesLost: {}, maxGenerationMs: 0 };
const tally = (bucket, key) => { bucket[key] = (bucket[key] ?? 0) + 1; };
for (let offset = 0; offset < count; offset++) {
  const date = new Date(Date.parse(start) + offset * 86_400_000).toISOString().slice(0, 10);
  const began = performance.now();
  const raw = getRawDaily(date);
  let daily;
  try {
    daily = getDaily(date, { difficulty });
  } catch (error) {
    // After a rules change the fallback bank fails closed until it is rebuilt;
    // count those days as fallbacks so the generator's own rate stays visible.
    if (!/certif/i.test(error.message)) throw error;
    summary.fallback++; summary.brokenFallback++;
    tally(summary.fallbacksBy, `${raw.playerPiece}:${raw.playerColor}`);
    continue;
  }
  summary.maxGenerationMs = Math.max(summary.maxGenerationMs, Math.round(performance.now() - began));
  if (daily.generation.source === 'fallback') tally(summary.fallbacksBy, `${daily.playerPiece}:${daily.playerColor}`);
  const initial = createGame(daily);
  const actions = daily.generation.certificate.actions;
  const proof = verifyWinningRoute(initial, actions);
  assert.equal(proof.valid, true, `${date}: ${proof.reason}`);
  let state = initial;
  for (const action of actions) {
    state = act(state, action);
    assert.equal(validateSave(state, date, daily), true, `${date}: save after ${JSON.stringify(action)}`);
  }
  summary[daily.generation.source]++;
  summary.longestRoute = Math.max(summary.longestRoute, state.turns);
  summary.promotedRoutes += Number(proof.metrics.promotion);
  if (proof.metrics.livesLost) tally(summary.livesLost, `${daily.playerPiece}:${proof.metrics.livesLost}`);
  summary.pieces[daily.playerPiece] = (summary.pieces[daily.playerPiece] ?? 0) + 1;
  summary.colors[daily.playerColor] = (summary.colors[daily.playerColor] ?? 0) + 1;
  if ((offset + 1) % 50 === 0) console.log(`Certified ${offset + 1}/${count} editions.`);
}
console.log(JSON.stringify(summary, null, 2));
