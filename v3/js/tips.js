/**
 * tips.js — the things Gus says once.
 *
 * The walkthrough covers the opening. Everything after it the game used to leave
 * you to find in the manual; now, the first time each new thing turns up — a swarm,
 * a mountain at the edge of your land, a line that has jammed for good — Gus pops
 * up with one cheerful tip about it. Each tip is shown once per browser, ever, and
 * only while the walkthrough is not running.
 *
 * A tip fires from one of two places: an effect the simulation emitted (`fx`), or a
 * look at the state of the factory (`check`), which runs about once a second.
 */

import {
  WORLD, MOUNTAIN, VALLEY, cellOf, claimMin, claimMax, TECH, techOpen, rankCost, SWARM_THRESHOLD,
} from './machines.js';
import { jams } from './sim.js';

const SEEN_KEY = 'gizmo3.tips.v1';

/** Is any slot within `pad` of the claim like this? */
function nearClaim(f, pad, test) {
  const lo = Math.max(0, claimMin(f.claim) - pad), hi = Math.min(WORLD - 1, claimMax(f.claim) + pad);
  for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) if (test(cellOf(x, y))) return true;
  return false;
}

export const TIPS = [
  {
    id: 'research',
    title: 'You can afford research!',
    body: 'Look at all that science piling up! Press <b>Y</b> to open the tech tree and spend it. '
      + 'Generators, Balancers and Mutators are all cheap early unlocks — and anything you research is yours for keeps.',
    check: (g, f) => !f.done.length && TECH.some(t => techOpen(t, f.done) && rankCost(t, f.done) <= f.science),
  },
  {
    id: 'brownout',
    title: 'Your power is stretched thin',
    body: 'Your Generators can\'t keep up, so everything on that grid is slowing down. '
      + 'Feed them more ore, add another Generator, or press <b>V</b> to see who is on which grid!',
    check: (g, f) => f.t > 20 && (f.nets || []).some(n => n.demand > 0 && n.gens?.length && n.sat < 0.6),
  },
  {
    id: 'jam',
    title: 'That line is stuck for good',
    body: 'See the red ring? That means a line has stopped and it won\'t fix itself — usually a belt pointing '
      + 'somewhere that won\'t take what it carries. Click the machine to find out why, or press <b>Tab</b> to hop to it!',
    check: (g, f) => f.t > 10 && jams(f).length > 0,
  },
  {
    id: 'sap',
    title: 'Sap, the second ore!',
    body: 'Ooh, green stuff! That\'s <b>Sap</b>. An Extractor on it gives Resin, and two Resin fuse into Cord. '
      + 'Cord plus Amber makes an Engine in an Assembler — research <b>Assembly</b> and the real money starts!',
    check: (g, f) => nearClaim(f, 3, i => f.patch[i] === 8),
  },
  {
    id: 'mountain',
    title: 'A mountain on your doorstep',
    body: 'You can\'t build on a mountain, but there\'s ore locked inside! Research <b>Surveying</b> to see what\'s in it, '
      + 'then <b>Deep Mining</b> for a Mountain Drill. Just between us — drilling wakes up Beetles.',
    check: (g, f) => nearClaim(f, 2, i => f.terrain[i] === MOUNTAIN),
  },
  {
    id: 'valley',
    title: 'Mind the gap!',
    body: 'That\'s a valley — nothing can stand in one. Research <b>Bridging</b>, then set a pair of Bridges facing the '
      + 'same way on either side. They carry gizmos <i>and</i> power right across. Easy as pie!',
    check: (g, f) => nearClaim(f, 2, i => f.terrain[i] === VALLEY),
  },
  {
    id: 'noise',
    title: 'Getting noisy!',
    body: 'Every machine makes a little noise, and upgraded ones make more. Keep the NOISE readout up top '
      + 'under the threshold and the nests stay asleep — go over it and swarms start building. Press <b>L</b> '
      + 'to see how far your racket carries!',
    check: (g, f) => (f.noise || 0) >= SWARM_THRESHOLD * 0.8 && (f.nests || []).some(n => n.hp > 0),
  },
  {
    id: 'swarm',
    title: 'Here come the Mites!',
    body: 'Uh-oh, critters! Nests out in the wilds send swarms that chew on machines, and the noisier your factory, '
      + 'the sooner they come. Research <b>Pest Control</b>, build a Zapper, and belt Ammo into it from an Armory. Zap zap!',
    fx: e => e.k === 'swarm' && e.kind !== 'skitter',
  },
  {
    id: 'brute',
    title: 'Brute Mites!',
    body: 'Whoa, your factory\'s so loud it woke the big ones! Brute Mites take five times the zapping, bite '
      + 'hard, and go straight for your most valuable machines. Keep the noise under <b>12</b> and they stay '
      + 'home — or line your Assemblers and Generators with Zappers.',
    fx: e => e.k === 'swarm' && e.brutes > 0,
  },
  {
    id: 'skitter',
    title: 'Skitters — fast little things!',
    body: 'Skitters are quick and fragile and they go straight for your <b>belts</b>. One zap pops one. '
      + 'Keep a Zapper close to your busiest conveyors!',
    fx: e => e.k === 'swarm' && e.kind === 'skitter',
  },
  {
    id: 'broke',
    title: 'Something got chewed through',
    body: 'One of your machines got eaten clean through and stopped! No worries — click it to patch it up for a few '
      + 'coins, or press <b>H</b> over it. <b>Shift+H</b> fixes everything at once.',
    fx: e => e.k === 'broke',
  },
  {
    id: 'beetle',
    title: 'A Beetle!',
    body: 'All that drilling woke a Beetle! It\'s big, tough and it wants your <b>Generators</b>. '
      + 'Put a couple of Zappers near your drills and power — and Dampers research makes them wake less often.',
    fx: e => e.k === 'beetle',
  },
];

let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { /* private window */ }
const keep = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch (e) { /* ignore */ } };

/** Forget every tip, so Gus says them all again. */
export function resetTips() { seen = new Set(); keep(); }

/**
 * The queue of tips waiting to be shown. `fx` and `check` add to it; the card
 * takes them off one at a time.
 */
export class Tips {
  constructor() {
    this.queue = [];
    this.timer = 0;
  }

  add(tip) {
    if (seen.has(tip.id) || this.queue.includes(tip)) return;
    this.queue.push(tip);
  }

  /** Effects from this frame. */
  fx(list) {
    for (const e of list) for (const t of TIPS) if (t.fx && t.fx(e)) this.add(t);
  }

  /** A look at the factory, about once a second. */
  tick(g, dt) {
    if ((this.timer -= dt) > 0) return;
    this.timer = 1;
    for (const t of TIPS) if (t.check && !seen.has(t.id) && t.check(g, g.f)) this.add(t);
  }

  /** The tip to show now, if any. */
  get current() { return this.queue[0] || null; }

  /** Done with the one on screen. */
  dismiss() {
    const t = this.queue.shift();
    if (t) { seen.add(t.id); keep(); }
  }

  clear() { this.queue = []; }
}
