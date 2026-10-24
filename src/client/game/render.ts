import { FLAG, TILE } from '../../shared/br/constants';
import { ITEM_KINDS, RARITY_COLORS, WEAPON_KINDS } from '../../shared/br/items';
import { G, isWaterAtPx, type BRMap, type House, type PropKind } from '../../shared/br/map';
import { defaultSkin } from '../../shared/br/skin';
import type { BREvent, ZoneView } from '../../shared/br/types';
import type { Sfx } from '../audio';
import { C, ell, flipH, hash, make, px, rect } from '../pixel/draw';
import { buildAssets, roofSprite, type Assets } from '../pixel/art';
import { catSprites } from '../pixel/cat';
import { Fx } from './fx';
import { Hud, type Label } from './hud';
import type { ClientBR, CatView } from './state';

const T = TILE;
const BG = '#1a1c2c';
const NATIVE_H = 270;

type Ctx = CanvasRenderingContext2D;

interface StaticSprite {
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  sortY: number;
  kind: PropKind;
  /** 1 opaco; baja cuando tapa al gato que se esta siguiendo, para no perderlo detras de un arbol. */
  fade: number;
}

interface RoofInfo {
  house: House;
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  /** Rectangulo (en pixeles) dentro del que el jugador cuenta como "adentro". */
  inside: { x0: number; y0: number; x1: number; y1: number };
  alpha: number;
}

interface Drawable {
  y: number;
  draw: () => void;
}

export interface Safe {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Dibuja el mundo en un buffer de baja resolucion (alto nativo ~240 px) y lo escala con numeros
 * enteros y sin suavizado, para que cada pixel del arte sea un cuadro nitido. El HUD se dibuja
 * encima, ya en pantalla, con fuentes de pixeles.
 */
export class BRRenderer {
  readonly assets: Assets = buildAssets();
  readonly fx = new Fx();
  readonly hud: Hud;

  dpr = 1;
  cssW = 960;
  cssH = 540;
  /** Escala entera de pixeles del buffer a pixeles del dispositivo. */
  scale = 3;
  viewW = 320;
  viewH = 240;
  safe: Safe = { l: 0, r: 0, t: 0, b: 0 };
  fps = 60;
  camX = 0;
  camY = 0;
  mapOpen = false;

  private readonly ctx: Ctx;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: Ctx;
  private game: ClientBR | null = null;
  private map: BRMap | null = null;
  private ground: HTMLCanvasElement | null = null;
  private statics: StaticSprite[] = [];
  private roofs: RoofInfo[] = [];
  private readonly flipped = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  private readonly wave: HTMLCanvasElement;
  private wavePattern: CanvasPattern | null = null;
  private shake = 0;
  private lastHealFx = 0;
  private lastStepFx = 0;
  private labels: Label[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly sfx: Sfx,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as Ctx;
    const [buf, bctx] = make(320, 240);
    this.buf = buf;
    this.bctx = bctx;
    this.wave = this.makeWave();
    this.hud = new Hud(this.assets);
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    this.resize();
  }

  // ------------------------------------------------------------------ tamano

  readonly resize = (): void => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.scale = Math.max(2, Math.round(ph / NATIVE_H));
    this.viewW = Math.ceil(pw / this.scale);
    this.viewH = Math.ceil(ph / this.scale);
    this.buf.width = this.viewW;
    this.buf.height = this.viewH;
    this.bctx.imageSmoothingEnabled = false;
    this.wavePattern = null;
    this.safe = this.measureSafeArea();
    if (this.game) this.game.input.screen = { w: cssW, h: cssH };
  };

  private measureSafeArea(): Safe {
    const probe = document.getElementById('safe-probe');
    if (!probe) return { l: 0, r: 0, t: 0, b: 0 };
    const cs = window.getComputedStyle(probe);
    const n = (v: string): number => Math.max(0, Number.parseFloat(v) || 0);
    return {
      l: n(cs.paddingLeft),
      r: n(cs.paddingRight),
      t: n(cs.paddingTop),
      b: n(cs.paddingBottom),
    };
  }

  // ------------------------------------------------------------------ partida

  setGame(game: ClientBR | null): void {
    this.game = game;
    this.fx.particles.length = 0;
    this.fx.floaters.length = 0;
    this.shake = 0;
    this.mapOpen = false;
    if (!game) {
      this.map = null;
      this.ground = null;
      this.statics = [];
      this.roofs = [];
      return;
    }
    game.input.screen = { w: this.cssW, h: this.cssH };
    game.onEvent = (ev) => this.onEvent(ev);
    this.setMap(game.map);
  }

