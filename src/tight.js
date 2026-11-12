// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Tight floors (a dev preview; no stored edition is one): floors whose idea
// has to be found. The composer builds the subtle forms (src/composer.js, its
// `tight` option); this module judges them, exactly.
//
// Monsters are deterministic, so every line of play within par (the planted
// line plus one) can be searched (parRoom). A tight bait or squeeze passes two
// exact tests (tightVerdict) and one by the human-like bot (the composer runs
// it, botFinds); a pawn's king floor one of its own:
//   1. No win within par skips the idea, as a player would name it
//      (playsIdea): a bait is a target taken off-balance right after its lunge
//      missed, a squeeze a target taken on the square it just stepped onto, in
//      your reach. Lines that absorb a capture count: a hit only costs a move.
//   2. A neutral first move costs par: of the first actions that aren't
//      captured at once, at most TIGHT.firstShare still leave a win within par.
//   3. Plain sensible play doesn't find it: the bot, which knows no ideas,
//      makes par in at most TIGHT.botPar of its runs.
//   4. A pawn's king floor: no win within par has the pawn make fewer moves
//      than the planted line does (the recruit king mating alone).
// The composer's own checks (nothing wins sooner, the hasty two, the bot
// guard against slogs) still apply to every floor.
import { act } from './rules.js';
import { routeTransition, positionKey } from './fairness.js';

/**
 * Thresholds of a tight floor: the share of first actions that may keep par,
 * the share of the human-like bot's runs that may make par (the composer
 * runs them: plain sensible play must not find a subtle form's idea), and
 * the search steps a floor's verdict may take (past it the floor is not
 * tight: it was not proved so).
 */
export const TIGHT = Object.freeze({ firstShare: 1 / 2, botPar: 1 / 2, budget: 100_000 });

const same = (a, b) => a.x === b.x && a.y === b.y;
const isTarget = (state, id) => (state.enemies.find((foe) => foe.id === id)?.role ?? null) === state.objective.piece;
// The targets a line's move `n` takes (their ids).
const taken = (states, n) => states[n + 1].events.filter((event) => event.type === 'capture' && isTarget(states[n], event.id)).map((event) => event.id);

/**
 * Does a winning line use its floor's idea, as a player would name it?
 * Wider than the composer's own test of a planted line (usesIdea, which
 * `narrow` is: it asks for the planted squares), and read from where pieces
 * come to rest, so a skid on ice reads as any other move:
 * - bait: a target lunges, misses, and is taken on the very next move, while
 *   it is off-balance (where its lunge landed, or where it stood if blocked);
 * - squeeze: a target that made no lunge steps onto a square in your reach
 *   and is taken there on the next move, from where you stood as it stepped.
 * Any other motif keeps the composer's test.
 */
export function playsIdea(built, states, line, narrow) {
  if (built.motif === 'bait') {
    return line.some((action, n) => n > 0 && action.type === 'move'
      && taken(states, n).some((id) => states[n].events.some((event) => event.type === 'miss' && event.id === id)));
  }
  if (built.motif === 'squeeze') {
    return line.some((action, n) => n > 0 && action.type === 'move' && taken(states, n).some((id) => {
      const now = states[n].enemies.find((foe) => foe.id === id), before = states[n - 1].enemies.find((foe) => foe.id === id);
      return Boolean(before) && !same(now, before) && !states[n].events.some((event) => event.type === 'miss' && event.id === id);
    }));
  }
  return narrow(built, states, line);
}

// A step of play as a person may make it: any legal action that keeps the run
// on this floor. A capture of the player is allowed (it costs a move).
function played(state, action) {
  const next = act(state, action);
  return next === state || next.status !== 'playing' || next.floor !== state.floor || next.events.some((event) => event.type === 'restart') ? null : next;
}

/**
 * The room a floor leaves around its planted line of `length` moves, by an
 * exact search from `start` over every line of play within par (length + 1
 * scored moves, a capture of the player counting one):
 * - `firsts`: the first actions that are not captured at once; `keepLine` and
 *   `keepPar`: how many of them still leave a win within the line's length,
 *   and within par;
 * - `wins`: the wins within par; `off`: how many don't use the idea
 *   (`idea(states, line)`), `offLine` those of them no longer than the line,
 *   and `example` the shortest such line; `fewest`: the fewest moves (waits
 *   not counted) any win within par makes.
 * `hits: false` searches certificate steps only (src/fairness.js
 * routeTransition: never captured but on a pawn's day), as
 * scripts/measure-par-slack.mjs does; by default a line may absorb captures,
 * as a player's may. `actionsFrom` is the composer's (no powerup, no floor
 * 1–2 recruit). `stop` ends the search at the first win off the idea, and
 * `firstShare` as soon as more than that share of the first actions are
 * known to keep par (the tight verdict's two ways to fail; the figures are
 * then partial).
 * `cut` when the search passed `budget` steps (the figures are then partial).
 */
