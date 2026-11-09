// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, resetFloor, retryLostRun, floorScoredMoves, createGame, dangerTiles, getDaily, getShareText, legalMoves, PIECES, PLAYABLE_PIECES, PIECE_COUNTS, POWERUPS, SHOP_ITEMS, validateSave, walkable } from '../src/game.js';

import { getRawDaily } from '../src/edition.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { royalRules, floorDecoys } from '../src/rules.js';

const daily = getDaily('2026-11-05');
const move = (x, y) => ({ type: 'move', x, y });
const hasMove = (state, x, y) => legalMoves(state).some((tile) => tile.x === x && tile.y === y);
function scenario(piece = 'rook', x = 4, y = 6) {
  const state = createGame(daily);
  state.player = { piece, x, y, moved: false };
  state.enemies = []; state.items = []; state.map = Array(8).fill('........'); state.props = []; state.objective = {piece: 'king', complete: false};
  return state;
}
function monster(id, piece, x, y, target = null) {
  return { id, piece, role: piece, species: 'bat', name: 'Bat', x, y, moved: false, phase: target ? 'aim' : 'ready', target, intent: target ? [{ ...target }] : [] };
}

test('daily date is UTC, deterministic, and rejects impossible calendar dates', () => {
  assert.deepEqual(daily, getDaily(new Date('2026-11-04T20:00:00-04:00')));
  assert.deepEqual(createGame(daily), createGame(getDaily('2026-11-05')));
  assert.notEqual(getDaily('2026-11-06').seed, daily.seed);
  assert.throws(() => getDaily('2026-02-31'), /Invalid daily date/);
});

test('daily selections cover the five playable pieces, never the king, and all 26 species without duplicate daily species', () => {
  const counts = Object.fromEntries(PLAYABLE_PIECES.map((piece) => [piece, 0]));
  const species = new Set();
  for (let day = 0; day < 1200; day++) {
    const issue = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    assert.notEqual(issue.playerPiece, 'king');
    counts[issue.playerPiece]++;
    assert.equal(new Set(issue.species.map((entry) => entry.id)).size, 9);
    issue.species.forEach((entry) => { species.add(entry.id); assert.ok(PIECES.includes(entry.piece)); });
    assert.equal(issue.theme.stories[0].species, issue.species[1].id);
    assert.equal(issue.theme.stories[1].species, issue.species[2].id);
  }
  assert.equal(species.size, 26);
  for (const count of Object.values(counts)) assert.ok(count > 170 && count < 310, 'uniform selection should not systematically favor a piece');
});

test('rook slides straight, captures by landing, and cannot jump a monster', () => {
  const state = scenario('rook');
  state.enemies = [monster('blocker', 'king', 4, 3)];
  assert.equal(hasMove(state, 4, 3), true);
  assert.equal(hasMove(state, 4, 2), false);
  assert.equal(hasMove(state, 3, 5), false);
  assert.equal(hasMove(state, 0, 6), true);
});

test('bishop stays diagonal and on its starting color; queen combines rook and bishop moves', () => {
  const bishop = scenario('bishop');
  assert.ok(legalMoves(bishop).every((tile) => (tile.x + tile.y) % 2 === 0));
  assert.equal(hasMove(bishop, 0, 2), true);
  assert.equal(hasMove(bishop, 4, 5), false);
  const queen = scenario('queen');
  assert.equal(hasMove(queen, 4, 0), true);
  assert.equal(hasMove(queen, 0, 2), true);
  assert.equal(hasMove(queen, 2, 5), false);
});

test('knights jump over blockers and kings move exactly one square', () => {
  const knight = scenario('knight');
  knight.enemies = [monster('blocker', 'king', 4, 5)];
  assert.equal(hasMove(knight, 3, 4), true);
  assert.equal(hasMove(knight, 2, 5), true);
  assert.equal(hasMove(knight, 4, 5), false);
  const king = scenario('king');
  assert.equal(hasMove(king, 3, 5), true);
  assert.equal(hasMove(king, 4, 4), false);
});

test('a pawn moves forward, double-steps only initially, and captures diagonally ONLY', () => {
  const state = scenario('pawn');
  assert.deepEqual(legalMoves(state), [{ x: 4, y: 5, capture: false }, { x: 4, y: 4, capture: false }]);
  // The blocker is a knight, so it does not guard the diagonal capture square.
  state.enemies = [monster('front', 'knight', 4, 5), monster('diagonal', 'king', 3, 5)];
  assert.deepEqual(legalMoves(state), [{ x: 3, y: 5, capture: true }]);
  assert.equal(act(state, move(4, 5)), state, 'forward capture must be rejected');
  assert.equal(act(state, move(4, 4)), state, 'double move cannot jump a blocker');
  const captured = act(state, move(3, 5));
  assert.equal(captured.captures, 1);
  assert.equal(captured.enemies.some((foe) => foe.id === 'diagonal'), false);
  const moved = scenario('pawn'); moved.player.moved = true;
  assert.equal(hasMove(moved, 4, 4), false);
  assert.equal(hasMove(moved, 3, 5), false, 'a pawn cannot move diagonally into an empty tile');
  assert.equal(hasMove(moved, 4, 7), false, 'a pawn cannot move backward');
});

