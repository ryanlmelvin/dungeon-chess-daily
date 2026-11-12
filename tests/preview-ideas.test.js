// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The ideas in preview (src/composer.js PREVIEW_IDEAS): the Standstill
// ('wait') and the Lure ('lure'), composeDay options that are off unless
// asked for. No stored edition has them, so with the options off every day
// composes exactly as it is stored; on, each composes, proves, and has to be
// found (src/tight.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDay, actionsFrom, usesIdea, playLine, previewIdeas, ideaFloors, ideaDay, composedSeeds, partnerFloors, BOT_GUARD, RELEASE, FALLBACKS, PREVIEW_IDEAS, IDEA_EVERY, IDEA_FIRSTS, WAIT_OTHERS, MOTIF_LEVELS } from '../src/composer.js';
import { parRoom, playsIdea, tightVerdict, standsAlone, plainGuard, TIGHT } from '../src/tight.js';
import { getDaily } from '../src/game.js';
import { getRawDaily } from '../src/edition.js';
import { createGame, act, closeAttacker } from '../src/rules.js';
import { certifiedFloors, playFloor, runSeed } from '../src/human-bot.js';
import { encodeMotifs, decodeMotifs, isMotifName } from '../src/motif-code.js';
import { PAGES, PREVIEW_PAGES, UNFOUND_TEXT, pageFor, bookPages, journalProgress, emptyJournal, addFinds, floorFinds } from '../src/journal.js';
import { composedDayFor, previewOptions, composedSaveTag, previewJournals } from '../src/composed-preview.js';

const DAY = 86_400_000;
const square = (name) => ({ x: 'abcdefgh'.indexOf(name[0]), y: 8 - Number(name[1]) });
const spell = (actions) => actions.map((action) => (action.type === 'move' ? `${'abcdefgh'[action.x]}${8 - action.y}` : action.type)).join(' ');
const same = (a, b) => a.x === b.x && a.y === b.y;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const baseOf = (date) => ({ ...getRawDaily(date), floorSeeds: composedSeeds(date) });
// A day composed with `options`, once: its floors, each floor's motif instance (the `kept` trace's) and each
// floor's start on the twin without hint powerups (as a planted line is searched) and as played.
const composedDays = new Map();
function compose(date, options = {}) {
  const key = JSON.stringify([date, options]);
  if (composedDays.has(key)) return composedDays.get(key);
  const builts = [];
  const { daily, floors, dropped } = composeDay(date, { ...options, trace: (event) => { if (event.stage === 'kept') builts[event.floor] = event.built; } });
  const twin = { ...daily, composed: daily.composed.map((room) => ({ ...room, items: room.items.filter((item) => !(item.hint && item.type === 'powerup')) })) };
  const composed = { daily, floors, dropped, builts, starts: certifiedFloors(twin).starts, played: certifiedFloors(daily).starts };
  composedDays.set(key, composed);
  return composed;
}
// 2026-11-14: a knight against a lone queen on floor 1, a day the Standstill fits and draws.
const WAIT_DAY = '2026-11-14';
// 2026-11-30: a knight against two rooks on floor 1, with a bishop among the decoys: a day the Lure fits (it draws another).
const LURE_DAY = '2026-11-30';

