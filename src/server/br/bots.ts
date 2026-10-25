import { AMMO_MAX, CAT, TILE } from '../../shared/br/constants';
import {
  WEAPONS,
  isAmmo,
  isWeapon,
  magOf,
  type Item,
  type WeaponDef,
  type WeaponKind,
} from '../../shared/br/items';
import { G, isSolidTile, isWaterAtPx, type BRMap } from '../../shared/br/map';
import { hasLineOfSight, dist } from '../../shared/br/physics';
import { insideCircle } from '../../shared/br/zone';
import type { Rng } from '../../shared/rng';
import type { BRGame, Cat } from './Game';

/** Camino mas corto por casillas (4 vecinos) hasta quedar junto al objetivo. */
export function findPath(
  map: BRMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  avoidWater = true,
): number[] | null {
  const w = map.w;
  const total = w * map.h;
  const start = sy * w + sx;
  const parent = new Int32Array(total).fill(-2);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  parent[start] = -1;
  queue[tail++] = start;
  const goalSolid = isSolidTile(map, gx, gy);
  let found = -1;
  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % w;
    const y = (i / w) | 0;
    const adjacent = Math.abs(x - gx) + Math.abs(y - gy) <= (goalSolid ? 1 : 0);
    if (adjacent) {
      found = i;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
      const ni = ny * w + nx;
      if (parent[ni] !== -2 || map.solid[ni] !== 0) continue;
      if (avoidWater && map.ground[ni] === G.WATER) continue;
      parent[ni] = i;
      queue[tail++] = ni;
    }
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let i = found; i !== -1; i = parent[i] as number) path.push(i);
  return path.reverse();
}

interface Contents {
  id: number;
  items: Item[];
}

interface Sighting {
  x: number;
  y: number;
  t: number;
}

type Mode = 'start' | 'zone' | 'heal' | 'fight' | 'flee' | 'loot' | 'roam' | 'camp';

const NO_PATH_RETRY = 0.35;

/**
 * Cerebro de un bot. Juega con las mismas reglas que una persona (mismo movimiento, estamina,
 * municion y vision con lineas de tiro): busca cofres, se equipa, se cura, huye de la ola, pelea con
 * armas que le convienen segun la distancia, huye si va perdiendo y se mete a investigar disparos.
 * Cada decision tiene un tiempo minimo de compromiso para que no cambie de opinion cada tick.
 */
export class BotBrain {
  // personalidad
  private readonly aggression: number;
  private readonly aimError: number;
  private readonly reaction: number;
  private readonly sight: number;
  private readonly sprinty: number;
  private readonly startDelay: number;
  /** Al principio todos buscan cofres: nadie empieza un pleito antes de este momento. */
  private readonly peaceUntil: number;

  // estado de decision
  mode: Mode = 'start';
  private didMove = false;
  private target: Cat | null = null;
  private seenSince = 0;
  private lastSeen = 0;
  private lastSeenAt: Sighting | null = null;
  private enemyVel = { x: 0, y: 0 };
  private fightUntil = 0;
  private fleeUntil = 0;
  private provokedUntil = 0;
  private nextSense = 0;
  private nextWeaponSwap = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private moveKind: 'in' | 'out' | 'strafe' = 'strafe';
  private moveUntil = 0;
  private jitter = 0;
  private jitterUntil = 0;
  private wallReadyAt = 0;
  private wallStage = 0;
  private wallSlot = -1;
  private nextHuntAt = 0;
  private investigateAt = 0;
  private lastHeard = 0;
  private runLatch = false;
  private zoneLatch = false;

  // botin
  private lootTarget: number | null = null;
  private readonly done = new Set<number>();
  private rummageUntil = 0;
  private lastTakeCheck = 0;

  // merodeo
  private roamGoal: { x: number; y: number } | null = null;
  private roamRun = false;
  private campUntil = 0;

  // navegacion
  private path: number[] = [];
  private pathIdx = 0;
  private navKey = '';
  private lastPlan = -10;
  private progressPos = { x: 0, y: 0 };
  private progressAt = 0;
  private stuck = 0;
  private sidestepUntil = 0;
  private sidestepDir = { x: 0, y: 0 };

  constructor(
    private readonly game: BRGame,
    private readonly cat: Cat,
    private readonly rng: Rng,
  ) {
    this.aggression = rng.range(0.15, 0.95);
    this.aimError = rng.range(0.05, 0.14);
    this.reaction = rng.range(0.3, 0.7);
    this.sight = rng.range(170, 250);
    this.sprinty = rng.range(0.3, 1);
    this.startDelay = rng.range(0.4, 2.5);
    // por equipos nadie espera: la pelea empieza apenas termina la cuenta
    this.peaceUntil = game.teamMode ? 0 : rng.range(40, 90) - this.aggression * 15;
    this.progressPos = { x: cat.x, y: cat.y };
  }

  // ---------------------------------------------------------------- bucle principal

