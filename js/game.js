/**
 * game.js — authoritative simulation. Runs on the host only.
 *
 * A factory is a serpentine line of SLOT_COUNT slots. Gizmos enter at a
 * Creator, walk rightward through each installed machine, and are sold when
 * they fall off the end of the unlocked run. Clients send intents
 * (buy / upgrade / sell / unlock); nothing here ever trusts a client for money.
 */

import { MACHINES, BY_ID, TIERS, MAX_TIER, MAX_LEVEL, stats, upgradeCost, sellRefund, investedIn } from './machines.js';

export const SLOT_COUNT = 12;
export const START_SLOTS = 5;
export const START_CASH = 450;
export const ROUND_SECONDS = 90;
export const INTERMISSION_SECONDS = 15;
export const DEFAULT_ROUNDS = 5;
export const CONTRACT_COUNT = 3;

/** Base seconds a gizmo spends crossing a slot that has no machine in it. */
const BASE_TRANSIT = 1.1;
/** A lone gizmo waiting in a multi-input Converter gives up after this long. */
const MERGE_STALL = 7;
/** Power shortfall never stops the line dead — it crawls. */
const MIN_POWER_FACTOR = 0.15;

export const unlockCost = index => Math.round(320 * Math.pow(2.15, index - START_SLOTS));

/* ------------------------------------------------------------- factories --- */

export function newFactory(seat, name) {
  return {
    seat,
    name,
    cash: START_CASH,
    unlocked: START_SLOTS,
    slots: Array.from({ length: SLOT_COUNT }, () => null),
    earned: 0,          // lifetime sale revenue, for the results screen
    shipped: 0,         // lifetime gizmos sold
    delivered: [0, 0, 0, 0, 0, 0], // per-tier deliveries, reset each round
    connected: true,
  };
}

/** A slot holds: { id, level, buf:[gizmo], out:gizmo|null, timer, stall } */
function newSlot(id) {
  return { id, level: 1, buf: [], out: null, timer: 0, stall: 0 };
}

let gizmoSeq = 1;
const newGizmo = tier => ({ g: gizmoSeq++, tier, prog: 0 });

/* --------------------------------------------------------------- derived --- */

/** Line-wide totals: power balance, speed bonus, buffer bonus, value bonus. */
export function derive(f) {
  let draw = 0, supply = 0, speed = 0, cap = 0, value = 0;
  for (let i = 0; i < f.unlocked; i++) {
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

  // Walk downstream-first so a slot frees up before its upstream neighbour
  // tries to push into it. Iterating the other way would halve throughput.
  for (let i = f.unlocked - 1; i >= 0; i--) {
    const slot = f.slots[i];

    // 1. Push anything that is finished into the next slot, or off the end.
    if (slot && slot.out) {
      if (i === f.unlocked - 1) {
        sales.push(sell(f, slot.out, d));
        slot.out = null;
      } else {
        const next = f.slots[i + 1];
        if (occupancy(f, i + 1) < slotCapacity(next, d)) {
          const g = slot.out;
          slot.out = null;
          g.prog = 0;
          if (next) next.buf.push(g);
          else ((f.pass ||= {}), (f.pass[i + 1] ||= []).push(g));
        }
      }
    }
    if (!slot) continue;

    const m = BY_ID[slot.id];
    const s = stats(m, slot.level);
    const slotTime = m.kind === 'converter' ? s.time : transit;

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

    // 4. Creators emit into their own slot.
    if (m.kind === 'creator') {
      slot.timer += step;
      if (slot.timer >= s.interval) {
        slot.timer = 0;
        if (slot.buf.length < slotCapacity(slot, d)) slot.buf.push(newGizmo(s.tier));
      }
    }
  }
  return sales;
}

/** How many gizmos are sitting in slot i, whether or not a machine is there. */
function occupancy(f, i) {
  const slot = f.slots[i];
  return slot ? slot.buf.length : (f.pass?.[i]?.length || 0);
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

  for (let i = f.unlocked - 1; i >= 0; i--) {
    const q = f.pass[i];
    if (!q || !q.length) continue;
    for (const g of q) g.prog = Math.min(1, g.prog + step / transit);
    while (q.length && q[0].prog >= 1) {
      if (i === f.unlocked - 1) { sales.push(sell(f, q.shift(), d)); continue; }
      const next = f.slots[i + 1];
      if (occupancy(f, i + 1) >= slotCapacity(next, d)) break;
      const g = q.shift();
      g.prog = 0;
      if (next) next.buf.push(g);
      else (f.pass[i + 1] ||= []).push(g);
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

export function buy(f, stockMap, slotIndex, machineId) {
  const m = BY_ID[machineId];
  if (!m) return { ok: false, msg: 'No such machine' };
  if (slotIndex < 0 || slotIndex >= f.unlocked) return { ok: false, msg: 'Slot is locked' };
  if (f.slots[slotIndex]) return { ok: false, msg: 'Slot is occupied' };
  if ((stockMap[machineId] ?? 0) <= 0) return { ok: false, msg: 'Out of stock' };
  if (f.cash < m.cost) return { ok: false, msg: 'Not enough money' };

  f.cash -= m.cost;
  stockMap[machineId] -= 1;
  f.slots[slotIndex] = newSlot(machineId);
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

export function unlockSlot(f) {
  if (f.unlocked >= SLOT_COUNT) return { ok: false, msg: 'Line is fully extended' };
  const price = unlockCost(f.unlocked);
  if (f.cash < price) return { ok: false, msg: 'Not enough money' };
  f.cash -= price;
  f.unlocked += 1;
  return { ok: true, msg: 'Line extended' };
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
 */
export function packFactory(f) {
  const d = derive(f);
  const gizmos = [];
  for (let i = 0; i < f.unlocked; i++) {
    const slot = f.slots[i];
    if (slot) {
      for (const g of slot.buf) gizmos.push([i, r2(g.prog), g.tier]);
      if (slot.out) gizmos.push([i, 1, slot.out.tier]);
    }
    for (const g of f.pass?.[i] || []) gizmos.push([i, r2(g.prog), g.tier]);
  }
  return {
    cash: Math.round(f.cash),
    unlocked: f.unlocked,
    slots: f.slots.map(s => (s ? [s.id, s.level] : null)),
    gizmos,
    power: [d.draw, d.supply, d.powerFactor],
    bonus: [d.speedBonus, d.capBonus, d.valueBonus],
    shipped: f.shipped,
  };
}

const r2 = v => Math.round(v * 100) / 100;
