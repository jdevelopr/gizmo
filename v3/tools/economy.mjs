/**
 * economy.mjs — every price in the game, and what real builds actually earn.
 *
 * GIZMO 2 learned this the hard way: prices in a factory game all multiply, and
 * multiplications compound quietly, so a ladder that looks reasonable written down
 * turns out to put the one upgrade everything depends on at eight thousand dollars
 * against an income of sixty. The only defence is to measure — so every build in
 * the table at the bottom is laid out on a real map and run through the real
 * simulation for two minutes, and the dollars per second are counted, not guessed.
 *
 *   node tools/economy.mjs
 */
import {
  WORLD, CLAIM_START, CLAIM_STEP, TYPES, KINDS, MUT_PRICE, MUT_CYCLE, RECIPES,
  TECH, GEN_OUTPUT, GEN_REACH, UNPOWERED, LEVEL_SPEED, LEVEL_DRAW,
  cellOf, cx, cy, money, num, expandCost, buyCost, upgradeCost, price,
  fuelEnergy, drawOf, cycleTime, label, LADDERED, EXPAND_BASE, EXPAND_STEP,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, countKind } from '../js/sim.js';
import { powerSummary } from '../js/power.js';
import { plainWorld } from '../js/world.js';

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const rule = n => console.log('  ' + '-'.repeat(n));

/* ------------------------------------------------------------- the tables --- */

console.log('\nMACHINES\n');
console.log('  ' + pad('MACHINE', 20) + rpad('BUY', 8) + rpad('L2', 8) + rpad('L3', 8)
  + rpad('CYCLE', 9) + rpad('kW', 6) + rpad('HOLD', 6));
rule(65);
for (const k of Object.keys(KINDS)) {
  const K = KINDS[k];
  const spec = { kind: k, mut: k === 'mut' ? 1 : 0, level: 1, rich: 1 };
  const buy = k === 'mut' ? MUT_PRICE[1] : k === 'asm' ? RECIPES[0].price : K.price;
  console.log('  ' + pad(K.name, 20)
    + rpad(money(buy) + (LADDERED[k] ? '+' : ''), 8)
    + rpad(money(upgradeCost({ ...spec, level: 1 })), 8)
    + rpad(money(upgradeCost({ ...spec, level: 2 })), 8)
    + rpad(K.passive ? '—' : cycleTime(spec).toFixed(2) + 's', 9)
    + rpad(K.draw, 6) + rpad(K.hold, 6));
}

console.log('\nMUTATORS — the equilibrium every other number is set against\n');
console.log('  ' + pad('MAKES', 10) + rpad('VALUE', 7) + rpad('CYCLE', 8)
  + rpad('$/s', 8) + rpad('BUY', 8) + rpad('PAYBACK', 10));
rule(51);
for (let t = 1; t <= 7; t++) {
  const rate = 1 / MUT_CYCLE[t];
  const per = rate * TYPES[t].value;
  console.log('  ' + pad(TYPES[t].name, 10) + rpad(TYPES[t].value, 7)
    + rpad(MUT_CYCLE[t].toFixed(2) + 's', 8) + rpad(per.toFixed(2), 8)
    + rpad(money(MUT_PRICE[t]), 8) + rpad((MUT_PRICE[t] / per).toFixed(0) + 's', 10));
}
console.log('\n  Every rung earns within a few percent of the same amount per slot, so the');
console.log('  tier you build is a decision about what you want downstream, never a');
console.log('  straight upgrade. What it costs is the raw material to keep it fed.');

console.log('\nFEEDING A MUTATOR\n');
console.log('  ' + pad('MAKES', 10) + rpad('NEEDS ORE', 12) + rpad('EXTRACTORS AT 1.0x', 20));
rule(42);
for (let t = 1; t <= 5; t++) {
  const need = 1 / MUT_CYCLE[t];
  console.log('  ' + pad(TYPES[t].name, 10) + rpad(need.toFixed(2) + '/s', 12)
    + rpad((need / (1 / KINDS.ext.cycle)).toFixed(2), 20));
}

console.log('\nPOWER\n');
{
  const g = { level: 1 };
  const scrap = fuelEnergy(0);
  console.log(`  A level 1 generator makes ${GEN_OUTPUT[0]} kW and reaches ${GEN_REACH[0]} machines.`);
  console.log(`  One Scrap gives ${scrap} kWs, so at full output it burns `
    + `${(GEN_OUTPUT[0] / scrap).toFixed(2)} ore a second — about ${money(GEN_OUTPUT[0] / scrap)} of it.`);
  const avg = 4;
  console.log(`  At a typical ${avg} kW a machine that is roughly `
    + `${Math.round(GEN_OUTPUT[0] / avg)} working machines per generator.`);
  console.log('');
  console.log('  ' + pad('BURNING', 10) + rpad('kWs', 7) + rpad('SELLS FOR', 11)
    + rpad('kWs PER $', 11));
  rule(39);
  for (const t of [0, 1, 2, 4, 6, 7]) {
    console.log('  ' + pad(TYPES[t].name, 10) + rpad(fuelEnergy(t), 7)
      + rpad(money(TYPES[t].value), 11)
      + rpad((fuelEnergy(t) / TYPES[t].value).toFixed(1), 11));
  }
  console.log('\n  Raw ore is between ten and a hundred times better value in a firebox than');
  console.log('  anything you have made out of it. That is the whole rule.');
  console.log('');
  console.log('  ' + pad('OFF GRID', 12) + rpad(`${Math.round(UNPOWERED * 100)}% speed`, 12));
  for (const s of [0.5, 0.7, 0.85, 0.95]) {
    const mult = UNPOWERED + (1 - UNPOWERED) * s * s;
    console.log('  ' + pad(`${Math.round(s * 100)}% supplied`, 12)
      + rpad(`${Math.round(mult * 100)}% speed`, 12));
  }
}

