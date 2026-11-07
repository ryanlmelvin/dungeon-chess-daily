// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, getShareText, validateSave, floorScoredMoves, scoredMoves, resetFloor, retryLostRun } from '../src/game.js';
import { shareDate } from '../src/rules.js';
import { botRun, playerRun } from '../src/bot.js';
import { floorPars, parFor, runPars, humanSummary, validSummary } from '../src/par.js';
import { humanPar, failedFloorPar } from '../src/human-bot.js';
import { EDITIONS } from '../src/editions.js';
import { generateDaily } from '../src/generation.js';

const daily = getDaily(new Date(Date.UTC(2026, 10, 5)));
// The certified route's scored moves per floor.
const route = botRun(daily).floors;
// A move count against par as the share card writes it.
const signed = (diff) => (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `−${-diff}`);

// Play the certified route.
function playRoute(each = () => {}) {
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) {
    state = act(state, action);
    each(state);
  }
  return state;
}

test('each floor\'s par is the human-like bot\'s, stored by the build, for the official piece and color only', () => {
  const pars = floorPars(daily);
  assert.deepEqual(pars, humanPar(daily).par);
  assert.deepEqual(pars, EDITIONS[daily.date].par, 'the build stored the same pars');
  const state = createGame(daily);
  assert.equal(parFor(state, daily), pars[0]);
  assert.deepEqual(runPars(createPracticeGame(daily), daily), pars);
  const otherPiece = daily.playerPiece === 'rook' ? 'bishop' : 'rook';
  assert.equal(parFor(createPracticeGame(daily, { piece: otherPiece }), daily), null);
  assert.equal(parFor(createPracticeGame(daily, { color: 'black' }), daily), null);
  assert.equal(floorPars({ ...daily, generation: undefined }), null);
});

test('a floor the bot fails takes the certified route\'s moves plus 25% as par', () => {
  const failed = Object.entries(EDITIONS).find(([, entry]) => entry.runs.includes(null));
  assert.ok(failed, 'some edition has a floor the bot fails');
  const [date, entry] = failed;
  const certified = botRun(getDaily(date)).floors;
  entry.runs.forEach((run, floor) => { if (run === null) assert.equal(entry.par[floor], failedFloorPar(certified[floor])); });
});

test('the editions table stores a par and a shown run for every date, exactly as the bot works them out', () => {
  for (const [date, entry] of Object.entries(EDITIONS)) assert.ok(validSummary(entry), `${date}: ${JSON.stringify(entry)}`);
  const dates = Object.keys(EDITIONS);
  for (const date of [dates[0], dates[9], dates[200], dates.at(-1)]) {
    const { par, runs } = humanPar(generateDaily(date));
    assert.deepEqual({ par, runs }, { par: EDITIONS[date].par, runs: EDITIONS[date].runs }, date);
  }
  assert.equal(validSummary({ par: [3, 4, 5], runs: [0, null, 4] }), true);
  for (const bad of [{ par: [3, 4], runs: [0, 0] }, { par: [3, 0, 5], runs: [0, 0, 0] }, { par: [3, 4, 5], runs: [0, 5, 0] }, { par: [3, 4, 5.5], runs: [0, 0, 0] }, { par: [3, 4, 5] }]) {
    assert.equal(validSummary(bad), false, JSON.stringify(bad));
  }
});

test('a date past the window works par out once, then reads it from device storage', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  try {
    const edition = generateDaily('2031-02-11');
    const summary = humanSummary(edition);
    assert.ok(validSummary(summary));
    const keys = () => [...store.keys()].filter((key) => key.startsWith('dchess-par:'));
    assert.equal(keys().length, 1);
    // A remembered entry counts while it matches this certificate; a tampered one is worked out again.
    const [key] = keys();
    store.set(key, JSON.stringify({ ...JSON.parse(store.get(key)), par: [1, 2, 3] }));
    assert.deepEqual(humanSummary({ ...edition, seed: edition.seed + 1 }).par, [1, 2, 3]);
    store.set(key, JSON.stringify({ ...JSON.parse(store.get(key)), route: 'xyz' }));
    assert.deepEqual(humanSummary({ ...edition, seed: edition.seed + 2 }).par, summary.par);
  } finally { delete globalThis.localStorage; }
});

test('the certified route replays and validates, and older saves carrying stars still validate', () => {
  let checked = 0;
  const won = playRoute((state) => {
    if (checked++ % 5) return;
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true, `turn ${state.turns}`);
  });
  assert.equal(won.status, 'won');
  assert.deepEqual(won.records.map((record) => record.scored), route);
  assert.ok(won.records.every((record) => record.stars === undefined));
  assert.equal(validateSave(JSON.parse(JSON.stringify(won)), daily.date), true);
  const legacy = structuredClone(won);
  for (const record of [...legacy.records, ...legacy.floorSnapshot.records]) record.stars = 3;
  assert.equal(validateSave(legacy, daily.date), true);
});

