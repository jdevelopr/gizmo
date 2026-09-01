/**
 * main.js — entry point and screen routing.
 *
 * No room in the URL  -> this device can open a room (floor screen) or play solo.
 * ?room=ABCD          -> this device is a phone: name, colour, ready, then the pad.
 *
 * Solo is reachable from every one of those states, including from inside the join
 * flow. A phone that scanned a code should never be stuck because the room filled
 * up, the floor screen closed, or the person simply wants to play now — so the
 * lobby and the failure screen both offer it, and it runs the identical engine.
 */

import { createClient, roomFromUrl, clientId } from './net.js';
import { createEngine } from './game.js';
import { createController } from './player.js';
import { Stage, drawPanel, playFx, banner, PLAYER_COLORS } from './render.js';
import { openSetup } from './setup.js';
import './howto.js';        // wires every [data-howto] button

const $ = s => document.querySelector(s);
const show = s => { document.body.dataset.screen = s; };
const SLUG = 'gizmo-floor';

window.__boot = window.__boot || { ok: false, why: [] };

const code = roomFromUrl();
if (code) bootPhone(code);
else bootHome();

window.__boot.ok = true;

/* -------------------------------------------------------------- home --- */

function bootHome() {
  show('home');

  $('#host-btn').addEventListener('click', async () => {
    $('#host-btn').disabled = true;
    $('#host-btn').textContent = 'OPENING ROOM…';
    const { startHost } = await import('./host.js');
    startHost(show);
  });

  $('#practice-btn').addEventListener('click', () => askSolo());

  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#join-code').value.trim().toUpperCase();
    if (v.length !== 4) return;
    location.search = '?room=' + v;
  });
}

/* ------------------------------------------------------------- phone --- */

function bootPhone(room) {
  const stored = localStorage.getItem('gizmo-name');
  if (!stored) {
    show('name');
    $('#name-form').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('#name-input').value.trim().slice(0, 12);
      if (!v) return;
      localStorage.setItem('gizmo-name', v);
      connectPhone(room, v);
    });
    return;
  }
  connectPhone(room, stored);
}

/** Open Setup, then run the whole match on this device. */
function askSolo(bail = null) {
  openSetup({
    label: 'START SOLO RUN',
    done: cfg => {
      if (bail) bail();
      startSolo(cfg);
    },
  });
}

