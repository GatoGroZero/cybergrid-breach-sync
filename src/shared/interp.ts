export interface Positioned {
  x: number;
  y: number;
  ang?: number;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpola angulos por el camino corto. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Posicion de una entidad en el instante renderT dados dos estados con marca de tiempo del
 * servidor. Dentro del intervalo interpola; pasado el ultimo estado extrapola con la velocidad
 * del tramo, pero solo hasta maxExtrapolateMs para que un corte de red no la mande lejos.
 */
export function interpolatePosition(
  a: { t: number; x: number; y: number },
  b: { t: number; x: number; y: number },
  renderT: number,
  maxExtrapolateMs = 100,
): { x: number; y: number } {
  const span = b.t - a.t;
  if (span <= 0) return { x: b.x, y: b.y };
  if (renderT <= a.t) return { x: a.x, y: a.y };
  if (renderT <= b.t) {
    const k = (renderT - a.t) / span;
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
  }
  const over = Math.min(renderT - b.t, maxExtrapolateMs);
  return { x: b.x + ((b.x - a.x) / span) * over, y: b.y + ((b.y - a.y) / span) * over };
}

interface Frame<T> {
  t: number;
  items: Map<number, T>;
}

/** Buffer de instantaneas del servidor para dibujar las entidades remotas en el pasado. */
export class SnapshotBuffer<T extends Positioned> {
  private frames: Frame<T>[] = [];

  constructor(private readonly capacity = 32) {}

  get length(): number {
    return this.frames.length;
  }

  get latestTime(): number {
    const last = this.frames[this.frames.length - 1];
    return last ? last.t : 0;
  }

  clear(): void {
    this.frames.length = 0;
  }

  push(t: number, items: Map<number, T>): void {
    const last = this.frames[this.frames.length - 1];
    if (last && t <= last.t) return;
    this.frames.push({ t, items });
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  sample(renderT: number, maxExtrapolateMs = 100): Map<number, T> {
    const out = new Map<number, T>();
    const n = this.frames.length;
    if (n === 0) return out;
    const first = this.frames[0] as Frame<T>;
    if (n === 1 || renderT <= first.t) {
      for (const [id, item] of first.items) out.set(id, item);
      return out;
    }

    let bi = n - 1;
    for (let i = 1; i < n; i++) {
      if ((this.frames[i] as Frame<T>).t >= renderT) {
        bi = i;
        break;
      }
    }
    const b = this.frames[bi] as Frame<T>;
    const a = this.frames[bi - 1] as Frame<T>;

    for (const [id, to] of b.items) {
      const from = a.items.get(id);
      if (!from) {
        out.set(id, to);
        continue;
      }
      const pos = interpolatePosition(
        { t: a.t, x: from.x, y: from.y },
        { t: b.t, x: to.x, y: to.y },
        renderT,
        maxExtrapolateMs,
      );
      const merged: T = { ...to, x: pos.x, y: pos.y };
      if (typeof from.ang === 'number' && typeof to.ang === 'number') {
        const k = b.t === a.t ? 1 : Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t)));
        merged.ang = lerpAngle(from.ang, to.ang, k);
      }
      out.set(id, merged);
    }
    return out;
  }
}
