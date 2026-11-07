// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Which explainer dialog opens by itself once a move settles (main.js).

/**
 * The player's own en passant or castle opens its explainer every time; the
 * first fork won and the first combo open theirs once per device (`seen(kind)`
 * is true once it has shown). A waiting recruit never opens one by itself: a
 * dialog popping up after a move swallowed the next tap. The floor's opening
 * message names the recruit, with a What? button for its explainer. The bishop
 * pair's hop ('bishop-pair') likewise offers its explainer from its "Holy duo!"
 * line's What? button only.
 */
export function autoExplainer(events, seen) {
  if (events.some((event) => event.type === 'en-passant')) return 'en-passant';
  if (events.some((event) => event.type === 'castle')) return 'castle';
  const tactic = events.some((event) => event.type === 'fork-won') ? 'fork' : events.some((event) => event.type === 'combo') ? 'combo' : null;
  return tactic && !seen(tactic) ? tactic : null;
}