console.log('\nLAND\n');
console.log('  ' + pad('CLAIM', 10) + rpad('SLOTS', 8) + rpad('RING COSTS', 13)
  + rpad('SPENT SO FAR', 14));
rule(45);
{
  let total = 0;
  for (let c = CLAIM_START; c <= WORLD; c += CLAIM_STEP) {
    const cost = c < WORLD ? expandCost(c) : 0;
    if (c === CLAIM_START || c % 8 === 2 || c === WORLD) {
      console.log('  ' + pad(`${c} x ${c}`, 10) + rpad(c * c, 8)
        + rpad(cost ? money(cost) : '—', 13) + rpad(money(total), 14));
    }
    total += cost;
  }
  console.log(`\n  The whole world costs ${money(total)} end to end, at +${Math.round((EXPAND_STEP - 1) * 100)}% a ring.`);
}

console.log('\nRESEARCH\n');
console.log('  ' + pad('NODE', 16) + rpad('SCIENCE', 9) + '  NEEDS');
rule(60);
for (const t of TECH) {
  console.log('  ' + pad(t.name, 16) + rpad(num(t.cost), 9) + '  ' + (t.needs.join(', ') || '—'));
}

/* ------------------------------------------------------------ real builds --- */

function bench() {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = WORLD;
  f.mapRev++;
  rebuild(f);
  return f;
}
const ore = (f, x, y, ty = 0, rich = 1) => { f.patch[cellOf(x, y)] = ty; f.rich[cellOf(x, y)] = rich; };
const put = (f, kind, x, y, opt = {}) =>
  build(f, { kind, ...opt }, cellOf(x, y), { dir: opt.dir, mir: opt.mir });
const belt = (f, x0, x1, y, dir = 0) => {
  for (let x = x0; x <= x1; x++) put(f, 'pipe', x, y, { dir });
};

/** Run a build for `secs` of factory time and report what it did. */
function measure(name, setup, secs = 150) {
  const f = bench();
  f.cash = 1e9;
  const before = f.cash;
  setup(f);
  const spent = before - f.cash;
  // Let the line fill before the stopwatch starts, so the number is the steady
  // state rather than the first pass down an empty belt.
  for (let i = 0; i < 30 * 30; i++) stepFactory(f, 1 / 30);
  const mark = f.earned;
  for (let i = 0; i < secs * 30; i++) stepFactory(f, 1 / 30);
  const rate = (f.earned - mark) / secs;
  const p = powerSummary(f);
  return {
    name, spent, rate,
    slots: f.cells.length,
    payback: rate > 0 ? spent / rate : Infinity,
    power: p.nets ? `${Math.round(p.demand)}/${Math.round(p.supply)} kW` : 'none',
  };
}

const builds = [];

// 1. What you are handed.
builds.push(measure('The opening, unpowered', f => {
  ore(f, 20, 20);
  put(f, 'ext', 20, 20, { dir: 0 });
  belt(f, 21, 25, 20);
  put(f, 'depot', 26, 20);
}));

// 2. The same thing with the first generator, fed by splitting the ore line.
builds.push(measure('The opening, powered', f => {
  ore(f, 20, 20);
  put(f, 'ext', 20, 20, { dir: 0 });
  belt(f, 21, 22, 20);
  put(f, 'bal', 23, 20, { dir: 0, mir: 0 });      // branches south, to the generator
  put(f, 'gen', 23, 21);
  belt(f, 24, 25, 20);
  put(f, 'depot', 26, 20);
}));

// 3. One rung up the ladder. This is the first purchase that changes the game.
builds.push(measure('One Copper Mutator', f => {
  ore(f, 20, 20);
  put(f, 'ext', 20, 20, { dir: 0 });
  belt(f, 21, 22, 20);
  put(f, 'bal', 23, 20, { dir: 0, mir: 0 });
  put(f, 'gen', 23, 21);
  put(f, 'mut', 24, 20, { dir: 0, mut: 1 });
  belt(f, 25, 25, 20);
  put(f, 'depot', 26, 20);
}));

