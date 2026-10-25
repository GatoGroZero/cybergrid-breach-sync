import type { Rng } from '../rng';
import { TILE } from './constants';
import { Builder, G, inBounds, isSolidTile, type BRMap, type PropKind, type Vec } from './mapcore';

/**
 * Mapas de equipos (techos y calles). Se arma solo la mitad izquierda y se refleja a la derecha:
 * asi los dos equipos tienen exactamente las mismas coberturas, las mismas distancias y los mismos
 * puntos de aparicion. La semilla cambia el reparto de una partida a otra.
 */

/** Copia la mitad izquierda del mapa (x < w / 2) en la derecha, de forma especular. */
export function mirrorLeftToRight(m: BRMap): void {
  const { w, h } = m;
  const half = Math.floor(w / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < half; x++) {
      const a = y * w + x;
      const b = y * w + (w - 1 - x);
      m.ground[b] = m.ground[a] as number;
      m.solid[b] = m.solid[a] as number;
    }
  }
  const props = [...m.props];
  for (const p of props) {
    if (p.x + p.w <= half) m.props.push({ ...p, x: w - p.x - p.w });
  }
  const houses = [...m.houses];
  let nextId = houses.reduce((mx, hs) => Math.max(mx, hs.id), 0) + 1;
  for (const hs of houses) {
    if (hs.x + hs.w > half) continue;
    m.houses.push({
      ...hs,
      id: nextId++,
      x: w - hs.x - hs.w,
      doors: hs.doors.map((d) => ({ x: w - 1 - d.x, y: d.y })),
    });
  }
  const chests = [...m.chests];
  let nextChest = chests.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  for (const c of chests) {
    if (c.x < half * TILE) m.chests.push({ ...c, id: nextChest++, x: w * TILE - c.x });
  }
  if (m.points) {
    const left = [...m.points];
    for (const p of left) {
      if (p.x < (half - 1) * TILE) m.points.push({ ...p, x: w * TILE - p.x });
    }
  }
}

const tileCenter = (x: number, y: number): Vec => ({
  x: x * TILE + TILE / 2,
  y: y * TILE + TILE / 2,
});

interface Cover {
  kind: PropKind;
  w: number;
  h: number;
  /** Cuantas piezas hay en la mitad izquierda: entre min y max. */
  count: [number, number];
  solid: 'all' | 'base' | 'none';
  /** Piezas que no deben quedar pegadas al eje del centro. */
  edge?: boolean;
}

/** Reparte coberturas en la mitad izquierda sin tapar las salidas ni los puntos de aparicion. */
function scatterCovers(
  b: Builder,
  rng: Rng,
  covers: Cover[],
  keep: { x: number; y: number; r: number }[],
): void {
  const { w, h } = b.m;
  const half = Math.floor(w / 2);
  for (const c of covers) {
    const want = rng.int(c.count[0], c.count[1]);
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
      const x = rng.int(4, half - 3 - c.w);
      const y = rng.int(4, h - 4 - c.h);
      // lejos de los puntos de aparicion y de las cajas
      if (keep.some((k) => Math.hypot(k.x - (x + c.w / 2), k.y - (y + c.h / 2)) < k.r)) continue;
      let ok = true;
      for (let yy = y - 1; yy <= y + c.h && ok; yy++) {
        for (let xx = x - 1; xx <= x + c.w && ok; xx++) {
          if (!inBounds(b.m, xx, yy) || b.m.solid[b.at(xx, yy)] !== 0 || b.reserved[b.at(xx, yy)])
            ok = false;
        }
      }
      if (!ok) continue;
      b.addProp(c.kind, x, y, c.w, c.h, c.solid);
      b.reserve(x - 1, y - 1, c.w + 2, c.h + 2);
      placed++;
    }
  }
}

