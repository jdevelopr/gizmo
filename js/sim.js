/**
 * sim.js — the factory simulation. Pure logic, no DOM and no network.
 *
 * The host owns one Factory per player and steps them all. Clients never run
 * this; they render the view the host sends. Practice mode runs it locally.
 */

import {
  GRID, DIRS, TYPES, MAX_TYPE, KINDS, MAX_LEVEL, MAX_UTIL,
  makeMachine, price, upgradeCost, scrapValue, cycleTime, travelTime,
  intake, outputs, producerCycle, producerCost, sellerMult, sellerCost,
  cellOf, cx, cy, inGrid, PRODUCER_PORT, SELLER_SPOTS,
} from './machines.js';

const MAX_IDLE_PER_CELL = 10;   // a full slot starts destroying arrivals
const MAX_GIZMOS = 240;         // hard ceiling, keeps the wire and the frame sane
const INV_CAP = 8;

export function createFactory({ cash = 40 } = {}) {
  const f = {
    grid: new Array(GRID * GRID).fill(null),
    inv: [],
    producer: { level: 1, t: 0 },
    seller: { level: 1, cell: 2, dir: 0 },
    gizmos: [],
    cash,
    earned: 0,
    income: 0,      // this round only
    sold: 0,
    lost: 0,
    fx: [],
    nid: 1,
    running: false,
  };
  return f;
}

/**
 * The starting line: producer -> doubler -> conveyor -> conveyor -> seller.
 * Round one therefore earns money untouched, and every round after it breaks
 * when the seller jumps somewhere else.
 */
export function starterKit(f) {
  place(f, makeMachine({ kind: 'dup', dir: 0 }, f.nid++), 0);
  place(f, makeMachine({ kind: 'pipe', dir: 0 }, f.nid++), 1);
  place(f, makeMachine({ kind: 'pipe', dir: 0 }, f.nid++), 2);
  f.seller = { level: 1, cell: 2, dir: 0 };
}

function place(f, m, i) { f.grid[i] = m; }

/* -------------------------------------------------------------------- step --- */

export function stepFactory(f, dt) {
  if (dt > 0.1) dt = 0.1;   // a backgrounded tab must not fast-forward the floor

  if (f.running) {
    f.producer.t -= dt;
    if (f.producer.t <= 0) {
      f.producer.t += producerCycle(f.producer.level);
      spawnFromProducer(f);
    }
    for (let i = 0; i < f.grid.length; i++) {
      const m = f.grid[i];
      if (!m) continue;
      m.t -= dt;
      if (m.t <= 0) fire(f, m, i);
    }
  }

  for (let k = f.gizmos.length - 1; k >= 0; k--) {
    const g = f.gizmos[k];
    if (g.st === 'fly') {
      g.p += dt / g.dur;
      if (g.p >= 1) { arrive(f, g, k); continue; }
      g.x = g.sx + (g.ex - g.sx) * g.p;
      g.y = g.sy + (g.ey - g.sy) * g.p;
    } else if (g.st === 'idle') {
      const m = f.grid[g.cell];
      if (m && m.buf.length < intake(m)) absorb(f, m, g, k);
    }
  }

  for (const m of f.grid) if (m && m.flash > 0) m.flash = Math.max(0, m.flash - dt * 5);
  if (f.producer.flash > 0) f.producer.flash = Math.max(0, f.producer.flash - dt * 5);
  if (f.seller.flash > 0) f.seller.flash = Math.max(0, f.seller.flash - dt * 4);
}

function spawnFromProducer(f) {
  if (f.gizmos.length >= MAX_GIZMOS) return;
  f.producer.flash = 1;
  const { cell } = PRODUCER_PORT;
  const ex = cx(cell) + 0.5, ey = cy(cell) + 0.5;
  f.gizmos.push({
    id: f.nid++, ty: 0, st: 'fly',
    sx: ex - 1, sy: ey, ex, ey, x: ex - 1, y: ey,
    p: 0, dur: 0.3, cell, from: -1, exit: null,
  });
  f.fx.push({ k: 'spawn', cell });
}

function fire(f, m, i) {
  const need = intake(m);
  if (m.buf.length < need) { m.t = 0; return; }

  const inputs = m.buf.splice(0, need);
  const outs = outputs(m, inputs);
  m.t = cycleTime(m);
  m.flash = 1;
  f.fx.push({ k: 'fire', cell: i, kind: m.kind, ty: outs[0]?.ty ?? inputs[0].ty, n: outs.length });

  const dur = travelTime(m);
  outs.forEach((o, n) => emit(f, i, o, dur, n, outs.length));
}

