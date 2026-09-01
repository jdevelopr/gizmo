/**
 * power.mjs — proves the grid does what the manual says it does.
 *
 * Power is the one mechanic in GIZMO 3 that nobody has played before, so it is
 * the one that most needs a harness standing behind it. Every claim the how-to
 * page makes about electricity is asserted here against the real solver.
 *
 *   node tools/power.mjs
 */
import {
  WORLD, cellOf, GEN_OUTPUT, GEN_REACH, GRIDWORK_REACH, VOLTAGE_BONUS,
  COMBUSTION_BONUS, UNPOWERED, powerMult, fuelEnergy, drawOf, genReach, genOutput,
  energyOf, KINDS,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild } from '../js/sim.js';
import { solveTopology, balancePower, reachFrom, powerSummary } from '../js/power.js';
import { plainWorld } from '../js/world.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

/** A factory on flat ground with the whole world claimed and no starting kit. */
function bench() {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = WORLD;
  f.mapRev++;
  rebuild(f);
  return f;
}
/** Paint ore onto a slot, so an Extractor may stand there. */
function ore(f, x, y, ty = 0, rich = 1) {
  const i = cellOf(x, y);
  f.patch[i] = ty;
  f.rich[i] = rich;
}
const put = (f, kind, x, y, opt = {}) =>
  build(f, { kind, ...opt }, cellOf(x, y), { free: true, dir: opt.dir ?? 0 });
const run = (f, secs, step = 1 / 30) => { for (let i = 0; i < secs / step; i++) stepFactory(f, step); };

console.log('\nREACH');
{
  const f = bench();
  const y = 20;
  // A generator, then a straight line of belts running away from it.
  put(f, 'gen', 10, y);
  for (let x = 11; x < 11 + 20; x++) put(f, 'pipe', x, y, { dir: 0 });
  solveTopology(f);
  const reach = GEN_REACH[0];
  const at = n => f.grid[cellOf(10 + n, y)];
  ok(at(reach).net >= 0, `a machine exactly ${reach} hops away is powered`);
  ok(at(reach + 1).net < 0, `a machine ${reach + 1} hops away is not`,
    `net was ${at(reach + 1).net}`);
  ok(reachFrom(f, cellOf(10, y), { level: 1 }).size === reach + 1,
    'the build preview counts the same slots the solver does');
}

console.log('\nRESEARCH MOVES THE REACH');
{
  const f = bench();
  const y = 20;
  put(f, 'gen', 10, y);
  for (let x = 11; x < 11 + 24; x++) put(f, 'pipe', x, y, { dir: 0 });
  f.done = ['gridwork'];
  f.dirty = true;
  solveTopology(f);
  const reach = GEN_REACH[0] + GRIDWORK_REACH;
  ok(f.grid[cellOf(10 + reach, y)].net >= 0, `Gridwork carries power ${reach} hops`);
  ok(f.grid[cellOf(10 + reach + 1, y)].net < 0, 'and no further');
}

console.log('\nGAPS AND MERGES');
{
  const f = bench();
  // Two blocks of belt with one empty slot between them, a generator in each.
  put(f, 'gen', 10, 10);
  for (let x = 11; x <= 14; x++) put(f, 'pipe', x, 10);
  put(f, 'gen', 20, 10);
  for (let x = 16; x <= 19; x++) put(f, 'pipe', x, 10);
  solveTopology(f);
  ok(f.nets.length === 2, 'one empty slot between two blocks makes two grids',
    `saw ${f.nets.length}`);
  put(f, 'pipe', 15, 10);
  solveTopology(f);
  ok(f.nets.length === 1, 'one conveyor laid across the gap merges them',
    `saw ${f.nets.length}`);
  ok(f.nets[0].gens.length === 2, 'and the merged grid has both generators on it');
}

console.log('\nSUPPLY, DEMAND AND THE BROWNOUT');
{
  const f = bench();
  // One generator, and a solid block of mutators around it asking for more than
  // it makes. Fifteen at 8 kW is 120 against a 90 kW generator.
  put(f, 'gen', 20, 20);
  for (let y = 19; y <= 21; y++) {
    for (let x = 21; x <= 25; x++) put(f, 'mut', x, y, { mut: 1 });
  }
  solveTopology(f);
  // Fill every mutator's mouth so they all count as asking for power.
  for (const i of f.cells) {
    const m = f.grid[i];
    if (m && m.kind === 'mut') m.buf.push({ id: 1, ty: 0, cp: 0 });
  }
  f.grid[cellOf(20, 20)].buf.push({ id: 2, ty: 0, cp: 0 });
  for (let i = 0; i < 200; i++) balancePower(f, 1 / 30);
  const net = f.nets[0];
  ok(net.demand > net.supply, 'demand can exceed supply',
    `${net.demand.toFixed(0)} vs ${net.supply.toFixed(0)}`);
  ok(near(net.sat, Math.min(1, net.supply / net.demand), 0.03),
    'satisfaction settles at supply over demand',
    `sat ${net.sat.toFixed(3)} vs ${(net.supply / net.demand).toFixed(3)}`);
  const m = f.grid[cellOf(21, 20)];
  ok(near(powerMult(m.sat), powerMult(net.sat)), 'and every machine on it reads the same number');
  ok(powerMult(0.5) < 0.5, 'a half-fed grid runs at less than half speed',
    `${powerMult(0.5).toFixed(2)}`);
  ok(powerMult(1) === 1, 'a fully fed grid runs at full speed');
}

