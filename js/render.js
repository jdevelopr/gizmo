/**
 * render.js — draws a factory as a technical drawing that moves.
 *
 * Three parallel lanes run left to right: an intake hopper feeds the head of
 * each operational lane, a sell dock catches whatever falls off the end, and
 * routers throw gizmos diagonally into the neighbouring lane down a drawn
 * chute. Everything is 1–1.6px black stroke on paper; the only colour is the
 * gizmos themselves. Keep it that way — the colour is the whole read.
 *
 * Machines are drawn as working mechanisms: belts have treads that crawl at
 * line speed, converters stamp with a piston while they hold work, movers'
 * chevrons scroll, energizers pulse. All animation phase comes from one
 * clock, scaled by the factory's power factor, so a brownout is visible as
 * the whole floor slowing down.
 */

import { BY_ID, TIERS, stats, MAX_LEVEL } from './machines.js';
import { LANES, LANE_SLOTS, SLOT_COUNT, laneCost, laneOf, posOf } from './game.js';

/* All the drawing below runs against one set of "current surface" globals, so
 * a single body of code can serve any number of canvases: the player's own
 * factory on a phone, and every player's factory tiled on the host screen. */
let cv, ctx, dpr = 1;
let layout = [];        // one rect per slot index
let lanes = [];         // one rect per lane row
let smooth = new Map(); // gizmo id -> eased screen position, so 8 Hz state looks fluid
let compact = false;    // tile mode: less chrome, smaller type
let self = null;

/* One shared animation clock. Each factory advances its own phase by its own
 * power factor, so a browned-out line visibly crawls. */
let lastNow = performance.now();

const instances = [];
let resizeBound = false;

function bind(inst) {
  self = inst;
  cv = inst.cv; ctx = inst.ctx; dpr = inst.dpr;
  layout = inst.layout; lanes = inst.lanes; smooth = inst.smooth; compact = inst.compact;
}

function sync() {
  if (!self) return;
  self.dpr = dpr; self.layout = layout; self.lanes = lanes; self.smooth = smooth;
}

/** A drawing surface of its own. `compact` trims the chrome for small tiles. */
export function createRenderer(canvas, { compact: c = false } = {}) {
  const inst = {
    cv: canvas, ctx: canvas.getContext('2d'), dpr: 1,
    layout: [], lanes: [], smooth: new Map(), compact: !!c, phase: 0,
  };
  const api = {
    draw(view, selected = -1) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      inst.phase += dt * (view?.power?.[2] ?? 1);
      bind(inst); drawInto(view, selected, inst.phase); sync();
    },
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
  const w = Math.max(compact ? 150 : 320, box.width);
  const h = Math.max(compact ? 110 : 240, box.height);
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  computeLayout(w, h);
}

function computeLayout(w, h) {
  // Margins leave room for the intake hopper (left) and sell dock (right).
  const padL = compact ? 16 : 40, padR = compact ? 14 : 36;
  const padY = compact ? 8 : 16;
  const gapX = compact ? 4 : 8, gapY = compact ? 8 : 16;
  const foot = compact ? 5 : 24;   // room for the title block
  const cellW = (w - padL - padR - gapX * (LANE_SLOTS - 1)) / LANE_SLOTS;
  const cellH = (h - padY * 2 - gapY * (LANES - 1) - foot) / LANES;
  layout = [];
  lanes = [];
  for (let lane = 0; lane < LANES; lane++) {
    const y = padY + lane * (cellH + gapY);
    lanes.push({ x: padL, y, w: w - padL - padR, h: cellH, lane });
    for (let pos = 0; pos < LANE_SLOTS; pos++) {
      layout.push({
        x: padL + pos * (cellW + gapX),
        y, w: cellW, h: cellH, lane, pos,
      });
    }
  }
}

/** Belt height inside a slot. */
const BELT = 0.62;

/** Screen point for a gizmo at `prog` through slot `i`, `q` deep in the queue. */
function gizmoPos(i, prog, q = 0) {
  const r = layout[i];
  if (!r) return null;
  const x = r.x + prog * r.w - q * 10;
  return { x: Math.max(r.x - 6, x), y: r.y + r.h * BELT };
}

/* ------------------------------------------------------------------ draw --- */

