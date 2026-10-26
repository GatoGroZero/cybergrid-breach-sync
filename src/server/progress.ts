import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { newest, parseSave, type MetaSave } from '../shared/br/progress';
import type { Config } from './config';
import { sessionFromHeader } from './session';
import { StoreError, type Store } from './store';

const saveSchema = z.object({ save: z.unknown() });

const keyOf = (sub: string): string => `prog:v1:${sub}`;

/**
 * Progreso de la Aventura por cuenta (Google o correo). Los invitados y las cuentas viejas de
 * usuario no tienen donde guardarlo de forma duradera: ellos lo conservan solo en su navegador.
 */
export function progressRouter(deps: { config: Config; store: Store }): Router {
  const { config, store } = deps;
  const router = Router();
  router.use(express.json({ limit: '4kb' }));
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'demasiados_intentos', mensaje: 'Demasiados intentos, espera un momento' },
    }),
  );

  const who = async (
    cookie: string | undefined,
  ): Promise<{ key: string } | { status: number; error: string }> => {
    const user = await sessionFromHeader(config.sessionSecret, cookie);
    if (!user) return { status: 401, error: 'sin_sesion' };
    if (user.provider !== 'google' && user.provider !== 'email')
      return { status: 403, error: 'sin_guardado' };
    return { key: keyOf(user.sub) };
  };
  const fail = (res: express.Response, status: number, error: string): void => {
    res.status(status).json({ error, mensaje: 'No se pudo usar el guardado de tu progreso' });
  };

  router.get('/', async (req, res) => {
    const who1 = await who(req.headers.cookie);
    if ('error' in who1) return fail(res, who1.status, who1.error);
    try {
      const raw = await store.get(who1.key);
      res.json({ save: raw ? parseSave(JSON.parse(raw)) : null, durable: store.durable });
    } catch (err) {
      if (err instanceof StoreError) return fail(res, 503, 'almacen_no_disponible');
      throw err;
    }
  });

  router.put('/', async (req, res) => {
    const who1 = await who(req.headers.cookie);
    if ('error' in who1) return fail(res, who1.status, who1.error);
    const body = saveSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'datos_invalidos');
    const incoming = parseSave(body.data.save);
    try {
      const raw = await store.get(who1.key);
      const current: MetaSave | null = raw ? parseSave(JSON.parse(raw)) : null;
      // si el servidor ya tiene algo mas nuevo, no se pisa: se devuelve para que el navegador lo tome
      if (
        current &&
        newest(current, incoming) === current &&
        current.updatedAt !== incoming.updatedAt
      ) {
        res.status(409).json({ save: current, durable: store.durable });
        return;
      }
      await store.set(who1.key, JSON.stringify(incoming));
      res.json({ save: incoming, durable: store.durable });
    } catch (err) {
      if (err instanceof StoreError) return fail(res, 503, 'almacen_no_disponible');
      throw err;
    }
  });

  return router;
}
