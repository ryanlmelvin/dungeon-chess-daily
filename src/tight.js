// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Tight floors: floors whose idea has to be found. The composer builds the
// subtle forms (src/composer.js, its `tight` option, on in every stored
// edition); this module judges them, exactly.
//
// Monsters are deterministic, so every line of play within par (the planted
// line plus one) can be searched (parRoom). A tight bait or squeeze passes two
// exact tests (tightVerdict) and one by the human-like bot (the composer runs
// it, botFinds):
//   1. No win within par skips the idea, as a player would name it
//      (playsIdea): a bait is a target taken off-balance right after its lunge
//      missed, a squeeze a target taken on the square it just stepped onto, in
//      your reach. Lines that absorb a capture count: a hit only costs a move.
//   2. A neutral first move costs par: of the first actions that aren't
//      captured at once, at most TIGHT.firstShare still leave a win within par.
//   3. Plain sensible play doesn't find it: the bot, which knows no ideas,
//      makes par in at most TIGHT.botPar of its runs.
// King floors are left as they are. A pawn's was once rejected when the
// recruit king could mate while the pawn sat out a move; that swapped king
// mates for easier promote-and-mate floors, and with every recruit on the
// player's orders the king's mate is the player's to find (the owner's call,
// 2026-11-11). parRoom still reports `fewest` for measuring.
// The composer's own checks (nothing wins sooner, the hasty two, the bot
// guard against slogs) still apply to every floor.
import { act } from './rules.js';
import { routeTransition, positionKey } from './fairness.js';

/**
 * Thresholds of a tight floor: the share of first actions that may keep par,
 * the share of the human-like bot's runs that may make par (the composer
 * runs them: plain sensible play must not find a subtle form's idea), and
 * the search steps a floor's verdict may take (past it the floor is not
 * tight: it was not proved so). The bot's share is a quarter because its par
 * rate on a floor is two-humped, nearly always or hardly ever: with a half,
 * one tight floor in five still let it make par in 11 to 20 of its 40 runs.
 */
export const TIGHT = Object.freeze({ firstShare: 1 / 2, botPar: 1 / 4, budget: 100_000 });

const same = (a, b) => a.x === b.x && a.y === b.y;
const isTarget = (state, id) => (state.enemies.find((foe) => foe.id === id)?.role ?? null) === state.objective.piece;
// The targets a line's move `n` takes (their ids).
const taken = (states, n) => states[n + 1].events.filter((event) => event.type === 'capture' && isTarget(states[n], event.id)).map((event) => event.id);

/**
 * Is it plain to a player that a masked monster on `from`, wound up at `aim`,
 * covers `square`? Its red path shows a straight or a diagonal mover, and
 * `square` lies one step from it along that same kind of line: whatever it is
 * (a rook, queen or king for a straight path; a bishop, queen or king for a
 * diagonal one), it takes a piece that ends a move there. A wind-up from one
 * step away, diagonally down the board, may be a pawn's, which covers only
 * the two squares diagonally below it.
 */
