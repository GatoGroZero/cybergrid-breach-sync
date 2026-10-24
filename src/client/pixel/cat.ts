import { SKIN_CELLS, SKIN_H, SKIN_W } from '../../shared/br/constants';
import { BASE_COATS, PAINT_PALETTE, type Skin } from '../../shared/br/skin';
import { C, disc, flipH, line, make, outline, px, shade, type Ctx } from './draw';

/** Roles de cada pixel del gato: lo pintable es 1 (pelaje) y 2 (sombra); el resto es fijo. */
export const ROLE = { none: 0, coat: 1, shade: 2, ear: 3, eye: 4, nose: 5 } as const;

interface Frame {
  role: Uint8Array;
  /** Indice de la celda de pintura que le toca a cada pixel (las patas en movimiento usan la de su posicion base). */
  src: Int16Array;
}

const idx = (x: number, y: number): number => y * SKIN_W + x;

/** 0 quieto, 1 y 2 caminando, 3 galope estirado, 4 galope recogido. */
function buildFrame(step: 0 | 1 | 2 | 3 | 4): Frame {
  const [canvas] = make(SKIN_W, SKIN_H);
  const role = new Uint8Array(SKIN_CELLS);
  const src = new Int16Array(SKIN_CELLS).fill(-1);
  const paintRole = (
    r: number,
    drawFn: (ctx: Ctx, color: string) => void,
    dx = 0,
    dy = 0,
  ): void => {
    // Se dibuja en un lienzo auxiliar para saber exactamente que pixeles toco esta parte.
    const [aux, ac] = make(SKIN_W, SKIN_H);
    ac.translate(0, dy);
    drawFn(ac, '#ffffff');
    const data = ac.getImageData(0, 0, SKIN_W, SKIN_H).data;
    for (let y = 0; y < SKIN_H; y++) {
      for (let x = 0; x < SKIN_W; x++) {
        if ((data[(y * SKIN_W + x) * 4 + 3] as number) > 0) {
          role[idx(x, y)] = r;
          src[idx(x, y)] = idx(
            Math.min(SKIN_W - 1, Math.max(0, x - dx)),
            Math.min(SKIN_H - 1, Math.max(0, y - dy)),
          );
        }
      }
    }
    void aux;
  };

  // Patas lejanas (sombra), cuerpo, patas cercanas, cabeza, cola y orejas.
  const gallop = step >= 3;
  const near = step === 1 ? 1 : step === 2 ? -1 : 0;
  // Galope: estirado (patas muy abiertas) o recogido (patas bajo el cuerpo); el cuerpo rebota.
  const bodyDy = step === 4 ? -1 : 0;
  const lift = (off: number): number => (off !== 0 ? 1 : 0);
  const leg = (x: number, off: number, shadeRole: number, len?: number): void =>
    paintRole(
      shadeRole,
      (ctx, col) => {
        ctx.fillStyle = col;
        ctx.fillRect(x + off, 12, 2, len ?? 4 - lift(off) * (off > 0 ? 0 : 1));
      },
      off,
    );
  if (gallop) {
    const spread = step === 3 ? 3 : 0;
    const tuck = step === 4 ? 1 : 0;
    const l = step === 3 ? 3 : 2;
    leg(7, -spread + tuck, ROLE.shade, l);
    leg(15, spread - tuck, ROLE.shade, l);
  } else {
    leg(7, -near, ROLE.shade);
    leg(15, -near, ROLE.shade);
  }
  paintRole(
    ROLE.coat,
    (ctx, col) => {
      // cuerpo
      for (let y = 5; y <= 13; y++) {
        for (let x = 3; x <= 18; x++) {
          const dx = (x + 0.5 - 10.5) / 7.6;
          const dy = (y + 0.5 - 9.2) / 4.3;
          if (dx * dx + dy * dy <= 1) {
            ctx.fillStyle = col;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    },
    0,
    bodyDy,
  );
  if (gallop) {
    const spread = step === 3 ? 3 : 0;
    const tuck = step === 4 ? 1 : 0;
    const l = step === 3 ? 4 : 2;
    leg(9, -spread + tuck, ROLE.coat, l);
    leg(17, spread - tuck, ROLE.coat, l);
  } else {
    leg(9, near, ROLE.coat);
    leg(17, near, ROLE.coat);
  }
  paintRole(
    ROLE.coat,
    (ctx, col) => {
      // cabeza
      for (let y = 3; y <= 12; y++) {
        for (let x = 14; x <= 23; x++) {
          const dx = (x + 0.5 - 18.7) / 4.4;
          const dy = (y + 0.5 - 7.6) / 3.8;
          if (dx * dx + dy * dy <= 1) {
            ctx.fillStyle = col;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      // orejas
      ctx.fillStyle = col;
      for (const [x, y] of [
        [15, 3],
        [15, 2],
        [16, 3],
        [16, 2],
        [15, 1],
        [21, 3],
        [21, 2],
        [20, 3],
        [20, 2],
        [21, 1],
      ] as const) {
        ctx.fillRect(x, y, 1, 1);
      }
      // cola: curva hacia arriba
      const pts: [number, number][] = gallop
        ? [
            [4, 8],
            [3, 8],
            [2, 7],
            [1, 7],
            [0, 6],
          ]
        : [
            [4, 9],
            [3, 8],
            [2, 6],
            [1, 4],
            [1, 2],
            [2, 1],
          ];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1] as [number, number];
        const b = pts[i] as [number, number];
        line(ctx, a[0], a[1], b[0], b[1], col);
        line(ctx, a[0] + 1, a[1], b[0] + 1, b[1], col);
      }
    },
    0,
    bodyDy,
  );
  // vientre mas oscuro: parte baja del cuerpo
  for (let y = 12; y <= 13; y++) {
    for (let x = 4; x <= 17; x++) if (role[idx(x, y)] === ROLE.coat) role[idx(x, y)] = ROLE.shade;
  }
  // detalles fijos
  for (const [x, y] of [
    [16, 2],
    [20, 2],
  ] as const) {
    role[idx(x, y + bodyDy)] = ROLE.ear;
  }
  role[idx(20, 7 + bodyDy)] = ROLE.eye;
  role[idx(22, 9 + bodyDy)] = ROLE.nose;
  void canvas;
  void px;
  void disc;
  return { role, src };
}

const FRAMES = [buildFrame(0), buildFrame(1), buildFrame(2), buildFrame(3), buildFrame(4)] as const;

/** Mapa de pintura para el editor: true donde el pelaje se puede pintar. */
export function isPaintable(x: number, y: number): boolean {
  const r = FRAMES[0].role[idx(x, y)] as number;
  return r === ROLE.coat || r === ROLE.shade;
}

export function roleAt(x: number, y: number): number {
  return FRAMES[0].role[idx(x, y)] as number;
}

export function baseColor(skin: Skin): string {
  return (BASE_COATS[skin.base] ?? BASE_COATS[0]).color;
}

/** Color final del pixel (x, y) en el marco 0 con la pintura aplicada, o null si esta vacio. */
export function pixelColor(skin: Skin, role: number, paintCell: number): string | null {
  const base = baseColor(skin);
  const painted = paintCell > 0 ? (PAINT_PALETTE[paintCell] as string) : base;
  switch (role) {
    case ROLE.coat:
      return painted;
    case ROLE.shade:
      return shade(painted, 0.78);
    case ROLE.ear:
      return C.pink;
    case ROLE.eye:
      return C.black;
    case ROLE.nose:
      return C.rose;
    default:
      return null;
  }
}

function render(skin: Skin, frame: Frame): HTMLCanvasElement {
  const [canvas, c] = make(SKIN_W, SKIN_H);
  for (let y = 0; y < SKIN_H; y++) {
    for (let x = 0; x < SKIN_W; x++) {
      const i = idx(x, y);
      const role = frame.role[i] as number;
      if (role === ROLE.none) continue;
      const cell = frame.src[i] as number;
      const paintChar = skin.paint[cell >= 0 ? cell : i] ?? '0';
      const color = pixelColor(skin, role, Number.parseInt(paintChar, 16));
      if (color) {
        c.fillStyle = color;
        c.fillRect(x, y, 1, 1);
      }
    }
  }
  return outline(canvas, C.black);
}

export interface CatSprites {
  /** Cinco marcos (quieto, paso A, paso B, galope estirado, galope recogido), derecha e izquierda. */
  right: HTMLCanvasElement[];
  left: HTMLCanvasElement[];
  /** Siluetas blancas para el destello al recibir un golpe. */
  flashRight: HTMLCanvasElement[];
  flashLeft: HTMLCanvasElement[];
}

export const CAT_W = SKIN_W + 2;
export const CAT_H = SKIN_H + 2;

function silhouette(src: HTMLCanvasElement): HTMLCanvasElement {
  const [out, c] = make(src.width, src.height);
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, src.width, src.height);
  return out;
}

const cache = new Map<string, CatSprites>();

export function catSprites(skin: Skin): CatSprites {
  const key = `${skin.base}:${skin.paint}`;
  let hit = cache.get(key);
  if (!hit) {
    const right = FRAMES.map((f) => render(skin, f));
    const left = right.map(flipH);
    hit = {
      right,
      left,
      flashRight: right.map(silhouette),
      flashLeft: left.map(silhouette),
    };
    cache.set(key, hit);
    if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}
