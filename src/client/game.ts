import { DRONE_KINDS, ITEMS, ITEM_KINDS, PLAYER, SIM_DT, STATUS } from '../shared/constants';
import { SnapshotBuffer } from '../shared/interp';
import { generateMap, type GameMap } from '../shared/map';
import { stepPlayer } from '../shared/physics';
import type {
  GameEndPayload,
  GamePlayerInfo,
  GameStartPayload,
  InputPayload,
} from '../shared/protocol';
import { FixedStepper } from '../shared/timing';
import type { GameEvent, NodeTuple, PickupTuple, Snapshot } from '../shared/types';
import type { Sfx } from './audio';
import { Fx } from './fx';
import type { Input } from './input';
import type { Net } from './net';

export interface PlayerView {
  id: number;
  x: number;
  y: number;
  ang: number;
  hp: number;
  status: number;
  lives: number;
  respawnIn: number;
}

export interface DroneView {
  id: number;
  x: number;
  y: number;
  kind: number;
  hp: number;
  stun: number;
  ang?: number;
}

export interface ProjView {
  id: number;
  x: number;
  y: number;
  owner: number;
}

interface Pending {
  seq: number;
  mx: number;
  my: number;
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
  cssW: number;
  cssH: number;
}

const INTERP_DELAY_MS = 100;
const PLAYER_COLORS = ['#19f2ff', '#ff2bd6', '#ffb020', '#3dff8b'];
export const colorOf = (id: number): string =>
  PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length] as string;

/** Estado del cliente durante una partida: prediccion propia, interpolacion de los demas y efectos. */
export class ClientGame {
  readonly map: GameMap;
  readonly you: number;
  readonly names = new Map<number, string>();
  readonly fx = new Fx();
  readonly camera: Camera = { x: 0, y: 0, scale: 1, cssW: 960, cssH: 540 };

  // Posicion predicha del jugador local.
  x: number;
  y: number;
  private prevX: number;
  private prevY: number;
  private stepDX = 0;
  private stepDY = 0;
  offsetX = 0;
  offsetY = 0;
  facing = 0;
  aimAngle = 0;
  private seq = 0;
  private readonly pending: Pending[] = [];

  private readonly stepper = new FixedStepper(SIM_DT);
  private readonly playersBuf = new SnapshotBuffer<PlayerView>();
  private readonly dronesBuf = new SnapshotBuffer<DroneView>();
  private readonly projBuf = new SnapshotBuffer<ProjView>();
  private readonly eventQueue: { t: number; ev: GameEvent }[] = [];
  private serverOffset = 0;
  private haveOffset = false;

  latest: Snapshot | null = null;
  result: GameEndPayload | null = null;
  banner: { text: string; until: number; tone: 'good' | 'bad' | 'info' } | null = null;
  snapshotsPerSecond = 0;
  private snapCount = 0;
  private snapWindowStart = performance.now();

  constructor(
    start: GameStartPayload,
    private readonly net: Net,
    readonly input: Input,
    private readonly sfx: Sfx,
  ) {
    this.map = generateMap(start.seed);
    this.you = start.you;
    start.players.forEach((p: GamePlayerInfo) => this.names.set(p.id, p.name));
    this.x = this.prevX = this.map.spawn.x;
    this.y = this.prevY = this.map.spawn.y;
  }

  get alpha(): number {
    return this.stepper.alpha;
  }

  get connected(): boolean {
    return this.net.connected;
  }

  get serverNow(): number {
    return performance.now() + this.serverOffset;
  }

  get renderTime(): number {
    return this.serverNow - INTERP_DELAY_MS;
  }

  get me(): PlayerView | null {
    return this.latest?.pl.find((p) => p[0] === this.you) ? this.selfView() : null;
  }

  private selfTuple(): Snapshot['pl'][number] | undefined {
    return this.latest?.pl.find((p) => p[0] === this.you);
  }

  private selfView(): PlayerView | null {
    const t = this.selfTuple();
    if (!t) return null;
    return {
      id: this.you,
      x: this.x,
      y: this.y,
      ang: t[4],
      hp: t[3],
      status: t[5],
      lives: t[6],
      respawnIn: t[7] / 10,
    };
  }

  get dead(): boolean {
    return ((this.selfTuple()?.[5] ?? 0) & STATUS.dead) !== 0;
  }

  get speedMul(): number {
    return ((this.selfTuple()?.[5] ?? 0) & STATUS.boosted) !== 0 ? 1.35 : 1;
  }

  /** Posicion de dibujo del jugador local: interpolada entre pasos mas la correccion suave. */
  get drawX(): number {
    return this.prevX + (this.x - this.prevX) * this.alpha + this.offsetX;
  }

  get drawY(): number {
    return this.prevY + (this.y - this.prevY) * this.alpha + this.offsetY;
  }

  // ---------------------------------------------------------------- red