/** Puntos de aparicion (2 por equipo) y cajas de municion simetricas. */
function placeTeamSpawns(b: Builder): { x: number; y: number; r: number }[] {
  const { w, h } = b.m;
  const spots: Vec[] = [tileCenter(5, Math.floor(h / 2) - 4), tileCenter(5, Math.floor(h / 2) + 4)];
  const mirrored = spots.map((s) => ({ x: w * TILE - s.x, y: s.y }));
  b.m.teamSpawns = [spots, mirrored];
  b.m.spawns = [...spots, ...mirrored];
  for (const s of spots) b.reserve(Math.floor(s.x / TILE) - 3, Math.floor(s.y / TILE) - 3, 7, 7);
  return spots.map((s) => ({ x: s.x / TILE, y: s.y / TILE, r: 6 }));
}

function placeCrates(b: Builder): { x: number; y: number; r: number }[] {
  const { w, h } = b.m;
  const half = Math.floor(w / 2);
  const spots: [number, number][] = [
    [half - 6, 6],
    [half - 6, h - 7],
  ];
  for (const [x, y] of spots) b.chest(x, y, false, true);
  return spots.map(([x, y]) => ({ x, y, r: 3 }));
}

/** Franja libre al centro: nadie la tapa por completo, siempre se puede cruzar. */
function reserveCenterLane(b: Builder): void {
  const { w, h } = b.m;
  const half = Math.floor(w / 2);
  b.reserve(half - 2, 3, 4, h - 6);
}

function finishPvp(b: Builder): BRMap {
  mirrorLeftToRight(b.m);
  return b.m;
}

// ------------------------------------------------------------------ tejado a dos aguas

/** Tejas rojas con cumbrera al centro, chimeneas y tragaluces. */
export function buildTejado(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'tejado', seed, 40, 26);
  const { w, h } = b.m;
  const mid = Math.floor(h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const slope = y < mid ? 0 : 1;
      const row = (y + (x >> 2)) % 2;
      b.setGround(x, y, slope === 0 ? (row ? G.TEJA : G.TEJA2) : row ? G.TEJA2 : G.TEJA);
    }
  }
  b.border(G.PARAPETO);
  // canalon por dentro del borde
  for (let x = 2; x < w - 2; x++) {
    b.setGround(x, 2, G.CANALON);
    b.setGround(x, h - 3, G.CANALON);
  }
  for (let y = 2; y < h - 2; y++) {
    b.setGround(2, y, G.CANALON);
    b.setGround(w - 3, y, G.CANALON);
  }
  // cumbrera: una viga que parte el tejado en dos aguas, con pasos para cruzar
  const gaps = new Set<number>([5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]);
  for (let x = 4; x < w - 4; x++) {
    b.setGround(x, mid - 1, G.CUMBRERA);
    b.setGround(x, mid, G.CUMBRERA);
    const left = x < Math.floor(w / 2);
    const gapX = left ? x : w - 1 - x;
    if (!gaps.has(gapX)) {
      b.setSolid(x, mid - 1);
      b.setSolid(x, mid);
    }
  }
  const keep = [...placeTeamSpawns(b)];
  reserveCenterLane(b);
  keep.push(...placeCrates(b));
  scatterCovers(
    b,
    rng,
    [
      { kind: 'chimney', w: 2, h: 2, count: [2, 3], solid: 'all' },
      { kind: 'vent', w: 1, h: 1, count: [2, 4], solid: 'all' },
      { kind: 'antenna', w: 1, h: 1, count: [1, 2], solid: 'all' },
      { kind: 'skylight', w: 2, h: 2, count: [1, 2], solid: 'none' },
    ],
    keep,
  );
  return finishPvp(b);
}

// ------------------------------------------------------------------ azotea con antenas

