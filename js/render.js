/**
 * render.js — draws a factory as a technical drawing.
 *
 * Everything is 1–1.6px black stroke on paper. The only colour anywhere on the
 * canvas is the gizmos themselves: filled circles rolling left to right through
 * the machinery. Keep it that way — the colour is the whole read of the piece.
 */

import { BY_ID, TIERS, stats, MAX_LEVEL } from './machines.js';
import { SLOT_COUNT, unlockCost } from './game.js';

const COLS = 4;
const ROWS = 3;

/* All the drawing below runs against one set of "current surface" globals, so
 * a single body of code can serve any number of canvases: the player's own
 * factory on a phone, and every player's factory tiled on the host screen. */
let cv, ctx, dpr = 1;
let layout = [];        // one rect per slot index, in serpentine order
let smooth = new Map(); // gizmo id -> eased screen position, so 8 Hz state looks fluid
let compact = false;    // tile mode: less chrome, smaller type
let self = null;

const instances = [];
let resizeBound = false;

function bind(inst) {
  self = inst;
  cv = inst.cv; ctx = inst.ctx; dpr = inst.dpr;
  layout = inst.layout; smooth = inst.smooth; compact = inst.compact;
}

function sync() {
  if (!self) return;
  self.dpr = dpr; self.layout = layout; self.smooth = smooth;
}

/** A drawing surface of its own. `compact` trims the chrome for small tiles. */
export function createRenderer(canvas, { compact: c = false } = {}) {
  const inst = {
    cv: canvas, ctx: canvas.getContext('2d'), dpr: 1,
    layout: [], smooth: new Map(), compact: !!c,
  };
  const api = {
    draw(view, selected = -1) { bind(inst); drawInto(view, selected); sync(); },
    resize() { bind(inst); resizeInto(); sync(); },
    slotAt(px, py) { bind(inst); const i = hitTest(px, py); sync(); return i; },
    destroy() { const k = instances.indexOf(api); if (k >= 0) instances.splice(k, 1); },
  };
  instances.push(api);
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', () => instances.forEach(r => r.resize()));
  }
  api.resize();
  return api;
}

/* The player's own factory keeps the original single-surface API. */
let main = null;
export function initRenderer(canvas) { return (main = createRenderer(canvas)); }
export function resize() { main?.resize(); }
export function draw(view, selected) { main?.draw(view, selected); }
export function slotAt(px, py) { return main ? main.slotAt(px, py) : -1; }

function resizeInto() {
  if (!cv) return;
  const box = cv.parentElement.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Tiles on the host screen are legitimately small; don't force a scrollbar.
  const w = Math.max(compact ? 150 : 320, box.width);
  const h = Math.max(compact ? 110 : 240, box.height);
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  computeLayout(w, h);
}

function computeLayout(w, h) {
  const padX = compact ? 10 : 26, padY = compact ? 8 : 18;
  const gapX = compact ? 7 : 16, gapY = compact ? 6 : 14;
  const foot = compact ? 5 : 26;   // room for the title block
  const cellW = (w - padX * 2 - gapX * (COLS - 1)) / COLS;
  const cellH = (h - padY * 2 - gapY * (ROWS - 1) - foot) / ROWS;
  layout = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const row = Math.floor(i / COLS);
    const posInRow = i % COLS;
    // Serpentine: odd rows run right to left, like the reference drawing.
    const col = row % 2 === 0 ? posInRow : COLS - 1 - posInRow;
    layout.push({
      x: padX + col * (cellW + gapX),
      y: padY + row * (cellH + gapY),
      w: cellW,
      h: cellH,
      row,
      rtl: row % 2 === 1,
    });
  }
}

/** Screen point for a gizmo at `prog` through slot `i`. */
function gizmoPos(i, prog) {
  const r = layout[i];
  if (!r) return null;
  const t = r.rtl ? 1 - prog : prog;
  return { x: r.x + t * r.w, y: r.y + r.h * 0.58 };
}

/* ------------------------------------------------------------------ draw --- */

function drawInto(view, selected) {
  if (!ctx || !view) return;
  const w = cv.width / dpr, h = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#171412';
  ctx.fillStyle = '#171412';

  drawBelt(view);
  for (let i = 0; i < SLOT_COUNT; i++) drawSlot(view, i, i === selected);
  if (!compact) drawTitleBlock(view, w, h);
  drawGizmos(view);
}

