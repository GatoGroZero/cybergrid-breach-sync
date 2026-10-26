import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/server/auth';
import { DEMO_PASSWORD } from '../../src/server/config';
import { StoreError, UpstashStore, type Store } from '../../src/server/store';
import { startServer, type TestServer } from './server-helper';

const PASS = 'Contraseñañandú2026';

/** Redis de mentira que vive fuera del servidor: sobrevive a "reiniciarlo" como el de Upstash. */
function fakeUpstash(): { store: UpstashStore; data: Map<string, string> } {
  const data = new Map<string, string>();
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const [name, key, value, flag] = JSON.parse(String(init?.body)) as string[];
    let result: string | null = null;
    if (name === 'GET') result = data.get(key as string) ?? null;
    else if (name === 'SET' && !(flag === 'NX' && data.has(key as string))) {
      data.set(key as string, value as string);
      result = 'OK';
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return { store: new UpstashStore({ url: 'https://x.upstash.io', token: 't' }, fetcher), data };
}

const cookieOf = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
};

describe('cuentas con correo y contraseña', () => {
  const open: TestServer[] = [];
  const start = async (...args: Parameters<typeof startServer>): Promise<TestServer> => {
    const s = await startServer(...args);
    open.push(s);
    return s;
  };
  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close()));
  });

  it('crear la cuenta inicia sesion y /me la reconoce como cuenta de correo', async () => {
    const s = await start();
    const res = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'luis@correo.com', password: PASS, confirm: PASS });
    expect(res.status).toBe(201);
    expect(res.body.user.provider).toBe('email');
    const me = await request(s.app).get('/api/auth/me').set('Cookie', cookieOf(res));
    expect(me.status).toBe(200);
    expect(me.body.user.provider).toBe('email');
  });

  it('rechaza una confirmacion distinta, una contraseña corta y un correo mal escrito', async () => {
    const s = await start();
    const mal = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: PASS, confirm: `${PASS}x` });
    expect(mal.status).toBe(400);
    expect(mal.body.mensaje).toBe('Las contraseñas no coinciden');

    const corta = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: 'corta', confirm: 'corta' });
    expect(corta.status).toBe(400);

    const correo = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'no-es-correo', password: PASS, confirm: PASS });
    expect(correo.status).toBe(400);
    expect(correo.body.mensaje).toBe('Escribe un correo válido');

    const sinConfirmar = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: PASS });
    expect(sinConfirmar.status).toBe(400);
  });

  it('el mismo correo con otras mayusculas cuenta como repetido', async () => {
    const s = await start();
    const body = { password: PASS, confirm: PASS };
    const a = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'Luis@Correo.com', ...body });
    expect(a.status).toBe(201);
    const b = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: ' luis@correo.COM ', ...body });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('correo_en_uso');
  });

  it('entra con el correo (sin importar mayusculas) y con la contraseña correcta', async () => {
    const s = await start();
    await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'luis@correo.com', password: PASS, confirm: PASS });
    const ok = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'LUIS@Correo.com', password: PASS });
    expect(ok.status).toBe(200);
    expect(ok.body.user.provider).toBe('email');
    expect(ok.headers['set-cookie']).toBeDefined();
  });

  it('una contraseña mala o un correo sin cuenta dan el mismo mensaje', async () => {
    const s = await start();
    await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'luis@correo.com', password: PASS, confirm: PASS });
    const mala = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'luis@correo.com', password: 'otra-contraseña-1' });
    const sinCuenta = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'nadie@correo.com', password: PASS });
    expect(mala.status).toBe(401);
    expect(sinCuenta.status).toBe(401);
    expect(sinCuenta.body).toEqual(mala.body);
    expect(mala.body.mensaje).toBe('Correo o contraseña incorrectos');
    const vacio = await request(s.app).post('/api/auth/signin').send({});
    expect(vacio.status).toBe(401);
  });

  it('la contraseña con ñ vale tambien escrita con la ñ descompuesta (n + tilde)', async () => {
    const s = await start();
    const descompuesta = PASS.normalize('NFD');
    expect(descompuesta).not.toBe(PASS);
    const alta = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'ene@correo.com', password: descompuesta, confirm: PASS });
    expect(alta.status).toBe(201);
    const a = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'ene@correo.com', password: PASS });
    const b = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'ene@correo.com', password: descompuesta });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('una contraseña con espacios, simbolos y emojis tambien sirve', async () => {
    const s = await start();
    const rara = 'mi clave ñandú #1 ✓ 🐱';
    const alta = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'rara@correo.com', password: rara, confirm: rara });
    expect(alta.status).toBe(201);
    const dentro = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'rara@correo.com', password: rara });
    expect(dentro.status).toBe(200);
  });

  it('las cuentas viejas de usuario y contraseña (demo1) entran escribiendo el usuario', async () => {
    const s = await start();
    s.repo.createUser('demo1', await hashPassword(DEMO_PASSWORD));
    const ok = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'demo1', password: DEMO_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.provider).toBe('local');
    expect(ok.body.user.username).toBe('demo1');
    const mala = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'demo1', password: 'no-es-la-clave' });
    expect(mala.status).toBe(401);
    const inexistente = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'fantasma', password: DEMO_PASSWORD });
    expect(inexistente.status).toBe(401);
    expect(inexistente.body).toEqual(mala.body);
  });

  it('con un almacen duradero la cuenta sigue entrando despues de reiniciar el servidor', async () => {
    const redis = fakeUpstash();
    const antes = await start({}, { store: redis.store });
    const alta = await request(antes.app)
      .post('/api/auth/signup')
      .send({ email: 'hermano@correo.com', password: PASS, confirm: PASS });
    expect(alta.status).toBe(201);
    // el apodo elegido tambien se recuerda
    const apodo = await request(antes.app)
      .post('/api/auth/nickname')
      .set('Cookie', cookieOf(alta))
      .send({ nickname: 'Michi_Rey' });
    expect(apodo.status).toBe(200);
    await antes.close();
    open.splice(open.indexOf(antes), 1);

    // servidor nuevo: base SQLite vacia, como tras un despliegue en Render
    const despues = await start({}, { store: redis.store });
    expect(despues.repo.kvGet('acct:v1:hermano@correo.com')).toBeNull();
    const dentro = await request(despues.app)
      .post('/api/auth/signin')
      .send({ identifier: 'hermano@correo.com', password: PASS });
    expect(dentro.status).toBe(200);
    expect(dentro.body.user.username).toBe('Michi_Rey');
    const repetida = await request(despues.app)
      .post('/api/auth/signup')
      .send({ email: 'hermano@correo.com', password: PASS, confirm: PASS });
    expect(repetida.status).toBe(409);
  });

  it('guarda solo el hash de la contraseña, nunca la contraseña', async () => {
    const redis = fakeUpstash();
    const s = await start({}, { store: redis.store });
    await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'hash@correo.com', password: PASS, confirm: PASS });
    const guardado = redis.data.get('acct:v1:hash@correo.com') ?? '';
    expect(guardado).not.toBe('');
    expect(guardado).not.toContain(PASS);
    expect(guardado).not.toContain(PASS.normalize('NFD'));
    expect(JSON.parse(guardado).h).toMatch(/^scrypt\$/);
  });

  it('si el almacen no responde avisa con 503 en lugar de perder la cuenta', async () => {
    const caido: Store = {
      durable: true,
      get: () => Promise.reject(new StoreError('almacen_500')),
      set: () => Promise.reject(new StoreError('almacen_500')),
      setNx: () => Promise.reject(new StoreError('almacen_500')),
    };
    const s = await start({}, { store: caido });
    const alta = await request(s.app)
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: PASS, confirm: PASS });
    expect(alta.status).toBe(503);
    expect(alta.headers['set-cookie']).toBeUndefined();
    const dentro = await request(s.app)
      .post('/api/auth/signin')
      .send({ identifier: 'a@b.com', password: PASS });
    expect(dentro.status).toBe(503);
  });

  it('/config dice si lo guardado es duradero y se apaga todo con PASSWORD_AUTH=false', async () => {
    const redis = fakeUpstash();
    const con = await start({}, { store: redis.store });
    expect((await request(con.app).get('/api/auth/config')).body.durable).toBe(true);
    const sin = await start();
    expect((await request(sin.app).get('/api/auth/config')).body.durable).toBe(false);

    const apagado = await start({ passwordAuth: false });
    const res = await request(apagado.app)
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: PASS, confirm: PASS });
    expect(res.status).toBe(404);
    const res2 = await request(apagado.app)
      .post('/api/auth/signin')
      .send({ identifier: 'a@b.com', password: PASS });
    expect(res2.status).toBe(404);
  });
});
