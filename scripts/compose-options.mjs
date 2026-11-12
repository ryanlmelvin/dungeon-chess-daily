// Dungeon Chess Daily — Copyright (C) 2026 Ryan L. Melvin
// SPDX-License-Identifier: GPL-3.0-only
// The composeDay options a measuring script composes with: the release
// configuration (src/composer.js RELEASE), which is what every stored edition
// is, unless the command line turns an option off to compare:
//   --no-treasure   no chests (src/treasure.js)
//   --no-partner    no partner floor (a Tandem)
//   --no-tight      no tight forms (src/tight.js) and no day arc
import { RELEASE } from '../src/composer.js';

/** The flags that turn an option off, to pass on to a script's own child processes. */
export const OPTION_FLAGS = Object.freeze(Object.keys(RELEASE).map((name) => `--no-${name}`));

/** composeDay's options as the command line asks for them. */
export function composeOptions(argv = process.argv) {
  return Object.fromEntries(Object.keys(RELEASE).map((name) => [name, RELEASE[name] && !argv.includes(`--no-${name}`)]));
}

/** How a report names the configuration it measured. */
export function optionsLabel(options) {
  const off = Object.keys(RELEASE).filter((name) => RELEASE[name] && !options[name]);
  return off.length ? `the release configuration without ${off.join(', ')}` : 'the release configuration';
}
