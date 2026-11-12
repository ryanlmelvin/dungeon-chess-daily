// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Press-and-hold inspection (src/inspect.js): one unmasked monster's squares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, closeAttacker, closeRangeSquares, createGame } from '../src/rules.js';
import { getDaily, createGame as createDailyGame } from '../src/game.js';
import { inspectMonster, inspectAt, isUnmasked, createInspector, HOLD_LINGER_MS } from '../src/inspect.js';
import { openMap, withRooms } from './fixtures/rooms.js';

const move = (x, y) => ({ type: 'move', x, y });
const keys = (squares) => squares.map(({ x, y }) => `${x},${y}`).sort();
const at = (...pairs) => pairs.map(([x, y]) => `${x},${y}`).sort();

// An open, empty room around the player's rook; 'bat' is unmasked, 'slime' is not.
function scenario({ x = 7, y = 7, walls = [] } = {}) {
  const state = createGame(withRooms('2026-11-05'));
  Object.assign(state.player, { piece: 'rook', x, y });
  state.map = openMap(walls); state.props = []; state.items = []; state.enemies = []; state.companion = null;
  state.objective = { piece: 'king', complete: false };
  state.powers = { ...state.powers, shield: 0, freeze: 0 };
  state.unmasked = ['bat'];
  return state;
}
function monster(id, piece, x, y, species = 'bat') {
  return { id, piece, role: piece, species, palette: 'ice', name: `Ice ${species}`, x, y, moved: false, phase: 'ready', target: null, intent: [] };
}

test('a masked monster yields nothing, whatever it is', () => {
  for (const piece of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
    const state = scenario();
    state.enemies = [monster('masked', piece, 3, 3, 'slime'), monster('known', piece, 5, 1)];
    assert.equal(isUnmasked(state, state.enemies[0]), false);
    assert.equal(inspectMonster(state, 'masked'), null);
    assert.equal(inspectAt(state, { x: 3, y: 3 }), null);
    // Wound up, its path is still the board's to draw, not the inspection's.
    Object.assign(state.enemies[0], { phase: 'aim', target: { x: 3, y: 4 }, intent: [{ x: 3, y: 4 }] });
    assert.equal(inspectMonster(state, 'masked'), null);
    assert.equal(inspectMonster(state, 'known').piece, piece);
  }
  const state = scenario();
  state.enemies = [monster('known', 'rook', 3, 3)];
  delete state.unmasked;
  assert.equal(inspectMonster(state, 'known'), null, 'nothing is unmasked on a fresh floor');
  assert.equal(inspectMonster(state, 'nobody'), null);
  assert.equal(inspectAt(state, { x: 0, y: 0 }), null);
});

test('an unmasked rook\'s squares stop at walls and pieces', () => {
  const state = scenario({ x: 0, y: 3, walls: [[3, 1]] });
  state.enemies = [monster('rook', 'rook', 3, 3), monster('other', 'bishop', 6, 3, 'slime')];
  state.companion = { piece: 'knight', basePiece: 'knight', x: 3, y: 7, moved: true, sharing: false };
  const marks = inspectMonster(state, 'rook');
  assert.deepEqual({ id: marks.id, x: marks.x, y: marks.y, piece: marks.piece }, { id: 'rook', x: 3, y: 3, piece: 'rook' });
  // Beside it, where a rook attacks: captured at once.
  assert.deepEqual(keys(marks.atOnce), at([3, 2], [2, 3], [4, 3], [3, 4]));
  // Farther along its lines: up stops under the wall, right before the other
  // monster, down before the recruit, left before the player.
  assert.deepEqual(keys(marks.moves), at([5, 3], [3, 5], [3, 6], [1, 3]));
  // It can capture the player where they stand, and whoever takes the monster it guards.
  assert.deepEqual(keys(marks.captures), at([0, 3], [6, 3]));
  assert.deepEqual(marks.coming, []);
  const all = [...marks.atOnce, ...marks.moves, ...marks.captures];
  for (const beyond of at([3, 1], [3, 0], [7, 3], [3, 7])) assert.ok(!keys(all).includes(beyond), beyond);
  assert.equal(new Set(keys(all)).size, all.length, 'each square is said once');
});

test('a knight jumps walls, a pawn steps ahead and strikes diagonally', () => {
  const state = scenario({ walls: [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]] });
  state.enemies = [monster('knight', 'knight', 3, 3)];
  const knight = inspectMonster(state, 'knight');
  assert.deepEqual(keys(knight.atOnce), at([1, 2], [2, 1], [4, 1], [5, 2], [5, 4], [4, 5], [2, 5], [1, 4]));
  assert.deepEqual([knight.moves, knight.captures], [[], []]);

  const room = scenario();
  room.enemies = [monster('pawn', 'pawn', 3, 1), monster('held', 'pawn', 6, 1)];
  room.enemies[1].pinned = 2;
  const pawn = inspectMonster(room, 'pawn');
  assert.deepEqual(keys(pawn.atOnce), at([2, 2], [4, 2]));
  assert.deepEqual(keys(pawn.moves), at([3, 2], [3, 3]));
  assert.deepEqual(pawn.captures, []);
  // Pinned, it captures no one at once: its diagonals are only where it would.
  const held = inspectMonster(room, 'held');
  assert.deepEqual(held.atOnce, []);
  assert.deepEqual(keys(held.captures), at([5, 2], [7, 2]));
  assert.deepEqual(keys(held.moves), at([6, 2], [6, 3]));
});

