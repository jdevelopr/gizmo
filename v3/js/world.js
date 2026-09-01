/**
 * world.js — the map.
 *
 * GIZMO 2 generated a 7x7 plot and its whole job was to decide where three
 * fixtures sat on a fence. GIZMO 3 generates 3,136 slots and has a different job
 * entirely, because the fixtures are gone: what the map decides now is **where the
 * ore is**, and everything downstream of that — where your extractors go, where
 * your generators have to go to reach them, how long the belt run home is, which
 * direction is worth buying land in — falls out of that one decision.
 *
 * Three rules hold it together:
 *
 *   1. **Richness climbs with distance from the middle.** A patch by your opening
 *      claim yields about one gizmo a second; one out at the rim yields three. That
 *      is the entire reason to expand, and it is a gradient rather than a wall, so
 *      you are always choosing between a good patch nearby and a better one you
 *      would have to reach.
 *
 *   2. **Terrain thickens with distance too.** Bedrock is the shape of the world
 *      and never moves; rubble is a chore you can pay to clear. Both are drawn on
 *      land you have not bought, so you can read a ring before you buy it.
 *
 *   3. **The opening is not random.** One Slag patch, one clear corridor and room
 *      for a depot are placed by hand at the centre, because the first ninety
 *      seconds of a factory game should teach the loop rather than the seed.
 */

import {
  WORLD, CLAIM_START, DIRS, OPEN, RUBBLE, BEDROCK,
  cellOf, cx, cy, inWorld, claimMin, rng, hashSeed,
} from './machines.js';

const SLAG = 0, SAP = 8;

/** How many patches of each ore the world holds. */
const SLAG_PATCHES = 22;
const SAP_PATCHES = 13;

/** Richness at the middle of the map and out at the rim. */
const RICH_MIN = 0.8;
const RICH_MAX = 2.6;

/* ------------------------------------------------------------------- start --- */

/**
 * The opening, in world coordinates. Everything here is deliberate: an extractor
 * on ore, six slots of belt, and a depot at the end of them. It is the smallest
 * complete factory — it makes a dollar a second and teaches every verb in the game
 * except power, which is the first thing you will want to fix.
 */
export function startPlan() {
  const c = Math.floor(WORLD / 2);
  const row = c;
  const extX = c - 3;
  const depotX = c + 3;
  const belts = [];
  for (let x = extX + 1; x < depotX; x++) belts.push(cellOf(x, row));
  return {
    ext: cellOf(extX, row),
    depot: cellOf(depotX, row),
    belts,
    row,
  };
}

/* -------------------------------------------------------------- generation --- */

/**
 * Generate one world.
 *
 * @param {number} seed
 * @returns {{seed:number, terrain:Uint8Array, patch:Int8Array, rich:Float32Array,
 *            patches:Array, start:object}}
 */
export function generateWorld(seed = 1) {
  const rnd = rng(hashSeed(seed));
  const n = WORLD * WORLD;
  const terrain = new Uint8Array(n);
  const patch = new Int8Array(n).fill(-1);
  const rich = new Float32Array(n);
  const start = startPlan();

  // Slots the opening needs kept clear of everything the generator does next.
  const sacred = new Set([start.ext, start.depot, ...start.belts]);
  for (const i of [...sacred]) {
    for (let d = 0; d < 4; d++) {
      const x = cx(i) + DIRS[d][0], y = cy(i) + DIRS[d][1];
      if (inWorld(x, y)) sacred.add(cellOf(x, y));
    }
  }

  scatterTerrain(rnd, terrain, sacred);

  const patches = [];
  // The opening patch, by hand: middling richness, big enough for three extractors,
  // sitting exactly where the starting extractor already is.
  const home = { lo: claimMin(CLAIM_START), hi: claimMin(CLAIM_START) + CLAIM_START - 1 };
  patches.push(growPatch(rnd, patch, rich, SLAG, start.ext, 17, 1.0, terrain, home));
  // One Sap patch inside the opening claim as well. Resin sells for a dollar and is
  // useless until Fusers and Assemblers, so having it early costs nothing and means
  // the recipe game is something you can plan toward rather than stumble into. It
  // is seeded in the far corner from the Slag, and hunted for a free slot if the
  // Slag blob happened to grow that way — the opening is the one part of the map
  // that is not allowed to come out wrong.
  const lo = claimMin(CLAIM_START);
  const sapSeed = freeSlot(patch, sacred, cellOf(lo + CLAIM_START - 4, lo + 2), lo, CLAIM_START);
  if (sapSeed >= 0) patches.push(growPatch(rnd, patch, rich, SAP, sapSeed, 13, 0.95, terrain, home));

  scatterPatches(rnd, patch, rich, patches, terrain, SLAG, SLAG_PATCHES);
  scatterPatches(rnd, patch, rich, patches, terrain, SAP, SAP_PATCHES);

  // The corridor is walked last, so nothing placed above it survives on it.
  for (const i of sacred) if (terrain[i] !== OPEN) terrain[i] = OPEN;

  return { seed, terrain, patch, rich, patches, start };
}

