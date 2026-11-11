// SPDX-License-Identifier: GPL-3.0-only
// The human-like bot steers its recruit as a player on Manual recruit control
// (the default) would (src/recruit-policy.js), so its runs and its par come
// from steered runs. And like a person, the bot walks onto a relic standing in
// its pawn's way forward.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDaily } from '../src/generation.js';
import { getRawDaily } from '../src/edition.js';
import { createGame } from '../src/rules.js';
import { autoRecruit, certifiedFloors, defaultRecruit, humanGap, humanPar, observe, playFloor, runSeed } from '../src/human-bot.js';
import { steerRecruit } from '../src/recruit-policy.js';
import { withRooms } from './fixtures/rooms.js';

const dates = Array.from({ length: 6 }, (_, day) => new Date(Date.UTC(2026, 10, 7 + day)).toISOString().slice(0, 10));

test('the bot steers its recruit by default: its par and the human gap come from the steering policy', () => {
  assert.equal(defaultRecruit, steerRecruit);
  let differs = 0, ordered = 0;
  for (const date of dates) {
    const daily = getDaily(date);
    const human = humanPar(daily);
    assert.deepEqual(human, humanPar(daily, { recruit: steerRecruit }), date);
    // On Auto the same runs play out differently somewhere.
    const auto = humanPar(daily, { recruit: autoRecruit });
    if (JSON.stringify(auto.results) !== JSON.stringify(human.results)) differs++;
    if (humanGap(auto).total !== humanGap(human).total) differs++;
    const starts = certifiedFloors(daily).starts;
    for (let floor = 0; floor < 3; floor++) {
      const run = playFloor(starts[floor], { seed: runSeed(daily, floor, 0) });
      ordered += run.actions.filter((action) => action.recruit !== undefined).length;
      // Played again from its seed, a run comes out the same, recruit orders and all.
      assert.deepEqual(playFloor(starts[floor], { seed: runSeed(daily, floor, 0) }).actions, run.actions, `${date} floor ${floor + 1}`);
    }
  }
  assert.ok(ordered > 5, `${ordered} recruit orders in the runs`);
  assert.ok(differs > 0, 'steering changes some run');
});

// A bare pawn room: your pawn on (4, 6), monsters frozen, a target rook on (5, 1).
function pawnRoom() {
  let raw;
  for (let day = 0; day < 60 && !raw; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === 'pawn') raw = daily;
  }
  const state = createGame(withRooms(raw));
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.companion = null;
  delete state.modifier; delete state.ice; delete state.reinforcements; delete state.reinforcementsSkipped;
  state.objective = { piece: 'rook', complete: false };
  const target = state.species[state.floor];
  state.enemies = [{ id: 'target', species: target.id, palette: target.palette, name: target.name, piece: 'rook', role: 'rook', x: 5, y: 1, moved: true, phase: 'ready', intent: [], target: null }];
  state.powers.freeze = 6;
  return state;
}
const relic = (x, y) => ({ type: 'powerup', power: 'shield', x, y });

test('the bot walks onto a relic in its pawn’s way forward, as a person would, and keeps off every other', () => {
  const state = pawnRoom();
  // Ahead on its file (where a pawn day's relic lies), behind it, and on another file.
  state.items = [relic(4, 3), relic(4, 7), relic(5, 5)];
  const kept = (view) => view.powerups.map(({ x, y }) => `${x},${y}`).sort();
  assert.deepEqual(kept(observe(state)), ['4,7', '5,5']);
  // A promoted pawn is a queen: it goes round relics again.
  const crowned = structuredClone(state); crowned.player.piece = 'queen';
  assert.deepEqual(kept(observe(crowned)), ['4,3', '4,7', '5,5']);
  // So is any other piece.
  const rook = structuredClone(state); rook.player.piece = 'rook';
  assert.deepEqual(kept(observe(rook)), ['4,3', '4,7', '5,5']);
  // It walks up its file over the relic and takes the target, deterministically.
  const run = playFloor(state, { seed: 7, frames: true });
  assert.equal(run.won, true);
  const pickups = run.frames.flatMap((frame) => frame.events.filter((event) => event.type === 'powerup'));
  assert.deepEqual(pickups.map(({ x, y }) => [x, y]), [[4, 3]]);
  assert.deepEqual(playFloor(state, { seed: 7 }).actions, run.actions);
  // Before, the relic walled its file: with the relic gone the walk is the same.
  const clear = structuredClone(state); clear.items = [relic(4, 7), relic(5, 5)];
  assert.deepEqual(playFloor(clear, { seed: 7 }).actions, run.actions);
  // Stepping on it applies it, as for anyone.
  assert.equal(run.state.powers.shield, 1);
});
