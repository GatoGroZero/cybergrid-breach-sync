import type { DayName, Daylight } from '../../shared/br/daytime';
import { TEAM_COLORS } from '../../shared/br/modes';
import { DASH } from '../../shared/br/adventure';
import { drawPvpHud } from './hudpvp';
import { INVENTORY_SLOTS } from '../../shared/br/constants';
import {
  CLAWS,
  ITEM_KINDS,
  ITEM_NAMES,
  RARITY_COLORS,
  RARITY_NAMES,
  WEAPONS,
  isWeapon,
  magOf,
  type Item,
} from '../../shared/br/items';
import { G, isWaterAtPx, type BRMap } from '../../shared/br/map';
import { WATER } from '../../shared/br/constants';
import type { Assets } from '../pixel/art';
import { C, make } from '../pixel/draw';
import type { Floater } from './fx';
import { keyLabel, type Circle } from './input';
import type { ClientBR } from './state';
import { AdvHud } from './hudadv';
import { drawTouchControls } from './touchui';

/** Cuanto se ve el aviso del objeto en mano y cuanto tarda en difuminarse. */
const INFO_SHOW_MS = 2000;
const INFO_FADE_MS = 700;

type Ctx = CanvasRenderingContext2D;

export interface Label {
  x: number;
  y: number;
  text: string;
  color: string;
  kind: 'name' | 'small';
}

export interface HudFrame {
  ctx: Ctx;
  g: ClientBR;
  w: number;
  h: number;
  safe: { l: number; r: number; t: number; b: number };
  now: number;
  toScreen: (wx: number, wy: number) => { x: number; y: number };
  worldK: number;
  floaters: Floater[];
  labels: Label[];
  mapOpen: boolean;
  fps: number;
  target: { x: number; y: number };
  daylight: Daylight;
  dayToast: { name: DayName; at: number } | null;
}

export const PIX = '"Press Start 2P", monospace';
export const VT = 'VT323, monospace';

const GROUND_COLOR: Record<number, string> = {
  [G.GRASS]: '#3e8948',
  [G.GRASS2]: '#3a8044',
  [G.GRASS3]: '#44924d',
  [G.DIRT]: '#b68a5a',
  [G.WATER]: '#41a6f6',
  [G.WOOD]: '#d5a27a',
  [G.WOOD2]: '#c28b5a',
  [G.DECK]: '#e8d8b4',
  [G.DECK2]: '#cdb98f',
  [G.CARPET]: '#b13e53',
  [G.TILE]: '#e4e0d0',
  [G.FLOWER]: '#4f9a52',
  [G.FLOWER2]: '#4f9a52',
  [G.PATH]: '#c9a46c',
  [G.SAND]: '#e8d8b4',
  [G.WALLTOP]: '#4a3b52',
  [G.HEDGE]: '#1f5c3a',
  [G.POOLEDGE]: '#f4f4f4',
  [G.HOUSEWALL]: '#6d4530',
  [G.BEDSHADE]: '#7a5539',
  [G.TEJA]: '#c2563b',
  [G.TEJA2]: '#a9462f',
  [G.PIZARRA]: '#5d6e8e',
  [G.PIZARRA2]: '#4b5b7b',
  [G.ALQUITRAN]: '#3b404c',
  [G.ALQUITRAN2]: '#454b59',
  [G.CANALON]: '#8a98ad',
  [G.PARAPETO]: '#8c6a5c',
  [G.CUMBRERA]: '#a8402b',
  [G.ASFALTO]: '#4a4f5e',
  [G.ASFALTO2]: '#575c6c',
  [G.ACERA]: '#c4c0b8',
  [G.CEBRA]: '#e8e9ee',
  [G.RAYA]: '#f0c448',
  [G.ADOQUIN]: '#9a948a',
  [G.PATIO]: '#b9b6ae',
  [G.CESPED]: '#4a9b49',
  [G.MUSGO]: '#2b6b4a',
  [G.RUNAS]: '#566182',
  [G.HONGOS]: '#3b7a55',
  [G.CHARCO]: '#2f86b4',
  [G.ZARZAL]: '#0f241c',
};
/** Coberturas de los techos y las calles: se ven como puntos grises en el minimapa. */
const MINI_COVER = new Set([
  'chimney',
  'tank',
  'antenna',
  'vent',
  'ac',
  'dormer',
  'dome',
  'shed',
  'car',
  'dumpster',
  'lamp',
  'busstop',
  'planter',
  'fence',
]);
const ROOF_COLOR = ['#b13e53', '#3b5dc9', '#38b764', '#ef7d57'];

