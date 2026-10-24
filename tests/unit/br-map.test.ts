import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, TILE } from '../../src/shared/br/constants';
import { G, MAP_KINDS, generateMap, isSolidTile, reachable } from '../../src/shared/br/map';

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

  it('hay 10 puntos de aparición separados y todo es alcanzable desde ellos', () => {
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
