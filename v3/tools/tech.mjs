/**
 * tech.mjs — is the research tree sound, and does every node do what it says?
 *
 *   node tools/tech.mjs
 */
import {
  TECH, BRANCHES, techById, techOpen, catalogue, unlockedBy, unlockerOf, TECH_BONUS,
  bridgeSpan, tremorCost, beaconLoss, contractPremium, surveyed, zapDamage, zapCool,
  drawOf, travelTime, cycleTime, BRIDGE_SPAN, TREMOR_COST, BEACON_LOSS, CONTRACT_PREMIUM,
  TECH_RANKS, ROMAN, rankOf, rankCost, zapRange, zapChain, genOutput, genReach, energyOf, yieldBonus,
  maxHp, MAX_LEVEL, LEVEL_SPEED, LEVEL_DRAW, GEN_OUTPUT, GEN_REACH, ZAP_RANGE, ZAP_DAMAGE, ZAP_COOL,
  levelCap, upgradeCost, TECH_COST_SCALE,
} from '../js/machines.js';
import { createFactory, research, build, rebuild, applyAction } from '../js/sim.js';
import { plainWorld } from '../js/world.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};

console.log('\nThe shape of the tree');
{
  ok(TECH.length >= 26, `it has ${TECH.length} nodes`);
  ok(new Set(TECH.map(t => t.id)).size === TECH.length, 'every id is unique');
  ok(TECH.every(t => (t.needs || []).every(n => techById(n))), 'every prerequisite exists');
  ok(TECH.every(t => BRANCHES.some(b => b.id === t.branch)), 'every node sits on a branch');
  // Everything can be reached by researching in some order.
  const done = [];
  for (let pass = 0; pass < TECH.length; pass++) {
    for (const t of TECH) if (!done.includes(t.id) && techOpen(t, done)) done.push(t.id);
  }
  ok(done.length === TECH.length, 'every node can eventually be researched (no cycles, no orphans)');
  ok(TECH.every(t => (t.needs || []).every(n => rankCost(techById(n), []) <= rankCost(t, []))), 'nothing costs less than what it needs');
  for (const b of BRANCHES) {
    const n = TECH.filter(t => t.branch === b.id).length;
    ok(n >= 5, `${b.name} has ${n} nodes`);
  }
}

console.log('\nDefence and Terrain have to be researched');
{
  const start = catalogue([]).map(c => c.kind);
  for (const k of ['arm', 'zap', 'drill', 'bridge']) {
    ok(!start.includes(k), `${k} is not on sale at the start`);
    const t = unlockerOf(k);
    ok(!!t && catalogue([t.id, ...(t.needs || [])]).some(c => c.kind === k), `${t?.name} unlocks it`);
  }
  ok(TECH.filter(t => !t.flat).every(t => rankCost(techById('defense'), []) <= rankCost(t, [])),
    'Pest Control is the cheapest node past the starter unlocks');
  ok(rankCost(techById('gridwork'), []) === techById('gridwork').cost * TECH_COST_SCALE, 'every price is scaled by TECH_COST_SCALE');
  ok(['pipe', 'ext', 'depot', 'lab'].every(k => unlockedBy([]).has(k))
    && catalogue([]).length === 4, 'a new game starts with Extractor, Conveyor, Depot and Lab, and nothing else');
  for (const k of ['gen', 'bal', 'sort', 'mut:1', 'fuse']) {
    const t = unlockerOf(k);
    ok(!unlockedBy([]).has(k) && t && t.flat && !(t.needs || []).length || (t && t.flat && t.needs.every(n => techById(n).flat)),
      `${k} is a cheap starter unlock (${t?.name}, ${t ? rankCost(t, []) : '?'} science)`);
  }
  ok(rankCost(techById('generators'), []) <= 60, 'the first unlock is a minute of Scrap, not twenty');
  for (let r = 1; r <= 7; r++) {
    const t = unlockerOf('mut:' + r);
    ok(!!t && catalogue([...(t.needs || []), t.id, 'mut1', 'mut2', 'mut3', 'mut4', 'mut5', 'mut6']).some(c => c.kind === 'mut' && c.mut === r),
      `the ${r}${['st','nd','rd'][r-1] || 'th'} Mutator rung is its own research (${t?.name})`);
  }
}

console.log('\nEvery bonus does what it says');
{
  const all = TECH.map(t => t.id);
  ok(bridgeSpan(all) === BRIDGE_SPAN + TECH_BONUS.span, 'Long Spans lengthens a Bridge pair');
  ok(tremorCost(all) === TREMOR_COST * TECH_BONUS.damper, 'Dampers makes drilling quieter');
  ok(beaconLoss(all) === BEACON_LOSS * TECH_BONUS.shield, 'Beacon Shielding halves what damage costs it');
  ok(contractPremium(all) === TECH_BONUS.market && contractPremium([]) === CONTRACT_PREMIUM, 'Market Savvy raises contract pay');
  ok(surveyed(['surveying']) && !surveyed([]), 'Surveying reveals the seams');
  const z = { kind: 'zap', level: 1 };
  ok(zapDamage(z, all) > zapDamage(z) && zapCool(z, all) < zapCool(z), 'Overcharge and Capacitors make Zappers stronger and quicker');
  const ext = { kind: 'ext', level: 1 };
  ok(drawOf(ext, all) < drawOf(ext), 'Efficient Motors cuts power draw');
  const belt = { kind: 'pipe', level: 1 };
  ok(travelTime(belt, all) < travelTime(belt), 'Express Belts speeds conveyors');
  const drill = { kind: 'drill', level: 1, mut: 4 };
  ok(cycleTime(drill, all) < cycleTime(drill), 'Hardened Bits speeds Mountain Drills');
}

