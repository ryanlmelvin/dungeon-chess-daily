// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fitSurrogate, dominates, dominatedOut, clearlyWorse, compactRuns, storedGap, dataStamp, dataProblem, DATA_VERSION,
  stateDigest, measureCandidate, remeasureCandidate, finalRoute, floorStart, classFingerprint, pickProbes, rowKey, classKey,
  writeDataFile, readDataFile,
} from '../scripts/calibration-search.mjs';
import { cappedGap } from '../src/difficulty.js';
import { RULES_VERSION, createGame, act } from '../src/rules.js';
import { HUMAN_BOT_VERSION, certifiedFloors } from '../src/human-bot.js';
import { ATTEMPTS, SEARCH_BUDGET, candidateFor, searchCandidate } from '../src/generation.js';
import { findWinningRoute } from '../src/fairness.js';
import { encodeRoute } from '../src/route-code.js';
import { getRawDaily } from '../src/edition.js';

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

test('calibration data of another version, candidate count or budget is never reused', () => {
  const now = { rules: RULES_VERSION, bot: HUMAN_BOT_VERSION, attempts: ATTEMPTS, searchBudget: SEARCH_BUDGET };
  assert.equal(DATA_VERSION, 3);
  assert.equal(dataProblem({ ...dataStamp(now), rows: [] }, now), null);
  // Version 2 kept no routes or floor searches, so nothing in it can be served.
  assert.match(dataProblem({ ...dataStamp(now), dataVersion: 2 }, now), /data version 2/);
  assert.match(dataProblem({ generated: '2026-11-07', searchBudget: 12_000, rows: [] }, now), /data version none/);
  assert.match(dataProblem({ ...dataStamp(now), attempts: 2 }, now), /attempts 2/);
  assert.match(dataProblem({ ...dataStamp(now), searchBudget: 3000 }, now), /searchBudget 3000/);
  // The rules and bot versions alone don't refuse a file: the class fingerprints decide.
  assert.equal(dataProblem({ ...dataStamp(now), rulesVersion: RULES_VERSION - 1, humanBotVersion: HUMAN_BOT_VERSION + 1 }, now), null);
});

test('a position\'s digest ignores its words, events and version stamps, not the board', () => {
  const game = createGame(getRawDaily('2026-11-30'));
  const digest = stateDigest(game);
  assert.match(digest, /^[0-9a-f]{12}$/);
  assert.equal(stateDigest({ ...game, message: 'Hello', events: [{ type: 'win' }], schema: 99, rulesVersion: 99 }), digest);
  assert.equal(stateDigest({ ...game, floorSnapshot: null }), digest);
  assert.notEqual(stateDigest({ ...game, player: { ...game.player, x: game.player.x - 1 } }), digest);
  assert.notEqual(stateDigest({ ...game, turns: 1 }), digest);
});

// Cheap candidates: a solved knight day and a pawn day whose search fails
// after keeping more lives on floor 1 (it searches floor 1 again).
const knight = candidateFor(getRawDaily('2026-11-30'), 'tough', { obstacleBase: 7, decoys: 2, scatter: 0, guards: 0 }, 0);
const pawn = candidateFor(getRawDaily('2026-12-31'), 'tough', { obstacleBase: 7, decoys: 2, scatter: 0, guards: 0 }, 0);
const knightRow = measureCandidate(knight), pawnRow = measureCandidate(pawn);
const strip = ({ ms, ...rest }) => rest;
const none = [false, false, false];

test('a measured row keeps its route and every floor\'s search, as generation searches', () => {
  const reference = searchCandidate(knight);
  assert.equal(knightRow.status, 'solved');
  assert.equal(knightRow.explored, reference.explored);
  assert.equal(knightRow.route, encodeRoute(reference.actions));
  assert.equal(finalRoute(knightRow.searches), knightRow.route);
  assert.deepEqual(knightRow.searches.map(([floor]) => floor), [0, 1, 2]);
  assert.equal(knightRow.searches.reduce((sum, [, , explored]) => sum + explored, 0), knightRow.explored, 'each floor\'s expansions add up');
  // Watching the floors changes nothing.
  assert.equal(findWinningRoute(createGame(knight)).explored, knightRow.explored);
  // Each floor's start rebuilt from the searches is the route's own.
  const { starts } = certifiedFloors({ ...knight, generation: { certificate: { actions: reference.actions } } });
  for (const floor of [0, 1, 2]) {
    assert.equal(stateDigest(floorStart(knight, knightRow.searches, floor)), stateDigest(starts[floor]));
    assert.equal(knightRow.searches[floor][3], stateDigest(starts[floor]));
  }
  // The pawn day searched floor 1 again keeping more lives, then gave up.
  assert.equal(pawnRow.status, 'unknown');
  assert.equal(pawnRow.route, null);
  assert.deepEqual(pawnRow.searches.map(([floor]) => floor), [0, 1, 0]);
  assert.ok(pawnRow.searches[2][1] > pawnRow.searches[0][1], 'the second search of floor 1 keeps more lives');
});

