// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Mate floors (src/composer.js composeMate), an idea in preview: a king floor
// that opens with your own king already at your side (`joined`, src/rules.js
// setFloor) and is won by the two of you in MATE_TURNS turns. composeDay's
// `mate` option is off unless asked for, so no stored edition has one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDay, composeMate, mateGuard, MATE_MOTIF, MATE_TURNS, MATE_WAITS, RELEASE, playLine, partnerActions, composedSeeds } from '../src/composer.js';
import { MATE_ARENAS } from '../src/mate-arenas.js';
import { ALPHABET } from '../src/route-code.js';
import { createGame, act, validateSave, legalMoves, recruitChoice } from '../src/rules.js';
import { routeTransition } from '../src/fairness.js';
import { getDaily } from '../src/game.js';
import { getRawDaily } from '../src/edition.js';
import { escorted, proveComposed } from '../src/generation.js';
import { composedDayFor, previewOptions, composedSaveTag, previewGame } from '../src/composed-preview.js';

const STEERED = { recruit: 'steer' };
// 2026-11-14: a knight's plain day. 2026-11-16: a rook's.
const KNIGHT_DAY = '2026-11-14', ROOK_DAY = '2026-11-16';
const composed = new Map();
const compose = (date) => { if (!composed.has(date)) composed.set(date, composeDay(date, { mate: true })); return composed.get(date); };
// The day's game as its king floor opens, the floors before it played along their lines.
function kingFloor(daily) {
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) { if (state.floor === 2) break; state = act(state, action); }
  return state;
}
// The day without its hint powerups: where a planted line is searched and certified (a certified route holds no power).
const twinOf = (daily) => ({ ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) });
const same = (a, b) => a.x === b.x && a.y === b.y;

test('the arenas are real mates: a piece, its king, the enemy king and a wall for every other enemy man', () => {
  assert.deepEqual(Object.keys(MATE_ARENAS), ['rook', 'queen', 'knight', 'bishop']);
  for (const [piece, arenas] of Object.entries(MATE_ARENAS)) {
    assert.ok(arenas.length >= 10 && new Set(arenas).size === arenas.length, `${piece}: ${arenas.length} distinct arenas`);
    for (const arena of arenas) {
      assert.ok(arena.length >= 4 && arena.length <= 9 && [...arena].every((ch) => ALPHABET.includes(ch)), `${piece} ${arena}`);
      assert.equal(new Set(arena).size, arena.length, `${piece} ${arena}: every square once`);
    }
  }
});

test('the mate floor is in preview: off unless asked for, and off a day composes as stored', () => {
  assert.equal(RELEASE.mate, undefined);
  assert.equal(previewOptions(`?composed=${KNIGHT_DAY}`).mate, false);
  assert.equal(previewOptions(`?composed=${KNIGHT_DAY}&mate=1`).mate, true);
  assert.equal(composedSaveTag(`?composed=${KNIGHT_DAY}&mate=1`), 'composed:wide:mate:');
  assert.equal(composedSaveTag(`?composed=${KNIGHT_DAY}&mate=1&floor=3`), 'composed:wide:mate:floor3:');
  const stored = getDaily(KNIGHT_DAY);
  assert.equal(stored.generation.motifs[2], 'net');
  assert.equal(escorted(stored), false);
  assert.deepEqual(composeDay(KNIGHT_DAY).daily.composed, stored.composed);
  // No arenas for a pawn, and a day with ice or moving terrain keeps its own king floor for now.
  const base = (date) => ({ ...getRawDaily(date), difficulty: 'fair', floorSeeds: composedSeeds(date) });
  assert.equal(composeMate({ ...base('2026-11-19'), modifier: 'none' }), null, 'a pawn\'s day');
  assert.equal(composeMate({ ...base(KNIGHT_DAY), modifier: 'ice' }), null, 'an Ice day');
});

