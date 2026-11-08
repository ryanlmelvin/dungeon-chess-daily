// SPDX-License-Identifier: GPL-3.0-only
// How the human-like bot steers its recruit (src/recruit-policy.js), its
// default: par assumes a steered recruit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, recruitChoice } from '../src/rules.js';
import { candidateFor } from '../src/generation.js';
import { knobsFor, tierForDate } from '../src/difficulty.js';
import { humanPlayer, observe } from '../src/human-bot.js';
import { steerRecruit } from '../src/recruit-policy.js';

const dayAfter = (start, day) => new Date(Date.parse(`${start}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
const candidate = (date) => {
  const raw = getRawDaily(date), tier = tierForDate(date);
  return candidateFor(raw, tier, knobsFor(tier, raw.playerPiece), 0);
};
// The next floor's start, as if this one were cleared at once.
function nextFloor(state) {
  const cleared = structuredClone(state);
  cleared.enemies = []; cleared.exit = { ...cleared.exit, open: true };
  cleared.objective = { ...cleared.objective, complete: true, moves: 0 };
  return act(cleared, { type: 'descend' });
}

test('the bot’s steering policy only gives orders the rules accept, and only where the turn takes one', () => {
  let orders = 0, captures = 0;
  for (let day = 0; day < 6; day++) {
    const daily = candidate(dayAfter('2031-03-01', day));
    let start = createGame(daily);
    for (let floor = 0; floor < 3 && start.status === 'playing'; floor++, start = nextFloor(start)) {
      const player = humanPlayer(start, { seed: 11 + day * 3 + floor, recruit: steerRecruit });
      let state = start;
      for (let step = 0; step < 40 && state.status === 'playing' && state.floor === floor && !state.exit.open; step++) {
        const action = player.choose(state);
        if (action.recruit !== undefined) {
          orders++;
          const { recruit, ...plain } = action;
          assert.ok(recruitChoice(state, plain), 'an order only where the turn has a recruit phase');
        }
        const next = act(state, action);
        assert.notEqual(next, state, `${daily.date} floor ${floor + 1}: the action was refused`);
        if (next.events.some((event) => event.type === 'companion-capture')) captures++;
        player.saw(state, next);
        state = next;
      }
    }
  }
  assert.ok(orders > 10 && captures > 0, `${orders} orders, ${captures} recruit captures`);
});

test('the policy reads no hidden role: which monsters are targets comes from the view', () => {
  // A recruit beside two monsters, one of them the target species: it takes the target.
  const state = createGame(candidate('2031-03-02'));
  state.map = Array(8).fill('........'); state.props = []; state.items = [];
  Object.assign(state.player, { x: 7, y: 7, moved: true });
  state.companion = { piece: 'queen', basePiece: 'queen', x: 3, y: 4, moved: true, sharing: false };
  const target = state.species[state.floor];
  const monster = (id, species, x, y, role) => ({ id, species: species.id, palette: species.palette, name: species.name, piece: role, role, x, y, moved: true, phase: 'ready', intent: [], target: null });
  state.enemies = [monster('decoy', state.species[3], 3, 2, 'rook'), monster('target', target, 5, 4, state.objective.piece)];
  const view = observe(state);
  assert.deepEqual(steerRecruit(state, { type: 'wait' }, view), { x: 5, y: 4 });
  // Give the decoy the target's role in secret: the view, and so the order, stay the same.
  const disguised = structuredClone(state);
  disguised.enemies[0].role = disguised.enemies[0].piece = state.objective.piece;
  assert.deepEqual(steerRecruit(disguised, { type: 'wait' }, observe(disguised)), { x: 5, y: 4 });
});

// A bare room on floor 1 of a rook day with your rook at (7, 7), monsters frozen.
function room() {
  const date = Array.from({ length: 30 }, (_, day) => dayAfter('2031-03-01', day)).find((day) => getRawDaily(day).playerPiece === 'rook');
  const state = createGame(candidate(date));
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.companion = null;
  delete state.modifier; delete state.ice; delete state.reinforcements; delete state.reinforcementsSkipped;
  Object.assign(state.player, { x: 7, y: 7, moved: true });
  state.powers.freeze = 6;
  return state;
}
const monster = (species, id, x, y, role) => ({ id, species: species.id, palette: species.palette, name: species.name, piece: role, role, x, y, moved: true, phase: 'ready', intent: [], target: null });

test('the policy keeps the recruit rules: no capture the turn it joins, no orders once floor 1 or 2 is cleared', () => {
  const state = room();
  const target = state.species[state.floor], piece = state.objective.piece;
  // A queen recruit waits on (7, 4) with a lone target in its file: joining it can't take that target at once.
  state.items = [{ type: 'companion', piece: 'queen', x: 7, y: 4 }];
  state.enemies = [monster(target, 'target', 7, 1, piece)];
  const join = { type: 'move', x: 7, y: 4 };
  // Its order (or none: Auto that turn) is a quiet square or Hold, like every square on offer.
  const order = steerRecruit(state, join, observe(state));
  const offered = recruitChoice(state, join).moves;
  assert.ok(offered.length > 0 && offered.every((tile) => !tile.capture));
  assert.ok(order === undefined || order === 'hold' || offered.some((tile) => tile.x === order.x && tile.y === order.y), JSON.stringify(order));
  const joined = act(state, order === undefined ? join : { ...join, recruit: order });
  assert.notEqual(joined, state); assert.equal(joined.captures, 0);
  assert.ok(joined.enemies.some((foe) => foe.id === 'target'));
  // From the next move on it takes the target when it can.
  const next = steerRecruit(joined, { type: 'wait' }, observe(joined));
  assert.equal(typeof next, 'object', JSON.stringify(next));
  const taken = act(joined, { type: 'wait', recruit: next });
  assert.ok(!taken.enemies.some((foe) => foe.id === 'target'), JSON.stringify(next));
  assert.equal(taken.exit.open, true);
  // Floor 1 is clear: the recruit hunts on its own, so the policy gives no order.
  assert.equal(steerRecruit(taken, { type: 'wait' }, observe(taken)), undefined);
});
