/**
 * game.js — authoritative simulation. Runs on the host only.
 *
 * A factory is LANES parallel lanes of LANE_SLOTS slots each. Raw gizmos drop
 * onto the head of every operational lane from a built-in intake, travel
 * rightward through each installed machine, and are sold when they fall off
 * the right-hand end of an operational lane. Routers push gizmos sideways
 * into the adjacent lane. Clients send intents (buy / upgrade / sell /
 * lane / flip); nothing here ever trusts a client for money.
 */

import { MACHINES, BY_ID, TIERS, MAX_TIER, MAX_LEVEL, stats, upgradeCost, sellRefund, investedIn } from './machines.js';

export const LANES = 3;
export const LANE_SLOTS = 5;
export const SLOT_COUNT = LANES * LANE_SLOTS;
export const START_LANES = 1;
export const START_CASH = 450;
export const ROUND_SECONDS = 90;
export const INTERMISSION_SECONDS = 15;
export const DEFAULT_ROUNDS = 5;
export const CONTRACT_COUNT = 3;

/** Base seconds a gizmo spends crossing a slot that has no machine in it. */
const BASE_TRANSIT = 1.1;
/** Seconds between free raw gizmos dropping onto the head of each lane. */
export const INTAKE_INTERVAL = 2.6;
/** A lone gizmo waiting in a multi-input Converter gives up after this long. */
const MERGE_STALL = 7;
/** Power shortfall never stops the line dead — it crawls. */
const MIN_POWER_FACTOR = 0.15;

/** Price of opening lane `index` (0-based). Lane 0 comes with the shop floor. */
export const laneCost = index => [0, 1500, 4800][index] ?? Infinity;

export const laneOf = i => Math.floor(i / LANE_SLOTS);
export const posOf = i => i % LANE_SLOTS;

/* ------------------------------------------------------------- factories --- */

export function newFactory(seat, name) {
  return {
    seat,
    name,
    cash: START_CASH,
    lanes: START_LANES,
    slots: Array.from({ length: SLOT_COUNT }, () => null),
    intake: Array.from({ length: LANES }, () => 0), // per-lane emit timers
    earned: 0,          // lifetime sale revenue, for the results screen
    shipped: 0,         // lifetime gizmos sold
    delivered: [0, 0, 0, 0, 0, 0], // per-tier deliveries, reset each round
    connected: true,
  };
}

/** A slot holds: { id, level, dir, buf:[gizmo], out:gizmo|null, timer, stall, flip } */
function newSlot(id, dir = 0) {
  return { id, level: 1, dir, buf: [], out: null, timer: 0, stall: 0, flip: false };
}

let gizmoSeq = 1;
const newGizmo = tier => ({ g: gizmoSeq++, tier, prog: 0 });

/* --------------------------------------------------------------- derived --- */

/** Line-wide totals: power balance, speed bonus, buffer bonus, value bonus. */
export function derive(f) {
  let draw = 0, supply = 0, speed = 0, cap = 0, value = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (laneOf(i) >= f.lanes) continue;
    const slot = f.slots[i];
    if (!slot) continue;
    const m = BY_ID[slot.id];
    const s = stats(m, slot.level);
    draw += s.draw;
    if (m.kind === 'energizer') supply += s.supply;
    if (m.kind === 'mover') speed += s.speed;
    if (m.kind === 'keeper') { cap += s.cap; value += s.value; }
  }
  draw = Math.round(draw * 10) / 10;
  const powerFactor = draw === 0 ? 1
    : supply >= draw ? 1
    : Math.max(MIN_POWER_FACTOR, supply / draw);
  return {
    draw, supply,
    powerFactor: Math.round(powerFactor * 1000) / 1000,
    speedBonus: Math.round(speed * 100) / 100,
    capBonus: cap,
    valueBonus: Math.round(value * 100) / 100,
  };
}

const slotCapacity = (slot, d) => {
  if (!slot) return 1 + d.capBonus;
  const m = BY_ID[slot.id];
  const base = m.kind === 'converter' ? stats(m, slot.level).need : 1;
  return base + d.capBonus;
};

/** How many gizmos are sitting in slot i, whether or not a machine is there. */
function occupancy(f, i) {
  const slot = f.slots[i];
  return slot ? slot.buf.length : (f.pass?.[i]?.length || 0);
}

/**
 * Where does slot i hand its finished gizmo? Returns 'sell', a slot index,
 * or -1 for "blocked / nowhere" (a diverter aimed at a locked lane).
 * Routers throw their gizmo diagonally into the adjacent lane, one step on —
 * the chute costs the same forward distance as the belt would.
 */
