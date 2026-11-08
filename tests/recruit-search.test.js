// SPDX-License-Identifier: GPL-3.0-only
// The certificate search's recruit modes (src/fairness.js RECRUIT_MODES).
// Every shipped certificate is 'auto': no recruit orders, and only the king
// floor's recruit may join. 'steer' (tooling) plays the recruit like a Manual
// player: every floor's recruit may join and each move or wait may carry an
// order, so the recruit may take targets, hop for the bishop pair, and never
// takes an order on a cleared floor 1 or 2, where it hunts on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, recruitChoice } from '../src/rules.js';
import { findFloorRoute, findWinningRoute, verifyWinningRoute, routeTransition, safeTransition } from '../src/fairness.js';
import { SEARCH_BUDGET, candidateFor, searchCandidate } from '../src/generation.js';
import { knobsFor, tierForDate } from '../src/difficulty.js';

const dayAfter = (start, day) => new Date(Date.parse(`${start}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
const candidate = (date, attempt = 0) => {
  const raw = getRawDaily(date), tier = tierForDate(date);
  return candidateFor(raw, tier, knobsFor(tier, raw.playerPiece), attempt);
};
function dailyFor(piece) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece && daily.playerColor === 'white' && (daily.modifier ?? 'none') === 'none') return daily;
  }
  throw Error(`No plain ${piece} edition found`);
}
const wall = (state, x, y) => { state.map[y] = state.map[y].slice(0, x) + '#' + state.map[y].slice(x + 1); };
// Floor 1 of a bishop day, emptied: the player's bishop on (4,6), a recruit
// waiting one bishop move away on (3,5), and the floor's only target, a knight
// walled in on (0,1). That square is the other colour, so the bishop can never
// take it, and the knight can neither move nor strike.
function unreachableTarget(recruitPiece) {
  const state = createGame(dailyFor('bishop'));
  state.map = Array(8).fill('........'); state.props = [];
  for (const [x, y] of [[1, 3], [2, 2], [2, 0]]) wall(state, x, y);
  state.enemies = [{ id: 'f0-0', species: 'bat', palette: 'ice', name: 'Ice bat', piece: 'knight', role: 'knight', x: 0, y: 1, moved: false, phase: 'ready', intent: [], target: null }];
  state.objective = { piece: 'knight', complete: false };
  state.items = [{ type: 'companion', piece: recruitPiece, x: 3, y: 5 }];
  return state;
}
const captures = (state, actions) => {
  const seen = [];
  for (const action of actions) {
    const next = act(state, action);
    seen.push(...next.events.filter((event) => event.type === 'capture' || event.type === 'companion-capture').map((event) => ({ ...event, action })));
    state = next;
  }
  return seen;
};

test('the default stays Auto: the same search, budget for budget, and no recruit metrics', () => {
  const game = createGame(candidate('2027-03-04'));
  const plain = findWinningRoute(game);
  assert.deepEqual(findWinningRoute(game, { recruit: 'auto' }), plain);
  assert.deepEqual(findWinningRoute(game, { recruit: 'auto', everyRecruit: false }), plain);
  const found = searchCandidate(candidate('2027-03-04'));
  assert.deepEqual(searchCandidate(candidate('2027-03-04'), SEARCH_BUDGET, { recruit: 'auto' }), found);
  assert.equal(found.metrics.recruit, undefined);
  assert.ok(found.actions.every((action) => action.recruit === undefined));
});

test('recruit modes are checked', () => {
  const game = createGame(candidate('2027-03-04'));
  for (const options of [{ recruit: 'manual' }, { recruit: 'Auto' }, { recruit: null }, { everyRecruit: 'yes' }, { recruit: 'steer', everyRecruit: 1 }]) {
    assert.throws(() => findWinningRoute(game, options), RangeError, JSON.stringify(options));
    assert.throws(() => findFloorRoute(game, options), RangeError, JSON.stringify(options));
    assert.throws(() => verifyWinningRoute(game, [], options), RangeError, JSON.stringify(options));
    assert.throws(() => routeTransition(game, { type: 'wait' }, options), RangeError, JSON.stringify(options));
    assert.throws(() => safeTransition(game, { type: 'wait' }, options), RangeError, JSON.stringify(options));
  }
});

test('a steered recruit takes a target the player can never reach; Auto never does', () => {
  const state = unreachableTarget('rook');
  assert.equal(findFloorRoute(state, { maxExpansions: 3000 }).status, 'unknown', 'Auto can’t even pick up a floor-1 recruit');
  assert.equal(findFloorRoute(state, { maxExpansions: 3000, everyRecruit: true }).status, 'unknown', 'on Auto it joins but never takes the target');
  const steered = findFloorRoute(state, { maxExpansions: 3000, recruit: 'steer' });
  assert.equal(steered.status, 'solved');
  const taken = captures(state, steered.actions);
  assert.deepEqual(taken.map((event) => [event.type, event.x, event.y]), [['companion-capture', 0, 1]]);
  assert.deepEqual(taken[0].action.recruit, { x: 0, y: 1 }, 'the capture is an order');
  assert.deepEqual([steered.actions[0].type, steered.actions[0].x, steered.actions[0].y], ['move', 3, 5], 'the route steps onto the recruit');
  assert.equal(steered.actions.at(-1).type, 'descend');
  assert.equal(steered.state.floor, 1, 'the stairs right after the clear');
  // The route replays exactly, and deterministically.
  assert.deepEqual(findFloorRoute(state, { maxExpansions: 3000, recruit: 'steer' }), steered);
  // A pawn recruit whose file is walled stops at the wall: steering can't help.
  const walled = unreachableTarget('pawn');
  wall(walled, 3, 3);
  assert.equal(findFloorRoute(walled, { maxExpansions: 1500, recruit: 'steer' }).status, 'unknown');
});

test('the bishop pair: a steered search picks the hop square, then takes the target from the other colour', () => {
  const state = unreachableTarget('bishop');
  assert.equal(findFloorRoute(state, { maxExpansions: 3000, everyRecruit: true }).status, 'unknown');
  const steered = findFloorRoute(state, { maxExpansions: 3000, recruit: 'steer' });
  assert.equal(steered.status, 'solved');
  let board = state;
  const frames = [];
  for (const action of steered.actions) { board = act(board, action); frames.push(board); }
  const hop = frames.flatMap((frame) => frame.events).find((event) => event.type === 'bishop-pair');
  assert.ok(hop, 'the recruit hopped');
  assert.notEqual((hop.x + hop.y) % 2, (4 + 6) % 2, 'onto the other colour');
  assert.deepEqual(captures(state, steered.actions).map((event) => [event.type, event.x, event.y]), [['companion-capture', 0, 1]]);
  // Every order was one the rules accept: replaying with them never stalls.
  assert.equal(frames.at(-1).floor, 1);
});

test('a steered route verifies only as steered, and reports what its recruit did', () => {
  let found = null;
  for (let day = 0; day < 40 && !found; day++) {
    const daily = candidate(dayAfter('2031-03-01', day));
    const route = findWinningRoute(createGame(daily), { recruit: 'steer' });
    if (route.status === 'solved' && route.actions.some((action) => action.recruit !== undefined)) found = { daily, route };
  }
  assert.ok(found, 'a steered route with orders');
  const { daily, route } = found;
  const proof = verifyWinningRoute(createGame(daily), route.actions, { recruit: 'steer' });
  assert.equal(proof.valid, true, proof.reason);
  const { recruit } = proof.metrics;
  assert.equal(recruit.orders, route.actions.filter((action) => action.recruit !== undefined).length);
  assert.ok(recruit.joined >= 1 && recruit.joined <= 3);
  assert.ok(recruit.targetCaptures >= recruit.clears && recruit.captures >= recruit.targetCaptures);
  // Auto certificates carry no orders: the default verifier refuses the same route.
  const refused = verifyWinningRoute(createGame(daily), route.actions);
  assert.equal(refused.valid, false);
  assert.match(refused.reason, /Only chess moves|collects a powerup or companion|uses a power/);
  // An order rides only a turn whose recruit phase takes one: never the
  // stairs, and never the move that clears floor 1 or 2, after which the
  // recruit hunts on its own and would ignore it (recruitChoice is null there).
  let state = createGame(daily);
  let earlyRecruit = false;
  for (const action of route.actions) {
    if (action.recruit !== undefined) {
      const { recruit: order, ...plain } = action;
      const choice = recruitChoice(state, plain);
      assert.ok(choice, 'the turn has a recruit phase');
      if (order !== 'hold') assert.ok(choice.moves.some((tile) => tile.x === order.x && tile.y === order.y), 'the order is one of its squares');
    }
    const next = act(state, action);
    if (state.floor < 2 && next.events.some((event) => event.type === 'companion-recruit')) earlyRecruit = true;
    state = next;
  }
  assert.equal(state.status, 'won');
  // An order on the stairs is refused even when steering.
  const tampered = route.actions.map((action) => (action.type === 'descend' ? { ...action, recruit: 'hold' } : action));
  assert.equal(verifyWinningRoute(createGame(daily), tampered, { recruit: 'steer' }).valid, false);
  // Without everyRecruit, a steered route may not use floors 1 and 2's recruits.
  if (earlyRecruit) assert.equal(verifyWinningRoute(createGame(daily), route.actions, { recruit: 'steer', everyRecruit: false }).valid, false);
});
