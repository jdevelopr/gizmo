/**
 * beacon.mjs — the Launch Beacon: where it stands, how it is fed, how it is hurt,
 * and how it is won.
 *
 *   node tools/beacon.mjs
 */
import {
  WORLD, cellOf, BEACON, BEACON_SIZE, BEACON_INPUTS, BEACON_NEED, BEACON_HP, BEACON_LOSS, OPEN, DIRS,
} from '../js/machines.js';
import { createFactory, stepFactory, build, rebuild, jams } from '../js/sim.js';
import { generateWorld } from '../js/world.js';
import { mouthApproach, progress, hitBeacon, repairBeacon, beaconHot } from '../js/beacon.js';
import { placeNests, spawnMite } from '../js/bugs.js';
import { createGame, serialise, deserialise } from '../js/game.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
const run = (f, secs) => {
  for (let i = 0; i < secs * 30; i++) {
    for (const c of f.cells) { f.grid[c].net = 0; f.grid[c].sat = 1; }
    f.nets = [{ id: 0, gens: [], cells: f.cells, supply: 1e6, demand: 0, sat: 1, hot: 1 }];
    stepFactory(f, 1 / 30);
  }
};

console.log('\nWhere it stands');
{
  let bad = 0, corners = new Set(), nestNear = 0;
  for (let s = 1; s <= 150; s++) {
    const w = generateWorld(s * 104729);
    const b = w.beacon;
    if (!b) { bad++; continue; }
    const cx = b.x0 + 2, cy = b.y0 + 2;
    corners.add((cx > WORLD / 2 ? 1 : 0) + (cy > WORLD / 2 ? 2 : 0));
    if (Math.min(cx, cy, WORLD - 1 - cx, WORLD - 1 - cy) > 12) bad++;
    for (let y = b.y0; y < b.y0 + BEACON_SIZE; y++) for (let x = b.x0; x < b.x0 + BEACON_SIZE; x++) {
      if (w.terrain[cellOf(x, y)] !== BEACON) bad++;
    }
    for (let y = b.y0 - 3; y < b.y0 + BEACON_SIZE + 3; y++) for (let x = b.x0 - 3; x < b.x0 + BEACON_SIZE + 3; x++) {
      const i = cellOf(x, y);
      const inside = x >= b.x0 && x < b.x0 + BEACON_SIZE && y >= b.y0 && y < b.y0 + BEACON_SIZE;
      if (!inside && (w.terrain[i] !== OPEN || w.patch[i] >= 0)) bad++;
    }
    for (const n of placeNests(w)) {
      const x = n.cell % WORLD, y = Math.floor(n.cell / WORLD);
      if (Math.abs(x - cx) < 10 && Math.abs(y - cy) < 10) nestNear++;
    }
  }
  ok(!bad, 'every world has a 5x5 Beacon in a corner, with clear ground all round it');
  ok(corners.size === 4, 'and over many worlds it turns up in all four corners');
  ok(!nestNear, 'no nest digs in right beside it');
}

/** A world with the land bought out to the Beacon, and belts at its mouths. */
function setup() {
  const g = createGame({ seed: 31337, teach: false });
  const f = g.f;
  f.claim = WORLD; f.mapRev++; f.cash = 1e9; rebuild(f);
  return { g, f };
}
function feed(f, d, ty, n) {
  const c = mouthApproach(f, d);
  if (!f.grid[c]) build(f, { kind: 'pipe' }, c, { free: true, dir: (d + 2) % 4 });
  const p = f.grid[c];
  for (let k = 0; k < n; k++) p.buf.push({ id: 9000 + k, ty, cp: 0 });
  return p;
}

console.log('\nFeeding it');
{
  const { f } = setup();
  for (const [d, ty] of Object.entries(BEACON_INPUTS)) feed(f, +d, ty, 1);
  run(f, 3);
  ok(Object.values(f.beacon.got).every(n => n === 1), 'each mouth takes its own input from a belt pointing in');
  ok(beaconHot(f), 'and it counts as being fed');
  const p = feed(f, 3, 12, 1);              // a Turbine into the Engine mouth
  run(f, 4);
  ok(f.beacon.got[12] === 1 && (p.buf.length + p.work.length + (p.out?.length || 0)) > 0, 'a wrong item waits on the belt rather than vanishing');
  ok(jams(f).some(j => /Beacon/.test(j.why)), 'and the corner says what is wrong');
}

console.log('\nHurting it');
{
  const { f } = setup();
  f.beacon.got[11] = 100; f.beacon.got[13] = 50;
  hitBeacon(f, BEACON_LOSS * 10);
  const lost = 150 - f.beacon.got[11] - f.beacon.got[13];
  ok(lost === 10, `every ${BEACON_LOSS} damage knocks a delivered gizmo back out (${lost} for ${BEACON_LOSS * 10})`);
  ok(f.beacon.hp === BEACON_HP - BEACON_LOSS * 10, 'and costs health');
  hitBeacon(f, BEACON_HP);
  ok(f.beacon.hp === 0, 'it can be beaten down to nothing');
  feed(f, 3, 11, 1);
  const before = f.beacon.got[11];
  run(f, 3);
  ok(f.beacon.got[11] === before, 'and then takes nothing');
  ok(repairBeacon(f).ok && f.beacon.hp === BEACON_HP, 'until it is repaired');
  run(f, 3);
  ok(f.beacon.got[11] === before + 1, 'after which it takes again');

  const m = spawnMite(f, f.beacon.x0 - 6, f.beacon.y0 + 2);
  m.beacon = 1;
  const hp = f.beacon.hp;
  run(f, 15);
  ok(f.beacon.hp < hp, 'a creature sent for the Beacon walks to it and chews it');
}

console.log('\nAssaults and winning');
{
  const { f } = setup();
  for (const ty of Object.keys(BEACON_NEED)) f.beacon.got[ty] = Math.floor(BEACON_NEED[ty] * 0.26);
  f.fx.length = 0;
  run(f, 0.1);
  ok(f.fx.some(e => e.k === 'assault') || f.beacon.assaults === 1, 'a quarter of the way, an assault comes');
  ok(f.mites.length > 20 && f.mites.every(m => m.beacon), `of creatures all sent for the Beacon (${f.mites.length})`);
  f.mites.length = 0;
  for (const ty of Object.keys(BEACON_NEED)) f.beacon.got[ty] = BEACON_NEED[ty] - (ty === '7' ? 1 : 0);
  f.beacon.assaults = 3;
  feed(f, 2, 7, 1);
  run(f, 3);
  ok(f.beacon.done && progress(f) === 1, 'filling the last mouth lights it');
  ok(!beaconHot(f), 'and nothing comes for it after that');
}

console.log('\nSaving');
{
  const { g, f } = setup();
  f.beacon.got[11] = 123; f.beacon.hp = 456; f.beacon.assaults = 1;
  const back = deserialise(JSON.parse(JSON.stringify(serialise(g)))).f;
  ok(back.beacon.got[11] === 123 && back.beacon.hp === 456 && back.beacon.assaults === 1, 'progress, health and assaults survive a reload');
  void DIRS;
}

console.log(fails ? `\n${fails} FAILED\n` : '\nThe Beacon stands, feeds, bleeds and fires.\n');
process.exit(fails ? 1 : 0);
