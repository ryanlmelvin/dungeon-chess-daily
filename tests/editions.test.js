// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITIONS, EDITIONS_RANGE } from '../src/editions.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';
import { generateDaily } from '../src/generation.js';

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
