// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTheme, getRawDaily, headlineFor, HEADLINE_SUBJECTS } from '../src/edition.js';
import { createGame, validateSave } from '../src/rules.js';
import { getDaily } from '../src/generation.js';

const roles = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
function creature(piece, palette = 'violet') {
  return {
    id: 'eye', piece, palette, plural: 'Floating eyes',
    name: `${palette[0].toUpperCase() + palette.slice(1)} floating eye`,
  };
}
const dates = Array.from({ length: 366 }, (_, day) => new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
// A queen or king takes a singular subject ("One resident rules..."), the rest a plural one.
const subjectsFor = (role) => HEADLINE_SUBJECTS[role === 'queen' || role === 'king' ? 'singular' : 'plural'];
const subjectOf = (headline, role) => subjectsFor(role).find((subject) => headline.startsWith(`${subject} `));

test('every role offers twelve compact headlines under an anonymous subject', () => {
  for (const role of roles) {
    const headlines = new Set(dates.flatMap((date) => [0, 1, 2].map((floor) => headlineFor(creature(role), date, floor))));
    const clues = new Set();
    for (const headline of headlines) {
      const subject = subjectOf(headline, role);
      assert.ok(subject, headline);
      clues.add(headline.slice(subject.length + 1));
      assert.ok(headline.length <= 75, headline);
      assert.doesNotMatch(headline, /violet|floating|\beyes?\b/i, headline);
    }
    assert.equal(clues.size, 12, role);
  }
  // Both lists line up, so the pick says nothing beyond the verb's number.
  assert.equal(HEADLINE_SUBJECTS.plural.length, HEADLINE_SUBJECTS.singular.length);
});

test('headline choices are repeatable per edition, floor and role, independent of creature identity and call order', () => {
  for (const role of roles) {
    const first = creature(role);
    const other = { ...first, id: 'rat', name: 'Gold rat', palette: 'gold', plural: 'Rats' };
    const date = '2026-11-06';
    const original = [0, 1, 2].map((floor) => headlineFor(first, date, floor));
    for (const otherDate of dates) headlineFor(other, otherDate, 1);
    assert.deepEqual([0, 1, 2].map((floor) => headlineFor(first, date, floor)), original);
    // Only the role matters, never which creature it hides behind.
    assert.deepEqual([0, 1, 2].map((floor) => headlineFor(other, date, floor)), original);
    // The day's three stories never share a subject.
    assert.equal(new Set(original.map((headline) => subjectOf(headline, role))).size, 3);
  }
});

// Display names follow the art; ids, palettes and roles never move.
const RENAMED = { imp: ['Cat', 'Cats'], goblin: ['Imp', 'Imps'], dragon: ['Gremlin', 'Gremlins'] };
function renamed(species) {
  if (!RENAMED[species.id]) return species;
  const [baseName, plural] = RENAMED[species.id];
  return { ...species, baseName, plural, name: `${species.palette[0].toUpperCase() + species.palette.slice(1)} ${baseName.toLowerCase()}` };
}

test('display variety preserves legacy edition metadata and valid saved runs', () => {
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/schema3-run.json', import.meta.url), 'utf8'));
  const daily = getRawDaily(legacy.date);
  for (const key of ['seed', 'targets']) assert.deepEqual(daily[key], legacy[key], key);
  // Targets keep their palettes; a decoy's may move so floor-mates never share one.
  assert.deepEqual(daily.species.slice(0, 3), legacy.species.slice(0, 3).map(renamed));
  assert.deepEqual(daily.species.map(({ id, piece }) => ({ id, piece })), legacy.species.map(({ id, piece }) => ({ id, piece })));
  // This edition's lead target was the "Ember imp", which the art shows as a cat.
  assert.deepEqual(daily.theme, buildTheme(legacy.species.map(renamed)));
  assert.equal(daily.theme.headline, legacy.theme.headline.replace('Ember imps', 'Ember cats'));
  const before = structuredClone(daily);
  const edition = getDaily(daily.date);
  const serialized = JSON.stringify(createGame(edition));
  for (const date of dates) for (const [floor, target] of daily.species.slice(0, 3).entries()) headlineFor(target, date, floor);
  assert.deepEqual(daily, before);
  assert.equal(validateSave(JSON.parse(serialized), daily.date, edition), true);
});
