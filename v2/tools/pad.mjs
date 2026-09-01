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

const eng = createEngine({
  rounds: 8, planSecs: 400, roundSecs: 90, tallySecs: 1, cash: 4000, gridSize: 7,
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
  const shown = ['select', 'build', 'tech', 'crate'].filter(n => vis('#panel-' + n));
  ok(shown.length === 1, 'exactly one panel shows at a time', shown.join(','));
  ok(shown[0] === 'build', 'and a round opens on BUILD, since that is what it is for');
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
  $('#dock-tabs button[data-tab="build"]').click();
  ok(tabOf() === 'build', 'tabs switch on tap');
  ctrl.selectCell(M.cellOf(0, 0));
  ok(tabOf() === 'select', 'selecting a machine snaps to SELECT');
  ok(/Conveyor/.test($('#sel-name').textContent), 'and names it', $('#sel-name').textContent);
  ok(/\/s/.test($('#sel-sub').textContent), 'and gives its rate', $('#sel-sub').textContent);
  ok(!$('#btn-rot').disabled, 'ROTATE is live');
  ctrl.selectCell(M.cellOf(0, 0));                    // tap again to deselect
  ok(tabOf() === 'build', 'dropping it returns to where you were');
}

/* --- the level ceiling is explained, not just greyed out ------------------- */
{
  ctrl.selectCell(M.cellOf(0, 0));
  eng.action(0, { t: 'act', a: { a: 'up', ref: 'g' + M.cellOf(0, 0) } });   // L2
  push();
  ok(/OVERCLOCK/i.test($('#btn-up').textContent), 'a capped machine says why',
    $('#btn-up').textContent);
  f.done.push('storage', 'overclock');
  push();
  ok(/UPGRADE \$/.test($('#btn-up').textContent), 'and stops saying it once researched',
    $('#btn-up').textContent);
  ctrl.selectCell(M.cellOf(0, 0));
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

console.log(fails ? `\n${fails} FAILED` : '\nthe pad works');
process.exit(fails ? 1 : 0);
