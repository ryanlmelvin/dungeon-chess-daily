// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, getShareText, validateSave, floorScoredMoves, scoredMoves } from '../src/game.js';
import { botRun } from '../src/bot.js';
import { floorPars, parFor, runPars } from '../src/par.js';

const daily = getDaily(new Date(Date.UTC(2026, 10, 5)));

// Play the certified route.
function playRoute(each = () => {}) {
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) {
    state = act(state, action);
    each(state);
  }
  return state;
}

test('each floor\'s par is the certified route\'s moves on it, for the official piece and color only', () => {
  const pars = floorPars(daily);
  assert.deepEqual(pars, botRun(daily).floors);
  const state = createGame(daily);
  assert.equal(parFor(state, daily), pars[0]);
  assert.deepEqual(runPars(createPracticeGame(daily), daily), pars);
  const otherPiece = daily.playerPiece === 'rook' ? 'bishop' : 'rook';
  assert.equal(parFor(createPracticeGame(daily, { piece: otherPiece }), daily), null);
  assert.equal(parFor(createPracticeGame(daily, { color: 'black' }), daily), null);
  assert.equal(floorPars({ ...daily, generation: undefined }), null);
});

test('the certified route matches par on every floor, and older saves carrying stars still validate', () => {
  const pars = floorPars(daily);
  let checked = 0;
  const won = playRoute((state) => {
    if (checked++ % 5) return;
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true, `turn ${state.turns}`);
  });
  assert.equal(won.status, 'won');
  assert.deepEqual(won.records.map((record) => record.scored), pars);
  assert.ok(won.records.every((record) => record.stars === undefined));
  assert.equal(validateSave(JSON.parse(JSON.stringify(won)), daily.date), true);
  const legacy = structuredClone(won);
  for (const record of [...legacy.records, ...legacy.floorSnapshot.records]) record.stars = 3;
  assert.equal(validateSave(legacy, daily.date), true);
});

test('the share card shows each floor\'s moves against par', () => {
  const won = playRoute();
  const pars = floorPars(daily);
  const cells = (line) => line.split(/[\u2000-\u200A]+/).filter(Boolean).join(' ');
  assert.deepEqual(getShareText(won, pars).split('\n').slice(0, 3).map(cells), [`Dungeon Chess Daily #${won.edition}`, '🟥 ⬛ 👑', 'E E E']);
  const off = structuredClone(won); off.records[0].scored = pars[0] + 3; off.records[2].scored = pars[2] - 1;
  assert.equal(cells(getShareText(off, pars).split('\n')[2]), '+3 E \u22121');
  let playing = null;
  playRoute((state) => { if (!playing && state.floor === 2) playing = structuredClone(state); });
  assert.deepEqual(getShareText(playing, pars).split('\n').slice(1, 3).map(cells), ['🟥 ⬛ 👑', 'E E ·']);
  // Each score is centered under its marker in Apple's system font, even at two digits.
  const wide = structuredClone(won); wide.records.forEach((record, floor) => { record.scored = pars[floor] + 42; });
  assert.equal(cells(getShareText(wide, pars).split('\n')[2]), '+42 +42 +42');
});

test('the scored count stops when the challenge is complete; later moves still count for collapse', () => {
  let done = null;
  playRoute((state) => { if (!done && state.floor === 0 && state.objective.complete) done = state; });
  const frozen = floorScoredMoves(done);
  assert.equal(frozen, done.turns - done.floorStart.turns);
  const after = act(act(done, { type: 'wait' }), { type: 'wait' });
  assert.equal(after.turns, done.turns + 2, 'waiting still spends moves');
  assert.equal(floorScoredMoves(after), frozen);
  assert.equal(validateSave(JSON.parse(JSON.stringify(after)), daily.date), true);
  const left = act(after, { type: 'descend' });
  assert.equal(left.records[0].turns, frozen + 2);
  assert.equal(left.records[0].scored, frozen);
  assert.equal(scoredMoves(left.records[0]), frozen);
  // Older records have no scored count: every move counts.
  assert.equal(scoredMoves({ turns: 9 }), 9);
  const legacy = structuredClone(left); delete legacy.records[0].scored; delete legacy.floorSnapshot.records[0].scored;
  assert.equal(validateSave(legacy, daily.date), true);
  const bogus = structuredClone(left); bogus.records[0].scored = bogus.records[0].turns + 1;
  assert.equal(validateSave(bogus, daily.date), false);
});
