/**
 * game.js — the match. Owns the clock, the money, the contracts and the save file.
 *
 * GIZMO 2's engine was a state machine over rounds: begin, ship, tally, shop,
 * repeat. There are no rounds here, so what is left is a great deal simpler — a
 * fixed-step loop, a few running averages, and three things that need a sense of
 * time passing:
 *
 *   **Contracts**, which are what pressure looks like without a round to measure
 *   at the end of. Each one asks for a quantity of one type, delivered to a depot,
 *   before a clock runs out, and pays a premium over the market rate. They are
 *   generated from what your factory has actually been shipping, so they scale
 *   with you and can never become impossible.
 *
 *   **Milestones**, which are the tutorial without a tutorial: the half-dozen
 *   things a new factory has to discover, ticked off silently as they happen.
 *
 *   **The save**, which matters far more here than in a thirty-minute party game.
 *   A desktop factory is a two-hour object and closing the tab must not cost it.
 */

import {
  TYPES, RAW, WORLD, CLAIM_START, MILESTONES, TUTORIAL, CONTRACT_SLOTS,
  CONTRACT_PREMIUM, CONTRACT_GRACE, CONTRACT_GAP, cellOf, cx, cy, rng, hashSeed,
  money, makeMachine, techById, unlockedBy, OPEN,
} from './machines.js';
import { generateWorld } from './world.js';
import {
  createFactory, starterKit, stepFactory, rebuild, drainFx, diagnose, reachesPayout,
} from './sim.js';

const SAVE_KEY = 'gizmo3.save.v1';
/** Set once the first game has been walked through, or the walk was skipped. */
const TAUGHT_KEY = 'gizmo3.taught.v1';
const STEP = 1 / 30;              // the simulation's fixed tick
export const SPEEDS = [0, 1, 2, 3];

/** How fast the income and throughput averages forget. Seconds. */
const EMA_WINDOW = 12;

/**
 * A new world.
 *
 * Nothing is built. The map used to open with an Extractor, a belt and a Depot
 * already running, which is a fine way to start a game you understand and a poor
 * way to start one you do not — the single most important thing here, that ore goes
 * along a belt and turns into money, was something you were shown the result of
 * rather than something you did. So the first visit is walked through building it,
 * and every visit after that begins with an empty claim and the money to fill it.
 *
 * @param {boolean|null} teach force the walkthrough on or off; null asks storage
 */
export function createGame({ seed = null, cash = 650, teach = null } = {}) {
  const s = seed == null ? (Math.floor(Math.random() * 1e9) | 0) : seed;
  const world = generateWorld(s);
  const f = createFactory({ seed: s, world, cash });
  rebuild(f);
  const g = baseGame(f);
  g.tut = (teach == null ? !hasBeenTaught() : teach) ? 0 : -1;
  return g;
}

/** Has this browser already been walked through the opening once? */
export function hasBeenTaught() {
  try { return !!localStorage.getItem(TAUGHT_KEY); } catch (e) { return false; }
}

export function markTaught() {
  try { localStorage.setItem(TAUGHT_KEY, '1'); } catch (e) { /* private window */ }
}

function baseGame(f) {
  return {
    f,
    speed: 1,
    acc: 0,
    clock: 0,                      // real seconds the game has been running
    income: 0,                     // dollars per second, smoothed
    sciRate: 0,                    // science per second, smoothed
    rate: new Float64Array(TYPES.length),   // units per second shipped, by type
    contracts: [],
    nextContract: 20,
    contractId: 1,
    tut: -1,                       // tutorial step, TUTORIAL.length = finished card, -1 = off
    done: new Set(),               // milestone ids
    toasts: [],
    log: [],                       // the last few notable events, for the sidebar
    _bank: 0,
    _sci: 0,
    _units: new Float64Array(TYPES.length),
  };
}

/* -------------------------------------------------------------------- loop --- */

