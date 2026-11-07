/**
 * newmachines.mjs — the Overflow Splitter, Recycler, Pylon, Repair Drone Bay and
 * Solar Panel each do what their card says.
 *
 *   node tools/newmachines.mjs
 */
import {
  WORLD, cellOf, catalogue, unlockerOf, unlockedBy, SOLAR_OUTPUT, PYLON_GAP, DRONE_COST, maxHp, wants, capacity,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, applyAction } from '../js/sim.js';
import { solveTopology, balancePower } from '../js/power.js';
import { plainWorld } from '../js/world.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
function bench() {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = WORLD; f.mapRev++; rebuild(f);
  return f;
}
const at = (f, x, y) => f.grid[cellOf(x, y)];
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0, mir: o.mir });
const ore = (f, x, y, ty = 0) => { f.patch[cellOf(x, y)] = ty; f.rich[cellOf(x, y)] = 2; };
const spin = (f, secs, powered = true) => {
  for (let i = 0; i < secs * 30; i++) {
    if (powered) {
      for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
      f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    }
    stepFactory(f, 1 / 30);
  }
};

console.log('\nUnlocks');
for (const k of ['over', 'recyc', 'pylon', 'drone', 'solar']) {
  const t = unlockerOf(k);
  ok(!!t && !unlockedBy([]).has(k) && catalogue([t.id, ...(t.needs || []), 'generators', 'gridwork', 'defense', 'balancing', 'sorting']).some(c => c.kind === k),
    `${k} is locked until ${t?.name} is researched`);
}

console.log('\nOverflow Splitter');
{
  // Ahead is a Depot; the side is a Depot too. With ahead free, nothing spills.
  const f = bench();
  ore(f, 10, 10);
  put(f, 'ext', 10, 10, { dir: 0 });
  put(f, 'over', 11, 10, { dir: 0 });           // side: south
  put(f, 'pipe', 12, 10, { dir: 0 });
  put(f, 'depot', 13, 10, { dir: 0 });
  put(f, 'pipe', 11, 11, { dir: 1 });
  put(f, 'lab', 11, 12, { dir: 3 });
  spin(f, 30);
  ok(f.earned > 0 && f.studied === 0, `while ahead can take it, everything goes ahead (sold ${f.sold}, studied ${f.studied})`);
  // Block ahead: switch the belt ahead off and it spills to the side.
  applyAction(f, { a: 'toggle', i: cellOf(12, 10) });
  if (!at(f, 12, 10).off) at(f, 12, 10).off = 1;
  spin(f, 30);
  ok(f.studied > 0, `once ahead is backed up, the extra spills out of the side (studied ${f.studied})`);
  ok(applyAction(f, { a: 'mir', i: cellOf(11, 10) }).ok && at(f, 11, 10).mir === 1, 'F flips the side it spills to');
}

console.log('\nRecycler');
{
  const f = bench();
  ore(f, 10, 10);
  put(f, 'ext', 10, 10, { dir: 0 });
  put(f, 'mut', 11, 10, { dir: 0, mut: 4 });     // Cobalt, 11-12
  put(f, 'recyc', 13, 10, { dir: 0 });
  put(f, 'pipe', 14, 10, { dir: 0 });
  put(f, 'depot', 15, 10, { dir: 0 });
  spin(f, 40);
  ok(f.shipped[0] > 0 && !f.shipped[4], `Cobalt goes in, only Scrap comes out (${f.shipped[0]} Scrap, ${f.shipped[4] | 0} Cobalt)`);
  const g = bench();
  put(g, 'recyc', 10, 10, { dir: 0 });
  put(g, 'depot', 11, 10, { dir: 0 });
  for (const ty of [14, 13, 9]) at(g, 10, 10).buf.push({ id: ty, ty, cp: 0 });
  spin(g, 6);
  ok(g.shipped[0] === 2 && g.shipped[8] === 1 && !g.shipped[14] && !g.shipped[13] && !g.shipped[9],
    `Ammo and a Reactor come out as Scrap, Cord as Resin (${g.shipped[0]} Scrap, ${g.shipped[8] | 0} Resin)`);
  const h = bench();
  put(h, 'recyc', 10, 10, { dir: 0 });
  put(h, 'depot', 11, 10, { dir: 0 });
  for (const ty of [8, 9, 10, 10]) at(h, 10, 10).buf.push({ id: ty, ty, cp: 0 });
  spin(h, 8);
  ok(h.shipped[8] === 4 && !h.shipped[0], `Resin, Cord and Frame each come out as one Resin (${h.shipped[8] | 0})`);
}

console.log('\nSorter with one way backed up');
{
  // Filtering for Copper; the Copper side is a switched-off belt, so it never moves.
  const f = bench();
  put(f, 'sort', 10, 10, { dir: 0, mut: 1 });
  put(f, 'depot', 11, 10, { dir: 2 });
  const side = cellOf(10, 11);
  build(f, { kind: 'pipe' }, side, { free: true, dir: 1 });
  f.grid[side].off = 1;
  rebuild(f);
  const s = at(f, 10, 10);
  let fed = 0, k = 0;
  for (let t = 0; t < 30 * 30; t++) {
    const ty = k < 2 ? 1 : 0;      // two Copper first, which can never leave, then Scrap
    if (wants(s, ty) && s.buf.length + (s.work?.length || 0) < capacity(s)) { s.buf.push({ id: 900 + k, ty, cp: 0 }); k++; fed++; }
    for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
    f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    stepFactory(f, 1 / 30);
  }
  ok(f.shipped[0] > 20, `Scrap flows straight on past Copper stuck in front of it (${f.shipped[0] | 0} sold)`);
  ok(!f.shipped[1], 'and no Copper is let through the wrong way');
}

