import { expect, test } from '@playwright/test';
import { nearestChest, registerViaUi, startSoloGame, uniqueName, walkTo } from './helpers';

test.describe('Flujo 4: cofres, inventario y pelaje', () => {
  test('caminar hasta un cofre, abrirlo con E y pasar lo que tiene al inventario', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_bot'), true);
    await startSoloGame(page);

    // Los bots abren cofres desde el primer segundo: si el elegido ya estaba vaciado se prueba otro.
    const tried: { x: number; y: number }[] = [];
    let taken = false;
    for (let attempt = 0; attempt < 6 && !taken; attempt++) {
      const chest = await nearestChest(page, tried);
      tried.push(chest);
      const left = await walkTo(page, chest.x, chest.y);
      if (left < 0 || left >= 26) continue;
      await page.keyboard.press('KeyE');
      await expect(page.getByTestId('inv')).toBeVisible();
      await expect(page.getByTestId('loot-block')).toBeVisible();
      const items = await page.locator('[data-testid="loot-slot"]:not(.empty)').count();
      if (items >= 1 && (await page.getByTestId('loot-all').isEnabled())) {
        await page.getByTestId('loot-all').click();
        // El inventario nuevo llega con la siguiente instantanea del servidor.
        await expect
          .poll(
            async () =>
              (await page.locator('[data-testid="inv-slot"]:not(.empty)').count()) +
              (await page.locator('[data-testid="ammo-chip"]:not(.empty)').count()),
          )
          .toBeGreaterThanOrEqual(1);
        taken = true;
      } else {
        await page.keyboard.press('Escape');
      }
    }
    expect(taken).toBe(true);

    // Escape cierra el inventario y la partida sigue.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inv')).toBeHidden();
    await expect(page.getByTestId('menu')).toBeHidden();
    expect((await page.evaluate(() => window.__cybergrid))?.alive).toBe(true);
  });

  test('el botón de la lata abre y cierra el inventario con la tecla I', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_inv'));
    await startSoloGame(page);
    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('inv')).toBeVisible();
    await expect(page.getByTestId('inv-slot')).toHaveCount(5);
    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('inv')).toBeHidden();
    await page.getByTestId('btn-bag').click();
    await expect(page.getByTestId('inv')).toBeVisible();
  });

  test('pintar al gato en el lobby se guarda y viaja con el pelaje al servidor', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_pin'));
    const canvas = page.locator('#paint-canvas');
    await expect(canvas).toBeVisible();
    await page.locator('#palette button').nth(8).click();
    await page.locator('#brushes button').nth(2).click();
    // Los clics pueden desplazar la página: la caja del lienzo se mide después.
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    // Un trazo por el lomo del gato (la cuadricula ocupa 26 x 18 celdas).
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('cg_skin') ?? '{}'),
    );
    expect(saved.paint).toHaveLength(384);
    expect(saved.paint).not.toBe('0'.repeat(384));
    await page.locator('#coats button').nth(2).click();
    await page.reload();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    const again = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('cg_skin') ?? '{}'),
    );
    expect(again.base).toBe(2);
    expect(again.paint).toBe(saved.paint);
  });
});

test.describe('Flujo 4b: ordenar y tirar objetos arrastrando', () => {
  test('arrastrar cambia el orden del inventario y soltar fuera tira el objeto', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_drg'), true);
    await startSoloGame(page);
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit(e: string): void } } }).__net.socket.emit(
        'dev:kit',
      ),
    );
    const inv = (): Promise<(string | null)[]> =>
      page.evaluate(() =>
        (window as unknown as { __game: { inv: ({ kind: string } | null)[] } }).__game.inv.map(
          (i) => i?.kind ?? null,
        ),
      );
    await expect.poll(async () => (await inv())[0]).toBe('rifle');
    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('inv')).toBeVisible();

    const slot = (i: number) => page.getByTestId('inv-slot').nth(i);
    const center = async (i: number) => {
      await expect(slot(i)).toBeVisible();
      const b = (await slot(i).boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const drag = async (from: number, to: { x: number; y: number }): Promise<void> => {
      const a = await center(from);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + to.x) / 2, (a.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
    };

    // Intercambiar el fusil (espacio 1) con los muros (espacio 4).
    await drag(0, await center(3));
    await expect.poll(async () => (await inv())[3]).toBe('rifle');
    expect((await inv())[0]).toBe('wall');

    // Soltar fuera de la tarjeta tira el objeto al suelo.
    await drag(2, { x: 30, y: 30 });
    await expect.poll(async () => (await inv())[2]).toBeNull();
  });
});

test.describe('Flujo 4c: ajustes', () => {
  test('reasignar una tecla se guarda y el editor de botones tactiles mueve y guarda', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_aju'));
    await page.getByTestId('btn-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    const row = page.locator('#key-list button[data-action="interact"]');
    await expect(row).toHaveText('E');
    await row.click();
    await expect(row).toHaveText('Pulsa una tecla');
    await page.keyboard.press('KeyF');
    await expect(row).toHaveText('F');
    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('cg_keys') ?? '{}'),
    );
    expect(saved.interact).toBe('KeyF');

    // Si se elige una tecla que ya usa otra accion, se intercambian.
    await row.click();
    await page.keyboard.press('KeyW');
    await expect(row).toHaveText('W');
    await expect(page.locator('#key-list button[data-action="up"]')).toHaveText('F');

    await page.locator('#set-tab-touch').click();
    await page.getByTestId('touch-edit').click();
    await expect(page.getByTestId('touch-editor')).toBeVisible();
    // Arrastrar la mira a otro lugar y agrandarla.
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await page.mouse.move(size.w * 0.87, size.h * 0.7);
    await page.mouse.down();
    await page.mouse.move(size.w * 0.7, size.h * 0.55, { steps: 6 });
    await page.mouse.up();
    await page.locator('#editor-plus').click();
    await page.locator('#editor-save').click();
    const layout = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('cg_touch') ?? '{}'),
    );
    expect(layout.aim.x).toBeCloseTo(0.7, 1);
    expect(layout.aim.y).toBeCloseTo(0.55, 1);
    expect(layout.aim.s).toBeGreaterThan(1.1);
    await expect(page.getByTestId('touch-editor')).toBeHidden();
    await page.locator('#settings-close').click();
    await expect(page.getByTestId('settings')).toBeHidden();
  });
});