export function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  font: string = VT,
  outline: string | null = C.black,
): void {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (outline) {
    ctx.lineWidth = Math.max(2, Math.round(size / 5));
    ctx.strokeStyle = outline;
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Panel de pixeles: borde oscuro, relleno y una linea de luz arriba. */
export function panel(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string = 'rgba(26,28,44,0.82)',
  border: string = C.black,
  light: string = 'rgba(255,255,255,0.08)',
): void {
  ctx.fillStyle = border;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = light;
  ctx.fillRect(x, y, w, 2);
}

export function sprite(ctx: Ctx, s: HTMLCanvasElement, cx: number, cy: number, size: number): void {
  ctx.imageSmoothingEnabled = false;
  const k = size / Math.max(s.width, s.height);
  ctx.drawImage(
    s,
    Math.round(cx - (s.width * k) / 2),
    Math.round(cy - (s.height * k) / 2),
    Math.round(s.width * k),
    Math.round(s.height * k),
  );
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Un mapa de un pixel por casilla: terreno, arboles y tejados. */
function buildMiniBase(map: BRMap): HTMLCanvasElement {
  const [cv, c] = make(map.w, map.h);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      c.fillStyle = GROUND_COLOR[map.ground[y * map.w + x] as number] ?? '#3e8948';
      c.fillRect(x, y, 1, 1);
    }
  }
  for (const p of map.props) {
    const col =
      p.kind === 'tree'
        ? '#1f5c3a'
        : p.kind === 'pine'
          ? '#1d4f4a'
          : p.kind === 'palm'
            ? '#257179'
            : p.kind === 'rock'
              ? '#94b0c2'
              : MINI_COVER.has(p.kind)
                ? '#8b93a6'
                : null;
    if (!col) continue;
    c.fillStyle = col;
    c.fillRect(p.x, p.y, Math.min(p.w, 2), Math.min(p.h, 2));
  }
  for (const h of map.houses) {
    c.fillStyle =
      h.kind === 'bed'
        ? '#f4f4f4'
        : h.kind === 'cabin'
          ? '#41a6f6'
          : (ROOF_COLOR[h.style % 4] as string);
    c.fillRect(h.x, h.y, h.w, h.h);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(h.x, h.y + h.h - 1, h.w, 1);
  }
  return cv;
}

export class Hud {
  private miniBase: HTMLCanvasElement | null = null;
  private map: BRMap | null = null;
  private healMax = 0;
  /** Objeto en mano cuyo aviso se esta mostrando y desde cuando (el aviso se difumina solo). */
  private infoKey = '';
  private infoAt = 0;
  /** Recarga en curso: casilla del arma y cuanto lleva (0 a 1). */
  private reloadSlot = -1;
  private reloadFrac = 0;
  private curGame: ClientBR | null = null;
  /** Donde quedo el panel de la ola, para pegarle el reloj del cielo. */
  private zoneBox = { x: 0, y: 0, w: 0, h: 30 };
  private readonly advHud = new AdvHud();

  constructor(private readonly assets: Assets) {}

  setMap(map: BRMap): void {
    this.map = map;
    this.miniBase = buildMiniBase(map);
  }

  draw(f: HudFrame): void {
    const { ctx, g } = f;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    this.curGame = g;
    this.reloadSlot = -1;
    this.reloadFrac = 0;
    const me = g.me;
    if (me && me.reload > 0) {
      const held = g.inv[me.sel];
      if (held && isWeapon(held.kind)) {
        this.reloadSlot = me.sel;
        this.reloadFrac = Math.min(1, Math.max(0, 1 - me.reload / WEAPONS[held.kind].reload));
      }
    }
    this.drawLabels(f);
    this.drawFloaters(f);
    this.drawPrompt(f);
    this.drawAmbientVignette(f);
    this.drawVignette(f);
    if (g.input.mode === 'keyboard') g.input.hotbarRects = [];
    const touch = g.input.mode === 'touch';
    if (g.mode === 'aventura') {
      this.advHud.drawTop(f, this.assets);
      this.zoneBox = this.advHud.topBox;
      this.advHud.drawBoss(f);
    } else this.drawZoneInfo(f);
    this.drawSky(f);
    this.drawMinimap(f, touch);
    this.drawFeed(f, touch);
    if (g.alive) {
      this.drawStatus(f, touch);
      this.drawWeaponInfo(f, touch);
      if (touch) this.drawTouch(f);
      else this.drawHotbar(f);
    } else {
      g.input.hotbarRects = [];
    }
    if (g.mode === 'aventura') {
      this.advHud.drawFallen(f);
      this.advHud.drawBanner(f);
      this.advHud.drawRelicChoice(f);
    }
    this.drawEmoteBar(f, touch);
    this.drawWarnings(f);
    this.drawBanner(f);
    this.drawDayToast(f);
    drawPvpHud(f, this.assets, f.safe.t + 66);
    this.drawIntro(f);
    this.drawSplash(f);
    if (!g.connected) this.drawOffline(f);
    if (f.mapOpen) this.drawBigMap(f);
    if (!touch && g.alive && !g.result) this.drawCrosshair(f);
  }

  // ------------------------------------------------------------------ mundo -> HUD

  private drawLabels(f: HudFrame): void {
    for (const l of f.labels) {
      const p = f.toScreen(l.x, l.y);
      if (p.x < -60 || p.y < -20 || p.x > f.w + 60 || p.y > f.h + 20) continue;
      text(
        f.ctx,
        l.text,
        Math.round(p.x),
        Math.round(p.y),
        l.kind === 'name' ? 17 : 13,
        l.color,
        'center',
      );
    }
  }

  private drawFloaters(f: HudFrame): void {
    for (const fl of f.floaters) {
      const p = f.toScreen(fl.x, fl.y);
      f.ctx.globalAlpha = Math.min(1, (fl.life / fl.max) * 2);
      const pop = fl.max - fl.life < 0.12 ? 1.3 : 1;
      text(f.ctx, fl.text, Math.round(p.x), Math.round(p.y), 22 * pop, fl.color, 'center');
    }
    f.ctx.globalAlpha = 1;
  }

  private drawPrompt(f: HudFrame): void {
    const g = f.g;
    if (!g.alive || g.loot || g.result) return;
    const box = g.nearestBox();
    if (!box) return;
    const [, x, y, kind, , top] = box;
    const title =
      kind === 0
        ? 'Cofre'
        : kind === 4
          ? 'Caja de munición'
          : kind === 1
            ? 'Cofre dorado'
            : kind === 2
              ? 'Lápida'
              : ITEM_NAMES[ITEM_KINDS[Math.floor(top / 3)] ?? 'pistol'];
    const p = f.toScreen(x, y - 14 + Math.sin(f.now / 220) * 1.5);
    const touch = g.input.mode === 'touch';
    const label = touch ? 'ABRIR' : keyLabel(g.input.keys.interact).toUpperCase();
    const ctx = f.ctx;
    ctx.font = `20px ${VT}`;
    const tw = ctx.measureText(title).width;
    const kw = touch ? 0 : 26;
    const w = tw + kw + 20;
    const px0 = Math.round(p.x - w / 2);
    const py0 = Math.round(p.y - 22);
    panel(ctx, px0, py0, w, 26, 'rgba(26,28,44,0.9)', C.black, 'rgba(255,255,255,0.12)');
    if (!touch) {
      ctx.fillStyle = C.yellow;
      ctx.fillRect(px0 + 5, py0 + 4, 18, 18);
      text(ctx, label, px0 + 14, py0 + 14, 16, C.black, 'center', VT, null);
    }
    text(ctx, title, px0 + kw + 10, py0 + 14, 20, C.white, 'left', VT, null);
  }

  /** Esquinas apenas oscuras siempre: da profundidad y centra la mirada en el gato. */
  private drawAmbientVignette(f: HudFrame): void {
    const { ctx, w, h } = f;
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.45,
      w / 2,
      h / 2,
      Math.hypot(w, h) * 0.62,
    );
    grad.addColorStop(0, 'rgba(10,12,28,0)');
    grad.addColorStop(1, 'rgba(10,12,28,0.34)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  private drawVignette(f: HudFrame): void {
    const { ctx, g, w, h } = f;
    const low = g.me && g.alive && g.me.hp <= 25 ? 0.18 + 0.12 * Math.sin(f.now / 160) : 0;
    const a = Math.max(g.hurtFlash * 0.5, low);
    if (a <= 0.01) return;
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.3,
      w / 2,
      h / 2,
      Math.hypot(w, h) * 0.55,
    );
    grad.addColorStop(0, 'rgba(177,62,83,0)');
    grad.addColorStop(1, `rgba(177,62,83,${a})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // ------------------------------------------------------------------ barras

  private drawStatus(f: HudFrame, touch: boolean): void {
    const { ctx, g, h, safe } = f;
    const me = g.me;
    if (!me) return;
    const bw = Math.min(190, Math.max(130, f.w * 0.17));
    let x = safe.l + 14;
    let y: number;
    if (touch) {
      x += 46;
      y = safe.t + 12;
    } else {
      y = h - safe.b - 92;
    }
    const bar = (
      yy: number,
      value: number,
      color: string,
      hi: string,
      icon: HTMLCanvasElement,
      label: string,
    ): void => {
      const bh = 18;
      sprite(ctx, icon, x + 10, yy + bh / 2, 22);
      const bx = x + 26;
      ctx.fillStyle = C.black;
      ctx.fillRect(bx - 2, yy - 2, bw + 4, bh + 4);
      ctx.fillStyle = '#333c57';
      ctx.fillRect(bx, yy, bw, bh);
      const fw = Math.round((bw * Math.max(0, Math.min(100, value))) / 100);
      ctx.fillStyle = color;
      ctx.fillRect(bx, yy, fw, bh);
      ctx.fillStyle = hi;
      ctx.fillRect(bx, yy, fw, 4);
      ctx.fillStyle = 'rgba(26,28,44,0.55)';
      for (let i = 1; i < 10; i++) ctx.fillRect(bx + Math.round((bw * i) / 10), yy, 1, bh);
      text(ctx, label, bx + bw / 2, yy + bh / 2 + 1, 18, C.white, 'center');
    };
    const pulse = me.healLeft > 0 && Math.floor(f.now / 200) % 2 === 0;
    const maxHp = me.maxHp ?? 100;
    const maxSh = me.maxShield ?? 100;
    bar(
      y,
      (me.hp / maxHp) * 100,
      me.hp / maxHp <= 0.25 ? '#d94a63' : '#e0566d',
      '#f4a6c0',
      this.assets.heart,
      `${Math.ceil(me.hp)}`,
    );
    bar(
      y + 26,
      (me.shield / maxSh) * 100,
      '#3b7fe0',
      '#73eff7',
      this.assets.shieldBadge,
      `${Math.ceil(me.shield)}`,
    );
    this.drawFish(f, x, y + 52, me.stamina, me.tired, bw + 26);
    if (g.mode === 'aventura') this.advHud.drawGear(f, x, touch ? y + 112 : y - 8);
    if (pulse)
      text(
        ctx,
        me.healKind === 'shield' ? '+' : '+',
        x + bw + 38,
        y + 10,
        20,
        me.healKind === 'shield' ? C.cyan : C.lime,
        'left',
      );
  }

  /** Barra de estamina en forma de pez: se vacia al correr y se llena quieto o caminando. */
  private drawFish(
    f: HudFrame,
    x: number,
    y: number,
    value: number,
    tired: boolean,
    width: number,
  ): void {
    const { ctx, now } = f;
    const fish = this.assets.fish;
    const scale = 2;
    const w = fish.full.width * scale;
    const h = fish.full.height * scale;
    const dx = Math.round(x);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fish.empty, dx - 2, y - 2, fish.empty.width * scale, fish.empty.height * scale);
    const frac = Math.max(0, Math.min(1, value / 100));
    const fw = Math.round(fish.full.width * frac);
    const low = tired || value < 20;
    const blink = low && Math.floor(now / 160) % 2 === 0;
    const src = tired || blink ? fish.tired : fish.full;
    if (fw > 0) ctx.drawImage(src, 0, 0, fw, fish.full.height, dx, y, fw * scale, h);
    void width;
    void w;
    text(
      ctx,
      tired ? '¡SIN AIRE!' : `${Math.ceil(value)}`,
      dx + 118 + 10,
      y + h / 2,
      16,
      tired ? C.orange : C.white,
      'left',
    );
  }

  // ------------------------------------------------------------------ zona y vivos

  private drawZoneInfo(f: HudFrame): void {
    const { ctx, g, w, safe } = f;
    const z = g.zone;
    const alive = g.latest?.alive ?? 0;
    let msg = '';
    let color: string = C.white;
    // el mismo aviso con el nombre de lo que cierra el mapa en cada modo
    const what = g.mode === 'techo' ? 'TORMENTA' : g.mode === 'territorio' ? 'INUNDACIÓN' : 'OLA';
    if (z) {
      if (z.phase >= 4) {
        msg = `¡LA ${what} LO CUBRE TODO!`;
        color = C.red;
      } else if (z.shrinking) {
        msg = `¡LA ${what} AVANZA!  -${z.dps}/s`;
        color = Math.floor(f.now / 350) % 2 === 0 ? C.orange : C.yellow;
      } else if (z.phase === 0) {
        msg = `LA ${what} LLEGA EN ${fmtTime(z.nextIn)}`;
      } else if (z.phase === 3) {
        msg = `¡ÚLTIMA ${what} EN ${Math.max(0, z.nextIn)}!`;
        color = Math.floor(f.now / 300) % 2 === 0 ? C.red : C.orange;
      } else {
        msg = `SEGUNDA ${what} EN ${fmtTime(z.nextIn)}`;
      }
    }
    ctx.font = `20px ${VT}`;
    const tw = Math.max(ctx.measureText(msg).width, 110);
    const pw = tw + 96;
    const x = Math.round(w / 2 - pw / 2);
    const y = safe.t + 8;
    this.zoneBox = { x, y, w: pw, h: 30 };
    panel(ctx, x, y, pw, 30);
    sprite(ctx, this.assets.paw, x + 16, y + 15, 18);
    text(ctx, String(alive), x + 32, y + 16, 22, C.yellow, 'left');
    text(ctx, msg, x + 72 + tw / 2 - 4, y + 16, 20, color, 'center', VT, null);
  }

  // ------------------------------------------------------------------ hora del dia

  /** Reloj del cielo: el sol baja, se pone y sale la luna mientras avanza la partida. */
  private drawSky(f: HudFrame): void {
    const { ctx, daylight: l } = f;
    const z = this.zoneBox;
    if (z.w === 0) return;
    const w = 58;
    const h = 30;
    const x = z.x + z.w + 10;
    const y = z.y;
    panel(ctx, x, y, w, h);
    // cielo: del azul del dia al violeta y al azul oscuro de la noche
    const sky = l.night > 0.5 ? '#1d2a5c' : l.dusk > 0.3 ? '#b8527a' : '#5fb4f0';
    const ix = x + 4;
    const iy = y + 4;
    const iw = w - 8;
    const ih = h - 8;
    ctx.fillStyle = sky;
    ctx.fillRect(ix, iy, iw, ih);
    if (l.night > 0.5) {
      ctx.fillStyle = '#f4f4f4';
      for (const [sx, sy] of [
        [6, 3],
        [19, 6],
        [31, 2],
        [40, 8],
      ] as const)
        ctx.fillRect(ix + sx, iy + sy, 1, 1);
    }
    // el astro sube y baja segun la hora
    const moon = l.p >= 0.72;
    const t = moon ? (l.p - 0.72) / 0.28 : l.p / 0.72;
    const cx = Math.round(ix + 8 + t * (iw - 16));
    const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    const cy = Math.round(iy + ih - 5 - lift * (ih - 9));
    if (moon) {
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(cx - 2, cy - 3, 5, 7);
      ctx.fillRect(cx - 3, cy - 2, 7, 5);
      ctx.fillStyle = sky;
      ctx.fillRect(cx, cy - 3, 4, 5);
      ctx.fillRect(cx + 1, cy - 4, 3, 7);
    } else {
      ctx.fillStyle = l.dusk > 0.3 ? '#ef7d57' : '#ffcd75';
      ctx.fillRect(cx - 2, cy - 3, 5, 7);
      ctx.fillRect(cx - 3, cy - 2, 7, 5);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(cx - 1, cy - 2, 2, 2);
    }
    // suelo
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(ix, iy + ih - 3, iw, 3);
  }

  /** Aviso corto cuando cambia la hora: "Atardece", "Anochece"... */
  private drawDayToast(f: HudFrame): void {
    const { ctx, dayToast: t, now, w, safe } = f;
    if (!t) return;
    const age = now - t.at;
    const dur = 4200;
    if (age > dur) return;
    const text1: Record<DayName, string> = {
      Día: '',
      Tarde: 'La tarde cae sobre el barrio',
      Atardecer: 'Atardece: el cielo se pone naranja',
      Anochecer: 'Anochece: salen los murciélagos',
      Noche: 'Noche cerrada: las luces de las casas guían',
    };
    const msg = text1[t.name];
    if (!msg) return;
    const k = Math.min(1, age / 260);
    const alpha = age > dur - 700 ? Math.max(0, (dur - age) / 700) : 1;
    ctx.font = `22px ${VT}`;
    const tw = ctx.measureText(msg).width + 36;
    const y = safe.t + 52 + Math.round((1 - k) * -10);
    ctx.globalAlpha = alpha * k;
    panel(ctx, Math.round(w / 2 - tw / 2), y, tw, 30, 'rgba(26,28,44,0.88)');
    text(
      ctx,
      msg,
      Math.round(w / 2),
      y + 16,
      22,
      f.daylight.night > 0.5 ? C.cyan : C.yellow,
      'center',
    );
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ minimapa

  private mapLayout(f: HudFrame, touch: boolean): { x: number; y: number; w: number; h: number } {
    const map = this.map as BRMap;
    const mw = Math.round(Math.min(touch ? 132 : 200, Math.max(104, f.w * (touch ? 0.14 : 0.16))));
    const mh = Math.round((mw * map.h) / map.w);
    return { x: f.w - f.safe.r - 14 - mw, y: f.safe.t + 12, w: mw, h: mh };
  }

  private drawMapInto(
    f: HudFrame,
    r: { x: number; y: number; w: number; h: number },
    big: boolean,
  ): void {
    const { ctx, g } = f;
    const map = this.map as BRMap;
    const base = this.miniBase as HTMLCanvasElement;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, r.x, r.y, r.w, r.h);
    const k = r.w / (map.w * 16);
    const z = g.zone;
    if (z) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.arc(r.x + z.cx * k, r.y + z.cy * k, Math.max(0, z.r * k), 0, Math.PI * 2, true);
      const storm = g.mode === 'techo';
      ctx.fillStyle = storm ? 'rgba(24,32,66,0.7)' : 'rgba(37,113,121,0.62)';
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.arc(r.x + z.cx * k, r.y + z.cy * k, Math.max(0, z.r * k), 0, Math.PI * 2);
      ctx.lineWidth = big ? 3 : 2;
      ctx.strokeStyle = storm ? '#aac4ff' : C.cyan;
      ctx.stroke();
      if (z.nr > 0 && z.phase < 4) {
        ctx.beginPath();
        ctx.setLineDash([big ? 8 : 4, big ? 6 : 3]);
        ctx.arc(r.x + z.nx * k, r.y + z.ny * k, z.nr * k, 0, Math.PI * 2);
        ctx.lineWidth = big ? 2 : 1;
        ctx.strokeStyle = C.white;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
    // Territorio: los patios con el color de su dueno
    const pts = map.points;
    const ps = g.pvp?.points;
    if (pts && ps) {
      pts.forEach((p, i) => {
        const [owner] = ps[i] ?? [-1];
        const mx = Math.round(r.x + p.x * k);
        const my = Math.round(r.y + p.y * k);
        const sz = big ? 12 : 8;
        ctx.fillStyle = C.black;
        ctx.fillRect(mx - sz / 2 - 1, my - sz / 2 - 1, sz + 2, sz + 2);
        ctx.fillStyle = owner >= 0 ? (TEAM_COLORS[owner as 0 | 1] as string) : '#e8ecf4';
        ctx.fillRect(mx - sz / 2, my - sz / 2, sz, sz);
        if (big) text(ctx, ['A', 'B', 'C'][i] ?? '', mx, my + 1, 15, C.black, 'center', PIX, null);
      });
    }
    if (big) {
      for (const l of map.landmarks) {
        const lx = r.x + l.x * k;
        const ly = r.y + l.y * k;
        ctx.fillStyle = l.kind === 'water' ? C.cyan : l.kind === 'bed' ? C.pink : C.yellow;
        ctx.fillRect(Math.round(lx) - 3, Math.round(ly) - 3, 7, 7);
        ctx.strokeStyle = C.black;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(lx) - 3, Math.round(ly) - 3, 7, 7);
        text(ctx, l.name, Math.round(lx), Math.round(ly) - 13, 19, C.white, 'center');
      }
    }
    const px0 = r.x + f.target.x * k;
    const py0 = r.y + f.target.y * k;
    const blink = Math.floor(f.now / 260) % 2 === 0;
    const s = big ? 9 : 6;
    ctx.fillStyle = C.black;
    ctx.fillRect(Math.round(px0 - s / 2) - 1, Math.round(py0 - s / 2) - 1, s + 2, s + 2);
    ctx.fillStyle = blink ? C.yellow : C.white;
    ctx.fillRect(Math.round(px0 - s / 2), Math.round(py0 - s / 2), s, s);
  }

  private drawMinimap(f: HudFrame, touch: boolean): void {
    if (!this.map || f.mapOpen) return;
    const r = this.mapLayout(f, touch);
    panel(f.ctx, r.x, r.y, r.w, r.h, '#1a1c2c', C.black, 'rgba(0,0,0,0)');
    this.drawMapInto(f, r, false);
  }

  private drawBigMap(f: HudFrame): void {
    const { ctx, w, h } = f;
    if (!this.map) return;
    ctx.fillStyle = 'rgba(10,12,22,0.8)';
    ctx.fillRect(0, 0, w, h);
    const map = this.map;
    const maxW = w * 0.86;
    const maxH = h * 0.78;
    const k = Math.min(maxW / map.w, maxH / map.h);
    const mw = Math.round(map.w * k);
    const mh = Math.round(map.h * k);
    const r = { x: Math.round((w - mw) / 2), y: Math.round((h - mh) / 2) + 14, w: mw, h: mh };
    panel(ctx, r.x, r.y, r.w, r.h, '#1a1c2c', C.black, 'rgba(0,0,0,0)');
    this.drawMapInto(f, r, true);
    text(ctx, 'MAPA', w / 2, r.y - 22, 14, C.yellow, 'center', PIX);
    const closeHint =
      f.g.input.mode === 'touch'
        ? 'Toca MAPA para cerrar'
        : `${keyLabel(f.g.input.keys.map)} para cerrar`;
    text(ctx, closeHint, w / 2, r.y + r.h + 24, 20, C.lgray, 'center');
  }

  // ------------------------------------------------------------------ bajas

  private drawFeed(f: HudFrame, touch: boolean): void {
    const { ctx, g, safe } = f;
    const x = safe.l + 14 + (touch ? 0 : 0);
    let y = safe.t + (touch ? 58 : 18);
    for (const line of g.feed) {
      const left = line.until - f.now;
      if (left <= 0) continue;
      ctx.globalAlpha = Math.min(1, left / 700);
      text(ctx, line.text, x, y, 20, C.white, 'left');
      y += 22;
    }
    ctx.globalAlpha = 1;
    g.feed = g.feed.filter((l) => l.until > f.now);
  }

  // ------------------------------------------------------------------ objeto en mano

  private drawWeaponInfo(f: HudFrame, touch: boolean): void {
    const { ctx, g, w, h, safe } = f;
    const me = g.me;
    if (!me || !g.alive) return;
    const item = g.selectedItem;
    const baseY = touch
      ? h * 0.9 - 24 * Math.min(1.7, Math.max(0.8, h / 390)) * g.input.touchLayout.hotbar.s - 28
      : h - safe.b - this.slotSize(f) - 34;
    let title: string;
    let detail: string;
    let color: string = C.white;
    if (!item) {
      title = 'GARRAS';
      detail = `${CLAWS.damage} de daño, rompen muros`;
    } else if (isWeapon(item.kind)) {
      const def = WEAPONS[item.kind];
      title = `${def.name.toUpperCase()} ${RARITY_NAMES[item.rarity].toUpperCase()}`;
      color = RARITY_COLORS[item.rarity] as string;
      const ammo = g.ammoOf(def.ammo);
      detail = `${def.damage[item.rarity]} dmg${def.pellets > 1 ? ' x' + def.pellets : ''}   cargador ${magOf(item)}/${def.magazine}   ${ITEM_NAMES[def.ammo]}: ${ammo}`;
    } else {
      title = ITEM_NAMES[item.kind].toUpperCase();
      const use = touch ? 'toca FUEGO' : 'clic';
      detail =
        item.kind === 'medkit'
          ? `+10 vida por segundo, ${use} para usar`
          : item.kind === 'shield'
            ? `+50 de escudo en 5 s, ${use} para usar`
            : item.kind === 'wall'
              ? `${use} para colocar`
              : `Cantidad: ${item.qty}`;
    }
    ctx.font = `20px ${VT}`;
    const tw = Math.max(ctx.measureText(title).width, ctx.measureText(detail).width) + 24;
    const x = Math.round(w / 2 - tw / 2);
    const y = Math.round(baseY - 36);
    // El aviso del objeto en mano se ve 2 segundos al cambiarlo y luego se difumina.
    const key = `${me.sel}|${item?.kind ?? ''}|${item?.rarity ?? ''}`;
    if (key !== this.infoKey) {
      this.infoKey = key;
      this.infoAt = f.now;
    }
    const age = f.now - this.infoAt;
    const fade = age < INFO_SHOW_MS ? 1 : Math.max(0, 1 - (age - INFO_SHOW_MS) / INFO_FADE_MS);
    if (fade > 0.01) {
      ctx.globalAlpha = fade;
      panel(ctx, x, y, tw, 38, 'rgba(26,28,44,0.85)', color === C.white ? C.black : color);
      text(ctx, title, w / 2, y + 12, 20, color, 'center', VT, null);
      text(ctx, detail, w / 2, y + 28, 16, C.lgray, 'center', VT, null);
      ctx.globalAlpha = 1;
    }
    if (me.healLeft > 0) {
      this.healMax = Math.max(this.healMax, me.healLeft);
      const bw = 150;
      const bx = Math.round(w / 2 - bw / 2);
      const by = y - 22;
      ctx.fillStyle = C.black;
      ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
      ctx.fillStyle = '#333c57';
      ctx.fillRect(bx, by, bw, 10);
      ctx.fillStyle = me.healKind === 'shield' ? '#3b7fe0' : C.lime;
      ctx.fillRect(bx, by, Math.round(bw * (1 - me.healLeft / this.healMax)), 10);
      text(
        ctx,
        me.healKind === 'shield' ? 'ESCUDO' : 'CURANDO',
        w / 2,
        by - 8,
        16,
        C.white,
        'center',
      );
    } else {
      this.healMax = 0;
      if (this.reloadSlot === me.sel && this.reloadFrac > 0) {
        // Barra de recarga sobre el cuadro del objeto en mano.
        const bw = 150;
        const bx = Math.round(w / 2 - bw / 2);
        const by = y - 22;
        ctx.fillStyle = C.black;
        ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
        ctx.fillStyle = '#333c57';
        ctx.fillRect(bx, by, bw, 10);
        ctx.fillStyle = C.cyan;
        ctx.fillRect(bx, by, Math.round(bw * this.reloadFrac), 10);
        text(ctx, 'RECARGANDO', w / 2, by - 8, 16, C.white, 'center');
      }
    }
  }

  // ------------------------------------------------------------------ emotes

  /** Barra con los 5 emotes: se abre con la tecla T o el boton de la carita y se elige con toque, clic o numero. */
  private drawEmoteBar(f: HudFrame, touch: boolean): void {
    const { ctx, g, w, h } = f;
    const input = g.input;
    if (!g.alive || g.result || !input.emoteOpen) {
      input.emoteRects = [];
      if (!g.alive || g.result) input.emoteOpen = false;
      return;
    }
    const faces = this.assets.emote.face;
    const k = 3;
    const cell = (faces[0]?.width ?? 15) * k + 14;
    const gap = 8;
    const total = faces.length * cell + (faces.length - 1) * gap;
    const px0 = Math.round(w / 2 - total / 2);
    const py0 = Math.round(h * (touch ? 0.56 : 0.6));
    panel(ctx, px0 - 12, py0 - 34, total + 24, cell + 52, 'rgba(26,28,44,0.92)', C.yellow);
    const hint = touch ? 'Toca un emote' : `${keyLabel(input.keys.emote)} o Esc para cerrar`;
    text(ctx, 'EMOTES', w / 2, py0 - 20, 18, C.yellow, 'center', VT, null);
    text(ctx, hint, w / 2, py0 - 6, 14, C.lgray, 'center', VT, null);
    const cooling = f.now - g.lastEmoteTime < 1500;
    input.emoteRects = [];
    faces.forEach((face, i) => {
      const x = px0 + i * (cell + gap);
      const y = py0 + 2;
      input.emoteRects.push({ x, y, w: cell, h: cell });
      ctx.globalAlpha = cooling ? 0.45 : 1;
      panel(ctx, x, y, cell, cell, 'rgba(51,60,87,0.95)', C.lgray);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(face, x + 7, y + 7, face.width * k, face.height * k);
      ctx.globalAlpha = 1;
      if (!touch)
        text(
          ctx,
          keyLabel(input.keys[`slot${i + 1}` as 'slot1']),
          x + cell / 2,
          y + cell + 12,
          16,
          C.white,
          'center',
          VT,
          null,
        );
    });
  }

  // ------------------------------------------------------------------ barra de objetos (PC)

  private slotSize(f: HudFrame): number {
    return Math.round(Math.min(58, Math.max(42, f.h * 0.085)));
  }

  /** Dibuja un objeto en un cuadro o en un circulo, con su aura si es raro. */
  drawItemCell(
    ctx: Ctx,
    item: Item | null,
    cx: number,
    cy: number,
    size: number,
    selected: boolean,
    now: number,
    shape: 'square' | 'circle',
    index: number,
  ): void {
    const half = size / 2;
    const rarityColor = item ? (RARITY_COLORS[item.rarity] as string) : null;
    const weapon = item !== null && isWeapon(item.kind);
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(cx, cy, half, 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(61,52,29,0.9)' : 'rgba(26,28,44,0.78)';
      ctx.fill();
      ctx.lineWidth = selected ? 4 : 3;
      ctx.strokeStyle = selected
        ? C.yellow
        : weapon && item && item.rarity > 0
          ? (rarityColor as string)
          : 'rgba(148,176,194,0.75)';
      ctx.stroke();
    } else {
      const x = Math.round(cx - half);
      const y = Math.round(cy - half) - (selected ? 4 : 0);
      ctx.fillStyle = selected
        ? C.yellow
        : weapon && item && item.rarity > 0
          ? (rarityColor as string)
          : C.black;
      ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
      ctx.fillStyle = selected ? '#3d341d' : 'rgba(26,28,44,0.92)';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, y, size, 2);
      cy -= selected ? 4 : 0;
    }
    if (weapon && item && item.rarity > 0) {
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(now / 220 + index);
      ctx.fillStyle = rarityColor as string;
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(cx, cy, half * 0.8, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(Math.round(cx - half) + 2, Math.round(cy - half) + 2, size - 4, size - 4);
      ctx.globalAlpha = 1;
    }
    if (item) {
      sprite(ctx, this.assets.icon[item.kind], cx, cy, size * (shape === 'circle' ? 0.74 : 0.78));
      if (weapon) {
        // Disparos que quedan en el cargador (y las balas de repuesto en el arma que llevas).
        const def = WEAPONS[item.kind as keyof typeof WEAPONS];
        const m = magOf(item);
        const low = m <= Math.max(1, Math.floor(def.magazine * 0.2));
        const color = m === 0 ? C.red : low && Math.floor(now / 250) % 2 === 0 ? C.orange : C.white;
        const fs = Math.max(14, size * 0.34);
        text(
          ctx,
          String(m),
          Math.round(cx + half - 4),
          Math.round(cy + half - 8),
          fs,
          color,
          'right',
        );
        if (selected && this.curGame) {
          const reserve = this.curGame.ammoOf(def.ammo);
          text(
            ctx,
            `+${reserve}`,
            Math.round(cx - half + 4),
            Math.round(cy + half - 8),
            Math.max(12, size * 0.26),
            reserve === 0 ? C.red : C.yellow,
            'left',
          );
        }
        if (index === this.reloadSlot) {
          // Anillo o barra de la recarga sobre la casilla del arma.
          if (shape === 'circle') {
            ctx.beginPath();
            ctx.arc(cx, cy, half + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.reloadFrac);
            ctx.lineWidth = 4;
            ctx.strokeStyle = C.cyan;
            ctx.stroke();
          } else {
            const bw = size;
            ctx.fillStyle = C.black;
            ctx.fillRect(Math.round(cx - half), Math.round(cy - half) - 12, bw, 6);
            ctx.fillStyle = C.cyan;
            ctx.fillRect(
              Math.round(cx - half) + 1,
              Math.round(cy - half) - 11,
              Math.round((bw - 2) * this.reloadFrac),
              4,
            );
          }
        }
      }
      if (item.qty > 1) {
        text(
          ctx,
          String(item.qty),
          Math.round(cx + half - 4),
          Math.round(cy + half - 8),
          Math.max(14, size * 0.34),
          C.white,
          'right',
        );
      }
    }
  }

  private drawHotbar(f: HudFrame): void {
    const { ctx, g, w, h, safe, now } = f;
    const size = this.slotSize(f);
    const gap = 8;
    const total = INVENTORY_SLOTS * size + (INVENTORY_SLOTS - 1) * gap;
    const x0 = Math.round(w / 2 - total / 2);
    const cy = h - safe.b - 12 - size / 2;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const cx = x0 + i * (size + gap) + size / 2;
      const selected = (g.me?.sel ?? 0) === i;
      this.drawItemCell(ctx, g.inv[i] ?? null, cx, cy, size, selected, now, 'square', i);
      text(
        ctx,
        String(i + 1),
        Math.round(cx - size / 2 + 5),
        Math.round(cy - size / 2 + 8) - (selected ? 4 : 0),
        15,
        selected ? C.yellow : C.lgray,
        'left',
      );
      rects.push({ x: cx - size / 2 - 3, y: cy - size / 2 - 6, w: size + 6, h: size + 9 });
    }
    g.input.hotbarRects = rects;
  }

  // ------------------------------------------------------------------ controles tactiles

  private drawTouch(f: HudFrame): void {
    const { ctx, g, w, h, now } = f;
    const input = g.input;
    const box = g.nearestBox();
    drawTouchControls(ctx, input.touchLayout, w, h, {
      stick: input.stick,
      aim: input.aimPad,
      running: g.running && g.moving,
      pressed: input.pressed,
      interactReady: box !== null && g.alive,
      bagIcon: this.assets.can,
      emoteIcon: this.assets.emote.face[0],
      emoteOpen: input.emoteOpen,
      reloadFrac: this.reloadFrac,
      ...(g.mode === 'aventura'
        ? {
            dash: {
              ready:
                g.me?.dash === undefined || g.me.dash <= 0.05 ? 1 : 1 - g.me.dash / DASH.cooldown,
            },
          }
        : {}),
      drawSlot: (c: Circle, i: number) => {
        this.drawItemCell(
          ctx,
          g.inv[i] ?? null,
          c.x,
          c.y,
          c.r * 2,
          (g.me?.sel ?? 0) === i,
          now,
          'circle',
          i,
        );
      },
    });
  }

  // ------------------------------------------------------------------ avisos

  private drawWarnings(f: HudFrame): void {
    const { ctx, g, w, safe } = f;
    if (!g.alive || g.result) {
      if (!g.alive && !g.result) {
        const spec = g.latest?.spectating;
        const name = spec !== undefined ? (g.cats.get(spec)?.name ?? '') : '';
        if (name)
          text(
            ctx,
            `OBSERVANDO A ${name.toUpperCase()}`,
            w / 2,
            safe.t + 84,
            22,
            C.white,
            'center',
          );
      }
      return;
    }
    const z = g.zone;
    let msg = '';
    let color: string = C.red;
    if (z && z.phase > 0 && Math.hypot(g.x - z.cx, g.y - z.cy) > z.r) {
      msg = `¡ESTÁS EN LA OLA!  -${z.dps}/s`;
    } else if (g.map && isWaterAtPx(g.map, g.x, g.y + 2)) {
      msg = `¡AGUA!  -${WATER.damage}`;
      color = C.sky;
    }
    if (msg && Math.floor(f.now / 300) % 2 === 0)
      text(ctx, msg, w / 2, safe.t + 84, 24, color, 'center');
  }

  private drawBanner(f: HudFrame): void {
    const { ctx, g, w, h } = f;
    const b = g.banner;
    if (!b) return;
    const left = b.until - f.now;
    if (left <= 0) {
      g.banner = null;
      return;
    }
    const a = Math.min(1, left / 400);
    ctx.globalAlpha = a;
    const color = b.tone === 'good' ? C.lime : b.tone === 'bad' ? C.orange : C.white;
    ctx.font = `15px ${PIX}`;
    const tw = ctx.measureText(b.text).width + 36;
    const y = Math.round(h * (g.input.mode === 'touch' ? 0.34 : 0.24));
    panel(ctx, Math.round(w / 2 - tw / 2), y - 20, tw, 40, 'rgba(26,28,44,0.88)', C.black);
    text(ctx, b.text, w / 2, y + 1, 15, color, 'center', PIX, null);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ inicio de la partida

  /** Cuenta regresiva con todos quietos: oscurece el mapa, pulsa cada segundo y da consejos. */
  private drawIntro(f: HudFrame): void {
    const { ctx, g, w, h, now } = f;
    const left = g.intro;
    if (left <= 0) return;
    const n = Math.max(1, Math.ceil(left - 0.001));
    const frac = Math.min(1, Math.max(0, n - left));
    const cx = w / 2;
    // El numero va arriba para que se vea al gato y a los demas esperando en el centro.
    const cy = h * 0.27;
    const unit = Math.min(w, h);

    ctx.fillStyle = 'rgba(10,12,24,0.3)';
    ctx.fillRect(0, 0, w, h);
    const vignette = ctx.createRadialGradient(
      cx,
      h * 0.5,
      unit * 0.25,
      cx,
      h * 0.5,
      Math.hypot(w, h) * 0.55,
    );
    vignette.addColorStop(0, 'rgba(10,12,24,0)');
    vignette.addColorStop(1, 'rgba(10,12,24,0.72)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    const color = n >= 4 ? C.white : n === 3 ? C.yellow : n === 2 ? C.orange : C.red;
    // onda que se abre desde el numero cada segundo
    ctx.globalAlpha = (1 - frac) * 0.7;
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, unit * (0.1 + frac * 0.36), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const pop = 1 + Math.max(0, 0.5 - frac * 1.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    text(ctx, String(n), 0, 0, Math.round(unit * 0.22), color, 'center', PIX, C.black);
    ctx.restore();

    text(
      ctx,
      '¡A PREPARARSE!',
      cx,
      h * 0.07,
      Math.round(Math.min(34, Math.max(16, w * 0.035))),
      C.yellow,
      'center',
      PIX,
    );
    const tips = [
      'Sé el último gato en cuatro patas',
      'Busca cofres y cajas de munición',
      g.input.mode === 'touch'
        ? 'Recarga con el botón de recarga'
        : `Recarga con ${keyLabel(g.input.keys.reload).toUpperCase()}`,
      'A los 30 segundos la ola empieza a cerrarse',
      'Corre al círculo seguro cuando avise la ola',
    ];
    const tip = tips[(5 - n + Math.floor(now / 5000)) % tips.length] as string;
    text(
      ctx,
      tip,
      cx,
      h * 0.74,
      Math.round(Math.min(30, Math.max(20, w * 0.03))),
      C.white,
      'center',
      VT,
    );
  }

  /** Cartel grande de "A jugar" al terminar la cuenta: entra con un golpe, cambia de color y se va. */
  private drawSplash(f: HudFrame): void {
    const { ctx, g, w, h, now } = f;
    const sp = g.splash;
    if (!sp) return;
    const age = now - sp.at;
    const dur = 3800;
    if (age > dur) {
      g.splash = null;
      return;
    }
    const k = Math.min(1, age / 240);
    const ease = 1 - (1 - k) ** 3;
    const alpha = age > dur - 600 ? Math.max(0, (dur - age) / 600) : 1;
    const unit = Math.min(w, h);
    const cx = w / 2;
    const cy = h * 0.2;

    // destello blanco al arrancar
    if (age < 320) {
      ctx.globalAlpha = (1 - age / 320) * 0.5;
      ctx.fillStyle = C.white;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = alpha;
    // franja con rayas de colores detras del titulo
    const band = Math.round(unit * 0.27);
    const palette = [C.yellow, C.orange, C.pink, C.cyan];
    ctx.fillStyle = 'rgba(26,28,44,0.88)';
    ctx.fillRect(0, Math.round(cy - band / 2), w, band);
    const stripe = palette[Math.floor(now / 140) % palette.length] as string;
    ctx.fillStyle = stripe;
    ctx.fillRect(0, Math.round(cy - band / 2) - 4, w, 4);
    ctx.fillRect(0, Math.round(cy + band / 2), w, 4);

    const size = Math.round(Math.min(78, Math.max(28, w * 0.075)));
    const scale = 1 + (1 - ease) * 2.4;
    ctx.save();
    ctx.translate(
      cx + (age < 400 ? Math.sin(age / 18) * (1 - age / 400) * 6 : 0),
      cy - band * 0.12,
    );
    ctx.scale(scale, scale);
    const headline = g.splashText || '¡A JUGAR!';
    text(ctx, headline, 4, 5, size, C.black, 'center', PIX, null);
    text(
      ctx,
      headline,
      0,
      0,
      size,
      palette[Math.floor(now / 110) % palette.length] as string,
      'center',
      PIX,
      C.black,
    );
    ctx.restore();

    const sub = Math.round(Math.min(26, Math.max(15, w * 0.02)));
    const teamMode = g.pvp !== null;
    text(
      ctx,
      teamMode ? 'Quien junte dos rondas' : 'Abre cofres y cajas de munición',
      cx,
      cy + band * 0.2,
      sub,
      C.white,
      'center',
      PIX,
      C.black,
    );
    text(
      ctx,
      teamMode ? 'gana la partida' : 'y sé el último gato en cuatro patas',
      cx,
      cy + band * 0.2 + sub * 1.7,
      sub,
      C.lime,
      'center',
      PIX,
      C.black,
    );

    // chispas girando alrededor del titulo
    for (let i = 0; i < 10; i++) {
      const a = now / 600 + (i / 10) * Math.PI * 2;
      const rx = Math.min(w * 0.36, 360);
      const x = cx + Math.cos(a) * rx * (0.8 + 0.2 * Math.sin(now / 300 + i));
      const y = cy + Math.sin(a * 1.3) * band * 0.55;
      ctx.fillStyle = palette[i % palette.length] as string;
      const r = 3 + ((now / 120 + i) % 3);
      ctx.fillRect(Math.round(x - r), Math.round(y - 1), r * 2, 2);
      ctx.fillRect(Math.round(x - 1), Math.round(y - r), 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawOffline(f: HudFrame): void {
    const { ctx, w, h } = f;
    const msg = 'Sin conexión, reconectando...';
    ctx.font = `14px ${PIX}`;
    const tw = ctx.measureText(msg).width + 40;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(f.now / 250);
    panel(
      ctx,
      Math.round(w / 2 - tw / 2),
      Math.round(h * 0.4),
      tw,
      44,
      'rgba(177,62,83,0.92)',
      C.black,
    );
    text(ctx, msg, w / 2, Math.round(h * 0.4) + 23, 14, C.white, 'center', PIX, null);
    ctx.globalAlpha = 1;
  }

  private drawCrosshair(f: HudFrame): void {
    const m = f.g.input.mouse;
    if (!m) return;
    const { ctx } = f;
    const c = Math.sin(f.now / 200) * 0.5;
    for (const [dx, dy, ww, hh] of [
      [-12, -1.5, 7, 3],
      [5, -1.5, 7, 3],
      [-1.5, -12, 3, 7],
      [-1.5, 5, 3, 7],
    ] as const) {
      ctx.fillStyle = C.black;
      ctx.fillRect(Math.round(m.x + dx - 1 - c), Math.round(m.y + dy - 1), ww + 2, hh + 2);
    }
    ctx.fillStyle = C.white;
    for (const [dx, dy, ww, hh] of [
      [-12, -1.5, 7, 3],
      [5, -1.5, 7, 3],
      [-1.5, -12, 3, 7],
      [-1.5, 5, 3, 7],
    ] as const) {
      ctx.fillRect(Math.round(m.x + dx - c), Math.round(m.y + dy), ww, hh);
    }
  }
}
