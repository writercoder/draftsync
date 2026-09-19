import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Native modules (better-sqlite3) are unreliable in worker threads;
    // forks isolate them per-process
    pool: 'forks',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', 'dist/', 'coverage/', '*.config.js'],
      // Ratchet: set at just under current levels so coverage can only go
      // up. Raise these as the stubbed modules gain real implementations
      // and tests (issues #1-#5).
      // branches sits lower than local runs because platform-dependent
      // branches (browser opener, env fallbacks) differ on CI Linux
      thresholds: {
        statements: 29,
        branches: 79,
        functions: 39,
        lines: 29
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
