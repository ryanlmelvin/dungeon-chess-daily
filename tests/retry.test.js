// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, getDaily, floorScoredMoves, legalMoves, validateSave, RULES_VERSION } from '../src/game.js';
import { createGame as createRoom } from '../src/rules.js';
import { floorPars } from '../src/par.js';
import { retryFloors, floorStart, createFloorStarts, createRetry } from '../src/retry.js';
import { room, withRooms } from './fixtures/rooms.js';

const move = (x, y) => ({ type: 'move', x, y });
// A state no one may change: any write to it throws.
function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
}
// Play a day's planted lines as one run. `arrivals[f]` is the state the run arrived on floor f with,
// `shops[f]` the state its floor f was cleared in (stairs not yet taken), `lines[f]` that floor's moves.
function playDay(date, each = () => {}) {
  const daily = getDaily(date);
  let state = createGame(daily);
  each(state);
  const arrivals = [state], shops = [], lines = [[]];
  for (const action of daily.generation.certificate.actions) {
    if (action.type === 'descend') { shops.push(state); lines.push([]); } else lines.at(-1).push(action);
    state = act(state, action);
    each(state);
    if (action.type === 'descend' && state.status === 'playing') arrivals.push(state);
  }
  assert.equal(state.status, 'won', date);
  return { daily, arrivals, shops, lines: lines.slice(0, 3), won: state };
}
// A pawn day, a bishop day on a Breach day, a queen day whose line waits.
const DAYS = ['2026-11-05', '2026-11-12', '2026-11-10'];
// A position without what a move says about itself.
const position = ({ events, message, notes, unmasked, ...rest }) => rest;
// What a retry opens on: the floor's snapshot, with a held Take-back left out (Undo is free).
const opened = (snapshot) => ({ ...snapshot, powers: { ...snapshot.powers, takeback: 0 } });

test('a retry is offered for the floor just cleared, and for all three of a won run', () => {
  const { arrivals, shops, won } = playDay(DAYS[0]);
  assert.deepEqual(retryFloors(arrivals[0]), []);
  assert.deepEqual(retryFloors(arrivals[1]), []);
  assert.deepEqual(shops.map(retryFloors), [[0], [1], [2]]);
  assert.deepEqual(retryFloors(won), [0, 1, 2]);
  assert.deepEqual(retryFloors(null), []);
  assert.deepEqual(retryFloors({ ...won, status: 'lost' }), []);
});

test('at the shop a retry opens the floor exactly as the run first met it', () => {
  for (const date of DAYS) {
    const { arrivals, shops } = playDay(date);
    for (const floor of [0, 1, 2]) {
      const shop = shops[floor];
      const found = floorStart(shop, floor);
      assert.equal(found.exact, true);
      assert.equal(found.start, shop.floorSnapshot);
      const retry = createRetry(found.start);
      assert.equal(retry.floor, floor);
      assert.deepEqual(retry.state, opened(shop.floorSnapshot), `${date} floor ${floor + 1}`);
      // The arrival itself, attempt counters aside: same board, gold, powers and first message.
      const { floorSnapshot, ...arrival } = arrivals[floor];
      assert.deepEqual(retry.state, opened(arrival), `${date} floor ${floor + 1}`);
      assert.equal(retry.state.floorSnapshot, undefined);
      assert.equal(retry.canUndo(), false);
      assert.equal(retry.cleared(), false);
      // A floor the run has not reached has no start.
      assert.equal(floorStart(shop, floor + 1), null);
    }
  }
});

test('the gold and powers the run arrived with come along, a held Take-back aside', () => {
  const { arrivals } = playDay(DAYS[1]);
  const rich = structuredClone(arrivals[1]);
  rich.floorSnapshot.gold = rich.gold = 7;
  rich.floorSnapshot.powers = rich.powers = { ...rich.powers, shield: 1, pin: 1, leap: 1, takeback: 1 };
  const cleared = { ...rich, exit: { ...rich.exit, open: true }, objective: { ...rich.objective, complete: true } };
  const retry = createRetry(floorStart(cleared, 1).start);
  assert.equal(retry.state.gold, 7);
  assert.deepEqual(retry.state.powers, { ...rich.powers, takeback: 0 });
  // No Take-back held, so the engine keeps no undo of its own in a retry's states.
  const first = retry.state;
  const next = retry.play({ type: 'wait' });
  assert.notEqual(next, first);
  assert.equal(next.undo, undefined);
  assert.equal(retry.play({ type: 'takeback' }), next);
});

test('on the results paper every floor opens as the run arrived on it when the visit saw it arrive', () => {
  for (const date of DAYS) {
    const starts = createFloorStarts();
    const { daily, arrivals, won } = playDay(date, (state) => starts.note(state));
    const fresh = () => createGame(daily);
    for (const floor of [0, 1, 2]) {
      const found = starts.start(won, floor, fresh);
      assert.equal(found.exact, true, `${date} floor ${floor + 1}`);
      assert.deepEqual(found.start, arrivals[floor].floorSnapshot);
      assert.deepEqual(createRetry(found.start).state, opened(arrivals[floor].floorSnapshot));
    }
    assert.equal(starts.start(won, 2, fresh).start, won.floorSnapshot);
  }
});

