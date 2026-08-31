/**
 * machines.js — the parts list.
 *
 * Everything balance-related lives here so one file tunes the whole game.
 * Pure data and pure functions: no DOM, no network, safe to import anywhere.
 */

/**
 * Floor size, in slots per side. Always square. One page runs one match, so this
 * is module state rather than a parameter threaded through every call: the host
 * sets it from the Setup panel and every phone sets it from the state it is sent.
 */
export let GRID = 3;
export const MIN_GRID = 3;
export const MAX_GRID = 7;
export const CELL = 32;           // pixel units per slot (art is authored at this size)
export const MAX_LEVEL = 3;       // machine level cap
export const MAX_UTIL = 5;        // producer / seller level cap

/* Directions, clockwise from east. dir 0 = east, 1 = south, 2 = west, 3 = north. */
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIR_NAME = ['East', 'South', 'West', 'North'];

/* ------------------------------------------------------------------ gizmos --- */

/** Tier ladder. Each gizmo is drawn as a single pixel in its own color. */
export const TYPES = [
  { name: 'Scrap',  color: '#8b93a8', glow: '#c3cbdb', value: 1 },
  { name: 'Copper', color: '#e08a3c', glow: '#ffc07a', value: 3 },
  { name: 'Amber',  color: '#ffcd75', glow: '#fff0b8', value: 7 },
  { name: 'Bloom',  color: '#a7f070', glow: '#dcffb0', value: 15 },
  { name: 'Cobalt', color: '#41a6f6', glow: '#a8dcff', value: 32 },
  { name: 'Void',   color: '#b55088', glow: '#ff9ad0', value: 70 },
  { name: 'Ember',  color: '#ff5d4a', glow: '#ffb09a', value: 150 },
  { name: 'Prism',  color: '#ffffff', glow: '#ffffff', value: 320 },
];
export const MAX_TYPE = TYPES.length - 1;

/* ---------------------------------------------------------------- machines --- */

export const KINDS = {
  pipe: {
    name: 'Conveyor', short: 'CONVEYOR',
    desc: 'Carries a gizmo one slot along. Room for one. Aims itself when you set it down.',
    price: 15, cycle: 0.26, cap: 1, hold: 1, travel: 0.26,
    body: '#2f4a63', trim: '#6ea2d8', lit: '#a8dcff',
  },
  store: {
    name: 'Storage', short: 'STORAGE',
    desc: 'Carries a gizmo one slot along like a belt, but holds a crowd while it waits. '
      + 'The cure for a line that keeps backing up.',
    price: 84, cycle: 0.35, cap: 1, hold: 6, travel: 0.26,
    body: '#20443f', trim: '#5fc9ae', lit: '#a7f0dc',
  },
  dup: {
    name: 'Doubler', short: 'DOUBLER',
    // Deliberately the slowest multiplier on the floor: it is the one that needs no
    // routing, so it pays for that convenience in seconds. A Splitter is 1.9x faster.
    desc: 'Holds an original, copies it, and pushes both out front. Slow. A copy is never copied again.',
    price: 96, cycle: 1.8, cap: 1, hold: 2, travel: 0.52,
    body: '#27552f', trim: '#5fbf6a', lit: '#a7f070',
  },
  split: {
    name: 'Splitter', short: 'SPLITTER',
    desc: 'Holds one, then sends the original ahead and a copy right. Copies leave one at a time, alternating.',
    price: 78, cycle: 0.96, cap: 1, hold: 2, travel: 0.52,
    body: '#5c4a1e', trim: '#c9a23f', lit: '#ffcd75',
  },
  trident: {
    name: 'Trident', short: 'TRIDENT',
    desc: 'Holds one, then fires the original three ways. Copies leave one at a time, in turn.',
    price: 186, cycle: 1.7, cap: 1, hold: 2, travel: 0.52,
    body: '#5c2a49', trim: '#b55088', lit: '#ff9ad0',
  },
  mut: {
    name: 'Mutator', short: 'MUTATOR',
    desc: 'Holds whatever it eats and rewrites it into one fixed type.',
    price: 0, cycle: 1.04, cap: 1, hold: 2, travel: 0.52,
    body: '#3b2f5e', trim: '#7a63bf', lit: '#b58cff',
  },
  fuse: {
    name: 'Fuser', short: 'FUSER',
    desc: 'Holds two gizmos and melts them into one of the next tier. Two originals make an original.',
    price: 150, cycle: 1.9, cap: 2, hold: 3, travel: 0.52,
    body: '#63321f', trim: '#c05a34', lit: '#ff8a5c',
  },
};

