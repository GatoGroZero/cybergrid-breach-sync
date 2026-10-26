import { CAT, INTEREST_RADIUS, TICK_DT, TILE } from '../../shared/br/constants';
import { DASH } from '../../shared/br/adventure';
import { GATE_SOLID } from '../../shared/br/mapadv';
import { SnapshotBuffer } from '../../shared/interp';
import {
  AMMO_KINDS,
  CLAWS,
  ITEM_KINDS,
  WEAPONS,
  isWeapon,
  type AmmoKind,
  type Item,
} from '../../shared/br/items';
import { generateMap, type BRMap, type MapKind } from '../../shared/br/map';
import type { GameMode } from '../../shared/br/modes';
import { aimTouchesTarget, stepCat } from '../../shared/br/physics';
import { STAMINA, fullStamina, stepStamina, type StaminaState } from '../../shared/br/stamina';
import type {
  CatInfo,
  DiedPayload,
  GameEndPayload,
  GameStartPayload,
  InputPayload,
  LootContents,
  WinPayload,
} from '../../shared/br/protocol';
import type {
  AdvState,
  BREvent,
  BRSnapshot,
  ContainerTuple,
  HazardTuple,
  MeState,
  PickupTuple,
  PvpState,
  ZoneView,
} from '../../shared/br/types';
import { FixedStepper } from '../../shared/timing';
import type { Sfx } from '../audio';
import type { Net } from '../net';
import { introFocus } from './bossinfo';
import { nearSign, signSpot, type Spot } from './cartel';
import type { InputController } from './input';

export interface CatView {
  id: number;
  x: number;
  y: number;
  /** Apuntado en radianes (el buffer lo interpola como `ang`). */
  ang: number;
  flags: number;
  running: boolean;
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

/** Un enemigo ya interpretado de la instantanea. */
export interface MobView {
  id: number;
  x: number;
  y: number;
  kind: number;
  /** Vida en porcentaje (1 a 100). */
  hp: number;
  /** Banderas de MOB_FLAG. */
  flags: number;
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
  run: boolean;
  /** Aventura: velocidad extra de reliquias y pociones, y la voltereta si estaba en curso. */
  extra: number;
  dash: { dx: number; dy: number } | null;
}

const INTERP_DELAY_MS = 90;
/** Multiplicador de velocidad durante la voltereta (igual que en el servidor). */
const DASH_MUL = DASH.distance / DASH.seconds / CAT.speed;
const DEG = Math.PI / 180;

export class ClientBR {
  readonly map: BRMap;
  readonly mapKind: MapKind;
  readonly seed: number;
  /** Modo de la partida (Battle Royale si el servidor no dice otra cosa). */
  readonly mode: GameMode;
  /** Gatos por equipo en los modos por equipos (0 si no hay equipos). */
  readonly teamSize: number;
  /** Estado de la ronda en los modos por equipos. */
  pvp: PvpState | null = null;
  private lastPvpPhase: PvpState['phase'] | null = null;
  private lastPvpTick = -1;
  /** El rotulo del cartel grande ("A JUGAR", "A PELEAR"...). */
  splashText = '';
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
  /** Balas de cada arma (orden de AMMO_KINDS): no ocupan los 5 espacios. */
  ammo: number[] = [0, 0, 0, 0, 0];
  /** Aire para correr: se predice igual que en el servidor. */
  stamina: StaminaState = fullStamina();
  running = false;
  zone: ZoneView | null = null;
  boxes: ContainerTuple[] = [];

