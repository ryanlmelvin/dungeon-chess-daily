// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 1);
/** Edition #1. The archive lists every edition from this date onward. */
export const FIRST_EDITION_DATE = new Date(EPOCH).toISOString().slice(0, 10);
import { PIECES, PLAYABLE_PIECES, PIECE_COUNTS } from './pieces.js';
import { hash, random } from './random.js';
import { modifierFor } from './modifiers.js';
// Ids (and this order) feed generation and never change. Names follow the art:
// the 'imp' sprite reads as a cat, 'goblin' as a horned imp, 'dragon' as a gremlin.
const SPECIES = [
  ['bat', 'Bat', 'Bats'], ['rat', 'Rat', 'Rats'], ['slime', 'Slime', 'Slimes'],
  ['spider', 'Spider', 'Spiders'], ['ghost', 'Ghost', 'Ghosts'], ['mushroom', 'Mushroom', 'Mushrooms'],
  ['skull', 'Skull', 'Skulls'], ['snake', 'Snake', 'Snakes'], ['beetle', 'Beetle', 'Beetles'],
  ['gargoyle', 'Gargoyle', 'Gargoyles'], ['imp', 'Cat', 'Cats'], ['mimic', 'Mimic', 'Mimics'],
  ['eye', 'Floating eye', 'Floating eyes'], ['worm', 'Worm', 'Worms'], ['moth', 'Moth', 'Moths'],
  ['crab', 'Crab', 'Crabs'], ['wraith', 'Wraith', 'Wraiths'], ['golem', 'Golem', 'Golems'],
  ['clown', 'Clown', 'Clowns'], ['frog', 'Frog', 'Frogs'], ['scorpion', 'Scorpion', 'Scorpions'],
  ['pumpkin', 'Pumpkin', 'Pumpkins'], ['jellyfish', 'Jellyfish', 'Jellyfish'], ['goblin', 'Imp', 'Imps'],
  ['dragon', 'Gremlin', 'Gremlins'], ['cyclops', 'Cyclops', 'Cyclopes'],
];
const PALETTE_NAMES = ['ice', 'ember', 'moss', 'violet', 'gold', 'rose'];
// The first wording stays canonical in saved themes. Display headlines can vary
// independently without invalidating existing runs or consuming gameplay RNG.
const HEADLINES = {
  pawn: [
    'join the front line',
    // Not "eye": the paper never names a species, even by pun (Floating eye).
    'advance one step, chase a promotion',
    'open with a double-time march',
    'take the next rank by storm',
    'pick diagonal fights on the march',
    'refuse to retreat from the front',
    'cross town for a royal promotion',
    'march ahead, strike at an angle',
    'trade small steps for a far-rank crown',
    'begin two steps ahead of the crowd',
    'keep their sights on the far rank',
    'go straight until a fight turns diagonal',
  ],
  rook: [
    'demand straighter streets',
    'patrol the ranks and files',
    'turn long avenues into attack lanes',
    'keep the castle on a straight course',
    'ban diagonal traffic from the tower',
    'storm the file from end to end',
    'sweep the rank without turning',
    'race down clear rows and columns',
    'hold the tower, watch the long lanes',
    'take the long way in a straight line',
    'charge down the file, no corners cut',
    'halt the tower patrol at the first roadblock',
  ],
  knight: [
    'saddle up after dark',
    'leap the wall in an L-shaped escape',
    'jump two streets, then turn one',
    'leave L-shaped tracks after curfew',
    'vault the barricades on horseback',
    'hop over neighbors without stopping',
    'take two steps out and one aside',
    'make an L-shaped leap past the guards',
    'jump the queue with an L-shaped move',
    'ride over roadblocks, land round a bend',
    'clear the crowd in a two-one leap',
    'change square colors with every leap',
  ],
  bishop: [
    'insist on a diagonal commute',
    'keep to one square color across town',
    'slice diagonally through the square',
    'preach from the end of a diagonal',
    'refuse to leave their square color',
    'turn diagonal lanes into a parish',
    'cross town only on the diagonals',
    'take the diagonal cathedral route',
    'keep the faith on one square color',
    'sweep the long diagonal after dark',
    'follow diagonal paths to confession',
    'forbid straight roads in the parish',
  ],
  queen: [
    'rules the royal court',
    'sweeps straight roads and diagonals',
    'claims every clear line from the throne',
    'holds court along eight long lanes',
    'takes the long route in any direction',
    'commands ranks, files and diagonals',
    'unites the tower and diagonal patrol',
    'strikes far along every royal avenue',
    'rules straight and slanted lines alike',
    'crosses town with an eight-way sweep',
    'commands the longest reach at court',
    'sweeps long lines in all eight directions',
  ],
  king: [
    'takes town crown',
    'moves the crown one square at a time',
    'limits the royal tour to one step',
    'holds court one square from danger',
    'takes a single step in any direction',
    'orders the throne moved next door',
    'keeps the crown within one square',
    'declares a one-step royal procession',
    'visits only the eight nearest squares',
    'leads the kingdom one small step at a time',
    'refuses a royal leap beyond next door',
    'wears the crown, walks one square',
  ],
};

// Saved themes name the species; the paper itself never does (headlineFor).
function headlineSubject(creature) {
  return PIECE_COUNTS[creature.piece] > 1
    ? `${creature.palette[0].toUpperCase() + creature.palette.slice(1)} ${creature.plural.toLowerCase()}`
    : creature.name;
}

