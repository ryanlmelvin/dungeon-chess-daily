// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { act, legalMoves, dangerTiles, unreachablePickups, royalRules, scoredMoves, recruitChoice, whileSearching } from './rules.js';
import { distanceTable, UNREACHABLE } from './move-tables.js';

const same = (a, b) => a.x === b.x && a.y === b.y;

/**
 * Who moves the recruit on a route. Every shipped certificate is 'auto': no
 * action carries a recruit order, so the recruit's own AI moves it and never
 * takes a target, and only the king floor's own recruit (a king
 * one move from the start) may join; bought companions, powerups and earlier
 * floors' recruits never help. 'steer' (tooling only, to measure what Manual
 * recruit control could certify) plays the recruit like a Manual player: each
 * move or wait may carry an order (src/rules.js companionTurn), so the recruit
 * may take any monster, targets and the king included, and it hops for the
 * bishop pair where you pick the square. `everyRecruit` lets every floor's
 * recruit join, which 'steer' does unless told otherwise; with 'auto' it
 * measures what floors 1 and 2's recruits add on Auto.
 */
export const RECRUIT_MODES = Object.freeze(['auto', 'steer']);
function recruitMode({ recruit = 'auto', everyRecruit = recruit === 'steer' } = {}) {
  if (!RECRUIT_MODES.includes(recruit) || typeof everyRecruit !== 'boolean') {
    throw new RangeError(`The recruit mode is one of ${RECRUIT_MODES.join(', ')}, and everyRecruit a boolean.`);
  }
  if (recruit === 'auto' && !everyRecruit) return AUTO;
  return { steer: recruit === 'steer', every: everyRecruit, ally: everyRecruit ? () => true : royalRules };
}
const AUTO = Object.freeze({ steer: false, every: false, ally: royalRules });
const hasPowers = (state, mode = AUTO) => Object.values(state.powers).some((value) => value !== 0)
  || (Boolean(state.companion) && !mode.ally(state)) || (state.companions?.length ?? 0) > 0
  // An undelivered order is already bought assistance. Older schema-5 states
  // omit the ledger; only an absent ledger or an empty array is unpowered.
  || (state.companionOrders !== undefined
    && (!Array.isArray(state.companionOrders) || state.companionOrders.length > 0));
const hurt = (state) => state.events.some((event) => event.type === 'player-captured' || event.type === 'restart');
const relicAt = (state, tile, mode = AUTO) => state.items.some((item) => (item.type === 'powerup' || (item.type === 'companion' && !mode.ally(state))) && same(item, tile));
const powered = (state, mode = AUTO) => hasPowers(state, mode) || state.events.some((event) =>
  ['powerup', 'shield', 'recruit'].includes(event.type) || (event.type.startsWith('companion') && !mode.ally(state)));

// Moves made on the floor in progress.
const floorMoves = (state) => state.turns - (state.floorStart?.turns ?? 0);

/**
 * The search's identity of a position: everything that decides how it plays
 * on. Enemy order, pawn history, complete committed lanes, off-balance and
 * pinned monsters, the en passant window and Collapse arrivals all affect
 * act(), and so does time, but only the floor's own: monster tie-breaks,
 * Collapse arrivals and every countdown count the moves made on this floor
 * (src/rules.js monsterTie), never the whole run's, so two paths into the
 * same floor position are one position however long the earlier floors took.
 * Only the classic monsters of old-versus-new comparisons hash the whole
 * run's count, so for them it stays. Coins only pay gold, which no route
 * spends, so they are left out. `includeTime: false` drops the clock (the
 * rollout's revisit heuristic).
 */
export function positionKey(state, includeTime = true) {
  return JSON.stringify([
    state.floor, includeTime ? floorMoves(state) : null, includeTime && state.classicMonsters === true ? state.turns : null,
    state.status, state.exit.open, state.playerColor, state.awaitingPlayer,
    state.player.x, state.player.y, state.player.piece, state.hits, state.player.moved,
    state.enemies.map((enemy) => [enemy.id, enemy.x, enemy.y, enemy.piece, enemy.role,
      enemy.moved, enemy.promoted, enemy.phase, enemy.target, enemy.intent, enemy.offBalance === true, enemy.pinned ?? 0]),
    state.items.filter((item) => item.type !== 'coin'), state.powers, state.companion, state.companions, state.enPassant ?? null,
    state.reinforcements ?? null, state.reinforcementsSkipped ?? null,
  ]);
}

