/**
 * tech.mjs — does research actually gate the game, and does the Lab pay?
 *
 * Four things worth proving. The gate is real (you cannot build what you have not
 * unlocked, from any direction). The Lab pays what a vault would have paid, so the
 * only cost of research is the money forgone. Duplication's ceiling holds. And a
 * whole match can actually reach the far end of the tree.
 *
 *   node tools/tech.mjs
 */
import { createFactory, stepFactory, beginRound, research } from '../js/sim.js';
import { createEngine } from '../js/game.js';
import * as M from '../js/machines.js';

M.setGridSize(7);
let fails = 0;
const ok = (c, what, detail = '') => {
  if (!c) { fails++; console.log('  FAIL  ' + what + (detail ? '  ' + detail : '')); }
  else console.log('  ok    ' + what + (detail ? '  ' + detail : ''));
};
const put = (f, x, y, spec) => { f.grid[M.cellOf(x, y)] = M.makeMachine(spec, f.nid++); };

/* --- the gate ------------------------------------------------------------- */
{
  const open = M.unlockedBy([]);
  ok(!open.has('dup') && !open.has('store') && !open.has('sort') && !open.has('trident'),
    'the tree really starts locked', [...open].join(','));
  ok(M.catalogue([]).every(s => s.kind !== 'dup' && s.kind !== 'asm'),
    'the catalogue offers nothing unresearched');
  ok(!M.routeKindsFor([]).includes('sort'), 'the Sorter is not on the plumbing shelf yet');
  ok(M.routeKindsFor(['sorting']).includes('sort'), 'Sorting puts it there');
  ok(M.catalogue(['assembly']).some(s => s.kind === 'asm' && s.mut === 0),
    'Assembly opens the Engine recipe');
  ok(!M.catalogue(['assembly']).some(s => s.kind === 'asm' && s.mut === 1),
    'but not the Turbine, which is its own node');
  ok(M.levelCap([]) === 2 && M.levelCap(['overclock']) === 3, 'Overclocking raises the ceiling');

  // Prerequisites must actually bind.
  const f = createFactory({ cash: 0, claim: 3 });
  f.science = 99999;
  ok(!research(f, 'replication').ok, 'a node with unmet prerequisites is refused');
  research(f, 'storage'); research(f, 'overclock');
  ok(research(f, 'replication').ok, 'and allowed once they are met');
  ok(!research(f, 'replication').ok, 'and cannot be bought twice');
  const poor = createFactory({ cash: 0, claim: 3 });
  poor.science = 10;
  ok(!research(poor, 'sorting').ok, 'and cannot be bought without the science');
}

/* --- the Lab pays what the vault would ------------------------------------ */
{
  // Same line twice: once aimed east at the vault, once north into the Lab.
  const build = dir => {
    const f = createFactory({ cash: 0, claim: 3 });
    put(f, 0, 0, { kind: 'mut', dir: 0, mut: 2 });
    put(f, 1, 0, { kind: 'pipe', dir: 0 });
    put(f, 2, 0, { kind: 'pipe', dir });
    f.producer.level = 3;
    beginRound(f);
    for (let t = 0; t < 60; t += 1 / 60) stepFactory(f, 1 / 60);
    return f;
  };
  const cash = build(0), sci = build(3);
  ok(cash.earned > 100, 'the control line sells', `$${Math.round(cash.earned)}`);
  ok(sci.science > 100, 'the same line aimed north researches', `${Math.round(sci.science)} sci`);
  ok(Math.abs(sci.science - cash.earned) / cash.earned < 0.06,
    'a gizmo is worth the same either way',
    `$${Math.round(cash.earned)} vs ${Math.round(sci.science)} sci`);
  ok(sci.earned === 0 && cash.science === 0, 'and it is strictly one or the other');
  ok(sci.lost === 0, 'the Lab is a destination, not an edge to fall off');
}

