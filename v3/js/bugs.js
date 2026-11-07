/**
 * bugs.js — mites, their nests, and the Zappers that keep them off the line.
 *
 * Pure logic, like sim.js: no DOM, no canvas, no timers. `stepBugs` is called from
 * `stepFactory` once a tick, after power has been settled, so a Zapper recharges at
 * whatever speed its grid is actually giving it.
 *
 * The loop is short:
 *
 *   **Noise fills a gauge.** Every Extractor digging, every Generator burning and
 *   every heavy machine working is loud. The louder the factory, the faster the
 *   gauge fills, and every time it fills one swarm leaves the nest nearest to you.
 *   Nothing happens at all for the first few minutes, so the opening is still the
 *   opening.
 *
 *   **Mites chew.** They walk straight at the nearest thing you have built —
 *   belts first, because belts are long, cheap and out on the edges — and eat it.
 *   A damaged machine runs slower; a machine at zero stops until you repair it.
 *   Nothing is destroyed: a broken belt holds what it was carrying.
 *
 *   **Zappers zap.** A Zapper fires at the nearest mite in range, one Ammo is
 *   several shots, and it draws power while it recharges. It will also chip away
 *   at a nest if one is in reach and nothing is moving, and a dead nest pays.
 */

import {
  WORLD, cellOf, cx, cy, inWorld, inClaim, claimed, claimMin, claimMax, OPEN, BEDROCK, MOUNTAIN, VALLEY, SPACE,
  rng, hashSeed, powerMult, hpMult, maxHp, broken, repairCost, NOISE, NOISE_IDLE, noiseLevelMult, SWARM_THRESHOLD, SWARM_COST, PASSIVE,
  SWARM_GRACE, MITE_CAP, MITE, swarmSize, NEST_POP_MIN, NEST_POP_MAX, CREATURES, SKITTER,
  skitterShare, nestSpec, bruteShare, price, WALL_DETOUR,
  nestAnger, nestBrood,
  AMMO_CHARGES, zapRange, zapDamage, zapCool, zapChain, ARC_HOP, PLUMBING,
  CHARGED, CHARGED_MULT, shotsOf, centreOf, TREMOR_COST, tremorCost, DIRS, BEACON_SIZE, BEACON_NOISE, BEACON_DRAW,
  BEACON_ASSAULT_SIZE, BEACON_ASSAULT_BEETLES,
} from './machines.js';
import { beaconHot, beaconCentre, hitBeacon, assaultDue } from './beacon.js';

/* ------------------------------------------------------------------ nests --- */

/** No nest closer to the middle of the map than this, in rings. */
const NEST_MIN_RING = 11;
/** And never closer to each other than this. */
const NEST_GAP = 6;
/** Random nests on top of the ones guarding each Sap patch. */
const NEST_EXTRA = 16;
/** Mite nests guarding each Sap patch. */
const NEST_PER_SAP = 2;
/** Skitter nests, placed by the same rules as the random Mite nests. */
const SKITTER_NESTS = 16;

/**
 * Where the nests are on this world. A pure function of the seed, like the ore —
 * but drawn from a separate stream of random numbers, so adding mites to the game
 * did not move a single ore patch on any existing world.
 *
 * One nest sits near every Sap patch, which is what makes a Part outpost a thing
 * you have to defend, and a few more are scattered out in the far rings.
 */
export function placeNests(w) {
  if (!w || !w.seed) return [];              // the test bench is a peaceful place
  if (w.story && !w.story.bugs) return [];   // and so are the first story worlds
  const rnd = rng(hashSeed((w.seed ^ 0x6d697465) >>> 0));
  const c = (WORLD - 1) / 2;
  const ring = (x, y) => Math.max(Math.abs(x - c), Math.abs(y - c));
  const out = [];
  const ok = (x, y) => {
    if (!inWorld(x, y)) return false;
    const i = cellOf(x, y);
    if (w.terrain[i] !== OPEN || w.patch[i] >= 0) return false;
    if (ring(x, y) < NEST_MIN_RING) return false;
    if (nearBeacon(w.beacon, x, y)) return false;
    return out.every(n => Math.max(Math.abs(cx(n.cell) - x), Math.abs(cy(n.cell) - y)) >= NEST_GAP);
  };
  const add = (x, y, kind = 'mite') => out.push({ cell: cellOf(x, y), hp: NESTS_HP(kind), kind });

  for (const p of w.patches || []) {
    if (p.ty !== 8 || !p.cells.length) continue;
    for (let k = 0; k < NEST_PER_SAP; k++) {
      for (let guard = 0; guard < 80; guard++) {
        const a = rnd() * Math.PI * 2, r = 3 + rnd() * (k ? 5 : 3);
        const x = Math.round(p.x + Math.cos(a) * r), y = Math.round(p.y + Math.sin(a) * r);
        if (ok(x, y)) { add(x, y); break; }
      }
    }
  }
  for (let k = 0; k < NEST_EXTRA; k++) {
    for (let guard = 0; guard < 200; guard++) {
      const x = Math.floor(rnd() * WORLD), y = Math.floor(rnd() * WORLD);
      if (ring(x, y) >= NEST_MIN_RING + 3 && ok(x, y)) { add(x, y); break; }
    }
  }
  // Drawn after every Mite nest, so adding them moved none of those.
  for (let k = 0; k < SKITTER_NESTS; k++) {
    for (let guard = 0; guard < 200; guard++) {
      const x = Math.floor(rnd() * WORLD), y = Math.floor(rnd() * WORLD);
      if (ring(x, y) >= NEST_MIN_RING + 3 && ok(x, y)) { add(x, y, 'skitter'); break; }
    }
  }
  // A story world has its own, smaller, number of nests, and Skitters only once
  // the story has introduced them. Mite nests first, so the cut keeps those.
  if (w.story) {
    const pool = out.filter(n => n.kind === 'mite');
    if (w.story.skitters) {
      const sk = out.filter(n => n.kind === 'skitter');
      const nSk = Math.min(sk.length, Math.round(w.story.nests / 3));
      return [...pool.slice(0, w.story.nests - nSk), ...sk.slice(0, nSk)];
    }
    return pool.slice(0, w.story.nests);
  }
  return out;
}

