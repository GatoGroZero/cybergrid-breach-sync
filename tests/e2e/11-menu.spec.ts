import { expect, test } from '@playwright/test';
import { createRoomUi, openTab, registerViaUi, uniqueName } from './helpers';

test.describe('Flujo 14: menú de juego tipo casillero', () => {
  test('tres pestañas, un modo con foto y botón de información, y el escenario sigue al modo', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_menu'));
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByTestId('tab-jugar')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pane-jugar')).toBeVisible();
    await expect(page.getByTestId('pane-salas')).toBeHidden();
    await expect(page.getByTestId('pane-gato')).toBeHidden();

    // cada modo trae su foto y su boton "i"
    const cards = page.getByTestId('mode-picker').locator('.mode');
    await expect(cards).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(cards.nth(i).locator('canvas.postal')).toBeVisible();
      await expect(cards.nth(i).locator('.m-info')).toBeVisible();
    }

    // el escenario de los gatos cambia con el modo elegido
    await expect(page.locator('#stage-mode')).toHaveText('Battle Royale');
    await page.locator('[data-mode=territorio]').click();
    await expect(page.locator('#stage-mode')).toHaveText('Territorio');
    await page.locator('[data-mode=aventura]').click();
    await expect(page.locator('#stage-mode')).toHaveText('Aventura');

    // la "i" explica el modo sin elegirlo y se cierra con Escape
    await cards.nth(1).locator('.m-info').click();
    const info = page.getByTestId('mode-info');
    await expect(info).toBeVisible();
    await expect(page.locator('#mode-info-title')).toHaveText('Pelea en el techo');
    await expect(page.locator('#mode-info-list li').first()).toBeVisible();
    await expect(page.locator('[data-mode=aventura]')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(info).toBeHidden();

    // las otras pestañas se alcanzan con el raton y con las flechas del teclado
    await page.getByTestId('tab-salas').click();
    await expect(page.getByTestId('pane-salas')).toBeVisible();
    await expect(page.getByTestId('pane-jugar')).toBeHidden();
    await page.getByTestId('tab-salas').press('ArrowRight');
    await expect(page.getByTestId('tab-gato')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('painter')).toBeVisible();
    await openTab(page, 'jugar');
    await expect(page.getByTestId('btn-solo')).toBeVisible();
  });

  test('con varias personas en la sala todas aparecen en el escenario y en la lista', async ({
    browser,
  }) => {
    const ctxs = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ]);
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    const [host, ...guests] = pages as [(typeof pages)[0], ...typeof pages];
    await registerViaUi(host, uniqueName('e2e_host'));
    for (const g of guests) await registerViaUi(g, uniqueName('e2e_inv'));

    await createRoomUi(host, { name: 'Escenario E2E' });
    await expect(host.getByTestId('room-view')).toBeVisible();
    for (const g of guests) {
      await openTab(g, 'salas');
      await expect(g.getByTestId('room-list').getByText('Escenario E2E')).toBeVisible({
        timeout: 8000,
      });
      await g.getByTestId('room-list').getByRole('button', { name: 'Entrar' }).first().click();
      // al entrar a una sala se vuelve solo a la pestaña del grupo
      await expect(g.getByTestId('pane-jugar')).toBeVisible();
      await expect(g.getByTestId('room-view')).toBeVisible();
    }

    await expect(host.getByTestId('member')).toHaveCount(3);
    await expect(host.locator('#stage-sub')).toContainText('3 personas');
    await expect(guests[0]!.locator('#stage-sub')).toContainText('3 personas');

    // solo el anfitrion cambia el modo: a los demas las tarjetas les quedan bloqueadas
    await expect(guests[0]!.locator('[data-mode=aventura]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await host.locator('[data-mode=aventura]').click();
    await expect(guests[0]!.locator('[data-mode=aventura]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(guests[0]!.locator('#stage-mode')).toHaveText('Aventura');

    for (const c of ctxs) await c.close();
  });
});
