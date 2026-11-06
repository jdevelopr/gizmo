/**
 * sim.js — the factory simulation. Pure logic: no DOM, no canvas, no timers.
 *
 * Inherited whole from GIZMO 2, because the part of that game that worked is all
 * in here: machines take **custody** of what they eat and hold it for the whole
 * cycle, a machine that cannot hand its results on keeps holding them, a full
 * machine turns arrivals away, and so a jam walks backward up the line until the
 * extractor at the far end simply stops. Nothing on the map is ever destroyed.
 *
 * Four things are new, and they all come from the same place — GIZMO 3 has no
 * rounds and no fixtures:
 *
 *   **There is no round.** `stepFactory` is called continuously from the moment
 *   the game opens until you close the tab. Building, buying, claiming and
 *   researching all happen while it runs, because there is no other time.
 *
 *   **The producer and the seller are machines.** An Extractor is a machine with
 *   an intake of zero standing on ore; a Depot is a machine with a mouth and no
 *   exits that pays for what it eats. Both fall out of the existing model almost
 *   for free, and both can be moved.
 *
 *   **Power scales time, not existence.** A machine's cycle is counted down at
 *   `powerMult(sat)` rather than at one second per second, so a brownout slows
 *   every machine on a grid smoothly and instantly, and a machine no generator
 *   reaches crawls at a fifth speed rather than stopping.
 *
 *   **The renderer reads this directly.** There is no wire format, because there
 *   is no wire: one process owns the whole game, so `viewOf` and its rounding are
 *   gone and the canvas draws from the live objects.
 */

import {
  WORLD, DIRS, DIR_NAME, TYPES, KINDS, PASSIVE, MAX_LEVEL,
  makeMachine, price, buyCost, upgradeCost, scrapValue, cycleTime, travelTime,
  intake, outputs, exitDirs, sizeOf, capacity, EMPTY_HOLD, drawOf,
  pickInputs, missingFor, canEverAccept, acceptsFrom, faceHit, ONE_MOUTH,
  cellOf, cx, cy, inClaim, claimed, claimCells, inWorld,
  CLAIM_START, CLAIM_STEP, expandCost, LADDERED, CRATE_CAP,
  balDirs, REROUTES, wants, SCIENCE_RATE, techById, techOpen, levelCap, rankOf, rankCost, TECH_RANKS, ROMAN,
  OPEN, RUBBLE, RUBBLE_COST, SCRAP_RATE, powerMult, energyOf, ORE_NAME,
  STALL_BADGE, label, PLUMBING, broken, hpMult, maxHp, CLEARABLE, footprint, frontOf, sizeKind, MOUNTAIN, VALLEY, BEDROCK, BRIDGE_SPAN, BEACON, SPACE, bridgeSpan,
} from './machines.js';
import { solveTopology, balancePower } from './power.js';
import { initBugs, stepBugs, nestAt } from './bugs.js';
import { generateWorld } from './world.js';
import { initBeacon, beaconMouth, beaconWants, deliver } from './beacon.js';

const EPS = 1e-6;

/**
 * Hard ceiling on gizmos in the air at once. GIZMO 2 capped at 400 because every
 * one of them was serialised to a phone fifteen times a second; nothing is
 * serialised here, so the only limit is what a browser will draw, and a big
 * factory genuinely wants thousands of pixels moving.
 */
export const MAX_GIZMOS = 4200;

/* ---------------------------------------------------------------- factory --- */

export function createFactory({ cash = 400, seed = 1, world = null } = {}) {
  const w = world || generateWorld(seed);
  const n = WORLD * WORLD;
  const f = {
    world: w,
    seed: w.seed,
    claim: CLAIM_START,
    terrain: Uint8Array.from(w.terrain),
    patch: Int8Array.from(w.patch),
    rich: Float32Array.from(w.rich),
    grid: new Array(n).fill(null),
    crate: [],          // machines you own that are not standing anywhere
    cells: [],          // indices of occupied slots, rebuilt when the map changes
    gizmos: [],
    load: new Float64Array(n),
    nets: [],
    netOf: new Int32Array(n).fill(-1),
    dirty: true,
    cash,
    earned: 0,          // lifetime, and the score
    spent: 0,
    science: 0,
    studied: 0,         // lifetime science, for the HUD
    done: [],
    sold: 0,
    lost: 0,
    swept: 0,
    burned: 0,
    shipped: new Float64Array(TYPES.length),   // units delivered to depots, by type
    fx: [],
    nid: 1,
    t: 0,               // seconds of factory time elapsed
    mapRev: 0,          // bumped whenever the ground itself changes, so the
                        // renderer knows to repaint its one big floor canvas
  };
  // Mountains: which slot belongs to which, and how much each has left in it.
  f.mtn = Int16Array.from(w.mtn || new Int16Array(n).fill(-1));
  f.mountains = (w.mountains || []).map(m => ({ id: m.id, cells: m.cells.slice(), ty: m.ty, amount: m.amount, left: m.amount }));
  initBeacon(f);
  initBugs(f);
  return f;
}

/**
 * The opening factory: an Extractor on the middle patch, a short belt run, and a
 * Depot at the end of it. It earns about a dollar a second and it is entirely
 * unpowered, which is the point — the first thing you will notice is that it is
 * slow, and the first thing you will build is the generator that fixes it.
 */
export function starterKit(f) {
  const s = f.world.start;
  placeRaw(f, { kind: 'ext', dir: 0 }, s.ext);
  for (const c of s.belts) placeRaw(f, { kind: 'pipe', dir: 0 }, c);
  placeRaw(f, { kind: 'depot', dir: 0 }, s.depot);
  rebuild(f);
}

/** Put a machine down with no cost, no checks and no auto-facing. */
function placeRaw(f, spec, i) {
  const m = makeMachine(spec, f.nid++);
  if (spec.hp == null) m.hp = maxHp(m, f.done);
  if (spec.kind === 'ext') { m.mut = f.patch[i]; m.rich = f.rich[i] || 1; }
  occupy(f, m, i);
  return m;
}

/**
 * Stand a machine on its anchor slot and every other slot it covers. A machine is
 * one object however many slots it covers: each of them points at it.
 */
export function occupy(f, m, at) {
  const cells = footprint(m.kind, at, m.dir) || [at];
  m.at = at;
  m.cells = cells;
  m.front = frontOf(m.kind, at, m.dir);
  for (const c of cells) f.grid[c] = m;
  f.dirty = true;
  return m;
}

/** Take a machine off every slot it covers. */
export function vacate(f, m) {
  for (const c of m?.cells || [m?.at]) if (c != null && f.grid[c] === m) f.grid[c] = null;
  f.dirty = true;
}

/** The anchor slot of whatever stands on slot `i`, or `i` itself if nothing does. */
export const anchorOf = (f, i) => f.grid[i]?.at ?? i;

/** Every distinct machine standing on any of these slots. */
function occupants(f, cells) {
  const out = new Set();
  for (const c of cells) if (f.grid[c]) out.add(f.grid[c]);
  return [...out];
}

/** Can a 1x2 machine at its anchor swing round to face `dir`? */
function turnFits(f, m, dir) {
  const cells = footprint(m.kind, m.at, dir);
  return !!cells && cells.every(c => slotOk(f, c) && (!f.grid[c] || f.grid[c] === m));
}

/**
 * Which way a 1x2 machine set down at `i` should face. Its front slot has to be
 * free ground it may stand on, so of the four ways it could go, the one the usual
 * aiming rules like best is used if it fits, and otherwise the first that does.
 */
export function placementDir(f, spec, i, forced = null) {
  if (sizeKind(spec.kind) !== 'long') return forced;
  if (forced != null) return forced;
  const fits = d => { const c = footprint(spec.kind, i, d); return !!c && c.every(x => slotOk(f, x)); };
  const probe = { kind: spec.kind, dir: spec.dir ?? 0, mir: spec.mir | 0, mut: spec.mut, level: 1, buf: [], work: [], at: i };
  const was = f.grid[i];
  f.grid[i] = probe;
  const want = smartDir(f, i);
  f.grid[i] = was;
  for (const d of [want ?? 0, 0, 1, 2, 3]) if (d != null && fits(d)) return d;
  return want ?? 0;
}

