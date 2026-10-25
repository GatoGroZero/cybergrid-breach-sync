import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './server-helper';

describe('archivos estaticos y rutas del juego', () => {
  let server: TestServer;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cg-static-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>juego</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    server = await startServer({ staticDir: dir });
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('las rutas del juego (sin extension) devuelven la pagina principal', async () => {
    for (const path of ['/', '/login', '/lobby', '/play']) {
      const res = await request(server.app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text).toContain('<title>juego</title>');
    }
  });

  it('un archivo real se sirve tal cual', async () => {
    const res = await request(server.app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
  });

  it('pedir archivos que no existen o ocultos es un 404, no la pagina principal', async () => {
    for (const path of [
      '/.env',
      '/.git/config',
      '/package.json',
      '/render.yaml',
      '/src/server/config.ts',
      '/assets/app.js.map',
      '/assets/otro.png',
    ]) {
      const res = await request(server.app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.text, path).not.toContain('<title>juego</title>');
    }
  });

  it('las rutas de la API que no existen responden 404 en JSON', async () => {
    const res = await request(server.app).get('/api/nada');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_encontrado');
  });
});
