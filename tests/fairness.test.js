// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, dangerTiles, legalMoves, PLAYABLE_PIECES as PIECES, royalRules, validateSave, walkable } from '../src/rules.js';
import { findWinningRoute, livesSpendable, verifyWinningRoute } from '../src/fairness.js';
import { generateDaily, getDaily, GENERATOR_VERSION } from '../src/generation.js';
import { TIER_IDS, knobsFor } from '../src/difficulty.js';

const move = (x, y) => ({ type: 'move', x, y });
const dates = new Map();
// Every daily is white; black is a practice choice.
for (let day = 0; dates.size < PIECES.length && day < 1000; day++) {
  const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
  assert.equal(daily.playerColor, 'white');
  dates.set(`${daily.playerPiece}:${daily.playerColor}`, daily.date);
}
assert.equal(dates.size, PIECES.length, 'fixtures cover every piece');

function monster(id, piece, x, y, target = null) {
  return {
    id, piece, role: piece, species: 'bat', name: 'Bat', x, y, moved: false,
    phase: target ? 'aim' : 'ready', target,
    intent: target ? Array.from({ length: 7 }, (_, index) => ({ x, y: index + 1 })) : [],
  };
}
function scenario(piece = 'rook', color = 'white') {
  // Kings are no longer a daily piece; engine tests borrow a rook day.
  // Black borrows a white day, as practice does.
  const raw = getRawDaily(dates.get(`${piece === 'king' ? 'rook' : piece}:white`));
  const state = createGame({ ...raw, playerPiece: piece, playerColor: color });
  state.enemies = []; state.items = []; state.map = Array(8).fill('........'); state.props = [];
  state.objective = { piece: 'king', complete: false };
  return state;
}
function replay(daily) {
  const initial = createGame(daily);
  let state = initial, promoted = false, revertedPromotion = false, threatenedDecisions = 0;
  for (const action of daily.generation.certificate.actions) {
    assert.ok(['move', 'descend', 'wait'].includes(action.type));
    if (action.type === 'move') {
      assert.ok(legalMoves(state).some((tile) => tile.x === action.x && tile.y === action.y));
      // Only the king floor's own recruit may help, and only under royal rules.
      assert.ok(!state.items.some((item) => (item.type === 'powerup' || (item.type === 'companion' && !royalRules(state))) && item.x === action.x && item.y === action.y));
      if (dangerTiles(state).length > 0) threatenedDecisions++;
    }
    const next = act(state, action);
    assert.notEqual(next, state, 'every certified action must do something');
    // Only a pawn's route may spend lives, and at most livesSpendable of them.
    assert.ok(next.player.hp >= initial.player.hp - livesSpendable(initial));
    assert.deepEqual(next.powers, { shield: 0, freeze: 0, magnet: 0 });
    assert.deepEqual(next.purchases, []);
    if (royalRules(next)) assert.ok(next.companion === null || ['rook', 'queen', 'king'].includes(next.companion.basePiece));
    else assert.equal(next.companion, null);
    assert.equal(next.companions?.length ?? 0, 0);
    assert.deepEqual(next.companionOrders, []);
    assert.ok(!next.events.some((event) => ['restart', 'powerup', 'shield', 'recruit', 'companion-order'].includes(event.type) || (event.type === 'player-captured' && !livesSpendable(initial)) || (event.type.startsWith('companion') && !royalRules(next))));
    assert.equal(validateSave(next, daily.date, daily), true, `${daily.date}: valid save after ${JSON.stringify(action)}`);
    if (next.events.some((event) => event.type === 'promotion')) promoted = true;
    if (next.floor !== state.floor && next.status === 'playing') {
      assert.equal(next.player.piece, initial.player.piece, 'each room starts with the original piece');
      if (state.player.piece !== initial.player.piece) revertedPromotion = true;
    }
    state = next;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.records.length, 3);
  assert.ok(state.turns <= 60);
  assert.equal(state.turns, daily.generation.certificate.metrics.turns);
  assert.equal(threatenedDecisions, daily.generation.certificate.metrics.threatenedDecisions);
  return { initial, state, promoted, revertedPromotion };
}

