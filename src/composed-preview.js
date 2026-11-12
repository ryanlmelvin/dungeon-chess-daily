// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The dev-only composer preview: ?composed=YYYY-MM-DD composes that date
// afresh with the composer as it is now (src/composer.js), to play a change
// before the stored editions are rebuilt (src/editions.js). It composes the
// release configuration, as the build does, so with an unchanged composer the
// preview is the stored edition; &treasure=0, &partner=0 and &tight=0 each
// turn one option off, to compare. The ideas in preview (src/composer.js
// PREVIEW_IDEAS) are opt-in: &wait=1 (the Standstill), &lure=1 (the Lure),
// &ideas=1 (both), each on the one day in three it draws; &wait=all,
// &lure=all or &ideas=all on every day it fits; &ceiling=0 composes them
// without the bot's ceiling, to compare. &modifier=cracks or &modifier=gates
// plays the date under one of the two room modifiers in preview (a crumbling
// floor, gates: src/modifiers.js), which no date draws yet; without it the
// date keeps its own modifier. Its runs save apart from real ones.
// src/main.js loads this module only in a dev build opened with ?composed=,
// so published builds never carry it.
import { composeDay, START_SETS, COMPOSED_STARTS } from './composer.js';
import { validateSave } from './rules.js';
import { getRawDaily } from './edition.js';
import { TERRAIN_MODIFIERS } from './modifiers.js';

// The start set the page's query names (&starts=e2 or wide), else the composer's own.
const startsFor = (search) => { const name = new URLSearchParams(search).get('starts'); return Object.hasOwn(START_SETS, name ?? '') ? name : COMPOSED_STARTS; };

// Each of composeDay's options is on, as in every stored edition, unless the query turns it off:
// &treasure=0 (no chests, src/treasure.js), &partner=0 (no partner floor), &tight=0 (no tight forms, src/tight.js).
// &partner=all gives every day whose matchup has a partner floor one, whatever the release's cap (src/composer.js PARTNER_EVERY).
const optionFor = (search, name) => new URLSearchParams(search).get(name) !== '0';
// The modifier the query forces on the date (&modifier=cracks or gates), or null: the date's own.
const modifierFor = (search) => { const name = new URLSearchParams(search).get('modifier'); return TERRAIN_MODIFIERS.includes(name) ? name : null; };

// An idea in preview is off unless the query asks for it by name or with &ideas: =1 on the days it draws,
// =all on every day it fits (src/composer.js IDEA_EVERY, ideaDay).
function ideaFor(search, name) {
  const query = new URLSearchParams(search), value = query.get(name) ?? query.get('ideas');
  return value === 'all' ? 'every' : value === '1';
}
/** composeDay's options as the page's query asks for them: the release configuration unless it says otherwise. */
export function previewOptions(search) {
  const query = new URLSearchParams(search);
  return {
    starts: startsFor(search), treasure: optionFor(search, 'treasure'), partner: query.get('partner') === 'all' ? 'every' : optionFor(search, 'partner'), tight: optionFor(search, 'tight'),
    wait: ideaFor(search, 'wait'), lure: ideaFor(search, 'lure'), ceiling: optionFor(search, 'ceiling'),
  };
}

/**
 * Does this preview file what its floors find in the journal? Only one that
 * asks for an idea in preview, so the idea's page can be seen where it is
 * found; any other preview keeps out of the journal, as before.
 */
export const previewJournals = (search) => { const { wait, lure } = previewOptions(search); return Boolean(wait || lure); };

/** The composed day the page's query names, or null. */
export function composedDayFor(search) {
  const date = new URLSearchParams(search).get('composed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  const modifier = modifierFor(search);
  try { return composeDay(date, { ...(modifier && { daily: { ...getRawDaily(date), modifier } }), ...previewOptions(search) }).daily; } catch (error) { console.error(error); return null; }
}

// What a preview's saves are filed under besides its start set: the ideas in preview it asked for, so a run
// of a day composed with one never loads into the same day composed without it.
function ideasTag(search) {
  const { wait, lure, ceiling } = previewOptions(search);
  const tag = [wait && `wait${wait === 'every' ? '-all' : ''}`, lure && `lure${lure === 'every' ? '-all' : ''}`, (wait || lure) && !ceiling && 'open'].filter(Boolean).join('+');
  return tag ? `${tag}:` : '';
}
/** Each start set saves apart, and so does a forced modifier; e2 keeps the key earlier previews used. */
export const composedSaveTag = (search) => `${startsFor(search) === 'e2' ? 'composed:' : `composed:${startsFor(search)}:`}${ideasTag(search)}${modifierFor(search) ? `${modifierFor(search)}:` : ''}`;

/** A saved preview run belongs to its day as composed now: a valid save of it, rooms included. */
export const composedSaveFits = (value, daily) => validateSave(value, daily.date, daily);
