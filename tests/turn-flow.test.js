// SPDX-License-Identifier: GPL-3.0-only
// Turn flow: a close-range hit no longer freezes the board, the final floor's
// king keeps out of a held Borrowed move's reach, and a monster that lunges and
// misses is off-balance (it can't capture) until the player's next move ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, closeAttacker, createGame, dangerTiles, legalMoves, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { room, withRooms } from './fixtures/rooms.js';

const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
const count = (state, type) => state.events.filter((event) => event.type === type).length;
function dailyFor(piece) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece) return daily;
  }
  throw Error(`No ${piece} edition found`);
}
function scenario({ piece = 'rook', color = 'white', at = [4, 6], floor = 0 } = {}) {
  const state = createGame(withRooms({ ...dailyFor(piece === 'king' ? 'rook' : piece), playerColor: color }));
  Object.assign(state, { floor, map: Array(8).fill('........'), props: [], items: [], enemies: [], companion: null, awaitingPlayer: false });
  state.objective = { piece: 'king', complete: false };
  state.exit = { x: 4, y: 0, open: false };
  state.powers = { shield: 0, freeze: 0, magnet: 0, pin: 0, leap: 0, takeback: 0 };
  Object.assign(state.player, { piece, x: at[0], y: at[1] });
  return state;
}
// A monster; `lane` (with its last square the target) winds it up.
function monster(id, piece, x, y, lane = null) {
  return { id, piece, role: piece, species: 'bat', palette: 'violet', name: 'Violet bat', x, y, moved: true,
    phase: lane ? 'aim' : 'ready', target: lane ? { ...lane.at(-1) } : null, intent: lane ? lane.map((tile) => ({ ...tile })) : [] };
}
const foe = (state, id) => state.enemies.find((entry) => entry.id === id);
const row4 = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y: 4 }));

// 1. Close-range hits keep the monster phase.

test('after a close-range hit the monsters still move and wind up, but a strike that would land holds', () => {
  const state = scenario();
  state.enemies = [monster('rook', 'rook', 0, 4, row4(1, 4)), monster('guard', 'king', 5, 3), monster('far', 'king', 0, 0)];
  const next = act(state, move(4, 4));
  assert.equal(next.hits, 1, 'one hit');
  assert.equal(count(next, 'player-captured'), 1);
  assert.equal(count(next, 'enemy-phase'), 1);
  const rook = foe(next, 'rook');
  assert.equal(rook.phase, 'aim', 'the wound-up rook holds its strike');
  assert.deepEqual([rook.x, rook.y, rook.target], [0, 4, { x: 4, y: 4 }]);
  assert.ok(next.events.some((event) => event.type === 'enemy-move' && event.id === 'far'), 'everything else still moves');
  assert.equal(foe(next, 'guard').phase, 'aim', 'the close attacker winds up again');
  assert.ok(dangerTiles(next).some((tile) => tile.x === 4 && tile.y === 4));
  // Staying put next turn, the held strike lands.
  const stayed = act(next, wait);
  assert.equal(stayed.hits, 2);
  assert.equal(stayed.events.find((event) => event.type === 'player-captured').by, 'rook');
});

test('a bone ward absorbs the close-range hit without freezing the board, and no second hit lands', () => {
  const state = scenario(); state.powers.shield = 2;
  state.enemies = [monster('rook', 'rook', 0, 4, row4(1, 4)), monster('guard', 'king', 5, 3), monster('far', 'king', 0, 0)];
  const next = act(state, move(4, 4));
  assert.equal(next.hits, 0);
  assert.equal(next.powers.shield, 1, 'only one ward spent: no double hit');
  assert.equal(count(next, 'shield'), 1);
  assert.equal(foe(next, 'rook').phase, 'aim');
  assert.equal(foe(next, 'guard').phase, 'aim');
  assert.ok(next.events.some((event) => event.type === 'enemy-move' && event.id === 'far'));
});

test('a close-range hit no longer pins the final floor’s king in place', () => {
  // The rook steps where a knight guard strikes and onto the king's row: the king must flee.
  const state = scenario({ at: [0, 6], floor: 2 }); state.powers.shield = 1;
  state.enemies = [monster('king', 'king', 5, 3), monster('guard', 'knight', 1, 1)];
  const next = act(state, move(0, 3));
  assert.equal(count(next, 'shield'), 1);
  const king = foe(next, 'king');
  assert.notDeepEqual([king.x, king.y], [5, 3]);
  assert.ok(!legalMoves(next).some((tile) => tile.capture && tile.x === king.x && tile.y === king.y));
});

