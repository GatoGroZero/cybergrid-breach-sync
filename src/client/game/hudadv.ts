import {
  ARMOR_NAMES,
  DASH,
  MOB,
  POWERS,
  RELICS,
  mobDef,
  powerCooldown,
} from '../../shared/br/adventure';
import { RARITY_COLORS } from '../../shared/br/items';
import type { Assets } from '../pixel/art';
import { armorIcon, potionIcon, powerIcon, relicIcon } from '../pixel/art-items';
import { C } from '../pixel/draw';
import { hudPrefs, withScale } from './hudprefs';
import { keyLabel } from './input';
import { PIX, VT, panel, sprite, text, type HudFrame } from './hud';
import type { ClientBR } from './state';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** La fuente de los titulos no tiene letras con acento: se escriben sin ellas. */
const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const ROOM_LABEL: Record<string, string> = {
  inicio: 'CLARO DE INICIO',
  combate: 'COMBATE',
  tesoro: 'TESORO',
  descanso: 'DESCANSO',
  minijefe: 'MINIJEFE',
  jefe: 'JEFE FINAL',
};

const relicIcons = new Map<number, HTMLCanvasElement>();
const relicIconOf = (id: number): HTMLCanvasElement => {
  let c = relicIcons.get(id);
  if (!c) {
    c = relicIcon(id);
    relicIcons.set(id, c);
  }
  return c;
};

const powerIcons = new Map<number, HTMLCanvasElement>();
const powerIconOf = (id: number): HTMLCanvasElement => {
  let c = powerIcons.get(id);
  if (!c) {
    c = powerIcon(id);
    powerIcons.set(id, c);
  }
  return c;
};

const armorIcons = new Map<string, HTMLCanvasElement>();
const armorIconOf = (slot: number, tier: number): HTMLCanvasElement => {
  const kind = (['armor_head', 'armor_body', 'armor_paws'] as const)[slot] ?? 'armor_head';
  const key = `${kind}:${tier}`;
  let c = armorIcons.get(key);
  if (!c) {
    c = armorIcon(kind, tier);
    armorIcons.set(key, c);
  }
  return c;
};

let potionCache: { catnip: HTMLCanvasElement; valerian: HTMLCanvasElement } | null = null;
const potionIcons = (): { catnip: HTMLCanvasElement; valerian: HTMLCanvasElement } => {
  potionCache ??= {
    catnip: potionIcon('potion_catnip'),
    valerian: potionIcon('potion_valerian'),
  };
  return potionCache;
};

/** Texto en varias lineas dentro de un ancho; devuelve cuantas lineas dibujo. */
function wrap(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
  size: number,
  color: string,
): number {
  ctx.font = `${size}px ${VT}`;
  const words = s.split(' ');
  let line = '';
  let n = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      text(ctx, line, x, y + n * lh, size, color, 'center');
      n++;
      line = word;
    } else line = test;
  }
  if (line) {
    text(ctx, line, x, y + n * lh, size, color, 'center');
    n++;
  }
  return n;
}

/** Donde termina (en px) la linea de FPS y ping del HTML: nada del HUD de lienzo debe quedar debajo de ella. */
export const STATS_BOTTOM = 68;

/** Pedazos del HUD que solo existen en la Aventura. */
export class AdvHud {
  /** El mayor tiempo de espera de la voltereta que se ha visto (para llenar el circulo). */
  private dashMax: number = DASH.cooldown;
  /** Donde termina el panel de arriba, para colgarle el reloj del cielo y la barra del jefe. */
  topBox = { x: 0, y: 0, w: 0, h: 30 };
  /** Hasta donde llega la barra del jefe en este cuadro (0 si no hay jefe): los carteles se acomodan debajo. */
  bossBottom = 0;

