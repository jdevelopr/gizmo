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
  cycleTime, upgradeCost, scrapValue, outputs, capacity, EMPTY_HOLD,
  moverCost, moverFree, SCRAP_RATE, UP_STEP, UTIL_STEP, SHOP_STEP,
  producerCycle, producerCost, sellerMult, sellerCost, shopCost, costMult,
  GRID, CLAIM_START, SECOND_VAULT_CLAIM, expandCost,
  ORDER_GROWTH, ORDER_FLOOR_GROWTH, ORDER_BONUS,
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
  store: ['Room for six gizmos, or a dozen Scrap.', 'Room for ten.',
    'Room for fourteen — a whole round\u2019s surge, parked.'],
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

const BUILDABLE = ['pipe', 'store', 'dup', 'split', 'trident', 'fuse'];

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
    ['PLANNING', 'The floor is stopped and everything you built is exactly where you left it. Extend the line, upgrade it, and claim land if you can afford it — land is bought here and nowhere else, because the vault rides out to the new fence and moving it mid-round would sell gizmos into a wall. A conveyor aims itself whenever it lands on a slot, so laying a route is a row of taps. ROTATE always overrides it. The round starts as soon as everyone is ready.'],
    ['SHIPPING', 'The producer runs and money lands. You can keep building the whole time — a live floor is a fair way to play, and sometimes the only way to unclog one.'],
    ['TALLY', 'What the round earned, and whether it filled the order.'],
    ['WORKSHOP', 'Three machines offered, buy one. Reroll for a fee. What you buy gets placed in the next planning phase.'],
  ].forEach(([k, t]) => {
    const li = el('li');
    li.appendChild(el('b', null, k));
    li.appendChild(document.createTextNode(' ' + t));
    ol.appendChild(li);
  });
  loop.appendChild(ol);
  loop.appendChild(el('p', 'ht-custody',
    'A machine takes custody of what it eats. It pulls the gizmo in, holds it for its '
    + 'whole cycle — you can see it sitting in the machine\u2019s window, and halfway '
    + 'through it becomes whatever the machine is making — and only then pushes the '
    + 'result out.'));
  loop.appendChild(el('p', 'ht-custody',
    'Every machine has room for only so much, counting what is in its hands and what '
    + 'is queued at its mouth. A machine with no room turns arrivals away, so the one '
    + 'feeding it has to keep holding what it made — its bar sits full and turns amber. '
    + 'That stall walks back up the line, and when it reaches the Producer, the Producer '
    + `stops. Nothing is ever destroyed on the floor: a bare slot holds ${EMPTY_HOLD} and then backs `
    + 'up too. Only a gizmo pushed off an edge that is not a vault is truly lost. '
    + 'Raw Scrap is loose stuff and packs two to the space of one finished gizmo, so the '
    + 'squeeze always starts after the first machine that makes something. A Conveyor has '
    + 'room for one. Storage has room for six, and its levels buy more.'));
  loop.appendChild(el('p', 'ht-note',
    'The Producer drops a raw Scrap gizmo into the top-left slot. A vault pays for '
    + 'anything pushed out at its face — anything pushed off any other edge, or into land '
    + 'you have not bought, is lost. Both vaults share one SELLER upgrade. Most earned at '
    + 'the end wins, and money you spend still counts, so buying is never a penalty.'));
  body.appendChild(loop);

  /* --- the plot ---------------------------------------------------------- */
  const plot = section('YOUR PLOT',
    `You start owning a ${CLAIM_START} x ${CLAIM_START} corner of a ${GRID} x ${GRID} plot. `
    + 'Everything beyond your fence is dirt: you cannot build on it, and anything fired into '
    + 'it is gone as surely as if it had gone off the edge of the world.');
  plot.appendChild(el('p', 'ht-custody',
    'Claiming land grows the fence by one on both sides at once, and the vault is welded to '
    + 'the east face — so it rides outward with the fence and your line needs one more belt '
    + 'to reach it. Nothing else moves. Every machine keeps its slot, its facing and its '
    + `level, and the line you built in round one is still the line you are running in round `
    + `eight. At ${SECOND_VAULT_CLAIM} x ${SECOND_VAULT_CLAIM} a second vault opens on the far corner of the same face, `
    + 'and that is the point at which running two arms starts to pay for the slots.'));
  plot.appendChild(table(['Plot', 'Slots', 'Cost to claim', 'Vaults', 'Cheap belts / round'],
    Array.from({ length: GRID - CLAIM_START + 1 }, (_, i) => {
      const n = CLAIM_START + i;
      return [`${n} x ${n}`, String(n * n),
        { v: n < GRID ? money(expandCost(n)) : 'the fence', cls: n < GRID ? 'ht-buy' : 'ht-dim' },
        String(n >= SECOND_VAULT_CLAIM ? 2 : 1),
        String(moverFree(n))];
    })));
  body.appendChild(plot);

  /* --- the order board --------------------------------------------------- */
  const ord = section('THE ORDER BOARD',
    'Every round posts one order. Filling it pays a bonus; missing it costs nothing but '
    + 'the bonus, so a bad round can never bury you.');
  ord.appendChild(el('p', 'ht-custody',
    `The target is not a fixed number — it is ${Math.round(ORDER_GROWTH * 100 - 100)}% more than your own best round so far. `
    + 'That means it asks a first-timer and a veteran the same question in their own terms: '
    + 'is your factory shipping more than it ever has? Even a flat round raises the bar by '
    + `${Math.round(ORDER_FLOOR_GROWTH * 100 - 100)}%, so standing still stops paying. The bonus is ${Math.round(ORDER_BONUS * 100)}% of the target, which means a '
    + 'bigger factory is chasing a bigger prize.'));
  body.appendChild(ord);

  /* --- reading a floor --------------------------------------------------- */
  const read = section('READING A FLOOR',
    'A factory has exactly two failure modes, they look nothing alike, and they want '
    + 'opposite fixes. Telling them apart at a glance is most of learning to balance one.');
  [
    ['BACKED UP', 'Amber all round the casing and a full charge bar. This machine has '
      + 'finished something and has nowhere to put it, so it is holding on — which means '
      + 'everything feeding it will stall next, all the way back to the Producer. The fix '
      + 'is downstream: widen the line ahead of it, add Storage to absorb the surge, or '
      + 'send the overflow to a second vault.'],
    ['STARVED', 'Four cool blue ticks in the corners and an empty bar. This machine is '
      + 'standing idle waiting to be fed, so every second it waits is capacity you paid '
      + 'for and are not using. The fix is upstream: more feed, a faster feeder, or fewer '
      + 'machines sharing the one it has.'],
  ].forEach(([h, t]) => {
    const card = el('div', 'ht-rule');
    card.appendChild(el('h4', null, h));
    card.appendChild(el('p', null, t));
    read.appendChild(card);
  });
  read.appendChild(el('p', 'ht-note',
    'Select any machine on your phone and its rate is spelled out in jobs per second, '
    + 'along with whichever of these two it is doing right now. A line runs at the speed '
    + 'of its slowest machine and no faster, so the useful question is never "is this '
    + 'machine fast" but "does it match the one either side of it".'));
  body.appendChild(read);

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
    + `downstream of it. Each level costs ${UP_STEP}x the one before, worked out from the base price, `
    + 'so unlike shop prices upgrades never inflate as the match goes on. Scrapping returns '
    + `${Math.round(SCRAP_RATE * 100)}% of everything you paid for a machine, levels included — enough to rework a floor, `
    + 'not enough to churn one.');
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
    const room = [1, 2, 3].map(l => capacity({ kind, level: l }));
    const roomText = room[0] === room[2] ? `room ${room[0]}` : `room ${room.join(' / ')}`;
    price.appendChild(el('span', 'ht-dim', ` base · takes ${k.cap} at a time · ${roomText}`));
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
  sell.appendChild(el('p', 'ht-note',
    'Pays for anything pushed out of its face. Welded to the east face of your fence, so '
    + 'it only ever moves when you claim land.'));
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
    `Everything a floor earns multiplies — machine level times producer rate times seller `
    + `take — so the prices multiply too. Each level of anything costs ${UTIL_STEP}x the last, and the `
    + `workshop marks up ${Math.round((SHOP_STEP - 1) * 100)}% every round, compounding. Buy one more thing a round, not `
    + `everything.`);
  shop.appendChild(table(['Round', 'Markup', 'Conveyor', 'Storage', 'Doubler', 'Fuser', 'Cobalt Mut'],
    [1, 2, 3, 4, 5, 6, 7, 8].map(r => ['R' + r, 'x' + r2(costMult(r)),
      { v: money(shopCost({ kind: 'pipe' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'store' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'dup' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'fuse' }, r)), cls: 'ht-buy' },
      { v: money(shopCost({ kind: 'mut', mut: 4 }, r)), cls: 'ht-buy' }])));
  shop.appendChild(el('p', 'ht-custody',
    `Conveyors are the exception, because a player who cannot reach a vault cannot score `
    + `at all. Each round, a number of belts equal to your plot's width go for base price `
    + `whatever the round it is — one row's worth, so a bigger claim gets the longer runs `
    + `it needs, and the belt that reaches a vault you just moved is always cheap. Past those, each `
    + `belt in the same round costs nearly double the last on top of the round's markup. `
    + `Sprawl is a luxury; reconnecting is a right. They still never count against the one `
    + `machine a round from the workshop.`));
  shop.appendChild(table(['Round', '1st belt', '2nd', '3rd', '4th', '5th', '6th'],
    [1, 4, 8].map(r => ['R' + r, ...[0, 1, 2, 3, 4, 5].map(n =>
      ({ v: money(moverCost(r, n, CLAIM_START)),
        cls: n < moverFree(CLAIM_START) ? 'ht-sell' : 'ht-buy' }))])));
  shop.appendChild(el('p', 'ht-note',
    `Prices above are for a ${CLAIM_START} x ${CLAIM_START} claim; a wider plot gets more of them at base price.`));
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
