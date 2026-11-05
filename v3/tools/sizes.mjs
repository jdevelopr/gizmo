/**
 * sizes.mjs — the machines that cover more than one slot.
 *
 * Generators, Market Depots, Research Labs and Zappers are two by two; Armories,
 * Fusers and Mutators are one by two, laid along the flow. Every slot such a
 * machine covers points at the same object, and only its anchor is in `f.cells`.
 * This harness checks that the footprint is honoured everywhere it matters:
 * building, turning, moving, scrapping, feeding, power and zapping.
 *
 *   node tools/sizes.mjs
 */
import { WORLD, cellOf, cx, cy, footprint, sizeKind, frontOf, CLAIM_START } from '../js/machines.js';
import {
  createFactory, stepFactory, build, buildCheck, rebuild, moveMachine, scrapMachine,
} from '../js/sim.js';
import { solveTopology } from '../js/power.js';
import { spawnMite } from '../js/bugs.js';
import { plainWorld } from '../js/world.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};

function bench(whole = true) {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  if (whole) { f.claim = WORLD; f.mapRev++; }
  rebuild(f);
  return f;
}
const at = (f, x, y) => f.grid[cellOf(x, y)];
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0 });
const spin = (f, secs) => {
  for (let i = 0; i < secs * 30; i++) {
    for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
    f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    stepFactory(f, 1 / 30);
  }
};

console.log('\nFootprints');
{
  for (const k of ['gen', 'depot', 'lab', 'zap']) ok(sizeKind(k) === 'big', `${k} is 2x2`);
  for (const k of ['arm', 'fuse', 'mut']) ok(sizeKind(k) === 'long', `${k} is 1x2`);
  for (const k of ['pipe', 'ext', 'asm']) ok(sizeKind(k) === 'one', `${k} is one slot`);
  const big = footprint('gen', cellOf(5, 5)).sort((a, b) => a - b);
  ok(JSON.stringify(big) === JSON.stringify([cellOf(5, 5), cellOf(6, 5), cellOf(5, 6), cellOf(6, 6)].sort((a, b) => a - b)),
    'a 2x2 covers its anchor and the three slots right and down');
  ok(footprint('gen', cellOf(WORLD - 1, 5)) === null, 'and cannot hang off the edge of the world');
  ok(frontOf('fuse', cellOf(5, 5), 1) === cellOf(5, 6), 'a 1x2 has its front one slot along its facing');

  const f = bench();
  put(f, 'depot', 10, 10);
  const d = at(f, 10, 10);
  ok([[10, 10], [11, 10], [10, 11], [11, 11]].every(([x, y]) => at(f, x, y) === d), 'building a 2x2 stands it on all four slots');
  ok(f.cells.filter(c => f.grid[c] === d).length === 1, 'and it is listed once');

  // Your opening land: the last owned slot in a row takes one-slot machines but not a 2x2.
  const s = bench(false);
  const y = (WORLD - 1) >> 1;
  let edge = -1;
  for (let x = 0; x < WORLD - 1; x++) if (buildCheck(s, { kind: 'pipe' }, cellOf(x, y)).ok) edge = x;
  ok(edge > 0, `the opening claim is ${CLAIM_START} slots wide`);
  ok(!buildCheck(s, { kind: 'gen' }, cellOf(edge, y)).ok, 'a 2x2 cannot stand half on land you do not own',
    buildCheck(s, { kind: 'gen' }, cellOf(edge, y)).msg);
  ok(buildCheck(s, { kind: 'gen' }, cellOf(edge - 1, y)).ok, 'but fits one slot further in');
}

console.log('\nTurning a 1x2');
{
  const f = bench();
  put(f, 'fuse', 10, 10, { dir: 0 });
  const m = at(f, 10, 10);
  ok(at(f, 11, 10) === m && !at(f, 10, 11), 'facing east it covers its slot and the one east');
  let r = build(f, { kind: 'fuse' }, cellOf(10, 10), { dir: 1 });
  ok(r.ok && at(f, 10, 11) === m && !at(f, 11, 10), 'turned south, it swings round its back slot');
  put(f, 'pipe', 9, 10, { dir: 0 });
  r = build(f, { kind: 'fuse' }, cellOf(10, 10), { dir: 2 });
  ok(!r.ok && m.dir === 1 && at(f, 10, 11) === m, 'it will not turn into a slot that is taken', r.msg);
  ok(f.cells.includes(cellOf(10, 10)) && !f.cells.includes(cellOf(10, 11)), 'only its back slot is an anchor');
}

