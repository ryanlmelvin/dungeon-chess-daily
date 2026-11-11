// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, hopelessFloor, legalMoves, getDaily } from '../src/game.js';
import { createGame as createRawGame } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { hash } from '../src/random.js';
import { EDITIONS } from '../src/editions.js';

function pawn(id, x, y) {
  return { id, piece: 'pawn', role: 'pawn', species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: true, phase: 'ready', intent: [], target: null };
}
function decoy(id, piece, x, y) {
  return { ...pawn(id, x, y), piece, role: piece, name: 'Moss imp' };
}

// Edition 2026-11-07, floor 2 (pawn targets, bishop player): the playtest position.
// Three target pawns sit on dark squares with a wall in front of each, and a
// Borrowed move has already put the bishop on light squares. The room is the
// random room played that day (the second candidate under generator version 6,
// built with that day's knobs), reached by skipping floor 1, so it stays put
// whatever the editions become.
function stuckBishop() {
  const knobs = { obstacleBase: 10, decoys: 3, scatter: 1, guards: 3, screens: 0 };
  const raw = getRawDaily('2026-11-07');
  let state = createRawGame({ ...raw, difficulty: 'fiendish', ...knobs, dungeonSeed: hash(`6:${raw.seed}:1`) });
  state.objective.complete = true; state.exit.open = true;
  state = act(state, { type: 'descend' });
  assert.equal(state.floor, 1);
  assert.equal(state.objective.piece, 'pawn');
  assert.equal(state.player.piece, 'bishop');
  // The walls in front of these three squares are part of the real floor.
  for (const [x, y] of [[0, 5], [6, 5], [6, 7]]) assert.equal(state.map[y][x], '#');
  state.enemies = [pawn('a', 0, 4), pawn('b', 6, 4), pawn('c', 6, 6), decoy('k', 'king', 3, 0), decoy('q', 'queen', 7, 0)];
  Object.assign(state.player, { x: 3, y: 6, moved: true });
  state.items = state.items.filter((item) => item.type !== 'powerup');
  state.powers.leap = 0; state.powers.takeback = 0; delete state.undo;
  return state;
}

test('stuck pawn targets on the bishop’s other colour make the floor hopeless', () => {
  const state = stuckBishop();
  assert.ok(legalMoves(state).length > 0, 'the player still has moves, so trapped() never fires');
  assert.equal(hopelessFloor(state), true);
  // Waiting changes nothing: it stays hopeless after the monsters act.
  assert.equal(hopelessFloor(act(state, { type: 'wait' })), true);
});

test('a held Borrowed move that can change colour keeps the floor finishable', () => {
  const state = stuckBishop();
  state.powers.leap = 1;
  assert.equal(hopelessFloor(state), false);
});

test('a held Take-back to a finishable position keeps the floor finishable', () => {
  const state = stuckBishop();
  const before = structuredClone(state);
  before.powers.leap = 1; before.powers.takeback = 1;
  state.powers.takeback = 1; state.undo = before;
  assert.equal(hopelessFloor(state), false);
  // A Take-back to a position that was already hopeless doesn't help.
  before.powers.leap = 0;
  assert.equal(hopelessFloor(state), true);
});

test('under Manual recruit control, a recruit that could still reach a target keeps the floor finishable', () => {
  const manual = { manualRecruit: true };
  const stuck = () => { const state = stuckBishop(); state.items = state.items.filter((item) => item.type !== 'companion'); return state; };
  assert.equal(hopelessFloor(stuck(), manual), true, 'no recruit, no help');
  // A knight at your side can land anywhere; on Auto it still may not take targets.
  const knight = stuck();
  knight.companion = { piece: 'knight', basePiece: 'knight', x: 3, y: 6, moved: true, sharing: true };
  assert.equal(hopelessFloor(knight), true);
  assert.equal(hopelessFloor(knight, manual), false);
  // A bishop recruit on your colour hops onto the other one (the bishop pair), where the pawns stand.
  const bishop = stuck();
  const odd = legalMoves(bishop).find((tile) => !tile.capture);
  bishop.items.push({ type: 'companion', piece: 'bishop', x: odd.x, y: odd.y });
  assert.equal(hopelessFloor(bishop), true, 'on Auto it may not take targets');
  assert.equal(hopelessFloor(bishop, manual), false);
  const joined = stuck();
  joined.companion = { piece: 'bishop', basePiece: 'bishop', x: odd.x, y: odd.y, moved: true, sharing: false };
  assert.equal(hopelessFloor(joined, manual), false);
  // A waiting recruit counts once your piece could step onto it.
  const waiting = stuck();
  waiting.items.push({ type: 'companion', piece: 'rook', x: odd.x, y: odd.y });
  assert.equal(hopelessFloor(waiting), true);
  assert.equal(hopelessFloor(waiting, manual), false);
  const beyond = stuck();
  const even = [[2, 6], [4, 6], [3, 5], [3, 7], [1, 7], [5, 7]].find(([x, y]) => beyond.map[y][x] !== '#');
  beyond.items.push({ type: 'companion', piece: 'rook', x: even[0], y: even[1] });
  assert.equal(hopelessFloor(beyond, manual), true);
  // So does a bishop waiting on the other colour: your bishop can never step onto it.
  const apart = stuck();
  apart.items.push({ type: 'companion', piece: 'bishop', x: even[0], y: even[1] });
  assert.equal(hopelessFloor(apart, manual), true);
});

test('a target that can still move, or one on the bishop’s colour, is not hopeless', () => {
  const free = stuckBishop();
  // (2,2) has an open square in front, so the pawn can step onto light squares.
  free.enemies.push(pawn('d', 2, 2));
  assert.equal(hopelessFloor(free), false);
  const reachable = stuckBishop();
  reachable.player.x = 4; // (4,6): the same colour as the pawns.
  assert.equal(hopelessFloor(reachable), false);
});

test('a pawn player that can promote or capture diagonally is not hopeless', () => {
  const state = createGame(getDaily('2026-11-07'));
  Object.assign(state, { startingPiece: 'pawn' });
  Object.assign(state.player, { piece: 'pawn', x: 4, y: 6, moved: false });
  state.map = Array(8).fill('........');
  state.map[3] = '...#....';
  state.items = []; state.companion = null; delete state.undo;
  state.objective = { piece: 'pawn', complete: false };
  state.enemies = [pawn('a', 3, 2)];
  assert.equal(hopelessFloor(state), false);
});

test('finished, lost and fresh floors are never hopeless', () => {
  const state = stuckBishop();
  assert.equal(hopelessFloor({ ...state, objective: { ...state.objective, complete: true } }), false);
  assert.equal(hopelessFloor({ ...state, status: 'lost' }), false);
  assert.equal(hopelessFloor({ ...state, enemies: state.enemies.filter((foe) => foe.piece !== 'pawn') }), false);
  assert.equal(hopelessFloor(null), false);
  assert.equal(hopelessFloor(createGame(getDaily('2026-11-07'))), false);
});

// Soundness: every position along a certified winning route can still be won,
// so the detector must never fire on one.
test('no position on any stored edition\'s planted lines is reported hopeless', () => {
  const dates = Object.keys(EDITIONS);
  for (let n = 0; n < dates.length; n += 9) {
    const daily = getDaily(dates[n]);
    let state = createGame(daily);
    for (const [index, action] of daily.generation.certificate.actions.entries()) {
      assert.equal(hopelessFloor(state), false, `${daily.date}, before action ${index}`);
      state = act(state, action);
    }
    assert.equal(state.status, 'won', daily.date);
  }
});
