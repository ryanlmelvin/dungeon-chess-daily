// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The Lockout (src/composer.js composeLockout), a second partner floor, in
// preview: composeDay's `lockout` option, off unless asked for, so no stored
// edition has one. Each of the floor's two targets paces a pocket of two
// squares; your pawn recruit, ordered into one's home while it is out, leaves
// it nowhere to go, and you take it where it stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDay, composeLockout, lockoutFloors, lockoutAt, steeredWin, partnerActions, shortestWins, playLine, composedSeeds, LOCKOUTS, LOCKOUT_MOTIF, LOCKOUT_MOVES, RELEASE, MOTIF_LEVELS, TANDEMS } from '../src/composer.js';
import { EDITIONS } from '../src/editions.js';
import { decodeMotifs, encodeMotifs, isMotifName } from '../src/motif-code.js';
import { createGame, act, recruitChoice, validateSave } from '../src/rules.js';
import { routeTransition } from '../src/fairness.js';
import { getRawDaily } from '../src/edition.js';
import { proveComposed } from '../src/generation.js';
import { PAGES, PREVIEW_PAGES, UNFOUND_TEXT, pageFor, bookPages, emptyJournal, addFinds, floorFinds } from '../src/journal.js';
import { previewOptions, composedSaveTag, previewJournals } from '../src/composed-preview.js';

const STEERED = { recruit: 'steer' };
const same = (a, b) => a.x === b.x && a.y === b.y;
const baseOf = (date) => ({ ...getRawDaily(date), difficulty: 'fair', modifier: 'none', floorSeeds: composedSeeds(date) });
// 2026-12-04: a knight against two bishops on floor 1. 2027-01-21: a queen against two knights on floor 1.
// 2027-01-12: a knight's day of cracked tiles, its lockout on floor 2.
const KNIGHT_DAY = '2026-12-04', QUEEN_DAY = '2027-01-21', TERRAIN_DAY = '2027-01-12';
const open = { map: Array(8).fill('........'), enemies: [], items: [] };
// A floor 1 composed alone, and the game as it opens there.
const composed = new Map();
function floorOne(date) {
  if (!composed.has(date)) {
    const base = baseOf(date), floor = composeLockout(base, 0);
    composed.set(date, { base, floor, start: floor && createGame({ ...base, composed: [floor.room, open, open] }) });
  }
  return composed.get(date);
}
// Every win from `state` within `moves` moves, never captured, the recruit steered and every order tried.
function wins(state, moves, path = []) {
  const found = [];
  for (const action of partnerActions(state, moves === 1)) {
    const next = routeTransition(state, action, STEERED);
    if (!next) continue;
    if (next.exit.open) found.push([...path, action]); else if (moves > 1) found.push(...wins(next, moves - 1, [...path, action]));
  }
  return found;
}

test('the lockout is a preview: no part of the release, and no stored edition has one', () => {
  assert.equal(RELEASE.lockout, undefined);
  assert.equal(LOCKOUT_MOTIF, 'lockout');
  assert.equal(MOTIF_LEVELS.lockout, 3);
  for (const [date, entry] of Object.entries(EDITIONS)) assert.ok(!decodeMotifs(entry.motifs).includes(LOCKOUT_MOTIF), date);
  // Its name is stored whole, should an edition ever carry it.
  assert.ok(isMotifName(LOCKOUT_MOTIF));
  assert.equal(encodeMotifs(['lockout', 'bait', 'net']), 'lockout,b,n');
  assert.deepEqual(decodeMotifs('lockout,b,n'), ['lockout', 'bait', 'net']);
  // The dev preview composes one only when its query asks, files its page in the journal, and saves apart.
  assert.ok(!('lockout' in previewOptions(`?composed=${KNIGHT_DAY}`)), 'as released, the preview names no such option');
  assert.ok(!('lockout' in previewOptions(`?composed=${KNIGHT_DAY}&lockout=0`)));
  assert.equal(previewOptions(`?composed=${KNIGHT_DAY}&lockout=1`).lockout, true);
  assert.equal(previewOptions(`?composed=${KNIGHT_DAY}&lockout=all`).lockout, true);
  assert.equal(composedSaveTag(`?composed=${KNIGHT_DAY}`), 'composed:wide:');
  assert.equal(composedSaveTag(`?composed=${KNIGHT_DAY}&lockout=1`), 'composed:wide:lockout:');
  assert.equal(previewJournals(`?composed=${KNIGHT_DAY}`), false);
  assert.equal(previewJournals(`?composed=${KNIGHT_DAY}&lockout=1`), true);
});

