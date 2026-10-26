import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/shared/br/constants';
import { generateMap } from '../../src/shared/br/map';
import { SIGN_RANGE, nearSign, signSpot } from '../../src/client/game/cartel';

describe('cartel del tutorial', () => {
  const map = generateMap('encantado', 7);
  const start = map.rooms?.[0];

  it('esta en el claro de inicio, sobre suelo libre y fuera de las puertas', () => {
    expect(start).toBeDefined();
    const spot = signSpot(start!);
    const tx = Math.floor(spot.x / TILE);
    const ty = Math.floor(spot.y / TILE);
    expect(tx).toBeGreaterThanOrEqual(start!.x);
    expect(tx).toBeLessThan(start!.x + start!.w);
    expect(ty).toBeGreaterThanOrEqual(start!.y);
    expect(ty).toBeLessThan(start!.y + start!.h);
    expect(map.solid[ty * map.w + tx]).toBe(0);
    for (const g of start!.gates) expect(Math.hypot(g.x - tx, g.y - ty)).toBeGreaterThan(5);
  });

  it('esta libre de adornos con colision en cualquier semilla', () => {
    for (const seed of [1, 2, 3, 42, 99, 12345]) {
      const m = generateMap('encantado', seed);
      const room = m.rooms![0]!;
      const spot = signSpot(room);
      const tx = Math.floor(spot.x / TILE);
      const ty = Math.floor(spot.y / TILE);
      expect(m.solid[ty * m.w + tx], `semilla ${seed}`).toBe(0);
    }
  });

  it('se acciona de cerca y no de lejos', () => {
    const spot = signSpot(start!);
    expect(nearSign(spot, spot.x, spot.y)).toBe(true);
    expect(nearSign(spot, spot.x + SIGN_RANGE - 1, spot.y)).toBe(true);
    expect(nearSign(spot, spot.x + SIGN_RANGE + 6, spot.y)).toBe(false);
    expect(nearSign(null, 0, 0)).toBe(false);
  });
});
