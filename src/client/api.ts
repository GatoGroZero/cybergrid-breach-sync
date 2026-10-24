export interface User {
  id: number;
  username: string;
  provider: 'google' | 'email' | 'guest' | 'local';
}

/** Que formas de entrar tiene activas el servidor. */
export interface AuthConfig {
  google: boolean;
  email: boolean;
  guest: boolean;
  password: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as {
    mensaje?: string;
    error?: string;
  } & T;
  if (!res.ok) {
    throw new ApiError(
      data.mensaje ?? 'Algo salió mal, intenta de nuevo',
      res.status,
      data.error ?? '',
    );
  }
  return data;
}

export const api = {
  async me(): Promise<User | null> {
    try {
      return (await call<{ user: User }>('/api/auth/me')).user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  async login(username: string, password: string): Promise<User> {
    return (await call<{ user: User }>('/api/auth/login', { username, password })).user;
  },
  async register(username: string, password: string): Promise<User> {
    return (await call<{ user: User }>('/api/auth/register', { username, password })).user;
  },
  async config(): Promise<AuthConfig> {
    return call<AuthConfig>('/api/auth/config');
  },
  async guest(nickname?: string): Promise<User> {
    return (await call<{ user: User }>('/api/auth/guest', { nickname })).user;
  },
  async emailStart(email: string): Promise<void> {
    await call('/api/auth/email/start', { email });
  },
  async emailVerify(email: string, code: string): Promise<User> {
    return (await call<{ user: User }>('/api/auth/email/verify', { email, code })).user;
  },
  async setNickname(nickname: string): Promise<User> {
    return (await call<{ user: User }>('/api/auth/nickname', { nickname })).user;
  },
  async logout(): Promise<void> {
    await call('/api/auth/logout', {});
  },
};
