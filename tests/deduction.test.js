// SPDX-License-Identifier: GPL-3.0-only
// The deduction loop: an anonymous paper with suspect lineups, unmasking on
// capture, and tiered hints whose paid tiers are penalty moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, createPracticeGame, getDaily, getShareText, validateSave, floorScoredMoves, scoredMoves, resetFloor } from '../src/game.js';
import { getRawDaily, headlineFor } from '../src/edition.js';
import { floorLineup, floorDecoys, paperSuspects, nextHint, hintCards, closeRangeSquares, closeAttacker, targetLine, targetSpecies, PAID_HINTS } from '../src/rules.js';
import { reinforcementOptions } from '../src/modifiers.js';
import { floorPars } from '../src/par.js';
import { botRun, playerRun } from '../src/bot.js';

const day = (offset) => new Date(Date.UTC(2026, 10, 5 + offset)).toISOString().slice(0, 10);
const json = (value) => JSON.parse(JSON.stringify(value));
const move = (x, y) => ({ type: 'move', x, y });
const hint = (name) => ({ type: 'hint', hint: name });
const daily = getDaily('2026-11-05');
const lines = (state) => [...(state.notes ?? []), state.message];

// Empty the room around a test position: the player's rook at (4, 6).
function scenario(game = createGame(daily)) {
  const state = structuredClone(game);
  Object.assign(state.player, { piece: 'rook', x: 4, y: 6, hp: 2, maxHp: 2 });
  state.map = Array(8).fill('........'); state.props = []; state.items = []; state.enemies = []; state.companion = null;
  return state;
}
function monster(id, species, x, y) {
  return { id, species: species.id, palette: species.palette, name: species.name, piece: species.piece, role: species.piece, x, y, moved: false, phase: 'ready', intent: [], target: null };
}
// Clear the floor and take its stairs.
function nextFloor(previous) {
  const state = structuredClone(previous);
  const optional = state.enemies.filter((foe) => foe.role !== state.objective.piece).length;
  state.captures += state.enemies.length; state.gold += optional; state.paidCaptures += optional;
  state.enemies = []; state.objective.complete = true; state.exit.open = true; state.turns++;
  return act(state, { type: 'descend' });
}

test('the paper never names a species or a palette: headlines are anonymous on every floor', () => {
  const words = new Set(['ice', 'ember', 'moss', 'violet', 'gold', 'rose']);
  for (let offset = 0; offset < 1200; offset++) {
    for (const species of getRawDaily(day(offset)).species) for (const name of [species.baseName, species.plural]) for (const word of name.toLowerCase().split(' ')) words.add(word);
  }
  assert.ok(words.size > 50, 'every species name is collected');
  const pattern = new RegExp(`\\b(${[...words].join('|')})\\b`, 'i');
  for (let offset = 0; offset < 731; offset++) {
    const { date, species } = getRawDaily(day(offset));
    for (let floor = 0; floor < 3; floor++) {
      const headline = headlineFor(species[floor], date, floor);
      assert.doesNotMatch(headline, pattern, `${date} floor ${floor + 1}: ${headline}`);
      assert.ok(!headline.includes(species[floor].name) && !headline.toLowerCase().includes(species[floor].plural.toLowerCase()), headline);
    }
  }
});

test('each floor\'s full cast is exactly the species that can stand there, ordered by name', () => {
  const firsts = new Set();
  const sizes = new Set();
  for (let offset = 0; offset < 70; offset++) {
    const issue = getDaily(day(offset));
    let state = createGame(issue);
    for (let floor = 0; floor < 3; floor++) {
      if (floor) state = nextFloor(state);
      assert.equal(state.floor, floor);
      const lineup = floorLineup(issue, floor);
      const residents = new Set(state.enemies.map((foe) => foe.species));
      // Collapse days may add the floor's decoy species through the door.
      const arrivals = issue.modifier === 'collapse' ? [0, 1, 2].flatMap((n) => reinforcementOptions(state, n).map((foe) => foe.species)) : [];
      assert.deepEqual(new Set(lineup.map((species) => species.id)), new Set([...residents, ...arrivals]), `${issue.date} floor ${floor + 1}`);
      assert.ok(lineup.some((species) => species.id === issue.species[floor].id), 'the target is a suspect');
      assert.deepEqual(lineup.map((species) => species.name), lineup.map((species) => species.name).sort(), 'ordered by name');
      assert.deepEqual(floorLineup(state), lineup, 'the paper and the board agree');
      firsts.add(lineup[0].id === issue.species[floor].id);
      sizes.add(lineup.length);
    }
  }
  assert.deepEqual(firsts, new Set([true, false]), 'the target is first only by alphabet');
  // Every public floor keeps at least one decoy (src/difficulty.js knobsFor): never a target alone.
  assert.ok(!sizes.has(1) && sizes.has(2) && sizes.has(3), 'one- and two-decoy-species casts occur, a lone target never');
});