/** Can anything at all stand on this slot — owned, open, no nest? */
function slotOk(f, c) {
  return claimed(c, f.claim) && f.terrain[c] === OPEN && !nestAt(f, c);
}

/** Is this slot owned, clear of rock, and therefore part of the running world? */
export const openAt = (f, x, y) =>
  inClaim(x, y, f.claim) && f.terrain[cellOf(x, y)] === OPEN;

/** Rebuild everything derived from the map. Cheap, and only on a real change. */
export function rebuild(f) {
  // One entry per machine — its anchor — however many slots it covers.
  const cells = [];
  for (let i = 0; i < f.grid.length; i++) {
    const m = f.grid[i];
    if (m && (m.at ?? i) === i) { if (m.at == null) occupy(f, m, i); cells.push(i); }
  }
  f.cells = cells;
  pairBridges(f);
  solveTopology(f);
  relink(f);
}

/* ---------------------------------------------------------------- bridges --- */

/**
 * Pair up Bridges. Along any line of Bridges facing the same way, each one within
 * BRIDGE_SPAN of the last, they pair off in order — first with second, third with
 * fourth — exactly like an underground belt. An entry sends what it is given to its
 * exit; an exit sends it on ahead; a Bridge with no partner is just a belt.
 *
 * `pair` is the partner's slot, `bin` says which end this is: 1 entry, 2 exit.
 */
export function pairBridges(f) {
  const bridges = [];
  for (const i of f.cells) {
    const m = f.grid[i];
    if (m?.kind === 'bridge') { m.pair = -1; m.bin = 0; bridges.push(i); }
  }
  const span = bridgeSpan(f.done);
  const ahead = i => {
    const m = f.grid[i], d = m.dir | 0;
    for (let k = 1; k <= span; k++) {
      const x = cx(i) + DIRS[d][0] * k, y = cy(i) + DIRS[d][1] * k;
      if (!inWorld(x, y)) return -1;
      const n = f.grid[cellOf(x, y)];
      if (n?.kind === 'bridge' && (n.dir | 0) === d) return cellOf(x, y);
    }
    return -1;
  };
  const behind = new Set();
  for (const i of bridges) { const a = ahead(i); if (a >= 0) behind.add(a); }
  for (const i of bridges) {
    if (behind.has(i)) continue;          // not the start of a line
    let at = i, entry = true;
    for (let guard = 0; guard < 64; guard++) {
      const nx = ahead(at);
      if (nx < 0) break;
      if (entry) {
        f.grid[at].pair = nx; f.grid[at].bin = 1;
        f.grid[nx].pair = at; f.grid[nx].bin = 2;
      }
      entry = !entry;
      at = nx;
    }
  }
}

/** Where a machine's output in direction `d` lands: the next slot, or a Bridge's partner. */
function landingOf(f, i, m, d) {
  if (m.kind === 'bridge' && m.bin === 1 && m.pair >= 0 && d === (m.dir | 0)) return m.pair;
  const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
  return openAt(f, nx, ny) ? cellOf(nx, ny) : -1;
}

/* --------------------------------------------------------------- mountains --- */

/** The mountain a Drill at `i` is facing, if it has anything left in it. */
export function mountainAhead(f, i) {
  const m = f.grid[i];
  if (!m) return null;
  const d = m.dir | 0;
  const x = cx(i) + DIRS[d][0], y = cy(i) + DIRS[d][1];
  if (!inWorld(x, y)) return null;
  const id = f.mtn?.[cellOf(x, y)] ?? -1;
  if (id < 0) return null;
  const mt = f.mountains[id];
  return mt && mt.left > 0 ? mt : null;
}

/** The mountain whose rock is on this slot, worked out or not. */
export const mountainAt = (f, i) => {
  const id = f.mtn?.[i] ?? -1;
  return id >= 0 ? f.mountains[id] || null : null;
};

/**
 * A mountain worked out to nothing falls in: its slots become rubble, which can be
 * cleared and built on like any other.
 */
function exhaust(f, mt) {
  mt.left = 0;
  for (const c of mt.cells) { f.terrain[c] = RUBBLE; f.mtn[c] = -1; }
  f.mapRev++;
  f.fx.push({ k: 'mined', cell: mt.cells[0], ty: mt.ty });
}

/**
 * Work out which edges of each belt join a neighbour.
 *
 * A conveyor used to be drawn as a self-contained tile with a casing all the way
 * round it, so a run of twenty read as twenty boxes in a row rather than as one
 * belt — and a corner read as two boxes at right angles rather than as a belt that
 * turns. The renderer needs to know, per belt, which of its four edges continue
 * into something: the edge it fires out of, and every edge a neighbour fires in
 * through. Then it can draw the casing only where the belt actually ends.
 *
 * It is computed here rather than per frame because it changes exactly when the
 * map does — something placed, moved, scrapped, or turned — and asking four
 * neighbours for their exits sixty times a second for a thousand belts is a great
 * deal of work to arrive at the same answer.
 */
export function relink(f) {
  aimMouths(f);
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    if (m.kind !== 'pipe' && m.kind !== 'store') { m.link = 0; continue; }
    let mask = 0;
    const x = cx(i), y = cy(i);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (!openAt(f, nx, ny)) continue;
      const n = f.grid[cellOf(nx, ny)];
      if (!n) continue;
      // The edge I fire out of, if there is anything there that will take it —
      // a belt pointing at the blank side of a Depot visibly does not join it.
      if (d === (m.dir | 0) && acceptsFrom(n, faceHit(d))) mask |= 1 << d;
      // ...and every edge something fires in through.
      if (exitDirs(n).includes((d + 2) % 4)) mask |= 1 << d;
    }
    m.link = mask;
  }
}

/**
 * Turn every Depot and Lab to face whatever is feeding it.
 *
 * A one-sided mouth is a real constraint — it is what stops four lines being
 * shovelled into one Depot from every angle — but it would be a miserable one if
 * placing a Depot and then running a belt at it did nothing until you noticed and
 * rotated it. So a mouth aims itself, on two conditions that between them make it
 * helpful rather than magic: it only ever moves while *nothing* is feeding it, so
 * it can never break a working line; and it stops moving for good the moment you
 * turn one by hand, so it never argues with a decision you have made.
 */
function aimMouths(f) {
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || !ONE_MOUTH.has(m.kind) || m.aimed) continue;
    let feeder = -1;
    for (const [d, n] of perimeter(f, m)) {
      if (!exitDirs(n.m).includes(faceHit(d)) || frontCell(f, n.m, n.c) !== n.c) continue;
      if (d === (m.dir | 0)) { feeder = -2; break; }    // already fed: leave it be
      if (feeder < 0) feeder = d;
    }
    if (feeder >= 0) m.dir = feeder;
  }
}

/**
 * Every machine touching the outside of `m`, with the side of `m` it touches:
 * [side, { c: its slot, m: it }]. A 2x2 has eight slots round it, a 1x2 six.
 */
export function perimeter(f, m) {
  const out = [];
  const mine = new Set(m.cells || [m.at]);
  for (const c of mine) {
    for (let d = 0; d < 4; d++) {
      const nx = cx(c) + DIRS[d][0], ny = cy(c) + DIRS[d][1];
      if (!openAt(f, nx, ny)) continue;
      const nc = cellOf(nx, ny);
      if (mine.has(nc)) continue;
      const n = f.grid[nc];
      if (n && n !== m) out.push([d, { c: nc, m: n }]);
    }
  }
  return out;
}

/** The slot a machine's output leaves from, given the slot it is found on. */
export const frontCell = (f, m, i) => (m?.front ?? i);

/** How many of one kind are standing on the map, for the price ladders. */
export function countKind(f, kind) {
  let n = 0;
  for (const i of f.cells) if (f.grid[i]?.kind === kind) n++;
  return n;
}

/** Everything laddered, counted in one pass, for the catalogue. */
export function kindCounts(f) {
  const out = {};
  for (const k of Object.keys(LADDERED)) out[k] = 0;
  for (const i of f.cells) {
    const k = f.grid[i]?.kind;
    if (k in out) out[k]++;
  }
  return out;
}

