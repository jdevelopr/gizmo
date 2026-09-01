/**
 * machines.js — GIZMO 3, the parts list.
 *
 * Everything balance-related lives here so one file tunes the whole game. Pure
 * data and pure functions: no DOM, no canvas, no timers, safe to import anywhere
 * including a headless harness.
 *
 * GIZMO 3 is a single-player desktop game on a world two orders of magnitude
 * bigger than GIZMO 2's floor, and three things follow from that:
 *
 *   1. **Nothing is welded to a fence any more.** Producers became Extractors that
 *      only work standing on a resource patch; Sellers became Market Depots you
 *      place wherever you like; the Lab became a building. All four are ordinary
 *      machines that occupy a slot, face a direction and can be moved. On a 7x7
 *      floor "the vault is on the east face" is a rule; on a 56x56 world it is a
 *      cage.
 *
 *   2. **The claim is centred, not cornered.** You own a square in the middle of
 *      the world and buy rings outward, so expansion is a direction you choose
 *      rather than a diagonal you are pushed along.
 *
 *   3. **Power.** Every machine draws it, generators make it by burning gizmos fed
 *      to them on a belt, and it conducts from a generator through touching
 *      machines out to a limited number of hops. A machine off the grid does not
 *      switch off — it crawls. See POWER below, and power.js for the solver.
 */

/* ------------------------------------------------------------------ world --- */

/** World size, in slots per side. Fixed for a whole game; the claim is what grows. */
export const WORLD = 56;

/** The square you own to begin with, centred. Even, so every ring stays centred. */
export const CLAIM_START = 10;

/** How much a claim grows per purchase: one ring, so one cell on every side. */
export const CLAIM_STEP = 2;

export const CELL = 32;           // pixel units per slot (art is authored at this size)
export const MAX_LEVEL = 3;       // machine level cap, raised to 3 by Overclocking

/* Directions, clockwise from east. dir 0 = east, 1 = south, 2 = west, 3 = north. */
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIR_NAME = ['East', 'South', 'West', 'North'];

/* ----------------------------------------------------------------- gizmos --- */

/**
 * Everything a gizmo can be, in three families. Carried over from GIZMO 2 intact,
 * because the equilibrium underneath it — value roughly doubles each rung while the
 * machine that prints it runs half as fast, so every Mutator earns about the same
 * per slot, around 4.5 $/s — is the anchor every other number here is set against,
 * and it is measured in dollars per second either way. Rounds never entered into it.
 */
export const ALLOY = 0, PART = 1, PRODUCT = 2;

