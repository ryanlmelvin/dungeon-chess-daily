// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createGame, getDaily, legalMoves, validateSave } from '../src/game.js';
import { getRawDaily } from '../src/edition.js';
import { createGame as createCandidate, validateSave as validateCandidate } from '../src/rules.js';

const move = (x,y) => ({type:'move',x,y});
function dailyFor(piece,color) {
  for(let day=0;day<365;day++) {
    const daily=getRawDaily(new Date(Date.UTC(2026,10,5+day)));
    if(daily.playerPiece===piece && daily.playerColor===color) return daily;
  }
  throw Error(`No ${color} ${piece} edition found`);
}
function scenario(piece='rook',color='black',x=4,y=6) {
  const state=createGame(dailyFor(piece,color));
  Object.assign(state.player,{x,y});
  state.map=Array(8).fill('........'); state.props=[]; state.items=[]; state.enemies=[];
  state.objective={piece:'king',complete:false};
  return state;
}
function monster(id,piece,x,y,target=null) {
  return {id,piece,role:piece,species:'bat',palette:'ice',name:'Ice bat',x,y,moved:false,
    phase:target?'aim':'ready',target,intent:target?[{...target}]:[]};
}

// Exported from the published schema-3 engine at 17eb94c after six legal actions.
const legacy=JSON.parse(readFileSync(new URL('./fixtures/schema3-run.json',import.meta.url),'utf8'));

test('side is seeded independently and raw black floors begin without committed attacks',()=>{
  const colors=new Set();
  for(let day=0;day<100;day++) {
    const daily=getRawDaily(new Date(Date.UTC(2026,10,5+day)));
    colors.add(daily.playerColor);
    assert.equal(getRawDaily(daily.date).playerColor,daily.playerColor);
    const state=createCandidate(daily);
    assert.equal(state.playerColor,daily.playerColor);
    assert.equal(state.awaitingPlayer,false);
    assert.equal(state.legacyTurnOrder,false);
    assert.equal(validateCandidate(state,state.date,daily),true);
    if(state.playerColor==='black') assert.ok(state.enemies.every((foe)=>foe.phase==='ready' && foe.intent.length===0));
  }
  assert.deepEqual([...colors].sort(),['black','white']);
  const raw=getRawDaily(legacy.date);
  assert.equal(raw.playerColor,'black');
  for(const key of ['seed','edition','species','targets','theme']) assert.deepEqual(raw[key],legacy[key]);
  for(const color of colors) {
    const state=createGame(dailyFor('rook',color));
    assert.equal(state.playerColor,color);
    assert.equal(validateSave(state,state.date),true);
    if(color==='black') assert.ok(state.enemies.every((foe)=>foe.phase==='ready' && foe.intent.length===0));
  }
});

test('white captures before enemy movement; black enemies can leave the selected capture square first',()=>{
  const white=scenario('knight','white'); white.enemies=[monster('target','king',3,4)];
  const captured=act(white,move(3,4));
  assert.equal(captured.captures,1);
  assert.ok(captured.events.findIndex((event)=>event.type==='capture')<captured.events.findIndex((event)=>event.type==='enemy-phase'));
  const black=scenario('knight'); black.enemies=[monster('target','king',3,4)];
  const vacated=act(black,move(3,4));
  assert.equal(vacated.captures,0); assert.equal(vacated.enemies.length,1);
  assert.deepEqual([vacated.player.x,vacated.player.y],[3,4]);
  assert.ok(vacated.events.findIndex((event)=>event.type==='enemy-move')<vacated.events.findIndex((event)=>event.type==='move'));
});

test('black animates a monster moving onto a destination before the player captures it',()=>{
  const state=scenario(); state.enemies=[monster('target','king',4,3)];
  const next=act(state,move(4,4));
  const movement=next.events.find((event)=>event.type==='enemy-move');
  assert.deepEqual(movement,{type:'enemy-move',id:'target',from:{x:4,y:3},x:4,y:4});
  assert.equal(next.captures,1); assert.equal(next.enemies.length,0);
  assert.ok(next.events.indexOf(movement)<next.events.findIndex((event)=>event.type==='capture'));
});

test('a blocked black selection waits without spending a move and retries never grant another enemy phase',()=>{
  const state=scenario(); state.enemies=[monster('blocker','king',4,4)];
  const pending=act(state,move(4,4));
  assert.equal(pending.awaitingPlayer,true); assert.equal(pending.turns,0);
  assert.deepEqual([pending.player.x,pending.player.y],[4,6]);
  assert.deepEqual([pending.enemies[0].x,pending.enemies[0].y],[4,5]);
  assert.ok(pending.events.some((event)=>event.type==='enemy-phase'));
  assert.ok(!pending.events.some((event)=>event.type==='move'));
  assert.match(pending.message,/Choose another move/);
  assert.equal(act(pending,move(-1,0)),pending);
  const reply=act(pending,move(4,5));
  assert.equal(reply.awaitingPlayer,false); assert.equal(reply.turns,1); assert.equal(reply.captures,1);
  assert.ok(!reply.events.some((event)=>event.type==='enemy-phase'));
});