// The tight tests every idea in preview is held to, on floor 1 of a composed day.
function assertFound(date, { daily, floors, builts, starts, played }) {
  const floor = floors[0], built = builts[0], par = floor.line.length + 1;
  const states = playLine(starts[0], floor.line);
  assert.ok(states?.at(-1).exit.open && states.every((state) => state.hits === states[0].hits), `${date}: the line wins, never captured`);
  assert.ok(usesIdea(built, states, floor.line) && playsIdea(built, states, floor.line, usesIdea), `${date}: the line plays its idea`);
  // No win within par skips the idea, captures allowed, and at most half the first actions keep par.
  const verdict = tightVerdict(starts[0], built, floor.line, { actionsFrom, narrow: usesIdea });
  assert.ok(verdict.ok, `${date}: the verdict (${verdict.why})`);
  const room = parRoom(starts[0], floor.line.length, { actionsFrom, idea: (frames, actions) => playsIdea(built, frames, actions, usesIdea) });
  assert.ok(!room.cut && room.wins > 0 && room.off === 0, `${date}: ${room.off} of ${room.wins} wins within par skip the idea`);
  assert.ok(room.firsts >= IDEA_FIRSTS && room.keepPar >= 1 && room.keepPar <= TIGHT.firstShare * room.firsts, `${date}: ${room.keepPar} of ${room.firsts} first actions keep par`);
  // The bot knows no ideas: it makes par in at most a quarter of its runs, and the guard still holds.
  const runs = Array.from({ length: BOT_GUARD.runs }, (_, run) => playFloor(played[0], { seed: runSeed(daily, 0, run), cap: par + BOT_GUARD.slack + 1 }));
  assert.ok(runs.filter((run) => run.won && run.moves <= par).length <= TIGHT.botPar * BOT_GUARD.runs, `${date}: the bot rarely makes par`);
  assert.ok(runs.every((run) => !(run.won && run.moves <= BOT_GUARD.short)), `${date}: no bot run wins in two`);
  assert.ok(runs.filter((run) => !run.won || run.moves > par + BOT_GUARD.slack).length <= BOT_GUARD.missShare * BOT_GUARD.runs, `${date}: no slog`);
  return { states, room };
}

test('the ideas in preview are no part of the release: off unless asked for, and off they change nothing', () => {
  assert.deepEqual([...PREVIEW_IDEAS], ['wait', 'lure']);
  for (const idea of PREVIEW_IDEAS) assert.equal(RELEASE[idea], undefined, `${idea} is not in RELEASE`);
  assert.deepEqual([...FALLBACKS], ['partner', 'tight', 'treasure']);
  assert.deepEqual(previewIdeas(baseOf(WAIT_DAY), { wait: false, lure: false }), [[], []]);
  // A day both ideas could change composes as stored with no options, and the same with both named off.
  for (const date of [WAIT_DAY, LURE_DAY]) {
    const release = compose(date), named = composeDay(date, { wait: false, lure: false }), stored = getDaily(date);
    assert.deepEqual(release.daily.composed, stored.composed, `${date}: the stored rooms`);
    assert.deepEqual(release.daily.generation.certificate.actions, stored.generation.certificate.actions, `${date}: the stored lines`);
    assert.deepEqual(release.daily.generation.motifs, stored.generation.motifs, `${date}: the stored ideas`);
    assert.deepEqual(named.daily.composed, stored.composed, `${date}: named off`);
    assert.ok(release.floors.every((floor) => !PREVIEW_IDEAS.includes(floor.motif)), `${date}: no floor of the release is an idea in preview`);
  }
  // The dev preview without the flags composes the stored edition.
  assert.deepEqual(previewOptions(`?composed=${WAIT_DAY}`), { starts: 'wide', treasure: true, partner: true, tight: true, wait: false, lure: false, ceiling: true });
  assert.deepEqual(composedDayFor(`?composed=${WAIT_DAY}`).composed, getDaily(WAIT_DAY).composed);
  assert.equal(previewJournals(`?composed=${WAIT_DAY}`), false);
});

test('the dev preview opts in by its query: &wait, &lure, &ideas, =all for every day an idea fits', () => {
  assert.deepEqual([previewOptions('?composed=2026-11-14&wait=1').wait, previewOptions('?composed=2026-11-14&wait=1').lure], [true, false]);
  assert.deepEqual([previewOptions('?composed=2026-11-14&lure=all').wait, previewOptions('?composed=2026-11-14&lure=all').lure], [false, 'every']);
  assert.deepEqual([previewOptions('?composed=2026-11-14&ideas=1').wait, previewOptions('?composed=2026-11-14&ideas=1').lure], [true, true]);
  assert.deepEqual([previewOptions('?composed=2026-11-14&ideas=all&wait=1').wait, previewOptions('?composed=2026-11-14&ideas=all&wait=1').lure], [true, 'every']);
  assert.equal(previewOptions('?composed=2026-11-14&ideas=1&ceiling=0').ceiling, false);
  assert.equal(previewOptions('?composed=2026-11-14&wait=0').wait, false);
  // Its runs save apart from the same day composed without the idea, and it files what its floors find.
  assert.notEqual(composedSaveTag('?composed=2026-11-14&wait=1'), composedSaveTag('?composed=2026-11-14'));
  assert.notEqual(composedSaveTag('?composed=2026-11-14&wait=1'), composedSaveTag('?composed=2026-11-14&wait=all'));
  assert.equal(composedSaveTag('?composed=2026-11-14'), 'composed:wide:');
  assert.equal(previewJournals('?composed=2026-11-14&lure=1'), true);
  // The day the query names, with the idea it asks for.
  assert.deepEqual(composedDayFor(`?composed=${WAIT_DAY}&wait=1`).composed, compose(WAIT_DAY, { wait: true }).daily.composed);
});

