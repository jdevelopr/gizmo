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
import { layPath, putOnLine, setBotGrid } from './bot.mjs';
setBotGrid(M.GRID);

function run(cfg, play) {
  const eng = createEngine(cfg);
  eng.addPlayer(0, 'BOT', 0);
  eng.startGame();
  const rounds = [];
  let last = 0, planDone = -1, shopDone = -1, t = 0;
  const dt = 1 / 20;
  while (eng.phase !== 'over' && t < 20000) {
    eng.step(dt); t += dt;
    if (eng.phase === 'plan' && planDone !== eng.round) {
      planDone = eng.round;
      shopDone = eng.round;
      play(eng);              // spend and arrange
      goShopping(eng);        // buy and install
      reconnect(eng);         // and only then check the line still reaches the vault
    }
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
    // Buy the Mutator that earns the most, which is not the same as the richest or
    // the fastest. A machine in a single-file line handles the whole stream, so its
    // output is min(what reaches it, what it can process) times what that is worth
    // — and because a Mutator's speed halves as its value doubles, the answer is
    // rarely obvious. Working it out is the single most important thing a player
    // learns, so the harness has to work it out too or it measures the wrong game.
    const feed = 1 / M.producerCycle(f.producer.level);   // gizmos/s reaching the line
    const worth = o => Math.min(feed, 1 / M.MUT_CYCLE[o.mut]) * M.TYPES[o.mut].value;
    const have = f.grid.filter(m => m && m.kind === 'mut')
      .reduce((best, m) => Math.max(best, worth(m)), 0);
    const best = sh.opts.map((o, i) => ({ i, o }))
      .filter(x => x.o.kind === 'mut' && x.o.cost <= f.cash && worth(x.o) > have * 1.05)
      .sort((a, b) => worth(b.o) - worth(a.o))[0];
    if (best) {
      const had = new Set(f.grid.map((m, i) => (m ? i : -1)).filter(i => i >= 0));
      eng.action(0, { t: 'buy', i: best.i });
      const at = f.grid.findIndex((m, i) => m && !had.has(i));
      if (at >= 0) placeInLine(eng, f, at);
    }
  }
}

/**
 * Put a freshly bought Mutator at the far end of the line, and scrap any other.
 *
 * Chaining Mutators is a beginner's mistake the bot used to make every round: each
 * one rewrites the whole stream, so a line of four produces whatever the last one
 * is at the speed of the slowest one. One per line is the correct shape, and the
 * end of the line is where it belongs.
 */
function placeInLine(eng, f, at) {
  putOnLine(eng, 0, f, at, 'mut');
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

};

/**
 * Fill any hole in the line, last thing before the round starts.
 *
 * This has to happen after buying, not before. Claiming land moves the vault out
 * by one and installing a machine at the new end shuffles what was there into the
 * gap behind it — so a floor that looked connected while you were shopping can be
 * one slot short by the time you finish. A single missing belt earns nothing at all
 * for the whole round, which is the harshest cliff in the game and the reason the
 * cheap-belt allowance exists.
 */
function reconnect(eng) {
  const f = eng.players.get(0).f;
  const vault = f.seller.spots[0];
  layPath(eng, 0, f, vault.cell, vault.dir);
}

const cfg = { rounds: 8, planSecs: 3, roundSecs: 90, tallySecs: 1, cash: 200, gridSize: 7 };
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
const avg = a => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
const peak = rs.map(x => Math.max(...x.rounds.map(r => r.inc)));
console.log(`best round ${avg(peak)}  ·  lifetime ${avg(rs.map(x => x.earned))}`);
console.log('note: this bot only ever builds one line, which caps out around $5/s of '
  + 'floor whatever it buys. Growth past that needs parallel arms or recipes, so treat '
  + 'these as the floor of competent play rather than the ceiling.');