/** Mutators are priced by the tier they output. */
export const MUT_PRICE = [0, 72, 102, 144, 192, 264, 372, 510];

export const KIND_LIST = Object.keys(KINDS);

/* ------------------------------------------------------------------- specs --- */

/** A machine spec is the shop-card form: { kind, dir, mut? }. */
export function makeMachine(spec, id) {
  return {
    id,
    kind: spec.kind,
    dir: spec.dir ?? 0,
    mut: spec.mut ?? 1,
    level: 1,
    buf: [],    // queued at the intake, waiting their turn: { id, ty, cp }
    work: [],   // in the machine's hands right now, for the whole cycle
    out: null,  // what this job will release, decided the moment it starts
    t: 0,       // seconds left in the current job (0 = idle and empty-handed)
    blocked: 0, // holding finished goods with nowhere to put them
    flip: 0,    // round-robin cursor, used when routing copies
    flash: 0,   // render-only pulse, set when it lets go
  };
}

export function price(spec) {
  return spec.kind === 'mut' ? MUT_PRICE[spec.mut] : KINDS[spec.kind].price;
}

export function label(spec) {
  return spec.kind === 'mut' ? `${TYPES[spec.mut].name} Mutator` : KINDS[spec.kind].name;
}

export function describe(spec) {
  if (spec.kind === 'mut') return `Rewrites any gizmo into ${TYPES[spec.mut].name}.`;
  return KINDS[spec.kind].desc;
}

/* ------------------------------------------------------------------ costs --- */

/*
 * Everything a floor earns multiplies: machine level times producer rate times
 * seller take, each one scaling the last. Costs used to add. That is why a good
 * line used to out-earn the entire shop in a single round and every decision after
 * round three stopped being a decision. So the prices multiply now too — each
 * level of anything costs four times the last, and the shop marks up by half again
 * every round. You buy one more thing per round, not everything.
 */

/** Each level costs UP_STEP times the last. */
export const UP_BASE = 2;
export const UP_STEP = 4;

/** Producer and Seller levels climb on the same ladder. */
export const UTIL_STEP = 4;

/** Workshop markup, compounding per round. */
export const SHOP_STEP = 1.55;

/**
 * Belts bought at base price each round before the ladder starts: one row's worth,
 * so a bigger floor gets the longer runs it actually needs. A 3x3 gets three, a 7x7
 * gets seven. This is the guarantee that you can always reconnect to a vault.
 */
export const moverFree = () => GRID;
export const MOVER_STEP = 1.9;

/** What is refunded when a machine is scrapped, of everything paid for it. */
export const SCRAP_RATE = 0.3;

export function upgradeCost(m) {
  return Math.round(price(m) * UP_BASE * Math.pow(UP_STEP, (m.level || 1) - 1));
}

/** Everything this machine has cost so far: the purchase plus every level bought. */
export function investedIn(m) {
  let paid = price(m);
  for (let l = 1; l < (m.level || 1); l++) paid += upgradeCost({ ...m, level: l });
  return paid;
}

export function scrapValue(m) {
  return Math.max(2, Math.round(investedIn(m) * SCRAP_RATE));
}

/**
 * Cycle time. Mutators are the exception: the higher the tier they print, the
 * slower they run, which is what stops a cheap high-tier mutator from ending
 * the economy on round two.
 */
export function cycleTime(m) {
  const base = m.kind === 'mut' ? MUT_CYCLE[m.mut ?? 1] : KINDS[m.kind].cycle;
  // A Storage level buys capacity instead, so its pace never changes.
  if (m.kind === 'store') return base;
  return base * Math.pow(0.7, m.level - 1);
}

/**
 * Mutator speed halves each tier while gizmo value roughly doubles, so every
 * mutator earns about the same per slot. Tier is a choice about feedstock for
 * doublers and fusers, not a straight upgrade you buy your way past.
 */
export const MUT_CYCLE = [0, 0.84, 1.72, 3.52, 7.2, 14.8, 30.4, 62];

export function travelTime(m) {
  return KINDS[m.kind].travel * (m.kind === 'pipe' ? Math.pow(0.78, m.level - 1) : 1);
}

