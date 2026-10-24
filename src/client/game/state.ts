import { CAT, INTEREST_RADIUS, TICK_DT, TILE } from '../../shared/br/constants';
import { SnapshotBuffer } from '../../shared/interp';
import { ITEM_KINDS, type Item } from '../../shared/br/items';
import { generateMap, type BRMap, type MapKind } from '../../shared/br/map';
import { stepCat } from '../../shared/br/physics';
import type {
  CatInfo,
  DiedPayload,
  GameEndPayload,
  GameStartPayload,
  InputPayload,
  LootContents,
} from '../../shared/br/protocol';
import type { BREvent, BRSnapshot, ContainerTuple, MeState, ZoneView } from '../../shared/br/types';
import { FixedStepper } from '../../shared/timing';
import type { Sfx } from '../audio';
import type { Net } from '../net';
import type { InputController } from './input';

export interface CatView {
  id: number;
  x: number;
  y: number;
  /** Apuntado en radianes (el buffer lo interpola como `ang`). */
  ang: number;
  flags: number;
  /** Objeto en mano: indice de ITEM_KINDS * 3 + rareza, o -1. */
  held: number;
  moving: boolean;
}

export interface ShotView {
  id: number;
  x: number;
  y: number;
  kind: number;
  ang: number;
}

export interface Banner {
  text: string;
  until: number;
  tone: 'info' | 'good' | 'bad';
}

interface Pending {
  seq: number;
  mx: number;
  my: number;
}

const INTERP_DELAY_MS = 90;
const DEG = Math.PI / 180;

export class ClientBR {
  readonly map: BRMap;
  readonly mapKind: MapKind;
  readonly you: number;
  readonly cats = new Map<number, CatInfo>();

  // Posicion predicha del gato local.
  x: number;
  y: number;
  private prevX: number;
  private prevY: number;
  private stepDX = 0;
  private stepDY = 0;
  offsetX = 0;
  offsetY = 0;
  /** 1 mira a la derecha, -1 a la izquierda. */
  facing: 1 | -1 = 1;
  aim = 0;
  moving = false;
  private seq = 0;
  private readonly pending: Pending[] = [];
  private readonly stepper = new FixedStepper(TICK_DT);

  latest: BRSnapshot | null = null;
  me: MeState | null = null;
  inv: (Item | null)[] = [null, null, null, null, null];
  zone: ZoneView | null = null;
  boxes: ContainerTuple[] = [];

  private readonly catBuf = new SnapshotBuffer<CatView>();
  private readonly shotBuf = new SnapshotBuffer<ShotView>();
  private readonly eventQueue: { t: number; ev: BREvent }[] = [];
  private serverOffset = 0;
  private haveOffset = false;
  private readonly knownWalls = new Map<number, { tx: number; ty: number }>();
  private lastZonePhase = 0;

  result: GameEndPayload | null = null;
  died: DiedPayload | null = null;
  loot: LootContents | null = null;
  banner: Banner | null = null;
  feed: { text: string; until: number }[] = [];
  snapshotsPerSecond = 0;
  private snapCount = 0;
  private snapWindowStart = performance.now();
  hurtFlash = 0;
  healPulse = 0;

  /** El renderizador se suscribe para recibir los eventos cuando les toca verse. */
  onEvent: (ev: BREvent) => void = () => undefined;
  onInventory: () => void = () => undefined;
  onLootChanged: () => void = () => undefined;

  constructor(
    start: GameStartPayload,
    private readonly net: Net,
    readonly input: InputController,
    private readonly sfx: Sfx,
  ) {
    this.mapKind = start.map as MapKind;
    this.map = generateMap(this.mapKind, start.seed);
    this.you = start.you;
    start.cats.forEach((c) => this.cats.set(c.id, c));
    const spawn = this.map.spawns[0] ?? { x: 100, y: 100 };
    this.x = this.prevX = spawn.x;
    this.y = this.prevY = spawn.y;
  }

  get alpha(): number {
    return this.stepper.alpha;
  }

