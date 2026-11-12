// SPDX-License-Identifier: GPL-3.0-only
// Treasure (src/treasure.js): the chest as src/rules.js plays it, and the
// chest the composer places off each floor's planted line, where one costs
// the spare move and isn't the bot's by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, resetFloor, validateSave, getShareText, treasureMark, treasureInHand, chestTaken, floorScoredMoves, CHEST_GOLD, TREASURE_MARK } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { EDITIONS } from '../src/editions.js';
import { encodeRooms, decodeRooms } from '../src/room-code.js';

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

test('the mark is in hand from the chest until par is out of reach', () => {
  // e2 to d4 (the chest) to f5 (the target): two moves.
  const { state } = day();
  assert.equal(treasureInHand(state, 3), false, 'no chest taken yet');
  const held = play(state, D4);
  assert.equal(treasureInHand(held, 3), true, 'taken, and par can still be made');
  assert.equal(treasureInHand(held, 2), true, 'one move left under par');
  assert.equal(treasureInHand(held, 1), false, 'the floor cannot finish at par any more');
  assert.equal(treasureInHand(held, null), false, 'no par, no mark');
  // A wasted move puts a par of two out of reach before the floor is cleared.
  assert.equal(treasureInHand(play(held, E2), 2), false);
  // Cleared at par it stays, exactly where the mark itself holds.
  const cleared = play(held, F5);
  assert.equal(cleared.objective.complete, true);
  for (const par of [1, 2, 3]) assert.equal(treasureInHand(cleared, par), treasureMark(cleared, 0, par), `par ${par}`);
  assert.equal(treasureInHand(cleared, 2), true);
  // A floor without its chest taken never shows it.
  const { state: bare } = day();
  assert.equal(treasureInHand(play(bare, G3), 3), false);
});

