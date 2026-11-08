// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves, resetFloor, scoredMoves, takebackTarget, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { candidateFor } from '../src/generation.js';
import { knobsFor, tierForDate } from '../src/difficulty.js';
import { findWinningRoute, verifyWinningRoute } from '../src/fairness.js';
import { playFloor } from '../src/human-bot.js';
import { tacticGold } from '../src/tactics.js';
import { modifierStatus } from '../src/modifiers.js';
import { CAVE_IN_MOVES, CAVE_IN_DEFAULT_MOVES, caveInMoves, caveInRunning, caveInStatus, cavedIn, goldAtRisk } from '../src/cave-in.js';

const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
const descend = { type: 'descend' };
const takeback = { type: 'takeback' };
const coin = (x, y) => ({ x, y, type: 'coin' });
const foe = (id, piece, x, y) => ({ id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: true, phase: 'ready', intent: [], target: null });
const caveEvent = (state) => state.events.find((event) => event.type === 'cave-in');
// Step a knight between (3,4) and (5,5), or wait, so moves and waits both count.
const shuffle = (state, n) => (n % 2 ? wait : state.player.x === 3 ? move(5, 5) : move(3, 4));

// An open, plain room: a knight on (4,6) opens the door by taking the king on
// (3,4). Monsters stay frozen unless a test thaws them.
function room({ difficulty = 'tricky', floor = 0, piece = 'knight', enemies = [], items = [], freeze = 9 } = {}) {
  const state = createGame(getRawDaily('2026-11-09'));
  for (const key of ['modifier', 'ice', 'reinforcements', 'reinforcementsSkipped']) delete state[key];
  Object.assign(state, { difficulty, floor, startingPiece: piece, playerColor: 'white', awaitingPlayer: false, enPassant: null, companion: null });
  state.player = { piece, x: 4, y: 6, hp: 2, maxHp: 2, moved: true };
  state.map = Array(8).fill('........'); state.props = []; state.items = items; state.enemies = enemies;
  state.objective = { piece: 'king', complete: false };
  state.powers.freeze = freeze;
  return state;
}

// One move or wait past the clear that keeps every life and leaves every
// pickup but coins alone: a coin when one is in reach, else a wait, else a move.
const hurts = (before, after) => after.player.hp < before.player.hp || after.events.some((event) => event.type === 'restart');
function safeStep(state) {
  const on = (tile, coins) => state.items.some((item) => (item.type === 'coin') === coins && item.x === tile.x && item.y === tile.y);
  const moves = legalMoves(state).filter((tile) => !on(tile, false));
  for (const tile of [...moves.filter((tile) => on(tile, true)), null, ...moves]) {
    const action = tile ? move(tile.x, tile.y) : wait;
    const next = act(state, action);
    if (next !== state && !hurts(state, next)) return { next, action };
  }
  return null;
}

// A real cave-in, built rather than stored: a real edition's floor 1 (a raw
// candidate layout, no certificate involved) cleared by the human-like bot,
// then played on past the clear (coins first, never another pickup, never a
// lost life) until the ceiling caves in, with gold at risk and the room's
// powerup still lying there. Certified routes never get this far: they take
// the stairs right after the clear.
let built;
function realCaveIn() {
  if (built) return built;
  for (let day = 0; day < 120; day++) {
    const date = new Date(Date.UTC(2027, 6, 2 + day)).toISOString().slice(0, 10);
    const raw = getRawDaily(date), tier = tierForDate(date);
    if (raw.modifier !== 'none') continue;
    const daily = candidateFor(raw, tier, knobsFor(tier, raw.playerPiece));
    for (let seed = 0; seed < 3; seed++) {
      const run = playFloor(createGame(daily), { seed, frames: true });
      if (!run.won) continue;
      const frames = [...run.frames], actions = [...run.actions];
      for (let state = frames.at(-1); state && !cavedIn(state);) {
        const step = safeStep(state);
        state = step?.next;
        if (step) { frames.push(step.next); actions.push(step.action); }
      }
      const before = frames.at(-2);
      if (cavedIn(frames.at(-1)) && goldAtRisk(before) > 0 && before.items.some((item) => item.type === 'powerup')) return (built = { date, daily, frames, actions });
    }
  }
  throw new Error('No real cave-in among the scanned dates.');
}

