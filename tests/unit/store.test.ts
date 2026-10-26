import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { Repo } from '../../src/server/db';
import { createStore, SqliteStore, StoreError, UpstashStore } from '../../src/server/store';

const CFG = { url: 'https://cybergrid-123.upstash.io', token: 'token-de-prueba' };

type Call = { url: string; headers: Record<string, string>; command: (string | number)[] };

/** Un Redis de Upstash de mentira: guarda en un Map y entiende GET, SET y SET NX. */
function fakeUpstash(): { fetcher: typeof fetch; calls: Call[]; data: Map<string, string> } {
  const data = new Map<string, string>();
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as (string | number)[];
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      command,
    });
    const [name, key, value, flag] = command as [string, string, string, string?];
    let result: string | null = null;
    if (name === 'GET') result = data.get(key) ?? null;
    else if (name === 'SET') {
      if (flag === 'NX' && data.has(key)) result = null;
      else {
        data.set(key, value);
        result = 'OK';
      }
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls, data };
}

describe('almacen con Upstash (API REST)', () => {
  it('guarda y lee con comandos de Redis y la llave en la cabecera', async () => {
    const up = fakeUpstash();
    const store = new UpstashStore(CFG, up.fetcher);
    expect(store.durable).toBe(true);
    expect(await store.get('acct:v1:a@b.com')).toBeNull();
    await store.set('acct:v1:a@b.com', '{"h":"x"}');
    expect(await store.get('acct:v1:a@b.com')).toBe('{"h":"x"}');
    expect(up.calls.map((c) => c.command[0])).toEqual(['GET', 'SET', 'GET']);
    expect(up.calls[0]?.url).toBe(CFG.url);
    expect(up.calls[0]?.headers.Authorization).toBe('Bearer token-de-prueba');
    expect(up.calls[1]?.command).toEqual(['SET', 'acct:v1:a@b.com', '{"h":"x"}']);
  });

  it('SET NX solo guarda si la clave no existia', async () => {
    const store = new UpstashStore(CFG, fakeUpstash().fetcher);
    expect(await store.setNx('k', 'uno')).toBe(true);
    expect(await store.setNx('k', 'dos')).toBe(false);
    expect(await store.get('k')).toBe('uno');
  });

  it('una respuesta 500, un error de Redis o un fallo de red se vuelven StoreError', async () => {
    const make = (impl: () => Promise<Response>): UpstashStore =>
      new UpstashStore(CFG, (() => impl()) as typeof fetch);

    const caido = make(() => Promise.resolve(new Response('boom', { status: 500 })));
    await expect(caido.get('k')).rejects.toBeInstanceOf(StoreError);

    const sinPermiso = make(() => Promise.resolve(new Response('{}', { status: 401 })));
    await expect(sinPermiso.set('k', 'v')).rejects.toBeInstanceOf(StoreError);

    const conError = make(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'ERR syntax' }), { status: 200 })),
    );
    await expect(conError.setNx('k', 'v')).rejects.toBeInstanceOf(StoreError);

    const sinRed = make(() => Promise.reject(new TypeError('fetch failed')));
    await expect(sinRed.get('k')).rejects.toBeInstanceOf(StoreError);
  });

  it('si el almacen no contesta a tiempo se corta con StoreError', async () => {
    const colgado = new UpstashStore(
      CFG,
      ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('t', 'TimeoutError')),
          );
        })) as unknown as typeof fetch,
    );
    vi.useFakeTimers();
    try {
      const pending = colgado.get('k');
      const assertion = expect(pending).rejects.toBeInstanceOf(StoreError);
      await vi.advanceTimersByTimeAsync(5100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('una respuesta que no es JSON no se toma por "no existe" (podria pisar un guardado real)', async () => {
    const raro = new UpstashStore(CFG, (() =>
      Promise.resolve(new Response('no es json', { status: 200 }))) as typeof fetch);
    await expect(raro.get('k')).rejects.toBeInstanceOf(StoreError);
  });
});

describe('almacen de respaldo en SQLite', () => {
  it('guarda, lee y respeta SET NX', async () => {
    const repo = new Repo(':memory:');
    const store = new SqliteStore(repo);
    expect(store.durable).toBe(false);
    expect(await store.get('k')).toBeNull();
    expect(await store.setNx('k', 'uno')).toBe(true);
    expect(await store.setNx('k', 'dos')).toBe(false);
    await store.set('k', 'tres');
    expect(await store.get('k')).toBe('tres');
    repo.close();
  });
});

describe('eleccion del almacen segun la configuracion', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sin variables de Upstash usa SQLite', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const config = loadConfig({ env: 'test', dbPath: ':memory:' });
    expect(config.upstash).toBeNull();
    const repo = new Repo(':memory:');
    expect(createStore(config, repo)).toBeInstanceOf(SqliteStore);
    repo.close();
  });

  it('con las dos variables usa Upstash y le quita la diagonal final a la direccion', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://cybergrid-123.upstash.io/');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ' token-de-prueba ');
    const config = loadConfig({ env: 'test', dbPath: ':memory:' });
    expect(config.upstash).toEqual({
      url: 'https://cybergrid-123.upstash.io',
      token: 'token-de-prueba',
    });
    const repo = new Repo(':memory:');
    expect(createStore(config, repo)).toBeInstanceOf(UpstashStore);
    repo.close();
  });

  it('con una sola de las dos variables, o con una direccion que no es https, no se activa', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://cybergrid-123.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect(loadConfig({ env: 'test', dbPath: ':memory:' }).upstash).toBeNull();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://inseguro.example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-de-prueba');
    expect(loadConfig({ env: 'test', dbPath: ':memory:' }).upstash).toBeNull();
  });
});
