/**
 * balance.mjs — the order-board calibrator.
 *
 * Runs an ordinary (deliberately not optimal) bot through whole matches and
 * reports what it actually shipped each round. The order curve in machines.js is
 * meant to sit a little under this: a target you hit by playing well rather than
 * by playing perfectly. Run it after touching any number in machines.js.
 *
 *   node tools/balance.mjs
 */
import { createEngine } from '../js/game.js';
import * as M from '../js/machines.js';

function run(cfg, play) {
  const eng = createEngine(cfg);
  eng.addPlayer(0, 'BOT', 0);
  eng.startGame();
  const rounds = [];
  let last = 0, planDone = -1, shopDone = -1, t = 0;
  const dt = 1 / 20;
  while (eng.phase !== 'over' && t < 20000) {
    eng.step(dt); t += dt;
    if (eng.phase === 'plan' && planDone !== eng.round) { planDone = eng.round; play(eng); }
    if (eng.phase === 'shop' && shopDone !== eng.round) {
      shopDone = eng.round;
      const p = eng.players.get(0), sh = eng.stateFor(0).shop;
      if (sh) {
        const best = sh.opts.map((o, i) => ({ i, c: o.cost }))
          .filter(o => o.c <= p.f.cash * 0.7).sort((a, b) => b.c - a.c)[0];
        if (best) eng.action(0, { t: 'buy', i: best.i });
      }
      eng.action(0, { t: 'done' });
    }
    if (eng.phase === 'tally' && eng.round !== last) {
      last = eng.round;
      const p = eng.players.get(0);
      rounds.push({ r: eng.round, inc: p.lastIncome, claim: p.f.claim,
        tgt: p.order?.target ?? 0, met: !!p.metOrder });
    }
  }
  const p = eng.players.get(0);
  return { rounds, earned: Math.round(p.f.earned), claim: p.f.claim };
}

/**
 * An ordinary player's priorities, in order: throughput first, then the line it
 * feeds, then land, then plumbing. Deliberately not optimal — it never routes a
 * second arm and never builds a tier ladder, so whatever it earns is close to the
 * floor of competent play rather than the ceiling.
 */
const ordinary = eng => {
  const p = eng.players.get(0);
  const cash = () => p.f.cash;

  for (let k = 0; k < 4; k++) {
    const pc = M.producerCost(p.f.producer.level);
    if (p.f.producer.level >= M.MAX_UTIL || cash() < pc * 1.6) break;
    eng.action(0, { t: 'act', a: { a: 'upprod' } });
  }
  for (let x = 0; x < p.f.claim; x++) {
    const m = p.f.grid[x];
    if (!m || m.level >= 3) continue;
    if (cash() > M.upgradeCost(m) * 2.2) eng.action(0, { t: 'act', a: { a: 'up', ref: 'g' + x } });
  }
  const sc = M.sellerCost(p.f.seller.level);
  if (p.f.seller.level < M.MAX_UTIL && cash() > sc * 2.2) eng.action(0, { t: 'act', a: { a: 'upsell' } });

  if (p.f.claim < M.GRID && cash() > M.expandCost(p.f.claim) * 2.2) eng.action(0, { t: 'expand' });

  for (let k = 0; k < 40; k++) {
    const st = eng.stateFor(0);
    if (cash() < st.hud.mover * 4) break;
    const before = cash();
    eng.action(0, { t: 'mover' });
    if (cash() === before) break;
  }
};

const cfg = { rounds: 8, planSecs: 2, roundSecs: 90, shopSecs: 2, tallySecs: 1, cash: 120, gridSize: 7 };
const N = 7;
const rs = Array.from({ length: N }, () => run(cfg, ordinary));

console.log('round   median   target   hit?   claim   spread');
for (let r = 1; r <= cfg.rounds; r++) {
  const rows = rs.map(x => x.rounds.find(y => y.r === r)).filter(Boolean);
  const xs = rows.map(x => x.inc).sort((a, b) => a - b);
  const med = xs[Math.floor(xs.length / 2)];
  const tgt = Math.round(rows.reduce((a, b) => a + b.tgt, 0) / (rows.length || 1));
  const hit = rows.filter(x => x.met).length;
  const cl = Math.max(...rs.map(x => x.rounds.find(y => y.r === r)?.claim ?? 3));
  console.log(
    String(r).padStart(5), String(med).padStart(8), String(tgt).padStart(8),
    `${hit}/${N}`.padStart(7), String(cl).padStart(7), '   ', xs.join(','),
  );
}
console.log('lifetime:', rs.map(x => x.earned).join(', '));
console.log('final claim:', rs.map(x => x.claim).join(','));
