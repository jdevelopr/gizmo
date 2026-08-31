/**
 * machines.js — the parts list.
 *
 * Everything balance-related lives here so one file tunes the whole game.
 * Pure data and pure functions: no DOM, no network, safe to import anywhere.
 *
 * GIZMO 2 note: the board no longer changes size. GRID is the full extent of the
 * plot for the whole match, and each factory holds a `claim` — the side length of
 * the square it has actually bought, anchored at the top-left. Everything outside
 * the claim is drawn as unbuilt land and behaves exactly like the edge of the
 * world: you cannot build on it and anything fired into it is gone. Expanding
 * therefore never moves a machine or renumbers a slot; it only moves the fence.
 */

/**
 * Floor size, in slots per side. Always square. One page runs one match, so this
 * is module state rather than a parameter threaded through every call: the host
 * sets it from the Setup panel and every phone sets it from the state it is sent.
 */
export let GRID = 7;
export const MIN_GRID = 3;
export const MAX_GRID = 7;

/** Side length every factory starts with, before it buys any land. */
export const CLAIM_START = 3;
export const CELL = 32;           // pixel units per slot (art is authored at this size)
export const MAX_LEVEL = 3;       // machine level cap
export const MAX_UTIL = 5;        // producer / seller level cap

/* Directions, clockwise from east. dir 0 = east, 1 = south, 2 = west, 3 = north. */
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIR_NAME = ['East', 'South', 'West', 'North'];

/* ------------------------------------------------------------------ gizmos --- */

/**
 * Everything a gizmo can be, in three families.
 *
 * ALLOY (fam 0) is the original ladder and is untouched: Producer A drops Scrap,
 * Mutators print any rung of it, Fusers climb it. Value roughly doubles each rung
 * while the machine that prints it runs half as fast, so every Mutator earns about
 * the same per slot — that equilibrium, around 4.5 $/s per production slot, is the
 * anchor every other number in this file is set against.
 *
 * PART (fam 1) is what Producer B drops and what Fusers make of it. Parts are worth
 * little on their own. They exist to be one half of a recipe.
 *
 * PRODUCT (fam 2) is what an Assembler makes from a Part and an Alloy. Products are
 * terminal — nothing mutates or fuses them — and they are where the money is.
 */
export const ALLOY = 0, PART = 1, PRODUCT = 2;

export const TYPES = [
  // --- alloy: the ladder, from Producer A ---
  { name: 'Scrap',   color: '#8b93a8', glow: '#c3cbdb', value: 1,   fam: ALLOY, tier: 0 },
  { name: 'Copper',  color: '#e08a3c', glow: '#ffc07a', value: 3,   fam: ALLOY, tier: 1 },
  { name: 'Amber',   color: '#ffcd75', glow: '#fff0b8', value: 7,   fam: ALLOY, tier: 2 },
  { name: 'Bloom',   color: '#a7f070', glow: '#dcffb0', value: 15,  fam: ALLOY, tier: 3 },
  { name: 'Cobalt',  color: '#41a6f6', glow: '#a8dcff', value: 32,  fam: ALLOY, tier: 4 },
  { name: 'Void',    color: '#b55088', glow: '#ff9ad0', value: 70,  fam: ALLOY, tier: 5 },
  { name: 'Ember',   color: '#ff5d4a', glow: '#ffb09a', value: 150, fam: ALLOY, tier: 6 },
  { name: 'Prism',   color: '#ffffff', glow: '#ffffff', value: 320, fam: ALLOY, tier: 7 },
  // --- part: from Producer B, climbed with Fusers ---
  { name: 'Resin',   color: '#2fb98f', glow: '#8ff0d0', value: 1,   fam: PART, tier: 0 },
  { name: 'Cord',    color: '#4fd8bb', glow: '#b6fff0', value: 4,   fam: PART, tier: 1 },
  { name: 'Frame',   color: '#7fe8ff', glow: '#d6f7ff', value: 12,  fam: PART, tier: 2 },
  // --- product: from Assemblers, and nothing else ---
  { name: 'Engine',  color: '#ff9d3c', glow: '#ffd9a0', value: 34,  fam: PRODUCT, tier: 0 },
  { name: 'Turbine', color: '#ff6fae', glow: '#ffc4de', value: 132, fam: PRODUCT, tier: 1 },
  { name: 'Reactor', color: '#c8a2ff', glow: '#e8dcff', value: 430, fam: PRODUCT, tier: 2 },
];
export const MAX_TYPE = TYPES.length - 1;

