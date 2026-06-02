import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Engines run in Node — no DOM needed. JSDOM would only be needed if we
    // had React component tests.
    environment: 'node',
    // Per-test timeout. Our scenarios are pure logic so should be instant.
    testTimeout: 5_000,
  },
});
