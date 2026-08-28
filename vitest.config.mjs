import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    server: {
      deps: {
        // Inline proxy.ts and its sub-modules so vitest can intercept require('./cryptoStore') calls
        inline: [/\/src\/proxy(\.ts|\/.*)?$/, /\/src\/cryptoStore\.ts$/, 'electron'],
      },
    },
  },
  resolve: {
    alias: {
      electron: path.resolve(__dirname, './src/__tests__/electron-stub.ts'),
    },
  },
});
