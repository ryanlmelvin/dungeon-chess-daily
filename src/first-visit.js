// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// The "How to play" guide opens by itself once, the first time a brand-new
// player enters a dungeon. The flag lives outside the save prefix (like the
// tactic explainers' flags) so backups never carry it and restores never
// reject it.
export const guideSeenKey = (scope) => `dchess-guide-seen:${scope}`;

/**
 * True only for a first visit on this device: the guide was never shown and
 * nothing has been saved under this app's prefix. Unreadable storage counts as
 * "not first" so the guide can't reopen on every visit when the flag can't stick.
 */
export function isFirstVisit(storage, { prefix, scope }) {
  try {
    if (storage.getItem(guideSeenKey(scope)) !== null) return false;
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix) || name?.startsWith(`dchess-tactic-seen:${scope}:`)) return false;
    }
    return true;
  } catch { return false; }
}

export function markGuideSeen(storage, scope) {
  try { storage.setItem(guideSeenKey(scope), '1'); } catch {}
}
