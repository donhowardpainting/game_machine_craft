// Unified input for keyboard+mouse and touch. Everything downstream reads
// `input` and never cares which device produced it.
export const input = {
  moveX: 0, moveY: 0,          // strafe / forward, -1..1
  lookDX: 0, lookDY: 0,        // accumulated look delta (radians-ish), consumed each frame
  jump: false, sprint: false, down: false,
  breakHeld: false,
  pressed: new Set<string>(),  // one-shot actions
  locked: false,
  dragLook: false,
  touch: false,
  wheel: 0,
  enabled: () => true as boolean, // false while a panel is open
};

const keys = new Set<string>();
const KEY_ACTION: Record<string, string> = {
  KeyE: 'use', KeyQ: 'config', KeyR: 'rotate', Tab: 'inventory', KeyI: 'inventory', KeyF: 'fly', KeyG: 'anchor',
  KeyZ: 'ch0', KeyX: 'ch1', KeyC: 'ch2', KeyV: 'ch3', Escape: 'menu', KeyT: 'drop',
};

export function initInput(canvas: HTMLCanvasElement) {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  input.touch = isTouch;

  // ----- keyboard -----
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    const a = KEY_ACTION[e.code];
    if (a) input.pressed.add(a);
    if (e.code.startsWith('Digit')) input.pressed.add('hot' + e.code.slice(5));
    if (e.code === 'Space') { input.pressed.add('jumpTap'); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); input.breakHeld = false; });

  // ----- mouse -----
  let dragBtn = -1, dragMoved = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (input.touch && !input.locked && e.detail === 0) return;
    if (!input.enabled()) return;
    if (!input.locked && !input.dragLook) {
      const p = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { input.dragLook = true; });
      else if (!canvas.requestPointerLock) input.dragLook = true;
      return;
    }
    if (input.dragLook) { dragBtn = e.button; dragMoved = 0; return; }
    if (e.button === 0) { input.breakHeld = true; input.pressed.add('break'); }
    else if (e.button === 2) input.pressed.add('place');
    else if (e.button === 1) input.pressed.add('pickBlock');
  });
  addEventListener('mouseup', (e) => {
    if (input.dragLook && dragBtn >= 0) {
      if (dragMoved < 6) { if (dragBtn === 0) input.pressed.add('break'); else if (dragBtn === 2) input.pressed.add('place'); }
      dragBtn = -1;
    }
    if (e.button === 0) input.breakHeld = false;
  });
  addEventListener('mousemove', (e) => {
    if (input.locked) { input.lookDX += e.movementX * 0.0023; input.lookDY += e.movementY * 0.0023; }
    else if (input.dragLook && dragBtn >= 0) {
      dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      input.lookDX += e.movementX * 0.004; input.lookDY += e.movementY * 0.004;
      if (dragBtn === 0 && dragMoved > 40) input.breakHeld = false;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const was = input.locked;
    input.locked = document.pointerLockElement === canvas;
    if (was && !input.locked) { input.breakHeld = false; input.pressed.add('unlock'); }
  });
  document.addEventListener('pointerlockerror', () => { input.dragLook = true; });
  addEventListener('wheel', (e) => { if (input.enabled()) input.wheel += Math.sign(e.deltaY); }, { passive: true });

  // ----- touch: left side = stick, elsewhere = look, tap = place -----
  const stick = document.getElementById('stick')!, knob = document.getElementById('knob')!;
  let stickId = -1, sx = 0, sy = 0;
  const looks = new Map<number, { x: number; y: number; t: number; moved: number }>();
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (stickId < 0 && t.clientX < innerWidth * 0.42 && t.clientY > innerHeight * 0.3) {
        stickId = t.identifier; sx = t.clientX; sy = t.clientY;
        stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.classList.add('on');
        knob.style.transform = 'translate(-50%,-50%)';
      } else looks.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 });
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sx, dy = t.clientY - sy;
        const len = Math.hypot(dx, dy), max = 52;
        if (len > max) { dx *= max / len; dy *= max / len; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        touchMove.x = dx / max; touchMove.y = -dy / max;
      } else {
        const l = looks.get(t.identifier);
        if (l) {
          const dx = t.clientX - l.x, dy = t.clientY - l.y;
          l.moved += Math.abs(dx) + Math.abs(dy); l.x = t.clientX; l.y = t.clientY;
          input.lookDX += dx * 0.0052; input.lookDY += dy * 0.0052;
        }
      }
    }
  }, { passive: false });
  const end = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) { stickId = -1; touchMove.x = touchMove.y = 0; stick.classList.remove('on'); }
      else {
        const l = looks.get(t.identifier);
        if (l && l.moved < 12 && performance.now() - l.t < 260 && input.enabled()) input.pressed.add('place');
        looks.delete(t.identifier);
      }
    }
  };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
}
const touchMove = { x: 0, y: 0 };
/** Held state for on-screen buttons. */
export const touchHeld = { jump: false, down: false };

export function pollInput() {
  let x = 0, y = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  x += touchMove.x; y += touchMove.y;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  input.moveX = x; input.moveY = y;
  input.jump = keys.has('Space') || touchHeld.jump;
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(touchMove.x, touchMove.y) > 0.95;
  input.down = keys.has('ControlLeft') || touchHeld.down || keys.has('AltLeft');
}
export function endFrameInput() { input.pressed.clear(); input.lookDX = 0; input.lookDY = 0; input.wheel = 0; }
