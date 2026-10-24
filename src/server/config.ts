import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { TICK_HZ as SIM_HZ } from '../shared/br/constants';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
}

export interface EmailConfig {
  /** `console` solo existe fuera de produccion: imprime el codigo en vez de mandar correo. */
  provider: 'resend' | 'brevo' | 'console';
  apiKey: string;
  /** Direccion verificada desde la que salen los codigos. */
  from: string;
  fromName: string;
}

export interface Config {
  env: 'production' | 'development' | 'test';
  port: number;
  dbPath: string;
  sessionSecret: string;
  staticDir: string;
  testEndpoints: boolean;
  demoAccounts: boolean;
  /** Entrar con usuario y contrasena (cuentas locales). Apagarlo deja solo Google, correo e invitado. */
  passwordAuth: boolean;
  /** Entrar como invitado, sin cuenta. */
  guestLogin: boolean;
  /** Direccion publica del sitio (para el regreso de Google). En Render la pone la plataforma. */
  publicUrl: string | null;
  /** Dias que dura la sesion. */
  sessionDays: number;
  google: GoogleConfig | null;
  email: EmailConfig | null;
  trustProxy: number | boolean;
  /** Detras de Cloudflare (Render) la IP real viene en CF-Connecting-IP. */
  trustCloudflare: boolean;
  tickHz: number;
  snapshotEvery: number;
  countdownSeconds: number;
  /** Acelera la ola (solo pruebas): 1 es el ritmo real. */
  zoneTimeScale: number;
  /** Segundos de celebracion (fuegos artificiales) antes de la tabla de resultados. */
  celebrationSeconds: number;
  /** Solo pruebas: los humanos arrancan con un fusil, botiquines, escudos y muros. */
  testKit: boolean;
  version: string;
  limits: {
    login: number;
    register: number;
    guest: number;
    oauth: number;
    emailSend: number;
    emailVerify: number;
    seed: number;
    telemetry: number;
  };
}

export const DEMO_PASSWORD = 'CyberGrid26';
export const DEMO_USERS = ['demo1', 'demo2', 'demo3', 'demo4'] as const;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value !== 'false' && value !== '0';
}

/** Quita comillas y espacios que se cuelan al pegar un valor en el panel de la plataforma. */
function unquote(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

/**
 * El ID de cliente de Google es siempre `<numeros>-<texto>.apps.googleusercontent.com`. Al copiarlo
 * a veces se pega como enlace (`http://...com/`): se deja solo el ID.
 */
export function cleanGoogleClientId(raw: string | undefined): string {
  const value = unquote(raw);
  return /[0-9A-Za-z_-]+\.apps\.googleusercontent\.com/.exec(value)?.[0] ?? value;
}

function loadGoogle(): GoogleConfig | null {
  const clientId = cleanGoogleClientId(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = unquote(process.env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  };
}

function loadEmail(env: Config['env']): EmailConfig | null {
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const from = process.env.EMAIL_FROM?.trim() ?? '';
  const apiKey = process.env.EMAIL_API_KEY?.trim() ?? '';
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || 'CyberGrid Gato Royale';
  if (provider === 'console' && env !== 'production')
    return { provider: 'console', apiKey: '', from: 'no-reply@localhost', fromName };
  if ((provider === 'resend' || provider === 'brevo') && apiKey && from)
    return { provider, apiKey, from, fromName };
  return null;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export type ConfigOverrides = Omit<Partial<Config>, 'limits'> & {
  limits?: Partial<Config['limits']>;
};

export function loadConfig(overrides: ConfigOverrides = {}): Config {
  const env = (process.env.NODE_ENV as Config['env'] | undefined) ?? 'development';
  const secret = process.env.SESSION_SECRET;
  if (env === 'production' && !secret) {
    throw new Error('SESSION_SECRET es obligatorio en produccion');
  }
  const base: Config = {
    env,
    port: int(process.env.PORT, 3000),
    dbPath: process.env.DB_PATH ?? resolve('data/cybergrid.db'),
    sessionSecret: secret ?? randomBytes(32).toString('hex'),
    staticDir: process.env.STATIC_DIR ?? resolve('dist/client'),
    testEndpoints: process.env.ENABLE_TEST_ENDPOINTS !== 'false',
    demoAccounts: process.env.DEMO_ACCOUNTS !== 'false',
    passwordAuth: bool(process.env.PASSWORD_AUTH, true),
    guestLogin: bool(process.env.GUEST_LOGIN, true),
    publicUrl:
      (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL)?.replace(/\/+$/, '') || null,
    sessionDays: Math.min(90, Math.max(1, int(process.env.SESSION_DAYS, 30))),
    google: loadGoogle(),
    email: loadEmail(env),
    trustProxy: int(process.env.TRUST_PROXY, env === 'production' ? 2 : 0),
    trustCloudflare: process.env.TRUST_CLOUDFLARE
      ? process.env.TRUST_CLOUDFLARE === 'true'
      : env === 'production',
    tickHz: SIM_HZ,
    snapshotEvery: Math.max(1, int(process.env.SNAPSHOT_EVERY, 1)),
    countdownSeconds: Math.max(1, int(process.env.COUNTDOWN_SECONDS, 3)),
    testKit: process.env.TEST_KIT === 'true' && env !== 'production',
    celebrationSeconds: Math.min(20, Math.max(0, int(process.env.CELEBRATION_SECONDS, 7))),
    zoneTimeScale: Math.min(60, Math.max(1, int(process.env.ZONE_TIME_SCALE, 1))),
    version: '2.2.0',
    limits: {
      login: int(process.env.LIMIT_LOGIN, 30),
      register: int(process.env.LIMIT_REGISTER, 30),
      guest: int(process.env.LIMIT_GUEST, 40),
      oauth: int(process.env.LIMIT_OAUTH, 40),
      emailSend: int(process.env.LIMIT_EMAIL_SEND, 8),
      emailVerify: int(process.env.LIMIT_EMAIL_VERIFY, 30),
      seed: int(process.env.LIMIT_SEED, 60),
      telemetry: int(process.env.LIMIT_TELEMETRY, 600),
    },
  };
  return { ...base, ...overrides, limits: { ...base.limits, ...overrides.limits } };
}