test('measuring again reuses exactly what still holds', () => {
  for (const [candidate, row] of [[knight, knightRow], [pawn, pawnRow]]) {
    // Nothing changed: every search served, the bot's runs kept, the same row and wall time.
    const same = remeasureCandidate(candidate, row, { search: none, bot: none }, { key: 'k' });
    assert.deepEqual(same.row, row);
    assert.deepEqual(same.notes.searched, [0, 0, 0]);
    assert.equal(same.notes.guard, null);
    assert.deepEqual(same.notes.spot, []);
  }
  const kept = remeasureCandidate(knight, knightRow, { search: none, bot: none }, { key: 'k' });
  assert.deepEqual(kept.notes.served, [1, 1, 1]);
  assert.deepEqual(kept.notes.bot, ['kept', 'kept', 'kept']);
  // Floor 3's search changed: floors 1 and 2 are served, floor 3 searched again
  // with what they left, and the result is the full search's.
  const third = remeasureCandidate(knight, knightRow, { search: [false, false, true], bot: [false, false, true] });
  assert.deepEqual(strip(third.row), strip(knightRow));
  assert.deepEqual(third.notes.served, [1, 1, 0]);
  assert.deepEqual(third.notes.searched, [0, 0, 1]);
  assert.deepEqual(third.notes.bot, ['kept', 'kept', 'played']);
  // Only floor 2's bot changed: every search served, floor 2's runs played again.
  const bot = remeasureCandidate(knight, knightRow, { search: none, bot: [false, true, false] });
  assert.deepEqual(strip(bot.row), strip(knightRow));
  assert.deepEqual(bot.notes.searched, [0, 0, 0]);
  assert.deepEqual(bot.notes.bot, ['kept', 'played', 'kept']);
  // A pawn day searched again from floor 2 on: served floor 1, then the same retries.
  const pawnAgain = remeasureCandidate(pawn, pawnRow, { search: [false, true, true], bot: none });
  assert.deepEqual(strip(pawnAgain.row), strip(pawnRow));
  assert.deepEqual(pawnAgain.notes.served, [2, 0, 0]);
  assert.deepEqual(pawnAgain.notes.searched, [0, 1, 0]);
});

test('a stored search is only served from the same start, and every reuse is checked', () => {
  // Another start (the layout or an earlier floor changed): searched again.
  const moved = { ...knightRow, searches: knightRow.searches.map((entry, index) => (index === 1 ? [...entry.slice(0, 3), '000000000000', entry[4]] : entry)) };
  const again = remeasureCandidate(knight, moved, { search: none, bot: none });
  assert.deepEqual(again.notes.searched, [0, 1, 0]);
  assert.deepEqual(strip(again.row), strip(knightRow));
  // A stored segment that no longer replays is searched again too.
  const broken = { ...knightRow, searches: knightRow.searches.map((entry, index) => (index === 2 ? [...entry.slice(0, 4), '.!'] : entry)) };
  assert.deepEqual(remeasureCandidate(knight, broken, { search: none, bot: none }).notes.searched, [0, 0, 1]);
  // A reused route must verify to its stored metrics.
  const metrics = { ...knightRow, metrics: { ...knightRow.metrics, unsafeAlternatives: knightRow.metrics.unsafeAlternatives + 1 } };
  assert.equal(remeasureCandidate(knight, metrics, { search: none, bot: none }).notes.guard, 'metrics');
  // A kept floor's bot runs are spot-checked: one run played again must match.
  const human = knightRow.human.map((runs) => runs.map((moves) => (moves === null ? 1 : moves + 1)));
  assert.deepEqual(remeasureCandidate(knight, { ...knightRow, human }, { search: none, bot: none }, { key: 'k' }).notes.spot, [0, 1, 2]);
  assert.deepEqual(remeasureCandidate(knight, { ...knightRow, human }, { search: none, bot: none }, { spotCheck: false }).notes.spot, []);
});

