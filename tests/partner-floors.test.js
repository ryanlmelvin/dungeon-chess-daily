// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Partner floors (src/composer.js, composeDay's `partner` option, on only in
// the dev preview): a tandem floor's two targets guard each other, and the
// floor is won by the recruit taking one on your order and you the other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDay, composeTandem, partnerFloors, shortestWins, steeredWin, steeredHasty, playLine, usesIdea, PARTNER_MOTIF, TANDEM_MOVES, TANDEMS, TANDEM_RECRUITS, LINE_MOVES } from '../src/composer.js';
import { proveComposed } from '../src/generation.js';
import { getRawDaily } from '../src/edition.js';
import { act, closeAttacker } from '../src/rules.js';
import { certifiedFloors } from '../src/human-bot.js';
import { floorPars } from '../src/par.js';
import { botRun } from '../src/bot.js';
import { EDITIONS } from '../src/editions.js';
import { encodeRoute } from '../src/route-code.js';
import { encodeRooms } from '../src/room-code.js';
import { composedDayFor } from '../src/composed-preview.js';

// A bishop against rooks (floor 1), a knight against bishops (floor 2), a queen against rooks (floor 2).
const DAYS = ['2026-11-15', '2026-11-18', '2026-11-23'];
// A bishop against pawns and a queen: no tandem.
const NO_MATCHUP = '2026-11-12';
const composed = new Map();
const compose = (date, partner) => { const key = `${date}:${partner}`; if (!composed.has(key)) composed.set(key, composeDay(date, { partner })); return composed.get(key); };
const day = (date) => compose(date, true), plain = (date) => compose(date, false);
const isTarget = (state, foe) => foe.role === state.objective.piece;

test('with the option off a day composes as its stored edition, tandem matchup or not', () => {
  for (const date of [DAYS[0], NO_MATCHUP]) {
    const { daily } = date === DAYS[0] ? composeDay(date) : plain(date);
    assert.equal(daily.generation.partner, undefined);
    assert.ok(!daily.generation.motifs.includes(PARTNER_MOTIF));
    assert.equal(encodeRooms(daily.composed), EDITIONS[date].rooms, `${date} rooms`);
    assert.equal(encodeRoute(daily.generation.certificate.actions), EDITIONS[date].route, `${date} lines`);
  }
  assert.deepEqual(plain(DAYS[0]).daily, composeDay(DAYS[0]).daily, 'partner: false is the default');
});

test('a day with no tandem matchup composes the same with the option on', () => {
  assert.deepEqual(partnerFloors(getRawDaily(NO_MATCHUP)), []);
  assert.deepEqual(day(NO_MATCHUP).daily, plain(NO_MATCHUP).daily);
  assert.deepEqual(partnerFloors(getRawDaily('2026-11-19')), [], 'a pawn player');
});

test('a tandem takes floor 1 or 2 where the piece and the target pair up, and never the mirror matchups', () => {
  for (const [piece, targets] of Object.entries(TANDEMS)) assert.ok(!targets.includes(piece) && !targets.includes('queen') && !targets.includes('pawn'));
  assert.equal(TANDEMS.pawn, undefined);
  for (const date of DAYS) {
    const raw = getRawDaily(date), { daily, floors } = day(date), floor = daily.generation.partner;
    assert.ok(partnerFloors(raw).includes(floor), `${date} floor`);
    assert.ok(TANDEMS[raw.playerPiece].includes(raw.targets[floor]));
    assert.deepEqual(daily.generation.motifs.map((motif) => motif === PARTNER_MOTIF), [0, 1, 2].map((f) => f === floor));
    assert.equal(floors[floor].motif, PARTNER_MOTIF);
    assert.ok(TANDEM_RECRUITS[raw.targets[floor]].includes(floors[floor].recruit));
  }
  // The other floors are the ones the day composes without the option.
  const { daily } = day(DAYS[0]);
  for (const f of [0, 1, 2]) if (f !== daily.generation.partner) assert.deepEqual(daily.composed[f], plain(DAYS[0]).daily.composed[f], `floor ${f + 1}`);
});

test('the twins guard each other and can never step, and the recruit waits one move from the start', () => {
  for (const date of DAYS) {
    const { daily } = day(date), floor = daily.generation.partner;
    const start = certifiedFloors(daily).starts[floor];
    const twins = start.enemies.filter((foe) => isTarget(start, foe));
    assert.equal(twins.length, 2);
    for (const twin of twins) {
      const other = twins.find((foe) => foe !== twin);
      // Taking this twin lands you on its square, where the other takes you at once.
      assert.equal(closeAttacker({ ...start, enemies: start.enemies.filter((foe) => foe !== twin) }, twin)?.id, other.id, `${date}: ${other.id} guards ${twin.id}`);
    }
    // No step of theirs is open, so twenty waits later they stand where they did.
    let state = start;
    for (let n = 0; n < 20 && state.status === 'playing'; n++) {
      const next = act(state, { type: 'wait' });
      if (next === state) break;
      state = next;
      for (const twin of twins) assert.ok(state.enemies.some((foe) => foe.id === twin.id && foe.x === twin.x && foe.y === twin.y), `${date}: ${twin.id} moved`);
    }
    const recruit = start.items.find((item) => item.type === 'companion');
    assert.ok(recruit, `${date} recruit`);
    assert.ok(act(start, { type: 'move', x: recruit.x, y: recruit.y }) !== start, 'the first move reaches the recruit');
  }
});

