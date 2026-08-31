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

**Pressure comes from the order board.** Each round posts a target worth 25% more
than your own best round so far. Filling it pays a bonus of a third of the target;
missing it costs nothing but the bonus, so one bad round can never bury anyone. The
target is measured against your own history rather than a fixed curve because round
length, plot size and above all routing skill swing achievable income by an order of
magnitude — any single ladder of numbers is either free for a good player or
impossible for a new one. A floor under it keeps the target climbing even after a
flat round, so standing still stops paying.

**Routing is its own thing now.** The old Splitter copied — original ahead, copy to
the right — which meant the only way to send gizmos two ways was to make more of
them, and every fork was also an economic decision. It is gone, replaced by two
machines that route and nothing else:

- **Balancer** — one in, one out, alternating between its exits. Divides a stream
  instead of inflating it. If the exit it picked is backed up it takes another,
  because a divider that stalls on one busy arm is not dividing anything.
- **Sorter** — the gizmo type it is set to goes out to the side, everything else
  goes straight ahead. Its filter is free to change from the phone, like rotating.
  It never reroutes on a jam: sending a Cobalt down the Scrap line because the
  Cobalt line was briefly full would defeat the whole machine.

Neither makes a gizmo worth more, so both are plumbing: on sale from the phone in
any phase, outside the workshop's one-machine-a-round limit, sharing one price
ladder and one counter with conveyors. Each round's cheap allowance is a budget you
spend how you like — a long belt run, or one Balancer and a Sorter. Conveyors also
came out of the workshop deck, so a shop card is never wasted on a belt.

**Ratios are visible.** Every machine reports its rate in jobs per second, and the
two failure modes are drawn differently because they want opposite fixes: amber all
round the casing means BACKED UP (holding finished goods, fix the line ahead), four
cool blue corner ticks mean STARVED (standing idle, fix the feed behind).

---

## Still to come

Phases one and two are in. Two left. The design the rest is heading toward:

- **Phase 3 — recipes.** A second Producer on a different edge emitting a different
  raw type, and an Assembler with fixed multi-input recipes. The Fuser is already a
  working two-input machine, so this is largely a re-skin of code that exists.
- **Phase 4 — research.** A Lab bolted to an edge like the Producer, costing no slot.
  Route gizmos into it for science; science unlocks machine types and levels while
  cash still buys the instances. Duplication — the Doubler and the Trident — moves
  behind a deep node with a hard throughput cap, which is why `TECH_LOCKED` exists in
  `machines.js` and is currently empty.

---

## The files

Identical in shape to the original. What GIZMO 2 changed:

```
js/machines.js    claims, the expansion ladder, vault geometry, the order curve
js/sim.js         the claim is the edge of the world; growth; starved detection
js/game.js        per-player orders, land purchases, no seller jump
js/render.js      unbought land, the fence, the starved badge
js/player.js      the CLAIM LAND button, the order bar, per-machine rates
js/howto.js       the manual, still generated from machines.js on open
tools/lint.mjs    parses every module as a module, the way the browser will
tools/routing.mjs proves the Balancer divides and the Sorter sorts
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
