import type { Rng } from '../rng';
import { MAX_PLAYERS, TILE } from './constants';

export type MapKind =
  | 'bosque'
  | 'casa'
  | 'piscina'
  | 'tejado'
  | 'azotea'
  | 'mansarda'
  | 'calle'
  | 'patios'
  | 'encantado';

/** Mapas del Battle Royale (los que salen al azar en ese modo). */
export const MAP_KINDS: readonly MapKind[] = ['bosque', 'casa', 'piscina'];
/** Los tres techos de "Pelea en el techo". */
export const DUEL_MAPS: readonly MapKind[] = ['tejado', 'azotea', 'mansarda'];
/** Las calles y patios de "Territorio". */
export const TERRITORY_MAPS: readonly MapKind[] = ['calle', 'patios'];
/** El bosque encantado de "Aventura". */
export const ADVENTURE_MAPS: readonly MapKind[] = ['encantado'];
export const ALL_MAP_KINDS: readonly MapKind[] = [
  ...MAP_KINDS,
  ...DUEL_MAPS,
  ...TERRITORY_MAPS,
  ...ADVENTURE_MAPS,
];

export const MAP_NAMES: Record<MapKind, string> = {
  bosque: 'Bosque',
  casa: 'Casa de gatitos',
  piscina: 'Piscina',
  tejado: 'Tejado a dos aguas',
  azotea: 'Azotea con antenas',
  mansarda: 'Mansarda de pizarra',
  calle: 'Calle del barrio',
  patios: 'Patios traseros',
  encantado: 'Bosque encantado',
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
  // techos
  TEJA: 20,
  TEJA2: 21,
  PIZARRA: 22,
  PIZARRA2: 23,
  ALQUITRAN: 24,
  ALQUITRAN2: 25,
  CANALON: 26,
  PARAPETO: 27,
  CUMBRERA: 28,
  // calles y patios
  ASFALTO: 29,
  ASFALTO2: 30,
  ACERA: 31,
  CEBRA: 32,
  RAYA: 33,
  ADOQUIN: 34,
  PATIO: 35,
  CESPED: 36,
  // bosque encantado
  MUSGO: 37,
  RUNAS: 38,
  HONGOS: 39,
  CHARCO: 40,
  NIEBLA: 41,
  /** Zarzal: la espesura que cierra el bosque encantado (solido). */
  ZARZAL: 42,
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
  | 'pumpkin'
  | 'rug'
  // techos
  | 'chimney'
  | 'tank'
  | 'antenna'
  | 'vent'
  | 'ac'
  | 'dormer'
  | 'skylight'
  | 'dome'
  // calles y patios
  | 'car'
  | 'dumpster'
  | 'lamp'
  | 'bench'
  | 'busstop'
  | 'planter'
  | 'fence'
  | 'shed'
  | 'swing'
  | 'laundry'
  // bosque encantado
  | 'mushroom'
  | 'statue'
  | 'crystal'
  | 'stump'
  | 'ruin';

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
  /** Caja de municion: trae varias clases de balas y no tiene cofre dorado. */
  ammo: boolean;
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
  /** Modos por equipos: puntos de aparicion de cada equipo (pixeles). */
  teamSpawns?: [Vec[], Vec[]];
  /** Territorio: los patios que se disputan (centro y radio en pixeles). */
  points?: { x: number; y: number; r: number; name: string }[];
  /** Aventura: salas del bosque encantado (en casillas). */
  rooms?: AdventureRoom[];
}

export type AdventureRoomKind = 'inicio' | 'combate' | 'tesoro' | 'descanso' | 'minijefe' | 'jefe';