export function plainGuard(from, aim, square) {
  const kind = (dx, dy) => (dx === 0 || dy === 0 ? 'straight' : Math.abs(dx) === Math.abs(dy) ? 'diagonal' : null);
  const ax = aim.x - from.x, ay = aim.y - from.y, sx = square.x - from.x, sy = square.y - from.y;
  if (Math.max(Math.abs(sx), Math.abs(sy)) !== 1 || !kind(ax, ay) || kind(ax, ay) !== kind(sx, sy)) return false;
  return !(kind(ax, ay) === 'diagonal' && Math.abs(ax) === 1 && ay === 1 && sy !== 1);
}
// Was the target `id`, which a line's move `n` takes, lured free? A decoy that
// was wound up at you as you chose the move before, plainly guarding the
// target from where it stood, lunged and missed.
function lured(states, n, id) {
  const before = states[n - 1], prize = before.enemies.find((foe) => foe.id === id);
  return Boolean(prize) && states[n].events.some((event) => {
    if (event.type !== 'miss' || event.id === id) return false;
    const guard = before.enemies.find((foe) => foe.id === event.id);
    return Boolean(guard) && !isTarget(before, guard.id) && guard.phase === 'aim' && Boolean(guard.target) && plainGuard(guard, guard.target, prize);
  });
}

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
  // The drawn ideas (src/composer.js, "Drawn ideas"):
  // - wait (the Standstill): you spend a turn standing still, and afterwards
  //   take a target on the square it has just stepped onto, in your reach,
  //   without a lunge: the wait set the rhythm. (Waiting first and then
  //   stepping to the square counts too: the same wait, a move sooner.)
  // - lure: a decoy wound up at you lunges and misses, and on the very next
  //   move you take a target it plainly guarded as it wound up (plainGuard).
  if (built.motif === 'wait') {
    const waited = line.findIndex((action) => action.type === 'wait');
    return waited >= 0 && line.some((action, n) => n > waited && action.type === 'move' && taken(states, n).some((id) => {
      const now = states[n].enemies.find((foe) => foe.id === id), before = states[n - 1].enemies.find((foe) => foe.id === id);
      return Boolean(before) && !same(now, before) && !states[n].events.some((event) => event.type === 'miss' && event.id === id);
    }));
  }
  if (built.motif === 'lure') return line.some((action, n) => n > 0 && action.type === 'move' && taken(states, n).some((id) => lured(states, n, id)));
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
 * Does the action a line makes at move `at` (0 for its first) stand alone:
 * played as planted up to there, does every other action at that moment
 * leave no win within par (the line plus one, a capture counted as the move
 * it costs)? The Standstill's test of its wait: moving breaks the cover.
 * { ok, others, cut }: `others` counts the other actions that are not
 * captured at once (the choice the moment really offers), and `cut` says the
 * search passed `budget` steps (then it is not `ok`: not proved).
 */
export function standsAlone(start, line, at, { actionsFrom, budget = TIGHT.budget }) {
  const memo = new Map();
  let steps = 0, cut = false;
  const canWin = (state, left) => {
    if (left <= 0 || cut) return false;
    const key = `${left}|${positionKey(state)}`;
    if (memo.has(key)) return memo.get(key);
    let won = false;
    for (const action of actionsFrom(state)) {
      if (++steps > budget) { cut = true; return false; }
      const next = played(state, action);
      if (!next) continue;
      const cost = 1 + next.hits - state.hits;
      if (cost <= left && (next.exit.open || canWin(next, left - cost))) { won = true; break; }
    }
    if (!cut) memo.set(key, won);
    return won;
  };
  let state = start;
  for (const action of line.slice(0, at)) { state = played(state, action); if (!state) return { ok: false, others: 0, cut: false }; }
  const left = line.length + 1 - at - (state.hits - start.hits), key = line[at];
  let others = 0, keeps = 0;
  for (const action of actionsFrom(state)) {
    if (action.type === key.type && (action.type !== 'move' || same(action, key))) continue;
    const next = played(state, action);
    if (!next) continue;
    const cost = 1 + next.hits - state.hits;
    if (cost === 1) others++;
    if (cost <= left && (next.exit.open || canWin(next, left - cost))) keeps++;
  }
  return { ok: !cut && keeps === 0, others, cut };
}

/**
 * Is the floor that `start` begins tight around its planted `line`, for the
 * motif instance `built`? { ok, why, firsts, keepPar, ... }: `why` names the
 * test that failed ('cut', 'first' or 'idea'). For a bait or a squeeze: king
 * floors are not judged. `narrow` is the composer's own idea test (usesIdea).
 */
export function tightVerdict(start, built, line, { actionsFrom, narrow }) {
  const room = parRoom(start, line.length, { actionsFrom, idea: (states, played) => playsIdea(built, states, played, narrow), stop: true, firstShare: TIGHT.firstShare });
  const why = room.cut ? 'cut' : room.keepPar > TIGHT.firstShare * room.firsts ? 'first' : room.off ? 'idea' : null;
  return { ...room, ok: !why, why };
}
