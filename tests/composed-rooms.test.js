// SPDX-License-Identifier: GPL-3.0-only
// Composed rooms (src/composer.js, the dev-only preview): the player's start
// square and held decoys, as src/rules.js sets up a composed floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/rules.js';
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

test('a held decoy stays asleep at the floor start, even beside the player', () => {
  const awake = day().enemies.find((foe) => foe.x === 5 && foe.y === 5);
  assert.equal(awake.phase, 'aim', 'an awake bishop on f3 winds up at g2');
  const asleep = day(4).enemies.find((foe) => foe.x === 5 && foe.y === 5);
  assert.deepEqual([asleep.phase, asleep.intent, asleep.target, asleep.pinned, asleep.held], ['ready', [], null, 4, true]);
});