test('the paper shows two suspects: the target and one other species from the floor, stable per date, by name', () => {
  const firsts = new Set();
  let arrivalsOnly = 0, alone = 0, firstDecoy = 0, secondDecoy = 0;
  for (let offset = 0; offset < 120; offset++) {
    const issue = getDaily(day(offset));
    const pristine = structuredClone(issue);
    for (let floor = 0; floor < 3; floor++) {
      const cast = floorLineup(issue, floor);
      const shown = paperSuspects(issue, floor);
      const target = issue.species[floor];
      const label = `${issue.date} floor ${floor + 1}`;
      assert.equal(shown.length, Math.min(2, cast.length), label);
      assert.ok(shown.some((species) => species.id === target.id), `${label}: the target is always a suspect`);
      assert.ok(shown.every((species) => cast.some((entry) => entry.id === species.id)), `${label}: suspects can appear there`);
      assert.deepEqual(shown.map((species) => species.name), shown.map((species) => species.name).sort(), `${label}: ordered by name`);
      // A decoy already in the room comes before a collapse arrival.
      const other = shown.find((species) => species.id !== target.id);
      const decoys = [...new Map(floorDecoys(issue, floor).map((species) => [species.id, species])).values()];
      if (other && decoys.length) assert.ok(decoys.some((species) => species.id === other.id), `${label}: the other suspect is a decoy`);
      if (other && !decoys.length) arrivalsOnly++;
      if (!other) alone++;
      if (decoys.length === 2) other.id === decoys[0].id ? firstDecoy++ : secondDecoy++;
      // Stable: the same date always picks the same pair, whatever ran before.
      assert.deepEqual(paperSuspects(getDaily(issue.date), floor), shown, `${label}: stable`);
      firsts.add(shown[0].id === target.id);
    }
    // The paper draws from its own hash stream: the edition and its dungeon are untouched.
    assert.deepEqual(issue, pristine);
    assert.deepEqual(createGame(issue), createGame(pristine));
  }
  assert.deepEqual(firsts, new Set([true, false]), 'the target is first only by alphabet');
  assert.ok(firstDecoy > 0 && secondDecoy > 0, 'either decoy species can be the one shown');
  // Every public floor keeps at least one decoy (src/difficulty.js knobsFor), so its lineup always has a decoy to suspect.
  assert.equal(alone + arrivalsOnly, 0, 'no open-and-shut or arrival-only floors in public editions');
});

test('capturing a species the paper did not show still unmasks it and saves', () => {
  let found = null;
  for (let offset = 0; offset < 120 && !found; offset++) {
    const issue = getDaily(day(offset));
    let state = createGame(issue);
    for (const action of issue.generation.certificate.actions) {
      state = act(state, action);
      const hidden = state.events.find((event) => event.type === 'unmask' && !paperSuspects(issue, state.floor).some((species) => species.id === event.species));
      if (hidden) { found = { issue, state, species: hidden.species }; break; }
    }
  }
  assert.ok(found, 'some certified route captures a species the paper left out');
  assert.ok(found.state.unmasked.includes(found.species));
  assert.equal(validateSave(json(found.state), found.issue.date), true);
});

