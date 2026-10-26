// Jugador automatico de la Aventura: sirve para medir el equilibrio y para pruebas de regresion.
// Juega con las mismas reglas que una persona (manda entradas, abre cofres, elige reliquias).
import { WEAPONS, isWeapon, magOf, type WeaponKind } from '../src/shared/br/items';
import { TILE } from '../src/shared/br/constants';
import { dist, hasLineOfSight } from '../src/shared/br/physics';
import { createRng, type Rng } from '../src/shared/rng';
import { AdventureGame } from '../src/server/br/AdventureGame';
import { findPath } from '../src/server/br/bots';
import type { Cat } from '../src/server/br/Game';
import type { Mob } from '../src/server/br/mobs';

const PREFERRED: WeaponKind[] = ['rifle', 'shotgun', 'sniper', 'pistol', 'bazooka'];
/** Reliquias en orden de preferencia: supervivencia primero. */
const RELIC_ORDER = [10, 5, 6, 0, 3, 13, 8, 2, 4, 11, 9, 7, 1, 12];
/** Habilidades en orden de preferencia. */
const POWER_ORDER = [1, 0, 3, 5, 6, 2, 7, 4];

interface Tele {
  x: number;
  y: number;
  r: number;
  until: number;
  /** angulo (rad) y largo si el aviso es una franja de embestida */
  a?: number;
  len?: number;
}

/** Punto mas cercano de un segmento a un punto. */
function nearestOnSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return { x: x0 + dx * t, y: y0 + dy * t };
}

export class AutoPlayer {
  private seq = 1;
  private readonly rng: Rng;
  private teles: Tele[] = [];
  private lastMob = new Map<number, { x: number; y: number }>();
  private path: number[] = [];
  private pathGoal = '';
  private strafe = 1;
  private strafeUntil = 0;
  private openedChests = new Set<number>();
  /** Botin que no se pudo recoger (mochila llena): se deja ahi. */
  private skipped = new Set<number>();
  private chasing: { id: number; since: number } | null = null;
  private healCooldown = 0;
  private lastX = 0;
  private lastY = 0;
  private stuck = 0;

  constructor(
    private readonly game: AdventureGame,
    private readonly catId: number,
    seed = 1,
  ) {
    this.rng = createRng(seed + catId * 31);
  }

  private get cat(): Cat {
    return this.game.cat(this.catId) as Cat;
  }

