// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import './style.css';
import './menu.css';
import { initGuide } from './guide.js';
import { isFirstVisit, markGuideSeen } from './first-visit.js';
import { drawMoveDemo, drawEnPassantDemo, EN_PASSANT_STILL, drawCastleDemo, CASTLE_STILL } from './guide-art.js';
import { TACTIC_COPY, RECRUIT_COPY, BISHOP_PAIR_COPY } from './tactics-art.js';
import { autoExplainer } from './explainers.js';
import { COMBO_START } from './tactics.js';
import { headlineFor, FIRST_EDITION_DATE } from './edition.js';
import { tierLabel, DIFFICULTY_TIERS, TIER_IDS } from './difficulty.js';
import { archiveMonth, dailySaveKey, isArchiveDate, shiftMonth, STATUS_LABELS } from './archive.js';
import { getDaily, createGame, createPracticeGame, canChoosePiece, isOfficialRun, act, resetFloor, hopelessFloor, dangerTiles, legalMoves, getShareText, scoredMoves, floorScoredMoves, retryLostRun, validateSave, coinlessFloor, SHOP_ITEMS, PIECES, borrowedPiece, takebackTarget, shopOffers } from './game.js';
import { recruitChoice } from './game.js';
import { createDungeonRenderer } from './renderer.js';
import { initPWA, getReleaseVersion } from './pwa.js';
import { initPersistentStorage } from './storage.js';
import { planBackupMerge } from './backups.js';
import { drawSprite, spritePalette, piecePalette, SPRITE_SIZE } from './sprites.js';
import { pinUsable, captureGoal, shareDate, createGame as createComposedGame } from './rules.js';
import { nextHint, hintCards, targetLine, targetSpecies, closeRangeSquares } from './rules.js';
import { drawTargetCard, drawDangerCard, drawUnmaskExample } from './hint-art.js';
import { createMusic, editionTracks } from './music.js';
import { MODIFIERS, modifierOf, modifierStatus } from './modifiers.js';
import { caveInLabel, caveInLoss, caveInRunning, cavedIn, goldAtRisk } from './cave-in.js';
import { dungeonBot, playerRun, verdict } from './bot.js';
import { parFor, runPars } from './par.js';

const $ = (id) => document.getElementById(id);
const scope = new URL('.', location.href).pathname;
const prefix = `dchess:${scope}:`;
// A past edition opened from the archive stays open across reloads in this tab
// and is never swapped for today's edition until the player chooses to return.
const archiveSessionKey = `${prefix}archive:open`;
let archiveMode = false;
// Dev only, stripped from builds: ?composed=YYYY-MM-DD plays that date's
// composed day (src/composed-preview.js), saved apart from every real run.
const preview = import.meta.env.DEV && new URLSearchParams(location.search).has('composed') ? await import('./composed-preview.js') : null;
const composedDay = preview?.composedDayFor(location.search) ?? null;
let daily = composedDay ?? getDaily();
try {
  const opened = composedDay ? null : sessionStorage.getItem(archiveSessionKey);
  if (isArchiveDate(opened, daily.date, FIRST_EDITION_DATE)) { daily = getDaily(opened); archiveMode = true; }
} catch {}
const newGame = () => (composedDay ? createComposedGame(composedDay) : createGame(daily));
// Practice replays the official room, so the composed preview has none.
if (composedDay) $('practice-button').hidden = true;
let state = null;
// Set while watching the bot's certified route; the saved run is untouched.
let replay = null;
let practice = false;
let renderer = null;
let screen = 'paper';
let showMoves = false;
let pinning = false;
let cursor = null;
let turnLocked = false;
let lastSaved = null;
let noticeTimer;
let sound = true;
let audio;
// Different rulesets never overwrite each other's runs, including in older tabs.
const key = () => `${prefix}${composedDay ? preview.composedSaveTag(location.search) : practice ? 'practice:' : 'daily:'}v11:${daily.date}`;
const practiceModeKey = () => `${prefix}practice:active:v11:${daily.date}`;
function setPracticeMode(enabled) {
  practice = enabled;
  try {
    if (enabled) localStorage.setItem(practiceModeKey(), 'true');
    else localStorage.removeItem(practiceModeKey());
  } catch {}
}
function validateCurrentSave(value) { return composedDay ? preview.composedSaveFits(value, composedDay) : validateSave(value, daily.date, { practice }); }
try { practice = !composedDay && localStorage.getItem(practiceModeKey()) === 'true'; } catch {}
try { sound = localStorage.getItem(`${prefix}sound`) !== 'off'; } catch {}
$('sound-toggle').checked = sound;
// Background music is opt-in: it stays off unless the player turned it on here.
const music = createMusic();
let musicOn = false;
try { musicOn = localStorage.getItem(`${prefix}music`) === 'on'; } catch {}
$('music-toggle').checked = musicOn;
music.setEnabled(musicOn);
// Recruit control is a device preference like sound and music, never part of a
// save or backup. Manual (the default) asks for the recruit's move every turn;
// Auto lets it move itself, as certified routes and the Dungeon Bot do.
let recruitManual = true;
try { recruitManual = localStorage.getItem(`${prefix}recruit`) !== 'auto'; } catch {}
$('recruit-control').value = recruitManual ? 'manual' : 'auto';
$('recruit-auto-note').hidden = recruitManual;
// Manual control: a move or wait that reaches the recruit's phase shows your
// move first and waits here for the recruit's order. The turn is played only
// with the order, as one action, so a save never holds half a turn. It belongs
// to the state it began from: any other change of state drops it.
let ordering = null;
const pendingOrder = () => (ordering && ordering.from === state ? ordering : null);
// After an ordered turn the board animates only what followed its preview.
let shownEvents = null;
const boardEvents = () => (shownEvents?.state === state ? shownEvents.events : state.events);
function syncMusic() {
  music.setTrack(screen === 'game' && state?.status === 'playing' && document.visibilityState === 'visible' ? editionTracks(daily.date)[state.floor] : null);
}
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, () => music.unlock(), { capture: true, passive: true });
const guide = initGuide();
// Decided before anything is saved this visit: entering the dungeon creates a save.
let guidePending = false;
try { guidePending = isFirstVisit(localStorage, { prefix, scope }); } catch {}

// The newspaper dateline style, e.g. "SAT, NOVEMBER 7, 2026".
function paperDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
}
function notify(message, persistent = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').hidden = !message;
  if (!persistent) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5500);
}
function load() {
  try {
    lastSaved = localStorage.getItem(key());
    if (!lastSaved) return null;
    const parsed = JSON.parse(lastSaved);
    if (validateCurrentSave(parsed)) return parsed;
    // A run of this very edition that no longer fits: the edition was
    // regenerated since it began, so the run quietly starts fresh.
    if (parsed?.date !== daily.date || parsed?.seed !== daily.seed) notify('This save could not be read. Download a backup from the menu before starting again.', true);
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
  if (replay && next !== 'game') endReplay();
  screen = next;
  document.body.classList.toggle('playing', next === 'game');
  for (const name of ['paper', 'game', 'result']) $(`${name}-screen`).hidden = name !== next;
  if (next === 'paper') fitPaper();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (next === 'game') requestAnimationFrame(() => renderer?.resize());
  syncMusic();
}
function renderPaper() {
  $('paper-date').dateTime = daily.date;
  $('paper-date').textContent = paperDate(daily.date);
  // The weekday's difficulty tier, e.g. "DIFFICULTY: TOUGH": no clue about the dungeon itself.
  $('paper-tier').textContent = `${composedDay ? 'COMPOSED PREVIEW · ' : ''}${Object.hasOwn(DIFFICULTY_TIERS, daily.difficulty) ? tierLabel(daily.date, daily.difficulty).toUpperCase() : 'THE UNDERGROUND EDITION'}`;
  // Each story pictures one floor's target, and its headline says how it moves
  // without naming it: crack the headline and you know that monster's piece.
  $('headline').textContent = headlineFor(daily.species[0], daily.date, 0);
  $('deck').replaceChildren(createPrintLines(0));
  drawPaperArt(daily.species[0]);
  // The day's room modifier gets a bulletin under the masthead; plain days none.
  const modifier = MODIFIERS[daily.modifier] ?? MODIFIERS.none;
  $('modifier-bulletin').hidden = modifier.id === 'none';
  $('modifier-emoji').textContent = modifier.emoji;
  $('modifier-kicker').textContent = `${modifier.name}:`;
  $('modifier-headline').textContent = modifier.headline;
  $('side-stories').replaceChildren(...[1, 2].map((floor) => {
    const creature = daily.species[floor];
    const article = document.createElement('article');
    const h = document.createElement('h3'); h.textContent = headlineFor(creature, daily.date, floor);
    const p = document.createElement('p');
    p.setAttribute('aria-hidden', 'true');
    p.append(createPrintLines(floor));
    article.append(createPortrait(creature), h, p); return article;
  }));
  $('paper-screen').setAttribute('aria-label', archiveMode ? `Archive newspaper, ${shareDate(daily.date)}` : "Today's newspaper");
  $('archive-banner').hidden = !archiveMode;
  $('start-button').replaceChildren(document.createTextNode(state ? state.status === 'playing' ? practice ? 'Resume practice ' : 'Resume your descent ' : 'Read your result ' : archiveMode || composedDay ? 'Enter this dungeon ' : "Enter today's dungeon "));
  const arrow = document.createElement('span'); arrow.textContent = '↘'; arrow.ariaHidden = 'true'; $('start-button').append(arrow);
  fitPaper();
}
// On a phone the paper never scrolls: keep the roomiest print that fits
// (style.css [data-fit]). The day's headlines and bulletin, the archive banner
// and the Install bar all change how much room there is.
function fitPaper() {
  const paper = $('paper-screen');
  delete paper.dataset.fit;
  if (paper.hidden || !matchMedia('(max-width:600px)').matches) return;
  for (const fit of ['tight', 'tighter']) {
    if (document.documentElement.scrollHeight <= innerHeight) return;
    paper.dataset.fit = fit;
  }
}
addEventListener('resize', fitPaper);
document.fonts?.ready.then(fitPaper);
new ResizeObserver(fitPaper).observe($('pwa-bar'));
// The lead story's "Artist's impression": floor 1's target on an inked chess floor.
function drawPaperArt(creature) {
  const canvas = $('paper-art');
  canvas.setAttribute('aria-label', creature.name);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#302a36'; ctx.fillRect(0, 0, 180, 150);
  for (let y = 0; y < 150; y += 3) for (let x = 0; x < 180; x += 3) if ((x * 13 + y * 7) % 19 < 4) { ctx.fillStyle = '#49404d'; ctx.fillRect(x, y, 1, 1); }
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) { ctx.fillStyle = (x + y) % 2 ? '#743f47' : '#201d25'; ctx.fillRect(x * 30, 110 + y * 10, 30, 10); }
  ctx.fillStyle = '#1c1921'; ctx.fillRect(5, 0, 18, 115); ctx.fillRect(157, 0, 18, 115);
  drawSprite(ctx, creature.id, 40, 14, 5, spritePalette(creature.palette));
}
// A side story's portrait of its floor's target.
function createPortrait(creature) {
  const portrait = document.createElement('canvas');
  portrait.width = portrait.height = SPRITE_SIZE * 2;
  portrait.className = 'story-portrait';
  portrait.setAttribute('role', 'img');
  portrait.setAttribute('aria-label', creature.name);
  drawSprite(portrait.getContext('2d'), creature.id, 0, 0, 2, spritePalette(creature.palette));
  return portrait;
}
// Decorative, unreadable print: the headlines and pictures carry the clues.
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
$('newspaper').addEventListener('animationend', () => $('newspaper').classList.remove('arriving'), {once:true});
if (state || matchMedia('(prefers-reduced-motion: reduce)').matches) $('newspaper').classList.remove('arriving');
setTimeout(() => $('newspaper').classList.remove('arriving'), 1300);
renderPaper();

