import { FLOOR, WALL, type GameMap } from '../../src/shared/map';

/** Mapa vacio con muros solo en el borde, util para probar fisica sin depender del generador. */
export function openMap(w = 20, h = 20): GameMap {
  const tiles = new Uint8Array(w * h).fill(FLOOR);
  for (let x = 0; x < w; x++) {
    tiles[x] = WALL;
    tiles[(h - 1) * w + x] = WALL;
  }
  for (let y = 0; y < h; y++) {
    tiles[y * w] = WALL;
    tiles[y * w + (w - 1)] = WALL;
  }
  return {
    seed: 0,
    w,
    h,
    tiles,
    rooms: [],
    spawn: { x: 64, y: 64 },
    nodes: [],
    exit: { x: 128, y: 128 },
    spawnRoom: 0,
    nodeRooms: [],
    exitRoom: 0,
  };
}
