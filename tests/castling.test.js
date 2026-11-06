// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, getShareText, legalMoves, validateSave } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';

const move = (x, y) => ({ type: 'move', x, y });
function findDaily(match, label) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (match(daily)) return daily;
  }
  throw Error(`No ${label} edition found`);
}
// Kings are no longer a daily piece; engine tests borrow a rook day.
const dailyFor = (piece, color) => piece === 'king' ? { ...dailyFor('rook', color), playerPiece: 'king' } : findDaily((d) => d.playerPiece === piece && d.playerColor === color, `${color} ${piece}`);
function scenario(piece = 'king', color = 'white', x = 4, y = 6) {
  const state = createGame(dailyFor(piece, color));
  Object.assign(state.player, { x, y, moved: true });
  state.map = Array(8).fill('........'); state.props = []; state.items = [];
  state.enemies = [monster('far', 'king', 0, 0)];
  state.objective = { piece: 'king', complete: false }; state.companion = null;
  state.powers = { shield: 0, freeze: 0, magnet: 0 }; state.awaitingPlayer = false;
  return state;
}
function monster(id, piece, x, y) {
  return { id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: false, phase: 'ready', intent: [], target: null };
}
const ally = (piece, x, y) => ({ piece, basePiece: piece, x, y, moved: true, sharing: false });
const castles = (state) => legalMoves(state).filter((m) => m.castle);
const find = (state, type) => state.events.find((event) => event.type === type);
const types = (state) => state.events.map((event) => event.type);

test('a king with a rook recruit castles both ways along its row', () => {
  for (const [rookX, kingTo, rookTo] of [[7, 6, 5], [1, 2, 3]]) {
    const state = scenario('king'); state.companion = ally('rook', rookX, 6);
    assert.deepEqual(castles(state), [{ x: kingTo, y: 6, capture: false, castle: true }]);
    const next = act(state, move(kingTo, 6));
    assert.deepEqual([next.player.x, next.player.y], [kingTo, 6]);
    assert.deepEqual([next.companion.x, next.companion.y], [rookTo, 6]);
    assert.deepEqual(find(next, 'castle'), { type: 'castle', x: kingTo, y: 6, king: { from: { x: 4, y: 6 }, to: { x: kingTo, y: 6 } }, rook: { from: { x: rookX, y: 6 }, to: { x: rookTo, y: 6 } } });
    assert.deepEqual(find(next, 'companion-move'), { type: 'companion-move', piece: 'rook', from: { x: rookX, y: 6 }, x: rookTo, y: 6 });
    assert.deepEqual(find(next, 'move'), { type: 'move', x: kingTo, y: 6 });
    // Castling is the recruit's move too: no separate companion phase.
    assert.equal(find(next, 'companion-phase'), undefined);
    assert.ok(types(next).includes('enemy-phase'));
    assert.equal(next.message, 'Castled! King and rook switched sides in one move.');
    assert.equal(next.turns, state.turns + 1);
    assert.deepEqual(next.feats, [{ floor: 0, kind: 'castle' }]);
  }
});

test('a rook castles by clicking its king recruit', () => {
  const state = scenario('rook'); state.companion = ally('king', 1, 6);
  const offered = legalMoves(state).filter((m) => m.x === 1 && m.y === 6);
  assert.deepEqual(offered, [{ x: 1, y: 6, capture: false, castle: true }]);
  // The rook's landing square stays an ordinary move.
  assert.ok(legalMoves(state).some((m) => m.x === 2 && m.y === 6 && !m.castle));
  const next = act(state, move(1, 6));
  assert.deepEqual([next.player.x, next.player.y], [2, 6]);
  assert.deepEqual([next.companion.x, next.companion.y], [3, 6]);
  assert.deepEqual(find(next, 'castle').king, { from: { x: 1, y: 6 }, to: { x: 3, y: 6 } });
  assert.deepEqual(find(next, 'castle').rook, { from: { x: 4, y: 6 }, to: { x: 2, y: 6 } });
  assert.deepEqual(find(next, 'companion-move'), { type: 'companion-move', piece: 'king', from: { x: 1, y: 6 }, x: 3, y: 6 });
  assert.equal(find(next, 'companion-phase'), undefined);
  // An ordinary move to the landing square is not a castle.
  const plain = act(state, move(2, 6));
  assert.equal(find(plain, 'castle'), undefined);
  assert.deepEqual([plain.player.x, plain.player.y], [2, 6]);
});

test('castling picks up items on the landing square', () => {
  const state = scenario('king'); state.companion = ally('rook', 7, 6);
  state.items = [{ type: 'coin', x: 6, y: 6 }, { type: 'coin', x: 5, y: 6 }];
  const next = act(state, move(6, 6));
  assert.equal(next.treasure, state.treasure + 1);
  assert.deepEqual(next.items, [{ type: 'coin', x: 5, y: 6 }]);
});

