// SPDX-License-Identifier: GPL-3.0-only
// The bishop pair: a bishop recruit joining your bishop would share your square
// colour, so its move that turn is a hop onto the other colour instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, getDaily, getShareText, legalMoves, recruitChoice, validateSave } from '../src/game.js';
import { createGame as createRawGame } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { autoExplainer } from '../src/explainers.js';
import { hash } from '../src/random.js';

const move = (x, y, recruit) => (recruit === undefined ? { type: 'move', x, y } : { type: 'move', x, y, recruit });
const at = (unit) => [unit.x, unit.y];
const types = (state) => state.events.map((event) => event.type);
const count = (state, type) => state.events.filter((event) => event.type === type).length;
const colour = (tile) => (tile.x + tile.y) % 2;
const SIDES = [[0, -1], [-1, 0], [1, 0], [0, 1]];
function dailyFor(piece) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece && daily.playerColor === 'white') return daily;
  }
  throw Error(`No ${piece} edition found`);
}
// An empty room on a plain day: your piece at (x, y), a bishop recruit waiting at
// `recruit`, and monsters frozen so nothing but the rule under test moves.
function scenario({ piece = 'bishop', recruit = [3, 3], from = [4, 4], recruitPiece = 'bishop', color = 'white' } = {}) {
  const state = createRawGame(dailyFor(piece === 'king' ? 'rook' : piece));
  state.playerColor = color; state.awaitingPlayer = false;
  Object.assign(state.player, { x: from[0], y: from[1], moved: true });
  state.map = Array(8).fill('........'); state.props = []; state.enemies = []; state.companion = null;
  state.items = [{ type: 'companion', piece: recruitPiece, x: recruit[0], y: recruit[1] }];
  delete state.modifier; delete state.ice; delete state.reinforcements; delete state.reinforcementsSkipped;
  state.objective = { piece: 'knight', complete: false };
  state.powers.freeze = 6;
  return state;
}
const foe = (id, piece, x, y) => ({ id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: true, phase: 'ready', target: null, intent: [] });
const wall = (state, x, y) => { state.map[y] = state.map[y].slice(0, x) + '#' + state.map[y].slice(x + 1); };
// Squares a bishop on `tile` could move to, walls, monsters and your piece blocking (a monster is a capture).
function reach(state, tile) {
  let squares = 0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    for (let x = tile.x + dx, y = tile.y + dy; x >= 0 && y >= 0 && x < 8 && y < 8 && state.map[y][x] !== '#'; x += dx, y += dy) {
      if (x === state.player.x && y === state.player.y) break;
      squares++;
      if (state.enemies.some((entry) => entry.x === x && entry.y === y)) break;
    }
  }
  return squares;
}
const tie = (state, tile) => hash(`${state.dungeonSeed ?? state.seed}:bishop-pair:${state.floor}:${tile.x},${tile.y}`);

test('recruiting a bishop with your bishop offers only its free side squares, all on the other colour', () => {
  const state = scenario();
  wall(state, 3, 2);
  state.enemies = [foe('side', 'knight', 2, 3), foe('far', 'king', 7, 0)];
  const choice = recruitChoice(state, move(3, 3));
  assert.equal(choice.hop, true);
  assert.deepEqual(at(choice.board.companion), [3, 3]);
  assert.deepEqual(choice.moves, [{ x: 4, y: 3, capture: false }, { x: 3, y: 4, capture: false }], 'the wall and the monster block two side squares');
  assert.ok(choice.moves.every((tile) => colour(tile) !== colour(state.player)));
  // A recruit that isn't hopping has no hop flag.
  const plain = scenario({ recruitPiece: 'rook' });
  assert.equal(recruitChoice(plain, move(3, 3)).hop, undefined);
});

test('on Manual you pick the side square; holding, any other square or a capture is no action', () => {
  const state = scenario();
  state.enemies = [foe('decoy', 'king', 5, 5), foe('far', 'queen', 7, 0)];
  const hopped = act(state, move(3, 3, { x: 3, y: 4 }));
  assert.deepEqual(at(hopped.companion), [3, 4]);
  assert.equal(hopped.companion.sharing, false);
  assert.notEqual(colour(hopped.companion), colour(hopped.player));
  for (const recruit of ['hold', { x: 2, y: 2 } /* its own colour */, { x: 5, y: 5 } /* a capture on its diagonal */, { x: 3, y: 5 } /* not a side square */, { x: 3, y: 3 } /* its own square */]) {
    assert.equal(act(state, move(3, 3, recruit)), state, JSON.stringify(recruit));
  }
  // Every side square works.
  for (const [dx, dy] of SIDES) assert.deepEqual(at(act(state, move(3, 3, { x: 3 + dx, y: 3 + dy })).companion), [3 + dx, 3 + dy]);
});

