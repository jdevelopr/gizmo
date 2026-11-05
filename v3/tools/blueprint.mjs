/**
 * blueprint.mjs — selecting, copying, pasting and moving many machines at once.
 *
 *   node tools/blueprint.mjs
 */
import { WORLD, cellOf, buyCost } from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild } from '../js/sim.js';
import { plainWorld } from '../js/world.js';
import {
  areaCells, capture, rotateBp, plan, paste, lift, drop, putBack, upgradeAll, scrapAll, toggleArea,
} from '../js/blueprint.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
function bench(cash = 1e9) {
  const f = createFactory({ world: plainWorld(), cash });
  f.claim = WORLD; f.mapRev++; rebuild(f);
  return f;
}
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0 });
const line = f => {
  f.patch[cellOf(10, 10)] = 0; f.rich[cellOf(10, 10)] = 1;
  put(f, 'ext', 10, 10); put(f, 'pipe', 11, 10); put(f, 'mut', 12, 10, { mut: 2 }); put(f, 'pipe', 13, 10); put(f, 'depot', 14, 10);
};

console.log('\nSelecting');
{
  const f = bench(); line(f);
  ok(areaCells(f, cellOf(9, 9), cellOf(15, 11)).length === 5, 'a box picks up every machine inside it');
  ok(areaCells(f, cellOf(15, 11), cellOf(9, 9)).length === 5, 'whichever corner you start from');
  ok(areaCells(f, cellOf(30, 30), cellOf(31, 31)).length === 0, 'and nothing from empty ground');
}

console.log('\nCopy and paste');
{
  const f = bench(); line(f);
  const bp = capture(f, areaCells(f, cellOf(11, 10), cellOf(14, 10)));
  ok(bp.w === 4 && bp.h === 1 && bp.parts.length === 4, 'a copy is a blueprint of offsets');
  const p = plan(f, bp, cellOf(21, 20));
  const want = buyCost({ kind: 'pipe' }) * 2 + buyCost({ kind: 'mut', mut: 2 }) + buyCost({ kind: 'depot' }, 1);
  ok(p.cost === want, `the plan prices it, ladders and all ($${p.cost})`);
  const cash = f.cash;
  const r = paste(f, bp, cellOf(21, 20));
  ok(r.placed === 4 && cash - f.cash === want, 'pasting builds all of it and charges the plan');
  ok(f.grid[cellOf(21, 20)]?.kind === 'mut' && f.grid[cellOf(21, 20)].mut === 2, 'keeping every setting');
  const rot = rotateBp(bp);
  ok(rot.w === 1 && rot.h === 4 && rot.parts.every((q, k) => q.dir === (bp.parts[k].dir + 1) % 4), 'rotating turns the shape and every machine in it');
  const poor = bench(30); line(poor);
  const r2 = paste(poor, bp, cellOf(21, 30));
  ok(r2.broke && r2.placed < 4, 'running out of money stops it rather than overdrawing');
  ok(poor.cash >= 0, 'and never goes negative');
}

console.log('\nMoving');
{
  const f = bench(); line(f);
  const m = f.grid[cellOf(12, 10)];
  m.level = 2; m.hp = 7;
  const bp = lift(f, areaCells(f, cellOf(11, 10), cellOf(13, 10)));
  ok(!f.grid[cellOf(12, 10)], 'lifting takes the machines off the map');
  const cash = f.cash;
  const r = drop(f, bp, cellOf(31, 30));
  ok(r.moved === 3 && f.cash === cash, 'dropping them puts them down, free');
  ok(f.grid[cellOf(31, 30)] === m && m.level === 2 && m.hp === 7, 'the same machines, levels and scratches and all');
  const bp2 = lift(f, areaCells(f, cellOf(30, 30), cellOf(32, 30)));
  putBack(f, bp2);
  ok(f.grid[cellOf(31, 30)] === m, 'changing your mind puts every one back');
  const ext = lift(f, [cellOf(10, 10)]);
  const r3 = drop(f, ext, cellOf(62, 62));
  ok(r3.home === 1 && f.grid[cellOf(10, 10)]?.kind === 'ext', 'an Extractor dropped off ore goes home instead');
}

console.log('\nBulk verbs');
{
  const f = bench(); line(f);
  const cells = areaCells(f, cellOf(9, 9), cellOf(15, 11));
  const r = upgradeAll(f, cells);
  ok(r.n === 5, 'upgrade-all levels everything it can');
  ok(toggleArea(f, cells).off && cells.every(i => f.grid[i].off), 'switch-off switches them all off');
  ok(!toggleArea(f, cells).off && cells.every(i => !f.grid[i].off), 'and again switches them all on');
  const s = scrapAll(f, cells);
  ok(s.n === 5 && cells.every(i => !f.grid[i]), 'scrap-all clears the box');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nBoxes, blueprints and bulk verbs all work.\n');
process.exit(fails ? 1 : 0);
