// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, closeAttacker, createGame, legalMoves } from '../src/rules.js';
import { getRawDaily } from '../src/edition.js';
import { withRooms } from './fixtures/rooms.js';

const move = (x,y) => ({type:'move',x,y});
function dailyFor(piece,color) {
  // Every daily is white; black engine tests borrow a white day, as practice does.
  if (color === 'black') return { ...dailyFor(piece, 'white'), playerColor: 'black' };
  // Kings are no longer a daily piece; engine tests borrow a rook day.
  if (piece === 'king') return { ...dailyFor('rook', color), playerPiece: 'king' };
  for(let day=0;day<365;day++) {
    const daily=getRawDaily(new Date(Date.UTC(2026,10,5+day)));
    if(daily.playerPiece===piece && daily.playerColor===color) return daily;
  }
  throw Error(`No ${color} ${piece} edition found`);
}
function scenario(piece='rook',color='white',x=4,y=6) {
  const state=createGame(withRooms(dailyFor(piece,color)));
  Object.assign(state.player,{x,y});
  state.map=Array(8).fill('........'); state.props=[]; state.items=[]; state.enemies=[];
  state.objective={piece:'king',complete:false}; state.companion=null;
  state.powers={shield:0,freeze:0,magnet:0}; state.awaitingPlayer=false;
  return state;
}
function monster(id,piece,x,y,target=null) {
  return {id,piece,role:piece,species:'bat',palette:'ice',name:'Ice bat',x,y,moved:false,
    phase:target?'aim':'ready',target,intent:target?[{...target}]:[]};
}
const count = (state,type) => state.events.filter((event)=>event.type===type).length;

test('white: ending next to a monster king is captured at once, and only once per move',()=>{
  const state=scenario(); const hits=state.hits;
  state.enemies=[monster('king','king',5,3),monster('rook','rook',0,4,{x:4,y:4})];
  const next=act(state,move(4,4));
  assert.equal(next.hits,hits+1);
  assert.deepEqual(next.events.find((event)=>event.type==='close-capture'),{type:'close-capture',id:'king',x:5,y:3});
  assert.equal(count(next,'player-captured'),1);
  // The monsters still take their turn, but the rook's wound-up strike holds.
  assert.equal(count(next,'enemy-phase'),1);
  assert.equal(next.enemies[1].phase,'aim');
  assert.deepEqual([next.player.x,next.player.y],[4,4]);
});

test('black: a destination close-attacked before and after the enemy phase is an instant hit',()=>{
  const state=scenario('rook','black'); const hits=state.hits;
  state.enemies=[monster('king','king',5,5)];
  assert.ok(closeAttacker(state,{x:4,y:4}));
  const next=act(state,move(4,4));
  assert.equal(next.hits,hits+1);
  assert.equal(count(next,'close-capture'),1); assert.equal(count(next,'player-captured'),1);
  assert.deepEqual([next.player.x,next.player.y],[4,4]);
  assert.equal(next.awaitingPlayer,false);
});

test('a knight two squares away captures instantly',()=>{
  const state=scenario(); const hits=state.hits;
  state.enemies=[monster('knight','knight',6,3)];
  const next=act(state,move(4,4));
  assert.equal(next.hits,hits+1);
  assert.equal(next.events.find((event)=>event.type==='close-capture').id,'knight');
});

test('a shield absorbs the instant hit',()=>{
  const state=scenario(); const hits=state.hits; state.powers.shield=1;
  state.enemies=[monster('king','king',5,3)];
  const next=act(state,move(4,4));
  assert.equal(next.hits,hits); assert.equal(next.powers.shield,0);
  assert.equal(count(next,'shield'),1); assert.equal(count(next,'close-capture'),1);
  // No free freeze: the monsters still act, and the king winds up again.
  assert.equal(count(next,'enemy-phase'),1);
  assert.equal(next.enemies[0].phase,'aim');
});

test('frozen monsters never capture at close range',()=>{
  const state=scenario(); const hits=state.hits; state.powers.freeze=2;
  state.enemies=[monster('king','king',5,3)];
  assert.equal(closeAttacker(state,{x:4,y:4}),null);
  const next=act(state,move(4,4));
  assert.equal(next.hits,hits); assert.equal(count(next,'close-capture'),0);
  assert.equal(next.powers.freeze,1);
});

