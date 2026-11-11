// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
//
// Cave-in: push your luck after a floor is cleared. On floors 1 and 2 the move
// that opens the door also cracks the ceiling. Gold won on any later move in
// that room is at risk until the stairs bank it. After a few more moves (waits
// count; fewer on harder days, CAVE_IN_MOVES) the ceiling caves in: the gold at
// risk is dropped, the coins and the powerup still lying there are buried, and
// the rubble carries you down the stairs to the shop, as if you'd taken them.
// The room is over: no more moves, waits or pins there (cavedIn), only the
// shop and the stairs down, or a Take-back of the move that caved it in. The
// last floor has no coins and no shop, so its ceiling holds.
//
// Certified routes take the stairs right after each clear (src/fairness.js),
// so no certified route ever meets a cave-in.
//
// The room shows the countdown (renderer.js, main.js): the crack ('cave-crack'
// event) and every move after it ('cave-tremor') shake the board and shake
// dust loose, harder as the count runs down, and the stairs button reads
// "Take the stairs! Caving in 3" (caveInLabel). The cave-in itself ('cave-in')
// brings the rubble down, then the shop opens with what it cost (caveInLoss).
//
// state.caveIn, absent until the door opens and on every new floor:
//   moves   moves left before the ceiling caves in, 0 once it has
//   risk    gold won since the door opened, 0 once it caves in. The shop is
//           at the stairs, so a purchase there spends banked gold first: what
//           is at risk is the smaller of this and the gold held (goldAtRisk).
//   buried  coins the cave-in buried: neither treasure nor gold
// state.dropped: gold the run has lost to cave-ins (absent: none), which keeps
// the gold ledger in validateSave exact.
//
// This module imports nothing from rules.js.

/** Moves from the door opening to the cave-in, by the monsters' tier (src/difficulty.js; every daily plays Fair). */
export const CAVE_IN_MOVES = Object.freeze({ gentle: 7, fair: 6, tricky: 5, tough: 4, fiendish: 4 });
/** Editions from before tiers (difficulty 'standard') or any other value. */
export const CAVE_IN_DEFAULT_MOVES = 5;
export const CAVE_IN_EVENTS = Object.freeze(['cave-in', 'cave-crack', 'cave-tremor']);

/** The day's countdown: how many moves after the door opens the ceiling caves in. */
export function caveInMoves(state) {
  return Object.hasOwn(CAVE_IN_MOVES, state?.difficulty ?? '') ? CAVE_IN_MOVES[state.difficulty] : CAVE_IN_DEFAULT_MOVES;
}

const say = (state, text) => { state.message = `${state.message ? `${state.message} ` : ''}${text}`; };
function drop(state, gold) {
  if (!gold) return;
  state.gold -= gold;
  state.dropped = (state.dropped ?? 0) + gold;
}
const lastFloor = (state) => state.floor >= state.targets.length - 1;
// What a cave-in buries: the room's coins and powerup, never a waiting recruit.
const buriable = (item) => item.type === 'coin' || item.type === 'powerup';
// The room powerups' names (POWERUPS in src/rules.js, which this module can't import).
const POWER_NAMES = Object.freeze({ shield: 'bone ward', freeze: 'frost hourglass', magnet: 'coin magnet' });

/**
 * End of a move or wait (after the monsters and the Collapse door): start,
 * advance or finish the countdown. `before` is the state the move began from;
 * gold only ever rises within a move, so the difference is what it won.
 */
