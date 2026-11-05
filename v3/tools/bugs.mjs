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
  MITE, SKITTER, ZAP_DAMAGE, NESTS, SKITTER_FROM, NEST_POP_MIN, claimMin, claimMax, CHARGED,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, diagnose, applyAction } from '../js/sim.js';
import { plainWorld, generateWorld } from '../js/world.js';
import { placeNests, spawnMite, repairMachine, repairAll, noiseOf, sendSwarm } from '../js/bugs.js';

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
  ok(!kinds.includes('zap') && !kinds.includes('arm'), 'Zapper and Armory are locked at the start');
  const after = catalogue(['defense']).map(c => c.kind);
  ok(after.includes('zap') && after.includes('arm'), 'and Pest Control unlocks both');
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
  put(f, 'mut', 11, 11, { mut: 1 });          // 1x2: 11-12
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
  put(f, 'pipe', 12, 10);
  put(f, 'pipe', 13, 10, { dir: 1 });
  put(f, 'mut', 11, 11, { mut: 1 });          // 1x2: 11-12
  put(f, 'pipe', 13, 11);                     // both arms merge here
  put(f, 'arm', 14, 11);
  put(f, 'pipe', 15, 11);
  put(f, 'depot', 16, 11);
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
  z.hp = 1e9;                    // this is about counting shots, not about being chewed
  for (let k = 0; k < 4; k++) spawnMite(f, 28.5, 25.5);
  run(f, 3);
  ok(f.zapped === 0, 'without Ammo it does nothing');
  ok(wants(z, AMMO) && !wants(z, 0), 'it takes Ammo and nothing else');
  z.buf.push({ id: 1, ty: AMMO, cp: 0 }, { id: 2, ty: AMMO, cp: 0 });
  run(f, 14);
  ok(f.zapped === 4, `with two Ammo it kills a small swarm (${f.zapped} of 4)`);
  ok(z.charge + z.buf.length * AMMO_CHARGES === 2 * AMMO_CHARGES - 8, 'spending two shots on each Mite');
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

console.log('\nSkitters');
{
  ok(MITE.hp > ZAP_DAMAGE[0] && MITE.hp <= 2 * ZAP_DAMAGE[0], `a Mite takes two shots from a base Zapper (${MITE.hp} hp, ${ZAP_DAMAGE[0]} a shot)`);
  ok(SKITTER.hp <= Math.min(...ZAP_DAMAGE), 'a Skitter dies to one shot from anything');
  ok(SKITTER.speed > MITE.speed && SKITTER.bite > MITE.bite, 'and is faster and bites harder');

  const f = bench();
  put(f, 'gen', 20, 20);
  put(f, 'depot', 21, 20);
  put(f, 'pipe', 30, 20);
  const sk = spawnMite(f, 20.5, 21.5, null, 'skitter');
  run(f, 4);
  ok(sk.tgt === cellOf(30, 20), 'a Skitter runs past a Generator and a Depot to get at a belt');
  run(f, 6);
  const belt = f.grid[cellOf(30, 20)];
  ok(belt.hp < MAX_HP.pipe, 'and chews it');
  const g = bench();
  put(g, 'gen', 20, 20);
  const lone = spawnMite(g, 20.5, 21.5, null, 'skitter');
  run(g, 3);
  ok(g.grid[cellOf(20, 20)].hp === maxHp(g.grid[cellOf(20, 20)]), 'with no belts on the map, it leaves everything else alone');

  const z = bench();
  put(z, 'zap', 25, 25);
  z.grid[cellOf(25, 25)].buf.push({ id: 1, ty: AMMO, cp: 0 });
  put(z, 'pipe', 26, 25);            // something for them to run at
  for (let k = 0; k < 3; k++) spawnMite(z, 28.5, 25.5, null, 'skitter');
  run(z, 4);
  ok(z.zapped === 3 && z.grid[cellOf(25, 25)].charge === AMMO_CHARGES - 3, 'one shot each');
}