  think(_dt: number): void {
    const g = this.game;
    const c = this.cat;
    const now = g.time;
    this.didMove = false;
    if (c.hurtUntil > now) this.provokedUntil = now + 5;

    this.step(now);
    // Si ningun movimiento se pidio este tick, se descansa (y la estamina se recupera).
    if (!this.didMove) g.botMove(c, 0, 0, false);
  }

  private step(now: number): void {
    const c = this.cat;
    if (now < this.startDelay) {
      this.mode = 'start';
      return;
    }
    this.sense(now);
    this.refreshSightings(now);

    // el muro: secuencia de tres ticks que no se puede interrumpir
    if (this.wallStage > 0) {
      this.runWallSequence();
      return;
    }

    // Curarse no obliga a quedarse quieto (como una persona, camina mientras se cura). Si el enemigo
    // se acerca se suelta la cura para tomar el arma, y al llegar a lo suficiente se corta sola.
    if (c.heal) {
      const near = this.target && dist(c.x, c.y, this.target.x, this.target.y) < 90;
      const enough = c.heal.kind === 'shield' ? c.shield >= 60 : c.hp >= 92;
      if (near || enough)
        this.equipBest(this.target ? dist(c.x, c.y, this.target.x, this.target.y) : 100, true);
    } else if (!this.heldIsWeapon() && this.armed()) {
      this.equipBest(this.target ? dist(c.x, c.y, this.target.x, this.target.y) : 100, true);
    }

    this.maybeReload();

    // la ola manda
    if (this.zoneUrgent()) {
      this.mode = 'zone';
      this.goToZone();
      return;
    }

    if (this.target) {
      const decision = this.combatDecision(now);
      if (decision === 'fight') {
        this.mode = 'fight';
        this.fight(now);
        return;
      }
      if (decision === 'flee') {
        this.mode = 'flee';
        this.flee(now);
        return;
      }
    }

    if (this.tryHeal(now)) return;
    if (this.investigate(now)) return;
    if (this.loot(now)) return;
    this.roam(now);
  }

  /** Sin enemigo cerca aprovecha para recargar el arma en mano cuando ya casi esta vacia. */
  private maybeReload(): void {
    const c = this.cat;
    if (c.reload || c.heal) return;
    const it = this.game.held(c);
    if (!it || !isWeapon(it.kind)) return;
    const def = WEAPONS[it.kind];
    if (magOf(it) > Math.max(1, Math.floor(def.magazine * 0.3))) return;
    const t = this.target;
    if (t && dist(c.x, c.y, t.x, t.y) < 150) return;
    this.game.startReload(c);
  }

  // ---------------------------------------------------------------- percepcion

  /** Mira alrededor cada 0.15 s: el enemigo mas cercano con linea de tiro, con algo de memoria. */
  private sense(now: number): void {
    if (now < this.nextSense) return;
    this.nextSense = now + 0.15 + this.rng.next() * 0.08;
    const c = this.cat;
    const g = this.game;
    let best: Cat | null = null;
    let bestD = this.sight;
    for (const o of g.cats) {
      if (!g.isFoe(c, o)) continue;
      const d = dist(c.x, c.y, o.x, o.y);
      const keep = this.target && this.target.id === o.id ? this.sight * 1.3 : this.sight;
      if (d > keep) continue;
      if (
        d < bestD * (this.target && this.target.id === o.id ? 1.25 : 1) &&
        hasLineOfSight(g.map, c.x, c.y, o.x, o.y)
      ) {
        bestD = d;
        best = o;
      }
    }
    if (best) {
      if (!this.target || this.target.id !== best.id) {
        this.target = best;
        this.seenSince = now;
        this.enemyVel = { x: 0, y: 0 };
        this.lastSeenAt = null;
      }
      const prev = this.lastSeenAt;
      if (prev && now - prev.t > 0.05) {
        const dt = now - prev.t;
        const vx = (best.x - prev.x) / dt;
        const vy = (best.y - prev.y) / dt;
        this.enemyVel = {
          x: this.enemyVel.x * 0.6 + vx * 0.4,
          y: this.enemyVel.y * 0.6 + vy * 0.4,
        };
      }
      this.lastSeen = now;
      this.lastSeenAt = { x: best.x, y: best.y, t: now };
    }
  }

  private refreshSightings(now: number): void {
    const t = this.target;
    if (t && (!t.alive || now - this.lastSeen > 3)) {
      this.target = null;
      this.lastSeenAt = null;
    }
  }

  private visibleNow(now: number): boolean {
    return this.target !== null && now - this.lastSeen < 0.4;
  }

  // ---------------------------------------------------------------- navegacion

  private clearCorridor(x0: number, y0: number, x1: number, y1: number, noWater: boolean): boolean {
    const g = this.game;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (CAT.half - 0.5);
    const ny = (dx / len) * (CAT.half - 0.5);
    if (!hasLineOfSight(g.map, x0, y0, x1, y1)) return false;
    if (!hasLineOfSight(g.map, x0 + nx, y0 + ny, x1 + nx, y1 + ny)) return false;
    if (!hasLineOfSight(g.map, x0 - nx, y0 - ny, x1 - nx, y1 - ny)) return false;
    if (noWater) {
      for (let d = 6; d < len; d += 6) {
        if (isWaterAtPx(g.map, x0 + (dx * d) / len, y0 + (dy * d) / len)) return false;
      }
    }
    return true;
  }

