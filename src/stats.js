// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Streak and stats. The ledger is a small record of the editions entered and
// won on their own UTC day with the official piece: never a past edition
// played from the archive, never practice. It is kept apart from the saves and
// from RULES_VERSION, so it survives rule changes and rebuilt editions:
//   { schema: 1, days: { '2026-11-07': { piece: 'bishop', won: true, score: [2, 0, -12] } } }
// `won` is false for a day entered but not won on its day; `score` is each
// floor's moves against par as it stood at the win, absent when unknown (a win
// under an older ruleset, counted from its save). The first scored win of a
// day stands: replaying it later changes nothing here.
import { getDaily, validateSave, isOfficialRun, scoredMoves, PIECES, RULES_VERSION } from './game.js';
import { runPars } from './par.js';
import { FIRST_EDITION_DATE, getRawDaily } from './edition.js';

/** The ledger's storage key, relative to the app's prefix (so backups carry it). */
export const LEDGER_KEY = 'ledger';
const DAY = 86_400_000;
const SAVE_KEY = /^daily:(?:v([1-9]\d*):)?(\d{4}-\d{2}-\d{2})$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(Date.parse(date)).toISOString().slice(0, 10) === date;
const isScore = (score) => Array.isArray(score) && score.length === 3 && score.every(Number.isInteger);
const shiftDay = (date, by) => new Date(Date.parse(date) + by * DAY).toISOString().slice(0, 10);

/** The UTC date of a moment, as editions are dated. */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);
export const emptyLedger = () => ({ schema: 1, days: {} });

/** The ledger a stored string holds, or null when it isn't one. */
export function parseLedger(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (!isRecord(value) || value.schema !== 1 || !isRecord(value.days)) return null;
    const days = {};
    for (const [date, entry] of Object.entries(value.days)) {
      if (!isDate(date) || !isRecord(entry) || !PIECES.includes(entry.piece) || typeof entry.won !== 'boolean') return null;
      if (entry.score !== undefined && !(entry.won && isScore(entry.score))) return null;
      days[date] = { piece: entry.piece, won: entry.won, ...(entry.score && { score: [...entry.score] }) };
    }
    return { schema: 1, days };
  } catch { return null; }
}

/** The stored form, days in order, so equal ledgers store equal strings. */
export function serializeLedger(ledger) {
  return JSON.stringify({ schema: 1, days: Object.fromEntries(Object.keys(ledger.days).sort().map((date) => [date, ledger.days[date]])) });
}

// One day, two records: a win beats a day only entered, a scored win beats an
// unscored one, and otherwise the record already held stands.
function better(current, incoming) {
  if (!current) return incoming;
  if (current.won !== incoming.won) return current.won ? current : incoming;
  return current.won && !current.score && incoming.score ? incoming : current;
}

/** The union of two ledgers; where both hold a day, `current`'s stands unless `incoming`'s is better. */
export function mergeLedgers(current, incoming) {
  const days = { ...current.days };
  for (const [date, entry] of Object.entries(incoming.days)) days[date] = better(days[date], entry);
  return { schema: 1, days };
}

/** Each floor's moves against par for a won official run, or null without three pars and three counts. */
export function runScore(state, daily) {
  const pars = state?.status === 'won' ? runPars(state, daily) : null;
  if (!pars) return null;
  const score = pars.map((par, floor) => scoredMoves(state.records?.find((record) => record.floor === floor)) - par);
  return isScore(score) ? score : null;
}

/**
 * The ledger after a run of `daily` as it stands on the UTC day `today`: the
 * day's official run is entered, and won, only on its own day. Any other run
 * (a past edition, practice, another piece) returns the same ledger.
 */
export function noteRun(ledger, state, daily, today) {
  if (!state || state.practice === true || !isDate(today) || daily?.date !== today || state.date !== today || !isOfficialRun(state, daily)) return ledger;
  const score = runScore(state, daily);
  const entry = better(ledger.days[today], { piece: daily.playerPiece, won: state.status === 'won', ...(score && { score }) });
  return entry === ledger.days[today] ? ledger : { schema: 1, days: { ...ledger.days, [today]: entry } };
}

/**
 * A ledger from saves alone, for a device or a backup from before there was
 * one. It assumes every official save was played on its own day: a won save
 * counts as won that day, any other as entered. `saves` is [key, serialized]
 * pairs, keys relative to the app's prefix; only official runs (`daily:` keys)
 * of editions from the first through `today` count. A win under the current
 * rules keeps its score against par; an older ruleset's rooms are gone, so its
 * win has none.
 */
export function backfillLedger(saves, today) {
  let ledger = emptyLedger();
  for (const [key, raw] of saves) {
    const [, version, date] = SAVE_KEY.exec(key) ?? [];
    if (!isDate(date) || date < FIRST_EDITION_DATE || date > today) continue;
    try {
      const run = JSON.parse(raw);
      if (!isRecord(run) || run.date !== date || !['playing', 'won', 'lost'].includes(run.status)) continue;
      const piece = PIECES.includes(run.startingPiece) ? run.startingPiece : getRawDaily(date).playerPiece;
      const score = run.status === 'won' && Number(version) === RULES_VERSION && validateSave(run, date) ? runScore(run, getDaily(date)) : null;
      ledger = mergeLedgers(ledger, { days: { [date]: { piece, won: run.status === 'won', ...(score && { score }) } } });
    } catch {}
  }
  return ledger;
}

