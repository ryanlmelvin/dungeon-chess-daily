// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, closeAttacker, createGame, legalMoves } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { monsterSmarts } from '../src/monster-ai.js';
import { TIER_IDS } from '../src/difficulty.js';

// Tiny white rooms on floor 1 (no royal rules) under a given tier. The player
// waits, so every monster takes one turn; the board is judged right after.
const unit = (id, piece, x, y) => ({ id, species: 'bat', palette: 'ice', name: id, piece, role: piece, x, y, moved: true, phase: 'ready', intent: [], target: null });
function room(tier, [piece, px, py], enemies, { target = 'pawn', walls = [], leap = 0, companion = null } = {}) {
  const s = createGame(getRawDaily('2026-11-10'));
  const map = Array(8).fill('........');
  for (const [x, y] of walls) map[y] = `${map[y].slice(0, x)}#${map[y].slice(x + 1)}`;
  Object.assign(s, { difficulty: tier, playerColor: 'white', awaitingPlayer: false, floor: 0, map, items: [], companion, enemies });
  s.objective = { piece: target, complete: false };
  s.exit = { x: 4, y: 0, open: false };
  s.powers = { shield: 0, freeze: 0, magnet: 0, pin: 0, leap, takeback: 0 };
  Object.assign(s.player, { piece, x: px, y: py });
  return s;
}
const afterWait = (state) => {
  const next = act(state, { type: 'wait' });
  return { next, ...Object.fromEntries(next.enemies.map((foe) => [foe.id, foe])) };
};
const takes = (state, foe) => legalMoves(state).some((move) => move.capture && move.x === foe.x && move.y === foe.y);
// The player could take it without an instant hit in return.
const exposed = (state, foe) => takes(state, foe) && !closeAttacker(state, foe);
const at = (foe) => [foe.x, foe.y];
const TIERS_FROM = (tier) => TIER_IDS.slice(TIER_IDS.indexOf(tier));
const TIERS_BELOW = (tier) => TIER_IDS.slice(0, TIER_IDS.indexOf(tier));

test('a tier ranks its monsters; unknown, legacy and classic ones play like Gentle', () => {
  assert.deepEqual(TIER_IDS.map((difficulty) => monsterSmarts({ difficulty })), [1, 2, 3, 4, 5]);
  for (const difficulty of ['standard', 'calibration', undefined, 'constructor']) assert.equal(monsterSmarts({ difficulty }), 1);
  assert.equal(monsterSmarts({ difficulty: 'fiendish', classicMonsters: true }), 1);
});

test('Fair: every role stops stepping where the player can take it', () => {
  // The playtest complaint: a bishop and a king walk onto the rook's file.
  for (const [role, x, y, brave, careful] of [['bishop', 1, 0, [4, 3], [3, 2]], ['king', 3, 0, [4, 1], [3, 1]]]) {
    const gentle = afterWait(room('gentle', ['rook', 4, 6], [unit('m', role, x, y)]));
    assert.deepEqual(at(gentle.m), brave, `gentle ${role}`);
    assert.ok(exposed(gentle.next, gentle.m), `gentle ${role} is exposed`);
    for (const tier of TIERS_FROM('fair')) {
      const smart = afterWait(room(tier, ['rook', 4, 6], [unit('m', role, x, y)]));
      assert.deepEqual(at(smart.m), careful, `${tier} ${role}`);
      assert.ok(!exposed(smart.next, smart.m), `${tier} ${role} is safe`);
    }
  }
});

test('Fair: a held Borrowed move counts, a guarded square is safe, and a recruit is never guarded against', () => {
  // (3,4) is a knight's jump from the rook: only a held Borrowed move reaches it.
  assert.deepEqual(at(afterWait(room('fair', ['rook', 4, 6], [unit('king', 'king', 2, 3)])).king), [3, 4]);
  const leaping = afterWait(room('fair', ['rook', 4, 6], [unit('king', 'king', 2, 3)], { leap: 1 }));
  assert.notDeepEqual(at(leaping.king), [3, 4]);
  assert.ok(!exposed(leaping.next, leaping.king));
  // A walled-in pawn on (5,0) guards (4,1), so the king may step onto the rook's file there.
  const guarded = afterWait(room('fair', ['rook', 4, 6], [unit('king', 'king', 3, 0), unit('pawn', 'pawn', 5, 0)], { walls: [[5, 1]] }));
  assert.deepEqual(at(guarded.king), [4, 1]);
  assert.ok(takes(guarded.next, guarded.king) && closeAttacker(guarded.next, guarded.king));
  // A knight on (1,2) guards (3,1) against the player, but not against a recruit
  // rook on row 1, which nothing punishes. Black, so monsters act before the recruit does.
  const recruit = (companion) => {
    const s = room('fair', ['rook', 4, 6], [unit('king', 'king', 3, 0), unit('knight', 'knight', 1, 2)], { companion });
    s.playerColor = 'black';
    return afterWait(s).king;
  };
  assert.deepEqual(at(recruit(null)), [3, 1]);
  const king = recruit({ piece: 'rook', basePiece: 'rook', x: 7, y: 1, moved: true, sharing: false });
  assert.ok(king && king.y !== 1, 'it keeps off the recruit’s row');
});

