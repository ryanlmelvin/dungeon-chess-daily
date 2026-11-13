// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITIONS, EDITIONS_RANGE } from '../src/editions.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';
import { encodeRooms, decodeRooms } from '../src/room-code.js';
import { encodeMotifs } from '../src/motif-code.js';
import { getDaily, generateDaily, borrowedDaily, composedSeeds, proveComposed } from '../src/generation.js';
import { floorPars } from '../src/par.js';
import { composeDay } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { DAILY_TIER } from '../src/difficulty.js';

test('routes survive the one-character-per-action encoding', () => {
  const actions = [{ type: 'move', x: 0, y: 0 }, { type: 'move', x: 7, y: 7 }, { type: 'wait' }, { type: 'move', x: 3, y: 5 }, { type: 'descend' }];
  assert.deepEqual(decodeRoute(encodeRoute(actions)), actions);
  assert.equal(encodeRoute(actions), 'A_.r!', 'a route without orders is coded as it always was');
});

test('a route keeps a partner floor\'s recruit orders: hold, or the square the recruit is sent to', () => {
  const actions = [
    { type: 'move', x: 4, y: 5, recruit: 'hold' }, { type: 'move', x: 3, y: 6, recruit: { x: 2, y: 4 } }, { type: 'wait', recruit: { x: 7, y: 0 } }, { type: 'wait', recruit: 'hold' },
    { type: 'move', x: 2, y: 5 }, { type: 'descend' }, { type: 'wait' }, { type: 'descend' },
  ];
  const code = encodeRoute(actions);
  assert.equal(code, 's~z>i.>H.~q!.!');
  const back = decodeRoute(code);
  assert.deepEqual(back, actions);
  assert.equal(JSON.stringify(back), JSON.stringify(actions), 'key order too: the order comes last');
  // An order needs a move or wait to carry it, once, and a square to go to.
  for (const bad of ['~', '>A', '!~', '!>A', 's~~', 's>', 's>!', 's>.', 's~>A']) assert.throws(() => decodeRoute(bad), SyntaxError, bad);
  assert.throws(() => encodeRoute([{ type: 'descend', recruit: 'hold' }]), RangeError);
  assert.throws(() => encodeRoute([{ type: 'wait', recruit: { x: 8, y: 0 } }]), RangeError);
  // Every stored route decodes and encodes back to the very same code, and its orders sit on its partner floor
  // or on the king floor, where your own king is with you (a mate floor's line and a pawn's net carry its orders).
  let ordered = 0;
  for (const [date, entry] of Object.entries(EDITIONS)) {
    const route = decodeRoute(entry.route);
    assert.equal(encodeRoute(route), entry.route, date);
    let floor = 0;
    for (const action of route) {
      if (action.recruit !== undefined) { assert.ok(floor === entry.partner || floor === 2, `${date}: an order on floor ${floor + 1}`); ordered++; }
      if (action.type === 'descend') floor++;
    }
    if (entry.partner !== undefined) assert.ok(/[~>]/.test(entry.route), `${date}: a partner floor's line carries orders`);
    assert.ok(entry.partner === undefined || entry.partner === 0 || entry.partner === 1, date);
  }
  assert.ok(ordered > 0, 'some stored day has a partner floor');
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
  // A chest is one more item, coded 'c' after its square; a room without one keeps the code it always had.
  const [first, ...rest] = encodeRooms(rooms).split('/');
  const rich = [{ ...rooms[0], items: [...rooms[0].items, { x: 6, y: 4, type: 'chest' }] }, rooms[1], rooms[2]];
  const richBack = decodeRooms(encodeRooms(rich));
  assert.deepEqual(richBack, rich);
  assert.equal(JSON.stringify(richBack), JSON.stringify(rich));
  assert.equal(encodeRooms(rich), [`${first}mc`, ...rest].join('/'), 'the chest on g4 adds its two characters to the room\'s items, and nothing else changes');
  // A room's cracked tiles follow '^', a character each; its gates follow '=', two each: the square and the beat it begins on.
  const terrain = [room({ cracks: [{ x: 4, y: 3 }, { x: 0, y: 1 }] }), room({ start: { x: 1, y: 6 }, gates: [{ x: 4, y: 3, phase: 0 }, { x: 5, y: 3, phase: 1 }] }), room({ gates: [] })];
  const terrainBack = decodeRooms(encodeRooms(terrain));
  assert.deepEqual(terrainBack, terrain);
  assert.equal(JSON.stringify(terrainBack), JSON.stringify(terrain));
  const [plainCode] = encodeRooms([room({}), room({}), room({})]).split('/');
  assert.deepEqual(encodeRooms(terrain).split('/'), [`${plainCode},^cI`, `${encodeRooms(rooms).split('/')[0]},=cAdB`, `${plainCode},=`]);
  assert.throws(() => encodeRooms([room({ ice: [], cracks: [] }), room({}), room({})]), 'one kind of thing laid a room');
  assert.throws(() => encodeRooms([room({ gates: [{ x: 4, y: 3, phase: 2 }] }), room({}), room({})]), 'a gate begins on beat 0 or 1');
  assert.throws(() => decodeRooms(`${plainCode},=cC/${plainCode}/${plainCode}`));
  assert.throws(() => decodeRooms(`${plainCode},=c/${plainCode}/${plainCode}`));
  // The code of 2026-11-01 as stored before chests: it decodes, holds none, and encodes back unchanged.
  const old = 'AAwDJ4AAAAAzZAwL1K,gOcoMoB5,FGHOXpx9/AAEIKArAUAA8XAiAIBwB-C,uOzo6oH0,JKdmstu2/NsgBAAHAQAA2BANCfB,v5,OTVXYad3';
  assert.equal(encodeRooms(decodeRooms(old)), old);
  assert.ok(decodeRooms(old).every((floor) => floor.items.every((item) => item.type !== 'chest')));
  // Every stored edition decodes and encodes back to the very same code, with at most one chest a room.
  let chests = 0;
  for (const [date, entry] of Object.entries(EDITIONS)) {
    const decoded = decodeRooms(entry.rooms);
    assert.equal(encodeRooms(decoded), entry.rooms, date);
    for (const floor of decoded) { const held = floor.items.filter((item) => item.type === 'chest').length; assert.ok(held <= 1, date); chests += held; }
  }
  assert.ok(chests > 0, 'stored rooms hold chests');
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
  // A few quick days (2026-11-15 has a partner floor); npm run audit:editions composes every one again.
  for (const date of ['2026-11-05', '2026-11-06', '2026-11-08', '2026-11-15']) {
    // With no options: the release configuration (chests, partner floors, tight forms) is what is stored.
    const { daily, dropped } = composeDay(date);
    const partner = daily.generation.partner;
    assert.deepEqual({ rooms: encodeRooms(daily.composed), route: encodeRoute(daily.generation.certificate.actions), motifs: encodeMotifs(daily.generation.motifs), ...(partner !== undefined && { partner }) }, EDITIONS[date], date);
    assert.deepEqual(dropped, [], `${date}: no option given up`);
    const stored = getDaily(date);
    assert.deepEqual(stored.composed, daily.composed);
    assert.deepEqual(stored.generation.certificate.actions, daily.generation.certificate.actions);
    assert.deepEqual(stored.generation.motifs, daily.generation.motifs);
    assert.equal(stored.generation.partner, partner);
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
  // Three dates, and the first after them that borrows a day with a partner floor.
  const dayAfter = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
  const tandem = Array.from({ length: 60 }, (_, n) => dayAfter('2031-03-01', n)).find((date) => getDaily(date).generation.partner !== undefined);
  assert.ok(tandem, 'some date past the window borrows a Tandem day');
  for (const date of ['2031-02-11', '2031-02-12', '2033-07-04', tandem]) {
    const raw = getRawDaily(date);
    const daily = getDaily(date);
    const template = daily.generation.borrowed;
    assert.ok(EDITIONS[template], `${date} borrows a stored day`);
    // Its partner floor comes along, so its line's recruit orders prove here too.
    assert.equal(daily.generation.partner, EDITIONS[template].partner, `${date}: the stored day's partner floor`);
    assert.equal(proveComposed(daily, daily.generation.certificate.actions, { saves: true, partner: daily.generation.partner ?? null }).valid, true, date);
    assert.deepEqual(floorPars(daily), floorPars(getDaily(template)), `${date}: the stored day's pars`);
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
