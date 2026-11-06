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
  CONTRACT_PREMIUM, contractPremium, CONTRACT_GRACE, CONTRACT_GAP, cellOf, cx, cy, rng, hashSeed,
  money, makeMachine, techById, unlockedBy, OPEN, MOUNTAIN, VALLEY, STORY_LEVELS,
} from './machines.js';
import { generateWorld, storyWorld } from './world.js';
import { spawnMite, addMissingNests } from './bugs.js';
import {
  createFactory, starterKit, stepFactory, rebuild, drainFx, diagnose, reachesPayout, occupy,
} from './sim.js';

// v2: the 80x80 world. v3: machines bigger than one slot. Older saves cannot be read.
const SAVE_KEY = 'gizmo3.save.v3';
/** The story campaign is saved on its own, so it and an endless world can both be in progress. */
const STORY_KEY = 'gizmo3.story.v1';
/** Creature kinds by the number a save stores them as. Append only. */
const BUG_KINDS = ['mite', 'skitter', 'beetle'];
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

/**
 * One world of the story campaign. Money and science start fresh — the level's own
 * starting cash and no science at all — and the research in `done` carries over
 * from the world before.
 */
export function createStoryGame(level, { done = [], seed = null, teach = null, stats = null } = {}) {
  const L = STORY_LEVELS[level];
  const s = seed == null ? (Math.floor(Math.random() * 1e9) | 0) : seed;
  const world = storyWorld(level, s);
  const f = createFactory({ seed: s, world, cash: L.cash });
  f.done = done.slice();
  rebuild(f);
  const g = baseGame(f);
  g.story = newStory(level);
  if (stats) g.story.total = { ...stats };
  // The walkthrough runs on the first rock only, and only for somebody new.
  g.tut = level === 0 && (teach == null ? !hasBeenTaught() : teach) ? 0 : -1;
  return g;
}

function newStory(level) {
  return {
    level,
    goals: STORY_LEVELS[level].goals.map(() => ({ done: false, held: 0 })),
    complete: false,
    doneAt: 0,
    // Running totals across the campaign so far, for the last screen.
    total: { t: 0, earned: 0, shipped: 0, zapped: 0 },
  };
}

/** How far along one goal is, 0 to 1, and a short line saying so. */
export function goalProgress(g, k) {
  const goal = STORY_LEVELS[g.story.level].goals[k];
  const st = g.story.goals[k];
  const f = g.f;
  if (st.done) return { p: 1, text: 'done' };
  if (goal.k === 'ship') {
    const have = Math.floor(f.shipped[goal.ty] || 0);
    return { p: Math.min(1, have / goal.n), text: `${have} / ${goal.n}` };
  }
  if (goal.k === 'cash') {
    return { p: Math.min(1, f.earned / goal.n), text: `${money(f.earned)} / ${money(goal.n)}` };
  }
  const now = (g.rate[goal.ty] || 0) * 60;
  return {
    p: Math.min(1, st.held / goal.secs),
    text: `${now.toFixed(1)}/min${st.held > 0 ? ` · held ${Math.floor(st.held)}s` : ''}`,
    hot: now >= goal.per,
  };
}

/**
 * Tick the contract. A rate goal counts while the smoothed rate is at or over the
 * target and starts again from nothing the moment it drops below — it is a test of
 * a line that holds, not of a burst. Once a goal is met it stays met.
 */
function tickStory(g, dt) {
  const s = g.story;
  if (!s || s.complete) return;
  const L = STORY_LEVELS[s.level];
  const f = g.f;
  L.goals.forEach((goal, k) => {
    const st = s.goals[k];
    if (st.done) return;
    if (goal.k === 'ship') st.done = (f.shipped[goal.ty] || 0) >= goal.n;
    else if (goal.k === 'cash') st.done = f.earned >= goal.n;
    else {
      st.held = (g.rate[goal.ty] || 0) * 60 >= goal.per ? st.held + dt : 0;
      st.done = st.held >= goal.secs;
    }
    if (st.done) {
      toast(g, `Contract: ${goalTextOf(goal)} — done`, '#a7f070');
      f.fx.push({ k: 'goal' });
    }
  });
  if (s.goals.every(st => st.done)) {
    s.complete = true;
    s.doneAt = f.t;
    f.fx.push({ k: 'storyDone', level: s.level });
  }
}

