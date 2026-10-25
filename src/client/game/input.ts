import { isWeapon } from '../../shared/br/items';
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
  'run',
  'mute',
  'emote',
  'reload',
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
  run: 'Correr (mantener)',
  mute: 'Silenciar',
  emote: 'Abrir los emotes',
  reload: 'Recargar el arma',
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
  run: 'ShiftLeft',
  mute: 'KeyN',
  emote: 'KeyT',
  reload: 'KeyR',
};

/** Las flechas siempre mueven al gato, ademas de las teclas que cada jugador elija. */
export const ARROW_ALIASES: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const ARROW_FOR: Partial<Record<Action, string>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
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

export const TOUCH_IDS = [
  'stick',
  'aim',
  'interact',
  'bag',
  'hotbar',
  'menu',
  'map',
  'emote',
  'reload',
] as const;
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
  aim: 'Mira y disparo',
  interact: 'Interactuar',
  bag: 'Inventario',
  hotbar: 'Objetos',
  menu: 'Menú',
  map: 'Mapa',
  emote: 'Emotes',
  reload: 'Recargar',
};

export const DEFAULT_TOUCH: TouchLayout = {
  stick: { x: 0.13, y: 0.72, s: 1 },
  aim: { x: 0.87, y: 0.7, s: 1.05 },
  interact: { x: 0.745, y: 0.85, s: 1 },
  bag: { x: 0.94, y: 0.44, s: 0.9 },
  hotbar: { x: 0.5, y: 0.9, s: 1 },
  menu: { x: 0.04, y: 0.1, s: 0.9 },
  map: { x: 0.955, y: 0.3, s: 0.9 },
  emote: { x: 0.04, y: 0.5, s: 0.85 },
  reload: { x: 0.74, y: 0.62, s: 0.8 },
};

