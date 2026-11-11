// SPDX-License-Identifier: GPL-3.0-only
// Treasure (src/treasure.js, a dev preview): the chest as src/rules.js plays
// it, and the chest the composer places off each floor's planted line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, resetFloor, validateSave, getShareText, treasureMark, chestTaken, floorScoredMoves, CHEST_GOLD, TREASURE_MARK } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

// A knight's day with hand-built rooms: the knight starts on e2, the floor's
// one target sleeps on f5 (held, so nothing moves), a chest lies on d4 and a
// coin on g4. From e2 the target is two jumps away through g3 or through d4.
const E2 = { x: 4, y: 6 }, D4 = { x: 3, y: 4 }, G3 = { x: 6, y: 5 }, F5 = { x: 5, y: 3 };
const move = (tile) => ({ type: 'move', x: tile.x, y: tile.y });
function day({ chest = D4, plain = false } = {}) {
  const raw = getRawDaily('2026-11-14');
  assert.equal(raw.playerPiece, 'knight');
  const room = { map: Array(8).fill('........'), enemies: [{ ...F5, cast: 0, held: 9 }], items: [{ x: 6, y: 4, type: 'coin' }, { ...chest, type: 'chest' }] };
  const bare = { ...room, items: room.items.filter((item) => item.type !== 'chest') };
  const daily = { ...raw, composed: [plain ? bare : room, bare, bare] };
  return { daily, state: createGame(daily) };
}
const valid = (state, daily) => validateSave(state, daily.date, daily);
const play = (state, ...tiles) => tiles.reduce((now, tile) => {
  const next = act(now, move(tile));
  assert.notEqual(next, now, 'the move is legal');
  return next;
}, state);

test('the chest is taken by ending a move on it: gold, a feat, and it is gone', () => {
  const { daily, state } = day();
  assert.ok(state.items.some((item) => item.type === 'chest'), 'it lies in the room');
  assert.ok(valid(state, daily), 'a save with a chest in the room is valid');
  const taken = play(state, D4);
  assert.equal(taken.gold, state.gold + CHEST_GOLD);
  assert.ok(chestTaken(taken));
  assert.deepEqual(taken.feats, [{ floor: 0, kind: 'chest' }]);
  assert.ok(!taken.items.some((item) => item.type === 'chest'));
  assert.deepEqual(taken.events.filter((event) => event.type === 'pickup'), [{ type: 'pickup', x: 3, y: 4, chest: true }]);
  assert.ok(valid(taken, daily), 'and the save after taking it is valid');
});

test('the coin magnet draws in coins, never the chest', () => {
  // The chest on h4 and the coin on g4 both lie beside g3.
  const { state } = day({ chest: { x: 7, y: 4 } });
  state.powers.magnet = 1;
  const next = play(state, G3);
  assert.equal(next.treasure, 1, 'the magnet took the coin');
  assert.ok(next.items.some((item) => item.type === 'chest'), 'and left the chest');
  assert.ok(!chestTaken(next));
});

test('an untaken chest is gone once the door opens', () => {
  const { daily, state } = day();
  const cleared = play(state, G3, F5);
  assert.ok(cleared.exit.open);
  assert.ok(!cleared.items.some((item) => item.type === 'chest'));
  assert.ok(!chestTaken(cleared));
  assert.equal(cleared.gold, 0);
  assert.ok(valid(cleared, daily));
});

test('a capture that completes the challenge on the chest\'s square comes too late', () => {
  const { daily, state } = day({ chest: F5 });
  const cleared = play(state, G3, F5);
  assert.ok(cleared.exit.open);
  assert.ok(!chestTaken(cleared), 'the door opened as the move landed');
  assert.equal(cleared.gold, 0);
  assert.ok(valid(cleared, daily));
});

