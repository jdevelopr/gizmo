# GIZMO 2 — Claim the Plot

A two-to-four player factory builder for one big screen and a pile of phones.

GIZMO 2 lives beside the original: the game at the repository root is untouched and
still deploys exactly as it did. This folder is a complete, self-contained copy that
diverges from it, so both ship from the same Amplify site — the original at `/`, this
one at `/v2/`.

---

## What changed, and why

The original is a spatial puzzle party game. Every round the Seller jumps to a new
face and your line is deliberately invalidated, which is a great party mechanic and
the exact opposite of what makes a factory game work. GIZMO 2 keeps the simulation —
the backpressure, the custody model, the tier ladder — and rebuilds the round
structure around permanence.

**Your factory persists.** The line you build in round one is still running in round
eight. Nothing is ever taken away from you.

**You open with nothing but plumbing.** The starting line is a belt run from the
Producer to the vault, moving raw Scrap at a dollar a piece — about $33 a round. The
first Mutator you buy triples it. GIZMO 1 opened with a free Doubler, which taught
the wrong lesson twice over: it hid the tier ladder behind a flat multiplier, and it
handed you the one machine you now cannot buy until deep into the research tree.

**The plot is a claim, not a room.** You start owning a 3x3 corner of a 7x7 plot.
Everything beyond your fence is dirt: you cannot build on it, and anything fired into
it is lost as surely as if it had gone off the edge of the world. Land is bought
during planning, on a ladder that climbs steeply — the first step out is nearly a
formality, the last one is a real commitment.

**The vault rides the fence.** It is welded to the east face of your claim, so
expanding pushes it outward and your line needs one more belt to reach it. That is
the only rebuild tax left in the game, and it is one you opted into by expanding. A
second vault opens once the plot is 5 wide, on the far corner of the same face, which
is the point at which running two arms is worth the slots.

**Pressure comes from the order board.** Each round posts a target worth 15% more
than your own best round so far. Filling it pays a bonus of a third of the target;
missing it costs nothing but the bonus, so one bad round can never bury anyone. The
target is measured against your own history rather than a fixed curve because round
length, plot size and above all routing skill swing achievable income by an order of
magnitude — any single ladder of numbers is either free for a good player or
impossible for a new one. A floor under it keeps the target climbing even after a
flat round, so standing still stops paying.

**A machine costs the same in round eight as in round one.** The catalogue used to
mark everything up a little each round, compounding, which is a reasonable instinct —
a late purchase should feel like a commitment — but it makes the wrong thing
expensive. Growth here already costs more the further you go: land climbs steeply, so
do machine levels, and so does each routing machine after the first few in a round.
Inflation on top of that punishes whoever is behind, taxes a plan made in round two
and paid for in round five, and turns a price list you could learn into one you have
to re-read every round. Stable prices are something you can build a plan around.

**The economy is calibrated, not guessed.** Prices in GIZMO all multiply, and
multiplications compound quietly: the inherited numbers marked the shop up 55% a
round — 21x by round eight — and put maxing the Producer, the one upgrade that raises
the raw ceiling everything else depends on, at $8,670 against an opening income of $67
a round. Every ladder has been reset against what a floor can actually earn, and the
per-round markup is gone entirely. `tools/economy.mjs` prints the whole cost structure
plus worked builds run through the real simulation, so the question "can I afford the
thing I am trying to build" has an answer rather than a vibe. Every build in that
table pays for itself inside two rounds.

**Routing is its own thing now.** The old Splitter copied — original ahead, copy to
the right — which meant the only way to send gizmos two ways was to make more of
them, and every fork was also an economic decision. It is gone, replaced by two
machines that route and nothing else:

- **Balancer** — one in, one out, alternating between its exits. Divides a stream
  instead of inflating it. If the exit it picked is backed up it takes another,
  because a divider that stalls on one busy arm is not dividing anything. **FLIP**
  moves its branch to the other side without turning the through line — rotating
  would move both, and the through line is usually the part you had already got
  right. One dropped where its branch would fire at unbought land flips itself.
