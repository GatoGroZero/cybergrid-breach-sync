import { expect, test } from '@playwright/test';
import { registerViaUi, startSoloGame, uniqueName } from './helpers';

interface DebugGame {
  inv: ({ kind: string; qty: number; rarity: number } | null)[];
  latest: { walls: unknown[]; me: { sel: number } } | null;
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
    expect((await game()).inv[1]).toMatchObject({ kind: 'ammo_rifle', qty: 90 });

    // El fusil es arma automatica: mantener el clic gasta varias balas.
    await page.keyboard.press('Digit1');
    await page.mouse.move(900, 300);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    const ammo = (await game()).inv[1]?.qty ?? 90;
    expect(ammo).toBeLessThan(90);
    expect(ammo).toBeGreaterThan(70);

    // Un mini muro: se elige el espacio 5 y un clic lo coloca delante del gato.
    await page.keyboard.press('Digit5');
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
    await expect(page.locator('#results-body tr')).toHaveCount(10);
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