function emit(f, from, out, dur, n, total) {
  if (f.gizmos.length >= MAX_GIZMOS) { f.fx.push({ k: 'clog', cell: from }); return; }

  const [dx, dy] = DIRS[out.dir];
  const sx = cx(from) + 0.5, sy = cy(from) + 0.5;
  // Fan simultaneous outputs sideways so a burst reads as several pixels, not one.
  const spread = total > 1 ? (n / (total - 1) - 0.5) * 0.34 : 0;
  const ox = -dy * spread, oy = dx * spread;
  const nx = cx(from) + dx, ny = cy(from) + dy;
  const inside = inGrid(nx, ny);

  f.gizmos.push({
    id: f.nid++, ty: out.ty, st: 'fly',
    sx: sx + ox, sy: sy + oy, ex: sx + dx + ox, ey: sy + dy + oy,
    x: sx + ox, y: sy + oy,
    p: 0, dur: dur * (1 + n * 0.06),
    cell: inside ? cellOf(nx, ny) : -1,
    from, exit: inside ? null : out.dir,
  });
}

function arrive(f, g, k) {
  if (g.exit !== null) {
    const s = f.seller;
    if (s.cell === g.from && s.dir === g.exit) sell(f, g);
    else {
      f.lost++;
      f.fx.push({ k: 'lost', ty: g.ty, x: g.ex, y: g.ey });
    }
    f.gizmos.splice(k, 1);
    return;
  }

  const m = f.grid[g.cell];
  if (m && m.buf.length < intake(m)) { absorb(f, m, g, k); return; }

  let idle = 0;
  for (const o of f.gizmos) if (o.st === 'idle' && o.cell === g.cell) idle++;
  if (idle >= MAX_IDLE_PER_CELL) {
    f.fx.push({ k: 'clog', cell: g.cell });
    f.gizmos.splice(k, 1);
    return;
  }

  g.st = 'idle';
  g.p = 0;
  g.x = cx(g.cell) + 0.22 + Math.random() * 0.56;
  g.y = cy(g.cell) + 0.22 + Math.random() * 0.56;
}

function absorb(f, m, g, k) {
  m.buf.push({ id: g.id, ty: g.ty });
  f.gizmos.splice(k, 1);
}

function sell(f, g) {
  const v = Math.max(1, Math.round(TYPES[g.ty].value * sellerMult(f.seller.level)));
  f.cash += v;
  f.earned += v;
  f.income += v;
  f.sold++;
  f.seller.flash = 1;
  f.fx.push({ k: 'sell', v, ty: g.ty, cell: f.seller.cell, dir: f.seller.dir, x: g.ex, y: g.ey });
}

/* ----------------------------------------------------------------- rounds --- */

export function beginRound(f) {
  f.gizmos.length = 0;
  for (const m of f.grid) if (m) { m.buf.length = 0; m.t = 0; m.flash = 0; }
  f.producer.t = 0.35;
  f.income = 0;
  f.sold = 0;
  f.lost = 0;
  f.running = true;
}

export function endRound(f) {
  f.running = false;
  f.gizmos.length = 0;
  for (const m of f.grid) if (m) m.buf.length = 0;
}

/** Jump the seller to a different face of the floor. Returns the new spot. */
export function moveSeller(f, rnd = Math.random) {
  const spots = SELLER_SPOTS.filter(s => !(s.cell === f.seller.cell && s.dir === f.seller.dir));
  const pick = spots[Math.floor(rnd() * spots.length) % spots.length];
  f.seller.cell = pick.cell;
  f.seller.dir = pick.dir;
  return pick;
}

/* ---------------------------------------------------------------- actions --- */

/** Drop a bought machine onto the floor, or into the crate if the floor is full. */
export function giveMachine(f, spec) {
  const m = makeMachine(spec, f.nid++);
  const slot = f.grid.indexOf(null);
  if (slot >= 0) { f.grid[slot] = m; return { where: 'grid', idx: slot }; }
  if (f.inv.length < INV_CAP) { f.inv.push(m); return { where: 'inv', idx: f.inv.length - 1 }; }
  return { where: 'none', idx: -1 };
}

const okGrid = i => Number.isInteger(i) && i >= 0 && i < GRID * GRID;

/**
 * Apply one player action. Returns { ok, msg } — never throws on bad input,
 * because everything here arrives over the wire from a phone.
 */
