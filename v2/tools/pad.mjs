/**
 * pad.mjs — drive the phone UI headlessly, against the real index.html.
 *
 * The pad is the half of this game that no simulation test can reach: every other
 * harness here proves the factory is correct while saying nothing about whether a
 * person can operate it. This one loads the actual page into a DOM, wires the real
 * controller to the real engine, and pushes buttons.
 *
 * Needs jsdom:  npm i jsdom     (kept out of the repo; this is a dev-only tool)
 *
 *   node tools/pad.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); }
catch {
  console.log('jsdom not installed — run `npm i jsdom` (in /tmp is fine, then '
    + 'JSDOM_PATH=/tmp/node_modules/jsdom node tools/pad.mjs)');
  process.exit(0);
}

const here = new URL('.', import.meta.url).pathname;
const html = readFileSync(here + '../index.html', 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://gizmo.test/' });
const { window } = dom;

// Minimal canvas + layout shims: the renderer draws into a 2D context and measures
// elements, neither of which jsdom implements. We are testing wiring, not pixels.
const ctx2d = new Proxy({}, { get: () => () => {} });
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
window.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, width: 390, height: 360, right: 390, bottom: 360 };
};
window.navigator.vibrate = () => {};
// Node 22 defines `navigator` as a getter-only global, so assign what we can and
// define the rest — the modules under test read these off globalThis.
// (not `performance`: jsdom's implementation calls the global one and would recurse)
for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Element']) {
  globalThis[k] = window[k];
}
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { createEngine } = await import('../js/game.js');
const { createController } = await import('../js/player.js');
const M = await import('../js/machines.js');

let fails = 0;
const ok = (c, what, detail = '') => {
  if (!c) { fails++; console.log('  FAIL  ' + what + (detail ? '  ' + detail : '')); }
  else console.log('  ok    ' + what + (detail ? '  ' + detail : '')); 
};
const $ = s => window.document.querySelector(s);
const vis = s => { const e = $(s); return !!e && !e.hidden; };
const tabOf = () => [...window.document.querySelectorAll('#dock-tabs button')]
  .find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.tab;

window.document.body.dataset.screen = 'pad';

// The plot is generated, so nothing in here may assume where anything is. These
// resolve against the match that actually started.
const firstMachine = () => eng.players.get(0).f.grid.findIndex(Boolean);
const feedCell = () => eng.players.get(0).f.layout.feeds[0].row;

const eng = createEngine({
  seed: 12345, rounds: 8, planSecs: 400, roundSecs: 90, tallySecs: 1, cash: 4000, gridSize: 7,
});
eng.addPlayer(0, 'YOU', 0);
const ctrl = createController({ send: msg => { eng.action(0, msg); push(); } });
eng.startGame();
const p = eng.players.get(0), f = p.f;
const push = () => ctrl.applyState(eng.stateFor(0));
push();

/* --- the shell exists and the board is not buried -------------------------- */
{
  ok(vis('#pad-bar') && vis('#pad-stage-wrap') && vis('#pad-dock'), 'the app shell is present');
  ok(window.document.querySelectorAll('#dock-tabs button').length === 4, 'four dock tabs');
  const PANELS = ['select', 'build', 'tech', 'crate', 'recipes'];
  const shown = PANELS.filter(n => vis('#panel-' + n));
  ok(shown.length === 1, 'exactly one panel shows at a time', shown.join(','));
  ok(shown[0] === 'build', 'and a round opens on BUILD, since that is what it is for');
  ok(!$('#dock-tabs button[data-tab="select"]'), 'there is no SELECT tab to tap');
  ok(!!$('#dock-tabs button[data-tab="recipes"]'), 'RECIPES took the fourth slot');
  ok(!$('#pad-hint') && !$('#shop-tabs') && !$('#btn-plan'),
    'the old scrolling column is gone');
}

/* --- the status line carries what used to take three blocks ---------------- */
{
  ok($('#bar-cash').textContent === '$' + Math.round(f.cash), 'cash is on the bar',
    $('#bar-cash').textContent);
  ok(/SCI/.test($('#bar-sci').textContent), 'so is science', $('#bar-sci').textContent);
  ok(/R1/.test($('#bar-phase').textContent), 'so is the round and phase',
    $('#bar-phase').textContent);
  ok(vis('#pad-order') && $('#order-text').textContent.includes('ORDER'), 'the order strip shows');
}

