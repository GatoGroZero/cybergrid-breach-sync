import { createRng, type Rng } from '../rng';
import { MAX_PLAYERS, TILE } from './constants';
import {
  Builder,
  G,
  NAMES_BOSQUE,
  NAMES_CABANA,
  NAMES_CAMA,
  baseGrass,
  connectPaths,
  groundAt,
  MAP_KINDS,
  hash2,
  inBounds,
  isSolidTile,
  noise,
  overlaps,
  placeHouses,
  type BRMap,
  type MapKind,
  type PropKind,
  type Rect,
  type Vec,
} from './mapcore';

import { buildAzotea, buildMansarda, buildTejado, pvpProblem } from './mappvp';

export * from './mapcore';

// ------------------------------------------------------------------ bosque

function buildBosque(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'bosque', seed, 108, 72);
  baseGrass(b, 0.035);
  b.border(G.HEDGE);
  placeHouses(
    b,
    rng.int(9, 11),
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
  b.stockHouses(1, 3);

  // Bosque: ruido para que haya zonas densas y claros.
  const cell = new Set<string>();
  let attempts = 0;
  while (attempts++ < 3100) {
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
  for (let i = 0; i < 34; i++) {
    const x = rng.int(3, b.m.w - 4);
    const y = rng.int(3, b.m.h - 4);
    if (!b.isFree(x, y)) continue;
    const kind: PropKind = rng.chance(0.55) ? 'rock' : rng.chance(0.5) ? 'log' : 'bush';
    b.addProp(kind, x, y, 1, 1, kind === 'bush' ? 'none' : 'all');
  }
  b.scatterChests(rng.int(13, 16));
  b.goldenChests(0.14);
  b.ammoCrates(rng.int(13, 16));
  b.spawns();
  b.connect();
  return b.m;
}

// ------------------------------------------------------------------ casa de gatitos

function buildCasa(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'casa', seed, 90, 62);
  const { w, h } = b.m;
  const wallX = [Math.floor(w / 3), Math.floor((w * 2) / 3)];
  // Tres cuartos con piso distinto: sala de madera clara, cocina de azulejos y dormitorio oscuro.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const room = x < (wallX[0] as number) ? G.WOOD : x < (wallX[1] as number) ? G.TILE : G.WOOD2;
      b.setGround(x, y, room);
    }
  }
  b.border(G.WALLTOP);
  // Paredes interiores con puertas amplias.
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
  const beds = rng.int(7, 8);
  while (b.m.houses.length < beds && attempts++ < 600) {
    const bw = rng.pick([10, 11, 12]);
    const bh = rng.pick([6, 7]);
    const x = rng.int(5, w - 5 - bw);
    const y = rng.int(5, h - 5 - bh);
    const rect: Rect = { x, y, w: bw, h: bh };
    if (b.rects.some((r) => overlaps(rect, r, 4))) continue;
    if (wallX.some((wx) => x - 1 <= wx && wx <= x + bw)) continue;
    b.bed(x, y, bw, bh, bedNames[b.m.houses.length % bedNames.length] as string);
  }
  b.stockHouses(1, 3);
  // Muebles: sillones, mesas, estantes, plantas y arboles para gatos.
  attempts = 0;
  let furniture = 0;
  while (furniture < 50 && attempts++ < 1100) {
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
  b.scatterChests(rng.int(14, 17));
  b.goldenChests(0.14);
  b.ammoCrates(rng.int(13, 16));
  b.spawns();
  b.connect();
  return b.m;
}

// ------------------------------------------------------------------ piscina

function buildPiscina(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'piscina', seed, 98, 66);
  const { w, h } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      b.setGround(x, y, (x >> 1) % 2 === (y >> 1) % 2 ? G.DECK : G.DECK2);
      if (hash2(x, y, seed) < 0.06) b.setGround(x, y, G.GRASS2);
    }
  }
  b.border(G.HEDGE);
  // Alberca grande al centro y una chica (el agua hace daño).
  const pw = rng.int(32, 40);
  const ph = rng.int(19, 24);
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
    rng.int(6, 7),
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
  b.stockHouses(1, 3);
  // Camastros y sombrillas junto a la alberca, palmeras y arbustos por fuera.
  let attempts = 0;
  let placed = 0;
  while (placed < 28 && attempts++ < 900) {
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
  b.scatterChests(rng.int(15, 18));
  b.goldenChests(0.14);
  b.ammoCrates(rng.int(13, 16));
  b.spawns();
  b.connect();
  return b.m;
}

/**
 * Calabazas de Halloween junto a las casas: adorno sin colision. Se coloca despues de generar el
 * mapa y con su propio hash, asi no cambia nada del reparto de cofres, casas ni apariciones.
 */
