type Ctx = CanvasRenderingContext2D;

/** 0 cuadrito, 1 anillo que se expande, 2 destello en cruz. */
export type ParticleKind = 0 | 1 | 2;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  grav: number;
  kind: ParticleKind;
  /** Para anillos: radio final. */
  r: number;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
}

export interface BurstOptions {
  colors: string[];
  speed?: number;
  life?: number;
  size?: number;
  grav?: number;
  /** Direccion central en radianes y apertura; sin ellos sale en todas direcciones. */
  angle?: number;
  spread?: number;
}

const MAX_PARTICLES = 700;

/** Particulas en pixeles del mundo: chispas, humo, escombros, destellos. Todo dibujado con cuadritos. */
export class Fx {
  readonly particles: Particle[] = [];
  readonly floaters: Floater[] = [];

  add(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  burst(x: number, y: number, n: number, o: BurstOptions): void {
    for (let i = 0; i < n; i++) {
      const a =
        o.angle === undefined
          ? Math.random() * Math.PI * 2
          : o.angle + (Math.random() - 0.5) * (o.spread ?? 0.8);
      const sp = (o.speed ?? 50) * (0.35 + Math.random() * 0.65);
      const life = (o.life ?? 0.45) * (0.6 + Math.random() * 0.6);
      this.add({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        color: o.colors[Math.floor(Math.random() * o.colors.length)] as string,
        size: o.size ?? 1,
        grav: o.grav ?? 0,
        kind: 0,
        r: 0,
      });
    }
  }

  ring(x: number, y: number, r: number, color: string, life = 0.35): void {
    this.add({ x, y, vx: 0, vy: 0, life, max: life, color, size: 1, grav: 0, kind: 1, r });
  }

  star(x: number, y: number, color: string, life = 0.5, vy = -10): void {
    this.add({ x, y, vx: 0, vy, life, max: life, color, size: 1, grav: 0, kind: 2, r: 0 });
  }

  float(x: number, y: number, text: string, color: string): void {
    this.floaters.push({ x, y, text, color, life: 0.9, max: 0.9 });
    if (this.floaters.length > 40) this.floaters.shift();
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, dt * 2.2);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i] as Floater;
      f.life -= dt;
      f.y -= dt * 18;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  draw(ctx: Ctx, camX: number, camY: number): void {
    for (const p of this.particles) {
      const k = p.life / p.max;
      const sx = Math.round(p.x - camX);
      const sy = Math.round(p.y - camY);
      ctx.globalAlpha = k < 0.35 ? k / 0.35 : 1;
      ctx.fillStyle = p.color;
      if (p.kind === 0) {
        const s = Math.max(1, Math.round(p.size * (0.5 + k * 0.5)));
        ctx.fillRect(sx - (s >> 1), sy - (s >> 1), s, s);
      } else if (p.kind === 1) {
        const r = p.r * (1 - k);
        const steps = Math.max(10, Math.round(r * 2.6));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          ctx.fillRect(
            Math.round(sx + Math.cos(a) * r),
            Math.round(sy + Math.sin(a) * r * 0.75),
            1,
            1,
          );
        }
      } else {
        ctx.fillRect(sx, sy - 1, 1, 3);
        ctx.fillRect(sx - 1, sy, 3, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}
