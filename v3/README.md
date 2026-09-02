# GIZMO 3 — Keep the lights on

A single-player factory builder for a desktop computer, on a world fifty-six slots
a side.

GIZMO 3 lives beside the other two. The party game at the repository root is
untouched, GIZMO 2 in `v2/` is untouched, and this is a third self-contained copy,
so all three ship from the same Amplify site — the original at `/`, GIZMO 2 at
`/v2/`, this at `/v3/`.

---

## What it is

You own a **three-slot square** in the middle of a fifty-six-slot world, and nothing
else. All nine of those slots are ore. Put an Extractor on one, a Market Depot a
couple of slots away and a Conveyor between them, and that is a factory: ore out of
the ground, along a belt, into money.

Everything after that is making the line longer, wider, and worth more — and finding
room for it. Ore gets richer the further out you go, land gets steeply dearer, and
the second ore you need is a dozen rings away.

The **first** time you play, a card in the corner walks you through building that
opening line. Every time after that, a new world just opens empty.

There are no rounds, no phases, no other players and no clock. The factory runs
from the moment you open it until you close the tab, and it is still there when you
come back.

---

## What changed from GIZMO 2, and why

GIZMO 2 was already most of a factory game: permanent factories, a tech tree, a
catalogue, backpressure, a tier ladder, recipes that need two feeds. What it was
not was **big**, and almost everything here follows from fixing that.

### The world is 3,136 slots instead of 49

Forty-nine slots is a puzzle. Three thousand is a place. The change is not really
one of degree — at 49 slots you are choosing which four machines you can afford to
fit, and at 3,136 you are choosing where the second smelting arm goes and how you
are going to get power out to it. Those are different games, and only the second
one is Factorio-shaped.

Scale is also what makes the map matter. A generated 7x7 plot could decide where
three fixtures sat on a fence; a generated 56x56 world decides where the *ore* is,
and everything downstream of that — where your extractors go, where your generators
have to go to reach them, how long the belt home is, which direction is worth
buying land in — falls out of that one decision.

### Nothing is welded to a fence any more

The Producer and the Seller were bolted to the outside of the floor in both
previous games, because on a small square that is a legitimate design: it is a
rule, and the rule generates the puzzle. On a world this size the same rule is a
cage. So all four fixtures became machines you build and move:

- The **Extractor** replaces the Producer. It occupies a slot, faces a direction,
  and only works standing on ore. Its speed is the patch it is standing on, which
  is what turns the map's geography into an engineering problem — a 2.4x patch out
  past your fence is worth three ordinary ones, and reaching it is a project.
- The **Market Depot** replaces the Seller. Put it anywhere; anything pushed into
  its **one mouth** sells instantly at market value. Depots climb a price ladder —
  the twentieth costs a great deal more than the first — so covering the map in
  them is not the answer to "my line is far from a depot". A longer belt is.
- The **Research Lab** replaces the Lab port. Same deal: build it, aim a belt at
  it, and what goes in becomes science worth exactly what a depot would have paid.
- The **Generator** is new, and is what the rest of this is about.

They all fell out of the existing simulation nearly for free. An Extractor is a
machine with an intake of zero; a Depot is a machine with a mouth and no exits.
That the model absorbed both without a special case is the best evidence that the
model was right.

### Power

Every machine draws kilowatts while it is working. A **Generator** makes them by
burning gizmos you feed it on a belt, and the power spreads outward from its slot
**through touching machines** — a conveyor conducts exactly as well as an Assembler
does — for a limited number of hops before it runs out.

That single rule does a great deal of work:

**The fuel line is the power line.** A generator needs a belt bringing it ore, and
that same belt is the wire carrying its power back out into the factory. You never
build a wire. A long arm reaching for a distant patch is automatically powered
along its whole length — right up until it is longer than the reach, at which point
it needs a generator of its own out at the end, which needs its own fuel, which is
a real and interesting problem, and which is why expanding feels like expanding.

**Gaps break grids.** Two blocks of factory with one empty slot between them are
two grids, and a generator in one does nothing for the other. One conveyor laid
across the gap merges them. It is the cheapest and most satisfying fix in the game,
and the game will tell you when it is the fix you need.

**Nothing ever switches off.** A machine no generator reaches still runs, at 20%
speed, forever. That is not a failure state — it is the state your very first
factory is in, which is the point: power is something you *discover* is worth
building rather than a gate you have to pass before the game starts. The opening
factory works, and it is slow, and the first thing you will want is to know why.