// A target the piece can never land on from here (a bishop's other colour, a
// pawn's walled-off lanes) counts as this many moves away.
const FAR = 10;

/**
 * Fewest moves for the player's piece to land on `target`'s square, over the
 * room's walls: the move tables of src/move-tables.js (monsters come and go,
 * so they never block there). A pawn's count takes diagonally and includes
 * promoting on the way. `table` lets a caller reuse the floor's table.
 */
export function targetDistance(state, target, table = distanceTable(state.map, state.player.piece)) {
  const moves = table[(state.player.y * 8 + state.player.x) * 64 + target.y * 8 + target.x];
  return moves === UNREACHABLE ? FAR : moves;
}

// Fewest moves for a recruit standing on `unit`'s square to land on a target,
// as `table` (its piece's move table for the floor) counts them.
function recruitDistance(unit, targets, table) {
  return Math.min(...targets.map((target) => {
    const moves = table[(unit.y * 8 + unit.x) * 64 + target.y * 8 + target.x];
    return moves === UNREACHABLE ? FAR : moves;
  }));
}

function score(state, tableFor, mode = AUTO) {
  if (state.status === 'won') return 1_000_000;
  const targets = state.enemies.filter((enemy) => enemy.role === state.objective.piece);
  // A pawn can't take a dodging king: promote first, then hunt as a queen.
  const promoteFirst = state.startingPiece === 'pawn' && state.objective.piece === 'king';
  const table = tableFor(state.player.piece);
  let nearest = targets.length && !(promoteFirst && state.player.piece === 'pawn') ? Math.min(...targets.map((target) => targetDistance(state, target, table))) : 0;
  // A steered recruit takes targets too, so the nearer of the two counts (an
  // unpromoted pawn after a king counts on its recruit alone).
  if (mode.steer && targets.length) {
    const recruit = state.companion ? recruitDistance(state.companion, targets, tableFor(state.companion.piece)) : FAR;
    nearest = promoteFirst && state.player.piece === 'pawn' ? recruit : Math.min(nearest, recruit);
  }
  return state.floor * 2000 + (state.exit.open ? 1600 : 0) + state.captures * 35
    - nearest * 8 - floorMoves(state) * 0.7
    - state.hits * 150
    + (state.player.piece === 'queen' && state.startingPiece === 'pawn' ? (promoteFirst ? 300 : 50) : 0)
    + (state.player.piece === 'pawn' ? (6 - state.player.y) * (promoteFirst ? 30 : 6) : 0)
    + (mode.ally(state) && state.companion ? 40 : 0);
}

function actionsFor(state, mode = AUTO) {
  // Stairs right after a clear: once the floor's challenge is complete the
  // only action is to take them, so a route never moves on a cleared floor
  // (and never meets its cave-in, src/cave-in.js).
  if (state.exit.open) return [{ type: 'descend' }];
  // Waiting lets monsters come to the player.
  const actions = [{ type: 'wait' }];
  for (const tile of legalMoves(state)) {
    // Relics and companions activate automatically. Avoiding their pickups
    // makes this an exact playable route without special solver-only rules.
    if (!relicAt(state, tile, mode)) actions.push({ type: 'move', x: tile.x, y: tile.y });
  }
  return actions;
}

// At most this many recruit orders per move or wait besides leaving it to
// Auto, so a steered search spends its fixed budget on a few orders a player
// would give: take a target, block a strike, close in on a target.
export const RECRUIT_ORDERS = 3;

