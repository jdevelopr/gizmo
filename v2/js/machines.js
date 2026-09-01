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
    price: 70, cycle: 0.35, cap: 1, hold: 6, travel: 0.26,
    body: '#20443f', trim: '#5fc9ae', lit: '#a7f0dc',
  },
  dup: {
    name: 'Doubler', short: 'DOUBLER',
    // Deliberately the slowest multiplier on the floor: it is the one that needs no
    // routing, so it pays for that convenience in seconds. A Balancer is far faster
    // but only ever moves what it is given — speed is the price of multiplication.
    desc: 'Holds an original, copies it, and pushes both out front. Levels add exits, '
      + 'never speed. It will not copy anything above Cobalt, and a copy is never copied again.',
    price: 260, cycle: 1.8, cap: 1, hold: 2, travel: 0.52,
    body: '#27552f', trim: '#5fbf6a', lit: '#a7f070',
  },
  bal: {
    name: 'Balancer', short: 'BALANCER',
    // The routing primitive the game was missing. Until now the only way to send
    // gizmos two ways was to copy them, which meant you could not divide a stream
    // without inflating it — every fork was also an economic decision. This one
    // just divides. It is plumbing, and it is priced and sold as plumbing.
    desc: 'Takes one in and sends it out one exit, alternating sides. Never copies. '
      + 'Skips an exit that is backed up, so one blocked arm cannot stall the other. '
      + 'FLIP puts its branch on the other side without turning the through line.',
    price: 36, cycle: 0.34, cap: 1, hold: 2, travel: 0.34,
    body: '#5c4a1e', trim: '#c9a23f', lit: '#ffcd75',
  },
  sort: {
    name: 'Sorter', short: 'SORTER',
    desc: 'Sends the one type it is set to out to the side, and everything else straight ahead. '
      + 'FLIP chooses which side.',
    price: 68, cycle: 0.44, cap: 1, hold: 2, travel: 0.4,
    body: '#1f3a52', trim: '#4d9fd8', lit: '#a8dcff',
  },
  trident: {
    name: 'Trident', short: 'TRIDENT',
    desc: 'Holds one, then fires the original three ways. Copies leave one at a time, in turn.',
    price: 160, cycle: 1.7, cap: 1, hold: 2, travel: 0.52,
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
    price: 120, cycle: 1.9, cap: 2, hold: 3, travel: 0.52,
    body: '#63321f', trim: '#c05a34', lit: '#ff8a5c',
  },
};

/** Mutators are priced by the tier they output. */
export const MUT_PRICE = [0, 60, 85, 120, 160, 220, 310, 425];

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
  { ins: [9, 2], out: 11, cycle: 2.4, price: 165 },    // Cord  + Amber  -> Engine
  { ins: [10, 4], out: 12, cycle: 3.6, price: 360 },   // Frame + Cobalt -> Turbine
  { ins: [10, 6], out: 13, cycle: 4.8, price: 720 },   // Frame + Ember  -> Reactor
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
    // Which side a router's side exit is on: 0 = right of its facing, 1 = left.
    // A Balancer's exits are otherwise decided entirely by which way it points,
    // and pointing it the other way to move the branch also moves the through
    // line, which is usually the one thing you did not want to move.
    mir: spec.mir ? 1 : 0,
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

/** Which way a router's branch points, in words, for the selection panel. */
export const sideName = m => (m.mir ? 'left' : 'right');

export function describe(spec) {
  if (spec.kind === 'asm') return `${recipeText(recipeOf(spec))}. Both ingredients, every time.`;
  if (spec.kind === 'mut') return `Rewrites any gizmo into ${TYPES[spec.mut].name}.`;
  if (spec.kind === 'sort') {
    return `${TYPES[spec.mut ?? 1].name} goes ${sideName(spec)}; everything else straight ahead.`;
  }
  if (spec.kind === 'bal') {
    return `Alternates between straight ahead and ${sideName(spec)}. Never copies.`;
  }
  return KINDS[spec.kind].desc;
}