export function loadTouchLayout(): TouchLayout {
  try {
    const raw = window.localStorage.getItem('cg_touch');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TouchLayout> & { fire?: TouchSpot };
      // Versiones anteriores tenian un boton FUEGO: su lugar pasa a la mira.
      if (!parsed.aim && parsed.fire) parsed.aim = parsed.fire;
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

export type FireMode = 'aim' | 'target';

export function loadFireMode(): FireMode {
  try {
    return window.localStorage.getItem('cg_fire_mode') === 'target' ? 'target' : 'aim';
  } catch {
    return 'aim';
  }
}

export function saveFireMode(mode: FireMode): void {
  try {
    window.localStorage.setItem('cg_fire_mode', mode);
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
    aim: c('aim', 52),
    interact: c('interact', 33),
    bag: c('bag', 28),
    hotbar: { x: hot.x * w, y: hot.y * h, r: slotR * 5.6 },
    menu: c('menu', 20),
    map: c('map', 20),
    emote: c('emote', 24),
    reload: c('reload', 24),
    slots,
  };
}

/** Fraccion del radio de la mira que se ignora al principio. */
export const AIM_DEADZONE = 0.2;

const inside = (c: Circle, x: number, y: number, pad = 1): boolean =>
  Math.hypot(x - c.x, y - c.y) <= c.r * pad;

export interface Sample {
  mx: number;
  my: number;
  aim: number;
  fire: boolean;
  /** Mantener el disparo (joystick de la mira): las armas de un clic repiten solas. */
  hold: boolean;
  run: boolean;
  /** True si el jugador esta apuntando a mano (raton o joystick de la mira). */
  hasAim: boolean;
}

/** Estado del joystick de la mira (movil), para dibujarlo. */
export interface AimPad {
  active: boolean;
  /** Posicion de la perilla, de -1 a 1. */
  x: number;
  y: number;
  /** Ya se arrastro mas alla de la zona muerta: hay linea de mira y se dispara. */
  aiming: boolean;
}

export interface InputCallbacks {
  onInteract: () => void;
  onBag: () => void;
  onMap: () => void;
  onMenu: () => void;
  onSelect: (slot: number) => void;
  onMute: () => void;
  /** Recargar el arma en mano. */
  onReload: () => void;
  /** Mando el emote `kind` (0 a 4). */
  onEmote: (kind: number) => void;
  /** Elegi el kit numero `index` (0 a 3) en la pantalla de eleccion de la ronda. */
  onKit: (index: number) => void;
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
  /**
   * Como dispara el joystick de la mira en el movil: `aim` dispara mientras se ve la linea y
   * `target` solo cuando la linea toca a un gato o a un muro colocado.
   */
  fireMode: FireMode = loadFireMode();
  /** La mira (movil) esta tocando un objetivo en este momento: se usa para dibujar la guia. */
  aimLocked = false;
  /** La barra de emotes esta abierta; el renderizador pone aqui sus botones mientras lo este. */
  emoteOpen = false;
  emoteRects: { x: number; y: number; w: number; h: number }[] = [];
  /** Tarjetas de la eleccion de kit (solo mientras se elige). */
  kitRects: { x: number; y: number; w: number; h: number }[] = [];
  mouse: { x: number; y: number } | null = null;
  stick = { x: 0, y: 0, active: false };
  aimPad: AimPad = { active: false, x: 0, y: 0, aiming: false };
  /** Pulsaciones que se estan sosteniendo, para dibujar los botones presionados. */
  pressed = new Set<TouchId | 'slot'>();
  cb: InputCallbacks;

  private readonly down = new Set<string>();
  private mouseDown = false;
  private clickLatch = false;
  private pointers = new Map<number, { id: TouchId | 'slot'; startX: number; startY: number }>();
  private aimAngle: number | null = null;
  private aimStartAt = 0;
  private aimDragged = false;
  /** Toque corto en la mira: usa curas, ataca con garras o pone un muro al frente. */
  private tapLatch = false;
  /** Al soltar la mira tras arrastrar: angulo en el que se coloca el muro. */
  private releaseLatch: number | null = null;
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
    this.aimPad = { active: false, x: 0, y: 0, aiming: false };
    this.aimAngle = null;
    this.aimDragged = false;
    this.tapLatch = false;
    this.releaseLatch = null;
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
    return ARROW_ALIASES[code] ?? null;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Escape') {
      if (this.emoteOpen) this.emoteOpen = false;
      else if (!e.repeat) this.cb.onMenu();
      return;
    }
    const action = this.actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    this.cb.onFirstGesture();
    this.setMode('keyboard');
    if (this.emoteOpen) {
      // Con la barra abierta, los numeros eligen emote en vez de objeto.
      if (!e.repeat && action.startsWith('slot')) this.pickEmote(Number(action.slice(4)) - 1);
      else if (!e.repeat && action === 'emote') this.emoteOpen = false;
      return;
    }
    if (!this.down.has(e.code) && !e.repeat) {
      if (action === 'emote') this.emoteOpen = true;
      else if (action === 'interact') this.cb.onInteract();
      else if (action === 'bag') this.cb.onBag();
      else if (action === 'map') this.cb.onMap();
      else if (action === 'mute') this.cb.onMute();
      else if (action === 'reload') this.cb.onReload();
      else if (action.startsWith('slot')) this.cb.onSelect(Number(action.slice(4)) - 1);
      else if (action === 'fireKey') this.clickLatch = true;
    }
    this.down.add(e.code);
  };

  /** Elige un emote de la barra: lo manda y la cierra. */
  private pickEmote(kind: number): void {
    this.emoteOpen = false;
    if (kind >= 0 && kind < this.emoteRects.length) this.cb.onEmote(kind);
  }

  /** Si se esta eligiendo kit, el toque o clic sobre una tarjeta lo elige. */
  private kitPress(x: number, y: number): boolean {
    if (this.kitRects.length === 0) return false;
    const i = this.kitRects.findIndex(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    );
    if (i >= 0) this.cb.onKit(i);
    return true;
  }

  /** Si hay una barra de emotes abierta, atiende el toque. Devuelve true si lo uso. */
  private emotePress(x: number, y: number): boolean {
    if (!this.emoteOpen) return false;
    const i = this.emoteRects.findIndex(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    );
    if (i >= 0) this.pickEmote(i);
    else this.emoteOpen = false;
    return true;
  }

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
    if (this.kitPress(p.x, p.y)) return;
    if (this.emotePress(p.x, p.y)) return;
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
    if (this.kitPress(x, y)) return;
    if (this.emotePress(x, y)) return;
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
    if (tap('emote', () => (this.emoteOpen = true))) return;
    if (tap('reload', this.cb.onReload)) return;
    if (inside(circles.aim, x, y, 1.6) || (x > w * 0.6 && y > h * 0.3 && y < h * 0.97)) {
      this.pointers.set(id, { id: 'aim', startX: circles.aim.x, startY: circles.aim.y });
      this.pressed.add('aim');
      this.aimStartAt = performance.now();
      this.aimDragged = false;
      this.aimAngle = null;
      this.aimPad = { active: true, x: 0, y: 0, aiming: false };
      this.updateAim(x, y);
      this.buzz(8);
      return;
    }
    if (inside(circles.stick, x, y, 2.1) || x < w * 0.42) {
      this.pointers.set(id, { id: 'stick', startX: circles.stick.x, startY: circles.stick.y });
      this.pressed.add('stick');
      this.moveStick(x, y);
    }
  }

  /** Mueve la perilla de la mira. Pasada la zona muerta se ve la linea y el gato dispara. */
  private updateAim(x: number, y: number): void {
    const c = touchCircles(this.touchLayout, this.screen.w, this.screen.h).aim;
    let dx = (x - c.x) / c.r;
    let dy = (y - c.y) / c.r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    if (len > AIM_DEADZONE) {
      this.aimAngle = Math.atan2(dy, dx);
      this.aimDragged = true;
    } else {
      this.aimAngle = null;
    }
    this.aimPad = { active: true, x: dx, y: dy, aiming: this.aimAngle !== null };
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
    else if (ptr.id === 'aim') this.updateAim(p.x, p.y);
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
    if (ptr.id === 'aim') {
      if (this.aimAngle !== null) this.releaseLatch = this.aimAngle;
      else if (!this.aimDragged && performance.now() - this.aimStartAt < 400) this.tapLatch = true;
      this.aimAngle = null;
      this.aimDragged = false;
      this.aimPad = { active: false, x: 0, y: 0, aiming: false };
    }
  };

  /** Angulo de la mira en este momento, o null si el jugador no esta apuntando (para dibujar guias). */
  currentAim(): number | null {
    if (this.mode === 'touch') return this.aimAngle;
    if (!this.mouse) return null;
    return Math.atan2(this.mouse.y - this.playerScreen.y, this.mouse.x - this.playerScreen.x);
  }

  /** Lee el estado de los controles. Se llama una vez por paso de simulacion (30 Hz). */
  sample(game: ClientBR): Sample {
    let mx = 0;
    let my = 0;
    let fire: boolean;
    let hold = false;
    let run: boolean;
    let hasAim = false;
    let aim = this.lastFacingAim;

    if (this.mode === 'touch') {
      mx = this.stick.x;
      my = this.stick.y;
      const len = Math.hypot(mx, my);
      if (len < 0.12) {
        mx = 0;
        my = 0;
      }
      // Empujar el joystick hasta el borde es correr.
      run = len >= 0.9;
      const kind = game.selectedItem?.kind ?? null;
      const aimActive = this.aimAngle !== null;
      const facing = len > 0.2 ? Math.atan2(my, mx) : game.facing === 1 ? 0 : Math.PI;
      this.aimLocked = false;
      if (kind === null || isWeapon(kind)) {
        // Armas y garras: se dispara mientras la linea de mira esta a la vista o, si asi se
        // eligio, solo cuando esa linea toca a un gato o a un muro colocado.
        const locked =
          aimActive && (this.fireMode === 'aim' || game.aimLocked(this.aimAngle as number));
        this.aimLocked = this.fireMode === 'target' && locked;
        fire = locked || (kind === null && this.tapLatch);
        hold = locked;
      } else if (kind === 'wall') {
        // El muro se coloca al soltar la mira, donde mostraba la guia.
        fire = this.releaseLatch !== null || this.tapLatch;
      } else {
        fire = this.tapLatch;
      }
      if (aimActive) {
        aim = this.aimAngle as number;
        hasAim = true;
      } else if (this.releaseLatch !== null) {
        aim = this.releaseLatch;
      } else {
        aim = facing;
      }
    } else {
      const d = (a: Action): boolean => {
        const alias = ARROW_FOR[a];
        return this.down.has(this.keys[a]) || (alias !== undefined && this.down.has(alias));
      };
      if (d('left')) mx -= 1;
      if (d('right')) mx += 1;
      if (d('up')) my -= 1;
      if (d('down')) my += 1;
      run = d('run') || this.down.has('ShiftRight');
      fire = this.mouseDown || d('fireKey') || this.clickLatch;
      if (this.mouse) {
        aim = Math.atan2(this.mouse.y - this.playerScreen.y, this.mouse.x - this.playerScreen.x);
        hasAim = true;
      } else if (mx !== 0 || my !== 0) {
        aim = Math.atan2(my, mx);
      }
    }
    this.clickLatch = false;
    this.tapLatch = false;
    this.releaseLatch = null;
    this.lastFacingAim = aim;
    return { mx, my, aim, fire, hold, run, hasAim };
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
