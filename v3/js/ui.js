/**
 * ui.js — the panels around the world.
 *
 * Everything here is plain DOM, updated in place. The rule the whole file follows
 * is that a frame must not touch the DOM unless something changed: the HUD keeps
 * the last string it wrote and compares, the palette redraws only when money
 * crosses a price, and the right-hand panel rebuilds only when the selection or
 * the tab does. A factory game runs for hours and a layout thrash sixty times a
 * second is the difference between a game and a fan heater.
 */

import {
  TYPES, KINDS, RECIPES, TECH, MILESTONES, LADDERED, WORLD, CLAIM_START, sizeKind,
  catalogue, buyCost, upgradeCost, scrapValue, label, describe, cycleTime, drawOf,
  levelCap, techById, techOpen, unlockedBy, expandCost, money, num, clock,
  cellOf, cx, cy, claimMin, claimMax, RUBBLE_COST, OPEN, RUBBLE, BEDROCK, DIRS, SPACE, STORY_LEVELS, goalText,
  genOutput, genReach, energyOf, capacity, recipeOf, recipeText, sideName,
  MAX_LEVEL, ORE_NAME, GEN_OUTPUT, UNPOWERED, powerMult, DIR_NAME, CONTRACT_PREMIUM,
  MUT_PRICE, missingFor, queued, LANE, STALL_BADGE, FAM_NAME, TUTORIAL, TUTORIAL_END,
  upFam, tierOf, famOf, copyable, exitDirs, intake, pickInputs, PASSIVE, PLUMBING,
  ONE_MOUTH, acceptsFrom, faceHit, ARMORY, AMMO, AMMO_CHARGES, broken, maxHp, CHARGED,
  CHARGED_MULT, shotsOf,
  repairCost, zapRange, zapDamage, zapCool, zapChain, MAX_HP, NEST_HP, NEST_BOUNTY,
  SWARM_GRACE, twoInput, CLEARABLE, ARM_RESOLVE, BRANCHES, bridgeSpan, tremorCost, beaconLoss,
  contractPremium, surveyed, rankOf, rankCost, TECH_RANKS, ROMAN, rankBlurb, nestAnger, nestBrood, NEST_BROOD, nestSpec,
  MOUNTAIN, VALLEY, BEETLE, TREMOR_COST, BRIDGE_SPAN, DRILL_BASE, DRILL_PER_TIER, BEACON,
  BEACON_HP, BEACON_LOSS, BEACON_ASSAULTS, BEACON_NEED,
  NESTS, MITE, SKITTER, SKITTER_FROM,
  NEST_BROOD_MAX, NEST_ANGER, NEST_ANGER_MIN,
} from './machines.js';
import { damaged, mitesInside, swarmEta, nestAt } from './bugs.js';
import { mountainAt, mountainAhead, scrapPay } from './sim.js';
import {
  progress as beaconProgress, beaconLines, beaconRepairCost, beaconHot, beaconReachable, mouthApproach,
} from './beacon.js';
import { upgradeQuote, scrapQuote, repairQuote } from './blueprint.js';
import { HIST_STEP, goalProgress } from './game.js';
import { bodyTile, frameCount, shade, px } from './render.js';
import {
  kindCounts, countKind, diagnose, machineLoad, speedOf, reachesPayout,
  crateStacks, crateKey, jams, heldTypes, looseTypes,
} from './sim.js';
import { powerSummary } from './power.js';
import { Gus, Typewriter } from './teacher.js';
import { sfx } from './sound.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

/* --------------------------------------------------------------- palette --- */

/**
 * The build bar. Five groups, in the order a factory grows: the plumbing you use
 * constantly at the top, then the things that make raw material and money, then
 * the things that make raw material *worth* something, then the two machines that
 * are deep enough in the tech tree that most games never see them.
 */
const GROUPS = [
  { name: 'LOGISTICS', kinds: ['pipe', 'bal', 'sort', 'store'] },
  { name: 'GROUND & TRADE', kinds: ['ext', 'gen', 'depot', 'lab'] },
  { name: 'PROCESSING', kinds: ['mut', 'fuse', 'asm'] },
  { name: 'MULTIPLYING', kinds: ['dup', 'trident'] },
  { name: 'DEFENCE', kinds: ['arm', 'zap'] },
  { name: 'TERRAIN', kinds: ['drill', 'bridge'] },
];

/** Which number key holds which kind. Ten slots, ten of the game's twelve machines. */
export const HOTKEYS = {
  1: { kind: 'pipe' }, 2: { kind: 'bal' }, 3: { kind: 'sort' }, 4: { kind: 'store' },
  5: { kind: 'ext' }, 6: { kind: 'gen' }, 7: { kind: 'depot' }, 8: { kind: 'lab' },
  9: { kind: 'mut' }, 0: { kind: 'fuse' },
};
const KEY_OF = {};
for (const [k, v] of Object.entries(HOTKEYS)) KEY_OF[v.kind] = k;
// The letter keys, shown on the build bar like the numbers.
Object.assign(KEY_OF, { arm: 'B', zap: 'Z', drill: 'G', bridge: 'N' });

/** A 28-pixel picture of a machine, for a palette row or a panel heading. */
export function icon(spec, size = 28) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bodyTile({ dir: 0, level: 1, mut: spec.mut ?? 1, mir: 0, ...spec }, 0), 0, 0);
  return c;
}

export class Palette {
  constructor(host, onPick) {
    this.host = host;
    this.onPick = onPick;
    this.rows = [];
    this.key = '';
  }

  /** Rebuild the list. Only when what is *available* changes, not when cash does. */
  build(g) {
    const f = g.f;
    const counts = kindCounts(f);
    const on = unlockedBy(f.done);
    const key = [...on].sort().join(',') + '|' + JSON.stringify(counts);
    if (key === this.key) { this.price(g); return; }
    this.key = key;

    this.host.textContent = '';
    this.rows = [];

    for (const grp of GROUPS) {
      const kinds = grp.kinds.filter(k => on.has(k) || (k === 'asm' && anyRecipe(on)));
      if (!kinds.length) continue;
      this.host.appendChild(el('div', 'pal-group', grp.name));
      for (const kind of kinds) {
        if (kind === 'asm') {
          RECIPES.forEach((r, i) => {
            if (on.has('asm:' + i)) this.addRow(g, { kind: 'asm', mut: i }, counts);
          });
        } else if (kind === 'mut') {
          let low = 1;
          while (low < 7 && !on.has('mut:' + low)) low++;
          this.addRow(g, { kind: 'mut', mut: low }, counts, true);
        } else {
          this.addRow(g, { kind }, counts);
        }
      }
    }
    this.price(g);
  }

  addRow(g, spec, counts, tiers = false) {
    const btn = el('button', 'pal');
    btn.appendChild(icon(spec));
    const mid = el('div');
    // A Mutator's tier is what you are buying, so it belongs in the name. A
    // Sorter's filter is free to change once it is down, so it does not.
    const nm = spec.kind === 'sort' ? KINDS.sort.name : label(spec);
    mid.appendChild(el('div', 'nm', nm.toUpperCase()));
    const k = KEY_OF[spec.kind];
    if (k) mid.appendChild(el('span', 'key', `KEY ${k}`));
    btn.appendChild(mid);
    const cost = el('div', 'cost');
    btn.appendChild(cost);
    btn.onclick = () => this.onPick({ ...spec });
    this.host.appendChild(btn);
    this.rows.push({ btn, cost, spec, tiers });

    // The Mutator is one row and seven machines. Rather than spend seven lines of
    // a narrow bar on it, its tiers sit underneath as a strip of colours that
    // appears when the Mutator is the thing in your hand.
    if (tiers) {
      const strip = el('div', 'chips');
      strip.style.padding = '2px 6px 6px';
      strip.hidden = true;
      const on = unlockedBy(g.f.done);
      for (let t = 1; t < 8; t++) {
        // Only the rungs researched so far; the rest appear as they are unlocked.
        if (!on.has('mut:' + t)) continue;
        const c = el('button', 'chip');
        const sw = el('i');
        sw.style.background = TYPES[t].color;
        c.appendChild(sw);
        c.appendChild(document.createTextNode(TYPES[t].name));
        c.dataset.tier = t;
        c.onclick = ev => { ev.stopPropagation(); this.onPick({ kind: 'mut', mut: t }); };
        strip.appendChild(c);
      }
      this.host.appendChild(strip);
      this.rows[this.rows.length - 1].strip = strip;
    }
  }

  /** Repaint prices and affordability. Cheap enough to run every frame. */
  price(g) {
    const f = g.f;
    const counts = kindCounts(f);
    for (const r of this.rows) {
      const c = buyCost(r.spec, counts[r.spec.kind] || 0);
      const txt = c === 0 ? 'FREE' : money(c);
      if (r.cost.textContent !== txt) r.cost.textContent = txt;
      r.btn.classList.toggle('poor', f.cash < c);
    }
  }

  /** Show which machine is in your hand, and open the Mutator strip if it is one. */
  select(spec) {
    for (const r of this.rows) {
      const on = !!spec && r.spec.kind === spec.kind
        && (r.spec.kind !== 'asm' || r.spec.mut === spec.mut);
      r.btn.classList.toggle('on', on);
      if (r.strip) {
        r.strip.hidden = !on;
        [...r.strip.children].forEach(c => {
          c.classList.toggle('on', on && spec.mut === +c.dataset.tier);
        });
      }
    }
  }
}

const anyRecipe = on => RECIPES.some((_, i) => on.has('asm:' + i));

/**
 * The crate: machines you own that are not standing anywhere.
 *
 * It fills when you build over the top of something, which in GIZMO 3 is the
 * ordinary way to change your mind about a slot. Nothing in here cost you
 * anything to put away and nothing costs anything to put back down — the point of
 * the crate is that rearranging a factory is moving things rather than a sequence
 * of scrap-and-rebuy transactions.
 */
export class Crate {
  constructor(host, onPick, onScrap) {
    this.host = host;
    this.box = $('crate-box');
    this.count = $('crate-n');
    this.onPick = onPick;
    this.onScrap = onScrap;
    this.key = '';
  }

  update(g, S) {
    const f = g.f;
    const stacks = crateStacks(f);
    const key = stacks.map(st => st.key + 'x' + st.n).join(',') + '|' + (S.tool?.crate || '');
    if (key === this.key) return;
    this.key = key;

    this.box.hidden = !stacks.length;
    this.count.textContent = stacks.length
      ? `${f.crate.length}  ·  RIGHT-CLICK TO SELL` : '';
    this.host.textContent = '';
    if (!stacks.length) return;

    for (const st of stacks) {
      const btn = el('button', 'pal' + (S.tool?.crate === st.key ? ' on' : ''));
      btn.appendChild(icon(st.spec));
      const mid = el('div');
      mid.appendChild(el('div', 'nm', label(st.spec).toUpperCase()));
      // The bar is 208 pixels wide and this label is repeated on every row, so it
      // says the one thing that differs between rows and nothing else. How to sell
      // is on the heading, once.
      mid.appendChild(el('span', 'key', `LEVEL ${st.spec.level || 1}`));
      btn.appendChild(mid);
      btn.appendChild(el('div', 'n', st.n > 1 ? `x${st.n}` : ''));
      btn.onclick = () => this.onPick(st);
      btn.oncontextmenu = e => { e.preventDefault(); this.onScrap(st.key); };
      this.host.appendChild(btn);
    }
  }
}

/* ---------------------------------------------------------------- diagrams --- */

/**
 * A gizmo as a chip: a pixel swatch with its name under it.
 *
 * These exist because "what does this machine need" was a question the inspector
 * could only answer in prose, and prose is the wrong shape for it. A row of
 * coloured squares with a plus and an arrow between them is read in about a
 * quarter of a second, and — this is the part that matters — the ones the machine
 * has not got are drawn hollow, so the same picture that says what it makes also
 * says what it is waiting for.
 */
const CHIP = 18;

function swatch(ty, have = true, size = CHIP) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  const t = TYPES[ty];
  if (!t) {                                     // "anything"
    px(ctx, 0, 0, size, size, '#0c0e18');
    for (let y = 2; y < size - 2; y += 4) {
      for (let x = 2; x < size - 2; x += 4) {
        px(ctx, x, y, 3, 3, ((x + y) / 2) % 8 ? '#39415e' : '#4b567a');
      }
    }
    return c;
  }
  px(ctx, 0, 0, size, size, '#0c0e18');
  if (have) {
    px(ctx, 2, 2, size - 4, size - 4, t.color);
    px(ctx, 2, 2, size - 4, 2, t.glow);
    px(ctx, 2, size - 4, size - 4, 2, shade(t.color, 0.65));
  } else {
    // Hollow: the outline of the thing it is short of.
    px(ctx, 2, 2, size - 4, 2, shade(t.color, 0.5));
    px(ctx, 2, size - 4, size - 4, 2, shade(t.color, 0.5));
    px(ctx, 2, 2, 2, size - 4, shade(t.color, 0.5));
    px(ctx, size - 4, 2, 2, size - 4, shade(t.color, 0.5));
  }
  return c;
}

/** One labelled chip in a diagram. `n` prefixes a count, e.g. "2x". */
function part(ty, have, label_, n) {
  const box = el('div', 'part' + (have ? ' have' : ' want'));
  box.appendChild(swatch(ty, have));
  box.appendChild(el('span', null, (n && n > 1 ? `${n}x ` : '') + (label_ ?? TYPES[ty]?.name ?? 'anything')));
  return box;
}

const op = sym => el('div', 'op', sym);

/**
 * What this machine turns into what, as a picture — and which halves of it are
 * standing in the machine right now.
 */
