import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { credentialsSchema, signinSchema, signupSchema } from '../shared/br/protocol';
import { nicknameSchema, randomNickname } from '../shared/nickname';
import { DEMO_USERS, type Config } from './config';
import type { Repo } from './db';
import { emailRouter } from './emailLogin';
import { googleRouter } from './google';
import type { Mailer } from './mailer';
import { publicUser, SESSION_COOKIE, sessionFromHeader, startSession } from './session';
import { StoreError, type Store } from './store';

export { SESSION_COOKIE, sessionFromHeader, type SessionUser } from './session';

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

/** Rechaza peticiones con cabecera Origin de otro sitio (defensa extra contra CSRF). */
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  // El navegador dice desde donde sale cada peticion (Sec-Fetch-Site) y un script ajeno no lo
  // puede cambiar: las que cambian algo solo valen si salen de esta misma pagina.
  const site = req.headers['sec-fetch-site'];
  const changes = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (changes && typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'origen_no_permitido', mensaje: 'Origen no permitido' });
    return;
  }
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

/**
 * Cuenta los fallos de acceso por cuenta, no solo por IP: quien prueba contrasenas desde muchas
 * direcciones distintas choca igual con el tope de la cuenta que ataca.
 */
export class FailureLog {
  private readonly hits = new Map<string, { n: number; since: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly cap = 20_000,
  ) {}

  private live(key: string, now: number): { n: number; since: number } | undefined {
    const hit = this.hits.get(key);
    if (hit && now - hit.since > this.windowMs) {
      this.hits.delete(key);
      return undefined;
    }
    return hit;
  }

  blocked(key: string, now = Date.now()): boolean {
    return (this.live(key, now)?.n ?? 0) >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const hit = this.live(key, now);
    if (hit) hit.n++;
    else {
      // tope de memoria: si se llena, se descartan las mas viejas
      if (this.hits.size >= this.cap) {
        for (const [k, v] of this.hits) {
          if (now - v.since > this.windowMs || this.hits.size >= this.cap) this.hits.delete(k);
          if (this.hits.size < this.cap * 0.9) break;
        }
      }
      this.hits.set(key, { n: 1, since: now });
    }
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}

function requireJson(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'se_requiere_json', mensaje: 'Se requiere application/json' });
    return;
  }
  next();
}

/** Lo que se guarda de una cuenta con correo. */
interface Account {
  /** Hash scrypt de la contrasena. */
  h: string;
  /** Apodo elegido. */
  n?: string;
  c: number;
}

const acctKey = (email: string): string => `acct:v1:${email}`;