/**
 * Advance the game by one real frame. The simulation is stepped at a fixed 30 Hz
 * however fast the display is running, so a 144 Hz monitor and a 60 Hz one get
 * exactly the same factory — and so does the headless harness, which is the only
 * reason any of the numbers in machines.js can be trusted.
 */
export function stepGame(g, realDt) {
  const dt = Math.min(0.25, realDt) * g.speed;
  g.clock += Math.min(0.25, realDt);
  g.acc += dt;
  let guard = 0;
  while (g.acc >= STEP && guard++ < 12) {
    g.acc -= STEP;
    stepFactory(g.f, STEP);
    tickContracts(g, STEP);
  }
  // Ticked here rather than from the draw loop, so a headless run notices the
  // same things a played one does.
  checkMilestones(g);
  stepTutorial(g);
  // The averages are per *factory* second, not per wall second, so "$4.20/s"
  // means the same thing at 1x and at 3x. Nothing is smoothed while paused.
  if (dt > 0) smooth(g, dt);
  return drainFx(g.f);
}

/** Running averages, so the HUD shows a rate rather than a flicker. */
function smooth(g, dt) {
  const f = g.f;
  const k = Math.min(1, dt / EMA_WINDOW);
  const dCash = f.earned - g._bank;
  const dSci = f.studied - g._sci;
  g._bank = f.earned;
  g._sci = f.studied;
  g.income += ((dCash / Math.max(1e-6, dt)) - g.income) * k;
  g.sciRate += ((dSci / Math.max(1e-6, dt)) - g.sciRate) * k;
  for (let ty = 0; ty < TYPES.length; ty++) {
    const d = f.shipped[ty] - g._units[ty];
    g._units[ty] = f.shipped[ty];
    g.rate[ty] += ((d / Math.max(1e-6, dt)) - g.rate[ty]) * k;
    // Contracts are credited from this delta rather than from the effect queue,
    // which is capped per frame — a factory shipping two hundred gizmos a second
    // would otherwise quietly under-count its own deliveries.
    if (d > 0) creditSale(g, ty, d);
  }
}

/* --------------------------------------------------------------- contracts --- */

/**
 * Post, count down and settle the standing orders.
 *
 * The generator only ever asks for something you are already making, and only in
 * a quantity your current rate could deliver inside the clock with room to spare.
 * That sounds like it would make them free, and it very nearly does for a factory
 * that is running well — which is the point. A contract is not a test of whether
 * you can build a factory, it is a reason to *keep* a line pointed at a depot
 * while you are busy building somewhere else, and a nudge toward the richer end of
 * the ladder, since it always prefers the best thing you can already make.
 */
function tickContracts(g, dt) {
  for (let i = g.contracts.length - 1; i >= 0; i--) {
    const c = g.contracts[i];
    c.left -= dt;
    if (c.done >= c.need) {
      g.f.cash += c.pay;
      g.f.earned += c.pay;
      g.contracts.splice(i, 1);
      toast(g, `Contract filled — ${money(c.pay)}`, '#a7f070');
      logEvent(g, `Shipped ${c.need} ${TYPES[c.ty].name}: ${money(c.pay)}`);
    } else if (c.left <= 0) {
      g.contracts.splice(i, 1);
      toast(g, `Contract expired — ${c.need - c.done} ${TYPES[c.ty].name} short`, '#ff8a6a');
    }
  }

  g.nextContract -= dt;
  if (g.contracts.length < CONTRACT_SLOTS && g.nextContract <= 0) {
    const c = makeContract(g);
    g.nextContract = CONTRACT_GAP;
    if (c) {
      g.contracts.push(c);
      toast(g, `New contract: ${c.need} ${TYPES[c.ty].name}`, '#ffcd75');
    } else {
      // Nothing worth asking for yet — a factory that is not shipping does not
      // need a deadline, it needs a belt. Look again soon rather than in a minute.
      g.nextContract = 12;
    }
  }
}

