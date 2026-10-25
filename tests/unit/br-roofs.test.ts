import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/shared/br/constants';
import {
  DUEL_MAPS,
  G,
  generateMap,
  generateMapReport,
  isSolidTile,
  reachable,
} from '../../src/shared/br/map';

describe.each(DUEL_MAPS)('techo %s', (kind) => {
  it('se genera siempre y es determinista', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { map } = generateMapReport(kind, seed * 7919);
      expect(map).not.toBeNull();
    }
    const a = generateMap(kind, 4242);
    const b = generateMap(kind, 4242);
    expect(Array.from(a.solid)).toEqual(Array.from(b.solid));
    expect(a.teamSpawns).toEqual(b.teamSpawns);
    expect(Array.from(generateMap(kind, 4243).solid)).not.toEqual(Array.from(a.solid));
  });

  it('es chico y los dos equipos tienen exactamente el mismo mundo (espejo)', () => {
    for (const seed of [3, 9, 27, 81, 243]) {
      const m = generateMap(kind, seed);
      expect(m.w).toBeLessThanOrEqual(44);
      expect(m.h).toBeLessThanOrEqual(30);
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const mirror = y * m.w + (m.w - 1 - x);
          expect(m.solid[y * m.w + x] !== 0).toBe(m.solid[mirror] !== 0);
          expect(m.ground[y * m.w + x]).toBe(m.ground[mirror]);
        }
      }
      // cada equipo tiene al menos dos lugares y el espejo cae a la misma altura
      const [a, b] = m.teamSpawns as NonNullable<typeof m.teamSpawns>;
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(b.length).toBe(a.length);
      a.forEach((s, i) => {
        expect(b[i]?.y).toBe(s.y);
        expect((b[i]?.x ?? 0) + s.x).toBe(m.w * TILE);
        expect(s.x).toBeLessThan((m.w * TILE) / 2);
      });
    }
  });

  it('todo se alcanza: apariciones, cajas de municion y el otro lado del tejado', () => {
    for (const seed of [5, 15, 25, 35, 45, 55]) {
      const m = generateMap(kind, seed);
      const [a, b] = m.teamSpawns as NonNullable<typeof m.teamSpawns>;
      const start = a[0] as { x: number; y: number };
      const seen = reachable(m, Math.floor(start.x / TILE), Math.floor(start.y / TILE));
      for (const s of [...a, ...b]) {
        expect(isSolidTile(m, Math.floor(s.x / TILE), Math.floor(s.y / TILE))).toBe(false);
        expect(seen[Math.floor(s.y / TILE) * m.w + Math.floor(s.x / TILE)]).toBe(1);
      }
      expect(m.chests.length).toBeGreaterThanOrEqual(2);
      expect(m.chests.length % 2).toBe(0);
      expect(m.chests.every((c) => c.ammo)).toBe(true);
      // y los techos no tienen agua ni casas
      expect(Array.from(m.ground)).not.toContain(G.WATER);
      expect(m.houses).toHaveLength(0);
    }
  });

  it('las coberturas no tapan a quien aparece: hay aire a su alrededor', () => {
    for (const seed of [7, 17, 77]) {
      const m = generateMap(kind, seed);
      for (const team of m.teamSpawns as NonNullable<typeof m.teamSpawns>) {
        for (const s of team) {
          const tx = Math.floor(s.x / TILE);
          const ty = Math.floor(s.y / TILE);
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) expect(isSolidTile(m, tx + dx, ty + dy)).toBe(false);
        }
      }
    }
  });
});
