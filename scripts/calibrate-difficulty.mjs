// SPDX-License-Identifier: GPL-3.0-only
// Offline authoring: measure how hard each piece's editions are under a grid of
// generation knobs, then write src/calibration.js, mapping every (tier, piece)
// to the knobs whose certified editions land closest to that tier's score band.
// Re-run after any change to rules, monster AI, room modifiers, search, or the
// difficulty score; then rebuild the fallback bank (scripts/build-fallbacks.mjs).
//
//   node scripts/calibrate-difficulty.mjs [--samples 8] [--start 2026-11-07]
//     [--jobs N] [--pieces pawn,rook] [--grid full|quick]
//     [--data scripts/calibration-data.json] [--reuse] [--dry-run]
//     [--fast] [--confirm shortlist.json] [--replay data.json] [--choices-out file]
//     (--fast tuning, see docs/generation.md: --stage1-dates --stage2-dates
//      --keep1 --keep2 --screen-budget --surrogate-keep --dominance-margin
//      --stop-z --final-step --no-surrogate --no-dominance --no-stopping)
//
// Two ways to refit (docs/generation.md, "Calibration"):
// - Brute force (no --fast/--confirm): every grid setting on every date. Slow
//   (over an hour) and the reference method.
// - Shortlist, then confirm: `npm run calibrate:shortlist` (--fast) screens the
//   grid in minutes and writes only scripts/calibration-shortlist.json, never
//   src/calibration.js. `npm run calibrate:confirm` (--confirm that file) then
//   measures the shortlisted settings, the current table's settings and the
//   plain layout on every date at the full budget, exactly as brute force
//   would, and writes the table. Keeping the current settings in the running
//   means a confirm can never pick worse than the live table on its own data.
//
// Phase 1 (slow) searches both candidate layouts of `samples` dates per piece
// under every grid setting, in parallel workers, at the runtime search budget.
// Monsters grow smarter with the tier (src/monster-ai.js), so every setting is
// measured once per tier, with that tier's monsters, and competes only for
// that tier: five times the searches of one shared measurement.
// It writes every search to --data: status ('solved', 'unknown' when the
// budget ran out, 'invalid' when replay rejected the route), solver expansions,
// route moves (final turns), wall time and the metrics the score needs, plus
// min/median/p90/max summaries per piece and setting. --reuse loads that file
// instead of searching again, so the fit can be repeated after editing the
// score or the bands.
// Phase 2 (fast) replays generateDaily's own candidate choice
// (chooseCandidate, including the tier's minimum floor moves) for every tier,
// its settings and threat minimum, and keeps the cheapest: off-band distance,
// fallbacks and slow searches all cost.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const load = (path) => import(new URL(path, root).href);