/* --------------------------------------------------------- producer/seller --- */

export const producerCycle = lvl => 2.7 * Math.pow(0.78, lvl - 1);
export const producerCost = lvl => Math.round(85 * Math.pow(UTIL_STEP, lvl - 1));
export const sellerMult = lvl => 1 + 0.3 * (lvl - 1);
export const sellerCost = lvl => Math.round(100 * Math.pow(UTIL_STEP, lvl - 1));

/* ------------------------------------------------------------------ costs --- */

/*
 * Costs multiply, because earnings multiply — but they used to multiply far harder
 * than earnings do, and in a game where the factory persists that is fatal.
 *
 * The old numbers came from GIZMO 1, where the Seller jumped every round and a
 * floor was rebuilt from scratch each time. Here you keep what you build, so income
 * climbs in steps: it roughly doubles each time you add a tier to the line, and
 * then flattens while you save for the next one. A shop marking up 55% *every
 * round* compounds to 21x by round eight and outruns that completely — a Cobalt
 * Mutator finished the match costing $4,127 against an income of a few hundred.
 * The same went for every other ladder: maxing the Producer, the one upgrade that
 * raises the raw ceiling everything else depends on, cost $8,670.
 *
 * These are set against what a floor can actually earn. A well-built 7x7 tops out
 * around $5,000 a round; a competent 5x5 makes a few hundred. Maxing a fixture now
 * costs about what a good mid-game round earns, the plot costs under a thousand
 * end to end, and the shop's late-round premium is a real premium rather than a
 * wall.
 */

/** Each level costs UP_STEP times the last, starting at UP_BASE times the price. */
export const UP_BASE = 1;
export const UP_STEP = 2.2;

/** Producer and Seller levels climb on the same ladder. */
export const UTIL_STEP = 2.1;

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
export const SCRAP_RATE = 0.5;

/**
 * Buying land. The first step out is deliberately cheap — nine slots fills up
 * fast now that nothing invalidates your line, so the first expansion should feel
 * like a formality rather than a decision. Every step after it costs a good deal
 * more than the last, which is what keeps a plot the size you can actually feed
 * rather than the size you can afford.
 */
export const EXPAND_BASE = 75;
export const EXPAND_STEP = 1.8;

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
/*
 * Tuned against the harness rather than by feel. Income does not climb smoothly —
 * it steps each time you add a tier to a line and then sits flat while you save
 * for the next one — so asking for a quarter more than your best round meant a big
 * round set a bar you could not clear until two rounds later. At these numbers an
 * ordinary bot that never routes a second arm fills about half its orders, which
 * leaves real headroom for someone actually playing well.
 */
export const ORDER_GROWTH = 1.15;       // over your own best round
export const ORDER_FLOOR_GROWTH = 1.12; // minimum climb, even after a flat round
export const ORDER_BONUS = 0.35;        // bonus as a fraction of the target

/**
 * Round one asks only that the starting line keeps running: nine tenths of what the
 * producer can push down an untouched belt run in one round. Derived from the clock
 * rather than hardcoded, so a 60-second round asks for less.
 */
export function firstOrder(roundSecs) {
  const perRound = roundSecs / producerCycle(1);   // one belt run, raw Scrap at $1 each
  return Math.max(15, Math.round(perRound * 0.9));
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
  // Storage levels buy capacity, and a copier's levels buy extra exits. Neither
  // buys speed: a Doubler you could also make faster would be printing money again,
  // so its throughput stays fixed at whatever is feeding it.
  if (m.kind === 'store' || m.kind === 'dup' || m.kind === 'trident') return base;
  return base * (LEVEL_SPEED[(m.level || 1) - 1] ?? 1);
}