function decorate(m: BRMap): void {
  const taken = new Set(m.props.map((p) => `${p.x},${p.y}`));
  const near = (x: number, y: number, list: Vec[], r: number): boolean =>
    list.some((v) => Math.abs(v.x / TILE - x) <= r && Math.abs(v.y / TILE - y) <= r);
  const chests = m.chests.map((c) => ({ x: c.x, y: c.y }));
  let placed = 0;
  for (const house of m.houses) {
    const ring: Vec[] = [];
    for (let x = house.x - 1; x <= house.x + house.w; x++) {
      ring.push({ x, y: house.y - 1 }, { x, y: house.y + house.h });
    }
    for (let y = house.y; y < house.y + house.h; y++) {
      ring.push({ x: house.x - 1, y }, { x: house.x + house.w, y });
    }
    const doors = house.doors.map((d) => ({ x: d.x * TILE, y: d.y * TILE }));
    let mine = 0;
    for (const t of ring) {
      if (mine >= 2) break;
      if (hash2(t.x, t.y, m.seed ^ 0x6a09e667) > 0.09) continue;
      if (!inBounds(m, t.x, t.y) || isSolidTile(m, t.x, t.y)) continue;
      const g = groundAt(m, t.x, t.y);
      if (g === G.WATER || g === G.HEDGE || g === G.POOLEDGE || g === G.WALLTOP) continue;
      if (taken.has(`${t.x},${t.y}`)) continue;
      // lejos de las puertas, los cofres y los puntos de aparicion
      if (near(t.x, t.y, doors, 2) || near(t.x, t.y, chests, 1) || near(t.x, t.y, m.spawns, 2))
        continue;
      m.props.push({ kind: 'pumpkin', x: t.x, y: t.y, w: 1, h: 1 });
      taken.add(`${t.x},${t.y}`);
      mine++;
      placed++;
    }
  }
  // Si el azar dejo muy pocas, se completan con las primeras casillas libres del anillo de cada casa.
  for (const house of m.houses) {
    if (placed >= 6) break;
    const t = { x: house.x - 1, y: house.y + 1 };
    if (!inBounds(m, t.x, t.y) || isSolidTile(m, t.x, t.y)) continue;
    const g = groundAt(m, t.x, t.y);
    if (g === G.WATER || g === G.HEDGE || g === G.POOLEDGE || g === G.WALLTOP) continue;
    if (taken.has(`${t.x},${t.y}`) || near(t.x, t.y, chests, 1) || near(t.x, t.y, m.spawns, 2))
      continue;
    m.props.push({ kind: 'pumpkin', x: t.x, y: t.y, w: 1, h: 1 });
    taken.add(`${t.x},${t.y}`);
    placed++;
  }
}

/** Motivo por el que un mapa generado no sirve, o `null` si esta bien. */
export function mapProblem(m: BRMap): string | null {
  if (m.houses.length < (m.kind === 'piscina' ? 4 : 5)) return 'casas';
  if (m.houses.some((hs) => hs.doors.length < 2)) return 'puertas';
  // Al menos dos cofres por jugador y una caja de municion por jugador, aproximadamente.
  if (m.chests.filter((c) => !c.ammo).length < MAX_PLAYERS * 2) return 'cofres';
  if (m.chests.filter((c) => c.ammo).length < MAX_PLAYERS) return 'cajas';
  if (m.spawns.length !== MAX_PLAYERS) return 'apariciones';
  // Los puntos de aparicion deben estar bien separados.
  for (let i = 0; i < m.spawns.length; i++) {
    for (let j = i + 1; j < m.spawns.length; j++) {
      const a = m.spawns[i] as Vec;
      const c = m.spawns[j] as Vec;
      if (Math.hypot(a.x - c.x, a.y - c.y) < 7 * TILE) return 'separacion';
    }
  }
  return null;
}

function buildKind(kind: MapKind, rng: Rng, s: number): BRMap {
  switch (kind) {
    case 'bosque':
      return buildBosque(rng, s);
    case 'casa':
      return buildCasa(rng, s);
    case 'piscina':
      return buildPiscina(rng, s);
    case 'tejado':
      return buildTejado(rng, s);
    case 'azotea':
      return buildAzotea(rng, s);
    case 'mansarda':
      return buildMansarda(rng, s);
    default:
      throw new Error(`el mapa ${kind} todavia no existe`);
  }
}

/**
 * Genera un mapa completo de forma determinista. Cliente y servidor llaman con la misma semilla
 * y obtienen exactamente el mismo mundo, asi solo viaja la semilla. Si un intento no cumple las
 * reglas se prueba otro (con un ruido distinto), y `problems` dice por que fallo cada uno.
 */
export function generateMapReport(
  kind: MapKind,
  seed: number,
): { map: BRMap | null; problems: string[] } {
  const problems: string[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    // El ruido del terreno tambien depende de la semilla, asi que cada intento la cambia.
    const s = attempt === 0 ? seed : (seed ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
    const rng = createRng((seed + attempt * 104729) >>> 0);
    const m = buildKind(kind, rng, s);
    const problem = (MAP_KINDS as readonly MapKind[]).includes(kind)
      ? mapProblem(m)
      : pvpProblem(m);
    if (!problem) {
      m.seed = seed;
      decorate(m);
      return { map: m, problems };
    }
    problems.push(problem);
  }
  return { map: null, problems };
}

export function generateMap(kind: MapKind, seed: number): BRMap {
  const { map, problems } = generateMapReport(kind, seed);
  if (!map) {
    const counts = problems.reduce<Record<string, number>>(
      (acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }),
      {},
    );
    throw new Error(
      `no se pudo generar el mapa ${kind} para la semilla ${seed}: ${JSON.stringify(counts)}`,
    );
  }
  return map;
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
