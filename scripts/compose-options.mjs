// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The composeDay options a measuring script composes with: the release
// configuration (src/composer.js RELEASE), which is what every stored edition
// is, unless the command line turns an option off to compare:
//   --no-treasure   no chests (src/treasure.js)
//   --no-partner    no partner floor (a Tandem)
//   --no-tight      no tight forms (src/tight.js) and no day arc
//   --no-wait       no Standstill (a drawn idea, src/composer.js DRAWN_IDEAS)
//   --no-lure       no Lure
//   --no-ideas      neither
// And for the drawn ideas that are on:
//   --every         each takes every day it fits, not one in three
//   --no-ceiling    compose them without the bot's ceiling (src/tight.js TIGHT.botPar), to compare
import { RELEASE, DRAWN_IDEAS } from '../src/composer.js';

/** The flags that change an option, to pass on to a script's own child processes. */
export const OPTION_FLAGS = Object.freeze([...Object.keys(RELEASE).map((name) => `--no-${name}`), '--no-ideas', '--every', '--no-ceiling']);

/** composeDay's options as the command line asks for them: a drawn idea that is on is true, or 'every' with --every. */
export function composeOptions(argv = process.argv) {
  const idea = (name) => DRAWN_IDEAS.includes(name);
  const on = (name) => RELEASE[name] && !argv.includes(`--no-${name}`) && !(idea(name) && argv.includes('--no-ideas'));
  return {
    ...Object.fromEntries(Object.keys(RELEASE).map((name) => [name, on(name) && idea(name) && argv.includes('--every') ? 'every' : on(name)])),
    ...(argv.includes('--no-ceiling') && { ceiling: false }),
  };
}

/** How a report names the configuration it measured. */
export function optionsLabel(options) {
  const off = Object.keys(RELEASE).filter((name) => RELEASE[name] && !options[name]);
  const every = DRAWN_IDEAS.filter((name) => options[name] === 'every');
  return `the release configuration${off.length ? ` without ${off.join(', ')}` : ''}${every.length ? `, with ${every.join(' and ')} on every day it fits` : ''}${options.ceiling === false ? ', the bot\'s ceiling off' : ''}`;
}
