// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, getShareText, validateSave, floorScoredMoves, scoredMoves, resetFloor, retryLostRun } from '../src/game.js';
import { botRun, playerRun } from '../src/bot.js';
import { floorPars, parFor, runPars } from '../src/par.js';
import { EDITIONS } from '../src/editions.js';
import { decodeRoute } from '../src/route-code.js';

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

test('each floor\'s par is its planted line plus one, for the official piece, color and monsters only', () => {
  const pars = floorPars(daily);
  assert.deepEqual(pars, route.map((moves) => moves + 1));
  const state = createGame(daily);
  assert.equal(parFor(state, daily), pars[0]);
  assert.deepEqual(runPars(createPracticeGame(daily), daily), pars);
  const otherPiece = daily.playerPiece === 'rook' ? 'bishop' : 'rook';
  assert.equal(parFor(createPracticeGame(daily, { piece: otherPiece }), daily), null);
  assert.equal(parFor(createPracticeGame(daily, { color: 'black' }), daily), null);
  assert.equal(parFor(createPracticeGame(daily, { difficulty: 'gentle' }), daily), null);
  assert.equal(floorPars({ ...daily, generation: undefined }), null);
  // Only a whole day's certificate has pars: three floors, each closed by its stairs.
  const actions = daily.generation.certificate.actions;
  assert.equal(floorPars({ generation: { certificate: { actions: actions.slice(0, -1) } } }), null);
  assert.deepEqual(floorPars({ generation: { certificate: { actions: [{ type: 'wait' }, { type: 'descend' }, { type: 'move', x: 1, y: 1 }, { type: 'wait' }, { type: 'descend' }, { type: 'descend' }] } } }), [2, 3, 1]);
});

test('every stored edition\'s par is its lines plus one: 4 or 5 a floor, 6 or 7 on a rare walk', () => {
  const tally = {};
  for (const [date, entry] of Object.entries(EDITIONS)) {
    const pars = floorPars({ generation: { certificate: { actions: decodeRoute(entry.route) } } });
    assert.equal(pars?.length, 3, date);
    for (const par of pars) tally[par] = (tally[par] ?? 0) + 1;
  }
  assert.deepEqual(Object.keys(tally).map(Number).sort(), [4, 5, 6, 7]);
  assert.ok(tally[6] + tally[7] <= 6, `few walks: ${JSON.stringify(tally)}`);
});

test('the certified route replays and validates, and older saves carrying stars still validate', () => {
  let checked = 0;
  const won = playRoute((state) => {
    if (checked++ % 5) return;
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true, `turn ${state.turns}`);
  });
  assert.equal(won.status, 'won');
  assert.deepEqual(won.records.map(scoredMoves), route);
  assert.ok(won.records.every((record) => record.stars === undefined));
  assert.equal(validateSave(JSON.parse(JSON.stringify(won)), daily.date), true);
  const legacy = structuredClone(won);
  for (const record of [...legacy.records, ...legacy.floorSnapshot.records]) record.stars = 3;
  assert.equal(validateSave(legacy, daily.date), true);
});

test('the share card shows each floor\'s moves against par, the floors side by side on one line', () => {
  const won = playRoute();
  const pars = floorPars(daily);
  const floors = (state) => getShareText(state, pars).split('\n')[1].split('  ');
  const plain = (floor) => floor.replace(/ [\u{1F1EB}\u{1F1F7}🏰🔱]+$/u, '');
  // A floor's score set to `total`: its scored moves, besides the captures its record keeps.
  const scoreAs = (record, total) => { record.scored = total - (record.hits ?? 0); };
  assert.equal(getShareText(won, pars, { now: new Date(Date.UTC(2026, 10, 5)) }).split('\n')[0], 'Dungeon Chess Daily · Nov 5 ♟\uFE0E');
  assert.deepEqual(floors(won).map(plain), ['🟥', '⬛', '👑'].map((mark, floor) => `${mark} ${signed(route[floor] - pars[floor])}`));
  const even = structuredClone(won); even.records.forEach((record, floor) => scoreAs(record, pars[floor]));
  assert.deepEqual(floors(even).map(plain), ['🟥 E', '⬛ E', '👑 E']);
  const off = structuredClone(even); scoreAs(off.records[0], pars[0] + 3); scoreAs(off.records[2], pars[2] - 1);
  assert.deepEqual(floors(off).map(plain), ['🟥 +3', '⬛ E', `👑 ${signed(-1)}`]);
  let playing = null;
  playRoute((state) => { if (!playing && state.floor === 2) playing = structuredClone(state); });
  assert.deepEqual(floors(playing).map(plain), [`🟥 ${signed(route[0] - pars[0])}`, `⬛ ${signed(route[1] - pars[1])}`, '👑 ·']);
  const wide = structuredClone(won); wide.records.forEach((record, floor) => scoreAs(record, pars[floor] + 42));
  assert.deepEqual(floors(wide).map(plain), ['🟥 +42', '⬛ +42', '👑 +42']);
});

