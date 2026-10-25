import { describe, expect, it } from 'vitest';
import { G } from '../../src/shared/br/map';
import { spatial, surfaceFor } from '../../src/client/audio';

describe('pisadas segun el piso', () => {
  it('cada terreno suena como lo que es', () => {
    expect(surfaceFor(G.GRASS)).toBe('grass');
    expect(surfaceFor(G.GRASS3)).toBe('grass');
    expect(surfaceFor(G.FLOWER)).toBe('grass');
    expect(surfaceFor(G.HEDGE)).toBe('grass');
    expect(surfaceFor(G.PATH)).toBe('path');
    expect(surfaceFor(G.DIRT)).toBe('path');
    expect(surfaceFor(G.SAND)).toBe('path');
    expect(surfaceFor(G.WOOD)).toBe('wood');
    expect(surfaceFor(G.WOOD2)).toBe('wood');
    expect(surfaceFor(G.DECK)).toBe('deck');
    expect(surfaceFor(G.DECK2)).toBe('deck');
    expect(surfaceFor(G.CARPET)).toBe('carpet');
    expect(surfaceFor(G.BEDSHADE)).toBe('carpet');
    expect(surfaceFor(G.TILE)).toBe('stone');
    expect(surfaceFor(G.POOLEDGE)).toBe('stone');
    expect(surfaceFor(G.WATER)).toBe('water');
  });

  it('todos los terrenos conocidos tienen un sonido', () => {
    for (const id of Object.values(G))
      expect(['grass', 'path', 'wood', 'deck', 'carpet', 'stone', 'water']).toContain(
        surfaceFor(id),
      );
  });
});

describe('sonido espacial', () => {
  it('el volumen baja con la distancia y se apaga mas alla del oido', () => {
    expect(spatial(0, 0).v).toBe(1);
    expect(spatial(100, 0).v).toBeGreaterThan(spatial(300, 0).v);
    expect(spatial(420, 0).v).toBe(0);
    expect(spatial(900, 900).v).toBe(0);
    expect(spatial(60, 80, 200).v).toBeCloseTo(0.5, 5);
  });

  it('el lado sigue de donde viene: izquierda negativa, derecha positiva, siempre entre -1 y 1', () => {
    expect(spatial(-150, 0).pan).toBeLessThan(0);
    expect(spatial(150, 0).pan).toBeGreaterThan(0);
    expect(spatial(0, 200).pan).toBe(0);
    expect(spatial(-9999, 0).pan).toBe(-1);
    expect(spatial(9999, 0).pan).toBe(1);
  });
});