  get alive(): boolean {
    return this.me?.alive ?? true;
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

  get drawX(): number {
    return this.prevX + (this.x - this.prevX) * this.alpha + this.offsetX;
  }

  get drawY(): number {
    return this.prevY + (this.y - this.prevY) * this.alpha + this.offsetY;
  }

  get selectedItem(): Item | null {
    return this.inv[this.me?.sel ?? 0] ?? null;
  }

  // ---------------------------------------------------------------- red

  onSnapshot(snap: BRSnapshot): void {
    const now = performance.now();
    const off = snap.t - now;
    if (!this.haveOffset) {
      this.serverOffset = off;
      this.haveOffset = true;
    } else {
      this.serverOffset += (off - this.serverOffset) * (off > this.serverOffset ? 0.25 : 0.01);
    }
    this.latest = snap;
    this.me = snap.me;
    this.zone = snap.zone;
    this.boxes = snap.boxes;
    if (snap.inv) {
      this.inv = snap.inv;
      this.onInventory();
    }

    this.snapCount++;
    if (now - this.snapWindowStart >= 1000) {
      this.snapshotsPerSecond = this.snapCount;
      this.snapCount = 0;
      this.snapWindowStart = now;
    }

    const cats = new Map<number, CatView>();
    for (const t of snap.cats) {
      cats.set(t[0], {
        id: t[0],
        x: t[1],
        y: t[2],
        flags: t[3],
        ang: t[4] * DEG,
        held: t[5],
        moving: (t[3] & 4) !== 0,
      });
    }
    this.catBuf.push(snap.t, cats);
    const shots = new Map<number, ShotView>();
    for (const t of snap.shots)
      shots.set(t[0], { id: t[0], x: t[1], y: t[2], kind: t[3], ang: t[4] * DEG });
    this.shotBuf.push(snap.t, shots);

    this.syncWalls(snap);
    for (const ev of snap.ev) this.eventQueue.push({ t: snap.t, ev });
    for (const f of snap.feed ?? []) {
      const text = f.k ? `${f.k} eliminó a ${f.v}` : `${f.v} cayó a la ola`;
      this.feed.push({ text, until: now + 6000 });
      if (this.feed.length > 5) this.feed.shift();
    }

    if (snap.zone.phase !== this.lastZonePhase) {
      this.lastZonePhase = snap.zone.phase;
    }
    if (snap.me.alive) this.reconcile(snap.me.x, snap.me.y, snap.ack);
    else {
      this.x = snap.me.x;
      this.y = snap.me.y;
    }
  }

  /** Los muros colocados viven en la cuadricula de colisiones: se sincronizan con lo que se ve cerca. */
  private syncWalls(snap: BRSnapshot): void {
    const fx = snap.me.x;
    const fy = snap.me.y;
    const seen = new Set<number>();
    for (const [id, tx, ty] of snap.walls) {
      seen.add(id);
      if (!this.knownWalls.has(id)) {
        this.knownWalls.set(id, { tx, ty });
        this.map.solid[ty * this.map.w + tx] = 2;
      }
    }
    for (const [id, w] of [...this.knownWalls]) {
      if (seen.has(id)) continue;
      const inside =
        Math.abs(w.tx * TILE - fx) < INTEREST_RADIUS &&
        Math.abs(w.ty * TILE - fy) < INTEREST_RADIUS;
      if (inside) {
        this.knownWalls.delete(id);
        this.map.solid[w.ty * this.map.w + w.tx] = 0;
      }
    }
  }

  onDied(payload: DiedPayload): void {
    this.died = payload;
    this.loot = null;
    this.onLootChanged();
  }

  onEnd(payload: GameEndPayload): void {
    this.result = payload;
    if (payload.winnerId === this.you) this.sfx.win();
    else if (!this.died) this.sfx.lose();
  }

  // ---------------------------------------------------------------- prediccion

  private reconcile(sx: number, sy: number, ack: number): void {
    const beforeX = this.x;
    const beforeY = this.y;
    while (this.pending.length > 0 && (this.pending[0] as Pending).seq <= ack) this.pending.shift();
    const motion = { x: sx, y: sy };
    for (const p of this.pending) stepCat(this.map, motion, { mx: p.mx, my: p.my }, TICK_DT);
    this.x = motion.x;
    this.y = motion.y;
    this.prevX = this.x - this.stepDX;
    this.prevY = this.y - this.stepDY;
    const ex = beforeX - this.x;
    const ey = beforeY - this.y;
    const err = Math.hypot(ex, ey);
    if (err > 60) {
      this.offsetX = 0;
      this.offsetY = 0;
    } else if (err > 0.3) {
      this.offsetX += ex;
      this.offsetY += ey;
    }
  }

  /** Avanza con delta time real: pasos fijos de 30 Hz para la simulacion y envio de inputs. */
  update(dt: number): void {
    const steps = this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) this.fixedStep();
    const decay = Math.exp(-16 * dt);
    this.offsetX *= decay;
    this.offsetY *= decay;
    if (Math.abs(this.offsetX) < 0.02) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.02) this.offsetY = 0;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.4);
    this.healPulse = Math.max(0, this.healPulse - dt * 2);
  }

  private fixedStep(): void {
    if (this.result || !this.net.connected) return;
    const sample = this.input.sample(this);
    if (!this.alive) {
      this.stepDX = this.stepDY = 0;
      return;
    }
    const mx = Math.round(sample.mx * 100) / 100;
    const my = Math.round(sample.my * 100) / 100;
    this.aim = sample.aim;
    if (Math.abs(Math.cos(sample.aim)) > 0.15 && (sample.fire || sample.hasAim)) {
      this.facing = Math.cos(sample.aim) >= 0 ? 1 : -1;
    } else if (Math.abs(mx) > 0.2) {
      this.facing = mx > 0 ? 1 : -1;
    }
    const payload: InputPayload = {
      seq: ++this.seq,
      mx,
      my,
      aim: Math.round(sample.aim * 100) / 100,
      fire: sample.fire,
      assist: sample.assist,
    };
    const before = { x: this.x, y: this.y };
    const motion = { x: this.x, y: this.y };
    stepCat(this.map, motion, { mx, my }, TICK_DT);
    this.prevX = before.x;
    this.prevY = before.y;
    this.x = motion.x;
    this.y = motion.y;
    this.stepDX = this.x - before.x;
    this.stepDY = this.y - before.y;
    this.moving = Math.hypot(this.stepDX, this.stepDY) > 0.05;
    this.pending.push({ seq: payload.seq, mx, my });
    if (this.pending.length > 90) this.pending.shift();
    this.net.socket.emit('game:input', payload);
  }

  // ---------------------------------------------------------------- vista del mundo

  sampleWorld(): { cats: Map<number, CatView>; shots: Map<number, ShotView> } {
    const t = this.renderTime;
    return { cats: this.catBuf.sample(t, 70), shots: this.shotBuf.sample(t, 25) };
  }

  /** Posicion a la que apunta la camara: el gato propio o a quien se esta viendo si ya caiste. */
  cameraTarget(cats: Map<number, CatView>): { x: number; y: number } {
    if (this.alive) return { x: this.drawX, y: this.drawY };
    const spec = this.latest?.spectating;
    const target = spec !== undefined ? cats.get(spec) : undefined;
    return target ? { x: target.x, y: target.y } : { x: this.x, y: this.y };
  }

  nearestBox(): ContainerTuple | null {
    if (!this.alive) return null;
    let best: ContainerTuple | null = null;
    let bestD: number = CAT.interactRange;
    for (const b of this.boxes) {
      const d = Math.hypot(b[1] - this.x, b[2] - this.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  processEvents(): void {
    const t = this.renderTime;
    while (this.eventQueue.length > 0 && (this.eventQueue[0] as { t: number }).t <= t) {
      this.handle((this.eventQueue.shift() as { ev: BREvent }).ev);
    }
    if (this.eventQueue.length > 400) this.eventQueue.splice(0, this.eventQueue.length - 400);
  }

  say(text: string, tone: Banner['tone'] = 'info', ms = 2800): void {
    this.banner = { text, until: performance.now() + ms, tone };
  }

  private handle(ev: BREvent): void {
    switch (ev.e) {
      case 'hit': {
        if (Math.hypot(ev.x - this.x, ev.y - this.y) < 12 && this.alive) {
          this.hurtFlash = 1;
          this.input.buzz(30);
        }
        break;
      }
      case 'zone': {
        const labels = [
          '',
          '¡La ola avanza hacia la zona 1!',
          '¡La ola avanza hacia la zona 2!',
          '¡La ola avanza hacia la zona 3!',
          '¡La ola lo cubre todo!',
        ];
        this.say(labels[ev.phase] ?? '', 'bad', 3600);
        break;
      }
      case 'heal':
        if (Math.hypot(ev.x - this.x, ev.y - this.y) < 10) this.healPulse = 1;
        break;
      default:
        break;
    }
    this.onEvent(ev);
  }

  // ---------------------------------------------------------------- acciones del jugador

  select(slot: number): void {
    if (!this.alive || !this.net.connected) return;
    if (this.me && this.me.sel !== slot) {
      this.me = { ...this.me, sel: slot, healLeft: 0, healKind: null };
      this.net.socket.emit('game:select', { slot });
    }
  }

  async interact(): Promise<LootContents | null> {
    if (!this.alive || !this.net.connected) return null;
    const res = await this.net.ack<LootContents | null>('game:interact');
    this.loot = res.ok ? (res.data ?? null) : null;
    this.onLootChanged();
    return this.loot;
  }

  async lootTake(index: number, slot?: number): Promise<void> {
    if (!this.loot) return;
    const res = await this.net.ack<LootContents | null>('loot:take', {
      id: this.loot.id,
      index,
      slot,
    });
    this.loot = res.ok ? (res.data ?? null) : null;
    this.onLootChanged();
  }

  async lootTakeAll(): Promise<void> {
    if (!this.loot) return;
    const res = await this.net.ack<LootContents | null>('loot:takeAll', { id: this.loot.id });
    this.loot = res.ok ? (res.data ?? null) : null;
    this.onLootChanged();
  }

  closeLoot(): void {
    this.loot = null;
    this.onLootChanged();
  }

  moveItem(from: number, to: number): void {
    this.net.socket.emit('inv:move', { from, to });
  }

  dropItem(slot: number): void {
    this.net.socket.emit('inv:drop', { slot });
  }

  spectate(dir: 1 | -1): void {
    this.net.socket.emit('spectate:next', { dir });
  }

  heldKindName(code: number): string | null {
    return code >= 0 ? (ITEM_KINDS[Math.floor(code / 3)] ?? null) : null;
  }
}
