// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The journal: a book of lesson pages that fills in as the player finds
// things. Every floor is composed around one idea (src/composer.js motifs,
// stored with each edition as daily.generation.motifs); clearing a floor at
// par or better, the game's own measure of "you found the idea" (src/par.js),
// finds that idea's page. A special move's page is found by playing the move
// (state.feats). Finds are kept per page and per player piece, for the
// official piece only (daily or archive, never practice), in one storage
// record of their own that no rules version touches and backups carry.
// This module is the book and its bookkeeping; src/journal-ui.js shows it.
import { floorPars } from './par.js';
import { isOfficialRun, scoredMoves, floorScoredMoves, PLAYABLE_PIECES } from './game.js';
import { isMotifName } from './motif-code.js';
import { drawSqueezeDemo, SQUEEZE_STILL, drawTandemDemo, TANDEM_STILL, drawNetDemo, NET_STILL, drawTempoDemo, TEMPO_STILL, drawCrownDemo, CROWN_STILL, drawStandstillDemo, STANDSTILL_STILL, drawLureDemo, LURE_STILL } from './journal-art.js';
import { drawOffBalanceDemo, OFF_BALANCE_STILL, drawForkDemo, FORK_STILL, drawComboDemo, COMBO_STILL, drawBishopPairDemo, BISHOP_PAIR_STILL } from './tactics-art.js';
import { drawEnPassantDemo, EN_PASSANT_STILL, drawCastleDemo, CASTLE_STILL } from './guide-art.js';
import { piecePalette } from './sprites.js';

const ANY_PIECE = Object.freeze(['knight', 'bishop', 'rook', 'queen', 'pawn']);
const OFFICERS = Object.freeze(['knight', 'bishop', 'rook', 'queen']);

/**
 * The lesson pages, in book order. A page is one entry: `id` is the motif's
 * name in the composer (or a special move's feat kind in src/rules.js),
 * `name` what the player reads (one or two words), `text` one or two short
 * sentences, `draw(canvas, ms)` its looping pixel diagram with `still` a
 * frame that reads on its own, `art` the diagram in words, and `pieces` the
 * daily pieces that can find it. `kind` says how it is found: an 'idea' by
 * clearing its floor at par or better, a 'move' by playing it.
 */
