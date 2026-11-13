// SPDX-License-Identifier: GPL-3.0-only
// Terrain floors (src/composer.js): a day forced onto one of the two terrain
// modifiers (a crumbling floor, gates), as tooling and the dev preview can
// force any date, composes every floor around its terrain or with it off the
// line, proves as any edition does, and nothing changes for a date composed
// without the override.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDay, terrainMatters, terrainOff, TERRAIN_WAITS, PARTNER_MOTIF } from '../src/composer.js';
import { getRawDaily } from '../src/edition.js';
import { createGame, act, validateSave } from '../src/rules.js';
import { getDaily, proveComposed } from '../src/generation.js';
import { CRACK_TILES } from '../src/cracks.js';
import { GATE_SQUARES, GATE_CYCLE } from '../src/gates.js';
import { composedDayFor, composedSaveTag, composedSaveFits } from '../src/composed-preview.js';

const forced = (date, modifier, options) => composeDay(date, { daily: { ...getRawDaily(date), modifier }, ...options });
const LEVELS = ['idea', 'off', 'none'];
const squares = (list) => list.map(({ x, y }) => y * 8 + x);
const open = (room, tile) => room.map[tile.y][tile.x] === '.';

// A knight's day and a pawn's: quick to compose under either modifier.
for (const modifier of ['cracks', 'gates']) {
  for (const date of ['2026-12-08', '2026-12-31']) {
    test(`a day forced onto ${modifier} composes around its terrain and proves (${date})`, () => {
      const { daily, floors, dropped } = forced(date, modifier);
      assert.equal(daily.modifier, modifier);
      assert.deepEqual(dropped, []);
      const actions = daily.generation.certificate.actions;
      const proof = proveComposed(daily, actions, { saves: true, partner: daily.generation.partner ?? null });
      assert.equal(proof.valid, true, proof.reason);
      assert.ok(floors.some((floor) => floor.terrain === 'idea'), 'at least one floor is built around its terrain');
      floors.forEach((floor, f) => {
        const { room, line } = floor;
        assert.ok(LEVELS.includes(floor.terrain));
        if (modifier === 'cracks') {
          assert.equal(room.gates, undefined);
          assert.ok(room.cracks.length <= CRACK_TILES && new Set(squares(room.cracks)).size === room.cracks.length);
          assert.ok(room.cracks.every((tile) => open(room, tile) && !room.items.some((item) => item.type === 'companion' && item.x === tile.x && item.y === tile.y)));
        } else {
          assert.equal(room.cracks, undefined);
          assert.ok(room.gates.length <= GATE_SQUARES && new Set(squares(room.gates)).size === room.gates.length);
          assert.ok(room.gates.every((gate) => open(room, gate) && Number.isInteger(gate.phase) && gate.phase >= 0 && gate.phase < GATE_CYCLE));
        }
        if (floor.terrain !== 'idea') return;
        assert.ok(room[modifier].length > 0);
        assert.ok(line.filter((action) => action.type === 'wait').length <= TERRAIN_WAITS, 'no line of waiting');
        // The terrain matters: judged before the hint and the chest went in (a coin and a chest change no monster's move).
        if (floor.hint === 'coin' || floor.hint === null) assert.equal(terrainMatters(daily, f, room, line), true, `floor ${f + 1}`);
        // No chest lies on a cracked tile or a gate.
        assert.ok(!room.items.some((item) => item.type === 'chest' && room[modifier].some((tile) => tile.x === item.x && tile.y === item.y)));
      });
      // The day is a pure function of its date and modifier.
      assert.deepEqual(forced(date, modifier).daily.composed, daily.composed);
      // The terrain is live in play: the line's positions are valid saves that carry it.
      let state = createGame(daily);
      assert.ok(state.shut && (modifier === 'cracks' ? Array.isArray(state.cracks) && Array.isArray(state.pits) : Array.isArray(state.gates)));
      for (const action of actions.slice(0, floors[0].line.length)) {
        state = act(state, action);
        assert.equal(validateSave(JSON.parse(JSON.stringify(state)), date, daily), true);
      }
      assert.equal(state.exit.open, true);
    });
  }
}

