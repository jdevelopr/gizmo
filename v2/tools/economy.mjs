/**
 * economy.mjs — what everything costs, round by round.
 *
 * The one table that shows whether the game is affordable. Every price in GIZMO
 * multiplies by something, and multiplications compound quietly: a markup that
 * looks mild per round is a different game by round eight. Print it, do not guess.
 *
 *   node tools/economy.mjs
 */
import * as M from '../js/machines.js';

const $ = n => '$' + Math.round(n);
const pad = (s, n) => String(s).padStart(n);
const ROUNDS = [1, 2, 4, 6, 8];

console.log('\n=== SHOP, per round (base price x markup) ===');
console.log(pad('', 20) + ROUNDS.map(r => pad('R' + r, 9)).join(''));
const shopRows = [
  ['Storage', { kind: 'store' }],
  ['Doubler', { kind: 'dup' }],
  ['Copper Mutator', { kind: 'mut', mut: 1 }],
  ['Cobalt Mutator', { kind: 'mut', mut: 4 }],
  ['Fuser', { kind: 'fuse' }],
  ['Engine Assembler', { kind: 'asm', mut: 0 }],
  ['Turbine Assembler', { kind: 'asm', mut: 1 }],
  ['Trident', { kind: 'trident' }],
];
for (const [name, spec] of shopRows) {
  console.log(pad(name, 20) + ROUNDS.map(r => pad($(M.shopCost(spec, r)), 9)).join(''));
}
console.log(pad('markup', 20) + ROUNDS.map(r => pad('x' + M.costMult(r).toFixed(1), 9)).join(''));

console.log('\n=== ROUTING, first one each round (cheap allowance) ===');
console.log(pad('', 20) + ROUNDS.map(r => pad('R' + r, 9)).join(''));
for (const k of M.ROUTE_KINDS) {
  console.log(pad(M.KINDS[k].name, 20)
    + ROUNDS.map(r => pad($(M.routeCost(k, r, 0, 4)), 9)).join(''));
}
console.log(pad('past allowance', 20)
  + ROUNDS.map(r => pad($(M.routeCost('pipe', r, 6, 4)), 9)).join(''));

console.log('\n=== LADDERS (round-independent) ===');
console.log('land      ' + [3, 4, 5, 6].map(n => `${n}->${n + 1} ${$(M.expandCost(n))}`).join('   ')
  + `   total ${$([3, 4, 5, 6].reduce((s, n) => s + M.expandCost(n), 0))}`);
console.log('producer  ' + [1, 2, 3, 4].map(l => `L${l + 1} ${$(M.producerCost(l))}`).join('   ')
  + `   total ${$([1, 2, 3, 4].reduce((s, l) => s + M.producerCost(l), 0))}`);
console.log('seller    ' + [1, 2, 3, 4].map(l => `L${l + 1} ${$(M.sellerCost(l))}`).join('   ')
  + `   total ${$([1, 2, 3, 4].reduce((s, l) => s + M.sellerCost(l), 0))}`);

console.log('\n=== UPGRADING A MACHINE (of its own base price) ===');
for (const spec of [{ kind: 'dup' }, { kind: 'mut', mut: 4 }, { kind: 'asm', mut: 0 }]) {
  const l1 = M.upgradeCost({ ...spec, level: 1 }), l2 = M.upgradeCost({ ...spec, level: 2 });
  const inv = M.investedIn({ ...spec, level: 3 });
  console.log(pad(M.label(spec), 20) + ` base ${pad($(M.price(spec)), 6)}`
    + `   L2 ${pad($(l1), 6)}   L3 ${pad($(l2), 6)}`
    + `   all-in ${pad($(inv), 7)}   scrap back ${$(M.scrapValue({ ...spec, level: 3 }))}`);
}

console.log('\n=== RESEARCH (science, which is production not cash) ===');
for (const t of M.TECH) {
  const needs = (t.needs || []).map(n => M.TECH.find(x => x.id === n)?.name).join(', ') || '-';
  console.log(pad(t.name, 16) + pad(t.cost + ' sci', 10) + '   after ' + needs);
}
console.log(pad('total tree', 16) + pad(M.TECH.reduce((s2, t) => s2 + t.cost, 0) + ' sci', 10)
  + '   = the same number of dollars not taken');