test('castling needs two clear squares between on one row and a king with a rook', () => {
  const offered = (setup, piece = 'king') => { const state = scenario(piece); setup(state); return castles(state).length > 0; };
  assert.equal(offered((s) => { s.companion = ally('rook', 7, 6); }), true);
  assert.equal(offered((s) => { s.companion = ally('rook', 7, 6); s.items = [{ type: 'coin', x: 5, y: 6 }]; }), true, 'items may lie between');
  assert.equal(offered((s) => { s.companion = ally('rook', 7, 6); s.map[6] = '.....#..'; }), false, 'wall between');
  assert.equal(offered((s) => { s.companion = ally('king', 7, 6); s.map[6] = '......#.'; }, 'rook'), false, 'wall between for a rook');
  assert.equal(offered((s) => { s.companion = ally('king', 7, 6); s.enemies.push(monster('m', 'pawn', 5, 6)); }, 'rook'), false, 'monster between');
  assert.equal(offered((s) => { s.companion = ally('rook', 7, 6); s.enemies.push(monster('m', 'pawn', 6, 6)); }), false, 'monster on the landing square');
  for (const x of [6, 2, 0, 5, 3]) assert.equal(offered((s) => { s.companion = ally('rook', x, 6); }), false, `rook at ${x}`);
  assert.equal(offered((s) => { s.companion = ally('rook', 7, 5); }), false, 'different row');
  for (const piece of ['queen', 'knight', 'bishop', 'pawn', 'king']) assert.equal(offered((s) => { s.companion = ally(piece, 7, 6); }), false, `${piece} recruit`);
  for (const piece of ['queen', 'rook', 'bishop', 'knight']) assert.equal(offered((s) => { s.companion = ally('rook', 7, 6); }, piece), false, `${piece} player`);
  assert.equal(offered(() => {}), false, 'no recruit');
});

test('a king may not castle out of, through or into close range; a rook may', () => {
  const blocked = (knight) => { const state = scenario('king'); state.companion = ally('rook', 7, 6); state.enemies.push(monster('n', 'knight', ...knight)); return castles(state).length === 0; };
  assert.equal(blocked([3, 4]), true, 'start square attacked');
  assert.equal(blocked([7, 5]), true, 'crossed square attacked');
  assert.equal(blocked([7, 4]), true, 'landing square attacked');
  assert.equal(blocked([0, 3]), false, 'unrelated knight');
  // Frozen monsters attack nothing.
  const frozen = scenario('king'); frozen.companion = ally('rook', 7, 6); frozen.powers.freeze = 2; frozen.enemies.push(monster('n', 'knight', 7, 5));
  assert.equal(castles(frozen).length, 1);
  // A rook castling beside its king has no check rule, but lands like any move.
  const rook = scenario('rook'); rook.companion = ally('king', 1, 6); rook.enemies.push(monster('n', 'knight', 3, 4));
  assert.equal(castles(rook).length, 1);
  const hp = rook.player.hp;
  const hit = act(rook, move(1, 6));
  assert.deepEqual([hit.companion.x, hit.companion.y], [3, 6]);
  assert.ok(find(hit, 'castle'));
  assert.equal(find(hit, 'close-capture').id, 'n');
  assert.ok(hit.player.hp < hp || find(hit, 'restart'));
});

test('black castles after the monsters move, and re-chooses when they block it', () => {
  const state = scenario('king', 'black'); state.companion = ally('rook', 7, 6);
  const next = act(state, move(6, 6));
  assert.equal(next.awaitingPlayer, false);
  assert.deepEqual([next.player.x, next.player.y], [6, 6]);
  assert.deepEqual([next.companion.x, next.companion.y], [5, 6]);
  const t = types(next);
  assert.ok(t.indexOf('enemy-phase') < t.indexOf('castle'));
  assert.equal(find(next, 'companion-phase'), undefined);
  // A monster that steps between them during its move cancels the castle: choose again.
  const rook = scenario('rook', 'black', 7, 6); rook.companion = ally('king', 4, 6);
  rook.enemies.push({ ...monster('r', 'rook', 5, 0), phase: 'aim', target: { x: 5, y: 6 }, intent: [1, 2, 3, 4, 5].map((y) => ({ x: 5, y })) });
  assert.equal(castles(rook).length, 1);
  const prompt = act(rook, move(4, 6));
  assert.equal(prompt.awaitingPlayer, true);
  assert.deepEqual([prompt.player.x, prompt.player.y], [7, 6]);
  assert.deepEqual([prompt.companion.x, prompt.companion.y], [4, 6]);
  assert.equal(find(prompt, 'castle'), undefined);
  assert.equal(castles(prompt).length, 0);
  // The re-prompted choice is then played without another enemy phase.
  const after = act(prompt, move(6, 6));
  assert.equal(after.awaitingPlayer, false);
  assert.equal(find(after, 'enemy-phase'), undefined);
});

