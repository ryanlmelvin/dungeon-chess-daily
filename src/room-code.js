// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// A day's three composed rooms (src/rules.js validComposed) as one short
// string, for the stored editions (src/editions.js). Floors are apart by '/'.
// A square is one character of the route code's alphabet (y * 8 + x). A room:
// - its walls: 11 characters, six squares each (a bit per square, from a8
//   along the rows: square n is bit n % 6 of character n / 6);
// - its start square, or '.' where the player starts on e2;
// - its monsters, two characters each: the square, then cast + 3 × held
//   (cast 0 is the floor's target species, 1 and 2 its decoy species; held
//   is how many moves a sleeping decoy sleeps, 0 when it hunts at once);
// - ',' and its items, two characters each: the square, then 'o' a coin
//   ('O' the hint coin), a powerup's letter (POWER_LETTERS, upper case when it
//   is the hint) or a recruit's piece as its PIECES digit;
// - on an Ice day, ',' and its ice tiles, a character each.
// Decoding gives back the same rooms, key order included, so a save of the
// day (which carries its rooms) compares equal.
import { ALPHABET } from './route-code.js';
import { PIECES } from './pieces.js';

const WALL_CHARS = 11;
const NO_START = '.';
/** A powerup's letter in a room code. */
export const POWER_LETTERS = Object.freeze({ shield: 's', freeze: 'f', magnet: 'm', pin: 'p', leap: 'l', takeback: 't' });
const POWER_OF = Object.fromEntries(Object.entries(POWER_LETTERS).flatMap(([power, letter]) => [[letter, power], [letter.toUpperCase(), power]]));
const MAX_HELD = 20;

const square = (tile) => {
  if (!Number.isInteger(tile?.x) || !Number.isInteger(tile?.y) || tile.x < 0 || tile.y < 0 || tile.x > 7 || tile.y > 7) throw new RangeError('A room square is off the board.');
  return ALPHABET[tile.y * 8 + tile.x];
};
function tileOf(char) {
  const n = ALPHABET.indexOf(char);
  if (n < 0) throw new SyntaxError(`Unknown square ${char} in a room code.`);
  return { x: n % 8, y: Math.floor(n / 8) };
}

function encodeRoom(room) {
  let walls = '';
  for (let chunk = 0; chunk < WALL_CHARS; chunk++) {
    let bits = 0;
    for (let bit = 0; bit < 6; bit++) {
      const n = chunk * 6 + bit;
      if (n < 64 && room.map[Math.floor(n / 8)][n % 8] === '#') bits |= 1 << bit;
    }
    walls += ALPHABET[bits];
  }
  const start = room.start ? square(room.start) : NO_START;
  const monsters = room.enemies.map((foe) => {
    const held = foe.held ?? 0;
    if (foe.species !== undefined || ![0, 1, 2].includes(foe.cast) || !Number.isInteger(held) || held < 0 || held > MAX_HELD) throw new RangeError('A room monster needs a cast of 0 to 2 and at most 20 held moves.');
    return square(foe) + ALPHABET[foe.cast + 3 * held];
  }).join('');
  const items = room.items.map((item) => {
    if (item.type === 'coin') return square(item) + (item.hint ? 'O' : 'o');
    if (item.type === 'powerup' && Object.hasOwn(POWER_LETTERS, item.power)) return square(item) + (item.hint ? POWER_LETTERS[item.power].toUpperCase() : POWER_LETTERS[item.power]);
    if (item.type === 'companion' && PIECES.includes(item.piece)) return square(item) + PIECES.indexOf(item.piece);
    throw new RangeError(`A room item a room code can't hold: ${JSON.stringify(item)}.`);
  }).join('');
  const ice = room.ice ? `,${room.ice.map(square).join('')}` : '';
  return `${walls}${start}${monsters},${items}${ice}`;
}

function decodeRoom(text) {
  const map = Array.from({ length: 8 }, () => Array(8).fill('.'));
  for (let chunk = 0; chunk < WALL_CHARS; chunk++) {
    const bits = ALPHABET.indexOf(text[chunk]);
    if (bits < 0) throw new SyntaxError('Bad walls in a room code.');
    for (let bit = 0; bit < 6; bit++) {
      const n = chunk * 6 + bit;
      if (bits & (1 << bit)) {
        if (n >= 64) throw new SyntaxError('Bad walls in a room code.');
        map[Math.floor(n / 8)][n % 8] = '#';
      }
    }
  }
  const [monsters, items, ice, extra] = text.slice(WALL_CHARS + 1).split(',');
  if (items === undefined || extra !== undefined || monsters.length % 2 || items.length % 2) throw new SyntaxError('Bad lists in a room code.');
  const pairs = (list) => Array.from({ length: list.length / 2 }, (_, n) => [list[n * 2], list[n * 2 + 1]]);
  const room = {
    map: map.map((row) => row.join('')),
    enemies: pairs(monsters).map(([at, code]) => {
      const value = ALPHABET.indexOf(code);
      if (value < 0) throw new SyntaxError('Bad monster in a room code.');
      const held = Math.floor(value / 3);
      return { ...tileOf(at), cast: value % 3, ...(held && { held }) };
    }),
    items: pairs(items).map(([at, code]) => {
      const tile = tileOf(at);
      if (code === 'o' || code === 'O') return { ...tile, type: 'coin', ...(code === 'O' && { hint: true }) };
      if (Object.hasOwn(POWER_OF, code)) return { ...tile, type: 'powerup', power: POWER_OF[code], ...(code === code.toUpperCase() && { hint: true }) };
      if (/^[0-9]$/.test(code) && PIECES[Number(code)]) return { ...tile, type: 'companion', piece: PIECES[Number(code)] };
      throw new SyntaxError(`Bad item ${code} in a room code.`);
    }),
  };
  if (text[WALL_CHARS] !== NO_START) room.start = tileOf(text[WALL_CHARS]);
  if (ice !== undefined) room.ice = [...ice].map(tileOf);
  return room;
}

/** A day's three composed rooms as a room code. */
export function encodeRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length !== 3) throw new RangeError('A day has three rooms.');
  return rooms.map(encodeRoom).join('/');
}

/** The three rooms a room code holds. Throws on a malformed code. */
export function decodeRooms(text) {
  const rooms = String(text).split('/');
  if (rooms.length !== 3) throw new SyntaxError('A room code holds three rooms.');
  return rooms.map(decodeRoom);
}
