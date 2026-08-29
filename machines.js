/**
 * machines.js — the parts catalogue.
 *
 * 50 machines across five kinds. Pure data plus the level-scaling maths.
 * No DOM, no network: this module is imported by the host sim, the shop UI
 * and the renderer alike, so it must stay side-effect free.
 */

export const MAX_LEVEL = 5;

/* Gizmo tiers. These six colours are the only colour in the entire game. */
export const TIERS = [
  { name: 'Nub',     color: '#d1382c', value: 12 },
  { name: 'Cog',     color: '#e07b1a', value: 30 },
  { name: 'Coil',    color: '#e0b91f', value: 78 },
  { name: 'Rotor',   color: '#3f9c53', value: 190 },
  { name: 'Core',    color: '#2f6fb5', value: 460 },
  { name: 'Paragon', color: '#7b4bb0', value: 1150 },
];
export const MAX_TIER = TIERS.length - 1;

export const KINDS = {
  creator:   { label: 'Creators',   blurb: 'Emit raw gizmos onto the line.' },
  converter: { label: 'Converters', blurb: 'Raise gizmos to a higher tier.' },
  mover:     { label: 'Movers',     blurb: 'Speed the whole line up.' },
  energizer: { label: 'Energizers', blurb: 'Supply power. Draw nothing.' },
  keeper:    { label: 'Keepers',    blurb: 'Add buffer space and sale value.' },
};
export const KIND_ORDER = ['creator', 'converter', 'mover', 'energizer', 'keeper'];

/* ------------------------------------------------------------- catalogue --- */
/* creator   p: { tier, interval }         emits tier every interval seconds
   converter p: { time, up, maxIn, need }  need inputs of tier <= maxIn -> one at +up
   mover     p: { speed }                  additive line-speed bonus
   energizer p: { supply }                 power units supplied
   keeper    p: { cap, value }             +queue per slot, +% sale value          */

