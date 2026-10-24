import { applyDamage, healMissing, healStep, splashDamage, type HealKind } from '../../shared/br/combat';
import { CAT, INTEREST_RADIUS, INVENTORY_SLOTS, TICK_DT, TILE, WALL_ITEM, WATER, FLAG } from '../../shared/br/constants';
import {
  addItem,
  cloneItem,
  consume,
  countKind,
  emptyInventory,
  moveSlot,
  placeInSlot,
  takeOne,
  type Inventory,
} from '../../shared/br/inventory';
import {
  CLAWS,
  ITEM_KINDS,
  WEAPONS,
  isWeapon,
  rollChest,
  type Item,
  type WeaponDef,
  type WeaponKind,
} from '../../shared/br/items';
import {
  generateMap,
  isWaterAtPx,
  isSolidTile,
  mapHeightPx,
  mapWidthPx,
  type BRMap,
  type MapKind,
} from '../../shared/br/map';
import {
  dist,
  hasLineOfSight,
  segmentCircleHit,
  segmentSolidHit,
  stepCat,
} from '../../shared/br/physics';
import type {
  DiedPayload,
  GameEndPayload,
  InputPayload,
  LootContents,
  PlacementRow,
} from '../../shared/br/protocol';
import type { Skin } from '../../shared/br/skin';
import type {
  BREvent,
  BRSnapshot,
  CatTuple,
  ContainerTuple,
  MeState,
  ShotTuple,
  WallTuple,
  ZoneView,
} from '../../shared/br/types';
import { ZONE_TIMELINE, insideCircle, planZones, zoneAt, type ZonePlan, type ZoneState } from '../../shared/br/zone';
import { createRng, type Rng } from '../../shared/rng';
import { BotBrain } from './bots';

export interface CatInit {
  id: number;
  name: string;
  userId: number | null;
  bot: boolean;
  skin: Skin;
}

export interface GameOptions {
  seed: number;
  mapKind: MapKind;
  cats: CatInit[];
}

export interface Cat {
  id: number;
  name: string;
  userId: number | null;
  bot: boolean;
  skin: Skin;
  x: number;
  y: number;
  hp: number;
  shield: number;
  alive: boolean;
  /** Angulo de apuntado en radianes. */
  aim: number;
  inv: Inventory;
  sel: number;
  heal: { kind: HealKind; elapsed: number } | null;
  cooldownUntil: number;
  prevFire: boolean;
  kills: number;
  damageDealt: number;
  placement: number;
  diedAt: number;
  killerId: number | null;
  queue: InputPayload[];
  budget: number;
  lastSeq: number;
  moving: boolean;
  connected: boolean;
  offlineFor: number;
  zoneAcc: number;
  waterAcc: number;
  hurtUntil: number;
  invDirty: boolean;
  spectate: number | null;
}

interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  dmg: number;
  owner: number;
  left: number;
  weapon: WeaponKind;
  rarity: 0 | 1 | 2;
  kind: number;
  splash: number;
  angle: number;
}

interface Wall {
  id: number;
  tx: number;
  ty: number;
  hp: number;
  owner: number;
}

export type ContainerKind = 'chest' | 'golden' | 'tomb' | 'drop';

interface Container {
  id: number;
  kind: ContainerKind;
  x: number;
  y: number;
  items: Item[];
  opened: boolean;
  title: string;
}

const SHOT_KIND: Record<WeaponKind, number> = { pistol: 0, rifle: 0, shotgun: 1, sniper: 2, bazooka: 3 };
const CONTAINER_CODE: Record<ContainerKind, number> = { chest: 0, golden: 1, tomb: 2, drop: 3 };
const HIT_RADIUS = 7;
const MAX_SHOTS = 320;
const MAX_WALLS = 120;
const OFFLINE_FORFEIT_S = 25;
const HARD_CAP_S = ZONE_TIMELINE.end + 45;

const q1 = (v: number): number => Math.round(v * 10) / 10;

export class BRGame {
  readonly map: BRMap;
  readonly seed: number;
  readonly mapKind: MapKind;
  readonly cats: Cat[];
  readonly startedAt = Date.now();
  readonly plan: ZonePlan;
  readonly rng: Rng;

  tick = 0;
  time = 0;
  result: GameEndPayload | null = null;
  zone: ZoneState;

