# Daily generation and fairness

`src/game.js` is the public game API. `getDaily()` normalizes the date to UTC and
returns a certified edition. `createGame()` uses that canonical edition; callers
cannot replace its seed, piece, color, targets, or layout by editing its metadata.
The published game uses the `standard` profile for everyone. There is no
personalized difficulty, device-dependent seed, or server dependency.

## What is guaranteed

Every returned edition has an explicit sequence of legal actions that:

- Completes all three capture objectives and takes the final stairs within 60 moves.
- Uses the actual obstacles, enemy movement, attack warnings, close-range
  captures, piece color, turn order, promotion rules, and automatic pickups from
  the production engine.
- Collects or purchases no powerups and recruits no companion, except the final
  floor's own recruit (a rook, queen or king). The recruits on floors 1 and 2,
  which may be any piece, are never used: the route never steps on them. No
  recruit may capture its floor's challenge piece, so on the final floor the
  capture of the king is the player's. The recruit can block, take guards, and
  herd the king: the king still flees squares the recruit covers.
  Castling is an ordinary legal move, so a route may castle with the final
  floor's recruit.
- Loses no lives, except that a pawn's route may spend up to 4 of its 8; uses no
  shield or freeze, and never restarts.

The day's room modifier (`src/modifiers.js`) is part of the game state
(`state.modifier`, absent on plain days), so the route is found and replayed
under it: ice slides, collapse reinforcements and their timing are all part of
the certified play. Dark changes only rendering, so its routes are plain routes.

Pawn promotion is an ordinary chess rule and is permitted. The proof carries the
promoted piece, turn count, and all other state through the entire run; three
separate room proofs would not be sufficient. Black's enemy phase can invalidate
a clicked destination, so a certificate can include a re-selection that costs no
player move. Extraction also costs no move. Waiting is an ordinary action that
spends a move; certificates may wait so monsters walk into range. Under
close-range captures a pawn can only strike from a square next to its target,
which most targets attack, so pawn routes depend on waiting and on spending
lives: in a one-year audit, waiting cut pawn days that needed a fallback from
63 of 75 to 12.

After a daily win with the official piece, `src/bot.js` replays this same
certificate through `act()` to show the player the bot's per-floor move counts
and an animated replay. The route stays hidden until then. Its length is the
length of a witnessed route, not the shortest one, so players can beat it.

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
open. The pickup check concerns terrain accessibility; it does not claim that collecting every pickup and winning can be combined into one 60-move route. These rules reduce the search space; they do not replace combat replay.

There is no mutate-until-it-passes loop. Each edition gets at most two candidates
and 12,000 simulated transitions per candidate, then one certified fallback.
Every rejection, next seed, and fallback choice is a pure function of the date,
profile, and rules version. The fallback builder is an offline authoring tool
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
2. A bounded two-ply rollout and beam search try to find a complete route. Search
   uses fixed transition counts and stable ordering, never a wall-clock timeout.
3. An independent replay of the returned action list calls the same `act()` used
   by gameplay. It rejects illegal actions, incomplete victories, powerup effects,
   damage, restarts, and deadline failures. Automatic pickups remain on the board;
   the route must avoid them rather than simulate a different game.
4. If needed, a second layout seed is derived from the date and generator version.
5. If neither candidate is accepted, the generator selects a previously certified
   full-dungeon template for the same piece, color, and difficulty. Date-specific
   appearances remain varied; target roles and gameplay RNG use the template's
   seed. That exact remapped edition is replayed again before it is returned.

The fallback bank covers all 45 combinations of five playable pieces (always white), three
profiles, and plain, ice or collapse rules. A broken or missing fallback fails closed with an error; it never
releases an unverified dungeon. The test suite and build check the entire bank.
Search and verification share `src/rules.js` with live gameplay, avoiding a second
implementation of combat. `rules.createGame()` is the internal candidate builder
for search, authoring, and rule fixtures; application code uses `game.createGame()`.

## Room modifiers

`modifierFor(date)` draws `none`, `dark`, `ice` or `collapse` uniformly from its
own hash stream (`modifier:<date>`), so no other daily draw moves. Editions
before 2026-11-07 are plain, keeping their saves valid. The modifier is part of
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
  turn, if `floor(moves / 10)` exceeds the reinforcements so far (`state.reinforcements`,
  capped at 3) and the door square is free, a copy of one of the floor's decoy
  species (never a pawn, which could block a pawn's promotion file) enters there
  as `f<floor>-r<n>`. None arrive once the stairs open. Reinforcements are
  ordinary decoys: capturing one pays a gold, and save validation widens floor
  populations by the cap.
- **Dark** has no rules effect. `visibleSquares()` and `updateSightings()` drive
  the renderer's fog and last-seen ghosts.

Ice and collapse change play, so the fallback bank holds a certificate for
each piece, difficulty and one of `none`, `ice` or `collapse` (45 in all);
dark days use the plain certificate. Over the 60 standard editions from
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

## Difficulty and chess learning

`src/difficulty.js` defines three authoring presets: `gentle` starts with five
obstacles, `standard` with seven, and `expert` with nine; each later floor adds
one. Standard and expert also require at least two and four decisions along the
witness while committed enemy attack lanes are present. Walls can create shelter
as well as restrictions, so these are tuning presets, not proven rankings of
human difficulty.

Certificates record route length, positioning moves, capture opportunities,
promotion, warning-lane decisions, and immediately unsafe alternative moves.
They support tuning for anticipating attack lanes, using a piece's mobility,
choosing captures, and advancing a pawn to promotion. These are measurements of
one successful route. They do **not** establish shortest solution length, forced
tactics, a unique solution, or a minimum difficulty. In particular, the presence
of a warned lane does not imply that it threatens the player's current square.
Human playtesting is still needed to calibrate the presets and assess learning.
The winnability acceptance condition stays unchanged when difficulty is tuned.

## Changing and auditing content

```sh
npm test
npm run verify:fallbacks
npm run audit:dungeons -- 2026-11-05 365 standard
npm run build
```

`audit:dungeons` independently replays every certificate and validates saves after
every action. Its timing measurements are diagnostic only and never influence the
selected dungeon. To author a new fallback bank after a deliberate rules change,
run `node scripts/build-fallbacks.mjs`, inspect the results, and verify it again.

Any change to gameplay, generation, search budgets/order, profiles, or fallback
selection can change an edition. Bump the generator/rules version and save-key
version together for such a release. Version 5 archives earlier saved editions
in backups instead of interpreting their old layouts as certified new games.
