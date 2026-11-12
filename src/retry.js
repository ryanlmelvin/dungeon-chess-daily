// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Retry floor. Once a floor is cleared, the shop (for that floor) and the
// results paper (for any of the three) offer to play it again, free, so a
// messy clear can become the clean one while the position is still fresh.
//
// A retry is a sandbox: a second game, begun from the floor's start as the run
// first met it (the engine's own floorSnapshot, src/rules.js), that the board
// plays in place of the real run. It has a free, unlimited Undo of one whole
// turn (your move, your recruit's order and every monster's answer) and a
// Reset to the floor's start. Moves count against par as usual. Clearing the
// floor is where it stops: there are no stairs to take, no gold to explore
// for, no ceiling to crack and no shop.
//
// It never touches the run. Nothing here reads or writes storage, the engine
// never changes a state it is given, and the caller (src/main.js) keeps the
// real state aside, saves nothing while a retry is open, and puts the real
// state back when it ends. A retry is not saved either: leaving or reloading
// discards it. Paid hints and the Take-back tool have no place in it (Undo is
// free), so its moves are a move, a wait (each with the recruit's order, as
// every turn carries) and a Pin.
import { act } from './rules.js';

const PLAYED = new Set(['move', 'wait', 'pin']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// One run: an edition played with one piece, color and monsters, officially or as practice.
const runOf = (state) => [state?.date, state?.seed, state?.practice === true, state?.startingPiece, state?.playerColor, state?.difficulty].join('|');

/**
 * The floors of `state` a retry may open: the one just cleared while its
 * stairs wait (the shop's), or all three of a won run (the results paper's).
 */
export function retryFloors(state) {
  if (state?.status === 'won') return [0, 1, 2];
  return state?.status === 'playing' && state.objective?.complete === true && state.exit?.open === true ? [state.floor] : [];
}

/**
 * The start of `floor` for the run `state`, as { start, exact }, or null.
 * `start` is a floor snapshot; `exact` says it is the arrival the run itself
 * had, gold and powers included:
 * - the floor the run is on (the shop's floor, a won run's last floor): the
 *   run's own floorSnapshot;
 * - a floor this visit watched the run arrive on (`seen[floor]`, see
 *   createFloorStarts), if it is still this run's;
 * - floor 1: a fresh dungeon (`fresh()`), which every try starts from.
 * A run keeps only the snapshot of the floor it is on, so past those nothing
 * remembers how it arrived: the floor then starts as its room alone, without
 * the gold and powers brought there (`exact` false). That is floor 2 of a won
 * run opened after a reload.
 */
export function floorStart(state, floor, seen = [], fresh = null) {
  if (!state || !Number.isInteger(floor) || floor < 0 || floor > state.floor) return null;
  if (floor === state.floor && state.floorSnapshot) return { start: state.floorSnapshot, exact: true };
  const kept = seen[floor];
  // Still this run's arrival: the floors before it ended the same way, and what it had bought the run bought first.
  if (kept?.floor === floor && same(kept.records, state.records.slice(0, floor)) && same(kept.purchases, state.purchases.slice(0, kept.purchases.length))) return { start: kept, exact: true };
  if (!fresh) return null;
  let game = fresh();
  if (runOf(game) !== runOf(state)) return null;
  // Walk an untouched dungeon down its stairs: each room as it is laid, nothing carried in.
  while (game.floor < floor) {
    const next = act({ ...game, exit: { ...game.exit, open: true }, objective: { ...game.objective, complete: true } }, { type: 'descend' });
    if (next.floor !== game.floor + 1) return null;
    game = next;
  }
  return game.floorSnapshot ? { start: game.floorSnapshot, exact: floor === 0 } : null;
}

/**
 * The floor starts a visit has seen, in memory only: note(state) for every
 * state of the real run keeps the snapshot of the floor it is on, so the
 * results paper can open floors 1 and 2 as the run arrived on them.
 * start(state, floor, fresh) is floorStart with what was seen of that run.
 */
export function createFloorStarts() {
  let run = '';
  let seen = [];
  return {
    note(state) {
      if (!state?.floorSnapshot || !Number.isInteger(state.floor)) return;
      if (runOf(state) !== run) { run = runOf(state); seen = []; }
      seen[state.floor] = state.floorSnapshot;
    },
    start(state, floor, fresh) {
      return floorStart(state, floor, runOf(state) === run ? seen : [], fresh);
    },
  };
}

// The retry's first position: the floor's start without the run's own bookkeeping.
function opening(start) {
  const { floorSnapshot, undo, notes, hints, unmasked, restartedMoves, tries, replayUnlocked, ...rest } = start;
  const state = structuredClone(rest);
  // Undo is free here, so a held Take-back stays out of it.
  state.powers = { ...state.powers, takeback: 0 };
  return state;
}

// What a retry has unmasked stays unmasked through its undos and resets, as a
// floor restart or a Take-back keeps it in the real run.
function knowing(state, later) {
  const unmasked = [...new Set([...(state.unmasked ?? []), ...(later.unmasked ?? [])])];
  if (unmasked.length) state.unmasked = unmasked;
  return state;
}

// The move that clears the floor ends the retry's play, so the engine's talk
// of stairs, exploring and the cracking ceiling (src/cave-in.js) is dropped.
function settleClear(state) {
  if (!state.objective.complete) return;
  delete state.caveIn;
  state.events = state.events.filter((event) => event.type !== 'cave-crack');
  const lines = [...(state.notes ?? []), state.message]
    .map((line) => line.replace(/\s*The ceiling starts to crack!.*$/, '').replace(/(You completed the challenge ✓ in \d+ moves?\.).*$/, '$1'))
    .filter(Boolean);
  state.message = lines.pop() ?? '';
  if (lines.length) state.notes = lines; else delete state.notes;
}

/**
 * A retry of one floor from `start`, a floor snapshot (floorStart). `state`
 * is its current position, a game state like any other for the board to show,
 * with no floorSnapshot of its own (so nothing can offer the run's floor
 * restart from it). play(action) plays a move, a wait or a pin and returns
 * the new position, or the same one when the action has no place here or the
 * floor is already cleared; a move that would leave no legal move at all (it
 * ends a real try) is refused too, after `onCornered()`. The move that clears
 * the floor calls `onCleared(state)`. undo() steps back one action, reset()
 * returns to the start; both keep what the retry unmasked.
 */
export function createRetry(start, { onCleared, onCornered } = {}) {
  const first = opening(start);
  let current = first;
  let history = [];
  const cleared = () => current.objective.complete === true;
  const accepts = (action) => PLAYED.has(action?.type) && !cleared();
  return {
    floor: first.floor,
    get state() { return current; },
    cleared,
    accepts,
    canUndo: () => history.length > 0,
    play(action) {
      if (!accepts(action)) return current;
      const next = act(current, action);
      if (next === current) return current;
      if (next.status !== 'playing' || next.floor !== first.floor || next.events.some((event) => event.type === 'restart')) { onCornered?.(); return current; }
      settleClear(next);
      history.push(current);
      current = next;
      if (cleared()) onCleared?.(current);
      return current;
    },
    undo() {
      if (!history.length) return current;
      const { notes, ...before } = history.pop();
      current = knowing({ ...before, events: [{ type: 'takeback', x: before.player.x, y: before.player.y }], message: 'You took back your last move.' }, current);
      return current;
    },
    reset() {
      history = [];
      current = knowing({ ...first, events: [...first.events], message: `Floor ${first.floor + 1} reset. ${first.message}` }, current);
      return current;
    },
  };
}
