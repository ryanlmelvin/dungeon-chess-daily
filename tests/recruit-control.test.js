// SPDX-License-Identifier: GPL-3.0-only
// Manual recruit control: a move or wait may carry the recruit's order for that
// turn, a square or 'hold'. Without one the recruit's own AI moves it (Auto).
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, getDaily, legalMoves, recruitChoice, validateSave } from '../src/game.js';
import { getRawDaily } from '../src/edition.js';
import { verifyWinningRoute } from '../src/fairness.js';
import { botRun } from '../src/bot.js';
import { decodeRoute, encodeRoute } from '../src/route-code.js';
import { goldAtRisk } from '../src/cave-in.js';

const move = (x, y, recruit) => (recruit === undefined ? { type: 'move', x, y } : { type: 'move', x, y, recruit });
const wait = (recruit) => (recruit === undefined ? { type: 'wait' } : { type: 'wait', recruit });
const at = (unit) => [unit.x, unit.y];
const types = (state) => state.events.map((event) => event.type);
// Everything a move said, oldest first (later phases file earlier lines in notes).
const said = (state) => [...(state.notes ?? []), state.message].join(' ');
function dailyFor(piece) {
  for (let day = 0; day < 365; day++) {
    const daily = getRawDaily(new Date(Date.UTC(2026, 10, 5 + day)));
    if (daily.playerPiece === piece && daily.playerColor === 'white') return daily;
  }
  throw Error(`No ${piece} edition found`);
}
// An empty room on a plain day. Kings are no longer a daily piece; a king borrows a rook day.
function scenario(piece = 'rook', { color = 'white', x = 4, y = 6 } = {}) {
  const state = createGame(dailyFor(piece === 'king' ? 'rook' : piece));
  state.playerColor = color; state.awaitingPlayer = false;
  Object.assign(state.player, { x, y, moved: true });
  if (piece === 'king') { state.startingPiece = 'king'; state.player.piece = 'king'; state.player.hp = state.player.maxHp = 1; }
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.enemies = []; state.companion = null;
  delete state.modifier; delete state.ice; delete state.reinforcements; delete state.reinforcementsSkipped;
  // Knights are the challenge here, so other monsters are decoys.
  state.objective = { piece: 'knight', complete: false };
  return state;
}
const foe = (id, piece, x, y, extra = {}) => ({ id, piece, role: piece, species: 'bat', palette: 'ice', name: 'Ice bat', x, y, moved: false, phase: 'ready', target: null, intent: [], ...extra });
const ally = (piece, x, y) => ({ piece, basePiece: piece, x, y, moved: true, sharing: false });

test('an order sends the recruit to the chosen square, or holds it, on a move or a wait', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 3;
  state.companion = ally('queen', 0, 7); state.enemies = [foe('decoy', 'king', 0, 0)];
  // Auto takes the decoy; the order sends the queen along the back row instead.
  const auto = act(state, move(7, 6));
  assert.deepEqual(at(auto.companion), [0, 0]);
  const sent = act(state, move(7, 6, { x: 3, y: 7 }));
  assert.deepEqual(at(sent.companion), [3, 7]);
  assert.deepEqual(sent.events.find((event) => event.type === 'companion-move'), { type: 'companion-move', piece: 'queen', from: { x: 0, y: 7 }, x: 3, y: 7 });
  assert.equal(sent.captures, 0); assert.equal(sent.turns, state.turns + 1);
  const held = act(state, move(7, 6, 'hold'));
  assert.deepEqual(at(held.companion), [0, 7]);
  assert.ok(types(held).includes('companion-phase')); assert.ok(!types(held).includes('companion-move'));
  assert.equal(held.turns, state.turns + 1);
  const waited = act(state, wait({ x: 0, y: 3 }));
  assert.deepEqual(at(waited.companion), [0, 3]); assert.deepEqual(at(waited.player), [7, 7]);
  assert.deepEqual(at(act(state, wait('hold')).companion), [0, 7]);
  // Orders replay deterministically.
  assert.deepEqual(act(state, move(7, 6, { x: 3, y: 7 })), sent);
});

