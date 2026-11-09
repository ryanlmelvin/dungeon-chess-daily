// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import { getRawDaily, buildTheme } from './edition.js';
import { createGame, act, RULES_VERSION } from './rules.js';
import { hash } from './random.js';
import { findWinningRoute, verifyWinningRoute, MAX_ROUTE_MOVES } from './fairness.js';
import { FALLBACKS } from './fallbacks.js';
import { DIFFICULTY_TIERS, tierForDate, targetForDate, knobsFor, difficultyScore, cappedGap, floorGapPoints, floorMinimums, freebieFloor, openPromotionFiles, GAP_FLOOR_WEIGHTS, MAX_FLOOR_PAR, LONG_FLOOR_PAR } from './difficulty.js';
import { humanPar } from './human-bot.js';
export { DIFFICULTY_TIERS, tierForDate, targetForDate } from './difficulty.js';
import { MODIFIERS } from './modifiers.js';
import { EDITIONS } from './editions.js';
import { decodeRoute, encodeRoute } from './route-code.js';

export const GENERATOR_VERSION = RULES_VERSION;
// These describe witnessed tactical pressure, not a lower bound on optimal play.
// The public edition's tier and target come from its UTC weekday, the same for
// everyone; there is deliberately no player-specific adaptive seed.
const cache = new Map();
// Candidate layouts a date may search before it falls back to the bank. Each
// has the same fixed budget (SEARCH_BUDGET simulated transitions), so the
// edition stays a pure function of the date. A day is assembled from their
// floors (rankFloors), so sixteen candidates offer up to 4,096 days; the search
// stops at the first candidate that lets one land on the day's target
// (TARGET_TOLERANCE), after about six on average (docs/generation.md).
export const ATTEMPTS = 16;
/**
 * More layouts a date may search after ATTEMPTS, only while its best day still
 * has a floor over LONG_FLOOR_PAR (two of 739 days at the time: an eight-pawn
 * floor and a pawn's king floor, at par 21 and 25, both found shorter versions).
 */
export const EXTRA_ATTEMPTS = 16;
export const SEARCH_BUDGET = 12_000;
/** A date stops searching once some assembly of its floors lands within this of its target. */
export const TARGET_TOLERANCE = 0.1;
// A day tries this many of its best assemblies before it falls back; the first certifies on almost every day.
const ASSEMBLY_TRIES = 32;

/**
 * Salt for candidate layout seeds, frozen at the rules version that first used
 * it so a rules bump doesn't re-roll the layout of every day that took a
 * later candidate. Change it only to re-roll those layouts on purpose.
 */
export const LAYOUT_SEED_VERSION = 7;
/** Layout seed of a date's numbered candidate; the same for every tier. */
export const candidateSeed = (base, attempt) => (attempt === 0 ? base.seed : hash(`${LAYOUT_SEED_VERSION}:${base.seed}:${attempt}`));

/**
 * The uncertified edition a tier's knobs build for a raw daily. `attempt` is
 * one candidate's number, whose layout seed builds all three floors, or a list
 * of three, one candidate per floor: an assembled day, whose `floorSeeds` give
 * each floor its candidate's seed (src/rules.js floorSeed). A floor plays the
 * same in its own candidate and in any day assembled with it.
 */
export function candidateFor(base, tier, knobs, attempt = 0) {
  const floors = Array.isArray(attempt) ? attempt : null;
  return {
    ...base, difficulty: tier, dungeonSeed: candidateSeed(base, floors ? floors[0] : attempt),
    ...(floors && { floorSeeds: floors.map((each) => candidateSeed(base, each)) }),
    obstacleBase: knobs.obstacleBase, decoys: knobs.decoys, scatter: knobs.scatter, guards: knobs.guards, screens: knobs.screens,
  };
}

/**
 * A replayable route's floors, in order: each floor's actions (its stairs
 * last), the moves it spent (`turns`, toward MAX_ROUTE_MOVES) and the lives it
 * lost (a pawn's route may lose some).
 */
export function routeFloors(candidate, actions) {
  let state = createGame(candidate);
  const floors = [];
  let part = { actions: [], turns: state.turns, hp: state.player.hp };
  for (const action of actions) {
    const next = act(state, action);
    part.actions.push(action);
    if (action.type === 'descend' && (next.floor !== state.floor || next.status === 'won')) {
      floors.push({ actions: part.actions, turns: next.turns - part.turns, lives: part.hp - next.player.hp });
      part = { actions: [], turns: next.turns, hp: next.player.hp };
    }
    state = next;
  }
  return floors;
}