function makeContract(g) {
  // Whatever the factory is actually shipping, richest first. A factory that has
  // shipped nothing at all gets nothing to do, which is correct: the first thing
  // to fix is that.
  const live = [];
  for (let ty = 0; ty < TYPES.length; ty++) {
    if (g.rate[ty] > 0.05) live.push({ ty, rate: g.rate[ty], value: TYPES[ty].value });
  }
  if (!live.length) return null;
  live.sort((a, b) => b.value * b.rate - a.value * a.rate);
  // Bias toward the best thing on the line, but not always, so the board is not
  // one repeated card.
  const pick = live[Math.random() < 0.65 ? 0 : Math.floor(Math.random() * live.length)];
  if (g.contracts.some(c => c.ty === pick.ty)) return null;

  const secs = 70 + Math.random() * 80;
  const need = Math.max(5, Math.round(pick.rate * secs));
  const pay = Math.max(20, Math.round(need * TYPES[pick.ty].value * CONTRACT_PREMIUM));
  return {
    id: g.contractId++,
    ty: pick.ty,
    need,
    done: 0,
    pay,
    total: Math.round(need / Math.max(0.02, pick.rate) * CONTRACT_GRACE),
    left: Math.round(need / Math.max(0.02, pick.rate) * CONTRACT_GRACE),
  };
}

/** Credit deliveries against every contract asking for that type. */
export function creditSale(g, ty, n = 1) {
  for (const c of g.contracts) {
    if (c.ty === ty && c.done < c.need) c.done = Math.min(c.need, c.done + n);
  }
}

/* ---------------------------------------------------------------- tutorial --- */

/**
 * Advance the walkthrough if the current step has been done.
 *
 * It watches the factory rather than the mouse, so there is no wrong order and
 * nothing to click through: a player who builds the Depot before the Extractor
 * simply finds two steps ticked at once, which is the correct response to somebody
 * who is ahead of the lesson.
 */
export function stepTutorial(g) {
  if (g.tut < 0 || g.tut >= TUTORIAL.length) return;
  while (g.tut < TUTORIAL.length && TUTORIAL[g.tut].done(g.f, g)) {
    g.tut++;
    g.tutAt = g.f.t;
  }
  if (g.tut >= TUTORIAL.length) markTaught();
}

/** Put the walkthrough away, whether it was finished or skipped. */
export function endTutorial(g) {
  g.tut = -1;
  markTaught();
}

/* -------------------------------------------------------------- milestones --- */

/**
 * Tick the opening off as it happens. Nothing is awarded and nothing is gated —
 * the list is a map of what the game contains, shown to a player who has not seen
 * it yet and quietly emptied as they find each part of it themselves.
 */
export function checkMilestones(g) {
  const f = g.f;
  const hit = id => {
    if (g.done.has(id)) return;
    g.done.add(id);
    // While the walkthrough is running it is already saying all of this, one step
    // at a time and in more detail. Tick them off quietly and let it talk.
    if (g.tut >= 0) return;
    const ms = MILESTONES.find(m => m.id === id);
    if (ms) toast(g, `${ms.name}`, '#a8dcff');
  };
  if (f.sold > 0) hit('sell');
  if (f.studied > 0) hit('science');
  if (f.claim > CLAIM_START) hit('expand');
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    if (m.kind === 'gen' && m.fuel > 0) hit('power');
    if (m.kind === 'mut' && m.net >= 0) hit('mutate');
  }
  for (let ty = 11; ty < TYPES.length; ty++) if (f.shipped[ty] > 0) hit('recipe');
}

/* ------------------------------------------------------------------ toasts --- */

export function toast(g, text, color = '#e8ecf8') {
  g.toasts.push({ text, color, life: 4.2 });
  if (g.toasts.length > 5) g.toasts.shift();
}

export function logEvent(g, text) {
  g.log.unshift({ text, at: g.f.t });
  if (g.log.length > 12) g.log.pop();
}