test('orders the recruit can’t carry out, and malformed ones, are no action', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 3;
  state.companion = ally('bishop', 2, 5); state.enemies = [foe('block', 'king', 4, 3)];
  state.map[6] = '.#......';
  for (const recruit of [
    { x: 2, y: 4 }, // not a bishop move
    { x: 5, y: 2 }, // beyond the monster on its diagonal
    { x: 0, y: 7 }, // past the wall
    { x: 2, y: 5 }, // its own square: holding is spelled 'hold'
    { x: 8, y: 2 }, { x: -1, y: 4 }, { x: 1.5, y: 2 }, { x: '3', y: '4' }, null, 'stay', 'HOLD', 0, [], true,
  ]) {
    assert.equal(act(state, move(7, 6, recruit)), state, JSON.stringify(recruit));
    assert.equal(act(state, wait(recruit)), state, JSON.stringify(recruit));
  }
  // The player's own square is never the recruit's: (4,7) is on its diagonal.
  assert.equal(act(state, move(4, 7, { x: 4, y: 7 })), state);
  assert.deepEqual(at(act(state, move(4, 7, { x: 3, y: 6 })).companion), [3, 6]);
  // A legal capture of a decoy pays like the recruit's captures always have.
  const taken = act(state, move(7, 6, { x: 4, y: 3 }));
  assert.deepEqual(at(taken.companion), [4, 3]);
  assert.equal(taken.captures, 1); assert.equal(taken.gold, state.gold + 1); assert.equal(taken.paidCaptures, state.paidCaptures + 1);
  assert.ok(types(taken).includes('companion-capture'));
  // With no recruit at your side only 'hold' makes sense.
  const alone = scenario('rook', { x: 7, y: 7 }); alone.powers.freeze = 3;
  assert.equal(act(alone, move(7, 6, { x: 0, y: 0 })), alone);
  assert.deepEqual(at(act(alone, move(7, 6, 'hold')).player), [7, 6]);
});

test('an ordered recruit may capture the challenge piece, and it counts toward the floor', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 3;
  state.companion = ally('rook', 0, 7);
  state.enemies = [foe('k1', 'knight', 0, 2), foe('k2', 'knight', 5, 2)];
  // On Auto it never would.
  const auto = act(state, move(7, 6));
  assert.equal(auto.captures, 0); assert.equal(auto.enemies.length, 2);
  const first = act(state, move(7, 6, { x: 0, y: 2 }));
  assert.equal(first.captures, 1); assert.equal(first.gold, state.gold, 'targets pay nothing');
  assert.equal(first.exit.open, false); assert.equal(first.message, 'Ice bat captured. Keep hunting.');
  const second = act(first, move(7, 5, { x: 5, y: 2 }));
  assert.equal(second.captures, 2); assert.equal(second.enemies.length, 0);
  assert.equal(second.objective.complete, true); assert.equal(second.exit.open, true);
  // The scored move count stops on the recruit's capture as on yours.
  assert.equal(second.objective.moves, 2);
  // The completion line is filed in notes; the cave-in's crack line (src/cave-in.js) follows it in the log.
  assert.ok((second.notes ?? []).includes('You completed the challenge ✓ in 2 moves. Your score is locked in: explore for gold or take the stairs. Your recruit will automatically watch your back while you explore.'));
  assert.match(second.message, /^The ceiling starts to crack!/);
});

// The 2026-11-13 certificate played to the last floor, with the monsters frozen.
function lastFloor() {
  const daily = getDaily('2026-11-13');
  let state = createGame(daily);
  for (const action of daily.generation.certificate.actions) { if (state.floor === 2) break; state = act(state, action); }
  assert.equal(state.floor, 2);
  state.powers.freeze = 6;
  return state;
}

