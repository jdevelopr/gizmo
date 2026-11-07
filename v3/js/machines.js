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
export const WORLD = 80;

/**
 * The square you own to begin with, centred.
 *
 * Nine slots. It holds the starting line — Extractor, one conveyor, Depot — and
 * leaves six, which is exactly enough to fit a Generator and the Balancer that
 * feeds it if you think about where they go. That is the opening: not a factory
 * with room to spare, but a packing puzzle with one obvious first move and a
 * fence you want to push outward within a minute of arriving.
 */
export const CLAIM_START = 3;

/** How much a claim grows per purchase: one ring, so one cell on every side. */
export const CLAIM_STEP = 2;

export const CELL = 32;           // pixel units per slot (art is authored at this size)
export const MAX_LEVEL = 5;       // machine level cap: 2 to begin with, raised a level a rank by Overclocking

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
export const ALLOY = 0, PART = 1, PRODUCT = 2, MUNITION = 3;

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
  // --- munition: from an Armory, and only worth anything to a Zapper ---
  { name: 'Ammo',    color: '#e8f04a', glow: '#fbffb8', value: 1,   fam: MUNITION, tier: 0 },
  { name: 'Charged Ammo', color: '#ff5cf0', glow: '#ffc8fb', value: 2, fam: MUNITION, tier: 1 },
];
export const MAX_TYPE = TYPES.length - 1;

/** Where each family starts in TYPES, and how many rungs it has. */
export const FAM_START = [0, 8, 11, 14];
export const FAM_LEN = [8, 3, 3, 2];
export const FAM_NAME = ['Alloy', 'Part', 'Product', 'Munition'];

/** The one gizmo a Zapper eats. Made by an Armory from one Scrap and one Copper. */
export const AMMO = 14;

/**
 * Two Ammo fused make one Charged Ammo: the same six shots, each doing twice the
 * damage. The total damage is exactly what the two Ammo had — fusing does not make
 * firepower out of nothing — but it is twice the damage per shot, so twice the rate
 * of fire against a nest and one-shot kills on Mites, for half the belt traffic.
 */
export const CHARGED = 15;
export const CHARGED_MULT = 2;
export const isAmmo = ty => ty === AMMO || ty === CHARGED;

/** What a Recycler turns a gizmo into: Resin for the Sap family, Scrap for the rest. */
export const RESIN = 8;
export const recycleTo = ty => (TYPES[ty]?.fam === PART ? RESIN : 0);
/** Shots loaded in a Zapper, of both kinds. */
export const shotsOf = m => (m.charge | 0) + (m.hot | 0);
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
/** Speed at full power, relative to a machine's listed cycle: five times unpowered. */
export const POWERED = 1;

/**
 * Speed multiplier for a machine on a grid that is `sat` satisfied, 0..1.
 * Squared rather than linear so a brownout is a thing you notice and repair.
 */
export function powerMult(sat) {
  const s = Math.max(0, Math.min(1, sat || 0));
  return UNPOWERED + (POWERED - UNPOWERED) * s * s;
}

/**
 * The Solar Panel: a little power, all the time, from nothing. A sixth of a
 * Generator at level 1, and its power spreads only a few hops.
 */
export const SOLAR_OUTPUT = [15, 22, 32, 45, 62];
export const SOLAR_REACH = [4, 5, 6, 7, 8];

/** The Pylon: how many slots may lie between a linked pair, by level. */
export const PYLON_GAP = [3, 4, 5, 6, 8];

/**
 * The Repair Drone Bay: fed Copper, it spends DRONE_COST of it to fully repair the
 * most damaged machine within range, once a cycle. It holds six.
 */
export const DRONE_FUEL = 1;          // Copper
export const DRONE_COST = 2;
export const DRONE_CYCLE = 3;
export const DRONE_RANGE = [6, 7, 8, 9, 10];

/** Kilowatts a generator makes at each level. */
export const GEN_OUTPUT = [90, 150, 240, 360, 520];

/** How many machine-to-machine hops a generator's power carries, by level. */
export const GEN_REACH = [8, 11, 14, 17, 20];

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
export const LEVEL_DRAW = [1, 1.5, 2.2, 3.0, 4.0];

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
    price: 180, cycle: 0.35, cap: 1, hold: 6, travel: 0.26, draw: 1,
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
    price: 200, cycle: 0, cap: 0, hold: 8, travel: 0, draw: 0, passive: true,
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
    price: 20000, cycle: 1.8, cap: 1, hold: 2, travel: 0.52, draw: 10,
    body: '#27552f', trim: '#5fbf6a', lit: '#a7f070',
  },
  trident: {
    name: 'Trident', short: 'TRIDENT',
    desc: 'Holds one, then fires the original three ways. Copies leave one at a time, in turn.',
    price: 50000, cycle: 1.7, cap: 1, hold: 2, travel: 0.52, draw: 12,
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
    desc: 'Keeps a separate queue for each ingredient and builds a product from one '
      + 'of each. One belt carrying both is enough — it takes what it needs out of the '
      + 'stream and lets the queues even out the ratio.',
    price: 0, cycle: 2.4, cap: 2, hold: 8, travel: 0.52, draw: 14,
    body: '#4a3a10', trim: '#d8a83f', lit: '#ffe08a',
  },
  fuse: {
    name: 'Fuser', short: 'FUSER',
    desc: 'Melts two gizmos of the same type into one of the next rung up. It queues two '
      + 'different types at once, so a belt carrying Scrap and Resin feeds one Fuser and '
      + 'gets Copper and Cord back. Two originals make an original.',
    price: 800, cycle: 1.9, cap: 2, hold: 8, travel: 0.52, draw: 8,
    body: '#63321f', trim: '#c05a34', lit: '#ff8a5c',
  },
  arm: {
    name: 'Armory', short: 'ARMORY',
    desc: 'Presses one Scrap and one Copper into one Ammo, from any side and off one mixed '
      + 'belt. Short of one half, it makes do: three Scrap, or two Copper, do the same job. '
      + 'Ammo is what a Zapper fires.',
    price: 1500, cycle: 1.0, cap: 2, hold: 8, travel: 0.52, draw: 8,
    body: '#4a4416', trim: '#c9c23f', lit: '#fbffb8',
  },
  drill: {
    name: 'Mountain Drill', short: 'DRILL',
    // Like an Extractor it takes nothing in. It faces a mountain and digs that
    // mountain's seam out, and pushes what it digs out of its *back*.
    desc: 'Set it beside a mountain, facing it, and it digs out the mineral in that '
      + 'mountain — up to Cobalt, straight out of the rock, no Mutator needed — and pushes '
      + 'it out of its back. Slow, and a mountain runs out. Drilling wakes Beetles.',
    price: 2000, cycle: 2.0, cap: 0, hold: 2, travel: 0.4, draw: 10,
    body: '#3a3a44', trim: '#9aa0b8', lit: '#e0e4f0',
  },
  bridge: {
    name: 'Bridge', short: 'BRIDGE',
    desc: 'Comes in pairs. Two Bridges facing the same way, up to four slots apart, carry '
      + 'gizmos and power straight over whatever is between them — a valley, rock, another '
      + 'belt. A Bridge on its own is just a belt.',
    price: 500, cycle: 0.3, cap: 1, hold: 1, travel: 0.3, draw: 1,
    body: '#4a3a24', trim: '#c9a26a', lit: '#ffe0a8',
  },
  zap: {
    name: 'Zapper', short: 'ZAPPER',
    // Passive: it has a mouth and never a job. bugs.js loads it and fires it.
    desc: 'A laser turret. Feed it Ammo on a belt — every Ammo is several shots — and it '
      + 'zaps any mite that comes within range. Draws power while it recharges between '
      + 'shots, so a big swarm is a big spike on its grid.',
    price: 2200, cycle: 0, cap: 0, hold: 4, travel: 0, draw: 12, passive: true,
    body: '#2a1f4a', trim: '#8f6cff', lit: '#e0d4ff',
  },
  over: {
    name: 'Overflow Splitter', short: 'OVERFLOW',
    desc: 'Sends everything straight ahead, and only when the line ahead is backed up does it '
      + 'spill the extra out of its side. Feed the Generator first, sell the rest. FLIP chooses the side.',
    price: 35, cycle: 0.34, cap: 1, hold: 2, travel: 0.34, draw: 2,
    body: '#4a2a22', trim: '#e0805a', lit: '#ffc2a0',
  },
  recyc: {
    name: 'Recycler', short: 'RECYCLER',
    desc: 'Shreds anything you feed it — a jammed mix, spare Ammo, the wrong rung — and '
      + 'pushes out one Scrap for each, or one Resin for Resin, Cord and Frame. The clean-up '
      + 'crew for a messy line.',
    price: 600, cycle: 0.8, cap: 1, hold: 4, travel: 0.52, draw: 6,
    body: '#2c3a2a', trim: '#7fae6a', lit: '#c8f0a0',
  },
  pylon: {
    name: 'Pylon', short: 'PYLON',
    desc: 'Comes in pairs. Two Pylons facing the same way, a few slots apart, carry power '
      + 'across whatever is between them — rock, a valley, open space. Power only, never gizmos.',
    price: 70, cycle: 0, cap: 0, hold: 0, travel: 0, draw: 0, passive: true,
    body: '#34304a', trim: '#b8b0e8', lit: '#fff3a0',
  },
  drone: {
    name: 'Repair Drone Bay', short: 'DRONE BAY',
    desc: 'Feed it Copper and it keeps a drone flying: every few seconds it spends two Copper to '
      + 'fully patch up the most damaged machine nearby. Holds six Copper.',
    price: 1800, cycle: 0, cap: 0, hold: 6, travel: 0, draw: 6, passive: true,
    body: '#1f3d44', trim: '#4fd8d0', lit: '#b6fff6',
  },
  solar: {
    name: 'Solar Panel', short: 'SOLAR',
    desc: 'A little steady power with no fuel at all. Weak on its own; a field of them runs an '
      + 'early line with no ore going up a chimney.',
    price: 1000, cycle: 0, cap: 0, hold: 0, travel: 0, draw: 0, passive: true,   // free power is dear
    body: '#1a2440', trim: '#5a8fe0', lit: '#bfe0ff',
  },
  wall: {
    name: 'Wall', short: 'WALL',
    desc: 'A block of plated stone. Nothing that crawls can walk through it: creatures go round '
      + 'if there is a way, and chew through it if there is not. Silent, needs no power, '
      + 'and joins up with the Walls beside it.',
    price: 100, cycle: 0, cap: 0, hold: 0, travel: 0, draw: 0, passive: true,
    body: '#5d6275', trim: '#a9b0c8', lit: '#ffcd75',
  },
  battery: {
    name: 'Battery', short: 'BATTERY',
    desc: 'Soaks up spare power on its grid and pays it back when the grid runs short — '
      + 'the way to keep Solar Panels working through the night. Carries power like any '
      + 'machine, and holds more at every level.',
    price: 1600, cycle: 0, cap: 0, hold: 0, travel: 0, draw: 0, passive: true,
    body: '#1f2c22', trim: '#7fd36a', lit: '#d4ff9a',
  },
  nswitch: {
    name: 'Night Switch', short: 'NIGHT SWITCH',
    desc: 'At nightfall it switches off every machine touching it, and every machine touching '
      + 'those, and switches them back on at dawn — so a factory can go quiet for the dark '
      + 'without a click. Defences, Batteries, Solar Panels, Pylons and Walls are left alone.',
    price: 600, cycle: 0, cap: 0, hold: 0, travel: 0, draw: 0, passive: true,
    body: '#1c1a34', trim: '#9a8cff', lit: '#ffe9a0',
  },
};

/* ---------------------------------------------------------------- day/night --- */

