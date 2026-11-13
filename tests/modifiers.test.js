// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, legalMoves, validateSave } from '../src/rules.js';
import { getDaily, proveComposed } from '../src/generation.js';
import { MODIFIERS, TERRAIN_MODIFIERS, ICE_TILES, modifierFor, iceSlide, modifierStatus } from '../src/modifiers.js';
import { room as composedRoom, withRooms } from './fixtures/rooms.js';

const day = (offset, start = '2026-11-06') => new Date(Date.parse(start) + offset * 86_400_000).toISOString().slice(0, 10);
// The first date (from the modifier launch) that draws each modifier.
const firstDate = (modifier, piece) => {
  for (let offset = 0; offset < 400; offset++) {
    const date = day(offset, '2026-11-07');
    const raw = getRawDaily(date);
    if (raw.modifier === modifier && (!piece || raw.playerPiece === piece)) return date;
  }
  throw new Error(`No ${modifier} day found.`);
};

// An open, empty room for one rule at a time.
function room(modifier, piece = 'rook', x = 4, y = 6) {
  const state = createGame(withRooms({ ...getRawDaily(firstDate('none')), modifier }));
  state.startingPiece = piece;
  Object.assign(state.player, { piece, x, y, moved: false });
  state.map = Array(8).fill('........');
  state.enemies = []; state.items = []; state.props = []; state.companion = null;
  state.ice = [];
  return state;
}
const foe = (id, piece, x, y) => ({ id, species: 'bat', palette: 'ice', name: 'Ice bat', piece, role: piece, x, y, moved: true, phase: 'ready', intent: [], target: null });
const wall = (state, x, y) => { state.map[y] = state.map[y].slice(0, x) + '#' + state.map[y].slice(x + 1); };
const strip = (state) => {
  const { modifier, floorSnapshot, ...rest } = state;
  return floorSnapshot ? { ...rest, floorSnapshot: strip(floorSnapshot) } : rest;
};

test('the modifier is a pure function of the date, about one plain day in two', () => {
  const counts = { none: 0, ice: 0, cracks: 0, gates: 0 };
  for (let offset = 0; offset < 365; offset++) {
    const date = day(offset, '2026-11-07');
    const raw = getRawDaily(date), modifier = raw.modifier;
    assert.equal(modifierFor(date, raw.playerPiece), modifier);
    // A day's terrain goes by its piece: gates on a bishop's day, never a crumbling floor.
    if (TERRAIN_MODIFIERS.includes(modifier)) assert.ok(TERRAIN_MODIFIERS.includes(modifierFor(date, 'rook')) && modifierFor(date, 'bishop') === 'gates');
    else for (const piece of ['bishop', 'rook', 'pawn']) assert.equal(modifierFor(date, piece), modifier);
    assert.ok(!(raw.playerPiece === 'bishop' && modifier === 'cracks'));
    counts[modifier]++;
  }
  // Ice on about a quarter of the days, moving terrain (Breach's old days) on another quarter, both kinds drawn.
  for (const [id, drawn] of [['ice', counts.ice], ['terrain', counts.cracks + counts.gates]]) assert.ok(drawn > 60 && drawn < 125, `${id}: ${drawn}`);
  assert.ok(counts.cracks > 20 && counts.gates > counts.cracks, `cracks ${counts.cracks}, gates ${counts.gates}`);
  assert.ok(counts.none > 145 && counts.none < 220, `none: ${counts.none}`);
  // The draw has its own stream: the rest of the edition is what it was.
  const raw = getRawDaily('2026-12-01');
  assert.equal(raw.seed, getRawDaily('2026-12-01').seed);
  // Plain days carry no modifier field at all.
  assert.equal('modifier' in createGame(withRooms(firstDate('none'))), false);
  assert.equal(createGame(withRooms(firstDate('ice'))).modifier, 'ice');
});

