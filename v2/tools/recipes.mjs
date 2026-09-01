/**
 * recipes.mjs — do two lines actually have to meet, and does it work when they do?
 *
 * The Assembler is the first machine in GIZMO whose inputs are not
 * interchangeable, which makes it the first machine that can deadlock: fill both
 * hands with the same ingredient and it waits forever for a partner that can no
 * longer fit. Everything here is about proving that cannot happen, and that the
 * chain it sits at the end of really does run.
 *
 *   node tools/recipes.mjs
 */
import { createFactory, stepFactory, beginRound, expandFloor, portsOf } from '../js/sim.js';
import {
  makeMachine, cellOf, setGridSize, TYPES, RECIPES, wants, outputs,
  RESIN_CLAIM, famOf, PART, PRODUCT, plainPlot,
} from '../js/machines.js';
import * as M from '../js/machines.js';

setGridSize(7);
let fails = 0;
const ok = (c, what, detail = '') => {
  if (!c) { fails++; console.log('  FAIL  ' + what + (detail ? '  ' + detail : '')); }
  else console.log('  ok    ' + what + (detail ? '  ' + detail : ''));
};
const put = (f, x, y, spec) => { f.grid[cellOf(x, y)] = makeMachine(spec, f.nid++); };
const nm = ty => TYPES[ty].name;

/* --- the second feed opens with the land ---------------------------------- */
{
  const f = createFactory({ cash: 0, claim: 3, layout: plainPlot() });
  ok(portsOf(f).length === 1, 'one feed on the opening claim');
  expandFloor(f);
  const ports = portsOf(f);
  ok(f.claim === RESIN_CLAIM && ports.length === 2, `a second feed opens at ${RESIN_CLAIM}x${RESIN_CLAIM}`);
  ok(ports[0].ty === 0 && ports[1].ty === 8, 'the feeds drop Scrap and Resin', ports.map(p => nm(p.ty)).join(' + '));
  ok(ports[0].cell !== ports[1].cell, 'the feeds enter at different slots');
}

/* --- an assembler never fills both hands with the same thing --------------- */
{
  const a = makeMachine({ kind: 'asm', dir: 0, mut: 0 }, 1);
  const r = RECIPES[0];
  ok(wants(a, r.ins[0]) && wants(a, r.ins[1]), 'empty assembler wants both ingredients');
  ok(!wants(a, 0), 'assembler refuses something that is not an ingredient');
  a.buf.push({ id: 1, ty: r.ins[0], cp: 0 });
  ok(!wants(a, r.ins[0]), 'assembler refuses a second of the ingredient it holds');
  ok(wants(a, r.ins[1]), 'assembler still wants the one it is missing');
  a.buf.push({ id: 2, ty: r.ins[1], cp: 0 });
  ok(!wants(a, r.ins[0]) && !wants(a, r.ins[1]), 'a fully loaded assembler wants nothing');
  ok(outputs(a, a.buf)[0].ty === r.out, `it makes a ${nm(r.out)}`);
}