What does hurt is a **brownout**. A grid whose machines demand more than its
generators supply runs everything on it at a speed that falls with the *square* of
satisfaction — 70% supplied runs at 59%, half supplied runs at 33%. Being short on
power is always worth another generator, immediately.

**Burning your good stuff is always a mistake.** A gizmo's energy is roughly the
0.4 power of its market value, so a Prism is worth about ten Scrap in the firebox
and three hundred and twenty of them at a depot. Nobody has to be told to burn raw
ore; the numbers say it. A dedicated ore line running to your generators is the
correct answer and the game lets you work that out yourself.

### There are no rounds

GIZMO 2 ran BUILD → SHIPPING → TALLY, and by the end of that project the round was
mostly getting in the way — the build phase had already been merged with the
workshop, and the catalogue and the tech tree had already been opened during
shipping, because a live floor is where you learn what it needs. The only thing
rounds were still doing was providing a moment at which to measure you.

So they are gone, and the two things they were carrying were rebuilt:

- **Contracts** replace the order board. Each one asks for a quantity of one type,
  delivered to a depot, before a clock runs out, and pays 35% over market. They are
  generated from what your factory has actually been shipping — a contract for
  Reactors handed to a factory that makes Scrap is not pressure, it is noise — so
  they scale with you and can never become impossible. Missing one costs nothing
  but the premium.
- **Milestones** replace the tutorial nobody wrote. Six things a new factory has to
  discover, listed on the ORDERS tab with a one-line hint each, ticked off silently
  as they happen and never mentioned again.

Pausing is a key, and there are 1x, 2x and 3x speeds, because a game with no rounds
needs somewhere to put the "I want to think about this" button and the "I want to
watch this run for a while" one.

### One belt can feed a machine that needs two things

This was the single worst thing in the game and it is worth writing down plainly.

A Fuser and an Assembler each used to keep *one shared queue* and refuse anything
they were not immediately short of. So merging two feeds onto one belt — the
obvious, slot-saving thing to build, and the thing every screenshot of a real
factory shows — put one gizmo into an Assembler and then stopped the entire factory
**forever** the moment the next gizmo along happened to be the same kind. Measured:
a Fuser fed Scrap and Resin down one belt earned **$0** in ninety seconds; an
Assembler fed both its ingredients down one belt earned $34 and then nothing ever
again. The same build with its feeds on two separate faces earned $1,122.

Worse than the deadlock was that it was invisible. It drew the same amber badge as
a machine that was merely busy, and there are always dozens of those.

Three changes:

**Separate queues per ingredient**, three deep. The machine takes what it needs out
of a mixed stream and the queues absorb the ordering — a run of Cords fills the Cord
queue and the Ambers behind it still get in. A Fuser keeps queues for two different
types at once, so one belt of Scrap and Resin feeds one Fuser and gets Copper and
Cord back. Both machines got much bigger mouths (three units to eight) to go with
it. The mixed-belt Assembler now earns the same $1,122 as the separated one.

**A badge means a stall, not a hiccup.** Everything on a line running at capacity
blocks for a fraction of a second on nearly every cycle — that is what running at
capacity *is* — and badging those turned a healthy factory into a screen full of
alarm nobody could read. Nothing is badged now until it has been stuck for over a
second, and BACKED UP is corner brackets rather than a ring painted over the machine
you are trying to identify.

There is deliberately no "N machines backed up" line in the corner. A factory
running at capacity always has machines holding finished goods — that is what
running at capacity *is* — so the count was almost never zero and almost never
actionable, and a corner that is always shouting is a corner nobody reads. The
amber brackets on the machines themselves still say which ones.

**Three states, not two.** *Backed up* means fix the line ahead. *Starved* means fix
the feed behind. *Waiting* — new — means it has some of what it needs and not all of
it, and rather than a badge meaning "something is wrong somewhere" it shows **the
colour of the thing it is short of**. And a line that has stopped *for good*, because
something is being pushed into a machine that can never accept it, gets a red ring
and a sentence in the corner naming the gizmo and the machine, because that one will
still be dead in twenty minutes.

Two smaller consequences. A Fuser now melts **two of the same type** — which is what
its card always said, and what everybody assumed — rather than climbing from the
higher of two different rungs. And the **Sorter is on sale from the start**: pulling
one type out of a mixed line is plumbing, it is the answer to a problem a factory
hits in its first ten minutes, and every other routing machine was already
unresearched. Warehousing opens the tech tree instead.

### There is a crate

