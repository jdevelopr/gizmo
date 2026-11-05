/**
 * bugs.mjs — every claim the manual makes about mites and Zappers.
 *
 *   node tools/bugs.mjs
 *
 * Builds small factories on the flat test bench, lets mites at them, and checks
 * the things that have to be true: nests are never near the start, a mite chews a
 * belt to nothing and the belt stops, a broken machine holds what it had, repair
 * brings it back, an Armory makes Ammo out of one belt of Scrap and Copper, and a
 * Zapper with Ammo kills mites — and one without it does not.
 */
import {
  WORLD, cellOf, AMMO, MAX_HP, AMMO_CHARGES, broken, maxHp, repairCost, SWARM_GRACE,
  SWARM_COST, catalogue, wants, NEST_HP, NEST_BOUNTY, nestBrood, nestAnger,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, diagnose, applyAction } from '../js/sim.js';
import { plainWorld, generateWorld } from '../js/world.js';
import { placeNests, spawnMite, repairMachine, repairAll, noiseOf } from '../js/bugs.js';

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
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0 });
const run = (f, secs, full = true) => {
  for (let i = 0; i < secs * 30; i++) {
    if (full) {
      for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
      f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    }
    stepFactory(f, 1 / 30);
  }
};

console.log('\nNests');
{
  let near = 0, none = 0, worlds = 200;
  const c = (WORLD - 1) / 2;
  for (let s = 1; s <= worlds; s++) {
    const w = generateWorld(s * 7919);
    const n = placeNests(w);
    if (!n.length) none++;
    for (const nest of n) {
      const r = Math.max(Math.abs(nest.cell % WORLD - c), Math.abs(Math.floor(nest.cell / WORLD) - c));
      if (r < 11) near++;
      if (w.terrain[nest.cell] !== 0 || w.patch[nest.cell] >= 0) near++;
    }
  }
  ok(none === 0, `every one of ${worlds} worlds has nests`);
  ok(near === 0, 'no nest is within eleven rings of the middle, on rock or on ore');
  ok(placeNests(plainWorld()).length === 0, 'the test bench has none');
  const a = placeNests(generateWorld(42)), b = placeNests(generateWorld(42));
  ok(JSON.stringify(a) === JSON.stringify(b), 'nests are a pure function of the seed');
}

console.log('\nThe catalogue');
{
  const kinds = catalogue([]).map(c => c.kind);
  ok(kinds.includes('zap') && kinds.includes('arm'), 'Zapper and Armory are on sale from the start');
}

console.log('\nChewing');
{
  const f = bench();
  put(f, 'pipe', 20, 20);
  const belt = f.grid[cellOf(20, 20)];
  spawnMite(f, 20.5, 20.5);
  run(f, 2);
  ok(belt.hp < MAX_HP.pipe, 'a mite standing on a belt chews it');
  run(f, 12);
  ok(broken(belt), 'and a dozen seconds later it is broken');
  ok(!wants(belt, 0), 'a broken belt takes nothing');
  ok(diagnose(f).broken === 1, 'and the factory knows it has one broken machine');
  const c = repairCost(belt, f.done);
  ok(c > 0, `repairing it costs money ($${c})`);
  f.mites.length = 0;
  const cash = f.cash;
  ok(repairMachine(f, cellOf(20, 20)).ok && belt.hp === maxHp(belt), 'repair brings it back to full');
  ok(f.cash === cash - c, 'and charges exactly what it said');
}

console.log('\nDamage slows, breaking stops');
{
  const f = bench();
  f.patch[cellOf(10, 10)] = 0; f.rich[cellOf(10, 10)] = 1;
  put(f, 'ext', 10, 10);
  for (let x = 11; x <= 14; x++) put(f, 'pipe', x, 10);
  put(f, 'depot', 15, 10);
  run(f, 20);
  const healthy = f.sold;
  f.grid[cellOf(12, 10)].hp = 0;
  const sold = f.sold;
  run(f, 20);
  ok(healthy > 5, `a healthy line sells (${healthy})`);
  ok(f.sold - sold <= 3, `a line with a broken belt in it stops (${f.sold - sold} sold after)`);
  repairAll(f);
  const s2 = f.sold;
  run(f, 20);
  ok(f.sold - s2 > 5, 'and repairing everything starts it again');
}