test('black’s turn order is unchanged: one enemy phase, before the move, even with a close-range hit', () => {
  const state = scenario({ color: 'black' });
  state.enemies = [monster('guard', 'king', 5, 5)];
  const next = act(state, move(4, 4));
  assert.equal(next.hits, 1);
  assert.equal(count(next, 'enemy-phase'), 1);
  assert.ok(next.events.findIndex((event) => event.type === 'enemy-phase') < next.events.findIndex((event) => event.type === 'close-capture'));
});

// 2. The royal king respects a held Borrowed move.

test('the final floor’s king stays out of a held Borrowed knight jump', () => {
  const held = scenario({ floor: 2 }); held.powers.leap = 1;
  held.enemies = [monster('king', 'king', 7, 7)];
  const next = act(held, wait);
  const king = foe(next, 'king');
  assert.notDeepEqual([king.x, king.y], [6, 7], 'a knight’s jump from the rook');
  assert.ok(!legalMoves(next).some((tile) => tile.capture && tile.x === king.x && tile.y === king.y));
  // Without the Borrowed move that square is safe, and the king takes it.
  const plain = scenario({ floor: 2 });
  plain.enemies = [monster('king', 'king', 7, 7)];
  const free = foe(act(plain, wait), 'king');
  assert.deepEqual([free.x, free.y], [6, 7]);
});

test('the final floor’s king stays off a knight’s borrowed queen lines', () => {
  const state = scenario({ piece: 'knight', floor: 2 }); state.powers.leap = 1;
  state.enemies = [monster('king', 'king', 4, 4)];
  const next = act(state, wait);
  const king = foe(next, 'king');
  assert.ok(!legalMoves(next).some((tile) => tile.capture && tile.x === king.x && tile.y === king.y));
});

// 3. Off-balance after a missed lunge.

// The bat wound up on (4,5) from (3,4); the rook sidesteps to (4,6).
function baited(options) {
  const state = scenario(options);
  Object.assign(state.player, { x: 4, y: 5 });
  state.enemies = [monster('bat', 'king', 3, 4, [{ x: 4, y: 5 }])];
  return state;
}

test('a monster that lunges and misses lands on its target, off-balance, and says so', () => {
  const next = act(baited(), move(4, 6));
  const bat = foe(next, 'bat');
  assert.deepEqual([bat.x, bat.y], [4, 5], 'it lands on the square you left');
  assert.equal(bat.offBalance, true);
  assert.equal(bat.phase, 'ready');
  assert.deepEqual(next.events.find((event) => event.type === 'miss'), { type: 'miss', id: 'bat', x: 4, y: 5 });
  assert.equal(next.message, 'Violet bat lunged and missed — it’s off-balance!');
  assert.equal(next.hits, 0);
});

test('an off-balance monster can’t capture at close range, even when you end beside it', () => {
  const missed = act(baited(), move(4, 6));
  assert.equal(closeAttacker(missed, { x: 5, y: 6 }), null);
  const beside = act(missed, move(5, 6));
  assert.equal(beside.hits, 0);
  assert.equal(count(beside, 'close-capture'), 0);
  // Your move is over: it finds its feet and winds up as usual.
  const bat = foe(beside, 'bat');
  assert.equal(bat.offBalance, undefined);
  assert.equal(bat.phase, 'aim');
});

test('an off-balance monster doesn’t guard: taking a monster beside it is safe', () => {
  const missed = act(baited(), move(4, 6));
  missed.enemies.push(monster('prey', 'rook', 5, 6));
  const taken = act(missed, move(5, 6));
  assert.equal(taken.captures, 1);
  assert.equal(taken.hits, 0);
  assert.equal(count(taken, 'close-capture'), 0);
});

test('punish: the player captures the off-balance monster where it landed', () => {
  const missed = act(baited(), move(4, 6));
  assert.ok(legalMoves(missed).some((tile) => tile.capture && tile.x === 4 && tile.y === 5 && foe(missed, 'bat').offBalance));
  const punished = act(missed, move(4, 5));
  assert.equal(punished.captures, 1);
  assert.equal(punished.enemies.length, 0);
  assert.equal(punished.hits, 0);
});

