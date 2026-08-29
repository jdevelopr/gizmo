/**
 * game.js — the match engine: rounds, the shop, and per-player bookkeeping.
 *
 * It knows nothing about the network or the DOM. The host wires it to PeerJS and
 * practice mode wires it to itself, so both run identical rules.
 */

import {
  createFactory, starterKit, stepFactory, beginRound, endRound, moveSeller,
  applyAction, giveMachine, viewOf, drainFx,
} from './sim.js';
import {
  rollShop, rng, price, label, describe, TYPES, DIR_NAME,
} from './machines.js';

export const DEFAULT_CFG = {
  rounds: 8,
  roundSecs: 45,
  shopSecs: 30,
  introSecs: 6,
  tallySecs: 3.5,
  cash: 40,
  rerollBase: 6,
};

export function createEngine(cfgIn = {}) {
  const cfg = { ...DEFAULT_CFG, ...cfgIn };
  const listeners = {};
  const on = (ev, fn) => ((listeners[ev] ||= []).push(fn), api);
  const emit = (ev, ...a) => (listeners[ev] || []).forEach(fn => fn(...a));

  /** @type {Map<number, any>} seat -> player record */
  const players = new Map();
  const rnd = rng(Date.now() & 0xffffffff);

  let phase = 'lobby';
  let timer = 0;
  let round = 0;
  let announce = '';

  function addPlayer(seat, name, color) {
    let p = players.get(seat);
    if (p) {
      p.name = name || p.name;
      if (color != null) p.color = color;
      p.connected = true;
      return p;
    }
    const f = createFactory({ cash: cfg.cash });
    starterKit(f);
    p = {
      seat, name: name || `Player ${seat + 1}`, color: color ?? seat,
      f, shop: null, connected: true, note: null, noteT: 0, outbox: [],
      lastIncome: 0, bestIncome: 0,
    };
    players.set(seat, p);
    return p;
  }

  const removePlayer = seat => players.delete(seat);
  const setConnected = (seat, v) => { const p = players.get(seat); if (p) p.connected = v; };

  function setColor(seat, color) {
    const taken = [...players.values()].some(p => p.seat !== seat && p.color === color);
    if (taken) return false;
    const p = players.get(seat);
    if (!p) return false;
    p.color = color;
    return true;
  }

  /* ------------------------------------------------------------- phases --- */

  function go(next) {
    phase = next;
    switch (next) {
      case 'intro': {
        timer = cfg.introSecs;
        for (const p of players.values()) {
          // Round one leaves the seller where the starter kit already points, so
          // the first round teaches the loop instead of punishing it.
          const spot = round <= 1
            ? { cell: p.f.seller.cell, dir: p.f.seller.dir }
            : moveSeller(p.f);
          p.f.running = false;
          p.shop = null;
          p.sellerSpot = spot;
        }
        announce = `ROUND ${round}`;
        break;
      }
      case 'run':
        timer = cfg.roundSecs;
        for (const p of players.values()) beginRound(p.f);
        announce = '';
        break;
      case 'tally':
        timer = cfg.tallySecs;
        for (const p of players.values()) {
          endRound(p.f);
          p.lastIncome = p.f.income;
          p.bestIncome = Math.max(p.bestIncome, p.f.income);
        }
        announce = 'ROUND OVER';
        break;
      case 'shop':
        timer = cfg.shopSecs;
        for (const p of players.values()) {
          p.shop = { opts: rollShop(rnd, round), bought: false, rerolls: 0, done: false };
        }
        announce = 'WORKSHOP';
        break;
      case 'over':
        timer = 0;
        announce = 'FINAL';
        emit('over', results());
        break;
    }
    emit('phase', phase, { round, announce });
  }

  function startGame() {
    round = 1;
    for (const p of players.values()) {
      p.f = createFactory({ cash: cfg.cash });
      starterKit(p.f);
      p.lastIncome = 0;
      p.bestIncome = 0;
    }
    go('intro');
  }

  function resetToLobby() {
    phase = 'lobby';
    round = 0;
    timer = 0;
    for (const p of players.values()) {
      p.f = createFactory({ cash: cfg.cash });
      starterKit(p.f);
      p.shop = null;
      p.lastIncome = 0;
      p.bestIncome = 0;
    }
    emit('phase', phase, { round, announce: '' });
  }

  /* --------------------------------------------------------------- step --- */

  function step(dt) {
    if (phase !== 'lobby' && phase !== 'over') timer = Math.max(0, timer - dt);

    for (const p of players.values()) {
      stepFactory(p.f, dt);
      if (p.noteT > 0) { p.noteT -= dt; if (p.noteT <= 0) p.note = null; }
      const fx = drainFx(p.f);
      if (fx.length) { p.outbox.push(...fx); emit('fx', p.seat, fx); }
      if (p.outbox.length > 60) p.outbox.splice(0, p.outbox.length - 60);
    }

    if (timer <= 0) {
      if (phase === 'intro') go('run');
      else if (phase === 'run') go('tally');
      else if (phase === 'tally') go('shop');
      else if (phase === 'shop') nextRound();
    } else if (phase === 'shop' && players.size && [...players.values()].every(p => !p.connected || p.shop?.done)) {
      nextRound();
    }
  }

  function nextRound() {
    round++;
    if (round > cfg.rounds) go('over');
    else go('intro');
  }

  /* ------------------------------------------------------------ actions --- */

  function note(p, text) { p.note = text; p.noteT = 2; }

  function action(seat, msg) {
    const p = players.get(seat);
    if (!p || !msg) return;

    if (msg.t === 'act') {
      if (phase === 'lobby' || phase === 'over') return;
      const r = applyAction(p.f, msg.a);
      if (!r.ok || r.msg) note(p, r.msg || '');
      return;
    }

    if (msg.t === 'buy') {
      if (phase !== 'shop' || !p.shop) return note(p, 'Shop is closed');
      if (p.shop.bought) return note(p, 'One machine per round');
      const spec = p.shop.opts[msg.i];
      if (!spec) return;
      const cost = spec.cost ?? price(spec);
      if (p.f.cash < cost) return note(p, `Need $${cost}`);
      p.f.cash -= cost;
      p.shop.bought = true;
      const dest = giveMachine(p.f, spec);
      note(p, dest.where === 'grid' ? `${label(spec)} installed` :
        dest.where === 'inv' ? `${label(spec)} to crate` : 'No room anywhere');
      p.f.fx.push({ k: 'up', cell: dest.where === 'grid' ? dest.idx : 4 });
      return;
    }

    if (msg.t === 'reroll') {
      if (phase !== 'shop' || !p.shop) return;
      const cost = cfg.rerollBase + p.shop.rerolls * 3;
      if (p.f.cash < cost) return note(p, `Reroll costs $${cost}`);
      p.f.cash -= cost;
      p.shop.rerolls++;
      p.shop.opts = rollShop(rnd, round);
      return;
    }

    if (msg.t === 'done') {
      if (phase === 'shop' && p.shop) p.shop.done = true;
      return;
    }
  }

  /* -------------------------------------------------------------- output --- */

  function board() {
    return [...players.values()]
      .map(p => ({
        seat: p.seat, name: p.name, color: p.color,
        earned: Math.round(p.f.earned), income: Math.round(p.f.income),
        last: p.lastIncome, connected: p.connected,
      }))
      .sort((a, b) => b.earned - a.earned);
  }

  function results() {
    return board().map((r, i) => ({ ...r, place: i + 1 }));
  }

  function shopView(p) {
    if (!p.shop) return null;
    return {
      opts: p.shop.opts.map(s => ({
        kind: s.kind, mut: s.mut, dir: s.dir,
        name: label(s), desc: describe(s), cost: s.cost ?? price(s),
        tint: s.kind === 'mut' ? TYPES[s.mut].color : null,
      })),
      bought: p.shop.bought,
      done: p.shop.done,
      reroll: cfg.rerollBase + p.shop.rerolls * 3,
    };
  }

  /** The message one phone receives. Also what practice mode feeds its own UI. */
  function stateFor(seat) {
    const p = players.get(seat);
    if (!p) return null;
    const msg = {
      t: 'state',
      v: viewOf(p.f),
      fx: p.outbox.splice(0, p.outbox.length),
      hud: {
        ph: phase, tm: Math.round(timer * 10) / 10, r: round, rs: cfg.rounds,
        an: announce, board: board(), note: p.note,
        seat, color: p.color, name: p.name,
        spot: p.sellerSpot ? DIR_NAME[p.sellerSpot.dir] : null,
      },
      shop: shopView(p),
    };
    return msg;
  }

  const api = {
    on, cfg, players, addPlayer, removePlayer, setConnected, setColor,
    startGame, resetToLobby, step, action, stateFor, board, results,
    get phase() { return phase; },
    get timer() { return timer; },
    get round() { return round; },
    get announce() { return announce; },
    viewOfSeat: seat => { const p = players.get(seat); return p ? viewOf(p.f) : null; },
  };
  return api;
}
