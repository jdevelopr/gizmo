/**
 * sizes.mjs — the machines that cover more than one slot.
 *
 * Fusers and Mutators are one by two, laid along the flow. Every slot such a
 * machine covers points at the same object, and only its anchor is in `f.cells`.
 * This harness checks that the footprint is honoured everywhere it matters:
 * building, turning, moving, scrapping, feeding and power.
 *
 *   node tools/sizes.mjs
 */
import { WORLD, cellOf, cx, cy, footprint, sizeKind, frontOf, CLAIM_START } from '../js/machines.js';
import {
  createFactory, stepFactory, build, buildCheck, rebuild, moveMachine, scrapMachine,
} from '../js/sim.js';
import { solveTopology } from '../js/power.js';
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
  for (const k of ['fuse', 'mut']) ok(sizeKind(k) === 'long', `${k} is 1x2`);
  for (const k of ['gen', 'depot', 'lab', 'zap', 'arm', 'pipe', 'ext', 'asm']) ok(sizeKind(k) === 'one', `${k} is one slot`);
  ok(frontOf('fuse', cellOf(5, 5), 1) === cellOf(5, 6), 'a 1x2 has its front one slot along its facing');
  ok(footprint('fuse', cellOf(WORLD - 1, 5), 0) === null, 'and cannot hang off the edge of the world');

  const f = bench();
  put(f, 'fuse', 10, 10, { dir: 0 });
  const m = at(f, 10, 10);
  ok(at(f, 11, 10) === m && f.cells.filter(c => f.grid[c] === m).length === 1, 'building one stands it on both slots, listed once');

  // Your opening land: a 1x2 at the edge of the claim turns to fit inside it.
  const s = bench(false);
  const y = (WORLD - 1) >> 1;
  let edge = -1;
  for (let x = 0; x < WORLD - 1; x++) if (buildCheck(s, { kind: 'pipe' }, cellOf(x, y)).ok) edge = x;
  ok(edge > 0, `the opening claim is ${CLAIM_START} slots wide`);
  ok(!buildCheck(s, { kind: 'fuse' }, cellOf(edge, y), 0).ok, 'a 1x2 cannot point off land you do not own');
  const auto = buildCheck(s, { kind: 'fuse' }, cellOf(edge, y));
  ok(auto.ok && auto.dir !== 0, 'left to aim itself, it turns to fit', JSON.stringify(auto));
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
  put(f, 'depot', 24, 20, { dir: 0 });          // mouth west
  const mut = at(f, 20, 20);
  ok(mut.front === cellOf(21, 20), 'the Mutator\'s output slot is its front');
  spin(f, 40);
  ok(f.earned > 0, `fed at the back, it puts out the front into a Depot (earned ${Math.round(f.earned)})`);
}

console.log('\nMoving and scrapping');
{
  const f = bench();
  put(f, 'mut', 10, 10, { dir: 0, mut: 1 });
  const m = at(f, 10, 10);
  ok(moveMachine(f, cellOf(11, 10), cellOf(20, 20)).ok, 'a 1x2 can be picked up by its front slot');
  ok(!at(f, 10, 10) && !at(f, 11, 10), 'and moving it frees both');
  ok(at(f, 20, 20) === m && at(f, 21, 20) === m, 'and it stands on both at the new place');
  put(f, 'pipe', 31, 30);
  ok(moveMachine(f, cellOf(20, 20), cellOf(30, 30)).ok && f.crate.length === 1, 'dropped over a belt, the belt goes to the crate');
  ok(scrapMachine(f, cellOf(31, 30)).ok, 'scrapping by its front slot works');
  ok(!at(f, 30, 30) && !at(f, 31, 30) && !f.cells.length, 'and frees both slots');
}

console.log('\nPower through a 1x2');
{
  const f = bench();
  put(f, 'gen', 12, 10);
  put(f, 'fuse', 10, 10, { dir: 0 });   // front slot 11 touches the Generator
  put(f, 'asm', 15, 15);                // far away
  rebuild(f); solveTopology(f);
  ok(at(f, 10, 10).net >= 0, 'a Fuser touching a Generator with its front slot is powered');
  ok(at(f, 15, 15).net < 0, 'a machine not touching it is not');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nLong machines are long everywhere that matters.\n');
process.exit(fails ? 1 : 0);