test('a lockout fits a knight against bishops and a queen against knights, on floor 1 or 2', () => {
  assert.deepEqual(LOCKOUTS, { knight: ['bishop'], queen: ['knight'] });
  // Each is one of a Tandem's matchups.
  for (const [piece, targets] of Object.entries(LOCKOUTS)) for (const target of targets) assert.ok(TANDEMS[piece].includes(target), `${piece} against ${target}`);
  let fits = 0;
  for (const date of Object.keys(EDITIONS)) {
    const base = baseOf(date), floors = lockoutFloors(base);
    assert.deepEqual([...floors].sort(), [0, 1].filter((floor) => LOCKOUTS[base.playerPiece]?.includes(base.targets[floor])), date);
    if (floors.length) fits++;
  }
  const share = fits / Object.keys(EDITIONS).length;
  assert.ok(share > 0.09 && share < 0.17, `${fits} stored days fit one`);
  // No rook's, bishop's or pawn's day does, and a floor whose matchup has none composes none.
  assert.equal(composeLockout(baseOf('2026-11-16'), 0), null, 'a rook\'s day');
  assert.equal(composeLockout(baseOf(KNIGHT_DAY), 2), null, 'the king floor');
});

for (const date of [KNIGHT_DAY, QUEEN_DAY]) {
  test(`a lockout floor: the pawn steps into a target's home, and the target stays out to be taken (${date})`, () => {
    const { floor, start } = floorOne(date);
    assert.ok(floor, 'it composes');
    assert.equal(floor.motif, LOCKOUT_MOTIF);
    assert.equal(floor.recruit, 'pawn');
    assert.equal(floor.hint, null);
    const { room, line } = floor;
    // The room: both targets, and a pawn recruit one move from the start; no chest, and nothing hinted.
    const pawn = room.items.filter((item) => item.type === 'companion');
    assert.deepEqual(pawn.map((item) => item.piece), ['pawn']);
    assert.ok(!room.items.some((item) => item.type === 'chest' || item.hint));
    assert.equal(room.enemies.filter((foe) => foe.cast === 0).length, 2);
    // The line: three moves, the first onto the pawn with the order that sends it up its file, into the home.
    assert.equal(line.length, LOCKOUT_MOVES);
    assert.equal(floor.depth, LOCKOUT_MOVES);
    assert.deepEqual([line[0].type, line[0].x, line[0].y], ['move', pawn[0].x, pawn[0].y]);
    assert.ok(line[0].recruit && line[0].recruit !== 'hold' && line[0].recruit.x === pawn[0].x && line[0].recruit.y < pawn[0].y);
    assert.equal(floor.locks, 1);
    const choice = recruitChoice(start, { type: 'move', x: line[0].x, y: line[0].y });
    assert.ok(choice.moves.some((move) => same(move, line[0].recruit) && !move.capture));
    assert.equal(choice.moves.length > 1, floor.choice, 'a second step to choose, where the room has one');
    // It wins, never captured, every position a valid save. You take both targets: the pawn takes nothing while the
    // floor is being won (once it is cleared a recruit hunts by itself, and may take a decoy).
    const states = playLine(start, line, STEERED);
    assert.ok(states?.at(-1).exit.open && states.every((state) => state.hits === 0));
    assert.ok(states.slice(0, -1).every((state) => !state.exit.open && !state.events.some((event) => event.type === 'companion-capture')));
    assert.equal(states.flatMap((state, n) => state.events.filter((event) => event.type === 'capture' && states[n - 1].enemies.find((foe) => foe.id === event.id)?.role === start.objective.piece)).length, 2);
    for (const state of states) assert.equal(validateSave(JSON.parse(JSON.stringify(state)), date, { ...baseOf(date), composed: [room, open, open] }), true);
    // The target locked out stands where it stood as the floor opened, and is taken there on the second move.
    assert.equal(lockoutAt(states, line), 0);
    const locked = states[0].enemies.find((foe) => same(foe, line[1]));
    assert.ok(locked && locked.role === states[0].objective.piece);
    assert.ok(same(states[1].enemies.find((foe) => foe.id === locked.id), locked), 'it has not moved');
    // Held instead, the pawn leaves its home open, and the target steps back into it.
    const loose = act(start, { ...line[0], recruit: 'hold' });
    assert.ok(same(loose.enemies.find((foe) => foe.id === locked.id), line[0].recruit), 'without the order it goes home');
    // Nothing wins sooner, whatever the pawn is told; every win in three moves locks a target out; and without
    // the recruit nothing wins in three at all.
    assert.equal(steeredWin(start, LOCKOUT_MOVES - 1), false);
    const all = wins(start, LOCKOUT_MOVES);
    assert.equal(all.length, floor.lines);
    assert.ok(all.some((other) => JSON.stringify(other) === JSON.stringify(line)));
    for (const other of all) assert.ok(lockoutAt(playLine(start, other, STEERED), other) >= 0, JSON.stringify(other));
    assert.equal(shortestWins(start, LOCKOUT_MOVES), null);
  });
}

