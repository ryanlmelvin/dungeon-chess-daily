// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, unreachablePickups, coinlessFloor } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
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

// Keyed by the launch seed (LEGACY_LAYOUT_SEEDS). The public 2026-11-05 edition is
// now regenerated under its weekday tier, so these check the seed's own layout.
test('editions before the rule keep their published powerup square', () => {
  const state = createGame(getRawDaily('2026-11-05'));
  const power = state.items.find((item) => item.type === 'powerup');
  const expected = { bishop: [3, 5], knight: [3, 4] }[state.startingPiece] ?? [4, 5];
  assert.deepEqual([power.x, power.y], expected);
});

// Gold buys from the between-floor shop and nothing else, so the last floor has no use for it.
test('the last floor holds no coins or coin magnet, and the shop before it sells no magnet (from 2026-11-06)', () => {
  for (let offset = 0; offset < 30; offset++) {
    const date = new Date(Date.UTC(2026, 10, 6 + offset)).toISOString().slice(0, 10);
    const daily = getDaily(date);
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) {
      if (action.type === 'descend' && state.floor === 1) {
        const shopper = { ...structuredClone(state), gold: 20 };
        assert.equal(act(shopper, { type: 'buy', id: 'magnet' }), shopper, `${date}: magnet sold before the last floor`);
        assert.notEqual(act(shopper, { type: 'buy', id: 'shield' }), shopper, `${date}: shop closed before the last floor`);
      }
      if (action.type === 'descend' && state.floor === 0) {
        const shopper = { ...structuredClone(state), gold: 20 };
        assert.equal(act(shopper, { type: 'buy', id: 'magnet' }) !== shopper, daily.shops[0].includes('magnet'), `${date}: magnet sold before floor 2 exactly when stocked`);
      }
      state = act(state, action);
      if (action.type !== 'descend' || state.status !== 'playing') continue;
      const coins = state.items.filter((item) => item.type === 'coin').length;
      assert.equal(coins, state.floor === 2 ? 0 : 3, `${date} floor ${state.floor}`);
      if (state.floor === 2) assert.ok(!state.items.some((item) => item.power === 'magnet'), `${date}: magnet on the last floor`);
    }
  }
});

test('the launch seed keeps its coins and relics on the last floor', () => {
  const state = createGame(getRawDaily('2026-11-05'));
  assert.equal(coinlessFloor(state, 2), false);
  assert.equal(coinlessFloor(createGame(getRawDaily('2026-11-06')), 2), true);
});