test('the open door starts a countdown set by the day’s tier, and every move or wait spends one', () => {
  assert.deepEqual({ ...CAVE_IN_MOVES }, { gentle: 7, fair: 6, tricky: 5, tough: 4, fiendish: 4 });
  for (const difficulty of ['gentle', 'fair', 'tricky', 'tough', 'fiendish', 'standard', 'constructor']) {
    const total = Object.hasOwn(CAVE_IN_MOVES, difficulty) ? CAVE_IN_MOVES[difficulty] : CAVE_IN_DEFAULT_MOVES;
    const shut = room({ difficulty, enemies: [foe('k', 'king', 3, 4)] });
    assert.equal(caveInRunning(shut), false);
    let state = act(shut, move(3, 4));
    assert.equal(state.exit.open, true);
    // Wait comes back for the countdown (main.js keys it to caveInRunning).
    assert.equal(caveInRunning(state), true);
    assert.equal(caveInMoves(state), total, difficulty);
    assert.deepEqual(state.caveIn, { moves: total, risk: 0, buried: 0 });
    assert.equal(caveInStatus(state), `🪨 Caving in ${total}`);
    assert.match(state.message, new RegExp(`It caves in after ${total} more moves, and gold you grab now is at risk until you take the stairs\\.$`));
    for (let left = total - 1; left >= 1; left--) {
      state = act(state, shuffle(state, left));
      assert.equal(state.caveIn.moves, left);
      assert.equal(caveInStatus(state), `🪨 Caving in ${left}`);
    }
    assert.equal(state.message, 'The ceiling is about to cave in!');
    // Frozen monsters don't hold the ceiling up.
    assert.ok(state.powers.freeze > 0);
    assert.equal(caveInRunning(state), true); assert.equal(cavedIn(state), false);
    state = act(state, wait);
    assert.equal(state.caveIn.moves, 0);
    assert.equal(caveInStatus(state), '🪨 Caved in');
    assert.equal(caveInRunning(state), false, 'Wait goes away again once it caves in');
    assert.deepEqual(caveEvent(state), { type: 'cave-in', x: state.player.x, y: state.player.y, gold: 0, coins: 0 });
    assert.equal(state.message, 'The ceiling caved in! It carries you down the stairs to the shop.');
    // The rubble carried you to the stairs: the room takes no more moves or waits.
    assert.equal(cavedIn(state), true);
    assert.deepEqual([state.floor, state.status, state.exit.open], [0, 'playing', true]);
    assert.deepEqual(legalMoves(state), []);
    assert.equal(act(state, wait), state);
    assert.equal(act(state, move(3, 4)), state);
    // The stairs finish the floor as if you'd taken them yourself.
    const below = act(state, descend);
    assert.deepEqual([below.floor, below.status, below.caveIn, below.records.length], [1, 'playing', undefined, 1]);
    assert.equal(below.records[0].scored, 1, 'only the move that cleared it counts');
  }
});

test('gold won after the door opens is at risk until the stairs bank it; the door-opening move’s own gold is safe', () => {
  // A coin lies under the king: taking it opens the door, so that coin is safe.
  let state = room({ enemies: [foe('k', 'king', 3, 4), foe('d', 'bishop', 6, 3)], items: [coin(3, 4), coin(5, 5)] });
  state = act(state, move(3, 4));
  assert.equal(state.gold, 1); assert.equal(goldAtRisk(state), 0);
  state = act(state, move(5, 5));
  assert.equal(state.gold, 2); assert.equal(goldAtRisk(state), 1);
  state = act(state, move(6, 3));
  assert.equal(state.gold, 3); assert.equal(goldAtRisk(state), 2);
  const below = act(state, descend);
  assert.equal(below.floor, 1); assert.equal(below.gold, 3);
  assert.equal(below.caveIn, undefined); assert.equal(goldAtRisk(below), 0); assert.equal(below.dropped, undefined);
  assert.equal(below.records[0].treasure, 2);
});

