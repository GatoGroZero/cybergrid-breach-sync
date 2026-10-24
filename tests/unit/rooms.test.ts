import { describe, expect, it } from 'vitest';
import { botsFor, canStart, maxHumans } from '../../src/shared/br/rooms';

describe('reglas de sala con bots', () => {
  it('"llenar" completa hasta 12 gatos y deja entrar a 12 personas', () => {
    expect(maxHumans('llenar')).toBe(12);
    expect(botsFor('llenar', 1)).toBe(11);
    expect(botsFor('llenar', 4)).toBe(8);
    expect(botsFor('llenar', 12)).toBe(0);
  });

  it('un numero fija los bots y les reserva el lugar', () => {
    expect(maxHumans(8)).toBe(4);
    expect(maxHumans(0)).toBe(12);
    expect(botsFor(8, 4)).toBe(8);
    expect(botsFor(0, 3)).toBe(0);
    expect(botsFor(11, 1)).toBe(11);
  });

  it('nunca pasa de 12 gatos aunque entren mas personas de las previstas', () => {
    expect(botsFor(6, 9)).toBe(3);
    expect(botsFor(6, 14)).toBe(0);
  });

  it('para empezar hacen falta al menos 2 gatos contando bots', () => {
    expect(canStart('llenar', 1)).toBe(true);
    expect(canStart(0, 1)).toBe(false);
    expect(canStart(0, 2)).toBe(true);
    expect(canStart(1, 1)).toBe(true);
    expect(canStart(5, 0)).toBe(false);
  });
});