export function diagramFor(m) {
  const d = el('div', 'diagram');
  const anyHeld = m.buf[0]?.ty ?? heldTypes(m)[0];

  switch (m.kind) {
    case 'asm': {
      const r = recipeOf(m);
      // While a job is running the ingredients are in its hands, not its mouth, so
      // the picture reads from `work` first — a machine that is busy must not be
      // drawn as one that is short of exactly what it is busy with.
      const inHand = m.work.map(w => w.ty);
      r.ins.forEach((ty, i) => {
        if (i) d.appendChild(op('+'));
        d.appendChild(part(ty, inHand.includes(ty) || queued(m, ty) > 0, null, 1));
      });
      d.appendChild(op('\u2192'));
      d.appendChild(part(r.out, true));
      return d;
    }
    case 'fuse': {
      // A Fuser climbs whatever it is given, so the picture is drawn from what it
      // actually has in it — and from a generic pair when it has nothing.
      if (m.work.length) {
        const w = m.work[0].ty;
        d.appendChild(part(w, true, null, 1));
        d.appendChild(op('+'));
        d.appendChild(part(w, true, null, 1));
        d.appendChild(op('\u2192'));
        d.appendChild(part(upFam(w), true));
        return d;
      }
      const lanes = [...new Set(m.buf.map(g => g.ty))];
      const ty = lanes[0] ?? anyHeld;
      if (ty == null) {
        d.appendChild(part(null, true, 'two of a kind', 2));
        d.appendChild(op('\u2192'));
        d.appendChild(part(null, true, 'one rung up'));
        return d;
      }
      const n = queued(m, ty);
      d.appendChild(part(ty, n >= 1, null, 1));
      d.appendChild(op('+'));
      d.appendChild(part(ty, n >= 2, null, 1));
      d.appendChild(op('\u2192'));
      d.appendChild(part(upFam(ty), true));
      return d;
    }
    case 'arm': {
      const inHand = m.work.map(w => w.ty);
      ARMORY.ins.forEach((ty, i) => {
        if (i) d.appendChild(op('+'));
        d.appendChild(part(ty, inHand.includes(ty) || queued(m, ty) > 0, null, 1));
      });
      d.appendChild(op('\u2192'));
      d.appendChild(part(AMMO, true));
      return d;
    }
    case 'zap':
      d.appendChild(part(m.hot > 0 || m.buf.some(g => g.ty === CHARGED) ? CHARGED : AMMO,
        shotsOf(m) > 0 || m.buf.length > 0, null, 1));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, `${AMMO_CHARGES} zaps`));
      return d;
    case 'mut':
      d.appendChild(part(null, true, 'anything'));
      d.appendChild(op('\u2192'));
      d.appendChild(part(m.mut ?? 1, true));
      return d;
    case 'ext':
      d.appendChild(part(null, true, 'the ground'));
      d.appendChild(op('\u2192'));
      d.appendChild(part(m.mut ?? 0, true));
      return d;
    case 'dup': {
      const ty = anyHeld;
      d.appendChild(part(ty ?? null, ty != null, ty == null ? 'anything' : null));
      d.appendChild(op('\u2192'));
      d.appendChild(part(ty ?? null, ty != null, `${m.level + 1} out, ${m.level} of them copies`));
      return d;
    }
    case 'gen':
      d.appendChild(part(null, true, 'anything burnable'));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, 'power'));
      return d;
    case 'depot':
      d.appendChild(part(null, true, `anything, from the ${DIR_NAME[m.dir].toLowerCase()}`));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, 'money'));
      return d;
    case 'lab':
      d.appendChild(part(null, true, `anything, from the ${DIR_NAME[m.dir].toLowerCase()}`));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, 'science'));
      return d;
    case 'sort': {
      const ty = m.mut ?? 1;
      d.appendChild(part(ty, true));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, sideName(m)));
      d.appendChild(op('·'));
      d.appendChild(part(null, true, 'the rest go straight on'));
      return d;
    }
    default: {
      const outs = exitDirs(m).map(x => DIR_NAME[x]).join(', ');
      d.appendChild(part(anyHeld ?? null, anyHeld != null, anyHeld == null ? 'anything' : null));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, outs.toLowerCase()));
      return d;
    }
  }
}

/**
 * Everything physically inside the machine at this instant: what is queued at its
 * mouth, and what is in its hands for the length of the cycle. Two different
 * things, and the difference is why a machine can look full and still be starving.
 */
export function insideOf(m) {
  const d = el('div', 'inside');
  const held = heldTypes(m);
  const add = (list, cls, none) => {
    const row = el('div', 'inside-row');
    row.appendChild(el('span', 'inside-k', cls === 'held' ? 'IN HAND' : 'AT THE MOUTH'));
    const strip = el('div', 'strip');
    if (!list.length) strip.appendChild(el('span', 'none', none));
    for (const ty of list.slice(0, 12)) {
      const s = swatch(ty, true, 12);
      s.title = TYPES[ty].name;
      strip.appendChild(s);
    }
    if (list.length > 12) strip.appendChild(el('span', 'none', `+${list.length - 12}`));
    row.appendChild(strip);
    d.appendChild(row);
  };
  add(m.buf.map(g => g.ty), 'buf', 'empty');
  if (!PASSIVE.has(m.kind)) add(held, 'held', 'nothing');
  return d;
}

/* ---------------------------------------------------------------- tutorial --- */

/**
 * The first-visit walkthrough, as a card in the corner.
 *
 * One step at a time, because six at a time is a wall of text and nobody reads a
 * wall of text over a game they have not started. It watches the factory rather
 * than the mouse, so it never blocks anything and never insists on an order — a
 * player who builds the Depot first simply sees two steps tick together.
 */
/**
 * Gus's card: the walkthrough while it runs, and after that a tip whenever one is
 * waiting. Gus bobs and blinks beside it, and his lines type out with a blip; a
 * click on the text finishes the line at once.
 */
export class Tutorial {
  constructor(onSkip, onTipDone) {
    this.box = $('tutorial');
    this.count = $('tut-count');
    this.title = $('tut-title');
    this.body = $('tut-body');
    this.dots = $('tut-dots');
    this.key = '';
    this.mode = '';
    this.gus = new Gus($('gus'));
    this.type = new Typewriter(this.body, () => sfx('blip'));
    $('tut-skip').onclick = () => (this.mode === 'tip' ? onTipDone() : onSkip());
    this.box.querySelector('.tut-main').onclick = e => {
      if (e.target.id !== 'tut-skip' && this.type.typing) this.type.finish();
    };
    for (let i = 0; i < TUTORIAL.length; i++) this.dots.appendChild(el('i'));
  }

  /** @returns {boolean} whether the card is on screen, so the alert can stand down */
  update(g, tip = null) {
    const step = g.tut;
    if (step < 0 && !tip) { this.box.hidden = true; this.key = ''; this.mode = ''; return false; }
    this.box.hidden = false;
    const key = step >= 0 ? String(step) : 'tip:' + tip.id;
    if (key === this.key) return true;
    this.key = key;

    if (step < 0) {
      this.mode = 'tip';
      this.box.classList.remove('done');
      this.box.classList.add('tip');
      this.count.textContent = 'A TIP FROM GUS';
      $('tut-skip').textContent = 'GOT IT';
      this.title.textContent = tip.title;
      this.type.start(tip.body);
      return true;
    }
    this.mode = 'tut';
    const done = step >= TUTORIAL.length;
    const card = done ? TUTORIAL_END : TUTORIAL[step];
    this.box.classList.remove('tip');
    this.box.classList.toggle('done', done);
    this.count.textContent = done ? 'ALL DONE' : `STEP ${step + 1} OF ${TUTORIAL.length}`;
    $('tut-skip').textContent = done ? 'CLOSE' : 'SKIP';
    this.title.textContent = card.title;
    this.type.start(card.body);
    [...this.dots.children].forEach((d, i) => {
      d.className = i < step ? 'on' : (i === step ? 'now' : '');
    });
    return true;
  }

  /** Every frame: type the line on, and animate Gus. */
  tick(dt) {
    if (this.box.hidden) return;
    const talking = this.type.tick(dt);
    this.gus.tick(dt, talking);
  }
}

/* -------------------------------------------------------------------- hud --- */

export class Hud {
  constructor() {
    this.last = {};
    this.cash = $('s-cash');
    this.sci = $('s-sci');
    this.pwrFill = $('pwr-fill');
    this.pwrText = $('pwr-text');
    this.claim = $('s-claim');
    this.expand = $('btn-expand');
    this.alert = $('alert');
    this.toasts = $('toasts');
  }

  set(node, sel, text) {
    const k = sel + node.id;
    if (this.last[k] === text) return;
    this.last[k] = text;
    node.querySelector(sel).textContent = text;
  }

  update(g, teaching = false) {
    const f = g.f;
    // While the walkthrough is running it owns the alert's corner, and `alertFor`
    // reads this to know to stand down.
    this.teaching = teaching;
    // Every string here is written to fit its box in Silkscreen, which is wider
    // than it looks in a fallback font. The long-form versions of all of them
    // live one click away on the STATS tab, where there is room.
    this.set(this.cash, 'b', money(f.cash));
    this.set(this.cash, 'i', `${g.income >= 0 ? '+' : ''}${num(g.income, 1)}/s`);
    this.set(this.sci, 'b', num(f.science));
    this.set(this.sci, 'i', `+${num(g.sciRate, 1)}/s sci`);
    this.set(this.claim, 'b', `${f.claim}x${f.claim}`);
    this.set(this.claim, 'i', 'claim');

    const p = powerSummary(f);
    const ratio = p.demand <= 0 ? 1 : Math.min(1, p.supply / p.demand);
    const pct = Math.round(ratio * 100);
    if (this.last.pwr !== pct) {
      this.last.pwr = pct;
      this.pwrFill.style.width = pct + '%';
      this.pwrFill.style.background = ratio >= 0.95 ? '#a7f070' : ratio >= 0.7 ? '#ffcd75' : '#ff5d4a';
    }
    // Short, because the alert box on the left is already saying the long version
    // of whichever of these matters most, and because this line has to survive
    // being squeezed on a narrow window.
    const ptxt = p.nets === 0
      ? 'NO POWER'
      : `${Math.round(p.demand)} / ${Math.round(p.supply)} kW`
        + (p.unpowered ? ` · ${p.unpowered} off` : '')
        + (p.dry ? ` · ${p.dry} dry` : '');
    if (this.last.ptxt !== ptxt) { this.last.ptxt = ptxt; this.pwrText.textContent = ptxt; }

    // On a narrow window the word is the first thing to go: the button is beside
    // the claim size and its own icon-free shape is unmistakable.
    const tight = window.matchMedia('(max-width: 1140px)').matches;
    const cost = f.claim < WORLD ? expandCost(f.claim) : 0;
    const etxt = cost ? (tight ? money(cost) : `EXPAND ${money(cost)}`)
      : (tight ? 'MAX' : 'WHOLE WORLD');
    if (this.last.exp !== etxt) { this.last.exp = etxt; this.expand.textContent = etxt; }
    this.expand.disabled = !cost || f.cash < cost;
    this.expand.classList.toggle('can', !!cost && f.cash >= cost);

    this.alertFor(g, p);
    this.paintToasts(g);
  }

