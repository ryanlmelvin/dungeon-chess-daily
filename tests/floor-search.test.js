// SPDX-License-Identifier: GPL-3.0-only
// The certificate search (src/fairness.js): it certifies floor by floor, takes
// the stairs right after each clear, keys positions on the floor's own clock,
// ranks them by wall-aware move distances, and generation tries up to sixteen
// candidate layouts and assembles each day from their floors (src/generation.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame } from '../src/rules.js';
import { findWinningRoute, positionKey, targetDistance, verifyWinningRoute, MAX_ROUTE_MOVES } from '../src/fairness.js';
import { ATTEMPTS, EXTRA_ATTEMPTS, GENERATOR_VERSION, candidateFor, candidateSeed, generateDaily, rankFloors, routeFloors, searchCandidate, searchCandidates, targetForDate } from '../src/generation.js';
import { knobsFor, tierForDate, freebieFloor, LONG_FLOOR_PAR } from '../src/difficulty.js';
import { distanceTable } from '../src/move-tables.js';
import { encodeRoute } from '../src/route-code.js';
import { PIECE_LIVES } from '../src/pieces.js';

const descend = { type: 'descend' };
const dayAfter = (start, day) => new Date(Date.parse(`${start}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
const candidate = (date, attempt = 0) => {
  const raw = getRawDaily(date), tier = tierForDate(date);
  return candidateFor(raw, tier, knobsFor(tier, raw.playerPiece), attempt);
};
// The positions a route passes through, and where each floor starts.
function replay(daily, actions) {
  const frames = [createGame(daily)];
  for (const action of actions) frames.push(act(frames.at(-1), action));
  const starts = frames.flatMap((frame, index) => (index && frame.floor !== frames[index - 1].floor && frame.status === 'playing' ? [index] : []));
  return { frames, starts };
}
// A searched real route (no stored certificate) from dates past the stored
// editions: the first first-candidate route `accept` likes, on a day `want` picks.
function searchedRoute(accept, { start = '2031-03-01', want = () => true } = {}) {
  for (let day = 0; day < 60; day++) {
    const date = dayAfter(start, day), daily = candidate(date);
    if (!want(daily)) continue;
    const route = findWinningRoute(createGame(daily));
    if (route.status === 'solved' && accept(daily, route)) return { date, daily, route };
  }
  return null;
}

test('a cleared floor’s only action is its stairs: the search takes them without spending budget', () => {
  // A floor-3 position with its king already taken: the route is the stairs alone.
  const state = createGame(getRawDaily('2026-11-09'));
  state.floor = 2; state.enemies = []; state.objective = { piece: state.targets[2], complete: true, moves: 1 }; state.exit.open = true;
  state.records = [{ floor: 0, turns: 1 }, { floor: 1, turns: 1 }];
  assert.deepEqual(findWinningRoute(state, { maxExpansions: 0 }), { status: 'solved', actions: [descend], explored: 0 });
});

test('search identity keeps the floor’s own clock and drops the run’s, gold and coins', () => {
  const state = createGame(getRawDaily('2026-11-09'));
  const key = positionKey(state);
  const later = structuredClone(state);
  // The same floor position, reached after a longer run with more gold and fewer coins on the floor.
  later.turns += 9; later.floorStart.turns += 9; later.gold += 4; later.treasure += 1;
  later.items = later.items.filter((item, index) => item.type !== 'coin' || index > 0);
  assert.ok(later.items.length < state.items.length);
  assert.equal(positionKey(later), key);
  // Moves made on this floor do count: monster tie-breaks and Collapse arrivals hash them.
  const waited = structuredClone(state); waited.turns += 1;
  assert.notEqual(positionKey(waited), key);
  assert.equal(positionKey(waited, false), positionKey(state, false), 'the rollout’s revisit heuristic ignores time');
  // So do off-balance and pinned monsters, and the powerup still lying there.
  const unbalanced = structuredClone(state); unbalanced.enemies[0].offBalance = true;
  const pinned = structuredClone(state); pinned.enemies[0].pinned = 2;
  const taken = structuredClone(state); taken.items = taken.items.filter((item) => item.type !== 'powerup');
  for (const other of [unbalanced, pinned, taken]) assert.notEqual(positionKey(other), key);
  // Classic comparison monsters hash the whole run's moves, so for them the run's clock stays.
  const classic = structuredClone(state); classic.classicMonsters = true;
  const classicLater = structuredClone(classic); classicLater.turns += 9; classicLater.floorStart.turns += 9;
  assert.notEqual(positionKey(classicLater), positionKey(classic));
});

test('each floor is certified from its standard start: how long the floors before it took changes nothing', () => {
  // Room to spare under the move cap and the budget, so the slower start below meets neither.
  const found = searchedRoute((daily, route) => route.explored <= 10_000 && verifyWinningRoute(createGame(daily), route.actions).metrics.turns <= MAX_ROUTE_MOVES - 10,
    { want: (daily) => daily.playerPiece !== 'pawn' });
  assert.ok(found, 'a searched route with room to spare');
  const { daily, route } = found;
  const { frames, starts } = replay(daily, route.actions);
  assert.equal(starts.length, 2);
  // Floor 2's start as the route reached it, and as a slower run with more gold would reach it.
  const start = frames[starts[0]];
  const slower = structuredClone(start);
  slower.turns += 7; slower.floorStart.turns += 7; slower.gold += 5;
  const rest = route.actions.slice(starts[0]);
  for (const from of [start, slower]) {
    const again = findWinningRoute(from);
    assert.equal(again.status, 'solved');
    assert.deepEqual(again.actions, rest);
  }
});

test('lives carry over: a pawn’s route spends at most four across the run, and each floor starts with what the last one left', () => {
  const found = searchedRoute(() => true, { start: '2031-05-01', want: (daily) => daily.playerPiece === 'pawn' });
  assert.ok(found, 'a searched pawn route');
  const { daily, route } = found;
  const { frames, starts } = replay(daily, route.actions);
  const proof = verifyWinningRoute(createGame(daily), route.actions);
  assert.equal(proof.valid, true);
  assert.ok(proof.metrics.livesLost <= 4);
  const hp = [0, ...starts].map((index) => frames[index].player.hp);
  assert.ok(hp.every((lives, floor) => !floor || lives <= hp[floor - 1]));
  assert.ok(frames.every((frame) => frame.player.hp >= PIECE_LIVES.pawn - 4));
  // From a floor-2 start with every spare life already spent, the search may lose none.
  const spent = structuredClone(frames[starts[0]]);
  spent.player.hp = PIECE_LIVES.pawn - 4;
  const strict = findWinningRoute(spent, { maxExpansions: 3000 });
  if (strict.status === 'solved') {
    let state = spent;
    for (const action of strict.actions) { state = act(state, action); assert.equal(state.player.hp, PIECE_LIVES.pawn - 4); }
  }
});

test('the search ranks positions by wall-aware move distances, not coordinates', () => {
  const state = createGame(getRawDaily('2026-11-09'));
  state.map = Array(8).fill('........');
  state.player = { ...state.player, piece: 'rook', x: 4, y: 6 };
  const target = { x: 4, y: 2 };
  assert.equal(targetDistance(state, target), 1, 'an open file: one move');
  // A wall between them: around it takes three moves, though they share a file.
  state.map[4] = '....#...';
  assert.equal(targetDistance(state, target), 3);
  assert.equal(targetDistance(state, target), distanceTable(state.map, 'rook')[(6 * 8 + 4) * 64 + 2 * 8 + 4]);
  // A knight jumps the wall; a bishop never lands on the other colour.
  state.player.piece = 'knight';
  assert.equal(targetDistance(state, target), 2);
  state.player.piece = 'bishop';
  assert.equal(targetDistance(state, { x: 4, y: 3 }), 10, 'the other colour counts as far away');
  assert.equal(targetDistance(state, { x: 2, y: 4 }), 1);
  // A pawn takes diagonally, and a target straight ahead is a promotion away.
  state.player.piece = 'pawn'; state.map[4] = '........';
  assert.equal(targetDistance(state, { x: 3, y: 5 }), 1);
  assert.ok(targetDistance(state, target) > 4);
});

test('generation tries up to sixteen candidate layouts, each on the same fixed budget, before the fallback bank', () => {
  assert.equal(ATTEMPTS, 16);
  const date = '2031-03-03', base = getRawDaily(date), tier = tierForDate(date);
  assert.equal(new Set(Array.from({ length: ATTEMPTS }, (_, attempt) => candidateSeed(base, attempt))).size, ATTEMPTS);
  // No assembly can reach an impossible target, so all sixteen are searched.
  const found = searchCandidates(base, tier, knobsFor(tier, base.playerPiece), ATTEMPTS, 99);
  assert.equal(found.length, ATTEMPTS);
  assert.ok(found.every((entry) => entry.explored <= 12_000));
  assert.throws(() => generateDaily(date, { maxAttempts: ATTEMPTS + 1 }), RangeError);
});

test('a day whose best still has a floor over par 14 searches more layouts until it has none', () => {
  assert.equal(EXTRA_ATTEMPTS, 16);
  // A knight day whose first sixteen layouts all hold eight pawn targets at par 21 or more on floor 1.
  const date = '2027-08-07', base = getRawDaily(date), tier = tierForDate(date);
  const found = searchCandidates(base, tier, knobsFor(tier, base.playerPiece));
  const best = rankFloors(found, targetForDate(date), tier)[0];
  assert.ok(found.length > ATTEMPTS && found.length <= ATTEMPTS + EXTRA_ATTEMPTS, `${found.length} layouts searched`);
  assert.ok(best.longest <= LONG_FLOOR_PAR, `longest floor par ${best.longest}`);
  // With a smaller budget (tooling) it never goes past it.
  assert.equal(searchCandidates(base, tier, knobsFor(tier, base.playerPiece), 4).length <= 4, true);
});

test('a floor plays the same whichever floors come before it: days assemble from their candidates’ floors', () => {
  // Two whole candidates of one date past the stored editions, then a day with floor 1 of the second and floors 2 and 3 of the first.
  const date = '2031-03-12', raw = getRawDaily(date), tier = tierForDate(date), knobs = knobsFor(tier, raw.playerPiece);
  const solved = [];
  for (let attempt = 0; solved.length < 2 && attempt < ATTEMPTS; attempt++) {
    const result = searchCandidate(candidateFor(raw, tier, knobs, attempt));
    if (result.status === 'solved') solved.push({ attempt, result });
  }
  assert.equal(solved.length, 2, 'two solved candidates');
  const [first, second] = solved;
  const floors = [second.attempt, first.attempt, first.attempt];
  const daily = candidateFor(raw, tier, knobs, floors);
  assert.deepEqual(daily.floorSeeds, floors.map((attempt) => candidateSeed(raw, attempt)));
  const actions = [...second.result.floors[0].actions, ...first.result.floors[1].actions, ...first.result.floors[2].actions];
  const proof = verifyWinningRoute(createGame(daily), actions);
  assert.equal(proof.valid, true, proof.reason);
  // Each floor's room is the one its own candidate built there.
  const rooms = (state) => { const { frames, starts } = replay(state, actions); return [0, ...starts].map((index) => frames[index]); };
  const assembled = rooms(daily);
  assert.deepEqual(assembled[0].map, createGame(candidateFor(raw, tier, knobs, second.attempt)).map);
  assert.deepEqual(assembled[0].enemies, createGame(candidateFor(raw, tier, knobs, second.attempt)).enemies);
  const firstStarts = (() => { const { frames, starts } = replay(candidateFor(raw, tier, knobs, first.attempt), first.result.actions); return starts.map((index) => frames[index]); })();
  for (const floor of [1, 2]) {
    assert.deepEqual(assembled[floor].map, firstStarts[floor - 1].map, `floor ${floor + 1}`);
    assert.deepEqual(assembled[floor].enemies, firstStarts[floor - 1].enemies, `floor ${floor + 1}`);
    assert.deepEqual(assembled[floor].items, firstStarts[floor - 1].items, `floor ${floor + 1}`);
  }
  // Its floors' moves, as the route spent them, add up to the whole run's.
  assert.equal(routeFloors(daily, actions).reduce((sum, part) => sum + part.turns, 0), proof.metrics.turns);
  // Without floorSeeds every floor shares the dungeon's seed, as before.
  assert.equal(candidateFor(raw, tier, knobs, first.attempt).floorSeeds, undefined);
});

test('a device-remembered day of the last candidate replays without searching', () => {
  let remembered = null;
  for (let day = 0; !remembered && day < 30; day++) {
    const date = dayAfter('2031-04-01', day), tier = tierForDate(date), knobs = knobsFor(tier, getRawDaily(date).playerPiece);
    const result = searchCandidate(candidate(date, ATTEMPTS - 1));
    // Certification applies the tier's rules to a remembered route too.
    if (result.status === 'solved' && result.metrics.threatenedDecisions >= knobs.minThreatenedDecisions && !freebieFloor(result.metrics, tier)) remembered = { date, tier, result };
  }
  assert.ok(remembered, 'a certifiable last candidate');
  const { date, tier, result } = remembered;
  const last = [ATTEMPTS - 1, ATTEMPTS - 1, ATTEMPTS - 1];
  const store = new Map([[`dchess-edition:v${GENERATOR_VERSION}:${date}`, JSON.stringify({ tier, attempt: last, route: encodeRoute(result.actions) })]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  try {
    const began = performance.now();
    const daily = generateDaily(date, { fallback: false });
    assert.ok(performance.now() - began < 1000, 'replayed, not searched');
    assert.deepEqual([daily.generation.source, daily.generation.attempt], ['generated', last]);
    assert.deepEqual(daily.generation.certificate.actions, result.actions);
  } finally { delete globalThis.localStorage; }
});
