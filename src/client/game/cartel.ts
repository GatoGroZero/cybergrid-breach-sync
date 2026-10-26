import { TILE } from '../../shared/br/constants';

/** El cartel del tutorial: un letrero de madera en el claro donde empieza la Aventura. */
export interface Spot {
  x: number;
  y: number;
}

/** A cuantos pixeles se puede accionar el cartel. */
export const SIGN_RANGE = 34;

/**
 * Donde esta el cartel: a la derecha del centro del claro de inicio. El centro del claro se reserva
 * libre de adornos (once por once casillas), asi que ahi no estorba a nadie.
 */
export function signSpot(room: { x: number; y: number; w: number; h: number }): Spot {
  return {
    x: (room.x + Math.floor(room.w / 2) + 4) * TILE + TILE / 2,
    y: (room.y + Math.floor(room.h / 2) + 2) * TILE + TILE / 2,
  };
}

export const nearSign = (spot: Spot | null, x: number, y: number): boolean =>
  spot !== null && Math.hypot(spot.x - x, spot.y - y) <= SIGN_RANGE;