function ensureRenderer() {
  if (renderer) return true;
  try {
    renderer = createDungeonRenderer($('dungeon'), { onLayout: () => { reserveObjectiveRoom(); placeWaitButton(); placeBoardChips(); placeDescendButton(); fitMessageLog(); }, onTile: ({x,y}) => {
      if (!state || replay || screen !== 'game' || state.status !== 'playing' || turnLocked) return;
      if (pendingOrder()) { orderAt({ x, y }); return; }
      if (pinning) { const foe = state.enemies.find((entry) => entry.x === x && entry.y === y); pinning = false; clearPinTip(); if (foe) takeAction({ type: 'pin', id: foe.id }); updateGame(); return; }
      // A caved-in room takes no moves: the rubble carried you to the stairs, so any tap reopens the shop.
      if(cavedIn(state)){takeStairs();return;}
      if(x===state.exit.x&&y===state.exit.y-1){if(state.exit.open)takeStairs();return;}
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
// The message log: every line the engine said this visit, oldest first. A move
// can say several things (your capture, then a monster's strike), and the engine
// keeps the earlier ones in state.notes. The last two lines show; scroll for more.
const MESSAGE_LOG_MAX = 40;
let messageLog = [], loggedState = null, logGame = '', logAction = 0;
const gameKey = (game) => [game.date, game.practice ? 'practice' : 'daily', archiveMode, game.startingPiece, game.playerColor, game.difficulty].join('|');
function clearMessageLog() { messageLog = []; loggedState = null; }
function logState() {
  if (state === loggedState) return;
  if (gameKey(state) !== logGame) { clearMessageLog(); logGame = gameKey(state); }
  loggedState = state;
  // A purchase, or anything else without events, says nothing new. A fresh
  // dungeon only points out its recruit: the objective is already on screen.
  const fresh = !state.events?.length && !messageLog.length && state.status === 'playing' && state.turns === state.floorStart?.turns;
  if (!state.events?.length && !fresh) return;
  const action = ++logAction;
  const par = parFor(state, daily);
  // The engine doesn't know par, so the challenge line gets it here.
  const lines = (fresh ? [] : [...(state.notes ?? []), state.message]).filter(Boolean)
    .map((text) => par === null ? text : text.replace(/^(You completed the challenge ✓ in \d+ moves?)\./, `$1, par ${par}.`));
  messageLog.push(...lines.map((text) => ({ text, action })));
  // A new floor (or a fresh start) points out its waiting recruit.
  const recruit = waitingRecruit(state);
  if (recruit && (fresh || state.events.some((event) => event.type === 'descend' || event.type === 'restart'))) {
    messageLog.push({ text: `A ${recruit.piece} waits to join you: step onto its square to recruit it.`, action, recruit: true });
  }
  messageLog = messageLog.slice(-MESSAGE_LOG_MAX);
}
/** This floor's recruit while it still waits on its square, or null once it has joined. */
function waitingRecruit(game) {
  return game?.companion ? null : game?.items?.find((item) => item.type === 'companion') ?? null;
}
function showGameFeedback() {
  logState();
  const box = $('game-message');
  const latest = messageLog.at(-1)?.action;
  // A monster pawn capturing en passant surprises players, so its line keeps
  // a "What?" explainer button until the next action.
  const enPassantHit = state.events?.some(event => (event.type === 'player-captured' || event.type === 'damage' || event.type === 'shield') && event.enPassant);
  // So does a missed lunge, which leaves its monster off-balance (rules.js).
  const lunged = state.events?.some((event) => event.type === 'miss');
  const pairHop = state.events?.some(event => event.type === 'bishop-pair');
  // So does the ceiling's crack, which starts the cave-in countdown (src/cave-in.js).
  const cracked = state.events?.some((event) => event.type === 'cave-crack');
  const what = (label, open) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hint-button message-what';
    button.textContent = 'What?';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', open);
    return button;
  };
  box.replaceChildren(...messageLog.map((entry) => {
    const line = document.createElement('p');
    line.textContent = entry.text;
    line.classList.toggle('stale', entry.action !== latest);
    const fresh = entry.action === latest;
    if (lunged && fresh && /off-balance/.test(entry.text)) line.append(' ', what('What does off-balance mean?', () => openSpecialMove('off-balance')));
    if (enPassantHit && fresh && /en passant/i.test(entry.text)) line.append(' ', what('What is en passant?', () => openSpecialMove('en-passant', 'enemy')));
    // The recruit line keeps its explainer while that recruit still waits.
    if (entry.recruit && fresh && waitingRecruit(state)) line.append(' ', what('What is a recruit?', () => openSpecialMove('recruit')));
    // The bishop pair's "Holy duo!" line keeps its explainer until the next action.
    if (pairHop && fresh && /^Holy duo!/.test(entry.text)) line.append(' ', what('What is the bishop pair?', () => openSpecialMove('bishop-pair')));
    if (cracked && fresh && /The ceiling starts to crack!/.test(entry.text)) line.append(' ', what('What does the cracking ceiling mean?', () => openSpecialMove('cave-in')));
    return line;
  }));
  // Before the first move the log opens with how to play a turn.
  if (state.turns === 0 && !pendingOrder()) {
    const tip = document.createElement('p');
    tip.className = 'log-tip';
    tip.textContent = 'Tap your piece for legal moves. Tap Wait to skip a turn.';
    box.prepend(tip);
  }
  box.classList.toggle('scrollable', box.children.length > 2);
  box.hidden = !box.children.length;
  fitMessageLog();
}
// Exactly the last two lines fit, however they wrap; the rest is a scroll away.
function fitMessageLog() {
  const box = $('game-message');
  if (replay || box.hidden) return;
  placeMessageLog();
  box.style.maxHeight = '';
  if (box.children.length > 2) {
    const [a, b] = [...box.children].slice(-2);
    const pad = parseFloat(getComputedStyle(box).paddingTop) + parseFloat(getComputedStyle(box).paddingBottom);
    box.style.maxHeight = `${Math.ceil(a.offsetHeight + b.offsetHeight + pad)}px`;
  }
  placeMessageLog();
  box.scrollTop = box.scrollHeight;
}
// Par: the certified route's moves for this floor. Only the number shows, and
// only for the official piece and color the route was certified for.
function renderPar() {
  const par = parFor(state, daily);
  $('par-status').hidden = par === null;
  if (par === null) return;
  $('par-status').textContent = `Par ${par}`;
  $('par-status').setAttribute('aria-label', `Par ${par} moves for this floor, ${floorScoredMoves(state)} so far`);
}
// "2 over par" (or "even par") for a cleared floor that has a par, else ''.
// The shop's gold line carries it, so no toast covers the next floor's log.
function parResult(game) {
  const par = runPars(game, daily)?.[game.floor];
  if (!Number.isInteger(par)) return '';
  const diff = floorScoredMoves(game) - par;
  return diff === 0 ? 'even par' : `${Math.abs(diff)} ${diff < 0 ? 'under' : 'over'} par`;
}
// Targets still on the board, drawn in the enemy's color inside a red-edged
// frame under the objective.
function renderTargets() {
  const piece = state.objective.piece;
  const left = state.enemies.filter((foe) => (foe.role ?? foe.piece) === piece).length;
  const done = state.objective.complete || left === 0;
  $('targets').classList.toggle('done', done);
  const markers = $('target-markers');
  markers.setAttribute('aria-label', done ? `All enemy ${piece}s captured` : `${left} ${piece}${left === 1 ? '' : 's'} left`);
  const enemyPalette = piecePalette(state.playerColor === 'white' ? 'black' : 'white');
  if (done) { markers.textContent = '✓'; return; }
  markers.replaceChildren(...Array.from({ length: left }, () => {
    const marker = document.createElement('canvas');
    marker.width = marker.height = SPRITE_SIZE;
    marker.setAttribute('aria-hidden', 'true');
    drawSprite(marker.getContext('2d'), `piece-${piece}`, 0, 0, 1, enemyPalette);
    return marker;
  }));
}
function updateGame() {
  if (!state) return;
  if (state.awaitingPlayer) showMoves = true;
  $('room-label').textContent = `Floor ${state.floor + 1} / 3 · ${state.playerColor} ${state.player.piece} · ${state.playerColor === 'white' ? 'You move first' : 'Enemies move first'}`;
  $('practice-label').hidden = !practice;
  // A king can't step beside the monster king and its recruit can't take it.
  $('king-practice-note').hidden = !(practice && state.startingPiece === 'king');
  // Gold won since the door opened is at risk until the stairs bank it (src/cave-in.js).
  const risk = goldAtRisk(state);
  $('gold-status').replaceChildren(`${state.gold} gold`, ...(risk ? [Object.assign(document.createElement('span'), { className: 'gold-risk', textContent: ` · ${risk} at risk` })] : []));
  // This floor's scored moves, the count its par is measured against. It pauses
  // once the floor's challenge is complete. Practice runs (no par) show the same.
  const moves = floorScoredMoves(state);
  $('move-status').textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
  const paused = state.objective.complete;
  $('move-status').classList.toggle('paused', paused);
  $('move-status').setAttribute('aria-label', `${$('move-status').textContent} on this floor${paused ? ', paused: challenge complete, so only a capture still adds one' : ''}`);
  renderPar();
  renderTools();
  const pinnedFoe = state.enemies.find((foe) => foe.pinned && !foe.held);
  // Composed floors (dev preview): held decoys wake on a timer.
  const heldFoes = state.enemies.filter((foe) => foe.held && foe.pinned);
  $('pin-status').hidden = !pinnedFoe && !heldFoes.length;
  if (pinnedFoe) { $('pin-status').textContent = `Pinned ${pinnedFoe.pinned}`; $('pin-status').setAttribute('aria-label', `${pinnedFoe.name} pinned for ${pinnedFoe.pinned} more ${pinnedFoe.pinned === 1 ? 'move' : 'moves'}`); }
  else if (heldFoes.length) { const wake = heldFoes[0].pinned; $('pin-status').textContent = `Wake in ${wake}`; $('pin-status').setAttribute('aria-label', `${heldFoes.length} held ${heldFoes.length === 1 ? 'monster wakes' : 'monsters wake'} in ${wake} ${wake === 1 ? 'move' : 'moves'}`); }
  $('freeze-status').hidden = !state.powers.freeze;
  $('freeze-status').textContent = `Frozen ${state.powers.freeze}`;
  $('freeze-status').setAttribute('aria-label', `Enemies frozen for ${state.powers.freeze} moves`);
  $('modifier-status').textContent = modifierStatus(state);
  $('modifier-status').hidden = !$('modifier-status').textContent;
  $('modifier-status').setAttribute('aria-label', `${$('modifier-status').textContent}. Tap for what ${modifierOf(state).name} does`);
  // The combo counter shows from the second capture in a row; the third pays.
  const combo = state.combo ?? 0;
  $('combo-status').hidden = combo < 2;
  $('combo-status').classList.toggle('hot', combo >= COMBO_START);
  $('combo-status').textContent = `🔥 Combo ×${combo}`;
  $('combo-status').setAttribute('aria-label', `${combo} captures in a row${combo < COMBO_START ? `: capture again for bonus gold` : ''}`);
  $('objective-text').textContent = `Floor ${state.floor + 1} · ${captureGoal(state.objective.piece)}`;
  renderTargets();
  renderHintButton();
  $('objective').hidden = state.exit.open;
  // While the recruit waits for its order, Wait keeps it still instead.
  const holding = Boolean(pendingOrder());
  // Once the door opens Wait goes away, except while the ceiling counts down:
  // waiting for a monster to walk into range is a gamble then (src/cave-in.js).
  $('wait-button').hidden = !holding && (state.status !== 'playing' || (state.exit.open && !caveInRunning(state)));
  $('wait-button').textContent = holding ? 'Hold' : 'Wait';
  // The bishop pair's hop can't be held: the recruit must reach the other colour.
  const hopping = Boolean(pendingOrder()?.hop);
  $('wait-button').disabled = hopping;
  $('wait-button').setAttribute('aria-label', hopping ? 'Hold is off: your bishop recruit must hop to the other colour' : holding ? 'Hold: keep your recruit where it is' : 'Wait: skip your move and let the monsters act');
  reserveObjectiveRoom();
  placeWaitButton();
  placeBoardChips();
  $('descend-button').hidden = !state.exit.open;
  $('descend-button').disabled = holding;
  // During the cave-in countdown the stairs button carries the count (src/cave-in.js).
  const caving = caveInLabel(state), caveLeft = state.caveIn?.moves;
  $('descend-button').textContent = caving || (state.floor === 2 ? 'Leave dungeon ↘' : 'Take stairs ↘');
  $('descend-button').classList.toggle('caving', Boolean(caving));
  $('descend-button').classList.toggle('urgent', Boolean(caving) && caveLeft === 1);
  if (caving) $('descend-button').setAttribute('aria-label', `Take the stairs. The ceiling caves in after ${caveLeft} more ${caveLeft === 1 ? 'move' : 'moves'}.`);
  else $('descend-button').removeAttribute('aria-label');
  placeDescendButton();
  $('treasure').textContent = ` · ${state.captures} captures`;
  $('news-button').hidden = false;
  $('treasure').setAttribute('aria-label', `${state.captures} enemies captured`);
  showGameFeedback();
  if ($('shop-dialog').open) renderShop();
  paintBoard();
  fitMessageLog();
  syncMusic();
}
// The log stays up, so it sits beside the board, never over a square: below it
// on a tall screen, in the left margin on a wide one. Below the board a cramped
// strip trims it to what fits; the rest scrolls.
function placeMessageLog() {
  const box = $('game-message');
  box.classList.remove('beside', 'below');
  box.style.top = box.style.left = box.style.width = '';
  const board = renderer?.boardRect?.();
  if (!board || replay || box.hidden) return;
  // Whatever sits low on the screen (the install bar; on
  // short screens the objective or stairs button) is the floor the log stays above.
  const origin = $('dungeon').getBoundingClientRect().top;
  const floor = Math.min(board.height, ...['pwa-bar', 'objective', 'descend-button'].map((id) => {
    const rect = $(id).getBoundingClientRect();
    return rect.height && !$(id).classList.contains('beside') && rect.top - origin > (board.top + board.bottom) / 2 ? rect.top - origin : Infinity;
  })) - 8;
  const height = Math.max(box.offsetHeight, 64);
  const beside = renderer.layout?.()?.mode === 'beside' && board.left >= 170;
  // The board's bottom rim sits a little below its last row.
  const bottom = Math.max(board.bottom, renderer.layout?.()?.bottom ?? 0);
  if (floor - bottom - 8 >= height || !beside) {
    const room = Math.max(28, Math.round(floor - bottom - 8));
    if (box.offsetHeight > room) { box.style.maxHeight = `${room}px`; box.classList.add('scrollable'); }
    box.classList.add('below');
    box.style.top = `${Math.round(bottom + 8)}px`;
  } else {
    box.classList.add('beside');
    box.style.width = `${Math.round(Math.min(board.left - 24, 300))}px`;
    box.style.left = `${Math.round(Math.max(12, board.left - 12 - Math.min(board.left - 24, 300)))}px`;
    // A cramped margin trims even the last two lines; they scroll like the rest.
    // A beside objective panel holds the margin's top; the log keeps below it.
    const objective = $('objective');
    const ceiling = objective.classList.contains('beside') && !objective.hidden ? objective.getBoundingClientRect().bottom - origin + 8 : board.top;
    const room = Math.max(48, Math.round(Math.min(board.bottom, floor) - ceiling));
    if (box.offsetHeight > room) { box.style.maxHeight = `${room}px`; box.classList.add('scrollable'); }
    box.style.top = `${Math.round(Math.max(ceiling, Math.min(board.bottom, floor) - box.offsetHeight))}px`;
  }
}
// Keep the objective panel, status corner and Wait off the board. The page
// measures them and the renderer fits the board around them (layout.js): on a
// wide or short screen the objective moves into the margin left of the board,
// below the status corner; otherwise it stays centered on top and the board
// shrinks and slides down to keep the door clear. The sizes are only updated
// while the panel shows, so the board doesn't jump when the stairs open.
let waitSize = null;
let stackedTop = null;
// The board stays put for the whole floor: the room above it is measured with
// the Hint button's widest label and only grows until the floor or the screen
// changes, so fewer targets or a tool used up leave their room in place.
let heldRoom = null;
function holdRoom(measured) {
  const key = `${daily?.date}|${practice}|${state?.floor}|${innerWidth}x${innerHeight}`;
  if (heldRoom?.key !== key) heldRoom = { key };
  for (const [name, value] of Object.entries(measured)) heldRoom[name] = Math.max(heldRoom[name] ?? -Infinity, value);
  return heldRoom;
}
function widestPanelHeight(panel) {
  const hint = $('hint-button'), label = hint.textContent;
  hint.textContent = '? Hint · +1';
  const height = panel.offsetHeight;
  hint.textContent = label;
  return height;
}
// Stacked on top, the objective carries Wait at the end of its Targets and Hint
// row, so Wait needs no row of its own above the board. Beside, Wait stands alone.
function dockWait(inline) {
  const wait = $('wait-button');
  const panel = $('objective');
  if (inline && wait.parentElement !== panel) panel.append(wait);
  if (!inline && wait.parentElement === panel) $('descend-button').before(wait);
  wait.classList.toggle('inline', inline);
  if (inline) wait.style.top = wait.style.left = '';
}
function reserveObjectiveRoom() {
  const panel = $('objective');
  if (!renderer?.setPanels || replay) return;
  if (panel.hidden) dockWait(false);
  if (panel.hidden && renderer.layout()?.mode !== 'natural') return;
  const area = $('dungeon').getBoundingClientRect();
  const status = document.querySelector('.game-status').getBoundingClientRect();
  const menu = $('game-menu-button').getBoundingClientRect();
  const wait = $('wait-button');
  if (wait.offsetWidth) waitSize = { width: wait.offsetWidth, height: wait.offsetHeight };
  // Measure the panel where it sits on top, centered under the status corner.
  panel.classList.remove('beside');
  dockWait(!panel.hidden);
  panel.style.width = panel.style.left = panel.style.top = '';
  const statusBottom = status.height ? status.bottom - area.top : 0;
  const cssTop = panel.getBoundingClientRect().top - area.top;
  // Stacked, the panel sits just under the status corner and the menu button,
  // not at a fixed offset, so no dead band opens above the board.
  const menuBottom = menu.height ? menu.bottom - area.top : 0;
  const held = holdRoom({
    statusBottom, statusRight: status.right - area.left,
    stackTop: statusBottom || menuBottom ? Math.max(statusBottom, menuBottom) + 8 : cssTop,
    panelHeight: panel.hidden ? 0 : widestPanelHeight(panel),
  });
  const stackTop = held.stackTop;
  renderer.setPanels({
    stackBottom: panel.hidden ? 0 : Math.ceil(stackTop + held.panelHeight),
    status: { right: Math.ceil(held.statusRight), bottom: Math.ceil(held.statusBottom) },
    menu: menu.height ? { left: Math.floor(menu.left - area.left), bottom: Math.ceil(menu.bottom - area.top) } : null,
    wait: waitSize || { width: 80, height: 44 },
    waitInline: !panel.hidden,
  });
  if (panel.hidden) return;
  if (renderer.layout()?.mode !== 'beside') {
    stackedTop = stackTop;
    panel.style.top = `${Math.round(stackTop)}px`;
    return;
  }
  dockWait(false);
  const board = renderer.layout();
  const width = Math.min(board.left - 24, 320);
  panel.classList.add('beside');
  panel.style.width = `${Math.round(width)}px`;
  panel.style.left = `${Math.round(board.left - 12 - width)}px`;
  // Below the gold and moves in the top-left corner.
  panel.style.top = `${Math.round(Math.max(board.rowTop, held.statusBottom + 10))}px`;
}
// Wait is the one action button off the board. Stacked, it rides in the
// objective's row (dockWait); beside, it sits just above the board's top-right
// corner, or beside the corner when there is no room above it. The board
// layout keeps room for it (layout.js) and says where.
function placeWaitButton() {
  const button = $('wait-button');
  const board = renderer?.layout?.();
  if (!board || button.hidden || button.classList.contains('inline')) return;
  // The stairs hid the objective but Wait stays for the cave-in: it takes the
  // objective's empty row, right-aligned over the board.
  if (board.wait === 'inline') {
    button.style.top = `${Math.round(stackedTop ?? board.doorTop)}px`;
    button.style.left = `${Math.round(board.right - button.offsetWidth)}px`;
    return;
  }
  button.style.top = `${Math.round(board.waitTop)}px`;
  button.style.left = `${Math.round(board.wait === 'beside' ? board.waitLeft : board.right - button.offsetWidth)}px`;
}
// Frozen, Pinned and Combo come and go within a floor, so they sit left of the
// exit door, in the strip above the first row that the board keeps for the door
// anyway: one showing up never moves the board.
function placeBoardChips() {
  const strip = $('board-chips');
  const board = renderer?.layout?.(), door = renderer?.exitAnchor?.();
  strip.hidden = ![...strip.children].some((chip) => !chip.hidden) || !board || !door;
  if (strip.hidden) return;
  const square = (board.right - board.left) / 8;
  strip.style.left = `${Math.round(board.left + 4)}px`;
  strip.style.maxWidth = `${Math.max(64, Math.round(door.x - square * 0.6 - board.left - 12))}px`;
  strip.style.top = `${Math.round(Math.max(board.doorTop, board.rowTop - strip.offsetHeight - 4))}px`;
}
// The stairs button sits just above the exit door, or over the door itself when
// the board fills the screen, so it never covers a square a piece may need.
function placeDescendButton() {
  const button = $('descend-button');
  const anchor = renderer?.exitAnchor?.();
  if (!anchor || button.hidden) return;
  const height = button.offsetHeight;
  let top = Math.min(Math.max(anchor.top - 6 - height, 64), anchor.bottom - height);
  // Centred over the stairs, but never past the screen's edges or onto the Wait
  // button (the cave-in countdown label is long): it slides left, or on a very
  // narrow screen drops below Wait.
  const half = button.offsetWidth / 2, width = document.documentElement.clientWidth;
  let left = Math.min(Math.max(anchor.x, half + 8), width - half - 8);
  const wait = $('wait-button');
  if (!wait.hidden && button.offsetParent) {
    const box = wait.getBoundingClientRect(), origin = button.offsetParent.getBoundingClientRect();
    const waitTop = box.top - origin.top, waitBottom = box.bottom - origin.top, waitLeft = box.left - origin.left;
    const beside = () => top < waitBottom + 4 && top + height > waitTop - 4 && left + half > waitLeft - 6;
    if (beside()) left = Math.max(half + 8, waitLeft - 6 - half);
    if (beside()) top = waitBottom + 4;
  }
  button.style.top = `${Math.round(top)}px`;
  button.style.left = `${Math.round(left)}px`;
  button.style.bottom = 'auto';
}
function paintBoard(){
  if(!state||replay)return;
  // Waiting for the recruit's order: your move as played so far, and the recruit's squares.
  const pending=pendingOrder();
  if(pending){renderer?.render({...pending.board,events:pending.shown,danger:dangerTiles(pending.board),legalMoves:[],showMoves:false,recruitMoves:pending.moves,recruitHold:!pending.hop,cursor,pinning:false,...hintMarks(pending.board)});return;}
  renderer?.render({...state,events:boardEvents(),danger:dangerTiles(state),legalMoves:legalMoves(state),showMoves:showMoves&&!pinning,cursor,pinning,...hintMarks(state)});
}
// Paid hints stay on the board for the rest of the floor: rings around the
// targets, and the danger map (recomputed every move).
function hintMarks(game) {
  const bought = game.hints ?? [];
  return { suspects: bought.includes('suspects') ? targetSpecies(game).id : null, closeRange: bought.includes('danger') ? closeRangeSquares(game) : null };
}
// Shop tools: Pin waits for a tapped monster; Borrow shows its ghosted moves; Take back undoes one.
const BORROW_GLYPH = { knight: '♘', queen: '♕' };
function renderTools() {
  // A caved-in room takes no more moves or pins: only Take back is left there.
  const pin = state.status === 'playing' && state.powers.pin > 0 && pinUsable(state) && !cavedIn(state);
  const leap = state.status === 'playing' && state.powers.leap > 0 && !cavedIn(state);
  // The move that ended a run is taken back from the Captured page, not the fresh floor one.
  const back = Boolean(takebackTarget(state)) && !restarted(state);
  // A held Take back shows from the floor's start, greyed until there is a move
  // to undo, so the tray (and the board below it) never shifts when it wakes.
  const held = state.status === 'playing' && state.powers.takeback > 0 && !restarted(state);
  if (!pin) pinning = false;
  $('pin-button').hidden = !pin; $('leap-button').hidden = !leap; $('takeback-button').hidden = !(back || held);
  $('tool-tray').hidden = !(pin || leap || back || held);
  // Tools wait until the recruit has its order; the tray stays put so the board doesn't move.
  for (const id of ['pin-button', 'leap-button', 'takeback-button']) $(id).disabled = Boolean(pendingOrder());
  if (!back) $('takeback-button').disabled = true;
  // Pressed, Pin keeps its label (a longer one could wrap the tray): the notice says what to tap.
  $('pin-button').setAttribute('aria-pressed', String(pinning));
  $('pin-button').setAttribute('aria-label', pinning ? 'Pin: now tap a monster' : 'Pin a monster for three moves');
  $('leap-button').textContent = `Borrow ${BORROW_GLYPH[borrowedPiece(state)]}`;
  $('leap-button').setAttribute('aria-label', `Show your borrowed move: move once like a ${borrowedPiece(state)}`);
}
const PIN_TIP = 'Tap any monster to pin it for three moves.';
// The pin tip goes once the pin is placed or called off.
function clearPinTip() { if ($('notice').textContent === PIN_TIP) notify(''); }
$('pin-button').addEventListener('click', () => {
  if (!state || turnLocked || replay) return;
  pinning = !pinning; showMoves = false;
  if (pinning) notify(PIN_TIP); else clearPinTip();
  updateGame();
});
// Borrowed squares are always on offer; the button just points them out.
$('leap-button').addEventListener('click', () => {
  if (!state || turnLocked || replay) return;
  pinning = false; showMoves = true; cursor = null; updateGame(); paintBoard();
  notify(`Squares with a ghosted ${borrowedPiece(state)} move like one. Only taking one spends the borrowed move.`);
});
$('takeback-button').addEventListener('click', () => { pinning = false; takeAction({ type: 'takeback' }); });
const restarted = (game) => game?.events.some(event => event.type === 'restart');
// A run ended with a Take-back still held: the Captured page offers it until it's used or declined.
const deathTakeback = () => state?.status === 'playing' && restarted(state) && Boolean(takebackTarget(state));
function enterGame() {
  refreshEdition();
  refreshFromOtherWindow();
  if (state?.status && state.status !== 'playing') return showResult();
  if (deathTakeback()) return showDeath();
  switchScreen('game');
  if (!ensureRenderer()) return;
  if (!state) { state = newGame(); save(); }
  updateGame();
  openFirstVisitGuide();
  // Back in a caved-in room (a reload, or the app reopened): the rubble already carried you to the shop.
  if (cavedIn(state)) takeStairs();
}
// A brand-new player lands on the board with the Quick start open, once. Play
// (or closing it) leaves them on the board, ready for their first move.
function openFirstVisitGuide() {
  if (!guidePending || screen !== 'game' || state?.status !== 'playing' || document.querySelector('dialog[open]')) return;
  guidePending = false;
  try { markGuideSeen(localStorage, scope); } catch {}
  openMenu();
  guide.openQuickStart();
}
$('start-button').addEventListener('click', enterGame);
// Monster pawns always march down the board, toward the side the player started on.
const HINT_MOVES = {
  pawn: 'An enemy pawn steps one square down the board, toward the side you started on (two from the second row from the top). It captures one square diagonally downward.',
  knight: 'A knight jumps in an L: two squares one way, then one to the side. It leaps over obstacles and other pieces.',
  rook: 'A rook slides any distance up, down, left or right until something blocks it.',
  bishop: 'A bishop slides any distance diagonally until something blocks it.',
  queen: 'A queen slides any distance up, down, sideways or diagonally until something blocks it.',
  king: 'A king steps one square in any direction.',
};
// Hints, per floor (src/rules.js nextHint): the first card, how the target's
// role moves, is free; each paid one adds a move to the floor's score. The
// button says "Hint · +1" once the next one would cost a move.
let hintFrame = 0;
let hintSeen = '';
const hintFloor = () => `${gameKey(state)}|${state.tries ?? 1}|${state.floor}`;
function renderHintButton() {
  const next = nextHint(state);
  const free = hintSeen !== hintFloor() && !state.hints?.length;
  $('hint-button').textContent = free || !next ? '? Hint' : '? Hint · +1';
  $('hint-button').setAttribute('aria-label', free ? `Hint: how an enemy ${state.objective.piece} moves` : next ? 'Hints: the next one adds a move to this floor' : 'Hints');
}
// Every card unlocked on this floor pages, in unlock order (src/rules.js
// hintCards): the free one first. The dialog opens on the newest; paging is free.
let hintPage = 0;
function openHint() {
  if (!state || screen !== 'game' || document.querySelector('dialog[open]')) return;
  hintSeen = hintFloor();
  // Open first: the move demo keeps animating only while the dialog is open.
  $('hint-dialog').showModal();
  hintPage = hintCards(state).length - 1;
  renderHint();
  renderHintButton();
}
// One card, the pager (once there are two), and one button for the next hint.
// `slide` is the direction it was paged from: -1 back, 1 forward.
function renderHint(slide = 0) {
  cancelAnimationFrame(hintFrame);
  const piece = state.objective.piece;
  const cards = hintCards(state);
  hintPage = Math.max(0, Math.min(cards.length - 1, hintPage));
  const card = cards[hintPage];
  const art = $('hint-art');
  $('hint-clue').hidden = card !== 'moves';
  if (card === 'moves') {
    const article = piece === 'pawn' ? 'an enemy pawn' : `a ${piece}`;
    $('hint-title').textContent = `How ${article} moves`;
    $('hint-move').textContent = HINT_MOVES[piece];
    art.setAttribute('aria-label', `Animated board: ${HINT_MOVES[piece]}`);
    const options = { enemy: true, palette: piecePalette(state.playerColor === 'white' ? 'black' : 'white') };
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const frame = (now) => {
      drawMoveDemo(art, piece, still ? 1800 * 0.6 : now - start, options);
      if (!still && $('hint-dialog').open) hintFrame = requestAnimationFrame(frame);
    };
    frame(start);
  } else if (card === 'suspects') {
    // The 'suspects' hint identifies the target (the id stays for saved runs).
    const line = targetLine(state);
    $('hint-title').textContent = 'The target';
    $('hint-move').textContent = line[0].toUpperCase() + line.slice(1);
    art.setAttribute('aria-label', `${targetSpecies(state).name}, the target, in a police lineup`);
    drawTargetCard(art, targetSpecies(state));
  } else {
    $('hint-title').textContent = 'Danger map';
    $('hint-move').textContent = 'Hatched squares: end your move on one and a monster captures you at once. The map updates after every move.';
    art.setAttribute('aria-label', 'A monster with the eight squares around it hatched in black and white');
    drawDangerCard(art, { playerPalette: piecePalette(state.playerColor) });
  }
  $('hint-pager').hidden = cards.length < 2;
  $('hint-page').textContent = `${hintPage + 1} / ${cards.length}`;
  $('hint-back').disabled = hintPage === 0;
  $('hint-forward').disabled = hintPage === cards.length - 1;
  // A short slide from the side it came from (CSS; none under reduced motion).
  const holder = $('hint-card');
  holder.classList.remove('from-left', 'from-right');
  if (slide) { void holder.offsetWidth; holder.classList.add(slide < 0 ? 'from-left' : 'from-right'); }
  const next = nextHint(state);
  $('hint-next').hidden = !next;
  $('hint-next').textContent = next === 'suspects' ? 'Identify the target · +1 move' : 'Show danger map · +1 move';
}
function flipHint(step) {
  const page = hintPage + step;
  if (!state || !$('hint-dialog').open || page < 0 || page >= hintCards(state).length) return;
  hintPage = page;
  renderHint(step);
}
$('hint-button').addEventListener('click', openHint);
$('hint-back').addEventListener('click', () => flipHint(-1));
$('hint-forward').addEventListener('click', () => flipHint(1));
$('hint-dialog').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  flipHint(event.key === 'ArrowLeft' ? -1 : 1);
});
// A horizontal swipe on the card flips it: left for the next, right for the previous.
let hintSwipe = null;
$('hint-card').addEventListener('pointerdown', (event) => {
  hintSwipe = event.pointerType === 'mouse' ? null : { id: event.pointerId, x: event.clientX, y: event.clientY };
});
$('hint-card').addEventListener('pointerup', (event) => {
  if (hintSwipe?.id !== event.pointerId) return;
  const dx = event.clientX - hintSwipe.x, dy = event.clientY - hintSwipe.y;
  hintSwipe = null;
  if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) flipHint(dx < 0 ? 1 : -1);
});
$('hint-card').addEventListener('pointercancel', () => { hintSwipe = null; });
$('hint-next').addEventListener('click', () => {
  const next = state && nextHint(state);
  if (!next || !takeAction({ type: 'hint', hint: next })) return;
  // Straight to the card just bought.
  hintPage = hintCards(state).length - 1;
  renderHint(1);
  // The last hint hides its button: keep focus inside the dialog.
  if ($('hint-next').hidden) $('hint-dialog').querySelector('[data-close]').focus();
});
document.querySelectorAll('canvas[data-clue-art="unmask"]').forEach(drawUnmaskExample);
const EN_PASSANT = {
  player: {
    title: 'You captured a pawn en passant!',
    text: 'A pawn that advances two squares past an enemy pawn can be captured as if it had moved only one. You get that chance only on the very next move. This is called ‘en passant!’',
    art: 'Animated board: an enemy pawn advances two squares past your pawn, and your pawn captures it by moving diagonally into the square it skipped.',
  },
  enemy: {
    title: 'What just happened? En passant',
    text: 'Your pawn’s two-square move passed the square a monster pawn attacks, so it captured you as if you had moved only one. It can only do that right after your two-square move. This is called ‘en passant!’',
    art: 'Animated board: your pawn advances two squares past an enemy pawn, which captures it by moving diagonally into the square your pawn skipped.',
  },
};
const CASTLE = {
  title: 'You castled!',
  text: 'Your king and rook, one of them your recruit, stood on one row with two open squares between them. The king slid two squares toward the rook and the rook hopped over to land beside it, both in one move. This is called ‘castling!’',
  art: 'Animated board: a king slides two squares toward a rook, and the rook hops over the king to land on the square beside it.',
};
let specialMoveFrame = 0;
// Explains a special chess move: en passant ('player' after the player's own
// capture, 'enemy' after a monster pawn's) or castling.
function openSpecialMove(kind, mode = 'player') {
  if (!state || document.querySelector('dialog[open]')) return;
  if (TACTIC_COPY[kind] || kind === 'recruit' || kind === 'bishop-pair') return openTactic(kind);
  const castle = kind === 'castle';
  const copy = castle ? CASTLE : EN_PASSANT[mode];
  const canvas = $('special-move-art');
  $('special-move-title').textContent = copy.title;
  $('special-move-text').textContent = copy.text;
  $('special-move-close').setAttribute('aria-label', `Close ${castle ? 'castling' : 'en passant'} explainer`);
  canvas.setAttribute('aria-label', copy.art);
  [canvas.width, canvas.height] = castle ? [240, 120] : [200, 200];
  const playerPalette = piecePalette(state.playerColor);
  const options = castle
    ? { playerPalette, player: state.player.piece === 'rook' ? 'rook' : 'king' }
    : { mode, playerPalette, enemyPalette: piecePalette(state.playerColor === 'white' ? 'black' : 'white') };
  const draw = castle ? drawCastleDemo : drawEnPassantDemo;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const frame = (now) => {
    draw(canvas, still ? (castle ? CASTLE_STILL : EN_PASSANT_STILL) : now - start, options);
    if (!still && $('special-move-dialog').open) specialMoveFrame = requestAnimationFrame(frame);
  };
  $('special-move-dialog').showModal();
  $('special-move-continue').focus();
  frame(start);
}
// The first fork won and the first combo on this device get the same dialog,
// with their own animated explainer (tactics-art.js), as do the What? buttons
// of a waiting recruit and of the bishop pair's hop.
function openTactic(kind) {
  const copy = kind === 'recruit' ? RECRUIT_COPY : kind === 'bishop-pair' ? BISHOP_PAIR_COPY : TACTIC_COPY[kind];
  if (TACTIC_COPY[kind]) try { localStorage.setItem(tacticSeenKey(kind), '1'); } catch {}
  const canvas = $('special-move-art');
  $('special-move-title').textContent = copy.title;
  $('special-move-text').textContent = copy.text;
  $('special-move-close').setAttribute('aria-label', `Close ${kind} explainer`);
  canvas.setAttribute('aria-label', copy.art);
  [canvas.width, canvas.height] = [200, 200];
  const options = { playerPalette: piecePalette(state.playerColor) };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const frame = (now) => {
    copy.draw(canvas, still ? copy.still : now - start, options);
    if (!still && $('special-move-dialog').open) specialMoveFrame = requestAnimationFrame(frame);
  };
  $('special-move-dialog').showModal();
  $('special-move-continue').focus();
  frame(start);
}
// Kept outside the save prefix so backups never carry it.
const tacticSeenKey = (kind) => `dchess-tactic-seen:${scope}:${kind}`;
function tacticSeen(kind) { try { return localStorage.getItem(tacticSeenKey(kind)) === '1'; } catch { return false; } }
// A brief "Fork!", "Combo!" or "Holy duo!" stamp over the board.
let calloutTimer;
function showTacticCallout(events) {
  const won = events.find((event) => event.type === 'fork-won');
  const combo = events.find((event) => event.type === 'combo');
  const fork = events.find((event) => event.type === 'fork');
  const pair = events.some((event) => event.type === 'bishop-pair');
  const parts = [pair && 'Holy duo!', won && `Fork won! +${won.gold}`, combo && `Combo ×${combo.count}! +${combo.gold}`, !won && !combo && fork && 'Fork! 🔱'].filter(Boolean);
  if (!parts.length) return;
  const callout = $('tactic-callout');
  callout.textContent = parts.join(' · ');
  callout.classList.toggle('combo', Boolean(combo));
  callout.hidden = false;
  callout.classList.remove('pop'); void callout.offsetWidth; callout.classList.add('pop');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => { callout.hidden = true; }, 1600);
}
$('special-move-dialog').addEventListener('close', () => cancelAnimationFrame(specialMoveFrame));
$('modifier-status').addEventListener('click', () => { if (state) notify(modifierOf(state).explain); });
// The rubble comes down (renderer.js), then the shop opens with what the
// cave-in cost: the rubble carried the player down the stairs (src/cave-in.js
// cavedIn). An explainer that opened on the same move goes first.
const CAVE_IN_TO_SHOP_MS = 1400;
let caveNews = null;
// The shop's last purchase, shown on its gold line until the shop closes.
let shopNote = '';
function announceCaveIn(event) {
  const caved = state;
  caveNews = { game: gameKey(state), floor: state.floor, event };
  setTimeout(() => shopAfterCaveIn(caved), CAVE_IN_TO_SHOP_MS);
}
function shopAfterCaveIn(caved) {
  if (state !== caved || !cavedIn(state) || screen !== 'game' || $('shop-dialog').open) return;
  const open = document.querySelector('dialog[open]');
  if (open) open.addEventListener('close', () => setTimeout(() => shopAfterCaveIn(caved)), { once: true });
  else takeStairs();
}
$('wait-button').addEventListener('click', () => (pendingOrder() ? giveOrder('hold') : takeAction({ type: 'wait' })));
$('hint-dialog').addEventListener('close', () => cancelAnimationFrame(hintFrame));
$('news-button').addEventListener('click', () => {$('menu-dialog').close();renderPaper();switchScreen('paper');$('start-button').focus({preventScroll:true});});
function takeAction(action) {
  // Purchases happen inside their own dialog: the shop's, or a paid hint on the hint card.
  const shopping = (action.type === 'buy' && $('shop-dialog').open) || (action.type === 'hint' && $('hint-dialog').open);
  if (screen !== 'game' || !state || state.status !== 'playing' || turnLocked || (!shopping && document.querySelector('dialog[open]'))) return false;
  if (refreshFromOtherWindow()) return false;
  // Manual recruit control: show the move first, then take the recruit's order.
  if (recruitManual && (action.type === 'move' || action.type === 'wait') && action.recruit === undefined) {
    const choice = recruitChoice(state, action);
    if (choice?.moves.length) return beginOrder(action, choice);
    // A recruit with nowhere to go just holds.
    if (choice) action = { ...action, recruit: 'hold' };
  }
  const pending = pendingOrder();
  const next = act(state, action);
  if (next === state) return false;
  // Composed king floors (dev preview): checkmate gets its moment.
  if (preview && next.events.some((event) => event.type === 'checkmate')) { setTimeout(() => preview.celebrateCheckmate(), 380); playSound([{ type: 'win' }]); }
  turnLocked=!shopping;
  ordering = null;
  // The preview already played this turn up to the recruit's phase; the board animates the rest.
  const continues = pending && JSON.stringify(next.events.slice(0, pending.phase)) === JSON.stringify(pending.shown);
  shownEvents = continues ? { state: next, events: next.events.slice(pending.phase) } : null;
  state = next;showMoves=state.awaitingPlayer;cursor=null;save();updateGame();playSound(boardEvents());
  const caveIn = state.events.find(event => event.type === 'cave-in');
  if (caveIn) {
    announceCaveIn(caveIn);
  }
  if (!shopping) showTacticCallout(state.events);
  // A waiting recruit's explainer never opens here, only from its line's What? button.
  const special = autoExplainer(state.events, tacticSeen);
  const animationTime = (special || state.events.some(event => event.type === 'companion-phase' || event.type === 'recruit') ? 600 : 400) + (renderer?.skidTime(state.events) ?? 0);
  // The cracking ceiling's explainer waits for the shake and the stairs countdown to show first.
  const explainAt = special === 'cave-in' ? 1100 : animationTime;
  if (!shopping) setTimeout(()=>{turnLocked=false;},animationTime);
  // Congratulate the player's own en passant or castle once the move has settled,
  // unless another action, a death, a result or the bot replay has taken over since.
  if (special) {
    const played = state;
    setTimeout(() => {
      if (state === played && !replay && screen === 'game' && state.status === 'playing' && !state.events.some(event => event.type === 'restart')) openSpecialMove(special, 'player');
    }, explainAt);
  }
  if (!shopping && !special) {
    const played = state;
    setTimeout(() => { if (state === played) offerHopelessRestart(); }, animationTime);
  }
  if (state.status !== 'playing') setTimeout(() => { if (state.status !== 'playing') showResult(); }, animationTime);
  else if (state.events.some(event => event.type === 'restart')) setTimeout(() => {
    if (screen === 'game' && state.status === 'playing' && state.events.some(event => event.type === 'restart')) showDeath();
  }, animationTime);
  return true;
}
// The recruit's order under Manual control. Your move is already on the board;
// a square marked green moves the recruit there, and the recruit itself (or
// Hold, or Space) keeps it still. The move can't be taken back here: it was played.
const ORDER_TIP = 'Now move your recruit: tap a square marked green, or tap the recruit (or Hold) to keep it still.';
// The bishop pair (rules.js pairHop): the new bishop must hop to the other colour, so it can't hold.
const HOP_TIP = 'Your bishop recruit hops onto the other colour: tap a square marked green.';
function beginOrder(action, choice) {
  ordering = { from: state, action, board: choice.board, phase: choice.phase, moves: choice.moves, shown: choice.board.events.slice(0, choice.phase), hop: Boolean(choice.hop) };
  showMoves = false; pinning = false; cursor = null;
  // A short pause so a double tap on the destination can't also give the order.
  turnLocked = true;
  setTimeout(() => { turnLocked = false; }, 250);
  updateGame();
  playSound(ordering.shown);
  if (ordering.hop) notify(HOP_TIP);
  else if (!tacticSeen('recruit-order')) notify(ORDER_TIP);
  return true;
}
function giveOrder(recruit) {
  const pending = pendingOrder();
  if (pending?.hop && recruit === 'hold') { notify(HOP_TIP); return false; }
  if (!pending || !takeAction({ ...pending.action, recruit })) return false;
  try { localStorage.setItem(tacticSeenKey('recruit-order'), '1'); } catch {}
  return true;
}
function orderAt({ x, y }) {
  const pending = pendingOrder();
  const recruit = pending?.board.companion;
  if (!recruit) return false;
  if (x === recruit.x && y === recruit.y) return giveOrder('hold');
  if (pending.moves.some((tile) => tile.x === x && tile.y === y)) return giveOrder({ x, y });
  notify(pending.hop ? HOP_TIP : ORDER_TIP);
  return false;
}
// Keyboard: once your move shows, the cursor starts on the recruit.
function cursorOnRecruit() {
  const recruit = pendingOrder()?.board.companion;
  if (recruit) { cursor = { x: recruit.x, y: recruit.y }; paintBoard(); }
}
function orderKey(event, name) {
  const recruit = pendingOrder().board.companion;
  if (directions[name]) { event.preventDefault(); const [dx, dy] = directions[name]; cursor ??= { x: recruit.x, y: recruit.y }; cursor = { x: Math.max(0, Math.min(7, cursor.x + dx)), y: Math.max(0, Math.min(7, cursor.y + dy)) }; paintBoard(); }
  else if (name === 'Enter' && cursor) { event.preventDefault(); orderAt(cursor); }
  else if (name === ' ' || name === '.') { event.preventDefault(); giveOrder('hold'); }
  else if (name === 'Escape') { cursor = { x: recruit.x, y: recruit.y }; paintBoard(); }
}
const directions={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
window.addEventListener('keydown',event=>{
  if(event.target instanceof Element && event.target.closest('button,input,textarea,select,a'))return;
  if(screen!=='game'||!state||replay||turnLocked||document.querySelector('dialog[open]')||event.metaKey||event.ctrlKey||event.altKey)return;
  const name=event.key.length===1?event.key.toLowerCase():event.key;
  if(pendingOrder()){orderKey(event,name);return;}
  if(directions[name]){event.preventDefault();const [dx,dy]=directions[name];cursor??={x:state.player.x,y:state.player.y};const x=Math.max(0,Math.min(7,cursor.x+dx));const door=state.exit.open&&x===state.exit.x&&cursor.y+dy===state.exit.y-1;cursor={x,y:door?state.exit.y-1:Math.max(0,Math.min(7,cursor.y+dy))};showMoves=true;paintBoard();}
  else if(name==='Enter'&&cursor){event.preventDefault();if(cursor.x===state.exit.x&&cursor.y===state.exit.y-1){if(state.exit.open)takeStairs();}else{takeAction({type:'move',...cursor});cursorOnRecruit();}}
  else if(name===' '||name==='.'){event.preventDefault();takeAction({type:'wait'});cursorOnRecruit();}
  else if(name==='Escape'){showMoves=false;pinning=false;clearPinTip();cursor=null;updateGame();}
});
function renderShop() {
  // After a cave-in the shop opens with what it cost (src/cave-in.js caveInLoss).
  const news = $('shop-news');
  news.hidden = !cavedIn(state);
  if (cavedIn(state)) {
    const event = state.events.find((entry) => entry.type === 'cave-in') ?? (caveNews?.game === gameKey(state) && caveNews.floor === state.floor ? caveNews.event : null);
    const loss = event ? caveInLoss(event) : '';
    news.replaceChildren(Object.assign(document.createElement('b'), { textContent: 'The ceiling caved in!' }), ...(loss ? [` ${loss}`] : []));
  }
  const result = parResult(state);
  $('shop-gold').textContent = shopNote ? `${shopNote} · ${state.gold} gold left` : `Floor ${state.floor + 1} cleared · ${result ? `${result} · ` : ''}${state.gold} gold`;
  $('shop-descend').textContent = `Descend to floor ${state.floor + 2} ↘`;
  for (const power of SHOP_ITEMS) {
    let button = document.querySelector(`[data-power="${power.id}"]`);
    if (!button) {
      button = document.createElement('button');
      button.dataset.power = power.id;
      const icon = document.createElement('canvas');
      icon.width = icon.height = SPRITE_SIZE * 2; icon.className = 'shop-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.getContext('2d').imageSmoothingEnabled = false;
      drawSprite(icon.getContext('2d'), `power-${power.id}`, 0, 0, 2);
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      const text = document.createElement('div');
      text.append(title, detail);
      button.append(icon, text);
      // A purchase is confirmed on the gold line, so the shop never grows (and never scrolls).
      button.addEventListener('click', () => {
        if (takeAction({type:'buy', id:power.id})) { shopNote = `${power.name} bought`; renderShop(); }
      });
      $('shop-items').append(button);
    }
    const owned = state.powers[power.id];
    // Each shop shows only the day's three offers (src/edition.js).
    button.hidden = !shopOffers(state).includes(power.id);
    button.disabled = state.gold < power.cost || owned >= power.max;
    button.querySelector('strong').textContent = `${power.name} · ${power.cost} gold`;
    // What the player already has, worded so it never reads as the shop's stock.
    const held = power.id === 'magnet' ? 'already active' : `you hold ${owned}`;
    button.querySelector('span').textContent = `${power.description}${owned ? ` (${held})` : ''}`;
  }
}
// The shop is offered once a floor is cleared, as the player takes its stairs.
// The last floor has no shop: its stairs end the run.
function takeStairs() {
  // A move waiting on its recruit's order finishes first.
  if (screen !== 'game' || !state || state.status !== 'playing' || turnLocked || !state.exit.open || pendingOrder() || document.querySelector('dialog[open]')) return;
  if (refreshFromOtherWindow() || !state.exit.open) return;
  if (state.floor === 2) { takeAction({type:'descend'}); return; }
  shopNote = '';
  renderShop();
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
    let notes = events.some(e=>e.type==='win') ? [392,494,587,784] : events.some(e=>e.type==='descend') ? [330,440,660] : events.some(e=>e.type === 'player-captured') ? [110,82] : events.some(e=>e.type==='capture'||e.type==='companion-capture') ? [220,440] : events.some(e=>e.type==='hit') ? [180,100] : events.some(e=>e.type==='pickup'||e.type==='companion-recruit') ? [660,880] : [85];
    notes.forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.018,audio.currentTime+i*.065);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+i*.065+.07);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(audio.currentTime+i*.065);oscillator.stop(audio.currentTime+i*.065+.08);});
  } catch {}
}
// Archive and practice runs are labeled so a shared line never passes as today's.
const runLabel = () => [composedDay && 'COMPOSED', archiveMode && 'ARCHIVE', practice && 'PRACTICE'].filter(Boolean).join(' ');
function shareText(){if (!isOfficialRun(state, daily)) return '';const text=getShareText(state, runPars(state, daily));const label=runLabel();return label ? text.replace('Dungeon Chess Daily',`Dungeon Chess Daily · ${label}`) : text;}
function showResult() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  switchScreen('result');
  const won=state.status==='won';
  $('result-date').textContent=paperDate(daily.date);
  $('result-kicker').hidden=!runLabel();
  $('result-kicker').textContent=`${runLabel()} EDITION`;
  $('result-title').textContent=won?'You made the headlines.':'Some stories bury the lead.';
  $('result-summary').textContent=won?'Your story lives to see another day.':state.message;
  if (state.status === 'lost') return showDeath();
  showResultActions(true);
  const shareable = isOfficialRun(state, daily);
  $('share-preview').hidden = !shareable;
  $('share-button').hidden = !shareable;
  // The card without its link. Should a line wrap, it breaks only between the title's
  // parts or between floors: no-break spaces hold each part and each floor together.
  const hold = (line, gap) => line.split(gap).map(part => part.replaceAll(' ', '\u00A0')).join(gap);
  const [title, floors] = shareable ? shareText().split('\n') : [];
  $('share-preview').textContent=shareable ? `${hold(title, ' · ')}\n${hold(floors, '  ')}` : '';
  const next = archiveMode ? 'Find more past editions in the menu’s Archive.' : 'Next edition at 00:00 UTC.';
  renderBotComparison();
  $('next-edition').textContent=shareable ? `🟥 ⬛ 👑 Floors 1–3: moves over (+) or under (−) par, E for even · 🇫🇷 En passant · 🏰 Castled · 🔱 Fork won, on that floor\n${next}` : next;
  $(shareable || composedDay ? 'share-button' : 'practice-button').focus({preventScroll:true});
  refreshEdition();
}
function showResultActions(finished) {
  if (!finished) $('bot-compare').hidden = true;
  $('retry-button').hidden = finished;
  $('death-takeback-button').hidden = finished || !deathTakeback();
  $('retry-button').classList.toggle('primary', $('death-takeback-button').hidden);
  $('result-actions').hidden = !finished;
  if (!finished) { $('share-preview').hidden = true; $('share-button').hidden = true; }
}
// A cornered piece ends the try, so the only way forward is another one.
function showDeath() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  switchScreen('result');
  showResultActions(false);
  $('result-date').textContent=paperDate(daily.date);
  $('result-kicker').hidden=!runLabel();
  $('result-kicker').textContent=`${runLabel()} EDITION`;
  $('result-title').textContent='Cornered.';
  $('result-summary').textContent='No legal moves left. The dungeon has the last word — this time.';
  $('next-edition').textContent=deathTakeback()?'Take back that move, or try again from floor one.':'Try again from floor one.';
  $(deathTakeback() ? 'death-takeback-button' : 'retry-button').focus({preventScroll:true});
}
$('death-takeback-button').addEventListener('click',()=>{
  if (!deathTakeback()) return;
  state = act(state, { type: 'takeback' }); save();
  showMoves = false; cursor = null; turnLocked = false;
  enterGame();
});
$('retry-button').addEventListener('click',()=>{
  if (!state) return;
  if (state.status === 'lost') { state = retryLostRun(state); save(); }
  if (state.status !== 'playing') return;
  // Trying again declines the Take-back: the fresh run doesn't carry it.
  if (deathTakeback()) { state = structuredClone(state); delete state.undo; save(); }
  showMoves = false; cursor = null; turnLocked = false;
  enterGame();
});
$('share-button').addEventListener('click',async()=>{
  if (!state || state.status === 'playing' || !isOfficialRun(state, daily)) return;
  const text=shareText();
  if(navigator.share){try{await navigator.share({text});return;}catch(error){if(error.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(text);notify('Edition copied. Ready to paste — no spoilers.');}
  catch{$('copy-text').value=text;$('copy-dialog').showModal();$('copy-text').select();}
});
function updatePieceWarning() {
  $('piece-warning').hidden = $('practice-piece').value === daily.playerPiece && $('practice-color').value === daily.playerColor && $('practice-monsters').value === daily.difficulty;
  $('king-warning').hidden = $('practice-piece').value !== 'king';
}
// Piece, color and monsters start on the run's own: the day's, or the practice run's.
function openPieceChooser() {
  if (turnLocked || !state || !(practice || canChoosePiece(state))) return;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('practice-piece').value = state.startingPiece;
  $('practice-color').value = state.playerColor;
  $('practice-monsters').value = TIER_IDS.includes(state.difficulty) ? state.difficulty : daily.difficulty;
  $('official-piece').textContent = `${archiveMode ? 'This edition’s' : 'Today’s'} official piece: ${daily.playerColor} ${daily.playerPiece}.`;
  $('piece-start').textContent = state.status === 'playing' ? 'Restart dungeon' : 'Start practice';
  updatePieceWarning();
  $('piece-dialog').showModal();
}
for (const piece of PIECES) {
  const option = document.createElement('option');
  option.value = piece; option.textContent = piece[0].toUpperCase() + piece.slice(1);
  $('practice-piece').append(option);
}
// Every ruleset (src/difficulty.js): the rooms stay the day's, only the monsters change.
for (const tier of TIER_IDS) $('practice-monsters').append(new Option(DIFFICULTY_TIERS[tier].name, tier));
for (const id of ['practice-piece', 'practice-color', 'practice-monsters']) $(id).addEventListener('change', updatePieceWarning);
$('practice-button').addEventListener('click', () => { if (!composedDay) openPieceChooser(); });
$('change-piece-button').addEventListener('click', openPieceChooser);
$('piece-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!state || !(practice || canChoosePiece(state))) return;
  const next = createPracticeGame(daily, { piece: $('practice-piece').value, color: $('practice-color').value, difficulty: $('practice-monsters').value });
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
// The game's own yes/no dialog. The browser's confirm() is silently refused
// in some embedded and in-app browsers, which made restarting do nothing.
let confirmResolve = null;
function askConfirm(title, text, ok, cancel = 'Cancel') {
  confirmResolve?.(false);
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = ok;
  $('confirm-cancel').textContent = cancel;
  $('confirm-dialog').showModal();
  $('confirm-ok').focus();
  return new Promise((resolve) => { confirmResolve = resolve; });
}
$('confirm-ok').addEventListener('click', () => {
  const resolve = confirmResolve; confirmResolve = null;
  $('confirm-dialog').close();
  resolve?.(true);
});
$('confirm-dialog').addEventListener('close', () => {
  const resolve = confirmResolve; confirmResolve = null;
  resolve?.(false);
});
// Voluntary resets cost nothing: no extra try.
function startOver(next, message) {
  $('menu-dialog').close();
  hopelessShown = null;
  state = next; showMoves = false; cursor = null; turnLocked = false;
  clearMessageLog();
  save(); enterGame(); notify(message);
}
// A floor that can no longer be finished (src/rules.js hopelessFloor) says so
// once per stuck position and offers the menu's floor restart.
let hopelessShown = null;
async function offerHopelessRestart() {
  if (replay || screen !== 'game' || !state || state.status !== 'playing' || !state.floorSnapshot || document.querySelector('dialog[open]')) return;
  // A recruit under Manual control may still take the targets your piece can't reach.
  if (!hopelessFloor(state, { manualRecruit: recruitManual })) return;
  const piece = state.objective.piece;
  const targets = state.enemies.filter((foe) => (foe.role ?? foe.piece) === piece);
  const position = JSON.stringify([daily.date, practice, state.floor, state.player.piece, state.powers.leap, targets.map((foe) => [foe.id, foe.x, foe.y])]);
  if (hopelessShown === position) return;
  hopelessShown = position;
  const floor = state.floor + 1;
  const what = targets.length === 1 ? `the ${piece === 'king' ? '' : 'last '}${piece}` : `the last ${targets.length} ${piece}s`;
  const who = recruitManual && (state.companion || waitingRecruit(state)) ? 'Neither your piece nor your recruit can ever' : 'Your piece can never';
  if (!await askConfirm('This floor can’t be finished', `${who} reach ${what} from here. Restart floor ${floor} to try again: you keep the gold and powers you arrived with. Moves already made here still count toward this floor’s score.`, `Restart floor ${floor}`, 'Keep playing')) return;
  if (!state || state.status !== 'playing' || !state.floorSnapshot || state.floor + 1 !== floor) return;
  refreshFromOtherWindow();
  startOver(resetFloor(state), `Floor ${floor} restarted.`);
}
$('reset-floor-button').addEventListener('click', async () => {
  if (!state || state.status !== 'playing' || !state.floorSnapshot) return;
  if (!await askConfirm(`Restart floor ${state.floor + 1}?`, 'You keep the gold and powers you arrived with. Moves already made here still count toward this floor’s score.', `Restart floor ${state.floor + 1}`)) return;
  if (!state || state.status !== 'playing' || !state.floorSnapshot) return;
  refreshFromOtherWindow();
  startOver(resetFloor(state), `Floor ${state.floor + 1} restarted.`);
});
$('reset-day-button').addEventListener('click', async () => {
  if (!state) return;
  // A run begun before the UTC rollover still holds yesterday's edition; "today's"
  // must not quietly mean that one, so let the player pick which to start.
  if (!archiveMode && !composedDay) {
    const current = getDaily();
    if (current.date !== daily.date) {
      const day = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      rolloverDates = { current: daily.date, next: current.date };
      $('rollover-text').textContent = `This run is from ${shareDate(daily.date)}. The ${shareDate(current.date)} edition came out since it began. Restarting discards this run; today’s edition leaves it saved in the archive.`;
      $('rollover-new').textContent = `Start today’s · ${day(current.date)}`;
      $('rollover-current').textContent = `Restart ${practice ? 'practice · ' : ''}${day(daily.date)}`;
      $('rollover-dialog').showModal();
      $('rollover-new').focus();
      return;
    }
  }
  if (!await askConfirm(`Restart ${archiveMode ? 'this' : 'today’s'} ${practice ? 'practice ' : ''}dungeon?`, 'You start again from floor 1, and this run is discarded.', 'Restart from floor 1')) return;
  if (!state) return;
  const next = practice ? createPracticeGame(daily, { piece: state.startingPiece, color: state.playerColor, difficulty: state.difficulty }) : newGame();
  startOver(next, `${archiveMode ? 'This' : 'Today’s'} dungeon restarted from floor 1.`);
});
let rolloverDates = null;
$('rollover-new').addEventListener('click', () => {
  $('rollover-dialog').close();
  if (rolloverDates) openEdition(rolloverDates.next);
});
$('rollover-current').addEventListener('click', () => {
  $('rollover-dialog').close();
  if (!state || rolloverDates?.current !== daily.date) return;
  const next = practice ? createPracticeGame(daily, { piece: state.startingPiece, color: state.playerColor, difficulty: state.difficulty }) : newGame();
  startOver(next, `The ${shareDate(daily.date)} dungeon restarted from floor 1.`);
});
$('result-paper-button').addEventListener('click',()=>{
  if(!archiveMode&&!composedDay){
    const current=getDaily();
    if(current.date!==daily.date){daily=current;setPracticeMode(false);state=load();}
  }
  renderPaper();switchScreen('paper');
});
// Switch the whole app to another edition: its paper, official run or practice.
function openEdition(date) {
  if (turnLocked) return;
  // The composed preview plays one day; any other edition opens the real game.
  if (composedDay) { save(); location.href = location.pathname; return; }
  save();
  const current = getDaily();
  archiveMode = date !== current.date;
  try {
    daily = archiveMode ? getDaily(date) : current;
  } catch (error) {
    console.error(error);
    archiveMode = daily.date !== current.date;
    notify('That edition could not be opened. Try again after updating the app.', true);
    return;
  }
  try { if (archiveMode) sessionStorage.setItem(archiveSessionKey, daily.date); else sessionStorage.removeItem(archiveSessionKey); } catch {}
  try { practice = localStorage.getItem(practiceModeKey()) === 'true'; } catch { practice = false; }
  rolloverNotice = '';
  // Notices describe the edition being left; load() may post one for the new one.
  notify('');
  showMoves = false; cursor = null;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('result-paper-button').textContent = 'Read the paper';
  state = load();
  if (practice && !state) { setPracticeMode(false); state = load(); }
  renderPaper(); switchScreen('paper');
  $('start-button').focus({ preventScroll: true });
}
const ARCHIVE_MARKS = { won: '★', lost: '✕', playing: '•', unplayed: '' };
let archiveShown = null;
function archiveDay({ date, day, open, today, status }) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `archive-day is-${status}`;
  button.classList.toggle('is-today', today);
  button.disabled = !open;
  if (date === daily.date) button.setAttribute('aria-current', 'date');
  button.setAttribute('aria-label', `${shareDate(date)}${today ? ', today' : ''}${open ? `, ${STATUS_LABELS[status].toLowerCase()}` : ''}`);
  const number = document.createElement('span'); number.textContent = day;
  const mark = document.createElement('span'); mark.className = 'archive-mark'; mark.textContent = ARCHIVE_MARKS[status];
  button.append(number, mark);
  if (open) button.addEventListener('click', () => openEdition(date));
  item.append(button);
  return item;
}
function renderArchive() {
  const read = (name) => { try { return localStorage.getItem(`${prefix}${name}`); } catch { return null; } };
  const view = archiveMonth(archiveShown, getDaily().date, FIRST_EDITION_DATE, read);
  const [year, month] = view.month.split('-').map(Number);
  $('archive-month').textContent = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  $('archive-previous').disabled = !view.previous;
  $('archive-next').disabled = !view.next;
  const blanks = Array.from({ length: view.blanks }, () => { const item = document.createElement('li'); item.setAttribute('aria-hidden', 'true'); return item; });
  $('archive-days').replaceChildren(...blanks, ...view.days.map(archiveDay));
}
function openArchive() {
  if (turnLocked) return;
  save();
  archiveShown = daily.date.slice(0, 7);
  renderArchive();
  $('menu-dialog').close();
  $('archive-dialog').showModal();
  $('archive-days').querySelector('[aria-current]')?.focus({ preventScroll: true });
}
for (const [id, by] of [['archive-previous', -1], ['archive-next', 1]]) {
  $(id).addEventListener('click', () => { archiveShown = shiftMonth(archiveShown, by); renderArchive(); });
}
$('archive-button').addEventListener('click', openArchive);
$('today-button').addEventListener('click', () => openEdition(getDaily().date));
$('archive-today-button').addEventListener('click', () => openEdition(getDaily().date));
function progressStatus(message) {
  $('progress-feedback').textContent = message;
  $('progress-feedback').hidden = !message;
  if (message) $('progress-feedback').closest('details').open = true;
}
const persistentStorage = initPersistentStorage({ button: $('persist-button'), onStatus: progressStatus });
function openMenu() {
  progressStatus('');
  $('change-piece-button').hidden = Boolean(composedDay) || !(practice || canChoosePiece(state));
  $('daily-button').hidden = !practice;
  $('reset-floor-button').hidden = !(state?.status === 'playing' && state.floorSnapshot);
  $('reset-day-button').hidden = !state;
  $('reset-day-button').textContent = archiveMode ? 'Restart this dungeon' : 'Restart today’s dungeon';
  $('news-button').textContent = archiveMode ? 'Read this edition’s paper' : 'Read today’s paper';
  $('today-button').hidden = !archiveMode;
  $('menu-dialog').showModal();
  persistentStorage.refresh();
}
$('menu-button').addEventListener('click',openMenu);
$('game-menu-button').addEventListener('click',openMenu);
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('sound-toggle').addEventListener('change',()=>{sound=$('sound-toggle').checked;try{localStorage.setItem(`${prefix}sound`,sound?'on':'off');}catch{}});
$('music-toggle').addEventListener('change',()=>{musicOn=$('music-toggle').checked;try{localStorage.setItem(`${prefix}music`,musicOn?'on':'off');}catch{}music.setEnabled(musicOn);music.unlock();syncMusic();});
$('recruit-control').addEventListener('change',()=>{recruitManual=$('recruit-control').value!=='auto';try{localStorage.setItem(`${prefix}recruit`,recruitManual?'manual':'auto');}catch{}$('recruit-auto-note').hidden=recruitManual;});
$('export-button').addEventListener('click',()=>{
  const saves={};
  try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(name.startsWith(prefix)&&!name.includes('practice:')&&name!==`${prefix}music`&&name!==`${prefix}recruit`)saves[name.slice(prefix.length)]=localStorage.getItem(name);}}
  catch{}
  if(state&&!practice)saves[`daily:v11:${daily.date}`]=JSON.stringify(state);
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
  // A past edition (or the composed preview) stays open until the player returns to today themselves.
  if (archiveMode || composedDay) return;
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
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshFromOtherWindow();refreshEdition();}syncMusic();});
setInterval(refreshEdition, 60_000);
initPWA({installButton:$('install-button'),updateButton:$('update-button'),onBeforeUpdate:async()=>save(),onStatus:notify});
getReleaseVersion().then(version=>{$('release').textContent=`Release ${version}`;}).catch(()=>{});

