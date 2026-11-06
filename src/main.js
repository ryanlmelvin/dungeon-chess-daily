// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import './style.css';
import './menu.css';
import { initGuide } from './guide.js';
import { drawMoveDemo } from './guide-art.js';
import { headlineFor } from './edition.js';
import { getDaily, createGame, createPracticeGame, canChoosePiece, isOfficialPiece, act, dangerTiles, legalMoves, getShareText, validateSave, POWERUPS, COMPANIONS, PIECES } from './game.js';
import { createDungeonRenderer } from './renderer.js';
import { initPWA, getReleaseVersion } from './pwa.js';
import { initPersistentStorage } from './storage.js';
import { planBackupMerge } from './backups.js';
import { drawSprite, spritePalette, piecePalette, SPRITE_SIZE } from './sprites.js';

const $ = (id) => document.getElementById(id);
const scope = new URL('.', location.href).pathname;
const prefix = `dchess:${scope}:`;
let daily = getDaily();
let state = null;
let practice = false;
let renderer = null;
let screen = 'paper';
let showMoves = false;
let cursor = null;
let turnLocked = false;
let lastSaved = null;
let noticeTimer;
let sound = true;
let audio;
// Different rulesets never overwrite each other's runs, including in older tabs.
const key = () => `${prefix}${practice ? 'practice:' : 'daily:'}v5:${daily.date}`;
const practiceModeKey = () => `${prefix}practice:active:v5:${daily.date}`;
function setPracticeMode(enabled) {
  practice = enabled;
  try {
    if (enabled) localStorage.setItem(practiceModeKey(), 'true');
    else localStorage.removeItem(practiceModeKey());
  } catch {}
}
function validateCurrentSave(value) { return validateSave(value, daily.date, { practice }); }
try { practice = localStorage.getItem(practiceModeKey()) === 'true'; } catch {}
try { sound = localStorage.getItem(`${prefix}sound`) !== 'off'; } catch {}
$('sound-toggle').checked = sound;
initGuide();