  private readonly shots: Shot[] = [];
  private readonly walls = new Map<number, Wall>();
  private readonly wallByTile = new Map<number, Wall>();
  private readonly containers = new Map<number, Container>();
  private events: BREvent[] = [];
  private nextId = 10_000;
  private lastPhase = -1;
  private readonly brains = new Map<number, BotBrain>();
  private readonly deaths: DiedPayload[] = [];
  private readonly deathOwners: number[] = [];

  constructor(options: GameOptions) {
    this.seed = options.seed;
    this.mapKind = options.mapKind;
    this.map = generateMap(options.mapKind, options.seed);
    this.rng = createRng((options.seed ^ 0x9e3779b9) >>> 0);
    this.plan = planZones(createRng((options.seed ^ 0x5bd1e995) >>> 0), mapWidthPx(this.map), mapHeightPx(this.map));
    this.zone = zoneAt(this.plan, mapWidthPx(this.map), mapHeightPx(this.map), 0);

    const spawns = this.rng.shuffle([...this.map.spawns]);
    this.cats = options.cats.map((init, i) => {
      const sp = spawns[i % spawns.length] as { x: number; y: number };
      const cat: Cat = {
        id: init.id,
        name: init.name,
        userId: init.userId,
        bot: init.bot,
        skin: init.skin,
        x: sp.x,
        y: sp.y,
        hp: CAT.maxHp,
        shield: CAT.startShield,
        alive: true,
        aim: 0,
        inv: emptyInventory(),
        sel: 0,
        heal: null,
        cooldownUntil: 0,
        prevFire: false,
        kills: 0,
        damageDealt: 0,
        placement: 0,
        diedAt: 0,
        killerId: null,
        queue: [],
        budget: 3 * TICK_DT,
        lastSeq: 0,
        moving: false,
        connected: true,
        offlineFor: 0,
        zoneAcc: 0,
        waterAcc: 0,
        hurtUntil: 0,
        invDirty: true,
        spectate: null,
      };
      return cat;
    });

    // Cofres con su contenido sorteado desde el inicio (la semilla del servidor, no la del cliente).
    const lootRng = createRng((options.seed ^ 0xc0ffee) >>> 0);
    for (const spot of this.map.chests) {
      this.containers.set(spot.id, {
        id: spot.id,
        kind: spot.golden ? 'golden' : 'chest',
        x: spot.x,
        y: spot.y,
        items: rollChest(lootRng, spot.golden ? 'golden' : 'normal'),
        opened: false,
        title: spot.golden ? 'Cofre dorado' : 'Cofre',
      });
    }
    for (const cat of this.cats) {
      if (cat.bot) this.brains.set(cat.id, new BotBrain(this, cat, createRng((options.seed + cat.id * 7919) >>> 0)));
    }
  }

  // ---------------------------------------------------------------- consultas

  get over(): boolean {
    return this.result !== null;
  }

  cat(id: number): Cat | undefined {
    return this.cats.find((c) => c.id === id);
  }

  aliveCats(): Cat[] {
    return this.cats.filter((c) => c.alive);
  }

  private humans(): Cat[] {
    return this.cats.filter((c) => !c.bot);
  }

  held(cat: Cat): Item | null {
    return cat.inv[cat.sel] ?? null;
  }

  private emit(ev: BREvent): void {
    if (this.events.length < 220) this.events.push(ev);
  }

  /** Cofres, lapidas y objetos tirados, para los bots y las pruebas. */
  allContainers(): Container[] {
    return [...this.containers.values()];
  }

  wallList(): Wall[] {
    return [...this.walls.values()];
  }

  shotCount(): number {
    return this.shots.length;
  }

  // ---------------------------------------------------------------- entradas

  pushInput(catId: number, input: InputPayload): void {
    const cat = this.cat(catId);
    if (!cat || !cat.alive || this.over) return;
    cat.queue.push(input);
    if (cat.queue.length > 12) cat.queue.splice(0, cat.queue.length - 12);
  }

  setConnected(catId: number, connected: boolean): void {
    const cat = this.cat(catId);
    if (!cat) return;
    cat.connected = connected;
    if (connected) {
      cat.offlineFor = 0;
      cat.invDirty = true;
    }
  }