/** Where each family starts in TYPES, and how many rungs it has. */
export const FAM_START = [0, 8, 11];
export const FAM_LEN = [8, 3, 3];
export const LADDER_MAX = FAM_LEN[ALLOY] - 1;

export const famOf = ty => TYPES[ty]?.fam ?? ALLOY;
export const tierOf = ty => TYPES[ty]?.tier ?? 0;

/** The rung `step` above this one, within its own family. Clamped at the top. */
export function upFam(ty, step = 1) {
  const t = TYPES[ty];
  if (!t) return ty;
  return FAM_START[t.fam] + Math.min(FAM_LEN[t.fam] - 1, t.tier + step);
}

/** Raw feedstock: loose stuff, and the only types a Producer ever drops. */
export const RAW = [0, 8];

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
    // routing, so it pays for that convenience in seconds. A Balancer is far faster
    // but only ever moves what it is given — speed is the price of multiplication.
    desc: 'Holds an original, copies it, and pushes both out front. Slow. A copy is never copied again.',
    price: 96, cycle: 1.8, cap: 1, hold: 2, travel: 0.52,
    body: '#27552f', trim: '#5fbf6a', lit: '#a7f070',
  },
  bal: {
    name: 'Balancer', short: 'BALANCER',
    // The routing primitive the game was missing. Until now the only way to send
    // gizmos two ways was to copy them, which meant you could not divide a stream
    // without inflating it — every fork was also an economic decision. This one
    // just divides. It is plumbing, and it is priced and sold as plumbing.
    desc: 'Takes one in and sends it out one exit, alternating sides. Never copies. '
      + 'Skips an exit that is backed up, so one blocked arm cannot stall the other.',
    price: 46, cycle: 0.34, cap: 1, hold: 2, travel: 0.34,
    body: '#5c4a1e', trim: '#c9a23f', lit: '#ffcd75',
  },
  sort: {
    name: 'Sorter', short: 'SORTER',
    desc: 'Sends the one type it is set to out to the side, and everything else straight ahead.',
    price: 92, cycle: 0.44, cap: 1, hold: 2, travel: 0.4,
    body: '#1f3a52', trim: '#4d9fd8', lit: '#a8dcff',
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
  asm: {
    name: 'Assembler', short: 'ASSEMBLER',
    // The machine the whole game was missing. A Fuser eats two of anything and
    // climbs one rung; an Assembler eats two SPECIFIC different things and makes a
    // third. That difference is what turns a floor from a tree into a graph: the
    // two ingredients cannot come from the same place, so two lines have to meet.
    desc: 'Holds one of each ingredient and builds a product. It will not accept a '
      + 'second of an ingredient it already has, so a line feeding it the wrong thing '
      + 'backs up instead of jamming it shut.',
    price: 0, cycle: 2.4, cap: 2, hold: 3, travel: 0.52,
    body: '#4a3a10', trim: '#d8a83f', lit: '#ffe08a',
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

/**
 * Assembler recipes. `mut` on an Assembler is the index into this list.
 *
 * Each one costs more raw material than climbing the ladder with the same Alloy
 * would, and pays back far more per slot — an Assembler is roughly three times a
 * Mutator's $/s. That is the trade: recipes are the best use of a slot in the game
 * and the worst use of a Producer, so they are what you build once the floor is
 * bigger than the raw feeding it.
 */
export const RECIPES = [
  { ins: [9, 2], out: 11, cycle: 2.4, price: 190 },    // Cord  + Amber  -> Engine
  { ins: [10, 4], out: 12, cycle: 3.6, price: 430 },   // Frame + Cobalt -> Turbine
  { ins: [10, 6], out: 13, cycle: 4.8, price: 880 },   // Frame + Ember  -> Reactor
];

export const recipeOf = m => RECIPES[m?.mut ?? 0] || RECIPES[0];

/** A recipe written out, for the shop card and the manual. */
export const recipeText = r =>
  `${TYPES[r.ins[0]].name} + ${TYPES[r.ins[1]].name} \u2192 ${TYPES[r.out].name}`;

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
  if (spec.kind === 'mut') return MUT_PRICE[spec.mut];
  if (spec.kind === 'asm') return (RECIPES[spec.mut ?? 0] || RECIPES[0]).price;
  return KINDS[spec.kind].price;
}

/**
 * `mut` is every configurable machine's one configuration number, read differently
 * depending on the kind: the tier a Mutator prints, the type a Sorter filters, the
 * recipe an Assembler builds. One field keeps it on the wire, in the shop card and
 * in makeMachine without three parallel code paths.
 */
export const TYPED = { mut: 'Mutator', sort: 'Sorter' };

export function label(spec) {
  if (spec.kind === 'asm') return `${TYPES[recipeOf(spec).out].name} Assembler`;
  const t = TYPED[spec.kind];
  return t ? `${TYPES[spec.mut ?? 1].name} ${t}` : KINDS[spec.kind].name;
}

export function describe(spec) {
  if (spec.kind === 'asm') return `${recipeText(recipeOf(spec))}. Both ingredients, every time.`;
  if (spec.kind === 'mut') return `Rewrites any gizmo into ${TYPES[spec.mut].name}.`;
  if (spec.kind === 'sort') {
    return `${TYPES[spec.mut ?? 1].name} goes out to the side; everything else goes straight ahead.`;
  }
  return KINDS[spec.kind].desc;
}

/* --------------------------------------------------------- producer/seller --- */

export const producerCycle = lvl => 2.7 * Math.pow(0.78, lvl - 1);
export const producerCost = lvl => Math.round(102 * Math.pow(UTIL_STEP, lvl - 1));
export const sellerMult = lvl => 1 + 0.3 * (lvl - 1);
export const sellerCost = lvl => Math.round(120 * Math.pow(UTIL_STEP, lvl - 1));

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
export const moverFree = (claim = GRID) => claim;

/**
 * Routing machines. None of them makes a gizmo worth more; they only decide where
 * it goes. That is the same argument that put conveyors on permanent sale, so all
 * three share it: buyable from the phone in any phase, in any number you can pay
 * for, and never counting against the one machine a round from the workshop.
 *
 * They also share one ladder and one counter, so each round's cheap allowance is a
 * budget you spend how you like — a long belt run, or one Balancer and a Sorter.
 * Reconnecting stays a right; sprawl stays a luxury.
 */
export const ROUTE_KINDS = ['pipe', 'bal', 'sort'];
export const ROUTE_STEP = 1.9;

/** What is refunded when a machine is scrapped, of everything paid for it. */
export const SCRAP_RATE = 0.3;

/**
 * Buying land. The first step out is deliberately cheap — nine slots fills up
 * fast now that nothing invalidates your line, so the first expansion should feel
 * like a formality rather than a decision. Every step after it costs a good deal
 * more than the last, which is what keeps a plot the size you can actually feed
 * rather than the size you can afford.
 */
export const EXPAND_BASE = 90;
export const EXPAND_STEP = 2.4;

/** Cost of growing a claim from `claim` to `claim + 1`. */
export function expandCost(claim) {
  return Math.round(EXPAND_BASE * Math.pow(EXPAND_STEP, Math.max(0, claim - CLAIM_START)));
}

/**
 * The order board.
 *
 * A fixed curve cannot work here. Round length, plot size and above all how well
 * someone routes a floor swing achievable income by an order of magnitude, so any
 * single ladder of numbers is either free for a good player or impossible for a
 * new one. The target is therefore measured against **your own best round**: ship
 * a quarter more than you have ever shipped and the order is filled.
 *
 * That is the production graph from Factorio turned into a goal. It is
 * self-calibrating, it cannot become unreachable through bad luck, and it means a
 * table of four wildly different players are all being asked the same question —
 * is your factory bigger than it was? — rather than the same number.
 *
 * A floor under it keeps the target climbing even after a flat round, so standing
 * still stops paying. Missing an order costs nothing but the bonus.
 */
export const ORDER_GROWTH = 1.25;       // over your own best round
export const ORDER_FLOOR_GROWTH = 1.15; // minimum climb, even after a flat round
export const ORDER_BONUS = 0.35;        // bonus as a fraction of the target

/**
 * Round one asks only that the starting line keeps running: nine tenths of what
 * the producer can push through an untouched starter kit in one round. Derived
 * from the clock rather than hardcoded, so a 60-second round asks for less.
 */
export function firstOrder(roundSecs) {
  const perRound = (roundSecs / producerCycle(1)) * 2;   // producer -> doubler, at $1 each
  return Math.max(20, Math.round(perRound * 0.9));
}

/** Next round's target, from this round's target and the best round so far. */
export function nextOrder(prevTarget, bestIncome) {
  return Math.max(
    Math.round(prevTarget * ORDER_FLOOR_GROWTH),
    Math.round(bestIncome * ORDER_GROWTH),
  );
}

export const orderBonus = target => Math.round(target * ORDER_BONUS);

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
  const base = m.kind === 'mut' ? MUT_CYCLE[m.mut ?? 1]
    : m.kind === 'asm' ? recipeOf(m).cycle
      : KINDS[m.kind].cycle;
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
export const sizeOf = ty => (RAW.includes(ty) ? 0.5 : 1);

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

    case 'bal': {
      // One in, one out. Which exit is the only decision, and it alternates, so a
      // stream arriving at 4/s leaves as two streams of 2/s rather than as 8/s of
      // anything. `release` may override this pick if that side is backed up.
      return [{ ty: a, dir: nextExit(m, balDirs(m)), cp: copy }];
    }

    case 'sort': {
      // The filter never reroutes on a jam: sending a Cobalt down the Scrap line
      // because the Cobalt line was briefly full would defeat the whole machine.
      // A backed-up sorter holds, and the stall walks back up the line as usual.
      const want = m.mut ?? 1;
      if (a !== want) return [{ ty: a, dir: d, cp: copy }];
      const outs = m.level >= 3 ? [(d + 1) % 4, (d + 3) % 4] : [(d + 1) % 4];
      return [{ ty: a, dir: outs.length > 1 ? nextExit(m, outs) : outs[0], cp: copy }];
    }

    case 'trident': {
      const dirs = [d, (d + 1) % 4, (d + 3) % 4];
      if (copy) return [{ ty: a, dir: nextExit(m, dirs), cp: 1 }];
      return dirs.map((dir, i) => ({ ty: a, dir, cp: i ? 1 : 0 }));
    }

    case 'mut': {
      // A level 3 mutator refuses to downgrade what it is given. That comparison
      // only means anything within the ladder: a Part or a Product is not "above"
      // Cobalt, it is somewhere else entirely, and feeding one in rewrites it. That
      // is a legitimate, lossy use of a Part — a second raw feed for the ladder.
      const higher = m.level >= 3 && famOf(a) === ALLOY && a > (m.mut ?? 1);
      return [{ ty: higher ? a : (m.mut ?? 1), dir: d, cp: copy }];
    }

    case 'fuse': {
      const b = inputs[1]?.ty ?? a;
      const step = (m.level >= 3 && a === b) ? 2 : 1;
      // Originality is inherited: it takes two originals to make an original.
      // Without this, a fuser would launder copies back into copyable stock and
      // the doubler chain would compound all over again.
      const cp = (inputs[0]?.cp || inputs[1]?.cp) ? 1 : 0;
      // A Fuser climbs whichever family it was fed — Scrap up the ladder, Resin up
      // to Cord and Frame. It only ever holds one family at a time, because `wants`
      // turns the other one away at the mouth.
      const top = tierOf(a) >= tierOf(b) ? a : b;
      return [{ ty: upFam(top, step), dir: d, cp }];
    }

    case 'asm': {
      // Both ingredients are already in hand — `wants` made sure of it — so the
      // only question left is where the product goes.
      const r = recipeOf(m);
      const cp = (inputs[0]?.cp && inputs[1]?.cp) ? 1 : 0;
      return [{ ty: r.out, dir: d, cp }];
    }

    default:
      return [];
  }
}