  private readonly catBuf = new SnapshotBuffer<CatView>();
  private readonly shotBuf = new SnapshotBuffer<ShotView>();
  private readonly mobBuf = new SnapshotBuffer<MobView>();
  /** Aventura: zonas de peligro, botin del suelo y estado del grupo (de la ultima instantanea). */
  hazards: HazardTuple[] = [];
  pickups: PickupTuple[] = [];
  adv: AdvState | null = null;
  /** Salas cuyas puertas de enredadera estan cerradas, y desde cuando esta activa cada una. */
  private readonly gateClosed = new Set<number>();
  private readonly roomSince = new Map<number, number>();
  /** Voltereta predicha: segundos que le quedan, direccion y segundos hasta poder repetirla. */
  private dashLeft = 0;
  private dashDx = 0;
  private dashDy = 0;
  private dashCool = 0;
  private readonly eventQueue: { t: number; ev: BREvent }[] = [];
  private serverOffset = 0;
  private haveOffset = false;
  private readonly knownWalls = new Map<number, { tx: number; ty: number }>();
  private lastZonePhase = 0;
  /** Segundos que faltan de la cuenta regresiva inicial (todos quietos). */
  intro = 0;
  private lastIntroSecond = -1;
  /** Cartel grande de "A jugar" que sale al terminar la cuenta regresiva. */
  splash: { at: number } | null = null;
  /** El servidor congela el mundo al terminar: no se manda ni se predice movimiento. */
  private inputFrozen = false;

  result: GameEndPayload | null = null;
  /** Quien gano, apenas termina la partida (antes de la tabla de resultados): inicia la celebracion. */
  win: WinPayload | null = null;
  winAt = 0;
  died: DiedPayload | null = null;
  loot: LootContents | null = null;
  banner: Banner | null = null;
  /** Emote que tiene cada gato sobre la cabeza: clase (0 a 4) y cuando salio. */
  readonly emotes = new Map<number, { k: number; at: number }>();
  private lastEmoteAt = 0;
  feed: { text: string; until: number }[] = [];
  snapshotsPerSecond = 0;
  private snapCount = 0;
  private snapWindowStart = performance.now();
  hurtFlash = 0;
  healPulse = 0;

  /** Aventura: la esencia de esta partida ya se sumo a la bolsa (para no contarla dos veces). */
  essenceBanked = false;
  /** Aventura: cartel grande al entrar a una sala o superarla. */
  advBanner: { title: string; sub: string; at: number; tone: 'info' | 'good' | 'bad' } | null =
    null;
  /** Aventura: presentacion del jefe en curso (todos quietos y la camara lo enfoca). */
  bossIntro: { kind: number; x: number; y: number; at: number; left: number } | null = null;
  private lastAdvRoom = -1;
  private lastAdvStates: number[] = [];
  private lastAdvChoice = false;

