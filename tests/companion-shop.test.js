// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createGame,getDaily,legalMoves,validateSave,COMPANIONS} from '../src/game.js';
import {COMPANIONS as RULE_COMPANIONS,createGame as createCandidate,validateSave as validateCandidate} from '../src/rules.js';
import {getRawDaily} from '../src/edition.js';

const move=(x,y)=>({type:'move',x,y});
const daily=getDaily('2026-11-05');
let earned=createGame(daily);
for(const action of daily.generation.certificate.actions) {
  if(action.type==='descend')break;
  earned=act(earned,action);
}
assert.equal(earned.exit.open,true);
assert.ok(earned.gold>=8);
assert.equal(validateSave(earned,earned.date),true);
const bank=()=>structuredClone(earned);
const buy=(state,piece)=>act(state,{type:'buy',id:`companion-${piece}`});
function children(state) {
  const actions=state.exit.open?[{type:'descend'}]:legalMoves(state).map(({x,y})=>move(x,y));
  return actions.map((action)=>act(state,action)).filter((next)=>next!==state&&next.status!=='lost'&&!next.events.some((event)=>event.type==='restart'));
}
function score(state) {
  if(state.status==='won')return 100000;
  const targets=state.enemies.filter((foe)=>foe.role===state.objective.piece);
  const distance=targets.length?Math.min(...targets.map((foe)=>Math.abs(foe.x-state.player.x)+Math.abs(foe.y-state.player.y))):0;
  return state.floor*10000+(state.exit.open?8000:0)+state.captures*100+state.player.hp*20-state.turns-distance*3;
}
function finishRoom(initial) {
  let state=initial;
  for(let step=0;step<80&&!state.exit.open;step++) {
    const options=children(state).map((next)=>({next,value:Math.max(score(next),...children(next).map(score))})).sort((a,b)=>b.value-a.value||score(b.next)-score(a.next));
    assert.ok(options.length,'a paid companion run needs a safe continuation');
    state=options[0].next;
    assert.equal(validateSave(state,state.date),true);
  }
  assert.equal(state.exit.open,true,'the assisted room must finish within the action bound');
  return state;
}

test('companion shop exports all six prices and reserves the next floor without changing this room',()=>{
  assert.equal(COMPANIONS,RULE_COMPANIONS);
  assert.deepEqual(COMPANIONS.map(({piece,cost})=>[piece,cost]),[['pawn',2],['knight',4],['bishop',4],['rook',5],['queen',8],['king',3]]);
  for(const offer of COMPANIONS) {
    const before=bank();const original=structuredClone(before);const reserved=buy(before,offer.piece);
    assert.deepEqual(before,original,'buying must not mutate the previous save');
    assert.deepEqual(reserved.companionOrders,[{floor:1,piece:offer.piece}]);
    assert.equal(reserved.gold,before.gold-offer.cost);assert.equal(reserved.turns,before.turns);
    assert.deepEqual(reserved.companion,before.companion);assert.deepEqual(reserved.items,before.items);
    assert.deepEqual(reserved.map,before.map);assert.deepEqual(reserved.enemies,before.enemies);
    assert.deepEqual(reserved.purchases,before.purchases);
    assert.match(reserved.message,/reserved for floor 2/);
    assert.equal(reserved.events[0].type,'companion-order');
    assert.equal(validateSave(reserved,reserved.date),true);
  }
});

test('unaffordable, duplicate, final-floor, finished-run and unknown orders are inert',()=>{
  const empty=createGame(daily);assert.equal(buy(empty,'pawn'),empty);
  const first=buy(bank(),'pawn');assert.equal(buy(first,'queen'),first);assert.equal(buy(first,'pawn'),first);
  for(const status of ['won','lost']) {const done={...bank(),status};assert.equal(buy(done,'pawn'),done);}
  const last={...bank(),floor:2};assert.equal(buy(last,'pawn'),last);
  const deadline={...bank(),turns:60};assert.notEqual(buy(deadline,'pawn'),deadline);
  const state=bank();assert.equal(buy(state,'dragon'),state);
});

test('a paid companion arrives fresh at the next entrance and replaces only that floor’s free pickup',()=>{
  for(const {piece} of COMPANIONS) {
    const reserved=buy(bank(),piece);const resumed=JSON.parse(JSON.stringify(reserved));
    assert.equal(validateSave(resumed,resumed.date),true);
    const arrived=act(resumed,{type:'descend'});
    assert.equal(arrived.floor,1);assert.equal(arrived.turns,resumed.turns);
    assert.deepEqual(arrived.companion,{piece,basePiece:piece,x:4,y:6,moved:false,sharing:true});
    assert.equal(arrived.items.some((item)=>item.type==='companion'),false);
    assert.deepEqual(arrived.companionOrders,resumed.companionOrders,'delivery retains the paid ledger');
    assert.equal(arrived.gold,resumed.gold,'delivery must not charge again');
    assert.equal(validateSave(arrived,arrived.date),true);
    assert.ok(arrived.events.some((event)=>event.type==='companion-recruit'&&event.piece===piece));
  }
});

test('an order for floor three preserves the current ally, survives saves and delivers exactly once',()=>{
  const arrived=act(buy(bank(),'queen'),{type:'descend'});
  const nextOrder=buy(arrived,'pawn');
  assert.deepEqual(nextOrder.companion,arrived.companion);assert.deepEqual(nextOrder.items,arrived.items);
  assert.deepEqual(nextOrder.companionOrders,[{floor:1,piece:'queen'},{floor:2,piece:'pawn'}]);
  assert.equal(validateSave(nextOrder,nextOrder.date),true);
  const finished=finishRoom(JSON.parse(JSON.stringify(nextOrder)));
  const final=act(finished,{type:'descend'});
  assert.equal(final.floor,2);assert.equal(final.companion.basePiece,'pawn');assert.equal(final.companion.piece,'pawn');
  assert.equal(final.companion.moved,false);assert.deepEqual([final.companion.x,final.companion.y],[4,6]);
  assert.deepEqual(final.companionOrders,nextOrder.companionOrders);
  assert.equal(final.gold,finished.gold);assert.equal(validateSave(final,final.date),true);
  assert.equal(buy(final,'rook'),final,'there is no fourth floor to reserve');
});

