import { CAT, FLAG, TILE, WALL_ITEM } from '../../shared/br/constants';
import {
  CLAWS,
  ITEM_KINDS,
  RARITY_COLORS,
  WEAPONS,
  WEAPON_KINDS,
  isWeapon,
} from '../../shared/br/items';
import {
  G,
  groundAt,
  isSolidTile,
  isWaterAtPx,
  type BRMap,
  type House,
  type PropKind,
} from '../../shared/br/map';
import { segmentSolidHit } from '../../shared/br/physics';
import { defaultSkin } from '../../shared/br/skin';
import type { BREvent, ZoneView } from '../../shared/br/types';
import { spatial, surfaceFor, type Sfx } from '../audio';
import { C, ell, flipH, hash, make, px, rect } from '../pixel/draw';
import { buildAssets, roofSprite, type Assets } from '../pixel/art';
import { DAY_SPAN_BY_MODE, dayPhase, type DayName, type Daylight } from '../../shared/br/daytime';
import { TEAM_COLORS } from '../../shared/br/modes';
import { outfitInfo } from '../../shared/br/outfits';
import { CAT_PAD, catSprites } from '../pixel/cat';
import { paintWorld } from '../pixel/world';
import { AdvScene } from './advscene';
import { DaylightFx, staticLights, type LightSrc } from './daylight';
import { Fx } from './fx';
import { RainFx } from './weather';
import { Hud, type Label } from './hud';
import type { ClientBR, CatView } from './state';

