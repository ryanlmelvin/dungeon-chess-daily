// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, getShareText, validateSave } from '../src/game.js';
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
  assert.deepEqual(won.records.map((record) => record.turns), pars);
  assert.ok(won.records.every((record) => record.stars === undefined));
  assert.equal(validateSave(JSON.parse(JSON.stringify(won)), daily.date), true);
  const legacy = structuredClone(won);
  for (const record of [...legacy.records, ...legacy.floorSnapshot.records]) record.stars = 3;
  assert.equal(validateSave(legacy, daily.date), true);
});

test('the share card shows each floor\'s moves against par', () => {
  const won = playRoute();
  const pars = floorPars(daily);
  assert.deepEqual(getShareText(won, pars).split('\n').slice(0, 3), [`Dungeon Chess Daily #${won.edition}`, '🟥 ⬛ 👑', 'E E E']);
  const off = structuredClone(won); off.records[0].turns = pars[0] + 3; off.records[2].turns = pars[2] - 1;
  assert.equal(getShareText(off, pars).split('\n')[2], '+3 E -1');
  let playing = null;
  playRoute((state) => { if (!playing && state.floor === 2) playing = structuredClone(state); });
  assert.deepEqual(getShareText(playing, pars).split('\n').slice(1, 3), ['🟥 ⬛ 👑', 'E E ·']);
});
