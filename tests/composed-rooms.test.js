// SPDX-License-Identifier: GPL-3.0-only
// Composed rooms (src/composer.js, the dev-only preview): the player's start
// square and held decoys, as src/rules.js sets up a composed floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

// A composed day whose first floor is an open room: the player starts on g2,
// the floor's target waits in the far corner and a bishop decoy stands on f3,
// one diagonal step from the start (held for `held` moves, if given).
function day(held) {
  const daily = getRawDaily('2026-11-15');
  const bishop = { ...daily.species[3], piece: 'bishop' };
  const decoy = { x: 5, y: 5, species: bishop, ...(held && { held }) };
  const room = { map: Array(8).fill('........'), start: { x: 6, y: 6 }, enemies: [{ x: 0, y: 0, cast: 0 }, decoy], items: [] };
  return createGame({ ...daily, composed: [room, room, room] });
}

test('a composed room starts the player on its start square', () => {
  const state = day();
  assert.deepEqual([state.player.x, state.player.y], [6, 6]);
  assert.deepEqual([state.floorSnapshot.player.x, state.floorSnapshot.player.y], [6, 6], 'a restart returns there');
});

test('a pawn stuck under a monster pawn on its own file is cornered on a composed day', () => {
  // 2027-01-19 is a pawn day whose floor-1 targets are pawns: one waits on f7,
  // frozen there while the player's pawn stands on the f-file; one on a8.
  const daily = getRawDaily('2027-01-19');
  assert.equal(daily.playerPiece, 'pawn');
  const room = { map: Array(8).fill('........'), start: { x: 5, y: 3 }, enemies: [{ x: 5, y: 1, cast: 0 }, { x: 0, y: 0, cast: 0 }], items: [] };
  const state = act(createGame({ ...daily, composed: [room, room, room] }), { type: 'move', x: 5, y: 2 });
  assert.ok(state.events.some((event) => event.type === 'restart'), 'on f6 under the frozen pawn, no move is left: cornered');
});

test('a held decoy stays asleep at the floor start, even beside the player', () => {
  const awake = day().enemies.find((foe) => foe.x === 5 && foe.y === 5);
  assert.equal(awake.phase, 'aim', 'an awake bishop on f3 winds up at g2');
  const asleep = day(4).enemies.find((foe) => foe.x === 5 && foe.y === 5);
  assert.deepEqual([asleep.phase, asleep.intent, asleep.target, asleep.pinned, asleep.held], ['ready', [], null, 4, true]);
});

// Pawn players (src/composer.js): floors 1–2 are tempo lines with a hint on
// the key square, or crown lines where a tempo line would have none; the king
// floor mixes three mates (PAWN_MATES), and whichever is planted, the pawn
// can always walk up its file and promote there. On floors 1–2 no wall and no
// decoy pawn stands on its file above the start: sleeping decoys box the
// pockets there and step off once awake (a target pawn may wait there, held
// by the pawn's own file until it takes elsewhere). No monster starts on the
// player's square or takes it at once, and each day wins as played, never
// captured.
// 2026-11-28 has a crown floor and both's mate, 2026-12-15 a crown floor and
// the recruit king's, 2026-12-21 a crown floor and the queen's.
test('a pawn player composes days that mix tempo and crown floors and three mates', async () => {
  const { composeDay } = await import('../src/composer.js');
  const { act, closeAttacker } = await import('../src/rules.js');
  const seen = { crown: 0, tempo: 0, mates: new Set() };
  for (const date of ['2026-11-28', '2026-12-15', '2026-12-21']) {
    assert.equal(getRawDaily(date).playerPiece, 'pawn');
    const { daily, floors } = composeDay(date);
    for (const floor of floors.slice(0, 2)) {
      assert.ok(floor.motif === 'crown' || (floor.motif === 'tempo' && floor.hint), `${date}: a hinted tempo floor, or a crown one`);
      seen[floor.motif]++;
    }
    assert.equal(floors[2].motif, 'net');
    seen.mates.add(floors[2].mate);
    for (const floor of floors) assert.ok(floor.line.length >= 3 && floor.line.length <= 4, `${date}: a 3–4 move line`);
    let state = createGame(daily);
    for (const floor of floors) {
      assert.ok(!state.enemies.some((foe) => foe.x === state.player.x && foe.y === state.player.y) && !closeAttacker(state, state.player), `${date}: a safe start`);
      const file = Array.from({ length: state.player.y }, (_, y) => ({ x: state.player.x, y }));
      const standing = (tile) => state.enemies.find((foe) => foe.x === tile.x && foe.y === tile.y);
      if (state.floor === 2) assert.ok(file.every((tile) => state.map[tile.y][tile.x] !== '#' && !standing(tile)), `${date}: the king floor's pawn can promote`);
      else assert.ok(file.every((tile) => state.map[tile.y][tile.x] !== '#' && (standing(tile)?.role !== 'pawn' || standing(tile).role === state.objective.piece)), `${date}: floor ${state.floor + 1}'s file holds no wall and no decoy pawn`);
      for (const action of [...floor.line, { type: 'descend' }]) {
        const next = act(state, action);
        assert.ok(next !== state && next.hits === state.hits, `${date}: never captured`);
        state = next;
      }
    }
    assert.equal(state.status, 'won');
  }
  assert.ok(seen.crown >= 2 && seen.tempo >= 2, 'both kinds of floor');
  assert.deepEqual([...seen.mates].sort(), ['both', 'king', 'queen']);
});

