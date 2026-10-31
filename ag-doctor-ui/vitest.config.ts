// Vitest config — runs only the pure TS unit tests matching the test pattern.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
