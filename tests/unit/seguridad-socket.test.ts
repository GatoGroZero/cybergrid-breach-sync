import { readFileSync } from 'node:fs';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectSocket, onceEvent, startServer, type TestServer } from './server-helper';

/**
 * Un cliente hostil puede mandar cualquier cosa por cualquier evento: sin sesion no se llega aqui,
 * pero un invitado se crea con un clic. Ninguna combinacion de basura debe tumbar el proceso ni
 * contaminar los prototipos de JavaScript.
 */

const deep = (n: number): unknown =>
  n === 0 ? 'fondo' : { a: deep(n - 1), b: [deep(n - 1 > 8 ? 8 : n - 1)] };

const JUNK: unknown[] = [
  null,
  0,
  -1,
  1e308,
  true,
  '',
  'x'.repeat(3000),
  [],
  [null, [], {}],
  {},
  { x: 'a', y: {}, id: 1, slot: -1, tier: 99, qty: 1e9, code: 'ZZZZZ', ready: 'si' },
  JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'),
  deep(12),
  Buffer.from('abc'),
  new Uint8Array(5),
];

/** Los eventos que el servidor escucha, leidos del codigo para que uno nuevo no se escape de la prueba. */
const EVENTS = [
  ...new Set(
    [...readFileSync('src/server/lobby.ts', 'utf8').matchAll(/\bon\('([a-z]+:[A-Za-z]+)'/g)].map(
      (m) => m[1] as string,
    ),
  ),
];
// salir y empezar cambian el estado de la sala: van al final para probar los demas dentro de la partida
const LAST = ['room:leave', 'game:leave', 'room:start'];
const ORDERED = [
  ...EVENTS.filter((e) => !LAST.includes(e)),
  ...LAST.filter((e) => EVENTS.includes(e)),
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function guestCookie(server: TestServer): Promise<string> {
  const res = await request(server.app).post('/api/auth/guest').send({});
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

/** Manda cada basura por cada evento, a un ritmo que no llene los cubos de fichas del servidor. */
async function barrage(socket: Socket, events: string[]): Promise<void> {
  const ack = (): undefined => undefined;
  for (const event of events) {
    // el cuarto parametro "ack" no es una funcion: lo que mas facil tumba un servidor de Socket.IO
    const calls: unknown[][] = [[], [ack], ['no-soy-una-funcion'], ['uno', 'dos'], [3, 4, 5]];
    for (const p of JUNK) calls.push([p], [p, ack], [p, p]);
    for (const args of calls) {
      socket.emit(event, ...args);
      await sleep(75);
    }
  }
}

describe('un cliente hostil no puede tumbar el servidor por el socket', () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  const crashes: unknown[] = [];
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const onCrash = (err: unknown): void => {
    crashes.push(err);
  };

  beforeAll(async () => {
    process.on('uncaughtException', onCrash);
    process.on('unhandledRejection', onCrash);
    server = await startServer({
      countdownSeconds: 1,
      testKit: true,
      limits: { socketsPerIp: 200, guest: 1000 },
    });
  });
  afterAll(async () => {
    process.off('uncaughtException', onCrash);
    process.off('unhandledRejection', onCrash);
    logged.mockRestore();
    sockets.forEach((s) => s.close());
    await server.close();
  });

  it('la prueba conoce todos los eventos del servidor', () => {
    expect(EVENTS.length).toBeGreaterThan(30);
    expect(EVENTS).toContain('inv:move');
    expect(EVENTS).toContain('game:input');
  });

  const WORKERS = 24;
  const slices = Array.from({ length: WORKERS }, (_, i) =>
    ORDERED.filter((_e, k) => k % WORKERS === i),
  );

  it('basura en todos los eventos, en el lobby y dentro de una partida (Battle Royale y Aventura)', async () => {
    await Promise.all(
      slices.map(async (slice, i) => {
        const socket = connectSocket(server, await guestCookie(server));
        sockets.push(socket);
        await onceEvent(socket, 'connect');
        // 1) en el lobby, sin sala
        await barrage(socket, slice);
        // 2) dentro de una partida: la mitad de Battle Royale y la mitad de Aventura
        const started = onceEvent(socket, 'game:start', 10_000);
        socket.emit('room:create', {
          isPrivate: true,
          mode: i % 2 === 0 ? 'br' : 'aventura',
          map: i % 2 === 0 ? 'casa' : 'azar',
        });
        await sleep(100);
        socket.emit('room:ready', { ready: true });
        await started.catch(() => undefined);
        await barrage(socket, slice);
      }),
    );

    expect(crashes).toEqual([]);
    // ningun manejador lanzo una excepcion por la basura (el envoltorio las atraparia, pero cada una
    // es un fallo que conviene arreglar en su origen)
    const handlerErrors = logged.mock.calls.filter((c) => String(c[0]).startsWith('[socket'));
    expect(handlerErrors).toEqual([]);
    const gameErrors = logged.mock.calls.filter((c) => String(c[0]).startsWith('[partida]'));
    expect(gameErrors).toEqual([]);
    // los prototipos siguen limpios
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    // y el servidor sigue respondiendo por HTTP y por socket
    expect((await request(server.app).get('/api/test/health')).status).toBe(200);
    const fresh = connectSocket(server, await guestCookie(server));
    sockets.push(fresh);
    await onceEvent(fresh, 'connect');
    expect(fresh.connected).toBe(true);
  }, 120_000);
});