/* --- selecting a machine snaps the dock, and dropping it snaps back --------- */
{
  $('#dock-tabs button[data-tab="crate"]').click();
  ok(tabOf() === 'crate', 'tabs switch on tap');
  const belt = firstMachine();
  ctrl.selectCell(belt);
  ok(vis('#panel-select') && !vis('#panel-crate'), 'selecting a machine covers the dock');
  ok(!tabOf(), 'and no tab claims to be open while it does');
  ok(/Conveyor/.test($('#sel-name').textContent), 'it names the machine',
    $('#sel-name').textContent);
  ok(/\/s/.test($('#sel-sub').textContent), 'and gives its rate', $('#sel-sub').textContent);
  ok(!$('#btn-rot').disabled, 'ROTATE is live');
  ctrl.selectCell(belt);                              // tap again to deselect
  ok(tabOf() === 'crate' && vis('#panel-crate'), 'dropping it uncovers what was underneath');
  $('#dock-tabs button[data-tab="build"]').click();
}

/* --- the level ceiling is explained, not just greyed out ------------------- */
{
  const up = firstMachine();
  ctrl.selectCell(up);
  eng.action(0, { t: 'act', a: { a: 'up', ref: 'g' + up } });               // L2
  push();
  ok(/OVERCLOCK/i.test($('#btn-up').textContent), 'a capped machine says why',
    $('#btn-up').textContent);
  f.done.push('storage', 'overclock');
  push();
  ok(/UPGRADE \$/.test($('#btn-up').textContent), 'and stops saying it once researched',
    $('#btn-up').textContent);
  ctrl.selectCell(up);
}

/* --- routing respects research ---------------------------------------------- */
{
  $('#dock-tabs button[data-tab="build"]').click();
  ok(vis('#btn-mover') && vis('#btn-bal'), 'conveyor and balancer are on the shelf');
  ok(!vis('#btn-sort'), 'the sorter is not, before Sorting');
  f.done.push('sorting');
  push();
  ok(vis('#btn-sort'), 'and is, after it', $('#btn-sort').textContent);
  const before = f.grid.filter(Boolean).length;
  $('#btn-bal').click();
  ok(f.grid.filter(Boolean).length === before + 1, 'buying a balancer puts one on the floor');
}

/* --- unbought land points at the button that fixes it ----------------------- */
{
  $('#dock-tabs button[data-tab="crate"]').click();
  ctrl.selectCell(M.cellOf(M.GRID - 1, M.GRID - 1));
  ok(tabOf() === 'build', 'tapping dirt opens BUILD');
  ok($('#btn-expand').dataset.nudge === 'on', 'and nudges CLAIM LAND');
}

/* --- the catalogue and the tree are live, and gated by phase ---------------- */
{
  // Build and planning are one phase now: buying and arranging happen together.
  const rows = () => window.document.querySelectorAll('#shop-cards .cat-row').length;
  const buys = () => [...window.document.querySelectorAll('#shop-cards .buy')];
  ok(eng.phase === 'plan', 'a round opens in the build phase');
  ok(rows() > 0, 'the catalogue is listed', rows() + ' rows');
  const buyable = buys().filter(b => !b.disabled);
  ok(buyable.length > 0, 'and live in the same phase you arrange the floor',
    buyable.length + ' affordable');
  const had = f.grid.filter(Boolean).length;
  buyable[0].click();
  ok(f.grid.filter(Boolean).length === had + 1, 'buying installs a machine');
  buyable[0].click();
  ok(f.grid.filter(Boolean).length === had + 2, 'and there is no one-a-round cap any more');


  $('#dock-tabs button[data-tab="tech"]').click();
  const techRows = window.document.querySelectorAll('#tech-list .tech-row');
  ok(techRows.length === M.TECH.length, 'every tech node is listed', techRows.length + ' nodes');
  f.science = 99999;
  push();
  const go = [...window.document.querySelectorAll('#tech-list button')]
    .find(b => b.textContent === 'RESEARCH');
  ok(!!go, 'an affordable node offers RESEARCH');
  const known = f.done.length;
  go.click();
  ok(f.done.length === known + 1, 'and clicking it completes one', f.done.join(','));
  ok($('#dock-tabs button[data-tab="tech"]').dataset.badge, 'tabs badge what is waiting');
}