// WordleBot-style comparison: after beating the daily run with the official
// piece, set the player's moves beside the Dungeon Bot's (src/bot.js): the
// human-like bot when it cleared every floor, else the certified route.
// Practice wins never reveal it, so it cannot spoil a daily run still in play.
const BOT_NOTES = {
  human: 'This bot plays like a careful player: it sees only what you see, steers its recruit, and never goes out of its way for a powerup. Its moves on each floor set that floor’s par.',
  certified: 'Today the careful bot couldn’t clear every floor, so this is the route that proved the dungeon can be won: no powerups, never captured (pawn days at most four times), no ally but the floor 3 recruit.',
  planted: 'This is the line each floor was built around: a shortest win, never captured. Par is one move more.',
};
let botCache = null;
function currentBot() {
  const id = `${daily.date}:${daily.seed}`;
  if (botCache?.id !== id) botCache = { id, run: dungeonBot(daily) };
  return botCache.run;
}
function renderBotComparison() {
  const you = !practice && isOfficialRun(state, daily) ? playerRun(state) : null;
  const bot = you ? currentBot() : null;
  $('bot-compare').hidden = !bot;
  if (!bot) return;
  $('bot-verdict').textContent = verdict(you, bot);
  $('bot-note').textContent = BOT_NOTES[bot.kind];
  // One column per stat, one row each for you and the bot, so it stays short on a phone.
  const columns = [
    ...bot.floors.map((moves, index) => [`F${index + 1}`, `Floor ${index + 1} moves`, you.floors[index] ?? '–', moves]),
    ['Total', 'Total moves', you.moves, bot.moves, 'bot-total'],
    ...(you.tries > 1 ? [['Tries', 'Tries', you.tries, 1]] : []),
  ];
  const cell = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  $('bot-head').replaceChildren(cell('td'), ...columns.map(([short, long, , , className]) => {
    const th = cell('th', short, className); th.scope = 'col'; th.title = long; th.setAttribute('aria-label', long); return th;
  }));
  const rows = ['You', 'Bot'].map((label) => { const tr = document.createElement('tr'); const th = cell('th', label); th.scope = 'row'; tr.append(th); return tr; });
  for (const [, , mine, theirs, className] of columns) {
    const cells = [mine, theirs].map((value) => cell('td', value, className));
    if (typeof mine === 'number' && typeof theirs === 'number') cells[mine <= theirs ? 0 : 1].classList.add('bot-best');
    rows[0].append(cells[0]); rows[1].append(cells[1]);
  }
  $('bot-rows').replaceChildren(...rows);
}

