import { createRng, type Rng } from '../../shared/rng';
import { randomSkin, type Skin } from '../../shared/br/skin';
import { CAT_H, CAT_W, catSprites } from '../pixel/cat';
import { make, type Ctx } from '../pixel/draw';

/** Ancho logico de la portada: el alto sigue la forma de la ventana para no deformar nada. */
const W = 320;
const MIN_H = 170;
const MAX_H = 760;

/** Bandas del cielo al atardecer, de arriba (noche) a la linea del horizonte (naranja). */
const SKY = [
  '#1a1c2c',
  '#262358',
  '#4a2a6b',
  '#7a3278',
  '#b13e53',
  '#df6a50',
  '#ef8b57',
  '#ffb264',
  '#ffd98a',
];
const SKY_WEIGHT = [1.5, 1.35, 1.2, 1.1, 1, 0.9, 0.8, 0.7, 0.55];

interface Star {
  x: number;
  y: number;
  phase: number;
  big: boolean;
}

interface Cloud {
  x: number;
  y: number;
  speed: number;
  sprite: HTMLCanvasElement;
}

interface Firefly {
  x: number;
  y: number;
  ax: number;
  ay: number;
  speed: number;
  phase: number;
}

interface Walker {
  x: number;
  dir: 1 | -1;
  speed: number;
  skin: Skin;
  phase: number;
}

/** Altura de una cresta de colinas en la columna x (suma de dos ondas). */
const ridge = (
  x: number,
  base: number,
  a1: number,
  f1: number,
  p1: number,
  a2: number,
  f2: number,
  p2: number,
): number => base + a1 * Math.sin(x * f1 + p1) + a2 * Math.sin(x * f2 + p2);

/**
 * El fondo animado de la pantalla de acceso: un atardecer de bosque con estrellas que titilan,
 * nubes que pasan, luciernagas, estrellas fugaces y gatos paseando por la colina.
 */