/**
 * Bounded search plus independent replay, then the human-like bot on the
 * route. `status` is 'solved' (with actions, metrics, the score, the bot's
 * `human` result, src/human-bot.js humanPar, the capped human gap `gap`, its
 * whole-number parts per floor `points` over `runs` runs a floor, each floor's
 * par `pars` and the route's `floors`, routeFloors), 'unknown' (the budget ran out) or 'invalid'
 * (a route the replay rejected); `explored` counts the search's simulated
 * transitions. The bot plays each floor from the route's own standard start
 * with the same seeds and the same default recruit policy as the edition's
 * par, so a floor's par and gap here are the ones it has in any day assembled
 * with it. Never pass a policy here that par doesn't use.
 * `recruit` and `everyRecruit` pick the recruit mode (src/fairness.js
 * RECRUIT_MODES): generation always certifies on Auto; tooling may measure a
 * steered recruit. `floorSearch` (tooling) watches each floor's search
 * (findWinningRoute).
 */
export function searchCandidate(candidate, budget = SEARCH_BUDGET, { recruit = 'auto', everyRecruit, floorSearch } = {}) {
  const options = { recruit, everyRecruit };
  const result = findWinningRoute(createGame(candidate), { maxExpansions: budget, ...options, floorSearch });
  if (result.status !== 'solved') return { status: 'unknown', explored: result.explored };
  const proof = verifyWinningRoute(createGame(candidate), result.actions, options);
  if (!proof.valid) return { status: 'invalid', explored: result.explored };
  const human = humanPar({ ...candidate, generation: { certificate: { actions: result.actions } } });
  return {
    status: 'solved', explored: result.explored, actions: result.actions, metrics: proof.metrics,
    score: difficultyScore(proof.metrics, candidate.playerPiece), human, gap: human ? cappedGap(human) : null,
    points: human ? floorGapPoints(human) : null, runs: human ? human.results[0].length : 0, pars: human ? human.par : null,
    floors: routeFloors(candidate, result.actions),
  };
}

/**
 * Every way to make a day from the floors of the candidates searched so far,
 * best first. `found` lists each attempt's searchCandidate() result (or null)
 * in order; only solved ones with the bot's runs count, and only floors their
 * route didn't clear in under `minFloorMoves` moves (the tier's no-freebie
 * rule; tooling may pass 0 or a floorMinimums list). Floor f may come from any
 * of them; the day's capped human gap is the sum of its floors' (weighted by
 * GAP_FLOOR_WEIGHTS), its route the floors' routes in turn, which must stay
 * within MAX_ROUTE_MOVES and lose at most `lives` lives (a pawn's allowance;
 * the verifier still checks the whole run).
 *
 * Order: floors short enough come first: an assembly whose every floor's par
 * keeps to MAX_FLOOR_PAR beats any other (else the one whose floors run past
 * it by the fewest moves in all). Then an assembly within TARGET_TOLERANCE of `target` beats any
 * other, and among those the most even wins (the lightest hardest floor),
 * then the closest; otherwise the closest, then the most even. Ties keep the
 * earlier candidates (floor by floor). Each entry: { floors: [three attempt
 * numbers], gap, distance, within (on target with every floor short enough),
 * longest (par) }. Gaps are added in whole-number points, so the order never
 * depends on rounding. Empty: no floor has a candidate (fallback).
 * Calibration (scripts/calibrate-difficulty.mjs) replays this same choice.
 * `wholeDays` (tooling that measures each candidate as a whole) keeps only
 * days whose three floors come from one candidate.
 */