test('a cave-in drops the gold at risk, tactic bonuses included, buries the coins and powerup, and carries you to the shop', () => {
  // Taking the king on (3,4) forks two bishops. Taking one pays 1 plus the fork's 2;
  // the next capture is the third in a row and pays 1 plus a combo 1.
  const enemies = [foe('k', 'king', 3, 4), foe('a', 'bishop', 2, 2), foe('b', 'bishop', 5, 3), foe('c', 'rook', 4, 3), foe('d', 'rook', 6, 4)];
  const ward = { x: 5, y: 5, type: 'powerup', power: 'shield' };
  const recruit = { type: 'companion', piece: 'rook', x: 7, y: 0 };
  let state = act(room({ enemies, items: [coin(0, 7), coin(7, 7), ward, recruit] }), move(3, 4));
  assert.deepEqual(state.fork?.ids.toSorted(), ['a', 'b']);
  state = act(act(state, move(2, 2)), move(4, 3));
  assert.equal(tacticGold(state.feats), 3);
  assert.equal(state.gold, 5); assert.equal(goldAtRisk(state), 5);
  state = act(act(state, wait), wait);
  assert.equal(state.message, 'The ceiling is about to cave in! Take the stairs now to keep your 5 gold.');
  const caved = act(state, wait);
  assert.equal(caved.gold, 0); assert.equal(caved.dropped, 5); assert.equal(goldAtRisk(caved), 0);
  assert.deepEqual(caved.caveIn, { moves: 0, risk: 0, buried: 2 });
  // The coins and the bone ward are buried; the waiting recruit, which pays nothing, stays.
  assert.deepEqual(caved.items, [recruit]);
  assert.deepEqual(caveEvent(caved), { type: 'cave-in', x: 4, y: 3, gold: 5, coins: 2, power: 'shield' });
  assert.equal(caved.message, 'The ceiling caved in! You dropped 5 gold. The rubble buries the coins left and the bone ward. It carries you down the stairs to the shop.');
  // Nothing more happens in that room: no step onto the ward's square, no late capture.
  for (const action of [move(5, 5), move(6, 4), wait]) assert.equal(act(caved, action), caved);
  // The stairs work, the loss stays lost, and the next floor's ceiling holds.
  const below = act(caved, descend);
  assert.deepEqual([below.floor, below.gold, below.dropped, below.caveIn], [1, 0, 5, undefined]);
  assert.equal(below.records[0].treasure, 0, 'buried coins were never collected');
  assert.equal(below.records[0].captures, 3);
});

test('after a cave-in the shop still sells with the banked gold, and Pin and Borrow have nothing left to act on', () => {
  let state = room({ enemies: [foe('k', 'king', 3, 4), foe('d', 'bishop', 0, 0)], items: [coin(5, 5)] });
  Object.assign(state, { gold: 10, paidCaptures: 0, treasure: 0 });
  state.powers.pin = 1; state.powers.leap = 1;
  state = act(act(state, move(3, 4)), move(5, 5));
  assert.equal(goldAtRisk(state), 1);
  while (!cavedIn(state)) state = act(state, wait);
  assert.equal(state.gold, 10); assert.equal(state.dropped, 1);
  // A pin is refused in a caved-in room; Borrowed squares are gone with the rest.
  assert.equal(act(state, { type: 'pin', id: 'd' }), state);
  assert.deepEqual(legalMoves(state), []);
  // The shop at the stairs: buying spends the banked gold, as if you'd taken the stairs.
  const bought = act(state, { type: 'buy', id: 'life' });
  assert.deepEqual([bought.gold, bought.player.hp, bought.caveIn.moves], [0, 3, 0]);
  const below = act(bought, descend);
  assert.deepEqual([below.floor, below.gold, below.player.hp], [1, 0, 3]);
});

test('floor 2 caves in too, but the last floor never does', () => {
  assert.ok(act(room({ floor: 1, enemies: [foe('k', 'king', 3, 4)] }), move(3, 4)).caveIn);
  let last = act(room({ floor: 2, enemies: [foe('k', 'king', 3, 4)], items: [coin(5, 5)] }), move(3, 4));
  assert.equal(last.exit.open, true); assert.equal(last.caveIn, undefined); assert.equal(caveInStatus(last), '');
  assert.equal(caveInRunning(last), false, 'no countdown, so Wait stays hidden once the door opens');
  for (let n = 0; n < 9; n++) last = act(last, shuffle(last, n));
  assert.equal(last.gold, 1); assert.equal(last.caveIn, undefined); assert.equal(last.dropped, undefined);
  assert.equal(act(last, descend).status, 'won');
});

