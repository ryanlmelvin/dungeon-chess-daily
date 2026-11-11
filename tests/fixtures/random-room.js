// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Random rooms for engine tests: a game created without composed rooms builds
// the seeded random room (src/rules.js setFloor). Published editions are all
// composed (src/generation.js); these rooms remain as fixtures for testing
// mechanics. `attempt` re-seeds the layout as generation's numbered candidates
// once did, and the layout knobs (obstacleBase, decoys, scatter, guards,
// screens) default to the plain room.
import { getRawDaily } from '../../src/edition.js';
import { hash } from '../../src/random.js';

export function randomRoomDaily(date, { tier = 'fair', attempt = 0, ...knobs } = {}) {
  const raw = getRawDaily(date);
  return { ...raw, difficulty: tier, dungeonSeed: attempt === 0 ? raw.seed : hash(`7:${raw.seed}:${attempt}`), ...knobs };
}
