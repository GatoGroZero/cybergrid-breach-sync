import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PongPayload } from '../../src/shared/br/protocol';
import {
  connectSocket,
  onceEvent,
  registerUser,
  startServer,
  type TestServer,
} from './server-helper';

describe('autenticacion', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ limits: { login: 3, register: 100, seed: 100, telemetry: 100 } });
  });
  afterAll(async () => {
    await server.close();
  });

  it('registra, evita duplicados sin importar mayusculas, inicia sesion y rechaza claves malas', async () => {
    const agent = request.agent(server.app);
    const created = await agent
      .post('/api/auth/register')
      .send({ username: 'LuisTest', password: 'una-clave-larga' });
    expect(created.status).toBe(201);
    expect(created.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
    expect(created.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/i);
    expect(created.body.user.username).toBe('LuisTest');
    expect(JSON.stringify(created.body)).not.toContain('pass');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('LuisTest');

    const dup = await request(server.app)
      .post('/api/auth/register')
      .send({ username: 'luistest', password: 'otra-clave-larga' });
    expect(dup.status).toBe(409);

    const weak = await request(server.app)
      .post('/api/auth/register')
      .send({ username: 'otro_usuario', password: 'corta' });
    expect(weak.status).toBe(400);

    const bad = await request(server.app)
      .post('/api/auth/login')
      .send({ username: 'LuisTest', password: 'clave-equivocada' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('credenciales_invalidas');
    const ghost = await request(server.app)
      .post('/api/auth/login')
      .send({ username: 'no_existe', password: 'clave-equivocada' });
    expect(ghost.status).toBe(401);
    expect(ghost.body.error).toBe('credenciales_invalidas');

    const good = await request(server.app)
      .post('/api/auth/login')
      .send({ username: 'luistest', password: 'una-clave-larga' });
    expect(good.status).toBe(200);

    const anon = await request(server.app).get('/api/auth/me');
    expect(anon.status).toBe(401);
  });

  it('exige JSON y rechaza peticiones de otro origen', async () => {
    const form = await request(server.app)
      .post('/api/auth/login')
      .type('form')
      .send('username=a&password=b');
    expect(form.status).toBe(415);
    const foreign = await request(server.app)
      .post('/api/auth/login')
      .set('Origin', 'https://sitio-malicioso.example')
      .send({ username: 'luistest', password: 'una-clave-larga' });
    expect(foreign.status).toBe(403);
  });

  it('limita los intentos fallidos de login (fuerza bruta) con 429', async () => {
    const limited = await startServer({
      limits: { login: 3, register: 100, seed: 100, telemetry: 100 },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(limited.app)
        .post('/api/auth/login')
        .send({ username: 'nadie', password: 'clave-equivocada' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    await limited.close();
  });
});

describe('sockets: sesion y latencia ping/pong', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('rechaza una conexion sin sesion valida', async () => {
    const socket = connectSocket(server);
    const err = await onceEvent<Error>(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
    socket.close();
    const forged = connectSocket(server, 'cg_session=token.falso.firmado');
    const err2 = await onceEvent<Error>(forged, 'connect_error');
    expect(err2.message).toBe('unauthorized');
    forged.close();
  });

  it('responde pong al ping con el mismo sello de tiempo y en menos de 100 ms', async () => {
    const cookie = await registerUser(server, 'jugador_ping');
    const socket = connectSocket(server, cookie);
    await onceEvent(socket, 'connect');
    expect(socket.io.engine.transport.name).toBe('websocket');

    const rtts: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const reply = onceEvent<PongPayload>(socket, 'pong');
      socket.emit('ping', { t: t0 });
      const pong = await reply;
      expect(pong.t).toBe(t0);
      expect(pong.ts).toBeGreaterThan(0);
      rtts.push(performance.now() - t0);
    }
    expect(Math.max(...rtts)).toBeLessThan(100);

    socket.emit('ping', { t: 'basura' });
    socket.emit('ping', { t: 1, rtt: 42 });
    await onceEvent<PongPayload>(socket, 'pong');
    const telemetry = await request(server.app).get('/api/test/telemetry');
    expect(telemetry.body.network.samples).toBeGreaterThanOrEqual(1);
    socket.close();
  });
});