  /**
   * One line, top left, saying the most important thing that is wrong.
   *
   * There is exactly one of these on purpose. A factory this size always has
   * something slightly wrong with it, and a wall of warnings is a wall nobody
   * reads. So they are ranked — nothing reaches a depot, then no power at all,
   * then a brownout, then generators run dry, then jams — and only the top one is
   * ever shown.
   */
  alertFor(g, p) {
    // The walkthrough occupies this corner and is already saying a fuller version
    // of whatever the alert would have said, so the alert waits its turn.
    if (this.teaching) {
      if (this.last.alert !== '__tut') { this.last.alert = '__tut'; this.alert.hidden = true; }
      return;
    }
    const f = g.f;
    const d = health(f);
    let head = null, body = null, target = -1;
    const first = pred => f.cells.find(i => f.grid[i] && pred(f.grid[i])) ?? -1;
    const miteCell = inside => {
      for (const mt of f.mites || []) {
        const x = Math.floor(mt.x), y = Math.floor(mt.y);
        const own = x >= claimMin(f.claim) && x <= claimMax(f.claim) && y >= claimMin(f.claim) && y <= claimMax(f.claim);
        if (!inside || own) return cellOf(Math.max(0, Math.min(WORLD - 1, x)), Math.max(0, Math.min(WORLD - 1, y)));
      }
      return -1;
    };

    if (!d.depots) {
      head = 'NO DEPOT'; body = 'Nothing on this map buys anything. Build a Market Depot and aim a belt into it.';
    } else if (!d.exts) {
      head = 'NO EXTRACTOR'; body = 'Nothing is coming out of the ground. Put an Extractor on an ore patch.';
    } else if (!reachOk(f)) {
      head = 'NOTHING REACHES A DEPOT';
      target = first(m => m.kind === 'ext');
      body = 'Follow the belts from an Extractor — somewhere they point at your fence, at rock, or at each other.';
    } else if (d.jams.length) {
      const j = d.jams[0];
      target = j.cell;
      head = d.jams.length > 1 ? `${d.jams.length} LINES STOPPED FOR GOOD` : 'LINE STOPPED FOR GOOD';
      body = `A belt is trying to push ${j.why}. That will never clear on its own — `
        + 'move the machine, or put a Sorter in front of it to send that type elsewhere.';
    } else if (f.beacon && !f.beacon.done && (f.mites || []).some(mt => mt.beacon && mt.st === 'chew')) {
      head = 'THE BEACON IS UNDER ATTACK';
      body = `It is losing a delivered gizmo for every ${beaconLoss(f.done)} points of damage. Get Zappers round it, `
        + 'and keep the Ammo coming.';
      target = cellOf(f.beacon.x0 + 2, f.beacon.y0 + 2);
    } else if (f.beacon && !f.beacon.done && f.beacon.hp <= 0) {
      head = 'THE BEACON IS DOWN';
      body = `It takes nothing until it is repaired — ${money(beaconRepairCost(f))}. Click it, or open ORDERS.`;
      target = cellOf(f.beacon.x0 + 2, f.beacon.y0 + 2);
    } else if (mitesInside(f) > 0) {
      const n = mitesInside(f);
      target = miteCell(true);
      head = n > 1 ? `${n} BUGS IN THE FACTORY` : 'A BUG IN THE FACTORY';
      body = (f.cells.some(i => f.grid[i]?.kind === 'zap')
        ? 'Check your Zappers have Ammo and power, and that they reach the line being eaten.'
        : unlockedBy(f.done).has('zap')
          ? 'They are chewing your machines. Build a Zapper (Z) near them and belt Ammo into it from an Armory (B).'
          : 'They are chewing your machines. Research Pest Control in TECH to unlock the Zapper and the Armory.');
    } else if (d.broken) {
      const all = damaged(f);
      target = first(m => broken(m));
      head = `${d.broken} MACHINE${d.broken > 1 ? 'S' : ''} BROKEN`;
      body = `Chewed through, and doing nothing until repaired. Click one and press H, or `
        + `Shift H repairs everything for ${money(all.cost)}.`;
    } else if (!d.gens) {
      head = 'UNPOWERED';
      body = `Every machine is running at ${Math.round(UNPOWERED * 100)}%. ` + (unlockedBy(f.done).has('gen')
        ? 'Build a Generator touching your line and feed it ore.'
        : 'Feed a Research Lab, then research Generators in the TECH tab (Y).');
    } else if (d.dryGens) {
      head = 'OUT OF FUEL';
      target = first(m => m.kind === 'gen' && m.fuel <= 0 && !m.buf.length);
      body = `${d.dryGens} generator${d.dryGens > 1 ? 's have' : ' has'} nothing to burn. Route ore into ${d.dryGens > 1 ? 'them' : 'it'}.`;
    } else if (d.worst < 0.9) {
      head = 'BROWNOUT';
      target = first(m => m.kind === 'gen' && m.net >= 0 && f.nets[m.net]?.sat < 0.9);
      body = `A grid is at ${Math.round(d.worst * 100)}% and running at ${Math.round(powerMult(d.worst) * 100)}% speed. Add a generator anywhere on it.`;
    } else if (d.unpowered > 2) {
      head = `${d.unpowered} MACHINES OFF GRID`;
      target = first(m => m.net < 0 && drawOf(m) > 0 && !m.off && !PLUMBING.has(m.kind));
      body = 'Power only travels through touching machines. One conveyor across the gap will do it.';
    } else if (d.waiting) {
      // Named before the jams *behind* it are counted: a machine short of an
      // ingredient is the cause, and the six backed up behind it are the symptom.
      const what = d.waitingFor != null ? TYPES[d.waitingFor].name.toUpperCase() : 'AN INGREDIENT';
      target = d.waitingAt;
      head = d.waiting > 1 ? `${d.waiting} MACHINES WAITING — ONE WANTS ${what}` : `WAITING FOR ${what}`;
      body = `Something has half of what it needs and none of the other half. It is `
        + `showing the colour on the map; click it to see which queue is empty. A two-input `
        + `machine takes both halves off one belt happily — what it cannot do is invent the half you are not sending.`;
    } else if ((f.mites?.length || 0) > 0) {
      const sk = f.mites.filter(m => m.kind === 'skitter').length;
      head = `${f.mites.length} BUG${f.mites.length > 1 ? 'S' : ''} ON THE WAY` + (sk ? ` · ${sk} SKITTER${sk > 1 ? 'S' : ''}` : '');
      target = miteCell(false);
      body = 'A swarm is crossing the wilds toward your fence. Zappers with Ammo stop them; '
        + 'whatever gets through will chew your belts first.';
    }
    /*
     * There is deliberately no "N machines backed up" line here any more. A factory
     * running at capacity always has machines holding finished goods — that is what
     * running at capacity is — so the count was almost never zero and almost never
     * actionable, and a corner that is always shouting is a corner nobody reads.
     * The amber brackets on the machines themselves still say which ones, for
     * whoever is looking at that part of the map.
     */

    // The alert remembers where its problem is, so clicking it can take you there.
    // Rounded to a ring of slots so a swarm walking along does not rebuild it.
    this.target = target;
    const key = head + '|' + body + '|' + (target >= 0 ? 1 : 0);
    if (this.last.alert === key) return;
    this.last.alert = key;
    if (!head) { this.alert.hidden = true; return; }
    this.alert.hidden = false;
    this.alert.classList.toggle('go', target >= 0);
    this.alert.innerHTML = '';
    this.alert.appendChild(el('b', null, head));
    this.alert.appendChild(document.createTextNode(body));
    if (target >= 0) this.alert.appendChild(el('span', 'go-hint', 'CLICK TO LOOK  ·  TAB FOR THE NEXT PROBLEM'));
  }

  paintToasts(g) {
    const key = g.toasts.map(t => t.text).join('|');
    if (this.last.toast === key) return;
    this.last.toast = key;
    this.toasts.textContent = '';
    for (const t of g.toasts) {
      const n = el('div', 'toast', t.text);
      n.style.color = t.color;
      this.toasts.appendChild(n);
    }
  }
}

/**
 * `reachesPayout` walks every belt on the map, so it is asked twice a second
 * rather than sixty times, and the answer is held in between.
 */
let reachCache = { rev: -1, ok: true };
function reachOk(f) {
  const rev = Math.floor(f.t * 2);
  if (reachCache.rev === rev) return reachCache.ok;
  reachCache = { rev, ok: reachesPayout(f) };
  return reachCache.ok;
}

/**
 * The state of the factory's health, asked four times a second rather than sixty.
 *
 * `diagnose` visits every machine on the map twice — once for the stall counts and
 * once inside `jams` — and the HUD, the panel and the renderer all want the answer
 * every frame. On three thousand slots that is the difference between a diagnosis
 * and a frame budget, and none of it changes meaningfully in a sixtieth of a
 * second.
 */
let diagCache = { rev: -1, f: null, d: null };
export function health(f) {
  const rev = Math.floor(f.t * 4);
  if (diagCache.rev === rev && diagCache.f === f) return diagCache.d;
  diagCache = { rev, f, d: diagnose(f) };
  return diagCache.d;
}

/**
 * Every slot on the map worth going to look at, worst first: lines stopped for
 * good, broken machines, mites inside the fence, dry generators, machines waiting
 * on half a recipe, starved and backed-up machines, and anything off the grid.
 * Tab walks through it.
 */
export function problems(f) {
  const out = [];
  const seen = new Set();
  const add = i => { if (i >= 0 && !seen.has(i)) { seen.add(i); out.push(i); } };
  for (const j of health(f).jams) add(j.cell);
  for (const i of f.cells) if (f.grid[i] && broken(f.grid[i])) add(i);
  for (const mt of f.mites || []) {
    const x = Math.floor(mt.x), y = Math.floor(mt.y);
    if (x >= claimMin(f.claim) && x <= claimMax(f.claim) && y >= claimMin(f.claim) && y <= claimMax(f.claim)) add(cellOf(x, y));
  }
  for (const i of f.cells) { const m = f.grid[i]; if (m?.kind === 'gen' && !m.off && m.fuel <= 0 && !m.buf.length) add(i); }
  for (const i of f.cells) { const m = f.grid[i]; if (m && !m.off && m.waitT > STALL_BADGE && m.buf.length && !PASSIVE.has(m.kind)) add(i); }
  for (const i of f.cells) {
    const m = f.grid[i];
    if (m && !m.off && m.waitT > STALL_BADGE && !m.buf.length && !PASSIVE.has(m.kind) && !PLUMBING.has(m.kind) && intake(m) > 0) add(i);
  }
  for (const i of f.cells) { const m = f.grid[i]; if (m && !m.off && m.blockT > STALL_BADGE && !PLUMBING.has(m.kind)) add(i); }
  for (const i of f.cells) { const m = f.grid[i]; if (m && !m.off && m.kind === 'zap' && shotsOf(m) <= 0 && !m.buf.length) add(i); }
  for (const i of f.cells) { const m = f.grid[i]; if (m && !m.off && m.net < 0 && drawOf(m) > 0 && !PLUMBING.has(m.kind)) add(i); }
  return out;
}

/* ------------------------------------------------------------------ panel --- */

/**
 * The right-hand panel. Four tabs, and the first of them is the one that matters:
 * INFO is whatever you last clicked on, with every number that machine knows about
 * itself and every button that does something to it.
 */
export class Panel {
  constructor(game, act) {
    this.g = game;
    this.act = act;                 // (name, payload) -> void, wired up in main.js
    this.tab = 'info';
    this.key = '';
    this.bodies = {
      info: $('tab-info'), tech: $('tab-tech'),
      orders: $('tab-orders'), stats: $('tab-stats'),
    };
    for (const b of document.querySelectorAll('.tabs button')) {
      b.onclick = () => {
        this.show(b.dataset.tab);
        // The tech tree has its own page now; the tab opens it.
        if (b.dataset.tab === 'tech') this.act('openTree');
      };
    }
  }

