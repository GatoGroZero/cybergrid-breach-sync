import {
  ARMOR_SLOTS,
  BOSS_ORDER,
  DASH,
  HAZARD,
  MINIBOSSES,
  MOB,
  NO_META,
  POTION,
  POWERS,
  POWER_MAX_LEVEL,
  POWER_SLOTS,
  RELICS,
  REVIVE_S,
  squadLives,
  clampMeta,
  computeMods,
  dmgScale,
  essenceFor,
  hpScale,
  mobDef,
  powerCooldown,
  powerEffect,
  powerOffer,
  wavePlan,
  type Equip,
  type MetaLevels,
  type Mods,
} from '../../shared/br/adventure';
import { splashDamage, type Caps } from '../../shared/br/combat';
import { CAT, TICK_DT, TILE } from '../../shared/br/constants';
import { addAmmo, giveItem, takeOne } from '../../shared/br/inventory';
import {
  CLAWS,
  ITEM_KINDS,
  WEAPONS,
  isArmor,
  isWeapon,
  rollAmmoCrate,
  rollWeapon,
  type AmmoKind,
  type ArmorKind,
  type Item,
  type Rarity,
} from '../../shared/br/items';
import type { AdventureRoom } from '../../shared/br/map';
import { dist, moveBox, segmentCircleHit } from '../../shared/br/physics';
import type { GameEndPayload, InputPayload, PlacementRow } from '../../shared/br/protocol';
import type {
  AdvState,
  BRSnapshot,
  HazardTuple,
  MobTuple,
  PickupTuple,
} from '../../shared/br/types';
import { ZONE_NINGUNA } from '../../shared/br/zone';
import { createRng } from '../../shared/rng';
import { BRGame, type Cat, type GameOptions, type Shot } from './Game';
import { mobFlags, thinkMob, bossPhase, type Mob, type MobCtx, type Target } from './mobs';

export interface AdventureOptions extends Omit<GameOptions, 'mapKind'> {
  /** Mejoras permanentes que trae cada gato (por id). */
  meta?: Record<number, MetaLevels>;
}

interface RoomRt {
  def: AdventureRoom;
  /** 0 dormida, 1 activa, 2 superada. */
  state: number;
  startedAt: number;
  closed: boolean;
  waves: number[][];
  wave: number;
  nextWaveAt: number;
  bossSpawned: boolean;
  offered: boolean;
}

interface PlayerAdv {
  relics: number[];
  equip: Equip;
  meta: MetaLevels;
  mods: Mods;
  /** Reliquias por elegir: cada elemento es una oferta de tres. */
  offers: number[][];
  reviveAt: number;
  invulnUntil: number;
  dashLeft: number;
  dashDx: number;
  dashDy: number;
  dashReadyAt: number;
  rageUntil: number;
  swiftUntil: number;
  lastHurt: number;
  regenAcc: number;
  essence: number;
  /** Habilidades de jefe que lleva y cuando vuelve a estar lista cada una. */
  powers: { id: number; level: number; readyAt: number }[];
  /** Ofertas de habilidad por elegir (una por jefe caido). */
  powerOffers: number[][];
  furyUntil: number;
  furyEff: number;
  gazeUntil: number;
  gazeEff: number;
  ghostUntil: number;
  /** Cayo sin vidas: se levanta al terminar la zona si queda alguien de pie. */
  zoneRevive: boolean;
  healAcc: number;
}

interface Hazard {
  id: number;
  x: number;
  y: number;
  r: number;
  kind: number;
  dmg: number;
  dps: number;
  start: number;
  until: number;
  fired: boolean;
  hit: Set<number>;
  owner: number;
  grow: number;
}

interface Pickup {
  id: number;
  x: number;
  y: number;
  /** 0 corazon, 1 balas, 2 pocion, 3 armadura, 4 objeto (arma, cura...). */
  kind: number;
  item?: Item;
  until: number;
}

const MAX_MOBS = 90;
/** Reserva de balas de pistola que se rellena sola (una cada 0.2 s). */
const PISTOL_RESERVE = 60;
const GATE_DELAY_S = 1.7;
const AMMO_DROP: Record<string, number> = {
  pistol: 20,
  shotgun: 8,
  sniper: 4,
  bazooka: 2,
  rifle: 32,
};

const LOCKING = new Set(['combate', 'minijefe', 'jefe']);

/**
 * Aventura: un grupo de 1 a 4 gatos recorre el bosque encantado, limpia claros llenos de enemigos,
 * derrota a cinco minijefes y a un jefe final. Comparten siete vidas, eligen reliquias que
 * se apilan, se visten con armadura y se juegan una nueva partida cada vez con enemigos y botin
 * distintos.
 */
export class AdventureGame extends BRGame {
  readonly mobs = new Map<number, Mob>();
  readonly perils: Hazard[] = [];
  readonly pickups: Pickup[] = [];
  readonly rooms: RoomRt[];
  readonly lives0: number;
  lives: number;
  kills = 0;
  bossesDown = 0;
  roomsCleared = 0;
  ending: 'victory' | 'defeat' | null = null;
  private readonly state = new Map<number, PlayerAdv>();
  private readonly ctx: MobCtx;
  private readonly runRng;
  /** Oleadas por llegar: aparece un aviso y, un instante despues, el enemigo. */
  private readonly pending: {
    at: number;
    kind: number;
    x: number;
    y: number;
    room: number;
  }[] = [];
  private currentRoom = 0;
  private readonly bossHp = new Map<number, number>();
  /** Casillas a las que se puede llegar caminando desde el inicio (nadie nace en un hueco cerrado). */
  private readonly reach: Uint8Array;

  constructor(options: AdventureOptions) {
    super({
      ...options,
      mapKind: 'encantado',
      mode: 'aventura',
      zone: ZONE_NINGUNA,
      graceSeconds: 0,
    });
    this.dropLoot = false;
    this.keepOnDeath = true;
    this.runRng = createRng((options.seed ^ 0x51ed270b) >>> 0);
    this.rooms = (this.map.rooms ?? []).map((def) => ({
      def,
      state: def.kind === 'inicio' ? 2 : 0,
      startedAt: 0,
      closed: false,
      waves: [],
      wave: 0,
      nextWaveAt: 0,
      bossSpawned: false,
      offered: false,
    }));
    this.reach = this.floodFill();
    let extraLives = 0;
    for (const cat of this.cats) {
      const meta = clampMeta(options.meta?.[cat.id] ?? NO_META);
      const st: PlayerAdv = {
        relics: [],
        equip: [-1, -1, -1],
        meta,
        mods: computeMods([], [-1, -1, -1], meta),
        offers: [],
        reviveAt: 0,
        invulnUntil: 0,
        dashLeft: 0,
        dashDx: 0,
        dashDy: 0,
        dashReadyAt: 0,
        rageUntil: 0,
        swiftUntil: 0,
        lastHurt: -99,
        regenAcc: 0,
        essence: 0,
        powers: [],
        powerOffers: [],
        furyUntil: 0,
        furyEff: 1,
        gazeUntil: 0,
        gazeEff: 1,
        ghostUntil: 0,
        zoneRevive: false,
        healAcc: 0,
      };
      this.state.set(cat.id, st);
      extraLives = Math.max(extraLives, meta.vidas);
      this.starterKit(cat, st);
      cat.hp = st.mods.maxHp;
    }
    this.lives0 = squadLives(this.cats.length) + extraLives;
    this.lives = this.lives0;
    // el regalo del bosque: elegir una reliquia al empezar
    for (const cat of this.cats) {
      const st = this.state.get(cat.id) as PlayerAdv;
      for (let i = 0; i < st.meta.reliquia; i++) this.offerRelics(cat);
    }
    this.rebuildContainers(options.seed);
    this.ctx = this.makeCtx();
  }