test('an ordered recruit may capture the last floor’s king; the stairs then win the run, and every save validates', () => {
  let state = lastFloor();
  const pickup = state.items.find((item) => item.type === 'companion');
  assert.ok(legalMoves(state).some((tile) => tile.x === pickup.x && tile.y === pickup.y));
  state = act(state, move(pickup.x, pickup.y, 'hold'));
  assert.equal(state.companion.basePiece, pickup.piece); assert.equal(state.companion.sharing, true);
  assert.match(state.message, /joins you this floor\. You move it after each of your moves, and it can capture the king too\./);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)), state.date), true);
  // Stand the king on a square the recruit can reach.
  const square = recruitChoice(state, wait()).moves.find((tile) => !tile.capture);
  const king = state.enemies.find((monster) => monster.role === 'king');
  Object.assign(king, { x: square.x, y: square.y });
  assert.ok(recruitChoice(state, wait()).moves.some((tile) => tile.x === square.x && tile.y === square.y && tile.capture));
  const taken = act(state, wait({ x: square.x, y: square.y }));
  assert.ok(!taken.enemies.some((monster) => monster.role === 'king'));
  assert.equal(taken.objective.complete, true); assert.equal(taken.exit.open, true);
  assert.equal(validateSave(JSON.parse(JSON.stringify(taken)), taken.date), true);
  const won = act(taken, { type: 'descend' });
  assert.equal(won.status, 'won');
  assert.equal(validateSave(JSON.parse(JSON.stringify(won)), won.date), true);
});

test('as black, the order is checked on the board the monsters’ first move left', () => {
  const state = scenario('king', { color: 'black', x: 7, y: 7 });
  state.objective = { piece: 'queen', complete: false };
  state.companion = ally('rook', 0, 4);
  // This rook's committed lane misses the player, so it steps to (2,4), across the recruit's row.
  state.enemies = [foe('lane', 'rook', 2, 0, { phase: 'aim', target: { x: 2, y: 4 }, intent: [1, 2, 3, 4].map((y) => ({ x: 2, y })) }), foe('far', 'queen', 7, 0)];
  const choice = recruitChoice(state, move(6, 7));
  assert.deepEqual(at(choice.board.enemies.find((monster) => monster.id === 'lane')), [2, 4]);
  assert.equal(choice.board.events[choice.phase].type, 'companion-phase');
  const row = choice.moves.filter((tile) => tile.y === 4).map((tile) => [tile.x, tile.capture]);
  assert.deepEqual(row, [[1, false], [2, true]]);
  // (5,4) was open before the monsters moved, not after.
  assert.equal(act(state, move(6, 7, { x: 5, y: 4 })), state);
  const next = act(state, move(6, 7, { x: 2, y: 4 }));
  const order = types(next);
  assert.ok(order.indexOf('enemy-phase') < order.indexOf('move') && order.indexOf('move') < order.indexOf('companion-capture'));
  assert.deepEqual(at(next.companion), [2, 4]); assert.equal(next.captures, 1); assert.equal(next.turns, state.turns + 1);
});

test('the turn you recruit, the new recruit may stay on your square or move off it', () => {
  const state = scenario('rook'); state.powers.freeze = 3;
  state.items = [{ type: 'companion', piece: 'bishop', x: 4, y: 5 }]; state.enemies = [foe('far', 'queen', 0, 0)];
  const choice = recruitChoice(state, move(4, 5));
  assert.deepEqual(at(choice.board.companion), [4, 5]);
  assert.ok(choice.moves.every((tile) => !(tile.x === 4 && tile.y === 5)));
  const held = act(state, move(4, 5, 'hold'));
  assert.deepEqual(at(held.companion), [4, 5]); assert.equal(held.companion.sharing, true);
  assert.ok(types(held).includes('companion-recruit') && !types(held).includes('companion-move'));
  const sent = act(state, move(4, 5, { x: 2, y: 3 }));
  assert.deepEqual(at(sent.companion), [2, 3]); assert.equal(sent.companion.sharing, false);
  // The joining line says who moves it; Auto keeps its own.
  assert.equal(sent.message, 'A bishop joins you this floor. You move it after each of your moves, and it can capture knights too.');
  assert.equal(act(state, move(4, 5)).message, 'A bishop joins you this floor. It cannot capture knights.');
  // A recruit you stand on again shares your square while it holds.
  const back = act(sent, move(2, 5, 'hold'));
  const shared = act(back, move(2, 3, 'hold'));
  assert.equal(shared.companion.sharing, true);
});

