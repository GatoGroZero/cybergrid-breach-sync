import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { randomNickname, sanitizeNickname } from '../shared/nickname';
import type { Config } from './config';
import { loginCodeMail, type Mailer } from './mailer';
import { parseCookies, publicUser, startSession } from './session';

const OTP_COOKIE = 'cg_otp';
export const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const PER_EMAIL_MS = 10 * 60 * 1000;
const PER_EMAIL_MAX = 3;
const DAILY_MAX = 300;

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'El correo es demasiado largo')
  .email('Escribe un correo válido');

export const emailStartSchema = z.object({ email: emailField, nickname: z.string().optional() });
export const emailVerifySchema = z.object({
  email: emailField,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código tiene 6 números'),
});

interface Challenge {
  jti: string;
  hash: string;
  nick: string | null;
}

/**
 * Entrar con un codigo de 6 numeros que llega al correo. No guarda nada en el servidor:
 * el desafio viaja en una cookie firmada y solo contiene un HMAC del codigo, asi sigue
 * valiendo aunque el servidor reinicie y el codigo nunca queda en claro.
 */
export function emailRouter(config: Config, mailer: Mailer): Router {
  const router = Router();
  const key = new TextEncoder().encode(config.sessionSecret);
  const secure = config.env === 'production';

  const attempts = new Map<string, { count: number; exp: number }>();
  const spent = new Map<string, number>();
  const sentTo = new Map<string, number[]>();
  let day = { stamp: '', count: 0 };

  const prune = (now: number): void => {
    for (const [id, until] of spent) if (until < now) spent.delete(id);
    for (const [id, a] of attempts) if (a.exp < now) attempts.delete(id);
    for (const [mail, times] of sentTo) {
      const recent = times.filter((t) => now - t < PER_EMAIL_MS);
      if (recent.length) sentTo.set(mail, recent);
      else sentTo.delete(mail);
    }
  };

  const mac = (email: string, code: string, jti: string): string =>
    createHmac('sha256', config.sessionSecret).update(`otp|${email}|${code}|${jti}`).digest('hex');

  const tooMany = {
    error: 'demasiados_intentos',
    mensaje: 'Demasiados intentos, espera unos minutos',
  };
  const sendLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.limits.emailSend,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany,
  });
  const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.limits.emailVerify,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany,
  });

  const bad = (res: Response, mensaje: string, error = 'datos_invalidos', status = 400): void => {
    res.status(status).json({ error, mensaje });
  };
  const clearOtp = (res: Response): void => {
    res.clearCookie(OTP_COOKIE, {
      path: '/api/auth/email',
      secure,
      httpOnly: true,
      sameSite: 'lax',
    });
  };

  /** Lee la cookie del desafio; `null` si falta, esta alterada o ya caduco. */
  const openChallenge = async (
    raw: string | undefined,
  ): Promise<{ challenge: Challenge; exp: number } | null> => {
    if (!raw) return null;
    try {
      const { payload } = await jwtVerify(raw, key, { algorithms: ['HS256'] });
      const challenge = payload as unknown as Challenge;
      if (!challenge.jti || !challenge.hash) return null;
      return { challenge, exp: (payload.exp ?? 0) * 1000 };
    } catch {
      return null;
    }
  };

  router.post('/start', sendLimiter, async (req: Request, res: Response) => {
    const parsed = emailStartSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues[0]?.message ?? 'Datos inválidos');
    const { email } = parsed.data;
    const now = Date.now();
    prune(now);

    const today = new Date(now).toISOString().slice(0, 10);
    if (day.stamp !== today) day = { stamp: today, count: 0 };
    const recent = sentTo.get(email) ?? [];
    if (day.count >= DAILY_MAX || recent.length >= PER_EMAIL_MAX)
      return bad(res, tooMany.mensaje, tooMany.error, 429);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const jti = randomBytes(12).toString('base64url');
    const challenge: Challenge = {
      jti,
      hash: mac(email, code, jti),
      nick: sanitizeNickname(parsed.data.nickname),
    };
    try {
      await mailer.send(loginCodeMail(email, code, OTP_MINUTES));
    } catch (err) {
      console.error('no se pudo enviar el codigo por correo:', (err as Error).message);
      return bad(
        res,
        'No pudimos enviar el correo, intenta de nuevo en un momento',
        'correo_no_enviado',
        502,
      );
    }
    day.count++;
    sentTo.set(email, [...recent, now]);

    const token = await new SignJWT({ ...challenge })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${OTP_MINUTES}m`)
      .sign(key);
    res.cookie(OTP_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: OTP_MINUTES * 60 * 1000,
      path: '/api/auth/email',
    });
    res.json({ ok: true, minutos: OTP_MINUTES });
  });

  router.post('/verify', verifyLimiter, async (req: Request, res: Response) => {
    const parsed = emailVerifySchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues[0]?.message ?? 'Datos inválidos');
    const { email, code } = parsed.data;
    const expired = (): void => bad(res, 'El código venció, pide uno nuevo', 'codigo_vencido', 401);

    const opened = await openChallenge(parseCookies(req.headers.cookie)[OTP_COOKIE]);
    if (!opened) return expired();
    const { challenge, exp } = opened;
    const now = Date.now();
    prune(now);
    if (spent.has(challenge.jti)) return expired();

    const tries = attempts.get(challenge.jti) ?? { count: 0, exp };
    if (tries.count >= MAX_ATTEMPTS) {
      clearOtp(res);
      return bad(res, 'Demasiados intentos con este código, pide uno nuevo', 'codigo_agotado', 429);
    }
    const expected = Buffer.from(challenge.hash, 'hex');
    const given = Buffer.from(mac(email, code, challenge.jti), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      attempts.set(challenge.jti, { count: tries.count + 1, exp });
      return bad(res, 'Ese código no es correcto', 'codigo_incorrecto', 401);
    }

    spent.set(challenge.jti, exp);
    attempts.delete(challenge.jti);
    clearOtp(res);
    // El correo no se guarda ni se muestra: la identidad es su huella con sal del servidor.
    const sub = `email:${createHash('sha256').update(`${config.sessionSecret}|${email}`).digest('hex').slice(0, 32)}`;
    const user = await startSession(res, config, {
      sub,
      name: challenge.nick ?? randomNickname(),
      provider: 'email',
    });
    res.json({ user: publicUser(user) });
  });

  return router;
}
