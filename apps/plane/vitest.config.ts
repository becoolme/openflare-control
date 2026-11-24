import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // These tests share one Postgres database; keep them serial.
    fileParallelism: false,
    pool: 'forks',
    singleFork: true,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/main.ts',
        'src/migrate.ts',
        'src/seed.ts',
        'src/maintain.ts',
      ],
      reporter: ['text'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