test('a pawn promotes on the far rank and reverts to a pawn downstairs', () => {
  const state = scenario('pawn', 4, 1);
  state.enemies = [monster('last', 'king', 3, 0)];
  const promoted = act(state, move(3, 0));
  assert.equal(promoted.player.piece, 'queen');
  assert.ok(promoted.events.some((event) => event.type === 'promotion'));
  const nextRoom = act(promoted, {type:'descend'});
  assert.equal(nextRoom.floor, 1);
  assert.equal(nextRoom.player.piece, 'pawn');
  assert.equal(nextRoom.player.moved, false);
});

test('player move and capture resolve BEFORE the surviving enemy response', () => {
  const state = scenario('rook');
  const doomed = monster('doomed', 'rook', 4, 4, { x: 4, y: 6 });
  doomed.intent = [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }];
  const survivor = monster('survivor', 'rook', 7, 6, { x: 4, y: 6 });
  survivor.intent = Array.from({ length: 7 }, (_, i) => ({ x: i, y: 6 }));
  state.enemies = [doomed, survivor];
  const original = structuredClone(state);
  const next = act(state, move(4, 4));
  assert.deepEqual(state, original, 'the action must not mutate the prior save');
  assert.equal(next.hits, 0, 'a captured monster must never get a response');
  assert.equal(next.enemies.length, 1);
  assert.equal(next.enemies[0].id, 'survivor');
  assert.deepEqual({ x: next.enemies[0].x, y: next.enemies[0].y }, { x: 4, y: 6 });
  // The capture unmasks the monster on the spot.
  const order = next.events.filter((event) => event.type !== 'unmask');
  assert.equal(order[0].type, 'capture');
  assert.equal(order[1].type, 'move');
  assert.ok(order.findIndex((event) => event.type === 'miss') > 1);
});

test('ranged captures warn for a full turn along their entire firing path', () => {
  const state = scenario('king');
  state.enemies = [monster('shooter', 'rook', 4, 0)];
  const warning = act(state, move(4, 5));
  assert.equal(warning.hits, 0, 'a newly announced capture cannot happen immediately');
  assert.equal(warning.enemies[0].phase, 'aim');
  assert.deepEqual({ x: warning.enemies[0].x, y: warning.enemies[0].y }, { x: 4, y: 1 }, 'a distant rook closes in one square first');
  assert.deepEqual(dangerTiles(warning), Array.from({ length: 6 }, (_, i) => ({ x: 4, y: i + 2 })));
  const caught = act(warning, move(4, 4));
  assert.equal(caught.status, 'playing');
  assert.equal(caught.hits, 1);
  assert.deepEqual({ x: caught.enemies[0].x, y: caught.enemies[0].y }, { x: 4, y: 1 }, 'a surviving player holds its square');
  const dodged = act(warning, move(5, 5));
  assert.equal(dodged.hits, 0);
  assert.deepEqual({ x: dodged.enemies[0].x, y: dodged.enemies[0].y }, { x: 4, y: 5 }, 'an escaped attack commits to the old target');
  assert.deepEqual(dangerTiles(dodged), []);
});

test('enemy pawns cannot capture forward, and sequential enemy moves cannot share a square', () => {
  const pawn = scenario('king', 4, 5);
  pawn.enemies = [monster('pawn', 'pawn', 4, 3)];
  const next = act(pawn, move(4, 4));
  assert.equal(next.hits, 0);
  assert.equal(next.enemies[0].phase, 'ready');
  assert.equal(next.enemies[0].y, 3);
  const state = scenario('knight');
  const rook = monster('first', 'rook', 4, 0, { x: 4, y: 6 });
  const bishop = monster('second', 'bishop', 0, 2, { x: 4, y: 6 });
  state.enemies = [rook, bishop];
  const response = act(state, move(6, 5));
  assert.equal(new Set(response.enemies.map((foe) => `${foe.x},${foe.y}`)).size, 2);
  assert.deepEqual({ x: response.enemies[0].x, y: response.enemies[0].y }, { x: 4, y: 6 });
  assert.deepEqual({ x: response.enemies[1].x, y: response.enemies[1].y }, { x: 0, y: 2 });
});

