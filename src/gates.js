// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Gates (a room modifier, src/modifiers.js 'gates'): a few squares of each
// room are gates that open and shut on a rhythm the board shows. Shut, a gate
// is terrain (src/terrain.js): nobody stands there, lines stop there, knights
// jump it. Open, it is floor.
//
// The rhythm, the same for every gate, every piece and every player:
// - A gate stays shut for GATE_HOLD moves, then open for GATE_HOLD moves, and
//   so on. Gates differ only in where in that cycle they begin (`phase`).
// - Gates change between turns, never within one: after your move, your
//   recruit's and every monster's. So through a whole turn everyone meets the
//   same gates, and what you see before you move is what your move and the
//   monsters' answer to it will meet.
// - Every gate wears a number (src/renderer.js): the moves until it changes,
//   this move included. A shut gate reading 1 opens after this move; an open
//   one reading 2 is floor for this move and the next. The board does the
//   counting, the way "Wake in 3" does for sleepers. (An earlier look marked
//   only the gates about to change, with coloured arrows; the owner could not
//   read them, 2026-11-12.)
// - A gate never shuts on a piece. One that is due to shut while someone
//   stands in it stays open, and shuts at the end of the first turn that
//   leaves it empty while it is still due shut. Its rhythm never shifts.
// - A monster already wound up when a gate shuts across its path still
//   lunges, finds the gate, and stands off-balance where it was.
//
// A room lays its own gates (`room.gates`: { x, y, phase }, src/composer.js
// lays them around its planted line); one that lays none has none. The state
// keeps them as `gates`, each with `shut`, and the gates' own clock,
// `gateTurns`: the turns finished on the floor. (Not the move count: that
// goes up as a move begins, and the gates must look the same from the start
// of a turn to its end, the recruit's order in the middle included.)
// src/terrain.js keeps the board in step.
import { shutNow, occupied } from './terrain.js';

/** Moves a gate holds each state. */
export const GATE_HOLD = 2;
/** A gate's cycle: shut for GATE_HOLD moves, then open for GATE_HOLD. */
export const GATE_CYCLE = 2 * GATE_HOLD;
/** Gates a composed room lays, at most. */
export const GATE_SQUARES = 3;

// The gates' clock: the turns finished on the floor in progress.
const clock = (state) => state.gateTurns ?? 0;
const step = (gate, moves) => (((moves + gate.phase) % GATE_CYCLE) + GATE_CYCLE) % GATE_CYCLE;

/** Is `gate` due shut once `moves` moves have been made on its floor? */
export function dueShut(gate, moves) { return step(gate, moves) < GATE_HOLD; }

/** Does `gate` change state after this move (the last move of its hold)? */
export function changesNext(state, gate) { return step(gate, clock(state)) % GATE_HOLD === GATE_HOLD - 1; }

/**
 * A gate as the board shows it: { x, y, shut, turning, left }. `left` is the
 * number it wears: the moves it keeps this state, this move included (1: it
 * changes after this move, which is `turning`). A gate held open by the piece
 * standing in it shuts as soon as it is left, so it reads 1; if its open spell
 * begins next move anyway, it reads through that spell.
 */
export function gateLooks(state) {
  const moves = clock(state);
  return (state.gates ?? []).map((gate) => {
    const jammed = !gate.shut && dueShut(gate, moves);
    const turning = jammed ? dueShut(gate, moves + 1) : changesNext(state, gate);
    const left = jammed ? (turning ? 1 : 1 + GATE_HOLD) : GATE_HOLD - (step(gate, moves) % GATE_HOLD);
    return { x: gate.x, y: gate.y, shut: gate.shut, turning, left };
  });
}

/** A floor begins: its room's gates, each as its rhythm has it before the first move. */
export function setupGates(state, room) {
  state.gates = (room?.gates ?? []).map(({ x, y, phase }) => ({ x, y, phase, shut: false }));
  state.gateTurns = 0;
  settle(state);
}

// Every gate takes the state its rhythm gives it now, but none shuts on a piece.
function settle(state) {
  const moves = clock(state);
  let changed = false;
  for (const gate of state.gates) {
    const shut = dueShut(gate, moves) && !occupied(state, gate);
    if (shut !== gate.shut) { gate.shut = shut; changed = true; }
  }
  shutNow(state);
  return changed;
}

/** The end of a turn: the gates move on. Says so in the turn's events when one changed. */
export function gateTick(state) {
  if (!state.gates) return;
  state.gateTurns = clock(state) + 1;
  const before = state.gates.map((gate) => gate.shut);
  if (!settle(state)) return;
  state.events.push({ type: 'gates', x: state.player.x, y: state.player.y, turned: state.gates.filter((gate, n) => gate.shut !== before[n]).map(({ x, y, shut }) => ({ x, y, shut })) });
}

/**
 * The save check: the gates are the floor's own (`template`, the floor freshly
 * set up), their clock is the floor's move count (a save is never made
 * mid-turn), a shut one is due shut and holds nobody. An open one that is
 * due shut is one a piece stands in, or has just left.
 */
export function validGates(value, template) {
  const { gates } = value;
  if (!Array.isArray(gates) || gates.length !== template.gates.length) return false;
  if (value.gateTurns !== value.turns - value.floorStart.turns) return false;
  const moves = clock(value);
  return gates.every((gate, n) => {
    const laid = template.gates[n];
    if (!gate || Object.keys(gate).length !== 4 || gate.x !== laid.x || gate.y !== laid.y || gate.phase !== laid.phase || typeof gate.shut !== 'boolean') return false;
    return !gate.shut || (dueShut(gate, moves) && !occupied(value, gate));
  });
}
