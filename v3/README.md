# GIZMO 3 — Keep the lights on

A single-player factory builder for a desktop computer, on a world eighty slots
a side.

GIZMO 3 lives beside the other two. The party game at the repository root is
untouched, GIZMO 2 in `v2/` is untouched, and this is a third self-contained copy,
so all three ship from the same Amplify site — the original at `/`, GIZMO 2 at
`/v2/`, this at `/v3/`.

---

## What it is

You own a **three-slot square** in the middle of a eighty-slot world, and nothing
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

### The world is 6,400 slots instead of 49

Forty-nine slots is a puzzle. Three thousand is a place. The change is not really
one of degree — at 49 slots you are choosing which four machines you can afford to
fit, and at 6,400 you are choosing where the second smelting arm goes and how you
are going to get power out to it. Those are different games, and only the second
one is Factorio-shaped.

Scale is also what makes the map matter. A generated 7x7 plot could decide where
three fixtures sat on a fence; a generated 80x80 world decides where the *ore* is,
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

### The screen is the map, and everything floats over it

The old layout was three columns — a build list on the left, the map, and a panel on
the right — with a crowded HUD bar over the map. Now the map fills the window:

- **Top strip:** just the controls — speed, zoom, sound, help and menu.
- **Left cards:** Money (with an income graph), Science, Power (with POWER MAP),
  Noise (a bar marked at 5 for swarms and 12 for Brutes, plus NOISE MAP) and Land
  (with EXPAND). Each card's header shows its one number, so a folded card still
  reads. Click a header to fold or open it.
- **Right cards:** Tech, Orders and Stats, one open at a time, under the story
  contract when there is one.
- **The shop** runs along the bottom: category tabs, one row of machines, and a
  CRATE tab when the crate has anything in it. Picking a machine by its hotkey opens
  its tab. The hint for whatever is in your hand sits at the right end of the row.
- **The pop-up:** clicking a machine, a slot or a box selection opens a card over it
  (or beside it when there is no room) instead of the old INFO tab. It starts
  compact — name, numbers and buttons — and MORE adds the description and recipe
  picture. A machine in your hand gets the same card, docked above the shop.

The warning box, Gus and the toasts sit at the top centre. Which cards are open,
and whether the pop-up is on MORE, is remembered in this browser.

### Advanced machinery is priced like it

Assemblers used to cost less than the Mutators that feed them. Now an Assembler is
priced at about 45x the value of what it makes, the same ratio as the Mutators, and
the rest of the advanced kit came up with it. Each of these also costs 1.2x more
for every one you already own (the Assembler ladder counts all three recipes together):

| Machine | Was | Now (first) |
|---|---|---|
| Engine Assembler | $80 | $1,500 |
| Turbine Assembler | $175 | $6,000 |
| Reactor Assembler | $350 | $20,000 |
| Doubler | $130 | $10,000 |
| Trident | $80 | $25,000 |
| Fuser | $55 | $400 |
| Mountain Drill | $130 | $1,000 |
| Bridge | $40 | $250 |
| Recycler | $45 | $300 |
| Storage | $30 | $90 |

Upgrades are priced off the purchase price, so they rose in step.

### Upgrades you can see

The level pips are gone. Instead every machine grows parts as it levels up, bolted
round the outside of its casing so nothing covers what the machine itself shows,
and each level keeps the parts from the levels before (`KITS` and `LONG_KITS` in
render.js; Balancers, Sorters and Overflow Splitters share `drawUpgradeKit`).

- **Belts and Storage:** rail studs, a lit inner edge, running lights, fully lit rails.
- **Balancer, Sorter, Overflow Splitter:** corner brackets, side fins, a back conduit, a lamp.
- **Extractor:** feet, ore bins, an exhaust stack, a hazard band.
- **Market Depot:** an awning, coin stacks, cargo crates, pennants.
- **Research Lab:** a radar dish, vials, a cable coil, corner signal lights.
- **Generator:** a fuel hopper, red-hot fins, chimneys, a flywheel.
- **Solar Panel:** a wing of cells, a second wing, a tracking pivot, sun mirrors.
- **Battery:** a spare cell, cooling plates, heavy leads, charge lamps.
- **Pylon:** guy wires, cross braces, warning lights, a lightning rod.
- **Mutator:** tanks of its colour, a feed pipe with a gauge, emitters, chamber lights.
- **Fuser:** bellows, a coal bunker, chimneys, molten vents.
- **Assembler:** a robot arm, parts trays, a crate feeder, spotlights.
- **Recycler:** a junk hopper, shredder teeth, scrap bins, a crane magnet.
- **Doubler:** mirror plates, a copy drum, aerials, a crystal.
- **Trident:** a three-pronged crest, exit collars, pressure tanks, three exit lights.
- **Wall:** a steel plate, rivets, an iron cap that runs on into its neighbours, spikes.
- **Night Switch:** a clock dial, wiring, a sun-and-moon vane, two lamps.
- **Armory:** ammo crates, shell racks, armour plates, a siren.
- **Zapper:** capacitors, insulators, grounding rods, charged orbs.
- **Repair Drone Bay:** landing lights, a spare drone, a Copper tank, a radar dish.
- **Mountain Drill:** cutter teeth, coolant lines, gantry feet, a beacon.
- **Bridge:** railing posts, suspension cables, lamps, flags.