test('a capture unmasks the monster: an event, a log line, and its species badged from then on', () => {
  const state = scenario();
  const [target, , , decoy] = state.species;
  state.objective = { piece: target.piece, complete: false };
  state.enemies = [monster('a', decoy, 4, 3), monster('b', decoy, 0, 0), monster('t', target, 7, 0)];
  const next = act(state, move(4, 3));
  assert.deepEqual(next.events.find((event) => event.type === 'unmask'), { type: 'unmask', id: 'a', species: decoy.id, role: decoy.piece, x: 4, y: 3 });
  assert.deepEqual(next.unmasked, [decoy.id]);
  const article = decoy.piece === 'king' ? 'the' : 'a';
  assert.ok(lines(next).some((line) => line.startsWith(`${decoy.name} unmasked — ${article} ${decoy.piece}! +1 gold.`)), lines(next).join(' | '));
  // The monster not yet captured stays masked: only captured species are ever unmasked.
  assert.ok(!next.unmasked.includes(target.id));
  // A recruit's capture unmasks too.
  const ally = structuredClone(next);
  const other = ally.species[4];
  ally.enemies = [monster('c', other, 4, 1), monster('t', target, 7, 7)];
  ally.companion = { piece: 'rook', basePiece: 'rook', x: 4, y: 6, moved: true, sharing: false };
  ally.player.x = 0; ally.player.y = 6;
  const recruited = act(ally, { type: 'wait' });
  assert.ok(recruited.events.some((event) => event.type === 'companion-capture' && event.id === 'c'));
  assert.ok(recruited.events.some((event) => event.type === 'unmask' && event.id === 'c' && event.species === other.id));
  assert.deepEqual(recruited.unmasked, [decoy.id, other.id]);
});

test('the capture that completes the challenge keeps its unmasking line before the challenge line', () => {
  const state = scenario();
  const target = state.species[0];
  state.objective = { piece: target.piece, complete: false };
  // The last target left on the floor.
  state.enemies = [monster('t', target, 4, 3)];
  const done = act(state, move(4, 3));
  assert.equal(done.objective.complete, true);
  const said = lines(done);
  const unmasked = said.findIndex((line) => line.startsWith(`${target.name} unmasked`));
  const complete = said.findIndex((line) => line.startsWith('You completed the challenge ✓'));
  assert.ok(unmasked >= 0 && complete > unmasked, said.join(' | '));
});

test('unmaskings survive a floor restart and a Take-back, and end with the floor or the try', () => {
  const route = daily.generation.certificate.actions;
  let state = createGame(daily);
  let captured = new Set();
  for (const action of route) {
    const next = act(state, action);
    if (next.floor !== state.floor) captured = new Set();
    for (const event of next.events) if (event.type === 'unmask') captured.add(event.species);
    // Only species actually captured on this floor are ever unmasked.
    assert.deepEqual(new Set(next.unmasked ?? []), next.floor === state.floor ? captured : new Set());
    state = next;
    if (state.unmasked && state.floor === 0) break;
  }
  assert.ok(state.unmasked?.length, 'the route captures something on floor 1');
  const restarted = resetFloor(state);
  assert.deepEqual(restarted.unmasked, state.unmasked);
  assert.equal(validateSave(json(restarted), daily.date), true);
  // A Take-back restores the position before the capture but keeps what was seen.
  let held = createGame(daily); held.powers.takeback = 1;
  for (const action of route) {
    held = act(held, action);
    if (held.unmasked) break;
  }
  const back = act(held, { type: 'takeback' });
  assert.deepEqual(back.unmasked, held.unmasked);
  assert.ok(back.turns < held.turns);
  // A new floor holds new species.
  assert.equal(nextFloor(state).unmasked, undefined);
  assert.equal(validateSave(json(createGame(daily)), daily.date), true);
});

test('saves accept unmaskings of this floor\'s species only', () => {
  const state = createGame(daily);
  const lineup = floorLineup(state).map((species) => species.id);
  assert.equal(validateSave(json({ ...state, unmasked: [lineup[0]] }), daily.date), true);
  for (const bad of [[], [lineup[0], lineup[0]], ['dragon-king'], [state.species[2].id], 'bat']) {
    assert.equal(validateSave(json({ ...state, unmasked: bad }), daily.date), false, JSON.stringify(bad));
  }
  const snapshot = createGame(daily); snapshot.floorSnapshot.unmasked = [lineup[0]];
  assert.equal(validateSave(json(snapshot), daily.date), false);
});

