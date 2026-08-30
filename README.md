# GIZMO

A two-to-four player factory race for one big screen and a pile of phones.

One device is the **floor**: it opens the room, shows a QR code, runs every player's
factory and draws them all side by side. It is never a player. Everyone else joins on
their own phone, which becomes their control panel.

---

## How it plays

Each player owns a square factory floor. It is **3x3 by default and can be set as large
as 7x7** in the Setup panel, along with the number of rounds, the phase lengths and the
starting cash. Everyone in a match plays the same size.

- The **Producer** bolts onto the left of the top-left slot and drops a raw Scrap gizmo
  every second or so. It can be upgraded to run faster.
- The **Seller** sits on one outside face of the floor. Any gizmo pushed out of the grid
  *at that exact face* is sold for cash. Anything pushed out anywhere else is lost.
- **The Seller moves to a new face at the start of every round after the first.** That is
  the whole game: your line worked perfectly, and now it points at nothing.

Gizmos are single pixels, coloured by type, and climb a value ladder:
Scrap, Copper, Amber, Bloom, Cobalt, Void, Ember, Prism.

### The machines

| Machine | What it does |
|---|---|
| Conveyor | Slides one gizmo along, fast. The plumbing of every build. |
| Doubler | Copies an original and pushes both out the front. Level 2 makes three, level 3 makes four. |
| Splitter | Splits an original ahead and to the right. At level 3 it also fires left. |
| Trident | Fires an original three ways at once: left, ahead and right. Slow and expensive. |
| Mutator | Rewrites anything it eats into one fixed type. Higher tiers run slower, so every mutator earns about the same per slot — the tier is about what you feed downstream. |
| Fuser | Swallows two gizmos and spits out one of the next tier up. At level 3, two matching gizmos jump *two* tiers. |

### Originals and copies

Two rules hold the economy together, and they are worth learning early:

1. **A copy is never copied again.** Duplicating machines multiply originals; a copy that
   reaches one is simply routed onward (a Splitter or Trident sends copies out one at a
   time, taking each exit in turn). So a line of four doublers adds copies *linearly* with
   the slots you spent, instead of doubling at every step.
2. **It takes two originals to make an original.** A Fuser given a copy returns a copy.

Copies sell for exactly what an original of the same type sells for — they are real
gizmos, just not copyable stock. On screen they are drawn dimmer and unlit, so a glance at
a running floor tells you which pixels can still be multiplied.

Together these keep multiplication as a way to *fill* a factory rather than a way to print
money: value still comes from climbing the tier ladder with Mutators and Fusers, and those
are rate-limited per slot.

Every machine can be rotated, moved to any open slot, upgraded to level 3, or scrapped for
half its money back. Machines with nowhere to go land in your crate.

**Conveyors are on sale at all times**, from a button on the phone, in any phase and as many
as you can pay for. They are plumbing rather than profit — reaching a seller on the far side
of the floor should be a matter of money, not of what the workshop happened to deal you —
so they sit outside the one-machine-a-round limit. Their price drifts up with the rounds
like everything else in the shop.

### A round

1. **Planning** — two minutes with the floor stopped. The Seller has jumped, so rebuild
   the line: move, rotate, upgrade, place whatever you bought. Tap **READY** when you are
   happy; once everyone is ready the round starts immediately, so nobody waits out a
   clock they do not need.
2. **Shipping** — the Producer runs, the floor runs, money lands. You can keep moving,
   rotating and upgrading machines the whole time — a live floor is a legitimate way to
   play, and sometimes the only way to unclog one.
3. **Tally** — the round's income.
4. **Workshop** — three machines are offered, you may buy **one**. Rerolling costs a
   little, and a little more each time in the same round. Tap READY to close the sheet;
   whatever you bought gets placed during the next planning phase. Conveyors are not part
   of this — they can be bought any time, from the phone.

After the last round, the most **lifetime earnings** wins. Money you spend still counts
toward your score, so buying is never a penalty — but the nine slots are.

---

## Running it

It is plain HTML, CSS and JavaScript. No build step, no npm install, nothing to compile.

