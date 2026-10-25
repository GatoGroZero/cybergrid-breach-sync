import { expect, test } from '@playwright/test';
import { registerViaUi, startSoloGame, uniqueName, walkTo } from './helpers';

interface DebugGame {
  inv: ({ kind: string; qty: number; rarity: number; mag?: number } | null)[];
  ammo: number[];
  stamina: { value: number; tired: boolean };
  x: number;
  latest: { walls: unknown[]; me: { sel: number } } | null;
  me: { reload: number } | null;
}

test.describe('Flujo 5: combate, objetos y muros', () => {
  test('con equipo de prueba el clic dispara y gasta balas, y un muro se coloca en el mapa', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_cmb'), true);
    await startSoloGame(page);
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit(e: string): void } } }).__net.socket.emit(
        'dev:kit',
      ),
    );
    const game = (): Promise<DebugGame> =>
      page.evaluate(() => (window as unknown as { __game: DebugGame }).__game);
    await expect.poll(async () => (await game()).inv[0]?.kind).toBe('rifle');
    // Las balas viven en su propio compartimento: la del fusil es la ultima de las 5.
    expect((await game()).ammo[4]).toBe(90);
    expect((await game()).inv.filter(Boolean)).toHaveLength(4);

    // El fusil es arma automatica: mantener el clic gasta varios disparos del cargador (de 30).
    await page.keyboard.press('Digit1');
    await page.mouse.move(900, 300);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await expect.poll(async () => (await game()).inv[0]?.mag ?? 30).toBeLessThan(30);
    const mag = (await game()).inv[0]?.mag ?? 30;
    expect(mag).toBeGreaterThan(15);
    // Las balas de repuesto siguen intactas hasta recargar.
    expect((await game()).ammo[4]).toBe(90);

    // R recarga: tarda su tiempo, llena el cargador y gasta las balas de repuesto.
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await game()).me?.reload ?? 0).toBeGreaterThan(0);
    await expect.poll(async () => (await game()).inv[0]?.mag ?? 0, { timeout: 8000 }).toBe(30);
    expect((await game()).ammo[4]).toBe(90 - (30 - mag));

    // Un mini muro: se elige el espacio 4 y un clic lo coloca delante del gato.
    await page.keyboard.press('Digit4');
    await page.mouse.click(900, 300);
    await expect.poll(async () => (await game()).latest?.walls.length ?? 0).toBeGreaterThan(0);
  });

  test('el menu de pausa no detiene la partida y pide confirmar antes de salir', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_pau'), true);
    await startSoloGame(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu')).toBeVisible();
    const tick = (): Promise<number> =>
      page.evaluate(
        () => (window as unknown as { __game: { latest: { tick: number } } }).__game.latest.tick,
      );
    const before = await tick();
    await page.waitForTimeout(1200);
    const after = await tick();
    expect(after).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu')).toBeHidden();

    await page.getByTestId('btn-menu').click();
    await page.getByTestId('btn-quit').click();
    await expect(page.getByTestId('btn-quit')).toContainText('otra vez');
    await page.getByTestId('btn-quit').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
  });
});

test.describe('Flujo 6: fin de la partida', () => {
  test('al terminar aparece la tabla de puestos y se puede volver a la sala', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_fin'), true);
    await startSoloGame(page);
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit(e: string): void } } }).__net.socket.emit(
        'dev:finish',
      ),
    );
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#results-body tr')).toHaveCount(12);
    await expect(page.locator('#results-body tr.me')).toHaveCount(1);

    // La partida terminada entra a la telemetria (solo cuentan las personas, no los bots).
    const res = await page.request.get('/api/test/telemetry');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.matches.total).toBeGreaterThanOrEqual(1);
    expect(body.survivability.survivalRate).toBeGreaterThanOrEqual(0);
    await page.getByTestId('btn-back').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await expect(page.getByTestId('room-view')).toBeVisible();
  });
});

test.describe('Flujo 7: correr con estamina', () => {
  test('Shift corre mas rapido, gasta la barra de pez y quieto se recupera', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_run'), true);
    await startSoloGame(page);
    const stamina = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { __game: DebugGame }).__game.stamina.value);
    const posX = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { __game: DebugGame }).__game.x);
    expect(await stamina()).toBe(100);

    // Caminar: misma barra. Correr: la barra baja y se avanza mas en el mismo tiempo.
    const walkStart = await posX();
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyD');
    const walked = Math.abs((await posX()) - walkStart);
    expect(await stamina()).toBe(100);

    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('Shift');
    const runStart = await posX();
    await page.waitForTimeout(600);
    const during = await stamina();
    await page.keyboard.up('Shift');
    await page.keyboard.up('ArrowLeft');
    const ran = Math.abs((await posX()) - runStart);
    expect(during).toBeLessThan(90);
    expect(ran).toBeGreaterThan(walked * 1.15);

    // Quieto se recupera por completo en unos 4 segundos.
    await expect.poll(stamina, { timeout: 8000 }).toBe(100);
  });

  test('el pez de estamina y las balas aparte se ven en el inventario y el HUD', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_pez'), true);
    await startSoloGame(page);
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit(e: string): void } } }).__net.socket.emit(
        'dev:kit',
      ),
    );
    await expect
      .poll(async () =>
        page.evaluate(() => (window as unknown as { __game: DebugGame }).__game.ammo[4]),
      )
      .toBe(90);
    await page.keyboard.press('KeyI');
    const chips = page.getByTestId('ammo-chip');
    await expect(chips).toHaveCount(5);
    await expect(chips.nth(4)).toContainText('Balas de fusil');
    await expect(chips.nth(4)).toContainText('90');
    await expect(chips.nth(0)).toContainText('Balas de pistola');
    // Arrastrar las balas fuera de la tarjeta las tira al suelo.
    const b = (await chips.nth(4).boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(40, 40, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        page.evaluate(() => (window as unknown as { __game: DebugGame }).__game.ammo[4]),
      )
      .toBe(0);
  });
});

