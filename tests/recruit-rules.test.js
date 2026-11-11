// SPDX-License-Identifier: GPL-3.0-only
// The recruit rules the recruit study led to (docs/generation.md, "Measuring
// the recruits"): the king floor always recruits a king; a recruit captures
// nothing on the turn it joins, on Manual or Auto; and a pawn recruit waits
// only on a file open to the far rank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves, recruitChoice, PIECES } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { hash, random } from '../src/random.js';
import { randomRoomDaily } from './fixtures/random-room.js';

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
  const state = createGame(dailyFor(piece === 'king' ? 'rook' : piece));
  state.awaitingPlayer = false;
  Object.assign(state.player, { x, y, moved: true });
  if (piece === 'king') { state.startingPiece = 'king'; state.player.piece = 'king'; }
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.enemies = []; state.companion = null;
  delete state.modifier; delete state.ice; delete state.reinforcements; delete state.reinforcementsSkipped;
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

// Every floor of a candidate layout, from its start (the floors before cleared at once).
function* floorsOf(candidate) {
  let state = createGame(candidate);
  for (let floor = 0; floor < 3; floor++) {
    yield state;
    const cleared = structuredClone(state);
    cleared.enemies = []; cleared.exit = { ...cleared.exit, open: true };
    cleared.objective = { ...cleared.objective, complete: true, moves: 0 };
    state = act(cleared, { type: 'descend' });
  }
}
const openFile = (state, tile) => Array.from({ length: tile.y }, (_, y) => state.map[y][tile.x]).every((cell) => cell !== '#');
const COINS = [{ x: 4, y: 4 }, { x: 2, y: 4 }, { x: 6, y: 4 }];
// The squares the recruit is drawn from, in the rules' order: one move from the
// start for the floor's piece, never a monster's, the door's or an item's (the
// king floor's coins are dropped after the recruit is placed).
function recruitTiles(start) {
  return legalMoves(start).filter((tile) => !tile.capture && !tile.castle && !tile.borrowed && !same(tile, start.exit)
    && !(start.floor === 2 && COINS.some((coin) => same(coin, tile)))
    && !start.items.some((item) => item.type !== 'companion' && same(item, tile))).map(({ x, y }) => ({ x, y }));
}

test('the king floor always recruits a king, on the square its draw always gave; floors 1 and 2 keep any piece', () => {
  const early = new Set();
  let kings = 0;
  for (let day = 0; day < 120; day++) {
    const raw = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    const candidate = randomRoomDaily(raw.date, { attempt: day % 4 });
    for (const start of floorsOf(candidate)) {
      const recruit = start.items.find((item) => item.type === 'companion');
      if (start.floor < 2) { early.add(recruit.piece); continue; }
      assert.equal(recruit.piece, 'king', raw.date);
      kings++;
      // The recruit's stream still spends its first draw on the piece, so the square is the one it always was
      // (unless nothing one move from the start is free, as on the launch edition's walled-in pawn file).
      const tiles = recruitTiles(start);
      if (!tiles.length) continue;
      const rng = random(hash(`${start.dungeonSeed ?? start.seed}:companion:2`)); rng();
      assert.deepEqual(at(recruit), at(tiles[Math.floor(rng() * tiles.length)]), raw.date);
    }
  }
  assert.equal(kings, 120);
  assert.deepEqual([...early].sort(), [...PIECES].sort());
});

test('a pawn recruit waits only on a file open to the far rank, drawn from its own stream; with no such square it is another piece', () => {
  const others = PIECES.filter((piece) => piece !== 'pawn');
  let pawns = 0, moved = 0, redrawn = 0;
  for (let day = 0; day < 240; day++) {
    const raw = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    const candidate = randomRoomDaily(raw.date, { attempt: day % 4 });
    // The same layout twice: placement is deterministic.
    assert.deepEqual(createGame(candidate).items, createGame(candidate).items);
    for (const start of floorsOf(candidate)) {
      if (start.floor === 2) continue;
      const recruit = start.items.find((item) => item.type === 'companion');
      const label = `${raw.date} floor ${start.floor + 1}`;
      if (recruit.piece === 'pawn') { pawns++; assert.ok(openFile(start, recruit), `${label}: ${JSON.stringify(recruit)}`); }
      // Replay the recruit's own stream: its piece, its square and, for a pawn on a walled file, one more draw.
      const tiles = recruitTiles(start);
      if (!tiles.length) continue;
      const rng = random(hash(`${start.dungeonSeed ?? start.seed}:companion:${start.floor}`));
      let piece = PIECES[Math.floor(rng() * PIECES.length)];
      let tile = tiles[Math.floor(rng() * tiles.length)];
      if (piece === 'pawn' && !openFile(start, tile)) {
        const lanes = tiles.filter((entry) => openFile(start, entry)), roll = rng();
        if (lanes.length) { tile = lanes[Math.floor(roll * lanes.length)]; moved++; } else { piece = others[Math.floor(roll * others.length)]; redrawn++; }
      }
      assert.deepEqual({ piece: recruit.piece, x: recruit.x, y: recruit.y }, { piece, x: tile.x, y: tile.y }, label);
    }
  }
  assert.ok(pawns > 20 && moved > 5 && redrawn > 0, `${pawns} pawn recruits, ${moved} moved to an open file, ${redrawn} redrawn`);
});
