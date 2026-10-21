import { defineConfig } from 'vitest/config';

// Emulator tests run long synchronous loops: separate processes and bounded parallelism keep vitest's worker
// messaging alive ("Timeout calling onTaskUpdate" otherwise).
export default defineConfig({
  test: {
    include: ['sim/test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
