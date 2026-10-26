import { expect, test, type Page } from '@playwright/test';
import { closeOptions, openOptions, registerViaUi, uniqueName } from './helpers';

type Sock = { __net: { socket: { emit(e: string, p?: unknown): void } } };

const emit = (page: Page, event: string, payload?: unknown): Promise<void> =>
  page.evaluate(([e, p]) => (window as unknown as Sock).__net.socket.emit(e as string, p), [
    event,
    payload,
  ] as const);

/** Deja la bolsa de esencia y las mejoras de la Aventura como se pide, antes de abrir la pagina. */
async function seedMeta(
  page: Page,
  save: { essence: number; levels?: Record<string, number> },
  debug = false,
): Promise<void> {
  await page.evaluate((s) => {
    window.localStorage.setItem(
      'cg_meta_v1',
      JSON.stringify({ levels: s.levels ?? {}, essence: s.essence, runs: 0, wins: 0, best: 0 }),
    );
  }, save);
  if (debug) await page.goto('/?debug');
  else await page.reload();
  await expect(page.getByTestId('screen-lobby')).toBeVisible();
}

test.describe('Flujo 13: Aventura en el bosque encantado', () => {
  test('el Santuario guarda la esencia, vende mejoras y recuerda lo comprado', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_san'));
    await page.locator('[data-mode=aventura]').click();
    await expect(page.getByTestId('solo-help')).toContainText('bosque encantado');
    await openOptions(page);
    await expect(page.getByTestId('room-bots')).toBeHidden();
    const maps = await page.getByTestId('room-map').locator('option').allTextContents();
    expect(maps).toEqual(['Mapa al azar', 'Bosque encantado']);
    await closeOptions(page);

    await seedMeta(page, { essence: 70 });
    await expect(page.getByTestId('btn-shrine')).toBeVisible();
    await expect(page.getByTestId('shrine-badge')).toHaveText('70');
    await page.getByTestId('btn-shrine').click();
    await expect(page.getByTestId('shrine')).toBeVisible();
    await expect(page.getByTestId('shrine-essence')).toHaveText('70');
    await expect(page.getByTestId('shrine-list').locator('li')).toHaveCount(7);

    // "Corazon fuerte" cuesta 20 al primer nivel y 40 al segundo
    const heart = page.getByTestId('shrine-vida');
    await heart.getByRole('button').click();
    await expect(page.getByTestId('shrine-essence')).toHaveText('50');
    await heart.getByRole('button').click();
    await expect(page.getByTestId('shrine-essence')).toHaveText('10');
    // sin esencia suficiente ya no se puede seguir
    await expect(heart.getByRole('button')).toBeDisabled();
    await expect(heart.locator('.shrine-pips i[data-on=true]')).toHaveCount(2);

    // se recuerda al volver a abrir la pagina
    await page.reload();
    await page.getByTestId('btn-shrine').click();
    await expect(page.getByTestId('shrine-essence')).toHaveText('10');
    await expect(
      page.getByTestId('shrine-vida').locator('.shrine-pips i[data-on=true]'),
    ).toHaveCount(2);
    await page.getByTestId('shrine-close').click();
    await expect(page.getByTestId('shrine')).toBeHidden();
  });

  test('una aventura en solitario: reliquia inicial, puertas, enemigos, volteretas y victoria', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_adv'), true);
    await page.locator('[data-mode=aventura]').click();
    // dos niveles de vida extra, y el regalo del bosque: una reliquia al empezar
    await seedMeta(page, { essence: 5, levels: { vida: 2, reliquia: 1 } }, true);
    await page.locator('[data-mode=aventura]').click();
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 5);
    await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 20_000 });
    const hud = (): Promise<NonNullable<Window['__cybergrid']>> =>
      page.evaluate(() => window.__cybergrid as NonNullable<Window['__cybergrid']>);

    // arranca en el claro de inicio con 7 vidas, 120 de vida maxima y tres reliquias para elegir
    let s = await hud();
    expect(s.advRoom).toBe(0);
    expect(s.advLives).toBe(7);
    expect(s.advChoice).toBe(3);
    expect(s.mode).toBe('keyboard');
    // la tecla 2 elige la reliquia del medio
    await page.keyboard.press('Digit2');
    await page.waitForFunction(() => window.__cybergrid?.advRelics === 1);
    s = await hud();
    expect(s.advChoice).toBe(0);

    // a la sala de combate: las puertas se cierran y aparecen enemigos
    await emit(page, 'dev:arm');
    await emit(page, 'dev:room', 1);
    await page.waitForFunction(() => (window.__cybergrid?.advRoom ?? 0) === 1);
    await page.waitForFunction(() => (window.__cybergrid?.advClosed ?? 0) >= 1, null, {
      timeout: 8000,
    });
    await page.waitForFunction(() => (window.__cybergrid?.advMobs ?? 0) >= 1, null, {
      timeout: 8000,
    });

    // la voltereta (tecla Q) lanza al gato en la direccion en que camina
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(150);
    const x0 = (await hud()).x;
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(260);
    const x1 = (await hud()).x;
    await page.keyboard.up('KeyD');
    expect(x1 - x0).toBeGreaterThan(30);

    // se da la aventura por ganada: sale la pantalla de victoria con la esencia ganada
    await emit(page, 'dev:win');
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#results-title')).toHaveText('¡EL BOSQUE ESTÁ A SALVO!');
    await expect(page.getByTestId('results-adv')).toBeVisible();
    await expect(page.getByTestId('adv-essence')).toContainText('esencia lunar');
    const bank = await page.evaluate(
      () => JSON.parse(window.localStorage.getItem('cg_meta_v1') ?? '{}') as { essence: number },
    );
    expect(bank.essence).toBeGreaterThan(5);
    await page.getByTestId('btn-back').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
  });

  test('al vencer a un jefe se elige una habilidad, se usa con su tecla y el botin trae armas y curas', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_hab'), true);
    await page.locator('[data-mode=aventura]').click();
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 20_000 });
    const hud = (): Promise<NonNullable<Window['__cybergrid']>> =>
      page.evaluate(() => window.__cybergrid as NonNullable<Window['__cybergrid']>);

    // a la guarida del primer minijefe: aparece el jefe y se le da por vencido
    // el bosque se arma distinto en cada partida: se busca la guarida del primer minijefe
    const guarida = await page.evaluate(() =>
      (
        window as unknown as { __game: { map: { rooms: { kind: string }[] } } }
      ).__game.map.rooms.findIndex((r) => r.kind === 'minijefe'),
    );
    await emit(page, 'dev:room', guarida);
    await page.waitForFunction(
      () => (window as unknown as { __game: { adv: { boss: unknown } } }).__game.adv.boss !== null,
      null,
      { timeout: 12_000 },
    );
    await emit(page, 'dev:boss');
    // primero se elige la reliquia y luego la habilidad
    await page.waitForFunction(() => (window.__cybergrid?.advChoice ?? 0) === 3, null, {
      timeout: 8000,
    });
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => (window.__cybergrid?.advPChoice ?? 0) === 3, null, {
      timeout: 8000,
    });
    // el botin del jefe: armas, curas, escudos, corazones y balas en el suelo
    expect((await hud()).advPickups).toBeGreaterThanOrEqual(10);
    await page.keyboard.press('Digit2');
    await page.waitForFunction(() => window.__cybergrid?.advPowers === 1);
    expect((await hud()).advPChoice).toBe(0);
    // la tecla F usa la primera habilidad y la deja en espera
    await page.waitForTimeout(2300);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(
      () =>
        (window as unknown as { __game: { adv: { powers: [number, number, number, number][] } } })
          .__game.adv.powers[0]![2] > 5,
      null,
      { timeout: 5000 },
    );
  });

  test('si el grupo cae, el bosque gana pero la esencia no se pierde', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_cae'), true);
    await page.locator('[data-mode=aventura]').click();
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 20_000 });
    await emit(page, 'dev:finish');
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#results-title')).toHaveText('El bosque los venció');
    await expect(page.getByTestId('adv-essence')).toBeVisible();
  });
});