test('a close-range hit that turn still leaves the recruit its order; a run-ending one ends the turn there', () => {
  const state = scenario('rook', { x: 7, y: 7 });
  state.companion = ally('rook', 0, 6); state.enemies = [foe('guard', 'king', 6, 4)];
  // Ending next to the monster king costs a life at once; no monster phase follows.
  const hit = act(state, move(7, 5, { x: 6, y: 6 }));
  assert.equal(hit.player.hp, state.player.hp - 1);
  assert.deepEqual(at(hit.companion), [6, 6]);
  const order = types(hit);
  assert.ok(order.indexOf('close-capture') < order.indexOf('companion-phase'));
  assert.ok(!order.includes('enemy-phase'));
  // The preview shows the hit already taken.
  const choice = recruitChoice(state, move(7, 5));
  assert.equal(choice.board.player.hp, state.player.hp - 1);
  // With one life left the run restarts before the recruit's phase, so the order goes unused.
  const last = structuredClone(state); last.player.hp = 1;
  assert.equal(recruitChoice(last, move(7, 5)), null);
  const restarted = act(last, move(7, 5, { x: 6, y: 6 }));
  assert.ok(types(restarted).includes('restart')); assert.equal(restarted.companion, null);
});

test('castling is the recruit’s move: an order to move it again is no action', () => {
  const state = scenario('king'); state.companion = ally('rook', 7, 6); state.enemies = [foe('far', 'king', 0, 0)];
  assert.equal(recruitChoice(state, move(6, 6)), null);
  assert.equal(act(state, move(6, 6, { x: 5, y: 2 })), state);
  const castled = act(state, move(6, 6, 'hold'));
  assert.deepEqual(at(castled.player), [6, 6]); assert.deepEqual(at(castled.companion), [5, 6]);
  assert.deepEqual(castled, act(state, move(6, 6)));
});

test('a pawn recruit promotes when ordered onto the far rank, and on it before its first order', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 3;
  state.companion = ally('pawn', 3, 1); state.enemies = [foe('decoy', 'king', 4, 0), foe('target', 'knight', 0, 7)];
  assert.deepEqual(recruitChoice(state, move(7, 6)).moves, [{ x: 3, y: 0, capture: false }, { x: 4, y: 0, capture: true }]);
  const straight = act(state, move(7, 6, { x: 3, y: 0 }));
  assert.equal(straight.companion.piece, 'queen'); assert.equal(straight.companion.basePiece, 'pawn');
  assert.ok(types(straight).includes('companion-promotion'));
  // Recruited on the far rank, it chooses its first move as a queen.
  const far = scenario('queen', { x: 2, y: 1 }); far.powers.freeze = 3;
  far.items = [{ type: 'companion', piece: 'pawn', x: 2, y: 0 }]; far.enemies = [foe('target', 'knight', 7, 5)];
  const choice = recruitChoice(far, move(2, 0));
  assert.equal(choice.board.companion.piece, 'queen');
  assert.ok(choice.moves.some((tile) => tile.x === 7 && tile.y === 5 && tile.capture));
  const queen = act(far, move(2, 0, { x: 7, y: 5 }));
  assert.equal(queen.companion.piece, 'queen'); assert.equal(queen.captures, 1); assert.equal(queen.objective.complete, true);
});

