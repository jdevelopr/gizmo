/**
 * blueprint.js — working on many machines at once.
 *
 * Shift-drag draws a box. Whatever is inside it can then be copied, moved,
 * repaired, upgraded, switched off or scrapped in one go, and a copy is a
 * **blueprint**: a list of machines by offset that you carry around in your hand
 * and stamp down as many times as you can afford. A working Armory-and-Zapper
 * outpost, a smelting arm, a whole Engine line — build it once, then paste it.
 *
 * Pure logic, like sim.js. Every placement goes through `build`, so a blueprint
 * can never put anything anywhere a hand could not.
 */

import {
  cellOf, cx, cy, inWorld, claimed, OPEN, buyCost, upgradeCost, levelCap, scrapValue,
  repairCost, maxHp, CRATE_CAP, footprint, sizeKind,
} from './machines.js';
import { build, buildCheck, replaceMode, countKind, rebuild, toCrate, scrapMachine, occupy, vacate } from './sim.js';
import { nestAt } from './bugs.js';

/** Every occupied slot inside the box between two corners. */
export function areaCells(f, a, b) {
  const x0 = Math.min(cx(a), cx(b)), x1 = Math.max(cx(a), cx(b));
  const y0 = Math.min(cy(a), cy(b)), y1 = Math.max(cy(a), cy(b));
  // One entry per machine — its anchor — for every machine any part of which is in the box.
  const out = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const m = f.grid[cellOf(x, y)];
    if (m) out.add(m.at ?? cellOf(x, y));
  }
  return [...out];
}

/** The box round every slot these machines cover. */
function bounds(f, anchors) {
  const all = anchors.flatMap(i => f.grid[i]?.cells || [i]);
  return {
    x0: Math.min(...all.map(cx)), y0: Math.min(...all.map(cy)),
    x1: Math.max(...all.map(cx)), y1: Math.max(...all.map(cy)),
  };
}

/** Unique machine anchors among these slots. */
const anchorsIn = (f, cells) => [...new Set(cells.filter(i => f.grid[i]).map(i => f.grid[i].at ?? i))];

/** The machines in `cells`, as offsets from their top-left corner. */
export function capture(f, cells) {
  const ms = anchorsIn(f, cells);
  if (!ms.length) return null;
  const { x0, y0, x1, y1 } = bounds(f, ms);
  return {
    w: x1 - x0 + 1, h: y1 - y0 + 1,
    parts: ms.map(i => {
      const m = f.grid[i];
      return { dx: cx(i) - x0, dy: cy(i) - y0, kind: m.kind, dir: m.dir | 0, mut: m.mut, mir: m.mir | 0 };
    }),
  };
}

/** Turn a blueprint a quarter clockwise, machines and all. */
export function rotateBp(bp) {
  if (!bp) return bp;
  const h = bp.h;
  // A 2x2's anchor is its top-left slot, which after a quarter turn is a different
  // corner: shift it one back so the building lands on the same four slots.
  const turn = p => ({
    ...p, dx: h - 1 - p.dy - (sizeKind(p.kind) === 'big' ? 1 : 0), dy: p.dx, dir: ((p.dir | 0) + 1) % 4,
  });
  return { ...bp, w: bp.h, h: bp.w, parts: bp.parts.map(turn), held: bp.held && bp.held.map(turn) };
}

/** The slot a part lands on when the blueprint is centred on `at`. */
const landing = (bp, p, at) => {
  const x = cx(at) - Math.floor((bp.w - 1) / 2) + p.dx;
  const y = cy(at) - Math.floor((bp.h - 1) / 2) + p.dy;
  return inWorld(x, y) ? cellOf(x, y) : -1;
};

/**
 * What stamping this blueprint at `at` would do, slot by slot, and what it costs.
 * Prices climb as you go — the fourth Extractor in a paste is priced as the
 * fourth — so the total is what you will actually be charged.
 */
export function plan(f, bp, at) {
  const steps = [];
  let cost = 0;
  const extra = {};
  for (const p of bp.held || bp.parts) {
    const cell = landing(bp, p, at);
    if (cell < 0) { steps.push({ cell, ok: false, p }); continue; }
    const check = buildCheck(f, p, cell, p.dir);
    const mode = replaceMode(f, p, cell, p.dir);
    let c = 0;
    if (!bp.held && mode !== 'reaim') {
      c = buyCost(p, countKind(f, p.kind) + (extra[p.kind] || 0));
      extra[p.kind] = (extra[p.kind] || 0) + 1;
    }
    cost += c;
    steps.push({ cell, ok: check.ok, why: check.msg, mode, cost: c, p });
  }
  return { steps, cost, ok: steps.filter(s => s.ok).length, total: steps.length };
}

/**
 * Stamp a copied blueprint down. Everything it can afford, in order; it stops
 * at the first thing it cannot pay for rather than leaving holes at random.
 */
export function paste(f, bp, at) {
  let placed = 0, spent = 0, skipped = 0;
  for (const p of bp.parts) {
    const cell = landing(bp, p, at);
    if (cell < 0) { skipped++; continue; }
    const r = build(f, { kind: p.kind, mut: p.mut, mir: p.mir }, cell, { dir: p.dir, mir: p.mir });
    if (!r.ok) {
      if (/^Need \$/.test(r.msg)) return { placed, spent, skipped, broke: true };
      skipped++;
      continue;
    }
    placed++;
    spent += r.cost || 0;
  }
  return { placed, spent, skipped, broke: false };
}

/* ------------------------------------------------------------------ moving --- */

