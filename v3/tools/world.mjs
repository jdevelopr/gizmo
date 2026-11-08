/**
 * world.mjs — is every world playable?
 *
 * A generator that can produce an unplayable map will eventually produce one, and
 * it will do it on the night somebody sits down to play rather than on the day it
 * was written. So this walks several hundred seeds and asks the questions that
 * would ruin one: is there ore in the opening claim, is the starting corridor
 * clear, does the starter line actually run, is there anything worth expanding
 * toward, and does a seed replay identically.
 *
 *   node tools/world.mjs [count]
 */
import { WORLD, CLAIM_START, cellOf, claimMin, BEDROCK } from '../js/machines.js';
import { generateWorld, surveyWorld, SAP_MIN_RING, ORE_GAP, OPENING_RADIUS } from '../js/world.js';
import { createFactory, starterKit, stepFactory, rebuild } from '../js/sim.js';

const N = Number(process.argv[2]) || 400;
let fails = 0;
const bad = [];
const note = (seed, why) => { fails++; if (bad.length < 8) bad.push(`seed ${seed}: ${why}`); };

let minSlag = Infinity, minSap = Infinity, minOre = Infinity;
let richSum = 0, farRichSum = 0, rockSum = 0;
let minSapPatches = Infinity, minSlagPatches = Infinity;
let minOreGap = Infinity, nearestSap = Infinity, furthestSap = 0;

for (let seed = 1; seed <= N; seed++) {
  const w = generateWorld(seed);
  const s = surveyWorld(w);

  if (!s.startOnOre) note(seed, 'the starting extractor is not standing on ore');
  if (!s.corridorClear) note(seed, 'the opening corridor is blocked');
  // Every slot of the three-by-three opening is ore. On a nine-slot claim there is
  // no room to be picky about where an Extractor goes, so the map does not ask.
  if (s.slagIn !== CLAIM_START * CLAIM_START) {
    note(seed, `only ${s.slagIn} of the ${CLAIM_START * CLAIM_START} opening slots are Slag`);
  }
  if (s.sapIn) note(seed, `${s.sapIn} Sap slots inside the opening claim — Resin is meant to be a journey`);
  if (s.sapPatches < 4) note(seed, `only ${s.sapPatches} Sap patches in the whole world`);
  if (s.slagPatches < 8) note(seed, `only ${s.slagPatches} Slag patches in the whole world`);
  if (s.nearestSap < OPENING_RADIUS + 2) note(seed, `Sap only ${s.nearestSap} rings out`);
  if (s.closestDifferentOres < ORE_GAP - 3) {
    note(seed, `two different ores only ${s.closestDifferentOres} slots apart`);
  }
  if (s.patches < 15) note(seed, `only ${s.patches} patches in the whole world`);
  if (s.bestRich < 1.6) note(seed, `the richest patch anywhere is only ${s.bestRich.toFixed(2)}x`);

  // Bedrock never inside the opening claim: the first ten minutes is a factory,
  // not a maze.
  const lo = claimMin(CLAIM_START);
  let rock = false;
  for (let y = lo; y < lo + CLAIM_START && !rock; y++) {
    for (let x = lo; x < lo + CLAIM_START; x++) {
      if (w.terrain[cellOf(x, y)] === BEDROCK) { rock = true; break; }
    }
  }
  if (rock) note(seed, 'bedrock in the opening claim');

  // Is there anything worth walking to? At least one patch outside the opening
  // claim that beats what is inside it — otherwise expanding is only ever about
  // room, and the map has stopped being a reason to do anything.
  const inner = CLAIM_START / 2 + 1;
  const c = (WORLD - 1) / 2;
  const far = w.patches.filter(p => Math.max(Math.abs(p.x - c), Math.abs(p.y - c)) > inner);
  if (!far.length) note(seed, 'no patches at all outside the opening claim');
  else if (Math.max(...far.map(p => p.rich)) < 1.3) {
    note(seed, 'nothing outside the claim is worth expanding toward');
  }

  minSlag = Math.min(minSlag, s.slagIn);
  minSap = Math.min(minSap, s.sapIn);
  minOre = Math.min(minOre, s.ore);
  minSapPatches = Math.min(minSapPatches, s.sapPatches);
  minSlagPatches = Math.min(minSlagPatches, s.slagPatches);
  minOreGap = Math.min(minOreGap, s.closestDifferentOres);
  nearestSap = Math.min(nearestSap, s.nearestSap);
  furthestSap = Math.max(furthestSap, s.nearestSap);
  rockSum += s.rock;
  richSum += w.patches.reduce((a, p) => a + p.rich, 0) / w.patches.length;
  farRichSum += far.length ? far.reduce((a, p) => a + p.rich, 0) / far.length : 0;
}

console.log(`\n${N} worlds walked.\n`);
console.log(`  Slag slots in the ${CLAIM_START}x${CLAIM_START} opening         ${minSlag} of ${CLAIM_START ** 2}`);
console.log(`  Sap slots in the opening                ${minSap}`);
console.log(`  fewest ore slots in a whole world       ${minOre}`);
console.log(`  fewest Slag / Sap patches               ${minSlagPatches} / ${minSapPatches}`);
console.log(`  closest two different ores ever got     ${minOreGap} slots`);
console.log(`  nearest Sap, over all worlds            ${nearestSap} to ${furthestSap} rings out`);
console.log(`  average rock in an opening claim        ${(rockSum / N).toFixed(1)} of ${CLAIM_START ** 2} slots`);
console.log(`  average patch richness                  ${(richSum / N).toFixed(2)}x`);
console.log(`  average richness outside the claim      ${(farRichSum / N).toFixed(2)}x`);

/* --- a seed has to replay exactly, or a save file is worthless --------------- */
{
  const a = generateWorld(9182), b = generateWorld(9182);
  const same = a.terrain.every((v, i) => v === b.terrain[i])
    && a.patch.every((v, i) => v === b.patch[i])
    && a.rich.every((v, i) => Math.abs(v - b.rich[i]) < 1e-9);
  if (!same) { fails++; bad.push('a seed does not replay identically — every save is at risk'); }
  else console.log('\n  a seed replays identically, so a save file is only a seed and a diff');
}

/* --- the line the walkthrough asks for has to be buildable on any of them ----- */
/*
 * The map opens empty now and the first visit is walked through laying an
 * Extractor, a belt and a Depot by hand. That makes this the most important check
 * in the file: on every seed, the thing the walkthrough tells a brand new player
 * to build has to fit inside the opening claim and has to work.
 */
{
  const tried = Math.min(60, N);
  let dead = 0;
  for (let seed = 1; seed <= tried; seed++) {
    const f = createFactory({ seed, cash: 650 });
    starterKit(f);
    rebuild(f);
    for (let i = 0; i < 90 * 30; i++) stepFactory(f, 1 / 30);
    if (f.earned <= 0) { dead++; note(seed, 'the walkthrough line earned nothing in 90 seconds'); }
  }
  console.log(`  the line the walkthrough asks for works on ${tried - dead} of the first ${tried} seeds`);
}

if (bad.length) console.log('\n' + bad.map(b => '  ' + b).join('\n'));
console.log(fails ? `\n${fails} problem(s).` : '\nEvery world is playable.\n');
process.exit(fails ? 1 : 0);
