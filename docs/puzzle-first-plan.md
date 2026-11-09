# Puzzle-first plan

Every floor should be a short puzzle: a few moves, one clever idea, and a
solution that is certain to exist. No floor should turn into a chase, a siege
or a trade of lives. This plan also aims to end hours-long calibration, by
building floors around their solutions instead of searching random rooms and
tuning knobs until the numbers land.

Status: proposal, written 2026-11-09. Nothing here is built yet.

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
| Each lost life adds 1 move to that floor's score (no new share symbol) | Agreed |
| Fix the count giveaway: the other suspect has as many copies as the target | Agreed |
| The king floor's king ignores frost | Agreed |
| No knight-against-knight standoffs; Gentle knights are brave if tiers stay | Agreed |
| Tighter rooms: no open boards a target can flee across | Agreed |
| Generation fast enough that calibration is no longer a step | Agreed (goal) |
| A clock on every floor (the ceiling holds par + 4 moves) | Maybe |
| The weekly difficulty ramp | Maybe dropped (see Open questions) |
| Recruits traded away when they capture on a guarded square | Dropped: recruits are never lost |

## The composer: floors built around their solution

Today a floor is a random room that a search later proves winnable. Then the
bot measures its difficulty, and calibration tunes knobs until the
measurements land in a band. The composer flips the order: pick the solution
first, then build the room so that this solution works.

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
   by walls where needed.
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
more. The library needs an entry for each player piece and target role. Start
with knight and bishop players and grow from there.

### Identification and par

- **No count giveaway.** The composer sets decoy counts so that the paper's
  other suspect has the same number of copies as the target: two for rooks,
  knights and bishops, one for a queen or king. On pawn floors, eight copies
  always name the target, so the paper can call them open-and-shut.
- **Par.** I suggest par equal to the planted line plus 1. That gives a
  careful player who spots the idea a spare move: E means "found it", under
  par means "found the exact line" or a clever use of a powerup or recruit,
  and over par means "searched for it". The bot's median is the alternative
  if we would rather keep par human-measured.

### Difficulty without calibration

- **If the weekly ramp is dropped:** each day ramps within itself, for example
  floor 1 at level 2, floor 2 at level 3, and the king floor's net at level 3
  or 4. Every day then plays alike, and nothing needs tuning. One monster
  ruleset for every day keeps the monsters learnable, which a puzzle needs.
- **If it stays:** the weekday picks motif levels (Monday 1–2 up to Saturday
  4–5). Levels are designed, not fitted. The bot's miss rate per motif family
  is measured once, in minutes, to check the ordering.

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

Retired once the switch lands: the knob table and calibration scripts
(`src/calibration.js`, `scripts/calibrate-difficulty.mjs`), the capped-gap
targeting, floor assembly across candidates, and probably the fallback bank.

## Agreed rule changes

These can ship ahead of the composer:

1. **A lost life is a stroke.** Each life lost on a floor adds 1 to that
   floor's moves, the way paid hints do: in the counter, par, the shop's par
   line, the bot table and the share card, with no new symbol. Par is
   recomputed for stored editions, which only reruns the bot.
2. **The king ignores frost.** The frost hourglass still freezes the guards on
   the king floor, but the king keeps moving. (Alternative: no hourglass on
   floor 3.)
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
1. **Scoring rules.** A lost life is a stroke; the king ignores frost. Small
   changes: recompute par, preview, ship.
2. **Coverage.** Motifs for every piece and target role, pawn floors, Ice and
   Breach days, recruits and powerup placement. Settle par and the ramp
   question here.
3. **Switch.** Generate every edition with the composer, regenerate the
   archive (minutes), retire calibration, and update the README, the manual
   and `docs/generation.md`.
4. **Maybe.** The floor clock, and a weekly ramp by motif level if wanted.

## Open questions

1. Drop the weekly ramp (my suggestion while we build), or keep it by motif
   level?
2. Par: the planted line + 1, or the bot's median?
3. One monster ruleset for every day, or keep the five tiers?
4. The floor clock: try it after phase 2?

## Risks

- **Repetition.** A small library can feel samey. Variety comes from motif ×
  piece × target role × walls × dressing; track it as the library grows.
- **Fragile lines.** The monster AI may disturb planted lines often. Phase 0
  measures the acceptance rate. If it is low, make the quiet zone stricter or
  the monsters on the key line more forced.
- **Hidden roles.** A line must never depend on a decoy role the player can't
  know yet. The quiet zone keeps decoys off the line.
- **Effort.** The library is real work for each piece and role, so it starts
  small and grows.