function drawInto(view, selected, phase) {
  if (!ctx || !view) return;
  const w = cv.width / dpr, h = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#171412';
  ctx.fillStyle = '#171412';

  // Occupancy per slot, so machines only animate while they hold work.
  const busy = new Array(SLOT_COUNT).fill(0);
  for (const g of view.gizmos) busy[g[1]] = (busy[g[1]] || 0) + 1;

  const beltSpeed = (1 + (view.bonus?.[0] || 0)) * 26; // px/s of tread crawl
  for (let lane = 0; lane < LANES; lane++) drawLane(view, lane, phase, beltSpeed);
  for (let i = 0; i < SLOT_COUNT; i++) drawSlot(view, i, i === selected, phase, busy[i]);
  if (!compact) drawTitleBlock(view, w, h);
  drawGizmos(view);
}

function drawLane(view, lane, phase, beltSpeed) {
  const L = lanes[lane];
  if (!L) return;
  const open = lane < view.lanes;
  const y = L.y + L.h * BELT;

  ctx.save();
  ctx.lineWidth = 1;

  if (!open) { ctx.restore(); return; } // locked lanes draw only their hatch, per slot

  // Belt rails.
  line(L.x - 8, y - 4, L.x + L.w + 8, y - 4);
  line(L.x - 8, y + 4, L.x + L.w + 8, y + 4);
  // Treads crawl with line speed — the belt is visibly a belt.
  const spacing = 16;
  const off = ((phase * beltSpeed) % spacing + spacing) % spacing;
  ctx.globalAlpha = 0.55;
  for (let x = L.x - 8 + off; x < L.x + L.w + 8; x += spacing) line(x, y - 4, x - 5, y + 4);
  ctx.globalAlpha = 1;

  // Intake hopper feeding the head of the lane.
  const hx = L.x - (compact ? 10 : 24), hw = compact ? 10 : 18;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hx - hw / 2, y - (compact ? 14 : 22));
  ctx.lineTo(hx + hw / 2, y - (compact ? 14 : 22));
  ctx.lineTo(hx + 3, y - 7);
  ctx.lineTo(hx - 3, y - 7);
  ctx.closePath();
  ctx.stroke();
  line(hx, y - 7, hx, y - 4);

  // Sell dock: a chamfered chute off the end of the lane.
  const dx = L.x + L.w + 8;
  ctx.beginPath();
  ctx.moveTo(dx, y - 8);
  ctx.lineTo(dx + (compact ? 6 : 12), y - 2);
  ctx.lineTo(dx + (compact ? 6 : 12), y + 8);
  ctx.stroke();
  if (!compact) label('$', dx + 10, y + 20, 9);

  ctx.restore();
}

function drawSlot(view, i, isSelected, phase, occupants) {
  const r = layout[i];
  if (!r) return;
  const lane = laneOf(i);
  const locked = lane >= view.lanes;
  const entry = view.slots[i];

  ctx.save();
  ctx.lineWidth = isSelected ? 2.2 : 1.4;
  roundRect(r.x, r.y, r.w, r.h, 7);
  ctx.stroke();

  if (locked) {
    hatch(r.x, r.y, r.w, r.h);
    if (posOf(i) === 2) {
      const isNext = lane === view.lanes;
      ctx.lineWidth = 1;
      label(isNext ? `OPEN LANE ${lane + 1}` : `LANE ${lane + 1} — LOCKED`, r.x + r.w / 2, r.y + r.h * 0.35, 9);
      if (isNext) label(`$${laneCost(lane)}`, r.x + r.w / 2, r.y + r.h * 0.35 + 14, 10);
    }
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
    if (!compact) label('A REMPLACER', r.x + r.w / 2, r.y + r.h * 0.4, 8);
    ctx.restore();
    return;
  }

  const m = BY_ID[entry[0]];
  const level = entry[1];
  const dir = entry[2] || 0;
  glyph(m, r, level, dir, phase, occupants > 0, view);
  ctx.lineWidth = 1;
  label(m.code, r.x + r.w / 2, r.y + r.h - 6, 9);
  levelPips(r, level);
  ctx.restore();
}

