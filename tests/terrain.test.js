// SPDX-License-Identifier: GPL-3.0-only
// Moving terrain (src/terrain.js): the one seam for squares that are solid
// only some of the time, and the two room modifiers built on it, the
// crumbling floor (src/cracks.js) and the gates (src/gates.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { act, createGame, legalMoves, validateSave, resetFloor, walkable, dangerTiles, hopelessFloor, unreachablePickups, recruitChoice } from '../src/rules.js';
import { MODIFIERS, TERRAIN_MODIFIERS, modifierFor, modifierOf, modifierStatus } from '../src/modifiers.js';
import { solid, floorAt, shutAt, shutNow, terrainMap, settled, maskOf } from '../src/terrain.js';
import { cracked } from '../src/cracks.js';
import { gateLooks, dueShut, GATE_HOLD, GATE_CYCLE } from '../src/gates.js';
import { positionKey } from '../src/fairness.js';
import { shortestWins } from '../src/composer.js';
import { observe } from '../src/human-bot.js';
import { room, withRooms } from './fixtures/rooms.js';

// 2026-11-13: a rook's day whose floor 1 targets knights.
const DATE = '2026-11-13';
const daily = (modifier, ...rooms) => withRooms({ ...getRawDaily(DATE), modifier, difficulty: 'fair' }, ...rooms);
const game = (modifier, ...rooms) => createGame(daily(modifier, ...rooms));
// A decoy of any role, by a species of its own.
const decoy = (piece, x, y) => ({ x, y, species: { id: 'bat', palette: 'ice', name: 'Ice bat', piece } });
// The floor's target, a knight, walled in on a8 so it never moves and nothing reaches it.
const SEALED = { enemies: [{ x: 0, y: 0, cast: 0 }], walls: [[1, 2], [2, 1]] };
const sealed = ({ enemies = [], walls = [], ...rest } = {}) => room({ ...rest, enemies: [...SEALED.enemies, ...enemies], walls: [...SEALED.walls, ...walls] });
const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
const has = (list, x, y) => list.some((tile) => tile.x === x && tile.y === y);
const saved = (state, modifier, ...rooms) => validateSave(JSON.parse(JSON.stringify(state)), DATE, daily(modifier, ...rooms));

test('no date draws the two preview modifiers, and a plain day carries no terrain', () => {
  assert.deepEqual(Object.keys(MODIFIERS), ['none', 'ice', 'collapse']);
  assert.deepEqual(TERRAIN_MODIFIERS, ['cracks', 'gates']);
  for (let offset = 0; offset < 800; offset++) {
    const date = new Date(Date.parse('2026-11-01') + offset * 86_400_000).toISOString().slice(0, 10);
    assert.ok(!TERRAIN_MODIFIERS.includes(modifierFor(date)));
  }
  // They are entries all the same, so a day that carries one is named and explained.
  assert.equal(modifierOf({ modifier: 'cracks' }).name, 'Crumbling floor');
  assert.equal(modifierOf({ modifier: 'gates' }).name, 'Gates');
  assert.equal(modifierStatus({ modifier: 'gates' }), '⛓️ Gates');
  // A room's tiles and gates mean nothing without the day's modifier.
  const laid = sealed({ cracks: [{ x: 4, y: 4 }], gates: [{ x: 3, y: 3, phase: 0 }] });
  for (const modifier of ['none', 'ice', 'collapse']) {
    const state = game(modifier, laid);
    for (const field of ['shut', 'cracks', 'pits', 'gates', 'gateTurns']) assert.equal(state[field], undefined, `${modifier}: ${field}`);
    assert.equal(walkable(state, 3, 3), true);
    assert.equal(terrainMap(state), state.map);
    assert.equal(settled(state), state);
    assert.equal(saved(act(state, wait), modifier, laid), true);
  }
});

