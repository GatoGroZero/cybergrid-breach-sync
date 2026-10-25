import { SKIN_H, SKIN_W } from '../../shared/br/constants';
import { OUTFITS } from '../../shared/br/outfits';
import { createRng } from '../../shared/rng';
import {
  BASE_COATS,
  EMPTY_PAINT,
  PAINT_NAMES,
  PAINT_PALETTE,
  defaultSkin,
  isValidSkin,
  outfitOf,
  paintCells,
  paintIndex,
  randomSkin,
  type Skin,
} from '../../shared/br/skin';
import {
  CAT_H,
  CAT_PAD,
  CAT_W,
  catSprites,
  isPaintable,
  pixelColor,
  roleAt,
  ROLE,
} from '../pixel/cat';
import { $, el } from './dom';

const SCALE = 12;
const STORAGE_KEY = 'cg_skin';

export function loadSavedSkin(): Skin {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isValidSkin(parsed)) return parsed;
    }
  } catch {
    // sin almacenamiento: se usa el gato por defecto
  }
  return defaultSkin(0);
}

function saveSkin(skin: Skin): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    // sin almacenamiento
  }
}

/** Gato caminando en un lienzo pequeno. Devuelve la funcion que lo detiene. */
export function startWalker(
  canvas: HTMLCanvasElement,
  getSkin: () => Skin,
  scale: number,
  flip = false,
): () => void {
  canvas.width = CAT_W * scale;
  canvas.height = CAT_H * scale;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const order = [1, 0, 2, 0];
  let i = 0;
  const draw = (): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sprites = catSprites(getSkin());
    const set = flip ? sprites.left : sprites.right;
    const frame = set[order[i % order.length] as number] as HTMLCanvasElement;
    ctx.drawImage(frame, 0, 0, CAT_W * scale, CAT_H * scale);
  };
  draw();
  const timer = window.setInterval(() => {
    i++;
    if (!canvas.isConnected || canvas.offsetParent === null) return;
    draw();
  }, 170);
  return () => window.clearInterval(timer);
}

