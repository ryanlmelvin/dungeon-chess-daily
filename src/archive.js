// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// The archive lists past editions and what this device has saved for each.
// Editions are deterministic, so any past date can be rebuilt and played.
import { RULES_VERSION } from './rules.js';

const DAY = 86_400_000;
const STATUSES = new Set(['playing', 'won', 'lost']);

/** The official save key for a date under the current rules, relative to the app's storage prefix. */
export const dailySaveKey = (date) => `daily:v${RULES_VERSION}:${date}`;

/** True when `date` is a past edition that the archive offers. */
export function isArchiveDate(date, today, first) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(date);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && date >= first && date < today;
}

/** Edition number shown in the paper's dateline (edition #1 is `first`). */
export const editionNumber = (date, first) => Math.round((Date.parse(date) - Date.parse(first)) / DAY) + 1;

/**
 * Status of the official run saved for a date: 'won', 'lost', 'playing',
 * or 'unplayed' when nothing readable is stored. `raw` is the stored string.
 */
export function savedStatus(raw, date) {
  if (typeof raw !== 'string') return 'unplayed';
  try {
    const value = JSON.parse(raw);
    return value?.date === date && STATUSES.has(value.status) ? value.status : 'unplayed';
  } catch { return 'unplayed'; }
}

/** The 'YYYY-MM' month `by` months after `month`. */
export function shiftMonth(month, by) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + by, 1)).toISOString().slice(0, 7);
}

/**
 * One month of the archive calendar, weeks starting Sunday: `blanks` empty
 * cells before the 1st, then a day per date. A day opens when it is an edition
 * from `first` through `today`; `read(key)` returns the stored save or null.
 * `previous` and `next` say whether the arrows lead to a month with editions.
 */
export function archiveMonth(month, today, first, read) {
  const [year, index] = month.split('-').map(Number);
  const start = Date.UTC(year, index - 1, 1);
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const days = Array.from({ length }, (_, offset) => {
    const date = new Date(start + offset * DAY).toISOString().slice(0, 10);
    const open = date >= first && date <= today;
    return { date, day: offset + 1, open, today: date === today, status: open ? savedStatus(read(dailySaveKey(date)), date) : 'unplayed' };
  });
  return {
    month, blanks: new Date(start).getUTCDay(), days,
    previous: shiftMonth(month, -1) >= first.slice(0, 7), next: shiftMonth(month, 1) <= today.slice(0, 7),
  };
}

export const STATUS_LABELS = { won: 'Won', lost: 'Lost', playing: 'In progress', unplayed: 'Not played' };