  /** Cambia el objeto en mano. Cambiar de objeto cancela cualquier curacion en curso. */
  select(catId: number, slot: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive || slot < 0 || slot >= INVENTORY_SLOTS) return false;
    if (slot !== cat.sel) {
      cat.heal = null;
      cat.sel = slot;
    }
    return true;
  }

  private applyInput(cat: Cat, input: InputPayload): void {
    cat.lastSeq = input.seq;
    const before = { x: cat.x, y: cat.y };
    stepCat(this.map, cat, { mx: input.mx, my: input.my }, TICK_DT);
    cat.moving = Math.hypot(cat.x - before.x, cat.y - before.y) > 0.05;
    this.fireControl(cat, input.aim, input.fire, input.assist);
  }

  /** Disparo, uso del objeto en mano o garras segun lo que lleve el gato. */
  fireControl(cat: Cat, aimIn: number, fire: boolean, assist: boolean): void {
    const edge = fire && !cat.prevFire;
    cat.prevFire = fire;
    let aim = aimIn;
    const item = this.held(cat);
    const def = item && isWeapon(item.kind) ? WEAPONS[item.kind] : null;
    if (assist) {
      const target = this.nearestEnemy(cat, def ? def.range : 60);
      if (target) aim = Math.atan2(target.y - cat.y, target.x - cat.x);
    }
    cat.aim = aim;
    if (!fire) return;

    if (item && def) {
      if (!def.auto && !edge) return;
      this.shoot(cat, item, def, aim);
    } else if (item && (item.kind === 'medkit' || item.kind === 'shield')) {
      if (edge) this.startHeal(cat, item.kind);
    } else if (item && item.kind === 'wall') {
      if (edge) this.placeWall(cat, aim);
    } else if (!item && this.time >= cat.cooldownUntil) {
      this.claw(cat, aim);
    }
  }

  private nearestEnemy(cat: Cat, range: number): Cat | null {
    let best: Cat | null = null;
    let bestD = range;
    for (const other of this.cats) {
      if (!other.alive || other.id === cat.id) continue;
      const d = dist(cat.x, cat.y, other.x, other.y);
      if (d < bestD && hasLineOfSight(this.map, cat.x, cat.y, other.x, other.y)) {
        bestD = d;
        best = other;
      }
    }
    return best;
  }

  private shoot(cat: Cat, item: Item, def: WeaponDef, aim: number): void {
    if (this.time < cat.cooldownUntil) return;
    if (countKind(cat.inv, def.ammo) < def.ammoPerShot) return;
    if (this.shots.length > MAX_SHOTS) return;
    consume(cat.inv, def.ammo, def.ammoPerShot);
    cat.invDirty = true;
    cat.cooldownUntil = this.time + def.cooldown;
    cat.heal = null;
    const dmg = def.damage[item.rarity] as number;
    for (let p = 0; p < def.pellets; p++) {
      const jitter =
        def.pellets > 1
          ? (p / (def.pellets - 1) - 0.5) * def.spread * 2 + this.rng.range(-0.03, 0.03)
          : this.rng.range(-def.spread, def.spread);
      const a = aim + jitter;
      this.shots.push({
        id: this.nextId++,
        x: cat.x,
        y: cat.y - 1,
        vx: Math.cos(a) * def.speed,
        vy: Math.sin(a) * def.speed,
        speed: def.speed,
        dmg,
        owner: cat.id,
        left: def.range,
        weapon: def.kind,
        rarity: item.rarity,
        kind: SHOT_KIND[def.kind],
        splash: def.splash,
        angle: a,
      });
    }
    this.emit({ e: 'shot', x: q1(cat.x), y: q1(cat.y), a: Math.round((aim * 180) / Math.PI), w: ITEM_KINDS.indexOf(def.kind) });
  }

  private claw(cat: Cat, aim: number): void {
    cat.cooldownUntil = this.time + CLAWS.cooldown;
    this.emit({ e: 'claw', x: q1(cat.x), y: q1(cat.y), a: Math.round((aim * 180) / Math.PI) });
    for (const other of this.cats) {
      if (!other.alive || other.id === cat.id) continue;
      const d = dist(cat.x, cat.y, other.x, other.y);
      if (d > CLAWS.range + HIT_RADIUS) continue;
      const toOther = Math.atan2(other.y - cat.y, other.x - cat.x);
      const diff = Math.abs(Math.atan2(Math.sin(toOther - aim), Math.cos(toOther - aim)));
      if (diff < 0.9) this.damageCat(other, CLAWS.damage, cat);
    }
  }

  // ---------------------------------------------------------------- curacion

  /** El objeto se gasta al empezar. Si cancelas, lo que faltaba por curar se pierde. */
  private startHeal(cat: Cat, kind: HealKind): void {
    if (cat.heal) return;
    if (healMissing(kind, cat) <= 0) return;
    const slot = cat.sel;
    takeOne(cat.inv, slot);
    cat.invDirty = true;
    cat.heal = { kind, elapsed: 0 };
  }

  private updateHeal(cat: Cat, dt: number): void {
    const heal = cat.heal;
    if (!heal) return;
    heal.elapsed += dt;
    // Pequeña tolerancia: 30 ticks de 1/30 s suman 0.99999... y deben contar como un segundo.
    while (heal.elapsed >= 1 - 1e-6) {
      heal.elapsed -= 1;
      const r = healStep(heal.kind, cat);
      cat.hp = r.hp;
      cat.shield = r.shield;
      this.emit({ e: 'heal', x: q1(cat.x), y: q1(cat.y), kind: heal.kind === 'medkit' ? 'hp' : 'shield' });
      if (r.done) {
        cat.heal = null;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- muros

  private placeWall(cat: Cat, aim: number): void {
    if (this.walls.size >= MAX_WALLS) return;
    const px = cat.x + Math.cos(aim) * WALL_ITEM.placeDistance;
    const py = cat.y + Math.sin(aim) * WALL_ITEM.placeDistance;
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (isSolidTile(this.map, tx, ty) || isWaterAtPx(this.map, px, py)) return;
    // No se puede encerrar a nadie: ningun gato vivo debe tocar la casilla.
    for (const other of this.cats) {
      if (!other.alive) continue;
      const overlapX = Math.abs(other.x - (tx * TILE + TILE / 2)) < TILE / 2 + CAT.half;
      const overlapY = Math.abs(other.y - (ty * TILE + TILE / 2)) < TILE / 2 + CAT.half;
      if (overlapX && overlapY) return;
    }
    takeOne(cat.inv, cat.sel);
    cat.invDirty = true;
    const wall: Wall = { id: this.nextId++, tx, ty, hp: WALL_ITEM.hp, owner: cat.id };
    this.walls.set(wall.id, wall);
    this.wallByTile.set(ty * this.map.w + tx, wall);
    this.map.solid[ty * this.map.w + tx] = 2;
  }

  private damageWall(wall: Wall, dmg: number): void {
    wall.hp -= dmg;
    const x = wall.tx * TILE + TILE / 2;
    const y = wall.ty * TILE + TILE / 2;
    if (wall.hp <= 0) {
      this.walls.delete(wall.id);
      this.wallByTile.delete(wall.ty * this.map.w + wall.tx);
      this.map.solid[wall.ty * this.map.w + wall.tx] = 0;
      this.emit({ e: 'wallbreak', x, y });
    } else {
      this.emit({ e: 'wallhit', x, y });
    }
  }

  // ---------------------------------------------------------------- daño y muerte

  damageCat(target: Cat, amount: number, attacker: Cat | null): void {
    if (!target.alive || amount <= 0) return;
    const r = applyDamage(target, amount);
    target.hp = r.hp;
    target.shield = r.shield;
    target.hurtUntil = this.time + 0.25;
    if (attacker && attacker.id !== target.id) attacker.damageDealt += r.dealt;
    this.emit({ e: 'hit', x: q1(target.x), y: q1(target.y), v: Math.round(r.dealt), kill: target.hp <= 0 });
    if (target.hp <= 0) this.killCat(target, attacker);
  }

  private killCat(target: Cat, killer: Cat | null): void {
    const alive = this.aliveCats().length;
    target.alive = false;
    target.placement = alive;
    target.diedAt = this.time;
    target.heal = null;
    target.queue.length = 0;
    target.killerId = killer && killer.id !== target.id ? killer.id : null;
    if (killer && killer.id !== target.id) killer.kills++;
    this.emit({ e: 'death', x: q1(target.x), y: q1(target.y), id: target.id });

    const items = target.inv.filter((it): it is Item => it !== null).map(cloneItem);
    target.inv = emptyInventory();
    target.invDirty = true;
    this.containers.set(this.nextId, {
      id: this.nextId++,
      kind: 'tomb',
      x: target.x,
      y: target.y,
      items,
      opened: true,
      title: `Lápida de ${target.name}`,
    });

    if (!target.bot) {
      this.deaths.push({
        placement: target.placement,
        killerName: killer && killer.id !== target.id ? killer.name : null,
        kills: target.kills,
        survivalS: Math.round(this.time * 10) / 10,
      });
      this.deathOwners.push(target.id);
      target.spectate = killer && killer.alive ? killer.id : (this.aliveCats()[0]?.id ?? null);
    }
  }

  /** Muertes de humanos pendientes de avisar (las consume la sala). */
  drainDeaths(): { catId: number; payload: DiedPayload }[] {
    const out = this.deaths.map((payload, i) => ({ catId: this.deathOwners[i] as number, payload }));
    this.deaths.length = 0;
    this.deathOwners.length = 0;
    return out;
  }

  spectateNext(catId: number, dir: 1 | -1): void {
    const cat = this.cat(catId);
    if (!cat || cat.alive) return;
    const alive = this.aliveCats();
    if (alive.length === 0) return;
    const idx = alive.findIndex((c) => c.id === cat.spectate);
    cat.spectate = (alive[(idx + dir + alive.length * 2) % alive.length] as Cat).id;
  }

  // ---------------------------------------------------------------- cofres, lapidas, inventario

  private nearestContainer(cat: Cat, range: number): Container | null {
    let best: Container | null = null;
    let bestD = range;
    for (const c of this.containers.values()) {
      const isChest = c.kind === 'chest' || c.kind === 'golden';
      if (!isChest && c.items.length === 0) continue;
      const d = dist(cat.x, cat.y, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private contentsOf(c: Container): LootContents {
    return { id: c.id, kind: c.kind, title: c.title, items: c.items.map(cloneItem) };
  }

  /** Abre el contenedor mas cercano (cofre, lapida u objeto tirado). */
  interact(catId: number): LootContents | null {
    const cat = this.cat(catId);
    if (!cat || !cat.alive) return null;
    const c = this.nearestContainer(cat, CAT.interactRange);
    if (!c) return null;
    if (!c.opened) {
      c.opened = true;
      this.emit({ e: 'open', x: q1(c.x), y: q1(c.y), golden: c.kind === 'golden' });
    }
    return this.contentsOf(c);
  }

  contents(catId: number, containerId: number): LootContents | null {
    const cat = this.cat(catId);
    const c = this.containers.get(containerId);
    if (!cat || !cat.alive || !c || !c.opened) return null;
    if (dist(cat.x, cat.y, c.x, c.y) > CAT.interactRange + 10) return null;
    return this.contentsOf(c);
  }

  /** Pasa un objeto del contenedor al inventario. Si no cabe todo, el resto se queda. */
  lootTake(catId: number, containerId: number, index: number, slot?: number): LootContents | null {
    const cat = this.cat(catId);
    const c = this.containers.get(containerId);
    if (!cat || !cat.alive || !c || !c.opened) return null;
    if (dist(cat.x, cat.y, c.x, c.y) > CAT.interactRange + 10) return null;
    const item = c.items[index];
    if (!item) return this.contentsOf(c);
    let left: Item | null;
    if (slot !== undefined && slot >= 0 && slot < INVENTORY_SLOTS) {
      left = placeInSlot(cat.inv, slot, cloneItem(item));
      // Casilla ocupada por algo distinto: se usa el primer lugar libre.
      if (left && left.qty === item.qty) left = addItem(cat.inv, cloneItem(item));
    } else {
      left = addItem(cat.inv, cloneItem(item));
    }
    if (left === null) c.items.splice(index, 1);
    else item.qty = left.qty;
    cat.invDirty = true;
    this.cleanup(c);
    return this.contentsOf(c);
  }

  lootTakeAll(catId: number, containerId: number): LootContents | null {
    const first = this.contents(catId, containerId);
    const c = this.containers.get(containerId);
    if (!first || !c) return first;
    let i = 0;
    while (i < c.items.length) {
      const item = c.items[i] as Item;
      const qty = item.qty;
      const count = c.items.length;
      this.lootTake(catId, containerId, i);
      if (!this.containers.has(containerId)) break;
      // Si no cupo nada de este objeto se pasa al siguiente.
      if (c.items.length === count && c.items[i] === item && item.qty === qty) i++;
    }
    return this.containers.has(containerId) ? this.contentsOf(c) : { ...first, items: [] };
  }

  private cleanup(c: Container): void {
    if ((c.kind === 'tomb' || c.kind === 'drop') && c.items.length === 0) this.containers.delete(c.id);
  }

  invMove(catId: number, from: number, to: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive) return false;
    const heldBefore = cat.inv[cat.sel];
    const ok = moveSlot(cat.inv, from, to);
    if (!ok) return false;
    cat.invDirty = true;
    // Lo que tienes en mano se mueve con la casilla: si cambia, la curacion se cancela.
    if (cat.inv[cat.sel] !== heldBefore) cat.heal = null;
    return true;
  }

  /** Tira una casilla al suelo, donde se puede volver a recoger. */
  invDrop(catId: number, slot: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive || slot < 0 || slot >= INVENTORY_SLOTS) return false;
    const item = cat.inv[slot];
    if (!item) return false;
    cat.inv[slot] = null;
    cat.invDirty = true;
    if (slot === cat.sel) cat.heal = null;
    const near = [...this.containers.values()].find(
      (c) => c.kind === 'drop' && dist(c.x, c.y, cat.x, cat.y) < 10 && c.items.length < 8,
    );
    if (near) {
      near.items.push(item);
    } else {
      this.containers.set(this.nextId, {
        id: this.nextId++,
        kind: 'drop',
        x: cat.x,
        y: cat.y,
        items: [item],
        opened: true,
        title: 'Objetos tirados',
      });
    }
    return true;
  }

  // ---------------------------------------------------------------- avance de la simulacion

  step(): void {
    if (this.over) return;
    this.tick++;
    this.time += TICK_DT;
    this.zone = zoneAt(this.plan, mapWidthPx(this.map), mapHeightPx(this.map), this.time);
    if (this.zone.phase !== this.lastPhase) {
      this.lastPhase = this.zone.phase;
      if (this.zone.phase > 0) this.emit({ e: 'zone', phase: this.zone.phase });
    }

    for (const cat of this.cats) {
      if (!cat.alive) continue;
      if (!cat.bot && !cat.connected) {
        cat.offlineFor += TICK_DT;
        if (cat.offlineFor >= OFFLINE_FORFEIT_S) {
          this.damageCat(cat, 9999, null);
          continue;
        }
      }
      if (cat.bot) {
        this.brains.get(cat.id)?.think(TICK_DT);
        continue;
      }
      cat.moving = false;
      // Presupuesto de movimiento: un paso por tick (con 5 % de holgura) y rafagas de hasta 5.
      cat.budget = Math.min(cat.budget + TICK_DT * CAT.budgetSlack, CAT.budgetBurst * TICK_DT);
      while (cat.queue.length > 0 && cat.budget >= TICK_DT - 1e-9 && cat.alive) {
        const input = cat.queue.shift() as InputPayload;
        cat.budget -= TICK_DT;
        this.applyInput(cat, input);
      }
    }

    for (const cat of this.cats) if (cat.alive) this.updateHeal(cat, TICK_DT);
    this.updateShots(TICK_DT);
    this.hazards(TICK_DT);
    this.checkEnd();
  }

  private updateShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i] as Shot;
      const step = Math.min(s.speed * dt, s.left);
      const nx = s.x + Math.cos(s.angle) * step;
      const ny = s.y + Math.sin(s.angle) * step;

      let tHit = 2;
      let hitCat: Cat | null = null;
      const solid = segmentSolidHit(this.map, s.x, s.y, nx, ny);
      if (solid.hit) tHit = solid.t;
      for (const cat of this.cats) {
        if (!cat.alive || cat.id === s.owner) continue;
        const t = segmentCircleHit(s.x, s.y, nx, ny, cat.x, cat.y, HIT_RADIUS);
        if (t >= 0 && t < tHit) {
          tHit = t;
          hitCat = cat;
        }
      }

      s.left -= step;
      if (tHit > 1) {
        s.x = nx;
        s.y = ny;
        if (s.left <= 0.01) {
          if (s.splash > 0) this.explode(s, s.x, s.y, null);
          this.shots.splice(i, 1);
        }
        continue;
      }

      const hx = s.x + (nx - s.x) * tHit;
      const hy = s.y + (ny - s.y) * tHit;
      const owner = this.cat(s.owner) ?? null;
      if (hitCat) {
        if (s.splash > 0) this.explode(s, hx, hy, hitCat);
        else this.damageCat(hitCat, s.dmg, owner);
      } else {
        const wall = this.wallByTile.get(solid.ty * this.map.w + solid.tx);
        if (wall && s.splash === 0) this.damageWall(wall, s.dmg);
        if (s.splash > 0) this.explode(s, hx, hy, null);
      }
      this.shots.splice(i, 1);
    }
  }

  /** Explosion de bazuca: golpe directo completo y daño de area que baja con la distancia. */
  private explode(s: Shot, x: number, y: number, direct: Cat | null): void {
    this.emit({ e: 'boom', x: q1(x), y: q1(y), r: s.splash });
    const owner = this.cat(s.owner) ?? null;
    if (direct) this.damageCat(direct, s.dmg, owner);
    for (const cat of this.cats) {
      if (!cat.alive || cat === direct) continue;
      const d = dist(x, y, cat.x, cat.y);
      let dmg = splashDamage(s.dmg, d, s.splash + HIT_RADIUS);
      if (dmg > 0 && cat.id === s.owner) dmg = Math.ceil(dmg / 2);
      if (dmg > 0) this.damageCat(cat, dmg, owner);
    }
    for (const wall of [...this.walls.values()]) {
      const d = dist(x, y, wall.tx * TILE + TILE / 2, wall.ty * TILE + TILE / 2);
      const dmg = splashDamage(s.dmg, d, s.splash + TILE / 2);
      if (dmg > 0) this.damageWall(wall, dmg);
    }
  }

  /** La ola de la zona y el agua de la alberca danan primero al escudo. */
  private hazards(dt: number): void {
    for (const cat of this.cats) {
      if (!cat.alive) continue;
      if (this.zone.dps > 0 && !insideCircle(this.zone.circle, cat.x, cat.y)) {
        cat.zoneAcc += this.zone.dps * dt;
        if (cat.zoneAcc >= 1) {
          const whole = Math.floor(cat.zoneAcc);
          cat.zoneAcc -= whole;
          this.damageCat(cat, whole, null);
          if (!cat.alive) continue;
        }
      }
      if (isWaterAtPx(this.map, cat.x, cat.y)) {
        cat.waterAcc += dt;
        if (cat.waterAcc >= WATER.tick) {
          cat.waterAcc -= WATER.tick;
          this.emit({ e: 'splash', x: q1(cat.x), y: q1(cat.y) });
          this.damageCat(cat, WATER.damage, null);
        }
      } else {
        cat.waterAcc = 0;
      }
    }
  }

  private checkEnd(): void {
    const alive = this.aliveCats();
    const humans = this.humans();
    const humansAlive = humans.filter((c) => c.alive);
    if (alive.length <= 1) return this.finish(alive[0] ?? null);
    if (humans.length > 0 && humansAlive.length === 0) return this.finish(null);
    if (this.time >= HARD_CAP_S) {
      const best = [...alive].sort((a, b) => b.hp + b.shield - (a.hp + a.shield))[0] ?? null;
      this.finish(best);
    }
  }

  private finish(winner: Cat | null): void {
    // Los que siguen vivos al terminar se ordenan: primero el ganador y luego por vida restante.
    const alive = this.cats
      .filter((c) => c.alive)
      .sort((a, b) => (a === winner ? -1 : b === winner ? 1 : b.hp + b.shield - (a.hp + a.shield)));
    alive.forEach((c, i) => {
      c.placement = i + 1;
      c.diedAt = this.time;
    });
    const rows: PlacementRow[] = this.cats
      .map((c) => ({
        id: c.id,
        name: c.name,
        bot: c.bot,
        placement: c.placement || this.cats.length,
        kills: c.kills,
        survivalS: Math.round((c.alive ? this.time : c.diedAt) * 10) / 10,
        damageDealt: Math.round(c.damageDealt),
      }))
      .sort((a, b) => a.placement - b.placement);
    const top = alive[0] ?? null;
    this.result = {
      winnerId: top ? top.id : winner ? winner.id : (this.cats.find((c) => c.placement === 1)?.id ?? null),
      humanWon: top !== null && !top.bot,
      durationS: Math.round(this.time * 10) / 10,
      rows,
    };
  }

  /** Solo para pruebas: termina la partida de inmediato. */
  forceFinish(winnerId: number | null): void {
    this.finish(winnerId === null ? null : (this.cat(winnerId) ?? null));
  }

  // ---------------------------------------------------------------- instantanea por cliente

  private heldCode(cat: Cat): number {
    const item = this.held(cat);
    return item ? ITEM_KINDS.indexOf(item.kind) * 3 + item.rarity : -1;
  }

  private flags(cat: Cat): number {
    let f = 0;
    if (!cat.alive) f |= FLAG.dead;
    if (cat.heal) f |= FLAG.healing;
    if (cat.moving) f |= FLAG.moving;
    if (this.time < cat.hurtUntil) f |= FLAG.hurt;
    if (!cat.connected) f |= FLAG.disconnected;
    if (cat.bot) f |= FLAG.bot;
    return f;
  }

  /** Instantanea para un jugador: solo lo cercano a su camara, para no revelar a todos. */
  snapshotFor(catId: number): BRSnapshot | null {
    const cat = this.cat(catId);
    if (!cat) return null;
    let focus: Cat = cat;
    if (!cat.alive) {
      let target = this.cat(cat.spectate ?? -1);
      if (!target || !target.alive) {
        target = this.aliveCats()[0];
        cat.spectate = target ? target.id : null;
      }
      if (target) focus = target;
    }
    const R = INTEREST_RADIUS;
    const near = (x: number, y: number): boolean => Math.abs(x - focus.x) < R && Math.abs(y - focus.y) < R;

    const cats: CatTuple[] = [];
    for (const c of this.cats) {
      if (!c.alive || c.id === cat.id || !near(c.x, c.y)) continue;
      cats.push([c.id, q1(c.x), q1(c.y), this.flags(c), Math.round((c.aim * 180) / Math.PI), this.heldCode(c)]);
    }
    const shots: ShotTuple[] = [];
    for (const s of this.shots) {
      if (near(s.x, s.y)) shots.push([s.id, q1(s.x), q1(s.y), s.kind, Math.round((s.angle * 180) / Math.PI)]);
    }
    const walls: WallTuple[] = [];
    for (const w of this.walls.values()) {
      if (near(w.tx * TILE, w.ty * TILE)) walls.push([w.id, w.tx, w.ty, Math.max(1, Math.round((w.hp / WALL_ITEM.hp) * 100))]);
    }
    const boxes: ContainerTuple[] = [];
    for (const c of this.containers.values()) {
      if (!near(c.x, c.y)) continue;
      const first = c.kind === 'drop' && c.items[0] ? ITEM_KINDS.indexOf(c.items[0].kind) : -1;
      boxes.push([c.id, c.x, c.y, CONTAINER_CODE[c.kind], c.opened ? 1 : 0, first]);
    }
    const ev = this.events.filter((e) => {
      if (e.e === 'zone') return true;
      const x = (e as { x?: number }).x;
      const y = (e as { y?: number }).y;
      return x === undefined || y === undefined || near(x, y);
    });

    const z = this.zone;
    const next = z.next;
    const zone: ZoneView = {
      phase: z.phase,
      cx: Math.round(z.circle.cx),
      cy: Math.round(z.circle.cy),
      r: Math.round(z.circle.r),
      shrinking: z.shrinking,
      nx: next ? Math.round(next.cx) : 0,
      ny: next ? Math.round(next.cy) : 0,
      nr: next ? Math.round(next.r) : -1,
      dps: z.dps,
      nextIn: Math.max(0, Math.round(z.nextIn)),
    };
    const me: MeState = {
      x: q1(cat.x),
      y: q1(cat.y),
      hp: Math.ceil(cat.hp),
      shield: Math.ceil(cat.shield),
      sel: cat.sel,
      alive: cat.alive,
      kills: cat.kills,
      healLeft: cat.heal ? Math.max(0, Math.ceil(healMissing(cat.heal.kind, cat) / (cat.heal.kind === 'medkit' ? 10 : 5))) : 0,
      healKind: cat.heal ? cat.heal.kind : null,
      cooldown: Math.max(0, q1(cat.cooldownUntil - this.time)),
    };
    const snap: BRSnapshot = {
      t: Math.round(this.time * 1000),
      tick: this.tick,
      ack: cat.lastSeq,
      me,
      cats,
      shots,
      walls,
      boxes,
      zone,
      alive: this.aliveCats().length,
      ev,
    };
    if (cat.invDirty) {
      snap.inv = cat.inv.map((it) => (it ? cloneItem(it) : null));
      cat.invDirty = false;
    }
    if (!cat.alive && cat.spectate !== null) snap.spectating = cat.spectate;
    return snap;
  }

  /** Se llama una vez por tick, despues de generar las instantaneas de todos. */
  endTick(): void {
    this.events = [];
  }
}
