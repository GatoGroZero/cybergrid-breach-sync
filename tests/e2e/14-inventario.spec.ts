import { expect, test, type Page } from '@playwright/test';
import { registerViaUi, uniqueName } from './helpers';

type G = {
  __net: { socket: { emit(e: string, p?: unknown): void } };
  __game: { ammo: number[]; inv: ({ kind: string } | null)[]; adv: { equip: number[] } };
};

const emit = (page: Page, event: string, payload?: unknown): Promise<void> =>
  page.evaluate(([e, p]) => (window as unknown as G).__net.socket.emit(e as string, p), [
    event,
    payload,
  ] as const);
const ammo = (page: Page): Promise<number[]> =>
  page.evaluate(() => [...(window as unknown as G).__game.ammo]);

async function empezar(page: Page): Promise<void> {
  await registerViaUi(page, uniqueName('e2e_inv'), true);
  await page.locator('[data-mode=aventura]').click();
  await page.getByTestId('btn-solo').click();
  await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 20_000 });
  await emit(page, 'dev:arm');
  await emit(page, 'dev:power', { id: 0, lvl: 2 });
  await emit(page, 'dev:armor', { slot: 0, tier: 2 });
  await page.waitForFunction(
    () =>
      (window as unknown as G).__game.adv.equip[0] === 2 &&
      (window as unknown as G).__game.ammo[4]! > 0,
  );
}

test.describe('Flujo 17: inventario con detalle, balas por cantidad y pestañas', () => {
  test('al tocar un arma sus datos salen al lado, y las balas se tiran por cantidad', async ({
    page,
  }) => {
    await empezar(page);
    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('inv')).toBeVisible();

    // el fusil (casilla 3): sus datos salen a la derecha de la mochila, no hasta abajo
    await page.getByTestId('inv-slot').nth(2).click();
    const detail = page.getByTestId('inv-detail');
    await expect(detail).toContainText('Fusil');
    await expect(detail).toContainText('Daño por segundo');
    await expect(detail).toContainText('Automático');
    const slots = (await page.getByTestId('inv-slots').boundingBox())!;
    const box = (await detail.boundingBox())!;
    expect(box.x).toBeGreaterThan(slots.x + slots.width - 4);

    // balas del fusil: escribir 45 y tirar solo esas
    await page.getByTestId('ammo-chip').nth(4).click();
    await expect(detail).toContainText('Cuántas quieres tirar');
    const before = (await ammo(page))[4]!;
    await page.getByTestId('drop-qty').fill('45');
    await expect(page.getByTestId('drop-go')).toHaveText('Tirar 45');
    await page.getByTestId('drop-go').click();
    await expect.poll(async () => (await ammo(page))[4]).toBe(before - 45);

    // atajo de la mitad
    await page.getByTestId('preset-half').click();
    const half = Math.floor((before - 45) / 2);
    await expect(page.getByTestId('drop-go')).toHaveText(`Tirar ${half}`);
    await page.getByTestId('drop-go').click();
    await expect.poll(async () => (await ammo(page))[4]).toBe(before - 45 - half);

    // "todas" las deja en cero
    await page.getByTestId('preset-all').click();
    await page.getByTestId('drop-go').click();
    await expect.poll(async () => (await ammo(page))[4]).toBe(0);
  });

  test('las pestañas cuentan las habilidades y la armadura, y la armadura se puede quitar', async ({
    page,
  }) => {
    await empezar(page);
    await page.keyboard.press('KeyI');
    await page.getByTestId('inv-tab-habilidades').click();
    await expect(page.getByTestId('inv-powers')).toContainText('Furia felina');
    await expect(page.getByTestId('inv-detail')).toContainText('+40 %');
    await expect(page.getByTestId('inv-detail')).toContainText('Nivel');

    await page.getByTestId('inv-tab-equipo').click();
    await expect(page.getByTestId('inv-armor')).toContainText('Casco de luna');
    await expect(page.getByTestId('inv-detail')).toContainText('Escudo máximo');
    await page.getByTestId('armor-take').click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as G).__game.adv.equip[0]))
      .toBe(-1);
    await expect(page.getByTestId('inv-armor')).not.toContainText('Casco de luna');
  });

  test('X tira lo que llevas en la mano y Mayús + X la mitad de las balas', async ({ page }) => {
    await empezar(page);
    // el fusil en la mano (casilla 3)
    await page.keyboard.press('Digit3');
    const total = (await ammo(page))[4]!;
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyX');
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await ammo(page))[4]).toBe(total - Math.floor(total / 2));
    await page.keyboard.press('KeyX');
    await expect
      .poll(async () =>
        page.evaluate(() => (window as unknown as G).__game.inv.map((i) => i?.kind ?? null)),
      )
      .not.toContain('rifle');
  });

  test('pasar el ratón por armas, curas y balas no mueve ni cambia de tamaño la tarjeta (no tiembla)', async ({
    page,
  }) => {
    await empezar(page);
    // armas y curas de distinto tamaño en la mochila
    await emit(page, 'dev:kit', 'heavy');
    await emit(page, 'dev:kit');
    await expect(page.getByTestId('hud-coords')).toBeVisible();
    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('inv')).toBeVisible();
    const card = page.locator('.inv-card');
    const body = page.locator('.inv-body');
    const frame = async (): Promise<number[]> => {
      const c = (await card.boundingBox())!;
      const b = (await body.boundingBox())!;
      return [c.x, c.y, c.width, c.height, b.height].map((n) => Math.round(n * 2) / 2);
    };
    const quieto = await frame();

    const seen = new Set<string>();
    const detail = page.getByTestId('inv-detail');
    const slots = page.getByTestId('inv-slot');
    const chips = page.getByTestId('ammo-chip');
    const targets = [
      ...Array.from({ length: await slots.count() }, (_, i) => slots.nth(i)),
      ...Array.from({ length: await chips.count() }, (_, i) => chips.nth(i)),
    ];
    for (const target of targets) {
      if (
        (await target.isDisabled()) ||
        (await target.getAttribute('aria-label'))?.includes('vacío')
      )
        continue;
      await target.hover();
      seen.add((await detail.innerText()).slice(0, 40));
      expect(await frame()).toEqual(quieto);
      await target.click();
      expect(await frame()).toEqual(quieto);
    }
    // se probaron cosas de verdad distintas (armas, curas, balas), no la misma una y otra vez
    expect(seen.size).toBeGreaterThanOrEqual(4);

    // y lo mismo en las otras pestañas
    for (const tab of ['inv-tab-habilidades', 'inv-tab-equipo']) {
      await page.getByTestId(tab).click();
      expect(await frame()).toEqual(quieto);
    }
  });
});
