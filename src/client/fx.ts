const MAX_PARTICLES = 700;
const MAX_TEXTS = 40;
const MAX_RINGS = 24;

interface FloatText {
  x: number;
  y: number;
  life: number;
  text: string;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  radius: number;
  color: string;
}

/**
 * Efectos visuales. Las particulas viven en arreglos tipados reutilizados (sin crear objetos por
 * cuadro) y todo avanza con delta time, asi se ve igual a 60, 120 o 144 Hz.
 */
export class Fx {
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly color: string[] = new Array<string>(MAX_PARTICLES).fill('#fff');
  private count = 0;
  private readonly texts: FloatText[] = [];
  private readonly rings: Ring[] = [];
  shake = 0;
  hurtFlash = 0;
  readonly reducedMotion: boolean;

  constructor() {
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  clear(): void {
    this.count = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.shake = 0;
    this.hurtFlash = 0;
  }

  burst(x: number, y: number, color: string, n: number, speed: number, life = 0.5): void {
    for (let i = 0; i < n && this.count < MAX_PARTICLES; i++) {
      const k = this.count++;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.px[k] = x;
      this.py[k] = y;
      this.vx[k] = Math.cos(a) * s;
      this.vy[k] = Math.sin(a) * s;
      const l = life * (0.6 + Math.random() * 0.6);
      this.life[k] = l;
      this.maxLife[k] = l;
      this.size[k] = 1.5 + Math.random() * 2.2;
      this.color[k] = color;
    }
  }

  ring(x: number, y: number, radius: number, color: string): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ x, y, life: 0.45, max: 0.45, radius, color });
  }

  text(x: number, y: number, text: string, color: string): void {
    if (this.texts.length >= MAX_TEXTS) this.texts.shift();
    this.texts.push({ x, y, life: 0.7, text, color });
  }

  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(14, this.shake + amount);
  }

  update(dt: number): void {
    const drag = Math.exp(-3.2 * dt);
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] = (this.life[i] as number) - dt;
      if ((this.life[i] as number) <= 0) {
        const last = --this.count;
        if (i !== last) {
          this.px[i] = this.px[last] as number;
          this.py[i] = this.py[last] as number;
          this.vx[i] = this.vx[last] as number;
          this.vy[i] = this.vy[last] as number;
          this.life[i] = this.life[last] as number;
          this.maxLife[i] = this.maxLife[last] as number;
          this.size[i] = this.size[last] as number;
          this.color[i] = this.color[last] as string;
        }
        continue;
      }
      this.vx[i] = (this.vx[i] as number) * drag;
      this.vy[i] = (this.vy[i] as number) * drag;
      this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
      this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i] as FloatText;
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring;
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - 30 * dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - 2.2 * dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (0.25 + 0.75 * k), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < this.count; i++) {
      const a = (this.life[i] as number) / (this.maxLife[i] as number);
      ctx.globalAlpha = a;
      ctx.fillStyle = this.color[i] as string;
      const s = (this.size[i] as number) * (0.4 + 0.6 * a);
      ctx.fillRect((this.px[i] as number) - s / 2, (this.py[i] as number) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 15px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2.2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
