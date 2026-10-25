import { expect, test } from '@playwright/test';
import { coords, registerViaUi, uniqueName } from './helpers';

test.describe('Flujo 9: inicio de la partida y ajustes de la mira', () => {
  test('la partida arranca con cuenta regresiva, todos quietos y el cartel de a jugar', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_intro'), true);
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => (window.__cybergrid?.intro ?? 0) > 0, null, {
      timeout: 8000,
    });

    // Durante la cuenta, aunque se mantenga una tecla el gato no se mueve.
    const before = await coords(page);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyD');
    const during = await coords(page);
    expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeLessThan(1);

    // Al llegar a 0 sale el cartel y ya se puede caminar.
    await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 15_000 });
    const splash = await page.evaluate(
      () => (window as unknown as { __game: { splash: unknown } }).__game.splash,
    );
    expect(splash).not.toBeNull();
    const start = await coords(page);
    let moved = false;
    for (const key of ['KeyD', 'KeyS', 'KeyA', 'KeyW']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(500);
      await page.keyboard.up(key);
      const now = await coords(page);
      if (Math.hypot(now.x - start.x, now.y - start.y) > 8) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  test('en Ajustes se elige como dispara la mira del movil y se recuerda', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_mira'));
    await page.getByTestId('btn-settings').click();
    await page.locator('#set-tab-touch').click();
    const aim = page.getByTestId('fire-mode-aim');
    const target = page.getByTestId('fire-mode-target');
    await expect(aim).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fire-mode-help')).toContainText('dispara sola');

    await target.click();
    await expect(target).toHaveAttribute('aria-checked', 'true');
    await expect(aim).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('fire-mode-help')).toContainText('solo dispara cuando');
    expect(await page.evaluate(() => localStorage.getItem('cg_fire_mode'))).toBe('target');

    // Se conserva al recargar la pagina.
    await page.reload();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await page.getByTestId('btn-settings').click();
    await page.locator('#set-tab-touch').click();
    await expect(page.getByTestId('fire-mode-target')).toHaveAttribute('aria-checked', 'true');
  });
});
