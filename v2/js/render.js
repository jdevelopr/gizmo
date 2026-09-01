/**
 * render.js — the pixel renderer.
 *
 * The art is authored on a 32-pixel cell grid and drawn 1:1 into a small backing
 * canvas, which the browser scales up with nearest-neighbour filtering. Nothing is
 * ever drawn at a fractional coordinate, so every pixel on screen is a whole square.
 *
 * Text is the one exception. Rasterising an 8px font and magnifying it is what makes
 * pixel UI look soft, so every string is queued in art coordinates and drawn on a
 * separate overlay canvas at the final device resolution instead — Silkscreen at an
 * exact multiple of its design size, with no upscaling in the way.
 *
 * The same code draws the host floor (up to four panels) and a phone (one panel).
 */

import {
  GRID, CELL, DIRS, TYPES, KINDS, cx, cy, PRODUCER_PORT, CLAIM_START, RECIPES,
} from './machines.js';

const gridPx = () => GRID * CELL;       // 96 on a 3x3, 224 on a 7x7
const GUTTER = 24;                      // room outside the floor for producer/seller
/*
 * Gizmo sprites. A gizmo is a single coloured pixel and its colour is the only
 * thing that says what it is worth, so it was drawn 3x3 and read as a speck at
 * arm's length on a phone. Six is still small against a 32-pixel slot — a line of
 * them still reads as a line — but the colour actually lands now.
 */
const GIZ = 6;                          // free-flying gizmo, in pixel units
const CARGO = 4;                        // the same gizmo inside a machine's window
const HEADER = 20;
const NOTE_H = 16;
const FONT = 16;                        // art pixels; always a multiple of 8

/**
 * Two panel shapes. The floor screen shows several at once, each with a name bar
 * and a status strip. A phone shows exactly one and already has its own HUD, so
 * the solo shape drops both and spends every spare pixel on the grid itself —
 * which is what makes the slots comfortable to hit with a thumb.
 */
const SHAPE = {
  floor: { padX: 8, padY: 2, header: HEADER, note: NOTE_H, gap: 12, solo: false },
  solo:  { padX: 0, padY: 0, header: 0, note: 0, gap: 0, solo: true },
};

/**
 * The margin around the floor, holding the producer and the seller. A phone
 * showing a big board trades a few pixels of gutter (and a slimmer producer) for
 * a whole extra step of scale, which is the difference between 32px slots and
 * 48px ones.
 */
const gutterFor = sh => (sh.solo && GRID >= 6 ? 18 : GUTTER);
const panelW = sh => sh.padX * 2 + gutterFor(sh) * 2 + gridPx();
const panelH = sh => sh.padY * 2 + sh.header + gutterFor(sh) * 2 + gridPx() + sh.note;

export const PLAYER_COLORS = [
  { key: 'cyan',   name: 'Cyan',   hex: '#41a6f6', dark: '#1b4f7d', lit: '#a8dcff' },
  { key: 'lime',   name: 'Lime',   hex: '#a7f070', dark: '#3f7a2c', lit: '#dcffb0' },
  { key: 'coral',  name: 'Coral',  hex: '#ef7d57', dark: '#8a3a24', lit: '#ffbfa4' },
  { key: 'orchid', name: 'Orchid', hex: '#b55088', dark: '#5e2447', lit: '#ff9ad0' },
];

const INK = '#12131f';
const PLATE = '#1e2233';
const PLATE2 = '#272c40';
const FLOOR = '#171a29';
const LINE = '#343b55';
const DIM = '#7c86a6';
const DIRT = '#101321';     // land you have not bought
const DIRT2 = '#161a2b';
const FENCE = '#4a5578';    // the edge of your claim
const ROCK = '#4a4433';     // rubble: clearable
const ROCK2 = '#6b6146';
const STONE = '#2c3346';    // bedrock: never moves
const STONE2 = '#454f6b';