test('an idea takes about one in three of the days it fits, by the date: never a pawn\'s day, never the partner floor', () => {
  const fits = { wait: 0, lure: 0 }, drawn = { wait: 0, lure: 0 };
  for (let n = 0, time = Date.parse('2026-11-01'); n < 742; n++, time += DAY) {
    const base = baseOf(new Date(time).toISOString().slice(0, 10));
    const every = previewIdeas(base, { wait: 'every', lure: 'every' }), mine = previewIdeas(base, { wait: true, lure: true });
    for (const idea of PREVIEW_IDEAS) {
      const floors = ideaFloors(base, idea);
      assert.ok(floors.every((floor) => floor === 0), `${base.date}: floor 1 alone (floor 2 keeps its tight forms)`);
      if (base.playerPiece === 'pawn') assert.deepEqual(floors, [], `${base.date}: no pawn's day`);
      if (idea === 'lure' && floors.length) assert.equal(base.playerPiece, 'knight', `${base.date}: a lure is a knight's`);
      assert.equal(ideaDay(base, idea), floors.length > 0 && mine.flat().includes(idea), `${base.date}: ${idea} draws its day`);
      assert.equal(every.flat().includes(idea), floors.length > 0, `${base.date}: 'every' takes each day it fits`);
      if (floors.length) fits[idea]++;
      if (ideaDay(base, idea)) drawn[idea]++;
    }
    // Each idea goes to a floor it fits, once; with the partner floor named, never there.
    for (const floor of [0, 1]) for (const idea of every[floor]) assert.ok(ideaFloors(base, idea).includes(floor), `${base.date}: ${idea} on a floor it fits`);
    assert.equal(new Set(every.flat()).size, every.flat().length, `${base.date}: an idea takes one floor`);
    const partner = partnerFloors(base)[0];
    if (partner !== undefined) assert.deepEqual(previewIdeas(base, { wait: 'every', lure: 'every' }, partner)[partner], [], `${base.date}: never the partner floor`);
  }
  for (const idea of PREVIEW_IDEAS) {
    assert.ok(fits[idea] > 20, `${idea} fits ${fits[idea]} days`);
    assert.ok(Math.abs(drawn[idea] / fits[idea] - 1 / IDEA_EVERY) < 0.12, `${idea} draws ${drawn[idea]} of the ${fits[idea]} days it fits`);
  }
});