test('forced fallbacks certify every piece and difficulty with the production rules', () => {
  for (const difficulty of TIER_IDS) {
    for (const [identity, date] of dates) {
      const daily = generateDaily(date, { difficulty, maxAttempts: 0 });
      const profile = knobsFor(difficulty, daily.playerPiece);
      assert.equal(`${daily.playerPiece}:${daily.playerColor}`, identity);
      assert.equal(daily.generation.version, GENERATOR_VERSION);
      assert.equal(daily.generation.source, 'fallback');
      assert.equal(daily.generation.attempt, 0);
      for (const knob of ['obstacleBase', 'decoys', 'scatter', 'guards', 'screens']) assert.equal(daily[knob], profile[knob], knob);
      assert.ok(daily.generation.certificate.metrics.threatenedDecisions >= profile.minThreatenedDecisions);
      const { initial } = replay(daily);
      assert.equal(initial.schema, 6);
      assert.equal(initial.rulesVersion, 6);
      const proof = verifyWinningRoute(initial, daily.generation.certificate.actions);
      assert.equal(proof.valid, true, `${difficulty}:${identity}: ${proof.reason}`);
      assert.deepEqual(proof.metrics, daily.generation.certificate.metrics);
    }
  }
});

test('the full certificate permits promotion and the promoted pawn reverts between rooms', () => {
  for (const color of ['white']) {
    const daily = generateDaily(dates.get(`pawn:${color}`), { maxAttempts: 0 });
    const result = replay(daily);
    assert.equal(result.promoted, true);
    assert.equal(result.revertedPromotion, true);
    assert.equal(daily.generation.certificate.metrics.promotion, true);
  }
});

test('certificates reject tampered moves, omitted extraction, extra actions, purchases and automatic relics', () => {
  const daily = generateDaily(dates.get('rook:white'), { maxAttempts: 0 });
  const initial = createGame(daily);
  const actions = daily.generation.certificate.actions;
  assert.equal(actions.at(-1).type, 'descend');
  for (const tampered of [
    [], actions.slice(0, -1), actions.slice(1),
    [move(-1, 4), ...actions], [{ type: 'descend' }, ...actions],
    [{ type: 'buy', id: 'shield' }, ...actions], [...actions, actions[0]],
  ]) assert.equal(verifyWinningRoute(initial, tampered).valid, false);
  for (const power of ['shield', 'freeze', 'magnet']) {
    const powered = structuredClone(initial); powered.powers[power] = 1;
    assert.equal(verifyWinningRoute(powered, actions).valid, false);
    const pickup = structuredClone(initial);
    pickup.items.push({ ...actions[0], type: 'powerup', power });
    const proof = verifyWinningRoute(pickup, actions);
    assert.equal(proof.valid, false);
    assert.match(proof.reason, /powerup/);
  }
  const bought = structuredClone(initial); bought.purchases = ['freeze'];
  assert.equal(verifyWinningRoute(bought, actions).valid, false);
});

test('active companions and companion pickups cannot support a no-powerup certificate', () => {
  const state = scenario();
  const action = move(4, 5);
  state.companion = { piece: 'queen', basePiece: 'queen', x: 3, y: 6, moved: false, sharing: false };
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
  assert.deepEqual(findWinningRoute(state), { status: 'unknown', explored: 0 });
  state.companion = null;
  state.items = [{ type: 'companion', piece: 'queen', x: action.x, y: action.y }];
  const recruited = act(state, action);
  assert.ok(recruited.companion);
  assert.ok(recruited.events.some((event) => event.type === 'companion-recruit'));
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
});

test('certified saves reject edited turn order, legacy mode and earlier rules versions', () => {
  // A black edition, as practice builds one from a white day.
  const daily = { ...getRawDaily(dates.get('rook:white')), playerColor: 'black' };
  const initial = createGame(daily);
  assert.equal(validateSave(initial, daily.date, daily), true);
  for (const mutate of [
    (state) => { state.playerColor = 'white'; },
    (state) => { state.legacyTurnOrder = true; },
    (state) => { state.playerColor = 'white'; state.legacyTurnOrder = true; },
    (state) => { state.schema = 4; },
    (state) => { state.rulesVersion = 4; },
  ]) {
    const modified = structuredClone(initial); mutate(modified);
    assert.equal(validateSave(modified, daily.date, daily), false);
  }
});

test('life loss and restart are rejected even when moves are legal and spare lives remain', () => {
  const state = scenario();
  state.enemies = [monster('attacker', 'rook', 4, 0, { x: 4, y: 6 })];
  const action = move(4, 5);
  const damaged = act(state, action);
  assert.ok(damaged.events.some((event) => event.type === 'player-captured'));
  assert.equal(damaged.player.hp, state.player.hp - 1);
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
  state.player.hp = 1;
  const restarted = act(state, action);
  assert.ok(restarted.events.some((event) => event.type === 'restart'));
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
});

