import { MAP_H, MAP_W, NODE, TILE } from './constants';
import { createRng } from './rng';

export interface Vec {
  x: number;
  y: number;
}

/** Sala rectangular expresada en casillas. */
export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameMap {
  seed: number;
  w: number;
  h: number;
  /** 0 = piso, 1 = muro. Las casillas del borde siempre son muro. */
  tiles: Uint8Array;
  rooms: Room[];
  spawn: Vec;
  nodes: Vec[];
  exit: Vec;
  spawnRoom: number;
  nodeRooms: number[];
  exitRoom: number;
}

export const FLOOR = 0;
export const WALL = 1;

export function roomCenter(room: Room): Vec {
  return { x: (room.x + room.w / 2) * TILE, y: (room.y + room.h / 2) * TILE };
}

export function tileAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return WALL;
  return map.tiles[ty * map.w + tx] as number;
}

export function isWallTile(map: GameMap, tx: number, ty: number): boolean {
  return tileAt(map, tx, ty) === WALL;
}

export function isWallAt(map: GameMap, x: number, y: number): boolean {
  return isWallTile(map, Math.floor(x / TILE), Math.floor(y / TILE));
}

/** Cuenta las casillas de piso alcanzables desde una casilla (4 vecinos). */
export function reachableFloor(map: GameMap, sx: number, sy: number): number {
  if (isWallTile(map, sx, sy)) return 0;
  const seen = new Uint8Array(map.w * map.h);
  const stack: number[] = [sy * map.w + sx];
  seen[sy * map.w + sx] = 1;
  let count = 0;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    count++;
    const x = i % map.w;
    const y = (i / map.w) | 0;
    const neighbours = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const;
    for (const [nx, ny] of neighbours) {
      if (isWallTile(map, nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return count;
}

export function countFloor(map: GameMap): number {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === FLOOR) n++;
  return n;
}

function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function overlaps(a: Room, b: Room, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin &&
    a.x + a.w + margin > b.x &&
    a.y < b.y + b.h + margin &&
    a.y + a.h + margin > b.y
  );
}

function carveRoom(tiles: Uint8Array, w: number, room: Room): void {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) tiles[y * w + x] = FLOOR;
  }
}

function carveCorridor(tiles: Uint8Array, w: number, h: number, a: Room, b: Room): void {
  const ax = Math.floor(a.x + a.w / 2);
  const ay = Math.floor(a.y + a.h / 2);
  const bx = Math.floor(b.x + b.w / 2);
  const by = Math.floor(b.y + b.h / 2);
  const set = (x: number, y: number): void => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[y * w + x] = FLOOR;
  };
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  for (let x = x0; x <= x1; x++) {
    set(x, ay);
    set(x, ay + 1);
  }
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  for (let y = y0; y <= y1; y++) {
    set(bx, y);
    set(bx + 1, y);
  }
}

