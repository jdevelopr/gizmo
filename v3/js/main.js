/**
 * main.js — the one place everything is wired together.
 *
 * There is exactly one door into the game, `act(name, payload)`, and every
 * control in the application goes through it: a key, a palette row, a button in
 * the inspector, a drag that laid forty belts. That is worth the small amount of
 * indirection, because it means the answer to "what can this game do" is one
 * switch statement rather than a hunt through three files, and because a
 * headless harness can drive the whole thing by calling it.
 */

import {
  WORLD, CLAIM_START, CELL, TYPES, KINDS, cellOf, cx, cy, money, num,
  expandCost, buyCost, label, PASSIVE, zapRange, CRATE_CAP, RUBBLE, RUBBLE_COST, unlockedBy, unlockerOf, unlockKey,
  sizeKind, footprint, STORY_LEVELS, goalText, DRONE_RANGE, techById, techOpen, rankCost, rankOf,
} from './machines.js';
import { repairMachine, repairAll } from './bugs.js';
import { repairBeacon, progress as beaconProgress } from './beacon.js';
import { sfx, unlock, soundOn, setSound, volume, setVolume } from './sound.js';
import {
  areaCells, rubbleIn, capture, rotateBp, plan, paste, lift, drop, putBack,
  upgradeAll, scrapAll, repairArea, toggleArea,
} from './blueprint.js';
import { View, ZOOMS, DEFAULT_ZOOM } from './render.js';
import {
  build, buildCheck, moveMachine, scrapMachine, applyAction, research,
  countKind, rebuild, replaceMode, placeFromCrate, scrapFromCrate, stashMachine,
  sweepGround, looseAt, handoffDir, relink, smartDir,
} from './sim.js';
import { reachFrom } from './power.js';
import {
  createGame, stepGame, saveGame, loadGame, hasSave, hasOldSave, clearSave,
  ageToasts, toast, endTutorial, SPEEDS,
  createStoryGame, nextStoryGame, loadStory, storyLevelSaved, clearStory, goalProgress, storyStats,
} from './game.js';
import { Palette, Crate, Hud, Panel, Tutorial, drawMinimap, howtoHtml, health, problems } from './ui.js';
import { Input, makeState } from './input.js';
import { TechTree } from './techtree.js';
import { Tips, resetTips } from './tips.js';

const $ = id => document.getElementById(id);

let g = null;                       // the game, once one is running
let view = null;
let palette = null;
let crate = null;
let tutorial = null;
let hud = null;
let panel = null;
let side = null;     // the right-hand cards: Tech, Orders, Stats
let input = null;
let tree = null;
const S = makeState();
const tips = new Tips();             // Gus's one-time tips, waiting their turn

let lastFrame = 0;
let saveTimer = 0;
let paused = false;                 // the menu, as distinct from speed 0
let prevSpeed = 1;

/* ------------------------------------------------------------------ title --- */

function showTitle() {
  $('title').hidden = false;
  $('app').hidden = true;
  const lv = storyLevelSaved();
  $('btn-story').textContent = lv >= 0
    ? `CONTINUE STORY · WORLD ${lv + 1} OF ${STORY_LEVELS.length}` : 'STORY MODE';
  $('story-note').hidden = lv < 0;
  if (lv >= 0) $('story-note').textContent = `The campaign is on ${STORY_LEVELS[lv].name}. Abandon it from the in-game menu to start again.`;
  const has = hasSave();
  $('btn-continue').hidden = !has;
  $('save-note').hidden = !has;
  // The world grew from 56x56 to 80x80, and a save is a list of slots on the old
  // map, so it cannot be carried over. Say so rather than silently showing nothing.
  if (!has && hasOldSave()) {
    $('save-note').hidden = false;
    $('save-note').textContent = 'This version changed the world — it is bigger, and some machines now '
      + 'cover more than one slot — so an older save cannot be loaded. Start a new world.';
  }
}

function boot(game) {
  g = game;
  $('title').hidden = true;
  $('app').hidden = false;

  if (!view) {
    view = new View($('px'), $('tx'));
    palette = new Palette($('palette'), spec => act('tool', spec));
    crate = new Crate($('crate'), st => act('takeFromCrate', st), key => act('scrapCrate', key));
    tutorial = new Tutorial(() => act('endTutorial'), () => { tips.dismiss(); sfx('click'); });
    hud = new Hud();
    panel = new Panel(g, act);
    side = new Panel(g, act, ['tech', 'orders', 'stats'], null);
    wireCards();
    input = new Input(view, S, act, () => g);
    tree = new TechTree(act);
    wireChrome();
    window.addEventListener('resize', () => view.resize());
  }
  panel.g = g;
  side.g = g;
  side.key = '';
  tips.clear();
  view.resize();
  // Every game opens at the same zoom, not at whatever the last one was left on:
  // the View outlives a single world, so without this a second game would inherit
  // the camera from the first.
  view.cam.zoom = DEFAULT_ZOOM;
  view.centreOn(g.f.world.start.belts[0] ?? g.f.world.start.ext);
  view.groundKey = '';
  palette.key = '';
  palette.build(g);
  crate.key = '';
  crate.update(g, S);
  panel.show('info');
  S.selected = -1;
  S.tool = null;
  S.hand = -1;
  lastFrame = performance.now();
  if (!S.booted) { S.booted = true; requestAnimationFrame(frame); }
}

function wireChrome() {
  $('btn-expand').onclick = () => act('expand');
  $('btn-noise').onclick = () => act('noiseMap');
  $('btn-power').onclick = () => { S.showPower = !S.showPower; view.showPower = S.showPower; sfx('click'); };
  $('pop-more').onclick = () => {
    const pop = $('pop');
    pop.classList.toggle('compact');
    try { localStorage.setItem(POP_KEY, pop.classList.contains('compact') ? '0' : '1'); } catch { /* fine */ }
    paintMore();
  };
  $('btn-help').onclick = () => act('help');
  $('btn-menu').onclick = () => act('menu');
  $('m-resume').onclick = () => { $('menu').hidden = true; if (!storyCardUp()) resume(); };
  $('m-save').onclick = () => {
    $('m-note').textContent = saveGame(g) ? 'Saved.' : 'Could not save — storage is blocked.';
  };
  $('m-howto').onclick = () => act('help');
  $('m-tutorial').onclick = () => act('replayTutorial');
  $('m-quit').onclick = () => {
    if ($('m-quit').dataset.armed) {
      if (g.story) clearStory(); else clearSave();
      $('menu').hidden = true;
      paused = false;
      showTitle();
      return;
    }
    $('m-quit').dataset.armed = '1';
    $('m-quit').textContent = 'REALLY? THIS CANNOT BE UNDONE';
  };
  for (const b of document.querySelectorAll('.speeds button')) {
    b.onclick = () => act('setSpeed', +b.dataset.speed);
  }
  // Sound: the button in the HUD mutes, the slider in the menu sets the level, and
  // the first click or key press anywhere is what a browser needs before it will
  // play anything at all.
  const paintSound = () => $('btn-sound').classList.toggle('muted', !soundOn());
  paintSound();
  $('btn-sound').onclick = () => { unlock(); setSound(!soundOn()); paintSound(); sfx('click'); };
  $('m-volume').value = Math.round(volume() * 100);
  $('m-volume').oninput = e => { unlock(); setVolume(e.target.value / 100); sfx('click'); };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
  $('alert').onclick = () => { if (hud.target >= 0) act('focus', hud.target); };
  $('win-keep').onclick = () => { $('win').hidden = true; resume(); };
  $('si-go').onclick = () => { $('story-intro').hidden = true; resume(); sfx('click'); };
  $('sd-next').onclick = () => nextWorld();
  $('sd-stay').onclick = () => { $('story-done').hidden = true; resume(); };
  $('goals').onclick = () => { if (g?.story?.complete) showStoryDone(); };
  $('win-new').onclick = () => { $('win').hidden = true; clearSave(); paused = false; showTitle(); };
  for (const k of SHOW_KEYS) {
    $('show-' + k).checked = show[k];
    $('show-' + k).onchange = e => { show[k] = e.target.checked; applyShow(); sfx('click'); };
  }
  applyShow();
  $('z-in').onclick = () => act('zoom', 1);
  $('z-out').onclick = () => act('zoom', -1);
  $('mini').onclick = e => {
    const r = $('mini').getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * WORLD);
    const y = Math.floor((e.clientY - r.top) / r.height * WORLD);
    view.cam.x = x + 0.5;
    view.cam.y = y + 0.5;
    view.clampCam();
  };
}