if (!isMainThread) {
  const { getRawDaily } = await load('src/edition.js');
  const { candidateFor, searchCandidate } = await load('src/generation.js');
  // floorMoves lets the fit apply the no-freebie-floor rule (chooseCandidate).
  const SCORE_METRICS = ['turns', 'threatenedDecisions', 'narrowEscapes', 'livesLost', 'unsafeAlternatives', 'legalAlternatives', 'floorMoves'];
  parentPort.on('message', ({ id, date, setting, budget }) => {
    const base = getRawDaily(date);
    const found = [0, 1].map((attempt) => {
      const began = performance.now();
      // Monsters grow smarter with the tier (src/monster-ai.js), so each
      // setting is measured under the tier it is a candidate for.
      const result = searchCandidate(candidateFor(base, setting.tier, setting, attempt), budget);
      const metrics = result.metrics ? Object.fromEntries(SCORE_METRICS.map((name) => [name, result.metrics[name]])) : null;
      return { status: result.status, explored: result.explored, ms: Math.round(performance.now() - began), metrics };
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
  const { PLAYABLE_PIECES } = await load('src/pieces.js');
  const pieces = option('pieces', PLAYABLE_PIECES.join(',')).split(',');
  if (!Number.isInteger(samples) || samples < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(jobs) || jobs < 1
    || !['full', 'quick'].includes(gridName) || pieces.some((piece) => !PLAYABLE_PIECES.includes(piece))) {
    throw new Error('Usage: node scripts/calibrate-difficulty.mjs [--samples N] [--start YYYY-MM-DD] [--jobs N] [--pieces a,b] [--grid full|quick] [--records file] [--reuse] [--dry-run]');
  }
  const { getRawDaily } = await load('src/edition.js');
  const { DIFFICULTY_TIERS, TIER_IDS, DEFAULT_KNOBS, difficultyScore, bandDistance } = await load('src/difficulty.js');
  const { chooseCandidate, ATTEMPTS, SEARCH_BUDGET } = await load('src/generation.js');
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
    const decoyCounts = gridName === 'quick' ? [1, 2, 4] : [0, 1, 2, 3, 4];
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

  // Run search tasks on the worker pool, storing results in `into`.
  let searchCount = 0, expansionCount = 0;
  const runBegan = Date.now();
  // --replay file: take searches from an earlier full-budget run instead of
  // searching, to compare search strategies cheaply. Wall time is then the
  // summed search time divided by the workers (replayMs / jobs).
  let replay = null, replayMs = 0;
  if (option('replay')) {
    replay = {};
    for (const row of JSON.parse(await readFile(option('replay'), 'utf8')).rows) {
      (((replay[row.piece] ??= {})[row.setting] ??= {})[row.date] ??= [])[row.attempt] = { status: row.status, explored: row.explored, ms: row.ms, metrics: row.metrics };
    }
  }
  const elapsedSeconds = () => (replay ? replayMs / 1000 / jobs : (Date.now() - runBegan) / 1000);
  const measure = async (tasks, budget, into) => {
    tasks = tasks.map((task, id) => ({ ...task, id }));
    if (replay) {
      // Serve searches from a full-budget data file (search is deterministic,
      // so a smaller budget is the same search cut short).
      for (const task of tasks) {
        const found = replay[task.piece][settingKey(task.setting)][task.date].map((entry) => (entry.explored <= budget
          ? entry : { status: 'unknown', explored: budget, ms: Math.round(entry.ms * budget / entry.explored), metrics: null }));
        ((into[task.piece] ??= {})[settingKey(task.setting)] ??= {})[task.date] = found;
        searchCount += found.length; expansionCount += found.reduce((sum, entry) => sum + entry.explored, 0);
        replayMs += found.reduce((sum, entry) => sum + entry.ms, 0);
      }
      return;
    }
    console.log(`Measuring ${tasks.length} dates × ${ATTEMPTS} candidates on ${jobs} workers at ${budget} expansions…`);
    const began = Date.now();
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => {
        if (next >= tasks.length) { worker.terminate(); resolve(); return; }
        const task = tasks[next++];
        worker.postMessage({ id: task.id, date: task.date, setting: task.setting, budget });
      };
      worker.on('message', ({ id, found }) => {
        const task = tasks[id];
        ((into[task.piece] ??= {})[settingKey(task.setting)] ??= {})[task.date] = found;
        searchCount += found.length; expansionCount += found.reduce((sum, entry) => sum + entry.explored, 0);
        if (++done % 100 === 0 || done === tasks.length) {
          const elapsed = (Date.now() - began) / 1000;
          console.log(`  ${done}/${tasks.length} (${Math.round(elapsed)} s, about ${Math.round(elapsed / done * (tasks.length - done))} s left)`);
        }
        feed();
      });
      worker.on('error', reject);
      feed();
    })));
  };

  // --fast: screen every setting cheaply, then spend full searches only on the
  // settings that could win a tier (successive halving). Stage 1 runs each
  // setting on --stage1-dates dates (default 1) and stage 2 on --stage2-dates
  // more (default 4), both at a screening budget; the closest settings per tier
  // advance. Two filters shape stage 1: a least-squares surrogate (knobs plus
  // pairwise products, per piece) smooths one-date noise, and its top picks per
  // tier advance alongside the observed ranks; monotone dominance drops settings
  // at least as hard as one already far above the hardest band, or at most as
  // hard as one far below the easiest. Finalists are re-measured at the full
  // runtime budget on common dates, a few at a time; a setting stops gaining
  // dates once a paired comparison shows it clearly worse than the current best
  // for every tier. Only full-budget data reaches the fit. A setting with no
  // solved screening search advances: running out of budget often means hard.
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
    const margin = Number(option('dominance-margin', '1.5'));
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
      const [low, high] = DIFFICULTY_TIERS[tier].band, width = high - low;
      const candidates = found.map((entry) => (entry.metrics ? { metrics: entry.metrics, score: difficultyScore(entry.metrics, piece) } : null));
      const index = chooseCandidate(candidates, tier, minThreatenedDecisions);
      if (index < 0) return 11;
      const score = candidates[index].score, off = bandDistance(score, tier);
      return off / width + (off > 0 ? 1 : 0) + 0.2 * Math.abs(score - (low + high) / 2) / width;
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
        // Mean screened score so far (a candidate scores if either layout solved).
        const ranked = alive.filter((id) => id.startsWith(`${piece}|`)).map((id) => {
          const scores = Object.values(screened[piece]?.[id.split('|')[1]] ?? {}).map((found) => found.find((entry) => entry.metrics)).filter(Boolean).map((entry) => difficultyScore(entry.metrics, piece));
          return { id, setting: settingsOf.get(id), mean: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null };
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
          if (useDominance) for (const id of dominatedOut(mine(ranked), band[0] - margin, band[1] + margin)) out.add(id);
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

  // Phase 1: measurements[piece][settingKey][date] = [{ ms, metrics|null }, ...]
  let measurements = {};
  let rows = [];
  const loadRows = async (filter) => {
    for (const row of JSON.parse(await readFile(dataPath, 'utf8')).rows.filter(filter)) {
      const byDate = ((measurements[row.piece] ??= {})[row.setting] ??= {});
      (byDate[row.date] ??= [])[row.attempt] = { status: row.status, explored: row.explored, ms: row.ms, metrics: row.metrics };
    }
  };
  if (args.includes('--reuse')) {
    await loadRows((row) => pieces.includes(row.piece));
    ({ start, samples } = JSON.parse(await readFile(dataPath, 'utf8')));
  } else {
    // --merge keeps the data file's searches and measures only what it lacks.
    if (args.includes('--merge')) await loadRows(() => true);
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
    const tasks = [];
    for (const piece of pieces) {
      const dates = datesFor(piece);
      for (const setting of settingsFor(piece)) for (const date of dates) {
        if (!measurements[piece]?.[settingKey(setting)]?.[date]) tasks.push({ id: tasks.length, piece, date, setting });
      }
    }
    if (fast) measurements = await fastMeasure(tasks);
    else await measure(tasks, SEARCH_BUDGET, measurements);
  }
  if (searchCount) console.log(`Searched ${searchCount} candidate layouts, ${expansionCount} expansions in all, ${Math.round(elapsedSeconds())} s wall time${replay ? " (replayed)" : ""} on ${jobs} workers.`);
  for (const [piece, bySetting] of Object.entries(measurements)) for (const [setting, byDate] of Object.entries(bySetting)) {
    for (const [date, found] of Object.entries(byDate)) for (const [attempt, entry] of found.entries()) {
      rows.push({ piece, setting, date, attempt, status: entry.status, explored: entry.explored, turns: entry.metrics?.turns ?? null, ms: entry.ms, metrics: entry.metrics });
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
    // One row per search, compact: the raw numbers behind the table and the budgets.
    const source = `{"generated":${JSON.stringify(new Date().toISOString())},"start":${JSON.stringify(start)},"samples":${samples},"grid":${JSON.stringify(gridName)},`
      + `"searchBudget":${SEARCH_BUDGET},"settingKey":"obstacleBase/decoys/scatter/guards[/screens]@tier","summary":${JSON.stringify(summary)},\n"rows":[\n`
      + rows.map((row) => JSON.stringify(row)).join(',\n') + '\n]}\n';
    await writeFile(dataPath, source);
    console.log(`Wrote ${rows.length} searches to ${fileURLToPath(dataPath)}.`);
  }

  // Phase 2: replay generateDaily's choice for every tier, setting and minimum.
  // The table's knobs: the setting without the tier it was measured for.
  const parse = (key) => { const { tier, ...knobs } = parseKey(key); return knobs; };
  const scored = (found, piece) => found.map((entry) => (entry.metrics ? { metrics: entry.metrics, score: difficultyScore(entry.metrics, piece) } : null));
  const stats = (values) => {
    if (!values.length) return { n: 0, mean: null, sd: null, min: null, max: null };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    const round = (value) => Math.round(value * 10) / 10;
    return { n: values.length, mean: round(mean), sd: round(sd), min: round(Math.min(...values)), max: round(Math.max(...values)) };
  };
  // What generateDaily would do with these measurements for one tier.
  const simulate = (byDate, tier, minThreatenedDecisions, piece) => {
    const chosen = [], ms = [];
    let fallbacks = 0, inBand = 0, distance = 0;
    for (const found of Object.values(byDate)) {
      const candidates = scored(found, piece);
      const first = chooseCandidate(candidates.slice(0, 1), tier, minThreatenedDecisions);
      const searched = first === 0 && bandDistance(candidates[0].score, tier) === 0 ? 1 : ATTEMPTS;
      ms.push(found.slice(0, searched).reduce((sum, entry) => sum + entry.ms, 0));
      const index = chooseCandidate(candidates, tier, minThreatenedDecisions);
      if (index < 0) { fallbacks++; continue; }
      const score = candidates[index].score;
      chosen.push(score);
      const off = bandDistance(score, tier);
      if (off === 0) inBand++;
      distance += off;
    }
    const days = Object.keys(byDate).length;
    return { scores: chosen, fallbackRate: fallbacks / days, inBandRate: inBand / days, distance: chosen.length ? distance / chosen.length : Infinity, ms: stats(ms) };
  };
  // Lower is better: mean distance outside the band (in band widths), missed
  // days, fallbacks (a repeated layout), slow generation (a phone is slower
  // than this machine, weighted by --time-weight) and distance from the band's center.
  // Time is judged against the same piece's plain layout, measured in the same
  // run, so a busy machine does not skew the choice: over 1.5 times as slow costs.
  const cost = (result, tier, plainMs) => {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    const width = high - low;
    const mean = result.scores.length ? result.scores.reduce((sum, value) => sum + value, 0) / result.scores.length : low;
    // The last term centers otherwise equal settings, so pieces bunch together.
    return result.distance / width + (1 - result.inBandRate) + 10 * result.fallbackRate
      + timeWeight * Math.max(0, result.ms.mean / plainMs - 1.5) + 0.2 * Math.abs(mean - (low + high) / 2) / width;
  };
  const minimums = [0, 1, 2, 3, 4, 6];
  const calibration = {}, report = { generated: new Date().toISOString().slice(0, 10), start, samples, grid: gridName, uncalibrated: {}, tiers: {} };
  for (const piece of pieces) {
    const bySetting = measurements[piece];
    if (!bySetting) throw new Error(`No measurements for ${piece}.`);
    const plainOf = (tier) => bySetting[settingKey({ ...DEFAULT_KNOBS, tier })];
    // Before: the old single profile (the plain layout, the first certified candidate), Gentle monsters.
    const plain = plainOf('gentle');
    const before = [];
    for (const found of Object.values(plain ?? {})) {
      const index = scored(found, piece).findIndex((entry) => entry && entry.metrics.threatenedDecisions >= DEFAULT_KNOBS.minThreatenedDecisions);
      if (index >= 0) before.push(scored(found, piece)[index].score);
    }
    report.uncalibrated[piece] = { knobs: { ...DEFAULT_KNOBS }, ...stats(before) };
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
        ...stats(best.result.scores), inBand: Math.round(best.result.inBandRate * 100) / 100,
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

  // Print before/after spreads.
  console.log('\nBefore (one profile for every day):');
  for (const piece of pieces) {
    const entry = report.uncalibrated[piece];
    console.log(`  ${piece.padEnd(7)} mean ${entry.mean}  sd ${entry.sd}  range ${entry.min}-${entry.max}`);
  }
  const spread = (values) => (values.length ? `${Math.min(...values)}-${Math.max(...values)} (spread ${Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10})` : 'n/a');
  console.log(`  piece means ${spread(pieces.map((piece) => report.uncalibrated[piece].mean).filter((value) => value !== null))}`);
  console.log('\nAfter (calibrated, per tier):');
  for (const tier of TIER_IDS) {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    console.log(`  ${tier} [${low}, ${high}]: piece means ${spread(pieces.map((piece) => report.tiers[tier][piece].mean).filter((value) => value !== null))}`);
    for (const piece of pieces) {
      const knobs = calibration[tier][piece], entry = report.tiers[tier][piece];
      console.log(`    ${piece.padEnd(7)} ${JSON.stringify(knobs)} mean ${entry.mean} sd ${entry.sd} in band ${Math.round(entry.inBand * 100)}% fallback ${Math.round(entry.fallback * 100)}% ~${entry.meanMs} ms (max ${entry.maxMs})`);
      console.log(`            moves ${fmt(entry.searches.turns)}, expansions ${fmt(entry.searches.explored)}, ${entry.searches.unknown}/${entry.searches.searches} unknown`);
    }
  }
  const misses = TIER_IDS.flatMap((tier) => pieces.filter((piece) => {
    const mean = report.tiers[tier][piece].mean;
    return mean === null || bandDistance(mean, tier) > 0;
  }).map((piece) => `${tier}/${piece}`));
  if (misses.length) console.warn(`\nWarning: mean score outside the band for ${misses.join(', ')}. Consider a wider grid, new knobs, or new bands.`);

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
      + '// after changing rules, monster AI, modifiers, search or the score, then\n'
      + '// rebuild the fallback bank (node scripts/build-fallbacks.mjs).\n'
      + '// CALIBRATION[tier][piece] holds the generation knobs (src/difficulty.js knobsFor).\n'
      + '// CALIBRATION_REPORT records the measured scores behind them; it is not used at runtime.\n'
      + `export const CALIBRATION = ${JSON.stringify(merged, null, 2)};\n`
      + `export const CALIBRATION_REPORT = ${JSON.stringify(mergedReport, null, 2)};\n`;
    await writeFile(new URL('src/calibration.js', root), source);
    console.log('\nWrote src/calibration.js. Next: node scripts/build-fallbacks.mjs && npm run verify:fallbacks');
  }
}