/**
 * The asteroid turns. One day is DAY_LEN seconds of game time: about seven minutes
 * of daylight and three of night, measured at half light, with an hour of dusk and
 * dawn (a minute each) fading between them. A game starts at the top of the morning.
 *
 * Night: Solar Panels go dark, the nests are bolder (they wake at NIGHT_SWARM noise
 * rather than SWARM_THRESHOLD, and Brutes come at NIGHT_BRUTE), and you can only
 * see NIGHT_FOG slots past your fence.
 */
export const DAY_LEN = 600;
const DUSK_AT = 390, DUSK_LEN = 60, DAWN_AT = 570, DAWN_LEN = 60;
const DAY_START = 30;         // t = 0 is the first moment of full daylight
export const NIGHT_SWARM = 3;
export const NIGHT_BRUTE = 9;
export const NIGHT_FOG = 1;

/** Daylight at time t, 0 (night) to 1 (full day). A game opens just after dawn. */
export function lightAt(t) {
  const p = ((((t + DAY_START) % DAY_LEN) + DAY_LEN) % DAY_LEN);
  if (p < DAWN_AT + DAWN_LEN - DAY_LEN) return 0.5 + 0.5 * (p / (DAWN_AT + DAWN_LEN - DAY_LEN));   // the end of dawn
  if (p < DUSK_AT) return 1;
  if (p < DUSK_AT + DUSK_LEN) return 1 - (p - DUSK_AT) / DUSK_LEN;
  if (p < DAWN_AT) return 0;
  return 0.5 * (p - DAWN_AT) / (DAY_LEN - DAWN_AT);                                                // the start of dawn
}
/** Does this world have day and night at all? (Story worlds 1 and 2 do not.) */
export const dayNightOn = f => !!f.dayNight;
export const lightOf = f => (dayNightOn(f) ? lightAt(f.t || 0) : 1);
export const isNight = f => lightOf(f) < 0.5;
/** Seconds until the light next crosses half: when night falls, or when day breaks. */
export function nextTurn(f) {
  const t = f.t || 0, night = isNight(f);
  for (let k = 1; k <= DAY_LEN; k++) if ((lightAt(t + k) < 0.5) !== night) return k;
  return DAY_LEN;
}
/** Which night this is (counting from 0), for things that act once a night. */
export const nightIndex = f => Math.floor(((f.t || 0) + DAY_START - (DUSK_AT + DUSK_LEN / 2)) / DAY_LEN);

/** The noise that wakes the nests, and the noise that brings Brutes, right now. */
export const swarmLine = f => (isNight(f)
  ? Math.min(SWARM_THRESHOLD, NIGHT_SWARM + 0.5 * Math.max(0, rankOf(f.done, 'nightshift') - 1))
  : SWARM_THRESHOLD);
export const bruteLine = f => (isNight(f) ? NIGHT_BRUTE : BRUTE_THRESHOLD);

/** Battery: kJ stored, kW in or out, and how far it carries power, by level. */
export const BATTERY_CAP = [3000, 5000, 8000, 12000, 18000];
export const BATTERY_RATE = [40, 60, 85, 115, 150];
export const BATTERY_REACH = [4, 5, 6, 7, 8];
export const batteryCap = (m, done = []) =>
  BATTERY_CAP[(m.level || 1) - 1] * (1 + 0.15 * Math.max(0, rankOf(done, 'batteries') - 1));
export const batteryRate = m => BATTERY_RATE[(m.level || 1) - 1];
/** What a Night Switch never switches off: defences, power storage, and stone. */
export const NIGHT_KEEP = new Set(['nswitch', 'battery', 'solar', 'pylon', 'wall', 'zap', 'arm', 'drone']);

// Defence machines (Armory, Zapper, Repair Drone Bay) are priced at ten times their
// first prices: holding the line is a real investment, not an afterthought.
export const KIND_LIST = Object.keys(KINDS);

/* --------------------------------------------------------------- footprints --- */

/**
 * Not every machine fits on one slot any more.
 *
 * Fusers and Mutators are **1x2**, two slots long
 * in the direction they face — gizmos go in at the back half and come out of the
 * front, like a short assembly line, and turning one swings it round its back slot.
 * Everything else is one slot.
 *
 * A machine is stored once, at its **anchor**: the back slot of a 1x2 (the top-left
 * slot of a 'big' 2x2, a size the code supports though no machine uses it now).
 * Every slot it covers points at the same machine in the grid, so
 * anything asking "what is on this slot" gets the right answer from any part of it.
 */
export const SIZE = { fuse: 'long', mut: 'long' };
export const sizeKind = kind => SIZE[kind] || 'one';

/** The slots a machine of this kind covers, anchored at `at` and facing `dir`, or null if it hangs off the world. */
export function footprint(kind, at, dir = 0) {
  const x = cx(at), y = cy(at);
  const sz = SIZE[kind];
  let cells;
  if (sz === 'big') cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
  else if (sz === 'long') cells = [[x, y], [x + DIRS[dir | 0][0], y + DIRS[dir | 0][1]]];
  else cells = [[x, y]];
  if (cells.some(([a, b]) => !inWorld(a, b))) return null;
  return cells.map(([a, b]) => cellOf(a, b));
}

/** The slot a machine's output leaves from: the front of a 1x2, otherwise its anchor. */
export function frontOf(kind, at, dir = 0) {
  if (SIZE[kind] !== 'long') return at;
  const x = cx(at) + DIRS[dir | 0][0], y = cy(at) + DIRS[dir | 0][1];
  return inWorld(x, y) ? cellOf(x, y) : at;
}

/** The middle of a machine, in world coordinates. */
export function centreOf(m, at) {
  const sz = SIZE[m.kind];
  if (sz === 'big') return [cx(at) + 1, cy(at) + 1];
  if (sz === 'long') return [cx(at) + 0.5 + DIRS[m.dir | 0][0] * 0.5, cy(at) + 0.5 + DIRS[m.dir | 0][1] * 0.5];
  return [cx(at) + 0.5, cy(at) + 0.5];
}

/** Machines with a mouth and no job: something else happens to what lands in them. */
export const PASSIVE = new Set(KIND_LIST.filter(k => KINDS[k].passive));

/**
 * Plumbing: the machines whose whole job is to move things somewhere else.
 *
 * They are exempt from the STARVED badge, and from the count of starved machines,
 * because an empty conveyor is not a fault — it is what most of a factory's belts
 * look like most of the time. Badging them put four blue corner ticks on every
 * tile of every quiet run, which broke up exactly the continuous line the belt art
 * works to draw, and said nothing: if a belt is empty, the thing worth looking at
 * is the machine behind it, and that machine has a badge of its own.
 */
export const PLUMBING = new Set(['pipe', 'store', 'bal', 'sort', 'over']);

/* ---------------------------------------------------------------- mites --- */

/**
 * Mites, and what stops them.
 *
 * Nests sit out on the wild ground beyond your fence, more of them near the Sap.
 * They are woken by **noise**: every Extractor digging, every Generator burning and
 * every heavy machine working adds to a pressure gauge, and when it fills a swarm
 * sets out for the nearest thing you have built. A quiet factory is left alone for
 * a long time; a loud one is visited often, by more of them.
 *
 * Mites chew. A conveyor is long, cheap and out on the edges, so it is what they go
 * for first. A chewed machine runs slower the more damaged it is and stops entirely
 * at zero, until you pay to repair it. Nothing is ever destroyed — the custody rule
 * holds — so a broken belt simply holds what it was carrying until it is mended.
 *
 * The answer is the **Zapper**, which needs two things from the factory it guards:
 * power to recharge, and Ammo, which an **Armory** presses out of Scrap and Copper.
 * Defending an outpost is therefore a logistics problem like everything else here.
 */

/** Noise each kind makes while it is working (and not switched off or broken). */
/**
 * Noise, by kind. Every machine makes some: belts barely any, heavy machinery a lot.
 * A machine that is working makes its full noise, one standing idle 40% of it
 * (machines with no job of their own — Depots, Labs, power — always count fully),
 * and every level past the first adds half again: a level 5 machine is 3x as loud.
 */
export const NOISE = {
  pipe: 0.03, store: 0.05, bridge: 0.05, bal: 0.06, sort: 0.06, over: 0.06, pylon: 0.05, solar: 0.02,
  depot: 0.15, lab: 0.15, zap: 0.2, drone: 0.3, wall: 0, battery: 0.02, nswitch: 0,
  ext: 1, gen: 1.4, drill: 1.2,
  mut: 0.3, fuse: 0.4, asm: 0.6, arm: 0.4, recyc: 0.5, dup: 0.5, trident: 0.5,
};
export const NOISE_IDLE = 0.4;
export const noiseLevelMult = level => 1 + 0.5 * ((level || 1) - 1);
/**
 * Below this much noise the nests settle: no swarm builds, and any Mites and
 * Skitters out on the map go home. At or above it, swarms build as the noise does.
 */
export const SWARM_THRESHOLD = 5;

/** Noise-seconds that fill the gauge and send one swarm. */
export const SWARM_COST = 1100;

/** No swarm leaves a nest before this many seconds of factory time. */
export const SWARM_GRACE = 420;

/** The most mites alive on the map at once. */
export const MITE_CAP = 140;

/** A mite, at the first swarm. Later swarms are a little tougher. */
export const MITE = { hp: 12, speed: 0.8, bite: 1.5, hpPerWave: 0, hpMax: 12 };

/**
 * Skitters: the second creature. Long, thin and fast, and they eat belts and
 * nothing else — a Skitter walks straight past a Generator to get at the conveyor
 * behind it. They bite much harder than a Mite and run twice as fast, but one shot
 * from anything kills one. They come out of their own nests, and from the fifth
 * swarm onward a growing share of every swarm is Skitters.
 */
export const SKITTER = { hp: 1, speed: 1.8, bite: 4 };

/** The two kinds of creature, by the name stored on each one. */
/**
 * Beetles: the third creature, and the slow one. A bronze shell that takes ten plain
 * shots or five charged ones from a level 1 Zapper, a crawl at less than half a
 * Mite's pace, and a bite that goes through a Generator in seconds. They do not
 * come from nests. They burrow out of mountains — and what wakes them is drilling.
 * Every Mountain Drill at work adds to a tremor, and when it builds up, a Beetle
 * digs its way out of a mountain being drilled and makes for your power.
 */
export const BEETLE = { hp: 60, speed: 0.35, bite: 6 };
/** Drill-seconds of tremor that wake one Beetle. */
export const TREMOR_COST = 200;

/**
 * Brute Mites: the fourth creature, and the reason not to let a factory get too
 * loud. A big armoured Mite with five times the health, a slow walk and a bite
 * that wrecks machines, and it goes for your most valuable machines rather than
 * the nearest belt. They only come once the factory's noise reaches
 * BRUTE_THRESHOLD, mixed into ordinary Mite swarms — a larger share the louder
 * you are.
 */
export const BRUTE = { hp: 60, speed: 0.5, bite: 5 };
export const BRUTE_THRESHOLD = 12;
/** What share of a Mite swarm are Brutes, at this much noise. */
export const bruteShare = (noise, line = BRUTE_THRESHOLD) =>
  noise < line ? 0 : Math.min(0.6, 0.15 + (noise - line) * 0.025);

export const CREATURES = { mite: MITE, skitter: SKITTER, beetle: BEETLE, brute: BRUTE };

/** From which swarm (counting from 0) Skitters start joining in, and how many. */
export const SKITTER_FROM = 4;
export const skitterShare = waves =>
  waves < SKITTER_FROM ? 0 : Math.min(0.5, 0.15 + (waves - SKITTER_FROM) * 0.05);