const goalTextOf = goal => {
  const nm = TYPES[goal.ty]?.name || '';
  return goal.k === 'ship' ? `${goal.n} ${nm}` : goal.k === 'rate' ? `${goal.per} ${nm}/min` : money(goal.n);
};

/** The numbers for the end-of-world card, this world's and the campaign's so far. */
export function storyStats(g) {
  const f = g.f;
  let shipped = 0;
  for (let ty = 0; ty < f.shipped.length; ty++) shipped += f.shipped[ty];
  const here = { t: f.t, earned: f.earned, shipped, zapped: f.zapped || 0 };
  const tot = g.story.total;
  return {
    here,
    machines: f.cells.length,
    claim: f.claim,
    studied: f.studied,
    research: f.done.length,
    total: { t: tot.t + here.t, earned: tot.earned + here.earned, shipped: tot.shipped + here.shipped, zapped: tot.zapped + here.zapped },
  };
}

/** The next world of the campaign, carrying the research and the running totals. */
export function nextStoryGame(g) {
  const st = storyStats(g);
  return createStoryGame(g.story.level + 1, { done: g.f.done, stats: st.total, teach: false });
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
    hist: { income: [], sci: [], noise: [], at: 0 },   // the last ten minutes, for the graph
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
    // The story has its own contract; the endless order board is not posted there.
    if (g.story) tickStory(g, STEP);
    else tickContracts(g, STEP);
  }
  // Ticked here rather than from the draw loop, so a headless run notices the
  // same things a played one does.
  checkMilestones(g);
  stepTutorial(g);
  // The averages are per *factory* second, not per wall second, so "$4.20/s"
  // means the same thing at 1x and at 3x. Nothing is smoothed while paused.
  if (dt > 0) smooth(g, dt);
  sample(g);
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

/**
 * One point on the STATS graph every five factory seconds, a hundred and twenty of
 * them: the last ten minutes of income, science and noise. Kept in memory only —
 * a graph that survived a reload would mostly be showing you the reload.
 */
export const HIST_STEP = 5;
export const HIST_LEN = 120;
function sample(g) {
  const h = g.hist;
  if (g.f.t < h.at) return;
  h.at = g.f.t + HIST_STEP;
  h.income.push(g.income);
  h.sci.push(g.sciRate);
  h.noise.push(g.f.noise || 0);
  for (const k of ['income', 'sci', 'noise']) if (h[k].length > HIST_LEN) h[k].shift();
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
      g.f.fx.push({ k: 'contract', v: c.pay });
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
  const pay = Math.max(20, Math.round(need * TYPES[pick.ty].value * contractPremium(g.f.done)));
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
  for (let ty = 11; ty <= 13; ty++) if (f.shipped[ty] > 0) hit('recipe');
  if (f.zapped > 0) hit('zap');
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
    machines.push([i, m.kind, m.dir, m.level, m.mut, m.mir, m.off | 0, Math.round(m.hp * 10) / 10, m.charge | 0, m.hot | 0]);
  }
  const crate = f.crate.map(m => [m.kind, m.dir, m.level, m.mut, m.mir, m.off | 0, Math.round(m.hp * 10) / 10]);
  // Every slot whose ground differs from what the seed made: rubble cleared, and
  // mountains worked out to rubble. Stored with what the ground is now.
  const ground = [];
  const base = f.world?.terrain || generateWorld(f.seed).terrain;
  for (let i = 0; i < f.terrain.length; i++) {
    if (f.terrain[i] !== base[i]) ground.push([i, f.terrain[i]]);
  }
  const mtn = (f.mountains || []).filter(m => m.left < m.amount).map(m => [m.id, m.left]);
  return {
    v: 1,
    tv: 2,               // tech version: 2 = Generators, Balancers, Sorters, Mutators and Fusers are research
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
    story: g.story ? {
      level: g.story.level, complete: g.story.complete, doneAt: Math.round(g.story.doneAt),
      goals: g.story.goals.map(st => [st.done ? 1 : 0, Math.round(st.held)]), total: g.story.total,
    } : null,
    ground,
    mtn,
    beacon: f.beacon ? {
      got: f.beacon.got, hp: Math.round(f.beacon.hp), loss: f.beacon.loss,
      fedAgo: Math.min(1e6, Math.round(f.t - f.beacon.fedAt)), assaults: f.beacon.assaults,
      done: f.beacon.done, doneAt: Math.round(f.beacon.doneAt || 0),
    } : null,
    machines,
    crate,
    // Mites are saved, unlike gizmos: reloading must not be a way to make a
    // swarm that is halfway through your belts simply vanish.
    bugs: {
      // 1: nests had a hundredth of today's health. 2: no Skitters. 3: half the
      // nests. 4: today.
      nv: 4,
      nests: (f.nests || []).map(n => [n.cell, Math.round(n.hp), Math.round(n.anger || 0), n.kind === 'skitter' ? 1 : 0]),
      mites: (f.mites || []).map(mt => [Math.round(mt.x * 100) / 100, Math.round(mt.y * 100) / 100,
        Math.round(mt.hp * 10) / 10, mt.max, BUG_KINDS.indexOf(mt.kind || 'mite'), mt.beacon ? 1 : 0]),
      tremor: Math.round(f.tremor || 0),
      swarm: Math.round(f.swarm || 0),
      waves: f.waves || 0,
      zapped: f.zapped || 0,
      chewed: f.chewed || 0,
      nextNest: Math.round(f.nextNest ?? -1),
    },
  };
}