// Ice and Breach days keep their modifier on composed floors (src/composer.js).
// Two Ice bishop days. 2026-11-24: its first floor's line aims one square
// short of the key square, on ice, and skids onto it ('skid'), and so does
// its king floor's mate; its second floor is a Tandem, whose ice lies off the
// line ('off'). 2026-12-17: on its second floor the key square is ice too, so
// a move aimed straight at it skids past and only the skid stops there
// ('lock'). Every room lays its own ice, never on a wall, under a monster, on
// the start or on the exit, and each day wins as played, never captured.
test('an Ice day lays each composed room’s ice around its planted line', async () => {
  const { composeDay } = await import('../src/composer.js');
  const { ICE_TILES } = await import('../src/modifiers.js');
  for (const [date, kinds, partner] of [['2026-11-24', ['skid', 'off', 'skid'], 1], ['2026-12-17', ['off', 'lock', 'off'], undefined]]) {
    const { daily, floors } = composeDay(date);
    assert.equal(daily.modifier, 'ice');
    assert.deepEqual(floors.map((floor) => floor.ice), kinds, date);
    assert.equal(daily.generation.partner, partner, date);
    let state = createGame(daily);
    for (const floor of floors) {
      assert.deepEqual(state.ice, daily.composed[state.floor].ice, 'the room’s own ice, not the seeded draw');
      assert.equal(state.ice.length, ICE_TILES);
      const start = { ...state.player };
      for (const tile of state.ice) {
        assert.notEqual(state.map[tile.y][tile.x], '#');
        assert.ok(!state.enemies.some((foe) => foe.x === tile.x && foe.y === tile.y), 'never under a monster');
        assert.ok(!(tile.x === start.x && tile.y === start.y) && !(tile.x === 4 && tile.y === 0), 'never on the start or the exit');
      }
      const hint = floor.room.items.find((item) => item.hint);
      const skids = [];
      for (const action of [...floor.line, { type: 'descend' }]) {
        const next = act(state, action);
        assert.ok(next !== state && next.hits === state.hits, 'never captured');
        const slide = next.events.find((event) => event.type === 'slide');
        if (slide) {
          skids.push(slide);
          if (floor.ice === 'lock') {
            const direct = act(state, { type: 'move', x: slide.x, y: slide.y });
            assert.ok(direct.player.x !== slide.x || direct.player.y !== slide.y, 'aimed straight at the key square, you skid past it');
          }
        }
        state = next;
      }
      assert.equal(skids.length, floor.ice === 'off' ? 0 : 1);
      if (skids.length && hint) assert.deepEqual([skids[0].x, skids[0].y], [hint.x, hint.y], 'the skid lands on the hinted key square');
    }
    assert.equal(state.status, 'won', date);
  }
});