You can put a machine down on a slot that already has one on it. Whatever was there
goes to the **crate**, a list at the bottom of the build bar of machines you own but
have not put anywhere — keeping its level and its settings, free to put back down,
because you already bought it once. Right-clicking a crate row sells it at the
ordinary scrap rate if you would rather have the money.

The point is that rearranging a factory should be *moving things*, not a sequence
of scrap-and-rebuy transactions where every change of mind costs you half of
whatever you changed it from. GIZMO 2 had a crate for the same reason; GIZMO 3 lost
it when the shop became a catalogue, and putting a Mutator where a conveyor was
turned out to be the single most common thing anyone does.

Dropping the *same kind* of machine on a slot is the exception: nothing is crated
and nothing is charged, it simply turns to face the way you meant. That is what
makes dragging a conveyor back along a run you already laid fix its direction
rather than bill you for the whole run again.

### The three Assemblers look like three different machines

One casing and one picture meant a floor with an Engine line and a Turbine line on
it was a floor where you had to click a machine to find out which was which. Now
everything that differs between them shows: the plate is tinted by what it makes,
the window in the middle *is* what it makes, the two intake ports are the colours of
the two things it eats, and the studs count the tier. Zoomed out, where there is no
room for any of that, an Assembler is drawn in the colour of its product rather than
the colour of an Assembler — three of them side by side stay three different things
at every zoom.

### Depots and Labs have one mouth

Every other machine on the map takes from any of its four sides, which is right for
plumbing and wrong for the two machines a line *ends* at. A Depot with four open
faces is not a building, it is a wall that any number of arms can be shovelled into
from any angle, and it made "where does this line finish" a question with no
content.

So a Depot and a Lab have a single opening, on the side the arrow points into, and
are solid on the other three. Selling two things means two Depots, or a Balancer
merging the arms before they arrive — a routing problem where there used to be none.
A belt aimed at a solid side visibly fails to join up, and because that is a stall
that will never clear on its own, the corner names it and says which way the mouth
actually faces.

The mouth **aims itself**, on two conditions that between them keep it helpful
rather than magic: it only ever turns while nothing is feeding it, so it can never
break a line that is running; and it stops turning itself for good the moment you
rotate one by hand. Laying a belt at a Depot just works, and taking charge of one
is a single keypress that sticks.

### Anything can be switched off

The one thing a factory could not do was *stop*. Every problem in this game is
diagnosed by watching a line run, and there was no way to hold half of it still
while you looked at the other half.

`O`, or the button in the panel, switches any machine off. An off machine does
nothing, draws no power, and turns everything away — so the line behind it backs up
and stops, which is the point — while keeping whatever is already in its hands. It
is drawn dimmed with a power symbol on it, and it is exempt from every stall badge,
because a machine you switched off is not stuck.

Cut a branch you are rebuilding, stop an Extractor flooding a line you are
re-routing, or take a generator off a grid to see what it was actually carrying.

### Litter can be swept up

Nothing on this map is ever destroyed — that is the rule the whole backpressure
model rests on — so scrapping a machine or turning a belt round leaves whatever was
in the air lying on the floor. It counts against that slot's room, which quietly
makes the slot harder to feed, and there used to be no way to pick it up.

Now a bare slot with something on it offers SWEEP UP in the inspector, and the
right-click scrap gesture sweeps as well as scraps, so a right-drag along a wrong
belt run leaves clean ground behind it — give or take whatever was still in the air
when it passed. Sweeping pays nothing:
it is a change of mind rather than production, and paying for it would turn
demolishing a line into a way of laundering gizmos into cash.

### The map starts empty, and the first visit is walked through

The game used to hand you a working line and let you work out the rest. That is a
fine way to open a game somebody already understands and a poor way to open one they
do not: the single most important thing about this map — ore comes out of the ground,
goes along a belt, and turns into money at the other end — was something you were
shown the *result* of rather than something you did. And the very first hint the game
gave you was about **power**, which is the fourth thing to learn, not the first.

So nothing is built. On a first visit a card in the corner asks for six things in
order, and between them they cover every verb this game has that other games do not:
an Extractor that only works standing on ore, a Depot that is a building rather than
a wall, belts laid by dragging, a Generator that has to *touch* the line, fuel that
is the ore you just dug up, and a fence you pay to push outward.

It watches the factory rather than the mouse. There is nothing to click through, no
order it insists on — build the Depot first and two steps tick together — and it
never blocks anything. It takes the alert box's corner while it runs, because the
alert would only be saying a terser version of the same thing. Skip is always there,
it survives a reload mid-lesson, and it is one line in the menu to see again.

