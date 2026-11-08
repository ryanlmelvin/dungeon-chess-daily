// SPDX-License-Identifier: GPL-3.0-only
// Offline authoring: fit each piece's residents dial, src/calibration.js.
//
// Every tier and piece shares one room recipe (src/difficulty.js RECIPE: ten
// walls, targets scattered off the piece's opening lines, no screens). What
// changes from Gentle to Fiendish is the tier's monsters (src/monster-ai.js)
// and the residents dial: decoys per floor (1-4, never 0) and guards (0 up to
// the decoys). This measures every residents setting under every tier's
// monsters for each piece, on `samples` dates of that piece from `start`,
// searching the candidate layouts generation would (up to ATTEMPTS, stopping
// at the first inside the tier's band) at the runtime budget and playing the
// human-like bot on each solved route, exactly as generateDaily does. Then, for each piece, it picks
// the ladder of residents, decoys and guards each never decreasing from
// Gentle to Fiendish, whose days land best in the tiers' bands of the capped
// human gap (src/difficulty.js cappedGap), replaying generateDaily's choice
// among the candidates (chooseCandidate). A tier's cost: the mean distance
// outside its band (in band widths), the share of days outside it, fallbacks
// at ten times a missed day (they repeat a layout), and a fifth of the mean's
// distance from the band's center. The ladder minimizes the tiers' summed
// cost. The default dates lie past the shipped window (src/editions.js), so
// every shipped edition is an out-of-sample check of the fit.
//
// Re-run after any change to rules, monster AI, room modifiers, search or the
// human-like bot, then rebuild the fallback bank (scripts/build-fallbacks.mjs)
// and the editions (scripts/build-editions.mjs). See docs/generation.md, "The
// recipe and its dial".
//
//   node scripts/calibrate-difficulty.mjs [--samples 12] [--start 2030-01-06]
//     [--jobs N] [--pieces pawn,rook] [--data scripts/calibration-data.json]
//     [--reuse] [--merge] [--dry-run]
//
// --data keeps every search (git-ignored): status ('solved', 'unknown' when the
// budget ran out, 'invalid' when replay rejected the route), expansions, wall
// time, the metrics the fit needs and the bot's runs per floor. --reuse refits
// from it without searching (after editing the bands or the measure), --merge
// searches only what it lacks, and data measured under other rules, another
// bot or another candidate count is refused (scripts/calibration-search.mjs).
// --dry-run leaves src/calibration.js alone.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const load = (path) => import(new URL(path, root).href);