export const PAGES = Object.freeze([
  {
    id: 'bait', kind: 'idea', name: 'Bait', pieces: OFFICERS,
    text: 'Let a monster wind up, then step aside. It lunges onto your old square, off-balance: take it.',
    art: 'A monster’s red path points at a rook. The rook steps aside, the monster lunges into the empty square and wobbles, and the rook captures it.',
    draw: drawOffBalanceDemo, still: OFF_BALANCE_STILL,
  },
  {
    id: 'squeeze', kind: 'idea', name: 'Squeeze', pieces: OFFICERS,
    text: 'A monster must move every turn. Cover the only square it can step to, and take it there.',
    art: 'A monster is walled into two squares. A knight lands where it covers the one square the monster can step to; the monster steps there and the knight captures it.',
    draw: drawSqueezeDemo, still: SQUEEZE_STILL,
  },
  {
    id: 'tandem', kind: 'idea', name: 'Tandem', pieces: OFFICERS,
    text: 'Two targets guard each other. Your recruit can’t be taken: send it, then take the other.',
    art: 'Two monsters stand walled in side by side, each ringed in red. A mint knight, your recruit, takes one; your bishop then takes the other.',
    draw: drawTandemDemo, still: TANDEM_STILL,
  },
  {
    id: 'net', kind: 'idea', name: 'Mating net', pieces: ANY_PIECE,
    text: 'Check the king where every square it could step to is covered. Checkmate wins at once.',
    art: 'A king stands in a dead end of two squares. A rook checks along the line, covering both, and the king topples: checkmate.',
    draw: drawNetDemo, still: NET_STILL,
  },
  {
    id: 'tempo', kind: 'idea', name: 'Tempo', pieces: ['pawn'],
    text: 'Pawns take diagonally. Step or wait until the target walks into reach, then strike.',
    art: 'A pawn steps up and waits. A monster walks into the pawn’s diagonal, and the pawn captures it.',
    draw: drawTempoDemo, still: TEMPO_STILL,
  },
  {
    id: 'crown', kind: 'idea', name: 'Crown', pieces: ['pawn'],
    text: 'Walk your pawn to the last row and it becomes a queen. The queen finishes the floor.',
    art: 'A pawn walks to the last row and becomes a crowned queen, which captures a monster the pawn could not reach.',
    draw: drawCrownDemo, still: CROWN_STILL,
  },
  {
    id: 'wait', kind: 'idea', name: 'Standstill', pieces: ['knight', 'queen'],
    text: 'It stepped out of reach, and it must move again. Stay put one turn, then take it.',
    art: 'A monster walled into two squares steps away as a knight lands beside its pocket. The knight waits a turn, the monster has to step back, and the knight captures it.',
    draw: drawStandstillDemo, still: STANDSTILL_STILL,
  },
  {
    id: 'lure', kind: 'idea', name: 'Lure', pieces: ['knight'],
    text: 'A guard beside the target winds up at you. Jump aside: it lunges away, so take the target.',
    art: 'A monster stands beside a ringed target, its red square under a knight. The knight jumps aside, the monster lunges onto the empty square and wobbles, and the knight captures the target it guarded.',
    draw: drawLureDemo, still: LURE_STILL,
  },
  {
    id: 'fork', kind: 'move', name: 'Fork', pieces: ANY_PIECE,
    text: 'Attack two monsters at once, then take one on your very next move: +2 gold.',
    art: 'A knight hops to a square that attacks two monsters at once, then captures one of them.',
    draw: drawForkDemo, still: FORK_STILL,
  },
  {
    id: 'combo', kind: 'move', name: 'Combo', pieces: ANY_PIECE,
    text: 'Capture on three moves in a row. The third, and each one after, pays +1 gold.',
    art: 'A rook captures three monsters on three moves in a row while a flame counter climbs to three.',
    draw: drawComboDemo, still: COMBO_STILL,
  },
  {
    id: 'en-passant', kind: 'move', name: 'En passant', pieces: ['pawn'],
    text: 'A pawn that double-steps past yours can be taken as if it had stepped one. Next move only.',
    art: 'An enemy pawn advances two squares past your pawn, and your pawn captures it by moving diagonally into the square it skipped.',
    draw: (canvas, time) => drawEnPassantDemo(canvas, time, { mode: 'player', enemyPalette: piecePalette('black') }), still: EN_PASSANT_STILL,
  },
  {
    id: 'castle', kind: 'move', name: 'Castling', pieces: ['rook'],
    text: 'Your rook and a king recruit, two open squares apart, cross over in one move. Tap the king.',
    art: 'A king slides two squares toward a rook, and the rook hops over the king to land on the square beside it.',
    draw: (canvas, time) => drawCastleDemo(canvas, time, { player: 'rook' }), still: CASTLE_STILL,
  },
  {
    id: 'bishop-pair', kind: 'move', name: 'Holy duo', pieces: ['bishop'],
    text: 'A bishop recruit hops to the other colour. Together your two bishops cover every square.',
    art: 'Your bishop steps onto a bishop recruit, which hops one square sideways onto the other colour; every square of the board lights up.',
    draw: drawBishopPairDemo, still: BISHOP_PAIR_STILL,
  },
]);

/**
 * The pages of ideas in preview: built, and drawn for no stored edition yet,
 * so nobody can find one outside the dev preview. The book lists such a page
 * only once it has been found (bookPages), so the released book and its count
 * stay as they are. Shipping an idea moves its page into PAGES, as the
 * Standstill's and the Lure's were (2026-11-13). None waits here now.
 */
export const PREVIEW_PAGES = Object.freeze([
]);

/** What a page that isn't found yet says, by how it is found. */
export const UNFOUND_TEXT = Object.freeze({
  idea: 'An idea a floor is built around. Clear that floor at par to find it.',
  move: 'A special move. Play it to find it.',
});

