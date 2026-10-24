import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { jwtVerify, SignJWT } from 'jose';
import { credentialsSchema } from '../shared/br/protocol';
import type { Config } from './config';
import type { Repo } from './db';

export const SESSION_COOKIE = 'cg_session';
const SESSION_DAYS = 7;

export interface SessionUser {
  id: number;
  username: string;
}

// scrypt con N=2^15 usa ~32 MiB. Se limita a 2 hashes simultaneos para que un pico de logins
// no deje sin CPU al bucle del juego en una instancia pequena.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 } as const;

class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const hashSlots = new Semaphore(2);

function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function hashPassword(password: string): Promise<string> {
  return hashSlots.run(async () => {
    const salt = randomBytes(16);
    const key = await deriveKey(password, salt, SCRYPT.keylen, {
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      maxmem: SCRYPT.maxmem,
    });
    return [
      'scrypt',
      SCRYPT.N,
      SCRYPT.r,
      SCRYPT.p,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return hashSlots.run(async () => {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
    const expected = Buffer.from(keyB64, 'base64');
    const key = await deriveKey(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  });
}

let dummyHash: Promise<string> | null = null;
/** Hash falso para que un usuario inexistente tarde lo mismo que uno real al iniciar sesion. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
  return dummyHash;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key && !(key in out)) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

const secretKey = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export async function createSessionToken(secret: string, user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey(secret));
}

export async function readSessionToken(
  secret: string,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    const name = payload.name;
    if (!Number.isInteger(id) || typeof name !== 'string') return null;
    return { id, username: name };
  } catch {
    return null;
  }
}

export function sessionFromHeader(
  secret: string,
  cookieHeader: string | undefined,
): Promise<SessionUser | null> {
  return readSessionToken(secret, parseCookies(cookieHeader)[SESSION_COOKIE]);
}

function setSessionCookie(res: Response, config: Config, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/** Rechaza peticiones con cabecera Origin de otro sitio (defensa extra contra CSRF). */
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  try {
    if (new URL(origin).host === req.headers.host) {
      next();
      return;
    }
  } catch {
    // origen mal formado: se rechaza abajo
  }
  res.status(403).json({ error: 'origen_no_permitido', mensaje: 'Origen no permitido' });
}

function requireJson(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'se_requiere_json', mensaje: 'Se requiere application/json' });
    return;
  }
  next();
}

export function authRouter(deps: { repo: Repo; config: Config }): Router {
  const { repo, config } = deps;
  const router = Router();

  const tooMany = {
    error: 'demasiados_intentos',
    mensaje: 'Demasiados intentos, espera unos minutos',
  };
  // Solo cuentan los intentos fallidos de login, asi un uso normal nunca se bloquea.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.limits.login,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany,
  });
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.limits.register,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany,
  });

  const invalid = (res: Response, issues: { path: PropertyKey[]; message: string }[]): void => {
    res.status(400).json({
      error: 'datos_invalidos',
      mensaje: issues[0]?.message ?? 'Datos inválidos',
      detalles: issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    });
  };

  router.post('/register', registerLimiter, requireJson, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const { username, password } = parsed.data;
    if (repo.getUserByName(username)) {
      res.status(409).json({ error: 'usuario_en_uso', mensaje: 'Ese usuario ya existe' });
      return;
    }
    const id = repo.createUser(username, await hashPassword(password));
    if (id === null) {
      res.status(409).json({ error: 'usuario_en_uso', mensaje: 'Ese usuario ya existe' });
      return;
    }
    setSessionCookie(res, config, await createSessionToken(config.sessionSecret, { id, username }));
    res.status(201).json({ user: { id, username } });
  });

  router.post('/login', loginLimiter, requireJson, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(401)
        .json({ error: 'credenciales_invalidas', mensaje: 'Usuario o contraseña incorrectos' });
      return;
    }
    const { username, password } = parsed.data;
    const row = repo.getUserByName(username);
    const ok = await verifyPassword(password, row?.pass_hash ?? (await getDummyHash()));
    if (!row || !ok) {
      res
        .status(401)
        .json({ error: 'credenciales_invalidas', mensaje: 'Usuario o contraseña incorrectos' });
      return;
    }
    const user = { id: row.id, username: row.username };
    setSessionCookie(res, config, await createSessionToken(config.sessionSecret, user));
    res.json({ user });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    const user = await sessionFromHeader(config.sessionSecret, req.headers.cookie);
    if (!user) {
      res.status(401).json({ error: 'sin_sesion', mensaje: 'No has iniciado sesión' });
      return;
    }
    res.json({ user });
  });

  return router;
}