console.log('\nFlow through a 1x2');
{
  const f = bench();
  f.patch[cellOf(18, 20)] = 0; f.rich[cellOf(18, 20)] = 1;
  put(f, 'ext', 18, 20, { dir: 0 });
  put(f, 'pipe', 19, 20, { dir: 0 });
  put(f, 'mut', 20, 20, { dir: 0, mut: 1 });   // 20 is fed, 21 puts out
  put(f, 'pipe', 22, 20, { dir: 0 });
  put(f, 'pipe', 23, 20, { dir: 0 });
  put(f, 'depot', 24, 20, { dir: 0 });          // 24-25 x 20-21, mouth west
  const mut = at(f, 20, 20);
  ok(mut.front === cellOf(21, 20), 'the Mutator\'s output slot is its front');
  spin(f, 40);
  ok(f.earned > 0, `fed at the back, it puts out the front into a Depot (earned ${Math.round(f.earned)})`);
}

console.log('\nA 2x2 mouth is its whole side');
{
  const f = bench();
  for (const y of [20, 21]) {
    f.patch[cellOf(20, y)] = 0; f.rich[cellOf(20, y)] = 1;
    put(f, 'ext', 20, y, { dir: 0 });
    put(f, 'pipe', 21, y, { dir: 0 });
  }
  put(f, 'depot', 22, 20, { dir: 0 });
  spin(f, 30);
  const one = (() => {
    const g = bench();
    g.patch[cellOf(20, 20)] = 0; g.rich[cellOf(20, 20)] = 1;
    put(g, 'ext', 20, 20, { dir: 0 }); put(g, 'pipe', 21, 20, { dir: 0 });
    put(g, 'depot', 22, 20, { dir: 0 });
    spin(g, 30);
    return g.earned;
  })();
  ok(one > 0 && f.earned > one * 1.6, `two belts into both slots of one side both sell (${Math.round(f.earned)} vs ${Math.round(one)} for one)`);
}

console.log('\nMoving and scrapping');
{
  const f = bench();
  put(f, 'gen', 10, 10);
  const g = at(f, 10, 10);
  ok(moveMachine(f, cellOf(11, 11), cellOf(20, 20)).ok, 'a 2x2 can be picked up by any of its slots');
  ok([[10, 10], [11, 10], [10, 11], [11, 11]].every(([x, y]) => !at(f, x, y)), 'and moving it frees all four');
  ok([[20, 20], [21, 20], [20, 21], [21, 21]].every(([x, y]) => at(f, x, y) === g), 'and it stands on all four at the new place');
  put(f, 'pipe', 31, 30);
  ok(moveMachine(f, cellOf(20, 20), cellOf(30, 30)).ok && f.crate.length === 1, 'dropped over a belt, the belt goes to the crate');
  ok(scrapMachine(f, cellOf(31, 31)).ok, 'scrapping by a corner slot works');
  ok([[30, 30], [31, 30], [30, 31], [31, 31]].every(([x, y]) => !at(f, x, y)) && !f.cells.length, 'and frees every slot');
}

console.log('\nPower from a 2x2 Generator');
{
  const f = bench();
  put(f, 'gen', 10, 10);
  put(f, 'asm', 12, 11);       // touching its east side, lower slot
  put(f, 'asm', 11, 12);       // touching its south side, right slot
  put(f, 'asm', 15, 15);       // far away
  rebuild(f); solveTopology(f);
  ok(at(f, 12, 11).net >= 0 && at(f, 11, 12).net >= 0, 'machines touching any of its slots are on its grid');
  ok(at(f, 15, 15).net < 0, 'a machine not touching it is not');
}

console.log('\nA 2x2 Zapper fires from its middle');
{
  const f = bench();
  put(f, 'zap', 25, 25);
  const z = at(f, 25, 25);
  z.hp = 1e9;
  z.buf.push({ id: 1, ty: 25, cp: 0 });
  z.charge = 10;
  spawnMite(f, 29, 26);
  let shot = null;
  for (let i = 0; i < 30 * 6 && !shot; i++) {
    for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
    f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    stepFactory(f, 1 / 30);
    shot = f.fx.find(e => e.k === 'zap');
  }
  ok(!!shot, 'it fires');
  ok(shot && shot.path[0][0] === 26 && shot.path[0][1] === 26, 'from the centre of its four slots', shot && JSON.stringify(shot.path[0]));
}

console.log(fails ? `\n${fails} FAILED\n` : '\nBig machines are big everywhere that matters.\n');
process.exit(fails ? 1 : 0);
