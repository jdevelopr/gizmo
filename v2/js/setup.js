/**
 * setup.js — the shared Setup panel.
 *
 * One dialog, two callers: the floor screen opens it from the lobby, and the home
 * screen opens it before a practice run. Both read the same controls, so a solo
 * test runs exactly the match the room would.
 */

import { DEFAULT_CFG } from './game.js';
import { MIN_GRID, MAX_GRID } from './machines.js';

const $ = s => document.querySelector(s);

/** Current values of the Setup controls, falling back to the defaults. */
export function readSetupCfg() {
  const num = (id, d) => {
    const el = $(id);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : d;
  };
  const gridSize = Math.max(MIN_GRID, Math.min(MAX_GRID, num('#cfg-grid', DEFAULT_CFG.gridSize)));
  return {
    ...DEFAULT_CFG,
    rounds: num('#cfg-rounds', DEFAULT_CFG.rounds),
    planSecs: num('#cfg-plan', DEFAULT_CFG.planSecs),
    roundSecs: num('#cfg-secs', DEFAULT_CFG.roundSecs),
    cash: num('#cfg-cash', DEFAULT_CFG.cash),
    gridSize,
  };
}

/** One line describing what the controls add up to. */
export function summary(cfg = readSetupCfg()) {
  const n = cfg.gridSize;
  return `${n}x${n} floor · ${n * n} slots · ${cfg.rounds} rounds · ${cfg.roundSecs}s each`;
}

let pending = null;

/**
 * @param {object} opts label for the confirm button, done(cfg) when it is pressed
 */
export function openSetup({ label = 'DONE', done = null } = {}) {
  const btn = $('#setup-close');
  if (btn) btn.textContent = label;
  pending = done;
  paintNote();
  const box = $('#setup');
  if (box) box.hidden = false;
}

export function closeSetup() {
  const box = $('#setup');
  if (box) box.hidden = true;
}

function paintNote() {
  const el = $('#cfg-note');
  if (!el) return;
  const cfg = readSetupCfg();
  const n = cfg.gridSize;
  el.textContent = n >= 6
    ? `${summary(cfg)}. A floor this big is best read on a tablet or a large phone.`
    : summary(cfg);
}

/* Wire the dialog once, when this module loads. */
const closeBtn = $('#setup-close');
if (closeBtn) {
  closeBtn.addEventListener('click', e => {
    e.preventDefault();
    closeSetup();
    const fn = pending;
    pending = null;
    if (fn) fn(readSetupCfg());
  });
}
for (const id of ['#cfg-grid', '#cfg-rounds', '#cfg-secs', '#cfg-plan', '#cfg-cash']) {
  const el = $(id);
  if (el) el.addEventListener('change', paintNote);
}