test('enemy pawns also promote when they reach their far rank', () => {
  const state = scenario('king', 4, 4);
  state.enemies = [monster('pawn', 'pawn', 1, 6)];
  const next = act(state, move(4, 3));
  assert.equal(next.enemies[0].y, 7);
  assert.equal(next.enemies[0].piece, 'queen');
  assert.equal(next.enemies[0].promoted, true);
  assert.ok(next.events.some((event) => event.type === 'enemy-promotion'));
});

test('stairs need the assigned role and can be clicked from anywhere without spending a move', () => {
  const state = scenario('queen');
  const locked = act(state, move(4, 0));
  assert.equal(locked.floor, 0);
  assert.equal(locked.exit.open, false);
  locked.enemies = [monster('key', 'king', 4, 2), monster('other', 'pawn', 0, 7)];
  const captured = act(locked, move(4, 2));
  assert.equal(captured.exit.open, true);
  const descended = act(captured, {type:'descend'});
  assert.equal(descended.turns, captured.turns);
  assert.equal(descended.floor, 1);
  assert.equal(descended.records[0].captures, 1);
  assert.equal(descended.exit.open, false);
});

test('illegal, obsolete and malformed inputs do not spend a turn', () => {
  const state = createGame(daily);
  for (const action of [null, { type: 'guard' }, { type: 'lantern' }, { type: 'descend' }, move(-1, 3), move(4.5, 3), move(state.player.x, state.player.y), { type: 'move', dx: 0, dy: -1 }]) assert.equal(act(state, action), state);
  assert.equal(state.turns, 0);
});

test('moves remain available beyond sixty and final-floor extraction still works', () => {
  const state = scenario('rook');
  state.turns = 59;
  assert.equal(act(state, move(4, 5)).status, 'playing');
  state.turns = 100;
  assert.equal(act(state, move(4, 5)).turns, 101);
  state.floor = 2; state.enemies = [monster('last', 'king', 4, 4)];
  const solved = act(state, move(4, 4));
  assert.equal(solved.status, 'playing');
  assert.equal(solved.turns, 101);
  assert.ok(legalMoves(solved).length > 0);
  const extracted = act(solved, { type: 'descend' });
  assert.equal(extracted.status, 'won');
  assert.equal(extracted.turns, 101);
  assert.equal(act(extracted, move(4, 1)), extracted);
});

test('share text is a title, one line of floors (marker, moves against par and that floor\'s feats) and the link, without spoilers', () => {
  const state = createGame({ ...daily, playerPiece: 'pawn' });
  state.status = 'won'; state.floor = 2;
  state.records = [{ floor: 0, turns: 8 }, { floor: 1, turns: 12 }, { floor: 2, turns: 9 }];
  const url = 'https://ryanlmelvin.github.io/dungeon-chess-daily/';
  const share = (pars) => getShareText(state, pars, { now: new Date(Date.UTC(2026, 10, 7)) });
  const floors = (pars) => share(pars).split('\n')[1];
  const text = share([10, 11, 9]);
  assert.equal(text, `Dungeon Chess Daily · Nov 5 ♟\uFE0E\n🟥 \u22122  ⬛ +1  👑 E\n${url}`);
  for (const spoiler of [state.player.piece, ...state.species.map((entry) => entry.name), state.theme.headline]) assert.ok(!text.includes(spoiler));
  // Without a par each floor shows a dot.
  assert.equal(floors(), '🟥 ·  ⬛ ·  👑 ·');
  // Two spaces part the floors and each starts with its marker, so wide scores still read cleanly.
  assert.equal(floors([20, 0, 21]), '🟥 \u221212  ⬛ +12  👑 \u221212');
  // Special moves mark the floor they happened on, once each in a fixed order; combos don't show.
  state.feats = [{ floor: 2, kind: 'fork' }, { floor: 0, kind: 'combo' }, { floor: 0, kind: 'en-passant' }, { floor: 1, kind: 'fork' }, { floor: 2, kind: 'castle' }, { floor: 2, kind: 'fork' }];
  assert.equal(floors([10, 11, 9]), '🟥 \u22122 🇫🇷  ⬛ +1 🔱  👑 E 🏰🔱');
  state.feats = [{ floor: 0, kind: 'combo' }];
  assert.equal(floors([10, 11, 9]), '🟥 \u22122  ⬛ +1  👑 E');
  // Floors not reached are left off.
  state.status = 'lost'; state.floor = 0; state.records = [];
  assert.deepEqual(share([10, 11, 9]).split('\n').slice(1), ['🟥 ·', url]);
});