// moveMonster's tie-break hashes the turn number; pick a turn on which the
// monster pawn at (5,1) prefers its double step.
function doubleStepScenario() {
  for (let turns = 0; turns < 50; turns++) {
    const state = scenario('pawn', 'white', 4, 4); state.turns = turns;
    state.enemies = [monster('p', 'pawn', 5, 1), monster('k', 'king', 0, 0)];
    const next = act(state, move(4, 3));
    if (next.enemies.find((foe) => foe.id === 'p')?.y === 3) return next;
  }
  throw Error('no double step found');
}

test('feats record the player\'s en passant and castle, never being captured en passant', () => {
  const ep = act(doubleStepScenario(), move(5, 2));
  assert.ok(find(ep, 'en-passant'));
  assert.deepEqual(ep.feats, [{ floor: 0, kind: 'en-passant' }]);
  const victim = scenario('pawn', 'white', 4, 6); victim.player.moved = false;
  victim.enemies = [monster('p', 'pawn', 5, 4), monster('k', 'king', 0, 0)];
  const hit = act(victim, move(4, 4));
  assert.equal(find(hit, 'damage').enPassant, true);
  assert.deepEqual(hit.feats, []);
  // Saves from before feats were tracked start an empty list on their next action.
  const legacy = scenario('king'); delete legacy.feats; legacy.companion = ally('rook', 7, 6);
  assert.deepEqual(act(legacy, move(6, 6)).feats, [{ floor: 0, kind: 'castle' }]);
  assert.deepEqual(act(legacy, { type: 'wait' }).feats, []);
});

test('share text puts each floor\'s special moves after its hearts', () => {
  const state = scenario('pawn');
  state.status = 'won'; state.floor = 2; state.tries = 2; state.player.hp = 7;
  state.records = [{ floor: 0, hp: 8 }, { floor: 1, hp: 7 }, { floor: 2, hp: 7 }];
  state.feats = [{ floor: 0, kind: 'en-passant' }, { floor: 2, kind: 'castle' }, { floor: 2, kind: 'en-passant' }];
  const glyph = state.playerColor === 'white' ? '♙' : '♟';
  assert.equal(getShareText(state).split('\n')[1], `💀❤️🇫🇷💔❤️🏰🇫🇷🏆${glyph}︎`);
  // A floor still in play carries its feats before the hourglass.
  state.status = 'playing'; state.floor = 1; state.records = state.records.slice(0, 1); state.feats = [{ floor: 1, kind: 'castle' }];
  assert.equal(getShareText(state).split('\n')[1], `💀❤️💔🏰⏳${glyph}︎`);
  delete state.feats;
  assert.equal(getShareText(state).split('\n')[1], `💀❤️💔⏳${glyph}︎`);
});

test('saves with feats and castle events validate; malformed feats do not; old saves still do', () => {
  const daily = dailyFor('king', 'white');
  const base = createGame(daily);
  assert.deepEqual(base.feats, []);
  assert.equal(validateSave(base, daily.date, daily), true);
  const legacy = structuredClone(base); delete legacy.feats; delete legacy.floorSnapshot.feats;
  assert.equal(validateSave(legacy, daily.date, daily), true);
  const done = structuredClone(base);
  done.feats = [{ floor: 0, kind: 'castle' }, { floor: 0, kind: 'en-passant' }];
  done.events = [{ type: 'castle', x: 6, y: 6, king: { from: { x: 4, y: 6 }, to: { x: 6, y: 6 } }, rook: { from: { x: 7, y: 6 }, to: { x: 5, y: 6 } } }];
  const round = JSON.parse(JSON.stringify(done));
  assert.equal(validateSave(round, daily.date, daily), true);
  for (const feats of [null, 'castle', {}, [{ floor: 1, kind: 'castle' }], [{ floor: -1, kind: 'castle' }], [{ floor: 0, kind: 'fork' }],
    [{ floor: 0, kind: 'castle', extra: 1 }], [{ floor: 0.5, kind: 'castle' }], [null], Array(31).fill({ floor: 0, kind: 'castle' })]) {
    const broken = structuredClone(base); broken.feats = feats;
    assert.equal(validateSave(broken, daily.date, daily), false, JSON.stringify(feats));
  }
  assert.equal(validateSave({ ...structuredClone(base), feats: Array(30).fill({ floor: 0, kind: 'castle' }) }, daily.date, daily), true);
});
