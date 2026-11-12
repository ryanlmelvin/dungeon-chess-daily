// SPDX-License-Identifier: GPL-3.0-only
// Tight floors (src/tight.js, and composeDay's `tight` option in
// src/composer.js): floors whose idea has to be found. Off unless asked for,
// and with it off a day composes exactly as its stored edition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDay, actionsFrom, usesIdea, playLine, dayIdea, composedSeeds, BOT_GUARD, BURROWS } from '../src/composer.js';
import { parRoom, playsIdea, tightVerdict, TIGHT } from '../src/tight.js';
import { getDaily } from '../src/game.js';
import { getRawDaily } from '../src/edition.js';
import { certifiedFloors, playFloor, runSeed } from '../src/human-bot.js';

const square = (name) => ({ x: 'abcdefgh'.indexOf(name[0]), y: 8 - Number(name[1]) });
const line = (text) => text.split(' ').map((word) => (word === 'wait' ? { type: 'wait' } : { type: 'move', ...square(word) }));
const spell = (actions) => actions.map((action) => (action.type === 'move' ? `${'abcdefgh'[action.x]}${8 - action.y}` : action.type)).join(' ');
// A day composed with the option on or off: its floors, each floor's motif instance (the
// `kept` trace's) and each floor's start on the twin without hint powerups, as a planted line is searched.
function compose(date, tight) {
  const builts = [];
  const { daily, floors } = composeDay(date, { tight, trace: (event) => { if (event.stage === 'kept') builts[event.floor] = event.built; } });
  const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
  return { daily, floors, builts, starts: certifiedFloors(twin).starts, played: certifiedFloors(daily).starts };
}

test('with the option off a day composes as its stored edition', () => {
  // 2026-11-18 (a knight) and 2026-11-28 (a pawn) both change with the option on.
  for (const date of ['2026-11-18', '2026-11-28']) {
    const plain = composeDay(date, { tight: false }), stored = getDaily(date);
    assert.deepEqual(plain.daily.composed, stored.composed, `${date}: the stored rooms`);
    assert.deepEqual(plain.daily.generation.certificate.actions, stored.generation.certificate.actions, `${date}: the stored lines`);
    assert.ok(plain.floors.every((floor) => floor.form === undefined), `${date}: no floor names a form`);
  }
});

// Floor 2 of a tight day, by form. 2026-11-18: a knight against two bishops,
// the mouth; 2026-11-30: a knight against a lone queen, her corridor alone;
// 2026-12-11: a knight against two rooks on an Ice day, the pincer;
// 2026-11-17: a knight against a lone queen, the pincer; 2027-01-01: a bishop
// against pawns, a plain squeeze picked for tightness.
const FORMS = [
  ['2026-11-18', 'bait', 'subtle'], ['2026-11-30', 'bait', 'subtle'], ['2026-12-11', 'squeeze', 'subtle'], ['2026-11-17', 'squeeze', 'subtle'], ['2027-01-01', 'squeeze', 'picked'],
];
test('each tight form composes, proves and has to be found', () => {
  for (const [date, motif, form] of FORMS) {
    // composeDay proves the day (proveComposed) or throws.
    const { daily, floors, builts, starts, played } = compose(date, true);
    const floor = floors[1], built = builts[1], par = floor.line.length + 1;
    assert.deepEqual([floor.motif, floor.form], [motif, form], `${date}: floor 2's form`);
    assert.deepEqual(daily.generation.motifs[1], motif, `${date}: the day names the idea, not the form`);
    assert.ok(floor.line.length >= 3 && floor.line.length <= 4, `${date}: a line of 3 or 4 moves`);
    if (form === 'subtle') assert.ok(BURROWS[daily.playerPiece].includes(daily.targets[1]), `${date}: a target the piece can burrow`);
    // The planted line wins and plays its idea, by the composer's test and the faithful one.
    const states = playLine(starts[1], floor.line);
    assert.ok(states?.at(-1).exit.open && states.every((state) => state.hits === states[0].hits), `${date}: the line wins, never captured`);
    assert.ok(usesIdea(built, states, floor.line) && playsIdea(built, states, floor.line, usesIdea), `${date}: the line plays its idea`);
    // Tight: no win within par skips the idea, captures allowed, and at most half the first actions keep par.
    const verdict = tightVerdict(starts[1], built, floor.line, { actionsFrom, narrow: usesIdea });
    assert.ok(verdict.ok, `${date}: the verdict (${verdict.why})`);
    const room = parRoom(starts[1], floor.line.length, { actionsFrom, idea: (frames, actions) => playsIdea(built, frames, actions, usesIdea) });
    assert.ok(!room.cut && room.wins > 0 && room.off === 0, `${date}: ${room.off} of ${room.wins} wins within par skip the idea`);
    assert.ok(room.keepPar >= 1 && room.keepPar <= TIGHT.firstShare * room.firsts, `${date}: ${room.keepPar} of ${room.firsts} first actions keep par`);
    // The bot knows no ideas: it makes par in at most half its runs, and the guard still holds.
    const runs = Array.from({ length: BOT_GUARD.runs }, (_, run) => playFloor(played[1], { seed: runSeed(daily, 1, run), cap: par + BOT_GUARD.slack + 1 }));
    assert.ok(runs.filter((run) => run.won && run.moves <= par).length <= TIGHT.botPar * BOT_GUARD.runs, `${date}: the bot rarely makes par`);
    assert.ok(runs.every((run) => !(run.won && run.moves <= BOT_GUARD.short)), `${date}: no bot run wins in two`);
    assert.ok(runs.filter((run) => !run.won || run.moves > par + BOT_GUARD.slack).length <= BOT_GUARD.missShare * BOT_GUARD.runs, `${date}: no slog`);
  }
});

