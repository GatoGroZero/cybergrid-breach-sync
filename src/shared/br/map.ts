import { createRng, type Rng } from '../rng';
import { MAX_PLAYERS, TILE } from './constants';

export type MapKind = 'bosque' | 'casa' | 'piscina';
export const MAP_KINDS: readonly MapKind[] = ['bosque', 'casa', 'piscina'];
export const MAP_NAMES: Record<MapKind, string> = {
  bosque: 'Bosque',
  casa: 'Casa de gatitos',
  piscina: 'Piscina',
};

/** Terrenos. Los que son decorativos no bloquean; WATER dana; los muros se marcan tambien en `solid`. */
export const G = {
  GRASS: 0,
  GRASS2: 1,
  GRASS3: 2,
  DIRT: 3,
  WATER: 4,
  WOOD: 5,
  WOOD2: 6,
  DECK: 7,
  DECK2: 8,
  CARPET: 9,
  TILE: 10,
  FLOWER: 11,
  FLOWER2: 12,
  PATH: 13,
  SAND: 14,
  WALLTOP: 15,
  HEDGE: 16,
  POOLEDGE: 17,
  HOUSEWALL: 18,
  BEDSHADE: 19,
} as const;

export type PropKind =
  | 'tree'
  | 'pine'
  | 'palm'
  | 'bush'
  | 'rock'
  | 'log'
  | 'table'
  | 'crate'
  | 'couch'
  | 'shelf'
  | 'plant'
  | 'cattree'
  | 'sunbed'
  | 'parasol'
  | 'duck'
  | 'rug';

export interface Prop {
  kind: PropKind;
  /** Esquina superior izquierda en casillas. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HouseKind = 'house' | 'bed' | 'cabin';

export interface House {
  id: number;
  kind: HouseKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Casillas que se pueden cruzar para entrar. Siempre hay al menos 2 puertas. */
  doors: { x: number; y: number }[];
  name: string;
  style: number;
}

export interface ChestSpot {
  id: number;
  /** Centro en pixeles. */
  x: number;
  y: number;
  golden: boolean;
}

export interface Landmark {
  name: string;
  x: number;
  y: number;
  kind: 'house' | 'water' | 'bed';
}

export interface Vec {
  x: number;
  y: number;
}

export interface BRMap {
  seed: number;
  kind: MapKind;
  /** Ancho y alto en casillas. */
  w: number;
  h: number;
  ground: Uint8Array;
  /** 0 libre, 1 solido estatico, 2 muro colocado por un jugador. */
  solid: Uint8Array;
  houses: House[];
  props: Prop[];
  chests: ChestSpot[];
  spawns: Vec[];
  landmarks: Landmark[];
}

export const mapWidthPx = (m: BRMap): number => m.w * TILE;
export const mapHeightPx = (m: BRMap): number => m.h * TILE;

export function inBounds(m: BRMap, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h;
}

export function isSolidTile(m: BRMap, tx: number, ty: number): boolean {
  if (!inBounds(m, tx, ty)) return true;
  return m.solid[ty * m.w + tx] !== 0;
}

export function groundAt(m: BRMap, tx: number, ty: number): number {
  return inBounds(m, tx, ty) ? (m.ground[ty * m.w + tx] as number) : G.HEDGE;
}

export function isWaterAtPx(m: BRMap, x: number, y: number): boolean {
  return groundAt(m, Math.floor(x / TILE), Math.floor(y / TILE)) === G.WATER;
}

const NAMES_BOSQUE = [
  'Ovillo',
  'Cojín',
  'Rascador',
  'Pecera',
  'Sardinera',
  'Cuenco',
  'Bigotes',
  'Siesta',
  'Colita',
  'Atún',
];
const NAMES_CAMA = [
  'Cama de Mimi',
  'Cama de Pelusa',
  'Cama de Luna',
  'Cama de Tigre',
  'Cama de Nube',
  'Cama de Mochi',
];
const NAMES_CABANA = ['Vestidor', 'Bar del Atún', 'Cabaña Salmón', 'Caseta Splash', 'Cabaña Coral'];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, margin: number): boolean =>
  a.x < b.x + b.w + margin &&
  a.x + a.w + margin > b.x &&
  a.y < b.y + b.h + margin &&
  a.y + a.h + margin > b.y;

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor suave para formar bosques densos y claros. */
function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