### Day and night

The asteroid turns. A day is ten minutes of game time — about seven of daylight and
three of night, with a minute of dusk and of dawn fading between — and a game opens
in full daylight. Endless mode has it, and story mode from world 3 on. A sun or moon
in the top strip shows which, and how long until it turns.

At night:

- **Solar Panels make nothing** (and half at the middle of dusk and dawn).
- **The nests are bolder:** they wake at noise **3** instead of 5, and Brutes come at
  **9** instead of 12. The Noise card's marks move to match.
- **You see less:** the fog closes in to 1 slot past your fence instead of 3.

A new machine:

- **Battery** (Power: *Batteries*, 500 science, after Solar Panels; $800, 1.2x each).
  It charges from whatever its grid has spare and pays it back when the grid runs
  short, up to its rate. It counts as a power source with a short reach, so it also
  carries power. 3 MJ / 40 kW at level 1, 18 MJ / 150 kW at level 5; each rank of
  Batteries past I adds 15% capacity. Charging is real load: a Generator burns fuel
  for it. Its gauge fills up the middle of its art.
- **Night Switch**: shelved for now. No research unlocks it, so it is not in the
  shop; the machine and its art are kept, and one already in a save still works.

`tools/daynight.mjs` checks the clock, the thresholds, the fog, the Battery and the
Night Switch.

### Creatures keep to open ground

Bedrock, mountains, valleys and open space are solid to every creature. They walk
round them using the same distance fields that route them round Walls, and they only
pick a target on the same patch of open ground as themselves — a factory ringed by
mountains or valleys cannot be reached at all. (A Wall, unlike rock, can be chewed.)

### Sorters keep a queue for each way out

A Sorter holds two of what it is filtering for and two of everything else, and sends
on whichever it can. If the filtered side is backed up, everything else keeps going
straight past it, and the other way round. A belt is still one queue, so once the
stuck kind has filled its queue *and* reaches the front of the belt, the belt stops.

### Bridges point themselves the right way

A Bridge pair only carries one way, and it was easy to end up with both facing back
across the gap — build the far Bridge first and the near one lined up with it — so
everything piled up at the first Bridge. Now a Bridge with something feeding into it
turns itself and its nearest unfed Bridge in range to face from it to that one
(`orientBridges` in sim.js). A Bridge you have turned by hand with R is left alone.

### Walls

A Wall (Defence branch, **Walls** research, 60 science) is a block of plated stone:
$50, and each one after costs 1.1x the last. Nothing that crawls walks through it —
Mites, Brutes, Beetles and Skitters alike. Each creature's target gets a distance
field over the map in which a standing Wall costs `WALL_DETOUR` (24) slots to
cross, so a creature walks round when the way round is shorter than that and chews
through when it is not, or when it is boxed out entirely. Walls are never chosen as
targets in their own right; they are only chewed to get past.

Walls are silent, draw no power and do not carry it, take no gizmos, and join up
with the Walls beside them. 120 hit points at level 1, x3.5 at level 5, and each
rank of Walls research past the first adds 25%. Repair them like anything else.
`tools/walls.mjs` checks all of it.

The minimap now sits in the bottom-right corner, under the right-hand cards.

### Noise

Every machine makes noise now: belts and Pylons barely any, Extractors, Drills and
burning Generators a lot (`NOISE` in machines.js). A machine standing idle makes
40% of its noise; Depots, Labs and power machines always count fully. Each level
past the first adds half again, so a level 5 machine is 3x as loud.