  /** Correr con histeresis: empieza con la barra bien llena y sigue hasta que casi se acaba. */
  private sprint(want: boolean): boolean {
    const v = this.cat.stamina.value;
    if (!want || this.cat.stamina.tired) this.runLatch = false;
    else if (this.runLatch) this.runLatch = v > 12;
    else this.runLatch = v > 70;
    return this.runLatch;
  }

  private bmove(dx: number, dy: number, run: boolean): void {
    const len = Math.hypot(dx, dy) || 1;
    this.didMove = true;
    this.game.botMove(this.cat, dx / len, dy / len, run);
  }

  /**
   * Camina hacia (x, y) por un camino de casillas, acortando las esquinas cuando el pasillo esta
   * libre. Si no avanza detecta que esta atorado: cambia de ruta, se hace a un lado y, si sigue
   * igual, avisa que ese destino no sirve.
   */
  private navTo(x: number, y: number, run: boolean, arrive = 8): 'moving' | 'arrived' | 'blocked' {
    const g = this.game;
    const c = this.cat;
    const now = g.time;
    if (dist(c.x, c.y, x, y) <= arrive) return 'arrived';

    const gx = Math.floor(x / TILE);
    const gy = Math.floor(y / TILE);
    const key = `${gx},${gy}`;
    const sx = Math.floor(c.x / TILE);
    const sy = Math.floor(c.y / TILE);
    let waterFree = true;
    if (this.path.length === 0 || key !== this.navKey || this.pathIdx >= this.path.length) {
      if (now - this.lastPlan < NO_PATH_RETRY && key === this.navKey) return 'moving';
      this.lastPlan = now;
      this.navKey = key;
      let path = findPath(g.map, sx, sy, gx, gy);
      if (!path) {
        path = findPath(g.map, sx, sy, gx, gy, false);
        waterFree = false;
      }
      this.stuck = 0;
      this.progressPos = { x: c.x, y: c.y };
      this.progressAt = now;
      if (!path) {
        this.path = [];
        return 'blocked';
      }
      this.path = path;
      this.pathIdx = 0;
    }
    const center = (node: number): { x: number; y: number } => ({
      x: (node % g.map.w) * TILE + TILE / 2,
      y: Math.floor(node / g.map.w) * TILE + TILE / 2,
    });
    // El camino debe seguir cerca del gato: si se desvio (pelea, plan viejo) se traza de nuevo.
    const here = center(this.path[Math.min(this.pathIdx, this.path.length - 1)] as number);
    if (Math.hypot(here.x - c.x, here.y - c.y) > TILE * 2.6) {
      this.path = [];
      this.lastPlan = -10;
      return this.navTo(x, y, run, arrive);
    }
    while (this.pathIdx < this.path.length - 1) {
      const n = center(this.path[this.pathIdx] as number);
      if (Math.hypot(n.x - c.x, n.y - c.y) < 5) this.pathIdx++;
      else break;
    }
    let aim = center(this.path[this.pathIdx] as number);
    if (this.pathIdx >= this.path.length - 1 && Math.hypot(aim.x - c.x, aim.y - c.y) < 5) {
      // llego a la ultima casilla: el destino real queda un poco mas alla (cofre, etc.)
      aim = { x, y };
    }
    for (let k = Math.min(this.pathIdx + 8, this.path.length - 1); k > this.pathIdx; k--) {
      const n = center(this.path[k] as number);
      if (this.clearCorridor(c.x, c.y, n.x, n.y, waterFree)) {
        aim = n;
        break;
      }
    }

    let dx = aim.x - c.x;
    let dy = aim.y - c.y;
    if (now < this.sidestepUntil) {
      dx = this.sidestepDir.x;
      dy = this.sidestepDir.y;
    }
    this.bmove(dx, dy, run);

    if (now - this.progressAt >= 0.5) {
      const moved = dist(c.x, c.y, this.progressPos.x, this.progressPos.y);
      this.progressPos = { x: c.x, y: c.y };
      this.progressAt = now;
      if (moved < 3) {
        this.stuck++;
        this.path = [];
        this.lastPlan = -10;
        const a = this.rng.range(0, Math.PI * 2);
        this.sidestepDir = { x: Math.cos(a), y: Math.sin(a) };
        this.sidestepUntil = now + 0.3;
        if (this.stuck >= 4) {
          this.stuck = 0;
          return 'blocked';
        }
      } else {
        this.stuck = 0;
      }
    }
    return 'moving';
  }

  // ---------------------------------------------------------------- la ola