class Builder {
  readonly m: BRMap;
  /** Casillas donde no deben ponerse arboles ni muebles (casas, frentes de puertas, caminos). */
  readonly reserved: Uint8Array;
  readonly rects: Rect[] = [];
  private nextHouse = 1;
  private nextChest = 1;

  constructor(
    readonly rng: Rng,
    kind: MapKind,
    seed: number,
    w: number,
    h: number,
  ) {
    this.m = {
      seed,
      kind,
      w,
      h,
      ground: new Uint8Array(w * h),
      solid: new Uint8Array(w * h),
      houses: [],
      props: [],
      chests: [],
      spawns: [],
      landmarks: [],
    };
    this.reserved = new Uint8Array(w * h);
  }

  at(x: number, y: number): number {
    return y * this.m.w + x;
  }

  setGround(x: number, y: number, g: number): void {
    if (inBounds(this.m, x, y)) this.m.ground[this.at(x, y)] = g;
  }

  setSolid(x: number, y: number, v = 1): void {
    if (inBounds(this.m, x, y)) this.m.solid[this.at(x, y)] = v;
  }

  reserve(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (inBounds(this.m, xx, yy)) this.reserved[this.at(xx, yy)] = 1;
      }
    }
  }

  isFree(x: number, y: number): boolean {
    return (
      inBounds(this.m, x, y) && this.m.solid[this.at(x, y)] === 0 && !this.reserved[this.at(x, y)]
    );
  }

  fillGround(x: number, y: number, w: number, h: number, g: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.setGround(xx, yy, g);
  }

  /** Anillo de muros solidos de 2 casillas alrededor del mapa. */
  border(g: number): void {
    const { w, h } = this.m;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) {
          this.setGround(x, y, g);
          this.setSolid(x, y);
        }
      }
    }
  }

  addProp(
    kind: PropKind,
    x: number,
    y: number,
    w: number,
    h: number,
    solidTiles: 'all' | 'base' | 'none',
  ): void {
    this.m.props.push({ kind, x, y, w, h });
    if (solidTiles === 'all') {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.setSolid(xx, yy);
    } else if (solidTiles === 'base') {
      for (let xx = x; xx < x + w; xx++) this.setSolid(xx, y + h - 1);
    }
  }

  /** Casa con muros solidos, interior visible y al menos 2 puertas de 2 casillas. */
  house(
    kind: HouseKind,
    x: number,
    y: number,
    w: number,
    h: number,
    name: string,
    floor: number,
  ): House {
    const doors: { x: number; y: number }[] = [];
    const house: House = {
      id: this.nextHouse++,
      kind,
      x,
      y,
      w,
      h,
      doors,
      name,
      style: this.rng.int(0, 3),
    };
    this.reserve(x - 2, y - 2, w + 4, h + 4);
    this.fillGround(x, y, w, h, floor);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const edge = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
        if (edge) {
          this.setGround(xx, yy, G.HOUSEWALL);
          this.setSolid(xx, yy);
        }
      }
    }
    // Puertas: lados distintos, siempre 2 o 3.
    const sides = this.rng.shuffle(['N', 'S', 'E', 'W']);
    const count = this.rng.chance(0.35) ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const side = sides[i] as string;
      if (side === 'N' || side === 'S') {
        const dx = x + this.rng.int(1, w - 3);
        const dy = side === 'N' ? y : y + h - 1;
        for (let k = 0; k < 2; k++) {
          this.openDoor(dx + k, dy, house);
          this.reserve(dx + k, side === 'N' ? dy - 3 : dy + 1, 1, 3);
        }
      } else {
        const dy = y + this.rng.int(1, h - 3);
        const dx = side === 'W' ? x : x + w - 1;
        for (let k = 0; k < 2; k++) {
          this.openDoor(dx, dy + k, house);
          this.reserve(side === 'W' ? dx - 3 : dx + 1, dy + k, 3, 1);
        }
      }
    }
    this.m.houses.push(house);
    this.rects.push({ x, y, w, h });
    this.m.landmarks.push({ name, x: (x + w / 2) * TILE, y: (y + h / 2) * TILE, kind: 'house' });
    return house;
  }

  private openDoor(x: number, y: number, house: House): void {
    this.setSolid(x, y, 0);
    this.setGround(x, y, G.WOOD2);
    house.doors.push({ x, y });
  }

  /** Cama: mesa grande con cuatro patas. Los gatos entran por debajo desde 3 lados. */
  bed(x: number, y: number, w: number, h: number, name: string): House {
    const doors: { x: number; y: number }[] = [];
    const house: House = {
      id: this.nextHouse++,
      kind: 'bed',
      x,
      y,
      w,
      h,
      doors,
      name,
      style: this.rng.int(0, 3),
    };
    this.reserve(x - 1, y - 1, w + 2, h + 2);
    this.fillGround(x, y, w, h, G.BEDSHADE);
    // patas en las esquinas y cabecera cerrada al oeste
    for (const [px, py] of [
      [x, y],
      [x, y + h - 1],
      [x + w - 1, y],
      [x + w - 1, y + h - 1],
    ] as const) {
      this.setSolid(px, py);
    }
    for (let yy = y; yy < y + h; yy++) this.setSolid(x, yy);
    doors.push(
      { x: x + Math.floor(w / 2), y },
      { x: x + Math.floor(w / 2), y: y + h - 1 },
      { x: x + w - 1, y: y + Math.floor(h / 2) },
    );
    this.m.houses.push(house);
    this.rects.push({ x, y, w, h });
    this.m.landmarks.push({ name, x: (x + w / 2) * TILE, y: (y + h / 2) * TILE, kind: 'bed' });
    return house;
  }

  interiorTiles(house: House): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let yy = house.y + 1; yy < house.y + house.h - 1; yy++) {
      for (let xx = house.x + 1; xx < house.x + house.w - 1; xx++) {
        if (this.m.solid[this.at(xx, yy)] === 0) out.push({ x: xx, y: yy });
      }
    }
    return out;
  }

  chest(tx: number, ty: number, golden: boolean): void {
    this.m.chests.push({
      id: this.nextChest++,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      golden,
    });
    // Un cofre ocupa su casilla pero no la bloquea del todo: es solido para no atravesarlo.
    this.setSolid(tx, ty);
    this.reserved[this.at(tx, ty)] = 1;
  }

  /** Cofres dentro de cada casa (pegados a las paredes) y en lugares abiertos. */
  stockHouses(perHouse: number): void {
    for (const house of this.m.houses) {
      const doorSet = new Set(house.doors.map((d) => `${d.x},${d.y}`));
      const candidates = this.interiorTiles(house).filter((t) => {
        const nearWall =
          t.x === house.x + 1 ||
          t.y === house.y + 1 ||
          t.x === house.x + house.w - 2 ||
          t.y === house.y + house.h - 2;
        const nearDoor = [...doorSet].some((d) => {
          const [dx, dy] = d.split(',').map(Number) as [number, number];
          return Math.abs(dx - t.x) + Math.abs(dy - t.y) <= 1;
        });
        return nearWall && !nearDoor;
      });
      this.rng.shuffle(candidates);
      let placed = 0;
      for (const c of candidates) {
        if (placed >= perHouse) break;
        if (this.m.chests.some((o) => Math.hypot(o.x / TILE - c.x, o.y / TILE - c.y) < 3)) continue;
        this.chest(c.x, c.y, false);
        placed++;
      }
    }
  }

  scatterChests(count: number): void {
    const { w, h } = this.m;
    let attempts = 0;
    let placed = 0;
    while (placed < count && attempts++ < 800) {
      const x = this.rng.int(4, w - 5);
      const y = this.rng.int(4, h - 5);
      if (!this.isFree(x, y) || groundAt(this.m, x, y) === G.WATER) continue;
      if (this.m.chests.some((c) => Math.hypot(c.x / TILE - x, c.y / TILE - y) < 9)) continue;
      // Despejado alrededor para poder abrirlo.
      let open = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!isSolidTile(this.m, x + dx, y + dy)) open++;
      }
      if (open < 3) continue;
      this.chest(x, y, false);
      placed++;
    }
  }

  /** Marca algunos cofres como dorados: siempre al menos uno. */
  goldenChests(fraction: number): void {
    const list = this.m.chests;
    if (list.length === 0) return;
    for (const c of list) c.golden = this.rng.chance(fraction);
    if (!list.some((c) => c.golden)) (this.rng.pick(list) as ChestSpot).golden = true;
  }

  /** 10 puntos de aparicion repartidos en anillo, sobre casillas libres. */
  spawns(): void {
    const { w, h } = this.m;
    const cx = (w * TILE) / 2;
    const cy = (h * TILE) / 2;
    const radius = Math.min(w, h) * TILE * 0.38;
    const offset = this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const a = offset + (i / MAX_PLAYERS) * Math.PI * 2;
      const tx = Math.floor((cx + Math.cos(a) * radius * (0.85 + this.rng.next() * 0.3)) / TILE);
      const ty = Math.floor((cy + Math.sin(a) * radius * (0.85 + this.rng.next() * 0.3)) / TILE);
      const spot = this.findFree(tx, ty, 2);
      this.m.spawns.push({ x: spot.x * TILE + TILE / 2, y: spot.y * TILE + TILE / 2 });
    }
  }

  /** Casilla libre mas cercana con `clear` casillas de holgura. */
  findFree(tx: number, ty: number, clear: number): { x: number; y: number } {
    for (let r = 0; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (!inBounds(this.m, x, y) || groundAt(this.m, x, y) === G.WATER) continue;
          if (this.reserved[this.at(x, y)]) continue;
          let ok = true;
          for (let yy = y - clear; yy <= y + clear && ok; yy++) {
            for (let xx = x - clear; xx <= x + clear; xx++) {
              if (isSolidTile(this.m, xx, yy)) {
                ok = false;
                break;
              }
            }
          }
          if (ok) return { x, y };
        }
      }
    }
    return { x: tx, y: ty };
  }

  /** Camino de tierra (decorativo) entre dos puntos, solo sobre terreno libre. */
  path(ax: number, ay: number, bx: number, by: number, g: number): void {
    let x = ax;
    let y = ay;
    const stepX = bx > ax ? 1 : -1;
    const stepY = by > ay ? 1 : -1;
    while (x !== bx) {
      this.tryPath(x, y, g);
      x += stepX;
    }
    while (y !== by) {
      this.tryPath(x, y, g);
      y += stepY;
    }
  }

  private tryPath(x: number, y: number, g: number): void {
    if (!inBounds(this.m, x, y) || this.m.solid[this.at(x, y)] !== 0) return;
    const cur = this.m.ground[this.at(x, y)] as number;
    if (cur === G.WATER || cur === G.WOOD || cur === G.WOOD2) return;
    this.setGround(x, y, g);
    this.reserved[this.at(x, y)] = 1;
  }

  /** Asegura que todos los puntos de interes se puedan alcanzar sin pasar por muros. */
  connect(): void {
    const { w, h } = this.m;
    const start = this.m.spawns[0];
    if (!start) return;
    const sx = Math.floor(start.x / TILE);
    const sy = Math.floor(start.y / TILE);
    for (let pass = 0; pass < 6; pass++) {
      const seen = this.flood(sx, sy);
      const targets: Vec[] = [
        ...this.m.spawns,
        ...this.m.chests.map((c) => ({ x: c.x, y: c.y })),
        ...this.m.houses.flatMap((hs) =>
          hs.doors.map((d) => ({ x: d.x * TILE + 8, y: d.y * TILE + 8 })),
        ),
      ];
      let fixed = true;
      for (const t of targets) {
        const tx = Math.floor(t.x / TILE);
        const ty = Math.floor(t.y / TILE);
        if (seen[this.at(tx, ty)]) continue;
        // alguna casilla vecina alcanzable?
        const near = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(
          ([dx, dy]) => inBounds(this.m, tx + dx!, ty + dy!) && seen[this.at(tx + dx!, ty + dy!)],
        );
        if (near) continue;
        fixed = false;
        this.carveTo(tx, ty, seen);
      }
      if (fixed) return;
    }
    void w;
    void h;
  }

  private flood(sx: number, sy: number): Uint8Array {
    const seen = new Uint8Array(this.m.w * this.m.h);
    const stack = [this.at(sx, sy)];
    seen[stack[0] as number] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % this.m.w;
      const y = (i / this.m.w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(this.m, nx, ny)) continue;
        const ni = this.at(nx, ny);
        if (seen[ni] || this.m.solid[ni] !== 0) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    return seen;
  }

  /** Abre una linea recta de casillas hacia la zona alcanzable mas cercana. */
  private carveTo(tx: number, ty: number, seen: Uint8Array): void {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (let y = 2; y < this.m.h - 2; y++) {
      for (let x = 2; x < this.m.w - 2; x++) {
        if (!seen[this.at(x, y)]) continue;
        const d = Math.abs(x - tx) + Math.abs(y - ty);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (!best) return;
    let x = tx;
    let y = ty;
    while (x !== best.x || y !== best.y) {
      if (x !== best.x) x += best.x > x ? 1 : -1;
      else y += best.y > y ? 1 : -1;
      const i = this.at(x, y);
      const onWall = this.m.ground[i] === G.HOUSEWALL;
      // Nunca se abre un hueco extra en una casa; las puertas ya garantizan el acceso.
      if (!onWall && inBounds(this.m, x, y)) this.m.solid[i] = 0;
    }
  }
}

function baseGrass(b: Builder, floraRate: number): void {
  const { w, h, seed } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = hash2(x, y, seed);
      let g: number = G.GRASS;
      if (r < 0.18) g = G.GRASS2;
      else if (r < 0.3) g = G.GRASS3;
      if (hash2(x + 91, y + 17, seed) < floraRate)
        g = hash2(x, y + 5, seed) < 0.5 ? G.FLOWER : G.FLOWER2;
      b.setGround(x, y, g);
    }
  }
}

