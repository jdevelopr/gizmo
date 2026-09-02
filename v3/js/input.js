/**
 * input.js — mouse and keyboard.
 *
 * The whole of GIZMO 1 and 2 was played with a thumb on a phone, which meant one
 * verb per tap and a drawer full of buttons. This is a desktop game, so it gets
 * the desktop verbs a factory builder needs and no fewer:
 *
 *   **Drag to lay a run of belts.** Laying forty conveyors one click at a time is
 *   not a game, it is data entry. A drag lays the whole line, aims every belt
 *   along it, skips whatever is already there, and stops the moment you run out of
 *   money rather than half-charging you for it.
 *
 *   **A pipette.** Q copies whatever is under the cursor — kind, level, facing,
 *   filter, recipe — into your hand. It is the fastest way to extend anything you
 *   have already got right, and it is why there is no "copy settings" dialog.
 *
 *   **Right click puts things down.** If you are holding something, right click
 *   drops it. If you are not, right click scraps what is under the cursor, and
 *   right-dragging scraps a line of it, which is how you take a wrong belt run out
 *   as fast as you put it in.
 *
 *   **Dragging the map moves the map.** With nothing in hand, a press is held as
 *   a pending selection and becomes a pan the moment the cursor travels more than
 *   a few pixels, so the same button both picks a machine and hauls the world
 *   around and neither gets in the other's way.
 *
 * Everything else is the standard set — WASD and middle-drag to pan, R to rotate,
 * Space to pause — because a factory player already knows those and being clever
 * with them would only cost them time. Zoom is the one deliberate omission: it is
 * on buttons and on + / - rather than on the wheel, because a trackpad reports
 * scroll in continuous pixels and one flick used to cross three zoom levels.
 */

import { DIRS, cellOf, cx, cy, inWorld } from './machines.js';
import { HOTKEYS } from './ui.js';

/** Kinds you can lay in a run by dragging. Belts, and the belt with a tank on it. */
const DRAGGABLE = new Set(['pipe', 'store']);

/**
 * How far the pointer has to travel, in pixels, before a press with nothing in
 * hand stops being a click on a slot and becomes a drag of the map. Small enough
 * that dragging feels immediate, large enough that a click on a conveyor does not
 * nudge the camera because a hand twitched.
 */
const DRAG_SLOP = 4;

export function makeState() {
  return {
    tool: null,        // { kind, mut, mir, dir } held for building
    hand: -1,          // a machine picked up to be moved, by its old slot
    selected: -1,
    hover: -1,
    drag: null,        // { from, axis, path, mode }
    pan: null,
    keys: new Set(),
    showPower: false,
    ghost: null,
    reach: null,
  };
}

export class Input {
  /**
   * @param {View} view
   * @param {object} S state from makeState
   * @param {(name:string, payload:any) => void} act the one door into the game
   * @param {() => object} getGame
   */
  constructor(view, S, act, getGame) {
    this.view = view;
    this.S = S;
    this.act = act;
    this.getGame = getGame;
    this.stage = view.canvas.parentElement;
    this.bind();
  }

  bind() {
    const st = this.stage;
    st.addEventListener('pointerdown', e => { if (this.onWorld(e)) this.down(e); });
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    // The wheel is deliberately not bound to zoom. A trackpad delivers scroll in
    // continuous pixels rather than in notches, so one flick used to jump three
    // zoom levels and lose the part of the map you were looking at. Zoom is on the
    // two buttons in the HUD and on + / - instead, where one press is one step.
    st.addEventListener('wheel', e => { if (this.onWorld(e)) e.preventDefault(); }, { passive: false });
    st.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('blur', () => { this.S.keys.clear(); this.S.pan = null; });
  }

  /**
   * Did this event happen on the world, rather than on something floating over it?
   *
   * The HUD, the minimap and the hint line all live *inside* the stage element, so
   * a click on the pause button bubbles down here first — and `down` used to answer
   * it by calling setPointerCapture on the stage, which redirected the matching
   * pointerup away from the button and meant no click event ever fired on it. Every
   * control over the map was dead and the map itself was fine, which is exactly the
   * sort of bug you only find by clicking one.
   */
  onWorld(e) {
    return e.target === this.view.canvas || e.target === this.view.text;
  }