test('a day with a lockout floor composes and proves, the pawn on orders on that floor alone', () => {
  for (const date of [KNIGHT_DAY, TERRAIN_DAY]) {
    const { daily, floors, dropped } = composeDay(date, { lockout: true });
    assert.deepEqual(dropped, [], date);
    const at = floors.findIndex((floor) => floor.motif === LOCKOUT_MOTIF);
    assert.ok(at === 0 || at === 1, date);
    assert.equal(daily.generation.partner, at);
    assert.equal(daily.generation.motifs[at], LOCKOUT_MOTIF);
    // A partner floor: no chest, and the day's proof lets its recruit take orders there.
    assert.equal(floors[at].treasure, null);
    assert.equal(proveComposed(daily, daily.generation.certificate.actions, { saves: true, partner: at }).valid, true);
    assert.equal(proveComposed(daily, daily.generation.certificate.actions, { saves: true }).valid, false, 'unproved without its partner floor named');
    // The other floors are the day's own, as released.
    const released = composeDay(date).daily;
    for (const floor of [0, 1, 2]) if (floor !== at && released.generation.partner === undefined) assert.deepEqual(daily.composed[floor], released.composed[floor], `${date} floor ${floor + 1}`);
    // Cleared along its line, the floor finds the Lockout's page.
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) { if (state.floor === at && state.exit.open) break; state = act(state, action); }
    assert.ok(state.floor === at && state.exit.open, date);
    assert.equal(floorFinds(state, daily, at)[0], LOCKOUT_MOTIF, date);
  }
  // Asked for on a day whose matchup has none, the day is as released.
  assert.deepEqual(composeDay('2026-11-16', { lockout: true }).daily.composed, composeDay('2026-11-16').daily.composed);
});

test('the Lockout\'s page waits in preview: in the book only once it is found', () => {
  const page = pageFor('lockout');
  assert.ok(page && PREVIEW_PAGES.includes(page) && !PAGES.includes(page));
  assert.deepEqual([page.kind, page.name, page.pieces], ['idea', 'Lockout', ['knight', 'queen']]);
  assert.deepEqual(page.pieces, Object.keys(LOCKOUTS));
  assert.ok(page.text.length <= 96 && page.text.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 2, 'one or two short sentences');
  assert.ok(page.art && UNFOUND_TEXT[page.kind] && Number.isFinite(page.still));
  const context = new Proxy({}, { get: (target, name) => (name in target ? target[name] : () => {}), set: (target, name, value) => { target[name] = value; return true; } });
  const canvas = { width: 200, height: 200, getContext: () => context };
  for (const time of [0, page.still, 1234, 5599, 99_999]) assert.doesNotThrow(() => page.draw(canvas, time), `at ${time}`);
  const empty = emptyJournal();
  assert.equal(bookPages(empty), PAGES);
  const found = addFinds(empty, ['lockout'], 'knight', KNIGHT_DAY).journal;
  const book = bookPages(found), moves = book.findIndex((entry) => entry.kind !== 'idea');
  assert.equal(book.length, PAGES.length + 1);
  assert.equal(book[moves - 1], page, 'after the released ideas, before the special moves');
});
