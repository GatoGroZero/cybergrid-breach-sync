import { CHANNELS, CHANNEL_LABELS, DEFAULT_VOLUMES, type Channel, type Sfx } from '../audio';
import {
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_KEYS,
  DEFAULT_TOUCH,
  TOUCH_LABELS,
  keyLabel,
  saveFireMode,
  saveKeys,
  saveTouchLayout,
  touchAlpha,
  touchCircles,
  TOUCH_MIN_ALPHA,
  type Action,
  type Circle,
  type InputController,
  type TouchId,
  type TouchLayout,
  type TouchSpot,
} from '../game/input';
import {
  HUD_KEYS,
  HUD_LABELS,
  HUD_DEFAULTS,
  HUD_MAX,
  HUD_MIN,
  hudPrefs,
  saveHudPrefs,
} from '../game/hudprefs';
import { drawTouchControls } from '../game/touchui';
import { $, el } from './dom';

type Tab = 'keys' | 'touch' | 'sound' | 'ui';

/** Ajustes: reasignar teclas, mover y cambiar el tamano de los botones tactiles, y el sonido. */
export class Settings {
  private readonly root = $('settings');
  private listening: Action | null = null;
  private returnTo: HTMLElement | null = null;
  onClose: () => void = () => undefined;

  private readonly editor = $('touch-editor');
  private readonly canvas = $<HTMLCanvasElement>('editor-canvas');
  private draft: TouchLayout = structuredClone(DEFAULT_TOUCH);
  private selected: TouchId | null = null;
  private dragging: { id: TouchId; dx: number; dy: number } | null = null;
  private raf = 0;

  constructor(
    private readonly input: InputController,
    private readonly sfx: Sfx,
    private readonly bagIcon?: HTMLCanvasElement,
    private readonly emoteIcon?: HTMLCanvasElement,
  ) {
    for (const tab of ['keys', 'touch', 'sound', 'ui'] as const) {
      $(`set-tab-${tab}`).addEventListener('click', () => this.showTab(tab));
    }
    $('settings-close').addEventListener('click', () => this.close());
    $('keys-reset').addEventListener('click', () => {
      this.input.keys = { ...DEFAULT_KEYS };
      saveKeys(this.input.keys);
      this.renderKeys();
    });
    const sound = $<HTMLInputElement>('sound-toggle');
    sound.checked = !sfx.muted;
    sound.addEventListener('change', () => this.sfx.setMuted(!sound.checked));
    this.buildVolumes();
    this.buildHudPrefs();
    $('volume-reset').addEventListener('click', () => {
      for (const key of Object.keys(DEFAULT_VOLUMES) as (Channel | 'master')[])
        this.sfx.setVolume(key, DEFAULT_VOLUMES[key]);
      this.syncVolumes();
    });
    this.syncFireMode();
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#fire-mode button')) {
      btn.addEventListener('click', () => {
        this.input.fireMode = btn.dataset.mode === 'target' ? 'target' : 'aim';
        saveFireMode(this.input.fireMode);
        this.syncFireMode();
      });
    }
    $('touch-edit').addEventListener('click', () => this.openEditor());
    $('touch-reset').addEventListener('click', () => {
      this.input.touchLayout = structuredClone(DEFAULT_TOUCH);
      saveTouchLayout(this.input.touchLayout);
    });
    window.addEventListener('keydown', this.onKey, true);