test('the treasure mark needs the chest and par, and shows once on the share card', () => {
  const { daily, state } = day();
  const cleared = play(state, D4, F5);
  assert.equal(floorScoredMoves(cleared), 2);
  assert.ok(treasureMark(cleared, 0, 2), 'the chest, at par');
  assert.ok(treasureMark(cleared, 0, 3), 'or under it');
  assert.ok(!treasureMark(cleared, 0, 1), 'over par earns none');
  assert.ok(!treasureMark(cleared, 0, null), 'nor does a run without a par');
  assert.ok(!treasureMark(play(state, D4), 0, 2), 'nor a floor still in play');
  assert.ok(!treasureMark(play(state, G3, F5), 0, 2), 'nor par without the chest');
  const next = act(cleared, { type: 'descend' });
  assert.ok(valid(next, daily));
  assert.ok(treasureMark(next, 0, 2), 'the floor\'s record keeps it');
  const floors = (pars) => getShareText(next, pars, { now: new Date('2026-11-14T12:00:00Z') }).split('\n')[1];
  assert.equal(floors([2, 3, 3]), `🟥 E ${TREASURE_MARK}  ⬛ ·`);
  assert.equal(floors([1, 3, 3]), '🟥 +1  ⬛ ·', 'over par: no mark');
});

test('restarting the floor puts the chest back and takes back its gold', () => {
  const { daily, state } = day();
  const again = resetFloor(play(state, D4));
  assert.ok(again.items.some((item) => item.type === 'chest'));
  assert.equal(again.gold, 0);
  assert.ok(!chestTaken(again));
  assert.equal(again.restartedMoves, 1, 'the move spent still counts');
  assert.ok(valid(again, daily));
});

test('validateSave checks a save\'s chests', () => {
  const { daily, state } = day();
  const taken = play(state, D4);
  const forge = (from, change) => { const copy = structuredClone(from); change(copy); return copy; };
  assert.ok(!valid(forge(state, (save) => { save.feats.push({ floor: 0, kind: 'chest' }); save.gold += CHEST_GOLD; }), daily), 'a chest both taken and still there');
  assert.ok(!valid(forge(taken, (save) => { save.feats.push({ floor: 0, kind: 'chest' }); save.gold += CHEST_GOLD; }), daily), 'a chest taken twice');
  assert.ok(!valid(forge(taken, (save) => { save.gold += 1; }), daily), 'gold the chest did not pay');
  assert.ok(!valid(forge(state, (save) => { save.items = save.items.filter((item) => item.type !== 'chest'); }), daily), 'a chest missing with the door shut');
  // A day without chests takes no chest feat.
  const bare = day({ plain: true });
  assert.ok(valid(bare.state, bare.daily));
  assert.ok(!valid(forge(bare.state, (save) => { save.feats.push({ floor: 0, kind: 'chest' }); save.gold += CHEST_GOLD; }), bare.daily), 'a chest feat on a floor that has none');
});

// The composer's chests. 2026-11-12 is a bishop's Breach day, 2026-11-24 a
// bishop's Ice day and 2026-11-19 a pawn's day.
const DATES = ['2026-11-12', '2026-11-24', '2026-11-19'];
const index = (tile) => tile.y * 8 + tile.x;
const withoutHints = (daily) => ({ ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) });

test('composeDay places chests only when asked, and changes nothing else', async () => {
  const { composeDay } = await import('../src/composer.js');
  for (const date of DATES) {
    const plain = composeDay(date), rich = composeDay(date, { treasure: true });
    assert.ok(plain.daily.composed.every((room) => room.items.every((item) => item.type !== 'chest')), `${date}: no chest unless asked`);
    assert.equal(plain.daily.generation.treasure, undefined);
    assert.deepEqual(rich.daily.generation.certificate.actions, plain.daily.generation.certificate.actions, `${date}: the planted lines stay`);
    rich.floors.forEach((floor, f) => {
      const chests = floor.room.items.filter((item) => item.type === 'chest');
      assert.equal(chests.length, floor.treasure ? 1 : 0);
      assert.deepEqual({ ...floor.room, items: floor.room.items.filter((item) => item.type !== 'chest') }, plain.floors[f].room, `${date} floor ${f + 1}: the room is the plain one plus its chest`);
      assert.deepEqual(rich.daily.generation.treasure[f], floor.treasure?.line ?? null, 'the proving line is kept with the day');
    });
    // Monsters ignore the chest: along the planted lines they move as on the plain day.
    let a = createGame(plain.daily), b = createGame(rich.daily);
    for (const action of plain.daily.generation.certificate.actions) {
      a = act(a, action); b = act(b, action);
      assert.deepEqual(b.enemies, a.enemies, `${date}: the monsters move alike`);
      assert.ok(validateSave(b, date, rich.daily), `${date}: every save along the planted line is valid`);
    }
    assert.equal(b.status, 'won');
    assert.deepEqual(b.feats.filter((feat) => feat.kind === 'chest'), [], `${date}: the planted lines take no chest`);
  }
});

