// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// How the human-like bot (src/human-bot.js) steers its recruit, as a player
// on Manual recruit control (the default) does. It is the bot's default
// recruit policy, so par, the result card's Dungeon Bot and the human gap all
// assume a steered recruit; scripts/measure-recruits.mjs prices it against
// Auto (autoRecruit in src/human-bot.js).
//
// It decides from what a player sees once the move is on the board, like the
// Manual green dots (recruitChoice in src/rules.js): squares, red lanes, and
// which monsters are the targets (the bot's view knows the target species, as
// if the newspaper were solved). It never reads a hidden role. The recruit is
// never captured, so the only risk an order carries is moving it out of a
// red lane it blocks. Its squares come from recruitChoice, so it keeps the
// rules a player's orders keep: no capture on the turn the recruit joins, and
// no orders once a floor is cleared (the recruit hunts on its own).
// It is deterministic: the same position and move give the same order, so a
// run replayed from its seed (humanRun) gives the same orders again.
import { recruitChoice } from './rules.js';
import { distanceTable, UNREACHABLE } from './move-tables.js';

const same = (a, b) => a.x === b.x && a.y === b.y;
const square = (tile) => ({ x: tile.x, y: tile.y });

// Is `tile` strictly between `from` and `to` on one rook or bishop line?
function between(from, to, tile) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return false;
  const length = Math.max(Math.abs(dx), Math.abs(dy)), mx = tile.x - from.x, my = tile.y - from.y;
  const step = Math.max(Math.abs(mx), Math.abs(my));
  return step > 0 && step < length && mx * length === dx * step && my * length === dy * step;
}

/**
 * The order to add to `choice` (the bot's action on `state`; `view` is its
 * observe() view before the move), or undefined to leave the recruit on Auto.
 * In order: keep blocking a red lane through the player's square; step into
 * one; take a target; take a decoy; else step closer to the nearest target
 * over the room's walls (src/move-tables.js), when that gains ground. On the
 * bishop pair's hop it picks the hop square nearest a target.
 */
export function steerRecruit(state, choice, view) {
  if (choice?.type !== 'move' && choice?.type !== 'wait') return undefined;
  const probe = recruitChoice(state, choice);
  if (!probe?.board.companion) return undefined;
  const { board, moves } = probe, unit = board.companion;
  const targetIds = new Set(view.monsters.filter((foe) => foe.target).map((foe) => foe.id));
  const targets = board.enemies.filter((foe) => targetIds.has(foe.id));
  if (!targets.length || !moves.length) return undefined;
  const table = distanceTable(board.map, unit.piece);
  const distance = (tile) => Math.min(...targets.map((foe) => {
    const steps = table[(tile.y * 8 + tile.x) * 64 + foe.y * 8 + foe.x];
    return steps === UNREACHABLE ? 20 : steps;
  }));
  const nearest = (tiles) => tiles.reduce((best, tile) => (!best || distance(tile) < distance(best) ? tile : best), null);
  if (probe.hop) return square(nearest(moves));
  const lanes = board.enemies.filter((foe) => foe.phase === 'aim' && foe.intent.some((tile) => same(tile, board.player)));
  if (lanes.some((foe) => between(foe, board.player, unit))) return 'hold';
  const block = moves.find((tile) => !tile.capture && lanes.some((foe) => between(foe, board.player, tile)));
  if (block) return square(block);
  const occupant = (tile) => board.enemies.find((foe) => same(foe, tile));
  const target = moves.find((tile) => tile.capture && targetIds.has(occupant(tile)?.id));
  if (target) return square(target);
  const decoy = moves.find((tile) => tile.capture);
  if (decoy) return square(decoy);
  const closer = nearest(moves.filter((tile) => distance(tile) < distance(unit)));
  return closer ? square(closer) : undefined;
}