  show(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('.tabs button')) {
      b.classList.toggle('on', b.dataset.tab === tab);
    }
    for (const [k, node] of Object.entries(this.bodies)) node.hidden = k !== tab;
    this.key = '';
  }

  /**
   * Rebuild whichever tab is open, and only if what it says has changed. The key
   * is deliberately coarse — a machine's progress bar is not worth a DOM write —
   * so live numbers inside a card are refreshed separately by `tick`.
   */
  update(g, S) {
    const f = g.f;
    const badge = (node, n) => {
      node.hidden = !n;
      if (n) node.textContent = n;
    };
    badge($('order-badge'), g.contracts.length);
    badge($('tech-badge'), TECH.filter(t =>
      rankOf(f.done, t.id) < TECH_RANKS && techOpen(t, f.done) && f.science >= rankCost(t, f.done)).length);

    let key;
    if (this.tab === 'info') {
      const m = S.selected >= 0 ? f.grid[S.selected] : null;
      const multi = S.bp ? `bp|${S.bp.parts.length}|${S.bp.held ? 1 : 0}|${S.bpCost ?? 0}`
        : S.area?.length ? `area|${S.area.length}|${S.area.filter(i => f.grid[i]).length}|${Math.round(f.cash / 25)}`
          + `|${repairQuote(f, S.area).cost}` : '';
      key = `info|${multi}|${S.selected}|${m ? m.kind + m.dir + m.level + m.mut + m.mir + '|' + repairCost(m, f.done) : 'x'}` +
        `|${S.tool ? S.tool.kind + S.tool.mut : ''}|${Math.round(f.cash / 10)}` +
        `|${m || S.selected < 0 ? '' : looseTypes(f, S.selected).length}`
        + (S.selected >= 0 && f.terrain[S.selected] === BEACON && f.beacon
          ? `|b${Object.values(f.beacon.got).join('.')}:${Math.round(f.beacon.hp / 10)}` : '');
    } else if (this.tab === 'tech') {
      key = 'tech|' + f.done.join(',') + '|' + Math.floor(f.science / 5);
    } else if (this.tab === 'orders') {
      key = 'orders|' + (g.story ? g.story.goals.map(s => (s.done ? 'd' : '') + Math.floor(s.held)).join(',') + Math.floor(f.earned / 50) + Array.from(f.shipped).map(Math.floor).join('.') : '') + (f.beacon ? Object.values(f.beacon.got).join('.') + ':' + Math.round(f.beacon.hp / 10) + ':' + f.claim : '') + '|'
        + g.contracts.map(c => c.id + ':' + c.done).join(',') +
        '|' + Array.from(g.done).join(',');
    } else {
      key = 'stats|' + Math.floor(f.t / 2);
    }
    if (key === this.key) {
      // The buttons must not be rebuilt sixty times a second — a button that is
      // replaced under the cursor cannot be clicked, and one that is replaced while
      // hovered flickers. So what a machine is *doing* is refreshed in place, and
      // what it *is* is only rebuilt when it changes.
      if (this.tab === 'info') this.refresh(g);
      return;
    }
    this.key = key;
    this.live = null;

    const host = this.bodies[this.tab];
    host.textContent = '';
    if (this.tab === 'info') { this.info(host, g, S); this.refresh(g); }
    else if (this.tab === 'tech') this.tech(host, g);
    else if (this.tab === 'orders') this.orders(host, g);
    else this.stats(host, g);
  }

  /* ------------------------------------------------------------------ info --- */

  info(host, g, S) {
    const f = g.f;
    if (S.bp) return this.bpInfo(host, g, S);
    if (S.area?.length) return this.areaInfo(host, g, S);
    if (S.selected < 0) {
      if (S.tool) return this.toolInfo(host, g, S.tool);
      host.appendChild(el('div', 'blank',
        'Click a machine to see what it is doing.<br><br>' +
        'Pick something from the left to build it. Drag with a Conveyor held to lay a whole run at once.<br><br>' +
        '<b style="color:#8b96b8">V</b> shows the power grid. <b style="color:#8b96b8">?</b> shows every control.'));
      return;
    }
    const m = f.grid[S.selected];
    if (!m) { this.groundInfo(host, g, S.selected); return; }
    this.machineInfo(host, g, S, m);
  }

  /**
   * The Launch Beacon: how full each mouth is, how healthy it is, and the buttons
   * to repair it and to go and look at it. Shown when you click it, and at the top
   * of the ORDERS tab, because it is the one order that never expires.
   */
  beaconCard(host, g, full) {
    const f = g.f;
    const b = f.beacon;
    if (!b) return;
    const card = el('div', 'card' + (b.done ? ' done' : ' can'));
    const h = el('h4', null, b.done ? 'LAUNCH BEACON — LIT' : 'LAUNCH BEACON');
    h.appendChild(el('span', 'price', `${Math.round(beaconProgress(f) * 100)}%`));
    card.appendChild(h);
    if (b.done) {
      card.appendChild(el('p', null, 'It is done. The world is won — and it is still yours to keep building.'));
    } else {
      card.appendChild(el('p', null,
        full ? 'The end of the game. Fill all four mouths and it fires. Feeding it is loud, every '
          + 'creature on the map comes for it, and every ' + beaconLoss(f.done) + ' points of damage it takes '
          + 'knocks a delivered gizmo back out.'
          : `In the far ${['north-west', 'north-east', 'south-west', 'south-east'][(b.x0 > WORLD / 2 ? 1 : 0) + (b.y0 > WORLD / 2 ? 2 : 0)]} corner.`
            + (beaconReachable(f) ? '' : ' Your land does not reach it yet.')));
      for (const line of beaconLines(f)) {
        const row = el('div', 'pay');
        row.appendChild(el('span', 'pay-n', `${line.name} · ${DIR_NAME[line.dir][0]}`));
        const bar = el('div', 'pay-bar');
        const fill = el('i');
        fill.style.width = Math.min(100, line.got / line.need * 100) + '%';
        fill.style.background = TYPES[line.ty].color;
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el('b', null, `${line.got}/${line.need}`));
        card.appendChild(row);
      }
      const rows = el('div', 'rows');
      addRow(rows, 'Health', `${Math.ceil(b.hp)} of ${BEACON_HP}`, b.hp >= BEACON_HP ? 'good' : b.hp > BEACON_HP * 0.3 ? 'warn' : 'bad');
      const next = BEACON_ASSAULTS[b.assaults];
      addRow(rows, 'Next assault', next != null ? `at ${Math.round(next * 100)}% full` : 'none left', next != null ? 'warn' : 'good');
      addRow(rows, 'Being fed', beaconHot(f) ? 'yes — and every creature knows it' : 'no', beaconHot(f) ? 'warn' : '');
      if (full) {
        addRow(rows, 'Mouths', 'Engines north · Turbines east · Reactors south · Prisms west');
        addRow(rows, 'To feed it', 'own the land beside a mouth and point a belt straight in');
      }
      card.appendChild(rows);
      const rc = beaconRepairCost(f);
      if (rc) {
        const r = el('button', null, `REPAIR  ${money(rc)}`);
        r.style.width = '100%';
        r.disabled = f.cash < rc;
        r.onclick = () => this.act('repairBeacon');
        card.appendChild(r);
      }
    }
    const go = el('button', null, 'SHOW ME');
    go.style.cssText = 'width:100%;margin-top:6px';
    go.onclick = () => this.act('focusBeacon');
    card.appendChild(go);
    host.appendChild(card);
  }

  /** A box of machines, and everything you can do to all of them at once. */
  areaInfo(host, g, S) {
    const f = g.f;
    const cells = S.area.filter(i => f.grid[i]);
    host.appendChild(el('h3', null, `${cells.length} MACHINES SELECTED`));
    const kinds = {};
    for (const i of cells) { const n = label(f.grid[i]); kinds[n] = (kinds[n] || 0) + 1; }
    const rows = el('div', 'rows');
    for (const [n, c] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8)) addRow(rows, n, `x${c}`);
    host.appendChild(rows);

    const acts = el('div', 'acts');
    const add = (text, fn, full, off) => {
      const b = el('button', full ? 'full' : null, text);
      b.disabled = !!off;
      b.onclick = fn;
      acts.appendChild(b);
    };
    add('COPY <span class="k">Ctrl C</span>', () => this.act('areaCopy'));
    add('MOVE <span class="k">M</span>', () => this.act('areaMove'));
    const rq = repairQuote(f, cells);
    if (rq.n) add(`REPAIR ${rq.n}  ${money(rq.cost)} <span class="k">H</span>`, () => this.act('areaRepair'), true, f.cash < 1);
    const uq = upgradeQuote(f, cells);
    add(uq.n ? `UPGRADE ${uq.n}  ${money(uq.cost)} <span class="k">U</span>` : 'NOTHING TO UPGRADE',
      () => this.act('areaUpgrade'), true, !uq.n || f.cash < 1);
    const allOff = cells.every(i => f.grid[i].off);
    add(allOff ? 'SWITCH ALL ON <span class="k">O</span>' : 'SWITCH ALL OFF <span class="k">O</span>', () => this.act('areaToggle'), true);
    add(`SCRAP ALL  +${money(scrapQuote(f, cells))} <span class="k">X</span>`, () => this.act('areaScrap'), true);
    host.appendChild(acts);
    host.appendChild(el('div', 'blank',
      'Shift-drag draws a new box. A copy is a blueprint: it stays in your hand so you can '
      + 'stamp it down as many times as you can afford. <b style="color:#8b96b8">Esc</b> clears the selection.'));
  }

  /** A blueprint in your hand. */
  bpInfo(host, g, S) {
    const bp = S.bp;
    host.appendChild(el('h3', null, bp.held ? `MOVING ${bp.held.length} MACHINES` : `BLUEPRINT  ·  ${bp.parts.length} MACHINES`));
    host.appendChild(el('div', 'sub', `${bp.w} x ${bp.h}`));
    const rows = el('div', 'rows');
    if (!bp.held) addRow(rows, 'Stamping it here costs', money(S.bpCost ?? 0), g.f.cash >= (S.bpCost ?? 0) ? 'good' : 'bad');
    addRow(rows, 'Fits here', S.bpFit ?? '—');
    host.appendChild(rows);
    host.appendChild(el('div', 'blank', bp.held
      ? 'Click where it goes — it keeps every level, setting and scratch. Anything already standing '
        + 'there goes to the crate. <b style="color:#8b96b8">R</b> turns it, <b style="color:#8b96b8">Esc</b> puts everything back where it was.'
      : 'Click to stamp it down; it stays in your hand for the next one. Red slots are skipped. '
        + '<b style="color:#8b96b8">R</b> turns it, <b style="color:#8b96b8">Esc</b> lets go, '
        + '<b style="color:#8b96b8">Ctrl V</b> picks the last copy up again.'));
  }

  /** What is in your hand, before you have spent anything on it. */
  toolInfo(host, g, tool) {
    const f = g.f;
    const head = el('div');
    head.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:8px';
    head.appendChild(icon(tool, 34));
    const t = el('div');
    t.appendChild(el('h3', null, label(tool).toUpperCase()));
    t.appendChild(el('div', 'sub', tool.crate
      ? `Out of the crate — free, level ${tool.level || 1}`
      : buyCost(tool, countKind(f, tool.kind)) === 0
        ? 'FREE  ·  your first Depot is on the house'
        : money(buyCost(tool, countKind(f, tool.kind)))
          + (LADDERED[tool.kind] ? '  ·  the next one costs more' : '')));
    head.appendChild(t);
    host.appendChild(head);
    host.appendChild(el('p', 'body', describe(tool)));
    host.appendChild(this.specRows(g, tool));
    host.appendChild(el('div', 'blank',
      'Click the map to place it. Dropping it on a slot that is already taken puts '
      + 'whatever was there in the crate — nothing is destroyed, and putting it back '
      + 'costs nothing.<br><br><b style="color:#8b96b8">R</b> turns it, '
      + '<b style="color:#8b96b8">F</b> flips a branch, <b style="color:#8b96b8">Esc</b> puts it down.'));
  }

  /** A slot with nothing on it: what the ground is, and what it would cost. */
  groundInfo(host, g, i) {
    const f = g.f;
    const t = f.terrain[i], ore = f.patch[i];
    const owned = cx(i) >= claimMin(f.claim) && cx(i) <= claimMax(f.claim)
      && cy(i) >= claimMin(f.claim) && cy(i) <= claimMax(f.claim);
    if (f.terrain[i] === BEACON) { this.beaconCard(host, g, true); return; }
    const nest = nestAt(f, i);
    if (nest) {
      const spec = nestSpec(nest);
      const sk = nest.kind === 'skitter';
      host.appendChild(el('h3', null, spec.name.toUpperCase()));
      host.appendChild(el('div', 'sub', `${cx(i)}, ${cy(i)}`));
      const r = el('div', 'rows');
      addRow(r, 'Health', `${num(Math.ceil(nest.hp))} of ${num(spec.hp)}`, 'bad');
      addRow(r, 'Destroying it pays', money(spec.bounty), 'good');
      if (sk) addRow(r, 'Skitters', 'fast, eat only belts, die to one shot', 'warn');
      addRow(r, 'When shot', `${nestBrood(nest)} ${sk ? 'Skitters' : 'Mites'} every ${nestAnger(nest)} damage`, 'warn');
      host.appendChild(r);
      host.appendChild(el('p', 'body',
        'Swarms come out of here when your factory gets loud. A Zapper with nothing else '
        + 'to shoot at will chip away at a nest in its reach, but it is a siege: thousands '
        + `of shots, and every few it takes a brood comes out — ${sk ? 'Skitters go for the belts feeding the Zapper' : 'Mites go for the Zapper itself'}. Park `
        + 'two or three Zappers together, keep the Ammo coming, and it pays well. Another '
        + 'nest digs in somewhere in the wilds a few minutes later.'));
      return;
    }
    if (t === SPACE) {
      host.appendChild(el('h3', null, 'OPEN SPACE'));
      host.appendChild(el('p', 'blurb', 'The edge of the rock. Nothing can be built out here — there is nothing to build on.'));
      return;
    }
    host.appendChild(el('h3', null,
      t === MOUNTAIN ? 'MOUNTAIN' : t === VALLEY ? 'VALLEY' :
      t === BEDROCK ? 'BEDROCK' : t === RUBBLE ? 'RUBBLE' :
        ore >= 0 ? `${(ORE_NAME[ore] || 'ORE').toUpperCase()} PATCH` : 'EMPTY GROUND'));
    host.appendChild(el('div', 'sub', `${cx(i)}, ${cy(i)}${owned ? '' : '  ·  outside your claim'}`));

    const rows = el('div', 'rows');
    if (ore >= 0) {
      const rich = f.rich[i] || 1;
      const spec = { kind: 'ext', mut: ore, rich, level: 1 };
      addRow(rows, 'Yields', TYPES[ore].name);
      addRow(rows, 'Richness', `${rich.toFixed(2)}x`, rich >= 1.6 ? 'good' : rich < 0.9 ? 'warn' : '');
      addRow(rows, 'An Extractor here', `${(1 / cycleTime(spec, f.done)).toFixed(2)}/s at full power`);
    }
    if (t === BEDROCK) addRow(rows, 'Clearable', 'Never — route around it', 'bad');
    if (t === MOUNTAIN) {
      const mt = mountainAt(f, i);
      if (mt && !surveyed(f.done)) {
        addRow(rows, 'Seam', 'unknown — research Surveying to see what is in it', 'warn');
      } else if (mt) {
        const tier = TYPES[mt.ty]?.tier || 0;
        addRow(rows, 'Seam', TYPES[mt.ty].name, 'good');
        addRow(rows, 'Left in it', `${num(mt.left)} of ${num(mt.amount)}`, mt.left < mt.amount * 0.2 ? 'warn' : '');
        addRow(rows, 'A Drill digs', `one every ${(DRILL_BASE * (1 + DRILL_PER_TIER * tier)).toFixed(1)}s at full power`);
      }
      addRow(rows, 'Build on it', 'never — go round, or drill it from beside', 'bad');
      addRow(rows, 'Drilling', 'wakes Beetles, who go for your Generators', 'warn');
    }
    if (t === VALLEY) {
      addRow(rows, 'Build in it', 'never', 'bad');
      addRow(rows, 'Cross it', `a pair of Bridges, up to ${bridgeSpan(f?.done || []) - 1} slots apart`, 'good');
    }
    if (t === RUBBLE) addRow(rows, 'Clear it for', money(RUBBLE_COST));
    if (!owned) addRow(rows, 'To build here', 'buy the rings out to it');
    if (rows.children.length) host.appendChild(rows);

    // Gizmos left lying on the floor by a scrapped machine or a re-aimed belt.
    // They take up room on the slot, so being able to see and bin them matters.
    const loose = looseTypes(f, i);
    if (loose.length) {
      host.appendChild(el('div', 'sub', 'LYING ON THE GROUND'));
      const strip = el('div', 'strip');
      strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;margin-bottom:10px';
      for (const ty of loose.slice(0, 24)) {
        const sw = swatch(ty, true, 12);
        sw.title = TYPES[ty].name;
        strip.appendChild(sw);
      }
      host.appendChild(strip);
      host.appendChild(el('p', 'body',
        'Left behind by a machine that was scrapped or a belt that was turned. It takes '
        + 'up room on this slot. Sweeping it up pays nothing — it is litter, not production.'));
      const b = el('button', null, `SWEEP UP  ${loose.length}`);
      b.style.width = '100%';
      b.onclick = () => this.act('sweep', i);
      host.appendChild(b);
    }

    if (t === RUBBLE && owned) {
      const b = el('button', null, `CLEAR RUBBLE  ${money(RUBBLE_COST)}`);
      b.style.width = '100%';
      b.style.marginTop = '6px';
      b.disabled = f.cash < RUBBLE_COST;
      b.onclick = () => this.act('clear', i);
      host.appendChild(b);
    }
  }

  /** A machine on the map: what it is, how it is doing, and what you can do to it. */
  machineInfo(host, g, S, m) {
    const f = g.f;
    const k = KINDS[m.kind];
    const cell = S.selected;

    const head = el('div');
    head.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:8px';
    head.appendChild(icon(m, 34));
    const t = el('div');
    t.appendChild(el('h3', null, label(m).toUpperCase()));
    t.appendChild(el('div', 'sub',
      (broken(m) ? 'BROKEN  ·  ' : '') + (m.off ? 'SWITCHED OFF  ·  ' : '')
      + `Level ${m.level} of ${levelCap(f.done)}  ·  `
      + (ONE_MOUTH.has(m.kind) ? `mouth faces ${DIR_NAME[m.dir]}` : `facing ${DIR_NAME[m.dir]}`)
      + `  ·  ${cx(cell)}, ${cy(cell)}`));
    head.appendChild(t);
    host.appendChild(head);
    host.appendChild(el('p', 'body', describe(m)));

    // The three live blocks. Their contents are rewritten by `refresh`; the nodes
    // themselves, and everything below them, are not.
    const diagramHost = el('div');
    const insideHost = el('div');
    const rowsHost = el('div');
    host.appendChild(el('div', 'sub', 'WHAT IT DOES'));
    host.appendChild(diagramHost);
    host.appendChild(insideHost);
    host.appendChild(rowsHost);
    this.live = { cell, m, diagramHost, insideHost, rowsHost, sig: null };

    // --- what you can do to it
    const acts = el('div', 'acts');
    const add = (text, fn, full, off) => {
      const b = el('button', full ? 'full' : null, text);
      b.disabled = !!off;
      b.onclick = fn;
      acts.appendChild(b);
    };
    const rc = repairCost(m, f.done);
    if (rc) {
      add(`REPAIR ${money(rc)} <span class="k">H</span>`, () => this.act('repair', cell), true, f.cash < rc);
      const all = damaged(f);
      if (all.cells.length > 1) {
        add(`REPAIR ALL ${all.cells.length}  ${money(all.cost)} <span class="k">⇧H</span>`,
          () => this.act('repairAll'), true, f.cash < 1);
      }
    }
    if (m.kind !== 'gen' && m.kind !== 'zap') {
      add('ROTATE <span class="k">R</span>', () => this.act('rot', cell));
    }
    if (m.kind === 'bal' || m.kind === 'sort') add('FLIP <span class="k">F</span>', () => this.act('mir', cell));
    add('MOVE <span class="k">M</span>', () => this.act('pickup', cell));
    add('TO CRATE', () => this.act('stash', cell));
    add(m.off ? 'SWITCH ON <span class="k">O</span>' : 'SWITCH OFF <span class="k">O</span>',
      () => this.act('off', cell), true);
    const cap = levelCap(f.done);
    if (m.level < cap) {
      const c = upgradeCost(m, f.done);
      add(`UPGRADE ${money(c)}`, () => this.act('up', cell), false, f.cash < c);
    } else {
      add(cap < MAX_LEVEL ? `NEEDS OVERCLOCKING ${ROMAN[cap - 1]}` : 'MAX LEVEL', null, false, true);
    }
    if (CLEARABLE.has(m.kind)) {
      add('CLEAR MACHINE', () => this.act('clearBuf', cell), true);
    }
    add(`SCRAP  +${money(scrapPay(f, m))} <span class="k">X</span>`, () => this.act('scrap', cell), true);
    host.appendChild(acts);

    // --- a sorter's filter is free to change, so it gets the whole ladder
    if (m.kind === 'sort') {
      host.appendChild(el('div', 'sub', 'PULLS OUT'));
      const chips = el('div', 'chips');
      TYPES.forEach((ty, i) => {
        const c = el('button', 'chip' + (m.mut === i ? ' on' : ''));
        const sw = el('i');
        sw.style.background = ty.color;
        c.appendChild(sw);
        c.appendChild(document.createTextNode(ty.name));
        c.onclick = () => this.act('filt', { i: cell, ty: i });
        chips.appendChild(c);
      });
      host.appendChild(chips);
    }
  }

  /**
   * Rewrite the three blocks that change while you are looking at them — the
   * recipe picture, what is inside, and the numbers — and only when they differ
   * from what is already on screen.
   */
  refresh(g) {
    const L = this.live;
    if (!L) return;
    const m = g.f.grid[L.cell];
    if (!m || m !== L.m) { this.key = ''; return; }
    const sig = m.buf.map(x => x.ty).join('.') + '|' + heldTypes(m).join('.')
      + '|' + (m.blockT > STALL_BADGE ? 'b' : m.waitT > STALL_BADGE ? 'w' : '-')
      + '|' + Math.round(m.sat * 20) + '|' + Math.round(machineLoad(m) * 2)
      + '|' + (m.kind === 'gen' ? Math.round(m.fuel / 5) : 0) + '|' + (m.off | 0)
      + '|' + Math.round(m.hp || 0) + '|' + (m.charge | 0) + '|' + (m.hot | 0) + '|' + (m.kills | 0);
    if (sig === L.sig) return;
    L.sig = sig;
    L.diagramHost.textContent = '';
    L.diagramHost.appendChild(diagramFor(m));
    L.insideHost.textContent = '';
    L.insideHost.appendChild(insideOf(m));
    L.rowsHost.textContent = '';
    L.rowsHost.appendChild(this.liveRows(g, m, L.cell));
  }

  /** The numbers a machine knows about itself, refreshed as they change. */
  liveRows(g, m, cell) {
    const f = g.f;
    const rows = el('div', 'rows');
    const sp = speedOf(m, f.done);
    const cyc = cycleTime(m, f.done);

    // Health first, when there is anything to say about it.
    const hpMax = maxHp(m, f.done);
    if (m.hp != null && m.hp < hpMax - 0.01) {
      addRow(rows, 'Health', broken(m) ? `BROKEN — 0 of ${Math.round(hpMax)}`
        : `${Math.ceil(m.hp)} of ${Math.round(hpMax)}  ·  ${Math.round((0.5 + 0.5 * m.hp / hpMax) * 100)}% speed`,
        broken(m) ? 'bad' : 'warn');
      addRow(rows, 'Repair costs', money(repairCost(m, f.done)), 'warn');
      if (broken(m)) {
        addRow(rows, 'While it is broken', 'it holds what it has, takes nothing, does nothing');
        return rows;
      }
    }

    if (m.kind === 'zap') {
      const net = m.net >= 0 ? f.nets[m.net] : null;
      addRow(rows, 'Shots loaded', (m.hot ? `${m.hot} charged + ` : '') + `${m.charge | 0}`,
        shotsOf(m) > 0 ? 'good' : 'bad');
      const qHot = m.buf.filter(g => g.ty === CHARGED).length;
      addRow(rows, 'Ammo queued', `${m.buf.length} of ${capacity(m)}` + (qHot ? `  ·  ${qHot} charged` : '')
        + `  ·  ${AMMO_CHARGES} shots each`, m.buf.length ? 'good' : (shotsOf(m) > 0 ? 'warn' : 'bad'));
      addRow(rows, 'Reach', `${zapRange(m, f.done)} slots`);
      addRow(rows, 'Damage', `${+zapDamage(m, f.done).toFixed(1)} a shot, ${+(zapDamage(m, f.done) * CHARGED_MULT).toFixed(1)} charged`
        + (zapChain(f.done) ? `  ·  arcs to ${zapChain(f.done)} more` : ''));
      addRow(rows, 'Recharge', `${(zapCool(m, f.done) / Math.max(0.05, sp)).toFixed(2)}s at this power`,
        sp >= 0.95 ? 'good' : 'warn');
      addRow(rows, 'Draws', `${drawOf(m, f.done).toFixed(1)} kW while recharging`);
      addRow(rows, 'Power', m.net < 0 ? `off grid — recharges at ${Math.round(UNPOWERED * 100)}%`
        : `${Math.round(m.sat * 100)}% satisfied`, m.net < 0 ? 'bad' : m.sat >= 0.95 ? 'good' : 'warn');
      if (net) addRow(rows, 'This grid', `${Math.round(net.demand)} / ${Math.round(net.supply)} kW`);
      addRow(rows, 'Mites zapped', String(m.kills | 0), m.kills ? 'good' : '');
      addRow(rows, 'Status', m.off ? 'SWITCHED OFF'
        : m.hot > 0 ? 'armed — firing Charged Ammo'
          : (shotsOf(m) > 0 || m.buf.length) ? 'armed' : 'NO AMMO — belt some in from an Armory',
        m.off ? 'warn' : (shotsOf(m) > 0 || m.buf.length) ? 'good' : 'bad');
      return rows;
    }

    if (m.kind === 'gen') {
      const out = genOutput(m, f.done);
      const net = m.net >= 0 ? f.nets[m.net] : null;
      addRow(rows, 'Output', `${Math.round(out)} kW`, 'good');
      addRow(rows, 'Reach', `${genReach(m, f.done)} machines`);
      addRow(rows, 'Burning', m.fuel > 0 ? `${Math.round(m.fuel)} kWs left` : 'nothing', m.fuel > 0 ? '' : 'bad');
      addRow(rows, 'Fuel queued', `${m.buf.length} of ${Math.round(capacity(m) * 2)}`);
      addRow(rows, 'Delivering', `${Math.round(m.load)} kW`);
      if (net) {
        addRow(rows, 'This grid', `${Math.round(net.demand)} / ${Math.round(net.supply)} kW`,
          net.sat >= 0.95 ? 'good' : net.sat >= 0.7 ? 'warn' : 'bad');
        addRow(rows, 'Machines on it', String(net.cells.length));
      }
      return rows;
    }

    if (m.kind === 'depot' || m.kind === 'lab') {
      // Which side is open, and whether anything is actually coming in through it.
      const fed = [0, 1, 2, 3].some(d2 => {
        if (d2 !== (m.dir | 0)) return false;
        const nx = cx(cell) + DIRS[d2][0], ny = cy(cell) + DIRS[d2][1];
        const n = f.grid[cellOf(nx, ny)];
        return !!n && exitDirs(n).includes(faceHit(d2));
      });
      addRow(rows, 'Mouth', `${DIR_NAME[m.dir]} side only`, fed ? 'good' : 'warn');
      addRow(rows, 'Fed from there', fed ? 'yes' : 'nothing is', fed ? 'good' : 'warn');
      addRow(rows, 'Other three sides', 'solid — nothing gets in', '');
      addRow(rows, 'Takes', 'anything, instantly');
      addRow(rows, m.kind === 'depot' ? 'Pays' : 'Studies at', 'full market value');
      addRow(rows, 'Needs power', 'no', 'good');
      return rows;
    }

    if (m.kind === 'drill') {
      const mt = mountainAhead(f, cell);
      if (mt) {
        addRow(rows, 'Digging', `${TYPES[mt.ty].name} out of the mountain ${DIR_NAME[m.dir].toLowerCase()}`, 'good');
        addRow(rows, 'Left in it', `${num(mt.left)} of ${num(mt.amount)}`, mt.left < mt.amount * 0.2 ? 'warn' : '');
      } else {
        addRow(rows, 'Digging', `nothing — no mountain with ore ${DIR_NAME[m.dir].toLowerCase()} of it`, 'bad');
        addRow(rows, 'Fix', 'turn it (R) to face a mountain, or move it', 'bad');
      }
      addRow(rows, 'Unloads', `out of its back, ${DIR_NAME[(m.dir + 2) % 4].toLowerCase()}`);
    }
    if (m.kind === 'bridge') {
      addRow(rows, 'Paired', m.pair >= 0
        ? `${m.bin === 1 ? 'entry — sends to' : 'exit — takes from'} ${cx(m.pair)}, ${cy(m.pair)}`
        : `no — put another Bridge facing ${DIR_NAME[m.dir]} up to ${bridgeSpan(f?.done || []) - 1} slots ahead`,
        m.pair >= 0 ? 'good' : 'warn');
      if (m.pair >= 0) addRow(rows, 'Carries', 'gizmos and power across the gap');
    }
    if (m.kind === 'ext') {
      addRow(rows, 'Standing on', `${ORE_NAME[m.mut] || 'ore'}  ·  ${TYPES[m.mut]?.name}`);
      addRow(rows, 'Patch richness', `${(m.rich || 1).toFixed(2)}x`,
        m.rich >= 1.6 ? 'good' : m.rich < 0.9 ? 'warn' : '');
    }

    addRow(rows, 'Cycle', `${cyc.toFixed(2)}s`);
    addRow(rows, 'Rate now', `${(1 / cyc * sp).toFixed(2)}/s`,
      sp >= 0.95 ? 'good' : sp <= UNPOWERED + 0.01 ? 'bad' : 'warn');
    addRow(rows, 'Power', m.net < 0 ? `off grid — ${Math.round(UNPOWERED * 100)}% speed`
      : `${Math.round(m.sat * 100)}% satisfied — ${Math.round(sp * 100)}% speed`,
      m.net < 0 ? 'bad' : m.sat >= 0.95 ? 'good' : 'warn');
    addRow(rows, 'Draws', `${drawOf(m, f.done).toFixed(1)} kW while working`);
    addRow(rows, 'Holding', `${machineLoad(m).toFixed(1)} of ${capacity(m)}`,
      m.blockT > STALL_BADGE ? 'warn' : '');

    // A two-input machine keeps a queue per ingredient, and which of them is empty
    // is the whole story of why it is or is not running. So show them.
    if (m.kind === 'arm') {
      addRow(rows, 'Recipe', recipeText(ARMORY));
      for (const ty of ARMORY.ins) {
        const n = queued(m, ty);
        addRow(rows, `${TYPES[ty].name} queued`, String(n), n ? 'good' : 'warn');
      }
      addRow(rows, 'Short of one?', `after ${ARM_RESOLVE}s, 3 Scrap or 2 Copper do instead`);
    } else if (m.kind === 'asm') {
      addRow(rows, 'Recipe', recipeText(twoInput(m)));
      for (const ty of twoInput(m).ins) {
        const n = queued(m, ty);
        addRow(rows, `${TYPES[ty].name} queued`, `${n} of ${LANE}`,
          n ? (n >= LANE ? 'warn' : 'good') : 'bad');
      }
    } else if (m.kind === 'fuse') {
      const lanes = [...new Set(m.buf.map(g => g.ty))];
      if (m.work.length) {
        addRow(rows, 'Melting', `two ${TYPES[m.work[0].ty].name}`, 'good');
      } else if (!lanes.length) {
        addRow(rows, 'Queued', 'nothing yet');
      }
      for (const ty of lanes) {
        const n = queued(m, ty);
        addRow(rows, `${TYPES[ty].name} queued`,
          `${n} of ${LANE}${n === 1 ? '  ·  needs one more' : ''}`, n >= 2 ? 'good' : 'bad');
      }
    }

    // Status last, because it is the summary of everything above it.
    const stuck = health(f).jams.find(j => j.cell === cell || j.into === cell);
    if (m.off) {
      addRow(rows, 'Status', 'SWITCHED OFF', 'warn');
      addRow(rows, 'While it is off', 'it takes nothing in, does nothing and draws nothing');
    } else if (stuck) {
      addRow(rows, 'Status', 'STOPPED FOR GOOD', 'bad');
      addRow(rows, 'Because', `a belt is pushing ${stuck.why}`, 'bad');
    } else if (m.blockT > STALL_BADGE) {
      addRow(rows, 'Status', 'BACKED UP — fix the line ahead', 'warn');
    } else if (m.waitT > STALL_BADGE && m.buf.length) {
      const miss = missingFor(m).map(ty => TYPES[ty].name).join(' and ');
      addRow(rows, 'Status', `WAITING FOR ${miss.toUpperCase() || 'A PAIR'}`, 'warn');
    } else if (m.waitT > STALL_BADGE) {
      addRow(rows, 'Status', PLUMBING.has(m.kind)
        ? 'empty — nothing is reaching it'
        : 'STARVED — fix the feed behind', PLUMBING.has(m.kind) ? '' : 'bad');
    } else {
      addRow(rows, 'Status', 'running', 'good');
    }
    if (m.kind === 'bal' || m.kind === 'sort') addRow(rows, 'Branch', sideName(m));
    return rows;
  }

  /** The same numbers, for something you have not built yet. */
  specRows(g, spec) {
    const f = g.f;
    const rows = el('div', 'rows');
    const sz = sizeKind(spec.kind);
    if (sz === 'big') addRow(rows, 'Size', '2 x 2 slots');
    else if (sz === 'long') addRow(rows, 'Size', '1 x 2 — fed at the back, out the front');
    if (spec.kind === 'gen') {
      addRow(rows, 'Output', `${GEN_OUTPUT[0]} kW at level 1`);
      addRow(rows, 'Reach', `${genReach({ level: 1 }, f.done)} machines`);
      addRow(rows, 'Burns', 'anything — raw ore is cheapest');
      addRow(rows, 'One Scrap gives', `${Math.round(energyOf(0, f.done))} kWs`);
    } else if (spec.kind === 'ext') {
      addRow(rows, 'Must stand on', 'a Slag or Sap patch');
      addRow(rows, 'Base rate', `${(1 / KINDS.ext.cycle).toFixed(2)}/s at 1.00x richness`);
      addRow(rows, 'Draws', `${KINDS.ext.draw} kW`);
    } else if (spec.kind === 'depot' || spec.kind === 'lab') {
      addRow(rows, 'Needs power', 'no');
      addRow(rows, 'Throughput', 'unlimited');
    } else if (spec.kind === 'drill') {
      addRow(rows, 'Must stand', 'beside a mountain, facing it');
      addRow(rows, 'Digs', 'the mountain\'s seam — Scrap to Cobalt');
      addRow(rows, 'Cycle', `${DRILL_BASE}s for Scrap, slower for richer seams`);
      addRow(rows, 'Draws', `${KINDS.drill.draw} kW`);
      addRow(rows, 'Beware', 'drilling wakes Beetles', 'warn');
    } else if (spec.kind === 'bridge') {
      addRow(rows, 'Pairs with', `a Bridge facing the same way, up to ${bridgeSpan(f?.done || []) - 1} slots ahead`);
      addRow(rows, 'Carries', 'gizmos and power over anything');
    } else if (spec.kind === 'zap') {
      addRow(rows, 'Eats', `Ammo — ${AMMO_CHARGES} shots each`);
      addRow(rows, 'Reach', `${zapRange({ level: 1 }, f.done)} slots`);
      addRow(rows, 'Damage', `${+zapDamage({ level: 1 }, f.done).toFixed(1)} a shot`);
      addRow(rows, 'Recharge', `${+zapCool({ level: 1 }, f.done).toFixed(2)}s at full power`);
      addRow(rows, 'Draws', `${KINDS.zap.draw} kW while recharging`);
    } else if (spec.kind === 'arm') {
      addRow(rows, 'Recipe', recipeText(ARMORY));
      addRow(rows, 'Cycle', `${ARMORY.cycle.toFixed(2)}s`);
      addRow(rows, 'Draws', `${KINDS.arm.draw} kW while working`);
      addRow(rows, 'Feed', 'one mixed belt is fine — it sorts out a lopsided ratio itself');
    } else {
      addRow(rows, 'Cycle', `${cycleTime({ ...spec, level: 1, rich: 1 }, f.done).toFixed(2)}s`);
      addRow(rows, 'Draws', `${KINDS[spec.kind].draw} kW while working`);
      addRow(rows, 'Holds', `${KINDS[spec.kind].hold} gizmos`);
    }
    return rows;
  }

  /* ------------------------------------------------------------------ tech --- */

  /**
   * The tech tree. Twelve nodes, each one paid for out of production rather than
   * out of the bank — the Lab converts gizmos to science at exactly what a Depot
   * would have paid for them, so the only thing research costs is the money you
   * chose not to take.
   */
  tech(host, g) {
    const f = g.f;
    host.appendChild(el('div', 'sub',
      `${num(f.science)} science banked  ·  +${num(g.sciRate, 1)}/s`));
    if (!f.cells.some(i => f.grid[i]?.kind === 'lab')) {
      host.appendChild(el('p', 'body',
        'You have no Research Lab. Build one and point a belt into it — a gizmo studied ' +
        'is worth exactly what a depot would have paid, so research costs income, never cash.'));
    }
    // The tree itself has its own page. This tab is the way in, and a summary.
    const open = el('button', 'big tech-open', 'OPEN THE TECH TREE  <span class="k">Y</span>');
    open.onclick = () => this.act('openTree');
    host.appendChild(open);
    for (const br of BRANCHES) {
      const list = TECH.filter(t => (t.branch || 'economy') === br.id);
      if (!list.length) continue;
      const got = list.reduce((a, t) => a + rankOf(f.done, t.id), 0);
      const row = el('div', 'pay');
      row.appendChild(el('span', 'pay-n', br.name));
      const bar = el('div', 'pay-bar');
      const fill = el('i');
      fill.style.width = (got / (list.length * TECH_RANKS) * 100) + '%';
      fill.style.background = 'var(--gold)';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('b', null, `${got}/${list.length * TECH_RANKS}`));
      host.appendChild(row);
    }
    const ready = TECH.filter(t => rankOf(f.done, t.id) < TECH_RANKS && techOpen(t, f.done)
      && f.science >= rankCost(t, f.done));
    host.appendChild(el('div', 'sub', ready.length ? 'READY TO RESEARCH' : 'NOTHING AFFORDABLE YET'));
    for (const t of ready.slice(0, 8)) {
      const r = rankOf(f.done, t.id);
      const b = el('button', 'full', `${t.name} ${ROMAN[r + 1]}  ·  ${num(rankCost(t, f.done))}`);
      b.style.cssText = 'width:100%;margin-bottom:4px;text-align:left';
      b.onclick = () => this.act('research', t.id);
      host.appendChild(b);
    }
  }

  /** One research card. */
  techCard(host, f, t) {
    {
      const rank = rankOf(f.done, t.id);
      const has = rank >= TECH_RANKS;            // maxed
      const cost = rankCost(t, f.done);
      const open = techOpen(t, f.done);
      const can = open && !has && f.science >= cost;
      const card = el('div', 'card' + (has ? ' done' : can ? ' can' : open ? ' open' : ''));
      const h = el('h4', null, t.name + (rank ? ' ' + ROMAN[rank] : ''));
      h.appendChild(el('span', 'price', has ? 'MAX' : num(cost)));
      card.appendChild(h);
      // Five pips: how many ranks are done.
      const pips = el('div', 'rank-pips');
      for (let k = 1; k <= TECH_RANKS; k++) pips.appendChild(el('i', k <= rank ? 'on' : null));
      card.appendChild(pips);
      card.appendChild(el('p', null, t.blurb));
      if (rank) card.appendChild(el('p', 'rank-note', rankBlurb(t)));
      if (t.unlocks?.length) {
        const row = el('div', 'tech-unlocks');
        for (const u of t.unlocks) {
          const spec = u.startsWith('asm:') ? { kind: 'asm', mut: +u.slice(4) } : { kind: u };
          const ic = icon(spec, 20);
          ic.title = label(spec);
          row.appendChild(ic);
        }
        card.appendChild(row);
      }
      if (!has && !open) {
        card.appendChild(el('p', null,
          'Needs ' + t.needs.map(n => techById(n).name).join(', ')));
      }
      if (!has && open) {
        const pct = Math.min(1, f.science / cost);
        const meter = el('div', 'meter');
        const fill = el('span');
        fill.style.width = (pct * 100) + '%';
        meter.appendChild(fill);
        card.appendChild(meter);
        const b = el('button', null, can ? `RESEARCH ${ROMAN[rank + 1]}  ${num(cost)}` : `${num(cost - f.science)} MORE`);
        b.disabled = !can;
        b.onclick = () => this.act('research', t.id);
        card.appendChild(b);
      }
      host.appendChild(card);
    }
  }

  /* ---------------------------------------------------------------- orders --- */

  /** Story mode's ORDERS tab: the one contract this world is for. */
  storyCard(host, g) {
    const lv = g.story.level, L = STORY_LEVELS[lv];
    host.appendChild(el('h3', null, `${L.name}`));
    host.appendChild(el('div', 'sub', `WORLD ${lv + 1} OF ${STORY_LEVELS.length} · ${L.kind.toUpperCase()}`));
    host.appendChild(el('p', 'blurb', L.learn));
    L.goals.forEach((goal, k) => {
      const st = g.story.goals[k];
      const card = el('div', 'card can');
      const h = el('h4');
      if (goal.ty != null) {
        const sw = el('span');
        sw.style.cssText = `display:inline-block;width:9px;height:9px;background:${TYPES[goal.ty].color};margin-right:6px`;
        h.appendChild(sw);
      }
      h.appendChild(document.createTextNode(goalText(goal)));
      if (st.done) h.appendChild(el('span', 'price', 'DONE'));
      card.appendChild(h);
      const pr = goalProgress(g, k);
      if (pr) card.appendChild(el('p', null, pr.text));
      const meter = el('div', 'meter');
      const fill = el('span');
      fill.style.width = Math.round((pr ? pr.p : st.done ? 1 : 0) * 100) + '%';
      fill.style.background = st.done ? '#a7f070' : '#ffcd75';
      meter.appendChild(fill);
      card.appendChild(meter);
      host.appendChild(card);
    });
    host.appendChild(el('p', 'blurb', g.story.complete
      ? 'Contract fulfilled. Click the contract box on the map to move on to the next world.'
      : 'Money and science start fresh on every world; research carries over to the next.'));
  }

  /**
   * The contract board, and — underneath it, until it empties — the list of things
   * a new factory has not discovered yet.
   */
  orders(host, g) {
    const f = g.f;
    if (g.story) { this.storyCard(host, g); return; }
    this.beaconCard(host, g, false);
    if (!g.contracts.length) {
      host.appendChild(el('div', 'blank',
        'No standing orders. The board only asks for things you are already shipping, ' +
        'so get a line running into a depot and one will turn up.'));
    }
    for (const c of g.contracts) {
      const ty = TYPES[c.ty];
      const card = el('div', 'card can');
      const h = el('h4');
      const sw = el('span');
      sw.style.cssText = `display:inline-block;width:9px;height:9px;background:${ty.color};margin-right:6px`;
      h.appendChild(sw);
      h.appendChild(document.createTextNode(`${c.need} ${ty.name}`));
      h.appendChild(el('span', 'price', money(c.pay)));
      card.appendChild(h);
      card.appendChild(el('p', null,
        `${c.done} of ${c.need} delivered  ·  ${clock(c.left)} left  ·  ` +
        `${Math.round((contractPremium(f.done) - 1) * 100)}% over market`));
      const meter = el('div', 'meter');
      const fill = el('span');
      fill.style.width = Math.min(100, c.done / c.need * 100) + '%';
      fill.style.background = c.left < c.total * 0.25 ? '#ff5d4a' : '#ffcd75';
      meter.appendChild(fill);
      card.appendChild(meter);
      host.appendChild(card);
    }

    const left = MILESTONES.filter(m => !g.done.has(m.id));
    if (left.length) {
      host.appendChild(el('div', 'sub', 'STILL TO TRY'));
      const list = el('div', 'ms');
      for (const m of MILESTONES) {
        const hit = g.done.has(m.id);
        list.appendChild(el('div', hit ? 'hit' : null,
          hit ? m.name : `${m.name} — ${m.hint}`));
      }
      host.appendChild(list);
    }
  }

  /* ----------------------------------------------------------------- stats --- */

  stats(host, g) {
    const f = g.f;
    const d = health(f);
    const p = powerSummary(f);

    const rows = el('div', 'rows');
    addRow(rows, 'Running for', clock(f.t));
    addRow(rows, 'Lifetime earnings', money(f.earned), 'good');
    addRow(rows, 'Income', `${money(g.income)}/s`);
    addRow(rows, 'Spent on the factory', money(f.spent));
    addRow(rows, 'Science studied', num(f.studied));
    addRow(rows, 'Gizmos sold', num(f.sold));
    addRow(rows, 'Gizmos lost off the fence', num(f.lost), f.lost > 40 ? 'warn' : '');
    addRow(rows, 'Swept off the ground', num(f.swept));
    addRow(rows, 'World seed', String(f.seed));
    host.appendChild(rows);

    const build = el('div', 'rows');
    addRow(build, 'Machines', num(f.cells.length));
    addRow(build, 'Extractors', num(d.exts));
    addRow(build, 'Depots', num(d.depots));
    addRow(build, 'Generators', num(d.gens), d.dryGens ? 'warn' : '');
    addRow(build, 'Power grids', num(p.nets));
    addRow(build, 'Supply / demand', `${Math.round(p.supply)} / ${Math.round(p.demand)} kW`,
      p.worst >= 0.95 ? 'good' : 'warn');
    addRow(build, 'Off grid', num(d.unpowered), d.unpowered ? 'warn' : 'good');
    addRow(build, 'Backed up', num(d.blocked), d.blocked ? 'warn' : 'good');
    addRow(build, 'Starved', num(d.starved), d.starved > 6 ? 'warn' : '');
    addRow(build, 'Waiting on an ingredient', num(d.waiting), d.waiting ? 'warn' : 'good');
    addRow(build, 'Switched off', num(d.switchedOff));
    addRow(build, 'Gizmos in flight', num(f.gizmos.length));
    host.appendChild(build);

    host.appendChild(el('div', 'sub', 'MITES'));
    const bug = el('div', 'rows');
    const eta = swarmEta(f);
    addRow(bug, 'Factory noise', (f.noise || 0).toFixed(1), f.noise > 15 ? 'warn' : '');
    addRow(bug, 'Next swarm', !isFinite(eta) ? 'not while it is this quiet'
      : f.t < SWARM_GRACE ? `not before ${clock(SWARM_GRACE)}  ·  about ${clock(eta)}` : `in about ${clock(eta)}`,
      isFinite(eta) && eta < 60 ? 'warn' : '');
    addRow(bug, 'Swarms so far', num(f.waves || 0));
    const skAlive = (f.mites || []).filter(m => m.kind === 'skitter').length;
    addRow(bug, 'Mites alive', num((f.mites?.length || 0) - skAlive), f.mites?.length ? 'warn' : 'good');
    addRow(bug, 'Skitters alive', num(skAlive), skAlive ? 'warn' : 'good');
    const btAlive = (f.mites || []).filter(m => m.kind === 'beetle').length;
    addRow(bug, 'Beetles alive', num(btAlive), btAlive ? 'warn' : 'good');
    addRow(bug, 'Next Beetle', f.cells.some(i => f.grid[i]?.kind === 'drill')
      ? `${Math.round((f.tremor || 0) / tremorCost(f.done) * 100)}% of the way` : 'not while nothing is drilling');
    addRow(bug, 'Mite nests', num((f.nests || []).filter(n => n.kind !== 'skitter').length));
    addRow(bug, 'Skitter nests', num((f.nests || []).filter(n => n.kind === 'skitter').length));
    addRow(bug, 'Nest limit', `${num(f.nests?.length || 0)} of ${num(f.nestCap || 0)}`);
    if ((f.nextNest ?? -1) >= 0) addRow(bug, 'Next new nest', `in about ${clock(f.nextNest - f.t)}`, 'warn');
    addRow(bug, 'Mites zapped', num(f.zapped || 0));
    addRow(bug, 'Machines chewed through', num(f.chewed || 0), f.chewed ? 'warn' : '');
    addRow(bug, 'Broken right now', num(d.broken || 0), d.broken ? 'bad' : 'good');
    addRow(bug, 'Damaged', num(d.hurt || 0), d.hurt ? 'warn' : 'good');
    host.appendChild(bug);

    // The last ten minutes, as a picture.
    const h = g.hist;
    if (h && h.income.length > 1) {
      host.appendChild(el('div', 'sub', `INCOME, LAST ${Math.round(h.income.length * HIST_STEP / 60)} MIN`));
      host.appendChild(sparkline(h.income, '#a7f070', v => `${money(v)}/s`));
      if (h.sci.some(v => v > 0.01)) {
        host.appendChild(el('div', 'sub', 'SCIENCE'));
        host.appendChild(sparkline(h.sci, '#b8bcff', v => `${num(v, 1)}/s`));
      }
      if (h.noise.some(v => v > 0.01)) {
        host.appendChild(el('div', 'sub', 'NOISE'));
        host.appendChild(sparkline(h.noise, '#ff6f9a', v => v.toFixed(1)));
      }
    }

    // What actually pays, as bars in each gizmo's own colour.
    const pays = TYPES.map((ty, i) => ({ ty, i, v: g.rate[i] * ty.value })).filter(p => p.v > 0.01)
      .sort((a, b) => b.v - a.v);
    if (pays.length) {
      host.appendChild(el('div', 'sub', 'WHAT PAYS'));
      const tot = pays.reduce((a, p) => a + p.v, 0);
      const box = el('div', 'pays');
      for (const p of pays.slice(0, 8)) {
        const row = el('div', 'pay');
        row.appendChild(el('span', 'pay-n', p.ty.name));
        const bar = el('div', 'pay-bar');
        const fill = el('i');
        fill.style.width = (p.v / pays[0].v * 100) + '%';
        fill.style.background = p.ty.color;
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el('b', null, `${Math.round(p.v / tot * 100)}%`));
        box.appendChild(row);
      }
      host.appendChild(box);
    }

    host.appendChild(el('div', 'sub', 'SHIPPING, PER SECOND'));
    const ship = el('div', 'rows');
    let any = false;
    TYPES.forEach((ty, i) => {
      if (g.rate[i] < 0.01) return;
      any = true;
      addRow(ship, ty.name, `${g.rate[i].toFixed(2)}/s  ·  ${money(g.rate[i] * ty.value)}/s`);
    });
    if (!any) addRow(ship, 'Nothing yet', '—');
    host.appendChild(ship);
  }
}