export const MACHINES = [
  // ---- Creators (10) -------------------------------------------------------
  { id: 'c1',  code: 'ZR/10',  name: 'Hopper',        kind: 'creator', cost: 60,    draw: 2,  stock: 9, p: { tier: 0, interval: 3.0 } },
  { id: 'c2',  code: 'QN/02',  name: 'Feeder',        kind: 'creator', cost: 130,   draw: 3,  stock: 8, p: { tier: 0, interval: 2.2 } },
  { id: 'c3',  code: 'DU/01',  name: 'Injector',      kind: 'creator', cost: 280,   draw: 5,  stock: 7, p: { tier: 0, interval: 1.6 } },
  { id: 'c4',  code: 'TH/04',  name: 'Extruder',      kind: 'creator', cost: 440,   draw: 6,  stock: 6, p: { tier: 1, interval: 3.2 } },
  { id: 'c5',  code: 'AX/02',  name: 'Spooler',       kind: 'creator', cost: 720,   draw: 8,  stock: 6, p: { tier: 1, interval: 2.4 } },
  { id: 'c6',  code: 'MK/08',  name: 'Caster',        kind: 'creator', cost: 1180,  draw: 11, stock: 5, p: { tier: 2, interval: 3.4 } },
  { id: 'c7',  code: 'RG/01',  name: 'Sinterer',      kind: 'creator', cost: 1850,  draw: 14, stock: 5, p: { tier: 2, interval: 2.6 } },
  { id: 'c8',  code: 'KL/09',  name: 'Nucleator',     kind: 'creator', cost: 2950,  draw: 18, stock: 4, p: { tier: 3, interval: 3.6 } },
  { id: 'c9',  code: 'VX/10',  name: 'Seed Array',    kind: 'creator', cost: 4700,  draw: 24, stock: 3, p: { tier: 3, interval: 2.6 } },
  { id: 'c10', code: 'LAV-5',  name: 'Genesis Drum',  kind: 'creator', cost: 7600,  draw: 32, stock: 2, p: { tier: 4, interval: 3.8 } },

  // ---- Converters (14) -----------------------------------------------------
  { id: 'v1',  code: 'DU/12',  name: 'Press',         kind: 'converter', cost: 150,   draw: 4,  stock: 9, p: { time: 2.4, up: 1, maxIn: 0, need: 1 } },
  { id: 'v2',  code: 'ZR/04',  name: 'Roller',        kind: 'converter', cost: 330,   draw: 6,  stock: 8, p: { time: 2.0, up: 1, maxIn: 1, need: 1 } },
  { id: 'v3',  code: 'TH/02',  name: 'Kiln',          kind: 'converter', cost: 490,   draw: 7,  stock: 7, p: { time: 2.6, up: 1, maxIn: 1, need: 2 } },
  { id: 'v4',  code: 'MK/11',  name: 'Lathe',         kind: 'converter', cost: 660,   draw: 9,  stock: 7, p: { time: 2.2, up: 1, maxIn: 2, need: 1 } },
  { id: 'v5',  code: 'QN/10',  name: 'Etcher',        kind: 'converter', cost: 1000,  draw: 11, stock: 6, p: { time: 2.8, up: 1, maxIn: 2, need: 2 } },
  { id: 'v6',  code: 'RG/09',  name: 'Annealer',      kind: 'converter', cost: 1550,  draw: 14, stock: 6, p: { time: 2.4, up: 1, maxIn: 3, need: 1 } },
  { id: 'v7',  code: 'VX/07',  name: 'Compressor',    kind: 'converter', cost: 2150,  draw: 16, stock: 5, p: { time: 3.2, up: 2, maxIn: 1, need: 2 } },
  { id: 'v8',  code: 'KL/07',  name: 'Refiner',       kind: 'converter', cost: 2850,  draw: 19, stock: 5, p: { time: 2.9, up: 1, maxIn: 3, need: 2 } },
  { id: 'v9',  code: 'OM/04',  name: 'Doper',         kind: 'converter', cost: 3950,  draw: 23, stock: 4, p: { time: 2.6, up: 1, maxIn: 4, need: 1 } },
  { id: 'v10', code: 'TH/01',  name: 'Crucible',      kind: 'converter', cost: 5300,  draw: 27, stock: 4, p: { time: 3.4, up: 2, maxIn: 2, need: 2 } },
  { id: 'v11', code: 'AX/11',  name: 'Aligner',       kind: 'converter', cost: 6900,  draw: 31, stock: 3, p: { time: 3.0, up: 1, maxIn: 4, need: 2 } },
  { id: 'v12', code: 'ZR/02',  name: 'Collimator',    kind: 'converter', cost: 8300,  draw: 34, stock: 3, p: { time: 2.8, up: 1, maxIn: 5, need: 1 } },
  { id: 'v13', code: 'RCT-1',  name: 'Reactor',       kind: 'converter', cost: 9800,  draw: 40, stock: 3, p: { time: 3.6, up: 2, maxIn: 3, need: 2 } },
  { id: 'v14', code: 'LAV-2',  name: 'Transmuter',    kind: 'converter', cost: 14500, draw: 52, stock: 2, p: { time: 4.2, up: 3, maxIn: 2, need: 3 } },

  // ---- Movers (9) ----------------------------------------------------------
  { id: 'm1',  code: 'TH/10',  name: 'Belt',          kind: 'mover', cost: 90,    draw: 2,  stock: 9, p: { speed: 0.12 } },
  { id: 'm2',  code: 'QN/12',  name: 'Chain Drive',   kind: 'mover', cost: 210,   draw: 3,  stock: 8, p: { speed: 0.18 } },
  { id: 'm3',  code: 'DU/04',  name: 'Screw Feed',    kind: 'mover', cost: 390,   draw: 5,  stock: 7, p: { speed: 0.25 } },
  { id: 'm4',  code: 'AX/05',  name: 'Rail Sled',     kind: 'mover', cost: 660,   draw: 7,  stock: 7, p: { speed: 0.32 } },
  { id: 'm5',  code: 'ZR/08',  name: 'Shuttle',       kind: 'mover', cost: 1120,  draw: 10, stock: 6, p: { speed: 0.42 } },
  { id: 'm6',  code: 'VX/03',  name: 'Maglev Track',  kind: 'mover', cost: 1950,  draw: 14, stock: 5, p: { speed: 0.55 } },
  { id: 'm7',  code: 'RG/10',  name: 'Slipstream',    kind: 'mover', cost: 3300,  draw: 19, stock: 4, p: { speed: 0.70 } },
  { id: 'm8',  code: 'KL/12',  name: 'Gravitor',      kind: 'mover', cost: 5500,  draw: 26, stock: 3, p: { speed: 0.90 } },
  { id: 'm9',  code: 'OM/09',  name: 'Phase Rail',    kind: 'mover', cost: 9200,  draw: 36, stock: 2, p: { speed: 1.20 } },

  // ---- Energizers (9) ------------------------------------------------------
  { id: 'e1',  code: 'KL/04',  name: 'Dry Cell',      kind: 'energizer', cost: 110,   draw: 0, stock: 9, p: { supply: 12 } },
  { id: 'e2',  code: 'TH/08',  name: 'Dynamo',        kind: 'energizer', cost: 270,   draw: 0, stock: 8, p: { supply: 26 } },
  { id: 'e3',  code: 'QN/09',  name: 'Turbine',       kind: 'energizer', cost: 540,   draw: 0, stock: 7, p: { supply: 48 } },
  { id: 'e4',  code: 'ZR/05',  name: 'Boiler',        kind: 'energizer', cost: 980,   draw: 0, stock: 7, p: { supply: 82 } },
  { id: 'e5',  code: 'VX/11',  name: 'Cell Stack',    kind: 'energizer', cost: 1750,  draw: 0, stock: 6, p: { supply: 130 } },
  { id: 'e6',  code: 'RG/11',  name: 'Fission Pod',   kind: 'energizer', cost: 3100,  draw: 0, stock: 5, p: { supply: 200 } },
  { id: 'e7',  code: 'AX/09',  name: 'Solar Web',     kind: 'energizer', cost: 5200,  draw: 0, stock: 4, p: { supply: 300 } },
  { id: 'e8',  code: 'KL/03',  name: 'Fusion Ring',   kind: 'energizer', cost: 8600,  draw: 0, stock: 3, p: { supply: 460 } },
  { id: 'e9',  code: 'LAV-9',  name: 'Zero-Point',    kind: 'energizer', cost: 14200, draw: 0, stock: 2, p: { supply: 700 } },

  // ---- Keepers (8) ---------------------------------------------------------
  { id: 'k1',  code: 'TH/11',  name: 'Bin',           kind: 'keeper', cost: 140,   draw: 1,  stock: 9, p: { cap: 1, value: 0.04 } },
  { id: 'k2',  code: 'QN/05',  name: 'Rack',          kind: 'keeper', cost: 310,   draw: 2,  stock: 8, p: { cap: 1, value: 0.08 } },
  { id: 'k3',  code: 'DU/06',  name: 'Silo',          kind: 'keeper', cost: 640,   draw: 3,  stock: 7, p: { cap: 2, value: 0.12 } },
  { id: 'k4',  code: 'MK/06',  name: 'Vault',         kind: 'keeper', cost: 1250,  draw: 5,  stock: 6, p: { cap: 2, value: 0.18 } },
  { id: 'k5',  code: 'VX/02',  name: 'Buffer Coil',   kind: 'keeper', cost: 2250,  draw: 7,  stock: 5, p: { cap: 3, value: 0.25 } },
  { id: 'k6',  code: 'RG/04',  name: 'Depot',         kind: 'keeper', cost: 3900,  draw: 10, stock: 4, p: { cap: 3, value: 0.34 } },
  { id: 'k7',  code: 'KL/08',  name: 'Cryostore',     kind: 'keeper', cost: 6600,  draw: 14, stock: 3, p: { cap: 4, value: 0.46 } },
  { id: 'k8',  code: 'OM/12',  name: 'Hyperbay',      kind: 'keeper', cost: 11500, draw: 20, stock: 2, p: { cap: 5, value: 0.60 } },
];

