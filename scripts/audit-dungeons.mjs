// SPDX-License-Identifier: GPL-3.0-only
// Reproducible content audit; wall-clock measurements never affect generation.
import assert from 'node:assert/strict';
import { getDaily, DIFFICULTY_PROFILES } from '../src/generation.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { verifyWinningRoute } from '../src/fairness.js';

const [start = '2026-11-05', countText = '365', difficulty = 'standard'] = process.argv.slice(2);
const count = Number(countText);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
  || new Date(start).toISOString().slice(0, 10) !== start
  || !Number.isInteger(count) || count < 1 || count > 10_000
  || !Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) {
  throw new Error('Usage: node scripts/audit-dungeons.mjs [YYYY-MM-DD] [1..10000 days] [gentle|standard|expert]');
}
const summary = { start, days: count, difficulty, generated: 0, fallback: 0, longestRoute: 0, promotedRoutes: 0, pieces: {}, colors: {}, maxGenerationMs: 0 };
for (let offset = 0; offset < count; offset++) {
  const date = new Date(Date.parse(start) + offset * 86_400_000).toISOString().slice(0, 10);
  const began = performance.now();
  const daily = getDaily(date, { difficulty });
  summary.maxGenerationMs = Math.max(summary.maxGenerationMs, Math.round(performance.now() - began));
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
  summary.pieces[daily.playerPiece] = (summary.pieces[daily.playerPiece] ?? 0) + 1;
  summary.colors[daily.playerColor] = (summary.colors[daily.playerColor] ?? 0) + 1;
  if ((offset + 1) % 50 === 0) console.log(`Certified ${offset + 1}/${count} editions.`);
}
console.log(JSON.stringify(summary, null, 2));
