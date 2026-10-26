import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { Ack, GameStartPayload, RoomState, WinPayload } from '../../src/shared/br/protocol';
import {
  connectSocket,
  onceEvent,
  registerUser,
  startServer,
  type TestServer,
} from './server-helper';

const emitAck = <T>(socket: Socket, event: string, payload?: unknown): Promise<Ack<T>> =>
  new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve);
    else socket.emit(event, payload, resolve);
  });

describe('grupo: salir de la partida, entrar con partida en curso, ausente y expulsar', () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  /** Ultimo estado de sala que recibio cada socket. */
  const latest = new Map<Socket, RoomState>();

  const login = async (name: string): Promise<Socket> => {
    const cookie = await registerUser(server, name);
    const socket = connectSocket(server, cookie);
    sockets.push(socket);
    socket.on('room:state', (s: RoomState) => latest.set(socket, s));
    await onceEvent(socket, 'connect');
    return socket;
  };

  /** Espera a que la sala, vista por este socket, cumpla la condicion. */
  const stateWhere = (
    socket: Socket,
    test: (s: RoomState) => boolean,
    ms = 4000,
  ): Promise<RoomState> =>
    new Promise((resolve, reject) => {
      const now = latest.get(socket);
      if (now && test(now)) return resolve(now);
      const timer = setTimeout(() => {
        socket.off('room:state', on);
        reject(new Error('timeout esperando el estado de la sala'));
      }, ms);
      function on(s: RoomState): void {
        if (!test(s)) return;
        clearTimeout(timer);
        socket.off('room:state', on);
        resolve(s);
      }
      socket.on('room:state', on);
    });

  const idOf = (viewer: Socket, name: string): number =>
    latest.get(viewer)?.members.find((m) => m.name === name)?.userId ?? 0;

  const makeRoom = async (host: Socket): Promise<string> => {
    const created = await emitAck<{ code: string }>(host, 'room:create', { isPrivate: true });
    return created.ok ? created.data!.code : '';
  };

  /** Dos personas en una sala de Battle Royale con la partida ya empezada. */
  const startedPair = async (tag: string) => {
    const host = await login(`${tag}_host`);
    const guest = await login(`${tag}_inv`);
    const code = await makeRoom(host);
    await emitAck(guest, 'room:join', { code });
    const hostStart = onceEvent<GameStartPayload>(host, 'game:start', 6000);
    const guestStart = onceEvent<GameStartPayload>(guest, 'game:start', 6000);
    await emitAck(host, 'room:ready', { ready: true });
    await emitAck(guest, 'room:ready', { ready: true });
    await Promise.all([hostStart, guestStart]);
    return { host, guest, code };
  };

  beforeAll(async () => {
    server = await startServer({ countdownSeconds: 1, celebrationSeconds: 0.3, testKit: true });
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  it('salir de la partida no saca a nadie del grupo y el grupo no se disuelve', async () => {
    const { host, guest } = await startedPair('salir');
    expect((await emitAck(guest, 'game:leave')).ok).toBe(true);
    const state = await stateWhere(
      host,
      (s) => s.members.find((m) => m.name === 'salir_inv')?.playing === false,
    );
    // sigue en el grupo, ya no juega, y la partida de los demas sigue
    expect(state.members.map((m) => m.name).sort()).toEqual(['salir_host', 'salir_inv']);
    expect(state.phase).toBe('playing');
    expect(state.members.find((m) => m.name === 'salir_host')?.playing).toBe(true);

    // ya no recibe nada de la partida
    let snaps = 0;
    guest.on('game:snap', () => snaps++);
    await new Promise((r) => setTimeout(r, 250));
    expect(snaps).toBe(0);

    // cuando sale la ultima persona de la partida, el grupo vuelve junto al lobby
    expect((await emitAck(host, 'game:leave')).ok).toBe(true);
    const back = await stateWhere(host, (s) => s.phase === 'lobby');
    expect(back.members.map((m) => m.name).sort()).toEqual(['salir_host', 'salir_inv']);
    expect(back.members.every((m) => !m.ready && !m.playing)).toBe(true);
    expect(back.members.find((m) => m.host)?.name).toBe('salir_host');
  });

  it('salir del grupo (room:leave) sigue sacando a la persona de la sala', async () => {
    const { host, guest } = await startedPair('grupo');
    expect((await emitAck(guest, 'room:leave')).ok).toBe(true);
    const state = await stateWhere(host, (s) => s.members.length === 1);
    expect(state.members.map((m) => m.name)).toEqual(['grupo_host']);
    await emitAck(host, 'room:leave');
  });

  it('se puede entrar a una sala con la partida en curso y se espera en el lobby', async () => {
    const { host, code } = await startedPair('tarde');
    const late = await login('tarde_nuevo');

    // la sala privada no sale en la lista, pero una publica en curso si se puede unir: aqui, por codigo
    const joined = await emitAck(late, 'room:join', { code });
    expect(joined.ok).toBe(true);
    const state = await stateWhere(host, (s) => s.members.length === 3);
    expect(state.members.find((m) => m.name === 'tarde_nuevo')?.playing).toBe(false);
    expect(state.phase).toBe('playing');

    // espera: no puede marcar Listo mientras corre la partida, ni recibe la partida
    expect(await emitAck(late, 'room:ready', { ready: true })).toEqual({
      ok: false,
      error: 'partida_en_curso',
    });
    let snaps = 0;
    late.on('game:snap', () => snaps++);
    await new Promise((r) => setTimeout(r, 250));
    expect(snaps).toBe(0);

    // al terminar la partida, el que esperaba entra al lobby con todos
    host.emit('dev:finish');
    const back = await stateWhere(late, (s) => s.phase === 'lobby', 12_000);
    expect(back.members).toHaveLength(3);
    expect(back.members.every((m) => !m.playing && !m.ready)).toBe(true);
  }, 20_000);

  it('una sala publica en curso aparece en la lista con su fase', async () => {
    const host = await login('lista_host');
    const created = await emitAck<{ code: string }>(host, 'room:create', { isPrivate: false });
    const code = created.ok ? created.data!.code : '';
    await emitAck(host, 'room:ready', { ready: true });
    // solo: BR con bots empieza solo
    await onceEvent(host, 'game:start', 6000);
    const watcher = await login('lista_mira');
    const listed = await emitAck<{ code: string; phase: string }[]>(watcher, 'rooms:list');
    expect(listed.ok && listed.data!.find((r) => r.code === code)?.phase).toBe('playing');
    expect((await emitAck(watcher, 'room:join', { code })).ok).toBe(true);
  });

  it('ausente: sigue en el grupo, no cuenta para empezar y no entra a la partida', async () => {
    const host = await login('aus_host');
    const guest = await login('aus_inv');
    const code = await makeRoom(host);
    await emitAck(guest, 'room:join', { code });

    expect((await emitAck(guest, 'room:away', { away: true })).ok).toBe(true);
    const state = await stateWhere(host, (s) => s.members.some((m) => m.away === true));
    expect(state.members.find((m) => m.name === 'aus_inv')?.ready).toBe(false);
    // un ausente no puede marcar Listo
    expect(await emitAck(guest, 'room:ready', { ready: true })).toEqual({
      ok: false,
      error: 'estas_ausente',
    });

    // el anfitrion solo ya cuenta: empieza sin esperar al ausente
    const hostStart = onceEvent<GameStartPayload>(host, 'game:start', 6000);
    let guestStarted = false;
    guest.once('game:start', () => (guestStarted = true));
    await emitAck(host, 'room:ready', { ready: true });
    const payload = await hostStart;
    expect(payload.cats.filter((c) => !c.bot).map((c) => c.name)).toEqual(['aus_host']);
    expect(guestStarted).toBe(false);

    // quien juega no puede ponerse ausente; el ausente vuelve cuando quiere y sigue en el grupo
    expect(await emitAck(host, 'room:away', { away: true })).toEqual({
      ok: false,
      error: 'estas_en_la_partida',
    });
    expect((await emitAck(guest, 'room:away', { away: false })).ok).toBe(true);
    const back = await stateWhere(host, (s) => s.members.every((m) => m.away !== true));
    expect(back.members).toHaveLength(2);
    await emitAck(host, 'game:leave');
  });

  it('solo el anfitrion expulsa, y la persona expulsada se entera y queda libre', async () => {
    const host = await login('exp_host');
    const guest = await login('exp_inv');
    const code = await makeRoom(host);
    await emitAck(guest, 'room:join', { code });
    await stateWhere(host, (s) => s.members.length === 2);
    const guestId = idOf(host, 'exp_inv');
    const hostId = idOf(host, 'exp_host');
    expect(guestId).toBeGreaterThan(0);

    expect(await emitAck(guest, 'room:kick', { userId: hostId })).toEqual({
      ok: false,
      error: 'solo_el_anfitrion',
    });
    expect(await emitAck(host, 'room:kick', { userId: hostId })).toEqual({
      ok: false,
      error: 'no_puedes_expulsarte',
    });

    const kicked = onceEvent(guest, 'room:kicked');
    expect((await emitAck(host, 'room:kick', { userId: guestId })).ok).toBe(true);
    await kicked;
    const after = await stateWhere(host, (s) => s.members.length === 1);
    expect(after.members.map((m) => m.name)).toEqual(['exp_host']);
    // ya puede crear o entrar a otra sala
    expect((await emitAck(guest, 'room:create', { isPrivate: true })).ok).toBe(true);
    expect(await emitAck(host, 'room:kick', { userId: guestId })).toEqual({
      ok: false,
      error: 'no_esta_en_la_sala',
    });
  });

  it('el anfitrion puede expulsar a alguien que ya esta jugando y la partida sigue', async () => {
    const { host, guest } = await startedPair('echar');
    const id = idOf(host, 'echar_inv');
    const kicked = onceEvent(guest, 'room:kicked');
    expect((await emitAck(host, 'room:kick', { userId: id })).ok).toBe(true);
    await kicked;
    const win = onceEvent<WinPayload>(host, 'game:win', 6000);
    host.emit('dev:finish');
    await win;
  });
});