test('moves spent before a floor restart keep counting toward that floor; a new try starts fresh', () => {
  const pars = floorPars(daily);
  const actions = daily.generation.certificate.actions;
  // Play a few moves of floor 1, restart it, then finish the certified route.
  let state = createGame(daily);
  const spent = 3;
  for (const action of actions.slice(0, spent)) state = act(state, action);
  assert.equal(state.floor, 0);
  // The floor's score so far: those moves, and every capture they took.
  const first = floorScoredMoves(state);
  assert.equal(first, spent + state.hits);
  state = resetFloor(state);
  assert.equal(state.restartedMoves, first);
  assert.equal(state.turns, 0, 'the floor itself starts over');
  assert.equal(state.hits, 0);
  assert.equal(floorScoredMoves(state), first);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true);
  // A second restart adds that attempt's moves too.
  state = act(state, actions[0]);
  const again = floorScoredMoves(state) - first;
  assert.equal(again, 1 + state.hits);
  state = resetFloor(state);
  const before = first + again;
  assert.equal(state.restartedMoves, before);
  let cleared = null;
  for (const action of actions) {
    state = act(state, action);
    if (!cleared && state.floor === 0 && state.objective.complete) cleared = state;
  }
  assert.equal(state.status, 'won');
  assert.ok([...(cleared.notes ?? []), cleared.message].some((line) => line.startsWith(`You completed the challenge ✓ in ${route[0] + before} moves`)));
  assert.equal(state.records[0].restartedMoves, before);
  assert.equal(scoredMoves(state.records[0]) - before, route[0], 'the attempt that cleared the floor matches the route');
  assert.deepEqual(state.records.map(scoredMoves), [route[0] + before, route[1], route[2]]);
  assert.equal(playerRun(state).moves, route[0] + route[1] + route[2] + before);
  assert.equal(state.restartedMoves, undefined, 'later floors start with no earlier moves');
  assert.equal(getShareText(state, pars).split('\n')[1].split(' ')[1], signed(route[0] + before - pars[0]));
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
  // A new try (here an old save's lost run) starts the count over.
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
  const moves = done.turns - done.floorStart.turns;
  assert.equal(frozen, moves + done.hits - done.floorStart.hits);
  assert.ok([...(done.notes ?? []), done.message].some((line) => line.startsWith(`You completed the challenge ✓ in ${frozen} move`)));
  const after = act(act(done, { type: 'wait' }), { type: 'wait' });
  assert.equal(after.turns, done.turns + 2, 'waiting still spends moves');
  assert.equal(floorScoredMoves(after), frozen + after.hits - done.hits, 'the waits are free; a capture still adds one');
  assert.equal(validateSave(JSON.parse(JSON.stringify(after)), daily.date), true);
  const left = act(after, { type: 'descend' });
  assert.equal(left.records[0].turns, moves + 2);
  assert.equal(left.records[0].scored, moves);
  assert.equal(scoredMoves(left.records[0]), floorScoredMoves(after));
  // Older records have no scored count: every move counts.
  assert.equal(scoredMoves({ turns: 9 }), 9);
  const legacy = structuredClone(left); delete legacy.records[0].scored; delete legacy.floorSnapshot.records[0].scored;
  assert.equal(validateSave(legacy, daily.date), true);
  const bogus = structuredClone(left); bogus.records[0].scored = bogus.records[0].turns + 1;
  assert.equal(validateSave(bogus, daily.date), false);
});