test('one seam: a wall, a pit and a shut gate are solid alike', () => {
  const state = game('gates', sealed({ walls: [[6, 6]], gates: [{ x: 4, y: 4, phase: 0 }, { x: 5, y: 4, phase: 1 }] }));
  assert.equal(solid(state, 6, 6), true);
  assert.equal(floorAt(state, 6, 6), false);
  assert.equal(solid(state, 4, 4), true);
  assert.equal(floorAt(state, 4, 4), true, 'a shut gate is still floor underneath');
  assert.equal(shutAt(state, 4, 4), true);
  assert.equal(solid(state, 5, 4), false, 'an open gate is floor');
  assert.equal(solid(state, -1, 0), true);
  assert.equal(walkable(state, 4, 4), false);
  assert.equal(walkable(state, 5, 4), true);
  assert.deepEqual(state.shut, maskOf([{ x: 4, y: 4 }]));
  // The map anyone plans over shows it as a wall; the room's own map never changes.
  assert.equal(terrainMap(state)[4], '....#...');
  assert.equal(state.map[4], '........');
  assert.equal(observe(state).map[4], '....#...');
  // With every gate open: what could ever happen.
  assert.equal(walkable(settled(state), 4, 4), true);
});

test('crumbling: a cracked tile falls when the piece on it steps off, and blocks from then on', () => {
  const laid = sealed({ cracks: [{ x: 4, y: 6 }, { x: 4, y: 4 }] });
  let state = game('cracks', laid);
  assert.deepEqual(state.cracks, [{ x: 4, y: 4 }, { x: 4, y: 6 }]);
  assert.deepEqual(state.pits, []);
  assert.ok(cracked(state, { x: 4, y: 6 }));
  assert.equal(saved(state, 'cracks', laid), true);
  // The rook steps up one: its start falls away behind it.
  state = act(state, move(4, 5));
  assert.deepEqual(state.pits, [{ x: 4, y: 6 }]);
  assert.ok(state.events.some((event) => event.type === 'crumble' && event.x === 4 && event.y === 6 && event.by === 'player'));
  assert.equal(walkable(state, 4, 6), false);
  assert.ok(!has(legalMoves(state), 4, 6), 'no way back');
  assert.ok(!has(legalMoves(state), 4, 7), 'and no line across the pit');
  assert.equal(saved(state, 'cracks', laid), true);
  // Sliding across a cracked tile leaves it whole: only a piece that stood there breaks it.
  state = act(state, move(4, 3));
  assert.ok(cracked(state, { x: 4, y: 4 }));
  assert.deepEqual(state.pits, [{ x: 4, y: 6 }]);
  assert.ok(has(legalMoves(state), 4, 5) && !has(legalMoves(state), 4, 6));
  assert.equal(saved(state, 'cracks', laid), true);
  // Restarting the floor mends every tile.
  const again = resetFloor(state);
  assert.deepEqual(again.pits, []);
  assert.deepEqual(again.cracks, [{ x: 4, y: 4 }, { x: 4, y: 6 }]);
  assert.equal(walkable(again, 4, 6), true);
});

test('crumbling: monsters break tiles too, and one with no step left stays put', () => {
  // A decoy rook that can only pace f5 and g5; f5 is cracked.
  const laid = sealed({ start: { x: 7, y: 6 }, enemies: [decoy('rook', 5, 3)], walls: [[4, 3], [5, 2], [5, 4], [7, 3], [6, 2], [6, 4]], cracks: [{ x: 5, y: 3 }] });
  let state = game('cracks', laid);
  state = act(state, wait);
  const rook = () => state.enemies.find((foe) => foe.piece === 'rook');
  assert.deepEqual([rook().x, rook().y], [6, 3]);
  assert.deepEqual(state.pits, [{ x: 5, y: 3 }]);
  assert.ok(state.events.some((event) => event.type === 'crumble' && event.by === rook().id));
  assert.equal(saved(state, 'cracks', laid), true);
  // Its way back is gone: it has no step, and stays.
  state = act(state, wait);
  assert.deepEqual([rook().x, rook().y], [6, 3]);
  assert.equal(saved(state, 'cracks', laid), true);
});