test('recruit captures pay gold but never feed your combo; a fork it breaks still pays on your capture', () => {
  const state = scenario('rook', { x: 0, y: 7 }); state.powers.freeze = 6;
  state.companion = ally('rook', 7, 7);
  state.enemies = [foe('a', 'bishop', 0, 3), foe('b', 'bishop', 3, 7), foe('c', 'bishop', 7, 1), foe('target', 'knight', 5, 0)];
  // Your capture, then the recruit's: the combo counts only yours.
  const mine = act(state, move(0, 3, 'hold'));
  assert.equal(mine.combo, 1); assert.equal(mine.gold, state.gold + 1);
  const theirs = act(mine, move(1, 3, { x: 7, y: 1 }));
  assert.equal(theirs.captures, 2); assert.equal(theirs.gold, state.gold + 2); assert.equal(theirs.combo, 0);
  // A fork: your rook at (3,3) attacks (3,7) and (3,0). The recruit takes one at
  // once; taking the other on your next move still wins the fork.
  const forked = scenario('rook', { x: 0, y: 3 }); forked.powers.freeze = 6;
  forked.companion = ally('rook', 7, 7);
  forked.enemies = [foe('low', 'bishop', 3, 7), foe('high', 'bishop', 3, 0), foe('target', 'knight', 6, 2)];
  const set = act(forked, move(3, 3, { x: 3, y: 7 }));
  assert.deepEqual([...set.fork.ids].sort(), ['high', 'low']);
  assert.equal(set.captures, 1); assert.deepEqual(set.feats, []);
  const won = act(set, move(3, 0, 'hold'));
  assert.ok(types(won).includes('fork-won')); assert.deepEqual(won.feats, [{ floor: 0, kind: 'fork' }]);
  assert.equal(won.captures, 2); assert.equal(won.gold, set.gold + 1 + 2);
});

test('Take-back undoes the whole ordered turn, recruit move included', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 3; state.powers.takeback = 1;
  state.companion = ally('queen', 0, 7); state.enemies = [foe('decoy', 'king', 0, 0), foe('target', 'knight', 4, 3)];
  const played = act(state, move(7, 6, { x: 4, y: 3 }));
  assert.equal(played.objective.complete, true); assert.equal(played.captures, 1);
  const back = act(played, { type: 'takeback' });
  assert.deepEqual(at(back.player), [7, 7]); assert.deepEqual(at(back.companion), [0, 7]);
  assert.equal(back.captures, 0); assert.equal(back.objective.complete, false); assert.equal(back.powers.takeback, 0);
  assert.deepEqual(back.enemies, state.enemies);
});

test('recruitChoice previews the recruit’s squares without changing anything', () => {
  const state = scenario('rook', { x: 7, y: 7 });
  state.companion = ally('knight', 1, 6); state.enemies = [foe('target', 'knight', 3, 5), foe('decoy', 'bishop', 6, 0)];
  const before = structuredClone(state);
  const choice = recruitChoice(state, move(7, 6));
  assert.deepEqual(state, before);
  assert.deepEqual(at(choice.board.player), [7, 6]); assert.equal(choice.board.turns, state.turns + 1);
  // The challenge piece is on offer, and the monsters haven't answered yet.
  assert.ok(choice.moves.some((tile) => tile.x === 3 && tile.y === 5 && tile.capture));
  assert.ok(!choice.board.events.slice(choice.phase).some((event) => event.type === 'enemy-phase'));
  assert.deepEqual(choice.board.events.slice(choice.phase).map((event) => event.type), ['companion-phase']);
  // The ordered turn begins exactly like its preview.
  const played = act(state, move(7, 6, { x: 3, y: 5 }));
  assert.deepEqual(played.events.slice(0, choice.phase), choice.board.events.slice(0, choice.phase));
  // No recruit, no phase; an illegal move or another kind of action has none either.
  const alone = scenario('rook');
  assert.equal(recruitChoice(alone, move(4, 5)), null);
  assert.equal(recruitChoice(state, move(6, 5)), null);
  assert.equal(recruitChoice(state, { type: 'descend' }), null);
  assert.ok(recruitChoice(state, wait()).moves.length > 0);
});

