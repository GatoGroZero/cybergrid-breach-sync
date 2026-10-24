// Auditoria de una URL desplegada. Repite la lista de comprobacion del evaluador:
// SSL valido, GET /api/test/telemetry < 200 ms, POST /api/test/seed y ping/pong < 100 ms por WebSocket.
// Uso: node scripts/audit-prod.mjs https://tu-servicio.onrender.com [--browser]
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const base = (process.argv[2] ?? process.env.AUDIT_URL ?? '').replace(/\/$/, '');
const useBrowser = process.argv.includes('--browser');
if (!base) {
  console.error('Uso: node scripts/audit-prod.mjs <url> [--browser]');
  process.exit(2);
}
const url = new URL(base);
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok });
  console.info(`${ok ? 'OK ' : 'FALLA'}  ${name}${detail ? `: ${detail}` : ''}`);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0;
};
const f = (n) => `${Math.round(n * 10) / 10} ms`;

/** Peticion con conexion nueva (TCP y TLS incluidos), como la haria un evaluador con curl. */
function request(path, { method = 'GET', body, headers = {} } = {}) {
  const lib = url.protocol === 'https:' ? https : http;
  const agent = new lib.Agent({ keepAlive: false });
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = lib.request(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path,
        method,
        agent,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        timeout: 70_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // no era JSON
          }
          resolve({
            status: res.statusCode,
            ms: performance.now() - t0,
            json,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function checkTls() {
  if (url.protocol !== 'https:') return check('SSL', false, 'la URL no usa https');
  await new Promise((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: 443, servername: url.hostname }, () => {
      const cert = socket.getPeerCertificate();
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
      check(
        'SSL valido',
        socket.authorized && days > 7,
        `${socket.getProtocol()}, emisor ${cert.issuer?.O ?? '?'}, vence en ${days} dias`,
      );
      socket.end();
      resolve();
    });
    socket.on('error', (err) => {
      check('SSL valido', false, err.message);
      resolve();
    });
  });
}

async function checkHttp() {
  // La primera peticion puede despertar un servicio dormido (plan gratuito): se mide aparte.
  const wake = await request('/api/test/health');
  check('Servicio activo (health 200)', wake.status === 200, `primera respuesta en ${f(wake.ms)}`);

  const times = [];
  let allOk = true;
  for (let i = 0; i < 20; i++) {
    const r = await request('/api/test/telemetry');
    times.push(r.ms);
    if (r.status !== 200 || typeof r.json?.winRate !== 'number') allOk = false;
  }
  check('GET /api/test/telemetry responde 200 con winRate, kdr y supervivencia', allOk);
  check(
    'GET /api/test/telemetry < 200 ms (conexion nueva)',
    pct(times, 0.95) < 200,
    `p50 ${f(pct(times, 0.5))}, p95 ${f(pct(times, 0.95))}, max ${f(Math.max(...times))}`,
  );

  for (const count of [100, 1000]) {
    const r = await request('/api/test/seed', { method: 'POST', body: { count, winRate: 0.6 } });
    check(
      `POST /api/test/seed con ${count} partidas`,
      r.status === 200 && r.json?.inserted === count,
      `HTTP ${r.status}, ${f(r.ms)} en total, consulta ${r.json?.queryMs} ms`,
    );
    const t = await request('/api/test/telemetry');
    check(
      `telemetry tras seed de ${count} sigue < 200 ms y refleja los datos`,
      t.status === 200 && t.ms < 200 && t.json?.matches?.total >= count,
      `${f(t.ms)}, winRate ${t.json?.winRate}, kdr ${t.json?.kdr}`,
    );
  }
  const bad = await request('/api/test/seed', { method: 'POST', body: { count: 99999 } });
  check('seed fuera de rango se rechaza con 400', bad.status === 400, `HTTP ${bad.status}`);
  const clean = await request('/api/test/seed', { method: 'DELETE' });
  check(
    'DELETE /api/test/seed limpia los datos sembrados',
    clean.status === 200,
    `quito ${clean.json?.removed}`,
  );
}

async function checkSocket() {
  const name = `audit_${Math.random().toString(36).slice(2, 9)}`;
  const reg = await request('/api/auth/register', {
    method: 'POST',
    body: { username: name, password: 'auditoria-segura-1' },
  });
  if (reg.status !== 201)
    return check('Registro para la prueba de WebSocket', false, `HTTP ${reg.status}`);
  const cookie = String(reg.headers['set-cookie']?.[0] ?? '').split(';')[0];

  const anon = io(base, { transports: ['websocket'], reconnection: false });
  const rejected = await new Promise((resolve) => {
    anon.once('connect_error', (e) => resolve(e.message));
    anon.once('connect', () => resolve('conectado'));
  });
  anon.close();
  check('Socket sin sesion rechazado', rejected === 'unauthorized', String(rejected));

  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie },
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  check(
    'WebSocket abierto',
    socket.io.engine.transport.name === 'websocket',
    'transporte websocket',
  );

  const rtts = [];
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    const pong = new Promise((resolve) => socket.once('pong', resolve));
    socket.emit('ping', { t: t0 });
    await pong;
    rtts.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 120));
  }
  check(
    'Latencia ping/pong < 100 ms',
    pct(rtts, 0.5) < 100,
    `min ${f(Math.min(...rtts))}, p50 ${f(pct(rtts, 0.5))}, p95 ${f(pct(rtts, 0.95))}, max ${f(Math.max(...rtts))}`,
  );
  socket.close();
}

async function checkBrowser() {
  const { chromium, devices } = await import('@playwright/test');
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7 landscape'], baseURL: base });
  const page = await context.newPage();
  const name = `aud_${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/');
  await page.getByRole('tab', { name: 'Crear cuenta' }).click();
  await page.getByTestId('auth-user').fill(name);
  await page.getByTestId('auth-pass').fill('auditoria-segura-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('btn-solo').click();
  await page.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 5, null, {
    timeout: 60_000,
  });
  await page.waitForTimeout(4000);
  const state = await page.evaluate(() => window.__cybergrid);
  check(
    'Emulador movil: controles tactiles activos',
    state?.mode === 'touch',
    `modo ${state?.mode}`,
  );
  check(
    'Emulador movil: FPS estables',
    (state?.fps ?? 0) >= 50,
    `${state?.fps} FPS, RTT ${state?.rtt} ms`,
  );
  await browser.close();
}

console.info(`Auditoria de ${base}\n`);
try {
  await checkTls();
  await checkHttp();
  await checkSocket();
  if (useBrowser) await checkBrowser();
} catch (err) {
  check('Auditoria completa', false, err instanceof Error ? err.message : String(err));
}
const failed = results.filter((r) => !r.ok).length;
console.info(`\n${results.length - failed} de ${results.length} comprobaciones correctas`);
process.exit(failed === 0 ? 0 : 1);