test('crumbling: a capture on a cracked tile holds it until the taker leaves; a knight jumps a pit', () => {
  // A decoy pawn (the floor's second decoy species) on a cracked tile, blocked by the rook standing under it.
  const laid = sealed({ start: { x: 5, y: 6 }, enemies: [{ x: 5, y: 5, cast: 2 }], cracks: [{ x: 5, y: 5 }] });
  assert.equal(getRawDaily(DATE).species[4].piece, 'pawn');
  let state = game('cracks', laid);
  state = act(state, move(5, 5));
  assert.equal(state.enemies.length, 1, 'the pawn is taken');
  assert.ok(cracked(state, { x: 5, y: 5 }), 'the tile holds its taker');
  assert.deepEqual(state.pits, []);
  state = act(state, move(5, 2));
  assert.deepEqual(state.pits, [{ x: 5, y: 5 }]);
  assert.equal(saved(state, 'cracks', laid), true);
  // A knight on e1 jumps to its squares as ever; a pit is a square it can't land on, never one in its way.
  const knight = structuredClone(state);
  Object.assign(knight.player, { piece: 'knight', x: 4, y: 7 });
  assert.ok(has(legalMoves(knight), 6, 6) && has(legalMoves(knight), 3, 5));
  const beside = structuredClone(state);
  Object.assign(beside.player, { piece: 'knight', x: 4, y: 7 });
  beside.pits = [{ x: 5, y: 5 }, { x: 4, y: 6 }]; shutNow(beside);
  assert.ok(has(legalMoves(beside), 3, 5), 'the pit in front of it is no bar');
  Object.assign(beside.player, { x: 6, y: 7 });
  assert.ok(!has(legalMoves(beside), 5, 5), 'no piece lands in a pit');
});

test('crumbling: no tile is cracked under a waiting recruit, and a lunge at a pit goes nowhere', () => {
  // A decoy rook walled in on e6, aimed down the file at the rook's cracked start square.
  const laid = sealed({ enemies: [decoy('rook', 4, 2)], walls: [[3, 2], [5, 2], [4, 1]], items: [{ x: 6, y: 4, type: 'companion', piece: 'knight' }], cracks: [{ x: 4, y: 6 }, { x: 6, y: 4 }] });
  let state = game('cracks', laid);
  assert.deepEqual(state.cracks, [{ x: 4, y: 6 }], 'the tile under the recruit is left whole: a recruit is never lost');
  const rook = () => state.enemies.find((foe) => foe.piece === 'rook');
  assert.equal(rook().phase, 'aim');
  // Sidestep: the square it aimed at is a pit now, so the lunge has nowhere to land.
  state = act(state, move(5, 6));
  assert.deepEqual(state.pits, [{ x: 4, y: 6 }]);
  assert.deepEqual([rook().x, rook().y], [4, 2]);
  assert.equal(rook().offBalance, true);
  assert.ok(state.events.some((event) => event.type === 'miss' && event.id === rook().id));
  assert.equal(state.hits, 0);
  assert.equal(saved(state, 'cracks', laid), true);
});

test('crumbling: a piece left with no move at all starts its floor over, tiles mended', () => {
  // A walled file of three squares, a3, a2 and a1; the rook starts on a1, and a1 and a2 are cracked.
  const laid = sealed({ start: { x: 0, y: 7 }, walls: [[1, 5], [1, 6], [1, 7], [0, 4]], cracks: [{ x: 0, y: 7 }, { x: 0, y: 6 }] });
  let state = game('cracks', laid);
  state = act(state, move(0, 5));
  assert.deepEqual(state.pits, [{ x: 0, y: 7 }]);
  state = act(state, move(0, 6));
  assert.deepEqual(legalMoves(state).map(({ x, y }) => [x, y]), [[0, 5]]);
  // Back to a3 off the last cracked tile: nothing is left but the square it stands on.
  state = act(state, move(0, 5));
  assert.ok(state.events.some((event) => event.type === 'restart' && event.scope === 'floor'));
  assert.deepEqual([state.player.x, state.player.y], [0, 7]);
  assert.deepEqual(state.pits, []);
  assert.equal(state.cracks.length, 2);
  assert.equal(state.turns, 0);
  assert.equal(saved(state, 'cracks', laid), true);
});

