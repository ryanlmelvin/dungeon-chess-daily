// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// Checkmate's moment (src/rules.js: a mate on the king floor wins at once):
// the royal king topples, "Checkmate!" pops in gold and sparks fly, over the
// board for a couple of seconds. It never blocks a tap. Styles: style.css.

/** Play the checkmate burst over `host`. */
export function celebrateCheckmate(host = document.body) {
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
