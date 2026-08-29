/**
 * screen.js — the host's main screen.
 *
 * The host device never plays. It runs the simulation, holds the room open and
 * puts the whole factory floor on one display: a tile per player, drawn from
 * the host's own live state at full frame rate, plus the round clock, the
 * standing orders and the running standings.
 */

import { createRenderer } from './render.js';
import { TIERS } from './machines.js';
import { SLOT_COUNT } from './game.js';

const $ = s => document.querySelector(s);
const money = n => '$' + Math.round(n).toLocaleString('en-US');

/** seat -> { el, canvas, renderer, name, cash, net, meter, count } */
const bays = new Map();

/* ------------------------------------------------------------------ bays --- */

/** Bring the tile grid in line with the current roster. */
export function syncBays(players) {
  const wrap = $('#bays');
  const live = new Set(players.map(p => p.seat));

  for (const [seat, b] of [...bays]) {
    if (live.has(seat)) continue;
    b.renderer?.destroy();
    b.el.remove();
    bays.delete(seat);
  }

  for (const p of players) {
    let b = bays.get(p.seat);
    if (!b) {
      const el = document.createElement('article');
      el.className = 'bay';
      el.innerHTML = `
        <header class="bay-head">
          <span class="seat-chip">P${p.seat + 1}</span>
          <span class="bay-name"></span>
          <span class="bay-cash"></span>
        </header>
        <div class="bay-stage"><canvas></canvas></div>
        <footer class="bay-foot">
          <span class="bay-meter"></span>
          <span class="bay-count"></span>
          <span class="bay-net"></span>
        </footer>`;
      wrap.appendChild(el);
      b = {
        el,
        canvas: el.querySelector('canvas'),
        renderer: null,
        name: el.querySelector('.bay-name'),
        cash: el.querySelector('.bay-cash'),
        net: el.querySelector('.bay-net'),
        meter: el.querySelector('.bay-meter'),
        count: el.querySelector('.bay-count'),
      };
      bays.set(p.seat, b);
    }
    b.name.textContent = p.name || `Player ${p.seat + 1}`;
    b.el.classList.toggle('offline', p.connected === false);
  }

  // Keep tiles in seat order however people arrived and left.
  [...bays.entries()].sort((a, b) => a[0] - b[0]).forEach(([, b]) => wrap.appendChild(b.el));
  wrap.dataset.count = String(bays.size);
}

/**
 * Canvases can only be measured once the screen is on, so this is called after
 * the switch to the main screen rather than at tile creation.
 */
export function resizeBays() {
  for (const b of bays.values()) {
    if (!b.renderer) b.renderer = createRenderer(b.canvas, { compact: true });
    else b.renderer.resize();
  }
}

/** views: [{ seat, view }] — one packed factory per player, host-side and live. */
export function drawBays(views) {
  for (const { seat, view } of views) {
    const b = bays.get(seat);
    if (!b || !b.renderer || !view) continue;
    b.renderer.draw(view, -1);
    b.cash.textContent = money(view.cash);
    b.net.textContent = money(view.net ?? view.cash);
    b.count.textContent = `EXP. ${view.shipped ?? 0}`;
    const [draw, supply, factor] = view.power;
    const short = factor < 1;
    b.meter.textContent = short ? `BROWNOUT ${Math.round(factor * 100)}%` : `PWR ${draw}/${supply}`;
    b.meter.classList.toggle('warn', short);
  }
}

/* ---------------------------------------------------------------- header --- */

export function renderClock(round, rounds, phase, tLeft) {
  $('#screen-round').textContent = phase === 'intermission'
    ? `RESTOCK · ROUND ${Math.min(round + 1, rounds)} NEXT`
    : `ROUND ${round} / ${rounds}`;
  const m = Math.floor(Math.max(0, tLeft) / 60);
  const s = Math.floor(Math.max(0, tLeft) % 60);
  const el = $('#screen-timer');
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('warn', phase === 'round' && tLeft <= 10);
}

/* ------------------------------------------------------- orders and board --- */

export function renderOrders(contracts, names) {
  const el = $('#screen-orders');
  if (!contracts) return;
  el.innerHTML = contracts.map(c => {
    const t = TIERS[c.tier];
    const done = c.filledBy !== null;
    const best = Math.max(0, ...Object.values(c.progress || {}));
    const pct = done ? 100 : Math.min(100, Math.round((best / c.count) * 100));
    return `
      <li class="s-order${done ? ' done' : ''}">
        <span class="dot" style="background:${t.color}"></span>
        <span class="s-order-title">${c.count} × ${t.name}</span>
        <span class="bar"><i style="width:${pct}%;background:${t.color}"></i></span>
        <span class="s-order-meta">${done ? esc(names[c.filledBy] || 'filled') : `${best}/${c.count}`}</span>
        <span class="s-order-reward">${money(c.reward)}</span>
      </li>`;
  }).join('');
}

export function renderStandings(board) {
  const el = $('#screen-board');
  const sorted = [...board].sort((a, b) => b.net - a.net);
  el.innerHTML = sorted.map((p, i) => `
    <li class="s-rank${p.connected === false ? ' offline' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="s-name">${esc(p.name)}</span>
      <span class="s-net">${money(p.net)}</span>
    </li>`).join('');
}

/** Ticker of what just happened, so the room can follow the swings. */
const feed = [];
export function pushFeed(text) {
  feed.unshift(text);
  feed.length = Math.min(feed.length, 4);
  const el = $('#screen-feed');
  if (el) el.innerHTML = feed.map((t, i) => `<span class="feed-line${i ? '' : ' fresh'}">${esc(t)}</span>`).join('');
}

export function clearFeed() {
  feed.length = 0;
  const el = $('#screen-feed');
  if (el) el.innerHTML = '';
}

export function renderLegend() {
  const el = $('#screen-legend');
  if (el) el.innerHTML = TIERS.map(t =>
    `<span class="leg"><i style="background:${t.color}"></i>${t.name} ${money(t.value)}</span>`).join('');
}

export const SLOTS = SLOT_COUNT;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