function destOf(f, i, slot) {
  const lane = laneOf(i), pos = posOf(i);
  const m = slot ? BY_ID[slot.id] : null;
  if (m && m.kind === 'router' && slot.dir !== 0) {
    const wantSide = m.p.mode === 'divert' || slot.flip;
    if (wantSide) {
      const tl = lane + slot.dir;
      if (tl >= 0 && tl < f.lanes) {
        if (pos === LANE_SLOTS - 1) return 'sell'; // off the far corner
        return tl * LANE_SLOTS + pos + 1;
      }
      if (m.p.mode === 'divert') return -1; // aimed at a wall: jam
    }
  }
  if (pos === LANE_SLOTS - 1) return 'sell';
  return i + 1;
}

/* ------------------------------------------------------------------ tick --- */

/**
 * Advance one factory by dt seconds. Returns the sales made this tick so the
 * caller can settle money and contract progress.
 * @returns {Array<{tier:number, amount:number}>}
 */
export function tickFactory(f, dt) {
  const d = derive(f);
  const sales = [];
  const step = dt * d.powerFactor;
  const transit = BASE_TRANSIT / (1 + d.speedBonus);

  // Walk each lane downstream-first so a slot frees up before its upstream
  // neighbour tries to push into it.
  for (let lane = 0; lane < f.lanes; lane++) {
    for (let pos = LANE_SLOTS - 1; pos >= 0; pos--) {
      const i = lane * LANE_SLOTS + pos;
      const slot = f.slots[i];

      // 1. Push anything that is finished onward, sideways, or off the end.
      if (slot && slot.out) {
        const dest = destOf(f, i, slot);
        if (dest === 'sell') {
          sales.push(sell(f, slot.out, d));
          slot.out = null;
          slot.flip = !slot.flip;
        } else if (dest >= 0) {
          const next = f.slots[dest];
          if (occupancy(f, dest) < slotCapacity(next, d)) {
            const g = slot.out;
            slot.out = null;
            slot.flip = !slot.flip;
            g.prog = 0;
            if (next) next.buf.push(g);
            else ((f.pass ||= {}), (f.pass[dest] ||= []).push(g));
          }
        }
      }
      if (!slot) continue;

      const m = BY_ID[slot.id];
      const s = stats(m, slot.level);
      const slotTime = m.kind === 'converter' ? s.time
        : m.kind === 'router' ? s.time
        : transit;

      // 2. Advance work in progress.
      for (const g of slot.buf) if (g.prog < 1) g.prog = Math.min(1, g.prog + step / slotTime);

      // 3. Complete work.
      if (m.kind === 'converter') {
        const ready = slot.buf.filter(g => g.prog >= 1);
        if (!slot.out && ready.length >= s.need) {
          const taken = ready.slice(0, s.need);
          for (const g of taken) slot.buf.splice(slot.buf.indexOf(g), 1);
          const best = Math.max(...taken.map(g => g.tier));
          // Only gizmos at or below maxIn get promoted; anything richer passes through.
          const tier = best <= s.maxIn ? Math.min(MAX_TIER, best + s.up) : best;
          slot.out = { g: gizmoSeq++, tier, prog: 1 };
          slot.stall = 0;
        } else if (ready.length > 0 && ready.length < s.need) {
          // A half-filled merger would deadlock the line. Let it release.
          slot.stall += dt;
          if (slot.stall > MERGE_STALL && !slot.out) {
            const g = ready[0];
            slot.buf.splice(slot.buf.indexOf(g), 1);
            slot.out = g;
            slot.stall = 0;
          }
        } else slot.stall = 0;
      } else if (!slot.out) {
        const idx = slot.buf.findIndex(g => g.prog >= 1);
        if (idx >= 0) slot.out = slot.buf.splice(idx, 1)[0];
      }
    }
  }

  // 4. Intakes drop raw gizmos onto the head of every operational lane.
  for (let lane = 0; lane < f.lanes; lane++) {
    f.intake[lane] += step;
    if (f.intake[lane] >= INTAKE_INTERVAL) {
      f.intake[lane] = 0;
      const head = lane * LANE_SLOTS;
      if (occupancy(f, head) < slotCapacity(f.slots[head], d)) {
        const g = newGizmo(0);
        const slot = f.slots[head];
        if (slot) slot.buf.push(g);
        else ((f.pass ||= {}), (f.pass[head] ||= []).push(g));
      }
    }
  }
  return sales;
}