test('Tricky: a slider or decoy king winds up only where it can’t be taken, unless guarded', () => {
  // Bishop against bishop on one diagonal: a wind-up would hand it over.
  for (const tier of TIERS_BELOW('tricky')) {
    const { bishop } = afterWait(room(tier, ['bishop', 4, 6], [unit('bishop', 'bishop', 1, 3)]));
    assert.deepEqual([...at(bishop), bishop.phase], [2, 4, 'aim'], tier);
  }
  for (const tier of TIERS_FROM('tricky')) {
    const { next, bishop } = afterWait(room(tier, ['bishop', 4, 6], [unit('bishop', 'bishop', 1, 3)]));
    assert.equal(bishop.phase, 'ready', tier);
    assert.ok(!exposed(next, bishop), `${tier}: it repositions off the line`);
    // A king beside the close-in square guards it: then it closes in and winds up as before.
    const guarded = afterWait(room(tier, ['bishop', 4, 6], [unit('bishop', 'bishop', 1, 3), unit('king', 'king', 1, 4)])).bishop;
    assert.deepEqual([...at(guarded), guarded.phase], [2, 4, 'aim'], `${tier}, guarded`);
    // Rook against rook from across the room: it leaves the file instead of stepping next to the player.
    const { next: after, rook } = afterWait(room(tier, ['rook', 4, 6], [unit('rook', 'rook', 4, 0)]));
    assert.equal(rook.phase, 'ready');
    assert.ok(!exposed(after, rook), `${tier}: ${at(rook)}`);
  }
  // A walled-in decoy king can only step onto the rook's file; next to the player it strikes on easier tiers only.
  const walls = [[3, 3], [5, 3], [3, 4], [5, 4], [3, 5], [5, 5]];
  for (const tier of TIER_IDS) {
    const { king } = afterWait(room(tier, ['rook', 4, 6], [unit('king', 'king', 4, 4)], { walls }));
    assert.deepEqual([...at(king), king.phase], [4, 5, TIERS_BELOW('tricky').includes(tier) ? 'aim' : 'ready'], tier);
  }
});

test('Tough: guards block lines into threatened targets and keep them shut', () => {
  // The target bishop on (4,2) is walled in on the rook's file; a decoy rook on row 4 can block.
  const box = [[3, 1], [5, 1], [3, 3], [5, 3]];
  for (const tier of TIER_IDS) {
    const { next, target, guard } = afterWait(room(tier, ['rook', 4, 6], [unit('target', 'bishop', 4, 2), unit('guard', 'rook', 0, 4)], { target: 'bishop', walls: box }));
    if (tier === 'fair' || tier === 'tricky') assert.ok(exposed(next, target), `${tier}: the guard wanders off`);
    if (TIERS_FROM('tough').includes(tier)) {
      assert.deepEqual(at(guard), [4, 4], tier);
      assert.ok(!takes(next, target), `${tier}: the line is blocked`);
    }
  }
  // A guard king already between the rook and the walled-in target bishop on (4,1) keeps it covered.
  const shut = [[3, 0], [5, 0], [3, 2], [5, 2]];
  for (const tier of TIER_IDS.slice(1)) {
    const { next, target } = afterWait(room(tier, ['rook', 4, 6], [unit('target', 'bishop', 4, 1), unit('guard', 'king', 4, 3)], { target: 'bishop', walls: shut }));
    assert.equal(exposed(next, target), !TIERS_FROM('tough').includes(tier), tier);
  }
});

test('Tough: a non-pawn target prefers a guarded square', () => {
  for (const tier of TIER_IDS.slice(1)) {
    const { next, target } = afterWait(room(tier, ['rook', 4, 6], [unit('target', 'rook', 1, 0), unit('king', 'king', 1, 2)], { target: 'rook' }));
    const huddles = TIERS_FROM('tough').includes(tier);
    assert.deepEqual(at(target), huddles ? [1, 1] : [2, 0], tier);
    assert.ok(!exposed(next, target));
  }
});

