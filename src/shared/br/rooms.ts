import { MAX_PLAYERS } from './constants';

/**
 * Cuantos bots lleva una sala: `'llenar'` completa hasta 10 gatos con los que falten,
 * un numero fija esa cantidad exacta (0 a 9).
 */
export type BotsSetting = 'llenar' | number;

export const BOTS_FILL = 'llenar' as const;
/** Una partida necesita al menos dos gatos, sean personas o bots. */
export const MIN_CATS = 2;

/** Cuantas personas caben: con bots exactos se les reserva su lugar. */
export function maxHumans(bots: BotsSetting): number {
  return bots === BOTS_FILL ? MAX_PLAYERS : MAX_PLAYERS - bots;
}

/** Bots que de verdad entran a la partida con `humans` personas en la sala. */
export function botsFor(bots: BotsSetting, humans: number): number {
  const free = Math.max(0, MAX_PLAYERS - humans);
  return bots === BOTS_FILL ? free : Math.min(bots, free);
}

export function canStart(bots: BotsSetting, humans: number): boolean {
  return humans >= 1 && humans + botsFor(bots, humans) >= MIN_CATS;
}