test('crumbling: a target sealed off by a pit makes the floor hopeless, so the restart is offered', () => {
  // The walled-in knight on a8 can only be reached from a7: b8 is a wall, and a7 is cracked.
  const laid = sealed({ start: { x: 0, y: 6 }, walls: [[1, 0]], cracks: [{ x: 0, y: 1 }] });
  let state = game('cracks', laid);
  state = act(state, move(0, 1));
  assert.equal(hopelessFloor(state), false, 'standing on the tile, the knight is one move away');
  state = act(state, move(0, 4));
  assert.deepEqual(state.pits, [{ x: 0, y: 1 }]);
  assert.equal(hopelessFloor(state), true);
  assert.equal(hopelessFloor(resetFloor(state)), false);
});

test('gates: shut one move, open the next, each from its own beat', () => {
  const gates = [0, 1].map((phase) => ({ x: 2 + phase, y: 3, phase }));
  const laid = sealed({ gates });
  let state = game('gates', laid);
  const shut = () => state.gates.map((gate) => (gate.shut ? 'S' : 'O')).join('');
  const seen = [shut()];
  for (let n = 0; n < 5; n++) {
    state = act(state, wait);
    seen.push(shut());
    assert.equal(saved(state, 'gates', laid), true);
    assert.deepEqual(state.shut, maskOf(state.gates.filter((gate) => gate.shut)));
    // Every turn changes every gate, and says so.
    assert.ok(state.events.some((event) => event.type === 'gates' && event.turned.length === 2));
  }
  assert.deepEqual(seen, ['SO', 'OS', 'SO', 'OS', 'SO', 'OS']);
  assert.equal(GATE_HOLD, 1);
  assert.equal(GATE_CYCLE, 2);
  assert.equal(dueShut({ phase: 0 }, 0), true);
  assert.equal(dueShut({ phase: 0 }, 1), false);
  assert.equal(dueShut({ phase: 1 }, 1), true);
  // The board shows a gate as shut or open and nothing more: what is up now is down next move.
  assert.deepEqual(gateLooks(state), [{ x: 2, y: 3, shut: false }, { x: 3, y: 3, shut: true }]);
  // Restarting the floor starts the rhythm over.
  assert.equal(resetFloor(state).gates.map((gate) => (gate.shut ? 'S' : 'O')).join(''), 'SO');
  // A room lays a gate on one beat or the other.
  assert.throws(() => game('gates', sealed({ gates: [{ x: 2, y: 3, phase: 2 }] })));
});

test('gates: through a turn the gates look as they did when it began, the recruit’s order included', () => {
  // A king recruit beside the rook's start; g5 is open and g3 shut, and they change after this move.
  const laid = sealed({ start: { x: 3, y: 6 }, items: [{ x: 3, y: 5, type: 'companion', piece: 'king' }], gates: [{ x: 6, y: 3, phase: 1 }, { x: 6, y: 5, phase: 0 }] });
  let state = game('gates', laid);
  const before = gateLooks(state);
  assert.deepEqual(before, [{ x: 6, y: 3, shut: false }, { x: 6, y: 5, shut: true }]);
  // The position as the recruit's order is asked for: your move is played, the monsters' is not, and no gate has turned.
  const asked = recruitChoice(state, move(3, 5));
  assert.ok(asked.board.turns > state.turns);
  assert.deepEqual(gateLooks(asked.board), before);
  state = act(state, { ...move(3, 5), recruit: 'hold' });
  assert.deepEqual(gateLooks(state), [{ x: 6, y: 3, shut: true }, { x: 6, y: 5, shut: false }]);
  assert.equal(state.gateTurns, 1);
});

test('gates: a shut gate blocks standing and lines like a wall, and gates change between turns', () => {
  // d5 shuts after the first move; the rook starts on d2.
  const laid = sealed({ start: { x: 3, y: 6 }, gates: [{ x: 3, y: 3, phase: 1 }] });
  let state = game('gates', laid);
  assert.ok(has(legalMoves(state), 3, 3) && has(legalMoves(state), 3, 0), 'open: floor, and the file runs through it');
  state = act(state, move(3, 5));
  assert.equal(state.gates[0].shut, true);
  assert.ok(!has(legalMoves(state), 3, 3) && !has(legalMoves(state), 3, 2) && has(legalMoves(state), 3, 4), 'shut: the file ends below it');
  assert.ok(state.events.some((event) => event.type === 'gates' && event.turned.some((gate) => gate.x === 3 && gate.shut)));
  // A knight jumps it.
  const knight = structuredClone(state);
  Object.assign(knight.player, { piece: 'knight', x: 3, y: 4 });
  assert.ok(has(legalMoves(knight), 2, 2) && has(legalMoves(knight), 4, 2));
});

