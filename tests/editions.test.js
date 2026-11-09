// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITIONS, EDITIONS_RANGE } from '../src/editions.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';
import { generateDaily } from '../src/generation.js';
import { MAX_FLOOR_PAR, LONG_FLOOR_PAR } from '../src/difficulty.js';

test('routes survive the one-character-per-action encoding', () => {
  const actions = [{ type: 'move', x: 0, y: 0 }, { type: 'move', x: 7, y: 7 }, { type: 'wait' }, { type: 'move', x: 3, y: 5 }, { type: 'descend' }];
  assert.deepEqual(decodeRoute(encodeRoute(actions)), actions);
});

test('the precomputed table covers every date in its range', () => {
  assert.ok(EDITIONS_RANGE, 'src/editions.js must be generated');
  let count = 0;
  for (let time = Date.parse(EDITIONS_RANGE.start); time <= Date.parse(EDITIONS_RANGE.end); time += 86_400_000) {
    assert.ok(EDITIONS[new Date(time).toISOString().slice(0, 10)]);
    count++;
  }
  assert.equal(Object.keys(EDITIONS).length, count);
});

test('a precomputed edition is exactly the edition the search would certify', () => {
  const dates = Object.keys(EDITIONS);
  const fallback = dates.find((date) => EDITIONS[date].attempt === 'fallback');
  for (const date of [dates[0], dates[3], dates[40], ...(fallback ? [fallback] : [])]) {
    assert.deepEqual(generateDaily(date), generateDaily(date, { precomputed: false }), date);
  }
});

test('a date past the window is searched once, then replayed from device storage', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  try {
    const date = '2031-02-11';
    const searched = generateDaily(date);
    assert.equal(store.size, 1);
    const began = performance.now();
    const replayed = generateDaily(date);
    assert.ok(performance.now() - began < 1000);
    assert.deepEqual(replayed, searched);
    // A corrupt or tampered entry is ignored; the search runs again.
    for (const value of ['{', JSON.stringify({ tier: searched.difficulty, attempt: 7, route: '' }), JSON.stringify({ tier: searched.difficulty, attempt: 0, route: '...' })]) {
      store.set([...store.keys()][0], value);
      assert.deepEqual(generateDaily(date), searched);
    }
  } finally { delete globalThis.localStorage; }
});

test('stored floors stay short: a floor runs past par 10 on few days, never past 14', () => {
  const editions = Object.values(EDITIONS);
  const pars = editions.flatMap((entry) => entry.par);
  assert.ok(pars.every((par) => par <= LONG_FLOOR_PAR), `longest ${Math.max(...pars)}`);
  const long = editions.filter((entry) => entry.par.some((par) => par > MAX_FLOOR_PAR));
  assert.ok(long.length <= editions.length / 10, `${long.length} days with a floor over par ${MAX_FLOOR_PAR}`);
  assert.ok(long.every((entry) => entry.par.filter((par) => par > MAX_FLOOR_PAR).length === 1), 'never two long floors in a day');
});