/**
 * Mutator speed halves each tier while gizmo value roughly doubles, so every
 * mutator earns about the same per slot. Tier is a choice about feedstock for
 * doublers and fusers, not a straight upgrade you buy your way past.
 */
export const MUT_CYCLE = [0, 0.84, 1.72, 3.52, 7.2, 14.8, 30.4, 62];

/**
 * What a level buys, for every machine that sells speed: a 30% cut to the cycle,
 * then a bigger one again. The second upgrade being the better of the two is the
 * point — these are the machines with nothing else to offer at level 3, so it has
 * to be worth taking them all the way rather than stopping at 2.
 *
 * Storage buys capacity instead, and the copiers buy exits, so both ignore this.
 */
export const LEVEL_SPEED = [1, 0.7, 0.45];

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
 * The hard ceiling on duplication.
 *
 * Copying is the only thing in GIZMO that makes a gizmo out of nothing, and a
 * Doubler behind a Prism Mutator would print several hundred dollars a second
 * against an economy anchored near four and a half. Rather than nerf the machine
 * into uselessness, it simply cannot hold a pattern above Cobalt: feed it anything
 * richer and it passes it through untouched. That is a rule you read off the card
 * instead of discovering in the balance sheet.
 */
export const COPY_MAX_VALUE = 32;
export const copyable = ty => TYPES[ty].value <= COPY_MAX_VALUE;

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
      if (!copyable(a)) return [{ ty: a, dir: d, cp: 0 }];
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
      const outs = m.level >= 3 ? [(d + 1) % 4, (d + 3) % 4] : [sideDir(m)];
      return [{ ty: a, dir: outs.length > 1 ? nextExit(m, outs) : outs[0], cp: copy }];
    }

    case 'trident': {
      const dirs = [d, (d + 1) % 4, (d + 3) % 4];
      if (copy || !copyable(a)) return [{ ty: a, dir: nextExit(m, dirs), cp: copy }];
      return dirs.map((dir, i) => ({ ty: a, dir, cp: i ? 1 : 0 }));
    }

    case 'mut': {
      // Whatever goes in comes out as this Mutator's type, at every level. Levels
      // buy speed and nothing else — see MUT_LEVEL. A Mutator that changed what it
      // made as it levelled meant the same machine did different things depending
      // on a number you had to remember, and the thing it changed into was worth
      // more, so a Cobalt Mutator could quietly emit an Ember. One machine, one
      // output, is worth more than the cleverness was.
      return [{ ty: m.mut ?? 1, dir: d, cp: copy }];
    }

    case 'fuse': {
      const b = inputs[1]?.ty ?? a;
      // One rung, at every level. A level 3 Fuser used to jump two on a matching
      // pair, which made the same machine do different things depending on a number
      // you had to remember — and quietly turned a Cobalt line into an Ember one.
      // Its levels buy speed now, like a Mutator's.
      // Originality is inherited: it takes two originals to make an original.
      // Without this, a fuser would launder copies back into copyable stock and
      // the doubler chain would compound all over again.
      const cp = (inputs[0]?.cp || inputs[1]?.cp) ? 1 : 0;
      // A Fuser climbs whichever family it was fed — Scrap up the ladder, Resin up
      // to Cord and Frame. It only ever holds one family at a time, because `wants`
      // turns the other one away at the mouth.
      const top = tierOf(a) >= tierOf(b) ? a : b;
      return [{ ty: upFam(top), dir: d, cp }];
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
      return m.level >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, sideDir(m)];
    case 'trident':
      return [d, (d + 1) % 4, (d + 3) % 4];
    default:
      return [d];
  }
}

/** The side a router branches to: right of its facing, or left if mirrored. */
export const sideDir = m => ((m.dir | 0) + (m.mir ? 3 : 1)) % 4;

/** A balancer's exits: ahead and its side, plus both sides at level 3. */
export function balDirs(m) {
  const d = m.dir | 0;
  return m.level >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, sideDir(m)];
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

