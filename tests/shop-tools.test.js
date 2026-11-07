// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, dangerTiles, getDaily, legalMoves, SHOP_ITEMS } from '../src/game.js';
import { PIN_MOVES, takebackTarget, shopOffers } from '../src/rules.js';
import { shopStock, SHOP_SIZE } from '../src/edition.js';

const daily = getDaily('2026-11-05');
const move = (x, y) => ({ type: 'move', x, y });
const hasMove = (state, x, y) => legalMoves(state).some((tile) => tile.x === x && tile.y === y);
function scenario(piece = 'rook', x = 4, y = 6) {
  const state = createGame(daily);
  state.playerColor = 'white'; state.modifier = 'none';
  state.player = { piece, x, y, hp: 2, maxHp: 2, moved: false };
  state.enemies = []; state.items = []; state.map = Array(8).fill('........'); state.props = []; state.objective = { piece: 'king', complete: false };
  return state;
}
function monster(id, piece, x, y, target = null) {
  return { id, piece, role: piece, species: 'bat', name: 'Bat', x, y, moved: false, phase: target ? 'aim' : 'ready', target, intent: target ? [{ ...target }] : [] };
}

const dates = Array.from({ length: 60 }, (_, day) => new Date(Date.UTC(2026, 10, 7 + day)).toISOString().slice(0, 10));

test('each shop offers the extra life plus three drawn items, the same for everyone, varying by shop and day', () => {
  let differ = 0;
  for (const date of dates) {
    const [first, second] = [shopStock(date, 0), shopStock(date, 1)];
    for (const offers of [first, second]) {
      assert.equal(offers.length, SHOP_SIZE);
      assert.ok(offers.includes('life'), `${date}: extra life always stocked`);
      assert.ok(offers.every((id) => SHOP_ITEMS.some((item) => item.id === id)));
    }
    assert.ok(!second.includes('magnet'), `${date}: no magnet before the coinless last floor`);
    assert.deepEqual(getDaily(date).shops, [first, second]);
    assert.deepEqual(shopStock(date, 0), first, 'deterministic');
    if (first.join() !== second.join()) differ++;
  }
  assert.ok(differ > 30, 'the two shops usually differ');
  assert.ok(new Set(dates.map((date) => shopStock(date, 0).join())).size > 5, 'offers change from day to day');
});

test('the shop sells the three tools beside the ward, magnet and extra life, but no hourglass, and only what it stocks', () => {
  assert.deepEqual(SHOP_ITEMS.map((item) => item.id), ['shield', 'pin', 'leap', 'takeback', 'magnet', 'life']);
  for (const id of ['pin', 'leap', 'takeback']) {
    const state = scenario(); state.enemies = [monster('k', 'king', 4, 2)]; state.gold = 9;
    state.date = dates.find((date) => shopStock(date, 0).includes(id));
    const missing = { ...structuredClone(state), date: dates.find((date) => !shopStock(date, 0).includes(id)) };
    const unstocked = act(missing, move(4, 2));
    assert.equal(act(unstocked, { type: 'buy', id }), unstocked, `${id}: not for sale when not stocked`);
    assert.ok(shopOffers(state).includes(id));
    const cleared = act(state, move(4, 2));
    const bought = act(cleared, { type: 'buy', id });
    assert.equal(bought.powers[id], 1, id);
    assert.equal(act(bought, { type: 'buy', id }), bought, `${id}: one held at a time`);
  }
});

test('a pin is free, clears an aimed attack, and holds the monster for three monster turns', () => {
  const state = scenario();
  const rook = monster('r', 'rook', 0, 6, { x: 4, y: 6 });
  state.enemies = [rook, monster('k', 'king', 7, 0)]; state.powers.pin = 1;
  const pinned = act(state, { type: 'pin', id: 'r' });
  assert.equal(pinned.turns, state.turns, 'pinning spends no move');
  assert.equal(pinned.powers.pin, 0);
  assert.deepEqual(dangerTiles(pinned), []);
  assert.equal(pinned.enemies[0].pinned, PIN_MOVES);
  let next = pinned;
  for (let turn = 1; turn <= PIN_MOVES; turn++) {
    next = act(next, { type: 'wait' });
    assert.deepEqual([next.enemies[0].x, next.enemies[0].y], [0, 6], `held on monster turn ${turn}`);
    assert.equal(next.player.hp, 2);
  }
  assert.equal(next.enemies[0].pinned, undefined, 'the pin wears off');
  assert.equal(act(next, { type: 'pin', id: 'r' }), next, 'one pin per purchase');
});

test('a pinned monster beside you can’t capture at close range', () => {
  const state = scenario('rook', 4, 6);
  state.enemies = [monster('n', 'knight', 3, 3), monster('k', 'king', 7, 0)]; state.powers.pin = 1;
  // The knight at (3,3) covers (4,5): stepping there is normally a close-range capture.
  const exposed = act(state, move(4, 5));
  assert.equal(exposed.player.hp, 1);
  const safe = act(act(state, { type: 'pin', id: 'n' }), move(4, 5));
  assert.equal(safe.player.hp, 2);
});