/**
 * The world before anyone generated one: no rock, ore only where the opening needs
 * it. Useful as a fixed board for the harnesses and for measuring the economy
 * against a map that cannot flatter it.
 */
export function plainWorld() {
  const n = WORLD * WORLD;
  const terrain = new Uint8Array(n);
  const patch = new Int8Array(n).fill(-1);
  const rich = new Float32Array(n);
  const start = startPlan();
  const patches = [];
  const rnd = rng(7);
  const lo = claimMin(CLAIM_START);
  const home = { lo, hi: lo + CLAIM_START - 1 };
  patches.push(growPatch(rnd, patch, rich, SLAG, start.ext, 17, 1.0, terrain, home));
  const sapSeed = freeSlot(patch, new Set(), cellOf(lo + CLAIM_START - 4, lo + 2), lo, CLAIM_START);
  if (sapSeed >= 0) patches.push(growPatch(rnd, patch, rich, SAP, sapSeed, 13, 0.95, terrain, home));
  return { seed: 0, terrain, patch, rich, patches, start };
}

/**
 * The nearest slot to `want` inside the opening claim that no patch has taken and
 * the starter corridor does not need. Spirals outward, so the answer is as close
 * to where it was wanted as the map allows.
 */
function freeSlot(patch, sacred, want, lo, side) {
  const ok = i => i >= 0 && patch[i] < 0 && !sacred.has(i);
  if (ok(want)) return want;
  const wx = cx(want), wy = cy(want);
  for (let r = 1; r < side; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wx + dx, y = wy + dy;
        if (x < lo || y < lo || x >= lo + side || y >= lo + side) continue;
        const i = cellOf(x, y);
        if (ok(i)) return i;
      }
    }
  }
  return -1;
}

/* ----------------------------------------------------------------- terrain --- */

/**
 * Rock. Thin near the middle so the opening is a factory rather than a maze, and
 * thicker toward the rim so the land you buy late is worth looking at first.
 *
 * It is grown in clumps rather than sprinkled per slot. Independent per-slot noise
 * makes a map that is uniformly slightly annoying; clumps make a map with shapes in
 * it, which is what routing around something is supposed to feel like.
 */
function scatterTerrain(rnd, terrain, sacred) {
  const c = (WORLD - 1) / 2;
  const clumps = Math.round(WORLD * 2.2);
  for (let k = 0; k < clumps; k++) {
    const x0 = Math.floor(rnd() * WORLD), y0 = Math.floor(rnd() * WORLD);
    const ring = Math.max(Math.abs(x0 - c), Math.abs(y0 - c)) / c;   // 0 middle, 1 rim
    // Bedrock never starts inside the opening claim — the first ten minutes should
    // be a factory, not a maze — and a clump that wanders in arrives as rubble,
    // which you can pay to be rid of.
    const opening = (CLAIM_START / 2 + 1) / c;
    const kind = (ring > opening && rnd() < 0.36 + ring * 0.24) ? BEDROCK : RUBBLE;
    const size = 2 + Math.floor(rnd() * (2 + ring * 9));
    let x = x0, y = y0;
    for (let s = 0; s < size; s++) {
      if (inWorld(x, y)) {
        const i = cellOf(x, y);
        const home = Math.max(Math.abs(x - c), Math.abs(y - c)) <= CLAIM_START / 2;
        if (!sacred.has(i)) terrain[i] = (home && kind === BEDROCK) ? RUBBLE : kind;
      }
      const d = DIRS[Math.floor(rnd() * 4)];
      x += d[0]; y += d[1];
    }
  }
}

/* ----------------------------------------------------------------- patches --- */

/** Richness at the centre of a patch this far out, 0 (middle) to 1 (rim). */
const richAt = ring => RICH_MIN + (RICH_MAX - RICH_MIN) * ring;

/**
 * Grow one ore patch outward from its seed slot.
 *
 * This was a random walk to begin with, which is the obvious way to do it and the
 * wrong one: a walk wanders, so what it leaves behind is a smear of loose cells
 * with holes in it, and a map made of those reads as static rather than as
 * geography. Growing from a *frontier* instead — repeatedly pick a cell already in
 * the patch and add one of its empty neighbours — gives compact blobs with ragged
 * edges, which is both what ore looks like and what makes "how many extractors
 * will fit on this patch" a question with an answer.
 */
