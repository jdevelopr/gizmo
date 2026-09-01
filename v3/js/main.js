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
  WORLD, CLAIM_START, TYPES, KINDS, cellOf, cx, cy, money, num,
  expandCost, buyCost, label, PASSIVE,
} from './machines.js';
import { View } from './render.js';
import {
  build, buildCheck, moveMachine, scrapMachine, applyAction, research,
  countKind, rebuild,
} from './sim.js';
import { reachFrom } from './power.js';
import {
  createGame, stepGame, saveGame, loadGame, hasSave, clearSave,
  ageToasts, toast, SPEEDS,
} from './game.js';
import { Palette, Hud, Panel, drawMinimap, howtoHtml } from './ui.js';
import { Input, makeState } from './input.js';

const $ = id => document.getElementById(id);

let g = null;                       // the game, once one is running
let view = null;
let palette = null;
let hud = null;
let panel = null;
let input = null;
const S = makeState();

let lastFrame = 0;
let saveTimer = 0;
let paused = false;                 // the menu, as distinct from speed 0
let prevSpeed = 1;

/* ------------------------------------------------------------------ title --- */

function showTitle() {
  $('title').hidden = false;
  $('app').hidden = true;
  const has = hasSave();
  $('btn-continue').hidden = !has;
  $('save-note').hidden = !has;
}

function boot(game) {
  g = game;
  $('title').hidden = true;
  $('app').hidden = false;

  if (!view) {
    view = new View($('px'), $('tx'));
    palette = new Palette($('palette'), spec => act('tool', spec));
    hud = new Hud();
    panel = new Panel(g, act);
    input = new Input(view, S, act, () => g);
    wireChrome();
    window.addEventListener('resize', () => view.resize());
  }
  panel.g = g;
  view.resize();
  view.centreOn(g.f.world.start.ext);
  view.groundKey = '';
  palette.key = '';
  palette.build(g);
  panel.show('info');
  S.selected = -1;
  S.tool = null;
  S.hand = -1;
  lastFrame = performance.now();
  if (!S.booted) { S.booted = true; requestAnimationFrame(frame); }
}

function wireChrome() {
  $('btn-expand').onclick = () => act('expand');
  $('btn-help').onclick = () => act('help');
  $('btn-menu').onclick = () => act('menu');
  $('m-resume').onclick = () => { $('menu').hidden = true; resume(); };
  $('m-save').onclick = () => {
    $('m-note').textContent = saveGame(g) ? 'Saved.' : 'Could not save — storage is blocked.';
  };
  $('m-howto').onclick = () => act('help');
  $('m-quit').onclick = () => {
    if ($('m-quit').dataset.armed) {
      clearSave();
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
  $('mini').onclick = e => {
    const r = $('mini').getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * WORLD);
    const y = Math.floor((e.clientY - r.top) / r.height * WORLD);
    view.cam.x = x + 0.5;
    view.cam.y = y + 0.5;
    view.clampCam();
  };
}

function resume() {
  paused = false;
  lastFrame = performance.now();
}

/* ------------------------------------------------------------------- loop --- */

function frame(now) {
  requestAnimationFrame(frame);
  // A frame timestamp can be fractionally older than the performance.now() that
  // started the session, so the very first delta can be negative. Clamp both ends.
  const dt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000)) || 0;
  lastFrame = now;
  if (!g || $('app').hidden) return;

  if (!paused) {
    playFx(stepGame(g, dt));
  }
  ageToasts(g, dt);
  input.panTick(dt);

  updateGhost();
  view.draw(g.f, {
    dt,
    hover: S.hover,
    selected: S.selected,
    ghost: S.ghost,
    dragPath: S.drag?.mode === 'build' ? S.drag.path : null,
    reach: S.reach,
  });

  hud.update(g);
  palette.price(g);
  panel.update(g, S);
  updateHint();

  if ((saveTimer -= dt) <= 0) { saveTimer = 20; saveGame(g); }
  if ((S.miniTimer = (S.miniTimer || 0) - dt) <= 0) {
    S.miniTimer = 0.4;
    drawMinimap($('mini'), g, view);
  }
}

