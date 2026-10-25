import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Server, Socket } from 'socket.io';
import { MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, TICK_HZ } from '../shared/br/constants';
import {
  ADVENTURE_MAPS,
  DUEL_MAPS,
  MAP_KINDS,
  TERRITORY_MAPS,
  type MapKind,
} from '../shared/br/map';
import {
  ENABLED_MODES,
  type DuelFormat,
  type GameMode,
  type KitId,
  type TeamId,
  TEAM_NAMES,
} from '../shared/br/modes';
import {
  createRoomSchema,
  dropAmmoSchema,
  dropSchema,
  emoteSchema,
  inputSchema,
  joinRoomSchema,
  kitSchema,
  lootIdSchema,
  lootTakeSchema,
  metaSchema,
  moveItemSchema,
  powerPickSchema,
  readySchema,
  relicSchema,
  roomSettingsSchema,
  selectSchema,
  skinSchema,
  spectateSchema,
  teamSchema,
  type Ack,
  type CatInfo,
  type GameEndPayload,
  type GameStartPayload,
  type LootContents,
  type PublicRoom,
  type RoomPhase,
  type RoomState,
} from '../shared/br/protocol';
import type { AmmoKind } from '../shared/br/items';
import {
  botCountFor,
  humanCapacity,
  startable,
  teamSizeOf,
  type BotsSetting,
  type RoomRules,
} from '../shared/br/rooms';
import { ZONE_TECHO, ZONE_TERRITORIO } from '../shared/br/zone';
import { defaultSkin, isValidSkin, randomSkin, type Skin } from '../shared/br/skin';
import { createRng } from '../shared/rng';
import type { SessionUser } from './auth';
import { BRGame, type CatInit } from './br/Game';
import { clampMeta, type MetaLevels } from '../shared/br/adventure';
import { AdventureGame } from './br/AdventureGame';
import { PvpGame } from './br/PvpGame';
import type { Config } from './config';
import type { Repo } from './db';

interface Member {
  userId: number;
  name: string;
  ready: boolean;
  socketId: string | null;
  catId: number;
  skin: Skin;
  /** Equipo en los modos por equipos. */
  team: TeamId;
}

interface Room {
  code: string;
  name: string;
  isPrivate: boolean;
  map: MapKind | 'azar';
  bots: BotsSetting;
  mode: GameMode;
  format: DuelFormat;
  teamSize: number;
  phase: RoomPhase;
  hostId: number;
  members: Map<number, Member>;
  countdown: number;
  countdownTimer: NodeJS.Timeout | null;
  game: BRGame | null;
  loop: NodeJS.Timeout | null;
  resetTimer: NodeJS.Timeout | null;
  /** Si la partida ya termino: hasta cuando dura la celebracion antes de mostrar resultados. */
  celebrateUntil: number | null;
  persisted: boolean;
}

const MAX_ROOMS = 40;
/** Canal de los sockets que estan mirando la lista de salas publicas. */
const BROWSE = 'salas';
const ROOMS_PUSH_MS = 250;
const RESULTS_SECONDS = 6;
const BOT_NAMES = [
  'Michi',
  'Bigotes',
  'Pelusa',
  'Luna',
  'Tigre',
  'Sombra',
  'Canela',
  'Mini',
  'Nube',
  'Churro',
  'Mochi',
  'Pixel',
  'Byte',
  'Kiwi',
  'Chispa',
  'Ovillo',
  'Garfio',
  'Misu',
  'Tofu',
  'Panda',
];