/**
 * A small line graph of one series, filled underneath, with its latest value and
 * its peak written in the corners.
 */
function sparkline(data, color, fmt) {
  const W = 268, H = 64;
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  c.style.cssText = `width:${W}px;height:${H}px;display:block;margin:2px 0 8px;background:#0c0e18;border:2px solid #242a3f`;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const max = Math.max(1e-6, ...data);
  const x = k => 4 + k / Math.max(1, data.length - 1) * (W - 8);
  const y = v => H - 6 - v / max * (H - 22);
  ctx.beginPath();
  data.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(x(data.length - 1), H - 6); ctx.lineTo(x(0), H - 6); ctx.closePath();
  ctx.globalAlpha = 0.15; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  ctx.font = '700 10px Silkscreen, ui-monospace, monospace';
  ctx.fillStyle = '#8b96b8'; ctx.textBaseline = 'top';
  ctx.fillText(`peak ${fmt(max)}`, 6, 4);
  ctx.textAlign = 'right'; ctx.fillStyle = color;
  ctx.fillText(fmt(data[data.length - 1]), W - 6, 4);
  return c;
}

function addRow(host, k, v, cls = '') {
  const r = el('div', 'row' + (cls ? ' ' + cls : ''));
  r.appendChild(el('span', null, k));
  r.appendChild(el('b', null, v));
  host.appendChild(r);
}