/** Cuanto se mece la copa de cada cosa con el viento (en pixeles). */
const SWAY: Record<string, number> = {
  tree: 1.1,
  pine: 0.9,
  palm: 1.6,
  bush: 0.7,
  plant: 0.7,
};

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
/** Cuanto dura un emote sobre la cabeza del gato. */
const EMOTE_MS = 2800;

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
  private lastStepSfx = 0;
  /** Cuando se oyo la ultima pisada de cada gato ajeno (para no sonar todas a la vez). */
  private readonly otherSteps = new Map<number, number>();
  /** Luces que se encienden un instante: fogonazos, explosiones y cofres que se abren. */
  private readonly lights: {
    x: number;
    y: number;
    r: number;
    color: string;
    life: number;
    max: number;
  }[] = [];
  private wasTired = false;
  private lastBeat = 0;
  private labels: Label[] = [];
  private ambientAcc = 0;
  private readonly rockets: {
    x: number;
    y: number;
    vy: number;
    burstAt: number;
    palette: string[];
  }[] = [];
  private nextRocketAt = 0;
  private celebrated = false;
  private confettiUntil = 0;
  private readonly sky = new DaylightFx();
  private readonly rain = new RainFx();
  /** Aventura: enemigos, avisos y puertas del bosque (solo existe en esa partida). */
  private adv: AdvScene | null = null;
  /** Aventura: la hora del dia sigue el avance por el bosque, suavizada. */
  private advPhase = 0;
  /** Sobre un tejado: llueve y la zona es una tormenta. */
  private storm = false;
  private readonly stormWave: HTMLCanvasElement;
  private skyLights: LightSrc[] = [];
  /** Solo para pruebas y capturas: fija la hora del dia (0 a 1). */
  dayOverride: number | null = null;
  private lastDayName: DayName | null = null;
  phaseToast: { name: DayName; at: number } | null = null;

  /** Hora del dia de este cuadro. */
  get daylight(): Daylight {
    return this.sky.light;
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly sfx: Sfx,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as Ctx;
    const [buf, bctx] = make(320, 240);
    this.buf = buf;
    this.bctx = bctx;
    this.wave = this.makeWave();
    this.stormWave = this.makeStorm();
    this.rain.onThunder = (d, l) => this.sfx.thunder(d, l);
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
    this.celebrated = false;
    this.confettiUntil = 0;
    this.rockets.length = 0;
    this.nextRocketAt = 0;
    this.lastDayName = null;
    this.phaseToast = null;
    this.advPhase = 0;
    this.adv = null;
    if (!game) {
      this.map = null;
      this.ground = null;
      this.statics = [];
      this.roofs = [];
      return;
    }
    game.input.screen = { w: this.cssW, h: this.cssH };
    game.onEvent = (ev) => this.onEvent(ev);
    game.onHostile = (kind, x, y) => {
      const sp = spatial(x - game.x, y - game.y, 300);
      if (sp.v > 0.08) this.sfx.enemyShot(kind, Math.max(0.3, sp.v), sp.pan);
    };
    if (game.mode === 'aventura')
      this.adv = new AdvScene(this.fx, this.sfx, {
        light: (x, y, r, color, life) => this.addLight(x, y, r, color, life),
        icon: (kind) => (this.assets.icon as Record<string, HTMLCanvasElement | undefined>)[kind],
        shake: (n) => {
          this.shake = Math.max(this.shake, n);
        },
        say: (text, tone, ms) => this.game?.say(text, tone, ms),
      });
    this.setMap(game.map);
  }

  private setMap(map: BRMap): void {
    this.map = map;
    this.storm = map.kind === 'tejado' || map.kind === 'azotea' || map.kind === 'mansarda';
    this.rain.reset();
    this.skyLights = staticLights(map);
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
        // lo que va pegado al piso (tragaluces) siempre queda debajo de los gatos
        sortY: p.kind === 'skylight' ? p.y * T - 1 : (p.y + p.h) * T,
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
    // Tablones, azulejos, muros con volumen, alfombras y detalles del suelo.
    paintWorld(c, map);
    return cv;
  }

  /** Patron de la tormenta: nubarron oscuro con rayas de lluvia. */
  private makeStorm(): HTMLCanvasElement {
    const [cv, c] = make(32, 32);
    rect(c, 0, 0, 32, 32, 'rgba(24,32,66,0.6)');
    for (const [x, y, l] of [
      [3, 2, 9],
      [12, 10, 8],
      [21, 4, 10],
      [28, 17, 7],
      [7, 20, 9],
      [17, 24, 8],
    ] as const) {
      for (let k = 0; k < l; k++) px(c, (x + (k >> 1)) % 32, (y + k) % 32, 'rgba(170,196,255,0.5)');
    }
    for (const [x, y] of [
      [5, 14],
      [24, 28],
      [14, 3],
    ] as const)
      px(c, x, y, 'rgba(244,248,255,0.7)');
    return cv;
  }

  private makeWave(): HTMLCanvasElement {
    const [cv, c] = make(32, 32);
    rect(c, 0, 0, 32, 32, 'rgba(37,113,121,0.42)');
    for (let row = 0; row < 4; row++) {
      for (let x = 0; x < 32; x++) {
        const y = row * 8 + 3 + Math.round(Math.sin((x / 32) * Math.PI * 2 + row) * 1.6);
        px(c, x, y, 'rgba(115,239,247,0.4)');
        px(c, x, y + 1, 'rgba(41,54,111,0.22)');
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

  /** True si el punto queda bajo un tejado que ahora mismo esta cerrado (no se ve lo que hay adentro). */
  private hiddenByRoof(x: number, y: number): boolean {
    for (const r of this.roofs) {
      if (
        r.alpha > 0.5 &&
        x >= r.inside.x0 &&
        x <= r.inside.x1 &&
        y >= r.inside.y0 &&
        y <= r.inside.y1
      )
        return true;
    }
    return false;
  }

  /** Fogonazo propio de cada arma. */
  private muzzleFlash(x: number, y: number, a: number, weapon: string): void {
    const fx = this.fx;
    const flash = (size: number, life: number, color: string): void =>
      fx.add({ x, y, vx: 0, vy: 0, life, max: life, color, size, grav: 0, kind: 0, r: 0 });
    // el fogonazo tambien alumbra un instante lo que tiene alrededor
    const tint: Record<string, string> = {
      rifle: '#a7f070',
      shotgun: '#ffa94d',
      sniper: '#73eff7',
      bazooka: '#ffb347',
    };
    this.addLight(
      x,
      y,
      weapon === 'bazooka' ? 26 : weapon === 'shotgun' ? 22 : 16,
      tint[weapon] ?? '#ffcd75',
      0.09,
    );
    switch (weapon) {
      case 'rifle':
        fx.burst(x, y, 3, {
          colors: [C.lime, C.white, C.yellow],
          speed: 80,
          life: 0.1,
          angle: a,
          spread: 0.5,
        });
        flash(3, 0.05, C.white);
        break;
      case 'shotgun':
        fx.burst(x, y, 9, {
          colors: [C.orange, C.yellow, C.white],
          speed: 95,
          life: 0.18,
          angle: a,
          spread: 1.1,
        });
        flash(5, 0.08, C.yellow);
        fx.burst(x, y, 3, {
          colors: ['#c8c8c8', C.lgray],
          speed: 25,
          life: 0.5,
          angle: a,
          spread: 0.9,
          grav: -10,
        });
        break;
      case 'sniper':
        fx.burst(x, y, 4, {
          colors: [C.cyan, C.white],
          speed: 120,
          life: 0.16,
          angle: a,
          spread: 0.2,
        });
        flash(4, 0.09, C.cyan);
        fx.ring(x, y, 7, C.cyan, 0.2);
        break;
      case 'bazooka':
        fx.burst(x, y, 8, {
          colors: [C.orange, C.yellow, C.white],
          speed: 70,
          life: 0.25,
          angle: a,
          spread: 0.9,
        });
        flash(5, 0.1, C.white);
        break;
      default:
        fx.burst(x, y, 4, {
          colors: [C.yellow, C.white, C.orange],
          speed: 70,
          life: 0.14,
          angle: a,
          spread: 0.7,
        });
        flash(3, 0.07, C.white);
    }
  }

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
        const kind = ITEM_KINDS[ev.w];
        const mx = ev.x + Math.cos(a) * 11;
        const my = ev.y + Math.sin(a) * 6 - 1;
        this.muzzleFlash(mx, my, a, kind ?? 'pistol');
        // Casquillo que sale volando hacia un lado (solo de las armas de balas).
        if (kind === 'pistol' || kind === 'rifle' || kind === 'shotgun') {
          const side = a + Math.PI / 2 + (Math.random() - 0.5) * 0.6;
          fx.burst(ev.x + Math.cos(a) * 4, ev.y - 3, 1, {
            colors: kind === 'shotgun' ? [C.red, C.orange] : ['#d9a574', C.yellow],
            speed: 38,
            life: 0.45,
            grav: 160,
            angle: side,
            spread: 0.4,
            size: 1,
          });
        }
        if (d < 520 && g) {
          const s = spatial(ev.x - g.x, ev.y - g.y, 520);
          this.sfx.shot(kind ?? 'pistol', Math.max(0.12, s.v), d < 12 ? 0 : s.pan);
          if (kind === 'bazooka' || kind === 'sniper')
            this.shake = Math.max(this.shake, d < 60 ? 2 : 0);
        }
        break;
      }
      case 'reload': {
        if (!g) break;
        const s = spatial(ev.x - g.x, ev.y - g.y, 240);
        const kind = ITEM_KINDS[ev.w] ?? 'pistol';
        if (!ev.done && s.v > 0.05) this.sfx.reload(kind, Math.max(0.2, s.v), s.pan);
        else if (ev.done && this.distToMe(ev.x, ev.y) < 12) this.sfx.reloadDone();
        break;
      }
      case 'dry':
        if (this.distToMe(ev.x, ev.y) < 12) this.sfx.dry();
        else if (g) {
          const s = spatial(ev.x - g.x, ev.y - g.y, 200);
          if (s.v > 0.1) this.sfx.dry(s.v * 0.7, s.pan);
        }
        break;
      case 'hit': {
        fx.burst(ev.x, ev.y - 2, ev.kill ? 12 : 6, {
          colors: [C.red, C.orange, C.white],
          speed: 60,
          life: 0.4,
          grav: 90,
        });
        if ((ev.v >= 4 || ev.kill) && !this.hiddenByRoof(ev.x, ev.y))
          fx.float(ev.x, ev.y - 12, String(ev.v), ev.kill ? C.yellow : C.white);
        if (!g) break;
        if (ev.to === g.you && g.alive) {
          // Te pegaron.
          this.sfx.hurt();
          this.shake = Math.max(this.shake, 2);
        } else if (ev.by === g.you && ev.by !== 0) {
          // Le pegaste a alguien.
          this.sfx.hitDealt(ev.kill);
        } else {
          // Le pegaron a alguien cerca: se oye el golpe, de su lado y mas flojo.
          const s = spatial(ev.x - g.x, ev.y - g.y, 280);
          if (s.v > 0.08) this.sfx.hitNear(Math.max(0.3, s.v), s.pan);
        }
        break;
      }
      case 'boom': {
        this.addLight(ev.x, ev.y, ev.r * 2.2, '#ffb347', 0.4);
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
        if (d < 520 && g) {
          const sp = spatial(ev.x - g.x, ev.y - g.y, 520);
          this.sfx.boom(Math.max(0.2, sp.v), sp.pan);
          this.shake = Math.max(this.shake, Math.max(1, 4 - d / 80));
        }
        break;
      }
      case 'wallhit': {
        fx.burst(ev.x, ev.y, 5, {
          colors: ['#b9835a', '#7a4e2c', '#d9a574'],
          speed: 50,
          life: 0.4,
          grav: 100,
        });
        if (g) {
          const sp = spatial(ev.x - g.x, ev.y - g.y, 260);
          if (sp.v > 0.08) this.sfx.wallHit(sp.v, sp.pan);
        }
        break;
      }
      case 'place':
        if (this.distToMe(ev.x, ev.y) < 260) this.sfx.place();
        fx.burst(ev.x, ev.y + 4, 6, {
          colors: ['#b9835a', '#d9a574', '#e4e0d0'],
          speed: 30,
          life: 0.35,
          grav: 60,
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
        if (g) {
          const sp = spatial(ev.x - g.x, ev.y - g.y, 320);
          if (sp.v > 0.05) this.sfx.wallBreak(Math.max(0.3, sp.v), sp.pan);
        }
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
        else if (d < 320 && g) {
          const sp = spatial(ev.x - g.x, ev.y - g.y, 320);
          this.sfx.kill(Math.max(0.3, sp.v), sp.pan);
        }
        break;
      }
      case 'open': {
        this.addLight(ev.x, ev.y, ev.golden ? 24 : 16, ev.ammo ? '#c8e07a' : '#ffd24a', 0.3);
        const cols = ev.ammo
          ? [C.yellow, C.orange, '#a3b86c']
          : ev.golden
            ? [C.yellow, C.white, C.orange]
            : [C.yellow, C.white];
        for (let i = 0; i < (ev.golden || ev.ammo ? 9 : 5); i++)
          fx.star(
            ev.x + (Math.random() - 0.5) * 12,
            ev.y - 6 - Math.random() * 6,
            cols[i % cols.length] as string,
            0.7,
            -22,
          );
        if (this.distToMe(ev.x, ev.y) < 80) this.sfx.chest();
        break;
      }
      case 'capture': {
        // un patio cambia de dueno: anillos y chispas del color del equipo
        const col = TEAM_COLORS[ev.team as 0 | 1] as string;
        this.addLight(ev.x, ev.y, 46, col, 0.8);
        for (let k = 0; k < 3; k++) fx.ring(ev.x, ev.y, 18 + k * 16, col, 0.7 + k * 0.15);
        for (let i = 0; i < 16; i++)
          fx.star(
            ev.x + (Math.random() - 0.5) * 40,
            ev.y + (Math.random() - 0.5) * 24,
            col,
            0.8,
            -26,
          );
        const mine = this.game?.pvp?.team === ev.team;
        this.sfx.capture(mine);
        const name = this.map?.points?.[ev.i]?.name ?? 'el patio';
        this.game?.say(
          mine ? `¡Tomaron ${name}!` : `Les quitaron ${name}`,
          mine ? 'good' : 'bad',
          2000,
        );
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
        this.sfx.warn();
        break;
      case 'emote':
        if (this.distToMe(ev.x, ev.y) < 220) this.sfx.pop(0.55);
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
    if (g) this.adv?.onEvent(ev, g, performance.now());
  }

  // ------------------------------------------------------------------ ambiente

  /** Detalles que le dan vida al mapa: hojas, polvo en la casa y destellos en el agua. */
  private ambient(dt: number, now: number): void {
    const g = this.game;
    const map = this.map;
    if (!g || !map) return;
    const camX = this.camX;
    const camY = this.camY;
    const rate =
      (map.kind === 'bosque' ? 1.6 : map.kind === 'casa' ? 2 : 2.4) *
      (1 - 0.6 * this.sky.light.night);
    this.ambientAcc += dt * rate;
    while (this.ambientAcc >= 1) {
      this.ambientAcc -= 1;
      const x = camX + Math.random() * this.viewW;
      const y = camY + Math.random() * this.viewH;
      if (map.kind === 'bosque') {
        const colors = [C.grassL, C.lime, C.yellow];
        this.fx.add({
          x,
          y: camY - 2,
          vx: 6 + Math.random() * 8,
          vy: 14 + Math.random() * 10,
          life: 4,
          max: 4,
          color: colors[Math.floor(Math.random() * 3)] as string,
          size: 1,
          grav: 0,
          kind: 0,
          r: 0,
        });
      } else if (map.kind === 'casa') {
        this.fx.add({
          x,
          y,
          vx: (Math.random() - 0.5) * 4,
          vy: -2 - Math.random() * 3,
          life: 3.5,
          max: 3.5,
          color: '#f4f4f4',
          size: 1,
          grav: 0,
          kind: 0,
          r: 0,
        });
      } else if (isWaterAtPx(map, x, y)) {
        this.fx.star(x, y, C.white, 0.7, 0);
      }
    }
    if (g.win && g.win.winnerId === g.you && !this.celebrated) {
      this.celebrated = true;
      this.confettiUntil = now + 3200;
    }
    if (now < this.confettiUntil) {
      const colors = [C.yellow, C.red, C.cyan, C.lime, C.pink, C.orange];
      for (let i = 0; i < 4; i++) {
        this.fx.add({
          x: camX + Math.random() * this.viewW,
          y: camY - 3,
          vx: (Math.random() - 0.5) * 40,
          vy: 40 + Math.random() * 60,
          life: 3,
          max: 3,
          color: colors[Math.floor(Math.random() * colors.length)] as string,
          size: 2,
          grav: 30,
          kind: 0,
          r: 0,
        });
      }
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
    // Hora del dia: sale de la semilla y del reloj de la partida, igual para todos.
    const clockS = g.latest ? Math.max(0, g.serverNow / 1000) : 0;
    if (g.mode === 'aventura' && g.adv) {
      // a medida que el grupo avanza por el bosque, cae la tarde y llega la noche
      const goal = Math.min(1, 0.03 + (0.97 * g.adv.room) / Math.max(1, g.adv.rooms - 1));
      this.advPhase += (goal - this.advPhase) * Math.min(1, dt * 0.4);
      if (this.advPhase < 0.03) this.advPhase = 0.03;
    }
    const dl = this.sky.setPhase(
      this.dayOverride ??
        (g.mode === 'aventura'
          ? this.advPhase
          : dayPhase(g.seed, clockS, DAY_SPAN_BY_MODE[g.mode])),
    );
    this.sfx.setDaytime(dl.p);
    if (dl.name !== this.lastDayName) {
      if (this.lastDayName !== null) {
        this.phaseToast = { name: dl.name, at: now };
        this.sfx.phaseChime(dl.name);
      }
      this.lastDayName = dl.name;
    }
    this.ambient(dt, now);
    if (g.alive && g.me) {
      if (g.me.tired && !this.wasTired) this.sfx.huff();
      this.wasTired = g.me.tired;
      if (g.me.hp <= 25 && now - this.lastBeat > 900) {
        this.lastBeat = now;
        this.sfx.heartbeat();
      }
    }

    const { cats, shots, mobs } = g.sampleWorld();
    this.celebrate(g, cats, now, dt);
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
    this.sky.update(dt, now, map.kind, { x: camX, y: camY, w: this.viewW, h: this.viewH });
    this.drawGround(b, map, camX, camY, now);
    this.drawGroundFx(b, map, camX, camY, now);
    this.adv?.drawGround(b, g, camX, camY, now);

    this.labels.length = 0;
    this.drawPoints(b, g, camX, camY, now);
    const list: Drawable[] = [];
    this.collectStatics(list, camX, camY, now, target, dt);
    this.collectWalls(list, g, camX, camY);
    this.collectBoxes(list, g, camX, camY, now, dt);
    this.collectCats(list, g, cats, camX, camY, now, dt);
    this.adv?.collect(list, b, g, mobs, camX, camY, now);
    if (g.alive) this.adv?.drawPlayerAura(b, g, camX, camY, now);
    list.sort((p, q) => p.y - q.y);
    for (const d of list) d.draw();
    this.drawAim(b, g, cats, camX, camY, now);

    this.drawShots(b, shots, camX, camY);
    this.fx.draw(b, camX, camY);
    this.sky.drawCreatures(b, camX, camY, now);
    this.drawRoofs(b, g, cats, camX, camY, dt);
    const flashes = this.drawLights(b, camX, camY, dt);
    this.drawMood(b, map.kind);
    this.sky.drawVeil(
      b,
      map.kind,
      camX,
      camY,
      this.viewW,
      this.viewH,
      this.veilLights(g, cats, target, flashes),
    );
    if (g.zone && g.mode !== 'aventura') this.drawZone(b, g.zone, camX, camY, now);
    if (this.storm) {
      this.rain.update(dt, now, this.viewW, this.viewH);
      this.rain.draw(b, this.viewW, this.viewH, g.zone, camX, camY);
    }

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
      daylight: dl,
      dayToast: this.phaseToast,
    });
  }

  /** Dibujos de resplandor ya pintados (uno por color y tamano): pintarlos pixel a pixel cada cuadro costaria mucho. */
  private readonly glowCache = new Map<string, HTMLCanvasElement>();

  private glowSprite(color: string, r: number): HTMLCanvasElement {
    const key = `${color}|${r}`;
    let cv = this.glowCache.get(key);
    if (!cv) {
      const [canvas, c] = make(r * 2 + 2, Math.ceil(r * 1.6) + 2);
      for (let i = 3; i >= 1; i--) {
        c.globalAlpha = 0.45;
        ell(c, r + 1, canvas.height / 2, (r * i) / 3, (r * i * 0.8) / 3, color);
      }
      cv = canvas;
      this.glowCache.set(key, cv);
    }
    return cv;
  }

  private readonly cloudCache = new Map<string, HTMLCanvasElement>();

  /** Sombra de una nube, pintada una sola vez. */
  private cloudSprite(i: number, color: string): HTMLCanvasElement {
    const key = `${i}|${color}`;
    let cv = this.cloudCache.get(key);
    if (!cv) {
      const rx = 90 + i * 14;
      const ry = 42 + i * 8;
      const [canvas, c] = make(rx * 2 + 4, ry * 2 + 4);
      ell(c, rx + 2, ry + 2, rx, ry, color);
      ell(c, rx + 2 - 24, ry + 2 + 6, rx * 0.55, ry * 0.7, color);
      cv = canvas;
      this.cloudCache.set(key, cv);
    }
    return cv;
  }

  /** Destello de luz: se suma al color de abajo, como una luz de verdad. */
  private glow(b: Ctx, x: number, y: number, r: number, color: string, alpha: number): void {
    const sprite = this.glowSprite(color, Math.max(4, Math.round(r)));
    const prev = b.globalCompositeOperation;
    b.globalCompositeOperation = 'lighter';
    b.globalAlpha = Math.min(1, alpha * 1.6);
    b.drawImage(sprite, Math.round(x - sprite.width / 2), Math.round(y - sprite.height / 2));
    b.globalCompositeOperation = prev;
    b.globalAlpha = 1;
  }

  private addLight(x: number, y: number, r: number, color: string, life: number): void {
    if (this.lights.length > 24) this.lights.shift();
    this.lights.push({ x, y, r, color, life, max: life });
  }

  private drawLights(b: Ctx, camX: number, camY: number, dt: number): LightSrc[] {
    const out: LightSrc[] = [];
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i] as (typeof this.lights)[number];
      l.life -= dt;
      if (l.life <= 0) {
        this.lights.splice(i, 1);
        continue;
      }
      const k = l.life / l.max;
      out.push({ x: l.x, y: l.y, r: l.r * 1.5, k: Math.min(1, 0.9 * k + 0.1) });
      this.glow(
        b,
        Math.round(l.x - camX),
        Math.round(l.y - camY),
        l.r * (0.7 + 0.3 * k),
        l.color,
        0.6 * k,
      );
    }
    return out;
  }

  /** Todas las luces que aclaran la noche: el gato, los demas gatos, las casas, los cofres y los fogonazos. */
  private veilLights(
    g: ClientBR,
    cats: Map<number, CatView>,
    target: { x: number; y: number },
    flashes: LightSrc[],
  ): LightSrc[] {
    if (this.sky.light.alpha < 0.05) return [];
    const out: LightSrc[] = [...this.skyLights, ...flashes];
    out.push({ x: target.x, y: target.y, r: 66, k: 0.95 });
    for (const c of cats.values()) out.push({ x: c.x, y: c.y, r: 26, k: 0.7 });
    for (const bx of g.boxes) {
      const closed = bx[4] === 0 && (bx[3] === 0 || bx[3] === 1 || bx[3] === 4);
      if (!closed) continue;
      out.push({
        x: bx[1],
        y: bx[2],
        r: 18,
        k: 0.55,
        warm: bx[3] === 1 ? '#ffd24a' : '#ffa850',
        warmK: 0.25,
      });
    }
    return out;
  }

  /** Tinte de ambiente de cada mapa: calido en el bosque y la casa, fresco en la piscina. */
  private drawMood(b: Ctx, kind: string): void {
    b.globalAlpha = 1;
    b.fillStyle =
      kind === 'bosque'
        ? 'rgba(255,225,150,0.045)'
        : kind === 'casa'
          ? 'rgba(255,196,130,0.06)'
          : 'rgba(150,225,255,0.05)';
    b.fillRect(0, 0, this.viewW, this.viewH);
  }

  /**
   * Vida sobre el piso: sombras de nubes que pasan por el bosque y la piscina, rayos de sol por las
   * ventanas de la casa y destellos del agua.
   */
  /** Los patios que se disputan: anillo del color de quien manda, avance de captura y bandera. */
  private drawPoints(b: Ctx, g: ClientBR, camX: number, camY: number, now: number): void {
    const defs = this.map?.points;
    const st = g.pvp?.points;
    if (!defs || !st) return;
    const letters = ['A', 'B', 'C'];
    defs.forEach((p, i) => {
      const [owner, prog, cap] = st[i] ?? [-1, 0, -1];
      const cx = Math.round(p.x - camX);
      const cy = Math.round(p.y - camY);
      if (cx < -p.r - 8 || cx > this.viewW + p.r + 8 || cy < -p.r - 8 || cy > this.viewH + p.r + 8)
        return;
      const base = owner >= 0 ? (TEAM_COLORS[owner as 0 | 1] as string) : '#e8ecf4';
      const capCol = cap >= 0 ? (TEAM_COLORS[cap as 0 | 1] as string) : '#e8ecf4';
      const rx = p.r;
      const ry = Math.round(p.r * 0.78);
      // relleno en tablero de ajedrez, tenue
      b.globalAlpha = owner >= 0 ? 0.2 : 0.1;
      b.fillStyle = base;
      for (let y = -ry; y <= ry; y++) {
        for (let x = -rx; x <= rx; x++) {
          if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
          if (((x >> 1) + (y >> 1)) & 1) continue;
          b.fillRect(cx + x, cy + y, 1, 1);
        }
      }
      b.globalAlpha = 1;
      // anillo de rayas que gira despacio
      const steps = Math.max(40, Math.round(rx * 5));
      const spin = Math.floor(now / 140);
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * rx);
        const y = Math.round(cy + Math.sin(a) * ry);
        const filled = prog > 0 && owner < 0 && k / steps <= prog / 100;
        if (!filled && ((k + spin) & 3) > 1) continue;
        b.fillStyle = filled ? capCol : base;
        b.fillRect(x, y, filled ? 2 : 1, filled ? 2 : 1);
      }
      // bandera en el centro
      const sway = Math.round(Math.sin(now / 260 + i) * 1);
      b.fillStyle = '#2a2d38';
      b.fillRect(cx, cy - 16, 2, 16);
      b.fillStyle = owner >= 0 ? base : '#c4cad8';
      b.fillRect(cx + 2, cy - 16, 9 + sway, 6);
      b.fillStyle = 'rgba(255,255,255,0.35)';
      b.fillRect(cx + 2, cy - 16, 9 + sway, 1);
      this.labels.push({
        x: p.x,
        y: p.y - 24,
        text: letters[i] ?? '',
        color: owner >= 0 ? base : C.white,
        kind: 'name',
      });
    });
  }

  private drawGroundFx(b: Ctx, map: BRMap, camX: number, camY: number, now: number): void {
    const mapW = map.w * T;
    const dl = this.sky.light;
    // Color de la luz que entra: sol de dia, naranja al atardecer y luna azulada de noche.
    const beamColor = dl.night > 0.45 ? '#a9c6ff' : dl.dusk > 0.35 ? '#ffb27a' : '#fff1c4';
    const beamK = dl.night > 0.45 ? 0.8 : 1 + dl.dusk * 0.6;
    if (map.kind === 'casa') {
      // rayos de sol: un par por cuarto, inclinados, que respiran despacio
      const rooms = [0.17, 0.5, 0.83];
      const prev = b.globalCompositeOperation;
      b.globalCompositeOperation = 'lighter';
      rooms.forEach((fx, i) => {
        const bx = mapW * fx - camX + Math.sin(now / 5200 + i * 2) * 10;
        const top = 2 * T - camY;
        const a = (0.05 + 0.025 * Math.sin(now / 1700 + i * 1.7)) * beamK;
        for (const [w, off] of [
          [18, 0],
          [9, 40],
        ] as const) {
          b.globalAlpha = a;
          b.fillStyle = beamColor;
          b.beginPath();
          b.moveTo(bx + off, top);
          b.lineTo(bx + off + w, top);
          b.lineTo(bx + off + w + 140, top + 190);
          b.lineTo(bx + off + 140 - 10, top + 190);
          b.closePath();
          b.fill();
        }
      });
      b.globalCompositeOperation = prev;
      b.globalAlpha = 1;
    } else {
      // rayos de luz que cruzan el bosque y la piscina mientras queda sol (y luna despues)
      const shaft = dl.night > 0.45 ? 0.028 * dl.night : 0.035 * (dl.sun + dl.dusk * 0.8);
      if (shaft > 0.004) {
        const prev = b.globalCompositeOperation;
        b.globalCompositeOperation = 'lighter';
        b.fillStyle = beamColor;
        for (let i = 0; i < 3; i++) {
          const bx =
            ((now / 1000) * 3 + i * 190 + Math.sin(now / 4300 + i) * 14) % (this.viewW + 220);
          b.globalAlpha = shaft * (0.7 + 0.3 * Math.sin(now / 1900 + i * 2.3));
          b.beginPath();
          b.moveTo(bx - 40, 0);
          b.lineTo(bx - 14, 0);
          b.lineTo(bx + 60, this.viewH);
          b.lineTo(bx + 34, this.viewH);
          b.closePath();
          b.fill();
        }
        b.globalCompositeOperation = prev;
      }
      // sombras de nubes (de noche ya no hay sol que las proyecte)
      const mapH = map.h * T;
      b.globalAlpha = 0.085 * dl.sun;
      for (let i = 0; i < (dl.sun > 0.05 ? 4 : 0); i++) {
        const cx = (((now / 1000) * (5 + i) + i * mapW * 0.31) % (mapW + 360)) - 180;
        const cy = (mapH * (0.18 + i * 0.22) + Math.sin(now / 9000 + i) * 30) % mapH;
        const cloud = this.cloudSprite(i, map.kind === 'bosque' ? '#0b2a1f' : '#2a4a66');
        b.drawImage(
          cloud,
          Math.round(cx - camX - cloud.width / 2),
          Math.round(cy - camY - cloud.height / 2),
        );
      }
      b.globalAlpha = 1;
    }
    // destellos en el agua
    if (map.kind !== 'casa') {
      const tx0 = Math.max(0, Math.floor(camX / T));
      const ty0 = Math.max(0, Math.floor(camY / T));
      const tx1 = Math.min(map.w - 1, Math.floor((camX + this.viewW) / T));
      const ty1 = Math.min(map.h - 1, Math.floor((camY + this.viewH) / T));
      const beat = Math.floor(now / 150);
      b.fillStyle = dl.night > 0.45 ? '#cfe4ff' : '#ffffff';
      const sparkle = dl.night > 0.45 ? 29 : 17;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (map.ground[ty * map.w + tx] !== G.WATER) continue;
          if ((tx * 7 + ty * 13 + beat) % sparkle !== 0) continue;
          const px0 = tx * T - camX + ((tx * 5 + ty * 3 + beat) % 11) + 2;
          const py0 = ty * T - camY + ((tx * 3 + ty * 7 + beat) % 11) + 2;
          b.fillRect(px0, py0, 2, 1);
          b.fillRect(px0 + 1, py0 - 1, 1, 3);
        }
      }
    }
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
      // Arboles, palmeras y plantas se mecen con el viento: la copa se corre un pixel, el tronco no.
      const swayAmp = SWAY[s.kind] ?? 0;
      const sway = swayAmp
        ? Math.round(Math.sin(now / 1100 + s.x * 0.05 + s.y * 0.031) * swayAmp)
        : 0;
      list.push({
        y: s.sortY,
        draw: () => {
          if (alpha < 0.98) b.globalAlpha = alpha;
          if (sway !== 0) {
            const cut = Math.floor(s.sprite.height * 0.6);
            b.drawImage(
              s.sprite,
              0,
              0,
              s.sprite.width,
              cut,
              s.x - camX + sway,
              s.y - camY,
              s.sprite.width,
              cut,
            );
            b.drawImage(
              s.sprite,
              0,
              cut,
              s.sprite.width,
              s.sprite.height - cut,
              s.x - camX,
              s.y - camY + cut,
              s.sprite.width,
              s.sprite.height - cut,
            );
          } else {
            b.drawImage(s.sprite, s.x - camX, s.y - camY + bob);
          }
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
      else if (kind === 4) sprite = opened ? a.ammoCrate.open : a.ammoCrate.closed;
      else {
        const idx = Math.floor(top / 3);
        sprite = a.icon[ITEM_KINDS[idx] ?? 'pistol'];
        dy = -8 + Math.round(Math.sin(now / 300 + id) * 1.2);
      }
      const rarity = kind === 3 && top >= 0 ? top % 3 : 0;
      // Los cofres cerrados dan un resplandor suave para encontrarlos aunque el piso sea del mismo color.
      if (!opened && (kind === 0 || kind === 1 || kind === 4)) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 420 + id);
        const color = kind === 4 ? '#c8e07a' : kind === 1 ? '#ffd24a' : '#ffcd75';
        this.glow(
          b,
          Math.round(x - camX),
          Math.round(y - camY) + 3,
          kind === 1 ? 15 : 11,
          color,
          (kind === 1 ? 0.5 : 0.3) + pulse * 0.12,
        );
      }
      const golden = kind === 1 && !opened;
      if (golden && Math.random() < dt * 2.2)
        this.fx.star(x + (Math.random() - 0.5) * 12, y - 8, C.yellow, 0.6, -10);
      // las cajas de municion cerradas brillan un poco para encontrarlas de lejos
      if (kind === 4 && !opened && Math.random() < dt * 1.4)
        this.fx.star(x + (Math.random() - 0.5) * 12, y - 8, '#d9e8a0', 0.5, -9);
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
      if (g.running && g.moving) flags |= FLAG.running;
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
    // Los sombreros suben el nombre, el emote y la corona para que no se encimen.
    const lift = Math.max(0, (outfitInfo(info?.skin.outfit)?.height ?? 0) - 2);
    const moving = (flags & FLAG.moving) !== 0;
    const running = moving && (flags & FLAG.running) !== 0;
    const frame = running
      ? 3 + (Math.floor(now / 80 + id) & 1)
      : moving
        ? 1 + (Math.floor(now / 115 + id) & 1)
        : 0;
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

    // Pisadas: suenan distinto segun el piso y las de otros gatos se oyen cerca y de su lado.
    if (moving) {
      const surface = wet
        ? 'water'
        : surfaceFor(groundAt(g.map, Math.floor(x / TILE), Math.floor((y + 4) / TILE)));
      if (isMe) {
        if (now - this.lastStepSfx > (running ? 170 : 290)) {
          this.lastStepSfx = now;
          this.sfx.step(surface, running);
        }
      } else if (now - (this.otherSteps.get(id) ?? 0) > (running ? 190 : 320)) {
        const s = spatial(x - g.x, y - g.y, 230);
        this.otherSteps.set(id, now + Math.random() * 60);
        if (s.v > 0.05 && !this.hiddenByRoof(x, y))
          this.sfx.step(surface, running, s.v * 0.55, s.pan);
      }
    }
    if (moving && !wet && now - this.lastStepFx > (running ? 55 : 140) && isMe) {
      this.lastStepFx = now;
      this.fx.burst(x - facing * 6, y + 6, running ? 3 : 2, {
        colors: ['#b68a5a', '#d5a27a', '#e8d8b4'],
        speed: running ? 26 : 14,
        life: running ? 0.4 : 0.3,
        grav: -10,
      });
    } else if (running && !wet && !isMe && Math.random() < dt * 14) {
      this.fx.burst(x - facing * 6, y + 6, 2, {
        colors: ['#b68a5a', '#d5a27a', '#e8d8b4'],
        speed: 22,
        life: 0.35,
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
    const winTeam = g.win?.winnerTeam;
    const winner =
      g.win !== null &&
      (winTeam !== undefined && winTeam !== null ? info?.team === winTeam : g.win.winnerId === id);
    const hop = winner ? -Math.round(Math.abs(Math.sin(now / 170)) * 5) : 0;
    if (winner && Math.random() < dt * 8)
      this.fx.star(x + (Math.random() - 0.5) * 18, y - 18, C.yellow, 0.6, -12);

    list.push({
      y: y + 6,
      draw: () => {
        b.globalAlpha = 1;
        if (!wet) {
          const team = info?.team;
          if (team !== undefined) {
            // el aro del equipo: naranja o azul, siempre se sabe quien es quien
            b.globalAlpha = 0.85;
            ell(b, sx, sy + 6, 11, 4, TEAM_COLORS[team as 0 | 1] as string);
            b.globalAlpha = 1;
          }
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
        const dy = sy - 11 - CAT_PAD + hop;
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
        if (winner) {
          const crown = this.assets.crown;
          b.drawImage(crown, Math.round(sx + facing * 5 - crown.width / 2), sy - 21 - lift + hop);
        }
        b.globalAlpha = 1;
        // Emote: un globo con la cara sobre la cabeza. Sale con un saltito y se desvanece.
        const emote = g.emotes.get(id);
        if (emote) {
          const age = now - emote.at;
          if (age > EMOTE_MS) g.emotes.delete(id);
          else if (age >= 0) {
            const bubble = this.assets.emote.bubble[emote.k];
            if (bubble) {
              const pop = age < 160 ? Math.round((1 - age / 160) * 4) : 0;
              const bob = Math.round(Math.sin(age / 260));
              b.globalAlpha = age > EMOTE_MS - 450 ? Math.max(0, (EMOTE_MS - age) / 450) : 1;
              b.drawImage(
                bubble,
                Math.round(sx - bubble.width / 2),
                sy - 44 - lift + pop + bob + hop,
              );
              b.globalAlpha = 1;
            }
          }
        }
      },
    });
    if (!isMe && info && !this.hiddenByRoof(x, y)) {
      this.labels.push({
        x,
        y: y - 16 - lift,
        text: info.name,
        color:
          info.team !== undefined
            ? (TEAM_COLORS[info.team as 0 | 1] as string)
            : info.bot
              ? C.lgray
              : C.white,
        kind: 'name',
      });
    }
    if (dim)
      this.labels.push({
        x,
        y: y - 24 - lift,
        text: 'sin conexión',
        color: C.orange,
        kind: 'small',
      });
  }

  /** Fuegos artificiales sobre el ganador mientras dura la celebracion. */
  private celebrate(g: ClientBR, cats: Map<number, CatView>, now: number, dt: number): void {
    const win = g.win;
    if (!win) return;
    let wx = g.drawX;
    let wy = g.drawY;
    if (win.winnerId !== null && win.winnerId !== g.you) {
      const c = cats.get(win.winnerId);
      if (c) {
        wx = c.x;
        wy = c.y;
      }
    }
    if (now >= this.nextRocketAt) {
      this.nextRocketAt = now + 260 + Math.random() * 380;
      const palettes = [
        [C.yellow, C.orange, C.white],
        [C.cyan, C.sky, C.white],
        [C.pink, C.red, C.white],
        [C.lime, C.green, C.yellow],
        [C.white, C.lgray, C.cyan],
      ];
      this.rockets.push({
        x: wx + (Math.random() - 0.5) * 220,
        y: wy + 70 + Math.random() * 20,
        vy: -(150 + Math.random() * 50),
        burstAt: now + 520 + Math.random() * 260,
        palette: palettes[Math.floor(Math.random() * palettes.length)] as string[],
      });
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i] as (typeof this.rockets)[number];
      r.y += r.vy * dt;
      this.fx.burst(r.x, r.y + 2, 1, {
        colors: [C.yellow, C.orange],
        speed: 10,
        life: 0.3,
        grav: 20,
      });
      if (now < r.burstAt) continue;
      this.rockets.splice(i, 1);
      this.fx.ring(r.x, r.y, 26, r.palette[0] as string, 0.5);
      this.fx.burst(r.x, r.y, 34, { colors: r.palette, speed: 95, life: 0.9, size: 2, grav: 40 });
      this.fx.burst(r.x, r.y, 14, { colors: [C.white], speed: 50, life: 0.5, size: 1, grav: 20 });
      this.sfx.pop(Math.max(0.2, 1 - Math.hypot(r.x - g.x, r.y - g.y) / 300));
    }
  }

  /** Guia de la mira: linea de disparo (movil), zarpazo, o el lugar donde caera el muro. */
  private drawAim(
    b: Ctx,
    g: ClientBR,
    cats: Map<number, CatView>,
    camX: number,
    camY: number,
    now: number,
  ): void {
    if (!g.alive || g.result) return;
    const angle = g.input.currentAim();
    if (angle === null) return;
    const touch = g.input.mode === 'touch';
    const item = g.selectedItem;
    const kind = item?.kind ?? null;
    const cs = Math.cos(angle);
    const sn = Math.sin(angle);
    const ox = g.x;
    const oy = g.y - 1;

    if (kind === 'wall') {
      // Mismo calculo que el servidor: el muro cae 22 px adelante, en esa casilla.
      const px0 = g.x + cs * WALL_ITEM.placeDistance;
      const py0 = g.y + sn * WALL_ITEM.placeDistance;
      const tx = Math.floor(px0 / T);
      const ty = Math.floor(py0 / T);
      let ok = !isSolidTile(g.map, tx, ty) && !isWaterAtPx(g.map, px0, py0);
      if (ok) {
        for (const c of cats.values()) {
          if ((c.flags & FLAG.dead) !== 0) continue;
          if (
            Math.abs(c.x - (tx * T + T / 2)) < T / 2 + CAT.half &&
            Math.abs(c.y - (ty * T + T / 2)) < T / 2 + CAT.half
          ) {
            ok = false;
            break;
          }
        }
      }
      const dx = tx * T - camX;
      const dy = ty * T - camY;
      b.globalAlpha = 0.5 + 0.12 * Math.sin(now / 130);
      b.drawImage(this.assets.wall[0] as HTMLCanvasElement, dx - 1, dy - 1);
      b.globalAlpha = 1;
      b.fillStyle = ok ? C.lime : C.red;
      for (let i = 0; i < T; i += 2) {
        b.fillRect(dx + i, dy, 1, 1);
        b.fillRect(dx + i, dy + T - 1, 1, 1);
        b.fillRect(dx, dy + i, 1, 1);
        b.fillRect(dx + T - 1, dy + i, 1, 1);
      }
      if (!ok) {
        b.fillRect(dx + 3, dy + 3, 2, 2);
        b.fillRect(dx + T - 5, dy + 3, 2, 2);
        b.fillRect(dx + 3, dy + T - 5, 2, 2);
        b.fillRect(dx + T - 5, dy + T - 5, 2, 2);
      }
      return;
    }
    if (!touch) return;

    // Puntos de 2 x 2 con sombra oscura: se leen igual sobre pasto, arena, agua o madera.
    const dot = (x: number, y: number, color: string): void => {
      const dx = Math.round(x - camX);
      const dy = Math.round(y - camY);
      b.fillStyle = 'rgba(26,28,44,0.55)';
      b.fillRect(dx - 1, dy - 1, 4, 4);
      b.fillStyle = color;
      b.fillRect(dx, dy, 2, 2);
    };
    const dots = (len: number, color: string, step = 5, phase = 0): { x: number; y: number } => {
      let last = { x: ox, y: oy };
      for (let d = 12 + phase; d < len; d += step) {
        last = { x: ox + cs * d, y: oy + sn * d };
        dot(last.x, last.y, color);
      }
      return last;
    };
    if (kind === null) {
      dots(CLAWS.range + 6, C.white, 4);
      return;
    }
    if (!isWeapon(kind)) return;
    const def = WEAPONS[kind];
    const color = RARITY_COLORS[(item?.rarity ?? 0) as 0 | 1 | 2] as string;
    const hit = segmentSolidHit(g.map, ox, oy, ox + cs * def.range, oy + sn * def.range);
    const len = def.range * (hit.hit ? hit.t : 1);
    const phase = (now / 40) % 4;
    // Linea punteada: el brillo corre hacia adelante para que se note la direccion.
    const locked = g.input.aimLocked;
    const end = dots(len, locked ? C.red : kind === 'sniper' ? C.cyan : C.white, 5, phase);
    if (def.pellets > 1) {
      // Escopeta: el abanico por donde saldran los perdigones.
      for (const sign of [-1, 1]) {
        const a2 = angle + sign * def.spread;
        for (let d = 14; d < Math.min(len, 90); d += 6) {
          dot(ox + Math.cos(a2) * d, oy + Math.sin(a2) * d, 'rgba(244,244,244,0.8)');
        }
      }
    }
    // Remate: una cruz del color del arma (y el radio de explosion de la bazuca).
    const ex = Math.round(end.x - camX);
    const ey = Math.round(end.y - camY);
    b.fillStyle = 'rgba(26,28,44,0.7)';
    b.fillRect(ex - 4, ey - 1, 9, 3);
    b.fillRect(ex - 1, ey - 4, 3, 9);
    // Con objetivo fijado (modo "solo con objetivo") la cruz se pone roja y parpadea.
    b.fillStyle = locked ? (Math.floor(now / 120) % 2 === 0 ? C.red : C.orange) : color;
    b.fillRect(ex - 3, ey, 7, 1);
    b.fillRect(ex, ey - 3, 1, 7);
    if (def.splash > 0) {
      const r = def.splash;
      for (let i = 0; i < 24; i++) {
        const a3 = (i / 24) * Math.PI * 2;
        dot(end.x + Math.cos(a3) * r, end.y + Math.sin(a3) * r, C.orange);
      }
    }
  }

  /**
   * Cada arma tiene su proyectil: bala dorada (pistola), trazadora verde (fusil), perdigones
   * naranjas (escopeta), rayo largo cyan (sniper) y misil con llama (bazuca). Llevan un contorno
   * oscuro para verse sobre cualquier piso y, si el arma es rara, un halo verde o morado.
   */
  private drawShots(
    b: Ctx,
    shots: Map<number, { x: number; y: number; kind: number; ang: number }>,
    camX: number,
    camY: number,
  ): void {
    const now = performance.now();
    const DARK = 'rgba(26,28,44,0.6)';
    for (const s of shots.values()) {
      const x = s.x - camX;
      const y = s.y - camY;
      if (x < -30 || y < -30 || x > this.viewW + 30 || y > this.viewH + 30) continue;
      if (s.kind >= 64) {
        this.adv?.drawHostileShot(b, x, y, s.kind, s.ang, now);
        continue;
      }
      const base = s.kind & 7;
      const rarity = s.kind >> 3;
      const cx = Math.cos(s.ang);
      const cy = Math.sin(s.ang);
      // Pinta una raya hacia atras desde la cabeza: de `from` a `to` pixeles, de `thick` de grueso.
      const line = (from: number, to: number, color: string, thick = 1): void => {
        b.fillStyle = color;
        const off = thick >> 1;
        for (let i = from; i <= to; i++)
          b.fillRect(Math.round(x - cx * i - off), Math.round(y - cy * i - off), thick, thick);
      };
      if (rarity > 0)
        ell(b, x, y, 3.4, 3.4, rarity === 2 ? 'rgba(181,91,240,0.5)' : 'rgba(56,183,100,0.45)');
      switch (base) {
        case 1: {
          // perdigon de escopeta
          line(0, 3, 'rgba(239,125,87,0.5)', 1);
          line(0, 0, DARK, 4);
          line(0, 0, C.orange, 3);
          line(0, 0, C.yellow, 1);
          break;
        }
        case 2: {
          // bala de sniper: un rayo largo y delgado
          line(0, 20, 'rgba(115,239,247,0.28)', 3);
          line(0, 12, DARK, 3);
          line(0, 16, C.cyan, 1);
          line(0, 7, C.white, 2);
          if (Math.random() < 0.35)
            this.fx.star(
              s.x - cx * (4 + Math.random() * 12),
              s.y - cy * (4 + Math.random() * 12),
              C.cyan,
              0.2,
              0,
            );
          break;
        }
        case 3: {
          // misil: cuerpo gris con punta roja y una llama que parpadea
          const flame = 4 + ((now / 55) & 3);
          line(8, 8 + flame, Math.floor(now / 70) % 2 ? C.orange : C.yellow, 3);
          line(8, 8 + flame - 2, C.white, 1);
          line(1, 8, DARK, 5);
          line(2, 8, C.lgray, 3);
          line(5, 6, C.gray, 3);
          line(0, 1, C.red, 3);
          if (Math.random() < 0.8)
            this.fx.burst(s.x - cx * 10, s.y - cy * 10, 1, {
              colors: ['#c8c8c8', C.yellow, C.orange],
              speed: 14,
              life: 0.4,
              grav: -8,
            });
          break;
        }
        case 4: {
          // trazadora del fusil: verde y larga
          line(3, 13, 'rgba(167,240,112,0.4)', 1);
          line(0, 6, DARK, 3);
          line(0, 6, C.lime, 2);
          line(0, 1, C.white, 2);
          break;
        }
        default: {
          // bala de pistola: dorada y corta
          line(2, 8, 'rgba(255,205,117,0.45)', 1);
          line(0, 3, DARK, 4);
          line(0, 3, C.yellow, 2);
          line(0, 1, C.white, 2);
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
    if (!this.wavePattern)
      this.wavePattern = b.createPattern(this.storm ? this.stormWave : this.wave, 'repeat');
    const pattern = this.wavePattern;
    const cx = z.cx - camX;
    const cy = z.cy - camY;
    const r = z.r;
    const w = this.viewW;
    const h = this.viewH;
    if (pattern) {
      const t = now / 1000;
      // la lluvia de la tormenta cae rapido; la ola del agua se arrastra despacio
      pattern.setTransform(
        this.storm
          ? new DOMMatrix().translate(Math.round(-camX - t * 14), Math.round(-camY + t * 70))
          : new DOMMatrix().translate(Math.round(-camX + t * 9), Math.round(-camY + t * 5)),
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
      b.fillStyle = this.storm
        ? (y + wob) % 4 === 0
          ? 'rgba(160,190,255,0.95)'
          : 'rgba(225,236,255,0.9)'
        : (y + wob) % 5 === 0
          ? 'rgba(115,239,247,0.9)'
          : 'rgba(244,244,244,0.88)';
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
