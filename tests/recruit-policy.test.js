// SPDX-License-Identifier: GPL-3.0-only
// The steering policy scripts/measure-recruits.mjs gives the human-like bot
// (scripts/recruit-policy.mjs): measurement only, the shipped bot stays on Auto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, recruitChoice } from '../src/rules.js';
import { candidateFor } from '../src/generation.js';
import { knobsFor, tierForDate } from '../src/difficulty.js';
import { humanPlayer, observe } from '../src/human-bot.js';
import { steerRecruit } from '../scripts/recruit-policy.mjs';

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