  onSnapshot(snap: Snapshot): void {
    const now = performance.now();
    const off = snap.t - now;
    if (!this.haveOffset) {
      this.serverOffset = off;
      this.haveOffset = true;
    } else {
      // Se confia mas en los paquetes que llegaron antes: tienen menos retraso de red.
      this.serverOffset += (off - this.serverOffset) * (off > this.serverOffset ? 0.25 : 0.01);
    }
    this.latest = snap;

    this.snapCount++;
    if (now - this.snapWindowStart >= 1000) {
      this.snapshotsPerSecond = this.snapCount;
      this.snapCount = 0;
      this.snapWindowStart = now;
    }

    const players = new Map<number, PlayerView>();
    for (const t of snap.pl) {
      players.set(t[0], {
        id: t[0],
        x: t[1],
        y: t[2],
        hp: t[3],
        ang: t[4],
        status: t[5],
        lives: t[6],
        respawnIn: t[7] / 10,
      });
    }
    this.playersBuf.push(snap.t, players);
    const drones = new Map<number, DroneView>();
    for (const t of snap.dr) {
      drones.set(t[0], { id: t[0], kind: t[1], x: t[2], y: t[3], hp: t[4], stun: t[5] });
    }
    this.dronesBuf.push(snap.t, drones);
    const projectiles = new Map<number, ProjView>();
    for (const t of snap.pj) projectiles.set(t[0], { id: t[0], x: t[1], y: t[2], owner: t[3] });
    this.projBuf.push(snap.t, projectiles);

    for (const ev of snap.ev) this.eventQueue.push({ t: snap.t, ev });

    const mine = snap.pl.find((p) => p[0] === this.you);
    if (mine) this.reconcile(mine[1], mine[2], snap.ack[this.you] ?? 0);
  }

  onEnd(result: GameEndPayload): void {
    this.result = result;
    if (result.result === 'win') this.sfx.win();
    else this.sfx.lose();
  }

  // ---------------------------------------------------------------- prediccion

  private reconcile(sx: number, sy: number, ack: number): void {
    const beforeX = this.x;
    const beforeY = this.y;
    while (this.pending.length > 0 && (this.pending[0] as Pending).seq <= ack) this.pending.shift();

    const motion = { x: sx, y: sy };
    for (const p of this.pending) {
      stepPlayer(this.map, motion, { mx: p.mx, my: p.my }, SIM_DT, this.speedMul);
    }
    this.x = motion.x;
    this.y = motion.y;
    this.prevX = this.x - this.stepDX;
    this.prevY = this.y - this.stepDY;

    const ex = beforeX - this.x;
    const ey = beforeY - this.y;
    const err = Math.hypot(ex, ey);
    if (err > 140) {
      this.offsetX = 0;
      this.offsetY = 0;
    } else if (err > 0.4) {
      this.offsetX += ex;
      this.offsetY += ey;
    }
  }

  /** Avanza la simulacion local con delta time real y envia los inputs a 30 Hz. */
  update(dt: number): void {
    const steps = this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) this.fixedStep();

