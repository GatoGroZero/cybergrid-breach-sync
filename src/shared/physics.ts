import { PLAYER, TILE } from './constants';
import { isWallAt, isWallTile, type GameMap, type Vec } from './map';

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

const EPS = 1e-3;

function moveAxisX(map: GameMap, x: number, y: number, dx: number, r: number): number {
  if (dx === 0) return x;
  let nx = x + dx;
  const top = Math.floor((y - r) / TILE);
  const bottom = Math.floor((y + r - EPS) / TILE);
  if (dx > 0) {
    const col = Math.floor((nx + r) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (isWallTile(map, col, ty)) {
        nx = col * TILE - r - EPS;
        break;
      }
    }
  } else {
    const col = Math.floor((nx - r) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (isWallTile(map, col, ty)) {
        nx = (col + 1) * TILE + r + EPS;
        break;
      }
    }
  }
  return nx;
}

function moveAxisY(map: GameMap, x: number, y: number, dy: number, r: number): number {
  if (dy === 0) return y;
  let ny = y + dy;
  const left = Math.floor((x - r) / TILE);
  const right = Math.floor((x + r - EPS) / TILE);
  if (dy > 0) {
    const row = Math.floor((ny + r) / TILE);
    for (let tx = left; tx <= right; tx++) {
      if (isWallTile(map, tx, row)) {
        ny = row * TILE - r - EPS;
        break;
      }
    }
  } else {
    const row = Math.floor((ny - r) / TILE);
    for (let tx = left; tx <= right; tx++) {
      if (isWallTile(map, tx, row)) {
        ny = (row + 1) * TILE + r + EPS;
        break;
      }
    }
  }
  return ny;
}

/**
 * Mueve un cuerpo cuadrado de radio r por ejes separados contra los muros. El desplazamiento por
 * llamada debe ser menor que una casilla (a 30 Hz, hasta ~960 px/s).
 */
export function moveBody(
  map: GameMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
): Vec {
  const nx = moveAxisX(map, x, y, dx, r);
  const ny = moveAxisY(map, nx, y, dy, r);
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

/** Recorta el vector de movimiento a longitud maxima 1 (el joystick es analogico, el teclado no). */
export function normalizeMove(mx: number, my: number): MoveInput {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return { mx: 0, my: 0 };
  const len = Math.hypot(mx, my);
  if (len <= 1) return { mx, my };
  return { mx: mx / len, my: my / len };
}

/**
 * Un paso de movimiento del jugador. Lo ejecutan igual el servidor (verdad) y el cliente
 * (prediccion), por eso vive en shared y no depende de nada del navegador.
 */
export function stepPlayer(
  map: GameMap,
  motion: Motion,
  input: MoveInput,
  dt: number,
  speedMul = 1,
): void {
  const m = normalizeMove(input.mx, input.my);
  const speed = PLAYER.speed * speedMul;
  const next = moveBody(
    map,
    motion.x,
    motion.y,
    m.mx * speed * dt,
    m.my * speed * dt,
    PLAYER.radius,
  );
  motion.x = next.x;
  motion.y = next.y;
}

/** Linea de vista aproximada muestreando cada 8 px. */
export function hasLineOfSight(
  map: GameMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const d = dist(ax, ay, bx, by);
  const steps = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWallAt(map, ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}