export function authRouter(deps: {
  repo: Repo;
  config: Config;
  store: Store;
  mailer?: Mailer | null;
}): Router {
  const { repo, config, store } = deps;
  const mailer = deps.mailer ?? null;
  const router = Router();

  // Las respuestas de acceso nunca se guardan en cache del navegador ni de un intermediario.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use((req, res, next) => {
    if (req.method === 'POST') requireJson(req, res, next);
    else next();
  });
  // Tope general por IP para todo /api/auth, ademas de los de cada ruta.
  router.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.limits.api,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: 'demasiados_intentos',
        mensaje: 'Demasiadas peticiones, espera un momento',
      },
    }),
  );
  const accountFails = new FailureLog(config.limits.accountFails, 15 * 60 * 1000);

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
  const guestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.limits.guest,
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
  const disabled = (res: Response): void => {
    res
      .status(404)
      .json({ error: 'no_disponible', mensaje: 'Esta forma de entrar no está activa' });
  };

  /** Que formas de entrar ofrece este servidor: la pantalla de acceso se arma con esto. */
  router.get('/config', (_req, res) => {
    res.json({
      google: config.google !== null,
      email: config.email !== null && mailer !== null,
      guest: config.guestLogin,
      password: config.passwordAuth,
      durable: store.durable,
    });
  });

  if (config.google) router.use('/google', googleRouter(config, config.google));
  if (config.email && mailer) router.use('/email', emailRouter(config, mailer));

  router.post('/guest', guestLimiter, async (req, res) => {
    if (!config.guestLogin) return disabled(res);
    const wanted = (req.body as { nickname?: unknown } | undefined)?.nickname;
    let name = randomNickname();
    if (typeof wanted === 'string' && wanted.trim()) {
      const parsed = nicknameSchema.safeParse(wanted);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      name = parsed.data;
    }
    const sub = `guest:${randomBytes(12).toString('base64url')}`;
    const user = await startSession(res, config, { sub, name, provider: 'guest' });
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/nickname', async (req, res) => {
    const current = await sessionFromHeader(config.sessionSecret, req.headers.cookie);
    if (!current) {
      res.status(401).json({ error: 'sin_sesion', mensaje: 'No has iniciado sesión' });
      return;
    }
    const parsed = nicknameSchema.safeParse(
      (req.body as { nickname?: unknown } | undefined)?.nickname,
    );
    if (!parsed.success) return invalid(res, parsed.error.issues);
    // las cuentas con correo recuerdan su apodo para la proxima vez que entren
    if (current.provider === 'email' && current.sub.startsWith('email:')) {
      try {
        const key = acctKey(current.sub.slice('email:'.length));
        const raw = await store.get(key);
        if (raw)
          await store.set(key, JSON.stringify({ ...(JSON.parse(raw) as Account), n: parsed.data }));
      } catch {
        // si el almacen no responde, el apodo igual vale para esta sesion
      }
    }
    const user = await startSession(res, config, {
      sub: current.sub,
      name: parsed.data,
      provider: current.provider,
    });
    res.json({ user: publicUser(user) });
  });

  const unavailable = (res: Response): void => {
    res.status(503).json({
      error: 'almacen_no_disponible',
      mensaje: 'No pudimos guardar tu cuenta ahora, intenta en un momento',
    });
  };

  /** Crear una cuenta con correo y contrasena (con la contrasena repetida). */
  router.post('/signup', registerLimiter, async (req, res) => {
    if (!config.passwordAuth) return disabled(res);
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const { email, password } = parsed.data;
    try {
      const account: Account = { h: await hashPassword(password), c: Date.now() };
      const created = await store.setNx(acctKey(email), JSON.stringify(account));
      if (!created) {
        res.status(409).json({
          error: 'correo_en_uso',
          mensaje: 'Ese correo ya tiene una cuenta: inicia sesión',
        });
        return;
      }
    } catch (err) {
      if (err instanceof StoreError) return unavailable(res);
      throw err;
    }
    const user = await startSession(res, config, {
      sub: `email:${email}`,
      name: randomNickname(),
      provider: 'email',
    });
    res.status(201).json({ user: publicUser(user) });
  });

  /** Entrar con correo y contrasena (o con el usuario de una cuenta vieja). */
  router.post('/signin', loginLimiter, async (req, res) => {
    if (!config.passwordAuth) return disabled(res);
    const bad = (key: string | null): void => {
      if (key) accountFails.fail(key);
      res
        .status(401)
        .json({ error: 'credenciales_invalidas', mensaje: 'Correo o contraseña incorrectos' });
    };
    const parsed = signinSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(401)
        .json({ error: 'credenciales_invalidas', mensaje: 'Correo o contraseña incorrectos' });
      return;
    }
    const { identifier, password } = parsed.data;
    const key = identifier.toLowerCase();
    // Tope de fallos por cuenta (las de demostracion quedan fuera: todos conocen su clave y que
    // alguien las bloquee no debe dejar sin entrar a quien las revisa). Se decide antes de gastar
    // CPU en el hash o una consulta al almacen.
    const guarded = !(DEMO_USERS as readonly string[]).includes(key);
    if (guarded && accountFails.blocked(key)) {
      res.status(429).json({
        error: 'demasiados_intentos',
        mensaje: 'Demasiados intentos con esta cuenta, espera unos minutos',
      });
      return;
    }
    if (!identifier.includes('@')) {
      // cuentas de usuario y contrasena de antes (y las de demostracion)
      const row = repo.getUserByName(identifier);
      const ok = await verifyPassword(password, row?.pass_hash ?? (await getDummyHash()));
      if (!row || !ok) return bad(guarded ? key : null);
      accountFails.clear(key);
      const user = await startSession(res, config, {
        sub: `local:${row.id}`,
        name: row.username,
        provider: 'local',
      });
      res.json({ user: publicUser(user) });
      return;
    }
    let account: Account | null;
    try {
      const raw = await store.get(acctKey(key));
      account = raw ? (JSON.parse(raw) as Account) : null;
    } catch (err) {
      if (err instanceof StoreError) return unavailable(res);
      throw err;
    }
    const ok = await verifyPassword(password, account?.h ?? (await getDummyHash()));
    if (!account || !ok) return bad(key);
    accountFails.clear(key);
    const user = await startSession(res, config, {
      sub: `email:${key}`,
      name: account.n ?? randomNickname(),
      provider: 'email',
    });
    res.json({ user: publicUser(user) });
  });

  router.post('/register', registerLimiter, async (req, res) => {
    if (!config.passwordAuth) return disabled(res);
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
    const user = await startSession(res, config, {
      sub: `local:${id}`,
      name: username,
      provider: 'local',
    });
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    if (!config.passwordAuth) return disabled(res);
    const bad = (): void => {
      res
        .status(401)
        .json({ error: 'credenciales_invalidas', mensaje: 'Usuario o contraseña incorrectos' });
    };
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return bad();
    const { username, password } = parsed.data;
    const key = username.toLowerCase();
    const guarded = !(DEMO_USERS as readonly string[]).includes(key);
    if (guarded && accountFails.blocked(key)) {
      res.status(429).json({
        error: 'demasiados_intentos',
        mensaje: 'Demasiados intentos con esta cuenta, espera unos minutos',
      });
      return;
    }
    const row = repo.getUserByName(username);
    const ok = await verifyPassword(password, row?.pass_hash ?? (await getDummyHash()));
    if (!row || !ok) {
      if (guarded) accountFails.fail(key);
      return bad();
    }
    accountFails.clear(key);
    const user = await startSession(res, config, {
      sub: `local:${row.id}`,
      name: row.username,
      provider: 'local',
    });
    res.json({ user: publicUser(user) });
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
    res.json({ user: publicUser(user) });
  });

  return router;
}
