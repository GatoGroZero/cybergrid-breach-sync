import { describe, expect, it } from 'vitest';
import { interpolatePosition, lerpAngle, SnapshotBuffer } from '../../src/shared/interp';

describe('interpolacion de posiciones de jugadores', () => {
  const a = { t: 1000, x: 100, y: 200 };
  const b = { t: 1100, x: 200, y: 100 };

  it('interpola linealmente entre dos instantaneas del servidor', () => {
    expect(interpolatePosition(a, b, 1050)).toEqual({ x: 150, y: 150 });
    expect(interpolatePosition(a, b, 1000)).toEqual({ x: 100, y: 200 });
    expect(interpolatePosition(a, b, 1100)).toEqual({ x: 200, y: 100 });
    expect(interpolatePosition(a, b, 900)).toEqual({ x: 100, y: 200 });
  });

  it('extrapola con la velocidad del tramo pero con tope, para que un corte no lo mande lejos', () => {
    const p = interpolatePosition(a, b, 1150);
    expect(p.x).toBeCloseTo(250, 5);
    expect(p.y).toBeCloseTo(50, 5);
    const capped = interpolatePosition(a, b, 5000, 100);
    expect(capped.x).toBeCloseTo(300, 5);
    expect(capped.y).toBeCloseTo(0, 5);
    expect(interpolatePosition({ ...a, t: 1100 }, b, 1200)).toEqual({ x: 200, y: 100 });
  });

  it('interpola angulos por el camino corto', () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 5);
    const wrapped = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(Math.abs(wrapped) - Math.PI)).toBeLessThan(0.001);
  });

  it('el buffer devuelve entidades interpoladas en el pasado e ignora marcas repetidas', () => {
    const buffer = new SnapshotBuffer<{ x: number; y: number; ang?: number; hp: number }>();
    buffer.push(1000, new Map([[1, { x: 0, y: 0, hp: 100 }]]));
    buffer.push(
      1100,
      new Map([
        [1, { x: 100, y: 0, hp: 80 }],
        [2, { x: 5, y: 5, hp: 10 }],
      ]),
    );
    buffer.push(1100, new Map());
    expect(buffer.length).toBe(2);
    const at = buffer.sample(1050);
    expect(at.get(1)?.x).toBeCloseTo(50, 5);
    expect(at.get(1)?.hp).toBe(80);
    expect(at.get(2)?.x).toBe(5);
    expect(new SnapshotBuffer<{ x: number; y: number }>().sample(10).size).toBe(0);
  });
});
