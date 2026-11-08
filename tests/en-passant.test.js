// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
function findDaily(match, label) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (match(daily)) return daily;
  }
  throw Error(`No ${label} edition found`);
}
// Kings are no longer a daily piece; engine tests borrow a rook day.
// Every daily is white; black engine tests borrow a white day, as practice does.
const dailyFor = (piece, color) => color === 'black' ? { ...dailyFor(piece, 'white'), playerColor: 'black' } : piece === 'king' ? { ...dailyFor('rook', color), playerPiece: 'king' } : findDaily((d) => d.playerPiece === piece && d.playerColor === color, `${color} ${piece}`);
function scenario(piece = 'pawn', color = 'white', x = 4, y = 6) {
  const state = createGame(dailyFor(piece, color));
  Object.assign(state.player, { x, y, moved: y !== 6 });
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.enemies = [];
  state.objective = { piece: 'king', complete: false }; state.companion = null;
  state.powers = { shield: 0, freeze: 0, magnet: 0 }; state.awaitingPlayer = false;
  return state;
}
function monster(id, piece, x, y) {
  return { id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: false, phase: 'ready', intent: [], target: null };
}
const types = (state) => state.events.map((event) => event.type);
const find = (state, type) => state.events.find((event) => event.type === type);
const epMove = (state) => legalMoves(state).find((m) => m.enPassant);

// moveMonster's tie-break hashes the turn number; pick a turn on which the
// monster pawn at (5,1) prefers its double step, so the test is deterministic.
function doubleStepScenario(color, playerY, act0) {
  for (let turns = 0; turns < 50; turns++) {
    const state = scenario('pawn', color, 4, playerY); state.turns = turns;
    state.enemies = [monster('p', 'pawn', 5, 1), monster('k', 'king', 0, 0)];
    const next = act(state, act0);
    if (next.enemies.find((foe) => foe.id === 'p')?.y === 3) return next;
  }
  throw Error('no double step found');
}

test('white: a monster pawn double-stepping beside the pawn can be taken en passant', () => {
  const state = doubleStepScenario('white', 4, move(4, 3));
  assert.deepEqual(state.enPassant, { id: 'p', x: 5, y: 2 });
  assert.deepEqual(epMove(state), { x: 5, y: 2, capture: true, enPassant: true });
  const next = act(state, move(5, 2));
  assert.equal(next.enemies.some((foe) => foe.id === 'p'), false);
  assert.deepEqual([next.player.x, next.player.y], [5, 2]);
  const t = types(next);
  // The capture unmasks the pawn, then the en passant is noted.
  assert.equal(t.indexOf('unmask'), t.indexOf('capture') + 1);
  assert.equal(t.indexOf('en-passant'), t.indexOf('unmask') + 1);
  assert.deepEqual(find(next, 'capture'), { type: 'capture', id: 'p', x: 5, y: 3 });
  assert.deepEqual(find(next, 'unmask'), { type: 'unmask', id: 'p', species: 'bat', role: 'pawn', x: 5, y: 3 });
  assert.deepEqual(find(next, 'en-passant'), { type: 'en-passant', id: 'p', x: 5, y: 3, to: { x: 5, y: 2 } });
  assert.equal(next.enPassant, null);
});

test('white: the window closes after any other move or a wait', () => {
  const state = doubleStepScenario('white', 4, move(4, 3));
  for (const action of [move(4, 2), wait]) {
    const next = act(state, action);
    assert.equal(next.enPassant, null);
    assert.equal(epMove(next), undefined);
    assert.equal(act(next, move(5, 2)).enemies.some((foe) => foe.id === 'p'), true);
  }
});

test('black: the window opened by this act\'s enemy phase is usable by the same turn\'s choice', () => {
  const state = doubleStepScenario('black', 3, move(4, 2));
  // The fresh capture earns a re-prompt; the player has not moved, so the window stays.
  assert.equal(state.awaitingPlayer, true);
  assert.deepEqual([state.player.x, state.player.y], [4, 3]);
  assert.deepEqual(state.enPassant, { id: 'p', x: 5, y: 2 });
  assert.ok(epMove(state));
  const next = act(state, move(5, 2));
  assert.equal(next.enemies.some((foe) => foe.id === 'p'), false);
  assert.ok(find(next, 'en-passant'));
  assert.match(next.message, /En passant! Ice bat unmasked — a pawn! \+1 gold\./);
  assert.equal(next.enPassant, null);
  // Choosing another move instead spends the window.
  const other = act(state, move(4, 2));
  assert.equal(other.enPassant, null);
  assert.equal(other.enemies.some((foe) => foe.id === 'p'), true);
});

test('en passant is offered only to a pawn on rank 3 beside the double-stepped pawn', () => {
  const ready = scenario('pawn', 'white', 4, 3);
  ready.enemies = [monster('p', 'pawn', 5, 3)]; ready.enPassant = { id: 'p', x: 5, y: 2 };
  assert.ok(epMove(ready));
  const low = scenario('pawn', 'white', 4, 4);
  low.enemies = [monster('p', 'pawn', 5, 3)]; low.enPassant = { id: 'p', x: 5, y: 2 };
  assert.equal(epMove(low), undefined);
  const rook = scenario('rook', 'white', 4, 3);
  rook.enemies = [monster('p', 'pawn', 5, 3)]; rook.enPassant = { id: 'p', x: 5, y: 2 };
  assert.equal(epMove(rook), undefined);
  const far = scenario('pawn', 'white', 2, 3);
  far.enemies = [monster('p', 'pawn', 5, 3)]; far.enPassant = { id: 'p', x: 5, y: 2 };
  assert.equal(epMove(far), undefined);
  // A pawn that has moved on voids the window.
  const gone = scenario('pawn', 'white', 4, 3);
  gone.enemies = [monster('p', 'pawn', 5, 4)]; gone.enPassant = { id: 'p', x: 5, y: 2 };
  assert.equal(epMove(gone), undefined);
});