/* --- the recipes tab ---------------------------------------------------------- */
{
  $('#dock-tabs button[data-tab="recipes"]').click();
  ok(tabOf() === 'recipes' && vis('#panel-recipes'), 'RECIPES opens');
  const fuse = window.document.querySelectorAll('#rec-fuse .rec-row');
  // Every rung of every family except the top one of each has a fusing recipe.
  const rungs = (M.FAM_LEN[M.ALLOY] - 1) + (M.FAM_LEN[M.PART] - 1);
  ok(fuse.length === rungs, 'every fusing step is listed', `${fuse.length} of ${rungs}`);
  ok(/2x/.test(fuse[0].textContent) && /Copper/.test(fuse[0].textContent),
    'starting with two Scrap', fuse[0].textContent.replace(/\s+/g, ' ').trim());
  ok([...fuse].some(r => /Resin/.test(r.textContent) && /Cord/.test(r.textContent)),
    'and covering the Part family too');

  const asm = window.document.querySelectorAll('#rec-asm .rec-row');
  ok(asm.length === M.RECIPES.length, 'every Assembler recipe is listed', asm.length + '');
  const locked = [...asm].filter(r => r.className.includes('locked'));
  ok(locked.length < asm.length, 'the researched ones are not greyed out',
    `${locked.length} of ${asm.length} still locked`);
  ok(/needs research/.test(locked[0]?.textContent || 'needs research'),
    'and the locked ones say why');

  ok(window.document.querySelectorAll('#rec-mut .rec-row').length === M.FAM_LEN[M.ALLOY] - 1,
    'every Mutator tier is listed');
  ok(window.document.querySelectorAll('#rec-rules li').length >= 4, 'the rules are spelled out');
}

/* --- tapping a fixture ---------------------------------------------------------- */
{
  // Producers, vaults and the Lab are drawn outside the grid, so they need their
  // own hit test — without it they were the three things you could not ask about.
  const o = ctrl.stage.floorOrigin(ctrl.stage.panelRect(0));
  const gut = ctrl.stage.gutter || 24;
  const st = eng.stateFor(0);

  const feedY = o.y + feedCell() * 32 + 16;
  const prod = ctrl.stage.fixtureAt(o.x - gut / 2, feedY, st.v);
  ok(prod?.kind === 'prod', 'the west gutter hit-tests as a Producer', JSON.stringify(prod));
  ctrl.tapPoint(o.x - gut / 2, feedY);
  ok(vis('#panel-select'), 'tapping one opens the info panel');
  ok(/Producer A/.test($('#sel-name').textContent), 'and says which feed it is',
    $('#sel-name').textContent);
  ok(/Scrap/.test($('#sel-sub').textContent) && /\/s\)/.test($('#sel-sub').textContent),
    'what it drops and how fast', $('#sel-sub').textContent);
  ok(/SPEED UP|MAX/.test($('#btn-up').textContent), 'and offers the upgrade that runs it',
    $('#btn-up').textContent);
  ok($('#btn-scrap').disabled && $('#btn-rot').disabled, 'a fixture cannot be moved or sold');

  // The vault trades from whichever face the map gave it, so aim at the gutter
  // strip on that side rather than assuming east.
  const [vaultCell, vaultDir] = st.v.sv[0];
  const off = [[1, 0], [0, 1], [-1, 0], [0, -1]][vaultDir];
  const vx = o.x + (M.cx(vaultCell) + 0.5 + off[0] * 0.7) * 32;
  const vy = o.y + (M.cy(vaultCell) + 0.5 + off[1] * 0.7) * 32;
  ctrl.tapPoint(vx, vy);
  ok(/Vault/.test($('#sel-name').textContent), 'the vault answers too',
    $('#sel-name').textContent);

  const [labCell, labDir] = st.v.lb;
  const loff = [[1, 0], [0, 1], [-1, 0], [0, -1]][labDir];
  const lx = o.x + (M.cx(labCell) + 0.5 + loff[0] * 0.7) * 32;
  const ly = o.y + (M.cy(labCell) + 0.5 + loff[1] * 0.7) * 32;
  ctrl.tapPoint(lx, ly);
  ok(/Lab/.test($('#sel-name').textContent), 'and so does the Lab', $('#sel-name').textContent);
  ok(/science/i.test($('#sel-sub').textContent), 'explaining what it pays in');

  ctrl.tapPoint(lx, ly);                                          // tap again
  ok(!vis('#panel-select'), 'tapping the same fixture again closes it');
}

