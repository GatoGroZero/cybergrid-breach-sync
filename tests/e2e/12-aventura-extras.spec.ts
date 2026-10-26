import { expect, test, type Page } from '@playwright/test';
import { registerViaUi, uniqueName } from './helpers';

type Game = {
  __net: { socket: { emit(e: string, p?: unknown): void } };
  __game: {
    x: number;
    y: number;
    signAt: { x: number; y: number } | null;
    nearTutorial: boolean;
    bossIntro: { kind: number } | null;
  };
};

const emit = (page: Page, event: string, payload?: unknown): Promise<void> =>
  page.evaluate(([e, p]) => (window as unknown as Game).__net.socket.emit(e as string, p), [
    event,
    payload,
  ] as const);

async function empezarAventura(page: Page): Promise<void> {
  await registerViaUi(page, uniqueName('e2e_ext'), true);
  await page.locator('[data-mode=aventura]').click();
  await page.getByTestId('btn-solo').click();
  await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 5);
  await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 20_000 });
}

/** Lleva al gato junto al cartel del tutorial (el servidor de pruebas deja teletransportarse). */
async function irAlCartel(page: Page): Promise<void> {
  const sign = await page.evaluate(() => (window as unknown as Game).__game.signAt);
  expect(sign).not.toBeNull();
  await emit(page, 'dev:tp', {
    x: (sign as { x: number }).x - 18,
    y: (sign as { y: number }).y + 4,
  });
  await page.waitForFunction(() => (window as unknown as Game).__game.nearTutorial);
}

test.describe('Flujo 15: tutorial y presentacion de jefes en la Aventura', () => {
  test('el cartel del claro abre el tutorial al accionarlo y se cierra de todas las formas', async ({
    page,
  }) => {
    await empezarAventura(page);
    const tutorial = page.getByTestId('tutorial');
    // es opcional: no se abre solo
    await expect(tutorial).toBeHidden();
    // lejos del cartel, la tecla de accion no lo abre
    await page.keyboard.press('KeyE');
    await expect(tutorial).toBeHidden();

    await irAlCartel(page);
    await page.keyboard.press('KeyE');
    await expect(tutorial).toBeVisible();
    await expect(page.getByTestId('tutorial-body').locator('.tut-card')).toHaveCount(9);
    await expect(page.getByTestId('tutorial-body')).toContainText('Voltereta');
    await expect(page.getByTestId('tutorial-body')).toContainText('Esencia lunar');

    // 1) boton Cerrar
    await page.getByTestId('tutorial-close').click();
    await expect(tutorial).toBeHidden();
    // 2) la X
    await page.keyboard.press('KeyE');
    await expect(tutorial).toBeVisible();
    await page.getByTestId('tutorial-x').click();
    await expect(tutorial).toBeHidden();
    // 3) Escape: cierra el tutorial y no abre el menu del juego
    await page.keyboard.press('KeyE');
    await expect(tutorial).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tutorial).toBeHidden();
    await expect(page.locator('#menu')).toBeHidden();
    // 4) tocar afuera
    await page.keyboard.press('KeyE');
    await expect(tutorial).toBeVisible();
    await page.waitForTimeout(600);
    await page.mouse.click(4, 4);
    await expect(tutorial).toBeHidden();
  });

  test('mientras se lee el tutorial el gato no se mueve y despues vuelve a responder', async ({
    page,
  }) => {
    await empezarAventura(page);
    await irAlCartel(page);
    await page.keyboard.press('KeyE');
    await expect(page.getByTestId('tutorial')).toBeVisible();
    const before = await page.evaluate(() => (window as unknown as Game).__game.x);
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyA');
    expect(await page.evaluate(() => (window as unknown as Game).__game.x)).toBe(before);

    await page.getByTestId('tutorial-close').click();
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyA');
    expect(await page.evaluate(() => (window as unknown as Game).__game.x)).toBeLessThan(
      before - 8,
    );
  });

  test('al empezar la pelea con un jefe hay una presentacion: todos quietos, y despues se pelea', async ({
    page,
  }) => {
    await empezarAventura(page);
    await emit(page, 'dev:arm');
    await emit(page, 'dev:room', 4);
    await page.waitForFunction(() => (window as unknown as Game).__game.bossIntro !== null, null, {
      timeout: 15_000,
    });
    // la camara se enfoca en el jefe: franjas de cine y sin botones encima
    await expect(page.locator('body')).toHaveClass(/cinema/);
    const at = await page.evaluate(() => ({
      x: (window as unknown as Game).__game.x,
      y: (window as unknown as Game).__game.y,
    }));
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await page.waitForTimeout(1200);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    const during = await page.evaluate(() => ({
      x: (window as unknown as Game).__game.x,
      y: (window as unknown as Game).__game.y,
      hp: window.__cybergrid?.hp,
    }));
    expect(during.x).toBe(at.x);
    expect(during.y).toBe(at.y);
    expect(during.hp).toBe(100);

    // pasada la presentacion el gato vuelve a responder y los botones regresan
    await page.waitForFunction(() => (window as unknown as Game).__game.bossIntro === null, null, {
      timeout: 8000,
    });
    await expect(page.locator('body')).not.toHaveClass(/cinema/);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyD');
    expect(await page.evaluate(() => (window as unknown as Game).__game.x)).toBeGreaterThan(
      at.x + 8,
    );
  });
});
