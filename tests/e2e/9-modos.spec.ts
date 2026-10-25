import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueName } from './helpers';

test.describe('Flujo 12: modos de juego y pelea en el techo', () => {
  test('el selector muestra los modos, recuerda el elegido y adapta la ayuda de jugar solo', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_modo'));
    const picker = page.getByTestId('mode-picker');
    await expect(picker.locator('button')).toHaveCount(4);
    await expect(page.locator('[data-mode=br]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('solo-help')).toContainText('11 bots');
    // el modo que aun no esta listo se ve, pero no se puede elegir
    await expect(page.locator('[data-mode=territorio]')).toBeEnabled();
    await expect(page.locator('[data-mode=aventura]')).toBeDisabled();

    await page.locator('[data-mode=techo]').click();
    await expect(page.locator('[data-mode=techo]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('solo-help')).toContainText('tejado');
    await expect(page.getByTestId('room-format')).toBeVisible();
    await expect(page.getByTestId('room-bots')).toBeHidden();
    // el mapa cambia a los tres techos
    const maps = await page.getByTestId('room-map').locator('option').allTextContents();
    expect(maps).toEqual([
      'Mapa al azar',
      'Tejado a dos aguas',
      'Azotea con antenas',
      'Mansarda de pizarra',
    ]);
    await page.getByTestId('room-format').selectOption('2v2');
    await expect(page.getByTestId('solo-help')).toContainText('dos bots');

    await page.reload();
    await expect(page.locator('[data-mode=techo]')).toHaveAttribute('aria-checked', 'true');
  });

  test('en la sala se ven los dos equipos y se puede cambiar de lado', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const nameA = uniqueName('e2e_eqa');
    const nameB = uniqueName('e2e_eqb');
    await registerViaUi(a, nameA);
    await registerViaUi(b, nameB);

    await a.locator('[data-mode=techo]').click();
    await a.getByTestId('room-format').selectOption('2v2');
    await a.getByTestId('room-name').fill('Techo E2E');
    await a.getByTestId('btn-create').click();
    await expect(a.getByTestId('room-view')).toBeVisible();
    await expect(a.getByTestId('room-meta')).toContainText('Pelea en el techo');
    await expect(a.getByTestId('room-meta')).toContainText('2 contra 2');
    await expect(a.getByTestId('team-board')).toBeVisible();

    await expect(b.getByTestId('room-list').getByText('Techo E2E')).toBeVisible({ timeout: 8000 });
    await b.getByTestId('room-list').getByRole('button', { name: 'Entrar' }).first().click();
    await expect(b.getByTestId('team-board')).toBeVisible();
    // B cae en el equipo con menos gente: el azul
    await expect(b.getByTestId('team-1').getByTestId('member')).toHaveCount(1);
    await expect(a.getByTestId('team-0').getByTestId('member')).toHaveCount(1);
    // cada equipo muestra los lugares que ocupara un bot
    await expect(a.getByTestId('team-0')).toContainText('Un bot ocupará este lugar');

    // B se pasa al equipo de A
    await b.getByTestId('btn-team-0').click();
    await expect(a.getByTestId('team-0').getByTestId('member')).toHaveCount(2);
    await expect(a.getByTestId('team-1').getByTestId('member')).toHaveCount(0);
    // y ahora el equipo naranja esta completo: nadie mas cabe ahi
    await expect(a.getByTestId('team-0')).toContainText('2/2');
    await expect(b.getByTestId('btn-team-0')).toHaveCount(0);

    // el anfitrion cambia a 1 contra 1: sobran personas en el mismo equipo y se reparten solas
    await a.getByTestId('set-format').selectOption('1v1');
    await expect(a.getByTestId('team-0').getByTestId('member')).toHaveCount(1);
    await expect(a.getByTestId('team-1').getByTestId('member')).toHaveCount(1);

    await ctxA.close();
    await ctxB.close();
  });

  test('una pelea completa: elegir kit, cuenta, ronda, pausa y victoria del equipo', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_techo'), true);
    await page.locator('[data-mode=techo]').click();
    await page.getByTestId('room-map').selectOption('tejado');
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'pick', null, {
      timeout: 15_000,
    });

    // con la tecla 4 se elige el Bombardero
    await page.keyboard.press('Digit4');
    await page.waitForFunction(
      () =>
        (window as unknown as { __game: { pvp: { kit: string } } }).__game.pvp.kit === 'bombardero',
    );
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'ready', null, {
      timeout: 10_000,
    });
    // durante la cuenta todos estan quietos
    const before = await page.evaluate(() => ({
      x: window.__cybergrid?.x,
      y: window.__cybergrid?.y,
    }));
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyD');
    const after = await page.evaluate(() => ({
      x: window.__cybergrid?.x,
      y: window.__cybergrid?.y,
    }));
    expect(after).toEqual(before);

    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'fight', null, {
      timeout: 10_000,
    });
    const weapon = await page.evaluate(
      () => (window as unknown as { __game: { inv: { kind: string }[] } }).__game.inv[0]?.kind,
    );
    expect(weapon).toBe('bazooka');
    // ya en la pelea se puede caminar
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => (window.__cybergrid?.x ?? 0) > 0);
    const start = await page.evaluate(() => window.__cybergrid?.x ?? 0);
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyD');
    expect(await page.evaluate(() => window.__cybergrid?.x ?? 0)).toBeGreaterThan(start);

    // el equipo gana la primera ronda
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit: (e: string) => void } } }).__net.socket.emit(
        'dev:round',
      ),
    );
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'between', null, {
      timeout: 10_000,
    });
    expect(await page.evaluate(() => window.__cybergrid?.wins)).toBe('1-0');
    // se reinicia todo: segunda ronda, de nuevo a elegir
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'pick', null, {
      timeout: 15_000,
    });
    expect(await page.evaluate(() => window.__cybergrid?.round)).toBe(2);
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'fight', null, {
      timeout: 20_000,
    });
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit: (e: string) => void } } }).__net.socket.emit(
        'dev:round',
      ),
    );

    // dos rondas ganadas: termina la partida y salen los resultados del equipo
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#results-title')).toHaveText('¡VICTORIA DEL EQUIPO!');
    await expect(page.locator('#results-sub')).toContainText('2 a 0');
    await expect(page.locator('#results-body tr').first()).toContainText('Ganó');
  });

  test('territorio: equipos de hasta 5, patios que se capturan y victoria por rondas', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_terr'), true);
    await page.locator('[data-mode=territorio]').click();
    await expect(page.getByTestId('room-teamsize')).toBeVisible();
    await expect(page.getByTestId('room-format')).toBeHidden();
    const maps = await page.getByTestId('room-map').locator('option').allTextContents();
    expect(maps).toEqual(['Mapa al azar', 'Calle del barrio', 'Patios traseros']);
    await page.getByTestId('room-teamsize').selectOption('3');
    await expect(page.getByTestId('solo-help')).toContainText('3');
    await page.getByTestId('room-map').selectOption('calle');
    await page.getByTestId('btn-solo').click();
    await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'pick', null, {
      timeout: 15_000,
    });
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'fight', null, {
      timeout: 20_000,
    });
    const info = await page.evaluate(() => {
      const g = (
        window as unknown as {
          __game: {
            mode: string;
            teamSize: number;
            map: { w: number; points: { name: string }[] };
            cats: Map<number, { team?: number }>;
            pvp: { points: number[][] };
          };
        }
      ).__game;
      const teams = [...g.cats.values()].map((c) => c.team);
      return {
        mode: g.mode,
        size: g.teamSize,
        w: g.map.w,
        points: g.map.points.map((p) => p.name),
        state: g.pvp.points.length,
        t0: teams.filter((t) => t === 0).length,
        t1: teams.filter((t) => t === 1).length,
      };
    });
    expect(info.mode).toBe('territorio');
    expect(info.size).toBe(3);
    expect(info.w).toBeGreaterThanOrEqual(90);
    expect(info.points).toEqual(['Plaza oeste', 'El cruce', 'Plaza este']);
    expect(info.state).toBe(3);
    expect([info.t0, info.t1]).toEqual([3, 3]);
    // se gana la ronda y luego la partida
    for (let r = 0; r < 2; r++) {
      await page.evaluate(() =>
        (
          window as unknown as { __net: { socket: { emit: (e: string) => void } } }
        ).__net.socket.emit('dev:round'),
      );
      if (r === 0) {
        await page.waitForFunction(() => window.__cybergrid?.wins === '1-0', null, {
          timeout: 10_000,
        });
        await page.waitForFunction(() => window.__cybergrid?.pvpPhase === 'fight', null, {
          timeout: 30_000,
        });
      }
    }
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#results-title')).toHaveText('¡VICTORIA DEL EQUIPO!');
  });
});
