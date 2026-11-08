// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, getDaily, legalMoves } from '../src/game.js';
import { autoExplainer } from '../src/explainers.js';

const unseen = () => false;

test('a waiting recruit never opens its explainer by itself', () => {
  const state = createGame(getDaily('2026-11-05'));
  assert.ok(!state.companion && state.items.some((item) => item.type === 'companion'), 'the first floor has a waiting recruit');
  // Not after any first move, even on a device that has seen no explainer yet.
  for (const action of [{ type: 'wait' }, ...legalMoves(state).map(({ x, y }) => ({ type: 'move', x, y }))]) {
    assert.equal(autoExplainer(act(state, action).events, unseen), null, JSON.stringify(action));
  }
  assert.equal(autoExplainer([{ type: 'companion-recruit', x: 4, y: 4 }], unseen), null, 'nor on recruiting it');
});

test('your en passant and castling always open their explainers; the first fork and combo once', () => {
  assert.equal(autoExplainer([{ type: 'en-passant' }], () => true), 'en-passant');
  assert.equal(autoExplainer([{ type: 'castle' }], () => true), 'castle');
  assert.equal(autoExplainer([{ type: 'fork-won' }, { type: 'combo' }], unseen), 'fork');
  assert.equal(autoExplainer([{ type: 'combo' }], unseen), 'combo');
  assert.equal(autoExplainer([{ type: 'fork-won' }], (kind) => kind === 'fork'), null, 'once per device');
  assert.equal(autoExplainer([{ type: 'move' }, { type: 'capture' }], unseen), null);
});

test('the first cracked ceiling explains the cave-in countdown once; tactics go first', () => {
  const crack = { type: 'cave-crack', x: 4, y: 0, moves: 5 };
  assert.equal(autoExplainer([{ type: 'capture' }, crack], unseen), 'cave-in');
  assert.equal(autoExplainer([crack], (kind) => kind === 'cave-in'), null, 'once per device');
  assert.equal(autoExplainer([{ type: 'fork-won' }, crack], unseen), 'fork');
  assert.equal(autoExplainer([{ type: 'cave-tremor', x: 4, y: 0, left: 3, total: 5 }], unseen), null, 'never on the moves after');
});

test('the bishop pair’s hop offers its explainer from its line’s What? button, never by itself', () => {
  assert.equal(autoExplainer([{ type: 'companion-phase' }, { type: 'bishop-pair' }, { type: 'companion-move' }], unseen), null);
  assert.equal(autoExplainer([{ type: 'bishop-pair' }], () => true), null);
});