function placeHouses(
  b: Builder,
  count: number,
  sizes: [number, number][],
  names: string[],
  kind: HouseKind,
  floor: number,
  margin: number,
): void {
  const { w, h } = b.m;
  const pool = b.rng.shuffle([...names]);
  let attempts = 0;
  while (b.m.houses.length < count && attempts++ < 400) {
    const [hw, hh] = b.rng.pick(sizes);
    const x = b.rng.int(6, w - 6 - hw);
    const y = b.rng.int(6, h - 6 - hh);
    const rect: Rect = { x, y, w: hw, h: hh };
    if (b.rects.some((r) => overlaps(rect, r, margin))) continue;
    b.house(kind, x, y, hw, hh, pool[b.m.houses.length % pool.length] as string, floor);
  }
}

function connectPaths(b: Builder, g: number): void {
  const doors = b.m.houses.map((hs) => {
    const d = hs.doors[0] as { x: number; y: number };
    const side = d.y === hs.y ? -2 : d.y === hs.y + hs.h - 1 ? 2 : 0;
    const sideX = d.x === hs.x ? -2 : d.x === hs.x + hs.w - 1 ? 2 : 0;
    return { x: d.x + sideX, y: d.y + side };
  });
  for (let i = 1; i < doors.length; i++) {
    const a = doors[i - 1] as { x: number; y: number };
    const c = doors[i] as { x: number; y: number };
    b.path(a.x, a.y, c.x, c.y, g);
  }
}

