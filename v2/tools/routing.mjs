/**
 * routing.mjs — does the routing family actually route?
 *
 * Three claims worth proving, because all three are easy to get subtly wrong and
 * none of them is visible in a screenshot:
 *   1. A Balancer divides a stream evenly and never inflates it.
 *   2. A Balancer skips an arm that is backed up instead of stalling on it.
 *   3. A Sorter sends its type one way and everything else the other, always —
 *      including when the filtered arm is full, where it must hold rather than
 *      misroute.
 *
 *   node tools/routing.mjs
 */
import { createFactory, stepFactory, beginRound } from '../js/sim.js';
import { makeMachine, cellOf, setGridSize, GRID } from '../js/machines.js';

setGridSize(7);
let fails = 0;
const ok = (c, what, detail = '') => {
  if (!c) { fails++; console.log('  FAIL  ' + what + (detail ? '  ' + detail : '')); }
  else console.log('  ok    ' + what + (detail ? '  ' + detail : ''));
};

const put = (f, x, y, spec) => { f.grid[cellOf(x, y)] = makeMachine(spec, f.nid++); };
const run = (f, secs, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) stepFactory(f, dt); };

/* --- 1 & 2: the balancer ------------------------------------------------- */
{
  // producer -> belt -> BALANCER. East arm runs to the vault; south arm runs to a
  // dead edge, so "sold" counts one exit and "lost" counts the other.
  const f = createFactory({ cash: 0, claim: 3 });
  put(f, 0, 0, { kind: 'pipe', dir: 0 });
  put(f, 1, 0, { kind: 'bal', dir: 0 });
  put(f, 2, 0, { kind: 'pipe', dir: 0 });     // east arm -> vault at (2,0)
  put(f, 1, 1, { kind: 'pipe', dir: 1 });     // south arm -> down
  put(f, 1, 2, { kind: 'pipe', dir: 0 });
  put(f, 2, 2, { kind: 'pipe', dir: 0 });     // -> off the claim, not a vault: lost
  f.producer.level = 5;
  beginRound(f);
  run(f, 90);

  const total = f.sold + f.lost;
  const skew = Math.abs(f.sold - f.lost) / (total || 1);
  ok(total > 20, 'balancer passed a real stream', `${total} gizmos`);
  ok(skew < 0.12, 'balancer divides evenly', `${f.sold} east / ${f.lost} south`);

  // Nothing may be created: at producer level 5 the ceiling is one gizmo per cycle.
  const spawned = Math.ceil(90 / (2.7 * Math.pow(0.78, 4))) + 2;
  ok(total <= spawned, 'balancer never copies', `${total} out, at most ${spawned} in`);
}

/* --- 2: a blocked arm must not stall the other --------------------------- */
{
  const f = createFactory({ cash: 0, claim: 3 });
  put(f, 0, 0, { kind: 'pipe', dir: 0 });
  put(f, 1, 0, { kind: 'bal', dir: 0 });
  put(f, 2, 0, { kind: 'pipe', dir: 0 });     // east arm -> vault
  // South arm is a dead end: a belt pointing back into the balancer's own column
  // with nowhere to go. It fills, and stays full.
  put(f, 1, 1, { kind: 'pipe', dir: 2 });
  put(f, 0, 1, { kind: 'pipe', dir: 3 });
  f.producer.level = 5;
  beginRound(f);
  run(f, 60);
  ok(f.sold > 15, 'blocked arm does not stall the open one', `${f.sold} still reached the vault`);
}

/* --- 3: the sorter ------------------------------------------------------- */
{
  const f = createFactory({ cash: 0, claim: 3 });
  put(f, 1, 1, { kind: 'sort', dir: 0, mut: 1 });   // Copper right (south), rest ahead (east)
  const sorter = f.grid[cellOf(1, 1)];
  f.running = true;

  const seen = { match: {}, pass: {} };
  let fed = 0;
  for (let t = 0; t < 40; t += 1 / 60) {
    // Keep it fed with an even mix, and keep the exits clear so nothing backs up.
    if (sorter.buf.length === 0 && !sorter.work.length) {
      sorter.buf.push({ id: ++fed, ty: fed % 2 ? 1 : 4, cp: 0 });
    }
    stepFactory(f, 1 / 60);
    for (const g of f.gizmos) {
      if (g.from !== cellOf(1, 1)) continue;
      const where = g.cell === cellOf(1, 2) ? 'match' : g.cell === cellOf(2, 1) ? 'pass' : 'stray';
      if (where === 'stray') { ok(false, 'sorter sent a gizmo somewhere unexpected'); continue; }
      seen[where][g.ty] = 1;
    }
    f.gizmos.length = 0;
  }
  const m = Object.keys(seen.match), p = Object.keys(seen.pass);
  ok(m.length === 1 && m[0] === '1', 'only the filtered type takes the side exit', `side: [${m}]`);
  ok(p.length === 1 && p[0] === '4', 'everything else goes straight ahead', `ahead: [${p}]`);
}

/* --- 3b: a full filtered arm makes the sorter hold, never misroute -------- */
{
  const f = createFactory({ cash: 0, claim: 3 });
  put(f, 1, 1, { kind: 'sort', dir: 0, mut: 1 });
  put(f, 1, 2, { kind: 'pipe', dir: 3 });      // side exit points straight back: fills up
  const sorter = f.grid[cellOf(1, 1)];
  f.running = true;
  let leaked = 0;
  for (let t = 0; t < 30; t += 1 / 60) {
    if (sorter.buf.length === 0 && !sorter.work.length) sorter.buf.push({ id: 1, ty: 1, cp: 0 });
    stepFactory(f, 1 / 60);
    for (const g of f.gizmos) {
      if (g.from === cellOf(1, 1) && g.ty === 1 && g.cell === cellOf(2, 1)) leaked++;
    }
  }
  ok(leaked === 0, 'a jammed sorter holds rather than misrouting', `${leaked} leaked ahead`);
}

console.log(fails ? `\n${fails} FAILED` : '\nrouting behaves');
process.exit(fails ? 1 : 0);
void GRID;