/** Azotea de alquitran con tinacos, aires acondicionados y la garita de la escalera. */
export function buildAzotea(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'azotea', seed, 40, 26);
  const { w, h } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const patch = ((x >> 3) + (y >> 3)) % 2 === 0;
      b.setGround(x, y, patch ? G.ALQUITRAN : G.ALQUITRAN2);
    }
  }
  b.border(G.PARAPETO);
  for (let x = 2; x < w - 2; x++) {
    b.setGround(x, 2, G.CANALON);
    b.setGround(x, h - 3, G.CANALON);
  }
  for (let y = 2; y < h - 2; y++) {
    b.setGround(2, y, G.CANALON);
    b.setGround(w - 3, y, G.CANALON);
  }
  const keep = [...placeTeamSpawns(b)];
  reserveCenterLane(b);
  keep.push(...placeCrates(b));
  scatterCovers(
    b,
    rng,
    [
      { kind: 'tank', w: 3, h: 3, count: [1, 2], solid: 'all' },
      { kind: 'ac', w: 2, h: 1, count: [3, 5], solid: 'all' },
      { kind: 'vent', w: 1, h: 1, count: [2, 4], solid: 'all' },
      { kind: 'antenna', w: 1, h: 1, count: [2, 3], solid: 'all' },
      { kind: 'laundry', w: 3, h: 1, count: [1, 2], solid: 'none' },
    ],
    keep,
  );
  // la garita de la escalera queda al centro: una pared que se rodea por arriba o por abajo
  const gx = Math.floor(w / 2) - 2;
  const gy = Math.floor(h / 2) - 2;
  b.addProp('shed', gx, gy, 4, 4, 'all');
  return finishPvp(b);
}

// ------------------------------------------------------------------ mansarda de pizarra

/** Tejado de pizarra con buhardillas y una cupula al centro. */
export function buildMansarda(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'mansarda', seed, 40, 26);
  const { w, h } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = Math.abs(x - w / 2) % 4 < 2;
      b.setGround(x, y, col ? G.PIZARRA : G.PIZARRA2);
    }
  }
  b.border(G.PARAPETO);
  for (let x = 2; x < w - 2; x++) {
    b.setGround(x, 2, G.CANALON);
    b.setGround(x, h - 3, G.CANALON);
  }
  for (let y = 2; y < h - 2; y++) {
    b.setGround(2, y, G.CANALON);
    b.setGround(w - 3, y, G.CANALON);
  }
  const keep = [...placeTeamSpawns(b)];
  reserveCenterLane(b);
  keep.push(...placeCrates(b));
  scatterCovers(
    b,
    rng,
    [
      { kind: 'dormer', w: 3, h: 2, count: [2, 3], solid: 'all' },
      { kind: 'chimney', w: 2, h: 2, count: [1, 2], solid: 'all' },
      { kind: 'vent', w: 1, h: 1, count: [2, 3], solid: 'all' },
      { kind: 'antenna', w: 1, h: 1, count: [1, 2], solid: 'all' },
    ],
    keep,
  );
  const dx = Math.floor(w / 2) - 2;
  const dy = Math.floor(h / 2) - 2;
  b.addProp('dome', dx, dy, 4, 4, 'all');
  return finishPvp(b);
}

// ------------------------------------------------------------------ calle del barrio

const NAMES_CALLE = [
  'Tienda de la esquina',
  'Panadería',
  'Veterinaria',
  'Pescadería',
  'Casa azul',
  'Casa verde',
  'Ferretería',
  'Casa del farol',
  'Cafetería',
  'Taller',
];

const NAMES_PATIOS = [
  'Casa del roble',
  'Casa de la higuera',
  'Casa del limón',
  'Casa del columpio',
  'Casa del lavadero',
  'Casa del naranjo',
];

/** Cinco lugares de aparicion por equipo, en fila vertical, y sus espejos. */
function placeSquadSpawns(b: Builder, x: number): void {
  const { w, h } = b.m;
  const mid = Math.floor(h / 2);
  const left: Vec[] = [-8, -4, 0, 4, 8].map((dy) => tileCenter(x, mid + dy));
  const right = left.map((s) => ({ x: w * TILE - s.x, y: s.y }));
  b.m.teamSpawns = [left, right];
  b.m.spawns = [...left, ...right];
  for (const s of left) b.reserve(Math.floor(s.x / TILE) - 2, Math.floor(s.y / TILE) - 2, 5, 5);
}

/** Casilla libre al azar dentro de una franja (para cajas de municion y adornos). */
function freeSpot(
  b: Builder,
  rng: Rng,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  tries = 200,
): { x: number; y: number } | null {
  for (let i = 0; i < tries; i++) {
    const x = rng.int(x0, x1);
    const y = rng.int(y0, y1);
    if (b.isFree(x, y)) return { x, y };
  }
  return null;
}

