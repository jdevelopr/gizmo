/**
 * sim.js — the factory simulation. Pure logic, no DOM and no network.
 *
 * The host owns one Factory per player and steps them all. Clients never run
 * this; they render the view the host sends. Practice mode runs it locally.
 */

import {
  GRID, DIRS, TYPES, MAX_TYPE, KINDS, MAX_LEVEL, MAX_UTIL,
  makeMachine, price, upgradeCost, scrapValue, cycleTime, travelTime,
  intake, outputs, exitDirs, sizeOf, capacity, EMPTY_HOLD,
  producerCycle, producerCost, sellerMult, sellerCost,
  cellOf, cx, cy, inGrid, PRODUCER_PORT, SELLER_SPOTS,
} from './machines.js';

const INV_CAP = 8;
const EPS = 1e-6;
const MAX_SELLERS = 2;

/** Hard ceiling on live gizmos: enough to fill a floor, few enough to send 15x a second. */
const maxGizmos = () => Math.min(400, 24 * GRID * GRID + 60);

export function createFactory({ cash = 120 } = {}) {
  const f = {
    n: GRID,
    grid: new Array(GRID * GRID).fill(null),
    inv: [],
    producer: { level: 1, t: 0 },
    // One shared level, one or more vaults. A second vault opens halfway through
    // the match, which is the point at which routing to two places is worth a Splitter.
    seller: { level: 1, spots: [{ cell: 2, dir: 0, flash: 0 }] },
    gizmos: [],
    load: new Float64Array(GRID * GRID),   // gizmo units resting on or flying to each slot
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
 * The starting line: producer -> doubler -> conveyors -> seller, filling the top
 * row whatever the floor size. Round one therefore earns money untouched at every
 * board size, and every round after it breaks when the seller jumps somewhere else.
 */
export function starterKit(f) {
  place(f, makeMachine({ kind: 'dup', dir: 0 }, f.nid++), 0);
  for (let i = 1; i < GRID; i++) place(f, makeMachine({ kind: 'pipe', dir: 0 }, f.nid++), i);
  f.seller.spots = [{ cell: GRID - 1, dir: 0, flash: 0 }];
}

function place(f, m, i) { f.grid[i] = m; }

/* ---------------------------------------------------------------- capacity --- */

/**
 * Nothing on this floor is ever destroyed. A machine that cannot hand its results
 * on keeps holding them, which fills it, which turns its own feeder away, and so on
 * back up the line until the producer itself has nowhere to drop a gizmo and stops.
 * That is the whole mechanic; these three functions are all of it.
 */

/**
 * What a machine is physically holding right now. For the first half of a cycle
 * that is what went in; past halfway the work is done and it is holding the result.
 * The accounting and the picture on screen read from this same function, so what
 * you see in a machine's window is exactly what is taking up its room.
 */
function contents(m) {
  if (!m.work.length) return [];
  if (!m.out?.length) return m.work;
  const cyc = cycleTime(m) || 1;
  return (1 - Math.max(0, m.t) / cyc) >= 0.5 ? m.out : m.work;
}

/** Units inside one machine — in its hands and queued at its mouth. */
function machineLoad(m) {
  let n = 0;
  for (const g of contents(m)) n += sizeOf(g.ty);
  for (const g of m.buf) n += sizeOf(g.ty);
  return n;
}

/** Units a slot can take: the machine's room, or bare floor if there is none. */
function slotCap(f, i) {
  const m = f.grid[i];
  return m ? capacity(m) : EMPTY_HOLD;
}

/**
 * Units already spoken for at a slot: what the machine holds, plus everything
 * resting on it or already in the air toward it. Counting gizmos in flight is what
 * stops two machines from both firing into the last free space.
 */
function slotLoad(f, i) {
  const m = f.grid[i];
  return (f.load[i] || 0) + (m ? machineLoad(m) : 0);
}

/** Is there room at slot `i` for one gizmo of this type? */
function canAccept(f, i, ty) {
  return slotLoad(f, i) + sizeOf(ty) <= slotCap(f, i) + EPS;
}

/** Recount what is resting on or flying to every slot. One pass per tick. */
function retally(f) {
  if (f.load.length !== f.grid.length) f.load = new Float64Array(f.grid.length);
  else f.load.fill(0);
  for (const g of f.gizmos) if (g.cell >= 0) f.load[g.cell] += sizeOf(g.ty);
}

/* -------------------------------------------------------------------- step --- */

export function stepFactory(f, dt) {
  if (dt > 0.1) dt = 0.1;   // a backgrounded tab must not fast-forward the floor

  retally(f);

  if (f.running) {
    f.producer.t -= dt;
    if (f.producer.t <= 0) {
      // The far end of the jam. With nowhere to put the next gizmo the producer
      // simply waits at the gate rather than shovelling into a full floor.
      if (canAccept(f, PRODUCER_PORT.cell, 0)) {
        f.producer.t += producerCycle(f.producer.level);
        f.producer.stall = 0;
        spawnFromProducer(f);
      } else {
        f.producer.t = 0;
        f.producer.stall = 1;
      }
    }
    for (let i = 0; i < f.grid.length; i++) {
      const m = f.grid[i];
      if (!m) continue;
      if (m.work.length) {
        m.t -= dt;
        if (m.t <= 0) release(f, m, i);
      }
      // A machine that just let go can pick the next job up in the same tick, so
      // a fed line still runs at one job per cycle. It is never empty-handed for
      // long — it is the gizmo that is slower now, not the floor.
      if (!m.work.length) startJob(f, m, i);
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
      if (m && machineLoad(m) + sizeOf(g.ty) <= capacity(m) + EPS) absorb(f, m, g, k);
    }
  }

  for (const m of f.grid) if (m && m.flash > 0) m.flash = Math.max(0, m.flash - dt * 5);
  if (f.producer.flash > 0) f.producer.flash = Math.max(0, f.producer.flash - dt * 5);
  for (const v of f.seller.spots) if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 4);
}

function spawnFromProducer(f) {
  if (f.gizmos.length >= maxGizmos()) return;
  f.producer.flash = 1;
  const { cell } = PRODUCER_PORT;
  const ex = cx(cell) + 0.5, ey = cy(cell) + 0.5;
  f.gizmos.push({
    id: f.nid++, ty: 0, cp: 0, st: 'fly',
    sx: ex - 1, sy: ey, ex, ey, x: ex - 1, y: ey,
    p: 0, dur: 0.6, cell, from: -1, exit: null,
  });
  f.fx.push({ k: 'spawn', cell });
}

/**
 * Take custody. The machine pulls its intake off the queue and holds it — the
 * gizmos are off the floor and inside the casing until the cycle is done. What
 * the job will produce is decided here, at the start, so a router's round-robin
 * cursor advances once per job rather than once per look.
 */
function startJob(f, m, i) {
  const need = intake(m);
  if (m.buf.length < need) { m.t = 0; return; }

  m.work = m.buf.splice(0, need);
  m.out = outputs(m, m.work);
  m.t = cycleTime(m);
}

/**
 * Let go — but only of what the far side has room for. Anything the next slot
 * cannot take stays in the machine's hands and is offered again next tick, so the
 * machine sits there visibly full instead of forcing gizmos into a jam. Outputs are
 * offered one at a time, so a Splitter with one blocked exit still works the other.
 */
function release(f, m, i) {
  const outs = m.out || [];
  const stay = [];
  const sent = [];

  for (const o of outs) {
    const nx = cx(i) + DIRS[o.dir][0], ny = cy(i) + DIRS[o.dir][1];
    if (inGrid(nx, ny)) {
      const to = cellOf(nx, ny);
      if (!canAccept(f, to, o.ty)) { stay.push(o); continue; }
      f.load[to] += sizeOf(o.ty);        // claim the space now, before it flies
    }
    sent.push(o);
  }

  if (sent.length) {
    m.flash = 1;
    f.fx.push({
      k: 'fire', cell: i, kind: m.kind,
      ty: sent[0].ty, n: sent.length,
    });
    const dur = travelTime(m);
    sent.forEach((o, n) => emit(f, i, o, dur, n, sent.length));
  }

  m.t = 0;
  if (stay.length) {
    // Blocked. Keep holding, and say so once rather than every frame.
    if (!m.blocked) f.fx.push({ k: 'clog', cell: i });
    m.blocked = 1;
    m.out = stay;
    return;
  }
  m.blocked = 0;
  m.work = [];
  m.out = null;
}

/** The held cargo, as types, for the renderer. */
const heldTypes = m => contents(m).map(g => g.ty);

function emit(f, from, out, dur, n, total) {
  if (f.gizmos.length >= maxGizmos()) { f.fx.push({ k: 'clog', cell: from }); return; }

  const [dx, dy] = DIRS[out.dir];
  const sx = cx(from) + 0.5, sy = cy(from) + 0.5;
  // Fan simultaneous outputs sideways so a burst reads as several pixels, not one.
  const spread = total > 1 ? (n / (total - 1) - 0.5) * 0.34 : 0;
  const ox = -dy * spread, oy = dx * spread;
  const nx = cx(from) + dx, ny = cy(from) + dy;
  const inside = inGrid(nx, ny);

  f.gizmos.push({
    id: f.nid++, ty: out.ty, cp: out.cp ? 1 : 0, st: 'fly',
    sx: sx + ox, sy: sy + oy, ex: sx + dx + ox, ey: sy + dy + oy,
    x: sx + ox, y: sy + oy,
    p: 0, dur: dur * (1 + n * 0.06),
    cell: inside ? cellOf(nx, ny) : -1,
    from, exit: inside ? null : out.dir,
  });
}

function arrive(f, g, k) {
  if (g.exit !== null) {
    const vault = f.seller.spots.find(v => v.cell === g.from && v.dir === g.exit);
    if (vault) sell(f, g, vault);
    else {
      f.lost++;
      f.fx.push({ k: 'lost', ty: g.ty, x: g.ex, y: g.ey });
    }
    f.gizmos.splice(k, 1);
    return;
  }

  const m = f.grid[g.cell];
  if (m && machineLoad(m) + sizeOf(g.ty) <= capacity(m) + EPS) { absorb(f, m, g, k); return; }

  // Nothing on the floor is ever destroyed: it rests on the slot, counts against
  // that slot's room, and so turns the machine behind it away.
  g.st = 'idle';
  g.p = 0;
  g.x = cx(g.cell) + 0.22 + Math.random() * 0.56;
  g.y = cy(g.cell) + 0.22 + Math.random() * 0.56;
}

function absorb(f, m, g, k) {
  m.buf.push({ id: g.id, ty: g.ty, cp: g.cp | 0 });
  f.gizmos.splice(k, 1);
}

function sell(f, g, vault) {
  const v = Math.max(1, Math.round(TYPES[g.ty].value * sellerMult(f.seller.level)));
  f.cash += v;
  f.earned += v;
  f.income += v;
  f.sold++;
  vault.flash = 1;
  f.fx.push({ k: 'sell', v, ty: g.ty, cell: vault.cell, dir: vault.dir, x: g.ex, y: g.ey });
}

/* ----------------------------------------------------------------- rounds --- */

export function beginRound(f) {
  f.gizmos.length = 0;
  for (const m of f.grid) if (m) {
    m.buf.length = 0; m.work.length = 0; m.out = null; m.t = 0; m.flash = 0; m.blocked = 0;
  }
  retally(f);
  f.producer.t = 0.7;
  f.producer.stall = 0;
  f.income = 0;
  f.sold = 0;
  f.lost = 0;
  f.running = true;
}

export function endRound(f) {
  f.running = false;
  f.gizmos.length = 0;
  for (const m of f.grid) if (m) {
    m.buf.length = 0; m.work.length = 0; m.out = null; m.t = 0; m.blocked = 0;
  }
  f.producer.stall = 0;
  retally(f);
}

const key = s => `${s.cell}:${s.dir}`;
const draw = (pool, rnd) => pool[Math.floor(rnd() * pool.length) % pool.length];

/**
 * Jump every vault to a face it was not on last round. With two vaults open they
 * are pushed onto different edges where possible, so the round's problem is
 * genuinely "feed two places at once" rather than "feed two adjacent slots".
 * @returns {Array<{cell:number,dir:number}>} the new spots, in vault order
 */
export function moveSeller(f, rnd = Math.random) {
  const was = new Set(f.seller.spots.map(key));
  const taken = new Set();
  const dirs = new Set();

  for (const v of f.seller.spots) {
    const free = SELLER_SPOTS.filter(o => !taken.has(key(o)));
    const fresh = free.filter(o => !was.has(key(o)));
    const spread = fresh.filter(o => !dirs.has(o.dir));
    const pick = draw(spread.length ? spread : fresh.length ? fresh : free, rnd);
    v.cell = pick.cell;
    v.dir = pick.dir;
    taken.add(key(pick));
    dirs.add(pick.dir);
  }
  return f.seller.spots.map(v => ({ cell: v.cell, dir: v.dir }));
}

/**
 * Force a floor's vaults to sit exactly where these spots say. The engine draws the
 * round's spots once and stamps them onto every player, so a match is the same
 * puzzle for everyone — nobody wins on a kinder roll.
 */
export function setSellerSpots(f, spots) {
  if (!spots?.length) return;
  f.seller.spots = spots.map((v, i) => ({
    cell: v.cell, dir: v.dir, flash: f.seller.spots[i]?.flash || 0,
  }));
}

/**
 * Open one more vault, on a different edge from the ones already trading.
 * @returns {{cell:number,dir:number}|null} null if the floor already has it
 */
export function addSeller(f, rnd = Math.random) {
  if (f.seller.spots.length >= MAX_SELLERS) return null;
  const taken = new Set(f.seller.spots.map(key));
  const dirs = new Set(f.seller.spots.map(v => v.dir));
  const free = SELLER_SPOTS.filter(o => !taken.has(key(o)));
  const spread = free.filter(o => !dirs.has(o.dir));
  const pick = draw(spread.length ? spread : free, rnd);
  f.seller.spots.push({ cell: pick.cell, dir: pick.dir, flash: 0 });
  return { cell: pick.cell, dir: pick.dir };
}

/* ----------------------------------------------------------- auto-facing --- */

/**
 * Conveyors are plumbing, and nobody enjoys plumbing. A belt dropped on the
 * floor points itself down the line so the common case — lay a run of conveyors
 * from the machines to wherever the seller jumped — costs taps instead of a
 * rotate on every single slot. ROTATE still overrides it; this only ever fires
 * the moment a belt lands on a slot.
 *
 * The pick is the best-scoring of the four directions:
 *   +  carries the gizmo nearer the seller (and out of its window, if we are on it)
 *   +  continues the flow of whatever already feeds this slot
 *   +  hands off to a neighbouring machine rather than the bare floor
 *   -  fires back into the machine feeding us, or head-on into one facing us
 *   -  spills off the edge of the floor anywhere but the seller's window
 */
export function smartDir(f, i) {
  const m = f.grid[i];
  if (!m || (m.kind !== 'pipe' && m.kind !== 'store')) return null;

  const x = cx(i), y = cy(i);
  // With two vaults open, a belt aims at whichever one is nearer to it. That is
  // what makes a split line settle into two arms instead of one long detour.
  const dist = (ax, ay, v) => Math.abs(ax - cx(v.cell)) + Math.abs(ay - cy(v.cell));
  const s = f.seller.spots.reduce((a, b) => (dist(x, y, b) < dist(x, y, a) ? b : a));
  const gap = (ax, ay) => dist(ax, ay, s);
  const here = gap(x, y);

  // Directions we are fed from: the neighbour that way aims at us. The producer
  // is bolted to the floor's edge and counts as a feeder too.
  const fed = new Set();
  if (i === PRODUCER_PORT.cell) fed.add(PRODUCER_PORT.dir);
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    if (!inGrid(nx, ny)) continue;
    const nm = f.grid[cellOf(nx, ny)];
    if (nm && exitDirs(nm).includes((d + 2) % 4)) fed.add(d);
  }

  // When the seller sits off both axes, walk the longer leg first so an L-shaped
  // run reads as one straight line with a single corner.
  const longLeg = Math.abs(x - cx(s.cell)) >= Math.abs(y - cy(s.cell)) ? 'x' : 'y';

  let best = m.dir, bestScore = -Infinity;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    let score = 0;

    if (!inGrid(nx, ny)) {
      // Off the floor is a loss, unless it is some vault's window.
      score += f.seller.spots.some(v => v.cell === i && v.dir === d) ? 100 : -100;
    } else {
      const closer = here - gap(nx, ny);
      score += closer * 10;
      const nm = f.grid[cellOf(nx, ny)];
      if (nm) score += exitDirs(nm).includes((d + 2) % 4) ? -14 : 6;
      if (closer > 0 && (DIRS[d][0] !== 0 ? 'x' : 'y') === longLeg) score += 2;
    }

    if (fed.has(d)) score -= 30;                 // never shove it back at the feeder
    if (fed.has((d + 2) % 4)) score += 8;        // keep the existing flow straight
    if (d === m.dir) score += 1;                 // ties keep whatever it already had

    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** Face a freshly landed belt or Storage down the line. No-op for anything else. */
function autoFace(f, i) {
  const d = smartDir(f, i);
  if (d != null && d !== f.grid[i].dir) {
    f.grid[i].dir = d;
    f.fx.push({ k: 'rot', cell: i });
  }
}

/* ---------------------------------------------------------------- actions --- */

/** Drop a bought machine onto the floor, or into the crate if the floor is full. */
export function giveMachine(f, spec) {
  const m = makeMachine(spec, f.nid++);
  const slot = f.grid.indexOf(null);
  if (slot >= 0) { f.grid[slot] = m; autoFace(f, slot); return { where: 'grid', idx: slot }; }
  if (f.inv.length < INV_CAP) { f.inv.push(m); return { where: 'inv', idx: f.inv.length - 1 }; }
  return { where: 'none', idx: -1 };
}

const okGrid = (f, i) => Number.isInteger(i) && i >= 0 && i < f.grid.length;

/**
 * Apply one player action. Returns { ok, msg } — never throws on bad input,
 * because everything here arrives over the wire from a phone.
 */
export function applyAction(f, a) {
  if (!a || typeof a !== 'object') return no('Bad action');

  switch (a.a) {
    case 'rot': {
      if (!okGrid(f, a.i) || !f.grid[a.i]) return no('Nothing there');
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
      // Both ends of a swap just landed on new ground: re-face any belt among them.
      if (to.zone === 'grid') autoFace(f, to.idx);
      if (from.zone === 'grid' && b1) autoFace(f, from.idx);
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
      for (const v of f.seller.spots) v.flash = 1;
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
  if (zone === 'grid' && !okGrid(f, idx)) return null;
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
      b: m.buf.map(x => x.ty),                                  // queued at the mouth
      h: heldTypes(m),                                          // in hand right now
      q: r2(machineLoad(m)), c: capacity(m),                    // how full, out of how much
      x: m.blocked ? 1 : 0,                                     // holding, nowhere to put it
      p: m.work.length ? r2(1 - Math.max(0, m.t) / cycleTime(m)) : 0,
      f: r2(m.flash),
    }),
    v: f.inv.map(m => ({ k: m.kind, d: m.dir, l: m.level, m: m.mut })),
    z: f.gizmos.map(g => [g.id, g.ty, r2(g.x), r2(g.y), g.cp | 0]),
    pl: f.producer.level, pf: r2(f.producer.flash || 0), px: f.producer.stall ? 1 : 0,
    sl: f.seller.level,
    sv: f.seller.spots.map(v => [v.cell, v.dir, r2(v.flash || 0)]),
    c: Math.round(f.cash), e: Math.round(f.earned), n: Math.round(f.income),
  };
}

export function drainFx(f, cap = 24) {
  const out = f.fx.slice(0, cap);
  f.fx.length = 0;
  return out;
}

export { INV_CAP, MAX_SELLERS, maxGizmos };
