// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
// The menu's Stats page and the paper's streak, drawn from the ledger (src/stats.js).
import { holdStreak, openLedger, shareStreak, streakMark } from './stats.js';

// The black glyphs, as on the share card; ♟ asks for its text form (U+FE0E).
const PIECE_MARKS = { knight: '♞', bishop: '♝', rook: '♜', queen: '♛', pawn: '♟\uFE0E', king: '♚' };
// The five daily pieces; a king only when an early edition was won with one.
const DAILY_PIECES = ['knight', 'bishop', 'rook', 'queen', 'pawn'];
const TOTALS = [['played', 'Played'], ['won', 'Won'], ['streak', 'Streak'], ['best', 'Best']];
const PAR_ROWS = [['\u2212', 'Under par'], ['E', 'Even'], ['+1', '1 over par'], ['+2', '2 over par'], ['+3+', '3 or more over par']];

function element(tag, text, className) {
  const made = document.createElement(tag);
  if (text !== undefined) made.textContent = text;
  if (className) made.className = className;
  return made;
}

/** Fill the Stats page from a summary (summarize in src/stats.js). */
export function renderStats(summary, { totals, par, pieces }) {
  totals.replaceChildren(...TOTALS.map(([key, label]) => {
    const total = element('div');
    total.append(element('dt', label), element('dd', summary[key]));
    return total;
  }));
  // Bars share one scale: the fullest row spans the page.
  const most = Math.max(1, ...summary.par);
  par.replaceChildren(...PAR_ROWS.map(([mark, label], index) => {
    const row = element('li', undefined, index < 2 ? 'is-par' : '');
    const name = element('abbr', mark);
    name.title = label;
    const bar = element('span', summary.par[index], summary.par[index] ? 'stats-bar' : 'stats-bar is-empty');
    bar.style.setProperty('--share', summary.par[index] / most);
    row.append(name, bar);
    return row;
  }));
  pieces.replaceChildren(...[...DAILY_PIECES, ...(summary.pieces.king ? ['king'] : [])].map((piece) => {
    const item = element('li');
    const mark = element('span', PIECE_MARKS[piece]);
    mark.title = piece;
    item.append(mark, ` ${summary.pieces[piece]}`);
    return item;
  }));
}

/** The paper's streak beside the edition number: nothing below a streak of 2. */
export function renderStreak(chip, streak) {
  const mark = streakMark(streak);
  chip.hidden = !mark;
  chip.textContent = mark;
  if (mark) chip.setAttribute('aria-label', `${streak}-day streak`);
}

/** The device's ledger, with the Stats page wired to its menu button. */
export function initStats(prefix) {
  const $ = (id) => document.getElementById(id);
  let storage = null;
  try { storage = globalThis.localStorage; } catch {}
  const ledger = openLedger(storage, prefix);
  $('stats-button').addEventListener('click', () => {
    renderStats(ledger.summary(), { totals: $('stats-totals'), par: $('stats-par'), pieces: $('stats-pieces') });
    $('menu-dialog').close();
    $('stats-dialog').showModal();
  });
  return {
    note: ledger.note,
    adopt: ledger.adopt,
    /** Today's paper shows the streak; a past edition's doesn't. */
    paper: (chip, today) => renderStreak(chip, today ? ledger.streak() : 0),
    /** A card with the streak that ended on its edition's own day; none if that day wasn't won on its day. */
    card: (text, date) => shareStreak(text, ledger.streakOn(date)),
    holdStreak,
  };
}