test('black pending turns persist in valid saves, purchases preserve the phase, and play continues beyond sixty completed moves',()=>{
  const state=createGame(getDaily('2026-11-12'));
  const pending=act(state,move(4,3));
  assert.equal(pending.awaitingPlayer,true);
  assert.equal(validateSave(pending,pending.date),true);
  const saved=JSON.parse(JSON.stringify(pending));
  const reply=act(saved,{type:'move',...legalMoves(saved)[0]});
  assert.equal(reply.turns,1); assert.equal(reply.awaitingPlayer,false);
  assert.equal(validateSave(reply,reply.date),true);
  assert.ok(!reply.events.some((event)=>event.type==='enemy-phase'));
  const beforeDeadline=structuredClone(state); beforeDeadline.turns=59;
  const lastPending=act(beforeDeadline,move(4,3));
  assert.equal(lastPending.turns,59); assert.equal(lastPending.status,'playing');
  assert.equal(validateSave(lastPending,lastPending.date),true);
  const timedOut=act(lastPending,{type:'move',...legalMoves(lastPending)[0]});
  assert.equal(timedOut.turns,60); assert.equal(timedOut.status,'playing');
  assert.equal(timedOut.awaitingPlayer,false);
  const shopping=scenario(); shopping.enemies=[monster('blocker','king',4,4)]; shopping.gold=2;
  const awaiting=act(shopping,move(4,4));
  assert.equal(awaiting.awaitingPlayer,true);
  assert.equal(act(awaiting,{type:'buy',id:'freeze'}),awaiting,'a pending mid-floor selection cannot shop');
});

test('a black promoted pawn hit returns for a fresh selection before any stale move executes',()=>{
  const state=scenario('pawn','black',4,0); state.player.piece='queen';
  state.enemies=[monster('attacker','rook',0,0,{x:4,y:0})];
  const next=act(state,move(4,1));
  assert.equal(next.player.piece,'pawn'); assert.equal(next.player.hp,7);
  assert.deepEqual([next.player.x,next.player.y],[4,6]);
  assert.equal(next.turns,0); assert.equal(next.awaitingPlayer,true);
  assert.ok(!next.events.some((event)=>event.type==='move'));
  assert.match(next.message,/replacement pawn/);
  const reply=act(next,move(4,5));
  assert.equal(reply.turns,1); assert.equal(reply.player.hp,7);
  assert.ok(!reply.events.some((event)=>event.type==='enemy-phase'));
});

test('black exhaustion discards the stale click, while shields must already be owned before the enemy phase',()=>{
  const state=scenario('king'); state.enemies=[monster('attacker','rook',4,0,{x:4,y:6})];
  state.items=[{x:3,y:6,type:'powerup',power:'shield'}];
  const reset=act(state,move(3,6));
  assert.deepEqual(reset.events.map((event)=>event.type),['damage','restart']);
  const fresh=createGame(getDaily(state.date));
  assert.deepEqual({...reset,events:fresh.events,message:fresh.message},{...fresh,replayUnlocked:true});
  assert.equal(reset.playerColor,'black'); assert.equal(reset.awaitingPlayer,false);
  assert.equal(validateSave(reset,reset.date),true);
  state.gold=3;
  assert.equal(act(state,{type:'buy',id:'shield'}),state,'no mid-floor shopping');
  // A ward bought between floors carries into this room.
  const ward=structuredClone(state); ward.gold=0; ward.purchases=['shield']; ward.powers.shield=1;
  const protectedMove=act(ward,move(3,6));
  assert.equal(protectedMove.player.hp,1); assert.equal(protectedMove.turns,1);
  assert.equal(protectedMove.powers.shield,1,'the old ward blocks first; the destination pickup replaces it afterward');
  assert.ok(protectedMove.events.findIndex((event)=>event.type==='shield')<protectedMove.events.findIndex((event)=>event.type==='powerup'));
});

test('black can complete the final objective on move sixty and click the stairs without an extra phase',()=>{
  const state=scenario(); state.floor=2; state.turns=59; state.awaitingPlayer=true;
  state.enemies=[monster('last','king',4,4)];
  const solved=act(state,move(4,4));
  assert.equal(solved.turns,60); assert.equal(solved.status,'playing'); assert.equal(solved.exit.open,true);
  const won=act(solved,{type:'descend'});
  assert.equal(won.status,'won'); assert.equal(won.turns,60); assert.equal(won.awaitingPlayer,false);
  assert.ok(!won.events.some((event)=>event.type==='enemy-phase'));
});

test('older progress stays archived instead of being relabeled as a certified edition',()=>{
  const original=structuredClone(legacy);
  assert.equal(validateSave(legacy,legacy.date),false);
  assert.deepEqual(legacy,original,'validation must preserve the archived stored record');
  const current=createGame(getDaily(legacy.date));
  assert.equal(current.schema,5);
  assert.equal(current.rulesVersion,5);
  assert.equal(current.legacyTurnOrder,false);
  for(const schema of [2,3,4]) {
    assert.equal(validateSave({...current,schema},current.date),false);
  }
  const previousRules={...current,rulesVersion:4};
  assert.equal(validateSave(previousRules,current.date),false);
});

test('turn metadata and archived imports cannot silently change the certified order',()=>{
  const state=createGame(getDaily('2026-11-12'));
  for(const mutate of [
    (s)=>{s.playerColor='purple';}, (s)=>{s.playerColor='white';},
    (s)=>{s.legacyTurnOrder=true;}, (s)=>{s.awaitingPlayer='yes';},
    (s)=>{s.status='lost';s.awaitingPlayer=true;},
  ]) {const bad=structuredClone(state);mutate(bad);assert.equal(validateSave(bad,bad.date),false);}
  const white=createGame(getDaily('2026-11-05')); white.awaitingPlayer=true;
  assert.equal(validateSave(white,white.date),false);
  assert.equal(validateSave(legacy,legacy.date),false);
  assert.equal(validateSave({...legacy,gold:999},legacy.date),false);
  assert.equal(validateSave(legacy,'2026-11-08'),false);
  assert.equal(validateSave(JSON.parse(JSON.stringify(state)),state.date),true);
});
