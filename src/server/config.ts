import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { SIM_HZ } from '../shared/constants';

export interface Config {
  env: 'production' | 'development' | 'test';
  port: number;
  dbPath: string;
  sessionSecret: string;
  staticDir: string;
  testEndpoints: boolean;
  demoAccounts: boolean;
  trustProxy: number | boolean;
  /** Detras de Cloudflare (Render) la IP real viene en CF-Connecting-IP. */
  trustCloudflare: boolean;
  tickHz: number;
  snapshotEvery: number;
  countdownSeconds: number;
  version: string;
  limits: {
    login: number;
    register: number;
    seed: number;
    telemetry: number;
  };
}

export const DEMO_PASSWORD = 'CyberGrid26';
export const DEMO_USERS = ['demo1', 'demo2', 'demo3', 'demo4'] as const;

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
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
    trustProxy: int(process.env.TRUST_PROXY, env === 'production' ? 2 : 0),
    trustCloudflare: process.env.TRUST_CLOUDFLARE
      ? process.env.TRUST_CLOUDFLARE === 'true'
      : env === 'production',
    tickHz: SIM_HZ,
    snapshotEvery: Math.max(1, int(process.env.SNAPSHOT_EVERY, 1)),
    countdownSeconds: Math.max(1, int(process.env.COUNTDOWN_SECONDS, 3)),
    version: '1.0.0',
    limits: {
      login: int(process.env.LIMIT_LOGIN, 30),
      register: int(process.env.LIMIT_REGISTER, 30),
      seed: int(process.env.LIMIT_SEED, 60),
      telemetry: int(process.env.LIMIT_TELEMETRY, 600),
    },
  };
  return { ...base, ...overrides, limits: { ...base.limits, ...overrides.limits } };
}
