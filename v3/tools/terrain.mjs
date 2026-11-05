/**
 * terrain.mjs — mountains, Mountain Drills, valleys, Bridges and Beetles.
 *
 *   node tools/terrain.mjs
 */
import {
  WORLD, cellOf, DIRS, MOUNTAIN, VALLEY, RUBBLE, OPEN, TYPES, BEETLE, ZAP_DAMAGE, CHARGED_MULT,
  TREMOR_COST, SWARM_GRACE, AMMO,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, buildCheck, mountainAhead } from '../js/sim.js';
import { plainWorld, generateWorld } from '../js/world.js';
import { spawnMite } from '../js/bugs.js';
import { serialise, deserialise, createGame } from '../js/game.js';

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
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), o.auto ? { free: true } : { free: true, dir: o.dir ?? 0 });
const at = (f, x, y) => f.grid[cellOf(x, y)];
const run = (f, secs, full = true) => {
  for (let i = 0; i < secs * 30; i++) {
    if (full) {
      for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
      f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    }
    stepFactory(f, 1 / 30);
  }
};
/** Hand-build a mountain on the bench. */
function mountain(f, cells, ty = 4, amount = 2000) {
  const id = f.mountains.length;
  const list = cells.map(([x, y]) => cellOf(x, y));
  for (const c of list) { f.terrain[c] = MOUNTAIN; f.mtn[c] = id; }
  f.mountains.push({ id, cells: list, ty, amount, left: amount });
  f.mapRev++;
  return f.mountains[id];
}

console.log('\nThe map');
{
  const c = (WORLD - 1) / 2;
  let fewM = 0, fewV = 0, near = 0, onOre = 0, inner = 0, outer = 0, ni = 0, no = 0;
  for (let s = 1; s <= 200; s++) {
    const w = generateWorld(s * 7919);
    let vCells = 0;
    for (let i = 0; i < w.terrain.length; i++) {
      if (w.terrain[i] !== MOUNTAIN && w.terrain[i] !== VALLEY) continue;
      if (w.terrain[i] === VALLEY) vCells++;
      const r = Math.max(Math.abs(i % WORLD - c), Math.abs(Math.floor(i / WORLD) - c));
      if (r < 8) near++;
      if (w.patch[i] >= 0) onOre++;
    }
    if (w.mountains.length < 8) fewM++;
    if (vCells < 30) fewV++;
    for (const m of w.mountains) {
      const r = Math.max(Math.abs(m.cells[0] % WORLD - c), Math.abs(Math.floor(m.cells[0] / WORLD) - c));
      if (r < 15) { inner += TYPES[m.ty].tier; ni++; } else { outer += TYPES[m.ty].tier; no++; }
    }
  }
  ok(!fewM, 'every world has at least eight mountains');
  ok(!fewV, 'and a good length of valley');
  ok(!near, 'none of either within eight rings of the middle');
  ok(!onOre, 'and none of either on top of ore');
  ok(outer / no > inner / ni, `seams are richer further out (tier ${(inner / ni).toFixed(1)} inside, ${(outer / no).toFixed(1)} out)`);
  const a = generateWorld(77), b = generateWorld(77);
  ok(a.terrain.every((t, i) => t === b.terrain[i]) && a.mountains.length === b.mountains.length,
    'mountains and valleys are a pure function of the seed');
  ok(plainWorld().mountains.length === 0, 'the test bench is flat');
}

console.log('\nMountain Drills');
{
  const f = bench();
  const mt = mountain(f, [[20, 20], [21, 20], [20, 21]], 4, 5);
  ok(!buildCheck(f, { kind: 'drill' }, cellOf(25, 25)).ok, 'a Drill will not stand away from a mountain');
  ok(!buildCheck(f, { kind: 'pipe' }, cellOf(20, 20)).ok, 'nothing can be built on a mountain');
  put(f, 'drill', 22, 20, { auto: true });
  const d = at(f, 22, 20);
  ok(d.dir === 2, `set down beside one, it turns to face it (facing ${d.dir})`);
  ok(mountainAhead(f, cellOf(22, 20)) === mt, 'and knows which mountain it is digging');
  put(f, 'pipe', 23, 20);
  put(f, 'depot', 24, 20);
  run(f, 60);
  ok(f.shipped[4] === 5, `it digs the seam — Cobalt — out of its back into the line (${f.shipped[4]} shipped)`);
  ok(mt.left === 0, 'until the mountain is empty');
  ok(mt.cells.every(c => f.terrain[c] === RUBBLE), 'and a worked-out mountain falls in to rubble');
  ok(!mountainAhead(f, cellOf(22, 20)), 'leaving the Drill with nothing to dig');
}