// Certified routes leave the recruit on Auto. Since an order may name any legal
// square, a Manual player can always play exactly the move Auto would have.
test('Auto is unchanged: every recruit move on certified routes can be ordered by hand, to the same result', () => {
  const strip = ({ message, notes, ...rest }) => rest;
  let mirrored = 0;
  for (const date of ['2026-11-06', '2026-11-08', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-20']) {
    const daily = getDaily(date);
    let state = createGame(daily);
    for (const action of daily.generation.certificate.actions) {
      const auto = act(state, action);
      const phase = auto.events.findIndex((event) => event.type === 'companion-phase');
      if (phase >= 0) {
        const moved = auto.events.slice(phase).find((event) => event.type === 'companion-move');
        const order = moved ? { x: moved.x, y: moved.y } : 'hold';
        const choice = recruitChoice(state, action);
        assert.ok(order === 'hold' || choice.moves.some((tile) => tile.x === order.x && tile.y === order.y), `${date}: Auto's move is on offer`);
        assert.deepEqual(strip(act(state, { ...action, recruit: order })), strip(auto), `${date}: same result`);
        mirrored++;
      }
      state = auto;
    }
    assert.equal(state.status, 'won', date);
  }
  assert.ok(mirrored > 20, `${mirrored} recruit moves mirrored`);
});

test('certificates carry no recruit orders: the route code has none, and the verifier refuses one', () => {
  const daily = getDaily('2026-11-13');
  const { actions, metrics } = daily.generation.certificate;
  assert.ok(actions.every((action) => action.recruit === undefined));
  assert.deepEqual(decodeRoute(encodeRoute(actions)), actions);
  const replay = verifyWinningRoute(createGame(daily), actions);
  assert.equal(replay.valid, true, replay.reason); assert.deepEqual(replay.metrics, metrics);
  const ordered = actions.map((action) => (action.type === 'descend' ? action : { ...action, recruit: 'hold' }));
  const refused = verifyWinningRoute(createGame(daily), ordered);
  assert.equal(refused.valid, false); assert.match(refused.reason, /Only chess moves/);
  // The Dungeon Bot replays the same Auto route.
  const bot = botRun(daily);
  assert.equal(bot.frames.length, actions.length + 1); assert.equal(bot.frames.at(-1).status, 'won');
});

test('runs played with orders keep valid saves on every floor', () => {
  const daily = getDaily('2026-11-13');
  let state = createGame(daily);
  // Pick up the first floor's recruit and order it around for a few turns.
  const pickup = state.items.find((item) => item.type === 'companion');
  state.powers.freeze = 6;
  state = act(state, move(pickup.x, pickup.y, 'hold'));
  for (let turn = 0; turn < 4; turn++) {
    const choice = recruitChoice(state, wait());
    const order = choice.moves.find((tile) => !tile.capture) ?? 'hold';
    state = act(state, wait(order === 'hold' ? order : { x: order.x, y: order.y }));
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), state.date), true, `turn ${turn}`);
  }
});

// Once floor 1's or 2's challenge is complete, the recruit hunts on its own for
// the rest of that room: Manual has no order step there, and orders are ignored.
test('once floor 1 or 2 is cleared the recruit hunts on its own: no order step, and orders are ignored', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 6;
  state.companion = ally('rook', 0, 7);
  // Your rook takes the last knight; the recruit's column holds a decoy bishop, and a king behind it.
  state.enemies = [foe('target', 'knight', 7, 2), foe('decoy', 'bishop', 0, 3), foe('king', 'king', 0, 0)];
  assert.ok(recruitChoice(state, wait()), 'before the clear you still give orders');
  assert.equal(recruitChoice(state, move(7, 2)), null, 'the clearing move has no order step');
  const cleared = act(state, move(7, 2));
  assert.equal(cleared.exit.open, true);
  // It moved itself as Auto does: it took the bishop.
  assert.deepEqual(at(cleared.companion), [0, 3]);
  assert.equal(cleared.captures, 2); assert.equal(cleared.gold, state.gold + 1);
  // An order the move still carries is ignored (a malformed one is still no action).
  for (const recruit of ['hold', { x: 0, y: 5 }, { x: 3, y: 7 }]) assert.deepEqual(act(state, move(7, 2, recruit)), cleared, JSON.stringify(recruit));
  assert.equal(act(state, move(7, 2, 'stay')), state);
  // From then on no move or wait of yours has an order step.
  assert.equal(recruitChoice(cleared, wait()), null);
  assert.equal(recruitChoice(cleared, move(7, 4)), null);
  // It still captures, and that gold is at risk until the stairs, like yours.
  const hunted = act(cleared, wait());
  assert.deepEqual(at(hunted.companion), [0, 0]);
  assert.equal(hunted.captures, 3); assert.equal(hunted.gold, cleared.gold + 1);
  assert.equal(goldAtRisk(hunted), 1);
  assert.deepEqual(act(cleared, wait('hold')), hunted);
  assert.deepEqual(act(cleared, wait({ x: 0, y: 1 })), hunted);
  assert.equal(act(cleared, wait('stay')), cleared);
});

