import { describe, expect, it } from 'vitest';
import { CAT, TILE, TICK_DT } from '../../src/shared/br/constants';
import { generateMap } from '../../src/shared/br/map';
import {
  moveBox,
  normalizeMove,
  segmentCircleHit,
  segmentSolidHit,
  stepCat,
} from '../../src/shared/br/physics';
import { defaultSkin, isValidSkin, randomSkin } from '../../src/shared/br/skin';
import { createRng } from '../../src/shared/rng';
import { SKIN_CELLS } from '../../src/shared/br/constants';

const map = generateMap('bosque', 42);

/** Un lugar libre con espacio para caminar hacia la derecha. */
function freeSpot(): { x: number; y: number } {
  const s = map.spawns[0]!;
  return { x: s.x, y: s.y };
}

describe('física del gato', () => {
  it('avanza a la velocidad pedida y nunca más rápido aunque el vector sea enorme', () => {
    const p = freeSpot();
    const before = { ...p };
    stepCat(map, p, { mx: 50, my: 0 }, TICK_DT);
    const moved = Math.hypot(p.x - before.x, p.y - before.y);
    expect(moved).toBeLessThanOrEqual(CAT.speed * TICK_DT + 1e-6);
    expect(normalizeMove(Number.NaN, 1)).toEqual({ mx: 0, my: 0 });
    expect(normalizeMove(3, 4).mx).toBeCloseTo(0.6, 5);
  });

  it('no atraviesa muros ni árboles y es determinista', () => {
    const run = () => {
      const p = freeSpot();
      for (let i = 0; i < 1500; i++)
        stepCat(map, p, { mx: Math.cos(i / 60), my: Math.sin(i / 90) }, TICK_DT);
      return p;
    };
    expect(run()).toEqual(run());
    const p = run();
    expect(p.x).toBeGreaterThan(TILE);
    expect(p.x).toBeLessThan((map.w - 1) * TILE);
    const edge = freeSpot();
    for (let i = 0; i < 4000; i++) {
      const next = moveBox(map, edge.x, edge.y, -2, 0, CAT.half);
      edge.x = next.x;
      edge.y = next.y;
    }
    expect(edge.x).toBeGreaterThanOrEqual(2 * TILE);
  });
});

describe('proyectiles y línea de tiro', () => {
  it('una bala rápida no atraviesa un muro aunque salte varias casillas en un tick', () => {
    const m = generateMap('bosque', 42);
    const tx = 30;
    const ty = 20;
    for (let x = tx - 3; x <= tx + 3; x++) m.solid[ty * m.w + x] = 0;
    m.solid[ty * m.w + tx] = 2;
    const y = ty * TILE + 8;
    const hit = segmentSolidHit(m, (tx - 2) * TILE, y, (tx + 3) * TILE, y);
    expect(hit.hit).toBe(true);
    expect(hit.tx).toBe(tx);
    const miss = segmentSolidHit(m, (tx - 3) * TILE, y - TILE * 2, (tx - 1) * TILE, y - TILE * 2);
    expect(miss.hit).toBe(false);
  });

  it('detecta el primer punto donde un segmento toca a un gato', () => {
    expect(segmentCircleHit(0, 0, 100, 0, 50, 0, 6)).toBeCloseTo(0.44, 2);
    expect(segmentCircleHit(0, 0, 100, 0, 50, 30, 6)).toBe(-1);
    expect(segmentCircleHit(0, 0, 100, 0, 200, 0, 6)).toBe(-1);
    expect(segmentCircleHit(0, 0, 100, 0, 2, 0, 6)).toBe(0);
  });
});

describe('pelaje del gato', () => {
  it('valida el color base y la pintura de 384 celdas', () => {
    expect(isValidSkin(defaultSkin())).toBe(true);
    expect(isValidSkin({ base: 3, paint: 'f'.repeat(SKIN_CELLS) })).toBe(true);
    expect(isValidSkin({ base: 99, paint: '0'.repeat(SKIN_CELLS) })).toBe(false);
    expect(isValidSkin({ base: 0, paint: '0'.repeat(SKIN_CELLS - 1) })).toBe(false);
    expect(isValidSkin({ base: 0, paint: 'g'.repeat(SKIN_CELLS) })).toBe(false);
    expect(isValidSkin(null)).toBe(false);
  });

  it('los pelajes aleatorios de los bots siempre son válidos', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) expect(isValidSkin(randomSkin(rng))).toBe(true);
  });
});
