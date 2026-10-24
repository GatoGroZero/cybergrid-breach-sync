import { CAT, INVENTORY_SLOTS, TICK_DT, TILE } from '../../shared/br/constants';
import { countKind } from '../../shared/br/inventory';
import { ITEM_KINDS, STACK_MAX, WEAPONS, isAmmo, isWeapon, type Item } from '../../shared/br/items';
import { G, isSolidTile, type BRMap } from '../../shared/br/map';
import { hasLineOfSight, stepCat, dist } from '../../shared/br/physics';
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

export class BotBrain {
  private path: number[] = [];
  private pathIdx = 0;
  private pathKey = '';
  private lootTarget: number | null = null;
  private readonly done = new Set<number>();
  private enemy: Cat | null = null;
  private seenAt = 0;
  private nextScan = 0;
  private nextEquip = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private aimJitter = 0;
  private jitterUntil = 0;
  private stuckAt = 0;
  private lastX = 0;
  private lastY = 0;
  private roamGoal: { x: number; y: number } | null = null;
  private readonly aimError: number;
  private readonly reaction: number;
  private readonly boldness: number;

  constructor(
    private readonly game: BRGame,
    private readonly cat: Cat,
    private readonly rng: Rng,
  ) {
    this.aimError = rng.range(0.07, 0.16);
    this.reaction = rng.range(0.35, 0.75);
    this.boldness = rng.range(0.3, 1);
    this.lastX = cat.x;
    this.lastY = cat.y;
  }

  think(dt: number): void {
    const g = this.game;
    const c = this.cat;
    const now = g.time;
    if (now >= this.nextScan) {
      this.nextScan = now + 0.2;
      this.scan();
    }
    if (now >= this.nextEquip && !c.heal) {
      this.nextEquip = now + 0.6;
      this.equipBest();
    }
    c.moving = false;

    const z = g.zone;
    const outside = z.dps > 0 && !insideCircle(z.circle, c.x, c.y);
    const soon =
      z.next !== null &&
      z.next.r > 0 &&
      z.nextIn < 25 &&
      !insideCircle(z.next, c.x, c.y) &&
      z.phase >= 0;
    const enemy = this.enemy;
    const enemyClose = enemy !== null && dist(c.x, c.y, enemy.x, enemy.y) < 110;

    // 1) curarse cuando no hay peligro cerca
    if (!enemyClose || (c.hp < 30 && !c.heal)) {
      if (this.tryHeal()) return;
    }
    if (c.heal) {
      // sigue curandose, quieto
      g.fireControl(c, c.aim, false, false);
      return;
    }

    // 2) huir de la ola
    if ((outside || soon) && !(enemyClose && enemy && dist(c.x, c.y, enemy.x, enemy.y) < 60)) {
      const target = outside || !z.next ? z.circle : z.next;
      this.goTo(target.cx, target.cy, dt);
      this.aimAt(enemy && enemyClose ? enemy : null, now);
      return;
    }

    // 3) pelear
    if (enemy && enemy.alive) {
      this.fight(enemy, dt);
      return;
    }

    // 4) buscar botin y 5) merodear cerca del centro de la zona
    if (this.loot(dt)) return;
    this.roam(dt);
  }

  // ---------------------------------------------------------------- percepcion

  private scan(): void {
    const c = this.cat;
    let best: Cat | null = null;
    let bestD = 200;
    for (const o of this.game.cats) {
      if (!o.alive || o.id === c.id) continue;
      const d = dist(c.x, c.y, o.x, o.y);
      if (d < bestD && hasLineOfSight(this.game.map, c.x, c.y, o.x, o.y)) {
        bestD = d;
        best = o;
      }
    }
    if (best && (!this.enemy || this.enemy.id !== best.id)) this.seenAt = this.game.time;
    this.enemy = best;
  }

  // ---------------------------------------------------------------- inventario

  private weaponScore(item: Item): number {
    const def = WEAPONS[item.kind as keyof typeof WEAPONS];
    const dmg = def.damage[item.rarity] as number;
    return (dmg * def.pellets * 0.6) / def.cooldown + def.range * 0.15;
  }

  private equipBest(): void {
    const c = this.cat;
    let bestSlot = -1;
    let bestScore = -1;
    c.inv.forEach((item, i) => {
      if (!item || !isWeapon(item.kind)) return;
      const def = WEAPONS[item.kind];
      if (countKind(c.inv, def.ammo) < def.ammoPerShot) return;
      const score = this.weaponScore(item);
      if (score > bestScore) {
        bestScore = score;
        bestSlot = i;
      }
    });
    if (bestSlot >= 0) {
      if (c.sel !== bestSlot) this.game.select(c.id, bestSlot);
      return;
    }
    const empty = c.inv.findIndex((it) => it === null);
    if (empty >= 0) {
      if (c.sel !== empty) this.game.select(c.id, empty);
    } else if (c.sel !== INVENTORY_SLOTS - 1 || c.inv[c.sel]) {
      this.game.invDrop(c.id, INVENTORY_SLOTS - 1);
      this.game.select(c.id, INVENTORY_SLOTS - 1);
    }
  }

