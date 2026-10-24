import { CAT, TILE } from './constants';
import { isSolidTile, type BRMap, type Vec } from './map';

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

const EPS = 1e-3;

function moveX(m: BRMap, x: number, y: number, dx: number, half: number): number {
  if (dx === 0) return x;
  let nx = x + dx;
  const top = Math.floor((y - half) / TILE);
  const bottom = Math.floor((y + half - EPS) / TILE);
  if (dx > 0) {
    const col = Math.floor((nx + half) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (isSolidTile(m, col, ty)) {
        nx = col * TILE - half - EPS;
        break;
      }
    }
  } else {
    const col = Math.floor((nx - half) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (isSolidTile(m, col, ty)) {
        nx = (col + 1) * TILE + half + EPS;
        break;
      }
    }
  }
  return nx;
}

function moveY(m: BRMap, x: number, y: number, dy: number, half: number): number {
  if (dy === 0) return y;
  let ny = y + dy;
  const left = Math.floor((x - half) / TILE);
  const right = Math.floor((x + half - EPS) / TILE);
  if (dy > 0) {
    const row = Math.floor((ny + half) / TILE);
    for (let tx = left; tx <= right; tx++) {
      if (isSolidTile(m, tx, row)) {
        ny = row * TILE - half - EPS;
        break;
      }
    }
  } else {
    const row = Math.floor((ny - half) / TILE);
    for (let tx = left; tx <= right; tx++) {
      if (isSolidTile(m, tx, row)) {
        ny = (row + 1) * TILE + half + EPS;
        break;
      }
    }
  }
  return ny;
}

/** Mueve una caja cuadrada contra los muros, un eje a la vez (desliza por las paredes). */
export function moveBox(m: BRMap, x: number, y: number, dx: number, dy: number, half: number): Vec {
  const nx = moveX(m, x, y, dx, half);
  const ny = moveY(m, nx, y, dy, half);
  return { x: nx, y: ny };
}

export interface MoveInput {
  mx: number;
  my: number;
}

export interface Motion {
  x: number;
  y: number;
}

/** Recorta el vector de movimiento a longitud 1 y descarta valores invalidos. */
export function normalizeMove(mx: number, my: number): MoveInput {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return { mx: 0, my: 0 };
  const len = Math.hypot(mx, my);
  if (len <= 1) return { mx, my };
  return { mx: mx / len, my: my / len };
}

/** Un paso de movimiento del gato. Lo ejecutan igual el servidor y el cliente (prediccion). */
export function stepCat(m: BRMap, motion: Motion, input: MoveInput, dt: number): void {
  const n = normalizeMove(input.mx, input.my);
  const next = moveBox(m, motion.x, motion.y, n.mx * CAT.speed * dt, n.my * CAT.speed * dt, CAT.half);
  motion.x = next.x;
  motion.y = next.y;
}

export interface SegmentHit {
  hit: boolean;
  /** Fraccion 0 a 1 del segmento donde choca. */
  t: number;
  tx: number;
  ty: number;
}

/**
 * Recorre las casillas que atraviesa un segmento (DDA) y devuelve el primer choque con un solido.
 * Es lo que evita que una bala rapida (sniper) atraviese un muro entre dos ticks.
 */
export function segmentSolidHit(m: BRMap, x0: number, y0: number, x1: number, y1: number): SegmentHit {
  let tx = Math.floor(x0 / TILE);
  let ty = Math.floor(y0 / TILE);
  if (isSolidTile(m, tx, ty)) return { hit: true, t: 0, tx, ty };
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(TILE / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(TILE / dy);
  let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx));
  let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy));
  for (let guard = 0; guard < 400; guard++) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tx += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      ty += stepY;
      tMaxY += tDeltaY;
    }
    if (t > 1) break;
    if (isSolidTile(m, tx, ty)) return { hit: true, t, tx, ty };
  }
  return { hit: false, t: 1, tx: -1, ty: -1 };
}

export function hasLineOfSight(m: BRMap, x0: number, y0: number, x1: number, y1: number): boolean {
  return !segmentSolidHit(m, x0, y0, x1, y1).hit;
}

/** Primer punto (fraccion 0 a 1) donde un segmento toca un circulo, o -1 si no lo toca. */
export function segmentCircleHit(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = (-b - sq) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
