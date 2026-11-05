/**
 * sound.js — every noise the game makes, synthesised on the spot.
 *
 * There are no audio files. Each sound is a few oscillators and a burst of noise
 * shaped by an envelope, which keeps the game a folder of text files that deploys
 * anywhere, and keeps every sound in the same small, chunky family as the pixel art.
 *
 * Browsers will not make a sound until the page has been clicked or typed into, so
 * the context is created lazily on the first gesture. Everything is throttled per
 * sound: a factory selling two hundred gizmos a second should hum, not roar.
 */

const PREF = 'gizmo3.sound.v1';
let ctx = null, master = null, noiseBuf = null;
const last = {};
let prefs = { on: true, vol: 0.5 };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch (e) { /* defaults */ }

function save() { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* private */ } }

export const soundOn = () => prefs.on;
export const volume = () => prefs.vol;

export function setSound(on) { prefs.on = !!on; save(); if (master) master.gain.value = prefs.on ? prefs.vol : 0; }
export function setVolume(v) {
  prefs.vol = Math.max(0, Math.min(1, v)); save();
  if (master) master.gain.value = prefs.on ? prefs.vol : 0;
}

/** Called on the first click or key press: the only moment a browser allows audio. */
export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = prefs.on ? prefs.vol : 0;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, freq = 1200, q = 1, vol = 0.15, delay = 0, type = 'bandpass') {
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

/** Minimum seconds between two of the same sound. */
const GAP = {
  sell: 0.09, sci: 0.12, zap: 0.05, kill: 0.04, build: 0.03, scrap: 0.05, broke: 0.6,
  chew: 0.35, repair: 0.08, swarm: 2, stir: 2, nest: 0.5, tech: 0.5, grow: 0.5,
  contract: 0.5, click: 0.03, error: 0.25, rot: 0.04, up: 0.06, move: 0.08,
};

export function sfx(name, strength = 1) {
  if (!ctx || !prefs.on || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - (last[name] ?? -9) < (GAP[name] ?? 0.05)) return;
  last[name] = now;
  const v = Math.max(0.3, Math.min(1.4, strength));
  switch (name) {
    case 'sell': tone(880 + Math.random() * 60, 1320, 0.07, 'triangle', 0.05 * v); break;
    case 'sci': tone(660, 990, 0.08, 'sine', 0.05 * v); break;
    case 'zap':
      tone(1800 + Math.random() * 400, 220, 0.12, 'sawtooth', 0.06);
      noise(0.09, 4200, 0.8, 0.07);
      break;
    case 'kill': noise(0.08, 900, 2, 0.12); tone(300, 90, 0.08, 'square', 0.05); break;
    case 'chew': noise(0.05, 600, 6, 0.05); break;
    case 'broke': noise(0.22, 300, 1, 0.22); tone(140, 50, 0.25, 'square', 0.1); break;
    case 'build': tone(220, 330, 0.06, 'square', 0.07); noise(0.04, 2000, 1, 0.04); break;
    case 'up': [523, 659, 784].forEach((f, k) => tone(f, f, 0.08, 'square', 0.06, k * 0.05)); break;
    case 'scrap': noise(0.12, 700, 0.7, 0.12); tone(260, 110, 0.1, 'square', 0.05); break;
    case 'repair': [440, 554].forEach((f, k) => tone(f, f, 0.06, 'triangle', 0.08, k * 0.06)); break;
    case 'rot': tone(500, 520, 0.03, 'square', 0.04); break;
    case 'move': tone(300, 450, 0.08, 'triangle', 0.07); break;
    case 'click': tone(1000, 1000, 0.02, 'square', 0.03); break;
    case 'error': tone(180, 140, 0.14, 'square', 0.07); break;
    case 'swarm':
      for (let k = 0; k < 3; k++) { tone(392, 330, 0.18, 'sawtooth', 0.09, k * 0.24); }
      break;
    case 'stir': tone(220, 196, 0.4, 'triangle', 0.08); break;
    case 'nest': [392, 523, 659, 784, 1046].forEach((f, k) => tone(f, f, 0.12, 'square', 0.07, k * 0.06)); noise(0.3, 500, 0.6, 0.12); break;
    case 'tech': [523, 659, 784, 1046].forEach((f, k) => tone(f, f, 0.14, 'triangle', 0.08, k * 0.08)); break;
    case 'grow': [330, 440, 554, 660].forEach((f, k) => tone(f, f, 0.1, 'square', 0.06, k * 0.06)); break;
    case 'contract': [659, 784, 988, 1318].forEach((f, k) => tone(f, f, 0.1, 'triangle', 0.09, k * 0.07)); break;
    default: break;
  }
}