  /**
   * La ola manda. Con histeresis: una vez que hay que correr al circulo, no se suelta hasta estar
   * bien adentro (sin esto el bot se queda temblando justo en el borde, cambiando de opinion).
   */
  private zoneUrgent(): boolean {
    const z = this.game.zone;
    const c = this.cat;
    const outside = z.dps > 0 && !insideCircle(z.circle, c.x, c.y);
    // Con la ola tan rapida hay que ponerse en marcha antes de que empiece a cerrar.
    const lead = z.phase === 0 ? 14 : 26;
    const soonOutside =
      z.next !== null && z.next.r > 0 && z.nextIn < lead && !insideCircle(z.next, c.x, c.y);
    if (outside || soonOutside) {
      this.zoneLatch = true;
      return true;
    }
    if (!this.zoneLatch) return false;
    const target = !z.next || z.next.r <= 0 || z.nextIn >= lead ? z.circle : z.next;
    const safe = insideCircle(
      { cx: target.cx, cy: target.cy, r: Math.max(10, target.r - 45) },
      c.x,
      c.y,
    );
    if (safe) this.zoneLatch = false;
    return this.zoneLatch;
  }

  /**
   * El circulo donde conviene quedarse ahora: el actual, o el siguiente cuando ya se acerca la ola.
   * Sirve para no ir a saquear algo que quedara fuera (y evita el baile entre botin y ola).
   */
  private safeNow(): { cx: number; cy: number; r: number } {
    const z = this.game.zone;
    const lead = z.phase === 0 ? 14 : 26;
    const soon = z.next !== null && z.next.r > 0 && z.nextIn < lead;
    const c = soon ? (z.next as { cx: number; cy: number; r: number }) : z.circle;
    return { cx: c.cx, cy: c.cy, r: Math.max(0, c.r - 28) };
  }

  private goToZone(): void {
    const z = this.game.zone;
    const c = this.cat;
    const outside = z.dps > 0 && !insideCircle(z.circle, c.x, c.y);
    const target = outside || !z.next || z.next.r <= 0 ? z.circle : z.next;
    // Un punto dentro del circulo, no justo en el centro: evita que todos se amontonen.
    const a = (c.id * 2.399) % (Math.PI * 2);
    const gx = target.cx + Math.cos(a) * target.r * 0.35;
    const gy = target.cy + Math.sin(a) * target.r * 0.35;
    const run = this.sprint(outside && this.sprinty > 0.35);
    if (this.navTo(gx, gy, run, 14) === 'blocked') this.navTo(target.cx, target.cy, run, 14);
  }

  // ---------------------------------------------------------------- combate

  private armed(): boolean {
    return this.usableWeapons().length > 0;
  }

  private usableWeapons(): { slot: number; item: Item; def: WeaponDef }[] {
    const out: { slot: number; item: Item; def: WeaponDef }[] = [];
    this.cat.inv.forEach((item, slot) => {
      if (!item || !isWeapon(item.kind)) return;
      const def = WEAPONS[item.kind];
      // Sirve si tiene balas en el cargador o de repuesto para recargar.
      if (magOf(item) > 0 || this.cat.ammo[def.ammo] >= def.ammoPerShot)
        out.push({ slot, item, def });
    });
    return out;
  }

  private heldIsWeapon(): boolean {
    const it = this.cat.inv[this.cat.sel];
    return it !== null && it !== undefined && isWeapon(it.kind);
  }

  private hasHeal(): boolean {
    return this.cat.inv.some((it) => it && (it.kind === 'medkit' || it.kind === 'shield'));
  }

  private combatDecision(now: number): 'fight' | 'flee' | 'ignore' {
    const g = this.game;
    const c = this.cat;
    const e = this.target as Cat;
    const d = dist(c.x, c.y, e.x, e.y);
    const armed = this.armed();
    const provoked = now < this.provokedUntil;
    const weak = c.hp + c.shield < 38 && !this.hasHeal();

    if (now < this.fleeUntil) return 'flee';
    if (weak && d < 190) {
      this.fleeUntil = now + this.rng.range(2, 3.5);
      return 'flee';
    }
    if (!armed) {
      // Sin arma solo se pelea a quemarropa o si ya te estan golpeando.
      if (d < 42 || (provoked && d < 70)) {
        this.fightUntil = now + 1.5;
        return 'fight';
      }
      if (provoked && d < 160) {
        this.fleeUntil = now + this.rng.range(1.5, 2.5);
        return 'flee';
      }
      return 'ignore';
    }
    if (now < g.graceS) return 'ignore';
    if (now < this.fightUntil) return 'fight';
    // por equipos solo hay enemigos delante: se pelea siempre que se les ve
    if (g.teamMode) {
      this.fightUntil = now + this.rng.range(2.5, 5);
      return 'fight';
    }
    if (now < this.peaceUntil && !provoked && d > 18) return 'ignore';
    const phase = g.zone.phase;
    const pressure = phase >= 3 ? 0.35 : phase === 2 ? 0.2 : phase === 1 ? 0.08 : 0;
    const want = this.aggression + pressure + (provoked ? 0.6 : 0);
    if (want > 0.72 || d < 55) {
      this.fightUntil = now + this.rng.range(3, 6);
      return 'fight';
    }
    return 'ignore';
  }

