import { TILE } from './constants';
import { isWallTile, type GameMap, type Vec } from './map';

/**
 * Campo de distancias por BFS multi-origen desde las casillas de los jugadores. Los drones bajan
 * por el gradiente, asi rodean muros en lugar de quedarse pegados.
 */
export function computeFlowField(map: GameMap, sources: Vec[]): Int16Array {
  const dist = new Int16Array(map.w * map.h).fill(-1);
  const queue = new Int32Array(map.w * map.h);
  let head = 0;
  let tail = 0;

  for (const s of sources) {
    const tx = Math.floor(s.x / TILE);
    const ty = Math.floor(s.y / TILE);
    if (isWallTile(map, tx, ty)) continue;
    const i = ty * map.w + tx;
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }

  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % map.w;
    const y = (i / map.w) | 0;
    const d = dist[i] as number;
    const nbrs = [i + 1, i - 1, i + map.w, i - map.w];
    const nx = [x + 1, x - 1, x, x];
    const ny = [y, y, y + 1, y - 1];
    for (let k = 0; k < 4; k++) {
      if (isWallTile(map, nx[k] as number, ny[k] as number)) continue;
      const ni = nbrs[k] as number;
      if (dist[ni] !== -1) continue;
      dist[ni] = d + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/** Direccion unitaria hacia la casilla vecina con menor distancia, o null si no hay camino. */
export function flowDirection(map: GameMap, dist: Int16Array, x: number, y: number): Vec | null {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (isWallTile(map, tx, ty)) return null;
  const here = dist[ty * map.w + tx] as number;
  if (here <= 0) return null;

  let best = here;
  let bx = 0;
  let by = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const nx = tx + ox;
      const ny = ty + oy;
      if (isWallTile(map, nx, ny)) continue;
      if (ox !== 0 && oy !== 0 && (isWallTile(map, tx + ox, ty) || isWallTile(map, tx, ty + oy)))
        continue;
      const d = dist[ny * map.w + nx] as number;
      if (d >= 0 && d < best) {
        best = d;
        bx = ox;
        by = oy;
      }
    }
  }
  if (bx === 0 && by === 0) return null;
  const targetX = (tx + bx + 0.5) * TILE;
  const targetY = (ty + by + 0.5) * TILE;
  const len = Math.hypot(targetX - x, targetY - y) || 1;
  return { x: (targetX - x) / len, y: (targetY - y) / len };
}

/** Distancia en casillas entre dos puntos del mundo siguiendo los pasillos, o -1 si no se alcanzan. */
export function pathDistance(map: GameMap, from: Vec, to: Vec): number {
  const field = computeFlowField(map, [from]);
  const tx = Math.floor(to.x / TILE);
  const ty = Math.floor(to.y / TILE);
  if (isWallTile(map, tx, ty)) return -1;
  return field[ty * map.w + tx] as number;
}
