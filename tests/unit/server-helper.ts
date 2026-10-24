import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { loadConfig, type Config } from '../../src/server/config';
import { Repo } from '../../src/server/db';
import { Metrics } from '../../src/server/metrics';
import { createRealtime, type Realtime } from '../../src/server/realtime';

export interface TestServer {
  url: string;
  config: Config;
  repo: Repo;
  app: Express;
  http: Server;
  realtime: Realtime;
  close(): Promise<void>;
}

export async function startServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const config = loadConfig({
    env: 'test',
    dbPath: ':memory:',
    demoAccounts: false,
    staticDir: '/ruta/que/no/existe',
    sessionSecret: 'secreto-de-pruebas-secreto-de-pruebas',
    ...overrides,
  });
  const repo = new Repo(config.dbPath);
  const metrics = new Metrics();
  const http = createServer();
  const realtime = createRealtime(http, { config, metrics });
  const app = createApp({ config, repo, metrics, runtime: realtime.runtime });
  http.on('request', app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    config,
    repo,
    app,
    http,
    realtime,
    close: async () => {
      await realtime.close().catch(() => undefined);
      await new Promise<void>((resolve) => http.close(() => resolve()));
      metrics.stop();
      repo.close();
    },
  };
}

/** Registra un usuario y devuelve la cabecera Cookie lista para usar en sockets. */
export async function registerUser(server: TestServer, username: string): Promise<string> {
  const res = await request(server.app)
    .post('/api/auth/register')
    .send({ username, password: 'clave-de-prueba-1' });
  if (res.status !== 201)
    throw new Error(`registro fallo: ${res.status} ${JSON.stringify(res.body)}`);
  const raw = res.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
  return cookie;
}

export function connectSocket(server: TestServer, cookie?: string): Socket {
  return connect(server.url, {
    transports: ['websocket'],
    reconnection: false,
    ...(cookie ? { extraHeaders: { cookie } } : {}),
  });
}

export function onceEvent<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${event}`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
