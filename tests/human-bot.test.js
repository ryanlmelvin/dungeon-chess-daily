// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDaily, act, validateSave } from '../src/game.js';
import { distanceTable, stepTable, UNREACHABLE } from '../src/move-tables.js';
import {
  certifiedFloors, humanPar, humanPlayer, humanRun, medianRun, observe, playFloor, runSeed, failedFloorPar,
  HUMAN_RUNS, HUMAN_MOVE_CAP,
} from '../src/human-bot.js';
import { humanGap } from '../src/difficulty.js';
import { EDITIONS } from '../src/editions.js';

const OPEN = Array(8).fill('........');
const at = (x, y) => y * 8 + x;

test('move tables measure moves around walls, not coordinate distance', () => {
  // A wall across row 3 except the right edge: a rook must go round it.
  const walled = [...OPEN.slice(0, 3), '#######.', ...OPEN.slice(4)];
  assert.equal(distanceTable(OPEN, 'rook')[at(0, 6) * 64 + at(0, 0)], 1);
  assert.equal(distanceTable(walled, 'rook')[at(0, 6) * 64 + at(0, 0)], 3);
  assert.equal(distanceTable(OPEN, 'knight')[at(0, 0) * 64 + at(1, 1)], 4);
  // A bishop never reaches the other color.
  assert.equal(distanceTable(OPEN, 'bishop')[at(0, 0) * 64 + at(0, 1)], UNREACHABLE);
  assert.deepEqual(stepTable(walled, 'queen')[at(0, 4)].includes(at(0, 2)), false);
  // A pawn takes diagonally ahead, and reaches a target behind it by promoting.
  const pawn = distanceTable(OPEN, 'pawn');
  assert.equal(pawn[at(4, 6) * 64 + at(3, 5)], 1);
  assert.equal(pawn[at(4, 6) * 64 + at(4, 5)], 6, 'behind it only after promoting: a double step, four steps, then a queen move');
  assert.equal(distanceTable(['....#...', ...OPEN.slice(1)], 'pawn')[at(4, 6) * 64 + at(4, 7)], UNREACHABLE);
});

test('the human-like bot is deterministic', () => {
  const daily = getDaily('2026-11-07');
  assert.deepEqual(humanPar(daily), humanPar(daily));
  const start = certifiedFloors(daily).starts[1];
  const one = playFloor(start, { seed: runSeed(daily, 1, 0) }), two = playFloor(start, { seed: runSeed(daily, 1, 0) });
  assert.deepEqual(one.actions, two.actions);
  assert.equal(one.moves, two.moves);
  assert.notEqual(runSeed(daily, 1, 0), runSeed(daily, 1, 1));
});

// Every non-target monster gets another role (never the target's), as if the
// newspaper had dealt the decoys differently.
function reassignHiddenRoles(state) {
  const copy = structuredClone(state);
  const target = copy.species[copy.floor].id;
  const roles = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'].filter((role) => role !== copy.objective.piece);
  for (const foe of copy.enemies) {
    if (foe.species === target || foe.promoted) continue;
    foe.role = foe.piece = roles[(roles.indexOf(foe.role) + 1) % roles.length];
  }
  return copy;
}

test('the bot never reads a hidden role: reassigning them changes nothing it sees or chooses', () => {
  let compared = 0;
  for (const date of ['2026-11-07', '2026-11-13', '2026-11-22', '2026-12-09', '2027-01-15']) {
    const daily = getDaily(date);
    for (const start of certifiedFloors(daily).starts) {
      const seed = runSeed(daily, start.floor, 0);
      const real = humanPlayer(start, { seed }), blind = humanPlayer(start, { seed });
      let state = start, other = reassignHiddenRoles(start);
      // Lock step until the monsters act differently or a capture unmasks a (different) role.
      for (let step = 0; step < HUMAN_MOVE_CAP && state.status === 'playing' && !state.exit.open; step++) {
        assert.deepEqual(observe(other), observe(state), `${date} floor ${start.floor + 1} step ${step}: the view hides roles`);
        const action = real.choose(state);
        assert.deepEqual(blind.choose(other), action, `${date} floor ${start.floor + 1} step ${step}`);
        compared++;
        const next = act(state, action), otherNext = act(other, action);
        if (next.events.some((event) => event.type.endsWith('capture'))) break;
        if (JSON.stringify(observe(next)) !== JSON.stringify(observe(otherNext))) break;
        real.saw(state, next); blind.saw(other, otherNext);
        state = next; other = otherNext;
      }
    }
  }
  assert.ok(compared >= 15, `compared ${compared} choices`);
});