export function rankFloors(found, target, tier, minFloorMoves = DIFFICULTY_TIERS[tier]?.minFloorMoves ?? 0, { lives = 4, wholeDays = false } = {}) {
  const solved = found.map((entry, attempt) => ({ entry, attempt })).filter(({ entry }) => entry?.points && entry.metrics && entry.floors?.length === 3);
  if (!solved.length) return [];
  const runs = solved[0].entry.runs;
  const minimums = floorMinimums(minFloorMoves);
  const options = [0, 1, 2].map((floor) => solved
    .filter(({ entry }) => entry.runs === runs && entry.metrics.floorMoves[floor] >= minimums[floor])
    .map(({ entry, attempt }) => ({
      attempt, points: (GAP_FLOOR_WEIGHTS[floor] ?? 1) * entry.points[floor], turns: entry.floors[floor].turns, lives: entry.floors[floor].lives, par: entry.pars?.[floor] ?? 0,
    })));
  if (options.some((list) => !list.length)) return [];
  const goal = Math.round(target * runs), slack = Math.round(TARGET_TOLERANCE * runs);
  const ranked = [];
  for (const a of options[0]) for (const b of options[1]) for (const c of options[2]) {
    if (a.turns + b.turns + c.turns > MAX_ROUTE_MOVES || a.lives + b.lives + c.lives > lives) continue;
    if (wholeDays && (a.attempt !== b.attempt || b.attempt !== c.attempt)) continue;
    const off = Math.abs(a.points + b.points + c.points - goal), longest = Math.max(a.par, b.par, c.par);
    // Every floor's moves past the cap count, so a floor that must run long doesn't excuse another.
    const over = [a, b, c].reduce((sum, floor) => sum + Math.max(0, floor.par - MAX_FLOOR_PAR), 0);
    ranked.push({ floors: [a.attempt, b.attempt, c.attempt], off, longest, over, most: Math.max(a.points, b.points, c.points), total: a.points + b.points + c.points });
  }
  ranked.sort((x, y) => {
    if (x.over !== y.over) return x.over - y.over;
    const inX = x.off <= slack, inY = y.off <= slack;
    if (inX !== inY) return inX ? -1 : 1;
    const order = inX ? x.most - y.most || x.off - y.off : x.off - y.off || x.most - y.most;
    return order || x.floors[0] - y.floors[0] || x.floors[1] - y.floors[1] || x.floors[2] - y.floors[2];
  });
  return ranked.map(({ floors, off, total, over, longest }) => ({ floors, gap: Math.round(total / runs * 10) / 10, distance: off / runs, within: off <= slack && !over, longest }));
}

/**
 * generateDaily's candidate searches for a raw daily, in order, up to `count`
 * (ATTEMPTS): after each one it stops as soon as some assembly of the floors
 * so far lands within TARGET_TOLERANCE of `target` with every floor short
 * enough (rankFloors). With the full budget, a day whose best still has a
 * floor over LONG_FLOOR_PAR goes on, up to EXTRA_ATTEMPTS more, until it has
 * none. Every search has the same fixed budget and the bot's runs are seeded,
 * so which ones run is a pure function of the date. Returns each
 * searchCandidate() result.
 */
export function searchCandidates(base, tier, settings, count = ATTEMPTS, target = targetForDate(base.date, tier)) {
  const found = [];
  const best = () => rankFloors(found, target, tier)[0];
  for (let attempt = 0; attempt < count; attempt++) {
    found.push(searchCandidate(candidateFor(base, tier, settings, attempt)));
    if (found[attempt].status === 'solved' && best()?.within) return found;
  }
  if (count !== ATTEMPTS) return found;
  for (let attempt = ATTEMPTS; attempt < ATTEMPTS + EXTRA_ATTEMPTS && !(best()?.longest <= LONG_FLOOR_PAR); attempt++) {
    found.push(searchCandidate(candidateFor(base, tier, settings, attempt)));
  }
  return found;
}

function certify(daily, actions, source, attempt, knobs) {
  const proof = verifyWinningRoute(createGame(daily), actions);
  if (!proof.valid || proof.metrics.threatenedDecisions < knobs.minThreatenedDecisions || freebieFloor(proof.metrics, daily.difficulty)) return null;
  return {
    ...daily,
    generation: {
      version: GENERATOR_VERSION, source, attempt,
      certificate: { actions: structuredClone(actions), metrics: proof.metrics, score: difficultyScore(proof.metrics, daily.playerPiece) },
    },
  };
}

/** True for a stored or remembered edition's `attempt`: 'fallback', or one candidate per floor. */
export const validAttempt = (attempt) => attempt === 'fallback'
  || (Array.isArray(attempt) && attempt.length === 3 && attempt.every((each) => Number.isInteger(each) && each >= 0 && each < ATTEMPTS + EXTRA_ATTEMPTS));

/**
 * Generate and certify every edition before returning any playable dungeon.
 * `difficulty` is a tier id (src/difficulty.js); omitted, it is the date's
 * weekday tier. `knobs` overrides the calibrated knobs (tooling only), and
 * `fallback: false` returns null instead of using the fallback bank.
 */
// Dates past the build's precomputed window search once per device, then the
// certified result is remembered in browser storage and replayed like a
// precomputed entry. Storage may be missing or blocked; that only costs speed.
const deviceKey = (date) => `dchess-edition:v${GENERATOR_VERSION}:${date}`;
function rememberedEdition(date) {
  try {
    const entry = JSON.parse(globalThis.localStorage?.getItem(deviceKey(date)) ?? 'null');
    return validAttempt(entry?.attempt) && typeof entry.tier === 'string' && typeof entry.route === 'string' && entry.route.length <= 200 ? entry : undefined;
  } catch { return undefined; }
}
function rememberEdition(daily) {
  const { source, attempt, certificate } = daily.generation;
  const entry = { tier: daily.difficulty, attempt: source === 'fallback' ? 'fallback' : attempt, route: source === 'fallback' ? '' : encodeRoute(certificate.actions) };
  try { globalThis.localStorage?.setItem(deviceKey(daily.date), JSON.stringify(entry)); } catch { /* storage is optional */ }
}