test('Fiendish: a target with a safe step never takes one where it can be taken', () => {
  // Knight against knight: a strike plus a fork outweighs the knights' soft penalty.
  for (const tier of TIER_IDS) {
    const { next, target } = afterWait(room(tier, ['knight', 4, 6], [unit('target', 'knight', 4, 2)], { target: 'knight' }));
    if (tier === 'fiendish') assert.ok(!exposed(next, target) && target.phase === 'ready', `${at(target)}`);
    else assert.deepEqual([...at(target), target.phase, exposed(next, target)], [3, 4, 'aim', true], tier);
  }
});

test('Fiendish: guards bait, winding up from guarded squares the player could take', () => {
  // The pawn acts first and stays put (the rook blocks it), guarding (4,1).
  const make = (tier) => room(tier, ['rook', 4, 6], [unit('pawn', 'pawn', 3, 0), unit('guard', 'rook', 3, 1)], { target: 'queen' });
  const tough = afterWait(make('tough')).guard;
  assert.equal(tough.phase, 'ready');
  const { next, guard } = afterWait(make('fiendish'));
  assert.deepEqual([...at(guard), guard.phase], [4, 1, 'aim']);
  assert.ok(takes(next, guard), 'the player could take it…');
  assert.equal(closeAttacker(next, guard)?.id, 'pawn', '…and be captured at once');
});

test('monsters can’t pass, so waiting still squeezes a cornered one into reach on every tier', () => {
  const rooms = [
    // A decoy king whose every step lands on the rook's file.
    ['rook', 4, 6, unit('m', 'king', 3, 0), 'pawn', [[2, 0], [2, 1], [3, 1]]],
    // A decoy king whose every step lands on the bishop's diagonal.
    ['bishop', 4, 6, unit('m', 'king', 1, 2), 'pawn', [[0, 1], [1, 1], [2, 1], [2, 2], [0, 3], [2, 3]]],
    // A target with no safe step takes an exposed one, even on Fiendish.
    ['rook', 4, 6, unit('m', 'bishop', 3, 0), 'bishop', [[2, 1], [5, 2]]],
  ];
  for (const [piece, x, y, foe, target, walls] of rooms) for (const tier of TIER_IDS) {
    const { next, m } = afterWait(room(tier, [piece, x, y], [structuredClone(foe)], { target, walls }));
    assert.ok(exposed(next, m), `${tier} ${piece} vs ${foe.piece}: ${at(m)}`);
    assert.equal(act(next, { type: 'move', x: m.x, y: m.y }).enemies.length, 0, 'and the player takes it');
  }
});

test('pawns keep their chains and only advance on every tier', () => {
  for (const tier of TIER_IDS) {
    const { lead } = afterWait(room(tier, ['bishop', 0, 7], [unit('lead', 'pawn', 4, 1), unit('base', 'pawn', 3, 1)], { target: 'pawn' }));
    assert.deepEqual(at(lead), [4, 2], tier);
  }
});

test('monster tie-breaks count moves on the floor, so earlier floors never change a reply', () => {
  // A king whose two best steps tie: (3,1) and (5,1) around a wall, the rook straight ahead.
  const reply = (before, classic) => {
    const s = room('gentle', ['rook', 4, 7], [unit('king', 'king', 4, 0)], { walls: [[4, 1]] });
    s.floor = 1; s.floorStart = { ...s.floorStart, turns: before }; s.turns = before + 3;
    if (classic) s.classicMonsters = true;
    return at(afterWait(s).king).join(',');
  };
  const offsets = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.equal(new Set(offsets.map((before) => reply(before, false))).size, 1);
  // Classic monsters (comparisons only) still hash the whole run's moves.
  assert.equal(new Set(offsets.map((before) => reply(before, true))).size, 2);
});

test('classic monsters play Gentle on every tier', () => {
  const s = room('fiendish', ['bishop', 4, 6], [unit('bishop', 'bishop', 1, 3)]);
  s.classicMonsters = true;
  const { bishop } = afterWait(s);
  assert.deepEqual([...at(bishop), bishop.phase], [2, 4, 'aim']);
  assert.equal(createGame({ ...getRawDaily('2026-11-14'), difficulty: 'fiendish', classicMonsters: true }).classicMonsters, true);
  assert.equal('classicMonsters' in createGame({ ...getRawDaily('2026-11-14'), difficulty: 'fiendish' }), false);
});
