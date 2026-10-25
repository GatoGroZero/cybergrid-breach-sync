/**
 * Hora del dia de una partida. Cada partida arranca de dia (a veces ya de tarde o en el atardecer)
 * y avanza sola hasta la noche. Solo depende de la semilla y del reloj de la partida, asi que el
 * cliente la calcula sin que el servidor mande nada nuevo.
 *
 * `p` va de 0 (pleno dia) a 1 (noche cerrada).
 */
export const DAY_SPAN_S = 160;

export type Rgb = [number, number, number];

export interface Daylight {
  p: number;
  name: DayName;
  /** Color del velo de la hora y su opacidad (0 de dia). */
  tint: Rgb;
  alpha: number;
  /** 0 a 1: cuanto se nota la noche (luciernagas, lamparas, grillos). */
  night: number;
  /** 0 a 1: cuanto se nota el atardecer (cielo anaranjado y murcielagos). */
  dusk: number;
  /** 0 a 1: cuanto sol queda (rayos de luz y pajaros). */
  sun: number;
}

export type DayName = 'Día' | 'Tarde' | 'Atardecer' | 'Anochecer' | 'Noche';

/** Cortes entre una hora y la siguiente. */
export const DAY_CUTS: readonly [number, DayName][] = [
  [0.22, 'Día'],
  [0.42, 'Tarde'],
  [0.6, 'Atardecer'],
  [0.78, 'Anochecer'],
  [1.01, 'Noche'],
];

const KEYS: { p: number; tint: Rgb; alpha: number }[] = [
  { p: 0, tint: [255, 244, 214], alpha: 0 },
  { p: 0.28, tint: [255, 208, 130], alpha: 0.06 },
  { p: 0.5, tint: [255, 112, 64], alpha: 0.2 },
  { p: 0.66, tint: [124, 56, 142], alpha: 0.31 },
  { p: 0.82, tint: [22, 34, 104], alpha: 0.48 },
  { p: 1, tint: [10, 16, 72], alpha: 0.58 },
];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Con que hora empieza la partida: casi siempre de dia, a veces ya de tarde o atardeciendo. */
export function dayStart(seed: number): number {
  let h = Math.imul(seed ^ 0x2545f491, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  const r = (h >>> 8) / 0x1000000;
  return r < 0.58 ? 0 : r < 0.82 ? 0.2 : 0.4;
}

/** Hora (0 a 1) a los `clockS` segundos de una partida con esa semilla. */
export function dayPhase(seed: number, clockS: number): number {
  return clamp01(dayStart(seed) + Math.max(0, clockS) / DAY_SPAN_S);
}

export function dayName(p: number): DayName {
  for (const [cut, name] of DAY_CUTS) if (p < cut) return name;
  return 'Noche';
}

export function daylightAt(p: number): Daylight {
  const v = clamp01(p);
  let a = KEYS[0] as (typeof KEYS)[number];
  let b = KEYS[KEYS.length - 1] as (typeof KEYS)[number];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const lo = KEYS[i] as (typeof KEYS)[number];
    const hi = KEYS[i + 1] as (typeof KEYS)[number];
    if (v >= lo.p && v <= hi.p) {
      a = lo;
      b = hi;
      break;
    }
  }
  const k = b.p === a.p ? 0 : (v - a.p) / (b.p - a.p);
  const mix = (x: number, y: number): number => x + (y - x) * k;
  return {
    p: v,
    name: dayName(v),
    tint: [
      Math.round(mix(a.tint[0], b.tint[0])),
      Math.round(mix(a.tint[1], b.tint[1])),
      Math.round(mix(a.tint[2], b.tint[2])),
    ],
    alpha: mix(a.alpha, b.alpha),
    night: smooth(0.5, 0.85, v),
    dusk: smooth(0.28, 0.5, v) * (1 - smooth(0.66, 0.85, v)),
    sun: 1 - smooth(0.4, 0.7, v),
  };
}
