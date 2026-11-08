// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// The archive lists past editions and what this device has saved for each.
// Editions are deterministic, so any past date can be rebuilt and played.
const DAY = 86_400_000;
const STATUSES = new Set(['playing', 'won', 'lost']);

/** Official v7 save key for a date, relative to the app's storage prefix. */
export const dailySaveKey = (date) => `daily:v7:${date}`;

/** Past editions from `first` up to the day before `today`, newest first. */
export function archiveDates(today, first) {
  const end = Date.parse(today), start = Date.parse(first);
  if (!Number.isFinite(end) || !Number.isFinite(start)) throw new TypeError('Invalid archive date.');
  const dates = [];
  for (let time = end - DAY; time >= start; time -= DAY) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

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

/** Archive rows for the menu; `read(key)` returns the stored string or null. */
export function archiveEntries(today, first, read) {
  return archiveDates(today, first).map((date) => ({
    date, edition: editionNumber(date, first), status: savedStatus(read(dailySaveKey(date)), date),
  }));
}

export const STATUS_LABELS = { won: 'Won', lost: 'Lost', playing: 'In progress', unplayed: 'Not played' };
