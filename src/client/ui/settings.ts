import type { Sfx } from '../audio';
import {
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_KEYS,
  DEFAULT_TOUCH,
  TOUCH_LABELS,
  keyLabel,
  saveKeys,
  saveTouchLayout,
  touchCircles,
  type Action,
  type Circle,
  type InputController,
  type TouchId,
  type TouchLayout,
} from '../game/input';
import { drawTouchControls } from '../game/touchui';
import { $, el } from './dom';

type Tab = 'keys' | 'touch' | 'sound';

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
  ) {
    for (const tab of ['keys', 'touch', 'sound'] as const) {
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
    this.showTab(tab);
    $('settings-close').focus({ preventScroll: true });
  }

  close(): void {
    this.listening = null;
    this.root.hidden = true;
    this.returnTo?.focus?.({ preventScroll: true });
    this.onClose();
  }

  private showTab(tab: Tab): void {
    for (const t of ['keys', 'touch', 'sound'] as const) {
      const on = t === tab;
      $(`set-tab-${t}`).classList.toggle('is-active', on);
      $(`set-tab-${t}`).setAttribute('aria-selected', String(on));
      $(`set-${t}`).hidden = !on;
    }
    if (tab === 'keys') this.renderKeys();
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
    });
    $('editor-sel').textContent = this.selected
      ? `${TOUCH_LABELS[this.selected]} x${this.draft[this.selected].s.toFixed(1)}`
      : 'Toca un botón';
  }

  private hit(x: number, y: number): TouchId | null {
    const { w, h } = this.dims();
    const c = touchCircles(this.draft, w, h);
    const inside = (k: Circle, pad = 1): boolean => Math.hypot(x - k.x, y - k.y) <= k.r * pad;
    const order: TouchId[] = ['fire', 'interact', 'bag', 'menu', 'map', 'stick'];
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