  private setMap(map: BRMap): void {
    this.map = map;
    this.ground = this.bakeGround(map);
    this.hud.setMap(map);
    this.statics = [];
    for (const p of map.props) {
      if (p.kind === 'rug') continue;
      const variant = Math.floor(hash(p.x, p.y, 5) * 4);
      const sprite = this.assets.prop(p.kind, p.w, p.h, variant);
      if (!sprite) continue;
      this.statics.push({
        sprite,
        x: Math.round(p.x * T + (p.w * T - sprite.width) / 2),
        y: (p.y + p.h) * T - sprite.height + 2,
        sortY: (p.y + p.h) * T,
        kind: p.kind,
        fade: 1,
      });
    }
    this.roofs = map.houses.map((house) => {
      if (house.kind === 'bed') {
        return {
          house,
          sprite: roofSprite('bed', house.w, house.h, house.style),
          x: house.x * T - 3,
          y: house.y * T - 6,
          inside: {
            x0: house.x * T + 2,
            y0: house.y * T + 2,
            x1: (house.x + house.w) * T - 2,
            y1: (house.y + house.h) * T - 2,
          },
          alpha: 1,
        };
      }
      return {
        house,
        sprite: roofSprite(house.kind, house.w - 2, house.h - 2, house.style),
        x: (house.x + 1) * T - 4,
        y: (house.y + 1) * T - 6,
        inside: {
          x0: house.x * T + 3,
          y0: house.y * T + 3,
          x1: (house.x + house.w) * T - 3,
          y1: (house.y + house.h) * T - 3,
        },
        alpha: 1,
      };
    });
  }