/** How big a swarm is, given how loud the factory is and how many have come before. */
export const swarmSize = (noise, waves) =>
  Math.min(24, 2 + Math.floor(Math.sqrt(Math.max(0, noise)) * 0.8 + waves * 0.25));

/**
 * A nest. Out of reach of everything but a Zapper parked close to the fence, and
 * a siege rather than a skirmish: it takes thousands of shots, and it fights back.
 * Every NEST_ANGER points of damage it takes, a brood of NEST_BROOD mites boils out
 * and goes straight for the Zapper that is shooting at it — and a Zapper always
 * shoots mites before nests, so it has to deal with them before it can carry on.
 * Clearing one is a project worth a lot of Ammo, and it pays like one.
 */
export const NEST_HP = 12000;
export const NEST_BOUNTY = 2000;

/** The two kinds of nest. A Skitter nest is half as hard again, and pays five times. */
export const NESTS = {
  mite: { hp: NEST_HP, bounty: NEST_BOUNTY, name: 'Mite nest' },
  skitter: { hp: 18000, bounty: 10000, name: 'Skitter nest' },
};
export const nestSpec = n => NESTS[n?.kind] || NESTS.mite;
export const NEST_ANGER = 90;
export const NEST_BROOD = 3;

/**
 * A nest gets more desperate the closer it is to dying. At full health a brood is
 * NEST_BROOD mites every NEST_ANGER damage; as its health runs down the broods get
 * bigger and come more often, until at the very end it is NEST_BROOD_MAX mites every
 * NEST_ANGER_MIN damage. The last tenth of a nest is the hardest part of the siege.
 */
export const NEST_BROOD_MAX = 9;
export const NEST_ANGER_MIN = 25;

/** How hurt a nest is, 0 (untouched) to 1 (about to die). */
const rageOf = n => 1 - Math.max(0, Math.min(1, n.hp / nestSpec(n).hp));

/** Damage it takes before the next brood comes out. */
export const nestAnger = n => Math.round(NEST_ANGER - (NEST_ANGER - NEST_ANGER_MIN) * rageOf(n));

/** How many mites are in that brood. */
export const nestBrood = n => Math.round(NEST_BROOD + (NEST_BROOD_MAX - NEST_BROOD) * rageOf(n));
/**
 * New nests. Every world has a nest limit — however many nests it started with —
 * and whenever there are fewer than that, a new one digs in somewhere out in the
 * wilds after a random wait between these two numbers of seconds. Clearing the
 * nests near you buys a quiet spell, never a permanent one.
 */
export const NEST_POP_MIN = 60;
export const NEST_POP_MAX = 240;

/** Hit points, by kind. Belts are flimsy on purpose: they are what mites eat first. */
export const MAX_HP = {
  pipe: 12, store: 20, bal: 15, sort: 15, ext: 30, gen: 40, depot: 50, lab: 40,
  dup: 30, trident: 30, mut: 30, asm: 35, fuse: 30, arm: 30, zap: 45, drill: 40, bridge: 25,
  over: 15, recyc: 30, pylon: 25, drone: 35, solar: 20, wall: 120, battery: 30, nswitch: 20,
};

/** A Wall's hit points grow with its level, and with each rank of Walls research. */
export const WALL_LEVEL_HP = [1, 1.5, 2, 2.75, 3.5];
/** How many extra slots a creature will walk round rather than chew one Wall. */
export const WALL_DETOUR = 24;

/** What Plating research multiplies every machine's hit points by. */
export const PLATING_BONUS = 1.5;

export const maxHp = (m, done = []) =>
  (MAX_HP[m.kind] || 30) * grow(done, 'hp', PLATING_BONUS)
  * (m.kind === 'wall' ? WALL_LEVEL_HP[(m.level || 1) - 1] * (1 + 0.25 * Math.max(0, rankOf(done, 'walls') - 1)) : 1);

/** Is this machine chewed through? It does nothing until it is repaired. */
export const broken = m => m.hp != null && m.hp <= 0;

/**
 * What damage does to a machine's speed. Half speed just before it breaks, which
 * is enough to notice and not so much that one mite on a belt is a catastrophe.
 */
export function hpMult(m, done = []) {
  if (m.hp == null) return 1;
  if (m.hp <= 0) return 0;
  return 0.5 + 0.5 * Math.min(1, m.hp / maxHp(m, done));
}

/** Repairing costs a fraction of the machine's price, in proportion to the damage. */
export const REPAIR_RATE = 0.2;   // halved: a chewed line should be cheap to put right

export function repairCost(m, done = []) {
  const max = maxHp(m, done);
  const hp = m.hp == null ? max : m.hp;
  if (hp >= max) return 0;
  return Math.max(1, Math.round(price(m) * REPAIR_RATE * (1 - hp / max)));
}

/** Shots one Ammo loads into a Zapper. */
export const AMMO_CHARGES = 6;

/** Zapper reach in slots, damage per shot and seconds between shots, by level. */
export const ZAP_RANGE = [4.5, 5.5, 6.5, 7.5, 8.5];
export const ZAP_DAMAGE = [6, 8, 11, 15, 20];
export const ZAP_COOL = [0.9, 0.75, 0.6, 0.5, 0.42];
/** Extra reach from Focusing research, and how many extra mites Arc research chains to. */
export const FOCUS_RANGE = 1.5;
export const ARC_CHAIN = 2;
export const ARC_HOP = 2;

/**
 * Research has ranks. `done` holds a node's id once per rank researched, so the
 * rank of a node is how many times it appears, and `includes` still answers "has
 * it been researched at all".
 */
export const rankOf = (done = [], id) => { let n = 0; for (const d of done) if (d === id) n++; return n; };
/** The rank of whichever node carries this bonus flag. */
export const flagRank = (done = [], flag) => {
  const t = TECH.find(x => x[flag]);
  return t ? rankOf(done, t.id) : 0;
};
export const hasTech = (done = [], flag) => flagRank(done, flag) > 0;
/**
 * How a bonus grows with rank: rank I gives the bonus on the card, and each rank
 * after adds half as much again, so rank V is three times rank I.
 */
export const rankScale = r => (r > 0 ? 1 + 0.5 * (r - 1) : 0);
/** A multiplier of `b` at rank I, grown by rank. */
const grow = (done, flag, b) => 1 + (b - 1) * rankScale(flagRank(done, flag));
/** A reduction to `b` at rank I, compounded by rank. */
const shrink = (done, flag, b) => { const r = flagRank(done, flag); return r ? Math.pow(b, rankScale(r)) : 1; };
/** An addition of `a` at rank I, grown by rank. */
const add = (done, flag, a) => a * rankScale(flagRank(done, flag));

/**
 * The machines a node unlocks get faster with every rank past the first: 10% a rank.
 * Surveying, which unlocks nothing, speeds Mountain Drills instead.
 */
export function unlockSpeed(kind, done = [], mut = 0) {
  const key = unlockKey({ kind, mut });
  const t = TECH.find(x => (x.unlocks || []).includes(key));
  const r = t ? rankOf(done, t.id) : 0;
  let s = r > 1 ? 1 + 0.1 * (r - 1) : 1;
  // Surveying's ranks speed Mountain Drills too, on top of Deep Mining's.
  if (kind === 'drill') { const v = flagRank(done, 'survey'); if (v > 1) s *= 1 + 0.1 * (v - 1); }
  return s;
}
export const zapRange = (m, done = []) =>
  ZAP_RANGE[(m.level || 1) - 1] + add(done, 'focus', FOCUS_RANGE);
export const zapDamage = (m, done = []) =>
  ZAP_DAMAGE[(m.level || 1) - 1] * grow(done, 'over', TECH_BONUS.over);
export const zapCool = (m, done = []) =>
  ZAP_COOL[(m.level || 1) - 1] * shrink(done, 'cap', TECH_BONUS.cap) / unlockSpeed('zap', done);

/** Research-adjusted numbers used by sim.js, bugs.js and beacon.js. */
export const bridgeSpan = (done = []) => {
  const r = flagRank(done, 'span');
  return BRIDGE_SPAN + (r ? TECH_BONUS.span + (r - 1) : 0);     // +3, then +1 a rank
};
export const tremorCost = (done = []) => TREMOR_COST * grow(done, 'damper', TECH_BONUS.damper);
export const beaconLoss = (done = []) => BEACON_LOSS * grow(done, 'shield', TECH_BONUS.shield);
export const contractPremium = (done = []) => (hasTech(done, 'market')
  ? 1 + (TECH_BONUS.market - 1) * rankScale(flagRank(done, 'market')) : CONTRACT_PREMIUM);
export const surveyed = (done = []) => hasTech(done, 'survey');
export const zapChain = (done = []) => { const r = flagRank(done, 'arc'); return r ? ARC_CHAIN + (r - 1) : 0; };

/** The Armory's one recipe. */
export const ARMORY = { ins: [0, 1], out: AMMO, cycle: 1.0, price: 150 };

/**
 * How long an Armory waits on a lopsided feed before it sorts itself out.
 *
 * One Scrap and one Copper is the recipe, but a feed is never that tidy — a merged
 * belt delivers runs of one and then the other, and a Balancer that skips a busy
 * arm sends a run of Scrap down the straight. An Assembler would wait for the half
 * it is short of. An Armory is a press, not a jeweller: after a moment short of one
 * ingredient it makes do with the other. Three Scrap do the job of a Scrap and a
 * Copper (two of them are fused on the die), and two Copper do it too (one is
 * ground down). It wastes a little metal and it never stops.
 */
export const ARM_RESOLVE = 1.0;

/** The two-input machines whose queues can be emptied by hand. */
export const CLEARABLE = new Set(['asm', 'arm', 'fuse']);

/** The recipe a two-input machine is building, or null for everything else. */
export const twoInput = m =>
  (m?.kind === 'asm' ? recipeOf(m) : m?.kind === 'arm' ? ARMORY : null);

/** Machines you may only own so many of cheaply — each costs more than the last. */
export const LADDERED = {
  ext: 1.22, depot: 3, lab: 3, gen: 1.2, solar: 1.2, wall: 1.1, battery: 1.2,
  // Advanced machinery: a steep first price, and each one after costs 1.2x more.
  asm: 1.2, dup: 1.2, trident: 1.2, fuse: 1.2, drill: 1.2, bridge: 1.2, recyc: 1.2, store: 1.2,
};

/** Mutators are priced by the tier they output. */
/**
 * Mutator prices climb exponentially with the rung they make: each one costs
 * MUT_STEP times the one below it. A Copper Mutator is an early purchase; a Prism
 * Mutator skips six Fuser steps and is priced like a late-game prize.
 */
export const MUT_BASE = 550;
export const MUT_STEP = 2.2;
export const MUT_PRICE = [0, 1, 2, 3, 4, 5, 6, 7].map(t => (t ? Math.round(MUT_BASE * Math.pow(MUT_STEP, t - 1)) : 0));

/**
 * Mutator speed halves each tier while gizmo value roughly doubles, so every
 * mutator earns about the same per slot. Tier is a choice about feedstock, not a
 * straight upgrade you buy your way past.
 */
export const MUT_CYCLE = [0, 0.84, 1.72, 3.52, 7.2, 14.8, 30.4, 62];