    $('editor-plus').addEventListener('click', () => this.scale(0.1));
    $('editor-minus').addEventListener('click', () => this.scale(-0.1));
    $('editor-reset').addEventListener('click', () => {
      this.draft = structuredClone(DEFAULT_TOUCH);
    });
    const alpha = $<HTMLInputElement>('editor-alpha');
    alpha.min = String(Math.round(TOUCH_MIN_ALPHA * 100));
    alpha.addEventListener('input', () => {
      if (!this.selected) return;
      this.draft[this.selected].a = Number(alpha.value) / 100;
    });
    $('editor-alpha-all').addEventListener('click', () => {
      if (!this.selected) return;
      const a = touchAlpha(this.draft[this.selected]);
      for (const id of Object.keys(this.draft) as TouchId[]) this.draft[id].a = a;
    });
    $('editor-cancel').addEventListener('click', () => this.closeEditor(false));
    $('editor-save').addEventListener('click', () => this.closeEditor(true));
    this.canvas.addEventListener('pointerdown', this.onEditorDown);
    this.canvas.addEventListener('pointermove', this.onEditorMove);
    this.canvas.addEventListener('pointerup', this.onEditorUp);
    this.canvas.addEventListener('pointercancel', this.onEditorUp);
    window.addEventListener('resize', () => this.editor.hidden || this.fitEditor());
  }

  get isOpen(): boolean {
    return !this.root.hidden || !this.editor.hidden;
  }

  open(tab: Tab = 'keys'): void {
    this.returnTo = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    ($('sound-toggle') as HTMLInputElement).checked = !this.sfx.muted;
    this.syncVolumes();
    this.showTab(tab);
    $('settings-close').focus({ preventScroll: true });
  }

  close(): void {
    this.listening = null;
    this.root.hidden = true;
    this.returnTo?.focus?.({ preventScroll: true });
    this.onClose();
  }

  /** Un control deslizante por cada canal del mezclador, con un sonido de muestra al soltarlo. */
  private buildVolumes(): void {
    const list = $('volume-list');
    const rows: [Channel | 'master', string][] = [
      ['master', 'Volumen general'],
      ...CHANNELS.map((c): [Channel, string] => [c, CHANNEL_LABELS[c]]),
    ];
    for (const [key, label] of rows) {
      const row = el('label', 'volume');
      const name = el('span', '', label);
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '5';
      range.dataset.channel = key;
      range.setAttribute('data-testid', `volume-${key}`);
      range.setAttribute('aria-label', label);
      const out = el('output', '', '');
      range.addEventListener('input', () => {
        this.sfx.setVolume(key, Number(range.value) / 100);
        out.textContent = `${range.value}%`;
      });
      range.addEventListener('change', () => this.sfx.preview(key));
      row.append(name, range, out);
      list.append(row);
    }
    this.syncVolumes();
  }

  private syncVolumes(): void {
    for (const range of document.querySelectorAll<HTMLInputElement>('#volume-list input')) {
      const key = range.dataset.channel as Channel | 'master';
      range.value = String(Math.round(this.sfx.volumes[key] * 100));
      const out = range.parentElement?.querySelector('output');
      if (out) out.textContent = `${range.value}%`;
    }
  }

  /** Marca el modo de disparo elegido y explica que hace. */
  private syncFireMode(): void {
    const mode = this.input.fireMode;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#fire-mode button'))
      btn.setAttribute('aria-checked', String(btn.dataset.mode === mode));
    $('fire-mode-help').textContent =
      mode === 'target'
        ? 'La línea de mira te sigue, pero el arma solo dispara cuando la línea toca a un gato o a un muro colocado. Mientras no toque nada, no gastas balas.'
        : 'El arma dispara sola mientras la línea de mira está a la vista.';
  }

  /** Un deslizador por cada parte del HUD: el cambio se ve de inmediato y se guarda solo. */
  private buildHudPrefs(): void {
    const list = $('ui-list');
    const sliders: [keyof typeof hudPrefs, HTMLInputElement, HTMLElement][] = [];
    for (const key of HUD_KEYS) {
      const label = HUD_LABELS[key];
      const row = el('label', 'volume');
      const name = el('span', '', label);
      const range = el('input');
      range.type = 'range';
      range.min = String(Math.round(HUD_MIN * 100));
      range.max = String(Math.round(HUD_MAX * 100));
      range.step = '5';
      range.setAttribute('data-testid', `ui-${key}`);
      range.setAttribute('aria-label', label);
      const out = el('output', '', '');
      range.addEventListener('input', () => {
        hudPrefs[key] = Number(range.value) / 100;
        out.textContent = `${range.value}%`;
        saveHudPrefs(hudPrefs);
      });
      row.append(name, range, out);
      list.append(row);
      sliders.push([key, range, out]);
    }
    const sync = (): void => {
      for (const [key, range, out] of sliders) {
        range.value = String(Math.round(hudPrefs[key] * 100));
        out.textContent = `${range.value}%`;
      }
    };
    sync();
    this.syncHudPrefs = sync;
    $('ui-reset').addEventListener('click', () => {
      Object.assign(hudPrefs, HUD_DEFAULTS);
      saveHudPrefs(hudPrefs);
      sync();
    });
  }

  private syncHudPrefs: () => void = () => undefined;

  private showTab(tab: Tab): void {
    // en "Pantalla" el fondo se aclara: asi se ve el HUD cambiar mientras se mueve cada control
    this.root.classList.toggle('soft', tab === 'ui');
    for (const t of ['keys', 'touch', 'sound', 'ui'] as const) {
      const on = t === tab;
      $(`set-tab-${t}`).classList.toggle('is-active', on);
      $(`set-tab-${t}`).setAttribute('aria-selected', String(on));
      $(`set-${t}`).hidden = !on;
    }
    if (tab === 'keys') this.renderKeys();
    if (tab === 'ui') this.syncHudPrefs();
  }

  // ------------------------------------------------------------------ teclas

  private renderKeys(): void {
    const list = $('key-list');
    list.replaceChildren();
    for (const action of ACTIONS) {
      const li = el('li');
      li.append(el('span', '', ACTION_LABELS[action]));
      const b = el(
        'button',
        this.listening === action ? 'listening' : '',
        this.listening === action ? 'Pulsa una tecla' : keyLabel(this.input.keys[action]),
      );
      b.type = 'button';
      b.dataset.action = action;
      b.addEventListener('click', () => {
        this.listening = this.listening === action ? null : action;
        this.renderKeys();
      });
      li.append(b);
      list.append(li);
    }
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.listening) return;
    e.preventDefault();
    e.stopPropagation();
    const action = this.listening;
    this.listening = null;
    if (e.code !== 'Escape') {
      const previous = this.input.keys[action];
      const clash = ACTIONS.find((a) => a !== action && this.input.keys[a] === e.code);
      if (clash) this.input.keys[clash] = previous;
      this.input.keys[action] = e.code;
      saveKeys(this.input.keys);
    }
    this.renderKeys();
  };

  // ------------------------------------------------------------------ editor tactil

  private openEditor(): void {
    this.draft = structuredClone(this.input.touchLayout);
    this.selected = null;
    this.root.hidden = true;
    this.editor.hidden = false;
    this.fitEditor();
    const tick = (): void => {
      if (this.editor.hidden) return;
      this.drawEditor();
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  private closeEditor(save: boolean): void {
    if (save) {
      this.input.touchLayout = structuredClone(this.draft);
      saveTouchLayout(this.input.touchLayout);
    }
    this.editor.hidden = true;
    cancelAnimationFrame(this.raf);
    this.root.hidden = false;
    this.showTab('touch');
  }

  private fitEditor(): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  private dims(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  private drawEditor(): void {
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const dpr = this.canvas.width / window.innerWidth;
    const { w, h } = this.dims();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawTouchControls(ctx, this.draft, w, h, {
      stick: { x: 0, y: 0, active: false },
      pressed: new Set(),
      selected: this.selected,
      editing: true,
      bagIcon: this.bagIcon,
      emoteIcon: this.emoteIcon,
    });
    const sel = this.selected ? this.draft[this.selected] : null;
    $('editor-sel').textContent = this.selected
      ? `${TOUCH_LABELS[this.selected]} x${(sel as TouchSpot).s.toFixed(1)}`
      : 'Toca un botón';
    const alpha = $<HTMLInputElement>('editor-alpha');
    alpha.disabled = !sel;
    if (sel && document.activeElement !== alpha)
      alpha.value = String(Math.round(touchAlpha(sel) * 100));
    $('editor-alpha-out').textContent = `${sel ? Math.round(touchAlpha(sel) * 100) : 100}%`;
  }

  private hit(x: number, y: number): TouchId | null {
    const { w, h } = this.dims();
    const c = touchCircles(this.draft, w, h);
    const inside = (k: Circle, pad = 1): boolean => Math.hypot(x - k.x, y - k.y) <= k.r * pad;
    const order: TouchId[] = ['aim', 'interact', 'bag', 'menu', 'map', 'stick'];
    for (const id of order) if (inside(c[id], 1.1)) return id;
    const slots = c.slots;
    const first = slots[0] as Circle;
    const last = slots[slots.length - 1] as Circle;
    if (x >= first.x - first.r && x <= last.x + last.r && Math.abs(y - first.y) <= first.r * 1.2)
      return 'hotbar';
    return null;
  }

  private readonly onEditorDown = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const id = this.hit(x, y);
    this.selected = id;
    if (!id) return;
    this.canvas.setPointerCapture(e.pointerId);
    const { w, h } = this.dims();
    this.dragging = { id, dx: x - this.draft[id].x * w, dy: y - this.draft[id].y * h };
  };

  private readonly onEditorMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const r = this.canvas.getBoundingClientRect();
    const { w, h } = this.dims();
    const d = this.dragging;
    const spot = this.draft[d.id];
    spot.x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left - d.dx) / w));
    spot.y = Math.min(0.97, Math.max(0.04, (e.clientY - r.top - d.dy) / h));
  };

  private readonly onEditorUp = (): void => {
    this.dragging = null;
  };

  private scale(delta: number): void {
    if (!this.selected) return;
    const s = this.draft[this.selected];
    s.s = Math.min(2.2, Math.max(0.55, Math.round((s.s + delta) * 10) / 10));
  }
}