/* ------------------------------------------------------------------ plot --- */

/**
 * What is standing on a slot before anyone builds there.
 *
 * The map is the only thing GIZMO randomises, and it is randomised for the same
 * reason Factorio does it: the rules of a factory game are worth learning once and
 * keeping, while the ground they are built on is worth changing every time. Rubble
 * can be cleared for a fee. Bedrock never can — it is the shape of the plot, and
 * routing around it is the puzzle.
 */
export const OPEN = 0, RUBBLE = 1, BEDROCK = 2;

/** What clearing one rubble slot costs. Flat: it is a chore, not an investment. */
export const RUBBLE_COST = 45;

/**
 * Faces a vault or the Lab may trade from, as [dx, dy] direction indices. West is
 * missing on purpose — that is where the feeds come in, and a vault beside the
 * Producer is a floor with no factory on it.
 */
const TRADE_FACES = [0, 1, 3];

/**
 * A fixture's slot, from a face and how far along that face it sits.
 *
 * Fixtures ride the fence: their position is stored as a face plus a fraction, and
 * resolved against whatever the claim currently is. That is what lets a generated
 * layout survive expansion — a vault two thirds of the way down the east face is
 * still two thirds of the way down it when the plot grows.
 */
export function faceCell(face, along, claim) {
  const last = claim - 1;
  const at = Math.max(0, Math.min(last, Math.round(along * last)));
  if (face === 0) return cellOf(last, at);      // east
  if (face === 1) return cellOf(at, last);      // south
  if (face === 3) return cellOf(at, 0);         // north
  return cellOf(0, at);                         // west
}

/** Every slot index of the plot, whatever the claim. */
const allCells = plot => Array.from({ length: plot * plot }, (_, i) => i);