/* --------------------------------------------------------------- capacity --- */

/**
 * What a machine is physically holding right now. For the first half of a cycle
 * that is what went in; past halfway the work is done and it is holding the
 * result. An Extractor is the exception at both ends: nothing goes in, so it holds
 * its output for the whole cycle.
 */
function contents(m) {
  if (!m.work.length && !m.out?.length) return [];
  if (!m.out?.length) return m.work;
  if (!m.work.length) return m.out;
  return (1 - Math.max(0, m.t) / (m.cyc || 1)) >= 0.5 ? m.out : m.work;
}

/** Units inside one machine — in its hands and queued at its mouth. */
function machineLoad(m) {
  let n = 0;
  for (const g of contents(m)) n += sizeOf(g.ty);
  for (const g of m.buf) n += sizeOf(g.ty);
  return n;
}

const slotCap = (f, i) => (f.grid[i] ? capacity(f.grid[i]) : EMPTY_HOLD);

/**
 * Units already spoken for at a slot: what the machine holds, plus everything
 * resting on it or already in the air toward it. Counting gizmos in flight is what
 * stops two machines from both firing into the last free space.
 */
function slotLoad(f, i) {
  const m = f.grid[i];
  if (m && m.cells && m.cells.length > 1) {
    // A big machine is one machine: everything in the air toward any part of it
    // counts against the one capacity.
    let n = machineLoad(m);
    for (const c of m.cells) n += f.load[c] || 0;
    return n;
  }
  return (f.load[i] || 0) + (m ? machineLoad(m) : 0);
}

function canAccept(f, i, ty, side = null) {
  const m = f.grid[i];
  if (m && !wants(m, ty, side)) return false;
  return slotLoad(f, i) + sizeOf(ty) <= slotCap(f, i) + EPS;
}

const machineTakes = (m, ty, side = null) =>
  wants(m, ty, side) && machineLoad(m) + sizeOf(ty) <= capacity(m) + EPS;

function retally(f) {
  if (f.load.length !== f.grid.length) f.load = new Float64Array(f.grid.length);
  else f.load.fill(0);
  for (const g of f.gizmos) if (g.cell >= 0) f.load[g.cell] += sizeOf(g.ty);
}

/** Does this machine have a job on, finished or otherwise? */
const jobActive = m => m.t > 0 || !!(m.out && m.out.length);

/** How fast this machine's clock is running, given the grid it is on. */
export const speedOf = (m, done = []) => powerMult(m.net >= 0 ? m.sat : 0) * hpMult(m, done);

/* ------------------------------------------------------------------- step --- */

export function stepFactory(f, dt) {
  if (dt > 0.25) dt = 0.25;    // a backgrounded tab must never fast-forward
  f.t += dt;

  retally(f);
  if (f.dirty) rebuild(f);
  balancePower(f, dt);
  stepBugs(f, dt);

  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    // Chewed through. Like a machine switched off, it holds what it has and does
    // nothing — but it is drawn as broken, not as paused, and it costs to fix.
    if (broken(m)) { m.blockT = 0; m.waitT = 0; m.blocked = 0; continue; }
    // Switched off. It keeps whatever is in its hands — you have paused it, not
    // emptied it — and it is not stuck, so nothing badges it as stuck.
    if (m.off) { m.blockT = 0; m.waitT = 0; continue; }
    if (PASSIVE.has(m.kind)) { runPassive(f, m, i); continue; }
    const sp = speedOf(m, f.done);
    if (jobActive(m)) {
      m.t -= dt * sp;
      if (m.t <= 0) release(f, m, m.front ?? i, sp);
    }
    if (!jobActive(m)) startJob(f, m, i);
    // A saturated line blocks for a fraction of a second on almost every cycle;
    // that is what a saturated line *is*. Only a stall that outlives a hiccup is
    // worth a badge, or the map turns into a wall of amber that says nothing.
    m.blockT = m.blocked ? (m.blockT || 0) + dt : 0;
    m.waitT = m.waiting ? (m.waitT || 0) + dt : 0;
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
      if (m && machineTakes(m, g.ty, g.side)) absorb(f, m, g, k);
    }
  }

  for (const i of f.cells) {
    const m = f.grid[i];
    if (m && m.flash > 0) m.flash = Math.max(0, m.flash - dt * 5);
  }
}

/**
 * A machine with a mouth and no job. Three of them, and each one is a different
 * answer to "what happens to what lands in here": a Depot pays for it, a Lab
 * studies it, a Generator burns it (in power.js, which owns the firebox).
 *
 * Depots and Labs drain their whole buffer every tick rather than working through
 * it on a cycle, so neither is ever the bottleneck. A shop that could only serve
 * one customer a second would be a throughput puzzle nobody asked for.
 */
function runPassive(f, m, i) {
  if (!m.buf.length) return;
  if (m.kind === 'depot') {
    for (const g of m.buf) {
      const v = Math.max(1, TYPES[g.ty].value);
      f.cash += v;
      f.earned += v;
      f.sold++;
      f.shipped[g.ty] += 1;
      f.fx.push({ k: 'sell', v, ty: g.ty, cell: i });
    }
    m.buf.length = 0;
    m.flash = 1;
  } else if (m.kind === 'lab') {
    for (const g of m.buf) {
      const v = Math.max(1, Math.round(TYPES[g.ty].value * SCIENCE_RATE));
      f.science += v;
      f.studied += v;
      f.fx.push({ k: 'sci', v, ty: g.ty, cell: i });
    }
    m.buf.length = 0;
    m.flash = 1;
  }
  // 'gen' keeps its buffer: power.js lights one gizmo at a time out of it.
}

function startJob(f, m, i) {
  // A Drill digs whatever is in the mountain it faces, and stops when there is none.
  if (m.kind === 'drill') {
    const mt = mountainAhead(f, i);
    if (!mt) { m.t = 0; m.out = null; m.waiting = 1; return; }
    m.mut = mt.ty;
    mt.left--;
    if (mt.left <= 0) exhaust(f, mt);
  }
  const take = pickInputs(m);
  if (!take) { m.t = 0; m.out = null; m.waiting = 1; return; }
  m.waiting = 0;
  // Highest index first, so removing one does not move the next.
  m.work = take.map(k => m.buf[k]);
  for (const k of take.slice().sort((a, b) => b - a)) m.buf.splice(k, 1);
  m.out = outputs(m, m.work);
  m.cyc = cycleTime(m, f.done);
  m.t = m.cyc;
}

/**
 * Where one output actually goes.
 *
 * Most machines have exactly one answer and hold on when it is full. A Balancer is
 * the exception: it promised to divide a stream, and a divider that stalls because
 * one arm happens to be busy is not dividing anything — so it tries its other
 * exits, starting from the one the round-robin picked.
 *
 * Firing off the claim, into rubble or into bedrock is always "available", and
 * always a loss. That is deliberate and it is the same rule GIZMO 2 had: unbought
 * land is exactly as fatal as the edge of the world, so a belt aimed at your own
 * fence throws gizmos away and says so.
 */
function pickExit(f, i, m, o) {
  let cands = [o.dir];
  if (REROUTES.has(m.kind)) {
    const all = balDirs(m);
    const at = Math.max(0, all.indexOf(o.dir));
    cands = all.slice(at).concat(all.slice(0, at));
  }
  for (const d of cands) {
    // Into one of the Beacon's mouths: only what that mouth takes, and only while
    // it still wants it. Anything else waits, so a wrong item jams rather than vanishes.
    const bt = beaconMouth(f, i, d);
    if (bt >= 0) { if (beaconWants(f, (d + 2) % 4, o.ty)) return d; continue; }
    const to = landingOf(f, i, m, d);
    if (to < 0) return d;
    if (canAccept(f, to, o.ty, faceHit(d))) return d;
  }
  return null;
}

