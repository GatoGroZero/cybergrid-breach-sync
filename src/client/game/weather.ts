import type { ZoneView } from '../../shared/br/types';
import type { Ctx } from '../pixel/draw';

interface Drop {
  x: number;
  y: number;
  vy: number;
  vx: number;
  len: number;
}

interface Splash {
  x: number;
  y: number;
  life: number;
}

/**
 * Lluvia sobre el tejado: gotas que caen en diagonal (mas largas y claras fuera del circulo seguro),
 * salpicaduras en el piso y relampagos con su trueno.
 */
export class RainFx {
  private readonly drops: Drop[] = [];
  private readonly splashes: Splash[] = [];
  private flash = 0;
  private nextFlashAt = 0;
  private bolt: { x: number; y: number }[] | null = null;
  private boltLife = 0;
  /** Se llama con (retraso, volumen) cuando cae un relampago: suena el trueno. */
  onThunder: (delay: number, loud: number) => void = () => undefined;

  reset(): void {
    this.drops.length = 0;
    this.splashes.length = 0;
    this.flash = 0;
    this.nextFlashAt = 0;
    this.bolt = null;
  }

  update(dt: number, now: number, w: number, h: number): void {
    const want = Math.min(260, Math.round((w * h) / 520));
    while (this.drops.length < want) {
      this.drops.push({
        x: Math.random() * (w + 60),
        y: Math.random() * h,
        vy: 170 + Math.random() * 90,
        vx: -(36 + Math.random() * 18),
        len: 3 + Math.floor(Math.random() * 3),
      });
    }
    for (const d of this.drops) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > h || d.x < -10) {
        // al llegar al piso hace una salpicadura
        if (d.y > h && Math.random() < 0.35 && this.splashes.length < 90)
          this.splashes.push({ x: d.x, y: Math.random() * h, life: 0.28 });
        d.x = Math.random() * (w + 60);
        d.y = -6 - Math.random() * 20;
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      (this.splashes[i] as Splash).life -= dt;
      if ((this.splashes[i] as Splash).life <= 0) this.splashes.splice(i, 1);
    }
    // relampagos cada tanto
    if (now > this.nextFlashAt) {
      if (this.nextFlashAt > 0) this.strike(w, h);
      this.nextFlashAt = now + 9000 + Math.random() * 15000;
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.boltLife = Math.max(0, this.boltLife - dt);
  }

  private strike(w: number, h: number): void {
    this.flash = 1;
    this.boltLife = 0.22;
    const pts: { x: number; y: number }[] = [];
    let x = 20 + Math.random() * (w - 40);
    let y = 0;
    while (y < h * (0.45 + Math.random() * 0.4)) {
      pts.push({ x, y });
      x += (Math.random() - 0.5) * 22;
      y += 8 + Math.random() * 10;
    }
    this.bolt = pts;
    this.onThunder(0.25 + Math.random() * 1.1, 0.7 + Math.random() * 0.5);
  }

  /** Dibuja la lluvia; `zone` y la camara dicen que gotas caen en la zona de tormenta. */
  draw(b: Ctx, w: number, h: number, zone: ZoneView | null, camX: number, camY: number): void {
    const outside = (x: number, y: number): boolean => {
      if (!zone || zone.dps <= 0) return false;
      return Math.hypot(x + camX - zone.cx, y + camY - zone.cy) > zone.r;
    };
    for (const d of this.drops) {
      const heavy = outside(d.x, d.y);
      b.fillStyle = heavy ? 'rgba(200,222,255,0.8)' : 'rgba(190,215,255,0.42)';
      const len = heavy ? d.len + 2 : d.len;
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      // la gota es una raya inclinada de unos pocos pixeles
      for (let k = 0; k < len; k++) b.fillRect(x + Math.round(k * 0.5), y - k, 1, 1);
    }
    for (const s of this.splashes) {
      const a = s.life / 0.28;
      b.fillStyle = `rgba(210,230,255,${(a * 0.7).toFixed(2)})`;
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      const r = a > 0.5 ? 1 : 2;
      b.fillRect(x - r, y, 1, 1);
      b.fillRect(x + r, y, 1, 1);
      b.fillRect(x, y - 1, 1, 1);
    }
    if (this.boltLife > 0 && this.bolt) {
      b.fillStyle = `rgba(235,244,255,${Math.min(1, this.boltLife * 6).toFixed(2)})`;
      for (let i = 1; i < this.bolt.length; i++) {
        const p = this.bolt[i - 1] as { x: number; y: number };
        const q = this.bolt[i] as { x: number; y: number };
        const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y));
        for (let k = 0; k <= steps; k++) {
          const t = steps === 0 ? 0 : k / steps;
          b.fillRect(Math.round(p.x + (q.x - p.x) * t), Math.round(p.y + (q.y - p.y) * t), 1, 2);
        }
      }
    }
    if (this.flash > 0.02) {
      b.fillStyle = `rgba(214,230,255,${(this.flash * 0.38).toFixed(3)})`;
      b.fillRect(0, 0, w, h);
    }
  }
}
