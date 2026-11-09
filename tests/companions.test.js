// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createGame,getDaily,legalMoves,validateSave,PIECES} from '../src/game.js';
import {getRawDaily} from '../src/edition.js';
import {createGame as createCandidate,validateSave as validateCandidate} from '../src/rules.js';
const move=(x,y)=>({type:'move',x,y});
function scenario(piece='king',color='white',x=4,y=6) {
  let daily;
  // Kings are no longer a daily piece; engine tests borrow a rook day.
  const wanted=piece==='king'?'rook':piece;
  for(let d=0;d<365;d++) {const candidate=getRawDaily(new Date(Date.UTC(2026,10,5+d)));if(candidate.playerPiece===wanted&&candidate.playerColor==='white'){daily=candidate;break;}}
  // Every daily is white; black engine tests flip the color, as practice does.
  const state=createGame(daily);state.playerColor=color;Object.assign(state.player,{x,y});
  if(piece==='king'){state.startingPiece="king";state.player.piece="king";}
  state.map=Array(8).fill('........');state.props=[];state.items=[];state.enemies=[];state.companion=null;
  // Knights are the challenge here, so the kings and queens below are fair game for a recruit.
  state.objective={piece:'knight',complete:false};return state;
}
const foe=(id,piece,x,y)=>({id,piece,role:piece,species:'bat',palette:'ice',name:'Ice bat',x,y,moved:false,phase:'ready',target:null,intent:[]});
const ally=(piece,x,y)=>({piece,basePiece:piece,x,y,moved:false,sharing:false});

const recruitsOn=(state)=>state.items.filter((item)=>item.type==='companion');
// Clears the room in place so the stairs can be taken without replaying a route.
function descend(state) {
  const cleared=structuredClone(state);
  cleared.enemies=cleared.enemies.filter((foe)=>foe.role!==cleared.objective.piece);
  cleared.objective.complete=true;cleared.exit.open=true;
  return act(cleared,{type:'descend'});
}

// Floors one and two recruit any piece, on a square one move from the start;
// a pawn only where its file is open to the far rank.
function earlyRecruit(state,label,seen) {
  const [recruit,...extra]=recruitsOn(state);
  assert.ok(recruit,`${label}: recruit`);assert.equal(extra.length,0);assert.ok(PIECES.includes(recruit.piece),label);seen?.add(recruit.piece);
  assert.equal(state.map[recruit.y][recruit.x],'.');
  assert.ok(!state.enemies.some((enemy)=>enemy.x===recruit.x&&enemy.y===recruit.y));
  if(recruit.piece==='pawn') for(let y=0;y<recruit.y;y++) assert.equal(state.map[y][recruit.x],'.',`${label}: a pawn recruit's file is open`);
  return recruit;
}

test('floors one and two recruit any piece while the final floor always recruits a king',()=>{
  const finalTypes=new Set(),earlyTypes=new Set();
  for(let d=0;d<60;d++) {
    const daily=getRawDaily(new Date(Date.UTC(2026,10,5+d)));
    const state=createCandidate(daily);
    assert.equal(state.floor,0);earlyRecruit(state,`${daily.date}: floor 1`,earlyTypes);
    assert.equal(state.companion,null);
    assert.equal(validateCandidate(state,state.date,daily),true);
    assert.deepEqual(createCandidate(daily).items,state.items);
    const second=descend(state);
    assert.equal(second.floor,1);earlyRecruit(second,`${daily.date}: floor 2`,earlyTypes);assert.equal(second.companion,null);
    const last=descend(second);
    assert.equal(last.floor,2);
    const [recruit,...extra]=recruitsOn(last);
    assert.ok(recruit,`${daily.date}: final recruit`);assert.equal(extra.length,0);
    assert.equal(recruit.piece,'king',`${daily.date}: ${recruit.piece}`);finalTypes.add(recruit.piece);
    if(last.startingPiece==='pawn') assert.ok(recruit.y<6,'pawn recruits must be ahead of the player, not behind the entrance');
    assert.ok(last.items.every((item)=>item.x!==last.exit.x||item.y!==last.exit.y),'pickups must remain clickable after stairs appear');
    assert.ok(!last.enemies.some((enemy)=>enemy.x===recruit.x&&enemy.y===recruit.y));
    assert.equal(last.map[recruit.y][recruit.x],'.');
    assert.equal(last.companion,null);
  }
  assert.deepEqual([...finalTypes],['king']);
  assert.deepEqual([...earlyTypes].sort(),[...PIECES].sort());
  for(const date of ['2026-11-12','2026-11-13']) {
    const daily=getDaily(date), state=createGame(daily);
    earlyRecruit(state,date);
    assert.equal(validateSave(state,date),true);
    assert.deepEqual(createGame(daily).items,state.items);
  }
});

