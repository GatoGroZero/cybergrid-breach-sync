import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
      testIgnore: /movil\.spec\.ts/,
    },
    {
      name: 'movil',
      use: { ...devices['Pixel 7 landscape'] },
      testMatch: /movil\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'node dist/server/index.js',
    url: `http://127.0.0.1:${PORT}/api/test/health`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      SESSION_SECRET: 'secreto-e2e-secreto-e2e-secreto-e2e',
      COUNTDOWN_SECONDS: '1',
      DEMO_ACCOUNTS: 'true',
      TEST_KIT: 'true',
      CELEBRATION_SECONDS: '1',
      // Google y el correo "console" (imprime el codigo) para probar la pantalla de acceso.
      GOOGLE_CLIENT_ID: 'e2e-cliente.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'e2e-secreto-del-cliente',
      EMAIL_PROVIDER: 'console',
      // Cada prueba registra su propio usuario: el tope normal de 30 por hora no alcanza.
      LIMIT_REGISTER: '1000',
      LIMIT_GUEST: '1000',
    },
  },
});