/**
 * Will this machine take one more gizmo of this type right now?
 *
 * Room is not the only question any more. An Assembler that accepted a second Cord
 * before its Amber arrived would fill both hands with the same ingredient and sit
 * there forever, so it refuses an ingredient it already has and refuses anything
 * that is not an ingredient at all. A Fuser refuses to mix families for the same
 * reason. Everything else takes whatever fits.
 *
 * The line feeding a machine that says no simply backs up, which is the behaviour
 * the whole simulation is built on — a wrongly-aimed belt now stalls visibly
 * instead of poisoning a machine.
 *
 * @param {object} m the machine, whose `buf` is the queue at its mouth
 * @param {number} ty gizmo type arriving
 */
export function wants(m, ty) {
  if (!m) return true;
  if (m.kind === 'asm') {
    const need = recipeOf(m).ins.slice();
    for (const g of m.buf) {
      const k = need.indexOf(g.ty);
      if (k >= 0) need.splice(k, 1);
    }
    return need.includes(ty);
  }
  if (m.kind === 'fuse') {
    if (famOf(ty) === PRODUCT) return false;      // products are terminal
    if (!m.buf.length) return true;
    return famOf(m.buf[0].ty) === famOf(ty);
  }
  return true;
}

/**
 * Every direction a machine can fire into, in world space. Routers are read at
 * their current level, so a level 3 Balancer reports its third exit. Used by the
 * conveyor auto-facing heuristic to tell a hand-off from a head-on collision.
 * @returns {number[]} distinct directions, 0 = east
 */
