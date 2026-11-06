// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, getShareText, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { getDaily } from '../src/game.js';
import { botRun } from '../src/bot.js';
import { COMBO_START, TACTIC_GOLD, tacticGold } from '../src/tactics.js';

const move = (x, y) => ({ type: 'move', x, y });
const wait = { type: 'wait' };
function findDaily(match, label) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (match(daily)) return daily;
  }
  throw Error(`No ${label} edition found`);
}
// Monsters stay frozen so each test sees only the player's tactics.
function scenario(piece, x, y, enemies, walls = []) {
  const state = createGame(findDaily((d) => d.playerPiece === piece, piece));
  Object.assign(state.player, { x, y, moved: true });
  state.map = Array.from({ length: 8 }, (_, row) => [...'........'].map((c, col) => walls.some(([wx, wy]) => wx === col && wy === row) ? '#' : c).join(''));
  state.props = []; state.items = []; state.companion = null; state.awaitingPlayer = false;
  state.objective = { piece: 'king', complete: false };
  state.powers = { shield: 0, freeze: 6, magnet: 0 };
  state.enemies = [...enemies, monster('k', 'king', 7, 0)];
  return state;
}
function monster(id, piece, x, y) {
  return { id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: false, phase: 'ready', intent: [], target: null };
}
const find = (state, type) => state.events.find((event) => event.type === type);
const kinds = (state, kind) => state.feats.filter((feat) => feat.kind === kind).length;
const forkedAfter = (state, to) => act(state, move(...to)).fork?.ids.toSorted() ?? null;

test('a knight fork is detected even over walls', () => {
  const state = scenario('knight', 4, 6, [monster('a', 'bishop', 2, 2), monster('b', 'bishop', 5, 3)], [[2, 3], [3, 3], [4, 3]]);
  const next = act(state, move(3, 4));
  assert.deepEqual(next.fork.ids.toSorted(), ['a', 'b']);
  assert.deepEqual(find(next, 'fork'), { type: 'fork', x: 3, y: 4, ids: next.fork.ids });
  // Spotting a fork is free; only converting it pays.
  assert.equal(next.gold, state.gold);
  assert.deepEqual(next.feats, []);
});

test('lines blocked by walls or other monsters are not forks', () => {
  const rook = (enemies, walls) => scenario('rook', 4, 6, enemies, walls);
  const file = monster('a', 'bishop', 4, 1), rank = monster('b', 'bishop', 0, 4);
  assert.deepEqual(forkedAfter(rook([file, rank], []), [4, 4]), ['a', 'b']);
  assert.equal(forkedAfter(rook([file, rank], [[2, 4]]), [4, 4]), null);
  // A monster screened by another monster on the same line is not attacked.
  assert.equal(forkedAfter(rook([file, monster('b', 'bishop', 4, 2)], []), [4, 4]), null);
  // A pawn attacks only diagonally forward; the square ahead is not an attack.
  const pawn = (enemies) => scenario('pawn', 4, 5, enemies);
  assert.deepEqual(forkedAfter(pawn([monster('a', 'bishop', 3, 3), monster('b', 'bishop', 5, 3)]), [4, 4]), ['a', 'b']);
  assert.equal(forkedAfter(pawn([monster('a', 'bishop', 3, 3), monster('b', 'bishop', 4, 3)]), [4, 4]), null);
  // Bishops see diagonals only.
  const bishop = scenario('bishop', 6, 6, [monster('a', 'rook', 1, 1), monster('b', 'rook', 5, 1), monster('c', 'rook', 3, 0)]);
  assert.deepEqual(forkedAfter(bishop, [3, 3]), ['a', 'b']);
});

test('the fork bonus pays only when a forked monster is captured on the next move', () => {
  const forked = act(scenario('knight', 4, 6, [monster('a', 'bishop', 2, 2), monster('b', 'bishop', 5, 3)]), move(3, 4));
  const won = act(forked, move(2, 2));
  assert.equal(won.gold, forked.gold + 1 + TACTIC_GOLD.fork);
  assert.deepEqual(won.feats, [{ floor: 0, kind: 'fork' }]);
  assert.deepEqual(find(won, 'fork-won'), { type: 'fork-won', id: 'a', x: 2, y: 2, gold: TACTIC_GOLD.fork });
  assert.match(won.message, /Fork won!/);
  // Waiting lets the fork lapse, even though both monsters are still attacked.
  const waited = act(forked, wait);
  assert.equal(waited.fork, null);
  const late = act(waited, move(2, 2));
  assert.equal(late.gold, forked.gold + 1);
  assert.deepEqual(late.feats, []);
  // So does a quiet move.
  const quiet = act(forked, move(1, 5));
  assert.equal(quiet.gold, forked.gold);
  assert.deepEqual(quiet.feats, []);
  // Capturing the challenge piece out of a fork still pays the fork bonus.
  const start = scenario('knight', 4, 6, [monster('a', 'bishop', 2, 2)]);
  Object.assign(start.enemies.find((foe) => foe.id === 'k'), { x: 5, y: 3 });
  const royal = act(start, move(3, 4));
  assert.deepEqual(royal.fork.ids.toSorted(), ['a', 'k']);
  const king = act(royal, move(5, 3));
  assert.equal(king.gold, royal.gold + TACTIC_GOLD.fork);
});