// ------------------------------------------------------------------ bosque

function buildBosque(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'bosque', seed, 96, 64);
  baseGrass(b, 0.035);
  b.border(G.HEDGE);
  placeHouses(
    b,
    8,
    [
      [8, 6],
      [9, 7],
      [10, 7],
      [7, 6],
    ],
    NAMES_BOSQUE,
    'house',
    G.WOOD,
    5,
  );
  for (const house of b.m.houses) {
    const spots = b.interiorTiles(house).filter((t) => t.x > house.x + 1 && t.y > house.y + 1);
    if (spots.length > 8 && rng.chance(0.55)) {
      const t = rng.pick(spots);
      b.addProp('table', t.x, t.y, 1, 1, 'all');
    }
  }
  connectPaths(b, G.PATH);
  b.stockHouses(2);

  // Bosque: ruido para que haya zonas densas y claros.
  const cell = new Set<string>();
  let attempts = 0;
  while (attempts++ < 2400) {
    const x = rng.int(3, b.m.w - 4);
    const y = rng.int(3, b.m.h - 4);
    if (!b.isFree(x, y) || b.m.ground[b.at(x, y)] === G.PATH) continue;
    const density = noise(x / 9, y / 9, seed) * 0.9 + 0.1;
    if (rng.next() > density * 0.8) continue;
    const key = `${x >> 1},${y >> 1}`;
    if (cell.has(key)) continue;
    cell.add(key);
    const kind: PropKind = rng.chance(0.6) ? 'tree' : 'pine';
    b.addProp(kind, x, y, 1, 1, 'all');
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.int(3, b.m.w - 4);
    const y = rng.int(3, b.m.h - 4);
    if (!b.isFree(x, y)) continue;
    const kind: PropKind = rng.chance(0.55) ? 'rock' : rng.chance(0.5) ? 'log' : 'bush';
    b.addProp(kind, x, y, 1, 1, kind === 'bush' ? 'none' : 'all');
  }
  b.scatterChests(11);
  b.goldenChests(0.14);
  b.spawns();
  b.connect();
  return b.m;
}