const NESTS_HP = kind => nestSpec({ kind }).hp;

/**
 * A save from before Skitters, or from before the nest count was doubled, has
 * fewer nests than its seed now makes. Give it the ones it is missing — wherever
 * nothing has been built since, and never crowding a nest it already has.
 */
export function addMissingNests(f) {
  f.nests = f.nests || [];
  for (const n of placeNests(f.world)) {
    if (f.grid[n.cell] || claimed(n.cell, f.claim)) continue;
    if (f.nests.some(o => Math.max(Math.abs(cx(o.cell) - cx(n.cell)), Math.abs(cy(o.cell) - cy(n.cell))) < NEST_GAP)) continue;
    f.nests.push(n);
  }
}

/** No nest within this many slots of the Beacon: the ground round it is yours to fight over. */
const BEACON_NEST_GAP = 9;
function nearBeacon(b, x, y) {
  if (!b) return false;
  const dx = Math.max(b.x0 - x, 0, x - (b.x0 + BEACON_SIZE - 1));
  const dy = Math.max(b.y0 - y, 0, y - (b.y0 + BEACON_SIZE - 1));
  return Math.max(dx, dy) < BEACON_NEST_GAP;
}

/** The living nest on this slot, if there is one. */
export const nestAt = (f, i) => (f.nests || []).find(n => n.cell === i && n.hp > 0) || null;

/** Fresh bug state on a factory. Called by createFactory. */
export function initBugs(f) {
  f.nests = placeNests(f.world);
  f.mites = [];
  f.swarm = 0;          // noise-seconds banked toward the next swarm
  f.noise = 0;          // how loud the factory is right now
  f.waves = 0;          // swarms sent so far
  f.zapped = 0;         // mites killed, lifetime
  f.chewed = 0;         // machines broken, lifetime
  f.nextNest = -1;      // factory time at which the next new nest digs in, -1 = not due
  f.tremor = 0;         // drill-seconds banked toward the next Beetle
  setNestLimit(f);
  f.stirred = 0;        // the "they are stirring" warning has gone out for this swarm
  f.mid = 1;
}

/* ------------------------------------------------------------------ noise --- */

/** How loud the factory is. Machines switched off or chewed through are silent. */
export function noiseOf(f) {
  // `hum` is a fixed background noise, for test benches that need the creatures
  // to stay and fight rather than walk home from a quiet factory.
  let n = f.hum || 0;
  for (const s of noiseSources(f)) n += s.v;
  return n;
}

/**
 * Everything making noise right now, and how much: a burning Generator, a working
 * Extractor, anything mid-job that has a NOISE value, and a Beacon being fed.
 */
export function noiseSources(f) {
  const out = [];
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || m.off || broken(m)) continue;
    const base = NOISE[m.kind];
    if (!base) continue;
    const working = m.kind === 'gen' ? m.fuel > 0
      : (PASSIVE.has(m.kind) || m.kind === 'ext' || m.t > 0);
    const v = base * noiseLevelMult(m.level) * (working ? 1 : NOISE_IDLE);
    const [x, y] = m.cells?.length > 1 ? [cx(i) + 0.5 + (cx(m.front) - cx(i)) / 2, cy(i) + 0.5 + (cy(m.front) - cy(i)) / 2] : [cx(i) + 0.5, cy(i) + 0.5];
    out.push({ x, y, v });
  }
  // A Beacon being fed is the loudest thing in the world.
  if (beaconHot(f)) { const [x, y] = beaconCentre(f); out.push({ x, y, v: BEACON_NOISE }); }
  return out;
}

/**
 * How far a noise carries, in slots: NOISE_BASE plus NOISE_REACH for every point
 * of it. A working Extractor is heard 10 slots away, a burning Generator 12.
 */
export const NOISE_BASE = 4;
export const NOISE_REACH = 6;
export const NOISE_MAX_REACH = 16;

/**
 * The noise heard on every slot of the map: each source adds its loudness, fading
 * to nothing at the edge of its reach. Shown on the noise map; it does not change
 * how swarms work (those still answer to the factory's total noise).
 */
export function noiseField(f) {
  const field = new Float32Array(WORLD * WORLD);
  for (const s of noiseSources(f)) {
    const r = Math.min(NOISE_MAX_REACH, NOISE_BASE + NOISE_REACH * s.v);
    const x0 = Math.max(0, Math.floor(s.x - r)), x1 = Math.min(WORLD - 1, Math.ceil(s.x - 1 + r));
    const y0 = Math.max(0, Math.floor(s.y - r)), y1 = Math.min(WORLD - 1, Math.ceil(s.y - 1 + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
        if (d < r) field[cellOf(x, y)] += s.v * (1 - d / r);
      }
    }
  }
  return field;
}