test('hints: the first is free, then identifying the target and the danger map each add one move without passing a turn', () => {
  const state = createGame(daily);
  assert.deepEqual(PAID_HINTS, ['suspects', 'danger']);
  assert.equal(nextHint(state), 'suspects');
  assert.equal(act(state, hint('danger')), state, 'the tiers come in order');
  const one = act(state, hint('suspects'));
  assert.deepEqual(one.hints, ['suspects']);
  assert.equal(floorScoredMoves(one), 1);
  assert.equal(one.turns, state.turns, 'no turn passes');
  assert.deepEqual(one.enemies, state.enemies, 'no monster moves');
  assert.deepEqual(one.events.map((event) => event.type), ['hint']);
  assert.equal(one.message, `Target identified (+1 move): ${targetLine(one)}`);
  assert.match(one.message, new RegExp(`the ${state.species[0].palette} [a-z ]+ (are|is) the enemy ${state.objective.piece}`, 'i'));
  assert.equal(validateSave(json(one), daily.date), true);
  assert.equal(nextHint(one), 'danger');
  const two = act(one, hint('danger'));
  assert.deepEqual(two.hints, ['suspects', 'danger']);
  assert.match(two.message, /^Danger map \(\+1 move\): hatched squares/);
  assert.equal(floorScoredMoves(two), 2);
  assert.equal(nextHint(two), null);
  assert.equal(act(two, hint('danger')), two);
  assert.equal(act(two, hint('suspects')), two);
  assert.equal(validateSave(json(two), daily.date), true);
  // A move afterwards counts on top.
  const moved = act(two, daily.generation.certificate.actions[0]);
  assert.equal(floorScoredMoves(moved), 3);
});

test('an unmasked target needs no target hint, and nothing is for sale once the challenge is complete', () => {
  const state = createGame(daily);
  const known = { ...structuredClone(state), unmasked: [targetSpecies(state).id] };
  assert.equal(nextHint(known), 'danger');
  const danger = act(known, hint('danger'));
  assert.deepEqual(danger.hints, ['danger']);
  assert.equal(nextHint(danger), null);
  assert.equal(validateSave(json(danger), daily.date), true);
  let done = createGame(daily);
  for (const action of daily.generation.certificate.actions) {
    done = act(done, action);
    if (done.objective.complete) break;
  }
  assert.equal(done.floor, 0);
  assert.equal(nextHint(done), null);
  assert.equal(act(done, hint('suspects')), done);
  assert.equal(act(done, hint('danger')), done);
});

test('paid hints score like moves: restarts keep them, and records, par, the share card and the bot table count them', () => {
  // The certified route's own moves per floor, so the strokes read as +N whatever par is (src/par.js).
  const pars = botRun(daily).floors;
  const route = daily.generation.certificate.actions;
  let state = act(act(createGame(daily), hint('suspects')), hint('danger'));
  // A restart keeps the hints (and shows them), counting the moves made before it once.
  state = act(state, route[0]);
  const restarted = resetFloor(state);
  assert.deepEqual(restarted.hints, ['suspects', 'danger']);
  assert.equal(restarted.restartedMoves, 1);
  assert.equal(floorScoredMoves(restarted), floorScoredMoves(state));
  assert.equal(validateSave(json(restarted), daily.date), true);
  state = restarted;
  let cleared = null;
  for (const action of route) {
    state = act(state, action);
    if (!cleared && state.objective.complete) cleared = state;
  }
  assert.equal(state.status, 'won');
  assert.ok(lines(cleared).some((line) => line.startsWith(`You completed the challenge ✓ in ${pars[0] + 3} moves`)), lines(cleared).join(' | '));
  assert.deepEqual(state.records[0].hints, ['suspects', 'danger']);
  assert.equal(state.records[1].hints, undefined, 'hints are per floor');
  assert.deepEqual(state.records.map(scoredMoves), [pars[0] + 3, pars[1], pars[2]]);
  assert.equal(playerRun(state).moves, pars[0] + pars[1] + pars[2] + 3);
  // No new symbols on the share card: the hints are just strokes.
  const card = getShareText(state, pars).split('\n');
  assert.equal(card[1].split(' ').slice(0, 2).join(' '), '🟥 +3');
  assert.doesNotMatch(card.join('\n'), /hint|💡|\?/i);
  assert.equal(validateSave(json(state), daily.date), true);
  // Forged or misplaced hints are rejected.
  const forge = (mutate) => { const copy = json(state); mutate(copy); return validateSave(copy, daily.date); };
  assert.equal(forge((save) => { save.hints = ['danger']; }), false, 'the last floor\'s hints must match its record');
  assert.equal(forge((save) => { save.records[0].hints = ['peek']; }), false);
  assert.equal(forge((save) => { save.records[0].hints = []; }), false);
  for (const bad of [[], ['peek'], ['danger', 'danger'], 'suspects', 1]) {
    assert.equal(validateSave(json({ ...createGame(daily), hints: bad }), daily.date), false, JSON.stringify(bad));
  }
  const snapshot = createGame(daily); snapshot.floorSnapshot.hints = ['suspects'];
  assert.equal(validateSave(json(snapshot), daily.date), false);
});

