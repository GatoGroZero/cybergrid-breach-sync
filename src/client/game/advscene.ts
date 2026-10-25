import {
  HAZARD,
  HOSTILE_SHOT,
  MOB_FLAG,
  POWERS,
  mobDef,
  powerEffect,
  type MobDef,
} from '../../shared/br/adventure';
import { ITEM_KINDS } from '../../shared/br/items';
import { TILE } from '../../shared/br/constants';
import type { BREvent } from '../../shared/br/types';
import type { Sfx } from '../audio';
import { spatial } from '../audio';
import { vineGateTile } from '../pixel/art-bosque';
import { flashed, flippedOf, hostileShotSprite, mobSprite } from '../pixel/art-mobs';
import { pickupSprite } from '../pixel/art-items';
import { C, ell, make, type Ctx } from '../pixel/draw';
import type { Fx } from './fx';
import { MOB_EVENT, MobAnimator } from './mobanim';
import type { ClientBR, MobView } from './state';

/** Habilidades con efecto continuo en el gato (el resto es una explosion unica). */
const AURA_IDS: ReadonlySet<number> = new Set([0, 1, 4, 7]);

const T = TILE;
const DEG = Math.PI / 180;

interface Tele {
  x: number;
  y: number;
  r: number;
  shape: 0 | 1;
  a: number;
  len: number;
  start: number;
  dur: number;
}

interface Drawable {
  y: number;
  draw: () => void;
}

/** Colores de las particulas cuando cae cada enemigo. */
const DEATH_COLORS: Record<number, string[]> = {
  0: ['#8a7f91', '#b9afc2', '#f0a6b4'],
  1: ['#5d4a7a', '#a695c4', '#ffd25e'],
  2: ['#a0693e', '#7a4a28', '#f4f4f4'],
  3: ['#7e57c2', '#a98be6', '#ffe28a'],
  4: ['#6b4bb0', '#3b2a5c', '#ff4d5e'],
  5: ['#ef7d57', '#f4e6d2', '#3a2a30'],
  6: ['#7c869e', '#a2aec6', '#73eff7'],
  10: ['#8a7f91', '#ffcd75', '#7b3a7b'],
  11: ['#8791a8', '#e6ebf5', '#73c9ff'],
  12: ['#b13e66', '#fff0f4', '#d6ffb0'],
  13: ['#7a4a28', '#566c86', '#ff7a3a'],
  14: ['#9cc7ff', '#e6f6ff', '#4a86d8'],
  15: ['#241c3d', '#6b4bb0', '#e08cff'],
  20: ['#2a2147', '#e08cff', '#3d2f66'],
  21: ['#bfe9ff', '#e6f6ff', '#6fa8e8'],
};

/** Colores de la luz de cada jefe (aura del suelo). */
const BOSS_AURA: Record<number, string> = {
  10: '#ffcd75',
  11: '#73c9ff',
  12: '#ff7ab6',
  13: '#ff7a3a',
  14: '#73b3ff',
  15: '#b794f4',
};

/**
 * Lo que la Aventura agrega al mundo: enemigos, jefes, zonas de peligro, avisos, botin del suelo y
 * puertas de enredadera. El renderizador general le pasa el contexto y esta pieza dibuja lo suyo.
 */
export class AdvScene {
  private readonly teles: Tele[] = [];
  private readonly gateAt = new Map<number, number>();
  private readonly moved = new Map<number, { x: number; y: number; at: number }>();
  private readonly anim = new MobAnimator();
  private meX = 0;
  private meY = 0;
  private readonly gates = [0, 1, 2, 3].map(vineGateTile);

  constructor(
    private readonly fx: Fx,
    private readonly sfx: Sfx,
    private readonly hooks: {
      light: (x: number, y: number, r: number, color: string, life: number) => void;
      /** Icono de un objeto del inventario (para el botin del suelo). */
      icon: (kind: string) => HTMLCanvasElement | undefined;
      shake: (n: number) => void;
      say: (text: string, tone: 'info' | 'good' | 'bad', ms?: number) => void;
    },
  ) {}

  // ------------------------------------------------------------------ eventos

