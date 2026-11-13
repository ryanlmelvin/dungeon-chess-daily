// SPDX-License-Identifier: GPL-3.0-only
// The recruit rules the recruit study led to: the king floor always recruits
// a king, and a recruit captures nothing on the turn it joins, on Manual or Auto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves, recruitChoice, PIECES } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { composedSeeds } from '../src/generation.js';
import { EDITIONS } from '../src/editions.js';
import { decodeRooms } from '../src/room-code.js';
import { withRooms } from './fixtures/rooms.js';

const move = (x, y, recruit) => (recruit === undefined ? { type: 'move', x, y } : { type: 'move', x, y, recruit });
const wait = (recruit) => (recruit === undefined ? { type: 'wait' } : { type: 'wait', recruit });
const at = (unit) => [unit.x, unit.y];
const types = (state) => state.events.map((event) => event.type);
const same = (a, b) => a.x === b.x && a.y === b.y;
function dailyFor(piece) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece && daily.playerColor === 'white') return daily;
  }
  throw Error(`No ${piece} edition found`);
}
// An empty room on a plain day, monsters frozen. Kings are no longer a daily piece; a king borrows a rook day.
function scenario(piece = 'rook', { x = 4, y = 6 } = {}) {
  const state = createGame(withRooms(dailyFor(piece === 'king' ? 'rook' : piece)));
  state.awaitingPlayer = false;
  Object.assign(state.player, { x, y, moved: true });
  if (piece === 'king') { state.startingPiece = 'king'; state.player.piece = 'king'; }
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.enemies = []; state.companion = null;
  delete state.modifier; delete state.ice;
  state.objective = { piece: 'knight', complete: false };
  state.powers.freeze = 6;
  return state;
}
const foe = (id, piece, x, y) => ({ id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: true, phase: 'ready', target: null, intent: [] });
const recruitAt = (piece, x, y) => ({ type: 'companion', piece, x, y });

// The hole the rule closes: monsters never avoid a waiting recruit's lines, so
// one could take a target the moment you joined it.
test('a recruit you steer can’t capture on the turn it joins: only quiet squares and Hold are offered', () => {
  const state = scenario('rook');
  state.items = [recruitAt('queen', 4, 5)];
  // A target on the queen's file and a decoy on its diagonal, both in its lines as you join it.
  state.enemies = [foe('target', 'knight', 4, 1), foe('decoy', 'bishop', 1, 2)];
  const choice = recruitChoice(state, move(4, 5));
  assert.ok(choice.moves.length > 0 && choice.moves.every((tile) => !tile.capture));
  assert.ok(choice.moves.some((tile) => same(tile, { x: 4, y: 2 })), 'it may close in on the target');
  assert.ok(!choice.moves.some((tile) => same(tile, { x: 4, y: 1 }) || same(tile, { x: 1, y: 2 })));
  // An order to capture that turn is no action; a quiet square or Hold is fine.
  assert.equal(act(state, move(4, 5, { x: 4, y: 1 })), state);
  assert.equal(act(state, move(4, 5, { x: 1, y: 2 })), state);
  const held = act(state, move(4, 5, 'hold'));
  assert.deepEqual(at(held.companion), [4, 5]); assert.equal(held.captures, 0);
  assert.deepEqual(at(act(state, move(4, 5, { x: 4, y: 2 })).companion), [4, 2]);
  // From your next move on it captures as before, the target included.
  const next = recruitChoice(held, wait());
  assert.ok(next.moves.some((tile) => same(tile, { x: 4, y: 1 }) && tile.capture));
  assert.ok(next.moves.some((tile) => same(tile, { x: 1, y: 2 }) && tile.capture));
  const taken = act(held, wait({ x: 4, y: 1 }));
  assert.equal(taken.captures, 1); assert.equal(taken.objective.complete, true);
});

test('on Auto a joining recruit takes nothing that turn either, then captures as usual', () => {
  const state = scenario('rook');
  state.items = [recruitAt('queen', 4, 5)];
  state.enemies = [foe('target', 'knight', 4, 1), foe('decoy', 'bishop', 1, 2)];
  const joined = act(state, move(4, 5));
  assert.equal(joined.captures, 0); assert.equal(joined.enemies.length, 2);
  assert.ok(types(joined).includes('companion-move'), 'it still moves');
  assert.ok(!types(joined).includes('companion-capture'));
  assert.equal(joined.message, 'A queen joins you this floor. It can capture from your next move on, but never knights.');
  // Next turn Auto takes the decoy it may take (never the target).
  const next = act(joined, wait());
  assert.equal(next.captures, 1);
  assert.deepEqual(next.enemies.map((monster) => monster.id), ['target']);
  // It is the joining that counts, not how long it has been with you: a recruit that held still captures next turn.
  const held = act(state, move(4, 5, 'hold'));
  assert.equal(act(held, wait()).captures, 1);
});