  /** Un tick de decision: se llama justo antes de `game.step()`. */
  tick(): void {
    const g = this.game;
    const cat = this.cat;
    if (!cat.alive) return;
    const now = g.time;
    // avisos de peligro recien emitidos
    for (const ev of (
      g as unknown as {
        events: {
          e: string;
          x: number;
          y: number;
          r: number;
          t: number;
          shape?: number;
          a?: number;
          len?: number;
        }[];
      }
    ).events) {
      if (ev.e !== 'tele') continue;
      const line = ev.shape === 1 && ev.a !== undefined && ev.len !== undefined;
      this.teles.push({
        x: ev.x,
        y: ev.y,
        r: ev.r + 8,
        until: now + ev.t + (line ? 0.5 : 0.4),
        ...(line ? { a: (ev.a! * Math.PI) / 180, len: ev.len! } : {}),
      });
    }
    this.teles = this.teles.filter((t) => t.until > now);

    // elegir reliquia
    const st = g.stateOf(this.catId)!;
    if (st.offers[0]) {
      const offer = st.offers[0];
      const best = [...offer].sort(
        (a, b) => RELIC_ORDER.indexOf(a) - RELIC_ORDER.indexOf(b),
      )[0] as number;
      g.chooseRelic(this.catId, offer.indexOf(best));
    }
    // habilidad nueva de un jefe
    const po = st.powerOffers[0];
    if (po) {
      const best = [...po].sort(
        (a, b) => POWER_ORDER.indexOf(a) - POWER_ORDER.indexOf(b),
      )[0] as number;
      g.choosePower(this.catId, po.indexOf(best));
    }
    this.pickWeapon();

    const mobs = [...g.mobs.values()].filter((m) => m.hp > 0);
    const threats = mobs.filter((m) => dist(cat.x, cat.y, m.x, m.y) < 320);
    const target = this.chooseTarget(threats);

    let mx = 0;
    let my = 0;
    let aim = cat.aim;
    let fire = false;
    let dash = false;
    let pw: 1 | 2 | 3 | undefined;

    // 1) fuera de las zonas de aviso
    for (const t of this.teles) {
      const hit =
        t.a !== undefined && t.len !== undefined
          ? nearestOnSegment(
              cat.x,
              cat.y,
              t.x,
              t.y,
              t.x + Math.cos(t.a) * t.len,
              t.y + Math.sin(t.a) * t.len,
            )
          : { x: t.x, y: t.y };
      if (dist(cat.x, cat.y, hit.x, hit.y) < t.r) {
        let a = Math.atan2(cat.y - hit.y, cat.x - hit.x);
        // justo en el eje de la franja: se sale por el costado
        if (t.a !== undefined && dist(cat.x, cat.y, hit.x, hit.y) < 3) a = t.a + Math.PI / 2;
        mx = Math.cos(a);
        my = Math.sin(a);
        break;
      }
    }
    const inDanger = mx !== 0 || my !== 0;

    // 2) esquivar balas enemigas
    let dodge = 0;
    for (const s of g.shotList()) {
      if (s.owner >= 0) continue;
      const d = dist(cat.x, cat.y, s.x, s.y);
      if (d > 60) continue;
      const toCat = Math.atan2(cat.y - s.y, cat.x - s.x);
      const diff = Math.abs(Math.atan2(Math.sin(toCat - s.angle), Math.cos(toCat - s.angle)));
      if (diff < 0.45) {
        dodge = Math.max(dodge, 60 - d);
        const side = Math.sin(s.angle - toCat) > 0 ? 1 : -1;
        if (!inDanger) {
          mx = Math.cos(s.angle + (Math.PI / 2) * side);
          my = Math.sin(s.angle + (Math.PI / 2) * side);
        }
        if (d < 26 && now >= st.dashReadyAt) dash = true;
      }
    }

    // 3) pelear o avanzar
    if (target) {
      const held = this.heldWeapon();
      const range = held ? WEAPONS[held.kind as WeaponKind].range : 18;
      const [near, far] = this.band(held?.kind as WeaponKind | undefined, target);
      const d = dist(cat.x, cat.y, target.x, target.y);
      const prev = this.lastMob.get(target.id);
      const vx = prev ? (target.x - prev.x) * 30 : 0;
      const vy = prev ? (target.y - prev.y) * 30 : 0;
      const lead = held ? Math.min(0.5, d / WEAPONS[held.kind as WeaponKind].speed) : 0;
      aim = Math.atan2(target.y + vy * lead - cat.y, target.x + vx * lead - cat.x);
      const seen = hasLineOfSight(g.map, cat.x, cat.y, target.x, target.y);
      if (!inDanger && dodge === 0 && !seen && d > 28) {
        // una roca o un tronco estorba: se rodea por el camino mas corto
        const go = this.go(target.x, target.y, `m${target.id}:${Math.round(this.game.time / 2)}`);
        if (go) {
          mx = go.x;
          my = go.y;
        }
      } else if (!inDanger && dodge === 0) {
        const a = Math.atan2(target.y - cat.y, target.x - cat.x);
        if (d < near) {
          mx = -Math.cos(a);
          my = -Math.sin(a);
        } else if (d > far) {
          mx = Math.cos(a);
          my = Math.sin(a);
        } else {
          if (now >= this.strafeUntil) {
            this.strafeUntil = now + this.rng.range(0.8, 1.8);
            this.strafe = this.rng.chance(0.5) ? 1 : -1;
          }
          mx = Math.cos(a + this.strafe * 1.5);
          my = Math.sin(a + this.strafe * 1.5);
        }
      }
      fire = d < range * 0.95 && seen;
      // sin balas: a las garras
      if (!held) fire = d < 24;
      if (d < 16 && now >= st.dashReadyAt && target.def.dmg >= 14) dash = true;
      // curarse en cuanto da un respiro
      if (cat.hp < 45 && d > 80 && now > this.healCooldown) this.heal();
      // pelea grande o jefe: hierba gatera; poca vida y muchos enemigos: valeriana
      else if (now > this.healCooldown && (threats.length >= 4 || target.def.boss)) {
        if (st.rageUntil <= now) this.drink('potion_catnip');
      } else if (cat.hp < 60 && threats.length >= 3) this.drink('potion_valerian');
    } else {
      if (cat.hp < 70 && now > this.healCooldown) this.heal();
      const go = this.navigate();
      if (!inDanger && go) {
        mx = go.x;
        my = go.y;
      }
    }
    for (const m of mobs) this.lastMob.set(m.id, { x: m.x, y: m.y });
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    // habilidades: las de pelea cuando hay enemigos serios, las de cura cuando hace falta
    st.powers.forEach((p, i) => {
      if (pw || now < p.readyAt) return;
      const fighting = target !== null && (threats.length >= 3 || target.def.boss === true);
      const heal = (p.id === 2 || p.id === 6) && cat.hp < 60 && threats.length > 0;
      const defend = p.id === 4 && (inDanger || cat.hp < 35) && threats.length > 0;
      const close =
        target !== null &&
        dist(cat.x, cat.y, target.x, target.y) < (p.id === 3 || p.id === 5 ? 80 : 200);
      if ((fighting && close && p.id !== 2 && p.id !== 6 && p.id !== 4) || heal || defend)
        pw = (i + 1) as 1 | 2 | 3;
    });
    g.pushInput(this.catId, {
      seq: this.seq++,
      mx,
      my,
      aim,
      fire,
      hold: fire,
      run: false,
      dash,
      ...(pw ? { pw } : {}),
    });
    void now;
  }

