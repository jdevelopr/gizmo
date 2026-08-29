/**
 * ui.js — all DOM rendering that isn't the canvas.
 *
 * These functions take plain data and an `emit` callback for intents. They hold
 * no game state of their own, which keeps host and client using identical code
 * paths: the host emits into its own sim, the client emits onto the wire.
 */

import { MACHINES, BY_ID, KINDS, KIND_ORDER, TIERS, MAX_LEVEL, stats, describe, upgradeCost, sellRefund } from './machines.js';
import { SLOT_COUNT, unlockCost } from './game.js';
import { bindButton } from './input.js';

const $ = s => document.querySelector(s);
export const money = n => '$' + Math.round(n).toLocaleString('en-US');

let shopFilter = 'creator';
let shopSlot = null;   // slot the shop is buying into, or null for browse mode

/* ----------------------------------------------------------------- lobby --- */

export function renderRoster(players, mySeat) {
  const ul = $('#roster');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.className = 'roster-row' + (p.connected === false ? ' offline' : '');
    li.innerHTML = `
      <span class="seat-chip">P${p.seat + 1}</span>
      <span class="roster-name">${esc(p.name)}${p.seat === mySeat ? ' <em>(you)</em>' : ''}</span>
      <span class="roster-state">${p.connected === false ? 'reconnecting' : p.ready ? 'READY' : 'waiting'}</span>`;
    ul.appendChild(li);
  }
}

/* ------------------------------------------------------------------- HUD --- */