/* ---------------------------------------------------------------- minimap --- */

/**
 * The whole world at one pixel a slot.
 *
 * On a 56-slot map the single hardest question is "where was that" — where the
 * rich patch was, where the arm you started and abandoned is, where the camera is
 * relative to any of it. One 112-pixel square answers all three, and clicking it
 * takes you there.
 */
export function drawMinimap(canvas, g, view) {
  const f = g.f;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, WORLD, WORLD);
  const d = img.data;
  const lo = claimMin(f.claim), hi = claimMax(f.claim);

  const put = (i, r, gg, b) => {
    const o = i * 4;
    d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
  };

  for (let y = 0; y < WORLD; y++) {
    for (let x = 0; x < WORLD; x++) {
      const i = cellOf(x, y);
      const own = x >= lo && x <= hi && y >= lo && y <= hi;
      let r = own ? 26 : 13, gg = own ? 31 : 16, b = own ? 47 : 26;

      const ore = f.patch[i];
      if (ore >= 0) {
        if (ore === 0) { r = own ? 105 : 52; gg = own ? 113 : 56; b = own ? 137 : 68; }
        else { r = own ? 47 : 24; gg = own ? 160 : 78; b = own ? 132 : 66; }
      } else if (f.terrain[i] === BEACON) {
        r = 255; gg = 205; b = 117;
      } else if (f.terrain[i] === SPACE) {
        r = 3; gg = 4; b = 10;
      } else if (f.terrain[i] === MOUNTAIN) {
        r = own ? 120 : 84; gg = own ? 104 : 72; b = own ? 88 : 60;
      } else if (f.terrain[i] === VALLEY) {
        r = 4; gg = 5; b = 10;
      } else if (f.terrain[i] !== OPEN) {
        const s = f.terrain[i] === BEDROCK ? 1 : 0;
        r = own ? (s ? 62 : 96) : (s ? 34 : 52);
        gg = own ? (s ? 72 : 88) : (s ? 40 : 48);
        b = own ? (s ? 98 : 62) : (s ? 54 : 36);
      }

      const m = f.grid[i];
      if (m) {
        if (m.kind === 'depot') { r = 167; gg = 240; b = 112; }
        else if (m.kind === 'gen') { r = m.fuel > 0 ? 255 : 120; gg = m.fuel > 0 ? 138 : 60; b = 74; }
        else if (m.kind === 'lab') { r = 184; gg = 188; b = 255; }
        else if (m.kind === 'ext') { r = 224; gg = 138; b = 60; }
        else if (m.kind === 'zap') { r = 143; gg = 108; b = 255; }
        else if (m.kind === 'drill') { r = 210; gg = 214; b = 230; }
        else if (m.kind === 'bridge') { r = 201; gg = 162; b = 106; }
        else if (broken(m)) { r = 120; gg = 20; b = 40; }
        else if (m.net < 0 && KINDS[m.kind].draw > 0) { r = 70; gg = 82; b = 128; }
        else { r = 150; gg = 168; b = 206; }
      }
      put(i, r, gg, b);
    }
  }
  // Nests, and every mite on the map, in the one colour nothing else uses.
  for (const n of f.nests || []) {
    if (n.kind === 'skitter') put(n.cell, 120, 200, 40); else put(n.cell, 200, 40, 110);
  }
  for (const mt of f.mites || []) {
    const x = Math.floor(mt.x), y = Math.floor(mt.y);
    if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) continue;
    if (mt.kind === 'skitter') put(cellOf(x, y), 190, 255, 90);
    else if (mt.kind === 'beetle') put(cellOf(x, y), 255, 170, 60);
    else put(cellOf(x, y), 255, 79, 122);
  }
  ctx.putImageData(img, 0, 0);

  // the fence, and where the camera is looking
  ctx.strokeStyle = '#5a6690';
  ctx.lineWidth = 1;
  ctx.strokeRect(lo - 0.5, lo - 0.5, hi - lo + 2, hi - lo + 2);
  if (view) {
    const b = view.bounds();
    ctx.strokeStyle = '#ffcd75';
    ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
  }
}