/** How many gizmos this machine needs buffered before it fires. */
export function intake(m) {
  return KINDS[m.kind].cap;
}

/**
 * How much room a gizmo takes up. Raw Scrap is loose swarf and packs two to the
 * space of one finished gizmo, so the front of a line flows freely and the squeeze
 * only starts once something has been made of it.
 */
export const sizeOf = ty => (ty === 0 ? 0.5 : 1);

/**
 * Total room inside a machine, in gizmo units: everything in its hands plus
 * everything queued at its mouth has to fit. A full machine turns arrivals away,
 * which is what makes a jam travel back up the line instead of vanishing.
 * Storage is the one machine whose levels buy room rather than speed.
 */
export function capacity(m) {
  const base = KINDS[m.kind].hold ?? 1;
  return m.kind === 'store' ? base + STORE_STEP * ((m.level || 1) - 1) : base;
}

/** Extra units a Storage level buys. */
export const STORE_STEP = 4;

/** Room on a bare slot with no machine on it. Gizmos rest here; they are never destroyed. */
export const EMPTY_HOLD = 2;

/**
 * What comes out when the machine fires.
 *
 * The one rule that keeps this economy from running away: **a copy is never
 * copied again**. Duplicating machines multiply originals and merely route
 * copies onward, so a chain of doublers adds copies linearly with the slots you
 * spend rather than doubling at every step. A Fuser is the launderer — it eats
 * two gizmos and returns a fresh original that can be multiplied again.
 *
 * @param {object} m machine (its `flip` cursor advances when routing copies)
 * @param {Array<{id:number,ty:number,cp:number}>} inputs consumed gizmos
 * @returns {Array<{ty:number,dir:number,cp:number}>}
 */
export function outputs(m, inputs) {
  const d = m.dir;
  const a = inputs[0]?.ty ?? 0;
  const copy = inputs[0]?.cp ? 1 : 0;

  switch (m.kind) {
    case 'pipe':
    case 'store':
      return [{ ty: a, dir: d, cp: copy }];

    case 'dup': {
      if (copy) return [{ ty: a, dir: d, cp: 1 }];       // pass a copy straight on
      const n = 1 + m.level;                             // L1: 2, L2: 3, L3: 4
      return Array.from({ length: n }, (_, i) => ({ ty: a, dir: d, cp: i ? 1 : 0 }));
    }

    case 'split': {
      const dirs = m.level >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, (d + 1) % 4];
      if (copy) return [{ ty: a, dir: nextExit(m, dirs), cp: 1 }];
      return dirs.map((dir, i) => ({ ty: a, dir, cp: i ? 1 : 0 }));
    }

    case 'trident': {
      const dirs = [d, (d + 1) % 4, (d + 3) % 4];
      if (copy) return [{ ty: a, dir: nextExit(m, dirs), cp: 1 }];
      return dirs.map((dir, i) => ({ ty: a, dir, cp: i ? 1 : 0 }));
    }

    case 'mut': {
      // A level 3 mutator refuses to downgrade what it is given. Rewriting a copy
      // does not make it an original — only fusing does that.
      const ty = (m.level >= 3 && a > m.mut) ? a : m.mut;
      return [{ ty, dir: d, cp: copy }];
    }

    case 'fuse': {
      const b = inputs[1]?.ty ?? a;
      const step = (m.level >= 3 && a === b) ? 2 : 1;
      // Originality is inherited: it takes two originals to make an original.
      // Without this, a fuser would launder copies back into copyable stock and
      // the doubler chain would compound all over again.
      const cp = (inputs[0]?.cp || inputs[1]?.cp) ? 1 : 0;
      return [{ ty: Math.min(MAX_TYPE, Math.max(a, b) + step), dir: d, cp }];
    }

    default:
      return [];
  }
}

/**
 * Every direction a machine can fire into, in world space. Routers are read at
 * their current level, so a level 3 splitter reports its third exit. Used by the
 * conveyor auto-facing heuristic to tell a hand-off from a head-on collision.
 * @returns {number[]} distinct directions, 0 = east
 */
export function exitDirs(m) {
  const d = m.dir | 0;
  switch (m.kind) {
    case 'split':
      return m.level >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, (d + 1) % 4];
    case 'trident':
      return [d, (d + 1) % 4, (d + 3) % 4];
    default:
      return [d];
  }
}