The **NOISE** readout in the top bar shows the factory's total against the swarm
threshold of **5** (`SWARM_THRESHOLD`), green, gold near it, red over it, with the
time to the next swarm underneath. Below the threshold the nests stay asleep: the
swarm gauge drains, no swarm sets out, and any Mites and Skitters already out on
the map walk home to their nests and disappear — so a factory that keeps under the
threshold can build up in peace. At or over it, swarms build with the noise as
before. Creatures sent at the Launch Beacon, and Beetles (which answer to drilling,
not noise), are not sent home.

**NOISE MAP** (button beside it, or **L**) shades every slot your factory can be
heard on, by how loud it is there, outlines the whole area, and rings any nest you
can see inside it. Each machine is heard `NOISE_BASE` 4 + `NOISE_REACH` 6 slots per
point of noise, up to 16. The map is for planning; swarms still answer to the total.
Gus mentions it the first time you get close to the threshold.

### Brute Mites

The fourth creature. A big Mite in dark red armour with a ridge of spikes: five
times a Mite's health (60), a harder bite, a slower walk, and it goes for your
most valuable machines — Assemblers, Generators, Labs — walking straight past
belts to get there. Brutes only come once the factory's noise reaches **12**
(`BRUTE_THRESHOLD`): from then on part of every Mite swarm is Brutes, 15% at 12
rising to 60% as the noise climbs (`bruteShare`). Like the rest, they only go home
when the noise drops under 5. The NOISE readout shows "/ 12" once you are over 5,
and turns a hot red with "brutes" underneath over 12. Gus warns you the first time
they come.

### Repairs

Repairing costs half what it used to: a machine costs 20% of its listed price,
scaled by the share of its health it has lost (`REPAIR_RATE` 0.2), and the
Launch Beacon $1.50 per point of damage (`BEACON_REPAIR`).

### Fog of war

You can see your own land and three slots beyond it in every direction (`FOG` in
machines.js), and nothing further: past that, the map, the minimap and the hover
card show only fog — no ground, ore, mountains, nests, creatures or Beacon. The
last rings before the fog fade toward it. Buying land pushes the fog back, so the
world is uncovered as you expand.

### Box selections: to the crate, and rubble

Shift-drag a box and, alongside copy, move, upgrade, repair, switch off and scrap,
there is **TO CRATE** (key **K**): every machine in the box goes into the crate, as
many as fit. The crate now holds 200 (was 40). The same box also picks up any
**rubble** on your land inside it; **CLEAR RUBBLE** clears it all at $50 a slot,
stopping when the money runs out and leaving the rest selected. A box with only
rubble in it shows just that, and **X** clears it.

### Mutator prices

Each rung of Mutator costs 2.2x the one below it: Copper $275, Amber $605, Bloom
$1,331, Cobalt $2,928, Void $6,442, Ember $14,173, Prism $31,180 (`MUT_BASE`,
`MUT_STEP`). The first Solar Panel costs $500 and the first Generator $100. Defence machines cost ten times their old prices: Armory $750, Zapper $1,100, Repair Drone Bay $900. Generators and Solar Panels now climb a price ladder like Extractors, Depots and Labs: each one you own makes the next 1.2x dearer (Generator $100, $120, $144…; Solar Panel $500, $600, $720…). Each new Market Depot and Research Lab costs 3x the last (Depot: first free while none stands, then $360, $1,080, $3,240…; Lab: $150, $450, $1,350…).

### Five more machines

All five are research, spread across the branches, and each has its own card in
the inspector.

| Machine | Research | What it does |
|---|---|---|
| **Overflow Splitter** | Overflow Splitters (Production, 40 flat, after Balancers) | Everything goes straight ahead; only when ahead is backed up does the extra spill out of its side. F flips the side. "Feed the Generator first, sell the rest." |
| **Recycler** | Recyclers (Production, after Sorters) | Takes anything at all and pushes out one Scrap for each — except Resin, Cord and Frame, which come out as one Resin each. Clears a jammed mix, spare Ammo, the wrong rung. |
| **Solar Panel** | Solar Panels (Power, 500 science, after Generators) | A steady 15 kW with no fuel (22 / 32 / 45 / 62 by level), spreading 4–8 hops. |
| **Pylon** | Pylons (Power, after Gridwork) | Two Pylons facing the same way in a line link with a wire and carry power across the gap — rock, valley or open space — but never gizmos. Gap of 3 slots at level 1, then 4, 5, 6 and 8. Chains work. The brighter insulator is the end power leaves from. |
| **Repair Drone Bay** | Repair Drones (Defence, after Pest Control) | Takes Copper only and holds six. Every 3s (faster with levels) it spends 2 Copper to fully repair the most damaged machine within 6–10 slots; you can watch the drone fly out and back. Six pips on its foot show the Copper it holds. |