test('the share card names the edition by its UTC date, with the year only when it isn\'t the current one, then the starting piece in black', () => {
  const state = createGame(daily);
  assert.deepEqual([state.date, state.playerColor, state.startingPiece], ['2026-11-05', 'white', 'pawn']);
  const title = (now, change = {}) => getShareText({ ...state, ...change }, null, { now }).split('\n')[0];
  assert.equal(title(new Date(Date.UTC(2026, 10, 5))), 'Dungeon Chess Daily · Nov 5 ♟\uFE0E');
  assert.equal(title(new Date(Date.UTC(2026, 11, 31, 23, 59))), 'Dungeon Chess Daily · Nov 5 ♟\uFE0E');
  // From 00:00 UTC on Jan 1, an edition from the year before (an archive run, or one begun
  // before midnight) carries its year.
  assert.equal(title(new Date(Date.UTC(2027, 0, 1))), 'Dungeon Chess Daily · Nov 5, 2026 ♟\uFE0E');
  assert.equal(title(new Date(Date.UTC(2027, 0, 1, 0, 5)), { date: '2026-12-31' }), 'Dungeon Chess Daily · Dec 31, 2026 ♟\uFE0E');
  // Black glyphs whatever the color. Only ♟ also has an emoji form, so only it carries
  // U+FE0E, asking for the text form that matches the others.
  const glyph = (piece) => title(new Date(Date.UTC(2026, 10, 5)), { startingPiece: piece }).split(' ').at(-1);
  assert.deepEqual(PIECES.map(glyph), ['♟\uFE0E', '♜', '♞', '♝', '♛', '♚']);
});

test('save validation accepts real chess runs and rejects incompatible or corrupt exports', () => {
  const state = createGame(daily);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true);
  const longRun = structuredClone(state); longRun.turns = 120;
  assert.equal(validateSave(longRun, daily.date), true);
  assert.equal(validateSave(state, '2026-11-06'), false);
  for (const mutate of [
    (save) => { save.schema = 1; }, (save) => { save.player.piece = 'dragon'; },
    (save) => { save.hits = -1; }, (save) => { save.enemies[0].piece = 'dragon'; },
    (save) => { save.enemies[0].x = 99; }, (save) => { save.items.push(save.items[0]); },
    (save) => { save.records = [{ floor: 0, turns: 1, captures: 0, treasure: 0, grade: 'gold' }]; },
    (save) => { save.status = 'won'; }, (save) => { save.exit.open = true; },
  ]) {
    const bad = structuredClone(state); mutate(bad);
    assert.equal(validateSave(bad, daily.date), false);
  }
});

function assertInitialArmy(state) {
  const counts = Object.fromEntries(PIECES.map((piece) => [piece, state.enemies.filter((foe) => foe.role === piece).length]));
  for (const piece of PIECES) assert.ok(counts[piece] <= PIECE_COUNTS[piece], `${state.date} floor ${state.floor}: too many native ${piece}s`);
  assert.equal(counts[state.objective.piece], PIECE_COUNTS[state.objective.piece]);
  // The tier's `decoys` knob sets how many optional residents join the targets.
  const decoys = floorDecoys(state);
  assert.equal(state.enemies.length, PIECE_COUNTS[state.objective.piece] + decoys.length);
  assert.equal(new Set(state.enemies.map((foe) => foe.role)).size, 1 + new Set(decoys.map((species) => species.piece)).size);
  assert.equal(new Set(state.enemies.map((foe) => `${foe.x},${foe.y}`)).size, state.enemies.length);
  for (const piece of PIECES) {
    const group = state.enemies.filter((foe) => foe.role === piece);
    if (group.length) assert.equal(new Set(group.map((foe) => `${foe.species}:${foe.palette}`)).size, 1);
  }
  assert.ok(state.enemies.every((foe) => walkable(state,foe.x,foe.y)));
  assert.ok(state.enemies.every((foe) => !state.items.some((item) => item.x===foe.x && item.y===foe.y)));
  if (state.startingPiece==='bishop' && state.objective.piece==='bishop') assert.ok(state.enemies.filter((foe) => foe.role==='bishop').every((foe) => (foe.x+foe.y)%2===0));
}

test('100 consecutive certified dates win without powers, and only pawn routes are captured, preserving valid saves', () => {
  for (let day = 0; day < 100; day++) {
    const issue = getDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    let state = createGame(issue);
    assertInitialArmy(state);
    const proof = verifyWinningRoute(state, issue.generation.certificate.actions);
    assert.equal(proof.valid, true, `${state.date}: ${proof.reason}`);
    for (const action of issue.generation.certificate.actions) {
      const next = act(state, action);
      if (next.floor !== state.floor) assertInitialArmy(next);
      state = next;
      assert.equal(validateSave(state, state.date), true, `${state.date} save after move ${state.turns}`);
      assert.ok(state.hits <= (state.startingPiece === 'pawn' ? 4 : 0));
      // Only the king floor's own recruit (a king) may help, under royal rules.
      if (royalRules(state)) assert.ok(state.companion === null || state.companion.basePiece === 'king');
      else assert.equal(state.companion, null);
      assert.deepEqual(state.companionOrders, []);
      assert.deepEqual(state.powers, { shield: 0, freeze: 0, magnet: 0, pin: 0, leap: 0, takeback: 0 });
      assert.deepEqual(state.purchases, []);
    }
    assert.equal(state.status, 'won', state.date);
    assert.ok(state.turns <= 60, state.date);
    assert.equal(state.records.length, 3);
  }
});

