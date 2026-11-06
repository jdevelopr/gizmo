/**
 * tips.mjs — Gus's one-time tips fire when they should, and only once.
 *
 *   node tools/tips.mjs
 */
import { MOUNTAIN, VALLEY, claimMin, claimMax, cellOf, WORLD } from '../js/machines.js';
import { Tips, TIPS, resetTips } from '../js/tips.js';
import { createGame } from '../js/game.js';
import { applyAction } from '../js/sim.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};

resetTips();
ok(TIPS.length >= 8 && new Set(TIPS.map(t => t.id)).size === TIPS.length, `${TIPS.length} tips, every id unique`);
ok(TIPS.every(t => !!t.fx !== !!t.check), 'each one fires from an effect or from a check, not both');

const t = new Tips();
t.fx([{ k: 'swarm', kind: 'mite' }]);
ok(t.current?.id === 'swarm', 'the first swarm brings up the Mite tip');
t.fx([{ k: 'swarm', kind: 'mite' }]);
ok(t.queue.length === 1, 'and it is not queued twice');
t.dismiss();
t.fx([{ k: 'swarm', kind: 'mite' }]);
ok(!t.current, 'once dismissed it never comes back');
t.fx([{ k: 'swarm', kind: 'skitter' }, { k: 'broke', cell: 1 }]);
ok(t.queue.map(x => x.id).join() === 'skitter,broke', 'tips queue up and come one at a time');
t.clear();

const g = createGame({ seed: 4242, teach: false });
t.tick(g, 1);
ok(!t.queue.some(x => x.id === 'research'), 'no research tip with no science');
g.f.science = 100;
t.tick(g, 1);
ok(t.queue.some(x => x.id === 'research'), 'the research tip once the first unlock is affordable');
t.clear();

// Expand until a mountain is near the fence, and the mountain tip should fire.
g.f.cash = 1e9;
const near = (k) => { const lo = Math.max(0, claimMin(g.f.claim) - 2), hi = Math.min(WORLD - 1, claimMax(g.f.claim) + 2);
  for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) if (g.f.terrain[cellOf(x, y)] === k) return true; return false; };
let fired = false;
for (let n = 0; n < 40 && !fired; n++) {
  applyAction(g.f, { a: 'expand' });
  t.timer = 0; t.tick(g, 1);
  if (near(MOUNTAIN)) { fired = t.queue.some(x => x.id === 'mountain'); break; }
}
ok(fired, 'the mountain tip fires when a mountain comes within reach of the fence');
ok(!t.queue.some(x => x.id === 'valley') || near(VALLEY), 'and the valley tip only when there is a valley near');

resetTips();
console.log(fails ? `\n${fails} FAILED\n` : '\nGus says each thing once, when it matters.\n');
process.exit(fails ? 1 : 0);
