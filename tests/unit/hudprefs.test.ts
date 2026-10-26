import { describe, expect, it } from 'vitest';
import {
  HUD_DEFAULTS,
  HUD_MAX,
  HUD_MIN,
  clampScale,
  parseHudPrefs,
  withScale,
} from '../../src/client/game/hudprefs';

describe('tamano del HUD a gusto de cada quien', () => {
  it('sin nada guardado todo queda en el tamano de siempre', () => {
    expect(parseHudPrefs(null)).toEqual(HUD_DEFAULTS);
    expect(parseHudPrefs('basura')).toEqual(HUD_DEFAULTS);
    expect(parseHudPrefs({})).toEqual(HUD_DEFAULTS);
  });

  it('conserva lo valido, redondea a pasos de 5 % y recorta lo que se pase', () => {
    const p = parseHudPrefs({ msg: 0.73, boss: 99, bars: -3, top: 'grande' });
    expect(p.msg).toBe(0.75);
    expect(p.boss).toBe(HUD_MAX);
    expect(p.bars).toBe(HUD_MIN);
    expect(p.top).toBe(1);
  });

  it('una escala no valida cae al valor de respaldo', () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity, 0.8)).toBe(0.8);
    expect(clampScale(undefined)).toBe(1);
    expect(clampScale(1.23)).toBe(1.25);
  });

  it('escalar deja quieto el punto de anclaje y restaura el lienzo', () => {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      translate: (x: number, y: number) => calls.push(`t${x},${y}`),
      scale: (x: number, y: number) => calls.push(`s${x},${y}`),
    } as unknown as CanvasRenderingContext2D;
    withScale(ctx, 100, 20, 1.5, () => calls.push('dibuja'));
    expect(calls).toEqual(['save', 't100,20', 's1.5,1.5', 't-100,-20', 'dibuja', 'restore']);
    calls.length = 0;
    withScale(ctx, 100, 20, 1, () => calls.push('dibuja'));
    expect(calls).toEqual(['dibuja']);
  });
});
