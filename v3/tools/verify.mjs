/**
 * verify.mjs — the invariants, asserted against the real simulation.
 *
 * These are the things that have to be true of every factory in every world, and
 * most of them are things GIZMO 2 also promised: nothing is ever destroyed except
 * by being fired off your own fence, a machine will not accept what it cannot use,
 * and no amount of clever routing makes a gizmo out of nothing except a Doubler.
 *
 *   node tools/verify.mjs
 */
import {
  WORLD, cellOf, cx, cy, TYPES, KINDS, RECIPES, claimMin, claimMax, OPEN,
  CLAIM_START, expandCost, copyable, COPY_MAX_VALUE, famOf, PRODUCT,
} from '../js/machines.js';
import {
  createFactory, starterKit, stepFactory, build, buildCheck, moveMachine,
  scrapMachine, applyAction, research, rebuild, reachesPayout, diagnose,
} from '../js/sim.js';
import { plainWorld, generateWorld } from '../js/world.js';
import { createGame, stepGame, serialise, deserialise } from '../js/game.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};

function bench(claim = WORLD) {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = claim;
  f.mapRev++;
  rebuild(f);
  return f;
}
const ore = (f, x, y, ty = 0, rich = 1) => { f.patch[cellOf(x, y)] = ty; f.rich[cellOf(x, y)] = rich; };
const put = (f, kind, x, y, opt = {}) =>
  build(f, { kind, ...opt }, cellOf(x, y), { free: true, dir: opt.dir ?? 0 });
const run = (f, secs) => { for (let i = 0; i < secs * 30; i++) stepFactory(f, 1 / 30); };
/** Feed a machine directly, the way a belt would. */
const feed = (f, x, y, ty, n = 1) => {
  const m = f.grid[cellOf(x, y)];
  for (let i = 0; i < n; i++) m.buf.push({ id: 1000 + i, ty, cp: 0 });
};

console.log('\nWHERE YOU MAY BUILD');
{
  const f = bench(CLAIM_START);
  const lo = claimMin(CLAIM_START), hi = claimMax(CLAIM_START);
  ok(!buildCheck(f, { kind: 'pipe' }, cellOf(lo - 1, lo)).ok, 'not outside the claim');
  ok(buildCheck(f, { kind: 'pipe' }, cellOf(lo, lo)).ok, 'yes on your own ground');
  f.terrain[cellOf(lo + 1, lo)] = 2;
  ok(!buildCheck(f, { kind: 'pipe' }, cellOf(lo + 1, lo)).ok, 'not on bedrock');
  f.terrain[cellOf(lo + 1, lo)] = 1;
  ok(!buildCheck(f, { kind: 'pipe' }, cellOf(lo + 1, lo)).ok, 'not on rubble until it is cleared');
  // plainWorld puts ore across most of the opening claim, so find bare ground.
  let bare = -1;
  for (let y = lo; y <= hi && bare < 0; y++) {
    for (let x = lo; x <= hi; x++) {
      const i = cellOf(x, y);
      if (f.patch[i] < 0 && f.terrain[i] === OPEN && !f.grid[i]) { bare = i; break; }
    }
  }
  ok(!buildCheck(f, { kind: 'ext' }, bare).ok, 'no Extractor off a patch');
  ore(f, cx(bare), cy(bare));
  ok(buildCheck(f, { kind: 'ext' }, bare).ok, 'and yes on one');
  put(f, 'pipe', lo, lo);
  ok(!buildCheck(f, { kind: 'pipe' }, cellOf(lo, lo)).ok, 'and never two on one slot');
}

console.log('\nBUYING LAND');
{
  const f = bench(CLAIM_START);
  f.cash = 1e9;
  const lo = claimMin(CLAIM_START);
  ore(f, lo, lo);
  put(f, 'ext', lo, lo, { dir: 0 });
  const before = { ...f.grid[cellOf(lo, lo)] };
  const cost = expandCost(f.claim);
  const r = applyAction(f, { a: 'expand' });
  ok(r.ok && f.claim === CLAIM_START + 2, 'a ring makes the claim two wider');
  ok(r.cost === cost, 'and costs what the catalogue said');
  const after = f.grid[cellOf(lo, lo)];
  ok(after && after.dir === before.dir && after.kind === before.kind,
    'and moves nothing — every machine keeps its slot and its facing');
  ok(claimMin(f.claim) === claimMin(CLAIM_START) - 1, 'the claim stays centred');
}