  /** Terreno completo en un lienzo: se copia la parte visible en cada cuadro. */
  private bakeGround(map: BRMap): HTMLCanvasElement {
    const [cv, c] = make(map.w * T, map.h * T);
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const id = map.ground[ty * map.w + tx] as number;
        const tile = id === G.WATER ? this.assets.water[0] : this.assets.ground(id, tx, ty);
        if (tile) c.drawImage(tile, tx * T, ty * T);
      }
    }
    // Orilla: una linea clara del lado de la tierra junto al agua.
    c.fillStyle = 'rgba(244,244,244,0.5)';
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (map.ground[ty * map.w + tx] !== G.WATER) continue;
        const at = (x: number, y: number): number =>
          x < 0 || y < 0 || x >= map.w || y >= map.h
            ? G.WATER
            : (map.ground[y * map.w + x] as number);
        if (at(tx - 1, ty) !== G.WATER) c.fillRect(tx * T, ty * T, 1, T);
        if (at(tx + 1, ty) !== G.WATER) c.fillRect(tx * T + T - 1, ty * T, 1, T);
        if (at(tx, ty - 1) !== G.WATER) c.fillRect(tx * T, ty * T, T, 1);
        if (at(tx, ty + 1) !== G.WATER) c.fillRect(tx * T, ty * T + T - 1, T, 1);
      }
    }
    // Alfombras: son parte del suelo.
    const cols = [
      ['#b13e53', '#f4a6c0'],
      ['#3b5dc9', '#73eff7'],
      ['#257179', '#a7f070'],
      ['#5d275d', '#ffcd75'],
    ] as const;
    for (const p of map.props) {
      if (p.kind !== 'rug') continue;
      const [base, trim] = cols[Math.floor(hash(p.x, p.y, 9) * cols.length)] as readonly [
        string,
        string,
      ];
      rect(c, p.x * T + 1, p.y * T + 1, p.w * T - 2, p.h * T - 2, trim);
      rect(c, p.x * T + 3, p.y * T + 3, p.w * T - 6, p.h * T - 6, base);
      for (let x = p.x * T + 6; x < (p.x + p.w) * T - 6; x += 6)
        rect(c, x, p.y * T + 6, 2, p.h * T - 12, trim);
    }
    return cv;
  }

  private makeWave(): HTMLCanvasElement {
    const [cv, c] = make(32, 32);
    rect(c, 0, 0, 32, 32, 'rgba(37,113,121,0.62)');
    for (let row = 0; row < 4; row++) {
      for (let x = 0; x < 32; x++) {
        const y = row * 8 + 3 + Math.round(Math.sin((x / 32) * Math.PI * 2 + row) * 1.6);
        px(c, x, y, 'rgba(115,239,247,0.55)');
        px(c, x, y + 1, 'rgba(41,54,111,0.4)');
      }
    }
    for (const [x, y] of [
      [4, 6],
      [19, 14],
      [11, 25],
      [27, 29],
    ] as const) {
      px(c, x, y, 'rgba(244,244,244,0.8)');
    }
    return cv;
  }

  // ------------------------------------------------------------------ eventos

  private distToMe(x: number, y: number): number {
    const g = this.game;
    return g ? Math.hypot(x - g.x, y - g.y) : 9999;
  }

  private onEvent(ev: BREvent): void {
    const fx = this.fx;
    const g = this.game;
    switch (ev.e) {
      case 'shot': {
        const d = this.distToMe(ev.x, ev.y);
        const a = (ev.a * Math.PI) / 180;
        const mx = ev.x + Math.cos(a) * 11;
        const my = ev.y + Math.sin(a) * 6 - 1;
        fx.burst(mx, my, 4, {
          colors: [C.yellow, C.white, C.orange],
          speed: 70,
          life: 0.14,
          angle: a,
          spread: 0.7,
        });
        fx.add({
          x: mx,
          y: my,
          vx: 0,
          vy: 0,
          life: 0.07,
          max: 0.07,
          color: C.white,
          size: 3,
          grav: 0,
          kind: 0,
          r: 0,
        });
        const kind = ITEM_KINDS[ev.w];
        if (kind === 'bazooka')
          fx.burst(ev.x - Math.cos(a) * 8, ev.y, 6, {
            colors: ['#c8c8c8', C.lgray],
            speed: 40,
            life: 0.5,
            angle: a + Math.PI,
            spread: 0.9,
          });
        if (d < 300) {
          this.sfx.shot();
          if (kind === 'bazooka' || kind === 'sniper')
            this.shake = Math.max(this.shake, d < 60 ? 2 : 0);
        }
        break;
      }
      case 'hit': {
        fx.burst(ev.x, ev.y - 2, ev.kill ? 12 : 6, {
          colors: [C.red, C.orange, C.white],
          speed: 60,
          life: 0.4,
          grav: 90,
        });
        fx.float(ev.x, ev.y - 12, String(ev.v), ev.kill ? C.yellow : C.white);
        const d = this.distToMe(ev.x, ev.y);
        if (d < 12 && g?.alive) this.sfx.hurt();
        else if (d < 240) this.sfx.hit();
        break;
      }
      case 'boom': {
        fx.ring(ev.x, ev.y, ev.r * 1.15, C.yellow, 0.35);
        fx.ring(ev.x, ev.y, ev.r * 0.8, C.orange, 0.28);
        fx.burst(ev.x, ev.y, 26, {
          colors: [C.yellow, C.orange, C.red, C.white],
          speed: 120,
          life: 0.55,
          size: 2,
          grav: 30,
        });
        fx.burst(ev.x, ev.y, 14, {
          colors: ['#566c86', '#333c57', C.lgray],
          speed: 50,
          life: 0.9,
          size: 2,
          grav: -18,
        });
        const d = this.distToMe(ev.x, ev.y);
        if (d < 260) {
          this.sfx.kill();
          this.shake = Math.max(this.shake, Math.max(1, 4 - d / 80));
        }
        break;
      }
      case 'wallhit':
        fx.burst(ev.x, ev.y, 5, {
          colors: ['#b9835a', '#7a4e2c', '#d9a574'],
          speed: 50,
          life: 0.4,
          grav: 100,
        });
        break;
      case 'wallbreak':
        fx.burst(ev.x, ev.y, 18, {
          colors: ['#b9835a', '#7a4e2c', '#d9a574', '#e4e0d0'],
          speed: 80,
          life: 0.7,
          size: 2,
          grav: 120,
        });
        if (this.distToMe(ev.x, ev.y) < 240) this.sfx.kill();
        break;
      case 'death': {
        fx.burst(ev.x, ev.y - 2, 16, {
          colors: [C.white, C.lgray, C.cyan],
          speed: 70,
          life: 0.8,
          grav: -30,
          size: 2,
        });
        fx.ring(ev.x, ev.y, 14, C.white, 0.5);
        for (let i = 0; i < 4; i++)
          fx.star(
            ev.x + (Math.random() - 0.5) * 16,
            ev.y - 4 - Math.random() * 8,
            C.yellow,
            0.7,
            -16,
          );
        const d = this.distToMe(ev.x, ev.y);
        if (ev.id === g?.you) this.sfx.death();
        else if (d < 260) this.sfx.kill();
        break;
      }
      case 'open': {
        const cols = ev.golden ? [C.yellow, C.white, C.orange] : [C.yellow, C.white];
        for (let i = 0; i < (ev.golden ? 9 : 5); i++)
          fx.star(
            ev.x + (Math.random() - 0.5) * 12,
            ev.y - 6 - Math.random() * 6,
            cols[i % cols.length] as string,
            0.7,
            -22,
          );
        if (this.distToMe(ev.x, ev.y) < 80) this.sfx.pickup();
        break;
      }
      case 'splash': {
        fx.ring(ev.x, ev.y + 3, 9, C.cyan, 0.4);
        fx.burst(ev.x, ev.y, 7, {
          colors: [C.cyan, C.white, C.sky],
          speed: 55,
          life: 0.45,
          grav: 120,
          angle: -Math.PI / 2,
          spread: 1.4,
        });
        break;
      }
      case 'heal':
        if (g && Math.hypot(ev.x - g.x, ev.y - g.y) < 10) {
          const now = performance.now();
          if (now - this.lastHealFx > 450) {
            this.lastHealFx = now;
            this.sfx.use();
          }
        }
        break;
      case 'zone':
        this.sfx.go();
        break;
      case 'claw': {
        const a = (ev.a * Math.PI) / 180;
        for (let i = -2; i <= 2; i++) {
          const aa = a + i * 0.32;
          fx.add({
            x: ev.x + Math.cos(aa) * 14,
            y: ev.y + Math.sin(aa) * 10 - 1,
            vx: Math.cos(aa) * 16,
            vy: Math.sin(aa) * 12,
            life: 0.18,
            max: 0.18,
            color: C.white,
            size: 2,
            grav: 0,
            kind: 0,
            r: 0,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ cuadro

  /** Un cuadro completo: mundo en el buffer, escalado y luego el HUD en pantalla. */
  draw(now: number, dt: number): void {
    const ctx = this.ctx;
    this.fps += (Math.min(120, 1 / Math.max(dt, 1e-3)) - this.fps) * Math.min(1, dt * 2);
    const g = this.game;
    const map = this.map;
    if (!g || !map || !this.ground) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    g.processEvents();
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 10);

    const { cats, shots } = g.sampleWorld();
    const target = g.cameraTarget(cats);
    const mapW = map.w * T;
    const mapH = map.h * T;
    let camX = Math.round(target.x - this.viewW / 2);
    let camY = Math.round(target.y - this.viewH / 2);
    camX =
      mapW <= this.viewW
        ? -Math.floor((this.viewW - mapW) / 2)
        : Math.min(mapW - this.viewW, Math.max(0, camX));
    camY =
      mapH <= this.viewH
        ? -Math.floor((this.viewH - mapH) / 2)
        : Math.min(mapH - this.viewH, Math.max(0, camY));
    if (this.shake > 0.3) {
      camX += Math.round((Math.random() - 0.5) * this.shake * 2);
      camY += Math.round((Math.random() - 0.5) * this.shake * 2);
    }
    this.camX = camX;
    this.camY = camY;

    const b = this.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.imageSmoothingEnabled = false;
    b.globalAlpha = 1;
    b.fillStyle = BG;
    b.fillRect(0, 0, this.viewW, this.viewH);
    this.drawGround(b, map, camX, camY, now);

    this.labels.length = 0;
    const list: Drawable[] = [];
    this.collectStatics(list, camX, camY, now, target, dt);
    this.collectWalls(list, g, camX, camY);
    this.collectBoxes(list, g, camX, camY, now, dt);
    this.collectCats(list, g, cats, camX, camY, now, dt);
    list.sort((p, q) => p.y - q.y);
    for (const d of list) d.draw();

    this.drawShots(b, shots, camX, camY);
    this.fx.draw(b, camX, camY);
    this.drawRoofs(b, g, cats, camX, camY, dt);
    if (g.zone) this.drawZone(b, g.zone, camX, camY, now);

    // buffer -> pantalla
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, 0, 0, this.viewW * this.scale, this.viewH * this.scale);

    // HUD en pixeles CSS
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const k = this.scale / this.dpr;
    const toScreen = (wx: number, wy: number): { x: number; y: number } => ({
      x: (wx - camX) * k,
      y: (wy - camY) * k,
    });
    g.input.playerScreen = toScreen(
      g.alive ? g.drawX : target.x,
      (g.alive ? g.drawY : target.y) - 2,
    );
    this.hud.draw({
      ctx,
      g,
      w: this.cssW,
      h: this.cssH,
      safe: this.safe,
      now,
      toScreen,
      worldK: k,
      floaters: this.fx.floaters,
      labels: this.labels,
      mapOpen: this.mapOpen,
      fps: this.fps,
      target,
    });
  }

  private drawGround(b: Ctx, map: BRMap, camX: number, camY: number, now: number): void {
    const ground = this.ground as HTMLCanvasElement;
    const sx = Math.max(0, camX);
    const sy = Math.max(0, camY);
    const ex = Math.min(ground.width, camX + this.viewW);
    const ey = Math.min(ground.height, camY + this.viewH);
    if (ex > sx && ey > sy)
      b.drawImage(ground, sx, sy, ex - sx, ey - sy, sx - camX, sy - camY, ex - sx, ey - sy);
    // agua animada
    const tx0 = Math.max(0, Math.floor(camX / T));
    const ty0 = Math.max(0, Math.floor(camY / T));
    const tx1 = Math.min(map.w - 1, Math.floor((camX + this.viewW) / T));
    const ty1 = Math.min(map.h - 1, Math.floor((camY + this.viewH) / T));
    const phase = Math.floor(now / 260);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (map.ground[ty * map.w + tx] !== G.WATER) continue;
        b.drawImage(
          this.assets.water[(phase + tx + ty * 2) & 3] as HTMLCanvasElement,
          tx * T - camX,
          ty * T - camY,
        );
      }
    }
  }

  private visible(x: number, y: number, w: number, h: number, camX: number, camY: number): boolean {
    return (
      x + w > camX - 4 && y + h > camY - 4 && x < camX + this.viewW + 4 && y < camY + this.viewH + 4
    );
  }

  private collectStatics(
    list: Drawable[],
    camX: number,
    camY: number,
    now: number,
    viewer: { x: number; y: number },
    dt: number,
  ): void {
    const b = this.bctx;
    for (const s of this.statics) {
      if (!this.visible(s.x, s.y, s.sprite.width, s.sprite.height, camX, camY)) continue;
      const covers =
        s.sortY > viewer.y + 7 &&
        s.sprite.height > 22 &&
        viewer.x + 12 > s.x &&
        viewer.x - 12 < s.x + s.sprite.width &&
        viewer.y + 7 > s.y &&
        viewer.y - 11 < s.y + s.sprite.height;
      s.fade += ((covers ? 0.4 : 1) - s.fade) * Math.min(1, dt * 12);
      const alpha = s.fade;
      const bob = s.kind === 'duck' ? Math.round(Math.sin(now / 420 + s.x) * 1) : 0;
      list.push({
        y: s.sortY,
        draw: () => {
          if (alpha < 0.98) b.globalAlpha = alpha;
          b.drawImage(s.sprite, s.x - camX, s.y - camY + bob);
          b.globalAlpha = 1;
        },
      });
    }
  }

  private collectWalls(list: Drawable[], g: ClientBR, camX: number, camY: number): void {
    const walls = g.latest?.walls;
    if (!walls) return;
    const b = this.bctx;
    for (const [, tx, ty, hp] of walls) {
      const x = tx * T - 1;
      const y = ty * T - 1;
      if (!this.visible(x, y, T + 2, T + 2, camX, camY)) continue;
      const stage = hp > 75 ? 0 : hp > 50 ? 1 : hp > 25 ? 2 : 3;
      const sprite = this.assets.wall[stage] as HTMLCanvasElement;
      list.push({ y: (ty + 1) * T, draw: () => b.drawImage(sprite, x - camX, y - camY) });
    }
  }

  private aura(b: Ctx, x: number, y: number, color: string, now: number): void {
    b.globalAlpha = 0.22 + 0.12 * Math.sin(now / 240);
    ell(b, x, y + 4, 10, 4.5, color);
    b.globalAlpha = 0.18;
    ell(b, x, y + 4, 7, 3, color);
    b.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const a = now / 520 + i * 2.1;
      const sx = Math.round(x + Math.cos(a) * 9);
      const sy = Math.round(y + 2 + Math.sin(a) * 4 - ((now / 90 + i * 5) % 9));
      b.fillStyle = color;
      b.fillRect(sx, sy, 1, 1);
    }
  }

  private collectBoxes(
    list: Drawable[],
    g: ClientBR,
    camX: number,
    camY: number,
    now: number,
    dt: number,
  ): void {
    const b = this.bctx;
    for (const [id, x, y, kind, opened, top] of g.boxes) {
      if (!this.visible(x - 12, y - 12, 24, 24, camX, camY)) continue;
      const a = this.assets;
      let sprite: HTMLCanvasElement;
      let dy = -9;
      if (kind === 0) sprite = opened ? a.chest.open : a.chest.closed;
      else if (kind === 1) sprite = opened ? a.chest.goldOpen : a.chest.goldClosed;
      else if (kind === 2) sprite = a.tomb;
      else {
        const idx = Math.floor(top / 3);
        sprite = a.icon[ITEM_KINDS[idx] ?? 'pistol'];
        dy = -8 + Math.round(Math.sin(now / 300 + id) * 1.2);
      }
      const rarity = kind === 3 && top >= 0 ? top % 3 : 0;
      const golden = kind === 1 && !opened;
      if (golden && Math.random() < dt * 2.2)
        this.fx.star(x + (Math.random() - 0.5) * 12, y - 8, C.yellow, 0.6, -10);
      list.push({
        y: kind === 3 ? y - 6 : y + 2,
        draw: () => {
          b.globalAlpha = 1;
          if (rarity > 0)
            this.aura(
              b,
              Math.round(x - camX),
              Math.round(y - camY),
              RARITY_COLORS[rarity] as string,
              now,
            );
          else if (kind === 3) {
            b.globalAlpha = 0.25;
            ell(b, Math.round(x - camX), Math.round(y - camY) + 4, 6, 2.5, C.black);
            b.globalAlpha = 1;
          }
          b.drawImage(
            sprite,
            Math.round(x - camX - sprite.width / 2),
            Math.round(y - camY + dy - (sprite.height - 16) / 2),
          );
        },
      });
    }
  }

  private flip(src: HTMLCanvasElement): HTMLCanvasElement {
    let f = this.flipped.get(src);
    if (!f) {
      f = flipH(src);
      this.flipped.set(src, f);
    }
    return f;
  }

  private collectCats(
    list: Drawable[],
    g: ClientBR,
    cats: Map<number, CatView>,
    camX: number,
    camY: number,
    now: number,
    dt: number,
  ): void {
    if (g.alive) {
      const sel = g.selectedItem;
      const held = sel ? ITEM_KINDS.indexOf(sel.kind) * 3 + sel.rarity : -1;
      let flags = 0;
      if (g.moving) flags |= FLAG.moving;
      if (g.me && g.me.healLeft > 0) flags |= FLAG.healing;
      if (g.hurtFlash > 0.55) flags |= FLAG.hurt;
      this.pushCat(
        list,
        g,
        g.you,
        g.drawX,
        g.drawY,
        g.facing,
        g.aim,
        flags,
        held,
        camX,
        camY,
        now,
        dt,
        true,
      );
    }
    for (const c of cats.values()) {
      if (c.id === g.you || (c.flags & FLAG.dead) !== 0) continue;
      if (!this.visible(c.x - 20, c.y - 20, 40, 40, camX, camY)) continue;
      const facing = Math.cos(c.ang) >= 0 ? 1 : -1;
      this.pushCat(
        list,
        g,
        c.id,
        c.x,
        c.y,
        facing,
        c.ang,
        c.flags,
        c.held,
        camX,
        camY,
        now,
        dt,
        false,
      );
    }
  }

  private pushCat(
    list: Drawable[],
    g: ClientBR,
    id: number,
    x: number,
    y: number,
    facing: 1 | -1,
    aim: number,
    flags: number,
    held: number,
    camX: number,
    camY: number,
    now: number,
    dt: number,
    isMe: boolean,
  ): void {
    const b = this.bctx;
    const info = g.cats.get(id);
    const sprites = catSprites(info?.skin ?? defaultSkin(0));
    const moving = (flags & FLAG.moving) !== 0;
    const frame = moving ? 1 + (Math.floor(now / 115 + id) & 1) : 0;
    const flash = (flags & FLAG.hurt) !== 0 && Math.floor(now / 65) % 2 === 0;
    const set =
      facing === 1
        ? flash
          ? sprites.flashRight
          : sprites.right
        : flash
          ? sprites.flashLeft
          : sprites.left;
    const sprite = set[frame] as HTMLCanvasElement;
    const wet = isWaterAtPx(g.map, x, y + 3);
    const sx = Math.round(x - camX);
    const sy = Math.round(y - camY);

    if (moving && !wet && now - this.lastStepFx > 140 && isMe) {
      this.lastStepFx = now;
      this.fx.burst(x - facing * 6, y + 6, 2, {
        colors: ['#b68a5a', '#d5a27a', '#e8d8b4'],
        speed: 14,
        life: 0.3,
        grav: -10,
      });
    }
    if ((flags & FLAG.healing) !== 0 && Math.random() < dt * 9) {
      const shield = isMe && g.me?.healKind === 'shield';
      this.fx.star(x + (Math.random() - 0.5) * 14, y - 6, shield ? C.cyan : C.lime, 0.6, -18);
    }
    if (wet && moving && Math.random() < dt * 8) this.fx.ring(x, y + 5, 6, C.cyan, 0.4);

    const weaponIdx = held >= 0 ? Math.floor(held / 3) : -1;
    const kind = weaponIdx >= 0 ? ITEM_KINDS[weaponIdx] : undefined;
    const icon =
      kind && (WEAPON_KINDS as readonly string[]).includes(kind) ? this.assets.icon[kind] : null;
    const dim = (flags & FLAG.disconnected) !== 0;

    list.push({
      y: y + 6,
      draw: () => {
        b.globalAlpha = 1;
        if (!wet) {
          b.globalAlpha = 0.3;
          ell(b, sx, sy + 6, 9, 2.8, C.black);
          b.globalAlpha = 1;
          if (isMe) {
            b.globalAlpha = 0.5;
            ell(b, sx, sy + 6, 11, 4, C.white);
            b.globalAlpha = 0.32;
            ell(b, sx, sy + 6, 9.2, 3, C.black);
            b.globalAlpha = 1;
          }
        }
        if (dim) b.globalAlpha = 0.45;
        const dx = sx - 13;
        const dy = sy - 11;
        if (wet) {
          const h = sprite.height - 7;
          b.drawImage(sprite, 0, 0, sprite.width, h, dx, dy + 3, sprite.width, h);
          b.fillStyle = 'rgba(115,239,247,0.8)';
          const w = 9 + (Math.floor(now / 200) & 1);
          b.fillRect(sx - w, sy + 3, w * 2, 1);
          b.fillStyle = 'rgba(244,244,244,0.6)';
          b.fillRect(sx - w + 2, sy + 5, w * 2 - 4, 1);
        } else {
          b.drawImage(sprite, dx, dy);
        }
        if (icon && !wet) {
          const gun = facing === 1 ? icon : this.flip(icon);
          const gx = Math.round(sx + Math.cos(aim) * 8 - gun.width / 2 + facing * 2);
          const gy = Math.round(sy + Math.sin(aim) * 4.5 - gun.height / 2 + 2);
          b.drawImage(gun, gx, gy);
        }
        b.globalAlpha = 1;
      },
    });
    if (!isMe && info) {
      this.labels.push({
        x,
        y: y - 16,
        text: info.name,
        color: info.bot ? C.lgray : C.white,
        kind: 'name',
      });
    }
    if (dim)
      this.labels.push({ x, y: y - 24, text: 'sin conexión', color: C.orange, kind: 'small' });
  }

  private drawShots(
    b: Ctx,
    shots: Map<number, { x: number; y: number; kind: number; ang: number }>,
    camX: number,
    camY: number,
  ): void {
    for (const s of shots.values()) {
      const x = s.x - camX;
      const y = s.y - camY;
      if (x < -20 || y < -20 || x > this.viewW + 20 || y > this.viewH + 20) continue;
      const cx = Math.cos(s.ang);
      const cy = Math.sin(s.ang);
      const trail = (len: number, color: string, thick = 1): void => {
        b.fillStyle = color;
        for (let i = 0; i < len; i++)
          b.fillRect(Math.round(x - cx * i), Math.round(y - cy * i), thick, thick);
      };
      switch (s.kind) {
        case 0:
          trail(5, 'rgba(255,205,117,0.55)');
          trail(2, C.white, 2);
          break;
        case 1:
          trail(3, 'rgba(239,125,87,0.5)');
          b.fillStyle = C.orange;
          b.fillRect(Math.round(x), Math.round(y), 2, 2);
          break;
        case 2:
          trail(18, 'rgba(115,239,247,0.35)');
          trail(9, C.cyan);
          trail(4, C.white, 2);
          break;
        default: {
          trail(10, 'rgba(244,244,244,0.25)', 2);
          trail(5, C.orange, 2);
          b.fillStyle = C.lgray;
          b.fillRect(Math.round(x - 1), Math.round(y - 1), 4, 3);
          b.fillStyle = C.red;
          b.fillRect(Math.round(x + cx * 2), Math.round(y + cy * 2 - 1), 2, 3);
          if (Math.random() < 0.7)
            this.fx.burst(s.x - cx * 5, s.y - cy * 5, 1, {
              colors: ['#c8c8c8', C.yellow],
              speed: 12,
              life: 0.35,
              grav: -8,
            });
        }
      }
    }
  }

  private drawRoofs(
    b: Ctx,
    g: ClientBR,
    cats: Map<number, CatView>,
    camX: number,
    camY: number,
    dt: number,
  ): void {
    const viewer = g.cameraTarget(cats);
    for (const r of this.roofs) {
      const inside =
        viewer.x >= r.inside.x0 &&
        viewer.x <= r.inside.x1 &&
        viewer.y >= r.inside.y0 &&
        viewer.y <= r.inside.y1;
      const target = inside ? (r.house.kind === 'bed' ? 0.3 : 0.06) : 1;
      r.alpha += (target - r.alpha) * Math.min(1, dt * 9);
      if (r.alpha < 0.03) continue;
      if (!this.visible(r.x, r.y, r.sprite.width, r.sprite.height, camX, camY)) continue;
      b.globalAlpha = r.alpha;
      b.drawImage(r.sprite, r.x - camX, r.y - camY);
    }
    b.globalAlpha = 1;
  }

  /** La ola: todo lo que queda fuera del circulo seguro se cubre de agua con espuma en el borde. */
  private drawZone(b: Ctx, z: ZoneView, camX: number, camY: number, now: number): void {
    if (!this.wavePattern) this.wavePattern = b.createPattern(this.wave, 'repeat');
    const pattern = this.wavePattern;
    const cx = z.cx - camX;
    const cy = z.cy - camY;
    const r = z.r;
    const w = this.viewW;
    const h = this.viewH;
    if (pattern) {
      const t = now / 1000;
      pattern.setTransform(
        new DOMMatrix().translate(Math.round(-camX + t * 9), Math.round(-camY + t * 5)),
      );
      b.fillStyle = pattern;
    } else {
      b.fillStyle = 'rgba(37,113,121,0.6)';
    }
    const half = (y: number): number => {
      const dy = y + 0.5 - cy;
      return Math.abs(dy) >= r ? -1 : Math.sqrt(r * r - dy * dy);
    };
    const foam: [number, number, number][] = [];
    let runStart = -1;
    for (let y = 0; y < h; y++) {
      const dx = half(y);
      if (dx < 0) {
        if (runStart < 0) runStart = y;
        continue;
      }
      if (runStart >= 0) {
        b.fillRect(0, runStart, w, y - runStart);
        runStart = -1;
      }
      const xl = Math.floor(cx - dx);
      const xr = Math.ceil(cx + dx);
      if (xl > 0) b.fillRect(0, y, Math.min(w, xl), 1);
      if (xr < w) b.fillRect(Math.max(0, xr), y, w - Math.max(0, xr), 1);
      const nx = half(y + 1);
      const px0 = half(y - 1);
      const slope = Math.max(nx < 0 ? dx : Math.abs(dx - nx), px0 < 0 ? dx : Math.abs(dx - px0));
      foam.push([y, xl, Math.min(7, Math.max(2, Math.ceil(slope) + 1))]);
      foam.push([y, xr, -Math.min(7, Math.max(2, Math.ceil(slope) + 1))]);
    }
    if (runStart >= 0) b.fillRect(0, runStart, w, h - runStart);

    // espuma
    const wob = Math.floor(now / 140);
    for (const [y, x, fw] of foam) {
      const off = ((y + wob) & 3) === 0 ? 1 : 0;
      b.fillStyle = (y + wob) % 5 === 0 ? 'rgba(115,239,247,0.9)' : 'rgba(244,244,244,0.88)';
      if (fw > 0) b.fillRect(x - fw + off, y, fw, 1);
      else b.fillRect(x - off, y, -fw, 1);
    }
    // contorno de la proxima zona
    if (z.nr > 0 && z.phase < 4) {
      const ncx = z.nx - camX;
      const ncy = z.ny - camY;
      const steps = Math.max(24, Math.round((Math.PI * 2 * z.nr) / 3));
      const spin = Math.floor(now / 90);
      b.fillStyle = 'rgba(244,244,244,0.85)';
      for (let i = 0; i < steps; i++) {
        if (((i + spin) & 3) > 1) continue;
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(ncx + Math.cos(a) * z.nr);
        const y = Math.round(ncy + Math.sin(a) * z.nr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        b.fillRect(x, y, 1, 1);
      }
    }
  }
}