/** Stir a seed so that neighbouring numbers give unrelated maps. */
export function hashSeed(n) {
  let h = (n >>> 0) || 0x9e3779b9;
  h ^= h >>> 16; h = Math.imul(h, 0x21f0aaad); h >>>= 0;
  h ^= h >>> 15; h = Math.imul(h, 0x735a2d97); h >>>= 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Generate one match's plot: where the feeds enter, where the vaults and the Lab
 * trade, and what is lying on the ground.
 *
 * Everyone in a match gets this same plot. The whole point of the rewrite that
 * removed the jumping seller was that nobody should win on a kinder roll, and a
 * generated map would put that straight back if it were rolled per player.
 *
 * @param {number} seed
 * @param {number} plot full board size
 * @param {number} claimStart the square everyone owns to begin with
 */
export function generatePlot(seed, plot = GRID, claimStart = CLAIM_START) {
  // A raw xorshift correlates badly on small neighbouring seeds — 1, 2 and 3 all
  // open with nearly the same number — so the seed is stirred before it is used.
  // Otherwise "seed 4418" is the same map as "seed 4417" with a pebble moved.
  const rnd = rng(hashSeed(seed));
  const pick = arr => arr[Math.floor(rnd() * arr.length) % arr.length];

  // --- the feeds. They stay on the west face: raw material comes in from the
  // left, the art is drawn for it, and the row each one enters is variety enough.
  const rows = [];
  while (rows.length < 2) {
    const r = Math.floor(rnd() * claimStart);
    if (!rows.includes(r)) rows.push(r);
  }
  const feeds = [{ row: rows[0], ty: 0 }, { row: rows[1], ty: 8, claim: RESIN_CLAIM }];

  /*
   * The vaults and the Lab: three fixtures on the fence, none of them on top of
   * another. Where the Lab lands relative to the vault is the most interesting
   * thing the generator decides. Next door, and a Balancer on that slot splits your
   * output between money and research. Across the floor, and serving both is a
   * routing problem worth a Sorter. Both are good games; having only ever played
   * the first one is why this exists.
   */
  const spots = [];
  const clear = (face, along) => spots.every(s =>
    s.face !== face || Math.abs(s.along - along) > 0.34);
  while (spots.length < 3) {
    let placed = false;
    for (let guard = 0; guard < 60 && !placed; guard++) {
      const face = pick(TRADE_FACES);
      const along = pick([0, 0.5, 1]);
      if (!clear(face, along)) continue;
      spots.push({ face, along });
      placed = true;
    }
    if (!placed) break;      // nine positions, three fixtures: this cannot happen
  }
  const lab = spots.pop();

  // --- terrain.
  const terrain = new Uint8Array(plot * plot);
  const protect = new Set();
  for (const f of feeds) protect.add(cellOf(0, Math.min(f.row, claimStart - 1)));
  for (let c = claimStart; c <= plot; c++) {
    for (const sp of [...spots, lab]) protect.add(faceCell(sp.face, sp.along, c));
  }

  for (const i of allCells(plot)) {
    if (protect.has(i)) continue;
    const x = cx(i), y = cy(i);
    const inStart = x < claimStart && y < claimStart;
    // Thin near the start and thicker further out, so the opening is playable and
    // the land you buy later is worth looking at before you buy it.
    const ring = Math.max(x, y);
    const chance = inStart ? 0.1 : 0.14 + ring * 0.03;
    if (rnd() >= chance) continue;
    // Bedrock never appears in the opening claim: round one should be a factory,
    // not a maze.
    terrain[i] = (!inStart && rnd() < 0.4) ? BEDROCK : RUBBLE;
  }

  carveRoutes(terrain, plot, claimStart, feeds, spots, lab);
  clearOpening(terrain, claimStart, feeds[0], spots[0]);
  return { seed, plot, feeds, spots, lab, terrain };
}

/**
 * The plot GIZMO had before it generated any: feeds on the west face at rows 0 and
 * 1, vaults down the east one, the Lab north of the first, and nothing lying on the
 * ground anywhere. Useful as a fixed board to test against, and as the map to hand
 * someone who is learning the game and does not need the terrain yet.
 */
export function plainPlot(plot = GRID, claimStart = CLAIM_START) {
  return {
    seed: 0,
    plot,
    feeds: [{ row: 0, ty: 0 }, { row: 1, ty: 8, claim: RESIN_CLAIM }],
    spots: [{ face: 0, along: 0 }, { face: 0, along: 1 }],
    lab: { face: 3, along: 1 },
    terrain: new Uint8Array(plot * plot),
  };
}

/**
 * Open one clean route from the first feed to the first vault inside the starting
 * claim, and leave it that way.
 *
 * Everything else on the map can be worked around or paid to remove, but the
 * starter line is laid for free before anyone has a penny — so its route has to be
 * walkable ground, not rubble somebody would have to clear first. Two seeds in four
 * hundred fell foul of this, which is exactly the sort of thing nobody finds until
 * the night it matters.
 */
function clearOpening(terrain, claim, feed, vault) {
  const from = cellOf(0, Math.min(feed.row, claim - 1));
  const to = faceCell(vault.face, vault.along, claim);
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    if (at === to) break;
    for (let d = 0; d < 4; d++) {
      const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= claim || ny >= claim) continue;
      const n = cellOf(nx, ny);
      if (prev.has(n)) continue;         // rubble and bedrock are both walkable here:
      prev.set(n, at);                   // carveRoutes has already promised a way
      queue.push(n);
    }
  }
  for (let c = to; c !== undefined && c !== -1; c = prev.get(c)) terrain[c] = OPEN;
}

/**
 * Make sure the map is playable: from every feed to every fixture there has to be
 * a way through that does not involve moving bedrock, at the claim where both are
 * available. Anything in the way of the last resort gets downgraded to rubble, and
 * failing that cleared — a generated map that cannot be finished is not a map.
 */