export class Portada {
  private readonly ctx: Ctx;
  private raf = 0;
  private h = 0;
  private sky: HTMLCanvasElement | null = null;
  private hills: HTMLCanvasElement | null = null;
  private ground: ((x: number) => number) | null = null;
  private stars: Star[] = [];
  private clouds: Cloud[] = [];
  private flies: Firefly[] = [];
  private walkers: Walker[] = [];
  private sun = { x: 0, y: 0 };
  private horizon = 0;
  private shoot = { at: 0, x: 0, y: 0 };
  private last = 0;
  private watcher: ResizeObserver | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as Ctx;
    this.ctx.imageSmoothingEnabled = false;
    if (typeof ResizeObserver !== 'undefined') {
      this.watcher = new ResizeObserver(() => this.fit());
      this.watcher.observe(canvas);
    }
    this.fit();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    // quien pidio menos movimiento ve una sola imagen quieta
    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      this.fit();
      this.draw(0, 0);
      return;
    }
    const tick = (t: number): void => {
      this.raf = requestAnimationFrame(tick);
      // oculta (ya entro al lobby): no se gasta nada
      if (this.canvas.getClientRects().length === 0 || document.hidden) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.draw(t, dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Ajusta el alto logico a la ventana y rehace las capas quietas. */
  private fit(): void {
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return;
    const h = Math.max(MIN_H, Math.min(MAX_H, Math.round((W * box.height) / box.width)));
    if (h === this.h) return;
    this.h = h;
    this.canvas.width = W;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.build();
  }

  private build(): void {
    const rng = createRng(20261025);
    const h = this.h;
    this.horizon = Math.round(h * 0.64);
    this.sun = { x: Math.round(W * 0.7), y: this.horizon - 6 };
    this.sky = this.bakeSky(h);
    const baked = this.bakeHills(h, rng);
    this.hills = baked.canvas;
    this.ground = baked.ground;

    this.stars = Array.from({ length: 70 }, () => ({
      x: rng.int(2, W - 3),
      y: rng.int(2, Math.round(this.horizon * 0.7)),
      phase: rng.range(0, 6.28),
      big: rng.chance(0.18),
    }));
    this.clouds = Array.from({ length: 5 }, (_, i) => ({
      x: rng.range(0, W),
      y: Math.round(this.horizon * (0.22 + 0.13 * i) + rng.range(-4, 4)),
      speed: rng.range(2.5, 7),
      sprite: this.bakeCloud(rng.int(36, 70), rng),
    }));
    this.flies = Array.from({ length: 16 }, () => ({
      x: rng.range(10, W - 10),
      y: rng.range(this.horizon + 8, h - 8),
      ax: rng.range(5, 16),
      ay: rng.range(3, 9),
      speed: rng.range(0.5, 1.3),
      phase: rng.range(0, 6.28),
    }));
    const skins = createRng(Math.floor(Math.random() * 2 ** 31));
    this.walkers = [0, 1, 2].map((i) => ({
      x: (W / 3) * i + rng.range(0, 40),
      dir: i % 2 === 0 ? 1 : -1,
      speed: rng.range(11, 19),
      skin: randomSkin(skins),
      phase: rng.range(0, 3),
    }));
    this.shoot = { at: 2500, x: 0, y: 0 };
  }

  private bakeSky(h: number): HTMLCanvasElement {
    const [cv, c] = make(W, h);
    const total = SKY_WEIGHT.reduce((a, b) => a + b, 0);
    let y = 0;
    const edges: number[] = [];
    SKY.forEach((color, i) => {
      const bandH = Math.round(((SKY_WEIGHT[i] as number) / total) * this.horizon) + 1;
      c.fillStyle = color;
      c.fillRect(0, y, W, bandH + 1);
      y += bandH;
      edges.push(y);
    });
    // trama entre bandas: un tablero de ajedrez de tres filas suaviza el escalon
    for (let i = 0; i < edges.length - 1; i++) {
      const edge = edges[i] as number;
      for (let dy = -2; dy < 2; dy++) {
        for (let x = 0; x < W; x++) {
          if (((x + dy) & 1) === 0) continue;
          c.fillStyle = dy < 0 ? (SKY[i + 1] as string) : (SKY[i] as string);
          c.fillRect(x, edge + dy, 1, 1);
        }
      }
    }
    // luna creciente arriba a la izquierda
    const mx = Math.round(W * 0.16);
    const my = Math.round(this.horizon * 0.2);
    c.fillStyle = '#f4f0d8';
    for (let yy = -7; yy <= 7; yy++) {
      const half = Math.floor(Math.sqrt(49 - yy * yy));
      c.fillRect(mx - half, my + yy, half * 2 + 1, 1);
    }
    c.fillStyle = '#262358';
    for (let yy = -7; yy <= 7; yy++) {
      const half = Math.floor(Math.sqrt(49 - yy * yy));
      c.fillRect(mx - half + 4, my + yy - 1, half * 2 + 1, 1);
    }
    // el sol: disco y aureola
    const { x: sx, y: sy } = this.sun;
    for (const [r, color] of [
      [30, 'rgba(255,217,138,0.12)'],
      [24, 'rgba(255,217,138,0.18)'],
      [19, '#ffcd75'],
      [15, '#ffe9a8'],
    ] as const) {
      c.fillStyle = color;
      for (let yy = -r; yy <= r; yy++) {
        const half = Math.floor(Math.sqrt(r * r - yy * yy));
        c.fillRect(sx - half, sy + yy, half * 2 + 1, 1);
      }
    }
    return cv;
  }

  private bakeCloud(width: number, rng: Rng): HTMLCanvasElement {
    const hgt = Math.round(width * 0.32);
    const [cv, c] = make(width, hgt + 2);
    for (let i = 0; i < 7; i++) {
      const rx = Math.round(width * rng.range(0.14, 0.26));
      const ry = Math.max(2, Math.round(hgt * rng.range(0.3, 0.5)));
      const cx = Math.round(width * (0.15 + (i / 6) * 0.7));
      const cy = hgt - ry;
      c.fillStyle = '#9c4a86';
      for (let yy = -ry; yy <= ry; yy++) {
        const half = Math.floor(rx * Math.sqrt(1 - (yy / ry) ** 2));
        c.fillRect(cx - half, cy + yy + 1, half * 2 + 1, 1);
      }
      c.fillStyle = '#e07a8c';
      c.fillRect(cx - Math.floor(rx * 0.6), cy - ry, Math.floor(rx * 1.2), 1);
    }
    return cv;
  }

  /** Las tres colinas con pinos; devuelve tambien la altura del suelo cercano para pasear gatos. */
  private bakeHills(
    h: number,
    rng: Rng,
  ): { canvas: HTMLCanvasElement; ground: (x: number) => number } {
    const [cv, c] = make(W, h);
    const layers = [
      {
        base: this.horizon - 2,
        a1: 7,
        f1: 0.021,
        p1: 0.4,
        a2: 3,
        f2: 0.057,
        p2: 1.1,
        color: '#6a3a74',
        top: '#8a4a82',
        trees: 0,
      },
      {
        base: this.horizon + h * 0.07,
        a1: 9,
        f1: 0.017,
        p1: 2.2,
        a2: 4,
        f2: 0.043,
        p2: 0.3,
        color: '#412a62',
        top: '#5a3a78',
        trees: 16,
      },
      {
        base:
          this.horizon +
          (h > 300 ? (h - this.horizon) * 0.62 : Math.min(h * 0.16, (h - this.horizon) * 0.45)),
        a1: 7,
        f1: 0.013,
        p1: 4.1,
        a2: 3,
        f2: 0.05,
        p2: 2.6,
        color: '#1d3347',
        top: '#2f5a4a',
        trees: 12,
      },
    ];
    let near: (x: number) => number = () => this.horizon;
    layers.forEach((l, li) => {
      const fn = (x: number): number => ridge(x, l.base, l.a1, l.f1, l.p1, l.a2, l.f2, l.p2);
      if (li === layers.length - 1) near = fn;
      for (let x = 0; x < W; x++) {
        const y = Math.round(fn(x));
        c.fillStyle = l.color;
        c.fillRect(x, y, 1, h - y);
        c.fillStyle = l.top;
        c.fillRect(x, y, 1, 1);
      }
      const dark = li === layers.length - 1 ? '#10222f' : '#2d1f4a';
      const light = li === layers.length - 1 ? '#1d4a3e' : '#4a3270';
      for (let i = 0; i < l.trees; i++) {
        const x = Math.round(rng.range(2, W - 3));
        const y = Math.round(fn(x)) + 1;
        const size = li === layers.length - 1 ? rng.int(2, 3) : rng.int(1, 2);
        this.pine(c, x, y, size, dark, light);
      }
    });
    // matas de pasto y flores sobre la colina cercana
    const tufts = Math.round(((h - this.horizon) * W) / 520);
    for (let i = 0; i < tufts; i++) {
      const x = rng.int(1, W - 2);
      const top = Math.round(near(x)) + 3;
      if (top >= h - 2) continue;
      const y = rng.int(top, h - 2);
      if (rng.chance(0.28)) {
        c.fillStyle = rng.pick(['#f5a3c7', '#ffe27a', '#f4f4f4', '#9cd0ff']);
        c.fillRect(x, y, 1, 1);
        c.fillStyle = '#3d7a4f';
        c.fillRect(x, y + 1, 1, 1);
      } else {
        c.fillStyle = rng.chance(0.5) ? '#3d7a4f' : '#264d3f';
        c.fillRect(x - 1, y - 1, 1, 1);
        c.fillRect(x + 1, y - 1, 1, 1);
        c.fillRect(x, y, 1, 1);
      }
    }
    return { canvas: cv, ground: near };
  }

  /** Un pino de pixeles: tres pisos de triangulo sobre un tronco. */
  private pine(c: Ctx, x: number, baseY: number, size: number, dark: string, light: string): void {
    const tiers = 3;
    const hgt = 4 * size;
    c.fillStyle = dark;
    c.fillRect(x, baseY - 2, 1, 3);
    for (let t = 0; t < tiers; t++) {
      const top = baseY - 2 - (t + 1) * hgt + t * Math.round(hgt * 0.35);
      const width = (tiers - t) * size + 1;
      for (let r = 0; r < hgt; r++) {
        const half = Math.round((width * (r + 1)) / hgt);
        c.fillStyle = r % 2 === 0 ? dark : light;
        c.fillRect(x - half, top + r, half * 2 + 1, 1);
      }
    }
  }

  private draw(t: number, dt: number): void {
    const c = this.ctx;
    if (!this.sky || !this.hills || !this.ground) return;
    c.drawImage(this.sky, 0, 0);

    // estrellas que titilan
    for (const s of this.stars) {
      const tw = Math.sin(t / 520 + s.phase);
      if (tw < -0.55) continue;
      c.fillStyle = tw > 0.55 ? '#ffffff' : '#c9c4ff';
      c.fillRect(s.x, s.y, 1, 1);
      if (s.big && tw > 0.2) {
        c.fillRect(s.x - 1, s.y, 3, 1);
        c.fillRect(s.x, s.y - 1, 1, 3);
      }
    }

    this.shootingStar(c, t);

    // el sol late despacio
    const pulse = 0.5 + 0.5 * Math.sin(t / 900);
    c.fillStyle = `rgba(255,233,168,${0.05 + pulse * 0.07})`;
    c.fillRect(this.sun.x - 40, this.sun.y - 3, 80, 6);

    // nubes
    for (const cl of this.clouds) {
      cl.x += cl.speed * dt;
      if (cl.x > W + 4) cl.x = -cl.sprite.width - 4;
      c.drawImage(cl.sprite, Math.round(cl.x), cl.y);
    }

    c.drawImage(this.hills, 0, 0);
    this.paintWalkers(c, t, dt);

    // luciernagas
    for (const f of this.flies) {
      const a = (t / 1000) * f.speed + f.phase;
      const x = Math.round(f.x + Math.cos(a) * f.ax);
      const y = Math.round(f.y + Math.sin(a * 1.3) * f.ay);
      const glow = 0.5 + 0.5 * Math.sin(t / 340 + f.phase * 3);
      c.fillStyle = `rgba(255,226,122,${0.12 + glow * 0.18})`;
      c.fillRect(x - 1, y - 1, 3, 3);
      c.fillStyle = glow > 0.35 ? '#fff3b0' : '#ffd24a';
      c.fillRect(x, y, 1, 1);
    }
  }

  private shootingStar(c: Ctx, t: number): void {
    const s = this.shoot;
    if (t < s.at) return;
    const life = (t - s.at) / 700;
    if (life === 0 || s.x === 0) {
      s.x = 30 + Math.random() * (W - 80);
      s.y = 6 + Math.random() * this.horizon * 0.3;
    }
    if (life >= 1) {
      this.shoot = { at: t + 5000 + Math.random() * 6000, x: 0, y: 0 };
      return;
    }
    const x = s.x + life * 60;
    const y = s.y + life * 26;
    for (let i = 0; i < 9; i++) {
      c.fillStyle = `rgba(255,255,255,${(1 - life) * (1 - i / 9)})`;
      c.fillRect(Math.round(x - i * 2), Math.round(y - i * 0.9), 2, 1);
    }
  }

  private paintWalkers(c: Ctx, t: number, dt: number): void {
    const ground = this.ground as (x: number) => number;
    for (const w of this.walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x > W + CAT_W) w.x = -CAT_W;
      if (w.x < -CAT_W) w.x = W + CAT_W;
      const sprites = catSprites(w.skin);
      const set = w.dir === 1 ? sprites.right : sprites.left;
      const frame = set[1 + (Math.floor((t / 1000 + w.phase) / 0.22) % 2)] as HTMLCanvasElement;
      const x = Math.round(w.x);
      const y = Math.round(ground(Math.max(0, Math.min(W - 1, w.x)))) + 4;
      // sombra y gato
      c.fillStyle = 'rgba(8,12,24,0.45)';
      c.fillRect(x - Math.round(CAT_W * 0.35), y - 1, Math.round(CAT_W * 0.7), 2);
      c.drawImage(frame, x - Math.round(CAT_W / 2), y - CAT_H + 2);
    }
  }
}