  private tryHeal(): boolean {
    const c = this.cat;
    if (c.heal) return true;
    const needHp = c.hp < 55;
    const needShield = c.shield < 40 && c.hp >= 55;
    if (!needHp && !needShield) return false;
    const kind = needHp ? 'medkit' : 'shield';
    const slot = c.inv.findIndex((it) => it && it.kind === kind);
    if (slot < 0) return false;
    this.game.select(c.id, slot);
    this.game.fireControl(c, c.aim, false, false);
    this.game.fireControl(c, c.aim, true, false);
    return true;
  }

  private wanted(item: Item): boolean {
    const c = this.cat;
    const free = c.inv.some((it) => it === null);
    const stackRoom = c.inv.some(
      (it) =>
        it && it.kind === item.kind && it.rarity === item.rarity && it.qty < STACK_MAX[item.kind],
    );
    if (isWeapon(item.kind)) {
      if (!free) return false;
      const owned = c.inv.filter((it): it is Item => !!it && isWeapon(it.kind));
      if (owned.length >= 3) return false;
      return !owned.some((o) => o.kind === item.kind && o.rarity >= item.rarity);
    }
    if (isAmmo(item.kind)) {
      const weaponOwned = c.inv.some(
        (it) => it && isWeapon(it.kind) && WEAPONS[it.kind].ammo === item.kind,
      );
      return (weaponOwned || !c.inv.some((it) => it && isWeapon(it.kind))) && (free || stackRoom);
    }
    if (item.kind === 'wall') return free && c.inv.filter((it) => it === null).length >= 2;
    return free || stackRoom;
  }

  private priority(item: Item): number {
    if (isWeapon(item.kind)) return 3 + this.weaponScore(item) / 100;
    if (isAmmo(item.kind)) return 2;
    return item.kind === 'medkit' ? 1.6 : item.kind === 'shield' ? 1.5 : 0.1;
  }

  // ---------------------------------------------------------------- botin

  private loot(dt: number): boolean {
    const g = this.game;
    const c = this.cat;
    if (this.lootTarget === null) {
      let best: { id: number; d: number } | null = null;
      for (const box of g.allContainers()) {
        if (this.done.has(box.id)) continue;
        const isChest = box.kind === 'chest' || box.kind === 'golden';
        if (!isChest && box.items.length === 0) continue;
        if (isChest && box.opened && box.items.length === 0) continue;
        const d = dist(c.x, c.y, box.x, box.y) - (box.kind === 'golden' ? 40 : 0);
        if (!best || d < best.d) best = { id: box.id, d };
      }
      if (!best || best.d > 520) return false;
      this.lootTarget = best.id;
    }
    const box = g.allContainers().find((b) => b.id === this.lootTarget);
    if (!box) {
      this.lootTarget = null;
      return false;
    }
    if (dist(c.x, c.y, box.x, box.y) <= CAT.interactRange - 6) {
      const contents = g.interact(c.id) as Contents | null;
      if (contents) this.takeUseful(contents);
      this.done.add(box.id);
      this.lootTarget = null;
      this.equipBest();
      return true;
    }
    const reached = this.goTo(box.x, box.y, dt);
    if (reached === 'blocked') {
      this.done.add(box.id);
      this.lootTarget = null;
    }
    return true;
  }