test('the hop is the recruit’s move for the turn: one recruit phase, one move, no extra tempo', () => {
  const state = scenario();
  state.powers.freeze = 0;
  state.enemies = [foe('far', 'king', 0, 7)];
  for (const next of [act(state, move(3, 3)), act(state, move(3, 3, { x: 4, y: 3 }))]) {
    assert.equal(next.turns, state.turns + 1);
    assert.equal(count(next, 'companion-phase'), 1);
    assert.equal(count(next, 'companion-move'), 1);
    assert.equal(count(next, 'bishop-pair'), 1);
    assert.equal(count(next, 'enemy-phase'), 1, 'the monsters still answer once');
    const order = types(next);
    assert.ok(order.indexOf('move') < order.indexOf('companion-recruit') && order.indexOf('companion-recruit') < order.indexOf('companion-phase'));
    assert.ok(order.indexOf('companion-phase') < order.indexOf('bishop-pair') && order.indexOf('bishop-pair') < order.indexOf('enemy-phase'));
    const hop = next.events.find((event) => event.type === 'bishop-pair');
    assert.deepEqual(hop.from, { x: 3, y: 3 });
    assert.deepEqual(next.events.find((event) => event.type === 'companion-move'), { type: 'companion-move', piece: 'bishop', from: { x: 3, y: 3 }, x: hop.x, y: hop.y });
    assert.equal(next.captures, state.captures, 'the hop never captures');
    assert.deepEqual(next.feats, [{ floor: 0, kind: 'bishop-pair' }]);
    assert.match([...(next.notes ?? []), next.message].join(' '), /A bishop joins you this floor\..*Holy duo! Your recruit hopped to the other colour, so your two bishops cover every square\./);
  }
  // From then on it is an ordinary bishop recruit on the other colour.
  const next = act(act(state, move(3, 3, { x: 4, y: 3 })), { type: 'wait', recruit: 'hold' });
  assert.deepEqual(at(next.companion), [4, 3]);
  assert.equal(count(next, 'bishop-pair'), 0);
  assert.equal(recruitChoice(next, { type: 'wait' }).hop, undefined);
  assert.ok(recruitChoice(next, { type: 'wait' }).moves.every((tile) => colour(tile) === colour(next.companion)));
});

test('on Auto it hops to the side square whose diagonals reach the most squares', () => {
  const state = scenario({ recruit: [3, 5], from: [4, 6] });
  state.enemies = [foe('far', 'king', 7, 0)];
  const reaches = SIDES.map(([dx, dy]) => ({ x: 3 + dx, y: 5 + dy })).map((tile) => ({ tile, reach: reach({ ...state, player: { ...state.player, x: 3, y: 5 } }, tile) }));
  assert.deepEqual(reaches.map((entry) => entry.reach), [13, 11, 11, 9]);
  assert.deepEqual(at(act(state, move(3, 5)).companion), [3, 4]);
  // A wall cutting that square's long diagonal sends it to the next best: (4,5) reaches 11, (3,4) now 10.
  wall(state, 5, 2);
  assert.deepEqual(at(act(state, move(3, 5)).companion), [4, 5]);
});

test('a tie in reach goes by the day’s seed, the same way every time', () => {
  // (3,3) is symmetric across the long diagonal: (3,4) and (4,3) both reach 13 squares.
  const picks = new Set();
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const state = scenario();
    state.dungeonSeed = seed;
    const best = [{ x: 4, y: 3 }, { x: 3, y: 4 }].sort((a, b) => tie(state, a) - tie(state, b))[0];
    const next = act(state, move(3, 3));
    assert.deepEqual(at(next.companion), at(best), `seed ${seed}`);
    assert.deepEqual(act(state, move(3, 3)), next);
    picks.add(at(next.companion).join());
  }
  assert.equal(picks.size, 2, 'different days break the tie differently');
});

test('with all four side squares blocked, Manual offers every free square of the other colour', () => {
  const state = scenario();
  wall(state, 3, 2); wall(state, 4, 3);
  state.enemies = [foe('w', 'bishop', 2, 3), foe('s', 'knight', 3, 4), foe('far', 'king', 7, 7)];
  const choice = recruitChoice(state, move(3, 3));
  assert.equal(choice.hop, true);
  const expected = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 1 && !['3,2', '4,3', '2,3', '3,4'].includes(`${x},${y}`)) expected.push({ x, y, capture: false });
  assert.deepEqual(choice.moves, expected);
  assert.equal(choice.moves.length, 28);
  // The player picks any of them, near or far.
  assert.deepEqual(at(act(state, move(3, 3, { x: 0, y: 7 })).companion), [0, 7]);
  assert.deepEqual(at(act(state, move(3, 3, { x: 6, y: 1 })).companion), [6, 1]);
  // Still never a capture, a wall, or its own colour.
  for (const recruit of [{ x: 7, y: 7 }, { x: 2, y: 3 }, { x: 3, y: 2 }, { x: 2, y: 2 }, 'hold']) assert.equal(act(state, move(3, 3, recruit)), state, JSON.stringify(recruit));
});

