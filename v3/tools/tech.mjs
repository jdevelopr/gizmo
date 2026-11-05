/**
 * tech.mjs — is the research tree sound, and does every node do what it says?
 *
 *   node tools/tech.mjs
 */
import {
  TECH, BRANCHES, techById, techOpen, catalogue, unlockedBy, unlockerOf, TECH_BONUS,
  bridgeSpan, tremorCost, beaconLoss, contractPremium, surveyed, zapDamage, zapCool,
  drawOf, travelTime, cycleTime, BRIDGE_SPAN, TREMOR_COST, BEACON_LOSS, CONTRACT_PREMIUM,
} from '../js/machines.js';

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
  ok(TECH.every(t => (t.needs || []).every(n => techById(n).cost <= t.cost)), 'nothing costs less than what it needs');
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
  ok(techById('defense').cost <= 150, 'Pest Control is cheap: the first swarm is only minutes away');
  ok(['pipe', 'bal', 'sort', 'ext', 'gen', 'depot', 'lab', 'mut', 'fuse'].every(k => unlockedBy([]).has(k)),
    'everything a factory needs to start is still unlocked');
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

console.log(fails ? `\n${fails} FAILED\n` : '\nThe tree is sound.\n');
process.exit(fails ? 1 : 0);
