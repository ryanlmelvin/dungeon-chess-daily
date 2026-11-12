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
npm run build:editions [-- --full]          # compose missing or stale dates; --full composes every date (~5 min)
node scripts/measure-composer.mjs           # composer report: motifs, times, lines, the bot's runs
node scripts/measure-human-par.mjs          # the human-like bot over the stored editions, against par
node scripts/measure-par-slack.mjs --jobs 8 # room around each floor's idea: first moves that keep par, par wins off the idea
```

Dev-only composer preview: open the dev server with `?composed=YYYY-MM-DD` to play
that date composed afresh by the composer as it is now, before rebuilding editions
(`src/composed-preview.js`, stripped from production builds, saved apart from real runs).
The preview also composes partner floors (`composeDay`'s `partner` option, in no stored
edition: a tandem floor, won with the floor's recruit on the player's orders, on days whose
matchup has one) unless the URL adds `&partner=0`; `measure-par-slack.mjs --partner`
measures them.

Publishing is a push to `main`: `.github/workflows/deploy.yml` runs `npm test` and
`npm run build`, then deploys `dist/` to Pages. `dist/` is never committed. After a
deploy, check the live `release.json` and play the published edition.

## Architecture

**Engine (pure, deterministic, shared by browser, tests and scripts).**
`src/rules.js` is the whole gameplay simulator: `createGame`, `act` (move / wait /
re-select, optionally with a recruit order `{x,y}` or `'hold'`), legal moves,
captures, promotion, en passant, castling, recruits, pickups, scoring, share text.
`src/monster-ai.js` (every monster moves every turn, seeded tie-breaks),
`src/modifiers.js` (ice and collapse, "Breach"; dark is retired — part of `state.modifier`), `src/cave-in.js`
(lingering on a cleared floor) and `src/tactics.js` (fork/combo bonuses only) plug
into it. `src/game.js` is the public, certified API the UI imports: `getDaily()`
normalizes to UTC and returns the canonical edition; callers can't swap its seed,
piece, targets or layout.

**Editions and fairness.** `src/edition.js` derives the raw daily (seed, piece,
species, headlines, modifier) from the date. Every edition is composed:
`src/composer.js` builds each floor around a short planted line (bait / squeeze /
net motifs; tempo / crown lines for pawns), proved by an exact shortest-win search
and guarded by the human-like bot, and the planted lines are the day's certificate.
`src/generation.js` (`proveComposed`) replays them through `src/fairness.js`
(`verifyWinningRoute`, on the day's twin without hint powerups) and then as played.
Every daily plays the Fair monsters (`DAILY_TIER`, `src/difficulty.js`, which holds
the five tiers practice can choose). Par is each floor's line plus one
(`src/par.js`); `src/bot.js` replays the lines after a win. `src/human-bot.js` +
`src/recruit-policy.js` are the "plays like a person" bot, now only a probe and the
composer's guard. Authoritative description: `docs/generation.md`; history, decisions
and measurements: `docs/puzzle-first-idea.md`.

**Shipped editions.** `src/editions.js` (generated, committed) stores each day's rooms
(`src/room-code.js`), lines (`src/route-code.js`) and the motif each floor was built around
(`src/motif-code.js`, loaded as `daily.generation.motifs`) from launch (2026-11-01) through
two years past the build date; the app decodes and proves them as they load and never
carries the composer. Every build composes new dates incrementally. A date past the
window borrows a stored day of its own piece and modifier (`borrowedDaily`).

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
backup merge. Adding an idea's page is adding one `PAGES` entry and its art function.

## Changing rules, AI, the composer or the bot

Anything that alters gameplay, monster AI, modifiers, the composer or the human bot
(the composer's guard reads it) can change editions:

1. Bump `RULES_VERSION` in `src/rules.js` for a change to play (`GENERATOR_VERSION`,
   the save schema and the save keys follow it). `COMPOSER_VERSION`
   (`src/generation.js`) salts the composer's seeds; bumping it re-rolls every room,
   so it is normally left alone.
2. `npm run build:editions -- --full`, then `npm run verify:editions` and `npm test`.
   Let the user play a local preview of the days they'll meet before shipping.

New rules apply to the whole archive: rebuild every past edition, no legacy cutoff.
`docs/generation.md` is the authoritative description of the guarantee, the composer's
checks, par and versioning; keep it in step with behavior changes.

## Design constraints

- Every monster moves every turn; don't propose chess-style one-reply turns.
- Floors should be short clever lines, not chases, sieges or attrition. There are no
  lives: a capture of the player adds a move to the score.
- The king is never the daily piece; certified routes never use powerups, shields,
  freezes or the floor 1–2 recruits, and carry no recruit orders (the recruit moves
  itself along them).
- The player always orders the recruit: there is no Auto setting. Once a floor's
  challenge is complete the recruit moves itself for the rest of that room.
- Every daily plays Fair; par is the planted line + 1; on the king floor checkmate
  wins and the king can't take a piece the recruit king guards.
- Keep UI text and the share card minimal. Dialogs must not scroll on small phones
  (check around 440×780, 402×680 and iPhone SE widths).
- Original assets only; music is CC0 and seeded by date separately from generation.
- New source files get the copyright line and `SPDX-License-Identifier: GPL-3.0-only` header.

## Local saves

Game saves and app state on the development machine are disposable. The browser pane, the localhost dev servers and their localStorage can be wiped, overwritten or seeded freely while testing. The user plays for real only in the installed PWA on their phone.
