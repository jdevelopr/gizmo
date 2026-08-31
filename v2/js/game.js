/**
 * game.js — the match engine: rounds, the shop, and per-player bookkeeping.
 *
 * It knows nothing about the network or the DOM. The host wires it to PeerJS and
 * practice mode wires it to itself, so both run identical rules.
 */

import {
  createFactory, starterKit, stepFactory, beginRound, endRound,
  expandFloor, applyAction, giveMachine, viewOf, drainFx,
} from './sim.js';
import {
  rollShop, rng, price, label, describe, setGridSize, GRID,
  routeCost, moverFree, ROUTE_KINDS, KINDS, TYPES, DIR_NAME,
  CLAIM_START, expandCost, firstOrder, nextOrder, orderBonus, SECOND_VAULT_CLAIM,
  RECIPES, RESIN_CLAIM,
} from './machines.js';

/**
 * The machines you can always buy. None of them makes a gizmo worth more — they
 * only decide where it goes — so they sit outside the workshop's one-a-round limit
 * and share a single price ladder. See ROUTE_KINDS in machines.js.
 */
const ROUTE_SPEC = { pipe: { kind: 'pipe', dir: 0 }, bal: { kind: 'bal', dir: 0 },
  sort: { kind: 'sort', dir: 0, mut: 1 } };