test('objectives, palettes, obstacles and mixed residents vary deterministically across dates', () => {
  const palettes = new Set(), layouts = new Set();
  for (let day = 0; day < 40; day++) {
    const issue = getDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    assert.equal(issue.targets[2], 'king');
    assert.notEqual(issue.targets[0], issue.targets[1]);
    assert.ok(!issue.targets.slice(0, 2).includes('king'));
    const state = createGame(issue);
    const decoys = floorDecoys(state);
    assert.equal(state.enemies.length, PIECE_COUNTS[state.objective.piece] + decoys.length);
    assert.equal(new Set(state.enemies.map((enemy) => enemy.species)).size, 1 + new Set(decoys.map((species) => species.id)).size);
    // The tier's obstacleBase, plus barricades on a floor with monster pawns; a wall that would cut the board in two is skipped.
    const barricades = state.enemies.some((enemy) => enemy.piece === 'pawn') ? 8 - (issue.playerPiece === 'bishop' ? 4 : state.openFiles) : 0;
    assert.ok(state.props.length <= issue.obstacleBase + barricades && state.props.length >= Math.min(issue.obstacleBase, 4));
    assert.equal(state.map.join('').split('#').length - 1, state.props.length);
    assert.ok(state.enemies.every((enemy) => walkable(state, enemy.x, enemy.y)));
    assert.ok(state.items.every((item) => walkable(state, item.x, item.y)));
    assert.equal(state.exit.open, false);
    assert.equal(act(state, {type: 'descend'}), state);
    layouts.add(state.map.join(''));
    state.species.forEach((entry) => palettes.add(entry.palette));
    for (const story of [state.theme.deck, ...state.theme.stories.map((entry) => entry.body)]) {
      assert.doesNotMatch(story, /two paces|one tile|diagonal|straight aisle|queen|bishop|knight/i);
    }
  }
  assert.equal(palettes.size, 6);
  assert.ok(layouts.size > 25);
});

test('species that share a floor never share a palette', () => {
  for (let day = 0; day < 1500; day++) {
    const { species, date } = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    for (let floor = 0; floor < 3; floor++) {
      const mates = [species[floor], species[3 + floor * 2], species[4 + floor * 2]];
      assert.equal(new Set(mates.map((entry) => entry.palette)).size, 3, `${date} floor ${floor + 1}: ${mates.map((entry) => entry.name).join(', ')}`);
    }
  }
  // The playtest clash: Ember imp (floor 1 target) beside an Ember dragon decoy.
  const floorOne = getRawDaily('2026-11-07').species;
  assert.notEqual(floorOne[0].palette, floorOne[4].palette);
});

test('walls block sliding, pawn double steps and attack lanes, while knights jump over walls', () => {
  const state = scenario('rook');
  state.map[4] = '....#...';
  assert.equal(hasMove(state, 4, 4), false);
  assert.equal(hasMove(state, 4, 3), false);
  state.player.piece = 'pawn'; state.map[5] = '....#...';
  assert.equal(hasMove(state, 4, 4), false);
  state.player.piece = 'knight';
  assert.equal(hasMove(state, 3, 4), true);
  state.player.piece = 'king'; state.enemies = [monster('rook', 'rook', 4, 0)];
  // The rook's step is a seeded tie-break: pin the seed, not whichever candidate the day certifies.
  state.dungeonSeed = state.seed;
  assert.deepEqual(dangerTiles(act(state, move(3, 6))), []);
});

test('a decoy capture leaves the stairs hidden; a promoted target retains its original role', () => {
  const state = scenario('rook'); state.objective.piece = 'pawn';
  state.enemies = [monster('decoy', 'king', 4, 4)];
  const next = act(state, move(4, 4));
  assert.equal(next.exit.open, false);
  next.enemies = [{...monster('target', 'queen', 4, 1), role:'pawn', promoted:true}];
  assert.equal(act(next, move(4, 1)).objective.complete, true);
});

