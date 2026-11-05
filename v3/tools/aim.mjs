/**
 * aim.mjs — do belts point somewhere sensible on their own?
 *
 *   node tools/aim.mjs
 */
import { WORLD, cellOf, DIRS } from '../js/machines.js';
import { createFactory, build, rebuild, applyAction, handoffDir, deadEnd } from '../js/sim.js';
import { plainWorld } from '../js/world.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
const E = 0, S = 1, W = 2, N = 3;
function bench() {
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = WORLD; f.mapRev++; rebuild(f);
  return f;
}
const at = (f, x, y) => f.grid[cellOf(x, y)];
const click = (f, k, x, y, o = {}) => build(f, { kind: k, ...o }, cellOf(x, y), { free: true });
const laid = (f, k, x, y, dir) => build(f, { kind: k }, cellOf(x, y), { free: true, dir });

console.log('\nA single belt');
{
  const f = bench();
  f.patch[cellOf(10, 10)] = 0;
  laid(f, 'ext', 10, 10, E);
  click(f, 'pipe', 11, 10);
  ok(at(f, 11, 10).dir === E, 'in front of an Extractor carries on the way it fires');
  laid(f, 'depot', 13, 13, W);
  click(f, 'pipe', 12, 10);
  ok(at(f, 12, 10).dir !== W, 'never turns back into what feeds it');
}
{
  const f = bench();
  laid(f, 'depot', 21, 10, W);
  click(f, 'pipe', 20, 10);
  ok(at(f, 20, 10).dir === E, 'beside a Depot mouth, points into it');
  const g = bench();
  laid(g, 'depot', 21, 10, N);          // mouth faces north: the west side is solid
  click(g, 'pipe', 20, 10);
  ok(at(g, 20, 10).dir !== E, 'beside the solid side of a Depot, does not point into the wall');
  const h = bench();
  h.patch[cellOf(21, 10)] = 0;
  laid(h, 'ext', 21, 10, E);
  click(h, 'pipe', 20, 10);
  ok(at(h, 20, 10).dir !== E, 'never points into the back of an Extractor');
}

console.log('\nExtending a run');
{
  const f = bench();
  for (let x = 10; x <= 13; x++) laid(f, 'pipe', x, 20, E);
  ok(deadEnd(f, cellOf(13, 20)), 'a run that stops in mid-air is a dead end');
  click(f, 'pipe', 13, 19);
  ok(at(f, 13, 20).dir === N, 'a belt put beside the end bends the run to meet it');
  ok(at(f, 13, 19).dir !== S, 'and the new belt carries on rather than pointing back');
  click(f, 'pipe', 12, 21);
  ok(at(f, 12, 20).dir === E, 'a belt in the middle of a working run is left alone');
}
{
  const f = bench();
  for (let x = 10; x <= 13; x++) laid(f, 'pipe', x, 30, E);
  applyAction(f, { a: 'rot', i: cellOf(13, 30) });
  applyAction(f, { a: 'rot', i: cellOf(13, 30) });
  applyAction(f, { a: 'rot', i: cellOf(13, 30) });
  applyAction(f, { a: 'rot', i: cellOf(13, 30) });   // back to east, but by hand
  click(f, 'pipe', 13, 29);
  ok(at(f, 13, 30).dir === E, 'a belt you turned by hand is never re-aimed');
}

console.log('\nThe end of a drag');
{
  const f = bench();
  laid(f, 'depot', 15, 41, N);           // mouth on top, beside the end of the run
  for (let x = 10; x <= 15; x++) laid(f, 'pipe', x, 40, E);
  ok(handoffDir(f, cellOf(15, 40)) === S, 'hands off to the Depot beside it');
  const g = bench();
  for (let x = 10; x <= 15; x++) laid(g, 'pipe', x, 40, E);
  ok(handoffDir(g, cellOf(15, 40)) === null, 'and with nothing beside it, keeps going the way you dragged');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nBelts aim themselves sensibly.\n');
process.exit(fails ? 1 : 0);
