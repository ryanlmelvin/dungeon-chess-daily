# Puzzle-first idea

Every floor should be a short puzzle: a few moves, one clever idea, and a
solution that is certain to exist. No floor should turn into a chase, a siege
or a trade of lives. This idea also aims to end hours-long calibration, by
building floors around their solutions instead of searching random rooms and
tuning knobs until the numbers land. Floors could be composed (the composer,
below) or taken from lichess's puzzles ([Lichess puzzles](#lichess-puzzles)).

Status: written 2026-11-09 as an idea, with lichess measurements added the
same day. Phases 0 to 3 are built: the composer, the scoring rules, coverage
of every daily piece, target role and modifier, and the switch (2026-11-11):
every edition is now composed, the whole archive rebuilt, and the calibrated
generator retired. [Generation and fairness](generation.md) describes what
ships; this document keeps how it came about.

## What we measured

Measured with the human-like bot's 40 runs per floor on the stored editions
(rules v10), over about six months of dates from November 2026:

- **Slog floors are easy to spot.** Over 12 weeks from 2026-11-09, a quarter
  of Tough and Fiendish floors average 4 or more moves over par. Their runs spend twice the stalled moves
  (moves that neither capture nor close in on a target): 4.5 per run, against
  2.2 elsewhere. They also lose about one life per run.
- **The yardstick rewards slogs.** The weekly ramp aims at the capped human
  gap, which counts the careful bot's extra moves. A chase or siege racks up
  extra moves, so weekend generation selects for exactly the floors we don't
  want.
- **Short puzzles exist, and they are the hard ones.** On Fiendish, careful
  play misses par + 4 on 22% of runs on floors whose certified route is 5 moves
  or fewer, against 17% on longer floors. About 35% of Fiendish floors are that
  short today. On Gentle the short floors are easy (2%).
- **Stubborn monsters don't help.** A variant where targets hold their ground
  near their start made Fiendish floors longer: the bot's mean rose from 11.3
  to 13.7 moves and stalled moves from 3.6 to 5.1 per run. It turns chases into
  sieges.
- **Counting copies names the target.** All targets are one species, so the
  only species with the target's count usually is the target: 55–61% of rook,
  knight and bishop floors, and every pawn floor. That makes the headline and
  suspects mostly moot.
- **Par sits flat late in the week.** Day par totals run Mon 16.5, Tue 19.2,
  Wed 21.2, Thu 23.6, Fri 23.9, Sat 23.3 and Sun 24.5, while the bot's mean
  moves (failed runs counted as 40) climb from 19 to 37.
- **Missing par + 4 ramps cleanly where par doesn't:** 5%, 6%, 11%, 14% and
  19% of careful runs from Gentle to Fiendish.
- **Lives are cheap to score.** Counting each lost life as one move raises
  par only about 0.2 to 0.4 per floor.

## Decisions so far