/** The plain walk to the targets is the composer's fallback: no idea, so no page. */
export const NO_IDEA = 'walk';
export const JOURNAL_SCHEMA = 1;
/** The journal's storage key, after the app's prefix (main.js), beside the saves so backups carry it. */
export const JOURNAL_KEY = 'journal';
/** Which back-fill has run over this device's saves (backfill); raise it when the back-fill would find more. */
export const BACKFILL_VERSION = 1;
const MAX_IDS = 64;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (date) => typeof date === 'string' && DATE.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The lesson page of a motif or special move (a preview page too), or null: a name with no page is harmless. */
export const pageFor = (id) => PAGES.find((page) => page.id === id) ?? PREVIEW_PAGES.find((page) => page.id === id) ?? null;
/**
 * The pages the book shows for `journal`, in book order: every released page,
 * and each preview page already found, after the released ideas.
 */
export function bookPages(journal) {
  const found = PREVIEW_PAGES.filter((page) => journal?.finds?.[page.id]);
  if (!found.length) return PAGES;
  const moves = PAGES.findIndex((page) => page.kind !== 'idea');
  return [...PAGES.slice(0, moves), ...found, ...PAGES.slice(moves)];
}

export const emptyJournal = () => ({ schema: JOURNAL_SCHEMA, finds: {} });

// The finds of anything shaped like a journal, cleaned: { id: { piece: edition date } }.
// Names without a page yet are kept, so a find made before its page ships (or
// restored from a newer app's backup) is there when the page arrives.
function cleanFinds(finds) {
  const clean = {};
  if (!isRecord(finds)) return clean;
  for (const [id, pieces] of Object.entries(finds)) {
    if (!isMotifName(id) || id === NO_IDEA || !isRecord(pieces) || Object.keys(clean).length >= MAX_IDS) continue;
    const found = {};
    for (const piece of PLAYABLE_PIECES) if (isDate(pieces[piece])) found[piece] = pieces[piece];
    if (Object.keys(found).length) clean[id] = found;
  }
  return clean;
}

/** A journal from its stored text. Anything unreadable is an empty journal: it never throws. */
export function readJournal(text) {
  try {
    const value = typeof text === 'string' ? JSON.parse(text) : text;
    if (!isRecord(value) || value.schema !== JOURNAL_SCHEMA) return emptyJournal();
    return { schema: JOURNAL_SCHEMA, finds: cleanFinds(value.finds), ...(Number.isInteger(value.filled) && value.filled > 0 && { filled: value.filled }) };
  } catch { return emptyJournal(); }
}

/** True when `text` is a stored journal of a schema this app reads. */
export function isJournalText(text) {
  try { const value = JSON.parse(text); return isRecord(value) && value.schema === JOURNAL_SCHEMA && isRecord(value.finds); } catch { return false; }
}

// Stored with sorted keys, so equal journals are equal text.
const sorted = (record) => Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
export function writeJournal(journal) {
  const finds = cleanFinds(journal?.finds);
  return JSON.stringify({ schema: JOURNAL_SCHEMA, finds: sorted(Object.fromEntries(Object.entries(finds).map(([id, pieces]) => [id, sorted(pieces)]))), ...(journal?.filled && { filled: journal.filled }) });
}

/**
 * File `ids` (motif names and feat kinds) as found with `piece` in the edition
 * of `date`. Returns the journal after (the same object when nothing changed)
 * and what was `fresh`: each new { id, piece }, with `page: true` when the id
 * had never been found with any piece. A find already made keeps its earlier date.
 */
export function addFinds(journal, ids, piece, date) {
  const fresh = [];
  if (!PLAYABLE_PIECES.includes(piece) || !isDate(date)) return { journal, fresh };
  let finds = journal.finds;
  for (const id of new Set(ids)) {
    if (!isMotifName(id) || id === NO_IDEA) continue;
    const known = finds[id];
    if (known?.[piece] && known[piece] <= date) continue;
    if (!known && Object.keys(finds).length >= MAX_IDS) continue;
    if (!known?.[piece]) fresh.push({ id, piece, page: !known });
    finds = { ...finds, [id]: { ...known, [piece]: date } };
  }
  return { journal: finds === journal.finds ? journal : { ...journal, finds }, fresh };
}