test('a Take-back during the countdown rewinds it, even the move that caved it in', () => {
  const state = room({ difficulty: 'tough', enemies: [foe('k', 'king', 3, 4)], items: [coin(5, 5), coin(0, 7)] });
  state.powers.takeback = 1;
  const opened = act(state, move(3, 4));
  const grabbed = act(opened, move(5, 5));
  assert.equal(grabbed.caveIn.moves, 3); assert.equal(goldAtRisk(grabbed), 1);
  const undone = act(grabbed, takeback);
  assert.deepEqual(undone.caveIn, opened.caveIn); assert.equal(undone.gold, opened.gold);
  assert.deepEqual(undone.items, opened.items); assert.equal(undone.powers.takeback, 0);
  const brink = act(act(grabbed, wait), wait);
  assert.equal(brink.caveIn.moves, 1);
  const caved = act(brink, wait);
  assert.deepEqual([caved.caveIn.moves, caved.gold, caved.dropped], [0, 0, 1]);
  // At the shop, a held Take-back still undoes the move that caved it in.
  assert.ok(takebackTarget(caved));
  const rewound = act(caved, takeback);
  assert.deepEqual(rewound.caveIn, brink.caveIn); assert.equal(rewound.gold, 1); assert.equal(rewound.dropped, undefined);
  assert.deepEqual(rewound.items, brink.items); assert.equal(cavedIn(rewound), false);
  // Then the stairs keep that gold.
  assert.equal(act(rewound, descend).gold, 1);
});

test('losing the last life during the countdown starts a fresh run with no cave-in; a held Take-back can return', () => {
  // Gentle monsters: the rook on the player's row winds up even though the player could take it back (Tricky up won't).
  const state = room({ difficulty: 'gentle', piece: 'rook', freeze: 0, enemies: [foe('k', 'king', 4, 4), foe('r', 'rook', 0, 4)] });
  state.player.hp = state.player.maxHp = 1;
  const cleared = act(state, move(4, 4));
  assert.ok(cleared.caveIn);
  assert.equal(cleared.enemies.find((entry) => entry.id === 'r').phase, 'aim');
  const armed = structuredClone(cleared); armed.powers.takeback = 1;
  const lost = act(armed, wait);
  assert.ok(lost.events.some((event) => event.type === 'restart'));
  assert.deepEqual([lost.floor, lost.turns, lost.gold, lost.exit.open], [0, 0, 0, false]);
  assert.equal(lost.caveIn, undefined); assert.equal(lost.dropped, undefined);
  assert.ok(takebackTarget(lost));
  const back = act(lost, takeback);
  assert.deepEqual(back.caveIn, cleared.caveIn); assert.equal(back.player.hp, 1); assert.equal(back.exit.open, true);
});

test('black, Pin and Collapse days: one tick per completed move, none for free actions', () => {
  // Black: the monsters' half of a move that sends the player back to choose
  // again ticks nothing; the move that completes the turn ticks once.
  const black = room({ piece: 'rook', freeze: 0, enemies: [foe('blocker', 'king', 4, 4)] });
  Object.assign(black, { playerColor: 'black', caveIn: { moves: 3, risk: 0, buried: 0 } });
  black.objective = { piece: 'queen', complete: true }; black.exit.open = true;
  const pending = act(black, move(4, 4));
  assert.equal(pending.awaitingPlayer, true); assert.equal(pending.turns, black.turns);
  assert.equal(pending.caveIn.moves, 3);
  const reply = act(pending, { type: 'move', ...legalMoves(pending)[0] });
  assert.equal(reply.turns, black.turns + 1); assert.equal(reply.caveIn.moves, 2);
  const waited = act({ ...structuredClone(black), enemies: [] }, wait);
  assert.equal(waited.turns, black.turns + 1); assert.equal(waited.caveIn.moves, 2);
  // Pinning is free, so the ceiling doesn't notice.
  const pinRoom = room({ enemies: [foe('k', 'king', 3, 4), foe('d', 'bishop', 0, 0)] });
  pinRoom.powers.pin = 1;
  const opened = act(pinRoom, move(3, 4));
  const pinned = act(opened, { type: 'pin', id: 'd' });
  assert.equal(pinned.enemies.find((entry) => entry.id === 'd').pinned, 3);
  assert.deepEqual(pinned.caveIn, opened.caveIn); assert.equal(pinned.turns, opened.turns);
  // Collapse: arrivals stop once the door opens, while the ceiling counts down.
  const collapse = room({ enemies: [foe('k', 'king', 3, 4)] });
  Object.assign(collapse, { modifier: 'collapse', reinforcements: 0, reinforcementsSkipped: 0, turns: 9 });
  let state = act(collapse, move(3, 4));
  for (let n = 0; n < 4; n++) state = act(state, shuffle(state, n));
  assert.equal(state.reinforcements, 0); assert.ok(!state.enemies.length);
  assert.equal(modifierStatus(state), '🧱 Collapse'); assert.equal(caveInStatus(state), '🪨 Caving in 1');
});