export function parRoom(start, length, { actionsFrom, idea = () => true, hits = true, budget = TIGHT.budget, stop = false, firstShare = 1 } = {}) {
  const par = length + 1, memo = new Map();
  let steps = 0, cut = false;
  const step = (state, action) => { steps++; return hits ? played(state, action) : routeTransition(state, action); };
  // Can the floor still be won within `left` scored moves?
  const canWin = (state, left) => {
    if (left <= 0 || cut) return false;
    const key = `${left}|${positionKey(state)}`;
    if (memo.has(key)) return memo.get(key);
    if (steps > budget) { cut = true; return false; }
    let won = false;
    for (const action of actionsFrom(state)) {
      const next = step(state, action);
      if (!next) continue;
      const cost = 1 + next.hits - state.hits;
      if (cost <= left && (next.exit.open || canWin(next, left - cost))) { won = true; break; }
    }
    if (!cut) memo.set(key, won);
    return won;
  };
  const firsts = [];
  for (const action of actionsFrom(start)) {
    const next = step(start, action);
    if (next) firsts.push({ action, next, cost: 1 + next.hits - start.hits, par: false, line: false });
  }
  // First actions captured at once never count: a player sees those coming (certificate steps keep a pawn's, as the measurement does).
  const counts = (first) => !hits || first.cost === 1;
  const within = (first, total) => first.cost <= total && (first.next.exit.open || canWin(first.next, total - first.cost));
  // With `firstShare`, a floor too many of whose first actions keep par is settled as soon as that shows, before
  // its wins are walked. Keeping the line is the cheaper search and keeps par too, so it is asked first of every action.
  const most = firstShare * firsts.filter(counts).length;
  let keepers = 0, done = false;
  for (const first of firsts) {
    if (done) break;
    first.line = first.par = within(first, length);
    if (first.par && counts(first) && ++keepers > most) done = true;
  }
  for (const first of firsts) {
    if (done) break;
    if (first.par) continue;
    first.par = within(first, par);
    if (first.par && counts(first) && ++keepers > most) done = true;
  }
  const tally = { wins: 0, off: 0, offLine: 0, example: null, fewest: Infinity };
  const win = (line, states, cost) => {
    tally.wins++;
    tally.fewest = Math.min(tally.fewest, line.filter((action) => action.type === 'move').length);
    let used = false;
    try { used = idea(states, line); } catch { used = false; }
    if (used) return;
    tally.off++;
    if (cost <= length) tally.offLine++;
    if (!tally.example || line.length < tally.example.length) tally.example = line;
    if (stop) done = true;
  };
  const walk = (state, left, line, states, spent) => {
    for (const action of actionsFrom(state)) {
      if (done || cut) return;
      const next = step(state, action);
      if (!next) continue;
      const cost = 1 + next.hits - state.hits;
      if (cost > left) continue;
      if (next.exit.open) win([...line, action], [...states, next], spent + cost);
      else if (canWin(next, left - cost)) walk(next, left - cost, [...line, action], [...states, next], spent + cost);
    }
  };
  for (const first of firsts) {
    if (done || cut || !first.par) continue;
    if (first.next.exit.open) win([first.action], [start, first.next], first.cost);
    else walk(first.next, par - first.cost, [first.action], [start, first.next], first.cost);
  }
  const clean = firsts.filter(counts);
  return { cut, steps, firsts: clean.length, keepLine: clean.filter((first) => first.line).length, keepPar: clean.filter((first) => first.par).length, ...tally };
}

/**
 * Is the floor that `start` begins tight around its planted `line`, for the
 * motif instance `built`? { ok, why, firsts, keepPar, ... }: `why` names the
 * test that failed ('cut', 'first', 'idea' or 'lazy'). A pawn's king floor
 * (`built.mate`) is asked only the third test; every other floor the first
 * two. `narrow` is the composer's own idea test (usesIdea).
 */
export function tightVerdict(start, built, line, { actionsFrom, narrow }) {
  const moves = line.filter((action) => action.type === 'move').length;
  if (built.mate) {
    const room = parRoom(start, line.length, { actionsFrom });
    return { ...room, ok: !room.cut && room.fewest >= moves, why: room.cut ? 'cut' : room.fewest < moves ? 'lazy' : null };
  }
  const room = parRoom(start, line.length, { actionsFrom, idea: (states, played) => playsIdea(built, states, played, narrow), stop: true, firstShare: TIGHT.firstShare });
  const why = room.cut ? 'cut' : room.keepPar > TIGHT.firstShare * room.firsts ? 'first' : room.off ? 'idea' : null;
  return { ...room, ok: !why, why };
}