console.log('\nNOTHING IS DESTROYED, EXCEPT OFF YOUR OWN FENCE');
{
  const f = bench(CLAIM_START);
  const lo = claimMin(CLAIM_START), hi = claimMax(CLAIM_START);
  ore(f, lo + 1, lo + 1);
  put(f, 'ext', lo + 1, lo + 1, { dir: 0 });
  // A belt run aimed straight at the fence with nothing at the end of it.
  for (let x = lo + 2; x <= hi; x++) put(f, 'pipe', x, lo + 1, { dir: 0 });
  run(f, 40);
  ok(f.lost > 0, 'a belt aimed at unbought land throws what it carries away', `lost ${f.lost}`);
  ok(f.earned === 0, 'and earns nothing for it');
  ok(!reachesPayout(f), 'and the game can tell you so before you watch it for a minute');
}
{
  const f = bench(CLAIM_START);
  const lo = claimMin(CLAIM_START);
  ore(f, lo + 1, lo + 1);
  put(f, 'ext', lo + 1, lo + 1, { dir: 0 });
  // A jam: one belt, then nothing. Everything piles up and stops.
  put(f, 'pipe', lo + 2, lo + 1, { dir: 3 });
  put(f, 'pipe', lo + 2, lo, { dir: 2 });
  put(f, 'pipe', lo + 1, lo, { dir: 1 });      // fires back into the extractor: refused
  run(f, 60);
  ok(f.lost === 0, 'a line that loops back onto itself loses nothing', `lost ${f.lost}`);
  const stuck = diagnose(f);
  ok(stuck.blocked > 0, 'it backs up instead, and says which machines are holding');
}

console.log('\nWHAT MACHINES WILL AND WILL NOT ACCEPT');
{
  const f = bench();
  put(f, 'fuse', 20, 20, { dir: 0 });
  feed(f, 20, 20, 0);           // Scrap, an Alloy
  const fuse = f.grid[cellOf(20, 20)];
  ok(!KINDS.fuse.passive, 'a Fuser is an ordinary machine');
  feed(f, 20, 20, 8);           // Resin, a Part — different family
  ok(fuse.buf.length === 2, 'a direct feed bypasses acceptance, as a harness should');
  const f2 = bench();
  put(f2, 'fuse', 20, 20, { dir: 0 });
  put(f2, 'pipe', 19, 20, { dir: 0 });
  put(f2, 'pipe', 21, 20, { dir: 2 });
  feed(f2, 19, 20, 0);
  feed(f2, 21, 20, 8);
  run(f2, 6);
  const held = f2.grid[cellOf(20, 20)];
  const fams = new Set([...held.buf, ...held.work].map(x => famOf(x.ty)));
  ok(fams.size <= 1, 'but a Fuser fed from two belts never mixes families',
    `held ${[...fams].join(',')}`);
}
{
  const f = bench();
  put(f, 'asm', 20, 20, { dir: 0, mut: 0 });
  const r = RECIPES[0];
  const asm = f.grid[cellOf(20, 20)];
  put(f, 'pipe', 19, 20, { dir: 0 });
  for (let i = 0; i < 20; i++) {
    feed(f, 19, 20, r.ins[0]);
    run(f, 1);
  }
  const ins = [...asm.buf, ...asm.work].map(x => x.ty);
  ok(ins.filter(t => t === r.ins[0]).length <= 1,
    'an Assembler never takes a second of an ingredient it already holds — it cannot deadlock',
    `held ${ins.join(',')}`);
}
{
  const f = bench();
  ore(f, 20, 20);
  put(f, 'ext', 20, 20, { dir: 0 });
  put(f, 'pipe', 19, 20, { dir: 0 });
  feed(f, 19, 20, 0, 4);
  run(f, 8);
  ok(f.grid[cellOf(19, 20)].buf.length + f.grid[cellOf(19, 20)].work.length > 0
    || f.gizmos.some(g => g.cell === cellOf(19, 20)) || f.grid[cellOf(19, 20)].blocked,
    'a belt aimed at an Extractor backs up rather than voiding what it carries');
}

console.log('\nCOPIES');
{
  const f = bench();
  f.done = ['storage', 'overclock', 'replication'];
  put(f, 'dup', 20, 20, { dir: 0 });
  put(f, 'pipe', 21, 20, { dir: 0 });
  feed(f, 20, 20, 0);
  run(f, 20);   // a bench has no generator, so a 1.8s cycle takes 9s here
  ok(f.gizmos.length + f.grid[cellOf(21, 20)].buf.length >= 2,
    'a Doubler makes two out of one');
  const f2 = bench();
  f2.done = ['storage', 'overclock', 'replication'];
  put(f2, 'dup', 20, 20, { dir: 0 });
  put(f2, 'pipe', 21, 20, { dir: 0 });
  feed(f2, 20, 20, 5);          // Void, above the copy ceiling
  run(f2, 20);
  const out = [...f2.gizmos, ...f2.grid[cellOf(21, 20)].buf];
  ok(out.length <= 1, `nothing above ${COPY_MAX_VALUE} in value is ever copied`,
    `made ${out.length}`);
  ok(!copyable(5) && copyable(4), 'Cobalt is the ceiling and Void is over it');
}

