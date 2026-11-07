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
//
// Phase 1 (slow) searches both candidate layouts of `samples` dates per piece
// under every grid setting, in parallel workers, at the runtime search budget.
// It writes every search to --data: status ('solved', 'unknown' when the
// budget ran out, 'invalid' when replay rejected the route), solver expansions,
// route moves (final turns), wall time and the metrics the score needs, plus
// min/median/p90/max summaries per piece and setting. --reuse loads that file
// instead of searching again, so the fit can be repeated after editing the
// score or the bands.
// Phase 2 (fast) replays generateDaily's own candidate choice
// (chooseCandidate) for every tier, setting and threat minimum, and keeps the
// cheapest: off-band distance, fallbacks and slow searches all cost.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const load = (path) => import(new URL(path, root).href);

if (!isMainThread) {
  const { getRawDaily } = await load('src/edition.js');
  const { candidateFor, searchCandidate } = await load('src/generation.js');
  const SCORE_METRICS = ['turns', 'threatenedDecisions', 'narrowEscapes', 'livesLost', 'unsafeAlternatives', 'legalAlternatives'];
  parentPort.on('message', ({ id, date, setting }) => {
    const base = getRawDaily(date);
    const found = [0, 1].map((attempt) => {
      const began = performance.now();
      const result = searchCandidate(candidateFor(base, 'calibration', setting, attempt));
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
  const jobs = Number(option('jobs', String(Math.max(1, Math.min(8, availableParallelism() - 1)))));
  const gridName = option('grid', 'full');
  // Editions are certified at build time (scripts/build-editions.mjs), so a slow
  // search only costs a device that opens a date past the two-year window, once.
  // Generation time therefore no longer counts against a setting by default.
  const timeWeight = Number(option('time-weight', '0'));
  const obstacleOption = option('obstacles')?.split(',').map(Number);
  const dataPath = new URL(option('data', 'scripts/calibration-data.json'), new URL(`file://${process.cwd()}/`));
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
  // Settings without screens keep their original four-part key, so older data still matches.
  const settingKey = ({ obstacleBase, decoys, scatter, guards, screens = 0 }) => `${obstacleBase}/${decoys}/${scatter}/${guards}${screens ? `/${screens}` : ''}`;
  const datesFor = (piece) => {
    const dates = [];
    for (let time = Date.parse(start); dates.length < samples; time += 86_400_000) {
      const raw = getRawDaily(new Date(time));
      if (raw.playerPiece === piece) dates.push(raw.date);
    }
    return dates;
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
    const tasks = [];
    for (const piece of pieces) {
      const dates = datesFor(piece);
      for (const setting of grid(piece)) for (const date of dates) {
        if (!measurements[piece]?.[settingKey(setting)]?.[date]) tasks.push({ id: tasks.length, piece, date, setting });
      }
    }
    console.log(`Measuring ${tasks.length} dates × ${ATTEMPTS} candidates on ${jobs} workers…`);
    const began = Date.now();
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: jobs }, () => new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => {
        if (next >= tasks.length) { worker.terminate(); resolve(); return; }
        const task = tasks[next++];
        worker.postMessage({ id: task.id, date: task.date, setting: task.setting });
      };
      worker.on('message', ({ id, found }) => {
        const task = tasks[id];
        ((measurements[task.piece] ??= {})[settingKey(task.setting)] ??= {})[task.date] = found;
        if (++done % 100 === 0 || done === tasks.length) {
          const elapsed = (Date.now() - began) / 1000;
          console.log(`  ${done}/${tasks.length} (${Math.round(elapsed)} s, about ${Math.round(elapsed / done * (tasks.length - done))} s left)`);
        }
        feed();
      });
      worker.on('error', reject);
      feed();
    })));
  }
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
      + `"searchBudget":${SEARCH_BUDGET},"settingKey":"obstacleBase/decoys/scatter/guards[/screens]","summary":${JSON.stringify(summary)},\n"rows":[\n`
      + rows.map((row) => JSON.stringify(row)).join(',\n') + '\n]}\n';
    await writeFile(dataPath, source);
    console.log(`Wrote ${rows.length} searches to ${fileURLToPath(dataPath)}.`);
  }

  // Phase 2: replay generateDaily's choice for every tier, setting and minimum.
  const parse = (key) => { const [obstacleBase, decoys, scatter, guards, screens = 0] = key.split('/').map(Number); return { obstacleBase, decoys, scatter, guards, ...(screens && { screens }) }; };
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
    const plainRuns = Object.values(bySetting[settingKey(DEFAULT_KNOBS)] ?? {}).map((found) => found[0].ms);
    const plainMs = Math.max(1, plainRuns.reduce((sum, ms) => sum + ms, 0) / Math.max(1, plainRuns.length));
    if (!bySetting) throw new Error(`No measurements for ${piece}.`);
    // Before: the old single profile (the plain layout, the first certified candidate).
    const plain = bySetting[settingKey(DEFAULT_KNOBS)];
    const before = [];
    for (const found of Object.values(plain ?? {})) {
      const index = scored(found, piece).findIndex((entry) => entry && entry.metrics.threatenedDecisions >= DEFAULT_KNOBS.minThreatenedDecisions);
      if (index >= 0) before.push(scored(found, piece)[index].score);
    }
    report.uncalibrated[piece] = { knobs: { ...DEFAULT_KNOBS }, ...stats(before) };
    for (const tier of TIER_IDS) {
      let best = null;
      for (const [key, byDate] of Object.entries(bySetting)) for (const minThreatenedDecisions of minimums) {
        const result = simulate(byDate, tier, minThreatenedDecisions, piece);
        const value = cost(result, tier, plainMs);
        if (!best || value < best.value - 1e-9) best = { value, key, minThreatenedDecisions, result };
      }
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

  if (args.includes('--dry-run')) {
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