/* ----------------------------------------------------------------- how to --- */

/**
 * The manual, generated from machines.js when it opens, so it cannot drift from
 * the balance: change a price or a draw and this page changes with it.
 */
export function howtoHtml(f) {
  const kindRow = k => {
    const K = KINDS[k];
    const price = k === 'mut' ? `${money(MUT_MIN)}–${money(MUT_MAX)}`
      : k === 'asm' ? RECIPES.map(r => money(r.price)).join(' / ')
        : money(K.price) + (LADDERED[k] ? ' and up' : '');
    const rate = K.passive ? '—' : `${(1 / (K.cycle || 1)).toFixed(2)}/s`;
    return `<tr><td>${K.name}</td><td class="k">${K.desc}</td>` +
      `<td class="k" style="white-space:nowrap">${price}<br>${rate} · ${K.draw} kW</td></tr>`;
  };

  return `
<h3>The idea</h3>
<p>You own a <b>five-slot square</b> in the middle of an eighty-slot world, and
nothing else. All twenty-five of those slots are Slag. Put an <b>Extractor</b> on one, a
<b>Market Depot</b> a couple of slots away, and a <b>Conveyor</b> between them, and
that is a factory: ore out of the ground, along a belt, into money. Everything after
it is making that line longer, wider and worth more — and the first thing it needs
is room.</p>
<p>The first time you play, a card in the corner walks you through building exactly
that, one step at a time. It watches the factory rather than the mouse, so there is
nothing to click through and no wrong order. After that, every new world opens empty
— you can bring the walkthrough back from the menu if you want it.</p>
<p>Ore is scattered across the whole world, richer the further out you go, so a
patch out at the rim yields three times what the one under your feet does. Land is
cheap to begin with and gets steeply dearer, so the opening is a scramble outward
and the endgame is a considered one.</p>
<p><b>Slag and Sap are kept well apart.</b> There is no Sap anywhere near the
middle: the nearest is a dozen rings out. Running a Part line — and through it the
Assembler, the richest thing in the game — means a long belt haul across bought
land or an outpost at the patch with its own Generator and its own fuel. That is
the point. Two feeds meeting in one machine should be a journey, not a matter of
putting two Extractors side by side.</p>

<h3>Power</h3>
<p>Every machine draws kilowatts while it is working. A <b>Generator</b> makes
them by burning gizmos you feed it on a belt, and the power spreads outward from
it <b>through touching machines</b> — a conveyor conducts as well as an assembler
does — for a limited number of hops. So the belt that carries fuel <i>to</i> a
generator is the same wire that carries its power back <i>out</i>, and an empty
slot between two blocks of factory is a broken circuit that one conveyor will
mend.</p>
<p><b>Nothing ever switches off.</b> A machine no generator reaches still runs, at
${Math.round(UNPOWERED * 100)}% speed, forever — that is the state your very
first factory is in. What hurts is asking a grid for more than it makes: speed
falls with the <i>square</i> of how satisfied the grid is, so 70% supplied runs at
${Math.round(powerMult(0.7) * 100)}% and half supplied runs at
${Math.round(powerMult(0.5) * 100)}%. Another generator anywhere on the same grid
fixes it.</p>
<p>Raw ore is far and away the cheapest thing to burn: a Scrap gives
${Math.round(energyOf(0, f?.done || []))} kilowatt-seconds and sells for $1, while a
Prism gives ${Math.round(energyOf(7, f?.done || []))} and sells for $320. Run a
dedicated ore line to your generators and never think about it again.</p>

<h3>Feeding a machine that needs two things</h3>
<p>A Fuser and an Assembler each keep a <b>separate queue for every ingredient</b>,
${LANE} deep. That means one belt carrying both halves is a perfectly good way to
feed one — the machine takes what it needs out of the stream and the queues absorb
the ordering. A Fuser will hold queues for two different types at once, so a single
belt of Scrap and Resin feeds one Fuser and gets Copper and Cord back out.</p>
<p>A Fuser melts <b>two of the same type</b> into one of the next rung up. An
Assembler builds from one of each of its two ingredients. Click either one and the
panel draws the recipe as a row of coloured chips, with anything it has not got
drawn hollow — so the picture that says what it makes also says what it is short
of.</p>
<p>Three ways a machine can be stuck, and they want three different fixes.
<b>Backed up</b> (amber corners) means it is holding finished goods with nowhere to
put them: the problem is ahead of it. <b>Starved</b> (blue corners) means its mouth
is empty: the problem is behind it. <b>Waiting</b> shows the colour of the
ingredient it is short of, which is the answer rather than the question. None of
them appear until a machine has been stuck for over a second, because everything on
a busy line stalls for a moment on nearly every cycle and badging that told you
nothing.</p>
<p>A red ring means a line has <b>stopped for good</b> — something is being pushed
into a machine that can never accept it, like Scrap into an Engine Assembler or a
finished Product into a Fuser. That never clears on its own, so the game names it
in the corner rather than leaving you to find it.</p>

<h3>The two rules that hold the economy together</h3>
<p><b>A copy is never copied again.</b> Duplicating machines multiply originals
and merely route copies onward, so a chain of doublers adds copies in a straight
line with the slots you spend rather than doubling at every step. Copies are drawn
dim and unlit.</p>
<p><b>It takes two originals to make an original.</b> A Fuser given a copy returns
a copy. Nothing above Cobalt can be copied at all.</p>

<h3>Three families</h3>
<p><b>Alloy</b> — Scrap, Copper, Amber, Bloom, Cobalt, Void, Ember, Prism — comes
out of Slag patches and climbs with Mutators and Fusers. <b>Part</b> — Resin,
Cord, Frame — comes out of Sap patches and is worth almost nothing on its own.
<b>Product</b> — Engine, Turbine, Reactor — comes only from an Assembler marrying
one of each, and is where the money is. Fusers climb inside a family and never
across one.</p>

<h3>Long machines</h3>
<p><b>Fusers</b> and <b>Mutators</b> are one slot by two, laid along the flow: they are fed at the back slot and put out from the front
one, and turning one with <b>R</b> swings it round its back slot — so it needs room
to turn. The ghost shows the whole footprint before you build.</p>

<h3>Depots and Labs have one mouth</h3>
<p>Every other machine takes from any side. A <b>Market Depot</b> and a <b>Research
Lab</b> have a single opening, on the side the arrow points into, and are solid on
the other three.
A Depot is where a line <i>ends</i> rather than a wall four lines can be shovelled
into from every angle. More to sell means a second Depot, or a Balancer merging the
arms before they arrive.</p>
<p>The mouth aims itself at whatever is feeding it, so laying a belt at a Depot
usually just works. It only ever turns while nothing is coming in, so it can never
break a line that is running, and it stops turning itself for good the moment you
rotate one by hand with <b>R</b>. A belt pointing at a solid side visibly does not
join up, and the corner will tell you which way the mouth faces.</p>

<h3>Building over things</h3>
<p>You can set a machine down on a slot that already has one on it. Whatever was
there goes to the <b>crate</b> — a list at the bottom of the build bar of machines
you own but have not put anywhere. Nothing is destroyed, nothing is refunded at
half price, and putting a crated machine back down costs nothing, because you
already bought it. It keeps its level and its settings too.</p>
<p>Dropping the <i>same kind</i> of machine on a slot is the exception: it does not
crate anything and does not charge you. It just turns the one that is already there
to face the way you meant — which is what makes dragging a conveyor back along a
run you have already laid fix its direction rather than cost you the whole run
again. The build ghost is green on empty ground and amber when it is about to
replace something.</p>

<h3>Mites</h3>
<p>Out beyond your fence are <b>nests</b>, and there are always two near every Sap
patch. They are woken by <b>noise</b>: every Extractor digging, every Generator
burning and every heavy machine working is loud, and the louder your factory, the
more often a swarm sets out for it — and the bigger it is. Nothing comes for the
first ${Math.round(SWARM_GRACE / 60)} minutes. The STATS tab shows how loud you are and
roughly when the next swarm is due.</p>
<p>Mites walk straight at the nearest thing you have built, and they go for
<b>belts first</b>. A chewed machine runs slower the more damaged it is, and at zero
it <b>breaks</b>: it holds whatever it was carrying, takes nothing and does nothing
until you repair it. Nothing is destroyed. Repair is <b>H</b> on one machine, or
<b>Shift H</b> for everything, and costs a share of the machine's price in proportion
to the damage. Belts have ${MAX_HP.pipe} hit points; a Market Depot has ${MAX_HP.depot}.</p>
<p>The Zapper and the Armory are research: <b>Pest Control</b>, the cheapest thing in the
TECH tab, unlocks both — get a Lab running and research it before the first swarm. The
DEFENCE branch beyond it makes Zappers reach further, recharge faster, hit harder and arc,
and plates every machine against chewing.</p>
<p>The answer is the <b>Zapper</b> (<b>Z</b>). It zaps the nearest mite in reach —
${zapRange({ level: 1 }, f?.done || [])} slots at level 1 — and every <b>Ammo</b> you feed it is
${AMMO_CHARGES} shots. It draws power while it recharges between shots, so a swarm is a
spike on its grid, and a browned-out Zapper fires slowly. With nothing moving in
reach, it will chip away at a nest instead. A nest has ${num(NEST_HP)} hit points and it
fights back: every few shots a brood of mites comes out and goes for the Zapper doing the
shooting, and a Zapper always deals with mites before it goes back to the nest. The more
hurt a nest is, the harder it fights — from ${NEST_BROOD} mites every ${NEST_ANGER} damage at
full health to ${NEST_BROOD_MAX} every ${NEST_ANGER_MIN} at the end. Bring
several Zappers and plenty of Ammo — a dead nest pays ${money(NEST_BOUNTY)}.</p>
<p>A Mite has ${MITE.hp} hit points: two shots from a level 1 Zapper.</p>
<p><b>Skitters</b> are the second creature: long, green and fast, ${SKITTER.speed / MITE.speed}x a
Mite's speed with a bite ${Math.round(SKITTER.bite / MITE.bite * 10) / 10}x as hard — and they eat
<b>conveyors and nothing else</b>, running straight past every other machine to reach one. One
shot from anything kills one. From swarm ${SKITTER_FROM + 1} onward a growing share of every
swarm is Skitters, racing in from their own nests while the Mites plod in from theirs.
A <b>Skitter nest</b> has ${num(NESTS.skitter.hp)} hit points, sends out Skitter broods that go
for the belts around the Zapper attacking it, and pays ${money(NESTS.skitter.bounty)}.</p>
<p>Ammo comes from an <b>Armory</b> (<b>B</b>): one Scrap and one Copper make one Ammo.
The easy build is a Balancer on a Slag line with its branch through a Copper Mutator,
merged back onto one belt. The Armory takes either ingredient for as long as it has room,
and if it is left short of one half for a second it makes do with the other — three Scrap
or two Copper make an Ammo too — so a lopsided feed never stops it.</p>
<p><b>Charged Ammo.</b> Put two Ammo through a <b>Fuser</b> and you get one Charged Ammo:
the same ${AMMO_CHARGES} shots, each doing ${CHARGED_MULT}x the damage. The total damage is the same
as the two Ammo it came from, but every shot hits twice as hard — a level 1 Zapper kills a
Mite with one charged shot, and chews through a nest twice as fast. A Zapper fires its
charged shots first. Charged Ammo cannot be fused again.</p>
<p>Every Assembler, Fuser and Armory has a <b>CLEAR MACHINE</b> button that throws out
everything queued in it and in its hands, for when it was fed the wrong things.
Belt the Ammo to your Zappers like anything else; a Balancer will share one Armory
between two of them.</p>

<h3>Mountains, valleys and Beetles</h3>
<p>The TERRAIN branch of the TECH tab opens all of this up. <b>Surveying</b> reveals what
is in each mountain; <b>Deep Mining</b> unlocks the Mountain Drill and <b>Bridging</b> the
Bridge, and after them come faster drills, quieter drills and longer bridges.</p>
<p><b>Mountains</b> are clumps of rock you cannot build on or run a belt through.
Each one has a seam of one mineral in it — Scrap near the middle of the map, up to
Cobalt out at the rim — and a <b>Mountain Drill</b> (<b>G</b>) set beside it and facing
it digs that mineral out and pushes it out of its back. Richer seams dig slower, but
they come out of the rock already climbed: a Cobalt seam is four Mutator tiers you did
not have to build. A mountain holds a set amount; worked out, it falls in to rubble you
can clear and build on. Hover a mountain to see what is in it and how much is left.</p>
<p><b>Valleys</b> are long, thin chasms. Nothing can stand in them; cross with a pair of
<b>Bridges</b> (<b>N</b>). Two Bridges facing the same way, up to ${bridgeSpan(f?.done || []) - 1} slots
apart, pair up and carry gizmos — and power — straight over whatever is between them. A
Bridge set down on the edge of a valley faces across it, and one set down in line with
an unpaired Bridge turns to match it. A dashed rope shows which pairs with which.</p>
<p><b>Beetles</b> are the third creature. They do not live in nests: they live in the
mountains, and drilling wakes them. Every Drill at work adds to a tremor, and when it
builds up a Beetle burrows out of a mountain being drilled. It is slow, armoured —
${BEETLE.hp} hit points, ten plain shots or five charged ones from a level 1 Zapper — and it
goes for your <b>Generators</b>, and bites through one in seconds. Put a Zapper by your
drills, and another by your power.</p>

<h3>The Launch Beacon</h3>
<p>Somewhere in one of the four corners of the world stands the <b>Launch Beacon</b>, a
five-by-five tower, and it is the end of the game. It has a mouth in the middle of each
side, and each takes one thing: <b>Engines</b> from the north, <b>Turbines</b> from the
east, <b>Reactors</b> from the south and <b>Prisms</b> from the west — ${BEACON_NEED[11]},
${BEACON_NEED[12]}, ${BEACON_NEED[13]} and ${BEACON_NEED[7]} of them. A belt on the slot
just outside a mouth, pointing straight in, feeds it; anything that mouth does not take
waits on the belt. You have to own the land to build that belt, so reaching it means
buying rings all the way out to the corner.</p>
<p>Feeding it is loud, and every creature on the map takes notice. While it is being
fed, most of every swarm comes for <i>it</i>; at a quarter, a half and three quarters full
a huge assault comes from the nearest nests and the nearest mountain, all at once. And
damage costs more than health: every ${beaconLoss(f?.done || [])} points of it knocks one delivered gizmo back
out. At zero health it takes nothing until you repair it. Fill all four and it fires —
the world is won, and you can keep building in it for as long as you like.</p>

<h3>Switching things off</h3>
<p>Any machine can be switched off, with <b>O</b> or the button in its panel. An off
machine does nothing, draws no power, and turns everything away — so the line behind
it backs up and stops, which is the point. It keeps whatever is already in its
hands.</p>
<p>It is the tool for looking at half a factory while the other half holds still:
cut a branch you are rebuilding, stop an Extractor flooding a line you are
re-routing, or take a generator off a grid to find out what it was really
carrying.</p>

<h3>Litter</h3>
<p>Nothing here is ever destroyed, so when you scrap a machine or turn a belt round,
whatever was in the air lands on the floor and stays there — taking up room on that
slot and making it harder to feed. Click the slot and press <b>SWEEP UP</b>, or just
right-click it; a right-drag along a belt run takes out the belts and the litter in
one pass. Sweeping pays nothing. It is a change of mind, not production, and paying
for it would make demolishing a line a way of turning gizmos into money.</p>

<h3>Land</h3>
<p>Your claim is a centred square, and it starts three slots on a side. A ring
hands you four more slots for every slot of side you already have, so land gets
better value as you grow — and it carries a 16% markup per ring on top, so it gets
more expensive faster than that. The first ring is ${money(expandCost(CLAIM_START))};
by the rim they run to tens of thousands. Everything outside your fence is exactly
as fatal as the edge of the world —
a belt aimed at it throws what it carries away. Rubble clears for
${money(RUBBLE_COST)}; bedrock never moves.</p>

<h3>Every machine</h3>
<table>
<tr><td style="color:#8b96b8">MACHINE</td><td style="color:#8b96b8">WHAT IT DOES</td>
<td style="color:#8b96b8">COST · RATE · DRAW</td></tr>
${Object.keys(KINDS).map(kindRow).join('')}
</table>

<h3>Recipes</h3>
<table>
${RECIPES.map(r => `<tr><td>${TYPES[r.out].name}</td><td class="k">${recipeText(r)}</td>` +
  `<td class="k">${r.cycle}s · ${money(r.price)}</td></tr>`).join('')}
<tr><td>Fusing</td><td class="k">Two of the same family make one of the next rung up.
Two originals make an original.</td><td class="k">${KINDS.fuse.cycle}s</td></tr>
</table>

<h3>Controls</h3>
<table>
<tr><td>1 – 0</td><td class="k">Pick a machine up to build</td></tr>
<tr><td>Click</td><td class="k">Place it, or select what is already there</td></tr>
<tr><td>Drag the map</td><td class="k">Move around. With a Conveyor in hand a drag lays a whole run instead</td></tr>
<tr><td>R / Shift R</td><td class="k">Rotate</td></tr>
<tr><td>F</td><td class="k">Flip a Balancer or Sorter's branch to the other side</td></tr>
<tr><td>Q</td><td class="k">Pipette — copy whatever is under the cursor into your hand</td></tr>
<tr><td>M</td><td class="k">Pick a machine up and move it, for free</td></tr>
<tr><td>O</td><td class="k">Switch a machine off, or back on</td></tr>
<tr><td>Z / B</td><td class="k">Pick up a Zapper / an Armory to build</td></tr>
<tr><td>G / N</td><td class="k">Pick up a Mountain Drill / a Bridge to build</td></tr>
<tr><td>Shift drag</td><td class="k">Select every machine in a box</td></tr>
<tr><td>Ctrl C / Ctrl V</td><td class="k">Copy the selection as a blueprint / pick the last blueprint up again. Click stamps it; R turns it</td></tr>
<tr><td>M · U · O · H · X</td><td class="k">With a box selected: move it, upgrade it, switch it off, repair it, scrap it</td></tr>
<tr><td>Tab</td><td class="k">Jump to the next problem on the map · clicking the warning box does the same</td></tr>
<tr><td>Y</td><td class="k">Open the tech tree page — drag it around, click a box for what it does, + / − to zoom, 0 to fit</td></tr>
<tr><td>T</td><td class="k">Hide or show the helper boxes — warnings, key hints, pop-ups and the walkthrough. Each one can be switched separately in the menu</td></tr>
<tr><td>H / Shift H</td><td class="k">Repair the machine under the cursor / repair everything</td></tr>
<tr><td>Build on top</td><td class="k">Replaces it; the old one goes to the crate, free to put back</td></tr>
<tr><td>X / Delete</td><td class="k">Scrap a machine for half of what it cost — or, on a bare slot, sweep up whatever is lying there</td></tr>
<tr><td>Right click</td><td class="k">Put down what you are holding, or scrap what is there. Right-drag takes out a whole run, litter and all</td></tr>
<tr><td>V</td><td class="k">Show the power grid</td></tr>
<tr><td>C</td><td class="k">Buy the next ring of land</td></tr>
<tr><td>WASD / arrows</td><td class="k">Pan · middle-drag pans whatever is in your hand</td></tr>
<tr><td>+ / −</td><td class="k">Zoom, one step at a time · the two buttons by the speed controls do the same</td></tr>
<tr><td>Space</td><td class="k">Pause · [ and ] change speed</td></tr>
<tr><td>Esc</td><td class="k">Drop what you are holding, then open the menu</td></tr>
</table>`;
}

const MUT_MIN = Math.min(...MUT_PRICE.filter(Boolean));
const MUT_MAX = Math.max(...MUT_PRICE);
