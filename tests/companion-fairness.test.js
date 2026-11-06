// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, PIECES } from '../src/rules.js';
import { generateDaily } from '../src/generation.js';
import { findWinningRoute, verifyWinningRoute } from '../src/fairness.js';

const daily = generateDaily('2026-11-05', { maxAttempts: 0 });
const actions = daily.generation.certificate.actions;

test('a reserved companion cannot support a no-power certificate before delivery', () => {
  for (const piece of PIECES) {
    const initial = createGame(daily);
    initial.companionOrders = [{ floor: 1, piece }];
    assert.equal(initial.companion, null);
    const result = verifyWinningRoute(initial, actions);
    assert.equal(result.valid, false);
    assert.match(result.reason, /fresh, unpowered/);
    assert.deepEqual(findWinningRoute(initial), { status: 'unknown', explored: 0 });
  }
});

test('empty and absent order ledgers preserve existing no-power certificates', () => {
  for (const legacy of [false, true]) {
    const initial = createGame(daily);
    initial.companionOrders = [];
    if (legacy) delete initial.companionOrders;
    const result = verifyWinningRoute(initial, actions);
    assert.equal(result.valid, true, result.reason);
    assert.deepEqual(result.metrics, daily.generation.certificate.metrics);
  }
});

test('malformed order ledgers cannot masquerade as an unpowered state', () => {
  for (const companionOrders of [null, {}, '', 'rook', 0]) {
    const initial = createGame(daily);
    initial.companionOrders = companionOrders;
    const result = verifyWinningRoute(initial, actions);
    assert.equal(result.valid, false);
    assert.match(result.reason, /fresh, unpowered/);
    assert.deepEqual(findWinningRoute(initial), { status: 'unknown', explored: 0 });
  }
});
