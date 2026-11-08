/**
 * daynight.mjs — the asteroid's day and night, the Battery, and the Night Switch.
 *
 *   node tools/daynight.mjs
 */
import {
  WORLD, cellOf, lightAt, isNight, DAY_LEN, swarmLine, bruteLine, fogOf, FOG, NIGHT_FOG,
  SWARM_THRESHOLD, BRUTE_THRESHOLD, batteryCap, buyCost, unlockedBy, NOISE, TECH,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild } from '../js/sim.js';
import { balancePower } from '../js/power.js';
import { plainWorld } from '../js/world.js';
import { createGame, createStoryGame, serialise, deserialise } from '../js/game.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
function bench(dayNight = true) {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = WORLD; f.mapRev++; f.dayNight = dayNight; rebuild(f);
  return f;
}
const put = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true, dir: o.dir ?? 0 });
const at = (f, x, y) => f.grid[cellOf(x, y)];

console.log('\nThe clock');
{
  let night = 0, total = 0;
  for (let t = 0; t < DAY_LEN; t++) { total++; if (lightAt(t) < 0.5) night++; }
  ok(DAY_LEN === 600, 'one day is ten minutes');
  ok(Math.abs(night - 180) <= 2, `about three minutes of it is night (${night}s)`);
  ok(lightAt(200) === 1 && lightAt(500) === 0, 'midday is full light, midnight is none');
  ok(lightAt(390) > 0.45 && lightAt(390) < 0.55 && lightAt(0) === 1, 'a game opens in full day, and dusk fades through half light');
  const f = bench();
  f.t = 500;
  ok(isNight(f), 'the factory knows it is night');
  ok(swarmLine(f) === 3 && bruteLine(f) === 9, 'at night the nests wake at 3, Brutes at 9');
  ok(fogOf(f) === NIGHT_FOG, 'and you see 1 slot past the fence');
  f.t = 100;
  ok(swarmLine(f) === SWARM_THRESHOLD && bruteLine(f) === BRUTE_THRESHOLD && fogOf(f) === FOG, 'by day it is 5, 12 and 3');
  const off = bench(false); off.t = 500;
  ok(!isNight(off), 'a world without day and night is always day');
}

console.log('\nGames');
{
  ok(createGame({ seed: 7, teach: false }).f.dayNight === true, 'endless mode has day and night');
  ok(!createStoryGame(0, { seed: 7 }).f.dayNight && !createStoryGame(1, { seed: 7 }).f.dayNight, 'story worlds 1 and 2 do not');
  ok(createStoryGame(2, { seed: 7 }).f.dayNight && createStoryGame(7, { seed: 7 }).f.dayNight, 'story worlds 3 to 8 do');
}

console.log('\nSolar and the Battery');
{
  const f = bench();
  put(f, 'solar', 20, 20);
  put(f, 'battery', 21, 20);
  rebuild(f);
  f.t = 100;
  for (let i = 0; i < 60 * 30; i++) { f.t += 1 / 30; balancePower(f, 1 / 30); }
  const bat = at(f, 21, 20);
  ok((bat.charge || 0) > 500, `by day a Battery fills from a panel's spare power (${Math.round(bat.charge)} kJ)`);
  f.t = 500;
  balancePower(f, 1 / 30);
  ok(f.nets[0].supply === 0, 'at night the panel makes nothing');
  // Now give it something to power.
  const g = bench();
  put(g, 'solar', 20, 20); put(g, 'battery', 21, 20); put(g, 'pipe', 22, 20); put(g, 'pipe', 23, 20);
  rebuild(g);
  at(g, 21, 20).charge = 2000;
  g.t = 500;
  // pretend the belts are busy
  for (const x of [22, 23]) at(g, x, 20).buf.push({ id: x, ty: 0, cp: 0 });
  for (let i = 0; i < 30; i++) { g.t += 1 / 30; balancePower(g, 1 / 30); }
  ok(at(g, 21, 20).charge < 2000 && g.nets[0].sat > 0.9, `at night the Battery carries the grid (sat ${g.nets[0].sat.toFixed(2)})`);
  ok(batteryCap({ kind: 'battery', level: 5 }) > batteryCap({ kind: 'battery', level: 1 }) * 5, 'a level 5 Battery holds over five times as much');
  ok(buyCost({ kind: 'battery' }, 0) === 800 && buyCost({ kind: 'battery' }, 1) === 960, 'Batteries cost $800, then 1.2x each');
  ok(!unlockedBy([]).has('battery') && unlockedBy(['batteries']).has('battery'), 'Batteries research unlocks it');
}

console.log('\nNight Switch (shelved: not in the shop, but one in a save still works)');
ok(!unlockedBy(TECH.map(t => t.id)).has('nswitch'), 'no research unlocks the Night Switch');
{
  const f = bench();
  put(f, 'nswitch', 30, 30);
  put(f, 'pipe', 31, 30); put(f, 'pipe', 32, 30); put(f, 'pipe', 33, 30);
  put(f, 'zap', 30, 31);
  put(f, 'pipe', 40, 40);       // not touching anything
  rebuild(f);
  f.t = 100;
  stepFactory(f, 1 / 30);
  ok(!at(f, 33, 30).off, 'by day nothing is switched off');
  f.t = 470;
  stepFactory(f, 1 / 30);
  ok(at(f, 31, 30).off && at(f, 33, 30).off, 'at nightfall the run touching the switch goes off');
  ok(!at(f, 30, 31).off, 'but the Zapper is left on');
  ok(!at(f, 40, 40).off, 'and a belt that is not joined to it is not touched');
  // a hand on a machine wins until dawn
  const data = serialise({ f, story: null, contracts: [], done: new Set(), tut: -1 });
  f.t = 610;
  stepFactory(f, 1 / 30);
  ok(!at(f, 31, 30).off && !at(f, 33, 30).off, 'at dawn they come back on');
  ok(NOISE.nswitch === 0, 'the switch itself is silent');
  ok(data && data.machines.every(r => r[1] !== 'pipe' || r[6] === 0), 'a machine asleep for the night is saved awake');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nAll good.\n');
process.exit(fails ? 1 : 0);
