// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSurrogate, dominates, dominatedOut, clearlyWorse, compactRuns, storedGap, dataStamp, dataProblem, behaviourFingerprint, DATA_VERSION } from '../scripts/calibration-search.mjs';
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

const grid = [];
for (const obstacleBase of [4, 7, 10, 13]) for (const decoys of [0, 1, 2, 3]) for (const scatter of [0, 1]) for (let guards = 0; guards <= decoys; guards++) {
  grid.push({ obstacleBase, decoys, scatter, guards });
}

test('the surrogate recovers a score built from knobs and a pairwise term', () => {
  const truth = (s) => 8 + 0.3 * s.obstacleBase + 0.5 * s.decoys + 0.2 * s.guards * s.decoys - 0.4 * s.scatter;
  const model = fitSurrogate(grid.map((setting) => ({ setting, y: truth(setting) })));
  for (const setting of grid) assert.ok(Math.abs(model.predict(setting) - truth(setting)) < 0.05, JSON.stringify(setting));
  assert.ok(model.residualSd < 0.05);
});

test('dominance compares monotone knobs only within the same scatter', () => {
  assert.ok(dominates({ obstacleBase: 10, decoys: 2, scatter: 0, guards: 1 }, { obstacleBase: 7, decoys: 2, scatter: 0, guards: 0 }));
  assert.ok(!dominates({ obstacleBase: 10, decoys: 2, scatter: 1, guards: 1 }, { obstacleBase: 7, decoys: 2, scatter: 0, guards: 0 }));
  assert.ok(!dominates({ obstacleBase: 10, decoys: 1, scatter: 0, guards: 1 }, { obstacleBase: 7, decoys: 2, scatter: 0, guards: 0 }));
});

test('settings beyond a too-hard or too-easy one are pruned, the rest kept', () => {
  const entries = [
    { id: 'easiest', setting: { obstacleBase: 4, decoys: 0, scatter: 0, guards: 0 }, mean: null },
    { id: 'easy', setting: { obstacleBase: 4, decoys: 1, scatter: 0, guards: 0 }, mean: 5 },
    { id: 'mid', setting: { obstacleBase: 7, decoys: 1, scatter: 0, guards: 0 }, mean: 12 },
    { id: 'hard', setting: { obstacleBase: 10, decoys: 2, scatter: 0, guards: 1 }, mean: 20 },
    { id: 'harder', setting: { obstacleBase: 13, decoys: 3, scatter: 0, guards: 2 }, mean: null },
    { id: 'other', setting: { obstacleBase: 13, decoys: 3, scatter: 1, guards: 2 }, mean: 14 },
  ];
  const pruned = dominatedOut(entries, 7.5, 18);
  assert.deepEqual([...pruned].sort(), ['easiest', 'harder']);
  // A setting is never pruned by its own (noisy) mean, only by another's.
  assert.ok(!pruned.has('easy') && !pruned.has('mid') && !pruned.has('hard') && !pruned.has('other'));
});

test('paired stopping needs a clear, consistent gap on common dates', () => {
  const best = [0.2, 0.5, 0.1, 0.4, 0.3, 0.6];
  assert.ok(clearlyWorse(best.map((x) => x + 1), best));
  assert.ok(!clearlyWorse(best.map((x) => x + 1).slice(0, 3), best.slice(0, 3)), 'too few dates');
  assert.ok(!clearlyWorse([0.3, 0.4, 0.2, 0.3, 0.4, 0.5], best), 'within noise');
});
