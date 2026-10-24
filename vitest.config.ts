import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/shared/**', 'src/server/**'],
      exclude: ['src/server/index.ts'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
