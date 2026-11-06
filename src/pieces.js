// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
export const PIECES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
// The daily piece is never a king: it can't step next to the monster king
// (that's moving into check), and its recruit may not capture the challenge,
// so the last floor could be unwinnable. A king stays available in practice,
// with a warning.
export const PLAYABLE_PIECES = PIECES.filter((piece) => piece !== 'king');
export const PIECE_COUNTS = Object.freeze({ pawn: 8, rook: 2, knight: 2, bishop: 2, queen: 1, king: 1 });
export const PIECE_LIVES = PIECE_COUNTS;