console.log('\nSkitter nests');
{
  let worlds = 150, without = 0, tight = 0;
  for (let s = 1; s <= worlds; s++) {
    const n = placeNests(generateWorld(s * 104729));
    if (!n.some(x => x.kind === 'skitter')) without++;
    for (const a of n) for (const b of n) {
      if (a !== b && Math.max(Math.abs(a.cell % WORLD - b.cell % WORLD),
        Math.abs(Math.floor(a.cell / WORLD) - Math.floor(b.cell / WORLD))) < 6) tight++;
    }
  }
  ok(without === 0, `every one of ${worlds} worlds has Skitter nests`);
  ok(tight === 0, 'spaced like Mite nests: never within six slots of any other nest');
  ok(NESTS.skitter.hp === 1.5 * NESTS.mite.hp && NESTS.skitter.bounty === 10000,
    'a Skitter nest has 1.5x the health of a Mite nest and pays $10,000');

  const f = bench();
  f.waves = SKITTER_FROM + 4;
  f.nests = [{ cell: cellOf(5, 5), hp: NESTS.mite.hp, kind: 'mite' }, { cell: cellOf(50, 50), hp: NESTS.skitter.hp, kind: 'skitter' }];
  sendSwarm(f, 12);
  const nSk = f.mites.filter(m => m.kind === 'skitter').length;
  ok(nSk > 0 && nSk < 12, `later swarms are part Skitter (${nSk} of 12)`);
  const early = bench();
  early.nests = f.nests.map(n => ({ ...n }));
  sendSwarm(early, 12);
  ok(!early.mites.some(m => m.kind === 'skitter'), 'early swarms are all Mites');

  const s = bench();
  s.nests = [{ cell: cellOf(30, 25), hp: NESTS.skitter.hp, kind: 'skitter' }];
  put(s, 'zap', 26, 25);
  const zz = s.grid[cellOf(26, 25)];
  for (let k = 0; k < 6; k++) zz.buf.push({ id: 700 + k, ty: AMMO, cp: 0 });
  let skBrood = 0;
  for (let i = 0; i < 30 * 40; i++) {
    run(s, 1 / 30);
    for (const e of s.fx) if (e.k === 'brood' && e.kind === 'skitter') skBrood++;
    s.fx.length = 0;
  }
  ok(skBrood > 0, 'a Skitter nest under fire sends out Skitters');
  const cash = s.cash;
  s.nests[0].hp = 3; s.nests[0].anger = 0; s.mites.length = 0;
  zz.buf.push({ id: 999, ty: AMMO, cp: 0 });
  run(s, 3);
  ok(s.cash - cash === 10000, 'and pays $10,000 when it dies');
}

console.log('\nNew nests');
{
  const f = createFactory({ world: generateWorld(4242), cash: 1e6 });
  const cap = f.nestCap;
  ok(cap === f.nests.length && cap > 20, `a world's nest limit is what it started with (${cap})`);
  for (let i = 0; i < 30 * 30; i++) stepFactory(f, 1 / 30);
  ok(f.nests.length === cap, 'at the limit, no new nests appear');
  const gone = f.nests.splice(0, 3);
  const t0 = f.t;
  let first = null;
  for (let i = 0; i < 30 * 800 && f.nests.length < cap; i++) {
    stepFactory(f, 1 / 30);
    if (first == null && f.nests.length > cap - 3) first = f.t - t0;
  }
  ok(f.nests.length === cap, `below the limit, new nests dig in until it is reached again (${f.nests.length} of ${cap})`);
  ok(first != null && first >= NEST_POP_MIN, `not instantly (the first came after ${Math.round(first)}s)`);
  const lo = claimMin(f.claim) - 5, hi = claimMax(f.claim) + 5;
  const fresh = f.nests.slice(-3);
  ok(fresh.every(n => {
    const x = n.cell % WORLD, y = Math.floor(n.cell / WORLD);
    return !(x >= lo && x <= hi && y >= lo && y <= hi) && f.terrain[n.cell] === 0 && f.patch[n.cell] < 0;
  }), 'out in the wilds, clear of the fence, on open ground');
  const sk = f.nests.filter(n => n.kind === 'skitter').length;
  ok(sk === Math.round(cap * f.nestMix), `and the world keeps its mix of Skitter nests (${sk})`);
  for (let i = 0; i < 30 * 400; i++) stepFactory(f, 1 / 30);
  ok(f.nests.length === cap, 'and never goes over the limit');
  void gone;
}

console.log('\nCharged Ammo');
{
  const f = bench();
  put(f, 'fuse', 20, 20);
  const fu = f.grid[cellOf(20, 20)];
  ok(wants(fu, AMMO) && !wants(fu, CHARGED), 'a Fuser takes Ammo, and will not take Charged Ammo');
  put(f, 'pipe', 22, 20);                     // the Fuser is 1x2: 20-21
  put(f, 'depot', 23, 20);
  for (let k = 0; k < 4; k++) fu.buf.push({ id: 300 + k, ty: AMMO, cp: 0 });
  run(f, 8);
  ok(f.shipped[CHARGED] === 2, `two Ammo fuse into one Charged Ammo (${f.shipped[CHARGED]} from 4)`);

  const z = bench();
  put(z, 'zap', 25, 25);
  const zz = z.grid[cellOf(25, 25)];
  zz.buf.push({ id: 1, ty: AMMO, cp: 0 }, { id: 2, ty: CHARGED, cp: 0 });
  for (let k = 0; k < 3; k++) spawnMite(z, 28.5, 25.5);
  run(z, 0.2);
  zz.hot = 0; zz.charge = 0; zz.buf.length = 0;
  zz.buf.push({ id: 2, ty: CHARGED, cp: 0 });
  run(z, 6);
  ok(z.zapped === 3, `Charged Ammo kills a Mite with every shot (${z.zapped} of 3)`);
  ok(zz.hot === AMMO_CHARGES - 3, 'one charged shot each');

  const n = bench();
  n.nests = [{ cell: cellOf(30, 25), hp: NESTS.mite.hp, kind: 'mite' }];
  put(n, 'zap', 26, 25);
  const nz = n.grid[cellOf(26, 25)];
  nz.hot = 1; nz.charge = 1;
  run(n, 0.1);
  const afterHot = NESTS.mite.hp - n.nests[0].hp;
  run(n, 1.5);
  const afterPlain = NESTS.mite.hp - n.nests[0].hp - afterHot;
  ok(afterHot === 2 * afterPlain, `a charged shot does twice the damage (${afterHot} vs ${afterPlain}), and goes first`);
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