  /** Screen coordinates of an event, relative to the canvas. */
  at(e) {
    const r = this.stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  cellOfEvent(e) {
    const [x, y] = this.at(e);
    return this.view.cellAt(x, y);
  }

  /* ------------------------------------------------------------- pointers --- */

  down(e) {
    const S = this.S;
    const cell = this.cellOfEvent(e);
    this.stage.setPointerCapture?.(e.pointerId);

    if (e.button === 1) {                       // middle: pan, immediately
      const [x, y] = this.at(e);
      this.startPan(x, y, -1);
      e.preventDefault();
      return;
    }

    if (e.button === 2) {                       // right: put down, or take out
      if (S.tool || S.hand >= 0) { this.clearHand(); return; }
      if (cell >= 0) {
        S.drag = { from: cell, mode: 'scrap', path: [], axis: null };
        this.act('scrap', cell);
      }
      return;
    }

    if (e.button !== 0) return;

    if (S.hand >= 0) {                          // dropping a machine being moved
      if (cell >= 0) this.act('drop', { from: S.hand, to: cell });
      S.hand = -1;
      return;
    }

    if (S.tool) {
      if (cell < 0) return;
      if (DRAGGABLE.has(S.tool.kind)) {
        S.drag = { from: cell, mode: 'build', path: [], axis: null };
        this.retracePath(cell);
      } else {
        this.act('build', { spec: S.tool, cell });
      }
      return;
    }

    // Nothing in hand, so this press is ambiguous: it is either the start of a
    // drag across the map or a click on one slot, and which one it is depends on
    // what the mouse does next. So it is held as a pending selection, and turns
    // into a pan the moment the cursor travels further than a fingertip's wobble.
    const [x, y] = this.at(e);
    this.startPan(x, y, cell);
  }

  /**
   * Begin a pan. `pending` is the slot to select if the pointer never actually
   * moves; pass -1 for a middle-drag, which is a pan and nothing else.
   */
  startPan(x, y, pending) {
    this.S.pan = {
      x, y, pending,
      camx: this.view.cam.x, camy: this.view.cam.y,
      moved: pending < 0,
    };
    if (pending < 0) this.stage.classList.add('grab');
  }

  move(e) {
    const S = this.S;
    const [sx, sy] = this.at(e);
    if (S.pan) {
      const dx = sx - S.pan.x, dy = sy - S.pan.y;
      if (!S.pan.moved) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) {
          S.hover = this.onWorld(e) ? this.view.cellAt(sx, sy) : S.hover;
          return;                       // still could be a click; do not move yet
        }
        S.pan.moved = true;
        this.stage.classList.add('grab');
      }
      const z = this.view.cam.zoom;
      this.view.cam.x = S.pan.camx - dx / z;
      this.view.cam.y = S.pan.camy - dy / z;
      this.view.clampCam();
      S.hover = this.view.cellAt(sx, sy);
      return;
    }

    // Hovering the HUD is not hovering the slot underneath it — but a drag that
    // started on the world keeps tracking even if the cursor strays over a panel,
    // because letting go of the mouse should not depend on where it wandered.
    const cell = this.view.cellAt(sx, sy);
    S.hover = (this.onWorld(e) || S.drag) ? cell : -1;