test('after a reload floors 1 and 3 still open exactly; floor 2 opens as its room alone', () => {
  for (const date of DAYS) {
    const { daily, arrivals, won } = playDay(date);
    const fresh = () => createGame(daily);
    // Nothing seen this visit: only the save.
    const starts = createFloorStarts();
    starts.note(won);
    const [first, second, third] = [0, 1, 2].map((floor) => starts.start(won, floor, fresh));
    assert.equal(first.exact, true);
    assert.deepEqual(first.start, arrivals[0].floorSnapshot);
    assert.equal(third.exact, true);
    assert.equal(third.start, won.floorSnapshot);
    assert.equal(second.exact, false);
    const room = ({ map, player, enemies, items, exit, objective, props, floor, companion }) => ({ map, player, enemies, items, exit, objective, props, floor, companion });
    assert.deepEqual(room(second.start), room(arrivals[1].floorSnapshot), date);
    assert.equal(second.start.gold, 0);
    assert.ok(Object.values(second.start.powers).every((count) => count === 0));
    // Without a way to lay a fresh dungeon there is nothing to open.
    assert.equal(floorStart(won, 1), null);
    assert.equal(floorStart(won, 0), null);
  }
});

test('a floor start seen for another run, or an earlier pass of this one, is not used', () => {
  const { daily, arrivals, won } = playDay(DAYS[0]);
  const fresh = () => createGame(daily);
  const seen = [arrivals[0].floorSnapshot, arrivals[1].floorSnapshot];
  assert.equal(floorStart(won, 1, seen, fresh).exact, true);
  // The run cleared floor 1 differently this time.
  const other = structuredClone(won);
  other.records[0].turns += 2;
  assert.equal(floorStart(other, 1, seen, fresh).exact, false);
  // It had bought something this run never did.
  const bought = [seen[0], { ...seen[1], purchases: ['shield'] }];
  assert.equal(floorStart(won, 1, bought, fresh).exact, false);
  // Another day's run starts the memory over.
  const starts = createFloorStarts();
  for (const state of arrivals) starts.note(state);
  const later = playDay(DAYS[1]);
  starts.note(later.won);
  assert.equal(starts.start(won, 1, fresh).exact, false);
  assert.equal(starts.start(later.won, 1, () => createGame(later.daily)).exact, false);
  // A dungeon that isn't this run's is no start at all.
  assert.equal(floorStart(won, 1, [], () => createGame(later.daily)), null);
});

test('the planted line clears a retried floor in its own moves, and the retry stops there', () => {
  for (const date of DAYS) {
    const { daily, shops, lines, won } = playDay(date);
    const pars = floorPars(daily);
    for (const floor of [0, 1, 2]) {
      let cleared = 0;
      const retry = createRetry(floorStart(floor === 2 ? won : shops[floor], floor).start, { onCleared: (state) => { cleared++; assert.equal(state, retry.state); } });
      for (const action of lines[floor]) {
        assert.equal(retry.cleared(), false);
        const before = retry.state;
        assert.notEqual(retry.play(action), before, `${date} floor ${floor + 1}`);
      }
      assert.equal(retry.cleared(), true, `${date} floor ${floor + 1}`);
      assert.equal(cleared, 1);
      const done = retry.state;
      assert.equal(floorScoredMoves(done), lines[floor].length);
      assert.equal(floorScoredMoves(done), pars[floor] - 1);
      // The same position the run cleared the floor in, without the ceiling's countdown or any talk of stairs.
      const { caveIn, floorSnapshot, ...real } = position(shops[floor]);
      assert.deepEqual(position(done), real);
      assert.deepEqual(done.unmasked, shops[floor].unmasked);
      assert.equal(done.caveIn, undefined);
      assert.ok(!done.events.some((event) => event.type === 'cave-crack'));
      const said = [...(done.notes ?? []), done.message].join(' ');
      assert.match(said, /You completed the challenge ✓ in \d+ moves?\./);
      assert.doesNotMatch(said, /stairs|ceiling|Explore/);
      // Cleared: no more moves, no stairs, no shop.
      for (const action of [{ type: 'wait' }, ...legalMoves(done).map(({ x, y }) => move(x, y)), { type: 'descend' }, { type: 'buy', id: 'shield' }]) {
        assert.equal(retry.accepts(action), false);
        assert.equal(retry.play(action), done);
      }
      assert.equal(cleared, 1);
      // Undo reopens it.
      retry.undo();
      assert.equal(retry.cleared(), false);
      assert.ok(retry.accepts(lines[floor].at(-1)));
    }
  }
});

