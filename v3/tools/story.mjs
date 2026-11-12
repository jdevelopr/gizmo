/**
 * story.mjs — the story campaign: eight worlds, from a pebble to a moon.
 *
 *   node tools/story.mjs
 */
import {
  WORLD, STORY_LEVELS, SPACE, OPEN, MOUNTAIN, VALLEY, BEACON, cellOf, cx, cy, CLAIM_START, catalogue,
  storyLevel, storyLabel, storyBonus, bruteLine, BRUTE_THRESHOLD, TYPES,
} from '../js/machines.js';
import { storyWorld, SAP } from '../js/world.js';
import { placeNests } from '../js/bugs.js';
import { starterKit, rebuild, applyAction, buildCheck } from '../js/sim.js';
import {
  createStoryGame, nextStoryGame, stepGame, serialise, deserialise, goalProgress, storyStats,
} from '../js/game.js';

let fails = 0;
const ok = (cond, what, detail = '') => {
  if (cond) console.log(`  ok    ${what}`);
  else { fails++; console.log(`  FAIL  ${what}${detail ? '\n        ' + detail : ''}`); }
};
const run = (g, secs) => { for (let i = 0; i < secs * 30; i++) stepGame(g, 1 / 30); };

console.log('\nThe worlds');
{
  ok(STORY_LEVELS.length === 8, 'eight of them');
  let prev = 0;
  for (let lv = 0; lv < STORY_LEVELS.length; lv++) {
    const L = STORY_LEVELS[lv];
    const seeds = [11, 222, 3333, 44444, 555555];
    let land = 0, sap = 0, mtn = 0, val = 0, nests = 0, sk = 0, bad = 0;
    for (const s of seeds) {
      const w = storyWorld(lv, s);
      let a = 0;
      for (let i = 0; i < w.terrain.length; i++) {
        if (w.terrain[i] !== SPACE) a++;
        if (w.patch[i] === SAP) sap++;
        if (w.terrain[i] === MOUNTAIN) mtn++;
        if (w.terrain[i] === VALLEY) val++;
        if (w.terrain[i] === BEACON) bad++;
        if (w.terrain[i] === SPACE && w.patch[i] >= 0) bad++;
      }
      land += a / seeds.length;
      const st = w.start;
      if (![st.ext, st.depot, ...st.belts].every(i => w.terrain[i] === OPEN)) bad++;
      if (w.patch[st.ext] !== 0) bad++;
      const ns = placeNests(w);
      nests = Math.max(nests, ns.length);
      sk += ns.filter(n => n.kind === 'skitter').length;
      if (ns.some(n => w.terrain[n.cell] !== OPEN)) bad++;
    }
    console.log(`  ${L.name.padEnd(8)} ${L.kind.padEnd(15)} ~${Math.round(land)} slots, Sap ${sap ? 'yes' : 'no'}, mountains ${mtn ? 'yes' : 'no'}, valleys ${val ? 'yes' : 'no'}, nests ${nests}`);
    ok(!bad, `${L.name}: the opening is clear and on Slag, nothing lies out in space`);
    ok(land > prev, `${L.name} is bigger than the world before it`);
    prev = land;
    ok(!!L.sap === sap > 0, `${L.name}: Sap ${L.sap ? 'is on every rock' : 'is not there yet'}`);
    ok(!!L.mountains === mtn > 0 || (!L.mountains && !mtn), `${L.name}: mountains only once introduced`);
    ok(L.valleys ? val > 0 : val === 0, `${L.name}: valleys only once introduced`);
    ok(L.bugs ? nests > 0 && nests <= L.nests : nests === 0, `${L.name}: ${L.bugs ? `up to ${L.nests} nests` : 'no nests'}`);
    ok(L.skitters || sk === 0, `${L.name}: Skitters only once introduced`);
  }
}

