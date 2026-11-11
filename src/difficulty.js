// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The monsters' five rulesets ("tiers"), Gentle to Fiendish. A tier sets how
// smart the monsters are (its rank, src/monster-ai.js) and how long a cracked
// ceiling holds (src/cave-in.js), never the rooms. Every daily plays Fair
// (DAILY_TIER), so the monsters stay learnable, as a puzzle needs; a day's
// challenge comes from its composed floors (src/composer.js). Practice may
// choose any tier (src/game.js createPracticeGame).
//
// This module imports no game module: src/monster-ai.js reads the tiers while
// it loads, and the rules import the monsters, so a cycle back here left
// DIFFICULTY_TIERS unset for any page or test that imported this module first.

/** The monsters' rulesets, easiest first. `rank` sets how smart they are. */
export const DIFFICULTY_TIERS = Object.freeze({
  gentle: Object.freeze({ rank: 1, name: 'Gentle' }),
  fair: Object.freeze({ rank: 2, name: 'Fair' }),
  tricky: Object.freeze({ rank: 3, name: 'Tricky' }),
  tough: Object.freeze({ rank: 4, name: 'Tough' }),
  fiendish: Object.freeze({ rank: 5, name: 'Fiendish' }),
});
export const TIER_IDS = Object.freeze(Object.keys(DIFFICULTY_TIERS));

/**
 * Every daily's monsters: Fair, where every monster just avoids the squares
 * you could take it on. One ruleset for every day (decided 2026-11-10).
 */
export const DAILY_TIER = 'fair';