/**
 * Pick up everything in the box at once. The machines come off the map and into
 * the blueprint itself — not the crate, which only holds forty — keeping their
 * levels, their health and their settings, and remembering where they came from
 * so that changing your mind puts every one of them back.
 */
export function lift(f, cells) {
  const bp = capture(f, cells);
  if (!bp) return null;
  const ms = anchorsIn(f, cells);
  const { x0, y0 } = bounds(f, ms);
  bp.held = ms.map(i => {
    const m = f.grid[i];
    vacate(f, m);
    m.buf.length = 0; m.work = []; m.out = null; m.t = 0; m.blocked = 0;
    return { dx: cx(i) - x0, dy: cy(i) - y0, kind: m.kind, dir: m.dir | 0, mut: m.mut, mir: m.mir | 0, m, from: i };
  });
  rebuild(f);
  return bp;
}

/** Can a lifted machine stand on this slot? */
function fits(f, m, cell) {
  if (cell < 0) return false;
  const cells = footprint(m.kind, cell, m.dir);
  if (!cells) return false;
  for (const c of cells) {
    if (!claimed(c, f.claim) || f.terrain[c] !== OPEN || nestAt(f, c)) return false;
  }
  if (m.kind === 'ext' && f.patch[cell] < 0) return false;
  return true;
}

/**
 * Put a lifted blueprint down. Each machine lands where the blueprint says if it
 * can stand there; anything already on that slot goes to the crate, the same as
 * building over it. A machine that cannot stand where it is aimed goes home, or to
 * the crate if home has been built over since.
 */
export function drop(f, bp, at) {
  let moved = 0, home = 0;
  const landings = bp.held.map(p => ({ p, cell: landing(bp, p, at) }));
  for (const { p, cell } of landings) {
    const m = p.m;
    m.dir = p.dir;
    if (fits(f, m, cell)) {
      for (const c of footprint(m.kind, cell, m.dir)) {
        const u = f.grid[c];
        if (u && u !== m) { vacate(f, u); toCrate(f, u); }
      }
      occupy(f, m, cell);
      if (m.kind === 'ext') { m.mut = f.patch[cell]; m.rich = f.rich[cell] || 1; }
      moved++;
    } else {
      sendHome(f, p);
      home++;
    }
  }
  rebuild(f);
  f.fx.push({ k: 'move', cell: at });
  return { moved, home };
}

/** Change your mind: every lifted machine goes back where it was. */
export function putBack(f, bp) {
  for (const p of bp.held || []) sendHome(f, p);
  rebuild(f);
}

function sendHome(f, p) {
  const m = p.m;
  m.dir = p.m.dir;
  const home = footprint(m.kind, p.from, m.dir);
  if (home && home.every(c => !f.grid[c])) {
    occupy(f, m, p.from);
    if (m.kind === 'ext') { m.mut = f.patch[p.from]; m.rich = f.rich[p.from] || 1; }
  } else if (f.crate.length < CRATE_CAP) toCrate(f, m);
  else f.crate.push(m);
}

/* ------------------------------------------------------------- bulk verbs --- */

/** Upgrade everything in the box that can go up a level, cheapest first. */
export function upgradeAll(f, cells) {
  const cap = levelCap(f.done);
  const ms = cells.map(i => [i, f.grid[i]]).filter(([, m]) => m && (m.level || 1) < cap)
    .sort((a, b) => upgradeCost(a[1], f.done) - upgradeCost(b[1], f.done));
  let n = 0, spent = 0;
  for (const [i, m] of ms) {
    const c = upgradeCost(m, f.done);
    if (f.cash < c) break;
    f.cash -= c; f.spent += c; spent += c;
    m.level++; m.flash = 1; n++;
    f.fx.push({ k: 'up', cell: i });
  }
  if (n) { f.dirty = true; rebuild(f); }
  return { n, spent, left: ms.length - n };
}

/** What upgrading everything in the box would cost. */
export function upgradeQuote(f, cells) {
  const cap = levelCap(f.done);
  let cost = 0, n = 0;
  for (const i of cells) {
    const m = f.grid[i];
    if (m && (m.level || 1) < cap) { cost += upgradeCost(m, f.done); n++; }
  }
  return { cost, n };
}

export function scrapAll(f, cells) {
  let n = 0, got = 0;
  for (const i of cells) {
    if (!f.grid[i]) continue;
    const r = scrapMachine(f, i);
    if (r.ok) { n++; got += r.refund; }
  }
  return { n, got };
}

export const scrapQuote = (f, cells) =>
  cells.reduce((a, i) => a + (f.grid[i] ? scrapValue(f.grid[i]) : 0), 0);

export function repairQuote(f, cells) {
  let cost = 0, n = 0;
  for (const i of cells) {
    const m = f.grid[i];
    const c = m ? repairCost(m, f.done) : 0;
    if (c) { cost += c; n++; }
  }
  return { cost, n };
}

export function repairArea(f, cells) {
  let n = 0, spent = 0;
  for (const i of cells) {
    const m = f.grid[i];
    const c = m ? repairCost(m, f.done) : 0;
    if (!c || f.cash < c) continue;
    f.cash -= c; f.spent += c; spent += c;
    m.hp = maxHp(m, f.done); m.flash = 1; n++;
    f.fx.push({ k: 'repair', cell: i, v: c });
  }
  return { n, spent };
}

/** Switch the lot off — or, if every one is already off, back on. */
export function toggleArea(f, cells) {
  const ms = cells.map(i => f.grid[i]).filter(Boolean);
  const on = ms.every(m => m.off);
  for (const m of ms) { m.off = on ? 0 : 1; m.blocked = 0; m.blockT = 0; m.waitT = 0; }
  return { n: ms.length, off: !on };
}