for (const date of [KNIGHT_DAY, ROOK_DAY]) {
  test(`a mate floor opens with your king at your side and is won by the two of you, no sooner (${date})`, () => {
    // composeDay proves the day (proveComposed, every position a valid save) or throws.
    const { daily, floors, dropped } = compose(date);
    assert.deepEqual(dropped, []);
    const floor = floors[2], { room, line } = floor;
    assert.equal(floor.motif, MATE_MOTIF);
    assert.deepEqual(daily.generation.motifs.slice(0, 2), getDaily(date).generation.motifs.slice(0, 2), 'floors 1 and 2 are the day\'s own');
    assert.equal(daily.generation.motifs[2], MATE_MOTIF);
    assert.equal(escorted(daily), true);
    assert.equal(proveComposed(daily, daily.generation.certificate.actions, { saves: true, partner: daily.generation.partner ?? null }).valid, true);
    // The room: the king recruit joined, the enemy king and two guards, no chest and no hint.
    const recruit = room.items.filter((item) => item.type === 'companion');
    assert.deepEqual(recruit.map((item) => [item.piece, item.joined]), [['king', true]]);
    assert.ok(!room.items.some((item) => item.type === 'chest' || item.hint));
    assert.equal(room.enemies.length, 3);
    assert.equal(floor.treasure, null);
    // The line: MATE_TURNS turns, your piece moving on all but MATE_WAITS at most, no turn passed outright.
    assert.equal(line.length, MATE_TURNS);
    assert.ok(line.filter((action) => action.type === 'wait').length <= MATE_WAITS);
    assert.ok(line.every((action) => !(action.type === 'wait' && (action.recruit === undefined || action.recruit === 'hold'))));
    // As the floor opens your king stands on its square, with nothing to step onto, and takes orders at once.
    const start = kingFloor(daily);
    assert.deepEqual([start.companion.piece, start.companion.x, start.companion.y, start.companion.sharing], ['king', recruit[0].x, recruit[0].y, false]);
    assert.ok(!start.items.some((item) => item.type === 'companion'));
    assert.equal(validateSave(JSON.parse(JSON.stringify(start)), date, daily), true);
    assert.equal(validateSave({ ...JSON.parse(JSON.stringify(start)), companion: null }, date, daily), false, 'a king that began joined is never lost');
    const move = legalMoves(start)[0];
    const choice = recruitChoice(start, { type: 'move', x: move.x, y: move.y });
    assert.ok(choice === null || choice.moves.every((step) => Math.max(Math.abs(step.x - start.companion.x), Math.abs(step.y - start.companion.y)) === 1), 'the king steps one square');
    // The line wins, never captured, and nothing wins a turn sooner whatever the king is told.
    const bare = kingFloor(twinOf(daily));
    const states = playLine(bare, line, STEERED);
    assert.ok(states?.at(-1).exit.open && states.every((state) => state.hits === bare.hits));
    const wins = (state, turns) => partnerActions(state).some((action) => { const next = routeTransition(state, action, STEERED); return next && (next.exit.open || (turns > 1 && wins(next, turns - 1))); });
    assert.equal(wins(bare, MATE_TURNS - 1), false, 'no win in fewer turns');
    // The king can't do it by itself: with your piece standing still, nothing wins within par.
    const alone = (state, turns) => partnerActions(state).filter((action) => action.type === 'wait').some((action) => { const next = act(state, action); return next !== state && next.status === 'playing' && (next.exit.open || (turns > 1 && alone(next, turns - 1))); });
    assert.equal(alone(bare, MATE_TURNS + 1), false, 'the king alone does not win within par');
    assert.equal(mateGuard(bare, daily, 2, line).ok, true);
    // The enemy king never stands where the line needs to pass: it is taken or mated on the last turn.
    assert.ok(!states.at(-1).enemies.some((foe) => foe.role === 'king'));
    assert.ok(states.slice(0, -1).every((state) => state.enemies.some((foe) => foe.role === 'king' && !same(foe, state.player))));
  });
}

test('the dev preview composes a mate floor when asked, and can open on the king floor', () => {
  const { daily } = compose(KNIGHT_DAY);
  const asked = composedDayFor(`?composed=${KNIGHT_DAY}&mate=1`);
  assert.deepEqual(asked.composed, daily.composed);
  const opened = previewGame(`?composed=${KNIGHT_DAY}&mate=1&floor=3`, asked, createGame(asked));
  assert.equal(opened.floor, 2);
  assert.equal(opened.companion?.piece, 'king');
  assert.equal(validateSave(JSON.parse(JSON.stringify(opened)), KNIGHT_DAY, asked), true);
  assert.equal(previewGame(`?composed=${KNIGHT_DAY}&mate=1`, asked, createGame(asked)).floor, 0);
});
