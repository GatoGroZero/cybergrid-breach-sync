import { expect, test, type Page } from '@playwright/test';
import { createRoomUi, openTab, registerViaUi, uniqueName } from './helpers';

const emit = (page: Page, event: string): Promise<void> =>
  page.evaluate(
    (e) =>
      (window as unknown as { __net: { socket: { emit(n: string): void } } }).__net.socket.emit(e),
    event,
  );

test.describe('Flujo 16: grupo, partida en curso, ausente y expulsar', () => {
  test('salir de la partida deja a la persona en el grupo; otra entra con la partida en curso', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const [a, b, c] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxC.newPage()]);
    const nameA = uniqueName('e2e_gha');
    const nameB = uniqueName('e2e_ghb');
    const nameC = uniqueName('e2e_ghc');
    await registerViaUi(a, nameA, true);
    await registerViaUi(b, nameB, true);
    await registerViaUi(c, nameC, true);

    await createRoomUi(a, { name: 'Grupo E2E' });
    await openTab(b, 'salas');
    await b.getByTestId('room-list').getByRole('button', { name: 'Entrar' }).first().click();
    await expect(b.getByTestId('room-view')).toBeVisible();
    await a.getByTestId('btn-ready').click();
    await b.getByTestId('btn-ready').click();
    await expect(a.locator('#game')).toBeVisible({ timeout: 15_000 });
    await expect(b.locator('#game')).toBeVisible({ timeout: 15_000 });

    // B sale de la partida: vuelve al lobby y SIGUE en el grupo; A sigue jugando
    await b.getByTestId('btn-menu').click();
    await b.getByTestId('btn-quit').click();
    await b.getByTestId('btn-quit').click();
    await expect(b.getByTestId('screen-lobby')).toBeVisible();
    await expect(b.getByTestId('room-view')).toBeVisible();
    await expect(b.getByTestId('member')).toHaveCount(2);
    await expect(b.getByTestId('room-status')).toContainText('partida en curso');
    await expect(a.locator('#game')).toBeVisible();

    // C llega con la partida en curso: la sala sale en la lista y puede esperar dentro
    await openTab(c, 'salas');
    const row = c.getByTestId('room-list').locator('li', { hasText: 'Grupo E2E' });
    await expect(row).toBeVisible({ timeout: 8000 });
    await row.getByRole('button', { name: 'Esperar dentro' }).click();
    await expect(c.getByTestId('room-view')).toBeVisible();
    await expect(c.getByTestId('member')).toHaveCount(3);
    await expect(c.getByTestId('btn-ready')).toBeDisabled();
    await expect(c.locator('#game')).toBeHidden();

    // A termina la partida: los tres quedan en el lobby del mismo grupo
    await emit(a, 'dev:finish');
    await expect(c.getByTestId('btn-ready')).toBeEnabled({ timeout: 20_000 });
    await expect(b.getByTestId('btn-ready')).toBeEnabled();

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });

  test('ausente no estorba para empezar y el anfitrion puede expulsar', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const nameA = uniqueName('e2e_ana2');
    const nameB = uniqueName('e2e_ben2');
    await registerViaUi(a, nameA);
    await registerViaUi(b, nameB);
    await createRoomUi(a, { name: 'Ausentes E2E' });
    await openTab(b, 'salas');
    await b.getByTestId('room-list').getByRole('button', { name: 'Entrar' }).first().click();
    await expect(a.getByTestId('member')).toHaveCount(2);

    // B se pone ausente: sigue en la lista, no puede marcar Listo y su estado se ve en A
    await b.getByTestId('btn-away').click();
    await expect(b.getByTestId('btn-away')).toHaveText('Volver');
    await expect(b.getByTestId('btn-ready')).toBeDisabled();
    await expect(
      a.locator(`[data-testid="member"][data-name="${nameB}"] [data-testid="member-state"]`),
    ).toHaveText('Ausente');
    await expect(a.getByTestId('member')).toHaveCount(2);

    // B vuelve
    await b.getByTestId('btn-away').click();
    await expect(b.getByTestId('btn-ready')).toBeEnabled();
    await expect(
      a.locator(`[data-testid="member"][data-name="${nameB}"] [data-testid="member-state"]`),
    ).toHaveText('Esperando');

    // solo el anfitrion ve el boton de expulsar, y pide confirmar
    await expect(b.getByTestId('btn-kick')).toHaveCount(0);
    const kick = a.getByTestId('btn-kick');
    await expect(kick).toHaveCount(1);
    await kick.click();
    await expect(kick).toHaveText('¿Seguro?');
    await kick.click();
    await expect(a.getByTestId('member')).toHaveCount(1);
    await expect(b.getByTestId('room-view')).toBeHidden();
    await expect(b.getByTestId('toast')).toContainText('sacó de la sala');

    await ctxA.close();
    await ctxB.close();
  });
});
