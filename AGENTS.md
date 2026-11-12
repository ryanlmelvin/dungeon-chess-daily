# AGENTS.md

Guidance for coding agents working in this repository.

Dungeon Chess Daily is a static, offline-capable PWA: one chess piece clears three
floors of monsters, and every UTC date yields the same certified-winnable edition
for everyone. Vanilla JS (ES modules) + Three.js, built with Vite, deployed to
GitHub Pages. No server, no framework, no TypeScript, no linter.

## Commands

Node 22.12+.

```sh
npm ci
npm run dev                         # Vite on 127.0.0.1:4319 (no service worker in dev)
npm test                            # node --test tests/*.test.js
node --test tests/game.test.js      # one file (substitute any tests/*.test.js)
node --test --test-name-pattern="window closes" tests/en-passant.test.js   # one test
npm run build                       # compose new editions → vite build → service worker
node scripts/serve.mjs              # serve dist/ at http://127.0.0.1:4320/dungeon-chess-daily/ (Pages prefix)
```

Content checks:

```sh
npm run verify:editions                     # replay every stored edition in src/editions.js (seconds)
npm run audit:editions                      # compose every stored date again and compare (minutes)
npm run audit:dungeons -- 2026-11-01 365    # replay a year of dailies, validating the save after every action
npm run build:editions [-- --full]          # compose missing or stale dates; --full composes every date (~5 min); --stats path writes a row a day
node scripts/measure-composer.mjs           # composer report: motifs, times, lines, the bot's runs
node scripts/measure-human-par.mjs          # the human-like bot over the stored editions, against par
node scripts/measure-par-slack.mjs --jobs 8 # room around each floor's idea: first moves that keep par, par wins off the idea
node scripts/measure-tight.mjs --jobs 8     # tight forms off and on, floor by floor
node scripts/measure-treasure.mjs --jobs 8  # chest coverage, what its two checks cost, the bot's accidental marks
node scripts/measure-ideas.mjs --jobs 8     # the ideas in preview: the days each fits, draws and composes on, what it replaces
```

One release configuration: `composeDay(date)` with no options (`RELEASE` in
`src/composer.js`: chests, partner floors, tight forms) is what the build stores, the
audit composes again, the preview shows and the tests compare. The measuring scripts
compose it too; `--no-treasure`, `--no-partner` and `--no-tight` each turn one option off
to compare (`scripts/compose-options.mjs`).

