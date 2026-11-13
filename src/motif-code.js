// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The idea each of a day's three floors was composed around (src/composer.js
// motifs), as stored with its edition (src/editions.js): the journal's lesson
// pages (src/journal.js) hang on these names.
/**
 * One letter per motif the composer has today ('d' the tandem, a duo's floor;
 * 'a' the Standstill, a wait, and 'l' the Lure, the two drawn ideas; 'm' a
 * mate floor); any other name is stored whole.
 */
const CODES = Object.freeze({ bait: 'b', squeeze: 's', net: 'n', tempo: 't', crown: 'c', fork: 'f', walk: 'w', tandem: 'd', wait: 'a', lure: 'l', mate: 'm' });
const NAMES = Object.freeze(Object.fromEntries(Object.entries(CODES).map(([name, code]) => [code, name])));
const NAME = /^[a-z][a-z0-9-]{0,23}$/;

/** A motif name the journal can file a find under: short, lowercase, no spaces. */
export const isMotifName = (name) => typeof name === 'string' && NAME.test(name);

/** Compact motifs: one comma-separated token per floor ('b,s,n'). */
export function encodeMotifs(motifs) {
  if (!Array.isArray(motifs) || motifs.length !== 3 || !motifs.every(isMotifName)) throw new TypeError('An edition has three named motifs.');
  return motifs.map((name) => CODES[name] ?? name).join(',');
}

/** The three motif names, or null for anything that isn't a stored motif code. */
export function decodeMotifs(text) {
  if (typeof text !== 'string') return null;
  const names = text.split(',').map((token) => (Object.hasOwn(NAMES, token) ? NAMES[token] : token));
  return names.length === 3 && names.every(isMotifName) ? names : null;
}