  /** Cual arma conviene a esta distancia (y si hay que cambiar). */
  private equipBest(distance: number, force = false): void {
    const g = this.game;
    const c = this.cat;
    const now = g.time;
    if (c.heal && !force) return;
    if (!force && now < this.nextWeaponSwap) return;
    const options = this.usableWeapons();
    const fit = (def: WeaponDef): number => {
      const dps =
        (def.damage[1] * def.pellets * (def.kind === 'shotgun' ? 0.55 : 1)) / def.cooldown;
      let f = 1;
      if (def.kind === 'shotgun') f = distance < 75 ? 1.6 : distance < 110 ? 0.6 : 0.2;
      else if (def.kind === 'sniper') f = distance > 120 ? 1.5 : distance > 70 ? 0.9 : 0.3;
      else if (def.kind === 'bazooka') f = distance > 55 && distance < 220 ? 1.9 : 0.1;
      else if (def.kind === 'rifle') f = distance < 190 ? 1.2 : 0.7;
      if (distance > def.range) f *= 0.2;
      return dps * f;
    };
    let best = -1;
    let bestScore = -1;
    for (const o of options) {
      // Un arma con el cargador vacio hay que recargarla antes: vale menos en plena pelea.
      // Las armas de pocos disparos (sniper, bazuca) quedan vacias a proposito tras cada tiro: no se
      // castigan tanto como un fusil sin balas.
      const emptyK = o.def.magazine <= 3 ? 0.8 : 0.3;
      const sc = fit(o.def) * (1 + o.item.rarity * 0.35) * (magOf(o.item) > 0 ? 1 : emptyK);
      if (sc > bestScore) {
        bestScore = sc;
        best = o.slot;
      }
    }
    if (best >= 0) {
      if (c.sel !== best) {
        const cur = options.find((o) => o.slot === c.sel);
        const curScore = cur
          ? fit(cur.def) *
            (1 + cur.item.rarity * 0.35) *
            (magOf(cur.item) > 0 ? 1 : cur.def.magazine <= 3 ? 0.8 : 0.3)
          : 0;
        if (!cur || bestScore > curScore * 1.25 || force) {
          g.select(c.id, best);
          this.nextWeaponSwap = now + 1.2;
        }
      }
      return;
    }
    // Sin arma con balas: las manos libres (garras).
    const empty = c.inv.findIndex((it) => it === null);
    if (empty >= 0 && c.sel !== empty) g.select(c.id, empty);
  }

  private fight(now: number): void {
    const g = this.game;
    const c = this.cat;
    const e = this.target as Cat;
    const visible = this.visibleNow(now);
    const d = dist(c.x, c.y, e.x, e.y);
    this.equipBest(d);
    const item = g.held(c);
    const def = item && isWeapon(item.kind) ? WEAPONS[item.kind as WeaponKind] : null;
    const range = def ? def.range : 16;
    const preferred = def
      ? def.kind === 'shotgun'
        ? 38
        : def.kind === 'sniper'
          ? 210
          : def.kind === 'bazooka'
            ? 140
            : def.kind === 'rifle'
              ? 120
              : 100
      : 10;

    // sin verlo: ir a donde se le vio por ultima vez
    if (!visible) {
      const at = this.lastSeenAt;
      if (at) {
        const r = this.navTo(at.x, at.y, false, 16);
        if (r !== 'moving') this.target = null;
      }
      g.fireControl(c, c.aim, false);
      return;
    }

    // movimiento: acercarse, alejarse o rodear
    const toward = Math.atan2(e.y - c.y, e.x - c.x);
    if (d < 12) {
      // Encima del enemigo el angulo no sirve de nada: se separa en una direccion fija un rato.
      if (now >= this.sidestepUntil) {
        const a = this.rng.range(0, Math.PI * 2);
        this.sidestepDir = { x: Math.cos(a), y: Math.sin(a) };
        this.sidestepUntil = now + 0.6;
      }
      this.bmove(this.sidestepDir.x, this.sidestepDir.y, false);
      g.fireControl(c, c.aim, false);
      return;
    }
    const run = this.sprint(d > 150 && this.sprinty > 0.5);
    // Cada maniobra dura un momento (histeresis): asi no cambia de adelante a atras cada tick.
    if (now >= this.moveUntil) {
      this.moveKind =
        d > preferred + 22
          ? 'in'
          : d < preferred - 22 && def && def.kind !== 'shotgun'
            ? 'out'
            : 'strafe';
      this.moveUntil = now + this.rng.range(0.4, 0.8);
    }
    if (this.moveKind === 'in') {
      if (d > 60) this.navTo(e.x, e.y, run, 20);
      else this.bmove(Math.cos(toward), Math.sin(toward), false);
    } else if (this.moveKind === 'out') {
      this.bmove(-Math.cos(toward), -Math.sin(toward), false);
    } else {
      if (now >= this.strafeUntil) {
        this.strafeUntil = now + this.rng.range(0.8, 1.8);
        this.strafe = this.rng.chance(0.5) ? 1 : -1;
      }
      const sa = toward + (Math.PI / 2) * this.strafe;
      this.bmove(Math.cos(sa), Math.sin(sa), false);
      if (now - this.progressAt > 0.6) {
        if (dist(c.x, c.y, this.progressPos.x, this.progressPos.y) < 2) this.strafe *= -1;
        this.progressPos = { x: c.x, y: c.y };
        this.progressAt = now;
      }
    }

    // muro para cubrirse cuando va perdiendo vida a media distancia
    if (now >= this.wallReadyAt && c.hp < 70 && d > 45 && d < 150 && this.beginWall()) {
      return;
    }

    // puntería: se adelanta al movimiento del enemigo, con error que baja con el tiempo de vista
    const speed = def ? def.speed : 200;
    const lead = Math.min(0.6, d / speed);
    const px = e.x + this.enemyVel.x * lead;
    const py = e.y + this.enemyVel.y * lead;
    if (now >= this.jitterUntil) {
      this.jitterUntil = now + 0.25;
      const calm = Math.min(1, (now - this.seenSince) / 2);
      this.jitter = this.rng.range(-1, 1) * this.aimError * (1.6 - calm * 0.6);
    }
    c.aim = Math.atan2(py - c.y, px - c.x) + this.jitter;

    const ready = now - this.seenSince >= this.reaction;
    const clear = hasLineOfSight(g.map, c.x, c.y, e.x, e.y);
    const safeBlast = !(def && def.splash > 0 && d < 52);
    const wantFire = ready && clear && safeBlast && d <= range * 0.95;
    const press = wantFire && (def ? def.auto || !c.prevFire : !c.prevFire);
    g.fireControl(c, c.aim, press, false);
  }