console.log('\nBuilding from the shop uses the crate first');
{
  const f = bench();
  f.cash = 1000;
  build(f, { kind: 'gen' }, cellOf(10, 10), { dir: 0 });
  const spent = 1000 - f.cash;
  build(f, { kind: 'pipe' }, cellOf(10, 10), { dir: 0 });          // the Generator goes in the crate
  ok(f.crate.length === 1 && f.crate[0].kind === 'gen', 'building over a Generator crates it');
  const cash = f.cash;
  const r = build(f, { kind: 'gen' }, cellOf(12, 12), { dir: 0 });
  ok(r.ok && f.cash === cash && f.crate.length === 0 && at(f, 12, 12)?.kind === 'gen',
    `buying a Generator from the shop takes the crated one, free (spent $${cash - f.cash}, first cost $${spent})`);
  build(f, { kind: 'mut', mut: 1 }, cellOf(20, 20), { dir: 0 });
  build(f, { kind: 'pipe' }, cellOf(20, 20), { dir: 0 });
  const c2 = f.cash;
  build(f, { kind: 'mut', mut: 2 }, cellOf(30, 30), { dir: 0 });
  ok(f.cash < c2 && f.crate.some(m => m.kind === 'mut' && m.mut === 1), 'a different Mutator rung is bought, not swapped for the crated one');
}

console.log('\nSolar Panel');
{
  const f = bench();
  put(f, 'solar', 10, 10);
  put(f, 'asm', 11, 10, { mut: 0 });
  put(f, 'asm', 20, 20, { mut: 0 });
  rebuild(f); solveTopology(f);
  ok(at(f, 11, 10).net >= 0 && at(f, 20, 20).net < 0, 'a panel powers what touches it, and not what does not');
  balancePower(f, 1 / 30);
  ok(f.nets[at(f, 11, 10).net].supply === SOLAR_OUTPUT[0], `it makes ${SOLAR_OUTPUT[0]} kW with no fuel at all`);
  for (let i = 0; i < 300; i++) balancePower(f, 1 / 30);
  ok(f.nets[at(f, 11, 10).net].supply === SOLAR_OUTPUT[0], 'and is still making it ten seconds later');
}

console.log('\nPylon');
{
  const f = bench();
  put(f, 'gen', 10, 10);
  put(f, 'pylon', 11, 10, { dir: 0 });
  put(f, 'pylon', 11 + PYLON_GAP[0] + 1, 10, { dir: 0 });     // a gap of exactly the level-1 limit
  put(f, 'asm', 12 + PYLON_GAP[0] + 1, 10, { mut: 0 });
  rebuild(f); solveTopology(f);
  const a = at(f, 11, 10), b = at(f, 11 + PYLON_GAP[0] + 1, 10);
  ok(a.wireTo === cellOf(11 + PYLON_GAP[0] + 1, 10) && b.wires.includes(cellOf(11, 10)), `two Pylons facing the same way, ${PYLON_GAP[0]} slots apart, wire up`);
  ok(at(f, 12 + PYLON_GAP[0] + 1, 10).net === at(f, 10, 10).net && at(f, 10, 10).net >= 0, 'and power crosses the gap to the machine beyond');
  // One slot too far: no link at level 1, a link at level 2.
  const g = bench();
  put(g, 'pylon', 10, 10, { dir: 0 });
  put(g, 'pylon', 10 + PYLON_GAP[0] + 2, 10, { dir: 0 });
  rebuild(g);
  ok(at(g, 10, 10).wireTo < 0, 'one slot further is out of reach at level 1');
  at(g, 10, 10).level = 2; rebuild(g);
  ok(at(g, 10, 10).wireTo >= 0, 'and in reach once it is upgraded');
  // Facing different ways: no link.
  const h = bench();
  put(h, 'pylon', 10, 10, { dir: 0 });
  put(h, 'pylon', 12, 10, { dir: 2 });
  rebuild(h);
  ok(at(h, 10, 10).wireTo < 0, 'Pylons facing different ways do not link');
  ok(!at(h, 10, 10).buf.length && catalogue(['generators', 'gridwork', 'pylons']).some(c => c.kind === 'pylon'), 'a Pylon carries no gizmos');
}

console.log('\nRepair Drone Bay');
{
  const f = bench();
  put(f, 'drone', 10, 10);
  put(f, 'pipe', 14, 10, { dir: 0 });
  put(f, 'pipe', 30, 30, { dir: 0 });
  const bay = at(f, 10, 10), near = at(f, 14, 10), far = at(f, 30, 30);
  near.hp = 1; far.hp = 1;
  spin(f, 5);
  ok(near.hp === 1, 'with no Copper it does nothing');
  for (let k = 0; k < 6; k++) bay.buf.push({ id: 100 + k, ty: 1, cp: 0 });
  spin(f, 1);
  ok(near.hp === maxHp(near), 'fed Copper, it fully repairs a damaged machine in range');
  ok(far.hp === 1, 'and leaves one out of range alone');
  const { wants } = await import('../js/machines.js');
  ok(wants(bay, 1) && !wants(bay, 0), 'it takes Copper and nothing else');
  ok(bay.buf.filter(g => g.ty === 1).length === 6 - DRONE_COST, `spending ${DRONE_COST} Copper on the repair`);
}

console.log(fails ? `\n${fails} FAILED\n` : '\nFive new machines, each doing what it says.\n');
process.exit(fails ? 1 : 0);