/** Roughly how many seconds until the next swarm, or Infinity on a quiet factory. */
export function swarmEta(f) {
  if (!f.nests?.some(n => n.hp > 0)) return Infinity;
  const grace = Math.max(0, SWARM_GRACE - f.t);
  if (f.noise < SWARM_THRESHOLD) return Infinity;
  return grace + Math.max(0, SWARM_COST - f.swarm) / f.noise;
}

/* ------------------------------------------------------------------- step --- */

export function stepBugs(f, dt) {
  if (!f.mites) initBugs(f);
  f.noise = noiseOf(f);
  popNests(f);

  // Quiet enough, and the nests settle: the gauge drains, and whatever is out on
  // the map goes home. Loud again, and they come back for you.
  const quiet = f.noise < SWARM_THRESHOLD;
  if (quiet !== !!f.quiet) {
    f.quiet = quiet;
    if (quiet && f.mites.some(mt => !mt.beacon && mt.kind !== 'beetle')) f.fx.push({ k: 'quiet' });
  }
  if (quiet) {
    f.swarm = Math.max(0, f.swarm - SWARM_COST * 0.02 * dt);
    f.stirred = 0;
  } else if (f.t >= SWARM_GRACE && f.nests.some(n => n.hp > 0)) {
    f.swarm += f.noise * dt;
    if (!f.stirred && f.swarm >= SWARM_COST * 0.75) {
      f.stirred = 1;
      f.fx.push({ k: 'stir' });
    }
    if (f.swarm >= SWARM_COST) {
      f.swarm -= SWARM_COST;
      f.stirred = 0;
      sendSwarm(f);
    }
  }

  if (assaultDue(f)) assault(f);
  stepTremor(f, dt);
  stepMites(f, dt);
  stepZappers(f, dt);
}

/**
 * Drilling wakes Beetles. Every Mountain Drill hard at work adds to a tremor, and
 * once it has built up a Beetle burrows out of a mountain being drilled — so the
 * more you drill, the more often, and always right where your drills are.
 */
function stepTremor(f, dt) {
  const active = [];
  for (const i of f.cells) {
    const m = f.grid[i];
    if (m?.kind === 'drill' && !m.off && !broken(m) && m.t > 0) active.push(i);
  }
  if (!active.length || f.t < SWARM_GRACE) return;
  f.tremor = (f.tremor || 0) + active.length * dt;
  if (f.tremor < tremorCost(f.done)) return;
  f.tremor -= tremorCost(f.done);
  const at = active[Math.floor(Math.random() * active.length)];
  const d = f.grid[at].dir | 0;
  const face = cellOf(cx(at) + DIRS[d][0], cy(at) + DIRS[d][1]);
  const id = f.mtn?.[face] ?? -1;
  const cells = id >= 0 ? f.mountains[id].cells : [face];
  const c = cells[Math.floor(Math.random() * cells.length)];
  if (spawnMite(f, cx(c) + 0.5, cy(c) + 0.5, null, 'beetle')) f.fx.push({ k: 'beetle', cell: c });
}

/** One of the three nests of this kind nearest the middle, at random. */
function nearNest(f, kind) {
  const live = f.nests.filter(n => n.hp > 0 && (n.kind || 'mite') === kind);
  if (!live.length) return null;
  const c = (WORLD - 1) / 2;
  live.sort((a, b) => Math.hypot(cx(a.cell) - c, cy(a.cell) - c) - Math.hypot(cx(b.cell) - c, cy(b.cell) - c));
  return live[Math.floor(Math.random() * Math.min(3, live.length))];
}

/**
 * Send one swarm. Mites come from a Mite nest near the factory; from the fifth
 * swarm on, a share of it is Skitters, from a Skitter nest — so a swarm can arrive
 * from two directions at once, the fast half first.
 */
export function sendSwarm(f, size = null) {
  const total = Math.min(size ?? swarmSize(f.noise, f.waves), MITE_CAP - f.mites.length);
  const sNest = nearNest(f, 'skitter');
  const mNest = nearNest(f, 'mite');
  let nSkit = sNest ? Math.round(total * skitterShare(f.waves)) : 0;
  let nMite = total - nSkit;
  if (!mNest) { nSkit += nMite; nMite = 0; }
  if (!sNest) nSkit = 0;
  // Loud enough, and some of the Mites are Brutes.
  const nBrute = nMite > 0 ? Math.max(bruteShare(f.noise) > 0 ? 1 : 0, Math.round(nMite * bruteShare(f.noise))) : 0;
  let sent = 0;
  for (let k = 0; k < nMite; k++) {
    if (spawnMite(f, cx(mNest.cell) + 0.5, cy(mNest.cell) + 0.5, null, k < nBrute ? 'brute' : 'mite')) sent++;
  }
  for (let k = 0; k < nSkit; k++) if (spawnMite(f, cx(sNest.cell) + 0.5, cy(sNest.cell) + 0.5, null, 'skitter')) sent++;
  if (!sent && !mNest && !sNest) return 0;
  // While the Beacon is being fed, most of every swarm is for it.
  if (beaconHot(f)) {
    for (const mt of f.mites.slice(-sent)) if (Math.random() < BEACON_DRAW) mt.beacon = 1;
  }
  f.waves++;
  if (nMite > 0) f.fx.push({ k: 'swarm', n: nMite, cell: mNest.cell, kind: 'mite', brutes: nBrute });
  if (nSkit > 0) f.fx.push({ k: 'swarm', n: nSkit, cell: sNest.cell, kind: 'skitter' });
  return sent;
}

