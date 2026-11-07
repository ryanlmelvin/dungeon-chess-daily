// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { PIECE_LIVES } from './pieces.js';
import { act, legalMoves, dangerTiles, unreachablePickups, royalRules } from './rules.js';

const same = (a, b) => a.x === b.x && a.y === b.y;
// The king floor's own recruit (a rook, queen or king one move
// from the start) may help certify it; bought companions, powerups and earlier
// floors' recruits never do.
const allyFloor = royalRules;
const hasPowers = (state) => Object.values(state.powers).some((value) => value !== 0)
  || (Boolean(state.companion) && !allyFloor(state)) || (state.companions?.length ?? 0) > 0
  // An undelivered order is already bought assistance. Older schema-5 states
  // omit the ledger; only an absent ledger or an empty array is unpowered.
  || (state.companionOrders !== undefined
    && (!Array.isArray(state.companionOrders) || state.companionOrders.length > 0));
const hurt = (state) => state.events.some((event) => event.type === 'player-captured' || event.type === 'restart');
const relicAt = (state, tile) => state.items.some((item) => (item.type === 'powerup' || (item.type === 'companion' && !allyFloor(state))) && same(item, tile));
const powered = (state) => hasPowers(state) || state.events.some((event) =>
  ['powerup', 'shield', 'recruit'].includes(event.type) || (event.type.startsWith('companion') && !allyFloor(state)));

// Time is part of the position: enemy tie-breaking uses the total turn count.
// Enemy order, pawn history, and complete committed lanes also affect act().
function positionKey(state, includeTime = true) {
  return JSON.stringify([
    state.floor, includeTime ? state.turns : null, state.status, state.exit.open,
    state.playerColor, state.awaitingPlayer,
    state.player.x, state.player.y, state.player.piece, state.player.hp, state.player.moved,
    state.enemies.map((enemy) => [enemy.id, enemy.x, enemy.y, enemy.piece, enemy.role,
      enemy.moved, enemy.promoted, enemy.phase, enemy.target, enemy.intent]),
    state.items, state.powers, state.companion, state.companions, state.enPassant ?? null,
    state.reinforcements ?? null, state.reinforcementsSkipped ?? null,
  ]);
}

function targetDistance(state, target) {
  const dx = Math.abs(state.player.x - target.x), dy = Math.abs(state.player.y - target.y);
  if (!dx && !dy) return 0;
  switch (state.player.piece) {
    case 'queen': return !dx || !dy || dx === dy ? 1 : 2;
    case 'rook': return !dx || !dy ? 1 : 2;
    case 'bishop': return (dx + dy) % 2 ? 8 : dx === dy ? 1 : 2;
    case 'king': return Math.max(dx, dy);
    case 'pawn': return dy + (dx ? 3 : 0);
    default: return Math.ceil(Math.max(dx, dy) / 2) + ((dx + dy) % 2);
  }
}

function score(state) {
  if (state.status === 'won') return 1_000_000;
  const targets = state.enemies.filter((enemy) => enemy.role === state.objective.piece);
  // A pawn can't take a dodging king: promote first, then hunt as a queen.
  const promoteFirst = state.startingPiece === 'pawn' && state.objective.piece === 'king';
  const nearest = targets.length && !(promoteFirst && state.player.piece === 'pawn') ? Math.min(...targets.map((target) => targetDistance(state, target))) : 0;
  return state.floor * 2000 + (state.exit.open ? 1600 : 0) + state.captures * 35
    - nearest * 8 - state.turns * 0.7
    - (PIECE_LIVES[state.startingPiece] - state.player.hp) * 150
    + (state.player.piece === 'queen' && state.startingPiece === 'pawn' ? (promoteFirst ? 300 : 50) : 0)
    + (state.player.piece === 'pawn' ? (6 - state.player.y) * (promoteFirst ? 30 : 6) : 0)
    + (allyFloor(state) && state.companion ? 40 : 0);
}

function actionsFor(state) {
  // Waiting lets monsters come to the player; never useful once the stairs are open.
  const actions = state.exit.open ? [{ type: 'descend' }] : [{ type: 'wait' }];
  for (const tile of legalMoves(state)) {
    // Relics and companions activate automatically. Avoiding their pickups
    // makes this an exact playable route without special solver-only rules.
    if (!relicAt(state, tile)) actions.push({ type: 'move', x: tile.x, y: tile.y });
  }
  return actions;
}