Once it has run once, this browser never sees it again unless it is asked for. Every
new world after that opens with an empty claim and $650 — enough for the Extractor,
the Depot, the belt, a Generator and the Balancer that feeds it, with a little over.

### The claim is centred, and it starts at three

Both earlier games anchored the floor at the top left and grew it down and right,
which is fine when the floor is the world. Here the claim is a square in the middle
of the map and every purchase adds a ring, so expansion is a **direction you
choose** rather than a diagonal you get pushed along.

It starts at **3x3**. Nine slots holds the opening line and leaves six, which is
exactly enough to fit a Generator and the Balancer that feeds it if you think about
where they go. The opening is a packing puzzle with one obvious first move and a
fence you want to push outward inside a minute, which is a better first ten minutes
than a ten-slot square with room to spare.

Two things multiply in the price of a ring, and separating them is what makes the
curve behave. A ring bought on a claim of side `c` hands you `4c + 4` new slots, so
what you get for your money grows on its own — sixteen slots at the start, two
hundred and twenty-four at the rim. On top of that sits a 16% markup per ring
already bought. The result is cheap early and steep late, deliberately: the first
ring is **$24**, the first three together cost less than a Generator, and by the
outer third a ring is tens of thousands. The whole world is about $90,000.

Everything outside your fence is exactly as fatal as the edge of the world: you
cannot build on it and a belt aimed at it throws away what it carries. That rule is
inherited unchanged, and on a map this size it is the mistake you will make most.

### Slag and Sap are kept a long way apart

The two ores used to scatter under the same rule with three slots between any two
patches, and one of each was placed inside the opening claim. Which meant the
Part-and-Product half of the game — two feeds, two lines, an Assembler where they
meet, the most interesting thing this game asks anybody to build — collapsed into
putting two Extractors next to each other. That is not a logistics problem, it is a
shrug.

Now a patch of one ore clears a wide berth around every patch of the other, and
there is no Sap anywhere near the middle: the nearest is nine to nineteen rings out,
depending on the world. Running a Part line is an expedition — a long belt haul
across bought land, or an outpost at the patch with its own Generator and its own
fuel line. `tools/world.mjs` walks four hundred worlds checking that every one has
Sap in it somewhere findable, that none of it is near the start, and that the two
ores never come within eight slots of each other.

The opening patch went the other way. All nine slots of the starting claim are Slag
and the patch grows outward from them into the first rings you will buy, because on
a nine-slot claim there is no room to be picky about where the second Extractor
goes, so the map does not ask.

### Conveyors are drawn as one belt, not as a row of boxes

A conveyor used to be a box: a casing all the way round, a channel across the
middle, done. Twenty in a row read as twenty boxes, and a corner read as two boxes
at right angles rather than as a belt that turns.

They are built out of **arms** now. Each arm runs from the centre of the tile to one
edge, and an arm is drawn for the direction the belt fires and for every direction
something feeds it from — so a straight run is two arms meeting in the middle, a
corner is two arms at right angles, and a merge is three or four. Because every arm
goes right to the edge at the same width, the arm on this side of a boundary lines
up exactly with the arm on the other side, and a run becomes one continuous trough
with rails down both sides. A belt with nothing feeding it still draws its back arm,
so a lone belt is a belt rather than half of one, and an arm with nothing on the far
side gets an end cap, so where a run stops is visible.

The rails are drawn *before* the troughs on purpose: at a junction the trough simply
erases the rail that would otherwise run across the opening, which is what turns
four arms into a crossroads instead of a plus sign. Belts skip the generic casing
entirely — a box round each one is exactly what stopped a run reading as a single
belt — while everything else keeps one, because a Mutator is an object sitting on
the floor and should look like it.

Which edges join is worked out in `sim.relink`, when the map changes rather than per
frame: asking four neighbours for their exits sixty times a second for a thousand
belts is a lot of work to arrive at the same answer.

Two badges came off plumbing at the same time. An empty conveyor is not starved, it
is what most of a factory's belts look like most of the time, and four blue corner
ticks on every tile of every quiet run broke up exactly the line the new art works
to draw. The off-grid bolt went the same way: the dim wash over a whole run says it
once, where the icon said it forty times.

### The renderer is new