function release(f, m, i, sp) {
  const outs = m.out || [];
  const stay = [];
  const sent = [];

  for (const o of outs) {
    const d = pickExit(f, i, m, o);
    if (d == null) { stay.push(o); continue; }
    o.dir = d;
    o.beacon = beaconMouth(f, i, d) >= 0;
    o.to = o.beacon ? -1 : landingOf(f, i, m, d);
    if (o.to >= 0) f.load[o.to] += sizeOf(o.ty);
    sent.push(o);
  }

  if (sent.length) {
    m.flash = 1;
    // A gizmo flies at the speed of the machine that threw it, so a browned-out
    // belt visibly crawls rather than jerking a pixel across at full speed every
    // few seconds. Power is meant to be legible from across the room.
    const dur = travelTime(m, f.done) / Math.max(0.05, sp);
    sent.forEach((o, k) => emit(f, i, o, dur, k, sent.length));
  }

  m.t = 0;
  if (stay.length) {
    if (!m.blocked) f.fx.push({ k: 'clog', cell: i });
    m.blocked = 1;
    m.out = stay;
    return;
  }
  m.blocked = 0;
  m.work = [];
  m.out = null;
}

function emit(f, from, out, dur, n, total) {
  if (f.gizmos.length >= MAX_GIZMOS) return;
  const [dx, dy] = DIRS[out.dir];
  const sx = cx(from) + 0.5, sy = cy(from) + 0.5;
  const spread = total > 1 ? (n / (total - 1) - 0.5) * 0.34 : 0;
  const ox = -dy * spread, oy = dx * spread;
  // Normally the next slot; across a Bridge, the far end — and the flight takes as
  // long as the span is wide.
  const to = out.to ?? -1;
  const inside = to >= 0;
  const ex = inside ? cx(to) + 0.5 : sx + dx, ey = inside ? cy(to) + 0.5 : sy + dy;
  const span = inside ? Math.max(1, Math.abs(cx(to) - cx(from)) + Math.abs(cy(to) - cy(from))) : 1;

  f.gizmos.push({
    id: f.nid++, ty: out.ty, cp: out.cp ? 1 : 0, st: 'fly',
    sx: sx + ox, sy: sy + oy, ex: ex + ox, ey: ey + oy,
    x: sx + ox, y: sy + oy,
    p: 0, dur: Math.max(0.02, dur * span * (1 + n * 0.06)),
    cell: inside ? to : -1,
    from, exit: inside || out.beacon ? null : out.dir,
    beacon: out.beacon ? 1 : 0,
    // Which face of the destination this is arriving at. Kept on the gizmo so a
    // Depot that turned one away still turns it away when it is lying on the mat
    // and asking again a tick later.
    side: faceHit(out.dir),
  });
}

function arrive(f, g, k) {
  if (g.beacon) {
    if (!deliver(f, g.ty)) f.lost++;
    f.gizmos.splice(k, 1);
    return;
  }
  if (g.exit !== null) {
    f.lost++;
    f.fx.push({ k: 'lost', ty: g.ty, x: g.ex, y: g.ey });
    f.gizmos.splice(k, 1);
    return;
  }
  const m = f.grid[g.cell];
  if (m && machineTakes(m, g.ty, g.side)) { absorb(f, m, g, k); return; }
  // Nothing is ever destroyed: it rests on the slot, counts against that slot's
  // room, and so turns the machine behind it away.
  g.st = 'idle';
  g.p = 0;
  g.x = cx(g.cell) + 0.22 + Math.random() * 0.56;
  g.y = cy(g.cell) + 0.22 + Math.random() * 0.56;
}

function absorb(f, m, g, k) {
  m.buf.push({ id: g.id, ty: g.ty, cp: g.cp | 0 });
  f.gizmos.splice(k, 1);
}

/** The held cargo, as types, for the renderer. */
export const heldTypes = m => contents(m).map(g => g.ty);
export { machineLoad, contents };

/* ------------------------------------------------------------ auto-facing --- */

/** Machines that aim themselves when set down: the routing family, plus Storage. */
const AUTO_FACE = new Set(['pipe', 'store', 'bal', 'sort', 'ext', 'depot', 'lab', 'drill', 'bridge']);

/** Every Depot on the map, which is what a loose belt wants to be pointing at. */
export function depotsOf(f) {
  const out = [];
  for (const i of f.cells) if (f.grid[i]?.kind === 'depot') out.push(i);
  return out;
}

/**
 * Which way a machine dropped here should face.
 *
 * GIZMO 2 aimed belts at the seller, which was easy because there was exactly one
 * and it was welded to a wall. Here there can be a dozen depots anywhere on a
 * fifty-six-slot map, so the heuristic aims at the nearest one — and, much more
 * often, simply continues whatever flow already arrives at this slot, which on a
 * map this size is the answer that is right nearly every time.
 *
 * Dragging a run of belts overrides all of this: a drag knows exactly which way
 * you meant, and nothing is more irritating than a belt that argues.
 */
export function smartDir(f, i) {
  const m = f.grid[i];
  if (!m || !AUTO_FACE.has(m.kind)) return null;

  // A Drill faces the mountain with the most left in it, preferring a side whose
  // back — where it unloads — is open ground or a machine that takes things.
  if (m.kind === 'drill') {
    let best = null, score = -Infinity;
    for (let d = 0; d < 4; d++) {
      const x = cx(i) + DIRS[d][0], y = cy(i) + DIRS[d][1];
      if (!inWorld(x, y)) continue;
      const id = f.mtn?.[cellOf(x, y)] ?? -1;
      if (id < 0 || !(f.mountains[id]?.left > 0)) continue;
      const b = (d + 2) % 4;
      const bx = cx(i) + DIRS[b][0], by = cy(i) + DIRS[b][1];
      const s2 = f.mountains[id].left / 1e4 + (openAt(f, bx, by) ? 2 : 0)
        + (openAt(f, bx, by) && f.grid[cellOf(bx, by)] && acceptsFrom(f.grid[cellOf(bx, by)], faceHit(b)) ? 3 : 0);
      if (s2 > score) { score = s2; best = d; }
    }
    return best ?? m.dir;
  }

  // A Bridge lines up with a lone Bridge pointing at it, to pair; otherwise it
  // faces across a valley if it stands on the edge of one; otherwise it is a belt.
  if (m.kind === 'bridge') {
    for (let d = 0; d < 4; d++) {
      const back = (d + 2) % 4;
      for (let k = 1; k <= bridgeSpan(f.done); k++) {
        const x = cx(i) + DIRS[back][0] * k, y = cy(i) + DIRS[back][1] * k;
        if (!inWorld(x, y)) break;
        const n = f.grid[cellOf(x, y)];
        if (n?.kind === 'bridge') {
          if ((n.dir | 0) === d && !(n.bin === 1 && n.pair >= 0)) return d;
          break;
        }
      }
    }
    for (let d = 0; d < 4; d++) {
      const x = cx(i) + DIRS[d][0], y = cy(i) + DIRS[d][1];
      if (inWorld(x, y) && f.terrain[cellOf(x, y)] === VALLEY) return d;
    }
  }

  // A Depot and a Lab have a mouth rather than an exit, so "which way should this
  // face" is a different question: point it at whatever is already firing at this
  // slot, and failing that at whatever is standing next to it.
  if (ONE_MOUTH.has(m.kind)) {
    let best = m.dir, score = -1;
    const probe = m.cells ? m : { ...m, cells: footprint(m.kind, i, m.dir) || [i] };
    for (const [d, n] of perimeter(f, probe)) {
      const s2 = exitDirs(n.m).includes(faceHit(d)) && frontCell(f, n.m, n.c) === n.c ? 2 : 1;
      if (s2 > score) { score = s2; best = d; }
    }
    return best;
  }

  const x = cx(i), y = cy(i);
  const depots = depotsOf(f);
  const dist = (ax, ay, c) => Math.abs(ax - cx(c)) + Math.abs(ay - cy(c));
  const target = depots.length
    ? depots.reduce((a, b) => (dist(x, y, b) < dist(x, y, a) ? b : a))
    : null;
  const gap = (ax, ay) => (target == null ? 0 : dist(ax, ay, target));
  const here = gap(x, y);

  // Directions we are fed from: the neighbour that way aims at us.
  const fed = new Set();
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    if (!openAt(f, nx, ny)) continue;
    const nm = f.grid[cellOf(nx, ny)];
    if (nm && exitDirs(nm).includes((d + 2) % 4)) fed.add(d);
  }

  const longLeg = target == null ? 'x'
    : (Math.abs(x - cx(target)) >= Math.abs(y - cy(target)) ? 'x' : 'y');

  let best = m.dir, bestScore = -Infinity;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    let score = 0;

    if (!openAt(f, nx, ny)) {
      score -= 100;                                  // off the claim, or into rock: a loss
    } else {
      const nm = f.grid[cellOf(nx, ny)];
      if (target != null) score += (here - gap(nx, ny)) * 8;
      if (nm) {
        // Handing off to a machine is good; firing into one that fires back is not,
        // and firing into a face that can never take anything — the back of an
        // Extractor, the solid side of a Depot — is worse than firing at nothing.
        if (!acceptsFrom(nm, faceHit(d))) score -= 40;
        else if (exitDirs(nm).includes((d + 2) % 4)) score -= 16;
        else if (nm.kind === 'depot' || nm.kind === 'lab' || nm.kind === 'gen' || nm.kind === 'zap') score += 26;
        else if ((nm.kind === 'pipe' || nm.kind === 'store') && (nm.dir | 0) === d) score += 14;   // joins a run going the same way
        else score += 8;
      }
      if (target != null && here - gap(nx, ny) > 0
        && (DIRS[d][0] !== 0 ? 'x' : 'y') === longLeg) score += 2;
    }

    if (fed.has(d)) score -= 30;                     // never shove it back at the feeder
    if (fed.has((d + 2) % 4)) score += 10;           // keep the existing flow straight
    if (d === m.dir) score += 1;                     // ties keep whatever it had

    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/* ------------------------------------------------------------ belt joining --- */

