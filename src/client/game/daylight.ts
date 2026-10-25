import { daylightAt, type Daylight } from '../../shared/br/daytime';
import { TILE } from '../../shared/br/constants';
import type { BRMap } from '../../shared/br/map';
import { art, ell, make, type Ctx } from '../pixel/draw';

/** Una luz del mundo (coordenadas del mundo, radio en pixeles). */
export interface LightSrc {
  x: number;
  y: number;
  r: number;
  /** 0 a 1: cuanto aclara la oscuridad en su centro. */
  k: number;
  /** Color calido que se suma encima, y cuanto (se multiplica por la noche). */
  warm?: string;
  warmK?: number;
}

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  speed: number;
}

interface Bat {
  x: number;
  y: number;
  vx: number;
  phase: number;
  amp: number;
}

const BAT_UP = ['B.....B', 'BB.B.BB', 'BBBBBBB', '.B.B.B.'];
const BAT_DOWN = ['..BBB..', '.BBBBB.', 'B.BBB.B', 'B..B..B'];

/**
 * Hora del dia en pantalla: el velo de color que oscurece el mapa (con huecos de luz alrededor de
 * los gatos, las casas y las calabazas), luciernagas, murcielagos y rayos de luz.
 */
export class DaylightFx {
  /** Estado de la hora en este cuadro. */
  light: Daylight = daylightAt(0);

  private readonly lc: HTMLCanvasElement;
  private readonly lx: Ctx;
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  private readonly glows = new Map<string, HTMLCanvasElement>();
  private readonly flies: Firefly[] = [];
  private readonly bats: Bat[] = [];
  private batAt = 0;
  private readonly batFrames: HTMLCanvasElement[];

  constructor() {
    const [lc, lx] = make(320, 240);
    this.lc = lc;
    this.lx = lx;
    const pal = { B: '#1a1c2c' };
    this.batFrames = [art(BAT_UP, pal), art(BAT_DOWN, pal)];
  }

  resize(w: number, h: number): void {
    if (this.lc.width !== w || this.lc.height !== h) {
      this.lc.width = w;
      this.lc.height = h;
    }
  }

  /** Calcula la hora de este cuadro. */
  setPhase(p: number): Daylight {
    this.light = daylightAt(p);
    return this.light;
  }

  // ------------------------------------------------------------------ sprites en cache

  /** Hueco de luz con bandas (estilo pixel): se cachea por radio. */
  private lightSprite(r: number): HTMLCanvasElement {
    const rr = Math.max(6, Math.round(r / 2) * 2);
    let cv = this.sprites.get(rr);
    if (!cv) {
      const [canvas, c] = make(rr * 2 + 2, Math.ceil(rr * 1.7) + 2);
      for (let i = 0; i < 11; i++) {
        c.globalAlpha = 0.16;
        const k = 1 - i * 0.085;
        ell(c, rr + 1, canvas.height / 2, rr * k, rr * k * 0.85, '#ffffff');
      }
      cv = canvas;
      this.sprites.set(rr, cv);
    }
    return cv;
  }

  private glowSprite(color: string, r: number): HTMLCanvasElement {
    const rr = Math.max(3, Math.round(r));
    const key = `${color}|${rr}`;
    let cv = this.glows.get(key);
    if (!cv) {
      const [canvas, c] = make(rr * 2 + 2, Math.ceil(rr * 1.7) + 2);
      for (let i = 3; i >= 1; i--) {
        c.globalAlpha = 0.4;
        ell(c, rr + 1, canvas.height / 2, (rr * i) / 3, (rr * i * 0.85) / 3, color);
      }
      cv = canvas;
      this.glows.set(key, cv);
    }
    return cv;
  }

  // ------------------------------------------------------------------ animacion

