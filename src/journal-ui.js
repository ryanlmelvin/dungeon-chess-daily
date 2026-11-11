// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The journal on screen (src/journal.js is the book and its bookkeeping):
// - the Journal dialog, opened from the menu: one lesson page at a time,
//   paged with ‹ ›, the arrow keys or a swipe; pages not found yet show dark;
// - a one-line cue on the screens the game already shows after a floor (the
//   shop between floors, the results paper), naming the idea just found;
// - the moment: when a find is new, its lesson page appears for a few seconds
//   over that screen's heading and flies into the cue's book. It never takes
//   a tap, never opens a dialog and never delays the next action; under
//   reduced motion the cue's line is all there is.
// This module builds its own elements and styles (journal.css), so the page
// and the main script only call it: initJournal({ prefix }).
import './journal.css';
import { PAGES, UNFOUND_TEXT, JOURNAL_KEY, BACKFILL_VERSION, pageFor, emptyJournal, readJournal, writeJournal, fileRun, floorFinds, backfill, pagePieces, journalProgress } from './journal.js';
import { drawBook, BOOK_SIZE } from './journal-art.js';
import { drawSprite, piecePalette, SPRITE_SIZE } from './sprites.js';
import { getDaily, validateSave, RULES_VERSION } from './game.js';

/** How long a new page shows before it flies into the journal, and how long it flies. */
const MOMENT_MS = { arrive: 220, hold: 2600, fly: 620 };
/** The page's diagram plays faster while it shows, so the moment ends on the idea's payoff. */
const MOMENT_SPEED = 1.6;
/** A checkmate's burst (src/checkmate.js) plays first. */
const AFTER_BURST_MS = 2300;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function bookIcon() {
  const canvas = el('canvas', { width: BOOK_SIZE, height: BOOK_SIZE, className: 'journal-book' });
  canvas.setAttribute('aria-hidden', 'true');
  drawBook(canvas.getContext('2d'));
  return canvas;
}

/**
 * Set the journal up: its menu button, dialog and cues. `prefix` is the
 * app's storage prefix (main.js). Returns what the main script calls:
 * clearedFloor(state, daily) as the shop opens, wonRun(state, daily) as the
 * results paper shows, restored() after a backup merge, and open(id).
 */