/** Assembler recipes. `mut` on an Assembler is the index into this list. */
export const RECIPES = [
  { ins: [9, 2], out: 11, cycle: 2.4, price: 3000 },    // Cord  + Amber  -> Engine
  { ins: [10, 4], out: 12, cycle: 3.6, price: 12000 },   // Frame + Cobalt -> Turbine
  { ins: [10, 6], out: 13, cycle: 4.8, price: 40000 },   // Frame + Ember  -> Reactor
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
    off: spec.off ? 1 : 0,  // switched off by hand: does nothing, draws nothing
    link: 0,    // belts only: which of the four edges join a neighbour (sim.relink)
    blocked: 0, // holding finished goods with nowhere to put them
    waiting: 0, // has some of what it needs, but not all of it
    blockT: 0,  // seconds it has been blocked, so a hiccup does not raise a badge
    waitT: 0,   // seconds it has been waiting, likewise
    flip: 0,    // round-robin cursor, used when routing
    flash: 0,   // render-only pulse, set when it lets go
    sat: 0,     // how satisfied its power grid is, 0..1 (power.js writes this)
    net: -1,    // which power grid it belongs to, -1 for none (power.js writes this)
    fuel: 0,    // generators only: kilowatt-seconds left in whatever is burning
    load: 0,    // generators only: kilowatts it is actually delivering
    rich: spec.rich || 1,   // extractors only: the richness of the patch underneath
    hp: spec.hp ?? (MAX_HP[spec.kind] || 30),   // mites chew this down; 0 is broken
    charge: 0,  // zappers only: plain shots loaded
    hot: 0,     // zappers only: Charged Ammo shots loaded, fired first
    cool: 0,    // zappers only: seconds until the next shot is ready
    kills: 0,   // zappers only: lifetime mites zapped
  };
}

export function price(spec) {
  if (spec.kind === 'mut') return MUT_PRICE[spec.mut ?? 1];
  if (spec.kind === 'asm') return (RECIPES[spec.mut ?? 0] || RECIPES[0]).price;
  return KINDS[spec.kind].price;
}

/**
 * What one costs to buy right now. Extractors, Depots, Labs, Generators and Solar
 * Panels climb a ladder in the number you already own: they make money, science,
 * raw material and power out of nothing but a slot, so owning the twentieth has to
 * be a decision (Generators and Solar Panels: 1.2x each). Advanced machinery — Assemblers,
 * Duplicators, Tridents, Fusers, Drills, Bridges, Recyclers, Storage — climbs 1.2x too. Everything else is a stable price you can plan around, in minute one
 * and in hour three alike — growth in GIZMO 3 already costs more the further you
 * go, because land does, and inflation on top of that only taxes a plan you made
 * an hour ago and are finally able to pay for.
 */
/**
 * Every machine's price is its listed price times this. Halved to take the grind
 * out of the opening: the first rock should be about building, not about waiting.
 */
export const PRICE_SCALE = 0.5;

export function buyCost(spec, owned = 0) {
  // With no Market Depot standing, the next one is free — the first of every game,
  // and any time after. A factory that has spent itself to nothing can always
  // still sell, so it can never be locked out.
  if (spec.kind === 'depot' && owned === 0) return 0;
  const step = LADDERED[spec.kind];
  const base = price(spec) * PRICE_SCALE;
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
  if (spec.kind === 'arm') return 'Armory';
  if (spec.kind === 'drill') return 'Mountain Drill';
  const t = TYPED[spec.kind];
  return t ? `${TYPES[spec.mut ?? 1].name} ${t}` : KINDS[spec.kind].name;
}

/** Which way a router's branch points, in words, for the inspector. */
export const sideName = m => (m.mir ? 'left' : 'right');

export function describe(spec) {
  if (spec.kind === 'asm') return `${recipeText(recipeOf(spec))}. Both ingredients, every time.`;
  if (spec.kind === 'arm') return `${recipeText(ARMORY)}. ` + KINDS.arm.desc;
  if (spec.kind === 'mut') return `Rewrites any gizmo into ${TYPES[spec.mut ?? 1].name}.`;
  if (spec.kind === 'sort') {
    return `${TYPES[spec.mut ?? 1].name} goes ${sideName(spec)}; everything else straight ahead.`;
  }
  if (spec.kind === 'bal') {
    return `Alternates between straight ahead and ${sideName(spec)}. Never copies.`;
  }
  if (spec.kind === 'over') {
    return `Everything goes straight ahead; only when ahead is backed up does the extra spill ${sideName(spec)}.`;
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
 * Two things multiply here, and separating them is what makes the curve behave.
 * A ring bought on a claim of side `c` hands you `4c + 4` new slots, so what you
 * get for your money grows on its own as the plot does — sixteen slots at the
 * start, two hundred and twenty-four at the rim. On top of that sits a per-ring
 * markup, which is what turns "more land" from a formality into a decision.
 *
 * The result is cheap early and steep late, deliberately. The first ring costs
 * about half a minute of a powered opening line, and the first three together
 * cost less than a Generator — because a nine-slot claim is a puzzle to escape,
 * not a wall to be held behind. By the outer third a ring is tens of thousands,
 * which against a mature factory's income is a real commitment and against an
 * immature one is out of reach.
 */
export const EXPAND_PER_SLOT = 0.75;   // halved with machine prices
export const EXPAND_STEP = 1.13;

export function expandCost(claim) {
  const rings = Math.max(0, (claim - CLAIM_START) / CLAIM_STEP);
  const gained = 4 * claim + 4;               // slots this ring actually adds
  return Math.round(EXPAND_PER_SLOT * gained * Math.pow(EXPAND_STEP, rings));
}

/** Clearing one rubble slot. Flat: it is a chore, not an investment. */
export const RUBBLE_COST = 50;

export function upgradeCost(m, done = []) {
  // Overclocking past rank III makes every upgrade 15% cheaper a rank.
  const disc = Math.pow(0.85, Math.max(0, flagRank(done, 'level') - 3));
  return Math.round(price(m) * PRICE_SCALE * Math.pow(UP_STEP, (m.level || 1) - 1) * disc);
}

/** Everything this machine has cost so far: the purchase plus every level bought. */
export function investedIn(m) {
  // A machine that was given away free is worth nothing at the scrapyard but its upgrades.
  let paid = m.free ? 0 : price(m) * PRICE_SCALE;
  for (let l = 1; l < (m.level || 1); l++) paid += upgradeCost({ ...m, level: l });
  return paid;
}

export function scrapValue(m) {
  const v = Math.round(investedIn(m) * SCRAP_RATE);
  return m.free ? v : Math.max(2, v);
}

/** What a level buys, for every machine that sells speed. */
export const LEVEL_SPEED = [1, 0.7, 0.45, 0.32, 0.24];

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
  else if (m.kind === 'arm') base = ARMORY.cycle;
  else if (m.kind === 'drill') {
    base = DRILL_BASE * (1 + DRILL_PER_TIER * (TYPES[m.mut]?.tier || 0)) / grow(done, 'drill', TECH_BONUS.drill);
  }
  else if (m.kind === 'ext') base = KINDS.ext.cycle / Math.max(0.2, m.rich || 1) / yieldBonus(done);
  else base = KINDS[m.kind].cycle;
  base /= unlockSpeed(m.kind, done, m.mut);
  // Storage levels buy capacity, not speed. A copier's first three levels buy exits;
  // its fourth and fifth, which have no more exits to give, buy speed.
  if (m.kind === 'store') return base;
  if (m.kind === 'dup' || m.kind === 'trident') return base * [1, 1, 1, 0.75, 0.55][(m.level || 1) - 1];
  return base * (LEVEL_SPEED[(m.level || 1) - 1] ?? 1);
}

/** Kilowatts this machine asks for while it is working. */
export function drawOf(m, done = []) {
  const base = KINDS[m.kind]?.draw || 0;
  return base * (LEVEL_DRAW[(m.level || 1) - 1] ?? 1) * shrink(done, 'motor', TECH_BONUS.motor);
}

export function travelTime(m, done = []) {
  const belt = m.kind === 'pipe' || m.kind === 'store' || m.kind === 'bridge';
  return KINDS[m.kind].travel * (m.kind === 'pipe' ? Math.pow(0.78, (m.level || 1) - 1) : 1)
    * (belt ? shrink(done, 'belt', TECH_BONUS.belt) : 1) / (belt ? unlockSpeed(m.kind, done) : 1);
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
  // A Sorter keeps two queues, one per way out, so a full one never blocks the other.
  if (m.kind === 'sort') return base * 2;
  return base;
}

/** Room on a bare slot. Gizmos rest here; they are never destroyed. */
export const EMPTY_HOLD = 2;

/**
 * How many machines the crate holds.
 *
 * The crate is what makes building over the top of something safe. Dropping a
 * Mutator onto a slot that already has a conveyor on it does not destroy the
 * conveyor and does not charge you half of it back — it puts it in the crate,
 * where it is still yours and still free to put down again. That turns
 * rearranging a factory from a sequence of scrap-and-rebuy transactions into
 * simply moving things, which is what rearranging a factory should be.
 *
 * Forty is far more than a session will ever displace at once, because the common
 * case — laying a belt across a belt — replaces in place and never touches it.
 */
export const CRATE_CAP = 200;

/**
 * How many of one ingredient a two-input machine will queue up.
 *
 * This is the number that decides whether one belt carrying two things can feed
 * one Assembler. It used to be, in effect, one: the machine held a single shared
 * queue of three units and refused anything it was not immediately short of, so a
 * belt that happened to deliver two Cords in a row stopped dead — the Amber behind
 * them could never arrive, and the whole line behind that stopped with it, forever.
 *
 * Separate queues, three deep each, mean the machine takes what it needs out of a
 * mixed stream and lets the queues absorb the ordering. A run of Cords fills the
 * Cord queue and the Ambers behind still get in. It only stalls if you are
 * genuinely not supplying one of the two, which is a thing you want to be told.
 */
export const LANE = 3;

/** How many different types a Fuser will keep queues for at once. */
export const FUSE_LANES = 2;

/**
 * How long a machine has to be stuck before it is worth drawing a badge on it.
 *
 * A line running at capacity blocks for a fraction of a second on nearly every
 * cycle — that is what running at capacity means — and badging those was turning
 * a healthy factory into a screen full of alarm. Anything that outlives a second
 * and a bit is a real stall.
 */
export const STALL_BADGE = 1.3;

/** How many of `ty` are queued at this machine's mouth. */
export const queued = (m, ty) => m.buf.reduce((n, g) => n + (g.ty === ty ? 1 : 0), 0);

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
    case 'bridge':
      return [{ ty: a, dir: d, cp: copy }];

    // An Extractor takes nothing in and makes one of whatever it is standing on.
    // `mut` is the ore type, written when it is placed.
    // A Mountain Drill faces the rock and unloads out of its back. `mut` is the
    // mineral in the mountain it faces, written when it starts each job.
    case 'drill':
      return [{ ty: m.mut >= 0 && m.mut <= 4 ? m.mut : 0, dir: (d + 2) % 4, cp: 0 }];

    case 'ext':
      // `mut` is the ore under it. A negative one would mean standing on bare
      // ground, which nothing should allow — but a gizmo with no type would take
      // the renderer down with it, so it is clamped here rather than trusted.
      return [{ ty: m.mut >= 0 ? m.mut : 0, dir: d, cp: 0 }];

    case 'dup': {
      if (copy) return [{ ty: a, dir: d, cp: 1 }];
      if (!copyable(a)) return [{ ty: a, dir: d, cp: 0 }];
      const n = 1 + Math.min(3, m.level || 1);           // L1: 2, L2: 3, L3+: 4
      return Array.from({ length: n }, (_, i) => ({ ty: a, dir: d, cp: i ? 1 : 0 }));
    }

    case 'bal':
      return [{ ty: a, dir: nextExit(m, balDirs(m)), cp: copy }];

    // An Overflow Splitter always aims ahead; release() spills it to the side only
    // when ahead cannot take it.
    case 'over':
      return [{ ty: a, dir: d, cp: copy }];

    // A Recycler turns anything at all into one raw unit: Sap goods (Resin, Cord,
    // Frame) back into Resin, everything else into Scrap. Always an original: what
    // goes in is gone, whatever it was.
    case 'recyc':
      return [{ ty: recycleTo(a), dir: d, cp: 0 }];

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
      // `pickInputs` only ever hands a Fuser a matching pair, so there is no
      // longer a question of which of two different rungs it climbs from. Two of
      // a thing make one of the thing above it, which is what the card always
      // said and what everybody assumed it did.
      const cp = (inputs[0]?.cp || inputs[1]?.cp) ? 1 : 0;
      return [{ ty: upFam(a), dir: d, cp }];
    }

    case 'asm':
    case 'arm': {
      const r = twoInput(m);
      const cp = inputs.length && inputs.every(g => g?.cp) ? 1 : 0;
      return [{ ty: r.out, dir: d, cp }];
    }

    default:
      return [];   // depot, lab, gen and zap never emit anything
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
/**
 * Will this machine take anything at all through this side of itself?
 *
 * Most machines have four open faces and it never comes up. A **Depot** and a
 * **Lab** have one mouth, on the side `dir` points at, and are solid on the other
 * three — so a depot is a place a line *ends*, not a wall that four lines can be
 * shovelled into from every angle. Wanting to sell two products means two depots,
 * or a Balancer merging the arms before they get there, which is a routing problem
 * where there used to be none.
 *
 * `side` is the face of `m` the gizmo arrives at: something travelling east enters
 * its target through that target's west face.
 */