/* --- terrain ------------------------------------------------------------------- */
{
  // Rubble and bedrock are the map's contribution to the game, so tapping one has
  // to say which it is and whether it can be shifted.
  const stone = Array.from(f.terrain)
    .map((t, i) => ({ t, i }))
    .filter(x => x.t && M.claimed(x.i, f.claim));
  const rub = stone.find(x => x.t === M.RUBBLE);
  if (rub) {
    f.cash = 5000;
    push();
    ctrl.selectCell(rub.i);
    ok(/Rubble/.test($('#sel-name').textContent), 'tapping rubble says what it is',
      $('#sel-name').textContent);
    ok(/CLEAR \$/.test($('#btn-up').textContent), 'and offers to clear it',
      $('#btn-up').textContent);
    $('#btn-up').click();
    ok(f.terrain[rub.i] === M.OPEN, 'clearing it works');
    ok(!vis('#panel-select'), 'and the panel closes, since there is nothing there now');
  } else {
    ok(true, 'no rubble on this map to tap (skipped)');
  }
  const bed = stone.find(x => x.t === M.BEDROCK);
  if (bed) {
    ctrl.selectCell(bed.i);
    ok(/Bedrock/.test($('#sel-name').textContent), 'tapping bedrock says what it is');
    ok($('#btn-up').disabled, 'and does not offer to move it');
    ctrl.selectCell(bed.i);
  } else {
    ok(true, 'no bedrock inside the claim to tap (skipped)');
  }
  ok(!!$('#map-seed') && /seed/.test($('#map-seed').textContent),
    'the map seed is shown so it can be played again', $('#map-seed').textContent);
}

/* --- the setup panel ---------------------------------------------------------- */
{
  const S = await import('../js/setup.js');
  const set = (id, v) => { $(id).value = String(v); };

  ok(window.document.querySelectorAll('#setup .pick select').length === 4,
    'every dropdown is wrapped for styling');
  ok($('#cfg-rounds').type === 'number', 'rounds is a number you type, not a menu');
  ok(!!$('#cfg-endless'), 'and ENDLESS sits beside it');

  set('#cfg-rounds', 20); set('#cfg-plan', 150); set('#cfg-secs', 90);
  let cfg = S.readSetupCfg();
  ok(cfg.rounds === 20 && !cfg.endless, 'any round count is accepted', cfg.rounds + '');
  ok(/min/.test(S.estimate(cfg)), 'and it estimates how long that will take',
    S.estimate(cfg));

  set('#cfg-rounds', 5);
  const short = S.estimate(S.readSetupCfg());
  set('#cfg-rounds', 40);
  const long = S.estimate(S.readSetupCfg());
  const firstNum = t => parseInt(t.replace(/[^0-9]/g, ''), 10);
  ok(firstNum(long) > firstNum(short), 'more rounds reads as more time',
    `5 rounds ${short} · 40 rounds ${long}`);

  // Out-of-range input must not produce a match with zero or a million rounds.
  set('#cfg-rounds', 0);
  ok(S.readSetupCfg().rounds >= 1, 'zero rounds is clamped away');
  set('#cfg-rounds', 99999);
  ok(S.readSetupCfg().rounds <= 999, 'and so is an absurd one');
  set('#cfg-rounds', 8);

  $('#cfg-endless').click();
  cfg = S.readSetupCfg();
  ok(cfg.endless, 'the toggle turns endless on');
  ok($('#cfg-rounds').disabled, 'and greys out the count it makes meaningless');
  ok(/a round/.test(S.estimate(cfg)), 'the estimate switches to per-round',
    S.estimate(cfg));
  ok(/endless/.test(S.summary(cfg)), 'and the summary says so', S.summary(cfg));

  // An endless engine must not stop on its own, and must stop when asked.
  const e2 = createEngine({ ...cfg, rounds: 2, planSecs: 1, roundSecs: 1, tallySecs: 0.5 });
  e2.addPlayer(0, 'A', 0);
  e2.startGame();
  for (let t = 0; t < 400; t += 0.25) e2.step(0.25);
  ok(e2.phase !== 'over' && e2.round > 2, 'endless runs past its round count',
    `reached round ${e2.round}`);
  e2.endMatch();
  ok(e2.phase === 'over', 'and ends when the floor screen calls it');

  $('#cfg-endless').click();          // back to normal for anything after this
  ok(!S.readSetupCfg().endless && !$('#cfg-rounds').disabled, 'the toggle turns off again');
}

