export interface User {
  id: number;
  username: string;
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
  async logout(): Promise<void> {
    await call('/api/auth/logout', {});
  },
};