const BELTISH = new Set(['pipe', 'store']);

/**
 * Is this belt going nowhere? It points off the claim, at bare ground, at a face
 * that can never take anything, or straight back at whatever is feeding it.
 */
export function deadEnd(f, i) {
  const m = f.grid[i];
  if (!m || !BELTISH.has(m.kind)) return false;
  const d = m.dir | 0;
  const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
  if (!openAt(f, nx, ny)) return true;
  const n = f.grid[cellOf(nx, ny)];
  if (!n) return true;
  if (!acceptsFrom(n, faceHit(d)) || n.kind === 'ext') return true;
  return exitDirs(n).includes((d + 2) % 4);
}

/**
 * A machine just landed here: any belt next to it that was going nowhere turns to
 * feed it. This is what makes extending a line feel right — put a belt down beside
 * the end of a run, at any angle, and the run bends to meet it rather than carrying
 * on into empty ground. Belts you turned by hand are left exactly as you set them.
 */
export function adoptFeeders(f, i) {
  const m = f.grid[i];
  if (!m) return 0;
  let n = 0;
  for (const [d, nb] of perimeter(f, m)) {
    const j = nb.c;
    const b = nb.m;
    if (!b || !BELTISH.has(b.kind) || b.handAim || !deadEnd(f, j)) continue;
    const toMe = (d + 2) % 4;                       // the direction from b to here
    if (!acceptsFrom(m, faceHit(toMe))) continue;   // it could not get in that way
    if (exitDirs(m).includes(d)) continue;          // and never into my own output
    b.dir = toMe;
    b.flash = 1;
    n++;
  }
  return n;
}

/**
 * The end of a dragged run: if there is a machine right beside it that would take
 * what the belt carries — and it is not the belt behind — point at that instead of
 * carrying on into nothing. Otherwise keep the direction the drag was going.
 */
export function handoffDir(f, i) {
  const m = f.grid[i];
  if (!m) return null;
  let best = null, bestScore = 0;
  for (let d = 0; d < 4; d++) {
    const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
    if (!openAt(f, nx, ny)) continue;
    const n = f.grid[cellOf(nx, ny)];
    if (!n || !acceptsFrom(n, faceHit(d)) || n.kind === 'ext') continue;
    if (exitDirs(n).includes((d + 2) % 4)) continue;          // that is my feeder
    const s2 = (n.kind === 'depot' || n.kind === 'lab' || n.kind === 'gen' || n.kind === 'zap') ? 3
      : BELTISH.has(n.kind) ? 1 : 2;
    if (s2 > bestScore) { bestScore = s2; best = d; }
  }
  // Only take the hand-off if the way the drag was going is not already one.
  const ahead = (m.dir | 0);
  const ax = cx(i) + DIRS[ahead][0], ay = cy(i) + DIRS[ahead][1];
  const an = openAt(f, ax, ay) ? f.grid[cellOf(ax, ay)] : null;
  if (an && acceptsFrom(an, faceHit(ahead)) && an.kind !== 'ext' && !exitDirs(an).includes((ahead + 2) % 4)) return null;
  return best;
}

/**
 * Face a freshly landed machine down the line, and — if it branches — put that
 * branch on a side that exists. A Balancer dropped against the fence would
 * otherwise aim half its output at unbought land.
 */
export function autoFace(f, i) {
  const m = f.grid[i];
  if (!m) return;
  const d = smartDir(f, i);
  if (d != null && d !== m.dir) m.dir = d;
  if (m.kind !== 'bal' && m.kind !== 'sort') return;
  const open = side => {
    const dd = ((m.dir | 0) + side) % 4;
    return openAt(f, cx(i) + DIRS[dd][0], cy(i) + DIRS[dd][1]);
  };
  if (!open(1) && open(3)) m.mir = 1;
  else if (!open(3) && open(1)) m.mir = 0;
}

/* ---------------------------------------------------------------- building --- */

const yes = (msg, extra) => ({ ok: true, msg, ...extra });
const no = msg => ({ ok: false, msg });

/**
 * Can a machine of this kind stand on this slot, and if not, why not? Split out
 * from `build` so the cursor can say the same thing before you spend the money —
 * a build ghost that turns red and tells you it needs ore is worth ten tooltips.
 */
export function buildCheck(f, spec, i, dir = null) {
  if (!Number.isInteger(i) || i < 0 || i >= f.grid.length) return no('Off the map');
  const d = dir ?? placementDir(f, spec, i, spec.dir ?? null) ?? spec.dir ?? 0;
  const cells = footprint(spec.kind, i, d);
  if (!cells) return no('It does not fit — it would hang off the edge of the world');
  const big = cells.length > 1;
  for (const c of cells) {
    if (!claimed(c, f.claim)) return no(big ? 'It does not fit — part of it is off your land' : 'You do not own this land');
    if (f.terrain[c] === RUBBLE) return no(big ? 'It does not fit — rubble in the way' : `Rubble — clear it for $${RUBBLE_COST}`);
    if (f.terrain[c] === MOUNTAIN) return no(big ? 'It does not fit — a mountain is in the way' : 'A mountain — go round it, or drill it from beside');
    if (f.terrain[c] === VALLEY) return no(big ? 'It does not fit — a valley is in the way' : 'A valley — cross it with a pair of Bridges');
    if (f.terrain[c] === BEACON) return no('The Launch Beacon — feed it through the mouth on each side');
    if (f.terrain[c] === SPACE) return no('Open space — there is nothing to build on');
    if (f.terrain[c] !== OPEN) return no(big ? 'It does not fit — bedrock in the way' : 'Bedrock will not move');
    if (nestAt(f, c)) return no('A nest — zap it out first');
  }
  if (spec.kind === 'ext' && f.patch[i] < 0) return no('An Extractor has to stand on ore');
  if (spec.kind === 'drill' && !nextToMountain(f, i)) return no('A Mountain Drill has to stand beside a mountain with ore left in it');
  // Building over the top of something is allowed, and is the normal way to change
  // your mind about a slot. Whatever was there goes in the crate — unless the crate
  // is full, which is the one thing that can stop it.
  const here = occupants(f, cells).filter(m => !(m.kind === spec.kind && m.at === i));
  if (here.length && f.crate.length + here.length > CRATE_CAP) {
    return no('Crate is full — place or scrap something from it first');
  }
  return yes(null, { dir: d, cells });
}

