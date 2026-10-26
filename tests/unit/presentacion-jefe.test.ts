import { describe, expect, it } from 'vitest';
import { MOB, BOSS_ORDER, BOSS_INTRO_S } from '../../src/shared/br/adventure';
import {
  BOSS_AURA,
  BOSS_EPITHET,
  INTRO_NAME_AT,
  INTRO_OUT_S,
  INTRO_PAN_S,
  introFocus,
  introZoom,
} from '../../src/client/game/bossinfo';

describe('presentacion de los jefes en pantalla', () => {
  it('cada jefe tiene su color y su frase', () => {
    for (const kind of BOSS_ORDER) {
      expect(BOSS_AURA[kind], `color de ${kind}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(BOSS_EPITHET[kind]?.length, `frase de ${kind}`).toBeGreaterThan(10);
    }
    expect(BOSS_EPITHET[MOB.reyGato]).toContain('luna');
  });

  it('el enfoque empieza en 0, llega a 1 y vuelve a 0 antes de que empiece la pelea', () => {
    const T = BOSS_INTRO_S;
    expect(introFocus(0, T)).toBe(0);
    expect(introFocus(INTRO_PAN_S, T - INTRO_PAN_S)).toBe(1);
    expect(introFocus(T / 2, T / 2)).toBe(1);
    expect(introFocus(T - INTRO_OUT_S / 2, INTRO_OUT_S / 2)).toBeGreaterThan(0);
    expect(introFocus(T - INTRO_OUT_S / 2, INTRO_OUT_S / 2)).toBeLessThan(1);
    expect(introFocus(T, 0)).toBe(0);
  });

  it('el enfoque sube y baja sin saltos bruscos', () => {
    const T = BOSS_INTRO_S;
    let last = 0;
    let biggestJump = 0;
    for (let t = 0; t <= T; t += 1 / 60) {
      const f = introFocus(t, T - t);
      biggestJump = Math.max(biggestJump, Math.abs(f - last));
      last = f;
    }
    expect(biggestJump).toBeLessThan(0.08);
  });

  it('el zoom va de 1 a 1.7 con el enfoque', () => {
    expect(introZoom(0)).toBe(1);
    expect(introZoom(1)).toBeCloseTo(1.7, 5);
    expect(introZoom(0.5)).toBeGreaterThan(1);
  });

  it('hay tiempo para ver el nombre: sale antes de que el enfoque empiece a regresar', () => {
    expect(INTRO_NAME_AT).toBeGreaterThan(INTRO_PAN_S);
    expect(INTRO_NAME_AT).toBeLessThan(BOSS_INTRO_S - INTRO_OUT_S - 0.8);
  });
});
