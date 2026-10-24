import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import type { Config } from './config';

export const SESSION_COOKIE = 'cg_session';

export type Provider = 'google' | 'email' | 'guest' | 'local';

/** Quien es el jugador: lo unico que el juego necesita saber. */
export interface SessionUser {
  id: number;
  username: string;
  provider: Provider;
  /** Identidad del proveedor; no sale del servidor. */
  sub: string;
}

/** Identidad ya verificada por un proveedor: `sub` es estable y no cambia entre dispositivos. */
export interface Identity {
  sub: string;
  name: string;
  provider: Provider;
}

const PROVIDERS: readonly Provider[] = ['google', 'email', 'guest', 'local'];
/** Los ids derivados del proveedor empiezan aqui, lejos de los ids pequenos de la base local. */
const ID_FLOOR = 1_000_000;
const ID_SPAN = 2n ** 52n - BigInt(ID_FLOOR);

/**
 * El id numerico del juego sale de la identidad, no de una tabla: asi sigue siendo el mismo
 * aunque el servidor reinicie o se borre el disco (en el plan gratuito no es permanente).
 */
export function userIdFor(sub: string): number {
  const local = /^(?:local:)?(\d{1,15})$/.exec(sub);
  if (local) return Number(local[1]);
  const digest = createHash('sha256').update(sub).digest('hex').slice(0, 14);
  return Number(BigInt(`0x${digest}`) % ID_SPAN) + ID_FLOOR;
}

export function providerOfSub(sub: string): Provider {
  const prefix = sub.split(':', 1)[0] as Provider;
  return PROVIDERS.includes(prefix) && sub.includes(':') ? prefix : 'local';
}

const secretKey = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export async function createSessionToken(
  secret: string,
  identity: Identity,
  days: number,
): Promise<string> {
  return new SignJWT({ name: identity.name, prv: identity.provider })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.sub)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secretKey(secret));
}

export async function readSessionToken(
  secret: string,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    const sub = payload.sub;
    const name = payload.name;
    if (typeof sub !== 'string' || typeof name !== 'string') return null;
    const id = userIdFor(sub);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { id, username: name, provider: providerOfSub(sub), sub };
  } catch {
    return null;
  }
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

export function sessionFromHeader(
  secret: string,
  cookieHeader: string | undefined,
): Promise<SessionUser | null> {
  return readSessionToken(secret, parseCookies(cookieHeader)[SESSION_COOKIE]);
}

/** Crea la cookie de sesion: solo HTTP, mismo sitio y con Secure en produccion. */
export async function startSession(
  res: Response,
  config: Config,
  identity: Identity,
): Promise<SessionUser> {
  const token = await createSessionToken(config.sessionSecret, identity, config.sessionDays);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return {
    id: userIdFor(identity.sub),
    username: identity.name,
    provider: identity.provider,
    sub: identity.sub,
  };
}

/** Lo que el navegador puede ver de quien inicio sesion. */
export function publicUser(user: SessionUser): {
  id: number;
  username: string;
  provider: Provider;
} {
  return { id: user.id, username: user.username, provider: user.provider };
}
