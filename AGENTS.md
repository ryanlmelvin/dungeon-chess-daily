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
npm run build                       # verify fallbacks → build editions → vite build → service worker
node scripts/serve.mjs              # serve dist/ at http://127.0.0.1:4320/dungeon-chess-daily/ (Pages prefix)
```

Content checks:

```sh
npm run verify:fallbacks                    # replay all 75 tier/piece/modifier fallback routes
npm run verify:editions                     # replay the stored editions in src/editions.js
npm run audit:dungeons -- 2026-11-05 365    # independently replay a year of dailies (3rd arg forces a tier)
npm run build:editions [-- --full]          # incremental re-certification; --full redoes every date
node scripts/measure-human-par.mjs          # human-gap / difficulty report over stored editions
```

Dev-only composer preview: open the dev server with `?composed=YYYY-MM-DD`
(`src/composed-preview.js`, stripped from production builds, saved apart from real runs).

Publishing is a push to `main`: `.github/workflows/deploy.yml` runs `npm test` and
`npm run build`, then deploys `dist/` to Pages. `dist/` is never committed. After a
deploy, check the live `release.json` and play the published edition.

## Architecture

**Engine (pure, deterministic, shared by browser, tests and scripts).**
`src/rules.js` is the whole gameplay simulator: `createGame`, `act` (move / wait /
re-select, optionally with a recruit order `{x,y}` or `'hold'`), legal moves,
captures, promotion, en passant, castling, recruits, pickups, scoring, share text.
`src/monster-ai.js` (every monster moves every turn, seeded tie-breaks),
`src/modifiers.js` (ice, collapse, dark — part of `state.modifier`), `src/cave-in.js`
(lingering on a cleared floor) and `src/tactics.js` (fork/combo bonuses only) plug
into it. `src/game.js` is the public, certified API the UI imports: `getDaily()`
normalizes to UTC and returns the canonical edition; callers can't swap its seed,
piece, targets or layout.

**Editions and fairness.** `src/edition.js` derives the raw daily (seed, piece,
headlines) from the date; `src/difficulty.js` maps the UTC weekday to a tier and
knobs. `src/generation.js` runs at most sixteen fixed-budget candidate searches,
one floor at a time, and assembles the day from candidates' floors whose capped
human gap sums closest to the weekday target. `src/fairness.js`
(`verifyWinningRoute`) replays the stitched route as one run; a route is the
certificate. If search fails, `src/fallbacks.js` (generated bank, ~9k lines) is
used. `src/human-bot.js` + `src/recruit-policy.js` are the "plays like a person"
bot that produces par (`src/par.js`) and the human gap; `src/bot.js` shows the
post-win replay. `src/calibration.js` and the `scripts/calibrate-*` scripts tune
the knobs.

**Shipped certificates.** `src/editions.js` (generated, committed) stores encoded
routes (`src/route-code.js`) for launch through two years past the build date, so
opening a day replays instead of searching. Dates outside that window search once
on-device and cache in local storage. Every build rolls the window forward
incrementally.

**Composer (phase 0, not in production).** `src/composer.js` builds floors around a
planted solution (bait / squeeze / fork / net motifs) and proves them with an exact
shortest-win search. Plan and measurements: `docs/puzzle-first-idea.md` (the file
header still says `puzzle-first-plan.md`).

**UI.** `src/main.js` owns input, the newspaper, saves, archive, sharing and dialogs;
`src/renderer.js` is the pixelated Three.js board; `src/sprites.js`, `*-art.js`
files draw original pixel art and explainers; `src/guide.js` / `src/first-visit.js`
are onboarding; `src/pwa.js` + `scripts/build-sw.mjs` handle the fingerprinted,
integrity-verified offline cache; `src/archive.js`, `src/backups.js`,
`src/storage.js` handle past days and saves.

## Changing rules, AI, search or the bot

Anything that alters gameplay, monster AI, modifiers, search budgets/order,
calibration, the human bot, day targets or fallback selection can change editions:

1. Bump `RULES_VERSION` in `src/rules.js` (`GENERATOR_VERSION` and the save schema
   follow it). `HUMAN_BOT_VERSION` alone only recomputes pars; `LAYOUT_SEED_VERSION`
   (`src/generation.js`) reseeds candidate layouts and is normally left alone.
2. Recalibrate if difficulty shifts: `npm run calibrate:difficulty` (hours; writes
   gitignored `scripts/calibration-data.json`, ~70 MB, never commit it).
3. `node scripts/build-fallbacks.mjs`, `npm run verify:fallbacks`,
   `npm run build:editions -- --full`, `npm test`.

New rules apply to the whole archive: rebuild every past edition, no legacy
cutoff. `docs/generation.md` is the authoritative description of the guarantee,
tiers, human gap, floor assembly and calibration; keep it in step with behavior
changes.

## Design constraints

- Every monster moves every turn; don't propose chess-style one-reply turns.
- Floors should be short clever lines, not chases, sieges or attrition. There are no
  lives: a capture of the player adds a move to the score.
- The king is never the daily piece; certified routes never use powerups, shields,
  freezes or the floor 1–2 recruits, and carry no recruit orders (Auto).
- Keep UI text and the share card minimal. Dialogs must not scroll on small phones
  (check around 440×780, 402×680 and iPhone SE widths).
- Original assets only; music is CC0 and seeded by date separately from generation.
- New source files get the copyright line and `SPDX-License-Identifier: GPL-3.0-only` header.

## Local saves

Game saves and app state on the development machine are disposable. The browser pane, the localhost dev servers and their localStorage can be wiped, overwritten or seeded freely while testing. The user plays for real only in the installed PWA on their phone.
