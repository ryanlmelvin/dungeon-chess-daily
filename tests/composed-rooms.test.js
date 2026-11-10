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
