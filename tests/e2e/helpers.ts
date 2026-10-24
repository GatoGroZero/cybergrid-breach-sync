import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'clave-e2e-segura';

export function uniqueName(prefix: string): string {
  const stamp = Date.now().toString(36).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5);
  return `${prefix}_${stamp}${rand}`.slice(0, 20);
}

export async function registerViaUi(page: Page, username: string): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('tab', { name: 'Crear cuenta' }).click();
  await page.getByTestId('auth-user').fill(username);
  await page.getByTestId('auth-pass').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('screen-lobby')).toBeVisible();
  await expect(page.getByTestId('lobby-net')).toHaveAttribute('data-state', 'online');
}

export async function startSoloGame(page: Page): Promise<void> {
  await page.getByTestId('btn-solo').click();
  await expect(page.locator('#game')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('hud-coords')).toHaveAttribute('data-x', /^\d+$/);
  await page.waitForFunction(() => (window.__cybergrid?.snapshots ?? 0) > 5);
}

export async function coords(page: Page): Promise<{ x: number; y: number }> {
  const el = page.getByTestId('hud-coords');
  return {
    x: Number(await el.getAttribute('data-x')),
    y: Number(await el.getAttribute('data-y')),
  };
}

declare global {
  interface Window {
    __cybergrid?: {
      fps: number;
      rtt: number;
      x: number;
      y: number;
      mode: string;
      snapshots: number;
      connected: boolean;
    };
  }
}