    if (S.drag?.mode === 'build') { this.retracePath(cell); return; }
    if (S.drag?.mode === 'scrap' && cell >= 0 && cell !== S.drag.last) {
      S.drag.last = cell;
      this.act('scrap', cell);
    }
  }

  up(e) {
    const S = this.S;
    if (S.pan) {
      const p = S.pan;
      S.pan = null;
      this.stage.classList.remove('grab');
      // A press that never travelled was a click on a slot after all.
      if (p.pending >= 0 && !p.moved) {
        S.selected = p.pending;
        this.act('select', p.pending);
      }
    }
    if (S.drag?.mode === 'build') {
      const path = S.drag.path;
      S.drag = null;
      if (path.length) this.act('buildRun', { spec: S.tool, path });
    } else if (S.drag) {
      S.drag = null;
    }
  }

  /* ------------------------------------------------------------ belt runs --- */

  /**
   * The path a drag would lay: straight along whichever axis you moved first, then
   * straight along the other. An L rather than a staircase, because an L is what
   * anyone means by "run a belt from here to there", and because a staircase costs
   * the same money and looks like a mistake.
   */
  retracePath(to) {
    const S = this.S;
    const d = S.drag;
    if (!d || to < 0) return;
    const ax = cx(d.from), ay = cy(d.from), bx = cx(to), by = cy(to);
    if (d.axis == null && (ax !== bx || ay !== by)) {
      d.axis = Math.abs(bx - ax) >= Math.abs(by - ay) ? 'x' : 'y';
    }
    const cells = [];
    if (d.axis === 'y') {
      for (let y = ay; y !== by + Math.sign(by - ay || 1); y += Math.sign(by - ay) || 1) {
        cells.push(cellOf(ax, y));
        if (y === by) break;
      }
      for (let x = ax + Math.sign(bx - ax); bx !== ax && x !== bx + Math.sign(bx - ax); x += Math.sign(bx - ax)) {
        cells.push(cellOf(x, by));
        if (x === bx) break;
      }
    } else {
      for (let x = ax; x !== bx + Math.sign(bx - ax || 1); x += Math.sign(bx - ax) || 1) {
        cells.push(cellOf(x, ay));
        if (x === bx) break;
      }
      for (let y = ay + Math.sign(by - ay); by !== ay && y !== by + Math.sign(by - ay); y += Math.sign(by - ay)) {
        cells.push(cellOf(bx, y));
        if (y === by) break;
      }
    }

    const g = this.getGame();
    const path = [];
    for (let k = 0; k < cells.length; k++) {
      const cell = cells[k];
      if (!inWorld(cx(cell), cy(cell))) continue;
      const next = cells[k + 1];
      let dir;
      if (next != null) {
        dir = DIRS.findIndex(([dx, dy]) => cx(cell) + dx === cx(next) && cy(cell) + dy === cy(next));
      } else {
        dir = path.length ? path[path.length - 1].dir : (S.tool?.dir ?? 0);
      }
      const check = this.act('canBuild', { spec: S.tool, cell });
      path.push({
        cell, dir: dir < 0 ? 0 : dir,
        ok: !!check?.ok, why: check?.msg, mode: check?.mode || 'new',
      });
    }
    d.path = path;
  }

  clearHand() {
    this.S.tool = null;
    this.S.hand = -1;
    this.S.reach = null;
    this.act('tool', null);
  }

  /* ----------------------------------------------------------------- keys --- */

  key(e, down) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const S = this.S;
    const k = e.key;

    if (!down) { S.keys.delete(k.toLowerCase()); return; }
    S.keys.add(k.toLowerCase());

    // Panning keys are read every frame rather than handled here.
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
      .includes(k.toLowerCase())) { e.preventDefault(); return; }

    if (HOTKEYS[k]) { this.act('tool', { ...HOTKEYS[k] }); return; }

    switch (k.toLowerCase()) {
      case 'r':
        if (S.tool) this.act('rotTool', e.shiftKey ? -1 : 1);
        else if (this.target() >= 0) this.act('rot', this.target(), e.shiftKey);
        break;
      case 'f':
        if (S.tool) this.act('flipTool');
        else if (this.target() >= 0) this.act('mir', this.target());
        break;
      case 'o': this.act('off', this.target()); break;
      case 'q': this.act('pipette', this.target()); break;
      case 'm': this.act('pickup', this.target()); break;
      case 'x': case 'delete': case 'backspace':
        if (this.target() >= 0) this.act('scrap', this.target());
        break;
      case '+': case '=': this.act('zoom', 1); break;
      case '-': case '_': this.act('zoom', -1); break;
      case 'v': S.showPower = !S.showPower; this.view.showPower = S.showPower; break;
      case 'c': this.act('expand'); break;
      case 'e': this.act('clear', this.target()); break;
      case ' ': e.preventDefault(); this.act('togglePause'); break;
      case '[': this.act('speed', -1); break;
      case ']': this.act('speed', 1); break;
      case '?': case '/': this.act('help'); break;
      case 'escape':
        if (S.tool || S.hand >= 0) this.clearHand();
        else if (S.selected >= 0) { S.selected = -1; this.act('select', -1); }
        else this.act('menu');
        break;
      default: break;
    }
  }

  /** What a key press acts on: whatever is under the cursor, else the selection. */
  target() {
    return this.S.hover >= 0 ? this.S.hover : this.S.selected;
  }

  /** Keyboard panning, applied once a frame so it is frame-rate independent. */
  panTick(dt) {
    const k = this.S.keys;
    const speed = 22 / this.view.cam.zoom * 32;      // roughly constant on screen
    let dx = 0, dy = 0;
    if (k.has('a') || k.has('arrowleft')) dx -= 1;
    if (k.has('d') || k.has('arrowright')) dx += 1;
    if (k.has('w') || k.has('arrowup')) dy -= 1;
    if (k.has('s') || k.has('arrowdown')) dy += 1;
    if (dx || dy) this.view.panBy(dx * speed * dt, dy * speed * dt);
  }
}