// Lives a proof route may spend: pawn days start with extra lives, so their
// certified route may lose up to 4; every other piece's route loses none.
export const livesSpendable = (state) => (state.startingPiece === 'pawn' ? 4 : 0);

export function safeTransition(state, action) {
  const next = act(state, action);
  return next !== state && next.status !== 'lost' && !hurt(next) && !powered(next)
    && next.player.hp === state.player.hp ? next : null;
}

// Like safeTransition, but damage is allowed while hp stays at or above the
// day's spendable-lives floor. Restarts, losses, powers and shields still reject.
// Certified routes finish within this many chess moves. Real routes rarely pass
// 40, so the search drops any line that runs past the cap instead of exploring it.
export const MAX_ROUTE_MOVES = 50;

export function routeTransition(state, action) {
  const next = act(state, action);
  if (next === state || next.status === 'lost' || powered(next)) return null;
  if (next.turns > MAX_ROUTE_MOVES) return null;
  if (next.events.some((event) => event.type === 'restart' || event.type === 'shield')) return null;
  if (next.player.hp < PIECE_LIVES[state.startingPiece] - livesSpendable(state)) return null;
  if (next.player.hp > state.player.hp) return null;
  return next;
}

function routeFor(node) {
  const result = [];
  for (let current = node; current.parent; current = current.parent) result.push(current.action);
  return result.reverse();
}

/**
 * Replay a positive certificate through the production engine, without changing
 * its map, residents, pickups, AI, or rules. A valid proof wins all three rooms
 * within the move budget, with no bought/collected powers, no lost lives (pawn
 * routes may lose up to 4), and no
 * ally except the king floor's own recruit.
 * Metrics describe this witnessed route; they are not shortest-path bounds or
 * claims that its tactical decisions are unavoidable on every winning route.
 */
export function verifyWinningRoute(initial, actions) {
  if (!initial || initial.status !== 'playing' || initial.floor !== 0 || initial.turns !== 0
    || initial.records.length !== 0 || hasPowers(initial) || initial.purchases.length !== 0) {
    return { valid: false, reason: 'The certificate must start from a fresh, unpowered dungeon.' };
  }
  if (unreachablePickups(initial).length) return { valid: false, reason: 'A pickup is unreachable with this floor’s piece and terrain.' };
  // An enemy-first turn can invalidate its initiating click and require a
  // second destination. Those board-changing actions spend no chess move.
  if (!Array.isArray(actions) || actions.length > MAX_ROUTE_MOVES * 2 + 3) {
    return { valid: false, reason: 'Invalid certificate length.' };
  }
  let state = initial;
  const metrics = {
    turns: 0, actions: actions.length, threatenedDecisions: 0, unsafeAlternatives: 0, legalAlternatives: 0,
    narrowEscapes: 0, positioningMoves: 0, captureOpportunities: 0, promotion: false, livesLost: 0,
  };
  for (const action of actions) {
    if (!action || !['move', 'descend', 'wait'].includes(action.type)) {
      return { valid: false, reason: 'Only chess moves, waiting and stairs are allowed.' };
    }
    if (action.type === 'move') {
      const alternatives = legalMoves(state);
      if (!alternatives.some((tile) => same(tile, action)) || relicAt(state, action)) {
        return { valid: false, reason: 'The route contains an illegal move or collects a powerup or companion.' };
      }
      const unpoweredAlternatives = alternatives.filter((tile) => !relicAt(state, tile));
      let safeCount = 0, captureAvailable = false;
      for (const tile of unpoweredAlternatives) {
        const alternative = safeTransition(state, { type: 'move', x: tile.x, y: tile.y });
        if (alternative) {
          safeCount++;
          if (alternative.events.some((event) => event.type === 'capture')) captureAvailable = true;
        }
      }
      const unsafe = unpoweredAlternatives.length - safeCount;
      metrics.legalAlternatives += unpoweredAlternatives.length;
      metrics.unsafeAlternatives += unsafe;
      // Count decisions made with a committed enemy attack lane on the board.
      // In enemy-first play the player may have just escaped its target square;
      // that warning still constrains the following response and destination.
      if (dangerTiles(state).length > 0) metrics.threatenedDecisions++;
      if (unsafe && safeCount === 1) metrics.narrowEscapes++;
      if (captureAvailable) metrics.captureOpportunities++;
    }
    const next = routeTransition(state, action);
    if (!next) return { valid: false, reason: 'The route loses too many lives, uses a power, takes invalid stairs.' };
    if (next.floor !== state.floor && unreachablePickups(next).length) {
      return { valid: false, reason: 'A later floor has an unreachable pickup.' };
    }
    if (next.events.some((event) => event.type === 'move') && !next.events.some((event) => event.type === 'capture')) metrics.positioningMoves++;
    if (next.events.some((event) => event.type === 'promotion')) metrics.promotion = true;
    state = next;
  }
  if (state.status !== 'won' || state.records.length !== 3 || state.turns > MAX_ROUTE_MOVES) {
    return { valid: false, reason: 'The route does not complete all three rooms within the move budget.' };
  }
  metrics.turns = state.turns;
  metrics.livesLost = initial.player.hp - state.player.hp;
  return { valid: true, state, metrics };
}