test('the shop at the stairs spends banked gold first', () => {
  let state = room({ enemies: [foe('k', 'king', 3, 4)], items: [coin(5, 5), coin(7, 4)] });
  state.gold = 10;
  state = act(act(act(state, move(3, 4)), move(5, 5)), move(7, 4));
  assert.equal(state.gold, 12); assert.equal(goldAtRisk(state), 2);
  const bought = act(state, { type: 'buy', id: 'life' });
  assert.equal(bought.gold, 2); assert.equal(goldAtRisk(bought), 2);
  assert.deepEqual(bought.caveIn, state.caveIn, 'buying is not a move');
  const caved = act(act(act(bought, wait), wait), wait);
  assert.deepEqual([caved.caveIn.moves, caved.gold, caved.dropped], [0, 0, 2]);
});

test('a real floor plays on past its clear into a cave-in, and every frame is a valid save', () => {
  const { date, daily, frames } = realCaveIn();
  const caveAt = frames.findIndex(caveEvent);
  assert.equal(caveAt, frames.length - 1, `${date}: the cave-in ends the room`);
  const total = caveInMoves(daily);
  const opened = frames[caveAt - total], caved = frames[caveAt];
  assert.equal(opened.exit.open, true); assert.equal(frames[caveAt - total - 1].exit.open, false, 'the countdown starts with the clear');
  // What was at risk before the last move, plus whatever that move won, is lost.
  assert.ok(caveEvent(caved).gold >= goldAtRisk(frames[caveAt - 1]));
  assert.equal(caved.dropped, caveEvent(caved).gold);
  for (const frame of frames) assert.equal(validateSave(JSON.parse(JSON.stringify(frame)), date, daily), true, `${date} turn ${frame.turns}`);
  // Down the stairs: the floor's record counts only the moves until the clear.
  const below = act(caved, descend);
  assert.equal(below.floor, 1); assert.equal(below.records[0].scored, opened.objective.moves);
  assert.equal(validateSave(JSON.parse(JSON.stringify(below)), date, daily), true);
});

test('Restart this floor during the countdown or after a cave-in returns to the floor’s start', () => {
  const { date, daily, frames } = realCaveIn();
  const caved = frames.find((frame) => caveEvent(frame));
  const counting = frames.find((frame) => frame.caveIn?.moves > 0 && frame.caveIn.moves < caveInMoves(frame));
  for (const frame of [counting, caved]) {
    assert.equal(frame.floor, 0);
    const reset = resetFloor(frame);
    assert.equal(reset.caveIn, undefined); assert.equal(reset.dropped, undefined);
    assert.equal(reset.gold, frame.floorSnapshot.gold); assert.equal(reset.exit.open, false);
    // Only the moves until the challenge was complete carry over as the floor's score.
    assert.equal(reset.restartedMoves, frame.objective.moves);
    assert.equal(validateSave(JSON.parse(JSON.stringify(reset)), date, daily), true);
  }
});

test('practice runs cave in by the same rules, and their saves validate', () => {
  const { date, daily, actions } = realCaveIn();
  const practice = { ...daily, practice: true, layoutPiece: daily.playerPiece };
  let state = createGame(practice);
  let caved = 0;
  for (const action of actions) {
    state = act(state, action);
    if (caveEvent(state)) caved++;
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), date, practice), true, `turn ${state.turns}`);
  }
  assert.equal(caved, 1); assert.equal(cavedIn(state), true); assert.equal(state.practice, true);
  assert.equal(act(state, descend).floor, 1);
});