test('class probes and fingerprints are a pure function of the stored searches and the code', () => {
  assert.equal(classKey('pawn', 'ice', 2, 'tough'), 'pawn/ice/3/tough');
  const rows = [0, 1, 2, 3].map((attempt) => ({ piece: 'knight', setting: '7/2/0/0@tough', date: '2026-11-30', attempt }));
  rows[3].searches = [];
  rows.forEach((row, attempt) => { if (attempt < 3) row.searches = attempt === 2 ? knightRow.searches.slice(0, 1) : knightRow.searches; });
  const floor3 = pickProbes(rows, 2);
  assert.deepEqual(floor3.map(rowKey).sort(), [rowKey(rows[0]), rowKey(rows[1])], 'only rows that searched floor 3');
  assert.deepEqual(pickProbes([...rows].reverse(), 2).map(rowKey), floor3.map(rowKey), 'in a fixed order');
  assert.equal(pickProbes(rows, 0, 2).length, 2);
  const probes = [{ candidate: knight, searches: knightRow.searches }];
  for (const floor of [0, 2]) {
    const fingerprint = classFingerprint(probes, floor);
    assert.match(fingerprint.search, /^[0-9a-f]{12}$/);
    assert.deepEqual(classFingerprint(probes, floor), fingerprint);
  }
  assert.notDeepEqual(classFingerprint(probes, 0), classFingerprint(probes, 2));
  // No probe reached the floor: a constant, not an error.
  assert.deepEqual(classFingerprint([], 1), classFingerprint([], 1));
});

test('a data file is written and read a row at a time, and stays one JSON object', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'calibration-data-'));
  try {
    const path = join(dir, 'data.json');
    const header = { generated: '2026-11-09', dataVersion: DATA_VERSION, attempts: 16, summary: { byPiece: {} } };
    const classes = { 'knight/none/1/tough': { probes: ['a'], search: 's', bot: 'b' }, 'knight/none/2/tough': { probes: [], search: 't', bot: 'c' } };
    const rows = Array.from({ length: 3000 }, (_, index) => ({ piece: 'knight', setting: '7/2/0/0@tough', date: '2026-11-30', attempt: index, status: 'solved', human: [[index, null]], route: 'Ue.!' }));
    await writeDataFile(path, header, classes, rows);
    const text = await readFile(path, 'utf8');
    assert.deepEqual(JSON.parse(text), { ...header, classes, rows }, 'one JSON object, as before');
    assert.equal(text.split('\n').length, 1 + 1 + 2 + 2 + rows.length + 2, 'a line per class and per row');
    assert.deepEqual(await readdir(dir), ['data.json'], 'no temporary file left behind');
    // The script names its --data file by URL.
    await writeDataFile(pathToFileURL(path), header, classes, rows);
    assert.equal(await readFile(path, 'utf8'), text);
    assert.deepEqual(await readdir(dir), ['data.json']);
    const seen = [];
    assert.deepEqual(await readDataFile(path, { onRow: (row) => seen.push(row) }), { ...header, classes });
    assert.deepEqual(seen, rows);
    // onHeader can stop before any row is read.
    let read = 0;
    assert.equal(await readDataFile(path, { onHeader: (head) => head.attempts === 4, onRow: () => read++ }), null);
    assert.equal(read, 0);
    // No rows, and a file in another layout (parsed whole, as older tools wrote it).
    await writeDataFile(path, header, {}, []);
    assert.deepEqual(await readDataFile(path), { ...header, classes: {} });
    await writeFile(path, JSON.stringify({ ...header, rows: rows.slice(0, 2) }, null, 2));
    const old = [];
    assert.deepEqual(await readDataFile(path, { onRow: (row) => old.push(row) }), header);
    assert.deepEqual(old, rows.slice(0, 2));
    // A file cut short is an error, not a silently shorter run.
    await writeDataFile(path, header, classes, rows);
    await writeFile(path, text.slice(0, text.length - 10));
    await assert.rejects(readDataFile(path), /ends before its rows do|JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
