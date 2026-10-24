import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type {
  Ack,
  GameEndPayload,
  GameStartPayload,
  LootContents,
} from '../../src/shared/br/protocol';
import type { BRSnapshot } from '../../src/shared/br/types';
import type { Skin } from '../../src/shared/br/skin';
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

async function soloGame(server: TestServer, name: string, sockets: Socket[]) {
  const cookie = await registerUser(server, name);
  const socket = connectSocket(server, cookie);
  sockets.push(socket);
  await onceEvent(socket, 'connect');
  const started = onceEvent<GameStartPayload>(socket, 'game:start', 6000);
  await emitAck(socket, 'room:create', { isPrivate: true, map: 'casa' });
  await emitAck(socket, 'room:ready', { ready: true });
  return { socket, start: await started };
}

describe('eventos de la partida por socket', () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    server = await startServer({ countdownSeconds: 1, testKit: true, celebrationSeconds: 0.3 });
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  it('guarda el pelaje y rechaza uno mal formado', async () => {
    const cookie = await registerUser(server, 'pintor');
    const s = connectSocket(server, cookie);
    sockets.push(s);
    await onceEvent(s, 'connect');
    const def = await emitAck<Skin>(s, 'skin:get');
    expect(def.ok && def.data!.paint).toHaveLength(384);
    const good = { base: 3, paint: 'f'.repeat(384) };
    expect((await emitAck(s, 'skin:set', good)).ok).toBe(true);
    const back = await emitAck<Skin>(s, 'skin:get');
    expect(back.ok && back.data).toEqual(good);
    expect(await emitAck(s, 'skin:set', { base: 3, paint: 'zz' })).toEqual({
      ok: false,
      error: 'pelaje_invalido',
    });
  });

  it('interactuar, abrir, tomar y ordenar responden sin romper nada cuando no hay cofre cerca', async () => {
    const { socket, start } = await soloGame(server, 'caminante', sockets);
    expect(start.map).toBe('casa');
    const none = await emitAck<LootContents | null>(socket, 'game:interact');
    expect(none).toEqual({ ok: true, data: null });
    expect(await emitAck(socket, 'loot:open', { id: 999 })).toEqual({ ok: true, data: null });
    expect(await emitAck(socket, 'loot:open', { id: 'x' })).toEqual({
      ok: false,
      error: 'datos_invalidos',
    });
    expect(await emitAck(socket, 'loot:take', { id: 999, index: 0 })).toEqual({
      ok: true,
      data: null,
    });
    expect(await emitAck(socket, 'loot:takeAll', { id: 999 })).toEqual({ ok: true, data: null });
    expect(await emitAck(socket, 'inv:move', { from: 0, to: 1 })).toEqual({ ok: true });
    expect(await emitAck(socket, 'inv:move', { from: 0, to: 7 })).toEqual({
      ok: false,
      error: 'datos_invalidos',
    });
    expect(await emitAck(socket, 'inv:drop', { slot: 2 })).toEqual({ ok: true });
    socket.emit('game:select', { slot: 3 });
    socket.emit('spectate:next', { dir: 1 });
    socket.emit('spectate:next', { dir: 5 });
    const snap = await onceEvent<BRSnapshot>(socket, 'game:snap');
    expect(snap.me.alive).toBe(true);
    expect(snap.zone.phase).toBe(0);
  });

  it('con el equipo de prueba activado llega el inventario y se puede terminar la partida', async () => {
    const { socket, start } = await soloGame(server, 'equipado', sockets);
    const ended = onceEvent<GameEndPayload>(socket, 'game:end', 8000);
    socket.emit('dev:kit', 'heavy');
    let withKit: BRSnapshot | null = null;
    for (let i = 0; i < 40 && !withKit; i++) {
      const s = await onceEvent<BRSnapshot>(socket, 'game:snap');
      if (s.inv?.some((it) => it?.kind === 'bazooka')) withKit = s;
    }
    expect(withKit?.inv?.[0]).toMatchObject({ kind: 'bazooka', rarity: 2 });
    socket.emit('dev:finish');
    const result = await ended;
    expect(result.rows).toHaveLength(10);
    expect(result.rows.find((r) => r.id === start.you)).toBeDefined();
  });

  it('sin la opcion de pruebas, dev:kit y dev:finish no hacen nada', async () => {
    const locked = await startServer({ countdownSeconds: 1, celebrationSeconds: 0.3 });
    const own: Socket[] = [];
    try {
      const { socket } = await soloGame(locked, 'sin_trampas', own);
      socket.emit('dev:kit');
      socket.emit('dev:finish');
      await new Promise((r) => setTimeout(r, 400));
      const snap = await onceEvent<BRSnapshot>(socket, 'game:snap');
      expect(snap.inv === undefined || snap.inv.every((it) => it === null)).toBe(true);
      expect(snap.me.alive).toBe(true);
    } finally {
      own.forEach((s) => s.close());
      await locked.close();
    }
  });
});