test('saves from before the change keep their floor-one recruit, on the board or recruited',()=>{
  const daily=getDaily('2026-11-13');const fresh=createGame(daily);
  const state=structuredClone(fresh);state.items=state.items.filter((item)=>item.type!=='companion');
  state.floorSnapshot.items=state.floorSnapshot.items.filter((item)=>item.type!=='companion');
  // Saves from the brief era with no recruit on floors one and two still validate.
  assert.equal(validateSave(state,state.date),true);
  // The validator accepts exactly the recruit the old rules placed (or today's
  // king on that square), and nothing else.
  const king=fresh.items.find((item)=>item.type==='companion');
  const accepted=[];
  for(const piece of PIECES) for(let y=0;y<8;y++) for(let x=0;x<8;x++) {
    const old=structuredClone(state);old.items.push({type:'companion',piece,x,y});
    if(validateSave(old,old.date)) accepted.push(old);
  }
  assert.ok(accepted.every((old)=>{const item=old.items.at(-1);return item.x===king.x&&item.y===king.y;}));
  assert.ok(accepted.some((old)=>old.items.at(-1).piece==='king'));
  assert.ok(accepted.length<=2);
  const old=accepted.find((entry)=>entry.items.at(-1).piece!=='king')??accepted[0];const pickup=old.items.find((item)=>item.type==='companion');
  assert.ok(legalMoves(old).some((tile)=>tile.x===pickup.x&&tile.y===pickup.y));
  const recruited=act(old,move(pickup.x,pickup.y));
  assert.equal(recruited.companion.basePiece,pickup.piece);assert.deepEqual(recruitsOn(recruited),[]);
  assert.equal(validateSave(JSON.parse(JSON.stringify(recruited)),recruited.date),true);
  const forged=structuredClone(recruited);forged.companion.basePiece=forged.companion.piece=pickup.piece==='rook'?'queen':'rook';
  assert.equal(validateSave(forged,forged.date),false);
});

test('a white recruit moves after its player, captures a guard for gold, then enemies respond',()=>{
  const state=scenario();state.items=[{type:'companion',piece:'rook',x:4,y:5}];state.enemies=[foe('guard','king',4,2),foe('target','knight',0,7)];
  // The turn it joins it captures nothing: it closes in on the guard instead.
  const joined=act(state,move(4,5));
  assert.equal(joined.player.piece,'king');assert.equal(joined.startingPiece,'king');
  assert.deepEqual([joined.companion.x,joined.companion.y],[4,3]);
  assert.equal(joined.captures,0);assert.equal(joined.turns,1);
  const order=['move','companion-recruit','companion-phase','companion-move','enemy-phase'].map((type)=>joined.events.findIndex((event)=>event.type===type));
  assert.ok(order.every((index,i)=>index>=0&&(!i||index>order[i-1])));
  assert.ok(!joined.events.some((event)=>event.type==='companion-capture'));
  assert.deepEqual(act(state,move(4,5)),joined,'companion choices replay deterministically');
  // At your side, it captures first, then the monsters answer.
  const beside=scenario();beside.companion=ally('rook',4,5);beside.enemies=[foe('guard','king',4,2),foe('target','knight',0,7)];
  const next=act(beside,move(3,6));
  assert.deepEqual([next.companion.x,next.companion.y],[4,2]);
  assert.equal(next.captures,1);assert.equal(next.gold,1);assert.equal(next.exit.open,false);assert.equal(next.turns,1);
  const phases=['move','companion-phase','companion-move','companion-capture','enemy-phase'].map((type)=>next.events.findIndex((event)=>event.type===type));
  assert.ok(phases.every((index,i)=>index>=0&&(!i||index>phases[i-1])));
});

test('black resolves enemy, player and companion phases in that order',()=>{
  const state=scenario('king','black');state.items=[{type:'companion',piece:'rook',x:4,y:5}];state.enemies=[foe('target','king',4,2)];
  const next=act(state,move(4,5));
  const phase=(type)=>next.events.findIndex((event)=>event.type===type);
  assert.ok(phase('enemy-phase')<phase('move')&&phase('move')<phase('companion-phase'));
  // The monster king stepped into the joining rook's file, but a recruit takes nothing the turn it joins.
  assert.equal(next.captures,0);assert.equal(next.turns,1);
  assert.deepEqual([next.enemies[0].x,next.enemies[0].y],[4,3]);
  assert.deepEqual([next.companion.x,next.companion.y],[4,4]);
});

