// SPDX-License-Identifier: GPL-3.0-only
// Reproducible content audit; wall-clock measurements never affect generation.
import assert from 'node:assert/strict';
import { getDaily, DIFFICULTY_TIERS } from '../src/generation.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { getRawDaily } from '../src/edition.js';

// 'weekly' audits the public editions (each date's weekday tier); a tier id forces that tier.
const [start = '2026-11-05', countText = '365', difficulty = 'weekly'] = process.argv.slice(2);
const count = Number(countText);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
  || new Date(start).toISOString().slice(0, 10) !== start
  || !Number.isInteger(count) || count < 1 || count > 10_000
  || !(difficulty === 'weekly' || Object.hasOwn(DIFFICULTY_TIERS, difficulty))) {
  throw new Error(`Usage: node scripts/audit-dungeons.mjs [YYYY-MM-DD] [1..10000 days] [weekly|${Object.keys(DIFFICULTY_TIERS).join('|')}]`);
}
const summary = { start, days: count, difficulty, generated: 0, fallback: 0, brokenFallback: 0, longestRoute: 0, promotedRoutes: 0, pieces: {}, colors: {}, fallbacksBy: {}, captured: {}, modifiers: {}, scores: {}, maxGenerationMs: 0 };
// Per room modifier: certification source and the certified routes' measurements.
const byModifier = (modifier) => summary.modifiers[modifier] ??= { days: 0, generated: 0, fallback: 0, brokenFallback: 0, totalTurns: 0, longestRoute: 0, threatenedDecisions: 0, captured: 0, slides: 0, reinforcements: 0 };
const tally = (bucket, key) => { bucket[key] = (bucket[key] ?? 0) + 1; };
for (let offset = 0; offset < count; offset++) {
  const date = new Date(Date.parse(start) + offset * 86_400_000).toISOString().slice(0, 10);
  const began = performance.now();
  const raw = getRawDaily(date);
  let daily;
  try {
    daily = getDaily(date, difficulty === 'weekly' ? {} : { difficulty });
  } catch (error) {
    // After a rules change the fallback bank fails closed until it is rebuilt;
    // count those days as fallbacks so the generator's own rate stays visible.
    if (!/certif/i.test(error.message)) throw error;
    summary.fallback++; summary.brokenFallback++;
    const entry = byModifier(raw.modifier); entry.days++; entry.fallback++; entry.brokenFallback++;
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
  const entry = byModifier(daily.modifier ?? 'none');
  for (const action of actions) {
    state = act(state, action);
    assert.equal(validateSave(state, date, daily), true, `${date}: save after ${JSON.stringify(action)}`);
    entry.slides += state.events.filter((event) => event.type === 'slide').length;
    entry.reinforcements += state.events.filter((event) => event.type === 'reinforcement').length;
  }
  entry.days++; entry[daily.generation.source]++;
  entry.totalTurns += state.turns; entry.longestRoute = Math.max(entry.longestRoute, state.turns);
  entry.threatenedDecisions += proof.metrics.threatenedDecisions; entry.captured += proof.metrics.hits;
  summary[daily.generation.source]++;
  summary.longestRoute = Math.max(summary.longestRoute, state.turns);
  summary.promotedRoutes += Number(proof.metrics.promotion);
  if (proof.metrics.hits) tally(summary.captured, `${daily.playerPiece}:${proof.metrics.hits}`);
  summary.pieces[daily.playerPiece] = (summary.pieces[daily.playerPiece] ?? 0) + 1;
  ((summary.scores[daily.difficulty] ??= {})[daily.playerPiece] ??= []).push(daily.generation.certificate.score);
  summary.colors[daily.playerColor] = (summary.colors[daily.playerColor] ?? 0) + 1;
  if ((offset + 1) % 50 === 0) console.log(`Certified ${offset + 1}/${count} editions.`);
}
for (const entry of Object.values(summary.modifiers)) {
  const certified = entry.days - entry.brokenFallback;
  entry.certified = `${certified}/${entry.days}`;
  entry.meanTurns = certified ? Math.round(entry.totalTurns / certified * 10) / 10 : null;
  entry.meanThreatenedDecisions = certified ? Math.round(entry.threatenedDecisions / certified * 10) / 10 : null;
}
// Mean difficulty score per tier and piece (src/difficulty.js difficultyScore).
for (const byPiece of Object.values(summary.scores)) for (const [piece, values] of Object.entries(byPiece)) {
  byPiece[piece] = { n: values.length, mean: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 };
}
console.log(JSON.stringify(summary, null, 2));