console.log('\nFive ranks of everything');
{
  const f = createFactory({ world: plainWorld(), cash: 0 });
  f.science = 1e9;
  const costs = [];
  for (let k = 0; k < TECH_RANKS; k++) {
    costs.push(rankCost(techById('gridwork'), f.done));
    if (!f.done.includes('generators')) f.done.push('generators');
    ok(research(f, 'gridwork').ok, `Gridwork rank ${ROMAN[k + 1]} can be researched`);
  }
  ok(!research(f, 'gridwork').ok, 'and there is no rank VI');
  ok(costs[0] === 1800 && costs.every((c, k) => !k || c > costs[k - 1]), `each rank costs more than the last (${costs.join(', ')})`);
  ok(rankOf(f.done, 'gridwork') === 5, 'five ranks are counted');

  const r1 = TECH.map(t => t.id);
  const r5 = TECH.flatMap(t => Array(TECH_RANKS).fill(t.id));
  const z = { kind: 'zap', level: 1 };
  ok(zapDamage(z, r5) > zapDamage(z, r1), 'Overcharge V hits harder than I');
  ok(zapCool(z, r5) < zapCool(z, r1), 'Capacitors V recharges faster than I');
  ok(zapRange(z, r5) > zapRange(z, r1), 'Focusing V reaches further than I');
  ok(zapChain(r5) > zapChain(r1), 'Arc Discharge V chains further than I');
  ok(bridgeSpan(r5) > bridgeSpan(r1) && tremorCost(r5) > tremorCost(r1) && beaconLoss(r5) > beaconLoss(r1)
    && contractPremium(r5) > contractPremium(r1), 'Long Spans, Dampers, Shielding and Market Savvy all grow with rank');
  const gen = { kind: 'gen', level: 1 };
  ok(genOutput(gen, r5) > genOutput(gen, r1) && genReach(gen, r5) > genReach(gen, r1)
    && energyOf(0, r5) > energyOf(0, r1), 'and so do High Voltage, Gridwork and Combustion');
  ok(yieldBonus(r5) > yieldBonus(r1) && maxHp({ kind: 'pipe' }, r5) > maxHp({ kind: 'pipe' }, r1),
    'and Prospecting and Plating');
  const asm = { kind: 'asm', level: 1, mut: 0 };
  ok(cycleTime(asm, r5) < cycleTime(asm, r1), 'ranks of an unlock node speed up what it unlocks (Engine Assembler)');
  ok(drawOf({ kind: 'ext', level: 1 }, r5) < drawOf({ kind: 'ext', level: 1 }, r1), 'Efficient Motors V cuts more than I');
}

console.log('\nFive machine levels');
{
  ok(MAX_LEVEL === 5, 'machines go to level 5');
  for (const [name, arr] of Object.entries({ LEVEL_SPEED, LEVEL_DRAW, GEN_OUTPUT, GEN_REACH, ZAP_RANGE, ZAP_DAMAGE, ZAP_COOL })) {
    ok(arr.length === 5 && arr.every((v, k) => !k || v !== arr[k - 1]), `${name} has a value for every level`);
  }
  ok(levelCap([]) === 2, 'the ceiling starts at level 2');
  ok(levelCap(['overclock']) === 3 && levelCap(Array(3).fill('overclock')) === 5, 'each rank of Overclocking raises it a level, to 5');
  const m = { kind: 'mut', mut: 2, level: 4 };
  ok(upgradeCost(m, Array(5).fill('overclock')) < upgradeCost(m, Array(3).fill('overclock')),
    'and ranks IV and V make upgrades cheaper');
  const f = createFactory({ world: plainWorld(), cash: 1e9 });
  f.claim = 80; f.mapRev++; rebuild(f);
  f.done = Array(3).fill('overclock');
  build(f, { kind: 'mut', mut: 1 }, 100, { free: true });
  for (let k = 0; k < 4; k++) applyAction(f, { a: 'up', i: 100 });
  ok(f.grid[100].level === 5, 'a machine can be upgraded all the way to level 5');
  ok(!applyAction(f, { a: 'up', i: 100 }).ok, 'and no further');
  ok(cycleTime({ kind: 'mut', mut: 1, level: 5 }) < cycleTime({ kind: 'mut', mut: 1, level: 3 }), 'level 5 is faster than level 3');
  ok(cycleTime({ kind: 'dup', level: 5 }) < cycleTime({ kind: 'dup', level: 3 }), 'a Doubler\'s levels IV and V buy speed');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nThe tree is sound.\n');
process.exit(fails ? 1 : 0);