/** Is there a mountain with ore left in it on any side of this slot? */
export function nextToMountain(f, i) {
  for (let d = 0; d < 4; d++) {
    const x = cx(i) + DIRS[d][0], y = cy(i) + DIRS[d][1];
    if (!inWorld(x, y)) continue;
    const id = f.mtn?.[cellOf(x, y)] ?? -1;
    if (id >= 0 && f.mountains[id]?.left > 0) return true;
  }
  return false;
}

/**
 * Is putting `spec` here a *replacement* rather than a fresh build, and if so what
 * kind? Three answers, and the difference matters a great deal to how it feels:
 *
 *   'new'     — an empty slot. Pay for it.
 *   'reaim'   — the same kind of machine is already there, so nothing is bought and
 *               nothing is crated; it simply turns to face the way you meant. This
 *               is what makes dragging a belt back over a run you already laid fix
 *               its direction instead of costing you the whole run again.
 *   'replace' — something else is there. It goes to the crate, still yours, and the
 *               new machine is bought and put down in its place.
 */
export function replaceMode(f, spec, i, dir = null) {
  const d = dir ?? spec.dir ?? 0;
  const cells = footprint(spec.kind, i, d) || [i];
  const here = occupants(f, cells);
  if (!here.length) return 'new';
  if (here.length === 1 && here[0].kind === spec.kind && here[0].at === i) return 'reaim';
  return 'replace';
}

/**
 * Buy one machine and set it down. In GIZMO 2 you bought a card and it landed
 * wherever there was room; here you hold the thing and click where it goes, which
 * is the only sane verb on a map with three thousand slots.
 *
 * @param {object} spec { kind, dir?, mut?, mir? }
 * @param {number} i slot
 * @param {object} opt { free: skip payment, dir: force a facing }
 */
export function build(f, spec, i, opt = {}) {
  // Same kind already anchored here: this is a re-aim, and is checked as one below.
  const same = !!f.grid[i] && f.grid[i].kind === spec.kind && f.grid[i].at === i;
  const long = sizeKind(spec.kind) === 'long';
  const dir0 = long ? placementDir(f, spec, i, opt.dir ?? (same ? f.grid[i].dir : null)) : opt.dir;
  if (!same) {
    const check = buildCheck(f, spec, i, dir0);
    if (!check.ok) return check;
  }

  const mode = same ? 'reaim' : replaceMode(f, spec, i, dir0);

  // Same kind, same slot: turn it, retune it, and charge nothing. A machine you
  // already own does not have to be bought again to be pointed somewhere else.
  if (mode === 'reaim') {
    const m = f.grid[i];
    const dir = opt.dir != null ? opt.dir : m.dir;
    const mir = opt.mir != null ? (opt.mir ? 1 : 0) : m.mir;
    const mut = (spec.mut != null && spec.kind !== 'ext') ? spec.mut : m.mut;
    if (m.dir === dir && m.mir === mir && m.mut === mut) return yes(null, { cost: 0, machine: m, mode });
    if (dir !== m.dir && long && !turnFits(f, m, dir)) return no('No room to turn it that way');
    m.dir = dir; m.mir = mir; m.mut = mut;
    if (long) { vacate(f, m); occupy(f, m, i); rebuild(f); }
    m.flash = 1;
    f.fx.push({ k: 'rot', cell: i });
    return yes(null, { cost: 0, machine: m, mode });
  }

  const cost = opt.free ? 0 : buyCost(spec, countKind(f, spec.kind));
  if (f.cash < cost) return no(`Need $${cost}`);

  // Whatever was standing here is put away rather than destroyed.
  let crated = null;
  if (mode === 'replace') {
    for (const old of occupants(f, footprint(spec.kind, i, dir0 ?? 0) || [i])) {
      crated = crated || old;
      vacate(f, old);
      toCrate(f, old);
    }
  }

  f.cash -= cost;
  f.spent += cost;
  const m = placeRaw(f, { ...spec, dir: dir0 ?? spec.dir ?? 0 }, i);
  // Anything left pointing at nothing next door turns to feed the newcomer first,
  // so the newcomer's own facing is worked out with its feeders already in place.
  if (opt.dir == null || opt.adopt) adoptFeeders(f, i);
  if (opt.dir != null && !long) m.dir = opt.dir;
  else if (!long) autoFace(f, i);
  if (opt.hand) m.handAim = 1;
  if (opt.mir != null) m.mir = opt.mir ? 1 : 0;
  rebuild(f);
  f.fx.push({ k: 'build', cell: i, kind: spec.kind });
  return yes(null, { cost, machine: m, mode, crated });
}

/* ------------------------------------------------------------------ crate --- */

/**
 * Put a machine away. It keeps its level and its settings, because it is the same
 * machine — you have not sold it, you have picked it up.
 */
export function toCrate(f, m) {
  if (!m || f.crate.length >= CRATE_CAP) return false;
  m.buf.length = 0; m.work.length = 0; m.out = null; m.t = 0; m.blocked = 0;
  m.net = -1; m.sat = 0; m.fuel = 0; m.load = 0;
  f.crate.push(m);
  return true;
}

/** Everything about a crated machine that decides whether two of them are alike. */
export const crateKey = m =>
  `${m.kind}|${m.mut ?? 0}|${m.mir | 0}|${m.level || 1}`;

/** The crate, grouped into stacks of identical machines, for the build bar. */
export function crateStacks(f) {
  const by = new Map();
  for (const m of f.crate) {
    const k = crateKey(m);
    if (!by.has(k)) by.set(k, { key: k, spec: m, n: 0 });
    by.get(k).n++;
  }
  return [...by.values()];
}

/**
 * Take one machine of this kind out of the crate and set it down. It costs
 * nothing: it was bought once already.
 */
export function placeFromCrate(f, key, i, opt = {}) {
  const at = f.crate.findIndex(m => crateKey(m) === key);
  if (at < 0) return no('Nothing like that in the crate');
  const m = f.crate[at];
  const long = sizeKind(m.kind) === 'long';
  const dir0 = long ? placementDir(f, m, i, opt.dir ?? null) : (opt.dir ?? m.dir);
  const check = buildCheck(f, m, i, dir0);
  if (!check.ok) return check;

  // Anything in the way — including another of the same kind — goes to the crate,
  // so the one you were holding goes down and the one that was there is held.
  for (const old of occupants(f, check.cells)) { vacate(f, old); toCrate(f, old); }

  f.crate.splice(at, 1);
  m.dir = dir0 ?? m.dir;
  occupy(f, m, i);
  if (m.kind === 'ext') { m.mut = f.patch[i]; m.rich = f.rich[i] || 1; }
  m.handAim = opt.hand ? 1 : 0;
  if (opt.dir == null || opt.adopt) adoptFeeders(f, i);
  if (opt.dir != null && !long) m.dir = opt.dir;
  else if (!long) autoFace(f, i);
  if (opt.mir != null) m.mir = opt.mir ? 1 : 0;
  rebuild(f);
  f.fx.push({ k: 'build', cell: i, kind: m.kind });
  return yes(null, { cost: 0, machine: m, fromCrate: true, left: f.crate.filter(x => crateKey(x) === key).length });
}

/* ----------------------------------------------------------------- ground --- */

/**
 * Gizmos lying loose on a slot.
 *
 * Nothing in this simulation is ever destroyed, which is the rule the whole
 * backpressure model rests on — so when a machine is scrapped or a belt is
 * re-aimed, whatever was in the air lands on the floor and stays there. It counts
 * against that slot's room, which means a handful of orphaned gizmos can quietly
 * make a slot permanently harder to feed, and there was no way to pick them up.
 *
 * Now there is. Sweeping is not selling: this is litter left over from a change of
 * mind, not production, and paying for it would make demolishing and rebuilding a
 * line a way of laundering gizmos into money.
 */
export function looseAt(f, i) {
  let n = 0;
  for (const g of f.gizmos) if (g.cell === i && g.st === 'idle') n++;
  return n;
}

/** Everything lying loose on a slot, by type, for the inspector. */
export function looseTypes(f, i) {
  const out = [];
  for (const g of f.gizmos) if (g.cell === i && g.st === 'idle') out.push(g.ty);
  return out;
}