test('the share card shows each floor\'s moves against par, one floor per line', () => {
  const won = playRoute();
  const pars = floorPars(daily);
  const lines = (state) => getShareText(state, pars).split('\n');
  const plain = (line) => line.replace(/ [\u{1F1EB}\u{1F1F7}🏰🔱]+$/u, '');
  assert.equal(lines(won)[0], `Dungeon Chess Daily · ${shareDate(won.date)}`);
  assert.deepEqual(lines(won).slice(1, 4).map(plain), ['🟥', '⬛', '👑'].map((mark, floor) => `${mark} ${signed(route[floor] - pars[floor])}`));
  const even = structuredClone(won); even.records.forEach((record, floor) => { record.scored = pars[floor]; });
  assert.deepEqual(lines(even).slice(1, 4).map(plain), ['🟥 E', '⬛ E', '👑 E']);
  const off = structuredClone(even); off.records[0].scored = pars[0] + 3; off.records[2].scored = pars[2] - 1;
  assert.deepEqual(lines(off).slice(1, 4).map(plain), ['🟥 +3', '⬛ E', `👑 ${signed(-1)}`]);
  let playing = null;
  playRoute((state) => { if (!playing && state.floor === 2) playing = structuredClone(state); });
  assert.deepEqual(lines(playing).slice(1, 4).map(plain), [`🟥 ${signed(route[0] - pars[0])}`, `⬛ ${signed(route[1] - pars[1])}`, '👑 ·']);
  const wide = structuredClone(won); wide.records.forEach((record, floor) => { record.scored = pars[floor] + 42; });
  assert.deepEqual(lines(wide).slice(1, 4).map(plain), ['🟥 +42', '⬛ +42', '👑 +42']);
});

test('moves spent before a floor restart keep counting toward that floor; a new try starts fresh', () => {
  const pars = floorPars(daily);
  const actions = daily.generation.certificate.actions;
  // Play a few moves of floor 1, restart it, then finish the certified route.
  let state = createGame(daily);
  const spent = 3;
  for (const action of actions.slice(0, spent)) state = act(state, action);
  assert.equal(state.floor, 0);
  state = resetFloor(state);
  assert.equal(state.restartedMoves, spent);
  assert.equal(state.turns, 0, 'the floor itself starts over');
  assert.equal(floorScoredMoves(state), spent);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true);
  // A second restart adds that attempt's moves too.
  state = act(state, actions[0]);
  assert.equal(floorScoredMoves(state), spent + 1);
  state = resetFloor(state);
  assert.equal(state.restartedMoves, spent + 1);
  let cleared = null;
  for (const action of actions) {
    state = act(state, action);
    if (!cleared && state.floor === 0 && state.objective.complete) cleared = state;
  }
  assert.equal(state.status, 'won');
  assert.ok([...(cleared.notes ?? []), cleared.message].some((line) => line.startsWith(`You completed the challenge ✓ in ${route[0] + spent + 1} moves`)));
  assert.equal(state.records[0].restartedMoves, spent + 1);
  assert.equal(state.records[0].scored, route[0], 'the attempt that cleared the floor matches the route');
  assert.deepEqual(state.records.map(scoredMoves), [route[0] + spent + 1, route[1], route[2]]);
  assert.equal(playerRun(state).moves, route[0] + route[1] + route[2] + spent + 1);
  assert.equal(state.restartedMoves, undefined, 'later floors start with no earlier moves');
  assert.equal(getShareText(state, pars).split('\n')[1].split(' ')[1], signed(route[0] + spent + 1 - pars[0]));
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true);
  // Older saves carry no count: nothing earlier on the floor. Forged ones are rejected.
  const legacy = structuredClone(state); delete legacy.records[0].restartedMoves;
  for (const record of [...legacy.floorSnapshot.records]) delete record.restartedMoves;
  assert.equal(validateSave(legacy, daily.date), true);
  for (const bad of [0, -1, 1.5, '4']) {
    const forged = createGame(daily); forged.restartedMoves = bad;
    assert.equal(validateSave(forged, daily.date), false, `restartedMoves ${bad}`);
  }
  const snapshot = createGame(daily); snapshot.floorSnapshot.restartedMoves = 2;
  assert.equal(validateSave(snapshot, daily.date), false);
  // Losing every life is a new try: the count starts over.
  let doomed = createGame(daily);
  for (const action of actions.slice(0, spent)) doomed = act(doomed, action);
  doomed = resetFloor(doomed);
  doomed.status = 'lost';
  const retry = retryLostRun(doomed);
  assert.equal(retry.tries, 2);
  assert.equal(retry.restartedMoves, undefined);
  assert.equal(floorScoredMoves(retry), 0);
});

test('the scored count stops when the challenge is complete; later moves still count for collapse', () => {
  let done = null;
  playRoute((state) => { if (!done && state.floor === 0 && state.objective.complete) done = state; });
  const frozen = floorScoredMoves(done);
  assert.equal(frozen, done.turns - done.floorStart.turns);
  assert.ok([...(done.notes ?? []), done.message].some((line) => line.startsWith(`You completed the challenge ✓ in ${frozen} move`)));
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
