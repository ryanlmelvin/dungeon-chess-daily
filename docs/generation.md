# Daily generation and fairness

`src/game.js` is the public game API. `getDaily()` normalizes the date to UTC and
returns a certified edition. `createGame()` uses that canonical edition; callers
cannot replace its seed, piece, color, targets, or layout by editing its metadata.
Everyone gets the same edition: its difficulty tier and its target difficulty
come from the UTC weekday (see [Weekly difficulty](#weekly-difficulty)), and
which candidate floors make the day is a pure function of the date. There is no
personalized difficulty, device-dependent seed, or server dependency.

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
  floor's own recruit (always a king). The recruits on floors 1 and 2,
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

There is no mutate-until-it-passes loop. Each edition gets at most sixteen candidates
(`ATTEMPTS` in `src/generation.js`) and 12,000 simulated transitions per
candidate, then a finite choice among the days their floors make (at most
4,096; the best 32 are tried for certification), then one certified fallback.
Every rejection, next seed, assembly and fallback choice is a pure function of
the date, tier, calibration table, and rules version. The fallback builder is an offline authoring tool
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
4. The human-like bot ([Par and the human gap](#par-and-the-human-gap)) plays
   each solved candidate's route from every floor's standard start, which
   gives each of its floors a capped human gap ([The capped human
   gap](#the-capped-human-gap)). The day is then assembled from the floors of
   the candidates searched so far ([Floor assembly](#floor-assembly),
   `rankFloors`): floor 1 from any candidate, floor 2 from any, floor 3 from
   any, so that the three floors' gaps add up to the day's target. Once some
   assembly lands within 0.1 of it (`TARGET_TOLERANCE`), the search stops;
   otherwise the next layout seed is derived from the date and searched the
   same way, up to sixteen candidates (`ATTEMPTS`, `searchCandidates`), and
   the closest assembly is kept. The stitched route (each floor's part of its
   candidate's route, in turn) is certified as one whole run. The difficulty
   score takes no part. From Tricky on, a floor its route cleared in fewer
   than `minFloorMoves` (3) moves is never assembled (no freebie floors);
   `certify` rejects such a stored or remembered route too, and the fallback
   bank is built and verified to the same rule.
5. If no assembly certifies, the generator selects a previously certified
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
  move is risky it takes the least risky one. No shopping, and it never goes
  out of its way for a powerup; but a relic on its pawn's file ahead (where a
  pawn day's relic lies, rows 2–3) is the pawn's only way forward, so it walks
  onto it as a person would, and the powerup applies. The certificate still
  takes none.
- **It steers its recruit** like a player on Manual recruit control, the
  default (`steerRecruit` in `src/recruit-policy.js`, its default policy): keep
  blocking a red lane through its square, else step into one, take a target,
  take a decoy, or step nearer the closest target over the walls; on the
  bishop pair's hop, the hop square nearest a target. Its squares come from
  `recruitChoice`, so it keeps a player's rules (no capture the turn the
  recruit joins, no orders once a floor is cleared). Par, the result
  card's run and the human gap all assume a steered recruit; `autoRecruit`
  leaves it on Auto, for measurement.
- **Each floor is played from its standard start**, the position the
  certificate reaches there, so a floor's par never depends on how another
  floor went. Forty seeded runs per floor (`HUMAN_RUNS`; each seed is the
  date, the floor's own seed, the floor and the run number, never a move
  count, so a floor's runs are the same in any day assembled with it). Five
  runs were too few to aim a day with: a five-run reading of the same edition
  scattered by 1.2 (Gentle) to 2.2 (Tough) standard deviations' worth of gap,
  nearly a whole day's step ([Floor assembly](#floor-assembly)). A run succeeds when it completes
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
are then the day's pars), else the certificate. Its replay plays the stored
runs again from their seeds with the same deterministic policy (`humanRun`), so
its recruit orders come out the same and only the run numbers are stored.
`HUMAN_BOT_VERSION` (now 3, for the forty runs) keys the pars a device
remembers, so a changed bot works them out again.

**The human gap.** `difficultyScore` measures how dangerous the certificate's
route was, not how hard a route is to find. `humanGap` (`src/difficulty.js`)
measures that: per floor, the human-like bot's expected moves (the mean of its
five runs, a failed run counting as the whole 40-move cap) minus the
certificate's moves, summed over the floors. This raw gap is for measurement:
one failed floor costs it about 30, so the tiers use its capped form ([The
capped human gap](#the-capped-human-gap)). `node scripts/measure-human-par.mjs`
reports, by tier and piece, how often runs clear each floor, par against the
certificate per floor, both gaps and the score. Over the 733 stored editions
(2026-11-05 to 2028-11-06), before the smarter monsters and the per-floor
search, with the bot's
recruit on Auto, the pawn kept off its relic, and the recruit rules before
stage 2 (see below for the steered bot):

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
certificate, never takes it). The gap rose only a little through the week but
differed widely between pieces, which is why the tiers are now calibrated on
it. The bot is software with blind spots too, so a failed floor is evidence
that a day is hard to figure out, not proof.

**The steered bot.** With the recruit rules adopted after the recruit study
([Measuring the recruits](#measuring-the-recruits)) and the bot steering its
recruit and walking onto a relic in its pawn's way, over the first 365 dates
from 2026-11-05 (331 of them; the other 34 need a fallback the bank can no
longer replay until it is rebuilt), certificates still from the knobs before
recalibration, steered against Auto:

| Tier | Runs won F1 / F2 / F3, steered | Same, Auto | Total par (median), steered / Auto | Human gap, steered / Auto |
| --- | --- | --- | --- | --- |
| Gentle | 100% / 100% / 100% | 98% / 98% / 86% | 18 / 27 | 2.2 / 12.0 |
| Fair | 97% / 95% / 99% | 93% / 92% / 90% | 27 / 33 | 6.5 / 16.4 |
| Tricky | 94% / 85% / 100% | 92% / 76% / 91% | 26 / 36 | 11.3 / 24.8 |
| Tough | 87% / 91% / 96% | 75% / 81% / 87% | 31 / 44 | 14.7 / 31.2 |
| Fiendish | 85% / 87% / 90% | 76% / 82% / 76% | 31 / 41 | 18.4 / 34.0 |

By piece the steered gap is pawn 7.7, bishop 8.9, rook 12.5, knight 13.4 and
queen 19.3 (on Auto 26.1, 34.9, 26.6, 20.6 and 23.9): a steered recruit
narrows the spread between pieces, and par now falls 6–13 moves short of an
Auto player's. On the 82 pawn days among them, walking onto the relic in the
pawn's way (47% of runs do) raised the steered bot's runs won from 82% / 76% /
91% to 89% / 88% / 94%, halved its failed floors (26 → 13) and cut the gap
from 13.4 to 7.7; the median floor pars went 9 / 9 / 8 → 9 / 9 / 7 (total
30 → 28), since floors that used to fail, and took the certificate's moves
plus 25%, now take the bot's own. On Auto the same change lifts pawn runs won
from 53% / 49% / 51% to 74% / 75% / 93% (gap 48.3 → 26.1).

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
count it is. On floor 1 it is exactly the old tie-break. The recruit's own
tie-break on Auto (`companionTurn`) counts the same floor clock. It used to
hash the run's moves, which rarely mattered while the king floor recruited a
rook or queen; a king recruit, with its many equally good steps, made the
king floor depend on how long the floors before it took.

`classicMonsters: true` on a candidate (comparisons only, never on an edition)
restores the old monsters on every tier: Gentle smarts and the whole-run move
count. `node scripts/measure-monsters.mjs --classic` uses it to show what the
new monsters cost generation (see [Measuring the monsters](#measuring-the-monsters)).

## Difficulty and chess learning

## Weekly difficulty

Difficulty rises through the week, and like the New York Times crossword
every day from Monday to Saturday is meant to play harder than the day before.
`src/difficulty.js` maps the UTC weekday to one of five tiers (its monsters and
rules) and to a target for the capped human gap ([below](#the-capped-human-gap)):
Monday 3.75, then 2 harder every day (`TARGET_STEP`) to Saturday's 13.75, the
hardest; Sunday matches Saturday (`WEEKDAY_TARGETS`). Generation assembles each
day from the floors of its candidate layouts so that their gaps add up to the
target ([Floor assembly](#floor-assembly)).

| Day | Tier | Target |
| --- | --- | --- |
| Monday | Gentle | 3.75 |
| Tuesday | Fair | 5.75 |
| Wednesday | Tricky | 7.75 |
| Thursday | Tough | 9.75 |
| Friday | Tough | 11.75 |
| Saturday | Fiendish | 13.75 |
| Sunday | Fiendish | 13.75 |

Monday and Saturday sit where the centres of the old Gentle and Fiendish bands
were (2.5–5 and 12.5–15), so the week as a whole plays about as hard as before:
Wednesday and Thursday a little easier than they averaged, Friday a little
harder. Each tier keeps a band, half a step either side of its targets
(Gentle 2.75–4.75, Fair 4.75–6.75, Tricky 6.75–8.75, Tough 8.75–12.75,
Fiendish 12.75–14.75), which calibration fits the knobs to.

The newspaper prints the tier (for example "DIFFICULTY: TOUGH") and, besides
each floor's clue and two suspects (the target's species and one other that can
appear there), nothing else about the dungeon. Every floor keeps at least one
decoy (`MIN_DECOYS`), so there are always two suspects: no floor is an
open-and-shut case of its targets alone, every floor has a decoy to take for
gold, and the king floor always has a royal guard.

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

### Floor assembly

A day is made of three floors, and each floor plays the same whatever floors
come before it: its room, residents, pickups, recruit, ice, Collapse arrivals
and monster tie-breaks all draw from `<seed>:<kind>:<floor>` streams, the
player starts every floor on the same square, and only lives carry over. So
generation no longer keeps one whole candidate. It assembles the day from the
floors of the candidates it has searched (`rankFloors` in `src/generation.js`):

- **Seeds.** Each candidate keeps its layout seed (`candidateSeed`). An
  assembled edition lists one candidate per floor (`attempt: [a1, a2, a3]` in
  `src/editions.js`) and carries their seeds as `floorSeeds`; `floorSeed`
  (`src/rules.js`) gives every per-floor stream its floor's seed, falling back
  to the dungeon's seed (fallback templates, practice rooms of them). The
  bot's runs are seeded by the floor's seed too (`runSeed`), so a floor's runs,
  par and gap are the same in its own candidate and in any day assembled with
  it, and the day's gap is the sum of its floors'. Saves record `floorSeeds`
  and `validateSave` checks them.
- **The choice.** Floor f may come from any solved candidate whose route took
  at least the tier's `minFloorMoves` there. Assemblies whose route would run
  past `MAX_ROUTE_MOVES`, or lose more than a pawn's 4 spare lives, are
  ruled out. An assembly within 0.1 of the target (`TARGET_TOLERANCE`) beats
  any other, and among those the one whose hardest floor is lightest (the most
  even day) wins; otherwise the closest does. Ties keep the earlier candidates.
  Gaps are added in whole-number points (`floorGapPoints`: each floor's run
  values summed), so no choice depends on rounding.
- **Search.** Candidates are searched in order, and the search stops as soon as
  some assembly lands within the tolerance (about six candidates on average,
  sixteen at most). The stitched route, each floor's part of its candidate's
  route in turn, is certified as one whole run by the independent replay; if
  it fails (it never has outside a pawn's lives), the next assembly is tried.

**Why.** Two measurements, taken before the change, on the 738 editions from
2026-11-01 and on 52 weeks from 2026-11-09 with up to sixteen candidates a day
and forty bot runs a floor each (every pick then re-scored on 80 fresh bot runs
per floor, a seed space neither generation nor par uses, so no rule could grade
itself):

- **Five bot runs were too few to aim with.** A five-run reading of the same
  edition scattered by a standard deviation of 1.2 (Gentle) to 2.2 (Tough)
  against fresh runs: within Gentle, most of the measured spread was the
  bot's own luck, and even a perfectly placed Gentle day read outside its
  band about 30% of the time. Forty runs cut the scatter to about 0.4 to 0.8.
- **Floors are independent, so assembly multiplies the choice.** Sixteen
  candidates give up to 4,096 days for the search cost of sixteen. Of 60 days
  stitched from floors of three different candidates, 58 certified as one
  whole run (the other two were pawn days over the 4-life allowance, which the
  choice now rules out), and the bot's runs on every stitched floor matched
  that floor's runs in its own candidate exactly.
- Ruled out: the certified route as a noisy baseline. The bot beat the route
  on 37% of floors, by a median of 3 moves, but measuring against the best
  known clear instead moved every gap up by about 0.8 and reordered almost
  nothing (correlation 0.96 to 0.98 within each tier).

Pick rules compared on those 52 weeks, aimed at the day targets above:

| Rule | Average miss | Spread within a weekday (sd) | Weeks rising every day Mon→Sat | Fallback days | Candidates searched |
| --- | --- | --- | --- | --- | --- |
| Before: first of 4 whole candidates in the band, 5 runs | 2.4 | 1.6–3.6 | 7% | 11 | up to 4 |
| 16 whole candidates, the closest, 40 runs | 0.90 | 0.7–2.2 | 52% | 0 | 16 |
| Floors of up to 8, stop within 0.25, 40 runs | 0.68 | 0.5–1.4 | 73% | 4 | 4.5 |
| Floors of up to 16, stop within 0.1, 40 runs | 0.60 | 0.6–1.0 | 81% | 0 | 6.5 |

Preferring the most even assembly among those on target cost no precision
(0.63 against 0.64 at twelve candidates). The adopted rule is the last row
with that preference.

**The shipped editions.** All 739 editions from 2026-11-01 were regenerated
under this rule (no fallback day among them; a date searches 3.3 s at the
median, 26 s at most, on the build machine) and, with the old editions,
scored once more on 80 fresh bot runs per floor. Over the 52 weeks from
2026-11-09:

| | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Target | 3.75 | 5.75 | 7.75 | 9.75 | 11.75 | 13.75 | 13.75 |
| Before: mean (sd) | 3.8 (1.6) | 5.7 (2.3) | 9.0 (2.2) | 10.5 (3.3) | 10.2 (3.7) | 14.0 (3.6) | 12.1 (3.4) |
| After: mean (sd) | 3.8 (0.7) | 5.9 (0.7) | 8.1 (0.9) | 9.7 (0.9) | 11.6 (0.8) | 13.8 (0.8) | 13.5 (0.8) |

| | Before | After |
| --- | --- | --- |
| Average miss from the day's target | 2.4 | 0.6 |
| Same week, a harder tier's day plays easier (neighbouring tiers) | 16% (30%) | 1% (2%) |
| Weeks rising every day from Monday to Saturday | 8% | 77% |
| Later day plays easier: Mon>Tue, Tue>Wed, Wed>Thu, Thu>Fri, Fri>Sat | 31%, 17%, 35%, 50%, 21% | 2%, 0%, 12%, 6%, 4% |
| Fallback days | 11 | 0 |
| Days whose hardest floor carries over 70% of the gap | 42% | 32% |

Over all 105 weeks the same rows read 2.5 → 0.65, 18% (31%) → 2% (4%), 8% →
72%, and 20 → 0 fallback days. The weakest step is Wednesday to Thursday:
Tricky layouts sit above Wednesday's target (its raw candidates averaged about
10), so Wednesday lands a little high (8.1 for 7.75). An easier Tricky setting
in the next calibration would widen that step. A day still misses its target
by about 1.5 now and then, when the forty runs it was chosen with were lucky;
those misses stay between the neighbouring days' targets.

### The capped human gap

Each day's target is a *capped human gap* (`cappedGap`): how much harder a
day is for the human-like bot than for the certifying search. Generation plays
the bot on every solved candidate's route (`searchCandidate`, with the seeds
and the default recruit policy of the edition's par, `humanPar`'s own
default), so a generated edition's par comes from the very runs its floors
were judged on. The measurements in this section were taken with that default
on Auto, before par steered its recruit, and with five runs a floor; [Stage 2
bands](#stage-2-bands) has the numbers the bands were set from, and [Floor
assembly](#floor-assembly) the ones the targets use now.

    per run   = won ? clamp(bot's moves − route's moves, 0, 10) : 10
    per floor = mean of the floor's forty runs (five before floor assembly)
    gap       = floor 1 + floor 2 + floor 3     (0 to 30, rounded to tenths)

- **A run counts 0 to 10 extra moves** (`GAP_RUN_CAP`), and a failed run
  counts 10: a slow floor's worth, about the 90th percentile of winning runs'
  extra moves on floors 1 and 2 (10 to 14 by piece). The raw gap counts a
  failure as the 40-move cap less the route, about 30, so a floor the bot
  can't play swamps its day: the raw gap's spread within a tier was 20, the
  capped gap's 5.
- **A run that beats the route counts 0.** The route is a witnessed one, not
  the shortest (the search wanders on some king floors), so a bot that beats
  it found the floor easy, not "negatively hard".
- **Every floor counts the same** (`GAP_FLOOR_WEIGHTS` [1, 1, 1]). The king
  floor counted half while the bot left its recruit on Auto: the tiers'
  monster smarts never reach it (royal rules), and certificates lean on
  their recruit there, so the bot failed 72% of a bishop's king-floor runs
  and 32% of a rook's, nearly all by running out of moves, against 7% of a
  knight's or queen's (a bishop's king floor alone kept about 8 of its 10 at
  every tier). With par's steered recruit and a king recruit on every king
  floor it fails 0 to 18%, as on floors 1 and 2, so it counts in full.
- **Pawn days stay hard, and noisy, for the bot on Auto.** A pawn day's relic
  always sits on the pawn's own file, and the bot never takes it, so its pawn must
  capture its way around and often stands still under attack: about half of
  its pawn runs fail on floors 1 and 2, mostly by losing all eight lives, and
  one setting's pawn gap swings from 7 to 25 between dates. On a single
  candidate the pawn's gap averaged 11 to 14 on every Gentle layout tried (13
  on the plain layout), against 1 to 11 for the other pieces, so Gentle pawn
  days lean on the choice among four candidates (the dry run's best Gentle
  pawn layout, 4 walls and 4 decoys, averaged 7.5 that way over 4 dates).
  Decoys help the bot here, since they are what its pawn captures its way
  around with: on Fiendish more decoys made a pawn day *easier*, so
  calibration skips monotone dominance for pawns. A steered recruit removes
  most of this blind spot (it clears the pawn's way); a bot that takes a relic
  blocking its pawn's file would remove the rest.

Measured 2026-11-07 under the current rules (smarter monsters, the 3-move
freebie rule on Tricky and up, the per-floor search, four candidates) with the
knobs still fitted to the old score bands: 24 dates per tier and piece from
2026-11-05 (600 dates; 550 certified, the rest fell back), each date's
candidate chosen by the score band as generation then did:

| Tier | Days | Runs won F1 / F2 / F3 | Raw gap | Capped gap (sd) | Score |
| --- | --- | --- | --- | --- | --- |
| Gentle | 115 | 93% / 91% / 63% | 22.7 | 8.3 (5.4) | 9.2 |
| Fair | 120 | 86% / 87% / 66% | 27.2 | 11.3 (5.4) | 11.3 |
| Tricky | 98 | 83% / 74% / 67% | 34.8 | 13.7 (5.1) | 12.6 |
| Tough | 106 | 74% / 79% / 68% | 36.6 | 15.0 (5.8) | 13.6 |
| Fiendish | 111 | 64% / 74% / 60% | 42.6 | 17.2 (4.7) | 15.4 |

| Piece | Runs won F1 / F2 / F3 | Raw gap | Capped gap | Capped gap, Gentle → Fiendish |
| --- | --- | --- | --- | --- |
| Pawn | 48% / 51% / 34% | 54.9 | 17.6 | 15.5 / 16.7 / 17.8 / 18.5 / 19.3 |
| Rook | 86% / 85% / 68% | 31.9 | 13.6 | 9.9 / 12.6 / 13.9 / 14.8 / 16.8 |
| Knight | 90% / 93% / 93% | 18.4 | 10.0 | 4.5 / 9.1 / 10.3 / 11.4 / 15.9 |
| Bishop | 90% / 88% / 28% | 35.0 | 12.5 | 8.0 / 10.8 / 16.3 / 14.2 / 16.2 |
| Queen | 86% / 88% / 93% | 23.9 | 11.3 | 5.2 / 7.2 / 11.7 / 15.6 / 17.3 |

The capped gap correlates only weakly with the score (0.31 over every solved
candidate). What the knobs can reach, from 12 dates per piece and the first
candidate that certifies (easy: 4 walls, no decoys; plain: 7 walls, 2 decoys;
hard: 13 walls, 4 decoys, all guards, scattered targets):

| Piece | Gentle monsters: easy / plain / hard | Fiendish monsters: easy / plain / hard |
| --- | --- | --- |
| Pawn | 11.2 (67% fall back) / 13.1 / 14.1 | 25.0 (92% fall back) / 21.5 / 17.5 |
| Rook | 1.1 / 4.2 / 10.9 | all fall back / all fall back / 13.9 |
| Knight | 6.8 / 8.2 / 11.7 | 9.8 (58% fall back) / 13.5 (42% fall back) / 16.4 |
| Bishop | 7.8 / 11.0 / 11.2 | 10.6 (58% fall back) / 16.5 / 17.7 |
| Queen | 0.9 / 3.7 / 11.3 | all fall back / all fall back / 15.4 |

On Fiendish, easy rook and queen layouts fall in under three moves, so the
freebie rule sends them all to the bank. **The bands** for the bot on Auto
(replaced in stage 2, [below](#stage-2-bands)) rose by 3 a tier:
Gentle 5–8, Fair 8–11, Tricky 11–14, Tough 14–17, Fiendish 17–20. Gentle was
where rook, knight, bishop and queen layouts reach at their easiest; Fiendish
where the hardest reach (the Fiendish knobs then gave 16 to 17, and the
best of four candidates lifts that). A band is about two thirds of one
setting's day-to-day spread (sd 4.4; a date's four candidates differ by 2.9),
so the candidate choice matters. Under the score's knobs only 25% of days
fall inside these bands: the knobs must be recalibrated
([Calibration](#knobs-and-calibration)) before the bands mean anything.

### With a steered recruit

Par is to assume a steered recruit, as default Manual play does: the bot will
give its recruit orders through `humanPlayer`'s recruit hook (the policy is
`steerRecruit` in `scripts/recruit-policy.mjs` for now). Generation, the
calibration fit and `build-fallbacks` all call `humanPar` without a policy, so
they follow whatever default `src/human-bot.js` gives it; nothing here
hard-codes Auto. On 12 dates per tier and piece (889 candidates that
certify under the current knobs), the same routes with the recruit on Auto
and steered:

| Piece | Runs failed F1 / F2 / F3, Auto → steered | Capped gap, Auto → steered |
| --- | --- | --- |
| Pawn | 43→13% / 48→23% / 62→14% | 16.4 → 7.2 |
| Rook | 13→11% / 13→11% / 35→4% | 13.6 → 9.0 |
| Knight | 7→6% / 6→4% / 4→2% | 9.1 → 6.5 |
| Bishop | 7→5% / 11→8% / 71→4% | 12.5 → 7.5 |
| Queen | 12→9% / 10→6% / 7→7% | 10.8 → 9.0 |

By tier the gap falls from 7.4 / 10.9 / 14.0 / 15.0 / 16.7 to 3.4 / 6.6 / 9.1
/ 10.1 / 11.9, and the pieces close up (Fiendish 9.8 to 13.2). What the knobs
reach with the bot steering (first certified candidate, 12 dates):

| Piece | Gentle monsters: easy / plain / hard | Fiendish monsters: easy / plain / hard |
| --- | --- | --- |
| Pawn | 3.3 (67% fall back) / 3.5 / 7.7 | 12.8 (92% fall back) / 8.6 / 10.5 |
| Rook | 0.5 / 3.3 / 4.3 | all fall back / all fall back / 12.8 |
| Knight | 4.4 / 6.2 / 9.4 | 6.1 (58% fall back) / 10.6 (42% fall back) / 10.8 |
| Bishop | 2.3 / 2.8 / 7.2 | 8.0 (58% fall back) / 10.4 / 11.2 |
| Queen | 0.7 / 2.8 / 9.9 | all fall back / all fall back / 13.9 |

So when par steers, the bands must come down with it. A provisional set by
the same recipe: Gentle 2–4.5, Fair 4.5–7, Tricky 7–9.5, Tough 9.5–12,
Fiendish 12–14.5 (2.5 wide; one setting's day-to-day spread is 4.0). The
king floor fails about as often as floors 1 and 2 with a steered recruit, so
it can likely count in full (`GAP_FLOOR_WEIGHTS` [1, 1, 1]: steered gaps then
rise by 1 to 2.5), and pawns may no longer need to skip dominance. The
recruit rules coming before calibration (a king recruit on every king floor,
no capture on the turn a recruit joins, pawn recruits only on files open to
the far rank) will move the gap again, so measure once more after them and
before the shortlist, for example with `node scripts/measure-monsters.mjs`
(its mean gap per tier and piece) and a small `--fast` dry run like the one
below. The switch, in order:

1. Make the steering policy `humanPar`'s and `humanRun`'s default in
   `src/human-bot.js` (the result card replays `humanRun` with par's runs, so
   both must agree), bump `HUMAN_BOT_VERSION` and the rules version.
2. Land the recruit rule changes; measure as above.
3. Set the bands (and the king floor's weight) from that measurement.
4. Run the calibration and rebuild ([After a rules, monster, modifier,
   search or bot change](#after-a-rules-monster-modifier-search-or-bot-change)).

The calibration data's behaviour fingerprint (below) changes with the default
policy, so data measured with the bot on Auto is refused even if a version
bump is forgotten. All four steps are done; the measurement and the bands are
in [Stage 2 bands](#stage-2-bands).

### Stage 2 bands

Day targets and floor assembly ([Floor assembly](#floor-assembly)) replaced
these bands as what generation aims at; the measurements are kept as the
record of where the range of the targets comes from.

Measured 2026-11-07 under the stage 2 rules: par's steered recruit (the bot
steps onto a relic that blocks its pawn's file), a king recruit on every king
floor, no capture on the turn a recruit joins, pawn recruits only on open
files, rules version 7. Twelve dates per piece from 2026-11-07 (half plain, a
quarter each ice and collapse), the same dates under every tier's monsters,
and each date's first candidate generation would accept (solved, the threat
minimum, no freebie floor on Tricky and up), bands ignored. Capped gap with
every floor in full; in brackets, the share of days with no acceptable
candidate (the fallback bank):

| Piece | Gentle: easy / plain / hard / live knobs | Fiendish: easy / plain / hard / live knobs |
| --- | --- | --- |
| Pawn | 0.6 (92%) / 2.7 / 10.4 / 2.6 (33%) | all fall back / 8.1 (8%) / 12.9 / 9.9 (8%) |
| Rook | 0.3 / 3.3 / 8.6 / 6.3 | all fall back / all fall back / 14.8 (8%) / 15.1 |
| Knight | 4.4 / 8.4 / 11.5 / 1.9 | 9.3 (67%) / 16.3 (50%) / 13.9 / 12.4 (8%) |
| Bishop | 4.0 / 5.5 / 10.1 / 4.9 | 8.5 (67%) / 12.7 (33%) / 14.1 (8%) / 14.1 (8%) |
| Queen | 0.6 / 4.2 / 8.7 / 9.0 | all fall back / all fall back / 14.1 (8%) / 14.0 (8%) |

The live knobs (still fitted to the Auto bands) average 4.9 / 7.5 / 9.7 /
11.3 / 13.1 by tier, Gentle to Fiendish (3.7 / 6.0 / 8.0 / 10.0 / 11.1 with
the king floor at half). With them the bot fails 0 to 18% of king-floor runs
(rook 2 to 18%, pawn 0 to 12%, the others 0 to 5%), as on floors 1 and 2
(0 to 27%), so the king floor now counts in full. Easy layouts reach a gap
under 1 for a rook or queen but about 4 for a bishop, and fall back on
Tricky and up (a floor in under three moves). The hardest layouts reach 13 to
15 on Fiendish, a pawn's 13.

**The bands** rise by 2.5 a tier: Gentle 2.5–5, Fair 5–7.5, Tricky 7.5–10,
Tough 10–12.5, Fiendish 12.5–15. Gentle starts where the easiest bishop and
plain pawn layouts sit; Fiendish ends where the hardest layouts reach, and
the choice among four candidates lifts a pawn's 13 into it. As before, a band
is about two thirds of one setting's day-to-day spread.

**The fit.** Brute force on 2026-11-08 (every setting of the full grid under
every tier's monsters, ten dates per piece, four candidates each: 146,400
searches in 64 minutes on seven workers, with the 3.3× search speedup) put
every (tier, piece) mean inside its band but Tricky pawn (7.2), and no
calibration day fell back:

| Tier | Band | Piece means | Days in band |
| --- | --- | --- | --- |
| Gentle | 2.5–5 | 3.5–3.8 | 80–100% |
| Fair | 5–7.5 | 5.7–6.5 | 40–90% |
| Tricky | 7.5–10 | 7.2–9.4 | 40–80% |
| Tough | 10–12.5 | 10.6–11.7 | 70–80% |
| Fiendish | 12.5–15 | 12.9–14.7 | 60–80% |

**The score** (for reference). Every certified edition also gets one number
from its certificate's verifier metrics and its piece (`difficultyScore`). It
says how dangerous the certified route was; it no longer picks candidates, but
it is stored on the certificate (`generation.certificate.score`) and reported
beside the gap by calibration and the measurement scripts:

    pressure = threatenedDecisions + 2 × narrowEscapes + turns / 4 + 20 × unsafeShare
    score    = pressure / √(lives left at the end of the route)

Threatened decisions are moves made while a committed attack lane is on the
board, narrow escapes are moves with exactly one safe option, `turns / 4`
charges for route length, and `unsafeShare` is the fraction of legal
alternatives along the route that would have lost a life. Lives left are the
piece's lives (pawn 8, rook/knight/bishop 2, queen 1) minus those the route
spent: spare lives forgive mistakes, with diminishing returns. Without that
divisor a pawn's long, life-spending route always out-scores a queen day that
ends at the first slip. The score's bands were 9–10.5, 10.5–12, 12–13.5,
13.5–15 and 15–16.5.

### Knobs and calibration

**Knobs.** Generation reads a row of knobs per (tier, piece) from the
generated table `src/calibration.js`:

- `obstacleBase`: walls on the first floor; each later floor adds one. More
  walls hinder a rook and shelter a knight.
- `decoys` (1–4, usually 2): residents beside each floor's targets, never
  fewer than `MIN_DECOYS`. The calibration grid no longer measures none, and
  `knobsFor` raises a table row that has none: the last fit gave Gentle knight
  and Fair queen days no decoys (36 of the 739 editions from 2026-11-01),
  which now get one.
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
searches every candidate layout generation may try (sixteen) of ten dates per
piece under a grid of knob settings, with the runtime search budget, in
parallel workers, and plays the human-like bot on every solved route, exactly
as generation does before it assembles the day. It then replays the floor
assembly (`rankFloors`, aimed at the tier's mean target: Tough's lies between
Thursday's and Friday's) for every tier, setting and threat minimum, and keeps
the cheapest setting per (tier, piece): distance outside the tier's band,
days outside it, and fallbacks (ten times as costly as a missed day, since
they repeat a layout) all cost. An exact tie goes to the plainer setting
(fewest screens, walls, decoys, then scatter and guards), never to whichever
was measured first, so two runs with the same rows pick the same table. Its rows keep no per-floor move or life
counts, so the replay counts each floor's scored moves toward the route's cap
and leaves a pawn's allowance of lives to generation's own certification.
With sixteen candidates a date and forty bot runs a floor, measuring from
scratch costs roughly eight times what it did with four candidates and five
runs; the incremental run (below) measures again only what a change touches. Search time no longer counts by
default, because editions are certified at build time
(`scripts/build-editions.mjs`); `--time-weight 1` restores the old penalty on
searches over 1.5 times as slow as the piece's plain layout. It writes
`src/calibration.js` (the table plus `CALIBRATION_REPORT`, the measured gaps
behind it with the mean score beside them) and
`scripts/calibration-data.json`: one row per search with its status (`solved`,
`unknown` when the budget ran out, or `invalid` when replay rejected the route),
solver expansions, route moves, wall time (search and bot), the metrics, the
bot's runs per floor (`human`: each run's moves, `null` where it failed), the
route (`route`, `src/route-code.js`) and every floor's search (`searches`, below),
plus min/median/p90/max summaries per piece and knob setting and a fingerprint
per class (git-ignored: a full run's file is about 400 MB, so it stays on
the machine that measured it). The next run reuses that file and measures
again only what a change touches ([Incremental
calibration](#incremental-calibration)); `--full` measures everything.
`--reuse` refits from that file without searching at all (after editing the
measure, its cap and weights, or the bands), `--merge` also keeps the file's
settings and dates outside this run's grid, `--pieces`, `--obstacles` and
`--grid quick` narrow the grid (rows of pieces a run leaves out stay in the
file as they were), and `--dry-run` leaves the table alone. A brute-force run
uses every core but one (`--jobs N` overrides). From scratch, with sixteen
candidates and 40 bot runs per floor, it is 556,800 searches at about 0.15
CPU seconds each (sampled on an idle machine: 0.14 for a non-pawn day, 0.24
for a pawn day), so roughly three to four hours on seven workers.

**Size and memory.** The data file is written and read a row at a time
(`writeDataFile`, `readDataFile` in `scripts/calibration-search.mjs`), so it
can grow past the longest string Node allows (about 512 MB); a write goes to
a temporary file and replaces the old one only once complete. It is still
one JSON object, a line per class and per row. Every row stays in memory for
the fit, about 2 KB each, and a run that reuses the last data lets each old
row go once its task is measured again, so the old and new rows are never
all in memory together. A synthetic file the size of 20 dates per piece
(1.1 million rows, 828 MB) wrote in 3 s and read back in 4 s, byte for byte;
holding its rows the way an incremental run does peaked at 2.9 GB of Node's
default 4 GB heap, and `--reuse` refitted from it in that heap too (3.5 GB
resident). The npm scripts give Node 8 GB anyway, and the script warns
before a run whose rows would crowd the heap, with the
`--max-old-space-size` to use.

Monsters grow smarter with the tier, so every setting is measured once per
tier, with that tier's monsters, and competes only for that tier: five times
the searches of a shared measurement (shortlist screening and dominance work
per tier too). Setting keys end in `@tier`. Rows keep the route's `floorMoves`,
so the fit applies the no-freebie-floor rule as generation does, and the
route's side of the gap.

Data files are stamped (`dataVersion` 3, `attempts`, `searchBudget`, plus
`rulesVersion` and `humanBotVersion` for the record;
`scripts/calibration-search.mjs`). A file of another data version, candidate
count or budget is never reused: the next brute-force run measures everything,
and `--reuse`, `--replay` and `--confirm` refuse it. Within a file, the class
fingerprints decide what still holds (next section): `--reuse`, `--replay` and
`--confirm` refuse a file any class of which plays differently now, whatever
the version numbers say, and a brute-force run measures those classes again.

### Incremental calibration

A brute-force run reuses the last run's `scripts/calibration-data.json` and
measures again only the days and floors a change touches. Search is
deterministic and every floor's search starts from a position the floors before
it fix, so what a row needs is known exactly:

- **What a row keeps.** Its route, and every floor's search in the order the
  search ran them (`searches`: the floor, the lives it had to keep, the
  expansions it used, a digest of its start position and its route segment, or
  `null` when it failed). A pawn day may search a floor again keeping more
  lives, so a row can hold more than three. The digest covers the whole
  position but its words, events and version stamps, so a version bump alone
  changes nothing.
- **Classes.** One per player piece × room modifier × floor × tier (5 × 3 × 3 ×
  5 = 225): the tier sets how smart the monsters are. Each class has two
  fingerprints, made from up to 24 probe rows picked among its rows in a fixed
  pseudo-random order, each played from its start of the floor (rebuilt from
  its stored segments under the rules of the day). The **search** fingerprint
  hashes each probe's start and seeded random walks from it, 2,000 transitions
  in walks of up to 40 steps, hashing every action the search could take at
  each step (what each monster does in reply), plus, for the first four
  probes, the floor's own search (`findFloorRoute`, 3,000 expansions): it
  changes with the rules, the monsters, the modifier and the search on that
  floor. The walks carry it: a search usually finds the same route after a
  small monster change (tuning the royal king's step weights changed the
  search result of 0 to 1 of 24 pawn floor-3 probes, but walks of about 1,200
  transitions caught it in 7 to 11 of them). The **bot** fingerprint hashes
  every probe's start and the bot's seeded runs there (`HUMAN_RUNS` of them),
  with par's seeds and recruit policy: it changes with the bot and with the
  rules it plays. A
  changed start (the layout, or what the floors before it do) changes both.
  The run fingerprints every stored class again with today's code (about
  two seconds a class, a minute or two on seven workers) and compares. Each class also keeps a
  hash of the bot's own code (`src/human-bot.js`, `src/recruit-policy.js`):
  when that is unchanged and the class's bot fingerprint changed anyway, the
  rules changed there, so the floor is searched again too.
- **Searches.** Every row is searched again through `findWinningRoute`'s
  `floorSearch` hook, which stands in for a stored floor search wherever the
  same floor is searched from the same start digest, keeping the same lives,
  after the same expansions, and the floor's search fingerprint held: it
  replays the stored segment through the route rules instead (and searches if
  that no longer replays). Every other floor search runs. So a change to floor
  3 alone searches floor 3 alone, from the start the stored route reaches, with
  the budget floors 1 and 2 left, which is exactly what the full search does
  there; if that search fails on a pawn day, the full search's own logic goes
  back to floor 2 keeping more lives, and those searches run too. A floor whose
  search result changed changes the next floor's start, so that floor is
  searched too.
- **Bot runs.** A floor's bot runs are kept when its class's search and bot
  fingerprints both held and the route reaches the floor in the same position;
  otherwise they are played again from the route's start of that floor, as
  `humanPar` plays them. A bot-only change re-runs the bot on the floors whose
  bot fingerprint changed and searches nothing.
- **Checks.** Every reused route must verify to its stored metrics (the same
  verification generation runs). On every kept floor one of its runs is
  played again and must match. A random sample of the rows that reuse anything
  (`--sample`, 1% by default, at least one per piece, modifier and tier;
  `--sample-seed` repeats one) is also measured from scratch and must match
  field for field. A failed route or sample check measures that row's whole
  group (piece, modifier, tier) from scratch; a failed bot run searches and
  plays that class's floor again for every row (the bot or the rules changed
  there unseen).
- **Report.** The run prints, by class, the floor searches served and searched
  again and the bot floors kept and played again, with the reason (rules or
  search changed, bot runs changed with the bot's code unchanged, bot changed,
  a check failed, new rows, or another floor of the row changed), then the
  checks' counts. A row whose every search was served keeps its stored wall
  time; any other row's `ms` is this run's work on it.

**Checked against full runs.** On 2026-11-08, with four candidates and five
bot runs per floor (before floor assembly), all five pieces, the full grid and
three dates per piece from 2027-08-22 (43,920 searches; pawn, rook,
bishop and queen days there meet all three room modifiers), every incremental
run below gave the same rows (every field but `ms`), class fingerprints, table
and report as a `--full` run of the same code. Seven workers on a busy machine
(load 10 to 70); the full runs took 1,392 to 2,249 s.

| Change | Measured again | Incremental |
|---|---|---|
| None | nothing: 195 classes reused whole | 229 s |
| Bot only: floors 1 and 2's recruit taken a little more often (`styleFor`, 0.8 → 0.9) | the bot on floors 1 and 2 of 105 classes; one class's bot fingerprint missed the change, its spot checks caught it (8 runs), and that floor was searched again | 312 s |
| Pawn days only: the lunge rule of 8beebf0 reverted | all 45 pawn classes; the 150 others reused whole | 543 s |
| The lunge rule re-applied, from the reverted run's data (against the base run) | the 45 pawn classes again | 331 s |
| Floor 3 only: the royal king's step weights (`moveKing`, 0.8 → 0.7) | floor 3 of all 65 floor-3 classes, from the stored routes' starts with what floors 1 and 2 left; a few pawn rows' earlier floors when the new floor 3 sent the search back for more lives | 472 s |

Undoing the bot change from the bot run's data (302 s) matched the base run as
well, and on a small run (pawn and knight, quick grid, two dates) so did every
change above. There, before every probe walked, the floor-3 change slipped
past three pawn classes and left 5 of 1,200 rows as the old rules had measured
them.

Probes can miss a change that none of them meets; the checks are there for
that. A change that alters a row's own route shows in its verification, a
change to the bot or to the rules it plays shows in the spot checks, and the
sample bounds what is left. A change rare enough to slip past all of them can
still leave a few rows as the old code measured them, so after a change whose
reach you doubt, or before a table you mean to keep for long, `--full` is the
reference. After a change that touches every class (a search heuristic, a
state field every position carries), the run is about as slow as `--full`,
plus the fingerprints.

### Shortlist, then confirm (the quick way)

Two commands replace the three-hour run with about half an hour: screening,
then a targeted full check:

```sh
npm run calibrate:shortlist   # 20-27 min; writes scripts/calibration-shortlist.json only
npm run calibrate:confirm     # 5-9 min, full-budget check of the shortlist; writes src/calibration.js
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
  the stage-1 gaps (each date's first solved candidate); its
  `--surrogate-keep` (3) best predictions per tier also advance, which guards
  against one unlucky date (`--no-surrogate`);
- monotone dominance: the gap mostly rises with obstacles, decoys, guards and
  screens, so a setting at least as hard as one already `--dominance-margin`
  (two band widths, 5 with the stage 2 bands: one date's gap scatters by about
  5) above the tier's band, or at most as hard as one that far below it, is
  dropped (same scatter only; never by its own mean; never for pawns, whose
  gap can fall as decoys rise; `--no-dominance`). A setting's screened gap is
  each date's first candidate generation could keep, so on Tricky and up a
  candidate with a floor under three moves (and a tiny gap) doesn't count;
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

**Under the stage 2 rules the shortlist screens poorly; calibrate by brute
force.** One date's four candidates for one setting can measure anywhere from
0 to 24 (Tricky rook on 2026-11-13: 18.4, 19.4, 8.8 and 12.6 for 7 walls, 4
decoys, scattered, 2 guards), so a single screening date can show an easy
setting far above the band and a hard one far below it. Dominance then
dropped 177 of the 184 Tricky rook settings, and the shortlist left Tricky,
Tough and Fiendish rook, knight and queen days only the plain layout, which
falls back on most of them.

Why not trust the shortlist on its own: on 2026-11-07, with the score bands, a
full `--fast` refit (3.5 minutes) scored worse than the brute-force table on
the same ten dates.

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

### Recalibrating for the capped gap: dry run and runtime

The table in `src/calibration.js` was fitted to the score bands, with two
candidates and the whole-run search, so it needs the commands below once
(they are the same as after any rules change). Dry run on 2026-11-07, all
five pieces, `--grid quick --obstacles 4,13` (41 settings per tier, 21 for
pawns), 4 dates per piece, data to a scratch file and `--dry-run`:

```sh
node scripts/calibrate-difficulty.mjs --fast --samples 4 --stage2-dates 2 --grid quick --obstacles 4,13 --data /tmp/shortlist.json
node scripts/calibrate-difficulty.mjs --confirm /tmp/shortlist.json --dry-run --data /tmp/data.json
```

The shortlist screened 925 settings (stage 1: 3,700 searches), kept 152 for
stage 2 and 90 for the finals, 5,276 searches in 18 minutes on six workers;
the confirm measured 115 settings on every date, 1,840 searches in 3 minutes.
Both ran beside other jobs (load average 10 to 40), which about doubled the
time per search. Its fit put every (tier, piece) mean inside its band but
Tricky pawn (14.2) and Tricky knight (9.9); tier by tier the pieces' means
spanned 6.1–8, 9.2–10.5, 9.9–14.2, 15.4–16.5 and 17.2–19.5. Four dates per
piece flatter a fit, so expect wider spreads from the real run.

Single-threaded, a search with its bot runs costs about 1.04 CPU seconds for a
pawn, 0.62 for a queen, 0.29 for a bishop, 0.21 for a rook and 0.15 for a
knight, sampled over the full grid. The full shortlist searches at most
20,640 candidates (stage 1: every one of the 3,660 settings on one date,
14,640 searches; stage 2: at most 10 settings per tier and piece on 4 dates;
finals: at most 4 per tier and piece on the last 5) and the confirm at most
6,000 (about 30 settings per piece on 10 dates): about 10,000 to 11,000 CPU
seconds, or 25 to 35 minutes on seven workers of an idle 8-core M2
(shortlist 20 to 27, confirm 5 to 9). Brute force (146,400 searches) is about
57,000 CPU seconds, three hours.

### After a rules, monster, modifier, search or bot change

Monster AI, room modifiers, rules, search and human-like bot changes all shift
difficulty. After any of them:

```sh
npm run calibrate:difficulty         # brute force, measuring again only what changed
node scripts/build-fallbacks.mjs     # rebuild the bank for the new knobs
npm run verify:fallbacks
npm run build:editions -- --full     # re-certify every stored day under the new knobs
npm test
```

The shortlist and confirm pair (`npm run calibrate:shortlist`, then
`npm run calibrate:confirm`) is quicker, but under the stage 2 rules its
one-date screen is too noisy to trust ([Shortlist, then
confirm](#shortlist-then-confirm-the-quick-way)).
`verify:fallbacks` fails if a fallback was built for knobs the table no longer
holds. The script warns when a (tier, piece) mean gap misses its band; then
widen the grid, add a knob, or move the bands. Afterwards
`node scripts/measure-monsters.mjs` and `node scripts/measure-human-par.mjs`
show the fallback share and the gaps generation actually produces.

## Measuring the monsters

`node scripts/measure-monsters.mjs` prices the no-freebie-floor rule, rule by
rule. For 16 real dates per (tier, piece) (`--samples`), half plain and a
quarter each ice and collapse, it searches every candidate generation may try
(sixteen; `--attempts`) with the current knobs, the tier's monsters and the
production search, then replays the floor assembly (`rankFloors`, aimed at
each date's target) under each rule: every floor
at least 3 moves (adopted), every floor at least 4, floor 1 at least 4, and
none (Gentle and Fair have no rule under any of them). It prints the fallback
share per rule by tier, the adopted rule first, plus the adopted rule with only
the first two candidates; then per tier and per tier and piece how often each
candidate certifies, the route's moves per floor, the capped human gap
of the assembled day, the score and search time.
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

## Measuring the recruits

Every certificate plays its recruit on Auto, which never takes a target, and
uses only the king floor's recruit. Manual recruit control, the default, can
do more: every floor's recruit may join, and an ordered recruit may take any
monster, the king included. Tooling can search that way:
`findWinningRoute(state, { recruit: 'steer' })` (also `searchCandidate`, and
`findFloorRoute` for one floor alone) lets every floor's recruit join and
tries, with each move or wait, Auto's own recruit move plus at most three
orders (`RECRUIT_ORDERS`): every capture of a target, a step into a wound-up
lane between its monster and the player, the step that brings the recruit
nearest a target over the walls, and holding still where it already blocks
such a lane; on the bishop pair's hop, the hop squares nearest a target. The
squares come from `recruitChoice`, so the move that clears a floor, after
which the recruit hunts on its own, takes no order. Each order tried spends one
transition of the same fixed budget. `verifyWinningRoute(state, actions,
{ recruit: 'steer' })` accepts the orders and adds `metrics.recruit`;
`everyRecruit: true` lets floors 1 and 2's recruits join on Auto. Generation
passes neither, so shipped certificates are unchanged, and route codes carry
no orders.

`node scripts/measure-recruits.mjs` measures what that changes
(`--parts cert,floors,placement,static`):

- `cert`: every candidate of 24 dates per (tier, piece), modifiers represented,
  searched on Auto and steered, with the choice replayed for each (whole days
  only, since the study measures each candidate as a whole); every
  floor also searched alone, steered (3,000 transitions), for a clear in under
  three moves: a freebie floor for a Manual player that the Auto certificate
  never sees.
- `floors`: 12 of those dates per (tier, piece), first candidate, every floor
  from its start with full lives, its recruit swapped for each piece in turn
  (same square) and once removed; the floor searched alone (6,000 transitions)
  on Auto and steered, and the human-like bot's five runs on Auto and with a
  steering policy (`src/recruit-policy.js`, now the bot's default: keep
  blocking a red lane, take a target, take a decoy, else close in on the
  nearest target).
- `placement`: two placement rules priced on the same floors, by moving the
  recruit to the first square generation could have drawn that keeps them.
- `static`: on every candidate, which recruits would take a target on the turn
  they join (the waiting recruit already attacks one), and which pawn recruits
  face a walled file.

First run, 2026-11-07, stage-2 rules before recalibration: the defaults (600
dates, 2,400 candidates; 20 minutes on seven workers of a shared machine), then
`--parts placement,static` (under a minute):

| Tier | Fallback, Auto / steered | Without the freebie rule | Auto days with a steered freebie floor (king floor) | Auto, also rejecting those | Steered days with no Auto route |
| --- | --- | --- | --- | --- | --- |
| Gentle | 3% / 0% | 3% / 0% | 62% (22%) | 3% | 17% |
| Fair | 1% / 0% | 1% / 0% | 34% (17%) | 1% | 10% |
| Tricky | 17% / 18% | 3% / 2% | 21% (15%) | 20% | 24% |
| Tough | 12% / 9% | 2% / 0% | 16% (10%) | 13% | 17% |
| Fiendish | 8% / 13% | 0% / 0% | 15% (5%) | 15% | 14% |
| Tricky to Fiendish | 12% / 13% | 2% / 1% | 17% (10%) | 16% | 18% |

- Steering certifies almost everything (98.5% of candidates against 83.8% on
  Auto), but it clears floors faster (5.3/5.4/4.7 moves per floor against
  6.9/7.1/8.0), so the freebie rule rejects as many candidates as it rescues:
  the fallback share stays where it is. Without the rule, Auto already leaves
  only 2% of Tricky-and-up days to the bank. The bank's share is the freebie
  rule's, not the smarter monsters'.
- A steered certificate leans on its recruit: 99% of them take a target with it,
  and 0.2% still win with their orders left out. On 16% of days (pawns 31%)
  the layout it picks has no Auto route within the budget.
- On today's Auto days a Manual player can steer a recruit to clear a floor in
  under three moves on 17% of Tricky-and-up days: the king floor on 10% (in a
  single move on 3%: a queen or rook recruit takes the king the turn it joins,
  since monsters never avoid a waiting recruit's lines), floors 1 and 2 on
  3–4%. Rejecting those layouts too costs 4 points of fallbacks on Tricky and
  up (12% → 16%), 1 point for the king floor alone.
- The waiting recruit attacks a target as the floor starts on 14% of floors 1
  and 2 and 7% of king floors (a queen recruit on 31% and 13%). Of the king
  floors a steered recruit clears in under three moves, 95% take the king as
  the recruit joins, but only a third had that line at the start. Moving the
  recruit off such lines cuts those floors' quick clears from 75% to 25%.

The recruit matching, with the bot's runs won (none / Auto / steered):

| Player | Floors 1–2, no recruit | Floors 1–2, best and worst recruit, steered | King floor: rook / queen / king, Auto | Steered | King floor, steered clear in <3: rook / queen / king | Bishop recruit on the king floor, Auto / steered |
| --- | --- | --- | --- | --- | --- | --- |
| Pawn | 54% | king 89%, bishop 67% | 24 / 39 / 45% | 77 / 74 / 88% | 0 / 43 / 0% | 21 / 29% |
| Rook | 74% | queen 89%, pawn 81% | 55 / 67 / 85% | 98 / 98 / 99% | 22 / 40 / 0% | 2 / 63% |
| Knight | 85% | queen 95%, pawn 91% | 95 / 95 / 95% | 95 / 95 / 95% | 8 / 18 / 2% | 92 / 92% |
| Bishop | 75% | queen 95%, bishop 84% | 16 / 31 / 42% | 91 / 96 / 96% | 15 / 27 / 0% | 6 / 67% |
| Queen | 80% | queen 92%, pawn 86% | 79 / 95 / 99% | 88 / 94 / 99% | 25 / 47 / 0% | 47 / 57% |

- On floors 1 and 2 a recruit on Auto adds little (at most 4 moves of the
  bot's expected 15–26); steered, every recruit helps, the queen and king most. A
  pawn player's pawn recruit, which waits on its own file, is the one harmful
  pairing, on Auto (runs won 54% → 47%). A bishop recruit joining a bishop hops
  (on every steered run that recruits it) and still adds the least of the
  non-pawn recruits (2.9 moves steered, against 5.5 to 8).
- The king floor needs its recruit except on knight days (no recruit: the
  solver certifies 2% of rook and bishop king floors, the bot wins none). The
  king recruit is the strongest on Auto for every piece, certifies 99% of
  king floors on Auto, and all but never (0.3%) makes a quick steered clear;
  the queen makes the most (35% of king floors). A rook recruit certifies 72%
  of bishop days' king floors on Auto. A bishop recruit there would certify 33%
  (the bot: 6%).
- Steering is worth most on the king floor: the bot's runs won rise from 65%
  to 92% and its expected moves fall from 22 to 12. Par, measured with the
  recruit on Auto, would fall from 10/9/11 to 7/8/8 (median per floor) with
  the steering policy.
- A pawn recruit finds its file walled before the far rank on 48% of floor 1
  and 2 recruit squares (0% for a pawn player, whose recruit waits on its own
  open file; 53–64% for every other piece), though 1% only can't reach it even
  taking diagonally. Walled, it promotes in 10% of steered runs and saves 1.6
  moves; open, 52% and 6 moves. Moving a walled one to an open-file square
  generation could have drawn (possible for 76% of them) takes the bot from 85%
  to 91% of runs won.

### What was adopted

The owner kept the Auto option, and certificates stay on Auto. Four changes
followed the study (the king floor's bishop pair was not adopted):

- **The king floor always recruits a king** (`KING_FLOOR_RECRUITS` in
  `src/rules.js`). Its stream still spends one draw on the piece, so the
  recruit waits on the square it always did; a rook player can castle with it.
- **A recruit can't capture on the turn it joins**, on Manual or Auto
  (`companionTurn`): `recruitChoice` offers only quiet squares that turn, so
  an order to capture is no action, and Auto picks a quiet move. Holding, the
  bishop pair's hop (which never captures) and a cleared floor's hunting stay
  as they were; castling needs the recruit beside you before you move, so it
  never falls on the joining move.
- **A pawn recruit waits only on a file with no wall between it and the far
  rank**, as the player's promotion file is kept. Drawn on a walled file, it
  takes one more draw from its own stream: a square among the same ones (one
  move from the start) whose file is open, or, with none, another piece on the
  square drawn. Over 365 dates × 4 candidates × 3 floors, walls, monsters,
  coins and powerups never moved: 220 of 470 pawn recruits were on walled
  files, 182 moved and 38 became another piece, and 36 ice-day floors had
  their ice laid differently around the moved recruit (ice avoids pickups).
- **Par assumes a steered recruit**: the human-like bot steers by default
  (see [Par and the human gap](#par-and-the-human-gap)).

Before and after, on 800 candidate layouts (8 dates per tier and piece × 4
candidates), each floor searched alone from its start (3,000 transitions),
steered and on Auto as a certificate plays it: "Manual only" counts floors a
steered recruit clears in under three moves where the Auto search does not.
This counts every layout, not only those an Auto certificate picks, so it runs
higher than the "Auto days" column above.

| | Before | After |
| --- | --- | --- |
| Steered clear in <3, F1 / F2 / king floor | 15.3% / 15.6% / 16.8% | 14.1% / 12.9% / 0.4% |
| King floor in a single steered move | 4.9% | 0% |
| Manual only, F1 / F2 / king floor | 3.5% / 5.9% / 16.8% | 2.5% / 3.0% / 0.3% |
| Manual only, any floor (Tricky and up) | 23.6% (21.7%) | 5.4% (2.9%) |
| Quick steered clears taking a target as the recruit joins | 45% | 0% |
| King floor solved, Auto / steered (queen days steered) | 93% / 97% (89%) | 98% / 95% (73%) |

The king recruit makes the king floor easier to certify on Auto (bishop days
80% → 96%), while the steered search, which spends its small budget on
orders, solves fewer queen days' king floors. Recalibration will move all of
these.

## Difficulty and chess learning

Certificates record route length, positioning moves, capture opportunities,
promotion, warning-lane decisions, and immediately unsafe alternative moves.
They support tuning for anticipating attack lanes, using a piece's mobility,
choosing captures, and advancing a pawn to promotion. These are measurements of
one successful route. They do **not** establish shortest solution length, forced
tactics, a unique solution, or a minimum difficulty. In particular, the presence
of a warned lane does not imply that it threatens the player's current square.
Human playtesting is still needed to check the capped human gap, the score and
the tiers against real play: the human-like bot is a model of a player, with
blind spots of its own.
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

Any change to gameplay, generation, search budgets/order, calibration, the
human-like bot (whose gap now picks each day's floors), the day targets, or
fallback selection can change an edition. Bump the generator/rules version and save-key version
together for such a release; `HUMAN_BOT_VERSION` alone only recomputes
remembered pars. Candidate layouts after the first are seeded by
`LAYOUT_SEED_VERSION` (src/generation.js), not the rules version, so a bump
keeps every day's layout unless the new rules make its stored route fail. Version 5 archives earlier saved editions
in backups instead of interpreting their old layouts as certified new games.
