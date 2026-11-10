// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDaily } from '../src/game.js';
import { botRun, dungeonBot, playerRun, verdict } from '../src/bot.js';
import { humanSummary } from '../src/par.js';
import { EDITIONS } from '../src/editions.js';
import { composeDay } from '../src/composer.js';

test('the bot replays the certified route to a win with per-floor move counts', () => {
  for (let day = 0; day < 6; day++) {
    const daily = getDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    const run = botRun(daily);
    assert.ok(run, `${daily.date}: bot run exists`);
    assert.equal(run.frames.length, daily.generation.certificate.actions.length + 1);
    assert.equal(run.frames[0].turns, 0);
    assert.equal(run.frames.at(-1).status, 'won');
    assert.equal(run.turns, daily.generation.certificate.metrics.turns);
    assert.equal(run.floors.length, 3);
    assert.equal(run.floors.reduce((a, b) => a + b, 0), run.moves);
    assert.ok(run.moves <= run.turns + run.hits, 'moves after a challenge is complete are not scored; captures are');
  }
});

test('the bot run uses the player-facing certificate and never mutates the edition', () => {
  const daily = getDaily(new Date(Date.UTC(2026, 10, 5)));
  const before = JSON.stringify(daily);
  botRun(daily);
  assert.equal(JSON.stringify(daily), before);
  assert.equal(botRun({ ...daily, generation: undefined }), null);
});

test('playerRun and verdict compare move totals', () => {
  const won = { status: 'won', turns: 20, records: [{ turns: 5 }, { turns: 7 }, { turns: 8 }], tries: 1 };
  assert.deepEqual(playerRun(won), { moves: 20, floors: [5, 7, 8], tries: 1 });
  // Moves after a floor's challenge is complete (gold, stairs) don't count; captures do.
  const golden = { ...won, records: [{ turns: 5, scored: 3, hits: 1 }, { turns: 7 }, { turns: 8, scored: 8 }] };
  assert.deepEqual(playerRun(golden), { moves: 19, floors: [4, 7, 8], tries: 1 });
  assert.equal(playerRun({ ...won, status: 'playing' }), null);
  assert.equal(verdict({ moves: 18 }, { moves: 20 }), 'You beat the bot by 2 moves.');
  assert.equal(verdict({ moves: 20 }, { moves: 20 }), 'You matched the bot move for move.');
  assert.equal(verdict({ moves: 21 }, { moves: 20 }), 'The bot found a route 1 move shorter.');
});

test('the result card shows the human-like bot when it cleared every floor, else the certified route', () => {
  // The first edition whose bot run cleared every floor and would have survived as one run.
  const date = Object.keys(EDITIONS).find((day) => EDITIONS[day].runs.every((run) => run !== null) && dungeonBot(getDaily(day)).kind === 'human');
  const daily = getDaily(date);
  const summary = humanSummary(daily);
  const human = dungeonBot(daily);
  assert.equal(human.kind, 'human');
  assert.deepEqual(human.floors, summary.par, 'its floors are the pars');
  assert.equal(human.moves, summary.par.reduce((a, b) => a + b, 0));
  assert.equal(human.frames[0].turns, 0);
  assert.equal(human.frames.at(-1).status, 'won');
  assert.ok(Number.isInteger(human.hits) && human.hits >= 0);
  const certified = dungeonBot(daily, { ...summary, runs: [summary.runs[0], null, summary.runs[2]] });
  assert.equal(certified.kind, 'certified');
  assert.deepEqual(certified.floors, botRun(daily).floors);
  assert.equal(certified.frames.length, daily.generation.certificate.actions.length + 1);
  assert.equal(dungeonBot({ ...daily, generation: undefined }), null);
  const failed = Object.keys(EDITIONS).find((date) => EDITIONS[date].runs.includes(null));
  assert.equal(dungeonBot(getDaily(failed)).kind, 'certified', failed);
});

test('a composed day (the dev preview) replays its planted lines', () => {
  const { daily, floors } = composeDay('2026-11-16');
  const run = dungeonBot(daily);
  assert.equal(run.kind, 'planted');
  assert.deepEqual(run.floors, floors.map((floor) => floor.line.length), 'each floor scores its planted line');
  assert.deepEqual(run.floors.map((moves) => moves + 1), daily.composedPar, 'par is one more');
  assert.equal(run.frames.length, daily.generation.certificate.actions.length + 1);
  assert.equal(run.frames.at(-1).status, 'won');
});
