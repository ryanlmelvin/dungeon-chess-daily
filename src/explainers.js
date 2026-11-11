// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// Which explainer dialog opens by itself once a move settles (main.js).

/**
 * The player's own first en passant and first castle on this device open their
 * explainers, as do the first fork won and the first combo (`seen(kind)` is
 * true once it has shown); after that each has its journal page (src/journal.js),
 * and an en passant's or a castle's line keeps a What? button. A waiting recruit never opens one by itself: a
 * dialog popping up after a move swallowed the next tap. The floor's opening
 * message names the recruit, with a What? button for its explainer. The bishop
 * pair's hop ('bishop-pair') likewise offers its explainer from its "Holy duo!"
 * line's What? button only. The first cracked ceiling on this device ('cave-in',
 * src/cave-in.js) explains the countdown once; after that its line's What?
 * button does.
 */
export function autoExplainer(events, seen) {
  if (events.some((event) => event.type === 'en-passant') && !seen('en-passant')) return 'en-passant';
  if (events.some((event) => event.type === 'castle') && !seen('castle')) return 'castle';
  const tactic = events.some((event) => event.type === 'fork-won') ? 'fork' : events.some((event) => event.type === 'combo') ? 'combo' : null;
  if (tactic && !seen(tactic)) return tactic;
  return events.some((event) => event.type === 'cave-crack') && !seen('cave-in') ? 'cave-in' : null;
}
