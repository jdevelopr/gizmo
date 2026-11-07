/**
 * walls.mjs — the Wall.
 *
 *   node tools/walls.mjs
 *
 * A Wall is bought at $50 and each one after costs 1.1x the last; it takes no
 * gizmos, carries no power and makes no noise; creatures walk round it when they
 * can and chew through it when they cannot; and it grows tougher with level.
 */
import { WORLD, cellOf, buyCost, acceptsFrom, maxHp, broken, NOISE, catalogue, unlockedBy } from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild } from '../js/sim.js';
import { plainWorld } from '../js/world.js';
import { spawnMite } from '../js/bugs.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
function bench() {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = WORLD; f.mapRev++; rebuild(f);
  f.hum = 100;
  return f;
}
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0 });
const run = (f, secs) => { for (let i = 0; i < secs * 30; i++) stepFactory(f, 1 / 30); };
const walls = f => f.cells.map(i => f.grid[i]).filter(m => m?.kind === 'wall');

console.log('\nThe machine');
{
  ok(buyCost({ kind: 'wall' }, 0) === 50, 'the first Wall costs $50', `got ${buyCost({ kind: 'wall' }, 0)}`);
  ok(Math.abs(buyCost({ kind: 'wall' }, 1) - 55) <= 1, 'the second costs 1.1x ($55)', `got ${buyCost({ kind: 'wall' }, 1)}`);
  ok(Math.abs(buyCost({ kind: 'wall' }, 5) - 50 * 1.1 ** 5) <= 1, 'the sixth costs 50 x 1.1^5');
  ok(!unlockedBy([]).has('wall') && unlockedBy(['walls']).has('wall'), 'Walls research unlocks it');
  ok(NOISE.wall === 0, 'a Wall is silent');
  const lo = maxHp({ kind: 'wall', level: 1 }), hi = maxHp({ kind: 'wall', level: 5 });
  ok(hi > lo * 3, 'a level 5 Wall has over three times the hit points of a level 1', `${lo} -> ${hi}`);
  ok(maxHp({ kind: 'wall', level: 1 }, ['walls', 'walls', 'walls', 'walls', 'walls']) === lo * 2, 'rank V Walls research doubles them');
  const f = bench();
  put(f, 'wall', 40, 40);
  rebuild(f);
  const w = f.grid[cellOf(40, 40)];
  ok([0, 1, 2, 3].every(s => !acceptsFrom(w, s)), 'it takes gizmos from no side');
}

console.log('\nPower');
{
  const f = bench();
  put(f, 'solar', 30, 30);
  put(f, 'wall', 31, 30);
  put(f, 'pipe', 32, 30);
  put(f, 'pipe', 30, 31, { dir: 1 });
  rebuild(f); run(f, 1);
  ok(f.grid[cellOf(30, 31)].net >= 0, 'a belt touching the panel is powered (control)');
  ok(f.grid[cellOf(32, 30)].net < 0, 'a belt on the far side of a Wall is not', `net ${f.grid[cellOf(32, 30)].net}`);
}

console.log('\nJoining up');
{
  const f = bench();
  put(f, 'wall', 20, 20); put(f, 'wall', 21, 20); put(f, 'wall', 21, 21);
  rebuild(f);
  ok(f.grid[cellOf(21, 20)].link === (1 << 2 | 1 << 1), 'a Wall joins the Walls to its west and south', `mask ${f.grid[cellOf(21, 20)].link}`);
}

console.log('\nWalking round');
{
  // A belt behind a short wall, with an open way round: the mite should go round.
  const f = bench();
  put(f, 'pipe', 40, 40);
  for (let y = 37; y <= 43; y++) put(f, 'wall', 38, y);
  rebuild(f);
  const mt = spawnMite(f, 33.5, 40.5);
  mt.ox = 0; mt.oy = 0;
  run(f, 40);
  const hurt = walls(f).filter(w => w.hp != null && w.hp < maxHp(w, f.done) - 0.01).length;
  ok(hurt === 0, 'with a way round, no Wall is bitten', `${hurt} bitten`);
  const belt = f.grid[cellOf(40, 40)];
  ok(belt.hp != null && belt.hp < maxHp(belt, f.done), 'and the mite still reaches the belt behind it');
}

console.log('\nChewing through');
{
  // A belt boxed in on every side: the only way is through.
  const f = bench();
  put(f, 'pipe', 40, 40);
  for (let x = 38; x <= 42; x++) for (let y = 38; y <= 42; y++) {
    if (x === 38 || x === 42 || y === 38 || y === 42) put(f, 'wall', x, y);
  }
  rebuild(f);
  const mt = spawnMite(f, 33.5, 40.5);
  mt.ox = 0; mt.oy = 0;
  run(f, 20);
  const bitten = walls(f).filter(w => w.hp != null && w.hp < maxHp(w, f.done) - 0.01);
  ok(bitten.length >= 1, 'boxed out, the mite chews a Wall');
  ok(Math.hypot(mt.x - 40.5, mt.y - 40.5) > 1.5, 'and has not walked through it');
  const belt = f.grid[cellOf(40, 40)];
  ok(belt.hp == null || belt.hp >= maxHp(belt, f.done) - 0.01, 'the belt inside is untouched while the Wall stands');
  run(f, 200);
  ok(walls(f).some(broken), 'given long enough, it breaks through');
  ok(belt.hp != null && belt.hp < maxHp(belt, f.done), 'and then gets at the belt');
}

console.log('\nSkitters too');
{
  const f = bench();
  put(f, 'pipe', 40, 40);
  for (let x = 38; x <= 42; x++) for (let y = 38; y <= 42; y++) {
    if (x === 38 || x === 42 || y === 38 || y === 42) put(f, 'wall', x, y);
  }
  rebuild(f);
  const mt = spawnMite(f, 33.5, 40.5, null, 'skitter');
  mt.ox = 0; mt.oy = 0;
  run(f, 6);
  const belt = f.grid[cellOf(40, 40)];
  ok(belt.hp == null || belt.hp >= maxHp(belt, f.done) - 0.01, 'a Skitter is held up by a Wall as well');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nAll good.\n');
process.exit(fails ? 1 : 0);
