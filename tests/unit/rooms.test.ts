import { describe, expect, it } from 'vitest';
import { botsFor, canStart, maxHumans } from '../../src/shared/br/rooms';

describe('reglas de sala con bots', () => {
  it('"llenar" completa hasta 10 gatos y deja entrar a 10 personas', () => {
    expect(maxHumans('llenar')).toBe(10);
    expect(botsFor('llenar', 1)).toBe(9);
    expect(botsFor('llenar', 4)).toBe(6);
    expect(botsFor('llenar', 10)).toBe(0);
  });

  it('un numero fija los bots y les reserva el lugar', () => {
    expect(maxHumans(6)).toBe(4);
    expect(maxHumans(0)).toBe(10);
    expect(botsFor(6, 4)).toBe(6);
    expect(botsFor(0, 3)).toBe(0);
    expect(botsFor(9, 1)).toBe(9);
  });

  it('nunca pasa de 10 gatos aunque entren mas personas de las previstas', () => {
    expect(botsFor(6, 7)).toBe(3);
    expect(botsFor(6, 12)).toBe(0);
  });

  it('para empezar hacen falta al menos 2 gatos contando bots', () => {
    expect(canStart('llenar', 1)).toBe(true);
    expect(canStart(0, 1)).toBe(false);
    expect(canStart(0, 2)).toBe(true);
    expect(canStart(1, 1)).toBe(true);
    expect(canStart(5, 0)).toBe(false);
  });
});
