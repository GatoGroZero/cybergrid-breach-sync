import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/shared/br/constants';
import {
  G,
  TERRITORY_MAPS,
  generateMap,
  generateMapReport,
  isSolidTile,
  reachable,
} from '../../src/shared/br/map';

describe.each(TERRITORY_MAPS)('territorio %s', (kind) => {
  it('se genera casi siempre al primer intento y es determinista', () => {
    let firstTry = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { map, problems } = generateMapReport(kind, seed * 6151);
      expect(map).not.toBeNull();
      if (problems.length === 0) firstTry++;
    }
    expect(firstTry).toBeGreaterThan(20);
    const a = generateMap(kind, 31337);
    const b = generateMap(kind, 31337);
    expect(Array.from(a.solid)).toEqual(Array.from(b.solid));
    expect(a.points).toEqual(b.points);
    expect(Array.from(generateMap(kind, 31338).solid)).not.toEqual(Array.from(a.solid));
  });

  it('es grande, simetrico y cada equipo tiene sus cinco lugares', () => {
    for (const seed of [2, 4, 8, 16, 32]) {
      const m = generateMap(kind, seed);
      expect(m.w).toBeGreaterThanOrEqual(90);
      expect(m.h).toBeGreaterThanOrEqual(56);
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const mirror = y * m.w + (m.w - 1 - x);
          expect(m.solid[y * m.w + x] !== 0).toBe(m.solid[mirror] !== 0);
        }
      }
      const [a, b] = m.teamSpawns as NonNullable<typeof m.teamSpawns>;
      expect(a).toHaveLength(5);
      expect(b).toHaveLength(5);
      a.forEach((s, i) => {
        expect((b[i]?.x ?? 0) + s.x).toBe(m.w * TILE);
        expect(s.x).toBeLessThan((m.w * TILE) / 2);
      });
    }
  });

  it('hay tres patios de oeste a este, el del medio al centro y todos se alcanzan', () => {
    for (const seed of [3, 6, 9, 12, 15, 18]) {
      const m = generateMap(kind, seed);
      const pts = m.points ?? [];
      expect(pts).toHaveLength(3);
      expect(pts[0]!.x).toBeLessThan(pts[1]!.x);
      expect(pts[1]!.x).toBeLessThan(pts[2]!.x);
      expect(pts[1]!.x).toBe((m.w * TILE) / 2);
      expect(pts[0]!.x + pts[2]!.x).toBe(m.w * TILE);
      expect(new Set(pts.map((p) => p.name)).size).toBe(3);
      const [a] = m.teamSpawns as NonNullable<typeof m.teamSpawns>;
      const start = a[0]!;
      const seen = reachable(m, Math.floor(start.x / TILE), Math.floor(start.y / TILE));
      for (const p of pts) {
        const tx = Math.floor(p.x / TILE);
        const ty = Math.floor(p.y / TILE);
        expect(isSolidTile(m, tx, ty)).toBe(false);
        expect(seen[ty * m.w + tx]).toBe(1);
      }
      for (const team of m.teamSpawns as NonNullable<typeof m.teamSpawns>)
        for (const s of team) {
          const tx = Math.floor(s.x / TILE);
          const ty = Math.floor(s.y / TILE);
          expect(isSolidTile(m, tx, ty)).toBe(false);
          expect(seen[ty * m.w + tx]).toBe(1);
        }
    }
  });

  it('las casas tienen puertas, hay cajas de municion y ninguna cae sobre el agua', () => {
    for (const seed of [5, 10, 20]) {
      const m = generateMap(kind, seed);
      expect(m.houses.length).toBeGreaterThanOrEqual(4);
      expect(m.houses.length % 2).toBe(0);
      for (const h of m.houses) {
        expect(h.doors.length).toBeGreaterThanOrEqual(2);
        for (const d of h.doors) expect(isSolidTile(m, d.x, d.y)).toBe(false);
      }
      expect(m.chests.length).toBeGreaterThanOrEqual(4);
      expect(m.chests.every((c) => c.ammo)).toBe(true);
      expect(Array.from(m.ground)).not.toContain(G.WATER);
    }
  });
});
