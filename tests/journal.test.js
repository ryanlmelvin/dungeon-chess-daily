// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, validateSave, RULES_VERSION } from '../src/game.js';
import { borrowedDaily } from '../src/generation.js';
import { getRawDaily } from '../src/edition.js';
import { EDITIONS } from '../src/editions.js';
import { encodeMotifs, decodeMotifs, isMotifName } from '../src/motif-code.js';
import { floorPars } from '../src/par.js';
import { planBackupMerge } from '../src/backups.js';
import {
  PAGES, UNFOUND_TEXT, NO_IDEA, JOURNAL_KEY, BACKFILL_VERSION, pageFor, emptyJournal, readJournal, writeJournal, isJournalText,
  addFinds, mergeJournals, mergeJournalText, floorFinds, fileRun, backfill, pagePieces, journalProgress,
} from '../src/journal.js';

// Play a day's planted lines, keeping the state at each shop (the floor cleared, its stairs not yet taken) and the won run.
// The lines' own forks and combos are set aside (`feats`), so a floor's finds are its idea alone unless a test adds one.
function playDay(date) {
  const daily = getDaily(date);
  let state = createGame(daily);
  const shops = [];
  for (const action of daily.generation.certificate.actions) {
    if (action.type === 'descend') shops.push({ ...state, feats: [] });
    state = act(state, action);
  }
  assert.equal(state.status, 'won', date);
  return { daily, shops, won: { ...state, feats: [] }, feats: state.feats, piece: daily.playerPiece };
}
// Days picked by what they are, so a rebuild of the editions can't strand these tests: the first day
// of bait, then a squeeze, then the net (a knight's, bishop's, rook's or queen's), and the first pawn
// day whose two floors before the net have ideas of their own.
const dayOf = (fits) => Object.keys(EDITIONS).find((date) => fits(EDITIONS[date].motifs, getRawDaily(date).playerPiece));
const OFFICER_DAY = dayOf((motifs) => motifs === 'b,s,n'), PAWN_DAY = dayOf((motifs, piece) => piece === 'pawn' && !motifs.includes('w'));
const officer = playDay(OFFICER_DAY), pawn = playDay(PAWN_DAY);

test('motifs survive their code, and a name the code has no letter for is stored whole', () => {
  assert.equal(encodeMotifs(['bait', 'squeeze', 'net']), 'b,s,n');
  assert.deepEqual(decodeMotifs('b,s,n'), ['bait', 'squeeze', 'net']);
  assert.equal(encodeMotifs(['partner', 'walk', 'net']), 'partner,w,n');
  assert.deepEqual(decodeMotifs('partner,w,n'), ['partner', 'walk', 'net']);
  for (const motifs of [['tempo', 'crown', 'net'], ['fork', 'treasure-chest', 'walk']]) assert.deepEqual(decodeMotifs(encodeMotifs(motifs)), motifs);
  for (const bad of [undefined, null, '', 'b,s', 'b,s,n,n', 'b,,n', 'B,s,n', 'b,s,n ', ['bait', 'squeeze', 'net'], 7]) assert.equal(decodeMotifs(bad), null, JSON.stringify(bad));
  assert.throws(() => encodeMotifs(['bait', 'squeeze']));
  assert.throws(() => encodeMotifs(['bait', 'Squeeze!', 'net']));
  assert.ok(isMotifName('en-passant') && !isMotifName('') && !isMotifName('a b') && !isMotifName(3));
});

test('every stored edition names its three floors\' motifs, and its daily carries them', () => {
  const seen = new Set();
  for (const [date, entry] of Object.entries(EDITIONS)) {
    const motifs = decodeMotifs(entry.motifs);
    assert.equal(motifs?.length, 3, date);
    assert.equal(encodeMotifs(motifs), entry.motifs, date);
    motifs.forEach((motif) => seen.add(motif));
  }
  for (const motif of ['bait', 'squeeze', 'net', 'tempo', 'crown']) assert.ok(seen.has(motif), motif);
  for (const date of [OFFICER_DAY, PAWN_DAY, '2026-11-01', Object.keys(EDITIONS).at(-1)]) {
    assert.deepEqual(getDaily(date).generation.motifs, decodeMotifs(EDITIONS[date].motifs), date);
  }
  assert.deepEqual(officer.daily.generation.motifs, ['bait', 'squeeze', 'net']);
  assert.deepEqual(pawn.daily.generation.motifs.at(-1), 'net');
});

