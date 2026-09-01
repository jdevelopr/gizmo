/**
 * power.js — the grid.
 *
 * The rule, in full:
 *
 *   A **Generator** burns whatever is fed to it and makes kilowatts. Those
 *   kilowatts spread outward from its slot through *touching machines* — any
 *   machine, a conveyor as readily as an Assembler — and stop after a limited
 *   number of hops. Every machine the power reaches is on that generator's grid.
 *   Two generators that reach any machine in common are on the same grid, and
 *   share its load.
 *
 * Three consequences worth stating out loud, because they are the design:
 *
 *   **The fuel line is the power line.** A generator needs a belt bringing it ore,
 *   and that same belt is what carries its power back out into the factory. You
 *   never build a wire; you build plumbing and the electricity follows it. A long
 *   arm reaching for a distant patch is therefore automatically powered along its
 *   whole length — right up until it is longer than the reach, at which point it
 *   needs a generator of its own out at the end, which needs its own fuel, which
 *   is a real and interesting problem.
 *
 *   **Gaps break grids.** Two blocks of factory with one empty slot between them
 *   are two grids, and a generator in one does nothing for the other. One conveyor
 *   laid across the gap merges them. That is the cheapest and most satisfying fix
 *   in the game.
 *
 *   **Nothing switches off.** A machine no generator reaches runs at UNPOWERED
 *   speed — a fifth — forever. That is not a failure state, it is the state a
 *   brand new factory is in, and it is what makes power a thing you *discover* is
 *   worth building rather than a gate you have to pass. What hurts is a brownout:
 *   speed falls with the *square* of how satisfied the grid is, so a grid at 70%
 *   runs at 59% and a grid at 40% runs at 33%. Being short on power is always
 *   worth another generator.
 *
 * The work is split in two, because the two halves change at wildly different
 * rates. `solveTopology` walks the map and decides who is on which grid, and only
 * runs when the map changes. `balancePower` divides supply by demand and burns
 * fuel, and runs every tick.
 */

import {
  DIRS, cellOf, cx, cy, inWorld,
  drawOf, intake, genOutput, genReach, energyOf, powerMult, KINDS,
} from './machines.js';

/**
 * How fast a grid's satisfaction is allowed to move, in units per second. Demand
 * is deliberately defined from what machines *have to do* rather than from how
 * fast they are going — otherwise sat feeds speed feeds demand feeds sat and the
 * whole grid hunts — but a plant switching on still lands as a step, and a step
 * that reads as a flicker on screen reads as a fault. This smooths the picture
 * without ever changing where it settles.
 */
const SAT_RATE = 5;

/* ---------------------------------------------------------------- topology --- */

/**
 * Decide who is on which grid. Call after anything that changes the map: a machine
 * placed, moved, scrapped, upgraded, or research that changes a generator's reach.
 *
 * Writes `f.nets` (one entry per grid) and `f.netOf` (grid id per slot, -1 for
 * none), and stamps `m.net` on every machine.
 */
export function solveTopology(f) {
  const g = f.grid;
  const n = g.length;
  if (!f.netOf || f.netOf.length !== n) f.netOf = new Int32Array(n);
  f.netOf.fill(-1);

  const gens = [];
  for (let i = 0; i < n; i++) {
    const m = g[i];
    if (m) m.net = -1;
    if (m && m.kind === 'gen') gens.push(i);
  }

  // Union-find over generators. Two generators that both reach the same machine
  // are pooled: they share that machine's load whether they were meant to or not,
  // which is exactly how a real grid behaves and exactly what makes "add another
  // generator anywhere on the line" the obvious fix for a brownout.
  const parent = gens.map((_, k) => k);
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const claimedBy = new Int32Array(n).fill(-1);   // first generator to reach each slot
  const served = gens.map(() => []);

  // A shared frontier buffer, so a hundred generators do not allocate a hundred
  // queues on a map this size.
  const seen = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const dist = new Int32Array(n);

  for (let k = 0; k < gens.length; k++) {
    const home = gens[k];
    const reach = genReach(g[home], f.done);
    let head = 0, tail = 0;
    queue[tail] = home; dist[home] = 0; seen[home] = k; tail++;
    while (head < tail) {
      const at = queue[head++];
      served[k].push(at);
      if (claimedBy[at] >= 0) union(k, claimedBy[at]);
      else claimedBy[at] = k;
      if (dist[at] >= reach) continue;
      const x = cx(at), y = cy(at);
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (!inWorld(nx, ny)) continue;
        const ni = cellOf(nx, ny);
        if (seen[ni] === k || !g[ni]) continue;    // an empty slot is a broken wire
        seen[ni] = k;
        dist[ni] = dist[at] + 1;
        queue[tail++] = ni;
      }
    }
  }

  // Collapse the union-find into a dense list of grids.
  const netId = new Map();
  const nets = [];
  for (let k = 0; k < gens.length; k++) {
    const root = find(k);
    if (!netId.has(root)) {
      netId.set(root, nets.length);
      nets.push({ id: nets.length, gens: [], cells: [], supply: 0, demand: 0, sat: 0, hot: 0 });
    }
    const net = nets[netId.get(root)];
    net.gens.push(gens[k]);
    for (const c of served[k]) {
      if (f.netOf[c] === net.id) continue;
      f.netOf[c] = net.id;
      net.cells.push(c);
      if (g[c]) g[c].net = net.id;
    }
  }

  f.nets = nets;
  f.dirty = false;
  return nets;
}

