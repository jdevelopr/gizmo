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
  cellOf, cx, cy, inClaim, claimed, claimCells,
  CLAIM_START, expandCost,
  balDirs, REROUTES, wants, SCIENCE_RATE, techById, techOpen, levelCap,
  generatePlot, faceCell, OPEN, RUBBLE, RUBBLE_COST, SECOND_VAULT_CLAIM,
} from './machines.js';

const INV_CAP = 8;
const EPS = 1e-6;

/** Hard ceiling on live gizmos: enough to fill a floor, few enough to send 15x a second. */
const maxGizmos = () => Math.min(400, 24 * GRID * GRID + 60);

/* ------------------------------------------------------------------ plot --- */

/** Where this layout's feeds enter, at this claim. */
export function portsOf(f) {
  return f.layout.feeds
    .filter(p => f.claim >= (p.claim || 0))
    .map(p => ({ ...p, cell: cellOf(0, Math.min(p.row, f.claim - 1)), dir: 2 }));
}

/** Where this layout's vaults trade from, at this claim. */
export function vaultsOf(f) {
  const n = f.claim >= SECOND_VAULT_CLAIM ? 2 : 1;
  return f.layout.spots.slice(0, n)
    .map(sp => ({ cell: faceCell(sp.face, sp.along, f.claim), dir: sp.face }));
}

/** Where this layout's Lab trades from, at this claim. */
export function labOf(f) {
  const sp = f.layout.lab;
  return { cell: faceCell(sp.face, sp.along, f.claim), dir: sp.face };
}

/** Is this slot owned, and is there nothing lying on it? */
export const openAt = (f, x, y) =>
  inClaim(x, y, f.claim) && f.terrain[cellOf(x, y)] === OPEN;

export function createFactory({ cash = 120, claim = CLAIM_START, layout = null } = {}) {
  const f = {
    n: GRID,
    // The plot is always the full board. `claim` is how much of it you own — the
    // side length of the square you have bought, anchored top-left. Slots outside
    // it exist in the array and are never touched, which is why growing the claim
    // costs nothing to the simulation: no machine moves and no index changes.
    claim: Math.max(CLAIM_START, Math.min(GRID, claim)),
    // The plot: what is lying on each slot, and where the fixtures trade from.
    // Everyone in a match is handed the same one — a generated map that differed
    // per player would put "nobody wins on a kinder roll" straight back in the bin.
    layout: layout || generatePlot(1, GRID, CLAIM_START),
    terrain: null,
    grid: new Array(GRID * GRID).fill(null),
    inv: [],
    // One level, one or more feeds. Producer A drops Scrap from the first round;
    // Producer B drops Resin once the claim is wide enough to route two lines.
    producer: { level: 1, ts: [0, 0], flash: [0, 0], stall: [0, 0] },
    // One shared level, one or more vaults, welded to the east face of the claim.
    // They ride outward when you buy land and never move otherwise.
    seller: { level: 1, spots: [] },
    // The Lab. Not a machine and not a slot — a port on the fence, like a vault,
    // that pays in science instead of money.
    lab: { cell: 0, dir: 3, flash: 0 },
    science: 0,
    spent: 0,
    done: [],        // finished research, by id
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
    expansions: 0,
  };
  f.terrain = Uint8Array.from(f.layout.terrain);
  f.seller.spots = vaultsOf(f).map(v => ({ ...v, flash: 0 }));
  f.lab = { ...labOf(f), flash: 0 };
  return f;
}

/**
 * The starting line: a belt run from the first feed to the first vault, laid along
 * whatever route this map allows. Nothing but plumbing, which is the point — it
 * moves raw Scrap at a dollar a piece and that is all, and the first Mutator you
 * buy triples it.
 *
 * It used to be "fill the top row", which was right exactly once: when the feed was
 * always west of row 0 and the vault always east of it. On a generated plot the two
 * can be anywhere on the fence with rubble in between, so the kit is pathfound.
 * Round one still teaches the loop; it teaches it on this map.
 */
