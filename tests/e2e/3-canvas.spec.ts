import { expect, test } from '@playwright/test';
import { coords, registerViaUi, startSoloGame, uniqueName } from './helpers';

test.describe('Flujo 3: Canvas, controles y WebSocket', () => {
  test('inyectar teclas cambia las coordenadas del jugador en el DOM', async ({ page }) => {
    await registerViaUi(page, uniqueName('e2e_cv'));
    await startSoloGame(page);

    const before = await coords(page);
    let moved = false;
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(500);
      await page.keyboard.up(key);
      const after = await coords(page);
      if (Math.hypot(after.x - before.x, after.y - before.y) > 8) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);

    const state = await page.evaluate(() => window.__cybergrid);
    expect(state?.mode).toBe('keyboard');
    expect(state?.connected).toBe(true);
  });

  test('el juego corre con WebSocket puro y mide ping y pong', async ({ page }) => {
    const sent: string[] = [];
    const received: string[] = [];
    const polling: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('transport=polling')) polling.push(req.url());
    });
    page.on('websocket', (ws) => {
      ws.on('framesent', (f) => sent.push(String(f.payload)));
      ws.on('framereceived', (f) => received.push(String(f.payload)));
    });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await registerViaUi(page, uniqueName('e2e_ws'));
    await startSoloGame(page);
    await page.waitForFunction(() => (window.__cybergrid?.rtt ?? 0) > 0);

    expect(polling).toHaveLength(0);
    expect(sent.some((p) => p.startsWith('42["ping"'))).toBe(true);
    expect(received.some((p) => p.startsWith('42["pong"'))).toBe(true);
    expect(received.some((p) => p.startsWith('42["game:snap"'))).toBe(true);
    expect(sent.some((p) => p.startsWith('42["game:input"'))).toBe(true);

    const state = await page.evaluate(() => window.__cybergrid);
    expect(state?.rtt).toBeLessThan(100);
    expect(state?.fps).toBeGreaterThan(30);
    // La politica de seguridad (CSP) no debe bloquear nada del juego.
    expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
  });
});
