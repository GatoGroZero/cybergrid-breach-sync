import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { FailureLog } from '../../src/server/auth';
import { createHardenedServer } from '../../src/server/http';
import { DEMO_PASSWORD } from '../../src/server/config';
import { SEED_STORE_MAX } from '../../src/server/db';
import { hashPassword } from '../../src/server/auth';
import { startServer, type TestServer } from './server-helper';

/** Lo que probaria alguien que quiere romper la aplicacion desde fuera. */

const cookieOf = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
};

describe('seguridad web', () => {
  const open: TestServer[] = [];
  const sockets: Socket[] = [];
  const start = async (...args: Parameters<typeof startServer>): Promise<TestServer> => {
    const s = await startServer(...args);
    open.push(s);
    return s;
  };
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await Promise.all(open.splice(0).map((s) => s.close()));
  });

  const guest = async (s: TestServer): Promise<string> =>
    cookieOf(await request(s.app).post('/api/auth/guest').send({}));

  describe('cabeceras', () => {
    it('la politica de contenido no permite codigo en linea ni eval y el socket solo va al mismo servidor', async () => {
      const s = await start();
      const res = await request(s.app).get('/api/auth/config');
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("script-src-attr 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      // nada de ws: o wss: abiertos a cualquier sitio: solo la direccion de este servidor
      const connectSrc = /connect-src ([^;]*)/.exec(csp)?.[1] ?? '';
      expect(connectSrc.split(' ')).not.toContain('ws:');
      expect(connectSrc.split(' ')).not.toContain('wss:');
      expect(connectSrc).toMatch(/ws:\/\/127\.0\.0\.1:\d+/);
    });

    it('en produccion se fuerza https y el socket va por wss', async () => {
      const s = await start({ env: 'production', sessionSecret: 'x'.repeat(48) });
      const res = await request(s.app).get('/api/auth/config').set('Host', 'juego.example.com');
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain('upgrade-insecure-requests');
      expect(csp).toContain('wss://juego.example.com');
      expect(csp).not.toContain('ws://');
      // un Host raro no se cuela en la politica
      const raro = await request(s.app).get('/api/auth/config').set('Host', 'a.com; script-src *');
      expect(String(raro.headers['content-security-policy'])).not.toContain('script-src *');
    });

    it('lleva las demas cabeceras de endurecimiento y no delata el framework', async () => {
      const s = await start();
      const res = await request(s.app).get('/api/auth/config');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      const policy = String(res.headers['permissions-policy']);
      for (const f of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()'])
        expect(policy).toContain(f);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('la cookie de sesion es httpOnly, SameSite y Secure en produccion', async () => {
      const dev = await start();
      const a = await request(dev.app).post('/api/auth/guest').send({});
      const cookie = String(a.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).not.toContain('Secure');
      const prod = await start({ env: 'production', sessionSecret: 'x'.repeat(48) });
      const b = await request(prod.app).post('/api/auth/guest').send({});
      expect(String(b.headers['set-cookie'])).toContain('Secure');
    });

    it('la API privada no manda cabeceras CORS, ni respondiendo al preflight', async () => {
      const s = await start();
      const pre = await request(s.app)
        .options('/api/auth/guest')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(pre.headers['access-control-allow-origin']).toBeUndefined();
      const res = await request(s.app)
        .get('/api/auth/config')
        .set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      // los de prueba son publicos a proposito (lo pide el enunciado)
      const open = await request(s.app).get('/api/test/health');
      expect(open.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('peticiones de otro sitio (CSRF)', () => {
    it('un origen ajeno no puede crear sesiones, cuentas ni guardar progreso', async () => {
      const s = await start();
      const evil = { Origin: 'https://evil.example' };
      const g = await request(s.app).post('/api/auth/guest').set(evil).send({});
      expect(g.status).toBe(403);
      expect(g.headers['set-cookie']).toBeUndefined();
      const up = await request(s.app)
        .post('/api/auth/signup')
        .set(evil)
        .send({ email: 'a@b.com', password: 'clave-larga-1', confirm: 'clave-larga-1' });
      expect(up.status).toBe(403);

      const cookie = await guest(s);
      const put = await request(s.app)
        .put('/api/progress')
        .set('Cookie', cookie)
        .set(evil)
        .send({});
      expect(put.status).toBe(403);
    });

    it('Sec-Fetch-Site distinto de same-origin bloquea lo que cambia datos, pero deja leer', async () => {
      const s = await start();
      for (const site of ['cross-site', 'same-site']) {
        const res = await request(s.app)
          .post('/api/auth/guest')
          .set('Sec-Fetch-Site', site)
          .send({});
        expect(res.status).toBe(403);
      }
      const ok = await request(s.app)
        .post('/api/auth/guest')
        .set('Sec-Fetch-Site', 'same-origin')
        .send({});
      expect(ok.status).toBe(201);
      const read = await request(s.app).get('/api/auth/config').set('Sec-Fetch-Site', 'cross-site');
      expect(read.status).toBe(200);
      // el regreso de Google es una navegacion de otro sitio con GET: no se toca
    });

    it('solo se acepta JSON: texto plano y formularios (los que un formulario ajeno puede mandar) se rechazan', async () => {
      const s = await start();
      const text = await request(s.app)
        .post('/api/auth/guest')
        .set('Content-Type', 'text/plain')
        .send('{"nickname":"x"}');
      expect(text.status).toBe(415);
      const form = await request(s.app).post('/api/auth/guest').type('form').send({ a: 1 });
      expect(form.status).toBe(415);
      const alta = await request(s.app)
        .post('/api/auth/signup')
        .send({ email: 'a@b.com', password: 'clave-larga-1', confirm: 'clave-larga-1' });
      const progress = await request(s.app)
        .put('/api/progress')
        .set('Cookie', cookieOf(alta))
        .set('Content-Type', 'text/plain')
        .send('{"save":{}}');
      expect(progress.status).toBe(400);
    });
  });

  describe('entradas hostiles', () => {
    it('JSON roto, demasiado grande o con __proto__ no produce errores 500 ni contamina objetos', async () => {
      const s = await start();
      const roto = await request(s.app)
        .post('/api/auth/signin')
        .set('Content-Type', 'application/json')
        .send('{"identifier": ');
      expect(roto.status).toBe(400);
      expect(JSON.stringify(roto.body)).not.toMatch(/at |node_modules|\.ts:/);

      const grande = await request(s.app)
        .post('/api/auth/signin')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ identifier: 'a'.repeat(10_000), password: 'x' }));
      expect(grande.status).toBe(413);
      expect(JSON.stringify(grande.body)).not.toMatch(/at |node_modules|\.ts:/);

      const proto = await request(s.app)
        .post('/api/auth/signup')
        .set('Content-Type', 'application/json')
        .send(
          '{"email":"a@b.com","password":"clave-larga-1","confirm":"clave-larga-1","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
        );
      expect(proto.status).toBe(201);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();

      const cookie = await guest(s);
      const progress = await request(s.app)
        .put('/api/progress')
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send('{"save":{"__proto__":{"polluted":true}}}');
      expect(progress.status).toBe(403); // un invitado no tiene guardado; y aun asi no se rompe nada
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('inyeccion SQL, NoSQL y comandos de Redis en el correo y la contraseña solo dan credenciales invalidas', async () => {
      const s = await start();
      const ataques = [
        "' OR 1=1 --",
        "demo1'--",
        '"; DROP TABLE users; --',
        'a@b.com\r\nSET acct:v1:x y',
        '{"$ne":null}',
        'admin@x.com" "EX" "1',
      ];
      for (const identifier of ataques) {
        const res = await request(s.app)
          .post('/api/auth/signin')
          .send({ identifier, password: 'clave-larga-1' });
        expect(res.status).toBe(401);
        expect(res.body.mensaje).toBe('Correo o contraseña incorrectos');
      }
      for (const identifier of [{ $ne: null }, ['a@b.com'], 42, null]) {
        const res = await request(s.app)
          .post('/api/auth/signin')
          .send({ identifier, password: { $gt: '' } });
        expect(res.status).toBe(401);
      }
      // el correo con saltos de linea no es un correo valido: no llega al almacen
      const alta = await request(s.app)
        .post('/api/auth/signup')
        .send({ email: 'a@b.com\r\nSET x y', password: 'clave-larga-1', confirm: 'clave-larga-1' });
      expect(alta.status).toBe(400);
      // las tablas siguen ahi
      expect(s.repo.totals()).toBeDefined();
    });

    it('apodos y nombres de sala con HTML, caracteres de control o direccion de texto se limpian o rechazan', async () => {
      const s = await start();
      for (const nickname of [
        '<script>alert(1)</script>',
        '<img src=x onerror=1>',
        'a‮b',
        'a\u0000b',
        'ab',
      ]) {
        const res = await request(s.app).post('/api/auth/guest').send({ nickname });
        expect(res.status).toBe(400);
      }
      const cookie = await guest(s);
      const socket = connect(s.url, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie },
      });
      sockets.push(socket);
      await new Promise<void>((r) => socket.once('connect', () => r()));
      const create = (name: string, isPrivate = false): Promise<{ ok: boolean }> =>
        new Promise((resolve) => socket.emit('room:create', { name, isPrivate }, resolve));
      const listed = (): Promise<{ name: string }[]> =>
        new Promise((resolve) =>
          socket.emit('rooms:list', (a: { ok: boolean; data?: { name: string }[] }) =>
            resolve(a.data ?? []),
          ),
        );
      const html = await create('<b>Sala</b>\u202E\u0000 \u200B');
      expect(html.ok).toBe(true);
      const names = (await listed()).map((r) => r.name);
      expect(names).toEqual(['<b>Sala</b>']);
      for (const n of names) expect(n).not.toMatch(/\p{C}/u);
      // un nombre que solo tiene caracteres invisibles queda vacio y se rechaza
      await new Promise((r) => socket.emit('room:leave', r));
      expect((await create('\u200B\u200B', true)).ok).toBe(false);
    });

    it('las rutas inexistentes, los metodos raros y los archivos ocultos no filtran nada', async () => {
      const s = await start();
      for (const m of ['delete', 'put', 'patch'] as const) {
        const res = await request(s.app)[m]('/api/auth/me');
        expect([404, 405]).toContain(res.status);
      }
      const trace = await request(s.app).trace('/api/auth/me');
      expect([404, 405]).toContain(trace.status);
      const nope = await request(s.app).get('/api/../../etc/passwd');
      expect(nope.status).toBe(404);
      const enc = await request(s.app).get('/api/%2e%2e/%2e%2e/etc/passwd');
      expect(enc.status).toBe(404);
      expect(JSON.stringify(nope.body)).not.toContain('root:');
    });

    it('una cabecera gigante se rechaza sin tumbar el servidor', async () => {
      const s = await start();
      const res = await request(s.app)
        .get('/api/auth/config')
        .set('X-Basura', 'a'.repeat(20_000))
        .catch((e: unknown) => e);
      // o el servidor contesta 431, o corta la conexion; en ambos casos sigue vivo
      if (res && typeof res === 'object' && 'status' in res)
        expect((res as request.Response).status).toBe(431);
      expect((await request(s.app).get('/api/test/health')).status).toBe(200);
    });
  });

  describe('fuerza bruta', () => {
    it('despues de varios fallos con una cuenta se bloquea esa cuenta aunque se acierte, sin afectar a las demas', async () => {
      const s = await start({ limits: { login: 500, register: 100, accountFails: 5 } });
      const clave = 'clave-larga-1';
      for (const email of ['victima@correo.com', 'otra@correo.com'])
        await request(s.app)
          .post('/api/auth/signup')
          .send({ email, password: clave, confirm: clave });

      for (let i = 0; i < 5; i++) {
        const mal = await request(s.app)
          .post('/api/auth/signin')
          .send({ identifier: 'Victima@Correo.com', password: `incorrecta-${i}-xx` });
        expect(mal.status).toBe(401);
      }
      const bloqueada = await request(s.app)
        .post('/api/auth/signin')
        .send({ identifier: 'victima@correo.com', password: clave });
      expect(bloqueada.status).toBe(429);
      expect(bloqueada.headers['set-cookie']).toBeUndefined();
      // otra cuenta, desde la misma IP, entra normal
      const otra = await request(s.app)
        .post('/api/auth/signin')
        .send({ identifier: 'otra@correo.com', password: clave });
      expect(otra.status).toBe(200);
    });

    it('un acierto reinicia la cuenta y las cuentas de demostracion nunca se bloquean', async () => {
      const s = await start({ limits: { login: 500, accountFails: 3 } });
      s.repo.createUser('demo1', await hashPassword(DEMO_PASSWORD));
      for (let i = 0; i < 12; i++)
        await request(s.app)
          .post('/api/auth/signin')
          .send({ identifier: 'demo1', password: `mala-${i}-xxxx` });
      const ok = await request(s.app)
        .post('/api/auth/signin')
        .send({ identifier: 'demo1', password: DEMO_PASSWORD });
      expect(ok.status).toBe(200);

      const clave = 'clave-larga-1';
      await request(s.app)
        .post('/api/auth/signup')
        .send({ email: 'u@correo.com', password: clave, confirm: clave });
      for (let i = 0; i < 2; i++)
        await request(s.app)
          .post('/api/auth/signin')
          .send({ identifier: 'u@correo.com', password: `mala-${i}-xxxx` });
      expect(
        (
          await request(s.app)
            .post('/api/auth/signin')
            .send({ identifier: 'u@correo.com', password: clave })
        ).status,
      ).toBe(200);
      for (let i = 0; i < 2; i++)
        await request(s.app)
          .post('/api/auth/signin')
          .send({ identifier: 'u@correo.com', password: `mala-${i}-xxxx` });
      expect(
        (
          await request(s.app)
            .post('/api/auth/signin')
            .send({ identifier: 'u@correo.com', password: clave })
        ).status,
      ).toBe(200);
    });

    it('el registro de fallos olvida pasada la ventana y no crece sin limite', () => {
      const log = new FailureLog(3, 1000, 50);
      const t0 = 1_000_000;
      for (let i = 0; i < 3; i++) log.fail('a', t0 + i);
      expect(log.blocked('a', t0 + 10)).toBe(true);
      expect(log.blocked('a', t0 + 1500)).toBe(false);
      for (let i = 0; i < 500; i++) log.fail(`k${i}`, t0 + 2000);
      let tracked = 0;
      for (let i = 0; i < 500; i++)
        if ((log as unknown as { hits: Map<string, unknown> }).hits.has(`k${i}`)) tracked++;
      expect(tracked).toBeLessThanOrEqual(50);
    });
  });

  describe('endpoints de prueba publicos', () => {
    it('sembrar sin reemplazar una y otra vez no llena la base: hay un tope y se quedan las mas recientes', async () => {
      const s = await start({ limits: { seed: 1000 } });
      for (let i = 0; i < 12; i++)
        expect(
          (await request(s.app).post('/api/test/seed').send({ count: 1000, replace: false }))
            .status,
        ).toBe(200);
      const t = await request(s.app).get('/api/test/telemetry');
      expect(t.body.matches.total).toBe(SEED_STORE_MAX);
      expect(t.body.meta.queryMs).toBeLessThan(200);
      // un cuerpo enorme se rechaza antes de procesarlo
      const grande = await request(s.app).post('/api/test/seed').send('x'.repeat(300_000));
      expect(grande.status).toBeGreaterThanOrEqual(400);
      expect(grande.status).toBeLessThan(500);
      const raro = await request(s.app)
        .post('/api/test/seed')
        .send({ count: '1000; DROP TABLE matches' });
      // el lector tolerante saca el numero o rechaza; en ningun caso llega texto a una consulta SQL
      expect([200, 400]).toContain(raro.status);
      const despues = await request(s.app).get('/api/test/telemetry');
      expect(despues.status).toBe(200);
      expect(despues.body.matches.total).toBeLessThanOrEqual(SEED_STORE_MAX);
    });
  });

  describe('sesiones y WebSocket', () => {
    const forged = async (
      s: TestServer,
      alg: 'HS256' | 'none',
      secret: string,
      exp: string,
    ): Promise<string> => {
      if (alg === 'none') {
        const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
        return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'guest:forjado', name: 'Falso', prv: 'guest', exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
      }
      void s;
      return new SignJWT({ name: 'Falso', prv: 'guest' })
        .setProtectedHeader({ alg })
        .setSubject('guest:forjado')
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(new TextEncoder().encode(secret));
    };

    it('un token con otra llave, sin firma (alg none) o vencido no abre sesion ni socket', async () => {
      const s = await start();
      const real = s.config.sessionSecret;
      const tokens = [
        await forged(s, 'HS256', 'otra-llave-otra-llave-otra-llave-1', '1h'),
        await forged(s, 'none', '', '1h'),
        await forged(s, 'HS256', real, '-1h'),
        'basura.basura.basura',
        '',
      ];
      for (const t of tokens) {
        const me = await request(s.app).get('/api/auth/me').set('Cookie', `cg_session=${t}`);
        expect(me.status).toBe(401);
        const put = await request(s.app).get('/api/progress').set('Cookie', `cg_session=${t}`);
        expect(put.status).toBe(401);
        const socket = connect(s.url, {
          transports: ['websocket'],
          reconnection: false,
          extraHeaders: { cookie: `cg_session=${t}` },
        });
        sockets.push(socket);
        const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
        expect(err.message).toBe('unauthorized');
      }
      // el control: con la llave buena si entra
      const bueno = await forged(s, 'HS256', real, '1h');
      expect(
        (await request(s.app).get('/api/auth/me').set('Cookie', `cg_session=${bueno}`)).status,
      ).toBe(200);
    });

    it('un WebSocket abierto desde otra pagina (Origin ajeno) se rechaza aunque lleve la cookie', async () => {
      const s = await start();
      const cookie = await guest(s);
      const socket = connect(s.url, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie, origin: 'https://evil.example' },
      });
      sockets.push(socket);
      const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      expect(err.message).toMatch(/.+/);
      expect(socket.connected).toBe(false);
    });

    it('un mensaje de socket gigante corta la conexion de quien lo manda y el servidor sigue', async () => {
      const s = await start();
      const cookie = await guest(s);
      const socket = connect(s.url, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie },
      });
      sockets.push(socket);
      await new Promise<void>((r) => socket.once('connect', () => r()));
      const closed = new Promise<string>((resolve) => socket.once('disconnect', resolve));
      socket.emit('skin:set', { base: 1, paint: 'f'.repeat(200_000) });
      await closed;
      expect((await request(s.app).get('/api/test/health')).status).toBe(200);
    });

    it('la IP que ve el servidor no se puede falsear con cabeceras si no se confia en el proxy', async () => {
      const s = await start();
      const a = await request(s.app)
        .get('/api/test/health')
        .set('X-Forwarded-For', '8.8.8.8')
        .set('CF-Connecting-IP', '9.9.9.9');
      expect(a.body.clientIp).not.toBe('8.8.8.8');
      expect(a.body.clientIp).not.toBe('9.9.9.9');
    });
  });

  describe('servidor HTTP', () => {
    it('el servidor trae plazos para encabezados y peticion, y una peticion que gotea se corta (slowloris)', async () => {
      const normal = createHardenedServer();
      expect(normal.headersTimeout).toBe(20_000);
      expect(normal.requestTimeout).toBe(30_000);
      expect(normal.maxHeadersCount).toBe(100);
      normal.close();
      // con plazos cortos se comprueba que de verdad corta la conexion
      const http = createHardenedServer({
        headersTimeout: 300,
        requestTimeout: 600,
        connectionsCheckingInterval: 100,
      });
      http.on('request', (_req, res) => res.end('ok'));
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const port = (http.address() as AddressInfo).port;
      const { connect: tcp } = await import('node:net');
      const closed = await new Promise<boolean>((resolve) => {
        const sock = tcp(port, '127.0.0.1', () => sock.write('GET / HTTP/1.1\r\nHost: x\r\nX-A: '));
        sock.resume();
        sock.on('close', () => resolve(true));
        sock.on('error', () => resolve(true));
        setTimeout(() => resolve(false), 5000);
      });
      expect(closed).toBe(true);
      await new Promise((r) => http.close(r));
    });
  });
});
