# Daily generation and fairness

`src/game.js` is the public game API. `getDaily()` normalizes the date to UTC
and returns the certified edition of that date. `createGame()` uses that
canonical edition; callers cannot replace its seed, piece, color, targets,
monsters or rooms by editing its metadata. Everyone gets the same edition:
every floor is composed from the date alone (`src/composer.js`), at build
time, and stored (`src/editions.js`). There is no personalized difficulty,
device-dependent seed, or server dependency.

Every edition is composed, not searched. Each floor is a small room built
around a short planted line, three or four moves that use one idea, and the
planted lines are the day's certificate. How the composer came about, what
was tried and what the user chose after play is in
[Puzzle-first idea](puzzle-first-idea.md); this document describes what ships.

## What is guaranteed

Every returned edition carries a sequence of legal actions, each floor's
planted line followed by its stairs, that:

- Completes all three capture objectives: each floor's line clears it in three
  or four moves (a rare walk fallback, below, takes five or six).
- Takes each floor's stairs as soon as its challenge is complete, so it never
  meets a cave-in (`src/cave-in.js`); the verifier rejects a route that lingers.
- Uses the actual walls, monsters and their moves, attack warnings,
  close-range captures, turn order, promotion and every rule of the production
  engine, the day's room modifier included.
- Is never captured, uses no shield or freeze, and never restarts.
- Collects no powerup and recruits no piece but the king floor's own king, on
  Auto: the line carries no recruit orders. Manual recruit control may order
  any legal recruit move, Auto's included, so a player steering the recruit
  can always follow the line.
- Keeps every save along the way valid (`validateSave`), as a player's run would.

The proof (`proveComposed` in `src/generation.js`) replays the lines through
`act()` twice. First on the day's twin without its hint powerups, through
`verifyWinningRoute` (`src/fairness.js`): a certified route collects no
powerup. A floor's hint powerup lies on its key square, so the real day's line
picks it up; picking one up changes no monster's move, so the real day is then
replayed as played, hints collected, never captured, every position a valid
save. The build proves every edition this way, and the app proves each one
again as it loads it (without the save checks), so an edition that no longer
proves is never played.

This is an existence guarantee from the fresh starting position under this
version's deterministic rules. A planted line is a shortest win (below), so a
player can tie it but never beat it on the scored count; a capture or a paid
hint adds a move. The verifier and tests are software, not a formal
verification of the JavaScript runtime or the entire application.

## How a floor is composed