console.log('\nA world in play');
{
  const g = createStoryGame(0, { seed: 5, teach: false });
  ok(g.story.level === 0 && g.f.cash === STORY_LEVELS[0].cash, 'level one starts with its own cash');
  ok(g.f.science === 0 && g.f.done.length === 0, 'and no science and no research');
  ok(catalogue(g.f.done).length === 4, 'and only the four starter machines');
  ok(g.contracts.length === 0, 'and no endless order board');
  starterKit(g.f); rebuild(g.f);
  run(g, 60);
  ok(g.f.shipped[0] > 0, `the opening line ships Scrap (${Math.round(g.f.shipped[0])})`);
  ok(g.contracts.length === 0, 'and no random orders are posted');
  ok(!g.story.complete && goalProgress(g, 0).p > 0 && goalProgress(g, 0).p < 1, `the goal moves (${goalProgress(g, 0).text})`);
  g.f.shipped[0] = 200;
  run(g, 0.2);
  ok(g.story.goals[0].done && g.story.complete, 'and once it is met the world is complete');

  // The fence stops at the edge of the rock.
  g.f.cash = 1e9;
  let n = 0;
  while (applyAction(g.f, { a: 'expand' }).ok && n < 60) n++;
  ok(g.f.claim === g.f.world.maxClaim && g.f.claim < WORLD, `land can be bought only to the edge of the rock (${g.f.claim} x ${g.f.claim})`);
  const lo = (WORLD - g.f.claim) >> 1;
  ok(!buildCheck(g.f, { kind: 'pipe' }, cellOf(lo, lo)).ok, 'and nothing stands on open space', buildCheck(g.f, { kind: 'pipe' }, cellOf(lo, lo)).msg);

  // On to the next.
  g.f.done.push('generators', 'balancing');
  g.f.science = 500;
  const st = storyStats(g);
  const h = nextStoryGame(g);
  ok(h.story.level === 1, 'the next world is level two');
  ok(h.f.done.includes('generators') && h.f.done.includes('balancing'), 'research is kept');
  ok(h.f.science === 0 && h.f.cash === STORY_LEVELS[1].cash, 'money and science start again');
  ok(h.f.cells.length === 0 && h.f.claim === CLAIM_START, 'on an empty rock');
  ok(h.story.total.shipped === st.total.shipped && h.story.total.shipped > 0, 'and the campaign totals carry on');
  ok(h.tut === -1, 'the walkthrough is not shown again');
}

console.log('\nA rate goal has to be held');
{
  const g = createStoryGame(2, { seed: 9, teach: false });
  const k = STORY_LEVELS[2].goals.findIndex(x => x.k === 'rate');
  const goal = STORY_LEVELS[2].goals[k];
  g.speed = 0;                                 // hold the factory still; drive the rate by hand
  const tick = secs => { for (let i = 0; i < secs * 30; i++) { g.rate[goal.ty] = g._fake / 60; g.speed = 1; stepGame(g, 1 / 30); } };
  g._fake = goal.per + 5; tick(goal.secs / 2);
  ok(!g.story.goals[k].done && g.story.goals[k].held > 0, 'half the time at the rate is not enough');
  g._fake = 0; tick(1);
  ok(g.story.goals[k].held === 0, 'and dropping below it starts the clock again');
  g._fake = goal.per + 5; tick(goal.secs + 2);
  ok(g.story.goals[k].done, 'holding it the whole time meets it');
}

console.log('\nSaving');
{
  const g = createStoryGame(4, { seed: 77, teach: false, done: ['generators', 'mut1'] });
  starterKit(g.f); rebuild(g.f);
  run(g, 20);
  g.story.goals[1].done = true;
  const back = deserialise(JSON.parse(JSON.stringify(serialise(g))));
  ok(back.story && back.story.level === 4, 'a story save comes back as the same level');
  ok(back.story.goals[1].done && !back.story.goals[0].done, 'with its goals where they were');
  ok(back.f.terrain.every((t, i) => t === g.f.terrain[i]), 'on the same rock');
  ok(back.f.done.includes('mut1'), 'with its research');
  ok(back.f.world.maxClaim === g.f.world.maxClaim, 'and the same fence limit');
}