export function acceptsFrom(m, side) {
  if (!m) return false;
  if (m.kind === 'ext' || m.kind === 'drill') return false;   // no mouth at all
  if (m.kind === 'pylon' || m.kind === 'solar' || m.kind === 'battery' || m.kind === 'nswitch') return false; // power only
  if (m.kind === 'wall') return false;                        // solid
  if (m.kind === 'depot' || m.kind === 'lab') return side === (m.dir | 0);
  return true;
}

/** Which face of a machine a gizmo travelling in direction `d` arrives at. */
export const faceHit = d => ((d | 0) + 2) % 4;

export function wants(m, ty, side = null) {
  if (!m) return true;
  // A machine that has been switched off turns everything away, which is the
  // point of switching it off: the line behind it backs up and stops, on purpose.
  if (m.off) return false;
  // A machine the mites have chewed through takes nothing until it is repaired.
  if (broken(m)) return false;
  if (side != null && !acceptsFrom(m, side)) return false;
  if (m.kind === 'ext' || m.kind === 'drill') return false;
  if (m.kind === 'depot' || m.kind === 'lab' || m.kind === 'gen') return true;
  if (m.kind === 'zap') return isAmmo(ty);
  if (m.kind === 'drone') return ty === DRONE_FUEL;
  // An Armory has no per-ingredient limit: it takes Scrap and Copper for as long as
  // it has room, so a run of one can never stand in front of the other on a belt.
  if (m.kind === 'arm') return twoInput(m).ins.includes(ty);
  if (m.kind === 'asm') {
    if (!twoInput(m).ins.includes(ty)) return false;
    return queued(m, ty) < LANE;
  }
  if (m.kind === 'sort') {
    // Two lanes — what it is filtering for, and everything else — each as deep as
    // the Sorter's hold. One lane being full turns away only what would join it.
    const match = t => t === (m.mut ?? 1);
    let n = 0;
    for (const g of m.buf) if (match(g.ty) === match(ty)) n++;
    for (const g of m.work || []) if (match(g.ty) === match(ty)) n++;
    return n < (KINDS.sort.hold ?? 1);
  }
  if (m.kind === 'fuse') {
    if (!fusable(ty)) return false;               // products, and the top of a ladder, are terminal
    const have = queued(m, ty);
    if (have) return have < LANE;
    // A new type only gets a queue if there is one going spare.
    const kinds = new Set(m.buf.map(g => g.ty));
    return kinds.size < FUSE_LANES;
  }
  return true;
}

/**
 * Could this machine *ever* take one of these, with an empty mouth and all the
 * time in the world?
 *
 * Distinct from `wants`, and the difference is the difference between a queue and
 * a fault. A machine that is merely full will drain and take the next one; a
 * machine being fed something it can never use is a line that has stopped forever,
 * and the game says so out loud instead of leaving you to work out which of two
 * hundred amber badges is the one that matters.
 */
export function canEverAccept(m, ty, side = null) {
  if (!m) return true;
  if (side != null && !acceptsFrom(m, side)) return false;
  if (m.kind === 'ext' || m.kind === 'drill') return false;
  if (m.kind === 'zap') return isAmmo(ty);
  if (m.kind === 'drone') return ty === DRONE_FUEL;
  if (m.kind === 'pylon' || m.kind === 'solar' || m.kind === 'wall' || m.kind === 'battery' || m.kind === 'nswitch') return false;
  if (m.kind === 'asm' || m.kind === 'arm') return twoInput(m).ins.includes(ty);
  if (m.kind === 'fuse') return fusable(ty);
  return true;
}

/**
 * Can a Fuser do anything with two of these? Alloys and Parts climb their ladders;
 * Ammo fuses into Charged Ammo; Products, and Charged Ammo itself, go no further.
 */
export function fusable(ty) {
  const fam = famOf(ty);
  if (fam === PRODUCT) return false;
  if (fam === MUNITION) return tierOf(ty) < FAM_LEN[MUNITION] - 1;
  return true;
}

/** Machines whose one mouth is on a side you can turn. */
export const ONE_MOUTH = new Set(['depot', 'lab']);

/**
 * Which queued gizmos this machine would take for its next job, as indices into
 * its mouth — or null if it cannot start one yet.
 *
 * Two-input machines no longer simply take the first two things in the queue,
 * because with separate lanes the first two things are quite often two of the
 * same ingredient. An Assembler picks one of each; a Fuser picks the first pair
 * that match.
 */
export function pickInputs(m) {
  const need = intake(m);
  if (!need) return [];

  if (m.kind === 'asm' || m.kind === 'arm') {
    const want = twoInput(m).ins.slice();
    const take = [];
    for (let i = 0; i < m.buf.length && want.length; i++) {
      const k = want.indexOf(m.buf[i].ty);
      if (k < 0) continue;
      want.splice(k, 1);
      take.push(i);
    }
    if (!want.length) return take;
    // An Armory short of one ingredient makes do with the other, once it has
    // waited long enough to be sure the other is not coming.
    if (m.kind === 'arm' && (m.waitT || 0) >= ARM_RESOLVE) {
      const idx = ty => m.buf.map((g, i) => (g.ty === ty ? i : -1)).filter(i => i >= 0);
      const scrap = idx(ARMORY.ins[0]), copper = idx(ARMORY.ins[1]);
      if (scrap.length >= 3) return scrap.slice(0, 3);
      if (copper.length >= 2) return copper.slice(0, 2);
    }
    return null;
  }

  if (m.kind === 'fuse') {
    const first = new Map();
    for (let i = 0; i < m.buf.length; i++) {
      const at = first.get(m.buf[i].ty);
      if (at != null) return [at, i];
      first.set(m.buf[i].ty, i);
    }
    return null;
  }

  if (m.buf.length < need) return null;
  return Array.from({ length: need }, (_, i) => i);
}

/**
 * What this machine is short of, as gizmo types — the thing to put on a belt and
 * point at it. Empty when it is not waiting on anything in particular.
 */
export function missingFor(m) {
  if (!m) return [];
  if (m.kind === 'asm' || m.kind === 'arm') {
    const want = twoInput(m).ins.slice();
    for (const g of m.buf) {
      const k = want.indexOf(g.ty);
      if (k >= 0) want.splice(k, 1);
    }
    return want;
  }
  if (m.kind === 'fuse') {
    // It has one of something and wants a second of the same.
    const solo = [];
    const n = new Map();
    for (const g of m.buf) n.set(g.ty, (n.get(g.ty) || 0) + 1);
    for (const [ty, c] of n) if (c === 1) solo.push(ty);
    return solo;
  }
  return [];
}