- **Sorter** — the gizmo type it is set to goes out to the side, everything else
  goes straight ahead. Its filter is free to change from the phone, like rotating.
  It never reroutes on a jam: sending a Cobalt down the Scrap line because the
  Cobalt line was briefly full would defeat the whole machine.

Neither makes a gizmo worth more, so both are plumbing: on sale from the phone in
any phase, outside the workshop's one-machine-a-round limit, sharing one price
ladder and one counter with conveyors. Each round's cheap allowance is a budget you
spend how you like — a long belt run, or one Balancer and a Sorter. Conveyors also
came out of the workshop deck, so a shop card is never wasted on a belt.

**Two feeds, and recipes that need both.** Claiming your first ring of land opens a
second Producer on the west face, one row below the first, dropping **Resin**. Resin
is worth almost nothing sold: it exists to be half of a recipe. Fusers climb it —
two Resin make a Cord, two Cords make a Frame — and an **Assembler** marries a Part
to an Alloy and makes a Product worth far more than either.

```
Producer A  Scrap -> [Amber Mutator] --------.
                                              v
Producer B  Resin -> [Fuser: Cord] -----> [ASSEMBLER] -> Engine -> vault
```

There are now three families. **Alloy** is the original Scrap-to-Prism ladder,
completely unchanged. **Part** is Resin, Cord, Frame. **Product** is Engine, Turbine,
Reactor — terminal, since nothing mutates or fuses a finished product. Fusers climb
within a family and never across one.

The Assembler is the first machine whose inputs are not interchangeable, which makes
it the first that could deadlock — fill both hands with Cord and it waits forever for
an Amber that can no longer fit. So acceptance became type-aware: a machine now
refuses a gizmo it cannot use, and the belt feeding it the wrong thing backs up
visibly instead of poisoning it. Fusers use the same rule to refuse mixing families.

A slot running an Assembler earns roughly three times what a slot running a Mutator
does, but needs four or five slots behind it to stay fed and twice the raw material.
Recipes are what you build when the floor has outgrown its feeds, not what you open
with.

**Research is what growth costs.** The **Lab** is a port on the fence, like a vault,
sitting on the north face of the very slot your first vault trades from. Push a gizmo
into it and you get science worth exactly what the vault would have paid — no bonus,
no penalty — so the only thing research costs you is the money you did not take.

That adjacency is the whole design. The last slot of a line can fire east into the
vault for cash or north into the Lab for science, so spending now versus growing
later is one rotation apart, and splitting your output between the two is finally
what a Balancer is for.

```
                       [LAB]  science
                         ^
 ... -> [Mutator] -> [Balancer] -> [VAULT]  cash
```

**Three phases, not four.** BUILD and WORKSHOP were split back when the shop dealt
three random cards and let you keep one — a hand you were *given* was a genuinely
different moment from a floor you were *arranging*. The catalogue ended that, so they
are one phase now: **BUILD → SHIPPING → TALLY**. You buy a machine and immediately see
where it landed, which is the order you wanted to do it in anyway, and there is one
READY button instead of two. Round one is no longer a dead round spent watching the
starter line before you are allowed to spend anything.

**The random workshop is gone.** Three cards and a reroll made sense when the shop
was the only way to get machines; once you pay production for a tech node, that node
has to actually hand you the thing. So the build phase is a **catalogue** of
everything you have unlocked at this round's prices — buy as many as you can afford,
with slots as the only limit — beside a **tech tree** you spend science on. No
randomness, no reroll, no one-machine-a-round cap.

You start able to build Conveyors, Balancers, Mutators and Fusers, which is a
complete game on its own. Eight nodes make it bigger: Sorting and Warehousing put the
Sorter and Storage on sale, Assembly opens recipes one at a time, Overclocking raises
every machine's upgrade ceiling from level 2 to 3, and deep behind it sit Replication
and Trifurcation.