/** Turn the simulation's effect queue into things you can see. */
function playFx(fx) {
  for (const e of fx) {
    if (e.k === 'sell' && e.v >= 3) view.float(`+$${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#a7f070');
    else if (e.k === 'sci' && e.v >= 3) view.float(`+${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#b8bcff');
    else if (e.k === 'scrap') view.float(`+$${e.v}`, cx(e.cell) + 0.5, cy(e.cell), '#ffcd75');
    else if (e.k === 'tech') toast(g, `${e.name} researched`, '#b8bcff');
    else if (e.k === 'grow') toast(g, `Claim is now ${e.claim} x ${e.claim}`, '#a7f070');
  }
}

/** Where the thing in your hand would land, and whether it may. */
function updateGhost() {
  S.ghost = null;
  S.reach = null;
  if (S.hand >= 0) {
    if (S.hover >= 0) {
      const m = g.f.grid[S.hand];
      const ok = m && !g.f.grid[S.hover]
        && buildCheck(g.f, { kind: m.kind }, S.hover).ok;
      S.ghost = { cell: S.hover, spec: m, ok };
    }
    return;
  }
  if (!S.tool || S.hover < 0 || S.drag) return;
  const check = buildCheck(g.f, S.tool, S.hover);
  const cost = buyCost(S.tool, countKind(g.f, S.tool.kind));
  S.ghost = { cell: S.hover, spec: S.tool, ok: check.ok && g.f.cash >= cost };
  if (S.tool.kind === 'gen') S.reach = reachFrom(g.f, S.hover, { level: 1 });
}

/** The one line at the bottom, which always says what to do next. */
function updateHint() {
  const n = $('hint');
  let txt;
  if (S.hand >= 0) txt = 'Click where it goes. <b>Esc</b> to leave it where it was.';
  else if (S.tool) {
    const cost = buyCost(S.tool, countKind(g.f, S.tool.kind));
    const drag = S.tool.kind === 'pipe' || S.tool.kind === 'store';
    txt = `<b>${label(S.tool).toUpperCase()}</b> ${money(cost)}  ·  ` +
      (drag ? 'click, or drag to lay a run  ·  ' : '') +
      '<b>R</b> turn  <b>F</b> flip  <b>Esc</b> drop';
  } else if (S.selected >= 0 && g.f.grid[S.selected]) {
    txt = '<b>R</b> turn  <b>M</b> move  <b>X</b> scrap  <b>Q</b> copy to hand  ·  <b>V</b> power  <b>?</b> controls';
  } else {
    txt = '<b>1</b>–<b>0</b> build  ·  drag a conveyor to lay a run  ·  <b>Q</b> copy  <b>V</b> power  <b>C</b> buy land  <b>?</b> controls';
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
      if (!payload) { S.tool = null; palette.select(null); panel.key = ''; return; }
      const keep = S.tool && S.tool.kind === payload.kind ? S.tool : null;
      S.tool = { dir: keep?.dir ?? 0, mir: keep?.mir ?? 0, mut: 1, ...payload };
      palette.select(S.tool);
      S.selected = -1;
      panel.show('info');
      return;
    }
    case 'rotTool':
      if (S.tool) S.tool.dir = (S.tool.dir + (payload > 0 ? 1 : 3)) % 4;
      return;
    case 'flipTool':
      if (S.tool) S.tool.mir = S.tool.mir ? 0 : 1;
      return;
    case 'pipette': {
      const m = payload >= 0 ? f.grid[payload] : null;
      if (!m) return;
      S.tool = { kind: m.kind, dir: m.dir, mut: m.mut, mir: m.mir };
      S.hand = -1;
      palette.select(S.tool);
      return;
    }

    /* --- building --- */
    case 'canBuild':
      return buildCheck(f, payload.spec, payload.cell);

    case 'build': {
      const r = build(f, payload.spec, payload.cell, { dir: payload.spec.dir, mir: payload.spec.mir });
      if (!r.ok) toast(g, r.msg, '#ff8a6a');
      return r;
    }

    /**
     * A dragged run. Every belt is laid in one go, in order, and the run simply
     * stops when the money does — half a line you can afford beats a bill you
     * cannot, and nothing is charged for a slot that was already occupied.
     */
    case 'buildRun': {
      let laid = 0, spent = 0, stopped = null;
      for (const step of payload.path) {
        if (!step.ok) { if (!stopped && step.why) stopped = step.why; continue; }
        const r = build(f, payload.spec, step.cell, { dir: step.dir, mir: payload.spec.mir });
        if (!r.ok) { stopped = r.msg; break; }
        laid++;
        spent += r.cost;
      }
      if (laid) toast(g, `${laid} laid — ${money(spent)}`, '#a8dcff');
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
    case 'mir': {
      const r = applyAction(f, { a: 'mir', i: payload });
      if (!r.ok && payload >= 0 && f.grid[payload]) toast(g, r.msg, '#ff8a6a');
      return r;
    }
    case 'filt': return applyAction(f, { a: 'filt', i: payload.i, ty: payload.ty });
    case 'up': {
      const r = applyAction(f, { a: 'up', i: payload });
      if (!r.ok) toast(g, r.msg, '#ff8a6a');
      return r;
    }
    case 'scrap': {
      if (payload == null || payload < 0) return;
      if (!f.grid[payload]) return;
      const r = scrapMachine(f, payload);
      if (S.selected === payload) S.selected = -1;
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
      if (!r.ok) toast(g, r.msg, '#ff8a6a');
      else { palette.key = ''; palette.build(g); panel.key = ''; }
      return r;
    }

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
    case 'help': {
      $('howto-body').innerHTML = howtoHtml(f);
      $('menu').hidden = true;
      $('howto').hidden = false;
      paused = true;
      return;
    }
    case 'menu': {
      $('m-quit').dataset.armed = '';
      $('m-quit').textContent = 'ABANDON THIS WORLD';
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
  if (g) resume();
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