test('companions prioritize captures, otherwise approach the nearest enemy without overshooting',()=>{
  const state=scenario('king','white',7,7);state.powers.freeze=3;
  state.companion=ally('rook',0,0);state.enemies=[foe('target','king',3,2)];
  const approached=act(state,move(6,7));
  assert.deepEqual([approached.companion.x,approached.companion.y],[3,0]);
  const capture=scenario('king','white',7,7);capture.powers.freeze=3;
  capture.companion=ally('bishop',0,0);capture.enemies=[foe('far','king',4,4),foe('near','queen',1,0)];
  const captured=act(capture,move(6,7));
  assert.deepEqual([captured.companion.x,captured.companion.y],[4,4]);assert.equal(captured.captures,1);
  assert.equal(captured.enemies[0].id,'near');
});

test('companion sliders obey walls and occupied squares',()=>{
  const state=scenario('king','white',7,7);state.powers.freeze=3;
  state.companion=ally('rook',0,0);state.enemies=[foe('behind','king',3,0)];state.map[0]='..#.....';
  const next=act(state,move(6,7));
  assert.deepEqual([next.companion.x,next.companion.y],[1,0]);assert.equal(next.captures,0);
});

test('companion pawns capture diagonally, never forward, and promote on the far rank',()=>{
  const state=scenario('king','white',7,7);state.powers.freeze=3;
  state.companion=ally('pawn',3,1);state.enemies=[foe('target','king',4,0)];
  const promoted=act(state,move(6,7));
  assert.equal(promoted.companion.piece,'queen');assert.equal(promoted.companion.basePiece,'pawn');
  assert.deepEqual([promoted.companion.x,promoted.companion.y],[4,0]);assert.equal(promoted.captures,1);
  assert.ok(promoted.events.some((event)=>event.type==='companion-promotion'));
  const blocked=structuredClone(state);blocked.enemies=[foe('front','king',3,0)];
  const held=act(blocked,move(6,7));
  assert.deepEqual([held.companion.x,held.companion.y],[3,1]);assert.equal(held.captures,0);
});

test('knight and king companions keep their ordinary chess destinations',()=>{
  for(const piece of ['knight','king']) {
    const state=scenario('king','white',7,7);state.powers.freeze=3;
    state.companion=ally(piece,4,4);state.enemies=[foe('target','king',4,0)];
    const next=act(state,move(6,7));const dx=Math.abs(next.companion.x-4),dy=Math.abs(next.companion.y-4);
    if(piece==='knight')assert.ok((dx===1&&dy===2)||(dx===2&&dy===1));
    else assert.equal(Math.max(dx,dy),1);
  }
});

test('players pass through companions while companions block enemy attack lanes',()=>{
  const state=scenario('rook','black');state.companion=ally('bishop',4,4);
  state.enemies=[{...foe('attacker','rook',4,0),phase:'aim',target:{x:4,y:6},intent:[{x:4,y:6}]}];
  assert.ok(legalMoves(state).some((tile)=>tile.x===4&&tile.y===4));
  assert.ok(legalMoves(state).some((tile)=>tile.x===4&&tile.y===3));
  const next=act(state,move(4,5));
  assert.equal(next.hits,state.hits);assert.ok(!next.events.some((event)=>event.type==='player-captured'));
});

test('recruiting a pawn in front of a pawn player does not remove its forward move',()=>{
  const state=scenario('pawn');state.powers.freeze=6;
  state.items=[{type:'companion',piece:'pawn',x:4,y:5}];state.enemies=[foe('far','king',0,0)];
  const recruited=act(state,move(4,5));
  assert.equal(recruited.status,'playing');assert.deepEqual([recruited.companion.x,recruited.companion.y],[4,4]);
  assert.ok(legalMoves(recruited).some((tile)=>tile.x===4&&tile.y===4));
  const advanced=act(recruited,move(4,4));
  assert.equal(advanced.status,'playing');assert.equal(advanced.turns,2);
});

test('an immobile recruit may share its recruitment square until the player leaves',()=>{
  const state=scenario('queen','white',4,5);state.powers.freeze=6;
  state.items=[{type:'companion',piece:'pawn',x:4,y:4}];state.enemies=[foe('front','king',4,3)];
  const recruited=act(state,move(4,4));
  assert.equal(recruited.companion.sharing,true);
  assert.deepEqual([recruited.companion.x,recruited.companion.y],[4,4]);
  const left=act(recruited,move(3,4));assert.equal(left.companion.sharing,false);
});

