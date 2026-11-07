// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import * as THREE from 'three';
import { SPRITES, PALETTE, spritePalette, piecePalette, COMPANION_PALETTE, STONE_SIZE, paintStone, CROWN, CROWN_PALETTE } from './sprites.js';

const VOID = 0x100d12;
const WHITE = 0xeee8e1;
const RED = 0xd13959;
const MINT = 0x8af4d5;
const MOVE_COLOR = 0x56dcff;
const ICE_COLOR = 0xbfeaff;
// How long an attacker's lunge toward the player lasts.
const STRIKE_MS = 300;
const FORK_GLOW_MS = 900;
const CROWN_POP_MS = 450;
const CROWN_WIDTH = 0.5;
// Screen-up in world space for the board camera (about 72 degrees down), so a
// crown can sit above a monster's head on screen without leaving its tile.
const SCREEN_UP = new THREE.Vector3(0, 0.309, -0.951);

function pixelTexture(rows, paletteOverride = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...rows.map((row) => row.length));
  canvas.height = rows.length;
  const context = canvas.getContext('2d');
  const palette = { ...PALETTE, ...paletteOverride };
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (!palette[key]) return;
    context.fillStyle = palette[key];
    context.fillRect(x, y, 1, 1);
  }));
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function stoneTexture(red, variation) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STONE_SIZE;
  paintStone(canvas.getContext('2d'), red, variation);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createDungeonRenderer(container, { onTile, onLayout } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(VOID);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;touch-action:none;';
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Dungeon chessboard. Tap a destination square to move. Tap your piece to show its legal moves.');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4.5, 4.5, 4.5, -4.5, 0.1, 60);
  const board = new THREE.Group();
  const actors = new THREE.Group();
  const hints = new THREE.Group();
  const collectibles = new THREE.Group();
  scene.add(board, hints, collectibles, actors);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const materials = new Set();
  const textures = new Map(Object.entries(SPRITES).map(([id, rows]) => [id, pixelTexture(rows)]));
  textures.set('crown', pixelTexture(CROWN, CROWN_PALETTE));
  textures.set('coin', pixelTexture(['..xxxx..', '.xywwyx.', 'xyywywyx', 'xyyywyyx', 'xyyywyyx', 'xyywywyx', '.xyyyyx.', '..xxxx..']));
  const stones = Array.from({ length: 8 }, (_, i) => stoneTexture(i < 4, i % 4));
  const entities = new Map();
  const targets = [];
  const particles = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = null;
  let boardKey = '';
  let columns = 8;
  let rows = 8;
  let pointerStart = null;
  let disposed = false;
  let animation;
  let lastTime = 0;
  let lastRendered = 0;
  let currentTurn = -1;
  let pendingTransition = null;
  let pendingHints = null;
  let stairMaterial = null;
  let stairGlow = null;
  let stairs = null;
  let door = null;
  let exitTile = { x: 4, y: 0 };
  let itemKey = '';
  let pendingItems = null;
  let lastEvents = null;
  let moveMaterial = null;
  const playerPulse = { value: 0 };
  const moveColor = { value: new THREE.Color(MOVE_COLOR) };

  function basic(color, extra = {}) {
    const material = new THREE.MeshBasicMaterial({ color, ...extra });
    materials.add(material);
    return material;
  }

  function block(parent, x, height, z, width, depth, length, material) {
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.set(x, height, z);
    mesh.scale.set(width, depth, length);
    parent.add(mesh);
    return mesh;
  }

  function tileMark(parent, x, z, width, length, material, height = 0.035) {
    const mesh = new THREE.Mesh(plane, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, height, z);
    mesh.scale.set(width, length, 1);
    parent.add(mesh);
    return mesh;
  }

  function spriteTexture(id, palette) {
    if (!SPRITES[id]) id = 'skull';
    const piece = id.startsWith('piece-');
    if (!palette || (piece && palette === 'white')) return textures.get(id);
    const key = `${id}:${palette}`;
    if (!textures.has(key)) textures.set(key, pixelTexture(SPRITES[id], palette === 'companion' ? COMPANION_PALETTE : piece ? piecePalette(palette) : spritePalette(palette)));
    return textures.get(key);
  }

  function tileRing(parent, x, y, inner, outer, color, opacity = 0.8, height = 0.045) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 16), basic(color, { transparent: true, opacity, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, height, y);
    parent.add(ring);
    return ring;
  }

  function propSprite(parent, id, x, y, size = 0.84, height = 0.25) {
    const material = new THREE.SpriteMaterial({ map: spriteTexture(id), transparent: true, alphaTest: 0.1, depthWrite: false });
    materials.add(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);
    sprite.position.set(x, height, y);
    parent.add(sprite);
    return sprite;
  }

  function release(object) {
    object.traverse((child) => {
      const owned = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of owned) if (material && materials.delete(material)) material.dispose();
      if (child.isMesh && child.geometry !== cube && child.geometry !== plane) child.geometry.dispose();
    });
    object.removeFromParent();
  }

  function clear(group) {
    for (const child of [...group.children]) release(child);
  }

  function buildBoard(next) {
    pendingTransition = null;
    pendingHints = null;
    pendingItems = null;
    clear(board);
    clear(actors);
    clear(hints);
    clear(collectibles);
    itemKey = '';
    pendingItems = null;
    targets.length = particles.length = 0;
    entities.clear();
    columns = next.map?.[0]?.length || 8;
    rows = next.map?.length || 8;
    const centerX = (columns - 1) / 2;
    const centerZ = (rows - 1) / 2;
    const dark = basic(0x141017);
    const redEdge = basic(0x3e2530);
    const edgeTop = basic(0x56404a);
    const tileMaterials = stones.map((texture) => basic(0xffffff, { map: texture }));
    // A low cut-stone edge, not a framed UI panel.
    block(board, centerX, -0.12, centerZ, columns + 0.18, 0.2, rows + 0.18, dark);
    block(board, centerX, -0.02, -0.57, columns + 0.2, 0.06, 0.08, edgeTop);
    block(board, centerX, -0.02, rows - 0.43, columns + 0.2, 0.06, 0.08, redEdge);
    for (const x of [-0.57, columns - 0.43]) block(board, x, -0.025, centerZ, 0.08, 0.06, rows + 0.2, redEdge);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const index = ((x + y) % 2 === 0 ? 0 : 4) + (x * 3 + y * 7) % 4;
      const tile = block(board, x, -0.035, y, 0.975, 0.07, 0.975, tileMaterials[index]);
      tile.userData.tile = { x, y };
      targets.push(tile);
      if (next.map[y][x] === '#') {
        const prop = next.props?.find((entry) => entry.x === x && entry.y === y);
        const type = prop?.type || ['pillar', 'crate', 'barrel', 'rock'][(x * 3 + y + next.floor) % 4];
        // A raised, dark footprint makes blocked squares clear at phone scale.
        block(board, x, 0.045, y, 0.78, 0.14, 0.78, basic(0x19151c));
        propSprite(board, `prop-${type}`, x, y, 0.9, 0.27);
        if (type === 'pillar') {
          // Fallen chunks around the stump read as ruined masonry, not a piece.
          const rubble = basic(0x71828e);
          block(board, x + 0.3, 0.13, y + 0.28, 0.13, 0.05, 0.1, rubble);
          block(board, x - 0.31, 0.13, y + 0.25, 0.09, 0.05, 0.08, rubble);
        }
      } else if ((x * 13 + y * 7 + next.seed) % 7 === 0 && !(x === next.exit.x && y === next.exit.y)) {
        // Loose chips and bone fragments stay at the edge of walkable tiles.
        const chip = basic((x + y) % 2 ? 0x544958 : 0x8a6268);
        tileMark(board, x - 0.32, y + 0.3, 0.11, 0.045, chip, 0.015);
        tileMark(board, x - 0.21, y + 0.35, 0.055, 0.03, chip, 0.015);
        if (x % 2) tileMark(board, x + 0.32, y - 0.29, 0.065, 0.035, chip, 0.015);
      }
    }
    // Ice days: glazed tiles with a couple of bright glints.
    if (next.ice?.length) {
      const glaze = basic(ICE_COLOR, { transparent: true, opacity: 0.42, depthWrite: false });
      const glint = basic(0xffffff, { transparent: true, opacity: 0.8, depthWrite: false });
      for (const tile of next.ice) {
        tileMark(board, tile.x, tile.y, 0.9, 0.9, glaze, 0.006);
        const streak = tileMark(board, tile.x - 0.16, tile.y - 0.14, 0.32, 0.04, glint, 0.008);
        streak.rotation.z = Math.PI / 4;
        const dot = tileMark(board, tile.x + 0.2, tile.y + 0.18, 0.14, 0.04, glint, 0.008);
        dot.rotation.z = Math.PI / 4;
      }
    }
    // The exit is a door set into the back wall, behind the exit square, so the
    // square itself stays an ordinary tile (a pawn can still promote there).
    // The door stays shut until the floor's capture is complete, then opens
    // onto the stairwell. guide-art.js draws the same doorway.
    const exit = next.exit || { x: 4, y: 0 };
    exitTile = { x: exit.x, y: exit.y };
    const doorZ = exit.y - 0.95;
    const doorway = new THREE.Group();
    board.add(doorway);
    block(doorway, exit.x, -0.06, doorZ, 1.04, 0.14, 0.62, dark);
    block(doorway, exit.x - 0.5, 0.02, doorZ, 0.1, 0.1, 0.62, edgeTop);
    block(doorway, exit.x + 0.5, 0.02, doorZ, 0.1, 0.1, 0.62, edgeTop);
    block(doorway, exit.x, 0.02, doorZ - 0.3, 1.1, 0.1, 0.08, edgeTop);
    const doorTarget = tileMark(doorway, exit.x, doorZ, 1.0, 0.62, basic(0x000000, { transparent: true, opacity: 0, depthWrite: false }), 0.03);
    doorTarget.userData.tile = { x: exit.x, y: exit.y - 1 };
    targets.push(doorTarget);
    door = new THREE.Group();
    doorway.add(door);
    const wood = basic(0x5a3a2c);
    const iron = basic(0x2a2530);
    for (let i = 0; i < 4; i++) tileMark(door, exit.x - 0.3 + i * 0.2, doorZ, 0.18, 0.5, wood, 0.016);
    for (const dz of [-0.14, 0.14]) tileMark(door, exit.x, doorZ + dz, 0.84, 0.06, iron, 0.018);
    tileMark(door, exit.x + 0.24, doorZ + 0.02, 0.07, 0.07, basic(0xb39a62), 0.02);
    stairs = new THREE.Group();
    doorway.add(stairs);
    tileMark(stairs, exit.x, doorZ, 0.84, 0.5, basic(0x0d0910), 0.014);
    stairMaterial = basic(WHITE);
    stairGlow = basic(0xc3efdc, { transparent: true, opacity: 0.2, depthWrite: false });
    tileMark(stairs, exit.x, doorZ, 0.96, 0.6, stairGlow, 0.015);
    for (let i = 0; i < 4; i++) {
      tileMark(stairs, exit.x, doorZ + 0.18 - i * 0.12, 0.6 - i * 0.1, 0.05, stairMaterial, 0.018);
    }
    stairs.visible = !!next.exit?.open;
    door.visible = !stairs.visible;
    resize();
  }

  function makeEntity(key, data, player, playerColor, origin = data) {
    const group = new THREE.Group();
    const companion = key === 'companion';
    const id = player || companion ? `piece-${data.piece || 'pawn'}` : data.species || 'skull';
    const palette = companion ? 'companion' : player ? playerColor || 'white' : data.palette;
    const texture = spriteTexture(id, palette);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1, depthWrite: false });
    materials.add(material);
    if (player) {
      // Mix after sampling the texture so even black pieces visibly take the
      // selection color, while keeping their pixel silhouette and shading.
      material.onBeforeCompile = (shader) => {
        shader.uniforms.playerPulse = playerPulse;
        shader.uniforms.moveColor = moveColor;
        shader.fragmentShader = 'uniform float playerPulse;\nuniform vec3 moveColor;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight = mix(outgoingLight, moveColor, playerPulse);\n#include <opaque_fragment>');
      };
    }
    const art = new THREE.Sprite(material);
    art.center.set(0.5, 0.42);
    const size = companion ? 0.76 : player ? 0.88 : 0.8;
    art.scale.set(size, size, 1);
    art.position.y = 0.15;
    art.userData.tile = { x: data.x, y: data.y };
    group.add(art);
    tileMark(group, 0, 0, player ? 0.46 : 0.42, 0.26, basic(0x09070c, { transparent: true, opacity: 0.8 }), 0.012);
    if (companion) tileRing(group, 0, 0, 0.23, 0.27, MINT, 0.6, 0.035);
    group.position.set(origin.x, 0, origin.y);
    actors.add(group);
    const entity = { group, art, spriteId: `${id}:${palette || ''}`, target: new THREE.Vector3(origin.x, 0, origin.y), pendingTarget: null, moveAt: 0, removeAt: 0, spawnAt: 0, player, companion, flash: 0, flashAt: 0, flashPosition: null, strikeAt: 0, strikeTo: null, strikeFrom: null, strikeOffset: new THREE.Vector3() };
    entities.set(key, entity);
    return entity;
  }

  // A promoted monster pawn wears a gold crown on its head's right corner. It is
  // a child of the monster's group, so it follows every move and lunge, and is
  // derived from the saved promoted flag, so it returns after a reload.
  function wearCrown(entity, worn, popAt = 0) {
    if (!worn) {
      if (entity.crown) entity.crown.visible = false;
      entity.crownAt = 0;
      return;
    }
    if (!entity.crown) {
      const material = new THREE.SpriteMaterial({ map: textures.get('crown'), transparent: true, alphaTest: 0.1, depthWrite: false, depthTest: false });
      materials.add(material);
      const crown = new THREE.Sprite(material);
      crown.center.set(0.5, 0);
      crown.scale.set(CROWN_WIDTH, CROWN_WIDTH * CROWN.length / CROWN[0].length, 1);
      crown.position.set(0.21, 0.15, 0).addScaledVector(SCREEN_UP, 0.27);
      crown.renderOrder = 2;
      crown.visible = false;
      entity.group.add(crown);
      entity.crown = crown;
    }
    if (popAt) {
      entity.crown.visible = false;
      entity.crownAt = popAt;
      // The monster itself flashes gold as the crown appears.
      entity.glowAt = popAt;
    } else if (!entity.crownAt) entity.crown.visible = true;
  }

  function updateItems(items) {
    const key = items.map((item) => `${item.x}:${item.y}:${item.type}:${item.power || item.piece || ''}`).join('|');
    if (key === itemKey) return;
    itemKey = key;
    clear(collectibles);
    for (const item of items) {
      const power = item.type === 'powerup';
      const companion = item.type === 'companion';
      const texture = companion ? spriteTexture(`piece-${item.piece}`, 'companion') : power ? spriteTexture(`power-${item.power}`, item.power === 'freeze' ? 'ice' : null) : textures.get('coin');
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1, depthWrite: false });
      materials.add(material);
      const coin = new THREE.Sprite(material);
      const size = companion ? 0.72 : power ? 0.55 : 0.3;
      coin.scale.set(size, size, 1);
      coin.position.set(item.x, companion ? 0.24 : power ? 0.22 : 0.13, item.y);
      collectibles.add(coin);
      if (power) tileMark(collectibles, item.x, item.y, 0.44, 0.44, basic(0x83c5bd, { transparent: true, opacity: 0.2, depthWrite: false }), 0.02);
      if (companion) {
        tileRing(collectibles, item.x, item.y, 0.29, 0.36, MINT, 0.65);
        tileRing(collectibles, item.x, item.y, 0.36, 0.43, MINT, 0.12, 0.025);
        const plus = basic(MINT);
        tileMark(collectibles, item.x + 0.3, item.y + 0.29, 0.19, 0.055, plus, 0.06);
        tileMark(collectibles, item.x + 0.3, item.y + 0.29, 0.055, 0.19, plus, 0.06);
      }
    }
  }

  function burst(x, y) {
    if (reducedMotion) return;
    for (let i = 0; i < 8; i++) {
      const material = new THREE.SpriteMaterial({ color: i % 3 ? WHITE : RED, transparent: true, depthWrite: false });
      materials.add(material);
      const mesh = new THREE.Sprite(material);
      mesh.scale.set(0.06, 0.06, 1);
      mesh.position.set(x, 0.3, y);
      actors.add(mesh);
      const angle = i * Math.PI / 4;
      particles.push({ mesh, life: 0.4, velocity: new THREE.Vector3(Math.cos(angle) * 1.2, 1 + i % 2, Math.sin(angle) * 0.8) });
    }
  }

  function cornerMarks(x, y, color, inset = 0.39, width = 0.14) {
    const ink = basic(color);
    for (const dx of [-inset, inset]) for (const dy of [-inset, inset]) {
      tileMark(hints, x + dx, y + dy, width, 0.025, ink, 0.046);
      tileMark(hints, x + dx, y + dy, 0.025, width, ink, 0.046);
    }
  }

  // A translucent piece standing on a square it could move to.
  function ghostPiece(piece, x, y, palette) {
    const material = new THREE.SpriteMaterial({ map: spriteTexture(`piece-${piece}`, palette || 'white'), transparent: true, opacity: 0.4, alphaTest: 0.05, depthWrite: false });
    materials.add(material);
    const ghost = new THREE.Sprite(material);
    ghost.center.set(0.5, 0.42);
    ghost.scale.set(0.7, 0.7, 1);
    ghost.position.set(x, 0.15, y);
    hints.add(ghost);
  }

  function updateHints(next) {
    clear(hints);
    moveMaterial = null;
    if (next.powers?.shield) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.39, 16), basic(0xa7dfff, { transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(next.player.x, 0.065, next.player.y);
      hints.add(ring);
    }
    if (next.powers?.freeze) for (const enemy of next.enemies) cornerMarks(enemy.x, enemy.y, 0xa7dfff, 0.35, 0.1);
    // Pinned monsters wear gold corners; while choosing a pin, every monster that can be pinned is ringed.
    for (const enemy of next.enemies) {
      if (enemy.pinned) cornerMarks(enemy.x, enemy.y, 0xf2ce80, 0.36, 0.17);
      else if (next.pinning && enemy.piece !== 'king' && enemy.role !== 'king') tileRing(hints, enemy.x, enemy.y, 0.36, 0.46, 0xf2ce80, 0.9, 0.05);
    }
    const danger = next.danger || next.enemies.flatMap((enemy) => enemy.phase === 'aim' ? enemy.intent || [] : []);
    const seen = new Set();
    for (const tile of danger) {
      const key = `${tile.x}:${tile.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tileMark(hints, tile.x, tile.y, 0.94, 0.94, basic(0xc72c51, { transparent: true, opacity: 0.42, depthWrite: false }), 0.03);
      cornerMarks(tile.x, tile.y, 0xff6685);
    }
    // Anchor each attack at the enemy's square center, including jump attacks.
    // The shaded tiles, rather than the connector, identify threatened squares.
    for (const enemy of next.enemies) {
      if (enemy.phase !== 'aim') continue;
      const target = enemy.intent?.at(-1);
      if (!target) continue;
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const beam = tileMark(hints, enemy.x + dx / 2, enemy.y + dy / 2, 0.035, length, basic(0xff557a, { transparent: true, opacity: 0.8, depthWrite: false }), 0.05);
      beam.rotation.z = Math.atan2(dx, dy);
    }
    if (next.showMoves) {
      moveMaterial = basic(MOVE_COLOR, { transparent: true, opacity: 0.5, depthWrite: false });
      for (const tile of next.legalMoves || []) {
        // Full squares stay readable around pickups and capture targets. Keep
        // them below the danger-path strokes and the sprites themselves.
        tileMark(hints, tile.x, tile.y, 0.94, 0.94, moveMaterial, 0.04);
        // A square only the Borrowed move reaches gets gold corners and a ghost of the borrowed piece.
        if (tile.borrowed) {
          cornerMarks(tile.x, tile.y, 0xf2ce80, 0.36, 0.17);
          ghostPiece(tile.borrowed, tile.x, tile.y, next.playerColor);
        }
        // Ice: an arrow on to the square the piece will skid to.
        if (tile.slide) {
          const dx = tile.slide.x - tile.x, dy = tile.slide.y - tile.y;
          const skid = basic(MOVE_COLOR, { transparent: true, opacity: 0.9, depthWrite: false });
          const shaft = tileMark(hints, tile.x + dx / 2, tile.y + dy / 2, 0.07, Math.hypot(dx, dy), skid, 0.055);
          shaft.rotation.z = Math.atan2(dx, dy);
          tileRing(hints, tile.slide.x, tile.slide.y, 0.2, 0.3, MOVE_COLOR, 0.95, 0.055);
        }
      }
    }
    if (next.cursor) cornerMarks(next.cursor.x, next.cursor.y, 0xcabfd7, 0.46, 0.2);
    // A pending fork (tactics.js): gold rings under every forked monster.
    for (const enemy of next.enemies) if (next.fork?.ids?.includes(enemy.id)) tileRing(hints, enemy.x, enemy.y, 0.36, 0.46, 0xf2ce80, 0.9, 0.05);
  }

  function render(next, afterTransition = false) {
    if (disposed) return;
    const now = performance.now();
    const key = `${next.date}:${next.seed}:${next.floor}:${next.map?.join('')}`;
    // UI-only paints reuse the event array. Consume an action's effects once,
    // including a restart whose floor, board, and turn match a previous start.
    const freshEvents = next.events !== lastEvents;
    const restarted = freshEvents && next.events?.some((event) => event.type === 'restart');
    const changedBoard = key !== boardKey || restarted;
    if (changedBoard && state && state.date === next.date && next.floor > state.floor && !reducedMotion && !afterTransition) {
      const player = entities.get('player');
      if (player) player.target.set(state.exit.x, 0, state.exit.y - 1);
      clear(hints);
      pendingTransition = { next, at: now + 175 };
      return;
    }
    if (changedBoard) {
      boardKey = key;
      buildBoard(next);
    }
    if (stairs) stairs.visible = !!next.exit?.open;
    if (door) door.visible = !next.exit?.open;
    const events = freshEvents ? next.events || [] : [];
    const playerMoved = events.some((event) => event.type === 'move');
    const enemyPhase = events.some((event) => event.type === 'enemy-phase');
    const companionPhase = events.some((event) => event.type === 'companion-phase');
    const recruited = events.find((event) => event.type === 'companion-recruit');
    const companionMove = events.find((event) => event.type === 'companion-move');
    const blackPhase = next.playerColor === 'black' && enemyPhase;
    // A black move can stop after the enemies act and await a new destination.
    // That phase has no turn increment; its marker still drives the animation.
    const animateTurn = !changedBoard && !reducedMotion && (next.turns > currentTurn || enemyPhase || playerMoved || companionPhase);
    const playerDelay = blackPhase && playerMoved ? 175 : 0;
    const companionDelay = companionPhase ? playerDelay + 175 : 0;
    const enemyDelay = !blackPhase && enemyPhase && playerMoved ? (companionPhase ? 350 : 175) : 0;
    const captureAt = now + playerDelay + 145;
    if (animateTurn && playerMoved) pendingItems = { items: next.items || [], at: captureAt };
    else if (!pendingItems) updateItems(next.items || []);
    const live = new Set();
    const units = [['player', next.player, true], ...(next.companion ? [['companion', next.companion, false]] : []), ...next.enemies.map((enemy) => [enemy.id, enemy, false])];
    for (const [id, data, player] of units) {
      live.add(id);
      const companion = id === 'companion';
      const sharing = companion && data.x === next.player.x && data.y === next.player.y;
      const point = sharing ? { x: data.x + 0.22, y: data.y + 0.18 } : data;
      // A recruit emerges as its pickup vanishes, then takes its own turn.
      const origin = companion && animateTurn && recruited ? { x: recruited.x + 0.22, y: recruited.y + 0.18 } : companion && animateTurn && companionMove ? companionMove.from : point;
      const existing = entities.get(id);
      const entity = existing || makeEntity(id, data, player, next.playerColor, origin);
      if (!existing && companion && animateTurn && recruited) {
        entity.group.visible = false;
        entity.spawnAt = captureAt;
      }
      entity.removeAt = 0;
      const delay = player ? playerDelay : companion ? companionDelay : enemyDelay;
      if (animateTurn && delay) {
        entity.pendingTarget = new THREE.Vector3(point.x, 0, point.y);
        entity.moveAt = now + delay;
      } else if (animateTurn || !entity.pendingTarget || changedBoard || reducedMotion) {
        entity.target.set(point.x, 0, point.y);
        entity.pendingTarget = null;
      }
      entity.art.userData.tile = { x: data.x, y: data.y };
      const spriteName = player || companion ? `piece-${data.piece || 'pawn'}` : data.species || 'skull';
      const palette = companion ? 'companion' : player ? next.playerColor || 'white' : data.palette;
      const spriteId = `${spriteName}:${palette || ''}`;
      if (spriteId !== entity.spriteId) {
        entity.art.material.map = spriteTexture(spriteName, palette);
        entity.art.material.needsUpdate = true;
        entity.spriteId = spriteId;
      }
      if (!player && !companion) {
        const worn = data.promoted === true;
        const crowned = worn && !changedBoard && events.some((event) => event.type === 'enemy-promotion' && event.x === data.x && event.y === data.y);
        wearCrown(entity, worn, crowned ? (animateTurn ? now + delay + 145 : now) : 0);
      }
      if (reducedMotion) entity.group.position.copy(entity.target);
    }
    for (const [id, entity] of entities) if (!live.has(id)) {
      if (animateTurn) {
        // A black player's captured enemy may have moved during the first
        // phase. Show that move before the piece arrives to take its square.
        const enemyMove = blackPhase && events.find((event) => event.type === 'enemy-move' && event.id === id);
        if (enemyMove) {
          entity.target.set(enemyMove.x, 0, enemyMove.y);
          entity.pendingTarget = null;
        }
        const companionCapture = events.some((event) => event.type === 'companion-capture' && event.id === id);
        entity.removeAt ||= companionCapture ? now + companionDelay + 145 : captureAt;
      }
      else if (!entity.removeAt) {
        burst(entity.group.position.x, entity.group.position.z);
        release(entity.group);
        entities.delete(id);
      }
    }
    const captured = events.find((event) => event.type === 'player-captured');
    const hitAt = now + enemyDelay + 145;
    if (captured) {
      const player = entities.get('player');
      if (player) {
        if (animateTurn) {
          player.flashAt = hitAt;
          player.flashPosition = { x: captured.x, y: captured.y };
        }
        else player.flash = 0.4;
      }
      if (!animateTurn) burst(next.player.x, next.player.y);
    }
    // Show who struck: the attacker lunges at the player's square and back,
    // tinted red, peaking as the player flashes. A shield block lunges too.
    const strike = events.find((event) => (event.type === 'player-captured' || event.type === 'shield') && event.by);
    // A restart rebuilds the room, where the same id may name a different monster.
    const attacker = strike && !changedBoard && !events.some((event) => event.type === 'restart') && entities.get(strike.by);
    // An en passant capture is the monster's diagonal step onto the skipped
    // square (an enemy-move event), so it needs no lunge of its own.
    const passedOnto = strike?.enPassant && events.some((event) => event.type === 'enemy-move' && event.id === strike.by);
    if (attacker && !passedOnto) {
      attacker.strikeAt = animateTurn ? hitAt - 130 : now;
      attacker.strikeTo = { x: strike.x, y: strike.y };
      attacker.strikeFrom = strike.from ?? { x: attacker.target.x, y: attacker.target.z };
    }
    // A fresh fork flashes its monsters gold as the player lands.
    const fork = events.find((event) => event.type === 'fork');
    if (fork && !changedBoard) for (const id of fork.ids) {
      const entity = entities.get(id);
      if (entity) entity.glowAt = animateTurn ? captureAt : now;
    }
    if (animateTurn) {
      clear(hints);
      pendingHints = { next, at: now + Math.max(playerDelay, companionDelay, enemyDelay) + 175 };
    } else if (pendingHints && !changedBoard) pendingHints.next = next;
    else {
      pendingHints = null;
      updateHints(next);
    }
    // A monster entering through a collapsing door arrives in a puff of dust.
    for (const event of events) if (event.type === 'reinforcement') burst(event.x, event.y);
    currentTurn = next.turns;
    lastEvents = next.events;
    state = next;
  }

  let topInset = 0;
  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const aspect = width / height;
    // The exit door sits about half a square beyond the back edge.
    const doorRoom = 0.3;
    const halfHeight = Math.max(rows * 0.49 + 0.35 + doorRoom, (columns / 2 + 0.18) / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    const x = (columns - 1) / 2;
    const z = (rows - 1) / 2 - doorRoom;
    camera.position.set(x, 18, z + 5.8);
    camera.lookAt(x, 0.14, z);
    camera.updateProjectionMatrix();
    // Slide the board down, into spare room below it, when the page's top
    // panel (the objective and its targets row) would otherwise cover the door.
    if (topInset > 0) {
      const screenY = (z) => (1 - new THREE.Vector3(x, 0, z).project(camera).y) / 2 * height;
      const doorTop = screenY(exitTile.y - 1.26);
      const boardBottom = screenY(rows - 0.5);
      const shift = Math.max(0, Math.min(topInset + 6 - doorTop, height - boardBottom - 8));
      if (shift > 0) {
        const units = shift / height * (camera.top - camera.bottom);
        camera.top += units; camera.bottom += units;
        camera.updateProjectionMatrix();
      }
    }
    const internalWidth = Math.min(768, Math.round(width));
    renderer.setSize(internalWidth, Math.max(1, Math.round(internalWidth / aspect)), false);
    onLayout?.();
  }

  function tick(timestamp) {
    if (disposed) return;
    animation = requestAnimationFrame(tick);
    if (timestamp - lastRendered < 1000 / 30) return;
    const dt = Math.min(0.07, (timestamp - (lastTime || timestamp)) / 1000);
    lastTime = lastRendered = timestamp;
    if (pendingTransition && timestamp >= pendingTransition.at) {
      const next = pendingTransition.next;
      pendingTransition = null;
      render(next, true);
    }
    const moveHintsVisible = state?.showMoves && !pendingHints && !pendingTransition;
    const pulse = reducedMotion ? 0.7 : 0.5 - 0.5 * Math.cos(timestamp * Math.PI * 2 / 1600);
    playerPulse.value = moveHintsVisible ? 0.3 + pulse * 0.45 : 0;
    if (moveMaterial && materials.has(moveMaterial)) moveMaterial.opacity = 0.3 + pulse * 0.35;
    for (const [id, entity] of entities) {
      if (entity.spawnAt && timestamp >= entity.spawnAt) {
        entity.spawnAt = 0;
        entity.group.visible = true;
      }
      if (entity.removeAt && timestamp >= entity.removeAt) {
        burst(entity.group.position.x, entity.group.position.z);
        release(entity.group);
        entities.delete(id);
        continue;
      }
      if (entity.pendingTarget && timestamp >= entity.moveAt) {
        entity.target.copy(entity.pendingTarget);
        entity.pendingTarget = null;
      }
      if (entity.flashAt && timestamp >= entity.flashAt) {
        entity.flashAt = 0;
        entity.flash = 0.3;
        burst(entity.flashPosition?.x ?? entity.target.x, entity.flashPosition?.y ?? entity.target.z);
        entity.flashPosition = null;
      }
      entity.group.position.sub(entity.strikeOffset);
      entity.group.position.lerp(entity.target, reducedMotion ? 1 : Math.min(1, dt * 19));
      entity.strikeOffset.set(0, 0, 0);
      if (entity.strikeAt && timestamp >= entity.strikeAt) {
        const t = (timestamp - entity.strikeAt) / STRIKE_MS;
        if (t >= 1) entity.strikeAt = 0;
        else {
          entity.flash = Math.max(entity.flash, 0.12);
          if (!reducedMotion) {
            const reach = Math.sin(Math.PI * t) * 0.6;
            entity.strikeOffset.set((entity.strikeTo.x - entity.strikeFrom.x) * reach, 0.18 * Math.sin(Math.PI * t), (entity.strikeTo.y - entity.strikeFrom.y) * reach);
            entity.group.position.add(entity.strikeOffset);
          }
        }
      }
      entity.flash = Math.max(0, entity.flash - dt);
      if (entity.crownAt && timestamp >= entity.crownAt) {
        const t = reducedMotion ? 1 : (timestamp - entity.crownAt) / CROWN_POP_MS;
        const pop = t >= 1 ? 1 : 1 + 0.7 * Math.sin(Math.PI * t);
        if (t >= 1) entity.crownAt = 0;
        entity.crown.visible = true;
        entity.crown.scale.set(CROWN_WIDTH * pop, CROWN_WIDTH * pop * CROWN.length / CROWN[0].length, 1);
      }
      const glow = entity.glowAt && timestamp >= entity.glowAt ? (timestamp - entity.glowAt) / FORK_GLOW_MS : -1;
      if (glow >= 1) entity.glowAt = 0;
      // Three gold pulses, or one steady flash under reduced motion.
      const gold = glow >= 0 && glow < 1 && (reducedMotion || Math.sin(glow * Math.PI * 6) > 0);
      entity.art.material.color.set(entity.flash ? 0xff6889 : gold ? 0xffd46b : 0xffffff);
      if (entity.player && entity.flash) playerPulse.value = 0;
    }
    if (pendingHints && timestamp >= pendingHints.at) {
      updateHints(pendingHints.next);
      pendingHints = null;
    }
    if (pendingItems && timestamp >= pendingItems.at) {
      updateItems(pendingItems.items);
      pendingItems = null;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.life -= dt;
      particle.velocity.y -= dt * 5;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.material.opacity = Math.max(0, particle.life / 0.4);
      if (particle.life <= 0) {
        release(particle.mesh);
        particles.splice(i, 1);
      }
    }
    renderer.render(scene, camera);
  }

  function pointerCancel(event) {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    pointerStart = null;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  }

  function pointerDown(event) {
    if (!event.isPrimary) {
      if (pointerStart) pointerCancel({ pointerId: pointerStart.id });
      return;
    }
    if (pointerStart || event.button !== 0) return;
    pointerStart = { id: event.pointerId };
    renderer.domElement.setPointerCapture(event.pointerId);
  }

  function pointerUp(event) {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    pointerCancel(event);
    if (!state || !onTile) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    const position = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(position, camera);
    const sprites = [...entities.values()].map((entity) => entity.art);
    const hits = ray.intersectObjects([...sprites, ...targets]);
    const tile = hits.find((hit) => hit.object.userData.tile)?.object.userData.tile;
    if (tile) onTile({ ...tile });
  }

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('lostpointercapture', pointerCancel);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  animation = requestAnimationFrame(tick);

  // Where the exit door sits on screen, in CSS pixels from the container's
  // top-left corner, so page controls can sit beside it instead of over a square.
  function exitAnchor() {
    const bounds = container.getBoundingClientRect();
    const point = (z) => {
      const projected = new THREE.Vector3(exitTile.x, 0, z).project(camera);
      return { x: (projected.x + 1) / 2 * bounds.width, y: (1 - projected.y) / 2 * bounds.height };
    };
    const far = point(exitTile.y - 1.26);
    const near = point(exitTile.y - 0.64);
    return { x: far.x, top: far.y, bottom: near.y };
  }

  // The board's on-screen box, in CSS pixels from the container's top-left
  // corner, so page panels can sit in the space around it.
  function boardRect() {
    const bounds = container.getBoundingClientRect();
    const corners = [[-0.5, -0.5], [columns - 0.5, -0.5], [-0.5, rows - 0.5], [columns - 0.5, rows - 0.5]].map(([x, z]) => {
      const projected = new THREE.Vector3(x, 0, z).project(camera);
      return { x: (projected.x + 1) / 2 * bounds.width, y: (1 - projected.y) / 2 * bounds.height };
    });
    const xs = corners.map((point) => point.x), ys = corners.map((point) => point.y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), width: bounds.width, height: bounds.height };
  }

  return {
    render,
    resize,
    exitAnchor,
    boardRect,
    // The lowest CSS pixel (from the container's top) the page's top panel covers.
    setTopInset(pixels) {
      const next = Math.max(0, Math.round(pixels));
      if (next === topInset) return;
      topInset = next;
      resize();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animation);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('lostpointercapture', pointerCancel);
      clear(board);
      clear(actors);
      clear(hints);
      clear(collectibles);
      cube.dispose();
      plane.dispose();
      for (const material of materials) material.dispose();
      for (const texture of [...textures.values(), ...stones]) texture.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