test('a borrowed day takes its template\'s motifs', () => {
  for (const date of ['2031-02-11', '2033-07-04']) {
    const daily = getDaily(date);
    assert.ok(daily.generation.borrowed, date);
    assert.deepEqual(daily.generation.motifs, decodeMotifs(EDITIONS[daily.generation.borrowed].motifs), date);
    assert.deepEqual(borrowedDaily(getRawDaily(date)).generation.motifs, daily.generation.motifs);
  }
});

test('a stored entry without motifs still loads: an edition with no ideas named, harmlessly', () => {
  const daily = getDaily(OFFICER_DAY);
  delete daily.generation.motifs;
  assert.deepEqual(floorFinds(officer.won, daily, 0), []);
  assert.deepEqual(fileRun(emptyJournal(), officer.won, daily).fresh, []);
});

test('the book: one page per idea but the walk, each with a name, a short text and a diagram', () => {
  assert.equal(new Set(PAGES.map((page) => page.id)).size, PAGES.length);
  assert.equal(pageFor(NO_IDEA), null);
  assert.equal(pageFor('partner'), null, 'a motif with no page yet is harmless');
  for (const id of ['bait', 'squeeze', 'net', 'tempo', 'crown']) assert.equal(pageFor(id)?.kind, 'idea', id);
  // A stand-in canvas: the diagrams only draw.
  const context = new Proxy({}, { get: (target, name) => (name in target ? target[name] : () => {}), set: (target, name, value) => { target[name] = value; return true; } });
  const canvas = { width: 200, height: 200, getContext: () => context };
  for (const page of PAGES) {
    assert.ok(isMotifName(page.id), page.id);
    assert.ok(page.name && page.name.split(' ').length <= 2, `${page.id}: a name of one or two words`);
    assert.ok(page.text.length <= 96 && page.text.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 2, `${page.id}: one or two short sentences`);
    assert.ok(page.art && UNFOUND_TEXT[page.kind], page.id);
    assert.ok(page.pieces.length && page.pieces.every((piece) => piece !== 'king'), page.id);
    assert.ok(Number.isFinite(page.still));
    for (const time of [0, page.still, 1234, 5599, 99_999]) assert.doesNotThrow(() => page.draw(canvas, time), `${page.id} at ${time}`);
  }
});

test('each idea\'s page lists the pieces whose editions are built around it', () => {
  const met = {};
  for (const [date, entry] of Object.entries(EDITIONS)) {
    const piece = getRawDaily(date).playerPiece;
    for (const motif of decodeMotifs(entry.motifs)) (met[motif] ??= new Set()).add(piece);
  }
  for (const [motif, pieces] of Object.entries(met)) {
    const page = pageFor(motif);
    // A motif with no page yet (or the walk) simply has none.
    if (!page) continue;
    assert.deepEqual([...page.pieces].sort(), [...pieces].sort(), `${motif}: its page's pieces (src/journal.js PAGES) are the pieces whose stored editions use it`);
  }
});

test('clearing a floor at par or better finds its idea: at the shop, and in the record afterwards', () => {
  const { daily, shops, won } = officer;
  const pars = floorPars(daily);
  shops.forEach((state, floor) => {
    assert.equal(state.floor, floor);
    assert.deepEqual(floorFinds(state, daily), [daily.generation.motifs[floor]], `the shop after floor ${floor + 1}`);
    // Floors still ahead have found nothing.
    for (let later = floor + 1; later < 3; later++) assert.deepEqual(floorFinds(state, daily, later), []);
  });
  assert.deepEqual([0, 1, 2].map((floor) => floorFinds(won, daily, floor)), [['bait'], ['squeeze'], ['net']]);
  // Even par finds it; one over does not.
  const even = structuredClone(won);
  even.records[0].scored = pars[0];
  assert.deepEqual(floorFinds(even, daily, 0), ['bait']);
  const over = structuredClone(won);
  over.records[0].scored = pars[0] + 1;
  assert.deepEqual(floorFinds(over, daily, 0), []);
  // A capture and a paid hint are moves on the floor's score.
  const penalized = structuredClone(won);
  penalized.records[1].hits = 1; penalized.records[1].hints = ['suspects'];
  assert.deepEqual(floorFinds(penalized, daily, 1), []);
  // A floor in play has found nothing yet.
  assert.deepEqual(floorFinds(createGame(daily), daily, 0), []);
});

