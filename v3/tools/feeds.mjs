/**
 * feeds.mjs — can one belt feed a machine that needs two things?
 *
 * This harness exists because the answer used to be no, and the way it was no was
 * the worst kind: silent, permanent, and indistinguishable on screen from a line
 * that was merely busy. Merging two feeds onto one belt — which is the obvious,
 * slot-saving thing to build, and the thing every screenshot of a real factory
 * shows — put one gizmo into an Assembler's single shared queue and then stopped
 * the entire factory forever the moment the next gizmo along was the same kind.
 *
 * Everything here is the same three builds run side by side: the mixed feed, the
 * separated feed, and the deliberately hopeless one. A mixed feed now has to earn
 * within a few percent of a separated one, and a hopeless one has to be *reported*
 * rather than merely being slow.
 *
 *   node tools/feeds.mjs
 */
import {
  WORLD, cellOf, TYPES, RECIPES, LANE, FUSE_LANES, STALL_BADGE,
  wants, canEverAccept, pickInputs, missingFor, capacity, KINDS,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, diagnose } from '../js/sim.js';
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
const ore = (f, x, y, ty = 0, r = 1) => { f.patch[cellOf(x, y)] = ty; f.rich[cellOf(x, y)] = r; };
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0, mir: o.mir });
const belt = (f, x0, x1, y, d = 0) => { for (let x = x0; x <= x1; x++) put(f, 'pipe', x, y, { dir: d }); };

/**
 * Run a factory at full power. These builds are about routing, not electricity,
 * and a brownout would only muddy the comparison.
 */
function spin(f, secs) {
  for (let i = 0; i < secs * 30; i++) {
    for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
    f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    stepFactory(f, 1 / 30);
  }
  return f;
}

/* ------------------------------------------------------------- the builds --- */

/** Two ores merged onto one belt, into one Fuser. */
function mixedFuser() {
  const f = bench();
  ore(f, 20, 19, 0); ore(f, 20, 21, 8);
  put(f, 'ext', 20, 19, { dir: 0 }); put(f, 'ext', 20, 21, { dir: 0 });
  belt(f, 21, 22, 19); belt(f, 21, 22, 21);
  put(f, 'pipe', 23, 19, { dir: 1 }); put(f, 'pipe', 23, 21, { dir: 3 });
  put(f, 'pipe', 23, 20, { dir: 0 });
  put(f, 'fuse', 24, 20, { dir: 0 });
  belt(f, 25, 26, 20);
  put(f, 'depot', 27, 20);
  return spin(f, 90);
}

/** An Assembler fed both ingredients down one belt. */
function mixedAssembler() {
  const f = bench();
  f.done = ['assembly'];
  ore(f, 18, 19, 0); ore(f, 18, 21, 8);
  put(f, 'ext', 18, 19, { dir: 0 }); put(f, 'ext', 18, 21, { dir: 0 });
  belt(f, 19, 20, 19); belt(f, 19, 20, 21);
  put(f, 'mut', 21, 19, { dir: 0, mut: 2 });
  put(f, 'fuse', 21, 21, { dir: 0 });
  put(f, 'pipe', 22, 19, { dir: 1 }); put(f, 'pipe', 22, 21, { dir: 3 });
  put(f, 'pipe', 22, 20, { dir: 0 });
  put(f, 'asm', 23, 20, { dir: 0, mut: 0 });
  belt(f, 24, 25, 20);
  put(f, 'depot', 26, 20);
  return spin(f, 120);
}

/** The same Assembler with its two ingredients on two faces, as before. */
function splitAssembler() {
  const f = bench();
  f.done = ['assembly'];
  ore(f, 18, 19, 0); ore(f, 18, 21, 8);
  put(f, 'ext', 18, 19, { dir: 0 }); put(f, 'ext', 18, 21, { dir: 0 });
  belt(f, 19, 20, 19); belt(f, 19, 20, 21);
  put(f, 'mut', 21, 19, { dir: 0, mut: 2 });
  put(f, 'fuse', 21, 21, { dir: 0 });
  belt(f, 22, 22, 19); belt(f, 22, 22, 21);
  put(f, 'pipe', 23, 19, { dir: 1 }); put(f, 'pipe', 23, 21, { dir: 3 });
  put(f, 'asm', 23, 20, { dir: 0, mut: 0 });
  belt(f, 24, 25, 20);
  put(f, 'depot', 26, 20);
  return spin(f, 120);
}

/* ------------------------------------------------------------------ tests --- */

console.log('\nONE BELT, TWO INGREDIENTS');
{
  const f = mixedFuser();
  const fu = f.grid[cellOf(24, 20)];
  ok(f.earned > 0, 'a Fuser fed Scrap and Resin down one belt keeps running',
    `earned ${Math.round(f.earned)}`);
  ok(f.shipped[1] > 0 && f.shipped[9] > 0,
    'and makes both Copper and Cord out of the one stream',
    `Copper ${f.shipped[1]}, Cord ${f.shipped[9]}`);
  ok(new Set(fu.buf.map(g => g.ty)).size <= FUSE_LANES,
    `it never queues more than ${FUSE_LANES} different types`);
}
{
  const mixed = mixedAssembler();
  const split = splitAssembler();
  ok(mixed.earned > 0, 'an Assembler fed both ingredients down one belt keeps running',
    `earned ${Math.round(mixed.earned)}`);
  const ratio = mixed.earned / Math.max(1, split.earned);
  ok(ratio > 0.9,
    'and earns within a tenth of the same build with its feeds separated',
    `one belt ${Math.round(mixed.earned)} vs two ${Math.round(split.earned)}`);
  ok(mixed.shipped[11] > 0, 'and actually ships Engines', `${mixed.shipped[11]}`);
}

