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
  TYPES, KINDS, RECIPES, TECH, MILESTONES, LADDERED, WORLD, CLAIM_START,
  catalogue, buyCost, upgradeCost, scrapValue, label, describe, cycleTime, drawOf,
  levelCap, techById, techOpen, unlockedBy, expandCost, money, num, clock,
  cellOf, cx, cy, claimMin, claimMax, RUBBLE_COST, OPEN, RUBBLE, BEDROCK,
  genOutput, genReach, energyOf, capacity, recipeOf, recipeText, sideName,
  MAX_LEVEL, ORE_NAME, GEN_OUTPUT, UNPOWERED, powerMult, DIR_NAME, CONTRACT_PREMIUM,
  MUT_PRICE, EXPAND_BASE, missingFor, queued, LANE, STALL_BADGE, FAM_NAME,
  upFam, tierOf, famOf, copyable, exitDirs, intake, pickInputs, PASSIVE,
} from './machines.js';
import { bodyTile, frameCount, shade, px } from './render.js';
import {
  kindCounts, countKind, diagnose, machineLoad, speedOf, reachesPayout,
  crateStacks, crateKey, jams, heldTypes, looseTypes,
} from './sim.js';
import { powerSummary } from './power.js';

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
];

/** Which number key holds which kind. Ten slots, ten of the game's twelve machines. */
export const HOTKEYS = {
  1: { kind: 'pipe' }, 2: { kind: 'bal' }, 3: { kind: 'sort' }, 4: { kind: 'store' },
  5: { kind: 'ext' }, 6: { kind: 'gen' }, 7: { kind: 'depot' }, 8: { kind: 'lab' },
  9: { kind: 'mut' }, 0: { kind: 'fuse' },
};
const KEY_OF = {};
for (const [k, v] of Object.entries(HOTKEYS)) KEY_OF[v.kind] = k;

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
          this.addRow(g, { kind: 'mut', mut: 1 }, counts, true);
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
      for (let t = 1; t < 8; t++) {
        const c = el('button', 'chip');
        const sw = el('i');
        sw.style.background = TYPES[t].color;
        c.appendChild(sw);
        c.appendChild(document.createTextNode(TYPES[t].name));
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
      const txt = money(c);
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
        [...r.strip.children].forEach((c, i) => {
          c.classList.toggle('on', on && spec.mut === i + 1);
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
      d.appendChild(part(null, true, 'anything'));
      d.appendChild(op('\u2192'));
      d.appendChild(part(null, true, 'money'));
      return d;
    case 'lab':
      d.appendChild(part(null, true, 'anything'));
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

  update(g) {
    const f = g.f;
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
    const f = g.f;
    const d = health(f);
    let head = null, body = null;

    if (!d.depots) {
      head = 'NO DEPOT'; body = 'Nothing on this map buys anything. Build a Market Depot and aim a belt into it.';
    } else if (!d.exts) {
      head = 'NO EXTRACTOR'; body = 'Nothing is coming out of the ground. Put an Extractor on an ore patch.';
    } else if (!reachOk(f)) {
      head = 'NOTHING REACHES A DEPOT';
      body = 'Follow the belts from an Extractor — somewhere they point at your fence, at rock, or at each other.';
    } else if (d.jams.length) {
      const j = d.jams[0];
      head = d.jams.length > 1 ? `${d.jams.length} LINES STOPPED FOR GOOD` : 'LINE STOPPED FOR GOOD';
      body = `A belt is trying to push ${j.why}. That will never clear on its own — `
        + 'move the machine, or put a Sorter in front of it to send that type elsewhere.';
    } else if (!d.gens) {
      head = 'UNPOWERED';
      body = `Every machine is running at ${Math.round(UNPOWERED * 100)}%. Build a Generator touching your line and feed it ore.`;
    } else if (d.dryGens) {
      head = 'OUT OF FUEL';
      body = `${d.dryGens} generator${d.dryGens > 1 ? 's have' : ' has'} nothing to burn. Route ore into ${d.dryGens > 1 ? 'them' : 'it'}.`;
    } else if (d.worst < 0.9) {
      head = 'BROWNOUT';
      body = `A grid is at ${Math.round(d.worst * 100)}% and running at ${Math.round(powerMult(d.worst) * 100)}% speed. Add a generator anywhere on it.`;
    } else if (d.unpowered > 2) {
      head = `${d.unpowered} MACHINES OFF GRID`;
      body = 'Power only travels through touching machines. One conveyor across the gap will do it.';
    } else if (d.waiting) {
      // Named before the jams *behind* it are counted: a machine short of an
      // ingredient is the cause, and the six backed up behind it are the symptom.
      const what = d.waitingFor != null ? TYPES[d.waitingFor].name.toUpperCase() : 'AN INGREDIENT';
      head = d.waiting > 1 ? `${d.waiting} MACHINES WAITING — ONE WANTS ${what}` : `WAITING FOR ${what}`;
      body = `Something has half of what it needs and none of the other half. It is `
        + `showing the colour on the map; click it to see which queue is empty. A two-input `
        + `machine takes both halves off one belt happily — what it cannot do is invent the half you are not sending.`;
    } else if (d.blocked > 3) {
      head = `${d.blocked} MACHINES BACKED UP`;
      body = 'They are holding finished goods with nowhere to put them. The fix is ahead of them, '
        + 'not behind: more depots, a second arm, or a Storage to absorb the wobble.';
    }

    const key = head + '|' + body;
    if (this.last.alert === key) return;
    this.last.alert = key;
    if (!head) { this.alert.hidden = true; return; }
    this.alert.hidden = false;
    this.alert.innerHTML = '';
    this.alert.appendChild(el('b', null, head));
    this.alert.appendChild(document.createTextNode(body));
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
      b.onclick = () => this.show(b.dataset.tab);
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
      !f.done.includes(t.id) && techOpen(t, f.done) && f.science >= t.cost).length);

    let key;
    if (this.tab === 'info') {
      const m = S.selected >= 0 ? f.grid[S.selected] : null;
      key = `info|${S.selected}|${m ? m.kind + m.dir + m.level + m.mut + m.mir : 'x'}` +
        `|${S.tool ? S.tool.kind + S.tool.mut : ''}|${Math.round(f.cash / 10)}` +
        `|${m || S.selected < 0 ? '' : looseTypes(f, S.selected).length}`;
    } else if (this.tab === 'tech') {
      key = 'tech|' + f.done.join(',') + '|' + Math.floor(f.science / 5);
    } else if (this.tab === 'orders') {
      key = 'orders|' + g.contracts.map(c => c.id + ':' + c.done).join(',') +
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
    host.appendChild(el('h3', null,
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
      (m.off ? 'SWITCHED OFF  ·  ' : '')
      + `Level ${m.level} of ${levelCap(f.done)}  ·  facing ${DIR_NAME[m.dir]}  ·  ${cx(cell)}, ${cy(cell)}`));
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
    if (!['depot', 'lab', 'gen'].includes(m.kind)) {
      add('ROTATE <span class="k">R</span>', () => this.act('rot', cell));
    }
    if (m.kind === 'bal' || m.kind === 'sort') add('FLIP <span class="k">F</span>', () => this.act('mir', cell));
    add('MOVE <span class="k">M</span>', () => this.act('pickup', cell));
    add('TO CRATE', () => this.act('stash', cell));
    add(m.off ? 'SWITCH ON <span class="k">O</span>' : 'SWITCH OFF <span class="k">O</span>',
      () => this.act('off', cell), true);
    const cap = levelCap(f.done);
    if (m.level < cap) {
      const c = upgradeCost(m);
      add(`UPGRADE ${money(c)}`, () => this.act('up', cell), false, f.cash < c);
    } else {
      add(cap < MAX_LEVEL ? 'NEEDS OVERCLOCKING' : 'MAX LEVEL', null, false, true);
    }
    add(`SCRAP  +${money(scrapValue(m))} <span class="k">X</span>`, () => this.act('scrap', cell), true);
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
      + '|' + (m.kind === 'gen' ? Math.round(m.fuel / 5) : 0) + '|' + (m.off | 0);
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
    const sp = speedOf(m);
    const cyc = cycleTime(m, f.done);

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
      addRow(rows, 'Takes', 'anything, instantly');
      addRow(rows, m.kind === 'depot' ? 'Pays' : 'Studies at', 'full market value');
      addRow(rows, 'Needs power', 'no', 'good');
      return rows;
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
    addRow(rows, 'Draws', `${drawOf(m).toFixed(1)} kW while working`);
    addRow(rows, 'Holding', `${machineLoad(m).toFixed(1)} of ${capacity(m)}`,
      m.blockT > STALL_BADGE ? 'warn' : '');

    // A two-input machine keeps a queue per ingredient, and which of them is empty
    // is the whole story of why it is or is not running. So show them.
    if (m.kind === 'asm') {
      addRow(rows, 'Recipe', recipeText(recipeOf(m)));
      for (const ty of recipeOf(m).ins) {
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
      addRow(rows, 'Status', 'STARVED — fix the feed behind', 'bad');
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
    for (const t of TECH) {
      const has = f.done.includes(t.id);
      const open = techOpen(t, f.done);
      const can = open && !has && f.science >= t.cost;
      const card = el('div', 'card' + (has ? ' done' : can ? ' can' : open ? ' open' : ''));
      const h = el('h4', null, t.name);
      h.appendChild(el('span', 'price', has ? 'DONE' : num(t.cost)));
      card.appendChild(h);
      card.appendChild(el('p', null, t.blurb));
      if (!has && !open) {
        card.appendChild(el('p', null,
          'Needs ' + t.needs.map(n => techById(n).name).join(', ')));
      }
      if (!has && open) {
        const pct = Math.min(1, f.science / t.cost);
        const meter = el('div', 'meter');
        const fill = el('span');
        fill.style.width = (pct * 100) + '%';
        meter.appendChild(fill);
        card.appendChild(meter);
        const b = el('button', null, can ? `RESEARCH  ${num(t.cost)}` : `${num(t.cost - f.science)} MORE`);
        b.disabled = !can;
        b.onclick = () => this.act('research', t.id);
        card.appendChild(b);
      }
      host.appendChild(card);
    }
  }

  /* ---------------------------------------------------------------- orders --- */

  /**
   * The contract board, and — underneath it, until it empties — the list of things
   * a new factory has not discovered yet.
   */
  orders(host, g) {
    const f = g.f;
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
        `${Math.round((CONTRACT_PREMIUM - 1) * 100)}% over market`));
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
        else if (m.net < 0 && KINDS[m.kind].draw > 0) { r = 70; gg = 82; b = 128; }
        else { r = 150; gg = 168; b = 206; }
      }
      put(i, r, gg, b);
    }
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
<p>You own a ten-slot square in the middle of a fifty-six-slot world. Ore is
scattered across all of it, richer the further out you go. Put an
<b>Extractor</b> on a patch, belt what it pulls up to a <b>Market Depot</b>, and
that is a factory. Everything after that is making the line longer, wider and
worth more.</p>

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
<p>Your claim is a centred square. Buying a ring costs
${money(EXPAND_BASE)} the first time and about 28% more each time after,
and everything outside your fence is exactly as fatal as the edge of the world —
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