`pairPylons` (sim.js) links Pylons; `power.js` treats a Solar Panel as a source that
never needs fuel and follows Pylon wires like a Bridge's span. The build bar has a
new POWER group for Generators, Solar Panels and Pylons.

### Gus, the foreman

First-time players are taught by **Gus**, a cheerful veteran prospector in a
scuffed space helmet with a lamp on top, drawn as 32x32 pixel art in
`js/teacher.js` (no image files: every frame is painted in code and cached). He
bobs, blinks and moves his mouth while his lines type out letter by letter with a
soft synthesized blip (muted with the rest of the sound); a click finishes a line.

He runs the walkthrough card, and after it is over he pops up **once** the first
time something new happens — spare science to spend, a brownout, a jammed line,
Sap, a mountain or a valley near the fence, the first Mite swarm, the first Skitters,
the first machine chewed through, the first Beetle. Those live in `js/tips.js`;
which ones you have seen is kept in `gizmo3.tips.v1`. The menu's REPLAY THE
WALKTHROUGH AND TIPS resets both, and the "Gus" checkbox (or T) hides him.

### A faster opening

Machine prices, upgrades and land cost half what they used to (`PRICE_SCALE`
0.5, `EXPAND_PER_SLOT` 0.75), and so do the starter research nodes (Generators
20, Balancers 30, Copper Mutator 45, Sorters 75, Fusers 125, Amber Mutator 200).
Whenever no Market Depot is standing — at the start of every game, and any time
after — the next Depot is **free**, so a factory that has spent itself to nothing
can never be locked out of selling. A free Depot is marked (`m.free`, saved) and
scraps for nothing, so it cannot be farmed for cash. Selling the **last** Depot
standing pays nothing either, bought or free — nor does selling a crated Depot
while none is standing — since the next one would be free (`scrapPay` in sim.js).

Machine speeds are unchanged: an unpowered machine runs at 20% and a fully powered
one at its listed speed (`UNPOWERED` 0.2, `POWERED` 1).

### Story mode

A campaign of eight worlds, separate from the endless game and saved on its own
(`gizmo3.story.v1`), so both can be in progress at once.

| # | World | Kind | Radius | New here | Contract |
|---|-------|------|--------|----------|----------|
| 1 | Pebble | small asteroid | 7 | the basics, the Lab and the first unlocks | ship 120 Scrap |
| 2 | Cinder | small asteroid | 9 | power, Copper Mutators | ship 150 Copper, earn $1,500 |
| 3 | Shard | small asteroid | 11 | Fusers | ship 120 Amber, hold 30 Copper/min for 60s |
| 4 | Hollow | large asteroid | 16 | Sap, Cord, Assembly | ship 60 Cord, ship 10 Engines |
| 5 | Kessler | large asteroid | 20 | Mites, Zappers | hold 6 Engines/min for 60s, earn $10,000 |
| 6 | Talus | large asteroid | 25 | mountains, drills, Beetles | ship 80 Cobalt, ship 15 Turbines |
| 7 | Selka | moon | 31 | valleys, bridges, Skitters | hold 4 Turbines/min for 90s, ship 10 Reactors, earn $60,000 |
| 8 | Orrin | moon | 39 | everything at full scale | 40 Reactors, 20 Prisms, hold 3 Reactors/min for 120s, earn $250,000 |

Each world is the ordinary 80x80 grid with everything outside one lumpy rock turned
to open **space** (terrain code 6), so the whole engine runs unchanged on it; the
fence stops growing at the edge of the rock. Features a world has not introduced
yet are flattened away, nests are capped per world, and Sap is guaranteed from
Hollow on. Nothing is timed and nothing fails. A goal is `ship` (delivered to
Depots), `rate` (held at or over a per-minute rate for a stretch, restarting if it
drops) or `cash` (earned on this world); once met it stays met. When every goal is
met a card shows the world's numbers and moves you on. **Money and science reset
on every world; research carries over.** The endless order board is not posted in
story mode — the ORDERS tab and a box at the top right show the contract instead.
The levels live in `STORY_LEVELS` in machines.js, the rock in `storyWorld()` in
world.js, the goals in game.js.

### Only four machines at the start

Every mode now opens with just the Extractor, Conveyor, Market Depot and Research
Lab. Everything else is research. The new starter nodes are `flat` — their cost is
not multiplied by `TECH_COST_SCALE` — so the first unlock is a minute of Scrap into
a Lab:

- **Power:** Generators (40) heads the branch; Gridwork now needs it.
- **Production:** Balancers → Sorters and Warehousing; Copper Mutator → Fusers →
  Assembly, and Amber Mutator → Bloom → Cobalt → Void → Ember → Prism Mutator, one
  node per rung (these deeper rungs use the normal x10). Each starter node is named
  after the machine it unlocks.

Locked machines are hidden from the build bar until they are researched.

The walkthrough now has you feed a Lab and research Generators before building
one. A world saved before this change is given the old free machines' nodes at
rank I when it loads, so nothing on it stops working.

### Fusers and Mutators are two slots long

Fusers and Mutators are **one by two**, laid along the flow: they are fed at the
back slot and put out from the front one, and turning one with R swings it round
its back slot, so it needs room to turn. Nothing else about them changed — same
prices, same rates, same reach — they simply take room, which makes laying a line
out a question of space as well as of order.

Under the hood a machine is one object, and every slot it covers points at it.
`f.cells` lists each machine once, by its anchor (the back slot), and the machine
remembers `at`, `cells` and `front`. Anything that asks "what is next to this
machine" walks its perimeter rather than its four neighbours, so a Generator powers
a Fuser touching either slot. The build ghost shows the whole footprint, and a 1x2
picks the facing it lands with before it is checked, because its footprint depends
on it. The code also supports 2x2 machines (tried for Generators, Depots, Labs and
Zappers, then reverted); none use it now. Saves from before multi-slot machines
cannot be loaded.

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
outer third a ring is tens of thousands. The whole world is about $350,000.

Everything outside your fence is exactly as fatal as the edge of the world: you
cannot build on it and a belt aimed at it throws away what it carries. That rule is
inherited unchanged, and on a map this size it is the mistake you will make most.

### Ore is sparse

A world holds 14 scattered Slag patches and 5 Sap patches (plus the opening blob
and one guaranteed Sap patch), each 5–14 slots, with at least 9 slots between two
patches of the same ore. Each one is placed best-of-24: of 24 allowed spots, the one
furthest from every patch already down, so they spread across the map instead of
clumping (on average 16 slots to the nearest other patch, up from 13). A patch is something you go out to find and run a belt
home from, not a carpet you can build anywhere on. The opening 3x3 is still all
Slag, and the opening blob grows to 14 slots.

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

### Mites, Zappers and the Armory

A factory with nothing to push back against is a spreadsheet that runs itself. So
out beyond the fence there are **nests** — two near every Sap patch and more
in the far rings, a pure function of the seed like the ore — and they are woken by
**noise**.

Every Extractor digging, Generator burning and heavy machine working is loud. Noise
fills a gauge; every time it fills, a swarm leaves the nest nearest you, bigger the
louder you are. Nothing comes for the first seven minutes, so the opening is still
the opening, and the STATS tab shows how loud you are and roughly when the next
swarm is due.

There are about thirty nests on a world: two near every Sap patch, eight more
scattered through the far rings, and eight **Skitter nests** placed by the same
rules — no closer than eleven rings to the middle and never within six slots of
another nest. Older saves are given the nests they are missing when they load.

**Skitters** are the second creature: long, thin, acid green and fast — 2.25x a
Mite's speed with a bite 2.7x as hard — and they eat **conveyors and nothing else**,
running straight past every other machine to reach one. One shot from anything kills
one. From the fifth swarm onward a growing share of every swarm is Skitters (15%,
rising to half), racing in from their own nests while the Mites plod in from theirs. A
Skitter nest has 18,000 hit points — half as hard again as a Mite nest — sends out
broods of Skitters that go for the belts around the Zapper attacking it, and pays
**$10,000**.

A Mite has a flat 12 hit points: two shots from a Zapper at any level.

**Mites chew, belts first.** They walk straight at the nearest thing you have
built, counting belts as nearer than they are, because a belt is long, cheap and
out on the edge. A damaged machine runs slower — half speed just before it breaks —
and at zero it **breaks**: it holds whatever it was carrying and does nothing until
it is repaired. Nothing is destroyed, so the custody rule still holds. Repair is
`H` on one machine or `Shift H` for everything, and costs 40% of the machine's price
scaled by the damage.