// ------------------------------------------------------------------ casa de gatitos

function buildCasa(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'casa', seed, 80, 56);
  const { w, h } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      b.setGround(x, y, (x + y) % 2 === 0 || hash2(x, y, seed) < 0.1 ? G.WOOD : G.WOOD2);
    }
  }
  b.border(G.WALLTOP);
  // Paredes interiores con puertas amplias.
  const wallX = [Math.floor(w / 3), Math.floor((w * 2) / 3)];
  for (const wx of wallX) {
    const gapA = rng.int(8, h - 18);
    const gapB = rng.int(gapA + 14, h - 8);
    for (let y = 2; y < h - 2; y++) {
      const inGap = (y >= gapA && y < gapA + 6) || (y >= gapB && y < gapB + 6);
      if (inGap) {
        b.reserve(wx - 2, y, 5, 1);
        continue;
      }
      b.setGround(wx, y, G.WALLTOP);
      b.setSolid(wx, y);
    }
  }
  // Alfombras decorativas.
  for (let i = 0; i < 5; i++) {
    const rw = rng.int(8, 14);
    const rh = rng.int(5, 8);
    const x = rng.int(5, w - 5 - rw);
    const y = rng.int(5, h - 5 - rh);
    b.fillGround(x, y, rw, rh, G.CARPET);
    b.m.props.push({ kind: 'rug', x, y, w: rw, h: rh });
  }
  // Camas: las "casas" de este mapa. Los gatos se meten debajo.
  const bedNames = rng.shuffle([...NAMES_CAMA]);
  let attempts = 0;
  while (b.m.houses.length < 6 && attempts++ < 500) {
    const bw = rng.pick([10, 11, 12]);
    const bh = rng.pick([6, 7]);
    const x = rng.int(5, w - 5 - bw);
    const y = rng.int(5, h - 5 - bh);
    const rect: Rect = { x, y, w: bw, h: bh };
    if (b.rects.some((r) => overlaps(rect, r, 4))) continue;
    if (wallX.some((wx) => x - 1 <= wx && wx <= x + bw)) continue;
    b.bed(x, y, bw, bh, bedNames[b.m.houses.length % bedNames.length] as string);
  }
  b.stockHouses(2);
  // Muebles: sillones, mesas, estantes, plantas y arboles para gatos.
  attempts = 0;
  let furniture = 0;
  while (furniture < 40 && attempts++ < 900) {
    const kind = rng.pick<PropKind>([
      'couch',
      'table',
      'shelf',
      'plant',
      'cattree',
      'crate',
      'crate',
    ]);
    const [pw, ph] =
      kind === 'couch'
        ? [4, 2]
        : kind === 'table'
          ? [3, 2]
          : kind === 'shelf'
            ? [3, 1]
            : kind === 'cattree'
              ? [2, 2]
              : [1, 1];
    const x = rng.int(4, w - 4 - pw);
    const y = rng.int(4, h - 4 - ph);
    let ok = true;
    for (let yy = y - 1; yy <= y + ph && ok; yy++) {
      for (let xx = x - 1; xx <= x + pw && ok; xx++) {
        if (!inBounds(b.m, xx, yy) || b.m.solid[b.at(xx, yy)] !== 0 || b.reserved[b.at(xx, yy)])
          ok = false;
      }
    }
    if (!ok) continue;
    b.addProp(kind, x, y, pw, ph, 'all');
    b.reserve(x - 1, y - 1, pw + 2, ph + 2);
    furniture++;
  }
  b.scatterChests(9);
  b.goldenChests(0.14);
  b.spawns();
  b.connect();
  return b.m;
}