/** Calles con asfalto, aceras, pasos de cebra y un cruce al centro, mas casas a los lados. */
export function buildCalle(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'calle', seed, 96, 60);
  const { w, h } = b.m;
  const half = w / 2;
  const mid = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) b.setGround(x, y, hash2s(x, y, seed) < 0.12 ? G.CESPED : G.CESPED);
  }
  b.border(G.HEDGE);
  // avenida y calle del centro
  for (let x = 2; x < w - 2; x++) {
    for (let y = mid - 5; y <= mid + 4; y++) b.setGround(x, y, G.ASFALTO);
    for (let k = 0; k < 3; k++) {
      b.setGround(x, mid - 8 + k, G.ACERA);
      b.setGround(x, mid + 5 + k, G.ACERA);
    }
    if (x % 6 < 3) {
      b.setGround(x, mid - 1, G.RAYA);
      b.setGround(x, mid, G.RAYA);
    }
  }
  for (let x = half - 4; x < half; x++) {
    for (let y = 2; y < h - 2; y++) {
      if (y >= mid - 8 && y <= mid + 7) continue;
      b.setGround(x, y, G.ASFALTO);
    }
    for (let y = mid - 8; y <= mid + 7; y++) b.setGround(x, y, G.ASFALTO);
  }
  for (let y = 2; y < h - 2; y++) {
    if (y >= mid - 8 && y <= mid + 7) continue;
    b.setGround(half - 7, y, G.ACERA);
    b.setGround(half - 6, y, G.ACERA);
    b.setGround(half - 5, y, G.ACERA);
  }
  // pasos de cebra a cada lado del cruce
  for (const x0 of [half - 12, half - 20]) {
    for (let x = x0; x < x0 + 2; x++) {
      for (let y = mid - 5; y <= mid + 4; y++) b.setGround(x, y, G.CEBRA);
    }
  }
  // desgaste del asfalto
  for (let y = mid - 5; y <= mid + 4; y++)
    for (let x = 3; x < half; x++) if (hash2s(x, y, seed + 9) < 0.06) b.setGround(x, y, G.ASFALTO2);
  // plaza adoquinada del centro, del patio oeste y de la salida
  const plaza = (cx: number, cy: number, r: number): void => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1 && x < half + 1)
          b.setGround(x, y, G.ADOQUIN);
  };
  plaza(half - 1, mid, 5);
  plaza(26, mid, 4);
  b.fillGround(3, mid - 10, 10, 21, G.ADOQUIN);
  b.reserve(2, mid - 11, 12, 23);
  b.reserve(half - 8, mid - 10, 9, 21);
  b.reserve(26 - 5, mid - 5, 11, 11);
  const spawnX = 6;
  placeSquadSpawns(b, spawnX);
  b.m.points = [
    { x: 26 * TILE + TILE / 2, y: mid * TILE, r: 44, name: 'Plaza oeste' },
    { x: half * TILE, y: mid * TILE, r: 48, name: 'El cruce' },
  ];

  // manzanas con casas al norte y al sur de la avenida
  const slots: { x0: number; x1: number }[] = [
    { x0: 15, x1: 25 },
    { x0: 27, x1: 37 },
  ];
  for (const north of [true, false]) {
    for (const [i, slot] of slots.entries()) {
      const bw = rng.int(8, Math.min(11, slot.x1 - slot.x0 + 1));
      const bh = rng.int(6, 9);
      const x = rng.int(slot.x0, slot.x1 - bw + 1);
      const y = north ? rng.int(4, mid - 11 - bh + 1) : rng.int(mid + 11, h - 5 - bh);
      const names = [...NAMES_CALLE];
      b.house('house', x, y, bw, bh, rng.pick(names), G.WOOD);
      void i;
    }
  }
  // detras de las casas, mas verde: arboles y arbustos
  for (let k = 0; k < 14; k++) {
    const spot = freeSpot(b, rng, 14, half - 9, 3, h - 4);
    if (!spot) continue;
    if (spot.y > mid - 9 && spot.y < mid + 9) continue;
    b.addProp(rng.chance(0.55) ? 'tree' : 'bush', spot.x, spot.y, 1, 1, 'none');
    if (b.m.props[b.m.props.length - 1]?.kind === 'tree') b.setSolid(spot.x, spot.y);
  }
  // coches, contenedores, farolas, paradas y macetas
  const lamp = (x: number, y: number): void => {
    if (b.isFree(x, y)) b.addProp('lamp', x, y, 1, 1, 'all');
  };
  for (const x of [15, 23, 31, 39]) {
    lamp(x, mid - 6);
    lamp(x + 2, mid + 6);
  }
  const place = (
    kind: PropKind,
    pw: number,
    ph: number,
    x: number,
    y: number,
    solid: 'all' | 'base' | 'none',
  ): boolean => {
    for (let yy = y - 1; yy <= y + ph; yy++)
      for (let xx = x - 1; xx <= x + pw; xx++)
        if (!inBounds(b.m, xx, yy) || b.m.solid[b.at(xx, yy)] !== 0 || b.reserved[b.at(xx, yy)])
          return false;
    b.addProp(kind, x, y, pw, ph, solid);
    b.reserve(x, y, pw, ph);
    return true;
  };
  const lanes = [mid - 4, mid - 3, mid + 2, mid + 3];
  let cars = 0;
  for (let i = 0; i < 160 && cars < 10; i++) {
    const x = rng.int(15, half - 14);
    const y = rng.pick(lanes);
    if (x >= 20 && x <= 31) continue; // el paso de cebra y la plaza quedan abiertos
    if (place('car', 2, 1, x, y, 'all')) cars++;
  }
  let bins = 0;
  for (let i = 0; i < 80 && bins < 3; i++) {
    const x = rng.int(15, half - 9);
    if (place('dumpster', 2, 1, x, rng.chance(0.5) ? mid - 8 : mid + 7, 'all')) bins++;
  }
  // vallas de obra y bancas que parten la avenida en tramos
  let fences = 0;
  for (let i = 0; i < 120 && fences < 4; i++) {
    const x = rng.int(15, half - 14);
    if (x >= 20 && x <= 31) continue;
    const y = rng.pick([mid - 5, mid + 4, mid - 2, mid + 1]);
    const len = rng.int(2, 3);
    let ok = true;
    for (let k = 0; k < len; k++) ok = ok && place('fence', 1, 1, x + k * 1, y, 'all');
    if (ok) fences++;
  }
  for (let i = 0; i < 4; i++) {
    const spot = freeSpot(b, rng, 14, half - 9, mid - 8, mid + 7);
    if (spot) place('bench', 2, 1, spot.x, spot.y, 'base');
  }
  place('busstop', 3, 1, rng.int(32, 38), mid - 7, 'base');
  for (let i = 0; i < 10; i++) {
    const spot = freeSpot(b, rng, 14, half - 8, mid - 8, mid + 7);
    if (spot) place('planter', 1, 1, spot.x, spot.y, 'all');
  }
  // cajas de municion cerca de las casas
  let crates = 0;
  for (let i = 0; i < 60 && crates < 3; i++) {
    const spot = freeSpot(
      b,
      rng,
      14,
      half - 10,
      rng.chance(0.5) ? mid - 10 : mid + 8,
      rng.chance(0.5) ? mid - 7 : mid + 10,
    );
    if (!spot) continue;
    if (b.m.chests.some((c) => Math.hypot(c.x / TILE - spot.x, c.y / TILE - spot.y) < 8)) continue;
    b.chest(spot.x, spot.y, false, true);
    crates++;
  }
  return finishStreet(b, ['Plaza oeste', 'El cruce', 'Plaza este']);
}

