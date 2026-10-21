import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['sim/test/**/*.test.ts'], environment: 'node' },
});
