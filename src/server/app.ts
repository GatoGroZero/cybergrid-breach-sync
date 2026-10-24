import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { authRouter, sameOrigin } from './auth';
import type { Config } from './config';
import type { Repo } from './db';
import type { Mailer } from './mailer';
import type { Metrics } from './metrics';
import { testRouter, type RuntimeInfo } from './testApi';

export interface AppDeps {
  config: Config;
  repo: Repo;
  metrics: Metrics;
  runtime: () => RuntimeInfo;
  /** Envia los codigos de acceso por correo; sin el, el acceso por correo no se ofrece. */
  mailer?: Mailer | null;
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
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

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          mediaSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use('/api/test', testRouter(deps));
  app.use('/api/auth', express.json({ limit: '4kb' }), sameOrigin, authRouter(deps));

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
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const id = randomUUID();
    console.error(`[error ${id}]`, err);
    if (res.headersSent) return;
    const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
    res.status(status).json({
      error: status === 500 ? 'error_interno' : 'peticion_invalida',
      mensaje: status === 500 ? 'Ocurrió un error en el servidor' : 'Petición inválida',
      id,
    });
  };
  app.use(onError);

  return app;
}
