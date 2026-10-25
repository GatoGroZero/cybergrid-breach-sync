import { expect, test } from '@playwright/test';
import { coords, registerViaUi, startSoloGame, uniqueName } from './helpers';

test.describe('Móvil: controles táctiles', () => {
  test('el modo tactil se activa solo y arrastrar el joystick mueve al gato', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_mov'));
    await startSoloGame(page);

    expect((await page.evaluate(() => window.__cybergrid))?.mode).toBe('touch');
    await expect(page.getByTestId('hud-mode')).toHaveText('táctil');

    // El joystick esta abajo a la izquierda: se apoya el pulgar en su centro y se arrastra.
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const stick = { x: size.w * 0.13, y: size.h * 0.72 };
    const r = Math.max(46, size.h * 0.12);

    const cdp = await page.context().newCDPSession(page);
    const before = await coords(page);
    const dirs = [
      { x: r, y: 0 },
      { x: 0, y: r },
      { x: -r, y: 0 },
      { x: 0, y: -r },
    ];
    let moved = false;
    for (const d of dirs) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: stick.x, y: stick.y, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: stick.x + d.x, y: stick.y + d.y, id: 1 }],
      });
      await page.waitForTimeout(500);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const after = await coords(page);
      if (Math.hypot(after.x - before.x, after.y - before.y) > 8) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  test('en vertical pide girar el teléfono y en horizontal deja jugar', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_rot'));
    await startSoloGame(page);
    await expect(page.getByTestId('rotate')).toBeHidden();

    // Android entra en pantalla completa al jugar; hay que salir para poder girar el viewport.
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await expect(page.getByTestId('rotate')).toBeVisible();
    await expect(page.getByTestId('rotate')).toContainText('Gira tu teléfono');

    await page.setViewportSize({ width: 915, height: 412 });
    await expect(page.getByTestId('rotate')).toBeHidden();
  });

  test('el lobby en vertical no estorba: solo la partida exige horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await registerViaUi(page, uniqueName('e2e_lob'));
    await expect(page.getByTestId('rotate')).toBeHidden();
    await expect(page.getByTestId('btn-solo')).toBeVisible();
  });

  test('el menu del lobby cabe en el celular, en vertical y en horizontal, sin desplazarse de lado', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await registerViaUi(page, uniqueName('e2e_menu'));
    for (const size of [
      { width: 412, height: 915 },
      { width: 915, height: 412 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.getByTestId('tab-jugar')).toBeVisible();
      await expect(page.getByTestId('tab-salas')).toBeVisible();
      await expect(page.getByTestId('tab-gato')).toBeVisible();
      await expect(page.getByTestId('btn-solo')).toBeInViewport();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      // en Mi gato el lienzo se ve completo sin desplazarse
      await page.getByTestId('tab-gato').click();
      await expect(page.locator('#paint-canvas')).toBeInViewport({ ratio: 0.9 });
      await page.getByTestId('tab-jugar').click();
    }
  });

  test('el inventario se abre con la lata y se ordena arrastrando con el dedo', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_dedo'), true);
    await startSoloGame(page);
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit(e: string): void } } }).__net.socket.emit(
        'dev:kit',
      ),
    );
    const inv = (): Promise<(string | null)[]> =>
      page.evaluate(() =>
        (window as unknown as { __game: { inv: ({ kind: string } | null)[] } }).__game.inv.map(
          (i) => i?.kind ?? null,
        ),
      );
    await expect.poll(async () => (await inv())[0]).toBe('rifle');

    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const cdp = await page.context().newCDPSession(page);
    const touch = async (
      type: 'touchStart' | 'touchEnd' | 'touchMove',
      x?: number,
      y?: number,
    ): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 7 }],
      });
    };
    // La lata de sardinas esta a la derecha, a media altura.
    await touch('touchStart', size.w * 0.94, size.h * 0.44);
    await touch('touchEnd');
    await expect(page.getByTestId('inv')).toBeVisible();

    const center = async (i: number): Promise<{ x: number; y: number }> => {
      const b = (await page.getByTestId('inv-slot').nth(i).boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const a = await center(0);
    const b = await center(3);
    await touch('touchStart', a.x, a.y);
    for (let k = 1; k <= 8; k++)
      await touch('touchMove', a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8);
    await touch('touchEnd');
    await expect.poll(async () => (await inv())[3]).toBe('rifle');
  });

  test('el joystick de la mira dispara solo mientras se apunta y el muro se pone al soltar', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueName('e2e_mira'), true);
    await startSoloGame(page);
    await page.evaluate(() =>
      (window as unknown as { __net: { socket: { emit(e: string): void } } }).__net.socket.emit(
        'dev:kit',
      ),
    );
    type Debug = {
      ammo: number[];
      inv: ({ mag?: number } | null)[];
      select(slot: number): void;
      latest: { walls: unknown[] } | null;
      input: { aimPad: { aiming: boolean } };
    };
    const dbg = <T>(fn: (g: Debug) => T): Promise<T> =>
      page.evaluate(
        (src) =>
          new Function('g', `return (${src})(g)`)(
            (window as unknown as { __game: Debug }).__game,
          ) as T,
        fn.toString(),
      );
    await expect.poll(() => dbg((g) => g.ammo[4])).toBe(90);

    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const u = Math.min(1.7, Math.max(0.8, size.h / 390));
    const pad = { x: size.w * 0.87, y: size.h * 0.7, r: 52 * u * 1.05 };
    const cdp = await page.context().newCDPSession(page);
    const touch = async (
      type: 'touchStart' | 'touchEnd' | 'touchMove',
      x?: number,
      y?: number,
    ): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 3 }],
      });
    };

    // Un toque corto con un arma no dispara: hay que apuntar para que salgan las balas.
    await touch('touchStart', pad.x, pad.y);
    await touch('touchEnd');
    await page.waitForTimeout(300);
    const mag = (): Promise<number> => dbg((g) => g.inv[0]?.mag ?? 30);
    expect(await mag()).toBe(30);

    // Arrastrando se ve la linea y el fusil dispara solo.
    await touch('touchStart', pad.x, pad.y);
    await touch('touchMove', pad.x - pad.r * 0.8, pad.y - pad.r * 0.2);
    await page.waitForTimeout(700);
    expect(await dbg((g) => g.input.aimPad.aiming)).toBe(true);
    const during = await mag();
    expect(during).toBeLessThan(30);
    await touch('touchEnd');
    await page.waitForTimeout(400);
    const after = await mag();
    await page.waitForTimeout(500);
    expect(await mag()).toBe(after);
    expect(await dbg((g) => g.input.aimPad.aiming)).toBe(false);

    // Muro: arrastrar muestra donde caera y se coloca al soltar.
    await dbg((g) => g.select(3));
    expect(await dbg((g) => g.latest?.walls.length ?? 0)).toBe(0);
    await touch('touchStart', pad.x, pad.y);
    await touch('touchMove', pad.x - pad.r * 0.7, pad.y);
    await page.waitForTimeout(300);
    expect(await dbg((g) => g.latest?.walls.length ?? 0)).toBe(0);
    await touch('touchEnd');
    await expect.poll(() => dbg((g) => g.latest?.walls.length ?? 0)).toBeGreaterThan(0);
  });
  test('el boton de la carita abre los emotes y tocar uno lo manda', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_emot'), true);
    await startSoloGame(page);
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const cdp = await page.context().newCDPSession(page);
    const tap = async (x: number, y: number): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 5 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const emote = (): Promise<number | null> =>
      page.evaluate(() => {
        const g = (
          window as unknown as { __game: { emotes: Map<number, { k: number }>; you: number } }
        ).__game;
        return g.emotes.get(g.you)?.k ?? null;
      });
    const bar = (): Promise<boolean> =>
      page.evaluate(
        () =>
          (window as unknown as { __game: { input: { emoteOpen: boolean } } }).__game.input
            .emoteOpen,
      );
    expect(await emote()).toBeNull();

    // Boton de la carita (4 % del ancho, mitad del alto).
    await tap(size.w * 0.04, size.h * 0.5);
    await expect.poll(bar).toBe(true);
    // Los botones de la barra los dibuja el HUD: se toma el segundo.
    const rects = await page.evaluate(
      () =>
        (
          window as unknown as {
            __game: { input: { emoteRects: { x: number; y: number; w: number; h: number }[] } };
          }
        ).__game.input.emoteRects,
    );
    expect(rects).toHaveLength(5);
    const second = rects[1] as { x: number; y: number; w: number; h: number };
    await tap(second.x + second.w / 2, second.y + second.h / 2);
    await expect.poll(emote).toBe(1);
    expect(await bar()).toBe(false);

    // Tocar fuera de la barra solo la cierra.
    await page.waitForTimeout(1600);
    await tap(size.w * 0.04, size.h * 0.5);
    await expect.poll(bar).toBe(true);
    await tap(size.w * 0.5, size.h * 0.12);
    await expect.poll(bar).toBe(false);
    expect(await emote()).toBe(1);
  });
});
