// SPDX-License-Identifier: GPL-3.0-only
// Helpers for scripts/calibrate-difficulty.mjs. For the data file: what each
// row keeps (the bot's runs, the route, every floor's search), writing and
// reading it a row at a time, measuring a candidate again while reusing what
// still holds, the per-class fingerprints that say what still holds, and the
// check that refuses an incompatible file. For --fast: a least-squares
// surrogate of the gap on the knobs, monotone-dominance pruning, and a paired
// test for sequential stopping. None of the --fast helpers touches generation
// or the fit: they only decide which settings get full-budget searches.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cappedGap } from '../src/difficulty.js';
import { searchCandidate, SEARCH_BUDGET } from '../src/generation.js';
import { createGame, act, legalMoves, whileSearching } from '../src/rules.js';
import { findWinningRoute, verifyWinningRoute, findFloorRoute, routeTransition, positionKey } from '../src/fairness.js';
import { certifiedFloors, playFloor, runSeed, HUMAN_RUNS } from '../src/human-bot.js';
import { encodeRoute, decodeRoute } from '../src/route-code.js';
import { hash, random } from '../src/random.js';

/**
 * Version of the calibration data files (--data, the --fast shortlist). 3:
 * each row also keeps its route and every floor's search (`searches`), and
 * the file keeps a fingerprint per class (`classes`), so a later run reuses
 * what still holds. 2 kept the bot's runs (`human`) and one fingerprint for
 * the whole file. Files of another version are measured again from scratch.
 */
export const DATA_VERSION = 3;

/** The route metrics a row keeps: the score's, and floorMoves for the freebie rule and the route's side of the gap. */
export const SCORE_METRICS = Object.freeze(['turns', 'threatenedDecisions', 'narrowEscapes', 'hits', 'unsafeAlternatives', 'legalAlternatives', 'floorMoves']);
const pickMetrics = (metrics) => Object.fromEntries(SCORE_METRICS.map((name) => [name, metrics[name]]));

/** The header fields a data file must carry for these rules (dataProblem checks them). */
export const dataStamp = ({ rules, bot, attempts, searchBudget }) => ({ dataVersion: DATA_VERSION, rulesVersion: rules, humanBotVersion: bot, attempts, searchBudget });

/**
 * Why a data file (its parsed JSON) can't be reused at all, or null when its
 * rows may be (each class still has to pass its fingerprints, changedClasses).
 * `expected` is dataStamp()'s input. The rules and bot versions don't matter:
 * the fingerprints and the stored starts decide what still holds.
 */
export function dataProblem(file, { attempts, searchBudget }) {
  if (file?.dataVersion !== DATA_VERSION) return `it has data version ${file?.dataVersion ?? 'none'}, not ${DATA_VERSION} (rows without their routes and floor searches)`;
  if (file.attempts !== attempts) return `it was measured with attempts ${file.attempts}, not ${attempts}`;
  if (file.searchBudget !== searchBudget) return `it was measured with searchBudget ${file.searchBudget}, not ${searchBudget}`;
  return null;
}

// A path given as a string or a file: URL (the script's --data).
const filePath = (path) => (path instanceof URL || String(path).startsWith('file:') ? fileURLToPath(path) : String(path));

/**
 * Write a data file without ever holding it as one string: a full run's is
 * hundreds of megabytes, and Node's longest string is about 512 MB. The
 * first line holds `header`'s fields, then each of `classes` (key → entry)
 * and each of `rows` gets a line of its own; the whole file is still one
 * JSON object, `{ ...header, classes, rows }`. It goes to a temporary file
 * beside `path` and replaces `path` only once complete, so a failed write
 * never costs the last run's data.
 */
