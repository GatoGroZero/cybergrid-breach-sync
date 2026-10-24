import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { pingSchema, type PongPayload } from '../shared/protocol';
import { sessionFromHeader, type SessionUser } from './auth';
import type { Config } from './config';
import type { Metrics } from './metrics';
import type { RuntimeInfo } from './testApi';

export interface RealtimeDeps {
  config: Config;
  metrics: Metrics;
}

export interface Realtime {
  io: Server;
  runtime(): RuntimeInfo;
  close(): Promise<void>;
}

export function userOf(socket: Socket): SessionUser {
  return socket.data.user as SessionUser;
}

export function createRealtime(http: HttpServer, deps: RealtimeDeps): Realtime {
  const { config, metrics } = deps;

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

  io.use(async (socket, next) => {
    const user = await sessionFromHeader(config.sessionSecret, socket.request.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
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
  });

  return {
    io,
    runtime: () => ({
      rooms: 0,
      players: io.of('/').sockets.size,
      sockets: io.engine.clientsCount,
    }),
    close: () => io.close().then(() => undefined),
  };
}