export function caveInTick(state, before) {
  if (state.status !== 'playing' || !state.exit?.open || lastFloor(state)) return;
  const won = Math.max(0, state.gold - before.gold);
  const cave = state.caveIn;
  if (!cave) {
    // Whatever the door-opening move won was won clearing the room: it's safe.
    const moves = caveInMoves(state);
    state.caveIn = { moves, risk: 0, buried: 0 };
    state.events.push({ type: 'cave-crack', x: state.player.x, y: state.player.y, moves });
    say(state, `The ceiling starts to crack! It caves in after ${moves} more moves, and gold you grab now is at risk until you take the stairs.`);
    return;
  }
  // A caved-in room takes no more moves (cavedIn), so nothing ticks there.
  if (!cave.moves) return;
  cave.risk += won;
  if (--cave.moves) {
    state.events.push({ type: 'cave-tremor', x: state.player.x, y: state.player.y, left: cave.moves, total: caveInMoves(state) });
    const risk = goldAtRisk(state);
    if (cave.moves === 1) say(state, `The ceiling is about to cave in!${risk ? ` Take the stairs now to keep your ${risk} gold.` : ''}`);
    return;
  }
  const lost = goldAtRisk(state);
  const coins = state.items.filter((item) => item.type === 'coin').length;
  const power = state.items.find((item) => item.type === 'powerup')?.power;
  drop(state, lost);
  cave.risk = 0;
  cave.buried = coins;
  state.items = state.items.filter((item) => !buriable(item));
  state.events.push({ type: 'cave-in', x: state.player.x, y: state.player.y, gold: lost, coins, ...(power && { power }) });
  say(state, ['The ceiling caved in!', caveInLoss({ gold: lost, coins, power }), 'It carries you down the stairs to the shop.'].filter(Boolean).join(' '));
}

/** What a cave-in cost, from its event: "You dropped 4 gold. The rubble buries the coins left.", or '' for nothing. */
export function caveInLoss({ gold, coins, power }) {
  const buried = [coins && (coins === 1 ? 'the last coin' : 'the coins left'), power && `the ${POWER_NAMES[power] ?? 'pickup'}`].filter(Boolean);
  return [gold && `You dropped ${gold} gold.`, buried.length && `The rubble buries ${buried.join(' and ')}.`].filter(Boolean).join(' ');
}

/** True while the ceiling is counting down: the room can still pay, and Wait stays on offer. */
export function caveInRunning(state) {
  return state?.status === 'playing' && state.caveIn?.moves > 0;
}

/**
 * True once the ceiling has caved in: the rubble carried the player down the
 * stairs to the shop, so the room takes no more moves, waits or pins. What's
 * left is the shop, the stairs down (they finish the floor as if you'd taken
 * them yourself), and a held Take-back.
 */
export function cavedIn(state) {
  return state?.status === 'playing' && state.caveIn?.moves === 0;
}

/** Gold a cave-in would take right now: what the stairs would bank. */
export function goldAtRisk(state) {
  return Math.max(0, Math.min(state?.caveIn?.risk ?? 0, state?.gold ?? 0));
}

/** The stairs button during the countdown, e.g. "Take the stairs! Caving in 3", or '' otherwise. */
export function caveInLabel(state) {
  return caveInRunning(state) ? `Take the stairs! Caving in ${state.caveIn.moves}` : '';
}

/**
 * Shape checks for a save's cave-in fields; absent fields belong to older saves
 * (or to a floor whose door is still shut).
 */
export function validCaveIn(value) {
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (value.dropped !== undefined && !integer(value.dropped, 1, Number.MAX_SAFE_INTEGER)) return false;
  const cave = value.caveIn;
  if (cave === undefined) return true;
  if (!cave || typeof cave !== 'object' || Object.keys(cave).sort().join() !== 'buried,moves,risk') return false;
  if (value.status !== 'playing' || value.exit?.open !== true || lastFloor(value)) return false;
  const total = caveInMoves(value);
  if (!integer(cave.moves, 0, total) || !integer(cave.risk, 0, Number.MAX_SAFE_INTEGER) || !integer(cave.buried, 0, Number.MAX_SAFE_INTEGER)) return false;
  // The countdown can't be further along than the moves made since the door opened.
  const cleared = value.objective?.moves;
  if (Number.isInteger(cleared) && total - cave.moves > value.turns - value.floorStart.turns - cleared) return false;
  // Before the cave-in nothing is buried; after it nothing is at risk and no coin or powerup is left.
  return cave.moves ? cave.buried === 0 : cave.risk === 0 && !value.items.some(buriable);
}