function tryGenerate(seed: number, attemptSeed: number, w: number, h: number): GameMap | null {
  const rng = createRng(attemptSeed);
  const tiles = new Uint8Array(w * h).fill(WALL);
  const rooms: Room[] = [];

  for (let i = 0; i < 600 && rooms.length < 14; i++) {
    const rw = rng.int(7, 13);
    const rh = rng.int(6, 10);
    const room: Room = {
      x: rng.int(2, w - rw - 3),
      y: rng.int(2, h - rh - 3),
      w: rw,
      h: rh,
    };
    if (rooms.some((other) => overlaps(room, other, 3))) continue;
    rooms.push(room);
  }
  if (rooms.length < 8) return null;

  rooms.sort((a, b) => a.x - b.x);
  for (const room of rooms) carveRoom(tiles, w, room);
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(tiles, w, h, rooms[i - 1] as Room, rooms[i] as Room);
  }
  // Cortes extra para que haya rutas alternas y no solo una cadena.
  for (let i = 0; i < 6; i++) {
    const a = rng.int(0, rooms.length - 1);
    const b = rng.int(0, rooms.length - 1);
    if (a !== b) carveCorridor(tiles, w, h, rooms[a] as Room, rooms[b] as Room);
  }

  const centers = rooms.map(roomCenter);
  const spawnRoom = rng.int(0, rooms.length - 1);
  const spawn = centers[spawnRoom] as Vec;

  const chosen: number[] = [spawnRoom];
  const nodeRooms: number[] = [];
  for (let n = 0; n < NODE.count; n++) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < rooms.length; i++) {
      if (chosen.includes(i)) continue;
      let nearest = Infinity;
      for (const c of chosen)
        nearest = Math.min(nearest, dist2(centers[i] as Vec, centers[c] as Vec));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = i;
      }
    }
    if (best < 0) return null;
    chosen.push(best);
    nodeRooms.push(best);
  }

  let exitRoom = -1;
  let exitScore = -1;
  for (let i = 0; i < rooms.length; i++) {
    if (chosen.includes(i)) continue;
    const score = dist2(centers[i] as Vec, spawn);
    if (score > exitScore) {
      exitScore = score;
      exitRoom = i;
    }
  }
  if (exitRoom < 0) return null;

  const map: GameMap = {
    seed,
    w,
    h,
    tiles,
    rooms,
    spawn,
    nodes: nodeRooms.map((i) => centers[i] as Vec),
    exit: centers[exitRoom] as Vec,
    spawnRoom,
    nodeRooms,
    exitRoom,
  };

  // Pilares dentro de las salas, lejos de los bordes y del centro, sin cortar rutas.
  let floor = countFloor(map);
  for (let i = 0; i < rooms.length; i++) {
    if (i === spawnRoom) continue;
    const room = rooms[i] as Room;
    const pillars = rng.int(0, 3);
    for (let p = 0; p < pillars; p++) {
      const px = rng.int(room.x + 2, room.x + room.w - 3);
      const py = rng.int(room.y + 2, room.y + room.h - 3);
      const cx = Math.floor(room.x + room.w / 2);
      const cy = Math.floor(room.y + room.h / 2);
      if (Math.abs(px - cx) < 3 && Math.abs(py - cy) < 3) continue;
      const at = py * w + px;
      if (tiles[at] !== FLOOR) continue;
      tiles[at] = WALL;
      const sx = Math.floor(spawn.x / TILE);
      const sy = Math.floor(spawn.y / TILE);
      if (reachableFloor(map, sx, sy) !== floor - 1) {
        tiles[at] = FLOOR;
      } else {
        floor -= 1;
      }
    }
  }

  const sx = Math.floor(spawn.x / TILE);
  const sy = Math.floor(spawn.y / TILE);
  if (reachableFloor(map, sx, sy) !== countFloor(map)) return null;
  return map;
}

/**
 * Genera el mapa de una partida. Es determinista: cliente y servidor llaman a esta funcion con la
 * misma semilla y obtienen exactamente la misma cuadricula, asi que solo se envia la semilla.
 */
export function generateMap(seed: number, w = MAP_W, h = MAP_H): GameMap {
  for (let attempt = 0; attempt < 60; attempt++) {
    const map = tryGenerate(seed, (seed + attempt * 7919) >>> 0, w, h);
    if (map) return map;
  }
  throw new Error(`no se pudo generar un mapa valido para la semilla ${seed}`);
}

/** Punto de piso aleatorio dentro de una sala (con margen de una casilla). */
export function randomPointInRoom(map: GameMap, roomIndex: number, rnd: () => number): Vec {
  const room = map.rooms[roomIndex] as Room;
  for (let i = 0; i < 20; i++) {
    const tx = room.x + 1 + Math.floor(rnd() * Math.max(1, room.w - 2));
    const ty = room.y + 1 + Math.floor(rnd() * Math.max(1, room.h - 2));
    if (!isWallTile(map, tx, ty)) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
  return roomCenter(room);
}
