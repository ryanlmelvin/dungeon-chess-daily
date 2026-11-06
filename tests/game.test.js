// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, dangerTiles, getDaily, getShareText, legalMoves, PIECES, PIECE_COUNTS, PIECE_LIVES, POWERUPS, validateSave, walkable } from '../src/game.js';

const daily = getDaily('2026-11-05');
const move = (x, y) => ({ type: 'move', x, y });
const hasMove = (state, x, y) => legalMoves(state).some((tile) => tile.x === x && tile.y === y);
function scenario(piece = 'rook', x = 4, y = 6) {
  const state = createGame(daily);
  state.player = { piece, x, y, hp: 1, maxHp: 1, moved: false };
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

test('daily selections cover all six pieces and all 26 species without duplicate daily species', () => {
  const counts = Object.fromEntries(PIECES.map((piece) => [piece, 0]));
  const species = new Set();
  for (let day = 0; day < 1200; day++) {
    const issue = getDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    counts[issue.playerPiece]++;
    assert.equal(new Set(issue.species.map((entry) => entry.id)).size, 9);
    issue.species.forEach((entry) => { species.add(entry.id); assert.ok(PIECES.includes(entry.piece)); });
    assert.equal(issue.theme.stories[0].species, issue.species[1].id);
    assert.equal(issue.theme.stories[1].species, issue.species[2].id);
  }
  assert.equal(species.size, 26);
  for (const count of Object.values(counts)) assert.ok(count > 130 && count < 270, 'uniform selection should not systematically favor a piece');
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
  state.enemies = [monster('front', 'king', 4, 5), monster('diagonal', 'king', 3, 5)];
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

test('a pawn promotes on the far rank and keeps its queen moves downstairs', () => {
  const state = scenario('pawn', 4, 1);
  state.enemies = [monster('last', 'king', 3, 0)];
  const promoted = act(state, move(3, 0));
  assert.equal(promoted.player.piece, 'queen');
  assert.ok(promoted.events.some((event) => event.type === 'promotion'));
  const nextRoom = act(promoted, {type:'descend'});
  assert.equal(nextRoom.floor, 1);
  assert.equal(nextRoom.player.piece, 'queen');
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
  assert.equal(next.player.hp, 1, 'a captured monster must never get a response');
  assert.equal(next.enemies.length, 1);
  assert.equal(next.enemies[0].id, 'survivor');
  assert.deepEqual({ x: next.enemies[0].x, y: next.enemies[0].y }, { x: 4, y: 6 });
  assert.equal(next.events[0].type, 'capture');
  assert.equal(next.events[1].type, 'move');
  assert.ok(next.events.findIndex((event) => event.type === 'miss') > 1);
});

test('ranged captures warn for a full turn along their entire firing path', () => {
  const state = scenario('king');
  state.enemies = [monster('shooter', 'rook', 4, 0)];
  const warning = act(state, move(4, 5));
  assert.equal(warning.player.hp, 1, 'a newly announced capture cannot happen immediately');
  assert.equal(warning.enemies[0].phase, 'aim');
  assert.deepEqual(dangerTiles(warning), Array.from({ length: 7 }, (_, i) => ({ x: 4, y: i + 1 })));
  warning.player.hp = 2; warning.player.maxHp = 2;
  const caught = act(warning, move(4, 4));
  assert.equal(caught.status, 'playing');
  assert.equal(caught.player.hp, 1);
  assert.deepEqual({ x: caught.enemies[0].x, y: caught.enemies[0].y }, { x: 4, y: 0 }, 'a surviving player holds its square');
  const dodged = act(warning, move(5, 5));
  assert.equal(dodged.player.hp, 2);
  assert.deepEqual({ x: dodged.enemies[0].x, y: dodged.enemies[0].y }, { x: 4, y: 5 }, 'an escaped attack commits to the old target');
  assert.deepEqual(dangerTiles(dodged), []);
});

test('enemy pawns cannot capture forward, and sequential enemy moves cannot share a square', () => {
  const pawn = scenario('king', 4, 5);
  pawn.enemies = [monster('pawn', 'pawn', 4, 3)];
  const next = act(pawn, move(4, 4));
  assert.equal(next.player.hp, 1);
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

test('the 60-move deadline ends play, but final-move objective capture still permits extraction', () => {
  const state = scenario('rook');
  state.turns = 59;
  assert.equal(act(state, move(4, 5)).status, 'lost');
  state.floor = 2; state.enemies = [monster('last', 'king', 4, 4)];
  const solved = act(state, move(4, 4));
  assert.equal(solved.status, 'playing');
  assert.equal(solved.turns, 60);
  assert.equal(legalMoves(solved).length, 0);
  const extracted = act(solved, { type: 'descend' });
  assert.equal(extracted.status, 'won');
  assert.equal(extracted.turns, 60);
  assert.equal(act(extracted, move(4, 1)), extracted);
});

test('share text contains results, not piece, species or route spoilers', () => {
  const state = createGame(daily);
  state.status = 'won'; state.records = [{ floor: 0, grade: 'gold' }, { floor: 1, grade: 'silver' }, { floor: 2, grade: 'bronze' }];
  const share = getShareText(state);
  assert.match(share, /Dungeon Chess Daily/);
  assert.match(share, /🟨⬜🟫/u);
  assert.match(share, /dungeon-chess-daily/);
  for (const spoiler of [state.player.piece, ...state.species.map((entry) => entry.name), state.theme.headline]) assert.ok(!share.includes(spoiler));
});

test('save validation accepts real chess runs and rejects incompatible or corrupt exports', () => {
  const state = createGame(daily);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), daily.date), true);
  assert.equal(validateSave(state, '2026-11-06'), false);
  for (const mutate of [
    (save) => { save.schema = 1; }, (save) => { save.player.piece = 'dragon'; },
    (save) => { save.player.hp = 99; }, (save) => { save.enemies[0].piece = 'dragon'; },
    (save) => { save.enemies[0].x = 99; }, (save) => { save.items.push(save.items[0]); },
    (save) => { save.records = [{ floor: 0, turns: 1, captures: 0, treasure: 0, grade: 'gold' }]; },
    (save) => { save.status = 'won'; }, (save) => { save.exit.open = true; },
  ]) {
    const bad = structuredClone(state); mutate(bad);
    assert.equal(validateSave(bad, daily.date), false);
  }
});

function metric(state, target) {
  const dx = Math.abs(state.player.x - target.x), dy = Math.abs(state.player.y - target.y), piece = state.player.piece;
  if (!dx && !dy) return 0;
  if (piece === 'queen') return !dx || !dy || dx === dy ? 1 : 2;
  if (piece === 'rook') return !dx || !dy ? 1 : 2;
  if (piece === 'bishop') return (dx + dy) % 2 ? 8 : dx === dy ? 1 : 2;
  if (piece === 'king') return Math.max(dx, dy);
  if (piece === 'pawn') return dy + (dx ? 3 : 0);
  return Math.ceil(Math.max(dx, dy) / 2) + ((dx + dy) % 2);
}
function score(state) {
  if (state.status === 'lost' || state.events.some((event) => event.type === 'restart')) return -100000;
  if (state.status === 'won') return 100000;
  const targets = state.enemies.filter((foe) => foe.role === state.objective.piece);
  const steps = state.exit.open ? 0 : Math.min(...targets.map((target) => metric(state, target)));
  return state.floor * 1000 + (state.exit.open ? 800 : 0) + state.captures * 25 + state.treasure * 3 + state.player.hp * 10 - state.turns * 0.7 - steps * 5
    + (state.player.piece === 'queen' && state.startingPiece === 'pawn' ? 20 : 0) + (state.player.piece === 'pawn' ? (6 - state.player.y) * 3 : 0);
}
function choices(state) {
  if (state.exit.open) return [act(state, { type: 'descend' })];
  return legalMoves(state).map((tile) => act(state, move(tile.x, tile.y)))
    .filter((next) => next.status !== 'lost' && !next.events.some((event) => event.type === 'restart'));
}
function positionKey(state) {
  return JSON.stringify([state.floor, state.player.x, state.player.y, state.player.piece, state.player.hp, state.enemies.map((foe) => [foe.id, foe.x, foe.y, foe.phase, foe.target]), state.items]);
}
function choose(state, visits) {
  return choices(state).map((next) => {
    const future = choices(next);
    const value = future.length ? Math.max(...future.map(score)) : score(next);
    return { next, value: value + 0.05 * score(next) - (visits.get(positionKey(next)) ?? 0) * 25 };
  }).sort((a, b) => b.value - a.value)[0]?.next;
}

function assertInitialArmy(state) {
  const counts = Object.fromEntries(PIECES.map((piece) => [piece, state.enemies.filter((foe) => foe.role === piece).length]));
  for (const piece of PIECES) assert.ok(counts[piece] <= PIECE_COUNTS[piece], `${state.date} floor ${state.floor}: too many native ${piece}s`);
  assert.equal(counts[state.objective.piece], PIECE_COUNTS[state.objective.piece]);
  assert.equal(state.enemies.length, PIECE_COUNTS[state.objective.piece] + 2);
  assert.equal(new Set(state.enemies.map((foe) => foe.role)).size, 3);
  assert.equal(new Set(state.enemies.map((foe) => `${foe.x},${foe.y}`)).size, state.enemies.length);
  for (const piece of PIECES) {
    const group = state.enemies.filter((foe) => foe.role === piece);
    if (group.length) assert.equal(new Set(group.map((foe) => `${foe.species}:${foe.palette}`)).size, 1);
  }
  assert.ok(state.enemies.every((foe) => walkable(state,foe.x,foe.y)));
  assert.ok(state.enemies.every((foe) => !state.items.some((item) => item.x===foe.x && item.y===foe.y)));
  if (state.startingPiece==='bishop' && state.objective.piece==='bishop') assert.ok(state.enemies.filter((foe) => foe.role==='bishop').every((foe) => (foe.x+foe.y)%2===0));
}

test('100 consecutive dates have survivable three-room solutions and valid saves', () => {
  for (let day = 0; day < 100; day++) {
    let state = createGame(getDaily(new Date(Date.UTC(2026, 10, 5 + day))));
    assertInitialArmy(state);
    const visits = new Map();
    while (state.status === 'playing') {
      visits.set(positionKey(state), (visits.get(positionKey(state)) ?? 0) + 1);
      const next = choose(state, visits);
      assert.ok(next, `${state.date} needs a safe continuation on move ${state.turns}`);
      if (next.floor !== state.floor) assertInitialArmy(next);
      state = next;
      assert.equal(validateSave(state, state.date), true, `${state.date} save after move ${state.turns}`);
    }
    assert.equal(state.status, 'won', state.date);
    assert.ok(state.turns <= 60, state.date);
    assert.equal(state.records.length, 3);
    assert.ok(state.records.every((record) => record.captures >= PIECE_COUNTS[state.targets[record.floor]]));
  }
});

test('objectives, palettes, obstacles and mixed residents vary deterministically across dates', () => {
  const palettes = new Set(), layouts = new Set();
  for (let day = 0; day < 100; day++) {
    const issue = getDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    assert.equal(issue.targets[2], 'king');
    assert.notEqual(issue.targets[0], issue.targets[1]);
    assert.ok(!issue.targets.slice(0, 2).includes('king'));
    const state = createGame(issue);
    assert.equal(state.enemies.length, PIECE_COUNTS[state.objective.piece] + 2);
    assert.equal(new Set(state.enemies.map((enemy) => enemy.species)).size, 3);
    assert.equal(state.props.length, 7);
    assert.equal(state.map.join('').split('#').length - 1, 7);
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
  assert.ok(layouts.size > 50);
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

test('coins and captures buy powerups without spending a move; invalid purchases are inert', () => {
  const state = scenario('rook'); state.items = [{x:4,y:5,type:'coin'}]; state.gold = 2;
  const earned = act(state, move(4,5));
  assert.equal(earned.gold, 3); assert.equal(earned.treasure, 1);
  const ward = act(earned, {type:'buy',id:'shield'});
  assert.equal(ward.gold, 0); assert.equal(ward.powers.shield, 1); assert.equal(ward.turns, earned.turns);
  assert.deepEqual(ward.purchases, ['shield']);
  assert.equal(act(ward, {type:'buy',id:'shield'}), ward);
  assert.equal(act(ward, {type:'buy',id:'unknown'}), ward);
  assert.ok(POWERUPS.every((entry) => entry.name && entry.description && entry.cost > 0));
});

test('wards block life loss, freeze pauses committed attacks and magnets collect nearby coins', () => {
  const state = scenario('king',4,5); state.player.hp = 2; state.powers.shield = 1;
  state.enemies = [monster('rook','rook',4,0,{x:4,y:4})];
  const blocked = act(state, move(4,4));
  assert.equal(blocked.player.hp,2); assert.equal(blocked.powers.shield,0);
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

test('piece lives are preserved and exhaustion restarts the same deterministic edition', () => {
  assert.equal(createGame(daily).player.hp, PIECE_LIVES[daily.playerPiece]);
  const state = createGame(daily);
  state.player = {piece:'king',x:4,y:5,hp:1,maxHp:1,moved:true}; state.map = Array(8).fill('........');
  state.enemies = [monster('rook','rook',4,0,{x:4,y:4})]; state.items=[];
  const restart = act(state,move(4,4));
  assert.equal(restart.turns,0); assert.equal(restart.floor,0); assert.equal(restart.captures,0);
  assert.equal(restart.player.hp,PIECE_LIVES[daily.playerPiece]);
  assert.ok(restart.events.some((event) => event.type==='restart'));
  assert.equal(validateSave(restart,daily.date),true);
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
