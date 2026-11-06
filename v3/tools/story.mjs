/**
 * story.mjs — the story campaign: eight worlds, from a pebble to a moon.
 *
 *   node tools/story.mjs
 */
import {
  WORLD, STORY_LEVELS, SPACE, OPEN, MOUNTAIN, VALLEY, BEACON, cellOf, cx, cy, CLAIM_START, catalogue,
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

console.log(fails ? `\n${fails} FAILED\n` : '\nEight worlds, one tech tree, and every contract can be met.\n');
process.exit(fails ? 1 : 0);
