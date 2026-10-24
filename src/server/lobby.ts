import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Server, Socket } from 'socket.io';
import { MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SIM_HZ } from '../shared/constants';
import {
  createRoomSchema,
  inputSchema,
  joinRoomSchema,
  readySchema,
  useItemSchema,
  type Ack,
  type GameEndPayload,
  type GameStartPayload,
  type PublicRoom,
  type RoomPhase,
  type RoomState,
} from '../shared/protocol';
import type { SessionUser } from './auth';
import type { Config } from './config';
import type { Repo } from './db';
import { Game } from './game/Game';

interface Member {
  userId: number;
  name: string;
  ready: boolean;
  socketId: string | null;
  playerId: number;
}

interface Room {
  code: string;
  name: string;
  isPrivate: boolean;
  phase: RoomPhase;
  hostId: number;
  members: Map<number, Member>;
  countdown: number;
  countdownTimer: NodeJS.Timeout | null;
  game: Game | null;
  loop: NodeJS.Timeout | null;
  resetTimer: NodeJS.Timeout | null;
}

const MAX_ROOMS = 60;
const RESULTS_SECONDS = 4;

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
    const actionBucket = new Bucket(8, 16);
    let strikes = 0;
    const allow = (bucket: Bucket): boolean => {
      if (bucket.take()) return true;
      if (++strikes > 400) socket.disconnect(true);
      return false;
    };

    socket.on('rooms:list', (ack?: (a: Ack<PublicRoom[]>) => void) => {
      if (!allow(actionBucket)) return;
      ack?.({ ok: true, data: this.publicRooms() });
    });

    socket.on('room:create', (raw: unknown, ack?: (a: Ack<{ code: string }>) => void) => {
      if (!allow(actionBucket)) return;
      ack?.(this.createRoom(user, socket, raw) as Ack<{ code: string }>);
    });

    socket.on('room:join', (raw: unknown, ack?: (a: Ack<{ code: string }>) => void) => {
      if (!allow(actionBucket)) return;
      ack?.(this.joinRoom(user, socket, raw) as Ack<{ code: string }>);
    });

    socket.on('room:leave', (ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      this.leaveRoom(user.id, socket);
      ack?.({ ok: true });
    });

    socket.on('room:ready', (raw: unknown, ack?: (a: Ack) => void) => {
      if (!allow(actionBucket)) return;
      ack?.(this.setReady(user.id, raw));
    });

    socket.on('game:input', (raw: unknown) => {
      if (!allow(inputBucket)) return;
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) return;
      const room = this.roomOf(user.id);
      const member = room?.members.get(user.id);
      if (room?.game && member) room.game.pushInput(member.playerId, parsed.data);
    });

    socket.on('game:use', (raw: unknown) => {
      if (!allow(actionBucket)) return;
      const parsed = useItemSchema.safeParse(raw);
      if (!parsed.success) return;
      const room = this.roomOf(user.id);
      const member = room?.members.get(user.id);
      if (room?.game && member) room.game.useItem(member.playerId, parsed.data.slot);
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
      room.game.setConnected(member.playerId, false);
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
    room.game?.setConnected(member.playerId, true);
    socket.emit('room:state', this.stateOf(room));
    if (room.phase === 'playing' && room.game) {
      socket.emit('game:start', this.startPayload(room, member));
    }
  }

  // ------------------------------------------------------------------ salas

  private roomOf(userId: number): Room | undefined {
    const code = this.userRoom.get(userId);
    return code ? this.rooms.get(code) : undefined;
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
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
    if (room.phase === 'playing' || room.phase === 'ended') {
      return fail('partida_en_curso') as Ack<{ code: string }>;
    }
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
      playerId: 0,
    });
    this.userRoom.set(user.id, room.code);
    void socket.join(room.code);
  }

  private leaveRoom(userId: number, socket: Socket | null): void {
    const room = this.roomOf(userId);
    if (!room) return;
    if (room.phase === 'playing' && room.game) {
      // Abandonar a media partida cuenta como desconexion definitiva.
      const member = room.members.get(userId);
      if (member) room.game.setConnected(member.playerId, false);
    }
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
    if (!member.ready) this.cancelCountdown(room);
    this.broadcast(room);
    const everyone = [...room.members.values()].every((m) => m.ready);
    if (everyone && room.phase === 'lobby') this.startCountdown(room);
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
      }));
  }

  private stateOf(room: Room): RoomState {
    return {
      code: room.code,
      name: room.name,
      isPrivate: room.isPrivate,
      phase: room.phase,
      maxPlayers: MAX_PLAYERS,
      countdown: room.countdown,
      members: [...room.members.values()].map((m) => ({
        userId: m.userId,
        name: m.name,
        ready: m.ready,
        connected: m.socketId !== null,
        host: m.userId === room.hostId,
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

  private startPayload(room: Room, member: Member): GameStartPayload {
    const game = room.game as Game;
    return {
      seed: game.seed,
      you: member.playerId,
      players: [...room.members.values()].map((m) => ({
        id: m.playerId,
        name: m.name,
        color: m.playerId - 1,
      })),
      matchSeconds: game.matchSeconds,
      tickHz: SIM_HZ,
    };
  }

  private startGame(room: Room): void {
    const members = [...room.members.values()];
    members.forEach((m, i) => {
      m.playerId = i + 1;
      m.ready = false;
    });
    room.phase = 'playing';
    room.countdown = 0;
    room.game = new Game({
      seed: randomInt(1, 2_000_000_000),
      players: members.map((m) => ({ id: m.playerId, userId: m.userId, name: m.name })),
    });
    this.broadcast(room);
    for (const m of members) {
      if (m.socketId) this.sockets.get(m.userId)?.emit('game:start', this.startPayload(room, m));
    }
    this.startLoop(room);
  }

  private startLoop(room: Room): void {
    const game = room.game as Game;
    const stepMs = 1000 / SIM_HZ;
    let next = performance.now() + stepMs;
    const run = (): void => {
      let guard = 0;
      while (next <= performance.now() && guard < 4 && !game.over) {
        game.step();
        next += stepMs;
        guard++;
        if (game.tick % this.config.snapshotEvery === 0 || game.over) {
          this.io.to(room.code).emit('game:snap', game.snapshot());
        }
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

  private endGame(room: Room): void {
    const game = room.game;
    const result = game?.result;
    if (room.loop) clearTimeout(room.loop);
    room.loop = null;
    if (!game || !result) return;
    room.phase = 'ended';

    const byPlayer = new Map([...room.members.values()].map((m) => [m.playerId, m.userId]));
    try {
      this.repo.saveMatch({
        code: room.code,
        seed: game.seed,
        startedAt: game.startedAt,
        durationS: result.durationS,
        result: result.result,
        wave: result.wave,
        players: result.players.map((p) => ({
          userId: byPlayer.get(p.id) ?? null,
          username: p.name,
          kills: p.kills,
          deaths: p.deaths,
          damageDealt: p.damageDealt,
          survivalS: p.survivalS,
          survived: p.survived,
        })),
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
      // Quien se desconecto durante la partida ya no vuelve a la sala.
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
}
