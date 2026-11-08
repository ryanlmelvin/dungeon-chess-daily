// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactRuns, storedGap, dataStamp, dataProblem, behaviourFingerprint, DATA_VERSION } from '../scripts/calibration-search.mjs';
import { cappedGap } from '../src/difficulty.js';
import { RULES_VERSION } from '../src/rules.js';
import { HUMAN_BOT_VERSION } from '../src/human-bot.js';
import { ATTEMPTS } from '../src/generation.js';

test('a data row keeps the bot\'s runs compactly and gives back the same capped human gap', () => {
  const run = (won, moves) => ({ won, moves, livesLost: won ? 0 : 2 });
  const human = { results: [[run(true, 7), run(false, 12)], [run(true, 6), run(true, 19)], [run(false, 40), run(true, 8)]], certified: [5, 6, 8] };
  const runs = compactRuns(human);
  assert.deepEqual(runs, [[7, null], [6, 19], [null, 8]], 'moves where a run won, null where it failed');
  assert.equal(storedGap({ human: runs, metrics: { floorMoves: human.certified } }), cappedGap(human));
  assert.equal(compactRuns(null), null);
  assert.equal(storedGap({ human: null, metrics: { floorMoves: [5, 6, 8] } }), null, 'an unsolved search has no gap');
  assert.equal(storedGap({ human: runs, metrics: null }), null);
});

test('calibration data from before the capped gap, or from other rules, is refused', () => {
  const now = { rules: RULES_VERSION, bot: HUMAN_BOT_VERSION, attempts: ATTEMPTS, fingerprint: '0123abcd' };
  assert.equal(DATA_VERSION, 2);
  assert.equal(dataProblem({ ...dataStamp(now), rows: [] }, now), null);
  // The score-band data file had no stamp at all.
  assert.match(dataProblem({ generated: '2026-11-07', searchBudget: 12_000, rows: [] }, now), /before the tiers used the capped human gap/);
  assert.match(dataProblem({ ...dataStamp(now), attempts: 2 }, now), /attempts 2/);
  assert.match(dataProblem({ ...dataStamp(now), humanBotVersion: HUMAN_BOT_VERSION + 1 }, now), /humanBotVersion/);
  assert.match(dataProblem({ ...dataStamp(now), rulesVersion: RULES_VERSION - 1 }, now), /rulesVersion/);
  // Another default recruit policy for the bot, say, with no version bump.
  assert.match(dataProblem({ ...dataStamp(now), behaviour: 'ffff0000' }, now), /play differently now/);
});

test('the behaviour fingerprint is a pure function of the code', () => {
  const fingerprint = behaviourFingerprint();
  assert.match(fingerprint, /^[0-9a-f]{8}$/);
  assert.equal(behaviourFingerprint(), fingerprint);
});