export async function writeDataFile(path, header, classes, rows) {
  path = filePath(path);
  const temp = `${path}.${process.pid}.tmp`;
  const out = createWriteStream(temp, { encoding: 'utf8' });
  let failure = null;
  out.on('error', (error) => { failure ??= error; });
  const entries = Object.entries(classes);
  function* lines() {
    yield `${JSON.stringify(header).slice(0, -1)},\n"classes":{\n`;
    for (const [index, [key, entry]] of entries.entries()) yield `${JSON.stringify(key)}:${JSON.stringify(entry)}${index < entries.length - 1 ? ',' : ''}\n`;
    yield '},\n"rows":[\n';
    for (let index = 0; index < rows.length; index++) yield `${JSON.stringify(rows[index])}${index < rows.length - 1 ? ',' : ''}\n`;
    yield ']}\n';
  }
  try {
    // Lines go out in chunks of about a megabyte, waiting whenever the stream is full.
    let chunk = '';
    for (const line of lines()) {
      chunk += line;
      if (chunk.length < 1 << 20) continue;
      if (failure) throw failure;
      const text = chunk;
      chunk = '';
      if (!out.write(text)) await once(out, 'drain');
    }
    out.end(chunk);
    await finished(out);
    if (failure) throw failure;
  } catch (error) {
    out.destroy();
    await unlink(temp).catch(() => {});
    throw error;
  }
  await rename(temp, path);
}

/**
 * Read a data file a line at a time (writeDataFile's layout, which older
 * files share), never holding it as one string. `onHeader(header)` sees the
 * header (its fields and `classes`) before any row and may return false to
 * stop there; `onRow(row)` sees each row in turn. Returns the header, or
 * null when onHeader stopped. A file in any other layout is parsed whole, so
 * it has to fit in one string.
 */
