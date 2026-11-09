// SPDX-License-Identifier: GPL-3.0-only
// Barricades (src/rules.js promotionBarricades): on a floor with monster pawns,
// walls on the rank where they would promote, all but the day's open squares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRawDaily } from '../src/edition.js';
import { candidateFor } from '../src/generation.js';
import { knobsFor, tierForDate, openPromotionFiles, WEEKDAY_OPEN_PROMOTION_FILES } from '../src/difficulty.js';
import { createGame, floorDecoys } from '../src/rules.js';

// Floor 1 of the first candidate of real dates past the stored editions.
function firstFloors(count) {
  const floors = [];
  for (let day = 0; floors.length < count && day < 400; day++) {
    const date = new Date(Date.UTC(2031, 0, 1 + day)).toISOString().slice(0, 10);
    const base = getRawDaily(date), tier = tierForDate(date), knobs = knobsFor(tier, base.playerPiece);
    const state = createGame(candidateFor(base, tier, knobs, 0));
    const pawns = state.targets[0] === 'pawn' || floorDecoys(state, 0).some((species) => species.piece === 'pawn');
    floors.push({ date, state, pawns, walls: knobs.obstacleBase, open: openPromotionFiles(date), bishop: base.playerPiece === 'bishop' });
  }
  return floors;
}

test('two promotion squares stay open from Monday to Thursday, every other one from Friday to Sunday', () => {
  assert.deepEqual([...WEEKDAY_OPEN_PROMOTION_FILES], [4, 2, 2, 2, 2, 4, 4]);
  assert.equal(openPromotionFiles('2026-11-09'), 2, 'Monday');
  assert.equal(openPromotionFiles('2026-11-12'), 2, 'Thursday');
  assert.equal(openPromotionFiles('2026-11-13'), 4, 'Friday');
  assert.equal(openPromotionFiles('2026-11-15'), 4, 'Sunday');
});

test('a floor with monster pawns walls its promotion rank but the open squares, on top of its walls', () => {
  const floors = firstFloors(120);
  const withPawns = floors.filter((floor) => floor.pawns), without = floors.filter((floor) => !floor.pawns);
  assert.ok(withPawns.filter((floor) => floor.open === 2).length >= 5 && withPawns.filter((floor) => floor.open === 4).length >= 5 && without.length >= 5, 'every kind among the scanned dates');
  assert.ok(withPawns.some((floor) => floor.bishop), 'a bishop day among them');
  for (const { date, state, walls, open, bishop } of withPawns) {
    const walled = [...state.map[7]].map((cell, x) => (cell === '#' ? x : null)).filter((x) => x !== null);
    const barricades = state.props.length - walls;
    if (bishop) {
      // A bishop day walls the squares off the bishop's colour, so a pawn stopped short stands where the bishop can take it.
      assert.equal(barricades, 4, `${date}: four barricades on a bishop day`);
      assert.ok([0, 2, 4, 6].every((x) => walled.includes(x)), `${date}: off the bishop's colour (${walled})`);
      continue;
    }
    assert.equal(barricades, 8 - open, `${date}: ${8 - open} barricades on top of the room's walls`);
    assert.ok(walled.length >= barricades && walled.length < 8, `${date}: the rank is walled but for some open square (${walled})`);
    // Half open: every other square of one colour.
    if (open === 4) assert.ok([0, 1].some((parity) => [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => x % 2 === parity).every((x) => walled.includes(x))), `${date}: every other square (${walled})`);
  }
  for (const { date, state, walls } of without) assert.equal(state.props.length, walls, `${date}: no barricades without pawns`);
});