  /** Luciernagas y murcielagos: nacen, se mueven y mueren segun la hora. */
  update(
    dt: number,
    now: number,
    kind: string,
    cam: { x: number; y: number; w: number; h: number },
  ): void {
    const l = this.light;
    // luciernagas: aparecen de noche en el bosque y la piscina; en la casa son motas de luz
    const want = Math.round(l.night * (kind === 'casa' ? 10 : 24));
    while (this.flies.length < want) {
      this.flies.push({
        x: cam.x + Math.random() * cam.w,
        y: cam.y + Math.random() * cam.h,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        phase: Math.random() * 6.28,
        speed: 0.6 + Math.random() * 1.2,
      });
    }
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i] as Firefly;
      f.phase += dt * f.speed;
      f.vx += (Math.random() - 0.5) * 30 * dt;
      f.vy += (Math.random() - 0.5) * 30 * dt;
      f.vx = Math.max(-9, Math.min(9, f.vx));
      f.vy = Math.max(-9, Math.min(9, f.vy));
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      const out =
        f.x < cam.x - 30 ||
        f.x > cam.x + cam.w + 30 ||
        f.y < cam.y - 30 ||
        f.y > cam.y + cam.h + 30;
      if (out || this.flies.length > want) this.flies.splice(i, 1);
    }

    // murcielagos: cruzan la pantalla al atardecer y de noche
    const batLevel = Math.max(l.dusk, l.night * 0.7);
    if (batLevel > 0.15) {
      if (now > this.batAt) {
        this.batAt = now + (6 + Math.random() * 9) * 1000 * (1.3 - batLevel);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const n = Math.random() < 0.35 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          this.bats.push({
            x: dir === 1 ? cam.x - 12 - k * 16 : cam.x + cam.w + 12 + k * 16,
            y: cam.y + 12 + Math.random() * cam.h * 0.55,
            vx: dir * (34 + Math.random() * 22),
            phase: Math.random() * 6.28,
            amp: 3 + Math.random() * 4,
          });
        }
      }
    }
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i] as Bat;
      b.x += b.vx * dt;
      b.phase += dt * 11;
      if (b.x < cam.x - 60 || b.x > cam.x + cam.w + 60) this.bats.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ dibujo

  /** Luciernagas y murcielagos (van antes del velo, asi la noche tambien los cubre). */
  drawCreatures(b: Ctx, camX: number, camY: number, now: number): void {
    const l = this.light;
    if (this.flies.length > 0) {
      const prev = b.globalCompositeOperation;
      for (const f of this.flies) {
        const pulse = 0.5 + 0.5 * Math.sin(f.phase * 3.1);
        const a = l.night * (0.25 + 0.75 * pulse);
        if (a < 0.05) continue;
        const sx = Math.round(f.x - camX);
        const sy = Math.round(f.y - camY);
        b.globalCompositeOperation = 'lighter';
        b.globalAlpha = Math.min(1, a * 0.7);
        const g = this.glowSprite('#d8ff6a', 5);
        b.drawImage(g, sx - Math.round(g.width / 2), sy - Math.round(g.height / 2));
        b.globalCompositeOperation = prev;
        b.globalAlpha = Math.min(1, a * 1.4);
        b.fillStyle = '#f4ffb0';
        b.fillRect(sx, sy, 1, 1);
      }
      b.globalAlpha = 1;
      b.globalCompositeOperation = prev;
    }
    for (const bat of this.bats) {
      const frame = this.batFrames[Math.sin(bat.phase) > 0 ? 0 : 1] as HTMLCanvasElement;
      const sx = Math.round(bat.x - camX);
      const sy = Math.round(bat.y + Math.sin(bat.phase * 0.35) * bat.amp - camY);
      // sombra en el suelo
      b.globalAlpha = 0.18;
      b.fillStyle = '#000';
      b.fillRect(sx + 1, sy + 14, 6, 1);
      b.globalAlpha = 1;
      b.save();
      if (bat.vx < 0) {
        b.translate(sx + frame.width, sy);
        b.scale(-1, 1);
        b.drawImage(frame, 0, 0);
      } else {
        b.drawImage(frame, sx, sy);
      }
      b.restore();
    }
    void now;
  }

  /**
   * Velo de la hora con huecos de luz: de dia no hace nada; de noche oscurece el mapa y las luces
   * (gatos, casas, calabazas, disparos) lo agujerean. Despues suma el brillo calido de cada luz.
   */
  drawVeil(
    b: Ctx,
    kind: string,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    lights: LightSrc[],
  ): void {
    const l = this.light;
    const a = l.alpha * (kind === 'casa' ? 0.85 : 1);
    if (a < 0.012) return;
    this.resize(viewW, viewH);
    const lx = this.lx;
    lx.globalCompositeOperation = 'source-over';
    lx.globalAlpha = 1;
    lx.clearRect(0, 0, viewW, viewH);
    lx.fillStyle = `rgba(${l.tint[0]},${l.tint[1]},${l.tint[2]},${a.toFixed(3)})`;
    lx.fillRect(0, 0, viewW, viewH);
    // Los huecos de luz solo hacen falta cuando oscurece de verdad.
    const dark = Math.min(1, a / 0.2);
    lx.globalCompositeOperation = 'destination-out';
    for (const s of lights) {
      const sx = s.x - camX;
      const sy = s.y - camY;
      if (sx < -s.r || sy < -s.r || sx > viewW + s.r || sy > viewH + s.r) continue;
      const sprite = this.lightSprite(s.r);
      lx.globalAlpha = Math.min(1, s.k * dark);
      lx.drawImage(sprite, Math.round(sx - sprite.width / 2), Math.round(sy - sprite.height / 2));
    }
    lx.globalAlpha = 1;
    lx.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.drawImage(this.lc, 0, 0);

    // brillo calido encima (solo si ya es de noche)
    if (l.night > 0.08) {
      const prev = b.globalCompositeOperation;
      b.globalCompositeOperation = 'lighter';
      for (const s of lights) {
        if (!s.warm) continue;
        const sx = s.x - camX;
        const sy = s.y - camY;
        if (sx < -s.r || sy < -s.r || sx > viewW + s.r || sy > viewH + s.r) continue;
        const g = this.glowSprite(s.warm, s.r * 0.8);
        b.globalAlpha = Math.min(1, (s.warmK ?? 0.3) * l.night);
        b.drawImage(g, Math.round(sx - g.width / 2), Math.round(sy - g.height / 2));
      }
      b.globalCompositeOperation = prev;
      b.globalAlpha = 1;
    }
  }
}

/** Luces fijas de un mapa: las casas encendidas y las calabazas. */
export function staticLights(map: BRMap): LightSrc[] {
  const out: LightSrc[] = [];
  for (const h of map.houses) {
    if (h.kind === 'bed') continue;
    const cx = (h.x + h.w / 2) * TILE;
    const cy = (h.y + h.h / 2) * TILE;
    out.push({
      x: cx,
      y: cy,
      r: Math.max(h.w, h.h) * TILE * 0.62,
      k: 0.75,
      warm: '#ffc070',
      warmK: 0.2,
    });
    for (const d of h.doors) {
      out.push({
        x: d.x * TILE + TILE / 2,
        y: d.y * TILE + TILE / 2,
        r: 22,
        k: 0.5,
        warm: '#ffb054',
        warmK: 0.28,
      });
    }
  }
  for (const p of map.props) {
    if (p.kind !== 'pumpkin') continue;
    out.push({
      x: p.x * TILE + TILE / 2,
      y: p.y * TILE + TILE / 2 - 2,
      r: 24,
      k: 0.8,
      warm: '#ff9a3c',
      warmK: 0.5,
    });
  }
  return out;
}