**The Zapper** (`Z`) is a coil turret that zaps the nearest mite in reach. It needs
two things from the factory it guards: **Ammo**, six shots each, belted in like
anything else, and **power**, which it draws while it recharges between shots — so a
swarm is a spike on its grid, and a browned-out Zapper fires slowly. With nothing
moving in reach it chips at a nest instead. That is a siege: a nest has 12,000 hit
points, and as it takes damage broods of mites come out and go straight for the Zapper
doing the shooting — three every 90 damage at full health, rising steadily to nine
every 25 damage as it nears death, so the last stretch is the hardest. A Zapper always shoots mites before
nests, so it turns on the brood and then goes back to the nest. A dead nest pays
$2,000. Every world has a nest limit — however many nests it started with — and
whenever it is below that, a new nest digs in at a random spot out in the wilds after
a random wait of one to four minutes, of whichever kind the world is shortest of.

**The Armory** (`B`) presses one Scrap and one Copper into one Ammo. The natural
build is a Balancer on a Slag line with its branch through a Copper Mutator, merged
back onto one belt. That used to be able to stop for good — a run of Scrap filled the
Scrap queue and stood in front of the Copper forever — so the Armory now sorts it out
itself: it takes either ingredient for as long as it has room, and after a second short
of one half it makes do with the other (three Scrap, or two Copper, make an Ammo).

**Charged Ammo.** A Fuser takes two Ammo and makes one Charged Ammo (pink, $2): the
same six shots, each doing twice the damage. Total damage is the same as the two Ammo
it came from — fusing makes no firepower out of nothing — but twice the damage per shot
means one-shot Mites from a level 1 Zapper and nests falling twice as fast, for half the
belt traffic. Zappers fire charged shots first; Charged Ammo cannot be fused further.

Every Assembler, Fuser and Armory has a **CLEAR MACHINE** button that throws out
whatever is queued in it and in its hands. Like sweeping, it pays nothing.

Three research nodes sit behind it: **Focusing** (+1.5 reach), **Arc Discharge**
(every zap jumps to two more mites) and **Plating** (+50% hit points on everything).
Mites are saved with the world, unlike gizmos in flight: reloading must not be a way
to make a swarm halfway through your belts vanish.

### The tech tree has four branches, and Defence and Terrain are research

The tree grew from 14 nodes to 27, in four branches the TECH tab shows under their own
headings, each with a count of how far through it you are and the machines a node
unlocks drawn on its card.

| Branch | Nodes |
|---|---|
| **Production** | Warehousing, Express Belts (belts 33% faster), Assembly, Overclocking, Market Savvy (contracts pay 60% over market), Assembly II, Replication, Assembly III, Trifurcation |
| **Power** | Gridwork, Combustion, Prospecting, High Voltage, Efficient Motors (25% less draw) |
| **Defence** | **Pest Control** (unlocks Armory and Zapper, 1,200 science), Focusing, Capacitors (43% faster recharge), Arc Discharge, Plating, Overcharge (+25% damage), Beacon Shielding (2x damage per lost gizmo) |
| **Terrain** | **Surveying** (reveals mountain seams), **Bridging** (unlocks Bridge), **Deep Mining** (unlocks Mountain Drill), Long Spans (+3 bridge reach), Hardened Bits (drills 40% faster), Dampers (half the Beetles) |

The Armory, Zapper, Mountain Drill and Bridge are no longer on sale from the start. Pest
Control is deliberately the cheapest node in the game, because the first swarm comes a
few minutes in. Before Surveying, a mountain's seam is unknown — no glints on the map,
and "unknown" when you hover it. Picking up a locked machine by its key says which
research it needs. `tools/tech.mjs` checks the tree has no cycles or orphans, that every
branch is reachable, and that every bonus does what its card says.

### The tech tree is a tree

Research has its own page now: a full-screen overlay over the running game, opened from
the TECH tab or with `Y`. Each branch is a column — Production, Power, Defence, Terrain —
with its roots at the top and deeper research below, and an elbowed line from every node
to what it leads to. A node shows its name and rank, five rank pips, the next rank's cost
and icons for any machines it unlocks; it glows gold when you can afford it, turns green
when it is maxed, and greys out while its prerequisites are missing.

Drag the background to move the tree; `+`/`−` or the buttons zoom, `0` or FIT shows all
of it, and where you left it and how far in you were is remembered. Click a node and a
card opens beside it: its description, what it does **now** and what it will do **at the
next rank** — worked out from the same functions the game uses, so the card cannot
drift — its prerequisites ticked or crossed, what it leads to, what it unlocks, and the
button that researches the next rank. The selected node's whole prerequisite chain lights
up in gold. Science banked and science per second sit in the bar along the top. The TECH
tab itself is now a way in and a summary: progress per branch and whatever is ready to
research.

### Five ranks of research, five levels of machine