export function renderHud(view, round, rounds, phase, tLeft) {
  $('#hud-cash').textContent = money(view.cash);
  const [draw, supply, factor] = view.power;
  const short = factor < 1;
  $('#hud-power').textContent = `${draw} / ${supply}`;
  $('#hud-power').classList.toggle('warn', short);
  $('#hud-power-note').textContent = short ? `BROWNOUT — line at ${Math.round(factor * 100)}%` : 'POWER NOMINAL';
  $('#hud-power-note').classList.toggle('warn', short);

  const [speed, cap, value] = view.bonus;
  $('#hud-bonus').textContent = `SPD +${Math.round(speed * 100)}%  ·  BUF +${cap}  ·  VAL +${Math.round(value * 100)}%`;

  $('#hud-round').textContent = phase === 'intermission'
    ? `RESTOCK · ROUND ${Math.min(round + 1, rounds)} NEXT`
    : `ROUND ${round} / ${rounds}`;
  const m = Math.floor(Math.max(0, tLeft) / 60);
  const s = Math.floor(Math.max(0, tLeft) % 60);
  $('#hud-timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
  $('#hud-timer').classList.toggle('warn', phase === 'round' && tLeft <= 10);
}

/* ------------------------------------------------------------ slot panel --- */

export function openSlot(index, view, stock, emit) {
  const entry = view.slots[index];
  const panel = $('#slot-panel');

  if (index >= view.unlocked) {
    const isNext = index === view.unlocked;
    const price = unlockCost(index);
    panel.innerHTML = `
      <div class="panel-head"><h3>Slot ${index + 1}</h3><button class="x" data-close>Close</button></div>
      <p class="dim">${isNext
        ? 'This is the next section of line. Extend to keep building.'
        : `Locked. Extend slot ${view.unlocked + 1} first.`}</p>
      ${isNext ? `<button class="primary wide" data-unlock ${view.cash < price ? 'disabled' : ''}>Extend line — ${money(price)}</button>` : ''}`;
    wirePanel(panel, { emit });
    show(panel);
    return;
  }

  if (!entry) {
    shopSlot = index;
    closePanel();
    openShop(view, stock, emit, index);
    return;
  }

  const m = BY_ID[entry[0]];
  const level = entry[1];
  const maxed = level >= MAX_LEVEL;
  const up = upgradeCost(m, level);
  const refund = sellRefund(m, level);

  panel.innerHTML = `
    <div class="panel-head">
      <h3>${m.code} <span class="mname">${esc(m.name)}</span></h3>
      <button class="x" data-close>Close</button>
    </div>
    <p class="kindline">${KINDS[m.kind].label.replace(/s$/, '')} · Slot ${index + 1} · Level ${level}/${MAX_LEVEL}</p>
    <p class="statline">${describe(m, level)}</p>
    ${maxed ? '' : `<p class="statline next">Next: ${describe(m, level + 1)}</p>`}
    <p class="dim">Power draw ${stats(m, level).draw}</p>
    <div class="panel-actions">
      <button class="primary" data-upgrade ${maxed || view.cash < up ? 'disabled' : ''}>
        ${maxed ? 'Max level' : `Upgrade — ${money(up)}`}
      </button>
      <button class="ghost danger" data-sell>Sell — ${money(refund)}</button>
    </div>`;
  wirePanel(panel, { emit, index });
  show(panel);
}

function wirePanel(panel, { emit, index }) {
  panel.querySelectorAll('[data-close]').forEach(b => bindButton(b, closePanel));
  const u = panel.querySelector('[data-upgrade]');
  if (u) bindButton(u, () => { emit({ t: 'upgrade', slot: index }); closePanel(); });
  const s = panel.querySelector('[data-sell]');
  if (s) bindButton(s, () => { emit({ t: 'sell', slot: index }); closePanel(); });
  const x = panel.querySelector('[data-unlock]');
  if (x) bindButton(x, () => { emit({ t: 'unlock' }); closePanel(); });
}

export function closePanel() {
  hide($('#slot-panel'));
}

/* ------------------------------------------------------------------ shop --- */

export function openShop(view, stock, emit, slotIndex = null) {
  shopSlot = slotIndex;
  renderShop(view, stock, emit);
  show($('#shop'));
}

export function closeShop() {
  shopSlot = null;
  hide($('#shop'));
}

export function renderShop(view, stock, emit) {
  const el = $('#shop');
  if (el.hidden) return;

  const tabs = KIND_ORDER.map(k =>
    `<button class="tab${k === shopFilter ? ' on' : ''}" data-kind="${k}">${KINDS[k].label}</button>`
  ).join('');

  // Opened from the tab bar rather than a slot? Aim at the first free bay.
  const target = shopSlot !== null ? shopSlot : firstEmpty(view);

  const items = MACHINES.filter(m => m.kind === shopFilter).map(m => {
    const left = stock?.[m.id] ?? 0;
    const affordable = view.cash >= m.cost;
    const buyable = left > 0 && affordable && target !== null;
    const why = target === null ? 'No free slot' : left <= 0 ? 'Sold out' : !affordable ? 'Too dear' : money(m.cost);
    return `
      <li class="shop-row${left <= 0 ? ' sold-out' : ''}">
        <div class="shop-code">${m.code}</div>
        <div class="shop-body">
          <div class="shop-name">${esc(m.name)}</div>
          <div class="shop-desc">${describe(m, 1)}</div>
          <div class="shop-meta">Draw ${m.draw} · ${left} in stock</div>
        </div>
        <button class="buy" data-buy="${m.id}" ${buyable ? '' : 'disabled'}>${why}</button>
      </li>`;
  }).join('');

  el.innerHTML = `
    <div class="panel-head">
      <h3>Parts shop${target !== null ? ` <span class="mname">→ slot ${target + 1}</span>` : ''}</h3>
      <button class="x" data-close-shop>Close</button>
    </div>
    <p class="dim">${KINDS[shopFilter].blurb} ${target === null
      ? 'Every bay is full — sell something or extend the line.'
      : 'Tap a different slot on the drawing to aim elsewhere.'} Stock is shared, first come first served.</p>
    <div class="tabs">${tabs}</div>
    <ul class="shop-list">${items}</ul>`;

  el.querySelectorAll('.tab').forEach(b => bindButton(b, () => {
    shopFilter = b.dataset.kind;
    renderShop(view, stock, emit);
  }));
  el.querySelectorAll('[data-buy]').forEach(b => bindButton(b, () => {
    emit({ t: 'buy', slot: target, id: b.dataset.buy });
    closeShop();
  }));
  el.querySelectorAll('[data-close-shop]').forEach(b => bindButton(b, closeShop));
}

/* ------------------------------------------------------- orders and board --- */

export function renderContracts(contracts, mySeat, names) {
  const el = $('#orders-list');
  if (!contracts) return;
  el.innerHTML = contracts.map(c => {
    const t = TIERS[c.tier];
    const mine = c.progress?.[mySeat] || 0;
    const pct = Math.min(100, Math.round((mine / c.count) * 100));
    const done = c.filledBy !== null;
    return `
      <li class="order${done ? ' done' : ''}">
        <span class="dot" style="background:${t.color}"></span>
        <div class="order-body">
          <div class="order-title">${c.count} × ${t.name}</div>
          <div class="order-meta">${done
            ? `Filled by ${esc(names[c.filledBy] || 'someone')}`
            : `${mine}/${c.count} shipped`}</div>
          <div class="bar"><i style="width:${done ? 100 : pct}%;background:${t.color}"></i></div>
        </div>
        <div class="order-reward">${money(c.reward)}</div>
      </li>`;
  }).join('');
}

export function renderBoard(board, mySeat) {
  const el = $('#board-list');
  const sorted = [...board].sort((a, b) => b.net - a.net);
  el.innerHTML = sorted.map((p, i) => `
    <li class="board-row${p.seat === mySeat ? ' me' : ''}${p.connected === false ? ' offline' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="seat-chip">P${p.seat + 1}</span>
      <span class="board-name">${esc(p.name)}</span>
      <span class="board-net">${money(p.net)}</span>
    </li>`).join('');
}

export function renderResults(results) {
  $('#scores').innerHTML = results.map((p, i) => `
    <li>
      <span class="rank">${i + 1}</span>
      <span class="board-name">${esc(p.name)}</span>
      <span class="board-net">${money(p.net)}</span>
      <span class="dim small">${p.shipped} shipped · ${money(p.earned)} earned</span>
    </li>`).join('');
}

/* ---------------------------------------------------------------- toasts --- */

let toastTimer = null;
export function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
}

/** Gizmo tier legend — the only place colour is explained. */
export function renderLegend() {
  $('#legend').innerHTML = TIERS.map(t =>
    `<span class="leg"><i style="background:${t.color}"></i>${t.name} ${money(t.value)}</span>`
  ).join('');
}

/* --------------------------------------------------------------- helpers --- */

const show = el => (el.hidden = false);
const hide = el => (el.hidden = true);
export const shopTargetSlot = () => shopSlot;

/** First unlocked bay with nothing bolted into it, or null if the line is full. */
function firstEmpty(view) {
  for (let i = 0; i < view.unlocked; i++) if (!view.slots[i]) return i;
  return null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
