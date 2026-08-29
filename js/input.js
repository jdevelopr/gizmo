/**
 * input.js — every tap, click and key press funnels through here and comes out
 * as one normalised intent object, so the host never needs to know what kind of
 * device produced it.
 *
 * Intents: { t:'buy', slot, id, dir? } { t:'upgrade', slot } { t:'sell', slot }
 *          { t:'lane' } { t:'flip', slot }
 */

import { slotAt } from './render.js';

/** Wire canvas taps to a slot-selected callback. Pointer events cover all input. */
export function bindCanvas(canvas, onSlot) {
  const pick = e => {
    const r = canvas.getBoundingClientRect();
    const i = slotAt(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) {
      buzz(8);
      onSlot(i);
    }
  };
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    pick(e);
  });
}

/**
 * Make a button behave on a phone: instant visual feedback, a short haptic,
 * and a pointercancel handler so an incoming call can't leave it stuck down.
 */
export function bindButton(el, fn) {
  const down = e => {
    e.preventDefault();
    el.classList.add('pressed');
    try { el.setPointerCapture(e.pointerId); } catch {}
  };
  const up = e => {
    el.classList.remove('pressed');
    if (e.type === 'pointerup' && !el.disabled) {
      buzz(10);
      fn(e);
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** Keyboard is the secondary path — handy when the host is on a laptop. */
export function bindKeys(handlers) {
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '9') handlers.selectSlot?.(Number(k) - 1);
    else if (k === '0') handlers.selectSlot?.(9);
    else if (k === 'u') handlers.upgrade?.();
    else if (k === 's') handlers.shop?.();
    else if (k === 'escape') handlers.close?.();
  });
}

export function buzz(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}

/** A controller with no touches for 30s must not let the screen sleep. */
let lock = null;
export async function keepAwake() {
  try { lock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && lock !== null) keepAwake();
});