**Duplication has a hard ceiling.** Copying is the only thing in GIZMO that makes a
gizmo out of nothing — a Doubler behind a Prism Mutator would print hundreds of
dollars a second against an economy anchored near four and a half. Rather than nerf
it into uselessness, it simply cannot hold a pattern worth more than Cobalt: feed it
something richer and it passes straight through, uncopied. Its levels buy extra exits
rather than speed, and it sits behind two research nodes. A rule you read off the
card instead of discovering in the balance sheet.

**Ratios are visible.** Every machine reports its rate in jobs per second, and the
two failure modes are drawn differently because they want opposite fixes: amber all
round the casing means BACKED UP (holding finished goods, fix the line ahead), four
cool blue corner ticks mean STARVED (standing idle, fix the feed behind).

---

---

## Setting up a match

The Setup panel is shared by the floor screen and solo, so a solo run is exactly the
match a room would play. Its dropdowns are drawn rather than left native — a system
select renders rounded and grey and reads as a hole punched in a page built out of
hard-edged pixels — and the chevron is two stacked pixel wedges rather than a
background image, which would smooth on a high-density screen when nothing else here
does.

**Rounds is a number you type**, anything from 1 to 999, beside an **ENDLESS** toggle
that greys it out. Endless runs until the floor screen calls it: the order board asks
for more either way, so a match ends when you decide it has rather than when a counter
runs out. Both the floor and solo get an END MATCH button that arms on the first tap
and fires on the second.

**And it tells you how long the match will take**, which is the one thing a group
actually needs to know before starting and the one thing the panel never said. A round
is the build phase plus shipping plus the tally, but the build phase ends the moment
everyone taps READY — so its clock is a ceiling, not a duration. The estimate is a
range: a table that readies up briskly against one that burns every second it is
given. Twenty rounds at the standard settings is about 46–81 minutes; endless quotes
per-round instead.

## Playing alone

Solo runs the whole match on one device with no phones and no networking, and it is
reachable from everywhere — including from inside the join flow. A phone that scanned
a code is never stuck because the room filled up, the floor screen closed, or the
person simply wants to play now: **PLAY SOLO INSTEAD** sits in the phone lobby and on
the connection-failure screen, and both tear the peer connection down before starting.

On a wide screen solo draws the floor view beside the pad, which is how you preview a
board size before putting it in front of people. On a phone the floor view is hidden
entirely — it and the pad draw the same factory, so showing both spends half a
390-pixel screen saying the same thing twice — and the pad announces the rounds
itself instead.

## The phone

The pad is an app shell, not a page. One status line, the board taking every pixel
that is left, and a dock at the bottom holding one panel at a time — SELECT, BUILD,
TECH, CRATE. The board never scrolls out of reach and the controls never compete
with it for room.

It got that way because it had to. Each phase of this project appended its controls
to the end of a single scrolling column: the order strip, two more routing buttons,
CLAIM LAND, a FILTER button, a tabbed build sheet. By the end that was about 600px
of chrome above the fold on a phone, and the board — the actual game — was a sliver.

The four tabs are **BUILD**, **TECH**, **CRATE** and **RECIPES**. There is no SELECT
tab: tapping a machine opens its controls by itself, so a button that took you
somewhere you had already been taken was a quarter of the dock spent on nothing. The
selection panel simply covers whichever tab is open and uncovers it again when you
drop the selection.

RECIPES is every transformation in the game in one place — fusing, Assembler recipes
(greyed until researched), Mutator rates, and the handful of rules that are not
obvious from any single row. It is generated from `machines.js` like the manual is,
so it cannot drift. It exists because "what do two of these make" is a question that
comes up mid-round, and leaving the floor to answer it is the wrong shape.

