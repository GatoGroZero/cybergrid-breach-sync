import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { authRouter, sameOrigin } from './auth';
import type { Config } from './config';
import type { Repo } from './db';
import type { Mailer } from './mailer';
import type { Metrics } from './metrics';
import { progressRouter } from './progress';
import { createStore, type Store } from './store';
import { testRouter, type RuntimeInfo } from './testApi';

export interface AppDeps {
  config: Config;
  repo: Repo;
  metrics: Metrics;
  runtime: () => RuntimeInfo;
  /** Envia los codigos de acceso por correo; sin el, el acceso por correo no se ofrece. */
  mailer?: Mailer | null;
  /** Donde se guardan las cuentas con correo y el progreso (si falta, se arma segun la configuracion). */
  store?: Store;
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const store = deps.store ?? createStore(config, deps.repo);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  if (config.trustCloudflare) {
    // Cloudflare siempre reescribe esta cabecera con la IP real del cliente, y el origen solo es
    // alcanzable a traves de el. Los limites de peticiones se aplican por cliente, no por nodo.
    app.use((req, _res, next) => {
      const real = req.headers['cf-connecting-ip'];
      if (typeof real === 'string' && isIP(real.trim()) !== 0) {
        Object.defineProperty(req, 'ip', { value: real.trim(), configurable: true });
      }
      next();
    });
  }

  // El socket solo puede abrirse hacia este mismo servidor (antes se permitia cualquier ws: y wss:,
  // y un script inyectado habria podido sacar datos por ahi). Safari antiguo no hace coincidir
  // 'self' con ws/wss, por eso se escribe la direccion explicita a partir de la cabecera Host.
  const production = config.env === 'production';
  const ownSocket = (req: IncomingMessage): string => {
    const host = String(req.headers.host ?? '');
    return /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)
      ? `${production ? 'wss' : 'ws'}://${host}`
      : "'self'";
  };

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", ownSocket],
          mediaSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          childSrc: ["'none'"],
          manifestSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(production ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Funciones del navegador que el juego no usa y que no debe poder pedir un script ajeno.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'bluetooth=()',
        'camera=()',
        'display-capture=()',
        'geolocation=()',
        'gyroscope=()',
        'hid=()',
        'magnetometer=()',
        'microphone=()',
        'midi=()',
        'payment=()',
        'serial=()',
        'usb=()',
        'xr-spatial-tracking=()',
      ].join(', '),
    );
    next();
  });

  app.use('/api/test', testRouter(deps));
  app.use('/api/auth', express.json({ limit: '4kb' }), sameOrigin, authRouter({ ...deps, store }));
  app.use('/api/progress', sameOrigin, progressRouter({ config, store }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'no_encontrado', mensaje: 'Ruta no encontrada' });
  });

  if (existsSync(config.staticDir)) {
    app.use(
      express.static(config.staticDir, {
        index: false,
        // /privacidad responde con privacidad.html.
        extensions: ['html'],
        setHeaders: (res, path) => {
          const hashed = path.includes('/assets/');
          res.setHeader(
            'Cache-Control',
            hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    const indexFile = join(config.staticDir, 'index.html');
    app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => {
      // Las rutas del juego no llevan extension. Pedir un archivo que no existe (.env, .git, .map...)
      // es un 404 de verdad, no la pagina principal con un 200 que confunde a los escaneres.
      if (/(^|\/)\.[^/]|\.[A-Za-z0-9]{1,8}$/.test(req.path)) {
        res.status(404).type('text/plain').send('No encontrado');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const id = randomUUID();
    const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
    // un JSON roto o un cuerpo enorme es culpa de quien lo manda: no llena el registro de errores
    if (status >= 500) console.error(`[error ${id}]`, err);
    if (res.headersSent) return;
    res.status(status).json({
      error: status === 500 ? 'error_interno' : 'peticion_invalida',
      mensaje: status === 500 ? 'Ocurrió un error en el servidor' : 'Petición inválida',
      id,
    });
  };
  app.use(onError);

  return app;
}