  private beginWall(): boolean {
    const c = this.cat;
    const slot = c.inv.findIndex((it) => it && it.kind === 'wall');
    if (slot < 0) return false;
    this.wallSlot = slot;
    this.wallStage = 1;
    this.wallReadyAt = this.game.time + this.rng.range(7, 12);
    return true;
  }

  private runWallSequence(): void {
    const g = this.game;
    const c = this.cat;
    const e = this.target;
    if (e) c.aim = Math.atan2(e.y - c.y, e.x - c.x);
    if (this.wallStage === 1) {
      g.select(c.id, this.wallSlot);
      g.fireControl(c, c.aim, false);
      this.wallStage = 2;
    } else if (this.wallStage === 2) {
      g.fireControl(c, c.aim, true);
      this.wallStage = 3;
    } else {
      g.fireControl(c, c.aim, false);
      this.wallStage = 0;
      this.nextWeaponSwap = 0;
      this.equipBest(e ? dist(c.x, c.y, e.x, e.y) : 100, true);
    }
  }

  private flee(now: number): void {
    const g = this.game;
    const c = this.cat;
    const e = this.target as Cat;
    const away = Math.atan2(c.y - e.y, c.x - e.x);
    const z = g.zone.circle;
    const toZone = Math.atan2(z.cy - c.y, z.cx - c.x);
    const diff = Math.abs(Math.atan2(Math.sin(toZone - away), Math.cos(toZone - away)));
    const a = diff < 1.3 ? toZone : away;
    // una meta lejana en esa direccion y camino real para no chocar con paredes
    const gx = Math.max(40, Math.min(g.map.w * TILE - 40, c.x + Math.cos(a) * 130));
    const gy = Math.max(40, Math.min(g.map.h * TILE - 40, c.y + Math.sin(a) * 130));
    const run = this.sprint(true);
    if (this.navTo(gx, gy, run, 14) === 'blocked') this.bmove(Math.cos(a), Math.sin(a), run);
    // mientras huye apunta hacia atras por si lo alcanzan
    c.aim = Math.atan2(e.y - c.y, e.x - c.x);
    g.fireControl(c, c.aim, false);
    if (now >= this.fleeUntil && dist(c.x, c.y, e.x, e.y) > 200) this.fleeUntil = 0;
  }

  // ---------------------------------------------------------------- curacion

  private tryHeal(now: number): boolean {
    const c = this.cat;
    const g = this.game;
    // Ya curandose: sigue con lo suyo (caminar, buscar botin) mientras la cura corre.
    if (c.heal) return false;
    const e = this.target;
    if (e && dist(c.x, c.y, e.x, e.y) < 170 && this.visibleNow(now)) return false;
    const needHp = c.hp < 62;
    const needShield = c.shield < 20 && c.hp >= 62;
    if (!needHp && !needShield) return false;
    const kind = needHp ? 'medkit' : 'shield';
    const slot = c.inv.findIndex((it) => it && it.kind === kind);
    if (slot < 0) return false;
    g.select(c.id, slot);
    g.fireControl(c, c.aim, false);
    g.fireControl(c, c.aim, true);
    this.mode = 'heal';
    return true;
  }

  // ---------------------------------------------------------------- curiosidad

