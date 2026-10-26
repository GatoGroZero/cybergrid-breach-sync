import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { META_UPGRADES, NO_META } from '../../src/shared/br/adventure';
import {
  addRun,
  buy,
  emptySave,
  hasProgress,
  newest,
  nextCost,
  parseSave,
  refundOf,
  sell,
  type MetaSave,
} from '../../src/shared/br/progress';
import { StoreError, type Store } from '../../src/server/store';
import { startServer, type TestServer } from './server-helper';

const con = (essence: number, extra: Partial<MetaSave> = {}): MetaSave => ({
  ...emptySave(),
  essence,
  ...extra,
});

describe('progreso del Santuario (reglas compartidas)', () => {
  it('comprar cobra el costo del nivel y quitar devuelve la esencia completa', () => {
    const inicio = con(500, { updatedAt: 1 });
    const comprado = buy(inicio, 'vida', 100);
    expect(comprado?.levels.vida).toBe(1);
    expect(comprado?.essence).toBe(500 - 20);
    expect(comprado?.updatedAt).toBe(100);
    const devuelto = sell(comprado as MetaSave, 'vida', 200);
    expect(devuelto?.levels.vida).toBe(0);
    expect(devuelto?.essence).toBe(500);
    expect(devuelto?.updatedAt).toBe(200);
  });

  it('comprar todos los niveles y quitarlos todos deja la esencia como estaba', () => {
    for (const up of META_UPGRADES) {
      let save = con(10_000);
      for (let i = 0; i < up.max; i++) save = buy(save, up.key) as MetaSave;
      expect(save.levels[up.key]).toBe(up.max);
      for (let i = 0; i < up.max; i++) save = sell(save, up.key) as MetaSave;
      expect(save.levels[up.key]).toBe(0);
      expect(save.essence).toBe(10_000);
    }
  });

  it('quitar un nivel devuelve lo que costo ese nivel, no el del siguiente', () => {
    const up = META_UPGRADES.find((u) => u.key === 'reliquia');
    const save = con(0, { levels: { ...NO_META, reliquia: 2 } });
    expect(refundOf(save, 'reliquia')).toBe(up?.costs[1]);
    expect(sell(save, 'reliquia')?.essence).toBe(up?.costs[1]);
  });

  it('no baja de nivel cero, no pasa del maximo y no compra sin esencia', () => {
    expect(sell(con(50), 'vida')).toBeNull();
    expect(refundOf(con(50), 'vida')).toBeNull();
    expect(buy(con(5), 'vida')).toBeNull();
    const tope = con(10_000, { levels: { ...NO_META, municion: 3 } });
    expect(nextCost(tope, 'municion')).toBeNull();
    expect(buy(tope, 'municion')).toBeNull();
  });

  it('una partida suma esencia, victorias y el mejor record', () => {
    const a = addRun(con(10), 40, 6, true, 5);
    expect(a).toMatchObject({ essence: 50, runs: 1, wins: 1, best: 6, updatedAt: 5 });
    const b = addRun(a, 8, 3, false, 6);
    expect(b).toMatchObject({ essence: 58, runs: 2, wins: 1, best: 6 });
  });

  it('juntar dos copias se queda con la mas nueva; si empatan, con la que tiene algo', () => {
    const vieja = con(10, { updatedAt: 1 });
    const nueva = con(99, { updatedAt: 2 });
    expect(newest(vieja, nueva)).toBe(nueva);
    expect(newest(nueva, vieja)).toBe(nueva);
    const vacia = con(0, { updatedAt: 3 });
    const llena = con(5, { updatedAt: 3 });
    expect(newest(vacia, llena)).toBe(llena);
    expect(newest(llena, vacia)).toBe(llena);
    expect(hasProgress(vacia)).toBe(false);
    expect(hasProgress(con(0, { levels: { ...NO_META, garras: 1 } }))).toBe(true);
  });

  it('lo guardado danado o inventado se limpia a valores validos', () => {
    expect(parseSave(null)).toEqual(emptySave());
    expect(parseSave('texto')).toEqual(emptySave());
    const limpio = parseSave({
      levels: { vida: 99, garras: -4, otra: 3 },
      essence: -5,
      runs: 'muchas',
      wins: 2.9,
      best: 5000,
      updatedAt: Number.NaN,
    });
    expect(limpio.levels.vida).toBe(5);
    expect(limpio.levels.garras).toBe(0);
    expect(limpio.essence).toBe(0);
    expect(limpio.runs).toBe(0);
    expect(limpio.wins).toBe(2);
    expect(limpio.best).toBe(100);
    expect(limpio.updatedAt).toBe(0);
  });
});