test('a tight day shows its idea plainly on floor 1 and subtly on floor 2', () => {
  // 2026-11-17: a knight against pawns, then a queen. Its idea is the squeeze, so floor 1 is a plain squeeze where any day's would be a bait.
  const raw = getRawDaily('2026-11-17');
  const base = { ...raw, floorSeeds: composedSeeds(raw.date) };
  assert.equal(dayIdea(base), 'squeeze');
  const tight = composeDay('2026-11-17', { tight: true }), plain = composeDay('2026-11-17');
  assert.deepEqual(tight.floors.map((floor) => [floor.motif, floor.form ?? 'plain']), [['squeeze', 'plain'], ['squeeze', 'subtle'], ['net', 'plain']]);
  assert.deepEqual(plain.floors.map((floor) => floor.motif), ['bait', 'squeeze', 'net']);
  assert.deepEqual(tight.floors[2].room, plain.floors[2].room, 'the king floor of another piece than the pawn stays');
  // 2026-11-13: a rook against rooks on floor 2, which move along its own lines: no burrow holds them, and the day stays as it is.
  const same = composeDay('2026-11-13', { tight: true }), stored = getDaily('2026-11-13');
  assert.deepEqual(same.daily.composed, stored.composed);
  assert.ok(same.floors.every((floor) => floor.form === undefined));
});

test('the mouth: sidestep one lunge into the corridor\'s mouth, and the other target lunges there', () => {
  const { daily, floors, starts } = compose('2026-11-18', true);
  const actions = floors[1].line, states = playLine(starts[1], actions);
  const isTarget = (state, id) => state.enemies.find((foe) => foe.id === id)?.role === daily.targets[1];
  const home = starts[1].player, door = states[1].player;
  // Both targets end up lunging: the first at the start square, the second into the mouth.
  const first = states[1].events.find((event) => event.type === 'miss'), second = states[2].events.find((event) => event.type === 'miss');
  assert.ok(first && isTarget(starts[1], first.id) && first.x === home.x && first.y === home.y, 'the perched target lunges onto the start square');
  assert.ok(states[1].enemies.some((foe) => foe.id !== first.id && isTarget(states[1], foe.id) && foe.phase === 'aim' && foe.target.x === door.x && foe.target.y === door.y), 'the corridor\'s target winds up at the mouth');
  assert.deepEqual([actions[1].x, actions[1].y], [home.x, home.y], 'the first is retaken on the start square');
  assert.ok(second && second.x === door.x && second.y === door.y, 'the second lunges into the mouth');
  assert.deepEqual([actions[2].x, actions[2].y], [door.x, door.y], 'and is taken there');
  // The hint lies in the mouth.
  const hint = floors[1].room.items.find((item) => item.hint);
  assert.deepEqual([hint.x, hint.y], [door.x, door.y]);
});