function connectPhone(room, name) {
  show('connecting');
  $('#connect-note').textContent = `Reaching room ${room}…`;

  const client = createClient({ slug: SLUG, code: room, name });
  const ctrl = createController({ send: msg => client.send(msg) });
  let roster = [], myColor = 0, mySeat = 0, ready = false;

  client.on('welcome', msg => {
    mySeat = msg.seat;
    roster = msg.players || [];
    show('plobby');
    paintPhoneLobby();
  });

  client.on('lobby', players => { roster = players; syncMe(); paintPhoneLobby(); });

  /** The host owns the roster, including whether this phone is ready. */
  function syncMe() {
    const me = roster.find(p => p.seat === mySeat);
    if (!me) return;
    myColor = me.color ?? myColor;
    ready = !!me.ready;
  }

  client.on('msg', msg => {
    if (msg.t !== 'sync') return;
    roster = msg.players || roster;
    syncMe();
    // The floor screen went back to the lobby: follow it, from the pad or the results.
    const screen = document.body.dataset.screen;
    if (msg.phase === 'lobby' && (screen === 'pad' || screen === 'results')) show('plobby');
    paintPhoneLobby();
  });

  client.on('start', () => { show('pad'); ctrl.start(); ctrl.fit(); });

  client.on('state', msg => {
    // A state tick is also how a reconnecting phone learns the match is running.
    if (!msg.hud || msg.hud.ph === 'lobby') return;
    if (document.body.dataset.screen !== 'pad' && document.body.dataset.screen !== 'results') {
      show('pad');
      ctrl.start();
    }
    ctrl.applyState(msg);
  });

  client.on('over', results => {
    const list = $('#podium');
    list.innerHTML = '';
    (results || []).forEach(r => {
      const li = document.createElement('li');
      li.className = 'result place-' + r.place + (r.seat === mySeat ? ' me' : '');
      li.style.setProperty('--pc', PLAYER_COLORS[r.color % 4].hex);
      li.innerHTML = '<span class="place"></span><span class="who"></span><span class="amt"></span>';
      li.querySelector('.place').textContent = '#' + r.place;
      li.querySelector('.who').textContent = r.name;
      li.querySelector('.amt').textContent = '$' + r.earned;
      list.appendChild(li);
    });
    const mine = (results || []).find(r => r.seat === mySeat);
    $('#results-sub').textContent = mine ? `You placed #${mine.place} with $${mine.earned}.` : '';
    $('#again-btn').hidden = true;
    show('results');
  });

  let done = false;

  client.on('rejected', reason => {
    done = true;                 // stop here: do not thrash the room with retries
    client.destroy();
    show('home');
    $('#home-note').textContent = reason;
    $('#home-note').hidden = false;
    history.replaceState(null, '', location.pathname);
  });

  client.on('disconnected', () => {
    if (done) return;
    $('#drop').hidden = false;
    setTimeout(() => { if (!done) location.reload(); }, 4000);
  });

  client.on('error', err => {
    $('#connect-note').textContent = err?.message || 'Could not connect.';
    $('#connect-retry').hidden = false;
    $('#connect-solo').hidden = false;
  });

  $('#connect-retry').addEventListener('click', () => location.reload());

  /** Leave the room behind and play alone. Both exits tear the peer down first. */
  const leaveForSolo = () => {
    done = true;
    try { client.send({ t: 'bye' }); } catch {}
    try { client.destroy(); } catch {}
    history.replaceState(null, '', location.pathname);
  };
  $('#connect-solo').addEventListener('click', () => askSolo(leaveForSolo));
  $('#solo-btn').addEventListener('click', () => askSolo(leaveForSolo));

  /* colour + ready */
  const colorRow = $('#colors');
  colorRow.innerHTML = '';
  PLAYER_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.setProperty('--pc', c.hex);
    b.setAttribute('aria-label', c.name);
    b.addEventListener('click', () => {
      client.send({ t: 'color', c: i });
      myColor = i;
      paintPhoneLobby();
      navigator.vibrate?.(12);
    });
    colorRow.appendChild(b);
  });

  $('#ready-btn').addEventListener('click', () => {
    ready = !ready;
    client.ready(ready);
    navigator.vibrate?.(16);
    paintPhoneLobby();
  });

  $('#rename-btn').addEventListener('click', () => {
    const v = prompt('Name', name);
    if (!v) return;
    name = v.trim().slice(0, 12);
    localStorage.setItem('gizmo-name', name);
    client.send({ t: 'rename', n: name });
  });

  function paintPhoneLobby() {
    const wrap = $('#plobby-roster');
    wrap.innerHTML = '';
    roster.forEach(p => {
      const el = document.createElement('div');
      el.className = 'plob-row' + (p.seat === mySeat ? ' me' : '');
      el.style.setProperty('--pc', PLAYER_COLORS[(p.color ?? p.seat) % 4].hex);
      el.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="st"></span>';
      el.querySelector('.nm').textContent = p.name + (p.seat === mySeat ? ' (you)' : '');
      el.querySelector('.st').textContent = p.ready ? 'READY' : '…';
      wrap.appendChild(el);
    });
    [...colorRow.children].forEach((b, i) => {
      const taken = roster.some(p => p.seat !== mySeat && p.color === i);
      b.disabled = taken;
      b.setAttribute('aria-pressed', myColor === i ? 'true' : 'false');
    });
    $('#ready-btn').textContent = ready ? 'READY — TAP TO UNDO' : 'I AM READY';
    $('#ready-btn').dataset.on = ready ? 'on' : 'off';
    $('#plobby-note').textContent = `${roster.filter(p => p.ready).length} of ${roster.length} ready. The floor screen starts the match.`;
  }

  // Tell the host on the way out so the floor greys this player straight away.
  window.addEventListener('pagehide', () => { try { client.send({ t: 'bye' }); } catch {} });

  client.connect();
  void clientId();
}

/* -------------------------------------------------------------- solo --- */

