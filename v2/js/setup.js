/**
 * setup.js — the shared Setup panel.
 *
 * One dialog, two callers: the floor screen opens it from the lobby, and the home
 * screen opens it before a solo run. Both read the same controls, so a solo test
 * runs exactly the match the room would.
 */

import { DEFAULT_CFG } from './game.js';
import { MIN_GRID, MAX_GRID } from './machines.js';

const $ = s => document.querySelector(s);
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 999;

/** How long a build phase really takes once people know what they are doing. */
const BRISK_BUILD = 45;

/** Current values of the Setup controls, falling back to the defaults. */
export function readSetupCfg() {
  const num = (id, d) => {
    const el = $(id);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : d;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const endless = $('#cfg-endless')?.dataset.on === 'on';
  return {
    ...DEFAULT_CFG,
    rounds: clamp(num('#cfg-rounds', DEFAULT_CFG.rounds), MIN_ROUNDS, MAX_ROUNDS),
    endless,
    planSecs: num('#cfg-plan', DEFAULT_CFG.planSecs),
    roundSecs: num('#cfg-secs', DEFAULT_CFG.roundSecs),
    cash: num('#cfg-cash', DEFAULT_CFG.cash),
    gridSize: clamp(num('#cfg-grid', DEFAULT_CFG.gridSize), MIN_GRID, MAX_GRID),
  };
}

const mins = s => `${Math.round(s / 60)} min`;

/**
 * How long this is going to take, which is the one thing a group actually needs to
 * know before starting and the one thing the panel never said.
 *
 * A round is the build phase plus the shipping phase plus the tally — but the build
 * phase ends the moment everyone taps READY, so its clock is a ceiling rather than
 * a duration. The estimate is therefore a range: a table that readies up briskly
 * against one that burns every second it is given.
 */
export function estimate(cfg = readSetupCfg()) {
  const tail = cfg.roundSecs + (cfg.tallySecs ?? 0);
  const slow = cfg.planSecs + tail;
  const fast = Math.min(cfg.planSecs, BRISK_BUILD) + tail;
  if (cfg.endless) {
    return `about ${Math.round(fast / 60 * 10) / 10}–${Math.round(slow / 60 * 10) / 10} min a round, `
      + 'for as long as you keep going';
  }
  const lo = fast * cfg.rounds, hi = slow * cfg.rounds;
  return mins(lo) === mins(hi) ? `about ${mins(lo)}` : `about ${Math.round(lo / 60)}–${mins(hi)}`;
}

/** One line describing what the controls add up to. */
export function summary(cfg = readSetupCfg()) {
  const n = cfg.gridSize;
  const len = cfg.endless ? 'endless' : `${cfg.rounds} round${cfg.rounds === 1 ? '' : 's'}`;
  return `${n}x${n} plot · ${n * n} slots · ${len} · ${cfg.roundSecs}s shipping · ${estimate(cfg)}`;
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
  const cfg = readSetupCfg();
  const rounds = $('#cfg-rounds');
  if (rounds) rounds.disabled = cfg.endless;
  if (!el) return;
  const n = cfg.gridSize;
  el.textContent = n >= 6
    ? `${summary(cfg)}. A plot this big is best read on a tablet or a large phone.`
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

const endless = $('#cfg-endless');
if (endless) {
  endless.addEventListener('click', e => {
    e.preventDefault();
    const on = endless.dataset.on !== 'on';
    endless.dataset.on = on ? 'on' : 'off';
    endless.setAttribute('aria-pressed', on ? 'true' : 'false');
    paintNote();
  });
}

for (const id of ['#cfg-grid', '#cfg-rounds', '#cfg-secs', '#cfg-plan', '#cfg-cash']) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener('change', paintNote);
  el.addEventListener('input', paintNote);
}
