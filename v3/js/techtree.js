/**
 * techtree.js — the research tree as its own page.
 *
 * A full-screen overlay over the running game. Each branch is a column, roots at
 * the top and deeper research below, with lines drawn from every node to what it
 * leads to. Drag the background to move it, zoom with the buttons or + and -, and
 * click a node for a card beside it saying what it does at every rank, what it
 * needs, what it unlocks and what the next rank costs. The view remembers where you
 * left it.
 *
 * Plain DOM and one SVG for the lines. It is rebuilt only when what it shows
 * changes — a rank researched, or science crossing a node's price — and the
 * science counter is the only thing touched every frame.
 */

import {
  TECH, BRANCHES, TYPES, techById, techOpen, rankOf, rankCost, TECH_RANKS, ROMAN, rankBlurb,
  label, money, num, genReach, genOutput, energyOf, fuelEnergy, yieldBonus, levelCap, upgradeCost,
  travelTime, contractPremium, drawOf, zapRange, zapCool, zapDamage, zapChain, maxHp, beaconLoss,
  bridgeSpan, tremorCost, cycleTime, unlockSpeed, GEN_REACH, GEN_OUTPUT, ZAP_RANGE, ZAP_COOL,
  ZAP_DAMAGE, BEACON_LOSS, TREMOR_COST, MAX_HP,
} from './machines.js';
import { icon } from './ui.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const NODE_W = 176, NODE_H = 78, GAP_X = 22, GAP_Y = 64, COL_GAP = 80, HEAD = 70;
const VIEW_KEY = 'gizmo3.tree.v1';
const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.45];

const pct = x => `${Math.round(x * 100)}%`;
const specOf = u => (u.startsWith('asm:') ? { kind: 'asm', mut: +u.slice(4) } : { kind: u });

/**
 * What a node does, in total, at a given rank — worked out from the very functions
 * the game uses, so the card can never disagree with the factory.
 */
export function techEffect(t, rank) {
  if (rank <= 0) return 'Not researched';
  const d = Array(rank).fill(t.id);
  const z = { kind: 'zap', level: 1 };
  const parts = [];
  if (t.unlocks?.length) {
    parts.push('Unlocks ' + t.unlocks.map(u => label(specOf(u))).join(' and '));
    if (rank > 1) parts.push(`which work ${Math.round((unlockSpeed(specOf(t.unlocks[0]).kind, d, specOf(t.unlocks[0]).mut) - 1) * 100)}% faster`);
  }
  if (t.power === 'reach') parts.push(`Generators reach +${genReach({ level: 1 }, d) - GEN_REACH[0]} machines`);
  if (t.power === 'fuel') parts.push(`Fuel burns ${pct(energyOf(0, d) / fuelEnergy(0) - 1)} longer`);
  if (t.power === 'output') parts.push(`Generators make ${pct(genOutput({ level: 1 }, d) / GEN_OUTPUT[0] - 1)} more power`);
  if (t.yield) parts.push(`Extractors pull ${pct(yieldBonus(d) - 1)} more`);
  if (t.level) {
    parts.push(`Upgrade ceiling: level ${levelCap(d)}`);
    const disc = 1 - upgradeCost({ kind: 'pipe', level: 1 }, d) / upgradeCost({ kind: 'pipe', level: 1 });
    if (rank > 3) parts.push(`upgrades ${pct(Math.round(disc * 100) / 100)} cheaper`);
  }
  if (t.belt) parts.push(`Belts move ${pct(travelTime({ kind: 'pipe', level: 1 }) / travelTime({ kind: 'pipe', level: 1 }, d) - 1)} faster`);
  if (t.market) parts.push(`Contracts pay ${pct(contractPremium(d) - 1)} over market`);
  if (t.motor) parts.push(`Machines draw ${pct(1 - drawOf({ kind: 'ext', level: 1 }, d) / drawOf({ kind: 'ext', level: 1 }))} less power`);
  if (t.focus) parts.push(`Zappers reach +${+(zapRange(z, d) - ZAP_RANGE[0]).toFixed(2)} slots`);
  if (t.cap) parts.push(`Zappers recharge ${pct(ZAP_COOL[0] / zapCool(z, d) - 1)} faster`);
  if (t.arc) parts.push(`Every zap arcs to ${zapChain(d)} more`);
  if (t.hp) parts.push(`Machines take ${pct(maxHp({ kind: 'pipe' }, d) / MAX_HP.pipe - 1)} more chewing`);
  if (t.over) parts.push(`Zaps do ${pct(zapDamage(z, d) / ZAP_DAMAGE[0] - 1)} more damage`);
  if (t.shield) parts.push(`The Beacon loses a gizmo every ${+beaconLoss(d).toFixed(1)} damage (was ${BEACON_LOSS})`);
  if (t.survey) {
    parts.push('Mountain seams are revealed');
    if (rank > 1) parts.push(`Drills dig ${Math.round((unlockSpeed('drill', d) - 1) * 100)}% faster`);
  }
  if (t.span) parts.push(`Bridges pair up to ${bridgeSpan(d) - 1} slots apart`);
  if (t.drill) {
    const m = { kind: 'drill', level: 1, mut: 4 };
    parts.push(`Drills dig ${pct(cycleTime(m) / cycleTime(m, d) - 1)} faster`);
  }
  if (t.damper) parts.push(`A Beetle every ${Math.round(tremorCost(d))} drill-seconds (was ${TREMOR_COST})`);
  return parts.join(' · ') || t.blurb;
}