export const BY_ID = Object.fromEntries(MACHINES.map(m => [m.id, m]));

/* ------------------------------------------------------------- levelling --- */

/** Cost to take a machine from `level` to `level + 1`. */
export function upgradeCost(m, level) {
  return Math.round(m.cost * 0.55 * Math.pow(level, 1.75));
}

/** Total money sunk into a slot at this level — drives the 50% sell refund. */
export function investedIn(m, level) {
  let total = m.cost;
  for (let l = 1; l < level; l++) total += upgradeCost(m, l);
  return total;
}

export const sellRefund = (m, level) => Math.round(investedIn(m, level) * 0.5);

/**
 * Effective stats for a machine at a given level. Every consumer reads stats
 * through here so the scaling curve lives in exactly one place.
 */
export function stats(m, level = 1) {
  const n = level - 1;
  const s = { draw: m.draw, ...m.p };
  switch (m.kind) {
    case 'creator':
      s.interval = m.p.interval * Math.pow(0.87, n);
      s.draw = round1(m.draw * Math.pow(1.12, n));
      break;
    case 'converter':
      s.time = m.p.time * Math.pow(0.87, n);
      s.draw = round1(m.draw * Math.pow(1.12, n));
      break;
    case 'mover':
      s.speed = round2(m.p.speed * (1 + 0.6 * n));
      s.draw = round1(m.draw * Math.pow(1.15, n));
      break;
    case 'energizer':
      s.supply = Math.round(m.p.supply * (1 + 0.45 * n));
      s.draw = 0;
      break;
    case 'keeper':
      s.cap = m.p.cap + n;
      s.value = round2(m.p.value * (1 + 0.5 * n));
      s.draw = round1(m.draw * Math.pow(1.1, n));
      break;
  }
  return s;
}

/** One-line human description of what a machine does at a given level. */
export function describe(m, level = 1) {
  const s = stats(m, level);
  switch (m.kind) {
    case 'creator':
      return `Emits ${TIERS[s.tier].name} every ${s.interval.toFixed(2)}s`;
    case 'converter': {
      const inp = s.need > 1 ? `${s.need} inputs` : '1 input';
      return `${inp} up to ${TIERS[s.maxIn].name} to +${s.up} tier, ${s.time.toFixed(2)}s`;
    }
    case 'mover':
      return `Line speed +${Math.round(s.speed * 100)}%`;
    case 'energizer':
      return `Supplies ${s.supply} power`;
    case 'keeper':
      return `+${s.cap} buffer per slot, sale value +${Math.round(s.value * 100)}%`;
  }
  return '';
}

const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
