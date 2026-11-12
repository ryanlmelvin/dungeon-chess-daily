// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEDGER_KEY, backfillLedger, bestStreak, currentStreak, emptyLedger, holdStreak, mergeLedgers, noteRun, openLedger, parseLedger,
  planLedgerMerge, runScore, serializeLedger, shareStreak, streakMark, cardStreak, streakThrough, summarize, utcDay,
} from '../src/stats.js';
import { planBackupMerge } from '../src/backups.js';
import { act, createGame, createPracticeGame, getDaily, getShareText, PLAYABLE_PIECES, RULES_VERSION } from '../src/game.js';
import { floorPars } from '../src/par.js';

const prefix = 'dchess:/test/:';
const saveKey = (date, version = RULES_VERSION) => `daily:v${version}:${date}`;
/** The day's edition, a run just entered, and the same run won along the planted lines (one under par a floor). */
function runs(date) {
  const daily = getDaily(date);
  const entered = createGame(daily);
  let won = entered;
  for (const action of daily.generation.certificate.actions) won = act(won, action);
  assert.equal(won.status, 'won');
  return { daily, entered, won };
}
const fifth = runs('2026-11-05');
const sixth = runs('2026-11-06');
/** The same win with `extra` more moves on floor 1. */
const slower = (won, extra) => ({ ...won, records: won.records.map((record) => (record.floor === 0 ? { ...record, scored: record.scored + extra } : record)) });
const oldSave = (date, status = 'won', piece = 'rook') => JSON.stringify({ schema: 5, date, status, floor: status === 'won' ? 2 : 0, startingPiece: piece });
const ledgerOf = (days) => ({ schema: 1, days });
const wins = (...dates) => ledgerOf(Object.fromEntries(dates.map((date) => [date, { piece: 'rook', won: true }])));
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map, writes: 0,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (name) => map.get(name) ?? null,
    setItem(name, value) { this.writes++; map.set(name, String(value)); },
  };
}