test('undo steps back one whole turn at a time, free and without end; reset returns to the start', () => {
  for (const date of DAYS) {
    const { shops, lines } = playDay(date);
    for (const floor of [0, 1]) {
      const start = shops[floor].floorSnapshot;
      const retry = createRetry(start);
      const first = retry.state;
      const passed = [first];
      for (const action of lines[floor]) passed.push(retry.play(action));
      assert.equal(retry.canUndo(), true);
      // Back through every position, monsters and all.
      for (let at = passed.length - 2; at >= 0; at--) {
        const back = retry.undo();
        assert.deepEqual(position(back), position(passed[at]), `${date} floor ${floor + 1} move ${at}`);
        assert.deepEqual(back.events.map((event) => event.type), ['takeback']);
        assert.equal(back.notes, undefined);
        // What the retry unmasked stays unmasked.
        assert.deepEqual(back.unmasked, passed.at(-1).unmasked);
      }
      assert.equal(retry.canUndo(), false);
      assert.equal(retry.undo(), retry.state);
      // The same line plays again from there: the monsters answer as they did.
      lines[floor].forEach((action, at) => assert.deepEqual(position(retry.play(action)), position(passed[at + 1])));
      assert.equal(retry.cleared(), true);
      // Again and again.
      for (let round = 0; round < 3; round++) { retry.undo(); assert.deepEqual(position(retry.play(lines[floor].at(-1))), position(passed.at(-1))); }
      const reset = retry.reset();
      assert.deepEqual(position(reset), position(first));
      assert.deepEqual(reset.events, first.events);
      assert.match(reset.message, new RegExp(`^Floor ${floor + 1} reset\\. `));
      assert.deepEqual(reset.unmasked, passed.at(-1).unmasked);
      assert.equal(retry.canUndo(), false);
      assert.equal(retry.cleared(), false);
      assert.equal(floorScoredMoves(reset), 0);
    }
  }
});

test('a retry has no paid hints, shop, stairs or Take-back, and refuses a move that would corner the piece', () => {
  const { shops } = playDay(DAYS[1]);
  const retry = createRetry(shops[0].floorSnapshot);
  const first = retry.state;
  for (const action of [{ type: 'hint', hint: 'suspects' }, { type: 'hint', hint: 'danger' }, { type: 'buy', id: 'shield' }, { type: 'descend' }, { type: 'takeback' }, { type: 'nonsense' }, null, undefined]) {
    assert.equal(retry.accepts(action), false);
    assert.equal(retry.play(action), first);
  }
  assert.equal(first.hints, undefined);
  assert.equal(retry.canUndo(), false);
  // An illegal move is no move.
  assert.equal(retry.play(move(first.player.x, first.player.y)), first);
  assert.equal(retry.canUndo(), false);

  // A pawn walled in ahead of its one step: the move ends a real try (tests/game.test.js).
  const day = withRooms('2026-11-05', room({ walls: [[4, 4]], enemies: [{ x: 0, y: 0, cast: 0 }] }));
  const walled = createRoom(day);
  walled.player.moved = true; walled.powers.freeze = 5;
  assert.ok(act(walled, move(4, 5)).events.some((event) => event.type === 'restart'));
  let cornered = 0;
  const stuck = createRetry(walled, { onCornered: () => cornered++ });
  const before = stuck.state;
  assert.equal(stuck.play(move(4, 5)), before);
  assert.equal(cornered, 1);
  assert.equal(stuck.canUndo(), false);
  assert.equal(stuck.state.tries, undefined);
});

test('a retry never changes the real run or anything stored', () => {
  for (const date of DAYS) {
    const { daily, shops, lines, won } = playDay(date);
    for (const real of [shops[0], shops[1], won]) {
      // The real run as saved, with the device's other records beside it.
      const stored = new Map([
        [`dchess:/:daily:v${RULES_VERSION}:${date}`, JSON.stringify(real)],
        ['dchess:/:ledger', JSON.stringify({ v: 1, days: { [date]: { won: real.status === 'won' } } })],
        ['dchess:/:journal', JSON.stringify({ v: 1, finds: {} })],
      ]);
      const before = JSON.stringify([...stored]);
      let touched = 0;
      const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { touched++; return null; } });
      try {
        frozen(real);
        const serialized = JSON.stringify(real);
        const starts = createFloorStarts();
        starts.note(real);
        for (const floor of retryFloors(real)) {
          const retry = createRetry(starts.start(real, floor, () => createGame(daily)).start);
          frozen(retry.state);
          for (const action of lines[floor]) frozen(retry.play(action));
          retry.undo(); retry.undo();
          retry.play({ type: 'wait' });
          retry.reset();
          for (const action of lines[floor]) retry.play(action);
          assert.equal(retry.cleared(), true);
        }
        assert.equal(JSON.stringify(real), serialized);
        assert.equal(validateSave(JSON.parse(stored.get(`dchess:/:daily:v${RULES_VERSION}:${date}`)), date), true);
        assert.equal(JSON.stringify([...stored]), before);
        assert.equal(touched, 0, 'the retry never reaches for storage');
      } finally {
        if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
      }
    }
  }
});