test('coins and captures buy powerups between floors without spending a move; invalid purchases are inert', () => {
  const state = scenario('rook'); state.items = [{x:4,y:5,type:'coin'}]; state.gold = 2;
  const earned = act(state, move(4,5));
  assert.equal(earned.gold, 3); assert.equal(earned.treasure, 1);
  assert.equal(act(earned, {type:'buy',id:'shield'}), earned, 'the shop is closed until the floor is cleared');
  earned.objective.complete = true; earned.exit.open = true;
  const ward = act(earned, {type:'buy',id:'shield'});
  assert.equal(ward.gold, 0); assert.equal(ward.powers.shield, 1); assert.equal(ward.turns, earned.turns);
  assert.deepEqual(ward.purchases, ['shield']);
  assert.equal(act(ward, {type:'buy',id:'shield'}), ward);
  assert.equal(act(ward, {type:'buy',id:'unknown'}), ward);
  assert.ok(POWERUPS.every((entry) => entry.name && entry.description && entry.cost > 0));
});

test('there are no lives to buy: the shop sells no extra life, and no hourglass', () => {
  const state = scenario('rook'); state.enemies = [monster('key', 'king', 4, 2)];
  state.gold = 20; state.floorSnapshot = structuredClone(state);
  const cleared = act(state, move(4, 2));
  assert.equal(cleared.exit.open, true);
  assert.equal(act(cleared, {type:'buy', id:'life'}), cleared);
  assert.ok(!SHOP_ITEMS.some((item) => item.id === 'life' || item.id === 'freeze'));
});

test('wards block a capture, freeze pauses committed attacks and magnets collect nearby coins', () => {
  const state = scenario('king',4,5); state.powers.shield = 1;
  state.enemies = [monster('rook','rook',4,0,{x:4,y:4})];
  const blocked = act(state, move(4,4));
  assert.equal(blocked.hits,0); assert.equal(blocked.powers.shield,0);
  assert.ok(blocked.events.some((event) => event.type === 'shield'));
  state.powers.freeze = 3;
  const frozen = act(state, move(4,4));
  assert.equal(frozen.powers.freeze,2); assert.equal(frozen.powers.shield,1);
  assert.deepEqual(frozen.enemies,state.enemies);
  const magnet = scenario('king',4,6);
  magnet.items = [{x:4,y:5,type:'powerup',power:'magnet'},{x:2,y:5,type:'coin'},{x:7,y:5,type:'coin'}];
  const collected = act(magnet,move(4,5));
  assert.equal(collected.powers.magnet,1); assert.equal(collected.treasure,1); assert.equal(collected.gold,1);
  assert.deepEqual(collected.items,[{x:7,y:5,type:'coin'}]);
});

test('a cornered piece restarts the same deterministic edition', () => {
  const state = createGame(daily);
  // Walled in on every side, the piece has no move at all.
  state.player = {piece:'king',x:4,y:5,moved:true}; state.map = Array(8).fill('........');
  state.map[4] = '...###..'; state.map[5] = '...#.#..'; state.map[6] = '...###..';
  state.enemies = []; state.items=[];
  const restart = act(state,{type:'wait'});
  assert.equal(restart.turns,0); assert.equal(restart.floor,0); assert.equal(restart.captures,0); assert.equal(restart.hits,0);
  assert.equal(restart.player.piece,daily.playerPiece);
  assert.ok(restart.events.some((event) => event.type==='restart'));
  assert.equal(validateSave(restart,daily.date),true);
  assert.equal(restart.tries,2);
  assert.equal(getShareText(restart).split('\n')[1], '🟥 ·');
});



test('capture-all requires all eight identical pawns, including promoted members, before showing stairs', () => {
  const state = scenario('rook',0,6); state.objective.piece='pawn'; state.powers.freeze=20;
  state.enemies = Array.from({length:8},(_,x) => ({...monster(`pawn-${x}`,'pawn',x,4), palette:'ice'}));
  state.enemies[5].piece='queen'; state.enemies[5].promoted=true;
  let current=state;
  for (let x=0;x<8;x++) {
    current=act(current,move(x,4));
    assert.equal(current.captures,x+1);
    assert.equal(current.exit.open,x===7);
    assert.equal(current.objective.complete,x===7);
    if(x<7) assert.equal(act(current,{type:'descend'}),current);
  }
  const departed=act(current,{type:'descend'});
  assert.equal(departed.floor,1);
  assert.equal(departed.records[0].grade,'bronze','required captures alone are not extra captures');
  assert.equal(departed.turns,8,'clicking the stairs does not spend another move');
});


test('the public API ignores edited daily metadata and binds saves to the requested profile', () => {
  const expected = createGame(daily);
  const edited = structuredClone(daily);
  edited.seed = 0; edited.dungeonSeed = 0; edited.playerPiece = 'king'; edited.playerColor = 'black';
  edited.targets = ['king', 'king', 'king']; edited.legacyTurnOrder = true;
  assert.deepEqual(createGame(edited), expected);
  const alternate = getDaily(daily.date, { difficulty: 'gentle' });
  const state = createGame(alternate);
  assert.equal(validateSave(state, state.date), false);
  assert.equal(validateSave(state, state.date, { difficulty: 'gentle' }), true);
});

