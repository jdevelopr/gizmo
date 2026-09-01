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
  exitDirs as machineExits, routeCost, ROUTE_KINDS,
  moverFree, SCRAP_RATE, UP_STEP, UTIL_STEP, investedIn,
  producerCycle, producerCost, sellerMult, sellerCost, shopCost,
  GRID, CLAIM_START, SECOND_VAULT_CLAIM, expandCost,
  RECIPES, recipeText, RESIN_CLAIM, FAM_START, FAM_LEN, ALLOY, PART, PRODUCT, price,
  TECH, unlockedBy, levelCap, COPY_MAX_VALUE, SCIENCE_RATE, KIND_LIST,
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
  bal: ['One in, one out, alternating between ahead and its branch. FLIP puts that '
    + 'branch on either side without turning the through line.', '30% faster.',
    'Both sides open at once, and it takes all three exits in turn.'],
  sort: ['The type it is set to goes out to the branch; everything else goes straight '
    + 'ahead. FLIP chooses the side.', '30% faster.',
    'A second filtered exit opens on the other side, taking turns with the first.'],
  trident: ['Original ahead, copies left and right.', '30% faster.', 'Twice the speed of level 1.'],
  mut: ['Rewrites anything it eats into its type.', '30% faster.',
    'Faster again — better than twice the base rate, and the bigger of the two steps.'],
  fuse: ['Two gizmos in, one of the next tier out.', '30% faster.',
    'Faster again — better than twice the base rate, and the bigger of the two steps.'],
  asm: ['One of each ingredient in, one product out.', '30% faster.',
    'Twice the speed of level 1 — the cheapest way to double a recipe line.'],
};

const BUILDABLE = ['pipe', 'store', 'bal', 'sort', 'dup', 'trident', 'fuse', 'asm'];

/**
 * Exits a machine fires into, in its own frame, facing east. Read from the
 * machine's declared exits rather than from one call to `outputs`, because a
 * router picks one exit per job — asking it once would draw only that one.
 */
