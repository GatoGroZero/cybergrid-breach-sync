import {
  DEFAULT_CAPS,
  HEAL,
  applyDamage,
  type Caps,
  healMissing,
  healSecondsLeft,
  healStep,
  splashDamage,
  type HealKind,
} from '../../shared/br/combat';
import {
  CAT,
  INTEREST_RADIUS,
  INVENTORY_SLOTS,
  SPAWN_GRACE_S,
  TICK_DT,
  TILE,
  WALL_ITEM,
  WATER,
  FLAG,
} from '../../shared/br/constants';
import {
  addItem,
  ammoToArray,
  cloneItem,
  emptyAmmo,
  emptyInventory,
  giveItem,
  moveSlot,
  placeInSlot,
  spendAmmo,
  takeOne,
  type AmmoStore,
  type Inventory,
} from '../../shared/br/inventory';
import { STAMINA, fullStamina, stepStamina, type StaminaState } from '../../shared/br/stamina';
import {
  AMMO_KINDS,
  CLAWS,
  ITEM_KINDS,
  WEAPONS,
  isAmmo,
  isWeapon,
  magOf,
  rollAmmoCrate,
  rollChest,
  type AmmoKind,
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
import {
  ZONE_BR,
  insideCircle,
  planZones,
  zoneAt,
  type ZonePlan,
  type ZoneSpec,
  type ZoneState,
} from '../../shared/br/zone';
import type { GameMode, TeamId } from '../../shared/br/modes';
import { createRng, type Rng } from '../../shared/rng';
import { BotBrain } from './bots';

export interface CatInit {
  id: number;
  name: string;
  userId: number | null;
  bot: boolean;
  skin: Skin;
  /** Modos por equipos: 0 o 1. Sin equipo (todos contra todos) se omite. */
  team?: TeamId;
}

export interface GameOptions {
  seed: number;
  mapKind: MapKind;
  cats: CatInit[];
  /** Acelera la linea de tiempo de la ola (solo para pruebas y demostraciones). */
  zoneScale?: number;
  /** Segundos de cuenta regresiva con todos quietos antes de que empiece la partida. */
  introSeconds?: number;
  /** Modo de juego (por omision, Battle Royale). */
  mode?: GameMode;
  /** Mapa ya generado (si no, se genera con la semilla). */
  map?: BRMap;
  /** Tiempos y dano de la zona de este modo. */
  zone?: ZoneSpec;
  /** Segundos al inicio en que nadie puede hacer dano. */
  graceSeconds?: number;
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
  /** Balas de cada arma: viven aparte de los 5 espacios. */
  ammo: AmmoStore;
  stamina: StaminaState;
  running: boolean;
  sel: number;
  heal: { kind: HealKind; elapsed: number; left: number } | null;
  /** Equipo (0 o 1) en los modos por equipos, o -1 si juega por su cuenta. */
  team: number;
  /** Donde aparece al empezar (y al empezar cada ronda). */
  spawn: { x: number; y: number };
  /** Recarga en curso: casilla del arma y cuando termina. */
  reload: { slot: number; until: number } | null;
  /** Hasta cuando no puede volver a mandar un emote. */
  emoteUntil: number;
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

export interface Shot {
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

export type ContainerKind = 'chest' | 'golden' | 'ammo' | 'tomb' | 'drop';

interface Container {
  id: number;
  kind: ContainerKind;
  x: number;
  y: number;
  items: Item[];
  opened: boolean;
  title: string;
}

/** Tipo de proyectil que viaja al cliente: cada arma tiene su propio dibujo. */
const SHOT_KIND: Record<WeaponKind, number> = {
  pistol: 0,
  shotgun: 1,
  sniper: 2,
  bazooka: 3,
  rifle: 4,
};
const CONTAINER_CODE: Record<ContainerKind, number> = {
  chest: 0,
  golden: 1,
  tomb: 2,
  drop: 3,
  ammo: 4,
};
/** Segundos entre un emote y el siguiente de un mismo gato. */
const EMOTE_COOLDOWN_S = 1.5;
export const EMOTE_KINDS = 5;
const HIT_RADIUS = 7;
const MAX_SHOTS = 320;
const MAX_WALLS = 120;
const OFFLINE_FORFEIT_S = 25;
const HARD_CAP_EXTRA_S = 15;

const q1 = (v: number): number => Math.round(v * 10) / 10;

export class BRGame {
  readonly map: BRMap;
  readonly seed: number;
  readonly mapKind: MapKind;
  readonly cats: Cat[];
  readonly startedAt = Date.now();
  readonly plan: ZonePlan;
  readonly rng: Rng;
  readonly mode: GameMode;
  protected readonly zoneSpec: ZoneSpec;
  readonly graceS: number;
  /** Si al caer un gato deja una lapida con sus cosas (en los kits fijos no). */
  protected dropLoot = true;
  /** Si al caer un gato conserva su inventario (aventura: se levanta con sus cosas). */
  protected keepOnDeath = false;
  protected readonly zoneScale: number;

  tick = 0;
  /** Tiempo de juego: no corre durante la cuenta regresiva del inicio. */
  time = 0;
  /** Reloj que siempre avanza (lo usan las instantaneas). */
  clock = 0;
  /** Segundos que faltan de la cuenta regresiva inicial; mientras sea mayor que 0 todos estan quietos. */
  introLeft = 0;
  result: GameEndPayload | null = null;
  zone: ZoneState;

  protected readonly shots: Shot[] = [];
  /** Disparos recientes: los bots "oyen" de donde vienen y van a mirar. */
  readonly shotLog: { x: number; y: number; t: number; owner: number }[] = [];
  protected readonly walls = new Map<number, Wall>();
  protected readonly wallByTile = new Map<number, Wall>();
  protected readonly containers = new Map<number, Container>();
  protected events: BREvent[] = [];
  protected nextId = 10_000;
  protected lastZoneKey = -1;
  protected readonly brains = new Map<number, BotBrain>();
  protected readonly deaths: DiedPayload[] = [];
  protected readonly deathOwners: number[] = [];
  protected feed: { k: string | null; v: string; m?: string }[] = [];

  constructor(options: GameOptions) {
    this.seed = options.seed;
    this.zoneScale = Math.max(1, options.zoneScale ?? 1);
    this.introLeft = Math.max(0, options.introSeconds ?? 0);
    this.mapKind = options.mapKind;
    this.mode = options.mode ?? 'br';
    this.zoneSpec = options.zone ?? ZONE_BR;
    this.graceS = options.graceSeconds ?? SPAWN_GRACE_S;
    this.map = options.map ?? generateMap(options.mapKind, options.seed);
    this.rng = createRng((options.seed ^ 0x9e3779b9) >>> 0);
    this.plan = planZones(
      createRng((options.seed ^ 0x5bd1e995) >>> 0),
      mapWidthPx(this.map),
      mapHeightPx(this.map),
      this.zoneSpec,
    );
    this.zone = zoneAt(this.plan, mapWidthPx(this.map), mapHeightPx(this.map), 0, this.zoneSpec);

    const spawns = this.rng.shuffle([...this.map.spawns]);
    const teamSeen: number[] = [0, 0];
    this.cats = options.cats.map((init, i) => {
      let sp = spawns[i % spawns.length] as { x: number; y: number };
      // En los modos por equipos cada gato aparece en el lugar de su equipo.
      const team: number = init.team ?? -1;
      const teamSpots = team >= 0 ? this.map.teamSpawns?.[team as TeamId] : undefined;
      if (teamSpots && teamSpots.length > 0) {
        sp = teamSpots[(teamSeen[team] as number) % teamSpots.length] as { x: number; y: number };
        teamSeen[team] = (teamSeen[team] as number) + 1;
      }
      const cat: Cat = {
        id: init.id,
        name: init.name,
        userId: init.userId,
        bot: init.bot,
        skin: init.skin,
        x: sp.x,
        y: sp.y,
        spawn: { x: sp.x, y: sp.y },
        hp: CAT.maxHp,
        shield: CAT.startShield,
        alive: true,
        aim: 0,
        inv: emptyInventory(),
        ammo: emptyAmmo(),
        stamina: fullStamina(),
        running: false,
        sel: 0,
        team,
        heal: null,
        reload: null,
        emoteUntil: 0,
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
      const kind: ContainerKind = spot.ammo ? 'ammo' : spot.golden ? 'golden' : 'chest';
      this.containers.set(spot.id, {
        id: spot.id,
        kind,
        x: spot.x,
        y: spot.y,
        items: spot.ammo
          ? rollAmmoCrate(lootRng)
          : rollChest(lootRng, spot.golden ? 'golden' : 'normal'),
        opened: false,
        title:
          { chest: 'Cofre', golden: 'Cofre dorado', ammo: 'Caja de munición' }[kind] ?? 'Cofre',
      });
    }
    for (const cat of this.cats) {
      if (cat.bot)
        this.brains.set(
          cat.id,
          new BotBrain(this, cat, createRng((options.seed + cat.id * 7919) >>> 0)),
        );
    }
  }

  // ---------------------------------------------------------------- consultas

  get over(): boolean {
    return this.result !== null;
  }

  // ---------------------------------------------------------------- ganchos para otros modos

  /** Antes de simular un tick: devuelve true si el modo ya se encargo de este tick. */
  protected beforeSim(): boolean {
    return false;
  }

  /** Direccion y velocidad con que se mueve un gato en este tick (la voltereta y las mejoras la cambian). */
  protected adjustMove(
    _cat: Cat,
    input: InputPayload,
    mul: number,
  ): { mx: number; my: number; mul: number } {
    return { mx: input.mx, my: input.my, mul };
  }

  /** Vida y escudo maximos de un gato. */
  protected capsOf(_cat: Cat): Caps {
    return DEFAULT_CAPS;
  }

  /** Dano de una bala disparada por `cat` (mejoras y pociones lo cambian). */
  /** Segundos hasta el siguiente disparo (las habilidades de la Aventura lo acortan). */
  protected shotCooldown(_cat: Cat, base: number): number {
    return base;
  }

  protected shotDamage(_cat: Cat, base: number): number {
    return base;
  }

  /** Tiempo de recarga del arma de `cat`. */
  protected reloadTime(_cat: Cat, base: number): number {
    return base;
  }

  /** Alcance de las balas de `cat`. */
  protected shotRange(_cat: Cat, base: number): number {
    return base;
  }

  /** Si un disparo gasta bala (algunas mejoras a veces la ahorran). */
  protected spendsAmmo(_cat: Cat): boolean {
    return true;
  }

  /** Objetos que se usan en vez de disparar (pociones). */
  protected useItem(_cat: Cat, _item: Item): void {
    // nada en el Battle Royale
  }

  /** Pieza de armadura u otro objeto que se equipa en vez de ir al inventario. */
  protected equipItem(_cat: Cat, _item: Item): boolean {
    return false;
  }

  /** Aventura: golpes contra los enemigos. */
  protected shotMobHit(
    _s: Shot,
    _nx: number,
    _ny: number,
    _tMax: number,
  ): { t: number; mob: unknown } | null {
    return null;
  }

  protected shotHitsMob(_s: Shot, _mob: unknown, _x: number, _y: number): void {
    // nada en el Battle Royale
  }

  protected explodeMobs(_s: Shot, _x: number, _y: number): void {
    // nada en el Battle Royale
  }

  protected clawMobs(_cat: Cat, _aim: number): void {
    // nada en el Battle Royale
  }

  /** Despues de simular un tick de combate (antes de revisar si termino). */
  protected afterSim(_dt: number): void {
    // nada en el Battle Royale
  }

  /** Si se juega por equipos (los bots pelean siempre y no hay botin que buscar). */
  get teamMode(): boolean {
    return this.mode === 'techo' || this.mode === 'territorio';
  }

  /** A donde conviene que vaya un bot cuando no tiene a quien perseguir (null: que decida el bot). */
  botGoal(_cat: Cat): { x: number; y: number } | null {
    return null;
  }

  /** Si `attacker` puede danar a `target`. En equipos no hay fuego amigo. */
  protected canHurt(attacker: Cat, target: Cat): boolean {
    return attacker.team < 0 || target.team < 0 || attacker.team !== target.team;
  }

  /** Si `other` es enemigo de `cat` (para los bots y los avisos). */
  isFoe(cat: Cat, other: Cat): boolean {
    return other.id !== cat.id && other.alive && this.canHurt(cat, other);
  }

  /** A quien mira un jugador eliminado al principio. */
  protected spectateTarget(_target: Cat, killer: Cat | null): number | null {
    return killer && killer.alive ? killer.id : (this.aliveCats()[0]?.id ?? null);
  }

  /** Datos extra que cada modo agrega a la instantanea de un jugador. */
  protected extendSnapshot(_snap: BRSnapshot, _cat: Cat): void {
    // nada en el Battle Royale
  }

  protected extraFlags(cat: Cat): number {
    return cat.team === 1 ? FLAG.team1 : 0;
  }

  cat(id: number): Cat | undefined {
    return this.cats.find((c) => c.id === id);
  }

  aliveCats(): Cat[] {
    return this.cats.filter((c) => c.alive);
  }

  protected humans(): Cat[] {
    return this.cats.filter((c) => !c.bot);
  }

  held(cat: Cat): Item | null {
    return cat.inv[cat.sel] ?? null;
  }

  protected emit(ev: BREvent): void {
    if (this.events.length < 220) this.events.push(ev);
  }

  /** Cofres, lapidas y objetos tirados, para los bots y las pruebas. */
  allContainers(): Container[] {
    return [...this.containers.values()];
  }

  wallList(): Wall[] {
    return [...this.walls.values()];
  }

  /** Las balas en vuelo, para los bots y las pruebas. */
  shotList(): readonly Shot[] {
    return this.shots;
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

  /** Movimiento de un bot: usa la misma estamina y fisica que un jugador. */
  botMove(cat: Cat, mx: number, my: number, wantsRun: boolean): void {
    const len = Math.min(1, Math.hypot(mx, my));
    cat.running = stepStamina(cat.stamina, wantsRun, len, TICK_DT);
    const before = { x: cat.x, y: cat.y };
    stepCat(this.map, cat, { mx, my }, TICK_DT, cat.running ? STAMINA.runMultiplier : 1);
    cat.moving = Math.hypot(cat.x - before.x, cat.y - before.y) > 0.05;
  }

  /** Cambia el objeto en mano. Cambiar de objeto cancela cualquier curacion en curso. */
  select(catId: number, slot: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive || slot < 0 || slot >= INVENTORY_SLOTS) return false;
    if (slot !== cat.sel) {
      cat.heal = null;
      cat.reload = null;
      cat.sel = slot;
    }
    return true;
  }

  protected applyInput(cat: Cat, input: InputPayload): void {
    cat.lastSeq = input.seq;
    const before = { x: cat.x, y: cat.y };
    const len = Math.min(1, Math.hypot(input.mx, input.my));
    cat.running = stepStamina(cat.stamina, input.run === true, len, TICK_DT);
    const move = this.adjustMove(cat, input, cat.running ? STAMINA.runMultiplier : 1);
    stepCat(this.map, cat, { mx: move.mx, my: move.my }, TICK_DT, move.mul);
    cat.moving = Math.hypot(cat.x - before.x, cat.y - before.y) > 0.05;
    this.fireControl(cat, input.aim, input.fire, input.hold === true);
  }

  /** Disparo, uso del objeto en mano o garras segun lo que lleve el gato. */
  fireControl(cat: Cat, aim: number, fire: boolean, hold = false): void {
    if (this.introLeft > 0) return;
    const edge = fire && !cat.prevFire;
    cat.prevFire = fire;
    cat.aim = aim;
    if (!fire) return;
    const item = this.held(cat);
    const def = item && isWeapon(item.kind) ? WEAPONS[item.kind] : null;

    if (item && def) {
      // Un clic por bala; con el joystick de la mira (hold) las armas repiten solas al cargarse.
      if (!def.auto && !edge && !hold) return;
      this.shoot(cat, item, def, aim);
    } else if (item && (item.kind === 'medkit' || item.kind === 'shield')) {
      if (edge) this.startHeal(cat, item.kind);
    } else if (item && (item.kind === 'potion_catnip' || item.kind === 'potion_valerian')) {
      if (edge) this.useItem(cat, item);
    } else if (item && item.kind === 'wall') {
      if (edge) this.placeWall(cat, aim);
    } else if (!item && this.time >= cat.cooldownUntil) {
      this.claw(cat, aim);
    }
  }

  protected nearestEnemy(cat: Cat, range: number): Cat | null {
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

  protected shoot(cat: Cat, item: Item, def: WeaponDef, aim: number): void {
    if (cat.reload) return;
    if (this.time < cat.cooldownUntil) return;
    if (this.shots.length > MAX_SHOTS) return;
    // Cargador vacio: se recarga solo (si quedan balas) y si no, solo suena el clic.
    if (magOf(item) <= 0) {
      if (!this.startReload(cat)) this.emitDry(cat, def);
      return;
    }
    if (this.spendsAmmo(cat)) item.mag = magOf(item) - 1;
    cat.invDirty = true;
    cat.cooldownUntil = this.time + this.shotCooldown(cat, def.cooldown);
    cat.heal = null;
    this.shotLog.push({ x: cat.x, y: cat.y, t: this.time, owner: cat.id });
    if (this.shotLog.length > 24) this.shotLog.shift();
    const dmg = this.shotDamage(cat, def.damage[item.rarity] as number);
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
        left: this.shotRange(cat, def.range),
        weapon: def.kind,
        rarity: item.rarity,
        // tipo de arma en los 3 primeros bits y la rareza arriba (para el halo del proyectil)
        kind: SHOT_KIND[def.kind] + item.rarity * 8,
        splash: def.splash,
        angle: a,
      });
    }
    this.emit({
      e: 'shot',
      x: q1(cat.x),
      y: q1(cat.y),
      a: Math.round((aim * 180) / Math.PI),
      w: ITEM_KINDS.indexOf(def.kind),
    });
    // Al vaciar el cargador se recarga sola si quedan balas.
    if (magOf(item) <= 0) this.startReload(cat);
  }

  // ---------------------------------------------------------------- recarga

  /** Empieza a recargar el arma en mano. Devuelve false si no hace falta o no hay balas. */
  startReload(cat: Cat): boolean {
    if (!cat.alive || cat.reload || this.introLeft > 0) return false;
    const item = this.held(cat);
    if (!item || !isWeapon(item.kind)) return false;
    const def = WEAPONS[item.kind];
    if (magOf(item) >= def.magazine) return false;
    if (cat.ammo[def.ammo] < def.ammoPerShot) return false;
    cat.reload = { slot: cat.sel, until: this.time + this.reloadTime(cat, def.reload) };
    this.emit({
      e: 'reload',
      x: q1(cat.x),
      y: q1(cat.y),
      w: ITEM_KINDS.indexOf(def.kind),
      done: false,
    });
    return true;
  }

  /** Pedido del jugador (tecla R o boton). */
  reload(catId: number): boolean {
    const cat = this.cat(catId);
    return cat ? this.startReload(cat) : false;
  }

  protected updateReload(cat: Cat): void {
    const r = cat.reload;
    if (!r) return;
    const item = cat.inv[r.slot];
    if (cat.sel !== r.slot || !item || !isWeapon(item.kind)) {
      cat.reload = null;
      return;
    }
    if (this.time < r.until) return;
    const def = WEAPONS[item.kind];
    // Pasa del compartimento al cargador solo en tandas completas de disparos.
    const shots = Math.min(
      Math.floor(cat.ammo[def.ammo] / def.ammoPerShot),
      def.magazine - magOf(item),
    );
    if (shots > 0) {
      item.mag = magOf(item) + shots;
      cat.ammo[def.ammo] -= shots * def.ammoPerShot;
      cat.invDirty = true;
    }
    cat.reload = null;
    this.emit({
      e: 'reload',
      x: q1(cat.x),
      y: q1(cat.y),
      w: ITEM_KINDS.indexOf(def.kind),
      done: true,
    });
  }

  /** Disparo con el cargador vacio y sin balas de repuesto: solo un clic seco. */
  protected emitDry(cat: Cat, def: WeaponDef): void {
    cat.cooldownUntil = this.time + 0.4;
    this.emit({ e: 'dry', x: q1(cat.x), y: q1(cat.y), w: ITEM_KINDS.indexOf(def.kind) });
  }

  protected claw(cat: Cat, aim: number): void {
    cat.cooldownUntil = this.time + CLAWS.cooldown;
    this.emit({ e: 'claw', x: q1(cat.x), y: q1(cat.y), a: Math.round((aim * 180) / Math.PI) });
    for (const other of this.cats) {
      if (!other.alive || other.id === cat.id || !this.canHurt(cat, other)) continue;
      const d = dist(cat.x, cat.y, other.x, other.y);
      if (d > CLAWS.range + HIT_RADIUS) continue;
      const toOther = Math.atan2(other.y - cat.y, other.x - cat.x);
      const diff = Math.abs(Math.atan2(Math.sin(toOther - aim), Math.cos(toOther - aim)));
      if (diff < 0.9) this.damageCat(other, CLAWS.damage, cat);
    }
    // Las garras tambien rompen muros (el mas cercano al frente), para que nadie quede encerrado.
    let target: Wall | null = null;
    let targetD = Infinity;
    for (const wall of this.walls.values()) {
      const wx = wall.tx * TILE + TILE / 2;
      const wy = wall.ty * TILE + TILE / 2;
      const d = dist(cat.x, cat.y, wx, wy);
      if (d > CLAWS.range + TILE * 0.75) continue;
      const to = Math.atan2(wy - cat.y, wx - cat.x);
      const diff = Math.abs(Math.atan2(Math.sin(to - aim), Math.cos(to - aim)));
      if (diff > 1.1 && d > TILE) continue;
      if (d < targetD) {
        targetD = d;
        target = wall;
      }
    }
    if (target) this.damageWall(target, CLAWS.wallDamage);
    this.clawMobs(cat, aim);
  }

  /** Un emote sobre la cabeza del gato, visible para quien lo tenga cerca. */
  emote(catId: number, kind: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive || !Number.isInteger(kind) || kind < 0 || kind >= EMOTE_KINDS)
      return false;
    if (this.time < cat.emoteUntil) return false;
    cat.emoteUntil = this.time + EMOTE_COOLDOWN_S;
    this.emit({ e: 'emote', x: q1(cat.x), y: q1(cat.y), id: cat.id, k: kind });
    return true;
  }

  // ---------------------------------------------------------------- curacion

  /** El objeto se gasta al empezar. Si cancelas, lo que faltaba por curar se pierde. */
  protected startHeal(cat: Cat, kind: HealKind): void {
    if (cat.heal) return;
    if (healMissing(kind, cat, this.capsOf(cat)) <= 0) return;
    const slot = cat.sel;
    takeOne(cat.inv, slot);
    cat.invDirty = true;
    cat.heal = { kind, elapsed: 0, left: HEAL[kind].total };
  }

  protected updateHeal(cat: Cat, dt: number): void {
    const heal = cat.heal;
    if (!heal) return;
    heal.elapsed += dt;
    // Pequeña tolerancia: 30 ticks de 1/30 s suman 0.99999... y deben contar como un segundo.
    while (heal.elapsed >= 1 - 1e-6) {
      heal.elapsed -= 1;
      const r = healStep(heal.kind, cat, heal.left, this.capsOf(cat));
      heal.left = r.left;
      cat.hp = r.hp;
      cat.shield = r.shield;
      this.emit({
        e: 'heal',
        x: q1(cat.x),
        y: q1(cat.y),
        kind: heal.kind === 'medkit' ? 'hp' : 'shield',
      });
      if (r.done) {
        cat.heal = null;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- muros

  protected placeWall(cat: Cat, aim: number): void {
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
    this.emit({ e: 'place', x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
  }

  protected damageWall(wall: Wall, dmg: number): void {
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
    if (this.time < this.graceS && attacker !== null) return;
    if (attacker && !this.canHurt(attacker, target)) return;
    const r = applyDamage(target, amount);
    target.hp = r.hp;
    target.shield = r.shield;
    target.hurtUntil = this.time + 0.25;
    if (attacker && attacker.id !== target.id) attacker.damageDealt += r.dealt;
    this.emit({
      e: 'hit',
      x: q1(target.x),
      y: q1(target.y),
      v: Math.round(r.dealt),
      kill: target.hp <= 0,
      by: attacker && attacker.id !== target.id ? attacker.id : 0,
      to: target.id,
    });
    if (target.hp <= 0) this.killCat(target, attacker);
  }

  protected killCat(target: Cat, killer: Cat | null): void {
    const alive = this.aliveCats().length;
    target.alive = false;
    target.placement = alive;
    target.diedAt = this.time;
    target.heal = null;
    target.reload = null;
    target.queue.length = 0;
    target.killerId = killer && killer.id !== target.id ? killer.id : null;
    if (killer && killer.id !== target.id) killer.kills++;
    this.emit({ e: 'death', x: q1(target.x), y: q1(target.y), id: target.id });
    this.feed.push({ k: killer && killer.id !== target.id ? killer.name : null, v: target.name });

    const items = target.inv.filter((it): it is Item => it !== null).map(cloneItem);
    for (const kind of AMMO_KINDS) {
      if (target.ammo[kind] > 0) items.push({ kind, qty: target.ammo[kind], rarity: 0 });
    }
    if (!this.keepOnDeath) {
      target.inv = emptyInventory();
      target.ammo = emptyAmmo();
      target.invDirty = true;
    }
    if (this.dropLoot && !this.keepOnDeath) {
      this.containers.set(this.nextId, {
        id: this.nextId++,
        kind: 'tomb',
        x: target.x,
        y: target.y,
        items,
        opened: true,
        title: `Lápida de ${target.name}`,
      });
    }

    // Los bots festejan algunas bajas con una carita, como lo haria una persona.
    if (
      killer &&
      killer.bot &&
      killer.alive &&
      killer.id !== target.id &&
      (this.tick + killer.id) % 3 === 0
    )
      this.emote(killer.id, (this.tick + target.id) % 4 === 0 ? 4 : 0);

    if (!target.bot) {
      this.deaths.push({
        placement: target.placement,
        killerName: killer && killer.id !== target.id ? killer.name : null,
        kills: target.kills,
        survivalS: Math.round(this.time * 10) / 10,
      });
      this.deathOwners.push(target.id);
      target.spectate = this.spectateTarget(target, killer);
    }
  }

  /** Muertes de humanos pendientes de avisar (las consume la sala). */
  drainDeaths(): { catId: number; payload: DiedPayload }[] {
    const out = this.deaths.map((payload, i) => ({
      catId: this.deathOwners[i] as number,
      payload,
    }));
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

  protected nearestContainer(cat: Cat, range: number): Container | null {
    let best: Container | null = null;
    let bestD = range;
    for (const c of this.containers.values()) {
      const isChest = c.kind === 'chest' || c.kind === 'golden' || c.kind === 'ammo';
      if (!isChest && c.items.length === 0) continue;
      const d = dist(cat.x, cat.y, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  protected contentsOf(c: Container): LootContents {
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
      this.emit({
        e: 'open',
        x: q1(c.x),
        y: q1(c.y),
        golden: c.kind === 'golden',
        ammo: c.kind === 'ammo',
      });
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
    if (this.equipItem(cat, item)) {
      // la armadura se pone sola: no ocupa espacio del inventario
      left = null;
    } else if (isAmmo(item.kind)) {
      left = giveItem(cat.inv, cat.ammo, cloneItem(item));
    } else if (slot !== undefined && slot >= 0 && slot < INVENTORY_SLOTS) {
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

  protected cleanup(c: Container): void {
    if ((c.kind === 'tomb' || c.kind === 'drop') && c.items.length === 0)
      this.containers.delete(c.id);
  }

  invMove(catId: number, from: number, to: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive) return false;
    const heldBefore = cat.inv[cat.sel];
    const ok = moveSlot(cat.inv, from, to);
    if (!ok) return false;
    cat.invDirty = true;
    // Lo que tienes en mano se mueve con la casilla: si cambia, la curacion se cancela.
    if (cat.inv[cat.sel] !== heldBefore) {
      cat.heal = null;
      cat.reload = null;
    }
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
    if (slot === cat.sel) {
      cat.heal = null;
      cat.reload = null;
    }
    this.dropAt(cat, item);
    return true;
  }

  /** Tira balas de un tipo (todas o las que se pidan) al suelo. */
  ammoDrop(catId: number, kind: AmmoKind, qty?: number): boolean {
    const cat = this.cat(catId);
    if (!cat || !cat.alive) return false;
    const have = cat.ammo[kind];
    const n = Math.min(have, qty ?? have);
    if (n <= 0) return false;
    spendAmmo(cat.ammo, kind, n);
    cat.invDirty = true;
    this.dropAt(cat, { kind, qty: n, rarity: 0 });
    return true;
  }

  protected dropAt(cat: Cat, item: Item): void {
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
  }

  // ---------------------------------------------------------------- avance de la simulacion

  step(): void {
    if (this.over) return;
    this.tick++;
    this.clock += TICK_DT;
    // Los modos con fases propias (elegir kit, rondas) deciden aqui si este tick se simula.
    if (this.beforeSim()) return;
    // Cuenta regresiva inicial: todos quietos, sin disparar ni abrir nada.
    if (this.introLeft > 0) {
      this.introLeft = this.introLeft - TICK_DT < 1e-6 ? 0 : this.introLeft - TICK_DT;
      for (const cat of this.cats) {
        cat.moving = false;
        cat.running = false;
        while (cat.queue.length > 0) cat.lastSeq = (cat.queue.shift() as InputPayload).seq;
      }
      return;
    }
    this.time += TICK_DT;
    this.zone = zoneAt(
      this.plan,
      mapWidthPx(this.map),
      mapHeightPx(this.map),
      this.time * this.zoneScale,
      this.zoneSpec,
    );
    // Cada cambio de la ola (empieza a cerrar, se queda quieta, ultima ola...) se avisa a todos.
    const zoneKey = this.zone.phase * 2 + (this.zone.shrinking ? 1 : 0);
    if (zoneKey !== this.lastZoneKey) {
      this.lastZoneKey = zoneKey;
      if (this.zone.phase > 0)
        this.emit({ e: 'zone', phase: this.zone.phase, shrinking: this.zone.shrinking });
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

    for (const cat of this.cats) {
      if (!cat.alive) continue;
      this.updateHeal(cat, TICK_DT);
      this.updateReload(cat);
    }
    this.updateShots(TICK_DT);
    this.hazards(TICK_DT);
    this.afterSim(TICK_DT);
    this.checkEnd();
  }

  protected updateShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i] as Shot;
      const step = Math.min(s.speed * dt, s.left);
      const nx = s.x + Math.cos(s.angle) * step;
      const ny = s.y + Math.sin(s.angle) * step;

      let tHit = 2;
      let hitCat: Cat | null = null;
      const solid = segmentSolidHit(this.map, s.x, s.y, nx, ny);
      if (solid.hit) tHit = solid.t;
      const shooter = this.cat(s.owner) ?? null;
      for (const cat of this.cats) {
        if (!cat.alive || cat.id === s.owner) continue;
        // las balas atraviesan a los companeros de equipo
        if (shooter && !this.canHurt(shooter, cat)) continue;
        const t = segmentCircleHit(s.x, s.y, nx, ny, cat.x, cat.y, HIT_RADIUS);
        if (t >= 0 && t < tHit) {
          tHit = t;
          hitCat = cat;
        }
      }

      let hitMob: unknown = null;
      if (s.owner > 0) {
        const m = this.shotMobHit(s, nx, ny, tHit);
        if (m && m.t < tHit) {
          tHit = m.t;
          hitCat = null;
          hitMob = m.mob;
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
      if (hitMob) {
        this.shotHitsMob(s, hitMob, hx, hy);
        if (s.splash > 0) this.explode(s, hx, hy, null);
      } else if (hitCat) {
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
  protected explode(s: Shot, x: number, y: number, direct: Cat | null): void {
    this.emit({ e: 'boom', x: q1(x), y: q1(y), r: s.splash });
    const owner = this.cat(s.owner) ?? null;
    if (direct) this.damageCat(direct, s.dmg, owner);
    for (const cat of this.cats) {
      if (!cat.alive || cat === direct) continue;
      if (owner && cat.id !== owner.id && !this.canHurt(owner, cat)) continue;
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
    this.explodeMobs(s, x, y);
  }

  /** La ola de la zona y el agua de la alberca danan primero al escudo. */
  protected hazards(dt: number): void {
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

  protected checkEnd(): void {
    const alive = this.aliveCats();
    const humans = this.humans();
    if (alive.length <= 1) return this.finish(alive[0] ?? null);
    // Si el humano cae, la partida sigue para que pueda verla; termina si se va.
    if (humans.length > 0 && humans.every((c) => !c.alive && !c.connected))
      return this.finish(null);
    if (this.time >= this.zoneSpec.timeline.end / this.zoneScale + HARD_CAP_EXTRA_S) {
      const best = [...alive].sort((a, b) => b.hp + b.shield - (a.hp + a.shield))[0] ?? null;
      this.finish(best);
    }
  }

  protected finish(winner: Cat | null): void {
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
    // Los que miran desde la lapida ven la celebracion del ganador.
    if (top) for (const c of this.cats) if (!c.alive && !c.bot) c.spectate = top.id;
    this.result = {
      winnerId: top
        ? top.id
        : winner
          ? winner.id
          : (this.cats.find((c) => c.placement === 1)?.id ?? null),
      humanWon: top !== null && !top.bot,
      durationS: Math.round(this.time * 10) / 10,
      rows,
    };
  }

  /** Solo para pruebas y demostraciones: equipo basico para un gato. */
  giveTestKit(catId: number, heavy = false): void {
    const cat = this.cat(catId);
    if (!cat || cat.bot) return;
    const kit: Item[] = heavy
      ? [
          { kind: 'bazooka', qty: 1, rarity: 2 },
          { kind: 'ammo_bazooka', qty: 6, rarity: 0 },
          { kind: 'sniper', qty: 1, rarity: 2 },
          { kind: 'ammo_sniper', qty: 16, rarity: 0 },
          { kind: 'shield', qty: 3, rarity: 0 },
        ]
      : [
          { kind: 'rifle', qty: 1, rarity: 2 },
          { kind: 'ammo_rifle', qty: 90, rarity: 0 },
          { kind: 'medkit', qty: 3, rarity: 0 },
          { kind: 'shield', qty: 3, rarity: 0 },
          { kind: 'wall', qty: 5, rarity: 0 },
        ];
    for (const item of kit) giveItem(cat.inv, cat.ammo, item);
    cat.invDirty = true;
  }

  /** Solo para pruebas: termina la partida de inmediato. */
  forceFinish(winnerId: number | null): void {
    this.finish(winnerId === null ? null : (this.cat(winnerId) ?? null));
  }

  // ---------------------------------------------------------------- instantanea por cliente

  protected heldCode(cat: Cat): number {
    const item = this.held(cat);
    return item ? ITEM_KINDS.indexOf(item.kind) * 3 + item.rarity : -1;
  }

  protected flags(cat: Cat): number {
    let f = 0;
    if (!cat.alive) f |= FLAG.dead;
    if (cat.heal) f |= FLAG.healing;
    if (cat.moving) f |= FLAG.moving;
    if (this.time < cat.hurtUntil) f |= FLAG.hurt;
    if (!cat.connected) f |= FLAG.disconnected;
    if (cat.bot) f |= FLAG.bot;
    if (cat.running) f |= FLAG.running;
    return f | this.extraFlags(cat);
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
    const near = (x: number, y: number): boolean =>
      Math.abs(x - focus.x) < R && Math.abs(y - focus.y) < R;

    const cats: CatTuple[] = [];
    for (const c of this.cats) {
      if (!c.alive || c.id === cat.id || !near(c.x, c.y)) continue;
      cats.push([
        c.id,
        q1(c.x),
        q1(c.y),
        this.flags(c),
        Math.round((c.aim * 180) / Math.PI),
        this.heldCode(c),
      ]);
    }
    const shots: ShotTuple[] = [];
    for (const s of this.shots) {
      if (near(s.x, s.y))
        shots.push([s.id, q1(s.x), q1(s.y), s.kind, Math.round((s.angle * 180) / Math.PI)]);
    }
    const walls: WallTuple[] = [];
    for (const w of this.walls.values()) {
      if (near(w.tx * TILE, w.ty * TILE))
        walls.push([w.id, w.tx, w.ty, Math.max(1, Math.round((w.hp / WALL_ITEM.hp) * 100))]);
    }
    const boxes: ContainerTuple[] = [];
    for (const c of this.containers.values()) {
      if (!near(c.x, c.y)) continue;
      const top = c.kind === 'drop' ? c.items[0] : undefined;
      const first = top ? ITEM_KINDS.indexOf(top.kind) * 3 + top.rarity : -1;
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
      nextIn: Math.max(0, Math.round(z.nextIn / this.zoneScale)),
    };
    const me: MeState = {
      x: q1(cat.x),
      y: q1(cat.y),
      hp: Math.ceil(cat.hp),
      shield: Math.ceil(cat.shield),
      sel: cat.sel,
      alive: cat.alive,
      kills: cat.kills,
      healLeft: cat.heal ? healSecondsLeft(cat.heal.kind, cat, cat.heal.left, this.capsOf(cat)) : 0,
      healKind: cat.heal ? cat.heal.kind : null,
      cooldown: Math.max(0, q1(cat.cooldownUntil - this.time)),
      reload: cat.reload ? Math.max(0.1, q1(cat.reload.until - this.time)) : 0,
      stamina: q1(cat.stamina.value),
      tired: cat.stamina.tired,
    };
    const snap: BRSnapshot = {
      t: Math.round(this.clock * 1000),
      intro: Math.max(0, q1(this.introLeft)),
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
      snap.ammo = ammoToArray(cat.ammo);
      cat.invDirty = false;
    }
    if (!cat.alive && cat.spectate !== null) snap.spectating = cat.spectate;
    if (this.feed.length > 0) snap.feed = this.feed;
    this.extendSnapshot(snap, cat);
    return snap;
  }

  /** Se llama una vez por tick, despues de generar las instantaneas de todos. */
  endTick(): void {
    this.events = [];
    this.feed = [];
  }
}
