// SPDX-License-Identifier: GPL-3.0-only
// Offline authoring: measure how hard each piece's editions are under a grid of
// generation knobs, then write src/calibration.js, mapping every (tier, piece)
// to the knobs whose assembled editions land closest to that tier's band of
// the capped human gap (src/difficulty.js cappedGap: the human-like bot's
// extra moves over the certified route). Re-run after any change to rules,
// monster AI, room modifiers, search, the human-like bot or the measure; then
// rebuild the fallback bank (scripts/build-fallbacks.mjs).
//
//   node scripts/calibrate-difficulty.mjs [--samples 8] [--start 2026-11-07]
//     [--jobs N] [--pieces pawn,rook] [--grid full|quick]
//     [--data scripts/calibration-data.json] [--full] [--sample 0.01]
//     [--sample-seed text] [--reuse] [--merge] [--dry-run]
//     [--fast] [--confirm shortlist.json] [--replay data.json] [--choices-out file]
//     (--fast tuning, see docs/generation.md: --stage1-dates --stage2-dates
//      --keep1 --keep2 --screen-budget --surrogate-keep --dominance-margin
//      --stop-z --final-step --no-surrogate --no-dominance --no-stopping)
//
// Two ways to refit (docs/generation.md, "Calibration"):
// - Brute force (no --fast/--confirm): every grid setting on every date, the
//   reference method. It is incremental: it reuses the last run's data file
//   and measures again only what a change touches (below); --full measures
//   everything (over an hour).
// - Shortlist, then confirm: `npm run calibrate:shortlist` (--fast) screens the
//   grid in minutes and writes only scripts/calibration-shortlist.json, never
//   src/calibration.js. `npm run calibrate:confirm` (--confirm that file) then
//   measures the shortlisted settings, the current table's settings and the
//   plain layout on every date at the full budget, exactly as brute force
//   would, and writes the table. Keeping the current settings in the running
//   means a confirm can never pick worse than the live table on its own data.
//
// Phase 1 (slow) searches every candidate layout generation may try (ATTEMPTS,
// sixteen) of `samples` dates per piece
// under every grid setting, in parallel workers, at the runtime search budget,
// and plays the human-like bot (src/human-bot.js humanPar) on every solved
// candidate's route, exactly as generation does before it assembles the day.
// Monsters grow smarter with the tier (src/monster-ai.js), so every setting is
// measured once per tier, with that tier's monsters, and competes only for
// that tier: five times the searches of one shared measurement.
// It writes every search to --data: status ('solved', 'unknown' when the
// budget ran out, 'invalid' when replay rejected the route), solver expansions,
// route moves (final turns), wall time (search and bot), the metrics the
// score and the freebie rule need, the bot's runs per floor (`human`: each
// run's moves, null where it failed), the route and every floor's search
// (`searches`: lives kept, expansions, a digest of its start and its route
// segment), plus min/median/p90/max summaries per piece and setting, and a
// fingerprint per class (piece, room modifier, floor, tier).
// The next brute-force run reuses that file (docs/generation.md, "Incremental
// calibration"): it fingerprints every class again, with these rules, from a
// few probe positions (random walks through the rules, the floor's own
// search, the bot's runs), searches again only the floors whose search
// fingerprint changed, or whose bot fingerprint did while the bot's code
// didn't (and what follows them), stands in for the rest with the stored
// searches when they start from the same position, plays the bot again only
// on floors whose bot or rules changed, and checks what it reused: every
// reused route must verify to its stored metrics (else its whole group is
// measured from scratch), one kept bot run per floor is played again (else
// that class's floor is searched and played again), and a random sample
// (--sample, 1%) is measured from scratch (else its whole group is too).
// It prints what it reused and measured again, by class. --reuse loads that
// file instead of searching again, so the fit can be repeated after editing
// the measure or the bands; it refuses a file some class of which plays
// differently now. A file of another data version
// (scripts/calibration-search.mjs DATA_VERSION) is never reused.
// Phase 2 (fast) replays generateDaily's own choice (rankFloors: the day
// assembled from the candidates' floors whose capped human gaps add up to the
// tier's mean target, with the tier's minimum floor moves) for every tier, its
// settings and threat minimum, and keeps the cheapest: off-band distance,
// fallbacks and slow searches all cost. The difficulty score is reported
// beside the gap but chooses nothing.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const load = (path) => import(new URL(path, root).href);