test('the Standstill composes, proves and has to be found: its wait is the only action that keeps par as it is made', () => {
  // composeDay proves the day (proveComposed) or throws.
  const day = compose(WAIT_DAY, { wait: true }), { daily, floors, starts } = day;
  assert.deepEqual(day.dropped, []);
  assert.equal(floors[0].motif, 'wait');
  assert.deepEqual(daily.generation.motifs.slice(0, 1), ['wait'], 'the day names the idea');
  assert.equal(MOTIF_LEVELS.wait, 3);
  const line = floors[0].line, waited = line.findIndex((action) => action.type === 'wait');
  assert.ok(line.length >= 3 && line.length <= 4, 'a line of 3 or 4 moves');
  assert.equal(line.filter((action) => action.type === 'wait').length, 1, `one wait: ${spell(line)}`);
  const { states, room } = assertFound(WAIT_DAY, day);
  // The move after the wait takes a target on the square it stepped onto while the piece stood still.
  const taken = states[waited + 2].events.find((event) => event.type === 'capture');
  const before = states[waited].enemies.find((foe) => foe.id === taken.id), after = states[waited + 1].enemies.find((foe) => foe.id === taken.id);
  assert.equal(before.role, daily.targets[0]);
  assert.ok(!same(before, after) && same(after, line[waited + 1]), 'the target stepped into reach during the wait');
  assert.ok(same(states[waited].player, states[waited + 1].player), 'and the piece stood still');
  // At that moment the wait stands alone, among a real choice of actions; either order of the wait and the move before it keeps par.
  const alone = standsAlone(starts[0], line, waited, { actionsFrom });
  assert.ok(alone.ok && alone.others >= WAIT_OTHERS, `${alone.others} other actions, none keeps par`);
  assert.ok(room.keepPar <= 2);
  // Waiting twice loses the rhythm: the target has stepped out again, and the take takes nothing.
  const twice = playLine(starts[0], [...line.slice(0, waited + 1), { type: 'wait' }]);
  assert.ok(!twice.at(-1).enemies.some((foe) => same(foe, line[waited + 1])), 'after a second wait the square is empty again');
  // The hint lies where the piece waits.
  const hint = floors[0].room.items.find((item) => item.hint);
  assert.ok(hint && same(hint, states[waited].player), 'the hint marks the square to wait on');
  // The chest's placement runs on its floor as on any other.
  assert.ok(floors[0].treasure === null || Number.isInteger(floors[0].treasure.x), 'a chest, or none that qualifies');
  if (!floors[0].treasure) assert.equal(typeof floors[0].treasureMiss, 'string');
});

test('the Lure composes, proves and has to be found, and its guard is plain to see before the first move', () => {
  const day = compose(LURE_DAY, { lure: 'every' }), { daily, floors, starts } = day;
  assert.deepEqual(day.dropped, []);
  assert.equal(floors[0].motif, 'lure');
  assert.deepEqual(daily.generation.motifs.slice(0, 1), ['lure']);
  assert.equal(daily.playerPiece, 'knight');
  const line = floors[0].line, begin = starts[0], home = { x: begin.player.x, y: begin.player.y };
  assert.ok(line.length === 3 && line.every((action) => action.type === 'move'), `three moves: ${spell(line)}`);
  const { states } = assertFound(LURE_DAY, day);
  // As the floor opens, a decoy one step away is wound up at the start square, and the prize stands one step
  // from it along the same kind of line: whatever the decoy is, it covers the prize's square, and it does.
  const prize = begin.enemies.find((foe) => same(foe, line[1]));
  assert.equal(prize.role, daily.targets[0], 'the second move takes a target');
  const guard = begin.enemies.find((foe) => foe.phase === 'aim' && foe.role !== daily.targets[0]);
  assert.ok(guard && same(guard.target, home) && chebyshev(guard, home) === 1, 'a decoy beside the start square is wound up at it');
  assert.ok(plainGuard(guard, home, prize), 'the prize is one step from the guard along the kind of step its wind-up shows');
  assert.equal(closeAttacker(begin, prize)?.id, guard.id, 'taking the prize while the guard stands there is captured at once');
  // The sidestep lands two squares or more from the guard, where no piece that winds up along a line takes it.
  assert.ok(chebyshev(line[0], guard) >= 2 && !closeAttacker(begin, line[0]), 'the sidestep is safe whatever the guard is');
  // The guard lunges onto the square the knight left, off-balance and off its post: for that move the prize is free.
  const lunged = states[1].enemies.find((foe) => foe.id === guard.id);
  assert.ok(states[1].events.some((event) => event.type === 'miss' && event.id === guard.id) && same(lunged, home) && lunged.offBalance === true, 'the guard lunged and missed');
  assert.equal(closeAttacker(states[1], prize), null, 'nothing guards the prize for that move');
  // Then it steps back to its post, its only step: the moment has passed.
  assert.ok(same(states[2].enemies.find((foe) => foe.id === guard.id), guard), 'the guard is back on its post a move later');
  // The other target can be reached from the prize's square alone, so it never comes first.
  const other = begin.enemies.find((foe) => foe.role === daily.targets[0] && foe.id !== prize.id);
  assert.ok(same(other, line[2]));
  // The hint lies on the sidestep.
  const hint = floors[0].room.items.find((item) => item.hint);
  assert.ok(hint && same(hint, line[0]), 'the hint marks the sidestep');
  assert.ok(floors[0].treasure === null || Number.isInteger(floors[0].treasure.x));
});