  onEvent(ev: BREvent, g: ClientBR, now: number): void {
    const near = (x: number, y: number, hear: number): { v: number; pan: number } =>
      spatial(x - g.x, y - g.y, hear);
    switch (ev.e) {
      case 'tele': {
        this.teles.push({
          x: ev.x,
          y: ev.y,
          r: ev.r,
          shape: ev.shape,
          a: (ev.a ?? 0) * DEG,
          len: ev.len ?? 0,
          start: now,
          dur: ev.t * 1000,
        });
        if (this.teles.length > 60) this.teles.shift();
        const s = near(ev.x, ev.y, 260);
        if (s.v > 0.1) this.sfx.telegraph(s.v, s.pan, ev.shape === 1);
        break;
      }
      case 'mobdie': {
        const cols = DEATH_COLORS[ev.kind] ?? DEATH_COLORS[0]!;
        const big = ev.boss;
        this.fx.burst(ev.x, ev.y - 3, big ? 46 : 12, {
          colors: cols,
          speed: big ? 120 : 62,
          life: big ? 0.9 : 0.5,
          grav: 70,
          size: big ? 2 : 1,
        });
        this.fx.ring(ev.x, ev.y, big ? 46 : 12, cols[1] as string, big ? 0.7 : 0.35);
        if (big) {
          this.fx.ring(ev.x, ev.y, 28, '#ffffff', 0.5);
          for (let i = 0; i < 14; i++)
            this.fx.star(
              ev.x + (Math.random() - 0.5) * 40,
              ev.y - Math.random() * 24,
              cols[i % cols.length] as string,
              0.9,
              -26,
            );
          this.hooks.light(ev.x, ev.y, 90, cols[1] as string, 0.9);
          this.hooks.shake(5);
        }
        const s = near(ev.x, ev.y, big ? 600 : 300);
        if (s.v > 0.06) this.sfx.mobDie(ev.kind, big, Math.max(0.3, s.v), s.pan);
        break;
      }
      case 'boss': {
        const def = mobDef(ev.kind);
        if (ev.phase <= 1) this.hooks.say(`¡${def.name}!`, 'bad', 2000);
        else this.hooks.say(`${def.name} se enfurece`, 'bad', 1800);
        this.sfx.bossRoar(ev.kind, ev.phase);
        this.hooks.shake(4);
        break;
      }
      case 'gate': {
        const room = g.map.rooms?.findIndex((r) =>
          r.gates.some((t) => t.x * T === ev.x && t.y * T === ev.y),
        );
        if (room !== undefined && room >= 0) {
          this.gateAt.set(room, now);
          const def = g.map.rooms?.[room];
          if (def)
            for (const t of def.gates)
              this.fx.burst(t.x * T + 8, t.y * T + 8, 3, {
                colors: ['#43995a', '#6cc477', '#2f6b3f'],
                speed: 26,
                life: 0.6,
                grav: 40,
              });
        }
        const s = near(ev.x, ev.y, 520);
        if (s.v > 0.05) this.sfx.gate(ev.open, Math.max(0.3, s.v), s.pan);
        break;
      }
      case 'pickup': {
        const cols: Record<number, string> = {
          0: '#ff7ab6',
          1: '#ffd25e',
          2: '#73eff7',
          3: '#ffcd75',
        };
        const col = cols[ev.kind] ?? '#ffffff';
        for (let i = 0; i < 4; i++)
          this.fx.star(
            ev.x + (Math.random() - 0.5) * 8,
            ev.y - 3 - Math.random() * 6,
            col,
            0.5,
            -20,
          );
        const s = near(ev.x, ev.y, 160);
        if (s.v > 0.1) this.sfx.pickupAdv(ev.kind);
        break;
      }
      case 'heal2': {
        for (let i = 0; i < 6; i++)
          this.fx.star(
            ev.x + (Math.random() - 0.5) * 12,
            ev.y - Math.random() * 10,
            i % 2 ? '#a7f070' : '#ffffff',
            0.7,
            -24,
          );
        this.fx.ring(ev.x, ev.y, 12, '#a7f070', 0.5);
        const s = near(ev.x, ev.y, 200);
        if (s.v > 0.1) this.sfx.potion();
        break;
      }
      case 'revive': {
        this.fx.ring(ev.x, ev.y, 22, '#ffd25e', 0.7);
        this.fx.ring(ev.x, ev.y, 14, '#ffffff', 0.5);
        for (let i = 0; i < 12; i++)
          this.fx.star(
            ev.x + (Math.random() - 0.5) * 20,
            ev.y - Math.random() * 18,
            i % 2 ? '#ffd25e' : '#ffffff',
            0.9,
            -28,
          );
        this.hooks.light(ev.x, ev.y, 50, '#ffd25e', 0.8);
        if (ev.id === g.you) this.hooks.say('¡Siete vidas! Vuelves a la pelea', 'good', 1800);
        const s = near(ev.x, ev.y, 400);
        if (s.v > 0.05) this.sfx.revive(Math.max(0.3, s.v), s.pan);
        break;
      }
      case 'dash': {
        const a = ev.a * DEG;
        for (let i = 0; i < 7; i++)
          this.fx.add({
            x: ev.x - Math.cos(a) * i * 5,
            y: ev.y - Math.sin(a) * i * 4,
            vx: 0,
            vy: 0,
            life: 0.32 - i * 0.02,
            max: 0.32,
            color: i % 2 ? '#c9fbff' : '#73eff7',
            size: 3,
            grav: 0,
            kind: 0,
            r: 0,
          });
        const s = near(ev.x, ev.y, 260);
        if (s.v > 0.1) this.sfx.dash(Math.max(0.3, s.v), s.pan);
        break;
      }
      case 'power': {
        this.power(ev, g);
        break;
      }
      case 'relic': {
        for (let i = 0; i < 12; i++)
          this.fx.star(
            ev.x + (Math.random() - 0.5) * 22,
            ev.y - Math.random() * 20,
            i % 3 === 0 ? '#ffffff' : '#ffcd75',
            0.9,
            -22,
          );
        this.fx.ring(ev.x, ev.y, 18, '#ffcd75', 0.6);
        this.hooks.light(ev.x, ev.y, 40, '#ffcd75', 0.6);
        if (near(ev.x, ev.y, 240).v > 0.1) this.sfx.relic();
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ suelo

  /** Charcos, ondas, fuego y los avisos que se llenan antes de un ataque. */
  drawGround(b: Ctx, g: ClientBR, camX: number, camY: number, now: number): void {
    // avisos
    for (let i = this.teles.length - 1; i >= 0; i--) {
      const t = this.teles[i] as Tele;
      const k = (now - t.start) / Math.max(1, t.dur);
      if (k > 1.15) {
        this.teles.splice(i, 1);
        continue;
      }
      this.drawTele(b, t, Math.min(1, k), camX, camY, now);
    }
    for (const h of g.hazards) {
      const [id, x, y, r, kind, prog] = h;
      const sx = x - camX;
      const sy = y - camY;
      if (sx < -r - 8 || sy < -r - 8 || sx > this.viewW(b) + r + 8 || sy > this.viewH(b) + r + 8)
        continue;
      switch (kind) {
        case HAZARD.charco: {
          const fade = prog > 80 ? (100 - prog) / 20 : 1;
          b.globalAlpha = 0.55 * fade;
          ell(b, sx, sy, r, r * 0.86, '#17331f');
          b.globalAlpha = 0.7 * fade;
          ell(b, sx, sy, r * 0.86, r * 0.72, '#4f8a2e');
          ell(b, sx - r * 0.2, sy - r * 0.2, r * 0.4, r * 0.28, '#8fd64a');
          b.globalAlpha = fade;
          for (let k = 0; k < 4; k++) {
            const ph = (now / 520 + k * 0.26 + id * 0.13) % 1;
            const bx = sx + Math.sin(k * 2.3 + id) * r * 0.55;
            const by = sy + Math.cos(k * 1.7 + id) * r * 0.4 - ph * 6;
            b.fillStyle = '#d6ffb0';
            b.fillRect(Math.round(bx), Math.round(by), 1, 1);
          }
          b.globalAlpha = 1;
          break;
        }
        case HAZARD.onda: {
          const a = Math.max(0.25, 1 - prog / 110);
          b.globalAlpha = a;
          b.strokeStyle = '#e6f6ff';
          b.lineWidth = 3;
          b.beginPath();
          b.arc(sx, sy, r, 0, Math.PI * 2);
          b.stroke();
          b.strokeStyle = '#73c9ff';
          b.lineWidth = 1;
          b.beginPath();
          b.arc(sx, sy, Math.max(1, r - 3), 0, Math.PI * 2);
          b.stroke();
          b.globalAlpha = 1;
          break;
        }
        case HAZARD.aviso: {
          this.drawCircleWarn(b, sx, sy, r, prog / 100, now);
          break;
        }
        case HAZARD.fuego: {
          const fade = prog > 85 ? (100 - prog) / 15 : 1;
          b.globalAlpha = 0.5 * fade;
          ell(b, sx, sy + 1, r, r * 0.82, '#3a1408');
          b.globalAlpha = 0.65 * fade;
          ell(b, sx, sy, r * 0.82, r * 0.66, '#d9461f');
          b.globalAlpha = fade;
          for (let k = 0; k < 7; k++) {
            const ang = k * 0.9 + id;
            const fx = sx + Math.cos(ang) * r * 0.6 * ((k % 3) / 3 + 0.35);
            const fy = sy + Math.sin(ang) * r * 0.5 * ((k % 3) / 3 + 0.35);
            const fl = 3 + ((now / 90 + k * 3) % 4);
            b.fillStyle = '#ff9a3a';
            b.fillRect(Math.round(fx), Math.round(fy - fl), 2, Math.round(fl));
            b.fillStyle = '#fff2a8';
            b.fillRect(Math.round(fx), Math.round(fy - fl * 0.5), 1, Math.round(fl * 0.5));
          }
          b.globalAlpha = 1;
          break;
        }
        case HAZARD.espora: {
          const fade = prog > 85 ? (100 - prog) / 15 : 1;
          b.globalAlpha = 0.28 * fade;
          ell(b, sx, sy, r, r * 0.82, '#2f8f4a');
          b.globalAlpha = 0.4 * fade;
          ell(b, sx, sy, r * 0.8, r * 0.64, '#7be08a');
          b.globalAlpha = fade;
          b.strokeStyle = '#d6ffb0';
          b.lineWidth = 1;
          b.setLineDash([2, 3]);
          b.beginPath();
          b.arc(sx, sy, r * 0.96, 0, Math.PI * 2);
          b.stroke();
          b.setLineDash([]);
          for (let k = 0; k < 9; k++) {
            const ph = (now / 900 + k * 0.11 + id * 0.07) % 1;
            const bx = sx + Math.sin(k * 2.1 + id) * r * 0.75;
            const by = sy + Math.cos(k * 1.3 + id) * r * 0.5 - ph * 14;
            b.fillStyle = k % 2 ? '#e6ffd8' : '#a7f070';
            b.globalAlpha = (1 - ph) * fade;
            b.fillRect(Math.round(bx), Math.round(by), 2, 2);
          }
          b.globalAlpha = 1;
          break;
        }
        case HAZARD.sombra: {
          const fade = prog > 80 ? (100 - prog) / 20 : 1;
          b.globalAlpha = 0.72 * fade;
          ell(b, sx, sy, r, r * 0.84, '#120d24');
          b.globalAlpha = 0.9 * fade;
          ell(b, sx, sy, r * 0.7, r * 0.56, '#2a2147');
          b.fillStyle = '#e08cff';
          b.fillRect(Math.round(sx - r * 0.3), Math.round(sy - 1), 2, 2);
          b.fillRect(Math.round(sx + r * 0.2), Math.round(sy - 1), 2, 2);
          b.globalAlpha = 1;
          break;
        }
        default:
          break;
      }
    }
  }

  private viewW(b: Ctx): number {
    return b.canvas.width;
  }

  private viewH(b: Ctx): number {
    return b.canvas.height;
  }

  private drawCircleWarn(b: Ctx, x: number, y: number, r: number, k: number, now: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    b.globalAlpha = 0.18 + 0.1 * pulse;
    b.fillStyle = '#ff2a3a';
    b.beginPath();
    b.arc(x, y, r, 0, Math.PI * 2);
    b.fill();
    // se va llenando hasta el borde: cuando llega, golpea
    b.globalAlpha = 0.35 + 0.2 * pulse;
    b.beginPath();
    b.arc(x, y, Math.max(1, r * k), 0, Math.PI * 2);
    b.fill();
    b.globalAlpha = 0.9;
    b.strokeStyle = '#ff6a6a';
    b.lineWidth = 1;
    b.setLineDash([3, 3]);
    b.beginPath();
    b.arc(x, y, r, 0, Math.PI * 2);
    b.stroke();
    b.setLineDash([]);
    b.globalAlpha = 1;
  }

  private drawTele(b: Ctx, t: Tele, k: number, camX: number, camY: number, now: number): void {
    const x = t.x - camX;
    const y = t.y - camY;
    if (t.shape === 0) {
      this.drawCircleWarn(b, x, y, t.r, k, now);
      return;
    }
    // franja de embestida: del origen hacia delante, con flechas que corren
    const pulse = 0.5 + 0.5 * Math.sin(now / 80);
    b.save();
    b.translate(x, y);
    b.rotate(t.a);
    b.globalAlpha = 0.2 + 0.1 * pulse;
    b.fillStyle = '#ff2a3a';
    b.fillRect(0, -t.r, t.len, t.r * 2);
    b.globalAlpha = 0.4 + 0.2 * pulse;
    b.fillRect(0, -t.r, t.len * k, t.r * 2);
    b.globalAlpha = 0.9;
    b.fillStyle = '#ff9a9a';
    b.fillRect(0, -t.r, t.len, 1);
    b.fillRect(0, t.r - 1, t.len, 1);
    for (let d = (now / 14) % 16; d < t.len; d += 16) {
      b.fillRect(Math.round(d), -2, 1, 5);
      b.fillRect(Math.round(d) + 1, -1, 1, 3);
      b.fillRect(Math.round(d) + 2, 0, 1, 1);
    }
    b.restore();
    b.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ cosas con altura

  collect(
    list: Drawable[],
    b: Ctx,
    g: ClientBR,
    mobs: Map<number, MobView>,
    camX: number,
    camY: number,
    now: number,
  ): void {
    const vw = b.canvas.width;
    const vh = b.canvas.height;
    const seen = new Set<number>();
    this.meX = g.x;
    this.meY = g.y;
    this.anim.beginFrame();
    for (const m of mobs.values()) {
      if (m.x < camX - 60 || m.y < camY - 60 || m.x > camX + vw + 60 || m.y > camY + vh + 60)
        continue;
      seen.add(m.id);
      this.pushMob(list, b, m, camX, camY, now);
    }
    this.anim.endFrame();
    for (const id of this.moved.keys())
      if (!seen.has(id) && this.moved.size > 120) this.moved.delete(id);
    // botin del suelo
    for (const [id, x, y, kind, code] of g.pickups) {
      if (x < camX - 12 || y < camY - 12 || x > camX + vw + 12 || y > camY + vh + 12) continue;
      const bob = Math.round(Math.sin(now / 260 + id) * 1.5);
      const spr = this.pickupArt(kind, code, Math.floor(now / 240 + id) % 2);
      const rarity = kind === 4 && code !== undefined ? code % 3 : 0;
      list.push({
        y: y + 2,
        draw: () => {
          b.globalAlpha = 0.35 + 0.15 * Math.sin(now / 200 + id);
          ell(
            b,
            x - camX,
            y - camY + 3,
            kind === 4 ? 8 : 6,
            2.4,
            kind === 0
              ? '#ff7ab6'
              : rarity === 2
                ? '#b55bf0'
                : rarity === 1
                  ? '#38b764'
                  : '#ffd25e',
          );
          b.globalAlpha = 1;
          b.drawImage(
            spr,
            Math.round(x - camX - spr.width / 2),
            Math.round(y - camY - spr.height + 5 + bob),
          );
        },
      });
    }
    // puertas de enredadera
    const rooms = g.map.rooms ?? [];
    for (const i of g.closedRooms) {
      const def = rooms[i];
      if (!def) continue;
      const since = this.gateAt.get(i);
      const grow = since === undefined ? 1 : Math.min(1, (now - since) / 520);
      for (const t of def.gates) {
        const gx = t.x * T;
        const gy = t.y * T;
        if (gx < camX - 20 || gy < camY - 30 || gx > camX + vw + 20 || gy > camY + vh + 30)
          continue;
        const spr = this.gates[(t.x + t.y) & 3] as HTMLCanvasElement;
        list.push({
          y: gy + T,
          draw: () => {
            const h = Math.max(2, Math.round(spr.height * grow));
            b.drawImage(
              spr,
              0,
              spr.height - h,
              spr.width,
              h,
              gx - camX - 1,
              gy + T - spr.height + 2 + (spr.height - h) - camY,
              spr.width,
              h,
            );
          },
        });
      }
    }
  }

  private pushMob(
    list: Drawable[],
    b: Ctx,
    m: MobView,
    camX: number,
    camY: number,
    now: number,
  ): void {
    const def = mobDef(m.kind);
    const sp = mobSprite(m.kind);
    // anima mientras se mueve; los que no caminan respiran despacio
    const last = this.moved.get(m.id);
    const moving = last !== undefined && Math.hypot(m.x - last.x, m.y - last.y) > 0.12;
    this.moved.set(m.id, { x: m.x, y: m.y, at: moving ? now : (last?.at ?? 0) });
    const walking = moving || (last !== undefined && now - last.at < 160);
    const period = walking ? (m.flags & MOB_FLAG.dashing ? 80 : 170) : 480;
    const frame = Math.floor(now / period + m.id) % 2;
    let spr = sp.frames[frame] as HTMLCanvasElement;
    const left = Math.cos(m.ang) < 0;
    if (sp.sided && left) spr = flippedOf(spr);
    const hurt = (m.flags & MOB_FLAG.hurt) !== 0;
    const windup = (m.flags & MOB_FLAG.windup) !== 0;
    const pose = this.anim.pose(m, def, now, walking);
    if (pose.events !== 0) this.mobEvents(m, def, pose.events);
    const shake = windup && (def.boss || def.size >= 20) ? Math.round(Math.sin(now / 28) * 1) : 0;
    // el dibujo se estira o aplasta desde los pies, centrado en el cuerpo
    const dw = Math.max(2, Math.round(spr.width * pose.sx));
    const dh = Math.max(2, Math.round(spr.height * pose.sy));
    const x = Math.round(m.x - dw / 2 + pose.offX) + shake;
    const y = Math.round(m.y + def.half + 3 - dh + pose.offY);
    const sortY = m.y + def.half;
    const boss = (m.flags & MOB_FLAG.boss) !== 0;
    const put = (img: HTMLCanvasElement, ox = 0, oy = 0): void =>
      b.drawImage(img, 0, 0, img.width, img.height, x - camX + ox, y - camY + oy, dw, dh);
    list.push({
      y: sortY,
      draw: () => {
        if (pose.lift > 0.6) {
          // sombra en el suelo: mas chica y clara cuanto mas arriba
          b.globalAlpha = Math.max(0.12, 0.3 - pose.lift * 0.025);
          ell(
            b,
            m.x - camX,
            m.y + def.half + 2 - camY,
            Math.max(3, def.size * 0.32 - pose.lift * 0.4),
            Math.max(1.4, def.size * 0.1),
            C.black,
          );
          b.globalAlpha = 1;
        }
        if (boss) {
          // aura que late en el suelo; mas intensa en las fases dificiles
          const col = BOSS_AURA[m.kind] ?? '#ffffff';
          const phase =
            (m.flags & MOB_FLAG.phase3) !== 0 ? 3 : (m.flags & MOB_FLAG.phase2) !== 0 ? 2 : 1;
          b.globalAlpha = 0.16 + 0.07 * phase + 0.07 * Math.sin(now / (260 - phase * 50));
          ell(b, m.x - camX, m.y - camY + def.half, def.size * 0.8, def.size * 0.34, col);
          b.globalAlpha = 1;
          if (phase >= 2 && Math.random() < 0.25 * phase)
            this.fx.star(
              m.x + (Math.random() - 0.5) * def.size,
              m.y - Math.random() * def.size,
              col,
              0.5,
              -18,
            );
        }
        if ((m.flags & MOB_FLAG.dashing) !== 0) {
          // estela de velocidad: dos imagenes desvanecidas detras
          for (let k = 1; k <= 2; k++) {
            b.globalAlpha = 0.28 / k;
            put(spr, -Math.round(Math.cos(m.ang) * 6 * k), -Math.round(Math.sin(m.ang) * 3 * k));
          }
          b.globalAlpha = 1;
        }
        put(hurt ? flashed(spr) : spr);
        if (windup && !hurt) {
          // se tiñe de rojo y parpadea: viene un golpe
          b.globalAlpha = 0.28 + 0.2 * Math.sin(now / 45);
          put(flashed(spr, '#ff2a3a'));
          b.globalAlpha = 1;
          b.fillStyle = '#ff4d5e';
          const ex = Math.round(m.x - camX);
          const ey = y - camY - 6;
          b.fillRect(ex - 1, ey, 2, 4);
          b.fillRect(ex - 1, ey + 5, 2, 2);
        }
        if ((m.flags & MOB_FLAG.stunned) !== 0) {
          for (let k = 0; k < 3; k++) {
            const a = now / 160 + (k * Math.PI * 2) / 3;
            b.fillStyle = C.yellow;
            b.fillRect(
              Math.round(m.x - camX + Math.cos(a) * 7),
              Math.round(y - camY - 2 + Math.sin(a) * 2),
              2,
              2,
            );
          }
        }
        if ((m.flags & MOB_FLAG.shielded) !== 0) {
          b.globalAlpha = 0.3 + 0.15 * Math.sin(now / 110);
          b.strokeStyle = '#73eff7';
          b.lineWidth = 2;
          b.beginPath();
          b.arc(m.x - camX, m.y - camY - def.size * 0.3, def.size * 0.72, 0, Math.PI * 2);
          b.stroke();
          b.globalAlpha = 1;
        }
        if (!boss && m.hp < 100) {
          // barrita de vida de los enemigos comunes
          const w = Math.max(10, Math.round(def.size * 0.9));
          const bx = Math.round(m.x - camX - w / 2);
          const by = y - camY - 3;
          b.fillStyle = 'rgba(26,28,44,0.85)';
          b.fillRect(bx - 1, by - 1, w + 2, 4);
          b.fillStyle = '#5d2a3a';
          b.fillRect(bx, by, w, 2);
          b.fillStyle = m.hp > 50 ? '#7be08a' : m.hp > 25 ? C.yellow : C.red;
          b.fillRect(bx, by, Math.max(1, Math.round((w * m.hp) / 100)), 2);
        }
      },
    });
  }

  /** Polvo, chispas y soplidos que acompanan lo que hace un enemigo (aparecer, ser golpeado, atacar, pisar). */
  private mobEvents(m: MobView, def: MobDef, ev: number): void {
    const fx = this.fx;
    const colors = DEATH_COLORS[m.kind] ?? (DEATH_COLORS[0] as string[]);
    const feetY = m.y + def.half + 2;
    const dust = ['#6b5240', '#8a6f55', '#c9b48c'];
    if ((ev & MOB_EVENT.spawn) !== 0) {
      fx.burst(m.x, feetY, def.boss ? 18 : 7, {
        colors: dust,
        speed: 38,
        life: 0.5,
        grav: 60,
        angle: -Math.PI / 2,
        spread: 2.2,
      });
      fx.ring(m.x, feetY, def.size * 0.5, '#c9b48c', 0.4);
    }
    if ((ev & MOB_EVENT.hit) !== 0) {
      fx.burst(m.x, m.y - def.size * 0.3, 3, {
        colors: ['#ffffff', colors[2] as string],
        speed: 45,
        life: 0.25,
        grav: 40,
      });
    }
    if ((ev & MOB_EVENT.lunge) !== 0) {
      const a = m.ang;
      fx.burst(m.x + Math.cos(a) * def.half, m.y + Math.sin(a) * def.half * 0.5, def.boss ? 9 : 5, {
        colors,
        speed: 70,
        life: 0.3,
        angle: a,
        spread: 0.7,
        size: def.boss ? 2 : 1,
      });
      if (def.boss || def.behavior === 'charger' || def.behavior === 'brute')
        fx.ring(m.x, feetY, def.size * 0.45, colors[1] as string, 0.3);
    }
    if ((ev & MOB_EVENT.stomp) !== 0) {
      fx.burst(m.x, feetY, def.boss ? 6 : 4, {
        colors: dust,
        speed: 26,
        life: 0.4,
        grav: -8,
        angle: -Math.PI / 2,
        spread: 2.6,
      });
      if (Math.hypot(m.x - this.meX, m.y - this.meY) < 150) this.hooks.shake(def.boss ? 1.6 : 1);
    }
  }

  private readonly itemArt = new Map<string, HTMLCanvasElement>();

  /** Dibujo de un objeto tirado: los objetos sueltos (armas, curas) usan su icono del inventario. */
  private pickupArt(kind: number, code: number | undefined, frame: number): HTMLCanvasElement {
    if (kind !== 4 || code === undefined) return pickupSprite(kind, frame);
    const name = ITEM_KINDS[Math.floor(code / 3)] ?? 'medkit';
    const key = `${name}:${code % 3}`;
    let art = this.itemArt.get(key);
    if (!art) {
      const icon = this.hooks.icon(name);
      if (!icon) return pickupSprite(2, frame);
      const [cv, c] = make(icon.width, icon.height);
      c.drawImage(icon, 0, 0);
      art = cv;
      this.itemArt.set(key, art);
    }
    return art;
  }

  /** Efecto de una habilidad al usarse (lo ven todos los gatos cercanos). */
  private power(ev: Extract<BREvent, { e: 'power' }>, g: ClientBR): void {
    const fx = this.fx;
    const { x, y } = ev;
    const sets: Record<number, { colors: string[]; ring: string; light: string; r: number }> = {
      0: { colors: ['#ef7d57', '#ffcd75', '#ffffff'], ring: '#ef7d57', light: '#ffb347', r: 26 },
      1: { colors: ['#ffd25e', '#fff2a8', '#ffffff'], ring: '#ffd25e', light: '#ffe08a', r: 34 },
      2: { colors: ['#7be08a', '#d6ffb0', '#a7f070'], ring: '#7be08a', light: '#7be08a', r: 60 },
      3: { colors: ['#ffcd75', '#b13e53', '#f4f4f4'], ring: '#ffcd75', light: '#ff7a3a', r: 82 },
      4: { colors: ['#bfe9ff', '#73eff7', '#ffffff'], ring: '#73eff7', light: '#73eff7', r: 30 },
      5: { colors: ['#ffcd75', '#ef7d57', '#d9461f'], ring: '#ff7a3a', light: '#ff9a3a', r: 105 },
      6: { colors: ['#73c9ff', '#c9e6ff', '#ffffff'], ring: '#41a6f6', light: '#73c9ff', r: 50 },
      7: { colors: ['#b794f4', '#e0c9ff', '#ffffff'], ring: '#b794f4', light: '#b794f4', r: 150 },
    };
    const set = sets[ev.id] ?? (sets[0] as NonNullable<(typeof sets)[number]>);
    fx.ring(x, y, set.r * 0.45, set.ring, 0.45);
    fx.ring(x, y, set.r * 0.8, set.colors[1] as string, 0.7);
    fx.ring(x, y, set.r, set.colors[0] as string, 0.9);
    fx.burst(x, y - 4, 22 + ev.lvl * 4, {
      colors: set.colors,
      speed: ev.id === 5 || ev.id === 3 ? 140 : 70,
      life: 0.7,
      size: 2,
      grav: ev.id === 2 || ev.id === 4 ? -30 : 20,
    });
    for (let i = 0; i < 10; i++)
      fx.star(
        x + (Math.random() - 0.5) * 24,
        y - 4 - Math.random() * 18,
        set.colors[i % set.colors.length] as string,
        0.9,
        -24,
      );
    this.hooks.light(x, y, set.r * 1.6, set.light, 0.7);
    if (ev.id === 3 || ev.id === 5) this.hooks.shake(ev.id === 5 ? 4 : 3);
    const s = spatial(x - g.x, y - g.y, 420);
    if (s.v > 0.05) this.sfx.power(ev.id, Math.max(0.35, s.v), s.pan);
    if (AURA_IDS.has(ev.id)) {
      const dur = (POWERS[ev.id]?.duration ?? 0) * powerEffect(ev.lvl);
      if (dur > 0) this.auras.set(ev.who, { id: ev.id, until: performance.now() + dur * 1000 });
    }
    if (ev.who === g.you) this.hooks.say(`${POWERS[ev.id]?.name ?? 'Habilidad'}`, 'good', 1100);
  }

  /** Quien tiene una habilidad con duracion activa y hasta cuando (lo ven todos los gatos cercanos). */
  private readonly auras = new Map<number, { id: number; until: number }>();

  /** Efecto visible mientras una habilidad sigue activa: llamas, mirada dorada, estela espectral o maullido. */
  drawAuras(
    b: Ctx,
    g: ClientBR,
    cats: Map<number, { x: number; y: number }>,
    camX: number,
    camY: number,
    now: number,
  ): void {
    const active: { x: number; y: number; id: number }[] = [];
    if (g.alive) {
      for (const [id, , , act] of g.adv?.powers ?? [])
        if (act > 0 && AURA_IDS.has(id)) active.push({ x: g.drawX, y: g.drawY, id });
    }
    for (const [who, a] of this.auras) {
      if (a.until <= now) {
        this.auras.delete(who);
        continue;
      }
      if (who === g.you) continue;
      const cat = cats.get(who);
      if (cat) active.push({ x: cat.x, y: cat.y, id: a.id });
    }
    for (const a of active) this.aura(b, a.x, a.y, a.id, camX, camY, now);
  }

  private aura(
    b: Ctx,
    wx: number,
    wy: number,
    id: number,
    camX: number,
    camY: number,
    now: number,
  ): void {
    const x = Math.round(wx - camX);
    const y = Math.round(wy - camY);
    if (id === 0) {
      // furia felina: llamitas que bailan en los pies y el aire caliente sube
      b.globalAlpha = 0.3 + 0.15 * Math.sin(now / 80);
      ell(b, x, y + 5, 13, 5, '#ef7d57');
      b.globalAlpha = 1;
      for (let i = 0; i < 6; i++) {
        const fx0 = x - 10 + i * 4;
        const hgt = 3 + Math.round((Math.sin(now / 65 + i * 2.1) + 1) * 3);
        b.fillStyle = i % 2 ? '#ffcd75' : '#ef7d57';
        b.fillRect(fx0, y + 6 - hgt, 2, hgt);
        b.fillStyle = '#ffe9a8';
        b.fillRect(fx0, y + 6 - hgt, 1, 1);
      }
      if (Math.random() < 0.35)
        this.fx.burst(wx + (Math.random() - 0.5) * 14, wy + 2, 1, {
          colors: ['#ffcd75', '#ef7d57'],
          speed: 16,
          life: 0.5,
          grav: -50,
          angle: -Math.PI / 2,
          spread: 0.8,
        });
    } else if (id === 1) {
      // mirada de buho: un aro dorado y destellos que giran alrededor de la cabeza
      b.globalAlpha = 0.25 + 0.12 * Math.sin(now / 120);
      ell(b, x, y + 5, 13, 5, '#ffd25e');
      b.globalAlpha = 1;
      for (let k = 0; k < 3; k++) {
        const a = now / 260 + (k * Math.PI * 2) / 3;
        const px = Math.round(x + Math.cos(a) * 10);
        const py = Math.round(y - 12 + Math.sin(a) * 3);
        b.fillStyle = '#fff2a8';
        b.fillRect(px, py - 1, 1, 3);
        b.fillRect(px - 1, py, 3, 1);
      }
    } else if (id === 4) {
      // paso espectral: estela celeste y un velo que lo hace ver intocable
      b.globalAlpha = 0.28 + 0.12 * Math.sin(now / 100);
      ell(b, x, y - 2, 11, 12, '#73eff7');
      b.globalAlpha = 1;
      if (Math.random() < 0.7)
        this.fx.burst(wx + (Math.random() - 0.5) * 12, wy + (Math.random() - 0.5) * 12, 1, {
          colors: ['#73eff7', '#bfe9ff', '#ffffff'],
          speed: 10,
          life: 0.4,
          grav: -26,
          size: 2,
        });
    } else if (id === 7) {
      // maullido hipnotico: ondas que se alejan y notas que suben
      for (let k = 0; k < 2; k++) {
        const t = ((now + k * 450) % 900) / 900;
        b.globalAlpha = (1 - t) * 0.7;
        b.strokeStyle = '#e0a8ff';
        b.lineWidth = 1;
        b.beginPath();
        b.ellipse(x, y + 2, 6 + t * 40, 3 + t * 22, 0, 0, Math.PI * 2);
        b.stroke();
      }
      b.globalAlpha = 1;
      for (let k = 0; k < 2; k++) {
        const t = (now / 1000 + k * 0.5) % 1;
        const nx = Math.round(x + (k ? 9 : -9) + Math.sin(t * 6) * 3);
        const ny = Math.round(y - 8 - t * 22);
        b.globalAlpha = 1 - t;
        b.fillStyle = '#f4d9ff';
        b.fillRect(nx, ny + 4, 3, 2);
        b.fillRect(nx + 2, ny, 1, 5);
        b.fillRect(nx + 3, ny, 2, 1);
        b.fillRect(nx + 4, ny + 1, 1, 1);
      }
      b.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ balas enemigas

  /** Dibuja una bala enemiga (el renderizador general se la deja a esta pieza). */
  drawHostileShot(b: Ctx, x: number, y: number, kind: number, ang: number, now: number): void {
    const spr = hostileShotSprite(kind);
    b.save();
    b.translate(Math.round(x), Math.round(y));
    if (kind === HOSTILE_SHOT.espora || kind === HOSTILE_SHOT.orbe || kind === HOSTILE_SHOT.fuego) {
      b.globalAlpha = 0.28 + 0.12 * Math.sin(now / 90 + x);
      const glow =
        kind === HOSTILE_SHOT.espora
          ? '#7be08a'
          : kind === HOSTILE_SHOT.fuego
            ? '#ff9a3a'
            : '#b794f4';
      ell(b, 0, 0, 8, 8, glow);
      b.globalAlpha = 1;
    }
    if (kind === HOSTILE_SHOT.espora || kind === HOSTILE_SHOT.orbe) {
      b.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    } else {
      b.rotate(ang);
      b.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    }
    b.restore();
  }
}