/** Bin whatever is lying on this slot. Pays nothing. @returns {number} how many */
export function sweepGround(f, i) {
  let n = 0;
  for (let k = f.gizmos.length - 1; k >= 0; k--) {
    const g = f.gizmos[k];
    if (g.cell === i && g.st === 'idle') { f.gizmos.splice(k, 1); n++; }
  }
  if (n) {
    f.swept += n;
    f.fx.push({ k: 'sweep', cell: i, n });
  }
  return n;
}

/** Take a machine off the map and put it in the crate, keeping every setting. */
export function stashMachine(f, i) {
  const m = f.grid[i];
  if (!m) return no('Nothing there');
  if (f.crate.length >= CRATE_CAP) return no('Crate is full');
  vacate(f, m);
  toCrate(f, m);
  rebuild(f);
  f.fx.push({ k: 'move', cell: i });
  return yes('To the crate');
}

/** Sell one crated machine for what scrapping it on the map would have paid. */
export function scrapFromCrate(f, key) {
  const at = f.crate.findIndex(m => crateKey(m) === key);
  if (at < 0) return no('Nothing like that in the crate');
  const v = scrapValue(f.crate[at]);
  f.crate.splice(at, 1);
  f.cash += v;
  return yes(`+$${v}`, { refund: v });
}

/**
 * Pick a machine up and put it down somewhere else, for nothing.
 *
 * Moving is free and always was, and on a map this size it is the single most
 * used verb in the game — a factory is a thing you rearrange, and charging for
 * that would make you build around your mistakes instead of fixing them. What a
 * move does cost is whatever the machine was holding: it drops its cargo, which
 * is fair, because you interrupted it.
 */
export function moveMachine(f, from, to) {
  const m = f.grid[from];
  if (!m) return no('Nothing there');
  if ((m.at ?? from) === to) return yes();
  const cells = footprint(m.kind, to, m.dir);
  if (!cells) return no('It does not fit there');
  for (const c of cells) {
    if (!claimed(c, f.claim)) return no('You do not own this land');
    if (f.terrain[c] !== OPEN) return no('Something is in the way');
    if (nestAt(f, c)) return no('A nest — zap it out first');
  }
  if (m.kind === 'ext' && f.patch[to] < 0) return no('An Extractor has to stand on ore');
  if (m.kind === 'drill' && !nextToMountain(f, to)) return no('A Mountain Drill has to stand beside a mountain');
  // Dropping one machine on others puts the ones underneath in the crate, the same
  // as building over them does. Nothing on this map is ever destroyed by accident.
  const under = occupants(f, cells).filter(x => x !== m);
  if (under.length && f.crate.length + under.length > CRATE_CAP) return no('Crate is full');
  for (const u of under) { vacate(f, u); toCrate(f, u); }

  vacate(f, m);
  occupy(f, m, to);
  m.buf.length = 0; m.work.length = 0; m.out = null; m.t = 0; m.blocked = 0;
  if (m.kind === 'ext') { m.mut = f.patch[to]; m.rich = f.rich[to] || 1; }
  rebuild(f);
  f.fx.push({ k: 'move', cell: to });
  return yes();
}

export function scrapMachine(f, i) {
  const m = f.grid[i];
  if (!m) return no('Nothing there');
  const v = scrapValue(m);
  f.cash += v;
  vacate(f, m);
  rebuild(f);
  f.fx.push({ k: 'scrap', cell: i, v });
  return yes(`+$${v}`, { refund: v });
}

/* ----------------------------------------------------------------- actions --- */

/**
 * Everything else you can do to a machine or to the map. One entry point, and it
 * never throws on bad input.
 */
export function applyAction(f, a) {
  if (!a || typeof a !== 'object') return no('Bad action');
  const m = Number.isInteger(a.i) ? f.grid[a.i] : null;

  switch (a.a) {
    case 'rot': {
      if (!m) return no('Nothing there');
      const nd = (m.dir + (a.back ? 3 : 1)) % 4;
      // A 1x2 swings round its back slot, so the slot it swings into has to be free.
      if (sizeKind(m.kind) === 'long') {
        if (!turnFits(f, m, nd)) return no('No room to turn it that way');
        vacate(f, m);
        m.dir = nd;
        occupy(f, m, m.at);
        rebuild(f);
      }
      m.dir = nd;
      // A mouth you have turned yourself stops turning itself, and a belt you have
      // turned yourself is never re-aimed by one built beside it.
      if (ONE_MOUTH.has(m.kind)) m.aimed = 1;
      m.handAim = 1;
      relink(f);            // turning one belt changes how its neighbours join it
      f.fx.push({ k: 'rot', cell: a.i });
      return yes();
    }

    /**
     * Switch a machine off, or back on again.
     *
     * The one thing a factory could not do until now was *stop*. Every problem in
     * the game is diagnosed by watching a line run, and there was no way to hold
     * half of it still while you looked at the other half — no way to cut a branch
     * you were rebuilding, no way to stop an Extractor flooding a line you were
     * re-routing, no way to take a generator off a grid to see what it was
     * actually carrying. An off machine does nothing, draws nothing, accepts
     * nothing, and keeps everything it is holding.
     */
    case 'off': {
      if (!m) return no('Nothing there');
      m.off = m.off ? 0 : 1;
      m.blocked = 0; m.blockT = 0; m.waitT = 0;
      f.fx.push({ k: m.off ? 'switchoff' : 'switchon', cell: a.i });
      return yes(m.off ? 'Switched off' : 'Switched on');
    }

    /**
     * Empty a two-input machine. Whatever is queued at its mouth and whatever is in
     * its hands is thrown out — like sweeping, it pays nothing — and it starts its
     * next job from nothing. The cure for an Assembler that was fed the wrong
     * things while you were rebuilding the line in front of it.
     */
    case 'clearBuf': {
      if (!m) return no('Nothing there');
      if (!CLEARABLE.has(m.kind)) return no('Nothing to clear');
      const n = m.buf.length + m.work.length;
      if (!n && !m.out) return no('Already empty');
      m.buf.length = 0; m.work = []; m.out = null; m.t = 0;
      m.blocked = 0; m.waiting = 0; m.blockT = 0; m.waitT = 0;
      f.swept += n;
      f.fx.push({ k: 'sweep', cell: a.i, n });
      return yes(`Cleared ${n}`);
    }

    case 'mir': {
      if (!m) return no('Nothing there');
      if (m.kind !== 'bal' && m.kind !== 'sort') return no('Nothing to flip');
      m.mir = m.mir ? 0 : 1;
      relink(f);
      f.fx.push({ k: 'rot', cell: a.i });
      return yes(m.mir ? 'Branching left' : 'Branching right');
    }

    case 'filt': {
      if (!m) return no('Nothing there');
      if (m.kind !== 'sort') return no('Only a Sorter has a filter');
      m.mut = Number.isInteger(a.ty) ? a.ty : ((m.mut ?? 1) + 1) % TYPES.length;
      return yes(`Sorting ${TYPES[m.mut].name}`);
    }

    case 'up': {
      if (!m) return no('Nothing there');
      const cap = levelCap(f.done);
      if ((m.level || 1) >= cap) {
        return no(cap < MAX_LEVEL ? 'Another rank of Overclocking would raise this' : 'Already at level 5');
      }
      const c = upgradeCost(m, f.done);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      f.spent += c;
      m.level++;
      m.flash = 1;
      relink(f);                // a level 3 router gains an exit
      f.dirty = true;           // and a generator's reach just changed
      f.fx.push({ k: 'up', cell: a.i });
      return yes(null, { cost: c });
    }

    case 'clear': {
      const i = a.i;
      if (!Number.isInteger(i) || i < 0 || i >= f.grid.length) return no('Off the map');
      if (!claimed(i, f.claim)) return no('You do not own this land');
      if (f.terrain[i] !== RUBBLE) {
        return no(f.terrain[i] === OPEN ? 'Nothing to clear' : 'Bedrock will not move');
      }
      if (f.cash < RUBBLE_COST) return no(`Clearing costs $${RUBBLE_COST}`);
      f.cash -= RUBBLE_COST;
      f.spent += RUBBLE_COST;
      f.terrain[i] = OPEN;
      f.mapRev++;
      f.fx.push({ k: 'clear', cell: i });
      return yes('Cleared');
    }

    /**
     * Buy one ring of land.
     *
     * GIZMO 2 could only do this between rounds, because expanding moved the vault
     * and anything already in the air toward the old one would have been sold into
     * a wall. Nothing here rides the fence any more, so a ring can be bought at any
     * moment: the claim simply gets bigger and slots that were dirt become slots.
     * No machine moves, nothing is interrupted, and the belt you have already aimed
     * at the new land starts working the instant you pay.
     */
    case 'expand': {
      const top = f.world?.maxClaim || WORLD;
      if (f.claim >= top) return no(top < WORLD ? 'You own the whole rock' : 'You own the whole world');
      const c = expandCost(f.claim);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      f.spent += c;
      // The world is even and the claim starts odd, so the last step is a short
      // one rather than a ring that would hang off the edge.
      f.claim = Math.min(top, f.claim + CLAIM_STEP);
      f.mapRev++;
      f.fx.push({ k: 'grow', claim: f.claim });
      return yes(`Claim is now ${f.claim} x ${f.claim}`, { cost: c });
    }

    default:
      return no('Unknown action');
  }
}

