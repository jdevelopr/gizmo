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
  cellOf, cx, cy, inWorld, claimMin, claimCells, rng, hashSeed,
} from './machines.js';

const SLAG = 0, SAP = 8;

/** How many patches of each ore the world holds. */
const SLAG_PATCHES = 18;
const SAP_PATCHES = 6;

/** Richness at the middle of the map and out at the rim. */
const RICH_MIN = 0.8;
const RICH_MAX = 2.6;

/**
 * How far apart the two ores are kept.
 *
 * Slag and Sap used to be scattered by the same rule with three slots between any
 * two patches, which meant a Sap patch could sit next to a Slag one and the whole
 * Part-and-Product half of the game — two feeds, two lines, an Assembler where
 * they meet — collapsed into putting two Extractors side by side. That is not a
 * logistics problem, it is a shrug.
 *
 * So a patch of one ore now clears a wide berth around every patch of the other,
 * and no Sap appears anywhere near the middle at all. Running a Part line is an
 * expedition: a long belt haul across bought land, or an outpost out at the patch
 * with its own Generator and its own fuel, which is the most interesting thing
 * this game asks anybody to build.
 */
const ORE_GAP = 10;         // between patches of different ore
const SAME_GAP = 3;         // between patches of the same ore
const SAP_MIN_RING = 12;    // no Sap closer than this to the centre

/**
 * No bedrock within this of the centre. It used to be derived from the size of the
 * opening claim, which was fine when that was ten slots and useless now it is
 * three — the first few rings you buy have to be worth buying.
 */
const OPENING_RADIUS = 6;

/* ------------------------------------------------------------------- start --- */

/**
 * The opening, in world coordinates. Everything here is deliberate: an extractor
 * on ore, six slots of belt, and a depot at the end of them. It is the smallest
 * complete factory — it makes a dollar a second and teaches every verb in the game
 * except power, which is the first thing you will want to fix.
 */
