import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
