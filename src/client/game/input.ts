import type { ClientBR } from './state';

export type ControlMode = 'keyboard' | 'touch';

export const ACTIONS = [
  'up',
  'down',
  'left',
  'right',
  'interact',
  'bag',
  'map',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
  'fireKey',
  'mute',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Mover arriba',
  down: 'Mover abajo',
  left: 'Mover a la izquierda',
  right: 'Mover a la derecha',
  interact: 'Interactuar (cofres y lápidas)',
  bag: 'Abrir el inventario',
  map: 'Ver el mapa',
  slot1: 'Objeto 1',
  slot2: 'Objeto 2',
  slot3: 'Objeto 3',
  slot4: 'Objeto 4',
  slot5: 'Objeto 5',
  fireKey: 'Disparar (además del clic)',
  mute: 'Silenciar',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  interact: 'KeyE',
  bag: 'KeyI',
  map: 'KeyM',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  slot4: 'Digit4',
  slot5: 'Digit5',
  fireKey: 'Space',
  mute: 'KeyN',
};

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Espacio',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    Tab: 'Tab',
    Enter: 'Enter',
    Backquote: '`',
  };
  return names[code] ?? code;
}

export function loadKeys(): Record<Action, string> {
  try {
    const raw = window.localStorage.getItem('cg_keys');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<Action, string>>;
      const keys = { ...DEFAULT_KEYS };
      for (const a of ACTIONS) if (typeof parsed[a] === 'string') keys[a] = parsed[a] as string;
      return keys;
    }
  } catch {
    // almacenamiento no disponible: se usan las teclas por defecto
  }
  return { ...DEFAULT_KEYS };
}

export function saveKeys(keys: Record<Action, string>): void {
  try {
    window.localStorage.setItem('cg_keys', JSON.stringify(keys));
  } catch {
    // sin almacenamiento
  }
}

// ------------------------------------------------------------------ botones tactiles

export const TOUCH_IDS = ['stick', 'fire', 'interact', 'bag', 'hotbar', 'menu', 'map'] as const;
export type TouchId = (typeof TOUCH_IDS)[number];

export interface TouchSpot {
  /** Centro como fraccion de la pantalla (0 a 1). */
  x: number;
  y: number;
  /** Escala (0.6 a 2). */
  s: number;
}
export type TouchLayout = Record<TouchId, TouchSpot>;

export const TOUCH_LABELS: Record<TouchId, string> = {
  stick: 'Joystick',
  fire: 'Fuego',
  interact: 'Interactuar',
  bag: 'Inventario',
  hotbar: 'Objetos',
  menu: 'Menú',
  map: 'Mapa',
};

export const DEFAULT_TOUCH: TouchLayout = {
  stick: { x: 0.13, y: 0.72, s: 1 },
  fire: { x: 0.88, y: 0.74, s: 1.1 },
  interact: { x: 0.74, y: 0.82, s: 1 },
  bag: { x: 0.94, y: 0.44, s: 0.9 },
  hotbar: { x: 0.5, y: 0.9, s: 1 },
  menu: { x: 0.04, y: 0.1, s: 0.9 },
  map: { x: 0.955, y: 0.3, s: 0.9 },
};

export function loadTouchLayout(): TouchLayout {
  try {
    const raw = window.localStorage.getItem('cg_touch');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TouchLayout>;
      const layout = structuredClone(DEFAULT_TOUCH);
      for (const id of TOUCH_IDS) {
        const p = parsed[id];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.s)) {
          layout[id] = {
            x: Math.min(1, Math.max(0, p.x)),
            y: Math.min(1, Math.max(0, p.y)),
            s: Math.min(2.2, Math.max(0.55, p.s)),
          };
        }
      }
      return layout;
    }
  } catch {
    // almacenamiento no disponible
  }
  return structuredClone(DEFAULT_TOUCH);
}