test('gates: a gate never shuts on a piece, and its rhythm never shifts', () => {
  const laid = sealed({ start: { x: 3, y: 6 }, gates: [{ x: 3, y: 3, phase: 1 }] });
  let state = game('gates', laid);
  // Onto the open gate: due shut for the next move, it stays open under the rook.
  state = act(state, move(3, 3));
  assert.equal(state.gates[0].shut, false);
  assert.equal(dueShut(state.gates[0], 1), true);
  assert.deepEqual(gateLooks(state), [{ x: 3, y: 3, shut: false }], 'shown open');
  assert.equal(saved(state, 'gates', laid), true);
  // Left on the move it was held open: its open move comes next, so it is open, and shut the move after.
  const off = act(state, move(3, 5));
  assert.equal(off.gates[0].shut, false);
  assert.equal(saved(off, 'gates', laid), true);
  assert.equal(act(off, wait).gates[0].shut, true, 'its rhythm never shifted');
  // Stood in through its shut move and left on its open one: it shuts as that turn ends.
  const stayed = act(state, wait);
  assert.equal(stayed.gates[0].shut, false);
  assert.equal(act(stayed, move(3, 5)).gates[0].shut, true);
});

test('gates: a wound-up monster whose path a gate shut on lunges, bounces and stands off-balance', () => {
  const laid = sealed({ start: { x: 6, y: 6 }, enemies: [decoy('rook', 6, 1)], gates: [{ x: 6, y: 3, phase: 0 }] });
  const state = game('gates', laid);
  // Set by hand: the rook wound up down the file while the gate stood open; the gate has shut since.
  const rook = state.enemies.find((foe) => foe.piece === 'rook');
  Object.assign(rook, { phase: 'aim', target: { x: 6, y: 6 }, intent: [2, 3, 4, 5, 6].map((y) => ({ x: 6, y })) });
  assert.equal(state.gates[0].shut, true);
  assert.deepEqual(dangerTiles(state), [{ x: 6, y: 2 }], 'its path is shown as far as it still reaches');
  assert.equal(observe(state).monsters.find((foe) => foe.id === rook.id).lane.length, 1);
  assert.equal(saved(state, 'gates', laid), true, 'a path drawn before the gate shut is still a valid save');
  const next = act(state, wait);
  const after = next.enemies.find((foe) => foe.id === rook.id);
  assert.equal(next.hits, 0);
  assert.deepEqual([after.x, after.y, after.offBalance], [6, 1, true]);
});

test('gates: shut gates never corner a piece, strand a pickup or make a floor hopeless', () => {
  // The rook's start is walled in but for a gate, shut now and open next move.
  const laid = sealed({ walls: [[3, 6], [5, 6], [4, 7]], gates: [{ x: 4, y: 5, phase: 0 }], items: [{ x: 4, y: 3, type: 'coin' }] });
  let state = game('gates', laid);
  assert.deepEqual(legalMoves(state), []);
  assert.deepEqual(unreachablePickups(state), [], 'the coin beyond the gate can be reached');
  assert.equal(hopelessFloor(state), false);
  state = act(state, wait);
  assert.ok(!state.events.some((event) => event.type === 'restart'), 'waiting answers a shut gate');
  assert.equal(state.gates[0].shut, false);
  assert.ok(has(legalMoves(state), 4, 3));
});