  private inRoom(def: { x: number; y: number; w: number; h: number }, cat: Cat): boolean {
    return (
      cat.x >= def.x * TILE &&
      cat.x < (def.x + def.w) * TILE &&
      cat.y >= def.y * TILE &&
      cat.y < (def.y + def.h) * TILE
    );
  }

  private chooseTarget(threats: Mob[]): Mob | null {
    const cat = this.cat;
    let best: Mob | null = null;
    let bestScore = Infinity;
    for (const m of threats) {
      let score = dist(cat.x, cat.y, m.x, m.y);
      // las amenazas que disparan o embisten y los hongos pesan mas
      if (m.def.behavior === 'shooter' || m.def.behavior === 'turret') score -= 40;
      if (m.def.boss) score -= 60;
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  /** Distancia que le gusta a cada arma. */
  private band(kind: WeaponKind | undefined, target: Mob): [number, number] {
    if (target.def.boss) {
      if (kind === 'shotgun') return [48, 80];
      if (kind === 'sniper') return [140, 200];
      return [95, 140];
    }
    switch (kind) {
      case 'shotgun':
        return [40, 78];
      case 'sniper':
        return [140, 210];
      case 'bazooka':
        return [90, 150];
      case 'rifle':
        return [85, 140];
      default:
        return [75, 120];
    }
  }

  private heldWeapon() {
    const it = this.cat.inv[this.cat.sel];
    if (!it || !isWeapon(it.kind)) return null;
    const def = WEAPONS[it.kind];
    if (magOf(it) <= 0 && this.cat.ammo[def.ammo] < def.ammoPerShot) return null;
    return it;
  }

  private pickWeapon(): void {
    const cat = this.cat;
    if (this.game.time < 0.5) return;
    let best = -1;
    let bestScore = -1;
    cat.inv.forEach((it, slot) => {
      if (!it || !isWeapon(it.kind)) return;
      const def = WEAPONS[it.kind];
      if (magOf(it) <= 0 && cat.ammo[def.ammo] < def.ammoPerShot) return;
      const score =
        (PREFERRED.length - PREFERRED.indexOf(it.kind)) * 10 +
        it.rarity * 4 +
        (magOf(it) > 0 ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = slot;
      }
    });
    if (best >= 0 && cat.sel !== best && !cat.heal && !cat.reload)
      this.game.select(this.catId, best);
  }

  /** Toma la pocion que toque: hierba gatera para pelear fuerte, valeriana para huir o esquivar. */
  private drink(kind: 'potion_catnip' | 'potion_valerian'): boolean {
    const cat = this.cat;
    const slot = cat.inv.findIndex((it) => it && it.kind === kind);
    if (slot < 0 || this.game.time < this.healCooldown) return false;
    this.healCooldown = this.game.time + 1.2;
    this.game.select(this.catId, slot);
    this.game.fireControl(cat, cat.aim, false);
    this.game.fireControl(cat, cat.aim, true);
    this.game.fireControl(cat, cat.aim, false);
    return true;
  }

  private heal(): void {
    const cat = this.cat;
    const slot = cat.inv.findIndex((it) => it && (it.kind === 'medkit' || it.kind === 'shield'));
    if (slot < 0) return;
    this.healCooldown = this.game.time + 1.2;
    this.game.select(this.catId, slot);
    // un golpe de "disparar" empieza la curacion
    this.game.fireControl(this.cat, this.cat.aim, false);
    this.game.fireControl(this.cat, this.cat.aim, true);
    this.game.fireControl(this.cat, this.cat.aim, false);
  }

  /** Sin enemigos: abre cofres, recoge botin y avanza a la siguiente sala. */
  private navigate(): { x: number; y: number } | null {
    const g = this.game;
    const cat = this.cat;
    // cofres de tesoro
    for (const c of g.allContainers()) {
      if (c.kind === 'tomb' || c.kind === 'drop' || this.openedChests.has(c.id)) continue;
      // solo los cofres del claro donde esta (con senderos que se ramifican, uno de otro claro
      // lo mandaria de ida y vuelta por el pasillo)
      const home = g.rooms.find((r) => this.inRoom(r.def, { x: c.x, y: c.y } as never));
      if (!home || !this.inRoom(home.def, cat)) continue;
      const d = dist(cat.x, cat.y, c.x, c.y);
      if (d < 22) {
        g.interact(this.catId);
        g.lootTakeAll(this.catId, c.id);
        this.openedChests.add(c.id);
      } else if (d < 260 && c.items.length > 0) {
        return this.go(c.x, c.y, `c${c.id}`);
      }
    }
    // botin en el suelo
    let near: { x: number; y: number } | null = null;
    let nearD = 160;
    let nearId = -1;
    for (const p of g.pickups) {
      if (this.skipped.has(p.id)) continue;
      const d = dist(cat.x, cat.y, p.x, p.y);
      if (d < nearD) {
        nearD = d;
        near = p;
        nearId = p.id;
      }
    }
    // si lleva un rato encima de algo y no lo recoge, es que no le cabe
    if (near && nearD < 14) {
      if (this.chasing?.id !== nearId) this.chasing = { id: nearId, since: g.time };
      else if (g.time - this.chasing.since > 1.5) {
        this.skipped.add(nearId);
        near = null;
      }
    }
    if (near) return this.go(near.x, near.y, `p${near.x | 0},${near.y | 0}`);
    // a la siguiente sala sin superar
    const next = g.rooms.find((r) => r.state !== 2) ?? g.rooms[g.rooms.length - 1]!;
    const tx = (next.def.x + next.def.w / 2) * TILE;
    const ty = (next.def.y + next.def.h / 2) * TILE;
    return this.go(tx, ty, `r${next.def.id}`);
  }

  private go(x: number, y: number, key: string): { x: number; y: number } | null {
    const g = this.game;
    const cat = this.cat;
    const sx = Math.floor(cat.x / TILE);
    const sy = Math.floor(cat.y / TILE);
    if (key !== this.pathGoal || this.path.length === 0) {
      let path = findPath(g.map, sx, sy, Math.floor(x / TILE), Math.floor(y / TILE), false);
      if (!path) path = [];
      // la casilla donde ya estamos no cuenta: se camina a la siguiente
      if (path[0] === sy * g.map.w + sx) path.shift();
      this.path = path;
      this.pathGoal = key;
    }
    // se descartan las casillas ya alcanzadas y se camina a la siguiente, de a una
    while (this.path.length > 1) {
      const n0 = this.path[0] as number;
      const c0x = (n0 % g.map.w) * TILE + TILE / 2;
      const c0y = Math.floor(n0 / g.map.w) * TILE + TILE / 2;
      if (dist(cat.x, cat.y, c0x, c0y) < 6) this.path.shift();
      else break;
    }
    // atorado: se vuelve a trazar la ruta
    if (dist(cat.x, cat.y, this.lastX, this.lastY) < 0.15) this.stuck++;
    else this.stuck = 0;
    this.lastX = cat.x;
    this.lastY = cat.y;
    if (this.stuck > 20) {
      this.path = [];
      this.pathGoal = '';
      this.stuck = 0;
    }
    const n = this.path[0];
    if (n === undefined) return { x: Math.sign(x - cat.x), y: Math.sign(y - cat.y) };
    const cx = (n % g.map.w) * TILE + TILE / 2;
    const cy = Math.floor(n / g.map.w) * TILE + TILE / 2;
    const a = Math.atan2(cy - cat.y, cx - cat.x);
    return { x: Math.cos(a), y: Math.sin(a) };
  }
}
