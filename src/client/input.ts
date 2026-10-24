export type ControlMode = 'keyboard' | 'touch';

export interface Layout {
  /** Tamano de la pantalla en pixeles CSS. */
  w: number;
  h: number;
  /** Margenes seguros (muesca, esquinas redondeadas y barra inferior del iPhone). */
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Geometria de los controles tactiles. Se dibujan en el canvas y se leen con Pointer Events.
 * El joystick vive por defecto abajo a la izquierda, pero es flotante: aparece donde apoyas el
 * pulgar dentro de la mitad izquierda de la pantalla.
 */
export function joystickCircle(l: Layout): Circle {
  const r = clamp(l.h * 0.15, 52, 80);
  return { x: l.l + r + 40, y: l.h - l.b - r - 32, r };
}

export function actionCircle(l: Layout): Circle {
  const r = clamp(l.h * 0.12, 46, 64);
  return { x: l.w - l.r - r - 42, y: l.h - l.b - r - 32, r };
}

/** Los tres objetos forman un arco alrededor del boton de fuego, al alcance del mismo pulgar. */
export function slotCircle(l: Layout, i: number): Circle {
  const a = actionCircle(l);
  const r = clamp(l.h * 0.08, 28, 36);
  const dist = a.r + r + 18;
  const angle = Math.PI + (i * Math.PI) / 4;
  return { x: a.x + Math.cos(angle) * dist, y: a.y + Math.sin(angle) * dist, r };
}

const inCircle = (c: Circle, x: number, y: number, pad = 1): boolean =>
  Math.hypot(x - c.x, y - c.y) <= c.r * pad;

export interface Sample {
  mx: number;
  my: number;
  fire: boolean;
  auto: boolean;
}

/**
 * Teclado y raton en PC, joystick virtual y boton de accion en pantallas tactiles. El modo cambia
 * solo: el primer toque activa los controles tactiles y la primera tecla los oculta.
 */
export class Input {
  mode: ControlMode;
  /** Solo reacciona a teclas y toques mientras hay una partida en curso. */
  active = false;
  layout: Layout = { w: 960, h: 540, l: 0, r: 0, t: 0, b: 0 };
  /** Posicion del raton en pixeles CSS dentro del canvas, o null si no se ha usado. */
  mouse: { x: number; y: number } | null = null;
  /** Posicion del joystick y estado visual de los controles tactiles. */
  stick = { x: 0, y: 0, active: false };
  /** Centro del joystick mientras esta apoyado el pulgar (flotante). */
  private stickOrigin: { x: number; y: number } | null = null;
  actionHeld = false;

  private readonly keys = new Set<string>();
  private mouseDown = false;
  private stickPointer: number | null = null;
  private actionPointer: number | null = null;
  private readonly pendingUse: number[] = [];
  onFirstGesture: () => void = () => undefined;
  onToggleMute: () => void = () => undefined;
  onModeChange: (mode: ControlMode) => void = () => undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
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
    if (typeof window.matchMedia === 'function') {
      window.matchMedia('(pointer: coarse)').addEventListener('change', (e) => {
        if (e.matches) this.setMode('touch');
      });
    }
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

  private setMode(mode: ControlMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'keyboard') this.releaseTouch();
    this.onModeChange(mode);
  }

  private releaseTouch(): void {
    this.stickPointer = null;
    this.stickOrigin = null;
    this.actionPointer = null;
    this.stick = { x: 0, y: 0, active: false };
    this.actionHeld = false;
  }

  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.mouseDown = false;
    this.releaseTouch();
  };

  private static readonly GAME_KEYS = new Set([
    'w',
    'a',
    's',
    'd',
    'arrowup',
    'arrowdown',
    'arrowleft',
    'arrowright',
    ' ',
    '1',
    '2',
    '3',
  ]);

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if (!Input.GAME_KEYS.has(key) && key !== 'm') return;
    this.onFirstGesture();
    if (key === 'm') {
      if (!e.repeat) this.onToggleMute();
      return;
    }
    e.preventDefault();
    this.setMode('keyboard');
    if (!e.repeat && (key === '1' || key === '2' || key === '3')) {
      this.pendingUse.push(Number(key) - 1);
    }
    this.keys.add(key);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onFirstGesture();
    if (!this.active) return;
    const p = this.local(e);
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.setMode('touch');
      e.preventDefault();
      this.canvas.setPointerCapture?.(e.pointerId);
      const L = this.layout;
      const action = actionCircle(L);
      for (let i = 0; i < 3; i++) {
        if (inCircle(slotCircle(L, i), p.x, p.y, 1.35)) {
          this.pendingUse.push(i);
          this.buzz(10);
          return;
        }
      }
      const onAction = inCircle(action, p.x, p.y, 1.7) || (p.x > L.w * 0.6 && p.y > L.h * 0.42);
      if (this.actionPointer === null && onAction) {
        this.actionPointer = e.pointerId;
        this.actionHeld = true;
        this.buzz(8);
      } else if (this.stickPointer === null && p.x < L.w * 0.46 && p.y > L.h * 0.2) {
        this.stickPointer = e.pointerId;
        const base = joystickCircle(L);
        this.stickOrigin = {
          x: clamp(p.x, L.l + base.r + 8, L.w * 0.46),
          y: clamp(p.y, L.h * 0.34, L.h - L.b - base.r - 8),
        };
        this.updateStick(p.x, p.y);
      }
      return;
    }
    this.setMode('keyboard');
    this.mouse = p;
    if (e.button === 0) this.mouseDown = true;
  };

  /** Circulo actual del joystick: donde esta el pulgar, o la esquina cuando esta libre. */
  stickBase(): Circle {
    const base = joystickCircle(this.layout);
    return this.stickOrigin ? { ...base, x: this.stickOrigin.x, y: this.stickOrigin.y } : base;
  }

  private updateStick(x: number, y: number): void {
    const c = this.stickBase();
    let dx = (x - c.x) / c.r;
    let dy = (y - c.y) / c.r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.stick = { x: dx, y: dy, active: true };
  }

  /** Vibracion corta donde el navegador la permite (Android). */
  buzz(ms: number): void {
    if (this.mode === 'touch' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    if (e.pointerType === 'mouse') {
      this.mouse = p;
      return;
    }
    if (e.pointerId === this.stickPointer) this.updateStick(p.x, p.y);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouseDown = false;
      return;
    }
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.stickOrigin = null;
      this.stick = { x: 0, y: 0, active: false };
    }
    if (e.pointerId === this.actionPointer) {
      this.actionPointer = null;
      this.actionHeld = false;
    }
  };

  /** Lee el estado de los controles. Se llama una vez por paso de simulacion (30 Hz). */
  sample(): Sample {
    let mx = 0;
    let my = 0;
    if (this.mode === 'touch') {
      mx = this.stick.x;
      my = this.stick.y;
      // Zona muerta pequena para que el pulgar en reposo no desplace al jugador.
      if (Math.hypot(mx, my) < 0.12) {
        mx = 0;
        my = 0;
      }
    } else {
      if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1;
    }
    const fire = this.mode === 'touch' ? this.actionHeld : this.keys.has(' ') || this.mouseDown;
    return { mx, my, fire, auto: this.mode === 'touch' || this.mouse === null };
  }

  takeUse(): number | null {
    return this.pendingUse.shift() ?? null;
  }
}