/** Every direction a machine can fire into, in world space. */
export function exitDirs(m) {
  const d = m.dir | 0;
  switch (m.kind) {
    case 'depot': case 'lab': case 'gen': case 'zap':
    case 'pylon': case 'solar': case 'drone': case 'wall': case 'battery': case 'nswitch':
      return [];
    case 'over':
      return [d, sideDir(m)];
    case 'drill':
      return [(d + 2) % 4];
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
/**
 * Fog of war: you can see your own land and FOG slots beyond it in every
 * direction, and nothing further. Buying land pushes the fog back.
 */
export const FOG = 3;
/** How far past the fence you can see right now: FOG by day, NIGHT_FOG at night. */
export const fogOf = f => (f && isNight(f) ? NIGHT_FOG : FOG);
export const seenXY = (f, x, y) => {
  const fg = fogOf(f);
  const lo = claimMin(f.claim) - fg, hi = claimMax(f.claim) + fg;
  return x >= lo && x <= hi && y >= lo && y <= hi;
};
export const seen = (f, i) => seenXY(f, cx(i), cy(i));

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
export const OPEN = 0, RUBBLE = 1, BEDROCK = 2, MOUNTAIN = 3, VALLEY = 4, BEACON = 5, SPACE = 6;

/* ----------------------------------------------------------------- beacon --- */

/**
 * The Launch Beacon: the end of the game.
 *
 * A five-by-five tower standing in one corner of the world, chosen by the seed.
 * It has four mouths, one in the middle of each side, and each takes one thing:
 * Engines from the north, Turbines from the east, Reactors from the south and Prisms
 * from the west. Fill all four and it fires, and the world is won.
 *
 * It is a long way out — the corner of the map — and you have to own the land
 * right up to it to run a belt into it. Feeding it is loud, and every creature on
 * the map takes notice: while it is being fed, swarms come for *it*, and a quarter,
 * a half and three quarters of the way, a huge mixed assault comes from every side.
 * Damage to it is not just damage. Every few points of it knock delivered goods
 * back out of the machine, so a Beacon left undefended goes backwards.
 */
export const BEACON_SIZE = 5;
/** What each mouth takes, by the direction it faces. dir 0 east, 1 south, 2 west, 3 north. */
export const BEACON_INPUTS = { 3: 11, 0: 12, 1: 13, 2: 7 };    // Engine, Turbine, Reactor, Prism
/** And how many of each it needs. */
export const BEACON_NEED = { 11: 500, 12: 250, 13: 100, 7: 200 };
export const BEACON_HP = 1000;
/** Every this many points of damage costs one delivered gizmo. */
export const BEACON_LOSS = 4;
/** Dollars per hit point to repair it. */
export const BEACON_REPAIR = 1.5;
/** How long after its last delivery it still counts as being fed. */
export const BEACON_FED = 90;
/** The extra noise a Beacon makes while it is being fed. */
export const BEACON_NOISE = 10;
/** Share of a swarm that goes for the Beacon while it is being fed. */
export const BEACON_DRAW = 0.6;
/** Progress at which an assault comes, and how big it is. */
export const BEACON_ASSAULTS = [0.25, 0.5, 0.75];
export const BEACON_ASSAULT_SIZE = 40;
export const BEACON_ASSAULT_BEETLES = 4;

/** What a mountain's seam can be: Scrap at the middle of the map up to Cobalt at the rim. */
export const MOUNTAIN_ORE = [0, 1, 2, 3, 4];

/**
 * A Mountain Drill's cycle, by what it is digging. Richer seams are harder rock, so
 * a Cobalt seam comes out much more slowly than a Scrap one — but it comes out as
 * Cobalt, which is four Mutator tiers you did not have to build.
 */
export const DRILL_BASE = 2.0;
export const DRILL_PER_TIER = 0.6;

/** How far apart two Bridges can be and still pair: up to four slots between them. */
export const BRIDGE_SPAN = 5;

/* --------------------------------------------------------------- research --- */

/** A gizmo studied is worth exactly what a depot would have paid for it. */
export const SCIENCE_RATE = 1;

/**
 * The tech tree.
 *
 * What starts unlocked is the smallest game there is: Extractors, Conveyors, Market
 * Depots and Research Labs — dig, carry, sell, study. Everything else is research,
 * and every node is paid for out of production rather than out of the bank — you
 * cannot buy your way past a line that is not running.
 *
 * The first few unlocks (Generator, Balancer, Copper Mutator, Sorter, Fuser, Amber
 * Mutator) are marked `flat`: their cost is not multiplied by TECH_COST_SCALE, so the
 * first one is a minute of Scrap into a Lab rather than twenty.
 *
 * `unlocks` names machine kinds, `asm:N` for one Assembler recipe, or `mut:N` for
 * the Mutator that makes rung N of the alloy ladder. `level`
 * raises the ceiling every machine on the map can be upgraded to. `power` and
 * `yield` are flags the power solver and the extractors read.
 */
/**
 * Bonuses some of the research below gives, in one place so the numbers in the
 * blurbs and the numbers in the game are the same numbers.
 */
export const TECH_BONUS = {
  belt: 0.75,         // Express Belts: conveyor and bridge travel time
  motor: 0.75,        // Efficient Motors: every machine's draw
  market: 1.6,        // Market Savvy: what a contract pays over market
  cap: 0.7,           // Capacitors: Zapper recharge time
  over: 1.25,         // Overcharge: Zapper damage
  shield: 2,          // Beacon Shielding: damage per lost gizmo, times this
  drill: 1.4,         // Hardened Bits: Mountain Drill speed
  damper: 2,          // Dampers: drill-seconds per Beetle, times this
  span: 3,            // Long Spans: extra slots a Bridge pair can cross
};

/**
 * The research branches, in the order the TECH tab shows them.
 */
export const BRANCHES = [
  { id: 'economy', name: 'PRODUCTION' },
  { id: 'power', name: 'POWER' },
  { id: 'defense', name: 'DEFENCE' },
  { id: 'terrain', name: 'TERRAIN' },
];

export const TECH = [
  /*
   * The Sorter used to live here, at 120 science, and it was the wrong place for
   * it. Pulling one type out of a mixed line is plumbing, not profit — it is the
   * answer to a problem a new factory hits in its first ten minutes, long before
   * it has a Lab — and every other routing machine has always been on sale from
   * the start. So it is, now, and the tree opens on Warehousing instead.
   *
   * Defence and Terrain used to be on sale from the start too. They are research
   * now, each its own branch: the first swarm is minutes away when a factory gets
   * its first Lab, so Pest Control is cheap, and the rest of each branch is what
   * turns holding the line into winning the map.
   */

  // ---- production: the starter unlocks
  { id: 'balancing', branch: 'economy', name: 'Balancers', cost: 30, flat: true, needs: [], unlocks: ['bal'],
    blurb: 'Unlocks the Balancer. It splits one line in two, sending gizmos alternately straight on and out one side.',
    ranks: 'Ranks II–V: Balancers work 10% faster each (+40% at V).' },
  { id: 'sorting', branch: 'economy', name: 'Sorters', cost: 75, flat: true, needs: ['balancing'], unlocks: ['sort'],
    blurb: 'Unlocks the Sorter. It sends one type you choose out of its side and lets everything else go straight on.',
    ranks: 'Ranks II–V: Sorters work 10% faster each (+40% at V).' },
  { id: 'mut1', branch: 'economy', name: 'Copper Mutator', cost: 45, flat: true, needs: [], unlocks: ['mut:1'],
    blurb: 'Unlocks the Copper Mutator: any gizmo in, Copper out. Copper sells for 3x Scrap.',
    ranks: 'Ranks II–V: Copper Mutators work 10% faster each (+40% at V).' },
  { id: 'fusing', branch: 'economy', name: 'Fusers', cost: 125, flat: true, needs: ['mut1'], unlocks: ['fuse'],
    blurb: 'Unlocks the Fuser. Two gizmos of the same type melt into one of the next type up (two Scrap make one Copper).',
    ranks: 'Ranks II–V: Fusers work 10% faster each (+40% at V).' },
  { id: 'mut2', branch: 'economy', name: 'Amber Mutator', cost: 200, flat: true, needs: ['mut1'], unlocks: ['mut:2'],
    blurb: 'Unlocks the Amber Mutator: any gizmo in, Amber out. Skips two Fuser steps.',
    ranks: 'Ranks II–V: Amber Mutators work 10% faster each (+40% at V).' },
  { id: 'mut3', branch: 'economy', name: 'Bloom Mutator', cost: 140, needs: ['mut2'], unlocks: ['mut:3'],
    blurb: 'Unlocks the Bloom Mutator: any gizmo in, Bloom out.',
    ranks: 'Ranks II–V: Bloom Mutators work 10% faster each (+40% at V).' },
  { id: 'mut4', branch: 'economy', name: 'Cobalt Mutator', cost: 300, needs: ['mut3'], unlocks: ['mut:4'],
    blurb: 'Unlocks the Cobalt Mutator: any gizmo in, Cobalt out. Turbines need Cobalt.',
    ranks: 'Ranks II–V: Cobalt Mutators work 10% faster each (+40% at V).' },
  { id: 'mut5', branch: 'economy', name: 'Void Mutator', cost: 650, needs: ['mut4'], unlocks: ['mut:5'],
    blurb: 'Unlocks the Void Mutator: any gizmo in, Void out.',
    ranks: 'Ranks II–V: Void Mutators work 10% faster each (+40% at V).' },
  { id: 'mut6', branch: 'economy', name: 'Ember Mutator', cost: 1300, needs: ['mut5'], unlocks: ['mut:6'],
    blurb: 'Unlocks the Ember Mutator: any gizmo in, Ember out. Reactors need Ember.',
    ranks: 'Ranks II–V: Ember Mutators work 10% faster each (+40% at V).' },
  { id: 'mut7', branch: 'economy', name: 'Prism Mutator', cost: 2600, needs: ['mut6'], unlocks: ['mut:7'],
    blurb: 'Unlocks the Prism Mutator: any gizmo in, Prism out. Prism is the most valuable alloy.',
    ranks: 'Ranks II–V: Prism Mutators work 10% faster each (+40% at V).' },

  { id: 'overflow', branch: 'economy', name: 'Overflow Splitters', cost: 40, flat: true, needs: ['balancing'], unlocks: ['over'],
    blurb: 'Unlocks the Overflow Splitter. Everything goes straight on; only when that line is full does the extra spill out the side.',
    ranks: 'Ranks II–V: Overflow Splitters work 10% faster each (+40% at V).' },
  { id: 'recycling', branch: 'economy', name: 'Recyclers', cost: 220, needs: ['sorting'], unlocks: ['recyc'],
    blurb: 'Unlocks the Recycler: anything in, one Scrap out — or one Resin for Resin, Cord and Frame. Use it to clear mixed or unwanted gizmos off a line.',
    ranks: 'Ranks II–V: Recyclers work 10% faster each (+40% at V).' },

  // ---- production
  { id: 'storage', branch: 'economy', name: 'Warehousing', cost: 140, needs: ['balancing'], unlocks: ['store'],
    blurb: 'Unlocks Storage: a belt that holds up to 6 gizmos, so a line can absorb bursts without backing up.',
    ranks: 'Ranks II–V: Storage moves gizmos 10% faster each (+40% at V).' },
  { id: 'express', branch: 'economy', name: 'Express Belts', cost: 480, needs: ['storage'], belt: 1,
    blurb: 'Conveyors, Storage and Bridges move gizmos 33% faster.',
    ranks: 'Ranks II–V: faster again each rank — 137% faster at V.' },
  { id: 'assembly', branch: 'economy', name: 'Assembly', cost: 420, needs: ['fusing'], unlocks: ['asm:0'],
    blurb: 'Unlocks the Engine Assembler: Cord + Amber → Engine.',
    ranks: 'Ranks II–V: Engine Assemblers work 10% faster each (+40% at V).' },
  { id: 'overclock', branch: 'economy', name: 'Overclocking', cost: 820, needs: ['storage'], level: 3,
    blurb: 'Raises the machine upgrade limit from level 2 to level 3.',
    ranks: 'Ranks II–III: +1 level each (level 5 at III). Ranks IV–V: all upgrades 15% cheaper each.' },
  { id: 'market', branch: 'economy', name: 'Market Savvy', cost: 900, needs: ['assembly'], market: 1,
    blurb: 'Contracts pay 60% above market price instead of 35%. (Endless mode only — story contracts pay nothing extra.)',
    ranks: 'Ranks II–V: contracts pay more each rank — 180% above market at V.' },
  { id: 'assembly2', branch: 'economy', name: 'Assembly II', cost: 1150, needs: ['assembly'], unlocks: ['asm:1'],
    blurb: 'Unlocks the Turbine Assembler: Frame + Cobalt → Turbine.',
    ranks: 'Ranks II–V: Turbine Assemblers work 10% faster each (+40% at V).' },
  { id: 'replication', branch: 'economy', name: 'Replication', cost: 1900, needs: ['overclock'], unlocks: ['dup'],
    blurb: 'Unlocks the Doubler. It copies each gizmo it gets (up to Cobalt). A copy can never be copied again.',
    ranks: 'Ranks II–V: Doublers work 10% faster each (+40% at V).' },
  { id: 'assembly3', branch: 'economy', name: 'Assembly III', cost: 2600, needs: ['assembly2'], unlocks: ['asm:2'],
    blurb: 'Unlocks the Reactor Assembler: Frame + Ember → Reactor, the most valuable product.',
    ranks: 'Ranks II–V: Reactor Assemblers work 10% faster each (+40% at V).' },
  { id: 'trifurcation', branch: 'economy', name: 'Trifurcation', cost: 3400, needs: ['replication'],
    unlocks: ['trident'], blurb: 'Unlocks the Trident. It sends gizmos out of three sides, copying originals (up to Cobalt) to fill them.',
    ranks: 'Ranks II–V: Tridents work 10% faster each (+40% at V).' },

  // ---- power
  { id: 'generators', branch: 'power', name: 'Generators', cost: 20, flat: true, needs: [], unlocks: ['gen'],
    blurb: 'Unlocks the Generator. It burns gizmos for power and powers every machine connected to it. Unpowered machines run at 1/5 speed.',
    ranks: 'Ranks II–V: Generators make 10% more power each (+40% at V).' },
  { id: 'solar', branch: 'power', name: 'Solar Panels', cost: 500, flat: true, needs: ['generators'], unlocks: ['solar'],
    blurb: 'Unlocks the Solar Panel: 15 kW of steady power with no fuel.',
    ranks: 'Ranks II–V: Solar Panels make 10% more power each (+40% at V).' },
  { id: 'batteries', branch: 'power', name: 'Batteries', cost: 500, flat: true, needs: ['solar'], unlocks: ['battery'],
    blurb: 'Unlocks the Battery: it stores spare power and pays it back when the grid runs short — Solar through the night.',
    ranks: 'Ranks II–V: Batteries hold 15% more each (+60% at V).' },
  { id: 'pylons', branch: 'power', name: 'Pylons', cost: 300, needs: ['gridwork'], unlocks: ['pylon'],
    blurb: 'Unlocks the Pylon. Two facing the same way link with a wire that carries power (not gizmos) across a gap of up to 3 slots.',
    ranks: 'Ranks II–V: Pylon links reach 1 slot further each (+4 at V).' },
  { id: 'gridwork', branch: 'power', name: 'Gridwork', cost: 180, needs: ['generators'], power: 'reach',
    blurb: 'Generator power reaches 4 more machines.',
    ranks: 'Ranks II–V: +2 more machines each (+12 at V).' },
  { id: 'combustion', branch: 'power', name: 'Combustion', cost: 380, needs: ['gridwork'], power: 'fuel',
    blurb: 'Fuel burns 45% longer, so Generators use less ore.',
    ranks: 'Ranks II–V: longer still each rank — 135% longer at V.' },
  { id: 'prospecting', branch: 'power', name: 'Prospecting', cost: 700, needs: ['gridwork'], yield: 1.35,
    blurb: 'Extractors mine 35% more.',
    ranks: 'Ranks II–V: more each rank — 105% more at V.' },
  { id: 'voltage', branch: 'power', name: 'High Voltage', cost: 1500, needs: ['combustion'], power: 'output',
    blurb: 'Generators make 60% more power from the same fuel.',
    ranks: 'Ranks II–V: more each rank — 180% more at V.' },
  { id: 'motors', branch: 'power', name: 'Efficient Motors', cost: 2200, needs: ['voltage'], motor: 1,
    blurb: 'All machines use 25% less power.',
    ranks: 'Ranks II–V: less each rank — 58% less at V.' },

  // ---- defence
  { id: 'nightshift', branch: 'defense', name: 'Night Shift', cost: 150, flat: true, needs: [], unlocks: ['nswitch'],
    blurb: 'Unlocks the Night Switch: it turns the machines around it off at nightfall and back on at dawn.',
    ranks: 'Ranks II–V: nights are calmer — swarms wake at 0.5 more noise each (from 3 up to 5 at V).' },
  { id: 'walls', branch: 'defense', name: 'Walls', cost: 60, flat: true, needs: [], unlocks: ['wall'],
    blurb: 'Unlocks the Wall: creatures go round it, or chew through it if there is no way round.',
    ranks: 'Ranks II–V: Walls get 25% more hit points each (+100% at V).' },
  { id: 'defense', branch: 'defense', name: 'Pest Control', cost: 120, needs: [], unlocks: ['arm', 'zap'],
    blurb: 'Unlocks the Armory (makes Ammo) and the Zapper (shoots creatures with it). Get it before the first swarm.',
    ranks: 'Ranks II–V: Armories and Zappers work 10% faster each (+40% at V).' },
  { id: 'drones', branch: 'defense', name: 'Repair Drones', cost: 350, needs: ['defense'], unlocks: ['drone'],
    blurb: 'Unlocks the Repair Drone Bay. Feed it Copper and it fully repairs damaged machines nearby, 2 Copper per repair.',
    ranks: 'Ranks II–V: drones repair 10% more often each (+40% at V).' },
  { id: 'focus', branch: 'defense', name: 'Focusing', cost: 260, needs: ['defense'], focus: 1,
    blurb: 'Zappers reach 1.5 slots further.',
    ranks: 'Ranks II–V: +0.75 slots each (+4.5 at V).' },
  { id: 'capacitor', branch: 'defense', name: 'Capacitors', cost: 600, needs: ['defense'], cap: 1,
    blurb: 'Zappers recharge 43% faster between shots.',
    ranks: 'Ranks II–V: faster each rank — 192% faster at V.' },
  { id: 'arc', branch: 'defense', name: 'Arc Discharge', cost: 900, needs: ['focus'], arc: 1,
    blurb: 'Each zap jumps to 2 more creatures nearby.',
    ranks: 'Ranks II–V: +1 creature each (6 at V).' },
  { id: 'plating', branch: 'defense', name: 'Plating', cost: 1300, needs: ['arc'], hp: 1,
    blurb: 'All machines take 50% more damage before they break.',
    ranks: 'Ranks II–V: tougher each rank — 150% more at V.' },
  { id: 'overcharge', branch: 'defense', name: 'Overcharge', cost: 1600, needs: ['capacitor'], over: 1,
    blurb: 'Zaps do 25% more damage.',
    ranks: 'Ranks II–V: more each rank — 75% more at V.' },
  { id: 'shield', branch: 'defense', name: 'Beacon Shielding', cost: 3200, needs: ['plating', 'overcharge'], shield: 1,
    blurb: 'The Launch Beacon takes twice as much damage before it loses a delivered gizmo.',
    ranks: 'Ranks II–V: tougher each rank — 4x as much at V.' },

  // ---- terrain
  { id: 'surveying', branch: 'terrain', name: 'Surveying', cost: 250, needs: [], survey: 1,
    blurb: 'Shows which ore is inside each mountain and how much is left.',
    ranks: 'Ranks II–V: Mountain Drills dig 10% faster each (+40% at V).' },
  { id: 'bridging', branch: 'terrain', name: 'Bridging', cost: 300, needs: ['surveying'], unlocks: ['bridge'],
    blurb: 'Unlocks the Bridge. Two facing the same way carry gizmos and power across a gap of up to 4 slots.',
    ranks: 'Ranks II–V: Bridges move gizmos 10% faster each (+40% at V).' },
  { id: 'mining', branch: 'terrain', name: 'Deep Mining', cost: 650, needs: ['surveying'], unlocks: ['drill'],
    blurb: 'Unlocks the Mountain Drill. Set it facing a mountain and it digs out that mountain\'s ore. Drilling wakes Beetles.',
    ranks: 'Ranks II–V: Mountain Drills dig 10% faster each (+40% at V).' },
  { id: 'longspan', branch: 'terrain', name: 'Long Spans', cost: 1200, needs: ['bridging'], span: 1,
    blurb: 'Bridge pairs can be 3 slots further apart.',
    ranks: 'Ranks II–V: +1 slot each (+7 at V).' },
  { id: 'bits', branch: 'terrain', name: 'Hardened Bits', cost: 1400, needs: ['mining'], drill: 1,
    blurb: 'Mountain Drills dig 40% faster.',
    ranks: 'Ranks II–V: faster each rank — 120% faster at V.' },
  { id: 'dampers', branch: 'terrain', name: 'Dampers', cost: 1800, needs: ['mining'], damper: 1,
    blurb: 'Drilling wakes Beetles half as often.',
    ranks: 'Ranks II–V: rarer each rank — 4x less often at V.' },
];

export const techById = id => TECH.find(t => t.id === id) || null;

/**
 * What a machine spec is unlocked as: its kind, or `asm:N` / `mut:N` for an
 * Assembler recipe or a Mutator rung, which are researched one at a time.
 */
export const unlockKey = spec => spec.kind === 'asm' ? 'asm:' + (spec.mut ?? 0)
  : spec.kind === 'mut' ? 'mut:' + (spec.mut ?? 1) : spec.kind;

/** The machine an unlock key stands for: `asm:N` and `mut:N` carry their setting. */
export const specOfKey = u => (u.startsWith('asm:') ? { kind: 'asm', mut: +u.slice(4) }
  : u.startsWith('mut:') ? { kind: 'mut', mut: +u.slice(4) } : { kind: u });

/** The research that unlocks a machine kind (or unlock key), or null if it is on sale from the start. */
export const unlockerOf = key => TECH.find(t => (t.unlocks || []).includes(key))
  || (key === 'mut' ? techById('mut1') : null);

/** The machines on sale before any research at all. */
export const STARTER_KINDS = ['pipe', 'ext', 'depot', 'lab'];

/** Every node has five ranks. Each costs more than the last. */
export const TECH_RANKS = 5;
export const RANK_COST = [1, 2, 3.5, 5.5, 8];
/**
 * Every node's price is its listed cost times this. The tree's own numbers stay
 * readable as relative prices; this is the one knob that sets how long research
 * takes overall.
 */
export const TECH_COST_SCALE = 10;
/** What the next rank of a node costs, or 0 if it is maxed. */
export const rankCost = (t, done = []) => {
  const r = rankOf(done, t.id);
  return r >= TECH_RANKS ? 0 : Math.round(t.cost * (t.flat ? 1 : TECH_COST_SCALE) * RANK_COST[r]);
};
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** What one more rank of this node does, in a few words, for the card. */
export function rankBlurb(t) {
  if (t.ranks) return t.ranks;
  if (t.id === 'overclock') return 'Ranks I–III raise the ceiling a level each, to 5; IV and V make every upgrade 15% cheaper.';
  if (t.unlocks?.length) return 'Each rank after the first: what it unlocks works 10% faster.';
  if (t.survey) return 'Each rank after the first: Mountain Drills dig 10% faster.';
  if (t.span) return 'Each rank after the first: one more slot.';
  if (t.arc) return 'Each rank after the first: one more mite in the chain.';
  return 'Each rank after the first adds half as much again — rank V is three times rank I.';
}

/** Can this node be started — is everything it needs already done? */
export const techOpen = (t, done) => (t.needs || []).every(n => done.includes(n));

/** Everything a set of finished research makes buildable. */
export function unlockedBy(done = []) {
  const out = new Set(STARTER_KINDS);
  for (const id of done) for (const u of techById(id)?.unlocks || []) out.add(u);
  // 'mut' on its own means "some Mutator is on sale", for the palette.
  for (const u of out) if (u.startsWith('mut:')) { out.add('mut'); break; }
  return out;
}

/** The upgrade ceiling, which Overclocking raises. */
export const levelCap = (done = []) => Math.min(MAX_LEVEL, 2 + flagRank(done, 'level'));

const powerRank = (done, what) => { const t = TECH.find(x => x.power === what); return t ? rankOf(done, t.id) : 0; };

/** Kilowatts a generator actually makes, after research. */
export const genOutput = (m, done = []) =>
  GEN_OUTPUT[(m.level || 1) - 1] * (1 + (VOLTAGE_BONUS - 1) * rankScale(powerRank(done, 'output')))
  * unlockSpeed('gen', done);

/** Kilowatts a Solar Panel makes, after research (each rank of Solar Panels past I: +10%). */
export const solarOutput = (m, done = [], light = 1) => SOLAR_OUTPUT[(m.level || 1) - 1] * unlockSpeed('solar', done) * light;

/** Slots a Pylon's link may cross, by its level, plus one for each rank of Pylons past I. */
export const pylonGap = (m, done = []) => PYLON_GAP[(m.level || 1) - 1] + Math.max(0, rankOf(done, 'pylons') - 1);

/** Seconds between a Drone Bay's repairs at full power. */
export const droneCycle = (m, done = []) => DRONE_CYCLE * (LEVEL_SPEED[(m.level || 1) - 1] ?? 1) / unlockSpeed('drone', done);

/** How many hops a generator's power carries, after research. */
export const genReach = (m, done = []) =>
  GEN_REACH[(m.level || 1) - 1] + Math.round(GRIDWORK_REACH * rankScale(powerRank(done, 'reach')));

/** Kilowatt-seconds one of these releases, after research. */
export const energyOf = (ty, done = []) =>
  fuelEnergy(ty) * (1 + (COMBUSTION_BONUS - 1) * rankScale(powerRank(done, 'fuel')));

/** What Prospecting does to every Extractor. */
export const yieldBonus = (done = []) => grow(done, 'yield', 1.35);

/**
 * Everything buildable right now. No randomness, no reroll, no cap: what you have
 * unlocked, at what it costs, as many as you can afford and can fit.
 */
export function catalogue(done = [], counts = {}) {
  const on = unlockedBy(done);
  const out = [];
  const add = spec => out.push({ ...spec, dir: 0, cost: buyCost(spec, counts[spec.kind] || 0) });

  add({ kind: 'pipe' });
  if (on.has('bal')) add({ kind: 'bal' });
  if (on.has('over')) add({ kind: 'over' });
  if (on.has('sort')) add({ kind: 'sort' });
  if (on.has('store')) add({ kind: 'store' });
  add({ kind: 'ext' });
  if (on.has('gen')) add({ kind: 'gen' });
  if (on.has('solar')) add({ kind: 'solar' });
  if (on.has('pylon')) add({ kind: 'pylon' });
  add({ kind: 'depot' });
  add({ kind: 'lab' });
  for (let t = 1; t <= LADDER_MAX; t++) if (on.has('mut:' + t)) add({ kind: 'mut', mut: t });
  if (on.has('fuse')) add({ kind: 'fuse' });
  if (on.has('recyc')) add({ kind: 'recyc' });
  RECIPES.forEach((r, i) => { if (on.has('asm:' + i)) add({ kind: 'asm', mut: i }); });
  if (on.has('dup')) add({ kind: 'dup' });
  if (on.has('trident')) add({ kind: 'trident' });
  if (on.has('arm')) add({ kind: 'arm' });
  if (on.has('zap')) add({ kind: 'zap' });
  if (on.has('drone')) add({ kind: 'drone' });
  if (on.has('drill')) add({ kind: 'drill' });
  if (on.has('bridge')) add({ kind: 'bridge' });
  return out;
}

/* -------------------------------------------------------------- story mode --- */

/**
 * Story mode: eight worlds, from a pebble of an asteroid to a moon.
 *
 * Every world is the ordinary 80x80 grid with everything outside one lumpy rock
 * turned to open space, so the whole engine runs unchanged on it. Each world is
 * bigger than the last and switches on one more feature of the endless game —
 * Sap, mites, mountains, valleys, skitters — and asks for one contract: a short
 * list of goals, all of which have to be met. Nothing is timed and nothing fails.
 *
 * Money and science start fresh on every world. Research is kept: the tech tree
 * you build up carries from rock to rock, which is the thread that ties it together.
 *
 * Goals: `ship` n of type ty to Depots; `rate` hold ty at `per` a minute for `secs`
 * seconds; `cash` earn n on this world.
 *
 * Feature flags: `sap` makes sure Sap is on the rock; `bugs` lets Mite nests dig in
 * (`nests` caps how many); `skitters` lets some of them be Skitter nests;
 * `mountains`, `valleys` keep those features — without them the ground is flat.
 */
export const STORY_LEVELS = [
  { name: 'PEBBLE', kind: 'Small asteroid', r: 7, cash: 650,
    blurb: 'A lump of slag no bigger than a warehouse floor. A trading company wants scrap, and wants it now.',
    learn: 'The basics. Dig ore, carry it on Conveyors, sell it at a Depot — and feed a Research Lab to unlock everything else.',
    goals: [{ k: 'ship', ty: 0, n: 120 }] },
  { name: 'CINDER', kind: 'Small asteroid', r: 9, cash: 650,
    blurb: 'Bigger, and darker. Somebody out here pays for copper.',
    learn: 'Power and the ladder. Generators run everything five times faster; a Copper Mutator turns raw ore into Copper.',
    goals: [{ k: 'ship', ty: 1, n: 150 }, { k: 'cash', n: 1500 }] },
  { name: 'SHARD', kind: 'Small asteroid', r: 11, cash: 700,
    blurb: 'A splinter of an older world, rich all the way through.',
    learn: 'Fusers. Two gizmos of a kind melt into one of the next rung up — climb the ladder past Copper.',
    goals: [{ k: 'ship', ty: 2, n: 120 }, { k: 'rate', ty: 1, per: 30, secs: 60 }] },
  { name: 'HOLLOW', kind: 'Large asteroid', r: 16, cash: 800, sap: true,
    blurb: 'Half the rock is slag. The other half grows something.',
    learn: 'Sap, the second ore, out at the far side of the rock. Fuse it into Cord, and research Assembly to marry Cord and Amber into Engines.',
    goals: [{ k: 'ship', ty: 9, n: 60 }, { k: 'ship', ty: 11, n: 10 }] },
  { name: 'KESSLER', kind: 'Large asteroid', r: 20, cash: 900, sap: true, bugs: true, nests: 4,
    blurb: 'The survey missed something. The rock is inhabited.',
    learn: 'Mites. Nests out in the wilds send swarms that chew machines; the noisier you are, the sooner. Research Pest Control for the Armory and the Zapper.',
    goals: [{ k: 'rate', ty: 11, per: 6, secs: 60 }, { k: 'cash', n: 10000 }] },
  { name: 'TALUS', kind: 'Large asteroid', r: 25, cash: 1000, sap: true, bugs: true, nests: 6, mountains: true,
    blurb: 'Ridges of stone with seams of metal running through them.',
    learn: 'Mountains. You cannot build on them, but a Mountain Drill beside one digs its seam out — and the drilling wakes Beetles.',
    goals: [{ k: 'ship', ty: 4, n: 80 }, { k: 'ship', ty: 12, n: 15 }] },
  { name: 'SELKA', kind: 'Moon', r: 31, cash: 1200, sap: true, bugs: true, nests: 9, skitters: true, mountains: true, valleys: true,
    blurb: 'A small moon, split by chasms.',
    learn: 'Valleys. Nothing stands in one; a pair of Bridges carries a belt and power across. And Skitters, fast and fragile, that go for your belts.',
    goals: [{ k: 'rate', ty: 12, per: 4, secs: 90 }, { k: 'ship', ty: 13, n: 10 }, { k: 'cash', n: 60000 }] },
  { name: 'ORRIN', kind: 'Moon', r: 39, cash: 1500, sap: true, bugs: true, nests: 16, skitters: true, mountains: true, valleys: true,
    blurb: 'The last contract, and the biggest. A whole moon to work.',
    learn: 'Everything you have learnt, at full scale. Reactors and Prisms, and the swarms that come for a factory this loud.',
    goals: [{ k: 'ship', ty: 13, n: 40 }, { k: 'ship', ty: 7, n: 20 }, { k: 'rate', ty: 13, per: 3, secs: 120 }, { k: 'cash', n: 250000 }] },
];

/** One goal, in words. */
export function goalText(goal) {
  const nm = TYPES[goal.ty]?.name || '';
  if (goal.k === 'ship') return `Ship ${num(goal.n)} ${nm}`;
  if (goal.k === 'rate') return `Make ${goal.per} ${nm} a minute for ${goal.secs}s`;
  return `Earn ${money(goal.n)}`;
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

/* ---------------------------------------------------------------- tutorial --- */

/**
 * The first five minutes, once.
 *
 * GIZMO 3 used to hand you a working line and let you work out the rest. That is a
 * fine way to open a game you already understand and a poor way to open one you do
 * not: the single most important thing about this map — that ore comes out of the
 * ground, goes along a belt, and turns into money at the other end — was something
 * you were shown the *result* of rather than something you did.
 *
 * So the map starts empty and the first visit is walked through building that line
 * by hand, one step at a time. Six steps, and between them they cover every verb
 * this game has that no other game has: ore under the machine, a depot that is a
 * building rather than a wall, belts laid by dragging, power that comes from
 * burning what you dug up, and a fence you have to pay to push outward.
 *
 * Each step watches the factory rather than the mouse. There is nothing to click
 * through and no wrong order — do the thing, and it ticks. `done` is handed the
 * factory and the game; it must be cheap, because it is asked every frame.
 */
export const TUTORIAL = [
  {
    id: 'ext',
    title: 'Put an Extractor on ore',
    body: 'Howdy, rookie! I\'m Gus, foreman of this here rock, and I\'ll show you the ropes. '
      + 'Press <b>5</b>, then click any slot inside your fence — all nine are Slag! An Extractor '
      + 'pulls ore out of the ground under it and pushes it out of its front.',
    done: f => f.cells.some(i => f.grid[i]?.kind === 'ext'),
  },
  {
    id: 'depot',
    title: 'Build a Market Depot',
    body: 'Lovely! Now let\'s sell it. Press <b>7</b> and put a Market Depot a couple of slots away — '
      + 'your first one\'s on the house! — '
      + 'the way your Extractor is facing. It buys anything pushed into it, instantly, at full '
      + 'price — but only through the one mouth on its front. It turns to face whatever feeds it, '
      + 'and <b>R</b> turns it by hand.',
    done: f => f.cells.some(i => f.grid[i]?.kind === 'depot'),
  },
  {
    id: 'belt',
    title: 'Join them with a Conveyor',
    body: 'Now hook \'em up! Press <b>1</b> and <b>drag</b> from the Extractor to the Depot — one '
      + 'drag lays the whole run and aims every belt. Money starts rolling in the moment the '
      + 'first ore gets there. Ooh, I love that sound!',
    done: f => f.sold > 0,
  },
  {
    id: 'lab',
    title: 'Feed a Research Lab',
    body: 'Here\'s the fun part — everything else is research! Put a second Extractor on ore and '
      + 'run a belt into a <b>Research Lab</b> (press <b>8</b>). A Lab turns gizmos into science '
      + 'instead of money, worth exactly what a Depot would have paid.',
    done: f => f.studied > 0,
  },
  {
    id: 'research',
    title: 'Research Generators',
    body: 'Science! Now, notice how slow things are? Nothing\'s powered, so it all runs at a fifth '
      + 'of its speed. Press <b>Y</b> for the tech tree and grab <b>Generators</b> — the first '
      + 'unlocks only cost a few dozen science!',
    done: f => rankOf(f.done, 'generators') > 0,
  },
  {
    id: 'gen',
    title: 'Build a Generator touching the line',
    body: 'Press <b>6</b> and set a Generator right up against the side of your belt. Power spreads '
      + 'from machine to machine wherever they touch.',
    done: f => f.cells.some(i => f.grid[i]?.kind === 'gen'),
  },
  {
    id: 'fuel',
    title: 'Get ore into the firebox',
    body: 'A Generator\'s a hungry fella — it burns whatever you feed it! Research <b>Balancers</b>, '
      + 'press <b>2</b> and drop a Balancer in the middle of your belt so its side exit points at '
      + 'the Generator. It sends every other gizmo down the branch, and the belt carrying the fuel '
      + 'carries the power back too. Neat, huh?',
    done: f => f.cells.some(i => f.grid[i]?.kind === 'gen' && f.grid[i].fuel > 0),
  },
  {
    id: 'land',
    title: 'Buy a ring of land',
    body: 'Nine slots won\'t make you rich! Press <b>C</b>, or EXPAND up top, to buy a ring of land. '
      + 'It starts cheap and gets pricier, but the ore out there is richer than what\'s under your boots.',
    done: f => f.claim > CLAIM_START,
  },
];

/** What the card says once every step is ticked. */
export const TUTORIAL_END = {
  title: 'You\'re a natural!',
  body: 'That\'s the whole job, rookie — the rest is more of it! <b>Mutators</b> and <b>Fusers</b> '
    + '(unlock \'em in the tech tree) turn cheap gizmos into pricey ones, your <b>Lab</b> keeps paying '
    + 'for new toys, and out past a dozen rings there\'s Sap, the second ore the Assembler recipes need. '
    + 'I\'ll pop back up when something new turns up. Press <b>?</b> any time for the manual. Happy mining!',
};

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
  { id: 'power', name: 'Power something', hint: 'Research Generators, build one touching your line, and feed it ore.' },
  { id: 'mutate', name: 'Climb the ladder', hint: 'Research Copper Mutation, then send a Mutator raw ore.' },
  { id: 'science', name: 'Run an experiment', hint: 'Push a gizmo into a Research Lab.' },
  { id: 'expand', name: 'Buy land', hint: 'Claim a ring, and reach the patches outside your fence.' },
  { id: 'recipe', name: 'Assemble a product', hint: 'Research Assembly, then feed an Assembler both halves.' },
  { id: 'zap', name: 'Zap a mite', hint: 'Build a Zapper near your line and belt Ammo into it from an Armory.' },
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