export interface AdventureRoom {
  id: number;
  /** Rectangulo del claro, en casillas. */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: AdventureRoomKind;
  name: string;
  /** Acto (0 a 5): cuantos jefes se vencieron antes de llegar. */
  act: number;
  /** Indices de las salas conectadas. */
  links: number[];
  /** Casillas de las puertas de enredadera que cierran esta sala. */
  gates: { x: number; y: number }[];
  /** Tipo de jefe (MOB) en las salas de jefe. */
  boss?: number;
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

export const NAMES_BOSQUE = [
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
  'Maullido',
  'Lanita',
  'Bigotitos',
];
export const NAMES_CAMA = [
  'Cama de Mimi',
  'Cama de Pelusa',
  'Cama de Luna',
  'Cama de Tigre',
  'Cama de Nube',
  'Cama de Mochi',
  'Cama de Canela',
  'Cama de Churro',
];
export const NAMES_CABANA = [
  'Vestidor',
  'Bar del Atún',
  'Cabaña Salmón',
  'Caseta Splash',
  'Cabaña Coral',
  'Snack Bar',
  'Cabaña Delfín',
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect, margin: number): boolean =>
  a.x < b.x + b.w + margin &&
  a.x + a.w + margin > b.x &&
  a.y < b.y + b.h + margin &&
  a.y + a.h + margin > b.y;

export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor suave para formar bosques densos y claros. */
export function noise(x: number, y: number, seed: number): number {
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

export class Builder {
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

  chest(tx: number, ty: number, golden: boolean, ammo = false): void {
    this.m.chests.push({
      id: this.nextChest++,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      golden,
      ammo,
    });
    // Un cofre ocupa su casilla pero no la bloquea del todo: es solido para no atravesarlo.
    this.setSolid(tx, ty);
    this.reserved[this.at(tx, ty)] = 1;
  }

  /** Cofres dentro de cada casa (pegados a las paredes): entre `min` y `max` por casa. */
  stockHouses(min: number, max: number): void {
    for (const house of this.m.houses) {
      const perHouse = this.rng.int(min, max);
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

  /**
   * Cajas de municion en lugares abiertos, repartidas por todo el mapa y lejos de los cofres,
   * para que haya municion cerca de casi cualquier punto de aparicion.
   */
  ammoCrates(count: number): void {
    const { w, h } = this.m;
    let attempts = 0;
    let placed = 0;
    while (placed < count && attempts++ < 1500) {
      const x = this.rng.int(4, w - 5);
      const y = this.rng.int(4, h - 5);
      if (!this.isFree(x, y) || groundAt(this.m, x, y) === G.WATER) continue;
      if (this.m.chests.some((c) => Math.hypot(c.x / TILE - x, c.y / TILE - y) < 7)) continue;
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
      this.chest(x, y, false, true);
      placed++;
    }
  }

  /** Marca algunos cofres como dorados (nunca las cajas de municion): siempre al menos uno. */
  goldenChests(fraction: number): void {
    const list = this.m.chests.filter((c) => !c.ammo);
    if (list.length === 0) return;
    for (const c of list) c.golden = this.rng.chance(fraction);
    if (!list.some((c) => c.golden)) (this.rng.pick(list) as ChestSpot).golden = true;
  }

  /**
   * Un punto de aparicion por jugador, repartidos en anillo sobre casillas libres y separados al
   * menos 8 casillas entre si (en un bosque denso las casillas libres escasean y un reparto
   * ingenuo los amontona en los claros).
   */
  spawns(): void {
    const { w, h } = this.m;
    const cx = (w * TILE) / 2;
    const cy = (h * TILE) / 2;
    const radius = Math.min(w, h) * TILE * 0.38;
    const offset = this.rng.range(0, Math.PI * 2);
    const minGap = 8 * TILE;
    const spots: Vec[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const slot = (Math.PI * 2) / MAX_PLAYERS;
      let best: Vec | null = null;
      let bestGap = -1;
      for (let attempt = 0; attempt < 16 && bestGap < minGap; attempt++) {
        const a = offset + i * slot + (attempt === 0 ? 0 : this.rng.range(-0.45, 0.45) * slot);
        const rr = radius * (attempt === 0 ? 1 : this.rng.range(0.55, 1.15));
        const tx = Math.floor((cx + Math.cos(a) * rr) / TILE);
        const ty = Math.floor((cy + Math.sin(a) * rr) / TILE);
        const spot = this.findFree(tx, ty, attempt < 8 ? 2 : 1);
        const pos = { x: spot.x * TILE + TILE / 2, y: spot.y * TILE + TILE / 2 };
        const gap = spots.reduce(
          (m, o) => Math.min(m, Math.hypot(o.x - pos.x, o.y - pos.y)),
          Infinity,
        );
        if (gap > bestGap) {
          bestGap = gap;
          best = pos;
        }
      }
      spots.push(best as Vec);
    }
    this.m.spawns.push(...spots);
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

export function baseGrass(b: Builder, floraRate: number): void {
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

export function placeHouses(
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

export function connectPaths(b: Builder, g: number): void {
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
