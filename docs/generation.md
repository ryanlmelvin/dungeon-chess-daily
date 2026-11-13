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
planted lines are the day's certificate. Most floors also hold a chest, off
the line, with a proved win within par that takes it. How the composer came
about, what was tried and what the user chose after play is in
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
- Collects no powerup and takes no chest.
- Recruits no piece but the king floor's own king, which moves itself, and,
  on a day with a partner floor (a Tandem, below), that floor's recruit, on
  that floor alone. Off a partner floor the line carries no recruit orders;
  on it each move says what the recruit does, as every turn a player takes
  does. A player always orders the recruit and may order any legal move, the
  one it would make itself included, so a line can always be followed.
- Keeps every save along the way valid (`validateSave`), as a player's run would.

The proof (`proveComposed` in `src/generation.js`) replays the lines through
`act()` twice. First on the day's twin without its hint powerups, through
`verifyWinningRoute` (`src/fairness.js`): a certified route collects no
powerup. A floor's hint powerup lies on its key square, so the real day's line
picks it up; picking one up changes no monster's move, so the real day is then
replayed as played, hints collected, never captured, every position a valid
save. A day with a partner floor names it (`generation.partner`, floor 1 or
2): the verifier then plays the recruit on the line's orders
(`certificateMode`), and the replay as played refuses an order, or a floor
1–2 recruit joining, anywhere but on that floor. The build proves every
edition this way, and the app proves each one again as it loads it (without
the save checks), so an edition that no longer proves is never played.

This is an existence guarantee from the fresh starting position under this
version's deterministic rules. A planted line is a shortest win (below), so a
player can tie it but never beat it on the scored count; a capture or a paid
hint adds a move. The verifier and tests are software, not a formal
verification of the JavaScript runtime or the entire application.

A chest carries a second, smaller guarantee, made when its day is composed:
some win within par, never captured, lands on its square while the door is
still shut, checked once more as played, hint collected (`src/treasure.js`).
That line is not stored and not replayed when a day loads. The build makes it
and `npm run audit:editions`, which composes every stored day again and
compares, makes it again.

## How a floor is composed

`composeDay(date)` composes the floors in order from three seeds of the date's
own (`composedSeeds`, salted by `COMPOSER_VERSION`), so a day is a pure
function of its date and the composer's code. With no options it composes the
release configuration (`RELEASE` in `src/composer.js`: chests, partner floors
and tight forms, each described below), which is what the build stores, the
audit composes again, the dev preview shows and the tests compare. For each
floor it tries its motifs in order: floor 1 the day's idea in its plain form
(a bait or a squeeze, see the day's arc below), else the other; floor 2 a
subtle form of that idea where its matchup has one, else a squeeze, else a
bait; the king floor a mating net. On a day whose matchup pairs up, floor 1 or
2 is a Tandem instead. A pawn player's floors 1 and 2 are tempo lines (quiet
moves time the pawn's diagonal takes), or crown lines (it promotes within the
line) where a tempo line would leave nothing to hint at; its king floor is
mated by the recruit king, by the new queen with the recruit's help, or by
the queen alone. Each motif gets up to 40 instances and each instance up to 6
dressings, each from its own seeded stream:

1. **Build the instance.** The motif places the targets, their guards, the
   walls that shape the idea and the start square (one of b2 to g2, d1 or e1,
   drawn per instance), so that its line wins. A target pawn floor has two
   pawns, walled a square short of crowning.
2. **Search it exactly.** Monsters break ties by the floor's seed, so a floor
   is a one-player puzzle: `shortestWins` deepens over every sequence of the
   player's moves and waits (none onto a powerup or a floor 1–2 recruit, which
   a certified line never uses). The instance is kept only if its shortest
   win takes three or four moves and uses the planted idea (`usesIdea`).
3. **Dress the room.** The decoys the idea doesn't use start two to four of
   their own moves from the line (one to three on floor 1), close enough to
   press in. On floor 1 they sleep for as many moves as the line (`held`),
   then wake and hunt; on floors 2 and 3 they hunt from the first move. A
   decoy pawn starts five or more moves from crowning. Up to three coins, the
   recruit (floors 1 and 2: any piece, three or more moves away, where it
   can't take part within the line; the king floor: a king one move from the
   start) go off the line, on squares the piece can reach.
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
742 editions from 2026-11-01 to 2028-11-11, fifteen floors fell back: seven
walks (a bishop against bishops) and eight relaxed pawn floors. Four of those
walks take five or six moves; every other line takes three moves (1,649
floors) or four (573).

