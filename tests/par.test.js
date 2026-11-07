// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, getShareText, resetFloor, validateSave } from '../src/game.js';
import { botRun } from '../src/bot.js';
import { awardStars, floorPars, parFor, runPars, starsFor, starText, totalStars } from '../src/par.js';

const daily = getDaily(new Date(Date.UTC(2026, 10, 5)));

// Play the certified route the way main.js does: score floors after every action.
function playRoute(each = () => {}) {
  const pars = runPars(createGame(daily), daily);
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) {
    state = act(state, action);
    awardStars(state, pars);
    each(state);
  }
  return state;
}

test('star thresholds: three at or under par, two within five over, one beyond', () => {
  assert.equal(starsFor(1, 10), 3);
  assert.equal(starsFor(10, 10), 3);
  assert.equal(starsFor(11, 10), 2);
  assert.equal(starsFor(15, 10), 2);
  assert.equal(starsFor(16, 10), 1);
  assert.equal(starsFor(400, 10), 1);
  for (const [turns, par] of [[10, null], [10, undefined], [10, 0], [1.5, 10], [10, 2.5], ['10', 10]]) assert.equal(starsFor(turns, par), null);
  assert.equal(starText(2), '⭐⭐');
  assert.equal(totalStars([{ stars: 3 }, { stars: 2 }, { stars: 1 }]), 6);
  assert.equal(totalStars([{ stars: 3 }, { stars: 2 }]), null);
  assert.equal(totalStars([{ stars: 3 }, {}, { stars: 1 }]), null);
});

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

test('stars are stored on floor records, survive a save round trip and a floor reset, and pass validateSave', () => {
  const pars = floorPars(daily);
  let checked = 0;
  const won = playRoute((state) => {
    if (checked++ % 5) return;
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true, `turn ${state.turns}`);
  });
  assert.equal(won.status, 'won');
  // The route matches par on every floor.
  assert.deepEqual(won.records.map((record) => record.stars), [3, 3, 3]);
  assert.deepEqual(won.records.map((record) => record.turns), pars);
  assert.equal(validateSave(JSON.parse(JSON.stringify(won)), daily.date), true);
  assert.deepEqual(won.floorSnapshot.records.map((record) => record.stars), [3, 3]);

  // A run on floor 2 keeps floor 1's stars through a voluntary floor reset.
  let floorTwo = null;
  playRoute((state) => { if (!floorTwo && state.floor === 1 && state.turns > state.floorStart.turns) floorTwo = structuredClone(state); });
  const reset = resetFloor(floorTwo);
  assert.equal(reset.records[0].stars, 3);
  assert.equal(validateSave(reset, daily.date), true);

  // Older saves without stars still validate; malformed stars do not.
  const legacy = structuredClone(won);
  for (const record of [...legacy.records, ...legacy.floorSnapshot.records]) delete record.stars;
  assert.equal(validateSave(legacy, daily.date), true);
  for (const stars of [0, 4, 2.5, '3', null, -1]) {
    const broken = structuredClone(won); broken.records[1].stars = stars; broken.floorSnapshot.records[1].stars = stars;
    assert.equal(validateSave(broken, daily.date), false, JSON.stringify(stars));
  }
  // Stars on the live record must match the floor-start snapshot's copy.
  const split = structuredClone(won); split.floorSnapshot.records[0].stars = 2;
  assert.equal(validateSave(split, daily.date), false);
});

test('awarding stars is idempotent and skips runs without a par', () => {
  const won = playRoute();
  assert.deepEqual(awardStars(won, floorPars(daily)), []);
  const practice = structuredClone(won);
  for (const record of practice.records) delete record.stars;
  assert.deepEqual(awardStars(practice, null), []);
  assert.ok(practice.records.every((record) => record.stars === undefined));
  // A slow floor earns fewer stars.
  const slow = structuredClone(practice);
  slow.records[0].turns = floorPars(daily)[0] + 5; slow.records[1].turns = floorPars(daily)[1] + 6;
  assert.equal(awardStars(slow, floorPars(daily)).length, 3);
  assert.deepEqual(slow.records.map((record) => record.stars), [2, 1, 3]);
});

test('the share card shows each floor\'s stars and the total once the run is won', () => {
  const won = playRoute();
  assert.equal(getShareText(won).split('\n').slice(0, 4).join('\n'), `Dungeon Chess Daily #${won.edition} ⭐ 9/9\n🟨🟨🟨\n🟨🟨🟨\n🟨🟨🟨`);
  won.records[0].stars = 2; won.records[2].stars = 1;
  assert.deepEqual(getShareText(won).split('\n').slice(0, 4), [`Dungeon Chess Daily #${won.edition} ⭐ 6/9`, '🟨🟨⬛', '🟨🟨🟨', '🟨⬛⬛']);
  // Unscored or unfinished runs have no star total.
  const legacy = structuredClone(won); delete legacy.records[1].stars;
  assert.ok(!getShareText(legacy).includes('⭐'));
  assert.equal(getShareText(legacy).split('\n')[2], '✅');
  let playing = null;
  playRoute((state) => { if (!playing && state.floor === 2) playing = structuredClone(state); });
  assert.equal(playing.records[0].stars, 3);
  assert.ok(!getShareText(playing).includes('⭐'));
  assert.equal(getShareText(playing).split('\n')[3], '⬛⬛⬛');
});
