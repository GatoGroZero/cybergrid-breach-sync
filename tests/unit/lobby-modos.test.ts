import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { Ack, GameStartPayload, RoomState } from '../../src/shared/br/protocol';
import type { BRSnapshot } from '../../src/shared/br/types';
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

describe('salas por modo: pelea en el techo', () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    server = await startServer({ countdownSeconds: 1, pickSeconds: 4, celebrationSeconds: 0.3 });
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  async function player(name: string): Promise<Socket> {
    const cookie = await registerUser(server, name);
    const s = connectSocket(server, cookie);
    sockets.push(s);
    await onceEvent(s, 'connect');
    return s;
  }

  it('un modo que no existe se rechaza con un mensaje claro', async () => {
    const s = await player('impaciente');
    expect(await emitAck(s, 'room:create', { mode: 'inventado' })).toEqual({
      ok: false,
      error: 'datos_invalidos',
    });
  });

  it('el estado de la sala trae modo, formato, equipos y el mapa se ajusta al modo', async () => {
    const host = await player('anfitriontecho');
    const state = onceEvent<RoomState>(host, 'room:state');
    const created = await emitAck(host, 'room:create', {
      mode: 'techo',
      format: '2v2',
      map: 'casa',
    });
    expect(created.ok).toBe(true);
    const room = await state;
    expect(room.mode).toBe('techo');
    expect(room.format).toBe('2v2');
    expect(room.teamSize).toBe(2);
    // "casa" no es un techo: queda al azar
    expect(room.map).toBe('azar');
    expect(room.maxHumans).toBe(4);
    expect(room.maxPlayers).toBe(4);
    expect(room.members[0]?.team).toBe(0);
    expect(room.canStart).toBe(true);
    expect(room.botCount).toBe(3);
  });

  it('las personas se reparten en equipos, se pueden cambiar y la sala se llena', async () => {
    const a = await player('dueloa');
    const b = await player('dueloa2');
    const c = await player('dueloa3');
    const created = await emitAck<{ code: string }>(a, 'room:create', {
      mode: 'techo',
      format: '1v1',
      map: 'tejado',
    });
    const code = created.ok ? created.data!.code : '';
    const joined = onceEvent<RoomState>(a, 'room:state');
    expect((await emitAck(b, 'room:join', { code })).ok).toBe(true);
    const room = await joined;
    expect(room.members.map((m) => m.team)).toEqual([0, 1]);
    expect(room.maxHumans).toBe(2);
    expect(room.botCount).toBe(0);
    expect(await emitAck(c, 'room:join', { code })).toEqual({ ok: false, error: 'sala_llena' });
    // el otro lado esta ocupado: no se puede cambiar
    expect(await emitAck(a, 'room:team', { team: 1 })).toEqual({
      ok: false,
      error: 'equipo_lleno',
    });
    expect(await emitAck(a, 'room:team', { team: 7 })).toEqual({
      ok: false,
      error: 'datos_invalidos',
    });
    // en un Battle Royale no hay equipos
    const br = await player('sinequipos');
    await emitAck(br, 'room:create', { mode: 'br' });
    expect(await emitAck(br, 'room:team', { team: 1 })).toEqual({
      ok: false,
      error: 'sin_equipos',
    });
  });

  it('el anfitrion puede cambiar el formato y volver al Battle Royale sin perder la sala', async () => {
    const host = await player('cambiante');
    await emitAck(host, 'room:create', { mode: 'techo', format: '2v2', map: 'azotea' });
    let state = onceEvent<RoomState>(host, 'room:state');
    expect((await emitAck(host, 'room:settings', { format: '1v1' })).ok).toBe(true);
    let room = await state;
    expect(room.teamSize).toBe(1);
    expect(room.maxPlayers).toBe(2);
    expect(room.map).toBe('azotea');
    state = onceEvent<RoomState>(host, 'room:state');
    expect((await emitAck(host, 'room:settings', { mode: 'br' })).ok).toBe(true);
    room = await state;
    expect(room.mode).toBe('br');
    // la azotea no existe en el Battle Royale
    expect(room.map).toBe('azar');
    expect(room.maxPlayers).toBe(12);
  });

  it('al empezar llegan los equipos, el kit se elige por socket y la ronda arranca', async () => {
    const host = await player('jugadortecho');
    const started = onceEvent<GameStartPayload>(host, 'game:start', 8000);
    await emitAck(host, 'room:create', {
      mode: 'techo',
      format: '2v2',
      map: 'mansarda',
      isPrivate: true,
    });
    await emitAck(host, 'room:ready', { ready: true });
    const start = await started;
    expect(start.mode).toBe('techo');
    expect(start.teamSize).toBe(2);
    expect(start.map).toBe('mansarda');
    expect(start.cats).toHaveLength(4);
    expect(start.cats.filter((c) => c.team === 0)).toHaveLength(2);
    expect(start.cats.filter((c) => c.team === 1)).toHaveLength(2);
    expect(start.cats.filter((c) => c.bot)).toHaveLength(3);

    const first = await onceEvent<BRSnapshot>(host, 'game:snap');
    expect(first.mode).toBe('techo');
    expect(first.pvp?.phase).toBe('pick');
    expect(first.pvp?.round).toBe(1);

    expect(await emitAck(host, 'game:kit', { kit: 'inventado' })).toEqual({
      ok: false,
      error: 'datos_invalidos',
    });
    expect((await emitAck(host, 'game:kit', { kit: 'vigia' })).ok).toBe(true);
    let snap: BRSnapshot | null = null;
    // el inventario solo viaja cuando cambia: se guarda el ultimo que llego
    let inv: BRSnapshot['inv'];
    for (let i = 0; i < 400 && snap?.pvp?.phase !== 'fight'; i++) {
      snap = await onceEvent<BRSnapshot>(host, 'game:snap');
      if (snap.inv) inv = snap.inv;
    }
    expect(snap?.pvp?.phase).toBe('fight');
    expect(snap?.pvp?.kit).toBe('vigia');
    expect(inv?.[0]).toMatchObject({ kind: 'sniper' });
    // ya empezo la pelea: elegir otro kit fuera de tiempo se rechaza
    expect(await emitAck(host, 'game:kit', { kit: 'cazador' })).toEqual({
      ok: false,
      error: 'fuera_de_tiempo',
    });
  }, 30_000);
});

