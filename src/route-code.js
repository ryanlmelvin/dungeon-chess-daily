// SPDX-License-Identifier: GPL-3.0-only
/** One character per square (y * 8 + x), shared with src/room-code.js. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// A recruit order follows the move or wait that carries it (a partner floor's
// line, src/composer.js): '~' holds the recruit still, '>' and a square sends
// it there. A route without orders is coded as it always was.
const HOLD = '~', SEND = '>';
const squareOf = (tile) => {
  if (!Number.isInteger(tile?.x) || !Number.isInteger(tile?.y) || tile.x < 0 || tile.y < 0 || tile.x > 7 || tile.y > 7) throw new RangeError('A route square is off the board.');
  return ALPHABET[tile.y * 8 + tile.x];
};
function orderOf(action) {
  if (action.recruit === undefined) return '';
  if (action.type === 'descend') throw new RangeError('The stairs carry no recruit order.');
  return action.recruit === 'hold' ? HOLD : SEND + squareOf(action.recruit);
}
/**
 * Compact route: one character per action (a move's square, `.` wait, `!`
 * descend), then its recruit order, if it carries one (`~` hold, `>` and the
 * square it is sent to).
 */
export function encodeRoute(actions) {
  return actions.map((action) => (action.type === 'wait' ? '.' : action.type === 'descend' ? '!' : ALPHABET[action.y * 8 + action.x]) + orderOf(action)).join('');
}
export function decodeRoute(text) {
  const actions = [];
  const tile = (char) => { const index = ALPHABET.indexOf(char); return { x: index % 8, y: Math.floor(index / 8) }; };
  // An order belongs to the move or wait just before it; anywhere else the code is malformed.
  const order = (recruit) => {
    const action = actions.at(-1);
    if (!action || action.type === 'descend' || action.recruit !== undefined) throw new SyntaxError('A recruit order with no move to carry it in a route code.');
    action.recruit = recruit;
  };
  const chars = [...text];
  for (let n = 0; n < chars.length; n++) {
    const char = chars[n];
    if (char === '.') actions.push({ type: 'wait' });
    else if (char === '!') actions.push({ type: 'descend' });
    else if (char === HOLD) order('hold');
    else if (char === SEND) {
      if (chars[n + 1] === undefined || !ALPHABET.includes(chars[n + 1])) throw new SyntaxError('A recruit order with no square in a route code.');
      order(tile(chars[++n]));
    } else actions.push({ type: 'move', ...tile(char) });
  }
  return actions;
}