class Bucket {
  private tokens: number;
  private last = performance.now();
  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = performance.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const fail = (error: string): Ack => ({ ok: false, error });

export class Lobby {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<number, string>();
  private readonly sockets = new Map<number, Socket>();
  /** El pelaje elegido se recuerda mientras el servidor siga vivo. */
  private readonly skins = new Map<number, Skin>();
  /** Mejoras permanentes de la Aventura que trae cada persona (las guarda su navegador). */
  private readonly metas = new Map<number, MetaLevels>();
  /** Ultima lista publica enviada, para avisar solo cuando cambia. */
  private publicSignature = '[]';
  private publicTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly io: Server,
    private readonly repo: Repo,
    private readonly config: Config,
  ) {}

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.members.size;
    return { rooms: this.rooms.size, players };
  }

  shutdown(): void {
    if (this.publicTimer) clearTimeout(this.publicTimer);
    this.publicTimer = null;
    for (const room of this.rooms.values()) this.disposeRoom(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  // ------------------------------------------------------------------ conexiones

  attach(socket: Socket): void {
    const user = socket.data.user as SessionUser;
    const previous = this.sockets.get(user.id);
    if (previous && previous.id !== socket.id) {
      previous.emit('session:replaced');
      previous.disconnect(true);
    }
    this.sockets.set(user.id, socket);
    if (!this.roomOf(user.id)) void socket.join(BROWSE);

    const inputBucket = new Bucket(45, 90);
    const actionBucket = new Bucket(14, 30);
    let strikes = 0;
    const allow = (bucket: Bucket): boolean => {
      if (bucket.take()) return true;
      if (++strikes > 500) socket.disconnect(true);
      return false;
    };
    const me = () => {
      const room = this.roomOf(user.id);
      const member = room?.members.get(user.id);
      return room && member ? { room, member, game: room.game } : null;
    };

    socket.on('rooms:list', (ack?: (a: Ack<PublicRoom[]>) => void) => {
      if (allow(actionBucket)) ack?.({ ok: true, data: this.publicRooms() });
    });
    socket.on('skin:get', (ack?: (a: Ack<Skin>) => void) => {
      ack?.({ ok: true, data: this.skins.get(user.id) ?? defaultSkin() });
    });
    socket.on('skin:set', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = skinSchema.safeParse(raw);
      if (!parsed.success) return ack?.(fail('pelaje_invalido'));
      this.skins.set(user.id, parsed.data);
      const m = me();
      if (m && m.room.phase !== 'playing') {
        m.member.skin = parsed.data;
        this.broadcast(m.room);
      }
      ack?.({ ok: true });
    });
    socket.on('room:create', (raw: unknown, ack?: (a: Ack<{ code: string }>) => void) => {
      if (allow(actionBucket)) ack?.(this.createRoom(user, socket, raw));
    });
    socket.on('room:join', (raw: unknown, ack?: (a: Ack<{ code: string }>) => void) => {
      if (allow(actionBucket)) ack?.(this.joinRoom(user, socket, raw));
    });
    socket.on('room:leave', (ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      this.leaveRoom(user.id, socket);
      ack?.({ ok: true });
    });
    socket.on('room:ready', (raw: unknown, ack?: (a: Ack) => void) => {
      if (allow(actionBucket)) ack?.(this.setReady(user.id, raw));
    });
    socket.on('room:settings', (raw: unknown, ack?: (a: Ack) => void) => {
      if (allow(actionBucket)) ack?.(this.setSettings(user.id, raw));
    });
    socket.on('room:team', (raw: unknown, ack?: (a: Ack) => void) => {
      if (allow(actionBucket)) ack?.(this.setTeam(user.id, raw));
    });
    socket.on('room:start', (ack?: (a: Ack) => void) => {
      if (allow(actionBucket)) ack?.(this.startNow(user.id));
    });

    // ---- partida
    socket.on('game:input', (raw: unknown) => {
      if (!allow(inputBucket)) return;
      const parsed = inputSchema.safeParse(raw);
      const m = me();
      if (parsed.success && m?.game) m.game.pushInput(m.member.catId, parsed.data);
    });
    socket.on('game:reload', () => {
      if (!allow(actionBucket)) return;
      const m = me();
      if (m?.game) m.game.reload(m.member.catId);
    });
    socket.on('game:kit', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = kitSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !(m?.game instanceof PvpGame)) return ack?.(fail('datos_invalidos'));
      // (se evalua antes: sin callback de respuesta igual hay que registrar la eleccion)
      const done = m.game.chooseKit(m.member.catId, parsed.data.kit as KitId);
      ack?.(done ? { ok: true } : fail('fuera_de_tiempo'));
    });
    socket.on('game:relic', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = relicSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !(m?.game instanceof AdventureGame))
        return ack?.(fail('datos_invalidos'));
      const done = m.game.chooseRelic(m.member.catId, parsed.data.i);
      ack?.(done ? { ok: true } : fail('sin_oferta'));
    });
    socket.on('game:power', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = powerPickSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !(m?.game instanceof AdventureGame))
        return ack?.(fail('datos_invalidos'));
      const done = m.game.choosePower(m.member.catId, parsed.data.i);
      ack?.(done ? { ok: true } : fail('sin_oferta'));
    });
    socket.on('room:meta', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = metaSchema.safeParse(raw);
      if (!parsed.success) return ack?.(fail('datos_invalidos'));
      this.metas.set(user.id, clampMeta(parsed.data));
      ack?.({ ok: true });
    });
    socket.on('game:emote', (raw: unknown) => {
      if (!allow(actionBucket)) return;
      const parsed = emoteSchema.safeParse(raw);
      const m = me();
      if (parsed.success && m?.game) m.game.emote(m.member.catId, parsed.data.k);
    });
    socket.on('dev:kit', (kind?: unknown) => {
      const m = me();
      if (this.config.testKit && m?.game) m.game.giveTestKit(m.member.catId, kind === 'heavy');
    });
    socket.on('dev:round', () => {
      const m = me();
      if (!this.config.testKit || !(m?.game instanceof PvpGame)) return;
      const mine = m.game.cat(m.member.catId);
      if (mine) m.game.forceRoundWin(mine.team);
    });
    socket.on('dev:tp', (p?: { x?: unknown; y?: unknown }) => {
      const m = me();
      if (this.config.testKit && m?.game && typeof p?.x === 'number' && typeof p?.y === 'number')
        m.game.debugMove(m.member.catId, p.x, p.y);
    });
    socket.on('dev:die', () => {
      const m = me();
      if (this.config.testKit && m?.game) m.game.debugKill(m.member.catId);
    });
    socket.on('dev:room', (i?: unknown) => {
      const m = me();
      if (this.config.testKit && m?.game instanceof AdventureGame && Number.isInteger(i))
        m.game.debugTeleport(i as number);
    });
    socket.on('dev:boss', () => {
      const m = me();
      if (this.config.testKit && m?.game instanceof AdventureGame) m.game.debugKillBoss();
    });
    socket.on('dev:win', () => {
      const m = me();
      if (this.config.testKit && m?.game instanceof AdventureGame) m.game.debugWin();
    });
    socket.on('dev:arm', () => {
      const m = me();
      if (this.config.testKit && m?.game instanceof AdventureGame) m.game.debugArm(m.member.catId);
    });
    socket.on('dev:finish', () => {
      const m = me();
      if (!this.config.testKit || !m?.game) return;
      const bot = m.game.cats.find((c) => c.bot && c.alive);
      m.game.forceFinish(bot?.id ?? null);
    });
    socket.on('game:select', (raw: unknown) => {
      if (!allow(actionBucket)) return;
      const parsed = selectSchema.safeParse(raw);
      const m = me();
      if (parsed.success && m?.game) m.game.select(m.member.catId, parsed.data.slot);
    });
    socket.on('game:interact', (ack?: (a: Ack<LootContents | null>) => void) => {
      if (!allow(actionBucket)) return;
      const m = me();
      if (!m?.game) return ack?.(fail('sin_partida') as Ack<LootContents | null>);
      ack?.({ ok: true, data: m.game.interact(m.member.catId) });
    });
    socket.on('loot:open', (raw: unknown, ack?: (a: Ack<LootContents | null>) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = lootIdSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !m?.game)
        return ack?.(fail('datos_invalidos') as Ack<LootContents | null>);
      ack?.({ ok: true, data: m.game.contents(m.member.catId, parsed.data.id) });
    });
    socket.on('loot:take', (raw: unknown, ack?: (a: Ack<LootContents | null>) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = lootTakeSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !m?.game)
        return ack?.(fail('datos_invalidos') as Ack<LootContents | null>);
      const { id, index, slot } = parsed.data;
      ack?.({ ok: true, data: m.game.lootTake(m.member.catId, id, index, slot) });
    });
    socket.on('loot:takeAll', (raw: unknown, ack?: (a: Ack<LootContents | null>) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = lootIdSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !m?.game)
        return ack?.(fail('datos_invalidos') as Ack<LootContents | null>);
      ack?.({ ok: true, data: m.game.lootTakeAll(m.member.catId, parsed.data.id) });
    });
    socket.on('inv:move', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = moveItemSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !m?.game) return ack?.(fail('datos_invalidos'));
      m.game.invMove(m.member.catId, parsed.data.from, parsed.data.to);
      ack?.({ ok: true });
    });
    socket.on('inv:drop', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = dropSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !m?.game) return ack?.(fail('datos_invalidos'));
      m.game.invDrop(m.member.catId, parsed.data.slot);
      ack?.({ ok: true });
    });
    socket.on('ammo:drop', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      const parsed = dropAmmoSchema.safeParse(raw);
      const m = me();
      if (!parsed.success || !m?.game) return ack?.(fail('datos_invalidos'));
      m.game.ammoDrop(m.member.catId, parsed.data.kind as AmmoKind, parsed.data.qty);
      ack?.({ ok: true });
    });
    socket.on('spectate:next', (raw: unknown) => {
      if (!allow(actionBucket)) return;
      const parsed = spectateSchema.safeParse(raw);
      const m = me();
      if (parsed.success && m?.game) m.game.spectateNext(m.member.catId, parsed.data.dir);
    });

    socket.on('disconnect', () => this.onDisconnect(user.id, socket));
    this.resume(user.id, socket);
  }

  private onDisconnect(userId: number, socket: Socket): void {
    if (this.sockets.get(userId)?.id !== socket.id) return;
    this.sockets.delete(userId);
    const room = this.roomOf(userId);
    const member = room?.members.get(userId);
    if (!room || !member) return;
    member.socketId = null;
    if (room.phase === 'playing' && room.game) {
      room.game.setConnected(member.catId, false);
      return;
    }
    this.leaveRoom(userId, null);
  }

  /** Si el usuario ya estaba en una sala (recarga o reconexion), lo reengancha. */
  private resume(userId: number, socket: Socket): void {
    const room = this.roomOf(userId);
    const member = room?.members.get(userId);
    if (!room || !member) return;
    member.socketId = socket.id;
    void socket.leave(BROWSE);
    void socket.join(room.code);
    room.game?.setConnected(member.catId, true);
    socket.emit('room:state', this.stateOf(room));
    if (room.phase === 'playing' && room.game)
      socket.emit('game:start', this.startPayload(room, member));
  }

  // ------------------------------------------------------------------ salas

  private roomOf(userId: number): Room | undefined {
    const code = this.userRoom.get(userId);
    return code ? this.rooms.get(code) : undefined;
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++)
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return randomBytes(3).toString('hex').toUpperCase().slice(0, ROOM_CODE_LENGTH);
  }

  private rulesOf(room: Room): RoomRules {
    return { mode: room.mode, bots: room.bots, format: room.format, teamSize: room.teamSize };
  }

  /** Personas de cada equipo (solo cuenta en los modos por equipos). */
  private teamHumans(room: Room): [number, number] {
    const out: [number, number] = [0, 0];
    for (const m of room.members.values()) out[m.team]++;
    return out;
  }

  private canStartRoom(room: Room): boolean {
    return startable(this.rulesOf(room), room.members.size, this.teamHumans(room));
  }

  /** Mapas que existen en cada modo. */
  private mapsOf(mode: GameMode): readonly MapKind[] {
    return mode === 'techo'
      ? DUEL_MAPS
      : mode === 'territorio'
        ? TERRITORY_MAPS
        : mode === 'aventura'
          ? ADVENTURE_MAPS
          : MAP_KINDS;
  }

  private mapFits(mode: GameMode, map: string): boolean {
    return map === 'azar' || (this.mapsOf(mode) as readonly string[]).includes(map);
  }

  /** El equipo con menos personas (o el primero si van igual). */
  private lighterTeam(room: Room): TeamId {
    const [a, b] = this.teamHumans(room);
    return a <= b ? 0 : 1;
  }

  /** Despues de cambiar el formato: si un lado quedo pasado de gente, se mueve al otro. */
  private rebalanceTeams(room: Room): void {
    const size = teamSizeOf(this.rulesOf(room));
    if (size <= 0) return;
    for (const m of room.members.values()) {
      const counts = this.teamHumans(room);
      if (counts[m.team] > size) m.team = (m.team === 0 ? 1 : 0) as TeamId;
    }
  }

  private createRoom(user: SessionUser, socket: Socket, raw: unknown): Ack<{ code: string }> {
    const parsed = createRoomSchema.safeParse(raw ?? {});
    if (!parsed.success) return fail('datos_invalidos') as Ack<{ code: string }>;
    if (this.userRoom.has(user.id)) return fail('ya_estas_en_una_sala') as Ack<{ code: string }>;
    if (this.rooms.size >= MAX_ROOMS) return fail('servidor_lleno') as Ack<{ code: string }>;
    const mode = parsed.data.mode;
    if (!ENABLED_MODES.includes(mode)) return fail('modo_no_disponible') as Ack<{ code: string }>;
    // un mapa de otro modo no sirve: se deja al azar
    const map = this.mapFits(mode, parsed.data.map) ? parsed.data.map : 'azar';

    const room: Room = {
      code: this.newCode(),
      name: parsed.data.name ?? `Sala de ${user.username}`,
      isPrivate: parsed.data.isPrivate,
      map: map as MapKind | 'azar',
      bots: parsed.data.bots,
      mode,
      format: parsed.data.format,
      teamSize: parsed.data.teamSize,
      phase: 'lobby',
      hostId: user.id,
      members: new Map(),
      countdown: 0,
      countdownTimer: null,
      game: null,
      loop: null,
      resetTimer: null,
      celebrateUntil: null,
      persisted: false,
    };
    this.rooms.set(room.code, room);
    this.addMember(room, user, socket);
    this.broadcast(room);
    return { ok: true, data: { code: room.code } };
  }

  private joinRoom(user: SessionUser, socket: Socket, raw: unknown): Ack<{ code: string }> {
    const parsed = joinRoomSchema.safeParse(raw);
    if (!parsed.success) return fail('codigo_invalido') as Ack<{ code: string }>;
    const room = this.rooms.get(parsed.data.code);
    if (!room) return fail('sala_no_existe') as Ack<{ code: string }>;
    if (this.userRoom.get(user.id) === room.code) return { ok: true, data: { code: room.code } };
    if (this.userRoom.has(user.id)) return fail('ya_estas_en_una_sala') as Ack<{ code: string }>;
    if (room.phase === 'playing' || room.phase === 'ended')
      return fail('partida_en_curso') as Ack<{ code: string }>;
    if (room.members.size >= humanCapacity(this.rulesOf(room)))
      return fail('sala_llena') as Ack<{ code: string }>;
    this.cancelCountdown(room);
    this.addMember(room, user, socket);
    this.broadcast(room);
    return { ok: true, data: { code: room.code } };
  }

  private addMember(room: Room, user: SessionUser, socket: Socket): void {
    room.members.set(user.id, {
      userId: user.id,
      name: user.username,
      ready: false,
      socketId: socket.id,
      catId: 0,
      skin: this.skins.get(user.id) ?? defaultSkin(),
      team: this.lighterTeam(room),
    });
    this.userRoom.set(user.id, room.code);
    void socket.leave(BROWSE);
    void socket.join(room.code);
  }

  private leaveRoom(userId: number, socket: Socket | null): void {
    const room = this.roomOf(userId);
    if (!room) return;
    const member = room.members.get(userId);
    if (room.phase === 'playing' && room.game && member)
      room.game.setConnected(member.catId, false);
    const everyone = [...room.members.values()];
    room.members.delete(userId);
    this.userRoom.delete(userId);
    void socket?.leave(room.code);
    void socket?.join(BROWSE);
    this.cancelCountdown(room);

    if (room.members.size === 0) {
      // Si se van todos a media partida, igual se guarda el resultado hasta ese momento.
      if (room.phase === 'playing' && room.game) {
        if (!room.game.over) room.game.forceFinish(null);
        if (room.game.result) this.persist(room, room.game, room.game.result, everyone);
      }
      this.disposeRoom(room);
      this.rooms.delete(room.code);
      this.notifyRooms();
      return;
    }
    if (room.hostId === userId) room.hostId = (room.members.keys().next().value as number) ?? 0;
    this.broadcast(room);
  }

  private setReady(userId: number, raw: unknown): Ack {
    const parsed = readySchema.safeParse(raw);
    if (!parsed.success) return fail('datos_invalidos');
    const room = this.roomOf(userId);
    const member = room?.members.get(userId);
    if (!room || !member) return fail('no_estas_en_una_sala');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('partida_en_curso');
    member.ready = parsed.data.ready;
    member.skin = this.skins.get(userId) ?? member.skin;
    if (!member.ready) this.cancelCountdown(room);
    this.broadcast(room);
    if (
      [...room.members.values()].every((m) => m.ready) &&
      room.phase === 'lobby' &&
      this.canStartRoom(room)
    )
      this.startCountdown(room);
    return { ok: true };
  }

  /** Cambiarse de equipo (solo si el otro lado tiene lugar). */
  private setTeam(userId: number, raw: unknown): Ack {
    const parsed = teamSchema.safeParse(raw);
    if (!parsed.success) return fail('datos_invalidos');
    const room = this.roomOf(userId);
    const member = room?.members.get(userId);
    if (!room || !member) return fail('no_estas_en_una_sala');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('partida_en_curso');
    const size = teamSizeOf(this.rulesOf(room));
    if (size <= 0) return fail('sin_equipos');
    const target = parsed.data.team;
    if (member.team === target) return { ok: true };
    if (this.teamHumans(room)[target] >= size) return fail('equipo_lleno');
    member.team = target;
    member.ready = false;
    this.cancelCountdown(room);
    this.broadcast(room);
    return { ok: true };
  }

  /** El anfitrion cambia mapa, privacidad, nombre o bots; todos tienen que volver a confirmar. */
  private setSettings(userId: number, raw: unknown): Ack {
    const parsed = roomSettingsSchema.safeParse(raw);
    if (!parsed.success) return fail('datos_invalidos');
    const room = this.roomOf(userId);
    if (!room) return fail('no_estas_en_una_sala');
    if (room.hostId !== userId) return fail('solo_el_anfitrion');
    if (room.phase !== 'lobby' && room.phase !== 'countdown') return fail('partida_en_curso');
    const next = parsed.data;
    const after: RoomRules = {
      mode: next.mode ?? room.mode,
      bots: next.bots ?? room.bots,
      format: next.format ?? room.format,
      teamSize: next.teamSize ?? room.teamSize,
    };
    if (next.mode !== undefined && !ENABLED_MODES.includes(next.mode))
      return fail('modo_no_disponible');
    if (room.members.size > humanCapacity(after)) return fail('demasiados_jugadores');

    if (next.name !== undefined) room.name = next.name;
    if (next.isPrivate !== undefined) room.isPrivate = next.isPrivate;
    room.mode = after.mode;
    room.bots = after.bots;
    room.format = after.format;
    room.teamSize = after.teamSize;
    if (next.map !== undefined) room.map = next.map as MapKind | 'azar';
    // al cambiar de modo, un mapa de otro modo se deja al azar
    if (!this.mapFits(room.mode, room.map)) room.map = 'azar';
    this.rebalanceTeams(room);
    this.cancelCountdown(room);
    for (const m of room.members.values()) m.ready = false;
    this.broadcast(room);
    return { ok: true };
  }

  /** Empezar sin esperar a que todos marquen Listo (como en Among Us, manda el anfitrion). */
  private startNow(userId: number): Ack {
    const room = this.roomOf(userId);
    if (!room) return fail('no_estas_en_una_sala');
    if (room.hostId !== userId) return fail('solo_el_anfitrion');
    if (room.phase !== 'lobby') return fail('partida_en_curso');
    if (!this.canStartRoom(room)) return fail('faltan_jugadores');
    this.startCountdown(room);
    return { ok: true };
  }

  private publicRooms(): PublicRoom[] {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate)
      .map((r) => ({
        code: r.code,
        name: r.name,
        host: r.members.get(r.hostId)?.name ?? '',
        players: r.members.size,
        maxPlayers: humanCapacity(this.rulesOf(r)),
        bots: botCountFor(this.rulesOf(r), r.members.size),
        phase: r.phase,
        map: r.map,
        mode: r.mode,
      }));
  }

  /** Avisa a quien mira la lista que algo cambio; junta rafagas y no manda lo que ya se envio. */
  private notifyRooms(): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = null;
      const list = this.publicRooms();
      const signature = JSON.stringify(list);
      if (signature === this.publicSignature) return;
      this.publicSignature = signature;
      this.io.to(BROWSE).emit('rooms:update', list);
    }, ROOMS_PUSH_MS);
  }

  private stateOf(room: Room): RoomState {
    return {
      code: room.code,
      name: room.name,
      isPrivate: room.isPrivate,
      phase: room.phase,
      map: room.map,
      maxPlayers: this.totalCats(room),
      maxHumans: humanCapacity(this.rulesOf(room)),
      bots: room.bots,
      botCount: botCountFor(this.rulesOf(room), room.members.size),
      canStart: this.canStartRoom(room),
      mode: room.mode,
      format: room.format,
      teamSize: teamSizeOf(this.rulesOf(room)),
      countdown: room.countdown,
      members: [...room.members.values()].map((m) => ({
        userId: m.userId,
        name: m.name,
        ready: m.ready,
        connected: m.socketId !== null,
        host: m.userId === room.hostId,
        skin: m.skin,
        team: m.team,
      })),
    };
  }

  /** Gatos que habra en la partida (personas y bots) con la sala como esta. */
  private totalCats(room: Room): number {
    const rules = this.rulesOf(room);
    return room.mode === 'br'
      ? MAX_PLAYERS
      : room.members.size + botCountFor(rules, room.members.size);
  }

  private broadcast(room: Room): void {
    this.io.to(room.code).emit('room:state', this.stateOf(room));
    this.notifyRooms();
  }

  // ------------------------------------------------------------------ cuenta regresiva y partida

  private startCountdown(room: Room): void {
    room.phase = 'countdown';
    room.countdown = this.config.countdownSeconds;
    this.broadcast(room);
    room.countdownTimer = setInterval(() => {
      room.countdown--;
      if (room.countdown <= 0) {
        this.cancelTimer(room);
        this.startGame(room);
        return;
      }
      this.broadcast(room);
    }, 1000);
  }

  private cancelTimer(room: Room): void {
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }

  private cancelCountdown(room: Room): void {
    if (room.phase !== 'countdown') return;
    this.cancelTimer(room);
    room.phase = 'lobby';
    room.countdown = 0;
    this.broadcast(room);
  }

  private catInfos(game: BRGame): CatInfo[] {
    return game.cats.map((c) => ({
      id: c.id,
      name: c.name,
      bot: c.bot,
      skin: c.skin,
      ...(c.team >= 0 ? { team: c.team } : {}),
    }));
  }

  private startPayload(room: Room, member: Member): GameStartPayload {
    const game = room.game as BRGame;
    return {
      seed: game.seed,
      map: game.mapKind,
      ...(game.mode !== 'br' ? { mode: game.mode } : {}),
      ...(game instanceof PvpGame ? { teamSize: game.teamSize } : {}),
      you: member.catId,
      cats: this.catInfos(game),
      tickHz: TICK_HZ,
    };
  }

  /** Los gatos de la partida: las personas y, en cada lado, los bots que falten. */
  private buildCats(room: Room, rng: ReturnType<typeof createRng>): CatInit[] {
    const members = [...room.members.values()];
    const rules = this.rulesOf(room);
    const teamSize = teamSizeOf(rules);
    const cats: CatInit[] = members.map((m, i) => {
      m.catId = i + 1;
      m.ready = false;
      return {
        id: m.catId,
        name: m.name,
        userId: m.userId,
        bot: false,
        skin: isValidSkin(m.skin) ? m.skin : defaultSkin(),
        ...(teamSize > 0 ? { team: m.team } : {}),
      };
    });
    const taken = new Set(members.map((m) => m.name.toLowerCase()));
    const names = rng.shuffle(BOT_NAMES.filter((n) => !taken.has(n.toLowerCase())));
    const addBot = (team?: TeamId): void => {
      const i = cats.length;
      cats.push({
        id: i + 1,
        name: names[i - members.length] ?? `Gato${i + 1}`,
        userId: null,
        bot: true,
        skin: randomSkin(rng),
        ...(team !== undefined ? { team } : {}),
      });
    };
    if (teamSize > 0) {
      // En cada equipo se completan los lugares que las personas no ocupan.
      for (const team of [0, 1] as const) {
        const have = cats.filter((c) => c.team === team).length;
        for (let k = have; k < teamSize; k++) addBot(team);
      }
    } else {
      // Los bots que pidio el anfitrion (o los que falten hasta 12 gatos).
      const total = members.length + botCountFor(rules, members.length);
      while (cats.length < total) addBot();
    }
    return cats;
  }

  private startGame(room: Room): void {
    const members = [...room.members.values()];
    const rng = createRng(randomInt(1, 2_000_000_000));
    const pool = this.mapsOf(room.mode);
    const mapKind: MapKind = room.map === 'azar' ? (rng.pick([...pool]) as MapKind) : room.map;
    const cats = this.buildCats(room, rng);
    const teamSize = teamSizeOf(this.rulesOf(room));

    room.phase = 'playing';
    room.countdown = 0;
    // La generacion del mapa es determinista y casi siempre pasa; si una semilla falla se prueba otra.
    let game: BRGame | null = null;
    for (let i = 0; i < 5 && !game; i++) {
      try {
        const seed = randomInt(1, 2_000_000_000);
        if (room.mode === 'aventura') {
          const meta: Record<number, MetaLevels> = {};
          for (const m of members) meta[m.catId] = this.metas.get(m.userId) ?? clampMeta({});
          game = new AdventureGame({ seed, cats, meta });
        } else if (room.mode === 'techo' || room.mode === 'territorio') {
          game = new PvpGame({
            seed,
            mapKind,
            mode: room.mode,
            cats,
            teamSize,
            zone: room.mode === 'techo' ? ZONE_TECHO : ZONE_TERRITORIO,
            zoneScale: this.config.zoneTimeScale,
            pickSeconds: this.config.pickSeconds,
          });
        } else {
          game = new BRGame({
            seed,
            mapKind,
            cats,
            zoneScale: this.config.zoneTimeScale,
            introSeconds: this.config.introSeconds,
          });
        }
      } catch (err) {
        console.error('no se pudo crear la partida', err);
      }
    }
    if (!game) {
      room.phase = 'lobby';
      this.broadcast(room);
      return;
    }
    room.game = game;
    this.broadcast(room);
    for (const m of members) {
      if (m.socketId) this.sockets.get(m.userId)?.emit('game:start', this.startPayload(room, m));
    }
    this.startLoop(room);
  }

  private startLoop(room: Room): void {
    const game = room.game as BRGame;
    const stepMs = 1000 / TICK_HZ;
    let next = performance.now() + stepMs;
    const run = (): void => {
      let guard = 0;
      while (next <= performance.now() && guard < 4) {
        // Con la partida terminada el mundo se congela: solo se siguen enviando instantaneas
        // para que todos vean la celebracion del ganador.
        if (!game.over) game.step();
        next += stepMs;
        guard++;
        this.sendSnapshots(room, game);
        if (game.over && room.celebrateUntil === null) {
          room.celebrateUntil = performance.now() + this.config.celebrationSeconds * 1000;
          const result = game.result;
          const winner = result ? game.cat(result.winnerId ?? -1) : undefined;
          const team = result?.winnerTeam;
          this.io.to(room.code).emit('game:win', {
            winnerId: result?.adv ? null : (result?.winnerId ?? null),
            winnerName:
              team !== undefined && team !== null
                ? `Equipo ${TEAM_NAMES[team as 0 | 1]}`
                : (winner?.name ?? null),
            ...(team !== undefined ? { winnerTeam: team, score: result?.score } : {}),
            ...(result?.adv ? { adv: result.adv.victory ? 'victory' : 'defeat' } : {}),
          });
        }
      }
      if (next < performance.now() - stepMs * 4) next = performance.now();
      if (game.over && room.celebrateUntil !== null && performance.now() >= room.celebrateUntil) {
        this.endGame(room);
        return;
      }
      room.loop = setTimeout(run, Math.max(0, next - performance.now()));
    };
    room.loop = setTimeout(run, stepMs);
  }

  private sendSnapshots(room: Room, game: BRGame): void {
    for (const m of room.members.values()) {
      if (!m.socketId) continue;
      const snap = game.snapshotFor(m.catId);
      if (snap) this.sockets.get(m.userId)?.emit('game:snap', snap);
    }
    for (const death of game.drainDeaths()) {
      const member = [...room.members.values()].find((m) => m.catId === death.catId);
      if (member?.socketId) this.sockets.get(member.userId)?.emit('game:died', death.payload);
    }
    game.endTick();
  }

  private endGame(room: Room): void {
    const game = room.game;
    const result = game?.result;
    if (room.loop) clearTimeout(room.loop);
    room.loop = null;
    if (!game || !result) return;
    room.phase = 'ended';

    this.persist(room, game, result);

    const payload: GameEndPayload = result;
    this.io.to(room.code).emit('game:end', payload);
    this.broadcast(room);

    room.resetTimer = setTimeout(() => {
      room.resetTimer = null;
      room.game = null;
      room.phase = 'lobby';
      for (const m of room.members.values()) m.ready = false;
      for (const m of [...room.members.values()]) {
        if (m.socketId === null) this.leaveRoom(m.userId, null);
      }
      if (this.rooms.has(room.code)) this.broadcast(room);
    }, RESULTS_SECONDS * 1000);
  }

  /** Telemetria: solo cuentan los jugadores humanos. */
  private persist(
    room: Room,
    game: BRGame,
    result: GameEndPayload,
    members: Member[] = [...room.members.values()],
  ): void {
    if (room.persisted) return;
    room.persisted = true;
    try {
      this.repo.saveMatch({
        code: room.code,
        seed: game.seed,
        startedAt: game.startedAt,
        durationS: Math.max(1, result.durationS),
        result: result.humanWon ? 'win' : 'loss',
        wave: Math.max(0, game.zone.phase),
        players: members.map((m) => {
          const row = result.rows.find((r) => r.id === m.catId);
          const placement = row?.placement ?? MAX_PLAYERS;
          return {
            userId: m.userId,
            username: m.name,
            kills: row?.kills ?? 0,
            deaths: placement === 1 ? 0 : 1,
            damageDealt: row?.damageDealt ?? 0,
            survivalS: row?.survivalS ?? 0,
            survived: placement <= 3,
          };
        }),
      });
    } catch (err) {
      console.error('no se pudo guardar la partida', err);
    }
  }

  private disposeRoom(room: Room): void {
    this.cancelTimer(room);
    if (room.loop) clearTimeout(room.loop);
    if (room.resetTimer) clearTimeout(room.resetTimer);
    room.loop = null;
    room.resetTimer = null;
  }

  /** Solo para pruebas: la partida activa de un usuario. */
  debugGameOf(userId: number): { game: BRGame | null; catId: number } | null {
    const room = this.roomOf(userId);
    const member = room?.members.get(userId);
    return room && member ? { game: room.game, catId: member.catId } : null;
  }
}