function exitDirs(kind, level) {
  return machineExits({ kind, dir: 0, level, mut: 1, flip: 0 });
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
  const loop = section('HOW A ROUND GOES',
    'You open with a belt run from the Producer to the vault and nothing else — raw '
    + 'Scrap at a dollar a piece. That is the whole game in one line, and the first '
    + 'Mutator you put in it triples what the same Producer earns you.');
  const ol = el('ol', 'ht-steps');
  [
    ['BUILD', 'The floor is stopped, which is the only thing this phase gives you that SHIPPING does not — room to rearrange without gizmos moving under your hands. Everything you built is exactly where you left it. Buy from the catalogue — everything you have unlocked, at this round\u2019s prices, as many as you can afford and fit. Spend science on research. Extend and upgrade the line, and claim land if you can afford it: land is bought here and nowhere else, because the vault rides out to the new fence and moving it mid-round would sell gizmos into a wall. A conveyor aims itself whenever it lands on a slot, so laying a route is a row of taps. ROTATE always overrides it. The round starts as soon as everyone is ready.'],
    ['SHIPPING', 'The producers run and money lands. Everything stays open: move, rotate and upgrade machines, buy from the catalogue, spend science. A live floor is a fair way to play and often the only way to unclog one — watching a line back up is the best moment there is to buy the Storage that fixes it. The one thing that waits is claiming land, because the vault rides out to the new fence and anything already in the air toward the old one would be sold into a wall.'],
    ['TALLY', 'What the round earned, and whether it filled the order.'],
  ].forEach(([k, t]) => {
    const li = el('li');
    li.appendChild(el('b', null, k));
    li.appendChild(document.createTextNode(' ' + t));
    ol.appendChild(li);
  });
  loop.appendChild(ol);
  loop.appendChild(el('p', 'ht-note',
    'Rotating a machine turns everything about it at once. A Balancer or a Sorter also '
    + 'has FLIP, which moves only its branch to the other side and leaves the line running '
    + 'straight through it exactly where it was — usually the part you had already got '
    + 'right. A freshly bought one flips itself if its branch would otherwise fire at '
    + 'unbought land.'));
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
  plot.appendChild(el('p', 'ht-custody',
    `Land is also how the factory gets its second half. At ${RESIN_CLAIM} x ${RESIN_CLAIM} a second Producer `
    + 'bolts onto the west face one row below the first and starts dropping Resin — the '
    + 'material every recipe needs and nothing else makes. Nine slots is not enough floor '
    + 'to run two feeds into an Assembler, which is why it waits for the first ring rather '
    + 'than being there from the start.'));
  plot.appendChild(table(['Plot', 'Slots', 'Cost to claim', 'Feeds', 'Vaults', 'Cheap routing / round'],
    Array.from({ length: GRID - CLAIM_START + 1 }, (_, i) => {
      const n = CLAIM_START + i;
      return [`${n} x ${n}`, String(n * n),
        { v: n < GRID ? money(expandCost(n)) : 'the fence', cls: n < GRID ? 'ht-buy' : 'ht-dim' },
        { v: n >= RESIN_CLAIM ? 'Scrap + Resin' : 'Scrap',
          cls: n >= RESIN_CLAIM ? 'ht-sell' : 'ht-dim' },
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
    + `${Math.round(ORDER_FLOOR_GROWTH * 100 - 100)}%, so standing still stops paying. The bonus is ${Math.round(ORDER_BONUS * 100)}% of the target, which means a `
    + 'bigger factory is chasing a bigger prize.'));
  body.appendChild(ord);

  /* --- research ---------------------------------------------------------- */
  const res = section('THE LAB AND RESEARCH',
    'The Lab is a port on the fence, like a vault, on the north face of the very slot '
    + 'your first vault trades from. Push a gizmo into it and you get science worth '
    + `exactly what the vault would have paid — ${SCIENCE_RATE === 1 ? 'no bonus, no penalty' : SCIENCE_RATE + 'x its value'}. `
    + 'The only thing research costs you is the money you did not take.');
  res.appendChild(el('p', 'ht-custody',
    'That adjacency is deliberate. The last slot of a line can fire east into the vault '
    + 'for cash or north into the Lab for science, so the choice between spending now and '
    + 'growing later is one rotation apart — and splitting your output between the two is '
    + 'what a Balancer is for. Research is permanent: it is the one thing you buy that a '
    + 'bad round cannot take back.'));
  res.appendChild(el('p', 'ht-note',
    `You start able to build ${[...unlockedBy([])].map(k => KINDS[k]?.name).filter(Boolean).join(', ')} `
    + `— a complete game on its own. Everything below makes it bigger. Machines cap at `
    + `level ${levelCap([])} until Overclocking raises it to ${levelCap(['overclock'])}.`));
  res.appendChild(table(['Research', 'Science', 'Needs', 'Gives'],
    TECH.map(t => [
      t.name,
      { v: String(t.cost), cls: 'ht-buy' },
      (t.needs || []).map(n => TECH.find(x => x.id === n)?.name).join(', ') || '—',
      t.blurb,
    ])));
  body.appendChild(res);

  /* --- recipes ----------------------------------------------------------- */
  const rec = section('RECIPES',
    'A Fuser eats two of anything and climbs one rung. An Assembler eats two '
    + 'specific different things and makes a third — and that is the whole difference '
    + 'between a floor that is a line and a floor that is a factory. The two '
    + 'ingredients cannot come from the same place, so two lines have to meet.');
  rec.appendChild(table(['Assembler', 'Recipe', 'Cycle', 'Output', 'Rate', 'Base'],
    RECIPES.map((r, i) => [
      TYPES[r.out].name,
      recipeText(r),
      r2(r.cycle) + 's',
      money(TYPES[r.out].value),
      { v: r2(TYPES[r.out].value / r.cycle) + '/s',
        sub: 'ingredients ' + money(TYPES[r.ins[0]].value + TYPES[r.ins[1]].value) },
      { v: money(price({ kind: 'asm', mut: i })), cls: 'ht-buy' },
    ])));
  rec.appendChild(el('p', 'ht-custody',
    'An Assembler will not take a second of an ingredient it is already holding, and '
    + 'will not take anything that is not an ingredient at all. That is deliberate: a '
    + 'machine that swallowed whatever arrived would fill both hands with Cord and wait '
    + 'forever. Instead the belt feeding it the wrong thing backs up, visibly, which is '
    + 'the same signal every other jam on the floor gives you.'));
  rec.appendChild(el('p', 'ht-note',
    'A slot running an Assembler earns roughly three times what a slot running a Mutator '
    + 'does. It also needs four or five slots behind it to keep fed, and twice the raw '
    + 'material — so recipes are what you build when the floor has outgrown the feeds, '
    + 'not what you open with.'));
  body.appendChild(rec);

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
    ['A copy is never copied', 'Duplicating machines multiply originals. A copy that reaches one is routed onward instead — a Trident sends copies out one at a time, taking each exit in turn. Routing machines never copy anything at all.'],
    ['Nothing rich is copied', 'A Doubler or Trident will not hold a pattern worth more than ' + money(COPY_MAX_VALUE) + ' — feed it something richer and it passes straight through, uncopied. Copying is the only thing in the game that makes a gizmo out of nothing, so it is capped at the one place that would otherwise break the economy, and its levels buy extra exits rather than speed.'],
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
        // Routers emit one gizmo and choose where; everything else emits what it makes.
        (m.kind === 'bal' || m.kind === 'sort')
          ? `1 of ${machineExits(m).length}`
          : String(outputs(m, [{ ty: 2, cp: 0 }]).length),
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
    + 'fusers and assemblers downstream, not a straight upgrade. Its levels buy speed and '
    + 'nothing else, and the second upgrade is the bigger of the two — whatever a Mutator '
    + 'is set to, that is what comes out, at every level.');
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
  prod.appendChild(el('h4', null, 'PRODUCERS'));
  prod.appendChild(el('p', 'ht-note',
    `Producer A drops Scrap into the top-left slot from the first round. Producer B drops `
    + `Resin one row below it once your plot is ${RESIN_CLAIM} x ${RESIN_CLAIM}. One level runs both, so this `
    + `upgrade is worth roughly twice as much once the second feed is open.`));
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

  /* --- prices ------------------------------------------------------------ */
  const shop = section('WHAT THINGS COST',
    'A machine costs the same in the last round as it does in the first. Growth in this '
    + 'game is already expensive — land climbs steeply, so do levels, and so does each '
    + 'routing machine after the first few in a round — and inflation on top of that only '
    + `punishes whoever is behind. Each level of a fixture costs ${UTIL_STEP}x the last; each level `
    + `of a machine costs ${UP_STEP}x the last, worked out from its base price.`);
  shop.appendChild(table(['Machine', 'Buy', 'Level 2', 'Level 3', 'All in', 'Scrap back'],
    [
      ['Conveyor', { kind: 'pipe' }],
      ['Balancer', { kind: 'bal' }],
      ['Sorter', { kind: 'sort' }],
      ['Storage', { kind: 'store' }],
      ['Fuser', { kind: 'fuse' }],
      ['Doubler', { kind: 'dup' }],
      ['Trident', { kind: 'trident' }],
      ['Engine Assembler', { kind: 'asm', mut: 0 }],
      ['Turbine Assembler', { kind: 'asm', mut: 1 }],
      ['Reactor Assembler', { kind: 'asm', mut: 2 }],
    ].map(([name, spec]) => [
      name,
      { v: money(shopCost(spec)), cls: 'ht-buy' },
      { v: money(upgradeCost({ ...spec, level: 1 })), cls: 'ht-buy' },
      { v: money(upgradeCost({ ...spec, level: 2 })), cls: 'ht-buy' },
      money(investedIn({ ...spec, level: MAX_LEVEL })),
      { v: '+' + money(scrapValue({ ...spec, level: MAX_LEVEL })), cls: 'ht-sell' },
    ])));

  shop.appendChild(el('p', 'ht-custody',
    'Routing machines are priced differently, because they are the one thing you cannot '
    + 'be allowed to run out of. A Conveyor, a Balancer and a Sorter only decide where a '
    + 'gizmo goes — none of them makes one worth more — so all three are on sale from your '
    + 'phone in every phase, including while the floor is running. They share one ladder '
    + "and one counter: each round, a number of them equal to your plot's width go for "
    + 'base price, and that allowance is a budget you spend how you like — a long belt '
    + 'run, or one Balancer and a Sorter. Past it, each one in the same round costs nearly '
    + 'double the last, and the ladder resets when the next round starts. Sprawl is a '
    + 'luxury; reconnecting is a right.'));
  shop.appendChild(table(['Routing', '1st this round', '2nd', '3rd', '4th', '5th', '6th'],
    ROUTE_KINDS.map(k => [KINDS[k].name, ...[0, 1, 2, 3, 4, 5].map(n =>
      ({ v: money(routeCost(k, n, CLAIM_START)),
        cls: n < moverFree(CLAIM_START) ? 'ht-sell' : 'ht-buy' }))])));
  shop.appendChild(el('p', 'ht-note',
    `Shown for a ${CLAIM_START} x ${CLAIM_START} claim, where the first ${moverFree(CLAIM_START)} are cheap. A wider plot gets more `
    + 'of them at base price. The counter is shared: buying a Balancer uses up one of the '
    + 'cheap belts, and the other way round.'));
  body.appendChild(shop);

  /* --- families ---------------------------------------------------------- */
  const lad = section('THE THREE FAMILIES',
    'What a vault pays per gizmo, before its own multiplier. Fusers climb within a '
    + 'family and never across one; Mutators only print Alloy.');
  const FAMS = [
    [ALLOY, 'ALLOY', 'From Producer A. Each rung is worth a little more than two of the '
      + 'rung below, which is what makes fusing pay. Mutators print any rung of it.'],
    [PART, 'PART', `From Producer B, which opens at ${RESIN_CLAIM} x ${RESIN_CLAIM}. Worth almost nothing sold on `
      + 'its own — a Part exists to be half of a recipe. Fusers climb it: two Resin make a '
      + 'Cord, two Cords make a Frame.'],
    [PRODUCT, 'PRODUCT', 'From an Assembler, and from nothing else. Nothing mutates or '
      + 'fuses a Product; it goes to a vault. This is where the money is.'],
  ];
  const fams = el('div', 'ht-fams');
  for (const [fam, name, note] of FAMS) {
    const panel = el('div', 'ht-panel');
    panel.appendChild(el('h4', null, name));
    panel.appendChild(el('p', 'ht-note', note));
    const ul = el('ul', 'ht-ladder');
    for (let k = 0; k < FAM_LEN[fam]; k++) {
      const ty = FAM_START[fam] + k;
      const t = TYPES[ty];
      const li = el('li');
      li.style.setProperty('--c', t.color);
      li.appendChild(el('span', 'ht-chip'));
      li.appendChild(el('b', null, t.name));
      li.appendChild(el('span', 'ht-val', money(t.value)));
      ul.appendChild(li);
    }
    panel.appendChild(ul);
    fams.appendChild(panel);
  }
  lad.appendChild(fams);
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