console.log('\nThe Armory');
{
  const f = bench();
  // The natural build: one Slag line and a Balancer. Its straight arm carries Scrap
  // into the Armory's west face; its branch goes through a Copper Mutator and comes
  // up into the south face.
  f.patch[cellOf(10, 10)] = 0; f.rich[cellOf(10, 10)] = 2;
  put(f, 'ext', 10, 10);
  put(f, 'bal', 11, 10);
  put(f, 'pipe', 12, 10);
  put(f, 'mut', 11, 11, { mut: 1 });
  put(f, 'pipe', 12, 11);
  put(f, 'pipe', 13, 11, { dir: 3 });
  put(f, 'arm', 13, 10);
  put(f, 'pipe', 14, 10);
  put(f, 'depot', 15, 10);
  run(f, 60);
  ok(f.shipped[AMMO] > 10, `a split Slag line makes Ammo (${f.shipped[AMMO]} in a minute)`);
  ok(!diagnose(f).jams.length, 'and nothing jams');
}

console.log('\nThe Armory sorts out a lopsided feed');
{
  // The build that used to stop for good: both arms merged onto one belt.
  const f = bench();
  f.patch[cellOf(10, 10)] = 0; f.rich[cellOf(10, 10)] = 2;
  put(f, 'ext', 10, 10);
  put(f, 'bal', 11, 10);
  put(f, 'pipe', 12, 10, { dir: 1 });
  put(f, 'mut', 11, 11, { mut: 1 });
  put(f, 'pipe', 12, 11);
  put(f, 'arm', 13, 11);
  put(f, 'pipe', 14, 11);
  put(f, 'depot', 15, 11);
  run(f, 60);
  const a = f.shipped[AMMO];
  run(f, 60);
  ok(a > 10, `a merged belt makes Ammo (${a} in the first minute)`);
  ok(f.shipped[AMMO] - a > 10, `and is still making it a minute later (${f.shipped[AMMO] - a})`);

  // Scrap only: it should still press Ammo, three at a time.
  const g = bench();
  g.patch[cellOf(10, 10)] = 0; g.rich[cellOf(10, 10)] = 2;
  put(g, 'ext', 10, 10); put(g, 'pipe', 11, 10); put(g, 'arm', 12, 10);
  put(g, 'pipe', 13, 10); put(g, 'depot', 14, 10);
  run(g, 60);
  ok(g.shipped[AMMO] > 5, `Scrap alone still makes Ammo (${g.shipped[AMMO]})`);
}

console.log('\nClearing a machine');
{
  const f = bench();
  put(f, 'arm', 20, 20);
  const m = f.grid[cellOf(20, 20)];
  m.buf.push({ id: 1, ty: 0, cp: 0 }, { id: 2, ty: 0, cp: 0 });
  ok(applyAction(f, { a: 'clearBuf', i: cellOf(20, 20) }).ok && !m.buf.length, 'CLEAR empties an Armory');
  put(f, 'pipe', 21, 21);
  ok(!applyAction(f, { a: 'clearBuf', i: cellOf(21, 21) }).ok, 'and is refused on a belt');
}

console.log('\nThe Zapper');
{
  const f = bench();
  put(f, 'zap', 25, 25);
  const z = f.grid[cellOf(25, 25)];
  for (let k = 0; k < 4; k++) spawnMite(f, 28.5, 25.5);
  run(f, 3);
  ok(f.zapped === 0, 'without Ammo it does nothing');
  ok(wants(z, AMMO) && !wants(z, 0), 'it takes Ammo and nothing else');
  z.buf.push({ id: 1, ty: AMMO, cp: 0 });
  run(f, 6);
  ok(f.zapped === 4, `with one Ammo it kills a small swarm (${f.zapped} of 4)`);
  ok(z.charge === AMMO_CHARGES - 4, 'spending one shot each');
  ok(z.kills === 4, 'and keeps count');
}