test('a ledger survives storage, days in order, and anything else is not a ledger', () => {
  const ledger = ledgerOf({ '2026-11-07': { piece: 'bishop', won: true, score: [2, 0, -12] }, '2026-11-05': { piece: 'pawn', won: false }, '2026-11-06': { piece: 'rook', won: true } });
  const stored = serializeLedger(ledger);
  assert.deepEqual(parseLedger(stored), ledger);
  assert.deepEqual(Object.keys(JSON.parse(stored).days), ['2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(serializeLedger(parseLedger(stored)), stored);
  assert.deepEqual(parseLedger(serializeLedger(emptyLedger())), emptyLedger());
  for (const bad of [
    null, undefined, '', 'not json', '[]', '{"schema":2,"days":{}}', '{"schema":1}',
    JSON.stringify(ledgerOf({ '2026-13-01': { piece: 'rook', won: true } })),
    JSON.stringify(ledgerOf({ '2026-02-30': { piece: 'rook', won: true } })),
    JSON.stringify(ledgerOf({ '2026-11-05': { piece: 'dragon', won: true } })),
    JSON.stringify(ledgerOf({ '2026-11-05': { piece: 'rook', won: 'yes' } })),
    JSON.stringify(ledgerOf({ '2026-11-05': { piece: 'rook', won: true, score: [1, 2] } })),
    JSON.stringify(ledgerOf({ '2026-11-05': { piece: 'rook', won: true, score: [1, 2, 0.5] } })),
    JSON.stringify(ledgerOf({ '2026-11-05': { piece: 'rook', won: false, score: [0, 0, 0] } })),
  ]) assert.equal(parseLedger(bad), null, String(bad));
});

test('the ledger does not depend on the rules version', () => {
  assert.equal(LEDGER_KEY, 'ledger');
  assert.doesNotMatch(serializeLedger(noteRun(emptyLedger(), fifth.won, fifth.daily, '2026-11-05')), new RegExp(`v${RULES_VERSION}|rulesVersion`));
});

test('across a rules version bump the ledger reads as it was: a win scored under the old rules keeps its score', () => {
  // What a device held under the version before this one: a ledger with two scored wins, and a save one came from.
  const days = { '2026-11-04': { piece: 'knight', won: true, score: [1, 0, -1] }, '2026-11-05': { piece: fifth.daily.playerPiece, won: true, score: [0, 2, 0] } };
  const stored = serializeLedger(ledgerOf(days));
  const older = (run) => JSON.stringify({ ...run, schema: RULES_VERSION - 1, rulesVersion: RULES_VERSION - 1 });
  const oldKey = saveKey('2026-11-05', RULES_VERSION - 1);
  const storage = fakeStorage({ [`${prefix}${LEDGER_KEY}`]: stored, [`${prefix}${oldKey}`]: older(fifth.won) });
  const ledger = openLedger(storage, prefix, { today: () => '2026-11-06' });
  assert.equal(serializeLedger(ledger.read()), stored, 'read back unchanged');
  assert.equal(storage.writes, 0, 'nothing is back-filled or rewritten');
  assert.equal(ledger.streak(), 2);
  assert.deepEqual(ledger.summary().par, [1, 3, 1, 1, 0], 'the old scores still count on the Stats page');
  // Today's win under the new rules joins them, and the old scores stand.
  ledger.note(sixth.won, sixth.daily);
  assert.equal(ledger.streak(), 3);
  assert.deepEqual(ledger.read().days, { ...days, '2026-11-06': { piece: sixth.daily.playerPiece, won: true, score: [-1, -1, -1] } });
  // The old save itself can no longer be scored (its rooms were rebuilt): a device with no ledger counts it as a win without one,
  // and merging that into the ledger (an old backup restored) never drops the score already held.
  const filled = backfillLedger([[oldKey, older(fifth.won)]], '2026-11-06');
  assert.deepEqual(filled.days['2026-11-05'], { piece: fifth.daily.playerPiece, won: true });
  assert.deepEqual(mergeLedgers(parseLedger(stored), filled).days, days);
  assert.deepEqual(mergeLedgers(filled, parseLedger(stored)).days['2026-11-05'], days['2026-11-05'], 'whichever side holds it');
});

test('entering the official run on its own UTC day counts as played, and winning it records piece and score against par', () => {
  const { daily, entered, won } = fifth;
  const played = noteRun(emptyLedger(), entered, daily, '2026-11-05');
  assert.deepEqual(played, ledgerOf({ '2026-11-05': { piece: daily.playerPiece, won: false } }));
  assert.equal(noteRun(played, entered, daily, '2026-11-05'), played, 'nothing new: the same ledger');
  const done = noteRun(played, won, daily, '2026-11-05');
  // The planted lines are each one move under par (par is the line plus one).
  assert.deepEqual(done.days['2026-11-05'], { piece: daily.playerPiece, won: true, score: [-1, -1, -1] });
  assert.deepEqual(runScore(won, daily), [-1, -1, -1]);
  assert.deepEqual(runScore(slower(won, 3), daily), [2, -1, -1]);
  assert.equal(runScore(entered, daily), null);
  assert.deepEqual(played.days['2026-11-05'], { piece: daily.playerPiece, won: false }, 'inputs are not changed');
});

test('a win only counts on the edition’s own UTC day', () => {
  const { daily, won, entered } = fifth;
  for (const today of ['2026-11-04', '2026-11-06', '2027-11-05']) {
    const ledger = emptyLedger();
    assert.equal(noteRun(ledger, won, daily, today), ledger, `the 2026-11-05 edition won on ${today}`);
    assert.equal(noteRun(ledger, entered, daily, today), ledger);
  }
  // The day turns at 00:00 UTC, wherever the player is.
  assert.equal(utcDay(new Date('2026-11-05T23:59:59.999Z')), '2026-11-05');
  assert.equal(utcDay(new Date('2026-11-06T00:00:00.000Z')), '2026-11-06');
  assert.equal(utcDay(new Date('2026-11-05T19:30:00-05:00')), '2026-11-06');
  assert.equal(utcDay(new Date('2026-11-06T08:30:00+09:00')), '2026-11-05');
  const justInTime = noteRun(emptyLedger(), won, daily, utcDay(new Date('2026-11-05T23:59:59.999Z')));
  assert.equal(justInTime.days['2026-11-05'].won, true);
  const late = emptyLedger();
  assert.equal(noteRun(late, won, daily, utcDay(new Date('2026-11-06T00:00:00.000Z'))), late);
});

test('practice and other pieces never enter the ledger', () => {
  const { daily, won } = fifth;
  const ledger = emptyLedger();
  const samePiece = createPracticeGame(daily);
  assert.equal(noteRun(ledger, samePiece, daily, '2026-11-05'), ledger);
  assert.equal(noteRun(ledger, { ...won, practice: true }, daily, '2026-11-05'), ledger);
  const other = PLAYABLE_PIECES.find((piece) => piece !== daily.playerPiece);
  assert.equal(noteRun(ledger, { ...won, startingPiece: other }, daily, '2026-11-05'), ledger);
  assert.equal(noteRun(ledger, { ...won, difficulty: 'fiendish' }, daily, '2026-11-05'), ledger);
  assert.equal(noteRun(ledger, null, daily, '2026-11-05'), ledger);
  // A run of another edition offered as today's.
  assert.equal(noteRun(ledger, sixth.won, daily, '2026-11-05'), ledger);
});

test('the first scored win of a day stands; a restart or a replay changes nothing', () => {
  const { daily, entered, won } = fifth;
  const first = noteRun(emptyLedger(), slower(won, 3), daily, '2026-11-05');
  assert.deepEqual(first.days['2026-11-05'].score, [2, -1, -1]);
  assert.equal(noteRun(first, entered, daily, '2026-11-05'), first, 'restarting today’s dungeon keeps the win');
  assert.equal(noteRun(first, won, daily, '2026-11-05'), first, 'a better replay does not rewrite the day');
  // A win counted from an older ruleset's save has no score; today's win under the current rules gives it one.
  const unscored = ledgerOf({ '2026-11-05': { piece: daily.playerPiece, won: true } });
  assert.deepEqual(noteRun(unscored, won, daily, '2026-11-05').days['2026-11-05'].score, [-1, -1, -1]);
  assert.equal(noteRun(unscored, entered, daily, '2026-11-05'), unscored);
});

test('streak: days won in a row, alive through today until today is over', () => {
  const ledger = wins('2026-11-05', '2026-11-06', '2026-11-07');
  assert.equal(currentStreak(emptyLedger(), '2026-11-07'), 0);
  assert.equal(bestStreak(emptyLedger()), 0);
  assert.equal(currentStreak(ledger, '2026-11-07'), 3, 'today won');
  assert.equal(currentStreak(ledger, '2026-11-08'), 3, 'today not yet played');
  assert.equal(currentStreak(mergeLedgers(ledger, ledgerOf({ '2026-11-08': { piece: 'rook', won: false } })), '2026-11-08'), 3, 'today entered, not yet won');
  assert.equal(currentStreak(ledger, '2026-11-09'), 0, 'the 8th ended unwon');
  assert.equal(currentStreak(ledger, '2026-11-05'), 1);
  assert.equal(currentStreak(ledger, '2026-11-04'), 0, 'days after today are not a streak yet');
  assert.equal(bestStreak(ledger), 3);
  assert.equal(streakThrough(ledger, '2026-11-06'), 2);
  assert.equal(streakThrough(ledger, '2026-11-08'), 0);
});

test('streak: a gap or a day entered but not won breaks it, and the best one is kept', () => {
  const gap = wins('2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06');
  assert.equal(currentStreak(gap, '2026-11-06'), 2);
  assert.equal(currentStreak(gap, '2026-11-07'), 2);
  assert.equal(bestStreak(gap), 3);
  const unwon = mergeLedgers(wins('2026-11-05', '2026-11-07'), ledgerOf({ '2026-11-06': { piece: 'pawn', won: false } }));
  assert.equal(currentStreak(unwon, '2026-11-07'), 1);
  assert.equal(bestStreak(unwon), 1);
  assert.equal(bestStreak(wins('2026-11-09')), 1);
  // A later, longer run takes over as the best.
  assert.equal(bestStreak(mergeLedgers(gap, wins('2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'))), 4);
});

test('streak: months, years and leap days are consecutive UTC days', () => {
  assert.equal(currentStreak(wins('2026-11-30', '2026-12-01'), '2026-12-01'), 2);
  assert.equal(currentStreak(wins('2026-12-30', '2026-12-31', '2027-01-01'), '2027-01-02'), 3);
  assert.equal(currentStreak(wins('2028-02-28', '2028-02-29', '2028-03-01'), '2028-03-01'), 3);
  assert.equal(currentStreak(wins('2027-02-28', '2027-03-01'), '2027-03-01'), 2);
  assert.equal(bestStreak(wins('2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02')), 4);
  // The weeks the clocks change in the US and Europe are plain days in UTC.
  assert.equal(currentStreak(wins('2027-03-13', '2027-03-14', '2027-03-15'), '2027-03-15'), 3);
  assert.equal(currentStreak(wins('2027-10-30', '2027-10-31', '2027-11-01'), '2027-11-01'), 3);
});

test('the stats page counts days, floors against par and wins by piece', () => {
  const ledger = ledgerOf({
    '2026-11-03': { piece: 'knight', won: true, score: [-2, 0, 1] },
    '2026-11-04': { piece: 'knight', won: true, score: [0, 2, 3] },
    '2026-11-05': { piece: 'pawn', won: false },
    '2026-11-06': { piece: 'queen', won: true },
    '2026-11-07': { piece: 'bishop', won: true, score: [-1, 9, 0] },
  });
  assert.deepEqual(summarize(ledger, '2026-11-08'), {
    played: 5, won: 4, streak: 2, best: 2,
    par: [2, 3, 1, 1, 2],
    pieces: { pawn: 0, rook: 0, knight: 2, bishop: 1, queen: 1, king: 0 },
  });
  assert.deepEqual(summarize(emptyLedger(), '2026-11-08'), { played: 0, won: 0, streak: 0, best: 0, par: [0, 0, 0, 0, 0], pieces: { pawn: 0, rook: 0, knight: 0, bishop: 0, queen: 0, king: 0 } });
});

test('back-fill: saves from before the ledger count as played on their own day', () => {
  const saves = [
    [saveKey('2026-11-05'), JSON.stringify(fifth.won)],
    [saveKey('2026-11-06'), JSON.stringify(sixth.entered)],
    [saveKey('2026-11-04', 5), oldSave('2026-11-04', 'won', 'queen')],
    [saveKey('2026-11-03', 9), oldSave('2026-11-03', 'lost', 'knight')],
    ['daily:2026-11-02', JSON.stringify({ schema: 2, date: '2026-11-02', status: 'won', floor: 2 })],
    // Not official runs of an edition up to today:
    [`practice:v${RULES_VERSION}:2026-11-07`, JSON.stringify({ ...fifth.won, date: '2026-11-07', practice: true })],
    [saveKey('2026-10-31', 5), oldSave('2026-10-31')],
    [saveKey('2026-11-09', 5), oldSave('2026-11-09')],
    [saveKey('2026-11-07', 5), 'not json'],
    [saveKey('2026-11-08', 5), oldSave('2026-11-01')],
    ['sound', 'on'],
    ['daily:v5:2026-02-30', oldSave('2026-02-30')],
  ];
  const ledger = backfillLedger(saves, '2026-11-08');
  assert.deepEqual(ledger, ledgerOf({
    '2026-11-05': { piece: fifth.daily.playerPiece, won: true, score: [-1, -1, -1] },
    '2026-11-06': { piece: sixth.daily.playerPiece, won: false },
    '2026-11-04': { piece: 'queen', won: true },
    '2026-11-03': { piece: 'knight', won: false },
    '2026-11-02': { piece: getDaily('2026-11-02').playerPiece, won: true },
  }));
  assert.equal(currentStreak(ledger, '2026-11-06'), 2);
});

test('back-fill: one day saved under two rulesets keeps its win, and the scored one', () => {
  const date = '2026-11-05';
  const scored = { piece: fifth.daily.playerPiece, won: true, score: [-1, -1, -1] };
  for (const saves of [
    [[saveKey(date, 9), oldSave(date, 'won', fifth.daily.playerPiece)], [saveKey(date), JSON.stringify(fifth.won)]],
    [[saveKey(date), JSON.stringify(fifth.won)], [saveKey(date, 9), oldSave(date, 'won', fifth.daily.playerPiece)]],
  ]) assert.deepEqual(backfillLedger(saves, date).days[date], scored);
  const replayed = backfillLedger([[saveKey(date, 9), oldSave(date, 'won', 'rook')], [saveKey(date), JSON.stringify(fifth.entered)]], date);
  assert.deepEqual(replayed.days[date], { piece: 'rook', won: true }, 'a run in progress under new rules does not undo the win');
  // A current-rules save that no longer fits its edition still counts as won, without a score.
  const stale = backfillLedger([[saveKey(date), JSON.stringify({ ...fifth.won, seed: fifth.won.seed + 1 })]], date);
  assert.deepEqual(stale.days[date], { piece: fifth.daily.playerPiece, won: true });
});

test('the device’s ledger is back-filled once, and a brand-new device stores nothing until its first dungeon', () => {
  const fresh = fakeStorage();
  const empty = openLedger(fresh, prefix, { today: () => '2026-11-06' });
  assert.deepEqual(empty.read(), emptyLedger());
  assert.deepEqual(empty.summary().played, 0);
  assert.equal(empty.streak(), 0);
  assert.equal(fresh.map.size, 0, 'nothing written: still a first visit');
  empty.note(sixth.entered, sixth.daily);
  assert.deepEqual(parseLedger(fresh.map.get(`${prefix}${LEDGER_KEY}`)), ledgerOf({ '2026-11-06': { piece: sixth.daily.playerPiece, won: false } }));

  const storage = fakeStorage({
    [`${prefix}${saveKey('2026-11-05')}`]: JSON.stringify(fifth.won),
    [`${prefix}${saveKey('2026-11-04', 9)}`]: oldSave('2026-11-04'),
    [`dchess:/elsewhere/:${saveKey('2026-11-03', 9)}`]: oldSave('2026-11-03'),
    [`${prefix}sound`]: 'on',
  });
  const ledger = openLedger(storage, prefix, { today: () => '2026-11-06' });
  assert.equal(ledger.streak(), 2);
  assert.equal(ledger.streakOn('2026-11-05'), 2);
  assert.equal(ledger.streakOn('2026-11-06'), 0);
  assert.equal(storage.writes, 1);
  // Once: a save that turns up later (an archive win, say) is not swept in.
  storage.map.set(`${prefix}${saveKey('2026-11-03', 9)}`, oldSave('2026-11-03'));
  assert.equal(ledger.streak(), 2);
  assert.equal(openLedger(storage, prefix, { today: () => '2026-11-06' }).summary().won, 2);
  assert.equal(storage.writes, 1);
  // Today's run: entered, then won, each written once.
  ledger.note(sixth.entered, sixth.daily);
  ledger.note(sixth.entered, sixth.daily);
  assert.equal(storage.writes, 2);
  assert.equal(ledger.streak(), 2);
  ledger.note(sixth.won, sixth.daily);
  ledger.note(sixth.won, sixth.daily);
  assert.equal(storage.writes, 3);
  assert.equal(ledger.streak(), 3);
  assert.deepEqual(ledger.summary(), { played: 3, won: 3, streak: 3, best: 3, par: [6, 0, 0, 0, 0], pieces: { ...Object.fromEntries(['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'].map((piece) => [piece, 0])), ...countPieces(['rook', fifth.daily.playerPiece, sixth.daily.playerPiece]) } });
  // A past edition opened from the archive the next day is not today's.
  const tomorrow = openLedger(storage, prefix, { today: () => '2026-11-07' });
  tomorrow.note(sixth.won, sixth.daily);
  tomorrow.note(fifth.won, fifth.daily);
  assert.equal(storage.writes, 3);
  assert.equal(tomorrow.streak(), 3);
});
function countPieces(pieces) {
  const counts = {};
  for (const piece of pieces) counts[piece] = (counts[piece] ?? 0) + 1;
  return counts;
}

test('the ledger follows storage: another window, an unreadable ledger, and storage that fails', () => {
  const storage = fakeStorage({ [`${prefix}${saveKey('2026-11-04', 9)}`]: oldSave('2026-11-04') });
  const ledger = openLedger(storage, prefix, { today: () => '2026-11-05' });
  assert.equal(ledger.summary().won, 1);
  // Another window (or a restored backup) wrote a longer ledger.
  storage.map.set(`${prefix}${LEDGER_KEY}`, serializeLedger(wins('2026-11-02', '2026-11-03', '2026-11-04')));
  assert.equal(ledger.streak(), 3);
  // An unreadable ledger is rebuilt from the saves.
  storage.map.set(`${prefix}${LEDGER_KEY}`, '{"schema":1,"days":{"2026-11-04":{"piece":"rook"}}}');
  assert.equal(ledger.streak(), 1);
  assert.deepEqual(parseLedger(storage.map.get(`${prefix}${LEDGER_KEY}`)), ledgerOf({ '2026-11-04': { piece: 'rook', won: true } }));
  // Storage that throws never breaks play, and this visit's win still shows.
  const broken = { get length() { return 0; }, key: () => null, getItem: () => null, setItem() { throw new Error('full'); } };
  const offline = openLedger(broken, prefix, { today: () => '2026-11-05' });
  offline.note(fifth.won, fifth.daily);
  assert.equal(offline.summary().won, 1);
  const dead = { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); }, getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const denied = openLedger(dead, prefix, { today: () => '2026-11-05' });
  assert.doesNotThrow(() => denied.note(fifth.won, fifth.daily));
  assert.equal(denied.streak(), 1);
});

test('merging ledgers is a union of days: wins beat days only entered, and the device’s own win stands', () => {
  const local = ledgerOf({
    '2026-11-03': { piece: 'rook', won: true, score: [0, 0, 0] },
    '2026-11-04': { piece: 'queen', won: false },
    '2026-11-05': { piece: 'pawn', won: true },
    '2026-11-06': { piece: 'bishop', won: true, score: [1, 1, 1] },
  });
  const incoming = ledgerOf({
    '2026-11-04': { piece: 'queen', won: true, score: [2, 0, 0] },
    '2026-11-05': { piece: 'pawn', won: true, score: [0, 1, 0] },
    '2026-11-06': { piece: 'bishop', won: true, score: [5, 5, 5] },
    '2026-11-07': { piece: 'knight', won: false },
  });
  const before = [structuredClone(local), structuredClone(incoming)];
  const merged = mergeLedgers(local, incoming);
  assert.deepEqual(merged, ledgerOf({
    '2026-11-03': { piece: 'rook', won: true, score: [0, 0, 0] },
    '2026-11-04': { piece: 'queen', won: true, score: [2, 0, 0] },
    '2026-11-05': { piece: 'pawn', won: true, score: [0, 1, 0] },
    '2026-11-06': { piece: 'bishop', won: true, score: [1, 1, 1] },
    '2026-11-07': { piece: 'knight', won: false },
  }));
  assert.deepEqual([local, incoming], before, 'inputs are not changed');
  assert.deepEqual(mergeLedgers(merged, incoming), merged);
  assert.deepEqual(mergeLedgers(merged, local), merged);
  assert.equal(currentStreak(merged, '2026-11-07'), 4);
  // The same days whichever side restores, apart from which of two scored wins stands.
  assert.deepEqual(Object.keys(mergeLedgers(incoming, local).days).sort(), Object.keys(merged.days).sort());
  assert.deepEqual(mergeLedgers(incoming, local).days['2026-11-06'].score, [5, 5, 5]);
});

test('a backup carries the ledger and restoring merges it as a union', () => {
  const backup = (saves) => ({ app: 'dungeon-chess-daily', schema: 1, saves });
  const local = serializeLedger(wins('2026-11-03', '2026-11-04'));
  const theirs = serializeLedger(mergeLedgers(wins('2026-11-04', '2026-11-05'), ledgerOf({ '2026-11-02': { piece: 'pawn', won: false } })));
  const union = serializeLedger(mergeLedgers(parseLedger(local), parseLedger(theirs)));
  assert.deepEqual(Object.keys(parseLedger(union).days), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);

  const plan = planBackupMerge(new Map([[LEDGER_KEY, local]]), backup({ [LEDGER_KEY]: theirs }));
  assert.deepEqual([...plan.writes], [[LEDGER_KEY, union]]);
  assert.deepEqual(plan.unreadable, []);
  assert.equal(plan.archived, false);
  // Nothing new in the backup: nothing to write.
  assert.equal(planBackupMerge(new Map([[LEDGER_KEY, union]]), backup({ [LEDGER_KEY]: theirs })).writes.size, 0);
  assert.equal(planBackupMerge(new Map([[LEDGER_KEY, local]]), backup({ [LEDGER_KEY]: local })).writes.size, 0);
  // A device without a ledger takes the backup's, and an unreadable one of its own is replaced.
  assert.deepEqual([...planBackupMerge(new Map(), backup({ [LEDGER_KEY]: theirs })).writes], [[LEDGER_KEY, theirs]]);
  assert.deepEqual([...planBackupMerge(new Map([[LEDGER_KEY, 'garbage']]), backup({ [LEDGER_KEY]: theirs })).writes], [[LEDGER_KEY, theirs]]);
  assert.equal(planLedgerMerge(local, theirs), union);
  assert.equal(planLedgerMerge(union, local), null);

  // It rides beside the saves, and an unreadable ledger rejects the whole backup before any write.
  const key = saveKey('2026-11-05');
  const both = planBackupMerge(new Map([[LEDGER_KEY, local]]), backup({ [key]: JSON.stringify(fifth.won), [LEDGER_KEY]: theirs, sound: 'off' }));
  assert.deepEqual([...both.writes.keys()].sort(), [key, LEDGER_KEY, 'sound'].sort());
  for (const bad of ['garbage', '{"schema":1,"days":{"2026-11-05":{"piece":"dragon","won":true}}}', 7, null]) {
    assert.throws(() => planBackupMerge(new Map([[LEDGER_KEY, local]]), backup({ [key]: JSON.stringify(fifth.won), [LEDGER_KEY]: bad })), /unreadable ledger/);
  }
});

test('restoring a backup from before the ledger counts its saves, and one with a ledger is left to the merge', () => {
  const storage = fakeStorage({ [`${prefix}${LEDGER_KEY}`]: serializeLedger(wins('2026-11-06')) });
  const ledger = openLedger(storage, prefix, { today: () => '2026-11-06' });
  const old = { [saveKey('2026-11-05')]: JSON.stringify(fifth.won), [saveKey('2026-11-04', 9)]: oldSave('2026-11-04'), sound: 'on' };
  ledger.adopt({ ...old, [LEDGER_KEY]: serializeLedger(wins('2026-11-01')) });
  assert.equal(storage.writes, 0);
  ledger.adopt(old);
  assert.equal(storage.writes, 1);
  assert.equal(ledger.streak(), 3);
  assert.deepEqual(ledger.read().days['2026-11-05'], { piece: fifth.daily.playerPiece, won: true, score: [-1, -1, -1] });
  ledger.adopt(old);
  ledger.adopt(null);
  assert.equal(storage.writes, 1);
});

test('the page carries what the Stats page and the paper’s streak are drawn into', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['stats-button', 'stats-dialog', 'stats-totals', 'stats-par', 'stats-pieces', 'paper-streak']) {
    assert.equal(html.split(`id="${id}"`).length, 2, `one #${id}`);
  }
  // The streak sits in the dateline rule beside the edition number, hidden until there is one to show.
  assert.match(html, /id="paper-tier">[^<]*<\/span><span id="paper-streak" role="img" hidden><\/span>/);
  assert.equal(ledgerNeverThrows(), true);
});
function ledgerNeverThrows() {
  const ledger = openLedger(null, prefix, { today: () => '2026-11-05' });
  ledger.note(fifth.won, fifth.daily);
  ledger.note({ status: 'won' }, null);
  ledger.adopt({ [saveKey('2026-11-04', 9)]: oldSave('2026-11-04') });
  return ledger.streak() === 2 && ledger.summary().won === 2;
}