  // ---------------------------------------------------------------- inicio

  private starterKit(cat: Cat, st: PlayerAdv): void {
    giveItem(cat.inv, cat.ammo, { kind: 'pistol', qty: 1, rarity: 1 });
    giveItem(cat.inv, cat.ammo, {
      kind: 'ammo_pistol',
      qty: 60 + 25 * st.meta.municion,
      rarity: 0,
    });
    // en solitario se empieza con un botiquin de mas: nadie te cura si te hieren
    const solo = this.cats.length === 1 ? 1 : 0;
    giveItem(cat.inv, cat.ammo, { kind: 'medkit', qty: 1 + solo + st.meta.botiquin, rarity: 0 });
    cat.sel = 0;
    cat.invDirty = true;
  }

  /** Los cofres del bosque: el tesoro de cada acto y las cajas de municion. */
  private rebuildContainers(seed: number): void {
    const rng = createRng((seed ^ 0xa11ce) >>> 0);
    this.containers.clear();
    for (const spot of this.map.chests) {
      const room = this.rooms.find(
        (r) =>
          spot.x >= r.def.x * TILE &&
          spot.x < (r.def.x + r.def.w) * TILE &&
          spot.y >= r.def.y * TILE &&
          spot.y < (r.def.y + r.def.h) * TILE,
      );
      const act = room?.def.act ?? 0;
      const items: Item[] = spot.ammo
        ? rollAmmoCrate(rng)
        : [
            this.rollArmor(rng, act),
            rollWeapon(rng, 'golden'),
            { kind: rng.chance(0.5) ? 'potion_catnip' : 'potion_valerian', qty: 1, rarity: 0 },
            { kind: 'medkit', qty: 1, rarity: 0 },
          ];
      this.containers.set(spot.id, {
        id: spot.id,
        kind: spot.ammo ? 'ammo' : 'golden',
        x: spot.x,
        y: spot.y,
        items,
        opened: false,
        title: spot.ammo ? 'Caja de munición' : 'Cofre del tesoro',
      });
    }
  }

  private rollArmor(
    rng: { chance(p: number): boolean; int(a: number, b: number): number },
    act: number,
  ): Item {
    const kind = (['armor_head', 'armor_body', 'armor_paws'] as ArmorKind[])[
      rng.int(0, 2)
    ] as ArmorKind;
    const base = act >= 4 ? 2 : act >= 2 ? 1 : 0;
    const rarity = Math.min(2, base + (rng.chance(0.3) ? 1 : 0)) as Rarity;
    return { kind, qty: 1, rarity };
  }

  // ---------------------------------------------------------------- consultas

  stateOf(catId: number): PlayerAdv | undefined {
    return this.state.get(catId);
  }

  modsOf(cat: Cat): Mods {
    return (this.state.get(cat.id) as PlayerAdv).mods;
  }

  protected override capsOf(cat: Cat): Caps {
    const m = this.modsOf(cat);
    return { hp: m.maxHp, shield: m.maxShield };
  }

  protected override canHurt(): boolean {
    // los gatos nunca se hacen dano entre si: todos pelean contra el bosque
    return false;
  }

  override isFoe(): boolean {
    return false;
  }

  private act(): number {
    return (this.rooms[this.currentRoom]?.def.act ?? 0) as number;
  }

  private squadSize(): number {
    return Math.max(1, this.cats.length);
  }

  private mobsOfRoom(room: number): Mob[] {
    return [...this.mobs.values()].filter((m) => m.room === room);
  }

