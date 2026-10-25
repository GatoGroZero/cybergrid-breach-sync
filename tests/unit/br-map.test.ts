import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, TILE } from '../../src/shared/br/constants';
import {
  G,
  MAP_KINDS,
  generateMap,
  generateMapReport,
  isSolidTile,
  reachable,
} from '../../src/shared/br/map';

describe.each(MAP_KINDS)('generador procedural del mapa %s', (kind) => {
  it('es determinista: la misma semilla da exactamente el mismo mundo', () => {
    const a = generateMap(kind, 777);
    const b = generateMap(kind, 777);
    expect(Array.from(a.ground)).toEqual(Array.from(b.ground));
    expect(Array.from(a.solid)).toEqual(Array.from(b.solid));
    expect(a.chests).toEqual(b.chests);
    expect(a.spawns).toEqual(b.spawns);
    const c = generateMap(kind, 778);
    expect(Array.from(c.solid)).not.toEqual(Array.from(a.solid));
  });

  it('lleva calabazas de adorno: sin colision, lejos de cofres y apariciones, siempre las mismas', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const m = generateMap(kind, seed);
      const pumpkins = m.props.filter((p) => p.kind === 'pumpkin');
      expect(pumpkins.length).toBeGreaterThanOrEqual(3);
      const seen = new Set<string>();
      for (const p of pumpkins) {
        // adorno puro: no bloquea el paso ni cae sobre agua o muros
        expect(isSolidTile(m, p.x, p.y)).toBe(false);
        expect([G.WATER, G.HEDGE, G.WALLTOP, G.POOLEDGE]).not.toContain(m.ground[p.y * m.w + p.x]);
        expect(seen.has(`${p.x},${p.y}`)).toBe(false);
        seen.add(`${p.x},${p.y}`);
        for (const c of m.chests) {
          expect(Math.abs(c.x / TILE - p.x) <= 1 && Math.abs(c.y / TILE - p.y) <= 1).toBe(false);
        }
        for (const sp of m.spawns) {
          expect(Math.abs(sp.x / TILE - p.x) <= 2 && Math.abs(sp.y / TILE - p.y) <= 2).toBe(false);
        }
      }
    }
    const a = generateMap(kind, 99).props.filter((p) => p.kind === 'pumpkin');
    const b = generateMap(kind, 99).props.filter((p) => p.kind === 'pumpkin');
    expect(a).toEqual(b);
  });

  it('cada casa tiene al menos 2 puertas abiertas y las casas no se encimar', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = generateMap(kind, seed);
      expect(m.houses.length).toBeGreaterThanOrEqual(kind === 'piscina' ? 4 : 5);
      for (const house of m.houses) {
        expect(house.doors.length).toBeGreaterThanOrEqual(2);
        for (const d of house.doors) expect(isSolidTile(m, d.x, d.y)).toBe(false);
      }
      for (let i = 0; i < m.houses.length; i++) {
        for (let j = i + 1; j < m.houses.length; j++) {
          const a = m.houses[i]!;
          const b = m.houses[j]!;
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('hay 12 puntos de aparición separados y todo es alcanzable desde ellos', () => {
    for (const seed of [10, 11, 12, 13]) {
      const m = generateMap(kind, seed);
      expect(m.spawns).toHaveLength(MAX_PLAYERS);
      const s = m.spawns[0]!;
      const seen = reachable(m, Math.floor(s.x / TILE), Math.floor(s.y / TILE));
      for (const sp of m.spawns) {
        expect(seen[Math.floor(sp.y / TILE) * m.w + Math.floor(sp.x / TILE)]).toBe(1);
      }
      for (const house of m.houses) {
        for (const d of house.doors) expect(seen[d.y * m.w + d.x]).toBe(1);
      }
      for (let i = 0; i < m.spawns.length; i++) {
        for (let j = i + 1; j < m.spawns.length; j++) {
          const a = m.spawns[i]!;
          const b = m.spawns[j]!;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(6 * TILE);
        }
      }
    }
  });

  it('hay cofres suficientes (con al menos uno dorado) y ninguno cae en el agua', () => {
    for (const seed of [20, 21, 22]) {
      const m = generateMap(kind, seed);
      expect(m.chests.length).toBeGreaterThanOrEqual(14);
      expect(m.chests.some((c) => c.golden)).toBe(true);
      for (const c of m.chests) {
        const tx = Math.floor(c.x / TILE);
        const ty = Math.floor(c.y / TILE);
        expect(m.ground[ty * m.w + tx]).not.toBe(G.WATER);
      }
    }
  });

  it('el borde del mapa es un muro continuo', () => {
    const m = generateMap(kind, 31);
    for (let x = 0; x < m.w; x++) {
      expect(isSolidTile(m, x, 0)).toBe(true);
      expect(isSolidTile(m, x, m.h - 1)).toBe(true);
    }
    for (let y = 0; y < m.h; y++) {
      expect(isSolidTile(m, 0, y)).toBe(true);
      expect(isSolidTile(m, m.w - 1, y)).toBe(true);
    }
  });
});

describe('particularidades de cada mapa', () => {
  it('la piscina tiene agua y el bosque tiene muchos árboles', () => {
    const pool = generateMap('piscina', 5);
    expect(Array.from(pool.ground).filter((g) => g === G.WATER).length).toBeGreaterThan(300);
    const forest = generateMap('bosque', 5);
    expect(
      forest.props.filter((p) => p.kind === 'tree' || p.kind === 'pine').length,
    ).toBeGreaterThan(100);
  });

  it('en la casa de gatitos las "casas" son camas por las que se pasa por debajo', () => {
    const m = generateMap('casa', 5);
    expect(m.houses.every((h) => h.kind === 'bed')).toBe(true);
    for (const bed of m.houses) {
      const mid = { x: bed.x + 3, y: bed.y + Math.floor(bed.h / 2) };
      expect(isSolidTile(m, mid.x, mid.y)).toBe(false);
    }
  });
});

describe.each(MAP_KINDS)('robustez del generador de %s', (kind) => {
  it('genera un mapa valido para cualquier semilla, incluidas las que fallaban con el ruido fijo', () => {
    for (const seed of [647844703, 1037200949, 1993126045, 793057877, 1121893277, 1136484622]) {
      expect(generateMap(kind, seed).spawns).toHaveLength(MAX_PLAYERS);
    }
    for (let i = 1; i <= 120; i++) {
      const m = generateMap(kind, i * 7919);
      expect(m.seed).toBe(i * 7919);
      expect(m.houses.every((h) => h.doors.length >= 2)).toBe(true);
    }
  });
});

describe.each(MAP_KINDS)('botin y variedad en el mapa %s para 12 jugadores', (kind) => {
  it('hay al menos 2 cofres y una caja de municion por jugador, todos alcanzables', () => {
    for (let i = 1; i <= 40; i++) {
      const m = generateMap(kind, i * 104729);
      const chests = m.chests.filter((c) => !c.ammo);
      const crates = m.chests.filter((c) => c.ammo);
      expect(chests.length).toBeGreaterThanOrEqual(MAX_PLAYERS * 2);
      expect(crates.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
      expect(crates.every((c) => !c.golden)).toBe(true);
      const start = m.spawns[0]!;
      const seen = reachable(m, Math.floor(start.x / TILE), Math.floor(start.y / TILE));
      for (const c of m.chests) {
        const tx = Math.floor(c.x / TILE);
        const ty = Math.floor(c.y / TILE);
        const reachableSide = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => seen[(ty + dy!) * m.w + tx + dx!] === 1);
        expect(reachableSide).toBe(true);
      }
    }
  });

  it('desde cada punto de aparicion hay un cofre o caja cerca (menos de 25 casillas)', () => {
    for (let i = 1; i <= 40; i++) {
      const m = generateMap(kind, i * 15485863);
      for (const sp of m.spawns) {
        const nearest = Math.min(...m.chests.map((c) => Math.hypot(c.x - sp.x, c.y - sp.y)));
        expect(nearest).toBeLessThan(25 * TILE);
      }
    }
  });

  it('cada partida pone los cofres y las cajas en lugares distintos', () => {
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const m = generateMap(kind, seed * 7919);
      layouts.add(m.chests.map((c) => `${c.x},${c.y},${c.ammo ? 1 : 0}`).join(';'));
    }
    expect(layouts.size).toBe(30);
    // Y ningun cofre cae siempre en la misma casilla.
    const spots = new Map<string, number>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const c of generateMap(kind, seed * 7919).chests) {
        const key = `${c.x},${c.y}`;
        spots.set(key, (spots.get(key) ?? 0) + 1);
      }
    }
    expect(Math.max(...spots.values())).toBeLessThanOrEqual(6);
  });

  it('casi nunca hace falta reintentar y el mapa se genera rapido', () => {
    let retries = 0;
    const t0 = performance.now();
    for (let i = 1; i <= 100; i++) {
      const { map, problems } = generateMapReport(kind, i * 7919);
      expect(map).not.toBeNull();
      retries += problems.length;
    }
    expect(retries).toBeLessThanOrEqual(8);
    expect((performance.now() - t0) / 100).toBeLessThan(25);
  });
});

describe.each(MAP_KINDS)('nombres de las casas de %s', (kind) => {
  it('nunca se repite el nombre de un lugar en el mismo mapa', () => {
    for (let i = 1; i <= 60; i++) {
      const m = generateMap(kind, i * 7919);
      const names = m.houses.map((h) => h.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
