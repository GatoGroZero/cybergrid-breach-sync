import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Mail, Mailer } from '../../src/server/mailer';
import { createSessionToken, providerOfSub, userIdFor } from '../../src/server/session';
import { connectSocket, onceEvent, startServer, type TestServer } from './server-helper';

const CLIENT_ID = 'cliente-de-pruebas.apps.googleusercontent.com';
const CLIENT_SECRET = 'secreto-del-cliente';
const PUBLIC_URL = 'https://juego.example';

interface IdpGrant {
  nonce: string;
  challenge: string;
  sub: string;
  names: { given_name?: string; name?: string };
  aud: string;
  nonceOverride?: string;
  expired?: boolean;
  foreignKey?: boolean;
}

/** Un "Google" de mentira en local: claves RSA reales, PKCE, redirect_uri y secreto verificados. */
class FakeGoogle {
  private server!: Server;
  private key!: CryptoKey;
  private foreign!: CryptoKey;
  private jwk!: JWK;
  private readonly grants = new Map<string, IdpGrant>();
  base = '';

  async start(): Promise<void> {
    const pair = await generateKeyPair('RS256');
    this.key = pair.privateKey;
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    this.foreign = (await generateKeyPair('RS256')).privateKey;
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  issue(grant: Partial<IdpGrant> & Pick<IdpGrant, 'nonce' | 'challenge'>): string {
    const code = randomBytes(8).toString('hex');
    this.grants.set(code, {
      sub: '110011',
      names: { given_name: 'Luis' },
      aud: CLIENT_ID,
      ...grant,
    });
    return code;
  }

  private async handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    if (req.url === '/certs') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [this.jwk] }));
      return;
    }
    if (req.url === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const grant = this.grants.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const valid =
        grant &&
        form.get('grant_type') === 'authorization_code' &&
        form.get('client_id') === CLIENT_ID &&
        form.get('client_secret') === CLIENT_SECRET &&
        form.get('redirect_uri') === `${PUBLIC_URL}/api/auth/google/callback` &&
        challenge === grant.challenge;
      if (!valid) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      this.grants.delete(form.get('code') as string);
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({
        nonce: grant.nonceOverride ?? grant.nonce,
        ...grant.names,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com')
        .setAudience(grant.aud)
        .setSubject(grant.sub)
        .setIssuedAt(now - 100)
        .setExpirationTime(grant.expired ? now - 10 : now + 3600)
        .sign(grant.foreignKey ? this.foreign : this.key);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id_token: idToken, access_token: 'no-se-usa' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }
}

class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  failNext = false;
  async send(mail: Mail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('el proveedor no responde');
    }
    this.sent.push(mail);
  }
  lastCode(): string {
    const text = this.sent.at(-1)?.text ?? '';
    return /\b(\d{6})\b/.exec(text)?.[1] ?? '';
  }
}

const cookieHeader = (res: request.Response): string =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.map((c) => c.split(';')[0])
    .join('; ') ?? '';