`composeDay(date)` composes the floors in order from three seeds of the date's
own (`composedSeeds`, salted by `COMPOSER_VERSION`), so a day is a pure
function of its date and the composer's code. For each floor it tries its
motifs in order (`motifsFor`): floor 1 a bait, else a squeeze; floor 2 a
squeeze, else a bait; the king floor a mating net. A pawn player's floors 1 and
2 are tempo lines (quiet moves time the pawn's diagonal takes), or crown lines
(it promotes within the line) where a tempo line would leave nothing to hint
at; its king floor is mated by the recruit king, by the new queen with the
recruit's help, or by the queen alone. Each motif gets up to 40 instances and
each instance up to 6 dressings, each from its own seeded stream:

1. **Build the instance.** The motif places the targets, their guards, the
   walls that shape the idea and the start square (one of b2 to g2, d1 or e1,
   drawn per instance), so that its line wins. A target pawn floor has two
   pawns, walled a square short of crowning.
2. **Search it exactly.** Monsters break ties by the floor's seed, so a floor
   is a one-player puzzle: `shortestWins` deepens over every sequence of the
   player's moves and waits. The instance is kept only if its shortest win
   takes three or four moves and uses the planted idea (`usesIdea`).
3. **Dress the room.** The decoys the idea doesn't use start two to four of
   their own moves from the line (one to three on floor 1), close enough to
   press in. On floor 1 they sleep for as many moves as the line (`held`),
   then wake and hunt; on floors 2 and 3 they hunt from the first move. A
   decoy pawn starts five or more moves from crowning. Up to three coins, the
   recruit (floors 1 and 2: any piece, three or more moves away; the king
   floor: a king one move from the start) go off the line, on squares the
   piece can reach.
4. **Judge the dressed room.** The line must still win, never captured, and
   still use the idea; nothing may win sooner (the exact search again); a
   hasty player who takes a guarded target and absorbs the capture must not
   win in two (`hastyScore`); and the human-like bot's 40 seeded runs
   (`botGuard`) must show no win in two moves and at most a third of runs that
   fail or take more than par + 4. Of the dressings that pass, the one that
   presses most is kept.
5. **Hint the key square.** Floor 1's hint is a coin, or a sleeping decoy
   standing there (never on another monster); floor 2's a coin or a coin
   magnet. The king floor's net goes unhinted. A hint other than a coin is
   kept only if the floor still passes step 4.

A floor where no motif composes falls back to a plain walk to its targets
(for a pawn, a relaxed tempo line or mate), which always composes. Over the
741 editions from 2026-11-01 to 2028-11-10, four floors walked (bishop
against bishops, lines of five or six moves); every other line takes three
moves (1,326 floors) or four (893).

**Identification.** One decoy species of each floor has as many copies as the
target where it can (two for pawns, rooks, knights and bishops, one for a
queen), so counting copies never names the target; the newspaper pictures
the target and its headline says how it moves. Now and then the composer
stands one more decoy in for a guard or a box, so a floor may hold, say, a
second decoy queen.

**Room modifiers.** A day keeps its modifier, and every floor is composed and
proved with it on. On Ice days each room lays its own eight ice tiles
(`room.ice`): where the line's move onto its key square runs along a line, it
aims one square short, on ice, and skids onto the key square, which is ice too
where a move aimed straight at it would skid past (`iceVariants`). On Breach
days a monster comes in at the door every ten moves, long after a line of
three or four has opened the stairs, so only a player far over par meets one,
and never on a pawn player's file.

## Stored editions

`npm run build` composes every edition from launch (2026-11-01, edition 1)
through two years past the build date and ships its rooms and lines in
`src/editions.js` (`scripts/build-editions.mjs`). Each entry holds the day's
three rooms as a room code (`src/room-code.js`: walls, start, monsters with
their casts and sleep, items, ice; about 100 characters a day), its lines
as a route code (`src/route-code.js`), and the motif each floor was built
around (`src/motif-code.js`: a letter a floor, `b,s,n`; a motif the code has
no letter for is stored by name). The motifs load as
`daily.generation.motifs`, a borrowed day taking its template's, and only the
journal reads them (`src/journal.js`): they never change play, and an entry
without them counts as stale, so the next build composes it again. The build is incremental: entries that
still prove are kept, and only missing or stale dates are composed, about two
seconds a day (the slowest take a couple of minutes), so each build rolls the
window forward cheaply. After a change to the rules, the monsters, the
modifiers, the composer or the human-like bot, run
`npm run build:editions -- --full`: it composes all of them again (about five
minutes on seven threads). New rules apply to the whole archive.

The player's app never carries the composer. `generateDaily()` decodes the
stored rooms and lines and proves them as they load. A date past the window
(two years after the last build) borrows a stored day of its own piece and
modifier, picked by the date from the fifty or so the window holds
(`borrowedDaily`): that day's rooms, lines and floor seeds, played in its
roles, each species keeping the date's own name and colors, and the date's own
shops. It plays exactly as the stored day does, and proves the same way.

- `npm run verify:editions` replays every stored edition (seconds).
- `npm run audit:editions` composes every stored date again and compares
  (minutes): a difference means the composer changed since the last full build.
- `npm run audit:dungeons -- 2026-11-01 365` replays a year of dailies through
  the public API, validating the save after every action.

## Par and the Dungeon Bot

Each floor's par is its planted line plus one (`src/par.js`, decided after
play on 2026-11-10): even par means the player found the idea; under par, the
exact line or a clever use of a powerup or the recruit; over par, that they
searched for it. Par is for the official piece, color and monsters; practice
runs with other choices have none. After a daily win with the official piece,
the result paper's Dungeon Bot (`src/bot.js`) replays the planted lines.

## The monsters

Every daily plays one monster ruleset, Fair (`DAILY_TIER` in
`src/difficulty.js`), so the monsters stay learnable, as a puzzle needs.
Practice may choose any of the five (`createPracticeGame`); a tier sets how
smart the monsters are and how long a cracked ceiling holds, never the rooms.

`src/monster-ai.js` ranks a monster's ordinary (non-attacking) steps by role:
knights keep a jump's distance, prefer squares that attack the player or cover
its destinations, and avoid capturable squares unless a strike plus a fork
outweighs the risk; rooks, bishops and queens prefer open lines that cut off
the player's destinations; pawns prefer squares another monster pawn guards;
and any monster the player threatens without a guard prefers a guarded square.
Every monster moves every turn. `monsterSmarts(state)` is the tier's rank
(Gentle 1 to Fiendish 5); any other value, such as legacy saves' `standard`,
plays like Gentle. Each tier keeps the ones before it, on floors 1 and 2 (the
king floor keeps its royal rules):

- **Gentle**: the habits above.
- **Fair**: every role pays for landing where it is exposed: the player could
  capture there (a held Borrowed move counted) and no other monster guards the
  square, or the recruit could capture there.
- **Tricky**: a rook, bishop, queen or decoy king closes in and winds up only
  from a square where it isn't exposed.
- **Tough**: the other monsters screen the targets, as royal guards screen the
  king, and targets stay near their guards.
- **Fiendish**: a target with a safe step never steps into reach, and guards
  wind up from guarded squares, so taking one costs you.

