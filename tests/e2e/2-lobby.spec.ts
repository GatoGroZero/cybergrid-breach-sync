import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueName } from './helpers';

test.describe('Flujo 2: lobbies, estado Listo y sockets', () => {
  test('crear sala, ver al otro jugador, marcar Listo y arrancar la partida', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const nameA = uniqueName('e2e_ana');
    const nameB = uniqueName('e2e_beto');
    await registerViaUi(a, nameA);
    await registerViaUi(b, nameB);

    await a.getByTestId('room-name').fill('Sala E2E');
    await a.getByTestId('btn-create').click();
    await expect(a.getByTestId('room-view')).toBeVisible();
    const code = (await a.getByTestId('room-code').textContent()) ?? '';
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);

    // B ve la sala publica en la lista (actualizada por socket) y entra.
    await expect(b.getByTestId('room-list').getByText('Sala E2E')).toBeVisible({ timeout: 8000 });
    await b.getByTestId('room-list').getByRole('button', { name: 'Entrar' }).first().click();
    await expect(b.getByTestId('room-view')).toBeVisible();
    await expect(a.getByTestId('member')).toHaveCount(2);
    await expect(b.getByTestId('member')).toHaveCount(2);

    // El estado Listo de A se propaga en tiempo real a B.
    await a.getByTestId('btn-ready').click();
    await expect(
      b.locator(`[data-testid="member"][data-name="${nameA}"] [data-testid="member-state"]`),
    ).toHaveText('Listo');
    await b.getByTestId('btn-ready').click();

    // Con todos listos hay cuenta regresiva y arranca la partida en los dos.
    await expect(a.locator('#game')).toBeVisible({ timeout: 15_000 });
    await expect(b.locator('#game')).toBeVisible({ timeout: 15_000 });
    await a.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 5);
    await b.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 5);

    await ctxA.close();
    await ctxB.close();
  });

  test('una sala privada solo admite a quien tiene el código', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await registerViaUi(a, uniqueName('e2e_priv'));
    await registerViaUi(b, uniqueName('e2e_intr'));

    await a.getByTestId('room-name').fill('Privada E2E');
    await a.getByTestId('room-private').check();
    await a.getByTestId('btn-create').click();
    await expect(a.getByTestId('room-view')).toBeVisible();
    await expect(a.getByTestId('room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{5}$/);
    const code = (await a.getByTestId('room-code').textContent()) ?? '';

    await b.waitForTimeout(3500);
    await expect(b.getByTestId('room-list').getByText('Privada E2E')).toHaveCount(0);

    await b.getByTestId('join-code').fill('ZZZZZ');
    await b.getByTestId('btn-join').click();
    await expect(b.getByTestId('lobby-error')).toHaveText('Esa sala no existe');

    await b.getByTestId('join-code').fill(code);
    await b.getByTestId('btn-join').click();
    await expect(b.getByTestId('room-view')).toBeVisible();
    await expect(a.getByTestId('member')).toHaveCount(2);

    await ctxA.close();
    await ctxB.close();
  });
});
