// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The "Dungeon Bot" a player can compare against after beating the day, shown
// only after a win: the line each floor was built around (src/composer.js),
// which is the day's certificate. Par is one move more on every floor. On a
// partner floor (a Tandem) the line carries the recruit's orders, so the
// replay shows the recruit making them.
import { act, createGame, scoredMoves } from './rules.js';

const sum = (floors) => floors.reduce((total, moves) => total + moves, 0);

/**
 * Replay the edition's certificate through the production engine. Returns each
 * position the bot passed through (frames[0] is the fresh dungeon), every chess
 * move it played (`turns`), its scored moves per floor and in total (moves
 * until each floor's challenge was complete, captures included), and how often
 * it was captured (`hits`). Returns null if there is no certificate.
 */
export function botRun(daily) {
  const actions = daily?.generation?.certificate?.actions;
  if (!Array.isArray(actions) || !actions.length) return null;
  // The day passed in is played as it is: an edition from getDaily, or a dev preview's composed day.
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
  return { frames, turns: state.turns, moves: sum(floors), floors, hits: state.hits };
}

/**
 * The run the result card compares against and replays: `kind` 'planted',
 * the line each floor was built around (botRun of the certificate). Null
 * without a certificate.
 */
export function dungeonBot(daily) {
  const run = botRun(daily);
  return run && { kind: 'planted', ...run };
}

// The engine's lines coach the player ("Tap the stairs…", "You move it after
// each of your moves."); the replay keeps what happened, told of the bot.
const COACHING = /\b(tap|choose|take the stairs|you move it|watch your back)\b/i;
const RETOLD = [
  [/\bjoins you\b/g, 'joins the bot'], [/\byour next move\b/g, 'the bot’s next move'], [/\bYou completed\b/g, 'The bot completed'],
  [/\bYou dropped\b/g, 'The bot dropped'], [/\bYou skid\b/g, 'The bot skids'], [/\bYour recruit\b/g, 'Its recruit'], [/\byour two bishops\b/g, 'its two bishops'],
];
/**
 * What one frame of the bot's replay says: the engine's lines for that action
 * (its notes, then its message), sentence by sentence, the coaching dropped
 * and the rest told of the bot. A sentence that still speaks to the player
 * is left out, so a line the engine gains later can't address the wrong one.
 */
export function replayNote(frame) {
  const sentences = [...(frame?.notes ?? []), frame?.message ?? ''].join(' ').match(/[^.!?]+[.!?]*/g) ?? [];
  return sentences.filter((part) => !COACHING.test(part)).map((part) => RETOLD.reduce((text, [from, to]) => text.replace(from, to), part))
    .filter((part) => !/\byou(r|rs)?\b/i.test(part)).join('').trim();
}

/** Scored moves a won run spent per floor, plus their total, for the comparison card. */
export function playerRun(state) {
  if (state?.status !== 'won' || !Array.isArray(state.records)) return null;
  return {
    moves: sum(state.records.map(scoredMoves)), floors: state.records.map(scoredMoves),
    tries: state.tries ?? (state.replayUnlocked ? 2 : 1),
  };
}

/** A short WordleBot-style verdict comparing move totals. */
export function verdict(player, bot) {
  const diff = player.moves - bot.moves;
  if (diff < 0) return `You beat the bot by ${-diff} ${-diff === 1 ? 'move' : 'moves'}.`;
  if (diff === 0) return 'You matched the bot move for move.';
  return `The bot found a route ${diff} ${diff === 1 ? 'move' : 'moves'} shorter.`;
}