export function saveTouchLayout(layout: TouchLayout): void {
  try {
    window.localStorage.setItem('cg_touch', JSON.stringify(layout));
  } catch {
    // sin almacenamiento
  }
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Radios base en pixeles CSS; todo crece con la pantalla y con la escala elegida por el jugador. */
export function touchUnit(h: number): number {
  return Math.min(1.7, Math.max(0.8, h / 390));
}

export function touchCircles(
  layout: TouchLayout,
  w: number,
  h: number,
): Record<TouchId, Circle> & { slots: Circle[] } {
  const u = touchUnit(h);
  const c = (id: TouchId, base: number): Circle => ({
    x: layout[id].x * w,
    y: layout[id].y * h,
    r: base * u * layout[id].s,
  });
  const hot = layout.hotbar;
  const slotR = 24 * u * hot.s;
  const gap = slotR * 2.25;
  const slots: Circle[] = Array.from({ length: 5 }, (_, i) => ({
    x: hot.x * w + (i - 2) * gap,
    y: hot.y * h,
    r: slotR,
  }));
  return {
    stick: c('stick', 56),
    fire: c('fire', 46),
    interact: c('interact', 33),
    bag: c('bag', 28),
    hotbar: { x: hot.x * w, y: hot.y * h, r: slotR * 5.6 },
    menu: c('menu', 20),
    map: c('map', 20),
    slots,
  };
}

const inside = (c: Circle, x: number, y: number, pad = 1): boolean =>
  Math.hypot(x - c.x, y - c.y) <= c.r * pad;

export interface Sample {
  mx: number;
  my: number;
  aim: number;
  fire: boolean;
  assist: boolean;
  /** True si el jugador esta apuntando a mano (raton o arrastre del boton de fuego). */
  hasAim: boolean;
}

export interface InputCallbacks {
  onInteract: () => void;
  onBag: () => void;
  onMap: () => void;
  onMenu: () => void;
  onSelect: (slot: number) => void;
  onMute: () => void;
  onFirstGesture: () => void;
  onModeChange: (mode: ControlMode) => void;
}

/**
 * Teclado y raton en PC, y botones tactiles dibujados en el canvas en pantallas tactiles. El modo
 * cambia solo: el primer toque activa los controles tactiles y la primera tecla los oculta.
 */
export class InputController {
  mode: ControlMode;
  active = false;
  keys: Record<Action, string> = loadKeys();
  touchLayout: TouchLayout = loadTouchLayout();
  /** Tamano de la pantalla en pixeles CSS, lo actualiza el renderizador. */
  screen = { w: 960, h: 540 };
  /** Posicion en pantalla (CSS) del gato local, para apuntar con el raton. */
  playerScreen = { x: 480, y: 270 };
  /** Rectangulos de la barra de objetos en pantalla (modo PC), puestos por el renderizador. */
  hotbarRects: { x: number; y: number; w: number; h: number }[] = [];
  mouse: { x: number; y: number } | null = null;
  stick = { x: 0, y: 0, active: false };
  fireHeld = false;
  /** Pulsaciones que se estan sosteniendo, para dibujar los botones presionados. */
  pressed = new Set<TouchId | 'slot'>();
  cb: InputCallbacks;

  private readonly down = new Set<string>();
  private mouseDown = false;
  private clickLatch = false;
  private pointers = new Map<number, { id: TouchId | 'slot'; startX: number; startY: number }>();
  private touchAim: number | null = null;
  private lastFacingAim = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    callbacks: InputCallbacks,
  ) {
    this.cb = callbacks;
    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    this.mode = coarse ? 'touch' : 'keyboard';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMode(mode: ControlMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'keyboard') this.releaseTouch();
    this.cb.onModeChange(mode);
  }

  private releaseTouch(): void {
    this.pointers.clear();
    this.pressed.clear();
    this.stick = { x: 0, y: 0, active: false };
    this.fireHeld = false;
    this.touchAim = null;
  }

  private readonly releaseAll = (): void => {
    this.down.clear();
    this.mouseDown = false;
    this.releaseTouch();
  };

  buzz(ms: number): void {
    if (this.mode === 'touch' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  }

  actionFor(code: string): Action | null {
    for (const a of ACTIONS) if (this.keys[a] === code) return a;
    return null;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Escape') {
      if (!e.repeat) this.cb.onMenu();
      return;
    }
    const action = this.actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    this.cb.onFirstGesture();
    this.setMode('keyboard');
    if (!this.down.has(e.code) && !e.repeat) {
      if (action === 'interact') this.cb.onInteract();
      else if (action === 'bag') this.cb.onBag();
      else if (action === 'map') this.cb.onMap();
      else if (action === 'mute') this.cb.onMute();
      else if (action.startsWith('slot')) this.cb.onSelect(Number(action.slice(4)) - 1);
      else if (action === 'fireKey') this.clickLatch = true;
    }
    this.down.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.cb.onFirstGesture();
    if (!this.active) return;
    const p = this.local(e);
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.setMode('touch');
      e.preventDefault();
      this.canvas.setPointerCapture?.(e.pointerId);
      this.touchDown(e.pointerId, p.x, p.y);
      return;
    }
    this.setMode('keyboard');
    this.mouse = p;
    if (e.button !== 0) return;
    const slot = this.hotbarRects.findIndex(
      (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
    );
    if (slot >= 0) {
      this.cb.onSelect(slot);
      return;
    }
    this.mouseDown = true;
    this.clickLatch = true;
  };

  private touchDown(id: number, x: number, y: number): void {
    const { w, h } = this.screen;
    const circles = touchCircles(this.touchLayout, w, h);
    for (let i = 0; i < 5; i++) {
      if (inside(circles.slots[i] as Circle, x, y, 1.15)) {
        this.cb.onSelect(i);
        this.buzz(8);
        return;
      }
    }
    const tap = (tid: TouchId, fn: () => void): boolean => {
      if (!inside(circles[tid], x, y, 1.2)) return false;
      fn();
      this.pressed.add(tid);
      this.pointers.set(id, { id: tid, startX: x, startY: y });
      this.buzz(8);
      return true;
    };
    if (tap('interact', this.cb.onInteract)) return;
    if (tap('bag', this.cb.onBag)) return;
    if (tap('menu', this.cb.onMenu)) return;
    if (tap('map', this.cb.onMap)) return;
    if (inside(circles.fire, x, y, 1.5) || (x > w * 0.62 && y > h * 0.35 && y < h * 0.8)) {
      this.pointers.set(id, { id: 'fire', startX: circles.fire.x, startY: circles.fire.y });
      this.pressed.add('fire');
      this.fireHeld = true;
      this.clickLatch = true;
      this.touchAim = null;
      this.buzz(8);
      return;
    }
    if (inside(circles.stick, x, y, 2.1) || x < w * 0.42) {
      this.pointers.set(id, { id: 'stick', startX: circles.stick.x, startY: circles.stick.y });
      this.pressed.add('stick');
      this.moveStick(x, y);
    }
  }

  private moveStick(x: number, y: number): void {
    const c = touchCircles(this.touchLayout, this.screen.w, this.screen.h).stick;
    let dx = (x - c.x) / c.r;
    let dy = (y - c.y) / c.r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.stick = { x: dx, y: dy, active: true };
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    if (e.pointerType === 'mouse') {
      this.mouse = p;
      return;
    }
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    if (ptr.id === 'stick') this.moveStick(p.x, p.y);
    else if (ptr.id === 'fire') {
      const dx = p.x - ptr.startX;
      const dy = p.y - ptr.startY;
      // Arrastrar el boton de fuego apunta a mano; sin arrastrar, la ayuda de apuntado elige el blanco.
      this.touchAim = Math.hypot(dx, dy) > 16 ? Math.atan2(dy, dx) : null;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouseDown = false;
      return;
    }
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    this.pressed.delete(ptr.id);
    if (ptr.id === 'stick') this.stick = { x: 0, y: 0, active: false };
    if (ptr.id === 'fire') {
      this.fireHeld = false;
      this.touchAim = null;
    }
  };

  /** Lee el estado de los controles. Se llama una vez por paso de simulacion (30 Hz). */
  sample(game: ClientBR): Sample {
    let mx = 0;
    let my = 0;
    let fire: boolean;
    let assist = false;
    let hasAim = false;
    let aim = this.lastFacingAim;

    if (this.mode === 'touch') {
      mx = this.stick.x;
      my = this.stick.y;
      if (Math.hypot(mx, my) < 0.12) {
        mx = 0;
        my = 0;
      }
      fire = this.fireHeld || this.clickLatch;
      if (this.touchAim !== null) {
        aim = this.touchAim;
        hasAim = true;
      } else {
        assist = true;
        if (Math.hypot(mx, my) > 0.2) aim = Math.atan2(my, mx);
        else aim = game.facing === 1 ? 0 : Math.PI;
      }
    } else {
      const d = (a: Action): boolean => this.down.has(this.keys[a]);
      if (d('left')) mx -= 1;
      if (d('right')) mx += 1;
      if (d('up')) my -= 1;
      if (d('down')) my += 1;
      fire = this.mouseDown || d('fireKey') || this.clickLatch;
      if (this.mouse) {
        aim = Math.atan2(this.mouse.y - this.playerScreen.y, this.mouse.x - this.playerScreen.x);
        hasAim = true;
      } else if (mx !== 0 || my !== 0) {
        aim = Math.atan2(my, mx);
      }
    }
    this.clickLatch = false;
    this.lastFacingAim = aim;
    return { mx, my, aim, fire, assist, hasAim };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }
}