/**
 * An assault on the Beacon: a quarter, a half and three quarters of the way to
 * full, everything the four nearest nests can send comes at it at once, and Beetles
 * burst out of the mountain nearest it. Every one of them is after the Beacon.
 */
export function assault(f) {
  const bc = beaconCentre(f);
  if (!bc) return 0;
  const live = f.nests.filter(n => n.hp > 0)
    .sort((a, b) => Math.hypot(cx(a.cell) - bc[0], cy(a.cell) - bc[1]) - Math.hypot(cx(b.cell) - bc[0], cy(b.cell) - bc[1]))
    .slice(0, 4);
  let n = 0;
  if (live.length) {
    for (let k = 0; k < BEACON_ASSAULT_SIZE; k++) {
      const nest = live[k % live.length];
      const mt = spawnMite(f, cx(nest.cell) + 0.5, cy(nest.cell) + 0.5, null, nest.kind || 'mite');
      if (!mt) break;
      mt.beacon = 1;
      n++;
    }
  }
  // Beetles from the nearest mountain with rock left in it, or from the map's edge.
  let from = null, best = Infinity;
  for (const mtn of f.mountains || []) {
    for (const c of mtn.cells) {
      const d = Math.hypot(cx(c) - bc[0], cy(c) - bc[1]);
      if (d < best) { best = d; from = c; }
    }
  }
  for (let k = 0; k < BEACON_ASSAULT_BEETLES; k++) {
    const x = from != null ? cx(from) + 0.5 : (bc[0] < WORLD / 2 ? 0.5 : WORLD - 0.5);
    const y = from != null ? cy(from) + 0.5 : bc[1];
    const mt = spawnMite(f, x, y, null, 'beetle');
    if (!mt) break;
    mt.beacon = 1;
    n++;
  }
  f.fx.push({ k: 'assault', n });
  return n;
}

/** Put one creature on the map. `hp` defaults to the kind's own. */
export function spawnMite(f, x, y, hp = null, kind = 'mite') {
  if (!f.mites) initBugs(f);
  if (f.mites.length >= MITE_CAP) return null;
  const spec = CREATURES[kind] || MITE;
  const h = hp ?? spec.hp;
  const mt = {
    id: f.mid++,
    kind,
    x: x + (Math.random() - 0.5) * 0.8,
    y: y + (Math.random() - 0.5) * 0.8,
    hp: h, max: h,
    tgt: -1, st: 'walk', rt: 0,
    ox: (Math.random() - 0.5) * 0.5, oy: (Math.random() - 0.5) * 0.5,
    sp: spec.speed * (0.85 + Math.random() * 0.3),
    ph: Math.random() * 10,
    face: 0,
  };
  f.mites.push(mt);
  return mt;
}

/* ------------------------------------------------------------------ mites --- */

/**
 * The thing this mite should go and eat: the nearest machine that is not already
 * chewed through, with belts counted as a good deal nearer than they are.
 */
function pickTarget(f, mt, W = null) {
  let best = -1, score = Infinity;
  // Only what is on the same patch of open ground: across a valley, over a
  // mountain or past bedrock is out of reach (a Wall is not — that can be chewed).
  const home = W ? regionAt(W, mt.x, mt.y) : -1;
  const beltsOnly = mt.kind === 'skitter';
  // A Brute goes for what is worth most, not what is nearest: dearer machines look
  // closer to it, and it ignores belts while there is anything better.
  const brute = mt.kind === 'brute';
  // A Beetle wants your power: Generators first, anything at all if there are none.
  const gensOnly = mt.kind === 'beetle' && f.cells.some(i => f.grid[i]?.kind === 'gen' && !broken(f.grid[i]));
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || broken(m)) continue;
    // A Wall is in the way, not on the menu: it is only chewed to get past it.
    if (m.kind === 'wall') continue;
    // A Skitter eats conveyors and nothing else.
    if (beltsOnly && m.kind !== 'pipe' && m.kind !== 'store') continue;
    if (gensOnly && m.kind !== 'gen') continue;
    const [mx, my] = centreOf(m, i);
    if (home >= 0 && W.region[m.front ?? i] !== home && !(m.cells || []).some(c => W.region[c] === home)) continue;
    const d = Math.hypot(mx - mt.x, my - mt.y);
    const s = brute ? (PLUMBING.has(m.kind) ? d * 50 : d / (1 + price(m) / 150)) : PLUMBING.has(m.kind) ? d * 0.7 : d;
    if (s < score) { score = s; best = i; }
  }
  return best;
}

/* ------------------------------------------------------------------ walls --- */

/*
 * Walls. Creatures otherwise walk straight at what they want; a Wall in the way
 * turns that into a route. Each target gets a distance field over the whole map
 * (Dijkstra, four neighbours) in which a standing Wall costs WALL_DETOUR slots to
 * cross — so a creature walks round when the way round is shorter than that, and
 * chews straight through when it is not, or when there is no way round at all.
 * The fields are kept until a Wall is built, broken or repaired, and live in a
 * WeakMap so they never end up in a save.
 */
const WALLS = new WeakMap();

/** Ground no creature can cross: bedrock, mountains, valleys and open space. */
const SOLID = new Set([BEDROCK, MOUNTAIN, VALLEY, SPACE]);

/**
 * What stands in a creature's way: `blocked` is 1 for a standing Wall (dear to
 * cross, but it can be chewed) and 2 for solid ground (never crossed). `region`
 * numbers the patches of open ground that connect, so a creature never sets its
 * heart on something it could not reach.
 */
