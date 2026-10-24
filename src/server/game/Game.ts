import {
  BOOST,
  DRONE_KINDS,
  EXIT,
  ITEM_KINDS,
  ITEMS,
  MATCH_SECONDS,
  NODE,
  PLAYER,
  SIM_DT,
  STATUS,
  type DroneKind,
  type ItemKind,
} from '../../shared/constants';
import { computeFlowField, flowDirection } from '../../shared/flow';
import {
  droneStats,
  dropChance,
  maxDrones,
  mitigate,
  pickDroneKind,
  pulseDamage,
  rollItem,
  spawnInterval,
  waveAt,
  type DroneStats,
} from '../../shared/formulas';
import { generateMap, isWallAt, randomPointInRoom, type GameMap, type Vec } from '../../shared/map';
import { dist, hasLineOfSight, moveBody, stepPlayer } from '../../shared/physics';
import type { GameEndPayload, InputPayload, PlayerResult } from '../../shared/protocol';
import { createRng, type Rng } from '../../shared/rng';
import type {
  DroneTuple,
  GameEvent,
  PickupTuple,
  PlayerTuple,
  ProjectileTuple,
  Snapshot,
} from '../../shared/types';

export interface GamePlayerInit {
  id: number;
  userId: number;
  name: string;
}

export interface GameOptions {
  seed: number;
  players: GamePlayerInit[];
  matchSeconds?: number;
}

interface PlayerState {
  id: number;
  userId: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  ang: number;
  facing: number;
  alive: boolean;
  forfeited: boolean;
  respawnsLeft: number;
  respawnTimer: number;
  invuln: number;
  boost: number;
  cooldown: number;
  useCooldown: number;
  inventory: (ItemKind | null)[];
  queue: InputPayload[];
  budget: number;
  lastSeq: number;
  connected: boolean;
  offlineFor: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  aliveTime: number;
}

interface Drone {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  hp: number;
  stats: DroneStats;
  stun: number;
  cooldown: number;
  los: boolean;
}

interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  owner: number;
  life: number;
  radius: number;
}

interface Pickup {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  life: number;
}

const MAX_QUEUE = 12;
const MAX_PROJECTILES = 220;
const MAX_PICKUPS = 12;
const MAX_EVENTS = 160;
const OFFLINE_FORFEIT_S = 30;
const AUTO_AIM_RANGE = 380;
const GRACE_SECONDS = 10;

const q1 = (v: number): number => Math.round(v * 10) / 10;
const q2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Simulacion autoritativa de una partida. Esta clase no sabe nada de red: recibe inputs ya
 * validados, avanza con step() a paso fijo y produce instantaneas. El cliente nunca decide
 * posicion, dano, inventario ni quien gana.
 */
export class Game {
  readonly map: GameMap;
  readonly seed: number;
  readonly players: PlayerState[];
  readonly matchSeconds: number;
  readonly startedAt = Date.now();