/**
 * Spend science on one node. Research is permanent, and it is the one thing you
 * buy that cannot be scrapped, sold or taken back.
 */
export function research(f, id) {
  const t = techById(id);
  if (!t) return no('No such research');
  const rank = rankOf(f.done, id);
  if (rank >= TECH_RANKS) return no('Already at rank V');
  if (!techOpen(t, f.done)) return no('Needs earlier research');
  const cost = rankCost(t, f.done);
  if (f.science < cost) return no(`Needs ${cost} science`);
  f.science -= cost;
  const before = f.cells.map(i => f.grid[i]).concat(f.crate).map(m => [m, maxHp(m, f.done)]);
  f.done.push(id);
  f.mapRev++;                  // Surveying, for one, changes what the ground shows
  // Plating raises every machine's ceiling, and lifts what it has by the same
  // proportion, so a machine at full health is still at full health afterwards.
  for (const [m, was] of before) {
    const now = maxHp(m, f.done);
    if (now !== was && m.hp != null) m.hp = m.hp * now / was;
  }
  f.dirty = true;              // reach, output and yield may all have just changed
  const name = t.name + (rank ? ' ' + ROMAN[rank + 1] : '');
  f.fx.push({ k: 'tech', name });
  return yes(`${name} complete`);
}

/* ------------------------------------------------------------------ health --- */

/**
 * What is wrong with this factory, in the order it is worth fixing.
 *
 * A 7x7 floor could be read at a glance; three thousand slots cannot, and the two
 * failure modes that matter are both invisible from across the map. So the game
 * says them out loud: how many machines are backed up, how many are starving, how
 * many are running on no power at all, and whether any grid is browning out.
 */
export function diagnose(f) {
  let blocked = 0, starved = 0, waiting = 0, unpowered = 0;
  let dryGens = 0, gens = 0, depots = 0, exts = 0;
  let waitingFor = null, waitingAt = -1, switchedOff = 0, brokenN = 0, hurt = 0;
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    if (broken(m)) { brokenN++; continue; }
    if (m.hp != null && m.hp < maxHp(m, f.done) - 0.01) hurt++;
    if (m.off) { switchedOff++; continue; }
    if (m.kind === 'gen') { gens++; if (m.fuel <= 0 && !m.buf.length) dryGens++; continue; }
    if (m.kind === 'depot') { depots++; continue; }
    if (m.kind === 'ext') exts++;
    if (PASSIVE.has(m.kind)) continue;
    // Only stalls that have outlasted a hiccup count. Everything on a busy line
    // blocks momentarily; almost none of it is a problem.
    if (m.blockT > STALL_BADGE) blocked++;
    else if (m.waitT > STALL_BADGE && m.buf.length) {
      waiting++;
      // Keep the first one, so the alert can name the thing to go and fetch
      // rather than counting the machines that stopped behind it.
      if (waitingFor == null) {
        waitingFor = missingFor(m)[0] ?? null;
        waitingAt = i;
      }
    } else if (m.waitT > STALL_BADGE && !PLUMBING.has(m.kind)) starved++;
    if (m.net < 0 && drawOf(m, f.done) > 0) unpowered++;
  }
  let worst = 1;
  for (const net of f.nets || []) if (net.demand > 0) worst = Math.min(worst, net.sat);
  const jammed = jams(f);
  return {
    blocked, starved, waiting, unpowered, dryGens, gens, depots, exts, worst,
    waitingFor, waitingAt, switchedOff, jams: jammed, broken: brokenN, hurt,
  };
}

/**
 * Lines that have stopped for good.
 *
 * There is a world of difference between a machine that is full and a machine
 * that is being handed something it can never use, and until now the game drew
 * them identically. The first drains. The second is a factory that will still be
 * dead in twenty minutes: an Assembler fed a gizmo that is not one of its two
 * ingredients, a Fuser fed a finished Product, a belt aimed into the back of an
 * Extractor. Every one of those is a permanent stop, and every one has a one-line
 * explanation, so the game gives it rather than leaving you to find the guilty
 * badge among two hundred identical ones.
 *
 * @returns {Array<{cell:number, ty:number, into:number, kind:string, why:string}>}
 */
const an = w => ('AEIOU'.includes(w[0].toUpperCase()) ? 'an ' : 'a ') + w;

export function jams(f) {
  const out = [];
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || m.off || broken(m) || !m.blocked || m.blockT <= STALL_BADGE) continue;
    const at = m.front ?? i;
    for (const o of m.out || []) {
      const nx = cx(at) + DIRS[o.dir][0], ny = cy(at) + DIRS[o.dir][1];
      const bt = beaconMouth(f, at, o.dir);
      if (bt >= 0 && o.ty !== bt) {
        out.push({ cell: i, ty: o.ty, into: i, kind: 'beacon',
          why: `${TYPES[o.ty].name} into the Beacon's ${TYPES[bt].name} mouth, which takes nothing else` });
        break;
      }
      if (!openAt(f, nx, ny)) continue;
      const target = f.grid[cellOf(nx, ny)];
      const side = faceHit(o.dir);
      if (!target || canEverAccept(target, o.ty, side)) continue;
      // A Depot fed on the flank is a different fault from a Fuser fed a Product:
      // one is fixed by turning something, the other by moving it.
      const why = ONE_MOUTH.has(target.kind) && !acceptsFrom(target, side)
        ? `${TYPES[o.ty].name} into the side of ${an(label(target))} — its mouth faces `
          + `${DIR_NAME[target.dir]}, so turn it or come at it from there`
        : `${TYPES[o.ty].name} into ${an(label(target))}, which can never take one`;
      out.push({ cell: i, ty: o.ty, into: cellOf(nx, ny), kind: target.kind, why });
      break;
    }
    if (out.length >= 8) break;
  }
  return out;
}

/** Is this machine's stall permanent rather than a queue? */
export function isJammed(f, i) {
  return jams(f).some(j => j.cell === i || j.into === i);
}

/**
 * Does anything this factory makes actually reach a Depot? Walk forward from every
 * Extractor along the machines' facings and see where it comes out. On a map this
 * size, "I have been running for four minutes and made nothing" has an answer, and
 * it is usually a belt pointing at the fence.
 */
export function reachesPayout(f) {
  for (const start of f.cells) {
    const s = f.grid[start];
    if (!s || s.kind !== 'ext') continue;
    const seen = new Set();
    const queue = [start];
    while (queue.length) {
      const at = queue.shift();
      if (seen.has(at)) continue;
      seen.add(at);
      const m = f.grid[at];
      if (!m) continue;
      if (m.kind === 'depot') return true;
      for (const d of exitDirs(m)) {
        const to = landingOf(f, m.front ?? at, m, d);
        if (to >= 0) queue.push(to);
      }
    }
  }
  return false;
}

export function drainFx(f, cap = 64) {
  const out = f.fx.slice(0, cap);
  f.fx.length = 0;
  return out;
}