  private takeUseful(contents: Contents): void {
    const g = this.game;
    const c = this.cat;
    for (let guard = 0; guard < 6; guard++) {
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
    void ITEM_KINDS;
  }

  // ---------------------------------------------------------------- combate

  private aimAt(enemy: Cat | null, now: number): void {
    if (!enemy) return;
    if (now >= this.jitterUntil) {
      this.jitterUntil = now + 0.25;
      this.aimJitter = this.rng.range(-this.aimError, this.aimError);
    }
    this.cat.aim = Math.atan2(enemy.y - this.cat.y, enemy.x - this.cat.x) + this.aimJitter;
  }

  private fight(enemy: Cat, dt: number): void {
    const g = this.game;
    const c = this.cat;
    const now = g.time;
    const item = g.held(c);
    const def = item && isWeapon(item.kind) ? WEAPONS[item.kind] : null;
    const d = dist(c.x, c.y, enemy.x, enemy.y);
    this.aimAt(enemy, now);

    const range = def ? def.range : 16;
    const preferred = def
      ? def.kind === 'shotgun'
        ? 34
        : def.kind === 'sniper'
          ? 150
          : def.kind === 'bazooka'
            ? 110
            : 88
      : 10;
    let mx: number;
    let my: number;
    const toward = Math.atan2(enemy.y - c.y, enemy.x - c.x);
    if (d > preferred + 14) {
      mx = Math.cos(toward);
      my = Math.sin(toward);
    } else if (d < preferred - 14 && def && def.kind !== 'shotgun') {
      mx = -Math.cos(toward);
      my = -Math.sin(toward);
    } else {
      if (now >= this.strafeUntil) {
        this.strafeUntil = now + this.rng.range(0.7, 1.8);
        this.strafe = this.rng.chance(0.5) ? 1 : -1;
      }
      mx = Math.cos(toward + (Math.PI / 2) * this.strafe);
      my = Math.sin(toward + (Math.PI / 2) * this.strafe);
    }
    const before = { x: c.x, y: c.y };
    stepCat(
      g.map,
      c,
      { mx: mx * (0.55 + this.boldness * 0.45), my: my * (0.55 + this.boldness * 0.45) },
      dt,
    );
    c.moving = Math.hypot(c.x - before.x, c.y - before.y) > 0.05;

    const ready = now - this.seenAt >= this.reaction;
    const wantFire =
      ready && d <= range * 0.95 && hasLineOfSight(g.map, c.x, c.y, enemy.x, enemy.y);
    const press = wantFire && (def ? def.auto || !c.prevFire : !c.prevFire);
    g.fireControl(c, c.aim, press, false);
    void TICK_DT;
  }

  // ---------------------------------------------------------------- movimiento

  /** Avanza por un camino hacia (x, y). Devuelve 'blocked' si no hay ruta. */
  private goTo(x: number, y: number, dt: number): 'moving' | 'blocked' {
    const g = this.game;
    const c = this.cat;
    const map = g.map;
    const gx = Math.floor(x / TILE);
    const gy = Math.floor(y / TILE);
    const key = `${gx},${gy}`;
    const sx = Math.floor(c.x / TILE);
    const sy = Math.floor(c.y / TILE);
    const now = g.time;

    if (key !== this.pathKey || now >= this.stuckAt + 3 || this.pathIdx >= this.path.length) {
      // Primero se busca una ruta seca; el agua dana, asi que solo se cruza si no hay otra.
      const path = findPath(map, sx, sy, gx, gy) ?? findPath(map, sx, sy, gx, gy, false);
      this.pathKey = key;
      this.stuckAt = now;
      if (!path) {
        this.path = [];
        return 'blocked';
      }
      this.path = path;
      this.pathIdx = 0;
    }
    while (this.pathIdx < this.path.length) {
      const node = this.path[this.pathIdx] as number;
      const nx = (node % map.w) * TILE + TILE / 2;
      const ny = ((node / map.w) | 0) * TILE + TILE / 2;
      if (Math.hypot(nx - c.x, ny - c.y) < 4) this.pathIdx++;
      else break;
    }
    const node = this.path[this.pathIdx];
    if (node === undefined) return 'moving';
    const tx = (node % map.w) * TILE + TILE / 2;
    const ty = ((node / map.w) | 0) * TILE + TILE / 2;
    const len = Math.hypot(tx - c.x, ty - c.y) || 1;
    const before = { x: c.x, y: c.y };
    stepCat(map, c, { mx: (tx - c.x) / len, my: (ty - c.y) / len }, dt);
    c.moving = Math.hypot(c.x - before.x, c.y - before.y) > 0.05;
    c.aim = Math.atan2(ty - c.y, tx - c.x);
    if (c.moving) {
      this.lastX = c.x;
      this.lastY = c.y;
      this.stuckAt = Math.max(this.stuckAt, now - 2);
    }
    return 'moving';
  }

  private roam(dt: number): void {
    const g = this.game;
    const c = this.cat;
    const z = g.zone.next && g.zone.next.r > 0 && g.zone.nextIn < 60 ? g.zone.next : g.zone.circle;
    if (
      !this.roamGoal ||
      dist(c.x, c.y, this.roamGoal.x, this.roamGoal.y) < 20 ||
      this.rng.chance(0.002)
    ) {
      const r = Math.max(30, Math.min(z.r, 400) * 0.7);
      const a = this.rng.range(0, Math.PI * 2);
      this.roamGoal = {
        x: Math.min(g.map.w * TILE - 40, Math.max(40, z.cx + Math.cos(a) * this.rng.next() * r)),
        y: Math.min(g.map.h * TILE - 40, Math.max(40, z.cy + Math.sin(a) * this.rng.next() * r)),
      };
    }
    const res = this.goTo(this.roamGoal.x, this.roamGoal.y, dt);
    if (res === 'blocked') this.roamGoal = null;
    this.game.fireControl(c, c.aim, false, false);
  }
}