test('the share card closes its title line with a streak of 2 or more, and nothing else changes', () => {
  const now = new Date(Date.UTC(2026, 10, 5));
  const card = getShareText(fifth.won, floorPars(fifth.daily), { now });
  const [title, floors, link] = card.split('\n');
  assert.match(title, /^Dungeon Chess Daily · Nov 5 \S+$/u);
  // The flame and its count, held together by a word joiner so no line breaks between them.
  const mark = (streak) => `🔥\u2060${streak}`;
  // The card spells it out: "🔥12-day streak".
  const spelled = (streak) => `${mark(streak)}-day streak`;
  assert.equal(shareStreak(card, 12), `${title} · ${spelled(12)}\n${floors}\n${link}`);
  assert.equal(shareStreak(card, 12).replace('\u2060', ''), `${title} · 🔥12-day streak\n${floors}\n${link}`);
  assert.equal(shareStreak(card, 2).split('\n')[0], `${title} · ${spelled(2)}`);
  assert.equal(cardStreak(12), spelled(12));
  assert.equal(cardStreak(1), '');
  assert.equal(shareStreak(card, 365).split('\n').length, 3, 'never a new line');
  for (const none of [0, 1, -3, undefined, null, 2.5, '12']) assert.equal(shareStreak(card, none), card, String(none));
  assert.equal(streakMark(1), '');
  assert.equal(streakMark(2), mark(2));
  // The result paper's preview keeps the streak on the date's line, should the title wrap.
  // "12-day streak" stays whole there too: a no-break space and a no-break hyphen.
  assert.equal(holdStreak(`Dungeon\u00A0Chess\u00A0Daily · Nov\u00A05\u00A0♝ · ${mark(12)}-day\u00A0streak`), `Dungeon\u00A0Chess\u00A0Daily · Nov\u00A05\u00A0♝\u00A0·\u00A0${mark(12)}\u2011day\u00A0streak`);
  assert.equal(holdStreak(`Dungeon\u00A0Chess\u00A0Daily · Nov\u00A05\u00A0♝ · ${spelled(12)}`), `Dungeon\u00A0Chess\u00A0Daily · Nov\u00A05\u00A0♝\u00A0·\u00A0${mark(12)}\u2011day\u00A0streak`);
  assert.equal(holdStreak('Dungeon\u00A0Chess\u00A0Daily · Nov\u00A05\u00A0♝'), 'Dungeon\u00A0Chess\u00A0Daily · Nov\u00A05\u00A0♝');
  // The streak on a card is the one that ended on the card's own day, so a card whose day isn't in the ledger has none.
  const ledger = wins('2026-11-03', '2026-11-04', '2026-11-05');
  assert.equal(shareStreak(card, streakThrough(ledger, '2026-11-05')).split('\n')[0], `${title} · ${spelled(3)}`);
  assert.equal(shareStreak(card, streakThrough(ledger, '2026-11-06')), card);
  assert.equal(shareStreak(card, streakThrough(wins('2026-11-05'), '2026-11-05')), card, 'a streak of 1 shows nothing');
});