console.log('\nEndless worlds');
{
  const L8 = storyLevel(8), L9 = storyLevel(9), L30 = storyLevel(30);
  ok(L8.endless && L9.endless && !storyLevel(7).endless, 'after world 8 the worlds keep coming');
  ok(L8.name !== L9.name && storyLevel(8).name === L8.name, `each has its own name, and the same one every time (${L8.name}, ${L9.name}, ... ${L30.name})`);
  ok(storyLabel(8) === 'WORLD 9 · ENDLESS' && storyLabel(7) === 'WORLD 8 OF 8', 'and is labelled as endless');
  const cashGoal = L => L.goals.find(g => g.k === 'cash').n;
  ok(cashGoal(L9) > cashGoal(L8) && cashGoal(L30) > cashGoal(L9) * 10, 'every world wants more cash than the last');
  ok(L8.goals.every(g => g.k !== 'ship' || g.n >= 20), 'and big shipments');
  ok(L9.nests > L8.nests && L8.nests > STORY_LEVELS[7].nests && L30.nests <= 40, `more nests each world, capped (${L8.nests}, ${L9.nests} ... ${L30.nests})`);
  const g = createStoryGame(8, { seed: 99, bonus: 2000 });
  ok(g.f.cash === L8.cash + 2000 && g.f.mean === 1, 'a head start is added to the starting cash, and the world is meaner');
  ok(bruteLine(g.f) < BRUTE_THRESHOLD, 'Brutes come at less noise');
  const nests = (g.f.nests || []).filter(n => n.hp > 0).length;
  ok(nests >= 10, `its nests are dug in (${nests})`);
  ok(storyBonus(300) > storyBonus(1200) && storyBonus(1200) > 0 && storyBonus(5000) === 0, 'a faster finish earns a bigger head start, a slow one none');
  // Into the endless worlds from Orrin
  const o = createStoryGame(7, { seed: 5 });
  o.story.complete = true; o.story.doneAt = 600;
  const n = nextStoryGame(o);
  ok(n.story.level === 8 && n.f.cash === L8.cash + storyBonus(600), `finishing Orrin opens world 9 with a head start (${n.f.cash})`);
  const back = deserialise(serialise(n));
  ok(back.story.level === 8 && back.f.mean === 1, 'an endless save comes back as the same world');
  ok(L8.goals.every(g => g.k === 'cash' || TYPES[g.ty]), 'every goal names a real gizmo');
}

console.log('\nA save keeps its own world');
{
  const { createGame, stepGame: step } = await import('../js/game.js');
  for (const [name, make] of [['endless', () => createGame({ seed: 4242, teach: false })], ['story', () => createStoryGame(6, { seed: 4343 })], ['endless story', () => createStoryGame(10, { seed: 4444 })]]) {
    const g = make();
    for (let i = 0; i < 60; i++) step(g, 1 / 30);
    const data = JSON.parse(JSON.stringify(serialise(g)));
    // Pretend the world generator has changed since: the same seed now makes another world.
    data.seed = data.seed + 1;
    const back = deserialise(data);
    let dt = 0, dp = 0, dm = 0;
    for (let i = 0; i < g.f.terrain.length; i++) {
      if (g.f.terrain[i] !== back.f.terrain[i]) dt++;
      if (g.f.patch[i] !== back.f.patch[i]) dp++;
      if (g.f.mtn[i] !== back.f.mtn[i]) dm++;
    }
    ok(!dt && !dp && !dm && back.f.mountains.length === g.f.mountains.length,
      `${name}: mountains, valleys and ore come back exactly as saved, even if the generator changes (${dt}/${dp}/${dm} slots differ)`);
    ok(!g.f.beacon || (back.f.beacon.x0 === g.f.beacon.x0 && back.f.beacon.y0 === g.f.beacon.y0), `${name}: and the Beacon stays put`);
  }
  const old = JSON.parse(JSON.stringify(serialise(createStoryGame(3, { seed: 99 }))));
  delete old.world;
  ok(!!deserialise(old), 'a save from before still loads (rebuilt from its seed)');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nEight worlds, then endless ones, one tech tree, and every contract can be met.\n');
process.exit(fails ? 1 : 0);