/** Each kind gets its own working mechanism, so the line reads at a glance. */
function glyph(m, r, level, dir, phase, working, view) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.32;
  ctx.save();
  ctx.lineWidth = 1.2;

  switch (m.kind) {
    case 'converter': { // press: a piston that stamps the belt while it holds work
      const w = Math.min(r.w * 0.4, 32), beltY = r.y + r.h * BELT;
      // frame
      line(cx - w / 2, cy - 10, cx - w / 2, beltY - 8);
      line(cx + w / 2, cy - 10, cx + w / 2, beltY - 8);
      line(cx - w / 2, cy - 10, cx + w / 2, cy - 10);
      // piston: sinusoidal stamp when working, parked high when idle
      const stroke = working ? (0.5 - 0.5 * Math.cos(phase * 5)) : 0;
      const py = cy - 4 + stroke * (beltY - 12 - cy);
      line(cx, cy - 10, cx, py);
      roundRect(cx - w * 0.32, py, w * 0.64, 6, 2);
      ctx.stroke();
      break;
    }
    case 'router': { // swing arm and a drawn chute into the neighbouring lane
      const targetLane = laneOf(layout.indexOf(r)) + dir;
      const open = targetLane >= 0 && targetLane < (view?.lanes ?? 1);
      const beltY = r.y + r.h * BELT;
      // pivot post
      circle(cx, cy, 3); ctx.fill();
      // arm swings between "ahead" and "sideways" while working
      const swing = working ? (0.5 - 0.5 * Math.cos(phase * 4)) : 0.7;
      const aim = dir >= 0 ? 1 : -1;
      const ang = swing * aim * Math.PI * 0.3;
      const ax = cx + Math.sin(ang) * 2 + 14 * Math.cos(ang * 0.3);
      const ay = cy + Math.sin(ang) * 12;
      ctx.lineWidth = 2;
      line(cx, cy, ax, ay);
      ctx.lineWidth = 1.2;
      // chute: dashed curve from this slot's belt to the adjacent lane's belt
      const tl = lanes[targetLane];
      if (tl) {
        const tx = Math.min(r.x + r.w + 14, tl.x + tl.w);
        const ty = tl.y + tl.h * BELT;
        ctx.save();
        ctx.setLineDash(open ? [] : [3, 4]);
        ctx.globalAlpha = open ? 0.8 : 0.35;
        ctx.beginPath();
        ctx.moveTo(cx + 6, beltY);
        ctx.bezierCurveTo(r.x + r.w, beltY, r.x + r.w, ty, tx, ty);
        ctx.stroke();
        // arrowhead
        line(tx, ty, tx - 5, ty - 3);
        line(tx, ty, tx - 5, ty + 3);
        ctx.restore();
      }
      break;
    }
    case 'mover': { // chevrons scrolling in the direction of travel
      const n = 4, sp = Math.min(r.w * 0.11, 11);
      const scroll = (phase * 18) % sp;
      ctx.globalAlpha = 0.9;
      for (let k = 0; k < n; k++) {
        const x = cx - (n - 1) * sp / 2 + ((k * sp + scroll) % (n * sp)) - sp / 2;
        ctx.beginPath();
        ctx.moveTo(x - 4, cy - 6);
        ctx.lineTo(x + 3, cy);
        ctx.lineTo(x - 4, cy + 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'energizer': { // stacked cell plates with a slow charge pulse
      const w = Math.min(r.w * 0.4, 32);
      const pulse = 0.6 + 0.4 * Math.sin(phase * 2);
      for (let k = 0; k < 4; k++) {
        const y = cy - 9 + k * 6;
        const len = k % 2 === 0 ? w : w * 0.55;
        ctx.globalAlpha = k === Math.floor((phase * 2) % 4) ? pulse : 1;
        line(cx - len / 2, y, cx + len / 2, y);
        ctx.globalAlpha = 1;
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
  for (const [gid, i, prog, tier, q] of view.gizmos) {
    const target = gizmoPos(i, prog, q);
    if (!target) continue;
    seen.add(gid);
    const prev = smooth.get(gid);
    // Ease toward the authoritative position so an 8 Hz feed still glides —
    // and so a routed gizmo visibly swings across into the next lane.
    const pos = prev
      ? { x: prev.x + (target.x - prev.x) * 0.3, y: prev.y + (target.y - prev.y) * 0.3 }
      : target;
    smooth.set(gid, pos);

    ctx.save();
    // ground contact shadow — the puck sits ON the belt
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 5, 5, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = TIERS[tier].color;
    circle(pos.x, pos.y, 5.5);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#171412';
    ctx.stroke();
    // a small keyline dot so the puck reads as rolling
    ctx.globalAlpha = 0.5;
    circle(pos.x + Math.cos(pos.x * 0.35) * 2.4, pos.y + Math.sin(pos.x * 0.35) * 2.4, 1);
    ctx.fill();
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
    `EXTRACTEUR BALISTIQUE  ·  ${(view.name || 'ATELIER').toUpperCase()}  ·  VOIES ${view.lanes}/${LANES}  ·  DESS. CR`,
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