**Every research node has five ranks.** Rank I does what its card says; each rank after
it costs more (1x, 2x, 3.5x, 5.5x, 8x the base). Every base price is multiplied by
`TECH_COST_SCALE` (10) in `machines.js`, the one knob for how long research takes and adds half as much again, so rank V
is three times rank I. Reductions — Express Belts, Efficient Motors, Capacitors —
compound instead, so they never reach zero. Nodes that unlock machines make those
machines 10% faster for every rank after the first; Surveying's later ranks speed
Mountain Drills; Long Spans adds a slot a rank and Arc Discharge a mite a rank. A
node's rank is shown as I–V after its name with five pips under it, and the branch
headings count ranks (out of five times the number of nodes). In a save, `done` holds a
node's id once per rank, so older saves load as rank I of everything they had.

**Every machine goes to level 5.** The ceiling starts at level 2, and each rank of
Overclocking raises it a level until rank III reaches 5; ranks IV and V make every
upgrade 15% cheaper instead. Every per-level table has five entries — speed (1, 0.7,
0.45, 0.32, 0.24 of the cycle), draw, Generator output (90 → 520 kW) and reach (8 → 20),
Zapper range (4.5 → 8.5), damage (6 → 20) and recharge (0.9 → 0.42s). A Doubler's first
three levels still buy exits; its fourth and fifth buy speed. Level 4 and 5 Zappers
kill a Mite in one shot.

### The world is 80x80, and there is a Launch Beacon in a corner

The world grew from 56 to 80 slots a side — about twice the area — and everything in
it scaled with it: twice the ore patches, twice the nests, twice the mountains and
valleys. The land price curve was flattened (13% markup per ring instead of 16%) so the
whole world costs about $350,000 rather than eight times that. A 56x56 save cannot be
carried over; the title screen says so and a new world starts fresh.

**The Launch Beacon** is the end of the game: a five-by-five tower placed by the seed in
one of the four corners, a few slots in from the edge, with three slots of clear ground
round it. It has one mouth in the middle of each side — **Engines** from the north
(500), **Turbines** from the east (250), **Reactors** from the south (100) and **Prisms**
from the west (200). A belt on the slot just outside a mouth, pointing straight in,
feeds it; a wrong item waits on the belt and the corner names the jam. You have to buy
the land out to it.

Feeding it is loud (+10 noise) and every creature on the map takes notice: while it has
been fed in the last 90 seconds, 60% of every swarm is sent for it, and at 25%, 50% and
75% full a 40-strong assault comes from the four nearest nests together with four
Beetles out of the nearest mountain. Damage is harsh: every 4 points the Beacon takes
knocks one delivered gizmo back out of it (from whichever input is furthest along), and
at zero of its 1,000 health it takes nothing until repaired at $3 a point. Fill all four
mouths and it fires a beam into the sky, the world is won, and a win screen offers to
keep playing or start again. `tools/beacon.mjs` checks all of it.

### Mountains, valleys and Beetles

Expanding used to be a matter of money: buy the next ring and build on it. Now the
ground fights back.

**Mountains** — about a dozen per world, never within eight rings of the middle and
never on ore — are clumps of rock nothing can be built on or run through. Each holds a
seam of one mineral, Scrap near the middle of the map up to Cobalt at the rim, and a
finite 2,000 units of it. A **Mountain Drill** (`G`, $260) set beside a mountain turns
to face it, digs the seam out and pushes it out of its back. It is slow — 2 seconds a
Scrap, 6.8 a Cobalt — but what comes out is already four Mutator tiers up. A worked-out
mountain falls in to rubble you can clear and build on. Hover any mountain to see its
seam and how much is left; the seam also glints in its colour on the map.

**Valleys** — seven long, wandering chasms per world — cannot be built in. A pair of
**Bridges** (`N`, $80 each) facing the same way, up to four slots apart, carries gizmos
*and power* across whatever is between them, like an underground belt: a line of
Bridges pairs off two by two, and a lone Bridge is just a belt. A Bridge set on the
edge of a valley faces across it; one set in line with an unpaired Bridge turns to
match it. A dashed rope shows the pair.

**Beetles** are the third creature, and the slow one: 60 hit points (ten plain or five
charged shots at level 1), less than half a Mite's speed, and a bite that goes through a
Generator in seconds — Generators are all they want. They do not live in nests: they
live in the mountains, and **drilling wakes them**. Every Drill at work adds to a
tremor, and every 200 drill-seconds a Beetle burrows out of a mountain being drilled.
Mountains are pure functions of the seed, drawn from their own random stream so no ore
moved; an older save with a machine where a mountain now stands keeps the machine.

