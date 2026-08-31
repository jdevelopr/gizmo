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
      if (sel) { sel = null; paintSel(); buzz(8); }
      return;
    }
    tapCell(i);
  }, { passive: false });

  function tapCell(i) {
    const ref = 'g' + i;
    const here = view.g[i];

    if (!sel) {
      if (!here) return;
      sel = ref;
      buzz(10);
    } else if (sel === ref) {
      sel = null;
      buzz(8);
    } else {
      // Moved: drop the selection so the next tap starts fresh.
      send({ t: 'act', a: { a: 'move', from: sel, to: ref } });
      sel = null;
      buzz(14);
      paintInv();
    }
    paintSel();
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
  wire('#btn-up', () => { if (sel) act({ a: 'up', ref: sel }); });
  wire('#btn-scrap', () => {
    if (!sel) return;
    act({ a: 'scrap', ref: sel });
    sel = null;
    paintSel();
  });
  wire('#btn-stow', () => {
    if (!sel || sel[0] !== 'g') return;
    act({ a: 'move', from: sel, to: 'i' + (view.v?.length ?? 0) });
    sel = null;
    paintSel();
  });
  wire('#btn-clear', () => { sel = null; paintSel(); });
  wire('#btn-mover', () => { send({ t: 'mover' }); buzz(14); });
  wire('#btn-prod', () => act({ a: 'upprod' }));
  wire('#btn-sell', () => act({ a: 'upsell' }));
  wire('#btn-plan', () => {
    const next = !(hud && hud.ready);
    send({ t: 'plan', v: next });
    if (hud) hud.ready = next;
    buzz(next ? 18 : 10);
    paintPlan();
  });
  wire('#shop-reroll', () => { send({ t: 'reroll' }); buzz(12); });
  wire('#shop-done', () => { send({ t: 'done' }); buzz(16); });

  /* ---------------------------------------------------------------- HUD --- */

  function paintSel() {
    const m = selMachine();
    const box = $('#pad-sel');
    if (!m) {
      box.dataset.on = 'off';
      $('#sel-name').textContent = 'Tap a machine';
      $('#sel-sub').textContent = 'then tap a slot to move it — belts aim themselves';
      $('#btn-up').textContent = 'UPGRADE';
      $('#btn-scrap').textContent = 'SCRAP';
      $('#btn-up').disabled = true;
      $('#btn-scrap').disabled = true;
      $('#btn-rot').disabled = true;
      $('#btn-stow').disabled = true;
      return;
    }
    box.dataset.on = 'on';
    const spec = { kind: m.k, mut: m.m };
    const kind = KINDS[m.k];
    $('#sel-name').textContent = `${label(spec)} · Lv${m.l}`;
    $('#sel-sub').textContent = `${kind.desc} Facing ${DIR_NAME[m.d]}.`;
    const fake = { kind: m.k, mut: m.m, level: m.l };
    const upc = upgradeCost(fake);
    $('#btn-up').disabled = m.l >= MAX_LEVEL || (view.c < upc);
    $('#btn-up').textContent = m.l >= MAX_LEVEL ? 'MAX' : `UPGRADE $${upc}`;
    $('#btn-scrap').disabled = false;
    $('#btn-scrap').textContent = `SCRAP +$${scrapValue(fake)}`;
    $('#btn-rot').disabled = false;
    $('#btn-stow').disabled = sel[0] !== 'g';
  }

  function paintInv() {
    const row = $('#pad-inv');
    const items = view?.v || [];
    row.innerHTML = '';
    if (!items.length) {
      row.innerHTML = '<span class="crate-empty">Crate empty</span>';
      return;
    }
    items.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.style.setProperty('--chip', KINDS[m.k].trim);
      b.textContent = `${label({ kind: m.k, mut: m.m })} L${m.l}`;
      b.setAttribute('aria-pressed', sel === 'i' + i ? 'true' : 'false');
      b.addEventListener('click', () => {
        sel = sel === 'i' + i ? null : 'i' + i;
        buzz(10);
        paintSel();
        paintInv();
      });
      row.appendChild(b);
    });
  }

  function paintUtil() {
    const mv = $('#btn-mover');
    const cost = hud?.mover ?? 10;
    mv.textContent = `+ CONVEYOR · $${cost}`;
    mv.disabled = view.c < cost || hud?.ph === 'over';

    const pc = producerCost(view.pl), sc = sellerCost(view.sl);
    const bp = $('#btn-prod'), bs = $('#btn-sell');
    bp.textContent = view.pl >= MAX_UTIL ? 'PRODUCER MAX' : `PRODUCER L${view.pl} · $${pc}`;
    bp.disabled = view.pl >= MAX_UTIL || view.c < pc;
    bs.textContent = view.sl >= MAX_UTIL ? 'SELLER MAX' : `SELLER L${view.sl} · $${sc}`;
    bs.disabled = view.sl >= MAX_UTIL || view.c < sc;
  }

  function paintHud() {
    const b = hud.board || [];
    const rank = b.findIndex(r => r.seat === hud.seat) + 1;
    $('#pad-cash').textContent = '$' + view.c;
    $('#pad-earned').textContent = '$' + view.e;
    $('#pad-rank').textContent = rank ? `${rank}/${b.length}` : '-';
    const t = Math.max(0, Math.ceil(hud.tm));
    const phaseLabel = {
      plan: 'PLANNING', run: 'SHIPPING', tally: 'TALLY',
      shop: 'WORKSHOP', over: 'FINISHED', lobby: 'LOBBY',
    }[hud.ph] || hud.ph;
    $('#pad-phase').textContent = hud.ph === 'over'
      ? 'MATCH OVER'
      : `R${hud.r}/${hud.rs} · ${phaseLabel} · ${t}s`;
    $('#pad-phase').dataset.ph = hud.ph;
    const spot = hud.spot ? `Seller: ${hud.spot.toLowerCase()} face.` : 'Seller moved.';
    $('#pad-hint').textContent = hud.ph === 'plan'
      ? `${spot} Lay conveyors to reach it — they aim themselves. Then ready up.`
      : hud.ph === 'run' ? 'Keep re-routing — the floor stays live.'
        : hud.ph === 'shop' ? 'Buy one machine, then hit READY.'
          : hud.ph === 'tally' ? `Round income $${view.n}.` : '';
    $('#pad-note').textContent = hud.note || '';
    $('#pad-note').hidden = !hud.note;
  }

  function paintPlan() {
    const btn = $('#btn-plan');
    if (!btn) return;
    if (!hud || hud.ph !== 'plan') { btn.hidden = true; return; }
    btn.hidden = false;
    const others = Math.max(0, (hud.waiting ?? 0) - (hud.ready ? 0 : 1));
    btn.dataset.on = hud.ready ? 'on' : 'off';
    btn.textContent = hud.ready
      ? (others > 0 ? `READY — WAITING FOR ${others}` : 'READY')
      : 'READY — START THE ROUND';
  }

  function paintShop() {
    const wrap = $('#shop');
    // Once a player is done, the sheet gets out of the way: the rest of the
    // workshop window is for re-routing the floor.
    if (!shop || hud.ph !== 'shop' || shop.done) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('#shop-title').textContent = `WORKSHOP · ${Math.max(0, Math.ceil(hud.tm))}s`;
    $('#shop-reroll').textContent = `REROLL $${shop.reroll}`;
    $('#shop-reroll').disabled = view.c < shop.reroll || shop.done;
    $('#shop-done').textContent = shop.done ? 'WAITING…' : 'READY';
    $('#shop-done').disabled = shop.done;

    const list = $('#shop-cards');
    list.innerHTML = '';
    shop.opts.forEach((o, i) => {
      const card = document.createElement('div');
      card.className = 'shop-card';
      if (o.tint) card.style.setProperty('--tint', o.tint);
      else card.style.setProperty('--tint', KINDS[o.kind].trim);
      card.innerHTML =
        `<h4></h4><p></p><button class="buy"></button>`;
      card.querySelector('h4').textContent = o.name;
      card.querySelector('p').textContent = o.desc;
      const btn = card.querySelector('.buy');
      btn.textContent = shop.bought ? 'BOUGHT ONE' : `BUY $${o.cost}`;
      btn.disabled = shop.bought || view.c < o.cost;
      btn.addEventListener('click', () => { send({ t: 'buy', i }); buzz(18); });
      list.appendChild(card);
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
      if (!still) sel = null;
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
    }

    paintSel();
    paintInv();
    paintUtil();
    paintHud();
    paintPlan();
    paintShop();
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

  return { applyState, start, destroy, fit, stage };
}
