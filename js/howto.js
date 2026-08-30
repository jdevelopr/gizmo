/**
 * howto.js — the in-game manual.
 *
 * Every number here is read from machines.js at the moment the panel opens, so
 * the manual can never drift from the balance: change a price or a cycle time and
 * this page changes with it.
 *
 * Any element with a data-howto attribute opens it.
 */

import {
  KINDS, TYPES, MUT_PRICE, MAX_LEVEL, MAX_UTIL, DIR_NAME,
  cycleTime, upgradeCost, scrapValue, outputs,
  producerCycle, producerCost, sellerMult, sellerCost, shopCost, costMult,
} from './machines.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const money = n => '$' + Math.round(n);
const r2 = n => Math.round(n * 100) / 100;

/* What a level actually buys, per machine. */
const LEVELS = {
  pipe: ['Base speed.', '30% faster.', 'Fastest belt in the game.'],
  dup: ['The original plus one copy.', 'Three out: the original and two copies.',
    'Four out: the original and three copies.'],
  split: ['Original ahead, copy to the right.', '30% faster, still two exits.',
    'A third exit opens to the left.'],
  trident: ['Original ahead, copies left and right.', '30% faster.', 'Twice the speed of level 1.'],
  mut: ['Rewrites anything it eats into its type.', '30% faster.',
    'Refuses to downgrade: anything already above its tier passes through untouched.'],
  fuse: ['Two gizmos in, one of the next tier out.', '30% faster.',
    'A matching pair jumps two tiers instead of one.'],
};

const BUILDABLE = ['pipe', 'dup', 'split', 'trident', 'fuse'];

/** Exits a machine fires into, in its own frame, facing east. */
function exitDirs(kind, level) {
  const m = { kind, dir: 0, level, mut: 1, flip: 0 };
  return [...new Set(outputs(m, [{ ty: 2, cp: 0 }]).map(o => o.dir))];
}

function diagram(kind, color) {
  const on = new Set(exitDirs(kind, MAX_LEVEL));
  const wrap = el('div', 'ht-dia');
  //          N          W  core  E          S
  const map = [null, 3, null, 2, 'c', 0, null, 1, null];
  for (const slot of map) {
    const cell = el('i');
    if (slot === 'c') { cell.className = 'core'; cell.style.setProperty('--c', color); }
    else if (slot != null && on.has(slot)) { cell.className = 'out'; cell.style.setProperty('--c', color); }
    wrap.appendChild(cell);
  }
  return wrap;
}

function table(head, rows) {
  const scroll = el('div', 'ht-scroll');
  const t = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of head) hr.appendChild(el('th', null, h));
  thead.appendChild(hr);
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((c, i) => {
      // A cell is either a plain string or { v, cls, sub } — check the type, never
      // a property, because a String has more properties than you would think.
      const rich = c !== null && typeof c === 'object';
      const cell = el(i === 0 ? 'th' : 'td', rich ? c.cls : null);
      cell.textContent = rich ? c.v : c;
      if (rich && c.sub) cell.appendChild(el('span', 'ht-sub', c.sub));
      tr.appendChild(cell);
    });
    tb.appendChild(tr);
  }
  t.append(thead, tb);
  scroll.appendChild(t);
  return scroll;
}

const section = (title, note) => {
  const s = el('section', 'ht-sec');
  s.appendChild(el('h3', null, title));
  if (note) s.appendChild(el('p', 'ht-note', note));
  return s;
};

/* ------------------------------------------------------------------ build --- */