// ------------------------------------------------------------------ piscina

function buildPiscina(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'piscina', seed, 88, 60);
  const { w, h } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      b.setGround(x, y, (x >> 1) % 2 === (y >> 1) % 2 ? G.DECK : G.DECK2);
      if (hash2(x, y, seed) < 0.06) b.setGround(x, y, G.GRASS2);
    }
  }
  b.border(G.HEDGE);
  // Alberca grande al centro y una chica (el agua hace daño).
  const pw = rng.int(30, 36);
  const ph = rng.int(18, 22);
  const px = Math.floor(w / 2 - pw / 2) + rng.int(-4, 4);
  const py = Math.floor(h / 2 - ph / 2) + rng.int(-3, 3);
  const pool = (x: number, y: number, ww: number, hh: number): void => {
    b.fillGround(x - 1, y - 1, ww + 2, hh + 2, G.POOLEDGE);
    for (let yy = y; yy < y + hh; yy++) {
      for (let xx = x; xx < x + ww; xx++) {
        const corner =
          (xx === x || xx === x + ww - 1) && (yy === y || yy === y + hh - 1) && ww > 8 && hh > 8;
        b.setGround(xx, yy, corner ? G.POOLEDGE : G.WATER);
      }
    }
    b.reserve(x - 2, y - 2, ww + 4, hh + 4);
    b.rects.push({ x: x - 1, y: y - 1, w: ww + 2, h: hh + 2 });
    b.m.landmarks.push({
      name: 'Piscina',
      x: (x + ww / 2) * TILE,
      y: (y + hh / 2) * TILE,
      kind: 'water',
    });
  };
  pool(px, py, pw, ph);
  const sx = rng.chance(0.5) ? 6 : w - 6 - 12;
  const sy = rng.chance(0.5) ? 6 : h - 6 - 9;
  pool(sx, sy, 12, 9);
  // Patitos de hule decorativos en el agua.
  for (let i = 0; i < 4; i++) {
    const x = rng.int(px + 2, px + pw - 3);
    const y = rng.int(py + 2, py + ph - 3);
    b.m.props.push({ kind: 'duck', x, y, w: 1, h: 1 });
  }
  placeHouses(
    b,
    5,
    [
      [8, 6],
      [8, 7],
      [9, 6],
    ],
    NAMES_CABANA,
    'cabin',
    G.WOOD2,
    4,
  );
  connectPaths(b, G.DECK2);
  b.stockHouses(2);
  // Camastros y sombrillas junto a la alberca, palmeras y arbustos por fuera.
  let attempts = 0;
  let placed = 0;
  while (placed < 22 && attempts++ < 700) {
    const x = rng.int(4, w - 5);
    const y = rng.int(4, h - 5);
    if (!b.isFree(x, y) || b.m.ground[b.at(x, y)] === G.WATER) continue;
    const kind = rng.pick<PropKind>(['sunbed', 'parasol', 'palm', 'palm', 'bush', 'crate']);
    if (kind === 'sunbed') {
      if (!b.isFree(x + 1, y)) continue;
      b.addProp('sunbed', x, y, 2, 1, 'all');
      b.reserve(x - 1, y - 1, 4, 3);
    } else {
      b.addProp(kind, x, y, 1, 1, kind === 'bush' ? 'none' : 'all');
      b.reserve(x, y, 1, 1);
    }
    placed++;
  }
  b.scatterChests(11);
  b.goldenChests(0.14);
  b.spawns();
  b.connect();
  return b.m;
}