Ideas in preview: two more ideas a floor can be built around, the Standstill (`wait`,
one exactly timed Wait) and the Lure (`lure`, a knight draws a guard off the target it
covers), are `composeDay` options that are off unless asked for and not in `RELEASE`
(`PREVIEW_IDEAS` in `src/composer.js`), so no stored edition, test or audit sees them.
The measuring scripts ask with `--wait`, `--lure` or `--ideas` (`--every`: every day an
idea fits, not one in three; `--no-ceiling`: without the bot's ceiling), and
`scripts/measure-tight.mjs --option ideas` compares the days with and without them.
`docs/generation.md` ("Ideas in preview") has what they are, how they are judged, what
was measured and what shipping one needs.

Dev-only composer preview: open the dev server with `?composed=YYYY-MM-DD` to play
that date composed afresh by the composer as it is now, before rebuilding editions
(`src/composed-preview.js`, stripped from production builds, saved apart from real runs).
With an unchanged composer it is the stored edition; `&treasure=0`, `&partner=0` and
`&tight=0` each turn one option off. `&wait=1`, `&lure=1` or `&ideas=1` add the ideas in
preview on the days they draw (`=all`: on every day they fit; `&ceiling=0`: without the
bot's ceiling); such a preview saves apart again and files its finds in the journal.

Two room modifiers are in preview and drawn for no date: `&modifier=cracks` (a
crumbling floor) or `&modifier=gates` on the composer preview plays that date under
one, saved apart, and `node scripts/measure-terrain.mjs --modifier cracks --jobs 8`
measures one against the same dates as plain days (`measure-composer`,
`measure-par-slack` and `measure-tight` take `--modifier` too).

Publishing is a push to `main`: `.github/workflows/deploy.yml` runs `npm test` and
`npm run build`, then deploys `dist/` to Pages. `dist/` is never committed. After a
deploy, check the live `release.json` and play the published edition.

## Architecture

**Engine (pure, deterministic, shared by browser, tests and scripts).**
`src/rules.js` is the whole gameplay simulator: `createGame`, `act` (move / wait /
re-select, optionally with a recruit order `{x,y}` or `'hold'`), legal moves,
captures, promotion, en passant, castling, recruits, pickups, scoring, share text.
`src/monster-ai.js` (every monster moves every turn, seeded tie-breaks),
`src/modifiers.js` (ice and collapse, "Breach"; dark is retired — part of `state.modifier`),
`src/terrain.js` (the one answer to "is this square solid right now": walls, and the
pits and shut gates of the two modifiers in preview, `src/cracks.js` and `src/gates.js`;
`walkable` asks it, so nothing else reads a wall for play), `src/cave-in.js`
(lingering on a cleared floor) and `src/tactics.js` (fork/combo bonuses only) plug
into it. `src/game.js` is the public, certified API the UI imports: `getDaily()`
normalizes to UTC and returns the canonical edition; callers can't swap its seed,
piece, targets or layout.

**Editions and fairness.** `src/edition.js` derives the raw daily (seed, piece,
species, headlines, modifier) from the date. Every edition is composed:
`src/composer.js` builds each floor around a short planted line (bait / squeeze /
net motifs; tempo / crown lines for pawns), proved by an exact shortest-win search
and guarded by the human-like bot, and the planted lines are the day's certificate.
Three things ride on that, each a `composeDay` option that is on by default: the
tight forms (`src/tight.js` judges them: subtle baits and squeezes on floor 2, floor 1
showing the same idea plainly); a partner floor on floor 1 or 2 of about one in three of the days whose
matchup has one (`partnerDay`; a Tandem: two targets that guard each other, won with the floor's recruit on
orders); and a chest off each floor's line (`src/treasure.js`: a proved win within par
takes it, it costs the spare move, and the bot seldom takes it by accident).
`src/generation.js` (`proveComposed`) replays the lines through `src/fairness.js`
(`verifyWinningRoute`, on the day's twin without hint powerups, the recruit on orders
on a partner floor alone) and then as played.
Every daily plays the Fair monsters (`DAILY_TIER`, `src/difficulty.js`, which holds
the five tiers practice can choose). Par is each floor's line plus one
(`src/par.js`); a chest taken earns the floor's 💎, whatever the score (`treasureMark`
in `src/rules.js`); `src/bot.js` replays the lines after a win, a Tandem's recruit
orders included. `src/human-bot.js` + `src/recruit-policy.js` are the "plays like a
person" bot, now only a probe and the composer's guard. Authoritative description:
`docs/generation.md`; history, decisions and measurements: `docs/puzzle-first-idea.md`.

**Shipped editions.** `src/editions.js` (generated, committed) stores each day's rooms
(`src/room-code.js`, chests included), lines (`src/route-code.js`, with a partner floor's
recruit orders), the motif each floor was built around (`src/motif-code.js`, loaded as
`daily.generation.motifs`) and, on a day that has one, its partner floor (`partner`,
loaded as `daily.generation.partner`) from launch (2026-11-01) through two years past
the build date; the app decodes and proves them as they load and never carries the
composer. Every build composes new dates incrementally. A date past the window borrows a
stored day of its own piece and modifier (`borrowedDaily`).

**Rooms in tests.** `createGame` needs a day's three composed rooms; a floor begins
exactly as its room lays it out (`setFloor` in `src/rules.js`). Engine tests lay their own
rooms from a map, monsters and items with `tests/fixtures/rooms.js` (`room`, `withRooms`),
or start from open, empty ones and set up the board by hand. The old seeded random room is
retired; saves made before then still carry its inert layout fields.

**UI.** `src/main.js` owns input, the newspaper, saves, archive, sharing and dialogs;
`src/renderer.js` is the pixelated Three.js board; `src/inspect.js` works out what a
press and hold on an unmasked monster shows (the renderer owns the gesture and draws
the marks; a masked monster yields nothing); `src/sprites.js`, `*-art.js`
files draw original pixel art and explainers; `src/guide.js` / `src/first-visit.js`
are onboarding; `src/pwa.js` + `scripts/build-sw.mjs` handle the fingerprinted,
integrity-verified offline cache; `src/archive.js`, `src/backups.js`,
`src/storage.js` handle past days and saves.