/** The union of two journals: every find of either, each at its earlier date. `a` keeps its own bookkeeping. */
export function mergeJournals(a, b) {
  let merged = { ...a, finds: cleanFinds(a?.finds) };
  for (const [id, pieces] of Object.entries(cleanFinds(b?.finds))) {
    for (const [piece, date] of Object.entries(pieces)) merged = addFinds(merged, [id], piece, date).journal;
  }
  return merged;
}

/**
 * A backup's journal merged into this device's, as stored text (src/backups.js),
 * or null when the backup's adds nothing or can't be read: a restore never
 * loses a find and never fails over a journal.
 */
export function mergeJournalText(currentText, incomingText) {
  if (!isJournalText(incomingText)) return null;
  const current = readJournal(currentText);
  const merged = writeJournal(mergeJournals(current, readJournal(incomingText)));
  return merged === writeJournal(current) ? null : merged;
}

// A run the journal reads: the day's own piece, color and monsters, not practice.
const journalRun = (state, daily) => Boolean(state && daily) && state.practice !== true && state.date === daily.date
  && PLAYABLE_PIECES.includes(state.startingPiece) && isOfficialRun(state, daily);

// The floor's score once its challenge is complete (as the shop and the share card count it), else null.
function clearedMoves(state, floor) {
  const record = Array.isArray(state.records) ? state.records.find((entry) => entry?.floor === floor) : null;
  if (record) return scoredMoves(record);
  return floor === state.floor && state.status === 'playing' && state.objective?.complete === true ? floorScoredMoves(state) : null;
}

/**
 * What `floor` of a run found: its idea, when the floor was cleared at par or
 * better (the walk fallback has none), then each special move played on it.
 * Empty for a practice run, another piece, color or ruleset, or a floor
 * still in play.
 */
export function floorFinds(state, daily, floor = state?.floor) {
  if (!journalRun(state, daily)) return [];
  const ids = [];
  const moves = clearedMoves(state, floor);
  if (!Number.isInteger(moves)) return ids;
  const par = floorPars(daily)?.[floor];
  const motif = daily.generation?.motifs?.[floor];
  if (Number.isInteger(par) && moves <= par && isMotifName(motif) && motif !== NO_IDEA) ids.push(motif);
  for (const feat of Array.isArray(state.feats) ? state.feats : []) {
    if (feat?.floor === floor && isMotifName(feat.kind) && !ids.includes(feat.kind)) ids.push(feat.kind);
  }
  return ids;
}

/**
 * File what `floors` of a run found. Returns { journal, fresh, ids }: `ids`
 * every page-or-not name those floors found, `fresh` the new ones (addFinds).
 */
export function fileRun(journal, state, daily, floors = [0, 1, 2]) {
  const ids = floors.flatMap((floor) => floorFinds(state, daily, floor));
  return { ...addFinds(journal, ids, state?.startingPiece, state?.date), ids };
}

/**
 * Back-fill from the runs already saved on a device: `runs` are parsed
 * official saves that fit their editions, `dailyOf(date)` their edition.
 * A day that can't be read is skipped. Marks the journal back-filled.
 */
export function backfill(journal, runs, dailyOf) {
  let next = journal;
  for (const state of runs) {
    try { next = fileRun(next, state, dailyOf(state.date)).journal; } catch {}
  }
  return next.filled === BACKFILL_VERSION ? next : { ...next, filled: BACKFILL_VERSION };
}

/** A page's pieces, each `found` or not: the pieces that can find it, then any other it was found with. */
export function pagePieces(journal, page) {
  const found = journal.finds[page.id] ?? {};
  return [...page.pieces, ...PLAYABLE_PIECES.filter((piece) => found[piece] && !page.pieces.includes(piece))].map((piece) => ({ piece, found: Boolean(found[piece]) }));
}

/** Pages found (with any piece) of the pages there are. */
export function journalProgress(journal) {
  const pages = bookPages(journal);
  return { found: pages.filter((page) => journal.finds[page.id]).length, total: pages.length };
}
