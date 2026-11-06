/**
 * teacher.js — Gus, the foreman, who teaches the game.
 *
 * Gus is a veteran prospector in a scuffed space helmet with a lamp on top. He is
 * drawn here as 32x32 pixel art, frame by frame, and cached: idle, blinking and
 * talking. While he talks his words type out a few letters at a time with a soft
 * synthesized blip, and a click finishes the line at once.
 *
 * He has two jobs. He runs the walkthrough card, and once that is over he pops up
 * the first time something new happens — the first swarm, the first mountain on
 * your doorstep — with one cheerful tip about it, never twice.
 */

const S = 32;

/** The palette. One place, so he stays the same person. */
const C = {
  rim: '#d6dbe8', rimDk: '#8a90a8', rimLt: '#ffffff',
  glass: '#16233d', glassLt: '#24365c', shine: '#a8d8ff',
  lamp: '#ffe27a', lampLt: '#fff6c8', lampBox: '#6b7088',
  skin: '#f2b48a', skinDk: '#c98a64', cheek: '#ff9a86', nose: '#d98a68',
  beard: '#e4e4ee', beardDk: '#a9aabb', brow: '#f2f2f8',
  eye: '#1a1420', mouth: '#5a2230', tongue: '#d8606a',
  suit: '#e07a2a', suitDk: '#a4521c', suitLt: '#ffa65a',
  collar: '#7c8298', collarLt: '#b8bdd0', patch: '#ffcd75', badge: '#41a6f6',
};

/** Draw one frame of Gus into a 32x32 context. */
function paint(ctx, { blink = false, mouth = 0 } = {}) {
  ctx.clearRect(0, 0, S, S);
  const p = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // --- the suit: shoulders, a collar ring, and a patch
  for (let y = 24; y < 32; y++) {
    const half = 9 + Math.min(6, y - 24);
    p(16 - half, y, C.suitDk, half * 2, 1);
    p(16 - half + 1, y, C.suit, half * 2 - 3, 1);
  }
  p(4, 26, C.suitLt, 3, 1); p(25, 27, C.suitDk, 3, 1);
  p(7, 23, C.collar, 18, 3); p(7, 23, C.collarLt, 18, 1);
  p(20, 27, C.patch, 4, 3); p(21, 28, C.badge, 2, 1);
  p(9, 27, C.suitDk, 1, 5); p(22, 26, C.suitDk, 1, 1);

  // --- the helmet: a ring of rim round a glass dome
  const cx = 15.5, cy = 13;
  for (let y = 0; y < 26; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.05);
      if (d <= 12.6 && d > 11) p(x, y, x + y < 24 ? C.rimLt : x - y > 12 || y > 17 ? C.rimDk : C.rim);
      else if (d <= 11) p(x, y, d > 9.5 ? C.glassLt : C.glass);
    }
  }

  // --- his face, inside the glass
  for (let y = 7; y < 22; y++) {
    for (let x = 8; x < 24; x++) {
      const d = Math.hypot((x - 15.5) / 6.6, (y - 14) / 7.4);
      if (d <= 1) p(x, y, x > 20 ? C.skinDk : C.skin);
    }
  }
  // a little hair poking out, and the bushy brows
  p(10, 7, C.beard, 12, 2); p(9, 8, C.beardDk, 1, 2); p(22, 8, C.beardDk, 1, 2);
  p(10, 10, C.brow, 4, 2); p(18, 10, C.brow, 4, 2);
  // eyes
  if (blink) { p(11, 13, C.eye, 3, 1); p(18, 13, C.eye, 3, 1); }
  else {
    p(11, 12, C.eye, 2, 2); p(19, 12, C.eye, 2, 2);
    p(11, 12, '#ffffff', 1, 1); p(19, 12, '#ffffff', 1, 1);
  }
  // nose and cheeks
  p(15, 13, C.nose, 2, 3); p(15, 15, C.skinDk, 2, 1);
  p(10, 15, C.cheek, 2, 1); p(20, 15, C.cheek, 2, 1);
  // the beard: a big grey bib with a smile cut in it
  for (let y = 16; y < 23; y++) {
    const half = y < 18 ? 7 : y < 21 ? 6 - (y - 18) : 3 - (y - 21);
    p(16 - half, y, C.beard, half * 2, 1);
  }
  p(9, 16, C.beardDk, 1, 2); p(22, 16, C.beardDk, 1, 2); p(14, 22, C.beardDk, 4, 1);
  // moustache
  p(12, 16, C.brow, 3, 1); p(17, 16, C.brow, 3, 1); p(13, 15, C.brow, 2, 1); p(17, 15, C.brow, 2, 1);
  // mouth: a grin, or open while he talks
  if (mouth === 0) { p(14, 18, C.mouth, 4, 1); p(13, 17, C.mouth, 1, 1); p(18, 17, C.mouth, 1, 1); }
  else if (mouth === 1) { p(14, 17, C.mouth, 4, 2); p(15, 18, C.tongue, 2, 1); }
  else { p(14, 17, C.mouth, 4, 3); p(15, 19, C.tongue, 2, 1); }

  // the glare on the glass, over everything inside it
  p(7, 6, C.shine, 2, 1); p(6, 7, C.shine, 1, 3); p(8, 5, C.shine, 2, 1);
  ctx.globalAlpha = 0.5; p(23, 18, C.shine, 1, 2); ctx.globalAlpha = 1;

  // --- the head lamp on top of the helmet
  p(13, 0, C.lampBox, 6, 3); p(14, 0, C.lamp, 4, 2); p(15, 0, C.lampLt, 2, 1);
}