**Retry floor.** `src/retry.js` (pure, with `src/retry.css`) is the sandbox the shop and
the results paper open on a cleared floor: a second, unsaved game begun from the floor's
snapshot, with a free Undo and Reset. While one is open, `state` in `src/main.js` is the
retry's game and the real run waits in `retry.real`; `save`, `refreshFromOtherWindow` and
`takeStairs` stand aside and nothing is written. New code that writes anything (storage,
the ledger, the journal, a seen flag) must stand aside during a retry too.

**Streak and stats.** `src/stats.js` keeps the ledger: the editions entered and won on
their own UTC day with the official piece (never archive back-play or practice), each
win with its floors' scores against par. It is stored under `<prefix>ledger`,
independent of `RULES_VERSION`, back-filled once from the device's saves, carried by
backups and merged as a union (`planBackupMerge`). It also holds the streak arithmetic,
the Stats page's numbers and the share card's streak (`shareStreak`, title line only,
from a streak of 2). `src/stats-page.js` + `src/stats.css` draw the menu's Stats page
and the paper's streak; `main.js` notes today's run in `save()`.

**Journal.** `src/journal.js` is the book: `PAGES` (one entry per lesson page: a motif's
or feat's id, name, text, `draw`/`still`, the pieces that can find it), what a floor found
(`floorFinds`: its motif when cleared at par or better, plus the special moves in
`state.feats`; official piece only, never practice), and the record of finds per page and
piece, stored under `<prefix>journal`, independent of `RULES_VERSION`, back-filled once
from the device's saves and merged in backups as a union. A motif or feat with no page is
filed by name and shown nowhere; `walk` is never filed. `src/journal-art.js` draws the
ideas' diagrams; `src/journal-ui.js` + `src/journal.css` build the menu button, the Journal
dialog, the one-line cue in the shop and on the results paper, and the page that flies
into it when a find is new (it never takes a tap or opens a dialog). `main.js` only calls
it: `clearedFloor` as the shop opens, `wonRun` on the results paper, `restored` after a
backup merge. Adding an idea's page is adding one `PAGES` entry and its art function. The
pages of the ideas in preview wait in `PREVIEW_PAGES`: the book lists one only once it has
been found (`bookPages`), which today only a dev preview can do.

## Changing rules, AI, the composer or the bot

Anything that alters gameplay, monster AI, modifiers, the composer or the human bot
(the composer's guard reads it) can change editions:

1. Bump `RULES_VERSION` in `src/rules.js` for a change to play (`GENERATOR_VERSION`,
   the save schema and the save keys follow it). `COMPOSER_VERSION`
   (`src/generation.js`) salts the composer's seeds; bumping it re-rolls every room,
   so it is normally left alone.
2. `npm run build:editions -- --full`, then `npm run verify:editions` and `npm test`
   (tests pinned to stored days compare them with `composeDay(date)`).
   Let the user play a local preview of the days they'll meet before shipping.

New rules apply to the whole archive: rebuild every past edition, no legacy cutoff.
`docs/generation.md` is the authoritative description of the guarantee, the composer's
checks, par and versioning; keep it in step with behavior changes.

## Design constraints

- Every monster moves every turn; don't propose chess-style one-reply turns.
- Floors should be short clever lines, not chases, sieges or attrition. There are no
  lives: a capture of the player adds a move to the score. A piece with no legal move
  starts its floor over (`restartFloor`), never the day.
- The king is never the daily piece; certified routes never use powerups, shields or
  freezes, and take no chest. Off a partner floor they never use the floor 1–2 recruits
  and carry no recruit orders (the king floor's recruit moves itself along them). On a
  partner floor (a Tandem, floor 1 or 2) the line uses that floor's recruit, on orders,
  and the stored edition names the floor.
- The player always orders the recruit: there is no Auto setting. Once a floor's
  challenge is complete the recruit moves itself for the rest of that room.
- Every daily plays Fair; par is the planted line + 1; on the king floor checkmate
  wins and the king can't take a piece the recruit king guards.
- A chest lies off the planted line and costs the spare move: under par, or even with
  treasure, never both. Practice rooms hold none.
- Keep UI text and the share card minimal. Dialogs must not scroll on small phones
  (check around 440×780, 402×680 and iPhone SE widths).
- Original assets only; music is CC0 and seeded by date separately from generation.
- New source files get the copyright line and `SPDX-License-Identifier: GPL-3.0-only` header.

## Local saves

Game saves and app state on the development machine are disposable. The browser pane, the localhost dev servers and their localStorage can be wiped, overwritten or seeded freely while testing. The user plays for real only in the installed PWA on their phone.
