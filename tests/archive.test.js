// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveMonth, dailySaveKey, editionNumber, isArchiveDate, savedStatus, shiftMonth } from '../src/archive.js';
import { FIRST_EDITION_DATE, getRawDaily } from '../src/edition.js';
import { getDaily, createGame, validateSave } from '../src/game.js';

test('edition #1 is the first archive date', () => {
  assert.equal(getRawDaily(FIRST_EDITION_DATE).edition, 1);
  assert.equal(editionNumber(FIRST_EDITION_DATE, FIRST_EDITION_DATE), 1);
  assert.equal(editionNumber('2026-12-05', FIRST_EDITION_DATE), getRawDaily('2026-12-05').edition);
});

test('edition #1 is November 1, 2026', () => {
  assert.equal(FIRST_EDITION_DATE, '2026-11-01');
  assert.equal(getRawDaily('2026-11-08').edition, 8);
});

test('the archive calendar opens every edition from the first through today', () => {
  const none = () => null;
  const november = archiveMonth('2026-11', '2026-11-08', FIRST_EDITION_DATE, none);
  assert.equal(november.blanks, 0, 'November 1, 2026 is a Sunday');
  assert.equal(november.days.length, 30);
  assert.deepEqual(november.days.filter((day) => day.open).map((day) => day.day), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(november.days.filter((day) => day.today).map((day) => day.date), ['2026-11-08']);
  assert.equal(november.previous, false, 'no editions before November 2026');
  assert.equal(november.next, false, 'December has not begun');
  const december = archiveMonth('2026-12', '2027-01-03', FIRST_EDITION_DATE, none);
  assert.equal(december.blanks, 2, 'December 1, 2026 is a Tuesday');
  assert.equal(december.days.length, 31);
  assert.ok(december.days.every((day) => day.open));
  assert.equal(december.previous, true);
  assert.equal(december.next, true);
  assert.equal(archiveMonth('2027-02', '2027-03-01', FIRST_EDITION_DATE, none).days.length, 28);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
});

test('only valid past editions can be reopened from the archive', () => {
  const today = '2026-11-20';
  assert.equal(isArchiveDate('2026-11-01', today, FIRST_EDITION_DATE), true);
  assert.equal(isArchiveDate('2026-11-19', today, FIRST_EDITION_DATE), true);
  for (const date of [today, '2026-11-21', '2026-10-31', '2026-02-30', '2026-11-5', '', null, undefined]) {
    assert.equal(isArchiveDate(date, today, FIRST_EDITION_DATE), false, String(date));
  }
});

test('saved status reads each day from its official v10 key', () => {
  const date = '2026-11-05';
  const saved = new Map([
    [dailySaveKey('2026-11-07'), JSON.stringify({ date: '2026-11-07', status: 'won' })],
    [dailySaveKey('2026-11-06'), JSON.stringify({ date: '2026-11-06', status: 'playing' })],
    [dailySaveKey(date), '{not json'],
    ['practice:v10:2026-11-08', JSON.stringify({ date: '2026-11-08', status: 'won' })],
    ['daily:v5:2026-11-08', JSON.stringify({ date: '2026-11-08', status: 'won' })],
  ]);
  const { days } = archiveMonth('2026-11', '2026-11-09', FIRST_EDITION_DATE, (name) => saved.get(name) ?? null);
  assert.deepEqual(days.slice(4, 10).map(({ date: d, status }) => [d, status]), [
    ['2026-11-05', 'unplayed'], ['2026-11-06', 'playing'], ['2026-11-07', 'won'], ['2026-11-08', 'unplayed'], ['2026-11-09', 'unplayed'], ['2026-11-10', 'unplayed'],
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
  // Saves from before the archive began at 2026-11-01 carry the old edition number.
  assert.equal(validateSave({ ...JSON.parse(JSON.stringify(state)), edition: state.edition - 4 }, date), true);
});
