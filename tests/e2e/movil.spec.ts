import { expect, test } from '@playwright/test';
import { coords, registerViaUi, startSoloGame, uniqueName } from './helpers';

test.describe('Móvil: controles táctiles', () => {
  test('aparece el joystick y arrastrarlo mueve al jugador', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_mov'));
    await startSoloGame(page);

    expect((await page.evaluate(() => window.__cybergrid))?.mode).toBe('touch');
    await expect(page.getByTestId('hud-mode')).toHaveText('táctil');

    // Geometria del joystick (misma formula que src/client/input.ts).
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const r = Math.max(46, Math.min(74, size.h * 0.13));
    const stick = { x: r + 34, y: size.h - r - 34 };

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
});
