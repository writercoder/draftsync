import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', 'dist/', 'coverage/', '*.config.js'],
      // Ratchet: set at just under current levels so coverage can only go
      // up. Raise these as the stubbed modules gain real implementations
      // and tests (issues #1-#5).
      thresholds: {
        statements: 29,
        branches: 85,
        functions: 39,
        lines: 29
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