test('each chest lies off its planted line and its proving line takes it within par', async () => {
  const { composeDay, shortestWins, actionsFrom } = await import('../src/composer.js');
  const { parWins, takesTreasure } = await import('../src/treasure.js');
  const { certifiedFloors } = await import('../src/human-bot.js');
  const { routeTransition } = await import('../src/fairness.js');
  let chests = 0;
  for (const date of DATES) {
    const { daily, floors } = composeDay(date, { treasure: true });
    const played = certifiedFloors(daily), searched = certifiedFloors(withoutHints(daily));
    floors.forEach((floor, f) => {
      const { treasure, room, line } = floor, par = line.length + 1;
      if (!treasure) return;
      chests++;
      const where = `${date} floor ${f + 1}`;
      // Off the line: no square it moves to or rests on, nor the start, the exit, a wall, a monster, another item or ice.
      const states = [searched.starts[f]];
      for (const action of line) states.push(routeTransition(states.at(-1), action));
      const off = [room.start ?? { x: 4, y: 6 }, { x: 4, y: 0 }, ...room.enemies, ...room.items.filter((item) => item.type !== 'chest'), ...(room.ice ?? []),
        ...line.filter((action) => action.type === 'move'), ...states.map((state) => state.player)].map(index);
      assert.ok(!off.includes(index(treasure)), `${where}: the chest lies off the line`);
      assert.equal(room.map[treasure.y][treasure.x], '.', `${where}: on an open square`);
      // The proving line, as played on the real room: a win within par, never captured, the chest taken, so the mark is earned.
      assert.ok(treasure.line.length <= par);
      assert.ok(takesTreasure(played.starts[f], treasure.line, par), `${where}: the proving line takes the chest within par`);
      let state = played.starts[f];
      for (const action of treasure.line) state = act(state, action);
      assert.ok(treasureMark(state, f, par), `${where}: and earns the mark`);
      // The exact count agrees, and nothing wins sooner than the planted line with the chest in the room.
      const counted = parWins(searched.starts[f], par, { actionsFrom });
      assert.ok(!counted.cut);
      assert.equal(counted.through[index(treasure)], treasure.through);
      assert.ok(treasure.through >= 1 && treasure.through <= counted.wins);
      assert.equal(shortestWins(searched.starts[f], line.length - 1), null, `${where}: nothing shorter than the planted line`);
    });
  }
  assert.ok(chests >= 6, 'most floors of these days carry a chest');
});

test('a run that takes every chest at par validates all the way and marks its share card', async () => {
  const { composeDay } = await import('../src/composer.js');
  const { floorPars } = await import('../src/par.js');
  const date = '2026-11-12';
  const { daily, floors } = composeDay(date, { treasure: true });
  const pars = floorPars(daily);
  assert.deepEqual(pars, floors.map((floor) => floor.line.length + 1));
  let state = createGame(daily);
  for (const floor of floors) {
    for (const action of [...(floor.treasure?.line ?? floor.line), { type: 'descend' }]) {
      const next = act(state, action);
      assert.notEqual(next, state);
      assert.ok(validateSave(next, date, daily), 'every save of the run is valid');
      state = next;
    }
  }
  assert.equal(state.status, 'won');
  const card = getShareText(state, pars, { now: new Date('2026-11-12T12:00:00Z') }).split('\n')[1];
  floors.forEach((floor, f) => assert.equal(card.split('  ')[f].endsWith(TREASURE_MARK), Boolean(floor.treasure), `floor ${f + 1}'s mark`));
  assert.equal(state.gold, CHEST_GOLD * floors.filter((floor) => floor.treasure).length + state.treasure + state.paidCaptures);
});

test('the composed preview turns treasure on unless the query says treasure=0', async () => {
  const { composedDayFor } = await import('../src/composed-preview.js');
  const chests = (daily) => daily.composed.flatMap((room) => room.items).filter((item) => item.type === 'chest').length;
  assert.ok(chests(composedDayFor('?composed=2026-11-12')) > 0);
  assert.equal(chests(composedDayFor('?composed=2026-11-12&treasure=0')), 0);
});
