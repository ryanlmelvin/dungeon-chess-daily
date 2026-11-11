// SPDX-License-Identifier: GPL-3.0-only
/** One character per square (y * 8 + x), shared with src/room-code.js. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Compact route: one character per action (a move's square, `.` wait, `!` descend). */
export function encodeRoute(actions) {
  return actions.map((action) => (action.type === 'wait' ? '.' : action.type === 'descend' ? '!' : ALPHABET[action.y * 8 + action.x])).join('');
}
export function decodeRoute(text) {
  return [...text].map((char) => {
    if (char === '.') return { type: 'wait' };
    if (char === '!') return { type: 'descend' };
    const index = ALPHABET.indexOf(char);
    return { type: 'move', x: index % 8, y: Math.floor(index / 8) };
  });
}