/**
 * Empty slots have no state object, so their gizmos live in f.pass. Advance
 * them here, using the same transit time as an installed non-converter.
 */
export function tickEmptySlots(f, dt) {
  const d = derive(f);
  const sales = [];
  const transit = BASE_TRANSIT / (1 + d.speedBonus);
  const step = dt * d.powerFactor;
  if (!f.pass) return sales;

  for (let lane = 0; lane < f.lanes; lane++) {
    for (let pos = LANE_SLOTS - 1; pos >= 0; pos--) {
      const i = lane * LANE_SLOTS + pos;
      const q = f.pass[i];
      if (!q || !q.length) continue;
      for (const g of q) g.prog = Math.min(1, g.prog + step / transit);
      while (q.length && q[0].prog >= 1) {
        if (pos === LANE_SLOTS - 1) { sales.push(sell(f, q.shift(), d)); continue; }
        const next = f.slots[i + 1];
        if (occupancy(f, i + 1) >= slotCapacity(next, d)) break;
        const g = q.shift();
        g.prog = 0;
        if (next) next.buf.push(g);
        else (f.pass[i + 1] ||= []).push(g);
      }
    }
  }
  return sales;
}

function sell(f, g, d) {
  const amount = Math.round(TIERS[g.tier].value * (1 + d.valueBonus));
  f.cash += amount;
  f.earned += amount;
  f.shipped += 1;
  f.delivered[g.tier] += 1;
  return { tier: g.tier, amount };
}

/* ---------------------------------------------------------------- intents --- */
/* Each returns { ok, msg }. The host applies these; clients only request. */

/** The router direction a slot gets by default: away from the nearest wall. */
export function defaultDir(f, slotIndex) {
  const lane = laneOf(slotIndex);
  if (lane + 1 < f.lanes) return 1;
  if (lane - 1 >= 0) return -1;
  return 0;
}

export function buy(f, stockMap, slotIndex, machineId, dir) {
  const m = BY_ID[machineId];
  if (!m) return { ok: false, msg: 'No such machine' };
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return { ok: false, msg: 'No such slot' };
  if (laneOf(slotIndex) >= f.lanes) return { ok: false, msg: 'That lane is not operational' };
  if (f.slots[slotIndex]) return { ok: false, msg: 'Slot is occupied' };
  if ((stockMap[machineId] ?? 0) <= 0) return { ok: false, msg: 'Out of stock' };
  if (f.cash < m.cost) return { ok: false, msg: 'Not enough money' };

  let d = 0;
  if (m.kind === 'router') {
    d = dir === 1 || dir === -1 ? dir : defaultDir(f, slotIndex);
    const tl = laneOf(slotIndex) + d;
    if (d === 0 || tl < 0 || tl >= f.lanes) {
      // With one lane a router still installs; it comes alive when a
      // neighbouring lane opens. Aim it at whatever will exist first.
      d = laneOf(slotIndex) + 1 < LANES ? 1 : -1;
    }
  }

  f.cash -= m.cost;
  stockMap[machineId] -= 1;
  f.slots[slotIndex] = newSlot(machineId, d);
  // Anything loitering on that empty slot keeps moving inside the new machine.
  if (f.pass?.[slotIndex]?.length) {
    f.slots[slotIndex].buf = f.pass[slotIndex].splice(0).map(g => ({ ...g, prog: 0 }));
  }
  return { ok: true, msg: `Installed ${m.code} ${m.name}` };
}

export function upgrade(f, slotIndex) {
  const slot = f.slots[slotIndex];
  if (!slot) return { ok: false, msg: 'Nothing installed' };
  if (slot.level >= MAX_LEVEL) return { ok: false, msg: 'Already at max level' };
  const m = BY_ID[slot.id];
  const price = upgradeCost(m, slot.level);
  if (f.cash < price) return { ok: false, msg: 'Not enough money' };
  f.cash -= price;
  slot.level += 1;
  return { ok: true, msg: `${m.code} to level ${slot.level}` };
}

export function sellMachine(f, stockMap, slotIndex) {
  const slot = f.slots[slotIndex];
  if (!slot) return { ok: false, msg: 'Nothing installed' };
  const m = BY_ID[slot.id];
  const refund = sellRefund(m, slot.level);
  f.cash += refund;
  stockMap[slot.id] = (stockMap[slot.id] ?? 0) + 1;
  f.slots[slotIndex] = null;
  return { ok: true, msg: `Sold ${m.code} for $${refund}` };
}