export class TechTree {
  constructor(act) {
    this.act = act;
    this.box = $('techtree');
    this.view = $('tt-view');
    this.stage = $('tt-stage');
    this.svg = $('tt-lines');
    this.pop = $('tt-pop');
    this.sci = $('tt-sci');
    this.key = '';
    this.sel = null;
    this.layout = this.lay();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch (e) { /* none */ }
    this.cam = saved && Number.isFinite(saved.x) ? saved : null;
    this.bind();
  }

  get open() { return !this.box.hidden; }

  /* --------------------------------------------------------------- layout --- */

  /**
   * Where every node goes. Each branch is a column; a node's row is the length of
   * the longest chain of prerequisites above it; within a row, nodes are ordered by
   * where their parents sit, so lines cross as little as they can.
   */
  lay() {
    const pos = new Map();
    let x0 = 0;
    const cols = [];
    for (const br of BRANCHES) {
      const list = TECH.filter(t => t.branch === br.id);
      const depth = new Map();
      const dOf = t => {
        if (depth.has(t.id)) return depth.get(t.id);
        const d = (t.needs || []).length ? 1 + Math.max(...t.needs.map(n => dOf(techById(n)))) : 0;
        depth.set(t.id, d);
        return d;
      };
      list.forEach(dOf);
      const rows = [];
      for (const t of list) (rows[depth.get(t.id)] ||= []).push(t);
      const width = Math.max(...rows.map(r => r.length));
      const colW = width * NODE_W + (width - 1) * GAP_X;
      const order = new Map();
      rows.forEach((row, d) => {
        if (d > 0) {
          row.sort((a, b) => {
            const m = t => t.needs.reduce((s, n) => s + (order.get(n) ?? 0), 0) / t.needs.length;
            return m(a) - m(b);
          });
        }
        const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
        row.forEach((t, k) => {
          const x = x0 + (colW - rowW) / 2 + k * (NODE_W + GAP_X);
          const y = HEAD + d * (NODE_H + GAP_Y);
          pos.set(t.id, { x, y });
          order.set(t.id, x);
        });
      });
      cols.push({ br, x: x0, w: colW, rows: rows.length });
      x0 += colW + COL_GAP;
    }
    const h = HEAD + Math.max(...cols.map(c => c.rows)) * (NODE_H + GAP_Y);
    return { pos, cols, w: x0 - COL_GAP, h };
  }