export function exitDirs(m) {
  const d = m.dir | 0;
  switch (m.kind) {
    case 'bal':
      return balDirs(m);
    case 'sort':
      // Ahead for the pass-through, plus wherever the filtered type is sent.
      return m.level >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, (d + 1) % 4];
    case 'trident':
      return [d, (d + 1) % 4, (d + 3) % 4];
    default:
      return [d];
  }
}

/** A balancer's exits: ahead and right, plus left at level 3. */
export function balDirs(m) {
  const d = m.dir | 0;
  return m.level >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, (d + 1) % 4];
}

/**
 * Machines allowed to pick a different exit when the one they chose is full. Only
 * the Balancer: it promises to divide a stream, and a divider that stalls because
 * one arm is briefly busy is not dividing anything.
 */
export const REROUTES = new Set(['bal']);

/** Round-robin over a router's exits, one at a time. */
function nextExit(m, dirs) {
  m.flip = ((m.flip || 0) + 1) % dirs.length;
  return dirs[m.flip];
}

/* ---------------------------------------------------------------- geometry --- */

export const cellOf = (cx, cy) => cy * GRID + cx;
export const cx = i => i % GRID;
export const cy = i => Math.floor(i / GRID);
export const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

/**
 * Is this coordinate inside a factory's claim? This, not `inGrid`, is the real
 * edge of the world for a running floor: the simulation asks it before letting a
 * gizmo travel and before letting a machine be set down.
 */
