/**
 * bot.mjs — the bits of "playing badly but legally" that every harness needs.
 *
 * Three tools drive the engine like a player: the balance harness, the invariant
 * check and the research check. All three need the same two things, and all three
 * used to hard-code them — lay a line from the feed to the fence, and put a machine
 * on it. That was fine while the feed was always west of row 0 and the vault always
 * east of it. On a generated plot both are real problems, and one copy is enough.
 */
import { routeBetween, portsOf, openAt } from '../js/sim.js';
import { DIRS } from '../js/machines.js';

/** The plot width, which slot indices are relative to. */
let gridSize = 7;
export function setBotGrid(n) { gridSize = n; }
const X = i => i % gridSize;
const Y = i => Math.floor(i / gridSize);
const cellAt = (x, y) => y * gridSize + x;

/** The direction index that steps from one slot to a neighbour. */
export function dirBetween(from, to) {
  if (X(to) > X(from)) return 0;
  if (Y(to) > Y(from)) return 1;
  if (X(to) < X(from)) return 2;
  return 3;
}

/**
 * The line as it actually exists: walk from the feed, following each machine's
 * facing, until it runs off the claim or into an empty slot.
 *
 * The harnesses used to reason about the line they *meant* to build — row zero, or
 * a fresh shortest path — rather than the one on the floor. Those agree only on a
 * map where the shortest route never changes, which is exactly the map that no
 * longer exists. Following the belts is the only honest answer.
 *
 * @returns {number[]} slots in flow order, starting at the feed
 */
export function traceLine(f) {
  const start = portsOf(f)[0]?.cell;
  if (start == null) return [];
  const out = [];
  const seen = new Set();
  let at = start;
  while (at != null && f.grid[at] && !seen.has(at)) {
    seen.add(at);
    out.push(at);
    const d = f.grid[at].dir | 0;
    const nx = X(at) + DIRS[d][0], ny = Y(at) + DIRS[d][1];
    at = openAt(f, nx, ny) ? cellAt(nx, ny) : null;
  }
  return out;
}

/**
 * Make sure a belt run reaches a target slot, and that the last machine on it fires
 * out of the given face. Extends whatever line already exists rather than laying a
 * competing one, and buys only what is missing — so it is safe to call every round,
 * which is what fills the gap an expansion opens up behind the vault.
 *
 * @returns {boolean} whether the line reaches the target
 */
export function layPath(eng, seat, f, toCell, toDir) {
  const line = traceLine(f);
  const head = line.length ? line[line.length - 1] : portsOf(f)[0]?.cell;
  if (head == null) return false;

  const path = routeBetween(f, head, toCell);
  if (!path.length) return false;                 // bedrock in the way of everything

  for (const cell of path) {
    if (f.grid[cell]) continue;
    const before = f.cash;
    const had = new Set(f.grid.map((m, i) => (m ? i : -1)).filter(i => i >= 0));
    eng.action(seat, { t: 'route', k: 'pipe' });
    if (f.cash === before) return false;          // could not afford it
    const at = f.grid.findIndex((m, i) => m && !had.has(i));
    if (at >= 0 && at !== cell) {
      eng.action(seat, { t: 'act', a: { a: 'move', from: 'g' + at, to: 'g' + cell } });
    }
  }

  // Point everything on the line at the next slot along, and the last one out of
  // the fence. Everything, not just belts: a Mutator dropped into the run keeps
  // whatever facing it was bought with, and one machine pointing the wrong way is
  // the whole line earning nothing.
  const full = line.length ? line.slice(0, -1).concat(path) : path;
  for (let k = 0; k < full.length; k++) {
    const m = f.grid[full[k]];
    if (!m) continue;
    m.dir = full[k + 1] == null ? toDir : dirBetween(full[k], full[k + 1]);
  }
  return full.every(c => !!f.grid[c]);
}

/**
 * Put a freshly bought machine on the far end of the line, and optionally scrap any
 * other of its kind already on it.
 *
 * The far end matters for a Mutator: each one rewrites the whole stream, so a line
 * of four produces whatever the last one is at the speed of the slowest. One per
 * line, nearest the vault, is the correct shape.
 */
export function putOnLine(eng, seat, f, at, scrapKind = null) {
  const line = traceLine(f);
  const target = [...line].reverse().find(c => f.grid[c]?.kind === 'pipe');
  if (target == null) return false;
  const facing = f.grid[target].dir;
  if (at !== target) {
    eng.action(seat, { t: 'act', a: { a: 'move', from: 'g' + at, to: 'g' + target } });
    // A swap only auto-faces routing machines, so anything else lands pointing
    // wherever it was bought. Inherit the belt's facing it just replaced.
    if (f.grid[target]) f.grid[target].dir = facing;
  }
  if (scrapKind) {
    for (const c of line) {
      if (c !== target && f.grid[c]?.kind === scrapKind) {
        eng.action(seat, { t: 'act', a: { a: 'scrap', ref: 'g' + c } });
      }
    }
  }
  return true;
}