test('obstacles are enforced while gameplay has no move deadline', () => {
  const state = scenario();
  state.map[5] = '....#...';
  assert.equal(verifyWinningRoute(state, [move(4, 4)]).valid, false);
  state.map[5] = '........';
  state.maxTurns = 1;
  const expired = act(state, move(4, 4));
  assert.equal(expired.status, 'playing');
  assert.equal(verifyWinningRoute(state, [move(4, 4)]).valid, false);
});

test('connected geometry is insufficient when an enemy-first attack makes every move fatal', () => {
  const state = scenario('king', 'black');
  state.map[7] = '#.......';
  state.enemies = [monster('attacker', 'rook', 4, 0, { x: 4, y: 6 })];
  const visited = new Set(['4,6']), queue = [{ x: 4, y: 6 }];
  for (const tile of queue) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = tile.x + dx, y = tile.y + dy, key = `${x},${y}`;
      if (walkable(state, x, y) && !visited.has(key)) { visited.add(key); queue.push({ x, y }); }
    }
  }
  assert.equal(visited.size, 63, 'every open square is geometrically reachable');
  assert.ok(legalMoves(state).length > 0);
  for (const action of legalMoves(state)) {
    const next = act(state, { ...action, type: 'move' });
    assert.ok(next.events.some((event) => event.type === 'restart'));
  }
  const result = findWinningRoute(state, { maxExpansions: 100, beamWidth: 4 });
  assert.equal(result.status, 'unknown', 'bounded failure must never be called a proof of impossibility');
  assert.ok(result.explored <= 100);
});

test('enemy-first re-selection advances enemy state once without spending a player move', () => {
  const state = scenario('rook', 'black');
  state.enemies = [monster('blocker', 'rook', 0, 3)];
  const first = move(4, 0), second = move(5, 6);
  assert.ok(legalMoves(state).some((tile) => tile.x === first.x && tile.y === first.y));
  const awaiting = act(state, first);
  assert.equal(awaiting.awaitingPlayer, true);
  assert.equal(awaiting.turns, 0);
  assert.ok(awaiting.events.some((event) => event.type === 'enemy-phase'));
  const moved = act(awaiting, second);
  assert.equal(moved.awaitingPlayer, false);
  assert.equal(moved.turns, 1);
  assert.ok(!moved.events.some((event) => event.type === 'enemy-phase'));
  const partial = verifyWinningRoute(state, [first, second]);
  assert.equal(partial.valid, false);
  assert.match(partial.reason, /does not complete/, 'the verifier accepts both transitions but still requires all three rooms');
});

test('deterministic bounded search reports unknown on exhaustion and does not mutate its input', () => {
  const state = scenario();
  const before = structuredClone(state);
  assert.deepEqual(findWinningRoute(state, { maxExpansions: 0 }), { status: 'unknown', explored: 0 });
  const first = findWinningRoute(state, { maxExpansions: 50, beamWidth: 4 });
  assert.deepEqual(findWinningRoute(state, { maxExpansions: 50, beamWidth: 4 }), first);
  assert.ok(first.explored <= 50);
  assert.deepEqual(state, before);
  assert.throws(() => findWinningRoute(state, { maxExpansions: -1 }), RangeError);
  assert.throws(() => findWinningRoute(state, { beamWidth: 0 }), RangeError);
});

test('daily certificates use UTC, are deterministic and cannot be corrupted through the cache', () => {
  const date = '2026-11-05';
  const daily = getDaily(date);
  assert.deepEqual(getDaily(new Date('2026-11-04T20:00:00-04:00')), daily);
  assert.deepEqual(generateDaily(date), daily);
  const pristine = structuredClone(daily);
  daily.species[0].piece = 'invalid';
  daily.targets[0] = 'invalid';
  daily.generation.certificate.actions[0].x = -1;
  daily.generation.certificate.metrics.turns = -1;
  assert.deepEqual(getDaily(date), pristine);
  assert.throws(() => getDaily('2026-02-31'), /Invalid daily date/);
  assert.throws(() => generateDaily(date, { difficulty: 'invalid' }), RangeError);
  assert.throws(() => generateDaily(date, { maxAttempts: -1 }), RangeError);
});


test('mutating a returned fallback certificate cannot poison later forced generations', () => {
  const date = dates.get('rook:white');
  const daily = generateDaily(date, { maxAttempts: 0 });
  const pristine = structuredClone(daily);
  daily.generation.certificate.actions[0].x = -1;
  daily.generation.certificate.actions.pop();
  daily.generation.certificate.metrics.turns = -1;
  daily.targets[0] = 'invalid';
  assert.deepEqual(generateDaily(date, { maxAttempts: 0 }), pristine);
});
