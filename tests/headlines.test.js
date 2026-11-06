// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTheme, getRawDaily, headlineFor } from '../src/edition.js';
import { createGame, validateSave } from '../src/rules.js';

const roles = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const palettes = ['ice', 'ember', 'moss', 'violet', 'gold', 'rose'];
function creature(piece, palette = 'violet') {
  return {
    id: 'eye', piece, palette, plural: 'Floating eyes',
    name: `${palette[0].toUpperCase() + palette.slice(1)} floating eye`,
  };
}
const dates = Array.from({ length: 366 }, (_, day) => new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));

test('every role offers twelve compact headlines and keeps its colored creature as the subject', () => {
  for (const role of roles) {
    const subject = creature(role);
    const singular = role === 'queen' || role === 'king';
    const expectedStart = singular ? 'Violet floating eye ' : 'Violet floating eyes ';
    const choices = new Set(dates.map((date) => headlineFor(subject, date)));
    assert.equal(choices.size, 12, role);
    for (const headline of choices) {
      assert.ok(headline.startsWith(expectedStart), headline);
      assert.ok(headline.length <= 70, headline);
    }
    for (const palette of palettes) {
      const colored = creature(role, palette);
      const start = palette[0].toUpperCase() + palette.slice(1);
      assert.ok(headlineFor(colored, dates[0]).startsWith(`${start} floating eye`));
    }
  }
});

test('headline choices are repeatable per edition and role, independent of creature identity and call order', () => {
  for (const role of roles) {
    const first = creature(role);
    const other = { ...first, id: 'rat', name: 'Gold rat', palette: 'gold', plural: 'Rats' };
    const singular = role === 'queen' || role === 'king';
    const date = '2026-11-06';
    const original = headlineFor(first, date);
    for (const otherDate of dates) headlineFor(other, otherDate);
    assert.equal(headlineFor(first, date), original);
    const originalSuffix = original.slice((singular ? 'Violet floating eye ' : 'Violet floating eyes ').length);
    assert.equal(headlineFor(other, date), `${singular ? 'Gold rat' : 'Gold rats'} ${originalSuffix}`);
  }
});

test('display variety preserves legacy edition metadata and valid saved runs', () => {
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/schema3-run.json', import.meta.url), 'utf8'));
  const daily = getRawDaily(legacy.date);
  for (const key of ['seed', 'edition', 'species', 'targets', 'theme']) assert.deepEqual(daily[key], legacy[key], key);
  const before = structuredClone(daily);
  const saved = createGame(daily);
  const serialized = JSON.stringify(saved);
  for (const date of dates) for (const target of daily.species.slice(0, 3)) headlineFor(target, date);
  assert.deepEqual(daily, before);
  assert.deepEqual(buildTheme(daily.species), legacy.theme);
  assert.equal(validateSave(JSON.parse(serialized), daily.date, getRawDaily(daily.date)), true);
});