test('saves: terrain travels with the save, reloads mid-floor and must agree with the board', () => {
  const cracks = sealed({ cracks: [{ x: 4, y: 6 }, { x: 4, y: 4 }] });
  const fallen = act(game('cracks', cracks), move(4, 5));
  const reloaded = JSON.parse(JSON.stringify(fallen));
  assert.equal(validateSave(reloaded, DATE, daily('cracks', cracks)), true);
  assert.deepEqual(act(reloaded, move(4, 3)).pits, act(fallen, move(4, 3)).pits);
  const tampered = (change) => { const copy = JSON.parse(JSON.stringify(fallen)); change(copy); return validateSave(copy, DATE, daily('cracks', cracks)); };
  assert.equal(tampered((save) => { save.pits = []; shutNow(save); }), false, 'a pit mended');
  assert.equal(tampered((save) => { save.pits.push({ x: 0, y: 7 }); shutNow(save); }), false, 'a pit where no tile was cracked');
  assert.equal(tampered((save) => { save.shut = [0, 0]; }), false, 'the board out of step with the pits');
  assert.equal(tampered((save) => { save.cracks = []; }), false, 'a cracked tile gone without a pit');
  assert.equal(tampered((save) => { delete save.shut; }), false);
  assert.equal(validateSave(reloaded, DATE, daily('cracks', sealed({ cracks: [{ x: 4, y: 6 }] }))), false, 'another room’s tiles');
  assert.equal(validateSave(reloaded, DATE, daily('none', cracks)), false, 'another day’s modifier');

  const gates = sealed({ gates: [{ x: 2, y: 3, phase: 1 }, { x: 5, y: 3, phase: 0 }] });
  const turned = act(game('gates', gates), wait);
  const again = JSON.parse(JSON.stringify(turned));
  assert.equal(validateSave(again, DATE, daily('gates', gates)), true);
  assert.deepEqual(act(again, wait).gates, act(turned, wait).gates);
  const forged = (change) => { const copy = JSON.parse(JSON.stringify(turned)); change(copy); return validateSave(copy, DATE, daily('gates', gates)); };
  assert.equal(forged((save) => { save.gates[1].shut = true; shutNow(save); }), false, 'shut while its rhythm has it open');
  assert.equal(forged((save) => { save.gates[0].phase = 0; }), false, 'the other beat');
  assert.equal(forged((save) => { save.gateTurns = 0; }), false, 'the gates’ clock behind the floor’s moves');
  assert.equal(forged((save) => { save.gates.pop(); shutNow(save); }), false, 'a gate missing');
  assert.equal(forged((save) => { save.shut = maskOf([{ x: 0, y: 7 }]); }), false, 'the board out of step with the gates');
  assert.equal(forged((save) => { save.cracks = []; save.pits = []; }), false, 'another modifier’s fields');
});

test('the exact search sees the terrain: positions differ by it, and lines wait for a gate', () => {
  const cracks = sealed({ cracks: [{ x: 4, y: 6 }, { x: 5, y: 6 }] });
  const there = act(act(game('cracks', cracks), move(5, 6)), move(4, 5));
  // The same squares, the same clock, but e2 never cracked: another position.
  const whole = structuredClone(there);
  whole.pits = whole.pits.filter((pit) => pit.x !== 5); whole.cracks.push({ x: 5, y: 6 }); shutNow(whole);
  assert.notEqual(positionKey(there), positionKey(whole));
  const gates = sealed({ gates: [{ x: 2, y: 3, phase: 0 }] });
  const open = act(game('gates', gates), wait);
  const forced = structuredClone(open);
  forced.gates[0].shut = true; shutNow(forced);
  assert.notEqual(positionKey(open), positionKey(forced));

  // A knight target walled in on e6, the rook on e2 below it: one move, unless a gate stands between.
  const cell = [[2, 1], [3, 0], [5, 0], [6, 1], [6, 3], [5, 4], [3, 4], [2, 3]];
  // Walls on the rook's other ways round: the rank it would cross to (rank 6) is shut off beside the knight.
  const pocket = (extra) => room({ enemies: [{ x: 4, y: 2, cast: 0 }], walls: [...cell, [3, 2], [5, 2], [4, 1]], ...extra });
  const depth = (modifier, laid) => shortestWins(game(modifier, laid), 4)?.depth;
  assert.equal(depth('none', pocket()), 1);
  assert.equal(depth('gates', pocket({ gates: [{ x: 4, y: 4, phase: 1 }] })), 1, 'open now');
  assert.equal(depth('gates', pocket({ gates: [{ x: 4, y: 4, phase: 0 }] })), 2, 'shut now: a wait, then through');
  // A cracked tile on the way changes nothing until someone stands on it and leaves.
  assert.equal(depth('cracks', pocket({ cracks: [{ x: 4, y: 4 }] })), 1);
});