test('a monster pawn captures a double-stepping pawn en passant at once', () => {
  const state = scenario('pawn', 'white'); const hp = state.player.hp;
  state.enemies = [monster('p', 'pawn', 5, 4)];
  const next = act(state, move(4, 4));
  assert.equal(next.player.hp, hp - 1);
  assert.deepEqual(find(next, 'close-capture'), { type: 'close-capture', id: 'p', x: 5, y: 4, enPassant: true });
  assert.equal(find(next, 'player-captured').enPassant, true);
  // The monsters still take their turn after the hit.
  assert.ok(find(next, 'enemy-phase'));
  assert.match(next.message, /Ice bat captured you en passant as you passed it\./);
  // As in chess, the capturing pawn lands on the square the double step skipped.
  assert.deepEqual([next.enemies[0].x, next.enemies[0].y], [4, 5]);
  assert.deepEqual(find(next, 'enemy-move'), { type: 'enemy-move', id: 'p', from: { x: 5, y: 4 }, x: 4, y: 5 });
});

test('a single step beside the monster pawn is the ordinary diagonal attack', () => {
  const state = scenario('pawn', 'white', 4, 6); const hp = state.player.hp;
  state.enemies = [monster('p', 'pawn', 5, 4)];
  const next = act(state, move(4, 5));
  assert.equal(next.player.hp, hp - 1);
  const close = find(next, 'close-capture');
  assert.equal(close.id, 'p'); assert.equal(close.enPassant, undefined);
  assert.equal(find(next, 'player-captured').enPassant, undefined);
});

test('a frozen monster pawn never strikes en passant', () => {
  const state = scenario('pawn', 'white'); const hp = state.player.hp; state.powers.freeze = 2;
  state.enemies = [monster('p', 'pawn', 3, 4)];
  const next = act(state, move(4, 4));
  assert.equal(next.player.hp, hp); assert.equal(find(next, 'close-capture'), undefined);
});

test('a shield absorbs an en passant capture', () => {
  const state = scenario('pawn', 'white'); const hp = state.player.hp; state.powers.shield = 1;
  state.enemies = [monster('p', 'pawn', 3, 4)];
  const next = act(state, move(4, 4));
  assert.equal(next.player.hp, hp); assert.equal(next.powers.shield, 0);
  assert.equal(find(next, 'shield').enPassant, true);
  assert.equal(find(next, 'close-capture').enPassant, true);
  assert.match(next.message, /en passant as you passed it, but your bone ward blocked it\./);
});

test('black: a double step newly exposed to en passant earns a fresh choice', () => {
  // The frost wears off in this enemy phase, so the pawn beside the landing square wakes up.
  const state = scenario('pawn', 'black'); const hp = state.player.hp; state.powers.freeze = 1;
  state.enemies = [monster('p', 'pawn', 3, 4)];
  const next = act(state, move(4, 4));
  assert.equal(next.awaitingPlayer, true);
  assert.deepEqual([next.player.x, next.player.y], [4, 6]);
  assert.equal(next.player.hp, hp); assert.equal(find(next, 'close-capture'), undefined);
  // Insisting on the double step is then captured en passant.
  const hit = act(next, move(4, 4));
  assert.equal(hit.player.hp, hp - 1); assert.equal(find(hit, 'close-capture').enPassant, true);
});

test('saves with an en passant window validate and survive JSON; malformed ones do not', () => {
  const daily = findDaily((d) => d.targets[0] === 'pawn', 'pawn-target');
  const base = createGame(daily);
  assert.equal(base.enPassant, null);
  assert.equal(validateSave(base, daily.date, daily), true);
  const legacy = structuredClone(base); delete legacy.enPassant;
  assert.equal(validateSave(legacy, daily.date, daily), true);
  const pawn = base.enemies.find((foe) => foe.piece === 'pawn' && foe.y === 3);
  const open = structuredClone(base); open.enPassant = { id: pawn.id, x: pawn.x, y: 2 };
  const round = JSON.parse(JSON.stringify(open));
  assert.equal(validateSave(round, daily.date, daily), true);
  assert.deepEqual(round.enPassant, open.enPassant);
  for (const bad of [{ id: pawn.id, x: pawn.x, y: 3 }, { id: pawn.id, x: pawn.x + 1, y: 2 }, { id: 'nobody', x: pawn.x, y: 2 },
    { id: pawn.id, x: pawn.x, y: 2, extra: 1 }, { id: pawn.id, x: 8, y: 2 }, 'yes', 0, []]) {
    const broken = structuredClone(base); broken.enPassant = bad;
    assert.equal(validateSave(broken, daily.date, daily), false, JSON.stringify(bad));
  }
  const event = structuredClone(open); event.events = [{ type: 'en-passant', id: pawn.id, x: pawn.x, y: 3, to: { x: pawn.x, y: 2 } }];
  assert.equal(validateSave(event, daily.date, daily), true);
});