console.log('\nNOTHING SWITCHES OFF');
{
  const f = bench();
  // An extractor with no generator anywhere, belting into a depot.
  const y = 30;
  ore(f, 20, y);
  put(f, 'ext', 20, y, { dir: 0 });
  for (let x = 21; x <= 24; x++) put(f, 'pipe', x, y, { dir: 0 });
  put(f, 'depot', 25, y);
  run(f, 60);
  ok(f.earned > 0, 'an unpowered factory still earns', `earned ${f.earned}`);
  const rate = f.earned / 60;
  const full = 1 / (KINDS.ext.cycle);
  ok(near(rate / full, UNPOWERED, 0.06),
    `and it earns about ${Math.round(UNPOWERED * 100)}% of what a powered one would`,
    `measured ${(rate / full * 100).toFixed(1)}%`);

  // Now give it power and measure again.
  const g2 = bench();
  ore(g2, 20, y);
  put(g2, 'ext', 20, y, { dir: 0 });
  for (let x = 21; x <= 24; x++) put(g2, 'pipe', x, y, { dir: 0 });
  put(g2, 'depot', 25, y);
  put(g2, 'gen', 22, y + 1);
  g2.grid[cellOf(22, y + 1)].buf.push(...Array.from({ length: 20 }, () => ({ id: 1, ty: 0, cp: 0 })));
  run(g2, 60);
  ok(g2.earned > f.earned * 3, 'power is worth several times its own price in throughput',
    `powered ${Math.round(g2.earned)} vs unpowered ${Math.round(f.earned)}`);
}

console.log('\nFUEL');
{
  const f = bench();
  put(f, 'gen', 20, 20);
  for (let x = 21; x <= 26; x++) put(f, 'pipe', x, 20);
  const gen = f.grid[cellOf(20, 20)];
  gen.buf.push({ id: 1, ty: 0, cp: 0 });
  // Make the belts ask for power, so the generator has a load to answer.
  for (let x = 21; x <= 26; x++) f.grid[cellOf(x, 20)].buf.push({ id: 2, ty: 0, cp: 0 });
  balancePower(f, 1 / 30);
  const load = gen.load;
  ok(near(load, f.nets[0].demand, 0.5), 'one generator carries its grid on its own',
    `${load.toFixed(1)} kW of ${f.nets[0].demand.toFixed(1)}`);
  const before = gen.fuel;
  for (let i = 0; i < 30; i++) balancePower(f, 1 / 30);
  ok(near(before - gen.fuel, load, 0.6), 'and burns a kilowatt-second per kilowatt per second',
    `burned ${(before - gen.fuel).toFixed(1)} for ${load.toFixed(1)} kW`);

  ok(fuelEnergy(0) < fuelEnergy(7), 'a richer gizmo burns hotter');
  ok(fuelEnergy(7) / fuelEnergy(0) < 15 && 320 / 1 > 100,
    'but nothing like as much hotter as it is valuable — burning Prism is always wrong',
    `${(fuelEnergy(7) / fuelEnergy(0)).toFixed(1)}x the energy for 320x the price`);
  ok(near(energyOf(0, ['combustion']), fuelEnergy(0) * COMBUSTION_BONUS, 0.5),
    'Combustion makes every fuel last longer');
  ok(near(genOutput({ level: 1 }, ['voltage']), GEN_OUTPUT[0] * VOLTAGE_BONUS, 0.5),
    'High Voltage makes every generator bigger');
}

console.log('\nRUNNING DRY');
{
  const f = bench();
  put(f, 'gen', 20, 20);
  for (let x = 21; x <= 26; x++) put(f, 'pipe', x, 20);
  for (let x = 21; x <= 26; x++) f.grid[cellOf(x, 20)].buf.push({ id: 2, ty: 0, cp: 0 });
  const gen = f.grid[cellOf(20, 20)];
  gen.buf.push({ id: 1, ty: 0, cp: 0 });
  run(f, 120);
  ok(gen.fuel <= 0 && !gen.buf.length, 'a generator with nothing coming in runs out');
  ok(powerSummary(f).dry === 1, 'and the HUD says so');
  ok(f.grid[cellOf(23, 20)].sat < 0.05, 'its grid goes to nothing');
  ok(powerMult(f.grid[cellOf(23, 20)].sat) === UNPOWERED,
    'and everything on it drops to the unpowered floor rather than stopping');
}

console.log(fails ? `\n${fails} assertion(s) failed.` : '\nEvery claim the manual makes about power holds.');
process.exit(fails ? 1 : 0);
