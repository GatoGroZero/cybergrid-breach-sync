import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/rng';
import { disc, ell } from '../../src/client/pixel/draw';

/** Lienzo falso que solo anota las casillas pintadas y cuantas llamadas hizo. */
class Anota {
  fillStyle = '';
  calls = 0;
  readonly cells = new Set<string>();
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls++;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.cells.add(`${x + i},${y + j}`);
  }
}

/** La definicion de siempre: casilla por casilla. */
function referencia(cx: number, cy: number, rx: number, ry: number): Set<string> {
  const out = new Set<string>();
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) out.add(`${x},${y}`);
    }
  }
  return out;
}

describe('elipses y discos de pixeles', () => {
  it('pintan exactamente las mismas casillas que la definicion casilla por casilla', () => {
    const rng = createRng(77);
    for (let i = 0; i < 200; i++) {
      const cx = rng.range(-5, 40);
      const cy = rng.range(-5, 40);
      const rx = rng.range(0.6, 30);
      const ry = rng.range(0.6, 30);
      const c = new Anota();
      ell(c as unknown as CanvasRenderingContext2D, cx, cy, rx, ry, '#fff');
      expect(c.cells, `ell ${cx} ${cy} ${rx} ${ry}`).toEqual(referencia(cx, cy, rx, ry));
      const d = new Anota();
      disc(d as unknown as CanvasRenderingContext2D, cx, cy, rx, '#fff');
      expect(d.cells, `disc ${cx} ${cy} ${rx}`).toEqual(referencia(cx, cy, rx, rx));
    }
  });

  it('un resplandor grande cuesta pocas llamadas: una por fila', () => {
    const c = new Anota();
    ell(c as unknown as CanvasRenderingContext2D, 170, 140, 168, 143, '#fff');
    expect(c.cells.size).toBeGreaterThan(70_000);
    expect(c.calls).toBeLessThanOrEqual(290);
  });
});