/**
 * One player, one device, the same engine the room runs.
 *
 * On a wide screen this draws the floor view beside the pad, which is how you
 * preview a board size before putting it in front of people. On a phone the floor
 * view is hidden by CSS — it would be the same factory drawn twice — so the pad
 * takes the whole screen and announces the rounds itself.
 */
function startSolo(cfg = {}) {
  const engine = createEngine({ ...cfg });
  engine.addPlayer(0, localStorage.getItem('gizmo-name') || 'YOU', 0);

  const stage = new Stage($('#stage'));
  // Solo owns its own engine, so the pad may offer to end an endless run itself.
  const ctrl = createController({
    send: msg => engine.action(0, msg),
    solo: true,
    onEnd: () => engine.endMatch(),
  });

  let bannerText = '', bannerSub = '', bannerT = 0, last = 0;

  engine.on('phase', (ph, info) => {
    if (ph === 'plan') {
      bannerText = `ROUND ${info.round}`;
      bannerSub = info.round > 1 ? 'BUY · RESEARCH · BUILD' : 'BUILD YOUR LINE';
      bannerT = 2.2;
    }
    if (ph === 'run') { bannerText = 'SHIP IT'; bannerSub = ''; bannerT = 1; stage.shake(4); }
    if (ph === 'tally') { bannerText = 'ROUND OVER'; bannerSub = ''; bannerT = 1.8; }
    // The pad says it too, which is the only place it gets said on a phone.
    ctrl.banner(bannerText, bannerSub, bannerT);
  });

  engine.on('fx', (seat, fx) => playFx(stage, fx, stage.floorOrigin(stage.panelRect(0))));

  engine.on('over', results => {
    const list = $('#podium');
    list.innerHTML = '';
    (results || []).forEach(r => {
      const li = document.createElement('li');
      li.className = 'result place-' + r.place;
      li.style.setProperty('--pc', PLAYER_COLORS[r.color % 4].hex);
      li.innerHTML = '<span class="place"></span><span class="who"></span><span class="amt"></span>';
      li.querySelector('.place').textContent = '#' + r.place;
      li.querySelector('.who').textContent = r.name;
      li.querySelector('.amt').textContent = '$' + r.earned;
      list.appendChild(li);
    });
    const me = (results || [])[0];
    const p0 = engine.players.get(0);
    $('#results-sub').textContent = me
      ? `Solo run over — $${me.earned} shipped on a ${p0.f.claim}x${p0.f.claim} plot, `
        + `${p0.filled} orders filled, ${p0.f.done.length} research done.`
      : 'Solo run over.';
    $('#again-btn').textContent = 'ANOTHER SOLO RUN';
    $('#again-btn').onclick = () => location.reload();
    show('results');
  });

  show('practice');
  ctrl.start();
  engine.startGame();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (document.body.dataset.screen !== 'practice') return;

    engine.step(dt);
    if (bannerT > 0) bannerT -= dt;

    // On a phone the floor view is display:none and has no box to draw into, so
    // skip it entirely rather than rendering a frame nobody can see.
    const wrap = $('#stage-wrap').getBoundingClientRect();
    if (wrap.width > 1 && wrap.height > 1) {
      stage.autoFit(1, Math.max(80, wrap.width), Math.max(90, wrap.height));
      stage.update(dt);
      stage.begin();
      const p = engine.players.get(0);
      drawPanel(stage, engine.viewOfSeat(0), stage.panelRect(0), {
        name: p.name, color: PLAYER_COLORS[0], earned: Math.round(p.f.earned),
      });
      if (bannerT > 0) banner(stage, bannerText, bannerSub);
      stage.end();

      $('#floor-round').textContent = `ROUND ${engine.round} / ${engine.cfg.rounds}`;
      $('#floor-phase').textContent = {
        plan: 'BUILD', run: 'SHIPPING', tally: 'TALLY',
      }[engine.phase] || '';
      $('#floor-timer').textContent = String(Math.max(0, Math.ceil(engine.timer))).padStart(2, '0');
    }

    ctrl.applyState(engine.stateFor(0));
  }
  requestAnimationFrame(frame);
}