| Item | Status |
| --- | --- |
| Build every floor around a short planted solution (par about 5) | Agreed |
| Difficulty comes from how hidden the key move is, not from extra moves | Agreed |
| No lives: each capture adds 1 move to that floor's score (no new share symbol) | Built (phase 1) |
| Fix the count giveaway: the other suspect has as many copies as the target | Agreed |
| The paper pictures only each floor's target, with no suspect lineup | Built (2026-11-10). Composed rooms keep the count rule above |
| The king floor's king ignores frost | Built (phase 1) |
| No knight-against-knight standoffs; Gentle knights are brave if tiers stay | Agreed |
| Tighter rooms: no open boards a target can flee across | Agreed |
| Generation fast enough that calibration is no longer a step | Agreed (goal) |
| A clock on every floor (the ceiling holds par + 4 moves) | Maybe |
| The weekly difficulty ramp | Dropped while we build the composer: each day climbs from floor 1 to the king floor instead |
| Recruits traded away when they capture on a guarded square | Dropped: recruits are never lost |
| Floors taken from lichess puzzles (CC0) | King floors at scale, with chess king rules (two agreed, 2026-11-10); floors 1 and 2 only for some themes (see [Lichess puzzles](#lichess-puzzles)) |
| Kings never stand side by side (king rule 3) | Dropped after play (2026-11-09): it kept the recruit king from cornering a king that slipped its net, so the chase never ended |
| One monster reply per turn, as in chess | Rejected: every piece on both sides moves every turn |
| Composed floors start on varied squares (b2–g2, d1 or e1), each floor its own | Built in the preview (2026-11-09): a player meets a king-floor route from their last 8 days of that piece on 10–18% of days, against 61–68% from e2 |
| A pawn target on a composed floor is two pawns | Chosen after playing one and two (2026-11-10): the count rule allows at most two, and two gave longer, more forced lines |
| Pawn players' floors 1–2: tempo lines (quiet moves time the diagonal takes), and crown lines (promote within the line) where a tempo line would leave nothing to hint at | Chosen after playing both (2026-11-10): crown is the more obvious, so it takes about a quarter of floors |
| Pawn players' king floor: a mix of mates by the recruit king without promotion, by the promoted queen with the recruit's help, and by the queen alone; whichever is planted, the pawn can always walk up its file and promote | Chosen after playing each (2026-11-10): about 48%, 29% and 23% |
| Ice days: where it fits, the line skids onto its key square, and that square is ice too, so only the skid stops there | Chosen after play (2026-11-10), over a skid onto a plain square or ice off the line. A skid plays as its own slow, teetering slide, and every ice tile wears a snowflake |
| Floor 1's hint can be a sleeping decoy on the key square, looking just like the floor's other sleepers | Kept after play (2026-11-10): working out which sleeper is the hint is part of the challenge |
| Pawn floors where a target pawn waits on your pawn's file (frozen there until you take elsewhere; it sets up en passant) | Kept (2026-11-10). On composed days a pawn walled in under such a pawn is cornered at once, since that pawn can never move away |
| Par is the planted line + 1 | Agreed (2026-11-10), after playing composed floors with it |
| One monster ruleset for every day: Fair | Agreed (2026-11-10). Practice offers all five tiers: built, a Monsters choice in the practice menu |
| King-floor rules: checkmate wins, and the king can't take a piece the recruit king guards | Agreed (2026-11-10), after playing them in the preview |
| Every edition composed, the archive from 2026-11-01 rebuilt, calibration and the weekday tiers retired | Built (phase 3, 2026-11-11) |
| A date past the stored window borrows a stored day of its own piece and modifier, so the composer stays out of the app | Chosen (2026-11-11) over composing on the phone |
| The paper's rule line names the edition ("EDITION NO. 14"), not a difficulty | Chosen (2026-11-11): every day plays Fair |

## Lichess puzzles

Measured on 2026-11-09 against today's rules (v10) and scratch variants of
`src/rules.js`. The scripts and data are not in the repo.

**Verdict.** Lichess can supply king floors at scale. It can also supply some
floor 1 and 2 puzzles: trapped pieces, zugzwangs and quiet moves played by
one piece, and two-piece combos such as capture the defender. Forks, pins,
skewers and discovered attacks don't carry over.

**The database.** Lichess publishes its puzzles under CC0 at
database.lichess.org: 6.19 million positions. Each comes with a forced line
(the first move is the opponent's), a rating from players' attempts, a
popularity score, a play count and themes (fork, mateIn2, rookEndgame…). In
about 2.35 million of them, one piece makes every solver move, which is the
shape our one-piece player could take over. Another 10,757 are mates in 1 to 3
where the solver has only a king and one piece (no pawns); most are rook
endgames.

**How a puzzle becomes a floor.**
- The solver's moving piece is the player, starting on its own square. A line
  played by the solver's king gives the king to the recruit, or is skipped,
  since the daily piece is never a king.
- On the king floor, the solver's king is the recruit, already at your side.
  On floors 1 and 2, a second moving piece is the recruit.
- The solver's other men become walls. On floors 1 and 2, the squares they
  guarded around each piece the line wins become walls too, so a trap still
  holds without its guards.
- Opponent men that the line moves or captures become monsters with their real
  roles. On floors 1 and 2, the rest become walls.
- A puzzle that black solves is flipped, so the solver plays up the board.

The solver's moves are then replayed through `act()`, and our monsters answer.
Your move and the recruit's next move may be played as one turn, as the
dungeon allows. Off the king floor, a line survives if it wins the same
material as in chess without losing a life. On the king floor it survives if
it ends with the king taken.

**Floors 1 and 2: some themes carry over.** An exact search, with every
monster moving, sorts each surviving floor by what it is in the dungeon:
- **Puzzle:** a setup move, then the capture. The line is the fastest win, and
  only its first move wins that fast.
- **Combo:** one turn, your move plus the recruit's, and it is the only
  winning turn.
- **Free take:** the line wins on its first move; the rest of the chess line
  was consolidation.

| Theme | Puzzles | Combos | Free takes |
| --- | --- | --- | --- |
| Zugzwang (one piece; small sample) | 25% | — | 16% |
| Trapped piece (one piece) | 16% | — | 0% |
| Quiet move (one piece) | 9% | — | 11% |
| Hanging piece | 7% | 11% (two pieces) | 51% |
| Capture the defender (two pieces) | 0% | 10% | — |
| Intermezzo (two pieces) | 0% | 15% | — |
| Advanced pawn, promotion (you play the pawn) | 2–3% | about 1% | 37–41% |
| Fork, pin, skewer, discovered attack, deflection | 0–2% | 0–3% | rare |

The split follows how each tactic wins:
- **Forks, pins, skewers and discovered attacks** need the opponent to answer
  with one move, or to answer a check first. Here every monster moves every
  turn, so both attacked pieces step away.
- **Traps, zugzwangs and quiet moves** win because the target has no safe
  square left, which holds however many monsters move.
- **Capture the defender** works as a combo because the recruit acts right
  after you, before any monster answers.

A first pass that kept whole positions and pooled every theme found only 6–14%
of lines surviving. The difference is the three translation changes above:
king lines, guard walls and one-turn combos. A variant with one monster reply
per turn would have saved more, but every piece on both sides keeps moving
every turn (decided 2026-11-09).

**Floor 1 and 2 supply.** Counts are lines with at least 50 plays and at most
nine opponent men, after the filters above; themes overlap:
- Squeezes: about 950 (trapped piece 150, zugzwang 130, quiet move 670).
- Hanging-piece setups: about 900.
- One-turn combos: a few thousand (capture the defender 530, intermezzo 1,800,
  hanging piece 3,300).
- Free takes are plentiful but are only "take what's free".

A sample of 29,508 puzzles gave 512 good floors whose lichess line is the
solution: 208 puzzles of 2 to 4 moves and 304 one-turn combos. By daily piece
they split rook 140, pawn 135, knight 85, queen 82 and bishop 70, with a
median lichess rating of 1515. Knight and bishop days are the thinnest. The
trapped-piece squeezes are unusually clean: 82% of the ones checked have a
single winning first move, against 14% for the composer's own phase-0
squeezes.

**What these floors would need.**
- **Roaming decoys.** The measurement turned every man the line doesn't use
  into a wall. That is the static room the user rejected in the phase-0
  preview: walled-in decoys "lost the pressure of a dungeon crawler". A lichess
  floor would supply only its puzzle core (your piece, the recruit, the target,
  its guards and the trap's walls). Decoys would roam and press around it, the
  way the composer now dresses its own floors, and the exact search would
  re-check each floor after dressing.
- **A recruit already at your side** on combo floors. Today a recruit waits one
  move away.
- **The puzzle's start square.** You start where the puzzle puts you, not on
  e2.
- **A target that is what the line wins,** often one queen or rook, rather than
  a full army count.
- **Knowable roles.** A capture-the-defender combo only works if you can tell
  which monster guards the target.
- **New difficulty measures.** Lichess ratings won't carry over directly,
  because the dungeon version changes the line.

| Lichess theme | Dungeon motif | Carries over |
| --- | --- | --- |
| trappedPiece, zugzwang, quietMove | Squeeze, waiting move | As puzzles |
| capturingDefender, intermezzo | Recruit combo | As one-turn combos |
| hangingPiece | Punish the wind-up | Mostly free takes |
| fork, pin, skewer, discoveredAttack | — | No |

**King floor: the mates carry over.** The royal king already steps off
threatened squares the way a chess king does. Three chess rules close the
rest of the gap, and none of them changes who moves:
1. **Checkmate wins.** A king that is attacked, with no safe square and no
   guard that can block, is taken at once. A mate of yours wins as your move
   lands, before your recruit moves (no order to give); a mate the recruit's
   move completes wins after that move.
2. **The king can't take a protected piece.** It never captures a piece the
   recruit king guards. Today it does, in 381 of 2,000 mates.
3. **Kings never stand side by side.** The recruit king can't step next to the
   king, so it never checks or takes it. (Dropped after play: see Decisions.)

| King and one piece, mate in… | Today's rules | With the three king rules |
| --- | --- | --- |
| 1 (6,494) | 41% | 99.9% |
| 2 (3,913) | 51% | 60% |
| 3 (350) | 3% | 28% |
| All (10,757) | 43% | 83% |

Today's failures are mostly a capture that the chess rules forbid, or a guard
covering the king's square, so taking the king costs a life. With the three
rules, mates in 2 and 3 still fail when the other monsters' moves open an
escape.

**Exact par and uniqueness, without the bot.** Monster moves are already
deterministic (seeded ties), so a short floor is a one-player puzzle even with
every monster moving. Searching every sequence of player moves and recruit
orders, up to the line's length, finds the true shortest win and counts the
first moves that win. With the three king rules, on 300 surviving king floors:
- The lichess line is the shortest win on 99.7% of them.
- Only one first move wins on 86%.
- The search took 1.6 s in all.

The composer can use the same search to prove "no shortcut" in place of the
bot's guard check.

**Supply.** Two years of editions need about 150 king floors per daily piece.
These counts are after keeping only floors with one winning first move and no
shortcut:

| Daily piece | King floors available |
| --- | --- |
| Rook | about 5,900 |
| Queen | about 1,600 |
| Knight | about 500 (mostly mates whose solver pawns become walls) |
| Bishop | about 140 |
| Pawn | none |

About three quarters are mates in 1 (par 1); nearly all the rest are mates
in 2.

**Before it could ship.**
- **The king rules:** two are agreed (2026-11-10), and the third was dropped.
- **The cast has to fit.** The puzzle's guards must map onto the day's two
  decoy species. The composer's probe found 4,168 rook mates that fit.
- **The player has to be able to know the guards' roles.** A mate in 1 often
  depends on what the guards are, and it gives no time to watch them move.
- **The start square changes.** You start on the puzzle's square rather than
  e2, with the recruit king already beside you.

## The composer: floors built around their solution

Before the switch a floor was a random room that a search later proved
winnable. Then the bot measured its difficulty, and calibration tuned knobs
until the measurements landed in a band. The composer flips the order: pick
the solution first, then build the room so that this solution works.

1. **Pick a motif and a line.** Choose a tactical motif from a small library,
   such as a fork, a bait and sidestep, a squeeze or a mating net (see
   below). Pick it for the player's piece and the floor's target role, along
   with its planted line of 3 or 4 player moves (recruit orders included).
2. **Place what the motif needs.** Place the targets, their guards, the walls
   that shape the motif and the recruit so that the line wins. On the key
   line, every monster's response is forced (it has one safe move) or
   irrelevant, so a player can calculate it the way a chess puzzle is solved.
3. **Dress the room.** Add the other decoys, coins and powerups in a quiet
   zone that cannot reach the line's squares within its few moves, sealed off
   by walls where needed. A decoy pawn starts on rank 6 or higher, five moves
   or more from crowning, so none has crowned when the planted line clears the
   floor (a pawn guarding a bait target may stand on rank 5 where no other
   decoy can guard it).
4. **Prove it with one replay.** Play the planted line once through the
   production engine with the existing verifier (`verifyWinningRoute`). If it
   wins, the line is the floor's certificate. If not, reroll the dressing from
   its own seeded stream, up to a fixed number of times, then fall back to a
   simpler instance of the motif. A one-move "punish the wind-up" motif always
   composes, so every date always gets a day.
5. **Check, don't calibrate.** Run the bot's 40 runs (about 0.1 s a floor) only
   as a guard. Reject a floor the bot wins in 2 moves or fewer (an accidental
   shortcut), and reject one whose runs are slogs (a fragile or unclear
   puzzle).

### Why winnability becomes a certainty

The solution exists because we put it there, and a single replay through the
same engine proves it. No search, budget or device speed is involved, so
nothing can time out. Planted lines lose no lives, so the floors chain into a
winnable day just as stitched certificates do today. "Restart this floor"
always brings the planted line back.

### Motif library (first cut)

| Level | Motif | Key idea |
| --- | --- | --- |
| 1 | Punish the wind-up | A monster steps into reach; take it first |
| 2 | Bait and sidestep | A target winds up from a guarded square; step to where its lunge lands unguarded, then take it off-balance |
| 2 | Fork | One move attacks two targets, or a target and its only guard |
| 3 | Squeeze | A target in a walled pocket; the key move covers every exit, so it must step into reach |
| 3 | Recruit combo | Recruit, then order the recruit to block or cover while you take the target |
| 4 | Deflection | Attack a guard so it must move and uncover the target |
| 4 | Waiting move | One exact Wait leaves a monster only bad moves (zugzwang) |
| 2–5 | Mating net (king floor) | Walls, the recruit king and your piece cover the king's escapes; edge and corner nets first |
| 2–4 | Pawn floors | Stop the runner before it crowns, break the chain, en passant as the key |

A motif's level is how quiet the key move is: a capture or a threat is level
1, a non-capturing move that sets up a capture two moves later is level 4 or
more. The library needs an entry for each player piece and target role.
Every daily piece is built. A pawn player's line is mostly
timing: a wait, a step or the double step brings the pawn where a target
steps (or marches) into its diagonal just in time. No monster steps onto the
pawn's file, so the pawn's own file holds a target pawn still until the pawn
takes elsewhere; that also sets up en passant. A crown floor starts the pawn
on its sixth or seventh rank, and its new queen finishes the floor. A pawn
that misses its line can still walk up and promote: no wall stands on its
file (above the start, and above each take before the last), so where a
pocket needs boxing there, a decoy sleeps in the wall's place and steps off
the file once it wakes. On the king floor the whole file stays open. A
target pawn may still wait on the file, frozen there until the pawn takes
elsewhere; a pawn that walks up under it is cornered (that pawn counts as
terrain, src/rules.js trapped).

### Ice and Breach days

Composed days keep the day's modifier, and every floor is proved with it on.
On Ice days the composer lays each room's eight ice tiles itself, around the
planted line, instead of the seeded draw. Where the line's move onto its key
square (the squeeze's key square, the bait's sidestep, the net's mate, a
pawn's first quiet move) runs two squares or more along a line, the line aims
one square short, on ice, and skids onto the key square. Where the square
beyond is open, the key square is ice too, so a move aimed straight at it
skids past it and only the skid stops there. The other tiles lie off the
line. Ice can't shorten a slider's line (a skid only ends where the slider
could have moved anyway), and a pawn's tiles stay off its files wherever a
skid up the file would win sooner. Knights never slide, so their floors are
those of a plain day. On Breach days a monster comes in every ten moves,
long after a planted line of 3 or 4 has opened the stairs, so only a player
far over par meets one; on a pawn player's day it comes in off the pawn's
file, since no monster ever stands there.

### Identification and par

- **No count giveaway.** The composer sets decoy counts so that the paper's
  other suspect has the same number of copies as the target: two for rooks,
  knights and bishops, one for a queen or king. On pawn floors, eight copies
  always name the target, so the paper can call them open-and-shut; composed
  floors use two pawns instead, so the rule holds there too. Since 2026-11-10
  the paper pictures only the target; composed rooms keep the rule.
- **Par** is the planted line plus 1 (agreed 2026-11-10). That gives a
  careful player who spots the idea a spare move: E means "found it", under
  par means "found the exact line" or a clever use of a powerup or recruit,
  and over par means "searched for it".

### Difficulty without calibration

The weekly ramp was dropped for the composer (decided 2026-11-09). Each day
climbs within itself instead: for example floor 1 at level 2, floor 2 at level
3, and the king floor's net at level 3 or 4. Every day plays alike, and
nothing needs tuning. Every day plays one monster ruleset, Fair, which keeps
the monsters learnable, as a puzzle needs (agreed 2026-11-10); practice offers
all five.

If a weekly ramp ever returns, the weekday would pick motif levels (Monday 1–2
up to Saturday 4–5). Levels are designed, not fitted, and the bot's miss rate
per motif family is measured once, in minutes, to check their order.

### Build time

Today, calibration takes 25–35 minutes with the shortlist and confirm, or
about three hours by brute force, on seven workers. That comes on top of the
editions build. The composer estimate per floor: construction attempts at a
millisecond or so each, one replay, and 40 bot runs. That is about 0.1–0.3 s
per floor, so two years of editions take a few minutes on one thread, with no
calibration step. Phase 0 measures the real numbers.

Reused as is: the rules engine (`src/rules.js`), the replay verifier
(`src/fairness.js`), the stored-editions format (the planted line is the
`route`), and the human-like bot as a probe.

Retired with the switch (2026-11-11): the knob table and calibration scripts
(`src/calibration.js`, `scripts/calibrate-difficulty.mjs`,
`scripts/calibration-search.mjs`), the weekday tiers and their targets, the
capped-gap targeting, floor assembly across candidates, the whole-run route
search and the fallback bank. A full rebuild of every edition takes about
five minutes on seven threads. Retired after it, the same day: the random
rooms engine tests had kept as fixtures, with their layout rules and the
recruit-order ledger only they delivered (see "Rooms in tests" in
[generation.md](generation.md)).

## Agreed rule changes

These can ship ahead of the composer:

1. **No lives; a capture is a stroke (built).** There are no lives. Each
   capture of your piece adds 1 to that floor's moves, the way paid hints do,
   even after its challenge is complete: in the counter, par, the shop's par
   line, the bot table and the share card, with no new symbol. The shop's
   extra life is gone. The bot's par and gap feed floor assembly, so every
   edition was regenerated, not only re-scored.
2. **The king ignores frost (built).** The frost hourglass still freezes the
   guards on the king floor, but the king keeps moving.
3. **Count giveaway.** Built into the composer. It could also be retrofitted
   into today's generator if we want it sooner, at the cost of one more slow
   rebuild.
4. **No knight standoffs.** The composer never plants a line that needs a
   knight target to step into a knight's reach. If tiers stay, Gentle knights
   drop the exposure penalty so the README's "brave" is true.
5. **Tighter rooms.** Motifs bring their own walls, and the quiet zone keeps
   decoys from roaming into an open chase.

## Maybe: a clock on every floor

The ceiling holds for par + 4 moves from the floor's start, then caves in: the
floor scores as a miss and the rubble carries you down, as the cave-in does
today. On the king floor, the king slips away and the run ends without the
win. It bounds patience completely, but it adds a fail state. Composed floors
may not need it, so we try it in a preview after phase 2 and decide then.

## Phases

Each phase ends with a preview you play before anything long runs or ships.

0. **Prototype (offline).** Compose floors from three motifs (bait and
   sidestep, fork, squeeze) plus the king's net, for knight and bishop
   players. Load a composed day in the dev preview through a dev-only date
   hook. Measure the replay acceptance rate, time per floor and the bot's miss
   rate. Decision: does it feel like a puzzle?
1. **Scoring rules (built).** No lives, so a capture is a stroke; the king
   ignores frost. Every edition regenerated, previewed, shipped.
2. **Coverage (built).** Motifs for every piece and target role, pawn floors,
   Ice and Breach days, recruits and powerup placement; par settled. Built:
   varied start squares, rook and queen players (bait, squeeze and the
   king's net along the pocket's line), pawn targets (two pawns that
   march into a squeeze or wind up at a bait; a wall under each one's file
   keeps it from crowning), pawn players (tempo and crown floors; the
   king floor mated by the recruit king, the queen, or both), and Ice and
   Breach days (below).
3. **Switch (built, 2026-11-11).** Every edition composed, the archive
   regenerated (five minutes), calibration and the weekday tiers retired
   (every day plays Fair, par is the planted line + 1, and the two king rules
   hold on every room), and the README, the manual and `docs/generation.md`
   updated. Dates past the stored window borrow a stored day of their piece
   and modifier.
4. **Maybe.** The floor clock, and a weekly ramp by motif level if one is ever
   wanted back.

## Open questions

Par, the ruleset and the king rules were settled on 2026-11-10 (see
[Decisions so far](#decisions-so-far)).

1. The floor clock: try it after phase 2?
2. King floors from lichess mates are 1 to 3 moves long. Is a mate in 1 too
   short for the day's last floor, and how does the player learn the guards'
   roles in time?

## Risks

- **Repetition.** A small library can feel samey. Variety comes from motif ×
  piece × target role × start square × walls × dressing; track it as the
  library grows (`scripts/measure-composer.mjs` counts the lines and king
  pockets a player meets again within their last 8 days of that piece).
- **Fragile lines.** The monster AI may disturb planted lines often. Phase 0
  measures the acceptance rate. If it is low, make the quiet zone stricter or
  the monsters on the key line more forced.
- **Hidden roles.** A line must never depend on a decoy role the player can't
  know yet. The quiet zone keeps decoys off the line.
- **Effort.** The library is real work for each piece and role, so it starts
  small and grows.