// Is `square` strictly between `from` and `to` on one rook or bishop line?
function between(from, to, square) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return false;
  const length = Math.max(Math.abs(dx), Math.abs(dy)), mx = square.x - from.x, my = square.y - from.y;
  const step = Math.max(Math.abs(mx), Math.abs(my));
  return step > 0 && step < length && mx * length === dx * step && my * length === dy * step;
}

/**
 * The recruit orders a steered search tries with `action`, besides Auto's own
 * move (`auto`, the action played without an order): every capture of a
 * target; a step into a wound-up monster's lane between it and the player,
 * which stops the strike; the step that brings the recruit nearest a target
 * over the room's walls (move tables, src/move-tables.js), if it gains
 * ground; and holding still where the recruit already blocks such a lane.
 * Never Auto's own move again. On the bishop pair's hop, the other squares it
 * may hop to, nearest a target first. None when the turn has no recruit
 * phase: no recruit yet, castling, or a floor the move just cleared,
 * where the recruit hunts on its own and ignores orders (huntsAlone in
 * src/rules.js, where recruitChoice returns null). The rules' own move order
 * breaks ties, so the list is deterministic.
 */
function recruitOrders(state, action, auto, tableFor) {
  const phase = auto.events.findIndex((event) => event.type === 'companion-phase');
  if (phase < 0) return [];
  const choice = recruitChoice(state, action);
  if (!choice || !choice.board.companion) return [];
  const { board, moves } = choice, unit = board.companion;
  const targets = board.enemies.filter((foe) => (foe.role ?? foe.piece) === board.objective.piece);
  if (!targets.length) return [];
  const moved = auto.events.slice(phase).find((event) => event.type === 'companion-move');
  const fresh = (tile) => (moved ? !same(tile, moved) : tile !== 'hold');
  const table = tableFor(unit.piece);
  const distance = (tile) => recruitDistance(tile, targets, table);
  const orders = [];
  const add = (order) => { if (fresh(order) && !orders.some((other) => other === order || (other.x === order.x && other.y === order.y))) orders.push(order); };
  if (choice.hop) {
    const ranked = moves.map((tile, index) => ({ tile, index, moves: distance(tile) })).sort((a, b) => a.moves - b.moves || a.index - b.index);
    for (const { tile } of ranked) add({ x: tile.x, y: tile.y });
    return orders.slice(0, RECRUIT_ORDERS);
  }
  for (const tile of moves) if (tile.capture && targets.some((foe) => same(foe, tile))) add({ x: tile.x, y: tile.y });
  // Wound-up lanes through the player's square: the recruit can stand in them.
  const lanes = board.enemies.filter((foe) => foe.phase === 'aim' && foe.intent.some((tile) => same(tile, board.player)));
  for (const tile of moves) if (!tile.capture && lanes.some((foe) => between(foe, board.player, tile))) add({ x: tile.x, y: tile.y });
  let hunt = null, best = distance(unit);
  for (const tile of moves) {
    if (tile.capture) continue;
    const away = distance(tile);
    if (away < best) { best = away; hunt = tile; }
  }
  if (hunt) add({ x: hunt.x, y: hunt.y });
  if (lanes.some((foe) => between(foe, board.player, unit))) add('hold');
  return orders.slice(0, RECRUIT_ORDERS);
}

// Captures a proof route may take: a pawn day's certified route may be
// captured up to 4 times across the run (each a move on its floor's score);
// every other piece's route never is.
export const spendableHits = (state) => (state.startingPiece === 'pawn' ? 4 : 0);

function safeStep(state, action, mode) {
  const next = act(state, action);
  return next !== state && next.status !== 'lost' && !hurt(next) && !powered(next, mode)
    && next.hits === state.hits ? next : null;
}
/** `options`: the recruit mode, as findFloorRoute takes it. */
export function safeTransition(state, action, options) {
  return safeStep(state, action, recruitMode(options));
}

// Like safeTransition, but captures are allowed up to the day's spendableHits.
// Restarts, losses, powers and shields still reject.
// Certified routes finish within this many chess moves. Real routes rarely pass
// 40, so the search drops any line that runs past the cap instead of exploring it.
export const MAX_ROUTE_MOVES = 50;

