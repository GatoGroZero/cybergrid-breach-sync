import type { Config } from './config';
import type { Repo } from './db';

/**
 * Almacen de datos que no pueden perderse: las cuentas de correo y el progreso de la Aventura.
 * El disco de Render gratis se borra en cada despliegue y reinicio, asi que en produccion esto vive
 * en un Redis externo (Upstash, por su API REST: sin dependencias nuevas). En local y en las
 * pruebas se usa la base SQLite.
 */
export interface Store {
  /** Si lo guardado sobrevive a un reinicio del servidor. */
  readonly durable: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Guarda solo si la clave no existe. Devuelve false si ya estaba. */
  setNx(key: string, value: string): Promise<boolean>;
}

export class StoreError extends Error {}

/** Respaldo en la base SQLite (dura mientras dure el disco). */
export class SqliteStore implements Store {
  readonly durable = false;
  constructor(private readonly repo: Repo) {}
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.repo.kvGet(key));
  }
  set(key: string, value: string): Promise<void> {
    this.repo.kvSet(key, value);
    return Promise.resolve();
  }
  setNx(key: string, value: string): Promise<boolean> {
    return Promise.resolve(this.repo.kvSetNx(key, value));
  }
}

export interface UpstashConfig {
  url: string;
  token: string;
}

/** Redis de Upstash por REST: cada comando es un POST con el comando como lista. */
export class UpstashStore implements Store {
  readonly durable = true;
  constructor(
    private readonly cfg: UpstashConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async run(command: (string | number)[]): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetcher(this.cfg.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new StoreError('almacen_sin_respuesta');
    }
    if (!res.ok) throw new StoreError(`almacen_${res.status}`);
    // una respuesta ilegible no puede tomarse por "no existe": se podria pisar un guardado real
    const data = (await res.json().catch(() => null)) as {
      result?: unknown;
      error?: unknown;
    } | null;
    if (!data || data.error) throw new StoreError('almacen_error');
    return data.result ?? null;
  }

  async get(key: string): Promise<string | null> {
    const out = await this.run(['GET', key]);
    return typeof out === 'string' ? out : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.run(['SET', key, value]);
  }

  async setNx(key: string, value: string): Promise<boolean> {
    return (await this.run(['SET', key, value, 'NX'])) === 'OK';
  }
}

export function createStore(config: Config, repo: Repo): Store {
  return config.upstash ? new UpstashStore(config.upstash) : new SqliteStore(repo);
}
