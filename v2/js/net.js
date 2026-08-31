/**
 * net.js — host-authoritative PeerJS networking for local multiplayer.
 *
 * The host owns state and broadcasts it. Clients send inputs only.
 * Seats are keyed by a persistent clientId in localStorage, so a dropped player
 * who reopens the join link resumes with their seat, name, and score intact.
 *
 * Based on the reference module, with three additions for this game:
 *   - the host emits `roster` locally so the floor screen can redraw the lobby
 *   - clients emit `msg` for message types the module does not model itself
 *   - joins after the game has started are refused unless the seat already exists
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1/L
const CODE_LENGTH = 4;
const HELLO_TIMEOUT_MS = 10000;
const REAP_AFTER_MS = 180000;

export function makeRoomCode(n = CODE_LENGTH) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function clientId() {
  let id = localStorage.getItem('cid');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    localStorage.setItem('cid', id);
  }
  return id;
}

export function joinUrl(code) {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

export function roomFromUrl() {
  const r = new URLSearchParams(location.search).get('room');
  return r ? r.trim().toUpperCase() : null;
}

const peerIdFor = (slug, code) => `${slug}-${code.toUpperCase()}`;

/* ------------------------------------------------------------------ host --- */

export function createHost({ slug, maxPlayers = 8, peerOptions = {} } = {}) {
  const listeners = {};
  const on = (ev, fn) => ((listeners[ev] ||= []).push(fn), api);
  const emit = (ev, ...a) => (listeners[ev] || []).forEach(fn => fn(...a));

  const seats = new Map();
  let peer = null;
  let code = null;
  let phase = 'lobby';
  let attempts = 0;

  const roster = () =>
    [...seats.values()]
      .sort((a, b) => a.seat - b.seat)
      .map(({ seat, name, ready, score, connected, meta }) =>
        ({ seat, name, ready, score, connected, meta }));

  function open() {
    code = makeRoomCode();
    peer = new Peer(peerIdFor(slug, code), peerOptions);

    peer.on('open', () => emit('open', code));
    peer.on('connection', wire);
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('error', err => {
      // Room code collided on a shared broker — pick another and retry.
      if (err.type === 'unavailable-id' && attempts++ < 5) {
        try { peer.destroy(); } catch {}
        return open();
      }
      emit('error', err);
    });
  }

  function wire(conn) {
    let entry = null;
    const helloTimer = setTimeout(() => { if (!entry) conn.close(); }, HELLO_TIMEOUT_MS);

    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.t === 'hello') {
        clearTimeout(helloTimer);
        entry = admit(conn, msg);
        if (entry) { emit('hello', entry.seat); broadcastRoster(); }
        return;
      }
      if (!entry) return; // no identity yet, ignore

      if (msg.t === 'bye') {
        drop();
        try { conn.close(); } catch {}
        return;
      }
      if (msg.t === 'ready') {
        entry.ready = !!msg.ready;
        broadcastRoster();
        emit('ready', entry.seat, entry.ready);
      } else if (msg.t === 'input') {
        emit('input', entry.seat, msg.payload);
      } else {
        emit('message', entry.seat, msg);
      }
    });

    function drop() {
      clearTimeout(helloTimer);
      if (!entry) return;
      entry.connected = false;
      entry.goneAt = Date.now();
      entry.conn = null;
      emit('leave', entry.seat);
      broadcastRoster();
    }
    conn.on('close', drop);
    conn.on('error', drop);
  }

  function admit(conn, msg) {
    const cid = String(msg.clientId || '');
    if (!cid) { safeSend(conn, { t: 'rejected', reason: 'Bad handshake' }); return null; }

    let entry = seats.get(cid);

    if (entry) {
      // Returning player: same seat, same score.
      entry.conn = conn;
      entry.connected = true;
      entry.goneAt = null;
      if (msg.name) entry.name = String(msg.name).slice(0, 12);
    } else {
      if (phase !== 'lobby') {
        safeSend(conn, { t: 'rejected', reason: 'That game has already started' });
        setTimeout(() => conn.close(), 100);
        return null;
      }
      if (seats.size >= maxPlayers) {
        safeSend(conn, { t: 'rejected', reason: 'Room is full' });
        setTimeout(() => conn.close(), 100);
        return null;
      }
      entry = {
        seat: nextSeat(), cid,
        name: String(msg.name || `Player ${seats.size + 1}`).slice(0, 12),
        ready: false, score: 0, conn, connected: true, goneAt: null, meta: {},
      };
      seats.set(cid, entry);
    }

    safeSend(conn, { t: 'welcome', seat: entry.seat, phase, players: roster() });
    return entry;
  }

  function nextSeat() {
    const taken = new Set([...seats.values()].map(s => s.seat));
    for (let i = 0; i < maxPlayers; i++) if (!taken.has(i)) return i;
    return seats.size;
  }

  function broadcastRoster() {
    const list = roster();
    broadcast({ t: 'lobby', players: list });
    emit('roster', list);
  }

  function broadcast(msg) {
    for (const s of seats.values()) if (s.connected) safeSend(s.conn, msg);
  }

  function sendTo(seat, msg) {
    const s = [...seats.values()].find(x => x.seat === seat);
    if (s?.connected) safeSend(s.conn, msg);
  }

  function seatOf(seat) {
    return [...seats.values()].find(x => x.seat === seat) || null;
  }

  /** Remove players who have been gone longer than REAP_AFTER_MS. Call between rounds. */
  function reap(ms = REAP_AFTER_MS) {
    const now = Date.now();
    let changed = false;
    for (const [cid, s] of seats)
      if (!s.connected && s.goneAt && now - s.goneAt > ms) { seats.delete(cid); changed = true; }
    if (changed) broadcastRoster();
  }

  const api = {
    on, open, broadcast, sendTo, seatOf, reap, roster, broadcastRoster,
    get code() { return code; },
    get joinUrl() { return code ? joinUrl(code) : null; },
    get players() { return [...seats.values()]; },
    get phase() { return phase; },
    allReady: () => seats.size > 0 && [...seats.values()].every(s => s.ready && s.connected),
    setPhase(p) { phase = p; },
    start(state) { phase = 'playing'; broadcast({ t: 'start', state }); },
    state(state) { broadcast({ t: 'state', ...state }); },
    event(name, data) { broadcast({ t: 'event', name, data }); },
    over(results) { phase = 'over'; broadcast({ t: 'over', results }); },
    destroy() { try { peer?.destroy(); } catch {} },
  };
  return api;
}