function wallState(f) {
  let key = (f.mapRev | 0) + '|';
  for (const i of f.cells) {
    const m = f.grid[i];
    if (m?.kind === 'wall' && !broken(m)) key += i + ',';
  }
  let W = WALLS.get(f);
  if (W && W.key === key) return W;
  const n = WORLD * WORLD;
  // The ground only changes with mapRev, so its half is kept between Wall changes.
  let ground = W && W.rev === f.mapRev ? W.ground : null;
  let region = W && W.rev === f.mapRev ? W.region : null;
  if (!ground) {
    ground = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (SOLID.has(f.terrain[c])) ground[c] = 2;
    region = new Int32Array(n).fill(-1);
    let id = 0;
    const q = new Int32Array(n);
    for (let c = 0; c < n; c++) {
      if (ground[c] || region[c] >= 0) continue;
      let h = 0, t = 0;
      q[t++] = c; region[c] = id;
      while (h < t) {
        const at = q[h++], x = cx(at), y = cy(at);
        for (let d = 0; d < 4; d++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
          const ni = cellOf(nx, ny);
          if (ground[ni] || region[ni] >= 0) continue;
          region[ni] = id; q[t++] = ni;
        }
      }
      id++;
    }
  }
  const blocked = ground.slice();
  const walls = key.slice(key.indexOf('|') + 1);
  for (const sc of walls.split(',')) if (sc) blocked[+sc] = 1;
  W = { key, rev: f.mapRev, ground, region, blocked, fields: new Map() };
  WALLS.set(f, W);
  return W;
}

/** Which patch of open ground a point is on, or -1 for solid ground or off the map. */
function regionAt(W, x, y) {
  const hx = Math.floor(x), hy = Math.floor(y);
  if (!W || hx < 0 || hy < 0 || hx >= WORLD || hy >= WORLD) return -1;
  return W.region[cellOf(hx, hy)];
}

/** Distance (in slots, Walls counted dear) from every slot to the nearest of `sources`. */
function wallField(W, id, sources) {
  let dist = W.fields.get(id);
  if (dist) return dist;
  if (W.fields.size > 96) W.fields.clear();
  const n = WORLD * WORLD;
  dist = new Float32Array(n).fill(Infinity);
  // a plain binary heap of [cost, cell]
  const hc = [], hv = [];
  const push = (c, v) => {
    let k = hc.length; hc.push(c); hv.push(v);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hc[p] <= hc[k]) break;
      [hc[p], hc[k]] = [hc[k], hc[p]]; [hv[p], hv[k]] = [hv[k], hv[p]]; k = p;
    }
  };
  const pop = () => {
    const c = hc[0], v = hv[0];
    const lc = hc.pop(), lv = hv.pop();
    if (hc.length) {
      hc[0] = lc; hv[0] = lv;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1, b = a + 1;
        let s = k;
        if (a < hc.length && hc[a] < hc[s]) s = a;
        if (b < hc.length && hc[b] < hc[s]) s = b;
        if (s === k) break;
        [hc[s], hc[k]] = [hc[k], hc[s]]; [hv[s], hv[k]] = [hv[k], hv[s]]; k = s;
      }
    }
    return [c, v];
  };
  for (const c of sources) if (c >= 0 && c < n) { dist[c] = 0; push(0, c); }
  while (hc.length) {
    const [c, at] = pop();
    if (c > dist[at]) continue;
    const x = cx(at), y = cy(at);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
      const ni = cellOf(nx, ny);
      if (W.blocked[ni] === 2) continue;           // solid ground: never
      // Walking *out of* a Wall slot is what costs: that is the slot being chewed.
      const nc = c + (W.blocked[at] === 1 ? WALL_DETOUR : 1);
      if (nc < dist[ni]) { dist[ni] = nc; push(nc, ni); }
    }
  }
  W.fields.set(id, dist);
  return dist;
}

/** Is the straight line from (x, y) to (tx, ty) free of standing Walls? */
function clearLine(W, x, y, tx, ty) {
  const d = Math.hypot(tx - x, ty - y);
  const steps = Math.ceil(d / 0.25);
  for (let k = 0; k <= steps; k++) {
    const t = steps ? k / steps : 0;
    const sx = Math.floor(x + (tx - x) * t), sy = Math.floor(y + (ty - y) * t);
    if (sx < 0 || sy < 0 || sx >= WORLD || sy >= WORLD) continue;
    if (W.blocked[cellOf(sx, sy)]) return false;
  }
  return true;
}

/**
 * Steer one creature round (or through) the Walls between it and (tx, ty).
 * Returns false when there is nothing in the way, and the ordinary straight walk
 * should run instead.
 */
