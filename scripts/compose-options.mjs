// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The composeDay options a measuring script composes with: the release
// configuration (src/composer.js RELEASE), which is what every stored edition
// is, unless the command line turns an option off to compare:
//   --no-treasure   no chests (src/treasure.js)
//   --no-partner    no partner floor (a Tandem)
//   --no-tight      no tight forms (src/tight.js) and no day arc
// The ideas in preview (src/composer.js PREVIEW_IDEAS) are off unless asked for:
//   --wait          the Standstill, on the one day in three it draws
//   --lure          the Lure, likewise
//   --ideas         both
//   --every         each idea asked for takes every day it fits, not one in three
//   --no-ceiling    compose them without the bot's ceiling (src/tight.js TIGHT.botPar), to compare
import { RELEASE, PREVIEW_IDEAS } from '../src/composer.js';

/** The flags that change an option, to pass on to a script's own child processes. */
export const OPTION_FLAGS = Object.freeze([...Object.keys(RELEASE).map((name) => `--no-${name}`), ...PREVIEW_IDEAS.map((name) => `--${name}`), '--ideas', '--every', '--no-ceiling']);

/** The ideas in preview the command line asks for: { wait, lure }, each false, true or 'every'. */
export function ideaOptions(argv = process.argv) {
  const share = argv.includes('--every') ? 'every' : true;
  return Object.fromEntries(PREVIEW_IDEAS.map((name) => [name, argv.includes(`--${name}`) || argv.includes('--ideas') ? share : false]));
}

/** composeDay's options as the command line asks for them. */
export function composeOptions(argv = process.argv) {
  return {
    ...Object.fromEntries(Object.keys(RELEASE).map((name) => [name, RELEASE[name] && !argv.includes(`--no-${name}`)])),
    ...ideaOptions(argv),
    ...(argv.includes('--no-ceiling') && { ceiling: false }),
  };
}

/** How a report names the configuration it measured. */
export function optionsLabel(options) {
  const off = Object.keys(RELEASE).filter((name) => RELEASE[name] && !options[name]);
  const ideas = PREVIEW_IDEAS.filter((name) => options[name]).map((name) => `${name}${options[name] === 'every' ? ' (every day it fits)' : ''}`);
  return `the release configuration${off.length ? ` without ${off.join(', ')}` : ''}${ideas.length ? ` with the ideas in preview: ${ideas.join(', ')}${options.ceiling === false ? ', the bot\'s ceiling off' : ''}` : ''}`;
}