test('a Tandem floor keeps its own composition under either modifier, its terrain off the line', () => {
  // 2027-01-02: a knight's day whose floor 2 is a Tandem.
  for (const modifier of ['cracks', 'gates']) {
    const { daily, floors } = forced('2027-01-02', modifier);
    assert.equal(daily.generation.partner, 1);
    assert.equal(floors[1].motif, PARTNER_MOTIF);
    assert.ok(['off', 'none'].includes(floors[1].terrain));
    assert.ok(floors[1].line.some((action) => action.recruit !== undefined), 'its line still orders the recruit');
    const onLine = new Set(squares(floors[1].line.filter((action) => action.type === 'move')));
    assert.ok(floors[1].room[modifier].every((tile) => !onLine.has(tile.y * 8 + tile.x)));
    assert.equal(proveComposed(daily, daily.generation.certificate.actions, { saves: true, partner: 1 }).valid, true);
  }
});

test('terrain off the line: a plain floor keeps its line, with tiles or gates on none of its squares', () => {
  const date = '2026-12-08';
  const plain = composeDay(date, { daily: { ...getRawDaily(date), modifier: 'none' } });
  for (const modifier of ['cracks', 'gates']) {
    const base = { ...plain.daily, modifier };
    const laid = terrainOff(base, 0, plain.floors[0]);
    assert.ok(['off', 'none'].includes(laid.terrain));
    assert.deepEqual(laid.line, plain.floors[0].line);
    assert.equal(laid.motif, plain.floors[0].motif);
    const onLine = new Set(squares(laid.line.filter((action) => action.type === 'move')));
    assert.ok(laid.room[modifier].every((tile) => !onLine.has(tile.y * 8 + tile.x) && open(laid.room, tile)));
    if (laid.terrain === 'off') assert.ok(laid.room[modifier].length >= 2);
    // Off the line it does not matter to the line, by construction: the line wins with it and without it.
    let state = createGame({ ...base, composed: [laid.room, plain.daily.composed[1], plain.daily.composed[2]] });
    for (const action of laid.line) state = act(state, action);
    assert.equal(state.exit.open, true);
    assert.equal(state.hits, 0);
  }
});

test('the dev preview forces a modifier only when asked; without it a date composes its stored edition', () => {
  const date = '2026-12-31';
  const stored = getDaily(date);
  const own = composedDayFor(`?composed=${date}`);
  assert.equal(own.modifier, stored.modifier);
  assert.deepEqual(own.composed, stored.composed);
  assert.deepEqual(own.generation.certificate.actions, stored.generation.certificate.actions);
  // A modifier that is none of the two in preview is no override.
  assert.deepEqual(composedDayFor(`?composed=${date}&modifier=dark`).composed, stored.composed);
  const gated = composedDayFor(`?composed=${date}&modifier=gates`);
  assert.equal(gated.modifier, 'gates');
  assert.ok(gated.composed.some((room) => room.gates?.length));
  assert.equal(composedDayFor(`?composed=${date}&modifier=cracks`).modifier, 'cracks');
  // Its runs save apart from the date's own preview, and only fit their own day.
  assert.equal(composedSaveTag(`?composed=${date}`), 'composed:wide:');
  assert.equal(composedSaveTag(`?composed=${date}&modifier=gates`), 'composed:wide:gates:');
  assert.equal(composedSaveTag(`?composed=${date}&modifier=cracks&starts=e2`), 'composed:cracks:');
  const run = act(createGame(gated), { type: 'wait' });
  assert.equal(composedSaveFits(JSON.parse(JSON.stringify(run)), gated), true);
  assert.equal(composedSaveFits(JSON.parse(JSON.stringify(run)), own), false);
});
