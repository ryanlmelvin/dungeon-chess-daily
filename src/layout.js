// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
//
// Where the board goes on screen so that the page's panels (the status corner,
// the objective and its targets row, the Wait key, the message log and the
// first-move tip) never cover a square or the exit door. Pure arithmetic on
// CSS pixels, so it can be checked for any viewport without a browser.
//
// Two arrangements are tried and the one that leaves the bigger board wins:
// - beside: the objective and log fill the margin left of the board, the tip
//   the margin right of it (wide screens, and phones held sideways);
// - stacked: the objective sits centered on top and a strip below holds the
//   log and tip (phones and tablets held upright).
// Either way Wait sits just above the board's top-right corner, or beside that
// corner when there is no room above it.

// The narrowest side margin the objective panel and log are given beside the board.
export const SIDE_MARGIN_MIN = 170;
// Room kept below the board, in the stacked arrangement, for the log and tip:
// less on a short phone, where the log trims to one line while the tip shows.
export const bottomPanelRoom = (height) => Math.round(Math.min(160, Math.max(120, height * 0.2)));
const GAP = 6;
// Wait sits this far right of the board when it goes beside the corner.
const WAIT_SIDE_GAP = 10;
const EDGE = 8;
const MIN_SCALE = 0.05;

// natural: the board's box with the camera's own fit, in CSS pixels from the
// container's top-left corner: left/right edges, doorTop (the top of the exit
// door, the highest thing on the board), rowTop (the top of the first row, rim
// and standing pieces included), bottom, and doorRight (the door's right edge).
// panels: the page's measured panels, or null before the page has measured
// them. Returns the scale (1 = natural, never larger) and pixel shift to apply,
// the resulting box, and where Wait goes (waitLeft/waitTop).
export function planBoardLayout({ width, height, natural, panels }) {
  const wB = natural.right - natural.left;
  const hB = natural.bottom - natural.doorTop;
  const gapR = natural.rowTop - natural.doorTop;
  if (!panels || width < 60 || height < 60 || !(wB > 0 && hB > gapR && gapR >= 0)) {
    return { mode: 'natural', scale: 1, dx: 0, dy: 0, wait: 'above', ...natural, waitLeft: natural.right - 80, waitTop: natural.rowTop - 50 };
  }
  const cx = width / 2, cy = height / 2;
  const naturalLeft = (s) => cx + (natural.left - cx) * s;
  const naturalTop = (s) => cy + (natural.doorTop - cy) * s;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
  const fit = (...limits) => Math.max(MIN_SCALE, Math.min(1, ...limits));
  const status = panels.status || { right: 0, bottom: 0 };
  const menu = panels.menu || { left: width, bottom: 0 };
  const wait = panels.wait || { width: 80, height: 44 };
  // Wait right-aligned over the corner reaches the door's column on a small board.
  const doorGap = natural.right - (natural.doorRight ?? natural.left + wB * 0.7);
  const overDoor = (s) => doorGap * s < wait.width + 2;
  const besideCornerRoom = wait.width + WAIT_SIDE_GAP + EDGE;
  const box = (mode, s, left, top, ceiling) => {
    const placed = { mode, scale: s, dx: left - naturalLeft(s), dy: top - naturalTop(s), left, right: left + wB * s, doorTop: top, rowTop: top + gapR * s, bottom: top + hB * s };
    const aboveTop = (overDoor(s) ? placed.doorTop : placed.rowTop) - wait.height - GAP;
    const roomBeside = width - placed.right >= besideCornerRoom - 0.5;
    placed.wait = aboveTop >= ceiling - 0.5 || !roomBeside ? 'above' : 'beside';
    placed.waitLeft = placed.wait === 'above' ? placed.right - wait.width : placed.right + WAIT_SIDE_GAP;
    placed.waitTop = placed.wait === 'above' ? aboveTop : placed.rowTop;
    return placed;
  };

  // Stacked: everything above the board ends at `ceiling`. Wait either takes a
  // row between the objective and the board's corner, or goes beside the corner.
  const ceiling = Math.max(panels.stackBottom || 0, status.bottom, menu.bottom) + GAP;
  const floor = height - bottomPanelRoom(height);
  const waitRow = ceiling + wait.height + GAP;
  const sTop = (floor - ceiling) / hB;
  // Wait beside the corner: the side margin has to hold it.
  const sCorner = fit(sTop, (width - 2 * besideCornerRoom) / wB);
  // Wait above the corner: the first row (or the door, when Wait reaches its
  // column) sits below Wait's row.
  let sAbove = fit(sTop, (floor - waitRow) / (hB - gapR));
  if (overDoor(sAbove)) sAbove = fit(sTop, (floor - waitRow) / hB);
  const stackedAt = (s, low) => box('stacked', s, naturalLeft(s), clamp(naturalTop(s), low, floor - hB * s), ceiling);
  const above = stackedAt(sAbove, Math.max(ceiling, waitRow - (overDoor(sAbove) ? 0 : gapR * sAbove)));
  const corner = stackedAt(sCorner, ceiling);
  const stacked = corner.wait === 'beside' && sCorner > sAbove + 1e-3 ? corner : above;

  // Beside: side margins at least SIDE_MARGIN_MIN. The status corner either
  // stays above the board (centered, door below the status) or, when that
  // costs more, the board slides right of it and keeps the full height.
  const side = SIDE_MARGIN_MIN;
  if (width - 2 * side <= 0) return stacked;
  const statusClear = status.bottom + GAP;
  const statusAbove = (b) => b.right - wait.width < status.right + EDGE ? statusClear : EDGE / 2;
  const centered = (top) => {
    const s = fit((width - 2 * side) / wB, (height - EDGE - top) / hB);
    return [s, clamp(naturalLeft(s), side, width - side - wB * s)];
  };
  let [sCentered, centeredLeft] = centered(EDGE);
  const overStatus = centeredLeft < status.right + EDGE;
  if (overStatus) [sCentered, centeredLeft] = centered(statusClear);
  const centeredTop = clamp(naturalTop(sCentered), overStatus ? statusClear : EDGE, height - EDGE - hB * sCentered);
  const leftOfStatus = Math.max(side, status.right + EDGE);
  const sShifted = fit((width - side - leftOfStatus) / wB, (height - 2 * EDGE) / hB);
  const shiftedLeft = clamp(naturalLeft(sShifted), leftOfStatus, width - side - wB * sShifted);
  const shiftedTop = clamp(naturalTop(sShifted), EDGE, height - EDGE - hB * sShifted);
  const centeredBox = box('beside', sCentered, centeredLeft, centeredTop, 0);
  const shiftedBox = box('beside', sShifted, shiftedLeft, shiftedTop, 0);
  let beside = sShifted > sCentered + 1e-3 ? shiftedBox : centeredBox;
  beside = box('beside', beside.scale, beside.left, beside.doorTop, statusAbove(beside));

  return beside.scale >= stacked.scale ? beside : stacked;
}
