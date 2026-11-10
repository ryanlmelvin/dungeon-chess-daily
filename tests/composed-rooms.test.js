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