test('the planted line: join the recruit, it takes one twin on your order, you take the other', () => {
  for (const date of DAYS) {
    const { daily, floors } = day(date), floor = daily.generation.partner, { line, room } = floors[floor];
    assert.equal(line.length, TANDEM_MOVES);
    assert.ok(line.length >= LINE_MOVES.min && line.length <= LINE_MOVES.max);
    const recruit = room.items.find((item) => item.type === 'companion');
    assert.deepEqual([line[0].type, line[0].x, line[0].y], ['move', recruit.x, recruit.y], 'the first move is the recruit\'s square');
    assert.ok(line[0].recruit !== undefined && line[1].recruit !== undefined && line[1].recruit !== 'hold' && line[2].recruit === undefined);
    const states = playLine(certifiedFloors(daily).starts[floor], line, { recruit: 'steer' });
    assert.ok(states, `${date} replays`);
    assert.ok(states.every((state) => state.hits === states[0].hits), 'never captured');
    assert.ok(!states[1].events.some((event) => event.type.endsWith('capture')), 'nothing is taken on the move the recruit joins');
    assert.ok(states[2].events.some((event) => event.type === 'companion-capture' && states[1].enemies.find((foe) => foe.id === event.id)?.role === states[1].objective.piece), 'the recruit takes a twin');
    assert.ok(states[3].events.some((event) => event.type === 'capture') && states[3].exit.open, 'you take the other and the stairs open');
    assert.ok(usesIdea({ motif: PARTNER_MOTIF }, states, line));
    // The hint is a coin on your post.
    const coin = room.items.find((item) => item.hint);
    assert.deepEqual([coin.type, coin.x, coin.y], ['coin', states[2].player.x, states[2].player.y]);
    assert.equal(floorPars(daily)[floor], TANDEM_MOVES + 1);
  }
});

test('nothing wins sooner, alone you never win uncaptured, and a hasty capture scores no better than par', () => {
  for (const date of DAYS) {
    const { daily } = day(date), floor = daily.generation.partner;
    const start = certifiedFloors(daily).starts[floor];
    assert.equal(steeredWin(start, TANDEM_MOVES - 1), false, `${date}: a steered win in two`);
    assert.equal(steeredWin(start, TANDEM_MOVES), true, `${date}: the line`);
    assert.equal(shortestWins(start, TANDEM_MOVES + 1), null, `${date}: a win without the recruit within par`);
    assert.ok(steeredHasty(start, TANDEM_MOVES - 1) > TANDEM_MOVES, `${date}: a hasty win as short as the line`);
  }
});

test('the day proves with the recruit steered on its partner floor, and only so', () => {
  for (const date of DAYS) {
    const { daily } = day(date), floor = daily.generation.partner, { actions } = daily.generation.certificate;
    assert.equal(proveComposed(daily, actions, { saves: true, partner: floor }).valid, true, date);
    // A certificate on Auto carries no orders and joins no floor 1–2 recruit.
    assert.equal(proveComposed(daily, actions, { saves: true }).valid, false);
    // The orders belong to the partner floor alone.
    assert.equal(proveComposed(daily, actions, { partner: floor === 0 ? 1 : 0 }).valid, false);
    // Left on Auto, the recruit never takes a twin: the same moves without their orders don't win.
    let state = certifiedFloors(daily).starts[floor];
    for (const { recruit, ...action } of daily.generation.certificate.actions.slice(...floorSpan(actions, floor))) state = act(state, action);
    assert.equal(state.exit.open, false, `${date}: Auto wins the line`);
    // The Dungeon Bot replays the lines, orders and all.
    assert.deepEqual(botRun(daily).floors[floor], TANDEM_MOVES);
  }
});
// Where `floor`'s line lies in a day's actions (its stairs left out).
function floorSpan(actions, floor) {
  const stairs = actions.flatMap((action, n) => (action.type === 'descend' ? [n] : []));
  return [floor ? stairs[floor - 1] + 1 : 0, stairs[floor]];
}

test('composeTandem composes only its matchups', () => {
  const { daily } = plain(NO_MATCHUP);
  const base = { ...getRawDaily(NO_MATCHUP), difficulty: daily.difficulty, modifier: daily.modifier, floorSeeds: daily.floorSeeds };
  assert.equal(composeTandem(base, 0), null, 'a bishop against pawns');
  assert.equal(composeTandem(base, 1), null, 'a bishop against a queen');
  const { daily: paired } = day(DAYS[0]);
  assert.equal(composeTandem({ ...getRawDaily(DAYS[0]), difficulty: paired.difficulty, modifier: paired.modifier, floorSeeds: paired.floorSeeds }, 2), null, 'the king floor');
});

test('the dev preview composes partner floors unless told partner=0', () => {
  // Treasure (the preview's other option) off, to see the partner floor alone.
  const on = composedDayFor(`?composed=${DAYS[0]}&treasure=0`), off = composedDayFor(`?composed=${DAYS[0]}&treasure=0&partner=0`);
  assert.deepEqual(on, day(DAYS[0]).daily);
  assert.equal(off.generation.partner, undefined);
  assert.equal(encodeRooms(off.composed), EDITIONS[DAYS[0]].rooms);
});

test('with treasure on too, a partner floor keeps its room and gets no chest', () => {
  const { daily, floors } = composeDay(DAYS[0], { partner: true, treasure: true }), floor = daily.generation.partner;
  assert.equal(floors[floor].motif, PARTNER_MOTIF);
  assert.deepEqual(daily.composed[floor], day(DAYS[0]).daily.composed[floor]);
  assert.equal(daily.generation.treasure[floor], null);
  assert.ok(!daily.composed[floor].items.some((item) => item.type === 'chest'));
});
