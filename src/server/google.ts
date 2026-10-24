import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { randomNickname, sanitizeNickname } from '../shared/nickname';
import type { Config, GoogleConfig } from './config';
import { parseCookies, startSession } from './session';

const OAUTH_COOKIE = 'cg_oauth';
const OAUTH_MINUTES = 10;
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CALLBACK_PATH = '/api/auth/google/callback';

const b64url = (buf: Buffer): string => buf.toString('base64url');
const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

function sameText(a: string, b: string): boolean {
  const x = sha256(a);
  const y = sha256(b);
  return timingSafeEqual(x, y);
}

/** Direccion a la que Google devuelve al jugador. En produccion sale de la configuracion, nunca de la cabecera Host. */
export function googleRedirectUri(config: Config, req: Request): string {
  const base = config.publicUrl ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  return `${base}${CALLBACK_PATH}`;
}

interface OauthState {
  state: string;
  nonce: string;
  verifier: string;
  nick: string | null;
}

/**
 * Inicio de sesion con Google por el flujo de codigo en el servidor (con PKCE, state y nonce).
 * El navegador nunca ve el secreto del cliente ni el token de Google, y la politica CSP
 * no necesita abrirse a scripts de terceros.
 */
export function googleRouter(config: Config, google: GoogleConfig): Router {
  const router = Router();
  const jwks = createRemoteJWKSet(new URL(google.jwksUrl), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
  });
  const key = new TextEncoder().encode(config.sessionSecret);
  const secure = config.env === 'production';

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.limits.oauth,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.redirect('/login?error=demasiados_intentos'),
  });

  const clearOauth = (res: Response): void => {
    res.clearCookie(OAUTH_COOKIE, {
      path: '/api/auth/google',
      secure,
      httpOnly: true,
      sameSite: 'lax',
    });
  };
  const fail = (res: Response, code: string): void => {
    clearOauth(res);
    res.redirect(`/login?error=${code}`);
  };

  router.get('/start', limiter, async (req, res) => {
    const nick = sanitizeNickname(req.query.apodo);
    const flow: OauthState = {
      state: b64url(randomBytes(24)),
      nonce: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(32)),
      nick,
    };
    const token = await new SignJWT({ ...flow })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${OAUTH_MINUTES}m`)
      .sign(key);
    // Lax: la cookie viaja en el regreso de Google (navegacion de primer nivel) y en nada mas.
    res.cookie(OAUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: OAUTH_MINUTES * 60 * 1000,
      path: '/api/auth/google',
    });
    const url = new URL(google.authUrl);
    url.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: googleRedirectUri(config, req),
      response_type: 'code',
      scope: 'openid profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: b64url(sha256(flow.verifier)),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    res.redirect(url.toString());
  });

  router.get('/callback', limiter, async (req, res) => {
    if (typeof req.query.error === 'string') return fail(res, 'google_cancelado');
    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== 'string' || typeof state !== 'string' || code.length > 2048)
      return fail(res, 'google_fallo');

    const raw = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    let flow: OauthState;
    try {
      if (!raw) throw new Error('sin cookie');
      const { payload } = await jwtVerify(raw, key, { algorithms: ['HS256'] });
      flow = payload as unknown as OauthState;
      if (!flow.state || !flow.nonce || !flow.verifier) throw new Error('cookie incompleta');
    } catch {
      return fail(res, 'google_fallo');
    }
    // El state liga la respuesta de Google con el navegador que empezo el flujo (anti CSRF).
    if (!sameText(state, flow.state)) return fail(res, 'google_fallo');

    try {
      const tokenRes = await fetch(google.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: googleRedirectUri(config, req),
          code_verifier: flow.verifier,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await tokenRes.json().catch(() => ({}))) as { id_token?: unknown };
      if (!tokenRes.ok || typeof body.id_token !== 'string') {
        console.warn(`Google rechazo el codigo (HTTP ${tokenRes.status})`);
        return fail(res, 'google_fallo');
      }
      const { payload } = await jwtVerify(body.id_token, jwks, {
        issuer: ISSUERS,
        audience: google.clientId,
        algorithms: ['RS256'],
      });
      if (typeof payload.sub !== 'string' || !payload.sub) return fail(res, 'google_fallo');
      if (typeof payload.nonce !== 'string' || !sameText(payload.nonce, flow.nonce))
        return fail(res, 'google_fallo');

      const name =
        flow.nick ??
        sanitizeNickname(payload.given_name) ??
        sanitizeNickname(payload.name) ??
        randomNickname();
      clearOauth(res);
      await startSession(res, config, { sub: `google:${payload.sub}`, name, provider: 'google' });
      res.redirect('/');
    } catch (err) {
      console.warn('no se pudo validar el inicio de sesion de Google:', (err as Error).message);
      fail(res, 'google_fallo');
    }
  });

  return router;
}