console.log('\nBesieging a nest');
{
  const f = bench();
  f.nests = [{ cell: cellOf(30, 25), hp: NEST_HP }];
  put(f, 'zap', 26, 25);
  const z = f.grid[cellOf(26, 25)];
  for (let k = 0; k < 4; k++) z.buf.push({ id: 500 + k, ty: AMMO, cp: 0 });
  ok(NEST_HP === 12000 && NEST_BOUNTY === 2000, 'a nest has 12,000 hit points and pays $2,000');
  let broods = 0, firstBrood = null;
  for (let i = 0; i < 30 * 30; i++) {
    run(f, 1 / 30);
    for (const e of f.fx) if (e.k === 'brood') { broods++; if (firstBrood == null) firstBrood = f.mites.map(m => m.tgt); }
    f.fx.length = 0;
  }
  const nest = f.nests[0];
  ok(nest.hp < NEST_HP, `shooting it hurts it (${Math.round(nest.hp)} left)`);
  ok(broods > 0, `and it sends out broods (${broods} so far)`);
  ok(firstBrood && firstBrood.every(t => t === cellOf(26, 25)), 'which go straight for the Zapper shooting at it');
  ok(f.zapped > 0, `the Zapper turns on them and kills them (${f.zapped})`);
  const fresh = { hp: NEST_HP }, dying = { hp: NEST_HP * 0.05 };
  ok(nestBrood(dying) > nestBrood(fresh), `a dying nest sends bigger broods (${nestBrood(fresh)} → ${nestBrood(dying)})`);
  ok(nestAnger(dying) < nestAnger(fresh), `and sends them sooner (every ${nestAnger(fresh)} → ${nestAnger(dying)} damage)`);
  const half = { hp: NEST_HP / 2 };
  ok(nestBrood(half) > nestBrood(fresh) && nestBrood(half) < nestBrood(dying), 'climbing steadily on the way down');
  const cash = f.cash;
  nest.hp = 5; nest.anger = 0;
  z.buf.push({ id: 900, ty: AMMO, cp: 0 });
  f.mites.length = 0;
  run(f, 3);
  ok(!f.nests.length && f.cash - cash === NEST_BOUNTY, 'and a dead nest pays out $2,000');
}

console.log('\nThe Zapper draws power while it recharges');
{
  const f = bench();
  f.patch[cellOf(30, 30)] = 0; f.rich[cellOf(30, 30)] = 1;
  put(f, 'gen', 30, 31);
  put(f, 'zap', 31, 31);
  const g = f.grid[cellOf(30, 31)], z = f.grid[cellOf(31, 31)];
  for (let k = 0; k < 20; k++) g.buf.push({ id: k, ty: 0, cp: 0 });
  for (let k = 0; k < 3; k++) z.buf.push({ id: 100 + k, ty: AMMO, cp: 0 });
  for (let k = 0; k < 10; k++) spawnMite(f, 33.5, 31.5, 30);
  let peak = 0;
  for (let i = 0; i < 60; i++) { stepFactory(f, 1 / 30); peak = Math.max(peak, f.nets[0]?.demand || 0); }
  ok(peak > 0, `a busy Zapper puts demand on its grid (${peak} kW)`);
}

console.log('\nNoise and swarms');
{
  const f = createFactory({ world: generateWorld(1234), cash: 1e6 });
  f.claim = 21; f.mapRev++; rebuild(f);
  ok(f.nests.length > 0, `a real world has nests (${f.nests.length})`);
  // A loud factory: Extractors on every patch slot inside the claim.
  let n = 0;
  for (let i = 0; i < f.grid.length && n < 12; i++) {
    if (f.patch[i] >= 0 && build(f, { kind: 'ext' }, i, { free: true }).ok) n++;
  }
  ok(noiseOf(f) >= 10, `twelve Extractors are loud (${noiseOf(f).toFixed(1)})`);
  for (let i = 0; i < 30 * 60; i++) stepFactory(f, 1 / 30);
  ok(f.waves === 0, 'nothing comes before the grace period is over');
  f.t = SWARM_GRACE;
  const secs = Math.ceil(SWARM_COST / noiseOf(f)) + 5;
  for (let i = 0; i < 30 * secs; i++) stepFactory(f, 1 / 30);
  ok(f.waves >= 1 && f.mites.length > 0, `a swarm sets out once the gauge fills (${f.mites.length} mites)`);
}

console.log(fails ? `\n${fails} FAILED\n` : '\nMites chew, Zappers zap, and everything can be put right.\n');
process.exit(fails ? 1 : 0);
