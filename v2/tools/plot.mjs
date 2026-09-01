/**
 * plot.mjs — is every generated map actually playable?
 *
 * A generated map is the one feature that can hand a player an unwinnable game, and
 * it can do it on a seed nobody ever tries until the night it matters. So this
 * walks a few hundred of them and checks the things that would ruin a match: a
 * vault standing on bedrock, a feed walled in, a fixture that stops existing when
 * the plot grows, or two players handed different ground.
 *
 *   node tools/plot.mjs
 */
import * as M from '../js/machines.js';
import { createFactory, starterKit, routeBetween, portsOf, vaultsOf, labOf, openAt }
  from '../js/sim.js';

let fails = 0;
const ok = (c, what, detail = '') => {
  if (!c) { fails++; console.log('  FAIL  ' + what + (detail ? '  ' + detail : '')); }
};
const done = what => console.log('  ok    ' + what);

M.setGridSize(7);
const SEEDS = 400;
const PLOT = 7, START = M.CLAIM_START;

let bedrock = 0, rubble = 0, sameFace = 0, labNextToVault = 0, minLine = 99, maxLine = 0;

for (let seed = 1; seed <= SEEDS; seed++) {
  const layout = M.generatePlot(seed, PLOT, START);
  const f = createFactory({ cash: 0, claim: START, layout });
  starterKit(f);

  for (const t of layout.terrain) { if (t === M.BEDROCK) bedrock++; if (t === M.RUBBLE) rubble++; }

  // A fixture standing on blocked ground can never be traded with.
  for (let claim = START; claim <= PLOT; claim++) {
    f.claim = claim;
    for (const sp of [...layout.spots, layout.lab]) {
      const cell = M.faceCell(sp.face, sp.along, claim);
      ok(layout.terrain[cell] === M.OPEN,
        `seed ${seed}: a fixture sits on blocked ground at claim ${claim}`);
      ok(M.claimed(cell, claim), `seed ${seed}: a fixture is outside the claim at ${claim}`);
    }
    for (const port of portsOf(f)) {
      ok(layout.terrain[port.cell] === M.OPEN, `seed ${seed}: a feed is walled in at ${claim}`);
    }
  }
  f.claim = START;

  // Every feed must be able to reach every fixture, at every claim where both
  // exist — clearing rubble is allowed, moving bedrock is not.
  const soft = { ...f, terrain: layout.terrain.map(t => (t === M.RUBBLE ? M.OPEN : t)) };
  for (let claim = START; claim <= PLOT; claim++) {
    soft.claim = claim;
    for (const port of portsOf(soft)) {
      for (const target of [...vaultsOf(soft), labOf(soft)]) {
        ok(routeBetween(soft, port.cell, target.cell).length > 0,
          `seed ${seed}: no way through to a fixture at claim ${claim}`);
      }
    }
  }

  // The opening has to be playable with no money at all: the starter line is laid
  // for you, so it must exist.
  const line = f.grid.filter(Boolean).length;
  ok(line > 0, `seed ${seed}: the starter line could not be laid`);
  minLine = Math.min(minLine, line);
  maxLine = Math.max(maxLine, line);

  // Variety, not just legality.
  if (layout.spots[0].face === layout.spots[1].face) sameFace++;
  if (layout.lab.face === layout.spots[0].face
    && Math.abs(layout.lab.along - layout.spots[0].along) <= 0.5) labNextToVault++;
}

done(`${SEEDS} seeds: every fixture reachable, every feed open, every starter line laid`);
console.log(`        starter line ${minLine}-${maxLine} belts`);
console.log(`        ground: ${(bedrock / SEEDS).toFixed(1)} bedrock, ${(rubble / SEEDS).toFixed(1)} rubble per plot`);
console.log(`        both vaults on one face: ${Math.round(sameFace / SEEDS * 100)}%`
  + ` · Lab near the first vault: ${Math.round(labNextToVault / SEEDS * 100)}%`);

// Two players in one match must be handed the same ground.
{
  const layout = M.generatePlot(77, PLOT, START);
  const a = createFactory({ cash: 0, claim: START, layout });
  const b = createFactory({ cash: 0, claim: START, layout });
  ok(String(a.terrain) === String(b.terrain), 'two players got different terrain');
  ok(a.seller.spots[0].cell === b.seller.spots[0].cell, 'two players got different vaults');
  // ...and clearing rubble must not clear it for everyone.
  const stone = Array.from(a.terrain).findIndex(t => t === M.RUBBLE);
  if (stone >= 0) {
    a.terrain[stone] = M.OPEN;
    ok(b.terrain[stone] === M.RUBBLE, 'clearing rubble changed the other player\'s floor');
  }
  done('one map per match, one copy of it per player');
}

// The same seed must always give the same map, or "replay that one" is a lie.
{
  const one = M.generatePlot(4242, PLOT, START);
  const two = M.generatePlot(4242, PLOT, START);
  ok(String(one.terrain) === String(two.terrain), 'the same seed gave different ground');
  ok(JSON.stringify(one.spots) === JSON.stringify(two.spots), 'the same seed moved the vaults');
  const near = M.generatePlot(4243, PLOT, START);
  ok(String(one.terrain) !== String(near.terrain), 'neighbouring seeds gave the same map');
  done('a seed replays exactly, and its neighbour does not');
}

console.log(fails ? `\n${fails} FAILED` : '\nevery map is playable');
process.exit(fails ? 1 : 0);