`tools/terrain.mjs` checks all of it.

### Quality of life

**Boxes and blueprints.** Shift-drag draws a box round any number of machines. The
panel then offers every single-machine verb for the lot — move, upgrade, repair,
switch off, scrap — and `Ctrl C` turns the box into a **blueprint** that stays in
your hand so you can stamp it down as many times as you can afford (`R` turns it,
`Ctrl V` picks the last one up again). A paste is priced before you click, ladders
included, and stops at the first thing you cannot pay for rather than leaving holes.
Moving a box lifts the machines themselves — levels, settings and damage — and
`Esc` puts every one back.

**Finding the problem.** The warning box in the corner is clickable and takes the
camera to whatever it is talking about, with a ring on the slot. `Tab` walks through
every problem on the map, worst first: lines stopped for good, broken machines, mites
inside the fence, dry generators, half-fed recipes, starved and backed-up machines,
empty Zappers and anything off the grid.

**Sound.** Every sound is synthesised in `js/sound.js` — no audio files — and
throttled per sound so a big factory hums rather than roars. Sells, zaps and builds
only play when they are on screen; swarms, breakages and research always do. Mute is
the speaker in the HUD, volume is in the menu, and both are remembered.

**Juice.** Sparks when a mite dies, coins hopping out of a Depot on a rich sale,
dust when something is built, a shake when a nest goes up, and a coloured pulse
across the screen for a swarm, a contract, a ring of land or a finished research.

**Belts aim themselves.** A single click with a belt in hand used to point it
whichever way the tool happened to be facing — east, unless you had pressed `R`. Now
it aims itself like everything else: on along whatever feeds it, into a Depot mouth or
a machine beside it, toward the nearest Depot otherwise, and never into the back of an
Extractor, the solid side of a Depot, or the belt behind it. The ghost shows the way
it will face before you click. Put a belt beside the end of a run that stops in
mid-air and the run bends to feed it; the end of a dragged run hands off to a machine
right beside it. Press `R` on the tool and it goes down exactly as you turned it; a
belt you turned by hand on the map is never re-aimed by anything built beside it.
`tools/aim.mjs` checks all of it.

**Hiding the helpers.** The warning box, the key hints along the bottom, the pop-up
messages and the walkthrough card can each be switched off in the menu, or all at
once with `T`. The choice is remembered, and `Tab` still finds problems with the
warning box hidden.

**The graph.** STATS draws the last ten minutes of income, science and noise, and a
**WHAT PAYS** bar for each gizmo by the share of income it brings in.

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
| `Z` / `B` | pick up a Zapper / an Armory to build |
| `G` / `N` | pick up a Mountain Drill / a Bridge to build |
| `H` / `Shift H` | repair the machine under the cursor / repair everything |
| `Shift` drag | select every machine in a box |
| `Ctrl C` / `Ctrl V` | copy the box as a blueprint / pick the last blueprint up again |
| `M` `U` `O` `H` `X` | with a box selected: move, upgrade, switch off, repair or scrap all of it |
| `Tab` | jump to the next problem — clicking the warning box does the same |
| `T` | hide or show the helper boxes; each can be switched on its own in the menu |
| `Y` | open the tech tree page |
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
js/bugs.js          nests, noise, swarms, mites chewing, Zappers firing, repair
js/blueprint.js     box selection, copy and paste, moving many machines, bulk verbs
js/techtree.js      the tech tree page: layout, drag and zoom, the node card
js/beacon.js        the Launch Beacon: its mouths, deliveries, damage, assaults and the win
js/sound.js         every sound, synthesised with Web Audio
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
node tools/bugs.mjs       # mites chew, broken stops, repair, Armory, Zapper
node tools/blueprint.mjs  # select, copy, paste, rotate, move and bulk verbs
node tools/aim.mjs        # belts aim themselves sensibly
node tools/terrain.mjs    # mountains, drills, valleys, bridges, beetles
node tools/beacon.mjs     # the Launch Beacon: placing, feeding, damage, assaults, winning
node tools/tech.mjs       # the research tree: shape, unlocks and every bonus
node tools/sizes.mjs      # 1x2 machines: footprints, turning, flow, moving, power
node tools/story.mjs      # story mode: the eight worlds, goals, carry-over and saving
node tools/tips.mjs       # Gus's one-time tips fire when they should, and only once
node tools/newmachines.mjs # Overflow Splitter, Recycler, Solar Panel, Pylon, Repair Drone Bay
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