function validate(m: BRMap): boolean {
  if (m.houses.length < (m.kind === 'piscina' ? 4 : 5)) return false;
  if (m.houses.some((hs) => hs.doors.length < 2)) return false;
  if (m.chests.length < 14) return false;
  if (m.spawns.length !== MAX_PLAYERS) return false;
  // Los puntos de aparicion deben estar bien separados.
  for (let i = 0; i < m.spawns.length; i++) {
    for (let j = i + 1; j < m.spawns.length; j++) {
      const a = m.spawns[i] as Vec;
      const c = m.spawns[j] as Vec;
      if (Math.hypot(a.x - c.x, a.y - c.y) < 7 * TILE) return false;
    }
  }
  return true;
}

/**
 * Genera un mapa completo de forma determinista. Cliente y servidor llaman con la misma semilla
 * y obtienen exactamente el mismo mundo, asi solo viaja la semilla.
 */
export function generateMap(kind: MapKind, seed: number): BRMap {
  for (let attempt = 0; attempt < 60; attempt++) {
    // El ruido del terreno tambien depende de la semilla, asi que cada intento la cambia.
    const s = attempt === 0 ? seed : (seed ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
    const rng = createRng((seed + attempt * 104729) >>> 0);
    const m =
      kind === 'bosque'
        ? buildBosque(rng, s)
        : kind === 'casa'
          ? buildCasa(rng, s)
          : buildPiscina(rng, s);
    if (validate(m)) {
      m.seed = seed;
      return m;
    }
  }
  throw new Error(`no se pudo generar el mapa ${kind} para la semilla ${seed}`);
}

/** Casillas alcanzables desde un punto (cuatro vecinos), para pruebas y para los bots. */
export function reachable(m: BRMap, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(m.w * m.h);
  if (isSolidTile(m, sx, sy)) return seen;
  const stack = [sy * m.w + sx];
  seen[stack[0] as number] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % m.w;
    const y = (i / m.w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (isSolidTile(m, nx, ny)) continue;
      const ni = ny * m.w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}