// routeTransition's test of the position `next` that an action led to from `state`.
function routeStep(state, next, mode) {
  if (next === state || next.status === 'lost' || powered(next, mode)) return null;
  if (next.turns > MAX_ROUTE_MOVES) return null;
  if (next.events.some((event) => event.type === 'restart' || event.type === 'shield')) return null;
  if (next.hits > spendableHits(state)) return null;
  return next;
}
/** `options`: the recruit mode, as findFloorRoute takes it. */
export function routeTransition(state, action, options) {
  return routeStep(state, act(state, action), recruitMode(options));
}

function routeFor(node) {
  const result = [];
  for (let current = node; current.parent; current = current.parent) result.push(current.action);
  return result.reverse();
}

/**
 * Replay a positive certificate through the production engine, without changing
 * its map, residents, pickups, AI, or rules. A valid proof wins all three rooms
 * within the move budget, with no bought/collected powers, never captured (pawn
 * routes may be captured up to 4 times), and no
 * ally except the king floor's own recruit.
 * Metrics describe this witnessed route; they are not shortest-path bounds or
 * claims that its tactical decisions are unavoidable on every winning route.
 * `options` takes the recruit mode findFloorRoute does: with 'steer' a move
 * or wait may carry a recruit order, and `everyRecruit` lets floors 1 and 2's
 * recruits join. Outside the default the metrics add `recruit`: how many
 * actions carried an order, the recruit's captures (and of targets), floors it
 * cleared, floors it joined, its promotions and bishop-pair hops.
 */
