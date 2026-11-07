// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, legalMoves, PIECE_LIVES, validateSave, walkable } from '../src/game.js';

const move = (x, y) => ({ type: 'move', x, y });
const dates = { pawn: '2026-11-05', bishop: '2026-11-07', knight: '2026-11-08', queen: '2026-11-10', rook: '2026-11-13' };
function scenario(piece = 'rook', x = 4, y = 6) {
  const state = createGame(getDaily(dates[piece]));
  Object.assign(state.player, { x, y });
  state.map = Array(8).fill('........'); state.props = []; state.enemies = []; state.items = [];
  return state;
}
function rook(id, x, y, target) {
  const horizontal = y === target.y;
  return { id, piece: 'rook', role: 'rook', species: 'bat', name: 'Bat', x, y, moved: false,
    phase: 'aim', target, intent: Array.from({ length: 8 }, (_, i) => horizontal ? { x: i, y } : { x, y: i }).filter((tile) => tile.x !== x || tile.y !== y) };
}
function promotedThirdRoom(beforeLastStairs) {
  const daily = getDaily('2026-11-19');
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) {
    if (beforeLastStairs && action.type === 'descend' && state.floor === 1) state = beforeLastStairs(state);
    state = act(state, action);
    assert.equal(validateSave(state, state.date), true);
    if (state.floor === 2) break;
  }
  // Promotion never carries downstairs; stand in for a promotion made inside this room.
  assert.equal(state.floor, 2); assert.equal(state.player.piece, 'pawn');
  state.player.piece = 'queen';
  return state;
}

test('each starting piece gets its chess-set life budget and saves each remaining count', () => {
  const budgets = { pawn: 8, rook: 2, knight: 2, bishop: 2, queen: 1, king: 1 };
  assert.deepEqual(PIECE_LIVES, budgets);
  for (const [piece, lives] of Object.entries(budgets)) {
    // The king is never the daily piece, only a practice choice.
    const practice = piece === 'king';
    const state = practice ? createPracticeGame(getDaily(dates.rook), { piece, color: 'white' }) : createGame(getDaily(dates[piece]));
    const check = (value) => validateSave(value, value.date, { practice });
    assert.equal(state.startingPiece, piece);
    assert.equal(state.player.hp, lives); assert.equal(state.player.maxHp, lives);
    for (let hp = 1; hp <= lives; hp++) {
      state.player.hp = hp;
      assert.equal(check(JSON.parse(JSON.stringify(state))), true, `${piece}: ${hp}`);
    }
    for (const hp of [0, -1, 0.5, lives + 1]) {
      state.player.hp = hp;
      assert.equal(check(state), false, `${piece}: reject ${hp}`);
    }
    state.player.hp = 1; state.player.maxHp = lives + 1;
    assert.equal(check(state), false);
  }
});

test('a pawn promoted and hit on the same turn returns to the entrance with one fewer pawn life', () => {
  const state = scenario('pawn', 4, 1);
  state.enemies = [rook('attacker', 0, 0, { x: 4, y: 0 })];
  const next = act(state, move(4, 0));
  assert.equal(next.player.piece, 'pawn'); assert.equal(next.player.hp, 7); assert.equal(next.player.maxHp, 8);
  assert.deepEqual([next.player.x, next.player.y], [4, 6]);
  assert.equal(next.player.moved, false); assert.equal(next.status, 'playing');
  assert.ok(legalMoves(next).length > 0); assert.match(next.message, /Back to a pawn/);
});

test('a demoted pawn skips an occupied entrance and blocked replacement squares', () => {
  const state = scenario('pawn', 4, 1); state.player.piece = 'queen';
  state.enemies = [rook('attacker', 0, 0, { x: 4, y: 0 }), { ...rook('blocker', 4, 6, { x: 4, y: 0 }), phase: 'ready', intent: [], target: null }];
  state.map[6] = '...#....';
  const next = act(state, move(4, 0));
  assert.equal(next.player.piece, 'pawn'); assert.equal(next.player.hp, 7);
  assert.deepEqual([next.player.x, next.player.y], [5, 6]);
  assert.equal(walkable(next, next.player.x, next.player.y), true);
  assert.ok(!next.enemies.some((enemy) => enemy.x === next.player.x && enemy.y === next.player.y));
  assert.ok(legalMoves(next).length > 0);
});

// The shortest line of moves (at most three) after which a monster's hit lands
// in this room, so the checks below don't depend on one edition's layout.
function lineToHit(initial, prepare = (state) => state) {
  let frontier = [{ state: initial, line: [] }];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const { state, line } of frontier) {
      for (const square of legalMoves(state)) {
        const before = prepare(structuredClone(state));
        const after = act(before, move(square.x, square.y));
        if (after.events.some((event) => event.type === 'damage')) return { aimed: before, last: move(square.x, square.y), line };
        if (after.floor !== 2) continue;
        next.push({ state: after, line: [...line, move(square.x, square.y)] });
      }
    }
    frontier = next.slice(0, 400);
  }
  throw new Error('No hit within three moves in this room.');
}

test('losing a promoted pawn life in a later generated room preserves progress and a valid resumable save', () => {
  const initial = promotedThirdRoom();
  const { aimed, last } = lineToHit(initial);
  const next = act(aimed, last);
  assert.equal(next.floor, 2); assert.equal(next.player.piece, 'pawn');
  // The certified pawn route may already have spent lives on earlier floors.
  assert.equal(next.player.hp, aimed.player.hp - 1); assert.equal(next.player.maxHp, 8);
  assert.equal(walkable(next, next.player.x, next.player.y), true);
  assert.deepEqual(next.records, initial.records); assert.deepEqual(next.map, initial.map); assert.deepEqual(next.props, initial.props);
  assert.equal(next.turns, aimed.turns + 1);
  const saved = JSON.parse(JSON.stringify(next));
  assert.equal(validateSave(saved, saved.date), true);
  const step = legalMoves(saved)[0];
  const resumed = act(saved, move(step.x, step.y));
  assert.equal(resumed.turns, saved.turns + 1);
  assert.equal(validateSave(resumed, resumed.date), true);
});

test('exhaustion on the last move in room three resets the whole run to the same daily dungeon', () => {
  // Companions are no longer sold; a save from before then may still hold a paid pawn order.
  const initial = promotedThirdRoom((cleared) => ({ ...cleared, gold: cleared.gold - 2, companionOrders: [{ floor: 2, piece: 'pawn' }] }));
  const { aimed, last } = lineToHit(initial, (state) => { state.player.hp = 1; state.turns = 59; return state; });
  assert.deepEqual(aimed.companionOrders, [{ floor: 2, piece: 'pawn' }]);
  assert.equal(validateSave(aimed, aimed.date), true);
  const restarted = act(aimed, last);
  assert.equal(restarted.status, 'playing');
  // The hit may land along a lane or at close range, depending on the tier's layout.
  assert.deepEqual(restarted.events.map((event) => event.type).filter((type) => type !== 'close-capture'), ['damage', 'restart']);
  assert.match(restarted.message, /Out of lives/);
  const fresh = createGame(getDaily(aimed.date));
  assert.deepEqual({ ...restarted, events: fresh.events, message: fresh.message }, { ...fresh, replayUnlocked: true, tries: 2 });
  assert.equal(validateSave(JSON.parse(JSON.stringify(restarted)), restarted.date), true);
});

