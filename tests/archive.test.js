// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveDates, archiveEntries, dailySaveKey, editionNumber, isArchiveDate, savedStatus } from '../src/archive.js';
import { FIRST_EDITION_DATE, getRawDaily } from '../src/edition.js';
import { getDaily, createGame, validateSave } from '../src/game.js';

test('edition #1 is the first archive date', () => {
  assert.equal(getRawDaily(FIRST_EDITION_DATE).edition, 1);
  assert.equal(editionNumber(FIRST_EDITION_DATE, FIRST_EDITION_DATE), 1);
  assert.equal(editionNumber('2026-12-05', FIRST_EDITION_DATE), getRawDaily('2026-12-05').edition);
});

test('archive lists past editions newest first and excludes today', () => {
  assert.deepEqual(archiveDates(FIRST_EDITION_DATE, FIRST_EDITION_DATE), []);
  assert.deepEqual(archiveDates('2026-11-06', FIRST_EDITION_DATE), ['2026-11-05']);
  const dates = archiveDates('2027-03-02', FIRST_EDITION_DATE);
  assert.equal(dates[0], '2027-03-01');
  assert.equal(dates.at(-1), FIRST_EDITION_DATE);
  assert.equal(dates.length, getRawDaily('2027-03-01').edition);
  assert.ok(dates.includes('2027-02-28') && !dates.includes('2027-02-29'));
  assert.equal(new Set(dates).size, dates.length);
});

test('only valid past editions can be reopened from the archive', () => {
  const today = '2026-11-20';
  assert.equal(isArchiveDate('2026-11-05', today, FIRST_EDITION_DATE), true);
  assert.equal(isArchiveDate('2026-11-19', today, FIRST_EDITION_DATE), true);
  for (const date of [today, '2026-11-21', '2026-11-04', '2026-02-30', '2026-11-5', '', null, undefined]) {
    assert.equal(isArchiveDate(date, today, FIRST_EDITION_DATE), false, String(date));
  }
});

test('saved status reads each day from its official v7 key', () => {
  const date = '2026-11-05';
  const saved = new Map([
    [dailySaveKey('2026-11-07'), JSON.stringify({ date: '2026-11-07', status: 'won' })],
    [dailySaveKey('2026-11-06'), JSON.stringify({ date: '2026-11-06', status: 'playing' })],
    [dailySaveKey(date), '{not json'],
    ['practice:v7:2026-11-08', JSON.stringify({ date: '2026-11-08', status: 'won' })],
    ['daily:v5:2026-11-08', JSON.stringify({ date: '2026-11-08', status: 'won' })],
  ]);
  const rows = archiveEntries('2026-11-10', FIRST_EDITION_DATE, (name) => saved.get(name) ?? null);
  assert.deepEqual(rows.map(({ date: d, status }) => [d, status]), [
    ['2026-11-09', 'unplayed'], ['2026-11-08', 'unplayed'], ['2026-11-07', 'won'], ['2026-11-06', 'playing'], ['2026-11-05', 'unplayed'],
  ]);
  assert.equal(savedStatus(JSON.stringify({ date: '2026-11-06', status: 'won' }), date), 'unplayed', 'a save from another date does not count');
  assert.equal(savedStatus(JSON.stringify({ date, status: 'lost' }), date), 'lost');
  assert.equal(savedStatus(JSON.stringify({ date, status: 'paused' }), date), 'unplayed');
  assert.equal(savedStatus(null, date), 'unplayed');
});

test('a past edition is rebuilt identically and its run validates for that date', () => {
  const date = '2026-11-05';
  const daily = getDaily(date);
  assert.equal(daily.date, date);
  assert.deepEqual(getDaily(date), daily, 'past editions are deterministic');
  const state = createGame(daily);
  assert.equal(state.date, date);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), date), true);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), '2026-11-06'), false);
  assert.equal(savedStatus(JSON.stringify(state), date), 'playing');
});