test('off-balance lasts only until the end of your next move: waiting spends it too', () => {
  const missed = act(baited(), move(4, 6));
  assert.equal(foe(missed, 'bat').offBalance, true);
  const waited = act(missed, wait);
  const bat = foe(waited, 'bat');
  assert.equal(bat.offBalance, undefined);
  // Recovered, it guards again wherever its turn took it: ending beside it is a close-range hit.
  const beside = { x: bat.x < 7 ? bat.x + 1 : bat.x - 1, y: bat.y };
  assert.equal(closeAttacker(waited, beside)?.id, 'bat');
});

test('an off-balance monster pawn can’t capture en passant', () => {
  const state = scenario({ piece: 'pawn' });
  state.enemies = [{ ...monster('pawn', 'pawn', 5, 4), offBalance: true }];
  const next = act(state, move(4, 4));
  assert.equal(next.hits, 0);
  assert.equal(count(next, 'close-capture'), 0);
});

test('a lunge at a pawn that steps forward lands on the square behind it', () => {
  const state = scenario({ piece: 'pawn', at: [4, 5] });
  state.player.moved = true;
  state.enemies = [monster('knight', 'knight', 2, 4, [{ x: 4, y: 5 }])];
  const next = act(state, move(4, 4));
  const knight = foe(next, 'knight');
  assert.deepEqual([knight.x, knight.y], [4, 5], 'it lands on the square the pawn left');
  assert.equal(knight.offBalance, true);
  assert.equal(next.hits, 0);
});

test('a royal king that misses and won’t land in danger stays put, off-balance', () => {
  const state = scenario({ at: [4, 6], floor: 2 });
  state.enemies = [monster('king', 'king', 3, 5, [{ x: 4, y: 6 }])];
  // The rook steps back down its file, so the king's target is in its line.
  const missed = act(state, move(4, 7));
  const king = foe(missed, 'king');
  assert.deepEqual([king.x, king.y], [3, 5]);
  assert.equal(king.offBalance, true);
  assert.match(missed.message, /lunged and missed/);
  // Ending beside it is safe for this one move.
  const beside = act(missed, move(4, 6));
  assert.equal(beside.hits, 0);
  assert.equal(count(beside, 'close-capture'), 0);
});

test('black: the miss comes before your move, which it can’t punish; it recovers when your move ends', () => {
  const state = baited({ color: 'black' });
  Object.assign(state.player, { x: 4, y: 6 });
  // Clicked beside the bat's landing square; the bat lunges at (4,5) first.
  const next = act(state, move(5, 6));
  assert.equal(next.awaitingPlayer, false);
  assert.deepEqual([next.player.x, next.player.y], [5, 6]);
  assert.equal(next.hits, 0);
  assert.equal(count(next, 'close-capture'), 0);
  assert.equal(foe(next, 'bat').offBalance, undefined);
  assert.match([...(next.notes ?? []), next.message].join(' '), /lunged and missed/);
});

test('a Take-back returns to the off-balance position', () => {
  const state = baited(); state.powers.takeback = 1;
  const missed = act(state, move(4, 6));
  const moved = act(missed, move(1, 6));
  assert.equal(foe(moved, 'bat').offBalance, undefined);
  const back = act(moved, { type: 'takeback' });
  assert.equal(foe(back, 'bat').offBalance, true);
  assert.deepEqual([back.player.x, back.player.y], [4, 6]);
});

test('saves keep the off-balance flag and reject a malformed one', () => {
  // A room with its target and a decoy in the far corners, neither winding up at the start.
  const daily = withRooms(dailyFor('rook'), room({ enemies: [{ x: 0, y: 0, cast: 0 }, { x: 7, y: 0, cast: 1 }] }));
  const state = createGame(daily);
  const index = state.enemies.findIndex((entry) => entry.phase === 'ready');
  state.enemies[index].offBalance = true;
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date, daily), true);
  for (const bad of [{ offBalance: false }, { offBalance: 1 }, { offBalance: true, phase: 'aim', target: { x: 4, y: 6 }, intent: [{ x: 4, y: 6 }] }]) {
    const tampered = structuredClone(state);
    Object.assign(tampered.enemies[index], bad);
    assert.equal(validateSave(tampered, daily.date, daily), false, JSON.stringify(bad));
  }
});