test('only the day\'s own piece, color and monsters find anything, never practice', () => {
  const { daily, won } = officer;
  assert.deepEqual(floorFinds({ ...won, practice: true }, daily, 0), [], 'a practice replay with the official piece');
  assert.deepEqual(floorFinds({ ...won, startingPiece: 'rook' }, daily, 0), []);
  assert.deepEqual(floorFinds({ ...won, playerColor: 'black' }, daily, 0), []);
  assert.deepEqual(floorFinds({ ...won, difficulty: 'gentle' }, daily, 0), []);
  assert.deepEqual(floorFinds(won, pawn.daily, 0), [], 'another day\'s edition');
  assert.deepEqual(floorFinds(null, daily, 0), []);
  const practice = createPracticeGame(daily);
  assert.equal(practice.practice, true);
  assert.deepEqual(fileRun(emptyJournal(), practice, daily).fresh, []);
});

test('the walk has no idea, an unknown motif is filed by name, and special moves are found by playing them', () => {
  const { daily, won } = officer;
  const walked = { ...daily, generation: { ...daily.generation, motifs: ['walk', 'partner', 'net'] } };
  assert.deepEqual(floorFinds(won, walked, 0), []);
  assert.deepEqual(floorFinds(won, walked, 1), ['partner']);
  const { journal, fresh } = fileRun(emptyJournal(), won, walked);
  assert.deepEqual(fresh.map((find) => find.id), ['partner', 'net']);
  assert.deepEqual(journal.finds.partner, { [officer.piece]: OFFICER_DAY });
  assert.equal(journal.finds.walk, undefined);
  // A fork won on floor 2, over par or not.
  const forked = structuredClone(won);
  forked.feats = [{ floor: 1, kind: 'fork' }, { floor: 1, kind: 'fork' }];
  forked.records[1].scored += 5;
  assert.deepEqual(floorFinds(forked, daily, 1), ['fork']);
  assert.deepEqual(floorFinds(forked, daily, 0), ['bait']);
  // The feats a planted line earns on its way file with its idea.
  const played = { ...won, feats: officer.feats };
  for (const floor of [0, 1, 2]) {
    const kinds = [...new Set(officer.feats.filter((feat) => feat.floor === floor).map((feat) => feat.kind))];
    assert.deepEqual(floorFinds(played, daily, floor), [daily.generation.motifs[floor], ...kinds]);
  }
});

test('finds are kept per page and per piece; a find is new once', () => {
  let { journal, fresh } = addFinds(emptyJournal(), ['bait'], 'knight', '2026-11-09');
  assert.deepEqual(fresh, [{ id: 'bait', piece: 'knight', page: true }]);
  ({ journal, fresh } = addFinds(journal, ['bait', 'squeeze'], 'rook', '2026-11-16'));
  assert.deepEqual(fresh, [{ id: 'bait', piece: 'rook', page: false }, { id: 'squeeze', piece: 'rook', page: true }]);
  const again = addFinds(journal, ['bait', 'squeeze'], 'rook', '2026-11-20');
  assert.deepEqual(again.fresh, []);
  assert.equal(again.journal, journal, 'nothing new leaves the journal as it is');
  // An earlier edition moves the date back without being new.
  const earlier = addFinds(journal, ['bait'], 'knight', '2026-11-04');
  assert.deepEqual(earlier.fresh, []);
  assert.equal(earlier.journal.finds.bait.knight, '2026-11-04');
  assert.deepEqual(journal.finds, { bait: { knight: '2026-11-09', rook: '2026-11-16' }, squeeze: { rook: '2026-11-16' } });
  // Nonsense files nothing.
  for (const [ids, piece, date] of [[['walk'], 'rook', '2026-11-16'], [['Bait!'], 'rook', '2026-11-16'], [['net'], 'king', '2026-11-16'], [['net'], 'rook', 'yesterday'], [['net'], 'rook', '2026-02-30']]) {
    assert.equal(addFinds(journal, ids, piece, date).journal, journal, JSON.stringify([ids, piece, date]));
  }
  assert.deepEqual(pagePieces(journal, pageFor('bait')), [{ piece: 'knight', found: true }, { piece: 'bishop', found: false }, { piece: 'rook', found: true }, { piece: 'queen', found: false }]);
  assert.deepEqual(journalProgress(journal), { found: 2, total: PAGES.length });
  // 'partner' has no page yet: it is kept, and counts for nothing until it has one.
  assert.deepEqual(journalProgress(addFinds(journal, ['partner'], 'rook', '2026-11-16').journal), { found: 2, total: PAGES.length });
});

