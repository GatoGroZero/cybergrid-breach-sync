import { describe, expect, it } from 'vitest';
import { STAMINA, fullStamina, stepStamina } from '../../src/shared/br/stamina';

const DT = 1 / 30;

function run(state = fullStamina(), ticks: number, wantsRun: boolean, move = 1) {
  let running = false;
  for (let i = 0; i < ticks; i++) running = stepStamina(state, wantsRun, move, DT);
  return { state, running };
}

describe('estamina para correr', () => {
  it('empieza llena y correr la gasta en 5 segundos', () => {
    const s = fullStamina();
    expect(s.value).toBe(STAMINA.max);
    run(s, 75, true);
    expect(s.value).toBeCloseTo(50, 0);
    run(s, 75, true);
    expect(s.value).toBeLessThan(0.5);
    expect(s.tired).toBe(true);
  });

  it('quieto o caminando se llena en 4 segundos; mientras corre no se recupera', () => {
    const s = fullStamina();
    s.value = 0;
    s.tired = true;
    run(s, 119, false);
    expect(s.value).toBeLessThan(100);
    run(s, 2, false);
    expect(s.value).toBe(100);
    expect(s.tired).toBe(false);
    // correr nunca sube la barra
    const before = s.value;
    run(s, 10, true);
    expect(s.value).toBeLessThan(before);
  });

  it('cansado no corre hasta recuperar el minimo, aunque lo pida', () => {
    const s = { value: 0, tired: true };
    expect(run(s, 5, true).running).toBe(false);
    run(s, 30, false);
    expect(s.value).toBeGreaterThan(STAMINA.resumeAt);
    expect(s.tired).toBe(false);
    expect(stepStamina(s, true, 1, DT)).toBe(true);
  });

  it('a media recuperacion se puede correr y entonces la recuperacion se detiene', () => {
    const s = fullStamina();
    s.value = 40;
    expect(stepStamina(s, true, 1, DT)).toBe(true);
    expect(s.value).toBeLessThan(40);
  });

  it('pedir correr sin moverse cuenta como estar quieto', () => {
    const s = fullStamina();
    s.value = 50;
    expect(stepStamina(s, true, 0, DT)).toBe(false);
    expect(s.value).toBeGreaterThan(50);
  });
});
