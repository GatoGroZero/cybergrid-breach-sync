import type { Rng } from '../rng';

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Linea de tiempo de la ola (segundos desde el inicio). La partida dura unos dos minutos:
 *  0 a 30     calma para buscar armas y municion
 *  30 a 40    la ola cierra hasta la zona 1 (10 s)
 *  40 a 60    aviso: en 20 s se cierra la segunda ola
 *  60 a 75    la ola cierra hasta la zona 2 (15 s)
 *  75 a 85    "ultima ola cerrandose": cuenta de 10 s
 *  85 a 125   la ola cierra hasta inundarlo todo
 */
export const ZONE_TIMELINE = {
  start1: 30,
  shrink1: 10,
  start2: 60,
  shrink2: 15,
  start3: 85,
  collapse: 40,
  end: 135,
} as const;

/** Daño por segundo fuera de la zona segun la fase (calma, 1, 2, ultima ola y colapso). */
export const ZONE_DPS = [0, 4, 7, 9, 14] as const;

export type ZonePlan = [Circle, Circle, Circle];

/** Zonas aleatorias y anidadas: cada una cabe dentro de la anterior. */
export function planZones(rng: Rng, widthPx: number, heightPx: number): ZonePlan {
  const minDim = Math.min(widthPx, heightPx);
  const mid = { x: widthPx / 2, y: heightPx / 2 };
  const r1 = minDim * 0.46;
  const z1: Circle = {
    cx: mid.x + rng.range(-0.12, 0.12) * widthPx,
    cy: mid.y + rng.range(-0.1, 0.1) * heightPx,
    r: r1,
  };
  const nested = (parent: Circle, factor: number): Circle => {
    const r = parent.r * factor;
    const maxOffset = Math.max(0, parent.r - r - 6);
    const angle = rng.range(0, Math.PI * 2);
    const dist = Math.sqrt(rng.next()) * maxOffset;
    return { cx: parent.cx + Math.cos(angle) * dist, cy: parent.cy + Math.sin(angle) * dist, r };
  };
  const z2 = nested(z1, 0.56);
  const z3 = nested(z2, 0.5);
  return [z1, z2, z3];
}

export interface ZoneState {
  /** Circulo seguro en este instante. */
  circle: Circle;
  /** 0 calma, 1 y 2 las dos primeras olas, 3 ultima ola (cuenta de 10 s), 4 colapso final. */
  phase: number;
  shrinking: boolean;
  /** Proxima zona que se ve en el mapa (contorno), o null. */
  next: Circle | null;
  dps: number;
  /** Segundos hasta el siguiente cambio de fase. */
  nextIn: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpCircle = (a: Circle, b: Circle, t: number): Circle => ({
  cx: lerp(a.cx, b.cx, t),
  cy: lerp(a.cy, b.cy, t),
  r: lerp(a.r, b.r, t),
});
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Circulo que cubre todo el mapa: el punto de partida de la ola. */
export function fullMapCircle(widthPx: number, heightPx: number): Circle {
  return { cx: widthPx / 2, cy: heightPx / 2, r: Math.hypot(widthPx, heightPx) / 2 + 8 };
}

export function zoneAt(plan: ZonePlan, widthPx: number, heightPx: number, t: number): ZoneState {
  const T = ZONE_TIMELINE;
  const full = fullMapCircle(widthPx, heightPx);
  const [z1, z2, z3] = plan;
  const zero: Circle = { cx: z3.cx, cy: z3.cy, r: 0 };
  const closed1 = T.start1 + T.shrink1;
  const closed2 = T.start2 + T.shrink2;

  // Calma: todavia no hay ola.
  if (t < T.start1) {
    return { circle: full, phase: 0, shrinking: false, next: z1, dps: 0, nextIn: T.start1 - t };
  }
  // La ola cierra hasta la zona 1.
  if (t < closed1) {
    return {
      circle: lerpCircle(full, z1, clamp01((t - T.start1) / T.shrink1)),
      phase: 1,
      shrinking: true,
      next: z1,
      dps: ZONE_DPS[1],
      nextIn: T.start2 - t,
    };
  }
  // Zona 1 quieta hasta la segunda ola.
  if (t < T.start2) {
    return {
      circle: z1,
      phase: 1,
      shrinking: false,
      next: z2,
      dps: ZONE_DPS[1],
      nextIn: T.start2 - t,
    };
  }
  // La ola cierra hasta la zona 2.
  if (t < closed2) {
    return {
      circle: lerpCircle(z1, z2, clamp01((t - T.start2) / T.shrink2)),
      phase: 2,
      shrinking: true,
      next: z2,
      dps: ZONE_DPS[2],
      nextIn: T.start3 - t,
    };
  }
  // Ultima ola: cuenta de 10 segundos con la zona 2 quieta y el refugio final a la vista.
  if (t < T.start3) {
    return {
      circle: z2,
      phase: 3,
      shrinking: false,
      next: z3,
      dps: ZONE_DPS[3],
      nextIn: T.start3 - t,
    };
  }
  // Colapso: se cierra hasta inundar todo.
  const k = clamp01((t - T.start3) / T.collapse);
  return {
    circle: lerpCircle(z2, zero, k),
    phase: 4,
    shrinking: true,
    next: null,
    dps: ZONE_DPS[4],
    nextIn: Math.max(0, T.end - t),
  };
}

export function insideCircle(c: Circle, x: number, y: number): boolean {
  return Math.hypot(x - c.cx, y - c.cy) <= c.r;
}
