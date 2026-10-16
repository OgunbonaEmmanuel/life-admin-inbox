import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/browser/**'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