export async function readDataFile(path, { onHeader = () => true, onRow = () => {} } = {}) {
  path = filePath(path);
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const head = [];
  let header = null, done = false;
  try {
    for await (const line of lines) {
      if (!header) {
        if (line !== '"rows":[') { head.push(line); continue; }
        header = JSON.parse(`${head.join('\n')}"rows":[]}`);
        delete header.rows;
        head.length = 0;
        if (onHeader(header) === false) return null;
        continue;
      }
      if (done || !line) {
        if (line.trim()) throw new Error(`${path}: text after the rows`);
        continue;
      }
      if (line === ']}') { done = true; continue; }
      onRow(JSON.parse(line.endsWith(',') ? line.slice(0, -1) : line));
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (header && !done) throw new Error(`${path} ends before its rows do`);
  if (header) return header;
  // Another layout: the lines read are the whole file.
  const file = JSON.parse(head.join('\n'));
  const rows = file.rows ?? [];
  delete file.rows;
  if (onHeader(file) === false) return null;
  for (const row of rows) onRow(row);
  return file;
}

/** A search's bot runs, compact for the data file: per floor, each run's moves when it won, else null. */
export function compactRuns(human) {
  return human ? human.results.map((runs) => runs.map((run) => (run.won ? run.moves : null))) : null;
}

/** The capped human gap of a stored search: its compactRuns() and its route's moves per floor. Null without both. */
export function storedGap(entry) {
  if (!Array.isArray(entry?.human) || !Array.isArray(entry.metrics?.floorMoves)) return null;
  const results = entry.human.map((runs) => runs.map((moves) => ({ won: moves !== null, moves: moves ?? 0 })));
  return cappedGap({ results, certified: entry.metrics.floorMoves });
}

const sha = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/**
 * A position's identity for reuse: the whole state but its words (message,
 * notes), the last action's events, the floor snapshot (a copy of the floor's
 * start) and the version stamps, so that a version bump alone doesn't make
 * every stored search look stale.
 */
export function stateDigest(state) {
  const { message, notes, events, floorSnapshot, schema, rulesVersion, ...rest } = state;
  return sha(JSON.stringify(rest));
}

/** A data row's key: piece, setting, date and candidate. */
export const rowKey = ({ piece, setting, date, attempt }) => `${piece}|${setting}|${date}|${attempt}`;

/**
 * The class of one floor of a day's searches: the player's piece, the room
 * modifier, the floor (1-3) and the tier, whose monsters grow smarter. Each
 * class gets its own fingerprints, and a change re-measures only the floors
 * of the classes it touches.
 */
export const classKey = (piece, modifier, floor, tier) => `${piece}/${modifier}/${floor + 1}/${tier}`;

/**
 * A row's `searches`: every floor's search in the order the certificate
 * search ran them (src/fairness.js findWinningRoute; a pawn day may search a
 * floor again allowing fewer captures), each [floor (0-2), the most captures
 * the run may have by its end (maxHits), expansions it used, stateDigest of
 * its start, its route segment
 * (encodeRoute, stairs last) or null when it failed]. A floorSearch hook that
 * records them.
 */
export function recordFloors(searches) {
  return ({ start, maxHits, search }) => {
    const done = search();
    searches.push([start.floor, maxHits, done.explored, stateDigest(start), done.floor ? encodeRoute(done.floor.actions) : null]);
    return done;
  };
}

/** The route a row's searches end on: each floor's last search, when the last search cleared floor 3. Else null. */
export function finalRoute(searches) {
  const last = searches?.at(-1);
  if (!last || last[0] !== 2 || last[4] === null) return null;
  const segments = [];
  for (const [floor, , , , segment] of searches) segments[floor] = segment;
  return segments.join('');
}

/** stateDigest of each floor's start on the route a row's searches end on (finalRoute), or null. */
function finalStarts(searches) {
  if (finalRoute(searches) === null) return null;
  const starts = [];
  for (const [floor, , , digest] of searches) starts[floor] = digest;
  return starts;
}

/**
 * The start of the last search of `floor` in a row's `searches`, rebuilt by
 * replaying the segments the search had kept before it (null when no search
 * reached the floor, or the segments no longer replay).
 */
export function floorStart(candidate, searches, floor) {
  let path = null;
  const segments = [];
  for (const [searched, , , , segment] of searches) {
    if (searched === floor) path = segments.slice(0, floor);
    segments[searched] = segment;
  }
  if (!path) return null;
  return whileSearching(() => {
    let state = createGame(candidate);
    for (const segment of path) {
      if (typeof segment !== 'string') return null;
      for (const action of decodeRoute(segment)) {
        const next = act(state, action);
        if (next === state) return null;
        state = next;
      }
    }
    return state.floor === floor && state.status === 'playing' ? state : null;
  });
}

/**
 * A stored floor search's result again: the segment's actions replayed from
 * `start` through the route rules (src/fairness.js routeTransition), never
 * captured more than `maxHits` times in the run, moving only while the floor's challenge is open and
 * taking the stairs right after it. Null when any step no longer holds.
 */
function replaySegment(start, segment, maxHits) {
  const actions = decodeRoute(segment);
  let state = start;
  for (const [index, action] of actions.entries()) {
    const descend = action.type === 'descend';
    if (descend !== (index === actions.length - 1) || state.exit.open !== descend) return null;
    const next = routeTransition(state, action);
    if (!next || next.hits > maxHits) return null;
    state = next;
  }
  return { actions, state };
}

/**
 * A floorSearch hook (src/fairness.js findWinningRoute) that stands in for
 * the searches a row already holds (`stored`, its `searches`): wherever the
 * same floor is searched from the same start (stateDigest), with the same
 * capture allowance, after the same expansions, and `fresh[floor]` is false, the stored
 * result is replayed instead (replaySegment), with its expansions. Search is
 * deterministic, so that is what searching would give, as long as the
 * floor's search behaves as before: the class fingerprints' job. Every other
 * floor is searched. Records every search into `searches`, and counts per
 * floor the searches stood in for (`tally.served`) and run (`tally.searched`),
 * and the expansions searched (`tally.expansions`).
 */
export function reuseFloors(stored, fresh, searches, tally) {
  const known = new Map();
  let before = 0;
  for (const entry of stored) {
    known.set(`${entry[0]}|${entry[1]}|${before}|${entry[3]}`, entry);
    before += entry[2];
  }
  return ({ start, maxHits, explored, search }) => {
    const digest = stateDigest(start);
    const entry = fresh[start.floor] ? undefined : known.get(`${start.floor}|${maxHits}|${explored}|${digest}`);
    const floor = entry && entry[4] !== null ? replaySegment(start, entry[4], maxHits) : null;
    if (entry && (entry[4] === null || floor)) {
      tally.served[start.floor]++;
      searches.push([...entry]);
      return { floor, explored: entry[2] };
    }
    tally.searched[start.floor]++;
    const done = search();
    tally.expansions += done.explored;
    searches.push([start.floor, maxHits, done.explored, digest, done.floor ? encodeRoute(done.floor.actions) : null]);
    return done;
  };
}

/**
 * Measure one candidate as generation does (searchCandidate), keeping what a
 * data row needs: status, expansions, wall time, the route metrics, the bot's
 * runs (compactRuns), the route (encodeRoute; also for an invalid one) and
 * every floor's search (recordFloors).
 */
export function measureCandidate(candidate, budget = SEARCH_BUDGET) {
  const began = performance.now();
  const searches = [];
  const result = searchCandidate(candidate, budget, { floorSearch: recordFloors(searches) });
  return {
    status: result.status, explored: result.explored, ms: Math.round(performance.now() - began),
    metrics: result.metrics ? pickMetrics(result.metrics) : null, human: compactRuns(result.human),
    route: result.status === 'unknown' ? null : finalRoute(searches), searches,
  };
}

// Every seeded bot run on one floor, as humanPar plays them, compact.
const floorRuns = (start, daily, floor) => Array.from({ length: HUMAN_RUNS }, (_, run) => {
  const { won, moves } = playFloor(start, { seed: runSeed(daily, floor, run) });
  return won ? moves : null;
});

/**
 * Measure a candidate again, reusing what its last measurement (`stored`, a
 * data row with `searches`) still says. `stale.search[floor]` marks floors
 * whose class's search fingerprint changed: those floors are searched again
 * (and every floor after one whose result changed: its start differs), the
 * rest are stood in for (reuseFloors). The route is then verified as
 * searchCandidate verifies it. A floor's bot runs are kept when its class's
 * search and bot fingerprints both held (`stale.bot`) and the route reaches
 * it in the same position; otherwise they are played again from the route's
 * start there, as humanPar plays them. Returns the row and `notes`: per floor
 * the searches served and run (and the expansions searched), what became of
 * the bot runs ('kept' or 'played'), `guard` when every search was served
 * but the route no longer verifies to the stored status and metrics, and
 * `spot`, the kept floors where one bot run played again (picked by `key`;
 * `spotCheck: false` skips it) came out differently. Wall time (`ms`) stays
 * the stored one when every search was served.
 */
export function remeasureCandidate(candidate, stored, stale, { key = '', spotCheck = true } = {}) {
  const began = performance.now();
  const searches = [], tally = { served: [0, 0, 0], searched: [0, 0, 0], expansions: 0 };
  const found = findWinningRoute(createGame(candidate), { maxExpansions: SEARCH_BUDGET, floorSearch: reuseFloors(stored.searches, stale.search, searches, tally) });
  const notes = { ...tally, bot: [null, null, null], guard: null, spot: [] };
  const row = { status: 'unknown', explored: found.explored, ms: 0, metrics: null, human: null, route: null, searches };
  if (found.status === 'solved') {
    row.route = encodeRoute(found.actions);
    const proof = verifyWinningRoute(createGame(candidate), found.actions);
    row.status = proof.valid ? 'solved' : 'invalid';
    if (proof.valid) {
      row.metrics = pickMetrics(proof.metrics);
      const daily = { ...candidate, generation: { certificate: { actions: found.actions } } };
      const starts = finalStarts(searches), before = stored.status === 'solved' && Array.isArray(stored.human) ? finalStarts(stored.searches) : null;
      let certified;
      const human = [];
      for (let floor = 0; floor < 3; floor++) {
        if (before && !stale.search[floor] && !stale.bot[floor] && before[floor] === starts[floor]) {
          human.push(stored.human[floor]);
          notes.bot[floor] = 'kept';
          if (!spotCheck) continue;
          // One of the kept runs played again: a bot change the fingerprints missed shows here.
          certified ??= certifiedFloors(daily);
          const run = hash(`${key}:${floor}`) % HUMAN_RUNS;
          const { won, moves } = certified ? playFloor(certified.starts[floor], { seed: runSeed(daily, floor, run) }) : { won: false };
          if ((won ? moves : null) !== stored.human[floor][run]) notes.spot.push(floor);
          continue;
        }
        certified ??= certifiedFloors(daily);
        if (!certified) break;
        human.push(floorRuns(certified.starts[floor], daily, floor));
        notes.bot[floor] = 'played';
      }
      // humanPar gives nothing without a replayable certificate.
      row.human = certified === null ? null : human;
    }
  }
  const served = tally.searched.every((count) => count === 0);
  if (served && (row.status !== stored.status || JSON.stringify(row.metrics) !== JSON.stringify(stored.metrics))) notes.guard = row.status !== stored.status ? 'status' : 'metrics';
  row.ms = served ? stored.ms : Math.round(performance.now() - began);
  return { row, notes };
}

/** Probes per class (pickProbes): each walks the rules and plays the bot; the first SEARCH_PROBES also search. */
export const BOT_PROBES = 24;
export const SEARCH_PROBES = 4;
/** Expansions of a probe's floor search (findFloorRoute). */
export const PROBE_BUDGET = 3000;
/** Transitions a probe's random walks hash, in walks of at most WALK_DEPTH steps. */
export const WALK_TRANSITIONS = 2000;
export const WALK_DEPTH = 40;

/**
 * Up to `count` rows of one group (same piece, modifier and tier) that
 * searched `floor`, in a fixed pseudo-random order: a class's probes.
 */
export function pickProbes(rows, floor, count = BOT_PROBES) {
  return rows.filter((row) => Array.isArray(row.searches) && row.searches.some(([searched]) => searched === floor))
    .map((row) => ({ row, order: sha(`${rowKey(row)}:${floor}`) }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).slice(0, count).map(({ row }) => row);
}

// Seeded random walks through the route rules from `start`, WALK_DEPTH steps
// at most, until `transitions` are spent: at every step each action's result
// (src/fairness.js routeTransition: what the search sees) goes into
// `hasher`, then the walk takes one at random. Every monster's reply to every
// move is in the hash, so a change to the rules or the monsters that any of
// those positions meets changes it.
function walk(start, seed, hasher, transitions = WALK_TRANSITIONS) {
  const rng = random(seed);
  for (let spent = 0; spent < transitions;) {
    let state = start, steps = 0;
    for (; steps < WALK_DEPTH && spent < transitions; steps++) {
      const onward = [];
      for (const action of [{ type: 'wait' }, ...legalMoves(state).map(({ x, y }) => ({ type: 'move', x, y }))]) {
        const next = routeTransition(state, action);
        spent++;
        hasher.update(next ? `${positionKey(next)}|${next.events.map((event) => event.type).join()}|${next.objective.moves ?? ''}\n` : '-\n');
        if (next && next.status === 'playing' && next.floor === state.floor && !next.exit.open) onward.push(next);
      }
      if (!onward.length) break;
      state = onward[Math.floor(rng() * onward.length)];
    }
    // Nowhere to go from the start: every walk would be this one.
    if (steps === 0) break;
  }
}

/**
 * A class's fingerprints from its probes ([{ candidate, searches }], from
 * pickProbes), each played from its start of `floor` (floorStart, under these
 * rules). `search` hashes each start and seeded random walks through every
 * action the search could take (WALK_TRANSITIONS of them), and for the first
 * SEARCH_PROBES the floor's own search (findFloorRoute, PROBE_BUDGET
 * expansions): it changes with the rules, monsters, modifier and search on
 * that floor. A search's result rarely shows a change to the monsters (it
 * finds the same route anyway), but some walk usually meets it. `bot` hashes
 * each start and the bot's seeded runs there (humanPar's seeds and recruit
 * policy): it changes with the bot and with the rules it plays. A changed
 * start (the layout, or the floors before) changes both.
 */
export function classFingerprint(probes, floor, { searchProbes = SEARCH_PROBES } = {}) {
  const search = createHash('sha1'), bot = createHash('sha1');
  for (const [index, { candidate, searches }] of probes.entries()) {
    const start = floorStart(candidate, searches, floor);
    if (!start) { search.update('none\n'); bot.update('none\n'); continue; }
    const digest = stateDigest(start);
    bot.update(`${digest}\n`);
    for (let run = 0; run < HUMAN_RUNS; run++) {
      const { won, moves, hits, actions } = playFloor(start, { seed: runSeed(candidate, floor, run) });
      bot.update(`${won}|${moves}|${hits}|${JSON.stringify(actions)}\n`);
    }
    search.update(`${digest}\n`);
    whileSearching(() => {
      if (index < searchProbes) {
        const found = findFloorRoute(start, { maxExpansions: PROBE_BUDGET });
        search.update(`${found.status}|${found.explored}|${found.actions ? encodeRoute(found.actions) : ''}\n`);
      }
      walk(start, hash(`walk:${digest}`), search);
    });
  }
  return { search: search.digest('hex').slice(0, 12), bot: bot.digest('hex').slice(0, 12) };
}

/** Knobs that make a layout harder (difficulty mostly rises with each). */
export const MONOTONE_KNOBS = ['obstacleBase', 'decoys', 'guards', 'screens'];

/** Feature vector: intercept, knobs, and pairwise products of the knobs. */
export function features(setting) {
  const base = [setting.obstacleBase, setting.decoys, setting.scatter ?? 0, setting.guards, setting.screens ?? 0];
  const out = [1, ...base];
  for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) out.push(base[i] * base[j]);
  return out;
}

/**
 * Ridge least squares of `y` on features(setting). Returns { predict, residualSd }.
 * The small ridge keeps constant columns (a pawn's scatter, an absent screens
 * knob) from making the system singular.
 */
export function fitSurrogate(points, ridge = 1e-3) {
  const X = points.map((point) => features(point.setting));
  const p = X[0]?.length ?? features({ obstacleBase: 0, decoys: 0, guards: 0 }).length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j && i > 0 ? ridge * Math.max(1, points.length) : 0)));
  const b = Array(p).fill(0);
  X.forEach((row, n) => {
    for (let i = 0; i < p; i++) { b[i] += row[i] * points[n].y; for (let j = 0; j < p; j++) A[i][j] += row[i] * row[j]; }
  });
  const w = solve(A, b);
  const predict = (setting) => features(setting).reduce((sum, value, i) => sum + value * w[i], 0);
  const residuals = points.map((point) => point.y - predict(point.setting));
  const dof = Math.max(1, points.length - p);
  const residualSd = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / dof);
  return { predict, residualSd, weights: w };
}

