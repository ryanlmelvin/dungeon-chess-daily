// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { guideSeenKey, isFirstVisit, markGuideSeen } from '../src/first-visit.js';
import { planBackupMerge } from '../src/backups.js';

const scope = '/';
const prefix = `dchess:${scope}:`;

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => { map.set(name, String(value)); },
    map,
  };
}

test('a fresh device opens the guide once, then never again', () => {
  const storage = memoryStorage();
  assert.equal(isFirstVisit(storage, { prefix, scope }), true);
  markGuideSeen(storage, scope);
  assert.equal(storage.getItem(guideSeenKey(scope)), '1');
  assert.equal(isFirstVisit(storage, { prefix, scope }), false);
});

test('returning players with saves, preferences or tactic flags never get it', () => {
  for (const name of [`${prefix}daily:v6:2026-11-06`, `${prefix}daily:2026-01-02`, `${prefix}sound`, `${prefix}practice:v6:2026-11-06`, `dchess-tactic-seen:${scope}:fork`]) {
    assert.equal(isFirstVisit(memoryStorage({ [name]: 'x' }), { prefix, scope }), false, name);
  }
  // Another deployment scope on the same origin doesn't count.
  assert.equal(isFirstVisit(memoryStorage({ 'dchess:/other/:sound': 'on' }), { prefix, scope }), true);
});

test('unavailable storage never auto-opens the guide or throws', () => {
  const broken = { get length() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, key() { return null; } };
  assert.equal(isFirstVisit(broken, { prefix, scope }), false);
  assert.doesNotThrow(() => markGuideSeen(broken, scope));
});

test('the seen flag stays out of the save prefix, so backups never carry it', () => {
  assert.equal(guideSeenKey(scope).startsWith(prefix), false);
  // Export collects only prefixed keys; a restore of that backup still validates.
  const storage = memoryStorage();
  markGuideSeen(storage, scope);
  storage.setItem(`${prefix}sound`, 'off');
  const saves = Object.fromEntries([...storage.map].filter(([name]) => name.startsWith(prefix)).map(([name, value]) => [name.slice(prefix.length), value]));
  assert.deepEqual(Object.keys(saves), ['sound']);
  assert.doesNotThrow(() => planBackupMerge(new Map(), { app: 'dungeon-chess-daily', schema: 1, saves }));
});
