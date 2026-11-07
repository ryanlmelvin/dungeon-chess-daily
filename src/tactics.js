// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
//
// Chess tactics: rewards and feedback only. Nothing here changes where any
// piece may move or what it captures, so certified routes replay unchanged.
//
// Fork: after the player's move, their piece attacks two or more monsters
// (by the real capture rules: walls and other pieces block lines, knights
// jump). Capturing one of them on the very next move wins bonus gold and a
// fork feat.
// Combo: captures on consecutive player moves. The third in a row, and each
// one after it, wins bonus gold and a combo feat. Waiting, a quiet move or a
// new floor ends it.
//
// Bonus gold is derived from the feats alone (tacticGold), so validateSave can
// check the gold ledger without another counter.

export const TACTIC_GOLD = Object.freeze({ fork: 2, combo: 1 });
export const COMBO_START = 3;
export const TACTIC_KINDS = Object.freeze(Object.keys(TACTIC_GOLD));
export const TACTIC_EVENTS = Object.freeze(['fork', 'fork-won', 'combo']);

/** Bonus gold the run has earned from its fork and combo feats. */
export function tacticGold(feats) {
  if (!Array.isArray(feats)) return 0;
  return feats.reduce((sum, feat) => sum + (TACTIC_GOLD[feat?.kind] ?? 0), 0);
}

/** Ids of the distinct monsters the player's capture moves reach; two or more is a fork. */
export function forkedIds(state, moves) {
  const ids = [];
  for (const move of moves) {
    if (!move.capture) continue;
    const foe = state.enemies.find((entry) => entry.x === move.x && entry.y === move.y);
    if (foe && !ids.includes(foe.id)) ids.push(foe.id);
  }
  return ids.length >= 2 ? ids : null;
}

/**
 * Score the player's resolved move. `captured` is the monster it took (or
 * null), `pending` the fork set up by the previous move, `hit` whether a
 * close-range monster struck back (which spoils any new fork), and `attacks`
 * returns the player's legal moves on the board as it now stands.
 */
export function scoreTactics(state, { captured, pending, hit, attacks }) {
  state.fork = null;
  state.combo = captured ? (state.combo ?? 0) + 1 : 0;
  const at = { x: state.player.x, y: state.player.y };
  const credit = [];
  if (captured && pending?.ids?.includes(captured.id)) {
    state.gold += TACTIC_GOLD.fork;
    state.feats.push({ floor: state.floor, kind: 'fork' });
    state.events.push({ type: 'fork-won', id: captured.id, ...at, gold: TACTIC_GOLD.fork });
    credit.push(`Fork won! +${TACTIC_GOLD.fork} gold.`);
  }
  if (state.combo >= COMBO_START) {
    state.gold += TACTIC_GOLD.combo;
    state.feats.push({ floor: state.floor, kind: 'combo' });
    state.events.push({ type: 'combo', count: state.combo, ...at, gold: TACTIC_GOLD.combo });
    credit.push(`Combo ×${state.combo}! +${TACTIC_GOLD.combo} gold.`);
  }
  if (credit.length) state.message = `${state.message ? `${state.message} ` : ''}${credit.join(' ')}`;
  if (!hit && state.status === 'playing') {
    const ids = forkedIds(state, attacks());
    if (ids) {
      state.fork = { ids };
      state.events.push({ type: 'fork', ...at, ids });
    }
  }
}

/** A move without a capture chance: waiting ends any combo and fork. */
export function breakTactics(state) {
  state.combo = 0;
  state.fork = null;
}

/** Shape checks for a save's tactic fields; absent fields belong to older saves. */
export function validTactics(value, enemyIds) {
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const floorCaptures = value.captures - value.floorStart.captures;
  if (value.combo !== undefined && !integer(value.combo, 0, floorCaptures)) return false;
  const fork = value.fork;
  if (fork !== undefined && fork !== null) {
    if (typeof fork !== 'object' || Object.keys(fork).join() !== 'ids' || !Array.isArray(fork.ids) || fork.ids.length < 2) return false;
    if (new Set(fork.ids).size !== fork.ids.length || !fork.ids.every((id) => enemyIds.includes(id))) return false;
  }
  // Each fork or combo feat pays for one capture.
  const feats = value.feats ?? [];
  return TACTIC_KINDS.every((kind) => feats.filter((feat) => feat.kind === kind).length <= value.captures);
}
