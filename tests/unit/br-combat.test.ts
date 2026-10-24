import { describe, expect, it } from 'vitest';
import {
  HEAL,
  applyDamage,
  healDuration,
  healMissing,
  healStep,
  splashDamage,
} from '../../src/shared/br/combat';
import {
  ZONE_DPS,
  ZONE_TIMELINE,
  fullMapCircle,
  insideCircle,
  planZones,
  zoneAt,
} from '../../src/shared/br/zone';
import { createRng } from '../../src/shared/rng';

describe('vida, escudo y curación', () => {
  it('el escudo absorbe primero y el resto pasa a la vida, sin números negativos', () => {
    expect(applyDamage({ hp: 100, shield: 0 }, 30)).toMatchObject({ hp: 70, shield: 0, dealt: 30 });
    expect(applyDamage({ hp: 100, shield: 50 }, 30)).toMatchObject({
      hp: 100,
      shield: 20,
      dealt: 30,
    });
    expect(applyDamage({ hp: 100, shield: 20 }, 50)).toMatchObject({
      hp: 70,
      shield: 0,
      dealt: 50,
    });
    expect(applyDamage({ hp: 10, shield: 0 }, 999)).toMatchObject({ hp: 0, shield: 0, dealt: 10 });
    expect(applyDamage({ hp: 50, shield: 5 }, Number.NaN)).toMatchObject({ hp: 50, shield: 5 });
    expect(applyDamage({ hp: 50, shield: 5 }, -20)).toMatchObject({ hp: 50, shield: 5 });
  });

  it('el botiquín cura 10 por segundo hasta 100 y se detiene ahí', () => {
    let v = { hp: 70, shield: 0 };
    const trace: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = healStep('medkit', v);
      v = { hp: r.hp, shield: r.shield };
      trace.push(r.hp);
      if (r.done) break;
    }
    expect(trace).toEqual([80, 90, 100]);
    expect(healStep('medkit', { hp: 95, shield: 0 })).toMatchObject({ hp: 100, done: true });
    expect(healDuration('medkit', { hp: 20, shield: 0 })).toBe(8);
    expect(healMissing('medkit', { hp: 100, shield: 0 })).toBe(0);
  });

  it('cada escudo da 10 por segundo durante 5 segundos (50 en total), sin tocar la vida', () => {
    let v = { hp: 40, shield: 10 };
    let left: number = HEAL.shield.total;
    const trace: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = healStep('shield', v, left);
      v = { hp: r.hp, shield: r.shield };
      left = r.left;
      trace.push(r.shield);
      if (r.done) break;
    }
    expect(trace).toEqual([20, 30, 40, 50, 60]);
    expect(v.hp).toBe(40);
    expect(HEAL.shield.total).toBe(50);
    expect(healDuration('shield', { hp: 100, shield: 0 })).toBe(5);
    expect(healDuration('shield', { hp: 100, shield: 80 })).toBe(2);
    expect(healMissing('shield', { hp: 100, shield: 100 })).toBe(0);
    // Con 90 de escudo solo se llega a 100 y el sobrante del escudo no se acumula.
    expect(healStep('shield', { hp: 100, shield: 95 }, 50)).toMatchObject({
      shield: 100,
      done: true,
    });
  });

  it('la explosión daña más en el centro y menos en el borde', () => {
    expect(splashDamage(90, 0, 34)).toBe(90);
    expect(splashDamage(90, 17, 34)).toBeLessThan(90);
    expect(splashDamage(90, 17, 34)).toBeGreaterThan(splashDamage(90, 33, 34));
    expect(splashDamage(90, 34, 34)).toBe(0);
    expect(splashDamage(90, 99, 34)).toBe(0);
  });
});

