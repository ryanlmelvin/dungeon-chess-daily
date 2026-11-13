// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The published edition of a date: three composed floors, each built around a
// short planted line (src/composer.js), and those lines as the day's
// certificate (docs/generation.md). The build composes every date from launch
// through two years ahead and stores its rooms and lines (src/editions.js,
// scripts/build-editions.mjs), so opening a day only decodes them and replays
// the lines to prove it again: the composer never ships. A date past that
// window borrows a stored day of its own piece and modifier (borrowedDaily).
// Every daily plays the same monsters, Fair (DAILY_TIER), and the edition is
// the same for everyone: there is no player-specific seed.
import { getRawDaily, buildTheme } from './edition.js';
import { createGame, act, validateSave, RULES_VERSION } from './rules.js';
import { hash } from './random.js';
import { verifyWinningRoute } from './fairness.js';
import { DAILY_TIER } from './difficulty.js';
import { EDITIONS } from './editions.js';
import { decodeRoute } from './route-code.js';
import { decodeRooms } from './room-code.js';
import { decodeMotifs } from './motif-code.js';

export const GENERATOR_VERSION = RULES_VERSION;
/**
 * Salt for the composed floors' seeds (composedSeeds). Bumping it re-rolls
 * every composed room, so it changes only on purpose, with every edition
 * recomposed (npm run build:editions -- --full).
 */
export const COMPOSER_VERSION = 1;
/**
 * A date's floor seeds, one per floor on a stream of its own: the composer
 * draws its rooms from them, and in play they style the walls and break the
 * monsters' ties (src/rules.js floorSeed).
 */
export const composedSeeds = (date) => [0, 1, 2].map((floor) => hash(`composer:${COMPOSER_VERSION}:${date}:${floor}`));

const cache = new Map();

/**
 * How src/fairness.js verifies a day's certificate: the recruit on orders.
 * A day's king floor has your own king with you (`escort`, as every composed
 * day's does: escorted), whose orders a mate floor's or a pawn's line
 * carries, and a day with a partner floor (`partner`, `generation.partner`)
 * steers that floor's recruit too. Only a day with neither (tooling: rooms
 * without a king-floor recruit) leaves the recruit to move itself.
 */
export const certificateMode = (partner, escort = true) => ((partner === null || partner === undefined) && !escort ? undefined : { recruit: 'steer' });
/**
 * Does the day's king floor have its recruit, your own king, which is with
 * you as that floor opens (src/rules.js setFloor)? Every composed day's does.
 * A mate floor's line carries the king's orders (src/composer.js
 * composeMate), so such a day is proved with the recruit steered, as a day
 * with a partner floor is; a net's line names none, and the king holds.
 */
export const escorted = (daily) => Boolean(daily?.composed?.[2]?.items?.some((item) => item.type === 'companion'));

/**
 * Prove a composed day by its `actions` (each floor's planted line, then the
 * stairs). They must win on the day's twin without its hint powerups, the way
 * src/fairness.js verifyWinningRoute certifies (a certified route collects no
 * powerup); picking a hint up changes no monster's move, so the real day must
 * then win as played, hints collected, never captured. With `saves` (the
 * build and the composer) every position along the way must also be a valid
 * save, as a player's run would be. `partner` names the day's partner floor
 * (0 or 1; src/composer.js, a Tandem floor): its line is played with that
 * floor's recruit on orders, so the day is proved with the recruit steered,
 * and the recruit may join and take orders on that floor alone. Returns
 * { valid: true, metrics } or { valid: false, reason }.
 */
export function proveComposed(daily, actions, { saves = false, partner = null } = {}) {
  const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
  const escort = escorted(daily);
  const proof = verifyWinningRoute(createGame(twin), actions, certificateMode(partner, escort));
  if (!proof.valid) return proof;
  let played = createGame(daily);
  if (saves && !validateSave(played, daily.date, daily)) return { valid: false, reason: 'The day\'s start is not a valid save.' };
  for (const [n, action] of actions.entries()) {
    const next = act(played, action);
    if (next === played || next.hits > played.hits) return { valid: false, reason: 'The line fails as played, hints collected.' };
    // A recruit takes orders on the day's partner floor and on the king floor, where your king is with you, alone.
    const steered = played.floor === partner || (escort && played.floor === 2);
    if ((partner !== null || escort) && !steered && (action.recruit !== undefined || (played.floor < 2 && next.events.some((event) => event.type === 'companion-recruit')))) return { valid: false, reason: 'A recruit helps off the partner floor.' };
    if (saves && !validateSave(next, daily.date, daily)) return { valid: false, reason: `The save after the line's action ${n + 1} is not valid.` };
    played = next;
  }
  return played.status === 'won' ? { valid: true, metrics: proof.metrics } : { valid: false, reason: 'The line does not win as played.' };
}

