// SPDX-License-Identifier: GPL-3.0-only
// Pure helpers for scripts/calibrate-difficulty.mjs --fast: a least-squares
// surrogate of score on the knobs, monotone-dominance pruning, and a paired
// test for sequential stopping. None of this touches generation or the fit:
// it only decides which settings get full-budget searches.

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