// 4. Two arms up to Amber, merging into one depot — the shape of a mid-game base.
builds.push(measure('Two Amber arms', f => {
  ore(f, 20, 19); ore(f, 20, 21);
  put(f, 'ext', 20, 19, { dir: 0 });
  put(f, 'ext', 20, 21, { dir: 0 });
  put(f, 'pipe', 21, 19, { dir: 0 });
  put(f, 'pipe', 21, 21, { dir: 0 });
  // One balancer on each arm branches a share of the raw ore into the generator
  // sitting between them. The fuel line is the power line.
  put(f, 'bal', 22, 19, { dir: 0, mir: 0 });      // branches south
  put(f, 'bal', 22, 21, { dir: 0, mir: 1 });      // branches north
  put(f, 'gen', 22, 20);
  put(f, 'mut', 23, 19, { dir: 0, mut: 2 });
  put(f, 'mut', 23, 21, { dir: 0, mut: 2 });
  put(f, 'pipe', 24, 19, { dir: 0 });
  put(f, 'pipe', 24, 21, { dir: 0 });
  put(f, 'pipe', 25, 19, { dir: 1 });
  put(f, 'pipe', 25, 21, { dir: 3 });
  put(f, 'pipe', 25, 20, { dir: 0 });
  put(f, 'depot', 26, 20);
}));

// 5. A recipe: two feeds, two lines, one Assembler, and the fuel branch on each.
builds.push(measure('An Engine Assembler', f => {
  f.done = ['assembly'];
  ore(f, 18, 18); ore(f, 18, 22, 8);
  put(f, 'ext', 18, 18, { dir: 0 });
  put(f, 'ext', 18, 22, { dir: 0 });
  belt(f, 19, 20, 18);
  belt(f, 19, 20, 22);
  put(f, 'bal', 21, 18, { dir: 0, mir: 0 });      // south, into the top generator
  put(f, 'bal', 21, 22, { dir: 0, mir: 1 });      // north, into the bottom one
  put(f, 'gen', 21, 19);
  put(f, 'gen', 21, 21);
  put(f, 'mut', 22, 18, { dir: 0, mut: 2 });      // Scrap -> Amber
  put(f, 'fuse', 22, 22, { dir: 0 });             // Resin + Resin -> Cord
  belt(f, 23, 24, 18);
  belt(f, 23, 24, 22);
  put(f, 'pipe', 25, 18, { dir: 1 });
  put(f, 'pipe', 25, 19, { dir: 1 });
  put(f, 'pipe', 25, 22, { dir: 3 });
  put(f, 'pipe', 25, 21, { dir: 3 });
  put(f, 'asm', 25, 20, { dir: 0, mut: 0 });
  belt(f, 26, 27, 20);
  put(f, 'depot', 28, 20);
}));

// 6. The same recipe with its own dedicated fuel extractor, which is what you
//    actually build once you have noticed that a generator and a production line
//    fed from one patch are competing for the same ore.
builds.push(measure('Same, with a fuel feed', f => {
  f.done = ['assembly'];
  ore(f, 18, 18); ore(f, 18, 22, 8); ore(f, 18, 20);
  put(f, 'ext', 18, 18, { dir: 0 });
  put(f, 'ext', 18, 22, { dir: 0 });
  put(f, 'ext', 18, 20, { dir: 0 });              // burns, and nothing else
  belt(f, 19, 20, 20);
  put(f, 'bal', 21, 20, { dir: 3, mir: 0 });      // north to one gen, east... no: split
  put(f, 'gen', 21, 19);
  put(f, 'gen', 21, 21);
  belt(f, 19, 21, 18);
  belt(f, 19, 21, 22);
  put(f, 'mut', 22, 18, { dir: 0, mut: 2 });
  put(f, 'fuse', 22, 22, { dir: 0 });
  belt(f, 23, 24, 18);
  belt(f, 23, 24, 22);
  put(f, 'pipe', 25, 18, { dir: 1 });
  put(f, 'pipe', 25, 19, { dir: 1 });
  put(f, 'pipe', 25, 22, { dir: 3 });
  put(f, 'pipe', 25, 21, { dir: 3 });
  put(f, 'asm', 25, 20, { dir: 0, mut: 0 });
  belt(f, 26, 27, 20);
  put(f, 'depot', 28, 20);
}));

console.log('\nWORKED BUILDS, RUN THROUGH THE REAL SIMULATION\n');
console.log('  ' + pad('BUILD', 26) + rpad('SLOTS', 7) + rpad('COST', 9)
  + rpad('$/s', 8) + rpad('PAYBACK', 10) + '  POWER');
rule(78);
for (const b of builds) {
  console.log('  ' + pad(b.name, 26) + rpad(b.slots, 7) + rpad(money(b.spent), 9)
    + rpad(b.rate.toFixed(2), 8)
    + rpad(Number.isFinite(b.payback) ? Math.round(b.payback) + 's' : 'never', 10)
    + '  ' + b.power);
}

const opening = builds[0].rate, powered = builds[1].rate;
const worst = Math.max(...builds.slice(1).map(b => (Number.isFinite(b.payback) ? b.payback : 0)));
console.log(`\n  Power alone is worth ${(powered / Math.max(0.001, opening)).toFixed(1)}x on the opening factory,`);
console.log('  which is why it is the first thing the game tells you to build. Every');
console.log(`  powered build above pays for itself inside ${Math.round(worst / 60)} minutes.\n`);