describe('identidad y sesion', () => {
  it('el id sale de la identidad: es estable, no choca con la base local y respeta las cuentas viejas', () => {
    expect(userIdFor('google:123')).toBe(userIdFor('google:123'));
    expect(userIdFor('google:123')).not.toBe(userIdFor('google:124'));
    expect(userIdFor('google:123')).toBeGreaterThanOrEqual(1_000_000);
    expect(Number.isSafeInteger(userIdFor('guest:' + 'x'.repeat(40)))).toBe(true);
    expect(userIdFor('local:7')).toBe(7);
    expect(userIdFor('7')).toBe(7);
    expect(providerOfSub('google:1')).toBe('google');
    expect(providerOfSub('email:ab')).toBe('email');
    expect(providerOfSub('guest:ab')).toBe('guest');
    expect(providerOfSub('7')).toBe('local');
    expect(providerOfSub('otro:1')).toBe('local');
  });

  it('una sesion de antes (sub numerico) sigue valiendo', async () => {
    const server = await startServer();
    const token = await createSessionToken(
      server.config.sessionSecret,
      { sub: '5', name: 'viejo', provider: 'local' },
      7,
    );
    const me = await request(server.app).get('/api/auth/me').set('Cookie', `cg_session=${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: 5, username: 'viejo', provider: 'local' });
    await server.close();
  });
});

describe('invitado y apodo', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ limits: { guest: 100 } });
  });
  afterAll(async () => {
    await server.close();
  });

  it('entra sin cuenta, con apodo propio o uno al azar, y cada invitado es distinto', async () => {
    const a = await request(server.app).post('/api/auth/guest').send({ nickname: 'Mochi Pixel' });
    expect(a.status).toBe(201);
    expect(a.body.user).toMatchObject({ username: 'Mochi Pixel', provider: 'guest' });
    expect(JSON.stringify(a.body)).not.toContain('guest:');
    expect(a.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
    expect(a.headers['cache-control']).toBe('no-store');

    const b = await request(server.app).post('/api/auth/guest').send({});
    expect(b.body.user.username).toMatch(/^Gato\d{4}$/);
    expect(b.body.user.id).not.toBe(a.body.user.id);

    const me = await request(server.app).get('/api/auth/me').set('Cookie', cookieHeader(a));
    expect(me.body.user.id).toBe(a.body.user.id);
  });

  it('rechaza apodos con simbolos, demasiado cortos o demasiado largos', async () => {
    for (const nickname of [
      'ab',
      '<script>alert(1)</script>',
      'a'.repeat(17),
      'dos  espacios',
      'ñ',
    ])
      expect((await request(server.app).post('/api/auth/guest').send({ nickname })).status).toBe(
        400,
      );
    const ok = await request(server.app).post('/api/auth/guest').send({ nickname: 'Ñoño Gato_9' });
    expect(ok.status).toBe(201);
  });

  it('cambiar de apodo exige sesion, conserva el id y valida el texto', async () => {
    expect(
      (await request(server.app).post('/api/auth/nickname').send({ nickname: 'Nuevo Gato' }))
        .status,
    ).toBe(401);
    const guest = await request(server.app).post('/api/auth/guest').send({ nickname: 'Antes' });
    const cookie = cookieHeader(guest);
    const renamed = await request(server.app)
      .post('/api/auth/nickname')
      .set('Cookie', cookie)
      .send({ nickname: 'Despues' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user).toMatchObject({ username: 'Despues', provider: 'guest' });
    expect(renamed.body.user.id).toBe(guest.body.user.id);
    const bad = await request(server.app)
      .post('/api/auth/nickname')
      .set('Cookie', cookie)
      .send({ nickname: 'x' });
    expect(bad.status).toBe(400);
  });

  it('el invitado se conecta por socket y su sesion sobrevive a un servidor nuevo con la base vacia', async () => {
    const guest = await request(server.app).post('/api/auth/guest').send({ nickname: 'Viajero' });
    const cookie = cookieHeader(guest);
    const socket = connectSocket(server, cookie);
    await onceEvent(socket, 'connect');
    socket.close();

    // El mismo secreto con una base nueva (como un reinicio en Render): la sesion sigue valiendo.
    const restarted = await startServer({ sessionSecret: server.config.sessionSecret });
    const me = await request(restarted.app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(guest.body.user.id);
    const again = connectSocket(restarted, cookie);
    await onceEvent(again, 'connect');
    again.close();
    await restarted.close();
  });

  it('el invitado se puede apagar y el usuario con contrasena tambien', async () => {
    const off = await startServer({ guestLogin: false, passwordAuth: false });
    const cfg = await request(off.app).get('/api/auth/config');
    expect(cfg.body).toEqual({ google: false, email: false, guest: false, password: false });
    expect((await request(off.app).post('/api/auth/guest').send({})).status).toBe(404);
    expect(
      (
        await request(off.app)
          .post('/api/auth/register')
          .send({ username: 'alguien', password: 'una-clave-larga' })
      ).status,
    ).toBe(404);
    expect(
      (await request(off.app).post('/api/auth/login').send({ username: 'a', password: 'b' }))
        .status,
    ).toBe(404);
    await off.close();
  });

  it('un invitado nuevo por IP tiene tope para que nadie llene el servidor', async () => {
    const limited = await startServer({ limits: { guest: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push((await request(limited.app).post('/api/auth/guest').send({})).status);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    await limited.close();
  });
});

describe('inicio de sesion con Google', () => {
  let idp: FakeGoogle;
  let server: TestServer;

  beforeAll(async () => {
    idp = new FakeGoogle();
    await idp.start();
    server = await startServer({
      publicUrl: PUBLIC_URL,
      google: {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        authUrl: `${idp.base}/auth`,
        tokenUrl: `${idp.base}/token`,
        jwksUrl: `${idp.base}/certs`,
      },
    });
  });
  afterAll(async () => {
    await server.close();
    await idp.stop();
  });

  /** Hace lo que hace el navegador: abre /start, "va a Google" y regresa con el codigo. */
  async function begin(query = ''): Promise<{
    agent: ReturnType<typeof request.agent>;
    state: string;
    nonce: string;
    challenge: string;
    location: URL;
  }> {
    const agent = request.agent(server.app);
    const res = await agent.get(`/api/auth/google/start${query}`).redirects(0);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location as string);
    return {
      agent,
      location,
      state: location.searchParams.get('state') as string,
      nonce: location.searchParams.get('nonce') as string,
      challenge: location.searchParams.get('code_challenge') as string,
    };
  }

  it('manda a Google con state, nonce, PKCE y el regreso configurado, sin pedir el correo', async () => {
    const { location } = await begin();
    expect(location.origin).toBe(idp.base);
    const q = location.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(`${PUBLIC_URL}/api/auth/google/callback`);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid profile');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')?.length).toBeGreaterThanOrEqual(24);
    expect(q.get('nonce')?.length).toBeGreaterThanOrEqual(24);
    expect(location.search).not.toContain(CLIENT_SECRET);
  });

  it('con el codigo valido abre la sesion, usa el nombre de Google y el id no cambia entre dispositivos', async () => {
    const one = await begin();
    const code = idp.issue({ nonce: one.nonce, challenge: one.challenge, sub: '4242' });
    const done = await one.agent
      .get(`/api/auth/google/callback?code=${code}&state=${one.state}`)
      .redirects(0);
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe('/');
    expect((done.headers['set-cookie'] as unknown as string[] | undefined)?.join(';')).toMatch(
      /cg_session=.*HttpOnly/i,
    );
    const me = await one.agent.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ username: 'Luis', provider: 'google' });
    expect(JSON.stringify(me.body)).not.toContain('4242');

    // Otro dispositivo, otro navegador, misma cuenta de Google: mismo id de jugador.
    const two = await begin('?apodo=Mochi%20Mini');
    const code2 = idp.issue({ nonce: two.nonce, challenge: two.challenge, sub: '4242' });
    await two.agent.get(`/api/auth/google/callback?code=${code2}&state=${two.state}`).redirects(0);
    const me2 = await two.agent.get('/api/auth/me');
    expect(me2.body.user.username).toBe('Mochi Mini');
    expect(me2.body.user.id).toBe(me.body.user.id);
  });

  it('si Google no da un nombre usable se asigna un apodo al azar', async () => {
    const f = await begin();
    const code = idp.issue({ nonce: f.nonce, challenge: f.challenge, names: { name: '日本' } });
    await f.agent.get(`/api/auth/google/callback?code=${code}&state=${f.state}`).redirects(0);
    expect((await f.agent.get('/api/auth/me')).body.user.username).toMatch(/^Gato\d{4}$/);
  });

  const rejects = async (res: request.Response, error: string): Promise<void> => {
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?error=${error}`);
    expect(
      (res.headers['set-cookie'] as unknown as string[] | undefined)?.join(';') ?? '',
    ).not.toMatch(/cg_session=[^;]/);
  };

  it('rechaza un state que no es el del navegador (CSRF) y un regreso sin cookie', async () => {
    const f = await begin();
    const code = idp.issue({ nonce: f.nonce, challenge: f.challenge });
    await rejects(
      await f.agent.get(`/api/auth/google/callback?code=${code}&state=otro-state`).redirects(0),
      'google_fallo',
    );
    const stranger = request.agent(server.app);
    const code2 = idp.issue({ nonce: f.nonce, challenge: f.challenge });
    await rejects(
      await stranger.get(`/api/auth/google/callback?code=${code2}&state=${f.state}`).redirects(0),
      'google_fallo',
    );
  });

  it('rechaza un token con audiencia ajena, nonce distinto, vencido o firmado con otra llave', async () => {
    const cases: Partial<IdpGrant>[] = [
      { aud: 'otra-aplicacion' },
      { nonceOverride: 'nonce-de-otro-flujo' },
      { expired: true },
      { foreignKey: true },
    ];
    for (const extra of cases) {
      const f = await begin();
      const code = idp.issue({ nonce: f.nonce, challenge: f.challenge, ...extra });
      await rejects(
        await f.agent.get(`/api/auth/google/callback?code=${code}&state=${f.state}`).redirects(0),
        'google_fallo',
      );
    }
  });

  it('un codigo inventado, el PKCE roto o cancelar en Google no abren sesion', async () => {
    const f = await begin();
    await rejects(
      await f.agent.get(`/api/auth/google/callback?code=inventado&state=${f.state}`).redirects(0),
      'google_fallo',
    );
    const g = await begin();
    const code = idp.issue({ nonce: g.nonce, challenge: 'desafio-de-otro' });
    await rejects(
      await g.agent.get(`/api/auth/google/callback?code=${code}&state=${g.state}`).redirects(0),
      'google_fallo',
    );
    const h = await begin();
    await rejects(
      await h.agent.get('/api/auth/google/callback?error=access_denied').redirects(0),
      'google_cancelado',
    );
  });

  it('el codigo de Google solo sirve una vez', async () => {
    const f = await begin();
    const code = idp.issue({ nonce: f.nonce, challenge: f.challenge });
    const url = `/api/auth/google/callback?code=${code}&state=${f.state}`;
    expect((await f.agent.get(url).redirects(0)).headers.location).toBe('/');
    // La cookie de flujo ya se borro: repetir el regreso no abre otra sesion.
    const replay = request.agent(server.app);
    await rejects(await replay.get(url).redirects(0), 'google_fallo');
  });

  it('la lista de formas de entrar avisa que Google esta activo', async () => {
    const cfg = await request(server.app).get('/api/auth/config');
    expect(cfg.body.google).toBe(true);
  });
});

describe('entrar con un codigo por correo', () => {
  let server: TestServer;
  let mailer: MemoryMailer;
  let seq = 0;
  /** Cada prueba usa su propio correo para no chocar con el tope por correo. */
  let email = '';
  beforeEach(() => {
    email = `jugadora${++seq}@example.com`;
  });

  beforeAll(async () => {
    mailer = new MemoryMailer();
    server = await startServer(
      {
        email: { provider: 'console', apiKey: '', from: 'no-reply@example.com', fromName: 'Gato' },
        limits: { emailSend: 100, emailVerify: 100 },
      },
      { mailer },
    );
  });
  afterAll(async () => {
    await server.close();
  });

  const ask = (agent: ReturnType<typeof request.agent>, to = email, nickname?: string) =>
    agent.post('/api/auth/email/start').send({ email: to, nickname });

  it('manda un codigo de 6 numeros y con el se entra; el correo no aparece en ninguna respuesta', async () => {
    const agent = request.agent(server.app);
    const sent = await ask(agent, ` ${email.toUpperCase()} `, 'Gata Lila');
    expect(sent.status).toBe(200);
    expect(mailer.sent.at(-1)?.to).toBe(email);
    expect(mailer.sent.at(-1)?.subject).toContain(mailer.lastCode());
    expect(mailer.lastCode()).toMatch(/^\d{6}$/);
    expect(sent.headers['set-cookie']?.[0]).toMatch(/cg_otp=.*HttpOnly/i);
    expect(JSON.stringify(sent.body)).not.toContain(mailer.lastCode());

    const done = await agent
      .post('/api/auth/email/verify')
      .send({ email, code: mailer.lastCode() });
    expect(done.status).toBe(200);
    expect(done.body.user).toMatchObject({ username: 'Gata Lila', provider: 'email' });
    expect(JSON.stringify(done.body)).not.toContain('example.com');
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.id).toBe(done.body.user.id);
  });

  it('el mismo correo da el mismo id en cualquier dispositivo y otro correo da otro', async () => {
    const a = request.agent(server.app);
    await ask(a);
    const first = await a.post('/api/auth/email/verify').send({ email, code: mailer.lastCode() });
    const b = request.agent(server.app);
    await ask(b);
    const second = await b.post('/api/auth/email/verify').send({ email, code: mailer.lastCode() });
    expect(second.body.user.id).toBe(first.body.user.id);
    const c = request.agent(server.app);
    await ask(c, 'otra@example.com');
    const third = await c
      .post('/api/auth/email/verify')
      .send({ email: 'otra@example.com', code: mailer.lastCode() });
    expect(third.body.user.id).not.toBe(first.body.user.id);
  });

  it('un codigo equivocado, de otro correo o repetido no entra', async () => {
    const agent = request.agent(server.app);
    await ask(agent);
    const code = mailer.lastCode();
    const wrong = code === '000000' ? '000001' : '000000';
    const bad = await agent.post('/api/auth/email/verify').send({ email, code: wrong });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('codigo_incorrecto');
    expect(
      (await agent.post('/api/auth/email/verify').send({ email: 'ajeno@example.com', code }))
        .status,
    ).toBe(401);
    expect((await agent.post('/api/auth/email/verify').send({ email, code })).status).toBe(200);
    // El codigo ya se uso: repetirlo con la misma cookie falla.
    const again = await agent.post('/api/auth/email/verify').send({ email, code });
    expect(again.status).toBe(401);
    expect(again.body.error).toBe('codigo_vencido');
  });

  it('el codigo solo sirve en el navegador que lo pidio', async () => {
    const owner = request.agent(server.app);
    await ask(owner);
    const thief = request.agent(server.app);
    const res = await thief.post('/api/auth/email/verify').send({ email, code: mailer.lastCode() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('codigo_vencido');
  });

  it('despues de 5 fallos el codigo se bloquea aunque despues se acierte', async () => {
    const agent = request.agent(server.app);
    await ask(agent);
    const code = mailer.lastCode();
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++)
      expect((await agent.post('/api/auth/email/verify').send({ email, code: wrong })).status).toBe(
        401,
      );
    const locked = await agent.post('/api/auth/email/verify').send({ email, code });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('codigo_agotado');
  });

  it('valida el correo y el formato del codigo', async () => {
    const agent = request.agent(server.app);
    expect((await ask(agent, 'no-es-correo')).status).toBe(400);
    expect((await ask(agent, `${'a'.repeat(250)}@example.com`)).status).toBe(400);
    await ask(agent);
    for (const code of ['12345', '1234567', 'abcdef', '12 456'])
      expect((await agent.post('/api/auth/email/verify').send({ email, code })).status).toBe(400);
  });

  it('un correo que no se pudo enviar responde 502 sin dejar cookie', async () => {
    const agent = request.agent(server.app);
    mailer.failNext = true;
    const res = await ask(agent, 'falla@example.com');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('correo_no_enviado');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('cada correo recibe como maximo 3 codigos cada 10 minutos', async () => {
    const agent = request.agent(server.app);
    const results: number[] = [];
    for (let i = 0; i < 5; i++) results.push((await ask(agent, 'insistente@example.com')).status);
    expect(results).toEqual([200, 200, 200, 429, 429]);
  });

  it('el tope por IP frena a quien pide codigos a muchos correos', async () => {
    const limited = await startServer(
      {
        email: { provider: 'console', apiKey: '', from: 'a@example.com', fromName: 'Gato' },
        limits: { emailSend: 2 },
      },
      { mailer: new MemoryMailer() },
    );
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (
          await request(limited.app)
            .post('/api/auth/email/start')
            .send({ email: `u${i}@example.com` })
        ).status,
      );
    expect(statuses).toEqual([200, 200, 429, 429]);
    await limited.close();
  });

  it('sin proveedor de correo la opcion no existe', async () => {
    const plain = await startServer();
    expect((await request(plain.app).get('/api/auth/config')).body.email).toBe(false);
    expect((await request(plain.app).post('/api/auth/email/start').send({ email })).status).toBe(
      404,
    );
    await plain.close();
    expect((await request(server.app).get('/api/auth/config')).body.email).toBe(true);
  });
});