test('the journal reads back what it wrote, and anything else as an empty journal', () => {
  const { journal } = addFinds(addFinds(emptyJournal(), ['squeeze', 'bait'], 'queen', '2026-11-10').journal, ['bait', 'partner'], 'knight', '2026-11-09');
  const text = writeJournal({ ...journal, filled: BACKFILL_VERSION });
  assert.equal(text, '{"schema":1,"finds":{"bait":{"knight":"2026-11-09","queen":"2026-11-10"},"partner":{"knight":"2026-11-09"},"squeeze":{"queen":"2026-11-10"}},"filled":1}');
  assert.deepEqual(readJournal(text), { schema: 1, finds: journal.finds, filled: BACKFILL_VERSION });
  assert.equal(writeJournal(readJournal(text)), text);
  assert.ok(isJournalText(text));
  for (const bad of [null, undefined, '', 'nonsense', '[]', '{"schema":2,"finds":{"bait":{"rook":"2026-11-16"}}}', '{"finds":{}}']) {
    assert.deepEqual(readJournal(bad), emptyJournal(), String(bad));
    assert.equal(isJournalText(bad), false, String(bad));
  }
  // Entries that make no sense are dropped one by one.
  const messy = JSON.stringify({ schema: 1, filled: 'yes', finds: { bait: { rook: '2026-11-16', king: '2026-11-16', bishop: 'soon', queen: 7 }, walk: { rook: '2026-11-16' }, 'Not a name': { rook: '2026-11-16' }, net: 'found', crown: {} } });
  assert.deepEqual(readJournal(messy), { schema: 1, finds: { bait: { rook: '2026-11-16' } } });
});

test('back-fill files the runs already saved on a device, once and quietly', () => {
  const other = Object.keys(EDITIONS).find((date) => date !== OFFICER_DAY && date !== PAWN_DAY);
  const runs = [officer.won, pawn.shops[1], createGame(getDaily(other)), { ...playDay(other).won, practice: true }];
  // Saves as a device holds them: the played positions, forks and combos and all.
  for (const date of [OFFICER_DAY, PAWN_DAY]) {
    let state = createGame(getDaily(date));
    for (const action of getDaily(date).generation.certificate.actions) state = act(state, action);
    assert.equal(validateSave(JSON.parse(JSON.stringify(state)), date), true);
  }
  const filled = backfill(emptyJournal(), runs, getDaily);
  const [first, second] = pawn.daily.generation.motifs;
  assert.deepEqual(filled, {
    schema: 1, filled: BACKFILL_VERSION,
    finds: {
      bait: { [officer.piece]: OFFICER_DAY }, squeeze: { [officer.piece]: OFFICER_DAY }, net: { [officer.piece]: OFFICER_DAY },
      ...(first === second ? { [first]: { pawn: PAWN_DAY } } : { [first]: { pawn: PAWN_DAY }, [second]: { pawn: PAWN_DAY } }),
    },
  });
  // The pawn run stands in floor 2's shop: floor 3 isn't played yet. The unplayed day and the practice run file nothing.
  assert.equal(filled.finds.net.pawn, undefined);
  // Again changes nothing, and a live find after it is new only where it is.
  assert.deepEqual(backfill(filled, runs, getDaily), filled);
  assert.deepEqual(fileRun(filled, officer.won, officer.daily).fresh, []);
  assert.deepEqual(fileRun(filled, pawn.won, pawn.daily).fresh, [{ id: 'net', piece: 'pawn', page: false }]);
  // A day that can't be opened is skipped, and the rest still file.
  const partial = backfill(emptyJournal(), [officer.won, pawn.won], (date) => { if (date === OFFICER_DAY) throw new Error('no such edition'); return getDaily(date); });
  assert.deepEqual(Object.keys(partial.finds).sort(), [...new Set([first, second, 'net'])].sort());
  assert.deepEqual(Object.keys(partial.finds.net), ['pawn']);
  assert.equal(partial.filled, BACKFILL_VERSION);
});