console.log('\nQUEUES, NOT A SINGLE SLOT');
{
  const asm = { kind: 'asm', mut: 0, level: 1, buf: [] };
  const [a, b] = RECIPES[0].ins;
  for (let i = 0; i < LANE; i++) asm.buf.push({ ty: a });
  ok(!wants(asm, a), `an Assembler takes ${LANE} of one ingredient and then stops taking it`);
  ok(wants(asm, b), 'but still has room for the other one');
  ok(!pickInputs(asm), 'and will not start a job on one ingredient alone');
  asm.buf.push({ ty: b });
  const take = pickInputs(asm);
  ok(take && take.length === 2, 'once both are in, it starts');
  ok(new Set(take.map(i => asm.buf[i].ty)).size === 2,
    'taking one of each rather than the first two in the queue');
  ok(missingFor({ kind: 'asm', mut: 0, buf: [{ ty: a }] })[0] === b,
    'and it can say exactly which ingredient it is short of');
}
{
  const fuse = { kind: 'fuse', level: 1, buf: [{ ty: 0 }, { ty: 8 }] };
  ok(wants(fuse, 0) && wants(fuse, 8), 'a Fuser holds a queue for each of two types');
  ok(!wants(fuse, 1), 'and turns away a third');
  const take = pickInputs({ kind: 'fuse', buf: [{ ty: 0 }, { ty: 8 }, { ty: 0 }] });
  ok(take && take.length === 2, 'it fuses the first matching pair it has');
  ok(take[0] === 0 && take[1] === 2, 'skipping over what does not match');
}

console.log('\nA LINE THAT HAS STOPPED FOR GOOD SAYS SO');
{
  const f = bench();
  ore(f, 20, 20);
  put(f, 'ext', 20, 20, { dir: 0 });
  put(f, 'pipe', 21, 20, { dir: 0 });
  put(f, 'mut', 22, 20, { dir: 0, mut: 1 });        // Copper
  put(f, 'pipe', 23, 20, { dir: 0 });
  put(f, 'asm', 24, 20, { dir: 0, mut: 0 });        // wants Cord and Amber
  spin(f, 60);
  const d = diagnose(f);
  ok(d.jams.length > 0, 'feeding an Assembler something that is not an ingredient is reported');
  ok(/Copper/.test(d.jams[0]?.why || ''), 'and the report names the gizmo', d.jams[0]?.why);
  ok(/Assembler/.test(d.jams[0]?.why || ''), 'and what it is being pushed into');

  const g = bench();
  put(g, 'pipe', 30, 30, { dir: 0 });
  put(g, 'fuse', 31, 30, { dir: 0 });
  g.grid[cellOf(30, 30)].buf.push({ id: 1, ty: 11, cp: 0 });   // an Engine
  spin(g, 60);
  ok(diagnose(g).jams.length > 0, 'so is pushing a finished Product into a Fuser');

  const h = bench();
  ore(h, 40, 40);
  put(h, 'ext', 40, 40, { dir: 0 });
  put(h, 'pipe', 41, 40, { dir: 0 });
  put(h, 'mut', 42, 40, { dir: 0, mut: 1 });
  put(h, 'pipe', 43, 40, { dir: 0 });
  put(h, 'depot', 44, 40);
  spin(h, 60);
  ok(diagnose(h).jams.length === 0, 'and a line that is merely busy is not');
}

console.log('\nA BADGE IS FOR A STALL, NOT A HICCUP');
{
  // A saturated straight run blocks for a moment on nearly every cycle. None of
  // that should raise a badge.
  const f = bench();
  ore(f, 20, 20, 0, 2.5);
  put(f, 'ext', 20, 20, { dir: 0 });
  belt(f, 21, 30, 20);
  put(f, 'depot', 31, 20);
  spin(f, 60);
  const d = diagnose(f);
  ok(d.blocked === 0, 'a full-speed belt run raises no BACKED UP badges', `saw ${d.blocked}`);
  ok(f.earned > 60, 'while shipping the whole time', `earned ${Math.round(f.earned)}`);
  ok(STALL_BADGE >= 1, 'and the threshold is over a second');
}

console.log('\nROOM TO ABSORB A WOBBLE');
{
  ok(KINDS.asm.hold >= 2 * LANE + 1,
    'an Assembler has room for both full queues and what it is holding',
    `${KINDS.asm.hold} vs ${2 * LANE + 1}`);
  ok(KINDS.fuse.hold >= 2 * LANE + 1, 'and so does a Fuser');
  ok(canEverAccept({ kind: 'asm', mut: 0 }, RECIPES[0].ins[0]), 'an ingredient is always acceptable in principle');
  ok(!canEverAccept({ kind: 'asm', mut: 0 }, 0), 'and Scrap never is, to an Engine Assembler');
}

console.log(fails ? `\n${fails} problem(s).` : '\nOne belt can feed anything.\n');
process.exit(fails ? 1 : 0);