test('a king can be pinned like any monster before the last floor, where it is always a decoy', () => {
  const state = scenario('rook', 4, 6);
  state.floor = 1; state.objective = { piece: 'pawn', complete: false }; state.powers.pin = 1;
  state.enemies = [monster('k', 'king', 3, 4), monster('p', 'pawn', 0, 0)];
  // Stepping beside the king, to (4,5), is normally a close-range capture.
  assert.equal(act(state, move(4, 5)).player.hp, 1);
  const pinned = act(state, { type: 'pin', id: 'k' });
  assert.notEqual(pinned, state, 'refusing a king would point it out');
  assert.equal(pinned.enemies[0].pinned, PIN_MOVES);
  assert.equal(pinned.powers.pin, 0);
  let next = act(pinned, move(4, 5));
  assert.equal(next.player.hp, 2, 'a pinned king can’t capture at close range');
  for (let turn = 2; turn <= PIN_MOVES; turn++) next = act(next, { type: 'wait' });
  assert.deepEqual([next.enemies[0].x, next.enemies[0].y], [3, 4], `held for ${PIN_MOVES} monster turns`);
  assert.equal(next.player.hp, 2);
  assert.equal(next.enemies[0].pinned, undefined, 'the pin wears off');
});

test('a Borrowed move offers knight squares without arming, spent only when used', () => {
  const state = scenario('rook'); state.enemies = [monster('k', 'king', 7, 0)];
  assert.equal(hasMove(state, 5, 4), false);
  state.powers.leap = 1;
  assert.equal(hasMove(state, 5, 4), true, 'offered as soon as it is held');
  assert.equal(legalMoves(state).find((tile) => tile.x === 5 && tile.y === 4).borrowed, 'knight', 'marked with the piece to ghost');
  assert.equal(legalMoves(state).find((tile) => tile.x === 4 && tile.y === 5).borrowed, undefined, 'own moves are not borrowed');
  const ordinary = act(state, move(4, 5));
  assert.equal(ordinary.powers.leap, 1, 'a rook move leaves it held');
  const leapt = act(ordinary, move(5, 3));
  assert.deepEqual([leapt.player.x, leapt.player.y], [5, 3]);
  assert.equal(leapt.powers.leap, 0);
  assert.ok(leapt.events.some((event) => event.type === 'leap'));
  assert.equal(hasMove(leapt, 6, 1), false);
  // A knight borrows a queen's line instead.
  const knight = scenario('knight'); knight.enemies = [monster('k', 'king', 7, 0)]; knight.powers.leap = 1;
  assert.equal(hasMove(knight, 4, 2), true);
});

test('a Take-back undoes the last move, a lost life included, once per purchase', () => {
  const state = scenario(); state.powers.takeback = 1;
  state.enemies = [monster('r', 'rook', 0, 6, { x: 4, y: 6 }), monster('k', 'king', 7, 0)];
  assert.equal(takebackTarget(state), null, 'nothing to take back yet');
  const hit = act(state, { type: 'wait' });
  assert.equal(hit.player.hp, 1);
  const back = act(hit, { type: 'takeback' });
  assert.equal(back.player.hp, 2); assert.equal(back.turns, state.turns);
  assert.equal(back.powers.takeback, 0);
  assert.equal(act(back, { type: 'takeback' }), back);
  const later = act(back, move(4, 5));
  assert.equal(takebackTarget(later), null, 'used up');
});

test('a Take-back can undo the move that ended the run, but not cross the stairs', () => {
  const state = scenario(); state.player.hp = state.player.maxHp = 1; state.powers.takeback = 1;
  state.enemies = [monster('r', 'rook', 0, 6, { x: 4, y: 6 }), monster('k', 'king', 7, 0)];
  const lost = act(state, { type: 'wait' });
  assert.ok(lost.events.some((event) => event.type === 'restart'));
  const back = act(lost, { type: 'takeback' });
  assert.deepEqual(back.enemies.map((foe) => foe.id), ['r', 'k']);
  assert.equal(back.tries, state.tries);
  const cleared = scenario(); cleared.powers.takeback = 1; cleared.enemies = [monster('k', 'king', 4, 2)];
  const won = act(cleared, move(4, 2));
  assert.ok(takebackTarget(won));
  assert.equal(takebackTarget(act(won, { type: 'descend' })), null);
});

test('a pin is never sold before the last floor and can’t be used there', () => {
  assert.ok(dates.every((date) => !shopStock(date, 1).includes('pin')));
  const state = scenario(); state.floor = 2; state.powers.pin = 1;
  state.enemies = [monster('r', 'rook', 0, 6), monster('k', 'king', 7, 0)];
  assert.equal(act(state, { type: 'pin', id: 'r' }), state);
  // A pin left over from the first shop stays behind on the stairs to the last floor.
  const floor2 = createGame(getDaily(dates.find((date) => shopStock(date, 0).includes('pin'))));
  const cleared = { ...structuredClone(floor2), floor: 1, objective: { ...floor2.objective, complete: true }, exit: { ...floor2.exit, open: true } };
  cleared.powers.pin = 1;
  const last = act(cleared, { type: 'descend' });
  assert.equal(last.floor, 2); assert.equal(last.powers.pin, 0);
  assert.match(last.message, /pin stays behind/);
});