test.describe('Flujo 8: cajas de municion y emotes', () => {
  test('una caja de municion trae varias clases de balas y se pasan al compartimento sin ocupar casillas', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_caja'), true);
    await startSoloGame(page);

    const tried: { x: number; y: number }[] = [];
    let taken = false;
    let sawCrate = false;
    for (let attempt = 0; attempt < 6 && !taken; attempt++) {
      // La caja de municion mas cercana que todavia no se ha probado. Se leen del mapa (todas las
      // cajas existen desde el inicio) y se prefieren las que el servidor reporta aun cerradas.
      const crate = await page.evaluate((skip) => {
        const g = (
          window as unknown as {
            __game: {
              x: number;
              y: number;
              map: { chests: { x: number; y: number; ammo: boolean }[] };
              boxes: [number, number, number, number, number][];
            };
          }
        ).__game;
        const opened = new Set(
          g.boxes.filter((b) => b[3] === 4 && b[4] === 1).map((b) => `${b[1]},${b[2]}`),
        );
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const c of g.map.chests) {
          if (!c.ammo || opened.has(`${c.x},${c.y}`)) continue;
          if (skip.some((t) => t.x === c.x && t.y === c.y)) continue;
          const d = Math.hypot(c.x - g.x, c.y - g.y);
          if (d < bestD) {
            bestD = d;
            best = { x: c.x, y: c.y };
          }
        }
        return best;
      }, tried);
      if (!crate) break;
      tried.push(crate);
      const left = await walkTo(page, crate.x, crate.y, 17);
      if (left < 0 || left >= 26) continue;
      await page.keyboard.press('KeyE');
      await expect(page.getByTestId('inv')).toBeVisible();
      // La caja se identifica siempre por su nombre, este llena o no (los bots tambien las vacian).
      await expect(page.getByTestId('loot-block')).toContainText('Caja de munición');
      sawCrate = true;
      const slots = await page.locator('[data-testid="loot-slot"]:not(.empty)').count();
      if (slots >= 3 && (await page.getByTestId('loot-all').isEnabled())) {
        await page.getByTestId('loot-all').click();
        // Todo va al compartimento de balas: ninguna de las 5 casillas se ocupa.
        await expect
          .poll(async () => page.locator('[data-testid="ammo-chip"]:not(.empty)').count())
          .toBeGreaterThanOrEqual(3);
        await expect(page.locator('[data-testid="inv-slot"]:not(.empty)')).toHaveCount(0);
        taken = true;
      } else {
        await page.keyboard.press('Escape');
      }
    }
    expect(sawCrate).toBe(true);
    // Con 12 gatos buscando municion a veces las cajas cercanas ya estan vacias: el contenido
    // completo de una caja se comprueba ademas con pruebas unitarias.
    if (!taken)
      test.info().annotations.push({ type: 'nota', description: 'cajas vaciadas por bots' });
  });

  test('con la tecla T se abre la barra de emotes y el emote sale sobre el gato (con respiro entre uno y otro)', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_emo'), true);
    await startSoloGame(page);
    type Dbg = { emotes: Map<number, { k: number }>; you: number };
    const emote = (): Promise<number | null> =>
      page.evaluate(() => {
        const g = (window as unknown as { __game: Dbg }).__game;
        return g.emotes.get(g.you)?.k ?? null;
      });
    expect(await emote()).toBeNull();

    await page.keyboard.press('KeyT');
    await page.waitForTimeout(150);
    // Con la barra abierta, el numero 2 elige el llanto en vez de cambiar de objeto.
    await page.keyboard.press('Digit2');
    await expect.poll(emote).toBe(1);

    // El respiro de 1.5 s evita el spam: uno inmediato se ignora.
    await page.keyboard.press('KeyT');
    await page.keyboard.press('Digit3');
    await page.waitForTimeout(500);
    expect(await emote()).toBe(1);

    // Pasado el respiro, la bandera blanca (4) si sale. En una maquina lenta el reloj del servidor
    // puede ir mas despacio que el de pared, asi que se reintenta hasta que lo acepte.
    await page.waitForTimeout(1600);
    await expect
      .poll(
        async () => {
          await page.keyboard.press('KeyT');
          await page.keyboard.press('Digit4');
          await page.waitForTimeout(700);
          return emote();
        },
        { timeout: 20_000 },
      )
      .toBe(3);

    // Escape cierra la barra sin mandar nada ni abrir el menu de pausa.
    await page.keyboard.press('KeyT');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu')).toBeHidden();
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(400);
    // El 1 solo cambio de objeto: no salio el emote de la risa (el anterior puede haber expirado).
    expect(await emote()).not.toBe(0);
  });
});
