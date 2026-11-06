// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
import * as THREE from 'three';
import { SPRITES, PALETTE, spritePalette, piecePalette, COMPANION_PALETTE } from './sprites.js';

const VOID = 0x100d12;
const WHITE = 0xeee8e1;
const RED = 0xd13959;
const MINT = 0x8af4d5;
const MOVE_COLOR = 0x56dcff;

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
  canvas.width = canvas.height = 24;
  const context = canvas.getContext('2d');
  context.fillStyle = red ? '#653942' : '#25212a';
  context.fillRect(0, 0, 24, 24);
  let seed = variation * 65537 + (red ? 911 : 173);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Sparse chipped stone and hairline cracks keep the checkerboard legible.
  for (let i = 0; i < 28; i++) {
    context.fillStyle = red ? (i % 3 ? '#59323d' : '#74434b') : (i % 3 ? '#201c24' : '#302a35');
    context.fillRect(Math.floor(random() * 24), Math.floor(random() * 24), 1 + Math.floor(random() * 3), 1);
  }
  context.fillStyle = red ? '#7c4a50' : '#39303a';
  context.fillRect(1, 1, 22, 1);
  context.fillRect(1, 2, 1, 20);
  context.fillStyle = '#151018';
  context.fillRect(0, 23, 24, 1);
  if (variation % 3 === 0) {
    context.fillRect(15, 15, 5, 1);
    context.fillRect(15, 13, 1, 3);
    context.fillRect(13, 12, 3, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createDungeonRenderer(container, { onTile } = {}) {
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
        propSprite(board, `prop-${type}`, x, y, type === 'pillar' ? 0.95 : 0.9, type === 'pillar' ? 0.35 : 0.27);
      } else if ((x * 13 + y * 7 + next.seed) % 7 === 0 && !(x === next.exit.x && y === next.exit.y)) {
        // Loose chips and bone fragments stay at the edge of walkable tiles.
        const chip = basic((x + y) % 2 ? 0x544958 : 0x8a6268);
        tileMark(board, x - 0.32, y + 0.3, 0.11, 0.045, chip, 0.015);
        tileMark(board, x - 0.21, y + 0.35, 0.055, 0.03, chip, 0.015);
        if (x % 2) tileMark(board, x + 0.32, y - 0.29, 0.065, 0.035, chip, 0.015);
      }
    }
    // The stairwell itself is concealed until the floor's capture is complete.
    const exit = next.exit || { x: 4, y: 0 };
    stairs = new THREE.Group();
    stairs.visible = !!next.exit?.open;
    board.add(stairs);
    tileMark(stairs, exit.x, exit.y, 0.76, 0.84, basic(0x0d0910), 0.014);
    stairMaterial = basic(WHITE);
    stairGlow = basic(0xc3efdc, { transparent: true, opacity: 0.2, depthWrite: false });
    tileMark(stairs, exit.x, exit.y, 0.9, 0.9, stairGlow, 0.015);
    for (let i = 0; i < 4; i++) {
      tileMark(stairs, exit.x, exit.y - 0.25 + i * 0.16, 0.25 + i * 0.1, 0.055, stairMaterial, 0.018);
    }
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
    const entity = { group, art, spriteId: `${id}:${palette || ''}`, target: new THREE.Vector3(origin.x, 0, origin.y), pendingTarget: null, moveAt: 0, removeAt: 0, spawnAt: 0, player, companion, flash: 0, flashAt: 0, flashPosition: null };
    entities.set(key, entity);
    return entity;
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
    const danger = next.danger || next.enemies.flatMap((enemy) => enemy.phase === 'aim' ? enemy.intent || [] : []);
    const seen = new Set();
    for (const tile of danger) {
      const key = `${tile.x}:${tile.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tileMark(hints, tile.x, tile.y, 0.94, 0.94, basic(0xc72c51, { transparent: true, opacity: 0.42, depthWrite: false }), 0.03);
      cornerMarks(tile.x, tile.y, 0xff6685);
    }
    // Connect every marked firing-path tile back along its ray, without exposing
    // the monster's hidden chess role. A path remains visible under its sprites.
    for (const enemy of next.enemies) {
      if (enemy.phase !== 'aim') continue;
      for (const target of enemy.intent || []) {
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        if ((!dx && !dy) || (dx && dy && Math.abs(dx) !== Math.abs(dy))) continue;
        const stepX = Math.sign(dx);
        const stepY = Math.sign(dy);
        const beam = tileMark(hints, target.x, target.y, 0.035, stepX && stepY ? Math.SQRT2 : 1, basic(0xff557a, { transparent: true, opacity: 0.8, depthWrite: false }), 0.05);
        beam.rotation.z = Math.atan2(stepX, stepY);
      }
    }
    if (next.showMoves) {
      moveMaterial = basic(MOVE_COLOR, { transparent: true, opacity: 0.5, depthWrite: false });
      for (const tile of next.legalMoves || []) {
        // Full squares stay readable around pickups and capture targets. Keep
        // them below the danger-path strokes and the sprites themselves.
        tileMark(hints, tile.x, tile.y, 0.94, 0.94, moveMaterial, 0.04);
      }
    }
    if (next.cursor) cornerMarks(next.cursor.x, next.cursor.y, 0xcabfd7, 0.46, 0.2);
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
      if (player) player.target.set(state.exit.x, 0, state.exit.y);
      clear(hints);
      pendingTransition = { next, at: now + 175 };
      return;
    }
    if (changedBoard) {
      boardKey = key;
      buildBoard(next);
    }
    if (stairs) stairs.visible = !!next.exit?.open;
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
    const damage = events.find((event) => event.type === 'damage');
    if (damage) {
      const player = entities.get('player');
      if (player) {
        if (animateTurn) {
          player.flashAt = now + enemyDelay + 145;
          player.flashPosition = { x: damage.x, y: damage.y };
        }
        else player.flash = 0.4;
      }
      if (!animateTurn) burst(next.player.x, next.player.y);
    }
    if (animateTurn) {
      clear(hints);
      pendingHints = { next, at: now + Math.max(playerDelay, companionDelay, enemyDelay) + 175 };
    } else if (pendingHints && !changedBoard) pendingHints.next = next;
    else {
      pendingHints = null;
      updateHints(next);
    }
    currentTurn = next.turns;
    lastEvents = next.events;
    state = next;
  }

  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const aspect = width / height;
    const halfHeight = Math.max(rows * 0.49 + 0.35, (columns / 2 + 0.18) / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    const x = (columns - 1) / 2;
    const z = (rows - 1) / 2;
    camera.position.set(x, 18, z + 5.8);
    camera.lookAt(x, 0.14, z);
    camera.updateProjectionMatrix();
    const internalWidth = Math.min(768, Math.round(width));
    renderer.setSize(internalWidth, Math.max(1, Math.round(internalWidth / aspect)), false);
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
      entity.group.position.lerp(entity.target, reducedMotion ? 1 : Math.min(1, dt * 19));
      entity.flash = Math.max(0, entity.flash - dt);
      entity.art.material.color.set(entity.flash ? 0xff6889 : 0xffffff);
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

  return {
    render,
    resize,
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