test('a paid ally expires after its assigned floor and a normal free recruit returns without a new order',()=>{
  const arrived=act(buy(bank(),'queen'),{type:'descend'});
  const finished=finishRoom(arrived);const next=act(finished,{type:'descend'});
  assert.equal(next.floor,2);assert.equal(next.companion,null);
  assert.equal(next.items.filter((item)=>item.type==='companion').length,1);
  assert.deepEqual(next.companionOrders,[{floor:1,piece:'queen'}]);
  assert.equal(validateSave(next,next.date),true);
});

test('power purchases and companion reservations both contribute to the gold balance',()=>{
  const start=bank();const reserved=buy(start,'queen');const powered=act(reserved,{type:'buy',id:'shield'});
  assert.equal(powered.gold,start.gold-8-3);assert.deepEqual(powered.purchases,['shield']);
  assert.deepEqual(powered.companionOrders,[{floor:1,piece:'queen'}]);
  assert.equal(validateSave(powered,powered.date),true);
  const forged=structuredClone(powered);forged.gold++;
  assert.equal(validateSave(forged,forged.date),false);
});

test('black pending selections may reserve a companion without advancing either phase',()=>{
  const raw=getRawDaily('2026-11-12');let pending=createCandidate(raw);pending=act(pending,move(4,3));
  assert.equal(pending.awaitingPlayer,true);
  // This focused transition test gives the pending position a shop budget.
  pending.gold=5;const reserved=buy(pending,'rook');
  assert.equal(reserved.awaitingPlayer,true);assert.equal(reserved.turns,pending.turns);
  assert.deepEqual(reserved.enemies,pending.enemies);assert.equal(reserved.companion,pending.companion);
  assert.ok(!reserved.events.some((event)=>event.type==='enemy-phase'||event.type==='companion-phase'));
});

test('older schema-five saves without a reservation ledger remain valid and normalize on their next action',()=>{
  const old=bank();delete old.companionOrders;
  assert.equal(old.schema,5);assert.equal(validateSave(old,old.date),true);
  const reserved=buy(old,'pawn');assert.deepEqual(reserved.companionOrders,[{floor:1,piece:'pawn'}]);
  assert.equal(validateSave(reserved,reserved.date),true);assert.equal(old.companionOrders,undefined);
  const raw=getRawDaily('2026-11-05');const initial=createCandidate(raw);delete initial.companionOrders;
  assert.equal(validateCandidate(initial,initial.date,raw),true);
  const moved=act(initial,{type:'move',...legalMoves(initial)[0]});assert.deepEqual(moved.companionOrders,[]);
  assert.equal(validateCandidate(moved,moved.date,raw),true);
});

test('malformed, duplicate, retrospective and impossible future ledgers fail validation',()=>{
  for(const orders of [null,'pawn',[{floor:0,piece:'pawn'}],[{floor:3,piece:'pawn'}],[{floor:2,piece:'pawn'}],
    [{floor:1,piece:'dragon'}],[{floor:1.5,piece:'pawn'}],[{floor:1,piece:'pawn',cost:0}],
    [{floor:1,piece:'pawn'},{floor:1,piece:'rook'}],
    [{floor:2,piece:'pawn'},{floor:1,piece:'rook'}],
    [{floor:1,piece:'pawn'},{floor:2,piece:'rook'},{floor:2,piece:'king'}]]) {
    const bad=bank();bad.companionOrders=orders;
    if(Array.isArray(orders))bad.gold-=orders.reduce((sum,entry)=>sum+(COMPANIONS.find((offer)=>offer.piece===entry.piece)?.cost??0),0);
    assert.equal(validateSave(bad,bad.date),false,JSON.stringify(orders));
  }
});

test('paid companion saves require the purchased source and cannot restore the random pickup',()=>{
  const arrived=act(buy(bank(),'queen'),{type:'descend'});
  for(const mutate of [
    (state)=>{state.companion=null;},(state)=>{state.companion.basePiece='rook';state.companion.piece='rook';},
    (state)=>{delete state.companionOrders;},(state)=>{state.items.push({type:'companion',piece:'queen',x:3,y:6});},
  ]) {const bad=structuredClone(arrived);mutate(bad);assert.equal(validateSave(bad,bad.date),false);}
});

test('exhausting lives clears pending reservations and the spent-gold ledger with the rest of the run',()=>{
  const doomed=buy(bank(),'queen');doomed.player.hp=1;doomed.player.x=4;doomed.player.y=6;
  doomed.items=[];doomed.powers={shield:0,freeze:0,magnet:0};
  doomed.enemies=[{id:'attacker',piece:'rook',role:'rook',species:'bat',palette:'ice',name:'Ice bat',x:4,y:0,moved:true,phase:'aim',target:{x:4,y:5},intent:[{x:4,y:5}]}];
  const reset=act(doomed,move(4,5));
  assert.ok(reset.events.some((event)=>event.type==='restart'));assert.deepEqual(reset.companionOrders,[]);
  assert.equal(reset.gold,0);assert.deepEqual(reset.purchases,[]);assert.equal(reset.companion,null);
  assert.equal(validateSave(reset,reset.date),true);
});
