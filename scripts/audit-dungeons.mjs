// SPDX-License-Identifier: GPL-3.0-only
// Reproducible content audit of the published editions (src/generation.js
// getDaily): each day's certificate replays through the production engine, and
// the save after every action validates, as a player's would. A day with a
// partner floor is verified as it is proved, its recruit on orders on that
// floor alone. Dates past the stored window borrow a stored day; the audit
// says how many did, and counts the partner floors and chests it met.
// Wall-clock measurements never affect generation.
//   node scripts/audit-dungeons.mjs [YYYY-MM-DD] [1..10000 days]
import assert from 'node:assert/strict';
import { getDaily, proveComposed, certificateMode } from '../src/generation.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { floorPars } from '../src/par.js';

const [start = '2026-11-01', countText = '365'] = process.argv.slice(2);
const count = Number(countText);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
  || new Date(start).toISOString().slice(0, 10) !== start
  || !Number.isInteger(count) || count < 1 || count > 10_000) {
  throw new Error('Usage: node scripts/audit-dungeons.mjs [YYYY-MM-DD] [1..10000 days]');
}
const summary = { start, days: count, stored: 0, borrowed: 0, longestRoute: 0, promotedRoutes: 0, partnerDays: 0, recruitOrders: 0, chests: 0, pieces: {}, pars: {}, modifiers: {}, maxLoadMs: 0 };
const byModifier = (modifier) => summary.modifiers[modifier] ??= { days: 0, totalTurns: 0, longestRoute: 0, threatenedDecisions: 0, slides: 0, pits: 0, gateTurns: 0, checkmates: 0 };
const tally = (bucket, key) => { bucket[key] = (bucket[key] ?? 0) + 1; };
for (let offset = 0; offset < count; offset++) {
  const date = new Date(Date.parse(start) + offset * 86_400_000).toISOString().slice(0, 10);
  const began = performance.now();
  const daily = getDaily(date);
  summary.maxLoadMs = Math.max(summary.maxLoadMs, Math.round(performance.now() - began));
  // The proof replays on the day's twin without hint powerups (src/generation.js proveComposed).
  const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
  const partner = daily.generation.partner ?? null;
  const proof = verifyWinningRoute(createGame(twin), daily.generation.certificate.actions, certificateMode(partner));
  assert.equal(proof.valid, true, `${date}: ${proof.reason}`);
  // The day's own proof, which also holds the recruit's help to the partner floor.
  const proved = proveComposed(daily, daily.generation.certificate.actions, { saves: true, partner });
  assert.equal(proved.valid, true, `${date}: ${proved.reason}`);
  if (partner !== null) summary.partnerDays++;
  summary.chests += daily.composed.filter((room) => room.items.some((item) => item.type === 'chest')).length;
  let state = createGame(daily);
  const entry = byModifier(daily.modifier ?? 'none');
  for (const action of daily.generation.certificate.actions) {
    assert.ok(action.recruit === undefined || state.floor === partner, `${date}: a recruit order off the partner floor`);
    if (action.recruit !== undefined) summary.recruitOrders++;
    state = act(state, action);
    assert.equal(validateSave(state, date, daily), true, `${date}: save after ${JSON.stringify(action)}`);
    entry.slides += state.events.filter((event) => event.type === 'slide').length;
    // Moving terrain as the certificate meets it: tiles that fell, and turns on which a gate changed.
    entry.pits += state.events.filter((event) => event.type === 'crumble').length;
    entry.gateTurns += state.events.filter((event) => event.type === 'gates').length;
    entry.checkmates += state.events.filter((event) => event.type === 'checkmate').length;
  }
  assert.equal(state.status, 'won', `${date}: the certificate wins as played`);
  entry.days++;
  entry.totalTurns += state.turns; entry.longestRoute = Math.max(entry.longestRoute, state.turns);
  entry.threatenedDecisions += proof.metrics.threatenedDecisions;
  summary[daily.generation.borrowed ? 'borrowed' : 'stored']++;
  summary.longestRoute = Math.max(summary.longestRoute, state.turns);
  summary.promotedRoutes += Number(proof.metrics.promotion);
  tally(summary.pieces, daily.playerPiece);
  tally(summary.pars, floorPars(daily).join('/'));
  if ((offset + 1) % 50 === 0) console.log(`Audited ${offset + 1}/${count} editions.`);
}
for (const entry of Object.values(summary.modifiers)) {
  entry.meanTurns = entry.days ? Math.round(entry.totalTurns / entry.days * 10) / 10 : null;
  entry.meanThreatenedDecisions = entry.days ? Math.round(entry.threatenedDecisions / entry.days * 10) / 10 : null;
}
console.log(JSON.stringify(summary, null, 2));