// Watching the bot reuses the dungeon view without touching the saved run.
const REPLAY_SPEEDS = [{ label: '1×', ms: 1400 }, { label: '2×', ms: 750 }, { label: '½×', ms: 2400 }];
function replayFrame() {
  const frame = replay.run.frames[replay.index];
  const last = replay.index === replay.run.frames.length - 1;
  renderer.render({ ...frame, danger: dangerTiles(frame), legalMoves: [], showMoves: false, cursor: null });
  // Count as the comparison table does: scored moves, so a step taken after a
  // floor's challenge is complete (walking to the stairs) doesn't add one.
  // The human-like bot plays each floor from its standard start, so earlier
  // floors count from the run itself rather than the frame's records.
  const total = replay.run.moves;
  const current = frame.records.find((record) => record.floor === frame.floor);
  const moves = replay.run.floors.slice(0, frame.floor).reduce((sum, floor) => sum + floor, 0)
    + (current ? scoredMoves(current) : floorScoredMoves(frame));
  $('replay-label').textContent = last
    ? `Bot escaped in ${total} moves`
    : `Bot · Floor ${frame.floor + 1}/3 · Move ${moves}${frame.exit?.open ? ' ✓' : ''} of ${total}`;
  // Engine messages coach the player ("Tap the stairs…"); keep only what happened.
  const said = replay.index && !frame.awaitingPlayer ? ([...(frame.notes ?? []), frame.message].join(' ').match(/[^.!?]+[.!?]*/g) ?? []).filter((part) => !/\b(tap|choose|take the stairs)\b/i.test(part)).join('').trim().replace(/\bjoins you\b/, 'joins the bot').replace(/\bYou completed\b/, 'The bot completed').replace(/\bYou dropped\b/, 'The bot dropped') : '';
  $('game-message').textContent = last ? 'The bot escapes the dungeon.' : frame.events.some((event) => event.type === 'descend') ? `The bot takes the stairs to floor ${frame.floor + 1}.` : said;
  $('game-message').hidden = !$('game-message').textContent;
  // Drop the live game's placement (an inline top plus the replay's own
  // bottom would stretch the log's dark box over the board).
  placeMessageLog();
  $('game-message').classList.remove('scrollable'); $('game-message').style.maxHeight = '';
  $('replay-play').textContent = last ? '↻' : replay.playing ? '❚❚' : '▶';
  $('replay-play').setAttribute('aria-label', last ? 'Watch again' : replay.playing ? 'Pause replay' : 'Play replay');
  $('replay-step').disabled = last;
  if (replay.index) playSound(frame.events);
}
function scheduleReplay() {
  clearTimeout(replay.timer);
  if (!replay.playing || replay.index >= replay.run.frames.length - 1) { replay.playing = false; return; }
  const frame = replay.run.frames[replay.index];
  // Hold a little longer on each new floor so the room can be read, and on an ice skid while it slides.
  const pause = REPLAY_SPEEDS[replay.speed].ms * (replay.index === 0 || frame.events.some((event) => event.type === 'descend') ? 1.6 : 1) + (renderer?.skidTime(frame.events) ?? 0);
  replay.timer = setTimeout(() => { replay.index++; replayFrame(); scheduleReplay(); }, pause);
}
function startBotReplay() {
  const run = currentBot();
  if (!run || !state || state.status !== 'won') return;
  switchScreen('game');
  if (!ensureRenderer()) return;
  replay = { run, index: 0, playing: true, speed: replay?.speed ?? 0, timer: 0 };
  document.body.classList.add('replaying');
  $('replay-bar').hidden = false;
  $('replay-speed').textContent = REPLAY_SPEEDS[replay.speed].label;
  replayFrame();
  scheduleReplay();
  $('replay-play').focus({ preventScroll: true });
}
function endReplay() {
  clearTimeout(replay.timer);
  replay = null;
  document.body.classList.remove('replaying');
  $('replay-bar').hidden = true;
  $('game-message').hidden = true;
}
function stopBotReplay() {
  if (!replay) return;
  endReplay();
  showResult();
  $('bot-watch').focus({ preventScroll: true });
}
$('bot-watch').addEventListener('click', startBotReplay);
$('replay-exit').addEventListener('click', stopBotReplay);
$('replay-play').addEventListener('click', () => {
  if (!replay) return;
  if (replay.index >= replay.run.frames.length - 1) { replay.index = 0; replay.playing = true; replayFrame(); }
  else { replay.playing = !replay.playing; replayFrame(); }
  scheduleReplay();
});
$('replay-step').addEventListener('click', () => {
  if (!replay || replay.index >= replay.run.frames.length - 1) return;
  replay.playing = false; clearTimeout(replay.timer);
  replay.index++; replayFrame();
});
$('replay-restart').addEventListener('click', () => {
  if (!replay) return;
  replay.index = 0; replayFrame(); scheduleReplay();
});
$('replay-speed').addEventListener('click', () => {
  if (!replay) return;
  replay.speed = (replay.speed + 1) % REPLAY_SPEEDS.length;
  $('replay-speed').textContent = REPLAY_SPEEDS[replay.speed].label;
  $('replay-speed').setAttribute('aria-label', `Replay speed ${REPLAY_SPEEDS[replay.speed].label}`);
  scheduleReplay();
});
window.addEventListener('keydown', (event) => { if (replay && event.key === 'Escape') { event.preventDefault(); stopBotReplay(); } });