test('capturing the only adjacent attacker is safe',()=>{
  const state=scenario(); const hits=state.hits;
  state.enemies=[monster('king','king',4,4)];
  const next=act(state,move(4,4));
  assert.equal(next.captures,1); assert.equal(next.hits,hits);
  assert.equal(count(next,'close-capture'),0);
});

test('a distant rook in the new line steps one square closer, then aims without hitting',()=>{
  const state=scenario(); const hits=state.hits;
  state.enemies=[monster('rook','rook',2,1)];
  const next=act(state,move(2,6));
  const foe=next.enemies[0];
  assert.equal(next.hits,hits);
  assert.deepEqual([foe.x,foe.y],[2,2]);
  assert.equal(foe.phase,'aim'); assert.deepEqual(foe.target,{x:2,y:6});
  assert.deepEqual(next.events.find((event)=>event.type==='enemy-move'),{type:'enemy-move',id:'rook',from:{x:2,y:1},x:2,y:2});
});

test('a monster that walks into range only aims',()=>{
  const state=scenario(); const hits=state.hits;
  state.enemies=[monster('king','king',6,3)];
  const next=act(state,move(4,5));
  const foe=next.enemies[0];
  assert.equal(next.hits,hits); assert.equal(count(next,'close-capture'),0);
  assert.deepEqual([foe.x,foe.y],[5,4]); assert.equal(foe.phase,'aim');
});

test('black re-prompts when the enemy phase newly puts the clicked destination in close range',()=>{
  const state=scenario('rook','black'); const hits=state.hits;
  // Walls leave the king one sensible step: next to the clicked square.
  state.map=['........','........','.....###','.......#','......##','........','........','........'];
  state.enemies=[monster('king','king',6,3)];
  assert.equal(closeAttacker(state,{x:4,y:4}),null);
  const pending=act(state,move(4,4));
  assert.deepEqual([pending.enemies[0].x,pending.enemies[0].y],[5,4]);
  assert.ok(legalMoves(pending).some((m)=>m.x===4 && m.y===4));
  assert.equal(pending.awaitingPlayer,true);
  assert.deepEqual([pending.player.x,pending.player.y],[4,6]);
  assert.match(pending.message,/The board changed\. Choose another move\./);
  assert.equal(pending.hits,hits); assert.equal(pending.turns,state.turns);
  // Insisting on the square now walks into the capture, with no extra enemy phase.
  const insisted=act(pending,move(4,4));
  assert.equal(insisted.hits,hits+1); assert.equal(count(insisted,'enemy-phase'),0);
});

test('a king player cannot step into close range, but may stand on a distant slider line',()=>{
  const state=scenario('king','white');
  state.enemies=[monster('king','king',4,4),monster('rook','rook',0,7)];
  const keys=legalMoves(state).map((m)=>`${m.x},${m.y}`);
  for(const square of ['3,5','4,5','5,5']) assert.ok(!keys.includes(square),square);
  for(const square of ['3,7','4,7','5,7','3,6','5,6']) assert.ok(keys.includes(square),square);
  assert.equal(act(state,move(4,5)),state);
});

test('an instant hit demotes a pawn-start queen',()=>{
  const state=scenario('pawn','white',4,2); state.player.piece='queen'; state.player.moved=true;
  const hits=state.hits;
  state.enemies=[monster('king','king',5,3)];
  const next=act(state,move(4,4));
  assert.equal(next.hits,hits+1); assert.equal(next.player.piece,'pawn');
  assert.equal(count(next,'close-capture'),1);
  assert.match(next.message,/Back to a pawn/);
});

test('an instant hit never ends the run: it adds a move and keeps the capture event',()=>{
  const state=scenario('queen');
  state.enemies=[monster('king','king',5,3)];
  const next=act(state,move(4,4));
  assert.equal(next.status,'playing'); assert.equal(next.floor,0); assert.equal(next.hits,1);
  assert.deepEqual(next.events.map((event)=>event.type).filter((type)=>type.includes('capture')),['close-capture','player-captured']);
  assert.ok(!next.events.some((event)=>event.type==='restart'));
});

test('a companion sharing the player square does not shield a close-range capture',()=>{
  const state=scenario('rook','white',4,6);
  state.enemies=[monster('king','king',5,3)];
  state.companion={piece:'rook',basePiece:'rook',x:4,y:4,moved:false,sharing:false};
  const next=act(state,move(4,4));
  assert.ok(next.events.some((event)=>event.type==='close-capture'));
  assert.equal(next.hits,state.hits+1);
});