function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) { M[c][c] = 1e-12; }
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** a ≥ b on every monotone knob, with the same scatter (scatter is not monotone). */
export function dominates(a, b) {
  return (a.scatter ?? 0) === (b.scatter ?? 0) && MONOTONE_KNOBS.every((knob) => (a[knob] ?? 0) >= (b[knob] ?? 0));
}

/**
 * Settings that cannot win any tier under approximate monotonicity: s is at
 * least as hard as some t whose mean already sits over `ceiling`, or at most as
 * hard as some t whose mean sits under `floor`. Callers pass bounds a margin
 * beyond the hardest and easiest bands, because monotonicity is only rough.
 * entries: [{ id, setting, mean|null }]. Returns a Set of pruned ids.
 */
export function dominatedOut(entries, floor, ceiling) {
  const pruned = new Set();
  const measured = entries.filter((entry) => entry.mean !== null);
  for (const s of entries) {
    for (const t of measured) {
      if (t.id === s.id) continue;
      if ((t.mean > ceiling && dominates(s.setting, t.setting)) || (t.mean < floor && dominates(t.setting, s.setting))) { pruned.add(s.id); break; }
    }
  }
  return pruned;
}

/**
 * Paired comparison on common dates: is `costs` clearly worse than `best`?
 * Both are arrays over the same dates. True when the mean difference exceeds
 * z standard errors (and minDates have been seen).
 */
export function clearlyWorse(costs, best, { z = 2.5, minDates = 4 } = {}) {
  const n = Math.min(costs.length, best.length);
  if (n < minDates) return false;
  const d = Array.from({ length: n }, (_, i) => costs[i] - best[i]);
  const mean = d.reduce((sum, x) => sum + x, 0) / n;
  const sd = Math.sqrt(d.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  // A floor on the error keeps identical columns from looking infinitely sure.
  return mean - z * Math.max(sd / Math.sqrt(n), 0.05) > 0;
}
