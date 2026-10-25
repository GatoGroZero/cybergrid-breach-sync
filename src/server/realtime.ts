import type { Server as HttpServer } from 'node:http';
import { isIP } from 'node:net';
import { Server, type Socket } from 'socket.io';
import { pingSchema, type PongPayload } from '../shared/br/protocol';
import { sessionFromHeader } from './auth';
import type { Config } from './config';
import type { Repo } from './db';
import { Lobby } from './lobby';
import type { Metrics } from './metrics';
import type { RuntimeInfo } from './testApi';

export interface RealtimeDeps {
  config: Config;
  metrics: Metrics;
  repo: Repo;
}

export interface Realtime {
  io: Server;
  lobby: Lobby;
  runtime(): RuntimeInfo;
  close(): Promise<void>;
}

/** La IP del cliente de un socket: detras de Cloudflare viene en CF-Connecting-IP, que el borde reescribe siempre. */
export function socketIp(socket: Socket, trustCloudflare: boolean): string {
  if (trustCloudflare) {
    const real = socket.handshake.headers['cf-connecting-ip'];
    if (typeof real === 'string' && isIP(real.trim()) !== 0) return real.trim();
  }
  return socket.handshake.address;
}

export function createRealtime(http: HttpServer, deps: RealtimeDeps): Realtime {
  const { config, metrics, repo } = deps;

  const io = new Server(http, {
    // Solo WebSocket: sin sondeo largo, asi el primer frame ya es un frame de WebSocket.
    transports: ['websocket'],
    serveClient: false,
    perMessageDeflate: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      try {
        callback(null, new URL(origin).host === req.headers.host);
      } catch {
        callback(null, false);
      }
    },
  });

  const lobby = new Lobby(io, repo, config);

  io.use(async (socket, next) => {
    const user = await sessionFromHeader(config.sessionSecret, socket.request.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  // Tope de conexiones abiertas por IP: sin el, una sola maquina con cientos de invitados llenaria
  // el servidor (un socket por cuenta) y dejaria sin sala a todos los demas.
  const perIp = new Map<string, number>();
  io.use((socket, next) => {
    const ip = socketIp(socket, config.trustCloudflare);
    const open = perIp.get(ip) ?? 0;
    if (open >= config.limits.socketsPerIp) return next(new Error('demasiadas_conexiones'));
    perIp.set(ip, open + 1);
    socket.once('disconnect', () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
    });
    next();
  });

  io.on('connection', (socket) => {
    socket.on('ping', (raw: unknown) => {
      const parsed = pingSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.rtt !== undefined) metrics.addRtt(parsed.data.rtt);
      const pong: PongPayload = { t: parsed.data.t, ts: Date.now() };
      socket.emit('pong', pong);
    });
    lobby.attach(socket);
  });

  return {
    io,
    lobby,
    runtime: () => {
      const { rooms, players } = lobby.stats();
      return { rooms, players, sockets: io.engine.clientsCount };
    },
    close: async () => {
      lobby.shutdown();
      await io.close();
    },
  };
}