/* ----------------------------------------------------------------- balance --- */

/**
 * Is this machine asking for power right now? A machine with nothing to do draws
 * nothing, which means a starved line is also a cheap one — a grid's demand is
 * what your factory is *doing*, not what you have built. It is also deliberately
 * independent of how fast the machine is currently running: if demand fell as
 * machines slowed, a brownout would relieve itself and the grid would oscillate
 * forever instead of sitting still and being obviously broken.
 */
function busy(m) {
  if (KINDS[m.kind].passive) return false;
  if (m.work.length) return true;
  return m.buf.length >= intake(m);
}

/**
 * One tick of the grid: light the generators, divide supply by demand, burn fuel
 * in proportion to what was actually delivered, and stamp every machine with the
 * satisfaction of the grid it is on.
 *
 * @param {object} f the factory
 * @param {number} dt seconds
 */
export function balancePower(f, dt) {
  const g = f.grid;
  if (f.dirty) solveTopology(f);
  const nets = f.nets || [];

  // 1. Light every generator that has anything left to burn. A generator holding
  //    fuel it has not lit yet lights it now, so a belt arriving after a blackout
  //    brings the grid up on the same tick rather than a tick later.
  for (const net of nets) {
    net.supply = 0;
    net.hot = 0;
    for (const gi of net.gens) {
      const m = g[gi];
      if (!m) continue;
      if (m.fuel <= 0 && m.buf.length) {
        const fuel = m.buf.shift();
        m.fuel = energyOf(fuel.ty, f.done);
        m.flash = 1;
      }
      m.load = 0;
      if (m.fuel > 0) { net.supply += genOutput(m, f.done); net.hot++; }
    }
  }

  // 2. What every grid is being asked for.
  for (const net of nets) net.demand = 0;
  for (let i = 0; i < g.length; i++) {
    const m = g[i];
    if (!m || m.net < 0) continue;
    if (busy(m)) nets[m.net].demand += drawOf(m);
  }

  // 3. Settle each grid, and burn what it actually delivered.
  for (const net of nets) {
    const target = net.demand <= 0 ? 1 : Math.min(1, net.supply / net.demand);
    const k = Math.min(1, dt * SAT_RATE);
    net.sat += (target - net.sat) * k;
    if (Math.abs(net.sat - target) < 0.004) net.sat = target;

    const delivered = Math.min(net.supply, net.demand);
    if (delivered > 0 && net.supply > 0) {
      for (const gi of net.gens) {
        const m = g[gi];
        if (!m || m.fuel <= 0) continue;
        const share = genOutput(m, f.done) / net.supply * delivered;
        m.load = share;
        m.fuel = Math.max(0, m.fuel - share * dt);
      }
    }
  }

  // 4. Stamp it on every machine, so the simulation and the renderer both read one
  //    number and can never disagree about why something is slow.
  for (let i = 0; i < g.length; i++) {
    const m = g[i];
    if (!m) continue;
    m.sat = m.net >= 0 ? nets[m.net].sat : 0;
  }
}

/** The speed multiplier a machine is currently running at, 0.2 to 1. */
export const speedOf = m => powerMult(m.net >= 0 ? m.sat : 0);

/* ------------------------------------------------------------------- views --- */

/**
 * Every slot a generator dropped here would reach, for the build ghost. Answering
 * "will this reach my smelters" before you have spent the money is most of what
 * makes placing a generator a decision rather than a guess.
 *
 * @param {object} f
 * @param {number} at slot the generator would occupy
 * @param {object} spec { level } of the generator being placed
 * @returns {Set<number>}
 */
export function reachFrom(f, at, spec = { level: 1 }) {
  const g = f.grid;
  const reach = genReach(spec, f.done);
  const out = new Set([at]);
  const dist = new Map([[at, 0]]);
  const queue = [at];
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    if (d >= reach) continue;
    const x = cx(cur), y = cy(cur);
    for (let k = 0; k < 4; k++) {
      const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
      if (!inWorld(nx, ny)) continue;
      const ni = cellOf(nx, ny);
      if (out.has(ni) || !g[ni]) continue;
      out.add(ni);
      dist.set(ni, d + 1);
      queue.push(ni);
    }
  }
  return out;
}

/**
 * The whole grid in one line, for the HUD: what every generator on the map is
 * making, what every machine is asking for, and how badly the worst grid is off.
 */
export function powerSummary(f) {
  const nets = f.nets || [];
  let supply = 0, demand = 0, worst = 1, dry = 0, unpowered = 0;
  for (const net of nets) {
    supply += net.supply;
    demand += net.demand;
    if (net.demand > 0) worst = Math.min(worst, net.sat);
    for (const gi of net.gens) if (f.grid[gi] && f.grid[gi].fuel <= 0) dry++;
  }
  for (let i = 0; i < f.grid.length; i++) {
    const m = f.grid[i];
    if (m && m.net < 0 && !KINDS[m.kind].passive && KINDS[m.kind].draw > 0) unpowered++;
  }
  return { supply, demand, worst, nets: nets.length, dry, unpowered };
}