function carveRoutes(terrain, plot, claimStart, feeds, spots, lab) {
  const reach = (from, to, claim, blocked) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const at = queue.shift();
      if (at === to) return true;
      for (let d = 0; d < 4; d++) {
        const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= claim || ny >= claim) continue;
        const n = cellOf(nx, ny);
        if (seen.has(n) || blocked(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return false;
  };

  for (let claim = claimStart; claim <= plot; claim++) {
    for (const f of feeds) {
      if (claim < (f.claim || 0)) continue;
      const from = cellOf(0, Math.min(f.row, claim - 1));
      for (const sp of [...spots, lab]) {
        const to = faceCell(sp.face, sp.along, claim);
        if (reach(from, to, claim, i => terrain[i] === BEDROCK)) continue;
        // Bedrock is in the way. Soften it along a simple L, which is always a
        // legal route on a square, and try again.
        const ax = cx(from), ay = cy(from), bx = cx(to), by = cy(to);
        for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
          if (terrain[cellOf(x, ay)] === BEDROCK) terrain[cellOf(x, ay)] = RUBBLE;
        }
        for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
          if (terrain[cellOf(bx, y)] === BEDROCK) terrain[cellOf(bx, y)] = RUBBLE;
        }
      }
    }
  }
}

/**
 * Where the Lab sits: the north face of the very slot the first vault trades from.
 *
 * That adjacency is the whole point. The last slot of a line can fire east into the
 * vault for cash or north into the Lab for science, so "sell it now or research it"
 * is a decision you make with a machine rather than from a menu — and splitting
 * your output between money and growth becomes the Balancer's canonical job.
 */
export function labSpotFor(claim) {
  return { cell: cellOf(claim - 1, 0), dir: 3 };
}

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

/* ------------------------------------------------------------- research --- */

/**
 * Science is your factory's output spent on itself.
 *
 * A gizmo pushed into the Lab is worth exactly what a vault would have paid for it
 * \u2014 no bonus, no penalty \u2014 so the only thing research costs you is the money you
 * did not take. That is the Factorio trade in its plainest form: growth is
 * rate-limited by what your floor can actually make, not by what is in your bank,
 * and you cannot buy your way past a line that is not running.
 */
export const SCIENCE_RATE = 1;

/**
 * The tech tree.
 *
 * What starts unlocked is already a complete game: Conveyors and Balancers to
 * route, Mutators to climb the ladder, Fusers to double up. Everything here makes
 * that game bigger, and every node is paid for out of production.
 *
 * `unlocks` names machine kinds, or `asm:N` for one Assembler recipe. `level`
 * raises the ceiling every machine on the floor can be upgraded to.
 */
export const TECH = [
  { id: 'sorting', name: 'Sorting', cost: 120, needs: [], unlocks: ['sort'],
    blurb: 'Puts the Sorter on permanent sale with the rest of the plumbing.' },
  { id: 'storage', name: 'Warehousing', cost: 200, needs: [], unlocks: ['store'],
    blurb: 'Unlocks Storage \u2014 the cure for a line that keeps backing up.' },
  { id: 'assembly', name: 'Assembly', cost: 340, needs: [], unlocks: ['asm:0'],
    blurb: 'Unlocks the Engine Assembler, and with it recipes at all.' },
  { id: 'overclock', name: 'Overclocking', cost: 620, needs: ['storage'], level: 3,
    blurb: 'Raises every machine\u2019s upgrade ceiling from level 2 to level 3.' },
  { id: 'assembly2', name: 'Assembly II', cost: 950, needs: ['assembly'], unlocks: ['asm:1'],
    blurb: 'Unlocks the Turbine Assembler.' },
  { id: 'replication', name: 'Replication', cost: 1400, needs: ['overclock'], unlocks: ['dup'],
    blurb: 'Unlocks the Doubler. Copies are gizmos out of nothing and nothing else in '
      + 'the game is, which is why it sits this deep and refuses to copy anything rich.' },
  { id: 'assembly3', name: 'Assembly III', cost: 2100, needs: ['assembly2'], unlocks: ['asm:2'],
    blurb: 'Unlocks the Reactor Assembler, the richest recipe there is.' },
  { id: 'trifurcation', name: 'Trifurcation', cost: 2800, needs: ['replication'],
    unlocks: ['trident'], blurb: 'Unlocks the Trident: three exits, one job.' },
];