test('the challenge-complete message mentions your recruit on floors 1 and 2, only once it has joined', () => {
  const line = 'Your recruit will automatically watch your back while you explore.';
  const clear = (setup) => {
    const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 6;
    state.enemies = [foe('target', 'knight', 7, 2)];
    setup(state);
    return act(state, move(7, 2));
  };
  const done = 'You completed the challenge ✓ in 1 move. Your score is locked in: explore for gold or take the stairs.';
  for (const floor of [0, 1]) {
    const joined = clear((state) => { state.floor = floor; state.companion = ally('knight', 0, 0); });
    assert.ok(said(joined).includes(`${done} ${line}`), `floor ${floor + 1}`);
  }
  // Not while the recruit still waits on its square, and not without one.
  const waiting = clear((state) => { state.items = [{ type: 'companion', piece: 'knight', x: 0, y: 0 }]; });
  assert.ok(said(waiting).includes(done)); assert.ok(!said(waiting).includes(line));
  assert.ok(!said(clear(() => {})).includes(line));
});

test('a recruit that joins after the clear hunts on its own from its first move', () => {
  const state = scenario('rook', { x: 7, y: 7 }); state.powers.freeze = 6;
  state.items = [{ type: 'companion', piece: 'knight', x: 0, y: 4 }];
  state.enemies = [foe('target', 'knight', 0, 7), foe('decoy', 'bishop', 2, 3)];
  const cleared = act(state, move(0, 7));
  assert.equal(cleared.exit.open, true);
  assert.ok(!said(cleared).includes('watch your back'), 'it hasn’t joined yet');
  assert.equal(recruitChoice(cleared, move(0, 4)), null);
  const joined = act(cleared, move(0, 4));
  assert.ok(said(joined).includes('A knight joins you and hunts on its own for the rest of this room.'));
  assert.deepEqual(at(joined.companion), [2, 3]);
  assert.equal(joined.captures, cleared.captures + 1);
  assert.deepEqual(act(cleared, move(0, 4, 'hold')), joined);
  // Taking the last target where it stood on the waiting recruit clears the floor
  // and recruits in one move: both lines stay in the log.
  const both = scenario('rook', { x: 7, y: 7 }); both.powers.freeze = 6;
  both.items = [{ type: 'companion', piece: 'knight', x: 7, y: 2 }];
  both.enemies = [foe('target', 'knight', 7, 2), foe('decoy', 'bishop', 5, 3)];
  const swept = act(both, move(7, 2));
  assert.equal(swept.exit.open, true);
  assert.ok(said(swept).includes('You completed the challenge ✓ in 1 move. Your score is locked in: explore for gold or take the stairs. A knight joins you and hunts on its own for the rest of this room.'), said(swept));
});

test('the last floor is unchanged: after the king falls you still steer the recruit, and the message adds nothing', () => {
  let state = lastFloor();
  const pickup = state.items.find((item) => item.type === 'companion');
  state = act(state, move(pickup.x, pickup.y, 'hold'));
  const square = recruitChoice(state, wait()).moves.find((tile) => !tile.capture);
  const king = state.enemies.find((monster) => monster.role === 'king');
  Object.assign(king, { x: square.x, y: square.y });
  const taken = act(state, wait({ x: square.x, y: square.y }));
  assert.equal(taken.exit.open, true);
  const lines = [...(taken.notes ?? []), taken.message];
  assert.ok(lines.some((text) => /^You completed the challenge ✓ in \d+ moves?\. Your score is locked in: take the stairs to finish\.$/.test(text)), lines.join(' | '));
  assert.ok(!said(taken).includes('watch your back'));
  const choice = recruitChoice(taken, wait());
  assert.ok(choice?.moves.length > 0, 'an order step still follows your move');
  const next = choice.moves.find((tile) => !tile.capture);
  assert.deepEqual(at(act(taken, wait({ x: next.x, y: next.y })).companion), [next.x, next.y]);
  assert.deepEqual(at(act(taken, wait('hold')).companion), at(taken.companion));
});
