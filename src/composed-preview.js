// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The dev-only composer preview: ?composed=YYYY-MM-DD composes that date
// afresh with the composer as it is now (src/composer.js), to play a change
// before the stored editions are rebuilt (src/editions.js). It composes the
// release configuration, as the build does, so with an unchanged composer the
// preview is the stored edition; &treasure=0, &partner=0 and &tight=0 each
// turn one option off, to compare. The drawn ideas (src/composer.js
// DRAWN_IDEAS: the Standstill and the Lure) compose as released, each on the
// one day in three it draws; &wait=0, &lure=0 or &ideas=0 (both) turn them
// off, &wait=all, &lure=all or &ideas=all put one on every day it fits, and
// &ceiling=0 composes them without the bot's ceiling, to compare. The mate
// floor (your own king at your side on the king floor: src/composer.js
// composeMate) composes on the days that draw one; &mate=0 turns it off and
// &mate=all composes one on every day that fits. &floor=2
// or &floor=3 opens the preview on that floor, the earlier floors played
// along their planted lines. &modifier=cracks or &modifier=gates
// plays the date under one of the two terrain modifiers (a crumbling floor,
// gates: src/modifiers.js) whatever it draws, to try either on any date;
// without it the date keeps its own modifier. Its runs save apart from real
// ones.
// src/main.js loads this module only in a dev build opened with ?composed=,
// so published builds never carry it.
import { composeDay, START_SETS, COMPOSED_STARTS } from './composer.js';
import { validateSave, act } from './rules.js';
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

// A drawn idea composes as released, on the days it draws, unless the query says otherwise by its name or with
// &ideas: =0 off, =all on every day it fits (src/composer.js IDEA_EVERY, ideaDay).
function ideaFor(search, name) {
  const query = new URLSearchParams(search), value = query.get(name) ?? query.get('ideas');
  return value === 'all' ? 'every' : value !== '0';
}
/** composeDay's options as the page's query asks for them: the release configuration unless it says otherwise. */
export function previewOptions(search) {
  const query = new URLSearchParams(search);
  return {
    starts: startsFor(search), treasure: optionFor(search, 'treasure'), partner: query.get('partner') === 'all' ? 'every' : optionFor(search, 'partner'), tight: optionFor(search, 'tight'),
    wait: ideaFor(search, 'wait'), lure: ideaFor(search, 'lure'), ceiling: optionFor(search, 'ceiling'),
    // The mate floor composes as released, on the days that draw one (src/composer.js mateDay): &mate=0 turns it off,
    // &mate=all (or =1) composes one on every day that fits.
    mate: ['all', '1'].includes(query.get('mate')) ? 'every' : query.get('mate') !== '0',
  };
}

/**
 * Does this preview file what its floors find in the journal? Only one whose
 * query names a drawn idea (&wait, &lure or &ideas, not turned off), so the
 * idea's page can be seen where it is found; any other preview keeps out of
 * the journal, as before.
 */
export const previewJournals = (search) => { const query = new URLSearchParams(search); return ['wait', 'lure', 'ideas'].some((name) => query.has(name) && query.get(name) !== '0'); };

/** The composed day the page's query names, or null. */
export function composedDayFor(search) {
  const date = new URLSearchParams(search).get('composed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  const modifier = modifierFor(search);
  try { return composeDay(date, { ...(modifier && { daily: { ...getRawDaily(date), modifier } }), ...previewOptions(search) }).daily; } catch (error) { console.error(error); return null; }
}

// What a preview's saves are filed under besides its start set: where it departs from the release over the drawn
// ideas (one turned off, or put on every day it fits, or the bot's ceiling left out), so a run of a day composed
// one way never loads into the same day composed another.
function ideasTag(search) {
  const { wait, lure, ceiling, mate } = previewOptions(search);
  const part = (name, value) => (value === 'every' ? `${name}-all` : value ? '' : `no-${name}`);
  const tag = [part('wait', wait), part('lure', lure), (wait || lure) && !ceiling && 'open', mate === 'every' ? 'mate' : !mate && 'no-mate'].filter(Boolean).join('+');
  return tag ? `${tag}:` : '';
}
// The floor a preview opens on (&floor=2 or &floor=3), or null: floor 1, as any day.
const floorFor = (search) => { const floor = Number(new URLSearchParams(search).get('floor')); return floor === 2 || floor === 3 ? floor : null; };
/**
 * A preview's new game: `game`, or with &floor=2 or &floor=3 the same game
 * with the floors before that one already played along their planted lines,
 * a shortcut to the floor under study (a king floor, say).
 */
export function previewGame(search, daily, game) {
  const floor = floorFor(search);
  let state = game;
  if (floor) for (const action of daily.generation.certificate.actions) { if (state.floor >= floor - 1) break; state = act(state, action); }
  return state;
}
/** Each start set saves apart, and so do a forced modifier and a preview that opens on a later floor; e2 keeps the key earlier previews used. */
export const composedSaveTag = (search) => `${startsFor(search) === 'e2' ? 'composed:' : `composed:${startsFor(search)}:`}${ideasTag(search)}${modifierFor(search) ? `${modifierFor(search)}:` : ''}${floorFor(search) ? `floor${floorFor(search)}:` : ''}`;

/** A saved preview run belongs to its day as composed now: a valid save of it, rooms included. */
export const composedSaveFits = (value, daily) => validateSave(value, daily.date, daily);
