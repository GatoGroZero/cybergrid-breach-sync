import { createRng, type Rng } from '../../shared/rng';

export type Ctx = CanvasRenderingContext2D;

/** Paleta Sweetie 16 mas algunos tonos de terreno, para que todo se vea de la misma familia. */
export const C = {
  black: '#1a1c2c',
  purple: '#5d275d',
  red: '#b13e53',
  orange: '#ef7d57',
  yellow: '#ffcd75',
  lime: '#a7f070',
  green: '#38b764',
  teal: '#257179',
  navy: '#29366f',
  blue: '#3b5dc9',
  sky: '#41a6f6',
  cyan: '#73eff7',
  white: '#f4f4f4',
  lgray: '#94b0c2',
  gray: '#566c86',
  dgray: '#333c57',
  // terreno
  grass: '#3e8948',
  grassD: '#2f6e42',
  grassL: '#63c74d',
  dirt: '#b68a5a',
  dirtD: '#8b5e3c',
  wood: '#d5a27a',
  woodD: '#a8754f',
  woodDD: '#6d4530',
  deck: '#e8d8b4',
  deckD: '#cdb98f',
  stone: '#e4e0d0',
  hedge: '#1f5c3a',
  hedgeL: '#2d8a4a',
  brick: '#4a3b52',
  brickL: '#6b5b73',
  pink: '#f4a6c0',
  rose: '#e8738a',
} as const;

export function make(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

export const px = (c: Ctx, x: number, y: number, color: string): void => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
};

export const rect = (c: Ctx, x: number, y: number, w: number, h: number, color: string): void => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};

/**
 * Llena las casillas cuyo centro cae dentro de la elipse: una tira por fila en vez de una llamada por
 * casilla. El resultado es identico, pero un resplandor de 170 px de radio pasa de medio millon de
 * llamadas a un par de cientos (antes, la primera vez que salia una habilidad grande el juego
 * se congelaba un segundo entero).
 */
function fillSpans(c: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    const rest = 1 - dy * dy;
    if (rest < 0) continue;
    const half = rx * Math.sqrt(rest);
    const x0 = Math.ceil(cx - half - 0.5);
    const x1 = Math.floor(cx + half - 0.5);
    if (x1 >= x0) c.fillRect(x0, y, x1 - x0 + 1, 1);
  }
}

/** Disco de pixeles: llena las casillas cuyo centro cae dentro del circulo. */
export function disc(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  c.fillStyle = color;
  fillSpans(c, cx, cy, r, r);
}

export function ell(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  c.fillStyle = color;
  fillSpans(c, cx, cy, rx, ry);
}

export function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  c.fillStyle = color;
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 400; i++) {
    c.fillRect(x, y, 1, 1);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Dibuja una figura dada como filas de texto: cada letra es un color de `pal`, "." es vacio. */
export function art(rows: string[], pal: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const [canvas, c] = make(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      const col = pal[ch];
      if (ch !== '.' && col) px(c, x, y, col);
    }
  });
  return canvas;
}

/** Agrega un contorno de 1 px alrededor de lo que no es transparente. Devuelve un lienzo 2 px mas grande. */
export function outline(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const [out, c] = make(src.width + 2, src.height + 2);
  const sctx = src.getContext('2d') as Ctx;
  const data = sctx.getImageData(0, 0, src.width, src.height).data;
  const solid = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < src.width &&
    y < src.height &&
    (data[(y * src.width + x) * 4 + 3] as number) > 8;
  c.fillStyle = color;
  for (let y = -1; y <= src.height; y++) {
    for (let x = -1; x <= src.width; x++) {
      if (solid(x, y)) continue;
      if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))
        c.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  c.drawImage(src, 1, 1);
  return out;
}

export function flipH(src: HTMLCanvasElement): HTMLCanvasElement {
  const [out, c] = make(src.width, src.height);
  c.translate(src.width, 0);
  c.scale(-1, 1);
  c.drawImage(src, 0, 0);
  return out;
}

export function rngFor(...parts: number[]): Rng {
  let h = 2166136261;
  for (const p of parts) h = Math.imul(h ^ (p | 0), 16777619);
  return createRng(h >>> 0);
}

/** Oscurece (f < 1) o aclara (f > 1) un color hexadecimal. */
export function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function hash(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
