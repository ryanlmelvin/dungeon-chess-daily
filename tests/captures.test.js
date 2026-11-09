// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, floorScoredMoves, getDaily, legalMoves, scoredMoves, validateSave, walkable } from '../src/game.js';

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
// A rook at the far end of `square`'s row, aimed along it at `square`.
const aimedAt = (id, square) => rook(id, square.x >= 4 ? 0 : 7, square.y, square);
// A move off the start row, so a lane along the destination's row never crosses where the piece stood.
const stepAway = (state) => legalMoves(state).find((square) => square.y !== state.player.y && square.x !== 0 && square.x !== 7);
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

test('there are no lives: every capture adds a move to the floor and the run goes on, for every piece', () => {
  for (const piece of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']) {
    // The king is never the daily piece, only a practice choice.
    let state = piece === 'king' ? createPracticeGame(getDaily(dates.rook), { piece, color: 'white' }) : scenario(piece);
    if (piece === 'king') { state.map = Array(8).fill('........'); state.props = []; state.enemies = []; state.items = []; }
    assert.equal('hp' in state.player || 'maxHp' in state.player, false, piece);
    assert.equal(state.hits, 0);
    for (let capture = 1; capture <= 3; capture++) {
      const square = stepAway(state);
      state.enemies = [aimedAt(`attacker-${capture}`, square)];
      const turns = state.turns;
      state = act(state, move(square.x, square.y));
      assert.equal(state.status, 'playing', `${piece}: capture ${capture}`);
      assert.ok(state.events.some((event) => event.type === 'player-captured'), `${piece}: capture ${capture}`);
      assert.match(state.message, /\(\+1 move\)/);
      assert.equal(state.turns, turns + 1);
      assert.equal(state.hits, capture);
      // Each capture is one more move on the floor's score, beside the move itself.
      assert.equal(floorScoredMoves(state), 2 * capture, `${piece}: capture ${capture}`);
    }
  }
});

test('a bone ward blocks a capture, so it adds no move', () => {
  const state = scenario('rook');
  state.powers.shield = 1;
  const square = stepAway(state);
  state.enemies = [aimedAt('attacker', square)];
  const next = act(state, move(square.x, square.y));
  assert.ok(next.events.some((event) => event.type === 'shield'));
  assert.equal(next.powers.shield, 0); assert.equal(next.hits, 0);
  assert.equal(floorScoredMoves(next), 1);
});

test('captures score on their floor, even after its challenge is complete; the record keeps them', () => {
  let state = scenario('rook');
  const target = state.objective.piece;
  const square = stepAway(state);
  state.enemies = [aimedAt('attacker', square)];
  state = act(state, move(square.x, square.y));
  assert.equal(floorScoredMoves(state), 2);
  // The last target, a step away: taking it completes the challenge and stops the move count.
  const prey = legalMoves(state).find((tile) => tile.y !== state.player.y && tile.x !== 0 && tile.x !== 7);
  state.enemies = [{ id: 'prey', piece: target, role: target, species: state.species[0].id, name: 'Prey', x: prey.x, y: prey.y, moved: false, phase: 'ready', target: null, intent: [] }];
  state = act(state, move(prey.x, prey.y));
  assert.equal(state.objective.complete, true);
  assert.equal(floorScoredMoves(state), 3);
  // Exploring after the clear is free, but a capture there still adds a move.
  const next = stepAway(state);
  state.enemies = [aimedAt('late', next)];
  state = act(state, move(next.x, next.y));
  assert.ok(state.events.some((event) => event.type === 'player-captured'));
  assert.equal(state.objective.moves, 2);
  assert.equal(floorScoredMoves(state), 4);
  state = act(state, { type: 'descend' });
  const record = state.records[0];
  assert.equal(record.hits, 2); assert.equal(record.scored, 2);
  assert.equal(scoredMoves(record), 4);
  assert.equal(state.hits, 2); assert.equal(state.floorStart.hits, 2);
  assert.equal(floorScoredMoves(state), 0, 'the next floor starts its own count');
});

test('a pawn promoted and hit on the same turn returns to the entrance as a pawn, one move more on the floor', () => {
  const state = scenario('pawn', 4, 1);
  state.enemies = [rook('attacker', 0, 0, { x: 4, y: 0 })];
  const next = act(state, move(4, 0));
  assert.equal(next.player.piece, 'pawn'); assert.equal(next.hits, 1);
  assert.equal(floorScoredMoves(next), 2);
  assert.deepEqual([next.player.x, next.player.y], [4, 6]);
  assert.equal(next.player.moved, false); assert.equal(next.status, 'playing');
  assert.ok(legalMoves(next).length > 0); assert.match(next.message, /\(\+1 move\)\. Back to a pawn\./);
});

test('a demoted pawn skips an occupied entrance and blocked replacement squares', () => {
  const state = scenario('pawn', 4, 1); state.player.piece = 'queen';
  state.enemies = [rook('attacker', 0, 0, { x: 4, y: 0 }), { ...rook('blocker', 4, 6, { x: 4, y: 0 }), phase: 'ready', intent: [], target: null }];
  state.map[6] = '...#....';
  const next = act(state, move(4, 0));
  assert.equal(next.player.piece, 'pawn'); assert.equal(next.hits, 1);
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
        if (after.events.some((event) => event.type === 'player-captured')) return { aimed: before, last: move(square.x, square.y), line };
        if (after.floor !== 2) continue;
        next.push({ state: after, line: [...line, move(square.x, square.y)] });
      }
    }
    frontier = next.slice(0, 400);
  }
  throw new Error('No hit within three moves in this room.');
}

test('a promoted pawn captured in a later generated room keeps its progress and a valid resumable save', () => {
  const initial = promotedThirdRoom();
  const { aimed, last } = lineToHit(initial);
  const next = act(aimed, last);
  assert.equal(next.floor, 2); assert.equal(next.player.piece, 'pawn'); assert.equal(next.status, 'playing');
  // The certified pawn route may already have been captured on earlier floors.
  assert.equal(next.hits, aimed.hits + 1);
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

test('saves keep the capture count honest', () => {
  const initial = promotedThirdRoom();
  const { aimed, last } = lineToHit(initial);
  const next = JSON.parse(JSON.stringify(act(aimed, last)));
  assert.equal(validateSave(next, next.date), true);
  for (const hits of [-1, 0.5, 2 * next.turns + 1]) assert.equal(validateSave({ ...next, hits }, next.date), false, `hits ${hits}`);
  // The floor started with the captures the earlier floors' records hold.
  assert.equal(validateSave({ ...next, floorStart: { ...next.floorStart, hits: next.floorStart.hits + 1 } }, next.date), false);
});