if (!isMainThread) {
  const { getRawDaily } = await load('src/edition.js');
  const { candidateFor, searchCandidate, chooseCandidate, ATTEMPTS } = await load('src/generation.js');
  const { RECIPE, bandDistance } = await load('src/difficulty.js');
  const { compactRuns } = await import('./calibration-search.mjs');
  // floorMoves lets the fit apply the no-freebie-floor rule (chooseCandidate)
  // and is the route's side of the human gap.
  const SCORE_METRICS = ['turns', 'threatenedDecisions', 'narrowEscapes', 'livesLost', 'unsafeAlternatives', 'legalAlternatives', 'floorMoves'];
  parentPort.on('message', ({ id, date, setting, budget }) => {
    const base = getRawDaily(date);
    const results = [], found = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const began = performance.now();
      // Monsters grow smarter with the tier, so each setting is searched under
      // the tier it is a candidate for; searchCandidate also plays the bot.
      const result = searchCandidate(candidateFor(base, setting.tier, setting, attempt), budget);
      const metrics = result.metrics ? Object.fromEntries(SCORE_METRICS.map((name) => [name, result.metrics[name]])) : null;
      results.push(result);
      found.push({ status: result.status, explored: result.explored, ms: Math.round(performance.now() - began), metrics, human: compactRuns(result.human) });
      // generateDaily stops at the first candidate it keeps inside the band (searchCandidates).
      if (chooseCandidate(results, setting.tier, RECIPE.minThreatenedDecisions) === attempt && bandDistance(result.gap, setting.tier) === 0) break;
    }
    parentPort.postMessage({ id, found });
  });
} else {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  // Twelve dates per piece: fitting on 5, 10 or 15 dates left the same share of
  // held-out days in band, so more dates buy little.
  let samples = Number(option('samples', '12'));
  let start = option('start', '2030-01-06');
  const jobs = Number(option('jobs', String(Math.max(1, availableParallelism() - 1))));
  const dataPath = new URL(option('data', 'scripts/calibration-data.json'), new URL(`file://${process.cwd()}/`));
  const { PLAYABLE_PIECES } = await load('src/pieces.js');
  const pieces = option('pieces', PLAYABLE_PIECES.join(',')).split(',');
  if (!Number.isInteger(samples) || samples < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(jobs) || jobs < 1
    || pieces.some((piece) => !PLAYABLE_PIECES.includes(piece))) {
    throw new Error('Usage: node scripts/calibrate-difficulty.mjs [--samples N] [--start YYYY-MM-DD] [--jobs N] [--pieces a,b] [--data file] [--reuse] [--merge] [--dry-run]');
  }
  const { getRawDaily } = await load('src/edition.js');
  const { DIFFICULTY_TIERS, TIER_IDS, RECIPE, MIN_DECOYS, MAX_DECOYS, bandDistance } = await load('src/difficulty.js');
  const { chooseCandidate, ATTEMPTS, SEARCH_BUDGET } = await load('src/generation.js');
  const { RULES_VERSION } = await load('src/rules.js');
  const { HUMAN_BOT_VERSION } = await load('src/human-bot.js');
  const { dataStamp, dataProblem, storedGap, behaviourFingerprint } = await import('./calibration-search.mjs');
  const stamp = { rules: RULES_VERSION, bot: HUMAN_BOT_VERSION, attempts: ATTEMPTS, fingerprint: behaviourFingerprint() };

  // The residents dial: every (decoys, guards) setting, fewest residents first.
  const RESIDENTS = [];
  for (let decoys = MIN_DECOYS; decoys <= MAX_DECOYS; decoys++) for (let guards = 0; guards <= decoys; guards++) RESIDENTS.push({ decoys, guards });
  const residentsName = ({ decoys, guards }) => `${decoys}+${guards}`;
  const knobsOf = (residents) => ({ obstacleBase: RECIPE.obstacleBase, decoys: residents.decoys, scatter: RECIPE.scatter, guards: residents.guards, screens: RECIPE.screens });
  // Setting keys name the layout knobs and the tier whose monsters it met.
  const settingKey = ({ obstacleBase, decoys, scatter, guards, screens = 0, tier }) => `${obstacleBase}/${decoys}/${scatter}/${guards}${screens ? `/${screens}` : ''}@${tier}`;
  const datesFor = (piece) => {
    const dates = [];
    for (let time = Date.parse(start); dates.length < samples; time += 86_400_000) {
      const raw = getRawDaily(new Date(time));
      if (raw.playerPiece === piece) dates.push(raw.date);
    }
    return dates;
  };

  // measurements[piece][settingKey][date] = [{ status, explored, ms, metrics, human }, ...] by attempt.
  const measurements = {};
  const loadRows = async () => {
    const file = JSON.parse(await readFile(dataPath, 'utf8'));
    const problem = dataProblem(file, stamp);
    if (problem) throw new Error(`${fileURLToPath(dataPath)} can't be reused: ${problem}. Measure again without --reuse or --merge.`);
    for (const row of file.rows) {
      ((measurements[row.piece] ??= {})[row.setting] ??= {})[row.date] ??= [];
      measurements[row.piece][row.setting][row.date][row.attempt] = { status: row.status, explored: row.explored, ms: row.ms, metrics: row.metrics, human: row.human };
    }
    return file;
  };
  let searchCount = 0;
  const runBegan = Date.now();
  if (args.includes('--reuse')) {
    ({ start, samples } = await loadRows());
  } else {
    if (args.includes('--merge')) await loadRows();
    const tasks = [];
    for (const piece of pieces) for (const date of datesFor(piece)) for (const tier of TIER_IDS) for (const residents of RESIDENTS) {
      const setting = { ...knobsOf(residents), tier };
      if (!measurements[piece]?.[settingKey(setting)]?.[date]) tasks.push({ id: tasks.length, piece, date, setting });
    }
    console.log(`Measuring ${tasks.length} (date, setting) pairs, up to ${ATTEMPTS} candidates each, on ${jobs} workers at ${SEARCH_BUDGET} expansions…`);
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => {
        if (next >= tasks.length) { worker.terminate(); resolve(); return; }
        const task = tasks[next++];
        worker.postMessage({ id: task.id, date: task.date, setting: task.setting, budget: SEARCH_BUDGET });
      };
      worker.on('message', ({ id, found }) => {
        const task = tasks[id];
        ((measurements[task.piece] ??= {})[settingKey(task.setting)] ??= {})[task.date] = found;
        searchCount += found.length;
        if (++done % 250 === 0 || done === tasks.length) {
          const elapsed = (Date.now() - runBegan) / 1000;
          console.log(`  ${done}/${tasks.length} (${Math.round(elapsed)} s, about ${Math.round(elapsed / done * (tasks.length - done))} s left)`);
        }
        feed();
      });
      worker.on('error', reject);
      feed();
    })));
    console.log(`Searched ${searchCount} candidate layouts in ${Math.round((Date.now() - runBegan) / 1000)} s on ${jobs} workers.`);
    // One row per search; the stamp lets a later run refuse stale data.
    const rows = [];
    for (const [piece, bySetting] of Object.entries(measurements)) for (const [setting, byDate] of Object.entries(bySetting)) {
      for (const [date, found] of Object.entries(byDate)) for (const [attempt, entry] of found.entries()) {
        rows.push({ piece, setting, date, attempt, status: entry.status, explored: entry.explored, ms: entry.ms, metrics: entry.metrics, human: entry.human ?? null });
      }
    }
    const header = JSON.stringify({ ...dataStamp(stamp), measure: 'cappedGap' }).slice(1, -1);
    await writeFile(dataPath, `{"generated":${JSON.stringify(new Date().toISOString())},${header},"start":${JSON.stringify(start)},"samples":${samples},`
      + `"recipe":${JSON.stringify(RECIPE)},"settingKey":"obstacleBase/decoys/scatter/guards[/screens]@tier","humanRuns":"row.human: per floor, each bot run's moves when it won, else null",\n"rows":[\n`
      + rows.map((row) => JSON.stringify(row)).join(',\n') + '\n]}\n');
    console.log(`Wrote ${rows.length} searches to ${fileURLToPath(dataPath)}.`);
  }

  // The fit: what generateDaily would make of each setting's days under its tier.
  const round = (value) => Math.round(value * 10) / 10;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const simulate = (piece, tier, residents) => {
    const byDate = measurements[piece]?.[settingKey({ ...knobsOf(residents), tier })];
    if (!byDate) throw new Error(`No ${piece} measurements for ${residentsName(residents)} under ${tier} monsters: measure first (without --reuse) or --merge.`);
    const [low, high] = DIFFICULTY_TIERS[tier].band, width = high - low;
    const gaps = [];
    let fallbacks = 0, inBand = 0, distance = 0, quick = 0, searches = 0, unknown = 0, invalid = 0;
    const dates = Object.keys(byDate);
    for (const date of dates) {
      const found = byDate[date];
      searches += found.length;
      unknown += found.filter((entry) => entry.status === 'unknown').length;
      invalid += found.filter((entry) => entry.status === 'invalid').length;
      const candidates = found.map((entry) => (entry.metrics ? { metrics: entry.metrics, gap: storedGap(entry) } : null));
      const index = chooseCandidate(candidates, tier, RECIPE.minThreatenedDecisions);
      if (index < 0) { fallbacks++; continue; }
      const { gap, metrics } = candidates[index];
      gaps.push(gap);
      const off = bandDistance(gap, tier);
      if (off === 0) inBand++;
      distance += off;
      if (metrics.floorMoves.some((moves) => moves < 2)) quick++;
    }
    const n = dates.length, center = (low + high) / 2;
    const cost = (gaps.length ? distance / gaps.length : Infinity) / width + (1 - inBand / n) + 10 * fallbacks / n
      + 0.2 * Math.abs((gaps.length ? mean(gaps) : low) - center) / width;
    const sd = gaps.length ? Math.sqrt(mean(gaps.map((gap) => (gap - mean(gaps)) ** 2))) : null;
    return {
      cost, n, mean: gaps.length ? round(mean(gaps)) : null, sd: sd === null ? null : round(sd),
      min: gaps.length ? round(Math.min(...gaps)) : null, max: gaps.length ? round(Math.max(...gaps)) : null,
      inBand: Math.round(inBand / n * 100) / 100, fallback: Math.round(fallbacks / n * 100) / 100, quickFloors: quick, searches: { searches, unknown, invalid },
    };
  };
  // Each piece's ladder: residents never decreasing (decoys and guards each) from Gentle to Fiendish.
  const fitLadder = (piece) => {
    const results = TIER_IDS.map((tier) => RESIDENTS.map((residents) => simulate(piece, tier, residents)));
    const below = (a, b) => a.decoys <= b.decoys && a.guards <= b.guards;
    let best = RESIDENTS.map((_, index) => ({ cost: results[0][index].cost, path: [index] }));
    for (let tier = 1; tier < TIER_IDS.length; tier++) {
      best = RESIDENTS.map((residents, index) => {
        let prev = null;
        for (const [from, entry] of best.entries()) if (below(RESIDENTS[from], residents) && (!prev || entry.cost < prev.cost)) prev = entry;
        return { cost: prev.cost + results[tier][index].cost, path: [...prev.path, index] };
      });
    }
    const chosen = best.reduce((a, b) => (b.cost < a.cost ? b : a));
    return { results, path: chosen.path };
  };

  const calibration = {};
  const report = { generated: new Date().toISOString().slice(0, 10), start, samples, measure: 'cappedGap', recipe: { ...RECIPE }, tiers: {}, dial: {} };
  for (const piece of pieces) {
    const { results, path } = fitLadder(piece);
    report.dial[piece] = {};
    for (const [t, tier] of TIER_IDS.entries()) {
      const residents = RESIDENTS[path[t]], result = results[t][path[t]];
      (calibration[tier] ??= {})[piece] = { ...residents };
      ((report.tiers[tier] ??= {})[piece] = { ...residents, ...result, cost: Math.round(result.cost * 1000) / 1000 });
      // The whole dial under this tier's monsters: mean gap of the day's pick and days in band.
      report.dial[piece][tier] = Object.fromEntries(RESIDENTS.map((entry, index) => [residentsName(entry), [results[t][index].mean, results[t][index].inBand]]));
    }
  }

  console.log(`\nRecipe ${JSON.stringify(RECIPE)}; ${samples} dates per piece from ${start}. Residents (decoys+guards) by tier, then each tier's capped gap: mean (days in band, fallbacks).`);
  for (const piece of pieces) {
    const cells = TIER_IDS.map((tier) => {
      const entry = report.tiers[tier][piece];
      return `${residentsName(entry)} ${entry.mean ?? '–'} (${Math.round(entry.inBand * 100)}%${entry.fallback ? `, ${Math.round(entry.fallback * 100)}% fb` : ''})`;
    });
    console.log(`  ${piece.padEnd(7)} ${cells.map((cell) => cell.padEnd(22)).join(' ')}`);
  }
  for (const tier of TIER_IDS) {
    const [low, high] = DIFFICULTY_TIERS[tier].band;
    const means = pieces.map((piece) => report.tiers[tier][piece].mean).filter((value) => value !== null);
    console.log(`  ${tier} [${low}, ${high}]: piece means ${Math.min(...means)}-${Math.max(...means)}, days in band ${Math.round(mean(pieces.map((piece) => report.tiers[tier][piece].inBand)) * 100)}%`);
  }
  const misses = TIER_IDS.flatMap((tier) => pieces.filter((piece) => {
    const value = report.tiers[tier][piece].mean;
    return value === null || bandDistance(value, tier) > 0;
  }).map((piece) => `${tier}/${piece}`));
  if (misses.length) console.warn(`\nMean capped gap outside the band for ${misses.join(', ')}: the dial can't reach it under these rules.`);

  if (args.includes('--dry-run')) {
    console.log('\nDry run: src/calibration.js unchanged.');
  } else {
    // Pieces this run did not measure keep their residents (and nothing else: the recipe is shared).
    const { CALIBRATION: previous, CALIBRATION_REPORT: previousReport } = await load('src/calibration.js');
    const merged = {}, mergedReport = { ...report, tiers: {}, dial: { ...previousReport?.dial, ...report.dial } };
    for (const tier of TIER_IDS) {
      merged[tier] = {};
      for (const piece of PLAYABLE_PIECES) {
        const row = calibration[tier]?.[piece] ?? previous[tier]?.[piece];
        if (row) merged[tier][piece] = { decoys: row.decoys, guards: row.guards };
      }
      mergedReport.tiers[tier] = { ...previousReport?.tiers?.[tier], ...report.tiers[tier] };
    }
    const source = '// SPDX-License-Identifier: GPL-3.0-only\n'
      + '// Generated by scripts/calibrate-difficulty.mjs. Do not edit by hand: re-run it\n'
      + '// after changing rules, monster AI, modifiers, search, the human-like bot or the\n'
      + '// measure, then rebuild the fallback bank and the editions.\n'
      + '// CALIBRATION[tier][piece] is the residents dial (decoys and guards) on top of the\n'
      + '// shared room recipe (src/difficulty.js RECIPE, knobsFor). CALIBRATION_REPORT records\n'
      + '// the measured capped human gaps behind it (the chosen row per tier and piece, and the\n'
      + '// whole dial: [mean gap of the day\'s pick, share of days in band] per decoys+guards);\n'
      + '// it is not used at runtime.\n'
      + `export const CALIBRATION = ${JSON.stringify(merged, null, 2)};\n`
      + `export const CALIBRATION_REPORT = ${JSON.stringify(mergedReport, null, 2)};\n`;
    await writeFile(new URL('src/calibration.js', root), source);
    console.log('\nWrote src/calibration.js. Next: node scripts/build-fallbacks.mjs && npm run verify:fallbacks && npm run build:editions -- --full');
  }
}
