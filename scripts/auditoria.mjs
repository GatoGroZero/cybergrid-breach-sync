// Auditoria estricta con la rubrica de los Lineamientos Oficiales (Proyecto 1: CyberGrid, Breach & Sync).
// Califica los 5 modulos del PDF (25 + 25 + 20 + 15 + 15 = 100 puntos) con comprobaciones que se
// pueden repetir, y puede correr varias rondas seguidas para exigir 100 de 100 cada vez.
//
// Uso: node scripts/auditoria.mjs <url> [--rondas 3] [--repo GatoGroZero/cybergrid-breach-sync]
//
// No usa nada del servidor que no vea el evaluador: peticiones HTTP nuevas, WebSocket y un navegador
// real (escritorio y emulador de celular).
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? process.env.AUDIT_URL ?? '').replace(
  /\/$/,
  '',
);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const rounds = Math.max(1, Number(flag('--rondas', '1')));
const repoSlug = flag('--repo', 'GatoGroZero/cybergrid-breach-sync');
if (!base) {
  console.error('Uso: node scripts/auditoria.mjs <url> [--rondas 3] [--repo dueno/repo]');
  process.exit(2);
}
const url = new URL(base);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const MODULES = [
  { id: 1, name: 'Arquitectura de Red y Sockets', weight: 25 },
  { id: 2, name: 'Motor Canvas 2D y Controles', weight: 25 },
  { id: 3, name: 'Endpoints de Prueba y Telemetria', weight: 20 },
  { id: 4, name: 'Pruebas Automatizadas y CI/CD', weight: 15 },
  { id: 5, name: 'Despliegue en Produccion', weight: 15 },
];

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0;
};
const f = (n) => `${Math.round(n * 10) / 10} ms`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Peticion HTTPS. Con `reuse` se mantiene la conexion abierta (como un navegador despues de la primera). */
function makeClient(reuse) {
  const agent = new https.Agent({ keepAlive: reuse, maxSockets: 1 });
  return (p, { method = 'GET', body } = {}) =>
    new Promise((resolve, reject) => {
      const t0 = performance.now();
      const req = https.request(
        {
          host: url.hostname,
          port: url.port || 443,
          path: p,
          method,
          agent,
          timeout: 70_000,
          headers: body ? { 'Content-Type': 'application/json' } : {},
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
              text,
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

/** Un solo intento de auditoria: devuelve los puntos por modulo y el detalle. */
async function auditOnce(round) {
  const lines = [];
  const earned = new Map(MODULES.map((m) => [m.id, 0]));
  const lost = [];
  function check(mod, points, name, ok, detail = '') {
    if (ok) earned.set(mod, (earned.get(mod) ?? 0) + points);
    else lost.push(`M${mod} ${name}${detail ? ` (${detail})` : ''}`);
    lines.push(
      `  ${ok ? 'OK   ' : 'FALLA'} [M${mod} ${String(points).padStart(2)} pts] ${name}${detail ? `: ${detail}` : ''}`,
    );
  }
  const guard = async (mod, points, name, fn) => {
    try {
      const r = await fn();
      check(mod, points, name, r.ok, r.detail);
    } catch (err) {
      check(mod, points, name, false, err instanceof Error ? err.message : String(err));
    }
  };

  const fresh = makeClient(false);
  const warm = makeClient(true);

  // ---------------------------------------------------------------- sesion de invitado para las pruebas de socket
  const guest = await fresh('/api/auth/guest', { method: 'POST', body: {} });
  const cookie = String(guest.headers['set-cookie']?.[0] ?? '').split(';')[0];

  // ================================================================ M1 Red y sockets (25)
  await guard(1, 4, 'WebSocket real en el navegador, sin sondeo (polling)', async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext({ baseURL: base })).newPage();
      let opened = 0;
      let received = 0;
      const polling = [];
      page.on('request', (r) => {
        if (r.url().includes('transport=polling')) polling.push(r.url());
      });
      page.on('websocket', (ws) => {
        opened++;
        ws.on('framereceived', () => received++);
      });
      await page.goto('/?debug');
      await page.getByTestId('btn-guest').click();
      await page.getByTestId('nick-save').click();
      await page.getByTestId('btn-solo').click();
      await page.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 20, null, {
        timeout: 60_000,
      });
      return {
        ok: opened >= 1 && received > 20 && polling.length === 0,
        detail: `${opened} socket(s), ${received} tramas recibidas, ${polling.length} peticiones polling`,
      };
    } finally {
      await browser.close();
    }
  });

  await guard(
    1,
    4,
    'Sin sesion no se entra al socket; con sesion si (proteccion de salas)',
    async () => {
      const anon = io(base, { transports: ['websocket'], reconnection: false });
      const rejected = await new Promise((resolve) => {
        anon.once('connect_error', (e) => resolve(e.message));
        anon.once('connect', () => resolve('conectado'));
      });
      anon.close();
      const socket = io(base, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie },
      });
      const accepted = await new Promise((resolve) => {
        socket.once('connect', () => resolve(true));
        socket.once('connect_error', () => resolve(false));
      });
      socket.close();
      return {
        ok: rejected === 'unauthorized' && accepted === true,
        detail: `anonimo: ${rejected}; con sesion: ${accepted}`,
      };
    },
  );

  // ping/pong: la metrica central del modulo
  const rtts = [];
  await guard(1, 8, 'Latencia ping/pong < 100 ms (mediana de 60 mediciones)', async () => {
    const socket = io(base, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie },
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      const pong = new Promise((resolve) => socket.once('pong', resolve));
      socket.emit('ping', { t: t0 });
      await pong;
      rtts.push(performance.now() - t0);
      await sleep(80);
    }
    socket.close();
    return {
      ok: pct(rtts, 0.5) < 100,
      detail: `min ${f(Math.min(...rtts))}, p50 ${f(pct(rtts, 0.5))}, p95 ${f(pct(rtts, 0.95))}, max ${f(Math.max(...rtts))}`,
    };
  });

  await guard(
    1,
    5,
    'Autoridad del servidor: el cliente no puede acelerar ni teletransportarse',
    async () => {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch();
      try {
        const page = await (await browser.newContext({ baseURL: base })).newPage();
        await page.goto('/?debug');
        await page.getByTestId('btn-guest').click();
        await page.getByTestId('nick-save').click();
        await page.getByTestId('btn-solo').click();
        await page.waitForFunction(
          () =>
            window.__cybergrid &&
            window.__cybergrid.intro === 0 &&
            window.__cybergrid.snapshots > 10,
          null,
          { timeout: 60_000 },
        );
        const server = () =>
          page.evaluate(() => ({ x: window.__game.latest.me.x, y: window.__game.latest.me.y }));
        const a = await server();
        // un cliente tramposo: valores fuera de rango y campos de posicion que el protocolo no tiene
        const reply = await page.evaluate(() => {
          const s = window.__net.socket;
          for (let i = 0; i < 40; i++) {
            s.emit('game:input', {
              seq: 900000 + i,
              mx: 500,
              my: 0,
              aim: 0,
              fire: false,
              x: 99999,
              y: 99999,
            });
            s.emit('game:input', {
              seq: 900100 + i,
              mx: 1,
              my: 0,
              aim: 0,
              fire: false,
              run: true,
              speed: 9999,
            });
          }
          return true;
        });
        await sleep(2500);
        const b = await server();
        const moved = Math.hypot(b.x - a.x, b.y - a.y);
        // 2.5 s a 78 px/s (con correr a lo mas el doble) y un poco de holgura de red
        return {
          ok: reply && moved <= 78 * 2.5 * 2 + 20 && Math.abs(b.x) < 5000,
          detail: `se movio ${Math.round(moved)} px en 2.5 s (tope fisico ${78 * 5})`,
        };
      } finally {
        await browser.close();
      }
    },
  );

  await guard(
    1,
    4,
    'El servidor emite el estado a 20 Hz o mas y publica su tick en la telemetria',
    async () => {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch();
      try {
        const page = await (await browser.newContext({ baseURL: base })).newPage();
        let snaps = 0;
        page.on('websocket', (ws) =>
          ws.on('framereceived', (fr) => {
            if (String(fr.payload).startsWith('42["game:snap"')) snaps++;
          }),
        );
        await page.goto('/');
        await page.getByTestId('btn-guest').click();
        await page.getByTestId('nick-save').click();
        await page.getByTestId('btn-solo').click();
        await page.waitForFunction(
          () => window.__cybergrid && window.__cybergrid.intro === 0,
          null,
          { timeout: 60_000 },
        );
        const s0 = snaps;
        await sleep(3000);
        const rate = (snaps - s0) / 3;
        const t = await fresh('/api/test/telemetry');
        return {
          ok: rate >= 20 && t.json?.server?.tickHz >= 20,
          detail: `${Math.round(rate)} estados por segundo, tick ${t.json?.server?.tickHz} Hz`,
        };
      } finally {
        await browser.close();
      }
    },
  );

  // ================================================================ M2 Canvas y controles (25)
  await guard(2, 4, '60 FPS estables en escritorio (mediana de 8 s, minimo 50)', async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await (
        await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 720 } })
      ).newPage();
      await page.goto('/?debug');
      await page.getByTestId('btn-guest').click();
      await page.getByTestId('nick-save').click();
      await page.getByTestId('btn-solo').click();
      await page.waitForFunction(
        () =>
          window.__cybergrid && window.__cybergrid.intro === 0 && window.__cybergrid.snapshots > 10,
        null,
        { timeout: 60_000 },
      );
      await sleep(3000);
      const fps = [];
      const draw = [];
      for (let i = 0; i < 8; i++) {
        await sleep(1000);
        const s = await page.evaluate(() => window.__cybergrid);
        fps.push(s.fps);
        draw.push(s.drawMs);
      }
      return {
        ok: pct(fps, 0.5) >= 58 && Math.min(...fps) >= 50,
        detail: `mediana ${pct(fps, 0.5)} FPS, minimo ${Math.min(...fps)}, dibujo ${pct(draw, 0.5).toFixed(1)} ms por cuadro`,
      };
    } finally {
      await browser.close();
    }
  });

  await guard(
    2,
    6,
    'Tiempo delta: la misma distancia a 60 FPS y con el navegador frenado 4 veces',
    async () => {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({
          baseURL: base,
          viewport: { width: 1280, height: 720 },
        });
        const page = await ctx.newPage();
        await page.goto('/?debug');
        await page.getByTestId('btn-guest').click();
        await page.getByTestId('nick-save').click();
        await page.getByTestId('btn-solo').click();
        await page.waitForFunction(
          () =>
            window.__cybergrid &&
            window.__cybergrid.intro === 0 &&
            window.__cybergrid.snapshots > 10,
          null,
          { timeout: 60_000 },
        );
        const pos = () => page.evaluate(() => ({ x: window.__game.x, y: window.__game.y }));
        const cdp = await ctx.newCDPSession(page);
        // se busca un rumbo libre y se vuelve por el mismo camino (ya despejado) con el navegador frenado
        const pairs = [
          ['KeyD', 'KeyA'],
          ['KeyS', 'KeyW'],
          ['KeyA', 'KeyD'],
          ['KeyW', 'KeyS'],
        ];
        let there = 0;
        let back = 0;
        let fpsFast = 0;
        let fpsSlow = 0;
        for (const [go, ret] of pairs) {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          await sleep(500);
          const a = await pos();
          await page.keyboard.down(go);
          await sleep(1200);
          fpsFast = await page.evaluate(() => window.__cybergrid.fps);
          await page.keyboard.up(go);
          const b = await pos();
          there = Math.hypot(b.x - a.x, b.y - a.y);
          if (there < 80) continue;
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await sleep(700);
          await page.keyboard.down(ret);
          await sleep(1200);
          fpsSlow = await page.evaluate(() => window.__cybergrid.fps);
          await page.keyboard.up(ret);
          const c = await pos();
          back = Math.hypot(c.x - b.x, c.y - b.y);
          break;
        }
        const ratio = back / Math.max(1, there);
        return {
          ok: there >= 80 && ratio > 0.8 && ratio < 1.2,
          detail: `${Math.round(there)} px a ${fpsFast} FPS y ${Math.round(back)} px a ${fpsSlow} FPS (razon ${ratio.toFixed(2)})`,
        };
      } finally {
        await browser.close();
      }
    },
  );

  await guard(
    2,
    5,
    'PC: las teclas mueven al gato y los controles tactiles quedan ocultos',
    async () => {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch();
      try {
        const page = await (
          await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 720 } })
        ).newPage();
        await page.goto('/?debug');
        await page.getByTestId('btn-guest').click();
        await page.getByTestId('nick-save').click();
        await page.getByTestId('btn-solo').click();
        await page.waitForFunction(
          () =>
            window.__cybergrid &&
            window.__cybergrid.intro === 0 &&
            window.__cybergrid.snapshots > 10,
          null,
          { timeout: 60_000 },
        );
        const read = () =>
          page
            .getByTestId('hud-coords')
            .evaluate((el) => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) }));
        const a = await read();
        let moved = 0;
        for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
          await page.keyboard.down(key);
          await sleep(600);
          await page.keyboard.up(key);
          const b = await read();
          moved = Math.hypot(b.x - a.x, b.y - a.y);
          if (moved > 8) break;
        }
        const mode = await page.evaluate(() => window.__cybergrid.mode);
        return {
          ok: moved > 8 && mode === 'keyboard',
          detail: `modo ${mode}, coordenadas cambiaron ${Math.round(moved)} px`,
        };
      } finally {
        await browser.close();
      }
    },
  );

  await guard(
    2,
    7,
    'Celular: joystick abajo a la izquierda, boton de accion abajo a la derecha',
    async () => {
      const { chromium, devices } = await import('@playwright/test');
      const browser = await chromium.launch();
      try {
        const page = await (
          await browser.newContext({ ...devices['Pixel 7 landscape'], baseURL: base })
        ).newPage();
        await page.goto('/?debug');
        await page.getByTestId('btn-guest').click();
        await page.getByTestId('nick-save').click();
        await page.getByTestId('btn-solo').click();
        await page.waitForFunction(
          () =>
            window.__cybergrid &&
            window.__cybergrid.intro === 0 &&
            window.__cybergrid.snapshots > 10,
          null,
          { timeout: 60_000 },
        );
        await sleep(1500);
        const state = await page.evaluate(() => {
          const l = window.__game.input.touchLayout;
          return {
            mode: window.__cybergrid.mode,
            stick: l.stick,
            aim: l.aim,
            interact: l.interact,
          };
        });
        const stickOk = state.stick.x < 0.5 && state.stick.y > 0.5;
        const actionOk =
          state.aim.x > 0.5 &&
          state.aim.y > 0.5 &&
          state.interact.x > 0.5 &&
          state.interact.y > 0.5;
        // mover con el dedo en el joystick cambia la posicion
        const vp = page.viewportSize();
        const before = await page.evaluate(() => ({ x: window.__game.x, y: window.__game.y }));
        const cx = state.stick.x * vp.width;
        const cy = state.stick.y * vp.height;
        const cdp = await page.context().newCDPSession(page);
        const touch = (type, x, y) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
          });
        await touch('touchStart', cx, cy);
        for (let i = 1; i <= 8; i++) {
          await touch('touchMove', cx + i * 7, cy);
          await sleep(100);
        }
        await sleep(600);
        const after = await page.evaluate(() => ({ x: window.__game.x, y: window.__game.y }));
        await touch('touchEnd', 0, 0);
        const moved = Math.hypot(after.x - before.x, after.y - before.y);
        return {
          ok: state.mode === 'touch' && stickOk && actionOk && moved > 8,
          detail: `modo ${state.mode}, joystick (${state.stick.x.toFixed(2)}, ${state.stick.y.toFixed(2)}), accion (${state.aim.x.toFixed(2)}, ${state.aim.y.toFixed(2)}), el dedo movio ${Math.round(moved)} px`,
        };
      } finally {
        await browser.close();
      }
    },
  );

  await guard(2, 3, 'Celular: 60 FPS estables en el emulador (mediana de 8 s)', async () => {
    const { chromium, devices } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await (
        await browser.newContext({ ...devices['Pixel 7 landscape'], baseURL: base })
      ).newPage();
      await page.goto('/');
      await page.getByTestId('btn-guest').click();
      await page.getByTestId('nick-save').click();
      await page.getByTestId('btn-solo').click();
      await page.waitForFunction(
        () =>
          window.__cybergrid && window.__cybergrid.intro === 0 && window.__cybergrid.snapshots > 10,
        null,
        { timeout: 60_000 },
      );
      await sleep(3000);
      const fps = [];
      for (let i = 0; i < 8; i++) {
        await sleep(1000);
        fps.push(await page.evaluate(() => window.__cybergrid.fps));
      }
      return {
        ok: pct(fps, 0.5) >= 55,
        detail: `mediana ${pct(fps, 0.5)} FPS, minimo ${Math.min(...fps)}`,
      };
    } finally {
      await browser.close();
    }
  });

  // ================================================================ M3 Endpoints (20)
  const tele = [];
  let teleOk = true;
  let fieldsOk = true;
  let serverTiming = true;
  for (let i = 0; i < 20; i++) {
    const r = await fresh('/api/test/telemetry');
    tele.push(r.ms);
    if (r.status !== 200) teleOk = false;
    const j = r.json;
    if (!(
      typeof j?.winRate === 'number' &&
      typeof j?.kdr === 'number' &&
      typeof j?.survivability?.survivalRate === 'number'
    ))
      fieldsOk = false;
    if (!r.headers['server-timing']) serverTiming = false;
    await sleep(60);
  }
  check(
    3,
    4,
    'GET /api/test/telemetry: HTTP 200 con winRate, kdr y supervivencia (20 de 20)',
    teleOk && fieldsOk,
  );
  check(
    3,
    4,
    'GET /api/test/telemetry < 200 ms con conexion nueva (mediana de 20)',
    pct(tele, 0.5) < 200,
    `p50 ${f(pct(tele, 0.5))}, p95 ${f(pct(tele, 0.95))}, max ${f(Math.max(...tele))}`,
  );
  const warmT = [];
  for (let i = 0; i < 20; i++) {
    const r = await warm('/api/test/telemetry');
    warmT.push(r.ms);
  }
  check(
    3,
    2,
    'GET /api/test/telemetry < 200 ms con conexion reutilizada (p95 de 20) y Server-Timing publicado',
    pct(warmT, 0.95) < 200 && serverTiming,
    `p50 ${f(pct(warmT, 0.5))}, p95 ${f(pct(warmT, 0.95))}`,
  );

  const seedTimes = [];
  for (const count of [100, 1000]) {
    await guard(
      3,
      3,
      `POST /api/test/seed con ${count} partidas: HTTP 200, datos reflejados y consulta rapida`,
      async () => {
        const r = await warm('/api/test/seed', { method: 'POST', body: { count, winRate: 0.6 } });
        seedTimes.push(r.ms);
        const t = await warm('/api/test/telemetry');
        const queryMs = Number(r.json?.queryMs ?? r.json?.meta?.queryMs ?? 0);
        return {
          ok:
            r.status === 200 &&
            r.json?.inserted === count &&
            t.json?.matches?.total >= count &&
            queryMs < 50,
          detail: `HTTP ${r.status}, ${f(r.ms)} en total, consulta ${queryMs} ms`,
        };
      },
    );
  }
  check(
    3,
    2,
    'POST /api/test/seed responde < 200 ms (conexion reutilizada, mediana de las dos siembras)',
    pct(seedTimes, 0.5) < 200,
    seedTimes.map(f).join(', '),
  );
  await guard(
    3,
    2,
    'Payload invalido se rechaza (400) y DELETE /api/test/seed limpia',
    async () => {
      const bad = await warm('/api/test/seed', { method: 'POST', body: { count: 99999 } });
      const clean = await warm('/api/test/seed', { method: 'DELETE' });
      return {
        ok: bad.status === 400 && clean.status === 200,
        detail: `invalido HTTP ${bad.status}, limpiar HTTP ${clean.status}`,
      };
    },
  );

  // ================================================================ M4 Pruebas y CI (15)
  await guard(
    4,
    4,
    'ci.yml se ejecuta en cada Pull Request y corre unitarias, E2E y compilacion',
    async () => {
      const yml = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
      const hasPr = /^\s*pull_request:/m.test(yml);
      const hasPush = /^\s*push:/m.test(yml);
      const runsUnit = /npm run test/.test(yml);
      const runsE2e = /playwright test/.test(yml);
      const builds = /npm run build/.test(yml);
      return {
        ok: hasPr && hasPush && runsUnit && runsE2e && builds,
        detail: `pull_request ${hasPr}, push ${hasPush}, unitarias ${runsUnit}, E2E ${runsE2e}, build ${builds}`,
      };
    },
  );
  await guard(
    4,
    4,
    'Al menos 10 pruebas unitarias que cubren mapas, dano, esquemas Zod e interpolacion',
    async () => {
      const dir = path.join(root, 'tests/unit');
      const files = fs.readdirSync(dir).filter((n) => n.endsWith('.test.ts'));
      let count = 0;
      let all = '';
      for (const n of files) {
        const src = fs.readFileSync(path.join(dir, n), 'utf8');
        count += (src.match(/^\s*(it|test)\(/gm) ?? []).length;
        all += `\n${n}\n${src}`;
      }
      const topics = {
        mapa: /map/i.test(files.join(' ')),
        dano: /combat|damage|dano/i.test(files.join(' ')),
        zod: /schema|zod/i.test(all),
        interpolacion: /interp/i.test(files.join(' ')),
      };
      return {
        ok: count >= 10 && Object.values(topics).every(Boolean),
        detail: `${count} pruebas en ${files.length} archivos; ${Object.entries(topics)
          .map(([k, v]) => `${k} ${v ? 'si' : 'no'}`)
          .join(', ')}`,
      };
    },
  );
  await guard(
    4,
    3,
    'Tres flujos E2E: autenticacion, lobbies con Listo y sockets, canvas con cambio de coordenadas',
    async () => {
      const dir = path.join(root, 'tests/e2e');
      const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
      const auth = /rutas?\s+protegida|credenciales|protegidas/i.test(
        read('1-autenticacion.spec.ts'),
      );
      const lobby =
        /btn-ready/.test(read('2-lobby.spec.ts')) &&
        /Listo/.test(read('2-lobby.spec.ts')) &&
        /game|socket/i.test(read('2-lobby.spec.ts'));
      const canvas =
        /hud-coords|coords\(/.test(read('3-canvas.spec.ts')) &&
        /toBe\(true\)|toBeGreaterThan|toBeLessThan/.test(read('3-canvas.spec.ts'));
      return {
        ok: auth && lobby && canvas,
        detail: `autenticacion ${auth}, lobbies ${lobby}, canvas ${canvas}`,
      };
    },
  );
  await guard(
    4,
    4,
    'Pipeline en verde en el historial de GitHub (las 3 ultimas ejecuciones terminadas en main)',
    async () => {
      const out = execFileSync(
        'gh',
        [
          'api',
          `repos/${repoSlug}/actions/workflows/ci.yml/runs?branch=main&per_page=8`,
          '--jq',
          '.workflow_runs | map({c: .conclusion, s: .status, t: .head_sha[0:7]})',
        ],
        { encoding: 'utf8' },
      );
      const runs = JSON.parse(out);
      const done = runs.filter((r) => r.s === 'completed').slice(0, 3);
      const green = done.every((r) => r.c === 'success');
      return {
        ok: done.length === 3 && green && runs[0]?.s === 'completed',
        detail: `${done.filter((r) => r.c === 'success').length} de ${done.length} verdes, la mas reciente ${runs[0]?.s}/${runs[0]?.c}`,
      };
    },
  );

  // ================================================================ M5 Despliegue (15)
  await guard(5, 4, 'URL publica con https que sirve el juego', async () => {
    const r = await fresh('/');
    const health = await fresh('/api/test/health');
    return {
      ok: r.status === 200 && /<canvas/i.test(r.text) && health.status === 200,
      detail: `/ HTTP ${r.status}, health HTTP ${health.status}`,
    };
  });
  await guard(
    5,
    5,
    'Certificado SSL valido (TLS 1.2 o mas, vigente mas de 14 dias, nombre correcto)',
    async () => {
      const info = await new Promise((resolve, reject) => {
        const socket = tls.connect(
          { host: url.hostname, port: 443, servername: url.hostname },
          () => {
            const cert = socket.getPeerCertificate();
            resolve({
              authorized: socket.authorized,
              error: socket.authorizationError,
              protocol: socket.getProtocol(),
              days: Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000),
              issuer: cert.issuer?.O,
            });
            socket.end();
          },
        );
        socket.on('error', reject);
      });
      return {
        ok: info.authorized && /TLSv1\.[23]/.test(info.protocol) && info.days > 14,
        detail: `${info.protocol}, emisor ${info.issuer}, vence en ${info.days} dias${info.error ? `, error ${info.error}` : ''}`,
      };
    },
  );
  await guard(
    5,
    3,
    'Disponibilidad: 15 respuestas seguidas con HTTP 200 y servicio despierto',
    async () => {
      let bad = 0;
      let slowest = 0;
      for (let i = 0; i < 15; i++) {
        const r = await fresh('/api/test/health');
        if (r.status !== 200) bad++;
        slowest = Math.max(slowest, r.ms);
        await sleep(150);
      }
      return {
        ok: bad === 0 && slowest < 2000,
        detail: `${bad} fallas, la mas lenta ${f(slowest)}`,
      };
    },
  );
  await guard(
    5,
    3,
    'La plataforma es Render (o Railway/Vercel) y entrega cabeceras de seguridad',
    async () => {
      const r = await fresh('/');
      const platform = Boolean(
        r.headers['rndr-id'] ||
        r.headers['x-render-origin-server'] ||
        /render/i.test(String(r.headers['x-render-routing'] ?? '')) ||
        r.headers['x-railway-request-id'] ||
        r.headers['x-vercel-id'],
      );
      const secure =
        Boolean(r.headers['content-security-policy']) &&
        String(r.headers['strict-transport-security'] ?? '').includes('max-age');
      return { ok: platform && secure, detail: `plataforma ${platform}, CSP+HSTS ${secure}` };
    },
  );

  const score = MODULES.map((m) => ({ ...m, got: earned.get(m.id) ?? 0 }));
  const total = score.reduce((a, m) => a + m.got, 0);
  console.info(`\n===== Auditoria ${round} de ${rounds} =====`);
  for (const l of lines) console.info(l);
  console.info('\n  Modulo                                   Peso   Puntos');
  for (const m of score)
    console.info(
      `  ${m.name.padEnd(40)} ${String(m.weight).padStart(3)} %   ${String(m.got).padStart(3)}`,
    );
  console.info(
    `\n  PUNTAJE: ${total} / 100${lost.length ? `\n  Se perdieron puntos en:\n    ${lost.join('\n    ')}` : ''}`,
  );
  return { total, lost };
}

console.info(`Auditoria estricta de ${base} (${rounds} ronda${rounds === 1 ? '' : 's'})\n`);
const totals = [];
for (let i = 1; i <= rounds; i++) {
  try {
    totals.push((await auditOnce(i)).total);
  } catch (err) {
    console.error('La auditoria se interrumpio:', err instanceof Error ? err.message : err);
    totals.push(0);
  }
  if (i < rounds) await sleep(2000);
}
const perfect = totals.filter((t) => t === 100).length;
console.info(`\nResumen: ${totals.join(', ')}  (${perfect} de ${rounds} con 100/100)`);
process.exit(perfect === rounds ? 0 : 1);