function build() {
  const body = $('#howto-body');
  body.innerHTML = '';

  /* --- the loop ---------------------------------------------------------- */
  const loop = section('HOW A ROUND GOES');
  const ol = el('ol', 'ht-steps');
  [
    ['PLANNING', 'The floor is stopped and the seller has jumped to a new face. Move, rotate and upgrade, then tap READY. The round starts as soon as everyone is ready.'],
    ['SHIPPING', 'The producer runs and money lands. You can keep rearranging the whole time — a live floor is a fair way to play, and sometimes the only way to unclog one.'],
    ['TALLY', 'What the round earned.'],
    ['WORKSHOP', 'Three machines offered, buy one. Reroll for a fee. What you buy gets placed in the next planning phase.'],
  ].forEach(([k, t]) => {
    const li = el('li');
    li.appendChild(el('b', null, k));
    li.appendChild(document.createTextNode(' ' + t));
    ol.appendChild(li);
  });
  loop.appendChild(ol);
  loop.appendChild(el('p', 'ht-note',
    'The Producer drops a raw Scrap gizmo into the top-left slot. The Seller pays for '
    + 'anything pushed out of the floor at its face — anything pushed off any other edge '
    + 'is lost. Most earned at the end wins, and money you spend still counts, so buying '
    + 'is never a penalty. The nine slots are.'));
  body.appendChild(loop);

  /* --- the two rules ----------------------------------------------------- */
  const rules = section('THE TWO RULES');
  [
    ['A copy is never copied', 'Duplicating machines multiply originals. A copy that reaches one is routed onward instead — a Splitter or Trident sends copies out one at a time, taking each exit in turn.'],
    ['Two originals make an original', 'A Fuser handed a copy returns a copy. Copies sell for full price; they just cannot become copyable stock again. On the floor they are drawn dimmer and unlit.'],
  ].forEach(([h, p]) => {
    const card = el('div', 'ht-rule');
    card.appendChild(el('h4', null, h));
    card.appendChild(el('p', null, p));
    rules.appendChild(card);
  });
  body.appendChild(rules);

  /* --- machines ---------------------------------------------------------- */
  const mach = section('MACHINES',
    'Rate is how many gizmos a machine takes in per second — the ceiling on everything '
    + 'downstream of it. Upgrades and scrap refunds are worked out from the base price, so '
    + 'unlike shop prices they never inflate as the match goes on.');
  const grid = el('div', 'ht-grid');

  for (const kind of BUILDABLE) {
    const k = KINDS[kind];
    const card = el('article', 'ht-card');
    card.style.setProperty('--id', k.trim);
    card.style.setProperty('--lit', k.lit);

    const head = el('div', 'ht-head');
    head.appendChild(diagram(kind, k.lit));
    const titles = el('div');
    titles.appendChild(el('h4', null, k.name));
    const price = el('p', 'ht-price', money(k.price));
    price.appendChild(el('span', 'ht-dim', ' base · holds ' + k.cap));
    titles.appendChild(price);
    head.appendChild(titles);
    card.appendChild(head);
    card.appendChild(el('p', 'ht-desc', k.desc));

    const rows = [];
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const m = { kind, level: l, mut: 1, dir: 0, flip: 0 };
      const cyc = cycleTime(m);
      rows.push([
        'L' + l,
        String(outputs(m, [{ ty: 2, cp: 0 }]).length),
        r2(cyc) + 's',
        r2(1 / cyc) + '/s',
        { v: l < MAX_LEVEL ? money(upgradeCost(m)) : 'max', cls: l < MAX_LEVEL ? 'ht-buy' : 'ht-dim' },
        { v: '+' + money(scrapValue(m)), cls: 'ht-sell' },
      ]);
    }
    card.appendChild(table(['Lv', 'Out', 'Cycle', 'Rate', 'Upgrade', 'Scrap'], rows));

    const ul = el('ul', 'ht-levels');
    LEVELS[kind].forEach((t, i) => {
      const li = el('li');
      li.appendChild(el('b', null, 'L' + (i + 1)));
      li.appendChild(document.createTextNode(' ' + t));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    grid.appendChild(card);
  }
  mach.appendChild(grid);
  body.appendChild(mach);

  /* --- mutators ---------------------------------------------------------- */
  const muts = section('MUTATORS',
    'Priced and paced by the tier they print: speed halves as value doubles, so every '
    + 'mutator earns about the same per slot. The tier is a choice about what you feed the '
    + 'doublers and fusers downstream, not a straight upgrade.');
  const mrows = [];
  for (let t = 1; t <= 6; t++) {
    const cells = [TYPES[t].name, { v: money(MUT_PRICE[t]), cls: 'ht-buy' }, money(TYPES[t].value)];
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const cyc = cycleTime({ kind: 'mut', mut: t, level: l });
      cells.push({ v: r2(cyc) + 's', sub: money(TYPES[t].value / cyc) + '/s' });
    }
    cells.push({
      v: money(upgradeCost({ kind: 'mut', mut: t, level: 1 })),
      sub: 'then ' + money(upgradeCost({ kind: 'mut', mut: t, level: 2 })),
      cls: 'ht-buy',
    });
    mrows.push(cells);
  }
  muts.appendChild(table(['Mutator', 'Base', 'Gizmo', 'L1', 'L2', 'L3', 'Upgrades'], mrows));
  muts.appendChild(el('p', 'ht-note',
    'The workshop offers mutators up to Copper in round 1, Amber by round 2, Bloom by '
    + 'round 4 and Cobalt from round 6. Higher tiers are reached by fusing, not buying.'));
  body.appendChild(muts);

  /* --- fixtures ---------------------------------------------------------- */
  const fix = section('PRODUCER AND SELLER', 'Neither can be moved or sold. Both go to level ' + MAX_UTIL + '.');
  const pair = el('div', 'ht-pair');

  const prod = el('div', 'ht-panel');
  prod.appendChild(el('h4', null, 'PRODUCER'));
  prod.appendChild(el('p', 'ht-note', 'Drops one Scrap into the top-left slot.'));
  prod.appendChild(table(['Lv', 'Cycle', 'Rate', 'Upgrade'],
    Array.from({ length: MAX_UTIL }, (_, i) => {
      const l = i + 1, c = producerCycle(l);
      return ['L' + l, r2(c) + 's', r2(1 / c) + '/s',
        { v: l < MAX_UTIL ? money(producerCost(l)) : 'max', cls: l < MAX_UTIL ? 'ht-buy' : 'ht-dim' }];
    })));

  const sell = el('div', 'ht-panel');
  sell.appendChild(el('h4', null, 'SELLER'));
  sell.appendChild(el('p', 'ht-note', 'Pays for anything pushed out of its face. Moves every round.'));
  sell.appendChild(table(['Lv', 'Pays', 'Upgrade'],
    Array.from({ length: MAX_UTIL }, (_, i) => {
      const l = i + 1;
      return ['L' + l, 'x' + sellerMult(l).toFixed(1),
        { v: l < MAX_UTIL ? money(sellerCost(l)) : 'max', cls: l < MAX_UTIL ? 'ht-buy' : 'ht-dim' }];
    })));

  pair.append(prod, sell);
  fix.appendChild(pair);
  body.appendChild(fix);

  /* --- shop -------------------------------------------------------------- */
  const shop = section('WHAT THE SHOP CHARGES',
    'Workshop prices drift up by half the base price each round. Conveyors are the '
    + 'exception: base price, any phase, as many as you can pay for, and they never count '
    + 'against the one machine a round.');
  shop.appendChild(table(['Round', 'Markup', 'Conveyor', 'Doubler', 'Fuser', 'Cobalt Mut'],
    [1, 2, 3, 4, 5, 6, 7, 8].map(r => ['R' + r, 'x' + r2(costMult(r)),
      { v: money(shopCost({ kind: 'pipe' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'dup' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'fuse' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'mut', mut: 4 }, r)), cls: 'ht-buy' }])));
  body.appendChild(shop);

  /* --- ladder ------------------------------------------------------------ */
  const lad = section('GIZMO LADDER',
    'What the seller pays per gizmo, before its own multiplier. Each tier is worth a '
    + 'little more than two of the tier below, which is what makes fusing pay.');
  const ul = el('ul', 'ht-ladder');
  TYPES.forEach(t => {
    const li = el('li');
    li.style.setProperty('--c', t.color);
    li.appendChild(el('span', 'ht-chip'));
    li.appendChild(el('b', null, t.name));
    li.appendChild(el('span', 'ht-val', money(t.value)));
    ul.appendChild(li);
  });
  lad.appendChild(ul);
  body.appendChild(lad);

  void DIR_NAME;
}

/* ------------------------------------------------------------------- open --- */

let built = false;

export function openHowTo() {
  if (!built) { build(); built = true; }
  const box = $('#howto');
  if (!box) return;
  box.hidden = false;
  box.scrollTop = 0;
  const close = $('#howto-close');
  if (close) close.focus();
}

export function closeHowTo() {
  const box = $('#howto');
  if (box) box.hidden = true;
}

/** Rebuild on the next open — call after anything that changes the balance. */
export function invalidateHowTo() { built = false; }

for (const b of document.querySelectorAll('[data-howto]')) {
  b.addEventListener('click', e => { e.preventDefault(); openHowTo(); });
}
const closeBtn = $('#howto-close');
if (closeBtn) closeBtn.addEventListener('click', e => { e.preventDefault(); closeHowTo(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#howto')?.hidden) closeHowTo();
});