/** Days won in a row ending on `date`; 0 when `date` itself wasn't won. */
export function streakThrough(ledger, date) {
  let streak = 0;
  for (let day = date; ledger.days[day]?.won; day = shiftDay(day, -1)) streak++;
  return streak;
}

/** The streak as of `today`: a day not yet won doesn't break it until that day is over. */
export function currentStreak(ledger, today) {
  return streakThrough(ledger, today) || streakThrough(ledger, shiftDay(today, -1));
}

/** The longest run of days won in a row. */
export function bestStreak(ledger) {
  let best = 0, run = 0, previous = null;
  for (const date of Object.keys(ledger.days).filter((day) => ledger.days[day].won).sort()) {
    run = previous !== null && shiftDay(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

/**
 * The Stats page's numbers: days entered and won, the streak as of `today` and
 * the best, scored floors by result against par ([under, even, +1, +2, +3 or
 * more]), and wins by piece.
 */
export function summarize(ledger, today) {
  const days = Object.values(ledger.days);
  const wins = days.filter((day) => day.won);
  const par = [0, 0, 0, 0, 0];
  for (const { score } of wins) for (const moves of score ?? []) par[moves < 0 ? 0 : Math.min(moves, 3) + 1]++;
  const pieces = Object.fromEntries(PIECES.map((piece) => [piece, wins.filter((day) => day.piece === piece).length]));
  return { played: days.length, won: wins.length, streak: currentStreak(ledger, today), best: bestStreak(ledger), par, pieces };
}

/** How a streak is written, on the paper and the share card: nothing below 2. */
export const streakMark = (streak) => (Number.isInteger(streak) && streak >= 2 ? `🔥${streak}` : '');

/** A share card with the streak closing its title line; unchanged below a streak of 2. */
export function shareStreak(card, streak) {
  const mark = streakMark(streak);
  if (!mark) return card;
  const [title, ...rest] = card.split('\n');
  return [`${title} · ${mark}`, ...rest].join('\n');
}

/**
 * The stored ledger after restoring a backup that carries one (`incomingRaw`),
 * a union of both, or null when the device's stays as it is. Throws on an
 * unreadable incoming ledger; an unreadable one on the device is replaced.
 */
export function planLedgerMerge(currentRaw, incomingRaw) {
  const incoming = parseLedger(incomingRaw);
  if (!incoming) throw new Error('This backup contains an unreadable ledger.');
  const current = parseLedger(currentRaw);
  const merged = serializeLedger(mergeLedgers(current ?? emptyLedger(), incoming));
  return current && merged === serializeLedger(current) ? null : merged;
}

/**
 * The device's ledger in `storage` (localStorage, or anything like it) under
 * the app's `prefix`. Every read goes to storage, so other windows and
 * restored backups show at once. With no ledger stored, the saves on the
 * device stand in (backfillLedger) and the result is stored, unless it is
 * empty: a brand-new device stays one until its first dungeon.
 */
export function openLedger(storage, prefix, { today = utcDay } = {}) {
  const name = `${prefix}${LEDGER_KEY}`;
  let cached = { raw: null, ledger: emptyLedger(), unsaved: false };
  const keep = (ledger) => {
    const raw = serializeLedger(ledger);
    cached = { raw, ledger, unsaved: false };
    // Storage that refuses the write still gets this visit's ledger from memory.
    try { storage.setItem(name, raw); } catch { cached.unsaved = true; }
    return ledger;
  };
  function saves() {
    const found = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(`${prefix}daily:`)) found.push([key.slice(prefix.length), storage.getItem(key)]);
    }
    return found;
  }
  function read() {
    try {
      const raw = storage.getItem(name);
      if (raw === cached.raw ? raw !== null : raw === null && cached.unsaved) return cached.ledger;
      const stored = parseLedger(raw);
      if (stored) { cached = { raw, ledger: stored, unsaved: false }; return stored; }
      const filled = backfillLedger(saves(), today());
      return Object.keys(filled.days).length ? keep(filled) : filled;
    } catch { return cached.ledger; }
  }
  return {
    read,
    /** Record today's official run: entered, or won, on its own UTC day. */
    note(state, daily) {
      const ledger = read();
      const next = noteRun(ledger, state, daily, today());
      if (next !== ledger) keep(next);
    },
    /** After restoring a backup from before the ledger: its saves stand in for one. */
    adopt(saves) {
      if (!isRecord(saves) || Object.hasOwn(saves, LEDGER_KEY)) return;
      const ledger = read();
      const merged = mergeLedgers(ledger, backfillLedger(Object.entries(saves), today()));
      if (serializeLedger(merged) !== serializeLedger(ledger)) keep(merged);
    },
    streak: () => currentStreak(read(), today()),
    streakOn: (date) => streakThrough(read(), date),
    summary: () => summarize(read(), today()),
  };
}
