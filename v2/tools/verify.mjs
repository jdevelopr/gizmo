/**
 * verify.mjs — headless assertions over a whole match.
 *
 * Runs two players through a full game and checks the invariants that the claim
 * system introduced: nothing is ever built or delivered onto land a player does
 * not own, the vaults stay on the fence, growth never disturbs a machine, and the
 * wire view carries everything the phone needs to draw all of it.
 *
 *   node tools/verify.mjs
 */
import { createEngine } from '../js/game.js';
import * as M from '../js/machines.js';
import { layPath, setBotGrid } from './bot.mjs';
setBotGrid(M.GRID);

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log('  FAIL ', what); } };

const cfg = { rounds: 8, planSecs: 4, roundSecs: 45, tallySecs: 1, cash: 900, gridSize: 7 };
const eng = createEngine(cfg);
eng.addPlayer(0, 'GROWER', 0);
eng.addPlayer(1, 'SITTER', 1);
eng.startGame();

// Snapshot of every machine's slot and facing, to prove growth disturbs nothing.
const fingerprint = f => f.grid.map((m, i) => m ? `${i}:${m.kind}:${m.dir}:${m.level}` : '').join('|');
let beforeGrow = null, grewTo = 0, growthChecks = 0;

let t = 0, planDone = -1, shopDone = -1;
const dt = 1 / 30;
while (eng.phase !== 'over' && t < 6000) {
  const wasPlan = eng.phase === 'plan';
  eng.step(dt); t += dt;

  if (eng.phase === 'plan' && planDone !== eng.round) {
    planDone = eng.round;
    const p = eng.players.get(0);
    if (p.f.claim < M.GRID && p.f.cash > M.expandCost(p.f.claim)) {
      beforeGrow = fingerprint(p.f);
      const was = p.f.claim;
      eng.action(0, { t: 'expand' });
      if (p.f.claim > was) {
        growthChecks++;
        grewTo = p.f.claim;
        ok(fingerprint(p.f) === beforeGrow, `growth to ${p.f.claim} moved a machine`);
        // The map decides which faces the vaults trade from, so the invariant is
        // that each one sits where its generated position resolves to at this
        // claim — on the fence, riding outward as the plot grows.
        ok(p.f.seller.spots.every((v, k) => {
          const sp = p.f.layout.spots[k];
          return v.cell === M.faceCell(sp.face, sp.along, p.f.claim) && v.dir === sp.face;
        }), `vaults are not where the layout puts them at ${p.f.claim}`);
        ok(p.f.seller.spots.length === (p.f.claim >= M.SECOND_VAULT_CLAIM ? 2 : 1),
          `wrong vault count at ${p.f.claim}`);
      }
    }
    eng.action(0, { t: 'act', a: { a: 'upprod' } });
    // Reconnect to wherever this map's vault has ridden out to.
    layPath(eng, 0, p.f, p.f.seller.spots[0].cell, p.f.seller.spots[0].dir);
  }

  if (eng.phase === 'plan' && shopDone !== eng.round) {
    shopDone = eng.round;
    for (const seat of [0, 1]) eng.action(seat, { t: 'buy', i: 0 });
  }

  // Every tick, both floors: nothing may exist outside the claim.
  for (const seat of [0, 1]) {
    const f = eng.players.get(seat).f;
    for (let i = 0; i < f.grid.length; i++) {
      if (f.grid[i] && !M.claimed(i, f.claim)) { ok(false, `machine on unowned slot ${i}`); f.grid[i] = null; }
    }
    for (const g of f.gizmos) {
      if (g.cell >= 0 && !M.claimed(g.cell, f.claim)) ok(false, `gizmo bound for unowned slot ${g.cell}`);
    }
  }
  void wasPlan;
}

console.log(`match ran ${t.toFixed(0)}s of sim across ${cfg.rounds} rounds`);
ok(eng.phase === 'over', 'match never reached the final phase');
ok(growthChecks > 0, 'the growing player never actually grew');
console.log(`  grower reached ${grewTo}x${grewTo} over ${growthChecks} expansions`);

// Buying land is a planning-phase action only.
const p0 = eng.players.get(0);
const claimWas = p0.f.claim;
eng.action(0, { t: 'expand' });
ok(p0.f.claim === claimWas, 'land was sold outside the planning phase');

// Moving a machine onto unowned land must be refused.
const p1 = eng.players.get(1);
const far = M.cellOf(M.GRID - 1, M.GRID - 1);
eng.action(1, { t: 'act', a: { a: 'move', from: 'g0', to: 'g' + far } });
ok(!p1.f.grid[far], 'a machine was moved onto unowned land');
ok(!!p1.f.grid[0], 'the refused move emptied the source slot');

// The wire view has to carry the claim and the machine health flags.
const st = eng.stateFor(0);
ok(st.v.cl === p0.f.claim, 'view is missing the claim');
ok(typeof st.hud.expand === 'number', 'hud is missing the land price');
ok(st.hud.order && st.hud.order.target > 0, 'hud is missing the order');
const anyMachine = st.v.g.find(Boolean);
ok(anyMachine && 's' in anyMachine && 'r' in anyMachine, 'machine view is missing starved / rate');

// The sitter never grew, so its order should have outpaced it.
ok(p1.f.claim === M.CLAIM_START, 'the idle player somehow grew');
console.log(`  grower  $${Math.round(p0.f.earned)} · ${p0.filled} orders filled · ${p0.f.claim}x${p0.f.claim}`);
console.log(`  sitter  $${Math.round(p1.f.earned)} · ${p1.filled} orders filled · ${p1.f.claim}x${p1.f.claim}`);
ok(p0.filled >= p1.filled, 'growing filled fewer orders than sitting still');
ok(p0.f.earned > p1.f.earned, 'growing earned less than sitting still');

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