/* ---------------------------------------------------------------- client --- */

export function createClient({ slug, code, name, peerOptions = {} } = {}) {
  const listeners = {};
  const on = (ev, fn) => ((listeners[ev] ||= []).push(fn), api);
  const emit = (ev, ...a) => (listeners[ev] || []).forEach(fn => fn(...a));

  let peer = null, conn = null, seat = null, timer = null;
  const queue = [];

  function connect() {
    peer = new Peer(undefined, peerOptions); // auto id; host never dials back

    peer.on('open', () => {
      conn = peer.connect(peerIdFor(slug, code), { reliable: true });

      timer = setTimeout(() => {
        if (!conn?.open) emit('error', new Error('Could not reach that room. Check the code, or the host may have closed it.'));
      }, HELLO_TIMEOUT_MS);

      conn.on('open', () => {
        clearTimeout(timer);
        safeSend(conn, { t: 'hello', clientId: clientId(), name });
        while (queue.length) safeSend(conn, queue.shift());
        emit('connected');
      });

      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'welcome') { seat = msg.seat; emit('welcome', msg); }
        else if (msg.t === 'rejected') emit('rejected', msg.reason);
        else if (msg.t === 'lobby') emit('lobby', msg.players);
        else if (msg.t === 'start') emit('start', msg.state);
        else if (msg.t === 'state') emit('state', msg);
        else if (msg.t === 'event') emit('event', msg);
        else if (msg.t === 'over') emit('over', msg.results);
        else emit('msg', msg);
      });

      conn.on('close', () => emit('disconnected'));
      conn.on('error', err => emit('error', err));
    });

    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('error', err => emit('error', err));
  }

  function send(msg) {
    if (conn?.open) safeSend(conn, msg);
    else queue.push(msg); // sends before open are silently dropped by PeerJS
  }

  const api = {
    on, connect, send,
    input: payload => send({ t: 'input', payload }),
    ready: v => send({ t: 'ready', ready: !!v }),
    get seat() { return seat; },
    get open() { return !!conn?.open; },
    destroy() { clearTimeout(timer); try { peer?.destroy(); } catch {} },
  };
  return api;
}

/* ---------------------------------------------------------------- shared --- */

// Class instances, Map, Set, and functions do not survive the wire — send plain data.
function safeSend(conn, msg) {
  try { conn?.open && conn.send(msg); } catch (e) { console.warn('send failed', e); }
}