export const DEFAULT_CFG = {
  rounds: 8,
  roundSecs: 90,
  shopSecs: 30,
  planSecs: 120,      // planning phase: extend the line, spend, expand, ready up
  gridSize: 7,        // the full plot; you start owning 3x3 of it and buy the rest
  tallySecs: 3.5,
  cash: 200,           // enough to open with a machine and a ring of land, not both twice
  rerollBase: 15,
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

  /**
   * Every player carries their own order, measured against their own best round.
   * See the note in machines.js: the shared question is "is your factory bigger
   * than it was", which is the only version of that question that means the same
   * thing to a first-timer and to someone on their fourth match.
   */
  const openOrder = p => ({
    target: firstOrder(cfg.roundSecs),
    bonus: orderBonus(firstOrder(cfg.roundSecs)),
  });

  function setOrder(p) {
    if (!p.order || round <= 1) { p.order = openOrder(p); return; }
    const target = nextOrder(p.order.target, p.bestIncome || 0);
    p.order = { target, bonus: orderBonus(target) };
  }

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
      lastIncome: 0, bestIncome: 0, movers: 0, filled: 0, bonuses: 0,
      order: null,
    };
    p.order = openOrder(p);
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
      case 'plan': {
        timer = cfg.planSecs;
        // No goalposts move here. The vaults are welded to the east face of each
        // player's claim and only ever ride outward when that player buys land, so
        // planning is about extending the factory rather than rescuing it.
        for (const p of players.values()) {
          setOrder(p);
          p.metOrder = false;
          p.orderBonus = 0;
          p.f.running = false;
          p.shop = null;
          p.planReady = false;
          p.movers = 0;              // belts bought this round, for the price ladder
          p.sellerSpots = p.f.seller.spots.map(v => ({ cell: v.cell, dir: v.dir }));
        }
        announce = `ROUND ${round}`;
        break;
      }
      case 'run':
        timer = cfg.roundSecs;
        for (const p of players.values()) { beginRound(p.f); p.planReady = false; }
        announce = '';
        break;
      case 'tally':
        timer = cfg.tallySecs;
        for (const p of players.values()) {
          endRound(p.f);
          p.lastIncome = p.f.income;
          p.bestIncome = Math.max(p.bestIncome, p.f.income);
          // The order board is pure upside: filling it pays a bonus, missing it
          // costs nothing but the bonus. Nobody gets buried by one bad round.
          const tgt = p.order?.target ?? 0;
          p.metOrder = p.f.income >= tgt;
          p.orderBonus = 0;
          if (p.metOrder) {
            const b = p.order.bonus;
            p.orderBonus = b;
            p.f.cash += b;
            p.f.earned += b;
            p.filled++;
            p.bonuses += b;
            p.f.fx.push({ k: 'order', v: b });
          }
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
    // Set the plot before any factory is built. Every player owns CLAIM_START of
    // it to begin with and buys their way out toward this fence at their own pace.
    setGridSize(cfg.gridSize);
    for (const p of players.values()) {
      p.f = createFactory({ cash: cfg.cash, claim: Math.min(CLAIM_START, cfg.gridSize) });
      starterKit(p.f);
      p.lastIncome = 0;
      p.bestIncome = 0;
      p.movers = 0;
      p.filled = 0;
      p.bonuses = 0;
      p.order = null;
    }
    go('plan');
  }

  function resetToLobby() {
    phase = 'lobby';
    round = 0;
    timer = 0;
    setGridSize(cfg.gridSize);
    for (const p of players.values()) {
      p.f = createFactory({ cash: cfg.cash, claim: Math.min(CLAIM_START, cfg.gridSize) });
      starterKit(p.f);
      p.shop = null;
      p.lastIncome = 0;
      p.bestIncome = 0;
      p.filled = 0;
      p.bonuses = 0;
      p.order = openOrder(p);
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
      if (phase === 'plan') go('run');
      else if (phase === 'run') go('tally');
      else if (phase === 'tally') go('shop');
      else if (phase === 'shop') nextRound();
    } else if (phase === 'plan' && everyone(p => p.planReady)) {
      // Nobody is still planning: start the round rather than burn the clock.
      go('run');
    } else if (phase === 'shop' && everyone(p => p.shop?.done)) {
      nextRound();
    }
  }

  /** What the next routing machine of each kind costs this player, right now. */
  const routePrices = p => Object.fromEntries(ROUTE_KINDS.map(k => [
    k, routeCost(k, Math.max(1, round), p?.movers || 0, p?.f?.claim ?? CLAIM_START),
  ]));
  const nextMover = p => routePrices(p).pipe;

  /** True when every connected player satisfies the test (and there is at least one). */
  function everyone(test) {
    const live = [...players.values()].filter(p => p.connected);
    return live.length > 0 && live.every(test);
  }

  function nextRound() {
    round++;
    if (round > cfg.rounds) go('over');
    else go('plan');
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
      if (dest.where === 'none') {           // floor and crate both full: nothing sold
        p.f.cash += cost;
        p.shop.bought = false;
        return note(p, 'No room anywhere');
      }
      note(p, dest.where === 'grid' ? `${label(spec)} installed` : `${label(spec)} to crate`);
      p.f.fx.push({ k: 'up', cell: dest.where === 'grid' ? dest.idx : 4 });
      return;
    }

    /**
     * Conveyors are plumbing, not profit: without one you cannot reach a seller
     * that has jumped to the far side, so they are on sale in every phase and do
     * not count against the one machine a round from the workshop.
     */
    if (msg.t === 'mover' || msg.t === 'route') {
      if (phase === 'lobby' || phase === 'over') return;
      const kind = msg.t === 'mover' ? 'pipe' : String(msg.k || 'pipe');
      if (!ROUTE_KINDS.includes(kind)) return;
      const cost = routePrices(p)[kind];
      const name = KINDS[kind].name;
      if (p.f.cash < cost) return note(p, `${name} costs $${cost}`);
      const dest = giveMachine(p.f, ROUTE_SPEC[kind]);
      if (dest.where === 'none') return note(p, 'No room anywhere');
      p.f.cash -= cost;
      p.movers = (p.movers || 0) + 1;
      const left = Math.max(0, moverFree(p.f.claim) - p.movers);
      note(p, dest.where === 'grid'
        ? (left ? `${name} installed · ${left} cheap left` : `${name} installed`)
        : `${name} to crate`);
      p.f.fx.push({ k: 'up', cell: dest.where === 'grid' ? dest.idx : 4 });
      return;
    }

    /**
     * Buy the next ring of land. Planning only: growing moves the vaults out to
     * the new fence, and doing that mid-round would sell gizmos already in flight
     * into a wall. It is not a workshop purchase and does not use up the round's
     * one machine — land is not a machine.
     */
    if (msg.t === 'expand') {
      if (phase !== 'plan') return note(p, 'Buy land while planning');
      if (p.f.claim >= GRID) return note(p, 'You own the whole plot');
      const cost = expandCost(p.f.claim);
      if (p.f.cash < cost) return note(p, `Land costs $${cost}`);
      p.f.cash -= cost;
      const n = expandFloor(p.f);
      p.sellerSpots = p.f.seller.spots.map(v => ({ cell: v.cell, dir: v.dir }));
      note(p, n === RESIN_CLAIM ? `${n}x${n} — a Resin feed opened`
        : n === SECOND_VAULT_CLAIM ? `${n}x${n} — a second vault opened`
          : `${n}x${n} — the vault moved out`);
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

    if (msg.t === 'plan') {
      if (phase !== 'plan') return;
      p.planReady = msg.v !== false;
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
        claim: p.f.claim, filled: p.filled || 0,
        met: phase === 'tally' ? !!p.metOrder : undefined,
        ready: phase === 'plan' ? !!p.planReady : !!p.shop?.done,
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
        tint: s.kind === 'mut' ? TYPES[s.mut].color
          : s.kind === 'asm' ? TYPES[RECIPES[s.mut ?? 0].out].color : null,
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
        n: GRID,
        an: announce, board: board(), note: p.note,
        ready: !!p.planReady,
        mover: nextMover(p),
        routes: routePrices(p),
        moverLeft: Math.max(0, moverFree(p.f.claim) - (p.movers || 0)),
        claim: p.f.claim, plot: GRID,
        expand: p.f.claim < GRID ? expandCost(p.f.claim) : 0,
        order: { target: p.order?.target ?? 0, bonus: p.order?.bonus ?? 0 },
        met: !!p.metOrder, gotBonus: p.orderBonus || 0,
        waiting: [...players.values()].filter(x => x.connected && !x.planReady).length,
        seat, color: p.color, name: p.name,
        spots: (p.sellerSpots || []).map(v => DIR_NAME[v.dir]),
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
    orderOf: seat => players.get(seat)?.order || null,
    viewOfSeat: seat => { const p = players.get(seat); return p ? viewOf(p.f) : null; },
  };
  return api;
}
