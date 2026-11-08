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

/** Moves from the door opening to the cave-in, by the day's difficulty tier (src/difficulty.js). */
export const CAVE_IN_MOVES = Object.freeze({ gentle: 7, fair: 6, tricky: 5, tough: 4, fiendish: 4 });
/** Editions from before tiers (difficulty 'standard') or any other value. */
export const CAVE_IN_DEFAULT_MOVES = 5;
export const CAVE_IN_EVENTS = Object.freeze(['cave-in']);

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
    say(state, `The ceiling starts to crack! It caves in after ${moves} more moves, and gold you grab now is at risk until you take the stairs.`);
    return;
  }
  // A caved-in room takes no more moves (cavedIn), so nothing ticks there.
  if (!cave.moves) return;
  cave.risk += won;
  if (--cave.moves) {
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
  say(state, `The ceiling caved in! ${caveInText({ gold: lost, coins, power })}`);
}

/** What a cave-in cost, from its event: "You dropped 4 gold. The rubble buries … It carries you down the stairs to the shop." */
export function caveInText({ gold, coins, power }) {
  const buried = [coins && (coins === 1 ? 'the last coin' : 'the coins left'), power && `the ${POWER_NAMES[power] ?? 'pickup'}`].filter(Boolean);
  return [gold && `You dropped ${gold} gold.`, buried.length && `The rubble buries ${buried.join(' and ')}.`, 'It carries you down the stairs to the shop.'].filter(Boolean).join(' ');
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

/** Short in-game label, e.g. "🪨 Caving in 3", or '' while the ceiling holds. */
export function caveInStatus(state) {
  const cave = state?.status === 'playing' ? state.caveIn : null;
  if (!cave) return '';
  return cave.moves ? `🪨 Caving in ${cave.moves}` : '🪨 Caved in';
}

/** What tapping the chip says, with the day's own count. */
export function caveInExplain(state) {
  return `Cave-in: on floors 1 and 2 the open door cracks the ceiling. Today it caves in ${caveInMoves(state)} moves after the door opens (fewer on harder days). Gold you grab before then is at risk until you take the stairs. If it caves in first, you drop that gold, the coins and pickup left are buried, and the rubble carries you down the stairs to the shop.`;
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