export const inClaim = (x, y, claim) =>
  x >= 0 && y >= 0 && x < claim && y < claim && x < GRID && y < GRID;

/** Is this slot index inside the claim? */
export const claimed = (i, claim) => inClaim(cx(i), cy(i), claim);

/** Every slot index inside a claim, reading order. */
export function claimCells(claim) {
  const out = [];
  for (let y = 0; y < claim; y++) for (let x = 0; x < claim; x++) out.push(cellOf(x, y));
  return out;
}

/**
 * Where the vaults sit for a given claim. They are welded to the east face and
 * ride outward as the plot grows, so a line built in round one still points the
 * right way — it just needs one more belt to reach the new fence. A second vault
 * opens once the plot is 5 wide, on the far corner of the same face, which is the
 * point at which running two arms is worth the slots.
 */
export const SECOND_VAULT_CLAIM = 5;

export function sellerSpotsFor(claim) {
  const spots = [{ cell: cellOf(claim - 1, 0), dir: 0 }];
  if (claim >= SECOND_VAULT_CLAIM) spots.push({ cell: cellOf(claim - 1, claim - 1), dir: 0 });
  return spots;
}

/**
 * The producers bolt onto the west face of the floor. A drops Scrap into the
 * top-left slot and is there from the first round. B drops Resin one row down and
 * opens when you claim your first ring of land — nine slots is not enough floor to
 * run two feeds into a recipe, and the round-one game should still be the simple
 * one. Both run at the same level: one PRODUCER upgrade speeds up both, which is
 * what makes that upgrade worth its price once B is running.
 */