/* ------------------------------------------------------------------- stage --- */

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas the pixel layer
   * @param {object} opts compact drops the note strip (the phone needs the height);
   *                      text is the overlay canvas, found by class if omitted
   */
  constructor(canvas, { solo = false, text = null } = {}) {
    this.shape = solo ? SHAPE.solo : SHAPE.floor;
    this.solo = solo;
    this.gap = this.shape.gap;
    this.gridN = 0;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.textCanvas = text || canvas.parentElement?.querySelector('.text-layer') || null;
    this.tctx = this.textCanvas ? this.textCanvas.getContext('2d') : null;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.parts = [];
    this.floats = [];
    this.texts = [];
    this.shakeAmt = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.t = 0;
    this.scale = 0;
    this.layout(1);
  }

  layout(n, cols, rows) {
    this.count = n;
    this.gridN = GRID;                       // panels are sized from the floor size
    this.gutter = gutterFor(this.shape);
    this.panelW = panelW(this.shape);
    this.panelH = panelH(this.shape);
    this.cols = cols || (n <= 1 ? 1 : 2);
    this.rows = rows || Math.ceil(n / this.cols);
    this.W = this.cols * this.panelW + (this.cols + 1) * this.gap;
    this.H = this.rows * this.panelH + (this.rows + 1) * this.gap;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.light.width = this.W;
    this.light.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.lctx.imageSmoothingEnabled = false;
    this.scale = 0;   // force a re-fit, the element size changed
  }

  /**
   * Scale the canvas to fill the space without blurring. Whole art pixels only —
   * except on a 2x display, where a half step still lands on exact device pixels.
   */
  fit(maxW, maxH) {
    const dpr = window.devicePixelRatio || 1;
    // Whole art pixels, except where the display's own pixels allow a finer step
    // that still lands on exact device pixels (0.5 at 2x, a third at 3x).
    const step = Number.isInteger(dpr) && dpr > 1 ? 1 / dpr : 1;
    const raw = Math.min(maxW / this.W, maxH / this.H);
    const s = Math.max(step, Math.floor(raw / step) * step);
    if (s === this.scale) return s;
    this.scale = s;
    const w = this.W * s, h = this.H * s;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.textCanvas) {
      this.textCanvas.style.width = w + 'px';
      this.textCanvas.style.height = h + 'px';
      this.textCanvas.width = Math.round(w * dpr);
      this.textCanvas.height = Math.round(h * dpr);
    }
    return s;
  }

  /** Pick the panel arrangement that gives the biggest scale in the space available. */
  autoFit(n, maxW, maxH) {
    let best = null;
    const target = maxW / Math.max(1, maxH);
    const pw = panelW(this.shape), ph = panelH(this.shape);
    const count = Math.max(1, n);
    for (let cols = 1; cols <= Math.min(4, count); cols++) {
      // Only arrangements that come out even: four players go 2x2 or 1x4, never
      // three-and-one.
      if (count % cols !== 0) continue;
      const rows = count / cols;
      const W = cols * pw + (cols + 1) * this.gap;
      const H = rows * ph + (rows + 1) * this.gap;
      const s = Math.min(maxW / W, maxH / H);
      const fit = Math.abs(Math.log((W / H) / target));
      if (!best || s > best.s + 0.001 || (Math.abs(s - best.s) <= 0.001 && fit < best.fit)) {
        best = { cols, rows, s, fit };
      }
    }
    if (best.cols !== this.cols || best.rows !== this.rows ||
        this.count !== n || this.gridN !== GRID) {
      this.layout(n, best.cols, best.rows);
    }
    return this.fit(maxW, maxH);
  }

  panelRect(i) {
    const col = i % this.cols, row = Math.floor(i / this.cols);
    return {
      x: this.gap + col * (this.panelW + this.gap),
      y: this.gap + row * (this.panelH + this.gap),
      w: this.panelW, h: this.panelH,
    };
  }

  /** Backing-pixel origin of a panel's 3x3 floor. */
  floorOrigin(rect) {
    const g = this.gutter || gutterFor(this.shape);
    return {
      x: rect.x + this.shape.padX + g,
      y: rect.y + this.shape.padY + this.shape.header + g,
    };
  }

  /**
   * Which fixture is under this point, if any: a Producer in the west gutter, a
   * vault or the Lab on the fence. Fixtures are drawn outside the grid, so a tap on
   * one lands nowhere as far as `cellAt` is concerned — which meant the three most
   * important objects on a floor were the three you could not ask about.
   *
   * @returns {{kind:string,idx:number,cell:number,dir:number,ty:number}|null}
   */
  fixtureAt(bx, by, view) {
    if (!view) return null;
    const o = this.floorOrigin(this.panelRect(0));
    const gut = this.gutter || GUTTER;
    // Never steal a tap that landed on owned floor. `cellAt` is deliberately
    // forgiving — up to ten pixels outside the grid still snaps to a slot — and on
    // a phone the gutter is only eighteen pixels wide, so without this the two hit
    // tests overlap and the Producer swallows the corner slot. The bound is the
    // *claim*, not the plot: the vaults and the Lab sit on the fence, which for
    // anything short of a full plot is well inside it.
    const cp = (view.cl || GRID) * CELL;
    if (bx >= o.x && by >= o.y && bx <= o.x + cp && by <= o.y + cp) return null;
    const hit = (x, y, w, h) => bx >= x && by >= y && bx <= x + w && by <= y + h;

    // Producers sit in the gutter, west of the row they feed.
    const ports = view.pp || [];
    for (let k = 0; k < ports.length; k++) {
      const [cell, ty, , stalled] = ports[k];
      const y = o.y + cy(cell) * CELL;
      if (hit(o.x - gut, y, gut, CELL)) {
        return { kind: 'prod', idx: k, cell, dir: 2, ty, stalled: !!stalled };
      }
    }

    /*
     * Vaults and the Lab sit just outside the fence, on the face they trade from.
     * The target is the whole strip of gutter beside that face rather than the
     * sixteen pixels actually painted — the drawn block leaves a gap on either
     * side, and a gap between a thumb and the thing it is aimed at is a miss.
     */
    const outside = (cell, dir) => {
      const [dx, dy] = DIRS[dir];
      const x = o.x + cx(cell) * CELL, y = o.y + cy(cell) * CELL;
      if (dx > 0) return [x + CELL, y, gut, CELL];
      if (dx < 0) return [x - gut, y, gut, CELL];
      if (dy > 0) return [x, y + CELL, CELL, gut];
      return [x, y - gut, CELL, gut];
    };
    const vaults = view.sv || [];
    for (let k = 0; k < vaults.length; k++) {
      const [cell, dir] = vaults[k];
      if (hit(...outside(cell, dir))) return { kind: 'vault', idx: k, cell, dir, ty: -1 };
    }
    if (view.lb && hit(...outside(view.lb[0], view.lb[1]))) {
      return { kind: 'lab', idx: 0, cell: view.lb[0], dir: view.lb[1], ty: -1 };
    }
    return null;
  }

  /**
   * Which slot a point lands in. Anything inside the floor plus a forgiving
   * margin snaps to the nearest slot, so a thumb landing on a grid line still
   * picks the machine the player meant. Returns -1 well outside.
   */
  cellAt(bx, by, rect = this.panelRect(0), slack = 10) {
    const o = this.floorOrigin(rect);
    const px = gridPx();
    if (bx < o.x - slack || by < o.y - slack ||
        bx > o.x + px + slack || by > o.y + px + slack) return -1;
    const gx = Math.max(0, Math.min(GRID - 1, Math.floor((bx - o.x) / CELL)));
    const gy = Math.max(0, Math.min(GRID - 1, Math.floor((by - o.y) / CELL)));
    return gy * GRID + gx;
  }

  shake(amount) { this.shakeAmt = Math.min(12, this.shakeAmt + amount); }

  burst(x, y, color, n = 6, spd = 52, life = 0.45) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spd * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g: 52, life: life * (0.6 + Math.random() * 0.7), max: life, color,
      });
    }
  }

  /**
   * Rising text. A busy seller fires several times a second, so instead of
   * stacking a column of identical labels, a new one lands on a fresh label and
   * anything close behind it is added to that label's running total.
   */
  float(x, y, text, color, { key = null, value = 0 } = {}) {
    if (key) {
      const live = this.floats.find(f => f.key === key && f.max - f.life < 0.65);
      if (live) {
        live.value += value;
        live.text = '+' + live.value;
        live.life = Math.max(live.life, 0.8);
        return;
      }
    }
    this.floats.push({
      x: x + (Math.random() * 8 - 4), y, text, color,
      life: 1.1, max: 1.1, key, value,
    });
  }

  /** Queue a string in art coordinates; drawn later at device resolution. */
  text(x, y, str, color, { size = FONT, align = 'left', shadow = true, alpha = 1, max = 0 } = {}) {
    this.texts.push({ x, y, str: String(str), color, size, align, shadow, alpha, max });
  }

  /** Width of a string in art pixels, using the real font the overlay will draw with. */
  measure(str, size = FONT) {
    const tc = this.tctx;
    const k = this.scale * (window.devicePixelRatio || 1);
    if (!tc || !k) return String(str).length * size * 0.75;
    tc.font = `${Math.round(size * k)}px Silkscreen, monospace`;
    return tc.measureText(String(str)).width / k;
  }

  update(dt) {
    this.t += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 44);
    const s = this.shakeAmt;
    this.shakeX = s > 0.4 ? Math.round((Math.random() - 0.5) * s * 2) : 0;
    this.shakeY = s > 0.4 ? Math.round((Math.random() - 0.5) * s * 2) : 0;

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      if (f.life <= 0) { this.floats.splice(i, 1); continue; }
      f.y -= dt * 26;
    }
    if (this.parts.length > 420) this.parts.splice(0, this.parts.length - 420);
    if (this.floats.length > 40) this.floats.splice(0, this.floats.length - 40);
  }

  begin() {
    const { ctx, lctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    lctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.setTransform(1, 0, 0, 1, this.shakeX, this.shakeY);
    lctx.setTransform(1, 0, 0, 1, this.shakeX, this.shakeY);
    this.texts.length = 0;
  }

  /** Particles, the additive light pass, then the crisp text overlay. */
  end() {
    const { ctx, lctx } = this;
    for (const p of this.parts) {
      const a = Math.min(1, p.life / p.max);
      ctx.globalAlpha = a > 0.45 ? 1 : 0.6;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      if (a > 0.5) glowPx(lctx, Math.round(p.x), Math.round(p.y), p.color, 2, 0.26);
    }
    ctx.globalAlpha = 1;

    for (const f of this.floats) {
      const a = Math.min(1, f.life / f.max);
      this.text(f.x, f.y, f.text, f.color, { align: 'center', alpha: a > 0.35 ? 1 : 0.5 });
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.light, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this.drawTexts();
  }

  drawTexts() {
    const tc = this.tctx;
    if (!tc) return;
    const dpr = window.devicePixelRatio || 1;
    const k = this.scale * dpr;                 // art pixel -> device pixel
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);
    tc.textBaseline = 'top';
    let font = 0;
    for (const t of this.texts) {
      const size = Math.round(t.size * k);      // a whole multiple of the design size
      if (size !== font) { tc.font = `${size}px Silkscreen, monospace`; font = size; }
      // Whatever metrics the font turns out to have, a label never runs past its box.
      if (t.max) {
        while (t.str.length > 1 && tc.measureText(t.str).width > t.max * k) {
          t.str = t.str.slice(0, -1);
        }
      }
      tc.textAlign = t.align;
      tc.globalAlpha = t.alpha;
      const x = Math.round((t.x + this.shakeX) * k);
      const y = Math.round((t.y + this.shakeY) * k);
      if (t.shadow) {
        tc.fillStyle = INK;
        tc.fillText(t.str, x + Math.round(k * 2), y + Math.round(k * 2));
      }
      tc.fillStyle = t.color;
      tc.fillText(t.str, x, y);
    }
    tc.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------- tools --- */

const R = Math.round;
function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(R(x), R(y), R(w), R(h));
}

/** Quantised glow: concentric squares, no gradients, so it stays pixel-honest. */
function glowPx(lctx, x, y, color, radius = 4, alpha = 0.5) {
  for (let r = radius; r >= 0; r -= 2) {
    lctx.globalAlpha = alpha * (1 - r / (radius + 2.4));
    lctx.fillStyle = color;
    lctx.fillRect(x - r, y - r, 2 + r * 2, 2 + r * 2);
  }
  lctx.globalAlpha = 1;
}

/**
 * Draw a rect in a machine's own frame: f runs forward (the way it faces), l runs
 * to its right. Rotation is exact — no canvas transform, no subpixel drift.
 */
function rp(ctx, cxp, cyp, dir, f, l, fw, lw, color) {
  let X, Y, W, H;
  if (dir === 0)      { X = cxp + f;      Y = cyp + l;      W = fw; H = lw; }
  else if (dir === 1) { X = cxp - l - lw; Y = cyp + f;      W = lw; H = fw; }
  else if (dir === 2) { X = cxp - f - fw; Y = cyp - l - lw; W = fw; H = lw; }
  else                { X = cxp + l;      Y = cyp - f - fw; W = lw; H = fw; }
  px(ctx, X, Y, W, H, color);
}

/** A 6-pixel arrow head pointing `dir`, drawn from (x, y) at the cell centre. */
function chevron(ctx, cxp, cyp, dir, color, reach = 8) {
  for (let i = 0; i < 6; i += 2) {
    const half = 6 - i;
    rp(ctx, cxp, cyp, dir, reach + i, -half, 2, half * 2, color);
  }
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((n >> 16) & 255) * amt), g = cl(((n >> 8) & 255) * amt), b = cl((n & 255) * amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* ------------------------------------------------------------------ panels --- */

/**
 * Draw one player's factory.
 * @param {Stage} st
 * @param {object} view compact view from sim.viewOf
 * @param {object} rect panel rect
 * @param {object} meta { name, color, earned, ghost, selected, note, noteColor }
 */
export function drawPanel(st, view, rect, meta = {}) {
  const { ctx, lctx } = st;
  const col = meta.color || PLAYER_COLORS[0];
  const o = st.floorOrigin(rect);

  // plate
  px(ctx, rect.x, rect.y, rect.w, rect.h, PLATE);
  px(ctx, rect.x, rect.y, rect.w, 2, PLATE2);
  px(ctx, rect.x, rect.y, 2, rect.h, PLATE2);
  px(ctx, rect.x, rect.y + rect.h - 2, rect.w, 2, INK);
  px(ctx, rect.x + rect.w - 2, rect.y, 2, rect.h, INK);

  // header strip in the player's colour (the phone has its own HUD instead)
  if (st.shape.header) {
    px(ctx, rect.x + 2, rect.y + 2, rect.w - 4, HEADER - 4, meta.ghost ? '#2a2f45' : col.dark);
    px(ctx, rect.x + 2, rect.y + HEADER - 3, rect.w - 4, 1,
      meta.ghost ? '#3a415e' : shade(col.dark, 1.5));
    st.text(rect.x + 6, rect.y + 3, String(meta.name || 'PLAYER').toUpperCase().slice(0, 10),
      meta.ghost ? DIM : col.lit, { max: rect.w * 0.52 });
    st.text(rect.x + rect.w - 6, rect.y + 3, '$' + (meta.earned ?? view.e ?? 0),
      meta.ghost ? DIM : '#ffe9a8', { align: 'right', max: rect.w * 0.42 });
  } else {
    px(ctx, rect.x, rect.y, rect.w, 2, col.dark);
    px(ctx, rect.x, rect.y + rect.h - 2, rect.w, 2, col.dark);
  }

  /*
   * The plot is always the full board; the claim is how much of it this player
   * owns. Unbought land is drawn as flat dirt with none of the slot furniture, so
   * the shape of what you have paid for reads instantly from across the room —
   * and so does the shape of what you could still take.
   */
  const claim = view.cl || GRID;
  const gp = gridPx();
  const cp = claim * CELL;
  px(ctx, o.x - 4, o.y - 4, gp + 8, gp + 8, '#0d0f1a');
  px(ctx, o.x - 2, o.y - 2, gp + 4, gp + 4, '#242a40');
  px(ctx, o.x, o.y, gp, gp, DIRT);

  // owned ground, and a bright fence around it
  px(ctx, o.x - 2, o.y - 2, cp + 4, cp + 4, LINE);
  px(ctx, o.x, o.y, cp, cp, FLOOR);
  px(ctx, o.x + cp, o.y - 2, 2, cp + 4, FENCE);
  px(ctx, o.x - 2, o.y + cp, cp + 4, 2, FENCE);

  const terr = view.tr || '';
  const groundAt = i => (terr.charCodeAt(i) - 48) || 0;

  for (let i = 0; i < GRID * GRID; i++) {
    const ax = cx(i), ay = cy(i);
    const gx = o.x + ax * CELL, gy = o.y + ay * CELL;
    const ground = groundAt(i);
    if (ax >= claim || ay >= claim) {
      // unbought: a sparse speckle, enough to read as ground rather than a void
      px(ctx, gx + 7, gy + 11, 2, 2, DIRT2);
      px(ctx, gx + 18, gy + 6, 2, 2, DIRT2);
      px(ctx, gx + 13, gy + 21, 2, 2, DIRT2);
      px(ctx, gx + 24, gy + 17, 2, 2, DIRT2);
      // Terrain is drawn on land you have not bought as well, dimmed. Knowing what
      // is lying on the next ring before you pay for it is the entire reason for
      // putting anything on the ground.
      if (ground) drawGround(ctx, gx, gy, ground, true);
      continue;
    }
    px(ctx, gx, gy, CELL - 2, 2, '#20243a');
    px(ctx, gx, gy, 2, CELL - 2, '#20243a');
    if (ground) { drawGround(ctx, gx, gy, ground, false); continue; }
    if (!view.g[i]) {
      // empty slot: corner ticks, so the grid reads as slots and not a blank sheet
      px(ctx, gx + 4, gy + 4, 5, 2, '#252b45');
      px(ctx, gx + 4, gy + 4, 2, 5, '#252b45');
      px(ctx, gx + CELL - 9, gy + CELL - 6, 5, 2, '#252b45');
      px(ctx, gx + CELL - 6, gy + CELL - 9, 2, 5, '#252b45');
    }
  }

  // The next ring, hinted with a dashed line while there is still land to buy.
  if (claim < GRID) {
    const np = (claim + 1) * CELL;
    for (let d = 0; d < np; d += 6) {
      px(ctx, o.x + np, o.y + d, 2, 3, '#2a3150');
      px(ctx, o.x + d, o.y + np, 3, 2, '#2a3150');
    }
  }

  if (meta.selected != null) {
    const gx = o.x + cx(meta.selected) * CELL, gy = o.y + cy(meta.selected) * CELL;
    const c = (st.t * 6) % 2 < 1 ? col.lit : col.hex;
    px(ctx, gx - 2, gy - 2, CELL + 2, 2, c);
    px(ctx, gx - 2, gy + CELL - 2, CELL + 2, 2, c);
    px(ctx, gx - 2, gy - 2, 2, CELL + 2, c);
    px(ctx, gx + CELL - 2, gy - 2, 2, CELL + 4, c);
  }

  const gut = st.gutter || GUTTER;
  for (const port of view.pp || [[PRODUCER_PORT.cell, 0, view.pf || 0, view.px || 0]]) {
    drawProducer(ctx, lctx, o, view, st.t, gut, port);
  }
  if (view.lb) drawLab(ctx, lctx, o, view, st.t, gut, view.lb);
  for (const v of view.sv || []) drawSeller(ctx, lctx, o, view, st.t, gut, v);

  for (let i = 0; i < GRID * GRID; i++) {
    const m = view.g[i];
    if (m) drawMachine(ctx, lctx, o.x + cx(i) * CELL, o.y + cy(i) * CELL, m, st.t);
  }

  // Gizmos, drawn 3x3 and centred on their true position so a moving line of them
  // is legible at arm's length on a phone. Copies are dimmer and unlit, because a
  // copy cannot be copied and that is worth seeing at a glance.
  for (const g of view.z) {
    const ty = g[1], isCopy = g[4];
    const gx = R(o.x + g[2] * CELL) - GIZ / 2, gy = R(o.y + g[3] * CELL) - GIZ / 2;
    if (gx < rect.x || gx > rect.x + rect.w || gy < rect.y || gy > rect.y + rect.h) continue;
    const t = TYPES[ty] || TYPES[0];
    // Brightness tracks what a gizmo is worth, not where it sits in TYPES — the
    // Part and Product families are appended after the ladder, so an index test
    // would light a $1 Resin like a Prism.
    const mid = GIZ / 2;
    if (isCopy) {
      // A copy is hollow: the same colour, but you can see through the middle of
      // it, which at this size reads faster than the old dimming did.
      px(ctx, gx, gy, GIZ, GIZ, shade(t.color, 0.55));
      px(ctx, gx + 2, gy + 2, GIZ - 4, GIZ - 4, '#141726');
      if (t.value >= 30) glowPx(lctx, gx + mid, gy + mid, t.glow, 4, 0.16);
      continue;
    }
    px(ctx, gx, gy, GIZ, GIZ, t.color);
    px(ctx, gx, gy, GIZ, 1, t.glow);                 // lit top edge, so it is not flat
    px(ctx, gx, gy, 1, GIZ, shade(t.color, 1.25));
    px(ctx, gx, gy + GIZ - 1, GIZ, 1, shade(t.color, 0.62));
    if (t.value >= 60) glowPx(lctx, gx + mid, gy + mid, t.glow, 7, 0.5);
    else if (t.value >= 4) glowPx(lctx, gx + mid, gy + mid, t.glow, 5, 0.36);
    else glowPx(lctx, gx + mid, gy + mid, t.glow, 4, 0.2);
  }

  if (meta.note && st.shape.note) {
    px(ctx, rect.x + 2, rect.y + rect.h - NOTE_H - 2, rect.w - 4, NOTE_H, '#0d0f1a');
    st.text(rect.x + rect.w / 2, rect.y + rect.h - NOTE_H, String(meta.note),
      meta.noteColor || '#ffe9a8', { align: 'center', max: rect.w - 10 });
  }

  if (meta.ghost) {
    ctx.globalAlpha = 0.55;
    px(ctx, rect.x + 2, rect.y + HEADER, rect.w - 4, rect.h - HEADER - 2, '#0b0d16');
    ctx.globalAlpha = 1;
    st.text(rect.x + rect.w / 2, rect.y + rect.h / 2 - 8, 'OFFLINE', DIM, { align: 'center' });
  }
}

/**
 * What is lying on a slot. Rubble is loose and warm-toned — it looks like something
 * you could shift, which you can, for a fee. Bedrock is cold and squared off and
 * reads as part of the floor plan rather than an obstacle on it, because that is
 * what it is: routing around bedrock is the map's whole contribution to the game.
 */
function drawGround(ctx, x, y, kind, faded) {
  const a = faded ? 0.4 : 1;
  ctx.globalAlpha = a;
  if (kind === 2) {
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
    px(ctx, x + 20, y + 18, 4, 4, shade(ROCK, 0.8));
    px(ctx, x + 8, y + 7, 3, 3, shade(ROCK, 0.75));
  }
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------- machines --- */

function drawMachine(ctx, lctx, x, y, m, t) {
  const k = KINDS[m.k] || KINDS.pipe;
  const body = k.body, trim = k.trim, lit = k.lit;
  const flash = m.f || 0;
  const cxp = x + CELL / 2, cyp = y + CELL / 2;
  const d = m.d;

  // casing: outline, body, and a light source from the top left
  px(ctx, x + 1, y + 1, CELL - 2, CELL - 2, '#0c0e18');
  px(ctx, x + 3, y + 3, CELL - 6, CELL - 6, body);
  px(ctx, x + 3, y + 3, CELL - 6, 2, shade(body, 1.6));
  px(ctx, x + 3, y + 3, 2, CELL - 6, shade(body, 1.28));
  px(ctx, x + 3, y + CELL - 7, CELL - 6, 4, shade(body, 0.6));
  px(ctx, x + CELL - 5, y + 3, 2, CELL - 6, shade(body, 0.74));
  // corner bolts
  const bolt = shade(body, 1.75);
  px(ctx, x + 5, y + 5, 2, 2, bolt);
  px(ctx, x + CELL - 7, y + 5, 2, 2, bolt);
  px(ctx, x + 5, y + CELL - 7, 2, 2, bolt);
  px(ctx, x + CELL - 7, y + CELL - 7, 2, 2, bolt);

  switch (m.k) {
    case 'pipe': {
      rp(ctx, cxp, cyp, d, -13, -7, 26, 14, '#0e1526');
      rp(ctx, cxp, cyp, d, -13, -8, 26, 1, shade(trim, 0.55));
      rp(ctx, cxp, cyp, d, -13, 7, 26, 1, shade(trim, 0.55));
      const speed = m.l >= 3 ? 46 : m.l >= 2 ? 36 : 26;
      const off = Math.floor(t * speed) % 8;
      for (let i = -1; i < 4; i++) {
        const f = -13 + i * 8 + off;
        if (f > -13 && f < 11) rp(ctx, cxp, cyp, d, f, -5, 3, 10, trim);
      }
      break;
    }
    case 'store': {
      // A belt with a tank bolted over it. The belt rotates with the machine so you
      // can read its facing; the tank gauge and the corner crates do not, so how full
      // it is reads the same whichever way the thing is turned.
      rp(ctx, cxp, cyp, d, -13, -5, 26, 10, '#0e1526');
      rp(ctx, cxp, cyp, d, -13, -6, 26, 1, shade(trim, 0.5));
      rp(ctx, cxp, cyp, d, -13, 5, 26, 1, shade(trim, 0.5));
      const soff = Math.floor(t * 22) % 8;
      for (let i = -1; i < 4; i++) {
        const bf = -13 + i * 8 + soff;
        if (bf > -13 && bf < 11) rp(ctx, cxp, cyp, d, bf, -3, 3, 6, shade(trim, 0.9));
      }

      // corner crates, so a Storage is recognisable at a glance in a busy floor
      const crate = shade(trim, 0.7);
      px(ctx, x + 6, y + 6, 4, 4, crate);
      px(ctx, x + CELL - 10, y + 6, 4, 4, crate);
      px(ctx, x + 6, y + CELL - 10, 4, 4, crate);
      px(ctx, x + CELL - 10, y + CELL - 10, 4, 4, crate);

      // tank gauge across the top: how full, out of how much
      const gw = CELL - 14;
      px(ctx, x + 7, y + 4, gw, 3, '#0b0d16');
      const fill = Math.max(0, Math.min(1, (m.q || 0) / (m.c || 1)));
      const fw = Math.round(fill * gw);
      if (fw > 0) {
        px(ctx, x + 7, y + 4, fw, 3, fill > 0.99 ? '#ffcd75' : lit);
        if (fill > 0.85) glowPx(lctx, x + 7 + fw - 1, y + 5, lit, 3, 0.35);
      }
      // one tick per four units of room, so a bigger tank looks bigger
      for (let u = 4; u < (m.c || 1); u += 4) {
        px(ctx, x + 7 + Math.round((u / (m.c || 1)) * gw), y + 4, 1, 3, '#0b0d16');
      }
      break;
    }
    case 'dup': {
      rp(ctx, cxp, cyp, d, -11, -10, 12, 12, shade(trim, 0.6));
      rp(ctx, cxp, cyp, d, -9, -8, 8, 8, shade(trim, 0.85));
      rp(ctx, cxp, cyp, d, -3, -2, 12, 12, trim);
      rp(ctx, cxp, cyp, d, -1, 0, 8, 8, lit);
      break;
    }
    case 'bal': {
      // A junction, not a machine: two belts leaving one throat. The branch is drawn
      // on whichever side it actually fires, so a flipped one looks flipped.
      const right = !m.mi, both = m.l >= 3;
      rp(ctx, cxp, cyp, d, -13, -3, 26, 6, '#0e1526');
      if (both || right) rp(ctx, cxp, cyp, d, -2, -3, 6, 14, '#0e1526');
      if (both || !right) rp(ctx, cxp, cyp, d, -2, -11, 6, 14, '#0e1526');
      rp(ctx, cxp, cyp, d, -13, -2, 22, 4, trim);        // straight through
      if (both || right) rp(ctx, cxp, cyp, d, -1, -2, 4, 12, trim);
      if (both || !right) rp(ctx, cxp, cyp, d, -1, -10, 4, 12, trim);
      rp(ctx, cxp, cyp, d, -6, -6, 12, 12, shade(trim, 0.5));
      const lamp = (m.q || 0) > 0 ? ((m.fl | 0) % 2) : ((Math.floor(t * 2)) % 2);
      rp(ctx, cxp, cyp, d, -3, -3, 6, 6, lamp ? lit : shade(lit, 0.5));
      if (both || right) chevronR(ctx, cxp, cyp, d, 1, lit);
      if (both || !right) chevronR(ctx, cxp, cyp, d, 3, lit);
      break;
    }
    case 'sort': {
      // Same junction, with a gem in the throat showing what it is looking for.
      const want = TYPES[m.m ?? 1] || TYPES[1];
      const sright = !m.mi, sboth = m.l >= 3;
      rp(ctx, cxp, cyp, d, -13, -3, 26, 6, '#0e1526');
      if (sboth || sright) rp(ctx, cxp, cyp, d, -2, -3, 6, 14, '#0e1526');
      if (sboth || !sright) rp(ctx, cxp, cyp, d, -2, -11, 6, 14, '#0e1526');
      rp(ctx, cxp, cyp, d, -13, -2, 22, 4, shade(trim, 0.8));
      if (sboth || sright) rp(ctx, cxp, cyp, d, -1, -2, 4, 12, want.color);
      if (sboth || !sright) rp(ctx, cxp, cyp, d, -1, -10, 4, 12, want.color);
      // the gate: a lens in the filtered type's colour
      rp(ctx, cxp, cyp, d, -6, -7, 12, 14, '#0b1220');
      rp(ctx, cxp, cyp, d, -4, -5, 8, 10, shade(want.color, 0.7));
      rp(ctx, cxp, cyp, d, -2, -3, 4, 6, want.color);
      rp(ctx, cxp, cyp, d, -1, -2, 2, 2, want.glow);
      if (sboth || sright) chevronR(ctx, cxp, cyp, d, 1, want.glow);
      if (sboth || !sright) chevronR(ctx, cxp, cyp, d, 3, want.glow);
      glowPx(lctx, R(cxp), R(cyp), want.glow, 3, 0.22);
      break;
    }
    case 'trident': {
      rp(ctx, cxp, cyp, d, -6, -12, 5, 24, shade(trim, 0.7));
      rp(ctx, cxp, cyp, d, -1, -11, 11, 4, trim);
      rp(ctx, cxp, cyp, d, -1, -2, 11, 4, trim);
      rp(ctx, cxp, cyp, d, -1, 7, 11, 4, trim);
      rp(ctx, cxp, cyp, d, -8, -4, 3, 8, lit);
      break;
    }
    case 'mut': {
      const core = TYPES[m.m] || TYPES[1];
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      px(ctx, cxp - 9, cyp - 9, 18, 18, '#0e1020');
      px(ctx, cxp - 8, cyp - 6, 16, 12, core.color);
      px(ctx, cxp - 6, cyp - 8, 12, 16, core.color);
      px(ctx, cxp - 4, cyp - 4, 8, 8, core.glow);
      px(ctx, cxp - 2, cyp - 2, 4, 4, '#ffffff');
      rp(ctx, cxp, cyp, d, 9, -3, 4, 6, shade(trim, 1.2));   // emitter nub
      if (pulse > 0.5) glowPx(lctx, R(cxp) - 1, R(cyp) - 1, core.glow, 4, 0.4 * pulse);
      break;
    }
    case 'asm': {
      // Two intakes that are visibly different, because the whole machine is about
      // two things being different: each mouth is painted in its ingredient's
      // colour, and the bay in the middle glows the colour of what comes out.
      const r = RECIPES[m.m ?? 0] || RECIPES[0];
      const inA = TYPES[r.ins[0]] || TYPES[0];
      const inB = TYPES[r.ins[1]] || TYPES[0];
      const out = TYPES[r.out] || TYPES[0];
      rp(ctx, cxp, cyp, d, -13, -11, 7, 8, '#0e1020');
      rp(ctx, cxp, cyp, d, -13, 3, 7, 8, '#0e1020');
      rp(ctx, cxp, cyp, d, -12, -10, 5, 6, inA.color);
      rp(ctx, cxp, cyp, d, -12, 4, 5, 6, inB.color);
      // the bay
      rp(ctx, cxp, cyp, d, -6, -8, 15, 16, '#0b0d16');
      rp(ctx, cxp, cyp, d, -4, -6, 11, 12, shade(trim, 0.45));
      const beat = 0.5 + 0.5 * Math.sin(t * 4);
      rp(ctx, cxp, cyp, d, -2, -4, 7, 8, beat > 0.55 ? out.color : shade(out.color, 0.55));
      rp(ctx, cxp, cyp, d, 0, -2, 3, 4, beat > 0.55 ? out.glow : out.color);
      // the arm that swings across the bay
      const arm = Math.floor((t * 5) % 2) ? -5 : 3;
      rp(ctx, cxp, cyp, d, -5, arm, 13, 2, shade(trim, 1.15));
      rp(ctx, cxp, cyp, d, 9, -4, 4, 8, shade(trim, 1.1));     // spout
      glowPx(lctx, R(cxp), R(cyp), out.glow, 4, 0.3 * beat);
      break;
    }
    case 'fuse': {
      rp(ctx, cxp, cyp, d, -12, -10, 6, 7, shade(trim, 0.75));   // two intakes
      rp(ctx, cxp, cyp, d, -12, 3, 6, 7, shade(trim, 0.75));
      rp(ctx, cxp, cyp, d, -7, -9, 4, 5, shade(trim, 0.5));
      rp(ctx, cxp, cyp, d, -7, 4, 4, 5, shade(trim, 0.5));
      rp(ctx, cxp, cyp, d, -6, -7, 14, 14, '#150a08');          // crucible
      const heat = 0.4 + 0.6 * Math.abs(Math.sin(t * 3));
      rp(ctx, cxp, cyp, d, -3, -5, 8, 10, heat > 0.7 ? lit : trim);
      rp(ctx, cxp, cyp, d, -1, -3, 4, 6, heat > 0.7 ? '#ffffff' : lit);
      rp(ctx, cxp, cyp, d, 8, -3, 4, 6, shade(trim, 1.1));      // spout
      glowPx(lctx, R(cxp), R(cyp), lit, 4, 0.3 * heat);
      break;
    }
  }

  /*
   * The cargo readout. A machine takes custody of what it eats for the whole
   * cycle, so this strip is the honest answer to "what is in there right now":
   * the gizmos in its hands drawn bright and lit, then anything still queued at
   * the mouth drawn small and dim behind them. Past the halfway mark the held
   * gizmos become what the machine has made, so a Fuser shows two going in and
   * one hotter one waiting to come out.
   */
  const held = m.h || [], queued = m.b || [];
  const all = [...held.map(ty => [ty, 1]), ...queued.map(ty => [ty, 0])];
  const cargo = all.slice(0, 4);
  const over = all.length - cargo.length;
  if (cargo.length) {
    const step = CARGO + 2;
    const cw = cargo.length * step - 2 + (over > 0 ? 3 : 0);
    let gx = R(cxp - cw / 2), gy = y + CELL - 13;
    px(ctx, gx - 2, gy - 2, cw + 4, CARGO + 4, '#070911');
    for (const [ty, inHand] of cargo) {
      const t = TYPES[ty] || TYPES[0];
      if (inHand) {
        px(ctx, gx, gy, CARGO, CARGO, t.color);
        px(ctx, gx, gy, CARGO, 1, t.glow);
        glowPx(lctx, gx + CARGO / 2, gy + CARGO / 2, t.glow, 4, 0.45);
      } else {
        px(ctx, gx, gy + 1, CARGO - 1, CARGO - 2, shade(t.color, 0.55));
      }
      gx += step;
    }
    // "...and more behind these" — a Storage can be holding a dozen.
    if (over > 0) { px(ctx, gx, gy, 1, CARGO, shade(lit, 0.8)); px(ctx, gx, gy + 1, 2, 1, shade(lit, 0.8)); }
  }

  /*
   * Ratios, made visible. A floor has exactly two failure modes and they want
   * opposite fixes: a machine holding finished goods it cannot hand on is BACKED
   * UP and needs the line ahead widened, while a machine standing empty is
   * STARVED and needs more fed to it. Amber all round the casing is a jam; four
   * cool corner ticks are a starve. Learning to tell them apart at a glance is
   * most of learning to balance a factory.
   */
  const jam = m.x ? '#ffcd75' : null;
  if (m.s && !jam) {
    const puls = (t * 1.6) % 1 < 0.6 ? '#4d7fb0' : '#395c81';
    px(ctx, x + 2, y + 2, 6, 2, puls);
    px(ctx, x + 2, y + 2, 2, 6, puls);
    px(ctx, x + CELL - 8, y + 2, 6, 2, puls);
    px(ctx, x + CELL - 4, y + 2, 2, 6, puls);
    px(ctx, x + 2, y + CELL - 4, 6, 2, puls);
    px(ctx, x + 2, y + CELL - 8, 2, 6, puls);
    px(ctx, x + CELL - 8, y + CELL - 4, 6, 2, puls);
    px(ctx, x + CELL - 4, y + CELL - 8, 2, 6, puls);
  }
  const w = Math.max(0, Math.min(1, m.p || 0)) * (CELL - 14);
  if (w > 1) px(ctx, x + 7, y + CELL - 6, w, 2, jam || shade(lit, 0.9));

  if (jam) {
    const beat = (t * 3) % 1 < 0.55;
    const c = beat ? jam : shade(jam, 0.45);
    px(ctx, x + 1, y + 1, CELL - 2, 2, c);
    px(ctx, x + 1, y + CELL - 3, CELL - 2, 2, c);
    px(ctx, x + 1, y + 1, 2, CELL - 2, c);
    px(ctx, x + CELL - 3, y + 1, 2, CELL - 2, c);
    if (beat) glowPx(lctx, R(cxp), R(cyp), jam, 4, 0.18);
  }

  // facing chevron, kept inside the casing
  chevron(ctx, cxp, cyp, m.d, flash > 0.2 ? '#ffffff' : lit, 7);

  // level pips
  for (let i = 1; i < (m.l || 1); i++) px(ctx, x + 9 + (i - 1) * 4, y + 6, 2, 2, '#ffe9a8');

  // A firing machine flashes, but never so hard that you cannot tell what it is.
  if (flash > 0.05) {
    ctx.globalAlpha = Math.min(0.3, flash * 0.3);
    px(ctx, x + 3, y + 3, CELL - 6, CELL - 6, '#ffffff');
    ctx.globalAlpha = 1;
    px(ctx, x + 2, y + 2, CELL - 4, 2, lit);
    px(ctx, x + 2, y + CELL - 4, CELL - 4, 2, lit);
    px(ctx, x + 2, y + 2, 2, CELL - 4, lit);
    px(ctx, x + CELL - 4, y + 2, 2, CELL - 4, lit);
    glowPx(lctx, R(cxp), R(cyp), lit, 4, 0.22 * flash);
  }
}

/** Small arrow on a router's side output. */
function chevronR(ctx, cxp, cyp, dir, side, color) {
  const d = (dir + side + 4) % 4;
  for (let i = 0; i < 4; i += 2) {
    const half = 4 - i;
    rp(ctx, cxp, cyp, d, 9 + i, -half, 2, half * 2, color);
  }
}

/* --------------------------------------------------------- producer/seller --- */

/**
 * The feeds. A floor may be running one or two; each is drawn in the colour of
 * whatever it drops, so which line is Scrap and which is Resin is obvious from
 * across the room without reading a word. `port` is [cell, type, flash, stalled]
 * as packed by sim.viewOf.
 */
function drawProducer(ctx, lctx, o, view, t, gut = GUTTER, port) {
  const cell = port[0];
  const ty = TYPES[port[1]] || TYPES[0];
  const flash = port[2] || 0;
  const stalled = port[3];
  const y = o.y + cy(cell) * CELL;

  if (gut < 24) return drawSlimProducer(ctx, lctx, o.x - gut + 1, y, flash, t, view, ty, stalled);

  const x = o.x - gut + 2;
  px(ctx, x, y + 2, 20, CELL - 4, '#0c0e18');
  px(ctx, x + 2, y + 4, 16, CELL - 8, '#3a4257');
  px(ctx, x + 2, y + 4, 16, 2, '#5a6480');
  px(ctx, x + 2, y + 4, 2, CELL - 8, '#4a5470');
  px(ctx, x + 2, y + CELL - 8, 16, 2, '#242a3c');
  // hopper mouth and piston
  px(ctx, x + 4, y + 8, 12, 11, '#161a2a');
  px(ctx, x + 5, y + 9, 10, 2, '#242a3c');
  const bob = Math.floor((t * 6) % 2) * 2;
  px(ctx, x + 6, y + 12 + bob, 8, 4, flash > 0.3 ? '#ffffff' : shade(ty.color, 0.9));
  px(ctx, x + 6, y + 12 + bob, 8, 1, ty.glow);
  // gauge: green while it is dropping gizmos, amber when the floor has no room left
  px(ctx, x + 5, y + 22, 4, 3,
    stalled ? ((t * 3) % 1 < 0.5 ? '#ffcd75' : '#6b5a24') : flash > 0.2 ? '#a7f070' : '#3f7a2c');
  // nozzle into the floor, in the colour of whatever comes out of it
  px(ctx, x + 18, y + 12, 6, 8, '#5a6480');
  px(ctx, x + 20, y + 14, 4, 4, flash > 0.2 ? '#ffffff' : ty.color);
  if (flash > 0.05) glowPx(lctx, x + 21, y + 15, ty.glow, 4, 0.5 * flash);
  for (let i = 1; i < (view.pl || 1); i++) px(ctx, x + 3 + (i - 1) * 4, y + CELL - 8, 2, 4, '#ffe9a8');
}

/** Producer for a narrow gutter: same idea, 18 pixels wide instead of 26. */
function drawSlimProducer(ctx, lctx, x, y, flash, t, view, ty = TYPES[0], stalled = 0) {
  px(ctx, x, y + 4, 14, CELL - 8, '#0c0e18');
  px(ctx, x + 1, y + 6, 12, CELL - 12, '#3a4257');
  px(ctx, x + 1, y + 6, 12, 2, '#5a6480');
  px(ctx, x + 2, y + 10, 10, 8, '#161a2a');
  const bob = Math.floor((t * 6) % 2) * 2;
  px(ctx, x + 4, y + 12 + bob, 6, 3, flash > 0.3 ? '#ffffff' : shade(ty.color, 0.9));
  px(ctx, x + 3, y + 20, 3, 2,
    stalled ? ((t * 3) % 1 < 0.5 ? '#ffcd75' : '#6b5a24') : flash > 0.2 ? '#a7f070' : '#3f7a2c');
  px(ctx, x + 13, y + 13, 5, 6, '#5a6480');
  px(ctx, x + 15, y + 15, 3, 2, flash > 0.2 ? '#ffffff' : ty.color);
  if (flash > 0.05) glowPx(lctx, x + 16, y + 15, ty.glow, 3, 0.5 * flash);
  for (let i = 1; i < (view.pl || 1); i++) px(ctx, x + 2 + (i - 1) * 3, y + CELL - 10, 2, 3, '#ffe9a8');
}

/**
 * The Lab, drawn in the same idiom as a vault because it is the same kind of thing:
 * a port on the fence that pays for whatever you push into it. It sits on the north
 * face of the slot the first vault trades from, so the two are always shoulder to
 * shoulder and the choice between them is one rotation apart.
 * `spot` is [cell, dir, flash].
 */
function drawLab(ctx, lctx, o, view, t, gut = GUTTER, spot) {
  const cell = spot[0], dir = spot[1];
  const [dx, dy] = DIRS[dir];
  const bx = o.x + cx(cell) * CELL + dx * CELL;
  const by = o.y + cy(cell) * CELL + dy * CELL;
  const back = Math.max(2, gut - 16);
  const x = bx + (dx > 0 ? 2 : dx < 0 ? back : 2);
  const y = by + (dy > 0 ? 2 : dy < 0 ? back : 2);
  const w = dx !== 0 ? 16 : CELL - 4, h = dy !== 0 ? 16 : CELL - 4;
  const flash = spot[2] || 0;
  const mx = x + Math.floor(w / 2), my = y + Math.floor(h / 2);

  px(ctx, x - 2, y - 2, w + 4, h + 4, '#0c0e18');
  px(ctx, x, y, w, h, flash > 0.3 ? '#1f4f74' : '#173d5a');
  px(ctx, x, y, w, 2, '#2f7ba8');
  px(ctx, x, y, 2, h, '#26618c');
  px(ctx, x, y + h - 2, w, 2, '#0f2436');
  // intake facing the floor
  const mw = dx !== 0 ? 4 : w - 8, mh = dy !== 0 ? 4 : h - 8;
  const mox = dx > 0 ? x : dx < 0 ? x + w - 4 : x + 4;
  const moy = dy > 0 ? y : dy < 0 ? y + h - 4 : y + 4;
  px(ctx, mox, moy, mw, mh, '#08151f');
  const lip = flash > 0.1 || (t * 2) % 2 < 1.2 ? '#a8dcff' : '#2f7ba8';
  px(ctx, dx > 0 ? mox : dx < 0 ? mox + 2 : mox,
    dy > 0 ? moy : dy < 0 ? moy + 2 : moy,
    dx !== 0 ? 2 : mw, dy !== 0 ? 2 : mh, lip);
  // the flask: a bulb of something that bubbles when it is being fed
  const glass = flash > 0.1 ? '#dff3ff' : '#a8dcff';
  px(ctx, mx - 1, my - 6, 2, 4, glass);
  px(ctx, mx - 4, my - 2, 8, 7, glass);
  px(ctx, mx - 3, my - 1, 6, 5, flash > 0.1 ? '#4fd8bb' : '#2fb98f');
  const bub = Math.floor(t * 4) % 3;
  px(ctx, mx - 2 + bub, my - 1, 1, 1, '#dff3ff');
  if (flash > 0.05) glowPx(lctx, mx, my, '#a8dcff', 6, 0.55 * flash);
  else glowPx(lctx, mx, my, '#a8dcff', 2, 0.16 + 0.09 * Math.sin(t * 2.2));
}

/** One vault. `spot` is [cell, dir, flash] as packed by sim.viewOf. */
function drawSeller(ctx, lctx, o, view, t, gut = GUTTER, spot) {
  const cell = spot[0], dir = spot[1];
  const [dx, dy] = DIRS[dir];
  const bx = o.x + cx(cell) * CELL + dx * CELL;
  const by = o.y + cy(cell) * CELL + dy * CELL;
  const back = Math.max(2, gut - 16);      // sit just outside the floor edge
  const x = bx + (dx > 0 ? 2 : dx < 0 ? back : 2);
  const y = by + (dy > 0 ? 2 : dy < 0 ? back : 2);
  const w = dx !== 0 ? 16 : CELL - 4, h = dy !== 0 ? 16 : CELL - 4;
  const flash = spot[2] || 0;
  const mx = x + Math.floor(w / 2), my = y + Math.floor(h / 2);

  px(ctx, x - 2, y - 2, w + 4, h + 4, '#0c0e18');
  px(ctx, x, y, w, h, flash > 0.3 ? '#6d5a1f' : '#4a3f1c');
  px(ctx, x, y, w, 2, '#8a7530');
  px(ctx, x, y, 2, h, '#6e5c26');
  px(ctx, x, y + h - 2, w, 2, '#2c250f');
  // vault mouth facing the floor, lit so the way in is never in doubt
  const mw = dx !== 0 ? 4 : w - 8, mh = dy !== 0 ? 4 : h - 8;
  const mox = dx > 0 ? x : dx < 0 ? x + w - 4 : x + 4;
  const moy = dy > 0 ? y : dy < 0 ? y + h - 4 : y + 4;
  px(ctx, mox, moy, mw, mh, '#1b1608');
  const glowLip = flash > 0.1 || (t * 2) % 2 < 1.2 ? '#ffcd75' : '#8a7530';
  px(ctx, dx > 0 ? mox : dx < 0 ? mox + 2 : mox,
    dy > 0 ? moy : dy < 0 ? moy + 2 : moy,
    dx !== 0 ? 2 : mw, dy !== 0 ? 2 : mh, glowLip);
  glowPx(lctx, dx !== 0 ? mox : mox + mw / 2, dy !== 0 ? moy : moy + mh / 2, '#ffcd75', 2, 0.22);
  // coin
  const gold = flash > 0.1 ? '#fff3b0' : '#ffcd75';
  px(ctx, mx - 4, my - 4, 8, 8, gold);
  px(ctx, mx - 3, my - 5, 6, 10, gold);
  px(ctx, mx - 5, my - 3, 10, 6, gold);
  px(ctx, mx - 1, my - 3, 2, 6, '#8a7530');
  px(ctx, mx - 3, my - 1, 6, 2, '#8a7530');
  if (flash > 0.05) glowPx(lctx, mx, my, '#ffcd75', 6, 0.55 * flash);
  else glowPx(lctx, mx, my, '#ffcd75', 2, 0.18 + 0.1 * Math.sin(t * 3));

  for (let i = 1; i < (view.sl || 1); i++) px(ctx, x + 2 + (i - 1) * 4, y + h - 6, 2, 3, '#fff3b0');
}

/* --------------------------------------------------------------- fx bridge --- */

/**
 * Turn sim effects into particles, floating text and screen shake.
 * @param {Stage} st
 * @param {Array} fx from sim.drainFx
 * @param {object} o floor origin for the panel that produced them
 */
export function playFx(st, fx, o, opts = {}) {
  const boost = opts.boost ?? 1;
  for (const e of fx) {
    switch (e.k) {
      case 'sell': {
        const [dx, dy] = DIRS[e.dir];
        const x = o.x + (cx(e.cell) + 0.5 + dx * 0.9) * CELL;
        const y = o.y + (cy(e.cell) + 0.5 + dy * 0.9) * CELL;
        const t = TYPES[e.ty] || TYPES[0];
        st.burst(x, y, t.glow, Math.min(16, 4 + Math.round(e.v / 3)), 60, 0.5);
        st.burst(x, y, '#ffcd75', 5, 36, 0.6);
        st.float(x, y - 16, '+' + e.v, '#ffe9a8', { key: 'sell' + o.x + ':' + o.y, value: e.v });
        st.shake(Math.min(9, e.v / 6) * boost);
        break;
      }
      case 'lost': {
        st.burst(o.x + e.x * CELL, o.y + e.y * CELL, '#5a6480', 3, 24, 0.35);
        break;
      }
      case 'clog': {
        st.burst(o.x + (cx(e.cell) + 0.5) * CELL, o.y + (cy(e.cell) + 0.5) * CELL,
          '#ef7d57', 3, 28, 0.3);
        break;
      }
      case 'fire': {
        if (e.n > 2 || (e.ty || 0) >= 4) {
          const t = TYPES[e.ty] || TYPES[0];
          st.burst(o.x + (cx(e.cell) + 0.5) * CELL, o.y + (cy(e.cell) + 0.5) * CELL,
            t.glow, 3, 32, 0.28);
        }
        break;
      }
      case 'up': case 'upprod': case 'upsell': {
        const cell = e.cell ?? 0;
        st.burst(o.x + (cx(cell) + 0.5) * CELL, o.y + (cy(cell) + 0.5) * CELL,
          '#ffe9a8', 12, 52, 0.55);
        st.shake(3 * boost);
        break;
      }
      case 'grow': {
        // The fence moving out is the one moment a factory visibly gets bigger.
        const n = e.claim || CLAIM_START;
        const edge = o.x + n * CELL;
        st.burst(edge, o.y + (n * CELL) / 2, '#a8dcff', 22, 70, 0.7);
        st.burst(o.x + (n * CELL) / 2, o.y + n * CELL, '#a8dcff', 22, 70, 0.7);
        st.float(o.x + (n * CELL) / 2, o.y + n * CELL - 10, `${n} x ${n}`, '#a8dcff');
        st.shake(4 * boost);
        break;
      }
      case 'sci': {
        const x = o.x + (cx(e.cell) + 0.5 + DIRS[e.dir][0] * 0.7) * CELL;
        const y = o.y + (cy(e.cell) + 0.5 + DIRS[e.dir][1] * 0.7) * CELL;
        st.burst(x, y, '#a8dcff', Math.min(14, 3 + Math.round(e.v / 4)), 52, 0.5);
        st.float(x, y - 14, '+' + e.v, '#a8dcff', { key: 'sci' + e.cell, value: e.v });
        break;
      }
      case 'tech': {
        st.float(o.x + (GRID * CELL) / 2, o.y + (GRID * CELL) / 2,
          String(e.name || '').toUpperCase(), '#a8dcff');
        st.burst(o.x + (GRID * CELL) / 2, o.y + (GRID * CELL) / 2, '#a8dcff', 24, 70, 0.9);
        st.shake(5 * boost);
        break;
      }
      case 'clear': {
        const x = o.x + (cx(e.cell) + 0.5) * CELL, y = o.y + (cy(e.cell) + 0.5) * CELL;
        st.burst(x, y, ROCK2, 16, 58, 0.6);
        st.shake(3 * boost);
        break;
      }
      case 'order': {
        st.float(o.x + (GRID * CELL) / 2, o.y + 6, `ORDER FILLED +$${e.v}`, '#ffe9a8');
        st.burst(o.x + (GRID * CELL) / 2, o.y + 14, '#ffe9a8', 18, 64, 0.7);
        st.shake(5 * boost);
        break;
      }
      case 'scrap': {
        const x = o.x + (cx(e.cell ?? 0) + 0.5) * CELL, y = o.y + (cy(e.cell ?? 0) + 0.5) * CELL;
        st.burst(x, y, '#8b93a8', 8, 44, 0.4);
        st.float(x, y - 12, '+$' + e.v, '#a7f070');
        break;
      }
    }
  }
}

/** Big centred banner, plate on the pixel layer and text on the sharp one. */
export function banner(st, text, sub, color = '#ffe9a8') {
  const { ctx } = st;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Size the plate from what the text layer will actually measure, not a guess.
  const w = Math.ceil(Math.max(st.measure(text), sub ? st.measure(sub) : 0)) + 28;
  const h = sub ? 52 : 30;
  const x = Math.round(st.W / 2 - w / 2), y = Math.round(st.H / 2 - h / 2);
  px(ctx, x - 2, y - 2, w + 4, h + 4, '#000000');
  px(ctx, x, y, w, h, '#1e2233');
  px(ctx, x, y, w, 2, color);
  px(ctx, x, y + h - 2, w, 2, color);
  st.text(st.W / 2, y + 7, text, color, { align: 'center' });
  if (sub) st.text(st.W / 2, y + 29, sub, DIM, { align: 'center' });
}
