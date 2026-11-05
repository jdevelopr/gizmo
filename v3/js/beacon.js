/**
 * beacon.js — the Launch Beacon, the end of the game.
 *
 * Pure logic, like sim.js. The Beacon is not a machine in the grid: it is a
 * five-by-five piece of the world, painted onto the ground like a mountain, with
 * four mouths cut into it. sim.js asks `beaconMouth` before throwing a gizmo at a
 * slot it cannot otherwise land on, and hands anything that arrives there to
 * `deliver`. bugs.js asks `beaconHot` to decide whether to come for it, and calls
 * `hitBeacon` when something chews it.
 */

import {
  BEACON_SIZE, BEACON_INPUTS, BEACON_NEED, BEACON_HP, BEACON_LOSS, BEACON_REPAIR,
  BEACON_FED, BEACON_ASSAULTS, beaconLoss, DIRS, cellOf, cx, cy, inWorld, claimed, TYPES,
} from './machines.js';

/** Fresh Beacon state for a factory, from where the world put it. */
export function initBeacon(f) {
  const b = f.world?.beacon;
  if (!b) { f.beacon = null; return; }
  const got = {};
  for (const ty of Object.keys(BEACON_NEED)) got[ty] = 0;
  f.beacon = {
    x0: b.x0, y0: b.y0, got, hp: BEACON_HP,
    fedAt: -1e9,         // factory time of the last delivery
    loss: 0,             // damage banked toward the next lost gizmo
    assaults: 0,         // how many of the progress assaults have come
    done: false,
    doneAt: 0,
  };
}

/** Every slot the Beacon stands on. */
export function beaconCells(f) {
  const b = f.beacon;
  if (!b) return [];
  const out = [];
  for (let y = b.y0; y < b.y0 + BEACON_SIZE; y++) for (let x = b.x0; x < b.x0 + BEACON_SIZE; x++) out.push(cellOf(x, y));
  return out;
}

/** The middle of the Beacon, in world coordinates. */
export const beaconCentre = f => (f.beacon
  ? [f.beacon.x0 + BEACON_SIZE / 2, f.beacon.y0 + BEACON_SIZE / 2] : null);

/** Is this slot part of the Beacon? */
export function onBeacon(f, x, y) {
  const b = f.beacon;
  return !!b && x >= b.x0 && y >= b.y0 && x < b.x0 + BEACON_SIZE && y < b.y0 + BEACON_SIZE;
}

/**
 * The slot just outside each mouth, by the way the mouth faces: a belt on that slot
 * pointing in feeds it.
 */
export function mouthApproach(f, d) {
  const b = f.beacon;
  if (!b) return -1;
  const mid = Math.floor(BEACON_SIZE / 2);
  const mx = d === 0 ? b.x0 + BEACON_SIZE - 1 : d === 2 ? b.x0 : b.x0 + mid;
  const my = d === 1 ? b.y0 + BEACON_SIZE - 1 : d === 3 ? b.y0 : b.y0 + mid;
  const x = mx + DIRS[d][0], y = my + DIRS[d][1];
  return inWorld(x, y) ? cellOf(x, y) : -1;
}

/**
 * Is a gizmo thrown from slot `from` in direction `d` going into one of the
 * Beacon's mouths? Returns the type that mouth takes, or -1.
 */
export function beaconMouth(f, from, d) {
  const b = f.beacon;
  if (!b) return -1;
  const face = (d + 2) % 4;                 // the side of the Beacon it would arrive at
  if (mouthApproach(f, face) !== from) return -1;
  return BEACON_INPUTS[face];
}

/** Would the mouth on this side take one of these right now? */
export function beaconWants(f, side, ty) {
  const b = f.beacon;
  if (!b || b.done || b.hp <= 0) return false;
  if (BEACON_INPUTS[side] !== ty) return false;
  return b.got[ty] < BEACON_NEED[ty];
}

/** Hand one gizmo to the Beacon. */
export function deliver(f, ty) {
  const b = f.beacon;
  if (!b || b.done) return false;
  if (!(ty in BEACON_NEED) || b.got[ty] >= BEACON_NEED[ty]) return false;
  b.got[ty]++;
  b.fedAt = f.t;
  f.fx.push({ k: 'beaconFeed', ty });
  if (progress(f) >= 1) {
    b.done = true;
    b.doneAt = f.t;
    f.fx.push({ k: 'win' });
  }
  return true;
}

/** How full it is overall, 0..1, each input weighted equally. */
export function progress(f) {
  const b = f.beacon;
  if (!b) return 0;
  const keys = Object.keys(BEACON_NEED);
  return keys.reduce((a, ty) => a + Math.min(1, b.got[ty] / BEACON_NEED[ty]), 0) / keys.length;
}

/** Is it being fed — and so loud, and a target? */
export const beaconHot = f => !!f.beacon && !f.beacon.done && f.beacon.hp > 0
  && f.t - f.beacon.fedAt < BEACON_FED;

/**
 * Something is chewing it. It loses health, and every BEACON_LOSS points of damage
 * knocks one delivered gizmo back out — whichever input it has most of, as a share
 * of what that input needs. At zero health it stops taking anything until repaired.
 */
export function hitBeacon(f, dmg) {
  const b = f.beacon;
  if (!b || b.done || b.hp <= 0) return;
  b.hp = Math.max(0, b.hp - dmg);
  b.loss += dmg;
  b.hurt = 1;
  const per = beaconLoss(f.done);
  while (b.loss >= per) {
    b.loss -= per;
    let worst = null, share = 0;
    for (const ty of Object.keys(BEACON_NEED)) {
      const s = b.got[ty] / BEACON_NEED[ty];
      if (b.got[ty] > 0 && s > share) { share = s; worst = ty; }
    }
    if (worst == null) break;
    b.got[worst]--;
    f.fx.push({ k: 'beaconLoss', ty: +worst });
  }
  if (b.hp <= 0) f.fx.push({ k: 'beaconDown' });
}

export const beaconRepairCost = f =>
  (f.beacon && !f.beacon.done ? Math.ceil((BEACON_HP - f.beacon.hp) * BEACON_REPAIR) : 0);

export function repairBeacon(f) {
  const c = beaconRepairCost(f);
  if (!c) return { ok: false, msg: 'The Beacon is not damaged' };
  if (f.cash < c) return { ok: false, msg: `Repairing the Beacon costs $${c}` };
  f.cash -= c;
  f.spent += c;
  f.beacon.hp = BEACON_HP;
  f.fx.push({ k: 'repair', cell: cellOf(f.beacon.x0 + 2, f.beacon.y0 + 2), v: c });
  return { ok: true, msg: `Beacon repaired — $${c}`, cost: c };
}

/** Has progress crossed the next assault mark? Returns true once per mark. */
export function assaultDue(f) {
  const b = f.beacon;
  if (!b || b.done) return false;
  const mark = BEACON_ASSAULTS[b.assaults];
  if (mark == null || progress(f) < mark) return false;
  b.assaults++;
  return true;
}

/** Can a belt reach it yet — do you own the land round any of its mouths? */
export function beaconReachable(f) {
  if (!f.beacon) return false;
  return [0, 1, 2, 3].some(d => { const c = mouthApproach(f, d); return c >= 0 && claimed(c, f.claim); });
}

/** A line of text for each input: "Engines 120 / 500". */
export function beaconLines(f) {
  const b = f.beacon;
  if (!b) return [];
  return Object.entries(BEACON_INPUTS).map(([d, ty]) => ({
    dir: +d, ty, name: TYPES[ty].name, got: b.got[ty], need: BEACON_NEED[ty],
  }));
}