describe('salas por modo: aventura', () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    server = await startServer({ countdownSeconds: 1, celebrationSeconds: 0.3 });
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  it('una sola persona entra sin bots al bosque, trae sus mejoras y elige su reliquia', async () => {
    const cookie = await registerUser(server, 'exploradorgato');
    const s = connectSocket(server, cookie);
    sockets.push(s);
    await onceEvent(s, 'connect');
    expect(
      await emitAck(s, 'room:meta', {
        vida: 2,
        garras: 1,
        municion: 0,
        botiquin: 1,
        vidas: 1,
        reliquia: 1,
      }),
    ).toEqual({ ok: true });
    expect((await emitAck(s, 'room:meta', { vida: 99 })).ok).toBe(false);
    const started = onceEvent<GameStartPayload>(s, 'game:start', 8000);
    const created = await emitAck(s, 'room:create', { mode: 'aventura', isPrivate: true });
    expect(created.ok).toBe(true);
    await emitAck(s, 'room:ready', { ready: true });
    const start = await started;
    expect(start.mode).toBe('aventura');
    expect(start.map).toBe('encantado');
    expect(start.cats).toHaveLength(1);
    expect(start.cats.every((c) => !c.bot)).toBe(true);

    let snap = await onceEvent<BRSnapshot>(s, 'game:snap');
    for (let i = 0; i < 10 && !snap.adv?.choice; i++)
      snap = await onceEvent<BRSnapshot>(s, 'game:snap');
    expect(snap.mode).toBe('aventura');
    expect(snap.adv?.lives).toBe(8);
    expect(snap.adv?.choice).toHaveLength(3);
    expect(snap.me?.maxHp).toBe(120);
    expect(await emitAck(s, 'game:relic', { i: 7 })).toEqual({
      ok: false,
      error: 'datos_invalidos',
    });
    expect((await emitAck(s, 'game:relic', { i: 1 })).ok).toBe(true);
    let next = await onceEvent<BRSnapshot>(s, 'game:snap');
    for (let i = 0; i < 6 && next.adv?.choice; i++)
      next = await onceEvent<BRSnapshot>(s, 'game:snap');
    expect(next.adv?.choice ?? []).toHaveLength(0);
  });
});