  /** Aventura: un enemigo acaba de disparar (tipo de bala y lugar). */
  onHostile: (kind: number, x: number, y: number) => void = () => undefined;
  private hostileSeen = new Set<number>();

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
    this.seed = start.seed;
    this.mode = start.mode ?? 'br';
    this.teamSize = start.teamSize ?? 0;
    this.map = generateMap(this.mapKind, start.seed);
    input.dashEnabled = this.mode === 'aventura';
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
    this.trackIntro(snap.intro ?? 0);
    this.trackPvp(snap.pvp ?? null);
    this.zone = snap.zone;
    this.boxes = snap.boxes;
    if (snap.inv) {
      this.inv = snap.inv;
      if (snap.ammo) this.ammo = snap.ammo;
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
        running: (t[3] & 64) !== 0,
      });
    }
    this.catBuf.push(snap.t, cats);
    const shots = new Map<number, ShotView>();
    for (const t of snap.shots)
      shots.set(t[0], { id: t[0], x: t[1], y: t[2], kind: t[3], ang: t[4] * DEG });
    this.shotBuf.push(snap.t, shots);

    if (this.mode === 'aventura') {
      const mobs = new Map<number, MobView>();
      for (const t of snap.mobs ?? [])
        mobs.set(t[0], {
          id: t[0],
          x: t[1],
          y: t[2],
          kind: t[3],
          hp: t[4],
          flags: t[5],
          ang: t[6] * DEG,
        });
      this.mobBuf.push(snap.t, mobs);
      const fresh = new Set<number>();
      let played = 0;
      for (const t of snap.shots) {
        if (t[3] < 64) continue;
        fresh.add(t[0]);
        if (!this.hostileSeen.has(t[0]) && played < 3) {
          played++;
          this.onHostile(t[3], t[1], t[2]);
        }
      }
      this.hostileSeen = fresh;
      this.hazards = snap.haz ?? [];
      this.pickups = snap.pk ?? [];
      this.adv = snap.adv ?? null;
      if (snap.adv) this.trackAdv(snap.adv);
      this.syncGates(snap.adv ?? null);
      if (snap.me.dash !== undefined)
        this.dashCool = Math.max(0, snap.me.dash - this.pending.length * TICK_DT);
    }
    this.syncWalls(snap);
    for (const ev of snap.ev) this.eventQueue.push({ t: snap.t, ev });
    for (const f of snap.feed ?? []) {
      const text = f.m ?? (f.k ? `${f.k} eliminó a ${f.v}` : `${f.v} cayó a la ola`);
      this.feed.push({ text, until: now + 6000 });
      if (this.feed.length > 5) this.feed.shift();
    }

    if (snap.zone.phase !== this.lastZonePhase) {
      this.lastZonePhase = snap.zone.phase;
    }
    if (snap.me.alive) this.reconcile(snap.me.x, snap.me.y, snap.ack, snap.me);
    else {
      this.x = snap.me.x;
      this.y = snap.me.y;
    }
  }

  /** Aventura: carteles al cambiar de sala y sonidos de sala superada y de reliquia nueva. */
  private trackAdv(adv: AdvState): void {
    const now = performance.now();
    const intro = adv.intro;
    if (intro) {
      if (!this.bossIntro) this.sfx.bossSting();
      this.bossIntro = {
        kind: intro.kind,
        x: intro.x,
        y: intro.y,
        at: this.bossIntro?.at ?? now,
        left: intro.left,
      };
    } else this.bossIntro = null;
    // la musica sube de tono cuando hay un jefe peleando
    const bossFight =
      (adv.roomKind === 'minijefe' || adv.roomKind === 'jefe') && adv.states[adv.room] === 1;
    this.sfx.setMusic(bossFight ? 'jefe' : 'aventura');
    if (adv.room !== this.lastAdvRoom) {
      const first = this.lastAdvRoom < 0;
      this.lastAdvRoom = adv.room;
      if (!first && adv.roomKind !== 'inicio') {
        const boss = adv.roomKind === 'minijefe' || adv.roomKind === 'jefe';
        this.advBanner = {
          title:
            adv.roomKind === 'jefe'
              ? 'EL JEFE FINAL'
              : boss
                ? 'GUARIDA DE MINIJEFE'
                : adv.roomKind === 'tesoro'
                  ? 'SALA DEL TESORO'
                  : adv.roomKind === 'descanso'
                    ? 'LUGAR DE DESCANSO'
                    : `SALA ${adv.room + 1}`,
          sub: adv.roomName,
          at: now,
          tone: boss ? 'bad' : 'info',
        };
      }
    }
    adv.states.forEach((st, i) => {
      const before = this.lastAdvStates[i];
      if (before === 1 && st === 2) {
        this.sfx.roomClear();
        if (i === adv.room)
          this.advBanner = {
            title: 'SALA SUPERADA',
            sub: adv.roomKind === 'combate' ? 'Recoge lo que dejaron y sigue adelante' : '',
            at: now,
            tone: 'good',
          };
      }
    });
    this.lastAdvStates = adv.states.slice();
    const choosing = adv.choice !== null;
    if (choosing && !this.lastAdvChoice) this.sfx.offer();
    this.lastAdvChoice = choosing;
  }

  /** Aventura: las puertas de enredadera se cierran con la pelea y se abren al ganarla. */
  private syncGates(adv: AdvState | null): void {
    if (!adv) return;
    const now = performance.now();
    adv.states.forEach((state, i) => {
      if (state === 1) {
        const since = this.roomSince.get(i) ?? now;
        this.roomSince.set(i, since);
        // por si se perdio el aviso de cierre: pasado un rato de pelea, la puerta ya esta cerrada
        if (!this.gateClosed.has(i) && now - since > 2600) this.setGates(i, true);
      } else {
        this.roomSince.delete(i);
        if (this.gateClosed.has(i)) this.setGates(i, false);
      }
    });
  }

  private setGates(room: number, closed: boolean): void {
    const def = this.map.rooms?.[room];
    if (!def) return;
    for (const g of def.gates) this.map.solid[g.y * this.map.w + g.x] = closed ? GATE_SOLID : 0;
    if (closed) this.gateClosed.add(room);
    else this.gateClosed.delete(room);
  }

  /** Puertas cerradas ahora mismo (para dibujarlas). */
  get closedRooms(): ReadonlySet<number> {
    return this.gateClosed;
  }

  /** Aventura: elige una de las habilidades que dejo un jefe (0 a 2). */
  sendPower(i: number): void {
    if (!this.net.connected || !this.adv?.pchoice || i < 0 || i >= this.adv.pchoice.length) return;
    this.net.socket.emit('game:power', { i });
    this.sfx.click();
  }

  /** Aventura: elige una de las reliquias ofrecidas (0 a 2). */
  sendRelic(i: number): void {
    if (!this.net.connected || !this.adv?.choice || i < 0 || i >= this.adv.choice.length) return;
    this.net.socket.emit('game:relic', { i });
    this.sfx.click();
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

  /** La partida termino: el mundo se congela y empieza la celebracion del ganador. */
  onWin(payload: WinPayload): void {
    if (payload.adv) {
      // Aventura: se gana o se pierde todo el grupo a la vez
      this.inputFrozen = true;
      if (payload.adv === 'victory') {
        this.win = payload;
        this.winAt = performance.now();
        this.say('¡EL BOSQUE ESTÁ A SALVO!', 'good', 4000);
        this.sfx.win();
      } else {
        this.say('El bosque los venció', 'bad', 3200);
        this.sfx.lose();
      }
      return;
    }
    this.win = payload;
    this.winAt = performance.now();
    this.inputFrozen = true;
    if (payload.winnerId === this.you) {
      this.say('¡VICTORIA REAL!', 'good', 4000);
      this.sfx.win();
    } else if (payload.winnerName) {
      this.say(`¡Ganó ${payload.winnerName}!`, 'info', 4000);
    }
  }

  onEnd(payload: GameEndPayload): void {
    this.result = payload;
    if (payload.winnerId === this.you) this.sfx.win();
    else if (!this.died) this.sfx.lose();
  }

  // ---------------------------------------------------------------- prediccion

  private reconcile(sx: number, sy: number, ack: number, me: MeState): void {
    const beforeX = this.x;
    const beforeY = this.y;
    while (this.pending.length > 0 && (this.pending[0] as Pending).seq <= ack) this.pending.shift();
    const motion = { x: sx, y: sy };
    // Se repiten los inputs que el servidor todavia no confirmo, con su estamina incluida.
    const st: StaminaState = { value: me.stamina, tired: me.tired };
    for (const p of this.pending) {
      if (p.dash) {
        stepCat(this.map, motion, { mx: p.dash.dx, my: p.dash.dy }, TICK_DT, DASH_MUL);
        continue;
      }
      const running = stepStamina(st, p.run, Math.min(1, Math.hypot(p.mx, p.my)), TICK_DT);
      stepCat(
        this.map,
        motion,
        { mx: p.mx, my: p.my },
        TICK_DT,
        (running ? STAMINA.runMultiplier : 1) * p.extra,
      );
    }
    this.stamina = st;
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
    if (this.result || this.inputFrozen || !this.net.connected) return;
    const sample = this.input.sample(this);
    if (!this.alive) {
      this.stepDX = this.stepDY = 0;
      return;
    }
    // Durante la cuenta regresiva del inicio todos estan quietos y sin disparar.
    const frozen = this.frozen;
    if (frozen) {
      sample.mx = 0;
      sample.my = 0;
      sample.fire = false;
      sample.hold = false;
      sample.run = false;
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
      hold: sample.hold,
      run: sample.run,
      ...(sample.dash && this.mode === 'aventura' ? { dash: true } : {}),
      ...(sample.power > 0 && this.mode === 'aventura' ? { pw: sample.power } : {}),
    };
    const before = { x: this.x, y: this.y };
    const motion = { x: this.x, y: this.y };
    // Aventura: la voltereta y la velocidad de reliquias y pociones se predicen como el servidor
    let dash: Pending['dash'] = null;
    let extra = 1;
    if (this.mode === 'aventura') {
      this.dashCool = Math.max(0, this.dashCool - TICK_DT);
      if (sample.dash && this.dashLeft <= 0 && this.dashCool <= 0) {
        const len = Math.hypot(mx, my);
        this.dashDx = len > 0.1 ? mx / len : Math.cos(sample.aim);
        this.dashDy = len > 0.1 ? my / len : Math.sin(sample.aim);
        this.dashLeft = DASH.seconds;
        this.dashCool = DASH.cooldown;
      }
      if (this.dashLeft > 0) {
        this.dashLeft -= TICK_DT;
        dash = { dx: this.dashDx, dy: this.dashDy };
      } else extra = this.me?.spd ?? 1;
    }
    if (dash) {
      this.running = false;
      stepCat(this.map, motion, { mx: dash.dx, my: dash.dy }, TICK_DT, DASH_MUL);
    } else {
      this.running = stepStamina(
        this.stamina,
        sample.run,
        Math.min(1, Math.hypot(mx, my)),
        TICK_DT,
      );
      stepCat(
        this.map,
        motion,
        { mx, my },
        TICK_DT,
        (this.running ? STAMINA.runMultiplier : 1) * extra,
      );
    }
    this.prevX = before.x;
    this.prevY = before.y;
    this.x = motion.x;
    this.y = motion.y;
    this.stepDX = this.x - before.x;
    this.stepDY = this.y - before.y;
    this.moving = Math.hypot(this.stepDX, this.stepDY) > 0.05;
    this.pending.push({ seq: payload.seq, mx, my, run: sample.run, extra, dash });
    if (this.pending.length > 90) this.pending.shift();
    this.net.socket.emit('game:input', payload);
  }

  // ---------------------------------------------------------------- vista del mundo

  sampleWorld(): {
    cats: Map<number, CatView>;
    shots: Map<number, ShotView>;
    mobs: Map<number, MobView>;
  } {
    const t = this.renderTime;
    return {
      cats: this.catBuf.sample(t, 70),
      shots: this.shotBuf.sample(t, 25),
      mobs: this.mode === 'aventura' ? this.mobBuf.sample(t, 70) : new Map(),
    };
  }

  /** Posicion a la que apunta la camara: el gato propio o a quien se esta viendo si ya caiste. */
  cameraTarget(cats: Map<number, CatView>): { x: number; y: number } {
    const base = this.baseCameraTarget(cats);
    const view = this.introView(performance.now());
    if (!view || !this.bossIntro) return base;
    // durante la presentacion la camara va hacia el jefe y regresa antes de pelear
    const k = view.focus;
    return {
      x: base.x + (this.bossIntro.x - base.x) * k,
      y: base.y + (this.bossIntro.y - base.y) * k,
    };
  }

  private baseCameraTarget(cats: Map<number, CatView>): { x: number; y: number } {
    if (this.alive) return { x: this.drawX, y: this.drawY };
    const spec = this.latest?.spectating;
    const target = spec !== undefined ? cats.get(spec) : undefined;
    return target ? { x: target.x, y: target.y } : { x: this.x, y: this.y };
  }

  /** Aventura: donde esta el cartel del tutorial (en el claro de inicio), o null en otros modos. */
  get signAt(): Spot | null {
    const start = this.mode === 'aventura' ? this.map.rooms?.[0] : undefined;
    return start ? signSpot(start) : null;
  }

  /** Estas lo bastante cerca del cartel como para accionarlo. */
  get nearTutorial(): boolean {
    return this.alive && nearSign(this.signAt, this.x, this.y);
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

  /** Todos quietos: cuenta regresiva del inicio, o fases de eleccion y pausa de una ronda. */
  get frozen(): boolean {
    return (
      this.intro > 0 || this.bossIntro !== null || (this.pvp !== null && this.pvp.phase !== 'fight')
    );
  }

  /** Cuanto esta enfocado el jefe en su presentacion (0 si no hay) y cuantos segundos van. */
  introView(now: number): { focus: number; elapsed: number; left: number } | null {
    const bi = this.bossIntro;
    if (!bi) return null;
    const elapsed = (now - bi.at) / 1000;
    return { focus: introFocus(elapsed, bi.left), elapsed, left: bi.left };
  }

  /** Equipo de un gato (0 o 1) o -1 si no juega por equipos. */
  teamOf(id: number): number {
    return this.cats.get(id)?.team ?? -1;
  }

  /** Elige el kit de la ronda (solo se acepta mientras dura la eleccion). */
  sendKit(kit: string): void {
    if (!this.net.connected || this.pvp?.phase !== 'pick') return;
    this.net.socket.emit('game:kit', { kit });
    this.sfx.click();
  }

  /** Sonidos y carteles al cambiar de fase en las partidas por rondas. */
  private trackPvp(pvp: PvpState | null): void {
    const prev = this.lastPvpPhase;
    this.pvp = pvp;
    if (!pvp) return;
    this.lastPvpPhase = pvp.phase;
    if (pvp.phase === 'ready' && pvp.left > 0 && pvp.left !== this.lastPvpTick) {
      this.lastPvpTick = pvp.left;
      this.sfx.introTick(Math.min(5, pvp.left));
    }
    if (pvp.phase !== prev) {
      if (pvp.phase === 'pick') this.sfx.node();
      if (pvp.phase === 'fight' && prev === 'ready') {
        this.splash = { at: performance.now() };
        this.splashText = '¡A PELEAR!';
        this.sfx.introGo();
      }
      if (pvp.phase === 'between' || pvp.phase === 'over') {
        const mine = pvp.roundWinner === pvp.team;
        if (pvp.roundWinner !== null && pvp.roundWinner >= 0) {
          if (mine) this.sfx.win();
          else this.sfx.lose();
        }
      }
      this.lastPvpTick = -1;
    }
  }

  /** Cuenta regresiva del inicio: un tic por segundo y, al llegar a 0, el cartel de a jugar. */
  private trackIntro(left: number): void {
    const before = this.intro;
    this.intro = left;
    if (left > 0) {
      const sec = Math.ceil(left - 0.001);
      if (sec !== this.lastIntroSecond) {
        this.lastIntroSecond = sec;
        this.sfx.introTick(sec);
      }
    } else if (before > 0) {
      this.splash = { at: performance.now() };
      this.sfx.introGo();
    }
  }

  /** Lo que hace el objeto en mano al usarlo: curar, beber una pocion, poner un muro, o nada. */
  get useKind(): 'heal' | 'potion' | 'wall' | null {
    const k = this.selectedItem?.kind;
    if (k === 'medkit' || k === 'shield') return 'heal';
    if (k === 'potion_catnip' || k === 'potion_valerian') return 'potion';
    if (k === 'wall') return 'wall';
    return null;
  }

  /**
   * Usa el objeto en mano con un toque (segundo toque a su casilla, boton USAR o tecla E). Si no
   * sirve en este momento lo dice: asi nunca parece que el objeto "no se deja usar".
   */
  useSelected(): boolean {
    if (!this.alive || !this.me || this.frozen) return false;
    const kind = this.selectedItem?.kind;
    const max = this.me.maxHp ?? CAT.maxHp;
    const maxShield = this.me.maxShield ?? CAT.maxShield;
    if (kind === 'medkit' && this.me.hp >= max) {
      this.say('Ya tienes la vida llena', 'info', 1400);
      return false;
    }
    if (kind === 'shield' && this.me.shield >= maxShield) {
      this.say('Tu escudo ya está lleno', 'info', 1400);
      return false;
    }
    if (this.me.healLeft > 0 && (kind === 'medkit' || kind === 'shield')) return false;
    if (this.useKind === null) return false;
    this.input.requestUse();
    return true;
  }

  /** Pide recargar el arma en mano (tecla R o boton). */
  sendReload(): void {
    if (!this.alive || !this.net.connected || this.frozen) return;
    this.net.socket.emit('game:reload');
  }

  /**
   * Dice si la linea de mira, disparada hacia `angle`, toca algo a lo que vale la pena disparar:
   * un gato (que no sea tu) o un muro colocado, antes de chocar con cualquier otra cosa.
   * Sirve para el modo "solo con objetivo" de la mira en el movil.
   */
  aimLocked(angle: number): boolean {
    const item = this.selectedItem;
    const range = item && isWeapon(item.kind) ? WEAPONS[item.kind].range : CLAWS.range + 8;
    const { cats, mobs } = this.sampleWorld();
    // en la Aventura se apunta a los enemigos; en los demas modos, a los otros gatos
    const others =
      this.mode === 'aventura'
        ? [...mobs.values()]
        : [...cats.values()].filter((c) => c.id !== this.you && (c.flags & 1) === 0);
    return aimTouchesTarget(this.map, this.x, this.y, angle, range, others);
  }

  /** Manda un emote (con un respiro de 1.5 s entre uno y otro, igual que el servidor). */
  /** Cuando mande mi ultimo emote (para atenuar la barra mientras se espera). */
  get lastEmoteTime(): number {
    return this.lastEmoteAt;
  }

  sendEmote(kind: number): void {
    const now = performance.now();
    if (!this.alive || !this.net.connected || now - this.lastEmoteAt < 1500) return;
    this.lastEmoteAt = now;
    this.net.socket.emit('game:emote', { k: kind });
  }

  say(text: string, tone: Banner['tone'] = 'info', ms = 1800): void {
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
        // Cada paso de la ola avisa: empieza a cerrar, se queda quieta, ultima ola, colapso.
        let text = '';
        if (ev.phase === 1)
          text = ev.shrinking
            ? '¡LA OLA SE CIERRA! Corre al círculo'
            : 'En 20 segundos se cerrará la segunda ola';
        else if (ev.phase === 2) text = '¡La segunda ola se cierra!';
        else if (ev.phase === 3) text = '¡ÚLTIMA OLA CERRÁNDOSE!';
        else if (ev.phase === 4) text = '¡La ola lo cubre todo!';
        if (text) this.say(text, 'bad', ev.phase === 3 ? 2400 : 2000);
        break;
      }
      case 'emote':
        this.emotes.set(ev.id, { k: ev.k, at: performance.now() });
        break;
      case 'gate': {
        const i = this.map.rooms?.findIndex((r) =>
          r.gates.some((g) => g.x * TILE === ev.x && g.y * TILE === ev.y),
        );
        if (i !== undefined && i >= 0) this.setGates(i, !ev.open);
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
    if (res.ok) this.sfx.pickup();
    this.loot = res.ok ? (res.data ?? null) : null;
    this.onLootChanged();
  }

  async lootTakeAll(): Promise<void> {
    if (!this.loot) return;
    const res = await this.net.ack<LootContents | null>('loot:takeAll', { id: this.loot.id });
    if (res.ok) this.sfx.pickup();
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
    this.sfx.drop();
    this.net.socket.emit('inv:drop', { slot });
  }

  dropAmmo(kind: AmmoKind, qty?: number): void {
    this.sfx.drop();
    this.net.socket.emit('ammo:drop', { kind, qty });
  }

  ammoOf(kind: AmmoKind): number {
    return this.ammo[AMMO_KINDS.indexOf(kind)] ?? 0;
  }

  spectate(dir: 1 | -1): void {
    this.net.socket.emit('spectate:next', { dir });
  }

  heldKindName(code: number): string | null {
    return code >= 0 ? (ITEM_KINDS[Math.floor(code / 3)] ?? null) : null;
  }
}