It cannot be opened by double-clicking `index.html` — browsers block JavaScript modules on
`file://` URLs. Serve the folder instead:

```bash
cd gizmo
python3 -m http.server 8080
```

Then open <http://localhost:8080> and press **OPEN A ROOM ON THIS SCREEN**.

To try it alone, press **PRACTICE RUN** — it opens the same Setup panel, then runs the
whole game locally on one device with no phones and no networking. That is the quickest way
to see what a 5x5 or a 7x7 actually plays like before putting one in front of people.

To test two players on one computer, use a normal window and a private window. Two tabs in
the same profile share storage, so the second would claim the first one's seat.

---

## Deploying to AWS Amplify

**Drag and drop:** zip the `gizmo` folder itself (the one holding `index.html`), then in
the Amplify console choose **Create new app → Deploy without Git** and drop the zip in.
Amplify serves it over HTTPS and gives you a URL. Redeploying is dropping a new zip.

**Git-connected:** connect the repository. `amplify.yml` is already in the project and has
no build commands, which is correct — there is nothing to compile.

Netlify, Vercel, Cloudflare Pages and GitHub Pages host this identically with no
configuration.

### HTTPS is not optional

WebRTC refuses to run on plain HTTP from anything except `localhost`. Sharing a LAN
address like `http://192.168.1.20:8080` will fail even though localhost works on the same
machine. Amplify gives you HTTPS by default, which is why deploying is the easiest way to
test on a real phone.

Join links look like `https://yourapp.amplifyapp.com/?room=ABCD` — a query string on the
root path, so no redirect rules or SPA fallback are needed.

---

## Things worth knowing

- **The floor screen owns the game.** If it closes the tab, the room is gone. It warns
  before unloading during a match.
- **Reconnecting is free.** A phone that drops, locks, or gets a call reopens the same link
  and gets its seat, name, factory and money back. The floor greys that player out while
  they are away and keeps their factory running.
- **The signalling server is the free public PeerJS broker.** It is fine for a game with
  friends and has no uptime guarantee. For anything serious, run your own PeerServer
  (`npm i -g peer`) behind HTTPS and pass it to both `Peer` constructors in `js/net.js`:

  ```js
  new Peer(id, { host: 'peer.yourdomain.com', port: 443, secure: true, path: '/' });
  ```

- **Players on different networks may not connect.** Peer-to-peer across symmetric NAT
  needs a TURN server. Everyone on the same Wi-Fi is the case this is built for.

---

## The files

```
index.html        every screen; CDN tags are pinned here
css/style.css     the whole look
js/main.js        routing: floor, phone, or practice
js/net.js         PeerJS: room codes, seats, reconnect
js/host.js        the floor screen — lobby, QR, round loop, broadcast
js/player.js      the phone control panel
js/game.js        match engine: rounds, shop, per-player bookkeeping
js/sim.js         the factory simulation
js/machines.js    every number in the game lives here
js/render.js      the pixel renderer
amplify.yml       static hosting config, no build commands
```

The floor size is module state in `js/machines.js` (`setGridSize`), set once when a match
starts and echoed to every phone in the state it receives, so one page always runs one size.
Panels, hit-testing and the producer's gutter all size themselves from it — a phone on a
7x7 board narrows the gutter and draws a slimmer producer to buy back a whole step of
scale, which keeps slots at roughly 48 pixels instead of 32.

The art is drawn on a 32-pixel cell grid into a small backing canvas that is scaled up
by whole pixels only, so nothing is ever half a pixel wide. Text is the exception: it is
queued in art coordinates and drawn on a transparent overlay at the display's own
resolution, which is why the names and money read sharp instead of magnified. Phones get
a taller-per-slot layout with no name bar — the slots end up around 80 CSS pixels across,
and a tap near a grid line still picks the slot you meant.

Balance lives in `js/machines.js` and `DEFAULT_CFG` at the top of `js/game.js`. Gizmo
values, machine prices, cycle times, producer and seller upgrades, phase lengths and the
shop's price drift are all there in one screen of code. Rounds, round length, planning
time and starting cash are also on the floor screen's **Setup** panel.