test('ice tiles avoid walls, monsters, pickups, the start and the exit, and are fixed per floor', () => {
  // A room that lays no ice of its own gets the day's seeded draw.
  const daily = withRooms(firstDate('ice'), composedRoom({
    walls: [[0, 2], [3, 3], [5, 3], [2, 5], [6, 5], [1, 7], [7, 1]],
    enemies: [{ x: 4, y: 2, cast: 0 }, { x: 0, y: 0, cast: 1 }, { x: 7, y: 0, cast: 2 }],
    items: [{ x: 2, y: 4, type: 'coin' }, { x: 6, y: 4, type: 'coin' }, { x: 3, y: 5, type: 'powerup', power: 'shield' }],
  }));
  const state = createGame(daily);
  assert.equal(state.ice.length, ICE_TILES);
  for (const tile of state.ice) {
    assert.notEqual(state.map[tile.y][tile.x], '#');
    assert.ok(!state.enemies.some((entry) => entry.x === tile.x && entry.y === tile.y));
    assert.ok(!state.items.some((entry) => entry.x === tile.x && entry.y === tile.y));
    assert.ok(!(tile.x === 4 && tile.y === 6) && !(tile.x === 4 && tile.y === 0));
  }
  assert.deepEqual(createGame(daily).ice, state.ice);
  // Ice draws on its own stream: the room is otherwise the plain room.
  const plain = createGame({ ...daily, modifier: 'none' });
  assert.deepEqual(plain.map, state.map);
  assert.deepEqual(plain.enemies, state.enemies);
  assert.deepEqual(plain.items, state.items);
  assert.equal(plain.ice, undefined);
});

test('a slider ending on ice skids one more square, shown in the move preview', () => {
  const state = room('ice', 'rook');
  state.ice = [{ x: 4, y: 3 }];
  const move = legalMoves(state).find((tile) => tile.x === 4 && tile.y === 3);
  assert.deepEqual(move.slide, { x: 4, y: 2 });
  // Moves that do not end on ice carry no slide.
  assert.equal(legalMoves(state).find((tile) => tile.x === 4 && tile.y === 4).slide, undefined);
  const next = act(state, { type: 'move', x: 4, y: 3 });
  assert.deepEqual([next.player.x, next.player.y], [4, 2]);
  assert.ok(next.events.some((event) => event.type === 'slide' && event.from.x === 4 && event.from.y === 3));
  // Only one extra square, even onto more ice.
  state.ice = [{ x: 4, y: 3 }, { x: 4, y: 2 }];
  assert.deepEqual(iceSlide(state, { x: 4, y: 3 }), { x: 4, y: 2 });
  assert.deepEqual([act(state, { type: 'move', x: 4, y: 3 }).player.y], [2]);
  // Bishops and queens slide along their diagonal.
  const bishop = room('ice', 'bishop');
  bishop.ice = [{ x: 2, y: 4 }];
  assert.deepEqual(iceSlide(bishop, { x: 2, y: 4 }), { x: 1, y: 3 });
  const queen = room('ice', 'queen');
  queen.ice = [{ x: 6, y: 4 }];
  assert.deepEqual(act(queen, { type: 'move', x: 6, y: 4 }).player, { ...queen.player, x: 7, y: 3, moved: true });
});

test('ice never slides into walls, monsters or off the board, and captures, knights and kings stop', () => {
  const state = room('ice', 'rook');
  state.ice = [{ x: 4, y: 3 }, { x: 4, y: 0 }];
  wall(state, 4, 2);
  assert.equal(iceSlide(state, { x: 4, y: 3 }), null);
  state.map = Array(8).fill('........');
  state.enemies = [foe('m', 'knight', 4, 2)];
  assert.equal(iceSlide(state, { x: 4, y: 3 }), null);
  const next = act(state, { type: 'move', x: 4, y: 3 });
  assert.equal(next.enemies.some((entry) => entry.id === 'm'), true, 'sliding never captures');
  // The board's edge stops a slide.
  state.enemies = [];
  assert.equal(iceSlide(state, { x: 4, y: 0 }), null);
  // A capture ending on ice stops on the captured square.
  state.enemies = [foe('m', 'knight', 4, 3)];
  assert.equal(iceSlide(state, { x: 4, y: 3 }), null);
  assert.equal(legalMoves(state).find((tile) => tile.x === 4 && tile.y === 3).slide, undefined);
  for (const piece of ['knight', 'king']) {
    const walker = room('ice', piece);
    walker.ice = [{ x: 3, y: 4 }, { x: 4, y: 5 }];
    assert.equal(legalMoves(walker).some((tile) => tile.slide), false, piece);
  }
});