function growPatch(rnd, patch, rich, ty, seedCell, size, centreRich, terrain, box = null) {
  if (patch[seedCell] >= 0) return { ty, cells: [], x: cx(seedCell), y: cy(seedCell), rich: 0 };
  const cells = [];
  const frontier = [seedCell];
  const sx = cx(seedCell), sy = cy(seedCell);

  const take = i => {
    patch[i] = ty;
    // Richness falls off toward the edge of the blob, with a little jitter, so
    // which slot inside a patch an extractor stands on is worth choosing.
    const d = Math.hypot(cx(i) - sx, cy(i) - sy);
    const fade = 1 - Math.min(0.4, d / Math.max(2, Math.sqrt(size)) * 0.22);
    rich[i] = Math.max(0.45, centreRich * fade * (0.88 + rnd() * 0.26));
    // Ore is ground you can build on: rock lying on it is cleared away, because a
    // patch you cannot stand on is a patch that does not exist.
    if (terrain) terrain[i] = OPEN;
    cells.push(i);
  };

  take(seedCell);
  let guard = 0;
  while (cells.length < size && frontier.length && guard++ < size * 30) {
    // Weighted toward the newest cells, so a blob grows outward rather than
    // filling in a perfect disc.
    const pickAt = Math.floor(Math.pow(rnd(), 0.6) * frontier.length);
    const at = frontier[Math.min(frontier.length - 1, pickAt)];
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx(at) + DIRS[d][0], ny = cy(at) + DIRS[d][1];
      if (!inWorld(nx, ny)) continue;
      // The two patches the opening is built on are boxed into the starting claim,
      // so a blob that would have grown half its cells out onto land you cannot
      // buy for ten minutes grows sideways instead.
      if (box && (nx < box.lo || ny < box.lo || nx > box.hi || ny > box.hi)) continue;
      const ni = cellOf(nx, ny);
      if (patch[ni] < 0) opts.push(ni);
    }
    if (!opts.length) {
      frontier.splice(frontier.indexOf(at), 1);
      continue;
    }
    const next = opts[Math.floor(rnd() * opts.length)];
    take(next);
    frontier.push(next);
  }

  return {
    ty, cells,
    x: Math.round(cells.reduce((a, i) => a + cx(i), 0) / (cells.length || 1)),
    y: Math.round(cells.reduce((a, i) => a + cy(i), 0) / (cells.length || 1)),
    rich: cells.reduce((a, i) => a + rich[i], 0) / (cells.length || 1),
  };
}

/** Scatter the rest of one ore's patches, richer the further out they land. */
function scatterPatches(rnd, patch, rich, patches, terrain, ty, count) {
  const c = (WORLD - 1) / 2;
  const inner = CLAIM_START / 2 + 2;
  for (let k = 0; k < count; k++) {
    let seedCell = -1;
    for (let guard = 0; guard < 40 && seedCell < 0; guard++) {
      const x = Math.floor(rnd() * WORLD), y = Math.floor(rnd() * WORLD);
      const ring = Math.max(Math.abs(x - c), Math.abs(y - c));
      if (ring < inner) continue;                       // the opening is placed by hand
      const i = cellOf(x, y);
      if (patch[i] >= 0) continue;
      if (nearAnotherPatch(patch, x, y, 3)) continue;   // patches want daylight between them
      seedCell = i;
    }
    if (seedCell < 0) continue;
    const ring = Math.max(Math.abs(cx(seedCell) - c), Math.abs(cy(seedCell) - c)) / c;
    const size = Math.round((ty === SLAG ? 10 : 8) + rnd() * (ty === SLAG ? 20 : 12));
    patches.push(growPatch(rnd, patch, rich, ty, seedCell, size, richAt(ring), terrain));
  }
}

function nearAnotherPatch(patch, x, y, r) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inWorld(nx, ny) && patch[cellOf(nx, ny)] >= 0) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ report --- */

/**
 * What a world contains, for the harness and for the world-picker. A world with no
 * ore inside the opening claim, or with its opening corridor blocked, is not a
 * world; `tools/world.mjs` walks hundreds of seeds asking exactly that.
 */
export function surveyWorld(w) {
  const lo = claimMin(CLAIM_START), hi = lo + CLAIM_START - 1;
  let slagIn = 0, sapIn = 0, rock = 0, ore = 0;
  for (let y = lo; y <= hi; y++) {
    for (let x = lo; x <= hi; x++) {
      const i = cellOf(x, y);
      if (w.patch[i] === SLAG) slagIn++;
      else if (w.patch[i] === SAP) sapIn++;
      if (w.terrain[i] !== OPEN) rock++;
    }
  }
  for (let i = 0; i < w.patch.length; i++) if (w.patch[i] >= 0) ore++;
  const corridorClear = [w.start.ext, w.start.depot, ...w.start.belts]
    .every(i => w.terrain[i] === OPEN);
  return {
    seed: w.seed,
    slagIn, sapIn, rock, ore,
    patches: w.patches.length,
    startOnOre: w.patch[w.start.ext] === SLAG,
    corridorClear,
    bestRich: w.patches.reduce((a, p) => Math.max(a, p.rich), 0),
  };
}

export { SLAG, SAP, RICH_MIN, RICH_MAX };
