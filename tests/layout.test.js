// SPDX-License-Identifier: GPL-3.0-only
// The board's layout keeps every page panel off the squares and the exit door,
// at any viewport. The camera here is built exactly as the renderer builds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planBoardLayout, bottomPanelRoom } from '../src/layout.js';

const COLUMNS = 8, ROWS = 8, EXIT = { x: 4, y: 0 };

function camera(width, height) {
  const aspect = width / height;
  const doorRoom = 0.3;
  const halfHeight = Math.max(ROWS * 0.49 + 0.35 + doorRoom, (COLUMNS / 2 + 0.18) / aspect);
  const cam = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.1, 60);
  const x = (COLUMNS - 1) / 2, z = (ROWS - 1) / 2 - doorRoom;
  cam.position.set(x, 18, z + 5.8);
  cam.lookAt(x, 0.14, z);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}
function project(cam, width, height, x, z, y = 0) {
  const p = new THREE.Vector3(x, y, z).project(cam);
  return { x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height };
}
function naturalBox(cam, width, height) {
  const sx = (column) => project(cam, width, height, column, ROWS - 0.5).x;
  const sy = (z) => project(cam, width, height, 3.5, z).y;
  return { left: sx(-0.57), right: sx(COLUMNS - 0.43), doorRight: sx(EXIT.x + 0.56), doorTop: sy(EXIT.y - 1.32), rowTop: sy(-0.62), bottom: sy(ROWS - 0.38) };
}
// Apply a plan to the camera the way the renderer does.
function applyPlan(cam, width, plan, height) {
  const k = 1 / plan.scale;
  cam.left *= k; cam.right *= k; cam.top *= k; cam.bottom *= k;
  const across = plan.dx / width * (cam.right - cam.left);
  const down = plan.dy / height * (cam.top - cam.bottom);
  cam.left -= across; cam.right -= across; cam.top += down; cam.bottom += down;
  cam.updateProjectionMatrix();
}
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Generous estimates of the page's panels (VT323 at the game's sizes).
function panelsFor(width, wideStatus) {
  const status = { right: wideStatus ? Math.min(width - 74, 480) : Math.min(width - 74, 300), bottom: wideStatus ? 100 : 76 };
  const objectiveWidth = Math.min(width - 28, 480);
  const objectiveHeight = objectiveWidth >= 420 ? 84 : objectiveWidth >= 320 ? 108 : 132;
  const stackTop = Math.max(91, status.bottom + 8);
  return {
    stackTop, objectiveWidth,
    panels: { stackBottom: stackTop + objectiveHeight, status, menu: { left: width - 55, bottom: 54 }, wait: { width: 72, height: 40 } },
  };
}

const widths = [320, 360, 375, 390, 412, 430, 568, 600, 640, 667, 740, 768, 800, 812, 834, 844, 915, 932, 1024, 1180, 1280, 1366, 1440, 1536, 1920, 2560];
const heights = [320, 360, 375, 390, 412, 430, 480, 568, 600, 667, 720, 768, 800, 812, 844, 900, 932, 1024, 1080, 1180, 1366, 1440];

test('no page panel covers a square or the door at any viewport', () => {
  const problems = [];
  for (const width of widths) for (const height of heights) for (const wideStatus of [false, true]) {
    // A screen this small in both directions (no real phone) has no room for any arrangement.
    if (width < 400 && height < 480) continue;
    const where = `${width}x${height}${wideStatus ? ' (wide status)' : ''}`;
    const cam = camera(width, height);
    const { panels, stackTop, objectiveWidth } = panelsFor(width, wideStatus);
    const plan = planBoardLayout({ width, height, natural: naturalBox(cam, width, height), panels });
    applyPlan(cam, width, plan, height);
    const box = naturalBox(cam, width, height);
    for (const key of ['left', 'right', 'doorTop', 'rowTop', 'bottom']) if (!(Math.abs(box[key] - plan[key]) < 0.5)) problems.push(`${where}: planned ${key} ${plan[key]} vs drawn ${box[key]}`);
    const square = project(cam, width, height, 1, 0).x - project(cam, width, height, 0, 0).x;
    const squares = { left: box.left, right: box.right, top: box.rowTop, bottom: box.bottom };
    const doorX = project(cam, width, height, EXIT.x, 0).x;
    const door = { left: doorX - 0.56 * square, right: doorX + 0.56 * square, top: box.doorTop, bottom: box.rowTop };
    const clear = (name, rect) => {
      if (overlaps(rect, squares)) problems.push(`${where}: ${name} covers the board`);
      if (overlaps(rect, door)) problems.push(`${where}: ${name} covers the door`);
    };
    if (!(box.left >= 0 && box.right <= width && box.doorTop >= 0 && box.bottom <= height)) problems.push(`${where}: board off screen`);
    clear('status', { left: 12, right: panels.status.right, top: 10, bottom: panels.status.bottom });
    clear('menu', { left: panels.menu.left, right: width - 9, top: 8, bottom: panels.menu.bottom });
    const wait = { left: plan.waitLeft, top: plan.waitTop };
    Object.assign(wait, { right: wait.left + 72, bottom: wait.top + 40 });
    clear('Wait', wait);
    if (!(wait.right <= width && wait.top >= 0)) problems.push(`${where}: Wait off screen`);
    if (plan.mode === 'beside') {
      // Objective and log share the left margin, the tip the right one.
      if (!(box.left - 24 >= 140)) problems.push(`${where}: left margin too narrow for the objective`);
      if (!(width - box.right - 24 >= 120)) problems.push(`${where}: right margin too narrow for the tip`);
      if (overlaps(wait, { left: 12, right: panels.status.right, top: 10, bottom: panels.status.bottom })) problems.push(`${where}: Wait covers the status`);
    } else {
      if (plan.mode !== 'stacked') problems.push(`${where}: ${plan.mode}`);
      const objective = { left: (width - objectiveWidth) / 2, right: (width + objectiveWidth) / 2, top: stackTop, bottom: panels.stackBottom };
      clear('objective', objective);
      if (overlaps(wait, objective)) problems.push(`${where}: Wait covers the objective`);
      if (!(box.bottom <= height - bottomPanelRoom(height) + 0.5)) problems.push(`${where}: no strip below for the log and tip`);
    }
  }
  assert.deepEqual(problems, []);
});

test('wide desktop keeps the full-size board with the objective beside it', () => {
  for (const [width, height] of [[1440, 800], [1920, 1080], [1024, 768], [1280, 720], [1366, 768], [1024, 600]]) {
    const cam = camera(width, height);
    const plan = planBoardLayout({ width, height, natural: naturalBox(cam, width, height), panels: panelsFor(width, false).panels });
    assert.equal(plan.mode, 'beside', `${width}x${height}`);
    assert.ok(plan.scale > 0.85, `${width}x${height}: board shrank to ${plan.scale}`);
  }
});

test('phones and upright tablets stack the objective above the board', () => {
  for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [820, 1180]]) {
    const cam = camera(width, height);
    const plan = planBoardLayout({ width, height, natural: naturalBox(cam, width, height), panels: panelsFor(width, false).panels });
    assert.equal(plan.mode, 'stacked', `${width}x${height}`);
    assert.ok(plan.scale > 0.8, `${width}x${height}: board shrank to ${plan.scale}`);
  }
});