test('floor changes and a cornered run clear the active companion',()=>{
  const state=scenario('queen');state.objective={piece:'king',complete:false};state.companion=ally('rook',0,0);state.enemies=[foe('last','king',4,2)];
  const cleared=act(state,move(4,2));const downstairs=act(cleared,{type:'descend'});
  assert.equal(downstairs.floor,1);assert.equal(downstairs.companion,null);
  assert.equal(downstairs.items.filter((item)=>item.type==='companion').length,1);
  // Walled in on every side, the king has no move at all: the try ends.
  const doomed=scenario('king','white',4,5);doomed.companion=ally('pawn',0,7);
  doomed.map[4]='...###..';doomed.map[5]='...#.#..';doomed.map[6]='...###..';
  const reset=act(doomed,{type:'wait'});
  assert.equal(reset.turns,0);assert.equal(reset.companion,null);assert.ok(reset.events.some((event)=>event.type==='restart'));
});

test('real final-floor recruits survive save and resume, and invalid companion data is rejected',()=>{
  const daily=getDaily('2026-11-13');let state=createGame(daily);
  for(const action of daily.generation.certificate.actions) {if(state.floor===2)break;state=act(state,action);}
  assert.equal(state.floor,2);
  const pickup=state.items.find((item)=>item.type==='companion');
  const recruited=act(state,move(pickup.x,pickup.y));
  assert.ok(recruited.companion);assert.equal(validateSave(recruited,recruited.date),true);
  const saved=JSON.parse(JSON.stringify(recruited));assert.equal(validateSave(saved,saved.date),true);
  const resumed=act(saved,{type:'move',...legalMoves(saved)[0]});assert.equal(validateSave(resumed,resumed.date),true);
  for(const mutate of [
    (s)=>{s.companion.piece='dragon';},(s)=>{s.companion.x=99;},
    (s)=>{s.companion.sharing=!s.companion.sharing;},(s)=>{s.items.push(pickup);},
  ]){const bad=structuredClone(saved);mutate(bad);assert.equal(validateSave(bad,bad.date),false);}
});


test('a pawn recruited on the far rank promotes before its first move, even with no enemies left',()=>{
  for(const hasEnemy of [true,false]) {
    const state=scenario('queen','white',3,1);state.powers.freeze=3;
    state.items=[{type:'companion',piece:'pawn',x:3,y:0}];
    state.enemies=hasEnemy?[foe('target','king',6,0)]:[];
    const next=act(state,move(3,0));
    assert.equal(next.companion.piece,'queen');assert.equal(next.companion.basePiece,'pawn');
    assert.ok(next.events.some((event)=>event.type==='companion-promotion'));
    if(hasEnemy) {
      // It moves as a queen, beside the king it may not take the turn it joins.
      assert.deepEqual([next.companion.x,next.companion.y],[5,0]);assert.equal(next.captures,0);
      const promotion=next.events.findIndex((event)=>event.type==='companion-promotion');
      const movement=next.events.findIndex((event)=>event.type==='companion-move');
      assert.ok(promotion<movement);assert.equal(next.events[movement].piece,'queen');
      const taken=act(next,move(3,1));
      assert.deepEqual([taken.companion.x,taken.companion.y],[6,0]);assert.equal(taken.captures,1);
    } else assert.deepEqual([next.companion.x,next.companion.y],[3,0]);
  }
});

test('a recruit never captures the challenge piece, even when it is the only capture on offer',()=>{
  const state=scenario('queen','white',7,7);state.powers.freeze=3;
  state.items=[{type:'companion',piece:'rook',x:6,y:7}];state.enemies=[foe('target','knight',6,2)];
  const next=act(state,move(6,7));
  assert.equal(next.message,'A rook joins you this floor. It can capture from your next move on, but never knights.');
  assert.equal(next.captures,0);assert.equal(next.enemies.length,1);
  assert.deepEqual([next.companion.x,next.companion.y],[6,3]);
  // From then on it could capture, but still never the challenge piece beside it.
  const later=act(next,move(7,7));
  assert.equal(later.captures,0);assert.equal(later.enemies.length,1);
  assert.ok(!(later.companion.x===6&&later.companion.y===2));
  // A single challenge piece is named with "the".
  const royal=scenario('queen','white',7,7);royal.powers.freeze=3;royal.objective={piece:'king',complete:false};
  royal.items=[{type:'companion',piece:'queen',x:6,y:7}];royal.enemies=[foe('target','king',6,2)];
  const crowned=act(royal,move(6,7));
  assert.equal(crowned.message,'A queen joins you this floor. It can capture from your next move on, but never the king.');
  assert.equal(crowned.captures,0);assert.ok(!(crowned.companion.x===6&&crowned.companion.y===2));
});