  /* ----------------------------------------------------------------- input --- */

  bind() {
    $('tt-close').onclick = () => this.close();
    $('tt-in').onclick = () => this.zoom(1);
    $('tt-out').onclick = () => this.zoom(-1);
    $('tt-fit').onclick = () => this.fit();
    // Drag the background to move the tree. A press on a node is a click instead.
    this.view.addEventListener('pointerdown', e => {
      if (e.target.closest('.tt-node') || e.target.closest('#tt-pop')) return;
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      this.view.setPointerCapture(e.pointerId);
      this.view.classList.add('grab');
    });
    this.view.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      this.cam.x = this.drag.cx + dx;
      this.cam.y = this.drag.cy + dy;
      this.apply();
    });
    const end = () => {
      if (!this.drag) return;
      // A click on empty space puts the card away.
      if (!this.drag.moved) this.select(null);
      this.drag = null;
      this.view.classList.remove('grab');
      this.save();
    };
    this.view.addEventListener('pointerup', end);
    this.view.addEventListener('pointercancel', end);
    this.view.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', e => {
      if (!this.open) return;
      const k = e.key;
      if (k === '+' || k === '=') { this.zoom(1); e.preventDefault(); }
      else if (k === '-' || k === '_') { this.zoom(-1); e.preventDefault(); }
      else if (k === '0') { this.fit(); e.preventDefault(); }
      else if (k === 'Escape') { if (this.sel) this.select(null); else this.close(); e.preventDefault(); }
      else if (k === 'y' || k === 'Y') { this.close(); e.preventDefault(); }
      else return;
      e.stopImmediatePropagation();
    }, true);
  }

  zoom(step) {
    const i = ZOOMS.indexOf(this.cam.z);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + step))];
    // Keep the middle of the screen where it is.
    const r = this.view.getBoundingClientRect();
    const mx = r.width / 2, my = r.height / 2;
    this.cam.x = mx - (mx - this.cam.x) * next / this.cam.z;
    this.cam.y = my - (my - this.cam.y) * next / this.cam.z;
    this.cam.z = next;
    this.apply();
    this.save();
  }

  /** Zoom and centre so the whole tree is on screen. */
  fit() {
    const r = this.view.getBoundingClientRect();
    const L = this.layout;
    const want = Math.min((r.width - 40) / L.w, (r.height - 40) / L.h);
    this.cam.z = ZOOMS.reduce((a, b) => (b <= want ? b : a), ZOOMS[0]);
    this.cam.x = (r.width - L.w * this.cam.z) / 2;
    this.cam.y = Math.max(20, (r.height - L.h * this.cam.z) / 2);
    this.apply();
    this.save();
  }

  apply() {
    this.stage.style.transform = `translate(${Math.round(this.cam.x)}px, ${Math.round(this.cam.y)}px) scale(${this.cam.z})`;
    this.placePop();
  }

  /**
   * The card is drawn at full size whatever the zoom — it is for reading — so it
   * lives outside the scaled tree and is moved to sit beside its node whenever the
   * tree moves.
   */
  placePop() {
    if (!this.sel || this.pop.hidden) return;
    const p = this.layout.pos.get(this.sel);
    if (!p) return;
    const z = this.cam.z;
    const r = this.view.getBoundingClientRect();
    const w = this.pop.offsetWidth || 300, h = this.pop.offsetHeight || 260;
    let x = this.cam.x + (p.x + NODE_W) * z + 12;
    if (x + w > r.width - 8) x = this.cam.x + p.x * z - w - 12;   // no room: the other side
    let y = this.cam.y + p.y * z - 8;
    y = Math.max(8, Math.min(r.height - h - 8, y));
    this.pop.style.left = Math.round(x) + 'px';
    this.pop.style.top = Math.round(y) + 'px';
  }

  save() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(this.cam)); } catch (e) { /* private window */ }
  }

  /* ----------------------------------------------------------------- open --- */

  show(g) {
    this.g = g;
    this.box.hidden = false;
    this.key = '';
    if (!this.cam) { this.cam = { x: 0, y: 0, z: 1 }; requestAnimationFrame(() => this.fit()); }
    this.apply();
    this.update(g);
  }

  close() {
    this.box.hidden = true;
    this.select(null);
  }

  select(id) {
    this.sel = id;
    this.key = '';
    if (this.g) this.update(this.g);
  }

  /* ---------------------------------------------------------------- render --- */

  /** Called every frame while open. Cheap unless something has changed. */
  update(g) {
    this.g = g;
    const f = g.f;
    const s = `${num(f.science)} science  ·  +${num(g.sciRate, 1)}/s`;
    if (this.sci.textContent !== s) this.sci.textContent = s;
    // Rebuilt when ranks change, when science crosses a price, or the selection moves.
    const afford = TECH.map(t => (f.science >= rankCost(t, f.done) ? 1 : 0)).join('');
    const key = f.done.join(',') + '|' + afford + '|' + this.sel;
    if (key === this.key) return;
    this.key = key;
    this.render(f);
  }

  /** Every node's prerequisites, all the way up. */
  ancestors(id) {
    const out = new Set();
    const walk = n => { for (const p of techById(n)?.needs || []) if (!out.has(p)) { out.add(p); walk(p); } };
    if (id) walk(id);
    return out;
  }

  render(f) {
    const L = this.layout;
    this.stage.style.width = L.w + 'px';
    this.stage.style.height = L.h + 'px';
    for (const n of [...this.stage.querySelectorAll('.tt-node, .tt-col')]) n.remove();
    const path = this.ancestors(this.sel);

    // Column headings, with how many ranks of the branch are done.
    for (const c of L.cols) {
      const list = TECH.filter(t => t.branch === c.br.id);
      const got = list.reduce((a, t) => a + rankOf(f.done, t.id), 0);
      const head = el('div', 'tt-col', `<b>${c.br.name}</b><span>${got} / ${list.length * TECH_RANKS}</span>`);
      head.style.left = c.x + 'px';
      head.style.width = c.w + 'px';
      this.stage.appendChild(head);
    }

    // The lines: an elbow from the bottom of each prerequisite to the top of its child.
    const lines = [];
    for (const t of TECH) {
      const b = L.pos.get(t.id);
      for (const n of t.needs || []) {
        const a = L.pos.get(n);
        const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
        const ym = y1 + GAP_Y / 2;
        const lit = (this.sel === t.id || path.has(t.id)) && (path.has(n));
        const done = rankOf(f.done, n) > 0;
        lines.push(`<path d="M${x1} ${y1} V${ym} H${x2} V${y2}" class="${lit ? 'lit' : done ? 'done' : ''}"/>`);
      }
    }
    this.svg.setAttribute('width', L.w);
    this.svg.setAttribute('height', L.h);
    this.svg.innerHTML = lines.join('');

    for (const t of TECH) {
      const p = L.pos.get(t.id);
      const rank = rankOf(f.done, t.id);
      const maxed = rank >= TECH_RANKS;
      const open = techOpen(t, f.done);
      const cost = rankCost(t, f.done);
      const can = open && !maxed && f.science >= cost;
      const cls = ['tt-node', maxed ? 'max' : rank ? 'has' : '', can ? 'can' : open ? 'open' : 'locked',
        this.sel === t.id ? 'sel' : '', path.has(t.id) ? 'path' : ''].join(' ');
      const n = el('div', cls);
      n.style.left = p.x + 'px';
      n.style.top = p.y + 'px';
      n.style.width = NODE_W + 'px';
      n.style.height = NODE_H + 'px';
      const top = el('div', 'tt-top');
      top.appendChild(el('b', null, t.name + (rank ? ' ' + ROMAN[rank] : '')));
      if (t.unlocks?.length) {
        const ic = el('span', 'tt-ic');
        for (const u of t.unlocks.slice(0, 2)) ic.appendChild(icon(specOf(u), 18));
        top.appendChild(ic);
      }
      n.appendChild(top);
      const pips = el('div', 'rank-pips');
      for (let k = 1; k <= TECH_RANKS; k++) pips.appendChild(el('i', k <= rank ? 'on' : null));
      n.appendChild(pips);
      n.appendChild(el('div', 'tt-cost', maxed ? 'MAX' : open ? `${num(cost)} sci` : 'LOCKED'));
      n.onclick = e => { e.stopPropagation(); this.select(this.sel === t.id ? null : t.id); };
      this.stage.appendChild(n);
    }
    this.renderPop(f);
  }

  /**
   * The card beside a clicked node: everything there is to know about it, and the
   * button that researches its next rank.
   */
  renderPop(f) {
    const t = this.sel ? techById(this.sel) : null;
    if (!t) { this.pop.hidden = true; return; }
    const rank = rankOf(f.done, t.id);
    const maxed = rank >= TECH_RANKS;
    const cost = rankCost(t, f.done);
    const open = techOpen(t, f.done);
    this.pop.textContent = '';
    this.pop.hidden = false;

    const h = el('div', 'tt-pop-head');
    h.appendChild(el('b', null, t.name + (rank ? ' ' + ROMAN[rank] : '')));
    h.appendChild(el('span', null, BRANCHES.find(b => b.id === t.branch)?.name || ''));
    this.pop.appendChild(h);
    const pips = el('div', 'rank-pips');
    for (let k = 1; k <= TECH_RANKS; k++) pips.appendChild(el('i', k <= rank ? 'on' : null));
    this.pop.appendChild(pips);
    this.pop.appendChild(el('p', null, t.blurb));

    const rows = el('div', 'rows');
    const row = (k, v, c = '') => {
      const r = el('div', 'row' + (c ? ' ' + c : ''));
      r.appendChild(el('span', null, k));
      r.appendChild(el('b', null, v));
      rows.appendChild(r);
    };
    row('Now', rank ? techEffect(t, rank) : 'not researched', rank ? 'good' : '');
    if (!maxed) row(`At rank ${ROMAN[rank + 1]}`, techEffect(t, rank + 1), 'warn');
    if (t.needs?.length) {
      row('Needs', t.needs.map(n => (rankOf(f.done, n) ? '✓ ' : '✗ ') + techById(n).name).join(', '),
        open ? 'good' : 'bad');
    }
    const leads = TECH.filter(x => (x.needs || []).includes(t.id));
    if (leads.length) row('Leads to', leads.map(x => x.name).join(', '));
    this.pop.appendChild(rows);
    this.pop.appendChild(el('p', 'rank-note', rankBlurb(t)));

    if (t.unlocks?.length) {
      const u = el('div', 'tt-unlocks');
      for (const s of t.unlocks) {
        const spec = specOf(s);
        const box = el('div');
        box.appendChild(icon(spec, 24));
        box.appendChild(el('span', null, label(spec)));
        u.appendChild(box);
      }
      this.pop.appendChild(u);
    }

    const b = el('button', 'big', maxed ? 'FULLY RESEARCHED'
      : !open ? 'NEEDS EARLIER RESEARCH'
        : f.science >= cost ? `RESEARCH ${ROMAN[rank + 1]}  ·  ${num(cost)}`
          : `${num(cost - f.science)} MORE SCIENCE`);
    b.disabled = maxed || !open || f.science < cost;
    b.onclick = e => { e.stopPropagation(); this.act('research', t.id); this.key = ''; this.update(this.g); };
    this.pop.appendChild(b);

    this.placePop();
  }
}