test('a pawn moving straight slides on ice and may promote, but a diagonal capture stops', () => {
  const state = room('ice', 'pawn', 4, 2);
  state.player.moved = true;
  state.ice = [{ x: 4, y: 1 }, { x: 3, y: 1 }];
  state.enemies = [foe('m', 'knight', 3, 1)];
  const next = act(state, { type: 'move', x: 4, y: 1 });
  assert.deepEqual([next.player.x, next.player.y, next.player.piece], [4, 0, 'queen']);
  const capture = act(state, { type: 'move', x: 3, y: 1 });
  assert.deepEqual([capture.player.x, capture.player.y], [3, 1]);
  // A double step that ends on ice skids a third square.
  const opening = room('ice', 'pawn');
  opening.ice = [{ x: 4, y: 4 }];
  assert.deepEqual(legalMoves(opening).find((tile) => tile.y === 4).slide, { x: 4, y: 3 });
});

test('monsters are sure-footed: ice never changes how they move', () => {
  const date = firstDate('ice', 'knight');
  const daily = getDaily(date);
  let iced = createGame(daily);
  let plain = createGame({ ...daily, modifier: 'none' });
  for (let turn = 0; turn < 8 && iced.status === 'playing'; turn++) {
    iced = act(iced, { type: 'wait' });
    plain = act(plain, { type: 'wait' });
    assert.deepEqual(iced.enemies, plain.enemies, `turn ${turn}`);
  }
});

test('saves must match the day’s modifier and its ice', () => {
  const date = firstDate('ice');
  const daily = getDaily(date);
  const state = createGame(daily);
  assert.equal(validateSave(state, date, daily), true);
  assert.equal(validateSave(strip(state), date, daily), false);
  assert.equal(validateSave({ ...state, modifier: 'dark' }, date, daily), false);
  assert.equal(validateSave({ ...state, ice: state.ice.slice(1) }, date, daily), false);
  const plainDate = firstDate('none');
  const plain = createGame(getDaily(plainDate));
  assert.equal(validateSave(plain, plainDate, getDaily(plainDate)), true);
  assert.equal(validateSave({ ...plain, modifier: 'ice' }, plainDate, getDaily(plainDate)), false);
});

test('dark and Breach are retired: no day draws them, and their saves no longer load', () => {
  assert.deepEqual(Object.keys(MODIFIERS), ['none', 'ice', 'cracks', 'gates']);
  for (let offset = 0; offset < 365; offset++) assert.ok(Object.hasOwn(MODIFIERS, getRawDaily(day(offset)).modifier));
  const date = firstDate('none');
  const daily = getDaily(date);
  for (const modifier of ['dark', 'collapse']) assert.equal(validateSave({ ...createGame(daily), modifier }, date, daily), false);
  assert.equal(modifierStatus({ modifier: 'collapse' }), '');
});

test('every modifier certifies: its stored editions prove under it', () => {
  for (const modifier of Object.keys(MODIFIERS)) {
    const date = firstDate(modifier);
    const daily = getDaily(date);
    assert.equal(daily.modifier, modifier);
    const initial = createGame(daily);
    assert.equal(initial.modifier, modifier === 'none' ? undefined : modifier);
    const proof = proveComposed(daily, daily.generation.certificate.actions, { saves: true, partner: daily.generation.partner ?? null });
    assert.equal(proof.valid, true, `${modifier}: ${proof.reason}`);
    // An Ice day's rooms lay their own ice around the line, and a terrain day's their own tiles or gates.
    if (modifier === 'ice') assert.ok(daily.composed.every((room) => room.ice?.length === ICE_TILES), 'every Ice room lays its own tiles');
    if (TERRAIN_MODIFIERS.includes(modifier)) assert.ok(daily.composed.every((room) => Array.isArray(room[modifier])) && daily.composed.some((room) => room[modifier].length), `${modifier}: the rooms lay their own`);
  }
});
