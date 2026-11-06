// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The fairness checker's certified route doubles as the "bot" a player can
// compare against after beating the day. It is shown only after a win.
import { act, createGame } from './game.js';

/**
 * Replay the edition's certificate through the production engine. Returns each
 * position the bot passed through (frames[0] is the fresh dungeon), its total
 * chess moves, and its moves per floor. Returns null if there is no certificate.
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
  return { frames, moves: state.turns, floors: state.records.map((record) => record.turns) };
}

/** Moves a won run spent per floor, plus its total, for the comparison card. */
export function playerRun(state) {
  if (state?.status !== 'won' || !Array.isArray(state.records)) return null;
  return {
    moves: state.turns, floors: state.records.map((record) => record.turns),
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