const cookieOf = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
};

describe('GET y PUT /api/progress', () => {
  const open: TestServer[] = [];
  const start = async (...args: Parameters<typeof startServer>): Promise<TestServer> => {
    const s = await startServer(...args);
    open.push(s);
    return s;
  };
  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close()));
  });

  const cuenta = async (s: TestServer, email = 'a@correo.com'): Promise<string> => {
    const res = await request(s.app)
      .post('/api/auth/signup')
      .send({ email, password: 'clave-larga-1', confirm: 'clave-larga-1' });
    expect(res.status).toBe(201);
    return cookieOf(res);
  };

  it('sin sesion da 401', async () => {
    const s = await start();
    expect((await request(s.app).get('/api/progress')).status).toBe(401);
    expect((await request(s.app).put('/api/progress').send({ save: emptySave() })).status).toBe(
      401,
    );
  });

  it('un invitado recibe 403: su progreso se queda en su navegador', async () => {
    const s = await start();
    const guest = await request(s.app).post('/api/auth/guest').send({});
    const cookie = cookieOf(guest);
    expect((await request(s.app).get('/api/progress').set('Cookie', cookie)).status).toBe(403);
    expect(
      (
        await request(s.app)
          .put('/api/progress')
          .set('Cookie', cookie)
          .send({ save: con(5) })
      ).status,
    ).toBe(403);
  });

  it('una cuenta nueva no tiene nada guardado y lo que sube se lee de vuelta', async () => {
    const s = await start();
    const cookie = await cuenta(s);
    const vacio = await request(s.app).get('/api/progress').set('Cookie', cookie);
    expect(vacio.status).toBe(200);
    expect(vacio.body.save).toBeNull();

    const guardado = con(120, { levels: { ...NO_META, vida: 2 }, runs: 3, updatedAt: 1000 });
    const put = await request(s.app).put('/api/progress').set('Cookie', cookie).send({
      save: guardado,
    });
    expect(put.status).toBe(200);
    expect(put.body.save).toEqual(guardado);

    const leido = await request(s.app).get('/api/progress').set('Cookie', cookie);
    expect(leido.body.save).toEqual(guardado);
    expect(leido.headers['cache-control']).toContain('no-store');
  });

  it('cada cuenta ve solo su progreso', async () => {
    const s = await start();
    const a = await cuenta(s, 'a@correo.com');
    const b = await cuenta(s, 'b@correo.com');
    await request(s.app)
      .put('/api/progress')
      .set('Cookie', a)
      .send({ save: con(77, { updatedAt: 5 }) });
    const deB = await request(s.app).get('/api/progress').set('Cookie', b);
    expect(deB.body.save).toBeNull();
  });

  it('si el servidor ya tiene algo mas nuevo responde 409 con esa copia y no la pisa', async () => {
    const s = await start();
    const cookie = await cuenta(s);
    const nueva = con(300, { updatedAt: 2000 });
    await request(s.app).put('/api/progress').set('Cookie', cookie).send({ save: nueva });

    const vieja = con(5, { updatedAt: 1000 });
    const choque = await request(s.app).put('/api/progress').set('Cookie', cookie).send({
      save: vieja,
    });
    expect(choque.status).toBe(409);
    expect(choque.body.save).toEqual(nueva);

    const leido = await request(s.app).get('/api/progress').set('Cookie', cookie);
    expect(leido.body.save).toEqual(nueva);

    // la misma copia otra vez, o una mas nueva, si se acepta
    const igual = await request(s.app).put('/api/progress').set('Cookie', cookie).send({
      save: nueva,
    });
    expect(igual.status).toBe(200);
    const mas = con(310, { updatedAt: 3000 });
    const sube = await request(s.app).put('/api/progress').set('Cookie', cookie).send({
      save: mas,
    });
    expect(sube.status).toBe(200);
    expect(sube.body.save).toEqual(mas);
  });

  it('limpia lo que mande el navegador y rechaza cuerpos enormes o sin datos', async () => {
    const s = await start();
    const cookie = await cuenta(s);
    const sucio = await request(s.app)
      .put('/api/progress')
      .set('Cookie', cookie)
      .send({ save: { levels: { vida: 999 }, essence: 5e12, updatedAt: 10 } });
    expect(sucio.status).toBe(200);
    expect(sucio.body.save.levels.vida).toBe(5);
    expect(sucio.body.save.essence).toBe(1_000_000);

    const enorme = await request(s.app)
      .put('/api/progress')
      .set('Cookie', cookie)
      .send({ save: { relleno: 'x'.repeat(10_000) } });
    expect(enorme.status).toBeGreaterThanOrEqual(400);
    expect(enorme.status).toBeLessThan(500);

    const sinDatos = await request(s.app).put('/api/progress').set('Cookie', cookie).send({});
    expect(sinDatos.status).toBe(400);
  });

  it('el progreso sigue ahi tras reiniciar el servidor si el almacen es duradero', async () => {
    const data = new Map<string, string>();
    const duradero: Store = {
      durable: true,
      get: (k) => Promise.resolve(data.get(k) ?? null),
      set: (k, v) => {
        data.set(k, v);
        return Promise.resolve();
      },
      setNx: (k, v) => {
        if (data.has(k)) return Promise.resolve(false);
        data.set(k, v);
        return Promise.resolve(true);
      },
    };
    const antes = await start({}, { store: duradero });
    const cookie = await cuenta(antes, 'vuelve@correo.com');
    const guardado = con(42, { levels: { ...NO_META, garras: 3 }, updatedAt: 9 });
    await request(antes.app).put('/api/progress').set('Cookie', cookie).send({ save: guardado });
    await antes.close();
    open.splice(open.indexOf(antes), 1);

    const despues = await start({}, { store: duradero });
    const dentro = await request(despues.app)
      .post('/api/auth/signin')
      .send({ identifier: 'vuelve@correo.com', password: 'clave-larga-1' });
    expect(dentro.status).toBe(200);
    const leido = await request(despues.app).get('/api/progress').set('Cookie', cookieOf(dentro));
    expect(leido.body.save).toEqual(guardado);
    expect(leido.body.durable).toBe(true);
  });

  it('si el almacen falla responde 503 y no borra nada', async () => {
    const data = new Map<string, string>();
    let caido = false;
    const roto = (): Promise<never> => Promise.reject(new StoreError('almacen_500'));
    const store: Store = {
      durable: true,
      get: (k) => (caido ? roto() : Promise.resolve(data.get(k) ?? null)),
      set: (k, v) => (caido ? roto() : (data.set(k, v), Promise.resolve())),
      setNx: (k, v) => (caido ? roto() : Promise.resolve(!data.has(k) && (data.set(k, v), true))),
    };
    const s = await start({}, { store });
    const cookie = await cuenta(s);
    await request(s.app)
      .put('/api/progress')
      .set('Cookie', cookie)
      .send({ save: con(8, { updatedAt: 4 }) });
    caido = true;
    expect((await request(s.app).get('/api/progress').set('Cookie', cookie)).status).toBe(503);
    expect(
      (
        await request(s.app)
          .put('/api/progress')
          .set('Cookie', cookie)
          .send({ save: con(1, { updatedAt: 9 }) })
      ).status,
    ).toBe(503);
    caido = false;
    const leido = await request(s.app).get('/api/progress').set('Cookie', cookie);
    expect(leido.body.save.essence).toBe(8);
  });
});