test('with all four side squares blocked, Auto takes the nearest free square of the other colour in king steps, ties by seed', () => {
  const picks = new Set();
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) {
    const state = scenario();
    state.dungeonSeed = seed;
    wall(state, 3, 2); wall(state, 4, 3);
    state.enemies = [foe('w', 'bishop', 2, 3), foe('s', 'knight', 3, 4), foe('far', 'king', 7, 7)];
    // Nothing of the other colour lies one king step away, so eight squares two steps away tie.
    const ring = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 1 && Math.max(Math.abs(x - 3), Math.abs(y - 3)) === 2) ring.push({ x, y });
    assert.equal(ring.length, 8);
    const best = ring.sort((a, b) => tie(state, a) - tie(state, b))[0];
    const next = act(state, move(3, 3));
    assert.deepEqual(at(next.companion), at(best), `seed ${seed}`);
    picks.add(at(next.companion).join());
  }
  assert.ok(picks.size > 1, 'the seed decides among equally near squares');
  // A nearer free square wins outright.
  const state = scenario();
  wall(state, 3, 2); wall(state, 4, 3);
  state.enemies = [foe('w', 'bishop', 2, 3), foe('s', 'knight', 3, 4), foe('far', 'king', 7, 7)];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 1 && Math.max(Math.abs(x - 3), Math.abs(y - 3)) === 2 && !(x === 5 && y === 4)) wall(state, x, y);
  assert.deepEqual(at(act(state, move(3, 3)).companion), [5, 4]);
});

test('with nowhere of the other colour free, the recruit stays put, and hops as soon as it can', () => {
  const state = scenario();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 1 && !(x === 3 && y === 4)) wall(state, x, y);
  state.enemies = [foe('plug', 'knight', 3, 4), foe('far', 'king', 7, 7)];
  const choice = recruitChoice(state, move(3, 3));
  assert.deepEqual(choice.moves, []);
  assert.equal(choice.hop, true);
  const stayed = act(state, move(3, 3, 'hold'));
  assert.deepEqual(at(stayed.companion), [3, 3]);
  assert.deepEqual(act(state, move(3, 3)).companion, stayed.companion);
  assert.equal(act(state, move(3, 3, { x: 2, y: 2 })), state, 'its own colour is never on offer');
  // Once (3,4) is free, the next move it makes is the hop.
  stayed.enemies = stayed.enemies.filter((entry) => entry.id !== 'plug');
  const after = act(stayed, { type: 'wait' });
  assert.deepEqual(at(after.companion), [3, 4]);
  assert.equal(count(after, 'bishop-pair'), 1);
});

test('only a bishop recruiting a bishop hops', () => {
  for (const [piece, recruitPiece] of [['bishop', 'rook'], ['bishop', 'queen'], ['queen', 'bishop'], ['rook', 'bishop'], ['king', 'bishop']]) {
    const state = scenario({ piece, recruitPiece, from: piece === 'rook' ? [3, 5] : [4, 4] });
    if (piece === 'king') { state.startingPiece = 'king'; state.player.piece = 'king'; }
    else state.player.piece = piece;
    state.enemies = [foe('far', 'king', 7, 0)];
    assert.ok(legalMoves(state).some((tile) => tile.x === 3 && tile.y === 3), `${piece} reaches the recruit`);
    const next = act(state, move(3, 3, 'hold'));
    assert.deepEqual(at(next.companion), [3, 3], `${piece} + ${recruitPiece} may hold`);
    assert.equal(count(next, 'bishop-pair'), 0);
    assert.equal(recruitChoice(state, move(3, 3)).hop, undefined);
  }
});

test('as black, the recruit hops after your move, which follows the monsters’ first move', () => {
  const state = scenario({ color: 'black' });
  state.enemies = [foe('far', 'king', 0, 7)];
  const next = act(state, move(3, 3));
  const order = types(next);
  assert.ok(order.indexOf('enemy-phase') < order.indexOf('move') && order.indexOf('move') < order.indexOf('bishop-pair'));
  assert.notEqual(colour(next.companion), colour(next.player));
  assert.equal(count(next, 'enemy-phase'), 1);
});

