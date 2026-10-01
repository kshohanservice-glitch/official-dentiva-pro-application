import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/renderer/**/*.test.{ts,tsx}',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', 'out/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    reporters: process.env.CI ? ['default'] : ['default'],
  },
});
