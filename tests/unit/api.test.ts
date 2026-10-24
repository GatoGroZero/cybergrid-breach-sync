import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './server-helper';

describe('endpoints de prueba /api/test/*', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('telemetry responde 200 con ceros cuando la base esta vacia', async () => {
    const res = await request(server.app).get('/api/test/telemetry');
    expect(res.status).toBe(200);
    expect(res.body.matches.total).toBe(0);
    expect(res.body.winRate).toBe(0);
    expect(res.body.kdr).toBe(0);
    expect(res.body.survivability.survivalRate).toBe(0);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['server-timing']).toContain('total');
  });

  it('seed de 1000 partidas y telemetry responden bien por debajo de 200 ms', async () => {
    const seeded = await request(server.app)
      .post('/api/test/seed')
      .send({ count: 1000, seed: 42, winRate: 0.6 });
    expect(seeded.status).toBe(200);
    expect(seeded.body.inserted).toBe(1000);
    expect(seeded.body.durationMs).toBeLessThan(200);

    const times: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      last = await request(server.app).get('/api/test/telemetry');
      times.push(performance.now() - t0);
      expect(last.status).toBe(200);
    }
    expect(Math.max(...times)).toBeLessThan(200);
    expect(last?.body.matches.total).toBe(1000);
    expect(last?.body.matches.wins).toBe(600);
    expect(last?.body.winRate).toBe(0.6);
    expect(last?.body.kdr).toBeGreaterThan(0);
    expect(last?.body.meta.queryMs).toBeLessThan(200);
  });

  it('replace sustituye lo sembrado antes y no acumula', async () => {
    await request(server.app).post('/api/test/seed').send({ count: 100, winRate: 0.5 });
    const res = await request(server.app).get('/api/test/telemetry');
    expect(res.body.matches.total).toBe(100);
    expect(res.body.winRate).toBe(0.5);
    await request(server.app).post('/api/test/seed').send({ count: 100, replace: false });
    const after = await request(server.app).get('/api/test/telemetry');
    expect(after.body.matches.total).toBe(200);
  });

  it('lee de forma tolerante: cuerpo vacio, texto plano, formulario y alias', async () => {
    const empty = await request(server.app).post('/api/test/seed');
    expect(empty.status).toBe(200);
    expect(empty.body.inserted).toBe(100);

    const plain = await request(server.app)
      .post('/api/test/seed')
      .set('Content-Type', 'text/plain')
      .send('{"count": 150}');
    expect(plain.body.inserted).toBe(150);

    const form = await request(server.app).post('/api/test/seed').type('form').send('count=120');
    expect(form.body.inserted).toBe(120);

    const alias = await request(server.app).post('/api/test/seed').send({ partidas: 130 });
    expect(alias.body.inserted).toBe(130);

    const garbage = await request(server.app)
      .post('/api/test/seed')
      .set('Content-Type', 'application/json')
      .send('esto no es json {');
    expect(garbage.status).toBe(200);
  });

  it('rechaza cantidades fuera de rango con 400 y un mensaje claro', async () => {
    for (const count of [0, 1001, 50000]) {
      const res = await request(server.app).post('/api/test/seed').send({ count });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('payload_invalido');
      expect(res.body.detalles.length).toBeGreaterThan(0);
    }
  });

  it('detras de Cloudflare toma la IP real del cliente de CF-Connecting-IP', async () => {
    const behind = await startServer({ trustCloudflare: true });
    const real = await request(behind.app)
      .get('/api/test/health')
      .set('CF-Connecting-IP', '203.0.113.7');
    expect(real.body.clientIp).toBe('203.0.113.7');
    const forged = await request(behind.app)
      .get('/api/test/health')
      .set('CF-Connecting-IP', 'no-es-una-ip');
    expect(forged.body.clientIp).not.toBe('no-es-una-ip');
    const direct = await request(server.app)
      .get('/api/test/health')
      .set('CF-Connecting-IP', '203.0.113.7');
    expect(direct.body.clientIp).not.toBe('203.0.113.7');
    await behind.close();
  });

  it('health responde rapido y los endpoints se pueden apagar con la bandera', async () => {
    const health = await request(server.app).get('/api/test/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const off = await startServer({ testEndpoints: false });
    const res = await request(off.app).get('/api/test/telemetry');
    expect(res.status).toBe(404);
    await off.close();
  });
});
