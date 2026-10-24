import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
    env: { NODE_ENV: 'test', TZ: 'UTC' },
  },
});
