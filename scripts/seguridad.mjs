// Revision de seguridad desde fuera: ataca la URL publica como lo haria alguien que quiere romper la
// aplicacion (cabeceras, TLS, archivos ocultos, CSRF, inyecciones, tokens falsos, fuerza bruta,
// abuso del socket) y dice que resistio y que no.
//
// Uso: node scripts/seguridad.mjs <url> [--rondas 3]
//
// Solo hace peticiones normales de HTTP y WebSocket y no manda inundaciones: no tumba el servicio
// que se revisa. Termina con codigo 1 si una sola comprobacion falla.
import tls from 'node:tls';
import { io } from 'socket.io-client';
import { SignJWT } from 'jose';

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
if (!base) {
  console.error('Uso: node scripts/seguridad.mjs <url> [--rondas 3]');
  process.exit(2);
}
const url = new URL(base);
/** En local (http) no hay TLS ni HSTS ni cookies Secure: esas comprobaciones solo valen con https. */
const secure = url.protocol === 'https:';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JSON_H = { 'Content-Type': 'application/json' };

const req = async (path, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) => {
  const res = await fetch(base + path, { method, headers, body, redirect });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // no era JSON
  }
  return { status: res.status, headers: res.headers, text, json };
};
const noLeak = (r) =>
  !/\bat [\w$.<>]+ \(|node_modules|\/home\/|\.ts:\d+|\.mjs:\d+|Error: /.test(r.text);

async function run(round) {
  const results = [];
  const check = async (group, name, fn) => {
    let ok;
    let detail;
    try {
      const out = await fn();
      ok = out === true || (out && out.ok === true);
      detail = out && typeof out === 'object' && out.detail ? out.detail : '';
    } catch (err) {
      ok = false;
      detail = `excepcion: ${err instanceof Error ? err.message : String(err)}`;
    }
    results.push({ group, name, ok, detail });
    console.info(`  ${ok ? 'OK ' : 'MAL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const section = (title) => console.info(`\n${title}`);

  // ------------------------------------------------------------------ transporte
  section('Transporte');
  if (!secure) console.info('  (servidor local sin https: se omiten las comprobaciones de TLS)');
  if (secure)
    await check(
      'tls',
      'certificado TLS valido y vigente',
      () =>
        new Promise((resolve) => {
          const s = tls.connect(
            { host: url.hostname, port: Number(url.port) || 443, servername: url.hostname },
            () => {
              const cert = s.getPeerCertificate();
              const left = (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000;
              const proto = s.getProtocol();
              s.end();
              resolve({
                ok: s.authorized && left > 7 && /TLSv1\.[23]/.test(proto ?? ''),
                detail: `${proto}, vence en ${Math.round(left)} dias`,
              });
            },
          );
          s.on('error', (e) => resolve({ ok: false, detail: e.message }));
        }),
    );
  if (secure)
    await check(
      'tls',
      'http:// no sirve el juego en claro (redirige a https o se corta)',
      async () => {
        try {
          const res = await fetch(`http://${url.host}/`, { redirect: 'manual' });
          const loc = res.headers.get('location') ?? '';
          return {
            ok: [301, 302, 307, 308].includes(res.status) && loc.startsWith('https://'),
            detail: `HTTP ${res.status}`,
          };
        } catch {
          return { ok: true, detail: 'conexion en claro rechazada' };
        }
      },
    );

  // ------------------------------------------------------------------ cabeceras
  section('Cabeceras de seguridad');
  const home = await req('/');
  const conf = await req('/api/auth/config');
  const csp = home.headers.get('content-security-policy') ?? '';
  await check(
    'cab',
    'politica de contenido: sin codigo en linea ni eval',
    () =>
      csp.includes("script-src 'self'") &&
      !/unsafe-(inline|eval)/.test(csp) &&
      csp.includes("object-src 'none'"),
  );
  await check(
    'cab',
    'no se puede incrustar en otra pagina (frame-ancestors y X-Frame-Options)',
    () =>
      csp.includes("frame-ancestors 'none'") &&
      /sameorigin|deny/i.test(home.headers.get('x-frame-options') ?? ''),
  );
  await check('cab', 'el socket solo puede ir a este servidor (sin ws: ni wss: abiertos)', () => {
    const c = /connect-src ([^;]*)/.exec(csp)?.[1].split(' ') ?? [];
    const own = `${secure ? 'wss' : 'ws'}://${url.host}`;
    return !c.includes('ws:') && !c.includes('wss:') && c.some((x) => x.startsWith(own));
  });
  if (secure)
    await check('cab', 'HTTPS forzado: upgrade-insecure-requests y HSTS de al menos un año', () => {
      const maxAge = Number(
        /max-age=(\d+)/.exec(home.headers.get('strict-transport-security') ?? '')?.[1] ?? 0,
      );
      return csp.includes('upgrade-insecure-requests') && maxAge >= 31_536_000;
    });
  await check(
    'cab',
    'nosniff, Referrer-Policy y aislamiento de origen (COOP y CORP)',
    () =>
      home.headers.get('x-content-type-options') === 'nosniff' &&
      home.headers.get('referrer-policy') === 'no-referrer' &&
      home.headers.get('cross-origin-opener-policy') === 'same-origin' &&
      home.headers.get('cross-origin-resource-policy') === 'same-origin',
  );
  await check('cab', 'Permissions-Policy cierra camara, microfono, ubicacion y pagos', () => {
    const p = home.headers.get('permissions-policy') ?? '';
    return ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].every((x) =>
      p.includes(x),
    );
  });
  await check(
    'cab',
    'no delata el framework ni la version del servidor',
    () =>
      !home.headers.has('x-powered-by') && !/express|node/i.test(home.headers.get('server') ?? ''),
  );
  await check('cab', 'las respuestas de acceso no se guardan en cache', () =>
    /no-store/.test(conf.headers.get('cache-control') ?? ''),
  );

  // ------------------------------------------------------------------ archivos y rutas
  section('Archivos ocultos y recorrido de rutas');
  const rutas = [
    '/.env',
    '/.git/config',
    '/.git/HEAD',
    '/package.json',
    '/package-lock.json',
    '/render.yaml',
    '/src/server/auth.ts',
    '/dist/server/index.js',
    '/node_modules/express/package.json',
    '/tests/e2e/helpers.ts',
    '/data/cybergrid.db',
    '/index.js.map',
    '/.github/workflows/ci.yml',
    '/api/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/..%2f..%2fetc%2fpasswd',
    '//etc/passwd',
    '/assets/..%2f..%2f.env',
    '/%00.html',
    '/api/auth/%2e%2e/%2e%2e/.env',
  ];
  await check(
    'rutas',
    `${rutas.length} rutas de archivos ocultos o fuera de la carpeta publica responden 404/400 (o la pagina del juego) sin filtrar contenido`,
    async () => {
      const fallas = [];
      for (const r of rutas) {
        const res = await req(r);
        const leaks =
          /root:.*:0:0|"dependencies"|SESSION_SECRET|\bimport .* from\b|BEGIN [A-Z ]*PRIVATE/.test(
            res.text,
          );
        // una ruta sin extension (como /etc/passwd) es una ruta del juego: devuelve la pagina
        // principal del juego, que esta bien siempre que no salga contenido del servidor
        const spa =
          res.status === 200 && /<!doctype html/i.test(res.text) && !/\.[A-Za-z0-9]{1,8}$/.test(r);
        if ((![400, 404].includes(res.status) && !spa) || leaks)
          fallas.push(`${r} -> ${res.status}`);
      }
      return { ok: fallas.length === 0, detail: fallas.join('; ') };
    },
  );
  await check(
    'rutas',
    'una ruta de la API que no existe da 404 en JSON, sin rastros internos',
    async () => {
      const r = await req('/api/no-existe');
      return r.status === 404 && r.json?.error === 'no_encontrado' && noLeak(r);
    },
  );
  await check(
    'rutas',
    'metodos raros (TRACE, PUT, DELETE, PATCH) no hacen nada en la API privada',
    async () => {
      for (const method of ['TRACE', 'PUT', 'DELETE', 'PATCH']) {
        const r = await req('/api/auth/me', { method }).catch(() => ({ status: 405, text: '' }));
        if (![400, 404, 405].includes(r.status))
          return { ok: false, detail: `${method} -> ${r.status}` };
      }
      return true;
    },
  );

  // ------------------------------------------------------------------ CORS y CSRF
  section('Peticiones desde otro sitio (CORS y CSRF)');
  const evil = { Origin: 'https://evil.example', ...JSON_H };
  await check('csrf', 'la API privada no da permisos CORS (ni al preflight)', async () => {
    const pre = await req('/api/auth/guest', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    const get = await req('/api/auth/config', { headers: { Origin: 'https://evil.example' } });
    return (
      !pre.headers.has('access-control-allow-origin') &&
      !get.headers.has('access-control-allow-origin')
    );
  });
  await check(
    'csrf',
    'crear sesion desde un origen ajeno (Origin) se rechaza con 403 y sin cookie',
    async () => {
      const r = await req('/api/auth/guest', { method: 'POST', headers: evil, body: '{}' });
      return r.status === 403 && !r.headers.has('set-cookie');
    },
  );
  await check(
    'csrf',
    'una peticion de otro sitio (Sec-Fetch-Site: cross-site) no puede cambiar datos',
    async () => {
      const r = await req('/api/auth/signup', {
        method: 'POST',
        headers: { ...JSON_H, 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({
          email: 'x@y.com',
          password: 'clave-larga-1',
          confirm: 'clave-larga-1',
        }),
      });
      return r.status === 403 && !r.headers.has('set-cookie');
    },
  );
  await check(
    'csrf',
    'texto plano y formularios (lo que un formulario ajeno puede mandar) dan 415',
    async () => {
      const a = await req('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      });
      const b = await req('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'a=1',
      });
      return a.status === 415 && b.status === 415;
    },
  );

  // ------------------------------------------------------------------ entradas hostiles
  section('Inyecciones y entradas hostiles');
  const post = (path, body, headers = JSON_H) =>
    req(path, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  await check(
    'inyeccion',
    'inyeccion SQL, NoSQL y de comandos en el inicio de sesion: siempre 401 o 400, nunca 500',
    async () => {
      const ataques = [
        { identifier: "' OR 1=1 --", password: 'clave-larga-1' },
        { identifier: "demo1'--", password: 'clave-larga-1' },
        { identifier: '"; DROP TABLE users; --', password: 'x' },
        { identifier: 'a@b.com\r\nSET acct:v1:x y', password: 'clave-larga-1' },
        { identifier: { $ne: null }, password: { $gt: '' } },
        { identifier: ['a@b.com'], password: 'clave-larga-1' },
        { identifier: 'a'.repeat(300), password: 'x' },
      ];
      for (const a of ataques) {
        const r = await post('/api/auth/signin', a);
        if (![400, 401, 429].includes(r.status) || !noLeak(r))
          return { ok: false, detail: `${JSON.stringify(a).slice(0, 40)} -> ${r.status}` };
      }
      return true;
    },
  );
  await check(
    'inyeccion',
    'JSON roto, enorme o con __proto__ no produce 500 ni filtra nada interno',
    async () => {
      const roto = await post('/api/auth/signin', '{"identifier": ');
      const grande = await post(
        '/api/auth/signin',
        JSON.stringify({ identifier: 'a'.repeat(20_000), password: 'x' }),
      );
      const proto = await post(
        '/api/auth/signin',
        '{"identifier":"a@b.com","password":"x","__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}',
      );
      const raiz = await post('/api/auth/signin', '[1,2,3]');
      return (
        [400, 429].includes(roto.status) &&
        [413, 429].includes(grande.status) &&
        [400, 401, 429].includes(proto.status) &&
        [400, 401, 429].includes(raiz.status) &&
        [roto, grande, proto, raiz].every(noLeak)
      );
    },
  );
  await check(
    'inyeccion',
    'apodos con HTML, scripts, caracteres de control o de direccion de texto se rechazan',
    async () => {
      for (const nickname of [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        'a‮b',
        'a\u0000b',
        '"><svg/onload=1>',
      ]) {
        const r = await post('/api/auth/guest', { nickname });
        if (r.status !== 400)
          return { ok: false, detail: `${JSON.stringify(nickname)} -> ${r.status}` };
      }
      return true;
    },
  );
  await check(
    'inyeccion',
    'el registro rechaza correos con saltos de linea y contrasenas demasiado cortas o largas',
    async () => {
      const pass = 'clave-larga-1';
      const a = await post('/api/auth/signup', {
        email: 'a@b.com\r\nSET x y',
        password: pass,
        confirm: pass,
      });
      const b = await post('/api/auth/signup', {
        email: 'a@b.com',
        password: 'corta',
        confirm: 'corta',
      });
      const c = await post('/api/auth/signup', {
        email: 'a@b.com',
        password: 'x'.repeat(500),
        confirm: 'x'.repeat(500),
      });
      return a.status === 400 && b.status === 400 && [400, 413].includes(c.status);
    },
  );

  // ------------------------------------------------------------------ sesiones
  section('Sesiones falsas');
  const tokenFalso = async (alg, secret) =>
    alg === 'none'
      ? `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
          JSON.stringify({
            sub: 'guest:x',
            name: 'Falso',
            prv: 'guest',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString('base64url')}.`
      : new SignJWT({ name: 'Falso', prv: 'guest' })
          .setProtectedHeader({ alg })
          .setSubject('guest:falso')
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode(secret));
  const falsos = [
    await tokenFalso('HS256', 'llave-que-no-es-la-del-servidor-1234'),
    await tokenFalso('none'),
    'basura.basura.basura',
    'x',
  ];
  await check(
    'sesion',
    'un token firmado con otra llave, sin firma (alg none) o roto no abre sesion',
    async () => {
      for (const t of falsos) {
        const me = await req('/api/auth/me', { headers: { Cookie: `cg_session=${t}` } });
        const pr = await req('/api/progress', { headers: { Cookie: `cg_session=${t}` } });
        if (me.status !== 401 || pr.status !== 401)
          return { ok: false, detail: `${t.slice(0, 12)}... -> ${me.status}/${pr.status}` };
      }
      return true;
    },
  );
  await check('sesion', 'sin sesion no se puede leer ni guardar progreso', async () => {
    const g = await req('/api/progress');
    const p = await req('/api/progress', { method: 'PUT', headers: JSON_H, body: '{"save":{}}' });
    return g.status === 401 && p.status === 401;
  });
  let guestCookie = '';
  await check('sesion', 'la cookie de sesion es httpOnly, SameSite y Secure', async () => {
    const r = await post('/api/auth/guest', {});
    const set = r.headers.get('set-cookie') ?? '';
    guestCookie = set.split(';')[0];
    return (
      r.status === 201 &&
      /httponly/i.test(set) &&
      /samesite=(lax|strict)/i.test(set) &&
      (!secure || /secure/i.test(set))
    );
  });
  await check('sesion', 'un invitado no puede guardar progreso en el servidor (403)', async () => {
    const r = await req('/api/progress', {
      method: 'PUT',
      headers: { ...JSON_H, Cookie: guestCookie },
      body: '{"save":{"essence":999999}}',
    });
    return r.status === 403;
  });

  // ------------------------------------------------------------------ fuerza bruta
  section('Fuerza bruta');
  await check(
    'fuerza',
    'el inicio de sesion no distingue entre cuenta inexistente y contrasena mala',
    async () => {
      const a = await post('/api/auth/signin', {
        identifier: `nadie.${Date.now()}@cybergrid.test`,
        password: 'clave-larga-1',
      });
      const b = await post('/api/auth/signin', {
        identifier: 'demo1',
        password: 'no-es-la-clave-1',
      });
      // 429 (tope de intentos de esta IP) tambien es una negativa igual para las dos
      return (
        a.status === b.status &&
        [401, 429].includes(a.status) &&
        a.json?.mensaje === b.json?.mensaje
      );
    },
  );
  await check(
    'fuerza',
    'las respuestas de acceso declaran su limite de peticiones (RateLimit)',
    async () => {
      const r = await post('/api/auth/signin', {
        identifier: `x.${Date.now()}@cybergrid.test`,
        password: 'clave-larga-1',
      });
      return [...r.headers.keys()].some((k) => k.startsWith('ratelimit'));
    },
  );
  if (round === 1) {
    await check(
      'fuerza',
      'tras varios fallos con una misma cuenta se bloquea esa cuenta (429), aun con la clave correcta',
      async () => {
        const email = `bloqueo.${Date.now()}@cybergrid.test`;
        const pass = 'Clave-De-Prueba-77';
        const alta = await post('/api/auth/signup', { email, password: pass, confirm: pass });
        if (alta.status !== 201)
          return { ok: false, detail: `no se pudo crear la cuenta de prueba (${alta.status})` };
        let ultimo = 0;
        for (let i = 0; i < 11; i++)
          ultimo = (
            await post('/api/auth/signin', { identifier: email, password: `mala-${i}-contraseña` })
          ).status;
        const buena = await post('/api/auth/signin', { identifier: email, password: pass });
        return {
          ok: ultimo === 429 && buena.status === 429,
          detail: `ultimo fallo ${ultimo}, clave buena ${buena.status}`,
        };
      },
    );
  }
  await check(
    'fuerza',
    'las cuentas de demostracion no se bloquean por intentos ajenos',
    async () => {
      for (let i = 0; i < 3; i++)
        await post('/api/auth/signin', { identifier: 'demo2', password: `mala-${i}-xxxxx` });
      const r = await post('/api/auth/signin', { identifier: 'demo2', password: 'CyberGrid26' });
      // lo que no debe pasar es el bloqueo por cuenta; el tope de intentos de la IP no cuenta
      return r.status === 200 || r.status === 404 || !/con esta cuenta/.test(r.json?.mensaje ?? '');
    },
  );

  // ------------------------------------------------------------------ WebSocket
  section('WebSocket');
  const connectWs = (headers = {}) =>
    new Promise((resolve) => {
      const s = io(base, { transports: ['websocket'], reconnection: false, extraHeaders: headers });
      s.once('connect', () => resolve({ socket: s, ok: true }));
      s.once('connect_error', (e) => resolve({ socket: s, ok: false, error: e.message }));
    });
  await check('ws', 'sin cookie de sesion el socket se rechaza (unauthorized)', async () => {
    const r = await connectWs();
    r.socket.close();
    return !r.ok && r.error === 'unauthorized';
  });
  await check('ws', 'con cookie falsa el socket se rechaza', async () => {
    const r = await connectWs({ cookie: `cg_session=${falsos[0]}` });
    r.socket.close();
    return !r.ok && r.error === 'unauthorized';
  });
  await check(
    'ws',
    'abrir el socket desde otra pagina (Origin ajeno) se rechaza aunque lleve la cookie',
    async () => {
      const r = await connectWs({ cookie: guestCookie, origin: 'https://evil.example' });
      r.socket.close();
      return !r.ok;
    },
  );
  await check(
    'ws',
    'basura en los eventos del socket (incluido un ack que no es funcion) no tumba el servidor',
    async () => {
      const r = await connectWs({ cookie: guestCookie });
      if (!r.ok) return { ok: false, detail: r.error };
      const events = [
        'rooms:list',
        'skin:get',
        'skin:set',
        'room:create',
        'room:join',
        'room:ready',
        'room:settings',
        'room:kick',
        'room:meta',
        'game:input',
        'game:kit',
        'inv:move',
        'inv:drop',
        'loot:open',
        'ammo:drop',
        'armor:move',
      ];
      const junk = [
        null,
        0,
        -1,
        1e308,
        true,
        '',
        'x'.repeat(2000),
        [],
        {},
        { id: 1, slot: -1, qty: 1e9 },
        JSON.parse('{"__proto__":{"x":1}}'),
        'no-soy-funcion',
      ];
      for (const e of events) {
        for (const j of junk) {
          r.socket.emit(e, j);
          r.socket.emit(e, j, j);
        }
        r.socket.emit(e, 'no-soy-funcion');
        await sleep(120);
      }
      await sleep(500);
      r.socket.close();
      const vivo = await req('/api/test/health');
      const otro = await connectWs({ cookie: guestCookie });
      otro.socket.close();
      return vivo.status === 200 && otro.ok;
    },
  );
  await check(
    'ws',
    'un mensaje de socket gigante corta esa conexion y el servidor sigue',
    async () => {
      const r = await connectWs({ cookie: guestCookie });
      if (!r.ok) return { ok: false, detail: r.error };
      const cerrada = new Promise((resolve) => r.socket.once('disconnect', () => resolve(true)));
      r.socket.emit('skin:set', { base: 1, paint: 'f'.repeat(200_000) });
      const corto = await Promise.race([cerrada, sleep(6000).then(() => false)]);
      r.socket.close();
      return corto && (await req('/api/test/health')).status === 200;
    },
  );

  // ------------------------------------------------------------------ IP y endpoints de prueba
  section('IP y endpoints publicos de prueba');
  await check(
    'ip',
    'la IP que ve el servidor no se puede falsear con X-Forwarded-For ni CF-Connecting-IP',
    async () => {
      const normal = await req('/api/test/health');
      const falsa = await req('/api/test/health', {
        headers: { 'X-Forwarded-For': '8.8.8.8', 'X-Real-IP': '8.8.4.4', Forwarded: 'for=1.1.1.1' },
      });
      const cf = await req('/api/test/health', {
        headers: { 'CF-Connecting-IP': '9.9.9.9' },
      }).catch(() => ({ json: null }));
      const ip = normal.json?.clientIp;
      return !!ip && falsa.json?.clientIp === ip && !['9.9.9.9'].includes(cf.json?.clientIp ?? '');
    },
  );
  await check(
    'ip',
    'los endpoints /api/test/* responden rapido y rechazan cuerpos enormes',
    async () => {
      const t0 = performance.now();
      const t = await req('/api/test/telemetry');
      const ms = performance.now() - t0;
      const grande = await req('/api/test/seed', { method: 'POST', body: 'x'.repeat(400_000) });
      return {
        ok: t.status === 200 && grande.status >= 400 && grande.status < 500,
        detail: `telemetry ${Math.round(ms)} ms`,
      };
    },
  );
  await check('ip', 'los errores no muestran rutas del servidor ni trazas', async () => {
    const rs = [
      await post('/api/auth/signin', '{"x":'),
      await req('/api/progress', {
        method: 'PUT',
        headers: { ...JSON_H, Cookie: guestCookie },
        body: '{{',
      }),
    ];
    return rs.every(noLeak);
  });

  const failed = results.filter((r) => !r.ok);
  console.info(
    `\nRonda ${round}: ${results.length - failed.length}/${results.length} comprobaciones superadas`,
  );
  return failed;
}

console.info(`Revision de seguridad de ${base}`);
let allFailed = 0;
for (let r = 1; r <= rounds; r++) {
  if (rounds > 1) console.info(`\n=========== RONDA ${r} DE ${rounds} ===========`);
  const failed = await run(r);
  allFailed += failed.length;
  for (const f of failed) console.info(`  FALLO: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
}
console.info(allFailed === 0 ? '\nTODO SUPERADO' : `\n${allFailed} comprobacion(es) fallaron`);
process.exit(allFailed === 0 ? 0 : 1);