test('the rule is the position: if a Borrowed move puts your bishop on the recruit’s colour, it hops again', () => {
  const state = scenario();
  state.powers.leap = 1;
  state.enemies = [foe('far', 'king', 7, 0)];
  const paired = act(state, move(3, 3, { x: 3, y: 4 }));
  assert.equal(paired.powers.leap, 1, 'a bishop move keeps the Borrowed move');
  // A knight's jump changes your square colour: now both bishops stand on it.
  const leapt = act(paired, move(1, 2, { x: 2, y: 4 }));
  assert.equal(leapt.powers.leap, 0);
  assert.equal(colour(leapt.player), colour(paired.companion));
  assert.deepEqual(at(leapt.companion), [2, 4]);
  assert.notEqual(colour(leapt.companion), colour(leapt.player));
  assert.deepEqual(leapt.feats, [{ floor: 0, kind: 'bishop-pair' }, { floor: 0, kind: 'bishop-pair' }]);
});

test('the bishop pair is a feat with a What? explainer, never a share-card mark or a pop-up', () => {
  const state = scenario();
  state.enemies = [foe('far', 'king', 7, 0)];
  const next = act(state, move(3, 3));
  assert.deepEqual(next.feats, [{ floor: 0, kind: 'bishop-pair' }]);
  assert.equal(getShareText(next, null, { now: new Date(Date.UTC(2026, 10, 7)) }), getShareText({ ...next, feats: [] }, null, { now: new Date(Date.UTC(2026, 10, 7)) }));
  // Its explainer opens from its line's What? button (main.js), not by itself.
  assert.equal(autoExplainer(next.events, () => false), null);
  assert.equal(autoExplainer([{ type: 'bishop-pair' }], () => false), null);
});

// Real bishop days whose first floor waits with a bishop recruit. It waits
// three or more moves out (composed rooms keep it off the planted line), so
// the bishop starts one diagonal step from it, as if it had walked there.
function bishopDays(limit) {
  const days = [];
  for (let day = 0; day < 730 && days.length < limit; day++) {
    const date = new Date(Date.UTC(2026, 10, 7 + day)).toISOString().slice(0, 10);
    const raw = getRawDaily(date);
    if (raw.playerPiece !== 'bishop') continue;
    const state = createGame(getDaily(date));
    const recruit = state.items.find((item) => item.type === 'companion');
    if (recruit?.piece !== 'bishop') continue;
    const step = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => ({ x: recruit.x + dx, y: recruit.y + dy }))
      .find((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < 8 && tile.y < 8 && state.map[tile.y][tile.x] !== '#'
        && !state.enemies.some((foe) => foe.x === tile.x && foe.y === tile.y) && !state.items.some((item) => item.x === tile.x && item.y === tile.y));
    if (!step) continue;
    Object.assign(state.player, { x: step.x, y: step.y, moved: true });
    if (legalMoves(state).some((tile) => tile.x === recruit.x && tile.y === recruit.y)) days.push({ date, state, recruit });
  }
  return days;
}

test('on real bishop days the recruit never stays on your colour, and every save validates', () => {
  const days = bishopDays(4);
  assert.ok(days.length >= 2, `${days.length} bishop days with a bishop recruit`);
  for (const { date, state: start, recruit } of days) {
    const state = structuredClone(start);
    // Frozen monsters strike nothing, so the step onto the recruit is always safe.
    state.powers.freeze = 3;
    assert.equal(colour(recruit), colour(state.player), `${date}: it waits on your colour`);
    const choice = recruitChoice(state, move(recruit.x, recruit.y));
    assert.equal(choice.hop, true, date);
    const outcomes = [act(state, move(recruit.x, recruit.y)), ...choice.moves.map((tile) => act(state, move(recruit.x, recruit.y, { x: tile.x, y: tile.y })))];
    for (const next of outcomes) {
      assert.notEqual(colour(next.companion), colour(next.player), date);
      assert.equal(count(next, 'bishop-pair'), 1, date);
      // A save with the hop's event and feat loads.
      assert.equal(validateSave(JSON.parse(JSON.stringify(next)), date), true, date);
    }
  }
});

test('saves reject a malformed bishop-pair feat', () => {
  const { date, state: start, recruit } = bishopDays(1)[0];
  const state = structuredClone(start);
  state.powers.freeze = 3;
  const next = act(state, move(recruit.x, recruit.y));
  assert.equal(count(next, 'bishop-pair'), 1);
  const saved = JSON.parse(JSON.stringify(next));
  assert.equal(validateSave(saved, date), true);
  for (const feats of [[{ floor: 0, kind: 'bishop-pair', extra: 1 }], [{ floor: 1, kind: 'bishop-pair' }], [{ floor: 0, kind: 'bishop-duo' }]]) {
    assert.equal(validateSave({ ...saved, feats }, date), false, JSON.stringify(feats));
  }
});
