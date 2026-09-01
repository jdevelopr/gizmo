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
  cycleTime, claimed, describe, TYPES, ROUTE_KINDS, cy,
  RECIPES, MUT_CYCLE, unlockedBy, upFam, FAM_START, FAM_LEN,
  ALLOY, PART, PRODUCT, COPY_MAX_VALUE,
  producerCycle, sellerMult, RESIN_CLAIM, SECOND_VAULT_CLAIM, SCIENCE_RATE,
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
  let info = null;             // a tapped fixture: producer, vault or Lab
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
    // Fixtures first: they are drawn outside the floor, and `cellAt` is forgiving
    // enough that a tap on the gutter would otherwise snap to the nearest slot.
    const fx = stage.fixtureAt(bx, by, view);
    if (fx) { setInfo(fx); buzz(10); return; }
    const i = stage.cellAt(bx, by);
    if (i < 0) {
      if (sel || info) { setSel(null); buzz(8); }
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
  wire('#btn-mir', () => { if (sel) act({ a: 'mir', ref: sel }); });
  // UPGRADE means whatever is on screen: a machine's level, or a fixture's.
  wire('#btn-up', () => {
    if (info) return act({ a: info.kind === 'prod' ? 'upprod' : 'upsell' });
    if (sel) act({ a: 'up', ref: sel });
  });
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
   * The one button. Build and planning used to be separate phases with a READY
   * each; they are one phase now, so this is one button that starts the round.
   */
  wire('#dock-action', () => {
    if (!hud || hud.ph !== 'plan') return;
    const next = !hud.ready;
    send({ t: 'plan', v: next });
    hud.ready = next;
    buzz(next ? 18 : 10);
    paintAction();
  });

  /* ---------------------------------------------------------------- dock --- */

  /*
   * The dock's tabs. SELECT is not among them: tapping a machine opens its controls
   * by itself, so a button that takes you somewhere you have already been taken was
   * a quarter of the dock spent on nothing. The selection panel simply covers
   * whichever tab is open, and uncovers it again when the selection is dropped.
   */
  const TABS = ['build', 'tech', 'crate', 'recipes'];
  let tab = 'build';

  for (const b of document.querySelectorAll('#dock-tabs button')) {
    b.addEventListener('click', e => {
      e.preventDefault();
      setTab(b.dataset.tab);
      buzz(10);
    });
  }

  function setTab(next) {
    if (!TABS.includes(next)) return;
    // Choosing a tab is also a way of saying you are done with the machine you had
    // selected, so it clears the selection rather than being covered by it.
    if (sel || info) { sel = null; info = null; paintAll(); }
    tab = next;
    paintDock();
  }

  /**
   * Selecting a machine covers the dock with its controls; dropping the selection
   * uncovers whatever tab was underneath. The alternative — a permanent selection
   * strip — costs the same pixels whether or not anything is selected.
   */
  function setSel(next) {
    sel = next;
    if (next) info = null;
    paintDock();
    paintAll();
  }

  /** Show a fixture in the same panel a machine uses. Tapping it again closes it. */
  function setInfo(next) {
    const same = info && next && info.kind === next.kind && info.idx === next.idx;
    info = same ? null : next;
    if (info) sel = null;
    paintDock();
    paintAll();
  }

  function paintDock() {
    const showSel = !!sel || !!info;
    $('#panel-select').hidden = !showSel;
    for (const name of TABS) {
      const el = $('#panel-' + name);
      if (el) el.hidden = showSel || name !== tab;
    }
    for (const b of document.querySelectorAll('#dock-tabs button')) {
      b.setAttribute('aria-pressed', !showSel && b.dataset.tab === tab ? 'true' : 'false');
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
        if (hud?.ph === 'plan') build.dataset.badge = '\u25cf';
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
    paintRecipes();
    paintAction();
    badges();
  }

  function paintBar() {
    const b = hud.board || [];
    const rank = b.findIndex(r => r.seat === hud.seat) + 1;
    const label = {
      plan: 'BUILD', run: 'SHIPPING', tally: 'TALLY',
      over: 'FINISHED', lobby: 'LOBBY',
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
      btn.disabled = false;
      const others = Math.max(0, (hud.waiting ?? 0) - (hud.ready ? 0 : 1));
      btn.dataset.on = hud.ready ? 'on' : 'off';
      btn.textContent = hud.ready
        ? (others > 0 ? `READY — WAITING FOR ${others}` : 'READY')
        : 'DONE BUILDING — START THE ROUND';
    } else {
      btn.hidden = true;
    }
  }

  /**
   * A Producer, a vault or the Lab, described in the panel a machine would use.
   * None of them occupies a slot, so none of them can be moved, rotated or sold —
   * but every one of them is something a player wants to be able to ask about, and
   * two of the three carry the upgrade that matters most.
   */
  function paintFixture() {
    const fb = $('#btn-filt'), mb = $('#btn-mir');
    fb.hidden = true; mb.hidden = true;
    for (const id of ['#btn-scrap', '#btn-rot', '#btn-stow']) $(id).disabled = true;
    $('#btn-scrap').textContent = 'SCRAP';

    const up = $('#btn-up');
    if (info.kind === 'prod') {
      const t = TYPES[info.ty];
      const cyc = producerCycle(view.pl);
      const feeds = (view.pp || []).length;
      $('#sel-name').textContent = `Producer ${'AB'[info.idx] || '?'} · ${t.name} · L${view.pl}`;
      $('#sel-sub').textContent =
        `Drops ${t.name} ($${t.value}) into row ${cy(info.cell) + 1} every ${cyc.toFixed(2)}s `
        + `(${(1 / cyc).toFixed(2)}/s).`
        + (feeds > 1
          ? ' One level runs both feeds, which is what makes this upgrade worth its price.'
          : ` A second feed drops Resin once your plot is ${RESIN_CLAIM}x${RESIN_CLAIM}.`)
        + (info.stalled ? ' STALLED — the floor has nowhere to put the next one.' : '');
      const c = producerCost(view.pl);
      up.hidden = false;
      up.disabled = view.pl >= MAX_UTIL || view.c < c;
      up.textContent = view.pl >= MAX_UTIL ? 'PRODUCERS MAX' : `SPEED UP $${c}`;
      return;
    }
    if (info.kind === 'vault') {
      const n = (view.sv || []).length;
      const c = sellerCost(view.sl);
      $('#sel-name').textContent = `Vault · L${view.sl} · pays x${sellerMult(view.sl).toFixed(1)}`;
      $('#sel-sub').textContent =
        `Anything pushed out of the floor at this face sells. Welded to the east fence, so `
        + `it only moves when you claim land.`
        + (n > 1 ? ' Both vaults share this level.' : ` A second vault opens at ${SECOND_VAULT_CLAIM}x${SECOND_VAULT_CLAIM}.`);
      up.hidden = false;
      up.disabled = view.sl >= MAX_UTIL || view.c < c;
      up.textContent = view.sl >= MAX_UTIL ? 'VAULTS MAX' : `BETTER PRICES $${c}`;
      return;
    }
    $('#sel-name').textContent = `The Lab · ${view.sc || 0} science banked`;
    $('#sel-sub').textContent =
      `Pays in science instead of cash: ${SCIENCE_RATE === 1
        ? 'a gizmo is worth exactly what the vault would have paid for it'
        : `a gizmo is worth ${SCIENCE_RATE}x its value here`}, so the only cost of research `
      + 'is the money you did not take. One face round from the vault, which is why a '
      + 'Balancer on this slot splits your output between money and growth.';
    up.hidden = true;
  }

  function paintSelect() {
    const fb = $('#btn-filt');
    const mb = $('#btn-mir');
    $('#btn-up').hidden = false;
    if (info) return paintFixture();
    const m = selMachine();
    if (!m) {
      $('#sel-name').textContent = 'Nothing selected';
      $('#sel-sub').textContent =
        'Tap a machine on the board, then an owned slot to move it. Belts aim themselves.';
      for (const id of ['#btn-up', '#btn-scrap', '#btn-rot', '#btn-stow']) $(id).disabled = true;
      $('#btn-up').textContent = 'UPGRADE';
      $('#btn-scrap').textContent = 'SCRAP';
      fb.hidden = true;
      mb.hidden = true;
      return;
    }
    const spec = { kind: m.k, mut: m.m, mir: m.mi };
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

    // Routers branch to one side. FLIP moves that branch without turning the
    // through line, which rotating would also do. Level 3 uses both sides, so
    // there is nothing left to choose.
    const router = m.k === 'bal' || m.k === 'sort';
    mb.hidden = !router || m.l >= MAX_LEVEL;
    mb.disabled = mb.hidden;
    if (!mb.hidden) mb.textContent = `FLIP → ${m.mi ? 'RIGHT' : 'LEFT'}`;
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
    setTab('build');
    const b = $('#btn-expand');
    if (!b || b.hidden) return;
    b.dataset.nudge = 'on';
    clearTimeout(expandFlash);
    expandFlash = setTimeout(() => { b.dataset.nudge = 'off'; }, 900);
  }

  /** Everything research has opened up, at this round's prices. */
  function paintCatalogue() {
    const list = $('#shop-cards');
    const open = hud.ph === 'plan';
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
    const open = hud.ph === 'plan';
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

  /**
   * Every transformation in the game, generated from the same data the simulation
   * runs on. Built once — none of it changes during a match except which Assembler
   * recipes are unlocked, which is the one thing repainted.
   */
  let recipesBuilt = false;

  const chip = (ty, prefix = '') => {
    const t = TYPES[ty];
    return `<span class="rec-chip"><i style="--c:${t.color}"></i>${prefix}<b>${t.name}</b></span>`;
  };

  function recRow(inner, out, note, locked = false, tint = null) {
    const row = document.createElement('div');
    row.className = 'rec-row' + (locked ? ' locked' : '');
    if (tint) row.style.setProperty('--tint', tint);
    row.innerHTML = `<div class="rec-in">${inner}</div>`
      + `<div class="rec-out">${out}${note ? `<div class="rec-note">${note}</div>` : ''}</div>`;
    return row;
  }

  function buildRecipes() {
    // --- fusing: two of a kind, one rung up, within a family ---
    const fuse = $('#rec-fuse');
    fuse.innerHTML = '';
    for (const fam of [ALLOY, PART]) {
      for (let k = 0; k < FAM_LEN[fam] - 1; k++) {
        const ty = FAM_START[fam] + k;
        const up = upFam(ty);
        fuse.appendChild(recRow(
          `${chip(ty, '2x ')}<span class="rec-arrow">→</span>${chip(up)}`,
          '$' + TYPES[up].value,
          `from $${TYPES[ty].value * 2}`,
          false, TYPES[up].color,
        ));
      }
    }

    // --- mutators: anything in, one type out, at a tier-dependent pace ---
    const mut = $('#rec-mut');
    mut.innerHTML = '';
    for (let t = 1; t < FAM_LEN[ALLOY]; t++) {
      const cyc = MUT_CYCLE[t];
      mut.appendChild(recRow(
        `<span class="rec-chip">anything</span><span class="rec-arrow">→</span>${chip(t)}`,
        '$' + TYPES[t].value,
        `${(1 / cyc).toFixed(2)}/s · $${(TYPES[t].value / cyc).toFixed(1)}/s`,
        false, TYPES[t].color,
      ));
    }

    // --- the rules that are not obvious from any single row ---
    const rules = $('#rec-rules');
    rules.innerHTML = '';
    for (const [head, body] of [
      ['Fusing barely gains value',
        `two Cobalt are worth $${TYPES[4].value * 2} and make a $${TYPES[5].value} Void. What you buy is `
        + 'density: one gizmo where there were two, on a belt that only fits so many.'],
      ['Mismatched tiers take the higher, plus one',
        'Scrap and Cobalt fuse to Void — the cheap one is pure waste, so do not merge '
        + 'two lines carelessly into a Fuser.'],
      ['A level 3 Fuser jumps two rungs',
        'but only on a matching pair. Mismatched still gains one.'],
      ['Families never mix',
        'a Fuser holding Resin refuses Scrap outright and the belt behind it backs up. '
        + 'Products are terminal: nothing fuses an Engine.'],
      ['Two originals make an original',
        `feed a copy in and a copy comes out. Nothing worth more than $${COPY_MAX_VALUE} is copied at all.`],
    ]) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${head}</b> — ${body}`;
      rules.appendChild(li);
    }
    recipesBuilt = true;
  }

  function paintRecipes() {
    if (!recipesBuilt) buildRecipes();
    // Assembler recipes are the only part that changes: research opens them.
    const on = unlockedBy(view.dn || []);
    const asm = $('#rec-asm');
    asm.innerHTML = '';
    RECIPES.forEach((r, i) => {
      const locked = !on.has('asm:' + i);
      asm.appendChild(recRow(
        `${chip(r.ins[0])}<span class="rec-arrow">+</span>${chip(r.ins[1])}`
          + `<span class="rec-arrow">→</span>${chip(r.out)}`,
        '$' + TYPES[r.out].value,
        locked ? 'needs research' : `${r.cycle}s · $${(TYPES[r.out].value / r.cycle).toFixed(1)}/s`,
        locked, TYPES[r.out].color,
      ));
    });
    void PRODUCT;
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
      if (hud.ph === 'plan') buzz(24);
      document.body.dataset.phase = hud.ph;
      // The build phase is the one moment the dock has something to say, so it
      // opens itself there — but never over an active selection.
      if (hud.ph === 'plan' && !sel) tab = 'build';
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

  /**
   * Announce something over the board. Solo play has no floor screen to shout
   * ROUND 3 across the room, so the pad does it itself.
   */
  let bannerT = 0;
  function banner(text, sub = '', secs = 2) {
    const el = $('#pad-banner');
    if (!el) return;
    el.querySelector('b').textContent = text || '';
    el.querySelector('small').textContent = sub || '';
    el.hidden = !text;
    clearTimeout(bannerT);
    if (text) bannerT = setTimeout(() => { el.hidden = true; }, secs * 1000);
  }

  /** A tap at art coordinates, taking the same path a real pointer would. */
  function tapPoint(bx, by) {
    const fx = stage.fixtureAt(bx, by, view);
    if (fx) return setInfo(fx);
    const i = stage.cellAt(bx, by);
    if (i >= 0) return tapCell(i);
    if (sel || info) setSel(null);
  }

  // selectCell and tapPoint are exposed so the headless pad harness can drive the
  // board without pointer events; banner so solo mode can drive announcements.
  return { applyState, start, destroy, fit, stage, banner, selectCell: tapCell, tapPoint };
}
