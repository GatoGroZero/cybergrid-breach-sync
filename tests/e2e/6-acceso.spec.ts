import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueName } from './helpers';

test.describe('Flujo 6: acceso con Google, correo e invitado', () => {
  test('la pantalla ofrece Google, correo e invitado y no enseña la cuenta demo', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('screen-auth')).toBeVisible();
    await expect(page.getByTestId('btn-google')).toBeVisible();
    await expect(page.getByTestId('email-address')).toBeVisible();
    await expect(page.getByTestId('btn-guest')).toBeVisible();
    await expect(page.getByTestId('screen-auth')).not.toContainText('demo1');
    await expect(page.getByTestId('screen-auth')).not.toContainText('CyberGrid26');
    // El usuario y contraseña queda recogido, sin estorbar.
    expect(
      await page.getByTestId('auth-legacy').evaluate((el) => (el as HTMLDetailsElement).open),
    ).toBe(false);
    await expect(page.getByTestId('auth-user')).toBeHidden();
  });

  test('invitado: entra con un clic, confirma su apodo, la sesión sobrevive a recargar y puede cambiarlo', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('btn-guest').click();
    await expect(page.getByTestId('nick-panel')).toBeVisible();
    await expect(page.getByTestId('nick-input')).toHaveValue(/^Gato\d{4}$/);

    await page.getByTestId('nick-input').fill('x');
    await page.getByTestId('nick-save').click();
    await expect(page.getByTestId('nick-error')).toContainText('al menos 3');
    await page.getByTestId('nick-input').fill('<b>hola</b>');
    await page.getByTestId('nick-save').click();
    await expect(page.getByTestId('nick-error')).toContainText('solo puede llevar');

    await page.getByTestId('nick-input').fill('Mochi Gato');
    await page.getByTestId('nick-save').click();
    await expect(page.getByTestId('screen-lobby')).toBeVisible();
    await expect(page.getByTestId('lobby-user')).toHaveText('Mochi Gato');
    await expect(page.getByTestId('lobby-net')).toHaveAttribute('data-state', 'online');

    // Recargar no vuelve a pedir el apodo ni cierra la sesión.
    await page.reload();
    await expect(page.getByTestId('lobby-user')).toHaveText('Mochi Gato');
    await expect(page.getByTestId('nick-panel')).toBeHidden();

    // Se cambia desde el lobby y la conexión sigue con el nombre nuevo.
    await page.getByTestId('lobby-user').click();
    await page.getByTestId('nick-input').fill('Gato Pixel');
    await page.getByTestId('nick-save').click();
    await expect(page.getByTestId('lobby-user')).toHaveText('Gato Pixel');
    await expect(page.getByTestId('lobby-net')).toHaveAttribute('data-state', 'online');
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
  });

  test('Google: el botón manda a Google con state, PKCE y el regreso del juego', async ({
    page,
    context,
  }) => {
    let target: URL | null = null;
    // El navegador sigue el redireccionamiento solo, así que se intercepta la respuesta del juego
    // (con su Location y su cookie) y no se llega a abrir Google de verdad.
    await page.route('**/api/auth/google/start', async (route) => {
      const res = await route.fetch({ maxRedirects: 0 });
      target = new URL(res.headers().location ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'set-cookie': res.headers()['set-cookie'] ?? '' },
        body: '<p>Google</p>',
      });
    });
    await page.goto('/');
    await page.getByTestId('btn-google').click();
    await expect.poll(() => target?.pathname).toBe('/o/oauth2/v2/auth');
    const q = (target as unknown as URL).searchParams;
    expect(q.get('client_id')).toBe('e2e-cliente.apps.googleusercontent.com');
    expect(q.get('redirect_uri')).toMatch(/\/api\/auth\/google\/callback$/);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBeTruthy();
    expect(q.get('nonce')).toBeTruthy();
    expect(q.get('scope')).toBe('openid profile');

    const flow = (await context.cookies()).find((c) => c.name === 'cg_oauth');
    expect(flow?.httpOnly).toBe(true);
    expect(flow?.sameSite).toBe('Lax');
    expect(flow?.path).toBe('/api/auth/google');
  });

  test('Google: un regreso sin cookie de flujo o cancelado muestra un aviso claro y no abre sesión', async ({
    page,
  }) => {
    await page.goto('/api/auth/google/callback?code=falso&state=falso');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('auth-error')).toHaveText(
      'No pudimos entrar con Google, intenta de nuevo',
    );
    await page.goto('/api/auth/google/callback?error=access_denied');
    await expect(page.getByTestId('auth-error')).toHaveText('Cancelaste el acceso con Google');
    await expect(page.getByTestId('screen-lobby')).toBeHidden();
  });

  test('correo: pide el código, valida el formato y rechaza uno equivocado', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('email-address').fill('esto-no-es-un-correo');
    await page.getByTestId('email-send').click();
    await expect(page.getByTestId('auth-error')).toContainText('correo válido');

    await page.getByTestId('email-address').fill('jugadora@example.com');
    await page.getByTestId('email-send').click();
    await expect(page.getByTestId('email-code')).toBeVisible();
    await expect(page.locator('#code-help')).toContainText('jugadora@example.com');

    await page.getByTestId('email-code').fill('12ab');
    await page.getByTestId('code-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('El código tiene 6 números');
    await page.getByTestId('email-code').fill('000000');
    await page.getByTestId('code-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('Ese código no es correcto');
    await expect(page.getByTestId('screen-lobby')).toBeHidden();

    await page.locator('#code-back').click();
    await expect(page.getByTestId('email-address')).toBeVisible();
  });

  test('el enlace de invitación sobrevive al registro: un invitado entra directo a la sala', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await registerViaUi(a, uniqueName('e2e_anf'));
    await a.getByTestId('room-private').check();
    await a.getByTestId('btn-create').click();
    await expect(a.getByTestId('room-view')).toBeVisible();
    const code = (await a.getByTestId('room-code').textContent()) ?? '';

    await b.goto(`/?sala=${code}`);
    await expect(b.getByTestId('screen-auth')).toBeVisible();
    await expect(b).not.toHaveURL(/sala=/);
    await b.getByTestId('btn-guest').click();
    await b.getByTestId('nick-input').fill('Amigo Invitado');
    await b.getByTestId('nick-save').click();
    await expect(b.getByTestId('room-view')).toBeVisible({ timeout: 10_000 });
    await expect(a.getByTestId('member')).toHaveCount(2);
    await expect(a.locator('[data-testid="member"][data-name="Amigo Invitado"]')).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('con usuario y contraseña no se pide apodo (cuentas locales)', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_loc'));
    await expect(page.getByTestId('nick-panel')).toBeHidden();
  });
  test('la política de privacidad existe, se enlaza desde el acceso y cabe en el móvil', async ({
    page,
    request,
  }) => {
    const res = await request.get('/privacidad');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(await res.text()).toContain('Política de privacidad');

    await page.goto('/');
    const link = page.getByTestId('link-privacidad');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/privacidad');
    await page.goto('/privacidad');
    await expect(page.getByRole('heading', { name: 'Política de privacidad' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al juego' })).toBeVisible();
    // Sin barra de desplazamiento horizontal en pantallas angostas.
    await page.setViewportSize({ width: 360, height: 740 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
