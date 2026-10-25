import { expect, test } from '@playwright/test';
import { openTab, registerViaUi, startSoloGame, uniqueName } from './helpers';

test.describe('Flujo 10: trajes de Halloween', () => {
  test('el traje se elige aparte del pelaje, se recuerda y lo llevan todos en la partida', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_traje'), true);
    await openTab(page, 'gato');
    await page.getByTestId('sub-traje').click();
    const buttons = page.getByTestId('outfits').locator('button');
    // "Sin traje" y al menos ocho trajes
    expect(await buttons.count()).toBeGreaterThanOrEqual(9);
    await expect(buttons.first()).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('sub-pelaje').click();
    await page.getByRole('radio', { name: 'Pelaje Gris' }).click();
    await page.getByTestId('sub-traje').click();
    await page.getByRole('radio', { name: 'Traje: Bruja' }).click();
    await expect(page.getByRole('radio', { name: 'Traje: Bruja' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // cambiar el color o pintar no quita el traje
    await page.getByTestId('sub-pelaje').click();
    await page.getByRole('radio', { name: 'Pelaje Rosa' }).click();
    await page.getByTestId('painter').getByRole('button', { name: 'Rayas' }).click();
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('cg_skin')!));
    expect(saved.outfit).toBe(1);
    expect(saved.base).toBe(7);
    expect(saved.paint).toMatch(/[1-9a-f]/);

    await page.goto('/?debug');
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await openTab(page, 'gato');
    await page.getByTestId('sub-traje').click();
    await expect(page.getByRole('radio', { name: 'Traje: Bruja' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // "Al azar" cambia el pelaje pero respeta el traje elegido
    await page.getByTestId('sub-pelaje').click();
    await page.getByTestId('painter').getByRole('button', { name: 'Al azar' }).click();
    const after = await page.evaluate(() => JSON.parse(window.localStorage.getItem('cg_skin')!));
    expect(after.outfit).toBe(1);

    await openTab(page, 'jugar');
    await startSoloGame(page);
    const seen = await page.evaluate(() => {
      const g = (
        window as unknown as {
          __game: { you: number; cats: Map<number, { skin: { outfit?: number }; bot: boolean }> };
        }
      ).__game;
      return {
        mine: g.cats.get(g.you)?.skin.outfit,
        bots: [...g.cats.values()].filter((c) => c.bot).map((c) => c.skin.outfit ?? 0),
      };
    });
    expect(seen.mine).toBe(1);
    expect(seen.bots.length).toBeGreaterThan(0);
    // los bots tambien andan disfrazados
    expect(seen.bots.some((o) => o > 0)).toBe(true);
  });
});