A monster's seeded tie-break (`monsterTie`) hashes the floor's seed, the
floor, the monster, its destination and the moves made on this floor, never
the whole run's, so a floor plays the same however long the ones before it
took. That is what lets the composer judge a floor on its own (each floor's
checks start it with stand-in floors before it, `floorStart`).

## The king floor's rules

Two chess rules hold on the king floor, agreed after play on composed days
(`src/rules.js`):

- **Checkmate wins.** A royal king that is attacked, has no safe step and no
  guard that can block is taken at once. A mate of yours wins as your move
  lands, before your recruit moves (no order is asked for); a mate the
  recruit's move completes wins after that move. The board celebrates it
  (`src/checkmate.js`).
- **The king can't take a protected piece.** It never captures a piece the
  recruit king guards.

A third rule follows from the pawn lane (no monster steps onto a pawn player's
file): a monster pawn on your pawn's own file never moves away, so a pawn
walled in under one is cornered at once (`trapped`), and the run restarts.

## Saves and versions

Saves carry the rules version (`RULES_VERSION`, 12 since the switch) in their
key (`daily:v12:DATE`) and in the state; a run saved under other rules is
kept in backups but never loaded into a new edition. A save of a composed day
carries the day's rooms (`state.composed`), and `validateSave` checks they are
the edition's. It counts each floor's targets and residents from its own room
(`floorCensus`: two pawns make a pawn target there), so captured decoys pay
their gold and grade the floor as they should, and a sleeping decoy may sleep
as long as its room says.

Bump `RULES_VERSION` for any change that alters play, then rebuild every
edition with `--full`. A change to the save's shape that alters no play keeps
the version as long as the saves already made still validate: retiring the
random rooms (below) kept version 12. `COMPOSER_VERSION` salts the composer's seeds; bumping
it re-rolls every room, so it changes only on purpose. `HUMAN_BOT_VERSION`
marks the bot's own play, which the composer's guard reads, so a change to the
bot calls for a full rebuild as well.

## Rooms in tests

Every game is built from three composed rooms: `createGame` in
`src/rules.js` refuses a day without them, and a floor begins exactly as its
room lays it out. Editions carry the composer's rooms; engine tests lay their
own from a map, monsters and items (`tests/fixtures/rooms.js`), or start from
open, empty rooms and set up the board by hand.

The seeded random room every edition used before the switch stayed on as a
test fixture until it was retired the same day, with what only it used: its
layout knobs, promotion barricades, pawn formations, powerup and recruit
draws, the launch editions' legacy layouts, and the ledger of recruits once
sold ahead of a floor (only the random room delivered them, and none has
been sold since rules version 5). Saves made before then still carry the
room's layout fields (`dungeonSeed`, `obstacleBase`, `decoys`, `scatter`,
`guards`, `screens`, `openFiles`, `legacyTurnOrder`) and an empty
`companionOrders`; nothing reads them, and they load and play on unchanged.

## Probing with the human-like bot

`src/human-bot.js` plays like a careful person: it sees only what a player
sees, steers its recruit as on Manual, and never goes out of its way for a
powerup. It no longer sets par. The composer runs it as a guard on every
floor, and two scripts report what it finds:

- `node scripts/measure-composer.mjs` composes a range of dates and reports,
  per motif and piece, how often instances survive, compose times, lines and
  the bot's runs against par.
- `node scripts/measure-human-par.mjs` runs the bot over the stored editions:
  by piece and floor, runs won, runs past par + 4, the bot's median moves
  against par, and the raw human gap (`humanGap`).

Over the 741 editions stored at the switch (40 runs a floor), the bot cleared
99.6% to 99.9% of its runs on each floor. Runs taking more than par + 4: 4.6%,
6.7% and 4.3% on floors 1, 2 and 3; most on queen days (9% to 10% on floors 1
and 2), fewest on pawn king floors (0.9%). Its median moves against median par
were 4, 6 and 5 against 4, 5 and 4, alike on plain, Ice and Breach days.

## Retired with the switch (2026-11-11)

Composed floors replaced the generator that searched random rooms and tuned
them to a weekly ramp. Retired with it: the weekday tiers (Gentle on Monday to
Fiendish on the weekend) and each weekday's target for the capped human gap;
the candidate searches and the assembly of a day from candidates' floors; the
calibration table and its scripts (`src/calibration.js`,
`scripts/calibrate-difficulty.mjs`, `scripts/calibration-search.mjs`); the
fallback bank (`src/fallbacks.js`, `scripts/build-fallbacks.mjs`); the
whole-run route search (`findWinningRoute`); par from the human-like bot; and
editions and pars a device searched for itself past the window. The last
version of this document that describes them is in git at 59ecc7d
(`git show 59ecc7d:docs/generation.md`), along with what was measured there.
