import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Server, Socket } from 'socket.io';
import { MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, TICK_HZ } from '../shared/br/constants';
import { MAP_KINDS, type MapKind } from '../shared/br/map';
import {
  createRoomSchema,
  dropSchema,
  inputSchema,
  joinRoomSchema,
  lootIdSchema,
  lootTakeSchema,
  moveItemSchema,
  readySchema,
  selectSchema,
  skinSchema,
  spectateSchema,
  type Ack,
  type CatInfo,
  type GameEndPayload,
  type GameStartPayload,
  type LootContents,
  type PublicRoom,
  type RoomPhase,
  type RoomState,
} from '../shared/br/protocol';
import { defaultSkin, isValidSkin, randomSkin, type Skin } from '../shared/br/skin';
import { createRng } from '../shared/rng';
import type { SessionUser } from './auth';
import { BRGame, type CatInit } from './br/Game';
import type { Config } from './config';
import type { Repo } from './db';

interface Member {
  userId: number;
  name: string;
  ready: boolean;
  socketId: string | null;
  catId: number;
  skin: Skin;
}

interface Room {
  code: string;
  name: string;
  isPrivate: boolean;
  map: MapKind | 'azar';
  phase: RoomPhase;
  hostId: number;
  members: Map<number, Member>;
  countdown: number;
  countdownTimer: NodeJS.Timeout | null;
  game: BRGame | null;
  loop: NodeJS.Timeout | null;
  resetTimer: NodeJS.Timeout | null;
}

const MAX_ROOMS = 40;
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

    // ---- partida
    socket.on('game:input', (raw: unknown) => {
      if (!allow(inputBucket)) return;
      const parsed = inputSchema.safeParse(raw);
      const m = me();
      if (parsed.success && m?.game) m.game.pushInput(m.member.catId, parsed.data);
    });
    socket.on('dev:kit', () => {
      const m = me();
      if (this.config.testKit && m?.game) m.game.giveTestKit(m.member.catId);
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

  private createRoom(user: SessionUser, socket: Socket, raw: unknown): Ack<{ code: string }> {
    const parsed = createRoomSchema.safeParse(raw ?? {});
    if (!parsed.success) return fail('datos_invalidos') as Ack<{ code: string }>;
    if (this.userRoom.has(user.id)) return fail('ya_estas_en_una_sala') as Ack<{ code: string }>;
    if (this.rooms.size >= MAX_ROOMS) return fail('servidor_lleno') as Ack<{ code: string }>;

    const room: Room = {
      code: this.newCode(),
      name: parsed.data.name ?? `Sala de ${user.username}`,
      isPrivate: parsed.data.isPrivate,
      map: parsed.data.map as MapKind | 'azar',
      phase: 'lobby',
      hostId: user.id,
      members: new Map(),
      countdown: 0,
      countdownTimer: null,
      game: null,
      loop: null,
      resetTimer: null,
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
    if (room.members.size >= MAX_PLAYERS) return fail('sala_llena') as Ack<{ code: string }>;
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
    });
    this.userRoom.set(user.id, room.code);
    void socket.join(room.code);
  }

  private leaveRoom(userId: number, socket: Socket | null): void {
    const room = this.roomOf(userId);
    if (!room) return;
    const member = room.members.get(userId);
    if (room.phase === 'playing' && room.game && member)
      room.game.setConnected(member.catId, false);
    room.members.delete(userId);
    this.userRoom.delete(userId);
    void socket?.leave(room.code);
    this.cancelCountdown(room);

    if (room.members.size === 0) {
      this.disposeRoom(room);
      this.rooms.delete(room.code);
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
    if ([...room.members.values()].every((m) => m.ready) && room.phase === 'lobby')
      this.startCountdown(room);
    return { ok: true };
  }

  private publicRooms(): PublicRoom[] {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate)
      .map((r) => ({
        code: r.code,
        name: r.name,
        players: r.members.size,
        maxPlayers: MAX_PLAYERS,
        phase: r.phase,
        map: r.map,
      }));
  }

  private stateOf(room: Room): RoomState {
    return {
      code: room.code,
      name: room.name,
      isPrivate: room.isPrivate,
      phase: room.phase,
      map: room.map,
      maxPlayers: MAX_PLAYERS,
      countdown: room.countdown,
      members: [...room.members.values()].map((m) => ({
        userId: m.userId,
        name: m.name,
        ready: m.ready,
        connected: m.socketId !== null,
        host: m.userId === room.hostId,
        skin: m.skin,
      })),
    };
  }

  private broadcast(room: Room): void {
    this.io.to(room.code).emit('room:state', this.stateOf(room));
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
    return game.cats.map((c) => ({ id: c.id, name: c.name, bot: c.bot, skin: c.skin }));
  }

  private startPayload(room: Room, member: Member): GameStartPayload {
    const game = room.game as BRGame;
    return {
      seed: game.seed,
      map: game.mapKind,
      you: member.catId,
      cats: this.catInfos(game),
      tickHz: TICK_HZ,
    };
  }

  private startGame(room: Room): void {
    const members = [...room.members.values()];
    const rng = createRng(randomInt(1, 2_000_000_000));
    const mapKind: MapKind = room.map === 'azar' ? (rng.pick([...MAP_KINDS]) as MapKind) : room.map;

    const cats: CatInit[] = members.map((m, i) => {
      m.catId = i + 1;
      m.ready = false;
      return {
        id: m.catId,
        name: m.name,
        userId: m.userId,
        bot: false,
        skin: isValidSkin(m.skin) ? m.skin : defaultSkin(),
      };
    });
    // La sala se llena con bots hasta 10 gatos.
    const taken = new Set(members.map((m) => m.name.toLowerCase()));
    const names = rng.shuffle(BOT_NAMES.filter((n) => !taken.has(n.toLowerCase())));
    for (let i = cats.length; i < MAX_PLAYERS; i++) {
      cats.push({
        id: i + 1,
        name: names[i - members.length] ?? `Gato${i + 1}`,
        userId: null,
        bot: true,
        skin: randomSkin(rng),
      });
    }

    room.phase = 'playing';
    room.countdown = 0;
    // La generacion del mapa es determinista y casi siempre pasa; si una semilla falla se prueba otra.
    let game: BRGame | null = null;
    for (let i = 0; i < 5 && !game; i++) {
      try {
        game = new BRGame({
          seed: randomInt(1, 2_000_000_000),
          mapKind,
          cats,
          zoneScale: this.config.zoneTimeScale,
        });
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
      while (next <= performance.now() && guard < 4 && !game.over) {
        game.step();
        next += stepMs;
        guard++;
        this.sendSnapshots(room, game);
      }
      if (next < performance.now() - stepMs * 4) next = performance.now();
      if (game.over) {
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

    // Telemetria: solo cuentan los jugadores humanos.
    try {
      this.repo.saveMatch({
        code: room.code,
        seed: game.seed,
        startedAt: game.startedAt,
        durationS: Math.max(1, result.durationS),
        result: result.humanWon ? 'win' : 'loss',
        wave: Math.max(0, game.zone.phase),
        players: [...room.members.values()].map((m) => {
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
