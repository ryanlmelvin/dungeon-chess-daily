// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, legalMoves, resetFloor, scoredMoves, takebackTarget, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { getDaily, createPracticeGame, validateSave as validateGameSave } from '../src/game.js';
import { botRun } from '../src/bot.js';
import { tacticGold } from '../src/tactics.js';
import { modifierStatus } from '../src/modifiers.js';
import { CAVE_IN_MOVES, CAVE_IN_DEFAULT_MOVES, caveInMoves, caveInRunning, caveInStatus, goldAtRisk } from '../src/cave-in.js';

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
    assert.equal(caveInRunning(state), true);
    state = act(state, wait);
    assert.equal(state.caveIn.moves, 0);
    assert.equal(caveInStatus(state), '🪨 Caved in');
    assert.equal(caveInRunning(state), false, 'Wait goes away again once it caves in');
    assert.deepEqual(caveEvent(state), { type: 'cave-in', x: state.player.x, y: state.player.y, gold: 0, coins: 0 });
    // The cave-in never moves you: same floor, same square, the stairs still open.
    assert.deepEqual([state.floor, state.status, state.exit.open], [0, 'playing', true]);
    const later = act(state, wait);
    assert.equal(later.caveIn.moves, 0); assert.equal(caveEvent(later), undefined, 'it caves in once');
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

test('a cave-in drops the gold at risk, tactic bonuses included, buries the coins and powerup, and nothing pays after', () => {
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
  assert.equal(caved.message, 'The ceiling caved in! You dropped 5 gold. The rubble buries the coins left and the bone ward. Nothing here pays now: take the stairs.');
  assert.deepEqual([caved.floor, caved.player.x, caved.player.y], [0, 4, 3]);
  // Stepping where the ward lay finds nothing.
  const empty = act(caved, move(5, 5));
  assert.equal(empty.powers.shield, 0); assert.ok(!empty.events.some((event) => event.type === 'powerup'));
  // A capture after the cave-in still counts, but its gold is lost as well.
  const late = act(caved, move(6, 4));
  assert.equal(late.captures, caved.captures + 1); assert.equal(late.gold, 0); assert.equal(late.dropped, 6);
  assert.equal(late.message, 'The rubble swallows that 1 gold: nothing pays after a cave-in.');
  // The stairs still work, the loss stays lost, and the next floor's ceiling holds.
  const below = act(late, descend);
  assert.deepEqual([below.floor, below.gold, below.dropped, below.caveIn], [1, 0, 6, undefined]);
  assert.equal(below.records[0].treasure, 0, 'buried coins were never collected');
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
  const rewound = act(caved, takeback);
  assert.deepEqual(rewound.caveIn, brink.caveIn); assert.equal(rewound.gold, 1); assert.equal(rewound.dropped, undefined);
  assert.deepEqual(rewound.items, brink.items);
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

test('Restart this floor during the countdown or after a cave-in returns to the floor’s start', () => {
  const daily = getDaily('2027-07-02');
  const { frames } = botRun(daily);
  const caved = frames.find((frame) => caveEvent(frame));
  const counting = frames.find((frame) => frame.caveIn?.moves > 0 && frame.caveIn.moves < caveInMoves(frame));
  for (const frame of [counting, caved]) {
    assert.equal(frame.floor, 0);
    const reset = resetFloor(frame);
    assert.equal(reset.caveIn, undefined); assert.equal(reset.dropped, undefined);
    assert.equal(reset.gold, frame.floorSnapshot.gold); assert.equal(reset.exit.open, false);
    // Only the moves until the challenge was complete carry over as the floor's score.
    assert.equal(reset.restartedMoves, frame.objective.moves);
    assert.equal(validateSave(JSON.parse(JSON.stringify(reset)), daily.date, daily), true);
  }
});

test('the Dungeon Bot still plays its certified routes to a win, through a cave-in, and every frame validates', () => {
  for (const [date, dropped] of [['2027-07-02', 6], ['2027-07-25', 5], ['2027-12-20', 2]]) {
    const daily = getDaily(date);
    const run = botRun(daily);
    assert.ok(run, date);
    assert.equal(run.frames.length, daily.generation.certificate.actions.length + 1);
    assert.equal(run.frames.at(-1).status, 'won');
    const caved = run.frames.filter(caveEvent);
    assert.equal(caved.length, 1, date); assert.equal(caved[0].floor, 0);
    assert.equal(run.frames.at(-1).dropped, dropped, date);
    // Par and the comparison count only moves until each challenge was complete.
    assert.deepEqual(run.floors, run.frames.at(-1).records.map(scoredMoves));
    for (const frame of run.frames) assert.equal(validateSave(JSON.parse(JSON.stringify(frame)), date, daily), true, `${date} turn ${frame.turns}`);
  }
});

test('practice runs cave in by the same rules, and their saves validate', () => {
  const daily = getDaily('2027-12-20');
  let state = createPracticeGame(daily, { piece: daily.playerPiece, color: daily.playerColor });
  let caved = 0;
  for (const action of daily.generation.certificate.actions) {
    state = act(state, action);
    if (caveEvent(state)) caved++;
    assert.equal(validateGameSave(JSON.parse(JSON.stringify(state)), daily.date, { practice: true }), true, `turn ${state.turns}`);
  }
  assert.equal(caved, 1); assert.equal(state.status, 'won'); assert.equal(state.practice, true);
});

test('countdown and cave-in saves validate; forged cave-in fields do not', () => {
  const date = '2027-07-02';
  const daily = getDaily(date);
  const { frames } = botRun(daily);
  const caveAt = frames.findIndex(caveEvent);
  const total = caveInMoves(daily);
  const opened = frames[caveAt - total], counting = frames[caveAt - 2], caved = frames[caveAt];
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
  assert.equal(check(frames[1], (s) => { s.caveIn = { moves: total, risk: 0, buried: 0 }; }), false, 'only an open door');
  const lastFloor = frames.find((frame) => frame.floor === 2 && frame.exit.open && frame.status === 'playing');
  assert.equal(check(lastFloor, (s) => { s.caveIn = { moves: total, risk: 0, buried: 0 }; }), false, 'never on the last floor');
  // The cave-in's ledger: dropped gold and buried coins must add up.
  assert.equal(check(caved, (s) => { s.caveIn.risk = 1; }), false);
  assert.equal(check(caved, (s) => { s.caveIn.buried += 1; }), false);
  assert.equal(check(caved, (s) => { s.dropped += 1; }), false);
  assert.equal(check(caved, (s) => { delete s.dropped; }), false);
  assert.equal(check(caved, (s) => { s.gold += 1; }), false);
  assert.equal(check(caved, (s) => { s.dropped = 0; }), false);
  // Certified routes never collect a powerup, so the room's one lay there until the rubble buried it.
  const power = frames[caveAt - 1].items.find((item) => item.type === 'powerup');
  assert.ok(power); assert.equal(caveEvent(caved).power, power.power);
  assert.ok(!caved.items.some((item) => item.type === 'powerup'));
  assert.equal(check(caved, (s) => { s.items.push(power); }), false, 'a caved-in room keeps no powerup');
  // A save from before the cave-in, its door already open, is fine; its countdown starts on the next move.
  const legacy = JSON.parse(JSON.stringify(counting)); delete legacy.caveIn;
  assert.equal(validateSave(legacy, date, daily), true);
  const resumed = act(legacy, daily.generation.certificate.actions[caveAt - 2]);
  assert.deepEqual(resumed.caveIn, { moves: total, risk: 0, buried: 0 });
  assert.equal(validateSave(JSON.parse(JSON.stringify(resumed)), date, daily), true);
});
