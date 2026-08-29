# GIZMOWORKS

A factory tycoon for 2–4 people, played in a browser. One person hosts on a laptop or
TV, everyone else scans a QR code with their phone. Each player builds their own
production line out of 50 different machines, rolls gizmos through it, and tries to be
worth the most money after five rounds.

No build step, no install, no accounts. It's a folder of files.

---

## Running it on your own computer

You can't just double-click `index.html` — browsers block the networking bits when a
page is opened as a file. Serve it instead:

```bash
cd gizmoworks
python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser.

To test two players on one machine, use a normal window for the host and a **private /
incognito window** for the joiner. Two normal tabs share the same browser storage, so
the second one would steal the first one's seat.

To play with real phones, deploy it first. Phones can't reach `localhost`, and the
networking needs HTTPS, which is easier to get from a host than to set up locally.

---

## Putting it on the internet

**The easy way (AWS Amplify, no Git):**

1. Zip the `gizmoworks` folder — the one that contains `index.html`, not its parent.
2. Go to the AWS Amplify console, choose **Create new app**, then **Deploy without Git**.
3. Drop the zip in. Amplify hands you an HTTPS address.

To update it later, drop in a new zip.

**The Git way:** connect your repository in the Amplify console. `amplify.yml` is already
in this folder and has no build command, which is correct — there's nothing to compile.

Netlify, Vercel, Cloudflare Pages and GitHub Pages all host this identically. Nothing in
the code is specific to Amplify.

HTTPS is required either way. That's why sharing a local address like
`http://192.168.1.20:8080` will fail even though `localhost` works on your own machine.

---

## How to play

**Getting in.** The host presses *Start a room* and gets a QR code and a four-letter
code. Everyone else scans it, or types the code on the home screen. Players enter a name
and press *I'm ready*. Once everyone is ready, the host starts.

**Your floor.** Each player gets three parallel lanes of five bays. Only lane 1 is
operational to start with; lanes 2 and 3 are bought whole, one purchase each. Every
operational lane has a free intake dropping raw gizmos onto its head, and a sell dock
at its end — whatever rolls off is sold automatically.

**Tap a bay** to open it. Empty bays open the shop. Filled bays let you upgrade (five
levels each) or sell for half of what you've put in. Tapping a locked lane offers to
open it.

**The five kinds of machine:**

| Kind | What it does |
|---|---|
| Converters | Take gizmos in and push them up a tier. Some need two or three inputs to make one output. |
| Routers | Throw gizmos sideways into the neighbouring lane. Diverters send every gizmo across; Splitters alternate between straight ahead and across. A router aimed at a lane you haven't opened jams until you open it (Splitters just keep everything in-lane). |
| Movers | Speed up the entire line. |
| Energizers | Supply power, and draw none themselves. |
| Keepers | Add buffer space in every bay and raise what your gizmos sell for. |

**Power matters.** Every machine except an Energizer draws power. If your total draw
exceeds your supply, the whole line slows to the ratio between them — a brownout. The
bar at the top of the screen warns you.

**Gizmo tiers.** Six of them: Nub, Cog, Coil, Rotor, Core, Paragon, worth $12 up to
$1,150. They're the only coloured thing on the screen. Getting a gizmo up the tiers
before it falls off the end is the whole game.

**Orders.** Three standing orders are open at any time, each asking for a number of
gizmos at a particular tier. The first player to ship the full count takes the entire
fee and the order closes for everyone else. New orders arrive between rounds, and they
get more valuable as the game goes on.

**Shared stock.** The shop has a limited number of each machine and every player draws
from the same shelf. If someone buys the last Fusion Ring, there isn't one for you until
the restock between rounds.

**Winning.** Five rounds of ninety seconds, with a fifteen-second restock in between.
The winner is whoever has the highest net worth at the end: cash, plus half of
everything bolted down.

**Keyboard shortcuts** (useful for the host on a laptop): number keys select a bay, `U`
upgrades the selected one, `S` opens the shop, `Escape` closes whatever is open.

---

## Things worth knowing

**If someone's phone drops out**, they keep their seat, their line and their money.
They just reopen the same link. Their name shows as greyed out until they're back.

**If the host closes their tab, the room ends.** That's how peer-to-peer games work —
the host's browser is the server. The host gets a warning before leaving.

**The signalling server is a free shared one** run by the PeerJS project. It's fine for
playing with friends, but it has no uptime guarantee. If you want to run this properly,
stand up your own PeerServer (`npm i -g peer`, or the Docker image) behind HTTPS and
point the game at it by passing peer options in `index.html`:

```js
createHost({ slug: SLUG, maxPlayers: 3, peerOptions: { host: 'peer.yourdomain.com', port: 443, secure: true, path: '/' } });
```

The same option goes on `createClient`.

**Everyone on the same Wi-Fi works best.** Players on different networks may fail to
connect through certain routers, which would need a TURN server to fix.

---

## What's in the folder

```
gizmoworks/
├── index.html        all four screens, plus the host loop and client glue
├── amplify.yml       deploy config (no build step)
├── css/style.css     the drawing-office look
└── js/
    ├── net.js        peer connections, seats, reconnect
    ├── machines.js   the 44-machine catalogue and upgrade maths
    ├── game.js       the simulation — runs on the host only
    ├── render.js     draws the factory as a technical drawing
    ├── ui.js         shop, panels, orders, standings
    └── input.js      taps, keys, haptics
```

Want to change the balance? Everything lives in `js/machines.js` and the constants at
the top of `js/game.js` — round length, number of rounds, starting cash, lane count and prices.
