import { describe, expect, it } from 'vitest';
import { OUTFIT_COUNT } from '../../src/shared/br/outfits';
import { drawOutfit } from '../../src/client/pixel/outfits';

/** Un lienzo falso que anota las casillas pintadas (entiende save, restore y translate). */
class Anota {
  fillStyle = '';
  readonly cells = new Set<string>();
  private tx = 0;
  private ty = 0;
  private readonly pila: [number, number][] = [];
  save(): void {
    this.pila.push([this.tx, this.ty]);
  }
  restore(): void {
    [this.tx, this.ty] = this.pila.pop() ?? [0, 0];
  }
  translate(x: number, y: number): void {
    this.tx += x;
    this.ty += y;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    for (let i = 0; i < w; i++)
      for (let j = 0; j < h; j++) this.cells.add(`${x + this.tx + i},${y + this.ty + j}`);
  }
}

function pintadas(code: number, frame: number): Set<string> {
  const c = new Anota();
  for (const layer of ['back', 'front'] as const)
    drawOutfit(code, layer, c as unknown as CanvasRenderingContext2D, { frame, dy: 0 });
  return c.cells;
}

describe('los trajes cubren el tronco del gato', () => {
  it('todos los trajes llegan hasta la fila del lomo (la 5) en la parte de arriba del tronco', () => {
    for (let code = 1; code <= OUTFIT_COUNT; code++) {
      for (const frame of [0, 1, 3]) {
        const cells = pintadas(code, frame);
        let covered = 0;
        for (let x = 6; x <= 12; x++) if (cells.has(`${x},5`)) covered++;
        expect(covered, `traje ${code} cuadro ${frame}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('las prendas del tronco no cuelgan mas abajo de la fila 12 (sobre las patas)', () => {
    // el fantasma es una sabana larga, la capa del vampiro cae hasta el suelo, y la momia y el
    // esqueleto visten tambien las patas: todo eso es a proposito
    const conPatas = new Set([3, 4, 5, 6]);
    for (let code = 1; code <= OUTFIT_COUNT; code++) {
      if (conPatas.has(code)) continue;
      const cells = pintadas(code, 0);
      for (let x = 4; x <= 14; x++) {
        for (let y = 13; y <= 16; y++)
          expect(cells.has(`${x},${y}`), `traje ${code} en ${x},${y}`).toBe(false);
      }
    }
  });
});