test('a composed room’s ice replaces the day’s seeded draw', () => {
  const daily = getRawDaily('2026-11-24');
  const room = { map: Array(8).fill('........'), enemies: [{ x: 0, y: 0, cast: 0 }], items: [] };
  assert.equal(createGame({ ...daily, composed: [room, room, room] }).ice.length, 8, 'a room without ice gets the seeded draw');
  const ice = [{ x: 4, y: 3 }, { x: 2, y: 5 }];
  assert.deepEqual(createGame({ ...daily, composed: [{ ...room, ice }, room, room] }).ice, [{ x: 4, y: 3 }, { x: 2, y: 5 }]);
  assert.deepEqual(createGame({ ...daily, composed: [{ ...room, ice: [] }, room, room] }).ice, []);
});

// No monster ever stands on a composed pawn player's file, so a Breach
// arrival comes in off it, even when the door square is free; published
// editions keep the door square. 2026-12-16 is a Breach pawn day.
test('a composed Breach day brings arrivals in off a pawn player’s file', async () => {
  const { arrivalSquare } = await import('../src/modifiers.js');
  const daily = getRawDaily('2026-12-16');
  assert.deepEqual([daily.modifier, daily.playerPiece], ['collapse', 'pawn']);
  const room = { map: Array(8).fill('........'), enemies: [{ x: 0, y: 3, cast: 0 }], items: [] };
  const state = createGame({ ...daily, composed: [room, room, room] });
  assert.deepEqual([state.player.x, state.player.y], [4, 6]);
  const square = arrivalSquare(state, 0);
  assert.ok(square.x !== 4 && Math.max(Math.abs(square.x - 4), square.y) === 1, 'beside the door, off the e-file');
  const { composed, ...published } = state;
  assert.deepEqual(arrivalSquare(published, 0), { x: 4, y: 0 }, 'a published edition’s arrival still takes the door square');
  assert.deepEqual(arrivalSquare({ ...state, player: { ...state.player, piece: 'queen' } }, 0), { x: 4, y: 0 }, 'once promoted, the door square again');
  // Ten moves in, the first arrival comes in beside the door (nobody stands on its square).
  const { collapseTick } = await import('../src/modifiers.js');
  const due = structuredClone(state);
  Object.assign(due, { turns: 10, message: '', events: [] });
  collapseTick(due);
  const arrival = due.events.find((event) => event.type === 'reinforcement');
  assert.ok(arrival && arrival.x !== 4, 'it came in off the e-file');
  assert.match(due.message, /^.+ stumbles in beside the door\.$/);
});

// Decoy pawns (src/composer.js DECOY_PAWN_CROWN) start on rank 6 or higher,
// five or more of their moves from crowning, so none has crowned when the
// planted line clears the floor, and none starts on rank 1 (target pawns are
// barricaded instead). 2028-09-17's second floor once had decoy pawns on e2
// (one move from crowning) and b1 (on its last rank); 2026-11-16, a rook day,
// one on b2. Neither day needs a bait guard pawn a rank lower.
test('composed decoy pawns start five or more moves from crowning', async () => {
  const { composeDay, DECOY_PAWN_CROWN } = await import('../src/composer.js');
  let seen = 0;
  for (const date of ['2028-09-17', '2026-11-16']) {
    const { daily, floors } = composeDay(date);
    floors.forEach((floor, f) => {
      const cast = [daily.species[f], daily.species[3 + f * 2], daily.species[4 + f * 2]];
      for (const foe of floor.room.enemies) {
        if (foe.cast === 0 || cast[foe.cast].piece !== 'pawn') continue;
        seen++;
        // A monster pawn marches down a rank a move, two from its seventh rank.
        const moves = 7 - foe.y - (foe.y === 1 ? 1 : 0);
        assert.ok(moves >= DECOY_PAWN_CROWN, `${date} floor ${f + 1}: a decoy pawn on ${'abcdefgh'[foe.x]}${8 - foe.y} crowns in ${moves}`);
      }
    });
  }
  assert.ok(seen >= 2, 'both days still have decoy pawns');
});
