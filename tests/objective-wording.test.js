// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGoal } from '../src/rules.js';

test('a lone target reads in the singular, a group in the plural', () => {
  assert.equal(captureGoal('king'), 'Capture the enemy king');
  assert.equal(captureGoal('queen'), 'Capture the enemy queen');
  assert.equal(captureGoal('bishop'), 'Capture all enemy bishops');
  assert.equal(captureGoal('pawn'), 'Capture all enemy pawns');
});