test('the pincer: off the key a target dodges out of its other exit, on it every exit is in reach', () => {
  const { daily, floors, builts, starts } = compose('2026-12-11', true);
  const built = builts[1], key = built.key, begin = starts[1];
  const targets = (state) => state.enemies.filter((foe) => foe.role === daily.targets[1]);
  const takes = (state) => actionsFrom(state).filter((action) => action.type === 'move' && targets(state).some((foe) => foe.x === action.x && foe.y === action.y));
  assert.deepEqual([floors[1].line[0].x, floors[1].line[0].y], [key.x, key.y], 'the line opens on the key');
  assert.equal(takes(begin).length, 0, 'nothing can be taken at the start');
  for (const action of actionsFrom(begin)) {
    const next = playLine(begin, [action])?.[1];
    if (!next) continue;
    const onKey = next.player.x === key.x && next.player.y === key.y;
    // On an Ice day the line may skid onto the key: judge by where the piece rests.
    assert.equal(takes(next).length > 0, onKey, `${spell([action])}: a target steps into reach only from the key`);
  }
});

test('a tight pawn\'s king floor leaves the pawn no win within par with fewer moves than its line', () => {
  // The two dated examples: the planted line, and a win as fast on which the pawn sits out a move.
  for (const [date, planted, lazy] of [['2026-11-06', 'wait f5 f6', 'wait f5 wait'], ['2026-11-28', 'b6 b7 b8', 'b6 wait wait']]) {
    const before = compose(date, false), floor = before.floors[2];
    assert.equal(spell(floor.line), planted);
    assert.ok(playLine(before.starts[2], line(lazy))?.at(-1).exit.open, `${date}: "${lazy}" wins as fast`);
    const moves = floor.line.filter((action) => action.type === 'move').length;
    const verdict = tightVerdict(before.starts[2], before.builts[2], floor.line, { actionsFrom, narrow: usesIdea });
    assert.deepEqual([verdict.ok, verdict.why], [false, 'lazy'], `${date}: the stored floor fails the verdict`);
    assert.ok(verdict.fewest < moves);
    const after = compose(date, true), tight = after.floors[2];
    assert.notDeepEqual(tight.room, floor.room, `${date}: another floor composes`);
    const room = parRoom(after.starts[2], tight.line.length, { actionsFrom });
    assert.ok(!room.cut && room.fewest >= tight.line.filter((action) => action.type === 'move').length, `${date}: every win within par makes all the line's moves`);
    assert.ok(tight.line.length >= 3 && tight.line.length <= 4 && after.daily.generation.motifs[2] === 'net');
  }
});

test('the faithful idea test reads a skid, and the same squeeze from another square', () => {
  // 2026-11-24 floor 2, a bishop's squeeze on ice: the planted line aims a square short of the key and skids onto it.
  const icy = compose('2026-11-24', false);
  const skid = playLine(icy.starts[1], icy.floors[1].line);
  assert.equal(icy.floors[1].motif, 'squeeze');
  assert.ok(skid[1].events.some((event) => event.type === 'slide'), 'the line skids');
  assert.equal(usesIdea(icy.builts[1], skid, icy.floors[1].line), false, 'the narrow test misreads the square aimed at');
  assert.equal(playsIdea(icy.builts[1], skid, icy.floors[1].line, usesIdea), true);
  // 2026-11-16 floor 2, a rook's squeeze planted "d5 b5 wait f5": "b2 b5 wait f5" covers the same landing from another square.
  const rook = compose('2026-11-16', false);
  assert.equal(spell(rook.floors[1].line), 'd5 b5 wait f5');
  const other = line('b2 b5 wait f5'), states = playLine(rook.starts[1], other);
  assert.ok(states?.at(-1).exit.open, 'it wins as fast');
  assert.equal(usesIdea(rook.builts[1], states, other), false, 'the narrow test wants the planted key');
  assert.equal(playsIdea(rook.builts[1], states, other, usesIdea), true);
  // A plain walk up to a target is no squeeze and no bait.
  const frames = [{ enemies: [{ id: 'a', x: 1, y: 1, role: 'rook' }], objective: { piece: 'rook' }, events: [] }, { enemies: [{ id: 'a', x: 1, y: 1, role: 'rook' }], objective: { piece: 'rook' }, events: [] }, { enemies: [], objective: { piece: 'rook' }, events: [{ type: 'capture', id: 'a' }] }];
  const walk = [{ type: 'move', x: 1, y: 3 }, { type: 'move', x: 1, y: 1 }];
  assert.equal(playsIdea({ motif: 'squeeze' }, frames, walk, usesIdea), false);
  assert.equal(playsIdea({ motif: 'bait' }, frames, walk, usesIdea), false);
});