  private readonly rng: Rng;
  private readonly drones: Drone[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly pickups: Pickup[] = [];
  private events: GameEvent[] = [];
  private nextId = 100;
  private flow: Int16Array | null = null;
  private spawnTimer = 0;
  private lastWave = 0;

  tick = 0;
  time = 0;
  weaponLevel = 0;
  nodeProgress: number[];
  nodeOpen: boolean[];
  exitOpen = false;
  syncProgress = 0;
  result: GameEndPayload | null = null;
  private respawnAt: Vec;
  /** Punto que los jugadores estan defendiendo (nodo en apertura o salida): atrae a los drones. */
  private pressureAt: Vec | null = null;

  constructor(options: GameOptions) {
    this.seed = options.seed;
    this.map = generateMap(options.seed);
    this.matchSeconds = options.matchSeconds ?? MATCH_SECONDS;
    this.rng = createRng((options.seed ^ 0x5bd1e995) >>> 0);
    this.nodeProgress = this.map.nodes.map(() => 0);
    this.nodeOpen = this.map.nodes.map(() => false);
    this.respawnAt = this.map.spawn;
    this.spawnTimer = GRACE_SECONDS;
    this.players = options.players.map((init, i) => {
      const a = (i / Math.max(1, options.players.length)) * Math.PI * 2;
      return {
        id: init.id,
        userId: init.userId,
        name: init.name,
        x: this.map.spawn.x + Math.cos(a) * 22,
        y: this.map.spawn.y + Math.sin(a) * 22,
        hp: PLAYER.maxHp,
        ang: 0,
        facing: 0,
        alive: true,
        forfeited: false,
        respawnsLeft: PLAYER.respawns,
        respawnTimer: 0,
        invuln: PLAYER.invulnSeconds,
        boost: 0,
        cooldown: 0,
        useCooldown: 0,
        inventory: [null, null, null],
        queue: [],
        budget: 3 * SIM_DT,
        lastSeq: 0,
        connected: true,
        offlineFor: 0,
        kills: 0,
        deaths: 0,
        damageDealt: 0,
        aliveTime: 0,
      };
    });
  }

  get over(): boolean {
    return this.result !== null;
  }

  get wave(): number {
    return waveAt(this.time, this.nodeOpen.filter(Boolean).length);
  }

  private get livingPlayers(): PlayerState[] {
    return this.players.filter((p) => p.alive);
  }

  private id(): number {
    return this.nextId++;
  }

  private emit(event: GameEvent): void {
    if (this.events.length < MAX_EVENTS) this.events.push(event);
  }

  // ---------------------------------------------------------------- entradas de los jugadores

  pushInput(playerId: number, input: InputPayload): void {
    const p = this.players.find((pl) => pl.id === playerId);
    if (!p || this.over) return;
    if (!p.alive) {
      p.lastSeq = Math.max(p.lastSeq, input.seq);
      return;
    }
    p.queue.push(input);
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  setConnected(playerId: number, connected: boolean): void {
    const p = this.players.find((pl) => pl.id === playerId);
    if (!p) return;
    p.connected = connected;
    if (connected) p.offlineFor = 0;
  }

  useItem(playerId: number, slot: number): boolean {
    const p = this.players.find((pl) => pl.id === playerId);
    if (!p || !p.alive || this.over || p.useCooldown > 0) return false;
    const item = p.inventory[slot];
    if (!item) return false;
    p.inventory[slot] = null;
    p.useCooldown = 0.25;
    const itemIdx = ITEM_KINDS.indexOf(item);
    if (item === 'patch') {
      p.hp = Math.min(PLAYER.maxHp, p.hp + ITEMS.patchHeal);
    } else if (item === 'overclock') {
      p.boost = BOOST.seconds;
    } else {
      for (const d of [...this.drones]) {
        if (dist(p.x, p.y, d.x, d.y) <= ITEMS.empRadius) {
          d.stun = ITEMS.empStun;
          this.damageDrone(d, ITEMS.empDamage, p.id);
        }
      }
    }
    this.emit({ e: 'use', x: q1(p.x), y: q1(p.y), it: itemIdx, by: p.id });
    return true;
  }

  // ---------------------------------------------------------------- avance de la simulacion

  step(): void {
    if (this.over) return;
    const dt = SIM_DT;
    this.tick++;
    this.time += dt;

    this.pressureAt = null;
    this.stepPlayers(dt);
    this.updateNodes(dt);
    this.updateSync(dt);
    this.spawnDirector(dt);
    if (this.tick % 4 === 0) this.updateFlow();
    this.updateDrones(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);

    const wave = this.wave;
    if (wave !== this.lastWave) {
      this.lastWave = wave;
      this.emit({ e: 'wave', w: wave });
    }
    this.checkEnd();
  }

  private stepPlayers(dt: number): void {
    for (const p of this.players) {
      if (!p.connected && !p.forfeited) {
        p.offlineFor += dt;
        if (p.offlineFor >= OFFLINE_FORFEIT_S) this.forfeit(p);
      }
      if (!p.alive) {
        p.queue.length = 0;
        if (p.respawnTimer > 0) {
          p.respawnTimer -= dt;
          if (p.respawnTimer <= 0) this.respawn(p);
        }
        continue;
      }
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.invuln = Math.max(0, p.invuln - dt);
      p.boost = Math.max(0, p.boost - dt);
      p.useCooldown = Math.max(0, p.useCooldown - dt);
      p.aliveTime += dt;

      // Presupuesto de movimiento: como maximo un paso por tick (con 5 % de holgura para el
      // reloj del cliente) y rafagas de hasta 5 pasos. Mas rapido que eso no se avanza, sea cual
      // sea la cantidad de inputs que mande el cliente.
      p.budget = Math.min(p.budget + dt * 1.05, 5 * dt);
      while (p.queue.length > 0 && p.budget >= dt - 1e-9) {
        const input = p.queue.shift() as InputPayload;
        p.budget -= dt;
        this.applyInput(p, input, dt);
      }
    }
  }

  private applyInput(p: PlayerState, input: InputPayload, dt: number): void {
    p.lastSeq = input.seq;
    stepPlayer(this.map, p, { mx: input.mx, my: input.my }, dt, p.boost > 0 ? BOOST.speedMul : 1);
    if (Math.hypot(input.mx, input.my) > 0.1) p.facing = Math.atan2(input.my, input.mx);

    let aim = input.aim;
    if (input.auto) {
      const target = this.nearestDrone(p, AUTO_AIM_RANGE);
      aim = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.facing;
    }
    p.ang = aim;
    if (input.fire && p.cooldown <= 0) this.fire(p, aim);
  }

  private fire(p: PlayerState, aim: number): void {
    if (this.projectiles.length >= MAX_PROJECTILES) return;
    p.cooldown = PLAYER.fireCooldown;
    const cos = Math.cos(aim);
    const sin = Math.sin(aim);
    this.projectiles.push({
      id: this.id(),
      x: p.x + cos * 12,
      y: p.y + sin * 12,
      vx: cos * PLAYER.projectileSpeed,
      vy: sin * PLAYER.projectileSpeed,
      damage: pulseDamage(this.weaponLevel),
      owner: p.id,
      life: PLAYER.projectileLife,
      radius: PLAYER.projectileRadius,
    });
    this.emit({ e: 'shot', x: q1(p.x), y: q1(p.y), a: q2(aim), by: p.id });
  }

  private nearestDrone(from: Vec, range: number): Drone | null {
    let best: Drone | null = null;
    let bestD = range;
    for (const d of this.drones) {
      const dd = dist(from.x, from.y, d.x, d.y);
      if (dd < bestD && hasLineOfSight(this.map, from.x, from.y, d.x, d.y)) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  private nearestPlayer(x: number, y: number): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const dd = dist(x, y, p.x, p.y);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- vida y muerte

  private damagePlayer(p: PlayerState, amount: number): void {
    if (!p.alive || p.invuln > 0) return;
    p.hp -= amount;
    this.emit({ e: 'hit', x: q1(p.x), y: q1(p.y), v: Math.round(amount), on: 'p' });
    if (p.hp <= 0) this.killPlayer(p);
  }

  private killPlayer(p: PlayerState): void {
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.boost = 0;
    this.emit({ e: 'death', id: p.id, x: q1(p.x), y: q1(p.y) });
    if (p.respawnsLeft > 0) {
      p.respawnsLeft--;
      p.respawnTimer = PLAYER.respawnDelay;
    } else {
      p.respawnTimer = 0;
    }
  }

  private forfeit(p: PlayerState): void {
    p.forfeited = true;
    if (p.alive) {
      p.alive = false;
      p.deaths++;
    }
    p.respawnsLeft = 0;
    p.respawnTimer = 0;
    p.connected = false;
  }

  private respawn(p: PlayerState): void {
    p.alive = true;
    p.hp = Math.round(PLAYER.maxHp * 0.6);
    p.x = this.respawnAt.x + this.rng.range(-14, 14);
    p.y = this.respawnAt.y + this.rng.range(-14, 14);
    p.invuln = PLAYER.invulnSeconds;
    p.budget = 3 * SIM_DT;
    // Pulso de reinicio: aturde a los drones cercanos para que no te esperen en el punto de aparicion.
    for (const d of this.drones) {
      if (dist(p.x, p.y, d.x, d.y) <= 220) d.stun = Math.max(d.stun, 3);
    }
    this.emit({ e: 'use', x: q1(p.x), y: q1(p.y), it: ITEM_KINDS.indexOf('emp'), by: p.id });
    this.emit({ e: 'respawn', id: p.id, x: q1(p.x), y: q1(p.y) });
  }

  private damageDrone(d: Drone, raw: number, by: number): void {
    const dealt = mitigate(raw, d.stats.armor);
    d.hp -= dealt;
    const owner = this.players.find((p) => p.id === by);
    if (owner) owner.damageDealt += Math.min(dealt, Math.max(0, d.hp + dealt));
    this.emit({ e: 'hit', x: q1(d.x), y: q1(d.y), v: Math.round(dealt), on: 'd' });
    if (d.hp > 0) return;
    const idx = this.drones.indexOf(d);
    if (idx >= 0) this.drones.splice(idx, 1);
    if (owner) owner.kills++;
    this.emit({
      e: 'kill',
      x: q1(d.x),
      y: q1(d.y),
      k: DRONE_KINDS.indexOf(d.kind),
      by,
    });
    if (this.rng.chance(dropChance(d.kind))) this.dropItem(d.x, d.y);
  }

  private dropItem(x: number, y: number): void {
    if (this.pickups.length >= MAX_PICKUPS) this.pickups.shift();
    this.pickups.push({
      id: this.id(),
      kind: rollItem(this.rng.next()),
      x,
      y,
      life: ITEMS.lifetime,
    });
  }

  // ---------------------------------------------------------------- objetivos

  private updateNodes(dt: number): void {
    const living = this.livingPlayers;
    this.map.nodes.forEach((node, i) => {
      if (this.nodeOpen[i]) return;
      const inside = living.filter((p) => dist(p.x, p.y, node.x, node.y) <= NODE.radius).length;
      const progress = this.nodeProgress[i] as number;
      const contested = this.drones.some(
        (d) => d.stun <= 0 && dist(d.x, d.y, node.x, node.y) <= NODE.radius + 55,
      );
      if (inside > 0) {
        this.pressureAt = node;
        // Con drones encima el nodo esta disputado: la captura se frena hasta despejarlos.
        if (!contested) {
          const rate = 1 + 0.5 * (inside - 1);
          this.nodeProgress[i] = Math.min(1, progress + (dt / NODE.captureSeconds) * rate);
        }
      } else {
        this.nodeProgress[i] = Math.max(0, progress - dt / NODE.decaySeconds);
      }
      if ((this.nodeProgress[i] as number) >= 1) this.breach(i);
    });
  }

  private breach(index: number): void {
    this.nodeOpen[index] = true;
    this.weaponLevel++;
    this.respawnAt = this.map.nodes[index] as Vec;
    this.emit({ e: 'node', i: index });
    for (const p of this.livingPlayers) p.hp = Math.min(PLAYER.maxHp, p.hp + NODE.healOnBreach);
    const opened = this.nodeOpen.filter(Boolean).length;
    for (let i = 0; i < 2 + opened; i++) {
      const at = this.pickSpawnPoint();
      if (at) this.spawnDrone(pickDroneKind(this.wave, this.rng.next()), at);
    }
    if (opened >= NODE.count && !this.exitOpen) {
      this.exitOpen = true;
      this.emit({ e: 'exit' });
      for (let i = 0; i < 6; i++) {
        const at = this.pickSpawnPoint(this.map.exit);
        if (at) this.spawnDrone(pickDroneKind(this.wave, this.rng.next()), at);
      }
    }
  }

  private updateSync(dt: number): void {
    if (!this.exitOpen) return;
    const living = this.livingPlayers;
    const allIn =
      living.length > 0 &&
      living.every((p) => dist(p.x, p.y, this.map.exit.x, this.map.exit.y) <= EXIT.radius);
    if (living.some((p) => dist(p.x, p.y, this.map.exit.x, this.map.exit.y) <= EXIT.radius + 40)) {
      this.pressureAt = this.map.exit;
    }
    const exitContested = this.drones.some(
      (d) => d.stun <= 0 && dist(d.x, d.y, this.map.exit.x, this.map.exit.y) <= EXIT.radius + 50,
    );
    if (!allIn) this.syncProgress = Math.max(0, this.syncProgress - dt / 1.5);
    else if (!exitContested) {
      this.syncProgress = Math.min(1, this.syncProgress + dt / EXIT.syncSeconds);
    }
  }

  // ---------------------------------------------------------------- drones

  private spawnDrone(kind: DroneKind, at: Vec): void {
    const stats = droneStats(kind, this.wave, this.players.length);
    this.drones.push({
      id: this.id(),
      kind,
      x: at.x,
      y: at.y,
      hp: stats.hp,
      stats,
      stun: 0,
      cooldown: 0.8,
      los: false,
    });
  }

  private pickSpawnPoint(near: Vec | null = null): Vec | null {
    const living = this.livingPlayers;
    if (living.length === 0) return null;
    let best: Vec | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const room = this.rng.int(0, this.map.rooms.length - 1);
      const point = randomPointInRoom(this.map, room, this.rng.next);
      const nearest = Math.min(...living.map((p) => dist(p.x, p.y, point.x, point.y)));
      if (nearest < (near ? 230 : 280)) continue;
      // Con un punto bajo defensa, los drones nacen a unos 400 px de el para converger rapido.
      const score = near ? -Math.abs(dist(near.x, near.y, point.x, point.y) - 420) : nearest;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best;
  }

  private spawnDirector(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const wave = this.wave;
    const count = this.players.length;
    const pressured = this.pressureAt !== null;
    const pace = spawnInterval(wave, count) * this.rng.range(0.8, 1.25);
    this.spawnTimer = pressured ? pace * 0.4 : this.exitOpen ? pace * 0.7 : pace;
    if (this.drones.length >= maxDrones(wave, count) + (pressured ? 6 : 0)) return;
    const at = this.pickSpawnPoint(this.pressureAt);
    if (at) this.spawnDrone(pickDroneKind(wave, this.rng.next()), at);
  }

  private updateFlow(): void {
    const sources = this.livingPlayers.map((p) => ({ x: p.x, y: p.y }));
    if (sources.length > 0) this.flow = computeFlowField(this.map, sources);
  }

  private updateDrones(dt: number): void {
    for (const d of this.drones) {
      if (d.stun > 0) {
        d.stun -= dt;
        continue;
      }
      d.cooldown = Math.max(0, d.cooldown - dt);
      const target = this.nearestPlayer(d.x, d.y);
      if (!target) continue;
      const dd = dist(d.x, d.y, target.x, target.y);
      if ((this.tick + d.id) % 3 === 0) {
        d.los = hasLineOfSight(this.map, d.x, d.y, target.x, target.y);
      }

      let dir: Vec | null = null;
      const toward = { x: (target.x - d.x) / (dd || 1), y: (target.y - d.y) / (dd || 1) };
      const follow = (): Vec | null =>
        d.los && dd < 300
          ? toward
          : this.flow
            ? flowDirection(this.map, this.flow, d.x, d.y)
            : null;

      if (d.kind === 'spitter') {
        if (dd < 150) dir = { x: -toward.x, y: -toward.y };
        else if (dd > 260 || !d.los) dir = follow();
      } else {
        dir = follow();
      }
      if (dir) {
        const next = moveBody(
          this.map,
          d.x,
          d.y,
          dir.x * d.stats.speed * dt,
          dir.y * d.stats.speed * dt,
          d.stats.radius,
        );
        d.x = next.x;
        d.y = next.y;
      }

      if (d.kind === 'spitter') {
        if (d.los && dd < 340 && d.cooldown <= 0 && this.projectiles.length < MAX_PROJECTILES) {
          d.cooldown = d.stats.fireInterval;
          this.projectiles.push({
            id: this.id(),
            x: d.x,
            y: d.y,
            vx: toward.x * 250,
            vy: toward.y * 250,
            damage: d.stats.damage,
            owner: 0,
            life: 1.8,
            radius: 5,
          });
        }
      } else if (dd < d.stats.radius + PLAYER.radius + 3 && d.cooldown <= 0) {
        d.cooldown = d.kind === 'brute' ? 1.3 : 0.9;
        this.damagePlayer(target, d.stats.damage);
      }
    }
    this.separateDrones();
  }

  private separateDrones(): void {
    const list = this.drones;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Drone;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Drone;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.stats.radius + b.stats.radius;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        const pa = moveBody(this.map, a.x, a.y, -nx * push, -ny * push, a.stats.radius);
        const pb = moveBody(this.map, b.x, b.y, nx * push, ny * push, b.stats.radius);
        a.x = pa.x;
        a.y = pa.y;
        b.x = pb.x;
        b.y = pb.y;
      }
    }
  }

  // ---------------------------------------------------------------- proyectiles y objetos

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pj = this.projectiles[i] as Projectile;
      let dead = false;
      for (let s = 0; s < 2 && !dead; s++) {
        pj.x += (pj.vx * dt) / 2;
        pj.y += (pj.vy * dt) / 2;
        if (isWallAt(this.map, pj.x, pj.y)) {
          dead = true;
        } else if (pj.owner !== 0) {
          for (const d of this.drones) {
            if (dist(pj.x, pj.y, d.x, d.y) <= d.stats.radius + pj.radius) {
              this.damageDrone(d, pj.damage, pj.owner);
              dead = true;
              break;
            }
          }
        } else {
          for (const p of this.players) {
            if (p.alive && dist(pj.x, pj.y, p.x, p.y) <= PLAYER.radius + pj.radius) {
              this.damagePlayer(p, pj.damage);
              dead = true;
              break;
            }
          }
        }
      }
      pj.life -= dt;
      if (dead || pj.life <= 0) this.projectiles.splice(i, 1);
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i] as Pickup;
      pk.life -= dt;
      let taken = false;
      for (const p of this.players) {
        if (!p.alive || dist(p.x, p.y, pk.x, pk.y) > ITEMS.pickupRadius) continue;
        const slot = p.inventory.indexOf(null);
        if (slot < 0) continue;
        p.inventory[slot] = pk.kind;
        this.emit({
          e: 'pickup',
          x: q1(pk.x),
          y: q1(pk.y),
          it: ITEM_KINDS.indexOf(pk.kind),
          by: p.id,
        });
        taken = true;
        break;
      }
      if (taken || pk.life <= 0) this.pickups.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- final de la partida

  private checkEnd(): void {
    if (this.syncProgress >= 1) return this.finish('win', 'sync');
    if (this.time >= this.matchSeconds) return this.finish('loss', 'timeout');
    const anyHope = this.players.some((p) => p.alive || p.respawnTimer > 0);
    if (!anyHope) this.finish('loss', 'wipe');
  }

  private finish(result: 'win' | 'loss', reason: GameEndPayload['reason']): void {
    const players: PlayerResult[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      damageDealt: Math.round(p.damageDealt),
      survivalS: Math.round(p.aliveTime * 10) / 10,
      survived: p.alive,
    }));
    this.result = {
      result,
      reason,
      durationS: Math.round(this.time * 10) / 10,
      wave: this.wave,
      players,
    };
  }

  // ---------------------------------------------------------------- instantanea

  snapshot(): Snapshot {
    const events = this.events;
    this.events = [];

    const pl: PlayerTuple[] = this.players.map((p) => {
      let status = 0;
      if (!p.alive) status |= STATUS.dead;
      if (p.boost > 0) status |= STATUS.boosted;
      if (p.invuln > 0) status |= STATUS.invuln;
      if (!p.connected) status |= STATUS.disconnected;
      return [
        p.id,
        q1(p.x),
        q1(p.y),
        Math.max(0, Math.round(p.hp)),
        q2(p.ang),
        status,
        p.respawnsLeft,
        Math.round(Math.max(0, p.respawnTimer) * 10),
      ];
    });
    const dr: DroneTuple[] = this.drones.map((d) => [
      d.id,
      DRONE_KINDS.indexOf(d.kind),
      q1(d.x),
      q1(d.y),
      Math.max(1, Math.round((d.hp / d.stats.hp) * 100)),
      d.stun > 0 ? 1 : 0,
    ]);
    const pj: ProjectileTuple[] = this.projectiles.map((p) => [p.id, q1(p.x), q1(p.y), p.owner]);
    const pk: PickupTuple[] = this.pickups.map((p) => [
      p.id,
      ITEM_KINDS.indexOf(p.kind),
      q1(p.x),
      q1(p.y),
    ]);

    const ack: Record<number, number> = {};
    const inv: Record<number, number[]> = {};
    for (const p of this.players) {
      ack[p.id] = p.lastSeq;
      inv[p.id] = p.inventory.map((it) => (it ? ITEM_KINDS.indexOf(it) : -1));
    }

    return {
      t: Math.round(this.time * 1000),
      tick: this.tick,
      ack,
      pl,
      dr,
      pj,
      pk,
      nd: this.nodeProgress.map((v, i) => [Math.round(v * 100), this.nodeOpen[i] ? 1 : 0]),
      ex: [this.exitOpen ? 1 : 0, Math.round(this.syncProgress * 100)],
      inv,
      clock: Math.max(0, q1(this.matchSeconds - this.time)),
      wave: this.wave,
      wl: this.weaponLevel,
      ev: events,
    };
  }

  /** Posicion de un jugador, util para pruebas y para reconectar. */
  playerState(playerId: number): { x: number; y: number; hp: number; alive: boolean } | null {
    const p = this.players.find((pl) => pl.id === playerId);
    return p ? { x: p.x, y: p.y, hp: p.hp, alive: p.alive } : null;
  }

  inventoryOf(playerId: number): (ItemKind | null)[] {
    return this.players.find((pl) => pl.id === playerId)?.inventory ?? [];
  }

  /** Solo para pruebas: coloca un objeto en el inventario de un jugador. */
  grantItem(playerId: number, item: ItemKind): void {
    const p = this.players.find((pl) => pl.id === playerId);
    const slot = p?.inventory.indexOf(null) ?? -1;
    if (p && slot >= 0) p.inventory[slot] = item;
  }
}
