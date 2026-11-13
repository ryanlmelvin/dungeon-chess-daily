// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Gates (a room modifier, src/modifiers.js 'gates'): a few squares of each
// room are gates that shut one move and open the next. Shut, a gate
// is terrain (src/terrain.js): nobody stands there, lines stop there, knights
// jump it. Open, it is floor.
//
// The rhythm, the same for every gate, every piece and every player:
// - A gate is shut one move and open the next, and so on (GATE_HOLD is 1).
//   Gates differ only in which of the two they begin on (`phase`). So every
//   gate changes after every move and the board needs no sign of what comes
//   next: what is up now is down next move. (The first rhythm held each state
//   two moves and marked the wait, with arrows and then a number; the owner
//   asked for plain alternation instead, 2026-11-12.)
// - Gates change between turns, never within one: after your move, your
//   recruit's and every monster's. So through a whole turn everyone meets the
//   same gates, and what you see before you move is what your move and the
//   monsters' answer to it will meet.
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
export const GATE_HOLD = 1;
/** A gate's cycle: shut for GATE_HOLD moves, then open for GATE_HOLD. */
export const GATE_CYCLE = 2 * GATE_HOLD;
/** Gates a composed room lays, at most. */
export const GATE_SQUARES = 3;

// The gates' clock: the turns finished on the floor in progress.
const clock = (state) => state.gateTurns ?? 0;
const step = (gate, moves) => (((moves + gate.phase) % GATE_CYCLE) + GATE_CYCLE) % GATE_CYCLE;

/** Is `gate` due shut once `moves` moves have been made on its floor? */
export function dueShut(gate, moves) { return step(gate, moves) < GATE_HOLD; }

/** A gate as the board shows it: { x, y, shut }. One held open by the piece standing in it is open. */
export function gateLooks(state) {
  return (state.gates ?? []).map(({ x, y, shut }) => ({ x, y, shut }));
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