function steer(f, W, mt, tx, ty, id, sources, dt) {
  if (!W) return false;
  const hx = Math.floor(mt.x), hy = Math.floor(mt.y);
  // Off the map (a creature that has not arrived yet), it walks straight in.
  if (hx < 0 || hy < 0 || hx >= WORLD || hy >= WORLD) return false;
  // Checking the line every frame for every creature is wasted work: it is asked
  // a few times a second, and whenever the Walls change.
  mt.lc = (mt.lc || 0) - dt;
  if (mt.lc <= 0 || mt.lk !== W.key + id) {
    mt.lc = 0.3;
    mt.lk = W.key + id;
    mt.clr = clearLine(W, mt.x, mt.y, tx, ty);
  }
  if (mt.clr) return false;
  const dist = wallField(W, id, sources);
  const here = cellOf(hx, hy);
  if (dist[here] === 0) return false;
  // The neighbouring slot that is nearest the target, diagonals allowed when
  // neither side of the corner is a Wall.
  let best = -1, bd = Infinity;
  for (let d = 0; d < 4; d++) {
    const nx = hx + DIRS[d][0], ny = hy + DIRS[d][1];
    if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
    const ni = cellOf(nx, ny);
    // What it costs to go that way: the slot's own distance, plus the step into it
    // — and stepping into a standing Wall means chewing it.
    if (W.blocked[ni] === 2) continue;
    const c = dist[ni] + (W.blocked[ni] ? WALL_DETOUR : 1);
    if (c < bd) { bd = c; best = ni; }
  }
  for (const [ddx, ddy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = hx + ddx, ny = hy + ddy;
    if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
    if (W.blocked[cellOf(hx + ddx, hy)] || W.blocked[cellOf(hx, hy + ddy)]) continue;
    const ni = cellOf(nx, ny);
    if (!W.blocked[ni] && dist[ni] + 1.2 < bd) { bd = dist[ni] + 1.2; best = ni; }
  }
  // Nowhere to go from here that leads there: stand still rather than walk
  // through the rock.
  if (best < 0 || !isFinite(bd)) { mt.st = 'walk'; return true; }
  const wx = cx(best) + 0.5, wy = cy(best) + 0.5;
  const dx = wx - mt.x, dy = wy - mt.y, d = Math.hypot(dx, dy);
  mt.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
  const wall = W.blocked[best] === 1 ? f.grid[best] : null;
  if (wall && d < 0.8) {
    // Up against a Wall with no better way: chew.
    mt.st = 'chew';
    wall.hp = Math.max(0, (wall.hp ?? maxHp(wall, f.done)) - (CREATURES[mt.kind] || MITE).bite * dt);
    wall.hurt = 1;
    if (wall.hp <= 0) {
      f.chewed++;
      f.fx.push({ k: 'broke', cell: best });
    }
    return true;
  }
  mt.st = 'walk';
  const step = Math.min(d, mt.sp * dt);
  if (d > 0) { mt.x += dx / d * step; mt.y += dy / d * step; }
  return true;
}

function stepMites(f, dt) {
  const W = wallState(f);
  const c = (WORLD - 1) / 2 + 0.5;
  const bAlive = !!f.beacon && !f.beacon.done && f.beacon.hp > 0;
  for (const mt of f.mites) {
    mt.ph += dt * (mt.st === 'chew' ? 14 : 9);
    mt.rt -= dt;
    // Sent for the Beacon: walk to the nearest point on its edge and chew it.
    if (mt.beacon && bAlive) {
      const b = f.beacon;
      const tx = Math.max(b.x0 - 0.15, Math.min(b.x0 + BEACON_SIZE + 0.15, mt.x)) + mt.ox * 0.4;
      const ty = Math.max(b.y0 - 0.15, Math.min(b.y0 + BEACON_SIZE + 0.15, mt.y)) + mt.oy * 0.4;
      if (W) {
        const bc = [];
        for (let yy = 0; yy < BEACON_SIZE; yy++) for (let xx = 0; xx < BEACON_SIZE; xx++) bc.push(cellOf(b.x0 + xx, b.y0 + yy));
        if (steer(f, W, mt, tx, ty, 'beacon', bc, dt)) continue;
      }
      const dx = tx - mt.x, dy = ty - mt.y, d = Math.hypot(dx, dy);
      if (d < 0.2) {
        mt.st = 'chew';
        hitBeacon(f, (CREATURES[mt.kind] || MITE).bite * dt);
      } else {
        mt.st = 'walk';
        const step = Math.min(d, mt.sp * dt);
        mt.x += dx / d * step; mt.y += dy / d * step;
        mt.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      }
      continue;
    }
    if (mt.beacon) mt.beacon = 0;    // nothing left to chew there: back to the factory
    // A quiet factory: Mites and Skitters walk home to the nearest nest and are gone.
    if (f.quiet && mt.kind !== 'beetle') {
      let home = null, hd = Infinity;
      for (const n of f.nests || []) {
        if (n.hp <= 0) continue;
        const d = Math.hypot(cx(n.cell) + 0.5 - mt.x, cy(n.cell) + 0.5 - mt.y);
        if (d < hd) { hd = d; home = n; }
      }
      const tx = home ? cx(home.cell) + 0.5 : (mt.x < c ? -1 : WORLD + 1);
      const ty = home ? cy(home.cell) + 0.5 : mt.y;
      const dx = tx - mt.x, dy = ty - mt.y, d = Math.hypot(dx, dy);
      mt.st = 'walk'; mt.tgt = -1; mt.home = 1;
      if (d < 0.4 || mt.x < -0.5 || mt.x > WORLD + 0.5) { mt.hp = 0; mt.gone = 1; continue; }
      // Home the long way round, too — but a creature with no way home just goes.
      if (home && regionAt(W, mt.x, mt.y) === W.region[home.cell]
        && steer(f, W, mt, tx, ty, 'n' + home.cell, [home.cell], dt)) continue;
      const step = Math.min(d, mt.sp * dt);
      mt.x += dx / d * step; mt.y += dy / d * step;
      mt.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      continue;
    }
    mt.home = 0;
    let m = mt.tgt >= 0 ? f.grid[mt.tgt] : null;
    if (!m || broken(m) || m.kind === 'wall' || (mt.st === 'walk' && mt.rt <= 0)) {
      mt.tgt = pickTarget(f, mt, W);
      mt.rt = 1.5 + Math.random();
      m = mt.tgt >= 0 ? f.grid[mt.tgt] : null;
      if (!m) mt.st = 'walk';
    }
    const [mx, my] = m ? centreOf(m, m.at ?? mt.tgt) : [c, c];
    const tx = m ? mx + mt.ox : c;
    const ty = m ? my + mt.oy : c;
    if (m && steer(f, W, mt, tx, ty, mt.tgt, m.cells || [mt.tgt], dt)) continue;
    // Nothing it can reach: it waits where it is rather than walk through rock.
    if (!m) { mt.st = 'walk'; continue; }
    const dx = tx - mt.x, dy = ty - mt.y;
    const d = Math.hypot(dx, dy);
    if (m && d < 0.12) {
      mt.st = 'chew';
      m.hp = Math.max(0, (m.hp ?? maxHp(m, f.done)) - (CREATURES[mt.kind] || MITE).bite * dt);
      m.hurt = 1;
      if (m.hp <= 0) {
        f.chewed++;
        f.fx.push({ k: 'broke', cell: mt.tgt });
        mt.tgt = -1;
        mt.st = 'walk';
      }
    } else if (d > 0.05) {
      mt.st = 'walk';
      const step = Math.min(d, mt.sp * dt);
      mt.x += dx / d * step;
      mt.y += dy / d * step;
      mt.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
    }
  }
  // The ones that made it home are gone.
  if (f.mites.some(mt => mt.gone)) f.mites = f.mites.filter(mt => !mt.gone);
  for (const i of f.cells) {
    const m = f.grid[i];
    if (m && m.hurt > 0) m.hurt = Math.max(0, m.hurt - dt * 3);
  }
}

/* ---------------------------------------------------------------- zappers --- */

/** How fast this machine's clock runs: its grid, times what the mites left of it. */
const speedHere = (f, m) => powerMult(m.net >= 0 ? m.sat : 0) * hpMult(m, f.done);

function nearestMite(f, x, y, r, skip = null) {
  let best = null, bd = r;
  for (const mt of f.mites) {
    if (mt.hp <= 0 || (skip && skip.has(mt))) continue;
    // Something already chewing gets shot first: it is the one doing the damage.
    const d = Math.hypot(mt.x - x, mt.y - y) - (mt.st === 'chew' ? 0.75 : 0);
    if (d <= bd) { bd = d; best = mt; }
  }
  return best;
}

function stepZappers(f, dt) {
  let dead = false;
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || m.kind !== 'zap') continue;
    if (m.off || broken(m)) continue;
    if (shotsOf(m) <= 0 && m.buf.length) {
      const g = m.buf.shift();
      if (g.ty === CHARGED) m.hot = (m.hot | 0) + AMMO_CHARGES;
      else m.charge += AMMO_CHARGES;
      m.flash = 1;
    }
    if (m.cool > 0) { m.cool = Math.max(0, m.cool - dt * speedHere(f, m)); continue; }
    if (shotsOf(m) <= 0) continue;
    // Charged shots go first, at twice the damage.
    const hot = (m.hot | 0) > 0;
    const shot = zapDamage(m, f.done) * (hot ? CHARGED_MULT : 1);
    const spend = () => { if (hot) m.hot--; else m.charge--; };

    // A Zapper fires from its middle (centreOf handles any footprint).
    const [x, y] = centreOf(m, i);
    const r = zapRange(m, f.done);
    const first = nearestMite(f, x, y, r);
    if (first) {
      const hit = new Set([first]);
      const path = [[x, y], [first.x, first.y]];
      let at = first;
      for (let k = 0; k < zapChain(f.done); k++) {
        const next = nearestMite(f, at.x, at.y, ARC_HOP, hit);
        if (!next) break;
        hit.add(next);
        path.push([next.x, next.y]);
        at = next;
      }
      for (const mt of hit) {
        mt.hp -= shot;
        if (mt.hp <= 0) { dead = true; m.kills = (m.kills || 0) + 1; f.zapped++; f.fx.push({ k: 'kill', x: mt.x, y: mt.y, kind: mt.kind }); }
      }
      f.fx.push({ k: 'zap', cell: i, path, hot });
      spend();
      m.cool = zapCool(m, f.done);
      m.flash = 1;
      continue;
    }
    // Nothing moving. Spend a shot on a nest if one is in reach.
    const nest = (f.nests || []).find(n => n.hp > 0
      && Math.hypot(cx(n.cell) + 0.5 - x, cy(n.cell) + 0.5 - y) <= r);
    if (nest) {
      const dmg = shot;
      nest.hp -= dmg;
      f.fx.push({ k: 'zap', cell: i, path: [[x, y], [cx(nest.cell) + 0.5, cy(nest.cell) + 0.5]], hot });
      spend();
      m.cool = zapCool(m, f.done);
      if (nest.hp <= 0) { killNest(f, nest); continue; }
      // It fights back: every so much damage, a brood comes out for the Zapper.
      nest.anger = (nest.anger || 0) + dmg;
      // The more hurt it is, the less it takes to set one off, and the bigger it is.
      while (nest.anger >= nestAnger(nest)) {
        nest.anger -= nestAnger(nest);
        brood(f, nest, i);
      }
    }
  }
  if (dead) f.mites = f.mites.filter(mt => mt.hp > 0);
}