export const PRODUCER_PORT = { cell: 0, dir: 2, ty: 0 };
export const RESIN_CLAIM = 4;
export const PRODUCERS = [
  PRODUCER_PORT,
  { cell: 0, dir: 2, ty: 8, row: 1, claim: RESIN_CLAIM },
];

/** The producer ports actually running at this claim, with their cells resolved. */
export function activePorts(claim) {
  return PRODUCERS
    .filter(p => claim >= (p.claim || 0))
    .map(p => ({ ...p, cell: cellOf(0, p.row || 0) }));
}

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

/**
 * Machines the workshop will not offer. GIZMO 2 keeps duplication in the game but
 * intends it as a deep research unlock rather than a round-two staple, so this is
 * the seam the tech tree will populate. It is empty for now: the copy machines are
 * still on the shop floor until there is a tree to hide them behind.
 */
export const TECH_LOCKED = new Set();

/** Weighted draw of one machine spec, tuned so later rounds offer richer parts. */
export function rollSpec(rnd, round) {
  // Routing machines are not in here: they are on permanent sale from the phone,
  // so spending one of three shop cards on a belt would be a wasted card.
  const table = ([
    ['store', 22],
    ['dup', 24],
    ['mut', 30],
    ['fuse', 14 + round * 2],
    ['asm', round >= 3 ? 10 + round * 3 : 0],
    ['trident', 6 + round],
  ]).filter(r => r[1] > 0 && !TECH_LOCKED.has(r[0]));
  const total = table.reduce((s, r) => s + r[1], 0);
  let n = rnd() * total;
  let kind = 'pipe';
  for (const [k, w] of table) { n -= w; if (n <= 0) { kind = k; break; } }

  const spec = { kind, dir: 0 };
  if (kind === 'mut') {
    const ceiling = Math.min(4, 1 + Math.floor(round / 2));
    spec.mut = 1 + Math.floor(rnd() * ceiling);
  }
  if (kind === 'asm') {
    // Later rounds put the heavier recipes on the table; the Engine is always there.
    const ceiling = Math.min(RECIPES.length, 1 + Math.floor((round - 2) / 2));
    spec.mut = Math.floor(rnd() * ceiling);
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
export function routeCost(kind, round, bought = 0, claim = GRID) {
  const base = KINDS[kind]?.price ?? KINDS.pipe.price;
  const free = moverFree(claim);
  if (bought < free) return base;
  return Math.round(base * costMult(round) * Math.pow(ROUTE_STEP, bought - free + 1));
}

/** The conveyor's price, which is the one every explanation is written around. */
export const moverCost = (round, bought = 0, claim = GRID) =>
  routeCost('pipe', round, bought, claim);

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