    const decay = Math.exp(-14 * dt);
    this.offsetX *= decay;
    this.offsetY *= decay;
    if (Math.abs(this.offsetX) < 0.01) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.01) this.offsetY = 0;

    const use = this.input.takeUse();
    if (use !== null && this.net.connected && !this.result) {
      this.net.socket.emit('game:use', { slot: use });
    }
  }

  private fixedStep(): void {
    if (this.result || !this.net.connected) return;
    const sample = this.input.sample();
    if (this.dead) {
      this.stepDX = this.stepDY = 0;
      return;
    }
    if (Math.hypot(sample.mx, sample.my) > 0.1) this.facing = Math.atan2(sample.my, sample.mx);

    let aim = this.facing;
    if (!sample.auto && this.input.mouse) {
      const cam = this.camera;
      const wx = cam.x + (this.input.mouse.x - cam.cssW / 2) / cam.scale;
      const wy = cam.y + (this.input.mouse.y - cam.cssH / 2) / cam.scale;
      aim = Math.atan2(wy - this.y, wx - this.x);
    }

    this.aimAngle = aim;
    const payload: InputPayload = {
      seq: ++this.seq,
      mx: Math.round(sample.mx * 100) / 100,
      my: Math.round(sample.my * 100) / 100,
      aim: Math.round(aim * 100) / 100,
      auto: sample.auto,
      fire: sample.fire,
    };
    const before = { x: this.x, y: this.y };
    const motion = { x: this.x, y: this.y };
    stepPlayer(this.map, motion, { mx: payload.mx, my: payload.my }, SIM_DT, this.speedMul);
    this.prevX = before.x;
    this.prevY = before.y;
    this.x = motion.x;
    this.y = motion.y;
    this.stepDX = this.x - before.x;
    this.stepDY = this.y - before.y;
    this.pending.push({ seq: payload.seq, mx: payload.mx, my: payload.my });
    if (this.pending.length > 90) this.pending.shift();
    this.net.socket.emit('game:input', payload);
  }

  // ---------------------------------------------------------------- vista del mundo

  sampleWorld(): {
    players: Map<number, PlayerView>;
    drones: Map<number, DroneView>;
    projectiles: Map<number, ProjView>;
  } {
    const t = this.renderTime;
    return {
      players: this.playersBuf.sample(t),
      drones: this.dronesBuf.sample(t, 60),
      projectiles: this.projBuf.sample(t, 30),
    };
  }

  /** Dispara los efectos de los eventos cuyo momento ya llego en el tiempo de dibujo. */
  processEvents(): void {
    const t = this.renderTime;
    while (this.eventQueue.length > 0 && (this.eventQueue[0] as { t: number }).t <= t) {
      this.handleEvent((this.eventQueue.shift() as { ev: GameEvent }).ev);
    }
    if (this.eventQueue.length > 400) this.eventQueue.splice(0, this.eventQueue.length - 400);
  }

  private say(text: string, tone: 'good' | 'bad' | 'info'): void {
    this.banner = { text, until: performance.now() + 2600, tone };
  }

  private handleEvent(ev: GameEvent): void {
    const fx = this.fx;
    switch (ev.e) {
      case 'shot':
        this.sfx.shot();
        fx.burst(
          ev.x + Math.cos(ev.a) * 14,
          ev.y + Math.sin(ev.a) * 14,
          colorOf(ev.by),
          3,
          90,
          0.18,
        );
        break;
      case 'hit':
        if (ev.on === 'd') {
          fx.burst(ev.x, ev.y, '#ffffff', 4, 120, 0.25);
          fx.text(ev.x, ev.y - 10, String(ev.v), '#e8faff');
          this.sfx.hit();
        } else {
          fx.burst(ev.x, ev.y, '#ff3b5c', 7, 150, 0.35);
          fx.text(ev.x, ev.y - 14, `-${ev.v}`, '#ff6a85');
          if (Math.hypot(ev.x - this.x, ev.y - this.y) < 28) {
            fx.hurtFlash = 1;
            fx.addShake(5);
            this.sfx.hurt();
          }
        }
        break;
      case 'kill': {
        const colors = ['#ff3b5c', '#c85bff', '#ff9d2e'];
        fx.burst(ev.x, ev.y, colors[ev.k] ?? '#ff3b5c', 16, 230, 0.6);
        fx.ring(ev.x, ev.y, 34, colors[ev.k] ?? '#ff3b5c');
        this.sfx.kill();
        break;
      }
      case 'pickup':
        fx.burst(ev.x, ev.y, '#3dff8b', 10, 110, 0.45);
        if (ev.by === this.you) {
          this.sfx.pickup();
          fx.text(ev.x, ev.y - 12, ITEM_LABEL[ev.it] ?? '', '#3dff8b');
        }
        break;
      case 'use':
        if (ITEM_KINDS[ev.it] === 'emp') {
          fx.ring(ev.x, ev.y, ITEMS.empRadius, '#4da3ff');
          fx.addShake(4);
        } else if (ITEM_KINDS[ev.it] === 'overclock') {
          fx.ring(ev.x, ev.y, 46, '#ffb020');
        } else {
          fx.ring(ev.x, ev.y, 40, '#3dff8b');
        }
        this.sfx.use();
        break;
      case 'node': {
        const node = this.map.nodes[ev.i];
        if (node) {
          fx.ring(node.x, node.y, 140, '#3dff8b');
          fx.burst(node.x, node.y, '#3dff8b', 36, 260, 0.9);
        }
        fx.addShake(7);
        this.sfx.node();
        this.say(`Nodo ${ev.i + 1} abierto`, 'good');
        break;
      }
      case 'exit':
        this.say('Salida abierta: sincronicen en la salida', 'info');
        break;
      case 'death':
        fx.burst(ev.x, ev.y, colorOf(ev.id), 26, 240, 0.8);
        fx.ring(ev.x, ev.y, 60, '#ff3b5c');
        if (ev.id === this.you) {
          this.sfx.death();
          fx.addShake(10);
          this.say('Sistema caído, reiniciando', 'bad');
        }
        break;
      case 'respawn':
        fx.ring(ev.x, ev.y, 70, colorOf(ev.id));
        fx.burst(ev.x, ev.y, colorOf(ev.id), 18, 160, 0.6);
        if (ev.id === this.you) this.sfx.respawn();
        break;
      case 'wave':
        if (ev.w > 0) this.say(`Oleada ${ev.w}`, 'info');
        break;
    }
  }

  // ---------------------------------------------------------------- consultas para el dibujo

  get nodes(): NodeTuple[] {
    return this.latest?.nd ?? [];
  }

  get pickups(): PickupTuple[] {
    return this.latest?.pk ?? [];
  }

  get inventory(): number[] {
    return this.latest?.inv[this.you] ?? [-1, -1, -1];
  }

  droneKindName(kind: number): string {
    return DRONE_KINDS[kind] ?? 'crawler';
  }

  get maxHp(): number {
    return PLAYER.maxHp;
  }
}

export const ITEM_LABEL: Record<number, string> = {
  0: 'Parche',
  1: 'Overclock',
  2: 'EMP',
};