export function verifyWinningRoute(initial, actions, options) {
  // Every run-ending transition here is rejected, so restarts are only marked.
  return whileSearching(() => verifyRoute(initial, actions, options));
}
function verifyRoute(initial, actions, options) {
  const mode = recruitMode(options);
  if (!initial || initial.status !== 'playing' || initial.floor !== 0 || initial.turns !== 0
    || initial.records.length !== 0 || hasPowers(initial, mode) || initial.purchases.length !== 0) {
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
    narrowEscapes: 0, positioningMoves: 0, captureOpportunities: 0, promotion: false, hits: 0,
  };
  const recruit = { orders: 0, captures: 0, targetCaptures: 0, clears: 0, joined: 0, promotions: 0, hops: 0 };
  for (const action of actions) {
    // A certified route leaves its recruit on Auto: it never carries a recruit
    // order. Only a steered route may, on a move or a wait.
    if (!action || !['move', 'descend', 'wait'].includes(action.type)
      || (action.recruit !== undefined && (!mode.steer || action.type === 'descend'))) {
      return { valid: false, reason: 'Only chess moves, waiting and stairs are allowed.' };
    }
    // It takes the stairs right after each clear, so it never meets a cave-in.
    if (state.exit.open && action.type !== 'descend') {
      return { valid: false, reason: 'The route keeps moving after a floor’s challenge is complete.' };
    }
    if (action.type === 'move') {
      const alternatives = legalMoves(state);
      if (!alternatives.some((tile) => same(tile, action)) || relicAt(state, action, mode)) {
        return { valid: false, reason: 'The route contains an illegal move or collects a powerup or companion.' };
      }
      const unpoweredAlternatives = alternatives.filter((tile) => !relicAt(state, tile, mode));
      let safeCount = 0, captureAvailable = false;
      for (const tile of unpoweredAlternatives) {
        const alternative = safeStep(state, { type: 'move', x: tile.x, y: tile.y }, mode);
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
    const next = routeStep(state, act(state, action), mode);
    if (!next) return { valid: false, reason: 'The route is captured too often, uses a power, takes invalid stairs.' };
    if (next.floor !== state.floor && unreachablePickups(next).length) {
      return { valid: false, reason: 'A later floor has an unreachable pickup.' };
    }
    if (next.events.some((event) => event.type === 'move') && !next.events.some((event) => event.type === 'capture')) metrics.positioningMoves++;
    if (next.events.some((event) => event.type === 'promotion')) metrics.promotion = true;
    if (mode !== AUTO) countRecruit(recruit, state, next, action);
    state = next;
  }
  if (state.status !== 'won' || state.records.length !== 3 || state.turns > MAX_ROUTE_MOVES) {
    return { valid: false, reason: 'The route does not complete all three rooms within the move budget.' };
  }
  metrics.turns = state.turns;
  metrics.hits = state.hits - initial.hits;
  // Moves each floor took until its challenge was complete, captures included.
  metrics.floorMoves = state.records.map(scoredMoves);
  if (mode !== AUTO) metrics.recruit = recruit;
  return { valid: true, state, metrics };
}

// What the recruit did on one action of a route (verifyWinningRoute's `recruit` metrics).
function countRecruit(recruit, state, next, action) {
  if (action.recruit !== undefined) recruit.orders++;
  const isTarget = (id) => (state.enemies.find((foe) => foe.id === id)?.role ?? null) === state.objective.piece;
  let last = null;
  for (const event of next.events) {
    if (event.type === 'companion-recruit') recruit.joined++;
    if (event.type === 'companion-promotion') recruit.promotions++;
    if (event.type === 'bishop-pair') recruit.hops++;
    if (event.type === 'companion-capture') {
      recruit.captures++;
      if (isTarget(event.id)) { recruit.targetCaptures++; last = event.type; }
    }
    if (event.type === 'capture' && isTarget(event.id)) last = event.type;
  }
  // The floor's challenge was completed on this action by the recruit's capture.
  if (!state.exit.open && next.exit.open && next.floor === state.floor && last === 'companion-capture') recruit.clears++;
}

// Expansions each floor's two-ply rollout may spend before its beam search
// takes over (fewer when the search's budget is nearly spent).
export const ROLLOUT_BUDGET = 2000;

// Of the floor clears among `nodes`, the one captured least (the first of
// those): only a pawn's route may be captured at all, and the run's
// allowance left carries to the next floor.
function bestClear(nodes) {
  let best = null;
  for (const node of nodes) if (node.state.exit.open && (!best || node.state.hits < best.state.hits)) best = node;
  return best;
}

/**
 * Search one floor from `start` until its challenge is complete, then take the
 * stairs at once, never captured more than `maxHits` times in the run.
 * `budget` is the search's: { explored,
 * maxExpansions, beamWidth }; `explored` grows. Returns the floor's actions
 * (the stairs last) and the state after the stairs (the next floor's start, or
 * the won run), or null when the budget runs out or every line is captured
 * too often first.
 */
function searchFloor(start, budget, maxHits, mode = AUTO) {
  const { maxExpansions, beamWidth } = budget;
  // The room's walls are fixed for the floor; a pawn may also hunt as a queen.
  const tables = {};
  const tableFor = (piece) => (tables[piece] ??= distanceTable(start.map, piece));
  const value = (state) => score(state, tableFor, mode);
  const root = { state: start, parent: null, action: null };
  // Every transition spends one from the budget: each action, and on a
  // steered search each recruit order tried with it.
  const expand = (node) => {
    const result = [];
    const visit = (action) => {
      budget.explored++;
      const next = act(node.state, action);
      const state = routeStep(node.state, next, mode);
      if (state && state.hits <= maxHits) result.push({ state, parent: node, action });
      return next;
    };
    for (const action of actionsFor(node.state, mode)) {
      if (budget.explored >= maxExpansions) break;
      const auto = visit(action);
      if (!mode.steer || auto === node.state) continue;
      for (const order of recruitOrders(node.state, action, auto, tableFor)) {
        if (budget.explored >= maxExpansions) break;
        visit({ ...action, recruit: order });
      }
    }
    return result;
  };
  // The stairs right after the clear are no choice, so they spend no budget.
  const done = (node) => {
    const state = routeStep(node.state, act(node.state, { type: 'descend' }), mode);
    return state && { actions: [...routeFor(node), { type: 'descend' }], state };
  };
  // Generation keeps a short route search budget; players have unlimited moves.
  const horizon = (MAX_ROUTE_MOVES - start.turns) * 2 + 1;
  if (start.exit.open) return done(root);

  // A clear never captured ends a floor's search at once; one that was (pawns
  // only) waits until the step or layer it was found in is done, in case
  // another clear there was captured less.
  const intact = (node) => node.state.hits === start.hits;

  // Most ordinary rooms yield to a cheap two-ply rollout. Revisiting a board
  // is penalized only as a heuristic; the beam's identity keeps the clock.
  let current = root;
  const visits = new Map();
  const rolloutLimit = Math.min(maxExpansions, budget.explored + ROLLOUT_BUDGET);
  for (let depth = 0; depth < horizon && budget.explored < rolloutLimit; depth++) {
    const key = positionKey(current.state, false);
    visits.set(key, (visits.get(key) ?? 0) + 1);
    const choices = expand(current);
    if (!choices.length) break;
    let clear = bestClear(choices);
    if (clear && intact(clear)) return done(clear);
    let best = null, bestValue = -Infinity;
    for (const choice of choices) {
      if (choice.state.exit.open) continue;
      const future = budget.explored < rolloutLimit ? expand(choice) : [];
      const futureClear = bestClear(future);
      if (futureClear) {
        clear = bestClear([clear ?? futureClear, futureClear]);
        if (intact(clear)) return done(clear);
        continue;
      }
      const ahead = value(choice.state);
      const estimate = (future.length ? Math.max(...future.map((node) => value(node.state))) : ahead)
        + ahead * 0.05 - (visits.get(positionKey(choice.state, false)) ?? 0) * 40;
      if (estimate > bestValue) { bestValue = estimate; best = choice; }
    }
    if (clear) return done(clear);
    current = best;
  }

  // Then a beam search over the floor from its start.
  let frontier = [root];
  for (let depth = 0; depth < horizon && frontier.length && budget.explored < maxExpansions; depth++) {
    const unique = new Map();
    let clear = null;
    for (const node of frontier) {
      for (const next of expand(node)) {
        if (next.state.exit.open) {
          clear = bestClear([clear ?? next, next]);
          if (intact(clear)) return done(clear);
          continue;
        }
        const key = positionKey(next.state);
        if (!unique.has(key)) unique.set(key, next);
      }
      if (budget.explored >= maxExpansions) break;
    }
    if (clear) return done(clear);
    frontier = [...unique.values()].map((node) => ({ node, value: value(node.state) }))
      .sort((a, b) => b.value - a.value).slice(0, beamWidth).map((entry) => entry.node);
  }
  return null;
}

/**
 * A bounded deterministic witness finder for one floor, not an exhaustive
 * impossibility oracle: a failed or pruned search is always "unknown", never
 * "unwinnable". From `start`, the start of a floor, it finds a route until the
 * floor's challenge is complete, then its stairs, never captured more than
 * `maxHits` times in the run (by default the run's own allowance). The
 * composer uses it for its walk fallback (src/composer.js). `maxExpansions`
 * counts simulated transitions, not elapsed time, so a result never depends
 * on the device; `beamWidth` bounds the beam search after a cheap two-ply
 * rollout; `recruit` and `everyRecruit` pick the recruit mode (RECRUIT_MODES).
 * `state` is the position after the stairs.
 */
export function findFloorRoute(start, { maxExpansions = 12_000, beamWidth = 24, recruit = 'auto', everyRecruit, maxHits } = {}) {
  if (!Number.isInteger(maxExpansions) || maxExpansions < 0 || !Number.isInteger(beamWidth) || beamWidth < 1) {
    throw new RangeError('Search budgets must be nonnegative integers with a positive beam width.');
  }
  const mode = recruitMode({ recruit, everyRecruit });
  if (!start || start.status !== 'playing' || hasPowers(start, mode)) return { status: 'unknown', explored: 0 };
  const budget = { explored: 0, maxExpansions, beamWidth };
  const floor = searchFloor(start, budget, maxHits ?? spendableHits(start), mode);
  return floor ? { status: 'solved', actions: floor.actions, state: floor.state, explored: budget.explored } : { status: 'unknown', explored: budget.explored };
}