test('a third capture in a row starts a combo that pays on every capture after', () => {
  let state = scenario('rook', 0, 7, [monster('a', 'bishop', 0, 5), monster('b', 'bishop', 3, 5), monster('c', 'bishop', 3, 2), monster('d', 'bishop', 6, 2)]);
  const path = [[0, 5], [3, 5], [3, 2], [6, 2]];
  path.forEach((square, index) => {
    const next = act(state, move(...square));
    const count = index + 1;
    assert.equal(next.combo, count);
    const combos = Math.max(0, count - COMBO_START + 1);
    assert.equal(kinds(next, 'combo'), combos);
    assert.equal(Boolean(find(next, 'combo')), count >= COMBO_START);
    if (count >= COMBO_START) assert.equal(find(next, 'combo').count, count);
    // Gold: one per optional capture plus every new tactic feat.
    assert.equal(next.gold - state.gold, 1 + tacticGold(next.feats.slice(state.feats.length)));
    state = next;
  });
  assert.equal(act(state, move(6, 5)).combo, 0);
  // Waiting breaks a combo too.
  let broken = scenario('rook', 0, 7, [monster('a', 'bishop', 0, 5), monster('b', 'bishop', 3, 5), monster('c', 'bishop', 3, 2)]);
  broken = act(act(broken, move(0, 5)), move(3, 5));
  assert.equal(broken.combo, 2);
  const resumed = act(act(broken, wait), move(3, 2));
  assert.equal(resumed.combo, 1);
  assert.equal(kinds(resumed, 'combo'), 0);
});

test('a new floor starts without a combo or a fork', () => {
  const state = scenario('rook', 0, 7, []);
  state.combo = 2; state.fork = { ids: ['k', 'x'] };
  state.objective.complete = true; state.exit.open = true;
  const below = act(state, { type: 'descend' });
  assert.equal(below.floor, 1);
  assert.equal(below.combo, 0);
  assert.equal(below.fork, null);
});

test('share text adds forks then combos after each floor\'s special moves', () => {
  const state = scenario('pawn', 4, 6, []);
  state.status = 'won'; state.floor = 2; state.player.hp = 7;
  state.records = [{ floor: 0, hp: 8 }, { floor: 1, hp: 7 }, { floor: 2, hp: 7 }];
  state.feats = [{ floor: 0, kind: 'combo' }, { floor: 0, kind: 'en-passant' }, { floor: 0, kind: 'fork' }, { floor: 0, kind: 'combo' },
    { floor: 2, kind: 'fork' }, { floor: 2, kind: 'castle' }];
  assert.equal(getShareText(state).split('\n')[1], '❤️🇫🇷🍴🔥🔥💔❤️🏰🍴🏆♙︎');
  state.feats = [];
  assert.equal(getShareText(state).split('\n')[1], '❤️💔❤️🏆♙︎');
});

test('real runs with forks and combos save, resume and validate', () => {
  let forkFrame = null;
  let seen = 0;
  for (const date of ['2026-11-05', '2026-11-06', '2026-11-07']) {
    const daily = getDaily(date);
    const run = botRun(daily);
    for (const frame of run.frames) {
      const saved = JSON.parse(JSON.stringify(frame));
      assert.equal(validateSave(saved, date, daily), true, `${date} turn ${frame.turns}`);
      assert.equal(saved.gold, frame.gold);
      if (frame.fork && frame.status === 'playing' && !forkFrame) forkFrame = { saved, date, daily };
    }
    seen += run.frames.at(-1).feats.filter((feat) => ['fork', 'combo'].includes(feat.kind)).length;
  }
  assert.ok(seen > 0, 'the certified routes include a fork or combo');
  assert.ok(forkFrame, 'a saved position holds a pending fork');
  const { saved, date, daily } = forkFrame;
  const check = (mutate) => { const copy = structuredClone(saved); mutate(copy); return validateSave(copy, date, daily); };
  // Saves from before tactics have neither field.
  assert.equal(check((s) => { delete s.combo; delete s.fork; delete s.floorSnapshot.combo; delete s.floorSnapshot.fork; }), true);
  assert.equal(check((s) => { s.fork = null; }), true);
  assert.equal(check((s) => { s.fork.ids = [s.fork.ids[0]]; }), false);
  assert.equal(check((s) => { s.fork.ids = [s.fork.ids[0], 'nobody']; }), false);
  assert.equal(check((s) => { s.fork.ids = [s.fork.ids[0], s.fork.ids[0]]; }), false);
  assert.equal(check((s) => { s.fork.extra = 1; }), false);
  assert.equal(check((s) => { s.combo = s.captures - s.floorStart.captures + 1; }), false);
  assert.equal(check((s) => { s.combo = -1; }), false);
  // Bonus gold must match the feats that earned it.
  assert.equal(check((s) => { s.feats.push({ floor: s.floor, kind: 'fork' }); }), false);
  assert.equal(check((s) => { s.feats.push({ floor: s.floor, kind: 'fork' }); s.gold += TACTIC_GOLD.fork; }), true);
  assert.equal(check((s) => { s.gold += 1; }), false);
  assert.equal(check((s) => { s.feats.push(...Array(s.captures + 1).fill({ floor: 0, kind: 'combo' })); s.gold += s.captures + 1; }), false);
});
