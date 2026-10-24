import type { Rng } from '../rng';

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Linea de tiempo de la ola (en segundos desde el inicio): sin ola los primeros 4 minutos,
 * la zona 1 llega a los 4, la zona 2 a los 8, la zona 3 a los 12 y desde los 13:30 se cierra
 * hasta no dejar zona libre. A los 15 minutos la partida termina.
 */
export const ZONE_TIMELINE = {
  start1: 240,
  shrink1: 90,
  start2: 480,
  shrink2: 75,
  start3: 720,
  shrink3: 70,
  collapseAt: 810,
  collapse: 90,
  end: 900,
} as const;

/** Daño por segundo fuera de la zona segun la fase (1, 2, 3 y colapso). */
export const ZONE_DPS = [0, 3, 5, 8, 12] as const;

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
  /** 0 sin ola, 1 a 3 zona objetivo actual, 4 colapso final. */
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

  if (t < T.start1) {
    return { circle: full, phase: 0, shrinking: false, next: z1, dps: 0, nextIn: T.start1 - t };
  }
  if (t < T.start1 + T.shrink1) {
    const k = (t - T.start1) / T.shrink1;
    return {
      circle: lerpCircle(full, z1, clamp01(k)),
      phase: 1,
      shrinking: true,
      next: z1,
      dps: ZONE_DPS[1],
      nextIn: T.start2 - t,
    };
  }
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
  if (t < T.start2 + T.shrink2) {
    return {
      circle: lerpCircle(z1, z2, clamp01((t - T.start2) / T.shrink2)),
      phase: 2,
      shrinking: true,
      next: z2,
      dps: ZONE_DPS[2],
      nextIn: T.start3 - t,
    };
  }
  if (t < T.start3) {
    return {
      circle: z2,
      phase: 2,
      shrinking: false,
      next: z3,
      dps: ZONE_DPS[2],
      nextIn: T.start3 - t,
    };
  }
  if (t < T.start3 + T.shrink3) {
    return {
      circle: lerpCircle(z2, z3, clamp01((t - T.start3) / T.shrink3)),
      phase: 3,
      shrinking: true,
      next: z3,
      dps: ZONE_DPS[3],
      nextIn: T.collapseAt - t,
    };
  }
  if (t < T.collapseAt) {
    return {
      circle: z3,
      phase: 3,
      shrinking: false,
      next: zero,
      dps: ZONE_DPS[3],
      nextIn: T.collapseAt - t,
    };
  }
  const k = clamp01((t - T.collapseAt) / T.collapse);
  return {
    circle: lerpCircle(z3, zero, k),
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
