import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { Ack, PublicRoom } from '../../src/shared/br/protocol';
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

describe('limites contra el abuso', () => {
  let server: TestServer | null = null;
  const sockets: Socket[] = [];

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await server?.close();
    server = null;
  });

  /** Abre el socket de un usuario nuevo; `listo` se cumple al conectar, o falla si el servidor lo rechaza. */
  const login = async (name: string): Promise<{ socket: Socket; listo: Promise<unknown> }> => {
    const cookie = await registerUser(server as TestServer, name);
    const socket = connectSocket(server as TestServer, cookie);
    sockets.push(socket);
    const listo = new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(true));
      socket.once('connect_error', (e: Error) => reject(e));
    });
    listo.catch(() => undefined);
    return { socket, listo };
  };

  it('una misma IP no puede tener mas conexiones abiertas que el tope, y al cerrar una se libera lugar', async () => {
    server = await startServer({ limits: { socketsPerIp: 2, register: 100 } });
    const a = await login('abuso_a');
    const b = await login('abuso_b');
    await a.listo;
    await b.listo;

    const c = await login('abuso_c');
    await expect(c.listo).rejects.toMatchObject({ message: 'demasiadas_conexiones' });

    a.socket.close();
    await new Promise((r) => setTimeout(r, 150));
    const d = await login('abuso_d');
    await d.listo;
    expect(d.socket.connected).toBe(true);
  });

  it('una sala olvidada en el lobby se cierra sola y avisa a quien estaba dentro', async () => {
    server = await startServer({ roomIdleSeconds: 1 });
    const { socket: host, listo } = await login('sala_olvidada');
    await listo;
    const created = await emitAck<{ code: string }>(host, 'room:create', { name: 'Olvidada' });
    expect(created.ok).toBe(true);

    await onceEvent(host, 'room:closed', 5000);
    const listed = await emitAck<PublicRoom[]>(host, 'rooms:list');
    expect(listed.ok && listed.data!.length).toBe(0);
    // y su dueno puede crear otra: el lugar quedo libre
    const again = await emitAck<{ code: string }>(host, 'room:create', { name: 'Nueva' });
    expect(again.ok).toBe(true);
  });

  it('el barrido solo cierra salas del lobby que pasaron el tiempo, no las activas', async () => {
    server = await startServer();
    const { socket: host, listo } = await login('sala_activa');
    await listo;
    await emitAck(host, 'room:create', { name: 'Activa' });
    const lobby = (server as TestServer).realtime.lobby;
    expect(lobby.reapIdle(Date.now())).toBe(0);
    expect(lobby.reapIdle(Date.now() + 2000 * 1000)).toBe(1);
    expect(lobby.stats().rooms).toBe(0);
  });
});
