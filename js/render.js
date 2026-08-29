/**
 * render.js — the pixel renderer.
 *
 * Everything is drawn 1:1 into a small backing canvas (roughly 172 x 192) and the
 * browser scales it up with nearest-neighbour filtering. Nothing is ever drawn at
 * a fractional coordinate, so every pixel on screen is a whole, square pixel.
 *
 * The same code draws the host floor (up to four panels) and a phone (one panel).
 */

import {
  GRID, CELL, DIRS, TYPES, KINDS, cx, cy, PRODUCER_PORT,
} from './machines.js';

export const PANEL_W = 80;
export const PANEL_H = 90;
export const GAP = 6;

const GRID_PX = GRID * CELL;            // 48
const GUTTER = 12;                      // room outside the floor for producer/seller
const HEADER = 10;

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
const TEXT = '#e8ecf8';
const DIM = '#7c86a6';

/* ------------------------------------------------------------------- stage --- */

export class Stage {
  /** compact drops the note strip: the phone shows one panel and needs the height. */
  constructor(canvas, { compact = false } = {}) {
    this.panelH = compact ? PANEL_H - 8 : PANEL_H;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.parts = [];
    this.floats = [];
    this.shakeAmt = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.t = 0;
    this.scale = 1;
    this.layout(1);
  }

  layout(n, cols, rows) {
    this.count = n;
    this.cols = cols || (n <= 1 ? 1 : 2);
    this.rows = rows || Math.ceil(n / this.cols);
    this.W = this.cols * PANEL_W + (this.cols + 1) * GAP;
    this.H = this.rows * this.panelH + (this.rows + 1) * GAP;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.light.width = this.W;
    this.light.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.lctx.imageSmoothingEnabled = false;
  }

  /** Integer-scale the canvas element to fill its container without blurring. */
  fit(maxW, maxH) {
    const s = Math.max(1, Math.floor(Math.min(maxW / this.W, maxH / this.H)));
    if (s === this.scale) return s;
    this.scale = s;
    this.canvas.style.width = this.W * s + 'px';
    this.canvas.style.height = this.H * s + 'px';
    return s;
  }

  /**
   * Pick the panel arrangement that gives the biggest whole-number scale in the
   * space available, then scale to it. A wide short window ends up with one row;
   * a tall one with a square grid.
   */
  autoFit(n, maxW, maxH) {
    let best = null;
    const target = maxW / Math.max(1, maxH);
    for (let cols = 1; cols <= Math.min(4, Math.max(1, n)); cols++) {
      const rows = Math.ceil(n / cols);
      const W = cols * PANEL_W + (cols + 1) * GAP;
      const H = rows * this.panelH + (rows + 1) * GAP;
      const s = Math.max(1, Math.floor(Math.min(maxW / W, maxH / H)));
      const fit = Math.abs(Math.log((W / H) / target));
      if (!best || s > best.s || (s === best.s && fit < best.fit)) best = { cols, rows, s, fit };
    }
    if (best.cols !== this.cols || best.rows !== this.rows || this.count !== n) {
      this.layout(n, best.cols, best.rows);
    }
    return this.fit(maxW, maxH);
  }

  panelRect(i) {
    const col = i % this.cols, row = Math.floor(i / this.cols);
    return {
      x: GAP + col * (PANEL_W + GAP),
      y: GAP + row * (this.panelH + GAP),
      w: PANEL_W, h: this.panelH,
    };
  }

  /** Backing-pixel origin of a panel's 3x3 floor. */
  floorOrigin(rect) {
    return { x: rect.x + GUTTER, y: rect.y + HEADER + GUTTER };
  }

  shake(amount) { this.shakeAmt = Math.min(6, this.shakeAmt + amount); }