/** Flip a router to throw at the other neighbouring lane. */
export function flipRouter(f, slotIndex) {
  const slot = f.slots[slotIndex];
  if (!slot) return { ok: false, msg: 'Nothing installed' };
  const m = BY_ID[slot.id];
  if (m.kind !== 'router') return { ok: false, msg: 'Only routers aim' };
  const lane = laneOf(slotIndex);
  const other = -slot.dir;
  if (lane + other < 0 || lane + other >= LANES) return { ok: false, msg: 'Nothing on that side' };
  slot.dir = other;
  return { ok: true, msg: `${m.code} now throws ${other === 1 ? 'down' : 'up'}` };
}

/** Buy the next lane whole: all five of its slots come operational at once. */
export function buyLane(f) {
  if (f.lanes >= LANES) return { ok: false, msg: 'The floor is fully built out' };
  const price = laneCost(f.lanes);
  if (f.cash < price) return { ok: false, msg: 'Not enough money' };
  f.cash -= price;
  f.lanes += 1;
  return { ok: true, msg: `Lane ${f.lanes} is operational` };
}

/** Cash plus half of everything installed — the number that decides the winner. */
export function netWorth(f) {
  let assets = 0;
  for (const slot of f.slots) if (slot) assets += investedIn(BY_ID[slot.id], slot.level) * 0.5;
  return Math.round(f.cash + assets);
}

/* -------------------------------------------------------------- contracts --- */

let contractSeq = 1;

/** Contracts scale with the round so late orders are worth chasing. */
export function makeContract(round) {
  const lo = Math.min(1 + Math.floor(round / 2), 4);
  const tier = lo + Math.floor(Math.random() * 2);
  const t = Math.min(tier, MAX_TIER);
  const count = 3 + Math.floor(Math.random() * 4) + Math.max(0, 3 - t);
  const reward = Math.round(TIERS[t].value * count * (1.7 + round * 0.12));
  return { cid: contractSeq++, tier: t, count, reward, filledBy: null, progress: {} };
}

export function refreshContracts(round) {
  return Array.from({ length: CONTRACT_COUNT }, () => makeContract(round));
}

/**
 * Credit a sale against open contracts. First factory to reach the count wins
 * the whole reward; the contract then closes for everyone.
 * @returns {Array<{contract:object, seat:number}>} newly filled contracts
 */
export function creditContracts(contracts, f, tier) {
  const filled = [];
  for (const c of contracts) {
    if (c.filledBy !== null || c.tier !== tier) continue;
    c.progress[f.seat] = (c.progress[f.seat] || 0) + 1;
    if (c.progress[f.seat] >= c.count) {
      c.filledBy = f.seat;
      f.cash += c.reward;
      f.earned += c.reward;
      filled.push({ contract: c, seat: f.seat });
    }
  }
  return filled;
}

/** Shop stock is shared: what one player buys, nobody else can. */
export function newStock() {
  return Object.fromEntries(MACHINES.map(m => [m.id, m.stock]));
}

/** Between rounds a delivery arrives, topping every line up a little. */
export function restock(stockMap) {
  for (const m of MACHINES) {
    const top = Math.max(1, Math.round(m.stock * 0.4));
    stockMap[m.id] = Math.min(m.stock, (stockMap[m.id] ?? 0) + top);
  }
}

/* ---------------------------------------------------------------- packing --- */

/**
 * Compact per-player snapshot for the wire. Floats are trimmed to two
 * decimals: full precision doubles payload size for no visible benefit.
 * Gizmos carry their id so the renderer can glide them between slots
 * (and across lanes) instead of teleporting.
 */
export function packFactory(f) {
  const d = derive(f);
  const gizmos = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (laneOf(i) >= f.lanes) continue;
    const slot = f.slots[i];
    if (slot) {
      slot.buf.forEach((g, q) => gizmos.push([g.g, i, r2(g.prog), g.tier, q]));
      if (slot.out) gizmos.push([slot.out.g, i, 1, slot.out.tier, 0]);
    }
    (f.pass?.[i] || []).forEach((g, q) => gizmos.push([g.g, i, r2(g.prog), g.tier, q]));
  }
  return {
    cash: Math.round(f.cash),
    lanes: f.lanes,
    slots: f.slots.map(s => (s ? [s.id, s.level, s.dir] : null)),
    gizmos,
    power: [d.draw, d.supply, d.powerFactor],
    bonus: [d.speedBonus, d.capBonus, d.valueBonus],
    shipped: f.shipped,
  };
}

const r2 = v => Math.round(v * 100) / 100;