export function applyAction(f, a) {
  if (!a || typeof a !== 'object') return no('Bad action');

  switch (a.a) {
    case 'rot': {
      if (!okGrid(a.i) || !f.grid[a.i]) return no('Nothing there');
      const m = f.grid[a.i];
      m.dir = (m.dir + 1) % 4;
      f.fx.push({ k: 'rot', cell: a.i });
      return yes();
    }

    case 'rotinv': {
      const m = f.inv[a.i];
      if (!m) return no('Nothing there');
      m.dir = (m.dir + 1) % 4;
      return yes();
    }

    case 'move': {
      // from / to are 'g0'..'g8' or 'i0'..'i7'
      const from = parseRef(f, a.from), to = parseRef(f, a.to);
      if (!from || !to) return no('Bad slot');
      if (from.zone === to.zone && from.idx === to.idx) return yes();

      const a1 = getRef(f, from), b1 = getRef(f, to);
      if (!a1) return no('Nothing to move');
      if (to.zone === 'inv' && !b1 && f.inv.length >= INV_CAP) return no('Crate is full');

      setRef(f, from, b1 || null);
      setRef(f, to, a1);
      compactInv(f);
      f.fx.push({ k: 'move', cell: to.zone === 'grid' ? to.idx : -1 });
      return yes();
    }

    case 'up': {
      const ref = parseRef(f, a.ref);
      const m = ref && getRef(f, ref);
      if (!m) return no('Nothing there');
      if (m.level >= MAX_LEVEL) return no('Already maxed');
      const c = upgradeCost(m);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      m.level++;
      m.flash = 1;
      f.fx.push({ k: 'up', cell: ref.zone === 'grid' ? ref.idx : -1 });
      return yes();
    }

    case 'scrap': {
      const ref = parseRef(f, a.ref);
      const m = ref && getRef(f, ref);
      if (!m) return no('Nothing there');
      const v = scrapValue(m);
      f.cash += v;
      setRef(f, ref, null);
      compactInv(f);
      f.fx.push({ k: 'scrap', cell: ref.zone === 'grid' ? ref.idx : -1, v });
      return yes(`+$${v}`);
    }

    case 'upprod': {
      if (f.producer.level >= MAX_UTIL) return no('Already maxed');
      const c = producerCost(f.producer.level);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      f.producer.level++;
      f.producer.flash = 1;
      f.fx.push({ k: 'upprod' });
      return yes();
    }

    case 'upsell': {
      if (f.seller.level >= MAX_UTIL) return no('Already maxed');
      const c = sellerCost(f.seller.level);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      f.seller.level++;
      f.seller.flash = 1;
      f.fx.push({ k: 'upsell' });
      return yes();
    }

    default:
      return no('Unknown action');
  }
}

const yes = msg => ({ ok: true, msg });
const no = msg => ({ ok: false, msg });

function parseRef(f, ref) {
  if (typeof ref !== 'string' || ref.length < 2) return null;
  const zone = ref[0] === 'g' ? 'grid' : ref[0] === 'i' ? 'inv' : null;
  const idx = parseInt(ref.slice(1), 10);
  if (!zone || Number.isNaN(idx) || idx < 0) return null;
  if (zone === 'grid' && !okGrid(idx)) return null;
  if (zone === 'inv' && idx > INV_CAP) return null;
  return { zone, idx };
}
const getRef = (f, r) => (r.zone === 'grid' ? f.grid[r.idx] : f.inv[r.idx]) || null;
function setRef(f, r, m) {
  if (r.zone === 'grid') f.grid[r.idx] = m;
  else if (m) f.inv[r.idx] = m;
  else f.inv[r.idx] = null;
}
function compactInv(f) {
  f.inv = f.inv.filter(Boolean).slice(0, INV_CAP);
}

/* ------------------------------------------------------------------- view --- */

const r2 = n => Math.round(n * 100) / 100;

/**
 * Compact render/wire view. The host draws from this and sends the same shape
 * to the owning phone, so both screens run one renderer.
 */
export function viewOf(f) {
  return {
    g: f.grid.map(m => m && {
      k: m.kind, d: m.dir, l: m.level, m: m.mut,
      b: m.buf.map(x => x.ty),
      p: r2(1 - Math.max(0, m.t) / cycleTime(m)),
      f: r2(m.flash),
    }),
    v: f.inv.map(m => ({ k: m.kind, d: m.dir, l: m.level, m: m.mut })),
    z: f.gizmos.map(g => [g.id, g.ty, r2(g.x), r2(g.y)]),
    pl: f.producer.level, pf: r2(f.producer.flash || 0),
    sl: f.seller.level, sc: f.seller.cell, sd: f.seller.dir, sf: r2(f.seller.flash || 0),
    c: Math.round(f.cash), e: Math.round(f.earned), n: Math.round(f.income),
  };
}

export function drainFx(f, cap = 24) {
  const out = f.fx.slice(0, cap);
  f.fx.length = 0;
  return out;
}

export { MAX_IDLE_PER_CELL, INV_CAP };