test('restarting the floor puts the chest back and takes back its gold', () => {
  const { daily, state } = day();
  const again = resetFloor(play(state, D4));
  assert.ok(again.items.some((item) => item.type === 'chest'));
  assert.equal(again.gold, 0);
  assert.ok(!chestTaken(again));
  assert.equal(again.restartedMoves, undefined);
  assert.equal(floorScoredMoves(again), 0, 'the floor’s count starts over');
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

// The composer's chests, as stored. 2026-11-12 is a bishop's Breach day,
// 2026-11-14 a knight's plain day, 2026-11-24 a bishop's Ice day (its floor 2
// a Tandem, which gets no chest) and 2026-11-19 a pawn's day.
const DATES = ['2026-11-12', '2026-11-14', '2026-11-24', '2026-11-19'];
// Each day is composed once and kept: several tests read the same ones. No options is the release configuration.
const composedDays = new Map();
async function composed(date, options = {}) {
  const key = JSON.stringify([date, options]);
  if (!composedDays.has(key)) composedDays.set(key, (await import('../src/composer.js')).composeDay(date, options));
  return composedDays.get(key);
}
const index = (tile) => tile.y * 8 + tile.x;
const withoutHints = (daily) => ({ ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) });

// A rook's day with one hand-built room: the rook starts on e2 and the floor's one target sleeps on b5,
// two moves away through e5 (the planted line) or through b2, three through many other squares.
const B5 = { x: 1, y: 3 }, E5 = { x: 4, y: 3 }, B2 = { x: 1, y: 6 };
function rookFloor() {
  const raw = getRawDaily('2026-11-13');
  assert.equal(raw.playerPiece, 'rook');
  const room = { map: Array(8).fill('........'), enemies: [{ ...B5, cast: 0, held: 9 }], items: [] };
  const start = (first) => createGame({ ...raw, composed: [first, room, room] });
  return { room, line: [move(E5), move(B5)], start };
}

test('a chest costs the spare move: no square a win of the line\'s length passes through', async () => {
  const { actionsFrom } = await import('../src/composer.js');
  const { placeTreasure, parWins, takesTreasure, TREASURE_BOT } = await import('../src/treasure.js');
  const { room, line, start } = rookFloor(), par = line.length + 1;
  const placed = placeTreasure({ room, line }, { seed: 7, start, actionsFrom });
  assert.ok(placed.treasure, 'the floor gets a chest');
  const chest = placed.room.items.find((item) => item.type === 'chest');
  assert.deepEqual([chest.x, chest.y], [placed.treasure.x, placed.treasure.y]);
  assert.deepEqual(placed.room, { ...room, items: [chest] }, 'the room is the same but for its chest');
  // b2 qualifies by the first rule (a par win passes through it, off the line), but "b2 b5" wins in two, the line's own length.
  const quick = parWins(start(room), par - 1, { actionsFrom, hits: true });
  assert.equal(quick.wins, 2, 'two wins of the line\'s length: through e5 and through b2');
  assert.ok(quick.through[index(B2)] > 0 && quick.through[index(E5)] > 0);
  assert.equal(quick.through[index(chest)] + quick.last[index(chest)], 0, 'none takes the chest');
  assert.notDeepEqual([chest.x, chest.y], [B2.x, B2.y]);
  assert.ok(placed.treasureChecks.spare < placed.treasureChecks.squares, 'the check ruled squares out');
  assert.equal(placed.treasureChecks.calm, placed.treasureChecks.spare, 'and the bot, which goes straight for the target, stumbles on none');
  // So the chest's line is exactly par long: under par, or even with treasure.
  assert.equal(placed.treasure.line.length, par);
  assert.ok(takesTreasure(start(placed.room), placed.treasure.line, par));
  assert.ok(placed.treasure.marks <= TREASURE_BOT.share * TREASURE_BOT.runs);
});

test('a floor whose every qualifying square lies on a win of the line\'s length gets no chest', async () => {
  const { actionsFrom } = await import('../src/composer.js');
  const { placeTreasure } = await import('../src/treasure.js');
  // The knight's room above: the sleeping target on f5 is two jumps away through g3 (the line) or through d4, and
  // a knight has no three-jump way there, so d4 is the only square a par win passes through, and "d4 f5" wins in two.
  const { daily } = day({ plain: true });
  const start = (room) => createGame({ ...daily, composed: [room, daily.composed[1], daily.composed[2]] });
  const placed = placeTreasure({ room: daily.composed[0], line: [move(G3), move(F5)] }, { seed: 7, start, actionsFrom });
  assert.equal(placed.treasure, null);
  assert.equal(placed.treasureMiss, 'spare');
  assert.deepEqual(placed.treasureChecks, { squares: 1, spare: 0, calm: 0, unchecked: index(D4) }, 'the first rule alone would lay it on d4');
  assert.equal(placed.room, undefined, 'the floor keeps its room');
});

test('a chest taken on the move that mates still counts against the spare move', async () => {
  const { actionsFrom } = await import('../src/composer.js');
  const { parWins } = await import('../src/treasure.js');
  const { certifiedFloors } = await import('../src/human-bot.js');
  // 2026-11-17's king floor (a knight): its one qualifying square is where another mate of the line's length lands,
  // door still shut as the knight arrives, so a chest there would be taken on the way to an under-par win.
  const { daily, floors } = await composed('2026-11-17');
  const floor = floors[2], par = floor.line.length + 1;
  assert.equal(floor.treasure, null);
  assert.equal(floor.treasureMiss, 'spare');
  const begin = certifiedFloors(withoutHints(daily)).starts[2];
  const quick = parWins(begin, par - 1, { actionsFrom, hits: true });
  const square = floor.treasureChecks.unchecked;
  assert.ok(Number.isInteger(square), 'the first rule alone would lay a chest');
  assert.ok(quick.through[square] + quick.last[square] > 0, 'a win of the line\'s length takes it');
});

test('one batch of the bot\'s runs answers for every square: a chest never changes its play', async () => {
  const { botMarks, TREASURE_BOT } = await import('../src/treasure.js');
  const { certifiedFloors, playFloor, runSeed } = await import('../src/human-bot.js');
  // 2026-11-16 (a rook): its king floor's chest was chosen after the bot ruled four squares out.
  const { daily, floors } = await composed('2026-11-16');
  const chestless = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => item.type !== 'chest') })) };
  const played = certifiedFloors(daily), bare = certifiedFloors(chestless);
  let judged = 0;
  floors.forEach((floor, f) => {
    if (!floor.treasure) return;
    judged++;
    const par = floor.line.length + 1, seedOf = (run) => runSeed(daily, f, run);
    let direct = 0;
    for (let run = 0; run < TREASURE_BOT.runs; run++) {
      const withChest = playFloor(played.starts[f], { seed: seedOf(run), cap: par + 1 }), without = playFloor(bare.starts[f], { seed: seedOf(run), cap: par + 1 });
      assert.deepEqual(withChest.actions, without.actions, `floor ${f + 1}, run ${run}: the same moves with the chest in the room`);
      if (chestTaken(withChest.state, f) && withChest.won && withChest.moves <= par) direct++;
    }
    assert.equal(botMarks(played.starts[f], par, seedOf)[index(floor.treasure)], direct, `floor ${f + 1}: the batch counts the chest's square as its own runs do`);
    assert.equal(floor.treasure.marks, direct, `floor ${f + 1}: as the composer counted`);
    assert.ok(direct <= TREASURE_BOT.share * TREASURE_BOT.runs, `floor ${f + 1}: seldom by accident`);
  });
  assert.ok(judged >= 2);
  assert.ok(floors[2].treasureChecks.calm < floors[2].treasureChecks.spare, 'the bot ruled squares out on the king floor');
  // 2026-12-31's floor 1 (a knight): the bot stumbles on every square that costs the spare move, so it has no chest.
  const lost = (await composed('2026-12-31')).floors[0];
  assert.deepEqual([lost.treasure, lost.treasureMiss], [null, 'bot']);
  assert.ok(lost.treasureChecks.spare > 0 && lost.treasureChecks.calm === 0);
});

