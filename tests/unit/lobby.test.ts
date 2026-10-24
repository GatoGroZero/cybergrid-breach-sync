import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type {
  Ack,
  GameEndPayload,
  GameStartPayload,
  PublicRoom,
  RoomState,
} from '../../src/shared/protocol';
import type { Snapshot } from '../../src/shared/types';
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

describe('lobby y proteccion de salas', () => {
  let server: TestServer;
  const sockets: Socket[] = [];

  const login = async (name: string): Promise<Socket> => {
    const cookie = await registerUser(server, name);
    const socket = connectSocket(server, cookie);
    sockets.push(socket);
    await onceEvent(socket, 'connect');
    return socket;
  };

  beforeAll(async () => {
    server = await startServer({ countdownSeconds: 1 });
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  it('una sala privada no aparece en la lista y exige el codigo exacto para entrar', async () => {
    const host = await login('anfitrion');
    const guest = await login('invitado');
    const created = await emitAck<{ code: string }>(host, 'room:create', {
      name: 'Secreta',
      isPrivate: true,
    });
    expect(created.ok).toBe(true);
    const code = created.ok ? created.data!.code : '';
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);

    const listed = await emitAck<PublicRoom[]>(guest, 'rooms:list');
    expect(listed.ok && listed.data!.some((r) => r.code === code)).toBe(false);

    const wrong = await emitAck(guest, 'room:join', { code: 'ZZZZZ' });
    expect(wrong).toEqual({ ok: false, error: 'sala_no_existe' });
    const malformed = await emitAck(guest, 'room:join', { code: '123' });
    expect(malformed).toEqual({ ok: false, error: 'codigo_invalido' });

    const state = onceEvent<RoomState>(host, 'room:state');
    const joined = await emitAck(guest, 'room:join', { code: code.toLowerCase() });
    expect(joined.ok).toBe(true);
    expect((await state).members.map((m) => m.name).sort()).toEqual(['anfitrion', 'invitado']);

    const again = await emitAck(guest, 'room:create', { isPrivate: false });
    expect(again).toEqual({ ok: false, error: 'ya_estas_en_una_sala' });
  });

  it('las salas publicas se listan y se llenan a 4 jugadores', async () => {
    const host = await login('publico_host');
    const created = await emitAck<{ code: string }>(host, 'room:create', { isPrivate: false });
    const code = created.ok ? created.data!.code : '';
    const listed = await emitAck<PublicRoom[]>(host, 'rooms:list');
    expect(listed.ok && listed.data!.find((r) => r.code === code)?.players).toBe(1);

    for (let i = 1; i <= 3; i++) {
      const s = await login(`relleno_${i}`);
      expect((await emitAck(s, 'room:join', { code })).ok).toBe(true);
    }
    const fifth = await login('quinto_jugador');
    expect(await emitAck(fifth, 'room:join', { code })).toEqual({ ok: false, error: 'sala_llena' });
  });

  it('con todos en Listo arranca la cuenta regresiva y la partida; un input falsificado se ignora', async () => {
    const a = await login('equipo_a');
    const b = await login('equipo_b');
    const created = await emitAck<{ code: string }>(a, 'room:create', { isPrivate: false });
    const code = created.ok ? created.data!.code : '';
    await emitAck(b, 'room:join', { code });

    const startA = onceEvent<GameStartPayload>(a, 'game:start', 6000);
    const startB = onceEvent<GameStartPayload>(b, 'game:start', 6000);
    expect((await emitAck(a, 'room:ready', { ready: true })).ok).toBe(true);
    expect((await emitAck(b, 'room:ready', { ready: true })).ok).toBe(true);
    const [sa, sb] = await Promise.all([startA, startB]);
    expect(sa.players).toHaveLength(2);
    expect(sa.seed).toBe(sb.seed);
    expect([sa.you, sb.you].sort()).toEqual([1, 2]);

    const snap = await onceEvent<Snapshot>(a, 'game:snap');
    const mine = snap.pl.find((p) => p[0] === sa.you)!;
    const [x0, y0] = [mine[1], mine[2]];

    // Cuerpo con campos de mas: Zod los descarta, el servidor solo lee la intencion de mover.
    a.emit('game:input', {
      seq: 1,
      mx: 0,
      my: 0,
      aim: 0,
      auto: false,
      fire: false,
      x: 9999,
      y: 9999,
      hp: 9999,
    });
    a.emit('game:input', { seq: 2, mx: 'rapido', my: 0 });
    await new Promise((r) => setTimeout(r, 200));
    const later = await onceEvent<Snapshot>(a, 'game:snap');
    const after = later.pl.find((p) => p[0] === sa.you)!;
    expect(Math.hypot(after[1] - x0, after[2] - y0)).toBeLessThan(5);
    expect(after[3]).toBeLessThanOrEqual(100);
    expect(later.ack[sa.you]).toBe(1);
  });

  it('al terminar la partida se guarda en la base y entra a la telemetria', async () => {
    const solo = await login('en_solitario');
    const created = await emitAck<{ code: string }>(solo, 'room:create', { isPrivate: true });
    expect(created.ok).toBe(true);
    const lobby = server.realtime.lobby as unknown as {
      rooms: Map<string, { game: { finish(r: string, why: string): void } | null }>;
    };
    const ended = onceEvent<GameEndPayload>(solo, 'game:end', 8000);
    await emitAck(solo, 'room:ready', { ready: true });
    await onceEvent(solo, 'game:start', 6000);
    const code = created.ok ? created.data!.code : '';
    lobby.rooms.get(code)!.game!.finish('loss', 'timeout');
    const result = await ended;
    expect(result.result).toBe('loss');
    const totals = server.repo.totals();
    expect(totals.real.matches).toBe(1);
    expect(totals.real.appearances).toBe(1);
  });
});
