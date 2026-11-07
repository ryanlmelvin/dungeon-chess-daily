// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The "Dungeon Bot" a player can compare against after beating the day, shown
// only after a win: the human-like bot (src/human-bot.js) when it won every
// floor, since that's the relatable comparison, else the fairness checker's
// certified route.
import { act, createGame, scoredMoves } from './game.js';
import { humanRun } from './human-bot.js';
import { humanSummary } from './par.js';

const sum = (floors) => floors.reduce((total, moves) => total + moves, 0);

/**
 * Replay the edition's certificate through the production engine. Returns each
 * position the bot passed through (frames[0] is the fresh dungeon), every chess
 * move it played (`turns`), its scored moves per floor and in total (moves
 * until each floor's challenge was complete), and the lives it lost. Returns
 * null if there is no certificate.
 */
export function botRun(daily) {
  const actions = daily?.generation?.certificate?.actions;
  if (!Array.isArray(actions) || !actions.length) return null;
  let state = createGame(daily);
  const frames = [state];
  for (const action of actions) {
    const next = act(state, action);
    if (next === state) return null;
    frames.push(next);
    state = next;
  }
  if (state.status !== 'won') return null;
  const floors = state.records.map(scoredMoves);
  return { frames, turns: state.turns, moves: sum(floors), floors, livesLost: frames[0].player.hp - state.player.hp };
}

/**
 * The run the result card compares against and replays: `kind` 'human' (the
 * human-like bot, when it won every floor; its floors are the day's pars) or
 * 'certified' (the certificate, from botRun). Null without a certificate.
 */
export function dungeonBot(daily, summary = humanSummary(daily)) {
  if (summary?.runs?.every((run) => run !== null)) {
    const run = humanRun(daily, summary.runs);
    if (run) return { kind: 'human', ...run };
  }
  const run = botRun(daily);
  return run && { kind: 'certified', ...run };
}

/** Scored moves a won run spent per floor, plus their total, for the comparison card. */
export function playerRun(state) {
  if (state?.status !== 'won' || !Array.isArray(state.records)) return null;
  return {
    moves: sum(state.records.map(scoredMoves)), floors: state.records.map(scoredMoves),
    livesLost: state.player.maxHp - state.player.hp, tries: state.tries ?? (state.replayUnlocked ? 2 : 1),
  };
}

/** A short WordleBot-style verdict comparing move totals. */
export function verdict(player, bot) {
  const diff = player.moves - bot.moves;
  if (diff < 0) return `You beat the bot by ${-diff} ${-diff === 1 ? 'move' : 'moves'}.`;
  if (diff === 0) return 'You matched the bot move for move.';
  return `The bot found a route ${diff} ${diff === 1 ? 'move' : 'moves'} shorter.`;
}
