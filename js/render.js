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
  GRID, CELL, DIRS, TYPES, KINDS, cx, cy, PRODUCER_PORT,
} from './machines.js';

const GRID_PX = GRID * CELL;            // 96
const GUTTER = 24;                      // room outside the floor for producer/seller
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
  floor: { padX: 8, padY: 2, header: HEADER, note: NOTE_H, gap: 12 },
  solo:  { padX: 2, padY: 2, header: 0, note: 0, gap: 2 },
};
const panelW = sh => sh.padX * 2 + GUTTER * 2 + GRID_PX;
const panelH = sh => sh.padY * 2 + sh.header + GUTTER * 2 + GRID_PX + sh.note;

export const PANEL_W = panelW(SHAPE.floor);
export const PANEL_H = panelH(SHAPE.floor);
export const GAP = SHAPE.floor.gap;

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
    this.panelW = panelW(this.shape);
    this.panelH = panelH(this.shape);
    this.gap = this.shape.gap;
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
    for (let cols = 1; cols <= Math.min(4, Math.max(1, n)); cols++) {
      const rows = Math.ceil(n / cols);
      const W = cols * this.panelW + (cols + 1) * this.gap;
      const H = rows * this.panelH + (rows + 1) * this.gap;
      const s = Math.min(maxW / W, maxH / H);
      const fit = Math.abs(Math.log((W / H) / target));
      if (!best || s > best.s + 0.001 || (Math.abs(s - best.s) <= 0.001 && fit < best.fit)) {
        best = { cols, rows, s, fit };
      }
    }
    if (best.cols !== this.cols || best.rows !== this.rows || this.count !== n) {
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
    return {
      x: rect.x + this.shape.padX + GUTTER,
      y: rect.y + this.shape.padY + this.shape.header + GUTTER,
    };
  }

  /**
   * Which slot a point lands in. Anything inside the floor plus a forgiving
   * margin snaps to the nearest slot, so a thumb landing on a grid line still
   * picks the machine the player meant. Returns -1 well outside.
   */
  cellAt(bx, by, rect = this.panelRect(0), slack = 10) {
    const o = this.floorOrigin(rect);
    if (bx < o.x - slack || by < o.y - slack ||
        bx > o.x + GRID_PX + slack || by > o.y + GRID_PX + slack) return -1;
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

  // floor well
  px(ctx, o.x - 4, o.y - 4, GRID_PX + 8, GRID_PX + 8, '#0d0f1a');
  px(ctx, o.x - 2, o.y - 2, GRID_PX + 4, GRID_PX + 4, LINE);
  px(ctx, o.x, o.y, GRID_PX, GRID_PX, FLOOR);

  for (let i = 0; i < GRID * GRID; i++) {
    const gx = o.x + cx(i) * CELL, gy = o.y + cy(i) * CELL;
    px(ctx, gx, gy, CELL - 2, 2, '#20243a');
    px(ctx, gx, gy, 2, CELL - 2, '#20243a');
    if (!view.g[i]) {
      // empty slot: corner ticks, so the grid reads as slots and not a blank sheet
      px(ctx, gx + 4, gy + 4, 5, 2, '#252b45');
      px(ctx, gx + 4, gy + 4, 2, 5, '#252b45');
      px(ctx, gx + CELL - 9, gy + CELL - 6, 5, 2, '#252b45');
      px(ctx, gx + CELL - 6, gy + CELL - 9, 2, 5, '#252b45');
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

  drawProducer(ctx, lctx, o, view, st.t);
  drawSeller(ctx, lctx, o, view, st.t);

  for (let i = 0; i < GRID * GRID; i++) {
    const m = view.g[i];
    if (m) drawMachine(ctx, lctx, o.x + cx(i) * CELL, o.y + cy(i) * CELL, m, st.t);
  }

  // gizmos: one grid unit each, colour by type, glow by tier
  for (const g of view.z) {
    const ty = g[1];
    const gx = R(o.x + g[2] * CELL), gy = R(o.y + g[3] * CELL);
    if (gx < rect.x || gx > rect.x + rect.w || gy < rect.y || gy > rect.y + rect.h) continue;
    const t = TYPES[ty] || TYPES[0];
    px(ctx, gx, gy, 2, 2, t.color);
    if (ty >= 5) glowPx(lctx, gx, gy, t.glow, 4, 0.5);
    else if (ty >= 2) glowPx(lctx, gx, gy, t.glow, 2, 0.34);
    else glowPx(lctx, gx, gy, t.glow, 2, 0.16);
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
    case 'dup': {
      rp(ctx, cxp, cyp, d, -11, -10, 12, 12, shade(trim, 0.6));
      rp(ctx, cxp, cyp, d, -9, -8, 8, 8, shade(trim, 0.85));
      rp(ctx, cxp, cyp, d, -3, -2, 12, 12, trim);
      rp(ctx, cxp, cyp, d, -1, 0, 8, 8, lit);
      break;
    }
    case 'split': {
      rp(ctx, cxp, cyp, d, -12, -2, 22, 4, trim);       // straight through
      rp(ctx, cxp, cyp, d, -2, -2, 4, 13, trim);        // branch to its right
      rp(ctx, cxp, cyp, d, -5, -5, 10, 10, shade(trim, 0.55));
      rp(ctx, cxp, cyp, d, -3, -3, 6, 6, lit);
      chevronR(ctx, cxp, cyp, d, 1, lit);               // right-hand arrow
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

  // held gizmos, sitting in the intake
  for (let i = 0; i < (m.b || []).length && i < 3; i++) {
    const ty = TYPES[m.b[i]] || TYPES[0];
    const gx = x + 7 + i * 6, gy = y + CELL - 10;
    px(ctx, gx, gy, 2, 2, ty.color);
    glowPx(lctx, gx, gy, ty.glow, 2, 0.3);
  }

  // charge bar
  const w = Math.max(0, Math.min(1, m.p || 0)) * (CELL - 14);
  if (w > 1) px(ctx, x + 7, y + CELL - 6, w, 2, shade(lit, 0.9));

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

/** Small arrow on the splitter's side output. */
function chevronR(ctx, cxp, cyp, dir, side, color) {
  const d = (dir + side + 4) % 4;
  for (let i = 0; i < 4; i += 2) {
    const half = 4 - i;
    rp(ctx, cxp, cyp, d, 9 + i, -half, 2, half * 2, color);
  }
}

/* --------------------------------------------------------- producer/seller --- */

function drawProducer(ctx, lctx, o, view, t) {
  const cell = PRODUCER_PORT.cell;
  const x = o.x - GUTTER + 2, y = o.y + cy(cell) * CELL;
  const flash = view.pf || 0;

  px(ctx, x, y + 2, 20, CELL - 4, '#0c0e18');
  px(ctx, x + 2, y + 4, 16, CELL - 8, '#3a4257');
  px(ctx, x + 2, y + 4, 16, 2, '#5a6480');
  px(ctx, x + 2, y + 4, 2, CELL - 8, '#4a5470');
  px(ctx, x + 2, y + CELL - 8, 16, 2, '#242a3c');
  // hopper mouth and piston
  px(ctx, x + 4, y + 8, 12, 11, '#161a2a');
  px(ctx, x + 5, y + 9, 10, 2, '#242a3c');
  const bob = Math.floor((t * 6) % 2) * 2;
  px(ctx, x + 6, y + 12 + bob, 8, 4, flash > 0.3 ? '#ffffff' : '#8b93a8');
  px(ctx, x + 6, y + 12 + bob, 8, 1, '#c3cbdb');
  // gauge
  px(ctx, x + 5, y + 22, 4, 3, flash > 0.2 ? '#a7f070' : '#3f7a2c');
  // nozzle into the floor
  px(ctx, x + 18, y + 12, 6, 8, '#5a6480');
  px(ctx, x + 20, y + 14, 4, 4, flash > 0.2 ? '#ffffff' : '#c3cbdb');
  if (flash > 0.05) glowPx(lctx, x + 21, y + 15, '#c3cbdb', 4, 0.5 * flash);
  for (let i = 1; i < (view.pl || 1); i++) px(ctx, x + 3 + (i - 1) * 4, y + CELL - 8, 2, 4, '#ffe9a8');
}

function drawSeller(ctx, lctx, o, view, t) {
  const cell = view.sc, dir = view.sd;
  const [dx, dy] = DIRS[dir];
  const bx = o.x + cx(cell) * CELL + dx * CELL;
  const by = o.y + cy(cell) * CELL + dy * CELL;
  const x = bx + (dx > 0 ? 2 : dx < 0 ? 8 : 2);
  const y = by + (dy > 0 ? 2 : dy < 0 ? 8 : 2);
  const w = dx !== 0 ? 16 : CELL - 4, h = dy !== 0 ? 16 : CELL - 4;
  const flash = view.sf || 0;
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
