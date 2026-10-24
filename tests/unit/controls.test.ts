import { describe, expect, it } from 'vitest';
import { actionCircle, joystickCircle, slotCircle, type Layout } from '../../src/client/input';

const screens: [string, Layout][] = [
  ['iPhone SE horizontal', { w: 568, h: 320, l: 0, r: 0, t: 0, b: 0 }],
  ['iPhone 14 horizontal', { w: 844, h: 390, l: 47, r: 47, t: 0, b: 21 }],
  ['iPhone 14 Pro Max horizontal', { w: 932, h: 430, l: 59, r: 59, t: 0, b: 21 }],
  ['Pixel 7 horizontal', { w: 915, h: 412, l: 0, r: 0, t: 0, b: 0 }],
  ['iPad horizontal', { w: 1180, h: 820, l: 0, r: 0, t: 0, b: 20 }],
];

const overlap = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;

describe.each(screens)('controles táctiles en %s', (_name, layout) => {
  const circles = () => {
    const stick = joystickCircle(layout);
    const action = actionCircle(layout);
    const slots = [0, 1, 2].map((i) => slotCircle(layout, i));
    return { stick, action, slots };
  };

  it('joystick abajo a la izquierda y botón de acción abajo a la derecha', () => {
    const { stick, action } = circles();
    expect(stick.x).toBeLessThan(layout.w / 2);
    expect(stick.y).toBeGreaterThan(layout.h / 2);
    expect(action.x).toBeGreaterThan(layout.w / 2);
    expect(action.y).toBeGreaterThan(layout.h / 2);
  });

  it('nada se encima: ni los objetos entre sí, ni con el botón ni con el joystick', () => {
    const { stick, action, slots } = circles();
    expect(overlap(stick, action)).toBe(false);
    for (const s of slots) {
      expect(overlap(s, action)).toBe(false);
      expect(overlap(s, stick)).toBe(false);
    }
    expect(overlap(slots[0]!, slots[1]!)).toBe(false);
    expect(overlap(slots[1]!, slots[2]!)).toBe(false);
    expect(overlap(slots[0]!, slots[2]!)).toBe(false);
  });

  it('todo cabe en la pantalla respetando los márgenes seguros y es fácil de tocar', () => {
    const { stick, action, slots } = circles();
    for (const c of [stick, action, ...slots]) {
      expect(c.x - c.r).toBeGreaterThanOrEqual(layout.l);
      expect(c.x + c.r).toBeLessThanOrEqual(layout.w - layout.r);
      expect(c.y - c.r).toBeGreaterThan(layout.h * 0.2);
      expect(c.y + c.r).toBeLessThanOrEqual(layout.h - layout.b);
    }
    for (const s of slots) expect(s.r * 2).toBeGreaterThanOrEqual(56);
    expect(action.r * 2).toBeGreaterThanOrEqual(92);
  });
});
