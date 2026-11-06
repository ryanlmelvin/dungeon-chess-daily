// SPDX-License-Identifier: GPL-3.0-only
// Route measurements are evidence of tactical pressure, not shortest-path
// bounds or a claim that every winning strategy encounters these decisions.
export const DIFFICULTY_PROFILES = Object.freeze({
  gentle: Object.freeze({ obstacleBase: 5, minThreatenedDecisions: 0 }),
  standard: Object.freeze({ obstacleBase: 7, minThreatenedDecisions: 2 }),
  expert: Object.freeze({ obstacleBase: 9, minThreatenedDecisions: 4 }),
});