  /** Rectangulo interior de un claro en pixeles, con un margen en casillas. */
  private box(def: AdventureRoom, margin = 0): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: (def.x + margin) * TILE,
      y0: (def.y + margin) * TILE,
      x1: (def.x + def.w - margin) * TILE,
      y1: (def.y + def.h - margin) * TILE,
    };
  }

  private inside(def: AdventureRoom, x: number, y: number, margin = 0): boolean {
    const b = this.box(def, margin);
    return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
  }

  // ---------------------------------------------------------------- el mundo de los enemigos

  private makeCtx(): MobCtx {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const g = this;
    const ctx: MobCtx = {
      time: 0,
      dt: TICK_DT,
      rng: this.rng,
      map: this.map,
      players: () => g.cats.filter((c) => c.alive),
      nearest: (x, y) => {
        let best: Target | null = null;
        let bestD = Infinity;
        for (const c of g.cats) {
          if (!c.alive) continue;
          const d = dist(x, y, c.x, c.y);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        return best;
      },
      hit: (t, dmg, from) => {
        const cat = g.cat(t.id);
        if (cat) g.damageFrom(cat, dmg, from);
      },
      shoot: (from, angle, kind, dmg, speed, range) =>
        g.hostileShot(from, angle, kind, dmg, speed, range),
      hazard: (h) => g.addHazard(h),
      tele: (x, y, r, t, shape = 0, a, len) => g.emitTele(x, y, r, t, shape, a, len),
      spawn: (kind, x, y, room, owner) => g.spawnMob(kind, x, y, room, owner),
      push: (t, fx, fy, d) => {
        const cat = g.cat(t.id);
        if (!cat) return;
        const a = Math.atan2(cat.y - fy, cat.x - fx);
        const p = moveBox(g.map, cat.x, cat.y, Math.cos(a) * d, Math.sin(a) * d, CAT.half);
        cat.x = p.x;
        cat.y = p.y;
      },
      bounds: (room) => g.box((g.rooms[room] as RoomRt).def, 1),
      mobsOfRoom: (room) => g.mobsOfRoom(room),
      bossEvent: (kind, phase) => g.emit({ e: 'boss', kind, phase }),
    };
    return ctx;
  }

  private emitTele(
    x: number,
    y: number,
    r: number,
    t: number,
    shape: 0 | 1,
    a?: number,
    len?: number,
  ): void {
    this.emit({
      e: 'tele',
      x: Math.round(x),
      y: Math.round(y),
      r,
      t,
      shape,
      ...(a !== undefined ? { a: Math.round((a * 180) / Math.PI) } : {}),
      ...(len !== undefined ? { len } : {}),
    });
  }

  private hostileShot(
    from: Mob,
    angle: number,
    kind: number,
    dmg: number,
    speed: number,
    range: number,
  ): void {
    if (this.shots.length > 300) return;
    const shot: Shot = {
      id: this.nextId++,
      x: from.x,
      y: from.y - 1,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      dmg,
      owner: -from.id,
      left: range,
      weapon: 'pistol',
      rarity: 0,
      kind,
      splash: 0,
      angle,
    };
    this.shots.push(shot);
  }

  private addHazard(h: {
    x: number;
    y: number;
    r: number;
    kind: number;
    dmg: number;
    delay: number;
    life: number;
    dps?: number;
    owner: Mob;
  }): void {
    this.perils.push({
      id: this.nextId++,
      x: h.x,
      y: h.y,
      r: h.r,
      kind: h.kind,
      dmg: h.dmg,
      dps: h.dps ?? 0,
      start: this.time + h.delay,
      until: this.time + h.delay + h.life,
      fired: false,
      hit: new Set(),
      owner: h.owner.id,
      grow: h.kind === HAZARD.onda ? 100 : 0,
    });
    if (this.perils.length > 60) this.perils.shift();
  }

  /** Un enemigo hace dano a un gato (con aviso de evento y el trato de armadura y voltereta). */
  private damageFrom(cat: Cat, dmg: number, _from: Mob): void {
    this.damageCat(cat, dmg, null);
  }

  override damageCat(target: Cat, amount: number, attacker: Cat | null): void {
    const st = this.state.get(target.id);
    if (!target.alive || amount <= 0) return;
    if (st) {
      // la voltereta deja pasar los golpes un instante
      if (this.time < st.invulnUntil) return;
      amount = Math.max(1, Math.round(amount * st.mods.taken));
      st.lastHurt = this.time;
    }
    super.damageCat(target, amount, attacker);
  }

  spawnMob(kind: number, x: number, y: number, room: number, owner?: Mob): Mob | null {
    if (this.mobs.size >= MAX_MOBS) return null;
    const def = mobDef(kind);
    const act = (this.rooms[room]?.def.act ?? this.act()) as number;
    const n = this.squadSize();
    // en solitario todo es un poco mas manso; con amigos los jefes aguantan mas y atacan mas seguido
    const solo = n === 1;
    const scale = def.boss ? (solo ? 1 : 1 + 0.78 * (n - 1)) : hpScale(act, n) * (solo ? 0.95 : 1);
    const hp = Math.round(def.hp * scale);
    const mob: Mob = {
      id: this.nextId++,
      kind,
      def,
      room,
      x,
      y,
      hp,
      maxHp: hp,
      aim: 0,
      born: this.time,
      cd: this.time + 0.8,
      windupUntil: 0,
      stunUntil: 0,
      hurtUntil: 0,
      dashUntil: 0,
      dvx: 0,
      dvy: 0,
      invuln: 0,
      slowUntil: 0,
      hard: n - 1,
      phase: 1,
      dmgScale: dmgScale(act) * (solo ? 0.95 : 1 + 0.12 * (n - 1)),
      script: null,
      targetId: 0,
      retargetAt: 0,
      data: {},
    };
    if (owner) mob.cd = this.time + 1.2;
    this.mobs.set(mob.id, mob);
    return mob;
  }

  // ---------------------------------------------------------------- golpes contra enemigos

  protected override shotMobHit(
    s: Shot,
    nx: number,
    ny: number,
    tMax: number,
  ): { t: number; mob: unknown } | null {
    let best: { t: number; mob: unknown } | null = null;
    let bestT = tMax;
    for (const m of this.mobs.values()) {
      if (m.hp <= 0) continue;
      const t = segmentCircleHit(s.x, s.y, nx, ny, m.x, m.y, m.def.half + 3);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = { t, mob: m };
      }
    }
    return best;
  }

  protected override shotHitsMob(s: Shot, mob: unknown, x: number, y: number): void {
    const m = mob as Mob;
    const by = this.cat(s.owner);
    if (s.splash > 0) return; // la explosion se encarga
    if (by) this.damageMob(m, s.dmg, by, x, y);
  }

  protected override explodeMobs(s: Shot, x: number, y: number): void {
    const by = this.cat(s.owner);
    if (!by) return;
    for (const m of [...this.mobs.values()]) {
      const d = dist(x, y, m.x, m.y);
      const dmg = splashDamage(s.dmg, d, s.splash + m.def.half + 4);
      if (dmg > 0) this.damageMob(m, dmg, by, m.x, m.y);
    }
  }

  protected override clawMobs(cat: Cat, aim: number): void {
    const st = this.state.get(cat.id) as PlayerAdv;
    const rage = this.time < st.rageUntil ? POTION.catnip.dmg : 1;
    for (const m of [...this.mobs.values()]) {
      const d = dist(cat.x, cat.y, m.x, m.y);
      if (d > CLAWS.range + m.def.half + 6) continue;
      const to = Math.atan2(m.y - cat.y, m.x - cat.x);
      const diff = Math.abs(Math.atan2(Math.sin(to - aim), Math.cos(to - aim)));
      if (diff > 0.95 && d > m.def.half + 8) continue;
      const crit = this.runRng.chance(st.mods.crit) ? 2 : 1;
      this.damageMob(m, CLAWS.damage * 2.2 * st.mods.claw * rage * crit, cat, m.x, m.y);
    }
  }

  damageMob(m: Mob, amount: number, by: Cat | null, x = m.x, y = m.y): void {
    if (m.hp <= 0 || amount <= 0) return;
    if (this.time < m.invuln || this.time < m.born + 0.45) return;
    const dealt = Math.min(m.hp, amount);
    m.hp -= amount;
    m.hurtUntil = this.time + 0.12;
    if (by) by.damageDealt += dealt;
    this.emit({
      e: 'hit',
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      v: Math.round(dealt),
      kill: m.hp <= 0,
      by: by?.id ?? 0,
      to: m.id,
    });
    if (m.def.boss) this.bossHp.set(m.id, Math.max(0, m.hp));
    if (m.hp <= 0) this.killMob(m, by);
  }

  private killMob(m: Mob, by: Cat | null): void {
    this.mobs.delete(m.id);
    this.bossHp.delete(m.id);
    this.kills++;
    this.emit({
      e: 'mobdie',
      x: Math.round(m.x),
      y: Math.round(m.y),
      kind: m.kind,
      boss: !!m.def.boss,
    });
    if (by) {
      by.kills++;
      const st = this.state.get(by.id);
      if (st && st.mods.lifesteal > 0 && by.alive)
        by.hp = Math.min(this.capsOf(by).hp, by.hp + st.mods.lifesteal);
    }
    this.dropFrom(m);
    if (m.def.boss) {
      // al caer el jefe sus invocados se desvanecen
      for (const o of this.mobsOfRoom(m.room)) {
        if (o.def.boss) continue;
        this.mobs.delete(o.id);
        this.emit({
          e: 'mobdie',
          x: Math.round(o.x),
          y: Math.round(o.y),
          kind: o.kind,
          boss: false,
        });
      }
    }
  }

  // ---------------------------------------------------------------- botin

  private addPickup(x: number, y: number, kind: number, item?: Item, spread = 6): void {
    if (this.pickups.length > 120) this.pickups.shift();
    this.pickups.push({
      id: this.nextId++,
      x: x + this.runRng.range(-spread, spread),
      y: y + this.runRng.range(-spread, spread),
      kind,
      ...(item ? { item } : {}),
      until: this.time + 90,
    });
  }

  private dropFrom(m: Mob): void {
    const r = this.runRng;
    if (m.def.boss) {
      this.bossLoot(m);
      return;
    }
    if (r.chance(0.06)) this.addPickup(m.x, m.y, 4, { kind: 'medkit', qty: 1, rarity: 0 });
    if (r.chance(0.17)) this.addPickup(m.x, m.y, 0);
    if (r.chance(0.26)) this.addPickup(m.x, m.y, 1);
    if (r.chance(0.025))
      this.addPickup(m.x, m.y, 2, {
        kind: r.chance(0.5) ? 'potion_catnip' : 'potion_valerian',
        qty: 1,
        rarity: 0,
      });
  }

  /** Arma para el botin de la Aventura: casi nunca pistola (esa ya la llevas). */
  private rollLootWeapon(act: number, golden: boolean): Item {
    const w = rollWeapon(this.runRng, golden ? 'golden' : 'normal');
    if (w.kind === 'pistol' && this.runRng.chance(0.8)) {
      const alt = this.runRng.pick(['shotgun', 'rifle', 'rifle', 'sniper', 'bazooka'] as const);
      return { kind: alt, qty: 1, rarity: w.rarity, mag: WEAPONS[alt].magazine };
    }
    void act;
    return w;
  }

  /**
   * Premio de un jefe: armas, curas, balas, corazones y armadura. Crece con el grupo (cada gato
   * recibe lo suyo) y en solitario es mas generoso para que no sea tan cuesta arriba.
   */
  private bossLoot(m: Mob): void {
    const n = this.squadSize();
    const solo = n === 1;
    const room = this.rooms[m.room] as RoomRt;
    const act = room.def.act;
    const drops: { kind: number; item?: Item }[] = [];
    for (let i = 0; i < (solo ? 2 : n); i++)
      drops.push({ kind: 4, item: this.rollLootWeapon(act, true) });
    for (let i = 0; i < (solo ? 2 : n + 1); i++)
      drops.push({ kind: 4, item: { kind: 'medkit', qty: 1, rarity: 0 } });
    for (let i = 0; i < (solo ? 2 : n); i++)
      drops.push({ kind: 4, item: { kind: 'shield', qty: 1, rarity: 0 } });
    for (let i = 0; i < 3 + n; i++) drops.push({ kind: 0 });
    for (let i = 0; i < 3 + 2 * n; i++) drops.push({ kind: 1 });
    if (m.kind !== MOB.reyGato)
      for (let i = 0; i < (n >= 3 ? 2 : 1); i++)
        drops.push({ kind: 3, item: this.rollArmor(this.runRng, act + 1) });
    // se reparte en un circulo alrededor del jefe para que se vea y cada gato alcance lo suyo
    drops.forEach((d, i) => {
      const a = (i / drops.length) * Math.PI * 2 + 0.3;
      const rad = 22 + (i % 2) * 12;
      this.addPickup(m.x + Math.cos(a) * rad, m.y + Math.sin(a) * rad, d.kind, d.item, 2);
    });
  }

  // ---------------------------------------------------------------- habilidades de jefe

  /** Ofrece las habilidades de un jefe caido a cada gato que sigue de pie. */
  private offerPowers(boss: number): void {
    for (const c of this.cats) {
      if (!c.alive) continue;
      const st = this.state.get(c.id) as PlayerAdv;
      const offer = powerOffer(this.runRng, st.powers, boss);
      if (offer.length > 0) st.powerOffers.push(offer);
      c.invDirty = true;
    }
  }

  /** Elige una de las habilidades ofrecidas: una nueva o subir de nivel una que ya llevas. */
  choosePower(catId: number, index: number): boolean {
    const cat = this.cat(catId);
    const st = this.state.get(catId);
    if (!cat || !st || !Number.isInteger(index)) return false;
    const offer = st.powerOffers[0];
    const id = offer?.[index];
    if (id === undefined) return false;
    const own = st.powers.find((p) => p.id === id);
    if (own) own.level = Math.min(POWER_MAX_LEVEL, own.level + 1);
    else if (st.powers.length < POWER_SLOTS)
      st.powers.push({ id, level: 1, readyAt: this.time + 2 });
    else return false;
    st.powerOffers.shift();
    this.emit({ e: 'relic', x: Math.round(cat.x), y: Math.round(cat.y) });
    return true;
  }

  private usePower(cat: Cat, slot: number): void {
    const st = this.state.get(cat.id) as PlayerAdv;
    const p = st.powers[slot];
    if (!p || !cat.alive || this.time < p.readyAt) return;
    const def = POWERS[p.id];
    if (!def) return;
    const eff = powerEffect(p.level);
    const dur = def.duration * eff;
    p.readyAt = this.time + powerCooldown(def, p.level);
    const near = (r: number): Mob[] =>
      [...this.mobs.values()].filter(
        (m) => m.hp > 0 && dist(cat.x, cat.y, m.x, m.y) <= r + m.def.half,
      );
    const push = (m: Mob, d: number): void => {
      const a = Math.atan2(m.y - cat.y, m.x - cat.x);
      const next = moveBox(this.map, m.x, m.y, Math.cos(a) * d, Math.sin(a) * d, m.def.half);
      m.x = next.x;
      m.y = next.y;
    };
    switch (p.id) {
      case 0:
        st.furyUntil = this.time + dur;
        st.furyEff = eff;
        break;
      case 1:
        st.gazeUntil = this.time + dur;
        st.gazeEff = eff;
        break;
      case 2:
        this.addHealZone(cat.x, cat.y, 62 + 8 * p.level, 11 * eff, dur, cat.id);
        break;
      case 3:
        for (const m of near(82 + 10 * (p.level - 1))) {
          this.damageMob(m, 22 * eff * st.mods.dmg * (m.def.boss ? 0.6 : 1), cat);
          if (!m.def.boss) {
            m.stunUntil = Math.max(m.stunUntil, this.time + 1.4 + 0.3 * (p.level - 1));
            push(m, 30);
          }
        }
        break;
      case 4:
        st.ghostUntil = this.time + dur;
        st.invulnUntil = Math.max(st.invulnUntil, this.time + dur);
        break;
      case 5:
        for (const m of near(105 + 8 * (p.level - 1))) {
          this.damageMob(m, 36 * eff * st.mods.dmg, cat);
          if (!m.def.boss) push(m, 18);
        }
        this.emit({ e: 'boom', x: Math.round(cat.x), y: Math.round(cat.y), r: 70 });
        break;
      case 6:
        for (const c of this.cats) {
          if (!c.alive || dist(c.x, c.y, cat.x, cat.y) > 92) continue;
          c.shield = Math.min(this.capsOf(c).shield, c.shield + 55 * eff);
          c.invDirty = true;
        }
        break;
      default:
        for (const m of near(150)) m.slowUntil = Math.max(m.slowUntil, this.time + dur);
    }
    this.emit({
      e: 'power',
      id: p.id,
      x: Math.round(cat.x),
      y: Math.round(cat.y),
      who: cat.id,
      lvl: p.level,
    });
  }

  /** Nube de esporas que cura a quien se queda dentro. */
  private addHealZone(
    x: number,
    y: number,
    r: number,
    hps: number,
    life: number,
    owner: number,
  ): void {
    this.perils.push({
      id: this.nextId++,
      x,
      y,
      r,
      kind: HAZARD.espora,
      dmg: 0,
      dps: hps,
      start: this.time,
      until: this.time + life,
      fired: false,
      hit: new Set(),
      owner,
      grow: 0,
    });
    if (this.perils.length > 60) this.perils.shift();
  }

  /** Los que cayeron sin vidas vuelven (con medio gato de vida) si queda alguien que los levante. */
  private reviveFallen(): void {
    if (!this.cats.some((c) => c.alive)) return;
    for (const c of this.cats) {
      const st = this.state.get(c.id) as PlayerAdv;
      if (c.alive || !st.zoneRevive) continue;
      st.zoneRevive = false;
      this.revive(c);
    }
  }

  private collectPickups(): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i] as Pickup;
      if (this.time > p.until) {
        this.pickups.splice(i, 1);
        continue;
      }
      for (const cat of this.cats) {
        if (!cat.alive || dist(cat.x, cat.y, p.x, p.y) > 13) continue;
        if (this.takePickup(cat, p)) {
          this.emit({ e: 'pickup', x: Math.round(p.x), y: Math.round(p.y), kind: p.kind });
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  private takePickup(cat: Cat, p: Pickup): boolean {
    const st = this.state.get(cat.id) as PlayerAdv;
    const caps = this.capsOf(cat);
    if (p.kind === 0) {
      if (cat.hp >= caps.hp && cat.shield >= caps.shield) return false;
      cat.hp = Math.min(caps.hp, cat.hp + 16);
      return true;
    }
    if (p.kind === 1) {
      const weapons = cat.inv.filter((it) => it && isWeapon(it.kind)) as Item[];
      const w = weapons.length > 0 ? this.runRng.pick(weapons) : { kind: 'pistol' };
      const kind = `ammo_${w.kind}` as AmmoKind;
      const qty = Math.max(1, Math.round((AMMO_DROP[w.kind] ?? 12) * st.mods.lootAmmo));
      if (addAmmo(cat.ammo, kind, qty) <= 0 && cat.ammo[kind] >= 120) return false;
      cat.invDirty = true;
      return true;
    }
    if (p.kind === 2 && p.item) {
      const left = giveItem(cat.inv, cat.ammo, { ...p.item });
      if (left) return false;
      cat.invDirty = true;
      return true;
    }
    if (p.kind === 3 && p.item) {
      this.equipItem(cat, p.item);
      return true;
    }
    if (p.kind === 4 && p.item) {
      const left = giveItem(cat.inv, cat.ammo, { ...p.item });
      if (left) return false;
      // un arma nueva viene con balas para empezar a usarla
      if (isWeapon(p.item.kind)) {
        const kind = `ammo_${p.item.kind}` as AmmoKind;
        addAmmo(cat.ammo, kind, Math.round((AMMO_DROP[p.item.kind] ?? 12) * 2 * st.mods.lootAmmo));
      }
      cat.invDirty = true;
      return true;
    }
    return true;
  }

  /** Una pieza de armadura se pone sola si es mejor que la que ya llevas. */
  protected override equipItem(cat: Cat, item: Item): boolean {
    if (!isArmor(item.kind)) return false;
    const st = this.state.get(cat.id) as PlayerAdv;
    const slot = item.kind === 'armor_head' ? 0 : item.kind === 'armor_body' ? 1 : 2;
    if (item.rarity > st.equip[slot]) {
      st.equip[slot] = item.rarity;
      this.recompute(cat);
      this.emit({ e: 'relic', x: Math.round(cat.x), y: Math.round(cat.y) });
    } else {
      // ya llevas algo igual o mejor: la pieza se convierte en un poco de escudo
      cat.shield = Math.min(this.capsOf(cat).shield, cat.shield + 20);
    }
    return true;
  }

  private recompute(cat: Cat): void {
    const st = this.state.get(cat.id) as PlayerAdv;
    const before = st.mods.maxHp;
    st.mods = computeMods(st.relics, st.equip, st.meta);
    if (st.mods.maxHp > before && cat.alive) cat.hp += st.mods.maxHp - before;
    cat.hp = Math.min(cat.hp, st.mods.maxHp);
  }

  // ---------------------------------------------------------------- reliquias

  private offerRelics(cat: Cat): void {
    const st = this.state.get(cat.id) as PlayerAdv;
    const pool = RELICS.map((r) => r.id).filter(
      (id) => !(id === 10 && st.relics.filter((x) => x === 10).length >= 3),
    );
    const picks: number[] = [];
    while (picks.length < 3 && pool.length > 0) {
      const i = this.runRng.int(0, pool.length - 1);
      picks.push(pool.splice(i, 1)[0] as number);
    }
    st.offers.push(picks);
    cat.invDirty = true;
  }

  /** Elige una de las reliquias ofrecidas (0 a 2). */
  chooseRelic(catId: number, index: number): boolean {
    const cat = this.cat(catId);
    const st = this.state.get(catId);
    if (!cat || !st || !Number.isInteger(index)) return false;
    const offer = st.offers[0];
    const id = offer?.[index];
    if (id === undefined) return false;
    st.offers.shift();
    st.relics.push(id);
    if (id === 10) this.lives++;
    this.recompute(cat);
    this.emit({ e: 'relic', x: Math.round(cat.x), y: Math.round(cat.y) });
    return true;
  }

  // ---------------------------------------------------------------- pociones y voltereta

  protected override useItem(cat: Cat, item: Item): void {
    const st = this.state.get(cat.id) as PlayerAdv;
    if (item.kind === 'potion_catnip') st.rageUntil = this.time + POTION.catnip.seconds;
    else if (item.kind === 'potion_valerian') st.swiftUntil = this.time + POTION.valerian.seconds;
    else return;
    takeOne(cat.inv, cat.sel);
    cat.invDirty = true;
    this.emit({ e: 'heal2', x: Math.round(cat.x), y: Math.round(cat.y) });
  }

  protected override adjustMove(
    cat: Cat,
    input: InputPayload,
    mul: number,
  ): { mx: number; my: number; mul: number } {
    const st = this.state.get(cat.id);
    if (!st) return { mx: input.mx, my: input.my, mul };
    if (input.pw) this.usePower(cat, input.pw - 1);
    if (input.dash && st.dashLeft <= 0 && this.time >= st.dashReadyAt && cat.alive) {
      const len = Math.hypot(input.mx, input.my);
      const dx = len > 0.1 ? input.mx / len : Math.cos(input.aim);
      const dy = len > 0.1 ? input.my / len : Math.sin(input.aim);
      st.dashDx = dx;
      st.dashDy = dy;
      st.dashLeft = DASH.seconds;
      const swift = this.time < st.swiftUntil ? POTION.valerian.dash : 1;
      st.dashReadyAt = this.time + DASH.cooldown * st.mods.dashCd * swift;
      st.invulnUntil = this.time + DASH.invuln;
      this.emit({
        e: 'dash',
        x: Math.round(cat.x),
        y: Math.round(cat.y),
        a: Math.round((Math.atan2(dy, dx) * 180) / Math.PI),
      });
    }
    if (st.dashLeft > 0) {
      st.dashLeft -= TICK_DT;
      return { mx: st.dashDx, my: st.dashDy, mul: DASH.distance / DASH.seconds / CAT.speed };
    }
    const swift = this.time < st.swiftUntil ? POTION.valerian.speed : 1;
    const rage = this.time < st.rageUntil ? POTION.catnip.speed : 1;
    const ghost = this.time < st.ghostUntil ? 1.4 : 1;
    return { mx: input.mx, my: input.my, mul: mul * st.mods.speed * swift * rage * ghost };
  }

  protected override shotDamage(cat: Cat, base: number): number {
    const st = this.state.get(cat.id) as PlayerAdv;
    const rage = this.time < st.rageUntil ? POTION.catnip.dmg : 1;
    const crit = this.runRng.chance(st.mods.crit) ? 2 : 1;
    const gaze = this.time < st.gazeUntil ? 1 + 0.8 * st.gazeEff : 1;
    return Math.max(1, Math.round(base * st.mods.dmg * rage * crit * gaze));
  }

  protected override shotCooldown(cat: Cat, base: number): number {
    const st = this.state.get(cat.id) as PlayerAdv;
    return this.time < st.furyUntil ? base * (0.5 / st.furyEff) : base;
  }

  protected override reloadTime(cat: Cat, base: number): number {
    return base * this.modsOf(cat).reload;
  }

  protected override shotRange(cat: Cat, base: number): number {
    const st = this.state.get(cat.id) as PlayerAdv;
    const gaze = this.time < st.gazeUntil ? 1 + 0.3 * st.gazeEff : 1;
    return base * this.modsOf(cat).range * gaze;
  }

  protected override spendsAmmo(cat: Cat): boolean {
    return !this.runRng.chance(this.modsOf(cat).ammoSave);
  }

  // ---------------------------------------------------------------- caidas y vidas

  protected override killCat(target: Cat, killer: Cat | null): void {
    super.killCat(target, killer);
    const st = this.state.get(target.id) as PlayerAdv;
    target.heal = null;
    target.reload = null;
    if (this.lives > 0) {
      this.lives--;
      st.reviveAt = this.time + REVIVE_S;
    } else {
      // sin vidas: se levanta al terminar la zona, si todavia queda alguien de pie
      st.reviveAt = Infinity;
      st.zoneRevive = true;
    }
  }

  override drainDeaths(): {
    catId: number;
    payload: import('../../shared/br/protocol').DiedPayload;
  }[] {
    super.drainDeaths();
    return [];
  }

  private revive(cat: Cat): void {
    const st = this.state.get(cat.id) as PlayerAdv;
    // vuelve junto a un companero, o al centro del claro si no queda nadie de pie
    const mate = this.cats.find((c) => c.alive && c.id !== cat.id);
    const room = this.rooms[this.currentRoom] as RoomRt;
    const cx = (room.def.x + room.def.w / 2) * TILE;
    const cy = (room.def.y + room.def.h / 2) * TILE;
    cat.x = mate ? mate.x : cx;
    cat.y = mate ? mate.y : cy;
    cat.alive = true;
    cat.hp = Math.round(st.mods.maxHp * 0.6);
    cat.shield = 0;
    cat.queue.length = 0;
    cat.spectate = null;
    cat.invDirty = true;
    st.reviveAt = 0;
    st.invulnUntil = this.time + 2.2;
    this.emit({ e: 'revive', x: Math.round(cat.x), y: Math.round(cat.y), id: cat.id });
  }

  protected override spectateTarget(): number | null {
    return this.aliveCats()[0]?.id ?? null;
  }

  // ---------------------------------------------------------------- salas

  private playersIn(def: AdventureRoom, margin = 0): Cat[] {
    return this.cats.filter((c) => c.alive && this.inside(def, c.x, c.y, margin));
  }

  private updateRooms(): void {
    const alive = this.cats.filter((c) => c.alive);
    // la sala actual es donde esta el primero de pie
    for (const r of this.rooms) {
      if (alive.some((c) => this.inside(r.def, c.x, c.y, 0))) {
        this.currentRoom = r.def.id;
        break;
      }
    }
    for (const room of this.rooms) {
      const def = room.def;
      if (room.state === 0) {
        if (this.playersIn(def, 2).length === 0) continue;
        if (LOCKING.has(def.kind)) this.activate(room);
        else this.visit(room);
      }
      if (room.state === 1) this.runRoom(room);
    }
    // la fuente de leche cura al grupo
    for (const room of this.rooms) {
      if (room.def.kind !== 'descanso') continue;
      const cx = (room.def.x + room.def.w / 2) * TILE;
      const cy = (room.def.y + room.def.h / 2) * TILE;
      for (const c of this.cats) {
        if (!c.alive || dist(c.x, c.y, cx, cy) > 56) continue;
        const caps = this.capsOf(c);
        c.hp = Math.min(caps.hp, c.hp + 9 * TICK_DT);
        c.shield = Math.min(caps.shield, c.shield + 5 * TICK_DT);
      }
    }
  }

  /** Salas de tesoro y descanso: no se cierran, solo se visitan. */
  private visit(room: RoomRt): void {
    room.state = 2;
    if (room.def.kind === 'tesoro' && !room.offered) {
      room.offered = true;
      for (const c of this.cats) if (c.alive) this.offerRelics(c);
    }
    // llegar a un lugar seguro tambien levanta a los que cayeron sin vidas
    if (room.def.kind === 'tesoro' || room.def.kind === 'descanso') this.reviveFallen();
  }

  private activate(room: RoomRt): void {
    room.state = 1;
    room.startedAt = this.time;
    const act = room.def.act;
    if (room.def.kind === 'combate') {
      room.waves = wavePlan(this.runRng, act, this.squadSize());
      room.nextWaveAt = this.time + 1;
    } else {
      room.waves = [];
      room.nextWaveAt = this.time + 1.8;
    }
  }

  private runRoom(room: RoomRt): void {
    const def = room.def;
    // las puertas se cierran un instante despues de entrar
    if (!room.closed && this.time >= room.startedAt + GATE_DELAY_S) this.closeGates(room);
    const alive = this.mobsOfRoom(def.id).filter((m) => m.hp > 0);
    const queued = this.pending.some((p) => p.room === def.id);
    if (def.kind === 'combate') {
      if (alive.length === 0 && !queued && this.time >= room.nextWaveAt) {
        if (room.wave < room.waves.length) {
          this.spawnWave(room, room.waves[room.wave] as number[]);
          room.wave++;
          room.nextWaveAt = this.time + 2.4;
        } else {
          this.clearRoom(room);
        }
      }
      return;
    }
    // jefes: el jefe aparece con un aviso y la sala se supera al caer
    if (!room.bossSpawned && this.time >= room.nextWaveAt) {
      room.bossSpawned = true;
      const cx = (def.x + def.w / 2) * TILE;
      const cy = (def.y + def.h / 2) * TILE;
      const boss = this.spawnMob(def.boss as number, cx, cy - 20, def.id);
      if (boss) {
        boss.cd = this.time + 2.2;
        this.emit({ e: 'boss', kind: boss.kind, phase: 1 });
      }
      return;
    }
    if (room.bossSpawned && !alive.some((m) => m.def.boss) && !queued) this.clearRoom(room);
  }

  private spawnWave(room: RoomRt, wave: number[]): void {
    const def = room.def;
    for (const kind of wave) {
      const p = this.spawnSpot(def);
      this.pending.push({ at: this.time + 0.85, kind, x: p.x, y: p.y, room: def.id });
      this.emitTele(p.x, p.y, 9, 0.85, 0);
    }
  }

  /** Marca todo el suelo conectado con el centro de la sala de inicio. */
  private floodFill(): Uint8Array {
    const { w, h, solid } = this.map;
    const seen = new Uint8Array(w * h);
    const start = this.rooms[0]?.def;
    if (!start) return seen;
    const sx = Math.floor(start.x + start.w / 2);
    const sy = Math.floor(start.y + start.h / 2);
    const queue = [sy * w + sx];
    seen[sy * w + sx] = 1;
    for (let head = 0; head < queue.length; head++) {
      const n = queue[head] as number;
      const x = n % w;
      const y = (n - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (seen[k] || solid[k] !== 0) continue;
        seen[k] = 1;
        queue.push(k);
      }
    }
    return seen;
  }

  private spawnSpot(def: AdventureRoom): { x: number; y: number } {
    const players = this.cats.filter((c) => c.alive);
    for (let i = 0; i < 40; i++) {
      const tx = this.runRng.int(def.x + 2, def.x + def.w - 3);
      const ty = this.runRng.int(def.y + 2, def.y + def.h - 3);
      if (this.map.solid[ty * this.map.w + tx] !== 0 || !this.reach[ty * this.map.w + tx]) continue;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (players.some((p) => dist(p.x, p.y, x, y) < 70)) continue;
      return { x, y };
    }
    return { x: (def.x + def.w / 2) * TILE, y: (def.y + def.h / 2) * TILE };
  }

  private closeGates(room: RoomRt): void {
    room.closed = true;
    const def = room.def;
    // quien se quedo afuera entra al claro: nadie se pierde la pelea
    const cx = (def.x + def.w / 2) * TILE;
    const cy = (def.y + def.h / 2) * TILE;
    this.cats.forEach((c, i) => {
      if (!c.alive || this.inside(def, c.x, c.y, 0)) return;
      c.x = cx + (i % 2 === 0 ? -1 : 1) * 14 * (1 + (i >> 1));
      c.y = cy + 24;
    });
    for (const g of def.gates) {
      this.map.solid[g.y * this.map.w + g.x] = 3;
      // si un gato quedo justo en la puerta, sale hacia el claro
      for (const c of this.cats) {
        if (c.alive && Math.floor(c.x / TILE) === g.x && Math.floor(c.y / TILE) === g.y) {
          c.x = cx;
          c.y = cy + 20;
        }
      }
    }
    const g0 = def.gates[0];
    if (g0) this.emit({ e: 'gate', x: g0.x * TILE, y: g0.y * TILE, open: false });
  }

  private openGates(room: RoomRt): void {
    const def = room.def;
    for (const g of def.gates) this.map.solid[g.y * this.map.w + g.x] = 0;
    room.closed = false;
    const g0 = def.gates[0];
    if (g0) this.emit({ e: 'gate', x: g0.x * TILE, y: g0.y * TILE, open: true });
  }

  private clearRoom(room: RoomRt): void {
    room.state = 2;
    this.roomsCleared++;
    this.openGates(room);
    const def = room.def;
    const cx = (def.x + def.w / 2) * TILE;
    const cy = (def.y + def.h / 2) * TILE;
    const act = def.act;
    if (def.kind === 'combate') {
      for (let i = 0; i < 2 + (this.squadSize() > 2 ? 1 : 0); i++) this.addPickup(cx, cy, 0);
      for (let i = 0; i < 2; i++) this.addPickup(cx, cy, 1);
      // las salas dejan curas y, a veces, un arma: nadie debe llegar al jefe solo con la pistola
      const solo = this.squadSize() === 1;
      if (this.runRng.chance(solo ? 0.55 : 0.45))
        this.addPickup(cx, cy, 4, { kind: 'medkit', qty: 1, rarity: 0 }, 22);
      if (this.runRng.chance(solo ? 0.35 : 0.25))
        this.addPickup(cx, cy, 4, { kind: 'shield', qty: 1, rarity: 0 }, 22);
      // en el primer acto casi siempre cae un arma: el primer jefe no se pelea solo con la pistola
      if (this.runRng.chance(act === 0 ? 0.6 : solo ? 0.3 : 0.22))
        this.addPickup(cx, cy, 4, this.rollLootWeapon(act, false), 22);
      if (this.runRng.chance(0.28))
        this.addPickup(cx, cy, 2, {
          kind: this.runRng.chance(0.5) ? 'potion_catnip' : 'potion_valerian',
          qty: 1,
          rarity: 0,
        });
      if (this.runRng.chance(0.1)) this.addPickup(cx, cy, 3, this.rollArmor(this.runRng, act));
    } else {
      this.bossesDown++;
      // un minijefe regala una reliquia a cada gato (el jefe final cierra la aventura)
      if (def.kind === 'minijefe') {
        for (const c of this.cats) if (c.alive) this.offerRelics(c);
        this.offerPowers(def.boss ?? -1);
      }
      if (def.kind === 'jefe') this.victory();
    }
    // los caidos se levantan al terminar la pelea sin gastar tiempo de espera
    for (const c of this.cats) {
      const st = this.state.get(c.id) as PlayerAdv;
      if (!c.alive && st.reviveAt !== Infinity && st.reviveAt > 0) st.reviveAt = this.time + 0.4;
    }
    // y los que se quedaron sin vidas regresan con la zona superada (si queda alguien de pie)
    this.reviveFallen();
  }

  // ---------------------------------------------------------------- final de la partida

  private victory(): void {
    this.ending = 'victory';
    this.finishAdventure(true);
  }

  private finishAdventure(won: boolean): void {
    if (this.result) return;
    this.ending ??= won ? 'victory' : 'defeat';
    const essence: Record<number, number> = {};
    const rows: PlacementRow[] = this.cats.map((c) => {
      const st = this.state.get(c.id) as PlayerAdv;
      st.essence = essenceFor(this.roomsCleared, this.bossesDown, c.kills, won, st.meta);
      essence[c.id] = st.essence;
      return {
        id: c.id,
        name: c.name,
        bot: c.bot,
        placement: won ? 1 : 2,
        kills: c.kills,
        survivalS: Math.round(this.time * 10) / 10,
        damageDealt: Math.round(c.damageDealt),
      };
    });
    const star = this.cats.find((c) => c.alive) ?? this.cats[0] ?? null;
    for (const c of this.cats) if (!c.alive && !c.bot && star) c.spectate = star.id;
    const relics = [
      ...new Set(this.cats.flatMap((c) => (this.state.get(c.id) as PlayerAdv).relics)),
    ];
    const result: GameEndPayload = {
      winnerId: star?.id ?? null,
      humanWon: won,
      durationS: Math.round(this.time * 10) / 10,
      rows,
      mode: 'aventura',
      adv: {
        victory: won,
        rooms: this.roomsCleared,
        totalRooms: this.rooms.length,
        bosses: this.bossesDown,
        kills: this.kills,
        relics,
        essence,
      },
    };
    this.result = result;
  }

  protected override finish(): void {
    this.finishAdventure(false);
  }

  protected override checkEnd(): void {
    if (this.result) return;
    const anyAlive = this.cats.some((c) => c.alive);
    const waiting = this.cats.some(
      (c) => !c.alive && (this.state.get(c.id) as PlayerAdv).reviveAt !== Infinity,
    );
    if (!anyAlive && !waiting) return this.finishAdventure(false);
    const humans = this.cats.filter((c) => !c.bot);
    if (humans.length > 0 && humans.every((c) => !c.connected)) this.finishAdventure(false);
  }

  // ---------------------------------------------------------------- simulacion

  protected override afterSim(dt: number): void {
    void dt;
    this.ctx.time = this.time;
    // enemigos que van naciendo
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i] as (typeof this.pending)[number];
      if (this.time >= p.at) {
        this.spawnMob(p.kind, p.x, p.y, p.room);
        this.pending.splice(i, 1);
      }
    }
    this.updateRooms();
    for (const m of [...this.mobs.values()]) {
      if (m.hp <= 0) continue;
      thinkMob(this.ctx, m);
    }
    this.updateHazards();
    this.collectPickups();
    // revivir y regenerar
    for (const c of this.cats) {
      const st = this.state.get(c.id) as PlayerAdv;
      if (!c.alive && st.reviveAt !== Infinity && st.reviveAt > 0 && this.time >= st.reviveAt)
        this.revive(c);
      // la pistola de siempre nunca se queda sin balas: sin armas no habria como seguir
      if (
        c.alive &&
        c.ammo.ammo_pistol < PISTOL_RESERVE &&
        Math.round(this.time / TICK_DT) % 6 === 0
      )
        c.ammo.ammo_pistol++;
      if (c.alive && st.mods.regen > 0 && this.time - st.lastHurt > 4) {
        st.regenAcc += st.mods.regen * TICK_DT;
        if (st.regenAcc >= 1) {
          const whole = Math.floor(st.regenAcc);
          st.regenAcc -= whole;
          c.hp = Math.min(this.capsOf(c).hp, c.hp + whole);
        }
      }
    }
    // el estado de los jefes (la barra de vida usa el valor actual)
    for (const m of this.mobs.values()) if (m.def.boss) m.phase = m.phase || bossPhase(m);
  }

  private updateHazards(): void {
    for (let i = this.perils.length - 1; i >= 0; i--) {
      const h = this.perils[i] as Hazard;
      if (this.time > h.until) {
        this.perils.splice(i, 1);
        continue;
      }
      if (this.time < h.start) continue;
      if (h.kind === HAZARD.charco) {
        for (const c of this.cats) {
          if (!c.alive || dist(c.x, c.y, h.x, h.y) > h.r) continue;
          const acc = (h.dps || 8) * TICK_DT;
          // el charco pega de a poquito, sin pasar por el aviso de cada golpe
          c.zoneAcc += acc;
          if (c.zoneAcc >= 1) {
            const whole = Math.floor(c.zoneAcc);
            c.zoneAcc -= whole;
            this.damageCat(c, whole, null);
          }
        }
      } else if (h.kind === HAZARD.espora) {
        for (const c of this.cats) {
          if (!c.alive || dist(c.x, c.y, h.x, h.y) > h.r) continue;
          const cst = this.state.get(c.id) as PlayerAdv;
          cst.healAcc += h.dps * TICK_DT;
          if (cst.healAcc >= 1) {
            const whole = Math.floor(cst.healAcc);
            cst.healAcc -= whole;
            c.hp = Math.min(this.capsOf(c).hp, c.hp + whole);
          }
        }
      } else if (h.kind === HAZARD.onda) {
        const radius = h.r + (this.time - h.start) * h.grow;
        for (const c of this.cats) {
          if (!c.alive || h.hit.has(c.id)) continue;
          const d = dist(c.x, c.y, h.x, h.y);
          if (Math.abs(d - radius) < 9) {
            h.hit.add(c.id);
            this.damageCat(c, h.dmg, null);
          }
        }
      } else if (!h.fired) {
        h.fired = true;
        for (const c of this.cats) {
          if (c.alive && dist(c.x, c.y, h.x, h.y) <= h.r) this.damageCat(c, h.dmg, null);
        }
      }
    }
  }

  // ---------------------------------------------------------------- instantanea

  protected override extendSnapshot(snap: BRSnapshot, cat: Cat): void {
    snap.mode = 'aventura';
    const st = this.state.get(cat.id) as PlayerAdv;
    const me = snap.me;
    me.dash = Math.max(0, Math.round((st.dashReadyAt - this.time) * 10) / 10);
    me.maxHp = st.mods.maxHp;
    me.maxShield = st.mods.maxShield;
    const swift = this.time < st.swiftUntil ? POTION.valerian.speed : 1;
    const rage = this.time < st.rageUntil ? POTION.catnip.speed : 1;
    const ghost = this.time < st.ghostUntil ? 1.4 : 1;
    me.spd = Math.round(st.mods.speed * swift * rage * ghost * 1000) / 1000;

    // lo que se ve cerca de quien mira (o de a quien esta mirando si cayo)
    const focus = cat.alive ? cat : (this.cat(cat.spectate ?? -1) ?? cat);
    const R = 560;
    const near = (x: number, y: number): boolean =>
      Math.abs(x - focus.x) < R && Math.abs(y - focus.y) < R;
    const mobs: MobTuple[] = [];
    for (const m of this.mobs.values()) {
      if (!near(m.x, m.y)) continue;
      mobs.push([
        m.id,
        Math.round(m.x * 10) / 10,
        Math.round(m.y * 10) / 10,
        m.kind,
        Math.max(1, Math.round((m.hp / m.maxHp) * 100)),
        mobFlags(m, this.time),
        Math.round((m.aim * 180) / Math.PI),
      ]);
    }
    snap.mobs = mobs;
    const haz: HazardTuple[] = [];
    for (const h of this.perils) {
      if (!near(h.x, h.y)) continue;
      const total = h.until - h.start;
      const prog =
        this.time < h.start
          ? 0
          : Math.min(100, Math.round(((this.time - h.start) / Math.max(0.1, total)) * 100));
      const r = h.kind === HAZARD.onda ? h.r + Math.max(0, this.time - h.start) * h.grow : h.r;
      haz.push([h.id, Math.round(h.x), Math.round(h.y), Math.round(r), h.kind, prog]);
    }
    snap.haz = haz;
    const pk: PickupTuple[] = [];
    for (const p of this.pickups)
      if (near(p.x, p.y)) {
        const base: PickupTuple = [p.id, Math.round(p.x), Math.round(p.y), p.kind];
        if (p.kind === 4 && p.item) base.push(ITEM_KINDS.indexOf(p.item.kind) * 3 + p.item.rarity);
        pk.push(base);
      }
    snap.pk = pk;

    const room = this.rooms[this.currentRoom] as RoomRt;
    const boss = [...this.mobs.values()].find((m) => m.def.boss && m.room === room.def.id);
    const adv: AdvState = {
      room: room.def.id,
      rooms: this.rooms.length,
      states: this.rooms.map((r) => r.state),
      roomName: room.def.name,
      roomKind: room.def.kind,
      wave: Math.min(room.wave, room.waves.length),
      waves: room.waves.length,
      boss: boss
        ? {
            kind: boss.kind,
            hp: Math.max(1, Math.round((boss.hp / boss.maxHp) * 100)),
            phase: boss.phase,
          }
        : null,
      lives: this.lives,
      kills: this.kills,
      time: Math.round(this.time),
      relics: st.relics,
      equip: [st.equip[0], st.equip[1], st.equip[2]],
      choice: st.offers[0] ?? null,
      pchoice: st.powerOffers[0] ?? null,
      powers: st.powers.map((p) => [
        p.id,
        p.level,
        Math.max(0, Math.round((p.readyAt - this.time) * 10) / 10),
        Math.max(
          0,
          Math.round(
            ((p.id === 0
              ? st.furyUntil
              : p.id === 1
                ? st.gazeUntil
                : p.id === 4
                  ? st.ghostUntil
                  : 0) -
              this.time) *
              10,
          ) / 10,
        ),
      ]),
      fallen: cat.alive
        ? 0
        : st.reviveAt !== Infinity
          ? Math.max(0, Math.ceil(st.reviveAt - this.time))
          : st.zoneRevive && this.cats.some((c) => c.alive)
            ? -1
            : 0,
      buffs: [
        Math.max(0, Math.ceil(st.rageUntil - this.time)),
        Math.max(0, Math.ceil(st.swiftUntil - this.time)),
      ],
      ...(this.ending ? { over: this.ending } : {}),
    };
    snap.adv = adv;
  }

  /** Solo para pruebas: salta a la sala `i` y la deja lista para empezar. */
  debugTeleport(i: number): void {
    const room = this.rooms[i];
    if (!room) return;
    const cx = (room.def.x + room.def.w / 2) * TILE;
    const cy = (room.def.y + room.def.h / 2) * TILE;
    this.cats.forEach((c, k) => {
      c.x = cx + (k % 2 === 0 ? -20 : 20);
      c.y = cy + 40 + k * 4;
    });
    // las salas anteriores se dan por superadas
    for (let k = 0; k < i; k++) {
      const r = this.rooms[k] as RoomRt;
      if (r.state !== 2) {
        r.state = 2;
        if (r.closed) this.openGates(r);
      }
    }
    this.currentRoom = i;
  }

  /** Solo para pruebas: da a un gato un arma fuerte. */
  /** Solo para pruebas: derrota al jefe de la sala donde esta el grupo. */
  debugKillBoss(): void {
    const cat = this.cats.find((c) => c.alive);
    if (!cat) return;
    for (const m of [...this.mobs.values()]) {
      if (!m.def.boss) continue;
      // un jefe recien aparecido no recibe dano: para la prueba se le quita esa proteccion
      m.born = this.time - 5;
      m.invuln = 0;
      this.damageMob(m, m.maxHp + 99, cat);
    }
  }

  /** Solo para pruebas: da la aventura por ganada con una marcha de ejemplo. */
  debugWin(): void {
    this.roomsCleared = Math.max(this.roomsCleared, 14);
    this.bossesDown = Math.max(this.bossesDown, 6);
    this.kills = Math.max(this.kills, 40);
    this.finishAdventure(true);
  }

  debugArm(catId: number): void {
    const cat = this.cat(catId);
    if (!cat) return;
    giveItem(cat.inv, cat.ammo, { kind: 'rifle', qty: 1, rarity: 2 });
    giveItem(cat.inv, cat.ammo, { kind: 'ammo_rifle', qty: 120, rarity: 0 });
    cat.invDirty = true;
  }

  get bossKinds(): readonly number[] {
    return BOSS_ORDER;
  }

  get minibossCount(): number {
    return MINIBOSSES;
  }

  /** Tipos de armadura por casilla (para mostrar nombres). */
  static readonly slots = ARMOR_SLOTS;
}