test('composeDay places chests unless told not to, and they change nothing else', async () => {
  const { RELEASE } = await import('../src/composer.js');
  assert.equal(RELEASE.treasure, true);
  for (const date of DATES) {
    const plain = await composed(date, { treasure: false }), rich = await composed(date);
    assert.ok(plain.daily.composed.every((room) => room.items.every((item) => item.type !== 'chest')), `${date}: no chest with the option off`);
    assert.equal(plain.daily.generation.treasure, undefined);
    assert.deepEqual(rich.daily.generation.certificate.actions, plain.daily.generation.certificate.actions, `${date}: the planted lines stay`);
    // The release configuration is the stored edition, chests and all.
    assert.equal(encodeRooms(rich.daily.composed), EDITIONS[date].rooms, `${date}: the stored rooms`);
    assert.deepEqual(decodeRooms(EDITIONS[date].rooms), rich.daily.composed, `${date}: and the room code gives the chests back`);
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

test('each chest lies off its planted line and its proving line takes it at par, never under', async () => {
  const { shortestWins, actionsFrom } = await import('../src/composer.js');
  const { parWins, takesTreasure, TREASURE_BOT } = await import('../src/treasure.js');
  const { certifiedFloors } = await import('../src/human-bot.js');
  const { routeTransition } = await import('../src/fairness.js');
  let chests = 0;
  for (const date of DATES) {
    const { daily, floors } = await composed(date);
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
      // The proving line, as played on the real room: a win at par, never captured, the chest taken, so the mark is earned.
      assert.equal(treasure.line.length, par, `${where}: the chest costs the spare move`);
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
      // The two checks: no win scoring the line's length takes it (captures counted, the winning move included), and the bot seldom does at par.
      const quick = parWins(searched.starts[f], par - 1, { actionsFrom, hits: true });
      assert.ok(!quick.cut && quick.wins >= 1, `${where}: the planted line is such a win`);
      assert.equal(quick.through[index(treasure)] + quick.last[index(treasure)], 0, `${where}: under par, or even with treasure`);
      assert.ok(treasure.marks <= TREASURE_BOT.share * TREASURE_BOT.runs, `${where}: the bot's marks`);
    });
    // A floor without one says why.
    for (const floor of floors) if (!floor.treasure) assert.ok(['none', 'spare', 'bot', 'partner'].includes(floor.treasureMiss), `${date}: ${floor.treasureMiss}`);
  }
  assert.ok(chests >= 6, 'most floors of these days carry a chest');
});

test('a run that takes every chest at par validates all the way and marks its share card', async () => {
  const { floorPars } = await import('../src/par.js');
  const date = '2026-11-12';
  const { daily, floors } = await composed(date);
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
