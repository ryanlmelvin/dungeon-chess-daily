// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The dev-only composer preview: ?composed=YYYY-MM-DD composes that date
// afresh with the composer as it is now (src/composer.js), to play a change
// before the stored editions are rebuilt (src/editions.js). Its runs save
// apart from real ones. src/main.js loads this module only in a dev build
// opened with ?composed=, so published builds never carry it.
import { composeDay, START_SETS, COMPOSED_STARTS } from './composer.js';
import { validateSave } from './rules.js';

// The start set the page's query names (&starts=e2 or wide), else the composer's own.
const startsFor = (search) => { const name = new URLSearchParams(search).get('starts'); return Object.hasOwn(START_SETS, name ?? '') ? name : COMPOSED_STARTS; };

// The preview composes with treasure (src/treasure.js) unless the query says &treasure=0.
const treasureFor = (search) => new URLSearchParams(search).get('treasure') !== '0';
// Partner floors (src/composer.js composeDay's `partner`) are on in the preview; &partner=0 composes the day without one.
const partnerFor = (search) => new URLSearchParams(search).get('partner') !== '0';

/** The composed day the page's query names, or null. */
export function composedDayFor(search) {
  const date = new URLSearchParams(search).get('composed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  try { return composeDay(date, { starts: startsFor(search), treasure: treasureFor(search), partner: partnerFor(search) }).daily; } catch (error) { console.error(error); return null; }
}

/** Each start set saves apart; e2 keeps the key earlier previews used. */
export const composedSaveTag = (search) => (startsFor(search) === 'e2' ? 'composed:' : `composed:${startsFor(search)}:`);

/** A saved preview run belongs to its day as composed now: a valid save of it, rooms included. */
export const composedSaveFits = (value, daily) => validateSave(value, daily.date, daily);
