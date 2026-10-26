import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import {
  confirmNickname,
  fillLogin,
  fillSignup,
  openSignup,
  PASSWORD,
  registerViaUi,
  uniqueEmail,
  uniqueName,
} from './helpers';

test.describe('Flujo 1: autenticación y protección', () => {
  test('una ruta protegida sin sesión manda al login', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('screen-auth')).toBeVisible();
    await expect(page.getByTestId('screen-lobby')).toBeHidden();
  });

  test('valida credenciales: rechaza las malas y deja entrar con las buenas', async ({ page }) => {
    const name = uniqueName('e2e_auth');
    const email = await registerViaUi(page, name);
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page.getByTestId('screen-auth')).toBeVisible();

    await fillLogin(page, email, 'contraseña-incorrecta');
    await expect(page.getByTestId('auth-error')).toHaveText('Correo o contraseña incorrectos');
    await expect(page.getByTestId('screen-lobby')).toBeHidden();

    // el correo se reconoce sin importar las mayúsculas
    await page.getByTestId('login-email').fill(email.toUpperCase());
    await page.getByTestId('login-pass').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await expect(page.getByTestId('lobby-user')).toHaveText(name);
  });

  test('el registro pide correo válido, contraseña y su confirmación, y no permite duplicados', async ({
    page,
  }) => {
    await page.goto('/login');
    await openSignup(page);
    await expect(page.getByTestId('signup-email')).toBeVisible();
    await expect(page.getByTestId('signup-pass')).toBeVisible();
    await expect(page.getByTestId('signup-confirm')).toBeVisible();

    await fillSignup(page, 'esto-no-es-un-correo');
    await expect(page.getByTestId('auth-error')).toContainText('correo válido');

    await fillSignup(page, uniqueEmail(), 'corta');
    await expect(page.getByTestId('auth-error')).toContainText('al menos 8');

    await fillSignup(page, uniqueEmail(), PASSWORD, `${PASSWORD}x`);
    await expect(page.getByTestId('auth-error')).toHaveText('Las contraseñas no coinciden');
    await expect(page.getByTestId('screen-lobby')).toBeHidden();

    const email = await registerViaUi(page, uniqueName('e2e_dup'));
    await page.getByRole('button', { name: 'Salir' }).click();
    await fillSignup(page, email.toUpperCase());
    await expect(page.getByTestId('auth-error')).toHaveText(
      'Ese correo ya tiene una cuenta: inicia sesión',
    );
  });

  test('una contraseña con ñ y acentos funciona al crear la cuenta y al volver a entrar', async ({
    page,
  }) => {
    const clave = 'Contraseñañandú2026';
    await page.goto('/login');
    const email = uniqueEmail('enie');
    await fillSignup(page, email, clave);
    await confirmNickname(page, uniqueName('e2e_enie'));
    await expect(page.getByTestId('screen-lobby')).toBeVisible();

    await page.getByRole('button', { name: 'Salir' }).click();
    await fillLogin(page, email, clave);
    await expect(page.getByTestId('screen-lobby')).toBeVisible();

    // la misma ñ escrita "descompuesta" (n + tilde) también abre la cuenta
    await page.getByRole('button', { name: 'Salir' }).click();
    await fillLogin(page, email, clave.normalize('NFD'));
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
  });

  test('la cuenta se recuerda: desde otro navegador entra con el mismo correo y conserva su apodo', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const name = uniqueName('e2e_vuelve');
    const email = await registerViaUi(a, name);

    await b.goto('/login');
    await fillLogin(b, email);
    // este navegador nunca vio la cuenta: pregunta el apodo, pero ya trae el que se eligió
    await expect(b.getByTestId('nick-input')).toHaveValue(name);
    await b.getByTestId('nick-save').click();
    await expect(b.getByTestId('lobby-user')).toHaveText(name);

    await ctxA.close();
    await ctxB.close();
  });

  test('las cuentas de demostración entran escribiendo el usuario en el campo de correo', async ({
    page,
  }) => {
    await page.goto('/login');
    await fillLogin(page, 'demo1', 'CyberGrid26');
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await expect(page.getByTestId('lobby-user')).toHaveText('demo1');
    await expect(page.getByTestId('nick-panel')).toBeHidden();
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