test('a guard is plain when the target is one step from it along the kind of step its wind-up shows', () => {
  const guard = square('d4');
  // A straight wind-up: a rook, queen or king, each of which covers the four squares straight beside it.
  assert.ok(plainGuard(guard, square('d1'), square('e4')));
  assert.ok(plainGuard(guard, square('d3'), square('d5')));
  assert.ok(!plainGuard(guard, square('d1'), square('e5')), 'a rook would not cover a diagonal neighbour');
  assert.ok(!plainGuard(guard, square('d1'), square('f4')), 'nor a square two away');
  // A diagonal one: a bishop, queen or king.
  assert.ok(plainGuard(guard, square('g7'), square('c3')));
  assert.ok(plainGuard(guard, square('b6'), square('e3')));
  assert.ok(!plainGuard(guard, square('g7'), square('d5')));
  // From one step away, diagonally down the board, it may be a pawn, which covers only the two squares below it.
  assert.ok(plainGuard(guard, square('e3'), square('c3')));
  assert.ok(!plainGuard(guard, square('e3'), square('c5')), 'a pawn would not cover the square behind it');
  assert.ok(plainGuard(guard, square('e5'), square('c3')), 'a wind-up up the board is no pawn\'s');
  assert.ok(!plainGuard(guard, square('f5'), square('e4')), 'a knight\'s wind-up says nothing of the squares beside it');
});

test('each idea in preview has its letter and its journal page, and the book lists a preview page only once it is found', () => {
  assert.equal(encodeMotifs(['wait', 'lure', 'net']), 'a,l,n');
  assert.deepEqual(decodeMotifs('a,l,n'), ['wait', 'lure', 'net']);
  assert.deepEqual(PREVIEW_PAGES.map((page) => [page.id, page.name]), [['wait', 'Standstill'], ['lure', 'Lure']]);
  const context = new Proxy({}, { get: (target, name) => (name in target ? target[name] : () => {}), set: (target, name, value) => { target[name] = value; return true; } });
  const canvas = { width: 200, height: 200, getContext: () => context };
  for (const page of PREVIEW_PAGES) {
    assert.ok(PREVIEW_IDEAS.includes(page.id) && isMotifName(page.id) && pageFor(page.id) === page && !PAGES.includes(page), page.id);
    assert.equal(page.kind, 'idea');
    assert.ok(page.name.split(' ').length <= 2, `${page.id}: a name of one or two words`);
    assert.ok(page.text.length <= 96 && page.text.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 2, `${page.id}: one or two short sentences`);
    assert.ok(page.art && UNFOUND_TEXT[page.kind] && page.pieces.length && Number.isFinite(page.still), page.id);
    for (const time of [0, page.still, 1234, 5599, 99_999]) assert.doesNotThrow(() => page.draw(canvas, time), `${page.id} at ${time}`);
  }
  assert.deepEqual(pageFor('lure').pieces, ['knight']);
  // The released book is as it was until a preview page is found.
  const empty = emptyJournal();
  assert.equal(bookPages(empty), PAGES);
  assert.deepEqual(journalProgress(empty), { found: 0, total: PAGES.length });
  const found = addFinds(empty, ['lure'], 'knight', LURE_DAY).journal, book = bookPages(found);
  assert.equal(book.length, PAGES.length + 1);
  assert.ok(book.indexOf(pageFor('lure')) === PAGES.findIndex((page) => page.kind !== 'idea'), 'after the released ideas, before the special moves');
  assert.deepEqual(journalProgress(found), { found: 1, total: PAGES.length + 1 });
});

test('clearing an idea\'s floor at par or better finds its page', () => {
  for (const [date, options, idea] of [[WAIT_DAY, { wait: true }, 'wait'], [LURE_DAY, { lure: 'every' }, 'lure']]) {
    const { daily, floors } = compose(date, options);
    let state = createGame(daily);
    for (const action of floors[0].line) state = act(state, action);
    assert.ok(state.exit.open && state.floor === 0, `${date}: floor 1 cleared`);
    // (A special move played along the line, such as a fork, is found with it.)
    assert.equal(floorFinds(state, daily, 0)[0], idea, `${date}: its idea is found`);
  }
});