  /** Panel superior: vidas del grupo, nombre y avance de la sala, y el camino por el bosque. */
  drawTop(f: HudFrame, assets: Assets): void {
    const { ctx, g, w, h, safe } = f;
    const adv = g.adv;
    if (!adv) return;
    // en pantallas chicas (celulares) solo cabe lo esencial
    const compact = w < 900 || g.input.mode === 'touch';
    const tight = h < 480;
    let msg: string;
    if (adv.roomKind === 'combate')
      msg =
        adv.states[adv.room] === 2
          ? 'SALA SUPERADA'
          : adv.waves > 0
            ? `OLEADA ${Math.min(adv.wave + (adv.states[adv.room] === 1 ? 1 : 0), adv.waves)}/${adv.waves}`
            : 'COMBATE';
    else if (adv.roomKind === 'minijefe' || adv.roomKind === 'jefe')
      msg = adv.states[adv.room] === 2 ? 'JEFE DERROTADO' : (ROOM_LABEL[adv.roomKind] as string);
    else msg = ROOM_LABEL[adv.roomKind] ?? '';
    const name = compact ? msg : `${adv.roomName}  -  ${msg}`;
    ctx.font = `20px ${VT}`;
    const tw = Math.max(ctx.measureText(name).width, 110);
    const pw = tw + 100;
    const x = Math.round(w / 2 - pw / 2);
    const y = safe.t + 8;
    this.topBox = { x, y, w: pw, h: 30 };
    panel(ctx, x, y, pw, 30);
    // vidas del grupo
    const low = adv.lives <= 1;
    sprite(ctx, assets.heart, x + 17, y + 15, 20);
    text(
      ctx,
      `x${adv.lives}`,
      x + 32,
      y + 16,
      22,
      low && Math.floor(f.now / 300) % 2 === 0 ? C.red : C.yellow,
      'left',
    );
    text(ctx, name, x + 76 + tw / 2 - 6, y + 16, 20, C.white, 'center', VT, null);

    if (tight) return;
    // camino por el bosque: un cuadrito por sala
    const n = adv.rooms;
    const pip = clamp(Math.floor((Math.min(w - 40, 420) - (n - 1) * 3) / n), 5, 10);
    const total = n * pip + (n - 1) * 3;
    const px0 = Math.round(w / 2 - total / 2);
    const py0 = y + 38;
    ctx.fillStyle = 'rgba(26,28,44,0.7)';
    ctx.fillRect(px0 - 3, py0 - 3, total + 6, pip + 6);
    for (let i = 0; i < n; i++) {
      const st = adv.states[i] ?? 0;
      const kind = g.map.rooms?.[i]?.kind;
      const bossRoom = kind === 'minijefe' || kind === 'jefe';
      const x1 = px0 + i * (pip + 3);
      const here = i === adv.room;
      ctx.fillStyle = st === 2 ? '#38b764' : bossRoom ? '#7a2c4d' : '#333c57';
      ctx.fillRect(x1, py0, pip, pip);
      if (bossRoom) {
        ctx.fillStyle = st === 2 ? '#a7f070' : '#ff4d6e';
        ctx.fillRect(x1 + 1, py0 + 1, pip - 2, pip - 2);
      }
      if (here) {
        ctx.strokeStyle = Math.floor(f.now / 260) % 2 === 0 ? C.yellow : C.white;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1 - 1, py0 - 1, pip + 2, pip + 2);
      }
    }
    this.topBox.h = 30 + pip + 14;
  }

  /** Barra de vida del jefe en pantalla, con sus fases. */
  drawBoss(f: HudFrame, topBottom: number): void {
    const { ctx, g, w } = f;
    this.bossBottom = 0;
    const boss = g.adv?.boss;
    if (!boss) return;
    const def = mobDef(boss.kind);
    // chica y pegada arriba: en el celular casi no estorba (el nombre y una barrita)
    const small = g.input.mode === 'touch' || f.h < 520;
    const bw = small ? clamp(w * 0.34, 150, 260) : clamp(w * 0.4, 220, 380);
    const x = Math.round(w / 2 - bw / 2);
    // por debajo de la linea de FPS y ping (que va en el HTML, a 46 px del borde)
    const y = Math.max(topBottom + (small ? 8 : 12), STATS_BOTTOM + 4);
    const fs = small ? 13 : 15;
    const bh = small ? 5 : 7;
    const k = hudPrefs.boss;
    this.bossBottom = y + (fs + bh + 6) * k;
    withScale(ctx, w / 2, y, k, () => {
      ctx.globalAlpha = 0.9;
      panel(ctx, x - 5, y - 4, bw + 10, fs + bh + 9, 'rgba(26,28,44,0.7)');
      ctx.globalAlpha = 1;
      text(ctx, def.name.toUpperCase(), w / 2, y + fs / 2, fs, C.white, 'center', VT);
      ctx.fillStyle = '#4a1c2c';
      ctx.fillRect(x, y + fs + 1, bw, bh);
      const fw = Math.round((bw * clamp(boss.hp, 0, 100)) / 100);
      const phase = boss.phase;
      ctx.fillStyle = phase >= 3 ? '#b794f4' : phase === 2 ? '#ef7d57' : '#e0566d';
      ctx.fillRect(x, y + fs + 1, fw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, y + fs + 1, fw, 2);
      // marcas donde cambia de fase
      ctx.fillStyle = C.black;
      const cuts = boss.kind === MOB.reyGato ? [33, 66] : [50];
      for (const c of cuts) ctx.fillRect(x + Math.round((bw * c) / 100) - 1, y + fs, 2, bh + 2);
      if (phase >= 2 && !small)
        text(
          ctx,
          phase >= 3 ? 'FASE FINAL' : 'ENFURECIDO',
          x + bw,
          y + fs / 2,
          13,
          phase >= 3 ? '#b794f4' : C.orange,
          'right',
          VT,
        );
    });
  }

  /** Reliquias, armadura, pociones y el cooldown de la voltereta. Devuelve la altura que ocupo. */
  drawGear(f: HudFrame, x0: number, bottom: number): void {
    const { ctx, g, now } = f;
    const adv = g.adv;
    const me = g.me;
    if (!adv || !me) return;
    // armadura: tres casillas
    const cell = 26;
    let x = x0;
    const y = bottom - cell;
    for (let slot = 0; slot < 3; slot++) {
      const tier = adv.equip[slot as 0 | 1 | 2];
      panel(
        ctx,
        x,
        y,
        cell,
        cell,
        'rgba(26,28,44,0.8)',
        tier >= 0 ? (RARITY_COLORS[tier] as string) : C.black,
      );
      if (tier >= 0) sprite(ctx, armorIconOf(slot, tier), x + cell / 2, y + cell / 2, 22);
      else {
        ctx.globalAlpha = 0.28;
        sprite(ctx, armorIconOf(slot, 0), x + cell / 2, y + cell / 2, 20);
        ctx.globalAlpha = 1;
      }
      x += cell + 4;
    }
    // voltereta
    if (g.input.mode === 'keyboard') {
      const cx = x + 14;
      const cy = y + cell / 2;
      if (me.dash !== undefined) this.dashMax = Math.max(this.dashMax, me.dash);
      const ready = me.dash === undefined || me.dash <= 0.05 ? 1 : 1 - me.dash / this.dashMax;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = ready >= 1 ? 'rgba(115,239,247,0.22)' : 'rgba(26,28,44,0.8)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.black;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
      ctx.lineWidth = 3;
      ctx.strokeStyle = ready >= 1 ? C.cyan : '#566c86';
      ctx.stroke();
      text(ctx, keyLabel(g.input.keys.dash).toUpperCase(), cx, cy + 1, 15, C.white, 'center', VT);
      x += 34;
    }
    // pociones activas
    const [rage, swift] = adv.buffs;
    for (const [secs, icon] of [
      [rage, potionIcons().catnip],
      [swift, potionIcons().valerian],
    ] as const) {
      if (secs <= 0) continue;
      sprite(ctx, icon, x + 10, y + cell / 2, 22);
      text(
        ctx,
        `${secs}`,
        x + 24,
        y + cell / 2 + 1,
        18,
        secs <= 3 && Math.floor(now / 250) % 2 ? C.red : C.white,
        'left',
      );
      x += 46;
    }
    // reliquias: se apilan las repetidas
    if (adv.relics.length > 0) {
      const counts = new Map<number, number>();
      for (const id of adv.relics) counts.set(id, (counts.get(id) ?? 0) + 1);
      let rx = x0;
      let ry = y - 28;
      const size = 24;
      for (const [id, n] of counts) {
        if (rx + size > x0 + 8 * (size + 2)) {
          rx = x0;
          ry -= size + 2;
        }
        panel(ctx, rx, ry, size, size, 'rgba(26,28,44,0.8)', '#8a6a2a');
        sprite(ctx, relicIconOf(id), rx + size / 2, ry + size / 2, 20);
        if (n > 1) text(ctx, `x${n}`, rx + size - 1, ry + size - 5, 14, C.yellow, 'right');
        rx += size + 4;
      }
    }
  }

  /** Estado de cada habilidad para dibujarla (en PC y en los botones tactiles). */
  powerStates(
    g: ClientBR,
  ): { icon: HTMLCanvasElement; ready: number; active: boolean; level: number }[] {
    return (g.adv?.powers ?? []).map(([id, level, cd, act]) => {
      const def = POWERS[id];
      const total = def ? powerCooldown(def, level) : 1;
      return {
        icon: powerIconOf(id),
        ready: cd <= 0 ? 1 : clamp(1 - cd / total, 0, 1),
        active: act > 0,
        level,
      };
    });
  }

  /** Barra de habilidades de PC: una casilla por habilidad con su tecla y su espera. */
  drawPowerBar(f: HudFrame, bottom: number, left?: number): void {
    const { ctx, g, w, now } = f;
    const list = this.powerStates(g);
    if (list.length === 0) return;
    const size = 40;
    const gap = 8;
    const total = list.length * size + (list.length - 1) * gap;
    const x0 = left ?? Math.round(w / 2 - total / 2);
    const keys = [g.input.keys.power1, g.input.keys.power2, g.input.keys.power3];
    list.forEach((p, i) => {
      const x = x0 + i * (size + gap);
      const y = bottom - size;
      const ready = p.ready >= 1;
      panel(
        ctx,
        x,
        y,
        size,
        size,
        ready ? 'rgba(41,54,111,0.92)' : 'rgba(26,28,44,0.9)',
        p.active ? C.yellow : ready ? C.cyan : C.black,
      );
      ctx.globalAlpha = ready ? 1 : 0.45;
      sprite(ctx, p.icon, x + size / 2, y + size / 2 - 1, size - 10);
      ctx.globalAlpha = 1;
      if (!ready) {
        // la espera se ve como una cortina que baja
        ctx.fillStyle = 'rgba(10,12,24,0.55)';
        ctx.fillRect(x, y, size, Math.round(size * (1 - p.ready)));
      } else if (Math.floor(now / 500) % 2 === 0) {
        ctx.fillStyle = 'rgba(115,239,247,0.18)';
        ctx.fillRect(x, y, size, size);
      }
      text(ctx, keyLabel(keys[i] ?? '').toUpperCase(), x + 5, y + 7, 14, C.yellow, 'left');
      if (p.level > 1)
        text(ctx, '*'.repeat(p.level - 1), x + size - 3, y + size - 6, 14, C.yellow, 'right');
    });
  }

  /** Eleccion de reliquia o de habilidad: tres tarjetas. Se toca, se hace clic o se pulsa 1, 2 o 3. */
  drawRelicChoice(f: HudFrame): void {
    const { ctx, g, w, h, now } = f;
    const relics = g.adv?.choice ?? null;
    const powers = relics ? null : (g.adv?.pchoice ?? null);
    const choice = relics ?? powers;
    if (!choice || !g.alive) {
      if (g.input.kitRects.length > 0 && g.mode === 'aventura') g.input.kitRects = [];
      return;
    }
    const compact = h < 560;
    ctx.fillStyle = 'rgba(10,12,24,0.72)';
    ctx.fillRect(0, 0, w, h);
    const title = Math.round(clamp(w * 0.026, 12, 22));
    const top = compact ? f.safe.t + 62 : Math.max(h * 0.16, f.safe.t + 84);
    text(
      ctx,
      powers ? 'ELIGE UNA HABILIDAD' : 'ELIGE UNA RELIQUIA',
      w / 2,
      top,
      title,
      C.yellow,
      'center',
      PIX,
    );
    text(
      ctx,
      powers
        ? 'Un premio del jefe: úsala con su tecla o botón'
        : 'Te acompaña toda la aventura y se puede repetir',
      w / 2,
      top + title * 1.7,
      compact ? 16 : 20,
      C.lgray,
      'center',
      VT,
    );
    const gap = Math.round(clamp(w * 0.015, 8, 20));
    const cardW = Math.round(clamp((w - gap * 4) / 3, 120, 220));
    const cardH = compact ? 126 : Math.round(clamp(h * 0.42, 200, 260));
    const y0 = Math.round(top + title * 1.7 + (compact ? 18 : 36));
    const total = cardW * 3 + gap * 2;
    const x0 = Math.round(w / 2 - total / 2);
    g.input.kitRects = [];
    choice.forEach((id, i) => {
      const relic = powers ? null : RELICS[id];
      const power = powers ? POWERS[id] : null;
      const name = relic?.name ?? power?.name;
      const desc = relic?.desc ?? power?.desc;
      if (!name || !desc) return;
      const x = x0 + i * (cardW + gap);
      g.input.kitRects.push({ x, y: y0, w: cardW, h: cardH });
      const bob = Math.round(Math.sin(now / 420 + i) * 2);
      panel(ctx, x, y0 + bob, cardW, cardH, 'rgba(41,54,111,0.94)', powers ? '#2a8aa8' : '#8a6a2a');
      const k = compact ? 40 : 64;
      const icon = powers ? powerIconOf(id) : relicIconOf(id);
      sprite(ctx, icon, x + cardW / 2, y0 + bob + (compact ? 30 : 52), k);
      const nameY = y0 + bob + (compact ? 62 : 104);
      text(
        ctx,
        plain(name).toUpperCase(),
        x + cardW / 2,
        nameY,
        compact ? 10 : 12,
        C.white,
        'center',
        PIX,
      );
      wrap(
        ctx,
        desc,
        x + cardW / 2,
        nameY + (compact ? 18 : 28),
        cardW - 16,
        compact ? 15 : 19,
        compact ? 16 : 20,
        C.lgray,
      );
      let note = '';
      if (relic) {
        const owned = g.adv?.relics.filter((r) => r === id).length ?? 0;
        if (owned > 0) note = `Ya tienes ${owned}`;
      } else if (power) {
        const own = g.adv?.powers.find((p) => p[0] === id);
        note = own ? `Nivel ${own[1]} a ${own[1] + 1}` : `Nueva, espera ${power.cooldown} s`;
      }
      if (note)
        text(ctx, note, x + cardW / 2, y0 + bob + cardH - 30, compact ? 14 : 17, C.cyan, 'center');
      if (g.input.mode === 'keyboard')
        text(
          ctx,
          String(i + 1),
          x + cardW / 2,
          y0 + bob + cardH - 12,
          compact ? 14 : 18,
          C.yellow,
          'center',
          PIX,
        );
    });
  }

  /** Caiste: cuenta para levantarte (o aviso de que ya no quedan vidas). */
  drawFallen(f: HudFrame): void {
    const { ctx, g, w, h, now } = f;
    const adv = g.adv;
    if (!adv || g.alive || g.result) return;
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
    grad.addColorStop(0, 'rgba(120,20,40,0)');
    grad.addColorStop(1, 'rgba(120,20,40,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const y = Math.round(h * 0.34);
    if (adv.fallen < 0) {
      text(ctx, 'CAISTE', w / 2, y, Math.round(clamp(w * 0.03, 16, 30)), C.red, 'center', PIX);
      text(
        ctx,
        'Vuelves al terminar la sala',
        w / 2,
        y + 38,
        Math.round(clamp(w * 0.04, 20, 30)),
        C.white,
        'center',
        VT,
      );
      text(ctx, 'Mira a tus compañeros mientras pelean', w / 2, y + 66, 20, C.lgray, 'center', VT);
    } else if (adv.fallen > 0) {
      text(ctx, 'CAISTE', w / 2, y, Math.round(clamp(w * 0.03, 16, 30)), C.red, 'center', PIX);
      text(
        ctx,
        `Te levantas en ${adv.fallen}`,
        w / 2,
        y + 38,
        Math.round(clamp(w * 0.04, 22, 34)),
        C.white,
        'center',
        VT,
      );
      text(ctx, `Vidas del grupo: ${adv.lives}`, w / 2, y + 68, 22, C.yellow, 'center', VT);
    } else {
      text(
        ctx,
        'SIN VIDAS',
        w / 2,
        y,
        Math.round(clamp(w * 0.03, 16, 30)),
        Math.floor(now / 400) % 2 ? C.red : C.orange,
        'center',
        PIX,
      );
      text(ctx, 'Mira a tus compañeros mientras pelean', w / 2, y + 38, 22, C.white, 'center', VT);
    }
  }

  /** Cartel grande al entrar a una sala o al superarla. */
  drawBanner(f: HudFrame): void {
    const { ctx, g, w, h, now } = f;
    const b = g.advBanner;
    if (!b) return;
    const age = now - b.at;
    // un aviso breve: alcanza para leerlo y se quita de en medio
    const life = b.tone === 'good' ? 1500 : 1800;
    if (age > life) return;
    const a = age < 200 ? age / 200 : age > life - 400 ? (life - age) / 400 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    const small = g.input.mode === 'touch' || h < 520;
    const size = Math.round(clamp(w * 0.016, 10, 15));
    // si hay barra de jefe, el cartel baja debajo de ella para no taparla
    const k = hudPrefs.msg;
    const y = Math.max(Math.round(h * (small ? 0.27 : 0.24)), this.bossBottom + (size + 8) * k);
    const col = b.tone === 'bad' ? C.red : b.tone === 'good' ? C.lime : C.yellow;
    withScale(ctx, w / 2, y, k, () => {
      text(ctx, plain(b.title), w / 2, y, size, col, 'center', PIX);
      if (b.sub) {
        const sub = Math.round(clamp(w * 0.017, 15, 20));
        text(ctx, b.sub, w / 2, y + size * 1.7, sub, C.white, 'center', VT);
      }
    });
    ctx.globalAlpha = 1;
  }

  /** Nombre de la armadura de una casilla (para pistas). */
  static armorName(slot: number, tier: number): string {
    const key = (['head', 'body', 'paws'] as const)[slot] ?? 'head';
    return ARMOR_NAMES[key][Math.min(2, Math.max(0, tier))] as string;
  }
}
