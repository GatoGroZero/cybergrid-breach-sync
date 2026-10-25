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

/** Motivo por el que un mapa de equipos no sirve, o `null` si esta bien. */
export function pvpProblem(m: BRMap): string | null {
  const ts = m.teamSpawns;
  if (!ts || ts[0].length < 2 || ts[1].length < 2) return 'apariciones';
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
  if (ratio < 0.05 || ratio > 0.3) return 'coberturas';
  return null;
}
