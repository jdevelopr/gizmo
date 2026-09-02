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
  WORLD, DIRS, TYPES, KINDS, PASSIVE, MAX_LEVEL,
  makeMachine, price, buyCost, upgradeCost, scrapValue, cycleTime, travelTime,
  intake, outputs, exitDirs, sizeOf, capacity, EMPTY_HOLD, drawOf,
  pickInputs, missingFor, canEverAccept,
  cellOf, cx, cy, inClaim, claimed, claimCells, inWorld,
  CLAIM_START, CLAIM_STEP, expandCost, LADDERED, CRATE_CAP,
  balDirs, REROUTES, wants, SCIENCE_RATE, techById, techOpen, levelCap,
  OPEN, RUBBLE, RUBBLE_COST, SCRAP_RATE, powerMult, energyOf, ORE_NAME,
  STALL_BADGE, label, PLUMBING,
} from './machines.js';
import { solveTopology, balancePower } from './power.js';
import { generateWorld } from './world.js';

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
                        // renderer knows to repaint its one big floor canvas               // seconds of factory time elapsed
  };
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
  if (spec.kind === 'ext') { m.mut = f.patch[i]; m.rich = f.rich[i] || 1; }
  f.grid[i] = m;
  f.dirty = true;
  return m;
}

/** Is this slot owned, clear of rock, and therefore part of the running world? */
export const openAt = (f, x, y) =>
  inClaim(x, y, f.claim) && f.terrain[cellOf(x, y)] === OPEN;

/** Rebuild everything derived from the map. Cheap, and only on a real change. */
export function rebuild(f) {
  const cells = [];
  for (let i = 0; i < f.grid.length; i++) if (f.grid[i]) cells.push(i);
  f.cells = cells;
  solveTopology(f);
  relink(f);
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
      // The edge I fire out of, if there is anything there with a mouth...
      if (d === (m.dir | 0) && n.kind !== 'ext') mask |= 1 << d;
      // ...and every edge something fires in through.
      if (exitDirs(n).includes((d + 2) % 4)) mask |= 1 << d;
    }
    m.link = mask;
  }
}

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
  return (f.load[i] || 0) + (m ? machineLoad(m) : 0);
}

function canAccept(f, i, ty) {
  const m = f.grid[i];
  if (m && !wants(m, ty)) return false;
  return slotLoad(f, i) + sizeOf(ty) <= slotCap(f, i) + EPS;
}

const machineTakes = (m, ty) =>
  wants(m, ty) && machineLoad(m) + sizeOf(ty) <= capacity(m) + EPS;

function retally(f) {
  if (f.load.length !== f.grid.length) f.load = new Float64Array(f.grid.length);
  else f.load.fill(0);
  for (const g of f.gizmos) if (g.cell >= 0) f.load[g.cell] += sizeOf(g.ty);
}

/** Does this machine have a job on, finished or otherwise? */
const jobActive = m => m.t > 0 || !!(m.out && m.out.length);

/** How fast this machine's clock is running, given the grid it is on. */
export const speedOf = m => powerMult(m.net >= 0 ? m.sat : 0);

/* ------------------------------------------------------------------- step --- */