console.log('\nMONEY AND SCIENCE');
{
  const f = bench();
  put(f, 'depot', 20, 20);
  put(f, 'pipe', 19, 20, { dir: 0 });
  feed(f, 19, 20, 4);           // one Cobalt, worth 32
  run(f, 3);
  ok(f.earned === TYPES[4].value, 'a Depot pays exactly the market value', `paid ${f.earned}`);
  ok(f.shipped[4] === 1, 'and counts it, so contracts can be credited from the books');

  const f2 = bench();
  put(f2, 'lab', 20, 20);
  put(f2, 'pipe', 19, 20, { dir: 0 });
  feed(f2, 19, 20, 4);
  run(f2, 3);
  ok(f2.science === TYPES[4].value,
    'a Lab pays exactly what the Depot would have — research costs income, never cash');
  ok(f2.earned === 0, 'and no money at all');
}

console.log('\nSCRAPPING AND MOVING');
{
  const f = bench();
  f.cash = 1000;
  const r = build(f, { kind: 'fuse' }, cellOf(20, 20), {});
  const paid = r.cost;
  const back = scrapMachine(f, cellOf(20, 20));
  ok(Math.abs(back.refund - paid / 2) <= 1, 'scrapping returns half of everything paid',
    `${back.refund} of ${paid}`);
  ok(!f.grid[cellOf(20, 20)], 'and the slot is empty again');

  const f2 = bench();
  ore(f2, 20, 20);
  put(f2, 'ext', 20, 20, { dir: 0 });
  ok(!moveMachine(f2, cellOf(20, 20), cellOf(22, 22)).ok,
    'an Extractor cannot be moved off its ore');
  ore(f2, 22, 22, 0, 2);
  ok(moveMachine(f2, cellOf(20, 20), cellOf(22, 22)).ok, 'but onto other ore, yes');
  ok(f2.grid[cellOf(22, 22)].rich === 2,
    'and it picks up the richness of the patch it lands on');
}

console.log('\nTHE SAVE FILE');
{
  const g = createGame({ seed: 4242, cash: 900 });
  run(g.f, 30);
  build(g.f, { kind: 'gen' }, cellOf(cx(g.f.world.start.belts[1]), cy(g.f.world.start.ext) + 1), {});
  applyAction(g.f, { a: 'expand' });
  g.f.science = 500;
  research(g.f, 'sorting');
  const data = serialise(g);
  const back = deserialise(JSON.parse(JSON.stringify(data)));
  ok(!!back, 'a save round-trips');
  ok(back.f.seed === g.f.seed && back.f.claim === g.f.claim, 'the world and the claim come back');
  ok(back.f.cells.length === g.f.cells.length, 'every machine comes back',
    `${back.f.cells.length} vs ${g.f.cells.length}`);
  ok(back.f.done.join() === g.f.done.join(), 'and the research');
  ok(Math.round(back.f.cash) === Math.round(g.f.cash), 'and the money');
  const a = g.f.cells.map(i => `${i}:${g.f.grid[i].kind}:${g.f.grid[i].dir}`).join('|');
  const b = back.f.cells.map(i => `${i}:${back.f.grid[i].kind}:${back.f.grid[i].dir}`).join('|');
  ok(a === b, 'in the same slots, facing the same way');
  ok(back.f.nets.length === g.f.nets.length, 'and on the same power grids');
}

console.log('\nA WHOLE GAME, LEFT RUNNING');
{
  const g = createGame({ seed: 77, cash: 450 });
  for (let i = 0; i < 60 * 30; i++) stepGame(g, 1 / 30);   // one minute
  ok(g.f.earned > 0, 'the starter factory earns without being touched',
    `earned ${Math.round(g.f.earned)}`);
  ok(g.f.gizmos.length < 4300, 'and never exceeds the gizmo ceiling');
  ok(g.done.has('sell'), 'and ticks off its first milestone');
  const out = g.f.cells.every(i => {
    const x = cx(i), y = cy(i);
    return x >= claimMin(g.f.claim) && x <= claimMax(g.f.claim)
      && y >= claimMin(g.f.claim) && y <= claimMax(g.f.claim);
  });
  ok(out, 'nothing ever ends up outside the claim');
  ok(g.f.cells.every(i => g.f.terrain[i] === OPEN), 'and nothing ends up standing on rock');
}

console.log(fails ? `\n${fails} invariant(s) broken.` : '\nEvery invariant holds.');
process.exit(fails ? 1 : 0);