test('the at-once squares are the engine\'s close-range rule, for that monster alone', () => {
  for (const piece of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
    const state = scenario({ x: 0, y: 7 });
    state.enemies = [monster('one', piece, 3, 3), monster('two', piece, 5, 4, 'slime')];
    const marks = inspectMonster(state, 'one');
    const alone = { ...state, enemies: [state.enemies[0]] };
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const expected = !(x === 3 && y === 3) && !(x === 0 && y === 7) && Boolean(closeAttacker(alone, { x, y }));
      assert.equal(keys(marks.atOnce).includes(`${x},${y}`), expected, `${piece} ${x},${y}`);
    }
    // The masked monster's own close range is the paid danger map's to show.
    assert.ok(closeRangeSquares(state).length > marks.atOnce.length || piece === 'pawn');
  }
  // Ending a move on one is captured at once by that monster; a square farther along its line only winds it up.
  const state = scenario({ x: 7, y: 4 });
  state.enemies = [monster('rook', 'rook', 3, 3)];
  const marks = inspectMonster(state, 'rook');
  assert.ok(keys(marks.atOnce).includes('3,4') && keys(marks.moves).includes('3,7'));
  const struck = act(state, move(3, 4));
  assert.equal(struck.events.find((event) => event.type === 'close-capture')?.id, 'rook');
  const warned = act({ ...state, player: { ...state.player, x: 7, y: 7 } }, move(3, 7));
  assert.equal(warned.events.some((event) => event.type === 'close-capture'), false);
  assert.equal(warned.hits, state.hits);
  assert.equal(warned.enemies[0].phase, 'aim');
});

test('with every species unmasked, the at-once squares add up to the danger map', () => {
  for (const date of ['2026-11-05', '2026-11-08', '2026-11-13', '2026-11-20']) {
    let state = createDailyGame(getDaily(date));
    for (let turn = 0; turn < 8 && state.status === 'playing'; turn++) {
      state = { ...state, unmasked: [...new Set(state.enemies.map((foe) => foe.species))] };
      const union = new Set(state.enemies.flatMap((foe) => keys(inspectMonster(state, foe.id).atOnce)));
      assert.deepEqual([...union].sort(), keys(closeRangeSquares(state)), `${date} turn ${turn}`);
      state = act(state, { type: 'wait', recruit: 'hold' });
    }
  }
});

test('a wound-up monster reports its path apart from its squares', () => {
  // The player waits in a far rook's line: it steps closer and winds up.
  const before = scenario({ x: 3, y: 7 });
  before.enemies = [monster('rook', 'rook', 3, 1)];
  assert.deepEqual(inspectMonster(before, 'rook').coming, []);
  assert.deepEqual(keys(inspectMonster(before, 'rook').captures), at([3, 7]));
  const state = act(before, { type: 'wait' });
  const foe = state.enemies[0];
  assert.equal(foe.phase, 'aim');
  const marks = inspectMonster(state, 'rook');
  assert.deepEqual(marks.coming, foe.intent);
  assert.ok(keys(marks.coming).includes('3,7'), 'the path reaches the player');
  // Its first square is also beside the rook: both are true there.
  assert.ok(keys(marks.atOnce).includes(`3,${foe.y + 1}`) && keys(marks.coming).includes(`3,${foe.y + 1}`));
  // The path says more than "it can move here", so those squares aren't repeated.
  for (const tile of marks.coming) assert.ok(!keys([...marks.moves, ...marks.captures]).includes(`${tile.x},${tile.y}`));
  assert.ok(marks.moves.length > 0);
});

test('a pinned, frozen or off-balance monster captures no one at once', () => {
  const base = scenario();
  base.enemies = [monster('queen', 'queen', 3, 3)];
  assert.equal(inspectMonster(base, 'queen').atOnce.length, 8);
  const cases = {
    pinned: (state) => { state.enemies[0].pinned = 2; },
    frozen: (state) => { state.powers.freeze = 2; },
    'off-balance': (state) => { state.enemies[0].offBalance = true; },
  };
  for (const [name, apply] of Object.entries(cases)) {
    const state = structuredClone(base);
    apply(state);
    const marks = inspectMonster(state, 'queen');
    assert.deepEqual(marks.atOnce, [], name);
    assert.ok(keys(marks.moves).includes('3,4') && keys(marks.moves).includes('4,4'), name);
  }
});