export const techById = id => TECH.find(t => t.id === id) || null;

/** Can this node be started \u2014 is everything it needs already done? */
export const techOpen = (t, done) => (t.needs || []).every(n => done.includes(n));

/** Everything a set of finished research makes buildable. */
export function unlockedBy(done = []) {
  const out = new Set(['pipe', 'bal', 'mut', 'fuse']);
  for (const id of done) for (const u of techById(id)?.unlocks || []) out.add(u);
  return out;
}

/** The upgrade ceiling, which Overclocking raises. */
export const levelCap = (done = []) =>
  done.some(id => techById(id)?.level) ? MAX_LEVEL : MAX_LEVEL - 1;

/** Routing machines on sale right now \u2014 the Sorter has to be researched first. */
export const routeKindsFor = (done = []) =>
  ROUTE_KINDS.filter(k => k !== 'sort' || unlockedBy(done).has('sort'));

/**
 * What a machine costs. The same in round eight as in round one.
 *
 * The catalogue used to mark everything up a little each round, compounding, which
 * is a reasonable instinct — a late purchase should feel like a commitment — but it
 * makes the wrong thing expensive. Growth in this game already costs more the
 * further you go: land climbs steeply, levels climb steeply, and each routing
 * machine in a round costs more than the last. Inflation on top of that punishes
 * the player who is behind, taxes a plan made in round two and paid for in round
 * five, and turns a price list you could learn into one you have to re-read every
 * round. A stable price is a thing you can build a plan around.
 */
export const shopCost = spec => Math.max(4, Math.round(price(spec)));

/**
 * Everything buildable right now, priced for this round.
 *
 * The workshop used to deal three random cards and let you keep one. A tech tree
 * makes that randomness actively wrong: a node you paid production for has to
 * actually hand you the thing. So it is a catalogue \u2014 what you have unlocked, at
 * what it costs, as many as you can afford and can fit. Slots are the limit now,
 * which is the limit it should always have been.
 */
export function catalogue(done = []) {
  const on = unlockedBy(done);
  const out = [];
  const add = spec => out.push({ ...spec, dir: 0, cost: shopCost(spec) });

  if (on.has('store')) add({ kind: 'store' });
  add({ kind: 'fuse' });
  if (on.has('dup')) add({ kind: 'dup' });
  if (on.has('trident')) add({ kind: 'trident' });
  RECIPES.forEach((r, i) => { if (on.has('asm:' + i)) add({ kind: 'asm', mut: i }); });
  for (let t = 1; t <= LADDER_MAX; t++) add({ kind: 'mut', mut: t });
  return out;
}

/**
 * What the next routing machine costs.
 *
 * A number of them equal to your plot's width go for base price every round,
 * because a player who cannot reach a vault cannot score at all and that is not a
 * game. Past that allowance each one in the same round costs nearly double the
 * last — sprawl is a luxury, reconnecting is a right. The ladder resets every
 * round, so it prices a single round's sprawl rather than the whole match.
 *
 * @param {number} bought how many have already been bought this round
 */
export function routeCost(kind, bought = 0, claim = GRID) {
  const base = KINDS[kind]?.price ?? KINDS.pipe.price;
  const free = moverFree(claim);
  if (bought < free) return base;
  return Math.round(base * Math.pow(ROUTE_STEP, bought - free + 1));
}

/** The conveyor's price, which is the one every explanation is written around. */
export const moverCost = (bought = 0, claim = GRID) => routeCost('pipe', bought, claim);

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