test('restarting a floor returns to its arrival state without costing a life or a try', () => {
  const withoutMessage = ({ message, events, ...rest }) => rest;
  let state = createGame(daily);
  const fresh = state;
  const arrivals = [fresh];
  for (const action of daily.generation.certificate.actions) {
    const next = act(state, action);
    if (next.floor !== state.floor) arrivals.push(next);
    state = next;
    if (state.status !== 'playing') break;
    assert.equal(validateSave(state, daily.date), true);
    const reset = resetFloor(state);
    assert.equal(validateSave(reset, daily.date), true, `reset on floor ${state.floor} after move ${state.turns}`);
    const { restartedMoves, unmasked, ...rest } = reset;
    assert.deepEqual(withoutMessage(rest), withoutMessage(arrivals[state.floor]));
    // Monsters unmasked before the restart stay unmasked.
    assert.deepEqual(unmasked, state.unmasked);
    // The moves already spent on the floor keep counting.
    assert.equal(restartedMoves, floorScoredMoves(state) || undefined);
    assert.equal(floorScoredMoves(reset), floorScoredMoves(state));
    assert.match(reset.message, new RegExp(`^Floor ${state.floor + 1} reset`));
  }
  assert.equal(state.status, 'won');
  assert.equal(resetFloor(state), state);
  assert.equal(arrivals.length, 3);

  // Captures on a floor keep counting after a restart; earlier attempts are still counted, never added to.
  const hurt = structuredClone(arrivals[1]);
  hurt.hits += 2; hurt.replayUnlocked = true; hurt.tries = 3;
  const restored = resetFloor(hurt);
  assert.equal(restored.hits, arrivals[1].hits);
  assert.equal(restored.restartedMoves, floorScoredMoves(hurt));
  assert.equal(floorScoredMoves(restored), floorScoredMoves(hurt));
  assert.equal(restored.tries, 3);
  assert.equal(restored.replayUnlocked, true);

  // A snapshot from another floor, or a doctored one, is not a valid save.
  const tampered = structuredClone(arrivals[1]);
  tampered.floorSnapshot = structuredClone(fresh.floorSnapshot);
  assert.equal(validateSave(tampered, daily.date), false);
  const richer = structuredClone(arrivals[1]);
  richer.floorSnapshot.gold += 5;
  assert.equal(validateSave(richer, daily.date), false);
  // Saves from before floor restarts still load; they simply cannot restart a floor.
  const legacy = structuredClone(arrivals[1]); delete legacy.floorSnapshot;
  assert.equal(validateSave(legacy, daily.date), true);
  assert.equal(resetFloor(legacy), legacy);
});

test('only optional residents pay gold; challenge pieces pay nothing and the ledger rejects forged gold', () => {
  const state = scenario('rook'); state.objective = {piece:'king',complete:false};
  state.enemies = [monster('bonus','knight',4,5), monster('other','king',0,0)];
  const bonus = act(state, move(4,5));
  assert.equal(bonus.captures, 1); assert.equal(bonus.gold, 1); assert.equal(bonus.paidCaptures, 1); assert.match(bonus.message, /\+1 gold/);
  const challenge = scenario('rook'); challenge.objective = {piece:'king',complete:false};
  challenge.enemies = [monster('target','king',4,5), monster('other','king',0,0)];
  const target = act(challenge, move(4,5));
  assert.equal(target.captures, 1); assert.equal(target.gold, 0); assert.equal(target.paidCaptures, 0); assert.doesNotMatch(target.message, /gold/);
});

test('certified routes keep a valid ledger where only coins and optional captures add gold', () => {
  const daily = getDaily('2026-11-10');
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) {
    state = act(state, action);
    assert.ok(state.paidCaptures <= 2 * (state.floor + 1));
    assert.equal(validateSave(state, state.date), true);
    if (state.gold > 0) {
      const forged = structuredClone(state); forged.gold++;
      assert.equal(validateSave(forged, forged.date), false, 'one extra gold must not validate');
    }
  }
  assert.equal(state.status, 'won');
  assert.ok(state.gold < state.treasure + state.captures, 'challenge captures must not have paid out');
});