test('a monster it guards: at once beside it, a capture from afar', () => {
  const state = scenario();
  state.enemies = [monster('rook', 'rook', 3, 3), monster('near', 'pawn', 3, 4, 'slime'), monster('far', 'pawn', 6, 3, 'slime'), monster('off', 'pawn', 5, 5, 'slime')];
  const marks = inspectMonster(state, 'rook');
  assert.ok(keys(marks.atOnce).includes('3,4'));
  assert.deepEqual(keys(marks.captures), at([6, 3]));
  assert.ok(!keys([...marks.atOnce, ...marks.moves, ...marks.captures]).includes('5,5'));
  // The engine agrees: taking the near one is answered at once.
  const taken = act({ ...state, player: { ...state.player, x: 3, y: 7 } }, move(3, 4));
  assert.equal(taken.events.find((event) => event.type === 'close-capture')?.id, 'rook');
});

test('inspecting changes nothing', () => {
  const state = act(createDailyGame(getDaily('2026-11-13')), { type: 'wait', recruit: 'hold' });
  state.unmasked = [...new Set(state.enemies.map((foe) => foe.species))];
  const before = JSON.stringify(state);
  for (const foe of state.enemies) assert.ok(inspectMonster(state, foe.id));
  assert.equal(JSON.stringify(state), before);
});

// The gesture's bookkeeping, with a stand-in board.
function harness(t, state) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = [];
  let onBoard = null;
  let live = state;
  const inspector = createInspector({
    board: () => live,
    show: (marks) => { onBoard = marks; log.push(marks ? marks.id : null); },
    shown: () => onBoard,
    onShow: (marks) => log.push(`shown ${marks.id}`),
  });
  return { inspector, log, shown: () => onBoard, repaint: () => { onBoard = null; }, away: () => { live = null; } };
}
function crowd() {
  const state = scenario();
  state.enemies = [monster('known', 'rook', 3, 3), monster('masked', 'rook', 5, 5, 'slime')];
  return state;
}

test('a hold on a monster is never a tap; only an unmasked one shows anything', (t) => {
  const { inspector, log, shown } = harness(t, crowd());
  assert.equal(inspector.hold({ x: 5, y: 5 }), true, 'a masked monster takes the hold');
  assert.deepEqual(log, [], 'and shows nothing');
  assert.equal(inspector.hold({ x: 0, y: 0 }), false, 'an empty square stays a tap');
  assert.equal(inspector.hold({ x: 7, y: 7 }), false, 'so does the player\'s own');
  assert.equal(inspector.hold(undefined), false);
  assert.equal(inspector.hold({ x: 3, y: 3 }), true);
  assert.deepEqual(log, ['known', 'shown known']);
  assert.equal(shown().id, 'known');
  // A hold on a masked monster lifts another's marks and still shows nothing.
  assert.equal(inspector.hold({ x: 5, y: 5 }), true);
  assert.equal(shown(), null);
});

test('a finger\'s marks linger, a mouse\'s lift at once, and a new paint ends either', (t) => {
  const { inspector, shown, repaint } = harness(t, crowd());
  inspector.hold({ x: 3, y: 3 });
  inspector.release('touch');
  t.mock.timers.tick(HOLD_LINGER_MS - 1);
  assert.equal(shown().id, 'known');
  t.mock.timers.tick(1);
  assert.equal(shown(), null);
  inspector.hold({ x: 3, y: 3 });
  inspector.release('mouse');
  assert.equal(shown(), null);
  // The board painted something new while the marks lingered: the timer has nothing left to lift.
  inspector.hold({ x: 3, y: 3 });
  inspector.release('touch');
  repaint();
  inspector.hold({ x: 3, y: 3 });
  const second = shown();
  t.mock.timers.tick(HOLD_LINGER_MS);
  assert.equal(shown(), second, 'a newer hold is not cut short by the older timer');
});

test('nothing answers while the board can\'t be inspected', (t) => {
  const { inspector, log, away } = harness(t, crowd());
  away();
  assert.equal(inspector.hold({ x: 3, y: 3 }), false, 'the press stays a tap, as during a pin or the bot\'s replay');
  assert.equal(inspector.hover({ x: 3, y: 3 }), false);
  assert.equal(inspector.key({ x: 3, y: 3 }), false);
  assert.deepEqual(log, []);
});

test('a resting mouse and the keyboard show the same marks', (t) => {
  const { inspector, shown } = harness(t, crowd());
  assert.equal(inspector.hover({ x: 5, y: 5 }), false, 'a masked monster');
  assert.equal(shown(), null);
  assert.equal(inspector.hover({ x: 3, y: 3 }), true);
  assert.equal(shown().id, 'known');
  inspector.hover(null);
  assert.equal(shown(), null);
  assert.equal(inspector.key(null), false);
  assert.equal(inspector.key({ x: 5, y: 5 }), false);
  assert.equal(inspector.key({ x: 3, y: 3 }), true);
  assert.equal(shown().id, 'known');
  // A mouse leaving some other square doesn't lift the keyboard's marks; the key does.
  inspector.hover(null);
  assert.equal(shown().id, 'known');
  assert.equal(inspector.key({ x: 3, y: 3 }), false);
  assert.equal(shown(), null);
});