**The Producers, the vaults and the Lab are tappable.** They are drawn outside the
grid, so they fell through the slot hit test and were the three most important
objects on a floor that you could not ask about. Tapping one opens it in the same
panel a machine uses: what it drops and how fast, what a vault pays, what the Lab
converts — and the upgrade that runs it, which also gives those two upgrades a
second and far more discoverable home than a heading in the BUILD tab.

Three things the dock buys beyond room:

- **Selecting a machine snaps to SELECT, and dropping it snaps back** to whatever
  you were doing. A permanent selection strip costs the same pixels whether or not
  anything is selected; this costs them only when they are useful.
- **The catalogue and the tech tree are live in every phase**, so you can price a
  machine while watching the floor decide it needs one. Only the buying is gated.
- **One action button** that reads whatever the round is asking for — READY while
  planning, DONE BUILDING in the build phase. Two buttons for two phases that never
  overlap was two buttons' worth of screen for one button's worth of meaning.

Tapping unbought land opens BUILD and nudges CLAIM LAND, rather than doing nothing.
Tabs badge what is waiting on them: how many machines are in the crate, how many
research nodes you can afford right now.

In landscape the dock moves to the right-hand side and the board keeps its height,
because a sideways phone is exactly the wrong shape for a square board stacked above
a drawer.

## The files

Identical in shape to the original. What GIZMO 2 changed:

```
js/machines.js    claims, expansion, vault geometry, orders, families, recipes
js/sim.js         the claim is the edge of the world; growth; starved detection;
                  two producers; acceptance that knows about type
js/game.js        per-player orders, land purchases, the catalogue and the tech tree
js/render.js      unbought land, the fence, the starved badge
js/player.js      the whole pad: the dock, its tabs, and everything in them
js/howto.js       the manual, still generated from machines.js on open
tools/lint.mjs    parses every module as a module, the way the browser will
tools/routing.mjs proves the Balancer divides and the Sorter sorts
tools/recipes.mjs proves an Assembler cannot deadlock, and the chain runs
tools/economy.mjs every price at every round, and what real builds pay back
tools/tech.mjs    proves research gates the game and the Lab pays what a vault does
tools/pad.mjs     drives the phone UI headlessly against the real index.html
tools/balance.mjs an ordinary-player bot, for calibrating the numbers
tools/verify.mjs  headless assertions over a whole match
```

Everything else — `net.js`, `host.js`, `main.js`, `setup.js`, the renderer's core —
is the original, unchanged.

## Checking it

```bash
node tools/lint.mjs       # will every module parse in a browser?
node tools/verify.mjs     # invariants: nothing on unowned land, vaults on the fence
node tools/routing.mjs    # the Balancer divides evenly; the Sorter never misroutes
node tools/recipes.mjs    # two feeds, two lines, one Assembler, no deadlock
node tools/economy.mjs    # the cost tables, and what worked builds earn back
node tools/tech.mjs       # the gate binds, the Lab pays, duplication stays capped

npm i jsdom               # once, anywhere; the pad harness is the only thing needing it
JSDOM_PATH=$PWD/node_modules/jsdom node tools/pad.mjs
node tools/balance.mjs    # what an ordinary player actually ships, round by round
```

Run the linter after any edit and the other two after touching a number in
`machines.js`. The linter exists because `node --check` parses a file as CommonJS,
where a template literal closed with the wrong quote slips through and then breaks
the page on load — it copies each file to `.mjs` first so the parse matches the
browser's.

## Running it

Same as the original — plain HTML, CSS and JavaScript, no build step. Modules will not
load from a `file://` URL, so serve the folder:

```bash
cd GIZMO
python3 -m http.server 8080
```

Then open <http://localhost:8080/v2/>. **PRACTICE RUN** plays the whole thing solo on
one device with no phones and no networking, which is the fastest way to feel whether
permanence lands.

On Amplify this folder deploys with the rest of the repository and is served at
`/v2/`. Join links are `https://yourapp.amplifyapp.com/v2/?room=ABCD`.