test('an in-progress save from the old every-capture rule keeps its gold and stays valid under the new rule', () => {
  const daily = getDaily('2026-11-06');
  let state = createGame(daily);
  const actions = daily.generation.certificate.actions;
  const firstStairs = actions.findIndex((action) => action.type === 'descend');
  for (const action of actions.slice(0, firstStairs)) state = act(state, action);
  const legacy = structuredClone(state); delete legacy.paidCaptures; legacy.gold = legacy.treasure + legacy.captures;
  // Old-rule saves predate fork and combo bonuses.
  legacy.feats = legacy.feats.filter((feat) => !['fork', 'combo'].includes(feat.kind));
  assert.equal(validateSave(legacy, legacy.date), true);
  let resumed = legacy;
  for (const action of actions.slice(firstStairs)) {
    resumed = act(resumed, action);
    assert.equal(validateSave(resumed, resumed.date), true);
  }
  let current = state;
  for (const action of actions.slice(firstStairs)) current = act(current, action);
  assert.equal(resumed.status, 'won');
  assert.equal(resumed.gold - current.gold, legacy.gold - state.gold, 'old-rule gold is kept; later challenge captures add none');
  const late = createGame(getDaily('2026-11-07')); late.gold = 1; late.captures = 0;
  assert.equal(validateSave(late, late.date), false);
});

test('running out of legal moves restarts the dungeon and counts another try, like losing every life', () => {
  const state = scenario('pawn');
  state.playerColor = 'white'; state.awaitingPlayer = false; state.player.moved = true;
  state.map = ['........', '........', '........', '........', '....#...', '........', '........', '........'];
  state.enemies = [monster('far', 'king', 0, 0)]; state.powers.freeze = 5;
  const trapped = act(state, move(4, 5));
  assert.equal(trapped.status, 'playing');
  assert.deepEqual(trapped.events.map((event) => event.type), ['restart']);
  assert.match(trapped.message, /No legal moves/);
  assert.equal(trapped.tries, 2); assert.equal(trapped.replayUnlocked, true);
  assert.equal(trapped.floor, 0); assert.equal(trapped.turns, 0);
  assert.equal(validateSave(trapped, trapped.date), true);
  assert.equal(getShareText(trapped).split('\n')[1], '🟥 ·');
});

test('an older save that ended trapped can be retried, counting as another try', () => {
  const lost = createGame(daily); lost.status = 'lost'; lost.message = 'No legal moves. The dungeon has the last word.';
  const retried = retryLostRun(lost);
  assert.equal(lost.status, 'lost', 'the old save is not mutated');
  assert.equal(retried.status, 'playing'); assert.equal(retried.tries, 2); assert.equal(retried.floor, 0);
  assert.equal(validateSave(retried, retried.date), true);
  const playing = createGame(daily);
  assert.equal(retryLostRun(playing), playing);
});

test('leftover hourglass moves stay on their floor, but hourglasses older saves bought carry to the next', () => {
  const state = scenario('queen');
  state.enemies = [monster('key', 'king', 4, 2), monster('other', 'pawn', 0, 7)];
  state.powers.freeze = 4; state.powers.shield = 1; state.powers.magnet = 1;
  const cleared = act(state, move(4, 2));
  assert.equal(cleared.exit.open, true); assert.equal(cleared.powers.freeze, 3);
  const leftover = act(cleared, {type:'descend'});
  assert.equal(leftover.floor, 1);
  assert.deepEqual(leftover.powers, { shield: 1, freeze: 0, magnet: 1, pin: 0, leap: 0, takeback: 0 });
  cleared.gold = 2;
  assert.equal(act(cleared, {type:'buy', id:'freeze'}), cleared, 'the shop no longer sells hourglasses');
  // A save from when it did keeps the hourglass it bought.
  const bought = structuredClone(cleared); bought.gold = 0; bought.purchases.push('freeze'); bought.powers.freeze = 6;
  assert.equal(act(bought, {type:'descend'}).powers.freeze, 3, 'only the bought hourglass carries');
  bought.powers.freeze = 1;
  assert.equal(act(bought, {type:'descend'}).powers.freeze, 1, 'moves already spent are not refunded');
});

test("a monster's reply keeps the player's line from the same move in notes", () => {
  const state = scenario('rook');
  const pawn = { ...monster('p', 'pawn', 4, 3), name: 'Pip' };
  const rook = { ...monster('r', 'rook', 0, 3, { x: 4, y: 3 }), name: 'Rooky' };
  state.enemies = [pawn, rook, { ...monster('k', 'king', 7, 0), name: 'Kingo' }];
  const next = act(state, move(4, 3));
  assert.deepEqual(next.notes, ['Pip unmasked — a pawn! +1 gold.']);
  assert.match(next.message, /^Rooky .*\(\+1 move\)\.$/);
  // The next quiet move clears the notes and leaves no empty field behind.
  const quiet = act(next, move(4, 4));
  assert.equal(quiet.notes, undefined);
  const fresh = createGame(daily);
  assert.ok(validateSave({ ...fresh, notes: ['Pip captured.'] }, daily.date, daily));
  assert.ok(!validateSave({ ...fresh, notes: [] }, daily.date, daily));
  assert.ok(!validateSave({ ...fresh, notes: [''] }, daily.date, daily));
});
