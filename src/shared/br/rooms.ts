import { MAX_PLAYERS } from './constants';
import {
  ROUNDS_TO_WIN,
  TERRITORY_MAX_TEAM,
  TERRITORY_MIN_TEAM,
  duelTeamSize,
  type DuelFormat,
  type GameMode,
} from './modes';

/**
 * Cuantos bots lleva una sala: `'llenar'` completa hasta 12 gatos con los que falten,
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

// ---------------------------------------------------------------- reglas por modo

/** Lo que una sala decide y define cuantos gatos caben y si se puede empezar. */
export interface RoomRules {
  mode: GameMode;
  bots: BotsSetting;
  format: DuelFormat;
  teamSize: number;
}

export const DEFAULT_RULES: RoomRules = {
  mode: 'br',
  bots: BOTS_FILL,
  format: '1v1',
  teamSize: TERRITORY_MAX_TEAM,
};

/** Gatos por equipo (0 si el modo no es por equipos). */
export function teamSizeOf(r: RoomRules): number {
  if (r.mode === 'techo') return duelTeamSize(r.format);
  if (r.mode === 'territorio')
    return Math.max(TERRITORY_MIN_TEAM, Math.min(TERRITORY_MAX_TEAM, r.teamSize));
  return 0;
}

export const AVENTURA_MAX = 4;

/** Cuantas personas caben en la sala. */
export function humanCapacity(r: RoomRules): number {
  if (r.mode === 'aventura') return AVENTURA_MAX;
  const team = teamSizeOf(r);
  if (team > 0) return team * 2;
  return maxHumans(r.bots);
}

/** Bots que entran a la partida con `humans` personas en la sala. */
export function botCountFor(r: RoomRules, humans: number): number {
  if (r.mode === 'aventura') return 0;
  const team = teamSizeOf(r);
  if (team > 0) return Math.max(0, team * 2 - humans);
  return botsFor(r.bots, humans);
}

/** Gatos en la partida contando bots. */
export function totalCatsFor(r: RoomRules, humans: number): number {
  return humans + botCountFor(r, humans);
}

/** Si hay gatos suficientes para empezar (en equipos nunca pasan mas personas de las que caben por lado). */
export function startable(
  r: RoomRules,
  humans: number,
  teamHumans: [number, number] = [0, 0],
): boolean {
  if (humans < 1) return false;
  if (r.mode === 'aventura') return humans <= AVENTURA_MAX;
  const team = teamSizeOf(r);
  if (team > 0) return teamHumans[0] <= team && teamHumans[1] <= team;
  return canStart(r.bots, humans);
}

export { ROUNDS_TO_WIN };
