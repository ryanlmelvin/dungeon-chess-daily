# Dungeon Chess Daily

[Play Dungeon Chess Daily](https://ryanlmelvin.github.io/dungeon-chess-daily/) · [Source](https://github.com/ryanlmelvin/dungeon-chess-daily)

A short daily dungeon played with chess moves. A twirling pixel newspaper hints at three disguised targets through colorful tabloid headlines. Take one chess piece through three crowded rooms, identify your targets, collect powerups, and share a spoiler-free emoji result. Designed for a complete daily run in five minutes or less.

By [Ryan L. Melvin](https://ryanlmelvin.com).

## Play

- Your daily piece is selected from pawn, knight, bishop, rook, queen, and king with equal probability. Its color is independently selected as white or black. It moves and captures like that chess piece. Tap your piece to see legal destinations, then tap a destination to move.
- Capture a monster by landing on its square. A pawn advances into empty squares and captures diagonally; reaching the far rank promotes it to a queen.
- Each edition draws nine monster species from twenty-six original sprites, with six randomized color palettes. Each floor mixes three species. Their chess roles stay hidden behind those appearances; read the newspaper's three clues and watch their moves.
- Seven to nine pillars, crates, barrels, and rocks fill each floor. They block movement and attack lanes; knights jump over them. Layouts preserve movement connectivity and pawn promotion lanes. Every edition also has a replay-verified winning route through combat within sixty moves, without powerups or companions (except the final floor's own recruit) and without lost lives, except that a pawn's route may spend up to four of its eight; pawn promotion and waiting are allowed.
- White acts first each turn. When you are white, your move resolves before the monsters respond; when you are black, the monsters act before your selected move. If they block that destination or a hit returns you to a pawn, choose again without another enemy response. A threatened capture winds up before it lands, showing its full attack path. Ending your move next to a monster that attacks your square, or on a square a knight attacks, is captured at once with no warning, including when you take a monster another one guards. Queens, rooks, and bishops give warning instead: step into their line from farther away and they close in one square and wind up. As in chess, a king cannot move into check, so squares a nearby monster attacks are not offered. **Wait** (or Space) skips your move so monsters come to you; one that walks into range only winds up, so you strike first.
- Floors one and two each ask you to capture all enemies of a particular chess role; the third always asks for the king. Every target group has the exact starting chess-army count: eight matching pawns, two matching rooks, knights, or bishops, or one queen or king. Other roles never exceed those limits. Capturing a different role earns gold but does not complete the challenge. The exit is a door in the back wall, behind the top-center square; it stays shut until every target is captured, then opens onto the stairs. Tap the stairs, or the exit button from anywhere, to leave. The square in front of the door stays an ordinary square, so a pawn can still promote there.
- Coins and optional captures earn gold to spend on powerups in the shop between floors. Only the last floor holds a recruit: a rook, queen, or king that moves after you for that floor, and its captures count.
- Complete all three 8×8 rooms with unlimited moves.
- Lives match the number of that piece in a chess army: eight pawns, two rooks, knights, or bishops, and one queen or king. A hit costs one life unless a shield absorbs it. A promoted pawn keeps its remaining lives but becomes a pawn again after losing one, returning to a safe square if needed. Losing all lives restarts the same daily dungeon from floor one, resetting gold and powers.

After you win the daily run with the official piece, the result paper shows the **Dungeon Bot**: your moves per floor and in total beside those of the route the fairness checker found when it certified the dungeon (no powerups, no lost lives). **Watch the bot's run** replays that route on the board at a readable pace, with pause, step, restart, and speed controls. Practice wins never show it, so it can't spoil a daily run still in progress. The in-game status line counts your moves on the current try.

Everyone gets the same UTC-dated edition. After winning, losing all lives, or running out of legal moves, choose any of the six pieces in white or black for unlimited practice. The rooms stay identical to the official challenge; alternate pieces are not checked for solvability and may be unable to win. Only runs using the official starting piece and color offer emoji sharing, including labeled practice replays. Pawn promotion does not change sharing eligibility. Practice saves separately from the daily run and resumes after reloading; use **Return to daily challenge** in the menu to revisit official progress or results. Emoji sharing reveals your result without exposing the newspaper clues, monster movement roles, or route.

Open **Archive** in the menu to play any edition you missed. It lists every past edition back to No. 001 with this device's result for each: won, lost, in progress, or not played. A past edition is the same certified dungeon everyone got that day and keeps its own save, practice runs included. Its shared result is labeled **ARCHIVE** so it never passes for today's. Use **Back to today** to return to the current edition.

The mobile game gives the board the screen. Open the in-game menu for the paper, instructions, sound, music, saved progress, or a downloaded update.

## Install and offline use

Use **Install** from the newspaper or result screen. The installation dialog includes instructions for Safari on iPhone/iPad, Chrome on Android, and desktop browsers. After its first complete download, the game and future deterministic daily editions work offline. Three.js, sprites, and other runtime assets are bundled locally.

Progress saves automatically on the device. **Download backup** and **Restore backup** in the menu transfer saved editions between browsers or installed apps; there is no account or automatic cloud synchronization. Before moving to an installed app, download a backup in the browser and restore it in the app. Restore merges saved days: won runs take priority, playable runs take priority over failed attempts, unfinished runs keep the later room, and ties keep the current run. Existing sound preferences stay unchanged. **Enable persistent storage** asks the browser to protect local data from automatic cleanup. The browser may grant or decline the request, and clearing browser data can still erase progress, so keep a backup. Certified editions use version 5 save keys. Earlier ruleset runs remain archived and included in backups; their old layouts are not loaded into the new certified editions.

Updates download in the background. **Update available**, including in the game menu, saves progress before reloading and refuses activation if saving fails. Other open windows keep their own reload choice. [Update recovery](https://ryanlmelvin.github.io/dungeon-chess-daily/update.html) works independently of the main app and preserves stored progress. Service-worker caches and saves are scoped to this project's path.

## Develop

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
node scripts/serve.mjs
```

The production preview serves `dist/` at `http://127.0.0.1:4320/dungeon-chess-daily/`, matching the GitHub Pages project prefix. Use `HOST` and `PORT` environment variables to change its address. Development mode does not register the production service worker.

`src/game.js` exposes the certified game API. `src/rules.js` contains the shared gameplay simulator; `src/generation.js` and `src/fairness.js` generate and replay-certify editions. `src/renderer.js` renders the pixelated Three.js board. `src/sprites.js` contains original monster and chess-piece pixel art. `src/main.js` owns input, the newspaper, local progress, and sharing.

The build fingerprints shipped content and generates an integrity-verified offline cache. `dist/` is generated and is not committed. Run the engine and PWA tests before publishing. Browser checks should cover a complete run, touch input, save/resume, newspaper hints, sharing, installation, offline reopening, and updating an older installed release. Physical installed-iPhone behavior requires device testing.

## Generation and fairness

Generation uses fixed structural constraints, at most two deterministic candidate searches, and a replay-verified fallback bank. It never runs an open-ended repair loop or treats an unfinished search as proof. The search uses fixed work budgets, so different device speeds cannot change the daily edition. Every stationary pickup also passes a piece-specific terrain reachability check on every floor, including bishop color restrictions and pawn promotion; knights may revisit squares. Difficulty presets vary obstacle density and measured attack-lane exposure separately from the no-powerup victory requirement.

Run `npm run verify:fallbacks` to replay all 36 piece/color/difficulty combinations, or `npm run audit:dungeons -- 2026-11-05 365 standard` to audit a year of daily editions. [Generation and fairness](docs/generation.md) explains the guarantee, difficulty metrics, and versioning requirements. The presets are tuning tools, not proven rankings of human difficulty.

## Publish

Push to `main`. `.github/workflows/deploy.yml` installs dependencies, runs tests, builds, and deploys `dist/` to GitHub Pages. Set the repository's Pages source to **GitHub Actions**. Asset URLs, manifest scope, and worker registration use relative paths. After deployment, verify the live `release.json` and play the published edition.

## License

Copyright © 2026 Ryan L. Melvin. Source and original assets are licensed under **GNU GPL version 3 only**; see [LICENSE](LICENSE). Three.js is MIT-licensed; its notice ships in `public/licenses/three.txt`. Pixel artwork and synthesized sound effects are original. Optional background music (off by default; turn on **Music** in the menu) draws three different tracks per edition, one per floor, from a library of nineteen CC0 chiptune loops on OpenGameArt by RandomMind, Wolfgang_, HydroGene, Juhani Junkala, Zane Little and pmiller. The pick is seeded by the edition date separately from generation, so it never changes a dungeon. Only the tracks for floors you play are downloaded, and the offline cache keeps the nine most recent; credits are in `public/licenses/music.txt`. One More Crypt inspired the short daily-dungeon idea; this project uses no assets from it and is not affiliated with it.