/** Round-robin over a router's exits, one copy at a time. */
function nextExit(m, dirs) {
  m.flip = ((m.flip || 0) + 1) % dirs.length;
  return dirs[m.flip];
}

/* --------------------------------------------------------- producer/seller --- */

export const producerCycle = lvl => 2.7 * Math.pow(0.78, lvl - 1);
export const producerCost = lvl => Math.round(102 * Math.pow(UTIL_STEP, lvl - 1));
export const sellerMult = lvl => 1 + 0.3 * (lvl - 1);
export const sellerCost = lvl => Math.round(120 * Math.pow(UTIL_STEP, lvl - 1));

/* ---------------------------------------------------------------- geometry --- */

export const cellOf = (cx, cy) => cy * GRID + cx;
export const cx = i => i % GRID;
export const cy = i => Math.floor(i / GRID);
export const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

/** The producer bolts onto the west face of the top-left slot. */
export const PRODUCER_PORT = { cell: 0, dir: 2 };

/** Every point where a gizmo can leave the floor: { cell, dir }. */
export let EXITS = [];

/** Exits the seller is allowed to occupy (the producer owns one of them). */
export let SELLER_SPOTS = [];

function rebuildGeometry() {
  const out = [];
  for (let i = 0; i < GRID * GRID; i++) {
    for (let d = 0; d < 4; d++) {
      const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
      if (!inGrid(nx, ny)) out.push({ cell: i, dir: d });
    }
  }
  EXITS = out;
  SELLER_SPOTS = out.filter(
    e => !(e.cell === PRODUCER_PORT.cell && e.dir === PRODUCER_PORT.dir)
  );
}
rebuildGeometry();

/**
 * Resize the floor. Everything derived from the size is rebuilt here, so callers
 * only need to make sure no factory outlives the change — the engine rebuilds
 * every factory when a match starts.
 * @returns {number} the size actually applied
 */
export function setGridSize(n) {
  const next = Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(n) || MIN_GRID));
  if (next === GRID) return GRID;
  GRID = next;
  rebuildGeometry();
  return GRID;
}

/* -------------------------------------------------------------- shop rolls --- */

/** Weighted draw of one machine spec, tuned so later rounds offer richer parts. */
export function rollSpec(rnd, round) {
  const table = [
    ['pipe', 30],
    ['store', 15],
    ['dup', 20],
    ['split', 16],
    ['mut', 22],
    ['fuse', 8 + round * 2],
    ['trident', 4 + round],
  ];
  const total = table.reduce((s, r) => s + r[1], 0);
  let n = rnd() * total;
  let kind = 'pipe';
  for (const [k, w] of table) { n -= w; if (n <= 0) { kind = k; break; } }

  const spec = { kind, dir: 0 };
  if (kind === 'mut') {
    const ceiling = Math.min(4, 1 + Math.floor(round / 2));
    spec.mut = 1 + Math.floor(rnd() * ceiling);
  }
  return spec;
}

/** Shop prices compound with the rounds, so a late purchase is a real commitment. */
export const costMult = round => Math.pow(SHOP_STEP, Math.max(0, round - 1));
export const shopCost = (spec, round) => Math.max(4, Math.round(price(spec) * costMult(round)));

/**
 * What the next conveyor costs. The first few each round go for base price whatever
 * the round, because a player who cannot reach a vault cannot score at all and that
 * is not a game. Past those, each belt in the same round costs nearly double the
 * last on top of the round's markup — sprawl is a luxury, reconnecting is a right.
 * @param {number} round
 * @param {number} bought how many have already been bought this round
 */
export function moverCost(round, bought = 0) {
  const base = KINDS.pipe.price;
  const free = moverFree();
  if (bought < free) return base;
  return Math.round(base * costMult(round) * Math.pow(MOVER_STEP, bought - free + 1));
}

/** Three distinct-ish options for one player's shop. */
export function rollShop(rnd, round, n = 3) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 60) {
    const s = rollSpec(rnd, round);
    const key = s.kind + (s.mut ?? '');
    if (out.some(o => o.kind + (o.mut ?? '') === key)) continue;
    out.push(s);
  }
  while (out.length < n) out.push(rollSpec(rnd, round));
  for (const s of out) s.cost = shopCost(s, round);
  return out;
}

/** Deterministic-ish RNG so a round can be replayed from a seed if ever needed. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