export function initJournal({ prefix, storage = localStorage }) {
  const $ = (id) => document.getElementById(id);
  const storageKey = `${prefix}${JOURNAL_KEY}`;
  let filled = false;

  function read() {
    try { return readJournal(storage.getItem(storageKey)); } catch { return emptyJournal(); }
  }
  function store(journal) {
    try { storage.setItem(storageKey, writeJournal(filled ? { ...journal, filled: BACKFILL_VERSION } : journal)); } catch {}
    renderProgress();
  }
  // Back-fill once from the official runs already saved here, silently: what
  // those floors found is in the book before any screen can call it new.
  function fill(force = false) {
    if (filled && !force) return;
    const journal = read();
    filled = true;
    if (journal.filled === BACKFILL_VERSION && !force) return;
    const head = `${prefix}daily:v${RULES_VERSION}:`;
    const runs = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i);
        if (!name?.startsWith(head)) continue;
        try {
          const run = JSON.parse(storage.getItem(name));
          if (run?.date === name.slice(head.length) && validateSave(run, run.date)) runs.push(run);
        } catch {}
      }
    } catch { return; }
    // A brand-new device has nothing to file, and stores nothing yet.
    if (!runs.length && !Object.keys(journal.finds).length) return;
    store(backfill(journal, runs, getDaily));
  }

  // The menu's button shares Archive's row (journal.css), with pages found of pages there are.
  const progress = el('span', { id: 'journal-progress' });
  const menuButton = el('button', { id: 'journal-button', type: 'button' }, 'Journal ', progress);
  $('archive-button').after(menuButton);
  function renderProgress() {
    const { found, total } = journalProgress(read());
    progress.textContent = `${found}/${total}`;
    menuButton.setAttribute('aria-label', `Journal: ${found} of ${total} pages found`);
  }

  // The book: one page at a time.
  const art = el('canvas', { width: 200, height: 200, className: 'journal-art' });
  art.setAttribute('role', 'img');
  const name = el('h3', { id: 'journal-name' });
  const text = el('p', { className: 'journal-text' });
  const pieces = el('p', { className: 'journal-pieces' });
  pieces.setAttribute('role', 'img');
  const page = el('article', { className: 'journal-page' }, el('div', { className: 'journal-art-box' }, art), name, text, pieces);
  page.setAttribute('aria-live', 'polite');
  const back = el('button', { type: 'button', textContent: '‹' });
  back.setAttribute('aria-label', 'Previous page');
  const forward = el('button', { type: 'button', textContent: '›' });
  forward.setAttribute('aria-label', 'Next page');
  const count = el('span', { className: 'journal-count' });
  const close = el('button', { type: 'button', className: 'icon-button', textContent: '✕' });
  close.setAttribute('aria-label', 'Close journal');
  const dialog = el('dialog', { id: 'journal-dialog' },
    el('div', { className: 'dialog-heading' }, el('h2', { id: 'journal-title', textContent: 'Journal' }), close),
    page,
    el('div', { className: 'hint-pager journal-pager' }, back, count, forward));
  dialog.setAttribute('aria-labelledby', 'journal-title');
  document.body.append(dialog);

  let index = 0;
  let frame = 0;
  function pieceMark(piece, found) {
    const canvas = el('canvas', { width: SPRITE_SIZE, height: SPRITE_SIZE, className: found ? '' : 'missing' });
    canvas.setAttribute('aria-hidden', 'true');
    drawSprite(canvas.getContext('2d'), `piece-${piece}`, 0, 0, 1, piecePalette('black'));
    return canvas;
  }
  // `slide` is the direction the page was turned from: -1 back, 1 forward.
  function render(slide = 0) {
    cancelAnimationFrame(frame);
    const journal = read();
    const lesson = PAGES[index];
    const found = Boolean(journal.finds[lesson.id]);
    page.classList.toggle('unfound', !found);
    name.textContent = found ? lesson.name : '? ? ?';
    text.textContent = found ? lesson.text : UNFOUND_TEXT[lesson.kind];
    const marks = pagePieces(journal, lesson);
    const withPieces = marks.filter((mark) => mark.found).map((mark) => mark.piece);
    pieces.replaceChildren(el('span', { textContent: found ? 'Found with' : 'With' }), ...marks.map((mark) => pieceMark(mark.piece, mark.found)));
    pieces.setAttribute('aria-label', found
      ? `Found with ${withPieces.join(', ')}${withPieces.length < marks.length ? `; not yet with ${marks.filter((mark) => !mark.found).map((mark) => mark.piece).join(', ')}` : ''}`
      : `Not found yet. It can be found with ${marks.map((mark) => mark.piece).join(', ')}`);
    art.setAttribute('aria-label', found ? `${still() ? 'Board' : 'Animated board'}: ${lesson.art}` : 'A page not found yet');
    count.textContent = `${index + 1} / ${PAGES.length}`;
    back.disabled = index === 0;
    forward.disabled = index === PAGES.length - 1;
    page.classList.remove('from-left', 'from-right');
    if (slide) { void page.offsetWidth; page.classList.add(slide < 0 ? 'from-left' : 'from-right'); }
    // A page not found yet shows only where its diagram starts, darkened (journal.css).
    if (!found) { lesson.draw(art, 0); return; }
    if (still()) { lesson.draw(art, lesson.still); return; }
    const start = performance.now();
    const step = (now) => {
      lesson.draw(art, now - start);
      if (dialog.open) frame = requestAnimationFrame(step);
    };
    step(start);
  }
  function turn(by) {
    const next = index + by;
    if (!dialog.open || next < 0 || next >= PAGES.length) return;
    index = next;
    render(by);
  }
  /** Open the journal, on the page of `id` when it has one. */
  function open(id) {
    fill();
    stopMoment();
    const at = PAGES.findIndex((lesson) => lesson.id === id);
    if (at >= 0) index = at;
    if (!dialog.open) dialog.showModal();
    render();
    close.focus({ preventScroll: true });
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => cancelAnimationFrame(frame));
  back.addEventListener('click', () => turn(-1));
  forward.addEventListener('click', () => turn(1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    turn(event.key === 'ArrowLeft' ? -1 : 1);
  });
  // A horizontal swipe turns the page, as on the hint cards.
  let swipe = null;
  page.addEventListener('pointerdown', (event) => { swipe = event.pointerType === 'mouse' ? null : { id: event.pointerId, x: event.clientX, y: event.clientY }; });
  page.addEventListener('pointerup', (event) => {
    if (swipe?.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) turn(dx < 0 ? 1 : -1);
  });
  page.addEventListener('pointercancel', () => { swipe = null; });
  menuButton.addEventListener('click', () => { $('menu-dialog').close(); open(); });

  // The cue: one quiet line on a screen the game already shows, and the book a new page flies into.
  function makeCue() {
    const label = el('span');
    const cue = el('button', { type: 'button', className: 'journal-cue', hidden: true }, bookIcon(), label);
    cue.addEventListener('click', () => open(cue.dataset.page));
    return cue;
  }
  const shopCue = makeCue();
  $('shop-gold').after(shopCue);
  const resultCue = makeCue();
  $('result-summary').after(resultCue);
  $('shop-dialog').addEventListener('close', stopMoment);

  let moment = null;
  function stopMoment() {
    if (!moment) return;
    clearTimeout(moment.timer);
    cancelAnimationFrame(moment.frame);
    moment.card.remove();
    moment = null;
  }
  // The lesson page, small: it sits on `stage`'s bottom edge for a moment, then flies into the cue's book.
  function showMoment(lesson, kicker, cue, stage, delay) {
    stopMoment();
    if (still()) return;
    const canvas = el('canvas', { width: 200, height: 200 });
    const card = el('div', { className: 'journal-flyer' }, canvas, el('div', {}, el('small', { textContent: kicker }), el('b', { textContent: lesson.name }), el('span', { textContent: lesson.text })));
    card.setAttribute('aria-hidden', 'true');
    const run = { card, timer: 0, frame: 0 };
    moment = run;
    run.timer = setTimeout(() => {
      // Still the screen it was for?
      if (moment !== run || cue.hidden || !cue.getClientRects().length) { if (moment === run) stopMoment(); return; }
      (cue.closest('dialog') ?? document.body).append(card);
      const edge = stage.getBoundingClientRect(), box = card.getBoundingClientRect();
      card.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - box.width - 8, edge.left + (edge.width - box.width) / 2)))}px`;
      card.style.top = `${Math.round(Math.max(8, edge.bottom - box.height))}px`;
      const start = performance.now();
      const step = (now) => {
        if (moment !== run) return;
        // The screen it was for has gone: so has the moment.
        if (!cue.getClientRects().length) { stopMoment(); return; }
        lesson.draw(canvas, (now - start) * MOMENT_SPEED);
        run.frame = requestAnimationFrame(step);
      };
      step(start);
      card.animate([{ opacity: 0, transform: 'translateY(12px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: MOMENT_MS.arrive, easing: 'ease-out' });
      run.timer = setTimeout(() => {
        if (moment !== run) return;
        const from = card.getBoundingClientRect(), to = cue.querySelector('.journal-book').getBoundingClientRect();
        if (!to.width) { stopMoment(); return; }
        const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const flight = card.animate(
          [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${Math.max(0.06, to.width / from.width)})`, opacity: 0.5 }],
          { duration: MOMENT_MS.fly, easing: 'cubic-bezier(.5,0,.75,.35)', fill: 'forwards' });
        const land = () => {
          if (moment !== run) return;
          stopMoment();
          cue.classList.remove('landed'); void cue.offsetWidth; cue.classList.add('landed');
        };
        flight.onfinish = land;
        // A page that isn't being drawn (a hidden tab) never finishes its flight: it lands anyway.
        run.timer = setTimeout(land, MOMENT_MS.fly + 400);
      }, MOMENT_MS.arrive + MOMENT_MS.hold);
    }, delay);
  }

  // File what `floors` of the run found, then say so on `cue`: a new page (or a
  // page new with this piece) by name, with its moment; else at most the name
  // of the idea found on `quietFloor`, quietly.
  function cueFinds(cue, stage, state, daily, floors, quietFloor, delay = 0) {
    fill();
    const before = read();
    const { journal, fresh } = fileRun(before, state, daily, floors);
    if (journal !== before) store(journal);
    const news = fresh.filter((find) => pageFor(find.id));
    const pages = news.filter((find) => find.page);
    const known = floorFinds(state, daily, quietFloor).map(pageFor).find((lesson) => lesson?.kind === 'idea');
    const names = (finds) => finds.map((find) => pageFor(find.id).name).join(', ');
    const label = cue.querySelector('span');
    cue.classList.remove('landed');
    cue.classList.toggle('new', news.length > 0);
    if (pages.length) label.textContent = `New ${pages.length > 1 ? 'pages' : 'page'}: ${names(pages)}`;
    else if (news.length) label.textContent = `${names(news)}: first with a ${state.startingPiece}`;
    else label.textContent = known?.name ?? '';
    cue.hidden = !label.textContent;
    cue.dataset.page = (pages[0] ?? news[0])?.id ?? known?.id ?? '';
    cue.setAttribute('aria-label', `${label.textContent}. Open the journal`);
    const first = pages[0] ?? news[0];
    if (first) showMoment(pageFor(first.id), first.page ? 'New page' : `First with a ${state.startingPiece}`, cue, stage, delay);
    else stopMoment();
  }

  renderProgress();
  // Soon after start, off the first paint; any screen that needs it sooner runs it itself.
  setTimeout(fill, 600);
  return {
    open,
    /** As the shop opens on a cleared floor: file what the floor found and cue it there. */
    clearedFloor(state, daily) {
      cueFinds(shopCue, $('shop-dialog').querySelector('.dialog-heading'), state, daily, [state.floor], state.floor);
    },
    /** As the results paper shows a won run: file the run and cue the king floor's find. */
    wonRun(state, daily) {
      if (state?.status !== 'won') { resultCue.hidden = true; stopMoment(); return; }
      cueFinds(resultCue, $('result-title'), state, daily, [0, 1, 2], 2, document.querySelector('.checkmate-burst') ? AFTER_BURST_MS : 300);
    },
    /** After a backup merge: the restored runs' finds join the book, silently. */
    restored() { fill(true); renderProgress(); },
  };
}