function hash2s(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Refleja la mitad izquierda y deja los patios en orden de oeste a este con su nombre. */
function finishStreet(b: Builder, names: string[]): BRMap {
  mirrorLeftToRight(b.m);
  const pts = b.m.points ?? [];
  pts.sort((p, q) => p.x - q.x);
  pts.forEach((p, i) => {
    p.name = names[i] ?? p.name;
  });
  return b.m;
}

// ------------------------------------------------------------------ patios traseros

/** Patios con cercas y portones, casitas, columpios y un callejon que los cruza. */
export function buildPatios(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'patios', seed, 96, 60);
  const { w, h } = b.m;
  const half = w / 2;
  const mid = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) b.setGround(x, y, hash2s(x, y, seed) < 0.1 ? G.CESPED : G.CESPED);
  b.border(G.HEDGE);
  // callejon central de concreto y callejones laterales
  for (let x = 2; x < w - 2; x++)
    for (let y = mid - 3; y <= mid + 2; y++) b.setGround(x, y, G.PATIO);
  for (let y = 2; y < h - 2; y++) for (let x = half - 3; x < half; x++) b.setGround(x, y, G.PATIO);
  for (const ax of [14, 30]) {
    for (let y = 2; y < h - 2; y++) {
      if (y >= mid - 3 && y <= mid + 2) continue;
      for (let x = ax; x < ax + 2; x++) b.setGround(x, y, G.PATIO);
    }
  }
  // desgaste del concreto
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < half; x++)
      if (b.m.ground[b.at(x, y)] === G.PATIO && hash2s(x, y, seed + 3) < 0.07)
        b.setGround(x, y, G.ADOQUIN);
  b.fillGround(3, mid - 10, 9, 21, G.ADOQUIN);
  b.reserve(2, mid - 11, 11, 23);
  placeSquadSpawns(b, 6);
  b.m.points = [
    { x: 22 * TILE, y: mid * TILE, r: 44, name: 'Patio oeste' },
    { x: half * TILE, y: mid * TILE, r: 48, name: 'Patio central' },
  ];
  b.reserve(22 - 4, mid - 6, 9, 11);
  b.reserve(half - 6, mid - 7, 8, 13);

  const place = (
    kind: PropKind,
    pw: number,
    ph: number,
    x: number,
    y: number,
    solid: 'all' | 'base' | 'none',
  ): boolean => {
    for (let yy = y - 1; yy <= y + ph; yy++)
      for (let xx = x - 1; xx <= x + pw; xx++)
        if (!inBounds(b.m, xx, yy) || b.m.solid[b.at(xx, yy)] !== 0 || b.reserved[b.at(xx, yy)])
          return false;
    b.addProp(kind, x, y, pw, ph, solid);
    b.reserve(x, y, pw, ph);
    return true;
  };
  // cercas: cada patio queda cercado con un portón hacia el callejón
  const fence = (x0: number, y0: number, x1: number, y1: number, gate: 'N' | 'S'): void => {
    for (let x = x0; x <= x1; x++) {
      for (const y of [y0, y1]) {
        const gateRow = gate === 'S' ? y1 : y0;
        const inGate =
          y === gateRow && x >= Math.floor((x0 + x1) / 2) - 1 && x <= Math.floor((x0 + x1) / 2) + 1;
        if (!inGate && b.isFree(x, y)) b.addProp('fence', x, y, 1, 1, 'all');
      }
    }
    for (let y = y0 + 1; y < y1; y++) {
      for (const x of [x0, x1]) {
        const inGap = y === Math.floor((y0 + y1) / 2) && x === x1;
        if (!inGap && b.isFree(x, y)) b.addProp('fence', x, y, 1, 1, 'all');
      }
    }
  };
  const yardsX = [4, 18, 32];
  for (const north of [true, false]) {
    for (const [i, x] of yardsX.entries()) {
      const yw = i === 0 ? 8 : 11;
      const x0 = i === 0 ? 13 : x;
      const x1 = Math.min(half - 6, x0 + yw);
      if (x1 - x0 < 6) continue;
      const y0 = north ? 4 : mid + 5;
      const y1 = north ? mid - 5 : h - 5;
      if (i === 0) continue; // la base ocupa el extremo
      fence(x0, y0, x1, y1, north ? 'S' : 'N');
      // la casa del fondo, un cobertizo y adornos dentro del patio
      const hw = rng.int(6, 8);
      const hh = rng.int(5, 6);
      const hx = rng.int(x0 + 1, Math.max(x0 + 1, x1 - hw - 1));
      const hy = north ? y0 + 1 : y1 - hh - 1;
      if (hx + hw < x1) b.house('house', hx, hy, hw, hh, rng.pick(NAMES_PATIOS), G.WOOD);
      const cy0 = north ? hy + hh + 1 : y0 + 2;
      const cy1 = north ? y1 - 2 : hy - 2;
      for (let k = 0; k < 11; k++) {
        const kind = rng.pick<PropKind>([
          'planter',
          'tree',
          'bush',
          'laundry',
          'swing',
          'crate',
          'tree',
        ]);
        const pw = kind === 'laundry' || kind === 'swing' ? 3 : 1;
        const ph = kind === 'swing' ? 2 : 1;
        const spot = freeSpot(b, rng, x0 + 1, x1 - pw - 1, cy0, Math.max(cy0, cy1 - ph));
        if (!spot) continue;
        const solid =
          kind === 'bush' || kind === 'laundry' ? 'none' : kind === 'swing' ? 'base' : 'all';
        place(kind, pw, ph, spot.x, spot.y, solid);
      }
    }
  }
  // cajas de municion en los callejones
  let crates = 0;
  for (let i = 0; i < 80 && crates < 3; i++) {
    const spot = freeSpot(b, rng, 12, half - 8, mid - 3, mid + 2);
    if (!spot) continue;
    if (b.m.chests.some((c) => Math.hypot(c.x / TILE - spot.x, c.y / TILE - spot.y) < 9)) continue;
    b.chest(spot.x, spot.y, false, true);
    crates++;
  }
  // bancas y cubos en el callejon
  for (let i = 0; i < 6; i++) {
    const spot = freeSpot(b, rng, 14, half - 8, mid - 3, mid + 2);
    if (spot) place(rng.chance(0.5) ? 'dumpster' : 'bench', 2, 1, spot.x, spot.y, 'all');
  }
  return finishStreet(b, ['Patio oeste', 'Patio central', 'Patio este']);
}