export function generateDaily(date = new Date(), { difficulty, maxAttempts = ATTEMPTS, knobs, fallback = true, precomputed = true } = {}) {
  const base = getRawDaily(date);
  const tier = difficulty ?? tierForDate(base.date);
  if (!Object.hasOwn(DIFFICULTY_TIERS, tier)) throw new RangeError('Unknown difficulty tier.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > ATTEMPTS) throw new RangeError('Invalid candidate budget.');
  const settings = { ...knobsFor(tier, base.playerPiece), ...knobs };
  // Build-time certified editions (src/editions.js, scripts/build-editions.mjs)
  // replay a stored route instead of searching. It is the same result the
  // search below would reach; a stale entry is ignored and the search runs.
  const official = precomputed && !knobs && maxAttempts === ATTEMPTS;
  const stored = official ? EDITIONS[base.date] ?? rememberedEdition(base.date) : undefined;
  let searches = maxAttempts;
  if (stored && stored.tier === tier && validAttempt(stored.attempt)) {
    if (stored.attempt === 'fallback') searches = 0;
    else {
      const accepted = certify(candidateFor(base, tier, settings, stored.attempt), decodeRoute(stored.route), 'generated', stored.attempt, settings);
      if (accepted) return accepted;
    }
  }
  // Assemble the day from the candidates' floors, the best assembly that certifies as one whole run.
  const found = searchCandidates(base, tier, settings, searches, targetForDate(base.date, tier));
  let kept = null;
  for (const { floors } of rankFloors(found, targetForDate(base.date, tier), tier).slice(0, ASSEMBLY_TRIES)) {
    const actions = floors.flatMap((attempt, floor) => found[attempt].floors[floor].actions);
    const accepted = certify(candidateFor(base, tier, settings, floors), actions, 'generated', floors, settings);
    if (!accepted) continue;
    kept ??= accepted;
    // A pawn starts each floor with the lives the floors before left it, so the
    // bot can find a stitched floor much longer than it did in its own
    // candidate (one king floor went from par 9 to 25): keep a pawn's day only
    // if no floor runs past MAX_FLOOR_PAR further than its part said.
    if (base.playerPiece === 'pawn') {
      const pars = humanPar(accepted)?.par ?? [];
      if (pars.some((par, floor) => par > Math.max(MAX_FLOOR_PAR, found[floors[floor]].pars[floor]))) continue;
    }
    kept = accepted;
    break;
  }
  if (kept) {
    if (official && !EDITIONS[base.date]) rememberEdition(kept);
    return kept;
  }
  if (!fallback) return null;
  // Bounded search may miss a solution. Fall back to a tested complete dungeon,
  // retaining this date's piece/color and cosmetic variety. Never accept an
  // uncertified layout, even if a future rule change invalidates the fallback.
  // Each room modifier has its own bank; plain days share one.
  const entry = FALLBACKS[fallbackKey(tier, base.playerPiece, base.playerColor, base.modifier)];
  if (!entry) throw new Error('No certified fallback for this edition.');
  const template = getRawDaily(entry.date);
  const species = base.species.map((creature, index) => ({ ...creature, piece: template.species[index].piece }));
  // The template's layout, barricades included (they follow its date's weekday).
  const certified = certify({
    ...candidateFor(base, tier, settings), dungeonSeed: entry.dungeonSeed, targets: [...template.targets],
    species, theme: buildTheme(species), openFiles: openPromotionFiles(entry.date),
  }, entry.actions, 'fallback', maxAttempts, settings);
  if (!certified) throw new Error('Dungeon certification failed. No unverified dungeon was released.');
  if (official && !EDITIONS[base.date]) rememberEdition(certified);
  return certified;
}

/** Bank key: modifiers that change play (ice, collapse) have their own certificates. */
export function fallbackKey(tier, piece, color, modifier = 'none') {
  return `${tier}:${piece}:${color}${MODIFIERS[modifier]?.changesRules ? `:${modifier}` : ''}`;
}

export function getDaily(date = new Date(), { difficulty } = {}) {
  const raw = getRawDaily(date);
  const tier = difficulty ?? tierForDate(raw.date);
  const key = `${raw.date}:${tier}`;
  if (!cache.has(key)) {
    const daily = generateDaily(raw.date, { difficulty: tier });
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, daily);
  }
  // A caller cannot poison future daily generation by mutating its result.
  return structuredClone(cache.get(key));
}