  burst(x, y, color, n = 6, spd = 26, life = 0.45) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spd * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g: 26, life: life * (0.6 + Math.random() * 0.7), max: life, color,
      });
    }
  }

  float(x, y, text, color) {
    this.floats.push({ x, y, text, color, life: 1.1, max: 1.1 });
  }

  update(dt) {
    this.t += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 22);
    this.shakeX = this.shakeAmt > 0.2 ? Math.round((Math.random() - 0.5) * this.shakeAmt * 2) : 0;
    this.shakeY = this.shakeAmt > 0.2 ? Math.round((Math.random() - 0.5) * this.shakeAmt * 2) : 0;

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
      f.y -= dt * 9;
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
  }

  /** Particles, floating text, then the additive light pass. */
  end() {
    const { ctx, lctx } = this;
    for (const p of this.parts) {
      const a = Math.min(1, p.life / p.max);
      ctx.globalAlpha = a > 0.45 ? 1 : 0.6;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      if (a > 0.5) glowPx(lctx, Math.round(p.x), Math.round(p.y), p.color, 1, 0.28);
    }
    ctx.globalAlpha = 1;

    ctx.font = '8px Silkscreen, monospace';
    ctx.textBaseline = 'top';
    for (const f of this.floats) {
      const a = Math.min(1, f.life / f.max);
      ctx.globalAlpha = a > 0.35 ? 1 : 0.45;
      ctx.fillStyle = INK;
      ctx.fillText(f.text, Math.round(f.x) + 1, Math.round(f.y) + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.light, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* ------------------------------------------------------------------- tools --- */

const R = Math.round;
function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(R(x), R(y), R(w), R(h));
}

/** Quantised glow: concentric squares, no gradients, so it stays pixel-honest. */
function glowPx(lctx, x, y, color, radius = 2, alpha = 0.5) {
  for (let r = radius; r >= 0; r--) {
    lctx.globalAlpha = alpha * (1 - r / (radius + 1.2));
    lctx.fillStyle = color;
    lctx.fillRect(x - r, y - r, 1 + r * 2, 1 + r * 2);
  }
  lctx.globalAlpha = 1;
}

function chevron(ctx, x, y, dir, color) {
  // A 3-pixel arrow head pointing in `dir`, drawn from the cell edge inward.
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const len = 3 - i;
    if (dir === 0) ctx.fillRect(R(x + i), R(y - len + 1), 1, len * 2 - 1);
    else if (dir === 2) ctx.fillRect(R(x - i), R(y - len + 1), 1, len * 2 - 1);
    else if (dir === 1) ctx.fillRect(R(x - len + 1), R(y + i), len * 2 - 1, 1);
    else ctx.fillRect(R(x - len + 1), R(y - i), len * 2 - 1, 1);
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
 * @param {object} meta { name, color, rank, earned, cash, income, active, ghost, selected, timer }
 */
export function drawPanel(st, view, rect, meta = {}) {
  const { ctx, lctx } = st;
  const col = meta.color || PLAYER_COLORS[0];
  const o = st.floorOrigin(rect);

  // plate
  px(ctx, rect.x, rect.y, rect.w, rect.h, PLATE);
  px(ctx, rect.x, rect.y, rect.w, 1, PLATE2);
  px(ctx, rect.x, rect.y, 1, rect.h, PLATE2);
  px(ctx, rect.x, rect.y + rect.h - 1, rect.w, 1, INK);
  px(ctx, rect.x + rect.w - 1, rect.y, 1, rect.h, INK);

  // header strip in the player's colour
  px(ctx, rect.x + 1, rect.y + 1, rect.w - 2, HEADER - 2, meta.ghost ? '#2a2f45' : col.dark);
  ctx.font = '8px Silkscreen, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = meta.ghost ? DIM : col.lit;
  ctx.fillText(String(meta.name || 'PLAYER').toUpperCase().slice(0, 8), rect.x + 3, rect.y + 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = meta.ghost ? DIM : '#ffe9a8';
  ctx.fillText('$' + (meta.earned ?? view.e ?? 0), rect.x + rect.w - 3, rect.y + 2);
  ctx.textAlign = 'left';

  // floor well
  px(ctx, o.x - 2, o.y - 2, GRID_PX + 4, GRID_PX + 4, '#0d0f1a');
  px(ctx, o.x - 1, o.y - 1, GRID_PX + 2, GRID_PX + 2, LINE);
  px(ctx, o.x, o.y, GRID_PX, GRID_PX, FLOOR);

  for (let i = 0; i < GRID * GRID; i++) {
    const gx = o.x + cx(i) * CELL, gy = o.y + cy(i) * CELL;
    px(ctx, gx, gy, CELL - 1, 1, '#20243a');
    px(ctx, gx, gy, 1, CELL - 1, '#20243a');
    if (!view.g[i]) {
      // empty slot: corner ticks so the grid reads as slots, not a blank sheet
      px(ctx, gx + 2, gy + 2, 2, 1, '#252b45');
      px(ctx, gx + 2, gy + 2, 1, 2, '#252b45');
      px(ctx, gx + CELL - 4, gy + CELL - 3, 2, 1, '#252b45');
      px(ctx, gx + CELL - 3, gy + CELL - 4, 1, 2, '#252b45');
    }
  }

  if (meta.selected != null && view.g) {
    const gx = o.x + cx(meta.selected) * CELL, gy = o.y + cy(meta.selected) * CELL;
    const blink = (st.t * 6) % 2 < 1;
    const c = blink ? col.lit : col.hex;
    px(ctx, gx - 1, gy - 1, CELL + 1, 1, c);
    px(ctx, gx - 1, gy + CELL - 1, CELL + 1, 1, c);
    px(ctx, gx - 1, gy - 1, 1, CELL + 1, c);
    px(ctx, gx + CELL - 1, gy - 1, 1, CELL + 2, c);
  }

  drawProducer(ctx, lctx, o, view, st.t);
  drawSeller(ctx, lctx, o, view, st.t);

  for (let i = 0; i < GRID * GRID; i++) {
    const m = view.g[i];
    if (!m) continue;
    drawMachine(ctx, lctx, o.x + cx(i) * CELL, o.y + cy(i) * CELL, m, st.t);
  }

  // gizmos: one pixel each, colour by type, glow by tier
  for (const g of view.z) {
    const ty = g[1];
    const gx = R(o.x + g[2] * CELL), gy = R(o.y + g[3] * CELL);
    if (gx < rect.x || gx > rect.x + rect.w || gy < rect.y || gy > rect.y + rect.h) continue;
    const t = TYPES[ty] || TYPES[0];
    px(ctx, gx, gy, 1, 1, t.color);
    if (ty >= 2) glowPx(lctx, gx, gy, t.glow, ty >= 5 ? 2 : 1, ty >= 5 ? 0.5 : 0.34);
    else glowPx(lctx, gx, gy, t.glow, 1, 0.18);
  }

  if (meta.note) {
    px(ctx, rect.x + 1, rect.y + rect.h - 9, rect.w - 2, 8, '#0d0f1a');
    ctx.textAlign = 'center';
    ctx.fillStyle = meta.noteColor || '#ffe9a8';
    ctx.fillText(String(meta.note).slice(0, 13), rect.x + rect.w / 2, rect.y + rect.h - 8);
    ctx.textAlign = 'left';
  }

  if (meta.ghost) {
    ctx.globalAlpha = 0.55;
    px(ctx, rect.x + 1, rect.y + HEADER, rect.w - 2, rect.h - HEADER - 1, '#0b0d16');
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = DIM;
    ctx.fillText('OFFLINE', rect.x + rect.w / 2, rect.y + rect.h / 2 - 4);
    ctx.textAlign = 'left';
  }
}

/* ---------------------------------------------------------------- machines --- */

function drawMachine(ctx, lctx, x, y, m, t) {
  const k = KINDS[m.k] || KINDS.pipe;
  const body = k.body, trim = k.trim, lit = k.lit;
  const flash = m.f || 0;

  // casing
  px(ctx, x + 1, y + 1, CELL - 2, CELL - 2, '#0c0e18');
  px(ctx, x + 2, y + 2, CELL - 4, CELL - 4, body);
  px(ctx, x + 2, y + 2, CELL - 4, 1, shade(body, 1.5));
  px(ctx, x + 2, y + CELL - 3, CELL - 4, 1, shade(body, 0.6));

  const cxp = x + CELL / 2, cyp = y + CELL / 2;

  switch (m.k) {
    case 'pipe': {
      const horiz = m.d % 2 === 0;
      if (horiz) px(ctx, x + 2, y + 5, CELL - 4, 6, '#0e1526');
      else px(ctx, x + 5, y + 2, 6, CELL - 4, '#0e1526');
      // scrolling tread marks
      const off = Math.floor(t * 22 * (m.l >= 2 ? 1.5 : 1)) % 4;
      for (let i = -1; i < 4; i++) {
        const p = i * 4 + off;
        if (horiz) {
          const sx = m.d === 0 ? x + 2 + p : x + CELL - 3 - p;
          if (sx > x + 2 && sx < x + CELL - 3) px(ctx, sx, y + 6, 1, 4, trim);
        } else {
          const sy = m.d === 1 ? y + 2 + p : y + CELL - 3 - p;
          if (sy > y + 2 && sy < y + CELL - 3) px(ctx, x + 6, sy, 4, 1, trim);
        }
      }
      break;
    }
    case 'dup': {
      px(ctx, x + 4, y + 4, 5, 5, shade(trim, 0.7));
      px(ctx, x + 7, y + 7, 5, 5, trim);
      px(ctx, x + 8, y + 8, 3, 3, lit);
      break;
    }
    case 'split': {
      px(ctx, x + 4, y + 7, 8, 2, trim);
      px(ctx, x + 9, y + 4, 2, 8, trim);
      px(ctx, x + 6, y + 6, 4, 4, lit);
      break;
    }
    case 'trident': {
      px(ctx, x + 4, y + 4, 2, 8, trim);
      px(ctx, x + 7, y + 4, 2, 8, trim);
      px(ctx, x + 10, y + 4, 2, 8, trim);
      px(ctx, x + 4, y + 7, 8, 2, lit);
      break;
    }
    case 'mut': {
      const core = (TYPES[m.m] || TYPES[1]);
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      px(ctx, x + 4, y + 4, 8, 8, '#0e1020');
      px(ctx, x + 5, y + 5, 6, 6, core.color);
      px(ctx, x + 6, y + 6, 4, 4, core.glow);
      if (pulse > 0.6) glowPx(lctx, R(cxp), R(cyp), core.glow, 2, 0.4 * pulse);
      break;
    }
    case 'fuse': {
      px(ctx, x + 3, y + 4, 10, 3, shade(trim, 0.6));
      px(ctx, x + 4, y + 8, 8, 4, '#150a08');
      const heat = 0.4 + 0.6 * Math.abs(Math.sin(t * 3));
      px(ctx, x + 5, y + 9, 6, 2, heat > 0.7 ? lit : trim);
      glowPx(lctx, R(cxp), R(cyp) + 2, lit, 2, 0.3 * heat);
      break;
    }
  }

  // held gizmos, sitting in the intake
  for (let i = 0; i < (m.b || []).length && i < 3; i++) {
    const ty = TYPES[m.b[i]] || TYPES[0];
    px(ctx, x + 4 + i * 3, y + CELL - 5, 1, 1, ty.color);
    glowPx(lctx, x + 4 + i * 3, y + CELL - 5, ty.glow, 1, 0.3);
  }

  // charge bar
  const w = Math.max(0, Math.min(1, m.p || 0)) * (CELL - 6);
  if (w > 0.5) px(ctx, x + 3, y + CELL - 3, w, 1, shade(lit, 0.9));

  // facing chevron, kept inside the casing so it never reads as the next machine's
  const [dx, dy] = DIRS[m.d];
  chevron(ctx, cxp + dx * 4, cyp + dy * 4, m.d, flash > 0.2 ? '#ffffff' : lit);

  // level pips
  for (let i = 1; i < (m.l || 1); i++) px(ctx, x + 3 + (i - 1) * 2, y + 3, 1, 1, '#ffe9a8');

  // A firing machine flashes, but never so hard that you cannot tell what it is.
  if (flash > 0.05) {
    ctx.globalAlpha = Math.min(0.3, flash * 0.3);
    px(ctx, x + 2, y + 2, CELL - 4, CELL - 4, '#ffffff');
    ctx.globalAlpha = 1;
    px(ctx, x + 1, y + 1, CELL - 2, 1, lit);
    px(ctx, x + 1, y + CELL - 2, CELL - 2, 1, lit);
    px(ctx, x + 1, y + 1, 1, CELL - 2, lit);
    px(ctx, x + CELL - 2, y + 1, 1, CELL - 2, lit);
    glowPx(lctx, R(cxp), R(cyp), lit, 2, 0.22 * flash);
  }
}

/* --------------------------------------------------------- producer/seller --- */

function drawProducer(ctx, lctx, o, view, t) {
  const cell = PRODUCER_PORT.cell;
  const x = o.x - GUTTER + 1, y = o.y + cy(cell) * CELL;
  const flash = view.pf || 0;
  px(ctx, x, y + 1, 10, CELL - 2, '#0c0e18');
  px(ctx, x + 1, y + 2, 8, CELL - 4, '#3a4257');
  px(ctx, x + 1, y + 2, 8, 1, '#5a6480');
  // hopper mouth + piston
  px(ctx, x + 2, y + 4, 6, 5, '#161a2a');
  const bob = Math.floor((t * 6) % 2);
  px(ctx, x + 3, y + 5 + bob, 4, 2, flash > 0.3 ? '#ffffff' : '#8b93a8');
  // nozzle into the floor
  px(ctx, x + 9, y + 6, 3, 4, '#5a6480');
  px(ctx, x + 10, y + 7, 2, 2, flash > 0.2 ? '#ffffff' : '#c3cbdb');
  if (flash > 0.05) glowPx(lctx, x + 11, y + 8, '#c3cbdb', 2, 0.5 * flash);
  for (let i = 1; i < (view.pl || 1); i++) px(ctx, x + 1 + (i - 1) * 2, y + CELL - 4, 1, 2, '#ffe9a8');
}

function drawSeller(ctx, lctx, o, view, t) {
  const cell = view.sc, dir = view.sd;
  const [dx, dy] = DIRS[dir];
  // sits in the gutter just outside the cell's face
  const bx = o.x + cx(cell) * CELL + dx * CELL;
  const by = o.y + cy(cell) * CELL + dy * CELL;
  const x = bx + (dx > 0 ? 1 : dx < 0 ? 4 : 1);
  const y = by + (dy > 0 ? 1 : dy < 0 ? 4 : 1);
  const w = dx !== 0 ? 8 : CELL - 2, h = dy !== 0 ? 8 : CELL - 2;
  const flash = view.sf || 0;

  px(ctx, x - 1, y - 1, w + 2, h + 2, '#0c0e18');
  px(ctx, x, y, w, h, flash > 0.3 ? '#6d5a1f' : '#4a3f1c');
  px(ctx, x, y, w, 1, '#8a7530');
  // vault mouth facing the floor
  const mx = dx > 0 ? x : dx < 0 ? x + w - 2 : x + 2;
  const my = dy > 0 ? y : dy < 0 ? y + h - 2 : y + 2;
  px(ctx, mx, my, dx !== 0 ? 2 : w - 4, dy !== 0 ? 2 : h - 4, '#1b1608');
  // coin
  const pulse = flash > 0.1 ? '#fff3b0' : '#ffcd75';
  px(ctx, x + Math.floor(w / 2) - 1, y + Math.floor(h / 2) - 1, 3, 3, pulse);
  px(ctx, x + Math.floor(w / 2), y + Math.floor(h / 2), 1, 1, '#8a7530');
  if (flash > 0.05) glowPx(lctx, x + Math.floor(w / 2), y + Math.floor(h / 2), '#ffcd75', 3, 0.55 * flash);
  else glowPx(lctx, x + Math.floor(w / 2), y + Math.floor(h / 2), '#ffcd75', 1, 0.18 + 0.1 * Math.sin(t * 3));

  for (let i = 1; i < (view.sl || 1); i++) px(ctx, x + 1 + (i - 1) * 2, y + h - 2, 1, 1, '#fff3b0');

  // arrow showing which way gizmos must leave
  chevron(ctx, bx + CELL / 2 - dx * 5, by + CELL / 2 - dy * 5, dir, '#ffcd75');
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
        st.burst(x, y, t.glow, Math.min(14, 4 + Math.round(e.v / 3)), 30, 0.5);
        st.burst(x, y, '#ffcd75', 4, 18, 0.6);
        st.float(x - 6, y - 8, '+' + e.v, '#ffe9a8');
        st.shake(Math.min(5, e.v / 9) * boost);
        break;
      }
      case 'lost': {
        const x = o.x + e.x * CELL, y = o.y + e.y * CELL;
        st.burst(x, y, '#5a6480', 3, 12, 0.35);
        break;
      }
      case 'clog': {
        const x = o.x + (cx(e.cell) + 0.5) * CELL, y = o.y + (cy(e.cell) + 0.5) * CELL;
        st.burst(x, y, '#ef7d57', 3, 14, 0.3);
        break;
      }
      case 'fire': {
        if (e.n > 2 || (e.ty || 0) >= 4) {
          const x = o.x + (cx(e.cell) + 0.5) * CELL, y = o.y + (cy(e.cell) + 0.5) * CELL;
          const t = TYPES[e.ty] || TYPES[0];
          st.burst(x, y, t.glow, 3, 16, 0.28);
        }
        break;
      }
      case 'up': case 'upprod': case 'upsell': {
        const cell = e.cell ?? 0;
        const x = o.x + (cx(cell) + 0.5) * CELL, y = o.y + (cy(cell) + 0.5) * CELL;
        st.burst(x, y, '#ffe9a8', 10, 26, 0.55);
        st.shake(2 * boost);
        break;
      }
      case 'scrap': {
        const x = o.x + (cx(e.cell ?? 0) + 0.5) * CELL, y = o.y + (cy(e.cell ?? 0) + 0.5) * CELL;
        st.burst(x, y, '#8b93a8', 8, 22, 0.4);
        st.float(x - 6, y - 6, '+$' + e.v, '#a7f070');
        break;
      }
    }
  }
}

/** Big centred banner text, drawn straight onto the backing canvas. */
export function banner(st, text, sub, color = '#ffe9a8') {
  const { ctx } = st;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '8px Silkscreen, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  const w = Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width : 0) + 12;
  const h = sub ? 24 : 14;
  const x = Math.round(st.W / 2 - w / 2), y = Math.round(st.H / 2 - h / 2);
  px(ctx, x - 1, y - 1, w + 2, h + 2, '#000000');
  px(ctx, x, y, w, h, '#1e2233');
  px(ctx, x, y, w, 1, color);
  px(ctx, x, y + h - 1, w, 1, color);
  ctx.fillStyle = color;
  ctx.fillText(text, st.W / 2, y + 3);
  if (sub) {
    ctx.fillStyle = DIM;
    ctx.fillText(sub, st.W / 2, y + 13);
  }
  ctx.textAlign = 'left';
}
