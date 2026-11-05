# Dungeon Chess Daily

[Play Dungeon Chess Daily](https://ryanlmelvin.github.io/dungeon-chess-daily/) · [Source](https://github.com/ryanlmelvin/dungeon-chess-daily)

A short daily dungeon played with chess moves. A twirling pixel newspaper introduces three of the day's monsters, with illustrated stories that hint at how they move. Take one chess piece through three compact rooms, decide when to capture and when to escape, then share a spoiler-free emoji result. Designed for a complete daily run in five minutes or less.

By [Ryan L. Melvin](https://ryanlmelvin.com).

## Play

- Your daily piece is selected from pawn, knight, bishop, rook, queen, and king with equal probability. It moves and captures like that chess piece. Tap your piece to see legal destinations, then tap a destination to move.
- Capture a monster by landing on its square. A pawn advances into empty squares and captures diagonally; reaching the far rank promotes it to a queen.
- The dungeon has eighteen original monster species. Their chess movement roles change with the daily seed and are hidden behind their monster appearances. Read the newspaper's three clues, observe their moves, and learn the threats.
- Monsters respond after your move. A threatened capture winds up before it lands, showing its full attack path so you can escape or capture the attacker.
- Capture at least one monster in a room to unlock its stairs. You may leave while other monsters are alive; taking extra captures is a choice.
- Reach the stairs in all three 8×8 rooms within sixty moves. A monster capture ends your run. There is no real-time countdown.

Everyone gets the same UTC-dated edition. Your first attempt is the daily result; unlimited practice is labeled separately. Emoji sharing reveals your result without exposing the newspaper clues, monster movement roles, or route.

The mobile game gives the board the screen. Open the in-game menu for the paper, instructions, sound, saved progress, or a downloaded update.

## Install and offline use

Use **Install** from the newspaper or result screen. The installation dialog includes instructions for Safari on iPhone/iPad, Chrome on Android, and desktop browsers. After its first complete download, the game and future deterministic daily editions work offline. Three.js, sprites, and other runtime assets are bundled locally.

Progress stays on the device. Export/import in the menu transfers saved editions between browsers or installed apps; there is no account or automatic cloud synchronization.

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

`src/game.js` contains the deterministic rules and daily generation. `src/renderer.js` renders the pixelated Three.js board. `src/sprites.js` contains original monster and chess-piece pixel art. `src/main.js` owns input, the newspaper, local progress, and sharing.

The build fingerprints shipped content and generates an integrity-verified offline cache. `dist/` is generated and is not committed. Run the engine and PWA tests before publishing. Browser checks should cover a complete run, touch input, save/resume, newspaper hints, sharing, installation, offline reopening, and updating an older installed release. Physical installed-iPhone behavior requires device testing.

## Publish

Push to `main`. `.github/workflows/deploy.yml` installs dependencies, runs tests, builds, and deploys `dist/` to GitHub Pages. Set the repository's Pages source to **GitHub Actions**. Asset URLs, manifest scope, and worker registration use relative paths. After deployment, verify the live `release.json` and play the published edition.

## License

Copyright © 2026 Ryan L. Melvin. Source and original assets are licensed under **GNU GPL version 3 only**; see [LICENSE](LICENSE). Three.js is MIT-licensed; its notice ships in `public/licenses/three.txt`. Pixel artwork and synthesized sound effects are original. One More Crypt inspired the short daily-dungeon idea; this project uses no assets from it and is not affiliated with it.
