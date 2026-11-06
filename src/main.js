// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import './style.css';
import { initGuide } from './guide.js';
import { getDaily, createGame, act, dangerTiles, legalMoves, getShareText, validateSave, POWERUPS } from './game.js';
import { createDungeonRenderer } from './renderer.js';
import { initPWA, getReleaseVersion } from './pwa.js';
import { initPersistentStorage } from './storage.js';
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
    if (validateSave(parsed, daily.date)) return parsed;
    notify('This save could not be read. Download a backup from the menu before starting again.', true);
  } catch { notify('Progress storage is unavailable. Keep this tab open; you can download a backup of your run.', true); }
  return null;
}
function save() {
  if (!state) return true;
  try {
    const stored = localStorage.getItem(key());
    if (stored !== lastSaved) {
      if (stored && validateSave(JSON.parse(stored), daily.date)) {
        state = JSON.parse(stored); lastSaved = stored;
        notify('Progress changed in another window. This window is now up to date.');
        updateGame();
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
    if (!validateSave(incoming, daily.date)) return false;
    state = incoming; lastSaved = stored;
    notify('Resumed the latest progress from your other window.');
    updateGame();
    if (screen === 'game' && state.status !== 'playing') showResult();
    return true;
  } catch { return false; }
}
state = load();
function switchScreen(next) {
  screen = next;
  document.body.classList.toggle('playing', next === 'game');
  for (const name of ['paper', 'game', 'result']) $(`${name}-screen`).hidden = name !== next;
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (next === 'game') requestAnimationFrame(() => renderer?.resize());
}
function renderPaper() {
  const theme = daily.theme;
  $('edition').textContent = `NO. ${String(Math.max(1, daily.edition)).padStart(3, '0')}`;
  $('paper-date').dateTime = daily.date;
  $('paper-date').textContent = new Date(`${daily.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  $('headline').textContent = theme.headline;
  $('deck').textContent = theme.deck;
  $('art-caption').textContent = "Artist's impression";
  $('side-stories').replaceChildren(...theme.stories.map((story, index) => {
    const article = document.createElement('article');
    const h = document.createElement('h3'); h.textContent = story.title;
    const p = document.createElement('p'); p.textContent = story.body;
    const creature = daily.species[index + 1];
    const portrait = document.createElement('canvas'); portrait.width=40;portrait.height=40;portrait.className='story-portrait';portrait.setAttribute('aria-label',creature.name);portrait.setAttribute('role','img');
    drawSprite(portrait.getContext('2d'), creature.id, 0, 0, 2, spritePalette(creature.palette));
    article.append(portrait,h,p); return article;
  }));
  $('start-button').replaceChildren(document.createTextNode(state ? state.status === 'playing' ? 'Resume your descent ' : 'Read your result ' : "Enter today's dungeon "));
  const arrow = document.createElement('span'); arrow.textContent = '↘'; arrow.ariaHidden = 'true'; $('start-button').append(arrow);
  drawPaperArt(theme);
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
      if(state.exit.open&&x===state.exit.x&&y===state.exit.y){takeAction({type:'descend'});return;}
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
  $('turns').textContent = `◷ ${state.maxTurns - state.turns}`;
  $('turns').setAttribute('aria-label', `${state.maxTurns - state.turns} moves left`);
  renderLives();
  $('shop-button').textContent = `${state.gold} gold`;
  $('shop-button').setAttribute('aria-label', `${state.gold} gold. Buy powerups`);
  $('freeze-status').hidden = !state.powers.freeze;
  $('freeze-status').textContent = `Frozen ${state.powers.freeze}`;
  $('freeze-status').setAttribute('aria-label', `Enemies frozen for ${state.powers.freeze} moves`);
  $('objective').textContent = `Floor ${state.floor + 1} · Capture all enemy ${state.objective.piece}s`;
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
  return true;
}
const directions={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
window.addEventListener('keydown',event=>{
  if(event.target instanceof Element && event.target.closest('button,input,textarea,select,a'))return;
  if(screen!=='game'||!state||turnLocked||document.querySelector('dialog[open]')||event.metaKey||event.ctrlKey||event.altKey)return;
  const name=event.key.length===1?event.key.toLowerCase():event.key;
  if(directions[name]){event.preventDefault();const [dx,dy]=directions[name];cursor??={x:state.player.x,y:state.player.y};cursor={x:Math.max(0,Math.min(7,cursor.x+dx)),y:Math.max(0,Math.min(7,cursor.y+dy))};showMoves=true;paintBoard();}
  else if(name==='Enter'&&cursor){event.preventDefault();takeAction(state.exit.open&&cursor.x===state.exit.x&&cursor.y===state.exit.y?{type:'descend'}:{type:'move',...cursor});}
  else if(name==='Escape'){showMoves=false;cursor=null;paintBoard();}
});
function renderShop() {
  $('shop-gold').textContent = `${state.gold} gold`;
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
}
$('shop-button').addEventListener('click', () => {
  if (!state || state.status !== 'playing' || turnLocked) return;
  refreshFromOtherWindow();
  if (screen !== 'game' || state.status !== 'playing') return;
  renderShop();
  $('shop-feedback').hidden = true;
  $('shop-dialog').showModal();
});
$('descend-button').addEventListener('click', () => takeAction({type:'descend'}));
function playSound(events=[]) {
  if(!sound)return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if(audio.state==='suspended')audio.resume();
    let notes = events.some(e=>e.type==='win') ? [392,494,587,784] : events.some(e=>e.type==='descend') ? [330,440,660] : events.some(e=>e.type==='damage') ? [110,82] : events.some(e=>e.type==='capture'||e.type==='companion-capture') ? [220,440] : events.some(e=>e.type==='hit') ? [180,100] : events.some(e=>e.type==='pickup'||e.type==='companion-recruit') ? [660,880] : [85];
    notes.forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.018,audio.currentTime+i*.065);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+i*.065+.07);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(audio.currentTime+i*.065);oscillator.stop(audio.currentTime+i*.065+.08);});
  } catch {}
}
function shareText(){const text=getShareText(state);return practice ? text.replace('Dungeon Chess Daily','Dungeon Chess Daily · PRACTICE') : text;}
function showResult() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  switchScreen('result');
  const won=state.status==='won';
  $('result-date').textContent=daily.date;
  $('result-kicker').hidden=!practice;
  $('result-kicker').textContent='PRACTICE EDITION';
  $('result-title').textContent=won?'You made the headlines.':'Some stories bury the lead.';
  $('result-summary').textContent=won?'Your story lives to see another day.':state.player.hp===0?`Captured in room ${state.floor+1}. Tomorrow is another story.`:state.message;
  $('share-preview').textContent=shareText().split('\n').slice(0,-1).join('\n');
  $('next-edition').textContent='🟨 All three coins · ⬜ Extra captures · 🟫 Escaped\nNext edition at 00:00 UTC.';
  $('share-button').focus({preventScroll:true});
  refreshEdition();
}
$('share-button').addEventListener('click',async()=>{
  const text=shareText();
  if(navigator.share){try{await navigator.share({text});return;}catch(error){if(error.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(text);notify('Edition copied. Ready to paste — no spoilers.');}
  catch{$('copy-text').value=text;$('copy-dialog').showModal();$('copy-text').select();}
});
$('practice-button').addEventListener('click',()=>{practice=true;lastSaved=null;try{lastSaved=localStorage.getItem(key());}catch{}state=createGame(daily);save();enterGame();});
$('result-paper-button').addEventListener('click',()=>{
  const current=getDaily();
  if(current.date!==daily.date){daily=current;practice=false;state=load();}
  renderPaper();switchScreen('paper');
});
function progressStatus(message) {
  $('progress-feedback').textContent = message;
  $('progress-feedback').hidden = !message;
}
const persistentStorage = initPersistentStorage({ button: $('persist-button'), onStatus: progressStatus });
function openMenu() {
  progressStatus('');
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
  try{
    if(file.size>2_000_000)throw new Error('This file is too large.');
    const data=JSON.parse(await file.text());
    if(data.app!=='dungeon-chess-daily'||data.schema!==1||!data.saves||typeof data.saves!=='object')throw new Error('Choose a Dungeon Chess Daily backup.');
    const entries=Object.entries(data.saves);
    let archived = false;
    for (const [name, value] of entries) {
      if (name === 'sound') { if (!['on','off'].includes(value)) throw new Error('Invalid sound preference.'); continue; }
      const match = /^daily:(v[345]:)?(\d{4}-\d{2}-\d{2})$/.exec(name);
      if (!match || typeof value !== 'string') throw new Error('This backup contains an unreadable save.');
      const entry = JSON.parse(value);
      if (match[1] === 'v5:') {
        if (!validateSave(entry, match[2])) throw new Error('This backup contains an unreadable save.');
      } else {
        // Earlier rules are archived as data; they are never loaded into this engine.
        if (!entry || ![2,3,4].includes(entry.schema) || entry.date !== match[2] || !['playing','won','lost'].includes(entry.status)) throw new Error('This backup contains an unreadable earlier edition.');
        archived = true;
      }
    }
    if(!confirm('Restore this backup? Matching saved days on this device will be replaced.'))return;
    for(const [name,value]of entries)localStorage.setItem(`${prefix}${name}`,value);
    practice=false;state=load();sound=localStorage.getItem(`${prefix}sound`)!=='off';$('sound-toggle').checked=sound;
    $('menu-dialog').close();renderPaper();switchScreen('paper');notify(archived ? 'Backup restored. Earlier ruleset runs are preserved in backups.' : 'Backup restored.');
  }catch(error){progressStatus(error.message||'Backup could not be restored.');}
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
  daily = current; practice = false; state = load(); renderPaper();
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshFromOtherWindow();refreshEdition();}});
setInterval(refreshEdition, 60_000);
initPWA({installButton:$('install-button'),updateButton:$('update-button'),onBeforeUpdate:async()=>save(),onStatus:notify});
getReleaseVersion().then(version=>{$('release').textContent=`Release ${version}`;}).catch(()=>{});