/** Motivo por el que un mapa de equipos no sirve, o `null` si esta bien. */
export function pvpProblem(m: BRMap): string | null {
  const ts = m.teamSpawns;
  const street = m.kind === 'calle' || m.kind === 'patios';
  if (!ts || ts[0].length < (street ? 5 : 2) || ts[1].length < (street ? 5 : 2))
    return 'apariciones';
  if (street && (m.points?.length ?? 0) !== 3) return 'patios';
  // los dos equipos se pueden alcanzar sin cruzar muros
  const first = ts[0][0] as Vec;
  const seen = new Uint8Array(m.w * m.h);
  const sx = Math.floor(first.x / TILE);
  const sy = Math.floor(first.y / TILE);
  if (isSolidTile(m, sx, sy)) return 'aparicion_bloqueada';
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
  for (const team of ts) {
    for (const s of team) {
      if (!seen[Math.floor(s.y / TILE) * m.w + Math.floor(s.x / TILE)]) return 'incomunicado';
    }
  }
  for (const c of m.chests) {
    const tx = Math.floor(c.x / TILE);
    const ty = Math.floor(c.y / TILE);
    const near = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => seen[(ty + (dy as number)) * m.w + tx + (dx as number)]);
    if (!near) return 'caja_incomunicada';
  }
  // coberturas: ni un mapa vacio ni uno lleno de muros
  let solid = 0;
  let inner = 0;
  for (let y = 2; y < m.h - 2; y++) {
    for (let x = 2; x < m.w - 2; x++) {
      inner++;
      if (m.solid[y * m.w + x]) solid++;
    }
  }
  const ratio = solid / inner;
  if (ratio < 0.05 || ratio > (street ? 0.38 : 0.3)) return 'coberturas';
  // los patios que se disputan se alcanzan y no quedan dentro de un muro
  for (const p of m.points ?? []) {
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if (isSolidTile(m, tx, ty) || !seen[ty * m.w + tx]) return 'patio_incomunicado';
  }
  return null;
}