/**
 * A bounded deterministic witness finder, not an exhaustive impossibility
 * oracle. A failed/pruned search is always "unknown", never "unwinnable".
 * maxExpansions counts simulated transitions, not elapsed wall-clock time, so
 * generation cannot diverge between fast and slow devices.
 */
export function findWinningRoute(initial, { maxExpansions = 12_000, beamWidth = 24 } = {}) {
  if (!Number.isInteger(maxExpansions) || maxExpansions < 0 || !Number.isInteger(beamWidth) || beamWidth < 1) {
    throw new RangeError('Search budgets must be nonnegative integers with a positive beam width.');
  }
  if (!initial || initial.status !== 'playing' || hasPowers(initial) || unreachablePickups(initial).length) return { status: 'unknown', explored: 0 };
  let explored = 0;
  const root = { state: initial, parent: null, action: null };
  const expand = (node) => {
    const result = [];
    for (const action of actionsFor(node.state)) {
      if (explored >= maxExpansions) break;
      explored++;
      const state = routeTransition(node.state, action);
      if (state) result.push({ state, parent: node, action });
    }
    return result;
  };
  const solved = (node) => ({ status: 'solved', actions: routeFor(node), explored });
  // Generation keeps a short route search budget; players have unlimited moves.
  const horizon = (MAX_ROUTE_MOVES - initial.turns) * 2 + 3 - initial.floor;

  // Most ordinary rooms yield to a cheap two-ply rollout. Revisiting a board
  // is penalized only as a heuristic; exact search identity still keeps time.
  let current = root;
  const visits = new Map();
  const greedyBudget = Math.min(maxExpansions, Math.max(1000, Math.floor(maxExpansions / 3)));
  for (let depth = 0; depth < horizon && explored < greedyBudget; depth++) {
    if (current.state.status === 'won') return solved(current);
    const key = positionKey(current.state, false);
    visits.set(key, (visits.get(key) ?? 0) + 1);
    const choices = expand(current);
    if (!choices.length) break;
    const winner = choices.find((node) => node.state.status === 'won');
    if (winner) return solved(winner);
    let best = null, bestValue = -Infinity;
    for (const choice of choices) {
      const future = explored < greedyBudget ? expand(choice) : [];
      const futureWinner = future.find((node) => node.state.status === 'won');
      if (futureWinner) return solved(futureWinner);
      const value = (future.length ? Math.max(...future.map((node) => score(node.state))) : score(choice.state))
        + score(choice.state) * 0.05 - (visits.get(positionKey(choice.state, false)) ?? 0) * 40;
      if (value > bestValue) { bestValue = value; best = choice; }
    }
    current = best;
  }
  if (current.state.status === 'won') return solved(current);

  // Search the complete run together; retaining alternative histories matters
  // because both arrival time and pawn promotion affect later rooms.
  let frontier = [root];
  for (let depth = 0; depth < horizon && frontier.length && explored < maxExpansions; depth++) {
    const unique = new Map();
    for (const node of frontier) {
      for (const next of expand(node)) {
        if (next.state.status === 'won') return solved(next);
        const key = positionKey(next.state);
        if (!unique.has(key)) unique.set(key, next);
      }
      if (explored >= maxExpansions) break;
    }
    frontier = [...unique.values()].sort((a, b) => score(b.state) - score(a.state)).slice(0, beamWidth);
  }
  return { status: 'unknown', explored };
}