Every date must compose. A day that fails with all three options (a floor
that won't compose, a proof that fails) is composed again without its partner
floor, then without its tight forms, then without its chests (`FALLBACKS`),
and `composeDay` says what it gave up (`dropped`). No day of those 742 gave
anything up.

### The day's arc and the tight forms

A day shows one idea twice where it can: plainly on floor 1, then in a subtle
form on floor 2 (`dayIdea`, `tightMotifs`; composeDay's `tight` option). The
idea is a bait or a squeeze, picked by the date's seed among those that fit
both floors' matchups (plain on floor 1, subtle on floor 2), else the one
floor 2 has a subtle form of, else a bait as before. Floor 1 tries the idea,
then the other one; floor 2 the idea's subtle form, then the other's, then a
picked squeeze, then its plain squeeze and bait. (A day whose floor 2 is a
Tandem still gives floor 1 the day's idea.) The subtle forms are built around
a burrow, a few squares a target paces that the player's piece can never land
on, so the idea is the only way in (`BURROWS`: the targets whose moves never
run along the piece's own lines):

- **Pincer**, the subtle squeeze: each burrow has two exits and the target
  must step out onto one every other turn. One square of yours attacks every
  exit of every burrow.
- **Mouth**, the subtle bait: one target winds up at the start square, the
  other paces a corridor whose far end, the mouth, is the one square of it
  you can land on. Sidestep into the mouth, take the first where it lunged,
  and the second lunges into the mouth behind you. A lone queen gets the
  corridor alone.
- **A picked squeeze**: pawn targets only march, so a knight's or a bishop's
  floor 2 against them is a plain squeeze kept only when it passes the same
  tests.

A subtle or picked floor must pass three tests on top of every floor's own
(`src/tight.js`), the first two exact searches over every line of play within
par, a capture counted as the move it costs:

1. No win within par skips the idea, as a player would name it (`playsIdea`:
   a bait is a target taken off-balance right after its lunge missed, a
   squeeze a target taken on the square it just stepped onto, in your reach).
2. A neutral first move costs par: of the first actions that aren't captured
   at once, at most half still leave a win within par.
3. Plain sensible play doesn't find it: the human-like bot makes par in at
   most a quarter of its 40 runs.

A form gets 24 of its motif's 40 instances and keeps its first dressing that
passes; a floor where none passes falls back to its plain motifs. King floors
and a pawn player's floors are left as they are. Over the 742 editions, 288
floor 2s are tight (247 subtle, 41 picked). Only the idea is stored with an
edition, never its form.

### Partner floors: the Tandem

A partner floor is won by the player's piece and the floor's recruit
together (composeDay's `partner` option). Its one motif is the Tandem: the
floor's two targets stand walled in a step of their own apart (rooks side by
side, bishops corner to corner, knights a jump apart), so each guards the
other's square, and whichever you take, the other takes you at once. A
recruit is never taken. It waits one move from the start: step onto it and
post it (it takes nothing on the move it joins), step to your own post while
it takes its twin, then take yours, no longer guarded. The line takes three
moves, so par is 4, and the hint is a coin on your post.

A Tandem takes floor 1 or 2 of a day whose piece and target pair up
(`TANDEMS`: a knight against rooks or bishops, a bishop against rooks or
knights, a rook against bishops or knights, a queen against knights; never a
pawn player, a pawn target or a lone queen), the date's seed choosing between
two floors that both fit. Such a day takes its Tandem about one time in three,
drawn by the date (`PARTNER_EVERY`, `partnerDay`; the owner's cap, 2026-11-12:
on every such day it fell on half of all days, always at par 4, and was the
commonest idea in the game). Over the 742 editions 360 days have the matchup
and 113 take a Tandem: 53 on floor 1 and 60 on floor 2. `partner: 'every'`
(tests, measuring, the dev preview's `&partner=all`) composes one on every
eligible day.

Its line carries recruit orders, so its day is proved with the recruit on
orders on that floor (above). It is checked like the other motifs, the
recruit steered (`composeTandem`):

- the line wins, never captured, and nothing wins in fewer moves whatever the
  recruit is told (`steeredWin`, every move and every order tried);
- a hasty player who takes a guarded twin and absorbs the capture scores no
  better than par with the recruit (`steeredHasty`) and worse than par
  without it (`hastyScore`);
- the recruit can't take the second twin straight from the first one's
  square (`TANDEM_RECRUITS`), so every win in three moves is the two of you;
  a move later, at par, the recruit can do it alone;
- the human-like bot, from the move that joins the recruit, finishes within
  par + 4 in two runs of three (`partnerGuard`). From the floor's own start
  the bot is not judged: it has no notion of fetching the recruit first.

### Treasure

Once a floor's room, line and hint are settled, the composer lays a chest
where one qualifies (composeDay's `treasure` option, `src/treasure.js`).
Monsters and the recruit ignore a chest as they do a coin, so nothing else in
the room changes and every check above still holds. The chest is a second
goal on the same room: par stays the line plus one, and the chest asks for a
win within par that also lands on its square before the door opens.

Every win within par is counted exactly (`parWins`). A square qualifies when
one of them lands on it before the move that completes the challenge, and it
lies off the planted line: on no square the line moves to or rests on, nor on
a wall, the start, the exit, a monster, an item or ice. Two checks follow:

1. **It costs the spare move.** No win that scores the planted line's length
   takes a chest there, on its way or as it wins (a mate lands with the door
   still shut), a capture counted as the move it costs. So the choice is
   always under par, or even with treasure, never both.
2. **It isn't taken by accident.** The human-like bot, which sees no chest
   and plays the same with one in the room, takes it and still makes par in
   at most 4 of its 40 runs (`TREASURE_BOT`). One batch of runs, a chest on
   every square still in question, answers for them all.

Of the squares that pass, the one the fewest par wins pass through is kept (a
seeded draw settles ties), with one such win as its proof, replayed as
played. A floor with no such square has no chest, and a partner floor never
has one (a chest's line is searched without the recruit). Over the 742
editions 1,157 of 2,226 floors hold a chest (447, 347 and 363 on floors 1, 2
and 3); the first rule alone would give one to 1,560, and the spare-move and
accident checks leave 403 of those floors with none. A day holds 0, 1, 2 or 3
chests on 118, 234, 247 and 143 days.

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
where a move aimed straight at it would skid past (`iceVariants`). A Tandem's
ice lies off its line, and no chest lies on ice. On a Crumbling floor or
Gates day each room lays its own cracked tiles or gates where its idea lives
("Moving terrain", below).

## Ideas in preview: the Standstill and the Lure

Two more ideas a floor can be built around, built on 2026-11-12 and not
released: no stored edition has them, and `composeDay(date)` composes
exactly what it did. Each is a `composeDay` option of its own, off unless
asked for and absent from `RELEASE` (`PREVIEW_IDEAS`: `wait` and `lure`). The
dev preview asks with `&wait=1`, `&lure=1` or `&ideas=1` (both), the
measuring scripts with `--wait`, `--lure` or `--ideas`.

**Where they go.** An idea takes about one in three of the days it fits,
drawn by the date like a Tandem's (`IDEA_EVERY`, `ideaDay`); `'every'` as the
option's value (`&wait=all`, `--every`) takes every day it fits. It goes to
floor 1, tried there before the floor's plain motifs, and never to the day's
partner floor (`ideaFloors`, `previewIdeas`); a day that takes both tries
them in an order the date sets and keeps the first that composes. Floor 2 is
left alone: the matchups these ideas fit are the ones floor 2 has a tight
form for, and offered floor 2 as well (after the tight forms, so as never to
stand in for one) neither idea composed there on any of the 742 stored days.
A floor where an idea doesn't compose keeps its own motifs, and a day that
fails with an idea on gives it up before any release option (`FALLBACKS`).

**The Standstill** (`wait`). The key is one exactly timed Wait. Each target
paces a pocket of two squares, one step every turn, as in a squeeze, and the
one square of its pocket the piece can ever attack, its landing, it attacks
from one square alone (walls shut every other; a slider stands right beside
the landing, walled off behind). The line's shape is one of `WAIT_WORDS`:
come to stand on that square as the target steps away, wait, and take it
where it has to step back (`KWT` against a lone queen); or wait where you
start, or take the first target and wait where it stood for the second
(`WTT`, `TWT`, `KWTT`, `KTWT` against two). Fits the targets a piece can
burrow (`BURROWS`); the hint is a coin on the square to wait on, or, where
the line opens with the wait, on the square the target then steps onto. On
top of the three tight tests below, the wait must stand alone: as it is
made, every other action loses par (`standsAlone` in `src/tight.js`), and at
least three other actions are on offer there (`WAIT_OTHERS`).

**The Lure** (`lure`), a knight's. A target, the prize, stands walled in
beside a decoy, its guard, and the guard opens the floor one step from the
start square, wound up at it: the knight starts on a red square. Jump aside
to where you attack the prize; the guard lunges onto the square you left,
off-balance and off its post, and for that one move the prize is free. The
start square is walled so that the guard's only step from it is back to its
post, where it stands again a move later; and the other target can be
attacked from the prize's square alone, so it never comes first. Taking the
prize at any other moment is captured at once. Fits a knight against two
rooks or two bishops with a rook, bishop, queen or king among the floor's
decoys (`LURE_PIECES`, `lureLines`); the hint is a coin on the sidestep.

*How the player can know the guard guards.* Monsters are masked, so the line
may not rest on the guard's role. It rests on two things the board shows
before the first move (`plainGuard` in `src/tight.js`): the guard's wind-up
runs one step, straight or diagonal, onto the knight's square, and the prize
stands one step from the guard along the same kind of line. Whatever attacks
along a straight step (a rook, queen or king) covers the square straight
beside it, and likewise for a diagonal one (a bishop, queen or king; a
wind-up diagonally down the board may be a pawn's, so there the prize stands
diagonally below the guard). The sidestep lands two squares or more from the
guard, where nothing that winds up along a line takes at once. After the
lunge the guard is off-balance, which the board shows, and an off-balance
monster never captures. Only a knight can do this honestly: a bishop's or
rook's only sidestep that attacks the prize lies beside the guard (safe from
some of the roles its red square could mean, not all), a queen simply takes
the guard, and a pawn guard can be taken by a bishop or queen and leaves a
knight no safe sidestep.

Why the guard stands beside the start: every monster moves every turn, so a
guard with a line open to a distant square walks along it by itself, and a
slider that sees the piece from afar steps closer before it winds up, off
its post already. A guard stays on its post only while it is wound up, and
the one wind-up that needs no step is the opening one. From two or three
squares away the guard could also stop short of its post on the way back, or
be kept off it by a piece standing in the lane, and the prize stayed free.

**The tests.** Both are held to the tight tests whatever the `tight` option
says: no win within par skips the idea (`playsIdea`: for a Standstill, a
wait followed by the take of a target on the square it just stepped onto;
for a Lure, a target taken on the move after its plain guard lunged and
missed), at most half of the first actions keep par, of at least four
(`IDEA_FIRSTS`), and the bot makes par in at most a quarter of its 40 runs.
Every floor's own checks apply too (nothing wins sooner, the hasty two, the
bot guard). `ceiling: false` (tooling; `&ceiling=0`, `--no-ceiling`) leaves
the bot's ceiling out, to compare.

**What the bot's ceiling means here.** The bot's own habits come close to
both ideas, so it is a weak judge of them. With nothing to gain it waits
("monsters often walk into range"), which is the Standstill: without the
ceiling the bot makes par on every one of a Standstill floor's 40 runs. Out
of a red lane it steps toward the nearest target and takes whatever no
longer looks guarded, which is most of a Lure. A floor passes the ceiling
only where something in its dressing leads plain play astray (a sleeping
decoy it would rather take, or one it won't step next to), so the ceiling
picks floors by their decoys more than by their idea.

**What was measured** (2026-11-12, over the 742 stored days, each idea on
every day it fits; the floors compared are the same days with the idea off
and on):

- **The Standstill** fits floor 1 of 279 days (38%: a queen's 81, a knight's
  79, a rook's 65, a bishop's 54) and draws 97. It composes on 71 of them
  under all three tests (25%: a knight on 51 of its 79 days, a queen on 16,
  a bishop on 4, a rook on none) and on 122 without the bot's ceiling (44%:
  knight 65, queen 35, bishop 22). 56 lines take three moves and 15 take
  four. It stands in for a bait on 51 floors and a squeeze on 20. Those 71
  floors, before and after: first actions 6.6 and 5.0 a floor, of which 77%
  and 34% keep par (after: the move to the square and waiting first, or the
  wait alone); floors with a win within par off the idea, captures allowed,
  18% and none; bot runs at par 80% and 0.2%, past par + 4 2.9% and 9.1%.
  The floors the ceiling turns away are mostly the ones that open with the
  wait itself (the bot waits there on every run).
- **The Lure** fits floor 1 of 38 days (5%, all a knight's: 25 against rooks,
  13 against bishops) and draws 11. It composes on 22 under all three tests
  (58%) and on 29 without the ceiling (76%), always in three moves, in place
  of a bait on 17 floors and a squeeze on 5. Those 22 floors, before and
  after: lines of four moves on 20 of them, and of three on all; first
  actions 4.9 and 4.5 a floor, of which 87% and 24.5% keep par (after: one,
  now and then two); bot runs at par 86% and none, past par + 4 2.8% and
  9.4%.
- No floor's bot par rate rose with an idea on. No floor of either idea
  holds a chest (0 of 93): within par the only wins are the line itself and,
  for a Standstill, the same line with the wait made first, so no win
  leaves the line to land on one.
- With both on at one day in three, 105 days draw an idea and 32 change:
  floor 1 goes from 347 baits and 171 squeezes to 325 baits, 161 squeezes,
  28 Standstills and 4 Lures, and floor 2 is as it was. On every day they
  fit they would take 80 floor 1s between them (13 days fit both).
- Over 2026-11-13 to 2027-01-12 (61 days): the Standstill fits 23 days,
  draws 9 and composes on 5, 3 of them drawn (8 without the ceiling); the
  Lure fits 2 days, draws neither and composes on both.
- An idea's floor composes in about a second (Standstill 1.2 s, Lure 0.7 s
  on average); a day where one is tried and none of its 24 instances passes
  spends a few seconds more on trying (each dressing costs up to 40 bot
  runs), a queen's day the most.

`node scripts/measure-ideas.mjs --jobs 8` reports this coverage, and
`node scripts/measure-tight.mjs --option ideas --drawn --jobs 8` the floors
before and after.

**Shipping one** would need: its option added to `RELEASE` (and to the
build's report), its page moved from `PREVIEW_PAGES` to `PAGES`
(`src/journal.js`), a full rebuild of the editions
(`npm run build:editions -- --full`; no `RULES_VERSION` bump, since play is
unchanged, and no `COMPOSER_VERSION` bump, since each idea draws from seeded
streams of its own), the pinned tests and this document's figures brought up
to date, and the owner's play of a local preview first.
## Moving terrain: a crumbling floor and gates

Two room modifiers are terrain that changes during a floor. They took
Breach's days with rules version 14 (2026-11-13): Breach, a monster in at
the door every ten moves, never came on a floor of three or four, and is
retired with its code. A date draws terrain on one day in four
(`src/modifiers.js` `DRAW`, Breach's old slot, so no other day's draw
moved), and the day's piece settles which (`terrainFor`): Gates on a
bishop's day, since cracked tiles seldom matter to a bishop's floors (39% of
them composed around the tiles, against 89% around gates, below), else one
or the other, evenly, by the date. Tooling can still force either on any
date (`composeDay`'s `daily`, the measuring scripts' `--modifier`), and so
can the dev preview, with `&modifier=cracks` or `&modifier=gates`
(`src/composed-preview.js`).

**One seam.** Both are terrain that changes during a floor, and the engine
has one notion of it (`src/terrain.js`): `solid()` says whether a square is
solid right now, a wall, a pit or a shut gate alike, and `walkable` in
`src/rules.js` asks it. So legal moves, attack lanes, the monsters' choices,
the exact search, the human-like bot (which plans over `terrainMap`) and the
save check see one board. The squares terrain shuts right now travel in the
state as two bit masks (`state.shut`) beside each modifier's own record
(`cracks` and `pits`, or `gates`); `positionKey` holds the tiles still
cracked and each gate's state; `validateSave` checks the record against the
room and works the masks out again. A day without terrain carries none of
these fields. Where the question is what could ever happen (is a pickup in
reach, is the floor hopeless, is a piece cornered for good), gates count as
open and pits as walls (`settled`): a gate opens again, a pit never mends.

- **Crumbling floor** (`cracks`, `src/cracks.js`). About eight tiles a room
  are cracked. A cracked tile falls away when the piece standing on it steps
  off, yours, your recruit's or a monster's, and the pit it leaves blocks as
  a wall does for the rest of the floor: nobody stands there, lines stop
  there, knights jump it. Only a piece that stood on the tile breaks it:
  sliding across or jumping over leaves it whole. Taking a piece there puts
  the taker on the tile, which holds until the taker leaves; a captured
  player stays put, so nothing falls. A lunge at a square that has fallen
  lands nowhere, and the monster stands off-balance where it was. A monster
  with no step left stays put, as one walled in always has. A piece of yours
  with no move left starts its floor over, as on any day, and a target
  sealed off by pits makes the floor hopeless, which the game already says
  (`hopelessFloor`). No tile is cracked under a waiting recruit; a coin on a
  tile that falls lies in the pit.
- **Gates** (`gates`, `src/gates.js`). Two or three squares a room are
  gates. Shut, a gate blocks as a wall does; open, it is floor. Every gate
  is shut one move and open the next, and so on, each beginning on one beat
  or the other (`phase`, 0 shut first, 1 open first), and gates change
  between turns, once you, your recruit and every monster have moved: one
  turn is played on one board. So every gate changes after every move and
  the board draws only shut and open: what is up now is down next move.
  (Gates first held each state two moves and marked the wait, with arrows
  on the gates about to change and then a number on every gate; the owner
  could not read the arrows and asked for plain alternation in place of
  the numbers, 2026-11-12.) A gate never shuts on a piece: it stays open
  under one for as long as it stands there, and its rhythm never shifts. A
  monster already wound up when a gate shuts across its path still lunges,
  finds the gate and stands off-balance. A piece with no move only because
  gates are shut is not cornered: waiting answers it.

**Composing around terrain** (`src/composer.js`, "Terrain floors"). Ice only
takes stops away from a slider; a pit or a gate changes what monsters can do.
So terrain is laid on a motif's instance before anything is searched, and the
room is proved with it in: the exact search, the idea, the dressing's checks,
the hasty check and the bot guard all play the real rules. A floor's cracked
tiles go where the idea lives: one to three among the start, the targets' own
squares, the squares they can step to and the squares the motif keeps open,
the rest of the eight anywhere free. Its gates go at the targets' doors: a
square a target can step to, or a wall of its box opened into a gate, each on
a beat of its own, then one more on a kept square or anywhere free. On the
king floor no gate stands on the lane from the start to the recruit, which
waits one move away as on any day. Three rules are added to every floor's own:

1. **The terrain matters** (`terrainReason`). The same room without its
   tiles or gates must play differently: its line fails there, or something
   wins sooner there, or something as short wins there that the terrain
   rules out. A gate must matter twice, open for good and walled for good,
   or it was only ever floor or only ever a wall.
2. **No line of waiting.** A line holds at most one wait, and of a floor's
   shortest lines those that wait least are planted first.
3. **The idea may be played as a player would name it** (`playsIdea`), so a
   bait whose lunge found a pit or a gate, and landed nowhere, still counts.

A motif gets twelve searched instances a round and two rounds
(`TERRAIN_INSTANCES`, `TERRAIN_ROUNDS`). A floor where none passes takes the
floor a plain day would compose, tight form and all, with its terrain laid off
the line (`terrainOff`, as Ice's 'off'): on no square the line moves to or
rests on, with the line still winning, nothing winning sooner, and the hasty
check and the bot guard passing; the first of twelve seeded layouts that does
is kept, else the floor lays none. Each floor says which it got (`terrain`:
'idea', 'off' or 'none'). Two things do not combine and say so here: a Tandem
keeps its own composition with the terrain off its line (judged with the
recruit on orders), and floor 2 tries its plain motifs around terrain before
it falls back to its tight form with the terrain off the line, so a day's
subtle form gives way to its terrain where the terrain composes. No chest
lies on a cracked tile or a gate.

**Measured** over 2026-11-13 to 2027-01-12, 61 days and 183 floors with each
modifier forced on, each beside the same date composed as a plain day
(`node scripts/measure-terrain.mjs --modifier cracks|gates --jobs 8`). The
gates column is for gates that alternate every move; at their first rhythm,
two moves a state, the figures were close (167 floors around the gates, the
bot at par on 40% of its runs there):

| | Crumbling floor | Gates |
|---|---|---|
| Floors composed around the terrain | 127 (69%): 49, 43 and 35 on floors 1, 2 and 3 | 165 (90%): 55, 51 and 59 |
| …because the line fails without it | 40 | 123 |
| …because something wins sooner without it | 5 | 8 |
| …because it rules out a win as short | 82 | 34 |
| Floors with the terrain off the line | 56 | 18 |
| Floors with none | 0 | 0 |
| Lines of three moves / four | 103 / 80 (plain twins 121 / 62) | 87 / 96 |
| Lines with a wait | 14 (plain twins 26) | 23 |
| First actions that keep the line's length, around the terrain / plain twin | 47% / 47% | 47% / 45% |
| First actions that keep par | 73% / 67% | 67% / 63% |
| Bot runs at par or better | 51% / 38% | 37% / 38% |
| Bot runs past par + 4 or failed | 3.7% / 3.0% | 4.7% / 2.6% |
| The same, where the plain twin has the same idea and is neither tight nor a Tandem | 96 floors: par 51% / 47%, past par + 4 3.6% / 3.1% | 134 floors: par 37% / 46%, past par + 4 4.3% / 2.4% |
| Bot runs that ended with no move (7,320 runs) | 0 | 0 |
| Legal moves that strand the piece at once, in the positions those runs met | 887 of 303,747 (0.3%), on 14 floors (plain twins: 240, on 2) | 48 of 341,860, on 1 floor (a pawn's, as on its plain twin) |

The floors that fell back: under a crumbling floor 8 Tandems, 4 tight forms,
26 king floors (18 of them a bishop's: none of a bishop's 18 king floors
composed around cracks, its net being indifferent to where the king stands),
8 baits, 3 squeezes, 5 tempo and 2 crown floors; under gates 8 Tandems, 3
tight forms, 2 baits, 2 crown floors, 2 king floors and a tempo floor. By
piece, floors around a crumbling floor: bishop 39%, knight 73%, pawn 73%,
queen 94%, rook 87%; around gates: bishop 89%, knight 79%, pawn 90%, queen
97%, rook 97%.

On whether gates make a floor easier: the bot, which sees a shut gate as a
wall and plans around no rhythm, does not find them so overall. Like for
like it makes par on 37% of its runs against 46% on the plain twins: on
baits 46% against 76% and on king floors 25% against 36%, but on squeezes
50% against 37% and on a pawn's tempo floors 44% against 10% (9 floors).
Gated lines are longer (71 of those 134 take four moves, against 44).
Around the gates a few more first actions keep par than on the plain twins
(67% against 63%), though like for like a few fewer do (68% against 72%).
The bot cannot read "shut now, open next move", which is the whole of the
idea that a gate shows a line's timing, so that half is for play to judge.
(At the first rhythm, two moves a state, it was 38% against 46%.)

A day composes in two to three times a plain day's time. Measured in the
same runs as their plain twins: a crumbling day 4.2 s at the median against
2.0 s on a busy machine, a gates day 1.8 s against 1.1 s on a quieter one; a
queen's day is the slow one, 15 to 30 s on average on the busy machine and
7 s under gates on the quieter. The dev preview composes in
the page, so a queen's day takes a while to open.

Both shipped with rules version 14: the room code holds a room's cracked
tiles or gates as it holds ice (`src/room-code.js`: `^` and a character a
tile, or `=` and two characters a gate, its square and its beat), every
edition was rebuilt, the manual's Room modifiers page describes both, and
the journal is as it was (a terrain floor is still filed under its idea).

## Stored editions

`npm run build` composes every edition from launch (2026-11-01, edition 1)
through two years past the build date and ships its rooms and lines in
`src/editions.js` (`scripts/build-editions.mjs`). Each entry holds:

- `rooms`: the day's three rooms as a room code (`src/room-code.js`: walls,
  start, monsters with their casts and sleep, items, ice; about 100
  characters a day). A chest is one more item, `c` after its square, so a
  room without one has the code it always had.
- `route`: its lines as a route code (`src/route-code.js`), a character an
  action. A partner floor's moves are followed by their recruit order, `~` to
  hold it or `>` and the square it is sent to; a route without orders is
  coded as before.
- `motifs`: the motif each floor was built around (`src/motif-code.js`: a
  letter a floor, `b,s,n`, `d` for the Tandem; a motif the code has no letter
  for is stored by name).
- `partner`, on a day with a partner floor only: that floor, 0 or 1.

The motifs load as `daily.generation.motifs` and the partner floor as
`daily.generation.partner`, a borrowed day taking its template's. Only the
journal reads the motifs (`src/journal.js`): they never change play, and an
entry without them counts as stale, as does one whose partner floor and
Tandem motif disagree, so the next build composes it again. Not stored: a
floor's tight form (nothing at runtime needs it) and a chest's proving line
(above).

The build is incremental: entries that still prove are kept, and only missing
or stale dates are composed, so each build rolls the window forward cheaply.
A day takes under a second at the median and 3.5 seconds at the 90th
percentile; a queen's days are the slow ones (6 seconds on average, the
slowest of the window 146). After a change to the rules, the monsters, the
modifiers, the composer or the human-like bot, run
`npm run build:editions -- --full`: it composes all of them again (the 742
take five to eleven minutes on seven threads, a few queen days taking minutes each) and reports partner floors, tight forms,
chests before and after their checks, and any option a day gave up;
`--stats path` writes a row a day. New rules apply to the whole archive.

The player's app never carries the composer. `generateDaily()` decodes the
stored rooms and lines and proves them as they load. A date past the window
(two years after the last build) borrows a stored day of its own piece and
modifier, picked by the date from the fifty or so the window holds
(`borrowedDaily`): that day's rooms, lines, partner floor and floor seeds,
played in its roles, each species keeping the date's own name and colors, and
the date's own shops. It plays exactly as the stored day does, and proves the
same way.

- `npm run verify:editions` replays every stored edition (seconds).
- `npm run audit:editions` composes every stored date again and compares
  rooms, lines, motifs and partner floor (minutes): a difference means the
  composer changed since the last full build.
- `npm run audit:dungeons -- 2026-11-01 365` replays a year of dailies through
  the public API, validating the save after every action, and counts the
  partner floors and chests it met.

## Par and the Dungeon Bot

Each floor's par is its planted line plus one (`src/par.js`, decided after
play on 2026-11-10): even par means the player found the idea; under par, the
exact line or a clever use of a powerup or the recruit; over par, that they
searched for it. Par is for the official piece, color and monsters; practice
runs with other choices have none. After a daily win with the official piece,
the result paper's Dungeon Bot (`src/bot.js`) replays the planted lines. On a
Tandem floor the line's orders are part of it, so the replay shows the
recruit joining, being posted and taking its twin, and its notes are told of
the bot (`replayNote`).

**The treasure mark.** A floor's chest is taken by ending a move of your own
piece on its square while the door is still shut; the recruit, the monsters
and the coin magnet never take it, and it is gone once the challenge is
complete (`src/rules.js`). It pays 3 gold and is recorded as a `chest` feat.
Taking it earns the floor's 💎 (`treasureMark`), whatever the floor's score, shown beside par and on the share card. The planted line
never takes it, so the Dungeon Bot's replay doesn't either. Practice rooms
hold no chest, whatever the piece: it is the daily's own second goal. A
practice room keeps the day's cracked tiles or gates, and fitting it to
another piece (`fitPracticeRoom`) moves no recruit or pickup onto one.

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
walled in under one is cornered at once (`trapped`), and its floor starts over.

## Saves and versions

Saves carry the rules version (`RULES_VERSION`, 14 since moving terrain took
Breach's days; 13 from the chest, a new item that pays gold; 12 from the
switch) in their key (`daily:v14:DATE`) and
in the state; a run saved under other rules is kept in backups but never
loaded into a new edition. A save of a composed day carries the day's rooms
(`state.composed`), and `validateSave` checks they are the edition's. It
counts each floor's targets and residents from its own room (`floorCensus`:
two pawns make a pawn target there), so captured decoys pay their gold and
grade the floor as they should, and a sleeping decoy may sleep as long as its
room says. A `chest` feat is valid only on a floor whose room holds a chest,
once, with its 3 gold in the ledger, and the chest lies in the room until it
is taken or the door opens (`validChests`); a practice save has neither.

Two records are kept apart from the saves and from the rules version, on
purpose, so a bump leaves them as they were: the streak ledger
(`src/stats.js`: a win scored under earlier rules keeps its score) and the
journal (`src/journal.js`: what was found stays found). Each was first filled
from the saves on the device, where a save under earlier rules counts as a
day won without a score against par and files no journal page: its rooms
were rebuilt, so it can no longer be checked.

Bump `RULES_VERSION` for any change that alters play, then rebuild every
edition with `--full`. A change to the save's shape that alters no play keeps
the version as long as the saves already made still validate: retiring the
random rooms (below) kept version 12. `COMPOSER_VERSION` salts the composer's
seeds; bumping it re-rolls every room, so it changes only on purpose (the
chests, partner floors and tight forms came in without one: each draws from
seeded streams of its own). `HUMAN_BOT_VERSION` marks the bot's own play,
which the composer's guard and the chest's accident check read, so a change
to the bot calls for a full rebuild as well.

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
sees, steers its recruit as a player does, and never goes out of its way for a
powerup. It no longer sets par. The composer runs it as a guard on every
floor, as the third test of a tight form and as the chest's accident check,
and these scripts report what it finds:

- `node scripts/measure-composer.mjs` composes a range of dates and reports,
  per motif and piece, how often instances survive, compose times, lines and
  the bot's runs against par.
- `node scripts/measure-human-par.mjs` runs the bot over the stored editions:
  by piece and floor, runs won, runs past par + 4, the bot's median moves
  against par, and the raw human gap (`humanGap`).
- `node scripts/measure-par-slack.mjs` measures the room each floor leaves
  around its idea: first moves that keep par, and par wins off the idea.
- `node scripts/measure-tight.mjs` composes each date with the tight forms
  off and on and compares, floor by floor.
- `node scripts/measure-treasure.mjs` reports chest coverage, what the two
  checks cost, how demanding each chest is and the bot's accidental marks.
- `node scripts/measure-ideas.mjs` reports the ideas in preview (above): the
  days each fits, draws and composes on, with and without the bot's ceiling,
  what it takes the place of, and the mix of ideas per floor.
- `node scripts/measure-terrain.mjs --modifier cracks|gates` composes each
  date under one of the two terrain modifiers and as a plain day, and
  compares them floor by floor (above); `measure-composer`,
  `measure-par-slack` and `measure-tight` take `--modifier` too.

The scripts that compose do so in the release configuration, as the build
does; `--no-treasure`, `--no-partner` and `--no-tight` each turn one option
off, to compare, and `--wait`, `--lure` or `--ideas` add the ideas in preview
(`scripts/compose-options.mjs`).

Over the 743 editions stored with rules version 14 (40 runs a floor), the bot
cleared 98.7%, 98.5% and 99.9% of its runs on floors 1, 2 and 3, and took more
than par + 4 on 6.8%, 9.0% and 4.4%. Its median moves against median par
were 4, 6 and 5 against 4, 4 and 4. By the day's modifier, runs past par + 4:
plain 6.2%, 9.7% and 4.3%; Ice 7.5%, 9.0% and 4.9%; a Crumbling floor 8.2%,
5.5% and 5.2%; Gates 6.7%, 8.7% and 3.3%. (At version 13 it was 96.6%, 96.3%
and 99.9% cleared and 11.6%, 12.0% and 4.3% past par + 4, measured with a
Tandem on every day whose matchup has one: 360 days, against 113 now.) The
king floors are as they were at the switch (4.4% past par + 4; 0.5% on a
pawn's). Floors 1 and 2 stood at 99.6% cleared and 4.6% and 6.7% past par + 4
then; what moved them is the Tandem, where the bot is no measure from the
floor's own start. On those 360 days it made par there in 60% of its runs, most Tandem floors
in 30 or more of its 40 and about a hundred in fewer than 10, and fails or
passes par + 4 in 30%: when its first moves don't cross the recruit it never
thinks to fetch it, and alone it can't take a twin uncaptured. (The floors
the Tandems replaced had it at par in 44% of runs and past par + 4 in 5%.) On
the tight floor 2s it makes par in about 1% of its runs, against 25% to 48%
on the plain floors they replaced.

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
