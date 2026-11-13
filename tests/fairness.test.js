// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, dangerTiles, legalMoves, PLAYABLE_PIECES as PIECES, royalRules, validateSave, walkable, RULES_VERSION } from '../src/rules.js';
import { findFloorRoute, spendableHits, verifyWinningRoute } from '../src/fairness.js';
import { generateDaily, getDaily, proveComposed, certificateMode, GENERATOR_VERSION } from '../src/generation.js';
import { EDITIONS } from '../src/editions.js';
import { DAILY_TIER } from '../src/difficulty.js';
import { withRooms } from './fixtures/rooms.js';

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
  const state = createGame(withRooms({ ...raw, playerPiece: piece, playerColor: color }));
  state.enemies = []; state.items = []; state.map = Array(8).fill('........'); state.props = [];
  state.objective = { piece: 'king', complete: false };
  return state;
}
// A composed day's twin without its hint powerups: what the certificate is proved on
// (src/generation.js proveComposed), since a certified route collects no powerup.
const twinOf = (daily) => ({ ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) });
function replay(edition) {
  const daily = twinOf(edition);
  // The day's partner floor (a Tandem), where the floor's recruit joins and takes orders; null on a day without one.
  const partner = daily.generation.partner ?? null;
  const initial = createGame(daily);
  let state = initial, promoted = false, revertedPromotion = false, threatenedDecisions = 0;
  for (const action of daily.generation.certificate.actions) {
    assert.ok(['move', 'descend', 'wait'].includes(action.type));
    const partnered = state.floor === partner;
    assert.ok(action.recruit === undefined || (partnered && action.type !== 'descend'), 'only a partner floor\'s moves carry recruit orders');
    if (action.type === 'move') {
      assert.ok(legalMoves(state).some((tile) => tile.x === action.x && tile.y === action.y));
      // Only the king floor's own recruit may help under royal rules, and a partner floor's on that floor.
      assert.ok(!state.items.some((item) => (item.type === 'powerup' || (item.type === 'companion' && !royalRules(state) && !partnered)) && item.x === action.x && item.y === action.y));
      if (dangerTiles(state).length > 0) threatenedDecisions++;
    }
    const next = act(state, action);
    assert.notEqual(next, state, 'every certified action must do something');
    // Only a pawn's route may be captured, and at most spendableHits times.
    assert.ok(next.hits <= spendableHits(initial));
    assert.deepEqual(next.powers, { shield: 0, freeze: 0, magnet: 0, pin: 0, leap: 0, takeback: 0 });
    assert.deepEqual(next.purchases, []);
    if (royalRules(next)) assert.ok(next.companion === null || next.companion.basePiece === 'king');
    else if (next.floor !== partner) assert.equal(next.companion, null);
    assert.equal(next.companions?.length ?? 0, 0);
    assert.ok(!next.events.some((event) => ['restart', 'powerup', 'shield', 'recruit'].includes(event.type) || (event.type === 'player-captured' && !spendableHits(initial)) || (event.type.startsWith('companion') && !royalRules(state) && !partnered)));
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

test('stored editions of every daily piece and modifier certify with the production rules', () => {
  const seen = new Set();
  // Every piece on plain, Ice, Crumbling floor and Gates days, but a bishop's crumbling floor: its terrain day is always Gates.
  const kinds = PIECES.length * 4 - 1;
  for (let day = 0; seen.size < kinds && day < 700; day++) {
    const raw = getRawDaily(new Date(Date.UTC(2026, 10, 1 + day)));
    const kind = `${raw.playerPiece}:${raw.modifier ?? 'none'}`;
    if (seen.has(kind)) continue;
    seen.add(kind);
    const daily = getDaily(raw.date);
    assert.equal(daily.generation.version, GENERATOR_VERSION);
    assert.equal(daily.generation.source, 'composed');
    assert.equal(daily.difficulty, DAILY_TIER);
    const { initial } = replay(daily);
    assert.equal(initial.schema, RULES_VERSION);
    assert.equal(initial.rulesVersion, RULES_VERSION);
    // Verified as the day is proved: the recruit steered on a day with a partner floor (src/generation.js proveComposed).
    const proof = verifyWinningRoute(initial, daily.generation.certificate.actions, certificateMode(daily.generation.partner));
    assert.equal(proof.valid, true, `${kind}: ${proof.reason}`);
    assert.deepEqual(proof.metrics, daily.generation.certificate.metrics);
    assert.equal(proof.metrics.hits, 0, `${kind}: planted lines are never captured`);
  }
  assert.equal(seen.size, kinds, 'every piece on every kind of day it can draw');
  assert.ok(!seen.has('bishop:cracks'));
});

test('a stored Tandem day certifies with its recruit on orders, on its partner floor alone', () => {
  // The first stored day with a partner floor on floor 1, and the first with one on floor 2.
  for (const floor of [0, 1]) {
    const date = Object.keys(EDITIONS).find((day) => EDITIONS[day].partner === floor);
    assert.ok(date, `a stored day whose floor ${floor + 1} is a partner floor`);
    const daily = getDaily(date), { actions } = daily.generation.certificate;
    assert.equal(daily.generation.partner, floor);
    assert.equal(daily.generation.motifs[floor], 'tandem');
    replay(daily);
    const initial = createGame(twinOf(daily));
    // Without orders the verifier refuses the line; steered, it proves, and the recruit took one target of the two.
    assert.equal(verifyWinningRoute(initial, actions).valid, false, `${date}: a route whose recruit moves itself carries no order`);
    const proof = verifyWinningRoute(initial, actions, certificateMode(floor));
    assert.equal(proof.valid, true, `${date}: ${proof.reason}`);
    assert.deepEqual(proof.metrics, daily.generation.certificate.metrics);
    assert.ok(proof.metrics.recruit.orders >= 2, `${date}: the line posts the recruit, then sends it`);
    assert.equal(proof.metrics.recruit.targetCaptures, 1, `${date}: the recruit takes one twin`);
    assert.equal(proof.metrics.recruit.clears, 0, `${date}: and you take the other`);
    // The day proves with its partner floor named, and with no other.
    assert.equal(proveComposed(daily, actions, { saves: true, partner: floor }).valid, true, date);
    assert.equal(proveComposed(daily, actions, { saves: true }).valid, false, `${date}: unnamed, the orders are refused`);
    assert.equal(proveComposed(daily, actions, { partner: 1 - floor }).valid, false, `${date}: the recruit helps on its own floor alone`);
    // The orders sit on the partner floor's moves and nowhere else.
    let at = 0;
    for (const action of actions) {
      if (action.recruit !== undefined) assert.equal(at, floor, `${date}: an order on floor ${at + 1}`);
      if (action.type === 'descend') at++;
    }
  }
});

test('the full certificate permits promotion and the promoted pawn reverts between rooms', () => {
  // A pawn day whose planted lines crown on floor 1 or 2 (a crown line).
  let daily = null;
  for (let day = 0; !daily && day < 400; day++) {
    const raw = getRawDaily(new Date(Date.UTC(2026, 10, 1 + day)));
    if (raw.playerPiece !== 'pawn') continue;
    const edition = getDaily(raw.date);
    const crowned = (() => { let state = createGame(twinOf(edition)); for (const action of edition.generation.certificate.actions) { const next = act(state, action); if (next.floor === state.floor && next.floor < 2 && next.events.some((event) => event.type === 'promotion')) return true; state = next; } return false; })();
    if (crowned) daily = edition;
  }
  assert.ok(daily, 'some pawn day crowns before the king floor');
  const result = replay(daily);
  assert.equal(result.promoted, true);
  assert.equal(result.revertedPromotion, true);
  assert.equal(daily.generation.certificate.metrics.promotion, true);
});

test('certificates reject tampered moves, omitted extraction, extra actions, purchases and automatic relics', () => {
  // A rook day without a partner floor, and one with: tampering fails either way the day is verified.
  const rookDays = Object.keys(EDITIONS).filter((day) => getRawDaily(day).playerPiece === 'rook');
  for (const date of [rookDays.find((day) => EDITIONS[day].partner === undefined), rookDays.find((day) => EDITIONS[day].partner !== undefined)]) {
    assert.ok(date);
    const daily = twinOf(getDaily(date)), mode = certificateMode(daily.generation.partner);
    const initial = createGame(daily);
    const actions = daily.generation.certificate.actions;
    assert.equal(actions.at(-1).type, 'descend');
    assert.equal(verifyWinningRoute(initial, actions, mode).valid, true, date);
    // The line's first move: a relic laid on its square must spoil the proof.
    const first = actions.find((action) => action.type === 'move');
    for (const tampered of [
      [], actions.slice(0, -1), actions.slice(1),
      [move(-1, 4), ...actions], [{ type: 'descend' }, ...actions],
      [{ type: 'buy', id: 'shield' }, ...actions], [...actions, actions[0]],
    ]) assert.equal(verifyWinningRoute(initial, tampered, mode).valid, false, date);
    for (const power of ['shield', 'freeze', 'magnet']) {
      const powered = structuredClone(initial); powered.powers[power] = 1;
      assert.equal(verifyWinningRoute(powered, actions, mode).valid, false);
      const pickup = structuredClone(initial);
      pickup.items.push({ x: first.x, y: first.y, type: 'powerup', power });
      const proof = verifyWinningRoute(pickup, actions, mode);
      assert.equal(proof.valid, false);
      assert.match(proof.reason, /powerup/);
    }
    const bought = structuredClone(initial); bought.purchases = ['freeze'];
    assert.equal(verifyWinningRoute(bought, actions, mode).valid, false);
  }
});

test('active companions and companion pickups cannot support a no-powerup certificate', () => {
  const state = scenario();
  const action = move(4, 5);
  state.companion = { piece: 'queen', basePiece: 'queen', x: 3, y: 6, moved: false, sharing: false };
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
  assert.deepEqual(findFloorRoute(state), { status: 'unknown', explored: 0 });
  state.companion = null;
  state.items = [{ type: 'companion', piece: 'queen', x: action.x, y: action.y }];
  const recruited = act(state, action);
  assert.ok(recruited.companion);
  assert.ok(recruited.events.some((event) => event.type === 'companion-recruit'));
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
});

test('certified saves reject an edited turn order and earlier rules versions', () => {
  // A black edition, as practice builds one from a white day.
  const daily = { ...getDaily(dates.get('rook:white')), playerColor: 'black' };
  const initial = createGame(daily);
  assert.equal(validateSave(initial, daily.date, daily), true);
  for (const mutate of [
    (state) => { state.playerColor = 'white'; },
    (state) => { state.schema = 4; },
    (state) => { state.rulesVersion = 4; },
  ]) {
    const modified = structuredClone(initial); mutate(modified);
    assert.equal(validateSave(modified, daily.date, daily), false);
  }
});

test('a capture and a restart are rejected even when the moves are legal', () => {
  const state = scenario();
  state.enemies = [monster('attacker', 'rook', 4, 0, { x: 4, y: 6 })];
  const action = move(4, 5);
  const captured = act(state, action);
  assert.ok(captured.events.some((event) => event.type === 'player-captured'));
  assert.equal(captured.hits, state.hits + 1);
  assert.equal(verifyWinningRoute(state, [action]).valid, false);
  // A pawn walled in ahead has no move at all once it steps up: the try ends.
  const pawn = scenario('pawn');
  pawn.map[4] = '....#...';
  const restarted = act(pawn, action);
  assert.ok(restarted.events.some((event) => event.type === 'restart'));
  assert.equal(verifyWinningRoute(pawn, [action]).valid, false);
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

test('connected geometry is insufficient when an enemy-first attack makes every move a capture', () => {
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
    assert.ok(next.events.some((event) => event.type === 'player-captured'));
  }
  const result = findFloorRoute(state, { maxExpansions: 100, beamWidth: 4 });
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
  assert.deepEqual(findFloorRoute(state, { maxExpansions: 0 }), { status: 'unknown', explored: 0 });
  const first = findFloorRoute(state, { maxExpansions: 50, beamWidth: 4 });
  assert.deepEqual(findFloorRoute(state, { maxExpansions: 50, beamWidth: 4 }), first);
  assert.ok(first.explored <= 50);
  assert.deepEqual(state, before);
  assert.throws(() => findFloorRoute(state, { maxExpansions: -1 }), RangeError);
  assert.throws(() => findFloorRoute(state, { beamWidth: 0 }), RangeError);
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
});


test('mutating a returned edition cannot poison a later one of the same date', () => {
  const date = dates.get('rook:white');
  const daily = generateDaily(date);
  const pristine = structuredClone(daily);
  daily.generation.certificate.actions[0].x = -1;
  daily.generation.certificate.actions.pop();
  daily.generation.certificate.metrics.turns = -1;
  daily.composed[0].enemies.pop();
  daily.targets[0] = 'invalid';
  assert.deepEqual(generateDaily(date), pristine);
});