Three thousand slots cannot be drawn the way forty-nine were. The ground — terrain,
ore, the fence — is painted once onto one big offscreen canvas and every frame
blits the rectangle the camera is looking at. Machine casings are cached as 32x32
tiles keyed by everything that changes their shape, so ninety-six tiles cover every
conveyor on the map however many there are. What is drawn live is only what changes
per frame: cargo, progress, the two jam badges, the power tint. Below 24 pixels a
slot the detail falls away and a machine becomes its own colour and a facing tick,
which is what makes the whole-world view cost the same as the close-up.

The art is still authored on a 32-pixel grid with every rectangle on a whole pixel,
and text is still drawn on a separate overlay at the display's own resolution,
because magnifying a rasterised 8-pixel font is what makes pixel UI look soft.

### It saves

A thirty-minute party game does not need a save file. A desktop factory is a
two-hour object and closing the tab must not cost it, so the game autosaves every
twenty seconds and on the way out. The world is not stored — it is a pure function
of its seed — so a save is the seed, the handful of slots you have cleared, and the
machines. Gizmos in flight are deliberately not saved: reloading empties the belts,
which costs a few seconds of production and saves a great deal of complexity.

---

## What survived untouched

The parts of GIZMO 2 that were right are here exactly as they were, and it is worth
saying which:

**The custody model.** A machine takes what it eats *into its hands* for the whole
cycle. A machine that cannot hand its results on keeps holding them, which fills
it, which turns its own feeder away, and so on back up the line until the extractor
at the far end simply stops. Nothing on the map is ever destroyed except by being
fired off your own fence.

**The two copy rules.** A copy is never copied again, and it takes two originals to
make an original. Together they keep multiplication as a way to *fill* a factory
rather than a way to print money. Copies are drawn dim and unlit; nothing above
Cobalt can be copied at all.

**The tier ladder and its equilibrium.** Value roughly doubles each rung while the
Mutator that prints it runs half as fast, so every Mutator earns about the same per
slot — around 4.5 $/s. That number is the anchor every other number in
`machines.js` is set against, and it transfers to a real-time game unchanged
because dollars per second were always dollars per second.

**Three families.** Alloy from Slag patches, Part from Sap patches, Product only
from an Assembler marrying one of each. Fusers climb inside a family and never
across one, and a machine refuses what it cannot use rather than deadlocking on it.

**Type-aware acceptance**, **the Balancer that skips a busy exit**, **the Sorter
that never reroutes on a jam**, and **the two failure badges** — amber all round
the casing means BACKED UP, cool blue corner ticks mean STARVED, and they are drawn
differently because they want opposite fixes.

---

## Controls

| | |
|---|---|
| `1`–`0` | pick a machine up to build |
| click | place it, or select what is already there |
| drag the map | move around — with a Conveyor in hand, a drag lays a whole run instead |
| `R` / `Shift R` | rotate |
| `F` | flip a Balancer or Sorter's branch to the other side |
| `Q` | pipette — copy what is under the cursor into your hand |
| `M` | pick a machine up and move it, for free |
| `O` | switch a machine off, or back on |
| click a machine | its recipe as a picture, what is inside it, and what it is short of |
| build on top | replaces what is there; the old one goes to the crate, free to put back |
| `X` / `Delete` | scrap a machine for half of what it cost — or, on a bare slot, sweep up what is lying there |
| right click | put down what you are holding, or scrap what is there — right-drag takes out a whole run, litter and all |
| `V` | show the power grid |
| `C` | buy the next ring of land |
| `E` | clear rubble |
| `WASD` / arrows / middle-drag | pan (middle-drag works with a machine in hand) |
| `+` / `−` | zoom one step — the two buttons beside the speed controls do the same |
| `Space` | pause · `[` and `]` change speed |
| `Esc` | drop what you are holding, then open the menu |
| `?` | the manual, generated from `machines.js` so it cannot drift |

---

## The opening, in order

1. You are handed an Extractor, five conveyors and a Depot, earning about $0.18 a
   second. The top-left corner says **UNPOWERED** and tells you every machine is
   running at a fifth speed.
2. Scrap one belt in the middle of the run, put a **Balancer** there, and hang a
   **Generator** off its branch. The balancer now sends every other gizmo into the
   firebox, the whole line comes up to full speed, and income roughly quadruples.
   That is the whole power mechanic taught in two purchases.
3. Buy a **Copper Mutator** and drop it in the line. Income triples again.
4. Build a **Research Lab**, split your output between it and the Depot, and the
   tech tree starts moving. Research costs you the money you did not take, never
   cash in the bank.
5. Buy a ring of land, put a second Extractor on the better half of your patch, and
   run a second arm.
