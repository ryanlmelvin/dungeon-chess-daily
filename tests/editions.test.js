// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITIONS, EDITIONS_RANGE } from '../src/editions.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';
import { encodeRooms, decodeRooms } from '../src/room-code.js';
import { encodeMotifs } from '../src/motif-code.js';
import { getDaily, generateDaily, borrowedDaily, composedSeeds } from '../src/generation.js';
import { composeDay } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { DAILY_TIER } from '../src/difficulty.js';

test('routes survive the one-character-per-action encoding', () => {
  const actions = [{ type: 'move', x: 0, y: 0 }, { type: 'move', x: 7, y: 7 }, { type: 'wait' }, { type: 'move', x: 3, y: 5 }, { type: 'descend' }];
  assert.deepEqual(decodeRoute(encodeRoute(actions)), actions);
});

test('rooms survive the room code exactly, key order included', () => {
  const room = (extra) => ({
    map: ['#.......', '........', '..##....', '........', '........', '.......#', '........', '#......#'],
    enemies: [{ x: 1, y: 1, cast: 0 }, { x: 6, y: 2, cast: 2, held: 4 }, { x: 3, y: 4, cast: 1 }],
    items: [{ x: 2, y: 5, type: 'coin' }, { x: 5, y: 5, type: 'coin', hint: true }, { x: 0, y: 3, type: 'powerup', power: 'magnet', hint: true }, { x: 7, y: 6, type: 'companion', piece: 'king' }],
    ...extra,
  });
  const rooms = [room({ start: { x: 1, y: 6 } }), room({}), room({ start: { x: 4, y: 7 }, ice: [{ x: 4, y: 3 }, { x: 0, y: 0 + 1 }] })];
  const back = decodeRooms(encodeRooms(rooms));
  assert.deepEqual(back, rooms);
  assert.equal(JSON.stringify(back), JSON.stringify(rooms));
  assert.throws(() => decodeRooms('nonsense'));
  assert.throws(() => encodeRooms([room({ enemies: [{ x: 1, y: 1, species: {} }] }), room({}), room({})]));
  // Every stored edition decodes and encodes back to the very same code.
  for (const [date, entry] of Object.entries(EDITIONS)) assert.equal(encodeRooms(decodeRooms(entry.rooms)), entry.rooms, date);
});

test('the stored table covers every date in its range', () => {
  assert.ok(EDITIONS_RANGE, 'src/editions.js must be generated');
  let count = 0;
  for (let time = Date.parse(EDITIONS_RANGE.start); time <= Date.parse(EDITIONS_RANGE.end); time += 86_400_000) {
    assert.ok(EDITIONS[new Date(time).toISOString().slice(0, 10)]);
    count++;
  }
  assert.equal(Object.keys(EDITIONS).length, count);
  assert.equal(EDITIONS_RANGE.start, '2026-11-01', 'the whole archive, from edition 1');
});

test('a stored edition is exactly the day the composer composes', () => {
  // A few quick days; npm run audit:editions composes every one again.
  for (const date of ['2026-11-05', '2026-11-06', '2026-11-08']) {
    const { daily } = composeDay(date);
    assert.deepEqual({ rooms: encodeRooms(daily.composed), route: encodeRoute(daily.generation.certificate.actions), motifs: encodeMotifs(daily.generation.motifs) }, EDITIONS[date], date);
    const stored = getDaily(date);
    assert.deepEqual(stored.composed, daily.composed);
    assert.deepEqual(stored.generation.certificate.actions, daily.generation.certificate.actions);
    assert.deepEqual(stored.generation.motifs, daily.generation.motifs);
    assert.deepEqual(stored.floorSeeds, composedSeeds(date));
    assert.equal(stored.difficulty, DAILY_TIER);
    assert.equal(stored.generation.source, 'composed');
  }
});

test('stored editions prove as they load, and their lines keep every save valid', () => {
  const dates = Object.keys(EDITIONS);
  for (let n = 0; n < dates.length; n += 25) {
    const date = dates[n];
    const daily = generateDaily(date);
    assert.equal(daily.generation.borrowed, undefined, date);
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) {
      state = act(state, action);
      assert.equal(validateSave(state, date, daily), true, `${date} after ${JSON.stringify(action)}`);
    }
    assert.equal(state.status, 'won', date);
    assert.equal(state.hits, 0, `${date}: a planted line is never captured`);
  }
});

test('a date past the window borrows a stored day of its own piece and modifier, under its own cast', () => {
  for (const date of ['2031-02-11', '2031-02-12', '2033-07-04']) {
    const raw = getRawDaily(date);
    const daily = getDaily(date);
    const template = daily.generation.borrowed;
    assert.ok(EDITIONS[template], `${date} borrows a stored day`);
    const source = getRawDaily(template);
    assert.equal(source.playerPiece, raw.playerPiece);
    assert.equal(source.modifier, raw.modifier);
    // The stored day's rooms, line, seeds and roles; the date's own names, colors and shops.
    assert.deepEqual(daily.composed, decodeRooms(EDITIONS[template].rooms));
    assert.deepEqual(daily.generation.certificate.actions, decodeRoute(EDITIONS[template].route));
    assert.deepEqual(daily.floorSeeds, composedSeeds(template));
    assert.deepEqual(daily.targets, source.targets);
    assert.deepEqual(daily.species.map((creature) => creature.piece), source.species.map((creature) => creature.piece));
    assert.deepEqual(daily.species.map((creature) => creature.name), raw.species.map((creature) => creature.name));
    assert.deepEqual(daily.shops, raw.shops);
    assert.equal(daily.edition, raw.edition);
    // It plays exactly as stored: the line wins with every save valid.
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) {
      state = act(state, action);
      assert.equal(validateSave(state, date, daily), true, `${date} after ${JSON.stringify(action)}`);
    }
    assert.equal(state.status, 'won');
    // The same date always borrows the same day.
    assert.deepEqual(borrowedDaily(raw), generateDaily(date));
  }
});
