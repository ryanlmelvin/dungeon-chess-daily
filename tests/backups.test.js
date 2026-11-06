// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { planBackupMerge } from '../src/backups.js';
import { act, createGame, getDaily, validateSave } from '../src/game.js';

const date = '2026-11-05';
const key = `daily:v5:${date}`;
const daily = getDaily(date);
let state = createGame(daily);
const initial = JSON.stringify(state);
let laterRoom;
for (const action of daily.generation.certificate.actions) {
  state = act(state, action);
  if (!laterRoom && state.floor === 1) laterRoom = JSON.stringify(state);
}
assert.equal(state.status, 'won');
assert.equal(validateSave(state, date), true);
const won = JSON.stringify(state);
const backup = (saves) => ({ app: 'dungeon-chess-daily', schema: 1, saves });
const legacy = (status = 'playing', floor = 0, overrides = {}) => JSON.stringify({ schema: 4, date, status, floor, ...overrides });
const legacyKey = `daily:v4:${date}`;

test('merge adds missing dates while retaining local-only and unknown data without mutating inputs', () => {
  const previousKey = 'daily:v4:2026-11-04';
  const current = new Map([[previousKey, legacy('playing', 0, { date: '2026-11-04' })], ['future-preference', 'keep']]);
  const data = backup({ [key]: initial });
  const beforeCurrent = [...current];
  const beforeBackup = structuredClone(data);
  const plan = planBackupMerge(current, data);
  assert.deepEqual([...plan.writes], [[key, initial]]);
  assert.equal(plan.archived, false);
  assert.deepEqual(plan.unreadable, []);
  const merged = new Map([...current, ...plan.writes]);
  assert.equal(merged.get(previousKey), current.get(previousKey));
  assert.equal(merged.get('future-preference'), 'keep');
  assert.deepEqual([...current], beforeCurrent);
  assert.deepEqual(data, beforeBackup);
});

test('completed valid v5 runs beat unfinished runs in both directions', () => {
  const restoreWin = planBackupMerge(new Map([[key, initial]]), backup({ [key]: won }));
  assert.equal(restoreWin.writes.get(key), won);
  const keepWin = planBackupMerge(new Map([[key, won]]), backup({ [key]: initial }));
  assert.equal(keepWin.writes.size, 0);
});

test('wins beat losses, playing beats lost, and equal terminal outcomes keep the current run', () => {
  for (const [currentStatus, incomingStatus, shouldWrite] of [
    ['lost', 'won', true], ['won', 'lost', false],
    ['lost', 'playing', true], ['playing', 'lost', false],
    ['won', 'won', false], ['lost', 'lost', false],
  ]) {
    const current = legacy(currentStatus, 2, { turns: 55 });
    const incoming = legacy(incomingStatus, incomingStatus === 'won' ? 2 : 1, { turns: 20 });
    const plan = planBackupMerge(new Map([[legacyKey, current]]), backup({ [legacyKey]: incoming }));
    assert.equal(plan.writes.has(legacyKey), shouldWrite, `${currentStatus} <- ${incomingStatus}`);
  }
});

test('two unfinished runs choose the later room; equal rooms keep current regardless of turns', () => {
  assert.equal(planBackupMerge(new Map([[key, initial]]), backup({ [key]: laterRoom })).writes.get(key), laterRoom);
  assert.equal(planBackupMerge(new Map([[key, laterRoom]]), backup({ [key]: initial })).writes.size, 0);
  for (const incomingTurns of [1, 59]) {
    const current = legacy('playing', 1, { turns: 30 });
    const incoming = legacy('playing', 1, { turns: incomingTurns });
    assert.equal(planBackupMerge(new Map([[legacyKey, current]]), backup({ [legacyKey]: incoming })).writes.size, 0);
  }
});

test('different ruleset keys on the same date remain separate editions', () => {
  const current = new Map([[legacyKey, legacy('won', 2)]]);
  const entries = {
    [key]: initial,
    [`daily:v3:${date}`]: legacy('playing', 0, { schema: 3 }),
    [`daily:${date}`]: legacy('playing', 0, { schema: 2 }),
  };
  const plan = planBackupMerge(current, backup(entries));
  assert.equal(plan.archived, true);
  assert.deepEqual([...plan.writes], Object.entries(entries));
  assert.equal(new Map([...current, ...plan.writes]).size, 4);
  assert.equal(plan.writes.has(legacyKey), false);
});

test('existing valid sound preferences stay local; missing or invalid preferences can be restored', () => {
  for (const local of ['on', 'off']) {
    assert.equal(planBackupMerge(new Map([['sound', local]]), backup({ sound: 'off' })).writes.size, 0);
  }
  for (const current of [new Map(), new Map([['sound', 'corrupt']])]) {
    assert.equal(planBackupMerge(current, backup({ sound: 'off' })).writes.get('sound'), 'off');
  }
});

test('an unreadable local collision is preserved and reported while other dates still merge', () => {
  for (const corrupt of ['{broken', JSON.stringify({ ...JSON.parse(initial), gold: 999 })]) {
    const otherKey = 'daily:v4:2026-11-06';
    const otherRun = legacy('playing', 0, { date: '2026-11-06' });
    const current = new Map([[key, corrupt]]);
    const plan = planBackupMerge(current, backup({ [key]: won, [otherKey]: otherRun }));
    assert.deepEqual(plan.unreadable, [key]);
    assert.deepEqual([...plan.writes], [[otherKey, otherRun]]);
    assert.equal(current.get(key), corrupt);
  }
});

test('invalid envelopes and entries reject the whole plan without inspecting local conflicts', () => {
  const invalidRun = JSON.stringify({ ...JSON.parse(initial), gold: 999 });
  const badEntries = [
    { sound: 'sometimes' },
    { unknown: 'value' },
    { [`practice:v5:${date}`]: initial },
    { [key]: JSON.parse(initial) },
    { [key]: '{broken' },
    { [key]: invalidRun },
    { [legacyKey]: legacy('playing', 0, { schema: 3 }) },
    { [`daily:v3:${date}`]: legacy('playing', 0, { schema: 4 }) },
    { [`daily:${date}`]: legacy('playing', 0, { schema: 4 }) },
    { [legacyKey]: legacy('playing', 0, { date: '2026-11-06' }) },
    { 'daily:v4:2026-02-31': legacy('playing', 0, { date: '2026-02-31' }) },
    { [legacyKey]: legacy('unknown') },
    { [legacyKey]: legacy(['won']) },
    { [legacyKey]: legacy('playing', 3) },
  ];
  const badEnvelopes = [null, [], {}, { ...backup({}), app: 'another-app' }, { ...backup({}), schema: 2 }, backup(null), backup([])];
  for (const data of [...badEnvelopes, ...badEntries.map((entries) => backup({ [key]: initial, ...entries }))]) {
    const current = new Map([[key, initial]]);
    current.has = () => assert.fail('Incoming entries must all validate before local merges are planned');
    assert.throws(() => planBackupMerge(current, data), /backup|save|preference/i);
    assert.equal(current.get(key), initial);
  }
});

test('repeating a successful restore produces no additional writes', () => {
  const current = new Map([[key, initial], ['sound', 'on']]);
  const data = backup({ [key]: won, [legacyKey]: legacy('playing', 1), sound: 'off' });
  const first = planBackupMerge(current, data);
  const merged = new Map([...current, ...first.writes]);
  const second = planBackupMerge(merged, data);
  assert.equal(second.writes.size, 0);
  assert.deepEqual(second.unreadable, []);
  assert.equal(merged.get('sound'), 'on');
});