/** Vista fija de un gato (marco quieto) para listas. */
export function drawCatIcon(canvas: HTMLCanvasElement, skin: Skin, scale: number): void {
  canvas.width = CAT_W * scale;
  canvas.height = CAT_H * scale;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(catSprites(skin).right[0] as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
}

/** Editor de pelaje: cuadricula de 24 x 16, pincel de 1 a 3, colores, rayas y manchas. */
export class Painter {
  skin: Skin;
  onChange: (skin: Skin) => void = () => undefined;

  private readonly canvas = $<HTMLCanvasElement>('paint-canvas');
  private readonly ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  private color = 6;
  private brush = 1;
  private down = false;
  private last: { x: number; y: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private saveTimer: number | null = null;

  constructor() {
    this.skin = loadSavedSkin();
    this.buildCoats();
    this.buildOutfits();
    this.buildPalette();
    this.buildBrushes();
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.render();
    });
    $('paint-stripes').addEventListener('click', () => this.stripes());
    $('paint-spots').addEventListener('click', () => this.spots());
    $('paint-random').addEventListener('click', () => this.randomize());
    $('paint-clear').addEventListener('click', () =>
      this.apply({ ...this.skin, paint: EMPTY_PAINT }),
    );
    startWalker($<HTMLCanvasElement>('paint-walk'), () => this.skin, 3);
    this.render();
  }

  private buildCoats(): void {
    const box = $('coats');
    box.replaceChildren();
    BASE_COATS.forEach((c, i) => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Pelaje ${c.name}`);
      b.title = c.name;
      b.style.backgroundColor = c.color;
      b.addEventListener('click', () => this.apply({ ...this.skin, base: i }));
      box.append(b);
    });
  }

  /** Los trajes de Halloween: cada boton muestra al gato con ese traje puesto. */
  private buildOutfits(): void {
    const box = $('outfits');
    box.replaceChildren();
    const names = ['Sin traje', ...OUTFITS.map((o) => o.name)];
    names.forEach((name, i) => {
      const b = el('button', 'outfit');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Traje: ${name}`);
      b.dataset.outfit = String(i);
      b.title = i === 0 ? name : `${name}: ${OUTFITS[i - 1]?.blurb ?? ''}`;
      b.append(el('canvas'), el('span', '', name));
      b.addEventListener('click', () => this.apply({ ...this.skin, outfit: i }));
      box.append(b);
    });
    this.drawOutfitPreviews();
  }

  private drawOutfitPreviews(): void {
    $('outfits')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b, i) => {
        const canvas = b.querySelector('canvas') as HTMLCanvasElement;
        drawCatIcon(canvas, { ...this.skin, outfit: i }, 2);
      });
  }

  private buildPalette(): void {
    const box = $('palette');
    box.replaceChildren();
    PAINT_PALETTE.forEach((c, i) => {
      const b = el('button', i === 0 ? 'swatch erase' : 'swatch');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', PAINT_NAMES[i] ?? `Color ${i}`);
      b.title = PAINT_NAMES[i] ?? '';
      if (i > 0) b.style.backgroundColor = c;
      b.addEventListener('click', () => {
        this.color = i;
        this.syncControls();
      });
      box.append(b);
    });
  }

  private buildBrushes(): void {
    const box = $('brushes');
    box.replaceChildren();
    [1, 2, 3].forEach((n) => {
      const b = el('button', '', String(n));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Pincel de ${n} por ${n}`);
      b.addEventListener('click', () => {
        this.brush = n;
        this.syncControls();
      });
      box.append(b);
    });
  }

  private syncControls(): void {
    $('coats')
      .querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-checked', String(i === this.skin.base)));
    $('outfits')
      .querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-checked', String(i === outfitOf(this.skin))));
    $('palette')
      .querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-checked', String(i === this.color)));
    $('brushes')
      .querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-checked', String(i + 1 === this.brush)));
  }

  /** Cambia el pelaje, lo guarda y avisa (con una pausa corta para no saturar al servidor). */
  private apply(skin: Skin, quiet = false): void {
    this.skin = skin;
    this.render();
    this.drawOutfitPreviews();
    saveSkin(skin);
    if (quiet) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.onChange(this.skin), 350);
  }

  setSkin(skin: Skin): void {
    this.skin = skin;
    this.render();
    this.drawOutfitPreviews();
  }

  private cellAt(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * this.canvas.width;
    const py = ((e.clientY - r.top) / r.height) * this.canvas.height;
    return { x: Math.floor(px / SCALE) - 1, y: Math.floor(py / SCALE) - 1 - CAT_PAD };
  }

  private footprint(cx: number, cy: number): [number, number][] {
    const out: [number, number][] = [];
    const lo = -Math.floor((this.brush - 1) / 2);
    for (let dy = 0; dy < this.brush; dy++) {
      for (let dx = 0; dx < this.brush; dx++) out.push([cx + lo + dx, cy + lo + dy]);
    }
    return out;
  }

  private paintAt(x: number, y: number): void {
    const cells = this.footprint(x, y).filter(
      ([cx, cy]) => cx >= 0 && cy >= 0 && cx < SKIN_W && cy < SKIN_H && isPaintable(cx, cy),
    );
    if (cells.length === 0) return;
    this.skin = { ...this.skin, paint: paintCells(this.skin.paint, cells, this.color) };
  }

  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.down = true;
    const c = this.cellAt(e);
    this.last = c;
    this.paintAt(c.x, c.y);
    this.render();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const c = this.cellAt(e);
    this.hover = e.pointerType === 'mouse' ? c : null;
    if (this.down && this.last) {
      // Une los puntos para que el trazo rapido no deje huecos.
      const steps = Math.max(Math.abs(c.x - this.last.x), Math.abs(c.y - this.last.y));
      for (let i = 1; i <= steps; i++) {
        this.paintAt(
          Math.round(this.last.x + ((c.x - this.last.x) * i) / steps),
          Math.round(this.last.y + ((c.y - this.last.y) * i) / steps),
        );
      }
      this.last = c;
    }
    this.render();
  };

  private readonly onUp = (): void => {
    if (!this.down) return;
    this.down = false;
    this.last = null;
    this.apply(this.skin);
  };

  private stripes(): void {
    const color = this.color === 0 ? 1 : this.color;
    const cells: [number, number][] = [];
    for (let x = 3; x < SKIN_W - 1; x++) {
      if ((x - 3) % 4 > 1) continue;
      for (let y = 0; y < SKIN_H; y++) if (isPaintable(x, y)) cells.push([x, y]);
    }
    this.apply({ ...this.skin, paint: paintCells(this.skin.paint, cells, color) });
  }

  private spots(): void {
    const color = this.color === 0 ? 1 : this.color;
    const cells: [number, number][] = [];
    const rng = createRng((Math.random() * 2 ** 31) >>> 0);
    for (let n = 0; n < rng.int(4, 7); n++) {
      const cx = rng.int(4, SKIN_W - 5);
      const cy = rng.int(3, SKIN_H - 4);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 0],
      ] as const) {
        if (isPaintable(cx + dx, cy + dy)) cells.push([cx + dx, cy + dy]);
      }
    }
    this.apply({ ...this.skin, paint: paintCells(this.skin.paint, cells, color) });
  }

  private randomize(): void {
    // El traje se elige aparte: "al azar" solo cambia el pelaje y la pintura.
    const fresh = randomSkin(createRng((Math.random() * 2 ** 31) >>> 0));
    this.apply({ ...fresh, outfit: outfitOf(this.skin) });
  }

  render(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(catSprites(this.skin).right[0] as HTMLCanvasElement, 0, 0, w, h);
    // cuadricula solo sobre lo que se puede pintar
    ctx.fillStyle = 'rgba(26,28,44,0.28)';
    for (let y = 0; y < SKIN_H; y++) {
      for (let x = 0; x < SKIN_W; x++) {
        const role = roleAt(x, y);
        if (role !== ROLE.coat && role !== ROLE.shade) continue;
        const ox = (x + 1) * SCALE;
        const oy = (y + 1 + CAT_PAD) * SCALE;
        ctx.fillRect(ox, oy, SCALE, 1);
        ctx.fillRect(ox, oy, 1, SCALE);
      }
    }
    if (this.hover) {
      ctx.strokeStyle = this.color === 0 ? '#f4f4f4' : (PAINT_PALETTE[this.color] as string);
      ctx.lineWidth = 2;
      for (const [x, y] of this.footprint(this.hover.x, this.hover.y)) {
        if (x < 0 || y < 0 || x >= SKIN_W || y >= SKIN_H || !isPaintable(x, y)) continue;
        ctx.strokeRect((x + 1) * SCALE + 1, (y + 1 + CAT_PAD) * SCALE + 1, SCALE - 2, SCALE - 2);
      }
    }
    this.syncControls();
  }

  /** Color de un pixel con pintura (para pruebas). */
  colorAt(x: number, y: number): string | null {
    return pixelColor(
      this.skin,
      roleAt(x, y),
      Number.parseInt(this.skin.paint[paintIndex(x, y)] ?? '0', 16),
    );
  }
}