/**
 * A nest under fire sends out defenders. They are as tough as the swarms of the
 * moment and they know exactly where the shooting is coming from.
 */
function brood(f, nest, zapper) {
  const kind = nest.kind || 'mite';
  let n = 0;
  const size = nestBrood(nest);
  for (let k = 0; k < size; k++) {
    const mt = spawnMite(f, cx(nest.cell) + 0.5, cy(nest.cell) + 0.5, null, kind);
    if (!mt) break;
    // Mites go for the Zapper doing the shooting. Skitters only eat belts, so they
    // go for the belt that feeds it its Ammo — which is worse.
    if (kind === 'mite') { mt.tgt = zapper; mt.rt = 5; }
    n++;
  }
  if (n) f.fx.push({ k: 'brood', cell: nest.cell, n, kind });
}

function killNest(f, nest) {
  nest.hp = 0;
  const pay = nestSpec(nest).bounty;
  f.cash += pay;
  f.earned += pay;
  f.fx.push({ k: 'nest', cell: nest.cell, v: pay, kind: nest.kind || 'mite' });
  f.nests = f.nests.filter(n => n.hp > 0);
}

/**
 * The world's nest limit: how many nests its seed made, and of which kinds. It is
 * worked out from the seed rather than saved, so it is always right for the world.
 */