  /** Va a ver de donde vienen los disparos cercanos, o sale a cazar de vez en cuando. */
  private investigate(now: number): boolean {
    const g = this.game;
    const c = this.cat;
    if (!this.armed() || now < g.graceS) return false;
    // un disparo reciente de otro gato, cerca
    if (now - this.lastHeard > 1) {
      this.lastHeard = now;
      for (let i = g.shotLog.length - 1; i >= 0; i--) {
        const s = g.shotLog[i] as { x: number; y: number; t: number; owner: number };
        if (now - s.t > 2.5) break;
        if (s.owner === c.id) continue;
        const d = dist(c.x, c.y, s.x, s.y);
        if (d > 70 && d < 300 && this.aggression > 0.45 && this.rng.chance(0.55)) {
          this.roamGoal = { x: s.x, y: s.y };
          this.investigateAt = now + 6;
          this.campUntil = 0;
          break;
        }
      }
    }
    // Caceria: cada tanto va hacia una zona donde anda alguien (con error). Al final de la partida
    // (pocos gatos vivos o muchos minutos) los bots armados salen directo a buscar pelea.
    if (now >= this.nextHuntAt) {
      const alive = g.aliveCats();
      const late = alive.length <= 3 || now > 480;
      this.nextHuntAt = now + (late ? this.rng.range(5, 9) : this.rng.range(25, 45));
      if ((late || this.aggression > 0.7) && this.armed() && alive.length > 1) {
        const others = alive.filter((o) => o.id !== c.id);
        const prey = late
          ? others.reduce((a, b) => (dist(c.x, c.y, a.x, a.y) < dist(c.x, c.y, b.x, b.y) ? a : b))
          : this.rng.pick(others);
        const err = late ? 40 : 170;
        this.roamGoal = {
          x: prey.x + this.rng.range(-err, err),
          y: prey.y + this.rng.range(-err, err),
        };
        this.investigateAt = now + 12;
        this.campUntil = 0;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- inventario

  private weaponScore(item: Item): number {
    const def = WEAPONS[item.kind as WeaponKind];
    const dmg = def.damage[item.rarity] as number;
    return (dmg * def.pellets * 0.6) / def.cooldown + def.range * 0.15;
  }

  private wanted(item: Item): boolean {
    const c = this.cat;
    const free = c.inv.some((it) => it === null);
    const stackRoom = c.inv.some(
      (it) => it && it.kind === item.kind && it.rarity === item.rarity && it.qty < 3,
    );
    if (isWeapon(item.kind)) {
      if (!free) return false;
      const owned = c.inv.filter((it): it is Item => !!it && isWeapon(it.kind));
      if (owned.length >= 3) return false;
      return !owned.some((o) => o.kind === item.kind && o.rarity >= item.rarity);
    }
    if (isAmmo(item.kind)) return c.ammo[item.kind] < AMMO_MAX;
    if (item.kind === 'wall')
      return (free && c.inv.filter((it) => it === null).length >= 2) || stackRoom;
    return free || stackRoom;
  }

  private priority(item: Item): number {
    if (isWeapon(item.kind)) return 3 + this.weaponScore(item) / 100;
    if (isAmmo(item.kind)) {
      const owns = this.cat.inv.some(
        (it) => it && isWeapon(it.kind) && WEAPONS[it.kind].ammo === item.kind,
      );
      return owns ? 2.4 : 1.2;
    }
    return item.kind === 'medkit' ? 1.8 : item.kind === 'shield' ? 1.6 : 0.2;
  }

  private takeUseful(contents: Contents): void {
    const g = this.game;
    const c = this.cat;
    for (let guard = 0; guard < 8; guard++) {
      const view = g.contents(c.id, contents.id);
      if (!view) return;
      let pick = -1;
      let pickScore = 0;
      view.items.forEach((item, i) => {
        if (!this.wanted(item)) return;
        const s = this.priority(item);
        if (s > pickScore) {
          pickScore = s;
          pick = i;
        }
      });
      if (pick < 0) return;
      g.lootTake(c.id, contents.id, pick);
    }
  }

  // ---------------------------------------------------------------- botin

  private loot(now: number): boolean {
    const g = this.game;
    const c = this.cat;
    if (this.lootTarget === null) {
      // Con los bolsillos llenos de lo importante ya no vale la pena revolver mas cofres.
      const geared =
        this.armed() &&
        c.ammo.ammo_pistol +
          c.ammo.ammo_rifle +
          c.ammo.ammo_shotgun +
          c.ammo.ammo_sniper +
          c.ammo.ammo_bazooka >=
          70;
      const lowAmmo =
        c.ammo.ammo_pistol +
          c.ammo.ammo_rifle +
          c.ammo.ammo_shotgun +
          c.ammo.ammo_sniper +
          c.ammo.ammo_bazooka <
        30;
      let best: { id: number; score: number } | null = null;
      for (const box of g.allContainers()) {
        if (this.done.has(box.id)) continue;
        if (!insideCircle(this.safeNow(), box.x, box.y)) continue;
        const isChest = box.kind === 'chest' || box.kind === 'golden' || box.kind === 'ammo';
        if (!isChest && box.items.length === 0) continue;
        if (isChest && box.opened && box.items.length === 0) continue;
        const d = dist(c.x, c.y, box.x, box.y);
        if (d > (geared ? 260 : 800)) continue;
        const bonus =
          (box.kind === 'golden' ? 70 : 0) +
          (box.kind === 'tomb' ? 40 : 0) +
          (box.kind === 'ammo' ? (lowAmmo ? 140 : 30) : 0);
        // Un cofre con otro gato a la vista cerca se evita: nadie quiere empezar a balazos en el cofre.
        const crowded = g.cats.some(
          (o) =>
            o.alive &&
            o.id !== c.id &&
            dist(o.x, o.y, box.x, box.y) < 100 &&
            dist(c.x, c.y, o.x, o.y) < this.sight * 1.4 &&
            hasLineOfSight(g.map, c.x, c.y, o.x, o.y),
        );
        const score = d - bonus + this.rng.range(0, 25) + (crowded ? 160 : 0);
        if (!best || score < best.score) best = { id: box.id, score };
      }
      if (!best) return false;
      this.lootTarget = best.id;
      this.rummageUntil = 0;
    }
    const box = g.allContainers().find((b) => b.id === this.lootTarget);
    if (
      !box ||
      (box.items.length === 0 && (box.kind === 'tomb' || box.kind === 'drop')) ||
      !insideCircle(this.safeNow(), box.x, box.y)
    ) {
      this.lootTarget = null;
      return false;
    }
    this.mode = 'loot';
    if (dist(c.x, c.y, box.x, box.y) <= CAT.interactRange - 6) {
      // Revolver el cofre toma un momento.
      if (this.rummageUntil === 0) this.rummageUntil = now + this.rng.range(0.4, 0.9);
      if (now < this.rummageUntil) return true;
      this.rummageUntil = 0;
      const contents = g.interact(c.id) as Contents | null;
      if (contents) this.takeUseful(contents);
      this.done.add(box.id);
      this.lootTarget = null;
      if (!c.heal) this.equipBest(100, true);
      return true;
    }
    const run = this.sprint(
      !this.armed() && this.sprinty > 0.6 && dist(c.x, c.y, box.x, box.y) > 120,
    );
    const r = this.navTo(box.x, box.y, run, CAT.interactRange - 8);
    if (r === 'blocked') {
      this.done.add(box.id);
      this.lootTarget = null;
    }
    return true;
  }

  // ---------------------------------------------------------------- merodeo

  private pickRoamGoal(): { x: number; y: number } {
    const g = this.game;
    const mode = g.botGoal(this.cat);
    if (mode) {
      const x = Math.min(g.map.w * TILE - 40, Math.max(40, mode.x + this.rng.range(-26, 26)));
      const y = Math.min(g.map.h * TILE - 40, Math.max(40, mode.y + this.rng.range(-26, 26)));
      if (!isSolidTile(g.map, Math.floor(x / TILE), Math.floor(y / TILE))) return { x, y };
      return mode;
    }
    const mapW = g.map.w * TILE;
    const mapH = g.map.h * TILE;
    const z = g.zone;
    const early = z.phase === 0 && z.nextIn > 12;
    const circle = z.next && z.next.r > 0 && z.nextIn < 60 ? z.next : z.circle;
    for (let tries = 0; tries < 8; tries++) {
      let x: number;
      let y: number;
      const roll = this.rng.next();
      if (roll < 0.35 && g.map.houses.length > 0) {
        const h = this.rng.pick(g.map.houses);
        x = (h.x + h.w / 2) * TILE + this.rng.range(-20, 20);
        y = (h.y + h.h / 2) * TILE + this.rng.range(-14, 14);
        // una casa fuera de la zona no sirve: la ola lo haria volver enseguida
        if (!insideCircle({ cx: circle.cx, cy: circle.cy, r: circle.r * 0.8 }, x, y)) continue;
      } else if (early) {
        x = this.rng.range(60, mapW - 60);
        y = this.rng.range(60, mapH - 60);
      } else {
        const r = Math.max(30, Math.min(circle.r, 420) * 0.85);
        const a = this.rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(this.rng.next()) * r;
        x = circle.cx + Math.cos(a) * rr;
        y = circle.cy + Math.sin(a) * rr;
      }
      x = Math.min(mapW - 40, Math.max(40, x));
      y = Math.min(mapH - 40, Math.max(40, y));
      if (
        !isSolidTile(g.map, Math.floor(x / TILE), Math.floor(y / TILE)) &&
        !isWaterAtPx(g.map, x, y)
      ) {
        return { x, y };
      }
    }
    return { x: circle.cx, y: circle.cy };
  }

  private roam(now: number): void {
    const c = this.cat;
    if (now < this.campUntil) {
      this.mode = 'camp';
      this.game.fireControl(c, c.aim, false);
      return;
    }
    this.mode = 'roam';
    if (!this.roamGoal) {
      this.roamGoal = this.pickRoamGoal();
      this.roamRun = this.rng.chance(0.3);
    }
    const run = this.sprint(this.roamRun && this.sprinty > 0.5);
    const r = this.navTo(this.roamGoal.x, this.roamGoal.y, run, 14);
    if (r === 'arrived' || r === 'blocked') {
      this.roamGoal = null;
      // De vez en cuando se queda un momento vigilando: nunca mucho tiempo.
      if (r === 'arrived' && this.rng.chance(0.2)) this.campUntil = now + this.rng.range(1, 3);
    }
    this.game.fireControl(c, c.aim, false);
  }
}