// The paper describes how a floor's target moves but never says who it is: each
// story lines up the floor's suspects instead (main.js). Both lists use the same
// index, so a subject says nothing beyond the verb's number (one queen or king).
export const HEADLINE_SUBJECTS = Object.freeze({
  plural: Object.freeze(['Some residents', 'Certain tenants', 'Insiders say some locals', 'Mystery guests',
    'Unnamed regulars', 'Witnesses say some lodgers', 'Sources say certain newcomers', 'Masked locals']),
  singular: Object.freeze(['One resident', 'A certain tenant', 'Insiders say one local', 'A mystery guest',
    'An unnamed regular', 'Witnesses say a lodger', 'Sources say a certain newcomer', 'A masked local']),
});

/**
 * Display-only variation; the UTC edition and role pick the same clue everywhere.
 * The subject is anonymous and differs between the day's three floors.
 */
export function headlineFor(creature, date, floor = 0) {
  const choices = HEADLINES[creature.piece];
  const choice = hash(`newspaper:${date}:${creature.piece}`) % choices.length;
  const subjects = HEADLINE_SUBJECTS[PIECE_COUNTS[creature.piece] > 1 ? 'plural' : 'singular'];
  const subject = subjects[(hash(`newspaper-subject:${date}`) + floor) % subjects.length];
  return `${subject} ${choices[choice]}`;
}

const HINTS = {
  pawn: 'A humble recruit has made the evening roll call. Ambition is cheap in this town.',
  rook: 'Neighbors complain about the new battlements. The owner declined to lower the drawbridge for our reporter.',
  knight: 'Hoofprints were found outside the inn. Nobody remembers seeing a horse check in.',
  bishop: 'The bells rang at midnight. A new tenant is taking confessions, though nobody has seen a lease.',
  queen: 'The court has a new favorite. Even the palace guards seem reluctant to question her invitation.',
  king: 'A coronation with no witnesses, a throne with no receipt. The former mayor has gone into hiding.',
};

// The daily piece is always white: moving second made 1 in 5 black days
// uncertifiable. Black stays a practice choice. The color never fed any other
// draw, so every edition keeps its layout.
const DAILY_COLOR = 'white';

/** Everything the between-floor shop can stock, in display order. */
export const SHOP_STOCK = Object.freeze(['shield', 'pin', 'leap', 'takeback', 'magnet', 'life']);
/** Items each shop visit offers: the extra life, always, plus three drawn. */
export const SHOP_SIZE = 4;
/**
 * The day's offers for the shop after floor `shop` (0 or 1), the same for
 * everyone. Its own hash stream, so no other draw of the edition moves. The
 * second shop leads to the last floor, so it never stocks the magnet (that
 * floor has no coins) or the pin (it doesn't work there).
 */
export function shopStock(date, shop) {
  const pool = SHOP_STOCK.filter((id) => id !== 'life' && (shop === 0 || (id !== 'magnet' && id !== 'pin')));
  const rank = (id) => hash(`${date}:shop:${shop}:${id}`);
  const chosen = new Set(['life', ...[...pool].sort((a, b) => rank(a) - rank(b)).slice(0, SHOP_SIZE - 1)]);
  return SHOP_STOCK.filter((id) => chosen.has(id));
}

export function getRawDaily(date = new Date()) {
  const value = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(date).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new TypeError('Invalid daily date.');
  const seed = hash(value);
  const rng = random(seed);
  // One draw either way, so the rest of the edition is unchanged. Pawn keeps
  // index 0, so the pawn editions published before kings left (2026-11-05/06) stay put.
  const playerPiece = PLAYABLE_PIECES[Math.floor(rng() * PLAYABLE_PIECES.length)];
  const targetsPool = PIECES.filter((piece) => piece !== 'king');
  const targets = [targetsPool.splice(Math.floor(rng() * targetsPool.length), 1)[0], targetsPool.splice(Math.floor(rng() * targetsPool.length), 1)[0], 'king'];
  const pool = [...SPECIES];
  const decoyRoles = targets.map((target) => PIECES.filter((piece) => piece !== target));
  const species = [];
  for (let index = 0; index < 9; index++) {
    const [id, baseName, plural] = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    // Floor-mates (a floor's target and its two decoy species, which also
    // supply Collapse reinforcements) never share a palette: a clash steps to
    // the next free one. Still one draw, so every other draw stays put.
    const floor = index < 3 ? index : Math.floor((index - 3) / 2);
    const mates = index < 3 ? [] : [species[floor], ...species.slice(3 + floor * 2, index)];
    let pick = Math.floor(rng() * PALETTE_NAMES.length);
    while (mates.some((mate) => mate.palette === PALETTE_NAMES[pick])) pick = (pick + 1) % PALETTE_NAMES.length;
    const palette = PALETTE_NAMES[pick];
    const allowed = index < 3 ? [targets[index]] : decoyRoles[Math.floor((index - 3) / 2)];
    species.push({ id, name: `${palette[0].toUpperCase() + palette.slice(1)} ${baseName.toLowerCase()}`, baseName, plural, palette, piece: allowed.splice(Math.floor(rng() * allowed.length), 1)[0] });
  }
  return {
    date: value, edition: Math.floor((Date.parse(value) - EPOCH) / DAY) + 1, seed, playerPiece, playerColor: DAILY_COLOR, species, targets,
    theme: buildTheme(species),
    // The day's room modifier (src/modifiers.js) draws from its own hash stream.
    modifier: modifierFor(value),
    // The two between-floor shops' offers.
    shops: [shopStock(value, 0), shopStock(value, 1)],
  };
}

export function buildTheme(species) {
  const headline = (creature) => `${headlineSubject(creature)} ${HEADLINES[creature.piece][0]}`;
  return {
      name: 'The Midnight Board', headline: headline(species[0]),
      deck: HINTS[species[0].piece], boss: species[2].name, accent: '#b75652',
      species: species[0].id, palette: species[0].palette,
      stories: species.slice(1, 3).map((creature) => ({ title: headline(creature), body: HINTS[creature.piece], species: creature.id, palette: creature.palette })),
    };
}
