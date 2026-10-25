import { expect, type Page } from '@playwright/test';

interface DebugGame {
  x: number;
  y: number;
  map: { w: number; h: number; solid: Uint8Array; chests: { x: number; y: number }[] };
  /** [id, x, y, tipo (0 cofre, 1 dorado, 2 lapida, 3 objeto), abierto, objeto] */
  boxes: [number, number, number, number, number, number][];
}

export const PASSWORD = 'clave-e2e-segura';

export function uniqueName(prefix: string): string {
  const stamp = Date.now().toString(36).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5);
  return `${prefix}_${stamp}${rand}`.slice(0, 20);
}

/** El acceso con usuario y contraseña vive en un desplegable: se abre si no lo está. */
export async function openPasswordForm(page: Page): Promise<void> {
  // Se espera a que la pantalla de acceso termine de armarse (al armarse deja el desplegable
  // cerrado); si no, se podria abrir antes y que se cierre despues.
  await expect(page.getByTestId('btn-guest')).toBeVisible();
  const box = page.getByTestId('auth-legacy');
  if (!(await box.evaluate((el) => (el as HTMLDetailsElement).open)))
    await box.locator('summary').click();
}

export async function registerViaUi(page: Page, username: string, debug = false): Promise<void> {
  await page.goto(debug ? '/?debug' : '/');
  await expect(page).toHaveURL(/\/login$/);
  await openPasswordForm(page);
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
  // La partida empieza con una cuenta regresiva donde todos estan quietos: se espera a que acabe.
  await page.waitForFunction(() => window.__cybergrid?.intro === 0, null, { timeout: 20_000 });
}

export async function coords(page: Page): Promise<{ x: number; y: number }> {
  const el = page.getByTestId('hud-coords');
  return {
    x: Number(await el.getAttribute('data-x')),
    y: Number(await el.getAttribute('data-y')),
  };
}

/**
 * Camina por casillas libres hasta quedar cerca de (tx, ty), con teclas reales del teclado.
 * Necesita abrir la pagina con ?debug, que expone el estado local del juego.
 */
export async function walkTo(page: Page, tx: number, ty: number, near = 20): Promise<number> {
  return page.evaluate(
    async ({ tx, ty, near }) => {
      const g = (window as unknown as { __game: DebugGame }).__game;
      const m = g.map;
      const T = 16;
      const W: number = m.w;
      const H: number = m.h;
      const key = (type: string, code: string): void => {
        window.dispatchEvent(
          new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }),
        );
      };
      const down = new Set<string>();
      const set = (code: string, on: boolean): void => {
        if (on && !down.has(code)) {
          down.add(code);
          key('keydown', code);
        } else if (!on && down.has(code)) {
          down.delete(code);
          key('keyup', code);
        }
      };
      const free = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < W && y < H && m.solid[y * W + x] === 0;
      const gx = Math.floor(tx / T);
      const gy = Math.floor(ty / T);
      const start = Math.floor(g.y / T) * W + Math.floor(g.x / T);
      const prev = new Int32Array(W * H).fill(-1);
      const queue = [start];
      prev[start] = start;
      let goal = -1;
      while (queue.length > 0) {
        const c = queue.shift() as number;
        const cx = c % W;
        const cy = (c - cx) / W;
        if (Math.abs(cx - gx) + Math.abs(cy - gy) <= 1 && (cx !== gx || cy !== gy)) {
          goal = c;
          break;
        }
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          const n = ny * W + nx;
          if (free(nx, ny) && prev[n] === -1) {
            prev[n] = c;
            queue.push(n);
          }
        }
      }
      if (goal < 0) return -1;
      const path: number[] = [];
      for (let c = goal; c !== prev[c]; c = prev[c] as number) path.push(c);
      path.push(start);
      path.reverse();
      const t0 = performance.now();
      let i = 1;
      while (performance.now() - t0 < 25_000 && i < path.length) {
        if (Math.hypot(g.x - tx, g.y - ty) < near) break;
        const wp = path[i] as number;
        const wx = (wp % W) * T + 8;
        const wy = Math.floor(wp / W) * T + 8;
        const dx = wx - g.x;
        const dy = wy - g.y;
        if (Math.hypot(dx, dy) < 3) {
          i++;
          continue;
        }
        set('KeyD', dx > 2);
        set('KeyA', dx < -2);
        set('KeyS', dy > 2);
        set('KeyW', dy < -2);
        await new Promise((r) => setTimeout(r, 30));
      }
      for (const c of [...down]) set(c, false);
      return Math.round(Math.hypot(g.x - tx, g.y - ty));
    },
    { tx, ty, near },
  );
}

/**
 * El cofre mas cercano que todavia sigue cerrado segun lo que el servidor reporta cerca del gato
 * (los bots abren cofres desde el primer segundo). Si no hay ninguno a la vista, usa el mapa.
 */
export async function nearestChest(
  page: Page,
  skip: { x: number; y: number }[] = [],
): Promise<{ x: number; y: number }> {
  return page.evaluate((skipList) => {
    const g = (window as unknown as { __game: DebugGame }).__game;
    const skipped = (c: { x: number; y: number }): boolean =>
      skipList.some((s) => s.x === c.x && s.y === c.y);
    const pick = (list: { x: number; y: number }[]): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const c of list) {
        if (skipped(c)) continue;
        const d = Math.hypot(c.x - g.x, c.y - g.y);
        if (d < bestD) {
          bestD = d;
          best = { x: c.x, y: c.y };
        }
      }
      return best;
    };
    const closed = g.boxes
      .filter((b) => (b[3] === 0 || b[3] === 1) && b[4] === 0)
      .map((b) => ({ x: b[1], y: b[2] }));
    return pick(closed) ?? (pick(g.map.chests) as { x: number; y: number });
  }, skip);
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
      quality: number;
      hp: number;
      alive: boolean;
      players: number;
      intro: number;
      drawMs: number;
      daytime: number;
      dayName: string;
      pvpPhase: string;
      round: number;
      wins: string;
    };
  }
}