console.log('\n=== WHAT A ROUND EARNS, for reference ===');
const perRound = 90 / M.producerCycle(1);
console.log(`starter kit at 90s: ${$(perRound)}   (producer L1, a bare belt run, Scrap at $1)`);
console.log(`producer at L5:     ${$(90 / M.producerCycle(5))} on the same line`);
const mutSlot = t => M.TYPES[t].value / M.MUT_CYCLE[t];
console.log('mutator $/s per slot: ' + [1, 2, 4, 6, 7].map(t =>
  `${M.TYPES[t].name} ${mutSlot(t).toFixed(1)}`).join('  '));
console.log('assembler $/s per slot: ' + M.RECIPES.map(r =>
  `${M.TYPES[r.out].name} ${(M.TYPES[r.out].value / r.cycle).toFixed(1)}`).join('  '));

/* ------------------------------------------------------------ worked builds --- */
/*
 * The question a cost table cannot answer on its own: can you afford the thing you
 * are trying to build, out of what it earns? Each of these is a real line, run in
 * the real simulation, priced at what it would cost to put down.
 */
const { createFactory, stepFactory, beginRound } = await import('../js/sim.js');

function build(name, claim, plan, producerLevel = 1) {
  const f = createFactory({ cash: 0, claim });
  let spend = 0;
  for (const [x, y, spec] of plan) {
    f.grid[M.cellOf(x, y)] = M.makeMachine(spec, f.nid++);
    spend += M.price(spec) * (spec.level ? Math.pow(M.UP_STEP, 0) : 1);
    for (let l = 1; l < (spec.level || 1); l++) {
      f.grid[M.cellOf(x, y)].level = l + 1;
      spend += M.upgradeCost({ ...spec, level: l });
    }
  }
  f.producer.level = producerLevel;
  for (let l = 1; l < producerLevel; l++) spend += M.producerCost(l);
  beginRound(f);
  for (let t = 0; t < 90; t += 1 / 60) stepFactory(f, 1 / 60);
  return { name, claim, spend: Math.round(spend), income: Math.round(f.income), lost: f.lost };
}

const P = (x, y, kind, extra = {}) => [x, y, { kind, dir: 0, ...extra }];
const belt = (x, y, dir = 0) => [x, y, { kind: 'pipe', dir }];

const builds = [
  build('3x3 starter kit', 3, [belt(0, 0), belt(1, 0), belt(2, 0)]),
  build('3x3 + Copper Mutator', 3, [P(0, 0, 'mut', { mut: 1 }), belt(1, 0), belt(2, 0)]),
  build('5x5 two-tier line', 5, [
    P(0, 0, 'mut', { mut: 1 }), P(1, 0, 'mut', { mut: 2 }), belt(2, 0), belt(3, 0), belt(4, 0),
  ]),
  build('5x5 two-tier, Producer L3', 5, [
    P(0, 0, 'mut', { mut: 1 }), P(1, 0, 'mut', { mut: 2 }), belt(2, 0), belt(3, 0), belt(4, 0),
  ], 3),
  build('5x5 Engine chain', 5, [
    P(0, 0, 'mut', { mut: 2 }), belt(1, 0, 1),
    P(0, 1, 'fuse'), P(1, 1, 'asm', { mut: 0 }), belt(2, 1, 3),
    belt(2, 0), belt(3, 0), belt(4, 0),
  ], 3),
];

console.log('\n=== WORKED BUILDS, one 90s round each ===');
console.log(pad('', 30) + pad('build cost', 12) + pad('per round', 11) + pad('pays back in', 14));
for (const b of builds) {
  const rounds = b.income > 0 ? (b.spend / b.income).toFixed(1) + ' rounds' : 'never';
  console.log(pad(b.name, 30) + pad($(b.spend), 12) + pad($(b.income), 11) + pad(rounds, 14));
}
console.log('');