export const TYPES = [
  // --- alloy: the ladder, from a Slag patch ---
  { name: 'Scrap',   color: '#8b93a8', glow: '#c3cbdb', value: 1,   fam: ALLOY, tier: 0 },
  { name: 'Copper',  color: '#e08a3c', glow: '#ffc07a', value: 3,   fam: ALLOY, tier: 1 },
  { name: 'Amber',   color: '#ffcd75', glow: '#fff0b8', value: 7,   fam: ALLOY, tier: 2 },
  { name: 'Bloom',   color: '#a7f070', glow: '#dcffb0', value: 15,  fam: ALLOY, tier: 3 },
  { name: 'Cobalt',  color: '#41a6f6', glow: '#a8dcff', value: 32,  fam: ALLOY, tier: 4 },
  { name: 'Void',    color: '#b55088', glow: '#ff9ad0', value: 70,  fam: ALLOY, tier: 5 },
  { name: 'Ember',   color: '#ff5d4a', glow: '#ffb09a', value: 150, fam: ALLOY, tier: 6 },
  { name: 'Prism',   color: '#ffffff', glow: '#ffffff', value: 320, fam: ALLOY, tier: 7 },
  // --- part: from a Sap patch, climbed with Fusers ---
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
export const FAM_NAME = ['Alloy', 'Part', 'Product'];
export const LADDER_MAX = FAM_LEN[ALLOY] - 1;

export const famOf = ty => TYPES[ty]?.fam ?? ALLOY;
export const tierOf = ty => TYPES[ty]?.tier ?? 0;

/** The rung `step` above this one, within its own family. Clamped at the top. */
export function upFam(ty, step = 1) {
  const t = TYPES[ty];
  if (!t) return ty;
  return FAM_START[t.fam] + Math.min(FAM_LEN[t.fam] - 1, t.tier + step);
}

/** Raw feedstock: the only two types a patch ever yields. */
export const RAW = [0, 8];

/** What the two ore patches are called on the map. Index matches RAW. */
export const ORE_NAME = { 0: 'Slag', 8: 'Sap' };

/**
 * How much room a gizmo takes up. Raw ore is loose swarf and packs two to the
 * space of one finished gizmo, so the front of a line flows freely and the squeeze
 * only starts once something has been made of it.
 */
export const sizeOf = ty => (RAW.includes(ty) ? 0.5 : 1);

/* ------------------------------------------------------------------ power --- */

/**
 * Power, the mechanic GIZMO 3 exists for.
 *
 * A **Generator** burns gizmos fed to it on a belt and makes kilowatts. Those
 * kilowatts conduct outward through *touching machines* — a conveyor conducts
 * exactly as well as an Assembler does — but only so many hops before they run
 * out. That single rule does an enormous amount of work: the belt that carries
 * fuel to a generator is also the wire that carries its power back out, so the
 * fuel line and the power grid are the same object, and a long arm of factory
 * reaching for a distant patch has to take its power with it.
 *
 * Nothing ever switches off. A machine that no generator reaches still runs, at
 * UNPOWERED speed, which is slow enough to be obviously wrong and fast enough
 * that a new factory works before anyone has explained electricity to you. What
 * does bite is a **brownout**: a grid whose machines demand more than its
 * generators supply runs everything on it at a speed that falls off with the
 * square of satisfaction, so being 10% short costs you 15% and being half short
 * costs you 60%. Under-building power is meant to be worth fixing immediately.
 */

/** What a machine off every grid still manages. Never zero: nothing powers off. */
export const UNPOWERED = 0.2;

/**
 * Speed multiplier for a machine on a grid that is `sat` satisfied, 0..1.
 * Squared rather than linear so a brownout is a thing you notice and repair.
 */
export function powerMult(sat) {
  const s = Math.max(0, Math.min(1, sat || 0));
  return UNPOWERED + (1 - UNPOWERED) * s * s;
}

/** Kilowatts a generator makes at each level. */
export const GEN_OUTPUT = [90, 150, 240];

/** How many machine-to-machine hops a generator's power carries, by level. */
export const GEN_REACH = [8, 11, 14];

/**
 * Burning a gizmo. Energy is roughly the 0.4 power of its market value, which
 * makes a Prism worth about ten Scrap in the firebox and three hundred and twenty
 * of them at a depot. Burning your good stuff is therefore always a mistake, and
 * the correct answer — run a dedicated line of raw ore to your generators — is the
 * one the numbers push you toward without a rule having to say so.
 *
 * @returns {number} kilowatt-seconds released by burning one of these
 */
export const fuelEnergy = ty => Math.round(90 * Math.pow(TYPES[ty]?.value || 1, 0.4));

/** What Combustion research multiplies every fuel's energy by. */
export const COMBUSTION_BONUS = 1.45;

/** What High Voltage research multiplies every generator's output by. */
export const VOLTAGE_BONUS = 1.6;

/** Extra hops Gridwork research adds to every generator's reach. */
export const GRIDWORK_REACH = 4;

/** What a level does to a machine's appetite. Levels buy speed, and speed costs. */
export const LEVEL_DRAW = [1, 1.5, 2.2];

/* ---------------------------------------------------------------- machines --- */

/**
 * `draw` is kilowatts at level 1 while the machine is actually working. Idle
 * machines draw nothing, which means a starved line is also a cheap one — a grid's
 * demand is what your factory is *doing*, not what you have built.
 *
 * `passive` machines never take a job. They have a mouth and a buffer and
 * something else entirely happens to what lands in it: a Depot pays for it, a Lab
 * studies it, a Generator burns it.
 */
export const KINDS = {
  pipe: {
    name: 'Conveyor', short: 'CONVEYOR',
    desc: 'Carries a gizmo one slot along. Room for one. Aims itself when you set it down, '
      + 'and conducts power like everything else.',
    price: 12, cycle: 0.26, cap: 1, hold: 1, travel: 0.26, draw: 1,
    body: '#2f4a63', trim: '#6ea2d8', lit: '#a8dcff',
  },
  store: {
    name: 'Storage', short: 'STORAGE',
    desc: 'Carries a gizmo one slot along like a belt, but holds a crowd while it waits. '
      + 'The cure for a line that keeps backing up.',
    price: 60, cycle: 0.35, cap: 1, hold: 6, travel: 0.26, draw: 1,
    body: '#20443f', trim: '#5fc9ae', lit: '#a7f0dc',
  },
  bal: {
    name: 'Balancer', short: 'BALANCER',
    desc: 'Takes one in and sends it out one exit, alternating sides. Never copies. '
      + 'Skips an exit that is backed up, so one blocked arm cannot stall the other. '
      + 'FLIP puts its branch on the other side without turning the through line.',
    price: 30, cycle: 0.34, cap: 1, hold: 2, travel: 0.34, draw: 2,
    body: '#5c4a1e', trim: '#c9a23f', lit: '#ffcd75',
  },
  sort: {
    name: 'Sorter', short: 'SORTER',
    desc: 'Sends the one type it is set to out to the side, and everything else straight ahead. '
      + 'FLIP chooses which side. Never reroutes on a jam.',
    price: 55, cycle: 0.44, cap: 1, hold: 2, travel: 0.4, draw: 3,
    body: '#1f3a52', trim: '#4d9fd8', lit: '#a8dcff',
  },
  ext: {
    name: 'Extractor', short: 'EXTRACTOR',
    // The Producer, unbolted. It has to stand on a patch, which is what finally
    // makes the map's geography an engineering problem rather than decoration:
    // ore is where the generator has to go, and where the belt has to come from.
    desc: 'Stands on a resource patch and pulls raw material out of it, forever. '
      + 'Its speed is the patch it is standing on. Takes nothing in.',
    price: 90, cycle: 1.1, cap: 0, hold: 2, travel: 0.4, draw: 6,
    body: '#4a3320', trim: '#c98a3f', lit: '#ffc07a',
  },
  gen: {
    name: 'Generator', short: 'GENERATOR',
    // Passive: it has a mouth and never a job. power.js drains its buffer.
    desc: 'Burns whatever you feed it and pushes power out through touching machines, '
      + 'for a limited number of hops. Raw ore is by far the cheapest thing to burn.',
    price: 140, cycle: 0, cap: 0, hold: 8, travel: 0, draw: 0, passive: true,
    body: '#6e1f14', trim: '#ff7a3a', lit: '#ffd08a',
  },
  depot: {
    name: 'Market Depot', short: 'DEPOT',
    desc: 'Buys anything pushed into it, at the going rate, instantly and without limit. '
      + 'This is where money comes from. Needs no power.',
    price: 240, cycle: 0, cap: 0, hold: 6, travel: 0, draw: 0, passive: true,
    body: '#1d4630', trim: '#4fbf72', lit: '#a7f070',
  },
  lab: {
    name: 'Research Lab', short: 'LAB',
    desc: 'Studies anything pushed into it and turns it into science, worth exactly what a '
      + 'depot would have paid. Research costs you the money you did not take.',
    price: 300, cycle: 0, cap: 0, hold: 6, travel: 0, draw: 0, passive: true,
    body: '#2b2f66', trim: '#6c74d8', lit: '#b8bcff',
  },
  dup: {
    name: 'Doubler', short: 'DOUBLER',
    desc: 'Holds an original, copies it, and pushes both out front. Levels add exits, '
      + 'never speed. It will not copy anything above Cobalt, and a copy is never copied again.',
    price: 260, cycle: 1.8, cap: 1, hold: 2, travel: 0.52, draw: 10,
    body: '#27552f', trim: '#5fbf6a', lit: '#a7f070',
  },
  trident: {
    name: 'Trident', short: 'TRIDENT',
    desc: 'Holds one, then fires the original three ways. Copies leave one at a time, in turn.',
    price: 160, cycle: 1.7, cap: 1, hold: 2, travel: 0.52, draw: 12,
    body: '#5c2a49', trim: '#b55088', lit: '#ff9ad0',
  },
  mut: {
    name: 'Mutator', short: 'MUTATOR',
    desc: 'Holds whatever it eats and rewrites it into one fixed type.',
    price: 0, cycle: 1.04, cap: 1, hold: 2, travel: 0.52, draw: 8,
    body: '#3b2f5e', trim: '#7a63bf', lit: '#b58cff',
  },
  asm: {
    name: 'Assembler', short: 'ASSEMBLER',
    desc: 'Holds one of each ingredient and builds a product. It will not accept a '
      + 'second of an ingredient it already has, so a line feeding it the wrong thing '
      + 'backs up instead of jamming it shut.',
    price: 0, cycle: 2.4, cap: 2, hold: 3, travel: 0.52, draw: 14,
    body: '#4a3a10', trim: '#d8a83f', lit: '#ffe08a',
  },
  fuse: {
    name: 'Fuser', short: 'FUSER',
    desc: 'Holds two gizmos and melts them into one of the next tier. Two originals make an original.',
    price: 110, cycle: 1.9, cap: 2, hold: 3, travel: 0.52, draw: 8,
    body: '#63321f', trim: '#c05a34', lit: '#ff8a5c',
  },
};

export const KIND_LIST = Object.keys(KINDS);

/** Machines with a mouth and no job: something else happens to what lands in them. */
export const PASSIVE = new Set(KIND_LIST.filter(k => KINDS[k].passive));

/** Machines you may only own so many of cheaply — each costs more than the last. */
export const LADDERED = { ext: 1.22, depot: 1.55, lab: 1.7 };

/** Mutators are priced by the tier they output. */
export const MUT_PRICE = [0, 55, 80, 115, 155, 215, 300, 410];

/**
 * Mutator speed halves each tier while gizmo value roughly doubles, so every
 * mutator earns about the same per slot. Tier is a choice about feedstock, not a
 * straight upgrade you buy your way past.
 */
export const MUT_CYCLE = [0, 0.84, 1.72, 3.52, 7.2, 14.8, 30.4, 62];

/** Assembler recipes. `mut` on an Assembler is the index into this list. */
export const RECIPES = [
  { ins: [9, 2], out: 11, cycle: 2.4, price: 160 },    // Cord  + Amber  -> Engine
  { ins: [10, 4], out: 12, cycle: 3.6, price: 350 },   // Frame + Cobalt -> Turbine
  { ins: [10, 6], out: 13, cycle: 4.8, price: 700 },   // Frame + Ember  -> Reactor
];

export const recipeOf = m => RECIPES[m?.mut ?? 0] || RECIPES[0];

export const recipeText = r =>
  `${TYPES[r.ins[0]].name} + ${TYPES[r.ins[1]].name} → ${TYPES[r.out].name}`;

/* ------------------------------------------------------------------- specs --- */

/** A machine spec is the catalogue-card form: { kind, dir, mut? }. */
export function makeMachine(spec, id) {
  return {
    id,
    kind: spec.kind,
    dir: spec.dir ?? 0,
    mut: spec.mut ?? 1,
    mir: spec.mir ? 1 : 0,
    level: spec.level || 1,
    buf: [],    // queued at the intake, waiting their turn: { id, ty, cp }
    work: [],   // in the machine's hands right now, for the whole cycle
    out: null,  // what this job will release, decided the moment it starts
    t: 0,       // seconds left in the current job (0 = idle and empty-handed)
    blocked: 0, // holding finished goods with nowhere to put them
    flip: 0,    // round-robin cursor, used when routing
    flash: 0,   // render-only pulse, set when it lets go
    sat: 0,     // how satisfied its power grid is, 0..1 (power.js writes this)
    net: -1,    // which power grid it belongs to, -1 for none (power.js writes this)
    fuel: 0,    // generators only: kilowatt-seconds left in whatever is burning
    load: 0,    // generators only: kilowatts it is actually delivering
    rich: spec.rich || 1,   // extractors only: the richness of the patch underneath
  };
}

export function price(spec) {
  if (spec.kind === 'mut') return MUT_PRICE[spec.mut ?? 1];
  if (spec.kind === 'asm') return (RECIPES[spec.mut ?? 0] || RECIPES[0]).price;
  return KINDS[spec.kind].price;
}

/**
 * What one costs to buy right now. Extractors, Depots and Labs climb a ladder in
 * the number you already own: they are the three machines that make money, science
 * and raw material out of nothing but a slot, so owning the twentieth has to be a
 * decision. Everything else is a stable price you can plan around, in minute one
 * and in hour three alike — growth in GIZMO 3 already costs more the further you
 * go, because land does, and inflation on top of that only taxes a plan you made
 * an hour ago and are finally able to pay for.
 */
export function buyCost(spec, owned = 0) {
  const step = LADDERED[spec.kind];
  const base = price(spec);
  return Math.max(4, Math.round(step ? base * Math.pow(step, owned) : base));
}

/**
 * `mut` is every configurable machine's one configuration number, read differently
 * by kind: the tier a Mutator prints, the type a Sorter filters, the recipe an
 * Assembler builds, the ore an Extractor is standing on.
 */
export const TYPED = { mut: 'Mutator', sort: 'Sorter' };

export function label(spec) {
  if (spec.kind === 'asm') return `${TYPES[recipeOf(spec).out].name} Assembler`;
  if (spec.kind === 'ext') return 'Extractor';
  const t = TYPED[spec.kind];
  return t ? `${TYPES[spec.mut ?? 1].name} ${t}` : KINDS[spec.kind].name;
}

/** Which way a router's branch points, in words, for the inspector. */
export const sideName = m => (m.mir ? 'left' : 'right');

export function describe(spec) {
  if (spec.kind === 'asm') return `${recipeText(recipeOf(spec))}. Both ingredients, every time.`;
  if (spec.kind === 'mut') return `Rewrites any gizmo into ${TYPES[spec.mut ?? 1].name}.`;
  if (spec.kind === 'sort') {
    return `${TYPES[spec.mut ?? 1].name} goes ${sideName(spec)}; everything else straight ahead.`;
  }
  if (spec.kind === 'bal') {
    return `Alternates between straight ahead and ${sideName(spec)}. Never copies.`;
  }
  return KINDS[spec.kind].desc;
}

/* ------------------------------------------------------------------ costs --- */

/** Each level costs UP_STEP times the last, starting at the machine's own price. */
export const UP_STEP = 2.2;

/** What is refunded when a machine is scrapped, of everything paid for it. */
export const SCRAP_RATE = 0.5;

/**
 * Buying land.
 *
 * The claim is a centred square and every purchase adds a ring, so what you get
 * for your money grows with the claim while the price grows faster. The first ring
 * costs about two minutes of an opening factory's income; the last one costs about
 * what a mature factory makes in ten. Between them is a game.
 */
export const EXPAND_BASE = 130;
export const EXPAND_STEP = 1.28;

export function expandCost(claim) {
  const rings = Math.max(0, (claim - CLAIM_START) / CLAIM_STEP);
  return Math.round(EXPAND_BASE * Math.pow(EXPAND_STEP, rings));
}

/** Clearing one rubble slot. Flat: it is a chore, not an investment. */
export const RUBBLE_COST = 50;

export function upgradeCost(m) {
  return Math.round(price(m) * Math.pow(UP_STEP, (m.level || 1) - 1));
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

/** What a level buys, for every machine that sells speed. */
export const LEVEL_SPEED = [1, 0.7, 0.45];

/** Extra units a Storage level buys. */
export const STORE_STEP = 4;

/** Extra fuel room a Generator level buys. */
export const GEN_HOLD_STEP = 4;

/**
 * Cycle time, before power. An Extractor is the interesting one: its speed is the
 * patch it is standing on, so two identical machines twenty slots apart can differ
 * by a factor of three, and where you build is a throughput decision.
 */
export function cycleTime(m, done = []) {
  if (KINDS[m.kind]?.passive) return 0;
  let base;
  if (m.kind === 'mut') base = MUT_CYCLE[m.mut ?? 1];
  else if (m.kind === 'asm') base = recipeOf(m).cycle;
  else if (m.kind === 'ext') base = KINDS.ext.cycle / Math.max(0.2, m.rich || 1) / yieldBonus(done);
  else base = KINDS[m.kind].cycle;
  // Storage levels buy capacity and a copier's levels buy exits. Neither buys speed.
  if (m.kind === 'store' || m.kind === 'dup' || m.kind === 'trident') return base;
  return base * (LEVEL_SPEED[(m.level || 1) - 1] ?? 1);
}

/** Kilowatts this machine asks for while it is working. */
export function drawOf(m) {
  const base = KINDS[m.kind]?.draw || 0;
  return base * (LEVEL_DRAW[(m.level || 1) - 1] ?? 1);
}

export function travelTime(m) {
  return KINDS[m.kind].travel * (m.kind === 'pipe' ? Math.pow(0.78, (m.level || 1) - 1) : 1);
}

/** How many gizmos this machine needs buffered before it fires. */
export const intake = m => KINDS[m.kind].cap;

/**
 * Total room inside a machine, in gizmo units: everything in its hands plus
 * everything queued at its mouth has to fit. A full machine turns arrivals away,
 * which is what makes a jam travel back up the line instead of vanishing.
 */
export function capacity(m) {
  const base = KINDS[m.kind].hold ?? 1;
  const lv = (m.level || 1) - 1;
  if (m.kind === 'store') return base + STORE_STEP * lv;
  if (m.kind === 'gen') return base + GEN_HOLD_STEP * lv;
  return base;
}

/** Room on a bare slot. Gizmos rest here; they are never destroyed. */
export const EMPTY_HOLD = 2;

/** The hard ceiling on duplication: nothing richer than Cobalt can be copied. */
export const COPY_MAX_VALUE = 32;
export const copyable = ty => TYPES[ty].value <= COPY_MAX_VALUE;

/* ---------------------------------------------------------------- routing --- */

/**
 * What comes out when the machine fires.
 *
 * The rule that keeps this economy from running away: **a copy is never copied
 * again.** Duplicating machines multiply originals and merely route copies onward,
 * so a chain of doublers adds copies linearly with the slots you spend rather than
 * doubling at every step. A Fuser is the launderer — two originals make one.
 */
export function outputs(m, inputs) {
  const d = m.dir;
  const a = inputs[0]?.ty ?? 0;
  const copy = inputs[0]?.cp ? 1 : 0;

  switch (m.kind) {
    case 'pipe':
    case 'store':
      return [{ ty: a, dir: d, cp: copy }];

    // An Extractor takes nothing in and makes one of whatever it is standing on.
    // `mut` is the ore type, written when it is placed.
    case 'ext':
      return [{ ty: m.mut ?? 0, dir: d, cp: 0 }];

    case 'dup': {
      if (copy) return [{ ty: a, dir: d, cp: 1 }];
      if (!copyable(a)) return [{ ty: a, dir: d, cp: 0 }];
      const n = 1 + (m.level || 1);                      // L1: 2, L2: 3, L3: 4
      return Array.from({ length: n }, (_, i) => ({ ty: a, dir: d, cp: i ? 1 : 0 }));
    }

    case 'bal':
      return [{ ty: a, dir: nextExit(m, balDirs(m)), cp: copy }];

    case 'sort': {
      const want = m.mut ?? 1;
      if (a !== want) return [{ ty: a, dir: d, cp: copy }];
      const outs = (m.level || 1) >= 3 ? [(d + 1) % 4, (d + 3) % 4] : [sideDir(m)];
      return [{ ty: a, dir: outs.length > 1 ? nextExit(m, outs) : outs[0], cp: copy }];
    }

    case 'trident': {
      const dirs = [d, (d + 1) % 4, (d + 3) % 4];
      if (copy || !copyable(a)) return [{ ty: a, dir: nextExit(m, dirs), cp: copy }];
      return dirs.map((dir, i) => ({ ty: a, dir, cp: i ? 1 : 0 }));
    }

    case 'mut':
      return [{ ty: m.mut ?? 1, dir: d, cp: copy }];

    case 'fuse': {
      const b = inputs[1]?.ty ?? a;
      const cp = (inputs[0]?.cp || inputs[1]?.cp) ? 1 : 0;
      const top = tierOf(a) >= tierOf(b) ? a : b;
      return [{ ty: upFam(top), dir: d, cp }];
    }

    case 'asm': {
      const r = recipeOf(m);
      const cp = (inputs[0]?.cp && inputs[1]?.cp) ? 1 : 0;
      return [{ ty: r.out, dir: d, cp }];
    }

    default:
      return [];   // depot, lab and gen never emit anything
  }
}

/**
 * Will this machine take one more gizmo of this type right now?
 *
 * An Extractor is the new answer here and it is a flat no: it has no mouth, so a
 * belt aimed at one backs up rather than quietly voiding what it carries. Depots,
 * Labs and Generators say yes to everything — a depot that refused Scrap would be
 * a very strange shop.
 */
export function wants(m, ty) {
  if (!m) return true;
  if (m.kind === 'ext') return false;
  if (m.kind === 'depot' || m.kind === 'lab' || m.kind === 'gen') return true;
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

/** Every direction a machine can fire into, in world space. */
export function exitDirs(m) {
  const d = m.dir | 0;
  switch (m.kind) {
    case 'depot': case 'lab': case 'gen':
      return [];
    case 'bal':
      return balDirs(m);
    case 'sort':
      return (m.level || 1) >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, sideDir(m)];
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
  return (m.level || 1) >= 3 ? [d, (d + 1) % 4, (d + 3) % 4] : [d, sideDir(m)];
}

/** Machines allowed to pick a different exit when the one they chose is full. */
export const REROUTES = new Set(['bal']);

function nextExit(m, dirs) {
  m.flip = ((m.flip || 0) + 1) % dirs.length;
  return dirs[m.flip];
}

/* ---------------------------------------------------------------- geometry --- */

export const cellOf = (x, y) => y * WORLD + x;
export const cx = i => i % WORLD;
export const cy = i => Math.floor(i / WORLD);
export const inWorld = (x, y) => x >= 0 && y >= 0 && x < WORLD && y < WORLD;

/** The lowest coordinate a claim of this side length covers. Claims are centred. */
export const claimMin = claim => Math.floor((WORLD - claim) / 2);
export const claimMax = claim => claimMin(claim) + claim - 1;

/**
 * Is this coordinate inside the claim? This, not `inWorld`, is the edge of the
 * world for a running factory: the simulation asks it before letting a gizmo
 * travel and before letting a machine be set down.
 */
export function inClaim(x, y, claim) {
  const lo = claimMin(claim), hi = lo + claim - 1;
  return x >= lo && y >= lo && x <= hi && y <= hi;
}

export const claimed = (i, claim) => inClaim(cx(i), cy(i), claim);

/** Every slot index inside a claim, reading order. */
export function claimCells(claim) {
  const lo = claimMin(claim), hi = lo + claim - 1;
  const out = [];
  for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) out.push(cellOf(x, y));
  return out;
}

/** Terrain codes. */
export const OPEN = 0, RUBBLE = 1, BEDROCK = 2;

/* --------------------------------------------------------------- research --- */

/** A gizmo studied is worth exactly what a depot would have paid for it. */
export const SCIENCE_RATE = 1;

/**
 * The tech tree.
 *
 * What starts unlocked is already a complete game: Extractors, Conveyors,
 * Balancers, Generators, Depots, Labs, Mutators and Fusers. Everything here makes
 * that game bigger, and every node is paid for out of production rather than out of
 * the bank — you cannot buy your way past a line that is not running.
 *
 * `unlocks` names machine kinds, or `asm:N` for one Assembler recipe. `level`
 * raises the ceiling every machine on the map can be upgraded to. `power` and
 * `yield` are flags the power solver and the extractors read.
 */
export const TECH = [
  { id: 'sorting', name: 'Sorting', cost: 120, needs: [], unlocks: ['sort'],
    blurb: 'Unlocks the Sorter, which pulls one type out of a mixed line.' },
  { id: 'gridwork', name: 'Gridwork', cost: 180, needs: [], power: 'reach',
    blurb: `Every generator's power reaches ${GRIDWORK_REACH} machines further.` },
  { id: 'storage', name: 'Warehousing', cost: 220, needs: [], unlocks: ['store'],
    blurb: 'Unlocks Storage — the cure for a line that keeps backing up.' },
  { id: 'combustion', name: 'Combustion', cost: 380, needs: ['gridwork'], power: 'fuel',
    blurb: 'Every fuel burns 45% longer, so a generator eats a smaller share of your ore.' },
  { id: 'assembly', name: 'Assembly', cost: 420, needs: [], unlocks: ['asm:0'],
    blurb: 'Unlocks the Engine Assembler, and with it recipes at all.' },
  { id: 'prospecting', name: 'Prospecting', cost: 700, needs: ['gridwork'], yield: 1.35,
    blurb: 'Every Extractor pulls 35% more out of the ground.' },
  { id: 'overclock', name: 'Overclocking', cost: 820, needs: ['storage'], level: 3,
    blurb: 'Raises every machine’s upgrade ceiling from level 2 to level 3.' },
  { id: 'assembly2', name: 'Assembly II', cost: 1150, needs: ['assembly'], unlocks: ['asm:1'],
    blurb: 'Unlocks the Turbine Assembler.' },
  { id: 'voltage', name: 'High Voltage', cost: 1500, needs: ['combustion'], power: 'output',
    blurb: 'Every generator makes 60% more power from the same fuel line.' },
  { id: 'replication', name: 'Replication', cost: 1900, needs: ['overclock'], unlocks: ['dup'],
    blurb: 'Unlocks the Doubler. Copies are gizmos out of nothing and nothing else in '
      + 'the game is, which is why it sits this deep and refuses to copy anything rich.' },
  { id: 'assembly3', name: 'Assembly III', cost: 2600, needs: ['assembly2'], unlocks: ['asm:2'],
    blurb: 'Unlocks the Reactor Assembler, the richest recipe there is.' },
  { id: 'trifurcation', name: 'Trifurcation', cost: 3400, needs: ['replication'],
    unlocks: ['trident'], blurb: 'Unlocks the Trident: three exits, one job.' },
];

export const techById = id => TECH.find(t => t.id === id) || null;

/** Can this node be started — is everything it needs already done? */
export const techOpen = (t, done) => (t.needs || []).every(n => done.includes(n));

/** Everything a set of finished research makes buildable. */
export function unlockedBy(done = []) {
  const out = new Set(['pipe', 'bal', 'ext', 'gen', 'depot', 'lab', 'mut', 'fuse']);
  for (const id of done) for (const u of techById(id)?.unlocks || []) out.add(u);
  return out;
}

/** The upgrade ceiling, which Overclocking raises. */
export const levelCap = (done = []) =>
  done.some(id => techById(id)?.level) ? MAX_LEVEL : MAX_LEVEL - 1;

const hasPower = (done, what) => done.some(id => techById(id)?.power === what);

/** Kilowatts a generator actually makes, after research. */
export const genOutput = (m, done = []) =>
  GEN_OUTPUT[(m.level || 1) - 1] * (hasPower(done, 'output') ? VOLTAGE_BONUS : 1);

/** How many hops a generator's power carries, after research. */
export const genReach = (m, done = []) =>
  GEN_REACH[(m.level || 1) - 1] + (hasPower(done, 'reach') ? GRIDWORK_REACH : 0);

/** Kilowatt-seconds one of these releases, after research. */
export const energyOf = (ty, done = []) =>
  fuelEnergy(ty) * (hasPower(done, 'fuel') ? COMBUSTION_BONUS : 1);

/** What Prospecting does to every Extractor. */
export const yieldBonus = (done = []) =>
  done.reduce((a, id) => a * (techById(id)?.yield || 1), 1);

/**
 * Everything buildable right now. No randomness, no reroll, no cap: what you have
 * unlocked, at what it costs, as many as you can afford and can fit.
 */
export function catalogue(done = [], counts = {}) {
  const on = unlockedBy(done);
  const out = [];
  const add = spec => out.push({ ...spec, dir: 0, cost: buyCost(spec, counts[spec.kind] || 0) });

  add({ kind: 'pipe' });
  add({ kind: 'bal' });
  if (on.has('sort')) add({ kind: 'sort' });
  if (on.has('store')) add({ kind: 'store' });
  add({ kind: 'ext' });
  add({ kind: 'gen' });
  add({ kind: 'depot' });
  add({ kind: 'lab' });
  for (let t = 1; t <= LADDER_MAX; t++) add({ kind: 'mut', mut: t });
  add({ kind: 'fuse' });
  RECIPES.forEach((r, i) => { if (on.has('asm:' + i)) add({ kind: 'asm', mut: i }); });
  if (on.has('dup')) add({ kind: 'dup' });
  if (on.has('trident')) add({ kind: 'trident' });
  return out;
}

/* --------------------------------------------------------------- contracts --- */

/**
 * Contracts, which are what replaced GIZMO 2's order board when the rounds went.
 *
 * A round-based game can ask "did you beat your best round"; a continuous one
 * cannot, because there is no moment at which to measure. So the board posts
 * standing orders instead: so many of one type, delivered to a depot, before a
 * clock runs out. They are generated from what you have actually been shipping —
 * a contract for Reactors handed to a factory that makes Scrap is not pressure,
 * it is noise — and they pay a premium over the market rate, so filling one is
 * worth routing for.
 *
 * Missing one costs nothing but the premium. Nothing in GIZMO 3 can take your
 * factory away from you.
 */
export const CONTRACT_SLOTS = 3;
export const CONTRACT_PREMIUM = 1.35;   // paid over the plain market value of the goods
export const CONTRACT_GRACE = 2.2;      // clock, as a multiple of the time it should take
export const CONTRACT_GAP = 45;         // seconds between a slot emptying and refilling

/* -------------------------------------------------------------- milestones --- */

/**
 * The opening hour, written down.
 *
 * GIZMO 3 has no rounds and therefore no moment that says "you have finished the
 * tutorial". These are that moment, five times over: the specific things a new
 * factory has to discover, in the order they become discoverable, each one ticked
 * off the instant it happens and never mentioned again. They award nothing. The
 * list is a map of what the game is, not a chore list.
 */
export const MILESTONES = [
  { id: 'sell', name: 'Make a sale', hint: 'Push anything into a Market Depot.' },
  { id: 'power', name: 'Power something', hint: 'Build a Generator touching your line, and feed it ore.' },
  { id: 'mutate', name: 'Climb the ladder', hint: 'Build a Mutator and send it raw ore.' },
  { id: 'science', name: 'Run an experiment', hint: 'Push a gizmo into a Research Lab.' },
  { id: 'expand', name: 'Buy land', hint: 'Claim a ring, and reach the patches outside your fence.' },
  { id: 'recipe', name: 'Assemble a product', hint: 'Research Assembly, then feed an Assembler both halves.' },
];

/* ------------------------------------------------------------------- misc --- */

/** Deterministic RNG, so a world can be replayed exactly from its seed. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Stir a seed so that neighbouring numbers give unrelated worlds. */
export function hashSeed(n) {
  let h = (n >>> 0) || 0x9e3779b9;
  h ^= h >>> 16; h = Math.imul(h, 0x21f0aaad); h >>>= 0;
  h ^= h >>> 15; h = Math.imul(h, 0x735a2d97); h >>>= 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** Money, formatted the one way the whole game formats it. */
export function money(n) {
  const v = Math.round(n || 0);
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a < 10000) return s + '$' + a.toLocaleString('en-US');
  if (a < 1000000) return s + '$' + (a / 1000).toFixed(a < 100000 ? 1 : 0) + 'k';
  return s + '$' + (a / 1000000).toFixed(2) + 'M';
}

/** A plain number, formatted compactly for a HUD that has to hold big ones. */
export function num(n, dp = 0) {
  const v = n || 0;
  const a = Math.abs(v);
  if (a < 10000) return (dp ? v.toFixed(dp) : Math.round(v).toLocaleString('en-US'));
  if (a < 1000000) return (v / 1000).toFixed(1) + 'k';
  return (v / 1000000).toFixed(2) + 'M';
}

/** Seconds as m:ss, for contract clocks. */
export function clock(s) {
  const t = Math.max(0, Math.ceil(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