export function deserialise(data) {
  if (!data || data.v !== 1) return null;
  const world = data.story ? storyWorld(data.story.level, data.seed) : generateWorld(data.seed);
  const f = createFactory({ seed: data.seed, world, cash: data.cash || 0 });
  f.claim = Math.max(CLAIM_START, Math.min(WORLD, data.claim || CLAIM_START));
  for (const i of data.cleared || []) f.terrain[i] = OPEN;        // saves before mountains
  for (const [i, t] of data.ground || []) if (i >= 0 && i < f.terrain.length) f.terrain[i] = t;
  if (data.beacon && f.beacon) {
    const s = data.beacon;
    for (const ty of Object.keys(f.beacon.got)) f.beacon.got[ty] = s.got?.[ty] || 0;
    f.beacon.hp = s.hp ?? f.beacon.hp;
    f.beacon.loss = s.loss || 0;
    f.beacon.fedAt = (data.t || 0) - (s.fedAgo ?? 1e9);
    f.beacon.assaults = s.assaults || 0;
    f.beacon.done = !!s.done;
    f.beacon.doneAt = s.doneAt || 0;
  }
  for (const [id, left] of data.mtn || []) {
    const mt = f.mountains[id];
    if (!mt) continue;
    mt.left = left;
    if (left <= 0) for (const c of mt.cells) f.mtn[c] = -1;
  }
  f.mapRev++;
  f.earned = data.earned || 0;
  f.spent = data.spent || 0;
  f.science = data.science || 0;
  f.studied = data.studied || 0;
  f.sold = data.sold || 0;
  f.t = data.t || 0;
  f.done = (data.done || []).filter(id => techById(id));
  // A world saved before the starter machines became research already has them on
  // the map. Give it the nodes, at rank I, so it can keep building what it built.
  if (!(data.tv >= 2)) {
    for (const id of OLD_FREE_TECH) if (!f.done.includes(id)) f.done.push(id);
  }
  (data.shipped || []).forEach((n, ty) => { if (ty < f.shipped.length) f.shipped[ty] = n; });

  for (const [i, kind, dir, level, mut, mir, off, hp, charge, hot] of data.machines || []) {
    if (!Number.isInteger(i) || i < 0 || i >= f.grid.length) continue;
    const m = makeMachine({ kind, dir, mut, mir, level, off, hp: hp ?? undefined }, f.nid++);
    if (charge) m.charge = charge;
    if (hot) m.hot = hot;
    if (kind === 'ext') {
      // The world is rebuilt from its seed, so an Extractor whose ore is not
      // there any more — an older save, a changed generator — cannot stand. It
      // goes in the crate rather than onto a slot where it would have nothing to
      // pull up and no type to be.
      if (f.patch[i] < 0) { f.crate.push(m); continue; }
      m.mut = f.patch[i];
      m.rich = f.rich[i] || 1;
    }
    // A save from before mountains and valleys may have a machine standing where
    // one now is. The machine wins: the ground under it is made open again.
    if (f.terrain[i] === MOUNTAIN || f.terrain[i] === VALLEY) {
      f.terrain[i] = OPEN;
      const id = f.mtn[i];
      if (id >= 0) { f.mtn[i] = -1; const mt = f.mountains[id]; mt.cells = mt.cells.filter(c => c !== i); }
    }
    occupy(f, m, i);
  }
  for (const [kind, dir, level, mut, mir, off, hp] of data.crate || []) {
    if (!kind) continue;
    f.crate.push(makeMachine({ kind, dir, mut, mir, level, off, hp: hp ?? undefined }, f.nid++));
  }
  const b = data.bugs;
  if (b) {
    const scale = b.nv >= 2 ? 1 : 100;
    f.nests = (b.nests || []).filter(([c, hp]) => Number.isInteger(c) && hp > 0)
      .map(([cell, hp, anger, k]) => ({ cell, hp: hp * scale, anger: anger || 0, kind: k ? 'skitter' : 'mite' }));
    if (!(b.nv >= 4)) addMissingNests(f);
    // Nowhere for a nest to stand on a mountain or in a valley that an older save
    // put it on; new ones will dig in elsewhere to make up the number.
    f.nests = f.nests.filter(n => f.terrain[n.cell] === OPEN);
    f.mites = [];
    for (const [x, y, hp, max, k, toBeacon] of b.mites || []) {
      const mt = spawnMite(f, x, y, max || hp, BUG_KINDS[k] || 'mite');
      if (mt) { mt.x = x; mt.y = y; mt.hp = hp; if (toBeacon) mt.beacon = 1; }
    }
    f.swarm = b.swarm || 0;
    f.waves = b.waves || 0;
    f.zapped = b.zapped || 0;
    f.chewed = b.chewed || 0;
    f.nextNest = Number.isFinite(b.nextNest) ? b.nextNest : -1;
    f.tremor = b.tremor || 0;
  }
  rebuild(f);

  const g = baseGame(f);
  g._bank = f.earned;
  g._sci = f.studied;
  for (let ty = 0; ty < f.shipped.length; ty++) g._units[ty] = f.shipped[ty];
  for (const id of data.milestones || []) g.done.add(id);
  g.tut = Number.isInteger(data.tut) ? data.tut : -1;
  if (data.story) {
    g.story = newStory(data.story.level);
    g.story.complete = !!data.story.complete;
    g.story.doneAt = data.story.doneAt || 0;
    (data.story.goals || []).forEach(([d, held], k) => {
      if (g.story.goals[k]) { g.story.goals[k].done = !!d; g.story.goals[k].held = held || 0; }
    });
    if (data.story.total) g.story.total = { ...g.story.total, ...data.story.total };
  }
  return g;
}

