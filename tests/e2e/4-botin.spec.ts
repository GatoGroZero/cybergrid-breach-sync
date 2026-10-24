import { expect, test } from '@playwright/test';
import { nearestChest, registerViaUi, startSoloGame, uniqueName, walkTo } from './helpers';

test.describe('Flujo 4: cofres, inventario y pelaje', () => {
  test('caminar hasta un cofre, abrirlo con E y pasar lo que tiene al inventario', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_bot'), true);
    await startSoloGame(page);

    const chest = await nearestChest(page);
    const left = await walkTo(page, chest.x, chest.y);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(26);

    await page.keyboard.press('KeyE');
    await expect(page.getByTestId('inv')).toBeVisible();
    await expect(page.getByTestId('loot-block')).toBeVisible();
    const found = await page.getByTestId('loot-slot').count();
    expect(found).toBeGreaterThanOrEqual(2);

    await page.getByTestId('loot-all').click();
    await expect(page.getByTestId('loot-slot')).toHaveCount(1);
    const filled = await page.locator('[data-testid="inv-slot"]:not(.empty)').count();
    expect(filled).toBeGreaterThanOrEqual(1);

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
    const box = (await canvas.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.locator('#palette button').nth(8).click();
    await page.locator('#brushes button').nth(2).click();
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
