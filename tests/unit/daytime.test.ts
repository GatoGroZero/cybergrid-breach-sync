import { describe, expect, it } from 'vitest';
import { DAY_SPAN_S, dayName, dayPhase, dayStart, daylightAt } from '../../src/shared/br/daytime';

describe('hora del dia', () => {
  it('es determinista por semilla y casi siempre arranca de dia', () => {
    expect(dayStart(12345)).toBe(dayStart(12345));
    let day = 0;
    let late = 0;
    let dusk = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const s = dayStart(seed * 7919);
      if (s === 0) day++;
      else if (s === 0.2) late++;
      else if (s === 0.4) dusk++;
      else throw new Error(`hora inicial inesperada ${s}`);
    }
    expect(day / 2000).toBeGreaterThan(0.5);
    expect(day / 2000).toBeLessThan(0.66);
    expect(late).toBeGreaterThan(300);
    expect(dusk).toBeGreaterThan(250);
  });

  it('avanza sin retroceder y llega a la noche cerrada', () => {
    const seed = 99;
    let last = -1;
    for (let t = 0; t <= DAY_SPAN_S + 20; t += 5) {
      const p = dayPhase(seed, t);
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      last = p;
    }
    expect(dayPhase(seed, DAY_SPAN_S * 2)).toBe(1);
    expect(dayPhase(seed, -50)).toBe(dayStart(seed));
  });

  it('las horas se llaman Dia, Tarde, Atardecer, Anochecer y Noche en ese orden', () => {
    expect(dayName(0)).toBe('Día');
    expect(dayName(0.3)).toBe('Tarde');
    expect(dayName(0.5)).toBe('Atardecer');
    expect(dayName(0.7)).toBe('Anochecer');
    expect(dayName(0.9)).toBe('Noche');
    expect(dayName(1)).toBe('Noche');
  });

  it('de dia no hay velo y de noche el velo es azul y oscuro, pero deja ver', () => {
    const noon = daylightAt(0);
    expect(noon.alpha).toBe(0);
    expect(noon.night).toBe(0);
    expect(noon.sun).toBe(1);
    const night = daylightAt(1);
    expect(night.night).toBe(1);
    expect(night.sun).toBe(0);
    expect(night.alpha).toBeGreaterThan(0.3);
    // nunca tan opaco que no se vea nada
    expect(night.alpha).toBeLessThan(0.62);
    expect(night.tint[2]).toBeGreaterThan(night.tint[0]);
    const sunset = daylightAt(0.5);
    expect(sunset.tint[0]).toBeGreaterThan(sunset.tint[2]);
    expect(sunset.dusk).toBeGreaterThan(0.6);
  });

  it('el velo cambia de forma continua, sin saltos', () => {
    let prev = daylightAt(0);
    for (let i = 1; i <= 200; i++) {
      const cur = daylightAt(i / 200);
      expect(Math.abs(cur.alpha - prev.alpha)).toBeLessThan(0.04);
      for (let c = 0; c < 3; c++)
        expect(Math.abs((cur.tint[c] as number) - (prev.tint[c] as number))).toBeLessThan(20);
      prev = cur;
    }
  });
});
