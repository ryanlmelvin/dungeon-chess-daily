// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The dev-only preview of composed days (src/composer.js, phase 0 of
// docs/puzzle-first-idea.md). src/main.js loads this module only in a dev
// build opened with ?composed=YYYY-MM-DD, so published builds never carry it.
import { composeDay, START_SETS, COMPOSED_STARTS } from './composer.js';
import { RULES_VERSION } from './rules.js';

// The start set the page's query names (&starts=e2 or wide), else the composer's own.
const startsFor = (search) => { const name = new URLSearchParams(search).get('starts'); return Object.hasOwn(START_SETS, name ?? '') ? name : COMPOSED_STARTS; };

/** The composed day the page's query names, or null. */
export function composedDayFor(search) {
  const date = new URLSearchParams(search).get('composed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  try { return composeDay(date, { starts: startsFor(search) }).daily; } catch (error) { console.error(error); return null; }
}

/** Each start set saves apart; e2 keeps the key earlier previews used. */
export const composedSaveTag = (search) => (startsFor(search) === 'e2' ? 'composed:' : `composed:${startsFor(search)}:`);

/** A saved composed run belongs to its day: the same date and the same rooms. */
export function composedSaveFits(value, daily) {
  return value?.schema === RULES_VERSION && value.date === daily.date && JSON.stringify(value.composed) === JSON.stringify(daily.composed);
}

const STYLE = `
.checkmate-burst { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 0.15em; pointer-events: none; z-index: 60; animation: checkmate-fade 2.6s ease-out forwards; }
.checkmate-burst::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 50% 46%, rgba(255, 210, 100, 0.5), rgba(255, 210, 100, 0) 58%); animation: checkmate-glow 2.6s ease-out forwards; }
.checkmate-king { position: relative; font-size: min(30vw, 150px); line-height: 1; color: #f6d27a; text-shadow: 0 0 22px rgba(255, 196, 70, 0.85), 0 5px 0 #6b4a12; transform-origin: 50% 92%; animation: checkmate-topple 1.15s cubic-bezier(0.55, -0.35, 0.7, 1.35) 0.2s forwards; }
.checkmate-burst strong { position: relative; font: 700 min(13vw, 60px)/1 Georgia, 'Times New Roman', serif; letter-spacing: 0.04em; color: #fff3c4; text-shadow: 0 0 16px rgba(255, 186, 56, 0.95), 0 3px 0 #7a4b10; animation: checkmate-pop 0.75s cubic-bezier(0.2, 1.7, 0.4, 1) 0.45s both; }
.checkmate-spark { position: absolute; left: 50%; top: 44%; width: 10px; height: 10px; margin: -5px; border-radius: 50%; background: #ffd76e; box-shadow: 0 0 10px #ffc23a; opacity: 0; animation: checkmate-spark 1.1s ease-out 0.55s forwards; }
@keyframes checkmate-topple { 0% { transform: rotate(0deg); } 28% { transform: rotate(-14deg); } 100% { transform: rotate(92deg) translate(8%, 6%); } }
@keyframes checkmate-pop { from { transform: scale(0.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes checkmate-spark { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.4); } }
@keyframes checkmate-fade { 0%, 78% { opacity: 1; } 100% { opacity: 0; } }
@keyframes checkmate-glow { 0% { opacity: 0; } 22% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .checkmate-king, .checkmate-burst strong, .checkmate-spark { animation: none; } }
`;

/**
 * Checkmate's moment (composed king floors, src/rules.js): the royal king
 * topples, "Checkmate!" pops in gold and sparks fly, over the board for a
 * couple of seconds. It never blocks a tap.
 */
export function celebrateCheckmate(host = document.body) {
  if (!document.getElementById('checkmate-style')) {
    const style = document.createElement('style');
    style.id = 'checkmate-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  const burst = document.createElement('div');
  burst.className = 'checkmate-burst';
  burst.setAttribute('role', 'status');
  const king = document.createElement('span');
  king.className = 'checkmate-king'; king.setAttribute('aria-hidden', 'true'); king.textContent = '♚';
  const word = document.createElement('strong');
  word.textContent = 'Checkmate!';
  burst.append(king, word);
  for (let n = 0; n < 14; n++) {
    const spark = document.createElement('span');
    const angle = (n / 14) * Math.PI * 2, reach = 90 + (n % 3) * 40;
    spark.className = 'checkmate-spark';
    spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
    spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach)}px`);
    burst.append(spark);
  }
  host.append(burst);
  setTimeout(() => burst.remove(), 2700);
}
