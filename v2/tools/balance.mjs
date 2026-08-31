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
    if (eng.phase === 'shop' && shopDone !== eng.round) { shopDone = eng.round; goShopping(eng); }
    if (eng.phase === 'tally' && eng.round !== last) {
      last = eng.round;
      const p = eng.players.get(0);
      rounds.push({
        r: eng.round, inc: p.lastIncome, claim: p.f.claim,
        tgt: p.order?.target ?? 0, met: !!p.metOrder, cash: Math.round(p.f.cash),
      });
    }
  }
  const p = eng.players.get(0);
  return { rounds, earned: Math.round(p.f.earned), claim: p.f.claim, filled: p.filled };
}

/**
 * Buy the best thing affordable, then actually put it in the line.
 *
 * The bot used to leave purchases wherever they landed, which on a fresh row was
 * nowhere useful — so its income never moved and the harness could not tell an
 * affordable economy from an unaffordable one. Now it slots each machine into the
 * top row in place of a conveyor, which is the crudest version of what a person
 * does and enough to make the ramp visible.
 */
function goShopping(eng) {
  const p = eng.players.get(0), f = p.f;
  const sh = eng.stateFor(0).shop;
  if (sh) {
    // Only what a single-file line can actually use. A Fuser needs two feeds and a
    // Trident fires into three directions; dropping either into one row throttles
    // it to nothing, which is bad play rather than a bad economy — and the harness
    // is here to measure the economy.
    //
    // Buy the richest Mutator the line can actually keep fed. Buying the most
    // expensive one it could afford was the bot's own worst habit: a Prism Mutator
    // takes 62 seconds a gizmo, so dropping one into a line delivering one a second
    // throttles everything behind it to nothing. Matching the machine to the feed
    // is the single most important thing a player learns, and a harness that does
    // not do it measures the wrong game.
    const feed = 2 / M.producerCycle(f.producer.level);   // gizmos/s reaching the line
    const affordable = sh.opts.map((o, i) => ({ i, o }))
      .filter(x => x.o.kind === 'mut' && x.o.cost <= f.cash
        && M.MUT_CYCLE[x.o.mut] <= (1 / feed) * 1.15);
    const best = affordable.sort((a, b) => b.o.cost - a.o.cost)[0];
    if (best) {
      const had = new Set(f.grid.map((m, i) => (m ? i : -1)).filter(i => i >= 0));
      eng.action(0, { t: 'buy', i: best.i });
      const at = f.grid.findIndex((m, i) => m && !had.has(i));
      if (at >= 0) placeInLine(eng, f, at);
    }
  }
  eng.action(0, { t: 'done' });
}

/** Swap a freshly bought machine into the top row, displacing a conveyor. */
function placeInLine(eng, f, at) {
  if (M.cy(at) === 0) return;                       // already in the line
  for (let x = 1; x < f.claim; x++) {
    const target = M.cellOf(x, 0);
    if (f.grid[target]?.kind !== 'pipe') continue;
    eng.action(0, { t: 'act', a: { a: 'move', from: 'g' + at, to: 'g' + target } });
    return;
  }
}

/**
 * An ordinary player's priorities, in order: raw throughput first, then the line
 * it feeds, then land, then plumbing. Deliberately not optimal — it never routes a
 * second arm, never builds a recipe chain and never uses the Sorter, so what it
 * earns is close to the floor of competent play rather than the ceiling.
 */
const ordinary = eng => {
  const p = eng.players.get(0), f = p.f;
  const cash = () => f.cash;

  // Land first. With the catalogue there is always something to spend on, so a bot
  // that buys machines before slots simply never grows — and neither would a player.
  if (f.claim < M.GRID && cash() > M.expandCost(f.claim) * 1.2) eng.action(0, { t: 'expand' });

  for (let k = 0; k < 4; k++) {
    const pc = M.producerCost(f.producer.level);
    if (f.producer.level >= M.MAX_UTIL || cash() < pc * 1.5) break;
    eng.action(0, { t: 'act', a: { a: 'upprod' } });
  }
  for (let x = 0; x < f.claim; x++) {
    const m = f.grid[x];
    if (!m || m.level >= 3 || m.kind === 'pipe') continue;
    if (cash() > M.upgradeCost(m) * 2) eng.action(0, { t: 'act', a: { a: 'up', ref: 'g' + x } });
  }
  const sc = M.sellerCost(f.seller.level);
  if (f.seller.level < M.MAX_UTIL && cash() > sc * 2.5) eng.action(0, { t: 'act', a: { a: 'upsell' } });

  // Belts only to reach the fence the vault just rode out to. Buying them for
  // their own sake is how the bot used to spend itself broke.
  const vault = f.seller.spots[0];
  for (let x = 0; x < f.claim && cash() > 40; x++) {
    const cell = M.cellOf(x, M.cy(vault.cell));
    if (f.grid[cell]) continue;
    const before = cash();
    eng.action(0, { t: 'route', k: 'pipe' });
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
console.log('final claim:', rs.map(x => x.claim).join(','),
  ' orders filled:', rs.map(x => x.filled).join(','));
const first = rs.map(x => x.rounds[0]?.inc ?? 0), lastR = rs.map(x => x.rounds.at(-1)?.inc ?? 0);
const avg = a => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
console.log(`income R1 ${avg(first)} -> R${cfg.rounds} ${avg(lastR)}  (x${(avg(lastR) / (avg(first) || 1)).toFixed(1)} over the match)`);