/**
 * A raw daily (src/edition.js getRawDaily) dressed as a composed edition:
 * `rooms` and `actions` as stored, the Fair monsters, and the floor seeds of
 * the date the rooms were composed for (`composedFor`, the date itself unless
 * borrowed). `partner` is the day's partner floor, if it has one
 * (`generation.partner`). Not yet proved.
 */
export function composedDaily(raw, rooms, actions, composedFor = raw.date, partner = null) {
  const daily = { ...raw, difficulty: DAILY_TIER, floorSeeds: composedSeeds(composedFor), composed: structuredClone(rooms) };
  delete daily.generation;
  daily.generation = { version: GENERATOR_VERSION, source: 'composed', ...(composedFor !== raw.date && { borrowed: composedFor }), ...(partner !== null && { partner }), certificate: { actions: structuredClone(actions) } };
  return daily;
}

/**
 * A stored entry's partner floor (src/editions.js `partner`): 0 or 1 for the
 * floor whose line carries recruit orders, null for a day without one.
 * Anything else is no entry at all.
 */
export function storedPartner(entry) {
  if (entry?.partner === undefined) return null;
  if (entry.partner !== 0 && entry.partner !== 1) throw new SyntaxError('A stored partner floor is floor 1 or 2.');
  return entry.partner;
}

// A stored entry as the edition of `raw`, or null when it no longer proves.
function storedDaily(raw, entry, composedFor = raw.date) {
  try {
    const partner = storedPartner(entry);
    const daily = composedDaily(raw, decodeRooms(entry.rooms), decodeRoute(entry.route), composedFor, partner);
    const proof = proveComposed(daily, daily.generation.certificate.actions, { partner });
    if (!proof.valid) return null;
    daily.generation.certificate.metrics = proof.metrics;
    // The idea each floor was built around (src/motif-code.js), for the journal; a borrowed day takes its template's.
    const motifs = decodeMotifs(entry.motifs);
    if (motifs) daily.generation.motifs = motifs;
    return daily;
  } catch { return null; }
}

// Stored dates by piece and modifier, oldest first, worked out once.
let kinds = null;
const kindOf = (raw) => `${raw.playerPiece}:${raw.modifier ?? 'none'}`;
function storedOfKind(raw) {
  if (!kinds) {
    kinds = new Map();
    for (const date of Object.keys(EDITIONS).sort()) {
      const kind = kindOf(getRawDaily(date));
      if (!kinds.has(kind)) kinds.set(kind, []);
      kinds.get(kind).push(date);
    }
  }
  return kinds.get(kindOf(raw)) ?? [];
}

/**
 * A date with no stored edition (past the build's window, two years ahead of
 * every build) borrows a stored day of its own piece and modifier, picked by
 * the date from the 50 or so the window holds: that day's rooms, lines,
 * partner floor and floor seeds, played in its roles (each species keeps the
 * date's own name and colors but takes on the stored day's piece, as do the
 * targets). So it plays exactly as the stored day does, under another cast's
 * names. Null when the window holds no such day.
 */
export function borrowedDaily(raw) {
  const pool = storedOfKind(raw);
  const first = hash(`borrow:${raw.date}`);
  for (let n = 0; n < pool.length; n++) {
    const date = pool[(first + n) % pool.length];
    if (date === raw.date) continue;
    const template = getRawDaily(date);
    const species = raw.species.map((creature, index) => ({ ...creature, piece: template.species[index].piece }));
    const daily = storedDaily({ ...raw, targets: [...template.targets], species, theme: buildTheme(species) }, EDITIONS[date], date);
    if (daily) return daily;
  }
  return null;
}

/**
 * The certified edition of a date: its stored composed day, proved again as
 * it loads, or else a borrowed one (borrowedDaily). Throws when neither
 * proves: no unproved dungeon is ever released.
 */
export function generateDaily(date = new Date()) {
  const raw = getRawDaily(date);
  const daily = (EDITIONS[raw.date] && storedDaily(raw, EDITIONS[raw.date])) ?? borrowedDaily(raw);
  if (!daily) throw new Error('Dungeon certification failed. No unverified dungeon was released.');
  return daily;
}

export function getDaily(date = new Date()) {
  const raw = getRawDaily(date);
  if (!cache.has(raw.date)) {
    const daily = generateDaily(raw.date);
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(raw.date, daily);
  }
  // A caller cannot poison later daily generation by mutating its result.
  return structuredClone(cache.get(raw.date));
}