if (!isMainThread) {
  const { getRawDaily } = await load('src/edition.js');
  const { candidateFor, ATTEMPTS, SEARCH_BUDGET } = await load('src/generation.js');
  const { measureCandidate, remeasureCandidate, classFingerprint } = await import('./calibration-search.mjs');
  parentPort.on('message', (task) => {
    if (task.kind === 'fingerprint') {
      // One class's fingerprints, from its probes' stored searches.
      const probes = task.probes.map(({ date, setting, attempt, searches }) => ({ candidate: candidateFor(getRawDaily(date), setting.tier, setting, attempt), searches }));
      parentPort.postMessage({ id: task.id, ...classFingerprint(probes, task.floor) });
      return;
    }
    const { id, date, setting, budget, stored, stale, sample, keys, spotCheck } = task;
    const base = getRawDaily(date);
    // Every candidate generation may search before the fallback bank (ATTEMPTS).
    const found = Array.from({ length: ATTEMPTS }, (_, attempt) => {
      // Monsters grow smarter with the tier (src/monster-ai.js), so each
      // setting is measured under the tier it is a candidate for.
      const candidate = candidateFor(base, setting.tier, setting, attempt);
      const previous = stored?.[attempt];
      // Nothing stored (or a screening budget): measured as generation measures
      // it (searchCandidate, which also plays the human-like bot on a solved route).
      if (!previous?.searches || budget !== SEARCH_BUDGET) return { row: measureCandidate(candidate, budget), notes: null };
      const again = remeasureCandidate(candidate, previous, stale, { key: keys[attempt], spotCheck });
      // The random sample is measured from scratch as well, to check the reuse.
      if (sample?.[attempt]) again.check = measureCandidate(candidate);
      return again;
    });
    parentPort.postMessage({ id, found });
  });
} else {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  let samples = Number(option('samples', '10'));
  let start = option('start', '2026-11-07');
  const jobs = Number(option('jobs', String(Math.max(1, availableParallelism() - 1))));
  const gridName = option('grid', 'full');
  // Editions are certified at build time (scripts/build-editions.mjs), so a slow
  // search only costs a device that opens a date past the two-year window, once.
  // Generation time therefore no longer counts against a setting by default.
  const timeWeight = Number(option('time-weight', '0'));
  const obstacleOption = option('obstacles')?.split(',').map(Number);
  const fast = args.includes('--fast'), confirmPath = option('confirm');
  if (fast && confirmPath) throw new Error('--fast makes a shortlist and --confirm checks one: run them one after the other.');
  // A shortlist run keeps its searches apart from the data behind the live table.
  const dataPath = new URL(option('data', fast ? 'scripts/calibration-shortlist.json' : 'scripts/calibration-data.json'), new URL(`file://${process.cwd()}/`));
  const shortlist = confirmPath ? JSON.parse(await readFile(new URL(confirmPath, new URL(`file://${process.cwd()}/`)), 'utf8')) : null;
  if (shortlist && !option('start')) start = shortlist.start;
  if (shortlist && !option('samples')) samples = shortlist.samples;
  // The share of reused rows measured from scratch as well, to check the reuse.
  const sampleShare = Number(option('sample', '0.01'));
  const { PLAYABLE_PIECES } = await load('src/pieces.js');
  const pieces = option('pieces', PLAYABLE_PIECES.join(',')).split(',');
  if (!Number.isInteger(samples) || samples < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(jobs) || jobs < 1
    || !['full', 'quick'].includes(gridName) || pieces.some((piece) => !PLAYABLE_PIECES.includes(piece)) || !(sampleShare >= 0 && sampleShare <= 1)) {
    throw new Error('Usage: node scripts/calibrate-difficulty.mjs [--samples N] [--start YYYY-MM-DD] [--jobs N] [--pieces a,b] [--grid full|quick] [--data file] [--full] [--sample share] [--reuse] [--dry-run]');
  }
  const { getRawDaily } = await load('src/edition.js');
  const { DIFFICULTY_TIERS, TIER_IDS, DEFAULT_KNOBS, MIN_DECOYS, difficultyScore, bandDistance, freebieFloor, floorGapPoints } = await load('src/difficulty.js');
  const { rankFloors, ATTEMPTS, SEARCH_BUDGET } = await load('src/generation.js');
  const { RULES_VERSION } = await load('src/rules.js');
  const { HUMAN_BOT_VERSION } = await load('src/human-bot.js');
  const { dataStamp, dataProblem, storedGap, rowKey, classKey, pickProbes } = await import('./calibration-search.mjs');
  // What a data file must match before any of its rows is reused: the data
  // version, the candidate count and the search budget. The rules and bot
  // versions are recorded too, but whether a row still holds is up to the
  // class fingerprints and the stored starts.
  const stamp = dataStamp({ rules: RULES_VERSION, bot: HUMAN_BOT_VERSION, attempts: ATTEMPTS, searchBudget: SEARCH_BUDGET });
  // A hash of the bot's own code (src/human-bot.js, its recruit policy), kept
  // with each class's fingerprints. When it is unchanged, a class whose bot
  // runs changed must play different rules, so its floor is searched again too.
  const botSource = createHash('sha1').update((await Promise.all(['src/human-bot.js', 'src/recruit-policy.js'].map((path) => readFile(new URL(path, root), 'utf8')))).join('\n'))
    .digest('hex').slice(0, 12);
  // A search's measures as generation sees them: its metrics, the capped human
  // gap from the bot's stored runs (the tiers' measure) and the score beside it.
  const scored = (found, piece) => found.map((entry) => (entry.metrics
    ? { metrics: entry.metrics, score: difficultyScore(entry.metrics, piece), gap: storedGap(entry) } : null));
  // The same searches as generation's floor assembly sees them (rankFloors):
  // each floor's capped-gap points from the bot's stored runs. Rows keep no
  // per-floor move or life counts, so each floor counts its scored moves
  // toward the route's cap and no lives (generation's own certification still
  // holds a pawn day to its allowance), and a candidate below the threat
  // minimum gives no floors (generation checks the minimum on the whole day).
  const assembly = (found, minThreatenedDecisions) => found.map((entry) => {
    if (!entry?.metrics || !Array.isArray(entry.human) || entry.metrics.threatenedDecisions < minThreatenedDecisions) return null;
    const { floorMoves } = entry.metrics;
    const results = entry.human.map((runs) => runs.map((moves) => ({ won: moves !== null, moves: moves ?? 0 })));
    return { metrics: entry.metrics, points: floorGapPoints({ results, certified: floorMoves }), runs: entry.human[0].length, floors: floorMoves.map((moves) => ({ turns: moves, lives: 0 })) };
  });
  const quantiles = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    return { min: sorted[0], median: at(0.5), p90: at(0.9), max: sorted.at(-1) };
  };
  // Searches, budget misses, route moves and expansions for a list of rows.
  const searchSummary = (rows) => {
    const solved = rows.filter((row) => row.status === 'solved');
    return {
      searches: rows.length, solved: solved.length,
      unknown: rows.filter((row) => row.status === 'unknown').length,
      invalid: rows.filter((row) => row.status === 'invalid').length,
      turns: quantiles(solved.map((row) => row.turns)),
      explored: quantiles(solved.map((row) => row.explored)),
      exploredAll: quantiles(rows.map((row) => row.explored)),
      ms: quantiles(rows.map((row) => row.ms)),
    };
  };

  // Layout knobs to measure. scatter changes nothing for a pawn, so pawns skip it.
  const grid = (piece) => {
    const settings = [];
    const obstacles = obstacleOption ?? (gridName === 'quick' ? [7] : [4, 7, 10, 13]);
    // Never fewer than MIN_DECOYS: a floor of targets alone is open and shut.
    const decoyCounts = (gridName === 'quick' ? [1, 2, 4] : [1, 2, 3, 4]).filter((count) => count >= MIN_DECOYS);
    for (const obstacleBase of obstacles) for (const decoys of decoyCounts) for (const scatter of piece === 'pawn' ? [0] : [0, 1]) {
      for (let guards = 0; guards <= Math.min(decoys, 4); guards++) settings.push({ obstacleBase, decoys, scatter, guards });
    }
    // Screens (walls cutting long lines into targets) only matter to long-range
    // pieces; a narrower grid keeps the run affordable.
    if (['rook', 'bishop', 'queen'].includes(piece) && gridName !== 'quick') {
      for (const screens of [1, 3]) for (const obstacleBase of [10, 13]) for (const decoys of [1, 2, 3]) for (const scatter of [0, 1]) {
        for (let guards = 0; guards <= Math.min(decoys, 2); guards++) settings.push({ obstacleBase, decoys, scatter, guards, screens });
      }
    }
    const plain = { obstacleBase: DEFAULT_KNOBS.obstacleBase, decoys: DEFAULT_KNOBS.decoys, scatter: DEFAULT_KNOBS.scatter, guards: DEFAULT_KNOBS.guards };
    if (!settings.some((entry) => settingKey(entry) === settingKey(plain))) settings.push(plain);
    return settings;
  };
  // Settings without screens keep their original four-part key. Each setting
  // is measured for one tier, whose monsters it meets: `@tier` ends the key.
  // Data from before tiered monsters has no tier and matches nothing.
  const settingKey = ({ obstacleBase, decoys, scatter, guards, screens = 0, tier }) => `${obstacleBase}/${decoys}/${scatter}/${guards}${screens ? `/${screens}` : ''}${tier ? `@${tier}` : ''}`;
  const parseKey = (key) => {
    const [knobs, tier] = key.split('@');
    const [obstacleBase, decoys, scatter, guards, screens = 0] = knobs.split('/').map(Number);
    return { obstacleBase, decoys, scatter, guards, ...(screens && { screens }), ...(tier && { tier }) };
  };
  const tierOf = (key) => key.split('@')[1];
  const isPlain = (key) => key.split('@')[0] === settingKey(DEFAULT_KNOBS);
  // Every knob setting once per tier.
  const perTier = (settings) => TIER_IDS.flatMap((tier) => settings.map((setting) => ({ ...setting, tier })));
  const datesFor = (piece) => {
    const dates = [];
    for (let time = Date.parse(start); dates.length < samples; time += 86_400_000) {
      const raw = getRawDaily(new Date(time));
      if (raw.playerPiece === piece) dates.push(raw.date);
    }
    return dates;
  };

  // A date's room modifier, which with the piece, floor and tier names a class.
  const modifiers = new Map();
  const modifierOf = (date) => {
    if (!modifiers.has(date)) modifiers.set(date, getRawDaily(date).modifier ?? 'none');
    return modifiers.get(date);
  };
  // Rows of one piece, modifier and tier: a group, whose floors are its classes.
  const groupOf = (piece, date, tier) => `${piece}/${modifierOf(date)}/${tier}`;
  const classesOf = (piece, date, tier) => [0, 1, 2].map((floor) => classKey(piece, modifierOf(date), floor, tier));

  // Run tasks on the worker pool: onResult(result, message) as each returns.
  const runPool = async (messages, onResult, onProgress) => {
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, messages.length) }, () => new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => {
        if (next >= messages.length) { worker.terminate(); resolve(); return; }
        const id = next++;
        worker.postMessage({ ...messages[id], id });
      };
      worker.on('message', (result) => {
        onResult(result, messages[result.id]);
        onProgress?.(++done, messages.length);
        feed();
      });
      worker.on('error', reject);
      feed();
    })));
  };

  // Class fingerprints (scripts/calibration-search.mjs classFingerprint) with
  // these rules, for [{ key, probes: [data rows] }]: { key: { search, bot } }.
  const fingerprints = async (list) => {
    const out = {};
    if (!list.length) return out;
    const began = Date.now();
    await runPool(list.map(({ key, probes }) => ({
      kind: 'fingerprint', floor: Number(key.split('/')[2]) - 1,
      probes: probes.map(({ date, setting, attempt, searches }) => ({ date, setting: parseKey(setting), attempt, searches })),
    })), (result) => { out[list[result.id].key] = { search: result.search, bot: result.bot }; });
    console.log(`Fingerprinted ${list.length} classes in ${Math.round((Date.now() - began) / 1000)} s.`);
    return out;
  };

  // For a data file's classes of this run's pieces: did the search (rules,
  // monsters, modifier, search) or the bot play differently from its probes
  // with these rules? { key: { search, bot, sameBot, probes: [rows], now } },
  // `sameBot` when the bot's code is the one that measured the class; a class
  // whose probes are missing counts as changed both ways. A class the file
  // has no entry for (a row's class that isn't listed) is missing from the result.
  const changedClasses = async (file, scope) => {
    const byKey = new Map(file.rows.map((row) => [rowKey(row), row]));
    const entries = Object.entries(file.classes ?? {}).filter(([key]) => scope.includes(key.split('/')[0]));
    const ready = entries.filter(([, entry]) => entry.probes.every((probe) => byKey.has(probe)))
      .map(([key, entry]) => ({ key, probes: entry.probes.map((probe) => byKey.get(probe)) }));
    const now = await fingerprints(ready);
    const changed = {};
    for (const [key, entry] of entries) {
      const current = now[key];
      const sameBot = entry.botSource === botSource;
      changed[key] = current
        ? { search: current.search !== entry.search, bot: current.bot !== entry.bot, sameBot, probes: ready.find((item) => item.key === key).probes, now: current }
        : { search: true, bot: true, sameBot, probes: null, now: null };
    }
    return changed;
  };

  // Refuse a data file whose rows can't all be used as they are: another data
  // version, candidate count or budget, or a class of this run's pieces that
  // plays differently now (or that the file has no fingerprints for).
  const refuseStale = async (file, path, remedy) => {
    const problem = dataProblem(file, stamp);
    if (problem) throw new Error(`${path} can't be reused: ${problem}. ${remedy}`);
    const changed = await changedClasses(file, pieces);
    const stale = new Set(Object.entries(changed).filter(([, state]) => state.search || state.bot).map(([key]) => key));
    for (const row of file.rows) {
      if (!pieces.includes(row.piece)) continue;
      for (const key of classesOf(row.piece, row.date, tierOf(row.setting))) if (!changed[key]) stale.add(key);
    }
    if (stale.size) {
      const list = [...stale].sort();
      throw new Error(`${path} can't be reused: the rules, search or human-like bot play differently now in ${list.length} classes`
        + ` (piece/modifier/floor/tier: ${list.slice(0, 4).join(', ')}${list.length > 4 ? ', …' : ''}). ${remedy}`);
    }
  };

  // Run tasks on the worker pool, storing results in `into`.
  let searchCount = 0, expansionCount = 0;
  const runBegan = Date.now();
  // --replay file: take searches from an earlier full-budget run instead of
  // searching, to compare search strategies cheaply. Wall time is then the
  // summed search time divided by the workers (replayMs / jobs).
  let replay = null, replayMs = 0;
  if (option('replay')) {
    replay = {};
    const file = JSON.parse(await readFile(option('replay'), 'utf8'));
    await refuseStale(file, option('replay'), 'Replay only a data file measured under these rules.');
    for (const row of file.rows) {
      (((replay[row.piece] ??= {})[row.setting] ??= {})[row.date] ??= [])[row.attempt] = {
        status: row.status, explored: row.explored, ms: row.ms, metrics: row.metrics, human: row.human, route: row.route, searches: row.searches,
      };
    }
  }
  const elapsedSeconds = () => (replay ? replayMs / 1000 / jobs : (Date.now() - runBegan) / 1000);
  // Measure tasks ({ piece, date, setting }, and when reusing a stored row
  // per candidate: `stored`, `stale`, `keys`, `sample`, `spotCheck`; see the
  // worker) into into[piece][settingKey][date]; onFound(task, found) sees
  // each result with its notes.
  const measure = async (tasks, budget, into, onFound) => {
    tasks = tasks.map((task, id) => ({ ...task, id }));
    if (replay) {
      // Serve searches from a full-budget data file (search is deterministic,
      // so a smaller budget is the same search cut short).
      for (const task of tasks) {
        const found = replay[task.piece][settingKey(task.setting)][task.date].map((entry) => (entry.explored <= budget
          ? entry : { status: 'unknown', explored: budget, ms: Math.round(entry.ms * budget / entry.explored), metrics: null, human: null, route: null, searches: null }));
        ((into[task.piece] ??= {})[settingKey(task.setting)] ??= {})[task.date] = found;
        searchCount += found.length; expansionCount += found.reduce((sum, entry) => sum + entry.explored, 0);
        replayMs += found.reduce((sum, entry) => sum + entry.ms, 0);
      }
      return;
    }
    if (!tasks.length) return;
    console.log(`Measuring ${tasks.length} dates × ${ATTEMPTS} candidates on ${jobs} workers at ${budget} expansions…`);
    const began = Date.now();
    await runPool(tasks.map(({ date, setting, stored, stale, keys, sample, spotCheck }) => ({ date, setting, budget, stored, stale, keys, sample, spotCheck })), (result) => {
      const task = tasks[result.id];
      ((into[task.piece] ??= {})[settingKey(task.setting)] ??= {})[task.date] = result.found.map(({ row }) => row);
      for (const { row, notes } of result.found) {
        // Count only what was searched: a row reused whole searched nothing.
        if (!notes || notes.searched.some(Boolean)) searchCount++;
        expansionCount += notes ? notes.expansions : row.explored;
      }
      onFound?.(task, result.found);
    }, (done, total) => {
      if (done % 100 === 0 || done === total) {
        const elapsed = (Date.now() - began) / 1000;
        console.log(`  ${done}/${total} (${Math.round(elapsed)} s, about ${Math.round(elapsed / done * (total - done))} s left)`);
      }
    });
  };

  // Brute force from the last run's data (docs/generation.md, "Incremental
  // calibration"): fingerprint its classes with these rules, then measure
  // every task again reusing what still holds (scripts/calibration-search.mjs
  // remeasureCandidate), check the reuse, and measure from scratch every
  // group a check fails in. Returns the classes' fingerprints now, with the
  // probes they came from, so unchanged ones need not be computed again.
  const measureIncrementally = async (tasks, previous) => {
    const stored = new Map(previous.rows.map((row) => [rowKey(row), row]));
    const changed = await changedClasses(previous, pieces);
    // Per floor: search again when its class's search fingerprint changed (or
    // isn't known), or its bot fingerprint did while the bot's code didn't
    // (the rules it plays changed); play the bot again when either changed,
    // and on floors a failed spot check sends back (`spotted`).
    const rulesChanged = (state) => !state || state.search || (state.bot && state.sameBot);
    const staleFor = (piece, date, tier, spotted = new Set()) => {
      const keys = classesOf(piece, date, tier), states = keys.map((key) => changed[key]);
      return {
        search: states.map((state, floor) => rulesChanged(state) || spotted.has(keys[floor])),
        bot: states.map((state, floor) => rulesChanged(state) || state.bot || spotted.has(keys[floor])),
      };
    };
    const keysOf = (task) => Array.from({ length: ATTEMPTS }, (_, attempt) => rowKey({ piece: task.piece, setting: settingKey(task.setting), date: task.date, attempt }));
    const first = tasks.map((task) => {
      const keys = keysOf(task), stale = staleFor(task.piece, task.date, task.setting.tier);
      const rows = keys.map((key) => stored.get(key) ?? null);
      return { ...task, keys, stale, stored: rows, sample: rows.map(() => false) };
    });
    // The sample: about `sampleShare` of the rows that reuse anything, at least
    // one per group, in an order seeded by --sample-seed (random by default).
    const seed = option('sample-seed', randomUUID().slice(0, 8));
    const order = (key) => createHash('sha1').update(`${seed}:${key}`).digest('hex');
    const pools = new Map();
    for (const task of first) {
      if (task.stale.search.every(Boolean)) continue;
      const group = groupOf(task.piece, task.date, task.setting.tier);
      task.stored.forEach((row, attempt) => { if (row?.searches) (pools.get(group) ?? pools.set(group, []).get(group)).push({ task, attempt, order: order(task.keys[attempt]) }); });
    }
    if (sampleShare > 0) {
      for (const pool of pools.values()) {
        pool.sort((a, b) => (a.order < b.order ? -1 : 1));
        for (const { task, attempt } of pool.slice(0, Math.max(1, Math.round(sampleShare * pool.length)))) task.sample[attempt] = true;
      }
    }
    // Every row's latest result and notes, by key (null notes: measured from scratch).
    const outcomes = new Map();
    const record = (task, found) => found.forEach(({ row, notes, check }, attempt) => {
      outcomes.set(task.keys[attempt], { task, attempt, row, notes, check, group: groupOf(task.piece, task.date, task.setting.tier), classes: classesOf(task.piece, task.date, task.setting.tier) });
    });
    console.log(`Reusing ${fileURLToPath(dataPath)} (${previous.rows.length} rows) where it still holds; sample seed ${seed}.`);
    await measure(first, SEARCH_BUDGET, measurements, record);

    // The checks. A reused route that no longer verifies to its stored
    // metrics, or a sampled row whose reuse differs from measuring it from
    // scratch, sends its whole group to be measured from scratch; a kept bot
    // run that comes out differently sends its class's floor to be searched
    // and played again (the bot or the rules changed there unseen).
    const same = (a, b) => ['status', 'explored', 'metrics', 'human', 'route', 'searches'].every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
    const escalated = new Map(), spotted = new Set();
    const checks = { verified: 0, guard: 0, spot: 0, spotDiffered: 0, sampled: 0, sampleDiffered: 0 };
    for (const { row, notes, check, group, classes } of outcomes.values()) {
      if (!notes) continue;
      if (notes.searched.every((count) => count === 0) && row.route !== null) checks.verified++;
      if (notes.guard) { checks.guard++; escalated.set(group, 'a reused route no longer verifies to its stored metrics'); }
      checks.spot += notes.bot.filter((state) => state === 'kept').length;
      for (const floor of notes.spot) { checks.spotDiffered++; spotted.add(classes[floor]); }
      if (check) {
        checks.sampled++;
        if (!same(row, check)) { checks.sampleDiffered++; escalated.set(group, 'a sampled row measured from scratch came out differently'); }
      }
    }
    const second = [];
    for (const task of first) {
      const group = groupOf(task.piece, task.date, task.setting.tier);
      if (escalated.has(group)) { second.push({ piece: task.piece, date: task.date, setting: task.setting, keys: task.keys }); continue; }
      if (!classesOf(task.piece, task.date, task.setting.tier).some((key) => spotted.has(key))) continue;
      // Those floors searched and played again from the stored rows.
      second.push({ ...task, stale: staleFor(task.piece, task.date, task.setting.tier, spotted), sample: null, spotCheck: false });
    }
    if (escalated.size) for (const [group, reason] of escalated) console.log(`  ${group}: ${reason}; measuring the group from scratch.`);
    if (spotted.size) console.log(`  A kept bot run came out differently in ${[...spotted].sort().join(', ')}; searching and playing those floors again.`);
    if (second.length) await measure(second, SEARCH_BUDGET, measurements, (task, found) => {
      found.forEach(({ row, notes }, attempt) => {
        outcomes.set(task.keys[attempt], { ...outcomes.get(task.keys[attempt]), row, notes, check: null });
      });
    });

    // What was reused and measured again, by class.
    const report = new Map();
    const entry = (key) => report.get(key) ?? report.set(key, { rows: 0, fresh: 0, served: 0, searched: 0, kept: 0, played: 0 }).get(key);
    for (const { row, notes, classes } of outcomes.values()) {
      for (const [floor, key] of classes.entries()) {
        const item = entry(key);
        item.rows++;
        if (notes) {
          item.served += notes.served[floor]; item.searched += notes.searched[floor];
          if (notes.bot[floor] === 'kept') item.kept++;
          if (notes.bot[floor] === 'played') item.played++;
        } else {
          item.fresh++;
          item.searched += row.searches.filter(([searched]) => searched === floor).length;
          if (row.status === 'solved' && row.human) item.played++;
        }
      }
    }
    const number = (value) => value.toLocaleString('en-US');
    const why = (key, item) => {
      const state = changed[key], [piece, modifier, , tier] = key.split('/');
      const reasons = [];
      if (!state) reasons.push('new class');
      else if (state.search) reasons.push('rules/search changed');
      else if (state.bot && state.sameBot) reasons.push('bot runs changed: rules');
      else if (state.bot) reasons.push('bot changed');
      if (escalated.has(`${piece}/${modifier}/${tier}`)) reasons.push('check failed');
      if (spotted.has(key)) reasons.push('bot spot check failed');
      if (!reasons.length && item.fresh) reasons.push('new rows');
      // Its fingerprints held, but another floor of some rows changed (their
      // start here, or their result: a pawn day searches floors again).
      return reasons.join(', ') || 'another floor changed';
    };
    const busy = [...report.entries()].filter(([, item]) => item.searched || item.played).sort(([a], [b]) => (a < b ? -1 : 1));
    const idle = [...report.values()].filter((item) => !item.searched && !item.played);
    console.log('\nReuse by class (piece/modifier/floor/tier): floor searches served/searched again, bot floors kept/played again.');
    for (const [key, item] of busy) {
      console.log(`  ${key.padEnd(24)} ${why(key, item).padEnd(28)} searches ${number(item.served)}/${number(item.searched)}  bot ${number(item.kept)}/${number(item.played)}  (${number(item.rows)} rows)`);
    }
    console.log(`  ${idle.length} classes reused whole: ${number(idle.reduce((sum, item) => sum + item.served, 0))} floor searches served, ${number(idle.reduce((sum, item) => sum + item.kept, 0))} bot floors kept.`);
    console.log(`Checks: ${number(checks.verified)} reused routes verified (${checks.guard} differed); ${number(checks.spot)} kept bot floors spot-checked (${checks.spotDiffered} differed);`
      + ` ${number(checks.sampled)} sampled rows measured from scratch (${checks.sampleDiffered} differed).`);
    return changed;
  };

  // --fast: screen every setting cheaply, then spend full searches only on the
  // settings that could win a tier (successive halving). Stage 1 runs each
  // setting on --stage1-dates dates (default 1) and stage 2 on --stage2-dates
  // more (default 4), both at a screening budget; the closest settings per tier
  // advance. Two filters shape stage 1: a least-squares surrogate of the
  // capped human gap (knobs plus pairwise products, per piece) smooths
  // one-date noise, and its top picks per tier advance alongside the observed
  // ranks; monotone dominance drops settings at least as hard as one already
  // far above the tier's band, or at most as hard as one far below it
  // (--dominance-margin, two band widths by default; never for pawns, whose
  // gap isn't monotone in the knobs). Finalists are re-measured at the full
  // runtime budget on common dates, a few at a time; a setting stops gaining
  // dates once a paired comparison shows it clearly worse than the current
  // best for every tier. Only full-budget data reaches the fit. A setting
  // with no solved screening search advances: running out of budget often
  // means hard.
  const fastMeasure = async (tasks) => {
    const { fitSurrogate, dominatedOut, clearlyWorse } = await import('./calibration-search.mjs');
    // Default: screen at the full budget. At 3000 expansions most queen and
    // bishop screens ran out of budget and told nothing, and full-budget screens
    // are reused as final data, so nothing is searched twice.
    const screenBudget = Number(option('screen-budget', String(SEARCH_BUDGET)));
    const keep = [Number(option('keep1', '6')), Number(option('keep2', '3'))];
    const stageSizes = [Number(option('stage1-dates', '1')), Number(option('stage2-dates', '4'))];
    const useSurrogate = !args.includes('--no-surrogate');
    const surrogateKeep = Number(option('surrogate-keep', '3'));
    const useDominance = !args.includes('--no-dominance');
    // Two band widths by default (6): one date's gap scatters by about 5, more
    // than a band is wide, and a setting is only ever dropped on another's mean.
    const bandWidth = (DIFFICULTY_TIERS[TIER_IDS.at(-1)].band[1] - DIFFICULTY_TIERS[TIER_IDS[0]].band[0]) / TIER_IDS.length;
    const margin = Number(option('dominance-margin', String(2 * bandWidth)));
    const useStopping = !args.includes('--no-stopping');
    const finalFirst = Number(option('final-first', '4')), finalStep = Number(option('final-step', '2'));
    const stopZ = Number(option('stop-z', '2.5'));
    const settingsOf = new Map();
    for (const task of tasks) settingsOf.set(`${task.piece}|${settingKey(task.setting)}`, task.setting);
    const datesOf = (piece) => [...new Set(tasks.filter((task) => task.piece === piece).map((task) => task.date))];
    // A setting only competes for the tier whose monsters it was measured with.
    const bands = TIER_IDS.map((tier) => DIFFICULTY_TIERS[tier].band);
    const byCenter = (value, [low, high]) => Math.abs(value - (low + high) / 2);
    let finals;
    const minimums = [0, 1, 2, 3, 4, 6];
    // Per-date cost: the fit's cost terms for one day (a fallback costs 11).
    const dayCost = (found, piece, tier, minThreatenedDecisions) => {
      const [low, high] = DIFFICULTY_TIERS[tier].band, width = high - low, { target } = DIFFICULTY_TIERS[tier];
      const best = rankFloors(assembly(found, minThreatenedDecisions), target, tier)[0];
      if (!best) return 11;
      const off = bandDistance(best.gap, tier);
      return off / width + (off > 0 ? 1 : 0) + 0.2 * Math.abs(best.gap - target) / width;
    };
    const costsFor = (piece, id, tier, dates, source = finals) => {
      const byDate = source[piece][id.split('|')[1]];
      let best = null;
      for (const minimum of minimums) {
        const costs = dates.map((date) => dayCost(byDate[date], piece, tier, minimum));
        const mean = costs.reduce((sum, value) => sum + value, 0) / costs.length;
        if (!best || mean < best.mean) best = { mean, costs };
      }
      return best;
    };
    const screened = {};
    const fullScreens = screenBudget === SEARCH_BUDGET;
    let alive = [...settingsOf.keys()];
    let offset = 0;
    for (const [stage, size] of stageSizes.entries()) {
      const [from, to] = [offset, offset + size];
      offset = to;
      if (size > 0) {
        await measure(alive.flatMap((id) => {
          const [piece] = id.split('|');
          return datesOf(piece).slice(from, to).map((date) => ({ piece, date, setting: settingsOf.get(id) }));
        }), screenBudget, screened);
      }
      const survivors = new Set();
      for (const piece of new Set(alive.map((id) => id.split('|')[0]))) {
        // Mean screened gap so far: each date's first candidate generation
        // could keep (solved, and no freebie floor on the setting's tier), if
        // any. A quick-clear candidate it would reject has a tiny gap; counted,
        // it made harder settings look far below the band, and dominance
        // dropped them.
        const ranked = alive.filter((id) => id.startsWith(`${piece}|`)).map((id) => {
          const tier = tierOf(id);
          const gaps = Object.values(screened[piece]?.[id.split('|')[1]] ?? {}).map((found) => found.find((entry) => entry.metrics && !freebieFloor(entry.metrics, tier))).filter(Boolean)
            .map(storedGap).filter((gap) => gap !== null);
          return { id, setting: settingsOf.get(id), mean: gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : null };
        });
        const measured = ranked.filter((entry) => entry.mean !== null);
        // Below the full budget an unsolved screen may just mean hard, so it advances.
        const pick = new Set(fullScreens ? [] : ranked.filter((entry) => entry.mean === null).map((entry) => entry.id));
        const out = new Set();
        for (const [index, band] of bands.entries()) {
          const tier = TIER_IDS[index];
          const mine = (entries) => entries.filter((entry) => tierOf(entry.id) === tier);
          // Full-budget screens rank by the fit's own cost on the dates so far;
          // cheaper screens can only rank by distance from the band's center.
          const value = fullScreens
            ? (entry) => costsFor(piece, entry.id, tier, Object.keys(screened[piece][entry.id.split('|')[1]]), screened).mean
            : (entry) => byCenter(entry.mean, band);
          const values = new Map(mine(fullScreens ? ranked : measured).map((entry) => [entry.id, value(entry)]));
          [...values.keys()].sort((a, b) => values.get(a) - values.get(b)).slice(0, keep[stage]).forEach((id) => pick.add(id));
          // The surrogate needs enough settings to fit 16 weights.
          if (useSurrogate && stage === 0 && mine(measured).length >= 24) {
            const model = fitSurrogate(mine(measured).map((entry) => ({ setting: entry.setting, y: entry.mean })));
            mine(ranked).sort((a, b) => byCenter(model.predict(a.setting), band) - byCenter(model.predict(b.setting), band)).slice(0, surrogateKeep).forEach((entry) => pick.add(entry.id));
            console.log(`  ${piece} ${tier}: surrogate residual sd ${model.residualSd.toFixed(2)} on ${mine(measured).length} settings`);
          }
          // Not for pawns: the bot's pawn gap can fall as knobs rise (on
          // Fiendish, decoys are what it captures its way past its relic with).
          if (useDominance && piece !== 'pawn') for (const id of dominatedOut(mine(ranked), band[0] - margin, band[1] + margin)) out.add(id);
        }
        for (const id of pick) if (!out.has(id)) survivors.add(id);
        if (out.size) console.log(`  ${piece}: monotone dominance rules out ${out.size} settings`);
      }
      // The plain layout always advances: the report compares against it.
      for (const id of alive) if (isPlain(id.split('|')[1])) survivors.add(id);
      console.log(`Stage ${stage + 1}: ${survivors.size} of ${alive.length} settings advance.`);
      alive = [...survivors];
    }

    // Finals at the full budget on common dates (common random numbers).
    // At the full budget the screening searches are final data: keep them.
    finals = fullScreens ? screened : {};
    const pieceOf = (id) => id.split('|')[0];
    const done = new Map(alive.map((id) => [id, Object.keys(finals[pieceOf(id)]?.[id.split('|')[1]] ?? {}).length]));
    if (finals === screened) {
      // Only finalists' searches reach the fit; drop the screened-out settings.
      for (const piece of Object.keys(finals)) for (const key of Object.keys(finals[piece])) if (!done.has(`${piece}|${key}`)) delete finals[piece][key];
    }
    let active = [...alive];
    while (active.length) {
      await measure(active.flatMap((id) => {
        const from = done.get(id), to = !useStopping ? Infinity : from === 0 ? finalFirst : from + finalStep;
        return datesOf(pieceOf(id)).slice(from, to).map((date) => ({ piece: pieceOf(id), date, setting: settingsOf.get(id) }));
      }), SEARCH_BUDGET, finals);
      for (const id of active) done.set(id, Object.keys(finals[pieceOf(id)][id.split('|')[1]]).length);
      active = active.filter((id) => done.get(id) < datesOf(pieceOf(id)).length);
      if (!useStopping) continue;
      const stopped = new Set();
      for (const piece of new Set(active.map(pieceOf))) for (const tier of TIER_IDS) {
        const dates = datesOf(piece);
        const mine = alive.filter((id) => pieceOf(id) === piece && tierOf(id) === tier);
        if (!mine.length) continue;
        // Leaders: settings measured on the most dates so far; the best among them.
        const front = Math.max(...mine.map((id) => done.get(id)));
        const best = mine.filter((id) => done.get(id) === front)
          .map((id) => ({ id, mean: costsFor(piece, id, tier, dates.slice(0, front)).mean })).sort((a, b) => a.mean - b.mean)[0].id;
        for (const id of active.filter((entry) => mine.includes(entry) && entry !== best && !isPlain(entry.split('|')[1]))) {
          const shared = dates.slice(0, done.get(id));
          if (clearlyWorse(costsFor(piece, id, tier, shared).costs, costsFor(piece, best, tier, shared).costs, { z: stopZ })) stopped.add(id);
        }
      }
      if (stopped.size) console.log(`  Sequential stopping: ${stopped.size} settings stop adding dates.`);
      active = active.filter((id) => !stopped.has(id));
    }
    const settingDates = [...done.values()].reduce((sum, value) => sum + value, 0);
    console.log(`Finals: ${alive.length} settings, ${settingDates} setting-dates at ${SEARCH_BUDGET} expansions.`);
    return finals;
  };

  // The last run's data file, when this run can reuse it: brute force and
  // confirm only, never with --full.
  const previousData = async () => {
    if (args.includes('--full')) return null;
    let file;
    try { file = JSON.parse(await readFile(dataPath, 'utf8')); } catch { return null; }
    const problem = dataProblem(file, stamp);
    if (problem) { console.log(`Not reusing ${fileURLToPath(dataPath)}: ${problem}. Measuring everything.`); return null; }
    return file;
  };

  // Each class's fingerprints for the rows it writes, from probes picked
  // among them; `before` (changedClasses) holds those computed at the start
  // of the run, kept where the probes and their searches are unchanged.
  const classFingerprints = async (rows, before = {}) => {
    const groups = new Map();
    for (const row of rows) {
      const group = groupOf(row.piece, row.date, tierOf(row.setting));
      (groups.get(group) ?? groups.set(group, []).get(group)).push(row);
    }
    const classes = {}, todo = [];
    for (const [group, members] of groups) {
      const [piece, modifier, tier] = group.split('/');
      for (let floor = 0; floor < 3; floor++) {
        const key = classKey(piece, modifier, floor, tier), probes = pickProbes(members, floor), known = before[key];
        const kept = known?.now && known.probes.length === probes.length && known.probes.every((row, index) => rowKey(row) === rowKey(probes[index])
          && JSON.stringify(row.searches) === JSON.stringify(probes[index].searches));
        if (kept) classes[key] = { probes: probes.map(rowKey), ...known.now, botSource };
        else todo.push({ key, probes });
      }
    }
    const computed = await fingerprints(todo);
    for (const { key, probes } of todo) classes[key] = { probes: probes.map(rowKey), ...computed[key], botSource };
    return Object.fromEntries(Object.entries(classes).sort(([a], [b]) => (a < b ? -1 : 1)));
  };

  // Phase 1: measurements[piece][settingKey][date] = [{ ms, metrics|null }, ...]
  let measurements = {};
  let rows = [];
  let previous = null, startClasses = {};
  const put = (row) => {
    const byDate = ((measurements[row.piece] ??= {})[row.setting] ??= {});
    (byDate[row.date] ??= [])[row.attempt] = { status: row.status, explored: row.explored, ms: row.ms, metrics: row.metrics, human: row.human, route: row.route ?? null, searches: row.searches ?? null };
  };
  if (args.includes('--reuse')) {
    const file = JSON.parse(await readFile(dataPath, 'utf8'));
    await refuseStale(file, fileURLToPath(dataPath), 'Measure again without --reuse.');
    for (const row of file.rows) if (pieces.includes(row.piece)) put(row);
    ({ start, samples } = file);
  } else {
    if (shortlist) await refuseStale(shortlist, confirmPath, 'Make a new one with npm run calibrate:shortlist.');
    // A shortlist and a replay always measure from scratch.
    previous = fast || replay ? null : await previousData();
    // --confirm measures only the shortlist's finalists, the live table's
    // settings and the plain layout, each on every date at the full budget.
    const { CALIBRATION: live } = await load('src/calibration.js');
    const settingsFor = (piece) => {
      if (!shortlist) return perTier(grid(piece));
      const keys = new Set(perTier([DEFAULT_KNOBS]).map(settingKey));
      for (const row of shortlist.rows) if (row.piece === piece && tierOf(row.setting)) keys.add(row.setting);
      for (const tier of TIER_IDS) if (live[tier]?.[piece]) keys.add(settingKey({ ...live[tier][piece], tier }));
      console.log(`${piece}: confirming ${keys.size} settings.`);
      return [...keys].map(parseKey);
    };
    const tasks = [], listed = new Set();
    const add = (piece, date, setting) => {
      const id = `${piece}|${settingKey(setting)}|${date}`;
      if (!listed.has(id)) { listed.add(id); tasks.push({ piece, date, setting }); }
    };
    for (const piece of pieces) {
      const dates = datesFor(piece);
      for (const setting of settingsFor(piece)) for (const date of dates) add(piece, date, setting);
    }
    // --merge also keeps the data file's other settings and dates for these
    // pieces, measured again where they no longer hold.
    if (args.includes('--merge')) {
      if (!previous) console.log('Nothing to merge: no data file this run can reuse.');
      for (const row of previous?.rows ?? []) if (pieces.includes(row.piece)) add(row.piece, row.date, parseKey(row.setting));
    }
    if (fast) measurements = await fastMeasure(tasks);
    else if (previous) startClasses = await measureIncrementally(tasks, previous);
    else await measure(tasks, SEARCH_BUDGET, measurements);
    // Rows of pieces this run doesn't measure stay as they were, with their classes.
    for (const row of previous?.rows ?? []) if (!pieces.includes(row.piece)) put(row);
  }
  if (searchCount) console.log(`Searched ${searchCount} candidate layouts, ${expansionCount} expansions in all, ${Math.round(elapsedSeconds())} s wall time${replay ? " (replayed)" : ""} on ${jobs} workers.`);
  for (const [piece, bySetting] of Object.entries(measurements)) for (const [setting, byDate] of Object.entries(bySetting)) {
    for (const [date, found] of Object.entries(byDate)) for (const [attempt, entry] of found.entries()) {
      rows.push({
        piece, setting, date, attempt, status: entry.status, explored: entry.explored, turns: entry.metrics?.turns ?? null, ms: entry.ms,
        metrics: entry.metrics, human: entry.human ?? null, route: entry.route ?? null, searches: entry.searches ?? null,
      });
    }
  }
  if (!args.includes('--reuse')) {
    const summary = { byPiece: {}, bySetting: {} };
    for (const piece of Object.keys(measurements)) {
      summary.byPiece[piece] = searchSummary(rows.filter((row) => row.piece === piece));
      summary.bySetting[piece] = {};
      for (const setting of Object.keys(measurements[piece])) {
        summary.bySetting[piece][setting] = searchSummary(rows.filter((row) => row.piece === piece && row.setting === setting));
      }
    }
    // Fingerprints for the classes measured here; other pieces' classes stay as they were.
    const classes = await classFingerprints(rows.filter((row) => pieces.includes(row.piece)), startClasses);
    for (const [key, entry] of Object.entries(previous?.classes ?? {})) if (!pieces.includes(key.split('/')[0])) classes[key] = entry;
    // One row per search, compact: the raw numbers behind the table and the budgets.
    // The stamp (data version, candidates, budget) and the class fingerprints
    // let a later run reuse what still holds and refuse the rest.
    const header = JSON.stringify({ ...stamp, measure: 'cappedGap' }).slice(1, -1);
    const source = `{"generated":${JSON.stringify(new Date().toISOString())},${header},"start":${JSON.stringify(start)},"samples":${samples},"grid":${JSON.stringify(gridName)},`
      + `"settingKey":"obstacleBase/decoys/scatter/guards[/screens]@tier","humanRuns":"row.human: per floor, each bot run's moves when it won, else null",`
      + `"searches":"row.searches: each floor search in order, [floor 0-2, lives kept (minHp), expansions, start digest, route segment or null]; row.route: the route",`
      + `"classKey":"piece/modifier/floor/tier: probe rows, fingerprints of its search (rules, monsters, modifier, search) and bot, and the bot's code hash",`
      + `"summary":${JSON.stringify(summary)},\n"classes":{\n`
      + Object.entries(classes).map(([key, entry]) => `${JSON.stringify(key)}:${JSON.stringify(entry)}`).join(',\n') + '\n},\n"rows":[\n'
      + rows.map((row) => JSON.stringify(row)).join(',\n') + '\n]}\n';
    await writeFile(dataPath, source);
    console.log(`Wrote ${rows.length} searches to ${fileURLToPath(dataPath)}.`);
  }

  // Phase 2: replay generateDaily's choice for every tier, setting and minimum.
  // The table's knobs: the setting without the tier it was measured for.
  const parse = (key) => { const { tier, ...knobs } = parseKey(key); return knobs; };
  const stats = (values) => {
    if (!values.length) return { n: 0, mean: null, sd: null, min: null, max: null };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    const round = (value) => Math.round(value * 10) / 10;
    return { n: values.length, mean: round(mean), sd: round(sd), min: round(Math.min(...values)), max: round(Math.max(...values)) };
  };
  const average = (values) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null);
  // What generateDaily would do with these measurements for one tier: the
  // assembled days' capped human gaps (and their scores, for reference),
  // aimed at the tier's mean target (Tough's lies between Thursday's and
  // Friday's), with the tier's no-freebie rule.
  const simulate = (byDate, tier, minThreatenedDecisions, piece) => {
    const gaps = [], scores = [], ms = [];
    let fallbacks = 0, inBand = 0, distance = 0;
    const { target } = DIFFICULTY_TIERS[tier];
    for (const found of Object.values(byDate)) {
      const entries = assembly(found, minThreatenedDecisions), candidates = scored(found, piece);
      // generateDaily (searchCandidates) stops at the first candidate that lets an assembly land on the target.
      let searched = Math.min(ATTEMPTS, entries.length);
      for (let count = 1; count < searched; count++) {
        if (entries[count - 1] && rankFloors(entries.slice(0, count), target, tier)[0]?.within) { searched = count; break; }
      }
      ms.push(found.slice(0, searched).reduce((sum, entry) => sum + entry.ms, 0));
      const best = rankFloors(entries, target, tier)[0];
      if (!best) { fallbacks++; continue; }
      const { gap } = best;
      gaps.push(gap); scores.push(best.floors.reduce((sum, attempt) => sum + candidates[attempt].score, 0) / 3);
      const off = bandDistance(gap, tier);
      if (off === 0) inBand++;
      distance += off;
    }
    const days = Object.keys(byDate).length;
    return { gaps, scores, fallbackRate: fallbacks / days, inBandRate: inBand / days, distance: gaps.length ? distance / gaps.length : Infinity, ms: stats(ms) };
  };
  // Lower is better: mean distance outside the band (in band widths), missed
  // days, fallbacks (a repeated layout), slow generation (a phone is slower
  // than this machine, weighted by --time-weight) and distance from the band's center.
  // Time is judged against the same piece's plain layout, measured in the same
  // run, so a busy machine does not skew the choice: over 1.5 times as slow costs.
  const cost = (result, tier, plainMs) => {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    const width = high - low;
    const mean = result.gaps.length ? result.gaps.reduce((sum, value) => sum + value, 0) / result.gaps.length : low;
    // The last term centers otherwise equal settings, so pieces bunch together.
    return result.distance / width + (1 - result.inBandRate) + 10 * result.fallbackRate
      + timeWeight * Math.max(0, result.ms.mean / plainMs - 1.5) + 0.2 * Math.abs(mean - (low + high) / 2) / width;
  };
  const minimums = [0, 1, 2, 3, 4, 6];
  const calibration = {}, report = { generated: new Date().toISOString().slice(0, 10), start, samples, grid: gridName, measure: 'cappedGap', uncalibrated: {}, tiers: {} };
  for (const piece of pieces) {
    const bySetting = measurements[piece];
    if (!bySetting) throw new Error(`No measurements for ${piece}.`);
    const plainOf = (tier) => bySetting[settingKey({ ...DEFAULT_KNOBS, tier })];
    // Before: the old single profile (the plain layout, the first certified candidate), Gentle monsters.
    const plain = plainOf('gentle');
    const before = [], beforeScores = [];
    for (const found of Object.values(plain ?? {})) {
      const candidates = scored(found, piece);
      const entry = candidates.find((candidate) => candidate && candidate.gap !== null && candidate.metrics.threatenedDecisions >= DEFAULT_KNOBS.minThreatenedDecisions);
      if (entry) { before.push(entry.gap); beforeScores.push(entry.score); }
    }
    report.uncalibrated[piece] = { knobs: { ...DEFAULT_KNOBS }, ...stats(before), score: average(beforeScores) };
    for (const tier of TIER_IDS) {
      const plainRuns = Object.values(plainOf(tier) ?? {}).map((found) => found[0].ms);
      const plainMs = Math.max(1, plainRuns.reduce((sum, ms) => sum + ms, 0) / Math.max(1, plainRuns.length));
      let best = null;
      // Only settings measured with this tier's monsters compete for it.
      for (const [key, byDate] of Object.entries(bySetting).filter(([key]) => tierOf(key) === tier)) for (const minThreatenedDecisions of minimums) {
        const result = simulate(byDate, tier, minThreatenedDecisions, piece);
        const value = cost(result, tier, plainMs);
        if (!best || value < best.value - 1e-9) best = { value, key, minThreatenedDecisions, result };
      }
      if (!best) throw new Error(`No ${tier} measurements for ${piece}: data from before tiered monsters can't be reused.`);
      (calibration[tier] ??= {})[piece] = { ...parse(best.key), minThreatenedDecisions: best.minThreatenedDecisions };
      ((report.tiers[tier] ??= {})[piece] = {
        ...stats(best.result.gaps), score: average(best.result.scores), inBand: Math.round(best.result.inBandRate * 100) / 100,
        fallback: Math.round(best.result.fallbackRate * 100) / 100, meanMs: best.result.ms.mean, maxMs: best.result.ms.max,
        searches: (({ searches, unknown, invalid, turns, explored }) => ({ searches, unknown, invalid, turns, explored }))(
          searchSummary(rows.filter((row) => row.piece === piece && row.setting === best.key))),
      });
    }
  }

  // Route moves, solver expansions and budget misses, per piece over the whole grid.
  const fmt = (q) => (q ? `${q.min}/${q.median}/${q.p90}/${q.max}` : 'n/a');
  console.log(`\nSearches at the runtime budget (${SEARCH_BUDGET} expansions), min/median/p90/max:`);
  for (const piece of pieces) {
    const entry = searchSummary(rows.filter((row) => row.piece === piece));
    report.searches = { ...report.searches, [piece]: entry };
    console.log(`  ${piece.padEnd(7)} ${entry.searches} searches, ${entry.unknown} unknown, ${entry.invalid} invalid; moves ${fmt(entry.turns)}; expansions (solved) ${fmt(entry.explored)}`);
  }

  // Print before/after spreads of the capped human gap (the score beside it).
  console.log('\nBefore (one profile for every day), capped human gap:');
  for (const piece of pieces) {
    const entry = report.uncalibrated[piece];
    console.log(`  ${piece.padEnd(7)} mean ${entry.mean}  sd ${entry.sd}  range ${entry.min}-${entry.max}  (score ${entry.score})`);
  }
  const spread = (values) => (values.length ? `${Math.min(...values)}-${Math.max(...values)} (spread ${Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10})` : 'n/a');
  console.log(`  piece means ${spread(pieces.map((piece) => report.uncalibrated[piece].mean).filter((value) => value !== null))}`);
  console.log('\nAfter (calibrated, per tier), capped human gap:');
  for (const tier of TIER_IDS) {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    console.log(`  ${tier} [${low}, ${high}]: piece means ${spread(pieces.map((piece) => report.tiers[tier][piece].mean).filter((value) => value !== null))}`);
    for (const piece of pieces) {
      const knobs = calibration[tier][piece], entry = report.tiers[tier][piece];
      console.log(`    ${piece.padEnd(7)} ${JSON.stringify(knobs)} gap ${entry.mean} sd ${entry.sd} in band ${Math.round(entry.inBand * 100)}% fallback ${Math.round(entry.fallback * 100)}% (score ${entry.score}) ~${entry.meanMs} ms (max ${entry.maxMs})`);
      console.log(`            moves ${fmt(entry.searches.turns)}, expansions ${fmt(entry.searches.explored)}, ${entry.searches.unknown}/${entry.searches.searches} unknown`);
    }
  }
  const misses = TIER_IDS.flatMap((tier) => pieces.filter((piece) => {
    const mean = report.tiers[tier][piece].mean;
    return mean === null || bandDistance(mean, tier) > 0;
  }).map((piece) => `${tier}/${piece}`));
  if (misses.length) console.warn(`\nWarning: mean capped human gap outside the band for ${misses.join(', ')}. Consider a wider grid, new knobs, or new bands.`);

  // --choices-out: the chosen knobs and their measured report, for comparing methods.
  const choicesOut = option('choices-out');
  if (choicesOut) {
    await writeFile(new URL(choicesOut, new URL(`file://${process.cwd()}/`)), JSON.stringify({ calibration, report, searches: searchCount, expansions: expansionCount, seconds: elapsedSeconds() }, null, 2));
  }

  if (fast) {
    console.log(`\nShortlist only: src/calibration.js unchanged. Its finalists are in ${fileURLToPath(dataPath)}.`
      + `\nNext: node scripts/calibrate-difficulty.mjs --confirm ${fileURLToPath(dataPath)} (npm run calibrate:confirm).`);
  } else if (args.includes('--dry-run')) {
    console.log('\nDry run: src/calibration.js unchanged.');
  } else {
    // Keep rows for pieces this run did not measure.
    const { CALIBRATION: previous, CALIBRATION_REPORT: previousReport } = await load('src/calibration.js');
    const merged = structuredClone(previous);
    for (const tier of TIER_IDS) merged[tier] = { ...merged[tier], ...calibration[tier] };
    const mergedReport = { ...report, uncalibrated: { ...previousReport?.uncalibrated, ...report.uncalibrated }, tiers: {} };
    for (const tier of TIER_IDS) mergedReport.tiers[tier] = { ...previousReport?.tiers?.[tier], ...report.tiers[tier] };
    const source = '// SPDX-License-Identifier: GPL-3.0-only\n'
      + '// Generated by scripts/calibrate-difficulty.mjs. Do not edit by hand: re-run it\n'
      + '// after changing rules, monster AI, modifiers, search, the human-like bot or the\n'
      + '// measure, then rebuild the fallback bank (node scripts/build-fallbacks.mjs).\n'
      + '// CALIBRATION[tier][piece] holds the generation knobs (src/difficulty.js knobsFor).\n'
      + '// CALIBRATION_REPORT records the measured capped human gaps behind them (mean,\n'
      + '// sd, min, max; `score` is the mean difficulty score beside them); it is not used at runtime.\n'
      + `export const CALIBRATION = ${JSON.stringify(merged, null, 2)};\n`
      + `export const CALIBRATION_REPORT = ${JSON.stringify(mergedReport, null, 2)};\n`;
    await writeFile(new URL('src/calibration.js', root), source);
    console.log('\nWrote src/calibration.js. Next: node scripts/build-fallbacks.mjs && npm run verify:fallbacks');
  }
}
