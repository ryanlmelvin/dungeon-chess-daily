// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, unreachablePickups } from '../src/rules.js';
import { getDaily } from '../src/generation.js';

test('powerups never sit on or beside the start square, and stay reachable (from 2026-11-06)', () => {
  for (let offset = 0; offset < 30; offset++) {
    const date = new Date(Date.UTC(2026, 10, 6 + offset)).toISOString().slice(0, 10);
    const daily = getDaily(date);
    let state = createGame(daily);
    const check = () => {
      const power = state.items.find((item) => item.type === 'powerup');
      assert.ok(power, `${date} floor ${state.floor}: no powerup`);
      const distance = Math.max(Math.abs(power.x - state.player.x), Math.abs(power.y - state.player.y));
      assert.ok(distance >= 2, `${date} floor ${state.floor}: powerup at ${power.x},${power.y} is ${distance} from the start`);
      assert.ok(!unreachablePickups(state).includes(power), `${date} floor ${state.floor}: powerup unreachable`);
    };
    check();
    for (const action of daily.generation.certificate.actions) {
      state = act(state, action);
      if (action.type === 'descend' && state.status === 'playing') check();
    }
  }
});

test('editions before the rule keep their published powerup square', () => {
  const state = createGame(getDaily('2026-11-05'));
  const power = state.items.find((item) => item.type === 'powerup');
  const expected = { bishop: [3, 5], knight: [3, 4] }[state.startingPiece] ?? [4, 5];
  assert.deepEqual([power.x, power.y], expected);
});
