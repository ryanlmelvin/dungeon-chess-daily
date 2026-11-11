// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Checkmate on a composed king floor (src/rules.js, K1): a move of yours that
// mates wins as it lands, with your recruit where it stands. No recruit phase
// comes first (Manual asks for no order), and neither the recruit nor the
// monsters move, so Auto's step can't undo the mate. A mate your recruit's
// move completes still counts, checked after that move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, recruitChoice } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
const types = (state) => state.events.map((event) => event.type);

// A composed day's king floor (floor 3, index 2) on a rook day: your rook on
// `player`, the recruit king already at your side on `recruit`, and the royal
// king in the top-left corner on a8, walled in by `walls`.
function kingFloor({ player, recruit, walls }) {
  const room = { map: Array(8).fill('........'), enemies: [{ x: 0, y: 0, cast: 0 }], items: [] };
  const state = createGame({ ...getRawDaily('2026-11-16'), composed: [room, room, room] });
  const map = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (walls.some(([wx, wy]) => wx === x && wy === y) ? '#' : '.')).join(''));
  const king = { id: 'king', piece: 'king', role: 'king', species: 'bat', palette: 'ice', name: 'Ice bat', x: 0, y: 0, moved: true, phase: 'ready', target: null, intent: [] };
  Object.assign(state, { floor: 2, map, props: [], items: [], enemies: [king], awaitingPlayer: false });
  state.companion = { piece: 'king', basePiece: 'king', x: recruit[0], y: recruit[1], moved: true, sharing: false };
  state.objective = { piece: 'king', complete: false };
  state.exit = { x: 4, y: 0, open: false };
  Object.assign(state.player, { piece: 'rook', x: player[0], y: player[1] });
  return state;
}

// a7 and b7 walled: your rook's check along the eighth rank leaves the king no
// square. Your recruit on d7 would step to c8 on Auto (nearest the king) and
// block that check.
const boxed = () => kingFloor({ player: [7, 6], recruit: [3, 1], walls: [[0, 1], [1, 1]] });

test('a move that mates wins before the recruit moves, on Manual and Auto', () => {
  const state = boxed();
  assert.equal(recruitChoice(state, move(7, 0)), null, 'Manual asks for no order: h8 mates as it lands');
  for (const action of [move(7, 0), { ...move(7, 0), recruit: 'hold' }, { ...move(7, 0), recruit: { x: 2, y: 0 } }]) {
    const next = act(state, action);
    assert.ok(next.objective.complete && next.exit.open, 'the floor is won');
    assert.ok(types(next).includes('checkmate'), 'the Checkmate! moment plays');
    assert.match(next.message, /^Checkmate! /);
    assert.ok(!next.enemies.some((foe) => foe.role === 'king'), 'the mated king is taken');
    for (const type of ['companion-phase', 'companion-move', 'enemy-phase']) assert.ok(!types(next).includes(type), `no ${type}`);
    assert.deepEqual([next.companion.x, next.companion.y], [3, 1], 'the recruit stays where it stood; an order is ignored');
  }
});

test('a mate standing as you wait wins before the recruit moves', () => {
  const state = boxed();
  Object.assign(state.player, { x: 7, y: 0 });
  assert.equal(recruitChoice(state, wait), null);
  const next = act(state, wait);
  assert.ok(next.exit.open && types(next).includes('checkmate'));
  assert.deepEqual([next.companion.x, next.companion.y], [3, 1], 'Auto never stepped into the check');
});

test('a mate the recruit’s move completes still counts', () => {
  // Only a7 walled: after h8 the king could still step to b7, until the
  // recruit covers it from c7 (Auto's step from d6, nearest the king).
  const state = kingFloor({ player: [7, 6], recruit: [3, 2], walls: [[0, 1]] });
  const choice = recruitChoice(state, move(7, 0));
  assert.ok(choice?.moves.some((tile) => tile.x === 2 && tile.y === 1), 'no mate yet: the recruit step comes up');
  for (const action of [{ ...move(7, 0), recruit: { x: 2, y: 1 } }, move(7, 0)]) {
    const next = act(state, action);
    const order = types(next);
    assert.ok(next.exit.open && order.includes('checkmate'), 'the recruit on c7 completes the mate');
    assert.ok(order.indexOf('companion-move') < order.indexOf('checkmate'), 'checked after the recruit’s move');
    assert.ok(!order.includes('enemy-phase'), 'the monsters never move');
  }
  const held = act(state, { ...move(7, 0), recruit: 'hold' });
  assert.ok(!held.exit.open && !types(held).includes('checkmate'), 'held on d6, the king slips out');
});