/* --- fusers climb their own family and refuse to mix ----------------------- */
{
  const fu = makeMachine({ kind: 'fuse', dir: 0 }, 1);
  ok(famOf(outputs(fu, [{ ty: 8, cp: 0 }, { ty: 8, cp: 0 }])[0].ty) === PART, 'Resin fuses into a Part');
  ok(outputs(fu, [{ ty: 9, cp: 0 }, { ty: 9, cp: 0 }])[0].ty === 10, 'Cord + Cord makes a Frame');
  ok(outputs(fu, [{ ty: 10, cp: 0 }, { ty: 10, cp: 0 }])[0].ty === 10, 'a Frame is the top of its family');

  // Levels buy speed and nothing else: the same pair makes the same thing at every
  // level, and only the clock changes.
  for (const [a1, b1] of [[0, 0], [2, 2], [8, 8], [1, 3]]) {
    const at = l => outputs({ ...fu, level: l }, [{ ty: a1, cp: 0 }, { ty: b1, cp: 0 }])[0].ty;
    ok(at(1) === at(2) && at(2) === at(3),
      `${nm(a1)} + ${nm(b1)} makes ${nm(at(1))} at every level`);
  }
  const cyc = l => M.cycleTime({ kind: 'fuse', level: l });
  ok(cyc(3) < cyc(2) && cyc(2) < cyc(1), 'and each level is faster than the last',
    [1, 2, 3].map(l => `L${l} ${cyc(l).toFixed(2)}s`).join(' '));
  ok((cyc(2) - cyc(3)) > (cyc(1) - cyc(2)) * 0.6, 'with the second upgrade the bigger step');

  // A Mutator makes what it is set to, whatever it is fed and whatever its level.
  for (const l of [1, 2, 3]) {
    const m = { kind: 'mut', dir: 0, level: l, mut: 2 };
    const outs = [0, 4, 7, 10].map(ty => outputs(m, [{ ty, cp: 0 }])[0].ty);
    ok(outs.every(o => o === 2), `a level ${l} Amber Mutator always makes Amber`,
      outs.map(nm).join(','));
  }
  ok(outputs(fu, [{ ty: 0, cp: 0 }, { ty: 0, cp: 0 }])[0].ty === 1, 'the alloy ladder is unchanged');
  fu.buf.push({ id: 1, ty: 8, cp: 0 });
  ok(!wants(fu, 0), 'a fuser holding Resin refuses Scrap');
  ok(wants(fu, 8), 'a fuser holding Resin still wants Resin');
  fu.buf.length = 0;
  ok(!wants(fu, 11), 'nothing fuses a finished product');
}

/* --- the whole chain, running ---------------------------------------------- */
{
  // Two feeds, two lines, one Assembler where they meet, one belt to the vault.
  //
  //   A(Scrap) > [Amber Mutator] > belt south
  //                                    v
  //   B(Resin) > [Fuser: Cord]  > [ASSEMBLER ] > belt north > belt east > VAULT
  const f = createFactory({ cash: 0, claim: 3, layout: plainPlot() });
  expandFloor(f);                              // 4x4, which is where Resin starts
  put(f, 0, 0, { kind: 'mut', dir: 0, mut: 2 });      // Scrap -> Amber
  put(f, 1, 0, { kind: 'pipe', dir: 1 });             // Amber south into the assembler
  put(f, 0, 1, { kind: 'fuse', dir: 0 });             // Resin + Resin -> Cord
  put(f, 1, 1, { kind: 'asm', dir: 0, mut: 0 });      // Cord + Amber -> Engine
  put(f, 2, 1, { kind: 'pipe', dir: 3 });
  put(f, 2, 0, { kind: 'pipe', dir: 0 });
  put(f, 3, 0, { kind: 'pipe', dir: 0 });             // -> vault on the east fence
  f.producer.level = 5;
  beginRound(f);

  const sold = {};
  for (let t = 0; t < 120; t += 1 / 60) {
    stepFactory(f, 1 / 60);
    for (const e of f.fx) if (e.k === 'sell') sold[e.ty] = (sold[e.ty] || 0) + 1;
    f.fx.length = 0;
  }

  const engines = sold[RECIPES[0].out] || 0;
  const kinds = Object.keys(sold).map(Number);
  ok(engines > 10, 'two lines meeting produced and sold Engines', `${engines} in 120s`);
  ok(kinds.every(ty => famOf(ty) === PRODUCT), 'only finished products reached the vault',
    kinds.map(nm).join(', ') || 'nothing');

  // The assembler must still be alive at the end, not deadlocked holding a pair
  // it can never complete.
  const asm = f.grid[cellOf(1, 1)];
  const held = asm.buf.map(g => g.ty);
  ok(new Set(held).size === held.length, 'assembler never stacked two of one ingredient',
    held.map(nm).join(' + ') || 'empty');
  ok(f.earned > 300, 'the chain earns real money', `$${Math.round(f.earned)}`);

  // And the over-supplied line should be visibly backed up rather than lost.
  ok(f.lost === 0, 'nothing was destroyed while the fast line waited', `${f.lost} lost`);
}

console.log(fails ? `\n${fails} FAILED` : '\nrecipes hold together');
process.exit(fails ? 1 : 0);