test('the bishop pair still hops on the joining turn (a hop never captures), and captures from the next', () => {
  const state = scenario('bishop', { x: 4, y: 4 });
  state.items = [recruitAt('bishop', 3, 3)];
  // A decoy on the waiting bishop's diagonal, another on a diagonal of the square it can hop to.
  state.enemies = [foe('near', 'rook', 1, 1), foe('far', 'rook', 5, 6), foe('target', 'knight', 7, 0)];
  const choice = recruitChoice(state, move(3, 3));
  assert.equal(choice.hop, true);
  assert.ok(choice.moves.every((tile) => !tile.capture && Math.abs(tile.x - 3) + Math.abs(tile.y - 3) === 1));
  const hopped = act(state, move(3, 3, { x: 3, y: 4 }));
  assert.ok(types(hopped).includes('bishop-pair')); assert.equal(hopped.captures, 0);
  assert.ok(recruitChoice(hopped, wait()).moves.some((tile) => same(tile, { x: 5, y: 6 }) && tile.capture));
  assert.equal(act(hopped, wait({ x: 5, y: 6 })).captures, 1);
  // On Auto it hops too, and takes nothing.
  const auto = act(state, move(3, 3));
  assert.ok(types(auto).includes('bishop-pair')); assert.equal(auto.captures, 0);
});

// Castling needs the recruit beside you before you move, so it never falls on
// the joining move itself; the rule leaves it alone.
test('castling is untouched: the joining move may set up a castle, and you castle on the next', () => {
  // A practice king and a rook recruit: the rook's joining move takes it three squares off on your row.
  const king = scenario('king');
  king.items = [recruitAt('rook', 4, 5)]; king.enemies = [foe('far', 'queen', 0, 0)];
  assert.ok(!legalMoves(king).some((tile) => tile.castle));
  const joined = act(king, move(4, 5, { x: 7, y: 5 }));
  assert.deepEqual(at(joined.companion), [7, 5]);
  assert.ok(legalMoves(joined).some((tile) => tile.castle && same(tile, { x: 6, y: 5 })));
  const castled = act(joined, move(6, 5));
  assert.deepEqual(at(castled.player), [6, 5]); assert.deepEqual(at(castled.companion), [5, 5]);
  assert.ok(types(castled).includes('castle'));
  // Your rook and the king floor's king recruit, which held on the joining move.
  const rook = scenario('rook');
  rook.items = [recruitAt('king', 1, 6)]; rook.enemies = [foe('far', 'queen', 7, 0)];
  let state = act(rook, move(1, 6, 'hold'));
  state = act(state, move(4, 6, 'hold'));
  assert.ok(legalMoves(state).some((tile) => tile.castle && same(tile, { x: 1, y: 6 })));
  const done = act(state, move(1, 6));
  assert.deepEqual(at(done.player), [2, 6]); assert.deepEqual(at(done.companion), [3, 6]);
  assert.deepEqual(done.feats, [{ floor: 0, kind: 'castle' }]);
});

// Every floor of a stored edition, from its start (the floors before cleared at once).
function* floorsOf(daily) {
  let state = createGame(daily);
  for (let floor = 0; floor < 3; floor++) {
    yield state;
    const cleared = structuredClone(state);
    cleared.enemies = []; cleared.exit = { ...cleared.exit, open: true };
    cleared.objective = { ...cleared.objective, complete: true, moves: 0 };
    state = act(cleared, { type: 'descend' });
  }
}

// The composer places every recruit (src/composer.js): on the king floor a king,
// one move from the start; on floors 1 and 2, now and then, any piece.
test('every stored king floor waits with a king recruit one move from its start; floors 1 and 2 recruit any piece', () => {
  const early = new Set();
  for (const [date, entry] of Object.entries(EDITIONS)) {
    const daily = { ...getRawDaily(date), difficulty: 'fair', floorSeeds: composedSeeds(date), composed: decodeRooms(entry.rooms) };
    for (const start of floorsOf(daily)) {
      const recruits = start.items.filter((item) => item.type === 'companion');
      assert.ok(recruits.length <= 1, `${date} floor ${start.floor + 1}`);
      if (start.floor < 2) { for (const recruit of recruits) early.add(recruit.piece); continue; }
      assert.deepEqual(recruits.map((recruit) => recruit.piece), ['king'], date);
      assert.ok(legalMoves(start).some((tile) => same(tile, recruits[0])), `${date}: one move from the start`);
    }
  }
  assert.deepEqual([...early].sort(), [...PIECES].sort());
});