/**
 * Which helper boxes are on screen. Somebody who has learnt the game does not need
 * the bottom line telling them which key turns a belt, and a warning box they have
 * already read can be in the way of the corner of the map they are building in. All
 * four can be switched off in the menu, or together with T, and the choice is kept.
 * Tab still walks the problem list with the warning box hidden.
 */
const SHOW_KEY = 'gizmo3.show.v1';
const SHOW_KEYS = ['alert', 'hint', 'toasts', 'tut'];
const show = { alert: true, hint: true, toasts: true, tut: true };
try { Object.assign(show, JSON.parse(localStorage.getItem(SHOW_KEY) || '{}')); } catch (e) { /* defaults */ }

function applyShow() {
  for (const k of SHOW_KEYS) {
    document.body.classList.toggle('hide-' + k, !show[k]);
    const box = $('show-' + k);
    if (box) box.checked = show[k];
  }
  try { localStorage.setItem(SHOW_KEY, JSON.stringify(show)); } catch (e) { /* private window */ }
}

function resume() {
  paused = false;
  lastFrame = performance.now();
}

/* ------------------------------------------------------------------- loop --- */

/* ---------------------------------------------------------------- cards --- */

const CARDS_KEY = 'gizmo3.cards.v1';
const POP_KEY = 'gizmo3.popmore.v1';

/**
 * The floating cards. Left-hand ones fold independently; of the right-hand ones
 * (Tech, Orders, Stats) only one is open at a time. Which are open is remembered.
 */
function wireCards() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CARDS_KEY) || '{}') || {}; } catch { saved = {}; }
  const store = () => {
    const out = { side: side.tab || '' };
    for (const c of document.querySelectorAll('.fcard[data-card]')) out[c.dataset.card] = !c.classList.contains('shut');
    try { localStorage.setItem(CARDS_KEY, JSON.stringify(out)); } catch { /* fine */ }
  };
  for (const c of document.querySelectorAll('.fcard[data-card]')) {
    // Money and Power open to start with; the rest fold until you want them.
    const open = saved[c.dataset.card] ?? (c.dataset.card === 'money' || c.dataset.card === 'power' || c.dataset.card === 'noise');
    c.classList.toggle('shut', !open);
    c.querySelector('.ch').onclick = () => { c.classList.toggle('shut'); hud.last.spark = ''; store(); sfx('click'); };
  }
  const sides = [...document.querySelectorAll('.fcard[data-side]')];
  const openSide = name => {
    for (const c of sides) c.classList.toggle('shut', c.dataset.side !== name);
    side.show(name || null);
    if (!name) side.tab = null;
  };
  for (const c of sides) {
    c.querySelector('.ch').onclick = () => {
      openSide(side.tab === c.dataset.side ? null : c.dataset.side);
      store();
      sfx('click');
    };
  }
  openSide(saved.side === undefined ? 'orders' : saved.side || null);
  try { if (localStorage.getItem(POP_KEY) === '1') $('pop').classList.remove('compact'); } catch { /* fine */ }
  paintMore();
}

function paintMore() {
  const pop = $('pop');
  $('pop-more').innerHTML = pop.classList.contains('compact') ? 'MORE &#9662;' : 'LESS &#9652;';
}

/** The world box, in slots, that the pop-up should point at — or null to dock it. */
function popAnchor() {
  const f = g.f;
  const cells = [];
  if (S.bp) return null;
  if (S.area?.length || S.rubble?.length) cells.push(...(S.area || []), ...(S.rubble || []));
  else if (S.selected >= 0) {
    const m = f.grid[S.selected];
    if (m?.cells) cells.push(...m.cells); else cells.push(S.selected);
  } else return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of cells) {
    const x = cx(i), y = cy(i);
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Put the pop-up over what is selected, or dock it above the shop for a tool. */
function placePop() {
  const pop = $('pop');
  // While something is being moved the card would only sit on the spot you are
  // aiming at, so it gets out of the way until the move is finished.
  const moving = S.hand >= 0 || !!S.bp?.held;
  // A machine picked from the shop gets no card: the hint at the end of the shop
  // row already says what it costs and how to place it.
  const want = !moving && !S.tool && (S.bp || S.area?.length || S.rubble?.length || S.selected >= 0);
  if (!want) { if (!pop.hidden) pop.hidden = true; return; }
  if (pop.hidden) pop.hidden = false;
  pop.classList.toggle('nomore', !$('tab-info').querySelector('.more-only'));
  const W = view.w, Hh = view.h;
  const top = 40 + 8, bottom = Hh - $('shop').offsetHeight - 8;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const a = popAnchor();
  let x, y, cls, ax = '50%';
  if (!a) {
    // A machine in your hand or a blueprint: docked bottom-left, over the shop.
    x = 12 + 220 + 12;
    y = bottom - ph - 4;
    cls = 'docked';
  } else {
    const [sx0, sy0] = view.toScreen(a.x0, a.y0);
    const [sx1, sy1] = view.toScreen(a.x1, a.y1);
    const mid = (sx0 + sx1) / 2;
    x = Math.round(mid - pw / 2);
    if (sy0 - ph - 14 >= top) { y = sy0 - ph - 14; cls = 'above'; }
    else if (sy1 + 14 + ph <= bottom) { y = sy1 + 14; cls = 'below'; }
    else {
      // No room above or below: stand beside it instead, on whichever side fits.
      y = Math.max(top, Math.min(bottom - ph, (sy0 + sy1) / 2 - ph / 2));
      const lw = $('leftcards').offsetWidth + 24, rw = $('rightcards').offsetWidth + 24;
      x = (W - rw) - sx1 >= sx0 - lw ? sx1 + 14 : sx0 - 14 - pw;
      cls = 'docked';
    }
    x = Math.max(8, Math.min(W - pw - 8, x));
    ax = Math.max(14, Math.min(pw - 14, mid - x)) + 'px';
  }
  y = Math.round(Math.max(top, y));
  const t = `translate(${Math.round(x)}px, ${y}px)`;
  if (pop.style.transform !== t) pop.style.transform = t;
  if (pop.style.getPropertyValue('--ax') !== ax) pop.style.setProperty('--ax', ax);
  if (!pop.classList.contains(cls)) {
    pop.classList.remove('above', 'below', 'docked');
    pop.classList.add(cls);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  // A frame timestamp can be fractionally older than the performance.now() that
  // started the session, so the very first delta can be negative. Clamp both ends.
  const dt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000)) || 0;
  lastFrame = now;
  if (!g || $('app').hidden) return;

  if (!paused) {
    const fx = stepGame(g, dt);
    playFx(fx);
    tips.fx(fx);
    // Gus only chimes in once the walkthrough is over.
    if (g.tut < 0) tips.tick(g, dt);
  }
  ageToasts(g, dt);
  input.panTick(dt);

  updateGhost();
  updateBlueprint();
  view.draw(g.f, {
    area: S.area,
    rubble: S.rubble,
    box: S.drag?.mode === 'box' ? S.drag : null,
    bpPlan: S.bpPlan,
    dt,
    jams: jamCells(g),
    hover: S.hover,
    selected: S.selected,
    ghost: S.ghost,
    dragPath: S.drag?.mode === 'build' ? S.drag.path : null,
    dragKind: S.drag?.mode === 'build' ? S.tool?.kind : null,
    reach: S.reach,
    range: S.range,
  });

  // With the walkthrough card hidden, the warning box gets its corner back.
  hud.update(g, tutorial.update(g, g.tut < 0 && show.tut ? tips.current : null) && show.tut);
  tutorial.tick(dt);
  updateZoom();
  palette.price(g);
  crate.update(g, S);
  palette.setCrate(g.f.crate.length);
  panel.update(g, S);
  side.update(g, S);
  placePop();
  $('btn-power').classList.toggle('on', !!S.showPower);
  if (tree?.open) tree.update(g);
  updateHint();
  updateGoals();

  if ((saveTimer -= dt) <= 0) { saveTimer = 20; saveGame(g); }
  if ((S.miniTimer = (S.miniTimer || 0) - dt) <= 0) {
    S.miniTimer = 0.4;
    drawMinimap($('mini'), g, view);
  }
}