console.log('\nBridges');
{
  const f = bench();
  for (let y = 18; y <= 22; y++) { f.terrain[cellOf(21, y)] = VALLEY; f.terrain[cellOf(22, y)] = VALLEY; }
  f.mapRev++;
  ok(!buildCheck(f, { kind: 'pipe' }, cellOf(21, 20)).ok, 'nothing can be built in a valley');
  f.patch[cellOf(17, 20)] = 0; f.rich[cellOf(17, 20)] = 1;
  put(f, 'ext', 17, 20); put(f, 'pipe', 18, 20); put(f, 'pipe', 19, 20);
  put(f, 'bridge', 20, 20, { auto: true });
  ok(at(f, 20, 20).dir === 0, 'a Bridge on the edge of a valley faces across it');
  put(f, 'bridge', 23, 20, { auto: true });
  ok(at(f, 23, 20).dir === 0, 'and the far one lines up with it');
  ok(at(f, 20, 20).pair === cellOf(23, 20) && at(f, 20, 20).bin === 1 && at(f, 23, 20).bin === 2, 'they pair');
  put(f, 'pipe', 24, 20); put(f, 'depot', 25, 20);
  run(f, 30);
  ok(f.sold > 10, `gizmos cross the valley (${f.sold} sold on the far side)`);
  ok(f.lost === 0, 'and none fall in');

  // Power across: a generator on one side, an extractor powered on the other.
  const g = createFactory({ world: plainWorld(), cash: 1e9 });
  g.claim = WORLD; g.mapRev++;
  for (let y = 0; y < WORLD; y++) g.terrain[cellOf(30, y)] = VALLEY;
  rebuild(g);
  put(g, 'gen', 27, 30); put(g, 'pipe', 28, 30); put(g, 'bridge', 29, 30); put(g, 'bridge', 31, 30);
  g.patch[cellOf(32, 30)] = 0; put(g, 'ext', 32, 30);
  rebuild(g);
  ok(at(g, 32, 30).net >= 0 && at(g, 32, 30).net === at(g, 27, 30).net, 'power crosses a Bridge to the far bank');

  const h = bench();
  put(h, 'bridge', 10, 10); put(h, 'bridge', 12, 10); put(h, 'bridge', 14, 10); put(h, 'bridge', 16, 10);
  rebuild(h);
  ok(at(h, 10, 10).pair === cellOf(12, 10) && at(h, 14, 10).pair === cellOf(16, 10)
    && at(h, 12, 10).bin === 2 && at(h, 14, 10).bin === 1, 'a line of four pairs off two by two');
  put(h, 'bridge', 40, 40);
  ok(at(h, 40, 40).pair === -1, 'and a lone Bridge is just a belt');
}

console.log('\nBeetles');
{
  ok(BEETLE.hp === 60 && Math.ceil(BEETLE.hp / ZAP_DAMAGE[0]) === 10
    && Math.ceil(BEETLE.hp / (ZAP_DAMAGE[0] * CHARGED_MULT)) === 5, 'a Beetle takes ten plain or five charged shots at level 1');
  const f = bench();
  put(f, 'pipe', 22, 20); put(f, 'pipe', 23, 20);
  put(f, 'gen', 35, 20);
  const b = spawnMite(f, 20.5, 20.5, null, 'beetle');
  run(f, 2);
  ok(b.tgt === cellOf(35, 20), 'it walks past belts to get at a Generator');
  ok(b.sp < 0.5, 'slowly');

  const g = bench();
  const mt = mountain(g, [[20, 20], [21, 20]], 2, 100000);
  put(g, 'drill', 22, 20, { auto: true }); put(g, 'pipe', 23, 20); put(g, 'depot', 24, 20);
  run(g, 20);
  ok(!g.mites.length, 'drilling wakes nothing before the grace period');
  g.t = SWARM_GRACE;
  let woke = null;
  for (let i = 0; i < 30 * (TREMOR_COST + 30) && !woke; i++) {
    run(g, 1 / 30);
    woke = g.mites.find(m => m.kind === 'beetle');
  }
  ok(!!woke, 'a Drill at work wakes a Beetle');
  ok(woke && mt.cells.some(c => Math.hypot(c % WORLD + 0.5 - woke.x, Math.floor(c / WORLD) + 0.5 - woke.y) < 1.2),
    'out of the mountain being drilled');
}

console.log('\nSaving');
{
  const g = createGame({ seed: 4242, teach: false });
  const f = g.f;
  const mt = f.mountains[0];
  mt.left = 7;
  const m2 = f.mountains[1];
  m2.left = 0;
  for (const c of m2.cells) { f.terrain[c] = RUBBLE; f.mtn[c] = -1; }
  const back = deserialise(JSON.parse(JSON.stringify(serialise(g))));
  ok(back.f.mountains[0].left === 7, 'how much is left in a mountain survives a reload');
  ok(m2.cells.every(c => back.f.terrain[c] === RUBBLE && back.f.mtn[c] === -1), 'and so does one worked out to rubble');
  const data = serialise(g);
  const cell = f.mountains[2].cells[0];
  data.machines.push([cell, 'pipe', 0, 1, 1, 0, 0, 12, 0, 0]);
  const old = deserialise(JSON.parse(JSON.stringify(data)));
  ok(old.f.grid[cell]?.kind === 'pipe' && old.f.terrain[cell] === OPEN,
    'an old save with a machine where a mountain now is keeps the machine');
  void AMMO; void DIRS;
}

console.log(fails ? `\n${fails} FAILED\n` : '\nMountains, valleys, Bridges and Beetles all behave.\n');
process.exit(fails ? 1 : 0);
