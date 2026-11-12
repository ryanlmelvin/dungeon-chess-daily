// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The dev-only composer preview: ?composed=YYYY-MM-DD composes that date
// afresh with the composer as it is now (src/composer.js), to play a change
// before the stored editions are rebuilt (src/editions.js). It composes the
// release configuration, as the build does, so with an unchanged composer the
// preview is the stored edition; &treasure=0, &partner=0 and &tight=0 each
// turn one option off, to compare. Its runs save apart from real ones.
// src/main.js loads this module only in a dev build opened with ?composed=,
// so published builds never carry it.
import { composeDay, START_SETS, COMPOSED_STARTS } from './composer.js';
import { validateSave } from './rules.js';

// The start set the page's query names (&starts=e2 or wide), else the composer's own.
const startsFor = (search) => { const name = new URLSearchParams(search).get('starts'); return Object.hasOwn(START_SETS, name ?? '') ? name : COMPOSED_STARTS; };

// Each of composeDay's options is on, as in every stored edition, unless the query turns it off:
// &treasure=0 (no chests, src/treasure.js), &partner=0 (no partner floor), &tight=0 (no tight forms, src/tight.js).
// &partner=all gives every day whose matchup has a partner floor one, whatever the release's cap (src/composer.js PARTNER_EVERY).
const optionFor = (search, name) => new URLSearchParams(search).get(name) !== '0';

/** The composed day the page's query names, or null. */
export function composedDayFor(search) {
  const date = new URLSearchParams(search).get('composed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  try { return composeDay(date, { starts: startsFor(search), treasure: optionFor(search, 'treasure'), partner: new URLSearchParams(search).get('partner') === 'all' ? 'every' : optionFor(search, 'partner'), tight: optionFor(search, 'tight') }).daily; } catch (error) { console.error(error); return null; }
}

/** Each start set saves apart; e2 keeps the key earlier previews used. */
export const composedSaveTag = (search) => (startsFor(search) === 'e2' ? 'composed:' : `composed:${startsFor(search)}:`);

/** A saved preview run belongs to its day as composed now: a valid save of it, rooms included. */
export const composedSaveFits = (value, daily) => validateSave(value, daily.date, daily);
