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
  WORLD, cellOf, cx, cy, inWorld, inClaim, claimed, claimMin, claimMax, OPEN,
  rng, hashSeed, powerMult, hpMult, maxHp, broken, repairCost, NOISE, SWARM_COST,
  SWARM_GRACE, MITE_CAP, MITE, swarmSize, NEST_POP_MIN, NEST_POP_MAX, CREATURES, SKITTER,
  skitterShare, nestSpec,
  nestAnger, nestBrood,
  AMMO_CHARGES, zapRange, zapDamage, zapCool, zapChain, ARC_HOP, PLUMBING,
} from './machines.js';

/* ------------------------------------------------------------------ nests --- */

/** No nest closer to the middle of the map than this, in rings. */
const NEST_MIN_RING = 11;
/** And never closer to each other than this. */
const NEST_GAP = 6;
/** Random nests on top of the ones guarding each Sap patch. */
const NEST_EXTRA = 8;
/** Mite nests guarding each Sap patch. */
const NEST_PER_SAP = 2;
/** Skitter nests, placed by the same rules as the random Mite nests. */
const SKITTER_NESTS = 8;

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
  const rnd = rng(hashSeed((w.seed ^ 0x6d697465) >>> 0));
  const c = (WORLD - 1) / 2;
  const ring = (x, y) => Math.max(Math.abs(x - c), Math.abs(y - c));
  const out = [];
  const ok = (x, y) => {
    if (!inWorld(x, y)) return false;
    const i = cellOf(x, y);
    if (w.terrain[i] !== OPEN || w.patch[i] >= 0) return false;
    if (ring(x, y) < NEST_MIN_RING) return false;
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
  setNestLimit(f);
  f.stirred = 0;        // the "they are stirring" warning has gone out for this swarm
  f.mid = 1;
}

/* ------------------------------------------------------------------ noise --- */

/** How loud the factory is. Machines switched off or chewed through are silent. */
export function noiseOf(f) {
  let n = 0;
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || m.off || broken(m)) continue;
    const v = NOISE[m.kind];
    if (!v) continue;
    if (m.kind === 'gen') { if (m.fuel > 0) n += v; continue; }
    if (m.kind === 'ext' || m.t > 0) n += v;
  }
  return n;
}

/** Roughly how many seconds until the next swarm, or Infinity on a quiet factory. */
export function swarmEta(f) {
  if (!f.nests?.some(n => n.hp > 0)) return Infinity;
  const grace = Math.max(0, SWARM_GRACE - f.t);
  if (f.noise <= 0.01) return Infinity;
  return grace + Math.max(0, SWARM_COST - f.swarm) / f.noise;
}

/* ------------------------------------------------------------------- step --- */

export function stepBugs(f, dt) {
  if (!f.mites) initBugs(f);
  f.noise = noiseOf(f);
  popNests(f);

  if (f.t >= SWARM_GRACE && f.nests.some(n => n.hp > 0)) {
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

  stepMites(f, dt);
  stepZappers(f, dt);
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
  let sent = 0;
  for (let k = 0; k < nMite; k++) if (spawnMite(f, cx(mNest.cell) + 0.5, cy(mNest.cell) + 0.5)) sent++;
  for (let k = 0; k < nSkit; k++) if (spawnMite(f, cx(sNest.cell) + 0.5, cy(sNest.cell) + 0.5, null, 'skitter')) sent++;
  if (!sent && !mNest && !sNest) return 0;
  f.waves++;
  if (nMite > 0) f.fx.push({ k: 'swarm', n: nMite, cell: mNest.cell, kind: 'mite' });
  if (nSkit > 0) f.fx.push({ k: 'swarm', n: nSkit, cell: sNest.cell, kind: 'skitter' });
  return sent;
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
function pickTarget(f, mt) {
  let best = -1, score = Infinity;
  const beltsOnly = mt.kind === 'skitter';
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m || broken(m)) continue;
    // A Skitter eats conveyors and nothing else.
    if (beltsOnly && m.kind !== 'pipe' && m.kind !== 'store') continue;
    const d = Math.hypot(cx(i) + 0.5 - mt.x, cy(i) + 0.5 - mt.y);
    const s = PLUMBING.has(m.kind) ? d * 0.7 : d;
    if (s < score) { score = s; best = i; }
  }
  return best;
}

function stepMites(f, dt) {
  const c = (WORLD - 1) / 2 + 0.5;
  for (const mt of f.mites) {
    mt.ph += dt * (mt.st === 'chew' ? 14 : 9);
    mt.rt -= dt;
    let m = mt.tgt >= 0 ? f.grid[mt.tgt] : null;
    if (!m || broken(m) || (mt.st === 'walk' && mt.rt <= 0)) {
      mt.tgt = pickTarget(f, mt);
      mt.rt = 1.5 + Math.random();
      m = mt.tgt >= 0 ? f.grid[mt.tgt] : null;
      if (!m) mt.st = 'walk';
    }
    const tx = m ? cx(mt.tgt) + 0.5 + mt.ox : c;
    const ty = m ? cy(mt.tgt) + 0.5 + mt.oy : c;
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
    if (m.charge <= 0 && m.buf.length) {
      m.buf.shift();
      m.charge += AMMO_CHARGES;
      m.flash = 1;
    }
    if (m.cool > 0) { m.cool = Math.max(0, m.cool - dt * speedHere(f, m)); continue; }
    if (m.charge <= 0) continue;

    const x = cx(i) + 0.5, y = cy(i) + 0.5;
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
        mt.hp -= zapDamage(m);
        if (mt.hp <= 0) { dead = true; m.kills = (m.kills || 0) + 1; f.zapped++; f.fx.push({ k: 'kill', x: mt.x, y: mt.y, kind: mt.kind }); }
      }
      f.fx.push({ k: 'zap', cell: i, path });
      m.charge--;
      m.cool = zapCool(m);
      m.flash = 1;
      continue;
    }
    // Nothing moving. Spend a shot on a nest if one is in reach.
    const nest = (f.nests || []).find(n => n.hp > 0
      && Math.hypot(cx(n.cell) + 0.5 - x, cy(n.cell) + 0.5 - y) <= r);
    if (nest) {
      const dmg = zapDamage(m);
      nest.hp -= dmg;
      f.fx.push({ k: 'zap', cell: i, path: [[x, y], [cx(nest.cell) + 0.5, cy(nest.cell) + 0.5]] });
      m.charge--;
      m.cool = zapCool(m);
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