function drawBelt(view) {
  ctx.save();
  ctx.lineWidth = 1;
  for (let row = 0; row < ROWS; row++) {
    const first = layout[row * COLS];
    const last = layout[row * COLS + COLS - 1];
    if (!first || !last) continue;
    const y = first.y + first.h * 0.58;
    const xa = Math.min(first.x, last.x) - 10;
    const xb = Math.max(first.x + first.w, last.x + last.w) + 10;
    line(xa, y, xb, y);
    // Sleeper ticks along the run, the way a rail is drawn in section.
    for (let x = xa; x < xb; x += 22) line(x, y - 3, x, y + 3);
  }
  // Return bends joining one row to the next.
  ctx.lineWidth = 1.4;
  for (let row = 0; row < ROWS - 1; row++) {
    const a = layout[row * COLS + COLS - 1];
    const b = layout[(row + 1) * COLS];
    if (!a || !b) continue;
    const rightSide = row % 2 === 0;
    const x = rightSide ? a.x + a.w + 10 : a.x - 10;
    const y1 = a.y + a.h * 0.58;
    const y2 = b.y + b.h * 0.58;
    const bulge = rightSide ? 14 : -14;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.bezierCurveTo(x + bulge, y1 + 8, x + bulge, y2 - 8, x, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSlot(view, i, isSelected) {
  const r = layout[i];
  if (!r) return;
  const locked = i >= view.unlocked;
  const entry = view.slots[i];

  ctx.save();
  ctx.lineWidth = isSelected ? 2.2 : 1.4;
  roundRect(r.x, r.y, r.w, r.h, 7);
  ctx.stroke();

  if (locked) {
    hatch(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1;
    // Sit these above the belt line, which runs at 0.58 of the slot height.
    label(i === view.unlocked ? 'EXTEND' : 'LOCKED', r.x + r.w / 2, r.y + r.h * 0.3, 8);
    label(`+$${unlockCost(i)}`, r.x + r.w / 2, r.y + r.h * 0.3 + 13, 10);
    ctx.restore();
    return;
  }

  if (!compact) bolts(r);

  if (!entry) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    roundRect(r.x + 9, r.y + 8, r.w - 18, r.h - 26, 4);
    ctx.stroke();
    ctx.restore();
    if (!compact) label('A REMPLACER', r.x + r.w / 2, r.y + r.h * 0.42, 8);
    ctx.restore();
    return;
  }

  const m = BY_ID[entry[0]];
  const level = entry[1];
  glyph(m, r, level);
  ctx.lineWidth = 1;
  label(m.code, r.x + r.w / 2, r.y + r.h - 6, 9);
  levelPips(r, level);
  ctx.restore();
}

/** Each kind gets its own schematic face, so the line reads at a glance. */
function glyph(m, r, level) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.35;
  ctx.save();
  ctx.lineWidth = 1.2;

  switch (m.kind) {
    case 'creator': { // funnel over an outlet
      const w = Math.min(r.w * 0.42, 34), h = Math.min(r.h * 0.3, 20);
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy - h / 2);
      ctx.lineTo(cx + w / 2, cy - h / 2);
      ctx.lineTo(cx + 4, cy + h / 2);
      ctx.lineTo(cx - 4, cy + h / 2);
      ctx.closePath();
      ctx.stroke();
      for (let k = -1; k <= 1; k++) line(cx + k * 7, cy - h / 2 - 5, cx + k * 7, cy - h / 2 - 1);
      break;
    }
    case 'converter': { // dial with a needle
      const rad = Math.min(r.w, r.h) * 0.16;
      circle(cx, cy, rad);
      ctx.stroke();
      circle(cx, cy, rad * 0.22);
      ctx.fill();
      const a = -Math.PI * 0.75 + (level / MAX_LEVEL) * Math.PI * 1.5;
      line(cx, cy, cx + Math.cos(a) * rad * 0.8, cy + Math.sin(a) * rad * 0.8);
      for (let k = 0; k < 8; k++) {
        const t = -Math.PI * 0.85 + k * (Math.PI * 1.7 / 7);
        line(cx + Math.cos(t) * rad * 1.15, cy + Math.sin(t) * rad * 1.15,
             cx + Math.cos(t) * rad * 1.32, cy + Math.sin(t) * rad * 1.32);
      }
      break;
    }
    case 'mover': { // chevrons in the direction of travel
      const n = 4, sp = Math.min(r.w * 0.11, 11);
      for (let k = 0; k < n; k++) {
        const x = cx - (n - 1) * sp / 2 + k * sp;
        ctx.beginPath();
        ctx.moveTo(x - 4, cy - 6);
        ctx.lineTo(x + 3, cy);
        ctx.lineTo(x - 4, cy + 6);
        ctx.stroke();
      }
      break;
    }
    case 'energizer': { // stacked cell plates
      const w = Math.min(r.w * 0.4, 32);
      for (let k = 0; k < 4; k++) {
        const y = cy - 9 + k * 6;
        const len = k % 2 === 0 ? w : w * 0.55;
        line(cx - len / 2, y, cx + len / 2, y);
      }
      line(cx, cy - 15, cx, cy - 11);
      break;
    }
    case 'keeper': { // silo with fill lines
      const w = Math.min(r.w * 0.34, 28), h = Math.min(r.h * 0.32, 22);
      roundRect(cx - w / 2, cy - h / 2, w, h, 3);
      ctx.stroke();
      for (let k = 1; k <= 2; k++) line(cx - w / 2 + 3, cy - h / 2 + (h * k) / 3, cx + w / 2 - 3, cy - h / 2 + (h * k) / 3);
      break;
    }
  }
  ctx.restore();
}

function levelPips(r, level) {
  const y = r.y + 7;
  for (let k = 0; k < MAX_LEVEL; k++) {
    const x = r.x + 17 + k * 6;
    circle(x, y, 2);
    k < level ? ctx.fill() : ctx.stroke();
  }
}

function bolts(r) {
  ctx.save();
  ctx.lineWidth = 1;
  for (const [dx, dy] of [[6, 6], [r.w - 6, 6], [6, r.h - 6], [r.w - 6, r.h - 6]]) {
    circle(r.x + dx, r.y + dy, 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGizmos(view) {
  const seen = new Set();
  for (const [i, prog, tier] of view.gizmos) {
    const target = gizmoPos(i, prog);
    if (!target) continue;
    const key = `${i}:${tier}:${Math.round(prog * 6)}`;
    seen.add(key);
    const prev = smooth.get(key);
    // Ease toward the authoritative position so a 8 Hz feed still glides.
    const pos = prev
      ? { x: prev.x + (target.x - prev.x) * 0.35, y: prev.y + (target.y - prev.y) * 0.35 }
      : target;
    smooth.set(key, pos);

    ctx.save();
    ctx.fillStyle = TIERS[tier].color;
    circle(pos.x, pos.y, 5.5);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#171412';
    ctx.stroke();
    ctx.restore();
  }
  for (const k of [...smooth.keys()]) if (!seen.has(k)) smooth.delete(k);
}

function drawTitleBlock(view, w, h) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.65;
  const y = h - 8;
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    `EXTRACTEUR BALISTIQUE  ·  ${(view.name || 'ATELIER').toUpperCase()}  ·  PL. ${view.unlocked}/${SLOT_COUNT}  ·  DESS. CR`,
    26, y
  );
  ctx.textAlign = 'right';
  ctx.fillText(`EXP. ${view.shipped ?? 0} PCS`, w - 26, y);
  ctx.restore();
}

/** Hit test for taps on the drawing. */
function hitTest(px, py) {
  for (let i = 0; i < layout.length; i++) {
    const r = layout[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return -1;
}

/* --------------------------------------------------------------- helpers --- */

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hatch(x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  roundRect(x, y, w, h, 7);
  ctx.clip();
  ctx.globalAlpha = 0.32;
  ctx.lineWidth = 1;
  for (let k = -h; k < w; k += 7) line(x + k, y + h, x + k + h, y);
  ctx.restore();
}

function label(text, x, y, size) {
  ctx.save();
  ctx.font = `${compact ? Math.max(6, size * 0.82) : size}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.8;
  ctx.fillText(text, x, y);
  ctx.restore();
}
