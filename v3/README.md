# GIZMO 3 — Keep the lights on

A single-player factory builder for a desktop computer, on a world fifty-six slots
a side.

GIZMO 3 lives beside the other two. The party game at the repository root is
untouched, GIZMO 2 in `v2/` is untouched, and this is a third self-contained copy,
so all three ship from the same Amplify site — the original at `/`, GIZMO 2 at
`/v2/`, this at `/v3/`.

---

## What it is

You own a ten-slot square in the middle of a fifty-six-slot world. Ore is scattered
across all of it, richer the further out you go. Put an **Extractor** on a patch,
belt what it pulls up to a **Market Depot**, and that is a factory. Everything after
that is making the line longer, wider, and worth more — and keeping it powered.

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
  it sells instantly at market value. Depots climb a price ladder — the twentieth
  costs a great deal more than the first — so covering the map in them is not the
  answer to "my line is far from a depot". A longer belt is.
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

### The claim is centred

Both earlier games anchored the floor at the top left and grew it down and right,
which is fine when the floor is the world. Here the claim is a square in the middle
of the map and every purchase adds a ring, so expansion is a **direction you
choose** rather than a diagonal you get pushed along. A ring costs 28% more than
the last one; the whole world costs about $135,000 end to end, which is a couple of
hours of a factory that is going well.

Everything outside your fence is exactly as fatal as the edge of the world: you
cannot build on it and a belt aimed at it throws away what it carries. That rule is
inherited unchanged, and on a map this size it is the mistake you will make most.

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
| build on top | replaces what is there; the old one goes to the crate, free to put back |
| `X` / `Delete` | scrap, for half of everything it cost |
| right click | put down what you are holding, or scrap what is there (drag to scrap a line) |
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
node tools/economy.mjs    # the cost tables, and what real builds earn
```

`lint.mjs` exists because `node --check` parses a `.js` file as CommonJS, where a
template literal closed with the wrong quote slips through and then takes the whole
page down on load. It copies each file to `.mjs` first so the parse matches the
browser's.

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