export function ageToasts(g, dt) {
  for (let i = g.toasts.length - 1; i >= 0; i--) {
    g.toasts[i].life -= dt;
    if (g.toasts[i].life <= 0) g.toasts.splice(i, 1);
  }
}

/* -------------------------------------------------------------------- save --- */

/**
 * The save file.
 *
 * The world is not stored: it is a pure function of its seed, so a save is the
 * seed plus the handful of slots you have since cleared. Everything else is the
 * machines — kind, slot, facing, level and setting — and the books. Gizmos in
 * flight are deliberately not saved: reloading empties the belts, which costs a
 * few seconds of production and saves a great deal of complexity, and no factory
 * game has ever been ruined by that.
 */
export function serialise(g) {
  const f = g.f;
  const machines = [];
  for (const i of f.cells) {
    const m = f.grid[i];
    if (!m) continue;
    machines.push([i, m.kind, m.dir, m.level, m.mut, m.mir, m.off | 0]);
  }
  const crate = f.crate.map(m => [m.kind, m.dir, m.level, m.mut, m.mir, m.off | 0]);
  const cleared = [];
  const base = generateWorld(f.seed);
  for (let i = 0; i < f.terrain.length; i++) {
    if (f.terrain[i] !== base.terrain[i]) cleared.push(i);
  }
  return {
    v: 1,
    seed: f.seed,
    claim: f.claim,
    cash: Math.round(f.cash),
    earned: Math.round(f.earned),
    spent: Math.round(f.spent),
    science: Math.round(f.science),
    studied: Math.round(f.studied),
    sold: f.sold,
    t: Math.round(f.t),
    done: f.done.slice(),
    shipped: Array.from(f.shipped).map(n => Math.round(n)),
    milestones: Array.from(g.done),
    tut: g.tut,
    cleared,
    machines,
    crate,
  };
}

export function deserialise(data) {
  if (!data || data.v !== 1) return null;
  const world = generateWorld(data.seed);
  const f = createFactory({ seed: data.seed, world, cash: data.cash || 0 });
  f.claim = Math.max(CLAIM_START, Math.min(WORLD, data.claim || CLAIM_START));
  for (const i of data.cleared || []) f.terrain[i] = OPEN;
  f.mapRev++;
  f.earned = data.earned || 0;
  f.spent = data.spent || 0;
  f.science = data.science || 0;
  f.studied = data.studied || 0;
  f.sold = data.sold || 0;
  f.t = data.t || 0;
  f.done = (data.done || []).filter(id => techById(id));
  (data.shipped || []).forEach((n, ty) => { if (ty < f.shipped.length) f.shipped[ty] = n; });

  for (const [i, kind, dir, level, mut, mir, off] of data.machines || []) {
    if (!Number.isInteger(i) || i < 0 || i >= f.grid.length) continue;
    const m = makeMachine({ kind, dir, mut, mir, level, off }, f.nid++);
    if (kind === 'ext') {
      // The world is rebuilt from its seed, so an Extractor whose ore is not
      // there any more — an older save, a changed generator — cannot stand. It
      // goes in the crate rather than onto a slot where it would have nothing to
      // pull up and no type to be.
      if (f.patch[i] < 0) { f.crate.push(m); continue; }
      m.mut = f.patch[i];
      m.rich = f.rich[i] || 1;
    }
    f.grid[i] = m;
  }
  for (const [kind, dir, level, mut, mir, off] of data.crate || []) {
    if (!kind) continue;
    f.crate.push(makeMachine({ kind, dir, mut, mir, level, off }, f.nid++));
  }
  rebuild(f);

  const g = baseGame(f);
  g._bank = f.earned;
  g._sci = f.studied;
  for (let ty = 0; ty < f.shipped.length; ty++) g._units[ty] = f.shipped[ty];
  for (const id of data.milestones || []) g.done.add(id);
  g.tut = Number.isInteger(data.tut) ? data.tut : -1;
  return g;
}

export function saveGame(g) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialise(g)));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return deserialise(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to do */ }
}

export { STEP, SAVE_KEY };
