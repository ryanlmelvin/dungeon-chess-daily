// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Every edition is composed (src/generation.js): the rules that once held on
// composed preview days hold on every room, saves of composed rooms validate
// (their own census of targets and residents, held decoys, a mate's save, and
// saves made while random rooms still shipped), and no stored room stacks two
// monsters on a square.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, floorCensus, legalMoves, validateSave } from '../src/rules.js';
import { getDaily } from '../src/generation.js';
import { EDITIONS } from '../src/editions.js';
import { decodeRooms } from '../src/room-code.js';
import { withRooms } from './fixtures/rooms.js';

const move = (x, y) => ({ type: 'move', x, y });
const key = (tile) => `${tile.x},${tile.y}`;
const play = (daily, actions) => actions.reduce((state, action) => act(state, action), createGame(daily));

test('no stored room stacks two monsters on a square, or starts one on the player', () => {
  for (const [date, entry] of Object.entries(EDITIONS)) {
    decodeRooms(entry.rooms).forEach((room, floor) => {
      const squares = room.enemies.map(key);
      assert.equal(new Set(squares).size, squares.length, `${date} floor ${floor + 1}`);
      assert.ok(!squares.includes(key(room.start ?? { x: 4, y: 6 })), `${date} floor ${floor + 1}: a monster on the start`);
      assert.ok(room.items.filter((item) => item.type === 'companion').length <= 1, `${date} floor ${floor + 1}`);
    });
  }
});

test('the save right after a mate validates, the mating move on your recruit\'s square too', () => {
  // 2027-03-21 (a pawn, Ice): the new queen mates on d5, the square the recruit king stands on.
  for (const date of ['2027-03-21', '2026-11-05', '2026-11-11']) {
    const daily = getDaily(date);
    const won = play(daily, daily.generation.certificate.actions.slice(0, -1));
    assert.ok(won.events.some((event) => event.type === 'checkmate'), `${date}: the line ends in a mate`);
    assert.equal(validateSave(JSON.parse(JSON.stringify(won)), date, daily), true, date);
    if (won.companion) assert.equal(won.companion.sharing, won.companion.x === won.player.x && won.companion.y === won.player.y, date);
    const out = act(won, { type: 'descend' });
    assert.equal(out.status, 'won');
    assert.equal(validateSave(JSON.parse(JSON.stringify(out)), date, daily), true, date);
  }
});

test('a composed room counts its own targets and residents: two pawns are a pawn target, and decoys pay', () => {
  // A day whose floor 1 asks for pawns: two of them, not eight.
  const date = Object.keys(EDITIONS).find((day) => getDaily(day).targets[0] === 'pawn');
  const daily = getDaily(date);
  const state = createGame(daily);
  assert.deepEqual(floorCensus(state), { residents: daily.composed[0].enemies.length, targets: 2 });
  assert.equal(state.enemies.filter((foe) => foe.role === 'pawn').length, 2);
  // Clear the floor as its line does, then take a decoy too: it pays a gold, the floor grades silver.
  const actions = daily.generation.certificate.actions;
  let cleared = play(daily, actions.slice(0, actions.findIndex((action) => action.type === 'descend')));
  assert.ok(cleared.exit.open);
  assert.equal(validateSave(JSON.parse(JSON.stringify(cleared)), date, daily), true);
  const decoy = cleared.enemies[0];
  assert.ok(decoy, `${date}: a decoy is left`);
  const taken = structuredClone(cleared);
  Object.assign(taken.player, { x: decoy.x, y: decoy.y });
  taken.enemies = taken.enemies.filter((foe) => foe !== taken.enemies[0]);
  taken.captures++; taken.gold++; taken.paidCaptures++;
  assert.equal(validateSave(JSON.parse(JSON.stringify(taken)), date, daily), true, 'a decoy capture pays one gold');
  const forged = structuredClone(taken); forged.gold++;
  assert.equal(validateSave(forged, date, daily), false, 'and one only');
  const below = act(taken, { type: 'descend' });
  assert.equal(below.records[0].grade, below.records[0].treasure === 3 ? 'gold' : 'silver');
  assert.equal(validateSave(JSON.parse(JSON.stringify(below)), date, daily), true);
  const plain = act(cleared, { type: 'descend' });
  assert.equal(plain.records[0].grade, plain.records[0].treasure === 3 ? 'gold' : 'bronze', 'the targets alone are no extra captures');
});

