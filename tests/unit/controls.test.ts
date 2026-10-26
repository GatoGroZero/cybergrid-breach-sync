import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYS,
  DEFAULT_TOUCH,
  ACTIONS,
  TOUCH_MIN_ALPHA,
  keyLabel,
  loadTouchLayout,
  touchAlpha,
  touchCircles,
  type Circle,
} from '../../src/client/game/input';

const overlap = (a: Circle, b: Circle): boolean => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 2;

describe('controles tactiles (geometria)', () => {
  it.each([
    [844, 390],
    [667, 375],
    [932, 430],
    [1180, 820],
  ])('en %i x %i los botones caben en pantalla y no se encima ninguno', (w, h) => {
    const c = touchCircles(DEFAULT_TOUCH, w, h);
    const singles: Circle[] = [c.stick, c.aim, c.interact, c.bag, c.menu, c.map, c.emote, c.reload];
    for (const k of [...singles, ...c.slots]) {
      expect(k.x - k.r).toBeGreaterThanOrEqual(0);
      expect(k.x + k.r).toBeLessThanOrEqual(w);
      expect(k.y - k.r).toBeGreaterThanOrEqual(0);
      expect(k.y + k.r).toBeLessThanOrEqual(h);
    }
    const all = [...singles, ...c.slots];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlap(all[i] as Circle, all[j] as Circle)).toBe(false);
      }
    }
  });

  it('la barra de objetos tiene 5 espacios parejos y el boton de fuego queda abajo a la derecha', () => {
    const c = touchCircles(DEFAULT_TOUCH, 844, 390);
    expect(c.slots).toHaveLength(5);
    const gaps = c.slots.slice(1).map((s, i) => s.x - (c.slots[i] as Circle).x);
    for (const g of gaps) expect(Math.abs(g - (gaps[0] as number))).toBeLessThan(0.01);
    expect(c.aim.x).toBeGreaterThan(844 * 0.7);
    expect(c.aim.y).toBeGreaterThan(390 * 0.5);
    expect(c.stick.x).toBeLessThan(844 * 0.3);
  });

  it('cambiar la escala de un boton agranda su circulo y no mueve el resto', () => {
    const big = structuredClone(DEFAULT_TOUCH);
    big.aim.s = 1.8;
    const a = touchCircles(DEFAULT_TOUCH, 844, 390);
    const b = touchCircles(big, 844, 390);
    expect(b.aim.r).toBeGreaterThan(a.aim.r * 1.5);
    expect(b.stick).toEqual(a.stick);
    expect(b.interact).toEqual(a.interact);
  });
});

describe('teclas del teclado', () => {
  it('cada accion tiene una tecla distinta por defecto y una etiqueta legible', () => {
    const codes = ACTIONS.map((a) => DEFAULT_KEYS[a]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Space')).toBe('Espacio');
  });
});

describe('transparencia de los botones tactiles', () => {
  const guardar = (valor: unknown): void => {
    const store = new Map<string, string>([['cg_touch', JSON.stringify(valor)]]);
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null },
    };
  };

  it('un boton sin opacidad guardada se ve como siempre (1)', () => {
    guardar({ aim: { x: 0.8, y: 0.6, s: 1 } });
    const layout = loadTouchLayout();
    expect(touchAlpha(layout.aim)).toBe(1);
    expect(layout.aim.a).toBeUndefined();
    expect(touchAlpha(layout.stick)).toBe(1);
  });

  it('la opacidad guardada se respeta y se recorta entre el minimo y 1', () => {
    guardar({
      aim: { x: 0.8, y: 0.6, s: 1, a: 0.5 },
      stick: { x: 0.1, y: 0.7, s: 1, a: 0.01 },
      bag: { x: 0.9, y: 0.4, s: 1, a: 7 },
      menu: { x: 0.1, y: 0.1, s: 1, a: 'mucha' },
    });
    const layout = loadTouchLayout();
    expect(layout.aim.a).toBe(0.5);
    expect(layout.stick.a).toBe(TOUCH_MIN_ALPHA);
    expect(layout.bag.a).toBe(1);
    expect(layout.menu.a).toBeUndefined();
  });
});
