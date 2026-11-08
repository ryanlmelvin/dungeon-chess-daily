# Daily generation and fairness

`src/game.js` is the public game API. `getDaily()` normalizes the date to UTC and
returns a certified edition. `createGame()` uses that canonical edition; callers
cannot replace its seed, piece, color, targets, or layout by editing its metadata.
Everyone gets the same edition: its difficulty tier comes from the UTC weekday
(see [Weekly difficulty](#weekly-difficulty)). There is no personalized
difficulty, device-dependent seed, or server dependency.

## What is guaranteed

Every returned edition has an explicit sequence of legal actions that:

- Completes all three capture objectives and takes the final stairs within 50 moves (`MAX_ROUTE_MOVES`; the search prunes any line past it).
- Takes each floor's stairs as soon as its challenge is complete: no move or
  wait on a cleared floor, so no certified route ever meets a cave-in
  (`src/cave-in.js`). The verifier rejects a route that lingers.
- Uses the actual obstacles, enemy movement, attack warnings, close-range
  captures, piece color, turn order, promotion rules, and automatic pickups from
  the production engine.
- Collects or purchases no powerups and recruits no companion, except the final
  floor's own recruit (a rook, queen or king). The recruits on floors 1 and 2,
  which may be any piece, are never used: the route never steps on them. A
  route carries no recruit orders, so its recruit plays on Auto, where no
  recruit may capture its floor's challenge piece: on the final floor the
  capture of the king is the player's. The recruit can block, take guards, and
  herd the king: the king still flees squares the recruit covers. Manual
  recruit control may order any legal recruit move, Auto's included, so a
  player steering the recruit can always follow the certified route.
  Castling is an ordinary legal move, so a route may castle with the final
  floor's recruit. The bishop pair's hop (a bishop recruit joining a bishop
  moves onto the other colour) and the recruit hunting on its own once floor 1
  or 2 is cleared both concern recruits of floors 1 and 2, which routes never
  pick up, so neither changes a certificate.
- Loses no lives, except that a pawn's route may spend up to 4 of its 8; uses no
  shield or freeze, and never restarts.

The day's room modifier (`src/modifiers.js`) is part of the game state
(`state.modifier`, absent on plain days), so the route is found and replayed
under it: ice slides, collapse reinforcements and their timing are all part of
the certified play. Dark changes only rendering, so its routes are plain routes.

Pawn promotion is an ordinary chess rule and is permitted; the promoted queen
turns back into a pawn at the stairs. The proof is one replay of the entire run,
carrying every piece of state from floor to floor. The search finds it one
floor at a time (see [The search](#the-search)), which is sound because
nothing that changes how a floor plays carries over from the floor before
except lives: the piece reverts, and monster tie-breaks and Collapse arrivals
count the floor's own moves. Black's enemy phase can invalidate
a clicked destination, so a certificate can include a re-selection that costs no
player move. Extraction also costs no move. Waiting is an ordinary action that
spends a move; certificates may wait so monsters walk into range. Under
close-range captures a pawn can only strike from a square next to its target,
which most targets attack, so pawn routes depend on waiting and on spending
lives: in a one-year audit, waiting cut pawn days that needed a fallback from
63 of 75 to 12.

The certificate is for proving a day can be won; par comes from a second bot
that plays like a person (see [Par and the human gap](#par-and-the-human-gap)).
After a daily win with the official piece, `src/bot.js` shows the player that
bot's per-floor move counts and an animated replay when it cleared every floor,
and otherwise replays this certificate through `act()`. Routes stay hidden
until then. The certificate's length is the length of a witnessed route, not
the shortest one, so players can beat it.

This is an existence guarantee from the fresh starting position under this
version's deterministic rules. It does not mean every move is safe, every
position is recoverable, or that a human will discover the route. A replayable
witness is proof of success; failing to find one is **unknown**, not proof of
impossibility. The verifier and tests are software, not a formal verification of
the JavaScript runtime or the entire application.

## Rules before search, and no correction loops

Candidate construction is finite: it scans a fixed 8×8 board and considers each
obstacle position once. The rules preserve the exact chess-army count of the
assigned target, cap other roles, prevent overlapping units/items/obstacles,
reserve the entrance and exit, maintain the player's movement connectivity,
place opposing bishop targets on the player's bishop color, and preserve pawn
promotion files. A pawn-target floor draws its eight pawns from the back four
rows on a stream of its own (off the player's file and the decoys' squares, at
least three on each side, at most three per row); the first two editions keep
the fixed V they were published with. Every stationary pickup (coins, relics, and recruitable pieces)
also passes a movement-graph reachability check on every floor. Bishop pickups
must lie on the bishop's starting color and be connected through its diagonals;
knight pickups must be connected through legal jumps. Pawn graph states advance
and promote to queen before exploring the remaining squares. Revisiting squares
is allowed, so this is a reachability problem, not a knight's-tour problem. Enemy movement also keeps an unpromoted player's forward file
open. The pickup check concerns terrain accessibility; it does not claim that collecting every pickup and winning can be combined into one 50-move route. These rules reduce the search space; they do not replace combat replay.

There is no mutate-until-it-passes loop. Each edition gets at most four candidates
(`ATTEMPTS` in `src/generation.js`) and 12,000 simulated transitions per
candidate, then one certified fallback.
Every rejection, next seed, and fallback choice is a pure function of the date,
tier, calibration table, and rules version. The fallback builder is an offline authoring tool
with its own finite scan; it is not an unbounded runtime repair operation.

For future tactical templates, start with a certified route, make a bounded
number of date-seeded additions, replay the complete route after each proposal,
and keep the previous certified version whenever a proposal fails. This retains
a witness throughout construction. Avoid assuming that an obstacle away from the
player's route is harmless: it can still change enemy movement or attack lanes.
That approach can generate deliberate mobility or promotion puzzles without
searching the entire game tree for every proposed decoration.

## Generation and certification

1. The UTC date selects the piece, species, target roles, and first layout. The piece is always white.
2. A bounded search finds a complete route floor by floor, each floor by a
   two-ply rollout and then a beam search ([The search](#the-search)). Search
   uses fixed transition counts and stable ordering, never a wall-clock timeout.
3. An independent replay of the returned action list calls the same `act()` used
   by gameplay. It rejects illegal actions, incomplete victories, powerup effects,
   damage, restarts, moves after a clear, and deadline failures. Automatic
   pickups remain on the board; the route must avoid them rather than simulate
   a different game.
4. If the first candidate fails, or its route's difficulty score lies outside
   the tier's band, the next layout seed is derived from the date and generator
   version and searched the same way, up to four candidates (`ATTEMPTS`,
   `searchCandidates`). The generator keeps the first candidate in the band, or
   else the certified one closest to it (`chooseCandidate`). From Tricky on, a
   candidate whose route clears any floor in fewer than `minFloorMoves` (3)
   moves is rejected like an unsolved one (no freebie floors); `certify`
   rejects such a stored or remembered route too, and the fallback bank is
   built and verified to the same rule.
5. If no candidate is accepted, the generator selects a previously certified
   full-dungeon template for the same tier, piece, and color. Date-specific
   appearances remain varied; target roles and gameplay RNG use the template's
   seed. That exact remapped edition is replayed again before it is returned.

### The search

`findWinningRoute` (`src/fairness.js`) certifies one floor at a time. Each
floor is searched from its standard start, the position where the route so
far arrives, until its challenge is complete; then the route takes the stairs
at once, which is the only action a cleared floor offers it and costs no
budget. Three separate searches are enough because nothing that changes a
floor's play carries over from the floor before but lives: a promoted pawn
reverts at the stairs, monster tie-breaks and Collapse arrivals count the
floor's own moves (`monsterTie`), and routes never buy, so gold is irrelevant.
The run's 50-move cap carries over too.

- **Lives.** A pawn's route may spend 4 of its 8 lives across the run. Each
  floor's search takes the clear that kept the most lives among those it
  finds together, and when a later floor can't be certified with the lives
  left, a floor that spent some is searched again keeping one more. Over 800
  sampled candidates this lifted pawn days from 63% to 72% solved.
- **Identity.** The beam merges positions by `positionKey`: everything that
  decides how a position plays on, with the floor's own move count (tie-breaks,
  Collapse timing) but not the run's, and without coins, which only pay gold.
  Classic comparison monsters hash the run's count, so for them it stays.
- **Distance.** Positions are ranked by progress, captures, lives and the
  distance to the nearest target, measured in real moves for the player's
  piece around the room's walls (`targetDistance`, the BFS tables of
  `src/move-tables.js`; a pawn's count includes promoting on the way), not in
  coordinates. A target the piece can never land on counts as 10 moves.
- **Budget.** A candidate's 12,000 transitions are shared by its floors in
  order, so a quick floor leaves more for the next. Each floor's rollout may
  spend 2,000 of them (`ROLLOUT_BUDGET`) before its beam (24 wide) takes over.
  Every limit is a fixed count, so a smaller budget is the same search cut
  short.

On 800 sampled candidates (8 dates per tier and piece, 4 candidates each,
current knobs), the per-floor search solved 85% within budget against 78% for
the whole-run search it replaced, in half the time (380 against 804 ms per
search). Of the old search's routes, 69% took every floor's stairs right
after its clear; the rest wandered a cleared room first. Rollout budgets of
1,000 to 4,000 changed nothing; a 36-wide beam solved about 1 point more at
30% more time, so the beam stays at 24.

The fallback bank covers all 75 combinations of five difficulty tiers, five
playable pieces (always white), and plain, ice or collapse rules, each built with that
tier and piece's calibrated knobs on a template date with the same modifier. A broken or missing fallback fails closed with an error; it never
releases an unverified dungeon. The test suite and build check the entire bank.
Search and verification share `src/rules.js` with live gameplay, avoiding a second
implementation of combat. `rules.createGame()` is the internal candidate builder
for search, authoring, and rule fixtures; application code uses `game.createGame()`.

## Room modifiers

`modifierFor(date)` draws from `none`, `none`, `ice` and `collapse` uniformly from its
own hash stream (`modifier:<date>`), so no other daily draw moves. The modifier is part of
`getRawDaily()` and is copied into the state by `createGame()`.

- **Ice** picks 8 tiles per floor on the stream `<dungeonSeed>:ice:<floor>`,
  after walls, monsters, pickups and the recruit are placed, never on a wall, a
  monster, a pickup, the start square or the exit square. Saves store them as
  `state.ice` and validation recomputes them. Only the player's piece slides:
  a rook, bishop or queen, or a pawn moving straight, whose non-capturing move
  ends on ice moves one more square in the same direction if it is walkable and
  holds no monster or recruit. `legalMoves()` reports that landing as `slide`,
  and `act()` emits a `slide` event. Monsters and recruits never slide, which
  keeps the monster AI and attack warnings unchanged.
- **Collapse** counts moves on the current floor. At the end of each player
  turn, if `floor(moves / 10)` exceeds the arrivals so far (`state.reinforcements`
  plus called-off `state.reinforcementsSkipped`, capped at 3), a copy of one of
  the floor's decoy species (never a pawn, which could block a pawn's promotion
  file) enters at once as `f<floor>-r<n>`. It never waits: it enters on the door
  square, or, if the player, the recruit or a monster stands there, on the
  nearest walkable square holding none of them (king steps from the door
  square; ties by the hash of `<dungeonSeed>:arrival:<floor>:<n>:<x>,<y>`,
  `arrivalSquare`). Like any monster coming into range, it winds up on its next
  turn rather than striking as it lands. It is the species
  `n % 2` first, else the other, whichever role still has room under a chess
  army's counts (living monsters of that role or piece, so a promoted pawn
  fills the queen's place). If neither has room (or, on a packed board, no
  square is empty) the arrival is called off and counted in
  `state.reinforcementsSkipped`. None arrive once the stairs open. Reinforcements are
  ordinary decoys: capturing one pays a gold, and save validation widens floor
  populations by the cap.
- **Dark** (retired) hid squares more than two away from the player. It hid the
  board, which took the planning out of a day, and the solver could not model
  it, so its draw slot now yields `none`. Former dark days kept their
  dungeons, now played in full view.

Ice and collapse change play, so the fallback bank holds a certificate for
each tier, piece and one of `none`, `ice` or `collapse` (75 in all). Over the 60 standard editions from
2026-11-06, every modifier certified at the same rate as the same days
without it (the same three days needed fallbacks).

## Monster habits

`src/monster-ai.js` ranks a monster's ordinary (non-attacking) steps by role,
adding soft preferences to the original approach score (distance to the player,
a small travel cost and the seeded hash tie-break): knights keep a jump's
distance, prefer squares that attack the player or cover its destinations, and
avoid capturable squares unless a strike plus a fork outweighs the risk; rooks,
bishops and queens prefer open lines that cut off the player's destinations;
pawns prefer squares another monster pawn guards; and any monster the player
threatens without a guard prefers a guarded square. Wind-ups, `closeIn`, the
pawn-lane rule, en passant, promotion and the royal floor's king and guard rules
are unchanged. Weights live in `HABITS`; knights that never accept exposure made
knight days hard to certify (110 of 120 audited dates instead of 118), so the
exposure penalty stays below a strike-plus-fork bonus.

## Par and the human gap

The certificate's route is a search's route: on 2026-11-07's last floor
(bishop against king, 16 moves) it wanders while the rook recruit eats every
guard, then corners the lone king, which no person would plan. So par comes
from a bot that plays like a person, `src/human-bot.js`:

- **It sees what a player sees**: the board, items and red lanes, the floor's
  target role and which species is the target (as if the newspaper were
  solved), and a species' role once one of them has been captured. It never
  reads a hidden role and never simulates the monsters' replies. A monster of
  unknown role is dangerous up close: the squares next to it and a knight's jump
  away count as unsafe, for any role but the target's.
- **It plans only its own moves**, on the board as it stands: can I take a
  target next move, will I have a safe square to go to, and how many moves
  away is the nearest target?
- **Habits, in order**: take a target when that's safe; never end a move in a
  red lane or where a monster strikes up close; close in on the nearest target
  by the safest short way (a search over squares no monster strikes, with the
  wall-aware move tables of `src/move-tables.js` as the fallback); pick up the
  recruit when it costs at most a move; take a decoy when that costs nothing;
  otherwise wait, since monsters often walk into range, and after a few waits
  try a sideways move. A pawn goes after a king only once promoted. When every
  move is risky it takes the least risky one. No powerups and no shopping,
  like the certificate.
- **Each floor is played from its standard start**, the position the
  certificate reaches there, so a floor's par never depends on how another
  floor went. Five seeded runs per floor (`HUMAN_RUNS`; each seed is the date,
  floor and run number, never a move count). A run succeeds when it completes
  the challenge within 40 moves (`HUMAN_MOVE_CAP`) without losing its last
  life; it may lose others, as players do.
- **Par** is the lower median of the successful runs' scored moves. When every
  run fails, par is the certificate's moves on that floor plus 25%, rounded up,
  and the floor is recorded as failed.

`scripts/build-editions.mjs` works out par for every stored edition on all
cores (seconds, so it is redone on every build) and stores it beside the route
in `src/editions.js` as `par`, with `runs`: the run the result card replays on
each floor, or `null` where the bot failed. `--verify` checks both. A date past
the window works par out once on the device (`src/par.js`) and remembers it in
local storage. The result card's Dungeon Bot is the human-like bot when it
cleared every floor without losing as many lives as the piece has (its floors
are then the day's pars), else the certificate. Today the recruit moves on its
own; `humanPlayer` takes a recruit policy that can add an order to each action.

**The human gap.** `difficultyScore` measures how dangerous the certificate's
route was, not how hard a route is to find. `humanGap` (`src/difficulty.js`)
measures that: per floor, the human-like bot's expected moves (the mean of its
five runs, a failed run counting as the whole 40-move cap) minus the
certificate's moves, summed over the floors. It sits beside the score and does
not pick tiers. `node scripts/measure-human-par.mjs` reports, by tier and piece,
how often runs clear each floor, par against the certificate per floor, the gap
and the score. Over the 733 stored editions (2026-11-05 to 2028-11-06):

| Tier | Runs won F1 / F2 / F3 | Total par / certified (median) | Human gap | Score |
| --- | --- | --- | --- | --- |
| Gentle | 95% / 89% / 64% | 27 / 20 | 21.3 | 9.5 |
| Fair | 88% / 88% / 62% | 31 / 20 | 26.3 | 11.3 |
| Tricky | 91% / 89% / 64% | 30 / 20 | 25.2 | 12.9 |
| Tough | 88% / 90% / 64% | 32 / 22 | 25.9 | 13.6 |
| Fiendish | 86% / 86% / 67% | 32 / 21 | 28.0 | 15.0 |

By piece the gap is knight 14.4, queen 15.5, rook 20.0, bishop 30.2 and pawn
45.5: the bot clears a bishop's king floor in 31% of runs and a pawn's in 42%
(a pawn day's relic sits on the pawn's own file, and the bot, like the
certificate, never takes it). The gap rises only a little through the week but
differs widely between pieces, which is what a recalibration on it would fix.
The bot is software with blind spots too, so a failed floor is evidence that a
day is hard to figure out, not proof.

### Smarter monsters by tier

Monster smarts are the main difficulty dial. `monsterSmarts(state)` is the
tier's rank (Gentle 1 to Fiendish 5, from `state.difficulty`); any other value,
such as legacy saves' `standard`, plays like Gentle. Each tier keeps the ones
before it, on floors 1 and 2 (the king floor keeps its royal rules):

- **Gentle**: the habits above.
- **Fair**: every role pays for landing where it is *exposed*: the player could
  capture there, counting a held Borrowed move (`borrowedPiece`), and the square
  is not *guarded* (`closeAttacker`: taking it would be an instant hit); or the
  recruit could capture there, guarded or not, since nothing punishes a recruit.
  Knights keep their weight of 3 (`knightExposed`, now with that definition);
  the rest pay 6 (`exposed`), because a slider's plain approach (0.6 a square)
  pulled a rook from across the room to stand next to a rook player at 3.
- **Tricky**: a rook, bishop, queen or decoy king closes in (`safeCloseIn`) and
  winds up (`safeToStrike`) only from a square where it isn't exposed.
  Otherwise it repositions with its habits. The wind-up warning never changes;
  only the choice to make one. This answers the playtest finding that lines are
  two-way: bishop against bishop, rook against rook or anything against a
  queen, a wind-up handed the piece over, and floor 1 often fell in three moves.
  The follow-through after a missed wind-up (the lunge onto the square the
  player left) is unchanged, so the telegraph stays exact; see [Measuring the
  monsters](#measuring-the-monsters) for what changing it would cost.
- **Tough**: guards (every monster but the targets) screen the targets like
  royal guards screen the king. A guard first blocks a line into a target the
  player or recruit could take (`screenStep`: fewest targets left exposed, then
  its own safety, then the nearest), before closing in or winding up; its
  ordinary steps pay 8 per target they leave exposed (`unscreen`, more than its
  own safety), earn 2 for standing between the player and a target (`screen`),
  and it never closes in to open a target. Guarding counts as screening:
  standing beside a target makes taking it an instant hit. Non-pawn targets
  earn 2 for a guarded square (`huddle`).
- **Fiendish**: a non-pawn target with a step where it isn't exposed never takes
  one where it is (a filter, like the royal king's `safeKingMoves`), and guards
  bait: 2.5 for a guarded square from which they strike, so they wind up where
  taking them costs the player a life.

Pawns keep their chains and only advance, which keeps pawn floors catchable.
Monsters still can't pass, so one with no safe step must step into reach
anyway, and waiting can squeeze it (tests/monster-smarts.test.js). In open
rooms smarter monsters keep their distance instead; Wait works best in tight
corners.

**Tie-breaks.** A monster's seeded tie-break (`monsterTie`) hashes the seed,
floor, monster, destination and the moves made on *this floor*, never the
whole run's move count, so how long earlier floors took (gold collecting
included) no longer changes a later floor or its par. Hashing the board alone
was tried first: in 200 floor-1 rooms with the player waiting 30 times, 51 of
1,036 monsters ended pacing between two squares for the last 8 waits (44 when
the hash also covered every unit's square), against 29 to 31 with a move count.
A board-only loop can never break while the player waits, so a floor-local
count it is. On floor 1 it is exactly the old tie-break.

`classicMonsters: true` on a candidate (comparisons only, never on an edition)
restores the old monsters on every tier: Gentle smarts and the whole-run move
count. `node scripts/measure-monsters.mjs --classic` uses it to show what the
new monsters cost generation (see [Measuring the monsters](#measuring-the-monsters)).

## Difficulty and chess learning

## Weekly difficulty

Difficulty rises through the week. `src/difficulty.js` defines five tiers, each
a band of the difficulty score, and maps the UTC weekday to a tier:

| Day | Tier |
| --- | --- |
| Monday | Gentle |
| Tuesday | Fair |
| Wednesday | Tricky |
| Thursday, Friday | Tough |
| Saturday, Sunday | Fiendish |

The newspaper prints the tier (for example "DIFFICULTY: TOUGH") and, besides
each floor's clue and two suspects (the target's species and one other that can
appear there, so a lone suspect shows a floor with no other species), nothing
else about the dungeon.

The tier also sets how smart the monsters are ([Smarter monsters by
tier](#smarter-monsters-by-tier)), the main step from one tier to the next, and
from Tricky on its `minFloorMoves` (3) rules out freebie floors: every floor of
the certified route takes at least three moves. The route records them as
`metrics.floorMoves`. Each floor's rollout first looks two moves ahead from
the floor's start, so when the route needs three, the search found no quicker
clear by its rules (no pickups, no lives past its allowance). The rule was 4
at first; with two candidates and the old search that sent about 40% of Tricky-and-up days
to the fallback bank, and three moves was the owner's choice (see [Measuring
the monsters](#measuring-the-monsters)). `minFloorMoves` may also list each
floor's own minimum (`floorMinimums`), which tooling uses to price other rules.

**The score.** Every certified edition gets one number from its certificate's
verifier metrics and its piece (`difficultyScore`):

    pressure = threatenedDecisions + 2 × narrowEscapes + turns / 4 + 20 × unsafeShare
    score    = pressure / √(lives left at the end of the route)

Threatened decisions are moves made while a committed attack lane is on the
board, narrow escapes are moves with exactly one safe option, `turns / 4`
charges for route length, and `unsafeShare` is the fraction of legal
alternatives along the route that would have lost a life. Lives left are the
piece's lives (pawn 8, rook/knight/bishop 2, queen 1) minus those the route
spent: spare lives forgive mistakes, with diminishing returns. Without that
divisor a pawn's long, life-spending route always out-scores a queen day that
ends at the first slip, and no knob setting brings them together. The score is
stored on the certificate (`generation.certificate.score`).

**Knobs.** Generation reads a row of knobs per (tier, piece) from the
generated table `src/calibration.js`:

- `obstacleBase`: walls on the first floor; each later floor adds one. More
  walls hinder a rook and shelter a knight.
- `decoys` (0–4, usually 2): optional residents beside each floor's targets.
  Extra decoys reuse the floor's two decoy species without exceeding a chess
  army's count of any role, and start in the back three rows.
- `scatter` (0/1): non-pawn targets start anywhere in the back four rows that
  the player's piece does not attack from its start square, instead of the
  fixed squares a rook or queen can take on its first move.
- `guards` (0 up to `decoys`): that many decoys start beside a target, on a
  square from which they would strike a player who takes it.
- `screens` (0–3, rook, bishop and queen days): before the random walls go
  down, that many of the room's walls are placed on the squares that cut the
  longest open lines into the floor's targets (`screenReach` in `src/rules.js`),
  so a long-range piece has to close in, where guards can strike. Screens count
  toward the room's walls and pass the same connectivity check.
- `minThreatenedDecisions`: the certificate's minimum threatened decisions.

Decoys, scatter and guards draw from their own seeded streams, so the rest of
a room's layout is unchanged; `0`/`2` reproduces the plain layout. Saves record
every knob, and `validateSave` rejects a save whose knobs differ from the
edition's.

**Calibration.** `npm run calibrate:difficulty` (`scripts/calibrate-difficulty.mjs`)
searches every candidate layout generation may try (four) of ten dates per
piece under a grid of knob settings, with the runtime search budget, in
parallel workers. It then replays
`chooseCandidate` for every tier, setting and threat minimum, and keeps the
cheapest setting per (tier, piece): distance outside the band, days outside the
band, and fallbacks (ten times as costly as a missed day, since they repeat a layout) all cost. Search time no longer counts by default, because editions are certified at build time (`scripts/build-editions.mjs`); `--time-weight 1` restores the old penalty on searches over 1.5 times as slow as the piece's plain layout. It writes `src/calibration.js` (the table plus
`CALIBRATION_REPORT`, the measured scores behind it) and
`scripts/calibration-data.json`: one row per search with its status (`solved`,
`unknown` when the budget ran out, or `invalid` when replay rejected the route),
solver expansions, route moves and wall time, plus min/median/p90/max summaries
per piece and knob setting. `--reuse` refits from that file without searching
again (after editing the score or bands), `--merge` measures only what the file
lacks, `--pieces`, `--obstacles` and `--grid quick` narrow the grid, and
`--dry-run` leaves the table alone. A full brute-force run uses every core but
one (`--jobs N` overrides) and takes well over an hour.

Monsters grow smarter with the tier, so every setting is measured once per
tier, with that tier's monsters, and competes only for that tier: five times
the searches of a shared measurement (shortlist screening and dominance work
per tier too). Setting keys end in `@tier`, and data measured before tiered
monsters has none, so it can't be reused. Rows keep the route's `floorMoves`,
so the fit applies the no-freebie-floor rule as generation does.

### Shortlist, then confirm (the quick way)

Two commands replace the hour-long run with a few minutes of screening and a
targeted full check:

```sh
npm run calibrate:shortlist   # minutes; writes scripts/calibration-shortlist.json only
npm run calibrate:confirm     # full-budget check of the shortlist; writes src/calibration.js
```

**Shortlist** (`--fast`) screens the whole grid cheaply and never touches
`src/calibration.js` or `scripts/calibration-data.json`. Its searches and
finalists go to `scripts/calibration-shortlist.json` (git-ignored). It measures
every setting on one date (`--stage1-dates`), keeps the best `--keep1` (6) per
tier by the fit's own cost, adds `--stage2-dates` (4) more dates and keeps the
best `--keep2` (3) per tier, then adds the remaining dates two at a time. All of
its searches run at the runtime budget (`--screen-budget 3000` screens cheaper,
and then unsolved screens advance). The helpers live in
`scripts/calibration-search.mjs`:

- a per-piece least-squares surrogate (knobs plus pairwise products) fitted to
  the stage-1 scores; its `--surrogate-keep` (3) best predictions per tier also
  advance, which guards against one unlucky date (`--no-surrogate`);
- monotone dominance: difficulty mostly rises with obstacles, decoys, guards and
  screens, so a setting at least as hard as one already `--dominance-margin`
  (1.5) above the hardest band, or at most as hard as one that far below the
  easiest, is dropped (same scatter only; never by its own mean; `--no-dominance`);
- sequential stopping: finalists share dates and layouts, and one stops gaining
  dates once a paired test shows its per-day cost clearly worse (`--stop-z` 2.5
  standard errors, four dates at least) than the leader's for every tier
  (`--no-stopping`).

**Confirm** (`--confirm scripts/calibration-shortlist.json`) is brute force on a
short list. It uses the shortlist's start date and sample count, then measures
three groups of settings on every date at the full budget, exactly as a
brute-force run would:

- the shortlist's finalists;
- every setting in the live `src/calibration.js`;
- the plain layout.

Then it fits and writes the table and `scripts/calibration-data.json` as usual
(`--dry-run` to only look). Because the live settings are always in the running,
a confirm can never choose a setting that does worse than the current table on
the same dates.

Why not trust the shortlist on its own: on 2026-11-07, a full `--fast` refit
(3.5 minutes) scored worse than the brute-force table on the same ten dates.

| | Shortlist alone | Brute force |
|---|---|---|
| (tier, piece) means outside their band | 8 | 1 |
| Summed distance outside the bands | 4.5 | 0.6 |

Its worst misses were fiendish queen (14.1 against 16.2) and gentle knight
(11.0 against 9.5). Early stopping on a few dates sometimes settles on a worse
setting. Its screening is still good at finding the candidates, which is the
part confirm keeps.

To compare search strategies without searching, `--replay data.json` serves
searches from an earlier full-budget data file (search is deterministic, so a
smaller budget is that search cut short), and `--choices-out file` saves the
chosen table and its report. Every run prints its searches, expansions and
wall time.

### After a rules, monster, modifier or search change

Monster AI, room modifiers, rules and search changes all shift difficulty.
After any of them:

```sh
npm run calibrate:shortlist          # or calibrate:difficulty for full brute force
npm run calibrate:confirm            # rewrite src/calibration.js
node scripts/build-fallbacks.mjs     # rebuild the bank for the new knobs
npm run verify:fallbacks
npm run build:editions -- --full     # re-certify every stored day under the new knobs
npm test
```

`verify:fallbacks` fails if a fallback was built for knobs the table no longer
holds. The script warns when a (tier, piece) mean misses its band; then widen
the grid, add a knob, or move the bands.

## Measuring the monsters

`node scripts/measure-monsters.mjs` prices the no-freebie-floor rule, rule by
rule. For 16 real dates per (tier, piece) (`--samples`), half plain and a
quarter each ice and collapse, it searches every candidate generation may try
(four; `--attempts`) with the current knobs, the tier's monsters and the
production search, then replays `chooseCandidate` under each rule: every floor
at least 3 moves (adopted), every floor at least 4, floor 1 at least 4, and
none (Gentle and Fair have no rule under any of them). It prints the fallback
share per rule by tier, the adopted rule first, plus the adopted rule with only
the first two candidates; then per tier and per tier and piece how often each
candidate certifies, the route's moves per floor, the score and search time.
`--classic` also searches the classic monsters and adds their fallback share
with no rule, which prices the smarts themselves. 16 dates take under two
minutes on seven workers.

### The freebie rule with the per-floor search

Run 2026-11-07 with the per-floor search and four candidates, 32 dates per
tier and piece (800 dates, 3,200 searches, under four minutes), before
recalibration: the knobs were still fitted for the whole-run search, two
candidates and a four-move rule. Share of days that fall back to the bank:

| Rule | Gentle | Fair | Tricky | Tough | Fiendish | Tricky to Fiendish | All |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Every floor ≥3 moves (adopted) | 3% | 1% | 18% | 11% | 8% | 12% | 8% |
| Every floor ≥4 moves | 3% | 1% | 34% | 25% | 15% | 25% | 16% |
| Floor 1 ≥4 moves | 3% | 1% | 19% | 11% | 9% | 13% | 8% |
| No rule | 3% | 1% | 4% | 2% | 0% | 2% | 2% |
| Every floor ≥3, first two candidates only | 8% | 7% | 26% | 21% | 17% | 21% | 16% |

- The same rules priced with the whole-run search and two candidates sent
  40%, 21%, 21% and 6% of Tricky-and-up days to the bank (see below); the
  per-floor search and four candidates cut that to 25%, 12%, 13% and 2%.
- The adopted rule still sends 12% of Tricky-and-up days to the bank, 10
  points of it for quick floors. Bishops pay most (Tricky 44%, Tough 41%):
  37% of their solved Tricky-and-up candidates clear floor 1 or 2 in under
  three moves, against 27% for queens, 24% for knights, 13% for rooks and 3%
  for pawns. The king floor almost never falls that fast.
- What is left without any rule is the search: pawn candidates go unsolved
  most often (36% of Tricky-and-up searches, against 20% for bishops and
  10–14% for the rest), so Gentle and Tricky pawn days fall back 16% and 19%
  of the time even with no rule.
- Recalibration will move these numbers; rerun the script after it.

### Pricing the smarter monsters (first run)

The script's first version compared *old* monsters (`classicMonsters`, no
minimum floor moves: exactly how editions were certified before; its choices
matched the shipped `src/editions.js` on all 385 sampled dates inside its
window) with *new* ones, using the whole-run search and two candidates. Its
first run (2026-11-07, 400 dates, knobs still calibrated for the old
monsters), old → new:

| Tier | Candidate 1 certifies | Candidate 2 certifies | Fallback | No freebie rule | 4 candidates | Median par F1/F2/F3 | Median total par | Mean score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gentle | 89% → 86% | 81% → 80% | 5% → 6% | 6% | 0% | 4/4/7 → 4/4/8 | 18.5 → 20 | 9.4 → 9.7 |
| Fair | 94% → 84% | 89% → 86% | 0% → 5% | 5% | 1% | 5/5/5.5 → 5/6/5 | 19 → 21 | 11 → 11.6 |
| Tricky | 84% → 38% | 84% → 35% | 5% → 46% | 5% | 30% | 5/5/6 → 7/7/8 | 20.5 → 23 | 12.7 → 13.5 |
| Tough | 91% → 41% | 84% → 44% | 4% → 38% | 9% | 21% | 5/5/6 → 7.5/7/6.5 | 23 → 24.5 | 14 → 14.8 |
| Fiendish | 86% → 46% | 91% → 46% | 0% → 35% | 4% | 23% | 6/5.5/7 → 7/7.5/7 | 21.5 → 24.5 | 15 → 15.9 |
| All | 89% → 59% | 86% → 58% | 3% → 26% | 6% | 15% | 5/5/6 → 6/6/7 | 20 → 22 | 12.4 → 12.7 |

- The smarter monsters cost little certification on their own (6% fallback
  without the freebie rule, against 3%); the rule costs most. Under the old
  rules about a quarter of every tier's certified floors took under four
  moves, and the rule alone would have sent 48–56% of Tricky-and-up days to
  the bank with the old monsters. Lone queens are most of them: 73% of
  Tricky-and-up queen floors still fall in two or three moves with the new
  monsters, against 14% for rooks, 8% for knights and bishops and none for
  pawns.
- On Tricky and up (pooled), relaxing the rule trades fallbacks for quick
  floors: every floor at least 4 moves 40%, at least 3 moves 21%, floor 1 at
  least 4 moves 21%, no rule 6%. Four candidates instead of two cut those to
  25%, 11%, 12% and 2%, at up to twice the search.
- Pawn days pay the most for the smarts themselves (Fair 19%, Tough 13%
  fallback without the rule): monsters that keep off a pawn's two capture
  squares are hard to catch.
- On quick floors a careful target was mostly caught after the follow-through
  of a missed wind-up, lunging onto the square the player had just left,
  usually beside the player (116 of 214 captures), or beside a guard that
  moved off afterwards (78; monsters act one by one, targets first). Holding the lunge back from the player's reach was tried: it
  cut freebie rejections from 175 to 130 but left more candidates unsolved
  (Tough 9% → 24% without the rule), so the fallback share did not improve
  (40% → 39%) and the lunge stays as it was.
- Scores rise 0.8–0.9 points on Tricky and up. Recalibration will ease those
  layouts, which should certify more often; rerun this script after it.
  Searches take about 45% longer (389 → 566 ms).

## Difficulty and chess learning

Certificates record route length, positioning moves, capture opportunities,
promotion, warning-lane decisions, and immediately unsafe alternative moves.
They support tuning for anticipating attack lanes, using a piece's mobility,
choosing captures, and advancing a pawn to promotion. These are measurements of
one successful route. They do **not** establish shortest solution length, forced
tactics, a unique solution, or a minimum difficulty. In particular, the presence
of a warned lane does not imply that it threatens the player's current square.
Human playtesting is still needed to check the score and tiers against real play.
The winnability acceptance condition stays unchanged when difficulty is tuned.

## Changing and auditing content

```sh
npm test
npm run verify:fallbacks
npm run audit:dungeons -- 2026-11-05 365
npm run build
```

`audit:dungeons` independently replays every certificate and validates saves after
every action, and reports the mean score per tier and piece. A tier id as the
third argument forces that tier on every date. Its timing measurements are diagnostic only and never influence the
selected dungeon. To author a new fallback bank after a deliberate rules change,
run `node scripts/build-fallbacks.mjs`, inspect the results, and verify it again.

Any change to gameplay, generation, search budgets/order, calibration, or fallback
selection can change an edition. Bump the generator/rules version and save-key
version together for such a release. Version 5 archives earlier saved editions
in backups instead of interpreting their old layouts as certified new games.