test('two journals merge as a union of finds, each at its earlier date', () => {
  const here = { schema: 1, filled: BACKFILL_VERSION, finds: { bait: { knight: '2026-11-09' }, net: { knight: '2026-11-09' } } };
  const there = { schema: 1, finds: { bait: { knight: '2026-11-04', rook: '2026-11-13' }, tempo: { pawn: '2026-11-05' }, partner: { queen: '2026-12-01' } } };
  const merged = mergeJournals(here, there);
  assert.deepEqual(merged, {
    schema: 1, filled: BACKFILL_VERSION,
    finds: { bait: { knight: '2026-11-04', rook: '2026-11-13' }, net: { knight: '2026-11-09' }, tempo: { pawn: '2026-11-05' }, partner: { queen: '2026-12-01' } },
  });
  assert.deepEqual(mergeJournals(there, here).finds, { ...merged.finds });
  assert.deepEqual(here.finds, { bait: { knight: '2026-11-09' }, net: { knight: '2026-11-09' } }, 'inputs are left alone');
  // As stored text: null when the backup adds nothing or can't be read.
  const text = mergeJournalText(writeJournal(here), writeJournal(there));
  assert.deepEqual(readJournal(text), merged);
  assert.equal(mergeJournalText(text, writeJournal(there)), null);
  assert.equal(mergeJournalText(text, writeJournal(here)), null);
  assert.equal(mergeJournalText(writeJournal(here), 'nonsense'), null);
  assert.equal(mergeJournalText(writeJournal(here), '{"schema":9,"finds":{"crown":{"pawn":"2026-11-02"}}}'), null);
  assert.deepEqual(readJournal(mergeJournalText(undefined, writeJournal(there))).finds, readJournal(writeJournal(there)).finds);
  assert.equal(mergeJournalText(undefined, writeJournal(emptyJournal())), null, 'an empty journal restores nothing');
});

test('a backup carries the journal, and restoring merges it without touching the runs\' rules', () => {
  const backup = (saves) => ({ app: 'dungeon-chess-daily', schema: 1, saves });
  const here = writeJournal({ schema: 1, filled: BACKFILL_VERSION, finds: { bait: { knight: '2026-11-09' } } });
  const there = writeJournal({ schema: 1, finds: { bait: { rook: '2026-11-13' }, crown: { pawn: '2026-11-02' } } });
  const runKey = `daily:v${RULES_VERSION}:${OFFICER_DAY}`;
  const plan = planBackupMerge(new Map([[JOURNAL_KEY, here]]), backup({ [JOURNAL_KEY]: there, [runKey]: JSON.stringify(officer.won) }));
  assert.deepEqual([...plan.writes.keys()].sort(), [runKey, JOURNAL_KEY].sort());
  assert.deepEqual(readJournal(plan.writes.get(JOURNAL_KEY)), { schema: 1, filled: BACKFILL_VERSION, finds: { bait: { knight: '2026-11-09', rook: '2026-11-13' }, crown: { pawn: '2026-11-02' } } });
  assert.deepEqual(plan.unreadable, []);
  // A device with no journal takes the backup's; restoring the same backup twice writes nothing more.
  const fresh = planBackupMerge(new Map(), backup({ [JOURNAL_KEY]: there }));
  assert.deepEqual(readJournal(fresh.writes.get(JOURNAL_KEY)).finds, readJournal(there).finds);
  assert.equal(planBackupMerge(new Map([[JOURNAL_KEY, fresh.writes.get(JOURNAL_KEY)]]), backup({ [JOURNAL_KEY]: there })).writes.size, 0);
  // A journal this app can't read is left out, and the runs still restore.
  for (const bad of ['nonsense', '{"schema":9,"finds":{}}', 7, null]) {
    const kept = planBackupMerge(new Map([[JOURNAL_KEY, here]]), backup({ [JOURNAL_KEY]: bad, [runKey]: JSON.stringify(officer.won) }));
    assert.deepEqual([...kept.writes.keys()], [runKey], JSON.stringify(bad));
  }
});
