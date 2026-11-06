/**
 * render.js — the pixel renderer, with a camera.
 *
 * GIZMO 1 and 2 drew a whole factory into a fixed 224-pixel square. Three thousand
 * slots cannot be drawn that way, so this is a new renderer built on three ideas:
 *
 *   **The ground is drawn once.** Terrain, ore and the fence go onto one big
 *   offscreen canvas, one world-pixel per world-pixel, and every frame blits the
 *   visible rectangle of it. It is only redrawn when the map actually changes —
 *   you buy a ring, you clear a rock — which is a few times an hour rather than
 *   sixty times a second.
 *
 *   **Machine bodies are cached tiles.** A machine's casing depends only on its
 *   kind, facing, level, setting and animation frame, so it is drawn once into a
 *   32x32 offscreen canvas and thereafter blitted. What is *not* cached is
 *   everything that changes per frame — cargo, progress, badges, the power tint —
 *   and those are a handful of rectangles each.
 *
 *   **Detail falls away with zoom.** Below 24 pixels a slot there is no point
 *   drawing a bolt, so machines become their body colour and a facing tick, and
 *   below 12 they become a single square. That is what makes the whole-world view
 *   cost the same as the close-up one.
 *
 * The art itself is authored on a 32-pixel grid and every rectangle lands on a
 * whole pixel, exactly as in GIZMO 1. Text is the one exception: it is drawn on a
 * separate overlay canvas at the display's own resolution, because rasterising a
 * small font and magnifying it is what makes pixel UI look soft.
 */

import {
  WORLD, CELL, DIRS, TYPES, KINDS, RAW, RECIPES,
  cx, cy, cellOf, inWorld, claimMin, claimMax, OPEN, RUBBLE, BEDROCK, MOUNTAIN, VALLEY, BEACON, SPACE,
  BEACON_SIZE, BEACON_INPUTS, BEACON_NEED, BEACON_HP, surveyed, sizeKind, footprint,
  capacity, intake, PASSIVE, PLUMBING, genOutput, drawOf, missingFor, STALL_BADGE,
  ARMORY, broken, maxHp, AMMO_CHARGES, nestSpec, shotsOf,
} from './machines.js';
import { heldTypes, machineLoad, contents } from './sim.js';
import { progress as beaconProgress } from './beacon.js';

/* ---------------------------------------------------------------- palette --- */

export const INK = '#0b0d16';
export const FLOOR = '#171a29';
export const FLOOR2 = '#1b1f30';
export const LINE = '#242a3f';
export const DIM = '#7c86a6';
export const DIRT = '#0d1018';      // land you have not bought
export const DIRT2 = '#111524';
export const FENCE = '#5a6690';     // the edge of your claim
export const ROCK = '#4a4433';      // rubble: clearable
export const ROCK2 = '#6b6146';
export const STONE = '#2c3346';     // bedrock: never moves
export const STONE2 = '#454f6b';
export const GOLD = '#ffcd75';
export const HOT = '#ff8a4a';

/** Ore, drawn as speckle on the ground. Keyed by gizmo type. */
const ORE_COLOR = {
  0: ['#3a4152', '#59627a', '#7d879f'],     // Slag
  8: ['#1e4a41', '#2f7a68', '#49b394'],     // Sap
};

export const ZOOMS = [8, 12, 16, 24, 32, 48, 64];

/**
 * Where the camera starts: 64 pixels a slot, which the readout calls 200% because
 * the art is authored at 32. A game that opens on a three-slot claim wants to open
 * close enough to read it — at 100% those nine slots are a postage stamp in the
 * middle of an empty screen, and the first thing anyone did was zoom in.
 */
export const DEFAULT_ZOOM = 64;

const R = Math.round;

