/**
 * host.js — the floor screen.
 *
 * This device is never a player. It opens the room, shows the QR and the lobby,
 * runs every factory, and draws all of them side by side. Phones send intent.
 */

import { createHost, joinUrl } from './net.js';
import { createEngine } from './game.js';
import { readSetupCfg, openSetup, summary } from './setup.js';
import { Stage, drawPanel, playFx, banner, PLAYER_COLORS } from './render.js';

const $ = s => document.querySelector(s);
const SLUG = 'gizmo-floor';
const MAX_PLAYERS = 4;
const SEND_MS = 66;

export function startHost(show) {
  const stage = new Stage($('#stage'));
  const engine = createEngine(readSetupCfg());
  const host = createHost({ slug: SLUG, maxPlayers: MAX_PLAYERS });

  let url = '';
  let started = false;
  let lastSend = 0, last = 0, raf = 0;
  let bannerText = '', bannerSub = '', bannerT = 0;

  /* --------------------------------------------------------------- room --- */

  const startTimeout = setTimeout(() => {
    if (!host.code) note('The signalling server is not answering. Check the connection and reload.');
  }, 12000);

  host.on('open', code => {
    clearTimeout(startTimeout);
    url = joinUrl(code);
    $('#room-code').textContent = code;
    $('#join-url').textContent = url.replace(/^https?:\/\//, '');
    try {
      QRCode.toCanvas($('#qr'), url, {
        width: 220, margin: 1,
        color: { dark: '#12131f', light: '#f4f4f4' },
      }, err => { if (err) console.warn(err); });
    } catch (e) { console.warn('QR failed', e); }
    note('Waiting for players.');
    show('lobby');
  });

  host.on('error', err => {
    clearTimeout(startTimeout);
    note(err?.message || 'Connection error. Reload to try again.');
  });

  host.on('hello', seat => {
    const s = host.seatOf(seat);
    const p = engine.addPlayer(seat, s?.name, freeColor(seat));
    engine.setConnected(seat, true);
    if (s) s.meta = { color: p.color };
    syncAll();
    paintLobby();
  });

  host.on('leave', seat => { engine.setConnected(seat, false); paintLobby(); });
  host.on('roster', () => { paintLobby(); });
  host.on('ready', () => paintLobby());

  host.on('message', (seat, msg) => {
    if (msg.t === 'color') {
      if (engine.setColor(seat, msg.c | 0)) {
        const s = host.seatOf(seat);
        if (s) s.meta = { color: msg.c | 0 };
        syncAll();
        paintLobby();
      }
      return;
    }
    if (msg.t === 'rename') {
      const s = host.seatOf(seat);
      if (s) s.name = String(msg.n || '').slice(0, 12) || s.name;
      engine.addPlayer(seat, s?.name);
      host.broadcastRoster();
      syncAll();
      paintLobby();
      return;
    }
    engine.action(seat, msg);
  });

  function freeColor(seat) {
    const used = new Set([...engine.players.values()].map(p => p.color));
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
    return seat % PLAYER_COLORS.length;
  }

  function syncAll() {
    host.broadcast({
      t: 'sync',
      phase: engine.phase,
      cfg: { rounds: engine.cfg.rounds, roundSecs: engine.cfg.roundSecs },
      players: rosterView(),
    });
  }

  function rosterView() {
    return host.roster().map(r => ({
      seat: r.seat, name: r.name, ready: r.ready, connected: r.connected,
      color: engine.players.get(r.seat)?.color ?? r.seat,
    }));
  }

  /* -------------------------------------------------------------- lobby --- */

  function paintLobby() {
    const list = rosterView();
    const pods = $('#podiums');
    pods.innerHTML = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = list.find(x => x.seat === i);
      const el = document.createElement('div');
      el.className = 'podium' + (p ? ' filled' : '') + (p?.ready ? ' ready' : '');
      if (p) el.style.setProperty('--pc', PLAYER_COLORS[p.color % 4].hex);
      el.innerHTML = p
        ? `<div class="pod-badge"></div>
           <div class="pod-name"></div>
           <div class="pod-state">${p.connected ? (p.ready ? 'READY' : 'CHOOSING…') : 'RECONNECTING'}</div>`
        : `<div class="pod-badge empty"></div>
           <div class="pod-name dim">OPEN SEAT</div>
           <div class="pod-state dim">scan to join</div>`;
      if (p) el.querySelector('.pod-name').textContent = p.name;
      pods.appendChild(el);
    }

    const cfgLine = $('#lobby-cfg');
    if (cfgLine) cfgLine.textContent = summary(engine.cfg);

    const ready = list.filter(p => p.ready && p.connected).length;
    const btn = $('#start-btn');
    btn.disabled = started || ready < 2 || ready !== list.filter(p => p.connected).length;
    btn.textContent = ready < 2 ? `NEED ${2 - ready} MORE` : 'START GAME';
    if (!started) {
      note(list.length === 0
        ? 'Waiting for players.'
        : `${ready} of ${list.length} ready.`);
    }
  }

  const note = t => { const el = $('#lobby-note'); if (el) el.textContent = t; };

  $('#copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); $('#copy-link').textContent = 'COPIED'; }
    catch { $('#copy-link').textContent = url; }
    setTimeout(() => { $('#copy-link').textContent = 'COPY LINK'; }, 1600);
  });

  $('#setup-btn').addEventListener('click', () => openSetup({
    label: 'DONE',
    done: cfg => { Object.assign(engine.cfg, cfg); syncAll(); paintLobby(); },
  }));

  $('#start-btn').addEventListener('click', () => {
    if (started) return;
    started = true;
    Object.assign(engine.cfg, readSetupCfg());
    engine.startGame();
    host.start({ cfg: engine.cfg });
    show('floor');
    window.addEventListener('beforeunload', warn);
  });

  const warn = e => { e.preventDefault(); e.returnValue = ''; };

  /* ------------------------------------------------------------- engine --- */

  engine.on('phase', (ph, info) => {
    const t = engine.timer;
    if (ph === 'plan') {
      const sub = info.newSeller ? 'A SECOND VAULT HAS OPENED'
        : info.round > 1 ? 'THE SELLERS HAVE MOVED' : 'PLAN YOUR LINE';
      say(`ROUND ${info.round}`, sub, info.newSeller ? 3.4 : 2.6);
    }
    if (ph === 'run') { say('SHIP IT', '', 1.2); stage.shake(4); }
    if (ph === 'tally') say('ROUND OVER', '', 2);
    if (ph === 'shop') say('WORKSHOP', 'ONE MACHINE EACH', 2);
    if (ph === 'over') { stage.shake(6); showResults(); }
    void t;
  });

  engine.on('fx', (seat, fx) => {
    const idx = panelIndex(seat);
    if (idx < 0) return;
    const o = stage.floorOrigin(stage.panelRect(idx));
    playFx(stage, fx, o, { boost: 1 });
  });

  engine.on('over', () => { window.removeEventListener('beforeunload', warn); });

  function say(text, sub, secs) {
    bannerText = text; bannerSub = sub; bannerT = secs;
  }

  const seats = () => [...engine.players.keys()].sort((a, b) => a - b);
  const panelIndex = seat => seats().indexOf(seat);

  /* ------------------------------------------------------------ results --- */

  function showResults() {
    const res = engine.results();
    const list = $('#podium');
    list.innerHTML = '';
    res.forEach(r => {
      const li = document.createElement('li');
      li.className = 'result place-' + r.place;
      li.style.setProperty('--pc', PLAYER_COLORS[r.color % 4].hex);
      li.innerHTML = `<span class="place"></span><span class="who"></span><span class="amt"></span>`;
      li.querySelector('.place').textContent = '#' + r.place;
      li.querySelector('.who').textContent = r.name;
      li.querySelector('.amt').textContent = '$' + r.earned;
      list.appendChild(li);
    });
    $('#results-sub').textContent = res.length
      ? `${res[0].name} shipped the most gizmos.` : '';
    show('results');
    host.over(res);
  }

  $('#again-btn').addEventListener('click', () => {
    started = false;
    engine.resetToLobby();
    host.setPhase('lobby');
    for (const s of host.players) s.ready = false;
    host.broadcastRoster();
    syncAll();
    paintLobby();
    show('lobby');
  });

  /* --------------------------------------------------------------- loop --- */

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    engine.step(dt);
    if (bannerT > 0) bannerT -= dt;

    if (document.body.dataset.screen === 'floor') {
      const ids = seats();
      const wrap = $('#stage-wrap').getBoundingClientRect();
      stage.autoFit(Math.max(1, ids.length), Math.max(80, wrap.width), Math.max(90, wrap.height));

      stage.update(dt);
      stage.begin();

      const board = engine.board();
      ids.forEach((seat, i) => {
        const p = engine.players.get(seat);
        const rank = board.findIndex(b => b.seat === seat) + 1;
        drawPanel(stage, engine.viewOfSeat(seat), stage.panelRect(i), {
          name: p.name,
          color: PLAYER_COLORS[p.color % 4],
          earned: Math.round(p.f.earned),
          ghost: !p.connected,
          note: noteFor(p, rank),
          noteColor: rank === 1 ? '#ffe9a8' : '#9aa5c4',
        });
      });

      if (bannerT > 0) banner(stage, bannerText, bannerSub);
      stage.end();

      $('#floor-round').textContent = engine.phase === 'over'
        ? 'FINAL' : `ROUND ${engine.round} / ${engine.cfg.rounds}`;
      $('#floor-phase').textContent = {
        plan: 'PLANNING', run: 'SHIPPING', tally: 'TALLY', shop: 'WORKSHOP', over: 'DONE',
      }[engine.phase] || '';
      $('#floor-timer').textContent = engine.phase === 'over'
        ? '' : String(Math.max(0, Math.ceil(engine.timer))).padStart(2, '0');
    }

    if (now - lastSend > SEND_MS && engine.phase !== 'lobby') {
      lastSend = now;
      for (const seat of engine.players.keys()) {
        const msg = engine.stateFor(seat);
        if (msg) host.sendTo(seat, msg);
      }
    }
  }

  function noteFor(p, rank) {
    if (engine.phase === 'plan') return p.planReady ? 'READY' : 'PLANNING…';
    if (engine.phase === 'shop') return p.shop?.done ? 'READY' : 'SHOPPING…';
    if (engine.phase === 'tally') return '+$' + p.lastIncome;
    return rank === 1 ? 'LEADING' : '';
  }

  host.open();
  raf = requestAnimationFrame(frame);

  const api = { host, engine, stage, stop() { cancelAnimationFrame(raf); host.destroy(); } };
  window.__gizmo = api;   // debug handle: window.__gizmo.engine.cfg is live
  return api;
}