/** What used to be on sale from the start, as the research that now unlocks it. */
const OLD_FREE_TECH = ['generators', 'balancing', 'sorting', 'mut1', 'fusing', 'mut2', 'mut3', 'mut4', 'mut5', 'mut6', 'mut7'];

export function saveGame(g) {
  try {
    localStorage.setItem(g.story ? STORY_KEY : SAVE_KEY, JSON.stringify(serialise(g)));
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

/** A save from the 56x56 world, which this version cannot load. */
export function hasOldSave() {
  try { return !!(localStorage.getItem('gizmo3.save.v1') || localStorage.getItem('gizmo3.save.v2')); } catch (e) { return false; }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to do */ }
}

/** The saved campaign, or null. */
export function loadStory() {
  try {
    const raw = localStorage.getItem(STORY_KEY);
    if (!raw) return null;
    const g = deserialise(JSON.parse(raw));
    return g && g.story ? g : null;
  } catch (e) {
    return null;
  }
}

/** Which world the saved campaign is on, or -1 if there is none. */
export function storyLevelSaved() {
  try {
    const raw = localStorage.getItem(STORY_KEY);
    return raw ? (JSON.parse(raw).story?.level ?? -1) : -1;
  } catch (e) {
    return -1;
  }
}

export function clearStory() {
  try { localStorage.removeItem(STORY_KEY); } catch (e) { /* nothing to do */ }
}

export { STEP, SAVE_KEY };