/**
 * The slots involved in a line that has stopped for good, recomputed a couple of
 * times a second rather than sixty — walking every machine is not free, and a
 * permanent jam does not appear and vanish between frames.
 */
let jamCache = { at: -1, set: new Set() };
function jamCells(g) {
  const at = Math.floor(g.f.t * 2);
  if (jamCache.at === at) return jamCache.set;
  const set = new Set();
  for (const j of health(g.f).jams) { set.add(j.cell); set.add(j.into); }
  jamCache = { at, set };
  return set;
}

/** Turn the simulation's effect queue into things you can see. */
function playFx(fx) {
  const b = view.bounds();
  const seen = (x, y) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1;
  const near = c => c != null && c >= 0 && seen(cx(c), cy(c));
  for (const e of fx) {
    // Sound and sparks first; the floats and toasts below are unchanged.
    switch (e.k) {
      case 'sell':
        if (near(e.cell)) {
          sfx('sell', e.v / 20);
          if (e.v >= 12 && Math.random() < 0.5) view.coins(cx(e.cell) + 0.5, cy(e.cell) + 0.3, e.v >= 100 ? 4 : 2);
        }
        break;
      case 'sci': if (near(e.cell)) sfx('sci'); break;
      case 'zap':
        if (near(e.cell)) {
          sfx('zap');
          const [ex, ey] = e.path[e.path.length - 1];
          view.burst(ex, ey, '#e0d4ff', 4, 2, 0.25, 2);
          if (e.path.length > 2) view.shake(1.5, 0.12);
        }
        break;
      case 'kill':
        if (seen(e.x, e.y)) {
          sfx('kill');
          const col = { skitter: ['#9dff3c', '#e8ffb0'], beetle: ['#c97a34', '#ffd28a'], brute: ['#c0203c', '#ffb0c0'] }[e.kind] || ['#ff6f9a', '#ffd0e0'];
          view.burst(e.x, e.y, col[0], e.kind === 'beetle' || e.kind === 'brute' ? 18 : 10, 3, 0.5, 3);
          view.burst(e.x, e.y, col[1], 4, 1.5, 0.35, 2);
          if (e.kind === 'beetle') view.shake(2.5, 0.2);
        }
        break;
      case 'broke':
        sfx('broke');
        if (near(e.cell)) { view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#ff4f6a', 12, 3, 0.6, 3); view.shake(3, 0.2); }
        break;
      case 'build':
        if (near(e.cell)) { sfx('build'); view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.8, '#8b96b8', 5, 1.2, 0.4, 3); }
        break;
      case 'up': sfx('up'); if (near(e.cell)) view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#ffcd75', 10, 2.5, 0.5, 3); break;
      case 'scrap': sfx('scrap'); if (near(e.cell)) view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#6b6146', 8, 2, 0.5, 3); break;
      case 'repair': sfx('repair'); if (near(e.cell)) view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#a7f070', 6, 1.6, 0.45, 2); break;
      case 'drone':
        if (near(e.cell) || near(e.from)) {
          view.fly(e.from, e.cell);
          sfx('repair');
          view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#4fd8d0', 6, 1.4, 0.5, 2);
        }
        break;
      case 'rot': sfx('rot'); break;
      case 'move': sfx('move'); break;
      case 'swarm': sfx('swarm'); view.pulse('#ff3b5c'); break;
      case 'quiet': toast(g, 'Quiet enough — the creatures are heading home to their nests', '#a7f070'); break;
      case 'beetle':
        sfx('broke');
        toast(g, `A Beetle has burrowed out of a mountain to the ${compass(e.cell)} — it is after your Generators`, '#ffb060');
        if (near(e.cell)) { view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#6e6358', 14, 2.5, 0.7, 4); view.shake(3, 0.3); }
        break;
      case 'mined':
        toast(g, `A ${TYPES[e.ty]?.name || ''} mountain is worked out and has fallen in to rubble`, '#c9a26a');
        sfx('scrap');
        break;
      case 'beaconFeed':
        if (f0Near(e)) sfx('sell', 1.2);
        break;
      case 'beaconLoss':
        if (g.f.t - (S.lastLoss || -99) > 5) {
          S.lastLoss = g.f.t;
          toast(g, `The Beacon is losing progress — ${TYPES[e.ty].name} knocked out`, '#ff6f6a');
          sfx('broke');
        }
        break;
      case 'beaconDown':
        toast(g, 'The Beacon is down — it takes nothing until it is repaired', '#ff5d4a');
        sfx('swarm');
        break;
      case 'assault':
        toast(g, `ASSAULT — ${e.n} creatures are coming for the Beacon`, '#ff3b5c');
        sfx('swarm');
        view.pulse('#ff3b5c');
        view.shake(4, 0.4);
        break;
      case 'win':
        sfx('contract'); sfx('tech');
        view.pulse('#ffffff');
        showWin();
        break;
      case 'newNest':
        toast(g, `A new ${e.kind === 'skitter' ? 'Skitter' : 'Mite'} nest has dug in to the ${compass(e.cell)}`, e.kind === 'skitter' ? '#9dff3c' : '#ff6f9a');
        sfx('stir');
        break;
      case 'brood':
        if (near(e.cell)) { sfx('stir'); view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#8a2346', 10, 2, 0.5, 3); }
        break;
      case 'stir': sfx('stir'); break;
      case 'nest':
        sfx('nest');
        view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#ff4f7a', 30, 4, 0.9, 4);
        view.burst(cx(e.cell) + 0.5, cy(e.cell) + 0.5, '#ffcd75', 12, 3, 0.8, 3);
        view.shake(6, 0.4);
        break;
      case 'tech': sfx('tech'); view.pulse('#8f6cff'); break;
      case 'grow': sfx('grow'); view.pulse('#a7f070'); break;
      case 'contract': sfx('contract'); view.pulse('#ffcd75'); break;
      case 'goal': sfx('contract'); view.pulse('#a7f070'); break;
      case 'storyDone':
        sfx('contract'); sfx('tech');
        view.pulse('#ffffff');
        saveGame(g);
        showStoryDone();
        break;
      default: break;
    }
    if (e.k === 'sell' && e.v >= 3) view.float(`+$${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#a7f070');
    else if (e.k === 'sci' && e.v >= 3) view.float(`+${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#b8bcff');
    else if (e.k === 'scrap') view.float(`+$${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#ffcd75');
    else if (e.k === 'sweep') view.float(`-${e.n}`, cx(e.cell) + 0.5, cy(e.cell), '#8b96b8');
    else if (e.k === 'tech') toast(g, `${e.name} researched`, '#b8bcff');
    else if (e.k === 'grow') toast(g, `Claim is now ${e.claim} x ${e.claim}`, '#a7f070');
    else if (e.k === 'zap') view.beam(e.path, e.hot);
    else if (e.k === 'kill') view.float('ZAP', e.x, e.y - 0.3, '#e0d4ff');
    else if (e.k === 'repair') view.float(`-$${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#ffcd75');
    else if (e.k === 'nest') {
      view.float(`+$${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#a7f070');
      toast(g, `${e.kind === 'skitter' ? 'Skitter nest' : 'Nest'} destroyed — ${money(e.v)} bounty`, '#a7f070');
    } else if (e.k === 'stir') toast(g, 'The mites are stirring. A swarm is coming soon.', '#ff9ab8');
    else if (e.k === 'swarm') {
      toast(g, e.kind === 'skitter'
        ? `${e.n} Skitter${e.n > 1 ? 's are' : ' is'} racing in from the ${compass(e.cell)} — they eat belts`
        : `A swarm of ${e.n} mites is coming from the ${compass(e.cell)}${e.brutes ? ` — ${e.brutes} of them Brutes` : ''}`, e.kind === 'skitter' ? '#9dff3c' : '#ff6f9a');
    }
    else if (e.k === 'broke') {
      // Throttled: a swarm loose on a belt run breaks things faster than anybody
      // wants to read about them one at a time.
      if (g.f.t - (S.lastBroke || -99) > 4) {
        S.lastBroke = g.f.t;
        toast(g, `Mites broke ${label(g.f.grid[e.cell] || { kind: 'pipe' })} — H repairs it`, '#ff8a6a');
      }
    }
  }
}

/** Is the Beacon on screen? */
function f0Near() {
  const bc = g.f.beacon;
  if (!bc) return false;
  const b = view.bounds();
  return bc.x0 + 5 >= b.x0 && bc.x0 <= b.x1 && bc.y0 + 5 >= b.y0 && bc.y0 <= b.y1;
}

/** The win screen: the time it took and the numbers that got you there. */
function showWin() {
  const f = g.f;
  const rows = $('win-stats');
  rows.textContent = '';
  const add = (k, v) => {
    const r = document.createElement('div');
    r.className = 'row good';
    r.innerHTML = `<span>${k}</span><b>${v}</b>`;
    rows.appendChild(r);
  };
  const t = Math.round(f.t);
  add('Time', `${Math.floor(t / 3600)}h ${Math.floor(t / 60) % 60}m`);
  add('Lifetime earnings', money(f.earned));
  add('Machines', num(f.cells.length));
  add('Claim', `${f.claim} x ${f.claim}`);
  add('Creatures zapped', num(f.zapped || 0));
  add('Swarms survived', num(f.waves || 0));
  $('win').hidden = false;
  paused = true;
}

/* ------------------------------------------------------------- story mode --- */

/** Is a story card on screen? The game stays paused under it. */
const storyCardUp = () => !$('story-intro').hidden || !$('story-done').hidden;

/** The card that opens every story world: where you are, what is new, what is wanted. */
function showIntro() {
  const lv = g.story.level, L = STORY_LEVELS[lv];
  $('si-kicker').textContent = `WORLD ${lv + 1} OF ${STORY_LEVELS.length} · ${L.kind.toUpperCase()}`;
  $('si-name').textContent = L.name;
  $('si-blurb').textContent = L.blurb;
  $('si-learn').textContent = L.learn;
  const rows = $('si-goals');
  rows.textContent = '';
  for (const goal of L.goals) {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<span>${goalText(goal)}</span>`;
    rows.appendChild(r);
  }
  const ranks = g.f.done.length;
  $('si-carry').textContent = lv === 0
    ? 'Money and science start fresh on every world. Research is kept from one to the next.'
    : `You start with ${money(L.cash)} and no science. Your ${ranks} rank${ranks === 1 ? '' : 's'} of research came with you.`;
  $('story-intro').hidden = false;
  paused = true;
}

/** The pop-up when a contract is met: this world's numbers, and the way on. */
function showStoryDone() {
  const lv = g.story.level, last = lv >= STORY_LEVELS.length - 1;
  const st = storyStats(g);
  const rows = $('sd-stats');
  rows.textContent = '';
  const add = (k, v) => {
    const r = document.createElement('div');
    r.className = 'row good';
    r.innerHTML = `<span>${k}</span><b>${v}</b>`;
    rows.appendChild(r);
  };
  const time = t => `${Math.floor(t / 3600) ? Math.floor(t / 3600) + 'h ' : ''}${Math.floor(t / 60) % 60}m ${Math.floor(t % 60)}s`;
  const at = g.story.doneAt || g.f.t;
  add('Time', time(at));
  add('Earned', money(st.here.earned));
  add('Gizmos shipped', num(Math.round(st.here.shipped)));
  add('Science studied', num(Math.round(st.studied)));
  add('Machines standing', num(st.machines));
  add('Land claimed', `${st.claim} x ${st.claim}`);
  if (STORY_LEVELS[lv].bugs) add('Creatures zapped', num(st.here.zapped));
  add('Research ranks owned', num(st.research));
  if (last) {
    add('Campaign time', time(st.total.t));
    add('Campaign earnings', money(st.total.earned));
  }
  $('sd-kicker').textContent = `WORLD ${lv + 1} OF ${STORY_LEVELS.length} · ${STORY_LEVELS[lv].name}`;
  $('sd-title').textContent = last ? 'CAMPAIGN COMPLETE' : 'CONTRACT FULFILLED';
  $('sd-note').textContent = last
    ? 'Every contract from a pebble to a moon. The moon is yours to keep building on.'
    : `Next: ${STORY_LEVELS[lv + 1].name}, a ${STORY_LEVELS[lv + 1].kind.toLowerCase()}. Your research comes with you; money and science start again.`;
  $('sd-next').textContent = last ? 'START A NEW CAMPAIGN' : `ON TO ${STORY_LEVELS[lv + 1].name}`;
  $('story-done').hidden = false;
  paused = true;
}

function nextWorld() {
  $('story-done').hidden = true;
  paused = false;
  const last = g.story.level >= STORY_LEVELS.length - 1;
  const next = last ? createStoryGame(0, { teach: false }) : nextStoryGame(g);
  saveGame(next);
  boot(next);
  showIntro();
}

/** The contract, top right, every few frames. */
let goalsKey = '';
function updateGoals() {
  const box = $('goals');
  if (!g.story) { box.hidden = true; goalsKey = ''; return; }
  box.hidden = false;
  const L = STORY_LEVELS[g.story.level];
  const parts = L.goals.map((goal, k) => ({ goal, st: g.story.goals[k], pr: goalProgress(g, k) }));
  const key = g.story.complete + '|' + parts.map(p => p.pr.text + (p.pr.hot ? '*' : '')).join('|');
  if (key === goalsKey) return;
  goalsKey = key;
  box.classList.toggle('go', g.story.complete);
  box.style.pointerEvents = g.story.complete ? 'auto' : 'none';
  box.style.cursor = g.story.complete ? 'pointer' : '';
  let html = `<div class="g-head">${L.name}<span>WORLD ${g.story.level + 1} / ${STORY_LEVELS.length}</span></div>`;
  for (const p of parts) {
    const cls = 'g-row' + (p.st.done ? ' done' : '') + (p.pr.hot && !p.st.done ? ' hot' : '');
    html += `<div class="${cls}"><div class="g-top"><b>${goalText(p.goal)}</b><i>${p.st.done ? 'DONE' : p.pr.text}</i></div>`
      + `<div class="g-bar"><span style="width:${Math.round(p.pr.p * 100)}%"></span></div></div>`;
  }
  if (g.story.complete) html += '<div class="g-row done"><div class="g-top"><b>Contract fulfilled — click to move on</b></div></div>';
  box.innerHTML = html;
}

/** Which way a slot lies from the middle of the map, in words. */
function compass(cell) {
  const c = (WORLD - 1) / 2;
  const dx = cx(cell) - c, dy = cy(cell) - c;
  const ns = dy < -Math.abs(dx) / 2 ? 'north' : dy > Math.abs(dx) / 2 ? 'south' : '';
  const ew = dx > Math.abs(dy) / 2 ? 'east' : dx < -Math.abs(dy) / 2 ? 'west' : '';
  return (ns + ew) || 'wilds';
}

/**
 * Put the thing in your hand down. One function, because a machine out of the
 * crate and a machine off the catalogue land in exactly the same way — the only
 * difference is which pocket it came out of — and because the crate empties as it
 * goes, so the hand has to let go of itself when the last one is gone.
 */
function place(spec, cell, dir, mir, extra = {}) {
  const opt = { dir, mir, ...extra };
  if (spec.crate) {
    const r = placeFromCrate(g.f, spec.crate, cell, opt);
    if (r.ok && !r.left) act('tool', null);
    return r;
  }
  return build(g.f, spec, cell, opt);
}

/** Where the blueprint in your hand would land, and what it would cost. */
function updateBlueprint() {
  S.bpPlan = null;
  if (!S.bp || S.hover < 0) return;
  const p = plan(g.f, S.bp, S.hover);
  S.bpPlan = p;
  S.bpCost = p.cost;
  S.bpFit = `${p.ok} of ${p.total}`;
}

/** Let go of a blueprint; a lifted one puts everything back where it was. */
function dropBlueprint() {
  if (S.bp?.held) putBack(g.f, S.bp);
  S.bp = null;
  S.bpPlan = null;
  $('stage').classList.remove('build');
  panel.key = '';
}

/** Where the thing in your hand would land, and whether it may. */
function updateGhost() {
  S.ghost = null;
  S.reach = null;
  // A Zapper's reach is shown while you hold one, and while one is selected.
  const sel = S.selected >= 0 ? g.f.grid[S.selected] : null;
  S.range = sel?.kind === 'zap' ? { cell: sel.at ?? S.selected, r: zapRange(sel, g.f.done) }
    : sel?.kind === 'drone' ? { cell: sel.at ?? S.selected, r: DRONE_RANGE[(sel.level || 1) - 1] } : null;
  if (S.hand >= 0) {
    if (S.hover >= 0) {
      const m = g.f.grid[S.hand];
      // The whole footprint has to be clear (of anything but the machine itself).
      const cells = m && footprint(m.kind, S.hover, m.dir);
      const ok = !!cells && cells.every(c => !g.f.grid[c] || g.f.grid[c] === m)
        && buildCheck(g.f, { kind: m.kind, dir: m.dir }, S.hover, m.dir).ok;
      S.ghost = { cell: S.hover, spec: m, cells: cells || [S.hover], ok };
    }
    return;
  }
  if (!S.tool || S.hover < 0 || S.drag) return;
  // A 1x2 machine's footprint depends on which way it faces, so that is settled
  // first and everything after it is asked about that same footprint.
  const long = sizeKind(S.tool.kind) === 'long';
  const check = buildCheck(g.f, S.tool, S.hover);
  const mode = replaceMode(g.f, S.tool, S.hover, long ? check.dir : null);
  // A machine out of the crate is already paid for, and re-aiming one you already
  // own costs nothing either, so neither is ever blocked by an empty wallet.
  const free = !!S.tool.crate || mode === 'reaim';
  const cost = free ? 0 : buyCost(S.tool, countKind(g.f, S.tool.kind));
  // Show the way it will actually face: unless you have turned it yourself, a
  // machine aims itself when it lands, and the ghost should say where.
  let spec = S.tool;
  if (long) {
    if (check.dir != null) spec = { ...S.tool, dir: check.dir };
  } else if (!S.tool.dirSet && mode === 'new' && check.ok) {
    const probe = { kind: S.tool.kind, dir: S.tool.dir, mir: S.tool.mir, mut: S.tool.mut, level: 1, buf: [], work: [] };
    g.f.grid[S.hover] = probe;
    const d = smartDir(g.f, S.hover);
    g.f.grid[S.hover] = null;
    if (d != null) spec = { ...S.tool, dir: d };
  }
  const cells = check.cells || footprint(spec.kind, S.hover, spec.dir) || [S.hover];
  S.ghost = { cell: S.hover, spec, cells, mode, ok: check.ok && g.f.cash >= cost };
  if (S.tool.kind === 'gen' || S.tool.kind === 'solar') S.reach = reachFrom(g.f, S.hover, { kind: S.tool.kind, level: 1 });
  if (S.tool.kind === 'drone') S.range = { cell: S.hover, r: DRONE_RANGE[0] };
  if (S.tool.kind === 'zap') S.range = { cell: S.hover, r: zapRange({ level: S.tool.level || 1 }, g.f.done) };
}

/**
 * The zoom readout, as a percentage of the art's own size, and the two buttons
 * greyed out at the ends of the ladder so it is obvious when there is no further
 * to go.
 */
function updateZoom() {
  const i = ZOOMS.indexOf(view.cam.zoom);
  const pct = Math.round(view.cam.zoom / CELL * 100) + '%';
  const label = $('z-label');
  if (label.textContent !== pct) label.textContent = pct;
  $('z-in').disabled = i >= ZOOMS.length - 1;
  $('z-out').disabled = i <= 0;
}

/** The one line at the bottom, which always says what to do next. */
function updateHint() {
  const n = $('hint');
  let txt;
  if (S.bp) {
    txt = S.bp.held
      ? `<b>MOVING ${S.bp.held.length}</b>  ·  click where it goes  ·  <b>R</b> turn  <b>Esc</b> put it all back`
      : `<b>BLUEPRINT</b> ${money(S.bpCost || 0)}  ·  click to stamp  ·  <b>R</b> turn  <b>Esc</b> let go`;
  } else if (S.area?.length) {
    txt = `<b>${S.area.length} SELECTED</b>  ·  <b>Ctrl C</b> copy  <b>M</b> move  <b>K</b> to crate  <b>U</b> upgrade  <b>H</b> repair  <b>O</b> off  <b>X</b> scrap  <b>Esc</b> clear`;
  } else if (S.rubble?.length) {
    txt = `<b>${S.rubble.length} RUBBLE SELECTED</b>  ·  <b>X</b> clear it all  <b>Esc</b> clear the selection`;
  } else if (S.hand >= 0) txt = 'Click where it goes. <b>Esc</b> to leave it where it was.';
  else if (S.tool) {
    const cost = buyCost(S.tool, countKind(g.f, S.tool.kind));
    const drag = S.tool.kind === 'pipe' || S.tool.kind === 'store' || S.tool.kind === 'wall';
    txt = `<b>${label(S.tool).toUpperCase()}</b> ${money(cost)}  ·  ` +
      (drag ? 'click, or drag to lay a run  ·  ' : '') +
      (S.tool.kind === 'wall' ? '<b>Esc</b> drop' : '<b>R</b> turn  <b>F</b> flip  <b>Esc</b> drop');
  } else if (S.selected >= 0 && g.f.grid[S.selected]) {
    txt = '<b>R</b> turn  <b>M</b> move  <b>X</b> scrap  <b>H</b> repair  <b>Q</b> copy to hand  ·  drag to pan  ·  <b>V</b> power  <b>?</b> controls';
  } else {
    txt = '<b>drag</b> to move the map  ·  <b>Shift drag</b> select  ·  <b>1</b>–<b>0</b> build  <b>Z</b> zapper  <b>B</b> armory  <b>G</b> drill  <b>N</b> bridge  ·  <b>Tab</b> next problem  <b>?</b> controls';
  }
  if (n.dataset.txt !== txt) { n.dataset.txt = txt; n.innerHTML = txt; }
}

/* -------------------------------------------------------------------- act --- */

/**
 * Every verb in the game. Returns whatever the caller needs; `canBuild` is the
 * only one anybody reads the answer to.
 */
function act(name, payload, extra) {
  const f = g?.f;
  switch (name) {
    /* --- what is in your hand --- */
    case 'tool': {
      S.hand = -1;
      if (S.bp) dropBlueprint();
      S.area = null; S.rubble = null;
      if (!payload) {
        S.tool = null;
        palette.select(null);
        panel.key = '';
        $('stage').classList.remove('build');
        return;
      }
      // A Mutator picked up by its key comes as the rung you last had in hand, or
      // else the lowest rung researched.
      if (payload.kind === 'mut' && payload.mut == null && !payload.crate) {
        const on = unlockedBy(f.done);
        const last = S.tool?.kind === 'mut' ? S.tool.mut : null;
        let t = last && on.has('mut:' + last) ? last : 0;
        for (let k = 1; !t && k <= 7; k++) if (on.has('mut:' + k)) t = k;
        payload = { ...payload, mut: t || 1 };
      }
      // A machine that still needs research cannot be picked up.
      if (!payload.crate && !unlockedBy(f.done).has(unlockKey(payload))) {
        const t = unlockerOf(unlockKey(payload));
        toast(g, t ? `Research ${t.name} first — it is on the TECH card` : 'Not unlocked yet', '#ff8a6a');
        sfx('error');
        return;
      }
      $('stage').classList.add('build');
      const keep = S.tool && S.tool.kind === payload.kind ? S.tool : null;
      S.tool = { dir: keep?.dir ?? 0, mir: keep?.mir ?? 0, mut: 1, ...payload, dirSet: !!keep?.dirSet };
      palette.select(S.tool);
      S.selected = -1;
      panel.show('info');
      return;
    }
    case 'rotTool':
      // Turning what is in your hand means you have an opinion: from now on it goes
      // down the way you turned it, until you pick something else up.
      if (S.tool) { S.tool.dir = (S.tool.dir + (payload > 0 ? 1 : 3)) % 4; S.tool.dirSet = true; }
      return;
    case 'flipTool':
      if (S.tool) S.tool.mir = S.tool.mir ? 0 : 1;
      return;
    case 'takeFromCrate': {
      const st = payload;
      S.hand = -1;
      S.selected = -1;
      S.tool = { ...st.spec, crate: st.key, dir: st.spec.dir, mut: st.spec.mut, mir: st.spec.mir };
      palette.select(null);
      crate.key = '';
      $('stage').classList.add('build');
      panel.show('info');
      return;
    }
    case 'scrapCrate': {
      const r = scrapFromCrate(f, payload);
      if (r.ok) toast(g, `Sold from the crate — ${money(r.refund)}`, '#ffcd75');
      crate.key = '';
      return;
    }

    case 'pipette': {
      const m = payload >= 0 ? f.grid[payload] : null;
      if (!m) return;
      S.tool = { kind: m.kind, dir: m.dir, mut: m.mut, mir: m.mir };
      S.hand = -1;
      palette.select(S.tool);
      $('stage').classList.add('build');
      return;
    }

    /* --- building --- */
    case 'canBuild': {
      const r = buildCheck(f, payload.spec, payload.cell);
      return { ...r, mode: replaceMode(f, payload.spec, payload.cell) };
    }

    case 'build': {
      // A single click aims itself, unless you turned the thing in your hand with R
      // first — then it goes down exactly the way you turned it.
      const spec = payload.spec;
      const r = place(spec, payload.cell, spec.dirSet ? spec.dir : null, spec.mir, { hand: !!spec.dirSet });
      if (!r.ok) { toast(g, r.msg, '#ff8a6a'); sfx('error'); }
      else if (r.crated) toast(g, `${label(r.crated).toUpperCase()} to the crate`, '#a8dcff');
      return r;
    }

    /**
     * A dragged run. Every belt is laid in one go, in order, and the run simply
     * stops when the money does — half a line you can afford beats a bill you
     * cannot, and nothing is charged for a slot that was already occupied.
     */
    case 'buildRun': {
      let laid = 0, spent = 0, stopped = null;
      let aimed = 0;
      const spec = payload.spec;
      const path = payload.path;
      const lastOk = path.map(p => p.ok).lastIndexOf(true);
      const firstOk = path.findIndex(p => p.ok);
      for (let k = 0; k < path.length; k++) {
        const step = path[k];
        if (!step.ok) { if (!stopped && step.why) stopped = step.why; continue; }
        // A click without a drag is a single belt and aims itself. In a real drag,
        // every belt points at the next; the first also lets a dead-ended run next
        // to it bend in to feed it; and the last hands off to whatever is beside it.
        const single = path.length === 1 && !spec.dirSet;
        const r = place(spec, step.cell, single ? null : step.dir, spec.mir,
          { adopt: k === firstOk, hand: !!spec.dirSet });
        if (!r.ok) { stopped = r.msg; break; }
        if (k === lastOk && !single && !spec.dirSet && r.machine && spec.kind !== 'wall') {
          const d = handoffDir(f, step.cell);
          if (d != null && d !== r.machine.dir) { r.machine.dir = d; relink(f); }
        }
        if (r.mode === 'reaim') aimed++;
        else laid++;
        spent += r.cost || 0;
      }
      if (laid) toast(g, `${laid} laid — ${money(spent)}`, '#a8dcff');
      else if (aimed) toast(g, `${aimed} re-aimed`, '#a8dcff');
      else if (stopped) toast(g, stopped, '#ff8a6a');
      return;
    }

    /* --- moving --- */
    case 'pickup': {
      if (payload == null || payload < 0 || !f.grid[payload]) return;
      S.tool = null;
      palette.select(null);
      S.hand = payload;
      S.selected = payload;
      return;
    }
    case 'drop': {
      const r = moveMachine(f, payload.from, payload.to);
      if (!r.ok) toast(g, r.msg, '#ff8a6a');
      else S.selected = payload.to;
      return r;
    }

    /* --- one machine --- */
    case 'select':
      S.selected = payload;
      if (payload >= 0) panel.show('info');
      return;
    case 'rot': return applyAction(f, { a: 'rot', i: payload, back: extra });
    case 'off': {
      if (payload == null || payload < 0 || !f.grid[payload]) return;
      const r = applyAction(f, { a: 'off', i: payload });
      if (r.ok) toast(g, `${label(f.grid[payload]).toUpperCase()} ${r.msg.toLowerCase()}`, '#8b96b8');
      panel.key = '';
      return r;
    }
    case 'mir': {
      const r = applyAction(f, { a: 'mir', i: payload });
      if (!r.ok && payload >= 0 && f.grid[payload]) toast(g, r.msg, '#ff8a6a');
      return r;
    }
    case 'filt': return applyAction(f, { a: 'filt', i: payload.i, ty: payload.ty });
    case 'clearBuf': {
      if (payload == null || payload < 0 || !f.grid[payload]) return;
      const r = applyAction(f, { a: 'clearBuf', i: payload });
      toast(g, r.ok ? `${label(f.grid[payload]).toUpperCase()} — ${r.msg.toLowerCase()}` : r.msg,
        r.ok ? '#8b96b8' : '#ff8a6a');
      panel.key = '';
      return r;
    }
    case 'up': {
      const r = applyAction(f, { a: 'up', i: payload });
      if (!r.ok) { toast(g, r.msg, '#ff8a6a'); sfx('error'); }
      return r;
    }
    case 'stash': {
      if (payload == null || payload < 0) return;
      const r = stashMachine(f, payload);
      if (!r.ok) toast(g, r.msg, '#ff8a6a');
      else if (S.selected === payload) S.selected = -1;
      return r;
    }
    case 'scrap': {
      if (payload == null || payload < 0) return;
      // On a bare slot the same gesture sweeps up whatever is lying there, so one
      // right-drag takes out a wrong belt run and the gizmos it spilled in one
      // pass rather than leaving litter behind the cursor.
      if (!f.grid[payload]) return act('sweep', payload);
      const r = scrapMachine(f, payload);
      // Take the litter with it, so a right-drag along a run leaves clean ground
      // rather than a trail of orphaned gizmos. Anything still in the air lands
      // afterwards and needs a second pass, which is fair enough.
      sweepGround(f, payload);
      if (S.selected === payload) S.selected = -1;
      return r;
    }
    case 'sweep': {
      if (payload == null || payload < 0) return;
      const n = sweepGround(f, payload);
      if (n) toast(g, `${n} swept up`, '#8b96b8');
      return { ok: !!n, swept: n };
    }
    case 'repairBeacon': {
      const r = repairBeacon(f);
      toast(g, r.msg, r.ok ? '#ffcd75' : '#ff8a6a');
      panel.key = '';
      return r;
    }
    case 'focusBeacon': {
      if (!f.beacon) return;
      const c = cellOf(f.beacon.x0 + 2, f.beacon.y0 + 2);
      view.centreOn(c);
      if (view.cam.zoom < 16) view.cam.zoom = 16;
      view.ping(c, '#a8dcff');
      S.selected = c;
      panel.show('info');
      sfx('click');
      return;
    }
    case 'repair': {
      if (payload != null && payload >= 0 && !f.grid[payload] && f.beacon && f.terrain[payload] === 5) return act('repairBeacon');
      if (payload == null || payload < 0 || !f.grid[payload]) return;
      const r = repairMachine(f, payload);
      if (!r.ok && r.msg !== 'Not damaged') toast(g, r.msg, '#ff8a6a');
      panel.key = '';
      return r;
    }
    case 'repairAll': {
      const r = repairAll(f);
      toast(g, r.msg, r.ok ? '#ffcd75' : '#ff8a6a');
      panel.key = '';
      return r;
    }
    case 'clear': {
      if (payload == null || payload < 0) return;
      const r = applyAction(f, { a: 'clear', i: payload });
      if (!r.ok && f.terrain[payload] !== 0) toast(g, r.msg, '#ff8a6a');
      return r;
    }

    /* --- the world --- */
    case 'expand': {
      const r = applyAction(f, { a: 'expand' });
      if (!r.ok) toast(g, r.msg, '#ff8a6a');
      return r;
    }
    case 'research': {
      const r = research(f, payload);
      if (!r.ok) { toast(g, r.msg, '#ff8a6a'); sfx('error'); }
      else { palette.key = ''; palette.build(g); panel.key = ''; if (tree) tree.key = ''; }
      return r;
    }

    /* --- many machines at once --- */
    case 'areaSelect': {
      const cells = areaCells(f, payload.a, payload.b);
      // Rubble on your own land inside the box is picked up too, so a patch of it
      // can be cleared in one go.
      const rubble = rubbleIn(f, payload.a, payload.b);
      S.area = cells.length || rubble.length ? cells : null;
      S.rubble = rubble.length ? rubble : null;
      S.selected = -1;
      panel.show('info');
      panel.key = '';
      if (cells.length || rubble.length) sfx('click');
      return;
    }
    case 'areaCrate': {
      if (!S.area?.length) return;
      let n = 0, left = 0;
      for (const i of S.area) {
        if (!f.grid[i]) continue;
        if (f.crate.length >= CRATE_CAP) { left++; continue; }
        if (stashMachine(f, i).ok) n++;
      }
      toast(g, left ? `${n} to the crate — ${left} did not fit (it holds ${CRATE_CAP})` : `${n} to the crate`,
        left ? '#ffcd75' : '#a8dcff');
      sfx('move');
      crate.key = '';
      palette.key = '';
      S.area = null; S.rubble = null;
      panel.key = '';
      return { n, left };
    }
    case 'areaRubble': {
      if (!S.rubble?.length) return;
      let n = 0, spent = 0;
      for (const i of S.rubble) {
        if (f.terrain[i] !== RUBBLE) continue;
        if (f.cash < RUBBLE_COST) break;
        if (applyAction(f, { a: 'clear', i }).ok) { n++; spent += RUBBLE_COST; }
      }
      const left = S.rubble.filter(i => f.terrain[i] === RUBBLE);
      toast(g, left.length ? `Cleared ${n} rubble for ${money(spent)} — ${left.length} left, not enough cash`
        : `Cleared ${n} rubble for ${money(spent)}`, left.length ? '#ffcd75' : '#a7f070');
      if (n) sfx('scrap');
      S.rubble = left.length ? left : null;
      if (!S.area?.length && !S.rubble) S.area = null;
      panel.key = '';
      return { n, spent };
    }
    case 'areaClear':
      S.area = null; S.rubble = null;
      panel.key = '';
      return;
    case 'areaCopy': {
      if (!S.area?.length) return;
      const bp = capture(f, S.area);
      if (!bp) return;
      S.clip = bp;
      S.area = null; S.rubble = null;
      S.tool = null;
      palette.select(null);
      S.bp = bp;
      $('stage').classList.add('build');
      toast(g, `Copied ${bp.parts.length} machines — click to stamp`, '#7fe8ff');
      sfx('click');
      panel.key = '';
      return;
    }
    case 'paste': {
      if (!S.clip) { toast(g, 'Nothing copied yet — shift-drag a box, then Ctrl C', '#ff8a6a'); return; }
      if (S.bp?.held) return;
      S.tool = null; S.hand = -1; S.area = null; S.rubble = null;
      palette.select(null);
      S.bp = S.clip;
      $('stage').classList.add('build');
      panel.key = '';
      return;
    }
    case 'areaMove': {
      if (!S.area?.length) return;
      const bp = lift(f, S.area);
      if (!bp) return;
      S.area = null; S.rubble = null;
      S.tool = null;
      palette.select(null);
      S.bp = bp;
      $('stage').classList.add('build');
      sfx('move');
      panel.key = '';
      return;
    }
    case 'bpRotate':
      if (S.bp) { S.bp = rotateBp(S.bp); if (!S.bp.held) S.clip = S.bp; sfx('rot'); }
      return;
    case 'bpDrop':
      dropBlueprint();
      return;
    case 'bpPlace': {
      if (!S.bp || payload < 0) return;
      if (S.bp.held) {
        const r = drop(f, S.bp, payload);
        S.bp = null;
        S.bpPlan = null;
        $('stage').classList.remove('build');
        toast(g, r.home ? `${r.moved} moved — ${r.home} could not stand there and went back`
          : `${r.moved} moved`, r.home ? '#ffcd75' : '#7fe8ff');
        panel.key = '';
        return r;
      }
      const r = paste(f, S.bp, payload);
      if (r.placed) toast(g, `${r.placed} built — ${money(r.spent)}` + (r.skipped ? `  ·  ${r.skipped} skipped` : ''), '#7fe8ff');
      if (r.broke) { toast(g, 'Ran out of money partway', '#ff8a6a'); sfx('error'); }
      else if (!r.placed) { toast(g, 'Nothing fits there', '#ff8a6a'); sfx('error'); }
      return r;
    }
    case 'areaRepair': {
      if (!S.area?.length) return;
      const r = repairArea(f, S.area);
      toast(g, r.n ? `${r.n} repaired — ${money(r.spent)}` : 'Nothing repaired', r.n ? '#ffcd75' : '#ff8a6a');
      panel.key = '';
      return r;
    }
    case 'areaUpgrade': {
      if (!S.area?.length) return;
      const r = upgradeAll(f, S.area);
      toast(g, r.n ? `${r.n} upgraded — ${money(r.spent)}` + (r.left ? `  ·  ${r.left} more when you can afford them` : '')
        : 'Nothing upgraded', r.n ? '#ffcd75' : '#ff8a6a');
      if (!r.n) sfx('error');
      panel.key = '';
      return r;
    }
    case 'areaToggle': {
      if (!S.area?.length) return;
      const r = toggleArea(f, S.area);
      toast(g, `${r.n} switched ${r.off ? 'off' : 'on'}`, '#8b96b8');
      sfx('click');
      panel.key = '';
      return r;
    }
    case 'areaScrap': {
      if (!S.area?.length) return;
      const r = scrapAll(f, S.area);
      for (const i of S.area) sweepGround(f, i);
      toast(g, `${r.n} scrapped — +${money(r.got)}`, '#ffcd75');
      S.area = null; S.rubble = null;
      panel.key = '';
      return r;
    }

    /* --- helper boxes --- */
    case 'toggleHelp': {
      // Any shown: hide them all. All hidden: bring them all back.
      const anyOn = SHOW_KEYS.some(k => show[k]);
      for (const k of SHOW_KEYS) show[k] = !anyOn;
      applyShow();
      sfx('click');
      // Said once, at the top of the screen, whichever way it went — even with
      // pop-ups switched off, because otherwise the key would seem to do nothing.
      $('help-note')?.remove();
      const n = document.createElement('div');
      n.id = 'help-note';
      n.className = 'toast';
      n.textContent = anyOn ? 'Helper boxes hidden — T brings them back' : 'Helper boxes shown';
      n.style.cssText = 'position:absolute;top:calc(var(--hud) + 10px);left:50%;transform:translateX(-50%);color:#8b96b8;z-index:30;pointer-events:none';
      $('stage').appendChild(n);
      setTimeout(() => n.remove(), 1800);
      return;
    }

    /* --- the tech tree page --- */
    case 'noiseMap':
      view.showNoise = !view.showNoise;
      $('btn-noise').classList.toggle('on', view.showNoise);
      sfx('click');
      return;
    case 'openTree':
      if (tree.open) tree.close(); else tree.show(g);
      return;

    /* --- finding things --- */
    case 'focus': {
      if (payload == null || payload < 0) return;
      view.centreOn(payload);
      if (view.cam.zoom < 32) view.cam.zoom = 32;
      view.ping(payload);
      S.area = null; S.rubble = null;
      if (f.grid[payload]) { S.selected = payload; panel.show('info'); }
      sfx('click');
      return;
    }
    case 'nextProblem': {
      const list = problems(f);
      if (!list.length) { toast(g, 'Nothing wrong anywhere. Enjoy it.', '#a7f070'); return; }
      S.probAt = ((S.probAt ?? -1) + 1) % list.length;
      toast(g, `Problem ${S.probAt + 1} of ${list.length}`, '#8b96b8');
      return act('focus', list[S.probAt]);
    }

    /* --- the camera --- */
    case 'zoom':
      view.zoomBy(payload > 0 ? 1 : -1);
      return;

    /* --- the clock --- */
    case 'setSpeed': {
      g.speed = SPEEDS.includes(payload) ? payload : 1;
      for (const b of document.querySelectorAll('.speeds button')) {
        b.classList.toggle('on', +b.dataset.speed === g.speed);
      }
      return;
    }
    case 'speed': {
      const i = SPEEDS.indexOf(g.speed);
      return act('setSpeed', SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + payload))]);
    }
    case 'togglePause': {
      if (g.speed === 0) act('setSpeed', prevSpeed || 1);
      else { prevSpeed = g.speed; act('setSpeed', 0); }
      return;
    }

    /* --- chrome --- */
    case 'endTutorial': {
      endTutorial(g);
      tutorial.key = '';
      hud.last.alert = '';
      return;
    }
    case 'replayTutorial': {
      g.tut = 0;
      resetTips();
      tips.clear();
      tutorial.key = '';
      $('menu').hidden = true;
      resume();
      return;
    }
    case 'help': {
      $('howto-body').innerHTML = howtoHtml(f);
      $('menu').hidden = true;
      $('howto').hidden = false;
      paused = true;
      return;
    }
    case 'menu': {
      $('m-quit').dataset.armed = '';
      $('m-quit').textContent = g.story ? 'ABANDON THE CAMPAIGN' : 'ABANDON THIS WORLD';
      $('m-note').textContent = '';
      $('menu').hidden = false;
      paused = true;
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------- boot --- */

$('btn-new').onclick = () => {
  const raw = $('seed').value.trim();
  const seed = raw ? (parseInt(raw, 10) || hashText(raw)) : null;
  clearSave();
  boot(createGame({ seed }));
};
$('btn-story').onclick = () => {
  const saved = storyLevelSaved() >= 0 ? loadStory() : null;
  if (saved) {
    boot(saved);
    if (saved.story.complete) showStoryDone();
    return;
  }
  const g0 = createStoryGame(0);
  boot(g0);
  showIntro();
};
$('btn-continue').onclick = () => {
  const saved = loadGame();
  if (saved) boot(saved);
  else toastless('That save could not be read. Starting a new world instead.');
};
$('btn-howto').onclick = () => {
  $('howto-body').innerHTML = howtoHtml(g?.f || null);
  $('howto').hidden = false;
};

/**
 * The manual and the menu are reachable from the title screen, before any game
 * exists — so the buttons that close them are wired here rather than in
 * `wireChrome`, which only runs when a world is booted. Opening the manual from
 * the title and finding no way out of it is exactly the kind of thing that only
 * shows up when someone clicks it.
 */
$('howto-close').onclick = closeSheets;

function closeSheets() {
  const open = !$('howto').hidden || !$('menu').hidden;
  $('howto').hidden = true;
  $('menu').hidden = true;
  if (g && !storyCardUp()) resume();
  return open;
}

// Escape closes whatever is covering the screen before it does anything else.
// The in-game handler in input.js never sees it, because there is always
// something more urgent to close first.
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (closeSheets()) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);

/** A typed seed that is not a number still has to become one. */
function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function toastless(msg) {
  const note = $('save-note');
  note.hidden = false;
  note.textContent = msg;
}

window.addEventListener('beforeunload', () => { if (g) saveGame(g); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && g) saveGame(g);
  lastFrame = performance.now();
});

showTitle();

// The harness opens the page and drives it from here.
window.GIZMO = { act, get game() { return g; }, get view() { return view; }, state: S };