test('countdown and cave-in saves validate; forged cave-in fields do not', () => {
  const { date, daily, frames, actions } = realCaveIn();
  const caveAt = frames.findIndex(caveEvent);
  const total = caveInMoves(daily);
  const opened = frames[caveAt - total], counting = frames[caveAt - 1], caved = frames[caveAt];
  assert.deepEqual(opened.caveIn, { moves: total, risk: 0, buried: 0 });
  assert.ok(goldAtRisk(counting) > 0);
  const check = (frame, mutate) => { const copy = JSON.parse(JSON.stringify(frame)); mutate(copy); return validateSave(copy, date, daily); };
  for (const frame of [opened, counting, caved]) assert.equal(check(frame, () => {}), true);
  // The countdown's shape and bounds.
  assert.equal(check(counting, (s) => { s.caveIn.moves = total + 1; }), false);
  assert.equal(check(counting, (s) => { s.caveIn.extra = 1; }), false);
  assert.equal(check(counting, (s) => { s.caveIn.risk = -1; }), false);
  assert.equal(check(counting, (s) => { s.caveIn.buried = 1; }), false, 'nothing is buried before the cave-in');
  assert.equal(check(counting, (s) => { s.caveIn.moves = 0; }), false, 'a caved-in room keeps no coins or risk');
  assert.equal(check(opened, (s) => { s.caveIn.moves = total - 1; }), false, 'no further along than the moves since the door opened');
  assert.equal(check(frames[0], (s) => { s.caveIn = { moves: total, risk: 0, buried: 0 }; }), false, 'only an open door');
  // The cave-in's ledger: dropped gold and buried coins must add up.
  assert.equal(check(caved, (s) => { s.caveIn.risk = 1; }), false);
  assert.equal(check(caved, (s) => { s.caveIn.buried += 1; }), false);
  assert.equal(check(caved, (s) => { s.dropped += 1; }), false);
  assert.equal(check(caved, (s) => { delete s.dropped; }), false);
  assert.equal(check(caved, (s) => { s.gold += 1; }), false);
  assert.equal(check(caved, (s) => { s.dropped = 0; }), false);
  // The room's powerup lay there until the rubble buried it.
  const power = frames[caveAt - 1].items.find((item) => item.type === 'powerup');
  assert.ok(power); assert.equal(caveEvent(caved).power, power.power);
  assert.ok(!caved.items.some((item) => item.type === 'powerup'));
  assert.equal(check(caved, (s) => { s.items.push(power); }), false, 'a caved-in room keeps no powerup');
  // A save from before the cave-in, its door already open, is fine; its countdown starts on the next move.
  const legacy = JSON.parse(JSON.stringify(frames[caveAt - 2])); delete legacy.caveIn;
  assert.equal(validateSave(legacy, date, daily), true);
  const resumed = act(legacy, actions[caveAt - 2]);
  assert.deepEqual(resumed.caveIn, { moves: total, risk: 0, buried: 0 });
  assert.equal(validateSave(JSON.parse(JSON.stringify(resumed)), date, daily), true);
});

test('certified routes take the stairs right after each clear, so they never meet a cave-in', () => {
  let checked = 0;
  for (let day = 0; checked < 2 && day < 30; day++) {
    const date = new Date(Date.UTC(2027, 6, 5 + day)).toISOString().slice(0, 10);
    const raw = getRawDaily(date), tier = tierForDate(date);
    const candidate = candidateFor(raw, tier, knobsFor(tier, raw.playerPiece));
    const route = findWinningRoute(createGame(candidate));
    if (route.status !== 'solved') continue;
    // The certificate as the Dungeon Bot replays it (src/bot.js botRun, here on the raw candidate).
    const frames = [createGame(candidate)];
    for (const action of route.actions) frames.push(act(frames.at(-1), action));
    assert.equal(frames.at(-1).status, 'won');
    frames.slice(0, -1).forEach((frame, index) => {
      assert.notEqual(frames[index + 1], frame, `${date} action ${index} plays`);
      // Once a floor's challenge is complete the next action is its stairs.
      if (frame.exit.open) assert.equal(route.actions[index].type, 'descend', `${date} action ${index}`);
      assert.ok(!(frame.caveIn?.moves < caveInMoves(frame)), `${date}: the countdown never runs`);
    });
    assert.ok(!frames.some(caveEvent)); assert.equal(frames.at(-1).dropped, undefined);
    assert.deepEqual(verifyWinningRoute(createGame(candidate), route.actions).metrics.floorMoves, frames.at(-1).records.map(scoredMoves));
    for (const frame of frames) assert.equal(validateSave(JSON.parse(JSON.stringify(frame)), date, candidate), true, `${date} turn ${frame.turns}`);
    // A route that lingers after a clear is no certificate.
    const clear = frames.findIndex((frame) => frame.exit.open);
    const lingering = [...route.actions.slice(0, clear), wait, ...route.actions.slice(clear)];
    const proof = verifyWinningRoute(createGame(candidate), lingering);
    assert.equal(proof.valid, false); assert.match(proof.reason, /keeps moving after a floor/);
    checked++;
  }
  assert.equal(checked, 2, 'two searched routes checked');
});