export function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(R(x), R(y), R(w), R(h));
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((n >> 16) & 255) * amt), g = cl(((n >> 8) & 255) * amt), b = cl((n & 255) * amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Draw a rect in a machine's own frame: f runs forward, l runs to its right. */
function rp(ctx, cxp, cyp, dir, f, l, fw, lw, color) {
  let X, Y, W, H;
  if (dir === 0)      { X = cxp + f;      Y = cyp + l;      W = fw; H = lw; }
  else if (dir === 1) { X = cxp - l - lw; Y = cyp + f;      W = lw; H = fw; }
  else if (dir === 2) { X = cxp - f - fw; Y = cyp - l - lw; W = fw; H = lw; }
  else                { X = cxp + l;      Y = cyp - f - fw; W = lw; H = fw; }
  px(ctx, X, Y, W, H, color);
}

/** A 6-pixel arrow head pointing `dir`, drawn from the cell centre. */
function chevron(ctx, cxp, cyp, dir, color, reach = 8) {
  for (let i = 0; i < 6; i += 2) {
    const half = 6 - i;
    rp(ctx, cxp, cyp, dir, reach + i, -half, 2, half * 2, color);
  }
}

/**
 * The colour a machine should read as from a distance, when its kind alone is not
 * enough to tell it from the one next to it.
 */
export function tintOf(m) {
  if (m.kind === 'asm') return shade(TYPES[(RECIPES[m.mut ?? 0] || RECIPES[0]).out].color, 0.62);
  if (m.kind === 'mut') return shade(TYPES[m.mut ?? 1].color, 0.55);
  return null;
}

function makeCanvas(w, h) {
  const c = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.width = w; c.height = h;
  return c;
}

/* ------------------------------------------------------------- body tiles --- */

/**
 * Every machine casing the game has ever drawn, cached by exactly the things that
 * change its shape. A conveyor has eight animation frames, four facings and three
 * levels, so ninety-six tiles cover every belt on the map however many there are.
 */
const tiles = new Map();

/** How many animation frames a kind's body has. Most have one. */
const FRAMES = { pipe: 8, store: 8, gen: 4, ext: 4, asm: 4, mut: 4, fuse: 4, lab: 4, arm: 4, zap: 4, drill: 4, recyc: 4, pylon: 4, drone: 4, solar: 8 };

export function frameCount(kind) { return FRAMES[kind] || 1; }

function tileKey(m, frame) {
  // Belts carry their join mask in the key: a belt in the middle of a run and a
  // belt on the end of one are different pictures of the same machine.
  const link = (m.kind === 'pipe' || m.kind === 'store') ? (m.link | 0) : 0;
  return `${m.kind}|${m.dir}|${m.level || 1}|${m.mut ?? 0}|${m.mir | 0}|${frame}|${link}`;
}

/**
 * A machine's casing, cached. The frame index is normalised here rather than at
 * every call site: a requestAnimationFrame timestamp can be fractionally *older*
 * than a performance.now() taken moments before it, which makes the very first
 * frame of a session arrive with a negative delta, which used to arrive here as a
 * negative array index and take the whole renderer down on load. One clamp, in the
 * one place every caller goes through.
 */
export function bodyTile(m, rawFrame = 0) {
  const fc = frameCount(m.kind);
  const frame = fc > 1 ? ((Math.floor(rawFrame) % fc) + fc) % fc : 0;
  const key = tileKey(m, frame);
  let t = tiles.get(key);
  if (t) return t;
  // Belts multiply the cache by their join mask, so it is bounded rather than
  // trusted: a very long session that has drawn every shape of every belt at
  // every level starts again rather than growing without end.
  if (tiles.size > 2400) tiles.clear();
  const c = makeCanvas(CELL, CELL);
  const ctx = c.getContext('2d');
  drawBody(ctx, m, frame);
  tiles.set(key, c);
  return c;
}

/** Reset the cache. Only needed if the palette itself changes. */
export function clearTiles() { tiles.clear(); longTiles?.clear(); }

/**
 * The one mouth a Depot or a Lab has, cut into the side `dir` points at.
 *
 * Three of their faces are solid and one is an opening, and which one has to be
 * legible at a glance or the constraint is just an unexplained refusal. So the
 * mouth is a dark slot in the casing with a bright lip either side and an arrow
 * pointing *inward* — the only inward-pointing arrow in the game, because it is
 * the only machine that takes rather than gives.
 */
function mouth(ctx, d, lit) {
  const cxp = CELL / 2, cyp = CELL / 2;
  rp(ctx, cxp, cyp, d, 10, -8, 6, 16, '#05070d');
  rp(ctx, cxp, cyp, d, 10, -9, 6, 1, lit);
  rp(ctx, cxp, cyp, d, 10, 8, 6, 1, lit);
  for (let i = 0; i < 3; i++) {
    const half = 5 - i * 2;
    rp(ctx, cxp, cyp, d, 9 - i * 2, -half, 2, half * 2, lit);
  }
}

/**
 * A conveyor, drawn as part of whatever it is joined to.
 *
 * The old belt was a box: a casing all the way round, a channel across the middle,
 * done. Twenty of them in a row read as twenty boxes rather than as one belt, and
 * a corner read as two boxes at right angles rather than as a belt that turns.
 *
 * This one is built out of *arms*. Each arm runs from the centre of the tile to
 * one edge, and an arm is drawn for the direction the belt fires and for every
 * direction something feeds it from — so a straight run is two arms meeting in the
 * middle, a corner is two arms at right angles, and a merge is three. Because
 * every arm goes right to the edge at the same width, the arm on this side of a
 * boundary lines up exactly with the arm on the other side, and a run of belts
 * becomes one continuous trough with rails down both sides.
 *
 * The rails are drawn before the troughs on purpose: at a junction the trough
 * simply erases the rail that would otherwise run across the opening, which is
 * what turns four arms into a crossroads instead of a plus sign.
 *
 * A belt with nothing feeding it still draws its back arm, so a lone belt is a
 * belt rather than half of one; an arm with nothing on the far side gets an end
 * cap, so where a run stops is visible.
 */
function drawBelt(ctx, m, frame, trim, lit) {
  const cxp = CELL / 2, cyp = CELL / 2;
  const d = m.dir | 0;
  const link = m.link | 0;
  const body = KINDS[m.kind].body;

  const ins = [];
  for (let k = 0; k < 4; k++) if (k !== d && (link & (1 << k))) ins.push(k);
  const arms = [d, ...ins];
  if (!ins.length) arms.push((d + 2) % 4);          // a lone belt is still a belt

  const rail = shade(body, 1.5);
  // plates first, then rails, then troughs over the top of both
  for (const t of arms) rp(ctx, cxp, cyp, t, 0, -10, 16, 20, body);
  for (const t of arms) {
    rp(ctx, cxp, cyp, t, 0, -10, 16, 2, rail);
    rp(ctx, cxp, cyp, t, 0, 8, 16, 2, rail);
  }
  for (const t of arms) rp(ctx, cxp, cyp, t, 0, -8, 16, 16, '#0e1526');

  // end caps, wherever an arm runs out into nothing
  for (const t of arms) {
    if (link & (1 << t)) continue;
    rp(ctx, cxp, cyp, t, 14, -10, 2, 20, rail);
  }

  // and the belt itself moving: outward along the way it fires, inward along
  // everything that feeds it, so a corner visibly flows round the corner.
  const run = (t, inward) => {
    for (let i = -1; i < 3; i++) {
      const fwd = i * 8 + (inward ? 8 - frame : frame);
      if (fwd > 0 && fwd < 13) rp(ctx, cxp, cyp, t, fwd, -5, 3, 10, trim);
    }
  };
  for (const t of arms) run(t, t !== d);
}

/**
 * One machine's casing, drawn at the origin of a 32x32 tile. Nothing in here may
 * read anything that changes per frame other than `frame` itself — cargo,
 * progress, power and jams are all drawn live in `drawLive` below.
 */
function drawBody(ctx, m, frame) {
  const k = KINDS[m.kind] || KINDS.pipe;
  const body = k.body, trim = k.trim, lit = k.lit;
  const cxp = CELL / 2, cyp = CELL / 2;
  const d = m.dir | 0;
  const lvl = m.level || 1;

  /*
   * Belts draw their own shape, edge to edge, and skip the casing entirely — a box
   * round each one is exactly what stopped a run of them reading as a single belt.
   * Everything else keeps its casing: a Mutator is an object sitting on the floor,
   * and it should look like one.
   */
  if (m.kind !== 'pipe' && m.kind !== 'store') {
    // casing: outline, body, a light source from the top left, corner bolts
    px(ctx, 1, 1, CELL - 2, CELL - 2, '#0c0e18');
    px(ctx, 3, 3, CELL - 6, CELL - 6, body);
    px(ctx, 3, 3, CELL - 6, 2, shade(body, 1.6));
    px(ctx, 3, 3, 2, CELL - 6, shade(body, 1.28));
    px(ctx, 3, CELL - 7, CELL - 6, 4, shade(body, 0.6));
    px(ctx, CELL - 5, 3, 2, CELL - 6, shade(body, 0.74));
    const bolt = shade(body, 1.75);
    px(ctx, 5, 5, 2, 2, bolt);
    px(ctx, CELL - 7, 5, 2, 2, bolt);
    px(ctx, 5, CELL - 7, 2, 2, bolt);
    px(ctx, CELL - 7, CELL - 7, 2, 2, bolt);
  }

  switch (m.kind) {
    case 'pipe': {
      drawBelt(ctx, m, frame, trim, lit);
      for (let i = 0; i < (m.level || 1) - 1; i++) {
        rp(ctx, cxp, cyp, d, -3 + i * 5, -9, 3, 2, lit);
      }
      break;
    }

    case 'store': {
      drawBelt(ctx, m, frame, trim, lit);
      // A tank bolted over the belt. It does not rotate, so how full it is reads
      // the same whichever way the machine is turned.
      px(ctx, 8, 7, 16, 11, '#0b1a18');
      px(ctx, 8, 7, 16, 2, shade(trim, 1.15));
      px(ctx, 8, 7, 2, 11, shade(trim, 0.8));
      px(ctx, 22, 7, 2, 11, shade(trim, 0.55));
      px(ctx, 10, 20, 5, 5, shade(body, 1.5));
      px(ctx, 17, 20, 5, 5, shade(body, 1.5));
      break;
    }

    case 'bal': {
      rp(ctx, cxp, cyp, d, -13, -6, 20, 12, '#0e1526');
      rp(ctx, cxp, cyp, d, -6, -6, 3, 12, trim);
      rp(ctx, cxp, cyp, d, 4, -5, 9, 10, '#0e1526');
      chevron(ctx, cxp, cyp, d, trim, 8);
      // the branch, drawn on whichever side it actually leaves by
      const side = (d + (m.mir ? 3 : 1)) % 4;
      rp(ctx, cxp, cyp, side, 2, -4, 11, 8, '#0e1526');
      chevron(ctx, cxp, cyp, side, lit, 7);
      if (lvl >= 3) {
        const other = (d + (m.mir ? 1 : 3)) % 4;
        rp(ctx, cxp, cyp, other, 2, -4, 11, 8, '#0e1526');
        chevron(ctx, cxp, cyp, other, lit, 7);
      }
      break;
    }

    case 'sort': {
      rp(ctx, cxp, cyp, d, -13, -6, 26, 12, '#0e1526');
      chevron(ctx, cxp, cyp, d, shade(trim, 0.8), 8);
      const side = (d + (m.mir ? 3 : 1)) % 4;
      rp(ctx, cxp, cyp, side, 3, -4, 10, 8, '#0e1526');
      chevron(ctx, cxp, cyp, side, lit, 7);
      // the filter window, showing the type this sorter pulls out
      const ty = TYPES[m.mut ?? 1] || TYPES[0];
      px(ctx, 12, 12, 8, 8, '#05070d');
      px(ctx, 13, 13, 6, 6, ty.color);
      px(ctx, 13, 13, 6, 1, ty.glow);
      break;
    }

    case 'ext': {
      // A drill: a wide head pointing the way it unloads, and a bit that turns.
      px(ctx, 7, 7, 18, 18, '#160f08');
      px(ctx, 8, 8, 16, 16, shade(body, 1.2));
      const ore = TYPES[m.mut ?? 0] || TYPES[0];
      const spin = [[13, 9], [19, 13], [17, 19], [11, 17]][frame % 4];
      px(ctx, 12, 12, 8, 8, '#05070d');
      px(ctx, spin[0], spin[1], 4, 4, ore.color);
      px(ctx, 14, 14, 4, 4, ore.glow);
      rp(ctx, cxp, cyp, d, 9, -6, 5, 12, trim);
      chevron(ctx, cxp, cyp, d, lit, 9);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 6, 25 - i * 4, 3, 3, lit);
      break;
    }

    case 'gen': {
      // A firebox with a grate and a chimney. The flame is the animation.
      px(ctx, 6, 10, 20, 16, '#120806');
      px(ctx, 7, 11, 18, 14, shade(body, 1.15));
      px(ctx, 10, 14, 12, 9, '#05070d');
      const h = [7, 5, 8, 6][frame % 4];
      px(ctx, 12, 23 - h, 8, h, '#ff6a2a');
      px(ctx, 14, 23 - h + 1, 4, h - 1, '#ffc45a');
      px(ctx, 15, 23 - h + 2, 2, Math.max(1, h - 3), '#fff2c0');
      px(ctx, 9, 24, 14, 2, shade(trim, 0.7));
      px(ctx, 19, 4, 6, 7, shade(body, 0.8));      // chimney
      px(ctx, 19, 4, 6, 2, shade(trim, 1.1));
      for (let i = 0; i < lvl - 1; i++) px(ctx, 7, 5 + i * 4, 3, 3, lit);
      break;
    }

    case 'depot': {
      // A market stall: a striped awning over a counter, with a coin on it.
      px(ctx, 6, 8, 20, 5, shade(body, 0.7));
      for (let i = 0; i < 5; i++) px(ctx, 6 + i * 4, 8, 2, 5, i % 2 ? trim : lit);
      px(ctx, 6, 13, 20, 1, '#05070d');
      px(ctx, 8, 14, 16, 10, shade(body, 1.15));
      px(ctx, 11, 16, 10, 6, '#08120c');
      px(ctx, 13, 17, 6, 4, GOLD);
      px(ctx, 14, 18, 4, 2, shade(GOLD, 0.7));
      px(ctx, 15, 18, 2, 1, '#fff4c8');
      mouth(ctx, d, lit);
      break;
    }

    case 'lab': {
      px(ctx, 9, 7, 14, 18, shade(body, 1.15));
      px(ctx, 9, 7, 14, 2, shade(body, 1.7));
      // a flask, with the level of what is in it rising and falling
      px(ctx, 13, 9, 6, 3, '#05070d');
      px(ctx, 11, 12, 10, 11, '#05070d');
      const fill = [6, 7, 8, 7][frame % 4];
      px(ctx, 12, 22 - fill, 8, fill, trim);
      px(ctx, 12, 22 - fill, 8, 1, lit);
      px(ctx, 14, 24 - fill, 2, 2, lit);
      mouth(ctx, d, lit);
      break;
    }

    case 'dup': {
      rp(ctx, cxp, cyp, d, -13, -7, 12, 14, '#0e1526');
      px(ctx, 12, 8, 10, 7, '#05070d');
      px(ctx, 12, 17, 10, 7, '#05070d');
      chevron(ctx, cxp, cyp, d, trim, 9);
      for (let i = 0; i < lvl; i++) px(ctx, 5, 6 + i * 5, 3, 3, lit);
      break;
    }

    case 'trident': {
      px(ctx, 9, 9, 14, 14, '#0e1526');
      px(ctx, 11, 11, 10, 10, shade(body, 1.3));
      for (const dd of [d, (d + 1) % 4, (d + 3) % 4]) chevron(ctx, cxp, cyp, dd, trim, 9);
      break;
    }

    case 'mut': {
      px(ctx, 7, 7, 18, 18, '#0e1526');
      const ty = TYPES[m.mut ?? 1] || TYPES[1];
      const r = [6, 7, 8, 7][frame % 4];
      px(ctx, 16 - r / 2, 16 - r / 2, r, r, ty.color);
      px(ctx, 16 - r / 2, 16 - r / 2, r, 1, ty.glow);
      px(ctx, 7, 7, 18, 2, shade(trim, 1.1));
      px(ctx, 7, 23, 18, 2, shade(trim, 0.7));
      chevron(ctx, cxp, cyp, d, trim, 10);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 5, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'fuse': {
      px(ctx, 8, 8, 16, 16, '#0e1526');
      const glow = [0.7, 1, 0.8, 1.15][frame % 4];
      px(ctx, 11, 14, 10, 8, shade('#ff7a3c', glow));
      px(ctx, 13, 12, 6, 3, shade('#ffb87a', glow));
      px(ctx, 9, 9, 5, 4, shade(trim, 1.2));
      px(ctx, 18, 9, 5, 4, shade(trim, 1.2));
      chevron(ctx, cxp, cyp, d, trim, 10);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 5, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'asm': {
      /*
       * Three Assemblers, one casing, and until now one picture — so a floor with
       * an Engine line and a Turbine line on it was a floor where you had to click
       * a machine to find out which was which. Everything that varies between the
       * three now shows: the plate is tinted by what it makes, the window in the
       * middle *is* what it makes, the two intake ports are the colours of the two
       * things it eats, and the studs count the tier.
       */
      const r = RECIPES[m.mut ?? 0] || RECIPES[0];
      const out = TYPES[r.out];
      const inA = TYPES[r.ins[0]], inB = TYPES[r.ins[1]];

      px(ctx, 6, 6, 20, 20, '#0e1526');
      px(ctx, 7, 7, 18, 18, shade(out.color, 0.3));
      px(ctx, 7, 7, 18, 1, shade(out.color, 0.5));

      // a gear in the product's own colour, turning
      const spokes = [[14, 7], [21, 14], [14, 21], [7, 14]];
      const off = frame % 4;
      for (let k2 = 0; k2 < 4; k2++) {
        const q = spokes[(k2 + off) % 4];
        px(ctx, q[0], q[1], 4, 4, k2 % 2 ? shade(out.color, 0.85) : out.glow);
      }
      px(ctx, 12, 12, 8, 8, '#05070d');
      px(ctx, 13, 13, 6, 6, out.color);
      px(ctx, 13, 13, 6, 2, out.glow);

      // the two intake ports, in the colours of the two things it wants
      px(ctx, 5, 25, 9, 4, '#05070d');
      px(ctx, 6, 26, 7, 2, inA.color);
      px(ctx, 18, 25, 9, 4, '#05070d');
      px(ctx, 19, 26, 7, 2, inB.color);

      for (let k2 = 0; k2 <= (m.mut ?? 0); k2++) px(ctx, 3, 5 + k2 * 4, 2, 2, out.glow);
      chevron(ctx, cxp, cyp, d, out.glow, 10);
      break;
    }

    case 'arm': {
      // A press: a heavy ram over a die, with a cell of Ammo in the window and the
      // two intake ports in the colours of Scrap and Copper.
      const inA = TYPES[ARMORY.ins[0]], inB = TYPES[ARMORY.ins[1]], out = TYPES[ARMORY.out];
      px(ctx, 6, 6, 20, 20, '#0e1526');
      const ram = [0, 2, 3, 1][frame % 4];
      px(ctx, 9, 7 + ram, 14, 4, shade(trim, 1.1));
      px(ctx, 9, 7 + ram, 14, 1, lit);
      px(ctx, 15, 5, 2, 2 + ram, shade(trim, 0.7));
      px(ctx, 11, 14, 10, 8, '#05070d');
      px(ctx, 13, 15, 6, 6, out.color);
      px(ctx, 13, 15, 6, 2, out.glow);
      px(ctx, 15, 14, 2, 1, out.glow);
      px(ctx, 5, 25, 9, 4, '#05070d');
      px(ctx, 6, 26, 7, 2, inA.color);
      px(ctx, 18, 25, 9, 4, '#05070d');
      px(ctx, 19, 26, 7, 2, inB.color);
      chevron(ctx, cxp, cyp, d, lit, 10);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 3, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'drill': {
      // A drill head pointing into the rock, a gearbox behind it, and a chute out
      // of the back where what it digs comes out.
      px(ctx, 7, 7, 18, 18, '#14141a');
      px(ctx, 8, 8, 16, 16, shade(body, 1.25));
      const spin = frame % 4;
      // the bit, on the facing side
      for (let k = 0; k < 3; k++) {
        const w = 10 - k * 3;
        rp(ctx, cxp, cyp, d, 8 + k * 3, -w / 2, 3, w, (k + spin) % 2 ? lit : trim);
      }
      px(ctx, 12, 12, 8, 8, '#05070d');
      px(ctx, 13 + (spin % 2) * 2, 13 + (spin > 1 ? 2 : 0), 4, 4, shade(trim, 1.2));
      // the chute out the back, with a chevron pointing out of it
      const b = (d + 2) % 4;
      rp(ctx, cxp, cyp, b, 9, -5, 5, 10, '#05070d');
      chevron(ctx, cxp, cyp, b, lit, 9);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 5, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'bridge': {
      // Planks with rope rails, running the way it faces; a post at each corner.
      const horiz = d === 0 || d === 2;
      px(ctx, 3, 3, CELL - 6, CELL - 6, '#1a130a');
      for (let k = 0; k < 6; k++) {
        const c2 = k % 2 ? shade(body, 1.4) : shade(body, 1.15);
        if (horiz) px(ctx, 5 + k * 4, 7, 3, 18, c2); else px(ctx, 7, 5 + k * 4, 18, 3, c2);
      }
      if (horiz) { px(ctx, 4, 6, CELL - 8, 1, trim); px(ctx, 4, 25, CELL - 8, 1, trim); }
      else { px(ctx, 6, 4, 1, CELL - 8, trim); px(ctx, 25, 4, 1, CELL - 8, trim); }
      for (const [qx, qy] of [[3, 3], [26, 3], [3, 26], [26, 26]]) px(ctx, qx, qy, 3, 3, lit);
      chevron(ctx, cxp, cyp, d, lit, 9);
      break;
    }

    case 'zap': {
      // A coil turret: a squat base, a wound column, and an orb on top that hums.
      px(ctx, 7, 20, 18, 6, '#0e0a1c');
      px(ctx, 8, 21, 16, 4, shade(body, 1.4));
      px(ctx, 8, 21, 16, 1, shade(trim, 0.9));
      px(ctx, 12, 11, 8, 10, '#0e0a1c');
      for (let r = 0; r < 4; r++) px(ctx, 12, 12 + r * 2, 8, 1, r % 2 ? trim : shade(trim, 0.6));
      const pulse = [0.85, 1, 1.15, 1][frame % 4];
      px(ctx, 11, 4, 10, 8, '#0e0a1c');
      px(ctx, 12, 5, 8, 6, shade(trim, pulse));
      px(ctx, 13, 6, 4, 3, lit);
      px(ctx, 14, 6, 2, 1, '#ffffff');
      // the arms that the arc jumps from
      px(ctx, 6, 8, 5, 2, shade(trim, 0.8));
      px(ctx, 21, 8, 5, 2, shade(trim, 0.8));
      px(ctx, 5, 7, 2, 2, lit);
      px(ctx, 25, 7, 2, 2, lit);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 4, 21 + i * 3, 2, 2, lit);
      break;
    }

    case 'over': {
      // The through-channel runs straight; the side channel is a real exit, with
      // its own outward arrow — but a gate sits at the head of it, so it only takes
      // what the front cannot. The gate is the one thing that says "overflow".
      rp(ctx, cxp, cyp, d, -13, -5, 26, 10, '#0e1526');
      chevron(ctx, cxp, cyp, d, trim, 8);
      const side = (d + (m.mir ? 3 : 1)) % 4;
      rp(ctx, cxp, cyp, side, 3, -4, 10, 8, '#0e1526');
      chevron(ctx, cxp, cyp, side, lit, 7);
      // the gate across the head of the side exit, with a notch it spills through
      rp(ctx, cxp, cyp, side, 4, -5, 2, 4, shade(trim, 1.25));
      rp(ctx, cxp, cyp, side, 4, 1, 2, 4, shade(trim, 1.25));
      for (let i = 0; i < lvl - 1; i++) px(ctx, 5, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'recyc': {
      // A shredder: a hopper mouth with two rows of teeth that chew in turn, scrap
      // falling out underneath, and the way it unloads.
      px(ctx, 7, 6, 18, 14, '#0d140c');
      px(ctx, 8, 7, 16, 12, '#05070d');
      const a = frame % 2;
      for (let k = 0; k < 4; k++) {
        px(ctx, 9 + k * 4 + a * 2, 8, 2, 4, shade(trim, 1.15));
        px(ctx, 9 + k * 4 + (1 - a) * 2, 14, 2, 4, shade(trim, 0.85));
      }
      px(ctx, 8, 12, 16, 2, shade(body, 0.6));
      // the drum's axle bolts
      px(ctx, 7, 12, 2, 2, lit); px(ctx, 23, 12, 2, 2, lit);
      // scrap tumbling out
      const fall = frame % 4;
      px(ctx, 12 + fall, 21, 3, 2, '#8b93a8');
      px(ctx, 18 - fall, 23, 2, 2, '#c3cbdb');
      px(ctx, 15, 24 - (fall % 2), 2, 2, '#8b93a8');
      chevron(ctx, cxp, cyp, d, lit, 10);
      for (let i = 0; i < lvl - 1; i++) px(ctx, 5, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'pylon': {
      // A lattice mast seen from above: a braced square with a cross arm along the
      // way it faces. The front insulator burns brighter than the back one: that is
      // the end power goes out of, toward its partner. R swings it round.
      px(ctx, 9, 9, 14, 14, '#0c0b16');
      px(ctx, 10, 10, 12, 12, shade(body, 1.2));
      for (let k = 0; k < 12; k += 2) {
        px(ctx, 10 + k, 10 + k, 2, 2, shade(trim, 0.7));
        px(ctx, 20 - k, 10 + k, 2, 2, shade(trim, 0.7));
      }
      rp(ctx, cxp, cyp, d, -12, -2, 24, 4, shade(trim, 0.9));
      rp(ctx, cxp, cyp, d, -12, -2, 24, 1, trim);
      // an insulator at each end; the front one — where the power goes out — burns brighter
      rp(ctx, cxp, cyp, d, -12, -3, 3, 6, shade(lit, 0.55));
      rp(ctx, cxp, cyp, d, 9, -3, 3, 6, lit);
      rp(ctx, cxp, cyp, d, 10, -2, 1, 4, '#ffffff');
      // the spark at the top of the mast
      const on = frame % 4;
      px(ctx, 14, 14, 4, 4, '#05070d');
      px(ctx, 15, 15, 2, 2, on === 3 ? '#ffffff' : lit);
      if (on === 1) { px(ctx, 13, 13, 1, 1, lit); px(ctx, 18, 18, 1, 1, lit); }
      if (on === 2) { px(ctx, 18, 13, 1, 1, lit); px(ctx, 13, 18, 1, 1, lit); }
      for (let i = 0; i < lvl - 1; i++) px(ctx, 5, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'drone': {
      // A landing pad, and a quad-rotor drone hovering over it.
      px(ctx, 5, 5, 22, 22, '#0a1416');
      px(ctx, 6, 6, 20, 20, shade(body, 1.1));
      // pad corners
      for (const [qx, qy] of [[7, 7], [23, 7], [7, 23], [23, 23]]) px(ctx, qx, qy, 2, 2, shade(trim, 0.6));
      // the drone's shadow on the pad
      px(ctx, 12, 22, 8, 2, shade(body, 0.6));
      const bob = frame % 4 === 1 || frame % 4 === 2 ? -1 : 0;
      const y = 11 + bob;
      // arms, in an X
      for (let k = 0; k < 4; k++) {
        px(ctx, 11 + k, y + k, 1, 1, shade(trim, 0.6));
        px(ctx, 20 - k, y + k, 1, 1, shade(trim, 0.6));
        px(ctx, 11 + k, y + 7 - k, 1, 1, shade(trim, 0.6));
        px(ctx, 20 - k, y + 7 - k, 1, 1, shade(trim, 0.6));
      }
      // rotors: discs at the four corners whose blades flick between two angles
      const blade = frame % 2;
      for (const [rx, ry] of [[8, y - 3], [19, y - 3], [8, y + 6], [19, y + 6]]) {
        px(ctx, rx, ry, 5, 5, shade(body, 0.75));
        if (blade) px(ctx, rx, ry + 2, 5, 1, lit); else px(ctx, rx + 2, ry, 1, 5, lit);
        px(ctx, rx + 2, ry + 2, 1, 1, '#ffffff');
      }
      // the body, with a glowing eye
      px(ctx, 13, y + 1, 6, 6, '#05070d');
      px(ctx, 14, y + 2, 4, 4, trim);
      px(ctx, 15, y + 3, 2, 2, '#ffffff');
      for (let i = 0; i < lvl - 1; i++) px(ctx, 3, 6 + i * 4, 2, 2, lit);
      break;
    }

    case 'solar': {
      // A panel of cells in a frame, and a glint that sweeps slowly across it.
      px(ctx, 5, 6, 22, 20, '#05070d');
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const x = 6 + c * 5, y = 7 + r * 6;
          px(ctx, x, y, 4, 5, shade(trim, 0.55));
          px(ctx, x, y, 4, 1, shade(trim, 0.85));
          px(ctx, x + 1, y + 2, 2, 1, shade(trim, 0.45));
        }
      }
      // the glint: a short diagonal of light, one step further along each frame
      const g = frame % 8;
      for (let k = 0; k < 4; k++) {
        const gx = 4 + g * 3 + k, gy = 22 - k * 4;
        if (gx >= 6 && gx < 26 && gy >= 7 && gy < 25) px(ctx, gx, gy, 2, 2, lit);
      }
      // the stand under it
      px(ctx, 14, 25, 4, 2, shade(body, 1.6));
      for (let i = 0; i < lvl - 1; i++) px(ctx, 27, 7 + i * 4, 2, 2, lit);
      break;
    }

    default:
      chevron(ctx, cxp, cyp, d, trim, 8);
  }
}

/* ------------------------------------------------------------ long bodies --- */

/**
 * A 1x2 machine — a Fuser or a Mutator — drawn as ONE casing two slots long,
 * rather than a hopper tile glued to an ordinary tile. Its parts run along the
 * flow: an intake mouth cut into the back edge, a funnel, a feed duct with stuff
 * moving along it, the working chamber, and an output nozzle on the front edge.
 *
 * The casing and its lighting are drawn square to the screen, so the light always
 * comes from the top left whichever way the machine faces; everything inside it is
 * drawn in the machine's own frame with Q(), where `f` runs from the back edge (0)
 * to the front edge (64) and `l` runs across it (0 to 32).
 */
const longTiles = new Map();

export function longTile(m, rawFrame = 0) {
  const fc = frameCount(m.kind);
  const frame = ((Math.floor(rawFrame) % fc) + fc) % fc;
  const key = `L|${tileKey(m, frame)}`;
  let t = longTiles.get(key);
  if (t) return t;
  if (longTiles.size > 600) longTiles.clear();
  const d = m.dir | 0;
  const W = d % 2 === 0 ? CELL * 2 : CELL, H = d % 2 === 0 ? CELL : CELL * 2;
  t = makeCanvas(W, H);
  drawLongBody(t.getContext('2d'), m, frame, W, H);
  longTiles.set(key, t);
  return t;
}

function drawLongBody(ctx, m, frame, W, H) {
  const k = KINDS[m.kind] || KINDS.pipe;
  const body = k.body, trim = k.trim, lit = k.lit;
  const d = m.dir | 0;
  const lvl = m.level || 1;
  const L = CELL * 2, B = CELL;
  // A rect in the machine's own frame: f forward from the back edge, l across.
  const Q = (f, l, fw, lw, c) => {
    if (d === 0) px(ctx, f, l, fw, lw, c);
    else if (d === 1) px(ctx, B - l - lw, f, lw, fw, c);
    else if (d === 2) px(ctx, L - f - fw, B - l - lw, fw, lw, c);
    else px(ctx, l, L - f - fw, lw, fw, c);
  };

  // --- the casing: one outline round both slots, lit from the top left
  px(ctx, 1, 1, W - 2, H - 2, '#0c0e18');
  px(ctx, 3, 3, W - 6, H - 6, body);
  px(ctx, 3, 3, W - 6, 2, shade(body, 1.6));
  px(ctx, 3, 3, 2, H - 6, shade(body, 1.28));
  px(ctx, 3, H - 7, W - 6, 4, shade(body, 0.6));
  px(ctx, W - 5, 3, 2, H - 6, shade(body, 0.74));
  const bolt = shade(body, 1.75);
  for (const [bx, by] of [[5, 5], [W - 7, 5], [5, H - 7], [W - 7, H - 7]]) px(ctx, bx, by, 2, 2, bolt);
  // a panel seam where the two modules are bolted together
  Q(31, 6, 1, 20, shade(body, 0.5));
  Q(32, 6, 1, 20, shade(body, 1.35));

  // --- the intake: a slot in the back edge with a bright lip either side
  Q(1, 9, 4, 14, '#05070d');
  Q(1, 8, 5, 1, lit);
  Q(1, 23, 5, 1, lit);

  // --- the funnel: steps going down into the dark
  const ty = m.kind === 'mut' ? (TYPES[m.mut ?? 1] || TYPES[1]) : null;
  const inner = ty ? shade(ty.color, 0.45) : shade(trim, 0.45);
  Q(7, 7, 18, 18, '#0e1526');
  Q(8, 8, 16, 16, shade(trim, 0.75));
  Q(10, 10, 12, 12, inner);
  Q(12, 12, 8, 8, shade(inner, 0.6));
  Q(14, 14, 4, 4, '#05070d');
  Q(8, 8, 16, 1, shade(trim, 1.2));

  // --- the feed duct, with something travelling along it
  Q(25, 13, 12, 6, '#0e1526');
  Q(25, 14, 12, 4, shade(trim, 0.6));
  Q(26 + frame * 2, 15, 2, 2, ty ? ty.glow : lit);

  // --- level studs, along the back module's side
  for (let i = 0; i < lvl - 1; i++) Q(9 + i * 4, 27, 2, 2, lit);

  // --- the chamber
  if (m.kind === 'mut') {
    // a transmutation coil: ribbed housing, and a core of what it is making that pulses
    Q(36, 5, 22, 22, '#0e1526');
    for (let i = 0; i < 4; i++) {
      Q(37 + i * 6, 5, 3, 22, shade(trim, 0.85));
      Q(37 + i * 6, 5, 3, 1, shade(trim, 1.3));
    }
    Q(40, 9, 14, 14, '#05070d');
    Q(41, 10, 12, 12, shade(ty.color, 0.25));
    const r = [6, 8, 10, 8][frame % 4];
    Q(46 - r / 2, 15 - r / 2, r + 2, r + 2, shade(ty.color, 0.55));   // its glow
    Q(47 - r / 2, 16 - r / 2, r, r, ty.color);
    Q(47 - r / 2, 16 - r / 2, r, 2, ty.glow);
    Q(46, 15, 2, 2, '#ffffff');
  } else {
    // a furnace: two clamps squeezing a crucible that glows
    const glow = [0.75, 1, 0.85, 1.15][frame % 4];
    const squeeze = [0, 1, 2, 1][frame % 4];
    Q(36, 4, 22, 24, '#0e1526');
    Q(38, 5 + squeeze, 18, 4, shade(trim, 1.15));
    Q(38, 5 + squeeze, 18, 1, shade(trim, 1.5));
    Q(38, 23 - squeeze, 18, 4, shade(trim, 0.8));
    Q(40, 10, 14, 12, '#05070d');
    Q(41, 11, 12, 10, shade('#c8431e', glow));
    Q(43, 12, 8, 8, shade('#ff7a3c', glow));
    Q(45, 14, 4, 4, shade('#ffd27a', glow));
  }

  // --- the output nozzle on the front edge, with an arrow out of it
  Q(58, 10, 5, 12, shade(trim, 0.9));
  Q(58, 10, 5, 1, shade(trim, 1.4));
  Q(60, 12, 3, 8, '#05070d');
  Q(60, 14, 2, 4, lit);
  Q(62, 15, 1, 2, lit);
}

/* ------------------------------------------------------------------ mites --- */

/**
 * A mite, drawn live at its exact position. Ten art-pixels long, six legs that
 * scuttle, and a head that points the way it is going. Zoomed right out it is a
 * single pink pixel, which is what it should be: from that far away the only
 * question is how many and where.
 */
function drawMite(ctx, mt, sx, sy, z) {
  if (mt.kind === 'skitter') { drawSkitter(ctx, mt, sx, sy, z); return; }
  if (mt.kind === 'beetle') { drawBeetle(ctx, mt, sx, sy, z); return; }
  const s = z / CELL;
  if (z < 16) {
    const w = Math.max(2, Math.round(z / 6));
    px(ctx, sx - w / 2, sy - w / 2, w, w, '#ff4f7a');
    return;
  }
  const chew = mt.st === 'chew';
  const jig = chew ? Math.round(Math.sin(mt.ph * 2) * s) : 0;
  const leg = Math.floor(mt.ph) % 2;
  const horiz = mt.face === 0 || mt.face === 2;
  const L = 10 * s, W = 7 * s;
  const bw = horiz ? L : W, bh = horiz ? W : L;
  const x0 = Math.round(sx - bw / 2 + jig), y0 = Math.round(sy - bh / 2);
  const p = Math.max(1, Math.round(s));
  // legs
  for (let k = 0; k < 3; k++) {
    const o = (k * 3 + 1.5) * s + ((k + leg) % 2 ? s : 0);
    if (horiz) {
      px(ctx, x0 + o, y0 - 2 * s, p, 2 * s, '#3a0f1e');
      px(ctx, x0 + o, y0 + bh, p, 2 * s, '#3a0f1e');
    } else {
      px(ctx, x0 - 2 * s, y0 + o, 2 * s, p, '#3a0f1e');
      px(ctx, x0 + bw, y0 + o, 2 * s, p, '#3a0f1e');
    }
  }
  // body and shell
  px(ctx, x0, y0, bw, bh, '#2a0a16');
  px(ctx, x0 + p, y0 + p, bw - 2 * p, bh - 2 * p, '#8a2346');
  if (horiz) px(ctx, x0 + p, y0 + p, bw - 2 * p, p, '#c0436c');
  else px(ctx, x0 + p, y0 + p, p, bh - 2 * p, '#c0436c');
  // head, toward where it is going
  const hw = 4 * s;
  const hx = mt.face === 0 ? x0 + bw - p : mt.face === 2 ? x0 - hw + p : x0 + (bw - hw) / 2;
  const hy = mt.face === 1 ? y0 + bh - p : mt.face === 3 ? y0 - hw + p : y0 + (bh - hw) / 2;
  px(ctx, hx, hy, hw, hw, '#2a0a16');
  px(ctx, hx + p, hy + p, hw - 2 * p, hw - 2 * p, chew ? '#ff7aa0' : '#d8577f');
  px(ctx, hx + p, hy + p, p, p, '#ffe0ea');
  // a hurt mite shows it
  if (mt.hp < mt.max) {
    const w = 10 * s;
    px(ctx, sx - w / 2, sy - 7 * s, w, Math.max(1, s), '#2a0a16');
    px(ctx, sx - w / 2, sy - 7 * s, w * Math.max(0, mt.hp / mt.max), Math.max(1, s), '#ff9ab8');
  }
}

/**
 * A Skitter: a long, thin, segmented thing in acid green, with a pair of legs on
 * every segment that ripple as it runs. Drawn as a chain of segments trailing behind
 * the head, so it reads as fast even standing still.
 */
function drawSkitter(ctx, mt, sx, sy, z) {
  const s = z / CELL;
  if (z < 16) {
    const w = Math.max(2, Math.round(z / 7));
    px(ctx, sx - w / 2, sy - w / 2, w, w, '#9dff3c');
    return;
  }
  const [fx, fy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][mt.face | 0];
  const seg = 3 * s, n = 5;
  const p = Math.max(1, Math.round(s));
  const wig = mt.st === 'chew' ? 0 : 1;
  for (let k = n - 1; k >= 0; k--) {
    // Each segment sits a step behind the one in front, swaying side to side.
    const sway = Math.sin(mt.ph * 1.6 - k * 1.1) * 1.2 * s * wig;
    const cxp = sx - fx * k * seg * 0.95 + -fy * sway;
    const cyp = sy - fy * k * seg * 0.95 + fx * sway;
    const leg = ((Math.floor(mt.ph * 2) + k) % 2) ? 2 * s : s;
    // legs, out to either side
    px(ctx, cxp - fy * (seg / 2 + leg) - p / 2, cyp + fx * (seg / 2 + leg) - p / 2, p, p, '#1f3a08');
    px(ctx, cxp + fy * (seg / 2 + leg) - p / 2, cyp - fx * (seg / 2 + leg) - p / 2, p, p, '#1f3a08');
    px(ctx, cxp - seg / 2 - p / 2, cyp - seg / 2 - p / 2, seg + p, seg + p, '#122405');
    px(ctx, cxp - seg / 2, cyp - seg / 2, seg, seg, k === 0 ? '#c8ff6a' : (k % 2 ? '#6fd11f' : '#86e830'));
    if (k === 0) {
      // eyes and mandibles
      px(ctx, cxp + fx * seg / 2 - fy * s - p / 2, cyp + fy * seg / 2 + fx * s - p / 2, p, p, '#ffffff');
      px(ctx, cxp + fx * (seg / 2 + s) + fy * s - p / 2, cyp + fy * (seg / 2 + s) - fx * s - p / 2, p, p, '#ffe14a');
    }
  }
}

/**
 * A Beetle: big, round and bronze, a split shell with a sheen on it, a horn out
 * front and six slow legs. Nearly twice a Mite's size, so it reads as a threat.
 */
function drawBeetle(ctx, mt, sx, sy, z) {
  const s = z / CELL;
  if (z < 16) {
    const w = Math.max(3, Math.round(z / 4));
    px(ctx, sx - w / 2, sy - w / 2, w, w, '#d08a3a');
    return;
  }
  const horiz = mt.face === 0 || mt.face === 2;
  const L = 16 * s, W = 12 * s;
  const bw = horiz ? L : W, bh = horiz ? W : L;
  const x0 = Math.round(sx - bw / 2), y0 = Math.round(sy - bh / 2);
  const p = Math.max(1, Math.round(s));
  const leg = Math.floor(mt.ph * 0.6) % 2;
  for (let k = 0; k < 3; k++) {
    const o = (k * 5 + 2) * s + ((k + leg) % 2 ? s : 0);
    if (horiz) {
      px(ctx, x0 + o, y0 - 3 * s, 2 * p, 3 * s, '#2a1608');
      px(ctx, x0 + o, y0 + bh, 2 * p, 3 * s, '#2a1608');
    } else {
      px(ctx, x0 - 3 * s, y0 + o, 3 * s, 2 * p, '#2a1608');
      px(ctx, x0 + bw, y0 + o, 3 * s, 2 * p, '#2a1608');
    }
  }
  px(ctx, x0, y0, bw, bh, '#2a1608');
  px(ctx, x0 + p, y0 + p, bw - 2 * p, bh - 2 * p, '#a8612a');
  px(ctx, x0 + 2 * p, y0 + 2 * p, bw - 4 * p, bh - 4 * p, '#c97a34');
  // the seam down the middle of the shell, and a sheen
  if (horiz) px(ctx, x0 + p, sy - p / 2, bw - 2 * p, p, '#5a3010');
  else px(ctx, sx - p / 2, y0 + p, p, bh - 2 * p, '#5a3010');
  px(ctx, x0 + 3 * s, y0 + 3 * s, 4 * s, 2 * s, '#f0c080');
  // a horn, toward where it is going
  const [fx, fy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][mt.face | 0];
  const hx = sx + fx * (L / 2 + 2 * s), hy = sy + fy * (L / 2 + 2 * s);
  px(ctx, hx - 2 * s, hy - 2 * s, 4 * s, 4 * s, '#2a1608');
  px(ctx, hx - s, hy - s, 2 * s, 2 * s, mt.st === 'chew' ? '#ffd28a' : '#e0a050');
  if (mt.hp < mt.max) {
    const w = 16 * s;
    px(ctx, sx - w / 2, sy - 11 * s, w, Math.max(1, 1.5 * s), '#2a1608');
    px(ctx, sx - w / 2, sy - 11 * s, w * Math.max(0, mt.hp / mt.max), Math.max(1, 1.5 * s), '#ffd28a');
  }
}

/** A nest: a mound of earth with holes in it and something glowing underneath. */
function drawNest(ctx, n, sx, sy, z, t) {
  const s = z / CELL;
  const sk = n.kind === 'skitter';
  // Skitter nests are a different mound: green-black, glowing acid, and spiky.
  const pal = sk
    ? { low: '#3a5c0e', glow: '#9dff3c', shadow: '#0a1404', base: '#1a2e08', mid: '#2c4a0c', top: '#3f6614' }
    : { low: '#7a1f4a', glow: '#ff4f7a', shadow: '#1c0a14', base: '#3b1430', mid: '#5c1f48', top: '#7e2c62' };
  if (z < 16) { px(ctx, sx + z * 0.2, sy + z * 0.2, z * 0.6, z * 0.6, pal.low); return; }
  const glow = 0.75 + Math.sin(t * 3 + n.cell) * 0.25;
  px(ctx, sx + 3 * s, sy + 10 * s, 26 * s, 18 * s, pal.shadow);
  px(ctx, sx + 5 * s, sy + 8 * s, 22 * s, 18 * s, pal.base);
  px(ctx, sx + 8 * s, sy + 5 * s, 16 * s, 8 * s, pal.mid);
  px(ctx, sx + 8 * s, sy + 5 * s, 16 * s, 2 * s, pal.top);
  if (sk) for (const [qx, qy] of [[6, 6], [24, 7], [4, 16], [26, 18], [15, 2]]) {
    px(ctx, sx + qx * s, sy + qy * s, 2 * s, 4 * s, pal.top);
    px(ctx, sx + qx * s, sy + qy * s, 2 * s, s, shade(pal.glow, 0.7));
  }
  for (const [hx, hy] of [[9, 12], [18, 10], [13, 18], [21, 19]]) {
    px(ctx, sx + hx * s, sy + hy * s, 4 * s, 3 * s, '#05070d');
    px(ctx, sx + (hx + 1) * s, sy + (hy + 1) * s, 2 * s, s, shade(pal.glow, glow));
  }
  const max = nestSpec(n).hp;
  if (n.hp < max) {
    px(ctx, sx + 4 * s, sy + 2 * s, 24 * s, 2 * s, '#05070d');
    px(ctx, sx + 4 * s, sy + 2 * s, 24 * s * Math.max(0, n.hp / max), 2 * s, pal.glow);
  }
}

/* ------------------------------------------------------------------ ground --- */

/**
 * The whole world's floor, drawn once into one big canvas at one art-pixel per
 * art-pixel. 56 slots at 32 pixels is 1792 square, which is a couple of megabytes
 * and by far the cheapest thing in this file: every frame after the first is a
 * single `drawImage` of whatever rectangle the camera is looking at.
 */
function paintGround(g, f) {
  const ctx = g.getContext('2d');
  const lo = claimMin(f.claim), hi = claimMax(f.claim);
  ctx.clearRect(0, 0, g.width, g.height);

  for (let y = 0; y < WORLD; y++) {
    for (let x = 0; x < WORLD; x++) {
      const i = cellOf(x, y);
      const own = x >= lo && x <= hi && y >= lo && y <= hi;
      const px0 = x * CELL, py0 = y * CELL;
      const checker = (x + y) & 1;

      px(ctx, px0, py0, CELL, CELL, own ? (checker ? FLOOR2 : FLOOR) : (checker ? DIRT2 : DIRT));
      if (own) {
        px(ctx, px0, py0, CELL, 1, LINE);
        px(ctx, px0, py0, 1, CELL, LINE);
      }

      const ore = f.patch[i];
      if (ore >= 0) {
        const pal = ORE_COLOR[ore] || ORE_COLOR[0];
        const r = Math.min(1, (f.rich[i] || 1) / 2.6);
        px(ctx, px0 + 2, py0 + 2, CELL - 4, CELL - 4, pal[0]);
        // Richness is drawn as density, so a rich patch is visibly worth walking to.
        const n = 3 + Math.round(r * 9);
        for (let s = 0; s < n; s++) {
          const hx = px0 + 3 + ((s * 11 + i * 7) % (CELL - 8));
          const hy = py0 + 3 + ((s * 17 + i * 5) % (CELL - 8));
          px(ctx, hx, hy, 3, 3, s % 3 === 0 ? pal[2] : pal[1]);
        }
        if (!own) { ctx.globalAlpha = 0.66; px(ctx, px0, py0, CELL, CELL, DIRT); ctx.globalAlpha = 1; }
      }

      const t = f.terrain[i];
      if (t === SPACE) { drawSpace(ctx, px0, py0, f, x, y); continue; }
      if (t === BEACON) { px(ctx, px0, py0, CELL, CELL, '#14110a'); px(ctx, px0 + 1, py0 + 1, CELL - 2, CELL - 2, '#1e1a10'); }
      else if (t === MOUNTAIN) drawMountain(ctx, px0, py0, f, i, !own);
      else if (t === VALLEY) drawValley(ctx, px0, py0, f, x, y, !own);
      else if (t !== OPEN) drawRock(ctx, px0, py0, t, !own);
    }
  }

  // The fence: a bright border on the outside of the claim, so where your world
  // ends is never a thing you have to work out.
  const fx = lo * CELL, fy = lo * CELL, fw = (hi - lo + 1) * CELL;
  for (const [x, y, w, h] of [[fx - 2, fy - 2, fw + 4, 2], [fx - 2, fy + fw, fw + 4, 2],
    [fx - 2, fy - 2, 2, fw + 4], [fx + fw, fy - 2, 2, fw + 4]]) {
    px(ctx, x, y, w, h, FENCE);
  }
  for (let s = 0; s < fw; s += 16) {
    px(ctx, fx + s, fy - 2, 6, 2, shade(FENCE, 1.5));
    px(ctx, fx + s, fy + fw, 6, 2, shade(FENCE, 1.5));
    px(ctx, fx - 2, fy + s, 2, 6, shade(FENCE, 1.5));
    px(ctx, fx + fw, fy + s, 2, 6, shade(FENCE, 1.5));
  }
}

/**
 * Open space round a story-mode rock: black, with a scatter of stars that never
 * tiles, and a lit rim of regolith wherever it meets the rock, so the edge of the
 * world reads as the edge of an asteroid rather than of a map.
 */
function drawSpace(ctx, x, y, f, gx, gy) {
  px(ctx, x, y, CELL, CELL, '#03040a');
  let h = (gx * 73856093) ^ (gy * 19349663);
  const rnd = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; };
  const n = rnd() < 0.5 ? 1 : rnd() < 0.5 ? 2 : 0;
  for (let k = 0; k < n; k++) {
    const sx = x + 2 + Math.floor(rnd() * (CELL - 4)), sy = y + 2 + Math.floor(rnd() * (CELL - 4));
    const b = rnd();
    px(ctx, sx, sy, b > 0.85 ? 2 : 1, b > 0.85 ? 2 : 1, b > 0.6 ? '#c8d0ff' : '#5a6290');
  }
  const land = (ax, ay) => inWorld(ax, ay) && f.terrain[cellOf(ax, ay)] !== SPACE;
  const rim = '#3a3446', lit = '#5c5470';
  if (land(gx, gy - 1)) { px(ctx, x, y, CELL, 4, rim); px(ctx, x, y + 4, CELL, 2, '#16141e'); }
  if (land(gx, gy + 1)) { px(ctx, x, y + CELL - 5, CELL, 5, rim); px(ctx, x, y + CELL - 5, CELL, 1, lit); }
  if (land(gx - 1, gy)) { px(ctx, x, y, 4, CELL, rim); px(ctx, x + 4, y, 2, CELL, '#16141e'); }
  if (land(gx + 1, gy)) { px(ctx, x + CELL - 4, y, 4, CELL, rim); px(ctx, x + CELL - 4, y, 1, CELL, lit); }
}

/**
 * A mountain slot: grey-brown crags, a snow cap on the top edge of the massif, and
 * a few glints of the mineral in its seam, so a mountain says what it holds from
 * across the map. Hover it for the details.
 */
function drawMountain(ctx, x, y, f, i, faded) {
  const mt = f.mountains?.[f.mtn?.[i] ?? -1];
  const vein = TYPES[mt?.ty ?? 0] || TYPES[0];
  const up = cy(i) > 0 ? f.terrain[i - WORLD] === MOUNTAIN : false;
  ctx.globalAlpha = faded ? 0.7 : 1;
  px(ctx, x, y, CELL, CELL, '#2a2622');
  // three peaks, offset by slot so a range does not tile
  const o = (i * 7) % 6;
  for (const [bx, w, h, col] of [[1 + o, 16, 20, '#5a5048'], [12 - o / 2, 18, 26, '#6e6358'], [18, 13, 16, '#4e463f']]) {
    for (let k = 0; k < h; k += 2) {
      const ww = Math.max(2, Math.round(w * (k / h)));
      px(ctx, x + bx + (w - ww) / 2, y + CELL - h + k, ww, 2, col);
    }
  }
  px(ctx, x + 13 - o / 2, y + 7, 3, 12, shade('#6e6358', 1.25));
  if (!up) {
    px(ctx, x + 17 - o / 2, y + 6, 6, 2, '#e8ecf8');
    px(ctx, x + 18 - o / 2, y + 4, 4, 2, '#ffffff');
  }
  if (mt && mt.left > 0 && surveyed(f.done)) {
    for (let k = 0; k < 3; k++) {
      const gx = x + 5 + ((i * 13 + k * 9) % (CELL - 10)), gy = y + 14 + ((i * 5 + k * 7) % 12);
      px(ctx, gx, gy, 3, 2, vein.color);
      px(ctx, gx, gy, 1, 1, vein.glow);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A valley slot: a dark chasm, with a lip of lit rock on any side that is not more
 * valley, so a run of them reads as one continuous gorge.
 */
function drawValley(ctx, x, y, f, gx, gy, faded) {
  const isV = (ax, ay) => inWorld(ax, ay) && f.terrain[cellOf(ax, ay)] === VALLEY;
  ctx.globalAlpha = faded ? 0.75 : 1;
  px(ctx, x, y, CELL, CELL, '#06070c');
  px(ctx, x + 6, y + 6, CELL - 12, CELL - 12, '#020306');
  // a little light far down, for depth
  px(ctx, x + 12 + ((gx * 3 + gy) % 6), y + 14, 2, 2, '#1b2a44');
  const lip = '#3b3f52', lit = '#5a6078';
  if (!isV(gx, gy - 1)) { px(ctx, x, y, CELL, 4, lip); px(ctx, x, y, CELL, 1, lit); }
  if (!isV(gx, gy + 1)) px(ctx, x, y + CELL - 3, CELL, 3, '#1c1f2c');
  if (!isV(gx - 1, gy)) { px(ctx, x, y, 3, CELL, lip); px(ctx, x, y, 1, CELL, lit); }
  if (!isV(gx + 1, gy)) px(ctx, x + CELL - 3, y, 3, CELL, '#1c1f2c');
  ctx.globalAlpha = 1;
}

function drawRock(ctx, x, y, kind, faded) {
  ctx.globalAlpha = faded ? 0.55 : 1;
  if (kind === BEDROCK) {
    px(ctx, x + 3, y + 3, CELL - 6, CELL - 6, STONE);
    px(ctx, x + 3, y + 3, CELL - 6, 2, STONE2);
    px(ctx, x + 3, y + 3, 2, CELL - 6, shade(STONE2, 0.8));
    px(ctx, x + 9, y + 9, 5, 5, shade(STONE, 0.7));
    px(ctx, x + 17, y + 14, 7, 6, shade(STONE, 0.7));
    px(ctx, x + 11, y + 19, 4, 4, STONE2);
  } else {
    px(ctx, x + 6, y + 12, 9, 7, ROCK);
    px(ctx, x + 6, y + 12, 9, 2, ROCK2);
    px(ctx, x + 16, y + 8, 7, 6, ROCK);
    px(ctx, x + 16, y + 8, 7, 2, ROCK2);
    px(ctx, x + 13, y + 20, 6, 4, shade(ROCK, 0.8));
    px(ctx, x + 8, y + 7, 3, 3, shade(ROCK, 0.75));
  }
  ctx.globalAlpha = 1;
}

/* -------------------------------------------------------------------- view --- */

export class View {
  /**
   * @param {HTMLCanvasElement} canvas the pixel layer
   * @param {HTMLCanvasElement} text the overlay, drawn at device resolution
   */
  constructor(canvas, text) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.text = text;
    this.tctx = text ? text.getContext('2d') : null;
    this.cam = { x: WORLD / 2, y: WORLD / 2, zoom: DEFAULT_ZOOM };
    this.w = 0; this.h = 0; this.dpr = 1;
    this.ground = makeCanvas(WORLD * CELL, WORLD * CELL);
    this.groundKey = '';
    this.floats = [];
    this.t = 0;
    this.showPower = false;
    this.beams = [];
    this.parts = [];          // particles: sparks, coins, dust
    this.shakeT = 0;          // seconds of screen shake left
    this.shakeA = 0;          // and how hard
    this.off = [0, 0];        // the shake offset, applied while drawing only
    this.pings = [];          // rings that say "here" when the camera jumps somewhere
    this.flash = null;        // a whole-screen pulse: { color, life }
    this.lastDt = 0;
    this.stats = { drawn: 0, gizmos: 0 };
  }

  /* ------------------------------------------------------------- geometry --- */

  resize() {
    const c = this.canvas;
    const box = c.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(box.width));
    this.h = Math.max(1, Math.round(box.height));
    for (const el of [c, this.text]) {
      if (!el) continue;
      el.width = Math.round(this.w * this.dpr);
      el.height = Math.round(this.h * this.dpr);
      el.style.width = this.w + 'px';
      el.style.height = this.h + 'px';
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    if (this.tctx) this.tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** World cell coordinates (floats) to CSS pixels inside the canvas. */
  toScreen(wx, wy) {
    const z = this.cam.zoom;
    return [(wx - this.cam.x) * z + this.w / 2 + this.off[0], (wy - this.cam.y) * z + this.h / 2 + this.off[1]];
  }

  /* ----------------------------------------------------------------- juice --- */

  /** A spray of particles at a world position. */
  burst(wx, wy, color, n = 8, speed = 2.5, life = 0.6, size = 3) {
    for (let k = 0; k < n && this.parts.length < 400; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x: wx, y: wy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4,
        life: life * (0.6 + Math.random() * 0.6), max: life, color, size,
      });
    }
  }

  /** A few coins hopping out of a Depot. */
  coins(wx, wy, n = 3) {
    for (let k = 0; k < n && this.parts.length < 400; k++) {
      this.parts.push({
        x: wx + (Math.random() - 0.5) * 0.3, y: wy, vx: (Math.random() - 0.5) * 1.6, vy: -2.6 - Math.random(),
        life: 0.7, max: 0.7, color: '#ffcd75', size: 4, grav: 7,
      });
    }
  }

  shake(amount, secs = 0.25) {
    this.shakeA = Math.max(this.shakeA * (this.shakeT > 0 ? 1 : 0), amount);
    this.shakeT = Math.max(this.shakeT, secs);
  }

  /** Expanding rings on a slot, for "look here". */
  ping(cell, color = '#ffcd75') { this.pings.push({ cell, life: 1, color }); }

  pulse(color) { this.flash = { color, life: 1 }; }

  /** Move and draw every particle. Called inside draw(), after the machines. */
  drawJuice(ctx, z) {
    const dt = this.lastDt;
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(k, 1); continue; }
      p.vy += (p.grav ?? 4) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const [sx, sy] = this.toScreen(p.x, p.y);
      const w = Math.max(1, Math.round(p.size * z / 32 * (0.5 + p.life / p.max * 0.5)));
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.5);
      px(ctx, sx - w / 2, sy - w / 2, w, w, p.color);
    }
    ctx.globalAlpha = 1;
    for (let k = this.pings.length - 1; k >= 0; k--) {
      const pg = this.pings[k];
      pg.life -= dt * 0.7;
      if (pg.life <= 0) { this.pings.splice(k, 1); continue; }
      const [sx, sy] = this.toScreen(cx(pg.cell) + 0.5, cy(pg.cell) + 0.5);
      for (const ph of [0, 0.33]) {
        const r = ((1 - pg.life + ph) % 1) * z * 2.2 + z * 0.4;
        ctx.globalAlpha = pg.life * 0.9;
        ctx.strokeStyle = pg.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (this.flash) {
      this.flash.life -= dt * 2.2;
      if (this.flash.life <= 0) this.flash = null;
      else {
        ctx.globalAlpha = this.flash.life * 0.18;
        px(ctx, 0, 0, this.w, this.h, this.flash.color);
        ctx.globalAlpha = 1;
      }
    }
  }

  toWorld(sx, sy) {
    const z = this.cam.zoom;
    return [(sx - this.w / 2) / z + this.cam.x, (sy - this.h / 2) / z + this.cam.y];
  }

  /** The slot under a screen point, or -1 if the point is off the world. */
  cellAt(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const x = Math.floor(wx), y = Math.floor(wy);
    return inWorld(x, y) ? cellOf(x, y) : -1;
  }

  /** Zoom a step, keeping whatever is under the cursor under the cursor. */
  zoomBy(step, sx = this.w / 2, sy = this.h / 2) {
    const i = ZOOMS.indexOf(this.cam.zoom);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + step))];
    if (next === this.cam.zoom) return;
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.zoom = next;
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.clampCam();
  }

  panBy(dxCells, dyCells) {
    this.cam.x += dxCells;
    this.cam.y += dyCells;
    this.clampCam();
  }

  centreOn(cell) {
    this.cam.x = cx(cell) + 0.5;
    this.cam.y = cy(cell) + 0.5;
    this.clampCam();
  }

  /** Keep a little of the world on screen at all times. */
  clampCam() {
    const m = 4;
    this.cam.x = Math.max(-m, Math.min(WORLD + m, this.cam.x));
    this.cam.y = Math.max(-m, Math.min(WORLD + m, this.cam.y));
  }

  /** The rectangle of slots currently visible, inclusive. */
  bounds() {
    const z = this.cam.zoom;
    return {
      x0: Math.max(0, Math.floor(this.cam.x - this.w / 2 / z) - 1),
      y0: Math.max(0, Math.floor(this.cam.y - this.h / 2 / z) - 1),
      x1: Math.min(WORLD - 1, Math.ceil(this.cam.x + this.w / 2 / z) + 1),
      y1: Math.min(WORLD - 1, Math.ceil(this.cam.y + this.h / 2 / z) + 1),
    };
  }

  /* ---------------------------------------------------------------- floats --- */

  float(text, wx, wy, color = GOLD) {
    if (this.floats.length > 60) this.floats.shift();
    this.floats.push({ text, x: wx, y: wy, color, life: 1 });
  }

  /* ------------------------------------------------------------------ draw --- */

  /**
   * One frame.
   *
   * @param {object} f the factory
   * @param {object} ui { hover, selected, ghost, dragPath, held, dt }
   */
  draw(f, ui = {}) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    this.t += Math.max(0, ui.dt || 0);
    this.lastDt = Math.max(0, ui.dt || 0);
    if (this.shakeT > 0) {
      this.shakeT -= this.lastDt;
      const a = this.shakeA * Math.max(0, this.shakeT) * 4;
      this.off = [Math.round((Math.random() - 0.5) * a), Math.round((Math.random() - 0.5) * a)];
    } else this.off = [0, 0];
    ctx.clearRect(0, 0, this.w, this.h);
    px(ctx, 0, 0, this.w, this.h, INK);

    this.paintGroundIfStale(f);
    const b = this.bounds();

    // 1. the floor, in one blit
    const [gx, gy] = this.toScreen(b.x0, b.y0);
    const sw = (b.x1 - b.x0 + 1) * CELL, sh = (b.y1 - b.y0 + 1) * CELL;
    ctx.drawImage(this.ground, b.x0 * CELL, b.y0 * CELL, sw, sh,
      Math.round(gx), Math.round(gy), (b.x1 - b.x0 + 1) * z, (b.y1 - b.y0 + 1) * z);

    // 2. the machines
    this.stats.drawn = 0;
    const detail = z >= 24;
    const frame = Math.floor(this.t * 24);
    for (const i of f.cells) {
      const x = cx(i), y = cy(i);
      if (x < b.x0 - 1 || x > b.x1 + 1 || y < b.y0 - 1 || y > b.y1 + 1) continue;
      const m = f.grid[i];
      if (!m) continue;
      const [sx, sy] = this.toScreen(x, y);
      const sz = sizeKind(m.kind);
      if (sz === 'big') {
        // A 2x2 is its ordinary art at twice the size: pixel art scales up clean.
        this.drawMachine(ctx, m, Math.round(sx), Math.round(sy), z * 2, detail, frame, f);
      } else if (sz === 'long') {
        // A 1x2: one casing across both slots; the status marks go on its front slot,
        // and the washes (hurt, broken, off, unpowered) cover the back slot as well.
        const fr = m.front ?? i;
        const [fx, fy] = this.toScreen(cx(fr), cy(fr));
        const [bsx, bsy] = this.toScreen(Math.min(x, cx(fr)), Math.min(y, cy(fr)));
        const box = { x: Math.round(bsx), y: Math.round(bsy), w: (cx(fr) === x ? 1 : 2) * z, h: (cy(fr) === y ? 1 : 2) * z };
        if (detail) ctx.drawImage(longTile(m, frame), box.x, box.y, box.w, box.h);
        else px(ctx, Math.round(sx), Math.round(sy), z, z, tintOf(m) || KINDS[m.kind].body);
        this.drawMachine(ctx, m, Math.round(fx), Math.round(fy), z, detail, frame, f, true, box);
        this.washSlot(ctx, m, Math.round(sx), Math.round(sy), z);
      } else {
        this.drawMachine(ctx, m, Math.round(sx), Math.round(sy), z, detail, frame, f);
      }
      this.stats.drawn++;
    }

    // 3. the gizmos
    this.drawGizmos(ctx, f, b, z);

    // 3b. the Beacon, bridge spans, then nests, mites and the arcs that kill them
    this.drawBeacon(ctx, f, b, z);
    this.drawSpans(ctx, f, b, z);
    this.drawWires(ctx, f, b, z);
    this.drawFlights(ctx, z, ui.dt || 0);
    this.drawBugs(ctx, f, b, z);
    if (ui.range) this.drawRange(ctx, ui.range.cell, ui.range.r, z);

    // 4. everything that is about what you are doing rather than what is there
    if (this.showPower) this.drawPowerOverlay(ctx, f, b, z);
    if (ui.reach) this.drawReach(ctx, ui.reach, b, z);
    // A line that has stopped for good gets a red ring, because it is the one
    // thing on this map that will never fix itself.
    if (ui.jams?.size) {
      for (const c of ui.jams) {
        const x = cx(c), y = cy(c);
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        this.outline(ctx, c, z, '#ff3b30', 2);
      }
    }
    if (ui.area?.length) for (const c of ui.area) this.outline(ctx, c, z, '#7fe8ff', 1);
    if (ui.rubble?.length) for (const c of ui.rubble) this.outline(ctx, c, z, '#ffcd75', 1);
    if (ui.box) this.drawBox(ctx, ui.box, z);
    if (ui.bpPlan) this.drawBlueprint(ctx, ui.bpPlan, z);
    if (ui.dragPath?.length) this.drawDragPath(ctx, f, ui, z);
    else if (ui.ghost) this.drawGhost(ctx, f, ui, z);
    // Selection and hover outline the whole machine, however many slots it covers.
    if (ui.selected != null && ui.selected >= 0) this.outlineAt(ctx, f, ui.selected, z, GOLD, 2);
    if (ui.hover != null && ui.hover >= 0 && ui.hover !== ui.selected
      && !(f.grid[ui.hover] && f.grid[ui.hover] === f.grid[ui.selected])) {
      this.outlineAt(ctx, f, ui.hover, z, '#8ea2c8', 1);
    }

    this.drawJuice(ctx, z);
    this.drawText(f, ui);
    this.off = [0, 0];
  }

  /** The rubber band while you shift-drag a selection. */
  drawBox(ctx, box, z) {
    const x0 = Math.min(cx(box.a), cx(box.b)), x1 = Math.max(cx(box.a), cx(box.b));
    const y0 = Math.min(cy(box.a), cy(box.b)), y1 = Math.max(cy(box.a), cy(box.b));
    const [sx, sy] = this.toScreen(x0, y0);
    const w = (x1 - x0 + 1) * z, h = (y1 - y0 + 1) * z;
    ctx.globalAlpha = 0.12;
    px(ctx, sx, sy, w, h, '#7fe8ff');
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.strokeStyle = '#7fe8ff';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
    ctx.restore();
  }

  /** A blueprint in your hand: every machine it would place, green, amber or red. */
  drawBlueprint(ctx, pl, z) {
    const frame = Math.floor(this.t * 24);
    for (const st of pl.steps) {
      if (st.cell < 0) continue;
      const tint = !st.ok ? '#ff5d4a' : st.mode === 'new' ? '#7fe8a0' : '#ffcd75';
      this.fillCell(ctx, st.cell, z, tint, st.ok ? 0.18 : 0.3);
      if (z >= 16) {
        const [sx, sy] = this.toScreen(cx(st.cell), cy(st.cell));
        ctx.globalAlpha = 0.6;
        ctx.drawImage(bodyTile({ kind: st.p.kind, dir: st.p.dir, mut: st.p.mut, mir: st.p.mir, level: 1, link: 0 }, frame),
          Math.round(sx), Math.round(sy), z, z);
        ctx.globalAlpha = 1;
      }
    }
  }

  paintGroundIfStale(f) {
    const key = `${f.claim}|${f.mapRev || 0}|${f.seed}|${surveyed(f.done) ? 1 : 0}`;
    if (key === this.groundKey) return;
    paintGround(this.ground, f);
    this.groundKey = key;
  }

  /* -------------------------------------------------------------- machines --- */

  /** The status washes of a machine, laid over one more of its slots. */
  washSlot(ctx, m, sx, sy, z) {
    const k = KINDS[m.kind];
    const wash = (a, c) => { ctx.globalAlpha = a; px(ctx, sx, sy, z, z, c); ctx.globalAlpha = 1; };
    if (m.hurt > 0) wash(m.hurt * 0.45, '#ff3b5c');
    if (broken(m)) { wash(0.55, '#2a0610'); return; }
    if (m.off) { wash(0.62, '#0b0d16'); return; }
    if (k.draw > 0) {
      if (m.net < 0) wash(0.3, '#0a1230');
      else if (m.sat < 0.92) wash(0.07 + (1 - m.sat) * 0.13, m.sat < 0.5 ? '#ff3b30' : '#ffa53c');
    }
  }

  drawMachine(ctx, m, sx, sy, z, detail, frame, f, bare = false, box = null) {
    const k = KINDS[m.kind];
    // The whole machine, for the marks that belong round all of it (a 1x2 passes its box).
    const bx = box ? box.x : sx, by = box ? box.y : sy, bw = box ? box.w : z, bh = box ? box.h : z;

    if (!detail) {
      // Zoomed out, an Assembler is drawn in the colour of what it makes rather
      // than the colour of an Assembler — three of them side by side have to stay
      // three different things at every zoom, not just close up.
      const body = tintOf(m) || k.body;
      // Zoomed out: a block of the machine's own colour, and — because a factory
      // read from above is mostly about where things flow — a single tick showing
      // which way it points. That is enough to read a whole base at a glance.
      px(ctx, sx, sy, z, z, body);
      if (z >= 12) {
        const d = m.dir | 0, h = Math.max(2, z / 5);
        const cxp = sx + z / 2, cyp = sy + z / 2;
        px(ctx, cxp + DIRS[d][0] * z * 0.28 - h / 2, cyp + DIRS[d][1] * z * 0.28 - h / 2, h, h, k.trim);
      }
      if (broken(m)) { ctx.globalAlpha = 0.7; px(ctx, sx, sy, z, z, '#5a0f1e'); ctx.globalAlpha = 1; }
      else if (m.off) { ctx.globalAlpha = 0.62; px(ctx, sx, sy, z, z, '#0b0d16'); ctx.globalAlpha = 1; }
      else if (m.net < 0 && k.draw > 0) { ctx.globalAlpha = 0.3; px(ctx, sx, sy, z, z, '#0a1230'); ctx.globalAlpha = 1; }
      if (m.hurt > 0) { ctx.globalAlpha = m.hurt * 0.5; px(ctx, sx, sy, z, z, '#ff3b5c'); ctx.globalAlpha = 1; }
      return;
    }

    if (!bare) ctx.drawImage(bodyTile(m, frame), sx, sy, z, z);
    const s = z / CELL;   // art pixels to screen pixels

    // --- chewed. Health is drawn on every machine that has lost any, because a
    // belt halfway eaten is the one you want to find before it breaks.
    const hpMax = maxHp(m, f?.done || []);
    if (m.hurt > 0) {
      ctx.globalAlpha = m.hurt * 0.45;
      px(ctx, sx, sy, z, z, '#ff3b5c');
      ctx.globalAlpha = 1;
    }
    if (broken(m)) {
      ctx.globalAlpha = 0.55;
      px(ctx, sx, sy, z, z, '#2a0610');
      ctx.globalAlpha = 1;
      // a crack across it, and a red cross in the corner: this one needs paying for
      const c = '#ff4f6a';
      for (let k2 = 0; k2 < 6; k2++) px(ctx, sx + (7 + k2 * 3) * s, sy + (9 + (k2 % 2) * 3 + k2 * 2) * s, 3 * s, 2 * s, '#05070d');
      const t = Math.max(2, 2 * s), q = Math.max(4, 7 * s);
      for (let k2 = 0; k2 < q; k2 += t) {
        px(ctx, sx + 2 * s + k2, sy + 2 * s + k2, t, t, c);
        px(ctx, sx + 2 * s + q - t - k2, sy + 2 * s + k2, t, t, c);
      }
      return;
    }
    if (m.hp != null && m.hp < hpMax - 0.01) {
      const r = Math.max(0, m.hp / hpMax);
      const w = bw - 6 * s, h = Math.max(2, 2 * s);
      px(ctx, bx + 3 * s, by + 1 * s, w, h, '#05070d');
      px(ctx, bx + 3 * s, by + 1 * s, w * r, h, r > 0.5 ? '#ffcd75' : '#ff5d4a');
    }

    // --- what it is holding, in its window
    // Switched off by hand. Everything below — cargo, progress, stall badges, the
    // power tint — is about a machine that is trying to work, so an off one skips
    // the lot and says the one thing that is true about it instead.
    if (m.off) {
      ctx.globalAlpha = 0.62;
      px(ctx, sx, sy, z, z, '#0b0d16');
      ctx.globalAlpha = 1;
      const g = '#8b96b8', cxp = sx + z / 2;
      px(ctx, cxp - 1 * s, sy + 9 * s, 2 * s, 7 * s, g);          // the stalk
      px(ctx, cxp - 6 * s, sy + 14 * s, 4 * s, 2 * s, g);         // the broken ring
      px(ctx, cxp + 2 * s, sy + 14 * s, 4 * s, 2 * s, g);
      px(ctx, cxp - 7 * s, sy + 15 * s, 2 * s, 5 * s, g);
      px(ctx, cxp + 5 * s, sy + 15 * s, 2 * s, 5 * s, g);
      px(ctx, cxp - 5 * s, sy + 20 * s, 10 * s, 2 * s, g);
      return;
    }

    const held = heldTypes(m);
    const queued = m.buf;
    if (held.length || queued.length) {
      const dot = Math.max(2, Math.round(3 * s));
      let n = 0;
      // A gizmo with no type should be impossible; drawing one is not worth
      // taking the whole frame loop down for, so it is skipped rather than trusted.
      for (const ty of held) {
        const t = TYPES[ty];
        if (t) px(ctx, sx + (10 + n * 5) * s, sy + 10 * s, dot, dot, t.glow);
        n++;
      }
      n = 0;
      for (const g of queued.slice(0, 6)) {
        const t = TYPES[g.ty];
        if (t) px(ctx, sx + (6 + n * 4) * s, sy + 26 * s, dot, Math.max(2, 2 * s), t.color);
        n++;
      }
    }

    // --- progress, as a hairline along the bottom edge
    if (m.t > 0 && m.cyc > 0) {
      const p = Math.max(0, Math.min(1, 1 - m.t / m.cyc));
      px(ctx, bx + 3 * s, by + bh - 3 * s, (bw - 6 * s) * p, Math.max(1, 2 * s), k.lit);
    }

    // --- a generator's fire, and how much is left in it
    if (m.kind === 'gen') {
      const cap = capacity(m);
      const stock = Math.min(1, machineLoad(m) / cap);
      px(ctx, sx + 3 * s, sy + 3 * s, Math.max(1, 2 * s), (z - 6 * s) * stock, m.fuel > 0 ? HOT : '#4a3a30');
      if (m.fuel <= 0) this.badge(ctx, sx, sy, z, '#ff5d4a');
    }

    // --- a Drone Bay's Copper, as up to six pips along its foot
    if (m.kind === 'drone') {
      const n = Math.min(6, m.buf.filter(gz => gz.ty === 1).length);
      const t = Math.max(1, 2 * s);
      for (let k2 = 0; k2 < 6; k2++) {
        px(ctx, sx + (7 + k2 * 3.2) * s, sy + z - 4 * s, t, t, k2 < n ? TYPES[1].color : '#16181f');
      }
    }

    // --- a Zapper's charges, as pips down its side, and a red badge when it is dry
    if (m.kind === 'zap') {
      // Charged shots in pink on top, plain shots in yellow below them.
      const hot = Math.min(AMMO_CHARGES, m.hot | 0);
      const n = Math.min(AMMO_CHARGES - hot, m.charge | 0);
      const t = Math.max(1, 2 * s);
      for (let k2 = 0; k2 < hot + n; k2++) {
        px(ctx, sx + z - 5 * s, sy + (6 + k2 * 3) * s, t, t, k2 < hot ? '#ffc8fb' : '#fbffb8');
      }
      if (shotsOf(m) <= 0 && !m.buf.length) this.badge(ctx, sx, sy, z, '#ff5d4a');
    }

    /*
     * Three ways to be stuck, drawn differently because they want three different
     * fixes — and none of them drawn until the machine has been stuck for longer
     * than a hiccup. A line running at capacity blocks for a fraction of a second
     * on nearly every cycle, and badging that turned a healthy factory into a
     * screen full of alarm that nobody could read.
     */
    if (m.blockT > STALL_BADGE) {
      // BACKED UP: holding finished goods, nowhere to put them. Fix the line ahead.
      // Corner brackets rather than a full ring: it has to be visible without
      // painting over the machine you are trying to identify.
      const t = Math.max(2, 2 * s), L = Math.max(5, z * 0.32);
      ctx.globalAlpha = 0.9;
      for (const [ox, oy, w, h] of [
        [0, 0, L, t], [0, 0, t, L], [bw - L, 0, L, t], [bw - t, 0, t, L],
        [0, bh - t, L, t], [0, bh - L, t, L], [bw - L, bh - t, L, t], [bw - t, bh - L, t, L],
      ]) px(ctx, bx + ox, by + oy, w, h, GOLD);
      ctx.globalAlpha = 1;
    } else if (m.waitT > STALL_BADGE && m.buf.length) {
      // WAITING: it has some of what it needs and not all of it. Rather than a
      // badge that means "something is wrong somewhere", show the colour of the
      // thing it is short of — which is the answer, not the question.
      const miss = missingFor(m);
      const t = Math.max(3, 5 * s);
      miss.slice(0, 2).forEach((ty, k) => {
        const qx = bx + bw - t - 2 * s, qy = by + 2 * s + k * (t + 2 * s);
        px(ctx, qx - 1, qy - 1, t + 2, t + 2, '#05070d');
        px(ctx, qx, qy, t, t, TYPES[ty].color);
        px(ctx, qx, qy, t, Math.max(1, t / 3), TYPES[ty].glow);
      });
    } else if (m.waitT > STALL_BADGE && !PASSIVE.has(m.kind)
      && !PLUMBING.has(m.kind) && intake(m) > 0) {
      // STARVED: standing idle with an empty mouth. Fix the feed behind.
      const t = Math.max(2, 3 * s);
      for (const [ox, oy] of [[0, 0], [bw - t, 0], [0, bh - t], [bw - t, bh - t]]) {
        px(ctx, bx + ox, by + oy, t, t, '#41a6f6');
      }
    }

    // --- power, which is the one status worth seeing from any zoom
    if (k.draw > 0) {
      if (m.net < 0) {
        ctx.globalAlpha = 0.3;
        px(ctx, sx, sy, z, z, '#0a1230');
        ctx.globalAlpha = 1;
        // The little bolt goes on machines that do work, not on plumbing. Ticking
        // every cell of a long belt run says the same thing forty times and breaks
        // up the one continuous line the belt art exists to draw; the wash over
        // the whole run already says it once.
        if (!PLUMBING.has(m.kind)) {
          px(ctx, sx + z - 7 * s, sy + 2 * s, 2 * s, 3 * s, '#5b6ea8');
          px(ctx, sx + z - 8 * s, sy + 5 * s, 2 * s, 3 * s, '#5b6ea8');
        }
      } else if (m.sat < 0.92) {
        // A wash, not a repaint. This is an annotation on a machine you still have
        // to be able to read — the first version of it went up to 46% alpha and
        // turned a browned-out belt run into an unbroken red stripe.
        ctx.globalAlpha = 0.07 + (1 - m.sat) * 0.13;
        px(ctx, sx, sy, z, z, m.sat < 0.5 ? '#ff3b30' : '#ffa53c');
        ctx.globalAlpha = 1;
        // and a corner tick, which reads at any zoom without hiding anything —
        // again only where it means something, not once per belt.
        if (!PLUMBING.has(m.kind)) {
          px(ctx, sx + z - 5 * s, sy + z - 5 * s, 3 * s, 3 * s,
            m.sat < 0.5 ? '#ff5d4a' : '#ffcd75');
        }
      }
    }
  }

  /* ----------------------------------------------------------------- bugs --- */

  /** Called by main.js for every zap the simulation fires. */
  beam(path, hot = false) {
    if (this.beams.length > 40) this.beams.shift();
    this.beams.push({ path, life: 1, hot });
  }

  /**
   * The Launch Beacon: a five-slot tower drawn live, because it changes — four
   * mouths in the colours of what they take, a ring of lights that fills as it is
   * fed, a spire that glows brighter the closer it is, and, once it is full, a beam
   * straight up off the top of the screen.
   */
  drawBeacon(ctx, f, b, z) {
    const bc = f.beacon;
    if (!bc) return;
    if (bc.x0 + BEACON_SIZE < b.x0 - 1 || bc.x0 > b.x1 + 1 || bc.y0 + BEACON_SIZE < b.y0 - 1 || bc.y0 > b.y1 + 1) {
      if (!bc.done) return;
    }
    const s = z / CELL;
    const S = BEACON_SIZE * z;
    const [sx, sy] = this.toScreen(bc.x0, bc.y0);
    const P = (x, y, w, h, col) => px(ctx, sx + x * s, sy + y * s, w * s, h * s, col);
    const W = BEACON_SIZE * CELL;          // 160 art pixels a side
    const prog = beaconProgress(f);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);

    if (bc.done) {
      // The beam: from the spire to the top of the screen.
      const cxp = sx + S / 2;
      ctx.globalAlpha = 0.35 + 0.15 * pulse;
      px(ctx, cxp - 14 * s, 0, 28 * s, sy + S / 2, '#a8dcff');
      ctx.globalAlpha = 0.9;
      px(ctx, cxp - 5 * s, 0, 10 * s, sy + S / 2, '#ffffff');
      ctx.globalAlpha = 1;
    }
    // base
    P(2, 2, W - 4, W - 4, '#0c0a06');
    P(6, 6, W - 12, W - 12, '#2c2618');
    P(6, 6, W - 12, 3, '#5a4c2c');
    P(10, 10, W - 20, W - 20, '#1a160e');
    // gold trim and corner pylons
    for (const [x, y] of [[6, 6], [W - 26, 6], [6, W - 26], [W - 26, W - 26]]) {
      P(x, y, 20, 20, '#3a301a'); P(x + 3, y + 3, 14, 14, '#6a5428'); P(x + 7, y + 7, 6, 6, bc.done ? '#ffffff' : shade(GOLD, 0.6 + 0.4 * pulse));
    }
    // the four mouths, each in the colour of what it takes, with an arrow pointing in
    for (const [d, ty] of Object.entries(BEACON_INPUTS)) {
      const t = TYPES[ty];
      const full = bc.got[ty] >= BEACON_NEED[ty];
      const dd = +d;
      const mx = dd === 0 ? W - 22 : dd === 2 ? 2 : W / 2 - 14;
      const my = dd === 1 ? W - 22 : dd === 3 ? 2 : W / 2 - 14;
      const horiz = dd === 0 || dd === 2;
      const w = horiz ? 20 : 28, h = horiz ? 28 : 20;
      P(mx, my, w, h, '#05070d');
      P(mx + 2, my + 2, w - 4, h - 4, full ? shade(t.color, 0.5) : '#0b0d16');
      // chevrons pointing inward
      const cxm = mx + w / 2, cym = my + h / 2;
      const ix = -DIRS[dd][0], iy = -DIRS[dd][1];
      for (let k = 0; k < 3; k++) {
        const o = (k - 1) * 5;
        P(cxm + ix * o - 2, cym + iy * o - 2, 4, 4, full ? '#ffffff' : t.color);
      }
      // a fill bar beside the mouth
      const fr = Math.min(1, bc.got[ty] / BEACON_NEED[ty]);
      if (horiz) {
        const bx = dd === 0 ? W - 30 : 24;
        P(bx, W / 2 - 22, 4, 44, '#05070d'); P(bx, W / 2 + 22 - 44 * fr, 4, 44 * fr, t.color);
      } else {
        const by = dd === 1 ? W - 30 : 24;
        P(W / 2 - 22, by, 44, 4, '#05070d'); P(W / 2 - 22, by, 44 * fr, 4, t.color);
      }
    }
    // the ring of lights round the spire: one lit per sixteenth of the way
    const R = 34, lit = Math.floor(prog * 24);
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2 - Math.PI / 2;
      const x = W / 2 + Math.cos(a) * R - 3, y = W / 2 + Math.sin(a) * R - 3;
      P(x, y, 6, 6, k < lit ? (bc.done ? '#ffffff' : '#a8dcff') : '#1f2433');
    }
    // the spire
    P(W / 2 - 16, W / 2 - 16, 32, 32, '#0c0e18');
    P(W / 2 - 12, W / 2 - 12, 24, 24, shade('#41a6f6', 0.35 + prog * 0.65));
    P(W / 2 - 6, W / 2 - 6, 12, 12, bc.done ? '#ffffff' : shade('#a8dcff', 0.5 + prog * 0.5 * (0.7 + 0.3 * pulse)));
    // hurt flash and health
    if (bc.hurt > 0) {
      ctx.globalAlpha = bc.hurt * 0.35; px(ctx, sx, sy, S, S, '#ff3b5c'); ctx.globalAlpha = 1;
      bc.hurt = Math.max(0, bc.hurt - this.lastDt * 3);
    }
    if (!bc.done) {
      const hp = bc.hp / BEACON_HP;
      P(10, -8, W - 20, 5, '#05070d');
      P(10, -8, (W - 20) * hp, 5, hp > 0.5 ? '#a7f070' : hp > 0.2 ? '#ffcd75' : '#ff5d4a');
      if (bc.hp <= 0) {
        ctx.globalAlpha = 0.5; px(ctx, sx, sy, S, S, '#2a0610'); ctx.globalAlpha = 1;
      }
    }
  }

  /** A dashed rope between each paired Bridge, so it is obvious which pairs with which. */
  /**
   * Pylon wires: a thin line that sags between a linked pair, from the bright
   * insulator of the sender to the far one, with a spark riding along it.
   */
  drawWires(ctx, f, b, z) {
    const s = z / CELL;
    for (const i of f.cells) {
      const m = f.grid[i];
      if (m?.kind !== 'pylon' || !(m.wireTo >= 0)) continue;
      const x = cx(i), y = cy(i), j = m.wireTo;
      if (Math.max(x, cx(j)) < b.x0 - 1 || Math.min(x, cx(j)) > b.x1 + 1
        || Math.max(y, cy(j)) < b.y0 - 1 || Math.min(y, cy(j)) > b.y1 + 1) continue;
      const [dx, dy] = DIRS[m.dir | 0];
      const [ax, ay] = this.toScreen(x + 0.5 + dx * 0.33, y + 0.5 + dy * 0.33);
      const [bx, by] = this.toScreen(cx(j) + 0.5 - dx * 0.33, cy(j) + 0.5 - dy * 0.33);
      const sag = (dx ? 1 : 0.35) * z * 0.18;
      const steps = Math.max(8, Math.round(Math.hypot(bx - ax, by - ay) / Math.max(2, s * 2)));
      const w = Math.max(1, Math.round(s));
      const at = t => [ax + (bx - ax) * t, ay + (by - ay) * t + Math.sin(t * Math.PI) * sag];
      for (let k = 0; k <= steps; k++) {
        const [px0, py0] = at(k / steps);
        px(ctx, px0, py0 + w, w, w, '#0c0b16');
        px(ctx, px0, py0, w, w, '#b8b0e8');
      }
      const [sx, sy] = at((this.t * 0.7 + (i % 7) * 0.13) % 1);
      const sp = Math.max(2, Math.round(s * 2.5));
      px(ctx, sx - sp / 2, sy - sp / 2, sp, sp, '#fff3a0');
      px(ctx, sx - w / 2, sy - w / 2, w, w, '#ffffff');
    }
  }

  /** A repair drone's trip: out from its bay to the machine it fixes, and home. */
  fly(from, to) {
    if (!this.flights) this.flights = [];
    if (this.flights.length > 20) this.flights.shift();
    this.flights.push({ ax: cx(from) + 0.5, ay: cy(from) + 0.5, bx: cx(to) + 0.5, by: cy(to) + 0.5, t: 0 });
  }

  drawFlights(ctx, z, dt) {
    if (!this.flights?.length) return;
    const s = z / CELL;
    for (let k = this.flights.length - 1; k >= 0; k--) {
      const fl = this.flights[k];
      fl.t += dt;
      const dur = 1.4;
      if (fl.t >= dur) { this.flights.splice(k, 1); continue; }
      const p = fl.t / dur;
      const q = p < 0.5 ? p * 2 : 2 - p * 2;
      const e = q * q * (3 - 2 * q);
      const wx = fl.ax + (fl.bx - fl.ax) * e, wy = fl.ay + (fl.by - fl.ay) * e - Math.sin(q * Math.PI) * 0.4;
      const [sx, sy] = this.toScreen(wx, wy);
      const u = Math.max(1, Math.round(s * 1.5));
      const blade = Math.floor(this.t * 30) % 2;
      // body, eye, and four rotor flicks
      px(ctx, sx - 2 * u, sy - 2 * u, 4 * u, 4 * u, '#05070d');
      px(ctx, sx - u, sy - u, 2 * u, 2 * u, '#4fd8d0');
      for (const [ox, oy] of [[-3, -3], [2, -3], [-3, 2], [2, 2]]) {
        if (blade) px(ctx, sx + (ox - 0.5) * u, sy + oy * u, 2 * u, u, '#b6fff6');
        else px(ctx, sx + ox * u, sy + (oy - 0.5) * u, u, 2 * u, '#b6fff6');
      }
    }
  }

  drawSpans(ctx, f, b, z) {
    ctx.save();
    ctx.strokeStyle = '#c9a26a';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1, z / 16);
    ctx.setLineDash([Math.max(2, z / 8), Math.max(2, z / 10)]);
    for (const i of f.cells) {
      const m = f.grid[i];
      if (m?.kind !== 'bridge' || m.bin !== 1 || !(m.pair >= 0)) continue;
      const x = cx(i), y = cy(i);
      if (x < b.x0 - 6 || x > b.x1 + 6 || y < b.y0 - 6 || y > b.y1 + 6) continue;
      const [ax, ay] = this.toScreen(x + 0.5, y + 0.5);
      const [bx, by] = this.toScreen(cx(m.pair) + 0.5, cy(m.pair) + 0.5);
      const nx = -(by - ay), ny = bx - ax, len = Math.hypot(nx, ny) || 1;
      for (const side of [-0.28, 0.28]) {
        ctx.beginPath();
        ctx.moveTo(ax + nx / len * z * side, ay + ny / len * z * side);
        ctx.lineTo(bx + nx / len * z * side, by + ny / len * z * side);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBugs(ctx, f, b, z) {
    const inView = (x, y) => x >= b.x0 - 1 && x <= b.x1 + 2 && y >= b.y0 - 1 && y <= b.y1 + 2;
    for (const n of f.nests || []) {
      const x = cx(n.cell), y = cy(n.cell);
      if (!inView(x, y)) continue;
      const [sx, sy] = this.toScreen(x, y);
      drawNest(ctx, n, Math.round(sx), Math.round(sy), z, this.t);
    }
    for (const mt of f.mites || []) {
      if (!inView(mt.x, mt.y)) continue;
      const [sx, sy] = this.toScreen(mt.x, mt.y);
      drawMite(ctx, mt, sx, sy, z);
    }
    // The arcs. Jagged, re-jittered every frame, gone in a fifth of a second.
    if (!this.beams.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let k = this.beams.length - 1; k >= 0; k--) {
      const bm = this.beams[k];
      bm.life -= (this.lastDt || 0.016) * 5;
      if (bm.life <= 0) { this.beams.splice(k, 1); continue; }
      const pts = [];
      for (let j = 0; j < bm.path.length - 1; j++) {
        const [x0, y0] = bm.path[j], [x1, y1] = bm.path[j + 1];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        const steps = Math.max(2, Math.round(len * 2));
        for (let q = 0; q <= steps; q++) {
          const u = q / steps;
          const jit = (q === 0 || q === steps) ? 0 : (Math.random() - 0.5) * 0.35;
          pts.push(this.toScreen(x0 + (x1 - x0) * u + nx * jit, y0 + (y1 - y0) * u + ny * jit));
        }
      }
      const glow = bm.hot ? '#ff5cf0' : '#8f6cff';
      const wide = bm.hot ? 1.6 : 1;
      for (const [w, col, a] of [[Math.max(3, z / 7) * wide, glow, 0.45], [Math.max(1, z / 20) * wide, '#f4eeff', 1]]) {
        ctx.globalAlpha = a * bm.life;
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        pts.forEach(([px_, py_], q) => (q ? ctx.lineTo(px_, py_) : ctx.moveTo(px_, py_)));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** A Zapper's reach, while you are holding one or have one selected. */
  drawRange(ctx, cell, r, z, kind = 'zap') {
    // A Zapper is two by two and fires from its middle, so that is where the ring goes.
    const big = sizeKind(kind) === 'big';
    const [sx, sy] = this.toScreen(cx(cell) + (big ? 1 : 0.5), cy(cell) + (big ? 1 : 0.5));
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#8f6cff';
    ctx.beginPath();
    ctx.arc(sx, sy, r * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#b8a4ff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }

  badge(ctx, sx, sy, z, color) {
    const t = Math.max(2, z / 8);
    px(ctx, sx + z - t * 2, sy + t * 0.5, t * 1.5, t * 1.5, color);
  }

  /* ---------------------------------------------------------------- gizmos --- */

  drawGizmos(ctx, f, b, z) {
    const s = z / CELL;
    const big = Math.max(2, Math.round(6 * s));
    const small = Math.max(1, Math.round(3 * s));
    let n = 0;
    for (const g of f.gizmos) {
      const x = g.x, y = g.y;
      if (x < b.x0 || x > b.x1 + 1 || y < b.y0 || y > b.y1 + 1) continue;
      const [sx, sy] = this.toScreen(x, y);
      const t = TYPES[g.ty];
      const w = z >= 16 ? big : small;
      // Copies are drawn dim and unlit, so a glance at a running line tells you
      // which pixels on it can still be multiplied.
      px(ctx, sx - w / 2, sy - w / 2, w, w, g.cp ? shade(t.color, 0.62) : t.color);
      if (!g.cp && z >= 24) px(ctx, sx - w / 2, sy - w / 2, w, Math.max(1, w / 3), t.glow);
      n++;
    }
    this.stats.gizmos = n;
  }

  /* -------------------------------------------------------------- overlays --- */

  outline(ctx, cell, z, color, weight = 2) {
    const [sx, sy] = this.toScreen(cx(cell), cy(cell));
    const t = Math.max(1, Math.round(weight * z / 32) + 1);
    px(ctx, sx - t, sy - t, z + t * 2, t, color);
    px(ctx, sx - t, sy + z, z + t * 2, t, color);
    px(ctx, sx - t, sy, t, z, color);
    px(ctx, sx + z, sy, t, z, color);
  }

  fillCell(ctx, cell, z, color, alpha = 0.4) {
    const [sx, sy] = this.toScreen(cx(cell), cy(cell));
    ctx.globalAlpha = alpha;
    px(ctx, sx, sy, z, z, color);
    ctx.globalAlpha = 1;
  }

  /**
   * The build ghost: where the thing in your hand would land, and — this is the
   * important half — whether it may. A red cell that says "an Extractor has to
   * stand on ore" before you have spent ninety dollars is worth any number of
   * tooltips.
   */
  drawGhost(ctx, f, ui, z) {
    const { ghost } = ui;
    if (ghost.cell < 0) return;
    // Three states, not two: free ground, a slot whose occupant is about to be
    // crated, and a refusal. The middle one is drawn amber so that building over
    // something never looks like building on nothing.
    const tint = !ghost.ok ? '#ff5d4a' : ghost.mode === 'new' ? '#7fe8a0' : '#ffcd75';
    const cells = ghost.cells || (ghost.spec && footprint(ghost.spec.kind, ghost.cell, ghost.spec.dir)) || [ghost.cell];
    for (const c of cells) this.fillCell(ctx, c, z, tint, ghost.ok ? 0.22 : 0.3);
    this.outlineCells(ctx, cells, z, tint, 2);
    if (z >= 24 && ghost.spec) {
      ctx.globalAlpha = 0.65;
      const sz = sizeKind(ghost.spec.kind);
      const [sx, sy] = this.toScreen(cx(ghost.cell), cy(ghost.cell));
      const tile = bodyTile(ghost.spec, Math.floor(this.t * 24));
      if (sz === 'big') ctx.drawImage(tile, Math.round(sx), Math.round(sy), z * 2, z * 2);
      else if (sz === 'long' && cells.length > 1) {
        const lt = longTile(ghost.spec, Math.floor(this.t * 24));
        const [bsx, bsy] = this.toScreen(Math.min(...cells.map(cx)), Math.min(...cells.map(cy)));
        ctx.drawImage(lt, Math.round(bsx), Math.round(bsy), lt.width / CELL * z, lt.height / CELL * z);
      } else ctx.drawImage(tile, Math.round(sx), Math.round(sy), z, z);
      ctx.globalAlpha = 1;
    }
  }

  /** One outline round a whole set of slots: the box that holds them all. */
  outlineCells(ctx, cells, z, color, weight = 2) {
    const xs = cells.map(cx), ys = cells.map(cy);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    const [sx, sy] = this.toScreen(x0, y0);
    const t = Math.max(1, Math.round(weight * z / 32) + 1);
    const W = w * z, H = h * z;
    px(ctx, sx - t, sy - t, W + t * 2, t, color);
    px(ctx, sx - t, sy + H, W + t * 2, t, color);
    px(ctx, sx - t, sy, t, H, color);
    px(ctx, sx + W, sy, t, H, color);
  }

  /** Outline whatever stands on this slot — all of it — or the bare slot. */
  outlineAt(ctx, f, cell, z, color, weight) {
    const m = f.grid[cell];
    this.outlineCells(ctx, m?.cells || [cell], z, color, weight);
  }

  /** A dragged run of belts, before you let go of the mouse. */
  drawDragPath(ctx, f, ui, z) {
    for (const step of ui.dragPath) {
      // Green is fresh ground, amber is a slot that already has something on it
      // — either the same belt about to be re-aimed, or a machine about to be
      // crated — and red is somewhere the run cannot go at all.
      const tint = !step.ok ? '#ff5d4a' : step.mode === 'new' ? '#7fe8a0' : '#ffcd75';
      this.fillCell(ctx, step.cell, z, tint, step.ok ? 0.2 : 0.28);
      if (z >= 16 && step.ok) {
        const [sx, sy] = this.toScreen(cx(step.cell), cy(step.cell));
        const d = step.dir | 0, h = Math.max(2, z / 6);
        px(ctx, sx + z / 2 + DIRS[d][0] * z * 0.26 - h / 2,
          sy + z / 2 + DIRS[d][1] * z * 0.26 - h / 2, h, h, '#dcffb0');
      }
    }
  }

  /** Everything a generator about to be placed would reach. */
  drawReach(ctx, cells, b, z) {
    ctx.globalAlpha = 0.3;
    for (const c of cells) {
      const x = cx(c), y = cy(c);
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const [sx, sy] = this.toScreen(x, y);
      px(ctx, sx, sy, z, z, '#ffb07a');
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The power view: every machine tinted by the health of the grid it is on, and
   * the generators marked. Held on a key, because it answers exactly one question
   * — "why is that half of my factory slow" — and answers it instantly.
   */
  drawPowerOverlay(ctx, f, b, z) {
    ctx.globalAlpha = 0.55;
    for (const i of f.cells) {
      const x = cx(i), y = cy(i);
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const m = f.grid[i];
      if (!m) continue;
      let col;
      if (m.kind === 'gen') col = m.fuel > 0 ? '#ffd36a' : '#7a2c22';
      else if (m.net < 0) col = '#141c3a';
      else if (m.sat >= 0.95) col = '#2f7a4a';
      else if (m.sat >= 0.7) col = '#8a7a24';
      else col = '#8a2f24';
      for (const c of m.cells || [i]) {
        const [sx, sy] = this.toScreen(cx(c), cy(c));
        px(ctx, sx, sy, z, z, col);
      }
    }
    ctx.globalAlpha = 1;
    for (const i of f.cells) {
      const m = f.grid[i];
      if (!m || m.kind !== 'gen') continue;
      const x = cx(i), y = cy(i);
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      this.outlineCells(ctx, m.cells || [i], z, m.fuel > 0 ? '#ffd36a' : '#ff5d4a', 2);
    }
  }

  /* ------------------------------------------------------------------ text --- */

  /**
   * Everything with letters in it, drawn on its own canvas at the display's real
   * resolution. Magnifying a rasterised 8-pixel font is what makes pixel UI look
   * soft, so the numbers are the one thing here that is not pixel art.
   */
  drawText(f, ui) {
    const tc = this.tctx;
    if (!tc) return;
    tc.clearRect(0, 0, this.w, this.h);
    tc.textAlign = 'center';
    tc.textBaseline = 'middle';

    const dt = ui.dt || 0;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const fl = this.floats[i];
      fl.life -= dt * 0.85;
      if (fl.life <= 0) { this.floats.splice(i, 1); continue; }
      const [sx, sy] = this.toScreen(fl.x, fl.y - (1 - fl.life) * 0.9);
      if (sx < -60 || sx > this.w + 60 || sy < -30 || sy > this.h + 30) continue;
      tc.globalAlpha = Math.min(1, fl.life * 1.6);
      tc.font = `700 ${Math.max(11, Math.round(this.cam.zoom * 0.4))}px Silkscreen, ui-monospace, monospace`;
      tc.fillStyle = '#0b0d16';
      tc.fillText(fl.text, sx + 1, sy + 1);
      tc.fillStyle = fl.color;
      tc.fillText(fl.text, sx, sy);
    }
    tc.globalAlpha = 1;

    // The Beacon's name over it, at any zoom you can see it from.
    if (f.beacon && this.cam.zoom >= 12) {
      const [bx, by] = this.toScreen(f.beacon.x0 + BEACON_SIZE / 2, f.beacon.y0);
      tc.font = `700 ${this.cam.zoom >= 32 ? 13 : 11}px Silkscreen, ui-monospace, monospace`;
      const label = f.beacon.done ? 'LAUNCH BEACON — LIT' : `LAUNCH BEACON  ${Math.round(beaconProgress(f) * 100)}%`;
      tc.fillStyle = '#0b0d16';
      tc.fillText(label, bx + 1, by - this.cam.zoom * 0.45 + 1);
      tc.fillStyle = f.beacon.done ? '#ffffff' : '#a8dcff';
      tc.fillText(label, bx, by - this.cam.zoom * 0.45);
    }

    // Depot and Generator labels, close in, because those two are the ones you go
    // looking for on a map this size.
    if (this.cam.zoom >= 32) {
      const b = this.bounds();
      tc.font = `700 11px Silkscreen, ui-monospace, monospace`;
      for (const i of f.cells) {
        const m = f.grid[i];
        if (!m || (m.kind !== 'depot' && m.kind !== 'lab')) continue;
        const x = cx(i), y = cy(i);
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        const [sx, sy] = this.toScreen(x + (sizeKind(m.kind) === 'big' ? 1 : 0.5), y);
        tc.fillStyle = '#0b0d16';
        tc.fillText(m.kind === 'depot' ? 'DEPOT' : 'LAB', sx + 1, sy - 6);
        tc.fillStyle = m.kind === 'depot' ? '#a7f070' : '#b8bcff';
        tc.fillText(m.kind === 'depot' ? 'DEPOT' : 'LAB', sx, sy - 7);
      }
    }
  }
}
