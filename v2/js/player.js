/**
 * player.js — the phone control panel.
 *
 * Renders the player's own floor with the same pixel renderer the host uses, and
 * turns taps into actions. Every action is a request: the host validates it and
 * the next state message is the only truth.
 */

import { Stage, drawPanel, playFx, PLAYER_COLORS } from './render.js';
import {
  KINDS, DIR_NAME, MAX_LEVEL, MAX_UTIL, GRID, setGridSize,
  upgradeCost, scrapValue, producerCost, sellerCost, label,
  cycleTime, claimed, describe, TYPES, ROUTE_KINDS,
} from './machines.js';

const $ = (s, r = document) => r.querySelector(s);
const buzz = ms => { try { navigator.vibrate?.(ms); } catch {} };

export function createController({ send }) {
  const canvas = $('#pad-stage');
  const stage = new Stage(canvas, { solo: true });
  stage.layout(1);

  let view = null, prev = null, tNext = 0, tPrev = 0;
  let hud = null, shop = null;
  let sel = null;              // 'g3' | 'i1' | null
  let lastPhase = '';
  let raf = 0, last = 0;

  /* ------------------------------------------------------------- sizing --- */

  function fit() {
    const wrap = $('#pad-stage-wrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    stage.fit(Math.max(80, r.width), Math.max(90, r.height));
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));

  /* ------------------------------------------------------------ pointer --- */

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!view) return;
    const r = canvas.getBoundingClientRect();
    const bx = (e.clientX - r.left) / (r.width / stage.W);
    const by = (e.clientY - r.top) / (r.height / stage.H);
    // Near-misses snap to the nearest slot; a real miss clears the selection.
    const i = stage.cellAt(bx, by);
    if (i < 0) {
      if (sel) { setSel(null); buzz(8); }
      return;
    }
    tapCell(i);
  }, { passive: false });

  function tapCell(i) {
    const ref = 'g' + i;
    const here = view.g[i];

    // Unbought land is not a slot yet. Tapping it points at the button that fixes
    // that rather than silently doing nothing.
    if (!claimed(i, view.cl || GRID)) {
      flashExpand();
      buzz(6);
      return;
    }

    if (!sel) {
      if (!here) return;
      setSel(ref);
      buzz(10);
    } else if (sel === ref) {
      setSel(null);
      buzz(8);
    } else {
      // Moved: drop the selection so the next tap starts fresh.
      send({ t: 'act', a: { a: 'move', from: sel, to: ref } });
      setSel(null);
      buzz(14);
    }
  }

  /* ------------------------------------------------------------- actions --- */

  function selMachine() {
    if (!sel || !view) return null;
    const i = parseInt(sel.slice(1), 10);
    return sel[0] === 'g' ? view.g[i] : view.v[i];
  }

  function act(a) { send({ t: 'act', a }); buzz(12); }

  const wire = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', e => { e.preventDefault(); fn(); });
  };

  wire('#btn-rot', () => {
    if (!sel) return;
    act(sel[0] === 'g' ? { a: 'rot', i: +sel.slice(1) } : { a: 'rotinv', i: +sel.slice(1) });
  });
  wire('#btn-filt', () => { if (sel) act({ a: 'filt', ref: sel }); });
  wire('#btn-up', () => { if (sel) act({ a: 'up', ref: sel }); });
  wire('#btn-scrap', () => {
    if (!sel) return;
    act({ a: 'scrap', ref: sel });
    setSel(null);
  });
  wire('#btn-stow', () => {
    if (!sel || sel[0] !== 'g') return;
    act({ a: 'move', from: sel, to: 'i' + (view.v?.length ?? 0) });
    setSel(null);
  });
  wire('#btn-mover', () => { send({ t: 'route', k: 'pipe' }); buzz(14); });
  wire('#btn-bal', () => { send({ t: 'route', k: 'bal' }); buzz(14); });
  wire('#btn-sort', () => { send({ t: 'route', k: 'sort' }); buzz(14); });
  wire('#btn-expand', () => { send({ t: 'expand' }); buzz(22); });
  wire('#btn-prod', () => act({ a: 'upprod' }));
  wire('#btn-sell', () => act({ a: 'upsell' }));

  /**
   * One button, whatever the round is currently asking for. Two separate READY
   * buttons for two phases that never overlap was two buttons' worth of screen for
   * one button's worth of meaning.
   */
  wire('#dock-action', () => {
    if (!hud) return;
    if (hud.ph === 'plan') {
      const next = !hud.ready;
      send({ t: 'plan', v: next });
      hud.ready = next;
      buzz(next ? 18 : 10);
      paintAction();
    } else if (hud.ph === 'shop') {
      send({ t: 'done' });
      buzz(16);
    }
  });

  /* ---------------------------------------------------------------- dock --- */

  const TABS = ['select', 'build', 'tech', 'crate'];
  let tab = 'select';
  let lastTab = 'build';        // where to go back to when a selection is dropped

  for (const b of document.querySelectorAll('#dock-tabs button')) {
    b.addEventListener('click', e => {
      e.preventDefault();
      setTab(b.dataset.tab, true);
      buzz(10);
    });
  }

  function setTab(next, manual = false) {
    if (!TABS.includes(next) || next === tab) return;
    if (manual && next !== 'select') lastTab = next;
    tab = next;
    paintDock();
  }

  /**
   * Selecting a machine snaps the dock to its controls and dropping the selection
   * snaps back to whatever you were doing before. The alternative — a permanent
   * selection strip — costs the same pixels whether or not anything is selected.
   */
  function setSel(next) {
    const had = !!sel;
    sel = next;
    if (sel && tab !== 'select') { tab = 'select'; }
    else if (!sel && had && tab === 'select') { tab = lastTab; }
    paintDock();
    paintAll();
  }

  function paintDock() {
    for (const b of document.querySelectorAll('#dock-tabs button')) {
      b.setAttribute('aria-pressed', b.dataset.tab === tab ? 'true' : 'false');
    }
    for (const name of TABS) {
      const el = $('#panel-' + name);
      if (el) el.hidden = name !== tab;
    }
    badges();
  }

  /** What is waiting on a tab you are not looking at. */
  function badges() {
    const t = id => $(`#dock-tabs button[data-tab="${id}"]`);
    const crate = t('crate'), tech = t('tech'), build = t('build');
    const n = view?.v?.length || 0;
    if (crate) { if (n) crate.dataset.badge = n; else delete crate.dataset.badge; }
    const affordable = (shop?.tech || []).filter(x => !x.done && x.open
      && (shop.science ?? 0) >= x.cost).length;
    if (tech) { if (affordable) tech.dataset.badge = affordable; else delete tech.dataset.badge; }
    if (build) {
      if (hud?.ph === 'shop') build.dataset.badge = '\u25cf';
      else delete build.dataset.badge;
    }
  }

  /* ----------------------------------------------------------- painting --- */

  function paintAll() {
    if (!view || !hud) return;
    paintBar();
    paintOrder();
    paintSelect();
    paintBuild();
    paintTech();
    paintCrate();
    paintAction();
    badges();
  }

  function paintBar() {
    const b = hud.board || [];
    const rank = b.findIndex(r => r.seat === hud.seat) + 1;
    const label = {
      plan: 'PLANNING', run: 'SHIPPING', tally: 'TALLY',
      shop: 'BUILD', over: 'FINISHED', lobby: 'LOBBY',
    }[hud.ph] || hud.ph;
    $('#bar-phase').textContent = hud.ph === 'over' ? 'MATCH OVER' : `R${hud.r}/${hud.rs} ${label}`;
    $('#bar-phase').dataset.ph = hud.ph;
    $('#bar-timer').textContent = hud.ph === 'over' ? '' : String(Math.max(0, Math.ceil(hud.tm)));
    $('#bar-cash').textContent = '$' + view.c;
    $('#bar-sci').textContent = (hud.science ?? view.sc ?? 0) + ' SCI';
    $('#bar-rank').textContent = rank ? `${rank}/${b.length}` : '-';
    const note = $('#pad-note');
    note.textContent = hud.note || '';
    note.hidden = !hud.note;
  }

  function paintOrder() {
    const ord = $('#pad-order');
    if (!ord) return;
    const tgt = hud.order?.target || 0;
    const got = view.n || 0;
    ord.hidden = hud.ph === 'lobby' || hud.ph === 'over' || !tgt;
    if (ord.hidden) return;
    ord.dataset.met = got >= tgt ? 'on' : 'off';
    $('#order-fill').style.width = Math.min(100, Math.round((got / tgt) * 100)) + '%';
    $('#order-text').textContent =
      `ORDER $${tgt} · SHIPPED $${got} · BONUS $${hud.order.bonus}`;
  }

  function paintAction() {
    const btn = $('#dock-action');
    if (!btn || !hud) return;
    if (hud.ph === 'plan') {
      btn.hidden = false;
      const others = Math.max(0, (hud.waiting ?? 0) - (hud.ready ? 0 : 1));
      btn.dataset.on = hud.ready ? 'on' : 'off';
      btn.textContent = hud.ready
        ? (others > 0 ? `READY — WAITING FOR ${others}` : 'READY')
        : 'READY — START THE ROUND';
    } else if (hud.ph === 'shop') {
      btn.hidden = false;
      btn.dataset.on = shop?.done ? 'on' : 'off';
      btn.textContent = shop?.done ? 'WAITING…' : 'DONE BUILDING';
      btn.disabled = !!shop?.done;
    } else {
      btn.hidden = true;
    }
  }

  function paintSelect() {
    const m = selMachine();
    const fb = $('#btn-filt');
    if (!m) {
      $('#sel-name').textContent = 'Nothing selected';
      $('#sel-sub').textContent =
        'Tap a machine on the board, then an owned slot to move it. Belts aim themselves.';
      for (const id of ['#btn-up', '#btn-scrap', '#btn-rot', '#btn-stow']) $(id).disabled = true;
      $('#btn-up').textContent = 'UPGRADE';
      $('#btn-scrap').textContent = 'SCRAP';
      fb.hidden = true;
      return;
    }
    const spec = { kind: m.k, mut: m.m };
    const fake = { kind: m.k, mut: m.m, level: m.l };
    const rate = m.r || (1 / (cycleTime(fake) || 1));
    const state = m.x ? ' · BACKED UP' : m.s ? ' · STARVED' : '';
    $('#sel-name').textContent = `${label(spec)} · Lv${m.l}`;
    $('#sel-sub').textContent =
      `${describe(spec)} Facing ${DIR_NAME[m.d]} · ${rate.toFixed(2)}/s${state}`;

    const upc = upgradeCost(fake);
    // The ceiling is a research question: without Overclocking, machines stop at 2.
    const cap = view.lc ?? MAX_LEVEL;
    const capped = m.l >= cap;
    $('#btn-up').disabled = capped || view.c < upc;
    $('#btn-up').textContent = capped
      ? (cap < MAX_LEVEL ? 'NEEDS OVERCLOCKING' : 'MAX')
      : `UPGRADE $${upc}`;
    $('#btn-scrap').disabled = false;
    $('#btn-scrap').textContent = `SCRAP +$${scrapValue(fake)}`;
    $('#btn-rot').disabled = false;
    $('#btn-stow').disabled = sel[0] !== 'g';

    fb.hidden = m.k !== 'sort';
    fb.disabled = m.k !== 'sort';
    if (m.k === 'sort') {
      const next = TYPES[((m.m ?? 1) + 1) % TYPES.length];
      fb.textContent = `FILTER → ${next.name.toUpperCase()}`;
    }
  }

  const ROUTE_BTN = { pipe: '#btn-mover', bal: '#btn-bal', sort: '#btn-sort' };
  const ROUTE_NAME = { pipe: 'CONVEYOR', bal: 'BALANCER', sort: 'SORTER' };

  function paintBuild() {
    // Routing shares one ladder and one counter with land, so the cheap allowance
    // is a budget — say how much is left once, under the row.
    const prices = hud?.routes || {};
    const left = hud?.moverLeft ?? 0;
    let shown = 0;
    for (const k of ROUTE_KINDS) {
      const b = $(ROUTE_BTN[k]);
      if (!b) continue;
      const cost = prices[k];
      b.hidden = cost == null;
      if (cost == null) continue;
      shown++;
      b.textContent = `+ ${ROUTE_NAME[k]} $${cost}`;
      b.disabled = view.c < cost || hud.ph === 'over';
    }
    $('#pad-route').style.gridTemplateColumns = shown > 2 ? '1.3fr 1fr 1fr' : '1.4fr 1fr';
    $('#route-note').textContent = left > 0
      ? `${left} more at base price this round — belts, balancers or sorters share the allowance.`
      : 'Past the cheap allowance: every routing machine now costs more than the last.';

    paintExpand();

    const pc = producerCost(view.pl), sc = sellerCost(view.sl);
    const bp = $('#btn-prod'), bs = $('#btn-sell');
    bp.textContent = view.pl >= MAX_UTIL ? 'PRODUCERS MAX' : `PRODUCERS L${view.pl} $${pc}`;
    bp.disabled = view.pl >= MAX_UTIL || view.c < pc;
    const vaults = (view.sv || []).length;
    bs.textContent = view.sl >= MAX_UTIL
      ? (vaults > 1 ? 'VAULTS MAX' : 'VAULT MAX')
      : `${vaults > 1 ? 'VAULTS' : 'VAULT'} L${view.sl} $${sc}`;
    bs.disabled = view.sl >= MAX_UTIL || view.c < sc;

    paintCatalogue();
  }

  function paintExpand() {
    const b = $('#btn-expand');
    if (!b) return;
    const claim = view.cl || GRID, plot = hud?.plot || GRID;
    const cost = hud?.expand ?? view.xc ?? 0;
    b.hidden = false;
    if (claim >= plot) {
      b.disabled = true;
      b.textContent = `PLOT FULLY CLAIMED · ${claim}x${claim}`;
      return;
    }
    // Land is bought between rounds: growing moves the vault, and doing that with
    // gizmos in the air would sell them into a wall.
    const planning = hud?.ph === 'plan';
    b.disabled = !planning || view.c < cost;
    b.textContent = planning
      ? `+ CLAIM LAND · ${claim + 1}x${claim + 1} · $${cost}`
      : `CLAIM LAND NEXT ROUND · $${cost}`;
  }

  let expandFlash = 0;
  function flashExpand() {
    setTab('build', true);
    const b = $('#btn-expand');
    if (!b || b.hidden) return;
    b.dataset.nudge = 'on';
    clearTimeout(expandFlash);
    expandFlash = setTimeout(() => { b.dataset.nudge = 'off'; }, 900);
  }

  /** Everything research has opened up, at this round's prices. */
  function paintCatalogue() {
    const list = $('#shop-cards');
    const open = hud.ph === 'shop';
    $('#cat-label').innerHTML = open
      ? 'CATALOGUE <span class="dim">buy all you can fit</span>'
      : 'CATALOGUE <span class="dim">opens between rounds</span>';
    if (!list) return;
    list.innerHTML = '';
    for (const [i, o] of (shop?.opts || []).entries()) {
      const row = document.createElement('div');
      row.className = 'cat-row';
      row.style.setProperty('--tint', o.tint || KINDS[o.kind].trim);
      row.innerHTML = '<div><b></b><small></small></div><button class="buy"></button>';
      row.querySelector('b').textContent = o.name;
      row.querySelector('small').textContent = o.desc;
      const btn = row.querySelector('.buy');
      btn.textContent = `$${o.cost}`;
      btn.disabled = !open || view.c < o.cost;
      btn.addEventListener('click', () => { send({ t: 'buy', i }); buzz(18); });
      list.appendChild(row);
    }
  }

  /**
   * The tech tree, in the order machines.js declares it — roughly cheapest first.
   * Each row says plainly why it cannot be bought yet: no science, or no
   * prerequisite. Nothing is hidden, because a tree you cannot see is not a plan.
   */
  function paintTech() {
    const list = $('#tech-list');
    if (!list) return;
    const sci = shop?.science ?? view.sc ?? 0;
    const open = hud.ph === 'shop';
    $('#tech-label').innerHTML = open
      ? `RESEARCH <span class="dim">${sci} science banked</span>`
      : `RESEARCH <span class="dim">${sci} banked · spend between rounds</span>`;
    list.innerHTML = '';
    for (const t of shop?.tech || []) {
      const row = document.createElement('div');
      row.className = 'tech-row';
      row.dataset.state = t.done ? 'done' : t.open ? 'open' : 'locked';
      row.innerHTML = '<div class="row"><b></b><span class="tech-cost"></span>'
        + '<button></button></div><small></small>';
      row.querySelector('b').textContent = t.name;
      row.querySelector('.tech-cost').textContent = t.done ? 'DONE' : `${t.cost} sci`;
      row.querySelector('small').textContent = t.done || t.open
        ? t.blurb
        : `${t.blurb} Needs ${t.needs.join(' and ')} first.`;
      const btn = row.querySelector('button');
      if (t.done) {
        btn.remove();
      } else {
        btn.textContent = !t.open ? 'LOCKED' : sci < t.cost ? `NEED ${t.cost - sci}` : 'RESEARCH';
        btn.disabled = !open || !t.open || sci < t.cost;
        btn.addEventListener('click', () => { send({ t: 'research', id: t.id }); buzz(22); });
      }
      list.appendChild(row);
    }
  }

  function paintCrate() {
    const row = $('#pad-inv');
    if (!row) return;
    const items = view?.v || [];
    row.innerHTML = '';
    if (!items.length) {
      row.innerHTML = '<span class="crate-empty">Empty — machines land here only when '
        + 'the floor has no room.</span>';
      return;
    }
    items.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.style.setProperty('--chip', KINDS[m.k].trim);
      b.textContent = `${label({ kind: m.k, mut: m.m })} L${m.l}`;
      b.setAttribute('aria-pressed', sel === 'i' + i ? 'true' : 'false');
      b.addEventListener('click', () => { setSel(sel === 'i' + i ? null : 'i' + i); buzz(10); });
      row.appendChild(b);
    });
  }

  /* --------------------------------------------------------------- state --- */

  function applyState(msg) {
    prev = view;
    tPrev = tNext;
    tNext = performance.now();
    view = msg.v;
    hud = msg.hud;
    shop = msg.shop;

    // The host owns the floor size; adopt it before drawing a single frame.
    // In practice mode the engine shares this page, so the size may already be
    // set while the canvas is still shaped for the old one — check both.
    if (hud.n) {
      if (hud.n !== GRID) setGridSize(hud.n);
      if (stage.gridN !== GRID) { stage.layout(1); fit(); }
    }

    if (sel) {
      const i = parseInt(sel.slice(1), 10);
      const still = sel[0] === 'g' ? view.g[i] : view.v[i];
      if (!still) { sel = null; if (tab === 'select') tab = lastTab; }
    }

    if (msg.fx?.length) {
      const o = stage.floorOrigin(stage.panelRect(0));
      playFx(stage, msg.fx, o, { boost: 0.7 });
      if (msg.fx.some(f => f.k === 'sell' && f.v >= 20)) buzz(24);
    }

    if (hud.ph !== lastPhase) {
      lastPhase = hud.ph;
      if (hud.ph === 'run') buzz([12, 60, 12]);
      if (hud.ph === 'shop') buzz(30);
      if (hud.ph === 'plan') buzz(20);
      document.body.dataset.phase = hud.ph;
      // The build phase is the one moment the dock has something urgent to say,
      // so it opens itself there — but never over an active selection.
      if (hud.ph === 'shop' && !sel) { tab = 'build'; lastTab = 'build'; }
    }

    paintDock();
    paintAll();
  }

  /* -------------------------------------------------------------- render --- */

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!view) return;

    fit();          // cheap: only touches the DOM when the scale actually changes
    stage.update(dt);
    stage.begin();

    const span = Math.max(30, tNext - tPrev);
    const a = Math.max(0, Math.min(1, (now - tNext) / span));
    drawPanel(stage, blend(prev, view, a), stage.panelRect(0), {
      name: hud?.name || 'YOU',
      color: PLAYER_COLORS[hud?.color ?? 0],
      earned: view.e,
      selected: sel && sel[0] === 'g' ? +sel.slice(1) : null,
    });

    stage.end();
  }

  /** Smooth the 15 Hz state stream: lerp gizmo pixels by id, keep everything else. */
  function blend(p, n, a) {
    if (!p || !p.z?.length || a >= 1) return n;
    const old = new Map(p.z.map(g => [g[0], g]));
    const z = n.z.map(g => {
      const o = old.get(g[0]);
      if (!o) return g;
      return [g[0], g[1], o[2] + (g[2] - o[2]) * a, o[3] + (g[3] - o[3]) * a, g[4]];
    });
    return { ...n, z };
  }

  function start() {
    fit();
    setTimeout(fit, 60);
    if (!raf) raf = requestAnimationFrame(frame);
    keepAwake();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  let lock = null;
  async function keepAwake() {
    try { lock = await navigator.wakeLock?.request('screen'); } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { keepAwake(); fit(); }
  });

  // Exposed so the headless pad harness can tap the board without a pointer event.
  return { applyState, start, destroy, fit, stage, selectCell: tapCell };
}
