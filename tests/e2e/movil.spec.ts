import { expect, test } from '@playwright/test';
import { coords, registerViaUi, startSoloGame, uniqueName } from './helpers';

test.describe('Móvil: controles táctiles', () => {
  test('el modo tactil se activa solo y arrastrar el joystick mueve al gato', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_mov'));
    await startSoloGame(page);

    expect((await page.evaluate(() => window.__cybergrid))?.mode).toBe('touch');
    await expect(page.getByTestId('hud-mode')).toHaveText('táctil');

    // El joystick esta abajo a la izquierda: se apoya el pulgar en su centro y se arrastra.
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const stick = { x: size.w * 0.13, y: size.h * 0.72 };
    const r = Math.max(46, size.h * 0.12);

    const cdp = await page.context().newCDPSession(page);
    const before = await coords(page);
    const dirs = [
      { x: r, y: 0 },
      { x: 0, y: r },
      { x: -r, y: 0 },
      { x: 0, y: -r },
    ];
    let moved = false;
    for (const d of dirs) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: stick.x, y: stick.y, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: stick.x + d.x, y: stick.y + d.y, id: 1 }],
      });
      await page.waitForTimeout(500);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const after = await coords(page);
      if (Math.hypot(after.x - before.x, after.y - before.y) > 8) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  test('en vertical pide girar el teléfono y en horizontal deja jugar', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_rot'));
    await startSoloGame(page);
    await expect(page.getByTestId('rotate')).toBeHidden();

    // Android entra en pantalla completa al jugar; hay que salir para poder girar el viewport.
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await expect(page.getByTestId('rotate')).toBeVisible();
    await expect(page.getByTestId('rotate')).toContainText('Gira tu teléfono');

    await page.setViewportSize({ width: 915, height: 412 });
    await expect(page.getByTestId('rotate')).toBeHidden();
  });

  test('el lobby en vertical no estorba: solo la partida exige horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await registerViaUi(page, uniqueName('e2e_lob'));
    await expect(page.getByTestId('rotate')).toBeHidden();
    await expect(page.getByTestId('btn-solo')).toBeVisible();
  });

  test('el inventario se abre con la lata y se ordena arrastrando con el dedo', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_dedo'), true);
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

    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const cdp = await page.context().newCDPSession(page);
    const touch = async (
      type: 'touchStart' | 'touchEnd' | 'touchMove',
      x?: number,
      y?: number,
    ): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 7 }],
      });
    };
    // La lata de sardinas esta a la derecha, a media altura.
    await touch('touchStart', size.w * 0.94, size.h * 0.44);
    await touch('touchEnd');
    await expect(page.getByTestId('inv')).toBeVisible();

    const center = async (i: number): Promise<{ x: number; y: number }> => {
      const b = (await page.getByTestId('inv-slot').nth(i).boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const a = await center(0);
    const b = await center(3);
    await touch('touchStart', a.x, a.y);
    for (let k = 1; k <= 8; k++)
      await touch('touchMove', a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8);
    await touch('touchEnd');
    await expect.poll(async () => (await inv())[3]).toBe('rifle');
  });
});