test('a Take-back undoes the move, not the hint bought since; a new try starts without hints', () => {
  const route = daily.generation.certificate.actions;
  let state = createGame(daily); state.powers.takeback = 1;
  state = act(state, route[0]);
  state = act(state, hint('suspects'));
  const back = act(state, { type: 'takeback' });
  assert.equal(back.turns, 0);
  assert.deepEqual(back.hints, ['suspects']);
  assert.equal(floorScoredMoves(back), 1);
  // Losing every life starts a new try: fresh counts, fresh hints.
  const doomed = scenario(act(createGame(daily), hint('suspects')));
  doomed.player.hp = 1;
  const rook = doomed.species.find((species) => species.piece === 'rook') ?? doomed.species[3];
  doomed.enemies = [{ ...monster('r', rook, 4, 0), piece: 'rook', phase: 'aim', target: { x: 4, y: 6 }, intent: Array.from({ length: 6 }, (_, n) => ({ x: 4, y: n + 1 })) }];
  const lost = act(doomed, move(4, 5));
  assert.equal(lost.tries, 2);
  assert.equal(lost.hints, undefined);
  assert.equal(lost.unmasked, undefined);
});

test('the hint dialog pages the cards unlocked on this floor: the free card first, then each paid one in unlock order', () => {
  const state = createGame(daily);
  assert.deepEqual(hintCards(state), ['moves']);
  const one = act(state, hint('suspects'));
  assert.deepEqual(hintCards(one), ['moves', 'suspects']);
  const two = act(one, hint('danger'));
  assert.deepEqual(hintCards(two), ['moves', 'suspects', 'danger']);
  // Paging only reads the state.
  const before = json(two);
  hintCards(two);
  assert.deepEqual(json(two), before);
  // A reload rebuilds the pages from the save; a floor restart keeps them; the next floor starts over.
  assert.deepEqual(hintCards(json(two)), hintCards(two));
  assert.deepEqual(hintCards(resetFloor(two)), ['moves', 'suspects', 'danger']);
  assert.deepEqual(hintCards(nextFloor(two)), ['moves']);
  // With the target already unmasked, the danger map is the second page.
  const known = { ...structuredClone(state), unmasked: [targetSpecies(state).id] };
  assert.deepEqual(hintCards(act(known, hint('danger'))), ['moves', 'danger']);
});

test('practice runs pay for hints the same way, without a par', () => {
  const piece = daily.playerPiece === 'rook' ? 'bishop' : 'rook';
  const practice = createPracticeGame(daily, { piece });
  const paid = act(practice, hint('suspects'));
  assert.equal(floorScoredMoves(paid), 1);
  assert.equal(validateSave(json(paid), daily.date, { practice: true }), true);
  const moved = act(paid, { type: 'wait' });
  assert.equal(floorScoredMoves(moved), 2);
  assert.equal(getShareText(moved).split('\n')[1], '🟥 ·');
});

test('the danger map shades exactly the squares where ending a move is captured at once', () => {
  const state = scenario();
  const [target, , , decoy] = state.species;
  state.objective = { piece: target.piece, complete: false };
  state.enemies = [{ ...monster('n', decoy, 2, 2), piece: 'knight', role: 'knight' }, { ...monster('r', target, 6, 2), piece: 'rook', role: 'rook' }];
  const squares = closeRangeSquares(state);
  const key = (tile) => `${tile.x},${tile.y}`;
  const expected = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (!(x === 4 && y === 6) && closeAttacker(state, { x, y })) expected.push(`${x},${y}`);
  assert.deepEqual(squares.map(key), expected);
  // The knight's L-shaped jumps and the rook's four neighbors.
  for (const tile of ['0,1', '1,0', '3,0', '4,1', '4,3', '3,4', '1,4', '0,3', '6,1', '5,2', '7,2', '6,3']) assert.ok(squares.map(key).includes(tile), tile);
  assert.ok(!squares.map(key).includes('5,1'), 'a rook does not strike diagonally');
  // A frozen room is safe everywhere.
  assert.deepEqual(closeRangeSquares({ ...state, powers: { ...state.powers, freeze: 3 } }), []);
});