/* --- solo is reachable from inside the join flow ---------------------------- */
{
  ok(!!$('#solo-btn'), 'the phone lobby offers PLAY SOLO INSTEAD');
  ok(!!$('#connect-solo'), 'so does the connection-failure screen');
  ok($('#connect-solo').hidden, 'but only once connecting has actually failed');
  ok(/SOLO/i.test($('#practice-btn').textContent), 'and the home screen says solo, not practice',
    $('#practice-btn').textContent);

  // Solo has no floor screen to announce a round, so the pad has to do it.
  ok(!!$('#pad-banner'), 'the pad has a banner of its own');
  ctrl.banner('ROUND 3', 'EXTEND · CLAIM · UPGRADE', 5);
  ok(!$('#pad-banner').hidden, 'and it shows when asked');
  ok($('#pad-banner').querySelector('b').textContent === 'ROUND 3', 'with the round on it');
  ctrl.banner('');
  ok($('#pad-banner').hidden, 'and clears');
}

/* --- one action button, meaning whatever the round asks --------------------- */
{
  ok(vis('#dock-action') && /DONE|WAITING/.test($('#dock-action').textContent),
    'the action button reads for the build phase', $('#dock-action').textContent);
  $('#dock-action').click();
  push();
  ok(p.planReady, 'and pressing it readies up');
}

/* --- building while the floor runs --------------------------------------------- */
{
  // The catalogue and the tech tree stay open during SHIPPING. Watching a line jam
  // and being told to wait ninety seconds before you may buy the Storage that fixes
  // it is the wrong answer to the most interesting moment in the game.
  for (const s2 of [0]) eng.action(s2, { t: 'plan', v: true });
  while (eng.phase !== 'run') eng.step(0.25);
  push();
  ok(eng.phase === 'run', 'the round starts');

  $('#dock-tabs button[data-tab="build"]').click();
  const live = [...window.document.querySelectorAll('#shop-cards .buy')].filter(b => !b.disabled);
  ok(live.length > 0, 'the catalogue is still live', live.length + ' affordable');
  const mid = f.grid.filter(Boolean).length;
  live[0].click();
  ok(f.grid.filter(Boolean).length === mid + 1, 'you can buy a machine mid-round');

  f.science = 99999;
  push();
  $('#dock-tabs button[data-tab="tech"]').click();
  const open = [...window.document.querySelectorAll('#tech-list button')]
    .filter(b => b.textContent === 'RESEARCH');
  ok(open.length > 0, 'research is offered mid-round', open.length + ' nodes ready');
  const known = f.done.length;
  open[0]?.click();
  ok(f.done.length === known + 1, 'and can be bought there', f.done.join(','));

  // Land is the exception, and for a simulation reason rather than a rule: growing
  // moves the vault out, and anything already in the air toward the old one would
  // be sold into a wall.
  const claimWas = f.claim;
  eng.action(0, { t: 'expand' });
  ok(f.claim === claimWas, 'but land still waits for the floor to stop');
}

console.log(fails ? `\n${fails} FAILED` : '\nthe pad works');
process.exit(fails ? 1 : 0);