test('a held decoy\'s sleep validates, even past a pin\'s three moves', () => {
  let checked = 0;
  for (const date of Object.keys(EDITIONS)) {
    const daily = getDaily(date);
    const held = daily.composed[0].enemies.filter((foe) => (foe.held ?? 0) > 3);
    if (!held.length) continue;
    const state = createGame(daily);
    assert.ok(state.enemies.some((foe) => foe.held && foe.pinned > 3), date);
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), date, daily), true, date);
    const forged = structuredClone(state);
    forged.enemies.find((foe) => foe.held).pinned = 9;
    assert.equal(validateSave(forged, date, daily), false, `${date}: no longer than its room says`);
    if (++checked === 3) break;
  }
  assert.equal(checked, 3, 'three days with a decoy asleep for four moves');
});

// Saves made before random rooms were retired carry their layout fields and an
// empty recruit-order ledger (src/rules.js validateSave). Nothing reads them.
const RETIRED = { dungeonSeed: 0, obstacleBase: 7, decoys: 2, scatter: 0, guards: 0, screens: 0, legacyTurnOrder: false, openFiles: 2, companionOrders: [] };
const withRetired = (state) => ({ ...state, ...structuredClone(RETIRED), dungeonSeed: state.seed, ...(state.floorSnapshot && { floorSnapshot: withRetired(state.floorSnapshot) }) });
const withoutRetired = (state) => {
  const rest = Object.fromEntries(Object.entries(state).filter(([field]) => !Object.hasOwn(RETIRED, field)));
  return { ...rest, ...(state.floorSnapshot && { floorSnapshot: withoutRetired(state.floorSnapshot) }) };
};

test('a save made before random rooms were retired still loads and plays on the same; a recruit order no longer can', () => {
  for (const date of ['2026-11-12', '2027-03-21']) {
    const daily = getDaily(date);
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) {
      const saved = JSON.parse(JSON.stringify(withRetired(state)));
      assert.equal(validateSave(saved, date, daily), true, `${date} turn ${state.turns}`);
      const next = act(state, action);
      assert.deepEqual(withoutRetired(act(saved, action)), next, `${date} turn ${state.turns}`);
      state = next;
    }
    assert.equal(state.status, 'won');
    const ordered = { ...withRetired(createGame(daily)), companionOrders: [{ floor: 1, piece: 'rook' }] };
    assert.equal(validateSave(ordered, date, daily), false, 'recruits are never sold, so no order waits');
  }
});

test('the king rules hold on any king floor: a mate wins as it lands, and the king spares a guarded piece', () => {
  // A king floor set up by hand on an open room: the royal king in the a8 corner.
  const state = createGame(withRooms('2026-11-16'));
  const king = { id: 'king', piece: 'king', role: 'king', species: 'bat', palette: 'ice', name: 'Ice bat', x: 0, y: 0, moved: true, phase: 'ready', target: null, intent: [] };
  Object.assign(state, { floor: 2, props: [], items: [], enemies: [king], awaitingPlayer: false });
  state.map = Array(8).fill('........'); state.map[1] = '##......';
  state.objective = { piece: 'king', complete: false }; state.exit = { x: 4, y: 0, open: false };
  state.companion = { piece: 'king', basePiece: 'king', x: 3, y: 1, moved: true, sharing: false };
  Object.assign(state.player, { piece: 'rook', x: 7, y: 6 });
  // Rook to h8 checks along the rank; a7 and b7 are walls: mate as the move lands.
  const mated = act(state, move(7, 0));
  assert.ok(mated.events.some((event) => event.type === 'checkmate') && mated.exit.open);
  // K2: beside the king, guarded by the recruit king, your rook is safe from it.
  const guarded = structuredClone(state);
  guarded.map = Array(8).fill('........');
  guarded.enemies = [{ ...king, x: 3, y: 3 }];
  guarded.companion = { ...guarded.companion, x: 5, y: 4 };
  Object.assign(guarded.player, { x: 4, y: 7 });
  assert.ok(legalMoves(guarded).some((tile) => tile.x === 4 && tile.y === 4));
  const beside = act(guarded, { ...move(4, 4), recruit: 'hold' });
  assert.equal(beside.hits, 0, 'the king never takes a piece the recruit king guards');
});
