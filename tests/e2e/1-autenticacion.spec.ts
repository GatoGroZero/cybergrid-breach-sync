import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import { PASSWORD, registerViaUi, uniqueName } from './helpers';

test.describe('Flujo 1: autenticación y protección', () => {
  test('una ruta protegida sin sesión manda al login', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('screen-auth')).toBeVisible();
    await expect(page.getByTestId('screen-lobby')).toBeHidden();
  });

  test('valida credenciales: rechaza las malas y deja entrar con las buenas', async ({ page }) => {
    const name = uniqueName('e2e_auth');
    await registerViaUi(page, name);
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page.getByTestId('screen-auth')).toBeVisible();

    await page.getByTestId('auth-user').fill(name);
    await page.getByTestId('auth-pass').fill('contraseña-incorrecta');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('Usuario o contraseña incorrectos');
    await expect(page.getByTestId('screen-lobby')).toBeHidden();

    await page.getByTestId('auth-pass').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await expect(page.getByTestId('lobby-user')).toHaveText(name);
  });

  test('el registro exige usuario y contraseña válidos y no permite duplicados', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('tab', { name: 'Crear cuenta' }).click();
    await page.getByTestId('auth-user').fill('ab');
    await page.getByTestId('auth-pass').fill('corta');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText('usuario');

    const name = uniqueName('e2e_dup');
    await registerViaUi(page, name);
    await page.getByRole('button', { name: 'Salir' }).click();
    await page.getByRole('tab', { name: 'Crear cuenta' }).click();
    await page.getByTestId('auth-user').fill(name.toUpperCase());
    await page.getByTestId('auth-pass').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('Ese usuario ya existe');
  });

  test('las salas están protegidas: un socket sin sesión es rechazado', async ({ baseURL }) => {
    const socket = io(baseURL as string, { transports: ['websocket'], reconnection: false });
    const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
    socket.close();
  });

  test('la sesión sobrevive a recargar y la cookie no es accesible desde JavaScript', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_ses'));
    await page.reload();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain('cg_session');
  });
});