/* --- duplication's ceiling ------------------------------------------------ */
{
  const d = { kind: 'dup', dir: 0, level: 3, flip: 0 };
  const at = ty => M.outputs(d, [{ ty, cp: 0 }]).length;
  ok(at(4) === 4, 'a level 3 Doubler makes four of a Cobalt');
  ok(at(7) === 1, 'and refuses to copy a Prism at all');
  ok(at(13) === 1, 'or a Reactor');
  ok(M.cycleTime({ kind: 'dup', level: 1 }) === M.cycleTime({ kind: 'dup', level: 3 }),
    'levels buy exits, never speed');
  const worst = M.TYPES[4].value * 4 / M.cycleTime(d);
  ok(worst < 100, 'the best case a Doubler can reach is bounded', `$${worst.toFixed(0)}/s`);
}

/* --- a whole match can reach the tree ------------------------------------- */
{
  const eng = createEngine({
    rounds: 8, planSecs: 3, roundSecs: 90, tallySecs: 1, cash: 200, gridSize: 7,
  });
  eng.addPlayer(0, 'SCHOLAR', 0);
  eng.startGame();
  const p = eng.players.get(0), f = p.f;
  let planDone = -1, shopDone = -1, t = 0;

  while (eng.phase !== 'over' && t < 20000) {
    eng.step(1 / 20); t += 1 / 20;
    if (eng.phase === 'plan' && planDone !== eng.round) {
      planDone = eng.round;
      // Aim the end of the line into the Lab rather than the vault, and keep the
      // line reaching the fence as the claim grows.
      if (f.claim < M.GRID && f.cash > M.expandCost(f.claim) * 2) eng.action(0, { t: 'expand' });
      for (let x = 0; x < f.claim; x++) {
        if (!f.grid[M.cellOf(x, 0)] && f.cash > 40) eng.action(0, { t: 'route', k: 'pipe' });
      }
      const endCell = M.cellOf(f.claim - 1, 0);
      if (f.grid[endCell]) f.grid[endCell].dir = 3;      // north, into the Lab
      for (let k = 0; k < 3; k++) {
        const pc = M.producerCost(f.producer.level);
        if (f.producer.level >= M.MAX_UTIL || f.cash < pc * 1.5) break;
        eng.action(0, { t: 'act', a: { a: 'upprod' } });
      }
    }
    if (eng.phase === 'plan' && shopDone !== eng.round && planDone === eng.round) {
      shopDone = eng.round;
      for (const node of M.TECH) {
        if (!f.done.includes(node.id) && M.techOpen(node, f.done) && f.science >= node.cost) {
          eng.action(0, { t: 'research', id: node.id });
        }
      }
      const cat = M.catalogue(f.done);
      const buy = cat.map((c, i) => ({ i, c })).filter(x => x.c.kind === 'mut' && x.c.cost <= f.cash)
        .sort((a, b) => b.c.cost - a.c.cost)[0];
      if (buy) {
        eng.action(0, { t: 'buy', i: buy.i });
        const at = f.grid.findIndex((m, i) => m && m.kind === 'mut' && M.cy(i) > 0);
        if (at >= 0) {
          for (let x = 1; x < f.claim - 1; x++) {
            if (f.grid[M.cellOf(x, 0)]?.kind !== 'pipe') continue;
            eng.action(0, { t: 'act', a: { a: 'move', from: 'g' + at, to: 'g' + M.cellOf(x, 0) } });
            break;
          }
        }
      }
    }
  }
  console.log(`  ..    a research-first match banked ${Math.round(f.science + f.spent)} science `
    + `and finished ${f.done.length}/${M.TECH.length} nodes: ${f.done.join(', ') || 'none'}`);
  ok(f.done.length >= 3, 'research is reachable inside a match', `${f.done.length} nodes`);
  ok(f.spent > 0 && f.science >= 0, 'science is spent, not just accrued');
}

console.log(fails ? `\n${fails} FAILED` : '\nresearch holds together');
process.exit(fails ? 1 : 0);
