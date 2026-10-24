export interface Totals {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  appearances: number;
  survived: number;
  survivalSeconds: number;
}

export interface DerivedStats {
  winRate: number;
  kdr: number;
  survivalRate: number;
  avgSurvivalSec: number;
}

export const EMPTY_TOTALS: Totals = {
  matches: 0,
  wins: 0,
  kills: 0,
  deaths: 0,
  appearances: 0,
  survived: 0,
  survivalSeconds: 0,
};

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * Metricas de telemetria a partir de totales.
 * winRate = partidas ganadas / partidas. kdr = bajas / muertes (sin muertes, igual a las bajas).
 * survivalRate = participaciones que terminaron vivas / participaciones.
 * Con la base vacia devuelve ceros, nunca NaN ni division entre cero.
 */
export function computeStats(t: Totals): DerivedStats {
  return {
    winRate: t.matches > 0 ? round(t.wins / t.matches, 4) : 0,
    kdr: t.deaths > 0 ? round(t.kills / t.deaths, 2) : round(t.kills, 2),
    survivalRate: t.appearances > 0 ? round(t.survived / t.appearances, 4) : 0,
    avgSurvivalSec: t.appearances > 0 ? round(t.survivalSeconds / t.appearances, 1) : 0,
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] as number;
}