/** Every frame he can show, drawn once. */
const frames = new Map();
function frame(blink, mouth) {
  const key = `${blink ? 1 : 0}${mouth}`;
  let c = frames.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = S; c.height = S;
    paint(c.getContext('2d'), { blink, mouth });
    frames.set(key, c);
  }
  return c;
}

/**
 * Gus on a canvas: he bobs gently, blinks now and then, and moves his mouth while
 * `talking` is true. The canvas is 32x34 (room to bob) and scaled up in CSS.
 */
export class Gus {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = S; canvas.height = S + 2;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.nextBlink = 2;
    this.blinkT = 0;
    this.key = '';
  }

  tick(dt, talking) {
    this.t += dt;
    if ((this.nextBlink -= dt) <= 0) { this.blinkT = 0.13; this.nextBlink = 2 + Math.random() * 3; }
    if (this.blinkT > 0) this.blinkT -= dt;
    const blink = this.blinkT > 0;
    const mouth = talking ? [1, 2, 1, 0][Math.floor(this.t * 12) % 4] : 0;
    const bob = Math.sin(this.t * 2.2) > 0.3 ? 1 : 0;
    // the lamp flickers a touch while he is talking
    const key = `${blink}|${mouth}|${bob}`;
    if (key === this.key) return;
    this.key = key;
    this.ctx.clearRect(0, 0, S, S + 2);
    this.ctx.drawImage(frame(blink, mouth), 0, 1 + bob);
  }
}

/**
 * Text that types itself out. The whole line is laid out as HTML first — bold
 * keys and all — and then every text node is emptied and filled back in a few
 * letters at a time, so markup never shows half-written.
 */
export class Typewriter {
  constructor(node, onBlip = null) {
    this.node = node;
    this.onBlip = onBlip;
    this.parts = [];
    this.at = 0;
    this.total = 0;
    this.acc = 0;
    this.cps = 70;               // letters a second
  }

  start(html) {
    this.node.innerHTML = html;
    this.parts = [];
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { this.parts.push({ node: c, text: c.nodeValue }); c.nodeValue = ''; }
        else walk(c);
      }
    };
    walk(this.node);
    this.total = this.parts.reduce((t, p) => t + p.text.length, 0);
    this.at = 0;
    this.acc = 0;
    this.sinceBlip = 0;
  }

  get typing() { return this.at < this.total; }

  /** Finish the line now. */
  finish() { this.at = this.total; this.render(); }

  tick(dt) {
    if (!this.typing) return false;
    this.acc += dt * this.cps;
    const n = Math.floor(this.acc);
    if (!n) return true;
    this.acc -= n;
    const before = this.at;
    this.at = Math.min(this.total, this.at + n);
    this.render();
    this.sinceBlip += this.at - before;
    if (this.sinceBlip >= 3) { this.sinceBlip = 0; this.onBlip?.(); }
    return this.typing;
  }

  render() {
    let left = this.at;
    for (const p of this.parts) {
      const k = Math.max(0, Math.min(p.text.length, left));
      if (p.node.nodeValue.length !== k) p.node.nodeValue = p.text.slice(0, k);
      left -= p.text.length;
    }
  }
}