describe('zona de ola: tres zonas aleatorias y partida de máximo 15 minutos', () => {
  const W = 1536;
  const H = 1024;

  it('las zonas son aleatorias según la semilla y cada una cabe dentro de la anterior', () => {
    const a = planZones(createRng(1), W, H);
    const b = planZones(createRng(2), W, H);
    expect(a).not.toEqual(b);
    expect(planZones(createRng(1), W, H)).toEqual(a);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [z1, z2, z3] = planZones(createRng(seed), W, H);
      expect(z2.r).toBeLessThan(z1.r);
      expect(z3.r).toBeLessThan(z2.r);
      expect(Math.hypot(z2.cx - z1.cx, z2.cy - z1.cy) + z2.r).toBeLessThanOrEqual(z1.r + 1e-6);
      expect(Math.hypot(z3.cx - z2.cx, z3.cy - z2.cy) + z3.r).toBeLessThanOrEqual(z2.r + 1e-6);
    }
  });

  it('30 s de calma, cierra en 10 s, avisa 20 s, cierra en 15 s, cuenta 10 s y colapsa', () => {
    const plan = planZones(createRng(3), W, H);
    const full = fullMapCircle(W, H);
    const T = ZONE_TIMELINE;
    expect([T.start1, T.shrink1, T.start2, T.shrink2, T.start3]).toEqual([30, 10, 60, 15, 85]);

    // calma: sin daño y con el mapa entero a salvo
    expect(zoneAt(plan, W, H, 0)).toMatchObject({ phase: 0, dps: 0, shrinking: false });
    expect(zoneAt(plan, W, H, 29).dps).toBe(0);
    expect(zoneAt(plan, W, H, 29).circle.r).toBe(full.r);
    expect(zoneAt(plan, W, H, 29).nextIn).toBe(1);

    // primera ola: 10 segundos para cerrar hasta la zona 1
    const closing = zoneAt(plan, W, H, 35);
    expect(closing).toMatchObject({ phase: 1, shrinking: true });
    expect(closing.circle.r).toBeLessThan(full.r);
    expect(closing.circle.r).toBeGreaterThan(plan[0].r);
    expect(zoneAt(plan, W, H, 40).circle).toEqual(plan[0]);

    // aviso: en 20 segundos se cierra la segunda ola
    const wait = zoneAt(plan, W, H, 40);
    expect(wait).toMatchObject({ phase: 1, shrinking: false });
    expect(wait.nextIn).toBe(20);
    expect(wait.next).toEqual(plan[1]);

    // segunda ola: 15 segundos hasta la zona 2
    expect(zoneAt(plan, W, H, 60)).toMatchObject({ phase: 2, shrinking: true });
    expect(zoneAt(plan, W, H, 67).circle.r).toBeLessThan(plan[0].r);
    expect(zoneAt(plan, W, H, 75).circle).toEqual(plan[1]);

    // ultima ola: cuenta de 10 segundos con el refugio final a la vista
    const last = zoneAt(plan, W, H, 75);
    expect(last).toMatchObject({ phase: 3, shrinking: false });
    expect(last.nextIn).toBe(10);
    expect(last.next).toEqual(plan[2]);
    expect(zoneAt(plan, W, H, 84).circle).toEqual(plan[1]);

    // colapso: empieza a cerrar hasta inundar todo
    expect(zoneAt(plan, W, H, 85)).toMatchObject({ phase: 4, shrinking: true });
    expect(zoneAt(plan, W, H, 105).circle.r).toBeLessThan(plan[1].r);
  });

  it('a los 2 minutos ya no queda zona libre y el daño sube con cada fase', () => {
    const plan = planZones(createRng(4), W, H);
    const T = ZONE_TIMELINE;
    expect(zoneAt(plan, W, H, T.start3 + T.collapse).circle.r).toBe(0);
    expect(zoneAt(plan, W, H, T.start3 + T.collapse - 5).circle.r).toBeLessThan(plan[1].r);
    expect(zoneAt(plan, W, H, T.end).circle.r).toBe(0);
    expect(T.end).toBeLessThanOrEqual(150);
    const dps = [1, 35, 50, 70, 90, 120].map((t) => zoneAt(plan, W, H, t).dps);
    for (let i = 1; i < dps.length; i++)
      expect(dps[i]).toBeGreaterThanOrEqual(dps[i - 1] as number);
    expect(ZONE_DPS[4]).toBeGreaterThan(ZONE_DPS[1]);
  });

  it('el radio de la zona nunca crece y insideCircle distingue dentro y fuera', () => {
    const plan = planZones(createRng(9), W, H);
    let prev = Infinity;
    for (let t = 0; t <= ZONE_TIMELINE.end; t += 1) {
      const r = zoneAt(plan, W, H, t).circle.r;
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
    expect(insideCircle({ cx: 100, cy: 100, r: 50 }, 120, 100)).toBe(true);
    expect(insideCircle({ cx: 100, cy: 100, r: 50 }, 200, 100)).toBe(false);
  });
});