6. Somewhere around here you will notice your generator and your production line
   are competing for the same ore. Give the generator an extractor of its own. It
   is worth about 50% more income for one machine and it is the moment the game
   clicks.

---

## The numbers, measured

`tools/economy.mjs` lays out five real builds on a real map, runs each of them
through the real simulation for two and a half minutes, and counts the dollars. It
is not a spreadsheet — it is the game.

```
  BUILD                       SLOTS     COST     $/s   PAYBACK  POWER
  ------------------------------------------------------------------
  The opening, unpowered          7     $390    0.18     2167s  none
  The opening, powered            8     $548    0.72      761s  8/90 kW
  One Copper Mutator              8     $591    2.00      296s  17/90 kW
  Two Amber arms                 15     $884    7.93      111s  33/90 kW
  An Engine Assembler            24   $1,298    9.52      136s  44/180 kW
  Same, with a fuel feed         28   $1,450   14.05      103s  61/90 kW
```

Power alone is worth 4x on the opening factory, which is why it is the first thing
the game asks for. Every powered build pays for itself inside thirteen minutes.

---

## The files

```
index.html          the shell: title, the three-column game, the manual, the menu
css/style.css       the whole look
js/machines.js      every number in the game lives here
js/world.js         the map: ore patches, terrain, and the guaranteed opening
js/power.js         the grid — who is on which, and how much they get
js/sim.js           the factory simulation, inherited from GIZMO 2 and made real-time
js/render.js        the camera renderer: one ground canvas, cached machine tiles
js/ui.js            the build bar, the HUD, the four panel tabs, the minimap, the manual
js/input.js         mouse and keyboard, including the belt drag and the pipette
js/game.js          the loop, the contracts, the milestones, the save file
js/main.js          one act() switch that every control in the game goes through
amplify.yml         inherited from the repository root; there is nothing to build
```

Balance lives entirely in `js/machines.js`. Gizmo values, machine prices and draws,
cycle times, generator output and reach, fuel energy, the land ladder, the tech
tree and the contract terms are all there in one screen of code, and both the
in-game manual and `tools/economy.mjs` are generated from it, so neither can drift.

---

## Checking it

```bash
node tools/lint.mjs       # will every module parse as a module in a browser?
node tools/verify.mjs     # the invariants: nothing destroyed, nothing off the claim
node tools/power.mjs      # every claim the manual makes about electricity
node tools/world.mjs 500  # is every generated world playable?
node tools/feeds.mjs      # can one belt feed a machine that needs two things?
node tools/economy.mjs    # the cost tables, and what real builds earn
```

`lint.mjs` does two things `node --check` cannot. It copies each file to `.mjs`
first, so the parse matches the browser's — `node --check` reads a `.js` file as
CommonJS, where a template literal closed with the wrong quote slips through and
then takes the whole page down on load. And it reads what every module exports
against what its neighbours import, because a missing export is not a syntax error:
every file parses, and the browser refuses the entire module graph at load time and
leaves a blank page. That is the exact failure a search-and-replace edit causes.

`feeds.mjs` is the regression test for the worst bug this game has had: it builds
the mixed feed, the separated feed and a deliberately hopeless one side by side, and
requires the mixed one to earn within a tenth of the separated one and the hopeless
one to be *reported* rather than merely slow.

`power.mjs` is the one worth running after touching anything: it asserts the reach
limit exactly, that one empty slot splits a grid and one conveyor merges it, that
satisfaction settles at supply over demand, that a generator burns a
kilowatt-second per kilowatt per second, and that an unpowered factory still earns
about a fifth of what a powered one does.

---

## Running it

Plain HTML, CSS and JavaScript. No build step, no npm install, nothing to compile.

Modules will not load from a `file://` URL, so serve the folder:

```bash
cd GIZMO
python3 -m http.server 8080
```

Then open <http://localhost:8080/v3/>.

On Amplify this folder deploys with the rest of the repository and is served at
`/v3/`. It needs no network at all once it has loaded — there is no signalling
server, no peers and no backend, because there is nobody else in the game.

**A word on the browser.** It wants a desktop: a keyboard, a mouse or trackpad you
can drag with, and about 1,180 pixels of width for all three columns. Narrower than that and the
right-hand panel goes; narrower still and it is not really playable, which is the
honest answer for a game whose main verb is dragging a belt across a map.

The save lives in `localStorage`, which means it is per-browser and per-device and
will not follow you between them. **ABANDON THIS WORLD** in the menu is the only
thing that deletes it, and it asks twice.
