import { describe, expect, it } from 'vitest';
import { PLAYER } from '../../src/shared/constants';
import {
  droneStats,
  maxDrones,
  mitigate,
  pickDroneKind,
  playerCountFactor,
  pulseDamage,
  scaleByWave,
  spawnInterval,
  waveAt,
} from '../../src/shared/formulas';

describe('formulas de dano y escalado', () => {
  it('el pulso hace el dano base y sube un nivel por nodo hasta el tope', () => {
    expect(pulseDamage(0)).toBe(PLAYER.baseDamage);
    expect(pulseDamage(1)).toBe(PLAYER.baseDamage + PLAYER.damagePerLevel);
    expect(pulseDamage(99)).toBe(PLAYER.baseDamage + PLAYER.damagePerLevel * 5);
    expect(pulseDamage(-3)).toBe(PLAYER.baseDamage);
  });

  it('los drones escalan con la oleada y con el numero de jugadores, sin bajar de la base', () => {
    expect(scaleByWave(100, 0, 0.5)).toBe(100);
    expect(scaleByWave(100, 4, 0.25)).toBe(200);
    expect(scaleByWave(100, -2, 0.5)).toBe(100);
    const early = droneStats('brute', 0, 1);
    const late = droneStats('brute', 8, 1);
    expect(late.hp).toBeGreaterThan(early.hp);
    expect(late.damage).toBeGreaterThan(early.damage);
    expect(droneStats('crawler', 3, 4).hp).toBeGreaterThan(droneStats('crawler', 3, 1).hp);
    expect(playerCountFactor(1)).toBe(1);
    expect(playerCountFactor(9)).toBe(playerCountFactor(4));
    expect(waveAt(0, 0)).toBe(0);
    expect(waveAt(85, 2)).toBe(4);
    expect(maxDrones(0, 1)).toBeLessThan(maxDrones(6, 4));
    expect(spawnInterval(20, 4)).toBeGreaterThanOrEqual(0.7);
  });

  it('la armadura reduce el dano pero un golpe nunca hace menos de 1 ni da NaN', () => {
    expect(mitigate(20, 0)).toBe(20);
    expect(mitigate(20, 100)).toBe(10);
    expect(mitigate(0.2, 500)).toBe(1);
    expect(Number.isNaN(mitigate(Number.NaN, Number.NaN))).toBe(false);
    expect(mitigate(Number.NaN, 10)).toBe(1);
    expect(mitigate(30, -50)).toBe(30);
  });

  it('el tipo de dron depende de la oleada y siempre devuelve un tipo valido', () => {
    expect(pickDroneKind(0, 0.99)).toBe('crawler');
    const seen = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) seen.add(pickDroneKind(8, r));
    expect(seen).toEqual(new Set(['crawler', 'spitter', 'brute']));
  });
});
