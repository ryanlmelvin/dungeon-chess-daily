// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 5);
import { PIECES, PIECE_COUNTS } from './pieces.js';
import { hash, random } from './random.js';
const SPECIES = [
  ['bat', 'Bat', 'Bats'], ['rat', 'Rat', 'Rats'], ['slime', 'Slime', 'Slimes'],
  ['spider', 'Spider', 'Spiders'], ['ghost', 'Ghost', 'Ghosts'], ['mushroom', 'Mushroom', 'Mushrooms'],
  ['skull', 'Skull', 'Skulls'], ['snake', 'Snake', 'Snakes'], ['beetle', 'Beetle', 'Beetles'],
  ['gargoyle', 'Gargoyle', 'Gargoyles'], ['imp', 'Imp', 'Imps'], ['mimic', 'Mimic', 'Mimics'],
  ['eye', 'Floating eye', 'Floating eyes'], ['worm', 'Worm', 'Worms'], ['moth', 'Moth', 'Moths'],
  ['crab', 'Crab', 'Crabs'], ['wraith', 'Wraith', 'Wraiths'], ['golem', 'Golem', 'Golems'],
  ['clown', 'Clown', 'Clowns'], ['frog', 'Frog', 'Frogs'], ['scorpion', 'Scorpion', 'Scorpions'],
  ['pumpkin', 'Pumpkin', 'Pumpkins'], ['jellyfish', 'Jellyfish', 'Jellyfish'], ['goblin', 'Goblin', 'Goblins'],
  ['dragon', 'Dragon', 'Dragons'], ['cyclops', 'Cyclops', 'Cyclopes'],
];
const PALETTE_NAMES = ['ice', 'ember', 'moss', 'violet', 'gold', 'rose'];
const HEADLINES = {
  pawn: (name) => `${name} join the front line`,
  rook: (name) => `${name} demand straighter streets`,
  knight: (name) => `${name} saddle up after dark`,
  bishop: (name) => `${name} insist on a diagonal commute`,
  queen: (name) => `${name} rules the royal court`,
  king: (name) => `${name} takes town crown`,
};
const HINTS = {
  pawn: 'A humble recruit has made the evening roll call. Ambition is cheap in this town.',
  rook: 'Neighbors complain about the new battlements. The owner declined to lower the drawbridge for our reporter.',
  knight: 'Hoofprints were found outside the inn. Nobody remembers seeing a horse check in.',
  bishop: 'The bells rang at midnight. A new tenant is taking confessions, though nobody has seen a lease.',
  queen: 'The court has a new favorite. Even the palace guards seem reluctant to question her invitation.',
  king: 'A coronation with no witnesses, a throne with no receipt. The former mayor has gone into hiding.',
};

export function getRawDaily(date = new Date()) {
  const value = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(date).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new TypeError('Invalid daily date.');
  const seed = hash(value);
  const rng = random(seed);
  const playerPiece = PIECES[Math.floor(rng() * PIECES.length)];
  const targetsPool = PIECES.filter((piece) => piece !== 'king');
  const targets = [targetsPool.splice(Math.floor(rng() * targetsPool.length), 1)[0], targetsPool.splice(Math.floor(rng() * targetsPool.length), 1)[0], 'king'];
  const pool = [...SPECIES];
  const decoyRoles = targets.map((target) => PIECES.filter((piece) => piece !== target));
  const species = Array.from({ length: 9 }, (_, index) => {
    const [id, baseName, plural] = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const palette = PALETTE_NAMES[Math.floor(rng() * PALETTE_NAMES.length)];
    const allowed = index < 3 ? [targets[index]] : decoyRoles[Math.floor((index - 3) / 2)];
    return { id, name: `${palette[0].toUpperCase() + palette.slice(1)} ${baseName.toLowerCase()}`, baseName, plural, palette, piece: allowed.splice(Math.floor(rng() * allowed.length), 1)[0] };
  });
  return {
    date: value, edition: Math.floor((Date.parse(value) - EPOCH) / DAY) + 1, seed, playerPiece, playerColor: ((hash(`${value}:color`) >>> 8) & 1) ? 'black' : 'white', species, targets,
    theme: buildTheme(species),
  };
}

export function buildTheme(species) {
  const headline = (creature) => HEADLINES[creature.piece](PIECE_COUNTS[creature.piece] > 1 ? `${creature.palette[0].toUpperCase() + creature.palette.slice(1)} ${creature.plural.toLowerCase()}` : creature.name);
  return {
      name: 'The Midnight Board', headline: headline(species[0]),
      deck: HINTS[species[0].piece], boss: species[2].name, accent: '#b75652',
      species: species[0].id, palette: species[0].palette,
      stories: species.slice(1, 3).map((creature) => ({ title: headline(creature), body: HINTS[creature.piece], species: creature.id, palette: creature.palette })),
    };
}
