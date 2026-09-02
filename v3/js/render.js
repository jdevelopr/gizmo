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
  cx, cy, cellOf, inWorld, claimMin, claimMax, OPEN, RUBBLE, BEDROCK,
  capacity, intake, PASSIVE, PLUMBING, genOutput, drawOf, missingFor, STALL_BADGE,
} from './machines.js';
import { heldTypes, machineLoad, contents } from './sim.js';

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
const FRAMES = { pipe: 8, store: 8, gen: 4, ext: 4, asm: 4, mut: 4, fuse: 4, lab: 4 };

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
export function clearTiles() { tiles.clear(); }

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

    default:
      chevron(ctx, cxp, cyp, d, trim, 8);
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
      if (t !== OPEN) drawRock(ctx, px0, py0, t, !own);
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
    return [(wx - this.cam.x) * z + this.w / 2, (wy - this.cam.y) * z + this.h / 2];
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
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const m = f.grid[i];
      if (!m) continue;
      const [sx, sy] = this.toScreen(x, y);
      this.drawMachine(ctx, m, Math.round(sx), Math.round(sy), z, detail, frame, f);
      this.stats.drawn++;
    }

    // 3. the gizmos
    this.drawGizmos(ctx, f, b, z);

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
    if (ui.dragPath?.length) this.drawDragPath(ctx, f, ui, z);
    else if (ui.ghost) this.drawGhost(ctx, f, ui, z);
    if (ui.selected != null && ui.selected >= 0) this.outline(ctx, ui.selected, z, GOLD, 2);
    if (ui.hover != null && ui.hover >= 0 && ui.hover !== ui.selected) {
      this.outline(ctx, ui.hover, z, '#8ea2c8', 1);
    }

    this.drawText(f, ui);
  }

  paintGroundIfStale(f) {
    const key = `${f.claim}|${f.mapRev || 0}|${f.seed}`;
    if (key === this.groundKey) return;
    paintGround(this.ground, f);
    this.groundKey = key;
  }

  /* -------------------------------------------------------------- machines --- */

  drawMachine(ctx, m, sx, sy, z, detail, frame, f) {
    const k = KINDS[m.kind];

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
      if (m.off) { ctx.globalAlpha = 0.62; px(ctx, sx, sy, z, z, '#0b0d16'); ctx.globalAlpha = 1; }
      else if (m.net < 0 && k.draw > 0) { ctx.globalAlpha = 0.3; px(ctx, sx, sy, z, z, '#0a1230'); ctx.globalAlpha = 1; }
      return;
    }

    ctx.drawImage(bodyTile(m, frame), sx, sy, z, z);
    const s = z / CELL;   // art pixels to screen pixels

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
      px(ctx, sx + 3 * s, sy + z - 3 * s, (z - 6 * s) * p, Math.max(1, 2 * s), k.lit);
    }

    // --- a generator's fire, and how much is left in it
    if (m.kind === 'gen') {
      const cap = capacity(m);
      const stock = Math.min(1, machineLoad(m) / cap);
      px(ctx, sx + 3 * s, sy + 3 * s, Math.max(1, 2 * s), (z - 6 * s) * stock, m.fuel > 0 ? HOT : '#4a3a30');
      if (m.fuel <= 0) this.badge(ctx, sx, sy, z, '#ff5d4a');
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
        [0, 0, L, t], [0, 0, t, L], [z - L, 0, L, t], [z - t, 0, t, L],
        [0, z - t, L, t], [0, z - L, t, L], [z - L, z - t, L, t], [z - t, z - L, t, L],
      ]) px(ctx, sx + ox, sy + oy, w, h, GOLD);
      ctx.globalAlpha = 1;
    } else if (m.waitT > STALL_BADGE && m.buf.length) {
      // WAITING: it has some of what it needs and not all of it. Rather than a
      // badge that means "something is wrong somewhere", show the colour of the
      // thing it is short of — which is the answer, not the question.
      const miss = missingFor(m);
      const t = Math.max(3, 5 * s);
      miss.slice(0, 2).forEach((ty, k) => {
        const bx = sx + z - t - 2 * s, by = sy + 2 * s + k * (t + 2 * s);
        px(ctx, bx - 1, by - 1, t + 2, t + 2, '#05070d');
        px(ctx, bx, by, t, t, TYPES[ty].color);
        px(ctx, bx, by, t, Math.max(1, t / 3), TYPES[ty].glow);
      });
    } else if (m.waitT > STALL_BADGE && !PASSIVE.has(m.kind)
      && !PLUMBING.has(m.kind) && intake(m) > 0) {
      // STARVED: standing idle with an empty mouth. Fix the feed behind.
      const t = Math.max(2, 3 * s);
      for (const [ox, oy] of [[0, 0], [z - t, 0], [0, z - t], [z - t, z - t]]) {
        px(ctx, sx + ox, sy + oy, t, t, '#41a6f6');
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
    this.fillCell(ctx, ghost.cell, z, tint, ghost.ok ? 0.22 : 0.3);
    this.outline(ctx, ghost.cell, z, tint, 2);
    if (z >= 24 && ghost.spec) {
      ctx.globalAlpha = 0.65;
      const [sx, sy] = this.toScreen(cx(ghost.cell), cy(ghost.cell));
      ctx.drawImage(bodyTile(ghost.spec, Math.floor(this.t * 24)),
        Math.round(sx), Math.round(sy), z, z);
      ctx.globalAlpha = 1;
    }
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
      const [sx, sy] = this.toScreen(x, y);
      let col;
      if (m.kind === 'gen') col = m.fuel > 0 ? '#ffd36a' : '#7a2c22';
      else if (m.net < 0) col = '#141c3a';
      else if (m.sat >= 0.95) col = '#2f7a4a';
      else if (m.sat >= 0.7) col = '#8a7a24';
      else col = '#8a2f24';
      px(ctx, sx, sy, z, z, col);
    }
    ctx.globalAlpha = 1;
    for (const i of f.cells) {
      const m = f.grid[i];
      if (!m || m.kind !== 'gen') continue;
      const x = cx(i), y = cy(i);
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      this.outline(ctx, i, z, m.fuel > 0 ? '#ffd36a' : '#ff5d4a', 2);
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
        const [sx, sy] = this.toScreen(x + 0.5, y);
        tc.fillStyle = '#0b0d16';
        tc.fillText(m.kind === 'depot' ? 'DEPOT' : 'LAB', sx + 1, sy - 6);
        tc.fillStyle = m.kind === 'depot' ? '#a7f070' : '#b8bcff';
        tc.fillText(m.kind === 'depot' ? 'DEPOT' : 'LAB', sx, sy - 7);
      }
    }
  }
}