test('a floor\'s par is the lower median of its successful runs, else the route plus 25%', () => {
  const won = (moves) => ({ won: true, moves, livesLost: 0 });
  const lost = (moves) => ({ won: false, moves, livesLost: 1 });
  assert.deepEqual(medianRun([won(9), won(7), lost(40), won(12), won(7)], 6), { par: 7, run: 1 });
  assert.deepEqual(medianRun([won(9), won(7), won(12)], 6), { par: 9, run: 0 });
  assert.deepEqual(medianRun([lost(40), won(15), lost(3)], 6), { par: 15, run: 1 });
  assert.deepEqual(medianRun([lost(40), lost(40), lost(5)], 13), { par: 17, run: null });
  // Of the runs with par's moves, the result card replays the one that lost the fewest lives.
  assert.deepEqual(medianRun([{ won: true, moves: 7, livesLost: 1 }, won(9), { won: true, moves: 7, livesLost: 0 }], 6), { par: 7, run: 2 });
  assert.deepEqual([failedFloorPar(13), failedFloorPar(4), failedFloorPar(3), failedFloorPar(8)], [17, 5, 4, 10]);
  // Real editions: a failed floor gets the route's moves plus 25%; others the median run's moves.
  for (let day = 0; day < 12; day++) {
    const daily = getDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    const human = humanPar(daily);
    assert.equal(human.results.length, 3);
    for (let floor = 0; floor < 3; floor++) {
      assert.equal(human.results[floor].length, HUMAN_RUNS);
      if (human.runs[floor] === null) {
        assert.ok(human.results[floor].every((run) => !run.won));
        assert.equal(human.par[floor], failedFloorPar(human.certified[floor]));
      } else {
        const shown = human.results[floor][human.runs[floor]];
        assert.equal(shown.won, true);
        assert.equal(shown.moves, human.par[floor]);
      }
    }
  }
});

test('the human gap counts extra moves over the route, a failed run as the whole cap', () => {
  const run = (won, moves) => ({ won, moves, livesLost: 0 });
  const gap = humanGap({ results: [[run(true, 6), run(true, 8)], [run(true, 5), run(false, 3)], [run(false, 9), run(false, 40)]], certified: [5, 5, 10] });
  assert.deepEqual(gap.floors, [2, (5 + HUMAN_MOVE_CAP) / 2 - 5, HUMAN_MOVE_CAP - 10]);
  assert.deepEqual(gap.failed, [0, 0.5, 1]);
  assert.equal(gap.total, Math.round((2 + (5 + HUMAN_MOVE_CAP) / 2 - 5 + HUMAN_MOVE_CAP - 10) * 10) / 10);
});

test('the bot\'s whole run replays each floor from its standard start and validates', () => {
  // The first edition whose stored runs clear every floor.
  const date = Object.keys(EDITIONS).find((day) => EDITIONS[day].runs.every((run) => run !== null) && humanRun(getDaily(day), EDITIONS[day].runs));
  const daily = getDaily(date);
  const human = humanPar(daily);
  assert.deepEqual(human.runs, EDITIONS[date].runs);
  const run = humanRun(daily, human.runs);
  assert.deepEqual(run.floors, human.par);
  assert.equal(run.moves, human.par.reduce((a, b) => a + b, 0));
  assert.equal(run.frames[0].turns, 0);
  assert.equal(run.frames.at(-1).status, 'won');
  const starts = certifiedFloors(daily).starts;
  const frames = run.frames.map((frame) => JSON.stringify(frame));
  for (const start of starts.slice(1)) assert.ok(frames.includes(JSON.stringify(start)), 'each floor opens on the certified start');
  for (const frame of run.frames) assert.equal(validateSave(JSON.parse(JSON.stringify(frame)), daily.date), true, `turn ${frame.turns}`);
  // No powerups: the bot never steps onto a relic.
  assert.ok(run.frames.every((frame) => !frame.events.some((event) => event.type === 'powerup')));
  assert.equal(humanRun(daily, [human.runs[0], null, human.runs[2]]), null);
});