export function stepFactory(f, dt) {
  if (dt > 0.25) dt = 0.25;    // a backgrounded tab must never fast-forward
  f.t += dt;

  retally(f);
  if (f.dirty) rebuild(f);
  balancePower(f, dt);

  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    // Switched off. It keeps whatever is in its hands — you have paused it, not
    // emptied it — and it is not stuck, so nothing badges it as stuck.
    if (m.off) { m.blockT = 0; m.waitT = 0; continue; }
    if (PASSIVE.has(m.kind)) { runPassive(f, m, i); continue; }
    const sp = speedOf(m);
    if (jobActive(m)) {
      m.t -= dt * sp;
      if (m.t <= 0) release(f, m, i, sp);
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
      if (m && machineTakes(m, g.ty)) absorb(f, m, g, k);
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
    const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
    if (!openAt(f, nx, ny)) return d;
    if (canAccept(f, cellOf(nx, ny), o.ty)) return d;
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
    const nx = cx(i) + DIRS[d][0], ny = cy(i) + DIRS[d][1];
    if (openAt(f, nx, ny)) f.load[cellOf(nx, ny)] += sizeOf(o.ty);
    sent.push(o);
  }

  if (sent.length) {
    m.flash = 1;
    // A gizmo flies at the speed of the machine that threw it, so a browned-out
    // belt visibly crawls rather than jerking a pixel across at full speed every
    // few seconds. Power is meant to be legible from across the room.
    const dur = travelTime(m) / Math.max(0.05, sp);
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
  const nx = cx(from) + dx, ny = cy(from) + dy;
  const inside = openAt(f, nx, ny);

  f.gizmos.push({
    id: f.nid++, ty: out.ty, cp: out.cp ? 1 : 0, st: 'fly',
    sx: sx + ox, sy: sy + oy, ex: sx + dx + ox, ey: sy + dy + oy,
    x: sx + ox, y: sy + oy,
    p: 0, dur: Math.max(0.02, dur * (1 + n * 0.06)),
    cell: inside ? cellOf(nx, ny) : -1,
    from, exit: inside ? null : out.dir,
  });
}

function arrive(f, g, k) {
  if (g.exit !== null) {
    f.lost++;
    f.fx.push({ k: 'lost', ty: g.ty, x: g.ex, y: g.ey });
    f.gizmos.splice(k, 1);
    return;
  }
  const m = f.grid[g.cell];
  if (m && machineTakes(m, g.ty)) { absorb(f, m, g, k); return; }
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
const AUTO_FACE = new Set(['pipe', 'store', 'bal', 'sort', 'ext']);

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
        // Handing off to a machine is good; firing into one that fires back is not.
        if (exitDirs(nm).includes((d + 2) % 4)) score -= 16;
        else if (nm.kind === 'depot' || nm.kind === 'lab' || nm.kind === 'gen') score += 26;
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
export function buildCheck(f, spec, i) {
  if (!Number.isInteger(i) || i < 0 || i >= f.grid.length) return no('Off the map');
  if (!claimed(i, f.claim)) return no('You do not own this land');
  if (f.terrain[i] === RUBBLE) return no(`Rubble — clear it for $${RUBBLE_COST}`);
  if (f.terrain[i] !== OPEN) return no('Bedrock will not move');
  if (spec.kind === 'ext' && f.patch[i] < 0) return no('An Extractor has to stand on ore');
  // Building over the top of something is allowed, and is the normal way to change
  // your mind about a slot. Whatever was there goes in the crate — unless the crate
  // is full, which is the one thing that can stop it.
  const here = f.grid[i];
  if (here && here.kind !== spec.kind && f.crate.length >= CRATE_CAP) {
    return no('Crate is full — place or scrap something from it first');
  }
  return yes();
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
export function replaceMode(f, spec, i) {
  const here = f.grid[i];
  if (!here) return 'new';
  return here.kind === spec.kind ? 'reaim' : 'replace';
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
  const check = buildCheck(f, spec, i);
  if (!check.ok) return check;

  const mode = replaceMode(f, spec, i);

  // Same kind, same slot: turn it, retune it, and charge nothing. A machine you
  // already own does not have to be bought again to be pointed somewhere else.
  if (mode === 'reaim') {
    const m = f.grid[i];
    const dir = opt.dir != null ? opt.dir : m.dir;
    const mir = opt.mir != null ? (opt.mir ? 1 : 0) : m.mir;
    const mut = (spec.mut != null && spec.kind !== 'ext') ? spec.mut : m.mut;
    if (m.dir === dir && m.mir === mir && m.mut === mut) return yes(null, { cost: 0, machine: m, mode });
    m.dir = dir; m.mir = mir; m.mut = mut;
    m.flash = 1;
    f.fx.push({ k: 'rot', cell: i });
    return yes(null, { cost: 0, machine: m, mode });
  }

  const cost = opt.free ? 0 : buyCost(spec, countKind(f, spec.kind));
  if (f.cash < cost) return no(`Need $${cost}`);

  // Whatever was standing here is put away rather than destroyed.
  let crated = null;
  if (mode === 'replace') {
    crated = f.grid[i];
    toCrate(f, crated);
    f.grid[i] = null;
  }

  f.cash -= cost;
  f.spent += cost;
  const m = placeRaw(f, spec, i);
  if (opt.dir != null) m.dir = opt.dir;
  else autoFace(f, i);
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
  const check = buildCheck(f, m, i);
  if (!check.ok) return check;

  const mode = replaceMode(f, m, i);
  if (mode === 'replace') {
    toCrate(f, f.grid[i]);
    f.grid[i] = null;
  } else if (mode === 'reaim') {
    // Two of the same kind: swap them, so the one you were holding goes down and
    // the one that was there is the one you are now holding.
    toCrate(f, f.grid[i]);
    f.grid[i] = null;
  }

  f.crate.splice(at, 1);
  f.grid[i] = m;
  f.dirty = true;
  if (m.kind === 'ext') { m.mut = f.patch[i]; m.rich = f.rich[i] || 1; }
  if (opt.dir != null) m.dir = opt.dir;
  else autoFace(f, i);
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
  toCrate(f, m);
  f.grid[i] = null;
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
  if (from === to) return yes();
  const m = f.grid[from];
  if (!m) return no('Nothing there');
  if (!claimed(to, f.claim)) return no('You do not own this land');
  if (f.terrain[to] !== OPEN) return no('Something is in the way');
  if (m.kind === 'ext' && f.patch[to] < 0) return no('An Extractor has to stand on ore');
  if (f.grid[to]) {
    // Dropping one machine on another puts the one underneath in the crate, the
    // same as building over it does. Nothing on this map is ever destroyed by
    // accident.
    if (f.crate.length >= CRATE_CAP) return no('Crate is full');
    toCrate(f, f.grid[to]);
    f.grid[to] = null;
  }

  f.grid[from] = null;
  f.grid[to] = m;
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
  f.grid[i] = null;
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
      m.dir = (m.dir + (a.back ? 3 : 1)) % 4;
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
        return no(cap < MAX_LEVEL ? 'Overclocking would raise this' : 'Already maxed');
      }
      const c = upgradeCost(m);
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
      if (f.claim >= WORLD) return no('You own the whole world');
      const c = expandCost(f.claim);
      if (f.cash < c) return no(`Need $${c}`);
      f.cash -= c;
      f.spent += c;
      // The world is even and the claim starts odd, so the last step is a short
      // one rather than a ring that would hang off the edge.
      f.claim = Math.min(WORLD, f.claim + CLAIM_STEP);
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
  if (f.done.includes(id)) return no('Already known');
  if (!techOpen(t, f.done)) return no('Needs earlier research');
  if (f.science < t.cost) return no(`Needs ${t.cost} science`);
  f.science -= t.cost;
  f.done.push(id);
  f.dirty = true;              // reach, output and yield may all have just changed
  f.fx.push({ k: 'tech', name: t.name });
  return yes(`${t.name} complete`);
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
  let waitingFor = null, waitingAt = -1, switchedOff = 0;
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
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
    if (m.net < 0 && drawOf(m) > 0) unpowered++;
  }
  let worst = 1;
  for (const net of f.nets || []) if (net.demand > 0) worst = Math.min(worst, net.sat);
  const jammed = jams(f);
  return {
    blocked, starved, waiting, unpowered, dryGens, gens, depots, exts, worst,
    waitingFor, waitingAt, switchedOff, jams: jammed,
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
    if (!m || m.off || !m.blocked || m.blockT <= STALL_BADGE) continue;
    for (const o of m.out || []) {
      const nx = cx(i) + DIRS[o.dir][0], ny = cy(i) + DIRS[o.dir][1];
      if (!openAt(f, nx, ny)) continue;
      const target = f.grid[cellOf(nx, ny)];
      if (!target || canEverAccept(target, o.ty)) continue;
      out.push({
        cell: i, ty: o.ty, into: cellOf(nx, ny), kind: target.kind,
        why: `${TYPES[o.ty].name} into ${an(label(target))}, which can never take one`,
      });
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
        const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
        if (openAt(f, nx, ny)) queue.push(cellOf(nx, ny));
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