function notify(message, persistent = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').hidden = !message;
  if (!persistent) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5500);
}
function load() {
  try {
    lastSaved = localStorage.getItem(key());
    if (!lastSaved) {
      if (!practice && ['v4:', 'v3:', ''].some((version) => localStorage.getItem(`${prefix}daily:${version}${daily.date}`))) {
        notify('New dungeon rules are here. Your earlier run is preserved in backups.');
      }
      return null;
    }
    const parsed = JSON.parse(lastSaved);
    if (validateCurrentSave(parsed)) return parsed;
    notify('This save could not be read. Download a backup from the menu before starting again.', true);
  } catch { notify('Progress storage is unavailable. Keep this tab open; you can download a backup of your run.', true); }
  return null;
}
function save() {
  if (!state) return true;
  try {
    const stored = localStorage.getItem(key());
    if (stored !== lastSaved) {
      if (stored && validateCurrentSave(JSON.parse(stored))) {
        state = JSON.parse(stored); lastSaved = stored;
        notify('Progress changed in another window. This window is now up to date.');
        renderIncomingProgress();
        return false;
      }
    }
    const serialized = JSON.stringify(state);
    localStorage.setItem(key(), serialized);
    lastSaved = serialized;
    return true;
  } catch {
    notify('Progress could not be saved. Keep this tab open or download a backup from the menu.', true);
    return false;
  }
}
function refreshFromOtherWindow() {
  try {
    const stored = localStorage.getItem(key());
    if (stored === lastSaved) return false;
    if (!stored) return false;
    const incoming = JSON.parse(stored);
    if (!validateCurrentSave(incoming)) return false;
    state = incoming; lastSaved = stored;
    notify('Resumed the latest progress from your other window.');
    renderIncomingProgress();
    return true;
  } catch { return false; }
}
function renderIncomingProgress() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  if (screen === 'paper') renderPaper();
  else if (state.status !== 'playing') { showResult(); return; }
  else if (screen === 'result') { switchScreen('game'); ensureRenderer(); }
  updateGame();
}
state = load();
if (practice && !state) { setPracticeMode(false); state = load(); }
function switchScreen(next) {
  screen = next;
  document.body.classList.toggle('playing', next === 'game');
  for (const name of ['paper', 'game', 'result']) $(`${name}-screen`).hidden = name !== next;
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (next === 'game') requestAnimationFrame(() => renderer?.resize());
}
function renderPaper() {
  $('edition').textContent = `NO. ${String(Math.max(1, daily.edition)).padStart(3, '0')}`;
  $('paper-date').dateTime = daily.date;
  $('paper-date').textContent = new Date(`${daily.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  $('headline').textContent = headlineFor(daily.species[0], daily.date);
  $('deck').replaceChildren(createPrintLines(0));
  $('art-caption').textContent = "Artist's impression";
  $('side-stories').replaceChildren(...daily.species.slice(1, 3).map((creature, index) => {
    const article = document.createElement('article');
    const h = document.createElement('h3'); h.textContent = headlineFor(creature, daily.date);
    const p = document.createElement('p');
    p.setAttribute('aria-hidden', 'true');
    p.append(createPrintLines(index + 1));
    const portrait = document.createElement('canvas'); portrait.width=40;portrait.height=40;portrait.className='story-portrait';portrait.setAttribute('aria-label',creature.name);portrait.setAttribute('role','img');
    drawSprite(portrait.getContext('2d'), creature.id, 0, 0, 2, spritePalette(creature.palette));
    article.append(portrait,h,p); return article;
  }));
  $('start-button').replaceChildren(document.createTextNode(state ? state.status === 'playing' ? 'Resume your descent ' : 'Read your result ' : "Enter today's dungeon "));
  const arrow = document.createElement('span'); arrow.textContent = '↘'; arrow.ariaHidden = 'true'; $('start-button').append(arrow);
  drawPaperArt();
}
// Decorative, unreadable print: the headlines and colored portraits carry the clues.
function createPrintLines(variant) {
  const canvas = document.createElement('canvas');
  canvas.width = 180; canvas.height = 26; canvas.className = 'print-lines';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#696969';
  for (let row = 0; row < 3; row++) {
    const width = row === 2 ? 108 + variant * 18 : 180;
    for (let x = 0; x < width; x += 3) {
      const ink = (x * 11 + row * 17 + variant * 23) % 13;
      if (ink < 3) continue;
      ctx.fillRect(x, row * 10 + ink % 2, 2, 3 + ink % 3);
    }
  }
  return canvas;
}
function drawPaperArt() {
  const ctx = $('paper-art').getContext('2d');
  ctx.fillStyle='#302a36';ctx.fillRect(0,0,180,150);
  for(let y=0;y<150;y+=3)for(let x=0;x<180;x+=3)if((x*13+y*7)%19<4){ctx.fillStyle='#49404d';ctx.fillRect(x,y,1,1);}
  // An inked chess floor and the actual monster pictured in this story.
  for(let y=0;y<4;y++)for(let x=0;x<6;x++){ctx.fillStyle=(x+y)%2?'#743f47':'#201d25';ctx.fillRect(x*30,110+y*10,30,10);}
  ctx.fillStyle='#1c1921';ctx.fillRect(5,0,18,115);ctx.fillRect(157,0,18,115);
  drawSprite(ctx,daily.species[0].id,40,14,5,spritePalette(daily.species[0].palette));
}
$('newspaper').addEventListener('animationend', () => $('newspaper').classList.remove('arriving'), {once:true});
if (state || matchMedia('(prefers-reduced-motion: reduce)').matches) $('newspaper').classList.remove('arriving');
setTimeout(() => $('newspaper').classList.remove('arriving'), 1300);
renderPaper();

function ensureRenderer() {
  if (renderer) return true;
  try {
    renderer = createDungeonRenderer($('dungeon'), { onTile: ({x,y}) => {
      if (!state || screen !== 'game' || state.status !== 'playing' || turnLocked) return;
      if(state.exit.open&&x===state.exit.x&&y===state.exit.y){takeStairs();return;}
      if(x===state.player.x&&y===state.player.y){showMoves=!showMoves;cursor=null;paintBoard();return;}
      if(legalMoves(state).some(tile=>tile.x===x&&tile.y===y)) takeAction({type:'move',x,y});
      else {showMoves=true;cursor=null;paintBoard();}
    }});
    return true;
  } catch (error) {
    console.error(error);
    $('dungeon').innerHTML = '<p class="webgl-error">This browser could not start the 3D dungeon. Try a browser with WebGL enabled, such as an up-to-date Chrome, Safari, or Firefox.</p>';
    notify('The dungeon needs WebGL to run.',true);
    return false;
  }
}
let feedbackTimer;
function showGameFeedback() {
  clearTimeout(feedbackTimer);
  const events = state.events || [];
  const text = events.length ? state.message : '';
  $('game-message').textContent = text;
  $('game-message').hidden = !text;
  if (text) feedbackTimer = setTimeout(()=>{$('game-message').hidden=true;},3000);
}
function renderLives() {
  const { hp, maxHp } = state.player;
  const markers = $('lives');
  markers.setAttribute('aria-label', `${hp} of ${maxHp} ${state.playerColor} ${state.startingPiece} ${hp === 1 ? 'life' : 'lives'} remaining`);
  markers.replaceChildren(...Array.from({ length: hp }, () => {
    const marker = document.createElement('canvas');
    marker.width = marker.height = SPRITE_SIZE;
    marker.setAttribute('aria-hidden', 'true');
    drawSprite(marker.getContext('2d'), `piece-${state.startingPiece}`, 0, 0, 1, piecePalette(state.playerColor));
    return marker;
  }));
}
function updateGame() {
  if (!state) return;
  if (state.awaitingPlayer) showMoves = true;
  $('room-label').textContent = `Room ${state.floor + 1} / 3 · ${state.playerColor} ${state.player.piece} · ${state.playerColor === 'white' ? 'You move first' : 'Enemies move first'}`;
  $('practice-label').hidden = !practice;
  renderLives();
  $('gold-status').textContent = `${state.gold} gold`;
  $('freeze-status').hidden = !state.powers.freeze;
  $('freeze-status').textContent = `Frozen ${state.powers.freeze}`;
  $('freeze-status').setAttribute('aria-label', `Enemies frozen for ${state.powers.freeze} moves`);
  $('objective-text').textContent = `Floor ${state.floor + 1} · Capture all enemy ${state.objective.piece}s`;
  $('hint-button').setAttribute('aria-label', `Hint: how an enemy ${state.objective.piece} moves`);
  $('objective').hidden = state.exit.open;
  $('descend-button').hidden = !state.exit.open;
  $('descend-button').textContent = state.floor === 2 ? 'Leave dungeon ↘' : 'Take stairs ↘';
  $('treasure').textContent = ` · ${state.captures} captures`;
  $('news-button').hidden = false;
  $('treasure').setAttribute('aria-label', `${state.captures} enemies captured`);
  showGameFeedback();
  if ($('shop-dialog').open) renderShop();
  $('first-tip').hidden = state.turns > 0;
  $('first-tip').textContent = `${state.playerColor === 'white' ? 'White piece: you move first.' : 'Black piece: enemies move first.'} Tap your piece for legal moves.`;
  paintBoard();
}
function paintBoard(){if(state)renderer?.render({...state,danger:dangerTiles(state),legalMoves:legalMoves(state),showMoves,cursor});}
function enterGame() {
  refreshEdition();
  refreshFromOtherWindow();
  if (state?.status && state.status !== 'playing') return showResult();
  switchScreen('game');
  if (!ensureRenderer()) return;
  if (!state) { state = createGame(daily); save(); }
  updateGame();
}
$('start-button').addEventListener('click', enterGame);
const HINT_MOVES = {
  pawn: 'An enemy pawn steps one square toward you, or two on its first move. It captures one square diagonally toward you.',
  knight: 'A knight jumps in an L: two squares one way, then one to the side. It leaps over obstacles.',
  rook: 'A rook slides any distance in a straight line until something blocks it.',
  bishop: 'A bishop slides any distance diagonally until something blocks it.',
  queen: 'A queen slides any distance in a straight line or diagonally until something blocks it.',
  king: 'A king steps one square in any direction.',
};
let hintFrame = 0;
function openHint() {
  if (!state || screen !== 'game' || document.querySelector('dialog[open]')) return;
  const piece = state.objective.piece;
  const article = piece === 'pawn' ? 'an enemy pawn' : `a ${piece}`;
  $('hint-title').textContent = `How ${article} moves`;
  $('hint-move').textContent = HINT_MOVES[piece];
  $('hint-art').setAttribute('aria-label', `Animated board: ${HINT_MOVES[piece]}`);
  const options = { enemy: true, palette: piecePalette(state.playerColor === 'white' ? 'black' : 'white') };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const frame = (now) => {
    drawMoveDemo($('hint-art'), piece, still ? 1800 * 0.6 : now - start, options);
    if (!still && $('hint-dialog').open) hintFrame = requestAnimationFrame(frame);
  };
  $('hint-dialog').showModal();
  frame(start);
}
$('hint-button').addEventListener('click', openHint);
$('hint-dialog').addEventListener('close', () => cancelAnimationFrame(hintFrame));
$('news-button').addEventListener('click', () => {$('menu-dialog').close();renderPaper();switchScreen('paper');$('start-button').focus({preventScroll:true});});
function takeAction(action) {
  const shopping = action.type === 'buy' && $('shop-dialog').open;
  if (screen !== 'game' || !state || state.status !== 'playing' || turnLocked || (!shopping && document.querySelector('dialog[open]'))) return false;
  if (refreshFromOtherWindow()) return false;
  const next = act(state, action);
  if (next === state) return false;
  turnLocked=!shopping;
  state = next;showMoves=state.awaitingPlayer;cursor=null;save();updateGame();playSound(state.events);
  const animationTime = state.events.some(event => event.type === 'companion-phase' || event.type === 'recruit') ? 600 : 400;
  if (!shopping) setTimeout(()=>{turnLocked=false;},animationTime);
  if (state.status !== 'playing') setTimeout(() => { if (state.status !== 'playing') showResult(); }, animationTime);
  else if (state.events.some(event => event.type === 'restart')) setTimeout(() => {
    if (screen === 'game' && state.status === 'playing' && state.events.some(event => event.type === 'restart')) openPieceChooser();
  }, animationTime);
  return true;
}
const directions={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
window.addEventListener('keydown',event=>{
  if(event.target instanceof Element && event.target.closest('button,input,textarea,select,a'))return;
  if(screen!=='game'||!state||turnLocked||document.querySelector('dialog[open]')||event.metaKey||event.ctrlKey||event.altKey)return;
  const name=event.key.length===1?event.key.toLowerCase():event.key;
  if(directions[name]){event.preventDefault();const [dx,dy]=directions[name];cursor??={x:state.player.x,y:state.player.y};cursor={x:Math.max(0,Math.min(7,cursor.x+dx)),y:Math.max(0,Math.min(7,cursor.y+dy))};showMoves=true;paintBoard();}
  else if(name==='Enter'&&cursor){event.preventDefault();if(state.exit.open&&cursor.x===state.exit.x&&cursor.y===state.exit.y)takeStairs();else takeAction({type:'move',...cursor});}
  else if(name==='Escape'){showMoves=false;cursor=null;paintBoard();}
});
function renderShop() {
  $('shop-gold').textContent = `Floor ${state.floor + 1} cleared · ${state.gold} gold`;
  $('shop-descend').textContent = `Descend to floor ${state.floor + 2} ↘`;
  for (const power of POWERUPS) {
    let button = document.querySelector(`[data-power="${power.id}"]`);
    if (!button) {
      button = document.createElement('button');
      button.dataset.power = power.id;
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      button.append(title, detail);
      button.addEventListener('click', () => {
        if (takeAction({type:'buy', id:power.id})) {
          $('shop-feedback').hidden = false;
          $('shop-feedback').textContent = `${power.name} purchased.`;
        }
      });
      $('shop-items').append(button);
    }
    const owned = state.powers[power.id];
    button.disabled = state.gold < power.cost || owned >= power.max;
    button.firstElementChild.textContent = `${power.name} · ${power.cost} gold`;
    button.lastElementChild.textContent = `${power.description}${owned ? ` (${power.id === 'freeze' ? `${owned} moves left` : power.id === 'magnet' ? 'Active' : `${owned} left`})` : ''}`;
  }
  $('companion-shop').hidden = state.floor === 2;
  const reserved = (state.companionOrders || []).find(order => order.floor === state.floor + 1);
  $('companion-picker').hidden = !!reserved;
  $('companion-reserved').hidden = !reserved;
  if (reserved) {
    const name = COMPANIONS.find(companion => companion.piece === reserved.piece).name;
    $('companion-reserved').textContent = `${name} reserved for floor ${reserved.floor + 1} only.`;
  } else {
    $('companion-label').textContent = `Companion for floor ${state.floor + 2} only`;
    const select = $('companion-choice');
    if (!select.options.length) {
      for (const companion of COMPANIONS) {
        const option = document.createElement('option');
        option.value = companion.id;
        option.textContent = `${companion.name} · ${companion.cost} gold`;
        select.append(option);
      }
    }
    const chosen = COMPANIONS.find(companion => companion.id === select.value);
    $('buy-companion').disabled = !chosen || state.gold < chosen.cost;
  }
}
$('companion-choice').addEventListener('change', renderShop);
$('companion-shop').addEventListener('submit', event => {
  event.preventDefault();
  if (takeAction({type:'buy', id:$('companion-choice').value})) $('shop-feedback').hidden = true;
});
// The shop is offered once a floor is cleared, as the player takes its stairs.
// The last floor has no shop: its stairs end the run.
function takeStairs() {
  if (screen !== 'game' || !state || state.status !== 'playing' || turnLocked || !state.exit.open || document.querySelector('dialog[open]')) return;
  if (refreshFromOtherWindow() || !state.exit.open) return;
  if (state.floor === 2) { takeAction({type:'descend'}); return; }
  renderShop();
  $('shop-feedback').hidden = true;
  $('shop-dialog').showModal();
  $('shop-descend').focus();
}
$('descend-button').addEventListener('click', takeStairs);
$('shop-descend').addEventListener('click', () => { $('shop-dialog').close(); takeAction({type:'descend'}); });
function playSound(events=[]) {
  if(!sound)return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if(audio.state==='suspended')audio.resume();
    let notes = events.some(e=>e.type==='win') ? [392,494,587,784] : events.some(e=>e.type==='descend') ? [330,440,660] : events.some(e=>e.type==='damage') ? [110,82] : events.some(e=>e.type==='capture'||e.type==='companion-capture') ? [220,440] : events.some(e=>e.type==='hit') ? [180,100] : events.some(e=>e.type==='pickup'||e.type==='companion-recruit') ? [660,880] : [85];
    notes.forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.018,audio.currentTime+i*.065);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+i*.065+.07);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(audio.currentTime+i*.065);oscillator.stop(audio.currentTime+i*.065+.08);});
  } catch {}
}
function shareText(){if (!isOfficialPiece(state, daily)) return '';const text=getShareText(state);return practice ? text.replace('Dungeon Chess Daily','Dungeon Chess Daily · PRACTICE') : text;}
function showResult() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  switchScreen('result');
  const won=state.status==='won';
  $('result-date').textContent=daily.date;
  $('result-kicker').hidden=!practice;
  $('result-kicker').textContent='PRACTICE EDITION';
  $('result-title').textContent=won?'You made the headlines.':'Some stories bury the lead.';
  $('result-summary').textContent=won?'Your story lives to see another day.':state.player.hp===0?`Captured in room ${state.floor+1}. Tomorrow is another story.`:state.message;
  const shareable = isOfficialPiece(state, daily);
  $('share-preview').hidden = !shareable;
  $('share-button').hidden = !shareable;
  $('share-preview').textContent=shareable ? shareText().split('\n').slice(0,-1).join('\n') : '';
  $('next-edition').textContent=shareable ? '💔 Lives lost on each floor · ❤️ None lost\nNext edition at 00:00 UTC.' : 'Next edition at 00:00 UTC.';
  $(shareable ? 'share-button' : 'practice-button').focus({preventScroll:true});
  refreshEdition();
}
$('share-button').addEventListener('click',async()=>{
  if (!state || state.status === 'playing' || !isOfficialPiece(state, daily)) return;
  const text=shareText();
  if(navigator.share){try{await navigator.share({text});return;}catch(error){if(error.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(text);notify('Edition copied. Ready to paste — no spoilers.');}
  catch{$('copy-text').value=text;$('copy-dialog').showModal();$('copy-text').select();}
});
function updatePieceWarning() {
  $('piece-warning').hidden = $('practice-piece').value === daily.playerPiece && $('practice-color').value === daily.playerColor;
}
function openPieceChooser() {
  if (turnLocked || !state || !(practice || canChoosePiece(state))) return;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('practice-piece').value = state.startingPiece;
  $('practice-color').value = state.playerColor;
  $('official-piece').textContent = `Today's official piece: ${daily.playerColor} ${daily.playerPiece}.`;
  $('piece-start').textContent = state.status === 'playing' ? 'Restart dungeon' : 'Start practice';
  updatePieceWarning();
  $('piece-dialog').showModal();
}
for (const piece of PIECES) {
  const option = document.createElement('option');
  option.value = piece; option.textContent = piece[0].toUpperCase() + piece.slice(1);
  $('practice-piece').append(option);
}
$('practice-piece').addEventListener('change', updatePieceWarning);
$('practice-color').addEventListener('change', updatePieceWarning);
$('practice-button').addEventListener('click', openPieceChooser);
$('change-piece-button').addEventListener('click', openPieceChooser);
$('piece-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!state || !(practice || canChoosePiece(state))) return;
  const next = createPracticeGame(daily, { piece: $('practice-piece').value, color: $('practice-color').value });
  setPracticeMode(true);
  lastSaved = null;
  try { lastSaved = localStorage.getItem(key()); } catch {}
  state = next; showMoves = false; cursor = null;
  $('piece-dialog').close();
  save(); enterGame();
});
$('daily-button').addEventListener('click', () => {
  $('menu-dialog').close();
  setPracticeMode(false); state = load(); showMoves = false; cursor = null;
  enterGame();
});
$('result-paper-button').addEventListener('click',()=>{
  const current=getDaily();
  if(current.date!==daily.date){daily=current;setPracticeMode(false);state=load();}
  renderPaper();switchScreen('paper');
});
function progressStatus(message) {
  $('progress-feedback').textContent = message;
  $('progress-feedback').hidden = !message;
  if (message) $('progress-feedback').closest('details').open = true;
}
const persistentStorage = initPersistentStorage({ button: $('persist-button'), onStatus: progressStatus });
function openMenu() {
  progressStatus('');
  $('change-piece-button').hidden = !(practice || canChoosePiece(state));
  $('daily-button').hidden = !practice;
  $('menu-dialog').showModal();
  persistentStorage.refresh();
}
$('menu-button').addEventListener('click',openMenu);
$('game-menu-button').addEventListener('click',openMenu);
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('sound-toggle').addEventListener('change',()=>{sound=$('sound-toggle').checked;try{localStorage.setItem(`${prefix}sound`,sound?'on':'off');}catch{}});
$('export-button').addEventListener('click',()=>{
  const saves={};
  try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name.startsWith(prefix)&&!name.includes('practice:'))saves[name.slice(prefix.length)]=localStorage.getItem(name);}}
  catch{}
  if(state&&!practice)saves[`daily:v5:${daily.date}`]=JSON.stringify(state);
  const blob=new Blob([JSON.stringify({app:'dungeon-chess-daily',schema:1,saves},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`dungeon-chess-daily-${daily.date}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);progressStatus('Backup download requested.');
});
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async(event)=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  let written = 0;
  progressStatus('');
  const reloadProgress = () => {
    setPracticeMode(false);state=load();
    sound=localStorage.getItem(`${prefix}sound`)!=='off';$('sound-toggle').checked=sound;
    renderPaper();switchScreen('paper');
  };
  try {
    if(file.size>2_000_000)throw new Error('This file is too large.');
    const data=JSON.parse(await file.text());
    // Capture the latest window and in-memory progress before merging. There
    // are no awaits between reading current storage and applying the delta.
    refreshFromOtherWindow();
    if (!save()) {
      progressStatus('Current progress could not be saved. Download a backup before restoring, or try again.');
      return;
    }
    const current = new Map();
    for(let i=0;i<localStorage.length;i++) {
      const name=localStorage.key(i);
      if(name.startsWith(prefix)&&!name.includes('practice:'))current.set(name.slice(prefix.length),localStorage.getItem(name));
    }
    const { writes, archived, unreadable } = planBackupMerge(current, data);
    for (const [name,value] of writes) {
      const latest = localStorage.getItem(`${prefix}${name}`);
      // Another window may finish a day while this backup is being validated.
      if (latest !== (current.get(name) ?? null)) {
        const checked = planBackupMerge(new Map(latest === null ? [] : [[name,latest]]), { app: data.app, schema: data.schema, saves: { [name]: value } });
        unreadable.push(...checked.unreadable);
        if (!checked.writes.has(name)) continue;
      }
      localStorage.setItem(`${prefix}${name}`,value); written++;
    }
    reloadProgress();$('menu-dialog').close();
    notify(unreadable.length
      ? `${written ? 'Backup merged. ' : ''}${unreadable.length} unreadable local ${unreadable.length===1?'save was':'saves were'} kept unchanged; matching backup entries were skipped.`
      : archived ? 'Backup merged. Earlier ruleset runs remain in backups.' : 'Backup merged.', unreadable.length > 0);
  } catch(error) {
    if (written) { try { reloadProgress(); } catch {} }
    progressStatus(written
      ? 'Some progress was merged before storage became unavailable. Keep your backup and try again.'
      : error.message||'Backup could not be merged.');
  }
});
window.addEventListener('storage',event=>{if(event.key===key())refreshFromOtherWindow();});
let rolloverNotice = '';
function refreshEdition() {
  const current = getDaily();
  if (current.date === daily.date) return;
  if (state?.status === 'playing') {
    if (rolloverNotice !== current.date) { notify('A new edition is out. Finish this assignment to read it.'); rolloverNotice = current.date; }
    return;
  }
  if (screen === 'result') {
    $('result-paper-button').textContent = "Read today's paper";
    $('next-edition').textContent = "Today's new edition is ready.";
    return;
  }
  daily = current; setPracticeMode(false); state = load(); renderPaper();
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshFromOtherWindow();refreshEdition();}});
setInterval(refreshEdition, 60_000);
initPWA({installButton:$('install-button'),updateButton:$('update-button'),onBeforeUpdate:async()=>save(),onStatus:notify});
getReleaseVersion().then(version=>{$('release').textContent=`Release ${version}`;}).catch(()=>{});