export function startPlan() {
  const lo = claimMin(CLAIM_START);
  const row = lo + Math.floor(CLAIM_START / 2);
  const belts = [];
  for (let x = lo + 1; x < lo + CLAIM_START - 1; x++) belts.push(cellOf(x, row));
  return {
    ext: cellOf(lo, row),
    depot: cellOf(lo + CLAIM_START - 1, row),
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
  // The opening patch, by hand. It is centred on the starting Extractor and boxed
  // to a square a few rings wide, so the nine slots you begin with are mostly ore
  // and the first rings you buy are more of it — the answer to "where does the
  // second Extractor go" is never a question in the first five minutes.
  const c = Math.round((WORLD - 1) / 2);
  const home = { lo: c - 4, hi: c + 4 };
  // Every one of the opening nine slots is Slag. On a three-slot claim there is no
  // room to be picky about where the second Extractor goes, so the map does not
  // ask: the whole starting square is ore, and the patch grows outward from it
  // into the first few rings you will buy.
  const opening = claimCells(CLAIM_START);
  for (const i of opening) {
    patch[i] = SLAG;
    rich[i] = 0.92 + rnd() * 0.18;
    terrain[i] = OPEN;
  }
  patches.push(growPatch(rnd, patch, rich, SLAG, start.ext, 30, 1.0, terrain, home, opening));

  // One guaranteed Sap patch, out past the ring where Sap is allowed to exist at
  // all, so every world has a Part line in it somewhere findable.
  const sapSeed = ringSlot(rnd, patch, SAP_MIN_RING + 2, SAP);
  if (sapSeed >= 0) patches.push(growPatch(rnd, patch, rich, SAP, sapSeed, 16, 1.25, terrain));

  // Sap is scattered *first*, and this matters. Slag is the commoner ore and gets
  // the whole map to spread over; if it goes down first it takes all the room and
  // the wide berth every Sap patch needs leaves nowhere to put them, which came
  // out as worlds holding two Sap patches in one corner and nothing anywhere else.
  scatterPatches(rnd, patch, rich, patches, terrain, SAP, SAP_PATCHES);
  scatterPatches(rnd, patch, rich, patches, terrain, SLAG, SLAG_PATCHES);

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
  const c = Math.round((WORLD - 1) / 2);
  const opening = claimCells(CLAIM_START);
  for (const i of opening) { patch[i] = SLAG; rich[i] = 1; terrain[i] = OPEN; }
  patches.push(growPatch(rnd, patch, rich, SLAG, start.ext, 30, 1.0, terrain,
    { lo: c - 4, hi: c + 4 }, opening));
  patches.push(growPatch(rnd, patch, rich, SAP, cellOf(c + SAP_MIN_RING + 2, c), 16, 1.25, terrain));
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
    // Bedrock never starts within the opening radius — the first rings you buy
    // should be a factory, not a maze — and a clump that wanders in arrives as
    // rubble, which you can pay to be rid of.
    const opening = OPENING_RADIUS / c;
    const kind = (ring > opening && rnd() < 0.36 + ring * 0.24) ? BEDROCK : RUBBLE;
    const size = 2 + Math.floor(rnd() * (2 + ring * 9));
    let x = x0, y = y0;
    for (let s = 0; s < size; s++) {
      if (inWorld(x, y)) {
        const i = cellOf(x, y);
        const home = Math.max(Math.abs(x - c), Math.abs(y - c)) <= OPENING_RADIUS;
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
function growPatch(rnd, patch, rich, ty, seedCell, size, centreRich, terrain, box = null, from = null) {
  if (!from && patch[seedCell] >= 0) return { ty, cells: [], x: cx(seedCell), y: cy(seedCell), rich: 0 };
  const cells = [];
  const frontier = [];
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

  // `from` continues an existing run of the same ore rather than starting a new
  // one — it is how the hand-placed opening nine become the middle of a proper
  // patch instead of a square of ore with a seam round it.
  if (from) { for (const i of from) { cells.push(i); frontier.push(i); } }
  else { take(seedCell); frontier.push(seedCell); }
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
  // Slag may start just outside the hand-placed opening blob; Sap is kept well
  // away from the middle entirely, so the Part line is somewhere you go to.
  const inner = ty === SAP ? SAP_MIN_RING : OPENING_RADIUS;
  for (let k = 0; k < count; k++) {
    let seedCell = -1;
    for (let guard = 0; guard < 300 && seedCell < 0; guard++) {
      const x = Math.floor(rnd() * WORLD), y = Math.floor(rnd() * WORLD);
      const ring = Math.max(Math.abs(x - c), Math.abs(y - c));
      if (ring < inner) continue;
      const i = cellOf(x, y);
      if (patch[i] >= 0) continue;
      if (tooClose(patch, x, y, ty)) continue;
      seedCell = i;
    }
    if (seedCell < 0) continue;
    const ring = Math.max(Math.abs(cx(seedCell) - c), Math.abs(cy(seedCell) - c)) / c;
    const size = Math.round((ty === SLAG ? 10 : 8) + rnd() * (ty === SLAG ? 20 : 12));
    patches.push(growPatch(rnd, patch, rich, ty, seedCell, size, richAt(ring), terrain));
  }
}

/**
 * Is this too close to something? A patch of the *same* ore only needs daylight
 * between it and its neighbour; a patch of the *other* ore needs a wide berth, so
 * that joining the two feeds is always a belt run rather than a coincidence.
 */
function tooClose(patch, x, y, ty) {
  for (let dy = -ORE_GAP; dy <= ORE_GAP; dy++) {
    for (let dx = -ORE_GAP; dx <= ORE_GAP; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!inWorld(nx, ny)) continue;
      const p = patch[cellOf(nx, ny)];
      if (p < 0) continue;
      if (p !== ty) return true;
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= SAME_GAP) return true;
    }
  }
  return false;
}

/** A free slot roughly `ring` out from the centre, in some random direction. */
function ringSlot(rnd, patch, ring, ty) {
  for (let guard = 0; guard < 200; guard++) {
    const a = rnd() * Math.PI * 2;
    const r = ring + rnd() * 4;
    const x = Math.round((WORLD - 1) / 2 + Math.cos(a) * r);
    const y = Math.round((WORLD - 1) / 2 + Math.sin(a) * r);
    if (!inWorld(x, y)) continue;
    const i = cellOf(x, y);
    if (patch[i] < 0 && !tooClose(patch, x, y, ty)) return i;
  }
  return -1;
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
  const c = (WORLD - 1) / 2;
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
  // How far you have to expand before a Part line is even possible, and how well
  // separated the two ores actually came out.
  const sapRings = w.patches
    .filter(p => p.ty === SAP && p.cells.length)
    .map(p => Math.max(Math.abs(p.x - c), Math.abs(p.y - c)));
  let closestPair = Infinity;
  for (const a of w.patches) {
    if (!a.cells.length) continue;
    for (const b of w.patches) {
      if (b === a || a.ty === b.ty || !b.cells.length) continue;
      closestPair = Math.min(closestPair, Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
    }
  }
  return {
    seed: w.seed,
    slagIn, sapIn, rock, ore,
    patches: w.patches.length,
    slagPatches: w.patches.filter(p => p.ty === SLAG && p.cells.length).length,
    sapPatches: sapRings.length,
    nearestSap: sapRings.length ? Math.min(...sapRings) : Infinity,
    closestDifferentOres: closestPair,
    startOnOre: w.patch[w.start.ext] === SLAG,
    corridorClear,
    bestRich: w.patches.reduce((a, p) => Math.max(a, p.rich), 0),
  };
}

export { SLAG, SAP, RICH_MIN, RICH_MAX, ORE_GAP, SAP_MIN_RING, OPENING_RADIUS };