export function starterKit(f) {
  f.seller.spots = vaultsOf(f).map(v => ({ ...v, flash: 0 }));
  f.lab = { ...labOf(f), flash: 0 };
  const from = portsOf(f)[0];
  const vault = f.seller.spots[0];
  const path = routeBetween(f, from.cell, vault.cell);
  for (let k = 0; k < path.length; k++) {
    const cell = path[k];
    const next = path[k + 1];
    const dir = next == null ? vault.dir
      : DIRS.findIndex(([dx, dy]) => cx(cell) + dx === cx(next) && cy(cell) + dy === cy(next));
    place(f, makeMachine({ kind: 'pipe', dir: dir < 0 ? 0 : dir }, f.nid++), cell);
  }
}

/**
 * The shortest way from one slot to another over open ground, both ends included.
 * Breadth-first, so it is the shortest there is.
 * @returns {number[]} empty if there is no way through
 */
export function routeBetween(f, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    for (let d = 0; d < 4; d++) {
      const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
      if (!openAt(f, nx, ny)) continue;
      const n = cellOf(nx, ny);
      if (prev.has(n)) continue;
      prev.set(n, at);
      if (n === to) {
        const path = [];
        for (let c = to; c !== -1; c = prev.get(c)) path.push(c);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return [];
}

/**
 * Buy one ring of land. The claim grows by a side, the vaults ride out to the new
 * east face, and nothing else in the factory is disturbed — every machine keeps
 * its slot and its facing, and the line that was running keeps running. All it
 * needs is a belt or two to reach the fence in its new position.
 *
 * Only safe between rounds, when the floor has been drained of gizmos: a gizmo in
 * flight toward the old vault would otherwise be sold into thin air.
 *
 * @returns {number} the claim after growing
 */
export function expandFloor(f) {
  if (f.claim >= GRID) return f.claim;
  f.claim++;
  f.expansions = (f.expansions || 0) + 1;
  const want = vaultsOf(f);
  f.seller.spots = want.map((v, i) => ({ ...v, flash: f.seller.spots[i]?.flash || 0 }));
  f.lab = { ...labOf(f), flash: f.lab?.flash || 0 };
  f.fx.push({ k: 'grow', claim: f.claim });
  return f.claim;
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

/**
 * Will slot `i` take one gizmo of this type — is there room, and does whatever is
 * standing there want it? An Assembler that already holds a Cord says no to a
 * second one, and the belt behind it backs up rather than jamming it shut.
 */
function canAccept(f, i, ty) {
  const m = f.grid[i];
  if (m && !wants(m, ty)) return false;
  return slotLoad(f, i) + sizeOf(ty) <= slotCap(f, i) + EPS;
}

/** The same question asked of a machine directly, for a gizmo already on its slot. */
const machineTakes = (m, ty) =>
  wants(m, ty) && machineLoad(m) + sizeOf(ty) <= capacity(m) + EPS;

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
    const ports = portsOf(f);
    for (let k = 0; k < ports.length; k++) {
      const port = ports[k];
      f.producer.ts[k] -= dt;
      if (f.producer.ts[k] > 0) continue;
      // The far end of the jam. With nowhere to put the next gizmo a producer
      // simply waits at the gate rather than shovelling into a full floor. Each
      // feed stalls on its own, so a blocked Resin line never stops the Scrap.
      if (canAccept(f, port.cell, port.ty)) {
        f.producer.ts[k] += producerCycle(f.producer.level);
        f.producer.stall[k] = 0;
        spawnFromProducer(f, port, k);
      } else {
        f.producer.ts[k] = 0;
        f.producer.stall[k] = 1;
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
      if (m && machineTakes(m, g.ty)) absorb(f, m, g, k);
    }
  }

  for (const m of f.grid) if (m && m.flash > 0) m.flash = Math.max(0, m.flash - dt * 5);
  for (let k = 0; k < f.producer.flash.length; k++) {
    if (f.producer.flash[k] > 0) f.producer.flash[k] = Math.max(0, f.producer.flash[k] - dt * 5);
  }
  for (const v of f.seller.spots) if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 4);
  if (f.lab.flash > 0) f.lab.flash = Math.max(0, f.lab.flash - dt * 4);
}

function spawnFromProducer(f, port, k) {
  if (f.gizmos.length >= maxGizmos()) return;
  f.producer.flash[k] = 1;
  const { cell, ty } = port;
  const ex = cx(cell) + 0.5, ey = cy(cell) + 0.5;
  f.gizmos.push({
    id: f.nid++, ty, cp: 0, st: 'fly',
    sx: ex - 1, sy: ey, ex, ey, x: ex - 1, y: ey,
    p: 0, dur: 0.6, cell, from: -1, exit: null,
  });
  f.fx.push({ k: 'spawn', cell, ty });
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
 * offered one at a time, so a Trident with one blocked exit still works the others.
 */
/**
 * Where one output actually goes.
 *
 * Most machines have exactly one answer and hold on when it is full. A Balancer is
 * the exception: it promised to divide a stream, and a divider that stalls because
 * one arm happens to be busy is not dividing anything — so it tries its other
 * exits, starting from the one the round-robin picked. Leaving the claim always
 * counts as available: that is either a vault or a loss, and neither backs up.
 *
 * @returns {number|null} the direction to fire, or null if every exit is full
 */
function pickExit(f, i, m, o) {
  let cands = [o.dir];
  if (REROUTES.has(m.kind)) {
    const all = balDirs(m);
    const at = Math.max(0, all.indexOf(o.dir));
    cands = all.slice(at).concat(all.slice(0, at));
  }
  for (const d of cands) {
    const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
    if (!openAt(f, nx, ny)) return d;      // off the claim, or blocked: it leaves
    if (canAccept(f, cellOf(nx, ny), o.ty)) return d;
  }
  return null;
}

function release(f, m, i) {
  const outs = m.out || [];
  const stay = [];
  const sent = [];

  for (const o of outs) {
    const d = pickExit(f, i, m, o);
    if (d == null) { stay.push(o); continue; }
    o.dir = d;
    const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
    if (openAt(f, nx, ny)) {
      f.load[cellOf(nx, ny)] += sizeOf(o.ty);   // claim the space now, before it flies
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
  const inside = openAt(f, nx, ny);

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
    else if (f.lab.cell === g.from && f.lab.dir === g.exit) study(f, g);
    else {
      f.lost++;
      f.fx.push({ k: 'lost', ty: g.ty, x: g.ex, y: g.ey });
    }
    f.gizmos.splice(k, 1);
    return;
  }

  const m = f.grid[g.cell];
  if (m && machineTakes(m, g.ty)) { absorb(f, m, g, k); return; }

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

/**
 * Into the Lab. A gizmo is worth exactly what a vault would have paid for it, so
 * the only cost of research is the money you chose not to take — and the rate is
 * set by what the floor can actually make, not by what is in the bank.
 */
function study(f, g) {
  const v = Math.max(1, Math.round(TYPES[g.ty].value * SCIENCE_RATE));
  f.science += v;
  f.lab.flash = 1;
  f.fx.push({ k: 'sci', v, ty: g.ty, cell: f.lab.cell, dir: f.lab.dir, x: g.ex, y: g.ey });
}

/**
 * Spend science on one node. Research is permanent and survives every round, which
 * is the point: it is the one thing you buy that a bad round cannot take back.
 * @returns {{ok:boolean,msg?:string}}
 */
export function research(f, id) {
  const t = techById(id);
  if (!t) return { ok: false, msg: 'No such research' };
  if (f.done.includes(id)) return { ok: false, msg: 'Already known' };
  if (!techOpen(t, f.done)) return { ok: false, msg: 'Needs earlier research' };
  if (f.science < t.cost) return { ok: false, msg: `Needs ${t.cost} science` };
  f.science -= t.cost;
  f.spent += t.cost;
  f.done.push(id);
  f.fx.push({ k: 'tech', name: t.name });
  return { ok: true, msg: `${t.name} complete` };
}

/* ----------------------------------------------------------------- rounds --- */

export function beginRound(f) {
  f.gizmos.length = 0;
  for (const m of f.grid) if (m) {
    m.buf.length = 0; m.work.length = 0; m.out = null; m.t = 0; m.flash = 0; m.blocked = 0;
  }
  retally(f);
  f.producer.ts = f.producer.ts.map(() => 0.7);
  f.producer.stall = f.producer.stall.map(() => 0);
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
  f.producer.stall = f.producer.stall.map(() => 0);
  retally(f);
}

/**
 * Force a floor's vaults to sit exactly where these spots say. Vaults are derived
 * from the claim now, so this is only used when a phone or a rejoining player has
 * to be brought into line with what the engine believes.
 */
export function setSellerSpots(f, spots) {
  if (!spots?.length) return;
  f.seller.spots = spots.map((v, i) => ({
    cell: v.cell, dir: v.dir, flash: f.seller.spots[i]?.flash || 0,
  }));
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
/** Machines that aim themselves when set down: the routing family, plus Storage. */
const AUTO_FACE = new Set(['pipe', 'store', 'bal', 'sort']);

export function smartDir(f, i) {
  const m = f.grid[i];
  if (!m || !AUTO_FACE.has(m.kind)) return null;

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
  for (const port of portsOf(f)) if (port.cell === i) fed.add(port.dir);
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    if (!openAt(f, nx, ny)) continue;
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

    if (!openAt(f, nx, ny)) {
      // Off the claim, or blocked, is a loss unless it is some vault's window.
      // Unbought land and bedrock are exactly as fatal as the edge of the world,
      // which is what stops a belt from politely aiming into either.
      // A vault is the obvious place to aim; the Lab is a real destination too,
      // just not the one a belt should choose on its own.
      score += f.seller.spots.some(v => v.cell === i && v.dir === d) ? 100
        : (f.lab.cell === i && f.lab.dir === d) ? 30 : -100;
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

/**
 * Face a freshly landed routing machine down the line, and — if it branches — put
 * that branch on a side that exists. A Balancer dropped on the top row would
 * otherwise aim half its output at the sky; flipping it is free and is what you
 * were going to do anyway.
 */
function autoFace(f, i) {
  const m = f.grid[i];
  const d = smartDir(f, i);
  if (d != null && d !== m.dir) {
    m.dir = d;
    f.fx.push({ k: 'rot', cell: i });
  }
  if (m.kind !== 'bal' && m.kind !== 'sort') return;
  const open = side => {
    const dd = ((m.dir | 0) + side) % 4;
    const nx = cx(i) + DIRS[dd][0], ny = cy(i) + DIRS[dd][1];
    // A vault or the Lab counts as open: firing off the claim there is the point.
    if (!openAt(f, nx, ny)) {
      return f.seller.spots.some(v => v.cell === i && v.dir === dd)
        || (f.lab.cell === i && f.lab.dir === dd);
    }
    return true;
  };
  if (!open(1) && open(3)) m.mir = 1;
  else if (!open(3) && open(1)) m.mir = 0;
}

/* ---------------------------------------------------------------- actions --- */

/** Drop a bought machine onto owned land, or into the crate if there is none free. */
export function giveMachine(f, spec) {
  const m = makeMachine(spec, f.nid++);
  const slot = claimCells(f.claim).find(i => !f.grid[i] && f.terrain[i] === OPEN);
  if (slot != null) { f.grid[slot] = m; autoFace(f, slot); return { where: 'grid', idx: slot }; }
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
      if (to.zone === 'grid' && !claimed(to.idx, f.claim)) return no('You do not own that land');
      if (to.zone === 'grid' && f.terrain[to.idx] !== OPEN) return no('Something is in the way');
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
      const cap = levelCap(f.done);
      if (m.level >= cap) {
        return no(cap < MAX_LEVEL ? 'Overclocking would raise this' : 'Already maxed');
      }
      const c = upgradeCost(m);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      m.level++;
      m.flash = 1;
      f.fx.push({ k: 'up', cell: ref.zone === 'grid' ? ref.idx : -1 });
      return yes();
    }

    /**
     * Clear a slot of rubble. Bedrock is the shape of the plot and never moves —
     * routing around it is the map's whole contribution to the game.
     */
    case 'clear': {
      const i = a.i;
      if (!okGrid(f, i)) return no('Nothing there');
      if (!claimed(i, f.claim)) return no('You do not own that land');
      if (f.terrain[i] !== RUBBLE) {
        return no(f.terrain[i] === OPEN ? 'Nothing to clear' : 'Bedrock will not move');
      }
      if (f.cash < RUBBLE_COST) return no(`Clearing costs $${RUBBLE_COST}`);
      f.cash -= RUBBLE_COST;
      f.terrain[i] = OPEN;
      f.fx.push({ k: 'clear', cell: i });
      return yes('Cleared');
    }

    /**
     * Put a router's branch on the other side. Rotating would move it too, but it
     * would also move the through line — and the through line is usually the part
     * you had already got right.
     */
    case 'mir': {
      const ref = parseRef(f, a.ref);
      const m = ref && getRef(f, ref);
      if (!m) return no('Nothing there');
      if (m.kind !== 'bal' && m.kind !== 'sort') return no('Nothing to flip');
      m.mir = m.mir ? 0 : 1;
      f.fx.push({ k: 'rot', cell: ref.zone === 'grid' ? ref.idx : -1 });
      return yes(m.mir ? 'Branching left' : 'Branching right');
    }

    /**
     * Retune a Sorter. Its filter is the machine's whole personality and the right
     * answer changes as a floor grows, so unlike a Mutator's tier — which is bought
     * and fixed — this one cycles freely, for nothing, like rotating.
     */
    case 'filt': {
      const ref = parseRef(f, a.ref);
      const m = ref && getRef(f, ref);
      if (!m) return no('Nothing there');
      if (m.kind !== 'sort') return no('Only a Sorter has a filter');
      m.mut = ((m.mut ?? 1) + 1) % TYPES.length;
      f.fx.push({ k: 'rot', cell: ref.zone === 'grid' ? ref.idx : -1 });
      return yes(`Sorting ${TYPES[m.mut].name}`);
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
      // One level runs every feed, so every feed lights up.
      f.producer.flash = f.producer.flash.map(() => 1);
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

/**
 * Does anything this floor makes actually reach somewhere that pays?
 *
 * Walk from each feed along the machines' facings and see where it comes out. A
 * floor that answers no earns nothing at all, which on a generated plot is a much
 * easier state to fall into than it used to be — expanding moves the vault, and on
 * some maps reconnecting to it is three belts rather than one. It is worth saying
 * so on screen rather than leaving someone to watch a dead factory for a round.
 */
export function reachesPayout(f) {
  for (const port of portsOf(f)) {
    const seen = new Set();
    let at = port.cell;
    while (at != null && f.grid[at] && !seen.has(at)) {
      seen.add(at);
      const m = f.grid[at];
      for (const d of exitDirs(m)) {
        const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
        if (openAt(f, nx, ny)) continue;
        if (f.seller.spots.some(v => v.cell === at && v.dir === d)) return true;
        if (f.lab.cell === at && f.lab.dir === d) return true;
      }
      const d = m.dir | 0;
      const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
      at = openAt(f, nx, ny) ? cellOf(nx, ny) : null;
    }
  }
  return false;
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
      k: m.kind, d: m.dir, l: m.level, m: m.mut, mi: m.mir | 0,
      b: m.buf.map(x => x.ty),                                  // queued at the mouth
      h: heldTypes(m),                                          // in hand right now
      q: r2(machineLoad(m)), c: capacity(m),                    // how full, out of how much
      x: m.blocked ? 1 : 0,                                     // holding, nowhere to put it
      s: (!m.work.length && m.buf.length < intake(m)) ? 1 : 0,   // waiting on a feed
      fl: m.flip | 0,                                            // round-robin cursor
      r: r2(1 / (cycleTime(m) || 1)),                            // jobs per second at this level
      p: m.work.length ? r2(1 - Math.max(0, m.t) / cycleTime(m)) : 0,
      f: r2(m.flash),
    }),
    v: f.inv.map(m => ({ k: m.kind, d: m.dir, l: m.level, m: m.mut, mi: m.mir | 0 })),
    z: f.gizmos.map(g => [g.id, g.ty, r2(g.x), r2(g.y), g.cp | 0]),
    pl: f.producer.level,
    // One entry per running feed: [cell, gizmo type, flash, stalled]
    pp: portsOf(f).map((port, k) => [
      port.cell, port.ty, r2(f.producer.flash[k] || 0), f.producer.stall[k] ? 1 : 0,
    ]),
    sl: f.seller.level,
    sv: f.seller.spots.map(v => [v.cell, v.dir, r2(v.flash || 0)]),
    lb: [f.lab.cell, f.lab.dir, r2(f.lab.flash || 0)],
    sc: Math.round(f.science), dn: f.done.slice(), lc: levelCap(f.done),
    c: Math.round(f.cash), e: Math.round(f.earned), n: Math.round(f.income),
    cl: f.claim, xc: f.claim < GRID ? expandCost(f.claim) : 0,
    tr: Array.from(f.terrain).join(''), rc: RUBBLE_COST,
    ok: reachesPayout(f) ? 1 : 0,
  };
}

export function drainFx(f, cap = 24) {
  const out = f.fx.slice(0, cap);
  f.fx.length = 0;
  return out;
}

export { INV_CAP, maxGizmos };
