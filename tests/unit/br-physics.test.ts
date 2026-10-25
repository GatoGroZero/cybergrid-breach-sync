import { describe, expect, it } from 'vitest';
import { CAT, TILE, TICK_DT } from '../../src/shared/br/constants';
import { generateMap } from '../../src/shared/br/map';
import {
  aimTouchesTarget,
  moveBox,
  normalizeMove,
  segmentCircleHit,
  segmentSolidHit,
  stepCat,
} from '../../src/shared/br/physics';
import { defaultSkin, isValidSkin, randomSkin } from '../../src/shared/br/skin';
import { createRng } from '../../src/shared/rng';
import { openMap } from './helpers';
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

describe('empujones largos', () => {
  it('un desplazamiento de varias casillas se detiene en el primer muro y no lo atraviesa', () => {
    const m = openMap(20, 20);
    // una pared gruesa de dos casillas en las filas 12 y 13
    for (let x = 1; x < 19; x++) {
      m.solid[12 * 20 + x] = 1;
      m.solid[13 * 20 + x] = 1;
    }
    const start = { x: 8.5 * TILE, y: 10.5 * TILE };
    const next = moveBox(m, start.x, start.y, 0, 5 * TILE, CAT.half);
    expect(next.y).toBeLessThan(12 * TILE);
    // y en diagonal tampoco se cuela
    const diag = moveBox(m, start.x, start.y, 3 * TILE, 4 * TILE, CAT.half);
    expect(diag.y).toBeLessThan(12 * TILE);
    // un paso normal da el mismo resultado que antes
    const small = moveBox(m, start.x, start.y, 2, 2, CAT.half);
    expect(small).toEqual({ x: start.x + 2, y: start.y + 2 });
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

describe('mira "solo con objetivo" (movil)', () => {
  const open = (): ReturnType<typeof openMap> => openMap(40, 20);

  it('toca a un gato en la linea, pero no si apunta a un lado o esta mas lejos que el alcance', () => {
    const m = open();
    const cat = { x: 200, y: 160 };
    expect(aimTouchesTarget(m, 100, 160, 0, 260, [cat])).toBe(true);
    // apuntando 20 grados arriba pasa de largo
    expect(aimTouchesTarget(m, 100, 160, -0.35, 260, [cat])).toBe(false);
    // el gato esta a 100 px y el alcance es de 60
    expect(aimTouchesTarget(m, 100, 160, 0, 60, [cat])).toBe(false);
    // sin gatos no hay objetivo
    expect(aimTouchesTarget(m, 100, 160, 0, 260, [])).toBe(false);
  });

  it('un muro colocado cuenta como objetivo, pero un arbol o una pared no', () => {
    const m = open();
    // casilla (8, 10) = pared de un arbol (1); casilla (12, 10) = muro colocado (2)
    m.solid[10 * m.w + 8] = 1;
    expect(aimTouchesTarget(m, 100, 168, 0, 300, [])).toBe(false);
    m.solid[10 * m.w + 8] = 0;
    m.solid[10 * m.w + 12] = 2;
    expect(aimTouchesTarget(m, 100, 168, 0, 300, [])).toBe(true);
    // el muro queda fuera del alcance
    expect(aimTouchesTarget(m, 100, 168, 0, 40, [])).toBe(false);
  });

  it('un gato escondido detras de un arbol no cuenta, y detras de un muro colocado el muro es el objetivo', () => {
    const m = open();
    const cat = { x: 260, y: 168 };
    m.solid[10 * m.w + 12] = 1;
    expect(aimTouchesTarget(m, 100, 168, 0, 300, [cat])).toBe(false);
    m.solid[10 * m.w + 12] = 2;
    expect(aimTouchesTarget(m, 100, 168, 0, 300, [cat])).toBe(true);
  });
});