export function setNestLimit(f) {
  const all = placeNests(f.world);
  f.nestCap = all.length;
  f.nestMix = all.length ? all.filter(n => n.kind === 'skitter').length / all.length : 0;
}

/** Seconds until the next nest, at random. */
const popWait = () => NEST_POP_MIN + Math.random() * (NEST_POP_MAX - NEST_POP_MIN);

/**
 * Whenever there are fewer nests than the world's limit, a new one digs in at a
 * random moment, somewhere random out beyond the fence — at least five slots clear
 * of it, on open ground, and never crowding another nest. It is whichever kind the
 * world is shortest of, so a world keeps its mix of Mite and Skitter nests.
 */
export function popNests(f) {
  if (f.nestCap == null) setNestLimit(f);
  if (f.nests.length >= f.nestCap) { f.nextNest = -1; return; }
  if (f.nextNest < 0) { f.nextNest = f.t + popWait(); return; }
  if (f.t < f.nextNest) return;
  const cell = wildSlot(f);
  if (cell < 0) { f.nextNest = f.t + 30; return; }       // nowhere right now; look again soon
  const sk = f.nests.filter(n => n.kind === 'skitter').length;
  const wantSk = Math.round(f.nestCap * f.nestMix);
  const kind = sk < wantSk ? 'skitter' : 'mite';
  f.nests.push({ cell, hp: NESTS_HP(kind), kind, anger: 0 });
  f.fx.push({ k: 'newNest', cell, kind });
  f.nextNest = f.nests.length < f.nestCap ? f.t + popWait() : -1;
}

/** A random open slot in the wilds where a nest could dig in, or -1. */
function wildSlot(f) {
  const lo = claimMin(f.claim) - 5, hi = claimMax(f.claim) + 5;
  for (let guard = 0; guard < 400; guard++) {
    const x = Math.floor(Math.random() * WORLD), y = Math.floor(Math.random() * WORLD);
    if (x >= lo && x <= hi && y >= lo && y <= hi) continue;
    const i = cellOf(x, y);
    if (f.terrain[i] !== OPEN || f.patch[i] >= 0 || f.grid[i]) continue;
    if (nearBeacon(f.beacon, x, y)) continue;
    if (f.nests.some(n => Math.max(Math.abs(cx(n.cell) - x), Math.abs(cy(n.cell) - y)) < NEST_GAP)) continue;
    return i;
  }
  return -1;
}

/* ----------------------------------------------------------------- repair --- */

const yes = (msg, extra) => ({ ok: true, msg, ...extra });
const no = msg => ({ ok: false, msg });

/** Pay to put one machine back to full health. */
export function repairMachine(f, i) {
  const m = f.grid[i];
  if (!m) return no('Nothing there');
  const c = repairCost(m, f.done);
  if (!c) return no('Not damaged');
  if (f.cash < c) return no(`Repair costs $${c}`);
  f.cash -= c;
  f.spent += c;
  m.hp = maxHp(m, f.done);
  m.flash = 1;
  f.fx.push({ k: 'repair', cell: i, v: c });
  return yes(`Repaired — $${c}`, { cost: c });
}

/** Every damaged machine on the map, and what fixing all of them costs. */
export function damaged(f) {
  const cells = [];
  let cost = 0, out = 0;
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    const c = repairCost(m, f.done);
    if (!c) continue;
    cells.push(i);
    cost += c;
    if (broken(m)) out++;
  }
  return { cells, cost, broken: out };
}

/**
 * Repair everything you can afford, broken machines first, then the most damaged.
 */
export function repairAll(f) {
  const list = damaged(f).cells.map(i => ({ m: f.grid[i], i }));
  list.sort((a, b) => (a.m.hp / maxHp(a.m, f.done)) - (b.m.hp / maxHp(b.m, f.done)));
  let n = 0, spent = 0;
  for (const { i } of list) {
    const r = repairMachine(f, i);
    if (!r.ok) break;
    n++; spent += r.cost;
  }
  if (!n) return no(list.length ? 'Not enough money to repair anything' : 'Nothing is damaged');
  return yes(`${n} repaired — $${spent}`, { n, cost: spent });
}

/** Mites inside your fence right now. */
export function mitesInside(f) {
  let n = 0;
  for (const mt of f.mites || []) if (inClaim(Math.floor(mt.x), Math.floor(mt.y), f.claim)) n++;
  return n;
}

